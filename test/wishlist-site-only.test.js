// BE 批（docs/WISHLIST-SITE-ONLY.md §4.2/§4.4）：愿望单后台清单（用户/游戏/当前价/史低/加入时间）、
// 单条删除、批量删除（max 200）、权限（401/403），以及「每账号 API Key 用于账号同步、不回退全局 key」的静态接线。
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
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureSteamSchema(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  await db.createUser(q, { username: 'bob', password: 'bob123456', role: 'user' });
  const alice = (await q("select id from users where username = 'alice'")).rows[0];
  const bob = (await q("select id from users where username = 'bob'")).rows[0];
  await q("insert into games (steam_appid, name, name_en) values (710001, '星球大战 绝地', 'Jedi Test')");
  await q("insert into games (steam_appid, name) values (710002, '愿望单二号')");
  const g1 = (await q("select id from games where steam_appid = 710001")).rows[0];
  const g2 = (await q("select id from games where steam_appid = 710002")).rows[0];
  await q(
    "insert into game_region_snapshot (game_id, region, price_cents, hist_low_cents) values ($1, 'cn', 12345, 9999)",
    [g1.id],
  );
  // 站点愿望单：alice 两款、bob 一款（含共享游戏 g1，用于验证「最后一个收藏删掉才清提醒」）
  const w1 = (await q("insert into user_wishlist (user_id, game_id) values ($1, $2) returning id", [alice.id, g1.id])).rows[0];
  const w2 = (await q("insert into user_wishlist (user_id, game_id) values ($1, $2) returning id", [alice.id, g2.id])).rows[0];
  const w3 = (await q("insert into user_wishlist (user_id, game_id) values ($1, $2) returning id", [bob.id, g1.id])).rows[0];
  await q("insert into watchlist (game_id, region, target_cents, note, source) values ($1, 'cn', null, '愿望单', 'user_wishlist')", [g1.id]);
  await q("insert into watchlist (game_id, region, target_cents, note, source) values ($1, 'cn', null, '愿望单', 'user_wishlist')", [g2.id]);
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = async (username, password) => {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(res.status, 200, `登录 ${username}`);
    return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  };
  const admin = await login('admin', 'admin123456');
  const aliceCookie = await login('alice', 'alice123456');
  return { store, q, srv, base, admin, aliceCookie, alice, bob, g1, g2, w1, w2, w3 };
}

const getJson = async (url, cookie) => {
  const res = await fetch(url, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('GET /api/admin/wishlists：匿名 401、普通用户 403、管理员 200（用户/游戏/价格/加入时间）', async () => {
  const ctx = await setup();
  try {
    assert.equal((await getJson(`${ctx.base}/api/admin/wishlists`)).status, 401, '匿名 401');
    assert.equal((await getJson(`${ctx.base}/api/admin/wishlists`, ctx.aliceCookie)).status, 403, '普通用户 403');
    const res = await getJson(`${ctx.base}/api/admin/wishlists?limit=200`, ctx.admin);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 3, '三条愿望单');
    const row = res.body.items.find((x) => x.id === ctx.w1.id);
    assert.ok(row, '含 alice 的第一条');
    assert.equal(row.username, 'alice');
    assert.equal(row.name, '星球大战 绝地');
    assert.equal(row.steam_appid, 710001);
    assert.equal(row.current_low, 12345, '当前价来自 game_region_snapshot(cn)');
    assert.equal(row.hist_low, 9999, '史低来自 game_region_snapshot(cn)');
    assert.ok(row.created_at, '加入时间');
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('GET /api/admin/wishlists：关键词（用户名/游戏名/AppID）与 userId 筛选', async () => {
  const ctx = await setup();
  try {
    const byUser = await getJson(`${ctx.base}/api/admin/wishlists?q=alice`, ctx.admin);
    assert.equal(byUser.body.total, 2, '按用户名');
    const byName = await getJson(`${ctx.base}/api/admin/wishlists?q=${encodeURIComponent('愿望单二号')}`, ctx.admin);
    assert.equal(byName.body.total, 1, '按游戏名');
    assert.equal(byName.body.items[0].name, '愿望单二号');
    const byAppid = await getJson(`${ctx.base}/api/admin/wishlists?q=710001`, ctx.admin);
    assert.equal(byAppid.body.total, 2, '按 AppID');
    const byUserId = await getJson(`${ctx.base}/api/admin/wishlists?userId=${ctx.bob.id}`, ctx.admin);
    assert.equal(byUserId.body.total, 1, '按 userId');
    assert.equal(byUserId.body.items[0].username, 'bob');
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('DELETE /api/admin/wishlists/:id：删行；还有别人收藏时保留自动提醒，最后一个删掉才清', async () => {
  const ctx = await setup();
  try {
    // 删 bob 对 g1 的收藏：alice 也收藏了 g1 → 提醒保留
    let res = await fetch(`${ctx.base}/api/admin/wishlists/${ctx.w3.id}`, { method: 'DELETE', headers: { cookie: ctx.admin } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).removed, 1);
    assert.equal((await ctx.q('select 1 from user_wishlist where id = $1', [ctx.w3.id])).rows.length, 0, '行已删');
    assert.equal(
      (await ctx.q("select 1 from watchlist where game_id = $1 and source = 'user_wishlist'", [ctx.g1.id])).rows.length,
      1,
      '还有 alice 收藏 → 提醒保留',
    );
    // 删 alice 对 g1 的收藏（最后一个）→ 自动提醒清理
    res = await fetch(`${ctx.base}/api/admin/wishlists/${ctx.w1.id}`, { method: 'DELETE', headers: { cookie: ctx.admin } });
    assert.equal(res.status, 200);
    const left = await ctx.q("select 1 from watchlist where game_id = $1 and source = 'user_wishlist'", [ctx.g1.id]);
    assert.equal(left.rows.length, 0, '最后一个收藏删掉 → 自动提醒清理');
    // 不存在的 id → 404
    res = await fetch(`${ctx.base}/api/admin/wishlists/999999`, { method: 'DELETE', headers: { cookie: ctx.admin } });
    assert.equal(res.status, 404);
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('批量 wishlists/delete：max 200、正常删除、超限 400、普通用户 403', async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.base}/api/admin/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.admin },
      body: JSON.stringify({ target: 'wishlists', action: 'delete', keys: [ctx.w2.id] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, 1, '删掉 1 条');
    assert.equal((await ctx.q('select 1 from user_wishlist where id = $1', [ctx.w2.id])).rows.length, 0);
    assert.equal(
      (await ctx.q("select 1 from watchlist where game_id = $1 and source = 'user_wishlist'", [ctx.g2.id])).rows.length,
      0,
      '最后一个收藏 → 自动提醒清理',
    );
    // 上限 200：201 个键 → 400
    const tooMany = await fetch(`${ctx.base}/api/admin/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.admin },
      body: JSON.stringify({ target: 'wishlists', action: 'delete', keys: Array.from({ length: 201 }, (_, i) => i + 1) }),
    });
    assert.equal(tooMany.status, 400, '单次最多 200');
    const normalUser = await fetch(`${ctx.base}/api/admin/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.aliceCookie },
      body: JSON.stringify({ target: 'wishlists', action: 'delete', keys: [ctx.w1.id] }),
    });
    assert.equal(normalUser.status, 403, '普通用户 403');
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('§4.4 接入（静态）：账号同步用该账号自己的 key（不回退全局）、绑定后不自动同步、后台文案改「API Key」', () => {
  const server = read('../src/server.js');
  const cli = read('../src/cli.js');
  const extras = read('../frontend/src/pages/AdminExtras.vue');
  // 账号同步入口：用 requireAccountApiKey（两条路由），且不再出现 requireSteamApiKey() 调用
  assert.match(server, /const requireAccountApiKey = async \(steamId\)/, '有账号级 key 解析');
  assert.match(server, /const apiKey = await requireAccountApiKey\(steamId\);\s*\n\s*if \(!apiKey\) return;/, '同步路由改用账号 key');
  assert.equal((server.match(/requireSteamApiKey\(\)/g) || []).length, 0, '不再有任何全局 key 回退调用');
  assert.match(server, /该账号未配置 API Key，请先在后台填写/, '缺 key 明确报错');
  assert.match(server, /该账号 API Key 无效，请检查/, 'key 无效明确报错');
  // 绑定后不自动同步
  assert.match(server, /steamNeedKey=1/, '绑定成功提示先配 key');
  assert.doesNotMatch(server, /自动同步库 \+ 愿望单/, '绑定流程不再自动同步');
  // 调度任务：逐账号取 key，缺 key 跳过并记日志
  assert.match(cli, /steam\.account_sync_skipped/, '缺 key 的账号跳过并记日志');
  assert.match(cli, /select api_key_enc from steam_accounts where steam_id = \$1/, '调度按账号取 key');
  // 后台文案：推送 Key → API Key；说明改为账号同步用
  assert.match(extras, /label="API Key"/, '列名改 API Key');
  assert.doesNotMatch(extras, /推送 Key/, '不再出现「推送 Key」');
  assert.match(extras, /用于该账号同步游戏库\/愿望单/, '弹窗说明');
  assert.match(extras, /该账号未配置 API Key，请先在「API Key」里填写/, '未配置时点同步给出提示');
});
