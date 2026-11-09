// Steam 同步状态与内容分级（docs/STEAM-SYNC-STATUS-AND-RATING.md）：
// 状态判定纯函数、分级派生、迁移置位、任务选取/写回、统计口径、前台成人过滤、
// applySteamDetails 共用函数的写/不写分支（V 批 §14.3.1）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { classifySteamStatus } from '../src/adapters/steam.js';
import { classifyContentRating, normalizeOfficial } from '../src/adapters/steam-meta.js';
import { applySteamDetails, entryFromMeta, runSteamStatusRound } from '../src/steam-status.js';

const cn = (data) => ({ success: true, data });
const fail = () => ({ success: false, data: null });
const hk = (data) => ({ success: true, data });
const hkComingSoon = () => ({ success: true, data: { release_date: { coming_soon: true } } });

test('classifySteamStatus：六态判定与港区补查（docs §4）', () => {
  // cn 有价 → ok
  assert.equal(classifySteamStatus(cn({ name: 'X', price_overview: { final: 9900 } })), 'ok');
  // cn 免费 → free
  assert.equal(classifySteamStatus(cn({ is_free: true, price_overview: null })), 'free');
  // cn 无价 + coming_soon → coming_soon
  assert.equal(classifySteamStatus(cn({ price_overview: null, release_date: { coming_soon: true } })), 'coming_soon');
  // cn 无价且非免费非未发售 → no_price
  assert.equal(classifySteamStatus(cn({ price_overview: null })), 'no_price');
  // cn success:false + hk 有价 → region_locked
  assert.equal(classifySteamStatus(fail(), hk({ price_overview: { final: 3900 } })), 'region_locked');
  // cn success:false + hk 免费 → region_locked
  assert.equal(classifySteamStatus(fail(), hk({ is_free: true })), 'region_locked');
  // cn success:false + hk coming_soon → not_found（国区下架/未上架）
  assert.equal(classifySteamStatus(fail(), hkComingSoon()), 'not_found');
  // cn success:false + hk 也不可售 → not_found
  assert.equal(classifySteamStatus(fail(), fail()), 'not_found');
});

test('classifyContentRating：adult/mature 派生（docs §5.1）', () => {
  // descriptors 3/4 或 ESRB AO → adult
  assert.equal(classifyContentRating({ descriptorIds: [3], ratings: {} }).adultFlag, true);
  assert.equal(classifyContentRating({ descriptorIds: [4], ratings: {} }).adultFlag, true);
  assert.equal(classifyContentRating({ descriptorIds: [], ratings: { esrb: { rating: 'AO' } } }).adultFlag, true);
  // mature：descriptors 2/5、PEGI 18、required_age 18（未命中 adult 时）
  assert.deepEqual(classifyContentRating({ descriptorIds: [2], ratings: {} }), { adultFlag: false, matureFlag: true });
  assert.deepEqual(classifyContentRating({ descriptorIds: [5], ratings: {} }), { adultFlag: false, matureFlag: true });
  assert.deepEqual(classifyContentRating({ descriptorIds: [], ratings: { pegi: { rating: '18' } } }), { adultFlag: false, matureFlag: true });
  assert.deepEqual(classifyContentRating({ requiredAge: 18, descriptorIds: [], ratings: {} }), { adultFlag: false, matureFlag: true });
  // 正常内容
  assert.deepEqual(classifyContentRating({ requiredAge: 12, descriptorIds: [1], ratings: { esrb: { rating: 'T' } } }), { adultFlag: false, matureFlag: false });
});

test('normalizeOfficial：解析分级字段（docs §3）', () => {
  const meta = normalizeOfficial(123, {
    name: 'X',
    required_age: '18',
    content_descriptors: { ids: [2, 5], notes: 'bad' },
    ratings: { esrb: { rating: 'M' }, pegi: { rating: '18' } },
    release_date: { coming_soon: false, date: '2020 年 1 月 1 日' },
    is_free: false,
  });
  assert.equal(meta.requiredAge, 18);
  assert.deepEqual(meta.contentDescriptors, [2, 5]);
  assert.deepEqual(meta.ageRatings, { esrb: { rating: 'M' }, pegi: { rating: '18' } });
  assert.equal(meta.comingSoon, false);
  // 缺失时全部为 null/undefined 可空
  const empty = normalizeOfficial(124, { name: 'Y' });
  assert.equal(empty.requiredAge, null);
  assert.equal(empty.contentDescriptors, null);
  assert.equal(empty.ageRatings, null);
});

test('迁移：加列幂等 + 免费批量置位 + 统计新口径', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    // 列存在（migrate 二次执行也幂等）
    await db.migrate(store);
    const cols = (await q("select column_name from information_schema.columns where table_name = 'games' and column_name in ('steam_status','steam_checked_at','required_age','content_descriptors','age_ratings','adult_flag','mature_flag')")).rows;
    assert.equal(cols.length, 7, '7 个新列都在');

    // 免费置位：is_free 的行迁移后自动 steam_status='free'，不重复置位
    await q("insert into games (steam_appid, name, is_free) values (1001, '免费A', true), (1002, '付费B', false), (1003, '免费C', true)");
    await db.migrate(store);
    const free = (await q("select count(*)::int as n from games where steam_status = 'free'")).rows[0].n;
    assert.equal(free, 2, '免费游戏应自动置位');
    const setAgain = await db.bulkSetFreeStatus(q);
    assert.equal(setAgain, 0, '幂等：第二次置位 0 条');

    // 免费不再被任务选取
    const candidates = await db.listSteamStatusCandidates(q, { limit: 10 });
    assert.deepEqual(candidates.map((c) => c.steamAppid).sort(), [1002], '免费不参与探测');
    assert.equal(candidates[0].id > 0, true);

    // 统计口径（AC-2 复核）：待同步 = 未探测 或 ok 缺报价；已同步 = ok + 有报价（免费不要求报价）
    await db.setSteamStatus(q, { steamAppid: 1002, status: 'ok', requiredAge: null, contentDescriptors: null, ageRatings: null });
    const s1 = await db.adminGameStats(q);
    assert.equal(s1.free, 2);
    assert.equal(s1.pending, 1, 'ok 但缺报价 → 待同步');
    assert.equal(s1.synced, 0);
    await q("insert into platforms (code, name, kind) values ('steam', 'Steam 国区', 'official') on conflict (code) do nothing");
    const game = (await q("select id from games where steam_appid = 1002")).rows[0];
    await q(
      "insert into offers (game_id, platform_code, region, currency, price_cents, original_cents, discount_pct, in_stock, buy_url, product_type) values ($1, 'steam', 'cn', 'CNY', 6500, 10000, 35, true, 'https://store.steampowered.com/app/1002/', 'official_direct')",
      [game.id],
    );
    const s2 = await db.adminGameStats(q);
    assert.equal(s2.pending, 0, 'ok + 有报价 → 不再待同步');
    assert.equal(s2.synced, 1, '已同步 = ok + 有报价（AC8 口径）');
    assert.equal(s2.pendingProbe, 0);
    // 分项之和 = 有 appid 未删除总数
    const sum = s2.synced + s2.pendingProbe + s2.free + s2.comingSoon + s2.regionLocked + s2.noPrice + s2.notFound + s2.other;
    assert.equal(sum, s2.withAppid, '分项之和 = 有 appid 数');
  } finally {
    await store.close();
  }
});

test('任务写回：状态 + 分级字段落库，steam_checked_at 作续跑游标', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q("insert into games (steam_appid, name, is_free) values (2001, '锁区X', false)");
    await db.setSteamStatus(q, {
      steamAppid: 2001,
      status: 'region_locked',
      requiredAge: 18,
      contentDescriptors: [3],
      ageRatings: { esrb: { rating: 'AO' } },
      adultFlag: true,
      matureFlag: false,
    });
    const row = (await q('select steam_status, required_age, content_descriptors, age_ratings, adult_flag, mature_flag, steam_checked_at from games where steam_appid = 2001')).rows[0];
    assert.equal(row.steam_status, 'region_locked');
    assert.equal(row.required_age, 18);
    assert.deepEqual(row.content_descriptors, [3]);
    assert.equal(row.age_ratings.esrb.rating, 'AO');
    assert.equal(row.adult_flag, true);
    assert.ok(row.steam_checked_at, '应写游标');

    // 已判定且未过期的不会被重新选取；过期 30 天后重新可选
    assert.equal((await db.listSteamStatusCandidates(q, { limit: 10 })).length, 0);
    await q("update games set steam_checked_at = now() - interval '31 days' where steam_appid = 2001");
    const again = await db.listSteamStatusCandidates(q, { limit: 10 });
    assert.equal(again.length, 1, '过期 30 天后重新进入候选');
  } finally {
    await store.close();
  }
});

test('前台成人过滤：adult=hide 时 adult_flag 的游戏不出现在列表与详情', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    // 列表查询要求有 daily_prices 记录，先造两款游戏 + 平台 + 日价
    await q("insert into games (steam_appid, name, adult_flag, is_free) values (3001, '正常', false, false), (3002, '成人', true, false)");
    await q("insert into platforms (code, name, kind) values ('steam','Steam 国区','official') on conflict do nothing");
    for (const appid of [3001, 3002]) {
      await q("insert into offers (game_id, platform_code, product_type, region, currency, price_cents) select id, 'steam', 'official_direct', 'cn', 'CNY', 1000 from games where steam_appid = $1", [appid]);
      await q("insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) select id, 'steam', 'cn', current_date, 1000, 'CNY' from games where steam_appid = $1", [appid]);
      const gid = (await q('select id from games where steam_appid = $1', [appid])).rows[0].id;
      // AV 批：原始 SQL 种价不进读模型，手动刷新
      await db.refreshGameRegionPrices(q, gid);
      await db.refreshGameRegionHist(q, gid);
    }
    const hide = await db.gameSearch(q, { region: 'cn', adult: 'hide' });
    assert.equal(hide.total, 1, 'hide 时成人不可见');
    assert.equal(hide.rows[0].steam_appid, 3001);
    const badge = await db.gameSearch(q, { region: 'cn', adult: 'badge' });
    assert.equal(badge.total, 2, 'badge 时成人可见');
    const detailHidden = await db.gameDetail(q, { steamAppid: 3002, region: 'cn', adult: 'hide' });
    assert.equal(detailHidden, null, 'hide 时详情也 404');
    const detailShown = await db.gameDetail(q, { steamAppid: 3002, region: 'cn', adult: 'show' });
    assert.equal(detailShown.adult_flag, true);
  } finally {
    await store.close();
  }
});

// ---------------------------------------------------------------- V 批：applySteamDetails 共用函数
// docs/STEAM-SYNC-STATUS-AND-RATING.md §14.3/§14.3.1：backfill 与 steam-status 同口径的写/不写分支。

test('entryFromMeta：从归一化 meta 还原判定条目（价格/免费/未发售/判定不了）', () => {
  assert.deepEqual(entryFromMeta(null), null);
  assert.equal(entryFromMeta({ isFree: true }).data.is_free, true);
  assert.ok(entryFromMeta({ priceOverview: { final: 9900 } }).data.price_overview);
  assert.ok(entryFromMeta({ comingSoon: true }).data.release_date.coming_soon);
  assert.equal(entryFromMeta({ name: '只有名字' }), null, '没有判定依据时返回 null');
});

test('applySteamDetails：有状态+分级 → 全写（含 steam_checked_at 游标）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q("insert into games (steam_appid, name, is_free) values (4001, '判定X', false)");
    const meta = normalizeOfficial(4001, {
      name: '判定X',
      price_overview: { final: 9900, initial: 9900, currency: 'CNY' },
      required_age: '18',
      content_descriptors: { ids: [3] },
      ratings: { esrb: { rating: 'AO' } },
    });
    const outcome = await applySteamDetails(q, { appid: 4001, cnEntry: entryFromMeta(meta), meta });
    assert.equal(outcome.status, 'ok');
    assert.equal(outcome.rating.adultFlag, true);
    assert.equal(outcome.wroteStatus, true);
    const row = (await q('select steam_status, steam_checked_at, required_age, adult_flag from games where steam_appid = 4001')).rows[0];
    assert.equal(row.steam_status, 'ok');
    assert.ok(row.steam_checked_at, '游标应推进');
    assert.equal(row.required_age, 18);
    assert.equal(row.adult_flag, true);
  } finally {
    await store.close();
  }
});

test('applySteamDetails：拿不到状态且无分级 → 不写库不推游标（GetItems 路径）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q("insert into games (steam_appid, name, is_free) values (4002, 'GetItems-only', false)");
    // GetItems 条目：有名字/价格字段但无分级字段、entryFromMeta 也判定不了（比如价格在 priceCents 而不是 priceOverview）
    const meta = { steamAppid: 4002, nameZh: 'GetItems-only', priceCents: 9900, source: 'getitems' };
    const outcome = await applySteamDetails(q, { appid: 4002, cnEntry: entryFromMeta(meta), meta });
    assert.equal(outcome.status, null);
    assert.equal(outcome.wroteStatus, false, '不推游标');
    const row = (await q('select steam_status, steam_checked_at, required_age from games where steam_appid = 4002')).rows[0];
    assert.equal(row.steam_status, null);
    assert.equal(row.steam_checked_at, null, 'steam-status 下次仍会选中它');
    assert.equal(row.required_age, null);
  } finally {
    await store.close();
  }
});

test('applySteamDetails：分级本次没拿到 → 不覆盖已有值；重复跑幂等', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q("insert into games (steam_appid, name, is_free) values (4003, '保留分级', false)");
    // 第一次：有完整分级
    await applySteamDetails(q, {
      appid: 4003,
      cnEntry: { success: true, data: { price_overview: { final: 9900 } } },
      meta: normalizeOfficial(4003, { name: '保留分级', required_age: '18', content_descriptors: { ids: [3] }, ratings: {} }),
    });
    // 第二次：只有状态、分级字段全空（如 GetItems 回退混入）→ 不覆盖
    const second = await applySteamDetails(q, {
      appid: 4003,
      cnEntry: { success: true, data: { price_overview: { final: 8800 } } },
      meta: { steamAppid: 4003, source: 'getitems' },
    });
    assert.equal(second.status, 'ok');
    const row = (await q('select required_age, content_descriptors, adult_flag from games where steam_appid = 4003')).rows[0];
    assert.equal(row.required_age, 18, '已有分级不被 null 覆盖');
    assert.deepEqual(row.content_descriptors, [3]);
    assert.equal(row.adult_flag, true, '派生标记也不被覆盖');
  } finally {
    await store.close();
  }
});

// ---------------------------------------------------------------- AB 批（docs/STEAM-STATUS-FIX.md）

test('applySteamDetails：appid 不在库 → 写入未命中，wroteStatus=false（不可静默，§3-B）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    const outcome = await applySteamDetails(q, {
      appid: 999001,
      cnEntry: { success: true, data: { price_overview: { final: 9900 } } },
      meta: null,
    });
    assert.equal(outcome.status, 'ok');
    assert.equal(outcome.wroteStatus, false, 'UPDATE 未命中行不得算写成功');
  } finally {
    await store.close();
  }
});

test('applySteamDetails：descriptorIds 空数组 / 空 ratings 不得清空已有分级（§2.5-5）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q("insert into games (steam_appid, name, is_free) values (4004, '空数组覆盖', false)");
    await applySteamDetails(q, {
      appid: 4004,
      cnEntry: { success: true, data: { price_overview: { final: 9900 } } },
      meta: normalizeOfficial(4004, { name: '空数组覆盖', content_descriptors: { ids: [3] }, ratings: { esrb: { rating: 'AO' } } }),
    });
    // 第二次：hasRating 由 requiredAge 触发，但 descriptors 为空数组、ratings 为空对象
    // → coalesce 只挡 null，空数组/空对象会覆盖已有值，AB 批改为与 null 同等对待
    await applySteamDetails(q, {
      appid: 4004,
      cnEntry: { success: true, data: { price_overview: { final: 8800 } } },
      meta: normalizeOfficial(4004, { name: '空数组覆盖', required_age: '16', ratings: {} }),
    });
    const row = (await q('select content_descriptors, age_ratings, required_age from games where steam_appid = 4004')).rows[0];
    assert.deepEqual(row.content_descriptors, [3], '空数组不得清空已有 content_descriptors');
    assert.equal(row.age_ratings.esrb.rating, 'AO', '空对象不得清空已有 age_ratings');
    assert.equal(row.required_age, 16, '有值的字段正常更新');
  } finally {
    await store.close();
  }
});

test('runSteamStatusRound：取 .json、无条目不写库、4xx 继续、429 立即收轮（§3-A/B/C）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q("insert into games (steam_appid, name, is_free) values (5001,'有价',false),(5002,'无条目',false),(5003,'4xx',false),(5004,'429',false)");
    const fakeFetch = async (url) => {
      if (url.includes('5004')) {
        const e = new Error('rate limited');
        e.status = 429;
        throw e;
      }
      if (url.includes('5003')) {
        const e = new Error('not found');
        e.status = 404;
        throw e;
      }
      if (url.includes('5002')) return { json: {} }; // 响应里没有该 appid 条目 → cnEntry=null
      // 5001：cn 有价（不再请求 hk）
      return { json: { 5001: { success: true, data: { name: '有价', price_overview: { final: 9900, initial: 9900, currency: 'CNY', discount_percent: 0 } } } } };
    };
    const r = await runSteamStatusRound(q, { limit: 4, rateMs: 0, fetchJsonImpl: fakeFetch });
    assert.equal(r.wrote, 1, '只有 5001 真正写库');
    assert.equal(r.skipped, 1, '5002 无条目 → skip_write 不计入写入');
    assert.equal(r.failed, 2, '5003(404) 与 5004(429) 都计失败');
    assert.equal(r.attempted, 4);
    assert.equal(r.aborted429, true, '429 立即收轮');
    assert.equal(r.counts.ok, 1, 'counts 只统计已知状态');
    const ok = (await q('select steam_status, steam_checked_at from games where steam_appid = 5001')).rows[0];
    assert.equal(ok.steam_status, 'ok');
    assert.ok(ok.steam_checked_at, '写入才推游标');
    const miss = (await q('select steam_status, steam_checked_at from games where steam_appid = 5002')).rows[0];
    assert.equal(miss.steam_status, null, '无条目的 appid 不写库不推游标');
    assert.equal(miss.steam_checked_at, null);
  } finally {
    await store.close();
  }
});

test('AC-2/AC8：判定 ok（国区有价）→ 顺带写首次 offer；锁区/无价/免费不写价', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q("insert into games (steam_appid, name, is_free) values (6001, '有价A', false), (6002, '锁区B', false), (6003, '无价C', false), (6004, '免费D', true)");
    // 有价 → 状态 ok + offer 落库
    const metaOk = normalizeOfficial(6001, { name: '有价A', price_overview: { final: 6534, initial: 9900, currency: 'CNY', discount_percent: 34 } });
    const okOut = await applySteamDetails(q, { appid: 6001, cnEntry: entryFromMeta(metaOk), meta: metaOk });
    assert.equal(okOut.status, 'ok');
    assert.equal(okOut.offerWritten, true, 'ok 顺带写价');
    const offer = (await q("select price_cents, original_cents, discount_pct, currency, region from offers o join games g on g.id = o.game_id where g.steam_appid = 6001")).rows[0];
    assert.equal(offer.price_cents, 6534, '价格用国区 final');
    assert.equal(offer.original_cents, 9900);
    assert.equal(offer.discount_pct, 34);
    assert.equal(offer.currency, 'CNY');
    assert.equal(offer.region, 'cn');
    // 锁区（cn 无条目、hk 有价）→ 状态 region_locked，不写价
    const metaHk = normalizeOfficial(6002, { name: '锁区B', price_overview: { final: 9900, currency: 'CNY' } });
    const lockedOut = await applySteamDetails(q, { appid: 6002, cnEntry: null, hkEntry: entryFromMeta(metaHk), meta: metaHk });
    assert.equal(lockedOut.status, 'region_locked');
    assert.equal(lockedOut.offerWritten, false, '锁区不写价');
    // ok 但无 price_overview（字段缺失）→ 不写价
    const noPriceOut = await applySteamDetails(q, { appid: 6003, cnEntry: { success: true, data: { price_overview: { final: 1 } } }, meta: normalizeOfficial(6003, { name: '无价C' }) });
    assert.equal(noPriceOut.status, 'ok');
    assert.equal(noPriceOut.offerWritten, false, '没有价格信息不写价');
    // 免费 → 状态 free，不写价
    const freeOut = await applySteamDetails(q, { appid: 6004, cnEntry: { success: true, data: { is_free: true } }, meta: normalizeOfficial(6004, { name: '免费D', is_free: true }) });
    assert.equal(freeOut.status, 'free');
    assert.equal(freeOut.offerWritten, false);
    // 只写了 6001 一条 offer
    const total = (await q('select count(*)::int as n from offers')).rows[0].n;
    assert.equal(total, 1, '只有 ok+有价的游戏写了 offer');
    // 幂等：再跑一次不重复插入（fingerprint 相同 → unchanged）
    await applySteamDetails(q, { appid: 6001, cnEntry: entryFromMeta(metaOk), meta: metaOk });
    assert.equal((await q('select count(*)::int as n from offers')).rows[0].n, 1, '重复判定不重复写价');
  } finally {
    await store.close();
  }
});
