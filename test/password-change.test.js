// 账号流程（docs/AUTH-REDESIGN.md §7 验收 7、9 + §4.5/§4.7/§4.8，AK-3 批）：
// 建号/重置留空 → 随机临时密码（只回一次）+ must_change_password=true；
// 重置不再顺带启用账号；修改密码（旧密码错 400/策略/踢其它会话保留当前/weak 清除）；
// 首次登录强制改密（must_change_password 用户业务接口 403、白名单放行、改密后恢复）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';

process.env.CAPTCHA_ENABLED = '0';

async function setup() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'correct-horse-battery-staple', role: 'admin', email: 'admin@example.com' });
  await db.createUser(q, { username: 'alice', password: 'k7Qw!2mXp3nZ', role: 'user', email: 'alice@example.com' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = async (username, password) => {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return { status: res.status, body: await res.json(), cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
  };
  const post = (path, body, cookie) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const get = (path, cookie) => fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
  return { store, q, srv, base, login, post, get };
}

test('验收 7：后台建号留空密码 → 返回临时密码（16 位）且 must_change_password=true；填了必须过策略', async () => {
  const { store, q, srv, login, post } = await setup();
  try {
    const admin = await login('admin', 'correct-horse-battery-staple');
    let r = await post('/api/admin/users', { username: 'tempuser', role: 'user' }, admin.cookie);
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.match(body.tempPassword, /^[A-Za-z0-9_-]{16}$/, '16 位随机临时密码只回一次');
    const row = (await q("select must_change_password from users where username = 'tempuser'")).rows[0];
    assert.equal(row.must_change_password, true, '临时密码账号必须首登改密');
    assert.equal((await login('tempuser', body.tempPassword)).status, 200, '临时密码可直接登录');
    r = await post('/api/admin/users', { username: 'another', password: 'weak1234', role: 'user' }, admin.cookie);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /密码不符合要求/);
    assert.equal((await q("select count(*)::int as n from users where username = 'another'")).rows[0].n, 0, '弱密码不建号');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('验收 7：后台重置留空 → 临时密码；重置不再顺带启用禁用账号', async () => {
  const { store, q, srv, login, post } = await setup();
  try {
    const admin = await login('admin', 'correct-horse-battery-staple');
    await q("update users set disabled = true where username = 'alice'");
    const r = await post('/api/admin/users/alice/password', {}, admin.cookie);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.match(body.tempPassword, /^[A-Za-z0-9_-]{16}$/, '重置留空生成临时密码');
    const row = (await q("select disabled, must_change_password from users where username = 'alice'")).rows[0];
    assert.equal(row.disabled, true, '重置不再顺带启用账号（AK-3）');
    assert.equal(row.must_change_password, true, '重置后必须首登改密');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('验收 9：修改密码——旧密码错 400、弱密码 400、成功踢其它会话保留当前、weak_password 清除', async () => {
  const { store, q, srv, login, post, get } = await setup();
  try {
    const alice = await login('alice', 'k7Qw!2mXp3nZ');
    assert.equal(alice.status, 200);
    let r = await post('/api/user/password', { oldPassword: 'wrong-old-password', newPassword: 'new-strong-password-2026' }, alice.cookie);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /当前密码不正确/);
    r = await post('/api/user/password', { oldPassword: 'k7Qw!2mXp3nZ', newPassword: 'weak1234' }, alice.cookie);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /密码不符合要求/);
    // 另一台设备的会话（改密后被踢）
    const other = await login('alice', 'k7Qw!2mXp3nZ');
    r = await post('/api/user/password', { oldPassword: 'k7Qw!2mXp3nZ', newPassword: 'new-strong-password-2026' }, other.cookie);
    assert.equal(r.status, 200);
    const row = (await q("select weak_password, must_change_password from users where username = 'alice'")).rows[0];
    assert.equal(row.weak_password, false, 'weak_password 清除');
    assert.equal(row.must_change_password, false);
    const oldMe = await get('/api/me', alice.cookie);
    assert.equal((await oldMe.json()).user, null, '其它会话已被踢（/api/me 匿名返回 user:null）');
    assert.equal((await get('/api/me', other.cookie)).status, 200, '当前会话保留');
    assert.equal((await login('alice', 'new-strong-password-2026')).status, 200, '新密码可登录');
    assert.equal((await login('alice', 'k7Qw!2mXp3nZ')).status, 401, '旧密码失效');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('验收 7：首次登录强制改密——业务接口 403（code=must_change_password），白名单放行，改密后恢复', async () => {
  const { store, q, srv, login, post, get } = await setup();
  try {
    await q("update users set must_change_password = true where username = 'alice'");
    const alice = await login('alice', 'k7Qw!2mXp3nZ');
    assert.equal(alice.status, 200);
    assert.equal(alice.body.user.mustChangePassword, true, '登录响应带标记');
    let r = await get('/api/games/count', alice.cookie);
    assert.equal(r.status, 403, '业务接口 403');
    assert.equal((await r.json()).code, 'must_change_password');
    r = await get('/api/me', alice.cookie);
    assert.equal(r.status, 200, '/api/me 白名单放行');
    r = await get('/api/password/check', alice.cookie);
    assert.equal(r.status, 404, '/api/password/check 在白名单（GET 落到 404 而非 403）');
    // 改密后恢复
    r = await post('/api/user/password', { oldPassword: 'k7Qw!2mXp3nZ', newPassword: 'new-strong-password-2026' }, alice.cookie);
    assert.equal(r.status, 200);
    r = await get('/api/games/count', alice.cookie);
    assert.equal(r.status, 200, '改密后业务接口恢复');
  } finally {
    await srv.close();
    await store.close();
  }
});
