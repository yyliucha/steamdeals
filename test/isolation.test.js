// CY 批（docs/DATA-ISOLATION.md §3/§4）：数据隔离——用户私有数据（提醒/愿望单/访问记录/Steam 绑定）管理员只读。
// 三视角：普通用户 A/B（互不可见、请求里的 userId 被忽略）+ 管理员（可看全部、写用户行 403 + 审计、
// 站点级可写、账号安全/会话/申诉保留可写、他人 Steam 绑定只读、未归属账号可认领）。
// 断言守的是行为边界：越权写不但要 403，还必须在 audit_logs 留下 admin.forbidden_write 证据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer, resetLoginThrottleForTest } from '../src/server.js';
import { ingestOffers } from '../src/ingest.js';
import { ensureSteamSchema } from '../src/steam-login.js';

// 测试里默认关掉登录验证码
process.env.CAPTCHA_ENABLED = '0';

async function setup() {
  resetLoginThrottleForTest();
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureSteamSchema(store);
  const q = (sql, p) => store.query(sql, p);
  const admin = await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const alice = await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  const bob = await db.createUser(q, { username: 'bob', password: 'bob123456', role: 'user' });

  // 两款游戏：g1 有报价（星露谷 413150），g2 无报价（站点级提醒用）
  await ingestOffers(store, {
    platform: { code: 'steam', name: 'Steam 国区', kind: 'official' },
    offers: [
      {
        platformCode: 'steam',
        platformProductId: '413150',
        steamAppid: 413150,
        title: '星露谷物语',
        productType: 'official_direct',
        region: 'cn',
        currency: 'CNY',
        priceCents: 4800,
        originalCents: 4800,
        discountPct: 0,
        inStock: true,
        buyUrl: 'https://store.steampowered.com/app/413150/',
        meta: {},
      },
    ],
  });
  await q(`insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency)
           select id, 'steam', 'cn', current_date - 1, 4800, 'CNY' from games where steam_appid = 413150`);
  const g1 = (await q('select id from games where steam_appid = 413150')).rows[0];
  await db.refreshGameRegionHist(q, g1.id);
  const g2 = (await q("insert into games (steam_appid, name) values (570, 'Dota 2') returning id")).rows[0];

  // 提醒夹具：站点级一条（g2）、alice/bob 各一条用户级（g1）
  const siteWatchId = await db.upsertWatch(q, { gameId: g2.id, targetCents: 1000 });
  const aliceWatchId = await db.upsertUserWatch(q, { userId: alice.id, gameId: g1.id, targetCents: 3000 });
  const bobWatchId = await db.upsertUserWatch(q, { userId: bob.id, gameId: g1.id, targetCents: 4000 });

  // 愿望单夹具：alice 收藏 g1
  const wishId = (await q('insert into user_wishlist (user_id, game_id) values ($1, $2) returning id', [alice.id, g1.id])).rows[0].id;

  // Steam 绑定夹具：alice/bob 各绑一个，另留一个未归属（认领用）
  const SA1 = '76561198000001001';
  const SB1 = '76561198000001002';
  const SU1 = '76561198000001003';
  await q(
    "insert into steam_accounts (steam_id, persona_name, user_id) values ($1, 'alice_steam', $2), ($3, 'bob_steam', $4), ($5, 'orphan_steam', null)",
    [SA1, alice.id, SB1, bob.id, SU1],
  );

  // 账号安全回归夹具：bob 的一条会话 + 一条待处理申诉
  const sessId = (await q("insert into sessions (token, user_id, expires_at) values ('iso-sess-token', $1, now() + interval '1 day') returning id", [bob.id])).rows[0].id;
  const appealId = (await q("insert into appeals (code, contact, status) values ('iso-appeal-1', 'appeal@example.com', 'pending') returning id")).rows[0].id;

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
  const adminCookie = await login('admin', 'admin123456');
  const aliceCookie = await login('alice', 'alice123456');
  const bobCookie = await login('bob', 'bob123456');
  return { store, q, srv, base, admin: { id: admin.id, cookie: adminCookie }, alice: { id: alice.id, cookie: aliceCookie }, bob: { id: bob.id, cookie: bobCookie }, g1, g2, siteWatchId, aliceWatchId, bobWatchId, wishId, SA1, SB1, SU1, sessId, appealId };
}

const getJson = async (url, cookie) => {
  const res = await fetch(url, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('用户级接口只看自己：GET 只返回本人提醒，请求里带 userId=B 无效', async () => {
  const ctx = await setup();
  try {
    const a = await getJson(`${ctx.base}/api/watchlist`, ctx.alice.cookie);
    assert.equal(a.status, 200);
    assert.equal(a.body.watches.length, 1, 'alice 只看到自己 1 条提醒');
    assert.equal(a.body.watches[0].id, ctx.aliceWatchId, '是 alice 自己的提醒');

    const b = await getJson(`${ctx.base}/api/watchlist`, ctx.bob.cookie);
    assert.equal(b.body.watches.length, 1, 'bob 只看到自己 1 条提醒');
    assert.equal(b.body.watches[0].id, ctx.bobWatchId, '是 bob 自己的提醒');

    // 带 userId=bob 参数：必须被忽略，仍只返回 alice 的数据（规格 §4.1）
    const forged = await getJson(`${ctx.base}/api/watchlist?userId=${ctx.bob.id}`, ctx.alice.cookie);
    assert.equal(forged.body.watches.length, 1, 'userId 参数被忽略');
    assert.equal(forged.body.watches[0].id, ctx.aliceWatchId, '仍是 alice 自己的提醒');
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('用户级接口只看自己：POST/DELETE 带 userId=B 只作用于本人', async () => {
  const ctx = await setup();
  try {
    // POST 带 userId=bob：落 alice 名下（参数被忽略）
    const res = await fetch(`${ctx.base}/api/watchlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.alice.cookie },
      body: JSON.stringify({ gameId: ctx.g2.id, userId: ctx.bob.id, targetCents: 999 }),
    });
    assert.equal(res.status, 200);
    const rows = await ctx.q('select user_id from watchlist where game_id = $1 and user_id is not null', [ctx.g2.id]);
    assert.equal(rows.rows.length, 1, '只多一条用户级提醒');
    assert.equal(Number(rows.rows[0].user_id), ctx.alice.id, '落在 alice 名下，不是 bob');
    assert.equal(
      (await ctx.q('select 1 from watchlist where game_id = $1 and user_id = $2', [ctx.g2.id, ctx.bob.id])).rows.length,
      0,
      'bob 名下没有新行',
    );

    // DELETE /api/watchlist/:gameId：alice 删 g1 只删自己的，bob 的仍在
    const del = await fetch(`${ctx.base}/api/watchlist/${ctx.g1.id}`, { method: 'DELETE', headers: { cookie: ctx.alice.cookie } });
    assert.equal(del.status, 200);
    assert.equal((await ctx.q('select 1 from watchlist where id = $1', [ctx.aliceWatchId])).rows.length, 0, 'alice 的提醒已删');
    assert.equal((await ctx.q('select 1 from watchlist where id = $1', [ctx.bobWatchId])).rows.length, 1, 'bob 的提醒还在');

    // 愿望单：alice 删 bob 的收藏（bob 没有收藏 g1）→ removed=0，不碰任何行
    const wishDel = await fetch(`${ctx.base}/api/wishlist/id/${ctx.g1.id}`, { method: 'DELETE', headers: { cookie: ctx.bob.cookie } });
    assert.equal(wishDel.status, 200);
    assert.equal((await ctx.q('select 1 from user_wishlist where id = $1', [ctx.wishId])).rows.length, 1, 'alice 的愿望单行仍在');
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('管理员 admin/watchlist：GET 全部含用户名；DELETE 用户行 → 403 + 审计；站点级可写', async () => {
  const ctx = await setup();
  try {
    const list = await getJson(`${ctx.base}/api/admin/watchlist?pageSize=50`, ctx.admin.cookie);
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 3, '站点级 1 条 + alice/bob 各 1 条');
    const byUser = new Map(list.body.items.map((it) => [Number(it.user_id), it.username]));
    assert.equal(byUser.get(ctx.alice.id), 'alice', '返回全部（含 alice 的用户名）');
    assert.equal(byUser.get(ctx.bob.id), 'bob', '返回全部（含 bob 的用户名）');
    assert.ok(list.body.items.every((it) => 'user_id' in it), '每行带 user_id（前端只读判定依据）');

    // 越权写：DELETE alice 的用户级提醒 → 403 + 审计（规格 §4.2）
    const forbidden = await fetch(`${ctx.base}/api/admin/watchlist/${ctx.aliceWatchId}`, { method: 'DELETE', headers: { cookie: ctx.admin.cookie } });
    assert.equal(forbidden.status, 403, '用户行不可删');
    assert.match((await forbidden.json()).error, /用户提醒只读/, '给出明确只读文案');
    assert.equal((await ctx.q('select 1 from watchlist where id = $1', [ctx.aliceWatchId])).rows.length, 1, '行未被删');
    const audits = await ctx.q("select action, target, actor, detail from audit_logs where action = 'admin.forbidden_write'");
    assert.equal(audits.rows.length, 1, '越权写落一条审计');
    assert.equal(audits.rows[0].target, `watchlist:${ctx.aliceWatchId}`, 'target 指向被写行');
    assert.equal(audits.rows[0].actor, 'admin', 'actor 是操作者');
    assert.equal(String(audits.rows[0].detail?.userId), String(ctx.alice.id), 'detail 带被写用户');

    // 越权写：PUT 无此路由（404），行不动——不提供任何写通道
    const put = await fetch(`${ctx.base}/api/admin/watchlist/${ctx.bobWatchId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: ctx.admin.cookie },
      body: JSON.stringify({ targetCents: 1 }),
    });
    assert.equal(put.status, 404, 'PUT 路由不存在');
    assert.equal((await ctx.q('select 1 from watchlist where id = $1', [ctx.bobWatchId])).rows.length, 1, '行未被改');

    // 站点级：POST 创建/更新（user_id IS NULL）与 DELETE 都保留可写（规格 §4.3）
    const post = await fetch(`${ctx.base}/api/admin/watchlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.admin.cookie },
      body: JSON.stringify({ gameId: ctx.g2.id, targetCents: 1234 }),
    });
    assert.equal(post.status, 200, '站点级提醒可写');
    assert.equal((await post.json()).id, ctx.siteWatchId, '同游戏冲突更新，返回原行');
    const siteRow = await ctx.q('select user_id, target_cents from watchlist where id = $1', [ctx.siteWatchId]);
    assert.equal(siteRow.rows[0].user_id, null, '站点级行 user_id 仍为 NULL');
    assert.equal(siteRow.rows[0].target_cents, 1234, '目标价已更新');

    const delSite = await fetch(`${ctx.base}/api/admin/watchlist/${ctx.siteWatchId}`, { method: 'DELETE', headers: { cookie: ctx.admin.cookie } });
    assert.equal(delSite.status, 200, '站点级行可删');
    assert.equal((await ctx.q('select 1 from watchlist where id = $1', [ctx.siteWatchId])).rows.length, 0, '站点级行已删');
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('管理员 wishlists / views 只读：写方法已移除（404/400），行不动', async () => {
  const ctx = await setup();
  try {
    // 愿望单：GET 保留，DELETE/POST 都不存在
    const list = await getJson(`${ctx.base}/api/admin/wishlists`, ctx.admin.cookie);
    assert.equal(list.status, 200);
    assert.ok(list.body.items.some((it) => Number(it.id) === Number(ctx.wishId)), '管理员仍可查看愿望单');

    const del = await fetch(`${ctx.base}/api/admin/wishlists/${ctx.wishId}`, { method: 'DELETE', headers: { cookie: ctx.admin.cookie } });
    assert.equal(del.status, 404, 'DELETE 写方法已移除');
    assert.equal((await ctx.q('select 1 from user_wishlist where id = $1', [ctx.wishId])).rows.length, 1, '行未被删');

    const post = await fetch(`${ctx.base}/api/admin/wishlists`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.admin.cookie },
      body: JSON.stringify({ gameId: ctx.g1.id }),
    });
    assert.equal(post.status, 404, 'POST 写方法不存在');

    // 访问记录：只有 GET，写方法不存在
    const views = await getJson(`${ctx.base}/api/admin/views`, ctx.admin.cookie);
    assert.equal(views.status, 200, '访问记录只读接口可用');
    const delViews = await fetch(`${ctx.base}/api/admin/views`, { method: 'DELETE', headers: { cookie: ctx.admin.cookie } });
    assert.equal(delViews.status, 404, '访问记录无 DELETE');
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('账号安全/会话/申诉保留可写（回归不回归）：踢会话、禁用用户、处理申诉', async () => {
  const ctx = await setup();
  try {
    // 会话：管理员踢 bob 的会话 → 200（放在禁用之前——禁用会连带踢掉全部会话，夹具行会被清）
    const kick = await fetch(`${ctx.base}/api/admin/sessions/${ctx.sessId}`, { method: 'DELETE', headers: { cookie: ctx.admin.cookie } });
    assert.equal(kick.status, 200, '踢会话保留可写');
    assert.equal((await ctx.q('select 1 from sessions where id = $1', [ctx.sessId])).rows.length, 0, '会话已删');

    // 账号安全：管理员禁用 bob → 200 且落库；再启用还原
    const dis = await fetch(`${ctx.base}/api/admin/users/bob`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: ctx.admin.cookie },
      body: JSON.stringify({ disabled: true }),
    });
    assert.equal(dis.status, 200, '账号禁用保留可写');
    assert.equal((await ctx.q("select disabled from users where username = 'bob'")).rows[0].disabled, true, '禁用已落库');
    const en = await fetch(`${ctx.base}/api/admin/users/bob`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: ctx.admin.cookie },
      body: JSON.stringify({ disabled: false }),
    });
    assert.equal(en.status, 200, '账号启用保留可写');

    // 申诉：管理员驳回 → 200 且状态流转
    const resolve = await fetch(`${ctx.base}/api/admin/appeals/${ctx.appealId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.admin.cookie },
      body: JSON.stringify({ action: 'reject', note: '证据不足，驳回' }),
    });
    assert.equal(resolve.status, 200, '申诉处理保留可写');
    assert.equal((await ctx.q('select status from appeals where id = $1', [ctx.appealId])).rows[0].status, 'rejected', '申诉已驳回');
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('管理员查看他人 Steam 绑定只读：解绑/别名 403；未归属账号仍可认领', async () => {
  const ctx = await setup();
  try {
    // 管理员不能代操作 bob 已归属的账号（规格 §4.5）
    const patch = await fetch(`${ctx.base}/api/steam/accounts/${ctx.SB1}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: ctx.admin.cookie },
      body: JSON.stringify({ alias: 'hacked' }),
    });
    assert.equal(patch.status, 403, '他人 Steam 账号改别名 → 403');
    const del = await fetch(`${ctx.base}/api/steam/accounts/${ctx.SB1}`, { method: 'DELETE', headers: { cookie: ctx.admin.cookie } });
    assert.equal(del.status, 403, '他人 Steam 账号解绑 → 403');
    assert.equal((await ctx.q('select 1 from steam_accounts where steam_id = $1', [ctx.SB1])).rows.length, 1, 'bob 的绑定还在');

    // 未归属账号认领保留可写（只允许 user_id IS NULL）
    const claim = await fetch(`${ctx.base}/api/steam/accounts/${ctx.SU1}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.admin.cookie },
      body: JSON.stringify({}),
    });
    assert.equal(claim.status, 200, '未归属账号认领保留可写');
    assert.equal((await ctx.q('select user_id from steam_accounts where steam_id = $1', [ctx.SU1])).rows[0].user_id, ctx.admin.id, '认领到管理员自己名下');
    // 已归属账号不能再被认领
    const claimOwned = await fetch(`${ctx.base}/api/steam/accounts/${ctx.SB1}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.admin.cookie },
      body: JSON.stringify({}),
    });
    assert.equal(claimOwned.status, 409, '已归属账号不可认领');
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('前端只读呈现（静态）：用户行隐藏删除按钮并标「只读」，愿望单删除入口已移除', () => {
  const adminModules = readFileSync(new URL('../frontend/src/pages/AdminModules.vue', import.meta.url), 'utf8');
  // 到价提醒：删除按钮只在 user_id==null（站点级）时渲染，用户行显示「只读」
  assert.match(adminModules, /v-if="row\.user_id==null"/, '桌面表格：用户行不渲染删除按钮');
  assert.match(adminModules, /v-if="w\.user_id==null"/, '移动卡片：用户行不渲染删除按钮');
  assert.match(adminModules, /只读/, '列表带「只读」标识');
  // 愿望单：整页只读——批量选择/批量删除/单条删除入口全部移除
  assert.doesNotMatch(adminModules, /sel\.wishlist/, '愿望单批量选择已移除');
  assert.doesNotMatch(adminModules, /removeWishlist/, '愿望单删除函数已移除');
  assert.doesNotMatch(adminModules, /api\/admin\/wishlists\/\$\{row\.id\}/, '愿望单单条删除调用已移除');
});
