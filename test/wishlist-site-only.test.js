// BE 批（docs/WISHLIST-SITE-ONLY.md §4.2/§4.4）：愿望单后台清单（用户/游戏/当前价/史低/加入时间）、
// 权限（401/403），以及「每账号 API Key 用于账号同步、不回退全局 key」的静态接线。
// CY 批（docs/DATA-ISOLATION.md §3）：单条 DELETE 与批量 wishlists/delete 已移除——愿望单属用户私有数据，
// 管理员只读；本条断言写通道确实关闭（DELETE 404 / 白名单 400），行为不回归。
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
  // EW（docs/WISHLIST-STEAM-ACCOUNT.md §7）：Steam 账号 + 导入愿望单（steam_accounts 列数据源）——
  // alice 两账号都导入 g1（多账号）、g2 无导入（空数组）；bob 一账号导入 g1（单账号、steam_id 回退）。
  await q("insert into steam_accounts (steam_id, persona_name, alias, user_id) values ('76561198000000001', 'PersonaA', 'yy_steam_main', $1)", [alice.id]);
  await q("insert into steam_accounts (steam_id, persona_name, alias, user_id) values ('76561198000000002', 'yy_steam_alt', '   ', $1)", [alice.id]);
  await q("insert into steam_accounts (steam_id, persona_name, alias, user_id) values ('76561198000000003', null, null, $1)", [bob.id]);
  await q("insert into steam_wishlist (steam_id, appid) values ('76561198000000001', 710001)");
  await q("insert into steam_wishlist (steam_id, appid) values ('76561198000000002', 710001)");
  await q("insert into steam_wishlist (steam_id, appid) values ('76561198000000003', 710001)");
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
    // EJ（docs/DISPLAY-NAME-RULE.md §4）：后台愿望单「用户」列按「昵称 → 用户名」显示。
    // 反向自检：删掉 SQL 里的 display_name / 改成不 trim 原文 → 下面两条断言红。
    assert.equal(row.display_name, null, '没有昵称 → null（前端回退 username）');
    await db.updateUser(ctx.q, { username: 'alice', displayName: '  爱丽丝  ' });
    const nick = await getJson(`${ctx.base}/api/admin/wishlists?limit=200`, ctx.admin);
    const nickRow = nick.body.items.find((x) => x.id === ctx.w1.id);
    assert.equal(nickRow.display_name, '爱丽丝', '有昵称 → 返回 trim 后的昵称');
    assert.equal(nickRow.username, 'alice', '账号标识仍返回 username（筛选/审计按它走）');
    await db.updateUser(ctx.q, { username: 'alice', displayName: '' });
    const cleared = await getJson(`${ctx.base}/api/admin/wishlists?limit=200`, ctx.admin);
    assert.equal(cleared.body.items.find((x) => x.id === ctx.w1.id).display_name, null, '清空昵称 → null，回退用户名');
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

test('CY 批：DELETE /api/admin/wishlists/:id 已移除——管理员写用户愿望单 → 404，行不动', async () => {
  const ctx = await setup();
  try {
    // 写方法已去掉：删除路由不再存在（404），行保留、自动提醒保留
    const res = await fetch(`${ctx.base}/api/admin/wishlists/${ctx.w3.id}`, { method: 'DELETE', headers: { cookie: ctx.admin } });
    assert.equal(res.status, 404, 'DELETE 路由已移除');
    assert.equal((await ctx.q('select 1 from user_wishlist where id = $1', [ctx.w3.id])).rows.length, 1, '行仍在');
    assert.equal(
      (await ctx.q("select 1 from watchlist where game_id = $1 and source = 'user_wishlist'", [ctx.g1.id])).rows.length,
      1,
      '自动提醒保留（未被删除）',
    );
    // 不存在的 id 同样 404（路由已移除，无写通道）
    const res2 = await fetch(`${ctx.base}/api/admin/wishlists/999999`, { method: 'DELETE', headers: { cookie: ctx.admin } });
    assert.equal(res2.status, 404);
  } finally {
    await ctx.srv.close();
    await ctx.store.close();
  }
});

test('CY 批：批量 wishlists/delete 已从白名单移除——管理员 400、普通用户 403、行不动', async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.base}/api/admin/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.admin },
      body: JSON.stringify({ target: 'wishlists', action: 'delete', keys: [ctx.w2.id] }),
    });
    assert.equal(res.status, 400, '未登记组合一律 400');
    assert.match((await res.json()).error, /不支持的批量操作/, '明确报不支持的批量操作');
    assert.equal((await ctx.q('select 1 from user_wishlist where id = $1', [ctx.w2.id])).rows.length, 1, '行仍在');
    assert.equal(
      (await ctx.q("select 1 from watchlist where game_id = $1 and source = 'user_wishlist'", [ctx.g2.id])).rows.length,
      1,
      '自动提醒保留（未被删除）',
    );
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
  // CO-5/B4-2 第七轮：/api/steam/* 账号同步路由已随 site 域抽到 src/routes/site.js，断言改指新文件
  const server = read('../src/server.js');
  const siteRoutes = read('../src/routes/site.js');
  // CO-5/B4-2 第十轮：cmdSteamAccounts 已随 cli 同步类域拆到 src/cli/sync.js，
  // 账号 API Key 查询抽到 src/store/cli-sync-repository.js，断言按新落点指向
  const cliSync = read('../src/cli/sync.js');
  const cliSyncRepo = read('../src/store/cli-sync-repository.js');
  const extras = read('../frontend/src/pages/AdminExtras.vue');
  // 账号同步入口：用 requireAccountApiKey（两条路由），且不再出现 requireSteamApiKey() 调用
  assert.match(siteRoutes, /const requireAccountApiKey = async \(steamId\)/, '有账号级 key 解析');
  assert.match(siteRoutes, /const apiKey = await requireAccountApiKey\(steamId\);\s*\n\s*if \(!apiKey\) return true;/, '同步路由改用账号 key');
  assert.equal((siteRoutes.match(/requireSteamApiKey\(\)/g) || []).length, 0, '不再有任何全局 key 回退调用');
  assert.match(siteRoutes, /该账号未配置 API Key，请先在后台填写/, '缺 key 明确报错');
  assert.match(siteRoutes, /该账号 API Key 无效，请检查/, 'key 无效明确报错');
  // 绑定后不自动同步（绑定回调已随 CO-5/B4-2 认证域移入 routes/auth.js，断言改指新文件）
  const authRoutes = read('../src/routes/auth.js');
  assert.match(authRoutes, /steamNeedKey=1/, '绑定成功提示先配 key');
  assert.doesNotMatch(server, /自动同步库 \+ 愿望单/, '绑定流程不再自动同步');
  // 调度任务：逐账号取 key，缺 key 跳过并记日志
  assert.match(cliSync, /steam\.account_sync_skipped/, '缺 key 的账号跳过并记日志');
  assert.match(cliSyncRepo, /select api_key_enc from steam_accounts where steam_id = \$1/, '调度按账号取 key');
  // 后台文案：推送 Key → API Key；说明改为账号同步用
  assert.match(extras, /label="API Key"/, '列名改 API Key');
  assert.doesNotMatch(extras, /推送 Key/, '不再出现「推送 Key」');
  assert.match(extras, /用于该账号同步游戏库\/愿望单/, '弹窗说明');
  assert.match(extras, /该账号未配置 API Key，请先在「API Key」里填写/, '未配置时点同步给出提示');
});

// ===== DT-2（docs/ADMIN-PERMISSIONS.md）：GET /api/me/wishlist 用户级愿望单 =====
// 防御性验收：只返回本人；忽略传入 userId（强制 session.user.id）；匿名 401；分页/搜索生效。
// 反向自检：把 routes/watchlist.js 里 listWishlists 的 userId: user.id 换成读请求参数 → 越权用例红；
// 把 repository 的 uw.user_id = $1 条件删掉 → A/B 双用户用例红。

test('DT-2 愿望单：匿名 401；A/B 双用户只看到自己的；响应无越权字段', async () => {
  const ctx = await setup();
  try {
    assert.equal((await getJson(`${ctx.base}/api/me/wishlist`)).status, 401, '匿名 401');
    const bobCookie = await (async () => {
      const res = await fetch(`${ctx.base}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'bob', password: 'bob123456' }),
      });
      return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    })();
    const alice = await getJson(`${ctx.base}/api/me/wishlist?limit=200`, ctx.aliceCookie);
    assert.equal(alice.status, 200);
    assert.equal(alice.body.total, 2, 'alice 恰好自己的 2 条');
    assert.ok(alice.body.items.every((x) => x.username === 'alice'), '全部是 alice 自己的条目');
    assert.equal(alice.body.items.find((x) => x.id === ctx.w1.id)?.current_low, 12345, '当前价来自快照');
    const bob = await getJson(`${ctx.base}/api/me/wishlist?limit=200`, bobCookie);
    assert.equal(bob.body.total, 1, 'bob 只有自己的 1 条');
    assert.equal(bob.body.items[0].username, 'bob');
    assert.ok(!JSON.stringify(alice.body).includes('bob'), 'alice 的响应不出现 bob 的任何条目');
    assert.ok(!JSON.stringify(bob.body).includes('alice'), 'bob 的响应不出现 alice 的任何条目');
  } finally {
    await ctx.store.close();
    await ctx.srv.close();
  }
});

test('DT-2 愿望单：忽略传入 userId（越权传他人 id 仍只回本人）；分页 offset/limit；搜索 q', async () => {
  const ctx = await setup();
  try {
    // 越权防御：传入 ?userId=<bob.id> 与 ?username=bob 一律无效（强制 session.user.id）
    const hijack = await getJson(`${ctx.base}/api/me/wishlist?limit=200&userId=${ctx.bob.id}`, ctx.aliceCookie);
    assert.equal(hijack.status, 200);
    assert.equal(hijack.body.total, 2, '传入 userId 无效：仍是 alice 自己的 2 条');
    assert.ok(hijack.body.items.every((x) => x.username === 'alice'), '传入 userId 不改变归属');
    // 分页：limit=1&offset=0 → 1 条 + total 2；offset=1 → 第二条
    const page1 = await getJson(`${ctx.base}/api/me/wishlist?limit=1&offset=0`, ctx.aliceCookie);
    assert.equal(page1.body.items.length, 1, 'limit=1 只回 1 条');
    assert.equal(page1.body.total, 2, 'total 是本人全量 2（真实分页总数）');
    const page2 = await getJson(`${ctx.base}/api/me/wishlist?limit=1&offset=1`, ctx.aliceCookie);
    assert.equal(page2.body.items.length, 1);
    assert.notEqual(page1.body.items[0].id, page2.body.items[0].id, 'offset 翻页不重复');
    // 搜索：按游戏名
    const hit = await getJson(`${ctx.base}/api/me/wishlist?q=${encodeURIComponent('绝地')}`, ctx.aliceCookie);
    assert.equal(hit.body.total, 1, '关键词命中 1 条');
    assert.equal(hit.body.items[0].name, '星球大战 绝地');
    const miss = await getJson(`${ctx.base}/api/me/wishlist?q=${encodeURIComponent('不存在')}`, ctx.aliceCookie);
    assert.equal(miss.body.total, 0, '无命中 0 条');
  } finally {
    await ctx.store.close();
    await ctx.srv.close();
  }
});

// ===== EW（docs/WISHLIST-STEAM-ACCOUNT.md §7）：steam_accounts 列（只读展示数据源） =====
// 反向自检：删掉 steamAccountsCol 子查询里的 a.user_id = $1 → 越权断言红（alice 会看到 bob 的账号）；
// 删 distinct → 重复账号断言红；改 coalesce 顺序 → alias 优先断言红；删 order by → 排序断言红。

test('EW steam_accounts：多账号去重排序 + alias 优先/persona 回退；无来源空数组', async () => {
  const ctx = await setup();
  try {
    const alice = await getJson(`${ctx.base}/api/me/wishlist?limit=200`, ctx.aliceCookie);
    const g1 = alice.body.items.find((x) => x.game_id === ctx.g1.id);
    const g2 = alice.body.items.find((x) => x.game_id === ctx.g2.id);
    assert.ok(g1, 'alice 的 g1 行');
    // 多账号：两账号都导入 g1（710001）；别名优先、全空格别名回退 persona，按名字排序去重
    assert.deepEqual(g1.steam_accounts, ['yy_steam_alt', 'yy_steam_main'], '多账号按名排序；alias 优先 + 空白 alias 回退 persona');
    // 无来源：g2 无任何 steam_wishlist 命中 → 空数组（前端显示「本站添加（无 Steam 来源）」）
    assert.deepEqual(g2.steam_accounts, [], '无 Steam 来源 → 空数组');
  } finally {
    await ctx.store.close();
    await ctx.srv.close();
  }
});

test('EW steam_accounts：单账号 + steam_id 回退；A/B 双用户越权不可见', async () => {
  const ctx = await setup();
  try {
    const bobCookie = await (async () => {
      const res = await fetch(`${ctx.base}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'bob', password: 'bob123456' }),
      });
      return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    })();
    const bob = await getJson(`${ctx.base}/api/me/wishlist?limit=200`, bobCookie);
    assert.deepEqual(bob.body.items[0].steam_accounts, ['76561198000000003'], '单账号；无 alias/persona 回退 steam_id');
    // 越权不可见：账号名只按 a.user_id = 当前用户 聚合
    const alice = await getJson(`${ctx.base}/api/me/wishlist?limit=200`, ctx.aliceCookie);
    assert.ok(!JSON.stringify(alice.body).includes('76561198000000003'), 'alice 响应不含 bob 的账号');
    assert.ok(!JSON.stringify(bob.body).includes('yy_steam_main'), 'bob 响应不含 alice 的账号');
  } finally {
    await ctx.store.close();
    await ctx.srv.close();
  }
});

test('EW 前端接线：Home 卡片/详情渲染 wishlisted_by；UserSections 桌面列 + 移动行 + 无来源兜底', () => {
  // 反向自检：删掉 Home 卡片/详情任一处 wishlisted_by 渲染 → 对应断言红；
  // 删掉 UserSections 的「Steam 账号」列或移动行 → 对应断言红（展示即缺失）。
  const home = read('../frontend/src/pages/Home.vue');
  const us = read('../frontend/src/pages/UserSections.vue');
  assert.match(home, /v-if="user && wishlistByText\(game\)"/, 'Home 卡片（桌面底部行 + 移动标签区）都带登录条件渲染账号文案');
  assert.match(home, /detail\.game\.wishlisted_by/, 'Home 详情弹窗渲染所属 Steam 账号');
  assert.match(us, /label="Steam 账号"/, 'UserSections 桌面加「Steam 账号」列');
  assert.match(us, /本站添加（无 Steam 来源）/, '无来源兜底文案（桌面列 + 移动行共用）');
  assert.match(us, /steam_accounts/, 'UserSections 消费接口 steam_accounts 字段');
});
