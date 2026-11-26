// API 权限模型：匿名可读、登录可改偏好、管理员才能改数据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ingestOffers } from '../src/ingest.js';
import * as visitors from '../src/visitors.js';
import { alignGroupKey } from '../src/match.js';

// 测试里默认关掉登录验证码（专门有一个用例打开它验证拦截）
process.env.CAPTCHA_ENABLED = '0';

async function setup(extraServerOpts = {}) {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);

  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });

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
  // AV 批：原始 SQL 补的历史行不进读模型，这里手动重刷历史列（与生产 ingest 路径的 touch 一致）
  const baseGid = (await q('select id from games where steam_appid = 413150')).rows[0].id;
  await db.refreshGameRegionHist(q, baseGid);

  const srv = await startApiServer({ query: q, store, port: 0, host: '127.0.0.1', ...extraServerOpts });
  return { store, q, srv, base: `http://127.0.0.1:${srv.port}` };
}

const login = async (base, username, password) => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  return { status: res.status, cookie, body: await res.json() };
};

test('匿名可看列表与详情，但不带用户信息', async () => {
  const { store, srv, base, q } = await setup();
  try {
    // CW 批（docs/ADMIN-GAME-POPUP.md §3）：GAME_SELECT 补 header_image / release_date / heat_reviews，
    // 后台详情弹窗靠 /api/games/:appid 的这三个字段渲染封面 / 发售日期 / Steam 评测数（不实时请求 Steam）
    await q(`update games set header_image = 'https://cdn.example/413150/header.jpg', release_date = '2016-02-26', heat_reviews = 412345 where steam_appid = 413150`);
    const list = await fetch(`${base}/api/games`);
    assert.equal(list.status, 200);
    const body = await list.json();
    assert.ok(body.games.length >= 1, "匿名应能看到游戏");
    assert.ok(body.games.some((g) => g.steam_appid === 413150), "应包含目标游戏");
    assert.equal(body.games[0].steam_appid, 413150);

    // 数量接口：库内 / 有价格，前台实时数量靠它
    const count = await (await fetch(`${base}/api/games/count`)).json();
    assert.equal(count.catalog, 1);
    assert.equal(count.priced, 1);

    const detail = await fetch(`${base}/api/games/413150`);
    assert.equal(detail.status, 200);
    const d = await detail.json();
    assert.ok(d.offers.length >= 1, "详情应带报价");
    assert.ok(d.series.length >= 1, "详情应带价格序列");
    assert.equal(d.game.header_image, 'https://cdn.example/413150/header.jpg', '详情应返回封面（弹窗封面用）');
    assert.equal(d.game.release_date, '2016-02-26', '详情应返回 YYYY-MM-DD 发售日期字符串（弹窗元信息用）');
    assert.equal(d.game.heat_reviews, 412345, '详情应返回 Steam 评测数（弹窗评测数用）');
    assert.ok(d.dlc && typeof d.dlc.total === 'number', '详情应带 DLC 摘要（弹窗 DLC 数量用）');

    const me = await (await fetch(`${base}/api/me`)).json();
    assert.equal(me.user, null, '匿名时没有用户');
    assert.equal(me.prefs, null);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('登录才能存偏好；普通用户不能改游戏标记；管理员可以', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const denied = await fetch(`${base}/api/games/413150/interest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interested: false }),
    });
    assert.equal(denied.status, 401, '匿名不能改');

    const alice = await login(base, 'alice', 'alice123456');
    assert.equal(alice.status, 200);
    assert.ok(alice.cookie.startsWith('gp_session='));

    const forbidden = await fetch(`${base}/api/games/413150/interest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ interested: false }),
    });
    assert.equal(forbidden.status, 403, '普通用户不能改游戏标记');

    const prefs = await fetch(`${base}/api/prefs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ hide_uninterested: true, only_discount: true, sort: 'price' }),
    });
    assert.equal(prefs.status, 200);
    const saved = (await prefs.json()).prefs;
    // DA 批（docs/APP-FILTER-SERVER-SIDE.md §5）：only_discount 死字段已删列——老客户端传了也被忽略，响应不再回显
    assert.equal(saved.only_discount, undefined);
    assert.equal(saved.sort, 'price');

    // 页签偏好也落库：登录用户下次按自己的习惯加载
    const prefs2 = await fetch(`${base}/api/prefs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ tab: 'off', sort: 'name' }),
    });
    const saved2 = (await prefs2.json()).prefs;
    assert.equal(saved2.tab, 'off');
    assert.equal(saved2.sort, 'name');
    assert.equal((await q('select tab from user_prefs where user_id = (select id from users where username = $1)', ['alice'])).rows[0].tab, 'off', '页签要写进 user_prefs');
    const meBody = await (await fetch(`${base}/api/me`, { headers: { cookie: alice.cookie } })).json();
    assert.equal(meBody.prefs.tab, 'off', '/api/me 要把页签带回来');
    // DA 批（docs/APP-FILTER-SERVER-SIDE.md §3）：steamBound 随 /api/me 返回（App「已拥有」chip 显隐依据）
    assert.equal(meBody.steamBound, false, '未绑定 Steam 时 steamBound=false');
    // CX 批（docs/USER-PROFILE-EDIT.md §3）：/api/me 带完整本人资料字段（昵称/简介/头像元信息/邮箱验证态）
    assert.equal(meBody.user.email, null, '未绑邮箱回显 null');
    assert.equal(meBody.user.emailVerified, false);
    assert.equal(meBody.user.displayName, null, '新用户昵称为空');
    assert.equal(meBody.user.bio, null);
    assert.equal(meBody.user.avatarSource, null, '未设置头像来源');
    assert.equal(meBody.prefs.email_alerts, true, '到价提醒邮件开关默认开启');

    // 非法值归一化
    const prefs3 = await fetch(`${base}/api/prefs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ tab: 'steam', sort: 'weird' }),
    });
    const saved3 = (await prefs3.json()).prefs;
    assert.equal(saved3.tab, 'all');
    assert.equal(saved3.sort, 'discount');

    const admin = await login(base, 'admin', 'admin123456');
    const ok = await fetch(`${base}/api/games/413150/interest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ interested: false }),
    });
    assert.equal(ok.status, 200);
    const row = (await q('select interested from games where steam_appid = 413150')).rows[0];
    assert.equal(row.interested, false, '管理员改完要落库');

    // 没有 Steam appid 的游戏（杉果）：按内部 id 标记，前台详情弹窗用这条接口
    const gid = (await q("insert into games (name) values ('杉果专属游戏') returning id")).rows[0].id;
    const anonById = await fetch(`${base}/api/games/id/${gid}/interest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interested: false }),
    });
    assert.equal(anonById.status, 401, '匿名不能按 id 标记');

    const byId = await fetch(`${base}/api/games/id/${gid}/interest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ interested: false }),
    });
    assert.equal(byId.status, 200);
    assert.equal((await q('select interested from games where id = $1', [gid])).rows[0].interested, false, '按内部 id 也要落库');

    const byIdOwned = await fetch(`${base}/api/games/id/${gid}/owned`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ owned: true }),
    });
    assert.equal(byIdOwned.status, 200);
    assert.equal((await q('select owned from games where id = $1', [gid])).rows[0].owned, true);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('密码错误、登出、管理员看用户列表', async () => {
  const { store, srv, base } = await setup();
  try {
    const bad = await login(base, 'alice', 'wrong-password');
    assert.equal(bad.status, 401);

    const admin = await login(base, 'admin', 'admin123456');
    const users = await fetch(`${base}/api/admin/users`, { headers: { cookie: admin.cookie } });
    assert.equal(users.status, 200);
    const names = (await users.json()).users.map((u) => u.username);
    assert.deepEqual(names.sort(), ['admin', 'alice']);

    const anonUsers = await fetch(`${base}/api/admin/users`);
    assert.equal(anonUsers.status, 401);

    const out = await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie: admin.cookie } });
    assert.equal(out.status, 200);
    const after = await fetch(`${base}/api/me`, { headers: { cookie: admin.cookie } });
    assert.equal((await after.json()).user, null, '登出后会话失效');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('单款详情不受列表前 500 名限制（后台编辑不再 404）', async () => {
  const { store, q, srv, base } = await setup();
  try {
    await q("insert into games (steam_appid, name) values (999999, '后排游戏')");
    const r = await fetch(`${base}/api/games/999999`);
    assert.equal(r.status, 200, '没有报价、不在列表里的游戏也要能取到详情');
    assert.equal((await r.json()).game.name, '后排游戏');
    const id = (await q('select id from games where steam_appid = 999999')).rows[0].id;
    const r2 = await fetch(`${base}/api/games/by-id/${id}`);
    assert.equal(r2.status, 200, '按内部 id 同样要能取到');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('价格变动报表：快照带前价，涨跌榜与统计正确', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const offer = (await q('select o.id from offers o join games g on g.id = o.game_id where g.steam_appid = 413150')).rows[0];

    // 基线快照（无前价）+ 降价快照（4800 → 3000）
    await q("insert into price_snapshots (offer_id, price_cents, discount_pct, in_stock, raw_hash) values ($1, 4800, 0, true, 'h0')", [offer.id]);
    await q("insert into price_snapshots (offer_id, price_cents, discount_pct, in_stock, raw_hash, prev_price_cents) values ($1, 3000, 37, true, 'h1', 4800)", [offer.id]);

    const repBody = await (await fetch(`${base}/api/admin/reports/price?hours=24&days=7`, { headers: { cookie: admin.cookie } })).json();
    const rep = repBody.report;
    assert.equal(rep.changed, 1);
    assert.equal(rep.drops, 1);
    assert.equal(rep.rises, 0);
    assert.equal(rep.topDrops[0].was, 4800);
    assert.equal(rep.topDrops[0].now_price, 3000);
    assert.equal(rep.topDrops[0].steam_appid, 413150);
    // setup 里 daily_prices 记录 4800，现价 3000 低于它 → 算新史低
    assert.equal(rep.newLows, 1, '降价到历史最低以下算新史低');
    // AT 批（docs/ADMIN-CONSOLE-IA.md §6）：去 daily、加 series——报告里出现的 game_id 一次查出近 N 天序列
    assert.equal('daily' in repBody, false, 'daily 已移除');
    assert.ok(repBody.series && typeof repBody.series === 'object', 'series 以对象返回（按 game_id 索引）');
    const gid = rep.topDrops[0].game_id;
    assert.ok(Array.isArray(repBody.series[String(gid)]), '报告内游戏的 7 天序列是数组（悬停线图数据源）');

    // CSV 导出
    const csv = await fetch(`${base}/api/admin/reports/price.csv?hours=24`, { headers: { cookie: admin.cookie } });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') || '', /text\/csv/);
    const csvText = await csv.text();
    assert.match(csvText, /old_price,new_price/);
    assert.match(csvText, /星露谷物语/);
    assert.equal((await fetch(`${base}/api/admin/reports/price.csv`)).status, 401, '匿名不能导出');

    assert.equal((await fetch(`${base}/api/admin/reports/price`)).status, 401, '匿名不能看价格报表');

    // ingest 写快照时要带前价：再喂一次 2400
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
          priceCents: 2400,
          originalCents: 4800,
          discountPct: 50,
          inStock: true,
          buyUrl: 'https://store.steampowered.com/app/413150/',
          meta: {},
        },
      ],
    });
    const last = (await q('select price_cents, prev_price_cents from price_snapshots where offer_id = $1 order by id desc limit 1', [offer.id])).rows[0];
    assert.equal(last.price_cents, 2400);
    assert.equal(last.prev_price_cents, 3000, '新快照要记住上一条的价格');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('游戏同步统计与筛选：待同步数量、pending/done 过滤（新口径：待同步=未探测或 ok 缺简介）', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const statsUrl = `${base}/api/admin/games/stats`;
    const s1 = (await (await fetch(statsUrl, { headers: { cookie: admin.cookie } })).json()).stats;
    assert.equal(s1.total, 1);
    assert.equal(s1.withAppid, 1);
    assert.equal(s1.pending, 1, '从未探测 → 待同步');
    assert.equal(s1.pendingProbe, 1, '未探测分项 = 1');
    assert.equal(s1.synced, 0);

    // 判定为 ok 且补说明后 → 已同步（docs/STEAM-SYNC-STATUS-AND-RATING.md §4）
    await q("update games set description = '一段说明', steam_status = 'ok' where steam_appid = 413150");
    const s2 = (await (await fetch(statsUrl, { headers: { cookie: admin.cookie } })).json()).stats;
    assert.equal(s2.pending, 0);
    assert.equal(s2.synced, 1);

    const pending = await (await fetch(`${base}/api/admin/games?sync=pending`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(pending.total, 0, '没有待同步的');
    const done = await (await fetch(`${base}/api/admin/games?sync=done`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(done.total, 1, '已同步的能筛出来');
    // 新参数：按 steam_status 分项筛选（指标卡点击）
    const okFilter = await (await fetch(`${base}/api/admin/games?status=ok`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(okFilter.total, 1, 'status=ok 能筛出来');

    // 报价筛选（指标卡「有报价」点击）：与 stats.withOffers 口径一致
    const priced = await (await fetch(`${base}/api/admin/games?offers=priced`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(priced.total, 1, '有报价的能筛出来');
    const none = await (await fetch(`${base}/api/admin/games?offers=none`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(none.total, 0);

    // V 批：内容分级筛选（docs/STEAM-SYNC-STATUS-AND-RATING.md §13）：
    // 再造两款游戏：一款成人、一款成熟；成人+成熟+未标注 = 未删除总数
    // FT 批（docs/EXPLICIT-RATING.md §2.4）：成人游戏带 explicit_flag（严格=色情游戏，adult 子集）
    await q("insert into games (steam_appid, name, description, adult_flag, explicit_flag) values (413151, '成人游戏', '说明', true, true)");
    await q("insert into games (steam_appid, name, description, mature_flag) values (413152, '成熟游戏', '说明', true)");
    const adult = await (await fetch(`${base}/api/admin/games?rating=adult`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(adult.total, 1, '成人筛出 1');
    assert.equal(adult.games[0].steam_appid, 413151);
    const explicit = await (await fetch(`${base}/api/admin/games?rating=explicit`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(explicit.total, 1, '色情游戏（严格）筛出 1');
    assert.equal(explicit.games[0].steam_appid, 413151);
    const mature = await (await fetch(`${base}/api/admin/games?rating=mature`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(mature.total, 1, '成熟筛出 1');
    const noneRating = await (await fetch(`${base}/api/admin/games?rating=none`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(noneRating.total, 1, '未标注只剩原游戏');
    // 与状态叠加：rating=adult + status=pending（413151 未探测）
    const stacked = await (await fetch(`${base}/api/admin/games?rating=adult&status=pending`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(stacked.total, 1, '分级与状态可叠加');
    const s3 = (await (await fetch(statsUrl, { headers: { cookie: admin.cookie } })).json()).stats;
    assert.equal(s3.adult, 1);
    assert.equal(s3.explicit, 1, 'stats.explicit = 色情游戏（严格）计数');
    assert.equal(s3.mature, 1);
    assert.equal(s3.total - s3.deleted, s3.adult + s3.mature + noneRating.total, '成人+成熟+未标注=未删除总数');

    assert.equal((await fetch(statsUrl)).status, 401, '匿名不能看统计');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('EF 批：前台 /api/games 支持 rating=adult|mature|none（与后台同一口径），非法值回落不过滤', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const seed = async (appid, name, adult, mature, explicit = false) => {
      await q('insert into games (steam_appid, name, adult_flag, mature_flag, explicit_flag) values ($1, $2, $3, $4, $5)', [appid, name, adult, mature, explicit]);
      const gid = (await q('select id from games where steam_appid = $1', [appid])).rows[0].id;
      await q(
        "insert into offers (game_id, platform_code, product_type, region, currency, price_cents) values ($1,'steam','official_direct','cn','CNY',1000)",
        [gid],
      );
      await q(
        "insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) values ($1,'steam','cn', current_date, 1000, 'CNY')",
        [gid],
      );
      await db.refreshGameRegionPrices(q, gid);
      await db.refreshGameRegionHist(q, gid);
    };
    await seed(413160, '未标注A', false, false);
    await seed(413161, '十八禁B', true, false);
    await seed(413162, '成熟C', false, true);
    // FT 批：宽成人（2077 型，adult 但非 explicit）与纯色情游戏分开
    await seed(413163, '宽成人D', true, false, false);
    await seed(413164, '黄油E', true, false, true);

    const namesOf = (d) => (d.games ?? []).map((g) => g.name).sort();
    const adult = await (await fetch(`${base}/api/games?adult=badge&rating=adult`)).json();
    assert.deepEqual(namesOf(adult), ['十八禁B', '宽成人D', '黄油E'].sort(), 'rating=adult 只看成人（宽口径）');
    assert.equal(adult.total, 3);
    const explicit = await (await fetch(`${base}/api/games?adult=badge&rating=explicit`)).json();
    assert.deepEqual(namesOf(explicit), ['黄油E'], 'rating=explicit 只看色情游戏（2077 型不出现）');
    assert.equal(explicit.total, 1);
    const mature = await (await fetch(`${base}/api/games?adult=badge&rating=mature`)).json();
    assert.deepEqual(namesOf(mature), ['成熟C'], 'rating=mature 只看成熟内容');
    const noneRating = await (await fetch(`${base}/api/games?adult=badge&rating=none`)).json();
    assert.deepEqual(namesOf(noneRating), ['星露谷物语', '未标注A'].sort(), 'rating=none 只看未标注（含 setup 初始游戏）');
    assert.equal(noneRating.total, 2);
    const invalid = await (await fetch(`${base}/api/games?adult=badge&rating=weird`)).json();
    assert.equal(invalid.total, 6, '非法 rating 回落为不过滤（白名单外一律不过滤）');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('服务端搜索与分页：分页元数据、关键词全库搜索、折扣排序', async () => {
  const { store, q, srv, base } = await setup();
  try {
    // 造 30 款带日价格与 Steam 报价的游戏（折扣 20% ~ 49%）
    for (let i = 0; i < 30; i += 1) {
      const appid = 700000 + i;
      await q("insert into games (steam_appid, name, description) values ($1, $2, '说明')", [appid, '测试游戏 ' + i]);
      const gid = (await q('select id from games where steam_appid = $1', [appid])).rows[0].id;
      await q(
        "insert into offers (game_id, platform_code, product_type, region, currency, price_cents, original_cents, discount_pct, in_stock) " +
          "values ($1,'steam','official_direct','cn','CNY',$2,2000,$3,true)",
        [gid, 1000 + i * 10, 20 + i],
      );
      await q(
        "insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) values ($1,'steam','cn', current_date, $2, 'CNY')",
        [gid, 1000 + i * 10],
      );
      // AV 批：原始 SQL 种价不进读模型，手动刷新价格列 + 历史列
      await db.refreshGameRegionPrices(q, gid);
      await db.refreshGameRegionHist(q, gid);
    }

    const p1 = await (await fetch(`${base}/api/games?page=1&pageSize=10`)).json();
    assert.equal(p1.total, 31, '30 款新游戏 + 初始 1 款');
    assert.equal(p1.page, 1);
    assert.equal(p1.pageSize, 10);
    assert.equal(p1.pages, 4);
    assert.equal(p1.games.length, 10);
    assert.equal(p1.games[0].discount, 49, '默认按折扣降序');
    assert.ok(p1.games[0].discount >= p1.games[1].discount);

    const p2 = await (await fetch(`${base}/api/games?page=2&pageSize=10`)).json();
    assert.equal(p2.page, 2);
    assert.notDeepEqual(p1.games.map((g) => g.id), p2.games.map((g) => g.id), '第二页数据不同');

    // 全库搜索：不在第一页的游戏也能搜到
    const hit = await (await fetch(`${base}/api/games?q=${encodeURIComponent('测试游戏 29')}`)).json();
    assert.equal(hit.total, 1);
    assert.equal(hit.games[0].name, '测试游戏 29');

    // 按价格升序
    const byPrice = await (await fetch(`${base}/api/games?sort=price&pageSize=200`)).json();
    assert.equal(byPrice.games[0].current_low, 1000, '最便宜的排在前面');
    assert.equal(byPrice.games.length, 31);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('合并重复游戏：报价迁移到目标、源行删除、参数校验', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const dupId = (await q("insert into games (steam_appid, name) values (555001, '星露谷物语(重复)') returning id")).rows[0].id;
    await q(
      "insert into offers (game_id, platform_code, product_type, region, currency, price_cents, in_stock) values ($1,'sonkwo','authorized_direct','cn','CNY',1000,true)",
      [dupId],
    );
    const r = await fetch(`${base}/api/admin/games/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ fromAppid: 555001, toAppid: 413150 }),
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.result.merged, true);
    assert.ok(body.result.moved >= 1, '至少迁移 1 条报价');
    assert.equal((await q('select count(*)::int as n from games where steam_appid = 555001')).rows[0].n, 0, '源行已删除且合并进目标');
    const targetId = (await q('select id from games where steam_appid = 413150')).rows[0].id;
    assert.equal(
      (await q("select count(*)::int as n from offers where game_id = $1 and platform_code = 'sonkwo'", [targetId])).rows[0].n,
      1,
      '杉果报价已迁到目标游戏',
    );

    // 匿名 401、同源同目标 400
    assert.equal(
      (await fetch(`${base}/api/admin/games/merge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fromAppid: 413150, toAppid: 730 }) })).status,
      401,
    );
    const bad = await fetch(`${base}/api/admin/games/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ fromAppid: 413150, toAppid: 413150 }),
    });
    assert.equal(bad.status, 400);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('个人标记：已拥有按用户推导（手动 ∪ 绑定账号库），全局 games.owned 已废弃', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const alice = await login(base, 'alice', 'alice123456');
    const admin = await login(base, 'admin', 'admin123456');

    // 全局标记已废弃：匿名/未绑定账号的用户一律按「未拥有」看待，owned 筛选对游客无效
    await q('update games set owned = true where steam_appid = 413150');
    const anon = await (await fetch(`${base}/api/games`)).json();
    assert.equal(anon.total, 1, 'games.owned 全局值不再影响前台（游客看到全量）');

    // alice 手动排除（owned=false）→ 有效值 false，游戏可见
    const set = await fetch(`${base}/api/games/413150/flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ owned: false }),
    });
    assert.equal(set.status, 200);
    const setBody = await set.json();
    assert.equal(setBody.flags.owned, false);
    assert.equal(setBody.flags.user_owned, false);

    const mine = await (await fetch(`${base}/api/games`, { headers: { cookie: alice.cookie } })).json();
    assert.equal(mine.total, 1, '手动排除后游戏可见');
    assert.equal(mine.games[0].owned, false);

    const detail = await (await fetch(`${base}/api/games/413150`, { headers: { cookie: alice.cookie } })).json();
    assert.equal(detail.game.owned, false, '详情也返回个人生效值');

    // 'clear' 显式清除个人标记 → 跟随推导（无绑定账号 → false；不再回退 games.owned）
    const clr = await fetch(`${base}/api/games/413150/flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ owned: 'clear' }),
    });
    assert.equal(clr.status, 200);
    assert.equal((await clr.json()).flags.owned, false, '清除后跟随推导（未绑账号 → 未拥有）');

    // admin 没有个人标记 → 推导也为 false
    const adminList = await (await fetch(`${base}/api/games`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(adminList.total, 1, '全局 owned=true 不再推导成已拥有');

    // 匿名不能写个人标记
    assert.equal(
      (await fetch(`${base}/api/games/413150/flags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interested: true }),
      })).status,
      401,
    );
  } finally {
    await srv.close();
    await store.close();
  }
});

test('CV：owned=include 时已拥有游戏列表/搜索可见并带账号名；exclude 保持旧行为', async () => {
  const { store, srv, base } = await setup();
  const q = (sql, p) => store.query(sql, p);
  const search = (body, cookie) =>
    fetch(`${base}/api/games/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const baseParams = { page: 1, pageSize: 20, region: 'cn', type: 'all', sort: 'discount', q: '', interest: 'all', owned: 'include' };
  try {
    const alice = await login(base, 'alice', 'alice123456');
    const aliceId = (await q('select id from users where username = $1', ['alice'])).rows[0].id;
    // 绑定 Steam 账号 + 库内 413150（星露谷物语）→ 推导「已拥有」
    await q('insert into steam_accounts (steam_id, persona_name, user_id) values ($1,$2,$3)', ['76561198000000099', 'Alice 主号', aliceId]);
    await q('insert into steam_games (steam_id, appid) values ($1,$2)', ['76561198000000099', 413150]);

    // include：列表可见 + owned/owned_by 账号名（CV 决策 1/3）
    const inc = await (await search({ ...baseParams, owned: 'include' }, alice.cookie)).json();
    const ownedRow = inc.games.find((g) => g.steam_appid === 413150);
    assert.ok(ownedRow, 'owned=include 时已拥有游戏仍在列表');
    assert.equal(ownedRow.owned, true, 'owned 推导为 true');
    assert.ok(Array.isArray(ownedRow.owned_by) && ownedRow.owned_by.some((a) => a.name === 'Alice 主号'), '列表 owned_by 带账号名');

    // 搜索同口径：关键词也能搜到已拥有（CV 现象回归）
    const kw = await (await search({ ...baseParams, owned: 'include', q: '星露谷' }, alice.cookie)).json();
    assert.ok(kw.games.some((g) => g.steam_appid === 413150), '搜索 include 时已拥有游戏可被搜到');

    // exclude 保持旧行为（CV 决策 5：服务端默认口径不变，仅前端显式 include）
    const exc = await (await search({ ...baseParams, owned: 'exclude' }, alice.cookie)).json();
    assert.ok(!exc.games.some((g) => g.steam_appid === 413150), 'owned=exclude 仍排除已拥有');

    // 详情接口返回 owned_by 账号名（CV 决策 6，App 消费）
    const detail = await (await fetch(`${base}/api/games/413150`, { headers: { cookie: alice.cookie } })).json();
    assert.ok(detail.game.owned_by.some((a) => a.name === 'Alice 主号'), '详情返回 owned_by 账号名');

    // DA 批：绑定 Steam 后 /api/me 的 steamBound=true（App「已拥有」chip 显示依据）
    const meBound = await (await fetch(`${base}/api/me`, { headers: { cookie: alice.cookie } })).json();
    assert.equal(meBound.steamBound, true, '绑定 Steam 后 steamBound=true');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('「未标记」过滤：marks=unmarked 排除已标 感兴趣/不感兴趣，清除后恢复', async () => {
  const { store, srv, base } = await setup();
  const search = (body, cookie) =>
    fetch(`${base}/api/games/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const baseParams = { page: 1, pageSize: 20, region: 'cn', type: 'all', sort: 'discount', q: '', interest: 'all', owned: 'exclude' };
  try {
    const alice = await login(base, 'alice', 'alice123456');

    // 未标记：unmarked 与 any 都能看到
    const before = await (await search({ ...baseParams, marks: 'unmarked' }, alice.cookie)).json();
    assert.equal(before.total, 1, '未标记时能看到');

    // 标感兴趣 → unmarked 排除、any 保持
    await fetch(`${base}/api/games/413150/flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ interested: true }),
    });
    const unmarked = await (await search({ ...baseParams, marks: 'unmarked' }, alice.cookie)).json();
    assert.equal(unmarked.total, 0, '已标感兴趣后 unmarked 排除');
    const any = await (await search({ ...baseParams, marks: 'any' }, alice.cookie)).json();
    assert.equal(any.total, 1, 'marks=any 保持旧行为');

    // 不感兴趣同样被排除
    await fetch(`${base}/api/games/413150/flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ interested: false }),
    });
    const off = await (await search({ ...baseParams, marks: 'unmarked' }, alice.cookie)).json();
    assert.equal(off.total, 0, '不感兴趣同样被排除');

    // 清除 → 恢复可见
    await fetch(`${base}/api/games/413150/flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ interested: 'clear' }),
    });
    const after = await (await search({ ...baseParams, marks: 'unmarked' }, alice.cookie)).json();
    assert.equal(after.total, 1, '清除后恢复可见');

    // 游客：带 excludeIds 的 unmarked 也生效
    const guest = await (await search({ ...baseParams, marks: 'unmarked', guestFlags: { interestedIds: [], uninterestedIds: [], ownedIds: [], excludeIds: [1] } }, '')).json();
    assert.equal(guest.total, 0, '游客 excludeIds 生效');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('到价提醒：管理员增删查、appid 解析、普通用户 403、匿名 401', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const alice = await login(base, 'alice', 'alice123456');

    const byAppid = await fetch(`${base}/api/admin/watchlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ appid: 413150, targetCents: 3000 }),
    });
    assert.equal(byAppid.status, 200);
    // CL 批（v2.23.0）：GET 改为全站分页清单 { items, total, page, pageSize, pages }（按提醒 id 管理）
    const list = await (await fetch(`${base}/api/admin/watchlist`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(list.total, 1);
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].target_cents, 3000, '按 appid 也能解析成游戏');

    const gid = list.items[0].game_id;
    const watchId = list.items[0].id;
    // 留空 = 只跟史低
    await fetch(`${base}/api/admin/watchlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ gameId: gid, targetCents: null }),
    });
    const list2 = await (await fetch(`${base}/api/admin/watchlist`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(list2.items[0].target_cents, null, '留空应覆盖成史低提醒');

    assert.equal((await fetch(`${base}/api/admin/watchlist`, { headers: { cookie: alice.cookie } })).status, 403);
    assert.equal((await fetch(`${base}/api/admin/watchlist`)).status, 401);

    // CL 批：删除按提醒 id
    const del = await fetch(`${base}/api/admin/watchlist/${watchId}`, { method: 'DELETE', headers: { cookie: admin.cookie } });
    assert.equal(del.status, 200);
    const list3 = await (await fetch(`${base}/api/admin/watchlist`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(list3.total, 0);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('类型筛选：只看游戏 / 只看 DLC', async () => {
  const { store, q, srv, base } = await setup();
  try {
    // 初始游戏标成 game；再造一个 DLC（带日价格与 Steam 报价）
    await q("update games set app_type = 'game' where steam_appid = 413150");
    const dlcId = (await q("insert into games (steam_appid, name, app_type, description) values (990001, '测试 DLC', 'dlc', '说明') returning id")).rows[0].id;
    await q(
      "insert into offers (game_id, platform_code, product_type, region, currency, price_cents, discount_pct, in_stock) values ($1,'steam','official_direct','cn','CNY',500,0,true)",
      [dlcId],
    );
    await q(
      "insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) values ($1,'steam','cn', current_date, 500, 'CNY')",
      [dlcId],
    );
    // AV 批：原始 SQL 种价不进读模型，手动刷新
    await db.refreshGameRegionPrices(q, dlcId);
    await db.refreshGameRegionHist(q, dlcId);

    const onlyDlc = await (await fetch(`${base}/api/games?type=dlc`)).json();
    assert.equal(onlyDlc.total, 1);
    assert.equal(onlyDlc.games[0].name, '测试 DLC');
    assert.equal(onlyDlc.type, 'dlc');

    const onlyGame = await (await fetch(`${base}/api/games?type=game`)).json();
    assert.equal(onlyGame.total, 1);
    assert.equal(onlyGame.games[0].steam_appid, 413150);

    const all = await (await fetch(`${base}/api/games`)).json();
    assert.equal(all.total, 2, '默认不过滤类型');

    // 非法值回落 all
    const fallback = await (await fetch(`${base}/api/games?type=weird`)).json();
    assert.equal(fallback.type, 'all');
    assert.equal(fallback.total, 2);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('备份接口、价格历史 CSV、区服筛选、日志时间范围', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'steamdeals-backup-'));
  const oldBackupDir = process.env.BACKUP_DIR;
  const oldCsvEnv = process.env.HISTORY_CSV_ENABLED;
  const oldBackupEnabled = process.env.BACKUP_ENABLED;
  process.env.BACKUP_DIR = tmp;
  // FR 批（docs/BACKUP-AS-FEATURE.md）：system.backupEnabled 默认关闭（403），备份接口用例显式开启
  process.env.BACKUP_ENABLED = '1';
  const { store, q, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');

    // 立即备份
    const bk = await fetch(`${base}/api/admin/backup`, { method: 'POST', headers: { cookie: admin.cookie } });
    assert.equal(bk.status, 200);
    const bkBody = await bk.json();
    assert.equal(bkBody.result.tables, 8, '备份 8 张核心表');
    assert.ok(bkBody.result.rows >= 1);
    assert.ok(bkBody.backups.some((b) => b.name.startsWith('backup-')), '列表里能看到刚生成的备份');
    assert.equal((await fetch(`${base}/api/admin/backup`, { method: 'POST' })).status, 401, '匿名不能备份');

    // 单款价格历史 CSV：默认关闭 → 404（与未知路由一致）；HISTORY_CSV_ENABLED=1 才放行
    delete process.env.HISTORY_CSV_ENABLED;
    const csvOff = await fetch(`${base}/api/games/413150/history.csv?days=90`);
    assert.equal(csvOff.status, 404, 'CSV 默认关闭');
    process.env.HISTORY_CSV_ENABLED = '1';
    const csv = await fetch(`${base}/api/games/413150/history.csv?days=90`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') || '', /text\/csv/);
    const csvText = await csv.text();
    assert.match(csvText, /date,price_cents,price,currency/);
    assert.match(csvText, /4800/, 'setup 里昨天的最低价应在 CSV 里');

    // 区服筛选：美国区没有日价格数据 → 空
    const us = await (await fetch(`${base}/api/games?region=us`)).json();
    assert.equal(us.total, 0);
    const cn = await (await fetch(`${base}/api/games?region=cn`)).json();
    assert.equal(cn.total, 1);

    // 日志时间范围参数不报错
    const logs = await fetch(`${base}/api/admin/logs?minutes=60&limit=10`, { headers: { cookie: admin.cookie } });
    assert.equal(logs.status, 200);
  } finally {
    await srv.close();
    await store.close();
    if (oldBackupDir === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = oldBackupDir;
    if (oldCsvEnv === undefined) delete process.env.HISTORY_CSV_ENABLED;
    else process.env.HISTORY_CSV_ENABLED = oldCsvEnv;
    if (oldBackupEnabled === undefined) delete process.env.BACKUP_ENABLED;
    else process.env.BACKUP_ENABLED = oldBackupEnabled;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('系统设置：敏感字段默认不回显，可单独查看明文，非敏感字段拒绝查看', async () => {
  const { store, q, srv, base } = await setup();
  const savedProxy = process.env.STEAM_PROXY;
  const settings = await import('../src/settings.js');
  try {
    // 生产环境由启动流程建表；测试里直接起服务，这里补一次
    await settings.ensureSettingsSchema(store);
    const admin = await login(base, 'admin', 'admin123456');

    // 保存一个代理（敏感字段）
    const saved = await fetch(`${base}/api/admin/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ values: { 'network.steamProxy': 'http://127.0.0.1:7890' } }),
    });
    assert.equal(saved.status, 200);

    // 列表接口不回显明文，只给 hasValue
    const view = await (await fetch(`${base}/api/admin/settings`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(view.values['network.steamProxy'], '', '列表里密钥不回显');
    assert.equal(view.secrets['network.steamProxy'].hasValue, true);

    // 单独查看明文
    const reveal = await fetch(`${base}/api/admin/settings/value?key=network.steamProxy`, { headers: { cookie: admin.cookie } });
    assert.equal(reveal.status, 200);
    assert.equal((await reveal.json()).value, 'http://127.0.0.1:7890');

    // 非敏感字段不允许走这个接口
    const bad = await fetch(`${base}/api/admin/settings/value?key=alerts.smtp.port`, { headers: { cookie: admin.cookie } });
    assert.equal(bad.status, 400);

    // 匿名 401
    assert.equal((await fetch(`${base}/api/admin/settings/value?key=network.steamProxy`)).status, 401);
  } finally {
    if (savedProxy === undefined) delete process.env.STEAM_PROXY;
    else process.env.STEAM_PROXY = savedProxy;
    await srv.close();
    await store.close();
  }
});

test('版本接口：登录用户可读、force=1 仅管理员、匿名 401，可关闭出网检查', async () => {
  const { store, q, srv, base } = await setup();
  const pkg = (await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const expected = JSON.parse(pkg).version;
  const oldCheck = process.env.UPDATE_CHECK;
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const alice = await login(base, 'alice', 'alice123456');

    process.env.UPDATE_CHECK = '0';
    // FB（docs/CONSOLE-HEADER-FIX.md §2-2/§3-2）：版本徽标所有登录用户可见 → 普通用户也能读版本
    const off = await (await fetch(`${base}/api/admin/version`, { headers: { cookie: alice.cookie } })).json();
    assert.equal(off.current, expected, '当前版本来自 package.json（普通用户可读）');
    assert.equal(off.latest, null, '关闭检查时不出网');
    assert.equal(off.updateAvailable, false);

    delete process.env.UPDATE_CHECK;
    process.env.UPDATE_CHECK = '1';
    // 版本检查有模块级缓存（成功 6h / 失败 10min）：先清空，让下面的 force 语义可观测
    const { resetVersionCache } = await import('../src/version.js');
    resetVersionCache();
    // 管理员 force=1：真实检查一次（无网时写失败缓存），checkedAt 作为后续缓存的基准
    const adminForce = await (await fetch(`${base}/api/admin/version?force=1`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(adminForce.current, expected);
    assert.ok('updateAvailable' in adminForce, '字段齐全（网络失败时 error 里给原因）');

    // FB（规格 §2-3 取「忽略 force」）：普通用户带 force=1 也不触发外网检查——
    // 可观测证据：checkedAt 与管理员刚写入的缓存完全一致；若 force 生效会重新出网产生新 checkedAt。
    const asUser = await fetch(`${base}/api/admin/version?force=1`, { headers: { cookie: alice.cookie } });
    assert.equal(asUser.status, 200, '普通用户读版本 200（不再是 403）');
    const userBody = await asUser.json();
    assert.equal(userBody.current, expected, '普通用户拿到当前版本');
    assert.equal(userBody.checkedAt, adminForce.checkedAt, '普通用户 force=1 被忽略：命中缓存、不触发外网检查');
    for (const key of ['current', 'latest', 'updateAvailable', 'url', 'checkedAt', 'error', 'repo', 'source', 'region']) {
      assert.ok(key in userBody, `响应契约不变：字段 ${key} 保留`);
    }

    assert.equal((await fetch(`${base}/api/admin/version`)).status, 401, '未登录仍 401');
  } finally {
    if (oldCheck === undefined) delete process.env.UPDATE_CHECK;
    else process.env.UPDATE_CHECK = oldCheck;
    await srv.close();
    await store.close();
  }
});

test('数据指纹：数据变化后 stamp 改变，轮询不写访问日志', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const s1 = await (await fetch(`${base}/api/games/stamp`)).json();
    assert.ok(s1.stamp, '应返回指纹');
    assert.equal(typeof s1.games, 'number');
    assert.equal(typeof s1.offers, 'number');

    // 新增游戏 + 报价后指纹必须变化
    const gid = (await q("insert into games (steam_appid, name) values (900001, '指纹测试') returning id")).rows[0].id;
    await q(
      "insert into offers (game_id, platform_code, product_type, region, currency, price_cents, in_stock) values ($1,'steam','official_direct','cn','CNY',1000,true)",
      [gid],
    );
    const s2 = await (await fetch(`${base}/api/games/stamp`)).json();
    assert.notEqual(s2.stamp, s1.stamp);
    assert.ok(s2.games > s1.games || s2.offers > s1.offers);

    // 指纹接口不进访问记录（否则自动刷新会污染统计）
    const before = (await q('select count(*)::int as n from visitor_logs')).rows[0].n;
    await (await fetch(`${base}/api/games/stamp`)).text();
    await new Promise((r) => setTimeout(r, 300)); // 日志在响应 finish 后异步写
    const after = (await q('select count(*)::int as n from visitor_logs')).rows[0].n;
    assert.equal(after, before, '轮询指纹不应产生访问记录');

    // 控制台轮询接口（sync/status、sync/runs）同样不写访问日志
    const admin = await login(base, 'admin', 'admin123456');
    const baseline = (await q('select count(*)::int as n from visitor_logs')).rows[0].n;
    await (await fetch(`${base}/api/admin/sync/status`, { headers: { cookie: admin.cookie } })).text();
    await (await fetch(`${base}/api/admin/sync/runs?limit=5`, { headers: { cookie: admin.cookie } })).text();
    await new Promise((r) => setTimeout(r, 300));
    const afterPoll = (await q('select count(*)::int as n from visitor_logs')).rows[0].n;
    assert.equal(afterPoll, baseline, '控制台轮询接口不应产生访问记录');
  } finally {
    await srv.close();
    await store.close();
  }
});

// FW-3（docs/SLOW-SYNC.md §3.2/§4、§8 验收第 7 条）：/api/admin/sync/status 带 403 冷却与速率闸门字段。
// 形状约定：无冷却时 forbidden.active=false（字段齐全，前端好判）；闸门文件缺失按满桶（tokens=perMin）。
test('FW-3：/api/admin/sync/status 返回 forbidden（403 冷却）与 rateGate（速率闸门）', async () => {
  const dir = join(tmpdir(), `fw3-status-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const prev403 = process.env.STEAM_403_FILE;
  const prevRate = process.env.STEAM_RATE_FILE;
  const prevPerMin = process.env.SYNC_RATE_GATE_PER_MIN;
  process.env.STEAM_403_FILE = join(dir, 'missing-403.json');
  process.env.STEAM_RATE_FILE = join(dir, 'missing-rate.json');
  delete process.env.SYNC_RATE_GATE_PER_MIN;
  const { store, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const s1 = await (await fetch(`${base}/api/admin/sync/status`, { headers: { cookie: admin.cookie } })).json();
    assert.ok(s1.forbidden, '带 forbidden 字段');
    assert.equal(s1.forbidden.active, false, '无冷却时 active:false（前端好判）');
    assert.equal(s1.forbidden.count, 0);
    assert.equal(s1.forbidden.until, null, '无冷却时 until 为 null');
    assert.equal(s1.forbidden.remainingMin, 0);
    assert.ok(s1.rateGate, '带 rateGate 字段');
    assert.equal(s1.rateGate.perMin, 30, '默认闸门 30 次/分钟');
    assert.equal(s1.rateGate.tokens, 30, '闸门文件不存在按满桶');
    assert.equal(s1.rateGate.used, 0);

    // 写入冷却与半桶状态 → 用 circuit/reset 失效 3s 短缓存后重读
    writeFileSync(
      process.env.STEAM_403_FILE,
      JSON.stringify({ until: new Date(Date.now() + 5 * 60_000).toISOString(), count: 2, at: new Date().toISOString(), label: 'pool' }),
    );
    writeFileSync(process.env.STEAM_RATE_FILE, JSON.stringify({ tokens: 12, at: new Date().toISOString() }));
    const bust = await fetch(`${base}/api/admin/circuit/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ name: 'fw3-cache-bust' }),
    });
    assert.equal(bust.status, 200, '短路缓存失效接口可用');
    const s2 = await (await fetch(`${base}/api/admin/sync/status`, { headers: { cookie: admin.cookie } })).json();
    assert.equal(s2.forbidden.active, true, '冷却期内 active:true');
    assert.equal(s2.forbidden.count, 2, '连续被拒次数来自 data/steam-403.json');
    assert.equal(s2.forbidden.label, 'pool');
    assert.ok(s2.forbidden.remainingMin >= 1 && s2.forbidden.remainingMin <= 5, `剩余分钟应在 1..5，实际 ${s2.forbidden.remainingMin}`);
    assert.ok(Date.parse(s2.forbidden.until) > Date.now(), 'until 是未来时刻');
    assert.equal(s2.rateGate.perMin, 30);
    assert.equal(s2.rateGate.tokens, 12, 'tokens 按 at 补充后读回');
    assert.equal(s2.rateGate.used, 18, 'used = perMin - tokens');

    // 仅管理员可读（既有 requireAdmin 语义不变）
    const alice = await login(base, 'alice', 'alice123456');
    assert.equal((await fetch(`${base}/api/admin/sync/status`, { headers: { cookie: alice.cookie } })).status, 403, '普通用户 403');
  } finally {
    await srv.close();
    await store.close();
    if (prev403 == null) delete process.env.STEAM_403_FILE;
    else process.env.STEAM_403_FILE = prev403;
    if (prevRate == null) delete process.env.STEAM_RATE_FILE;
    else process.env.STEAM_RATE_FILE = prevRate;
    if (prevPerMin == null) delete process.env.SYNC_RATE_GATE_PER_MIN;
    else process.env.SYNC_RATE_GATE_PER_MIN = prevPerMin;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('白名单与自动封禁接口：增删查、匿名 401', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const add = await fetch(`${base}/api/admin/whitelist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ ip: '198.51.100.9', note: '测试白名单' }),
    });
    assert.equal(add.status, 200);
    const list = await (await fetch(`${base}/api/admin/whitelist`, { headers: { cookie: admin.cookie } })).json();
    assert.ok(list.ips.some((i) => i.ip === '198.51.100.9'));
    assert.ok(list.config && list.config.pageMax > 0 && list.config.apiMax > 0, '应带回当前限流配置（页面/API 分桶）');

    const del = await fetch(`${base}/api/admin/whitelist/198.51.100.9`, { method: 'DELETE', headers: { cookie: admin.cookie } });
    assert.equal(del.status, 200);
    const after = await (await fetch(`${base}/api/admin/whitelist`, { headers: { cookie: admin.cookie } })).json();
    assert.ok(!after.ips.some((i) => i.ip === '198.51.100.9'));

    const abuse = await (await fetch(`${base}/api/admin/abuse`, { headers: { cookie: admin.cookie } })).json();
    assert.ok(Array.isArray(abuse.abuse));

    assert.equal((await fetch(`${base}/api/admin/whitelist`)).status, 401);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('频率限制：同一公网 IP 超频返回 429，白名单可豁免', async () => {
  const oldMax = process.env.RATE_LIMIT_API_MAX;
  const oldWin = process.env.RATE_LIMIT_WINDOW_SEC;
  process.env.RATE_LIMIT_API_MAX = '5';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
  const { store, q, srv, base } = await setup();
  try {
    // 直接把该 IP 写进白名单：应当完全不受限
    await q("insert into ip_whitelist (ip, note) values ('203.0.113.201', 'test')");
    await (await fetch(`${base}/api/games/count`, { headers: { 'x-forwarded-for': '203.0.113.201' } })).text();
    // 重新让服务端加载白名单：通过管理接口增删会同步内存，这里用删掉再测的方式
    const admin = await login(base, 'admin', 'admin123456');
    await fetch(`${base}/api/admin/whitelist/203.0.113.201`, { method: 'DELETE', headers: { cookie: admin.cookie } });

    let statuses = [];
    for (let i = 0; i < 10; i += 1) {
      const r = await fetch(`${base}/api/games/count`, { headers: { 'x-forwarded-for': '203.0.113.202' } });
      statuses.push(r.status);
    }
    assert.ok(statuses.includes(429), '超频后应出现 429，实际：' + statuses.join(','));

    // 白名单 IP 不计数
    const wl = await fetch(`${base}/api/admin/whitelist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ ip: '203.0.113.203' }),
    });
    assert.equal(wl.status, 200);
    let wan = [];
    for (let i = 0; i < 10; i += 1) {
      const r = await fetch(`${base}/api/games/count`, { headers: { 'x-forwarded-for': '203.0.113.203' } });
      wan.push(r.status);
    }
    assert.ok(!wan.includes(429), '白名单不应被限流');
  } finally {
    if (oldMax === undefined) delete process.env.RATE_LIMIT_API_MAX;
    else process.env.RATE_LIMIT_API_MAX = oldMax;
    if (oldWin === undefined) delete process.env.RATE_LIMIT_WINDOW_SEC;
    else process.env.RATE_LIMIT_WINDOW_SEC = oldWin;
    await srv.close();
    await store.close();
  }
});

test('登录验证码：可获取 SVG，开启后缺验证码的登录被拦截', async () => {
  const { store, q, srv, base } = await setup();
  try {
    // 获取验证码：返回 token 与 SVG，且 token 落库
    const cap = await (await fetch(`${base}/api/captcha`)).json();
    assert.ok(cap.token, '应有 token');
    assert.match(String(cap.svg), /<svg/);
    assert.ok(cap.expiresInSec > 0);
    const rows = (await q('select count(*)::int as n from login_challenges')).rows[0].n;
    assert.ok(rows >= 1, '验证码应落库');

    // 开启验证码后，不带验证码的登录必须 400 且不消耗密码尝试
    process.env.CAPTCHA_ENABLED = '1';
    const noCap = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    assert.equal(noCap.status, 400);
    assert.match((await noCap.json()).error, /验证码/);

    // 错误验证码也不放行
    const badCap = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456', captchaToken: cap.token, captchaAnswer: 'ZZZZ' }),
    });
    assert.equal(badCap.status, 400);
  } finally {
    process.env.CAPTCHA_ENABLED = '0';
    await srv.close();
    await store.close();
  }
});

test('密码哈希：加盐、可校验、不存明文', async () => {
  const a = db.hashPassword('secret123');
  const b = db.hashPassword('secret123');
  assert.notEqual(a, b, '同一密码两次哈希必须不同（随机盐）');
  assert.ok(!a.includes('secret123'));
  assert.equal(db.verifyPassword('secret123', a), true);
  assert.equal(db.verifyPassword('secret124', a), false);
  assert.equal(db.verifyPassword('secret123', 'garbage'), false);
});

test('逻辑删除：前台与后台默认都排除，回收站可见并可恢复；平台列随列表下发', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');

    // 平台列：有 Steam 报价的游戏应带 platform_codes / platform_names
    const list0 = await (await fetch(`${base}/api/admin/games`, { headers: { cookie: admin.cookie } })).json();
    const row0 = list0.games.find((g) => g.steam_appid === 413150);
    assert.deepEqual(row0.platform_codes, ['steam']);
    assert.deepEqual(row0.platform_names, ['Steam 国区']);

    // 逻辑删除
    const del = await fetch(`${base}/api/games/413150/deleted`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ deleted: true }),
    });
    assert.equal(del.status, 200);
    assert.equal((await q('select deleted from games where steam_appid = 413150')).rows[0].deleted, true);
    assert.equal((await q('select count(*)::int as n from offers o join games g on g.id = o.game_id where g.steam_appid = 413150')).rows[0].n, 1, '报价数据不能被真删');

    // 前台列表排除
    const pub = await (await fetch(`${base}/api/games`)).json();
    assert.ok(!pub.games.some((g) => g.steam_appid === 413150), '前台不该再展示已删除游戏');

    // 后台默认列表排除，回收站可取到
    const list1 = await (await fetch(`${base}/api/admin/games`, { headers: { cookie: admin.cookie } })).json();
    assert.ok(!list1.games.some((g) => g.steam_appid === 413150), '后台默认列表也要排除');
    const only = await (await fetch(`${base}/api/admin/games?deleted=only`, { headers: { cookie: admin.cookie } })).json();
    assert.ok(only.games.some((g) => g.steam_appid === 413150), 'deleted=only 能查到');
    const bin = await (await fetch(`${base}/api/admin/games/deleted`, { headers: { cookie: admin.cookie } })).json();
    assert.ok(bin.games.some((g) => g.steam_appid === 413150), '回收站接口能查到');

    // 恢复
    const restore = await fetch(`${base}/api/games/413150/deleted`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ deleted: false }),
    });
    assert.equal(restore.status, 200);
    assert.equal((await q('select deleted, deleted_at from games where steam_appid = 413150')).rows[0].deleted, false);
    assert.equal((await q('select deleted_at from games where steam_appid = 413150')).rows[0].deleted_at, null, '恢复后清空删除时间');
    const pub2 = await (await fetch(`${base}/api/games`)).json();
    assert.ok(pub2.games.some((g) => g.steam_appid === 413150), '恢复后前台恢复展示');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('已拥有标记：匿名 401、普通用户 403、管理员可改', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const anon = await fetch(base + '/api/games/413150/owned', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owned: true }),
    });
    assert.equal(anon.status, 401);

    const alice = await login(base, 'alice', 'alice123456');
    const forbidden = await fetch(base + '/api/games/413150/owned', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: alice.cookie }, body: JSON.stringify({ owned: true }),
    });
    assert.equal(forbidden.status, 403);

    const admin = await login(base, 'admin', 'admin123456');
    const ok = await fetch(base + '/api/games/413150/owned', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: admin.cookie }, body: JSON.stringify({ owned: true }),
    });
    assert.equal(ok.status, 200);
    const row = (await q('select owned from games where steam_appid = 413150')).rows[0];
    assert.equal(row.owned, true, '标记要落库');
  } finally {
    await srv.close();
    await store.close();
  }
});

// ── CA-1（docs/APP-NATIVE.md §3）：App Token 认证 + /api/app/* 命名空间 ──────────────

const tokenLogin = async (base, body) => {
  // App 实际只调 /api/app/*（前缀重写），token 签发走 App 路径
  const res = await fetch(`${base}/api/app/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('CA-1 Token 生命周期：签发（7/30 天）、Bearer 访问、撤销、过期、禁用后一律 401', async () => {
  const { store, q, srv, base } = await setup();
  try {
    // 签发：默认 7 天、rememberMe 30 天
    const issued = await tokenLogin(base, { username: 'alice', password: 'alice123456', deviceName: 'Pixel 9' });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.ok(issued.body.token, '响应必须含明文 token（唯一一次）');
    assert.ok(issued.body.expiresAt);
    assert.equal(issued.body.user.username, 'alice');
    const seven = new Date(issued.body.expiresAt).getTime() - Date.now();
    assert.ok(seven < 8 * 86400_000 && seven > 6 * 86400_000, '默认 7 天');

    const remember = await tokenLogin(base, { username: 'alice', password: 'alice123456', rememberMe: true });
    const thirty = new Date(remember.body.expiresAt).getTime() - Date.now();
    assert.ok(thirty < 31 * 86400_000 && thirty > 29 * 86400_000, 'rememberMe 30 天');

    // 库中只有哈希，没有明文
    const hashRow = (await q("select token_hash from api_tokens where token_hash = $1", [db.apiTokenHash(issued.body.token)])).rows[0];
    assert.ok(hashRow, '库中应能按 sha256(token) 找到行');
    const plainRow = (await q('select token_hash from api_tokens where token_hash = $1', [issued.body.token])).rows;
    assert.equal(plainRow.length, 0, '明文绝不能直接落库');

    // Bearer 访问用户接口与 /api/me
    const auth = { authorization: `Bearer ${issued.body.token}` };
    const me = await (await fetch(`${base}/api/me`, { headers: auth })).json();
    assert.equal(me.user.username, 'alice', '/api/me 支持 Bearer');
    const prefs = await fetch(`${base}/api/prefs`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ sort: 'price' }),
    });
    assert.equal(prefs.status, 200, 'Bearer 可调用用户接口');

    // 撤销后立即失效
    const revoke = await fetch(`${base}/api/auth/token/revoke`, { method: 'POST', headers: auth });
    assert.equal(revoke.status, 200);
    const afterRevoke = await fetch(`${base}/api/prefs`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ sort: 'name' }),
    });
    assert.equal(afterRevoke.status, 401, '撤销后必须 401');
    assert.equal((await afterRevoke.json()).error, 'login_required');

    // 过期：直接把过期时间拨回过去
    await q("update api_tokens set expires_at = now() - interval '1 hour' where token_hash = $1", [db.apiTokenHash(remember.body.token)]);
    const expired = await fetch(`${base}/api/prefs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${remember.body.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(expired.status, 401, '过期 token 必须 401');
    assert.equal((await expired.json()).error, 'login_required');

    // 用户被禁用后 token 立即失效
    const bob = await db.createUser(q, { username: 'bobca', password: 'bob1234567' });
    const bobToken = await tokenLogin(base, { username: 'bobca', password: 'bob1234567' });
    assert.equal(bobToken.status, 200);
    await q('update users set disabled = true where id = $1', [bob.id]);
    const disabled = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${bobToken.body.token}` } });
    assert.equal((await disabled.json()).user, null, '禁用用户 token 视为未登录');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('CA-1 Token 登录：验证码必填、错密码与 Web 共用账号锁定', async () => {
  const { store, srv, base } = await setup();
  try {
    process.env.CAPTCHA_ENABLED = '1';
    // 缺验证码 400 且不消耗密码尝试
    const noCap = await tokenLogin(base, { username: 'alice', password: 'alice123456' });
    assert.equal(noCap.status, 400);
    assert.match(noCap.body.error, /验证码/);
    // 错误验证码 400（密码校验在其后，不消耗尝试次数）
    const cap = await (await fetch(`${base}/api/captcha`)).json();
    const badCap = await tokenLogin(base, { username: 'alice', password: 'alice123456', captchaToken: cap.token, captchaAnswer: 'ZZZZ' });
    assert.equal(badCap.status, 400);

    // 关验证码后验证「错密码与 Web 登录共用同一账号锁定」：5 次失败锁 15 分钟
    process.env.CAPTCHA_ENABLED = '0';
    for (let i = 0; i < 5; i += 1) {
      const fail = await tokenLogin(base, { username: 'alice', password: 'wrong-pass' });
      assert.equal(fail.status, 401);
    }
    const locked = await tokenLogin(base, { username: 'alice', password: 'alice123456' });
    assert.equal(locked.status, 429, '5 次失败后即使密码正确也 429（锁 15 分钟）');
    assert.ok(locked.body.lockedUntil, '返回锁定到期时间');
  } finally {
    process.env.CAPTCHA_ENABLED = '0';
    await srv.close();
    await store.close();
  }
});

test('CA-1 /api/app/* 封禁豁免：黑名单 IP 仍可调 App 命名空间，Web /api/* 仍 403', async () => {
  const { store, q, srv, base } = await setup();
  try {
    // 拉黑 127.0.0.1（测试自身出口 IP）并刷新内存黑名单
    await q("insert into ip_blacklist (ip, note) values ('127.0.0.1', 'ca1-test') on conflict (ip) do update set note = excluded.note");
    await visitors.refreshBlocklist(q);

    // App 命名空间豁免：status 与命名空间接口都能 200
    const status = await (await fetch(`${base}/api/app/status`)).json();
    assert.deepEqual(status, { banned: true, type: 'ip', until: null }, 'status 应报告 ip 封禁（且自身不被拦）');
    const latest = await fetch(`${base}/api/app/latest`);
    assert.equal(latest.status, 200, '/api/app/latest 豁免封禁');

    // 前缀重写：App 路径等价于 Web 路径（黑名单下 App 仍可调公开接口）
    const gamesViaApp = await fetch(`${base}/api/app/games`);
    assert.equal(gamesViaApp.status, 200, '/api/app/games 在黑名单下仍可调（前缀重写 + 豁免）');
    const gBody = await gamesViaApp.json();
    assert.ok(gBody.games.length >= 1, '重写后返回游戏列表');
    const captchaViaApp = await fetch(`${base}/api/app/captcha`);
    assert.equal(captchaViaApp.status, 200, '/api/app/captcha 应重写为 /api/captcha');

    // Web /api/* 不变：仍被黑名单 403
    const me = await fetch(`${base}/api/me`);
    assert.equal(me.status, 403, 'Web /api/me 在黑名单下仍 403');

    // 解封后恢复
    await q("delete from ip_blacklist where ip = '127.0.0.1'");
    await visitors.refreshBlocklist(q);
    const cleared = await (await fetch(`${base}/api/app/status`)).json();
    assert.equal(cleared.banned, false);
  } finally {
    await q("delete from ip_blacklist where ip = '127.0.0.1'").catch(() => {});
    await visitors.refreshBlocklist(q).catch(() => {});
    await srv.close();
    await store.close();
  }
});

test('CA-1 用户接口 401 语义：匿名=需要登录（Web 不变），坏 Bearer=login_required', async () => {
  const { store, srv, base } = await setup();
  try {
    const anon = await fetch(`${base}/api/prefs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(anon.status, 401);
    assert.equal((await anon.json()).error, '需要登录', 'Web 匿名文案不变');

    const badBearer = await fetch(`${base}/api/prefs`, {
      method: 'POST',
      headers: { authorization: 'Bearer not-a-real-token-12345678', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(badBearer.status, 401);
    assert.equal((await badBearer.json()).error, 'login_required', 'App 语义统一 login_required');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('CD 对齐审核：去重组队列、确认写映射、忽略与决定继承、处理后不再排队', async () => {
  const { store, q, srv, base } = await setup();
  const tmpFile = join(tmpdir(), `align-${Date.now()}.json`);
  try {
    writeFileSync(tmpFile, JSON.stringify([
      { skuId: 5001, appid: null, name: '内核之心' },
      { skuId: 5002, appid: null, name: '内核之心' },
      { skuId: 5003, appid: null, name: '愚者不灭' },
    ], null, 2));
    process.env.ALIGN_SKU_FILE = tmpFile;
    const cookie = (await login(base, 'admin', 'admin123456')).cookie;
    // CS 批：冷缓存返回 202 {generating}，轮询直到 200 返回 groups；首请求硬锁 202 契约
    let firstAlignStatus = 0;
    const getQueue = async () => {
      for (let i = 0; i < 40; i += 1) {
        const res = await fetch(`${base}/api/admin/align`, { headers: { cookie } });
        const body = await res.json();
        if (i === 0) firstAlignStatus = res.status;
        if (res.status === 200) return body.groups;
        assert.equal(res.status, 202, `冷缓存应返回 202 generating，实际 ${res.status}`);
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error('对齐审核后台生成超时（40 轮未就绪）');
    };

    const first = await getQueue();
    assert.equal(firstAlignStatus, 202, 'CS 契约：冷缓存首次响应 202（后台生成模型）');
    const kernel = first.find((g) => g.name === '内核之心');
    assert.ok(kernel, '内核之心组存在');
    assert.equal(kernel.skuCount, 2, '同归一化名多 SKU 归一组、只出一行');
    assert.ok(first.length === 2, '队列按组计数（2 组）');

    // 手动确认到目标（appid=413150）
    const confirm = await fetch(`${base}/api/admin/align/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ key: kernel.key, appid: 413150, method: 'manual' }),
    });
    assert.equal(confirm.status, 200, JSON.stringify(await confirm.json()));
    // A3 批（docs/DESIGN-AUDIT.md A3）：确认只写库，skus.json 不再被写（appid 保持 null）
    const written = JSON.parse(readFileSync(tmpFile, 'utf8'));
    assert.equal(written.find((e) => e.skuId === 5001).appid, null, 'skus.json 不再被写回（只读兼容）');
    const mapRow = (await q("select decision from game_source_map where platform_code = 'sonkwo' and product_id = '5001'")).rows[0];
    assert.equal(mapRow.decision, 'confirmed', '映射落库 confirmed（库为唯一真相）');

    const second = await getQueue();
    assert.ok(!second.some((g) => g.key === kernel.key), '已确认组不再排队（决定继承）');

    // 忽略另一组
    const fool = second.find((g) => g.name === '愚者不灭');
    assert.ok(fool);
    const ignore = await fetch(`${base}/api/admin/align/ignore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ key: fool.key }),
    });
    assert.equal(ignore.status, 200);
    const third = await getQueue();
    assert.ok(!third.some((g) => g.key === fool.key), '已忽略组不再排队');

    // 收敛：连续两次队列组数不增长
    assert.equal(third.length, 0, '全部处理后队列为空');
  } finally {
    delete process.env.ALIGN_SKU_FILE;
    await srv.close();
    await store.close();
  }
});

test('DH 对齐数据完整性：skus.json 带 appid 自动补写不入队；已忽略可列/恢复；审阅记录含操作人', async () => {
  const { store, q, srv, base } = await setup();
  const tmpFile = join(tmpdir(), `align-dh-${Date.now()}.json`);
  try {
    // 6001 断箭类：skus.json 已带 appid、库无映射；6002/6003 普通待处理 SKU
    writeFileSync(tmpFile, JSON.stringify([
      { skuId: 6001, appid: 413150, name: '断箭' },
      { skuId: 6002, appid: null, name: '愚者不灭' },
      { skuId: 6003, appid: null, name: '内核之心' },
    ], null, 2));
    process.env.ALIGN_SKU_FILE = tmpFile;
    const cookie = (await login(base, 'admin', 'admin123456')).cookie;
    await q("insert into games (steam_appid, name) values (413150, '断箭') on conflict do nothing");
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // DL 批：读库快照——无快照首次 202 firstRun；恢复后快照标脏、后台重算，需等「该组重新入队」
    const getQueue = async (pred = null) => {
      for (let i = 0; i < 80; i += 1) {
        const res = await fetch(`${base}/api/admin/align`, { headers: { cookie } });
        const body = await res.json();
        if (res.status === 202) { assert.equal(body.firstRun, true, '无快照应 202 firstRun'); await sleep(150); continue; }
        assert.equal(res.status, 200);
        if (!pred || pred(body.groups)) return body.groups;
        await sleep(150);
      }
      throw new Error('对齐审核快照超时（80 轮未就绪）');
    };

    // A1：断箭组（skus.json 已带 appid）不再入队，且库无映射被自动补写为 confirmed
    const first = await getQueue();
    assert.ok(!first.some((g) => g.name === '断箭'), 'skus.json 已带 appid 的组不再入队（断箭场景）');
    const back = (await q("select decision, match_method, game_id from game_source_map where platform_code = 'sonkwo' and product_id = '6001'")).rows[0];
    assert.ok(back, '库无映射时自动补写');
    assert.equal(back.decision, 'confirmed', '补写为 confirmed');
    assert.equal(back.match_method, 'skus_backfill', '补写方式 skus_backfill');
    assert.ok(Number.isFinite(Number(back.game_id)), '补写指向 games.id');

    // C1 补（质检打回项）：确认「内核之心」→ 审阅记录可查 confirmed 动作 + 操作人
    const kernel = first.find((g) => g.name === '内核之心');
    assert.ok(kernel, '内核之心在队列');
    const confirmKernel = await fetch(`${base}/api/admin/align/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ key: kernel.key, appid: 413150, method: 'manual' }),
    });
    assert.equal(confirmKernel.status, 200, JSON.stringify(await confirmKernel.json()));
    const kernelHist = await (await fetch(`${base}/api/admin/align/history?key=${encodeURIComponent(kernel.key)}`, { headers: { cookie } })).json();
    const confirmedRecord = kernelHist.records.find((r) => r.decision === 'confirmed');
    assert.ok(confirmedRecord, '确认后审阅记录可查 confirmed 动作');
    assert.equal(confirmedRecord.username, 'admin', '确认记录带操作人');
    assert.ok(confirmedRecord.reviewed_at, '确认记录带时间');

    // B1：忽略「愚者不灭」→ 出现在已忽略视图（组名/SKU/操作人/时间）；恢复后重新入队
    const fool = first.find((g) => g.name === '愚者不灭');
    assert.ok(fool, '愚者不灭在队列');
    const ignore = await fetch(`${base}/api/admin/align/ignore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ key: fool.key }),
    });
    assert.equal(ignore.status, 200);
    const ignoredRes = await fetch(`${base}/api/admin/align/ignored`, { headers: { cookie } });
    assert.equal(ignoredRes.status, 200);
    const ignoredBody = await ignoredRes.json();
    const ignoredRow = ignoredBody.groups.find((g) => g.key === fool.key);
    assert.ok(ignoredRow, '已忽略视图包含该组');
    assert.ok(ignoredRow.skus.includes('6002'), '返回组内 SKU');
    assert.equal(ignoredRow.ignoredBy, 'admin', '返回操作人');
    assert.ok(ignoredRow.ignoredAt, '返回忽略时间');

    const restore = await fetch(`${base}/api/admin/align/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ key: fool.key }),
    });
    assert.equal(restore.status, 200, JSON.stringify(await restore.json()));
    // DL 批：恢复 → 快照标脏 + 后台重算（不阻塞读）——等到重算完成、该组重新入队
    const after = await getQueue((gs) => gs.some((g) => g.key === fool.key));
    assert.ok(after.some((g) => g.key === fool.key), '恢复后该组重新回到待处理队列');
    const restoredRow = (await q("select decision, game_id, reviewed_by from game_source_map where platform_code = 'sonkwo' and product_id = '6002'")).rows[0];
    assert.equal(restoredRow.decision, 'pending', '恢复后映射行变 pending');
    assert.equal(restoredRow.game_id, null, '恢复后清空 game_id');
    assert.ok(restoredRow.reviewed_by != null, '恢复操作人落库');

    // C1：审阅记录——恢复动作可查（操作人 + 时间 + 动作）
    const histRes = await fetch(`${base}/api/admin/align/history?key=${encodeURIComponent(fool.key)}`, { headers: { cookie } });
    assert.equal(histRes.status, 200);
    const hist = await histRes.json();
    const pendingRecord = hist.records.find((r) => r.decision === 'pending');
    assert.ok(pendingRecord, '审阅记录含恢复（pending）动作');
    assert.equal(pendingRecord.username, 'admin', '审阅记录含操作人');

    // 已忽略视图在恢复后不再包含该组
    const ignoredAfter = await (await fetch(`${base}/api/admin/align/ignored`, { headers: { cookie } })).json();
    assert.ok(!ignoredAfter.groups.some((g) => g.key === fool.key), '恢复后不再出现在已忽略视图');
  } finally {
    delete process.env.ALIGN_SKU_FILE;
    await srv.close();
    await store.close();
  }
});

test('DN 内容词 SKU 默认归档：不进队列不占计数；本体同键保留；已忽略可查看/恢复；恢复后重算不重复归档', async () => {
  const { store, q, srv, base } = await setup();
  const tmpFile = join(tmpdir(), `align-dn-${Date.now()}.json`);
  try {
    // 7001 季票、7002 服装（与本体同归一化键）、7003 本体、7004 普通 SKU
    writeFileSync(tmpFile, JSON.stringify([
      { skuId: 7001, appid: null, name: '巴士模拟器 27 - 第1年季票' },
      { skuId: 7002, appid: null, name: '龙之剑:觉醒 - 服装' },
      { skuId: 7003, appid: null, name: '龙之剑:觉醒' },
      { skuId: 7004, appid: null, name: '内核之心' },
    ], null, 2));
    process.env.ALIGN_SKU_FILE = tmpFile;
    const cookie = (await login(base, 'admin', 'admin123456')).cookie;
    await q("insert into games (steam_appid, name) values (413150, '断箭') on conflict do nothing");
    const getQueue = async ({ refresh = false } = {}) => {
      // DL 批：读库快照——无快照首次 202 firstRun；refresh=1 立即返回当前快照 + refreshing，
      // 后台重算完成以 generatedAt 变化为信号（refresh 只在第一轮带，后续轮询不带）。
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let firstAt = null;
      for (let i = 0; i < 80; i += 1) {
        const res = await fetch(`${base}/api/admin/align?page=1&pageSize=50${refresh && i === 0 ? '&refresh=1' : ''}`, { headers: { cookie } });
        const body = await res.json();
        if (res.status === 202) { assert.equal(body.firstRun, true, '无快照应 202 firstRun'); await sleep(150); continue; }
        assert.equal(res.status, 200);
        if (!refresh) return body;
        if (firstAt == null) { firstAt = body.generatedAt; await sleep(150); continue; } // 触发重算的旧快照
        if (body.generatedAt !== firstAt) return body; // 重算完成
        await sleep(150);
      }
      throw new Error('对齐审核快照超时（80 轮未就绪）');
    };

    // 验收①：内容词 SKU 不进队列、不占「待对齐组」计数；验收②：本体（同键）与普通 SKU 不受影响
    const first = await getQueue();
    assert.ok(!first.groups.some((g) => g.name.includes('季票')), '季票组不进待对齐队列');
    assert.ok(!first.groups.some((g) => g.name.includes('服装')), '服装组不进待对齐队列');
    const baseGame = first.groups.find((g) => g.name === '龙之剑:觉醒');
    assert.ok(baseGame, '本体组（与服装 SKU 同键）仍在队列');
    assert.deepEqual(baseGame.skuIds, [7003], '本体组只剩本体 SKU');
    assert.ok(first.groups.some((g) => g.name === '内核之心'), '普通 SKU 正常入队');
    assert.equal(first.counts.groups, 2, '待对齐组只算本体 + 普通 SKU（内容词不占计数）');
    assert.equal(first.counts.contentWords, 2, '内容词自动归档 2 组（季票、服装）');
    assert.equal(first.counts.contentWordSkus, 2, '内容词自动归档 2 个 SKU');

    // 归档落库：ignored + method=content_word + 无操作人（已忽略视图可查看/恢复的前提）
    const row = (await q("select decision, match_method, reviewed_by from game_source_map where platform_code = 'sonkwo' and product_id = '7001'")).rows[0];
    assert.ok(row, '内容词 SKU 自动写归档映射');
    assert.equal(row.decision, 'ignored', '归档为 ignored（与人工忽略同视图）');
    assert.equal(row.match_method, 'content_word', '归档方式 content_word');
    assert.equal(row.reviewed_by, null, '自动归档无操作人');

    // 计数跨轮稳定：强制重算后仍计 2 组（已归档不再重复写库、也不重复排队）
    const second = await getQueue({ refresh: true });
    assert.equal(second.counts.contentWords, 2, '重算后内容词归档计数稳定');
    assert.ok(!second.groups.some((g) => g.name.includes('季票')), '重算后季票组仍不进队列');

    // 验收③：已忽略视图可查看（标注「内容词自动归档」）
    const seasonKey = alignGroupKey('sonkwo', '巴士模拟器 27 - 第1年季票');
    const ignoredBody = await (await fetch(`${base}/api/admin/align/ignored`, { headers: { cookie } })).json();
    const cwRow = ignoredBody.groups.find((g) => g.key === seasonKey);
    assert.ok(cwRow, '已忽略视图包含内容词归档组');
    assert.deepEqual(cwRow.skus, ['7001'], '归档组带 SKU 明细');
    assert.equal(cwRow.method, 'content_word', '已忽略视图标注「内容词自动归档」');
    assert.equal(cwRow.ignoredBy, null, '自动归档组操作人为空（页面显示「系统」）');

    // 恢复（DH 能力）：pending 人工决定优先 → 重新入队；再重算仍不重复归档
    const restore = await fetch(`${base}/api/admin/align/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ key: seasonKey }),
    });
    assert.equal(restore.status, 200, JSON.stringify(await restore.json()));
    // DL 批：恢复 → 快照标脏 + 后台重算（不阻塞读）——等到该组重新入队
    const after = await (async () => {
      for (let i = 0; i < 80; i += 1) {
        const res = await fetch(`${base}/api/admin/align?page=1&pageSize=50`, { headers: { cookie } });
        const body = await res.json();
        if (res.status === 200 && body.groups.some((g) => g.name.includes('季票'))) return body;
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error('等待恢复组重新入队超时');
    })();
    assert.ok(after.groups.some((g) => g.name.includes('季票')), '恢复后内容词组重新回到待对齐队列');
    assert.equal(after.counts.contentWords, 1, '恢复后该组不再计入自动归档（只剩服装组）');
    const refreshed = await getQueue({ refresh: true });
    assert.ok(refreshed.groups.some((g) => g.name.includes('季票')), '重算后恢复的组仍留在队列（pending 优先、不重复归档）');
    assert.equal(refreshed.counts.contentWords, 1, '重算后自动归档计数不再包含已恢复组');
  } finally {
    delete process.env.ALIGN_SKU_FILE;
    await srv.close();
    await store.close();
  }
});

test('DL 快照落库：确认 3 组后立即读立刻消失、counts 递减、无生成中；refresh=1 不阻塞；prune 保留 5 条', async () => {
  const { store, q, srv, base } = await setup();
  const tmpFile = join(tmpdir(), `align-dl-${Date.now()}.json`);
  try {
    writeFileSync(tmpFile, JSON.stringify([
      { skuId: 8101, appid: null, name: '内核之心' },
      { skuId: 8102, appid: null, name: '愚者不灭' },
      { skuId: 8103, appid: null, name: '忙作一团' },
      { skuId: 8104, appid: null, name: '血色序曲' },
    ], null, 2));
    process.env.ALIGN_SKU_FILE = tmpFile;
    const cookie = (await login(base, 'admin', 'admin123456')).cookie;
    for (const [name, appid] of [['内核之心', 9101], ['愚者不灭', 9102], ['忙作一团', 9103], ['血色序曲', 9104]]) {
      await q('insert into games (steam_appid, name) values ($1, $2) on conflict do nothing', [appid, name]);
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const get = async ({ refresh = false } = {}) => {
      for (let i = 0; i < 80; i += 1) {
        const res = await fetch(`${base}/api/admin/align?page=1&pageSize=50${refresh && i === 0 ? '&refresh=1' : ''}`, { headers: { cookie } });
        const body = await res.json();
        if (res.status === 202) { assert.equal(body.firstRun, true, '无快照首次 202 firstRun'); await sleep(150); continue; }
        assert.equal(res.status, 200);
        return body;
      }
      throw new Error('快照超时');
    };
    const waitRegen = async (from) => {
      let at = from;
      for (let i = 0; i < 80 && at === from; i += 1) {
        await sleep(150);
        at = (await get()).generatedAt;
      }
      return at;
    };

    const first = await get();
    assert.ok(first.generatedAt, '快照带 generatedAt');
    assert.equal(first.cached, true, '读快照 cached:true（规格 §8.3）');
    assert.equal(first.groups.length, 4, '4 组入队');
    assert.equal(first.counts.groups, 4);

    // 签名不变：再读一次 → 同一 generatedAt、无重算（规格 §8.3）
    const again = await get();
    assert.equal(again.generatedAt, first.generatedAt, '签名不变 → 直接库快照，无重算');

    // 批量确认 3 组
    const keys = first.groups.slice(0, 3).map((g) => g.key);
    const conf = await fetch(`${base}/api/admin/align/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ keys }),
    });
    assert.equal(conf.status, 200, JSON.stringify(await conf.json()));

    // 立即读（第一次 GET 即断言，不轮询）：3 组立刻消失、counts 递减、无 202/生成中（规格 §8.2）
    // 反向自检：服务端若去掉「同事务更新快照」，此刻后台重算未完成、快照仍含 3 组 → 本条必红
    const rightAfter = await get();
    assert.equal(rightAfter.groups.length, 1, '确认 3 组后立即读 → 这 3 组立刻消失（同事务更新快照）');
    assert.equal(rightAfter.groups[0].name, '血色序曲', '未处理的组保留');
    assert.equal(rightAfter.counts.groups, 1, 'counts.groups 递减');
    assert.equal(rightAfter.counts.skus, 1, 'counts.skus 递减');
    assert.equal(rightAfter.counts.auto, 1, 'counts.auto 随移除组递减');

    // refresh=1：立即 200（不阻塞、不 202）+ refreshing 标记；返回的是当前队列（规格 §5）
    const refreshRes = await fetch(`${base}/api/admin/align?page=1&pageSize=50&refresh=1`, { headers: { cookie } });
    assert.equal(refreshRes.status, 200, 'refresh=1 返回当前快照，不阻塞、不 202');
    const refreshBody = await refreshRes.json();
    assert.equal(refreshBody.refreshing, true, 'refreshing:true');
    assert.equal(refreshBody.groups.length, 1, '重算未完成前返回当前队列');
    const afterAt = await waitRegen(refreshBody.generatedAt);
    assert.notEqual(afterAt, refreshBody.generatedAt, '后台重算完成（generatedAt 变化）');

    // prune：塞 6 条更旧的快照行（generated_at 倒填，不干扰「最新」判定）→ 触发 refresh 重算 → 完成后 ≤5 条（规格 §8.8）
    for (let i = 0; i < 6; i += 1) {
      await q(`insert into align_snapshots (payload, counts, signature, generated_at) values ('{}'::jsonb, '{}'::jsonb, 'junk${i}', now() - interval '10 minutes')`);
    }
    const pre = (await q('select count(*)::int as n from align_snapshots')).rows[0].n;
    assert.ok(pre > 5, `前置：塞旧行后超 5 条（${pre}）`);
    const refresh2 = await fetch(`${base}/api/admin/align?page=1&pageSize=50&refresh=1`, { headers: { cookie } });
    assert.equal(refresh2.status, 200);
    const before2 = (await refresh2.json()).generatedAt;
    await waitRegen(before2);
    const n = (await q('select count(*)::int as n from align_snapshots')).rows[0].n;
    assert.ok(n <= 5, `prune 保留最近 5 条（当前 ${n}）`);
  } finally {
    delete process.env.ALIGN_SKU_FILE;
    await srv.close();
    await store.close();
  }
});

test('A3 读路径：库映射（confirmed）唯一真相、pending/ignored 不参与；skus.json 只读回落', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const align = await import('../src/align.js');
    await q("insert into games (steam_appid, name) values (413150, '断箭') on conflict do nothing");
    const gid = (await q("select id from games where steam_appid = 413150")).rows[0].id;
    await q(
      `insert into game_source_map (platform_code, product_id, game_id, decision)
       values ('sonkwo','7001',$1,'confirmed'),('sonkwo','7002',$1,'pending'),('sonkwo','7003',null,'ignored')
       on conflict (platform_code, product_id) do update set game_id = excluded.game_id, decision = excluded.decision`,
      [gid],
    );
    const map = await align.loadConfirmedAppids({ q, productIds: ['7001', '7002', '7003', '7004'] });
    assert.equal(map.size, 1, '只有 confirmed 进解析表（pending/ignored 不参与）');
    assert.equal(map.get('7001'), 413150, 'confirmed 映射解析出 steam_appid');
    // resolveSkuAppid 口径：库优先、文件回落、都无 null（sync marks 与报价共用）
    assert.equal(align.resolveSkuAppid(map, { skuId: 7001, appid: 999 }), 413150, '库映射优先于 skus.json appid');
    assert.equal(align.resolveSkuAppid(map, { skuId: 7004, appid: 888 }), 888, '库无映射回落 skus.json appid（旧数据兼容）');
    assert.equal(align.resolveSkuAppid(map, { skuId: 7004, appid: null }), null, '两边都没有 → null');
    // 空清单安全（sync 无 SKU 时不炸）
    assert.equal((await align.loadConfirmedAppids({ q, productIds: [] })).size, 0);
  } finally {
    await srv.close();
    await store.close();
  }
});

// ---------------------------------------------------------------- B1 批（docs/DESIGN-AUDIT.md B1）
// 统一请求超时（默认 15s，测试注入 80ms）+ 重型接口并发闸：
// ① 慢查询超过阈值 → 503 + 日志 http.request_timeout；
// ② /api/games 闸内峰值并发 ≤2，打满期间 /api/site 快速返回（其它接口 P95 不受影响）；
// ③ 队列满（注入 maxQueue=0）→ 503 接口繁忙。

test('B1：慢查询超时 → 503 + http.request_timeout 日志', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const events = [];
  const logger = { info: (e) => events.push(e), warn: (e) => events.push(e), error: () => {} };
  const slowQ = async (sql, p) => {
    if (/from games|from offers/i.test(sql)) await new Promise((r) => setTimeout(r, 500));
    return q(sql, p);
  };
  const srv = await startApiServer({ query: slowQ, logger, requestTimeoutMs: 80, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const res = await fetch(`${base}/api/games/stamp`);
    assert.equal(res.status, 503, '慢查询超过阈值 → 503');
    const body = await res.json();
    assert.match(body.error, /请求超时/, '503 文案可读');
    assert.ok(events.includes('http.request_timeout'), '日志 http.request_timeout 可观测');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('B1：/api/games 并发闸 ≤2，打满期间 /api/site 不受影响', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ingestOffers(store, {
    platform: { code: 'steam', name: 'Steam 国区', kind: 'official' },
    offers: [{
      platformCode: 'steam', platformProductId: '413150', steamAppid: 413150, title: '星露谷物语',
      productType: 'official_direct', region: 'cn', currency: 'CNY', priceCents: 4800, originalCents: 4800,
      discountPct: 0, inStock: true, buyUrl: 'https://store.steampowered.com/app/413150/', meta: {},
    }],
  });
  const q = (sql, p) => store.query(sql, p);
  let active = 0;
  let peak = 0;
  const gatedQ = async (sql, p) => {
    if (/from games|join game_region_snapshot/i.test(sql)) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 100));
      active -= 1;
    }
    return q(sql, p);
  };
  const srv = await startApiServer({ query: gatedQ, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const results = await Promise.all([0, 1, 2, 3, 4, 5].map(() => fetch(`${base}/api/games?region=cn`)));
    for (const r of results) assert.equal(r.status, 200, '排队请求最终都成功');
    assert.ok(peak <= 2, `闸内峰值并发 ${peak} ≤ 2`);
    // 打满期间其它接口快速返回（闸门排队不阻塞事件循环）
    const t0 = Date.now();
    const site = await fetch(`${base}/api/site`);
    assert.equal(site.status, 200);
    assert.ok(Date.now() - t0 < 1500, '并发打满时 /api/site 仍快速返回');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('B1：闸队列满（maxQueue=0）→ 503 接口繁忙，其余请求照常', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const gatedQ = async (sql, p) => {
    if (/from games|join game_region_snapshot/i.test(sql)) await new Promise((r) => setTimeout(r, 100));
    return q(sql, p);
  };
  const srv = await startApiServer({ query: gatedQ, gateMaxQueue: 0, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const results = await Promise.all([0, 1, 2].map(() => fetch(`${base}/api/games?region=cn`)));
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 200).length, 2, '两个占满执行槽');
    assert.equal(statuses.filter((s) => s === 503).length, 1, '队列已满的第三个 → 503');
  } finally {
    await srv.close();
    await store.close();
  }
});

// ---------------------------------------------------------------- DR 批（docs/APP-INSTANT-UPDATE.md §4）
// POST /api/admin/app-sync：requireAdmin（匿名 401 / 普通用户 403）、管理员 200 且 latest.json 更新、
// 并发两次 single-flight 只跑一轮 GitHub 请求、失败 502 + 明确 reason、审计落库；GET status 供卡片渲染。

const DR_LIST = 'https://api.github.com/repos/yyliucha/steamdeals-app/releases?per_page=10';
const DR_LATEST = 'https://api.github.com/repos/yyliucha/steamdeals-app/releases/latest';

/** 可注入的 GitHub fake fetch：正常/失败两档；记录每次调用 URL；稍作延迟放大并发窗口。 */
function drFetchImpl({ fail = false, delayMs = 80 } = {}) {
  const version = '2.26.1';
  const release = (assets) => ({ tag_name: `app-v${version}`, draft: false, prerelease: false, assets });
  const asset = (name, url) => ({ name, browser_download_url: url });
  const handlers = {
    [DR_LIST]: {
      status: fail ? 500 : 200,
      json: fail ? null : [release([asset('latest.json', 'x-latest'), asset(`steamdeals-${version}.apk`, 'x-apk')])],
    },
    [DR_LATEST]: { status: fail ? 500 : 404, json: null },
    'x-latest': { status: 200, buf: Buffer.from(JSON.stringify({ version, versionCode: 22601, notes: ['DR 批'] })) },
    'x-apk': { status: 200, buf: Buffer.from('apk-bytes') },
  };
  const fn = async (url, opts) => {
    fn.calls.push(url);
    await new Promise((r) => setTimeout(r, delayMs));
    const h = handlers[url];
    if (!h) return { ok: false, status: 404, json: async () => null };
    return { ok: h.status < 400, status: h.status, json: async () => h.json, arrayBuffer: async () => h.buf };
  };
  fn.calls = [];
  return fn;
}

test('DR：立即同步 App 版本——权限 401/403、并发 single-flight、成功更新 latest.json 与卡片一致', async () => {
  const appDir = join(tmpdir(), `dr-appsync-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const prevAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDir; // /api/app/latest 与 app-sync 落盘同目录，断言「卡片与接口一致」
  const events = [];
  const logger = { info: (event, fields) => events.push({ event, fields }), warn: () => {}, error: () => {} };
  const fetchImpl = drFetchImpl();
  const { store, q, srv, base } = await setup({ appSyncFetchImpl: fetchImpl, appSyncDir: appDir, logger });
  const post = (cookie) =>
    fetch(`${base}/api/admin/app-sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: '{}',
    });
  try {
    // 1) 权限：匿名 401 / 普通用户 403
    const anon = await post(null);
    assert.equal(anon.status, 401, '匿名 POST /api/admin/app-sync → 401');
    const alice = await login(base, 'alice', 'alice123456');
    const forbidden = await post(alice.cookie);
    assert.equal(forbidden.status, 403, '普通用户 → 403（requireAdmin）');

    // 2) 管理员并发两次 → single-flight：GitHub 列表只请求一轮，两次都 200
    const admin = await login(base, 'admin', 'admin123456');
    const [r1, r2] = await Promise.all([post(admin.cookie), post(admin.cookie)]);
    assert.equal(r1.status, 200, '第一次 → 200');
    assert.equal(r2.status, 200, '第二次（共享进行中的同步）→ 200');
    const listCalls = fetchImpl.calls.filter((u) => u.includes('/releases?per_page=10'));
    assert.equal(listCalls.length, 1, '并发两次只跑一次 GitHub 列表请求（single-flight）');
    const b1 = await r1.json();
    assert.equal(b1.ok, true);
    assert.equal(b1.version, '2.26.1', '同步到目标版本');
    assert.ok(b1.syncedAt, '返回 syncedAt');

    // 3) latest.json 真实落盘，且 /api/app/latest 返回同一版本（卡片与 App 接口一致）
    const meta = JSON.parse(readFileSync(join(appDir, 'latest.json'), 'utf8'));
    assert.equal(meta.version, '2.26.1', 'data/app/latest.json 已更新为目标版本');
    const appLatest = await (await fetch(`${base}/api/app/latest`)).json();
    assert.equal(appLatest.version, '2.26.1', '/api/app/latest 与刚同步的版本一致');
    assert.equal(appLatest.versionCode, 22601, 'versionCode 一致');

    // 4) 卡片状态接口：版本 / 上次同步时间 / 无失败原因；非管理员 401
    const statusRes = await fetch(`${base}/api/admin/app-sync/status`, { headers: { cookie: admin.cookie } });
    assert.equal(statusRes.status, 200);
    const status = await statusRes.json();
    assert.equal(status.latest.version, '2.26.1', '卡片当前版本');
    assert.ok(status.lastSyncAt, '卡片拿到上次同步时间');
    assert.equal(status.lastError, null, '成功同步后无失败原因');
    assert.equal(status.syncing, false, '同步已结束');
    const statusAnon = await fetch(`${base}/api/admin/app-sync/status`);
    assert.equal(statusAnon.status, 401, '卡片状态接口同样 requireAdmin');

    // 5) 日志 app.sync_manual + 审计 admin.app_sync 落库
    const manualLogs = events.filter((e) => e.event === 'app.sync_manual');
    assert.equal(manualLogs.length, 1, '成功路径记一次 app.sync_manual');
    assert.equal(manualLogs[0].fields.version, '2.26.1');
    assert.equal(manualLogs[0].fields.by, 'admin');
    const audit = await q("select * from audit_logs where action = 'admin.app_sync'");
    assert.ok(audit.rows.length >= 1, '审计 admin.app_sync 落库');
  } finally {
    process.env.APP_DATA_DIR = prevAppDataDir;
    await srv.close();
    await store.close();
  }
});

test('DR：立即同步失败 → 502 + 明确 reason，日志与审计带 reason', async () => {
  const appDir = join(tmpdir(), `dr-appsync-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const events = [];
  const logger = { info: (event, fields) => events.push({ event, fields }), warn: () => {}, error: () => {} };
  const fetchImpl = drFetchImpl({ fail: true });
  const { store, q, srv, base } = await setup({ appSyncFetchImpl: fetchImpl, appSyncDir: appDir, logger });
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const res = await fetch(`${base}/api/admin/app-sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: '{}',
    });
    assert.equal(res.status, 502, '同步失败 → 502');
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'github_http_500', '失败 reason 明确（列表与 latest 兜底都 500）');
    const manualLogs = events.filter((e) => e.event === 'app.sync_manual');
    assert.equal(manualLogs[0].fields.reason, 'github_http_500', '日志 app.sync_manual 带 reason');
    const audit = await q("select * from audit_logs where action = 'admin.app_sync' order by id desc limit 1");
    assert.equal(audit.rows[0].detail.reason, 'github_http_500', '审计 detail 带失败 reason');
  } finally {
    await srv.close();
    await store.close();
  }
});

// ============================================================ FJ 批（docs/SYNC-JOB-GROUPS.md）
// 组级立即运行（POST /api/admin/sync/groups/:name/run）与 steam-claim 手动端点：
// 权限（匿名 401）、未知组 404、未配置 claim 400、无到期子步骤 200 started:false；
// 到期判定纯函数 dueGroupSteps 单独锁（从未跑过视为到期 / 跑过的按 lastRunAt + intervalMin）。

test('FJ：组级立即运行与 steam-claim 端点——权限/错误路径/无到期子步骤', async () => {
  const { store, srv, base } = await setup();
  const anonPost = (p) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  try {
    // 匿名 401
    assert.equal((await anonPost('/api/admin/sync/groups/steam-meta/run')).status, 401, '组级立即运行匿名 401');
    assert.equal((await anonPost('/api/admin/steam-claim')).status, 401, 'steam-claim 匿名 401');

    const admin = await login(base, 'admin', 'admin123456');
    const adminPost = (p) =>
      fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: admin.cookie }, body: '{}' });

    // 未知任务组 404
    const unknown = await adminPost('/api/admin/sync/groups/not-a-group/run');
    assert.equal(unknown.status, 404, '未知任务组 404');
    assert.match((await unknown.json()).error, /未知任务组/);

    // steam-claim 未配置 → 400（测试环境没有 STEAM_CLAIM_USERNAME/STEAM_CLAIM_STEAM_ID）
    const claim = await adminPost('/api/admin/steam-claim');
    assert.equal(claim.status, 400, '未配置 STEAM_CLAIM_* 返回 400');
    assert.match((await claim.json()).error, /STEAM_CLAIM_USERNAME/);

    // 组内全部未到期 → 200 started:false（写临时状态文件：所有子步骤 lastRunAt=now）
    const file = join(tmpdir(), `fj-sched-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    const prevEnv = process.env.SCHEDULER_STATUS_FILE;
    process.env.SCHEDULER_STATUS_FILE = file;
    try {
      const nowIso = new Date().toISOString();
      writeFileSync(
        file,
        JSON.stringify({
          updatedAt: nowIso,
          jobs: [
            { name: 'steam-status', lastRunAt: nowIso },
            { name: 'rating-backfill', lastRunAt: nowIso },
            { name: 'explicit-backfill', lastRunAt: nowIso },
            { name: 'backfill', lastRunAt: nowIso },
            { name: 'rename', lastRunAt: nowIso },
          ],
        }),
      );
      const none = await adminPost('/api/admin/sync/groups/steam-meta/run');
      assert.equal(none.status, 200, '无到期子步骤返回 200');
      const body = await none.json();
      assert.equal(body.started, false);
      assert.match(body.reason, /没有到期/);
      assert.deepEqual(body.skipped, ['steam-status', 'rating-backfill', 'explicit-backfill', 'backfill', 'rename'], '五个未到期子步骤全部跳过');
    } finally {
      if (prevEnv == null) delete process.env.SCHEDULER_STATUS_FILE;
      else process.env.SCHEDULER_STATUS_FILE = prevEnv;
    }
  } finally {
    await srv.close();
    await store.close();
  }
});

test('FJ：dueGroupSteps 到期判定纯函数——从未跑过视为到期，跑过的按 lastRunAt + intervalMin', async () => {
  const { dueGroupSteps } = await import('../src/routes/admin-sync.js');
  const steps = [
    { name: 'steam-status', intervalMin: 1440 },
    { name: 'rating-backfill', intervalMin: 1440 },
  ];
  // 状态文件缺失 → 全部视为到期
  let r = dueGroupSteps(steps, null);
  assert.equal(r.due.length, 2, '无状态文件时全部视为到期（从未跑过）');
  assert.deepEqual(r.skipped, []);

  // 只有部分子步骤有 lastRunAt：刚跑过的不算到期
  const nowMs = Date.now();
  r = dueGroupSteps(steps, {
    jobs: [
      { name: 'steam-status', lastRunAt: new Date(nowMs - 60_000).toISOString() }, // 1 分钟前 → 未到期
      { name: 'rating-backfill', lastRunAt: null }, // 从未跑过 → 到期
    ],
  });
  assert.equal(r.due.length, 1);
  assert.equal(r.due[0].name, 'rating-backfill', '从未跑过的子步骤视为到期');
  assert.deepEqual(r.skipped, ['steam-status'], '刚跑过的不算到期');

  // 过了间隔才到期
  r = dueGroupSteps(steps, {
    jobs: [{ name: 'steam-status', lastRunAt: new Date(nowMs - 1440 * 60_000 - 1000).toISOString() }],
  });
  assert.equal(r.due.length, 2, '过了间隔后到期（另一个从未跑过同样到期）');

  // 非法 lastRunAt 视为没跑过（到期）
  r = dueGroupSteps(steps, { jobs: [{ name: 'steam-status', lastRunAt: 'not-a-date' }] });
  assert.equal(r.due.length, 2, '非法时间视为没跑过');
});
