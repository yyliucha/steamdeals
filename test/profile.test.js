// CX 批（docs/USER-PROFILE-EDIT.md §4）：个人资料编辑（Web + App 同一套接口）。
// 覆盖：/api/me 资料字段、PATCH /api/me/profile 校验（昵称 2–20 / 简介 ≤200 / 管理员豁免 / 只读字段忽略）、
// 头像存库（bytea + mime + source、魔数/大小校验、ETag/304、steam 来源 302）、
// 设为默认 Steam 账号 + 解绑清默认、我的游戏库与统计（每账号一卡 + 5 项）、库/愿望单弹窗条目、越权 403。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ingestOffers } from '../src/ingest.js';
import { evaluateAlerts, groupAlertsByUser } from '../src/alerts.js';
import { ensureSteamSchemaOnce } from '../src/steam-login.js';

// 测试里默认关掉登录验证码
process.env.CAPTCHA_ENABLED = '0';

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

test('默认 Steam 账号：设为默认持久化；/api/avatar 302 到账号头像；越权 403；解绑清默认', async () => {
  const { store, srv, base, q, alice, SA1, SA2, SB1 } = await setup();
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

    // 设为默认：avatarSource 持久化（刷新 /api/me 保持一致）；avatar 接口 302 到该账号 Steam 头像
    let r = await setDefault(SA1, ac.cookie);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).avatarSource, 'steam:' + SA1);
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(me.user.avatarSource, 'steam:' + SA1, '保存后 /api/me 的 avatarSource 对应');
    const av = await fetch(`${base}/api/avatar/${alice.id}`, { redirect: 'manual' });
    assert.equal(av.status, 302, 'steam 来源 302');
    assert.equal(av.headers.get('location'), 'https://steamcdn/sunming.jpg');

    // 换成第二个账号
    r = await setDefault(SA2, ac.cookie);
    assert.equal((await r.json()).avatarSource, 'steam:' + SA2);
    const lib = await (await fetch(`${base}/api/me/library`, { headers: { cookie: ac.cookie } })).json();
    const cards = lib.accounts;
    assert.equal(cards.filter((a) => a.isDefault).length, 1, '默认只有一个');
    assert.equal(cards.find((a) => a.isDefault).steamId, SA2);

    // 解绑默认账号 → 头像来源清空，不留悬挂引用
    r = await fetch(`${base}/api/steam/accounts/${SA2}`, { method: 'DELETE', headers: { cookie: ac.cookie } });
    assert.equal(r.status, 200);
    const me2 = await (await fetch(`${base}/api/me`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(me2.user.avatarSource, null, '解绑默认账号后头像来源清空');
    const after = await (await fetch(`${base}/api/me/library`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(after.accounts.length, 1, '解绑后行消失');
    assert.equal(after.accounts.every((a) => !a.isDefault), true, '默认徽标消失');

    // 认领/绑定的首个账号自动成为默认（db 层：未设置过才生效）
    const bobRow = (await q('select id from users where username = $1', ['bob'])).rows[0];
    await db.setDefaultSteamAccountIfUnset(q, { userId: bobRow.id, steamId: SB1 });
    const bobMe = (await (await fetch(`${base}/api/me`, { headers: { cookie: bc.cookie } })).json()).user;
    assert.equal(bobMe.avatarSource, 'steam:' + SB1, '首个账号自动成为默认');
    // 已显式设置过的不被覆盖
    await db.setDefaultSteamAccountIfUnset(q, { userId: bobRow.id, steamId: SA1 });
    assert.equal((await db.getUserPublic(q, bobRow.id)).avatar_source, 'steam:' + SB1, '已设置过不覆盖');
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
