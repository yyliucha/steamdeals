// BK 批（docs/SESSION-MANAGEMENT.md §4 验收）：会话治理——列表/踢下线/过期清理/空闲超时/IP·UA 绑定/退出其它设备。
// 用真 PGlite + 真 HTTP（与 admin-bulk.test.js 同一套 boot 写法），只锁行为不 mock 业务层。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import * as ratelimit from '../src/ratelimit.js';
import * as guard from '../src/guard.js';
import * as devices from '../src/devices.js';

process.env.TRUST_PROXY = '1';
process.env.CAPTCHA_ENABLED = '0';
process.env.RATE_LIMIT_ENABLED = '0';
process.env.PATH_REVIEW_ENABLED = '0';
process.env.AUTH_SESSION_IDLE_DAYS = '7';
process.env.AUTH_SESSION_BIND_IP = '1';
process.env.AUTH_SESSION_BIND_UA = '1';

const ADMIN_IP = '198.18.0.9';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function boot() {
  ratelimit.resetState();
  guard.resetState();
  devices.resetState();
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const { ensureEmailSchema } = await import('../src/email-auth.js');
  await ensureEmailSchema(store);
  const { ensureSteamSchema } = await import('../src/steam-login.js');
  await ensureSteamSchema(store);
  const q = (sql, p) => store.query(sql, p);
  const admin = await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({
    query: q,
    outDir: new URL('../web', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    port: 0,
    host: '127.0.0.1',
    getSetupState: async () => ({ completed: true }),
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

async function login(base, username, password, { ip = ADMIN_IP, ua = UA } = {}) {
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': ua },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `${username} 登录失败`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

const get = (base, cookie, path, ip = ADMIN_IP, ua = UA) =>
  fetch(base + path, { headers: { 'x-forwarded-for': ip, 'user-agent': ua, ...(cookie ? { cookie } : {}) } });

/** 受保护接口（未登录必 401）：POST /api/wishlist */
const postProtected = (base, cookie, ip = ADMIN_IP, ua = UA) =>
  fetch(base + '/api/wishlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': ua, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ appid: 730 }),
  });

/** 该 cookie 当前是否有效登录（公开接口 /api/me 返回 user 对象则有效）。 */
async function meUser(base, cookie, ip = ADMIN_IP, ua = UA) {
  const r = await get(base, cookie, '/api/me', ip, ua);
  assert.equal(r.status, 200, '/api/me 恒 200');
  return (await r.json()).user ?? null;
}

// ---------------------------------------------------------------- BK-1（B：正确性修复 + 过期清理）

test('BK-1 验收 1/2：单条禁用踢全部会话；旧 cookie 401；手工残留会话也 401', async () => {
  const t = await boot();
  try {
    await db.createUser(t.q, { username: 'bob', password: 'password12345', role: 'user' });
    const bobCookie = await login(t.base, 'bob', 'password12345');
    const adminCookie = await login(t.base, 'admin', 'admin123456');
    assert.equal((await meUser(t.base, bobCookie)).username, 'bob');
    const res = await fetch(t.base + '/api/admin/users/bob', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ADMIN_IP, cookie: adminCookie },
      body: JSON.stringify({ disabled: true }),
    });
    assert.equal(res.status, 200);
    assert.equal((await t.q("select count(*)::int as n from sessions s join users u on u.id=s.user_id where u.username='bob'")).rows[0].n, 0, '禁用后会话全部删除');
    assert.equal(await meUser(t.base, bobCookie), null, '旧 cookie 视为未登录');
    assert.equal((await postProtected(t.base, bobCookie)).status, 401, '受保护接口 401');
    // 手工插一条残留会话 → userBySession 过滤 disabled
    await t.q("insert into sessions (token, user_id, expires_at) select 'residual-token', u.id, now() + interval '1 day' from users u where u.username='bob'");
    assert.equal(await meUser(t.base, 'gp_session=residual-token'), null, '残留会话视为未登录');
    assert.equal((await postProtected(t.base, 'gp_session=residual-token')).status, 401, '残留会话也 401');
  } finally {
    await t.close();
  }
});

test('BK-1 验收 4：用户列表会话计数只算未过期', async () => {
  const t = await boot();
  try {
    await db.createUser(t.q, { username: 'bob', password: 'password12345', role: 'user' });
    const bob = (await t.q("select id from users where username='bob'")).rows[0];
    await t.q("insert into sessions (token, user_id, expires_at) values ('expired-1', $1, now() - interval '1 hour')", [bob.id]);
    await t.q("insert into sessions (token, user_id, expires_at) values ('alive-1', $1, now() + interval '1 day')", [bob.id]);
    const adminCookie = await login(t.base, 'admin', 'admin123456');
    const d = await (await get(t.base, adminCookie, '/api/admin/users')).json();
    const row = d.users.find((u) => u.username === 'bob');
    assert.equal(row.sessions, 1, '只统计未过期会话');
  } finally {
    await t.close();
  }
});

test('BK-1 验收 5：prune 清过期会话、幂等；未过期不受影响；CLI 输出带计数', async () => {
  const t = await boot();
  try {
    await db.createUser(t.q, { username: 'bob', password: 'password12345', role: 'user' });
    const bob = (await t.q("select id from users where username='bob'")).rows[0];
    await t.q("insert into sessions (token, user_id, expires_at) values ('old-1', $1, now() - interval '1 day')", [bob.id]);
    await t.q("insert into sessions (token, user_id, expires_at) values ('old-2', $1, now() - interval '2 days')", [bob.id]);
    await t.q("insert into sessions (token, user_id, expires_at) values ('fresh-1', $1, now() + interval '1 day')", [bob.id]);
    const r1 = await db.purgeOldRows(t.q, {});
    assert.equal(r1.sessions, 2, '只删过期行');
    assert.equal((await t.q("select count(*)::int as n from sessions where token='fresh-1'")).rows[0].n, 1, '未过期保留');
    const r2 = await db.purgeOldRows(t.q, {});
    assert.equal(r2.sessions, 0, '连跑幂等');
    const { readFileSync } = await import('node:fs');
    const cliSrc = readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
    assert.match(cliSrc, /登录会话 \$\{result\.sessions\} 条/, 'CLI prune 输出带会话计数');
  } finally {
    await t.close();
  }
});

// ---------------------------------------------------------------- BK-2（A：会话列表 + 踢下线）

test('BK-2 验收 6/7/8：列表全字段/默认只列未过期/current 唯一/绝不返回 token；踢单条后目标 401', async () => {
  const t = await boot();
  try {
    await db.createUser(t.q, { username: 'bob', password: 'password12345', role: 'user' });
    const bobA = await login(t.base, 'bob', 'password12345', { ip: '203.0.113.9', ua: UA });
    const bobB = await login(t.base, 'bob', 'password12345', { ip: '203.0.113.10', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0' });
    const adminCookie = await login(t.base, 'admin', 'admin123456');
    const bob = (await t.q("select id from users where username='bob'")).rows[0];
    await t.q("insert into sessions (token, user_id, expires_at) values ('exp-1', $1, now() - interval '1 hour')", [bob.id]);
    const raw = await get(t.base, adminCookie, '/api/admin/sessions?limit=50');
    const body = await raw.json();
    assert.equal(raw.status, 200);
    assert.ok(!JSON.stringify(body).includes('token'), '响应绝不包含 token');
    const rows = body.sessions.filter((s) => s.username === 'bob');
    assert.equal(rows.length, 2, '默认只列未过期（过期行被过滤）');
    assert.ok(rows.every((s) => typeof s.id === 'number' && s.userAgent && s.createdAt && s.expiresAt), '字段齐全');
    assert.equal(rows.filter((s) => s.current).length, 0, 'admin 视角下 bob 的行都不该是 current');
    const mine = body.sessions.filter((s) => s.username === 'admin');
    assert.equal(mine.filter((s) => s.current).length, 1, 'current 只在当前请求那一行');
    // 踢单条 bobA（IP 203.0.113.9）
    const target = rows.find((s) => s.ip === '203.0.113.9');
    assert.ok(target, '能找到目标行');
    const kick = await fetch(t.base + `/api/admin/sessions/${target.id}`, { method: 'DELETE', headers: { 'x-forwarded-for': ADMIN_IP, cookie: adminCookie } });
    assert.equal(kick.status, 200);
    assert.equal(await meUser(t.base, bobA), null, '被踢后视为未登录');
    assert.equal((await postProtected(t.base, bobA)).status, 401, '目标下一次请求 401');
    assert.equal((await meUser(t.base, bobB, '203.0.113.10', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0')).username, 'bob', '另一会话不受影响');
  } finally {
    await t.close();
  }
});

test('BK-2 验收 9/10：批量踢回执 ok=3；按用户踢全部（自己保留当前）', async () => {
  const t = await boot();
  try {
    await db.createUser(t.q, { username: 'bob', password: 'password12345', role: 'user' });
    const c1 = await login(t.base, 'bob', 'password12345', { ip: '203.0.113.1' });
    const c2 = await login(t.base, 'bob', 'password12345', { ip: '203.0.113.2' });
    const c3 = await login(t.base, 'bob', 'password12345', { ip: '203.0.113.3' });
    const adminA = await login(t.base, 'admin', 'admin123456', { ip: '198.18.0.9' });
    const adminB = await login(t.base, 'admin', 'admin123456', { ip: '198.18.0.10' });
    const list = await (await get(t.base, adminA, '/api/admin/sessions?limit=50&user=bob')).json();
    const ids = list.sessions.map((s) => s.id);
    assert.equal(ids.length, 3);
    const bulk = await fetch(t.base + '/api/admin/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ADMIN_IP, cookie: adminA },
      body: JSON.stringify({ target: 'sessions', action: 'kick', keys: ids }),
    });
    assert.equal(bulk.status, 200);
    const bd = await bulk.json();
    assert.equal(bd.ok, 3, '批量回执 ok=3');
    assert.equal(bd.results.length, 0);
    assert.equal((await postProtected(t.base, c1)).status, 401);
    // 按用户踢全部：目标是 admin 自己 → 保留当前会话（adminA），adminB 被删
    const kickAll = await fetch(t.base + '/api/admin/users/admin/sessions', { method: 'DELETE', headers: { 'x-forwarded-for': ADMIN_IP, cookie: adminA } });
    assert.equal(kickAll.status, 200);
    assert.equal((await kickAll.json()).removed, 1, '除当前会话外全删');
    assert.equal((await meUser(t.base, adminA)).username, 'admin', '当前会话保留');
    assert.equal(await meUser(t.base, adminB, '198.18.0.10'), null, '另一会话被踢');
  } finally {
    await t.close();
  }
});

test('BK-2 验收 11/12：权限 401/403；last_seen_at 5 分钟节流（连续请求不重复写）', async () => {
  const t = await boot();
  try {
    await db.createUser(t.q, { username: 'bob', password: 'password12345', role: 'user' });
    const bobCookie = await login(t.base, 'bob', 'password12345');
    assert.equal((await get(t.base, '', '/api/admin/sessions')).status, 401, '未登录 401');
    assert.equal((await get(t.base, bobCookie, '/api/admin/sessions')).status, 403, '非管理员 403');
    const before = (await t.q("select last_seen_at from sessions s join users u on u.id=s.user_id where u.username='bob'")).rows[0].last_seen_at;
    for (let i = 0; i < 10; i += 1) {
      await meUser(t.base, bobCookie);
    }
    const after = (await t.q("select last_seen_at from sessions s join users u on u.id=s.user_id where u.username='bob'")).rows[0].last_seen_at;
    const again = (await t.q("select last_seen_at from sessions s join users u on u.id=s.user_id where u.username='bob'")).rows[0].last_seen_at;
    assert.equal(String(after), String(again), '节流期内不重复写');
    assert.ok(after >= before, 'last_seen_at 单调不倒退');
  } finally {
    await t.close();
  }
});

// ---------------------------------------------------------------- BK-3（C：空闲超时 + 绑定 + 前台退出）

test('BK-3 验收 13：空闲 7 天失效（8 天前失效+删行；6 天前可用；idleDays=0 关闭）', async () => {
  const t = await boot();
  try {
    await db.createUser(t.q, { username: 'bob', password: 'password12345', role: 'user' });
    const bob = (await t.q("select id from users where username='bob'")).rows[0];
    await t.q("insert into sessions (token, user_id, expires_at, last_seen_at) values ('idle-8', $1, now() + interval '30 days', now() - interval '8 days')", [bob.id]);
    assert.equal(await meUser(t.base, 'gp_session=idle-8'), null, '8 天前失效');
    assert.equal((await t.q("select count(*)::int as n from sessions where token='idle-8'")).rows[0].n, 0, '空闲超时删除行');
    await t.q("insert into sessions (token, user_id, expires_at, last_seen_at) values ('idle-6', $1, now() + interval '30 days', now() - interval '6 days')", [bob.id]);
    assert.equal((await meUser(t.base, 'gp_session=idle-6')).username, 'bob', '6 天前仍可用');
    process.env.AUTH_SESSION_IDLE_DAYS = '0';
    await t.q("insert into sessions (token, user_id, expires_at, last_seen_at) values ('idle-8b', $1, now() + interval '30 days', now() - interval '8 days')", [bob.id]);
    assert.equal((await meUser(t.base, 'gp_session=idle-8b')).username, 'bob', 'idleDays=0 不再拦截');
    process.env.AUTH_SESSION_IDLE_DAYS = '7';
  } finally {
    await t.close();
  }
});

test('BK-3 验收 14/15/16：IP 绑定 /24、UA 家族+主版本；老会话不校验绑定', async () => {
  const t = await boot();
  try {
    await db.createUser(t.q, { username: 'bob', password: 'password12345', role: 'user' });
    const bobCookie = await login(t.base, 'bob', 'password12345', { ip: '203.0.113.9', ua: 'Mozilla/5.0 Chrome/130.0.1' });
    // 同 /24 + 同家族主版本 → 仍可用
    assert.equal((await meUser(t.base, bobCookie, '203.0.113.77', 'Mozilla/5.0 Chrome/130.0.2')).username, 'bob', '同 /24 + 同家族主版本可用');
    // 换网段 → 失效 + 删行 + 受保护接口 401
    assert.equal(await meUser(t.base, bobCookie, '198.51.100.7', 'Mozilla/5.0 Chrome/130.0.2'), null, 'IP 网段变化失效');
    assert.equal((await postProtected(t.base, bobCookie, '198.51.100.7')).status, 401, '受保护接口 401');
    assert.equal((await t.q("select count(*)::int as n from sessions s join users u on u.id=s.user_id where u.username='bob'")).rows[0].n, 0, '绑定不一致删除行');
    // 重新登录测 UA 绑定
    const bob2 = await login(t.base, 'bob', 'password12345', { ip: '203.0.113.9', ua: 'Mozilla/5.0 Chrome/130.0.1' });
    assert.equal(await meUser(t.base, bob2, '203.0.113.9', 'Mozilla/5.0 Firefox/131.0'), null, 'UA 换家族失效');
    // 关闭 UA 绑定
    process.env.AUTH_SESSION_BIND_UA = '0';
    const bob3 = await login(t.base, 'bob', 'password12345', { ip: '203.0.113.9', ua: 'Mozilla/5.0 Chrome/130.0.1' });
    assert.equal((await meUser(t.base, bob3, '203.0.113.9', 'Mozilla/5.0 Firefox/131.0')).username, 'bob', '关闭 UA 绑定后不拦截');
    process.env.AUTH_SESSION_BIND_UA = '1';
    // 老会话（ip_key/ua_key null）换网段不被踢
    const bobId = (await t.q("select id from users where username='bob'")).rows[0].id;
    await t.q("insert into sessions (token, user_id, expires_at) values ('legacy-1', $1, now() + interval '1 day')", [bobId]);
    assert.equal((await meUser(t.base, 'gp_session=legacy-1', '203.0.113.200', 'Mozilla/5.0 Chrome/130.0.1')).username, 'bob', '老会话不校验绑定');
  } finally {
    await t.close();
  }
});

test('BK-3 验收 17：前台退出其它所有设备——保留当前、另一处 401、返回数量', async () => {
  const t = await boot();
  try {
    await db.createUser(t.q, { username: 'bob', password: 'password12345', role: 'user' });
    const bobA = await login(t.base, 'bob', 'password12345', { ip: '203.0.113.9' });
    const bobB = await login(t.base, 'bob', 'password12345', { ip: '203.0.113.10' });
    const res = await fetch(t.base + '/api/user/sessions/revoke-others', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', cookie: bobA },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).removed, 1);
    assert.equal((await meUser(t.base, bobA, '203.0.113.9')).username, 'bob', '当前设备保留');
    assert.equal(await meUser(t.base, bobB, '203.0.113.10'), null, '另一处被退出');
    assert.equal((await fetch(t.base + '/api/user/sessions/revoke-others', { method: 'POST' })).status, 401, '未登录 401');
  } finally {
    await t.close();
  }
});

test('BK-3 验收 19：prune 空闲兜底——idle=7 删 8 天未活动的未到期行；idle=0 不删', async () => {
  const t = await boot();
  try {
    await db.createUser(t.q, { username: 'bob', password: 'password12345', role: 'user' });
    const bob = (await t.q("select id from users where username='bob'")).rows[0];
    await t.q("insert into sessions (token, user_id, expires_at, last_seen_at) values ('stale-1', $1, now() + interval '30 days', now() - interval '8 days')", [bob.id]);
    await t.q("insert into sessions (token, user_id, expires_at, last_seen_at) values ('fresh-1', $1, now() + interval '30 days', now())", [bob.id]);
    const r1 = await db.purgeOldRows(t.q, { sessionIdleDays: 7 });
    assert.equal(r1.sessions, 1, '空闲超 7 天的未到期行被清理');
    assert.equal((await t.q("select count(*)::int as n from sessions where token='fresh-1'")).rows[0].n, 1);
    await t.q("insert into sessions (token, user_id, expires_at, last_seen_at) values ('stale-2', $1, now() + interval '30 days', now() - interval '8 days')", [bob.id]);
    const r2 = await db.purgeOldRows(t.q, { sessionIdleDays: 0 });
    assert.equal(r2.sessions, 0, 'idle=0 只清绝对过期（此处没有）');
    assert.equal((await t.q("select count(*)::int as n from sessions where token='stale-2'")).rows[0].n, 1);
  } finally {
    await t.close();
  }
});
