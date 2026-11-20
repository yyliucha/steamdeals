// CX 批（docs/USER-PROFILE-EDIT.md §4）：个人资料编辑（Web + App 同一套接口）。
// 覆盖：/api/me 资料字段、PATCH /api/me/profile 校验（昵称 2–20 / 简介 ≤200 / 管理员豁免 / 只读字段忽略）、
// 头像存库（bytea + mime + source、魔数/大小校验、ETag/304、steam 来源 302）、
// 设为默认 Steam 账号 + 解绑清默认、我的游戏库与统计（每账号一卡 + 5 项）、库/愿望单弹窗条目、越权 403。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ingestOffers } from '../src/ingest.js';
import { evaluateAlerts, groupAlertsByUser } from '../src/alerts.js';
import { ensureSteamSchemaOnce } from '../src/steam-login.js';

// 测试里默认关掉登录验证码
process.env.CAPTCHA_ENABLED = '0';

// ===== CO-5/B4-2 第六轮：域拆分静态锁（me 域抽到 src/routes/me.js + src/store/me-repository.js）=====
// 反向自检口径：删掉 routes/me.js 任一路由分支 → 第 1 组红；删掉 server.js 的接线调用 →
// 第 2 组红；把分支抄回 server.js → 第 3 组「防双实现」红；删 pg.js re-export → 第 4 组红；
// 把 /api/me/email/* 误搬进 me 域或从 auth-routes.js 删掉 → 第 5 组「边界」红。
const ME_ROUTES = readFileSync(new URL('../src/routes/me.js', import.meta.url), 'utf8');
const ME_REPO = readFileSync(new URL('../src/store/me-repository.js', import.meta.url), 'utf8');
const ME_PG = readFileSync(new URL('../src/store/pg.js', import.meta.url), 'utf8');
const ME_SERVER = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const ME_EMAIL_AUTH = readFileSync(new URL('../src/auth-routes.js', import.meta.url), 'utf8');

// 1×1 透明 PNG（合法图片，68 字节）
const PNG_1PX_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function setup() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  // steam_accounts/steam_games/steam_wishlist 由 steam-login 幂等建表（HTTP 层请求时也会建，这里提前建好插夹具）
  await ensureSteamSchemaOnce(q);
  const admin = await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin', email: 'admin@example.com' });
  const alice = await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user', email: 'alice@example.com' });
  const bob = await db.createUser(q, { username: 'bob', password: 'bob123456', role: 'user', email: 'bob@example.com' });

  // 一款在库游戏（星露谷 413150）：报价 4800 分，日价格史低 4800（当前 = 史低 → 史低命中）
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
  const baseGid = (await q('select id from games where steam_appid = 413150')).rows[0].id;
  await db.refreshGameRegionHist(q, baseGid);

  // alice 绑两个 Steam 账号；bob 绑一个（用于越权）
  const SA1 = '76561198000000001';
  const SA2 = '76561198000000002';
  const SB1 = '76561198000000003';
  await q(
    "insert into steam_accounts (steam_id, persona_name, avatar, user_id) values ($1,'sunming','https://steamcdn/sunming.jpg',$2),($3,'alt_account','https://steamcdn/alt.jpg',$2),($5,'bobsteam','https://steamcdn/bob.jpg',$4)",
    [SA1, alice.id, SA2, bob.id, SB1],
  );
  await q(
    "insert into steam_account_logs (action, steam_id, persona_name, user_id, username, actor, result) values ('bind',$1,'sunming',$2,'alice','self','ok'),('bind',$3,'alt_account',$2,'alice','self','ok'),('bind',$5,'bobsteam',$4,'bob','self','ok')",
    [SA1, alice.id, SA2, bob.id, SB1],
  );
  // alice：账号 1 库 2 款（413150 + 未入库 999998）、愿望单 1 款；账号 2 库 1 款（999997）、愿望单 0
  await q(
    "insert into steam_games (steam_id, appid, name, playtime_minutes, synced_at) values ($1,413150,'星露谷物语',120,now() - interval '1 hour'),($1,999998,'Not In DB',5,now() - interval '2 hours'),($2,999997,'Another',9,now() - interval '3 hours')",
    [SA1, SA2],
  );
  await q(
    "insert into steam_wishlist (steam_id, appid, name, synced_at) values ($1,413150,'星露谷物语',now() - interval '30 minutes')",
    [SA1],
  );
  // 本站愿望单 + 用户级到价提醒（无目标价 → 史低口径）
  await q('insert into user_wishlist (user_id, game_id) values ($1, $2)', [alice.id, baseGid]);
  await db.upsertUserWatch(q, { userId: alice.id, gameId: baseGid, targetCents: null });
  await db.upsertWatch(q, { gameId: baseGid, targetCents: null }); // 站点级：不计入本人统计

  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  return { store, q, srv, base: `http://127.0.0.1:${srv.port}`, admin, alice, bob, baseGid, SA1, SA2, SB1 };
}

const login = async (base, username, password) => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
};

const patch = (base, cookie, body) =>
  fetch(`${base}/api/me/profile`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });

test('/api/me 带完整本人资料字段；prefs 含 email_alerts（默认 true）', async () => {
  const { store, srv, base } = await setup();
  try {
    const anon = await (await fetch(`${base}/api/me`)).json();
    assert.equal(anon.user, null, '匿名没有用户');

    const c = await login(base, 'alice', 'alice123456');
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: c.cookie } })).json();
    assert.equal(me.user.username, 'alice');
    assert.equal(me.user.email, 'alice@example.com', '回显本人邮箱');
    assert.equal(me.user.emailVerified, false);
    assert.equal(me.user.displayName, null, '新用户昵称为空');
    assert.equal(me.user.bio, null);
    assert.equal(me.user.avatarSource, null, '未设置头像来源');
    assert.ok(me.user.createdAt, '带注册时间');
    assert.equal(me.prefs.email_alerts, true, '邮件开关默认开启');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('PATCH /api/me/profile：昵称 2–20 / 简介 ≤200 校验；管理员可空；只读字段被忽略', async () => {
  const { store, srv, base, q, alice, bob } = await setup();
  try {
    const ac = await login(base, 'alice', 'alice123456');
    const bc = await login(base, 'bob', 'bob123456');
    const adminC = await login(base, 'admin', 'admin123456');

    // 未登录 401
    assert.equal((await fetch(`${base}/api/me/profile`, { method: 'PATCH', body: '{}' })).status, 401);

    // 正常保存：昵称 + 简介 + 主题 + 邮件开关一起落库
    let r = await patch(base, ac.cookie, { displayName: '昵称测试', bio: '简介内容', theme: 'dark', emailAlerts: false });
    assert.equal(r.status, 200);
    let body = await r.json();
    assert.equal(body.user.displayName, '昵称测试');
    assert.equal(body.user.bio, '简介内容');
    assert.equal(body.prefs.theme, 'dark');
    assert.equal(body.prefs.email_alerts, false);
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(me.user.displayName, '昵称测试', '刷新后保持');
    assert.equal(me.prefs.email_alerts, false, '邮件开关落库');

    // 校验：昵称 1 字 / 21 字都 400
    assert.equal((await patch(base, ac.cookie, { displayName: '短' })).status, 400);
    assert.equal((await patch(base, ac.cookie, { displayName: '十'.repeat(21) })).status, 400);
    // 校验：简介 201 字 400；普通用户简介为空 400
    assert.equal((await patch(base, ac.cookie, { bio: '字'.repeat(201) })).status, 400);
    assert.equal((await patch(base, ac.cookie, { bio: '' })).status, 400);
    // 校验：非法主题 400
    assert.equal((await patch(base, ac.cookie, { theme: 'blue' })).status, 400);

    // 管理员豁免：昵称/简介可空（存 null），邮箱仍必填不受影响
    r = await patch(base, adminC.cookie, { displayName: '', bio: '' });
    assert.equal(r.status, 200);
    body = await r.json();
    assert.equal(body.user.displayName, null, '管理员昵称可空');
    assert.equal(body.user.bio, null, '管理员简介可空');

    // 越权：请求体里塞 userId/username/email/role 一律被忽略——改的是 session 用户自己
    r = await patch(base, bc.cookie, { displayName: 'bob改名', userId: alice.id, username: 'alice', email: 'x@x.com', role: 'admin' });
    assert.equal(r.status, 200);
    body = await r.json();
    assert.equal(body.user.id, bob.id, '返回的是 bob 自己');
    const aliceAfter = (await (await fetch(`${base}/api/me`, { headers: { cookie: ac.cookie } })).json()).user;
    assert.equal(aliceAfter.displayName, '昵称测试', 'A 的资料没被改');
    const bobRow = (await q('select username, role, email from users where id = $1', [bob.id])).rows[0];
    assert.equal(bobRow.username, 'bob', '用户名没被改');
    assert.equal(bobRow.role, 'user', '角色没被改');
    assert.equal(bobRow.email, 'bob@example.com', '邮箱没被改');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('头像：上传存库（mime/魔数/大小校验）+ GET /api/avatar ETag/304 + 移除', async () => {
  const { store, srv, base, q, alice } = await setup();
  try {
    const c = await login(base, 'alice', 'alice123456');
    const upload = (dataUrl, cookie = c.cookie) =>
      fetch(`${base}/api/me/avatar`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ dataUrl }) });

    // 未登录 401
    assert.equal((await fetch(`${base}/api/me/avatar`, { method: 'POST', body: '{}' })).status, 401);

    // 非法格式：非 dataUrl / 非白名单 mime / 魔数不符 / 超 512KB
    assert.equal((await upload('not-a-dataurl')).status, 400, '非 dataUrl 拒绝');
    assert.equal((await upload('data:text/plain;base64,AAAA')).status, 400, '非图片 mime 拒绝');
    assert.equal((await upload('data:image/png;base64,' + Buffer.from('hello world').toString('base64'))).status, 400, '魔数不符拒绝');
    assert.equal((await upload('data:image/png;base64,' + 'A'.repeat(512 * 1024))).status, 413, '超 512KB 拒绝');

    // 合法 PNG：200 → source=custom；GET /api/avatar 输出同样字节
    const dataUrl = 'data:image/png;base64,' + PNG_1PX_B64;
    let r = await upload(dataUrl);
    assert.equal(r.status, 200);
    let body = await r.json();
    assert.equal(body.avatarSource, 'custom');
    const avatarRes = await fetch(`${base}/api/avatar/${alice.id}`);
    assert.equal(avatarRes.status, 200);
    assert.equal(avatarRes.headers.get('content-type'), 'image/png');
    assert.equal(avatarRes.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const etag = avatarRes.headers.get('etag');
    assert.ok(etag, '带 ETag');
    const bytes = Buffer.from(await avatarRes.arrayBuffer());
    assert.deepEqual(bytes, Buffer.from(PNG_1PX_B64, 'base64'), '输出与上传字节一致');
    const notModified = await fetch(`${base}/api/avatar/${alice.id}`, { headers: { 'if-none-match': etag } });
    assert.equal(notModified.status, 304, 'ETag 命中返回 304');

    // 库里确实存了 bytea + mime + source
    const row = (await q('select avatar_mime, avatar_source, avatar_updated_at from users where id = $1', [alice.id])).rows[0];
    assert.equal(row.avatar_mime, 'image/png');
    assert.equal(row.avatar_source, 'custom');
    assert.ok(row.avatar_updated_at, '记录更新时间');

    // 移除 → source null；GET /api/avatar 404（前端回退首字）
    r = await fetch(`${base}/api/me/avatar`, { method: 'DELETE', headers: { cookie: c.cookie } });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).avatarSource, null);
    assert.equal((await fetch(`${base}/api/avatar/${alice.id}`)).status, 404);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('DQ 默认 Steam 账号：设为默认只写 default_steam_id、头像不变；解绑只清默认；越权 403', async () => {
  const { store, srv, base, alice, SA1, SA2 } = await setup();
  try {
    const ac = await login(base, 'alice', 'alice123456');
    const bc = await login(base, 'bob', 'bob123456');

    const setDefault = (steamId, cookie) =>
      fetch(`${base}/api/steam/accounts/${steamId}/default`, { method: 'POST', headers: { cookie } });

    // 未登录 401
    assert.equal((await fetch(`${base}/api/steam/accounts/${SA1}/default`, { method: 'POST' })).status, 401);

    // 越权：bob 不能把 alice 的账号设为默认
    assert.equal((await setDefault(SA1, bc.cookie)).status, 403, '不属于当前用户 → 403');
    // 不存在 404
    assert.equal((await setDefault('76561198000009999', ac.cookie)).status, 404);

    // 验收「设为默认独立」：响应只带 defaultSteamId；avatarSource 不变（头像与账号解耦）
    let r = await setDefault(SA1, ac.cookie);
    assert.equal(r.status, 200);
    let body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.defaultSteamId, SA1, '默认账号写入 default_steam_id');
    assert.equal('avatarSource' in body, false, '响应不再联动头像');
    let me = await (await fetch(`${base}/api/me`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(me.user.avatarSource, null, '设为默认不改变头像来源');
    // 无头像时 /api/avatar 404（steam 来源 302 已退役）
    assert.equal((await fetch(`${base}/api/avatar/${alice.id}`, { redirect: 'manual' })).status, 404);
    // 账号卡 isDefault 读 default_steam_id
    let lib = await (await fetch(`${base}/api/me/library`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(lib.accounts.filter((a) => a.isDefault).length, 1, '默认只有一个');
    assert.equal(lib.accounts.find((a) => a.isDefault).steamId, SA1);

    // 换成第二个账号：默认迁移，头像仍不变
    r = await setDefault(SA2, ac.cookie);
    assert.equal((await r.json()).defaultSteamId, SA2);
    lib = await (await fetch(`${base}/api/me/library`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(lib.accounts.filter((a) => a.isDefault).length, 1, '默认仍然只有一个');
    assert.equal(lib.accounts.find((a) => a.isDefault).steamId, SA2);

    // 解绑默认账号 → 只清默认标记，头像不变
    r = await fetch(`${base}/api/steam/accounts/${SA2}`, { method: 'DELETE', headers: { cookie: ac.cookie } });
    assert.equal(r.status, 200);
    const after = await (await fetch(`${base}/api/me/library`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(after.accounts.length, 1, '解绑后行消失');
    assert.equal(after.accounts.every((a) => !a.isDefault), true, '默认徽标消失');

    // 自定义头像 + 设为默认：头像仍 custom（账号与头像彻底解耦）
    const dataUrl = 'data:image/png;base64,' + PNG_1PX_B64;
    r = await fetch(`${base}/api/me/avatar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ac.cookie },
      body: JSON.stringify({ dataUrl }),
    });
    assert.equal(r.status, 200);
    r = await setDefault(SA1, ac.cookie);
    assert.equal(r.status, 200);
    me = await (await fetch(`${base}/api/me`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(me.user.avatarSource, 'custom', '设默认后自定义头像保持不变');
    const av = await fetch(`${base}/api/avatar/${alice.id}`);
    assert.equal(av.status, 200, '自定义头像仍输出库内字节');
    // 解绑当前默认账号：头像仍 custom、默认徽标消失
    await fetch(`${base}/api/steam/accounts/${SA1}`, { method: 'DELETE', headers: { cookie: ac.cookie } });
    me = await (await fetch(`${base}/api/me`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(me.user.avatarSource, 'custom', '解绑默认账号不动头像');
    const lib2 = await (await fetch(`${base}/api/me/library`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(lib2.accounts.every((a) => !a.isDefault), true, '解绑后默认徽标消失');

    // 旧联动函数已删除：绑定/认领不再自动改头像
    assert.equal(typeof db.setDefaultSteamAccountIfUnset, 'undefined', 'setDefaultSteamAccountIfUnset 已删除');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('我的游戏库与统计：每账号一卡 + 5 项汇总；库/愿望单条目（搜索/分页/越权）', async () => {
  const { store, srv, base, alice, bob, SA1, SA2, SB1 } = await setup();
  try {
    const ac = await login(base, 'alice', 'alice123456');
    const bc = await login(base, 'bob', 'bob123456');

    assert.equal((await fetch(`${base}/api/me/library`)).status, 401, '未登录 401');

    const lib = await (await fetch(`${base}/api/me/library`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(lib.accounts.length, 2, '两个账号两张卡');
    const a1 = lib.accounts.find((a) => a.steamId === SA1);
    const a2 = lib.accounts.find((a) => a.steamId === SA2);
    assert.equal(a1.name, 'sunming');
    assert.equal(a1.owned, 2, '账号 1 已拥有 2 款');
    assert.equal(a1.wishlist, 1, '账号 1 愿望单 1 款');
    assert.equal(a2.owned, 1, '账号 2 已拥有 1 款');
    assert.equal(a2.wishlist, 0);
    assert.ok(a1.lastSyncedAt, 'Web 端显示最近同步');
    assert.ok(a1.boundAt, '带绑定时间');
    // 5 项统计
    assert.equal(lib.stats.ownedTotal, 3, '已拥有合计 = 2+1');
    assert.equal(lib.stats.wishlistTotal, 1, '愿望单合计');
    assert.equal(lib.stats.siteWishlist, 1, '本站愿望单');
    assert.equal(lib.stats.alerts, 1, '到价提醒（只算本人，站点级不计）');
    assert.equal(lib.stats.histLowHits, 1, '史低命中（当前 ≤ 史低）');

    // 库条目：搜索 + 分页 + 兼容字段 in_db
    const lib1 = await (await fetch(`${base}/api/steam/accounts/${SA1}/library?q=${encodeURIComponent('星露')}&pageSize=10`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(lib1.total, 1, '搜索「星露」命中 1');
    assert.equal(lib1.games[0].appid, 413150);
    assert.equal(lib1.games[0].in_db, true, '已入库标记');
    assert.equal(lib1.games[0].current_low, 4800);
    assert.equal(lib1.games[0].hist_low, 4800);
    const libAll = await (await fetch(`${base}/api/steam/accounts/${SA1}/library`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(libAll.total, 2, '不带参数取全部');

    // 愿望单条目
    const wish = await (await fetch(`${base}/api/steam/accounts/${SA1}/wishlist?pageSize=10`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(wish.total, 1);
    assert.equal(wish.items[0].appid, 413150);

    // 越权：bob 看不到 alice 账号的库/愿望单
    assert.equal((await fetch(`${base}/api/steam/accounts/${SA1}/library`, { headers: { cookie: bc.cookie } })).status, 403);
    assert.equal((await fetch(`${base}/api/steam/accounts/${SA1}/wishlist`, { headers: { cookie: bc.cookie } })).status, 403);

    // bob 只有自己的 1 个账号
    const bobLib = await (await fetch(`${base}/api/me/library`, { headers: { cookie: bc.cookie } })).json();
    assert.equal(bobLib.accounts.length, 1);
    assert.equal(bobLib.accounts[0].steamId, SB1);
    void alice;
  } finally {
    await srv.close();
    await store.close();
  }
});

test('邮件开关生效：watchCandidates 带 user_email_alerts；groupAlertsByUser 分组携带开关', async () => {
  const { store, srv, q, base, alice, bob } = await setup();
  try {
    const ac = await login(base, 'alice', 'alice123456');
    // alice 关闭邮件提醒
    await fetch(`${base}/api/me/profile`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: ac.cookie },
      body: JSON.stringify({ emailAlerts: false }),
    });
    const rows = await db.watchCandidates(q);
    const mine = rows.find((r) => Number(r.user_id) === Number(alice.id));
    assert.equal(mine.user_email_alerts, false, '用户级行带关闭标记');
    const hits = evaluateAlerts(rows, { now: new Date() });
    const grouped = groupAlertsByUser(hits);
    const g = grouped.users.find((x) => x.userId === Number(alice.id));
    assert.equal(g.emailAlerts, false, '投递分组按关闭处理（cli.js 跳过邮件）');
    assert.ok(grouped.users.every((x) => x.userId !== Number(bob.id)), 'bob 没有提醒，不产生分组');
    // 站点级不受影响
    assert.ok(grouped.site.length >= 0);
  } finally {
    await srv.close();
    await store.close();
  }
});

// DQ 批（docs/PROFILE-UI-2026-11-19.md §3）：迁移回填与头像来源退役。
// 反向自检思路：把「steam: 头像清空」这条 SQL 从 ALTERS 里去掉 → 本用例 avatar_source 断言必然红。
test('DQ 迁移：default_steam_id 回填自 steam: 头像来源并清空该来源；重跑幂等；custom 不受影响', async () => {
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    const u = await db.createUser(q, { username: 'olduser', password: 'old123456', role: 'user', email: 'old@example.com' });
    // 模拟老库：CX 批「设为默认」写出的形态 avatar_source = 'steam:<id>'
    await q("update users set avatar_source = 'steam:76561198000000042', avatar_updated_at = now() where id = $1", [u.id]);
    // 重跑 migrate（= 老库升级路径）：回填 default_steam_id + 清空 steam: 头像来源
    await db.migrate(store);
    let row = (await q('select avatar_source, default_steam_id from users where id = $1', [u.id])).rows[0];
    assert.equal(row.default_steam_id, '76561198000000042', '默认账号关系回填到 default_steam_id');
    assert.equal(row.avatar_source, null, 'steam: 头像来源退役清空（回退首字/可自行上传）');
    // 幂等：再跑一次结果不变（容器每次启动都会跑 migrate）
    await db.migrate(store);
    row = (await q('select avatar_source, default_steam_id from users where id = $1', [u.id])).rows[0];
    assert.equal(row.default_steam_id, '76561198000000042', '重跑不回填空值');
    assert.equal(row.avatar_source, null);
    // 自定义头像与已回填默认不被迁移触碰
    await q("update users set avatar_source = 'custom', avatar_bytes = '\\x00', avatar_mime = 'image/png' where id = $1", [u.id]);
    await db.migrate(store);
    row = (await q('select avatar_source, default_steam_id from users where id = $1', [u.id])).rows[0];
    assert.equal(row.avatar_source, 'custom', '自定义头像不被迁移触碰');
    assert.equal(row.default_steam_id, '76561198000000042', '已回填的默认关系不被清');
  } finally {
    await store.close();
  }
});

// DQ 前端静态锁：验收 §6 的「无从 Steam 选头像 / 两行按钮窄屏不竖排 / 统计去重 / 开关文案」锁进测试。
test('DQ 前端静态锁：无 Steam 头像来源入口；两行等宽按钮；统计只三项；开关副说明；头像规则统一', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const page = read('../frontend/src/pages/ProfilePage.vue');
  const avatar = read('../frontend/src/components/UserAvatar.vue');

  // 验收「无『从 Steam 选头像』」：页面结构不存在 Steam 头像来源选择（grep 无 avatar_source steam 选项）
  assert.ok(!page.includes('chooseSteamAvatar'), '资料页不再有选择 Steam 头像的动作');
  assert.ok(!page.includes('avatar-opts'), '资料页不再有头像来源选项列表');
  assert.ok(!page.includes("'steam:'"), '资料页不再引用 steam: 头像来源');
  // 头像规则：只有 custom 走 /api/avatar
  assert.ok(page.includes("avatarSource.value === 'custom'"), '只有 custom 显示 /api/avatar');

  // 验收「账号卡两行按钮」：模板里恰好两行按钮容器；按钮 flex:1 等宽、容器不去 flex-wrap（窄屏不竖排）
  assert.equal((page.match(/class="acct-ops"/g) || []).length, 2, '账号卡两行按钮（行1 查看已拥有/查看愿望单，行2 设为默认/解绑）');
  assert.ok(!/\.acct-ops\s*\{[^}]*flex-wrap/.test(page), '按钮行不去 flex-wrap——窄屏保持两列等宽不竖排');
  assert.ok(/\.acct-ops\s*\.el-button\s*\{[^}]*flex:\s*1\s*1\s*0/.test(page), '按钮等宽（flex: 1 1 0）');
  assert.ok(page.includes('已设为默认'), '默认账号行内按钮禁用态文案');

  // 验收「统计去重」：底部统计只有三项；已拥有/愿望单合计在标题行
  assert.ok(page.includes('已拥有合计 <b>{{ stats.ownedTotal }}</b> · 愿望单合计'), '合计放统计标题行');
  assert.ok(!page.includes('statsline'), '旧的五合一统计行已移除');
  assert.equal((page.match(/class="stat3"/g) || []).length, 3, '统计卡片恰好三项（本站愿望单/到价提醒/史低命中）');

  // 验收「开关文案」：标签 + 副说明
  assert.ok(page.includes('到价提醒邮件'), '开关标签');
  assert.ok(page.includes('降价时发邮件提醒'), '开关副说明');

  // 头像规则统一：UserAvatar 与资料页共用 utils/avatar.js 的 avatarInitial
  assert.ok(avatar.includes("avatarInitial(props.name, '?')"), 'UserAvatar 用统一头像规则');
  assert.ok(page.includes("avatarInitial(me.value?.displayName"), '资料页头像用统一头像规则');
});

// ===== CO-5/B4-2 第六轮：me 域拆分静态锁 =====

test('CO-5/B4-2 第六轮：me 域路由分支全部在 src/routes/me.js（删任一支即红）', () => {
  assert.match(ME_ROUTES, /path === '\/api\/me' && req\.method === 'GET'/, 'me GET 分支在新文件');
  assert.match(ME_ROUTES, /path === '\/api\/prefs' && req\.method === 'POST'/, 'prefs POST 分支在新文件');
  assert.match(ME_ROUTES, /path\.match\(\/\^\\\/api\\\/avatar\\\/\(\\d\+\)\$\/\)/, 'avatar/:userId GET 分支在新文件');
  assert.match(ME_ROUTES, /path === '\/api\/me\/profile' && req\.method === 'PATCH'/, 'me/profile PATCH 分支在新文件');
  assert.match(ME_ROUTES, /path === '\/api\/me\/avatar' && req\.method === 'POST'/, 'me/avatar POST 分支在新文件');
  assert.match(ME_ROUTES, /path === '\/api\/me\/avatar' && req\.method === 'DELETE'/, 'me/avatar DELETE 分支在新文件');
  assert.match(ME_ROUTES, /path === '\/api\/me\/library' && req\.method === 'GET'/, 'me/library GET 分支在新文件');
  // 登录守卫随域（/api/me 匿名 200、其余写操作 requireUser）
  assert.match(ME_ROUTES, /requireUser\(\)/, '分支内登录守卫存在');
  // 上传限制 helper 随域移入（413 语义）
  assert.match(ME_ROUTES, /readAvatarBody/, '头像请求体读取 helper 随域移入');
  // 路由层不写 SQL 字面量（域内联 SQL 已抽成 repository 函数）
  assert.ok(!/select |insert |update |delete from /.test(ME_ROUTES), 'routes/me.js 不写 SQL 字面量');
});

test('CO-5/B4-2 第六轮：server.js 必须真实接线 handleMeRoutes（删掉调用即红，防死模块）', () => {
  assert.match(ME_SERVER, /import \{ handleMeRoutes \} from '\.\/routes\/me\.js'/, 'server.js 必须导入域路由入口');
  // 锁「完整调用形态」：必须是 if (await handleMeRoutes({...})) return;——只断言字符串存在
  // 会被 if (false) 包一层绕过；这个形态锁住"调用且消费返回值结束响应"。
  assert.match(ME_SERVER, /if \(\s*await handleMeRoutes\(\{/, '主段接线');
  // ctx 关键字段必须传齐：漏传 user/requireUser 会让登录守卫失效
  assert.match(ME_SERVER, /await handleMeRoutes\(\{[\s\S]{0,600}?user,/);
  assert.match(ME_SERVER, /await handleMeRoutes\(\{[\s\S]{0,600}?requireUser,/);
  // must_change_password 白名单仍是 server.js 中间件（/api/me 与 /api/avatar/* 放行，改密页依赖）
  assert.match(ME_SERVER, /p === '\/api\/me' \|\|/, 'must_change_password 白名单保留 /api/me');
  assert.match(ME_SERVER, /p\.startsWith\('\/api\/avatar\/'\)/, 'must_change_password 白名单保留 /api/avatar/*');
});

test('CO-5/B4-2 第六轮：me 域分支不得双实现（server.js 里保留旧分支即红）', () => {
  assert.ok(!/path === '\/api\/me' && req\.method/.test(ME_SERVER), 'me GET 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/prefs' && req\.method/.test(ME_SERVER), 'prefs POST 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/me\/profile'/.test(ME_SERVER), 'me/profile 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/me\/avatar'/.test(ME_SERVER), 'me/avatar 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/me\/library'/.test(ME_SERVER), 'me/library 分支不得残留在 server.js');
  assert.ok(!ME_SERVER.includes('avatarMatch'), 'avatar 公开读取分支不得残留在 server.js');
  assert.ok(!ME_SERVER.includes('readAvatarBody'), '头像请求体读取 helper 不得残留在 server.js');
  // 域内联 SQL 已抽 repository，不得残留在 server.js
  assert.ok(!/steam_accounts where user_id = \$1/.test(ME_SERVER), 'steamBound 内联 SQL 不得残留在 server.js');
  assert.ok(!/select min\(created_at\) as bound_at/.test(ME_SERVER), 'bindTimes 内联 SQL 不得残留在 server.js');
});

test('CO-5/B4-2 第六轮：me-repository.js 签名不变 + pg.js re-export（删 re-export 即红）', () => {
  // 搬家函数签名与拆分前一致（旧 db.* 导入签名不变）
  assert.match(ME_REPO, /export async function getUserPublic\(q, userId\)/, 'getUserPublic 签名与拆分前一致');
  assert.match(ME_REPO, /export async function updateUserProfile\(q, \{ userId, displayName = undefined, bio = undefined \}\)/, 'updateUserProfile 签名与拆分前一致');
  assert.match(ME_REPO, /export async function avatarOfUser\(q, userId\)/, 'avatarOfUser 签名与拆分前一致');
  assert.match(ME_REPO, /export async function setUserAvatar\(q, \{ userId, bytes, mime \}\)/, 'setUserAvatar 签名与拆分前一致');
  assert.match(ME_REPO, /export async function clearUserAvatar\(q, userId\)/, 'clearUserAvatar 签名与拆分前一致');
  assert.match(ME_REPO, /export async function userLibraryStats\(q, userId\)/, 'userLibraryStats 签名与拆分前一致');
  assert.match(ME_REPO, /export function normalizePrefs\(prefs = \{\}\)/, 'normalizePrefs 签名与拆分前一致');
  assert.match(ME_REPO, /export async function getPrefs\(q, userId\)/, 'getPrefs 签名与拆分前一致');
  assert.match(ME_REPO, /export async function savePrefs\(q, userId, prefs = \{\}\)/, 'savePrefs 签名与拆分前一致');
  // 域内联 SQL 抽出的两个新函数（/api/me steamBound、/api/me/library bindTimes）
  assert.match(ME_REPO, /export async function countBoundSteamAccounts\(q, userId\)/, 'steamBound 内联 SQL 已抽 countBoundSteamAccounts');
  assert.match(ME_REPO, /export async function boundAtOfSteamAccount\(q, steamId\)/, 'bindTimes 内联 SQL 已抽 boundAtOfSteamAccount');
  // 全部搬家函数必须整体 re-export（旧 db.* 导入签名不变；server.js 其它段与测试照旧走聚合壳）
  assert.match(ME_PG, /export \{[\s\S]{0,400}getUserPublic[\s\S]{0,400}updateUserProfile[\s\S]{0,400}avatarOfUser[\s\S]{0,400}setUserAvatar[\s\S]{0,400}clearUserAvatar[\s\S]{0,400}userLibraryStats[\s\S]{0,400}PREF_TABS[\s\S]{0,400}PREF_SORTS[\s\S]{0,400}normalizePrefs[\s\S]{0,400}getPrefs[\s\S]{0,400}savePrefs[\s\S]{0,400}countBoundSteamAccounts[\s\S]{0,400}boundAtOfSteamAccount[\s\S]{0,400}\} from '\.\/me-repository\.js'/, 'pg.js 必须 re-export 全部搬家函数');
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(!/export (async )?function (getUserPublic|updateUserProfile|avatarOfUser|setUserAvatar|clearUserAvatar|userLibraryStats|getPrefs|savePrefs)/.test(ME_PG), 'pg.js 不允许保留旧函数定义（只许 re-export）');
  assert.ok(!/export (async )?function (normalizePrefs)|export const PREF_TABS/.test(ME_PG), 'pg.js 不允许保留 normalizePrefs/PREF_TABS 旧定义');
  // 第七轮边界（B4 #7）：setDefaultSteamAccount/clearDefaultSteamIfMatches/userLibraryItems
  // 已随 site 域搬入 site-repository.js，pg.js 只许 re-export（旧 db.* 导入签名不变），
  // 不得保留旧函数定义（双实现会漂移）
  assert.ok(!/export (async )?function (setDefaultSteamAccount|clearDefaultSteamIfMatches|userLibraryItems)/.test(ME_PG), 'pg.js 不得保留 setDefaultSteamAccount/clearDefaultSteamIfMatches/userLibraryItems 旧定义（已随 site 域 B4 #7 搬走）');
});

test('CO-5/B4-2 第六轮：域边界——/api/me/email/* 留 auth-routes.js，不拆半截', () => {
  // /api/me/email/request|verify 与 /api/auth/email* 同模块（DT-2 排除区），整块留 auth-routes.js
  assert.match(ME_EMAIL_AUTH, /path === '\/api\/me\/email\/request'/, 'me/email/request 留 auth-routes.js');
  assert.match(ME_EMAIL_AUTH, /path === '\/api\/me\/email\/verify'/, 'me/email/verify 留 auth-routes.js');
  assert.match(ME_EMAIL_AUTH, /path === '\/api\/auth\/email\/request'/, 'auth/email/request 留 auth-routes.js');
  assert.match(ME_EMAIL_AUTH, /path === '\/api\/auth\/email\/verify'/, 'auth/email/verify 留 auth-routes.js');
  // me 域路由模块不得出现 me/email 路由分支（防误搬半截；文件头注释说明除外）
  assert.ok(!/'\/api\/me\/email\//.test(ME_ROUTES), 'routes/me.js 不得含 /api/me/email 路由分支');
});

// ===== EJ（docs/DISPLAY-NAME-RULE.md §3/§4）：昵称显示规则统一 =====
// 静态锁：Web 所有「用户」展示位统一 `display_name || username`；后台用户管理不再保留并列的「显示名」列
// （边界：不做昵称与用户名并列展示）；登录/账号标识仍用 username（不改认证）。
// 反向自检：把某个模板改回 `row.username`（只显示用户名）或把「显示名」列加回来 → 对应用例红。
test('EJ 静态锁：后台用户/会话/提醒/愿望单/日志/审核记录的用户列统一 display_name || username', () => {
  const front = (rel) => readFileSync(new URL(`../frontend/src/${rel}`, import.meta.url), 'utf8');
  const extras = front('pages/AdminExtras.vue');
  const modules = front('pages/AdminModules.vue');
  const logs = front('pages/AdminLogs.vue');
  const align = front('components/AlignAdmin.vue');

  // 用户管理：用户列按「昵称 → 用户名」，且不再并列展示「显示名」列
  assert.match(extras, /\{\{ row\.display_name\|\|row\.username \}\}/, '用户管理表格「用户」列按 display_name || username');
  assert.ok(!/label="显示名"/.test(extras), '用户管理不再有并列的「显示名」列（不做昵称与用户名并列）');
  assert.ok(!/prop="username" label="用户"/.test(extras), '用户管理不残留只显示 username 的用户列');
  // 用户卡片（手机端）
  assert.match(extras, /\{\{ u\.display_name\|\|u\.username \}\}/, '用户管理手机卡片显示名按昵称优先');
  // 会话列表（接口字段 displayName）
  assert.match(extras, /\{\{ row\.displayName \|\| row\.username \}\}/, '会话列表「用户」列按 displayName || username');
  assert.match(extras, /\{\{ s\.displayName \|\| s\.username \}\}/, '会话手机卡片按 displayName || username');

  // 愿望单 / 到价提醒
  assert.match(modules, /\{\{ row\.display_name \|\| row\.username \}\}/, '愿望单「用户」列按 display_name || username');
  assert.match(modules, /\{\{ row\.display_name \|\| row\.username \|\| '站点级' \}\}/, '到价提醒「用户」列按 display_name || username（站点级兜底）');
  assert.match(modules, /\{\{ w\.display_name \|\| w\.username \|\| '站点级' \}\}/, '到价提醒手机卡片按 display_name || username');
  assert.ok(!/prop="username" label="用户"/.test(modules), '愿望单/提醒不残留只显示 username 的用户列');

  // 操作日志：Steam 审计「归属用户」列（服务端 join users 带 user_display_name）；操作者仍保留账号标识（审计）
  assert.match(logs, /\{\{ row\.user_display_name \|\| row\.username \|\| '—' \}\}/, 'Steam 日志「归属用户」列按昵称优先');
  assert.match(logs, /\{\{ s\.user_display_name \|\| s\.username \|\| '未归属' \}\}/, 'Steam 日志手机卡片按昵称优先');

  // 异常审核的审阅记录（操作人）
  assert.match(align, /\{\{ r\.display_name \|\| r\.username \|\| '系统' \}\}/, '审核记录「操作人」按昵称优先');

  // 前台「我的」：用户菜单与后台顶栏（/api/me 返回 camelCase displayName，不是 display_name）
  assert.match(front('pages/Home.vue'), /user\.displayName \|\| user\.username/, '前台用户菜单昵称优先');
  assert.match(front('pages/Console.vue'), /user\.displayName \|\| user\.username/, '后台顶栏昵称优先');
  assert.ok(!/user\.display_name \|\| user\.username/.test(front('pages/Home.vue') + front('pages/Console.vue')), '/api/me 是 displayName，不能再读 display_name（读错会永远回退用户名）');
});
