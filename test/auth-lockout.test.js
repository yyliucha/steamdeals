// 登录防护（docs/AUTH-REDESIGN.md §7 验收 3、4、5、11 + §4.3/§4.4，AK-2 批）：
// 5 次失败锁 15 分钟（第 6 次 429 + 剩余时间，锁定期内正确密码也 429）、成功清零、
// IP 20 次/15 分钟限速（不消耗账号尝试次数）、管理员解锁后立即恢复、
// 登录失败统一文案（不暴露账号是否存在/是否被禁用）、listUsers 带安全字段、
// 记住我 30 天/默认 7 天、后台列表「已锁定/弱密码/需改密」tag + 解锁按钮（静态断言）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer, resetLoginThrottleForTest } from '../src/server.js';

process.env.CAPTCHA_ENABLED = '0';

const events = [];
const logger = {
  trace() {},
  debug() {},
  info: (e, f) => events.push([e, f]),
  warn: (e, f) => events.push([e, f]),
  error: (e, f) => events.push([e, f]),
};

async function setup() {
  resetLoginThrottleForTest();
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'correct-horse-battery-staple', role: 'admin', email: 'admin@example.com' });
  await db.createUser(q, { username: 'alice', password: 'k7Qw!2mXp3nZ', role: 'user', email: 'alice@example.com' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1', logger });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = async (username, password, extra = {}) => {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password, ...extra }),
    });
    return {
      status: res.status,
      body: await res.json(),
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0],
      rawCookie: res.headers.get('set-cookie') ?? '',
    };
  };
  return { store, q, srv, base, login };
}

test('验收 3：连续 5 次错密码 → 第 6 次 429 + 剩余时间；锁定期内正确密码也 429；日志 auth.login_locked', async () => {
  const { store, q, srv, login } = await setup();
  try {
    for (let i = 0; i < 5; i += 1) {
      const r = await login('alice', 'wrong-password-123');
      assert.equal(r.status, 401, `第 ${i + 1} 次失败 401`);
      assert.equal(r.body.error, '用户名或密码错误');
    }
    const row = (await q("select failed_login_count, locked_until from users where username = 'alice'")).rows[0];
    assert.equal(row.failed_login_count, 5, '失败计数 = 5');
    assert.ok(Date.parse(row.locked_until) > Date.now(), '已锁定 15 分钟');
    const sixth = await login('alice', 'k7Qw!2mXp3nZ'); // 密码正确也被锁
    assert.equal(sixth.status, 429);
    assert.ok(sixth.body.retryAfterSec > 0, '带剩余时间');
    assert.ok(sixth.body.lockedUntil, '带 lockedUntil');
    assert.ok(events.some(([e]) => e === 'auth.login_locked'), '日志 auth.login_locked');
    const after = (await q("select failed_login_count from users where username = 'alice'")).rows[0];
    assert.equal(after.failed_login_count, 5, '锁定期内不再累加失败次数');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('验收 3/记住我：15 分钟后可再试；成功一次清零；cookie 默认 7 天 / 记住我 30 天', async () => {
  const { store, q, srv, login } = await setup();
  try {
    for (let i = 0; i < 4; i += 1) await login('alice', 'wrong-password-123');
    // 模拟 15 分钟过去（管理员解锁等同路径）
    await q("update users set locked_until = null, failed_login_count = 0 where username = 'alice'");
    const ok = await login('alice', 'k7Qw!2mXp3nZ');
    assert.equal(ok.status, 200, '锁解除后可再试');
    assert.match(ok.rawCookie, /Max-Age=604800/, '默认 7 天');
    const row = (await q("select failed_login_count, locked_until from users where username = 'alice'")).rows[0];
    assert.equal(row.failed_login_count, 0, '成功清零');
    assert.equal(row.locked_until, null);
    const long = await login('alice', 'k7Qw!2mXp3nZ', { rememberMe: true });
    assert.equal(long.status, 200);
    assert.match(long.rawCookie, /Max-Age=2592000/, '记住我 30 天');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('验收 4：同 IP 15 分钟 20 次失败 → 第 21 次 429（IP 级），且不消耗账号尝试次数', async () => {
  const { store, q, srv, login } = await setup();
  try {
    for (let i = 0; i < 20; i += 1) await login('ghost-user', 'whatever-password-1');
    const r = await login('alice', 'k7Qw!2mXp3nZ'); // 第 21 次：正确密码也被 IP 限速拦下
    assert.equal(r.status, 429);
    assert.ok(r.body.retryAfterSec > 0);
    const row = (await q("select failed_login_count from users where username = 'alice'")).rows[0];
    assert.equal(row.failed_login_count, 0, 'IP 限速不消耗账号尝试次数');
    assert.ok(events.some(([e, f]) => e === 'auth.ip_throttled' && f.count >= 20), '日志 auth.ip_throttled');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('验收 5：管理员解锁后立即恢复登录（审计 admin.user_unlocked）', async () => {
  const { store, q, srv, base, login } = await setup();
  try {
    for (let i = 0; i < 5; i += 1) await login('alice', 'wrong-password-123');
    assert.equal((await login('alice', 'k7Qw!2mXp3nZ')).status, 429);
    const adminLogin = await login('admin', 'correct-horse-battery-staple');
    assert.equal(adminLogin.status, 200);
    const unlock = await fetch(`${base}/api/admin/users/alice/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminLogin.cookie },
    });
    assert.equal(unlock.status, 200);
    const ok = await login('alice', 'k7Qw!2mXp3nZ');
    assert.equal(ok.status, 200, '解锁后立即恢复登录');
    assert.ok(events.some(([e]) => e === 'admin.user_unlocked'), '审计日志');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('验收 11：禁用账号登录失败不暴露「已被禁用」；listUsers 带安全字段；登录响应带 mustChangePassword', async () => {
  const { store, q, srv, login } = await setup();
  try {
    await q("update users set disabled = true where username = 'alice'");
    const r = await login('alice', 'k7Qw!2mXp3nZ');
    assert.equal(r.status, 401);
    assert.equal(r.body.error, '用户名或密码错误', '不暴露禁用状态');
    assert.ok(events.some(([e, f]) => e === 'auth.login_failed' && f.reason === 'disabled'), '原因只进日志');
    const listed = await db.listUsers(q);
    const alice = listed.find((u) => u.username === 'alice');
    for (const field of ['must_change_password', 'weak_password', 'locked_until', 'failed_login_count']) {
      assert.ok(field in alice, `listUsers 带 ${field}`);
    }
    await q("update users set disabled = false, must_change_password = true where username = 'alice'");
    const ok = await login('alice', 'k7Qw!2mXp3nZ');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.mustChangePassword, true, '登录响应带 mustChangePassword（AK-3 前端跳改密页用）');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('静态：后台用户列表三个 tag + 解锁按钮 + 解锁接口（§4.4）', () => {
  const src = readFileSync(fileURLToPath(new URL('../frontend/src/pages/AdminExtras.vue', import.meta.url)), 'utf8');
  assert.match(src, /已锁定/, '已锁定 tag');
  assert.match(src, /弱密码/, '弱密码 tag');
  assert.match(src, /需改密/, '需改密 tag');
  assert.match(src, /unlockUser\(row\)/, '解锁按钮');
  assert.match(src, /\/api\/admin\/users\/\$\{encodeURIComponent\(row\.username\)\}\/unlock/, '解锁接口');
  assert.match(src, /isLocked\(row\)/, '锁定判定（locked_until > now）');
});
