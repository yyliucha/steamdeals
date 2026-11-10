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
  RATE_LIMIT_MAX: '1000',
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
  const { q, base, close } = await boot({ RATE_LIMIT_MAX: '2' });
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
  const { q, base, close } = await boot({ RATE_LIMIT_MAX: '2' });
  try {
    // 封禁期内再打 3 次就升一档，避免测试发几百个请求
    ratelimit.configure({ max: 2, windowSec: 60, blockedEscalate: 3 });
    const ip = '198.51.100.31';
    const hit = () => get(base, ip, '/');

    await hit();
    await hit();
    assert.equal((await hit()).status, 429, '第 3 次超限');
    let row = (await q('select strikes, banned_until from ip_abuse where ip = $1', [ip])).rows[0];
    assert.equal(row.strikes, 1);
    const firstMin = Math.round((new Date(row.banned_until).getTime() - Date.now()) / 60000);
    assert.ok(firstMin >= 9 && firstMin <= 10, '第一次应封约 10 分钟，实际 ' + firstMin);

    for (let i = 0; i < 3; i += 1) await hit();
    row = (await q('select strikes, banned_until from ip_abuse where ip = $1', [ip])).rows[0];
    assert.equal(row.strikes, 2);
    const secondMin = Math.round((new Date(row.banned_until).getTime() - Date.now()) / 60000);
    assert.ok(secondMin >= 29 && secondMin <= 30, '第二次应封约 30 分钟，实际 ' + secondMin);

    let third = null;
    for (let i = 0; i < 3; i += 1) third = await hit();
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
    for (let i = 0; i < 6; i += 1) await hit();
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
    ratelimit.configure({ max: 2, windowSec: 60, blockedEscalate: 3 });
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

    const approve = await fetch(base + '/api/admin/reviews/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ id: review.id, mode: 'ip' }),
    });
    assert.equal(approve.status, 200);
    assert.ok((await q("select count(*)::int as n from ip_blacklist where ip = '198.51.100.10'")).rows[0].n >= 1, '审批后应进黑名单');

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
  const { q, base, close } = await boot({ RATE_LIMIT_MAX: '1' });
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
  const { base, close } = await boot({ RATE_LIMIT_MAX: '3', RATE_LIMIT_ASSET_MAX: '100' });
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
  const { q, base, close } = await boot({ RATE_LIMIT_MAX: '2' });
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
    ratelimit.configure({ max: 2, windowSec: 60, blockedEscalate: 3 });

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
    ratelimit.configure({ max: 2, windowSec: 60, blockedEscalate: 3 });
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
  const { base, close } = await boot({ RATE_LIMIT_MAX: '1' });
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
  const { base, close } = await boot({ RATE_LIMIT_MAX: '1' });
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

test('BAN_ONLY_PAGES 遍历：未封禁一律 302；被封禁时 /banned* 403、/appeal* 200', async () => {
  const { base, close } = await boot({}, { admin: true, frontendDir: banFrontDir() });
  try {
    const cookie = await loginAdmin(base);
    const victim = '198.51.100.80';
    const bystander = '198.51.100.81';
    const pages = [...BAN_ONLY_PAGES];
    assert.ok(pages.length >= 5, '注册表至少包含 /banned、/banned.html 与 /appeal 三组');

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

    // 被封禁：/banned* 由拦截链给 403 封禁页；/appeal* 豁免拦截链、可见（守卫不拦被封禁者）
    for (const p of pages) {
      const res = await fetch(base + p, { headers: { 'x-forwarded-for': victim, accept: 'text/html' } });
      if (p.startsWith('/appeal')) {
        assert.equal(res.status, 200, `被封禁 ${p} 应可见（申诉入口）`);
      } else {
        assert.equal(res.status, 403, `被封禁 ${p} 应给封禁页`);
      }
    }
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
    assert.deepEqual(free.body, { banned: false });

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

    // 白名单视为未封禁（互斥后同 IP 不会再两边都在）
    await fetch(base + '/api/admin/whitelist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ ip: trustIp }),
    });
    const trusted = await banState(base, trustIp);
    assert.deepEqual(trusted.body, { banned: false }, '白名单视为未封禁');
  } finally {
    await close();
  }
});

test('/api/ban/state：设备与频率封禁类型', async () => {
  const { q, base, close } = await boot({ RATE_LIMIT_MAX: '1' }, { admin: true });
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
