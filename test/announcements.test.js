// 站点公告：DB 过滤（启用/时间窗口）+ 管理接口增改删 + 公开接口只看生效中的。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';

const WEB = fileURLToPath(new URL('../web', import.meta.url));
process.env.TRUST_PROXY = '1';
process.env.CAPTCHA_ENABLED = '0';

test('公告过滤：停用 / 未开始 / 已过期都不出现在 activeOnly 里', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await db.createAnnouncement(q, { title: '现在', body: '正文', active: true });
    await db.createAnnouncement(q, { title: '停用', body: '正文', active: false });
    await db.createAnnouncement(q, { title: '未来', body: '正文', active: true, startsAt: new Date(Date.now() + 3600_000) });
    await db.createAnnouncement(q, { title: '过期', body: '正文', active: true, endsAt: new Date(Date.now() - 3600_000) });

    const active = await db.listAnnouncements(q, { activeOnly: true });
    assert.equal(active.length, 1);
    assert.equal(active[0].title, '现在');
    assert.equal((await db.listAnnouncements(q, {})).length, 4);
  } finally {
    await store.close();
  }
});

test('公告接口：管理员增改删，公开接口只返回生效中的', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({
    query: q,
    outDir: WEB,
    port: 0,
    host: '127.0.0.1',
    getSetupState: async () => ({ completed: true }),
  });
  const base = `http://127.0.0.1:${srv.port}`;
  const headers = { 'x-forwarded-for': '203.0.113.77' };
  try {
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    assert.equal(login.status, 200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const admin = { cookie, ...headers };

    const created = await fetch(base + '/api/admin/announcements', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...admin },
      body: JSON.stringify({ title: '维护通知', body: '今晚 23:00 维护', level: 'warning', active: true }),
    });
    assert.equal(created.status, 200);
    const id = (await created.json()).announcement.id;

    let pub = await (await fetch(base + '/api/announcements', { headers })).json();
    assert.equal(pub.announcements.length, 1);
    assert.equal(pub.announcements[0].title, '维护通知');

    const patched = await fetch(base + '/api/admin/announcements/' + id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...admin },
      body: JSON.stringify({ title: '维护通知', body: '改期', level: 'critical', active: false }),
    });
    assert.equal(patched.status, 200);
    pub = await (await fetch(base + '/api/announcements', { headers })).json();
    assert.equal(pub.announcements.length, 0, '停用后公开接口不再返回');

    const del = await fetch(base + '/api/admin/announcements/' + id, { method: 'DELETE', headers: admin });
    assert.equal(del.status, 200);
    assert.equal((await db.listAnnouncements(q, {})).length, 0);

    const anonymous = await fetch(base + '/api/admin/announcements', { headers });
    assert.equal(anonymous.status, 401, '未登录不能管理公告');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('公告已读：登录用户读状态存服务端并随账号（换设备可恢复）；游客不写表', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'alice', password: 'alice123456' });
  await db.createUser(q, { username: 'bob', password: 'bob123456' });
  await db.createAnnouncement(q, { title: '第一条', body: '正文1', active: true });
  await db.createAnnouncement(q, { title: '第二条', body: '正文2', active: true });
  const srv = await startApiServer({ query: q, outDir: WEB, port: 0, host: '127.0.0.1', getSetupState: async () => ({ completed: true }) });
  const base = `http://127.0.0.1:${srv.port}`;
  const headers = { 'x-forwarded-for': '203.0.113.78' };
  const login = async (username, password) => {
    const res = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ username, password }),
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };
  try {
    const alice = await login('alice', 'alice123456');
    const bob = await login('bob', 'bob123456');

    // 未读时 readIds 为空；游客也是空数组
    let pub = await (await fetch(base + '/api/announcements', { headers })).json();
    assert.equal(pub.announcements.length, 2);
    assert.deepEqual(pub.readIds, [], '游客无读状态');
    pub = await (await fetch(base + '/api/announcements', { headers: { ...headers, cookie: alice } })).json();
    assert.deepEqual(pub.readIds, [], '登录用户初始未读');

    // 匿名不能写读状态
    assert.equal(
      (await fetch(base + '/api/announcements/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ ids: [1, 2] }),
      })).status,
      401,
    );

    // alice 标记第一条已读 → 服务端存表；换会话（模拟换浏览器）仍恢复
    const mark = await fetch(base + '/api/announcements/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers, cookie: alice },
      body: JSON.stringify({ ids: [1, 999] }),
    });
    assert.equal(mark.status, 200);
    const alice2 = await login('alice', 'alice123456');
    pub = await (await fetch(base + '/api/announcements', { headers: { ...headers, cookie: alice2 } })).json();
    assert.deepEqual(pub.readIds, [1], '读状态跟随账号，无效 id 忽略');

    // bob 未读不受影响
    pub = await (await fetch(base + '/api/announcements', { headers: { ...headers, cookie: bob } })).json();
    assert.deepEqual(pub.readIds, [], '不同用户互不影响');

    // 幂等：重复标记不报错
    assert.equal(
      (await fetch(base + '/api/announcements/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers, cookie: alice },
        body: JSON.stringify({ ids: [1] }),
      })).status,
      200,
    );
    assert.equal((await q('select count(*)::int as n from announcement_reads where user_id = (select id from users where username = $1)', ['alice'])).rows[0].n, 1, '重复标记不插重复行');

    // 公告删除级联清读状态
    const ann = await q("select id from announcements where title = '第一条'");
    await db.deleteAnnouncement(q, ann.rows[0].id);
    assert.equal((await q('select count(*)::int as n from announcement_reads')).rows[0].n, 0);
  } finally {
    await srv.close();
    await store.close();
  }
});
