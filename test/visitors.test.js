// 访问记录 + IP 黑名单：落库、归属地回填、分页过滤、server 层 403 拦截、管理员放行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import * as visitors from '../src/visitors.js';

// 测试里关掉登录验证码
process.env.CAPTCHA_ENABLED = '0';

async function waitFor(fn, { timeoutMs = 3000, stepMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error('waitFor 超时；最后值：' + JSON.stringify(last));
}

test('normalizeBanInput：单个 IP / CIDR / 非法输入', () => {
  assert.equal(visitors.normalizeBanInput(' 1.2.3.4 '), '1.2.3.4');
  assert.equal(visitors.normalizeBanInput('1.2.3.0/24'), '1.2.3.0/24');
  assert.equal(visitors.normalizeBanInput('::1'), '::1');
  assert.equal(visitors.normalizeBanInput('999.1.1.1'), null);
  assert.equal(visitors.normalizeBanInput('1.2.3.0/33'), null);
  assert.equal(visitors.normalizeBanInput('not-an-ip'), null);
  assert.equal(visitors.normalizeBanInput(''), null);
});

test('blockedBy：精确匹配与 IPv4 CIDR', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.addBlockedIp(q, { ip: '5.6.7.8', note: '单个' });
  await db.addBlockedIp(q, { ip: '10.20.30.0/24', note: '网段' });
  await visitors.refreshBlocklist(q);
  try {
    assert.equal(visitors.blockedBy('5.6.7.8'), '5.6.7.8');
    assert.equal(visitors.blockedBy('10.20.30.77'), '10.20.30.0/24');
    assert.equal(visitors.blockedBy('10.20.31.1'), null);
    assert.equal(visitors.blockedBy('1.1.1.1'), null);
  } finally {
    await store.close();
  }
});

test('访问记录：落库、归属地回填、分页过滤、汇总', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    const id1 = await db.insertVisitorLog(q, { ip: '1.2.3.4', remoteIp: '172.17.0.1', path: '/', status: 200 });
    const id2 = await db.insertVisitorLog(q, { ip: '1.2.3.4', path: '/api/games', status: 200 });
    await db.insertVisitorLog(q, { ip: '9.9.9.9', path: '/console', status: 403 });

    await db.setVisitorRegion(q, id2, '中国 广东 深圳');
    const rows = await q('select ip, region, path from visitor_logs where id = $1', [id2]);
    assert.equal(rows.rows[0].region, '中国 广东 深圳');
    assert.equal(rows.rows[0].path, '/api/games');

    // 分页 + IP 过滤
    const all = await db.listVisitorLogs(q, { page: 1, pageSize: 10 });
    assert.equal(all.total, 3);
    const filtered = await db.listVisitorLogs(q, { page: 1, pageSize: 10, ip: '1.2.3.4' });
    assert.equal(filtered.total, 2);
    const byPath = await db.listVisitorLogs(q, { page: 1, pageSize: 10, path: 'console' });
    assert.equal(byPath.total, 1);
    assert.equal(byPath.rows[0].ip, '9.9.9.9');

    // 汇总
    const summary = await db.visitorSummary(q);
    assert.equal(summary.today_visits, 3);
    assert.equal(summary.today_ips, 2);
    assert.equal(summary.topIps.length, 2);
    assert.equal(summary.topIps[0].ip, '1.2.3.4');

    // 黑名单增删查
    const added = await db.addBlockedIp(q, { ip: '9.9.9.9', note: '爬虫' });
    assert.equal(added.ip, '9.9.9.9');
    const list = await db.listBlockedIps(q);
    assert.equal(list.length, 1);
    assert.equal(list[0].note, '爬虫');
    assert.equal(await db.removeBlockedIp(q, '9.9.9.9'), 1);
    assert.equal((await db.listBlockedIps(q)).length, 0);
  } finally {
    await store.close();
  }
});

test('server 层拦截：拉黑后整站 403、管理员放行、解封恢复', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    // 匿名登录管理员
    const loginRes = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    const cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];
    assert.equal(loginRes.status, 200);

    // 登录（POST）会记访问记录；GET /api 数据请求不记（避免一次刷新十几条）
    await waitFor(async () => {
      const rows = await q("select count(*)::int as n from visitor_logs where path = '/api/login'");
      return rows.rows[0].n >= 1 ? rows.rows[0].n : 0;
    });
    const ok = await fetch(`${base}/api/games`);
    assert.equal(ok.status, 200);
    await new Promise((r) => setTimeout(r, 300));
    const apiLogs = (await q("select count(*)::int as n from visitor_logs where path = '/api/games'")).rows[0].n;
    assert.equal(apiLogs, 0, 'GET /api/* 2xx 不应写访问记录');

    // 管理员拉黑 127.0.0.1
    const ban = await fetch(`${base}/api/admin/blacklist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ip: '127.0.0.1', note: '测试' }),
    });
    assert.equal(ban.status, 200);

    // 匿名请求整站 403（含静态页）
    const denied = await fetch(`${base}/api/games`);
    assert.equal(denied.status, 403);
    const deniedPage = await fetch(`${base}/console`);
    assert.equal(deniedPage.status, 403);

    // 管理员会话放行（避免把自己锁在门外）
    const adminOk = await fetch(`${base}/api/admin/blacklist`, { headers: { cookie } });
    assert.equal(adminOk.status, 200);

    // 拉黑也记访问记录（status 403）
    await waitFor(async () => {
      const rows = await q("select count(*)::int as n from visitor_logs where status = 403");
      return rows.rows[0].n >= 1 ? rows.rows[0].n : 0;
    });

    // 解封后恢复
    const unban = await fetch(`${base}/api/admin/blacklist/127.0.0.1`, { method: 'DELETE', headers: { cookie } });
    assert.equal(unban.status, 200);
    const restored = await fetch(`${base}/api/games`);
    assert.equal(restored.status, 200);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('普通用户不能管理黑名单', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const loginRes = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'alice123456' }),
    });
    const cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];

    const add = await fetch(`${base}/api/admin/blacklist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ip: '1.2.3.4' }),
    });
    assert.equal(add.status, 403);
    const list = await fetch(`${base}/api/admin/blacklist`, { headers: { cookie } });
    assert.equal(list.status, 403);
    const view = await fetch(`${base}/api/admin/visitors`, { headers: { cookie } });
    assert.equal(view.status, 403);
  } finally {
    await srv.close();
    await store.close();
  }
});

// ---------------------------------------------------------------- 黑/白名单互斥
// docs/BAN-AND-SECURITY-FIXES.md §4：加黑移白、加白移黑；存量冲突白名单优先清理。

test('互斥（store 层）：加黑自动移白、加白自动移黑，回执带 removedFrom*', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    const trust = await db.addWhitelistIp(q, { ip: '7.7.7.7', note: '出口' });
    assert.equal(trust.removedFromBlacklist, false, '首次加白没有黑名单可移');

    const ban = await db.addBlockedIp(q, { ip: '7.7.7.7', note: '拉黑' });
    assert.equal(ban.removedFromWhitelist, true, '加黑应自动移白');
    assert.equal((await q('select count(*)::int as n from ip_whitelist')).rows[0].n, 0, '白名单应清空');

    const reTrust = await db.addWhitelistIp(q, { ip: '7.7.7.7', note: '出口' });
    assert.equal(reTrust.removedFromBlacklist, true, '加白应自动移黑');
    assert.equal((await q('select count(*)::int as n from ip_blacklist')).rows[0].n, 0, '黑名单应清空');
  } finally {
    await store.close();
  }
});

test('迁移清理：两表并存的存量冲突白名单优先，临时封禁一并清空', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    // 绕过互斥直接造并存数据（模拟老库）
    await q("insert into ip_blacklist (ip, note) values ('8.8.8.8', '旧黑')");
    await q("insert into ip_whitelist (ip, note) values ('8.8.8.8', '旧白')");
    await q("insert into ip_abuse (ip, strikes, banned_until) values ('8.8.8.8', 3, now() + interval '1 hour')");

    await db.migrate(store); // 幂等重跑 → 存量清理生效

    assert.equal((await q("select count(*)::int as n from ip_blacklist where ip = '8.8.8.8'")).rows[0].n, 0, '黑名单条目应被删');
    assert.equal((await q("select count(*)::int as n from ip_whitelist where ip = '8.8.8.8'")).rows[0].n, 1, '白名单条目保留');
    const abuse = (await q("select banned_until from ip_abuse where ip = '8.8.8.8'")).rows[0];
    assert.equal(abuse.banned_until, null, '被白名单覆盖的临时封禁应清空');
  } finally {
    await store.close();
  }
});

test('互斥（HTTP 层 + 内存态）：加黑后信任同一 IP → 立即恢复访问，黑名单不复活', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const loginRes = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    const cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];

    const ban = await fetch(`${base}/api/admin/blacklist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ip: '127.0.0.1' }),
    });
    assert.equal((await ban.json()).removedFromWhitelist, false);
    assert.equal((await fetch(`${base}/api/games`)).status, 403, '拉黑后匿名被拦');

    // 加白 → 互斥移黑 + 内存黑名单即时刷新 → 匿名立即恢复
    const trust = await fetch(`${base}/api/admin/whitelist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ip: '127.0.0.1' }),
    });
    assert.equal((await trust.json()).removedFromBlacklist, true, '加白应回执移除了黑名单');
    assert.equal((await fetch(`${base}/api/games`)).status, 200, '内存黑名单已刷新');

    // 再封 → 回执 removedFromWhitelist + 内存白名单同步移除 → 又拦
    const ban2 = await fetch(`${base}/api/admin/blacklist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ip: '127.0.0.1' }),
    });
    assert.equal((await ban2.json()).removedFromWhitelist, true, '加黑应回执移除了白名单');
    assert.equal((await fetch(`${base}/api/games`)).status, 403, '内存白名单已同步移除');
  } finally {
    await srv.close();
    await store.close();
  }
});
// ---------------------------------------------------------------- BJ 批（docs/BAN-AND-SECURITY-FIXES.md §10.6 验收 3/6/7）

test('BJ：listAbuse 三种 status 口径与 active 字段（B1）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q("insert into ip_abuse (ip, strikes, banned_until) values ('203.0.113.1', 2, now() + interval '30 minutes')");
    await q("insert into ip_abuse (ip, strikes, banned_until) values ('203.0.113.2', 1, now() - interval '1 hour')");
    await q("insert into ip_abuse (ip, strikes, banned_until) values ('203.0.113.3', 3, null)");
    const active = await db.listAbuse(q, { status: 'active' });
    assert.deepEqual(active.map((r) => r.ip), ['203.0.113.1'], '默认只列生效中');
    assert.equal(active[0].active, true);
    const expired = await db.listAbuse(q, { status: 'expired' });
    assert.deepEqual(expired.map((r) => r.ip).sort(), ['203.0.113.2', '203.0.113.3'], '过期与仅计数都在 expired 里');
    const all = await db.listAbuse(q, { status: 'all' });
    assert.equal(all.length, 3, 'all 为并集');
    const fallback = await db.listAbuse(q, { status: 'garbage' });
    assert.equal(fallback.length, 1, '非法值回落到 active');
  } finally {
    await store.close();
  }
});

test('BJ：clearAbuseBan 只清被黑名单覆盖的行，行保留；迁移幂等（D1/H1）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q("insert into ip_abuse (ip, strikes, banned_until, ban_source) values ('203.0.113.1', 2, now() + interval '30 minutes', 'rate')");
    await q("insert into ip_abuse (ip, strikes, banned_until, ban_source) values ('203.0.113.2', 1, now() + interval '10 minutes', 'path')");
    await db.addBlockedIp(q, { ip: '203.0.113.1', note: '审核通过' });
    // 决策 14：审核通过写黑名单时清该 IP 临时封禁字段（行保留）
    const changed = await db.clearAbuseBan(q, '203.0.113.1');
    assert.equal(changed, true);
    const row = (await q("select banned_until, ban_source from ip_abuse where ip = '203.0.113.1'")).rows[0];
    assert.equal(row.banned_until, null, '被黑名单覆盖的 IP 不再显示封禁中');
    assert.equal(row.ban_source, null);
    assert.equal((await q("select count(*)::int as n from ip_abuse where ip = '203.0.113.1'")).rows[0].n, 1, '行保留做审计');
    const untouched = (await q("select banned_until from ip_abuse where ip = '203.0.113.2'")).rows[0];
    assert.ok(untouched.banned_until, '未被覆盖的行不动');
    // 迁移幂等：migrate() 再跑一次不炸、第二次清 0 行
    await db.migrate(store);
    assert.equal((await q("select count(*)::int as n from ip_abuse where ip = '203.0.113.1' and banned_until is not null")).rows[0].n, 0);
  } finally {
    await store.close();
  }
});

test('BJ：purgeOldRows 自动封禁保留期——91 天前删、未过期不删、仅计数旧行删（H1）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const { ensureEmailSchema } = await import('../src/email-auth.js');
  await ensureEmailSchema(store);
  const { ensureSteamSchema } = await import('../src/steam-login.js');
  await ensureSteamSchema(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q("insert into ip_abuse (ip, strikes, banned_until, updated_at) values ('203.0.113.1', 2, now() - interval '91 days', now() - interval '91 days')");
    await q("insert into ip_abuse (ip, strikes, banned_until, updated_at) values ('203.0.113.2', 2, now() + interval '30 minutes', now())");
    await q("insert into ip_abuse (ip, strikes, banned_until, updated_at) values ('203.0.113.3', 1, null, now() - interval '91 days')");
    await q("insert into ip_abuse (ip, strikes, banned_until, updated_at) values ('203.0.113.4', 1, null, now())");
    const r = await db.purgeOldRows(q, { abuseDays: 90 });
    assert.equal(r.ipAbuse, 2, '只删 91 天前的过期行与很旧的仅计数行');
    const left = (await q('select ip from ip_abuse order by ip')).rows.map((x) => x.ip);
    assert.deepEqual(left, ['203.0.113.2', '203.0.113.4'], '未过期行与较新的仅计数行保留');
  } finally {
    await store.close();
  }
});
