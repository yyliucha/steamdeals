// CU-2（docs/USER-ALERTS-GOVERNANCE.md §2/§3 + §4 验收 2/3/5）：站点级提醒按 Steam 愿望单反查候选用户、
// 一键迁移给用户（user_id/收件人变化）+ 批量删除，均记审计。
//
// 锁住的行为：
//   1. 反查口径：claimable_users = steam_wishlist.appid = games.steam_appid → steam_accounts.user_id，
//      多用户全部列出；同一用户多账号去重；无愿望单 → []；
//   2. 迁移：站点级行 user_id NULL → 目标用户；目标用户已有同游戏用户级行 → 站点级行合并删除（不产生重复）；
//      迁移后 watchCandidates 收件人 = 目标用户邮箱（后续提醒发该邮箱的证据）；
//   3. 批量删除：只删站点级行（user_id IS NULL），用户级行不受影响；
//   4. HTTP 契约与审计：POST /api/admin/watchlist/migrate 与 /delete；audit_logs 落
//      admin.watch_migrated / admin.watch_deleted（actor/detail 完整）；普通用户 403；目标用户不存在 404；
//   5. 前端静态锁：迁移按钮/批量删除/候选用户消费存在。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureSteamSchema } from '../src/steam-login.js';

process.env.CAPTCHA_ENABLED = '0';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function setup() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureSteamSchema(store);
  const q = (sql, p) => store.query(sql, p);
  return { store, q };
}

/** 建游戏行（不建报价），返回内部 game_id。 */
async function makeGame(q, appid) {
  await db.ensureGame(q, { steamAppid: appid, name: `游戏${appid}`, nameEn: null, meta: null });
  const r = await q('select id from games where steam_appid = $1', [appid]);
  return Number(r.rows[0].id);
}

/** 绑定 Steam 账号并把 appid 加进愿望单。 */
async function wishlistBy(q, steamId, userId, appids) {
  await q('insert into steam_accounts (steam_id, persona_name, user_id) values ($1, $2, $3)', [steamId, `人${steamId}`, userId]);
  for (const appid of appids) await q('insert into steam_wishlist (steam_id, appid) values ($1, $2)', [steamId, appid]);
}

test('CU-2 反查口径：claimable_users 多用户全列、同用户多账号去重、无人认领为空', async () => {
  const { store, q } = await setup();
  try {
    const u1 = (await db.createUser(q, { username: 'mig-u1', password: 'wpass123456', email: 'a@example.com' })).id;
    const u2 = (await db.createUser(q, { username: 'mig-u2', password: 'wpass123456', email: 'b@example.com' })).id;
    // u1 两个账号（111/222）都愿望单了 100；u2 账号 333 愿望单了 100；只有 u1 愿望单了 101；102 无人愿望单
    await wishlistBy(q, '111', u1, [100, 101]);
    await wishlistBy(q, '222', u1, [100]);
    await wishlistBy(q, '333', u2, [100]);
    const g100 = await makeGame(q, 100);
    const g101 = await makeGame(q, 101);
    const g102 = await makeGame(q, 102);
    await db.upsertWatch(q, { gameId: g100 });
    await db.upsertWatch(q, { gameId: g101 });
    await db.upsertWatch(q, { gameId: g102 });

    const all = await db.listAllWatchesAdmin(q, { pageSize: 50 });
    const byGame = (id) => all.items.find((i) => Number(i.game_id) === id);
    assert.equal(all.total, 3);
    assert.equal(byGame(g100).claimable_users.length, 2, '游戏 100：u1/u2 两个用户全部列出');
    assert.deepEqual(
      byGame(g100).claimable_users.map((u) => u.userId).sort(),
      [u1, u2].sort(),
      '多用户全列（userId 对）',
    );
    assert.ok(byGame(g100).claimable_users.some((u) => u.userId === u1 && u.email === 'a@example.com'), '候选带收件邮箱');
    assert.equal(byGame(g101).claimable_users.length, 1, '游戏 101：只有 u1（u1 双账号去重后仍是 1 个用户）');
    assert.equal(byGame(g101).claimable_users[0].userId, u1);
    assert.equal(byGame(g102).claimable_users.length, 0, '游戏 102：无人认领 → 空数组');
  } finally {
    await store.close();
  }
});

test('CU-2 迁移数据层：user_id NULL→目标用户；目标已有用户级行 → 合并删除；收件人变为目标邮箱', async () => {
  const { store, q } = await setup();
  try {
    const u1 = (await db.createUser(q, { username: 'mig-u1', password: 'wpass123456', email: 'a@example.com' })).id;
    await wishlistBy(q, '111', u1, [200, 201]);
    const g200 = await makeGame(q, 200);
    const g201 = await makeGame(q, 201);
    await db.upsertWatch(q, { gameId: g200 }); // 站点级 200
    await db.upsertWatch(q, { gameId: g201 }); // 站点级 201
    // u1 已有 201 的用户级提醒（模拟重复）→ 迁移 201 应走合并
    await db.upsertUserWatch(q, { userId: u1, gameId: g201, targetCents: 5000 });
    const ids = (await q('select id from watchlist where user_id is null order by id')).rows.map((r) => Number(r.id));

    const res = await db.migrateSiteWatches(q, { ids, userId: u1 });
    assert.equal(res.migrated, 1, '200 迁移成功（update user_id）');
    assert.equal(res.merged, 1, '201 与已有用户级行合并（站点级行删除）');

    const rows = await q('select * from watchlist order by game_id');
    const byGame = (id) => rows.rows.find((r) => Number(r.game_id) === id);
    assert.equal(Number(byGame(g200).user_id), u1, '迁移后 user_id = 目标用户');
    assert.equal(byGame(g201).user_id, u1, '合并后只剩用户级行');
    assert.equal(rows.rows.length, 2, '总行数 2（无重复行）');

    // 收件人证据：watchCandidates 对迁移后的行带目标用户邮箱（达标提醒将发给该邮箱）
    const cands = await db.watchCandidates(q);
    const w200 = cands.find((c) => Number(c.game_id) === g200);
    assert.equal(w200.user_email, 'a@example.com', '迁移后收件人 = 目标用户邮箱');
    assert.equal(w200.user_id, u1);

    // 无效 id / 非站点级行不迁移
    const again = await db.migrateSiteWatches(q, { ids: [...ids, 999999], userId: u1 });
    assert.equal(again.migrated + again.merged, 0, '无可迁移行时 0 变化');
  } finally {
    await store.close();
  }
});

test('CU-2 HTTP：migrate/delete 契约、审计落库、权限与合并统计', async () => {
  const { store, q } = await setup();
  const admin = (await db.createUser(q, { username: 'migadmin', password: 'wpass123456', role: 'admin' })).id;
  const plain = (await db.createUser(q, { username: 'migplain', password: 'wpass123456' })).id;
  const u1 = (await db.createUser(q, { username: 'mig-u1', password: 'wpass123456', email: 'a@example.com' })).id;
  const u2 = (await db.createUser(q, { username: 'mig-u2', password: 'wpass123456', email: 'b@example.com' })).id;
  await wishlistBy(q, '111', u1, [300, 301]);
  await wishlistBy(q, '222', u2, [300]);
  const g300 = await makeGame(q, 300);
  const g301 = await makeGame(q, 301);
  const g302 = await makeGame(q, 302);
  await db.upsertWatch(q, { gameId: g300 });
  await db.upsertWatch(q, { gameId: g301 });
  await db.upsertWatch(q, { gameId: g302 });
  await db.upsertUserWatch(q, { userId: u1, gameId: g302 }); // 用户级行：管理员只读
  const siteIds = (await q('select id from watchlist where user_id is null order by id')).rows.map((r) => Number(r.id));
  const userRowId = Number((await q('select id from watchlist where user_id is not null')).rows[0].id);

  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = async (username, password) => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };
  const post = (cookie, path, body) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  try {
    const cookieAdmin = await login('migadmin', 'wpass123456');
    const cookieU = await login('migplain', 'wpass123456');

    // 普通用户 403
    assert.equal((await post(cookieU, '/api/admin/watchlist/migrate', { ids: siteIds, userId: u1 })).status, 403, '普通用户迁移 403');
    assert.equal((await post(cookieU, '/api/admin/watchlist/delete', { ids: siteIds })).status, 403, '普通用户批量删除 403');
    // 目标用户不存在 404
    assert.equal((await post(cookieAdmin, '/api/admin/watchlist/migrate', { ids: siteIds, userId: 999999 })).status, 404, '目标用户不存在 404');

    // 列表契约：claimableUsers 驼峰；300 两候选、302 无候选
    const list = await (await fetch(`${base}/api/admin/watchlist?pageSize=50`, { headers: { cookie: cookieAdmin } })).json();
    const byGame = (id) => list.items.find((i) => Number(i.game_id) === id);
    assert.ok(Array.isArray(byGame(g300).claimableUsers) && byGame(g300).claimableUsers.length === 2, '接口返回 claimableUsers（驼峰）');
    assert.ok(!('claimable_users' in byGame(g300)), '契约只用驼峰');
    assert.equal(byGame(g302).claimableUsers.length, 0);

    // 迁移 2 条到 u1（300 直接迁移；301 迁移成功）→ migrated=2
    const m1 = await (await post(cookieAdmin, '/api/admin/watchlist/migrate', { ids: siteIds.slice(0, 2), userId: u1 })).json();
    assert.equal(m1.migrated, 2, '批量迁移 2 条');
    assert.equal(m1.target.username, 'mig-u1');
    const after = await (await fetch(`${base}/api/admin/watchlist?pageSize=50`, { headers: { cookie: cookieAdmin } })).json();
    const g300After = after.items.find((i) => Number(i.game_id) === g300);
    const g301After = after.items.find((i) => Number(i.game_id) === g301);
    assert.equal(g300After.user_id, u1, '页面「用户」列数据：user_id 变为 u1');
    assert.equal(g300After.username, 'mig-u1', '页面「用户」列数据：username 变为目标用户');
    assert.equal(g301After.user_id, u1);

    // 审计：admin.watch_migrated 落库（actor/detail 完整）
    const audits = await q("select * from audit_logs where action = 'admin.watch_migrated' order by id desc");
    assert.equal(audits.rows.length, 1);
    const aud = audits.rows[0];
    assert.equal(aud.actor, 'migadmin');
    assert.equal(aud.detail.toUserId, u1);
    assert.equal(aud.detail.migrated, 2);
    assert.ok(Array.isArray(aud.detail.ids) && aud.detail.ids.length === 2, '审计带 ids');

    // 再迁移 302 到 u1：站点级 302 与 u1 已有用户级 302 行冲突 → 合并（merged=1）
    const m2 = await (await post(cookieAdmin, '/api/admin/watchlist/migrate', { ids: [siteIds[2]], userId: u1 })).json();
    assert.equal(m2.migrated, 0);
    assert.equal(m2.merged, 1, '与已有用户级行合并');

    // 批量删除：把 300/301 的用户级行放进 ids 也不受影响（只删站点级）——先建两条站点级再删
    const g303 = await makeGame(q, 303);
    await db.upsertWatch(q, { gameId: g303 });
    const g304 = await makeGame(q, 304);
    await db.upsertWatch(q, { gameId: g304 });
    const delIds = (await q("select id from watchlist where user_id is null order by id desc limit 2")).rows.map((r) => Number(r.id));
    const del = await (await post(cookieAdmin, '/api/admin/watchlist/delete', { ids: [...delIds, userRowId] })).json();
    assert.equal(del.removed, 2, '只删站点级 2 条（混入的用户级 id 被忽略）');
    const left = (await q('select count(*)::int as n from watchlist')).rows[0].n;
    assert.ok(left >= 3, '用户级行仍在（未被批量删除误伤）');
    const delAudits = await q("select * from audit_logs where action = 'admin.watch_deleted' order by id desc");
    assert.equal(delAudits.rows.length, 1);
    assert.equal(delAudits.rows[0].detail.ids.length, 2, '删除审计带被删 ids');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('CU-2 前端静态锁：迁移按钮 / 批量删除 / 候选用户消费', () => {
  const text = readFileSync(`${ROOT}/frontend/src/pages/AdminModules.vue`, 'utf8');
  assert.match(text, /迁移给用户/, '批量迁移按钮文案');
  assert.match(text, /批量删除/, '批量删除按钮文案');
  assert.match(text, /claimableUsers\.length/, '行级候选 tag 按 claimableUsers 渲染');
  assert.match(text, /\/api\/admin\/watchlist\/migrate/, '迁移接口调用');
  assert.match(text, /\/api\/admin\/watchlist\/delete/, '批量删除接口调用');
  assert.match(text, /openWatchMigrate/, '迁移交互入口存在');
});

// ============================================================ CO-5/B4-2 第十七轮静态锁
// admin-watchlist 域（B4 #16：后台提醒愿望单 /api/admin/watchlist*、/api/admin/wishlists）
// 从 server.js/pg.js 巨石拆出后，四组静态断言按新落点指向：
//   · 路由分支 → src/routes/admin-watchlist.js（管理段单入口，8 组路由 + 手动推送频控随域移入）；
//   · 域专属 SQL → src/store/admin-watchlist-repository.js；pg.js 必须 re-export（旧 db.* 导入
//     签名不变），无 DDL 搬家（watchlist 表 DDL 在 pg.js SCHEMA，跨模块共用）；
//   · server.js 只留单入口接线（管理段），且必须真实调用——删掉调用即红（防死模块）；
//   · 旧分支不得残留在 server.js（防双实现）。
// 反向自检口径：删掉 routes/admin-watchlist.js 任一路由分支 → 第 1 组断言红；删掉 server.js
// 的入口接线 → 第 2 组红；把分支抄回 server.js → 第 3 组红；删 pg.js re-export → 第 4 组红。
// 边界判定：只拆 admin 视角——公开区 /api/watchlist、/api/wishlist 已随 B4 #4 拆在
// src/routes/watchlist.js（DT-2 403e6f2 改过，零触碰）；/api/admin/games*（B4 #15）、
// users/bulk（B4 #11）留 server.js；upsertWatch/deleteWatch/listWatches（CLI 共用）、
// watchCandidates/markNotified（alerts 引擎/CLI report 共用）留 pg.js；愿望单落库 SQL 在
// steam-accounts.js（公开区与 admin 共用，跨模块原地）。

const AW_ROUTES = readFileSync(fileURLToPath(new URL('../src/routes/admin-watchlist.js', import.meta.url)), 'utf8');
const AW_REPO = readFileSync(fileURLToPath(new URL('../src/store/admin-watchlist-repository.js', import.meta.url)), 'utf8');
const AW_SERVER = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const AW_PG = readFileSync(fileURLToPath(new URL('../src/store/pg.js', import.meta.url)), 'utf8');

test('CO-5/B4-2 第十七轮：admin-watchlist 路由分支全部在 src/routes/admin-watchlist.js（管理段单入口，删任一支即红）', () => {
  assert.match(AW_ROUTES, /path === '\/api\/admin\/wishlists' && req\.method === 'GET'/, 'wishlists 只读分支在新文件');
  assert.match(AW_ROUTES, /path === '\/api\/admin\/watchlist' && req\.method === 'GET'/, 'watchlist 清单分支在新文件');
  assert.match(AW_ROUTES, /path === '\/api\/admin\/watchlist' && req\.method === 'POST'/, 'watchlist 加/改分支在新文件');
  assert.match(AW_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/watchlist\\\/\(\\d\+\)\\\/push\$\/\)/, '单条 push 分支在新文件');
  assert.match(AW_ROUTES, /path === '\/api\/admin\/watchlist\/push' && req\.method === 'POST'/, '批量 push 分支在新文件');
  assert.match(AW_ROUTES, /path === '\/api\/admin\/watchlist\/migrate' && req\.method === 'POST'/, 'migrate 分支在新文件');
  assert.match(AW_ROUTES, /path === '\/api\/admin\/watchlist\/delete' && req\.method === 'POST'/, 'delete 分支在新文件');
  assert.match(AW_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/watchlist\\\/\(\\d\+\)\$\/\)/, 'watchDel 分支在新文件');
  // 单入口形态（§15.3 位置语义：管理段）
  assert.match(AW_ROUTES, /export async function handleAdminWatchlistAdmin\(ctx\)/, '管理段入口');
  // 守卫与语义随路由
  assert.match(AW_ROUTES, /if \(!requireAdmin\(\)\) return true/, '管理段守卫');
  assert.match(AW_ROUTES, /const notifyChannels = notify\.channelsFromEnv\(\)\.map/, '推送渠道名随路由');
  assert.match(AW_ROUTES, /return \{ status: 429, payload: \{ error: '5 分钟内已推送过该提醒，请稍后再试', retryAfterSec \} \};/, '5 分钟频控 429 语义随路由');
  assert.match(AW_ROUTES, /error: '用户提醒不可推送，仅站点级支持'/, '用户级提醒推送 403 语义随路由');
  assert.match(AW_ROUTES, /error: '用户提醒只读，请让用户自行操作'/, '用户级提醒删除 403 语义随路由');
  assert.match(AW_ROUTES, /hasPrice: hasPrice === true/, 'CU-2 驼峰契约随路由');
  assert.match(AW_ROUTES, /claimableUsers: Array\.isArray\(claimableUsers\) \? claimableUsers : \[\]/, 'claimableUsers 契约随路由');
  assert.match(AW_ROUTES, /const alertPushBuckets = new Map\(\);/, '手动推送频控桶随域移入模块级');
  assert.match(AW_ROUTES, /export function resetAlertPushBuckets\(\)/, '测试重置钩子随域移入（server.js re-export 保签名）');
  assert.match(AW_ROUTES, /await import\('\.\.\/alerts-html\.js'\)/, 'alerts-html 动态导入路径已修正为 ../alerts-html.js');
  // 路由模块只做编排：不许出现 SQL 字面量（全部走 repository）
  assert.ok(!/select |insert |update |delete from /.test(AW_ROUTES), 'routes/admin-watchlist.js 不写 SQL 字面量');
  // 未命中返回 false，宿主继续
  assert.match(AW_ROUTES, /return false;/, '未命中返回 false，宿主继续');
});

test('CO-5/B4-2 第十七轮：server.js 必须真实接线管理段入口（删掉调用即红，防死模块）', () => {
  assert.match(AW_SERVER, /import \{ handleAdminWatchlistAdmin \} from '\.\/routes\/admin-watchlist\.js'/, 'server.js 必须导入域路由入口');
  // 锁「完整调用形态」：必须是 if (await handleAdminWatchlistAdmin(...)) return;
  assert.match(AW_SERVER, /if \(\s*await handleAdminWatchlistAdmin\(\{[\s\S]{0,800}?path,[\s\S]{0,800}?req,[\s\S]{0,800}?res,[\s\S]{0,800}?ip,[\s\S]{0,300}?\}\)\s*\)\s*return;/, '管理段接线（完整形态，且消费返回值）');
  // ctx 关键字段必须传齐：漏传 url 分页参数丢失、漏传 requireAdmin 守卫失效、漏传 user 审计落空、
  // 漏传 ip 审计落空
  assert.match(AW_SERVER, /await handleAdminWatchlistAdmin\(\{[\s\S]{0,800}?url,/);
  assert.match(AW_SERVER, /await handleAdminWatchlistAdmin\(\{[\s\S]{0,800}?requireAdmin,/);
  assert.match(AW_SERVER, /await handleAdminWatchlistAdmin\(\{[\s\S]{0,800}?user,/);
  assert.match(AW_SERVER, /await handleAdminWatchlistAdmin\(\{[\s\S]{0,800}?ip,/);
  // 位置语义锁：调用必须在 requireAdmin 就绪后的管理段——本域最早路由 wishlists 的原位置
  // （handleWatchlistRoutes 之后、admin-games 接线之前）
  assert.match(AW_SERVER, /await handleWatchlistRoutes\(\{[\s\S]*?await handleAdminWatchlistAdmin\(\{/s, '接线在 watchlist 用户段接线之后（本域原位置）');
  assert.match(AW_SERVER, /await handleAdminWatchlistAdmin\(\{[\s\S]*?await handleAdminGamesAdmin\(\{/s, '接线在 admin-games 接线之前（本域原位置，games/stats 已随 B4 #15 拆走）');
  // 频控桶 re-export 保旧导入签名（alert-push.test.js 照旧 import resetAlertPushBuckets）
  assert.match(AW_SERVER, /export \{ ALERT_PUSH_WINDOW_MS, alertPushLimited, resetAlertPushBuckets \} from '\.\/routes\/admin-watchlist\.js'/, 'server.js re-export 频控三件套（旧导入签名不变）');
  // 边界锁：其它域路由留宿主
  assert.match(AW_SERVER, /await handleAdminGamesAdmin\(\{/, 'admin games 段已拆到 routes/admin-games.js（B4 #15，随 main 合并带入）');
  assert.match(AW_SERVER, /await handleAdminUsersAdmin\(\{/, 'users/bulk 段已拆到 routes/admin-users.js（B4 #11）');
  assert.match(AW_SERVER, /await handleWatchlistRoutes\(\{/, '公开 watchlist/wishlist 段留在 routes/watchlist.js 接线（B4 #4，DT-2 区零触碰）');
});

test('CO-5/B4-2 第十七轮：admin-watchlist 路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/path === '\/api\/admin\/wishlists' && req\.method/.test(AW_SERVER), 'wishlists 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/watchlist' && req\.method/.test(AW_SERVER), 'watchlist 清单/加改分支不得残留在 server.js');
  assert.ok(!/const watchPushOne = path\.match/.test(AW_SERVER), '单条 push 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/watchlist\/push' && req\.method/.test(AW_SERVER), '批量 push 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/watchlist\/migrate' && req\.method/.test(AW_SERVER), 'migrate 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/watchlist\/delete' && req\.method/.test(AW_SERVER), 'delete 分支不得残留在 server.js');
  assert.ok(!/const watchDel = path\.match/.test(AW_SERVER), 'watchDel 分支不得残留在 server.js');
  assert.ok(!/const adminPushWatches = async/.test(AW_SERVER), 'adminPushWatches 闭包不得残留在 server.js');
  assert.ok(!/const alertPushBuckets = new Map/.test(AW_SERVER), '频控桶不得残留在 server.js（随域移入，只留 re-export）');
  assert.ok(!/const steamAccountsMod = await import\('\.\/steam-accounts\.js'\)/.test(AW_SERVER), 'steamAccountsMod 动态 import 不得残留在 server.js（随域移入）');
  // 域内联 SQL 不得残留在 server.js（已抽 admin-watchlist-repository.js）
  assert.ok(!/select id, username from users where id = \$1/.test(AW_SERVER), 'migrate 目标用户内联 SQL 不得残留在 server.js');
  assert.ok(!/select id, user_id, game_id from watchlist/.test(AW_SERVER), 'watchDel 提醒行内联 SQL 不得残留在 server.js');
});

test('CO-5/B4-2 第十七轮：admin-watchlist-repository.js 签名不变 + pg.js re-export（删 re-export 即红）', () => {
  // 搬家函数签名与拆分前一致（旧 db.* 导入签名不变）
  assert.match(AW_REPO, /export async function deleteWatchById\(q, \{ id, region = 'cn' \}\)/, 'deleteWatchById 签名与拆分前一致');
  assert.match(AW_REPO, /export async function listAllWatchesAdmin\(q, \{ region = 'cn', page = 1, pageSize = 20, username = null, noPriceOnly = false \} = \{\}\)/, 'listAllWatchesAdmin 签名与拆分前一致');
  assert.match(AW_REPO, /export async function migrateSiteWatches\(q, \{ ids, userId, region = 'cn' \}\)/, 'migrateSiteWatches 签名与拆分前一致');
  assert.match(AW_REPO, /export async function deleteSiteWatches\(q, \{ ids, region = 'cn' \}\)/, 'deleteSiteWatches 签名与拆分前一致');
  assert.match(AW_REPO, /nullif\(btrim\(u\.display_name\), ''\) as display_name/, 'EJ 批昵称归一 SQL 随函数搬家');
  assert.match(AW_REPO, /order by w\.created_at desc/, '排序语义随函数搬家');
  // 域内联 SQL 新函数
  assert.match(AW_REPO, /export async function adminWatchTargetUser\(q, userId\)/, 'adminWatchTargetUser 域内联 SQL 抽成新函数');
  assert.match(AW_REPO, /export async function watchRowById\(q, wid\)/, 'watchRowById 域内联 SQL 抽成新函数');
  // pg.js 必须 re-export（旧 db.* 导入签名不变；routes/admin-watchlist.js 与现有测试照旧走聚合壳）
  assert.match(AW_PG, /adminWatchTargetUser,/, 'pg.js 必须 re-export adminWatchTargetUser');
  assert.match(AW_PG, /watchRowById,/, 'pg.js 必须 re-export watchRowById');
  assert.match(AW_PG, /deleteWatchById,/, 'pg.js 必须 re-export deleteWatchById');
  assert.match(AW_PG, /listAllWatchesAdmin,/, 'pg.js 必须 re-export listAllWatchesAdmin');
  assert.match(AW_PG, /migrateSiteWatches,/, 'pg.js 必须 re-export migrateSiteWatches');
  assert.match(AW_PG, /deleteSiteWatches,/, 'pg.js 必须 re-export deleteSiteWatches');
  assert.match(AW_PG, /from '\.\/admin-watchlist-repository\.js'/, 'pg.js re-export 指向 admin-watchlist-repository.js');
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(!/export (async )?function (deleteWatchById|listAllWatchesAdmin|migrateSiteWatches|deleteSiteWatches)/.test(AW_PG), 'pg.js 不允许保留旧函数定义（只许 re-export）');
  // 边界判据锁：跨模块共用 SQL 留在 pg.js（CLI watch 命令 / alerts 引擎 / CLI report 共用）
  assert.match(AW_PG, /export async function upsertWatch\(q, \{ gameId, region = 'cn', targetCents = null, note = null, source = 'manual' \}\)/, 'upsertWatch 留 pg.js（cli.js watch add 共用）');
  assert.match(AW_PG, /export async function deleteWatch\(q, \{ gameId, region = 'cn' \}\)/, 'deleteWatch 留 pg.js（cli.js watch del 共用）');
  assert.match(AW_PG, /export async function listWatches\(q, \{ region = 'cn' \} = \{\}\)/, 'listWatches 留 pg.js（cli.js watch list 共用）');
  assert.match(AW_PG, /export async function watchCandidates\(q, \{ region = 'cn' \} = \{\}\)/, 'watchCandidates 留 pg.js（alerts 引擎/CLI report 共用）');
  assert.match(AW_PG, /export async function markNotified\(q, \{ watchId, priceCents \}\)/, 'markNotified 留 pg.js（CLI report 共用）');
  // repository 不搬家 DDL
  assert.ok(!/create table/.test(AW_REPO), 'admin-watchlist-repository.js 不搬家 DDL');
});
