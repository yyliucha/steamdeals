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
