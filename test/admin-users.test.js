// DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：用户管理打磨——
// ① POST /api/admin/users 建号入口下线（410，用户只能自助注册）；
// ② 编辑弹窗数据：GET /api/admin/users/:username/steam-accounts 只读展示绑定账号；
// ③ PATCH 角色变更 / 禁用启用落审计（admin.user_edit / admin.user_disabled）；
// ④ 单条禁用立即踢会话（BK-1 复用，DT-3 保留验收）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureEmailSchema } from '../src/email-auth.js';
import { ensureSteamSchema } from '../src/steam-login.js';

process.env.CAPTCHA_ENABLED = '0';

async function setup() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store); // users.email 列 + users_email_uniq 部分唯一索引（生产同款）
  await ensureSteamSchema(store); // steam_accounts（DT-3 编辑弹窗绑定账号展示用）
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  const alice = (await q("select id from users where username = 'alice'")).rows[0];
  await q(
    "insert into steam_accounts (steam_id, persona_name, alias, user_id) values ('76561198000000011', 'FF', null, $1), ('76561198000000012', 'Happy', '主号', $1)",
    [alice.id],
  );
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  return { store, q, srv, base: `http://127.0.0.1:${srv.port}`, alice };
}

const login = async (base, username, password) => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
};

test('DT-3：POST /api/admin/users 建号接口下线——匿名 401、普通用户 403、管理员 410 且不建号', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const before = (await q('select count(*)::int as n from users')).rows[0].n;
    const post = (cookie) =>
      fetch(`${base}/api/admin/users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify({ username: 'bob', password: 'k7Qw!2mXp3nZ', role: 'user', email: 'bob@example.com' }),
      });
    assert.equal((await post(null)).status, 401, '匿名 401');
    const alice = await login(base, 'alice', 'alice123456');
    assert.equal((await post(alice.cookie)).status, 403, '普通用户 403');
    const admin = await login(base, 'admin', 'admin123456');
    const res = await post(admin.cookie);
    // 反向自检：把 410 改回建号逻辑 → 这里变 201，断言变红（DT-3 验收「无新建入口/接口」）
    assert.equal(res.status, 410, '管理员触发 → 410 Gone（接口下线）');
    assert.match((await res.json()).error, /自助注册/);
    const after = (await q('select count(*)::int as n from users')).rows[0].n;
    assert.equal(after, before, '410 不产生任何用户');
    assert.equal((await q("select count(*)::int as n from users where username = 'bob'")).rows[0].n, 0);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('DT-3：编辑弹窗绑定账号只读数据——昵称 + SteamID，未绑定为空数组；权限 401/403/404', async () => {
  const { store, srv, base } = await setup();
  try {
    const get = (cookie) => fetch(`${base}/api/admin/users/alice/steam-accounts`, { headers: cookie ? { cookie } : {} });
    assert.equal((await get(null)).status, 401, '匿名 401');
    const bob = await login(base, 'alice', 'alice123456');
    assert.equal((await get(bob.cookie)).status, 403, '普通用户 403');
    const admin = await login(base, 'admin', 'admin123456');
    const res = await get(admin.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.accounts.length, 2);
    assert.deepEqual(
      body.accounts.map((a) => [a.steamId, a.alias, a.personaName]),
      [
        ['76561198000000011', null, 'FF'],
        ['76561198000000012', '主号', 'Happy'],
      ],
      '昵称 + SteamID（别名优先展示由前端决定）',
    );
    assert.equal((await fetch(`${base}/api/admin/users/nobody/steam-accounts`, { headers: { cookie: admin.cookie } })).status, 404, '无此用户 404');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('DT-3：PATCH 角色变更落审计 admin.user_edit；禁用落 admin.user_disabled 且会话立即失效（BK 复用）', async () => {
  const { store, q, srv, base, alice } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const patch = (username, body) =>
      fetch(`${base}/api/admin/users/${username}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify(body),
      });
    // 先给 alice 造一条会话（模拟已登录）
    await q("insert into sessions (user_id, token, expires_at, ip) values ($1, 'dt3-token', now() + interval '1 day', '1.2.3.4')", [alice.id]);
    // 角色变更
    const role = await patch('alice', { role: 'admin' });
    assert.equal(role.status, 200);
    assert.equal((await q("select role from users where username = 'alice'")).rows[0].role, 'admin');
    const audit1 = await q("select detail from audit_logs where action = 'admin.user_edit' and target = 'alice'");
    assert.equal(audit1.rows.length, 1, '角色变更落 admin.user_edit 审计');
    assert.deepEqual(audit1.rows[0].detail, { field: 'role', from: 'user', to: 'admin' });
    // 禁用：会话立即失效（BK-1 复用）
    const dis = await patch('alice', { disabled: true });
    assert.equal(dis.status, 200);
    const audit2 = await q("select detail from audit_logs where action = 'admin.user_disabled' and target = 'alice'");
    assert.equal(audit2.rows.length, 1, '禁用落 admin.user_disabled 审计');
    assert.deepEqual(audit2.rows[0].detail, { disabled: true });
    const sessions = await q("select count(*)::int as n from sessions where user_id = $1", [alice.id]);
    assert.equal(sessions.rows[0].n, 0, '禁用后会话立即清空（下一次请求即退出登录）——验收⑤');
  } finally {
    await srv.close();
    await store.close();
  }
});
