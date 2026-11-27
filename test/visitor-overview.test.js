// FZ 批（docs/VISITORS-REDESIGN.md §2/§4/§7-2/§7-5）：访问记录重设计的后端契约。
// 守四件事：
//   ① 概览 6 个数字与「实际数据」一致，且「待审」按 IP 合并行计数（处置一个 IP → 减 1，规格 §7-6）；
//   ② by-ip / 明细两个视图的 status 口径一致：active（默认，排除黑名单+白名单）/ trusted（白名单派生）；
//   ③ 「临时封」留在有效访问里（规格 §1 决策 6），黑名单优先于临时封、白名单优先于临时封；
//   ④ 接口权限不变（匿名 401 / 普通用户 403 / 管理员 200），非法参数回落默认。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer, resetLoginThrottleForTest } from '../src/server.js';

process.env.CAPTCHA_ENABLED = '0';

const IP_ACTIVE = '203.0.113.31';
const IP_BLOCKED = '203.0.113.32';
const IP_TRUSTED = '203.0.113.33';
const IP_TEMP = '203.0.113.34';
const IP_CLEAN = '203.0.113.35';

async function setup() {
  resetLoginThrottleForTest();
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  const ins = (ip, path, { blocked = false, minutesAgo = 5 } = {}) =>
    q(
      `insert into visitor_logs (ip, path, method, status, blocked, region, created_at)
       values ($1, $2, 'GET', $3, $4, 'CN', now() - ($5::int * interval '1 minute'))`,
      [ip, path, blocked ? 403 : 200, blocked, minutesAgo],
    );
  await ins(IP_ACTIVE, '/a');
  await ins(IP_ACTIVE, '/b', { blocked: true });
  await ins(IP_BLOCKED, '/a');
  await ins(IP_TRUSTED, '/a');
  await ins(IP_TEMP, '/a');
  await ins(IP_CLEAN, '/a');
  // 黑名单 / 白名单 / 临时封 / 待审（两个 IP 各 2 条规则 = 3 行待审 + 1 行无 IP 设备待审）
  await q("insert into ip_blacklist (ip, note) values ($1, '手动封禁')", [IP_BLOCKED]);
  await q("insert into ip_whitelist (ip, note) values ($1, '信任')", [IP_TRUSTED]);
  await q("insert into ip_abuse (ip, strikes, banned_until, ban_source) values ($1, 1, now() + interval '30 minutes', 'rate')", [IP_TEMP]);
  const review = (ip, rule, hits) =>
    q(
      `insert into abuse_reviews (ip, rule, detail, path, hits, status, created_at, last_seen)
       values ($1, $2, 'x', '/a', $3, 'pending', now(), now())`,
      [ip, rule, hits],
    );
  await review(IP_ACTIVE, '漏洞路径探测', 12);
  await review(IP_ACTIVE, '异常 UA 名单', 3);
  await review(IP_BLOCKED, '漏洞路径探测', 7);
  await q("insert into abuse_reviews (fingerprint, rule, hits, status, created_at, last_seen) values ($1, '登录凭据爆破', 2, 'pending', now(), now())", ['a'.repeat(40)]);
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = async (username, password) => {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(res.status, 200, `登录 ${username}`);
    return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  };
  const admin = await login('admin', 'admin123456');
  const alice = await login('alice', 'alice123456');
  // 登录请求本身会写 visitor_logs（127.0.0.1），删掉保证数字确定
  await q("delete from visitor_logs where ip = '127.0.0.1'");
  return { store, q, srv, base, admin, alice };
}

const getJson = async (url, cookie) => {
  const res = await fetch(url, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('visitorOverview：一次查询返回 6 个数字（今日请求/被拦截/待审/临时封/黑名单/白名单）', async () => {
  const { store, q, srv } = await setup();
  try {
    const o = await db.visitorOverview(q);
    assert.equal(o.today_requests, 6, '今日请求 = 含被拦截的全部请求');
    assert.equal(o.today_blocked, 1, '被拦截 = blocked 请求数');
    assert.equal(o.pending_reviews, 3, '待审 = 按 IP 合并后的待审行数（2 个有 IP 的 + 1 个无 IP 行）');
    assert.equal(o.temp_bans, 1, '临时封 = banned_until 未到期的 ip_abuse 行');
    assert.equal(o.blacklist, 1, '黑名单条目数');
    assert.equal(o.whitelist, 1, '白名单条目数');
    // 过期临时封不计入
    await q("update ip_abuse set banned_until = now() - interval '1 minute'");
    assert.equal((await db.visitorOverview(q)).temp_bans, 0, '过期的临时封不计数');
    // 处置一个 IP 的待审（状态改掉）→ 待审行数减 1
    await q("update abuse_reviews set status = 'approved' where ip = $1", [IP_ACTIVE]);
    assert.equal((await db.visitorOverview(q)).pending_reviews, 2, '处置一个 IP 后待审行数减 1');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('GET /api/admin/visitors/overview：401/403/200 + 字段与 store 一致', async () => {
  const { store, q, srv, base, admin, alice } = await setup();
  try {
    assert.equal((await getJson(`${base}/api/admin/visitors/overview`)).status, 401, '匿名 401');
    assert.equal((await getJson(`${base}/api/admin/visitors/overview`, alice)).status, 403, '普通用户 403');
    const ok = await getJson(`${base}/api/admin/visitors/overview`, admin);
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys(ok.body).sort(), ['blacklist', 'pending_reviews', 'temp_bans', 'today_blocked', 'today_requests', 'whitelist'], '恰好 6 个数字，不多不少');
    assert.deepEqual(ok.body, await db.visitorOverview(q), '接口与 store 同口径');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('by-ip 状态口径：active 排除已封禁+已信任、保留临时封；trusted 由白名单派生', async () => {
  const { store, q, srv } = await setup();
  try {
    const all = (await db.listVisitorsByIp(q, { days: 7, status: 'all' })).rows;
    const byIp = new Map(all.map((r) => [r.ip, r.status]));
    assert.equal(byIp.get(IP_ACTIVE), 'intercepted', '有拦截采样 → 被拦截');
    assert.equal(byIp.get(IP_BLOCKED), 'blocked', '黑名单 → 已封禁');
    assert.equal(byIp.get(IP_TRUSTED), 'trusted', '白名单 → 已信任（新增派生）');
    assert.equal(byIp.get(IP_TEMP), 'banned', '临时封未到期 → 临时封');

    const active = await db.listVisitorsByIp(q, { days: 7, status: 'active' });
    const activeIps = active.rows.map((r) => r.ip).sort();
    assert.deepEqual(activeIps, [IP_ACTIVE, IP_TEMP, IP_CLEAN].sort(), '有效访问 = 未封禁 + 未信任；临时封保留');
    assert.equal(active.total, 3);

    assert.deepEqual((await db.listVisitorsByIp(q, { days: 7, status: 'trusted' })).rows.map((r) => r.ip), [IP_TRUSTED], '已信任可单独查历史');
    assert.deepEqual((await db.listVisitorsByIp(q, { days: 7, status: 'blocked' })).rows.map((r) => r.ip), [IP_BLOCKED], '已封禁可单独查历史');
    // 状态筛选非法的回落由路由负责；store 收到非法值等价于全不匹配（不抛错、不拼 SQL）
    assert.equal((await db.listVisitorsByIp(q, { days: 7, status: 'evil' })).total, 0, '非法状态不匹配任何行（无注入）');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('明细视图同口径：active / trusted / blocked / banned / normal 的 IP 集合与 by-ip 一致', async () => {
  const { store, q, srv } = await setup();
  try {
    const ipsFor = async (status) => {
      const r = await db.listVisitorLogs(q, { pageSize: 100, status });
      return [...new Set(r.rows.map((row) => row.ip))].sort();
    };
    assert.deepEqual(await ipsFor('active'), [IP_ACTIVE, IP_TEMP, IP_CLEAN].sort(), '明细 active 与 by-ip active 同集合');
    assert.deepEqual(await ipsFor('trusted'), [IP_TRUSTED], '明细 trusted');
    assert.deepEqual(await ipsFor('blocked'), [IP_BLOCKED], '明细 blocked');
    assert.deepEqual(await ipsFor('banned'), [IP_TEMP], '明细 banned');
    assert.deepEqual(await ipsFor('intercepted'), [IP_ACTIVE], '明细 intercepted（行级被拦截且非黑/白/临时封）');
    assert.deepEqual(await ipsFor('normal'), [IP_CLEAN], '明细 normal = 整个历史无拦截行的干净 IP（与 by-ip 同口径）');
    assert.equal((await db.listVisitorLogs(q, { pageSize: 100, status: 'all' })).total, 6, 'all 不过滤');
    // 旧 filter 参数（老书签）语义不变：visits = 未拦截行，blocked = 被拦截行
    const legacyVisits = await db.listVisitorLogs(q, { pageSize: 100, filter: 'visits' });
    assert.equal(legacyVisits.rows.every((row) => row.blocked === false), true, 'filter=visits 仍按行级未拦截');
    assert.equal((await db.listVisitorLogs(q, { pageSize: 100, filter: 'blocked' })).total, 1, 'filter=blocked 仍按行级被拦截');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('HTTP 明细接口：默认 active、非法 status 回落 active、旧 filter 仍可用', async () => {
  const { store, q, srv, base, admin } = await setup();
  try {
    const def = await getJson(`${base}/api/admin/visitors?days=7&pageSize=100`, admin);
    assert.equal(def.status, 200);
    assert.equal(def.body.status, 'active', '默认 active');
    assert.ok(!def.body.rows.some((r) => r.ip === IP_BLOCKED || r.ip === IP_TRUSTED), '默认不出现已封禁/已信任 IP');
    const evil = await getJson(`${base}/api/admin/visitors?status=evil`, admin);
    assert.equal(evil.body.status, 'active', '非法 status 回落 active');
    const trusted = await getJson(`${base}/api/admin/visitors?status=trusted`, admin);
    assert.ok(trusted.body.rows.length >= 1 && trusted.body.rows.every((r) => r.ip === IP_TRUSTED), 'status=trusted 可查历史');
    const legacy = await getJson(`${base}/api/admin/visitors?filter=blocked`, admin);
    assert.equal(legacy.body.status, 'blocked', '只传 filter 的老书签仍按旧口径（回显 filter 值）');
    assert.equal(legacy.body.rows.every((r) => r.blocked === true), true);
  } finally {
    await srv.close();
    await store.close();
  }
});
