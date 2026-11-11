// BH 批（docs/VISIT-IP-STATS.md §3/§4）：访问明细 IP 统计视图（时间窗/排序白名单/展开行）、
// 黑白名单统计列（近 7 天访问/最近访问/设备数）、设备按 device_id 聚合（无设备码回退指纹）、前端接线。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer, resetLoginThrottleForTest } from '../src/server.js';

process.env.CAPTCHA_ENABLED = '0';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const IP_A = '203.0.113.10';
const IP_B = '198.51.100.20';
const IP_C = '10.0.0.5';

async function setup() {
  resetLoginThrottleForTest();
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  // 访问日志：A 近 2 天 3 条（含 1 条拦截，2 个路径），B 10 天前 2 条（7 天窗看不到、30 天可见），C 1 条
  const ins = (ip, path, { daysAgo = 0, blocked = false, region = null, status = 200 } = {}) =>
    q(
      `insert into visitor_logs (ip, path, method, status, blocked, region, created_at)
       values ($1, $2, 'GET', $3, $4, $5, now() - ($6::int * interval '1 day'))`,
      [ip, path, status, blocked, region, daysAgo],
    );
  await ins(IP_A, '/a', { region: 'CN', daysAgo: 1 });
  await ins(IP_A, '/b', { region: 'CN', daysAgo: 0, status: 403, blocked: true });
  await ins(IP_A, '/a', { region: 'CN', daysAgo: 2 });
  await ins(IP_B, '/x', { daysAgo: 10 });
  await ins(IP_B, '/y', { daysAgo: 10 });
  await ins(IP_C, '/z', { daysAgo: 0 });
  // 设备：A 两台（device_id d1/d2）+ 一台无设备码；B 有设备码
  await q("insert into device_logs (ip, device_id, fingerprint, user_agent) values ($1, 'd1', 'fp1', 'UA1')", [IP_A]);
  await q("insert into device_logs (ip, device_id, fingerprint, user_agent) values ($1, 'd2', 'fp2', 'UA2')", [IP_A]);
  await q("insert into device_logs (ip, device_id, fingerprint, user_agent) values ($1, null, 'fpnull', 'UA3')", [IP_A]);
  await q("insert into device_logs (ip, device_id, fingerprint, user_agent) values ($1, 'd3', 'fp3', 'UA4')", [IP_B]);
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
  // 登录请求本身会写 visitor_logs（127.0.0.1）；删掉，保证统计断言确定
  await q("delete from visitor_logs where ip = '127.0.0.1'");
  return { store, q, srv, base, admin, alice };
}

const getJson = async (url, cookie) => {
  const res = await fetch(url, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('listVisitorsByIp：时间窗内每 IP 一行（次数/首次→最近/路径数/设备数/地区/状态）', async () => {
  const { store, q, srv } = await setup();
  try {
    const { rows, total } = await db.listVisitorsByIp(q, { days: 7, pageSize: 20 });
    assert.equal(total, 2, '近 7 天有 2 个 IP（A/C；B 在 10 天前）');
    const a = rows.find((r) => r.ip === IP_A);
    assert.equal(a.visits, 3);
    assert.equal(a.paths, 2, '/a 与 /b');
    assert.equal(a.devices, 3, 'device_id d1/d2 + 无设备码 fpnull');
    assert.equal(a.region, 'CN', '最近一条日志的地区');
    assert.equal(a.status, 'intercepted', '时间窗内有拦截但不是黑名单');
    assert.ok(a.first_at && a.last_at && Date.parse(a.first_at) <= Date.parse(a.last_at));
    // 10 天前的 IP 在 7 天窗不出现，30 天窗出现
    assert.ok(!rows.some((r) => r.ip === IP_B));
    const wide = await db.listVisitorsByIp(q, { days: 30, pageSize: 20 });
    assert.equal(wide.total, 3, '30 天含 10 天前的 B');
    assert.equal(wide.rows.find((r) => r.ip === IP_B).visits, 2);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('listVisitorsByIp：已封禁状态、关键词、分页与三种排序', async () => {
  const { store, q, srv } = await setup();
  try {
    await q("insert into ip_blacklist (ip, note) values ($1, '测试')", [IP_A]);
    let r = await db.listVisitorsByIp(q, { days: 7 });
    assert.equal(r.rows.find((x) => x.ip === IP_A).status, 'blocked', '黑名单 → 已封禁');
    r = await db.listVisitorsByIp(q, { days: 7, q: '203.0.113' });
    assert.equal(r.total, 1, 'IP 关键词筛选');
    // 排序：visits desc（默认）→ A(3) 在前；ip 排序把 10.x 排最前
    r = await db.listVisitorsByIp(q, { days: 7, sort: 'ip' });
    assert.equal(r.rows[0].ip, IP_C, 'IP 数值序：10.0.0.5 最小');
    r = await db.listVisitorsByIp(q, { days: 7, sort: 'lastAt' });
    assert.ok(r.rows.length > 0);
    r = await db.listVisitorsByIp(q, { days: 7, pageSize: 2, page: 2 });
    assert.equal(r.rows.length, 0, '分页：2 个 IP、每页 2 → 第 2 页 0 条');
    assert.equal(r.total, 2);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('visitorIpDetail：最近 20 条访问（倒序）+ 路径 top 5', async () => {
  const { store, q, srv } = await setup();
  try {
    const d = await db.visitorIpDetail(q, { ip: IP_A, days: 7 });
    assert.equal(d.recent.length, 3);
    assert.ok(Date.parse(d.recent[0].created_at) >= Date.parse(d.recent[1].created_at), '倒序');
    assert.deepEqual(d.topPaths.map((p) => p.path), ['/a', '/b'], '按次数倒序');
    assert.equal(d.topPaths[0].n, 2);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('GET /api/admin/visitors/by-ip：401/403/200；days 与 sort 白名单回落；返回 items/total', async () => {
  const { store, q, srv, base, admin, alice } = await setup();
  try {
    assert.equal((await getJson(`${base}/api/admin/visitors/by-ip`)).status, 401, '匿名 401');
    assert.equal((await getJson(`${base}/api/admin/visitors/by-ip`, alice)).status, 403, '普通用户 403');
    const ok = await getJson(`${base}/api/admin/visitors/by-ip?days=7&page=1&pageSize=20`, admin);
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.body.items) && ok.body.items.length > 0, 'items');
    assert.ok(ok.body.total >= 2);
    assert.equal(ok.body.sort, 'visits');
    assert.equal(ok.body.status, 'all', '默认状态 = 全部');
    const weird = await getJson(`${base}/api/admin/visitors/by-ip?days=999&sort=evil&status=evil`, admin);
    assert.equal(weird.body.days, 7, 'days 非法回落 7');
    assert.equal(weird.body.sort, 'visits', 'sort 非法回落默认');
    assert.equal(weird.body.status, 'all', 'status 非法回落 all');
    // BI 批：status 筛选（自动封禁中的 IP 只出现在 banned）
    await q("insert into ip_abuse (ip, strikes, banned_until, ban_source) values ($1, 1, now() + interval '10 minutes', 'rate')", [IP_A]);
    const bannedOnly = await getJson(`${base}/api/admin/visitors/by-ip?days=7&status=banned`, admin);
    assert.deepEqual(bannedOnly.body.items.map((r) => r.ip), [IP_A], 'banned 只返回自动封禁中的 IP');
    const interceptedOnly = await getJson(`${base}/api/admin/visitors/by-ip?days=7&status=intercepted`, admin);
    assert.ok(!interceptedOnly.body.items.some((r) => r.ip === IP_A), '封禁中的不算被拦截');
    // 明细视图同样受时间窗约束（接受「切回明细后过滤/分页与原来一致」+ 时间窗绑定两视图）
    const d7 = await getJson(`${base}/api/admin/visitors?days=7&pageSize=100&filter=all`, admin);
    assert.equal(d7.status, 200);
    assert.ok(!d7.body.rows.some((r) => r.ip === IP_B), '明细 7 天不含 10 天前的记录');
    const d30 = await getJson(`${base}/api/admin/visitors?days=30&pageSize=100&filter=all`, admin);
    assert.ok(d30.body.rows.some((r) => r.ip === IP_B), '明细 30 天包含 10 天前的记录');
    const detail = await getJson(`${base}/api/admin/visitors/by-ip/${IP_A}?days=7`, admin);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.recent.length, 3);
    assert.equal(detail.body.ip, IP_A);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('BI：自动临时封禁「封禁中」/ 黑名单优先「已封禁」/ 过期回落「被拦截」', async () => {
  const { store, q, srv } = await setup();
  try {
    // A：自动封禁中（未过期）
    await q("insert into ip_abuse (ip, strikes, banned_until, ban_source) values ($1, 1, now() + interval '10 minutes', 'rate')", [IP_A]);
    let rows = (await db.listVisitorsByIp(q, { days: 7 })).rows;
    const a = rows.find((r) => r.ip === IP_A);
    assert.equal(a.status, 'banned', '自动封禁中 → banned');
    assert.ok(a.ban_until, '返回封禁到期时间');
    assert.equal(a.ban_source, 'rate', '返回封禁来源');
    assert.equal((await db.listVisitorsByIp(q, { days: 7, status: 'banned' })).total, 1);
    // 手动黑名单优先
    await q('insert into ip_blacklist (ip) values ($1)', [IP_A]);
    rows = (await db.listVisitorsByIp(q, { days: 7, status: 'blocked' })).rows;
    assert.equal(rows[0].ip, IP_A);
    assert.equal(rows[0].status, 'blocked', '黑名单优先于自动封禁');
    assert.equal((await db.listVisitorsByIp(q, { days: 7, status: 'banned' })).total, 0, '已有黑名单的不再算封禁中');
    // 清黑名单 + 封禁过期 → 回落「被拦截」（A 有 blocked 采样行）
    await q('delete from ip_blacklist where ip = $1', [IP_A]);
    await q("update ip_abuse set banned_until = now() - interval '1 minute' where ip = $1", [IP_A]);
    rows = (await db.listVisitorsByIp(q, { days: 7 })).rows;
    const expired = rows.find((r) => r.ip === IP_A);
    assert.equal(expired.status, 'intercepted', '过期回落被拦截');
    assert.equal(expired.ban_until, null, '过期后不返回到期时间');
    // 正常状态
    assert.ok((await db.listVisitorsByIp(q, { days: 7, status: 'normal' })).rows.some((r) => r.ip === IP_C));
  } finally {
    await srv.close();
    await store.close();
  }
});

test('黑白名单列表：近 7 天访问次数 / 最近访问 / 设备数', async () => {
  const { store, q, srv, base, admin } = await setup();
  try {
    await q("insert into ip_blacklist (ip, note) values ($1, '屏蔽')", [IP_A]);
    await q("insert into ip_whitelist (ip, note) values ($1, '信任')", [IP_B]);
    const bl = await getJson(`${base}/api/admin/blacklist`, admin);
    const row = bl.body.ips.find((x) => x.ip === IP_A);
    assert.equal(row.visits, 3, '近 7 天访问次数');
    assert.ok(row.last_at, '最近访问');
    assert.equal(row.devices, 3, '设备数');
    const wl = await getJson(`${base}/api/admin/whitelist`, admin);
    const wrow = wl.body.ips.find((x) => x.ip === IP_B);
    assert.equal(wrow.visits, 0, '10 天前的访问不在近 7 天');
    assert.equal(wrow.last_at, null);
    assert.equal(wrow.devices, 1, '设备记录不按访问时间窗过滤（d3 是刚才写入的）');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('listDevices：按 device_id 聚合（多 IP/UA），无设备码回退指纹；banned 按指纹', async () => {
  const { store, q, srv } = await setup();
  try {
    // 同一 device_id d1 的多条记录（不同 IP/UA）合并一行
    await q("insert into device_logs (ip, device_id, fingerprint, user_agent) values ($1, 'd1', 'fp1', 'UA1b')", ['192.0.2.1']);
    await q("insert into device_bans (fingerprint) values ('fpnull')");
    const rows = await db.listDevices(q, { limit: 100 });
    const d1 = rows.find((r) => r.key === 'd1');
    assert.ok(d1, 'd1 聚合行');
    assert.equal(d1.count, 2, '两条记录合并');
    assert.equal(d1.ips.length, 2, '两个 IP');
    assert.equal(d1.deviceId, 'd1');
    assert.equal(d1.banned, false);
    const noCode = rows.find((r) => r.key === 'fpnull');
    assert.ok(noCode, '无设备码用指纹做 key');
    assert.equal(noCode.deviceId, null, '前端显示「无设备码」');
    assert.equal(noCode.banned, true, '按指纹命中封禁');
    // 每个 key 唯一
    assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('前端（静态）：默认 IP 统计视图 + 展开行、两张表统计列、设备列按设备码', () => {
  const modules = read('../frontend/src/pages/AdminModules.vue');
  assert.match(modules, /const visitMode=ref\('ip'\)/, '默认 IP 统计视图');
  assert.match(modules, /switchVisitMode\('detail'\)/, '可切回明细');
  assert.match(modules, /\/api\/admin\/visitors\/by-ip\?/, '接 IP 统计接口');
  assert.match(modules, /type="expand"/, 'IP 行可展开');
  assert.match(modules, /最近访问（\{\{ visitDays \}\} 天内最多 20 条）/, '展开行显示最近访问');
  assert.match(modules, /访问最多的路径/, '展开行显示路径 top');
  for (const label of ['访问次数', '独立路径', '设备数', '已封禁', '被拦截', '封禁中']) {
    assert.ok(modules.includes(label), `IP 统计列/状态含 ${label}`);
  }
  // BI 批：自动临时封禁显示 + 状态筛选
  assert.match(modules, /ipStatus=ref\('all'\)/, '状态筛选默认全部');
  assert.match(modules, /status:ipStatus\.value/, '查询带 status 参数');
  assert.match(modules, /<el-option label="封禁中" value="banned"\/>/, '筛选含封禁中');
  assert.match(modules, /<el-option label="已封禁" value="blocked"\/>/, '筛选含已封禁');
  assert.match(modules, /'封禁中 · '\+banLeft\(row\)/, '封禁中显示剩余时间');
  assert.match(modules, /function banLeft\(row\)/, '剩余时间计算');
  assert.match(modules, /row\.status==='banned'/, '状态列区分自动封禁');
  // 两张表统计列（黑名单/白名单各一份）
  assert.equal((modules.match(/label="访问" width="80" align="right"/g) || []).length, 2, '黑白名单各加访问列');
  assert.equal((modules.match(/label="最近访问" width="150"/g) || []).length, 2, '黑白名单各加最近访问列');
  assert.equal((modules.match(/prop="devices" label="设备数" width="80"/g) || []).length, 2, '黑白名单各加设备数列');
  // 设备：按设备码聚合、无设备码标注、封禁仍可用指纹
  assert.match(modules, /设备（按设备码聚合）/, '设备表列名');
  assert.match(modules, /row\.deviceId\|\|'无设备码'/, '无设备码标注');
  assert.match(modules, /\(row\.ips\|\|\[\]\)\.join/, '多 IP 汇总展示');
  assert.match(modules, /openDeviceBan\(row\)/, '封禁入口保留');
  assert.match(modules, /deviceId:row\.deviceId/, '封禁请求带 deviceId');
});
