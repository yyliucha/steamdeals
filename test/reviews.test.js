// 异常请求审核 + 限流分桶 + 封禁提示页 + 设备封禁（真 PGlite + 真 HTTP）。
// 新规则：**不自动封禁**，异常只记录，管理员审批后才封 IP / 设备。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer, BAN_ONLY_PAGES } from '../src/server.js';
import * as ratelimit from '../src/ratelimit.js';
import * as guard from '../src/guard.js';
import * as devices from '../src/devices.js';
import * as visitors from '../src/visitors.js';

const WEB = fileURLToPath(new URL('../web', import.meta.url));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

process.env.TRUST_PROXY = '1'; // 用 X-Forwarded-For 模拟公网客户端
process.env.CAPTCHA_ENABLED = '0';
process.env.APPEAL_EMAIL = 'appeal@example.com';
process.env.SITE_NAME = 'SteamDeals-Test';

const ENV_DEFAULTS = {
  RATE_LIMIT_ENABLED: '1',
  RATE_LIMIT_PAGE_MAX: '1000',
  RATE_LIMIT_API_MAX: '1000',
  RATE_LIMIT_ASSET_MAX: '1000',
  RATE_LIMIT_WINDOW_SEC: '60',
  PATH_REVIEW_ENABLED: '1',
  PATH_REVIEW_UNKNOWN_MAX: '30',
  PATH_REVIEW_UNKNOWN_WINDOW_SEC: '600',
};

async function boot(env = {}, { admin = false, logger = null, frontendDir = null } = {}) {
  Object.assign(process.env, ENV_DEFAULTS, env);
  ratelimit.resetState();
  guard.resetState();
  devices.resetState();
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  if (admin) await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({
    query: q,
    outDir: WEB,
    port: 0,
    host: '127.0.0.1',
    getSetupState: async () => ({ completed: true }),
    imageFetch: async () => ({ body: PNG, bytes: PNG.length, contentType: 'image/png' }),
    logger,
    frontendDir,
  });
  return {
    store,
    q,
    base: `http://127.0.0.1:${srv.port}`,
    close: async () => {
      await srv.close();
      await store.close();
    },
  };
}

const asIp = (ip, extra = {}) => ({ headers: { 'x-forwarded-for': ip, ...extra } });
const get = (base, ip, path, extra = {}) => fetch(base + path, asIp(ip, extra));
// 不跟随重定向的版本：断言 302 时用（fetch 默认会跟到 / 再返回 200，302 就看不到了）
const getNoFollow = (base, ip, path, extra = {}) => fetch(base + path, { ...asIp(ip, extra), redirect: 'manual' });

async function waitFor(fn, { timeoutMs = 3000, stepMs = 40 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error('waitFor 超时；最后值：' + JSON.stringify(last));
}

async function loginAdmin(base) {
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
    body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
  });
  assert.equal(res.status, 200, '管理员登录失败');
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

test('XFF 伪造：只信最后一跳 / X-Real-IP，非 IP 不采信', () => {
  const multi = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } };
  assert.equal(visitors.clientIp(multi), '5.6.7.8', '第一个值可能是客户端伪造的');
  const bad = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': 'deadbeef' } };
  assert.equal(visitors.clientIp(bad), '127.0.0.1', '非 IP 不能当生效地址');
  const real = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.2.3.4' } };
  assert.equal(visitors.clientIp(real), '9.9.9.9', 'X-Real-IP 由代理覆盖写入，优先');
});

test('扫描器路径：只记录待审核，不封禁、不返回 403', async () => {
  const { q, base, close } = await boot();
  try {
    const res = await get(base, '203.0.113.9', '/.env');
    assert.equal(res.status, 404, '不存在就是 404，不暴露"已识别"');
    const review = (await q("select ip, rule, hits, status from abuse_reviews where ip = '203.0.113.9'")).rows[0];
    assert.ok(review, '应写入一条待审核记录');
    assert.equal(review.rule, 'secret-file');
    assert.equal(review.status, 'pending');
    assert.equal((await q('select count(*)::int as n from ip_blacklist')).rows[0].n, 0, '不能自动封 IP');
    assert.equal((await q('select count(*)::int as n from device_bans')).rows[0].n, 0, '不能自动封设备');
    // 同一个 IP 继续正常访问：不受影响
    assert.equal((await get(base, '203.0.113.9', '/')).status, 200);
  } finally {
    await close();
  }
});

test('正常页面 + 封面 + 图标：不产生任何审核记录', async () => {
  const { q, base, close } = await boot({ PATH_REVIEW_UNKNOWN_MAX: '3' });
  try {
    for (const path of ['/', '/console', '/api/games', '/img/steam/730/capsule_sm_120', '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/settings-ui.js']) {
      const res = await get(base, '198.51.100.7', path);
      assert.ok(res.status < 400, `${path} 不该失败，实际 ${res.status}`);
    }
    assert.equal((await q('select count(*)::int as n from abuse_reviews')).rows[0].n, 0, '正常浏览不能进审核');
  } finally {
    await close();
  }
});

test('未知路径：达到阈值才记录；同一路径重复刷新不算新路径', async () => {
  const { q, base, close } = await boot({ PATH_REVIEW_UNKNOWN_MAX: '2' });
  try {
    assert.equal((await get(base, '198.51.100.8', '/x1')).status, 404);
    assert.equal((await q('select count(*)::int as n from abuse_reviews')).rows[0].n, 0, '一个未知路径还不够阈值');
    assert.equal((await get(base, '198.51.100.8', '/x2')).status, 404);
    const review = (await q("select rule, hits from abuse_reviews where ip = '198.51.100.8'")).rows[0];
    assert.ok(review, '第二个不同未知路径应触发审核');
    assert.equal(review.rule, 'unknown-paths');

    for (let i = 0; i < 6; i += 1) await get(base, '203.0.113.55', '/same');
    assert.equal((await q("select count(*)::int as n from abuse_reviews where ip = '203.0.113.55'")).rows[0].n, 0, '同一路径重复不能算扫描');
  } finally {
    await close();
  }
});

test('超频：临时限流 429 + 待审核，不写永久黑名单', async () => {
  const { q, base, close } = await boot({ RATE_LIMIT_PAGE_MAX: '2' });
  try {
    assert.equal((await get(base, '198.51.100.9', '/')).status, 200);
    assert.equal((await get(base, '198.51.100.9', '/')).status, 200);
    const third = await get(base, '198.51.100.9', '/');
    assert.equal(third.status, 429);
    const review = (await q("select rule, status from abuse_reviews where ip = '198.51.100.9'")).rows[0];
    assert.ok(review, '超频要进待审核');
    assert.equal(review.rule, 'rate-limit');
    assert.equal((await q('select count(*)::int as n from ip_blacklist')).rows[0].n, 0, '不能自动永久封');
  } finally {
    await close();
  }
});

test('超频三振：10 分钟 → 30 分钟 → 封到当天结束，次日重新从 10 分钟起算', async () => {
  const { q, base, close } = await boot({ RATE_LIMIT_PAGE_MAX: '2', RATE_LIMIT_API_MAX: '1000' });
  try {
    // 封禁期内再打 3 次就升一档，避免测试发几百个请求；BR 批：升级只累计 API 请求
    ratelimit.configure({ pageMax: 2, apiMax: 1000, windowSec: 60, blockedEscalate: 3 });
    const ip = '198.51.100.31';
    const hit = () => get(base, ip, '/');
    const apiHit = () => fetch(base + '/api/games/count', asIp(ip));

    await hit();
    await hit();
    assert.equal((await hit()).status, 429, '第 3 次超限');
    let row = (await q('select strikes, banned_until from ip_abuse where ip = $1', [ip])).rows[0];
    assert.equal(row.strikes, 1);
    const firstMin = Math.round((new Date(row.banned_until).getTime() - Date.now()) / 60000);
    assert.ok(firstMin >= 9 && firstMin <= 10, '第一次应封约 10 分钟，实际 ' + firstMin);

    // 封禁期内页面刷新不升级（BR 批 §11.2 决策 4）：先打 5 个页面请求，strikes 不变
    for (let i = 0; i < 5; i += 1) assert.equal((await hit()).status, 429);
    row = (await q('select strikes from ip_abuse where ip = $1', [ip])).rows[0];
    assert.equal(row.strikes, 1, '封禁期内的页面 GET 不得升级封禁');

    for (let i = 0; i < 3; i += 1) assert.equal((await apiHit()).status, 429);
    row = (await q('select strikes, banned_until from ip_abuse where ip = $1', [ip])).rows[0];
    assert.equal(row.strikes, 2);
    const secondMin = Math.round((new Date(row.banned_until).getTime() - Date.now()) / 60000);
    assert.ok(secondMin >= 29 && secondMin <= 30, '第二次应封约 30 分钟，实际 ' + secondMin);

    let third = null;
    for (let i = 0; i < 3; i += 1) third = await apiHit();
    assert.equal(third.status, 429);
    assert.match(await third.text(), /明天 0 点/, '第 3 次要明确告知封到当天结束');
    row = (await q('select strikes, banned_until from ip_abuse where ip = $1', [ip])).rows[0];
    assert.equal(row.strikes, 3);
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    assert.ok(
      Math.abs(new Date(row.banned_until).getTime() - midnight.getTime()) <= 5000,
      '第三次应封到次日 0 点，实际 ' + row.banned_until,
    );
    assert.equal((await q('select count(*)::int as n from ip_blacklist')).rows[0].n, 0, '不能自动写永久黑名单');

    // 当天封顶 3 次：继续请求不再升级/累加，且重启后能从 ban_source 恢复“当天封禁”状态
    const reviewsBefore = (await q("select count(*)::int as n from abuse_reviews where ip = $1", [ip])).rows[0].n;
    for (let i = 0; i < 6; i += 1) await apiHit();
    row = (await q('select strikes from ip_abuse where ip = $1', [ip])).rows[0];
    assert.equal(row.strikes, 3, '一天最多 3 次，封顶后不再累加');
    assert.equal(
      (await q("select count(*)::int as n from abuse_reviews where ip = $1", [ip])).rows[0].n,
      reviewsBefore,
      '当天封禁后不再产生新的待审核记录',
    );
    ratelimit.resetState();
    await ratelimit.loadState(q);
    const restored = await hit();
    assert.equal(restored.status, 429);
    assert.match(await restored.text(), /今天已被封禁/, '重启后仍应恢复为“当天封禁”');

    // 模拟“第二天”：把这次封禁改成昨天、清空内存，再超限一次 → 应重新从第 1 次（10 分钟）起算
    await q("update ip_abuse set banned_until = now() - interval '1 second', strike_day = current_date - 1 where ip = $1", [ip]);
    ratelimit.resetState();
    await ratelimit.loadState(q);
    ratelimit.configure({ pageMax: 2, windowSec: 60, blockedEscalate: 3 });
    await hit();
    await hit();
    assert.equal((await hit()).status, 429);
    row = (await q('select strikes, banned_until from ip_abuse where ip = $1', [ip])).rows[0];
    assert.equal(row.strikes, 1, '新的一天应重新从第 1 次算');
    const againMin = Math.round((new Date(row.banned_until).getTime() - Date.now()) / 60000);
    assert.ok(againMin >= 9 && againMin <= 10, '次日第一次应重新封 10 分钟，实际 ' + againMin);
  } finally {
    await close();
  }
});

test('管理员审批：封 IP 后整站 403，浏览器拿到多语言提示页（含申诉邮箱）', async () => {
  const { q, base, close } = await boot({}, { admin: true });
  try {
    await get(base, '198.51.100.10', '/.env');
    await waitFor(async () => (await q("select count(*)::int as n from abuse_reviews where status = 'pending'")).rows[0].n >= 1);
    const cookie = await loginAdmin(base);

    const list = await (await fetch(base + '/api/admin/reviews?status=pending', { headers: { cookie, 'x-forwarded-for': '203.0.113.77' } })).json();
    const review = list.reviews.find((r) => r.ip === '198.51.100.10');
    assert.ok(review, '待审核列表里应该有这个 IP');

    // BJ 批 D1 前置：给该 IP 造一条「生效中的临时封禁」行，审批后应被清空（行保留）
    await q("insert into ip_abuse (ip, strikes, banned_until, ban_source) values ('198.51.100.10', 2, now() + interval '30 minutes', 'rate')");

    const approve = await fetch(base + '/api/admin/reviews/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ id: review.id, mode: 'ip' }),
    });
    assert.equal(approve.status, 200);
    assert.ok((await q("select count(*)::int as n from ip_blacklist where ip = '198.51.100.10'")).rows[0].n >= 1, '审批后应进黑名单');
    // BJ 批 D1：审核通过写黑名单时，把该 IP 的临时封禁字段清掉（行保留做审计）
    const abuseRow = (await q("select banned_until, ban_source from ip_abuse where ip = '198.51.100.10'")).rows[0];
    assert.ok(abuseRow, 'ip_abuse 行必须保留');
    assert.equal(abuseRow.banned_until, null, '被黑名单覆盖的 IP 不再有临时封禁时间');
    assert.equal(abuseRow.ban_source, null, '封禁来源一并清空');

    const api = await get(base, '198.51.100.10', '/api/games');
    assert.equal(api.status, 403);
    const page = await get(base, '198.51.100.10', '/', { accept: 'text/html' });
    assert.equal(page.status, 403);
    const html = await page.text();
    assert.match(html, /SteamDeals-Test/);
    assert.match(html, /appeal@example\.com/);
    assert.doesNotMatch(html, /__SITE_NAME__|__APPEAL_EMAIL__/, '占位符必须被替换');
    // 没有邮件客户端时 mailto 点了不会有任何反应，页面必须提供「复制申诉内容」和可见提示
    assert.match(html, /id="appealCopy"/, '申诉要有复制兜底按钮');
    assert.match(html, /id="appealMsg"/, '申诉要有可见反馈区域');
  } finally {
    await close();
  }
});

test('设备指纹：上报落库 + 管理员封设备后 POST 返回 banned，页面直接 403', async () => {
  const { q, base, close } = await boot({}, { admin: true });
  try {
    const details = {
      platform: 'Win32',
      vendor: 'Google Inc.',
      language: 'zh-CN',
      languages: ['zh-CN', 'en'],
      timezone: 'Asia/Shanghai',
      screen: { w: 1920, h: 1080, aw: 1920, ah: 1040, cd: 24 },
      viewport: { w: 1280, h: 800, dpr: 1 },
      hardwareConcurrency: 8,
      deviceMemory: 8,
      touchPoints: 0,
      webglVendor: 'Google Inc. (Intel)',
      webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics)',
      canvasHash: 'abcd1234',
    };
    const did = 'device-test-0001';
    const first = await fetch(base + '/api/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.30' },
      body: JSON.stringify({ deviceId: did, details }),
    });
    assert.equal(first.status, 200);
    const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0];
    assert.ok(cookie.startsWith('gp_device='), '应下发设备 cookie');
    const row = (await q("select fingerprint, device_id from device_logs where device_id = 'device-test-0001'")).rows[0];
    assert.ok(row && row.fingerprint, '设备信息应落库');

    const adminCookie = await loginAdmin(base);
    const ban = await fetch(base + '/api/admin/devices/ban', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ fingerprint: row.fingerprint, deviceId: did, permanent: true, note: '测试' }),
    });
    assert.equal(ban.status, 200);

    const again = await fetch(base + '/api/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.30' },
      body: JSON.stringify({ deviceId: did, details }),
    });
    assert.equal(again.status, 403);
    assert.equal((await again.json()).banned, true);

    const page = await fetch(base + '/', {
      headers: { 'x-forwarded-for': '198.51.100.30', accept: 'text/html', cookie },
    });
    assert.equal(page.status, 403, '带被封设备 cookie 的页面请求直接拒绝');
  } finally {
    await close();
  }
});

test('被拦截请求：单独标记、每 IP 每分钟采样一条，不计入访问量', async () => {
  const { q, base, close } = await boot({ RATE_LIMIT_PAGE_MAX: '1' });
  try {
    assert.equal((await get(base, '198.51.100.11', '/')).status, 200);
    for (let i = 0; i < 4; i += 1) assert.equal((await get(base, '198.51.100.11', '/')).status, 429);
    const blocked = await waitFor(async () => {
      const n = (await q('select count(*)::int as n from visitor_logs where blocked')).rows[0].n;
      return n >= 1 ? n : 0;
    });
    assert.equal(blocked, 1, '同一 IP 一分钟内只记一条被拦截记录');

    const visits = await db.listVisitorLogs(q, { filter: 'visits' });
    assert.equal(visits.rows.every((r) => r.blocked === false), true);
    const onlyBlocked = await db.listVisitorLogs(q, { filter: 'blocked' });
    assert.equal(onlyBlocked.total, 1);
    const summary = await db.visitorSummary(q);
    assert.ok(summary.today_visits >= 1);
    assert.equal(summary.today_blocked, 1);
  } finally {
    await close();
  }
});

test('限流分桶：静态资源不占用页面/API 的阈值', async () => {
  const { base, close } = await boot({ RATE_LIMIT_PAGE_MAX: '3', RATE_LIMIT_ASSET_MAX: '100' });
  try {
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await get(base, '198.51.100.12', `/img/steam/730/capsule_sm_120?i=${i}`)).status, 200);
    }
    for (let i = 0; i < 3; i += 1) assert.equal((await get(base, '198.51.100.12', '/')).status, 200);
    assert.equal((await get(base, '198.51.100.12', '/')).status, 429, '页面桶超过 3 次才限流');
  } finally {
    await close();
  }
});

test('异常审核联动（口径 A）：封禁期内的 pending 仍出现在待审列表与计数', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q(
      "insert into abuse_reviews (ip, rule, status) values ('198.51.100.1', 'rate-limit', 'pending'), ('198.51.100.2', 'secret-file', 'pending'), (null, 'unknown-paths', 'pending')",
    );
    await q("insert into ip_abuse (ip, strikes, banned_until) values ('198.51.100.1', 3, now() + interval '30 minutes')");

    // 口径 A（docs/BAN-AND-SECURITY-FIXES.md §5）：待审 = 全部 pending。
    // v1.9.0 起封禁动作已把旧 pending 标成 auto_banned 永久退出待审，这里不再按
    // "IP 是否处于临时封禁"二次过滤——封禁期间新产生的 pending 恰恰是最该看的。
    const list = await db.listAbuseReviews(q, { status: 'pending', limit: 10 });
    const ips = list.map((r) => r.ip);
    assert.deepEqual(ips.filter(Boolean).sort(), ['198.51.100.1', '198.51.100.2'], '封禁中的 pending 也要出现');
    assert.equal(ips.filter((ip) => ip === null).length, 1, 'ip 为 null 的记录保留');
    assert.equal(await db.countPendingReviews(q), 3, '计数与列表一致');
  } finally {
    await store.close();
  }
});

test('封禁标记：封禁时已有 pending → auto_banned（解封不恢复），新异常重新生成 pending', async () => {
  const { q, base, close } = await boot({ RATE_LIMIT_PAGE_MAX: '2' });
  try {
    const ip = '198.51.100.40';
    // 第一轮超频：封禁 10 分钟；本轮新生成的待审 R1 在封禁之后产生（属"新异常"，保持 pending，
    // 口径 A 下仍出现在待审列表——与状态列「待审」一致）。
    await get(base, ip, '/');
    await get(base, ip, '/');
    assert.equal((await get(base, ip, '/')).status, 429);
    await waitFor(async () => {
      const n = (await q("select count(*)::int as n from abuse_reviews where ip = $1", [ip])).rows[0].n;
      return n >= 1 ? n : 0;
    });
    assert.equal((await q("select status from abuse_reviews where ip = $1", [ip])).rows[0].status, 'pending');

    // 解封（模拟到期）
    await q("update ip_abuse set banned_until = now() - interval '1 second' where ip = $1", [ip]);
    ratelimit.resetState();
    await ratelimit.loadState(q);
    ratelimit.configure({ pageMax: 2, windowSec: 60, blockedEscalate: 3 });

    // 第二轮超频：升级封禁。此时 R1 已存在且 pending → 被标记 auto_banned；
    // 本轮新生成的 R2 在封禁之后产生，保持 pending。
    await get(base, ip, '/');
    await get(base, ip, '/');
    assert.equal((await get(base, ip, '/')).status, 429);
    await waitFor(async () => {
      const n = (await q("select count(*)::int as n from abuse_reviews where ip = $1", [ip])).rows[0].n;
      return n >= 2 ? n : 0;
    });
    const rows = await q("select status, note from abuse_reviews where ip = $1 order by id", [ip]);
    assert.deepEqual(rows.rows.map((r) => r.status), ['auto_banned', 'pending'], '旧记录被标记、新记录保持待审');
    assert.equal(rows.rows[0].note, '自动封禁');
    // 口径 A：封禁期间的新异常（R2）仍以「待审」出现，不再被二次过滤隐藏
    assert.equal((await db.listAbuseReviews(q, { status: 'pending' })).filter((r) => r.ip === ip).length, 1, '封禁期内的新异常应出现在待审');

    // 解封 → R1 不恢复 pending（永久退出）；R2 回到待审（新异常可审核）
    await q("update ip_abuse set banned_until = now() - interval '1 second' where ip = $1", [ip]);
    ratelimit.resetState();
    await ratelimit.loadState(q);
    ratelimit.configure({ pageMax: 2, windowSec: 60, blockedEscalate: 3 });
    const pending = await db.listAbuseReviews(q, { status: 'pending' });
    const mine = pending.filter((r) => r.ip === ip);
    assert.equal(mine.length, 1, '只有新异常回到待审');
    assert.equal(mine[0].status, 'pending');
    const all = await db.listAbuseReviews(q, { status: 'all' });
    const mineAll = all.filter((r) => r.ip === ip).map((r) => r.status).sort();
    assert.deepEqual(mineAll, ['auto_banned', 'pending'], '审计视图两条都在，旧记录保持 auto_banned');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------- 封禁页守卫
// docs/BAN-PAGE-GUARD.md：未封禁访问 /banned → 302 回首页；真正被封禁的请求在拦截链里
// 由 denyBanned 返回封禁页（403/429）。页面路由只做重定向，不做二次判定。

/** 伪造一个前端构建产物目录，让 serveBanPage 走 Vue 注入路径（__BAN_PAGE__）。 */
function banFrontDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gp-ban-front-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head></head><body>ban-placeholder</body></html>');
  return dir;
}

test('未封禁访问 /banned 与 /banned/ → 302 回首页（no-store）', async () => {
  const { base, close } = await boot();
  try {
    for (const p of ['/banned', '/banned/']) {
      const res = await getNoFollow(base, '198.51.100.40', p);
      assert.equal(res.status, 302, p);
      assert.equal(res.headers.get('location'), '/');
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
  } finally {
    await close();
  }
});

test('IP 黑名单命中：/banned 仍是 403 封禁页（注入 __BAN_PAGE__），不是 302', async () => {
  const { base, close } = await boot({}, { admin: true, frontendDir: banFrontDir() });
  try {
    const cookie = await loginAdmin(base);
    const ban = await fetch(base + '/api/admin/blacklist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ ip: '198.51.100.41', note: 'ban page guard' }),
    });
    assert.equal(ban.status, 200);
    const res = await get(base, '198.51.100.41', '/banned', { accept: 'text/html' });
    assert.equal(res.status, 403, '黑名单命中应仍是封禁页而不是 302');
    const html = await res.text();
    assert.match(html, /window\.__BAN_PAGE__=\{/, '应注入 __BAN_PAGE__ 载荷');
  } finally {
    await close();
  }
});

test('管理员 bypass：IP 在黑名单里，带会话访问 /banned → 302', async () => {
  const { base, close } = await boot({}, { admin: true });
  try {
    const cookie = await loginAdmin(base);
    // 把自己的出口 IP 拉黑：管理员仍应能访问一切，包括 /banned（bypass 在拦截链生效）
    const ban = await fetch(base + '/api/admin/blacklist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ ip: '203.0.113.77', note: 'ban own exit ip' }),
    });
    assert.equal(ban.status, 200);
    const res = await fetch(base + '/banned', { headers: { 'x-forwarded-for': '203.0.113.77', cookie }, redirect: 'manual' });
    assert.equal(res.status, 302, '管理员有 bypass，应回首页而不是封禁页');
    assert.equal(res.headers.get('location'), '/');
  } finally {
    await close();
  }
});

test('设备封禁命中：/banned 403，换 IP 也一样', async () => {
  const { q, base, close } = await boot({}, { admin: true });
  try {
    const details = { platform: 'Win32', vendor: 'Google Inc.', language: 'zh-CN', timezone: 'Asia/Shanghai', webglVendor: 'v', webglRenderer: 'r', canvasHash: 'ban-guard' };
    const did = 'device-banguard-01';
    const first = await fetch(base + '/api/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.50' },
      body: JSON.stringify({ deviceId: did, details }),
    });
    assert.equal(first.status, 200);
    const deviceCookie = (first.headers.get('set-cookie') ?? '').split(';')[0];
    const row = (await q("select fingerprint from device_logs where device_id = 'device-banguard-01'")).rows[0];
    assert.ok(row?.fingerprint);
    const adminCookie = await loginAdmin(base);
    const ban = await fetch(base + '/api/admin/devices/ban', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ fingerprint: row.fingerprint, deviceId: did, permanent: true }),
    });
    assert.equal(ban.status, 200);
    for (const ip of ['198.51.100.50', '198.51.100.51']) {
      const res = await fetch(base + '/banned', { headers: { 'x-forwarded-for': ip, accept: 'text/html', cookie: deviceCookie } });
      assert.equal(res.status, 403, `带被封设备 cookie 的 ${ip} 访问 /banned 应 403`);
    }
  } finally {
    await close();
  }
});

test('频率封禁命中：/banned 429 + Retry-After', async () => {
  const { base, close } = await boot({ RATE_LIMIT_PAGE_MAX: '1' });
  try {
    assert.equal((await get(base, '198.51.100.60', '/')).status, 200);
    assert.equal((await get(base, '198.51.100.60', '/')).status, 429);
    const res = await get(base, '198.51.100.60', '/banned', { accept: 'text/html' });
    assert.equal(res.status, 429, '频率封禁期内 /banned 应沿用 429');
    assert.ok(Number(res.headers.get('retry-after')) > 0, '应带 Retry-After');
  } finally {
    await close();
  }
});

test('封禁过期后 /banned → 302（过期即视为未封禁）', async () => {
  const { base, close } = await boot({ RATE_LIMIT_PAGE_MAX: '1' });
  try {
    const ip = '198.51.100.61';
    assert.equal((await get(base, ip, '/')).status, 200);
    assert.equal((await get(base, ip, '/')).status, 429);
    assert.equal((await get(base, ip, '/banned', { accept: 'text/html' })).status, 429);
    // 把内存态封禁改成过去时间：下一次 hit() 会清掉过期条目、正常放行
    ratelimit.applyExternalBan(ip, Date.now() - 1000, { source: 'rate' });
    const res = await getNoFollow(base, ip, '/banned');
    assert.equal(res.status, 302, '封禁过期后应回首页');
    assert.equal(res.headers.get('location'), '/');
  } finally {
    await close();
  }
});

test('日志：302 记 ban.redirect_home；被封禁仍是 ban.page；BanPage 有前端兜底守卫', async () => {
  // BanPage 守卫是静态断言（无浏览器环境）：无 __BAN_PAGE__ 必须 location.replace('/')
  const banPage = readFileSync(fileURLToPath(new URL('../frontend/src/pages/BanPage.vue', import.meta.url)), 'utf8');
  assert.match(banPage, /!window\.__BAN_PAGE__/, '守卫条件应是 __BAN_PAGE__ 缺失');
  assert.match(banPage, /window\.location\.replace\('\/'\)/, '守卫动作应是回首页');

  const events = [];
  const logger = {
    info: (event, fields) => events.push([event, fields]),
    warn: (event, fields) => events.push([event, fields]),
    error: (event, fields) => events.push([event, fields]),
  };
  const { base, close } = await boot({}, { admin: true, logger });
  try {
    const cookie = await loginAdmin(base);
    const ban = await fetch(base + '/api/admin/blacklist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ ip: '198.51.100.70', note: 'log test' }),
    });
    assert.equal(ban.status, 200);
    await get(base, '198.51.100.70', '/banned', { accept: 'text/html' }); // 被封禁 → 403 封禁页
    await get(base, '198.51.100.71', '/banned'); // 未封禁 → 302

    assert.ok(events.some(([e]) => e === 'ban.redirect_home'), '未封禁的 /banned 应记 ban.redirect_home');
    assert.ok(events.some(([e]) => e === 'ban.page'), '被封禁的请求应仍记 ban.page');
    const redirect = events.find(([e]) => e === 'ban.redirect_home');
    assert.equal(redirect[1].path, '/banned');
    assert.equal(redirect[1].ip, '198.51.100.71');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------- 仅封禁可见页面统一守卫
// docs/BAN-AND-SECURITY-FIXES.md §3：BAN_ONLY_PAGES 里的页面未封禁一律 302；被封禁者
// 封禁页（/banned*）被拦截链 403、申诉页（/appeal*）豁免拦截链可见。
// 测试遍历的是 server.js 导出的真实集合——以后新增同类页面漏登记会直接红。

/** 调 /api/ban/state；接口自带 1 次/秒限流，测试里被限流就等 1.1 秒重试（最多 3 次）。 */
async function banState(base, ip, extra = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(base + '/api/ban/state', { headers: { 'x-forwarded-for': ip, ...extra } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1100));
      continue;
    }
    return { status: res.status, body: await res.json() };
  }
  throw new Error('/api/ban/state 一直被限流');
}

test('BAN_ONLY_PAGES 遍历：未封禁一律 302；被封禁时 /banned* 403（CF 批：/appeal 已移出注册表，未封可见）', async () => {
  const { base, close } = await boot({}, { admin: true, frontendDir: banFrontDir() });
  try {
    const cookie = await loginAdmin(base);
    const victim = '198.51.100.80';
    const bystander = '198.51.100.81';
    const pages = [...BAN_ONLY_PAGES];
    assert.ok(pages.length >= 3, '注册表至少包含 /banned、/banned/、/banned.html');
    assert.ok(!BAN_ONLY_PAGES.has('/appeal'), 'CF 批：/appeal 未封禁也应可见（只显示无需申诉提示）');

    // 未封禁：全部 302 回首页
    for (const p of pages) {
      const res = await getNoFollow(base, bystander, p);
      assert.equal(res.status, 302, `未封禁 ${p} 应 302`);
      assert.equal(res.headers.get('location'), '/');
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }

    // 拉黑 victim
    const ban = await fetch(base + '/api/admin/blacklist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ ip: victim }),
    });
    assert.equal(ban.status, 200);

    // 被封禁：/banned* 由拦截链给 403 封禁页；/appeal 豁免拦截链、可见（申诉入口）
    for (const p of pages) {
      const res = await fetch(base + p, { headers: { 'x-forwarded-for': victim, accept: 'text/html' } });
      assert.equal(res.status, 403, `被封禁 ${p} 应给封禁页`);
    }
    const appealRes = await fetch(base + '/appeal', { headers: { 'x-forwarded-for': victim, accept: 'text/html' } });
    assert.equal(appealRes.status, 200, '被封禁 /appeal 应可见（申诉入口）');
  } finally {
    await close();
  }
});

test('/api/ban/state：只读、豁免拦截链、IP/白名单口径', async () => {
  const { base, close } = await boot({}, { admin: true });
  try {
    const cookie = await loginAdmin(base);
    const ip = '198.51.100.90';
    const trustIp = '198.51.100.91';

    // 未封禁
    const free = await banState(base, ip);
    assert.deepEqual(free.body, { banned: false, ip, whitelisted: false });

    // IP 封禁：被封者仍能调状态接口（豁免拦截链），且拿到自己的状态
    await fetch(base + '/api/admin/blacklist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ ip }),
    });
    const ipState = await banState(base, ip);
    assert.equal(ipState.body.banned, true);
    assert.equal(ipState.body.type, 'ip');
    assert.equal(ipState.body.until, null);
    assert.equal(ipState.body.ip, ip, '三件套应回调用者自己的 IP');
    assert.equal(ipState.body.whitelisted, false);

    // 白名单视为未封禁（互斥后同 IP 不会再两边都在）
    await fetch(base + '/api/admin/whitelist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ ip: trustIp }),
    });
    const trusted = await banState(base, trustIp);
    assert.deepEqual(trusted.body, { banned: false, ip: trustIp, whitelisted: true }, '白名单视为未封禁且标注 whitelisted');
  } finally {
    await close();
  }
});

test('/api/ban/state：设备与频率封禁类型', async () => {
  const { q, base, close } = await boot({ RATE_LIMIT_PAGE_MAX: '1' }, { admin: true });
  try {
    // 频率封禁：先触发一次临时封禁，再查状态（状态接口不参与计数、不升档）
    const rateIp = '198.51.100.92';
    assert.equal((await get(base, rateIp, '/')).status, 200);
    assert.equal((await get(base, rateIp, '/')).status, 429);
    const rateState = await banState(base, rateIp);
    assert.equal(rateState.body.banned, true);
    assert.equal(rateState.body.type, 'rate');
    assert.ok(rateState.body.until, '频率封禁应带到期时间');
    // 状态接口豁免频率计数：轮询若干次仍是同一封禁（否则轮询会把封禁升档）
    for (let i = 0; i < 3; i += 1) {
      const again = await banState(base, rateIp);
      assert.equal(again.body.type, 'rate', '状态接口不得参与三振计数（也不会把封禁升档）');
    }

    // 设备封禁
    const details = { platform: 'Win32', vendor: 'Google Inc.', language: 'zh-CN', timezone: 'Asia/Shanghai', webglVendor: 'v', webglRenderer: 'r', canvasHash: 'state-test' };
    const did = 'device-state-01';
    const first = await fetch(base + '/api/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.93' },
      body: JSON.stringify({ deviceId: did, details }),
    });
    assert.equal(first.status, 200);
    const deviceCookie = (first.headers.get('set-cookie') ?? '').split(';')[0];
    const row = (await q("select fingerprint from device_logs where device_id = 'device-state-01'")).rows[0];
    const adminCookie = await loginAdmin(base);
    await fetch(base + '/api/admin/devices/ban', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ fingerprint: row.fingerprint, deviceId: did, permanent: true }),
    });
    const devState = await banState(base, '198.51.100.93', { cookie: deviceCookie });
    assert.equal(devState.body.banned, true);
    assert.equal(devState.body.type, 'device');
    assert.equal(devState.body.until, null, '永久封禁无到期时间');
  } finally {
    await close();
  }
});

test('/api/ban/state 自带限流：突发请求出现 429（防探测）', async () => {
  const { base, close } = await boot();
  try {
    const ip = '198.51.100.94';
    let limited = 0;
    for (let i = 0; i < 31; i += 1) {
      const res = await fetch(base + '/api/ban/state', { headers: { 'x-forwarded-for': ip } });
      if (res.status === 429) {
        limited += 1;
        assert.ok(Number(res.headers.get('retry-after')) > 0, '429 应带 retry-after');
      }
    }
    assert.ok(limited >= 1, '1 次/秒 + 30 次/分钟的限流应生效');
  } finally {
    await close();
  }
});

test('前端：待审状态列 4 种标签 + 口径 A 说明文案', () => {
  const modules = readFileSync(fileURLToPath(new URL('../frontend/src/pages/AdminModules.vue', import.meta.url)), 'utf8');
  for (const label of ['>待审<', '>已封禁<', '>已忽略<', '>自动退出<']) {
    assert.ok(modules.includes(label), `状态列应有 ${label}`);
  }
  // AX 批（docs/ADMIN-REVIEW-LISTS.md §4.5）：明细表已删，展开行仍能看到每条规则的规则/命中/路径/时间/状态
  assert.match(modules, /class="merged-detail-row"/, '合并视图展开行保留逐条规则明细');
  assert.match(modules, /封禁期间产生的新异常仍会以「待审」出现/, '说明文案应为口径 A');
  assert.ok(!modules.includes('解封后自动恢复显示'), '旧口径文案应移除');
});

// ---------------------------------------------------------------- BR 批（docs/BAN-AND-SECURITY-FIXES.md §11）
// 加白即清封 + ban/state 三件套 + 封禁页 payload（remainingSec / ipMasked）：
// 手机被误封 → 管理员加白 → 不重启立即恢复访问。

test('BR：加白即清封——clearedBan:true，ban/state 立即变 banned:false/whitelisted:true，访问恢复', async () => {
  const { base, close } = await boot({ RATE_LIMIT_PAGE_MAX: '1' }, { admin: true, frontendDir: banFrontDir() });
  try {
    const adminCookie = await loginAdmin(base);
    const ip = '198.51.100.95';
    // 手机正常刷页面触发临时封禁
    assert.equal((await get(base, ip, '/')).status, 200);
    const blocked = await get(base, ip, '/');
    assert.equal(blocked.status, 429, '第 2 次页面请求应触发临时封禁');
    const state1 = await banState(base, ip);
    assert.equal(state1.body.banned, true);
    assert.equal(state1.body.type, 'rate');
    assert.equal(state1.body.whitelisted, false);

    // 管理员加白 → 响应回 clearedBan:true，且**不重启**立即恢复
    const wl = await fetch(base + '/api/admin/whitelist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ ip }),
    });
    assert.equal(wl.status, 200);
    const wlBody = await wl.json();
    assert.equal(wlBody.clearedBan, true, '加白应回 clearedBan:true（该 IP 正处于临时封禁中）');

    const state2 = await banState(base, ip);
    assert.deepEqual(state2.body, { banned: false, ip, whitelisted: true }, '加白后 ban/state 立即变为未封禁');
    assert.equal((await get(base, ip, '/')).status, 200, '加白后无需重启即可恢复访问');
  } finally {
    await close();
  }
});

test('BR：封禁页 payload 注入 remainingSec 与 ipMasked；封禁期内刷页面不升级', async () => {
  const { q, base, close } = await boot({ RATE_LIMIT_PAGE_MAX: '1' }, { admin: true, frontendDir: banFrontDir() });
  try {
    // BanPage 渲染层静态断言：剩余时间与脱敏 IP 必须出现在模板里（无浏览器环境，锁文案与绑定）
    const banPage = readFileSync(fileURLToPath(new URL('../frontend/src/pages/BanPage.vue', import.meta.url)), 'utf8');
    assert.match(banPage, /remainingText/, 'BanPage 应计算剩余时间文案');
    assert.match(banPage, /info\.ipMasked/, 'BanPage 应展示脱敏 IP');

    const ip = '198.51.100.96';
    assert.equal((await get(base, ip, '/')).status, 200);
    assert.equal((await get(base, ip, '/')).status, 429);
    // 被封禁者以浏览器身份请求页面 → 403/429 封禁页带 __BAN_PAGE__ 载荷
    const res = await get(base, ip, '/banned', { accept: 'text/html' });
    assert.equal(res.status, 429);
    const html = await res.text();
    const m = html.match(/window\.__BAN_PAGE__=(\{.*?\});/);
    assert.ok(m, '应注入 __BAN_PAGE__ 载荷');
    const payload = JSON.parse(m[1].replace(/\\u003c/g, '<'));
    assert.ok(payload.remainingSec > 0, '应带剩余秒数');
    assert.equal(payload.ipMasked, '198.51.100.x', 'IP 应脱敏为末段 x');

    // 封禁期内狂刷页面：不升级封禁（升级只累计 API）
    const before = (await q("select strikes from ip_abuse where ip = $1", [ip])).rows[0]?.strikes ?? 1;
    for (let i = 0; i < 20; i += 1) await get(base, ip, '/');
    const after = (await q("select strikes from ip_abuse where ip = $1", [ip])).rows[0]?.strikes ?? 1;
    assert.equal(after, before, '封禁期内页面 GET 不得累计升级计数');
  } finally {
    await close();
  }
});

test('BR：纯 API 高频仍会被拦并升级（脚本防护不丢）', async () => {
  const { q, base, close } = await boot({ RATE_LIMIT_API_MAX: '1' }, { admin: true });
  try {
    const ip = '198.51.100.97';
    // API 桶独立：页面请求不触发 API 阈值
    assert.equal((await get(base, ip, '/')).status, 200);
    assert.equal((await fetch(base + '/api/games/count', asIp(ip))).status, 200);
    const limited = await fetch(base + '/api/games/count', asIp(ip));
    assert.equal(limited.status, 429, 'API 桶第 2 次即超限');
    // 封禁期内继续打 API 会升级（blockedEscalate 默认 100，这里直接断言封禁存在且 API 计数生效）
    const row = (await q("select strikes, banned_until from ip_abuse where ip = $1", [ip])).rows[0];
    assert.equal(row.strikes, 1, 'API 超限应记第 1 次三振');
    assert.ok(new Date(row.banned_until).getTime() > Date.now(), 'API 超限应进入临时封禁');
  } finally {
    await close();
  }
});

// ============================================================ CO-5/B4-2 第八轮静态锁
// admin-access 域（B4 #8：views/visitors/blacklist/whitelist/abuse/devices/reviews）从
// server.js/pg.js 巨石拆出后，四组静态断言按新落点指向：
//   · 路由分支 → src/routes/admin-access.js；
//   · 域专属 SQL → src/store/admin-access-repository.js；pg.js 必须 re-export
//     （旧 db.* 导入签名不变），无 DDL 搬家（本域表跨域共用：中间件/拦截链/批量操作读写）；
//   · server.js 只留单入口接线（管理段），且必须真实调用——删掉调用即红（防死模块）；
//   · 旧分支不得残留在 server.js（防双实现）。
// 反向自检口径：删掉 routes/admin-access.js 任一路由分支 → 第 1 组断言红；
// 删掉 server.js 的入口接线 → 第 2 组红；把分支抄回 server.js → 第 3 组红；
// 删 pg.js re-export → 第 4 组红。

const AA_ROUTES = readFileSync(fileURLToPath(new URL('../src/routes/admin-access.js', import.meta.url)), 'utf8');
const AA_REPO = readFileSync(fileURLToPath(new URL('../src/store/admin-access-repository.js', import.meta.url)), 'utf8');
const AA_SERVER = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const AA_PG = readFileSync(fileURLToPath(new URL('../src/store/pg.js', import.meta.url)), 'utf8');

test('CO-5/B4-2 第八轮：admin-access 路由分支全部在 src/routes/admin-access.js（管理段单入口，删任一支即红）', () => {
  // views
  assert.match(AA_ROUTES, /path === '\/api\/admin\/views' && req\.method === 'GET'/, 'views 分支在新文件');
  // visitors 三条 + 详情正则
  assert.match(AA_ROUTES, /path === '\/api\/admin\/visitors' && req\.method === 'GET'/, 'visitors 列表分支在新文件');
  assert.match(AA_ROUTES, /path === '\/api\/admin\/visitors\/by-ip' && req\.method === 'GET'/, 'visitors/by-ip 分支在新文件');
  assert.match(AA_ROUTES, /const visitorIpMatch = path\.match\(\/\^\\\/api\\\/admin\\\/visitors\\\/by-ip\\\/\(\.\+\)\$\/\)/, 'visitors/by-ip/:ip 正则分支在新文件');
  // blacklist 三条
  assert.match(AA_ROUTES, /path === '\/api\/admin\/blacklist' && req\.method === 'GET'/, 'blacklist GET 分支在新文件');
  assert.match(AA_ROUTES, /path === '\/api\/admin\/blacklist' && req\.method === 'POST'/, 'blacklist POST 分支在新文件');
  assert.match(AA_ROUTES, /const unbanMatch = path\.match\(\/\^\\\/api\\\/admin\\\/blacklist\\\/\(\[\^\/\]\+\)\$\/\)/, 'blacklist DELETE 正则分支在新文件');
  // whitelist 三条
  assert.match(AA_ROUTES, /path === '\/api\/admin\/whitelist' && req\.method === 'GET'/, 'whitelist GET 分支在新文件');
  assert.match(AA_ROUTES, /path === '\/api\/admin\/whitelist' && req\.method === 'POST'/, 'whitelist POST 分支在新文件');
  assert.match(AA_ROUTES, /const wlMatch = path\.match\(\/\^\\\/api\\\/admin\\\/whitelist\\\/\(\[\^\/\]\+\)\$\/\)/, 'whitelist DELETE 正则分支在新文件');
  // abuse 两条
  assert.match(AA_ROUTES, /path === '\/api\/admin\/abuse' && req\.method === 'GET'/, 'abuse GET 分支在新文件');
  assert.match(AA_ROUTES, /const abuseUnban = path\.match\(\/\^\\\/api\\\/admin\\\/abuse\\\/\(\[\^\/\]\+\)\$\/\)/, 'abuse DELETE 正则分支在新文件');
  // devices 四条
  assert.match(AA_ROUTES, /path === '\/api\/admin\/devices' && req\.method === 'GET'/, 'devices 列表分支在新文件');
  assert.match(AA_ROUTES, /path === '\/api\/admin\/device-bans' && req\.method === 'GET'/, 'device-bans 列表分支在新文件');
  assert.match(AA_ROUTES, /path === '\/api\/admin\/devices\/ban' && req\.method === 'POST'/, 'devices/ban 分支在新文件');
  assert.match(AA_ROUTES, /const devBanMatch = path\.match\(\/\^\\\/api\\\/admin\\\/device-bans\\\/\(\[a-f0-9\]\{16,64\}\)\$\/\)/, 'device-bans/:fp DELETE 正则分支在新文件');
  // reviews 四条
  assert.match(AA_ROUTES, /path === '\/api\/admin\/reviews' && req\.method === 'GET'/, 'reviews GET 分支在新文件');
  assert.match(AA_ROUTES, /path === '\/api\/admin\/reviews\/approve' && req\.method === 'POST'/, 'reviews/approve 分支在新文件');
  assert.match(AA_ROUTES, /path === '\/api\/admin\/reviews\/reject' && req\.method === 'POST'/, 'reviews/reject 分支在新文件');
  assert.match(AA_ROUTES, /path === '\/api\/admin\/reviews\/act' && req\.method === 'POST'/, 'reviews/act 分支在新文件');
  // 单入口形态（§15.3 位置语义：管理段）
  assert.match(AA_ROUTES, /export async function handleAdminAccessAdmin\(ctx\)/, '管理段入口');
  // 守卫与校验随路由
  assert.match(AA_ROUTES, /if \(!requireAdmin\(\)\) return true/, '管理段守卫');
  assert.match(AA_ROUTES, /error: 'IP 格式不正确（支持 1\.2\.3\.4 单个 IP 或 1\.2\.3\.0\/24 网段）'/, '黑名单 IP 校验语义随路由');
  assert.match(AA_ROUTES, /error: 'fingerprint 不合法'/, '设备指纹校验语义随路由');
  assert.match(AA_ROUTES, /error: '审核记录不存在或已处理'/, '审核 404 语义随路由');
  assert.match(AA_ROUTES, /error: '该记录没有 IP，无法执行该操作'/, 'act 无 IP 400 语义随路由');
  assert.match(AA_ROUTES, /blacklistKept: true/, '解封只清 ip_abuse 不动黑名单语义随路由');
  assert.match(AA_ROUTES, /await banIpExclusive\(/, '互斥封禁/信任走 ctx.banIpExclusive 闭包（语义共享）');
  // 路由模块只做编排：不许出现 SQL 字面量（全部走 repository）
  assert.ok(!/select |insert |update |delete from /.test(AA_ROUTES), 'routes/admin-access.js 不写 SQL 字面量');
  // 已写响应必须 return true（防宿主二次写头 ERR_HTTP_HEADERS_SENT，watchlist 域拆分回归教训）
  assert.match(AA_ROUTES, /return false;/s, '未命中返回 false，宿主继续');
});

test('CO-5/B4-2 第八轮：server.js 必须真实接线管理段入口（删掉调用即红，防死模块）', () => {
  assert.match(AA_SERVER, /import \{ handleAdminAccessAdmin \} from '\.\/routes\/admin-access\.js'/, 'server.js 必须导入域路由入口');
  // 锁「完整调用形态」：必须是 if (await handleXxx(...)) return;——只断言字符串存在会被 if(false) 包一层绕过；
  // 这个形态锁住"调用且消费返回值结束响应"。
  assert.match(AA_SERVER, /if \(\s*await handleAdminAccessAdmin\(\{[\s\S]{0,900}?path,[\s\S]{0,900}?req,[\s\S]{0,900}?res,[\s\S]{0,900}?banIpExclusive,[\s\S]{0,400}?\}\)\s*\)\s*return;/, '管理段接线（完整形态，且消费返回值）');
  // 管理段 ctx 关键字段必须传齐：漏传 url 分页参数丢失、漏传 requireAdmin 守卫失效、
  // 漏传 user 审计落空、漏传 banIpExclusive 互斥口径与 #11 批量操作分家
  assert.match(AA_SERVER, /await handleAdminAccessAdmin\(\{[\s\S]{0,900}?url,/);
  assert.match(AA_SERVER, /await handleAdminAccessAdmin\(\{[\s\S]{0,900}?requireAdmin,/);
  assert.match(AA_SERVER, /await handleAdminAccessAdmin\(\{[\s\S]{0,900}?user,/);
  assert.match(AA_SERVER, /await handleAdminAccessAdmin\(\{[\s\S]{0,900}?banIpExclusive,/);
  // 位置语义锁：调用必须在 requireAdmin 就绪之后的管理段（banIpExclusive 定义之后、
  // 其它 admin 域路由之前——本域最早路由 views 的原位置）
  assert.match(AA_SERVER, /const banIpExclusive = \([^)]*\) => banIpExclusiveSql\(q, ip, note, kind, opts\)[\s\S]*?await handleAdminAccessAdmin\(\{/s, '接线在 banIpExclusive 定义之后（管理段）');
  assert.match(AA_SERVER, /await handleAdminAccessAdmin\(\{[\s\S]*?await handleAnnouncementsAdmin\(\{/s, '接线在本域原位置（公告管理段之前；users/images 段已随 B4 #11/#13 拆走）');
});

test('CO-5/B4-2 第八轮：admin-access 路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/path === '\/api\/admin\/views' && req\.method/.test(AA_SERVER), 'views 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/visitors' && req\.method/.test(AA_SERVER), 'visitors 分支不得残留在 server.js');
  assert.ok(!/const visitorIpMatch = path\.match/.test(AA_SERVER), 'visitors/by-ip 正则分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/blacklist' && req\.method/.test(AA_SERVER), 'blacklist 分支不得残留在 server.js');
  assert.ok(!/const unbanMatch = path\.match/.test(AA_SERVER), 'blacklist DELETE 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/whitelist' && req\.method/.test(AA_SERVER), 'whitelist 分支不得残留在 server.js');
  assert.ok(!/const wlMatch = path\.match/.test(AA_SERVER), 'whitelist DELETE 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/abuse' && req\.method/.test(AA_SERVER), 'abuse 分支不得残留在 server.js');
  assert.ok(!/const abuseUnban = path\.match/.test(AA_SERVER), 'abuse DELETE 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/devices' && req\.method/.test(AA_SERVER), 'devices 分支不得残留在 server.js');
  assert.ok(!/const devBanMatch = path\.match/.test(AA_SERVER), 'device-bans 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/reviews' && req\.method/.test(AA_SERVER), 'reviews 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/reviews\/approve' && req\.method/.test(AA_SERVER), 'reviews/approve 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/reviews\/reject' && req\.method/.test(AA_SERVER), 'reviews/reject 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/reviews\/act' && req\.method/.test(AA_SERVER), 'reviews/act 分支不得残留在 server.js');
  assert.ok(!/error: '临时封时长必须是 10 \/ 60 \/ 1440 分钟'/.test(AA_SERVER), 'act 校验文案不得残留在 server.js');
  // 边界锁：其它 admin 域路由（#11 users/#12 reports/#13 images 均已拆）；#10 mail/proxies
  // 已拆到 routes/admin-settings.js
  assert.match(AA_SERVER, /await handleAdminUsersAdmin\(\{/, 'admin users 段已拆到 routes/admin-users.js（B4 #11）');
  assert.match(AA_SERVER, /await handleAdminReportsAdmin\(\{/, 'admin reports 段已拆到 routes/admin-reports.js（B4 #12）');
  assert.match(AA_SERVER, /await handleAdminImagesAdmin\(\{/, 'admin images 段已拆到 routes/admin-images.js（B4 #13）');
  assert.match(AA_SERVER, /await handleAdminSettingsAdmin\(\{/, 'admin mail/proxies 段已拆到 routes/admin-settings.js（B4 #10）');
  // 中间件判据锁：banIpExclusiveSql 本体留 server.js（#11 批量操作共用，不随域搬走）
  assert.match(AA_SERVER, /async function banIpExclusiveSql\(q, ip, note, kind/, 'banIpExclusiveSql 留 server.js（#11 共用）');
});

test('CO-5/B4-2 第八轮：admin-access-repository.js 签名不变 + pg.js re-export（删 re-export 即红）', () => {
  // 搬家函数签名与拆分前一致（旧 db.* 导入签名不变）
  assert.match(AA_REPO, /export async function viewStats\(q, \{ limit = 20 \} = \{\}\)/, 'viewStats 签名与拆分前一致');
  assert.match(AA_REPO, /export function visitorOrderClause\(sort = 'time', order = 'desc'\)/, 'visitorOrderClause 签名与拆分前一致');
  assert.match(AA_REPO, /export async function listVisitorLogs\(q, \{ page = 1, pageSize = 50, ip = null, path = null, filter = 'visits', sort = 'time', order = 'desc', days = null \} = \{\}\)/, 'listVisitorLogs 签名与拆分前一致');
  assert.match(AA_REPO, /export async function visitorSummary\(q\)/, 'visitorSummary 签名与拆分前一致');
  assert.match(AA_REPO, /export async function listVisitorsByIp\(q, \{ days = 7, page = 1, pageSize = 20, q: kw = '', sort = 'visits', status = 'all' \} = \{\}\)/, 'listVisitorsByIp 签名与拆分前一致');
  assert.match(AA_REPO, /export async function visitorIpDetail\(q, \{ ip, days = 7 \} = \{\}\)/, 'visitorIpDetail 签名与拆分前一致');
  assert.match(AA_REPO, /export async function listWhitelist\(q\)/, 'listWhitelist 签名与拆分前一致');
  assert.match(AA_REPO, /export async function removeWhitelistIp\(q, ip\)/, 'removeWhitelistIp 签名与拆分前一致');
  assert.match(AA_REPO, /export async function listAbuse\(q, \{ limit = 50, status = 'active' \} = \{\}\)/, 'listAbuse 签名与拆分前一致');
  assert.match(AA_REPO, /export async function listDevices\(q, \{ limit = 50 \} = \{\}\)/, 'listDevices 签名与拆分前一致');
  assert.match(AA_REPO, /export async function listDeviceBans\(q, \{ limit = 100 \} = \{\}\)/, 'listDeviceBans 签名与拆分前一致');
  assert.match(AA_REPO, /export async function listAbuseReviews\(q, \{ status = 'pending', limit = 500 \} = \{\}\)/, 'listAbuseReviews 签名与拆分前一致');
  assert.match(AA_REPO, /export async function getAbuseReview\(q, id\)/, 'getAbuseReview 签名与拆分前一致');
  assert.match(AA_REPO, /export async function countPendingReviews\(q\)/, 'countPendingReviews 签名与拆分前一致');
  assert.match(AA_REPO, /export async function lastUaByIp\(q, ip\)/, 'lastUaByIp 签名与拆分前一致');
  // 域内联 SQL 抽出的四个新函数
  assert.match(AA_REPO, /export async function adminViewsGameMap\(q, \{ appids = \[\], ids = \[\] \}\)/, 'views 路径解析增强内联 SQL 已抽 adminViewsGameMap');
  assert.match(AA_REPO, /export async function ipAbuseBanRow\(q, ip\)/, '解封前 banned_until 内联 SQL 已抽 ipAbuseBanRow');
  assert.match(AA_REPO, /export async function applyManualTempBan\(q, \{ ip, until \}\)/, 'tempban 内联 SQL 已抽 applyManualTempBan');
  assert.match(AA_REPO, /export async function trustIpDb\(q, \{ ip, note \}\)/, 'trust 三条内联 SQL 已抽 trustIpDb');
  assert.match(AA_REPO, /'manual:temp'/, 'tempban 来源标记随 SQL 移入 repository');
  // 19 个函数必须整体 re-export（旧 db.* 导入签名不变；test 与 server.js 其它段照旧走聚合壳）
  assert.match(
    AA_PG,
    /export \{[\s\S]{0,800}viewStats[\s\S]{0,800}adminViewsGameMap[\s\S]{0,800}visitorOrderClause[\s\S]{0,800}listVisitorLogs[\s\S]{0,800}visitorSummary[\s\S]{0,800}listVisitorsByIp[\s\S]{0,800}visitorIpDetail[\s\S]{0,800}listWhitelist[\s\S]{0,800}removeWhitelistIp[\s\S]{0,800}listAbuse[\s\S]{0,800}ipAbuseBanRow[\s\S]{0,800}listDevices[\s\S]{0,800}listDeviceBans[\s\S]{0,800}listAbuseReviews[\s\S]{0,800}getAbuseReview[\s\S]{0,800}countPendingReviews[\s\S]{0,800}lastUaByIp[\s\S]{0,800}applyManualTempBan[\s\S]{0,800}trustIpDb[\s\S]{0,800}\} from '\.\/admin-access-repository\.js'/,
    'pg.js 必须 re-export 19 个函数',
  );
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(
    !/export (async )?function (viewStats|visitorOrderClause|listVisitorLogs|visitorSummary|listVisitorsByIp|visitorIpDetail|listWhitelist|removeWhitelistIp|listAbuse|listDevices|listDeviceBans|listAbuseReviews|getAbuseReview|countPendingReviews|lastUaByIp)/.test(AA_PG),
    'pg.js 不允许保留旧函数定义（只许 re-export）',
  );
  // 边界判据锁：跨域共用 SQL 与 DDL 留在 pg.js（中间件/拦截链/批量操作/申诉域共用）
  assert.match(AA_PG, /create table if not exists visitor_logs \(/, 'visitor_logs 表 DDL 留 pg.js');
  assert.match(AA_PG, /create table if not exists abuse_reviews \(/, 'abuse_reviews 表 DDL 留 pg.js');
  assert.match(AA_PG, /create table if not exists device_bans \(/, 'device_bans 表 DDL 留 pg.js');
  assert.match(AA_PG, /export async function insertVisitorLog\(q, \{/, 'insertVisitorLog 留 pg.js（中间件写访问日志）');
  assert.match(AA_PG, /export async function listBlockedIps\(q\)/, 'listBlockedIps 留 pg.js（visitors.js 拦截链共用）');
  assert.match(AA_PG, /export async function addBlockedIp\(q, \{ ip, note = null \}\)/, 'addBlockedIp 留 pg.js（banIpExclusiveSql 共用）');
  assert.match(AA_PG, /export async function removeBlockedIp\(q, ip\)/, 'removeBlockedIp 留 pg.js（申诉域共用）');
  assert.match(AA_PG, /export async function addWhitelistIp\(q, \{ ip, note = null \}\)/, 'addWhitelistIp 留 pg.js（banIpExclusiveSql 共用）');
  assert.match(AA_PG, /export async function upsertDeviceBan\(q, \{ fingerprint, deviceId = null, note = null, until = null \}\)/, 'upsertDeviceBan 留 pg.js（#11 批量封设备共用）');
  assert.match(AA_PG, /export async function removeDeviceBan\(q, fingerprint\)/, 'removeDeviceBan 留 pg.js（申诉域共用）');
  assert.match(AA_PG, /export async function finishAbuseReview\(q, id, \{ status, reviewedBy = null, note = null \}\)/, 'finishAbuseReview 留 pg.js（#11 批量审核共用）');
  assert.match(AA_PG, /export async function markReviewsAutoBanned\(q, \{ ip, note = '自动封禁' \}\)/, 'markReviewsAutoBanned 留 pg.js（拦截链共用）');
  // repository 不搬家 DDL
  assert.ok(!/create table/.test(AA_REPO), 'admin-access-repository.js 不搬家 DDL');
});


