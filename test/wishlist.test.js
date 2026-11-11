// BE 批（docs/WISHLIST-SITE-ONLY.md §4.1/§5）：愿望单只写本站——旧 steamIds 忽略不报错/不推送，
// 加入建史低提醒、移除只删本站并清自动提醒；前台直加/确认移除（静态）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { ensureSteamSchema } from '../src/steam-login.js';
import { startApiServer, resetLoginThrottleForTest } from '../src/server.js';

process.env.CAPTCHA_ENABLED = '0';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

async function setup() {
  resetLoginThrottleForTest();
  const events = [];
  const logger = {
    trace() {},
    debug() {},
    info: (e, f) => events.push([e, f]),
    warn: (e, f) => events.push([e, f]),
    error: (e, f) => events.push([e, f]),
  };
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureSteamSchema(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'alice', password: 'k7Qw!2mXp3nZ', role: 'user', email: 'alice@example.com' });
  const alice = (await q("select id from users where username = 'alice'")).rows[0];
  await q("insert into games (steam_appid, name) values (700001, '有AppID')");
  await q("insert into games (steam_appid, name) values (null, '无AppID')");
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1', logger });
  const base = `http://127.0.0.1:${srv.port}`;
  const loginRes = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'k7Qw!2mXp3nZ' }),
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const req = async (path, method, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body == null ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { store, q, srv, base, cookie, alice, events, req };
}

const wishRow = async (q, userId, gameId) =>
  (await q('select 1 as n from user_wishlist where user_id = $1 and game_id = $2', [userId, gameId])).rows[0] ?? null;
const watchCount = async (q, gameId) =>
  Number((await q("select count(*)::int as n from watchlist where game_id = $1 and source = 'user_wishlist'", [gameId])).rows[0].n);

test('加入：旧 steamIds 字段忽略——只写本站 + 建史低提醒，不写 steam_wishlist', async () => {
  const ctx = await setup();
  const game = (await ctx.q('select id from games where steam_appid = 700001')).rows[0];
  try {
    const r = await ctx.req('/api/wishlist', 'POST', { appid: 700001, steamIds: ['76561198000000001'] });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.added, [], '不再推送');
    assert.deepEqual(r.body.failed, []);
    const row = await wishRow(ctx.q, ctx.alice.id, game.id);
    assert.ok(row, '本站行已写入');
    const uwCols = (await ctx.q("select column_name from information_schema.columns where table_name = 'user_wishlist'")).rows.map((c) => c.column_name);
    assert.ok(!uwCols.includes('steam_ids'), 'user_wishlist.steam_ids 列已随 BF 批删除');
    assert.equal(await watchCount(ctx.q, game.id), 1, '建自动史低提醒');
    assert.equal((await ctx.q('select count(*)::int as n from steam_wishlist')).rows[0].n, 0, '不写 Steam 同步表');
    const added = ctx.events.find(([e]) => e === 'wishlist.added');
    assert.ok(added, '日志 wishlist.added');
    assert.equal(added[1].gameId, game.id);
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('加入：无 Steam AppID 走 gameId；重复加入幂等（不报错、不重复建提醒）', async () => {
  const ctx = await setup();
  const game = (await ctx.q("select id from games where name = '无AppID'")).rows[0];
  try {
    const first = await ctx.req('/api/wishlist', 'POST', { gameId: game.id });
    assert.equal(first.status, 200);
    assert.equal(first.body.appid, null);
    const again = await ctx.req('/api/wishlist', 'POST', { gameId: game.id });
    assert.equal(again.status, 200, '重复加入不报错');
    assert.equal((await ctx.q('select count(*)::int as n from user_wishlist where game_id = $1', [game.id])).rows[0].n, 1);
    assert.equal(await watchCount(ctx.q, game.id), 1, '提醒只有一条');
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('移除：按 appid 只删本站并清自动提醒（无 Steam 回推请求）', async () => {
  const ctx = await setup();
  const game = (await ctx.q('select id from games where steam_appid = 700001')).rows[0];
  try {
    await ctx.req('/api/wishlist', 'POST', { appid: 700001 });
    const r = await ctx.req('/api/wishlist/700001', 'DELETE', { steamIds: ['76561198000000001'], siteWishlist: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.siteRemoved, 1);
    assert.equal(r.body.removedFromSteam.length, 0, '不再回推 Steam');
    assert.equal(await wishRow(ctx.q, ctx.alice.id, game.id), null, '本站行已删');
    assert.equal(await watchCount(ctx.q, game.id), 0, '自动提醒已清');
    const removed = ctx.events.find(([e]) => e === 'wishlist.removed');
    assert.ok(removed, '日志 wishlist.removed');
    assert.equal(removed[1].siteRemoved, 1);
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('移除：按 gameId 路径；旧 body 的 siteWishlist:false 也忽略（统一只删本站）', async () => {
  const ctx = await setup();
  const game = (await ctx.q("select id from games where name = '无AppID'")).rows[0];
  try {
    await ctx.req('/api/wishlist', 'POST', { gameId: game.id });
    const r = await ctx.req(`/api/wishlist/id/${game.id}`, 'DELETE', { siteWishlist: false });
    assert.equal(r.status, 200);
    assert.equal(r.body.siteRemoved, 1, 'body 被忽略，仍删本站');
    assert.equal(await wishRow(ctx.q, ctx.alice.id, game.id), null);
    // 不存在的游戏 → 404
    const miss = await ctx.req('/api/wishlist/id/999999', 'DELETE', {});
    assert.equal(miss.status, 404);
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('鉴权：未登录访问 /api/wishlist（POST/DELETE）→ 401', async () => {
  const ctx = await setup();
  try {
    const anon = (path, method) => fetch(`${ctx.base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await anon('/api/wishlist', 'POST')).status, 401);
    assert.equal((await anon('/api/wishlist/700001', 'DELETE')).status, 401);
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('前端（静态）：去 Steam 多选弹窗/账号展示，加入直写本站、移除确认后只删本站', () => {
  const home = read('../frontend/src/pages/Home.vue');
  assert.doesNotMatch(home, /wishlistPick|wishlistRemovePick/, '不再有愿望单多选弹窗');
  assert.doesNotMatch(home, /openWishlistRemove|confirmWishlist/, '不再有 Steam 账号选择流程');
  assert.doesNotMatch(home, /wishlistByText|愿望单账号/, '卡片/详情不再拼接 Steam 账号名');
  assert.doesNotMatch(home, /steamAccounts/, '前台不再加载 Steam 账号列表');
  assert.match(home, /async function addWishlist\(game\)/, '加入只接收游戏');
  assert.match(home, /await request\('\/api\/wishlist',\{method:'POST'/, '直接 POST 本站');
  assert.match(home, /ElMessageBox\.confirm\(`确定从本站愿望单移除/, '移除有确认');
  assert.match(home, /method:'DELETE',body:'\{\}'/, '移除只传空 body（只删本站）');
  assert.match(home, /本站愿望单/, '详情只显示本站愿望单标签');
});
