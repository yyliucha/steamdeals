// 管理员建号：邮箱与账号同一次写入（原子）。
// 修 2026-11-06 生产反馈的 bug——先建号、再绑邮箱的两步式流程里，邮箱已被占用时
// 账号其实已落库，前端报"创建失败"后刷新列表会冒出幽灵用户；换邮箱重试又因用户名
// 冲突再报错。此测试锁死：邮箱冲突 → 409 且用户数不变（无残号）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureEmailSchema } from '../src/email-auth.js';

process.env.CAPTCHA_ENABLED = '0';

async function setup() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store); // users.email 列 + users_email_uniq 部分唯一索引（生产同款）
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  await q("update users set email = 'taken@example.com', email_verified = true where username = 'alice'");
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  return { store, q, srv, base: `http://127.0.0.1:${srv.port}` };
}

const login = async (base, username, password) => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
};

const create = (base, cookie, body) =>
  fetch(`${base}/api/admin/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

test('建号带邮箱：一次写入成功，邮箱未验证', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const res = await create(base, admin.cookie, { username: 'bob', password: 'bob123456', role: 'user', email: 'bob@example.com' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.user.email, 'bob@example.com');
    assert.equal(body.user.email_verified, false);
    const row = (await q("select email, email_verified from users where username = 'bob'")).rows[0];
    assert.equal(row.email, 'bob@example.com', '邮箱随建号同一次落库');
    assert.equal(row.email_verified, false);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('邮箱已被占用：409 明确报错，且用户数不变（原子，不留残号）', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const before = (await q('select count(*)::int as n from users')).rows[0].n;
    const res = await create(base, admin.cookie, { username: 'carol', password: 'carol123456', role: 'user', email: 'taken@example.com' });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /邮箱已被其他账号绑定/);
    const after = (await q('select count(*)::int as n from users')).rows[0].n;
    assert.equal(after, before, '邮箱冲突时不能留下 carol 这个残号');
    assert.equal((await q("select count(*)::int as n from users where username = 'carol'")).rows[0].n, 0);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('用户名重复：409 且用户数不变', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const before = (await q('select count(*)::int as n from users')).rows[0].n;
    const res = await create(base, admin.cookie, { username: 'alice', password: 'alice123456', role: 'user', email: 'other@example.com' });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /用户名已存在/);
    assert.equal((await q('select count(*)::int as n from users')).rows[0].n, before);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('邮箱格式非法：400 且不建号', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const before = (await q('select count(*)::int as n from users')).rows[0].n;
    const res = await create(base, admin.cookie, { username: 'dave', password: 'dave123456', role: 'user', email: 'not-an-email' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /邮箱格式不正确/);
    assert.equal((await q('select count(*)::int as n from users')).rows[0].n, before);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('不带邮箱：向后兼容 201', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const res = await create(base, admin.cookie, { username: 'erin', password: 'erin123456', role: 'user' });
    assert.equal(res.status, 201);
    const row = (await q("select email from users where username = 'erin'")).rows[0];
    assert.equal(row.email, null);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('权限：匿名 401，普通用户 403，都不产生用户', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const before = (await q('select count(*)::int as n from users')).rows[0].n;
    const anon = await create(base, null, { username: 'frank', password: 'frank123456' });
    assert.equal(anon.status, 401);
    const alice = await login(base, 'alice', 'alice123456');
    const forbidden = await create(base, alice.cookie, { username: 'frank', password: 'frank123456' });
    assert.equal(forbidden.status, 403);
    assert.equal((await q('select count(*)::int as n from users')).rows[0].n, before);
  } finally {
    await srv.close();
    await store.close();
  }
});
