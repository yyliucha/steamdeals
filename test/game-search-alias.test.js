// DS 批（docs/SEARCH-ALIASES.md §6 验收）：搜索全自动派生（零人工）集成测试。
// 锁住的约束：
//   1) gta6 / GTA VI / gta 6 命中 Grand Theft Auto VI（缩写 + 罗马数字派生）；原名直接命中排最前（分级排序）；
//   2) xdlc6 / xia dao lie che shou 6 命中 侠盗猎车手6（拼音派生）；portal ii 命中 Portal 2（罗马双向）；
//   3) 拼错（gtaa6）：主查询零命中 → pglite 无 pg_trgm 时模糊兜底整体跳过（不抛错、返回空、记 search.miss）；
//   4) 写入路径顺带生成（upsertGameMeta/ensureGame），名字覆盖保护下 token 跟随最终名字；增量重建可恢复；
//   5) 反向自检：清空某游戏 search_tokens 后 gta6 用例必红（不返回它）；
//   6) 零人工：代码无 manual_aliases、无「别名管理」后台入口（grep 断言）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  return { store, q };
}

/** 种一款游戏 + 官方报价 + 日价 + 快照刷新（读模型口径，与 game-search-read-model 一致）。 */
async function addGame(q, { appid, name = null, nameEn = null, heat = 50 }) {
  const r = await q(
    `insert into games (steam_appid, name, name_en, heat, release_date, is_free)
     values ($1, $2, $3, $4, '2024-01-01', false) returning id`,
    [appid, name, nameEn, heat],
  );
  const id = Number(r.rows[0].id);
  await q(`insert into platforms (code, name, kind) values ('steam', 'Steam 国区', 'official') on conflict do nothing`);
  await q(
    `insert into offers (game_id, platform_code, product_type, region, currency, price_cents, original_cents, discount_pct, in_stock)
     values ($1, 'steam', 'official_direct', 'cn', 'CNY', 10000, 10000, 0, true)`,
    [id],
  );
  await q(
    `insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency)
     values ($1, 'steam', 'cn', current_date, 10000, 'CNY')`,
    [id],
  );
  await db.refreshGameRegionPrices(q, id);
  await db.refreshGameRegionHist(q, id);
  return id;
}

/** 与生产写入路径同源：ensureGame（目录导入）/ upsertGameMeta（回填/改名）。 */
async function seedViaUpsert(q, { appid, name, nameEn, heat = 50 }) {
  await db.upsertGameMeta(q, { steamAppid: appid, nameZh: name, nameEn, appType: 'game', isFree: false });
  return addGamePriceData(q, appid, heat);
}

async function addGamePriceData(q, appid, heat = 50) {
  const r = await q('select id from games where steam_appid = $1', [appid]);
  const id = Number(r.rows[0].id);
  await q('update games set heat = $2, release_date = $3 where id = $1', [id, heat, '2024-01-01']);
  await q(`insert into platforms (code, name, kind) values ('steam', 'Steam 国区', 'official') on conflict do nothing`);
  await q(
    `insert into offers (game_id, platform_code, product_type, region, currency, price_cents, original_cents, discount_pct, in_stock)
     values ($1, 'steam', 'official_direct', 'cn', 'CNY', 10000, 10000, 0, true)`,
    [id],
  );
  await q(
    `insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency)
     values ($1, 'steam', 'cn', current_date, 10000, 'CNY')`,
    [id],
  );
  await db.refreshGameRegionPrices(q, id);
  await db.refreshGameRegionHist(q, id);
  return id;
}

async function seedMixed(q) {
  // 前两个走 upsertGameMeta（真实写入路径生成 token）；后两个模拟迁移后的存量行（手动补 token）
  await seedViaUpsert(q, { appid: 9101, name: null, nameEn: 'Grand Theft Auto VI', heat: 90 });
  await seedViaUpsert(q, { appid: 9102, name: 'GTA6 典藏版', nameEn: 'GTA6 Collection', heat: 50 });
  const xia = await addGame(q, { appid: 9103, name: '侠盗猎车手6', nameEn: null, heat: 30 });
  await db.refreshSearchTokens(q, { id: xia, name: '侠盗猎车手6', nameEn: null });
  const portal = await addGame(q, { appid: 9104, name: '传送门2', nameEn: 'Portal 2', heat: 20 });
  await db.refreshSearchTokens(q, { id: portal, name: '传送门2', nameEn: 'Portal 2' });
  const civ = await addGame(q, { appid: 9105, name: '文明6', nameEn: 'Civilization VI', heat: 40 });
  await db.refreshSearchTokens(q, { id: civ, name: '文明6', nameEn: 'Civilization VI' });
  return { gta: 9101, named: 9102, xia: 9103, portal: 9104, civ: 9105 };
}

const idsOf = (r) => r.rows.map((x) => Number(x.steam_appid));

test('验收 1：gta6 / GTA VI / gta 6 命中 Grand Theft Auto VI，原名直接命中排最前', async () => {
  const { store, q } = await fresh();
  try {
    await seedMixed(q);
    for (const kw of ['gta6', 'GTA VI', 'gta 6', 'GTAVI']) {
      const r = await db.gameSearch(q, { keyword: kw });
      const ids = idsOf(r);
      assert.ok(ids.includes(9101), `搜「${kw}」应命中 Grand Theft Auto VI，实际 ${JSON.stringify(ids)}`);
      // 分级排序：原名直接命中（GTA6 典藏版 rank 0）必须在 token 命中（Grand Theft Auto VI rank 1）之前
      if (kw === 'gta6' || kw === 'gta 6') {
        assert.equal(ids[0], 9102, `搜「${kw}」原名直接命中应排最前，实际 ${JSON.stringify(ids)}`);
      }
    }
  } finally {
    await store.close();
  }
});

test('验收 2：xdlc6 / xia dao lie che shou 6 / xdlcs6 命中侠盗猎车手6（拼音派生）', async () => {
  const { store, q } = await fresh();
  try {
    await seedMixed(q);
    for (const kw of ['xdlc6', 'xia dao lie che shou 6', 'xdlcs6', 'xiadaoliecheshou']) {
      const r = await db.gameSearch(q, { keyword: kw });
      const ids = idsOf(r);
      assert.ok(ids.includes(9103), `搜「${kw}」应命中侠盗猎车手6，实际 ${JSON.stringify(ids)}`);
    }
  } finally {
    await store.close();
  }
});

test('罗马数字双向：portal ii / portal2 命中 Portal 2；vi 查询命中 Civilization VI', async () => {
  const { store, q } = await fresh();
  try {
    await seedMixed(q);
    for (const kw of ['portal ii', 'portal 2']) {
      const r = await db.gameSearch(q, { keyword: kw });
      assert.ok(idsOf(r).includes(9104), `搜「${kw}」应命中 Portal 2`);
    }
    const vi = await db.gameSearch(q, { keyword: 'civilization vi' });
    assert.ok(idsOf(vi).includes(9105), '搜 civilization vi 应命中 Civilization VI');
  } finally {
    await store.close();
  }
});

test('验收 3（pglite 降级分支）：gtaa6 拼错——主查询零命中、无 trgm 环境不抛错、记 search.miss', async () => {
  const { store, q } = await fresh();
  try {
    await seedMixed(q);
    const events = [];
    const logger = { info: (event, fields) => events.push({ event, fields }) };
    const r = await db.gameSearch(q, { keyword: 'gtaa6' }, logger);
    assert.equal(r.total, 0, 'gtaa6 在无 pg_trgm 环境应返回空（模糊兜底整体跳过）');
    assert.notEqual(r.matchedBy, 'fuzzy');
    const miss = events.find((e) => e.event === 'search.miss');
    assert.ok(miss, '零命中必须记 search.miss 日志');
    assert.equal(miss.fields.kw, 'gtaa6');
    assert.ok(Array.isArray(miss.fields.tokens) && miss.fields.tokens.length > 0, 'miss 日志带派生 token');
  } finally {
    await store.close();
  }
});

test('验收 5（反向自检）：清空 Grand Theft Auto VI 的 search_tokens 后 gta6 必不命中它；增量重建恢复', async () => {
  const { store, q } = await fresh();
  try {
    await seedMixed(q);
    const before = await db.gameSearch(q, { keyword: 'gta6' });
    assert.ok(idsOf(before).includes(9101), '对照：清空前 gta6 命中 GTA VI');
    const gtaRow = await q(`select id from games where steam_appid = 9101`);
    await q(`update games set search_tokens = '{}', search_tokens_at = null where id = $1`, [Number(gtaRow.rows[0].id)]);
    const after = await db.gameSearch(q, { keyword: 'gta6' });
    assert.ok(!idsOf(after).includes(9101), '清空 tokens 后 gta6 不得再命中 GTA VI（反向自检）');
    // 增量重建：updated_at > search_tokens_at（null）→ 重算恢复
    const rb = await db.rebuildSearchTokens(q, { limit: 100 });
    assert.ok(rb.processed >= 1 && rb.written >= 1, `增量重建应处理并写入：${JSON.stringify(rb)}`);
    const restored = await db.gameSearch(q, { keyword: 'gta6' });
    assert.ok(idsOf(restored).includes(9101), '重建后 gta6 恢复命中 GTA VI');
    // 收敛：再跑一轮没有新活
    const again = await db.rebuildSearchTokens(q, { limit: 100 });
    assert.equal(again.processed, 0, 'token 已最新时增量重建应秒退（processed=0）');
  } finally {
    await store.close();
  }
});

test('验收 4：写入路径顺带生成——upsertGameMeta 覆盖保护下 token 跟随最终名字', async () => {
  const { store, q } = await fresh();
  try {
    // 目录导入：机器英文名进 name
    const created = await db.upsertGameMeta(q, { steamAppid: 9201, nameZh: 'Grand Theft Auto VI', nameEn: null });
    let row = (await q('select name, name_en, search_tokens from games where id = $1', [created.id])).rows[0];
    assert.ok(Array.isArray(row.search_tokens) && row.search_tokens.includes('gtavi'), '新写入行顺带生成缩写组合 token');
    // 改名：官方简中进来，英文名挪进 name_en——token 必须跟着最终名字重算
    await db.upsertGameMeta(q, { steamAppid: 9201, nameZh: '侠盗猎车手6', nameEn: null });
    row = (await q('select name, name_en, search_tokens from games where id = $1', [created.id])).rows[0];
    assert.equal(row.name, '侠盗猎车手6');
    assert.equal(row.name_en, 'Grand Theft Auto VI');
    assert.ok(row.search_tokens.includes('gtavi'), '改名后保留英文缩写组合');
    assert.ok(row.search_tokens.includes('xdlcs6'), '改名后带中文拼音组合（token 与最终名字一致）');
    // 覆盖保护：再传机器英文名不得覆盖中文名，token 不变
    const t0 = row.search_tokens;
    await db.upsertGameMeta(q, { steamAppid: 9201, nameZh: 'Grand Theft Auto VI', nameEn: null });
    row = (await q('select name, search_tokens from games where id = $1', [created.id])).rows[0];
    assert.equal(row.name, '侠盗猎车手6', '覆盖保护：中文名不被英文名冲掉');
    assert.deepEqual(row.search_tokens, t0, '覆盖保护下 token 不变');
    // ensureGame（catalog 导入路径）同样带 token
    const eg = await db.ensureGame(q, { steamAppid: 9202, name: 'Portal 2', nameEn: 'Portal 2' });
    const egRow = (await q('select search_tokens from games where id = $1', [eg.id])).rows[0];
    assert.ok(egRow.search_tokens.includes('portalii'), 'ensureGame 新行带罗马数字组合 token');
  } finally {
    await store.close();
  }
});

test('验收 6（零人工）：代码无 manual_aliases、无「别名管理」后台入口；match.js 不读别名', async () => {
  const pg = readFileSync(`${ROOT}/src/store/pg.js`, 'utf8');
  const server = readFileSync(`${ROOT}/src/server.js`, 'utf8');
  assert.ok(!/manual_aliases|manualAliases/i.test(pg), 'pg.js 不得出现 manual_aliases（零人工方案）');
  assert.ok(!/manual_aliases|manualAliases/i.test(server), 'server.js 不得出现 manual_aliases');
  assert.ok(!/别名管理|搜索别名/.test(server), '后台不得有「别名管理/搜索别名」人工入口');
  const match = readFileSync(`${ROOT}/src/match.js`, 'utf8');
  assert.ok(!/search_tokens/.test(match), '对齐匹配（match.js）不读派生 token');
});

test('回归：纯数字 AppID 搜索与后台 gameKeywordSql 退化路径不受影响', async () => {
  const { store, q } = await fresh();
  try {
    await seedMixed(q);
    const byAppid = await db.gameSearch(q, { keyword: '9101' });
    assert.equal(idsOf(byAppid)[0], 9101, '纯数字关键词仍按 AppID 精确命中');
    const adminSql = db.gameKeywordSql('$1', { appidAsText: true });
    const n = (await q(`select count(*)::int as n from games g where ${adminSql}`, ['gta6'])).rows[0].n;
    assert.equal(n, 2, '后台搜索（gameKeywordSql 默认 token 子串路径）同口径命中');
    // READ_MODEL=legacy 回滚开关下同样命中
    process.env.READ_MODEL = 'legacy';
    try {
      const legacy = await db.gameSearch(q, { keyword: 'xdlc6' });
      assert.ok(idsOf(legacy).includes(9103), 'legacy 回滚路径同样命中拼音派生');
    } finally {
      delete process.env.READ_MODEL;
    }
  } finally {
    await store.close();
  }
});

test('迁移：search_tokens 列与 GIN 索引在迁移清单里（pglite 建列成功、GIN 跳过不中断）', async () => {
  const pg = readFileSync(`${ROOT}/src/store/pg.js`, 'utf8');
  assert.ok(/add column if not exists search_tokens text\[\]/.test(pg), '迁移含 search_tokens 列');
  assert.ok(/games_search_tokens_gin on games using gin \(search_tokens\)/.test(pg), '迁移含 GIN 索引');
  const { store, q } = await fresh();
  try {
    const r = await q(`select column_name from information_schema.columns where table_name = 'games' and column_name = 'search_tokens'`);
    assert.equal(r.rows.length, 1, 'pglite 迁移后 search_tokens 列存在');
  } finally {
    await store.close();
  }
});
