// 后台批量操作（docs/ADMIN-BULK-ACTIONS.md）：统一入口 / 键校验 / 单次上限 / 高危确认 /
// 内存态同步 / 用户守卫 / 审计。用真 PGlite + 真 HTTP（与 test/reviews.test.js 同一套 boot 写法），
// 不 mock 业务层 —— 批量接口最容易出的问题就是"库里改了、内存没改"，只有真跑才测得出来。
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import * as ratelimit from '../src/ratelimit.js';
import * as guard from '../src/guard.js';
import * as devices from '../src/devices.js';

const WEB = fileURLToPath(new URL('../web', import.meta.url));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

process.env.TRUST_PROXY = '1'; // 用 X-Forwarded-For 模拟公网客户端
process.env.CAPTCHA_ENABLED = '0';
process.env.RATE_LIMIT_ENABLED = '1';
process.env.RATE_LIMIT_MAX = '1000';
process.env.RATE_LIMIT_ASSET_MAX = '1000';
process.env.RATE_LIMIT_WINDOW_SEC = '60';
process.env.PATH_REVIEW_ENABLED = '0'; // 本文件只测批量接口，不测路径审核

// 管理员请求固定用这个出口 IP：测试里会封很多 203.0.113.x，别把自己也封了
const ADMIN_IP = '198.18.0.9';

async function boot() {
  ratelimit.resetState();
  guard.resetState();
  devices.resetState();
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const admin = await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({
    query: q,
    outDir: WEB,
    port: 0,
    host: '127.0.0.1',
    getSetupState: async () => ({ completed: true }),
    imageFetch: async () => ({ body: PNG, bytes: PNG.length, contentType: 'image/png' }),
  });
  return {
    q,
    admin,
    base: `http://127.0.0.1:${srv.port}`,
    close: async () => {
      await srv.close();
      await store.close();
    },
  };
}

async function login(base, username, password) {
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ADMIN_IP },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `${username} 登录失败`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

/** 一次批量请求（cookie 为空表示匿名/非管理员）。 */
function bulk(base, cookie, payload, ip = ADMIN_IP) {
  return fetch(base + '/api/admin/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(payload),
  });
}

const adminGet = (base, cookie, path) =>
  fetch(base + path, { headers: { 'x-forwarded-for': ADMIN_IP, cookie } });

test('前端：11 个列表都接入了多选与批量工具条', () => {
  const modules = readFileSync(fileURLToPath(new URL('../frontend/src/pages/AdminModules.vue', import.meta.url)), 'utf8');
  const extras = readFileSync(fileURLToPath(new URL('../frontend/src/pages/AdminExtras.vue', import.meta.url)), 'utf8');
  const consoleVue = readFileSync(fileURLToPath(new URL('../frontend/src/pages/Console.vue', import.meta.url)), 'utf8');
  const count = (text, needle) => text.split(needle).length - 1;

  // 10 个表格列表有勾选列：游戏目录/访问明细/待审/最近设备/已封设备/黑名单/白名单/自动封禁 + 回收站/用户
  assert.equal(count(modules, 'type="selection"'), 8, 'AdminModules 应有 8 个勾选列');
  assert.equal(count(extras, 'type="selection"'), 2, 'AdminExtras 应有 2 个勾选列');
  // 第 11 个是站点通知：卡片列表没有表格，用 el-checkbox 勾选
  assert.match(modules, /sel\.announcements\.has\(a\)/, '站点通知卡片要有勾选框');
  // 每个列表都要有工具条（AdminModules 9 个 + AdminExtras 2 个）
  assert.equal(count(modules, '<BulkBar'), 9, 'AdminModules 应有 9 个批量工具条');
  assert.equal(count(extras, '<BulkBar'), 2, 'AdminExtras 应有 2 个批量工具条');
  // 翻页清空：服务端分页靠 load 清、客户端分页靠 watch 页码清
  assert.match(modules, /sel\.reviews\.clear\(\)/, '翻页应清空选择');
  // 审计页入口在「系统」下
  assert.match(consoleVue, /id:'bulk-ops'/, 'Console 侧栏要有「批量操作记录」');
  assert.match(consoleVue, /'bulk-ops'/, 'bulk-ops 必须登记为原生 section');
});

test('鉴权：匿名 401、普通用户 403，且都没有副作用', async () => {
  const { q, base, close } = await boot();
  try {
    const anon = await bulk(base, '', { target: 'blacklist', action: 'unban', keys: ['1.2.3.4'] });
    assert.equal(anon.status, 401);
    await db.createUser(q, { username: 'bob', password: 'bob12345678', role: 'user' });
    const bobCookie = await login(base, 'bob', 'bob12345678');
    const normal = await bulk(base, bobCookie, { target: 'blacklist', action: 'unban', keys: ['1.2.3.4'] });
    assert.equal(normal.status, 403);
    assert.equal((await q('select count(*)::int as n from admin_bulk_ops')).rows[0].n, 0, '被拒绝的请求不写审计表');
  } finally {
    await close();
  }
});

test('参数：未知组合 / 空 keys / 非法键 / 超上限都整单 400，库里零变化', async () => {
  const { q, base, close } = await boot();
  try {
    const cookie = await login(base, 'admin', 'admin123456');

    const unknown = await bulk(base, cookie, { target: 'nope', action: 'x', keys: ['1'] });
    assert.equal(unknown.status, 400);
    assert.match((await unknown.json()).error, /不支持/);

    const empty = await bulk(base, cookie, { target: 'blacklist', action: 'unban', keys: [] });
    assert.equal(empty.status, 400);

    const notArray = await bulk(base, cookie, { target: 'blacklist', action: 'unban', keys: '1.2.3.4' });
    assert.equal(notArray.status, 400);

    // 一条非法键就整单拒绝（不能"跳过坏的、执行好的"）
    const badKey = await bulk(base, cookie, { target: 'blacklist', action: 'unban', keys: ['1.2.3.4', 'not-an-ip'] });
    assert.equal(badKey.status, 400);
    assert.match((await badKey.json()).error, /IP 格式/);

    // 51 个 IP 超过「封 IP」的 50 上限
    const many = Array.from({ length: 51 }, (_, i) => `203.0.113.${i + 1}`);
    const over = await bulk(base, cookie, { target: 'visitors', action: 'ban-ip', keys: many, confirmCount: 51 });
    assert.equal(over.status, 400);
    assert.match((await over.json()).error, /单次最多 50 条/);

    assert.equal((await q('select count(*)::int as n from ip_blacklist')).rows[0].n, 0, '被拒绝的请求不能改库');
    assert.equal((await q('select count(*)::int as n from admin_bulk_ops')).rows[0].n, 0, '被拒绝的请求不写审计表');
  } finally {
    await close();
  }
});

test('高危确认：缺 confirmCount / 数量不符都 400，填对才执行 50 条', async () => {
  const { q, base, close } = await boot();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const ips = Array.from({ length: 50 }, (_, i) => `203.0.114.${i + 1}`);

    const missing = await bulk(base, cookie, { target: 'visitors', action: 'ban-ip', keys: ips });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /确认条数/);

    const wrong = await bulk(base, cookie, { target: 'visitors', action: 'ban-ip', keys: ips, confirmCount: 49 });
    assert.equal(wrong.status, 400);

    const ok = await bulk(base, cookie, { target: 'visitors', action: 'ban-ip', keys: ips, confirmCount: 50 });
    assert.equal(ok.status, 200);
    const data = await ok.json();
    assert.equal(data.ok, 50);
    assert.equal(data.total, 50);
    assert.equal(data.failed, 0);
    assert.ok(data.opId > 0, '应返回审计记录 id');
    assert.equal((await q('select count(*)::int as n from ip_blacklist')).rows[0].n, 50);
  } finally {
    await close();
  }
});

test('批量解封黑名单：一次请求清 3 条，且内存黑名单同步刷新（再访问恢复 200）', async () => {
  const { q, base, close } = await boot();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const ips = ['203.0.115.11', '203.0.115.12', '203.0.115.13'];
    for (const ip of ips) {
      const res = await fetch(base + '/api/admin/blacklist', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ADMIN_IP, cookie },
        body: JSON.stringify({ ip, note: '测试封禁' }),
      });
      assert.equal(res.status, 200);
    }
    for (const ip of ips) {
      const blocked = await fetch(base + '/', { headers: { 'x-forwarded-for': ip } });
      assert.equal(blocked.status, 403, `${ip} 封禁后应被拦`);
    }

    const res = await bulk(base, cookie, { target: 'blacklist', action: 'unban', keys: ips });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, 3);
    assert.equal(data.skipped, 0);
    assert.equal((await q('select count(*)::int as n from ip_blacklist')).rows[0].n, 0);

    // 关键：内存里的黑名单也要跟着刷新，否则库里删了、拦截仍然按旧表走
    for (const ip of ips) {
      const after = await fetch(base + '/', { headers: { 'x-forwarded-for': ip } });
      assert.equal(after.status, 200, `${ip} 解封后应恢复访问`);
    }

    // 幂等：再解一次变成 skipped，不虚报成功
    const again = await bulk(base, cookie, { target: 'blacklist', action: 'unban', keys: ips });
    const againData = await again.json();
    assert.equal(againData.ok, 0);
    assert.equal(againData.skipped, 3);
  } finally {
    await close();
  }
});

test('批量忽略待审：3 条 pending 变 rejected，待审计数同步下降', async () => {
  const { q, base, close } = await boot();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      const row = await db.recordAbuseReview(q, { ip: `203.0.116.${i + 1}`, rule: 'unknown-paths' });
      ids.push(row.id);
    }
    assert.equal((await db.countPendingReviews(q)), 3);

    const res = await bulk(base, cookie, { target: 'reviews', action: 'reject', keys: ids });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, 3);
    assert.equal((await q("select count(*)::int as n from abuse_reviews where status = 'rejected'")).rows[0].n, 3);
    assert.equal((await db.countPendingReviews(q)), 0);
  } finally {
    await close();
  }
});

test('公告批量删除：混入不存在的 id → ok=2 skipped=1，明细带原因', async () => {
  const { q, base, close } = await boot();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const a1 = await db.createAnnouncement(q, { title: '批量A', body: '正文' });
    const a2 = await db.createAnnouncement(q, { title: '批量B', body: '正文' });
    await db.createAnnouncement(q, { title: '保留C', body: '正文' });

    const res = await bulk(base, cookie, {
      target: 'announcements',
      action: 'delete',
      keys: [a1.id, a2.id, 999999],
      confirmCount: 3,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.total, 3);
    assert.equal(data.ok, 2);
    assert.equal(data.skipped, 1);
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].key, '999999');
    assert.equal(data.results[0].status, 'skipped');
    assert.ok(data.results[0].reason, '跳过要带原因');
    assert.equal((await q('select count(*)::int as n from announcements')).rows[0].n, 1, '另外两条要真的删掉');
  } finally {
    await close();
  }
});

test('用户批量禁用：不能禁用自己 / 不能禁用最后一个管理员，正常禁用会踢会话', async () => {
  const { q, base, admin, close } = await boot();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const admin2 = await db.createUser(q, { username: 'admin2', password: 'admin2pass123', role: 'admin' });
    const bob = await db.createUser(q, { username: 'bob', password: 'bob12345678', role: 'user' });

    // 勾到自己 → 409
    const self = await bulk(base, cookie, { target: 'users', action: 'disable', keys: [admin.id], confirmCount: 1 });
    assert.equal(self.status, 409);
    assert.match((await self.json()).error, /自己/);

    // 勾掉全部可用管理员 → 409（把 admin 和 admin2 都禁掉就没人能管后台了）
    const lastAdmin = await bulk(base, cookie, {
      target: 'users',
      action: 'disable',
      keys: [admin.id, admin2.id],
      confirmCount: 2,
    });
    assert.equal(lastAdmin.status, 409);
    assert.match((await lastAdmin.json()).error, /最后一个/);

    // 普通用户可以禁用，且其会话立即失效
    const bobCookie = await login(base, 'bob', 'bob12345678');
    const meBefore = await (await fetch(base + '/api/me', { headers: { cookie: bobCookie, 'x-forwarded-for': ADMIN_IP } })).json();
    assert.equal(meBefore.user?.username, 'bob', '禁用前会话应有效');
    const res = await bulk(base, cookie, { target: 'users', action: 'disable', keys: [bob.id], confirmCount: 1 });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, 1);
    assert.equal((await q('select disabled from users where id = $1', [bob.id])).rows[0].disabled, true);
    const meAfter = await (await fetch(base + '/api/me', { headers: { cookie: bobCookie, 'x-forwarded-for': ADMIN_IP } })).json();
    assert.equal(meAfter.user, null, '禁用后旧会话必须失效（会话行已删）');

    // 启用回来（低危，不需要 confirmCount）
    const enable = await bulk(base, cookie, { target: 'users', action: 'enable', keys: [bob.id] });
    assert.equal(enable.status, 200);
    assert.equal((await enable.json()).ok, 1);
    assert.equal((await q('select disabled from users where id = $1', [bob.id])).rows[0].disabled, false);
  } finally {
    await close();
  }
});

test('设备批量封禁/解封：列表出现 2 条，对应设备请求 403，解封后恢复', async () => {
  const { q, base, close } = await boot();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const details = { platform: 'Win32', vendor: 'Google Inc.', timezone: 'Asia/Shanghai', language: 'zh-CN', screen: [1920, 1080, 24], hc: 8, dm: 0, touch: false, webglVendor: 'v', webglRenderer: 'r', canvas: 'c', audio: 'a', fonts: 'f' };
    // 服务端先用 sanitizeDetails 收敛字段再算指纹，测试必须走同一条路径，否则封的指纹和请求对不上
    const fingerprint = devices.fingerprintOf(devices.sanitizeDetails(details));
    const other = randomBytes(32).toString('hex');

    const before = await fetch(base + '/api/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.117.5' },
      body: JSON.stringify({ deviceId: 'dev-bulk-test', details }),
    });
    assert.equal(before.status, 200, '未封禁时设备接口应放行');

    const res = await bulk(base, cookie, {
      target: 'devices',
      action: 'ban',
      keys: [fingerprint, other],
      options: { minutes: 60 },
      confirmCount: 2,
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, 2);
    assert.equal((await q('select count(*)::int as n from device_bans')).rows[0].n, 2);
    assert.equal((await q('select count(*)::int as n from device_bans where until is not null')).rows[0].n, 2, '传 minutes 应写入到期时间');

    const banned = await fetch(base + '/api/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.117.6' },
      body: JSON.stringify({ deviceId: 'dev-bulk-test', details }),
    });
    assert.equal(banned.status, 403, '换 IP 也要命中设备封禁');

    const unban = await bulk(base, cookie, { target: 'device-bans', action: 'unban', keys: [fingerprint, other] });
    assert.equal(unban.status, 200);
    assert.equal((await unban.json()).ok, 2);
    const after = await fetch(base + '/api/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.117.7' },
      body: JSON.stringify({ deviceId: 'dev-bulk-test', details }),
    });
    assert.equal(after.status, 200, '解封后设备应恢复（内存封禁表已刷新）');
  } finally {
    await close();
  }
});

test('游戏目录批量删除 / 恢复：内部 id 为键，重复恢复记 skipped', async () => {
  const { q, base, close } = await boot();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const ids = [];
    for (const appid of [910001, 910002, 910003]) {
      await db.ensureGame(q, { steamAppid: appid, name: `批量游戏 ${appid}` });
      ids.push((await q('select id from games where steam_appid = $1', [appid])).rows[0].id);
    }

    const del = await bulk(base, cookie, { target: 'games', action: 'delete', keys: ids, confirmCount: 3 });
    assert.equal(del.status, 200);
    assert.equal((await del.json()).ok, 3);
    assert.equal((await q('select count(*)::int as n from games where deleted')).rows[0].n, 3);

    const restore = await bulk(base, cookie, { target: 'games', action: 'restore', keys: ids });
    const restoreData = await restore.json();
    assert.equal(restoreData.ok, 3);
    assert.equal((await q('select count(*)::int as n from games where deleted')).rows[0].n, 0);

    const again = await bulk(base, cookie, { target: 'games', action: 'restore', keys: ids });
    const againData = await again.json();
    assert.equal(againData.ok, 0);
    assert.equal(againData.skipped, 3);
  } finally {
    await close();
  }
});

test('审计：批量操作落库，列表接口与详情接口都能查到（含键样本）', async () => {
  const { q, base, close } = await boot();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const ips = ['203.0.118.1', '203.0.118.2'];
    const res = await bulk(base, cookie, { target: 'visitors', action: 'ban-ip', keys: ips, confirmCount: 2 });
    const data = await res.json();

    const listRes = await adminGet(base, cookie, '/api/admin/bulk-ops?limit=10');
    assert.equal(listRes.status, 200);
    const { ops } = await listRes.json();
    assert.equal(ops.length, 1, '应有一条审计记录');
    assert.equal(ops[0].id, data.opId);
    assert.equal(ops[0].actor, 'admin');
    assert.equal(ops[0].target, 'visitors');
    assert.equal(ops[0].action, 'ban-ip');
    assert.equal(ops[0].total, 2);
    assert.equal(ops[0].ok, 2);

    const detailRes = await adminGet(base, cookie, `/api/admin/bulk-ops/${data.opId}`);
    assert.equal(detailRes.status, 200);
    const { op } = await detailRes.json();
    assert.deepEqual(op.keys_sample.sort(), [...ips].sort());

    // 普通用户不能看审计
    await db.createUser(q, { username: 'carol', password: 'carol12345678', role: 'user' });
    const carolCookie = await login(base, 'carol', 'carol12345678');
    assert.equal((await adminGet(base, carolCookie, '/api/admin/bulk-ops')).status, 403);
  } finally {
    await close();
  }
});

test('键规范化与去重：IP 大小写 / 重复行只算一条，实际执行与返回一致', async () => {
  const { q, base, close } = await boot();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    // 同一个 IP 写三种形式（重复 + 大写 IPv6），应只执行一次
    const keys = ['203.0.119.7', '203.0.119.7', '2001:DB8::1', '2001:db8::1'];
    const res = await bulk(base, cookie, { target: 'visitors', action: 'ban-ip', keys, confirmCount: 2 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.total, 2, '去重后应为 2 条');
    assert.equal(data.ok, 2);
    assert.equal((await q('select count(*)::int as n from ip_blacklist')).rows[0].n, 2);
    assert.ok(
      (await q("select 1 from ip_blacklist where ip = '2001:db8::1'")).rows.length,
      'IPv6 应规范成小写',
    );
  } finally {
    await close();
  }
});
