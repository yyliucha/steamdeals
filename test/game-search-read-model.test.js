// AV 批（docs/READ-MODEL.md §9 验收）：首页列表读模型 game_region_snapshot。
// 锁住的约束：
//   1) 同一数据集下新旧实现（READ_MODEL=legacy vs 读模型）20 组筛选组合的 total 与首页 id 顺序完全一致；
//   2) 写价后快照同轮更新（ingestOffers 路径）；「新史低」日界切换（prev_hist_low 正确滚动）；
//   3) 合并游戏后 from/to 快照正确；禁用/回收站游戏不进列表；
//   4) 抽样对账 0 差异；--fix 与 rebuild 能修复；READ_MODEL=legacy 回滚开关生效。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { ingestOffers } from '../src/ingest.js';
import { ensureSteamSchema } from '../src/steam-login.js';

const steamPlatform = { code: 'steam', name: 'Steam 国区', kind: 'official' };

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureSteamSchema(store); // seedMixed 需要 steam_accounts/steam_games（登录用户 owned 推导）
  const q = (sql, p) => store.query(sql, p);
  return { store, q };
}

// 直接跑（读模型默认开）/ 强制旧 SQL 跑，进程内切换 READ_MODEL
async function searchRm(q, opts) {
  delete process.env.READ_MODEL;
  try {
    return await db.gameSearch(q, opts);
  } finally {
    delete process.env.READ_MODEL;
  }
}
async function searchLegacy(q, opts) {
  process.env.READ_MODEL = 'legacy';
  try {
    return await db.gameSearch(q, opts);
  } finally {
    delete process.env.READ_MODEL;
  }
}

/** 种一套混合数据集：多平台/多区服/c2c/缺货/昨天历史/游戏与 DLC/成人/禁用/回收站 + 登录用户的标记。 */
async function seedMixed({ store, q }) {
  const g = async (appid, fields) => {
    const { name, nameEn = null, appType = null, heat = null, releaseDate = null, adult = false, blocked = false, deleted = false } = fields;
    const r = await q(
      'insert into games (steam_appid, name, name_en, app_type, heat, release_date, adult_flag, blocked, deleted, is_free) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,false) returning id',
      [appid, name, nameEn, appType, heat, releaseDate, adult, blocked, deleted],
    );
    return Number(r.rows[0].id);
  };
  const offer = async (gameId, { code = 'steam', kind = 'official', region = 'cn', price, original = null, discount = 0, inStock = true, productType = 'official_direct', currency = 'CNY' }) => {
    await q(
      'insert into offers (game_id, platform_code, product_type, region, currency, price_cents, original_cents, discount_pct, in_stock) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [gameId, code, productType, region, currency, price, original, discount, inStock],
    );
    if (kind !== 'c2c') await q('insert into platforms (code, name, kind) values ($1,$2,$3) on conflict (code) do nothing', [code, code.toUpperCase(), kind]);
  };
  const daily = async (gameId, { code = 'steam', region = 'cn', price, day = 'current_date' }) => {
    await q(
      `insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) values ($1,$2,$3,${day},$4,'CNY')`,
      [gameId, code, region, price],
    );
  };

  const ids = {};
  ids.cs = await g(7001, { name: '反恐精英 2', nameEn: 'Counter-Strike 2', appType: 'game', heat: 90, releaseDate: '2023-09-27' });
  ids.portal = await g(7002, { name: '传送门2', nameEn: 'Portal 2', appType: 'game', heat: 80, releaseDate: '2011-04-19' });
  ids.dlc = await g(7003, { name: 'CS2 音乐包', nameEn: 'CS2 Music Kit', appType: 'dlc', heat: 30, releaseDate: '2024-01-01' });
  ids.fresh = await g(7004, { name: '新作', nameEn: 'Fresh Game', appType: 'game', heat: 10, releaseDate: '2026-11-01' });
  ids.adult = await g(7005, { name: '成人游戏', nameEn: 'Adult Game', appType: 'game', heat: 50, adult: true });
  ids.blocked = await g(7006, { name: '已禁用', nameEn: 'Blocked', appType: 'game', heat: 60, blocked: true });
  ids.deleted = await g(7007, { name: '已删除', nameEn: 'Deleted', appType: 'game', heat: 70, deleted: true });
  ids.usOnly = await g(7008, { name: '美区独占', nameEn: 'US Only', appType: 'game', heat: 40 });

  // cn 报价：steam 低折扣高 + sonkwo 更低 + steampy(c2c) 超低价（不得进读模型）+ 缺货行
  await offer(ids.cs, { price: 12000, original: 12000, discount: 0 });
  await offer(ids.cs, { code: 'sonkwo', kind: 'authorized_reseller', price: 9900, original: 12000, discount: 17 });
  await offer(ids.cs, { code: 'steampy', kind: 'c2c', price: 100, original: null, discount: 99 });
  await offer(ids.portal, { price: 4200, original: 4200, discount: 0 });
  await offer(ids.portal, { code: 'gog', kind: 'authorized_reseller', price: 3000, original: 4200, discount: 28 });
  await offer(ids.dlc, { price: 3000, original: 5000, discount: 40 });
  await offer(ids.fresh, { price: 6000, original: 6000, discount: 0 });
  await offer(ids.adult, { price: 5000, original: 5000, discount: 0 });
  await offer(ids.blocked, { price: 2000, original: 2000, discount: 0 });
  await offer(ids.deleted, { price: 2000, original: 2000, discount: 0 });
  await offer(ids.usOnly, { region: 'us', price: 1500, original: 1500, discount: 0 });
  // 缺货行：不该成为 current_low 来源
  await offer(ids.fresh, { code: 'humble', kind: 'authorized_reseller', price: 100, inStock: false });

  // 日价：cs 有昨天史低；portal 只有今天；fresh/dlcs/adult/blocked/deleted/usOnly 各有一条
  await daily(ids.cs, { price: 12000 });
  await daily(ids.cs, { price: 9500, day: 'current_date - 1' });
  await daily(ids.portal, { price: 3000 });
  await daily(ids.dlc, { price: 3000 });
  await daily(ids.fresh, { price: 6000 });
  await daily(ids.adult, { price: 5000 });
  await daily(ids.blocked, { price: 2000 });
  await daily(ids.deleted, { price: 2000 });
  await daily(ids.usOnly, { code: 'steam', region: 'us', price: 1500 });

  // 快照：每个种了价的游戏都刷新价格/历史列（与生产 ingest 的维护一致）
  for (const gid of Object.values(ids)) {
    await db.refreshGameRegionPrices(q, gid);
    await db.refreshGameRegionHist(q, gid);
  }

  // 登录用户：标记感兴趣 + 绑定 Steam 账号拥有 cs
  const user = await db.createUser(q, { username: 'alice', password: 'alice123456' });
  await q('insert into user_game_flags (user_id, game_id, interested) values ($1,$2,true)', [user.id, ids.cs]);
  await q('insert into steam_accounts (steam_id, persona_name, user_id) values ($1,$2,$3)', ['76561198000000001', 'Alice', user.id]);
  await q('insert into steam_games (steam_id, appid) values ($1,$2)', ['76561198000000001', 7001]);
  return { ids, userId: user.id };
}

test('新旧实现 20 组筛选组合：total 与首页 id 顺序完全一致（验收 5）', async () => {
  const { store, q } = await fresh();
  try {
    const { ids, userId } = await seedMixed({ store, q });
    const combos = [];
    const sortOf = ['discount', 'price', 'name'];
    const typeOf = ['all', 'game', 'dlc'];
    const releasedOf = ['all', '30d', '1y'];
    const marksOf = ['any', 'unmarked'];
    const kwOf = ['', '反恐精英', 'portal', '7002'];
    let i = 0;
    for (const sort of sortOf) for (const type of typeOf) for (const released of releasedOf) for (const marks of marksOf) for (const kw of kwOf) {
      if (i >= 9) break;
      combos.push({ sort, type, released, marks, keyword: kw, userId: null, compact: true });
      i += 1;
    }
    i = 0;
    for (const sort of ['discount', 'price', 'name']) for (const type of ['all', 'game']) for (const kw of ['', 'cs', '7003']) for (const owned of ['exclude', 'only']) {
      if (i >= 8) break;
      combos.push({ sort, type, released: 'all', marks: 'any', keyword: kw, userId, compact: true, owned });
      i += 1;
    }
    combos.push({ sort: 'discount', type: 'all', released: 'all', marks: 'any', keyword: '', userId: null, compact: true, interest: 'off', guestFlags: { interestedIds: [], uninterestedIds: [String(ids.portal)], ownedIds: [], excludeIds: [] } });
    combos.push({ sort: 'price', type: 'all', released: 'all', marks: 'unmarked', keyword: '', userId: null, compact: false, guestFlags: { interestedIds: [], uninterestedIds: [], ownedIds: [], excludeIds: [String(ids.portal)] } }); // 非 compact 分支也要一致
    combos.push({ sort: 'name', type: 'all', released: 'all', marks: 'any', keyword: '', userId: null, compact: false, guestFlags: { interestedIds: [], uninterestedIds: [], ownedIds: [], excludeIds: [String(ids.fresh)] } });
    assert.equal(combos.length, 20, '恰好 20 组组合');

    for (const combo of combos) {
      const opts = { region: 'cn', page: 1, pageSize: 20, interest: 'all', blocked: 'exclude', adult: 'hide', ...combo };
      const legacy = await searchLegacy(q, opts);
      const rm = await searchRm(q, opts);
      assert.equal(rm.total, legacy.total, `total 不一致：${JSON.stringify(combo)}`);
      assert.deepEqual(
        rm.rows.map((r) => String(r.id)),
        legacy.rows.map((r) => String(r.id)),
        `首页 id 顺序不一致：${JSON.stringify(combo)}`,
      );
      assert.equal(rm.pages, legacy.pages, 'pages 一致');
    }
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});

test('读模型字段与旧 CTE 口径一致：价格/折扣/Steam 价/史低/prev/平台名', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedMixed({ store, q });
    const rm = await searchRm(q, { region: 'cn', keyword: '反恐精英', compact: true });
    const legacy = await searchLegacy(q, { region: 'cn', keyword: '反恐精英', compact: true });
    assert.equal(rm.total, 1);
    const a = rm.rows[0];
    const b = legacy.rows[0];
    assert.equal(a.current_low, b.current_low, 'current_low=官方渠道在售最低（sonkwo 9900，c2c 100 不进）');
    assert.equal(a.current_low, 9900);
    assert.equal(a.currency, b.currency);
    assert.equal(a.steam_price, b.steam_price, 'steam_price 只看 steam 平台在售');
    assert.equal(a.current_original, b.current_original);
    assert.equal(a.discount, b.discount);
    assert.equal(a.hist_low, b.hist_low, 'hist_low 与旧 daily_rollup 一致（含昨天 9500）');
    assert.equal(a.hist_low, 9500);
    assert.equal(a.prev_hist_low, b.prev_hist_low, 'prev_hist_low 与旧口径一致（昨天 9500）');
    assert.equal(a.prev_hist_low, 9500);
    assert.equal(a.day_count, b.day_count, 'day_count 与旧口径一致');
    assert.equal(a.low_platform, 'sonkwo');
    assert.equal(a.low_platform_name, b.low_platform_name);
    assert.ok(Array.isArray(a.platform_names) && a.platform_names.includes('杉果'), 'platform_names 补充列可用');
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});

test('写一次新价 → 快照同一轮更新（验收 10 前半）：ingestOffers 后立即读到新价与新史低', async () => {
  const { store, q } = await fresh();
  try {
    await ingestOffers(store, { platform: steamPlatform, offers: [{ platformCode: 'steam', platformProductId: 'p1', steamAppid: 7101, title: '同步测试', productType: 'official_direct', region: 'cn', currency: 'CNY', priceCents: 9900, originalCents: 9900, discountPct: 0, inStock: true, buyUrl: 'https://x/', meta: {} }] });
    const gid = (await q('select id from games where steam_appid = 7101')).rows[0].id;
    let snap = (await q('select * from game_region_snapshot where game_id = $1 and region = $2', [gid, 'cn'])).rows[0];
    assert.equal(snap.price_cents, 9900, '价格同轮可见');
    assert.equal(snap.hist_low_cents, 9900);
    assert.equal(snap.prev_hist_low_cents, null, '首个价格日 prev 为空');

    // 同一天再写更低 → 快照同轮更新、prev 不动
    await ingestOffers(store, { platform: steamPlatform, offers: [{ platformCode: 'steam', platformProductId: 'p1', steamAppid: 7101, title: '同步测试', productType: 'official_direct', region: 'cn', currency: 'CNY', priceCents: 4900, originalCents: 9900, discountPct: 50, inStock: true, buyUrl: 'https://x/', meta: {} }] });
    snap = (await q('select * from game_region_snapshot where game_id = $1 and region = $2', [gid, 'cn'])).rows[0];
    assert.equal(snap.price_cents, 4900, '新价同轮可见');
    assert.equal(snap.hist_low_cents, 4900, 'hist 吸收当天新低');
    assert.equal(snap.prev_hist_low_cents, null, '同日 prev 不变');
  } finally {
    await store.close();
  }
});

test('日界切换：跨天后第一次写入 prev_hist_low 正确滚动（验收要点 1）', async () => {
  const { store, q } = await fresh();
  try {
    const gid = (await q("insert into games (steam_appid, name, is_free) values (7102, '日界', false) returning id")).rows[0].id;
    await db.touchDailyAggregate(q, { gameId: Number(gid), region: 'cn', platformCode: 'steam', priceCents: 9900 });
    // 模拟跨天：把 hist_low_day 拨回昨天
    await q('update game_region_snapshot set hist_low_day = current_date - 1 where game_id = $1 and region = $2', [gid, 'cn']);
    // 跨天第一次写入更低
    await db.touchDailyAggregate(q, { gameId: Number(gid), region: 'cn', platformCode: 'steam', priceCents: 5000 });
    let snap = (await q('select * from game_region_snapshot where game_id = $1 and region = $2', [gid, 'cn'])).rows[0];
    assert.equal(snap.hist_low_cents, 5000, 'hist 吸收新低');
    assert.equal(snap.prev_hist_low_cents, 9900, 'prev 滚动为昨天的 hist（新史低角标数据源）');
    // 同日第二次写入：prev 不再动
    await db.touchDailyAggregate(q, { gameId: Number(gid), region: 'cn', platformCode: 'steam', priceCents: 4000 });
    snap = (await q('select * from game_region_snapshot where game_id = $1 and region = $2', [gid, 'cn'])).rows[0];
    assert.equal(snap.hist_low_cents, 4000);
    assert.equal(snap.prev_hist_low_cents, 9900, '同日 prev 保持');
    // c2c 写入不进史低，但日界照常切换
    await q("insert into platforms (code, name, kind) values ('steampy','SteamPy','c2c') on conflict do nothing");
    await q('update game_region_snapshot set hist_low_day = current_date - 1 where game_id = $1 and region = $2', [gid, 'cn']);
    await db.touchDailyAggregate(q, { gameId: Number(gid), region: 'cn', platformCode: 'steampy', priceCents: 1 });
    snap = (await q('select * from game_region_snapshot where game_id = $1 and region = $2', [gid, 'cn'])).rows[0];
    assert.equal(snap.hist_low_cents, 4000, 'c2c 不进史低');
    assert.equal(snap.prev_hist_low_cents, 4000, '日界切换不看渠道：prev = 跨天前的 hist');
  } finally {
    await store.close();
  }
});

test('合并游戏：from/to 两侧快照正确（验收 7）', async () => {
  const { store, q } = await fresh();
  try {
    const from = Number((await q("insert into games (steam_appid, name, is_free) values (7103, '源', false) returning id")).rows[0].id);
    const to = Number((await q("insert into games (steam_appid, name, is_free) values (7104, '目标', false) returning id")).rows[0].id);
    await q("insert into offers (game_id, platform_code, product_type, region, currency, price_cents, discount_pct, in_stock) values ($1,'sonkwo','authorized_direct','cn','CNY',5000,0,true)", [from]);
    await q("insert into offers (game_id, platform_code, product_type, region, currency, price_cents, discount_pct, in_stock) values ($1,'steam','official_direct','cn','CNY',9000,0,true)", [to]);
    await q("insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) values ($1,'steam','cn',current_date-1,4000,'CNY'), ($2,'steam','cn',current_date-1,8000,'CNY')", [from, to]);
    await db.refreshGameRegionPrices(q, from);
    await db.refreshGameRegionPrices(q, to);
    await db.refreshGameRegionHist(q, from);
    await db.refreshGameRegionHist(q, to);

    const r = await db.mergeGames(q, { fromGameId: from, toGameId: to });
    assert.equal(r.merged, true);
    assert.equal((await q('select count(*)::int as n from game_region_snapshot where game_id = $1', [from])).rows[0].n, 0, 'from 行随 games 级联删除');
    const snap = (await q('select * from game_region_snapshot where game_id = $1 and region = $2', [to, 'cn'])).rows[0];
    assert.equal(snap.price_cents, 5000, 'to 现价取并集最低（sonkwo 5000）');
    assert.equal(snap.hist_low_cents, 4000, 'to 史低取双方日价并集');
    assert.equal(snap.prev_hist_low_cents, 4000, 'to 的 prev 同步重算');
  } finally {
    await store.close();
  }
});

test('禁用/回收站里的游戏不出现在列表（验收 8）；成人 hide 默认过滤', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedMixed({ store, q });
    const rm = await searchRm(q, { region: 'cn', compact: true });
    const rmIds = rm.rows.map((r) => String(r.id)).sort();
    assert.ok(!rmIds.includes(String(ids.blocked)), '禁用不进列表');
    assert.ok(!rmIds.includes(String(ids.deleted)), '回收站不进列表');
    assert.ok(!rmIds.includes(String(ids.adult)), '成人默认 hide');
    assert.ok(!rmIds.includes(String(ids.usOnly)), 'us 区报价不进入 cn 列表');
    assert.equal(rm.total, 4, 'cs/portal/dlc/fresh 四款可见');
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});

test('抽样对账 0 差异；corrupt 后 check 发现、--fix 修复、rebuild 兜底（验收 10 后半）', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedMixed({ store, q });
    let r = await db.readModelCheck(q, { sample: 200 });
    assert.equal(r.diffs.length, 0, '正常写入路径下对账 0 差异');

    // 人为破坏一行 → check 发现
    await q('update game_region_snapshot set price_cents = 12345 where game_id = $1 and region = $2', [ids.cs, 'cn']);
    r = await db.readModelCheck(q, { sample: 200 });
    assert.ok(r.diffs.some((d) => d.gameId === Number(ids.cs) && d.field === 'price_cents'), '能发现被改坏的价');

    // --fix 修复后重查 0 差异
    r = await db.readModelCheck(q, { sample: 200, fix: true });
    r = await db.readModelCheck(q, { sample: 200 });
    assert.equal(r.diffs.length, 0, 'fix 后 0 差异');

    // rebuild 也能修（全量）
    await q('update game_region_snapshot set hist_low_cents = 1 where game_id = $1 and region = $2', [ids.portal, 'cn']);
    const rebuilt = await db.readModelRebuild(q, {});
    assert.ok(rebuilt.deleted >= 4, 'rebuild 删除旧行并重填');
    r = await db.readModelCheck(q, { sample: 200 });
    assert.equal(r.diffs.length, 0, 'rebuild 后 0 差异');
  } finally {
    await store.close();
  }
});

test('B5 增量对账：绕过双写（直改 offers 不刷快照）被变更优先检出并修复', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedMixed({ store, q });
    // 模拟「手动 SQL/迁移绕过」：直接改 offers 价格且不调 refreshGameRegionPrices（快照陈旧）
    await q("update offers set price_cents = 8888, updated_at = now() where game_id = $1 and region = 'cn' and platform_code = 'steam'", [ids.cs]);
    const stale = await q('select price_cents from game_region_snapshot where game_id = $1 and region = $2', [ids.cs, 'cn']);
    assert.equal(Number(stale.rows[0].price_cents), 9900, '绕过写后快照仍是旧价（不一致已构造）');

    let r = await db.readModelCheck(q, { sample: 200 });
    assert.ok(r.suspect >= 1, `疑似陈旧行应被优先检出，实际 ${r.suspect}`);
    assert.ok(
      r.diffs.some((d) => d.gameId === Number(ids.cs) && d.field === 'price_cents'),
      '对账能检出直改 offers 造成的不一致',
    );

    r = await db.readModelCheck(q, { sample: 200, fix: true });
    assert.ok(r.fixed >= 1, 'fix 就地修复出现差异的行');
    r = await db.readModelCheck(q, { sample: 200 });
    assert.equal(r.diffs.length, 0, '修复后 0 差异');
    const repaired = await q('select price_cents, offers_count from game_region_snapshot where game_id = $1 and region = $2', [ids.cs, 'cn']);
    assert.equal(Number(repaired.rows[0].price_cents), 8888, '快照价已对齐被绕过的 offers 写入');
  } finally {
    await store.close();
  }
});

test('B5 增量对账：绕过 daily_prices 写入（史低口径）同样被检出并修复', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedMixed({ store, q });
    // 模拟绕过 touchDailyAggregate：直改日价把「昨天史低」压低（快照 hist/prev 陈旧）
    await q("update daily_prices set min_price_cents = 100, updated_at = now() where game_id = $1 and region = 'cn' and day < current_date", [ids.cs]);
    const stale = await q('select hist_low_cents from game_region_snapshot where game_id = $1 and region = $2', [ids.cs, 'cn']);
    assert.equal(Number(stale.rows[0].hist_low_cents), 9500, '绕过写后史低仍是旧值（不一致已构造）');

    let r = await db.readModelCheck(q, { sample: 200 });
    assert.ok(r.suspect >= 1, '日价比快照新的行应进疑似陈旧行');
    assert.ok(
      r.diffs.some((d) => d.gameId === Number(ids.cs) && d.field === 'hist_low_cents'),
      '对账能检出直改 daily_prices 造成的史低不一致',
    );

    r = await db.readModelCheck(q, { sample: 200, fix: true });
    assert.ok(r.fixed >= 1, '修复出现差异的行');
    const repaired = await q('select hist_low_cents, prev_hist_low_cents from game_region_snapshot where game_id = $1 and region = $2', [ids.cs, 'cn']);
    assert.equal(Number(repaired.rows[0].hist_low_cents), 100, '史低已对齐被绕过的日价写入');
  } finally {
    await store.close();
  }
});

test('B5 对账口径不回归：默认无 fix 只报告、返回字段齐全', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedMixed({ store, q });
    await q('update game_region_snapshot set price_cents = 54321 where game_id = $1 and region = $2', [ids.portal, 'cn']);
    const r = await db.readModelCheck(q, { sample: 200 });
    assert.ok(r.diffs.length >= 1, '默认只报告不修');
    assert.equal(r.fixed, 0, '未传 fix 时 fixed 为 0');
    const untouched = await q('select price_cents from game_region_snapshot where game_id = $1 and region = $2', [ids.portal, 'cn']);
    assert.equal(Number(untouched.rows[0].price_cents), 54321, '默认 check 不写快照（只报告）');
  } finally {
    await store.close();
  }
});

test('READ_MODEL=legacy 回滚开关：旧 SQL 路径仍可用（表保留）', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedMixed({ store, q });
    process.env.READ_MODEL = 'legacy';
    const legacy = await db.gameSearch(q, { region: 'cn', compact: true, keyword: '反恐精英' });
    assert.equal(legacy.total, 1, 'legacy 模式正常出结果');
    assert.equal(legacy.rows[0].steam_appid, 7001);
    const snapCount = (await q('select count(*)::int as n from game_region_snapshot')).rows[0].n;
    assert.ok(snapCount >= 4, '回滚不改表数据');
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});
test('AY：关键词先走候选 ID——零命中不跑 count/列表；名称/英文名/别名/AppID 命中不变', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedMixed({ store, q });
    // 平台别名：只应通过 game_aliases 命中
    await q(
      "insert into game_aliases (game_id, platform_code, platform_product_id, platform_title) values ($1, 'sonkwo', 'SK-1', '蒸汽传送门')",
      [ids.portal],
    );
    const base = { region: 'cn', compact: true, pageSize: 20, sort: 'discount', interest: 'all', owned: 'include', blocked: 'exclude', typeFilter: 'all', released: 'all', marks: 'any', adult: 'hide' };
    // 统计 count 查询次数：零命中必须一次都不跑（原实现要扫两遍全表）
    // DX 批（docs/SEARCH-FIX-PERF.md §DX）：count 与 rows 合并后，命中路径也不再有独立 count
    // 查询（total 由 rows 里的 count(*) over() 窗口一次拿回），锁「合并 rows 跑一次」。
    let countQueries = 0;
    let mergedRows = 0;
    const wrapped = (sql, params) => {
      if (/^\s*select count/i.test(String(sql))) countQueries += 1;
      if (String(sql).includes('count(*) over()')) mergedRows += 1;
      return q(sql, params);
    };
    const zero = await db.gameSearch(wrapped, { ...base, keyword: 'zzzzzz' });
    assert.equal(zero.total, 0, '零命中 total=0');
    assert.deepEqual(zero.rows, [], '零命中不返回行');
    assert.equal(zero.pages, 1, '零命中分页兜底 1 页');
    assert.equal(countQueries, 0, '零命中直接返回，不再跑 count 全表扫');
    // 名称（含空格归一化：『反恐 精英』应命中『反恐精英 2』）
    const byName = await db.gameSearch(q, { ...base, keyword: '反恐 精英' });
    assert.deepEqual(byName.rows.map((r) => Number(r.id)), [ids.cs], '中文名命中（空格归一化）');
    // 英文名
    const byEn = await db.gameSearch(q, { ...base, keyword: 'portal' });
    assert.deepEqual(byEn.rows.map((r) => Number(r.id)), [ids.portal], '英文名命中');
    // 平台别名
    const byAlias = await db.gameSearch(q, { ...base, keyword: '蒸汽传送门' });
    assert.deepEqual(byAlias.rows.map((r) => Number(r.id)), [ids.portal], '平台别名命中');
    // AppID（纯数字）
    const byAppid = await db.gameSearch(q, { ...base, keyword: '7002' });
    assert.deepEqual(byAppid.rows.map((r) => Number(r.id)), [ids.portal], 'AppID 精确命中');
    // DX 批：命中路径不再跑独立 count——total 由合并 rows 的 count(*) over() 一次拿回
    countQueries = 0;
    mergedRows = 0;
    const hit = await db.gameSearch(wrapped, { ...base, keyword: '反恐精英' });
    assert.equal(hit.total, 1);
    assert.equal(countQueries, 0, 'DX：命中路径不跑独立 count 查询（合并进 rows）');
    assert.equal(mergedRows, 1, 'DX：合并 rows 查询只跑一次（原 count+rows 两条）');
    // 候选数达到上限 → 回退原 LIKE 路径（total 仍精确）；用环境变量把上限压到 1 来锁这条分支
    process.env.SEARCH_KEYWORD_CANDIDATE_CAP = '1';
    try {
      countQueries = 0;
      mergedRows = 0;
      const fallback = await db.gameSearch(wrapped, { ...base, keyword: '反恐精英' });
      assert.equal(fallback.total, 1, '回退路径 total 仍精确');
      assert.deepEqual(fallback.rows.map((r) => Number(r.id)), [ids.cs]);
      assert.equal(countQueries, 0, 'DX：回退路径同样不跑独立 count（窗口合并）');
      assert.equal(mergedRows, 1, 'DX：回退路径合并 rows 只跑一次');
    } finally {
      delete process.env.SEARCH_KEYWORD_CANDIDATE_CAP;
    }
    // 过滤条件仍然生效：已禁用/成人/回收站不因关键词候选混进来
    const filtered = await db.gameSearch(q, { ...base, keyword: '成人游戏' });
    assert.equal(filtered.total, 0, '成人内容默认 hide，不进结果');
  } finally {
    await store.close();
  }
});

// ============================================================ CO-5/B4-2 第十五轮静态锁
// games 域（B4 #21：公开 /api/games/*）从 server.js/pg.js 巨石拆出后，四组静态断言按新落点指向：
//   · 路由分支 → src/routes/games.js（主段单入口，16 组路由）；
//   · 域专属 SQL → src/store/games-repository.js；pg.js 必须 re-export（旧 db.* 导入签名不变），
//     无 DDL 搬家（games/daily_prices/offers 等表 DDL 在 pg.js SCHEMA，跨模块共用）；
//   · server.js 只留单入口接线（主段），且必须真实调用——删掉调用即红（防死模块）；
//   · 旧分支不得残留在 server.js（防双实现）。
// 反向自检口径：删掉 routes/games.js 任一路由分支 → 第 1 组断言红；删掉 server.js 的入口
// 接线 → 第 2 组红；把分支抄回 server.js → 第 3 组红；删 pg.js re-export → 第 4 组红。
// 边界判定：只拆公开 /api/games/*——/api/admin/games*（列表/stats/merge/links/deleted）已随
// B4 #15 拆到 routes/admin-games.js，/api/behavior 留 server.js；/img/steam/* 图片代理不是
// API 路由、留 server.js；isLoggablePath 的 stamp/search 访问记录豁免是中间件、留 server.js。

const GM_ROUTES = readFileSync(fileURLToPath(new URL('../src/routes/games.js', import.meta.url)), 'utf8');
const GM_REPO = readFileSync(fileURLToPath(new URL('../src/store/games-repository.js', import.meta.url)), 'utf8');
const GM_SERVER = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const GM_PG = readFileSync(fileURLToPath(new URL('../src/store/pg.js', import.meta.url)), 'utf8');

test('CO-5/B4-2 第十五轮：games 路由分支全部在 src/routes/games.js（主段单入口，删任一支即红）', () => {
  // 公开只读六组
  assert.match(GM_ROUTES, /path === '\/api\/games\/for-you' && req\.method === 'POST'/, 'for-you 分支在新文件');
  assert.match(GM_ROUTES, /path === '\/api\/games\/count' && req\.method === 'GET'/, 'count 分支在新文件');
  assert.match(GM_ROUTES, /path === '\/api\/games\/stamp' && req\.method === 'GET'/, 'stamp 分支在新文件');
  assert.match(GM_ROUTES, /path === '\/api\/games' && req\.method === 'GET'/, '列表 GET 分支在新文件');
  assert.match(GM_ROUTES, /path === '\/api\/games\/search' && req\.method === 'POST'/, 'search POST 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/by-id\\\/\(\\d\+\)\$\/\)/, 'by-id 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/\(\\d\+\)\$\/\)/, 'gameMatch 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/\(\\d\+\)\\\/dlc\$\/\)/, 'dlc 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/\(\\d\+\)\\\/history\\\.csv\$\/\)/, 'history.csv 分支在新文件');
  // 登录用户与管理员写操作
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/\(\\d\+\)\\\/flags\$\/\)/, 'flags 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/id\\\/\(\\d\+\)\\\/flags\$\/\)/, 'flags by-id 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/\(\\d\+\)\\\/interest\$\/\)/, 'interest 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/\(\\d\+\)\\\/owned\$\/\)/, 'owned 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/id\\\/\(\\d\+\)\\\/interest\$\/\)/, 'interest by-id 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/id\\\/\(\\d\+\)\\\/owned\$\/\)/, 'owned by-id 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/\(\\d\+\)\\\/deleted\$\/\)/, 'deleted 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/id\\\/\(\\d\+\)\\\/deleted\$\/\)/, 'deleted by-id 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/\(\\d\+\)\\\/blocked\$\/\)/, 'blocked 分支在新文件');
  assert.match(GM_ROUTES, /path\.match\(\/\^\\\/api\\\/games\\\/\(\\d\+\)\\\/description\$\/\)/, 'description 分支在新文件');
  // 单入口形态（§15.3 位置语义：主段）
  assert.match(GM_ROUTES, /export async function handleGamesRoutes\(ctx\)/, '主段入口');
  // 守卫与语义随路由
  assert.match(GM_ROUTES, /if \(!requireUser\(\)\) return true/, '登录守卫');
  assert.match(GM_ROUTES, /if \(!requireAdmin\(\)\) return true/, '管理员守卫');
  assert.match(GM_ROUTES, /if \(!historyCsvEnabled\(\)\) return \(json\(res, 404, \{ error: 'not found' \}\), true\);/, 'CSV 开关关闭 404 语义随路由');
  assert.match(GM_ROUTES, /runGated\('games-search', 2, async \(\) => \{/, 'games-search 并发闸语义随路由');
  assert.match(GM_ROUTES, /listCache\.get\(cacheKey, gen\)/, 'DX 批列表缓存命中语义随路由');
  assert.match(GM_ROUTES, /invalidateListCache\(\); \/\/ DX 批：个人标记直接影响/, 'flags 写后失效列表缓存语义随路由');
  assert.match(GM_ROUTES, /invalidateAdminGamesCache\(\);\n    invalidateListCache\(\); \/\/ DX 批：删除\/恢复改变列表内容/, 'deleted 写后双缓存失效语义随路由');
  assert.match(GM_ROUTES, /const forYouCache = new Map\(\);/, 'forYouCache 随域移入模块级（只被本域使用）');
  assert.match(GM_ROUTES, /const historyCsvEnabled = \(\) => process\.env\.HISTORY_CSV_ENABLED === '1';/, 'historyCsvEnabled 随域移入模块级');
  assert.match(GM_ROUTES, /await import\('\.\.\/discovery\.js'\)/, 'discovery 动态导入路径已修正为 ../discovery.js');
  // 路由模块只做编排：不许出现 SQL 字面量（全部走 repository）
  assert.ok(!/select |insert |update |delete from /.test(GM_ROUTES), 'routes/games.js 不写 SQL 字面量');
  // 未命中返回 false，宿主继续
  assert.match(GM_ROUTES, /return false;/, '未命中返回 false，宿主继续');
});

test('CO-5/B4-2 第十五轮：server.js 必须真实接线主段入口（删掉调用即红，防死模块）', () => {
  assert.match(GM_SERVER, /import \{ handleGamesRoutes \} from '\.\/routes\/games\.js'/, 'server.js 必须导入域路由入口');
  // 锁「完整调用形态」：必须是 if (await handleGamesRoutes(...)) return;——只断言字符串存在会被 if(false) 包一层绕过
  assert.match(GM_SERVER, /if \(\s*await handleGamesRoutes\(\{[\s\S]{0,1400}?path,[\s\S]{0,1400}?req,[\s\S]{0,1400}?res,[\s\S]{0,1400}?dlcFetchImpl,[\s\S]{0,400}?\}\)\s*\)\s*return;/, '主段接线（完整形态，且消费返回值）');
  // ctx 关键字段必须传齐：漏传 url 查询参数丢失、漏传 requireUser/requireAdmin 守卫失效、
  // 漏传 user 审计落空、漏传 runGated 并发闸语义丢失、漏传 listCache/invalidateListCache 缓存分家、
  // 漏传 invalidateAdminGamesCache 后台短缓存漂移、漏传 gameCountCache count 缓存隔离破坏、
  // 漏传 maybeFillDlcOnRead DLC 回源节流失效
  assert.match(GM_SERVER, /await handleGamesRoutes\(\{[\s\S]{0,1400}?url,/);
  assert.match(GM_SERVER, /await handleGamesRoutes\(\{[\s\S]{0,1400}?requireUser,/);
  assert.match(GM_SERVER, /await handleGamesRoutes\(\{[\s\S]{0,1400}?requireAdmin,/);
  assert.match(GM_SERVER, /await handleGamesRoutes\(\{[\s\S]{0,1400}?user,/);
  assert.match(GM_SERVER, /await handleGamesRoutes\(\{[\s\S]{0,1400}?runGated,/);
  assert.match(GM_SERVER, /await handleGamesRoutes\(\{[\s\S]{0,1400}?listCache,/);
  assert.match(GM_SERVER, /await handleGamesRoutes\(\{[\s\S]{0,1400}?invalidateListCache,/);
  assert.match(GM_SERVER, /await handleGamesRoutes\(\{[\s\S]{0,1400}?invalidateAdminGamesCache,/);
  assert.match(GM_SERVER, /await handleGamesRoutes\(\{[\s\S]{0,1400}?gameCountCache,/);
  assert.match(GM_SERVER, /await handleGamesRoutes\(\{[\s\S]{0,1400}?maybeFillDlcOnRead,/);
  // 位置语义锁：调用必须在认证上下文就绪后的主段——本域最早路由 for-you 的原位置
  // （handleAuthRoutes 之后、handleMeRoutes 之前）
  assert.match(GM_SERVER, /await handleAuthRoutes\(\{[\s\S]*?await handleGamesRoutes\(\{/s, '接线在 auth 主段接线之后（本域原位置）');
  assert.match(GM_SERVER, /await handleGamesRoutes\(\{[\s\S]*?await handleMeRoutes\(\{/s, '接线在 me 主段接线之前（本域原位置）');
  // 边界锁：其它域路由与中间件留宿主（admin games 段已随 B4 #15 拆到 routes/admin-games.js）
  assert.match(GM_SERVER, /await handleAdminGamesAdmin\(\{/, 'admin games 段已拆到 routes/admin-games.js（B4 #15）');
  assert.match(GM_SERVER, /path === '\/api\/behavior' && req\.method === 'POST'/, 'behavior 路由留 server.js（不属 /api/games/* 前缀）');
  assert.match(GM_SERVER, /const behaviorBuckets = new Map\(\);/, 'behaviorBuckets 留 server.js（behavior 路由留宿主）');
  assert.match(GM_SERVER, /path\.match\(\/\^\\\/img\\\/steam\\\/\(\\d\+\)\\\/\(\[a-z0-9_\]\+\)\$\/\)/, 'Steam 图片代理路由留 server.js（非 API 路由）');
  assert.match(GM_SERVER, /path === '\/api\/games\/stamp'\) return false;/, 'isLoggablePath 的 stamp 访问日志豁免留 server.js（中间件）');
  assert.match(GM_SERVER, /req\.method === 'POST' && path === '\/api\/games\/search'\) && res\.statusCode < 400/, 'search POST 访问记录豁免留 server.js（中间件）');
  assert.match(GM_SERVER, /'games-search': 2,/, 'HEAVY_GATE_CONFIG 键留 server.js');
});

test('CO-5/B4-2 第十五轮：games 路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/path === '\/api\/games\/for-you' && req\.method/.test(GM_SERVER), 'for-you 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/games\/count' && req\.method/.test(GM_SERVER), 'count 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/games\/stamp' && req\.method/.test(GM_SERVER), 'stamp 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/games' && req\.method/.test(GM_SERVER), '列表 GET 分支不得残留在 server.js');
  assert.ok(!/const guestSearchPost = path\.match/.test(GM_SERVER) && !/const guestSearchPost = path ===/.test(GM_SERVER), 'search POST 分支不得残留在 server.js');
  assert.ok(!/const byIdMatch = path\.match/.test(GM_SERVER), 'by-id 分支不得残留在 server.js');
  assert.ok(!/const gameMatch = path\.match/.test(GM_SERVER), 'gameMatch 分支不得残留在 server.js');
  assert.ok(!/const dlcMatch = path\.match/.test(GM_SERVER), 'dlc 分支不得残留在 server.js');
  assert.ok(!/const historyCsv = path\.match/.test(GM_SERVER), 'history.csv 分支不得残留在 server.js');
  assert.ok(!/const flagsByAppid = path\.match/.test(GM_SERVER), 'flags 分支不得残留在 server.js');
  assert.ok(!/const interestMatch = path\.match/.test(GM_SERVER), 'interest 分支不得残留在 server.js');
  assert.ok(!/const ownedMatch = path\.match/.test(GM_SERVER), 'owned 分支不得残留在 server.js');
  assert.ok(!/const byIdInterest = path\.match/.test(GM_SERVER), 'interest by-id 分支不得残留在 server.js');
  assert.ok(!/const byIdOwned = path\.match/.test(GM_SERVER), 'owned by-id 分支不得残留在 server.js');
  assert.ok(!/const delByAppid = path\.match/.test(GM_SERVER), 'deleted 分支不得残留在 server.js');
  assert.ok(!/const blockMatch = path\.match/.test(GM_SERVER), 'blocked 分支不得残留在 server.js');
  assert.ok(!/const descMatch = path\.match/.test(GM_SERVER), 'description 分支不得残留在 server.js');
  assert.ok(!/const forYouCache = new Map/.test(GM_SERVER), 'forYouCache 不得残留在 server.js（随域移入）');
  assert.ok(!/const historyCsvEnabled =/.test(GM_SERVER), 'historyCsvEnabled 不得残留在 server.js（随域移入）');
  // 域内联 SQL 不得残留在 server.js（已抽 games-repository.js）
  assert.ok(!/select count\(\*\)::int as n from games where not deleted/.test(GM_SERVER), 'count 域内联 SQL 不得残留在 server.js');
  assert.ok(!/select \(select count\(\*\)::int from games\) as games/.test(GM_SERVER), 'stamp 域内联 SQL 不得残留在 server.js');
});

test('CO-5/B4-2 第十五轮：games-repository.js 签名不变 + pg.js re-export（删 re-export 即红）', () => {
  // 搬家函数签名与拆分前一致（旧 db.* 导入签名不变）
  assert.match(GM_REPO, /export async function gameSearch\(\n  q,\n  \{ region = 'cn', page = 1, pageSize = 20, keyword = '', sort = 'discount', interest = 'all', owned = 'exclude', blocked = 'exclude', userId = null, typeFilter = 'all', released = 'all', marks = 'any', compact = false, guestFlags = null, wishlist = false, adult = 'hide', rating = '', reviewMin = null, deck = 'all', discountOnly = false, histLowOnly = false, freeOnly = false, unreleased = false \} = \{\},/, 'gameSearch 签名与拆分前一致');
  assert.match(GM_REPO, /export async function getUserWatch\(q, \{ userId, gameId, region = 'cn' \}\)/, 'getUserWatch 签名与拆分前一致');
  assert.match(GM_REPO, /export async function recordView\(q, \{ userId = null, path, appid = null \}\)/, 'recordView 签名与拆分前一致');
  assert.match(GM_REPO, /export async function dataGen\(q\)/, 'dataGen 签名与拆分前一致');
  assert.match(GM_REPO, /export async function listGameDlc\(q, \{ gameId, page = 1, pageSize = 10 \}\)/, 'listGameDlc 签名与拆分前一致');
  assert.match(GM_REPO, /export async function countGameDlc\(q, \{ gameId \}\)/, 'countGameDlc 签名与拆分前一致');
  assert.match(GM_REPO, /export async function countDlcMissing\(q, \{ gameId \}\)/, 'countDlcMissing 签名与拆分前一致');
  assert.match(GM_REPO, /export async function dlcSummary\(q, \{ steamAppid \}\)/, 'dlcSummary 签名与拆分前一致');
  assert.match(GM_REPO, /export async function setGameBlocked\(q, \{ steamAppid, gameId = null, blocked \}\)/, 'setGameBlocked 签名与拆分前一致');
  assert.match(GM_REPO, /export async function setGameDeleted\(q, \{ steamAppid = null, gameId = null, deleted \}\)/, 'setGameDeleted 签名与拆分前一致');
  assert.match(GM_REPO, /export async function setUserGameFlag\(q, \{ userId, gameId, interested = null, owned = null \}\)/, 'setUserGameFlag 签名与拆分前一致');
  // 域内联 SQL 新函数
  assert.match(GM_REPO, /export async function countGamesForApi\(q\)/, 'countGamesForApi 域内联 SQL 抽成新函数');
  assert.match(GM_REPO, /process\.env\.READ_MODEL === 'legacy'/, 'countGamesForApi 保留 READ_MODEL=legacy 回滚口径');
  assert.match(GM_REPO, /export async function gamesStamp\(q\)/, 'gamesStamp 域内联 SQL 抽成新函数');
  // 跨模块共享 SQL 片段留 pg.js，repository 导入不复制（防两处漂移）
  assert.match(GM_REPO, /import \{\n  OFFICIAL_KINDS,\n  GAME_SELECT,\n  GAME_SELECT_RM,\n  EFFECTIVE_OWNED_SQL,/, 'games-repository 从 pg.js 导入共享片段');
  assert.match(GM_REPO, /gameKeywordSql,/, 'games-repository 从 pg.js 导入 gameKeywordSql（#15 admin games 共用）');
  // pg.js 必须 re-export（旧 db.* 导入签名不变；routes/games.js 与现有测试照旧走聚合壳）
  assert.match(GM_PG, /gameSearch,/, 'pg.js 必须 re-export gameSearch');
  assert.match(GM_PG, /countGamesForApi,/, 'pg.js 必须 re-export countGamesForApi');
  assert.match(GM_PG, /gamesStamp,/, 'pg.js 必须 re-export gamesStamp');
  assert.match(GM_PG, /getUserWatch,/, 'pg.js 必须 re-export getUserWatch');
  assert.match(GM_PG, /recordView,/, 'pg.js 必须 re-export recordView');
  assert.match(GM_PG, /dataGen,/, 'pg.js 必须 re-export dataGen');
  assert.match(GM_PG, /listGameDlc,/, 'pg.js 必须 re-export listGameDlc');
  assert.match(GM_PG, /countGameDlc,/, 'pg.js 必须 re-export countGameDlc');
  assert.match(GM_PG, /countDlcMissing,/, 'pg.js 必须 re-export countDlcMissing');
  assert.match(GM_PG, /dlcSummary,/, 'pg.js 必须 re-export dlcSummary');
  assert.match(GM_PG, /setGameBlocked,/, 'pg.js 必须 re-export setGameBlocked');
  assert.match(GM_PG, /setGameDeleted,/, 'pg.js 必须 re-export setGameDeleted');
  assert.match(GM_PG, /setUserGameFlag,/, 'pg.js 必须 re-export setUserGameFlag');
  assert.match(GM_PG, /from '\.\/games-repository\.js'/, 'pg.js re-export 指向 games-repository.js');
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(!/export (async )?function (gameSearch|getUserWatch|recordView|dataGen|listGameDlc|countGameDlc|countDlcMissing|dlcSummary|setGameBlocked|setGameDeleted|setUserGameFlag)/.test(GM_PG), 'pg.js 不允许保留旧函数定义（只许 re-export）');
  // 边界判据锁：跨模块共用 SQL 留在 pg.js（watchlist 域/CLI/admin #15 共用）
  assert.match(GM_PG, /export async function gameDetail\(q, \{ steamAppid = null, gameId = null, region = 'cn', userId = null, adult = 'show' \}\)/, 'gameDetail 留 pg.js（watchlist/admin merge/links 跨域共用）');
  assert.match(GM_PG, /export async function regionOffers\(q, \{ steamAppid, region = null \} = \{\}\)/, 'regionOffers 留 pg.js（cli report 共用）');
  assert.match(GM_PG, /export async function dailyMinSeries\(q, \{ gameId, region = 'cn' \}\)/, 'dailyMinSeries 留 pg.js（report.js 共用）');
  assert.match(GM_PG, /export async function offersOfGame\(q, \{ gameId, region = 'cn' \}\)/, 'offersOfGame 留 pg.js（report.js 共用）');
  assert.match(GM_PG, /export async function setInterest\(q, \{ steamAppid = null, gameId = null, interested \}\)/, 'setInterest 留 pg.js（cli 共用）');
  assert.match(GM_PG, /export async function setOwned\(q, \{ steamAppid = null, gameId = null, owned \}\)/, 'setOwned 留 pg.js（cli 共用）');
  assert.match(GM_PG, /export async function setGameDescription\(q, \{ steamAppid, description, overwrite = false \}\)/, 'setGameDescription 留 pg.js（cli sync 共用）');
  assert.match(GM_PG, /export function gameKeywordSql\(kwParam, \{ appidAsInt = false, appidAsText = false, tokenCond = null \} = \{\}\)/, 'gameKeywordSql 留 pg.js（#15 admin games 搜索共用）');
  assert.match(GM_PG, /export const GAME_SELECT = `select g\.id,/, 'GAME_SELECT 共享片段留 pg.js 并 export');
  // repository 不搬家 DDL
  assert.ok(!/create table/.test(GM_REPO), 'games-repository.js 不搬家 DDL');
});