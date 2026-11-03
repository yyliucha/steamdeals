// 手动愿望单 + Steam 推送：user_wishlist 落库、账号自配 API Key（密文）、
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
    steamWishlistPush: async ({ steamId, apiKey, appid, action }) => {
      calls.push({ steamId, apiKey, appid, action });
      return { ok: true };
    },
  });
  return { store, q, srv, base: `http://127.0.0.1:${srv.port}`, calls };
}

const search = (base, body, cookie) =>
  fetch(`${base}/api/games/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

test('添加愿望单：站点落库 + 所选账号推送（无 key 的账号失败提示），推导并入愿望单', async () => {
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
    assert.deepEqual(body.added, [SID_A], '有 key 的账号推送成功');
    assert.equal(body.failed.length, 1);
    assert.equal(body.failed[0].steamId, SID_B);
    assert.match(body.failed[0].reason, /API Key/);
    assert.equal(calls.length, 1, '只对配了 key 的账号发推送');
    assert.deepEqual(calls[0], { steamId: SID_A, apiKey: 'KEY-A', appid: 730, action: 'add' });

    const uw = (await q('select steam_ids from user_wishlist where user_id = (select id from users where username = $1)', ['alice'])).rows[0];
    assert.deepEqual([...(uw.steam_ids ?? [])].sort(), [SID_A, SID_B], '选择记录落库');
    assert.equal((await q('select count(*)::int as n from steam_wishlist where steam_id = $1 and appid = 730', [SID_A])).rows[0].n, 1, '乐观写 steam_wishlist');
    const watch = (await q("select source, target_cents, note from watchlist where game_id = (select id from games where steam_appid = 730)")).rows[0];
    assert.equal(watch.source, 'user_wishlist');
    assert.equal(watch.target_cents, null);
    assert.equal(watch.note, '愿望单');

    // 推导：alice 愿望单过滤命中；bob/游客不可见
    const params = { page: 1, pageSize: 20, region: 'cn', type: 'all', sort: 'discount', q: '', interest: 'all', owned: 'include', wishlist: true };
    const mine = await (await search(base, params, alice)).json();
    assert.deepEqual(mine.games.map((g) => g.steam_appid), [730]);
    assert.equal(mine.games[0].wishlisted, true);
    assert.deepEqual(mine.games[0].wishlisted_by, [{ steamId: SID_A, name: '主号' }], '列表返回归属账号');
    assert.equal(mine.games[0].site_wishlisted, true, '本站手动项标记');
    const bobList = await (await search(base, params, bob)).json();
    assert.equal(bobList.games.length, 0, 'bob 看不到 alice 的愿望单');
    const guest = await (await search(base, params)).json();
    assert.equal(guest.games.length, 2, '游客 wishlist=true 无效，返回全量');
    assert.equal(guest.games[0].site_wishlisted, false, '游客不返回归属信息');
    assert.deepEqual(guest.games[0].wishlisted_by, []);

    // 详情同样带归属
    const detail730 = await (await fetch(`${base}/api/games/730?region=cn`, { headers: { cookie: alice } })).json();
    assert.deepEqual(detail730.game.wishlisted_by, [{ steamId: SID_A, name: '主号' }]);
    assert.equal(detail730.game.site_wishlisted, true);

    // alreadyIn：再次添加已在愿望单的账号 → 不重复推送
    calls.length = 0;
    const again = await fetch(`${base}/api/wishlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ appid: 730, steamIds: [SID_A] }),
    });
    assert.equal(again.status, 200);
    const againBody = await again.json();
    assert.deepEqual(againBody.added, []);
    assert.deepEqual(againBody.alreadyIn, [SID_A], '该账号已在愿望单');
    assert.equal(calls.length, 0, '已在愿望单不重复推送');

    // 非本人账号被过滤
    const filtered = await fetch(`${base}/api/wishlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ appid: 550, steamIds: ['76561198000000099'] }),
    });
    assert.equal(filtered.status, 200);
    assert.deepEqual((await filtered.json()).added, []);
    const uw2 = (await q('select steam_ids from user_wishlist where game_id = (select id from games where steam_appid = 550)')).rows[0];
    assert.deepEqual([...(uw2.steam_ids ?? [])], [], '非本人账号丢弃');

    // 未登录不能加
    assert.equal((await fetch(`${base}/api/wishlist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appid: 730 }) })).status, 401);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('移除愿望单：清站点行与自动提醒、回推删除所选/持有账号，手动提醒保留', async () => {
  const { store, q, srv, base, calls } = await apiSetup();
  try {
    const alice = await login(base, 'alice', 'alice123456');
    // 730 已有手动提醒（设了目标价，不允许被清理）
    const g730 = (await q('select id from games where steam_appid = 730')).rows[0].id;
    await db.upsertWatch(q, { gameId: g730, targetCents: 3000, note: '手动' });
    // 550 先加（自动提醒），且 SID_A 愿望单里本就有 550（模拟 Steam 原生）
    await q('insert into steam_wishlist (steam_id, appid) values ($1, 550)', [SID_A]);
    await fetch(`${base}/api/wishlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ appid: 550, steamIds: [SID_A] }),
    });

    // 移除 550：steam_ids=[SID_A] 且 SID_A 持有 → 推 remove、删本地行
    calls.length = 0;
    const g550 = (await q('select id from games where steam_appid = 550')).rows[0].id;
    const res = await fetch(`${base}/api/wishlist/550`, { method: 'DELETE', headers: { cookie: alice } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.removedFromSteam, [SID_A]);
    assert.equal(body.siteRemoved, 1);
    assert.deepEqual(calls, [{ steamId: SID_A, apiKey: 'KEY-A', appid: 550, action: 'remove' }]);
    assert.equal((await q('select count(*)::int as n from user_wishlist where game_id = $1', [g550])).rows[0].n, 0);
    assert.equal((await q('select count(*)::int as n from steam_wishlist where steam_id = $1 and appid = 550', [SID_A])).rows[0].n, 0, 'steam_wishlist 行删除');
    const watches = await q('select g.steam_appid, w.source, w.target_cents from watchlist w join games g on g.id = w.game_id order by g.steam_appid');
    assert.deepEqual(watches.rows, [{ steam_appid: 730, source: 'manual', target_cents: 3000 }], '550 自动提醒清理、730 手动提醒保留');

    // 移除 730（只有手动提醒、无 user_wishlist 行）：仍可调用，无目标账号不推
    const res2 = await fetch(`${base}/api/wishlist/730`, { method: 'DELETE', headers: { cookie: alice } });
    assert.equal(res2.status, 200);
    assert.deepEqual((await res2.json()).removedFromSteam, []);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('移除选择：body 传 {siteWishlist, steamIds} 可选移除；缺省 body 保持旧行为', async () => {
  const { store, q, srv, base, calls } = await apiSetup();
  try {
    const alice = await login(base, 'alice', 'alice123456');
    await fetch(`${base}/api/wishlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ appid: 730, steamIds: [SID_A] }),
    });

    // 取消勾选「本站」：siteWishlist=false → 本站行保留、Steam 行删除
    calls.length = 0;
    const res = await fetch(`${base}/api/wishlist/730`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ siteWishlist: false, steamIds: [SID_A] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.siteRemoved, 0, '本站行保留');
    assert.deepEqual(body.removedFromSteam, [SID_A]);
    assert.deepEqual(calls, [{ steamId: SID_A, apiKey: 'KEY-A', appid: 730, action: 'remove' }]);
    assert.equal((await q('select count(*)::int as n from user_wishlist where game_id = (select id from games where steam_appid = 730)')).rows[0].n, 1, 'user_wishlist 保留');
    assert.equal((await q('select count(*)::int as n from steam_wishlist where steam_id = $1 and appid = 730', [SID_A])).rows[0].n, 0, 'steam_wishlist 删除');

    // 只移除本站：siteWishlist=true、steamIds=[] → 不推任何账号
    await q('insert into steam_wishlist (steam_id, appid) values ($1, 730)', [SID_A]);
    calls.length = 0;
    const res2 = await fetch(`${base}/api/wishlist/730`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ siteWishlist: true, steamIds: [] }),
    });
    const body2 = await res2.json();
    assert.equal(body2.siteRemoved, 1);
    assert.deepEqual(body2.removedFromSteam, []);
    assert.equal(calls.length, 0, '未勾选账号不推送');
    assert.equal((await q('select count(*)::int as n from steam_wishlist where steam_id = $1 and appid = 730', [SID_A])).rows[0].n, 1, 'Steam 行保留');

    // 缺省 body（旧调用方）：删本站 + 回推全部持有账号
    calls.length = 0;
    const res3 = await fetch(`${base}/api/wishlist/730`, { method: 'DELETE', headers: { cookie: alice } });
    assert.equal(res3.status, 200);
    const body3 = await res3.json();
    assert.equal(body3.siteRemoved, 0, '本站行已在上一轮删除');
    assert.deepEqual(body3.removedFromSteam, [SID_A]);
    assert.deepEqual(calls, [{ steamId: SID_A, apiKey: 'KEY-A', appid: 730, action: 'remove' }]);
    assert.equal((await q('select count(*)::int as n from steam_wishlist where steam_id = $1 and appid = 730', [SID_A])).rows[0].n, 0, '旧行为回推全部持有账号');
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
