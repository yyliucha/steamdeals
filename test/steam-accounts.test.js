// Steam 多账号绑定：schema 迁移、库/愿望单差集删除、愿望单→到价提醒对账、
// 认领/解绑/别名 API、已拥有推导（owned_by / wishlisted / 手动排除恢复）。
// CO-5/B4-2 第七轮（docs/DESIGN-AUDIT.md B4）：site 域（/api/ban/state、/api/site、
// /api/steam/*）从 server.js/pg.js 巨石拆出后，末尾四组静态断言按新落点指向：
//   · 路由分支 → src/routes/site.js；
//   · Steam 账号 SQL → src/store/site-repository.js；pg.js 必须 re-export
//     （旧 db.* 导入签名不变），无 DDL 搬家（steam_accounts 等表 DDL 在 steam-login.js）；
//   · server.js 只留三入口接线（预检段/公开段/主段），且必须真实调用——删掉调用即红（防死模块）；
//   · 旧分支不得残留在 server.js（防双实现）。
// 反向自检口径：删掉 routes/site.js 任一路由分支 → 第 1 组断言红；
// 删掉 server.js 的任一入口接线 → 第 2 组红；把分支抄回 server.js → 第 3 组红；
// 删 pg.js re-export → 第 4 组红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureSteamSchema } from '../src/steam-login.js';
import * as steamAccounts from '../src/steam-accounts.js';
import { resetSteamSyncTasksForTest } from '../src/routes/site.js';

// CO-5/B4-2 第七轮静态锁素材（与 announcements.test.js / profile.test.js 同口径）
const SITE_ROUTES = readFileSync(fileURLToPath(new URL('../src/routes/site.js', import.meta.url)), 'utf8');
const SITE_REPO = readFileSync(fileURLToPath(new URL('../src/store/site-repository.js', import.meta.url)), 'utf8');
const SITE_SERVER = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const SITE_PG = readFileSync(fileURLToPath(new URL('../src/store/pg.js', import.meta.url)), 'utf8');

process.env.CAPTCHA_ENABLED = '0';
// 测试环境不能真的出网：绑定回调里的自动同步只会在有 API Key 时触发
delete process.env.STEAM_API_KEY;

const SID_A = '76561198000000001';
const SID_B = '76561198000000002';

async function freshStore() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureSteamSchema(store);
  return store;
}

const seedGame = async (store, appid, name) => {
  const q = (sql, p) => store.query(sql, p);
  await q(
    'insert into games (steam_appid, name, name_en) values ($1, $2, $3) on conflict (steam_appid) do nothing',
    [appid, name, name],
  );
  const gameId = (await q('select id from games where steam_appid = $1', [appid])).rows[0].id;
  // 列表搜索要求有日价格记录才可见
  await q(
    "insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) values ($1, 'steam', 'cn', current_date - 1, 9900, 'CNY')",
    [gameId],
  );
  // AV 批：原始 SQL 种价不进读模型，手动刷新价格/历史列（生产走 ingest 的 touch 路径）
  await db.refreshGameRegionPrices(q, gameId);
  await db.refreshGameRegionHist(q, gameId);
  return gameId;
};

const insertAccount = async (store, { steamId, userId = null, persona = '测试', alias = null }) => {
  await store.query(
    'insert into steam_accounts (steam_id, persona_name, alias, user_id) values ($1, $2, $3, $4)',
    [steamId, persona, alias, userId],
  );
};

// ---------------------------------------------------------------- schema

test('schema：steam_accounts 归属列 / steam_wishlist / 索引 / watchlist.source 都在', async () => {
  const store = await freshStore();
  try {
    const q = (sql, p) => store.query(sql, p);
    const cols = async (table) =>
      (await q('select column_name from information_schema.columns where table_name = $1', [table])).rows.map((r) => r.column_name);
    assert.ok((await cols('steam_accounts')).includes('user_id'), 'steam_accounts 应有 user_id');
    assert.ok((await cols('steam_accounts')).includes('alias'), 'steam_accounts 应有 alias');
    assert.ok((await cols('steam_wishlist')).includes('appid'), 'steam_wishlist 表应存在');
    assert.ok((await cols('watchlist')).includes('source'), 'watchlist 应有 source');
    const indexes = (await q(
      "select indexname from pg_indexes where schemaname = 'public'",
    )).rows.map((r) => r.indexname);
    for (const name of ['steam_accounts_user', 'steam_games_appid', 'steam_wishlist_appid']) {
      assert.ok(indexes.includes(name), `应有索引 ${name}`);
    }
    const dflt = await q(
      "select column_default from information_schema.columns where table_name = 'watchlist' and column_name = 'source'",
    );
    assert.match(String(dflt.rows[0]?.column_default ?? ''), /'manual'/);
  } finally {
    await store.close();
  }
});

// ---------------------------------------------------------------- 同步（差集删除 + 对账）

test('库同步：upsert + 差集删除（账号移出库的游戏必须消失；空集合清空全部）', async () => {
  const store = await freshStore();
  try {
    const q = (sql, p) => store.query(sql, p);
    await insertAccount(store, { steamId: SID_A });
    await q('insert into steam_games (steam_id, appid, name) values ($1, 730, $2), ($1, 550, $3)', [SID_A, 'CS2', 'L4D2']);

    const fetch = async () => [{ appid: 730, name: 'CS2', playtimeMinutes: 10, lastPlayedAt: null }];
    const result = await steamAccounts.syncAccountLibrary(q, { steamId: SID_A, apiKey: 'x', fetchImpl: fetch });
    assert.equal(result.total, 1);
    assert.equal(result.deleted, 1, '550 移出库后应被差集删除');

    const rows = await q('select appid from steam_games where steam_id = $1 order by appid', [SID_A]);
    assert.deepEqual(rows.rows.map((r) => r.appid), [730]);

    // 空集合 = 全部删除
    const empty = await steamAccounts.syncAccountLibrary(q, { steamId: SID_A, apiKey: 'x', fetchImpl: async () => [] });
    assert.equal(empty.deleted, 1);
    assert.equal((await q('select count(*)::int as n from steam_games where steam_id = $1', [SID_A])).rows[0].n, 0);
  } finally {
    await store.close();
  }
});

test('愿望单同步：差集删除 + 自动到价提醒（手动优先、移出后清理、目录未命中跳过）', async () => {
  const store = await freshStore();
  try {
    const q = (sql, p) => store.query(sql, p);
    await db.createUser(q, { username: 'alice', password: 'alice123456' });
    const alice = (await q("select id from users where username = 'alice'")).rows[0].id;
    await insertAccount(store, { steamId: SID_A, userId: alice });
    const g730 = await seedGame(store, 730, 'CS2');
    const g620 = await seedGame(store, 620, '传送门2');

    // 730 已有手动提醒（目标价），620 没有
    await db.upsertWatch(q, { gameId: g730, targetCents: 3000, note: '手动' });

    const fetch = async () => [
      { appid: 730, name: 'CS2' },
      { appid: 620, name: 'Portal 2' },
      { appid: 999999, name: '不存在' },
    ];
    const first = await steamAccounts.syncAccountWishlist(q, { steamId: SID_A, apiKey: 'x', userId: alice, fetchImpl: fetch });
    assert.equal(first.total, 3);
    assert.equal(first.skipped, 1, '999999 不在目录应跳过');
    assert.equal(first.watches, 1, '只有 620 新建自动提醒（730 已存在不覆盖）');

    let watches = await q('select w.source, w.target_cents, w.note, g.steam_appid from watchlist w join games g on g.id = w.game_id order by g.steam_appid');
    assert.equal(watches.rows.length, 2);
    const manual = watches.rows.find((r) => r.steam_appid === 730);
    const auto = watches.rows.find((r) => r.steam_appid === 620);
    assert.equal(manual.source, 'manual');
    assert.equal(manual.target_cents, 3000, '手动目标价不能被自动同步覆盖');
    assert.equal(auto.source, 'steam_wishlist');
    assert.equal(auto.target_cents, null, '自动提醒目标价为空 = 史低提醒');
    assert.equal(auto.note, 'Steam 愿望单');

    // 愿望单收缩：620 与 999999 移出 → 差集删除（表存账号完整愿望单，目录未命中同样记行）；
    // 620 的自动提醒被清理；730 手动提醒保留。
    const second = await steamAccounts.syncAccountWishlist(q, {
      steamId: SID_A,
      apiKey: 'x',
      userId: alice,
      fetchImpl: async () => [{ appid: 730, name: 'CS2' }],
    });
    assert.equal(second.deleted, 2, '620 与 999999 移出愿望单后应差集删除');
    assert.equal(second.watches, 0, '730 已存在提醒不新增');
    watches = await q('select w.source, g.steam_appid from watchlist w join games g on g.id = w.game_id');
    assert.equal(watches.rows.length, 1, '620 的自动提醒已清理');
    assert.equal(watches.rows[0].steam_appid, 730);
    const wishRows = await q('select appid from steam_wishlist where steam_id = $1', [SID_A]);
    assert.deepEqual(wishRows.rows.map((r) => r.appid), [730]);
  } finally {
    await store.close();
  }
});

test('解绑：清库/愿望单/账号行 + 自动提醒对账；手动提醒保留', async () => {
  const store = await freshStore();
  try {
    const q = (sql, p) => store.query(sql, p);
    await db.createUser(q, { username: 'alice', password: 'alice123456' });
    const alice = (await q("select id from users where username = 'alice'")).rows[0].id;
    await insertAccount(store, { steamId: SID_A, userId: alice });
    const g730 = await seedGame(store, 730, 'CS2');
    const g620 = await seedGame(store, 620, '传送门2');
    await q('insert into steam_games (steam_id, appid) values ($1, 730)', [SID_A]);
    await q('insert into steam_wishlist (steam_id, appid) values ($1, 620)', [SID_A]);
    await q("insert into watchlist (game_id, region, target_cents, note, source) values ($1, 'cn', null, 'Steam 愿望单', 'steam_wishlist')", [g620]);
    await db.upsertWatch(q, { gameId: g730, targetCents: 3000 });

    const result = await steamAccounts.unbindAccount(q, { steamId: SID_A, userId: alice });
    assert.equal(result.removed, 1);
    assert.equal((await q('select count(*)::int as n from steam_accounts where steam_id = $1', [SID_A])).rows[0].n, 0);
    assert.equal((await q('select count(*)::int as n from steam_games where steam_id = $1', [SID_A])).rows[0].n, 0);
    assert.equal((await q('select count(*)::int as n from steam_wishlist where steam_id = $1', [SID_A])).rows[0].n, 0);
    const watches = await q('select g.steam_appid from watchlist w join games g on g.id = w.game_id');
    assert.deepEqual(watches.rows.map((r) => r.steam_appid), [730], '自动提醒已清理，手动保留');

    // 账号不属于该用户时不解绑
    await insertAccount(store, { steamId: SID_B });
    const denied = await steamAccounts.unbindAccount(q, { steamId: SID_B, userId: alice });
    assert.equal(denied.removed, 0);
  } finally {
    await store.close();
  }
});

test('认领：未归属账号可认领、幂等、归属他人报错', async () => {
  const store = await freshStore();
  try {
    const q = (sql, p) => store.query(sql, p);
    await db.createUser(q, { username: 'admin', password: 'admin123456' });
    await db.createUser(q, { username: 'bob', password: 'bob123456' });
    await insertAccount(store, { steamId: SID_A, persona: 'FF' });

    const first = await steamAccounts.claimAccount(q, { username: 'admin', steamId: SID_A });
    assert.equal(first.claimed, true);
    const again = await steamAccounts.claimAccount(q, { username: 'admin', steamId: SID_A });
    assert.equal(again.claimed, false, '重复认领幂等');
    await assert.rejects(() => steamAccounts.claimAccount(q, { username: 'bob', steamId: SID_A }), /已归属/);
    await assert.rejects(() => steamAccounts.claimAccount(q, { username: 'nobody', steamId: SID_A }), /没有该用户/);
    await assert.rejects(() => steamAccounts.claimAccount(q, { username: 'admin', steamId: '76561198000000099' }), /没有该 Steam 账号/);
  } finally {
    await store.close();
  }
});

test('类型补全：只挑 app_type 缺失的 appid 请求 GetItems，补全后收敛、失败隔离', async () => {
  const store = await freshStore();
  try {
    const q = (sql, p) => store.query(sql, p);
    await db.createUser(q, { username: 'alice', password: 'alice123456' });
    const alice = (await q("select id from users where username = 'alice'")).rows[0].id;
    await insertAccount(store, { steamId: SID_A, userId: alice });
    await seedGame(store, 730, 'CS2');
    await seedGame(store, 570, 'DOTA2');
    await seedGame(store, 550, 'L4D2');
    await q("update games set app_type = 'dlc' where steam_appid = 570");
    await q("update games set app_type = 'game' where steam_appid = 550");
    await q('insert into steam_games (steam_id, appid) values ($1, 730), ($1, 570), ($1, 550)', [SID_A]);

    // 补全前统计：type_unknown=1（730；570 已是 dlc、550 已是 game，都不计入未知）
    const before = await steamAccounts.ownedTypeStats(q, SID_A);
    assert.deepEqual(before, { typeUnknown: 1 });

    // 第一次补全：只请求 730（缺失类型的），GetItems 回 dlc
    const calls = [];
    const fakeFetch = async (appids) => {
      calls.push([...appids]);
      return { items: [{ steamAppid: 730, appType: 'dlc' }], failed: [] };
    };
    const first = await steamAccounts.backfillOwnedAppTypes(q, { steamId: SID_A, apiKey: 'x', storeItemsFetch: fakeFetch });
    assert.equal(first.checked, 1);
    assert.deepEqual(calls[0], [730], '只请求类型缺失的 appid');
    assert.equal(first.typed, 1);
    assert.equal((await q('select app_type from games where steam_appid = 730')).rows[0].app_type, 'dlc');

    const stats = await steamAccounts.ownedTypeStats(q, SID_A);
    assert.deepEqual(stats, { typeUnknown: 0 }, '730 补全后未知=0');

    // 账号列表接口同口径：不再返回 dlc；type_unknown 保留（日志/诊断用）
    const list = await steamAccounts.listUserAccounts(q, alice);
    assert.equal('dlc' in list[0], false, '账号列表不再返回 dlc');
    assert.equal(Number(list[0].type_unknown), 0);

    // 第二次：无缺失 → 零请求收敛
    const second = await steamAccounts.backfillOwnedAppTypes(q, { steamId: SID_A, apiKey: 'x', storeItemsFetch: fakeFetch });
    assert.equal(second.checked, 0);
    assert.equal(calls.length, 1, '收敛后不再发请求');

    // 失败隔离：GetItems 抛错不炸，全部计入 failed
    await q('update games set app_type = null where steam_appid = 550');
    const failRun = await steamAccounts.backfillOwnedAppTypes(q, {
      steamId: SID_A,
      apiKey: 'x',
      storeItemsFetch: async () => {
        throw new Error('网络断了');
      },
    });
    assert.equal(failRun.checked, 1);
    assert.equal(failRun.typed, 0);
    assert.deepEqual(failRun.failed, [550]);
  } finally {
    await store.close();
  }
});

// ---------------------------------------------------------------- API 流程

const login = async (base, username, password) => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { cookie: (res.headers.get('set-cookie') ?? '').split(';')[0], status: res.status };
};

const startBind = async (base, cookie) => {
  const res = await fetch(`${base}/api/auth/steam/start`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = res.headers.get('location');
  // state 编码在 openid.return_to 的查询参数里（Steam 回调时原样带回）
  const returnTo = new URL(new URL(location, base).searchParams.get('openid.return_to'), base);
  const state = returnTo.searchParams.get('state');
  assert.ok(state, 'start 的跳转地址应带 state');
  return state;
};

const callbackUrl = (base, steamId, state) =>
  `${base}/api/auth/steam/callback?openid.claimed_id=${encodeURIComponent('https://steamcommunity.com/openid/id/' + steamId)}&state=${encodeURIComponent(state)}`;

test('绑定 API：未登录 401；state 防 CSRF；成功落库；他人占用 409；上限 409', async () => {
  const store = await freshStore();
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456' });
  await db.createUser(q, { username: 'bob', password: 'bob123456' });
  const srv = await startApiServer({
    query: q,
    port: 0,
    host: '127.0.0.1',
    steamVerify: async (url) => String(url.searchParams.get('openid.claimed_id') ?? '').match(/(\d{17})$/)?.[1] ?? null,
  });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    // 未登录不能发起绑定
    const anon = await fetch(`${base}/api/auth/steam/start`, { redirect: 'manual' });
    assert.equal(anon.status, 401);

    const alice = await login(base, 'alice', 'alice123456');
    const bob = await login(base, 'bob', 'bob123456');

    // alice 绑定 SID_A
    const stateA = await startBind(base, alice.cookie);
    const cb = await fetch(callbackUrl(base, SID_A, stateA), { headers: { cookie: alice.cookie }, redirect: 'manual' });
    assert.equal(cb.status, 302);
    assert.match(String(cb.headers.get('location')), /steamBound=1/);
    const row = (await q('select user_id, persona_name from steam_accounts where steam_id = $1', [SID_A])).rows[0];
    assert.equal(Number(row.user_id), (await q("select id from users where username='alice'")).rows[0].id);

    // state 已消费：重放同一 state 无效
    const replay = await fetch(callbackUrl(base, SID_A, stateA), { headers: { cookie: alice.cookie } });
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).code, 'state');

    // 他人占用 → 409
    const stateB = await startBind(base, bob.cookie);
    const conflict = await fetch(callbackUrl(base, SID_A, stateB), { headers: { cookie: bob.cookie } });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, 'conflict');

    // alice 已绑 1 个，再补 4 个到上限，第 6 个 → 409
    const aliceId = (await q("select id from users where username='alice'")).rows[0].id;
    for (let i = 2; i <= 5; i += 1) {
      await q('insert into steam_accounts (steam_id, persona_name, user_id) values ($1, $2, $3)', [
        '765611980000000' + (10 + i),
        'P' + i,
        aliceId,
      ]);
    }
    const stateC = await startBind(base, alice.cookie);
    const limit = await fetch(callbackUrl(base, SID_B, stateC), { headers: { cookie: alice.cookie } });
    assert.equal(limit.status, 409);
    assert.equal((await limit.json()).code, 'limit');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('账号管理 API：列表/别名/解绑/认领/游戏库，权限只认归属人', async () => {
  const store = await freshStore();
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456' });
  const aliceId = (await q("select id from users where username = 'alice'")).rows[0].id;
  const adminId = (await q("select id from users where username = 'admin'")).rows[0].id;
  await insertAccount(store, { steamId: SID_A, userId: aliceId, persona: '爱丽丝' });
  await insertAccount(store, { steamId: SID_B, persona: 'FF', alias: null });
  await q('insert into steam_games (steam_id, appid, name) values ($1, 730, $2)', [SID_A, 'CS2']);
  await q('insert into steam_wishlist (steam_id, appid) values ($1, 620)', [SID_A]);
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const alice = await login(base, 'alice', 'alice123456');
    const admin = await login(base, 'admin', 'admin123456');

    assert.equal((await fetch(`${base}/api/steam/accounts`)).status, 401, '未登录不能看账号列表');

    const list = await (await fetch(`${base}/api/steam/accounts`, { headers: { cookie: alice.cookie } })).json();
    assert.equal(list.accounts.length, 1);
    assert.equal(list.accounts[0].steam_id, SID_A);
    assert.equal(Number(list.accounts[0].games), 1);
    assert.equal(Number(list.accounts[0].wishlist), 1);
    assert.equal(list.limit, 5);
    assert.equal(list.unowned.length, 0, '普通用户看不到未归属账号');

    const adminList = await (await fetch(`${base}/api/steam/accounts`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(adminList.unowned.length, 1, '管理员能看到未归属账号（认领入口）');

    // 改别名
    const alias = await fetch(`${base}/api/steam/accounts/${SID_A}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ alias: '主号' }),
    });
    assert.equal(alias.status, 200);
    assert.equal((await q('select alias from steam_accounts where steam_id = $1', [SID_A])).rows[0].alias, '主号');

    // 游戏库列表（归属人）
    const lib = await (await fetch(`${base}/api/steam/accounts/${SID_A}/library`, { headers: { cookie: alice.cookie } })).json();
    assert.equal(lib.games.length, 1);
    assert.equal(lib.games[0].appid, 730);

    // 认领：普通用户 403；管理员可认领未归属账号；重复 409
    assert.equal(
      (await fetch(`${base}/api/steam/accounts/${SID_B}/claim`, { method: 'POST', headers: { cookie: alice.cookie } })).status,
      403,
    );
    assert.equal(
      (await fetch(`${base}/api/steam/accounts/${SID_B}/claim`, { method: 'POST', headers: { cookie: admin.cookie } })).status,
      200,
    );
    assert.equal(Number((await q('select user_id from steam_accounts where steam_id = $1', [SID_B])).rows[0].user_id), adminId);
    assert.equal(
      (await fetch(`${base}/api/steam/accounts/${SID_B}/claim`, { method: 'POST', headers: { cookie: admin.cookie } })).status,
      409,
    );

    // 解绑：只能归属人；级联清理
    assert.equal(
      (await fetch(`${base}/api/steam/accounts/${SID_A}`, { method: 'DELETE', headers: { cookie: admin.cookie } })).status,
      403,
    );
    const unbind = await fetch(`${base}/api/steam/accounts/${SID_A}`, { method: 'DELETE', headers: { cookie: alice.cookie } });
    assert.equal(unbind.status, 200);
    assert.equal((await q('select count(*)::int as n from steam_accounts where steam_id = $1', [SID_A])).rows[0].n, 0);
    assert.equal((await q('select count(*)::int as n from steam_games where steam_id = $1', [SID_A])).rows[0].n, 0);
    assert.equal((await q('select count(*)::int as n from steam_wishlist where steam_id = $1', [SID_A])).rows[0].n, 0);

    // /api/steam/me 兼容：账号数组 + 旧单账号字段
    const me = await (await fetch(`${base}/api/steam/me`, { headers: { cookie: alice.cookie } })).json();
    assert.deepEqual(me.accounts, []);
    assert.equal(me.steamId, null);
    const guest = await (await fetch(`${base}/api/steam/me`)).json();
    assert.deepEqual(guest.accounts, []);
    assert.equal(guest.steamId, null);
  } finally {
    await srv.close();
    await store.close();
  }
});

// ---------------------------------------------------------------- 已拥有推导

async function ownedSetup() {
  const store = await freshStore();
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'alice', password: 'alice123456' });
  await db.createUser(q, { username: 'bob', password: 'bob123456' });
  const aliceId = (await q("select id from users where username = 'alice'")).rows[0].id;
  await insertAccount(store, { steamId: SID_A, userId: aliceId, persona: 'ALICE MAIN', alias: '主号' });
  await insertAccount(store, { steamId: SID_B, userId: aliceId, persona: 'ALICE ALT', alias: null });
  await seedGame(store, 730, 'CS2');
  await seedGame(store, 550, 'L4D2');
  await seedGame(store, 620, '传送门2');
  await q('insert into steam_games (steam_id, appid, name) values ($1, 730, $2)', [SID_A, 'CS2']);
  await q('insert into steam_games (steam_id, appid, name) values ($1, 550, $2)', [SID_B, 'L4D2']);
  await q('insert into steam_wishlist (steam_id, appid) values ($1, 620)', [SID_A]);
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  return { store, q, srv, base: `http://127.0.0.1:${srv.port}` };
}

const search = (base, body, cookie) =>
  fetch(`${base}/api/games/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

test('已拥有推导：绑定账号库并集 + 谁拥有（owned_by）+ 愿望单（wishlisted），仅当前用户可见', async () => {
  const { store, q, srv, base } = await ownedSetup();
  try {
    const alice = await login(base, 'alice', 'alice123456');
    const bob = await login(base, 'bob', 'bob123456');
    const params = { page: 1, pageSize: 20, region: 'cn', type: 'all', sort: 'discount', q: '', interest: 'all', owned: 'include' };

    // alice：730 归「主号」，550 归「ALICE ALT」；620 不在库但愿望单有
    const mine = await (await search(base, params, alice.cookie)).json();
    const by = (appid) => mine.games.find((g) => g.steam_appid === appid);
    assert.equal(by(730).owned, true, '库里有 → 已拥有');
    assert.deepEqual(by(730).owned_by, [{ steamId: SID_A, name: '主号' }], 'owned_by 别名优先');
    assert.equal(by(550).owned, true);
    assert.deepEqual(by(550).owned_by, [{ steamId: SID_B, name: 'ALICE ALT' }], '无别名时用昵称');
    assert.equal(by(620).owned, false, '愿望单 ≠ 已拥有');
    assert.equal(by(620).wishlisted, true, '愿望单标记');

    // owned=only / exclude 按推导过滤
    const only = await (await search(base, { ...params, owned: 'only' }, alice.cookie)).json();
    assert.deepEqual(only.games.map((g) => g.steam_appid).sort(), [550, 730]);
    const exclude = await (await search(base, { ...params, owned: 'exclude' }, alice.cookie)).json();
    assert.deepEqual(exclude.games.map((g) => g.steam_appid), [620]);

    // wishlist=true 只出愿望单
    const wish = await (await search(base, { ...params, wishlist: true }, alice.cookie)).json();
    assert.deepEqual(wish.games.map((g) => g.steam_appid), [620]);
    assert.equal(wish.games[0].wishlisted, true);
    assert.deepEqual(wish.games[0].wishlisted_by, [{ steamId: SID_A, name: '主号' }], '愿望单归属账号');
    assert.equal(wish.games[0].site_wishlisted, false, '纯 Steam 同步项非本站手动');

    // bob / 游客看不到 alice 的任何推导
    const bobList = await (await search(base, params, bob.cookie)).json();
    assert.equal(bobList.games.find((g) => g.steam_appid === 730).owned, false);
    assert.deepEqual(bobList.games.find((g) => g.steam_appid === 730).owned_by, []);
    const guest = await (await search(base, params)).json();
    assert.equal(guest.games.find((g) => g.steam_appid === 730).owned, false);
    assert.deepEqual(guest.games.find((g) => g.steam_appid === 730).owned_by, []);
    // 游客的 owned=only / wishlist=true 一律无效（返回全量）
    const guestOnly = await (await search(base, { ...params, owned: 'only', wishlist: true })).json();
    assert.equal(guestOnly.games.length, 3, '未登录时已拥有/愿望单筛选无效');

    // 详情同样带推导
    const detail = await (await fetch(`${base}/api/games/730?region=cn`, { headers: { cookie: alice.cookie } })).json();
    assert.equal(detail.game.owned, true);
    assert.equal(detail.game.wishlisted, false);
    assert.deepEqual(detail.game.owned_by, [{ steamId: SID_A, name: '主号' }]);
    const detailWish = await (await fetch(`${base}/api/games/620?region=cn`, { headers: { cookie: alice.cookie } })).json();
    assert.deepEqual(detailWish.game.wishlisted_by, [{ steamId: SID_A, name: '主号' }]);
    assert.equal(detailWish.game.site_wishlisted, false);
    const guestDetail = await (await fetch(`${base}/api/games/730?region=cn`)).json();
    assert.equal(guestDetail.game.owned, false);
    assert.deepEqual(guestDetail.game.owned_by, []);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('CL 批已拥有口径：owned 只由 Steam 库并集决定，user_game_flags.owned 不再参与（历史字段保留但无效）', async () => {
  const { store, q, srv, base } = await ownedSetup();
  try {
    const alice = await login(base, 'alice', 'alice123456');
    const params = { page: 1, pageSize: 20, region: 'cn', type: 'all', sort: 'discount', q: '', interest: 'all', owned: 'include' };
    const flags = (owned) =>
      fetch(`${base}/api/games/730/flags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ owned }),
      });

    // 手动 owned=false（历史字段仍可写入）→ 库里有 730 → owned 仍是 true（字段不再参与口径）
    const setFalse = await (await flags(false)).json();
    assert.equal(setFalse.flags.user_owned, false, '历史字段照写不误');
    assert.equal(setFalse.flags.owned, true, 'CL：owned 口径只认 Steam 库并集，手动 false 不再排除');

    // 再次同步 → 依旧 true
    await steamAccounts.syncAccountLibrary(q, {
      steamId: SID_A,
      apiKey: 'x',
      fetchImpl: async () => [{ appid: 730, name: 'CS2', playtimeMinutes: 1, lastPlayedAt: null }],
    });
    let mine = await (await search(base, params, alice.cookie)).json();
    assert.equal(mine.games.find((g) => g.steam_appid === 730).owned, true, '同步后仍为已拥有');

    // clear 同样不影响推导
    const cleared = await (await flags('clear')).json();
    assert.equal(cleared.flags.owned, true, 'CL：清除手动字段后 owned 仍由库推导');
    mine = await (await search(base, params, alice.cookie)).json();
    assert.equal(mine.games.find((g) => g.steam_appid === 730).owned, true);

    // 手动 owned=true（库里没有的 620）→ owned 仍是 false（不开放手动标记口径）
    const added = await (await fetch(`${base}/api/games/620/flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ owned: true }),
    })).json();
    assert.equal(added.flags.user_owned, true, '历史字段照写不误');
    assert.equal(added.flags.owned, false, 'CL：库里没有就不算已拥有，手动标记无效');
  } finally {
    await srv.close();
    await store.close();
  }
});

// ============================================================ CO-5/B4-2 第七轮静态锁

test('CO-5/B4-2 第七轮：site 域路由分支全部在 src/routes/site.js（预检/公开/主三入口，删任一支即红）', () => {
  // 预检段：/api/ban/state（拦截链前，封禁自查）
  assert.match(SITE_ROUTES, /path !== '\/api\/ban\/state' \|\| req\.method !== 'GET'/, 'ban/state 分支在新文件');
  assert.match(SITE_ROUTES, /banStateLimited\(ip\)/, 'ban/state 自带限流随路由');
  // 公开段：/api/site
  assert.match(SITE_ROUTES, /path !== '\/api\/site' \|\| req\.method !== 'GET'/, 'site 分支在新文件');
  assert.match(SITE_ROUTES, /name: siteName\(\)/, '站点名走 ctx.siteName 闭包（语义共享）');
  assert.match(SITE_ROUTES, /appealEmail: appealEmail\(\)/, '申诉邮箱走 ctx.appealEmail 闭包（语义共享）');
  // 主段：/api/steam/*
  assert.match(SITE_ROUTES, /path === '\/api\/steam\/accounts' && req\.method === 'GET'/, '账号列表分支在新文件');
  assert.match(SITE_ROUTES, /path === '\/api\/steam\/me' && req\.method === 'GET'/, 'steam/me 兼容分支在新文件');
  assert.match(SITE_ROUTES, /accountAction\[2\] === 'claim' && req\.method === 'POST'/, '认领分支在新文件');
  assert.match(SITE_ROUTES, /accountAction\[2\] === 'library' && req\.method === 'POST' && accountAction\[3\] === 'sync'/, '库同步分支在新文件');
  assert.match(SITE_ROUTES, /accountAction\[2\] === 'wishlist' && req\.method === 'POST' && accountAction\[3\] === 'sync'/, '愿望单同步分支在新文件');
  assert.match(SITE_ROUTES, /accountAction\[2\] === 'library' && req\.method === 'GET'/, '库列表分支在新文件');
  assert.match(SITE_ROUTES, /accountAction\[2\] === 'wishlist' && req\.method === 'GET'/, '愿望单列表分支在新文件');
  assert.match(SITE_ROUTES, /accountMatch && req\.method === 'PATCH'/, '别名/API Key 分支在新文件');
  assert.match(SITE_ROUTES, /accountMatch && req\.method === 'DELETE'/, '解绑分支在新文件');
  assert.match(SITE_ROUTES, /accountDefaultMatch && req\.method === 'POST'/, '设默认账号分支在新文件');
  // 三个入口形态（§15.3 位置语义：预检段 + 公开段 + 主段）
  assert.match(SITE_ROUTES, /export async function handleSitePreflight\(ctx\)/, '预检段入口');
  assert.match(SITE_ROUTES, /export async function handleSitePublic\(ctx\)/, '公开段入口');
  assert.match(SITE_ROUTES, /export async function handleSiteRoutes\(ctx\)/, '主段入口');
  // 守卫与校验随路由：主段 requireUser（claim 另加 requireAdmin）、所有权/API Key 检查
  assert.match(SITE_ROUTES, /if \(!requireUser\(\)\) return true/, '主段登录守卫');
  assert.match(SITE_ROUTES, /if \(!requireAdmin\(\)\) return true/, '认领管理员守卫');
  assert.match(SITE_ROUTES, /error: '这个 Steam 账号不属于当前用户'/, '所有权 403 语义随路由');
  assert.match(SITE_ROUTES, /error: '该账号未配置 API Key，请先在后台填写'/, 'API Key 未配置语义随路由');
  assert.match(SITE_ROUTES, /error: '该账号已被认领'/, '认领冲突 409 语义随路由');
  // 路由模块只做编排：不许出现 SQL 字面量（全部走 repository）
  assert.ok(!/select |insert |update |delete from /.test(SITE_ROUTES), 'routes/site.js 不写 SQL 字面量');
  // 已写响应必须 return true（防宿主二次写头 ERR_HTTP_HEADERS_SENT，watchlist 域拆分回归教训）
  assert.match(SITE_ROUTES, /return false;/s, '未命中返回 false，宿主继续');
  assert.match(SITE_ROUTES, /'cache-control': 'no-store'/, 'ban/state no-store 头随路由');
});

test('CO-5/B4-2 第七轮：server.js 必须真实接线三个入口（删掉调用即红，防死模块）', () => {
  assert.match(SITE_SERVER, /import \{ handleSitePreflight, handleSitePublic, handleSiteRoutes \} from '\.\/routes\/site\.js'/, 'server.js 必须导入域路由三入口');
  // 锁「完整调用形态」：必须是 if (await handleXxx(...)) return;——只断言字符串存在会被 if(false) 包一层绕过；
  // 这个形态锁住"调用且消费返回值结束响应"。
  assert.match(SITE_SERVER, /if \(\s*await handleSitePreflight\(\{ path, req, res, json, ip, whitelisted, deviceId \}\)\) return;/, '预检段接线（含 ip/whitelisted/deviceId，且消费返回值）');
  assert.match(SITE_SERVER, /if \(\s*await handleSitePublic\(\{ path, req, res, q, json, siteName, appealEmail, siteCache, siteCacheTtlMs \}\)\) return;/, '公开段接线（含 siteName/appealEmail + DX 批 siteCache/siteCacheTtlMs，且消费返回值）');
  assert.match(SITE_SERVER, /if \(\s*await handleSiteRoutes\(\{[\s\S]{0,900}?url,[\s\S]{0,900}?user,[\s\S]{0,900}?requireUser,[\s\S]{0,900}?requireAdmin,/, '主段接线（含 url/user/requireUser/requireAdmin）');
  assert.match(SITE_SERVER, /if \(\s*await handleSiteRoutes\(\{[\s\S]{0,900}?q,[\s\S]{0,900}?logger,[\s\S]{0,900}?json,[\s\S]{0,900}?readBody,/, '主段接线（基座字段传齐）');
  // 三入口位置语义锁：预检段必须在 handleAppPreflight 之前、公开段必须在 handleAnnouncementsPublic 之前、
  // 主段必须在 handleWatchlistRoutes 之前（移动调用位置 = 改契约，§15.3）
  assert.match(SITE_SERVER, /handleSitePreflight\([\s\S]*?handleAppPreflight\(/s, '预检段调用在 App 预检段之前（拦截链前）');
  assert.match(SITE_SERVER, /handleSitePublic\([\s\S]*?handleAnnouncementsPublic\(/s, '公开段调用在公告公开段之前（认证上下文前）');
  assert.match(SITE_SERVER, /handleSiteRoutes\([\s\S]*?handleWatchlistRoutes\(/s, '主段调用在 watchlist 主段之前（原位置）');
});

test('CO-5/B4-2 第七轮：site 域路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/path === '\/api\/ban\/state' && req\.method/.test(SITE_SERVER), 'ban/state 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/site' && req\.method/.test(SITE_SERVER), 'site 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/steam\/accounts' && req\.method/.test(SITE_SERVER), '账号列表分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/steam\/me' && req\.method/.test(SITE_SERVER), 'steam/me 分支不得残留在 server.js');
  assert.ok(!/const accountAction = path\.match/.test(SITE_SERVER), 'claim/library/wishlist 分支不得残留在 server.js');
  assert.ok(!/const accountMatch = path\.match/.test(SITE_SERVER), 'PATCH/DELETE 分支不得残留在 server.js');
  assert.ok(!/const accountDefaultMatch = path\.match/.test(SITE_SERVER), 'default 分支不得残留在 server.js');
  // 域内 helper 已随域移入模块（断言定义与调用两处都不残留）
  assert.ok(!/const requireAccountOwner =/.test(SITE_SERVER), 'requireAccountOwner 定义不得残留在 server.js');
  assert.ok(!/const requireAccountApiKey =/.test(SITE_SERVER), 'requireAccountApiKey 定义不得残留在 server.js');
  assert.ok(!/const banStateBuckets = new Map/.test(SITE_SERVER), 'banState 限流桶定义不得残留在 server.js');
  assert.ok(!/function banStateLimited/.test(SITE_SERVER), 'banStateLimited 定义不得残留在 server.js');
  // 边界锁：admin 段仍留宿主（/api/admin/wishlists 属 B4 #16；steam-logs 已随 B4 #12
  // 拆到 routes/admin-reports.js，见 test/admin-reports.test.js）
  assert.match(SITE_SERVER, /path === '\/api\/admin\/wishlists' && req\.method === 'GET'/, 'admin wishlists 段留 server.js（B4 #16）');
});

test('CO-5/B4-2 第七轮：site-repository.js 签名不变 + pg.js re-export（删 re-export 即红）', () => {
  // 搬家函数签名与拆分前一致（旧 db.* 导入签名不变）
  assert.match(SITE_REPO, /export async function setDefaultSteamAccount\(q, \{ userId, steamId \}\)/, 'setDefaultSteamAccount 签名与拆分前一致');
  assert.match(SITE_REPO, /export async function clearDefaultSteamIfMatches\(q, \{ userId, steamId \}\)/, 'clearDefaultSteamIfMatches 签名与拆分前一致');
  assert.match(SITE_REPO, /export async function userLibraryItems\(q, \{ steamId, kind, kw = '', page = 1, pageSize = 10 \}\)/, 'userLibraryItems 签名与拆分前一致');
  // 域内联 SQL 抽出的七个新函数
  assert.match(SITE_REPO, /export async function registrationEnabledRow\(q\)/, '注册开关内联 SQL 已抽 registrationEnabledRow');
  assert.match(SITE_REPO, /export async function accountApiKeyEnc\(q, steamId\)/, 'API Key 内联 SQL 已抽 accountApiKeyEnc');
  assert.match(SITE_REPO, /export async function accountOwnerRow\(q, steamId\)/, '所有权检查内联 SQL 已抽 accountOwnerRow');
  assert.match(SITE_REPO, /export async function claimTargetRow\(q, steamId\)/, '认领目标内联 SQL 已抽 claimTargetRow');
  assert.match(SITE_REPO, /export async function claimSteamAccount\(q, \{ steamId, userId \}\)/, '认领写入内联 SQL 已抽 claimSteamAccount');
  assert.match(SITE_REPO, /export async function updateSteamAccountAlias\(q, \{ steamId, alias \}\)/, '别名写入内联 SQL 已抽 updateSteamAccountAlias');
  assert.match(SITE_REPO, /export async function steamAccountApiKeySet\(q, steamId\)/, 'API Key 回显内联 SQL 已抽 steamAccountApiKeySet');
  // 十个函数必须整体 re-export（旧 db.* 导入签名不变；test 与 server.js 其它段照旧走聚合壳）
  assert.match(SITE_PG, /export \{[\s\S]{0,500}setDefaultSteamAccount[\s\S]{0,500}clearDefaultSteamIfMatches[\s\S]{0,500}userLibraryItems[\s\S]{0,500}registrationEnabledRow[\s\S]{0,500}accountApiKeyEnc[\s\S]{0,500}accountOwnerRow[\s\S]{0,500}claimTargetRow[\s\S]{0,500}claimSteamAccount[\s\S]{0,500}updateSteamAccountAlias[\s\S]{0,500}steamAccountApiKeySet[\s\S]{0,500}\} from '\.\/site-repository\.js'/, 'pg.js 必须 re-export 十个函数');
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(!/export (async )?function (setDefaultSteamAccount|clearDefaultSteamIfMatches|userLibraryItems)/.test(SITE_PG), 'pg.js 不允许保留旧函数定义（只许 re-export）');
  // 边界判据锁：steam 表 DDL 在 steam-login.js（跨模块共用），site-repository 不放 DDL
  assert.ok(!/create table/.test(SITE_REPO), 'site-repository.js 不搬家 DDL（steam 表 DDL 在 steam-login.js）');
});

// ---------------------------------------------------------------- EM 批（docs/STEAM-SYNC-TIMEOUT.md EL-2）

const emSetup = async () => {
  const store = await freshStore();
  const q = (sql, p) => store.query(sql, p);
  const aliceRow = await db.createUser(q, { username: 'alice', password: 'alice123456' });
  await db.createUser(q, { username: 'bob', password: 'bob123456' });
  await insertAccount(store, { steamId: SID_A, userId: aliceRow.id, persona: '爱丽丝' });
  const savedSecret = process.env.SECRET_KEY;
  process.env.SECRET_KEY = 'em-test-secret-key-16chars+';
  const auth = await import('../src/email-auth.js');
  const enc = auth.encryptSecret('em-test-api-key', process.env.SECRET_KEY);
  await steamAccounts.setAccountApiKey(q, { steamId: SID_A, apiKeyEnc: enc });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  return { store, q, srv, base: `http://127.0.0.1:${srv.port}`, savedSecret };
};

const emTeardown = async ({ srv, store, savedSecret }) => {
  await srv.close();
  await store.close();
  if (savedSecret === undefined) delete process.env.SECRET_KEY;
  else process.env.SECRET_KEY = savedSecret;
  resetSteamSyncTasksForTest();
};

test('EM EL-2：同步触发立即 202；single-flight 重复 409；状态 idle→running→idle 带结果', async () => {
  const env = await emSetup();
  const { base } = env;
  try {
    resetSteamSyncTasksForTest();
    const alice = await login(base, 'alice', 'alice123456');
    assert.equal(alice.status, 200);
    // 匿名 401
    assert.equal((await fetch(`${base}/api/steam/accounts/${SID_A}/wishlist/sync`, { method: 'POST' })).status, 401, '匿名 401');
    // 触发：立即 202（不再同步阻塞被 15s 看门狗砍掉——验收②）
    const first = await fetch(`${base}/api/steam/accounts/${SID_A}/wishlist/sync`, { method: 'POST', headers: { cookie: alice.cookie } });
    assert.equal(first.status, 202);
    const firstBody = await first.json();
    assert.equal(firstBody.accepted, true);
    // 进行中重复触发 → 409「进行中」（验收③ single-flight）
    const second = await fetch(`${base}/api/steam/accounts/${SID_A}/wishlist/sync`, { method: 'POST', headers: { cookie: alice.cookie } });
    assert.equal(second.status, 409);
    assert.match((await second.json()).error, /正在同步中/);
    // 状态查询接口可用：running 或 idle 都是合法瞬时态
    const st = await (await fetch(`${base}/api/steam/accounts/${SID_A}/sync-status`, { headers: { cookie: alice.cookie } })).json();
    assert.ok(['running', 'idle'].includes(st.status), `状态合法，实际 ${st.status}`);
    // 等后台任务结束（本地无 Steam 出口 → 快速失败；8s×2 重试后最长约 16s）；轮询 ≤ 45s
    const deadline = Date.now() + 45000;
    let done = null;
    while (Date.now() < deadline) {
      const now = await (await fetch(`${base}/api/steam/accounts/${SID_A}/sync-status`, { headers: { cookie: alice.cookie } })).json();
      if (now.status === 'idle') {
        done = now;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(done, '后台任务最终结束');
    assert.equal(typeof done.lastResult.ok, 'boolean', 'lastResult 必须带 ok');
    if (!done.lastResult.ok) {
      // 失败必须带原因，且不再是「请求超时，请稍后再试」笼统错误（验收③/EL-3）
      assert.ok(done.lastResult.error, '失败必须带原因');
      assert.doesNotMatch(String(done.lastResult.error), /请求超时，请稍后再试/);
    }
    assert.equal(done.task, null, '结束后 task 清空');
    // 权限：bob 不是归属人 → 403；匿名 → 401
    const bob = await login(base, 'bob', 'bob123456');
    assert.equal((await fetch(`${base}/api/steam/accounts/${SID_A}/sync-status`, { headers: { cookie: bob.cookie } })).status, 403, '非归属人 403');
    assert.equal((await fetch(`${base}/api/steam/accounts/${SID_A}/sync-status`)).status, 401, '匿名 401');
  } finally {
    await emTeardown(env);
  }
});

test('EM EL-2：sync-status 无进程内任务时兜底 steam_account_logs 最近一次结果', async () => {
  const env = await emSetup();
  const { q, base } = env;
  try {
    resetSteamSyncTasksForTest();
    // 直接造一条历史同步失败审计（模拟进程重启后进程内 Map 为空）
    const steamLogMod = await import('../src/steam-log.js');
    await steamLogMod.recordSteamLog(q, {
      action: 'sync-wishlist',
      steamId: SID_A,
      actor: 'self',
      result: 'failed',
      detail: { reason: 'HTTP 429' },
      error: 'HTTP 429 Too Many Requests',
    });
    const alice = await login(base, 'alice', 'alice123456');
    const st = await (await fetch(`${base}/api/steam/accounts/${SID_A}/sync-status`, { headers: { cookie: alice.cookie } })).json();
    assert.equal(st.status, 'idle');
    assert.equal(st.task, null);
    assert.equal(st.lastResult.ok, false);
    assert.equal(st.lastResult.kind, 'wishlist');
    assert.match(String(st.lastResult.error), /429/, '兜底结果带真实失败原因');
  } finally {
    await emTeardown(env);
  }
});

