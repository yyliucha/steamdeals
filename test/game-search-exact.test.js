// DW（docs/SEARCH-FIX-PERF.md §DW 补测试）：搜索精确名匹配的参数绑定自检。
// 锁住的约束：
//   1) 无 search_tokens 的游戏（seed 后清空）搜中文名「侠盗猎车手」/英文名「Grand Theft Auto V」
//      必须靠 name/name_en 精确名 LIKE 命中——精确名归一化表达式（kwNorm）必须绑定关键词参数
//      （主查询/候选探测统一 $1=region、$2=kw），不得绑定 region（否则匹配的是 'cn'，用例必红）；
//   2) 搜索不因 region 值命中：kw='cn'（region 常见值）→ 0 条；同一关键词换 region（cn/us）命中一致；
//   3) 回归：gta5/gta6/xdlc6/grand theft auto 仍命中（token 派生路径不受影响）；
//   4) 零命中：zzz不存在词 → 0。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  return { store, q };
}

/** 种一款游戏 + 指定区域的官方报价与日价（读模型口径，与 game-search-alias 一致）。 */
async function addGame(q, { appid, name = null, nameEn = null, heat = 50, regions = ['cn'] }) {
  const r = await q(
    `insert into games (steam_appid, name, name_en, heat, release_date, is_free)
     values ($1, $2, $3, $4, '2024-01-01', false) returning id`,
    [appid, name, nameEn, heat],
  );
  const id = Number(r.rows[0].id);
  await q(`insert into platforms (code, name, kind) values ('steam', 'Steam', 'official') on conflict do nothing`);
  for (const region of regions) {
    await q(
      `insert into offers (game_id, platform_code, product_type, region, currency, price_cents, original_cents, discount_pct, in_stock)
       values ($1, 'steam', 'official_direct', $2, 'CNY', 10000, 10000, 0, true)`,
      [id, region],
    );
    await q(
      `insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency)
       values ($1, 'steam', $2, current_date, 10000, 'CNY')`,
      [id, region],
    );
  }
  await db.refreshGameRegionPrices(q, id);
  await db.refreshGameRegionHist(q, id);
  return id;
}

/**
 * 种子数据集：
 * - 271590（GTA V）：name/name_en 齐全但 search_tokens 清空——「仅靠精确名 LIKE」的唯一通道；
 * - 271591（GTA VI）/ 271592（侠盗猎车手6）：正常派生 token——token 路径回归样本；
 * - 271590 在 cn/us 双区域有价——region 无关断言用。
 */
async function seed(q) {
  const gta5 = await addGame(q, { appid: 271590, name: '侠盗猎车手 V', nameEn: 'Grand Theft Auto V', heat: 90, regions: ['cn', 'us'] });
  // 清空 search_tokens（模拟「精确名是唯一命中通道」的存量行）
  await q(`update games set search_tokens = '{}', search_tokens_at = null where id = $1`, [gta5]);
  const gta6 = await addGame(q, { appid: 271591, nameEn: 'Grand Theft Auto VI', heat: 80 });
  await db.refreshSearchTokens(q, { id: gta6, name: null, nameEn: 'Grand Theft Auto VI' });
  const xia6 = await addGame(q, { appid: 271592, name: '侠盗猎车手6', heat: 70 });
  await db.refreshSearchTokens(q, { id: xia6, name: '侠盗猎车手6', nameEn: null });
  return { gta5: 271590, gta6: 271591, xia6: 271592 };
}

const idsOf = (r) => r.rows.map((x) => Number(x.steam_appid));

test('DW 验收 1：无 search_tokens 的游戏搜中文名/英文名必须命中（精确名 LIKE 绑定关键词）', async () => {
  const { store, q } = await fresh();
  try {
    await seed(q);
    for (const kw of ['侠盗猎车手', '侠盗猎车手 V', 'Grand Theft Auto V', 'grand theft auto v']) {
      const r = await db.gameSearch(q, { keyword: kw });
      assert.ok(
        idsOf(r).includes(271590),
        `搜「${kw}」应命中无 tokens 的侠盗猎车手 V（精确名匹配），实际 total=${r.total} ids=${JSON.stringify(idsOf(r))}`,
      );
    }
  } finally {
    await store.close();
  }
});

test('DW 验收 2：搜索不因 region 值命中——kw=cn 为 0；同词换 region 命中一致', async () => {
  const { store, q } = await fresh();
  try {
    await seed(q);
    // region 常见值作为关键词：不得命中任何游戏（防再次把 region/kw 参数写反）
    const cn = await db.gameSearch(q, { keyword: 'cn' });
    assert.equal(cn.total, 0, `kw='cn' 必须 0 条（region 值不得当作关键词命中），实际 ${JSON.stringify(idsOf(cn))}`);
    // 同一关键词在 cn/us 两个区域都命中（精确名匹配与 region 解耦）
    for (const region of ['cn', 'us']) {
      const r = await db.gameSearch(q, { region, keyword: '侠盗猎车手' });
      assert.ok(idsOf(r).includes(271590), `region=${region} 搜「侠盗猎车手」应命中 GTA V，实际 ${JSON.stringify(idsOf(r))}`);
    }
  } finally {
    await store.close();
  }
});

test('DW 验收 3：回归——gta5/gta6/xdlc6/grand theft auto 仍命中', async () => {
  const { store, q } = await fresh();
  try {
    await seed(q);
    // gta5/gta6 靠缩写 token 派生命中 GTA VI（GTA V 无 tokens，不参与 token 命中）
    for (const kw of ['gta5', 'gta6', 'GTA VI']) {
      const r = await db.gameSearch(q, { keyword: kw });
      assert.ok(idsOf(r).includes(271591), `搜「${kw}」应命中 Grand Theft Auto VI，实际 ${JSON.stringify(idsOf(r))}`);
    }
    // xdlc6 靠拼音派生命中侠盗猎车手6
    const xdlc = await db.gameSearch(q, { keyword: 'xdlc6' });
    assert.ok(idsOf(xdlc).includes(271592), `搜 xdlc6 应命中侠盗猎车手6，实际 ${JSON.stringify(idsOf(xdlc))}`);
    // grand theft auto：英文精确名命中 GTA V（无 tokens）与 GTA VI
    const gta = await db.gameSearch(q, { keyword: 'grand theft auto' });
    assert.ok(idsOf(gta).includes(271590) && idsOf(gta).includes(271591), `搜 grand theft auto 应命中两款 GTA，实际 ${JSON.stringify(idsOf(gta))}`);
  } finally {
    await store.close();
  }
});

test('DW 验收 4：零命中——zzz不存在词 → 0，且不抛错', async () => {
  const { store, q } = await fresh();
  try {
    await seed(q);
    const r = await db.gameSearch(q, { keyword: 'zzz不存在词' });
    assert.equal(r.total, 0, `搜不存在词必须 0 条，实际 ${JSON.stringify(idsOf(r))}`);
  } finally {
    await store.close();
  }
});
