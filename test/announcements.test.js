// 站点公告：DB 过滤（启用/时间窗口）+ 管理接口增改删 + 公开接口只看生效中的。
// CO-5/B4-2 第五轮（docs/DESIGN-AUDIT.md B4）：公告域从 server.js/pg.js 巨石拆出后，
// 末尾四组静态断言按新落点指向：
//   · 路由分支（公开列表 / 登录已读 / 管理 CRUD）→ src/routes/announcements.js；
//   · 公告 CRUD 与已读 SQL → src/store/announcements-repository.js；pg.js 必须 re-export
//     （旧 db.* 导入签名不变），DDL 与后台批量操作函数留 pg.js（announcements 表跨域共用 B4 #11）；
//   · server.js 只留三入口接线（公开段/主段/管理段），且必须真实调用——删掉调用即红（防死模块）；
//   · 旧分支不得残留在 server.js（防双实现）。
// 反向自检口径：删掉 routes/announcements.js 任一路由分支 → 第 5 组断言红；
// 删掉 server.js 的任一入口接线 → 第 6 组红；把分支抄回 server.js → 第 7 组红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';

const WEB = fileURLToPath(new URL('../web', import.meta.url));
process.env.TRUST_PROXY = '1';
process.env.CAPTCHA_ENABLED = '0';

// CO-5/B4-2 第五轮静态锁素材（与 watchlist-user.test.js / appeal-system.test.js 同口径）
const ANN_ROUTES = readFileSync(fileURLToPath(new URL('../src/routes/announcements.js', import.meta.url)), 'utf8');
const ANN_REPO = readFileSync(fileURLToPath(new URL('../src/store/announcements-repository.js', import.meta.url)), 'utf8');
const ANN_SERVER = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const ANN_PG = readFileSync(fileURLToPath(new URL('../src/store/pg.js', import.meta.url)), 'utf8');

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

test('EG：App（Bearer）公告列表必须携带该用户服务端 readIds（角标持久化回归）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'egalice', password: 'egalice123456', role: 'user' });
  const ann = await db.createAnnouncement(q, { title: 'EG 回归公告', body: '正文', active: true });
  const srv = await startApiServer({
    query: q,
    outDir: WEB,
    port: 0,
    host: '127.0.0.1',
    getSetupState: async () => ({ completed: true }),
  });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    // App 登录拿 Bearer（验证码已关）
    const login = await fetch(base + '/api/app/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': 'eg-test-1' },
      body: JSON.stringify({ username: 'egalice', password: 'egalice123456' }),
    });
    assert.equal(login.status, 200);
    const bearer = (await login.json()).token;

    // 标记已读落库（POST 主段既有测试覆盖，这里只确认前置成立）
    const mark = await fetch(base + '/api/app/announcements/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ ids: [Number(ann.id)] }),
    });
    assert.equal(mark.status, 200);

    // 回归点（EG 根因）：GET /api/app/announcements 必须回该用户的 readIds——
    // 此前公开段只认 Cookie 会话，App 登录用户恒拿到空数组 → 角标每次刷新都回跳。
    // 反向自检：删掉公开段的 Bearer 解析 → 本断言红（修复前实测红，见提交记录）。
    const list = await fetch(base + '/api/app/announcements', {
      headers: { authorization: `Bearer ${bearer}` },
    });
    assert.equal(list.status, 200);
    const body = await list.json();
    assert.deepEqual(body.readIds, [Number(ann.id)], 'Bearer 用户应拿到服务端已读 id');

    // 匿名仍空数组（游客本地口径，契约不变）
    const anon = await (await fetch(base + '/api/app/announcements')).json();
    assert.deepEqual(anon.readIds, [], '匿名仍空数组');
  } finally {
    await srv.close();
    await store.close();
  }
});

// ============================================================ CO-5/B4-2 第五轮静态锁

test('CO-5/B4-2 第五轮：公告路由分支全部在 src/routes/announcements.js（公开/主/管理三入口，删任一支即红）', () => {
  assert.match(ANN_ROUTES, /path === '\/api\/announcements' && req\.method === 'GET'/, '公开列表分支在新文件');
  assert.match(ANN_ROUTES, /path === '\/api\/announcements\/read' && req\.method === 'POST'/, '登录已读分支在新文件');
  assert.match(ANN_ROUTES, /path === '\/api\/admin\/announcements' && req\.method === 'GET'/, '管理列表分支在新文件');
  assert.match(ANN_ROUTES, /path === '\/api\/admin\/announcements' && req\.method === 'POST'/, '管理创建分支在新文件');
  assert.match(ANN_ROUTES, /annMatch && \(req\.method === 'PATCH' \|\| req\.method === 'PUT'\)/, '管理更新分支在新文件');
  assert.match(ANN_ROUTES, /annMatch && req\.method === 'DELETE'/, '管理删除分支在新文件');
  // 三个入口形态（§15.3 位置语义：公开段 + 主段 + 管理段）
  assert.match(ANN_ROUTES, /export async function handleAnnouncementsPublic\(ctx\)/, '公开段入口');
  assert.match(ANN_ROUTES, /export async function handleAnnouncementsRoutes\(ctx\)/, '主段入口');
  assert.match(ANN_ROUTES, /export async function handleAnnouncementsAdmin\(ctx\)/, '管理段入口');
  // 守卫与校验随路由：公开段走 resolveSession（游客可读），EG 起补 Bearer 解析（App 登录用户 readIds）；
  // 主段 requireUser、管理段 requireAdmin + 标题/内容必填 + level 白名单
  assert.match(ANN_ROUTES, /await resolveSession\(\)/, '公开段仍解析 Cookie 会话附带 readIds');
  assert.match(ANN_ROUTES, /userByApiToken\(q, bearerMatch\[1\]\)/, 'EG：公开段补 Bearer 解析（App 登录用户 readIds）');
  assert.match(ANN_ROUTES, /if \(!requireUser\(\)\) return true/, '主段登录守卫');
  assert.match(ANN_ROUTES, /if \(!requireAdmin\(\)\) return true/, '管理段守卫');
  assert.match(ANN_ROUTES, /error: '标题和内容不能为空'/, '标题/内容必填校验随路由');
  assert.match(ANN_ROUTES, /\['info', 'warning', 'critical'\]\.includes\(body\.level\)/, 'level 白名单随路由');
  assert.match(ANN_ROUTES, /error: '公告不存在'/, '更新 404 语义随路由');
  // 路由模块只做编排：不许出现 SQL 字面量（全部走 repository）
  assert.ok(!/select |insert |update |delete from /.test(ANN_ROUTES), 'routes/announcements.js 不写 SQL 字面量');
  // 已写响应必须 return true（防宿主二次写头 ERR_HTTP_HEADERS_SENT，watchlist 域拆分回归教训）
  assert.match(ANN_ROUTES, /return false;/s, '未命中返回 false，宿主继续');
  assert.match(ANN_ROUTES, /'cache-control': 'no-store'/, '公开列表 no-store 头随路由');
});

test('CO-5/B4-2 第五轮：server.js 必须真实接线三个入口（删掉调用即红，防死模块）', () => {
  assert.match(ANN_SERVER, /import \{ handleAnnouncementsPublic, handleAnnouncementsRoutes, handleAnnouncementsAdmin \} from '\.\/routes\/announcements\.js'/, 'server.js 必须导入域路由三入口');
  // 锁「完整调用形态」：必须是 if (await handleXxx(...)) return;——只断言字符串存在会被 if(false) 包一层绕过；
  // 这个形态锁住"调用且消费返回值结束响应"。
  assert.match(ANN_SERVER, /if \(\s*await handleAnnouncementsPublic\(\{ path, req, res, q, json, resolveSession \}\)\) return;/, '公开段接线（含 resolveSession，且消费返回值）');
  assert.match(ANN_SERVER, /if \(\s*await handleAnnouncementsRoutes\(\{ path, req, res, q, logger, json, readBody, user, requireUser \}\)\) return;/, '主段接线（含 user/requireUser，且消费返回值）');
  assert.match(ANN_SERVER, /if \(\s*await handleAnnouncementsAdmin\(\{/, '管理段接线');
  // 管理段 ctx 关键字段必须传齐：漏传 url 分页参数丢失、漏传 requireAdmin 守卫失效、漏传 user 创建者落空
  assert.match(ANN_SERVER, /await handleAnnouncementsAdmin\(\{[\s\S]{0,700}?url,/);
  assert.match(ANN_SERVER, /await handleAnnouncementsAdmin\(\{[\s\S]{0,700}?requireAdmin,/);
  assert.match(ANN_SERVER, /await handleAnnouncementsAdmin\(\{[\s\S]{0,700}?user,/);
});

test('CO-5/B4-2 第五轮：公告路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/path === '\/api\/announcements' && req\.method/.test(ANN_SERVER), '公开列表分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/announcements\/read' && req\.method/.test(ANN_SERVER), '登录已读分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/announcements' && req\.method/.test(ANN_SERVER), '管理列表/创建分支不得残留在 server.js');
  assert.ok(!/const annMatch = path\.match/.test(ANN_SERVER), '管理更新/删除分支不得残留在 server.js');
  // toIso 只被本域管理段使用、已随域移入模块（断言定义与调用两处都不残留）
  assert.ok(!/const toIso =/.test(ANN_SERVER), 'toIso 定义不得残留在 server.js');
  assert.ok(!/toIso\(body\./.test(ANN_SERVER), 'toIso 调用不得残留在 server.js');
});

test('CO-5/B4-2 第五轮：announcements-repository.js 签名不变 + pg.js re-export（删 re-export 即红）', () => {
  assert.match(ANN_REPO, /export async function listAnnouncements\(q, \{ activeOnly = false, limit = 50 \} = \{\}\)/, 'listAnnouncements 签名与拆分前一致');
  assert.match(ANN_REPO, /export async function createAnnouncement\(q, \{ title, body, level = 'info', active = true, startsAt = null, endsAt = null, createdBy = null \}\)/, 'createAnnouncement 签名与拆分前一致');
  assert.match(ANN_REPO, /export async function updateAnnouncement\(q, id, \{ title, body, level, active, startsAt = null, endsAt = null \}\)/, 'updateAnnouncement 签名与拆分前一致');
  assert.match(ANN_REPO, /export async function deleteAnnouncement\(q, id\)/, 'deleteAnnouncement 签名与拆分前一致');
  assert.match(ANN_REPO, /export async function listAnnouncementReads\(q, userId\)/, '已读列表新函数');
  assert.match(ANN_REPO, /export async function filterExistingAnnouncementIds\(q, ids = \[\]\)/, 'id 有效性过滤新函数');
  assert.match(ANN_REPO, /export async function markAnnouncementsRead\(q, \{ userId, ids = \[\] \}\)/, '幂等标记已读新函数');
  assert.match(ANN_REPO, /insert into announcement_reads \(user_id, announcement_id\)/, '已读落库 SQL 在新 repository');
  // 七个函数必须整体 re-export（旧 db.* 导入签名不变；test 与 server.js 其它段照旧走聚合壳）
  assert.match(ANN_PG, /export \{[\s\S]{0,400}listAnnouncements[\s\S]{0,400}createAnnouncement[\s\S]{0,400}updateAnnouncement[\s\S]{0,400}deleteAnnouncement[\s\S]{0,400}listAnnouncementReads[\s\S]{0,400}filterExistingAnnouncementIds[\s\S]{0,400}markAnnouncementsRead[\s\S]{0,400}\} from '\.\/announcements-repository\.js'/, 'pg.js 必须 re-export 七个函数');
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(!/export (async )?function (listAnnouncements|createAnnouncement|updateAnnouncement|deleteAnnouncement|listAnnouncementReads|filterExistingAnnouncementIds|markAnnouncementsRead)/.test(ANN_PG), 'pg.js 不允许保留旧函数定义（只许 re-export）');
  // 边界判据锁：DDL 与后台批量操作函数留在 pg.js——announcements 表被 B4 #11 批量操作也读写（跨域共用表，watchlist 先例）
  assert.match(ANN_PG, /create table if not exists announcements \(/, 'announcements 表 DDL 留 pg.js');
  assert.match(ANN_PG, /create table if not exists announcement_reads \(/, 'announcement_reads 表 DDL 留 pg.js');
  // B4 #11 拆分后：批量删除/启停公告函数随 admin-users 域搬到 admin-users-repository.js，
  // pg.js 只许 re-export（旧 db.* 导入签名不变）
  assert.match(ANN_PG, /bulkDeleteAnnouncements,/, '批量删除公告函数经 pg.js re-export（定义已随 B4 #11 拆到 admin-users-repository.js）');
  assert.match(ANN_PG, /bulkSetAnnouncementsActive,/, '批量启停公告函数经 pg.js re-export（定义已随 B4 #11 拆到 admin-users-repository.js）');
  assert.ok(!/export async function bulkDeleteAnnouncements/.test(ANN_PG), 'pg.js 不允许保留 bulkDeleteAnnouncements 旧定义（只许 re-export）');
  assert.ok(!/export async function bulkSetAnnouncementsActive/.test(ANN_PG), 'pg.js 不允许保留 bulkSetAnnouncementsActive 旧定义（只许 re-export）');
});
