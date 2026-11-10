// 手动愿望单（BE 批起只写本站，不推 Steam）：user_wishlist 落库、账号自配 API Key（密文）、
// Add/RemoveToWishlist 推送解析、愿望单推导（手动 ∪ Steam）、自动提醒清理。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureSteamSchema } from '../src/steam-login.js';
import * as steamAccounts from '../src/steam-accounts.js';
import { encryptSecret, decryptSecret, loadSecretKey } from '../src/email-auth.js';

process.env.CAPTCHA_ENABLED = '0';
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
  await q('insert into games (steam_appid, name, name_en) values ($1, $2, $3) on conflict (steam_appid) do nothing', [appid, name, name]);
  const gameId = (await q('select id from games where steam_appid = $1', [appid])).rows[0].id;
  await q(
    "insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) values ($1, 'steam', 'cn', current_date - 1, 9900, 'CNY')",
    [gameId],
  );
  // AV 批：原始 SQL 种价不进读模型，手动刷新（列表搜索需要快照行）
  await db.refreshGameRegionPrices(q, gameId);
  await db.refreshGameRegionHist(q, gameId);
  return gameId;
};

const insertAccount = async (store, { steamId, userId = null, persona = '测试', alias = null, apiKey = null }) => {
  await store.query('insert into steam_accounts (steam_id, persona_name, alias, user_id, api_key_enc) values ($1, $2, $3, $4, $5)', [
    steamId,
    persona,
    alias,
    userId,
    apiKey ? encryptSecret(apiKey, loadSecretKey()) : null,
  ]);
};

const login = async (base, username, password) => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
};

// ---------------------------------------------------------------- schema 与推送解析

test('schema：user_wishlist 表与 steam_accounts.api_key_enc 都在', async () => {
  const store = await freshStore();
  try {
    const q = (sql, p) => store.query(sql, p);
    const cols = async (table) =>
      (await q('select column_name from information_schema.columns where table_name = $1', [table])).rows.map((r) => r.column_name);
    const uw = await cols('user_wishlist');
    for (const name of ['user_id', 'game_id', 'steam_ids', 'created_at']) assert.ok(uw.includes(name), `user_wishlist 应有 ${name}`);
    assert.ok((await cols('steam_accounts')).includes('api_key_enc'), 'steam_accounts 应有 api_key_enc');
  } finally {
    await store.close();
  }
});

test('pushWishlistItem：防御式解析（2xx + 无显式失败即成功），失败带原因', async () => {
  const ok = await steamAccounts.pushWishlistItem({ steamId: SID_A, apiKey: 'k', appid: 730, fetchImpl: async () => ({ status: 200, json: { success: true } }) });
  assert.deepEqual(ok, { ok: true });
  const okEmpty = await steamAccounts.pushWishlistItem({ steamId: SID_A, apiKey: 'k', appid: 730, action: 'remove', fetchImpl: async () => ({ status: 200, json: {} }) });
  assert.equal(okEmpty.ok, true, '空响应体 2xx 也视为成功（接口无文档，靠同步对账兜底）');
  const explicitFail = await steamAccounts.pushWishlistItem({ steamId: SID_A, apiKey: 'k', appid: 730, fetchImpl: async () => ({ status: 200, json: { response: { success: false } } }) });
  assert.equal(explicitFail.ok, false);
  assert.match(explicitFail.reason, /success:false/);
  const httpFail = await steamAccounts.pushWishlistItem({ steamId: SID_A, apiKey: 'k', appid: 730, fetchImpl: async () => ({ status: 403, json: {} }) });
  assert.equal(httpFail.ok, false);
  assert.match(httpFail.reason, /403/);
  const thrown = await steamAccounts.pushWishlistItem({ steamId: SID_A, apiKey: 'k', appid: 730, fetchImpl: async () => { throw new Error('网络断了'); } });
  assert.equal(thrown.ok, false);
  assert.match(thrown.reason, /网络断了/);
});

// ---------------------------------------------------------------- API 流程

async function apiSetup() {
  const store = await freshStore();
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'alice', password: 'alice123456' });
  await db.createUser(q, { username: 'bob', password: 'bob123456' });
  const aliceId = (await q("select id from users where username = 'alice'")).rows[0].id;
  await insertAccount(store, { steamId: SID_A, userId: aliceId, persona: '主号', alias: '主号', apiKey: 'KEY-A' });
  await insertAccount(store, { steamId: SID_B, userId: aliceId, persona: '小号' }); // 没配 key
  await seedGame(store, 730, 'CS2');
  await seedGame(store, 550, 'L4D2');
  const calls = [];
  const srv = await startApiServer({
    query: q,
    port: 0,
    host: '127.0.0.1',
    // BE 批：推送注入已下线（愿望单只写本站）；calls 数组仅用于断言「一次都没调用」
    steamWishlistPush: (args) => { calls.push(args); return { ok: true }; },
  });
  return { store, q, srv, base: `http://127.0.0.1:${srv.port}`, calls };
}

const search = (base, body, cookie) =>
  fetch(`${base}/api/games/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

test('添加愿望单：只写本站 + 建自动提醒；steamIds 忽略（不推 Steam、不写 steam_wishlist），推导过滤仍生效', async () => {
  const { store, q, srv, base, calls } = await apiSetup();
  try {
    const alice = await login(base, 'alice', 'alice123456');
    const bob = await login(base, 'bob', 'bob123456');
    const res = await fetch(`${base}/api/wishlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ appid: 730, steamIds: [SID_A, SID_B] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.added, [], '不再推送 Steam');
    assert.deepEqual(body.failed, []);
    assert.equal(calls.length, 0, '整条推送路径不再触发');
    const uw = (await q('select steam_ids from user_wishlist where user_id = (select id from users where username = $1)', ['alice'])).rows[0];
    assert.deepEqual([...(uw.steam_ids ?? [])], [], '选择账号不再落库（steamIds 忽略）');
    assert.equal((await q('select count(*)::int as n from steam_wishlist')).rows[0].n, 0, '不写 Steam 同步表');
    const watch = (await q("select source, target_cents, note from watchlist where game_id = (select id from games where steam_appid = 730)")).rows[0];
    assert.equal(watch.source, 'user_wishlist');
    assert.equal(watch.target_cents, null);
    assert.equal(watch.note, '愿望单');

    // 推导：alice 愿望单过滤命中；bob/游客不可见；不再返回账号归属（wishlisted_by）
    const params = { page: 1, pageSize: 20, region: 'cn', type: 'all', sort: 'discount', q: '', interest: 'all', owned: 'include', wishlist: true };
    const mine = await (await search(base, params, alice)).json();
    assert.deepEqual(mine.games.map((g) => g.steam_appid), [730]);
    assert.equal(mine.games[0].wishlisted, true);
    assert.deepEqual(mine.games[0].wishlisted_by, [], '不再返回 Steam 账号归属');
    assert.equal(mine.games[0].site_wishlisted, true, '本站手动项标记');
    const bobList = await (await search(base, params, bob)).json();
    assert.equal(bobList.games.length, 0, 'bob 看不到 alice 的愿望单');
    const guest = await (await search(base, params)).json();
    assert.equal(guest.games.length, 2, '游客 wishlist=true 无效，返回全量');
    assert.equal(guest.games[0].site_wishlisted, false, '游客不返回归属信息');
    assert.deepEqual(guest.games[0].wishlisted_by, []);

    // 详情同样不展示账号归属
    const detail730 = await (await fetch(`${base}/api/games/730?region=cn`, { headers: { cookie: alice } })).json();
    assert.deepEqual(detail730.game.wishlisted_by, []);
    assert.equal(detail730.game.site_wishlisted, true);

    // 重复加入幂等
    const again = await fetch(`${base}/api/wishlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ appid: 730, steamIds: [SID_A] }),
    });
    assert.equal(again.status, 200);
    assert.deepEqual((await again.json()).added, []);

    // 未登录不能加
    assert.equal((await fetch(`${base}/api/wishlist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appid: 730 }) })).status, 401);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('移除愿望单：只删本站与自动提醒（不回推 Steam），Steam 同步数据与手动提醒都不动', async () => {
  const { store, q, srv, base, calls } = await apiSetup();
  try {
    const alice = await login(base, 'alice', 'alice123456');
    const g730 = (await q('select id from games where steam_appid = 730')).rows[0].id;
    await db.upsertWatch(q, { gameId: g730, targetCents: 3000, note: '手动' });
    await q('insert into steam_wishlist (steam_id, appid) values ($1, 550)', [SID_A]);
    await fetch(`${base}/api/wishlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ appid: 550, steamIds: [SID_A] }),
    });
    calls.length = 0;
    const g550 = (await q('select id from games where steam_appid = 550')).rows[0].id;
    const res = await fetch(`${base}/api/wishlist/550`, { method: 'DELETE', headers: { cookie: alice } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.siteRemoved, 1);
    assert.deepEqual(body.removedFromSteam, [], '不再回推 Steam');
    assert.equal(calls.length, 0, '不调用 Add/RemoveToWishlist');
    assert.equal((await q('select count(*)::int as n from user_wishlist where game_id = $1', [g550])).rows[0].n, 0);
    assert.equal((await q('select count(*)::int as n from steam_wishlist where steam_id = $1 and appid = 550', [SID_A])).rows[0].n, 1, 'Steam 同步数据保留（由每日同步自行对账）');
    const watches = await q('select g.steam_appid, w.source, w.target_cents from watchlist w join games g on g.id = w.game_id order by g.steam_appid');
    assert.deepEqual(watches.rows, [{ steam_appid: 730, source: 'manual', target_cents: 3000 }], '550 自动提醒清理、730 手动提醒保留');

    // 没有本站行也可以调用（200，删 0 条）
    const res2 = await fetch(`${base}/api/wishlist/730`, { method: 'DELETE', headers: { cookie: alice } });
    assert.equal(res2.status, 200);
    assert.equal((await res2.json()).siteRemoved, 0);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('移除 body 兼容忽略：siteWishlist/steamIds 不再影响结果，统一只删本站', async () => {
  const { store, q, srv, base, calls } = await apiSetup();
  try {
    const alice = await login(base, 'alice', 'alice123456');
    await fetch(`${base}/api/wishlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ appid: 730, steamIds: [SID_A] }),
    });
    await q('insert into steam_wishlist (steam_id, appid) values ($1, 730)', [SID_A]);
    calls.length = 0;
    const res = await fetch(`${base}/api/wishlist/730`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ siteWishlist: false, steamIds: [SID_A] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.siteRemoved, 1, 'body 被忽略，仍删本站');
    assert.deepEqual(body.removedFromSteam, []);
    assert.equal(calls.length, 0);
    assert.equal((await q('select count(*)::int as n from user_wishlist where game_id = (select id from games where steam_appid = 730)')).rows[0].n, 0);
    assert.equal((await q('select count(*)::int as n from steam_wishlist where steam_id = $1 and appid = 730', [SID_A])).rows[0].n, 1, 'Steam 行保留');
    // 再次删除：200，删 0 条
    const res2 = await fetch(`${base}/api/wishlist/730`, { method: 'DELETE', headers: { cookie: alice } });
    assert.equal(res2.status, 200);
    assert.equal((await res2.json()).siteRemoved, 0);
  } finally {
    await srv.close();
    await store.close();
  }
});
test('账号 API Key：PATCH 加密写入、列表回显状态、清除', async () => {
  const { store, q, srv, base } = await apiSetup();
  try {
    const alice = await login(base, 'alice', 'alice123456');
    const list = await (await fetch(`${base}/api/steam/accounts`, { headers: { cookie: alice } })).json();
    assert.equal(list.accounts.find((a) => a.steam_id === SID_A).api_key_set, true, '已有 key 的账号状态为 true');
    assert.equal(list.accounts.find((a) => a.steam_id === SID_B).api_key_set, false);

    const set = await fetch(`${base}/api/steam/accounts/${SID_B}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ apiKey: 'NEW-KEY-B' }),
    });
    assert.equal(set.status, 200);
    assert.equal((await set.json()).apiKeySet, true);
    const enc = (await q('select api_key_enc from steam_accounts where steam_id = $1', [SID_B])).rows[0].api_key_enc;
    assert.ok(enc && enc.length > 32, '落库的是密文');
    assert.equal(decryptSecret(enc, loadSecretKey()), 'NEW-KEY-B', '密文可解密回明文');

    const clear = await fetch(`${base}/api/steam/accounts/${SID_B}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ clearApiKey: true }),
    });
    assert.equal(clear.status, 200);
    assert.equal((await clear.json()).apiKeySet, false);
    assert.equal((await q('select api_key_enc from steam_accounts where steam_id = $1', [SID_B])).rows[0].api_key_enc, null);
  } finally {
    await srv.close();
    await store.close();
  }
});
