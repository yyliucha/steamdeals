// Steam 多账号绑定：schema 迁移、库/愿望单差集删除、愿望单→到价提醒对账、
// 认领/解绑/别名 API、已拥有推导（owned_by / wishlisted / 手动排除恢复）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureSteamSchema } from '../src/steam-login.js';
import * as steamAccounts from '../src/steam-accounts.js';

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

test('手动标记与推导：owned=false 永久排除（再同步不恢复），clear 回到跟随推导', async () => {
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

    // 手动取消（Steam 库里有）→ 标记消失
    const setFalse = await (await flags(false)).json();
    assert.equal(setFalse.flags.owned, false);
    assert.equal(setFalse.flags.user_owned, false);

    // 再次同步（模拟调度器）→ 不恢复
    await steamAccounts.syncAccountLibrary(q, {
      steamId: SID_A,
      apiKey: 'x',
      fetchImpl: async () => [{ appid: 730, name: 'CS2', playtimeMinutes: 1, lastPlayedAt: null }],
    });
    let mine = await (await search(base, params, alice.cookie)).json();
    assert.equal(mine.games.find((g) => g.steam_appid === 730).owned, false, '永久排除不被同步恢复');

    // 恢复跟随推导
    const cleared = await (await flags('clear')).json();
    assert.equal(cleared.flags.owned, true, '清除后回到库推导');
    mine = await (await search(base, params, alice.cookie)).json();
    assert.equal(mine.games.find((g) => g.steam_appid === 730).owned, true);

    // 手动加已拥有（库里没有的 620）
    const added = await (await fetch(`${base}/api/games/620/flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ owned: true }),
    })).json();
    assert.equal(added.flags.owned, true);
    assert.deepEqual(added.flags.user_owned, true);
  } finally {
    await srv.close();
    await store.close();
  }
});
