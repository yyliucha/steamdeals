// FT 批（docs/EXPLICIT-RATING.md）：成人内容分级细分——宽（adult_flag，3/4/AO）/ 严格（explicit_flag，4/AO）。
// 本文件锁住的行为：
//   1) classifyContentRating 的 explicitFlag 派生（descriptor 4 或 ESRB AO；2077=descriptor 3 只有 adult 没有 explicit）；
//   2) explicit 回填候选谓词（adult_flag=true 且 explicit_flag=false；1 天冷却；已删除/explicit 已判不选）；
//   3) explicit 回填只写分级与 explicit_flag——不写 steam_status/steam_checked_at/价格；
//      explicit=true 的行退出候选（收敛），false 的行靠 1 天冷却防空转；
//   4) rating=explicit 筛选（前台 /api/games/search 与后台 /api/admin/games 同一口径）只出 explicit；
//   5) adminGameStats 的 explicit 计数（色情游戏（严格）行）；
//   6) setSteamStatus 显式写 explicit_flag（false/true 显式写，null 不覆盖）。
// 反向自检：把 explicitFlag 判定改成 ids.includes(3) → 用例 1 红；候选谓词去掉 adult_flag → 用例 2 红；
// 回填不写 explicit_flag → 用例 3 红；rating=explicit 拼成 adult_flag → 用例 4 红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { classifyContentRating, normalizeOfficial } from '../src/adapters/steam-meta.js';
import { listExplicitBackfillCandidates, runExplicitBackfillRound } from '../src/steam-status.js';

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  return store;
}

test('FT：classifyContentRating 的 explicitFlag（严格）= descriptor 4 或 ESRB AO；2077（descriptor 3）不算', () => {
  // 2077 口径：descriptor 3 = 一般性内容 → 成人（宽）但非色情游戏
  assert.deepEqual(
    classifyContentRating({ descriptorIds: [3], ratings: { esrb: { rating: 'M' } } }),
    { adultFlag: true, explicitFlag: false, matureFlag: false },
    'descriptor 3 = 成人内容（宽）但不是色情游戏（2077 场景）',
  );
  // 纯色情游戏：descriptor 4
  assert.deepEqual(
    classifyContentRating({ descriptorIds: [4], ratings: {} }),
    { adultFlag: true, explicitFlag: true, matureFlag: false },
    'descriptor 4 = 色情游戏（严格）',
  );
  // ESRB AO
  assert.deepEqual(
    classifyContentRating({ descriptorIds: [], ratings: { esrb: { rating: 'AO' } } }),
    { adultFlag: true, explicitFlag: true, matureFlag: false },
    'ESRB AO = 色情游戏（严格）',
  );
  // 3+4 同时出现 → 两级都 true
  assert.deepEqual(
    classifyContentRating({ descriptorIds: [3, 4], ratings: {} }),
    { adultFlag: true, explicitFlag: true, matureFlag: false },
    'descriptor 3+4 = 成人且色情',
  );
});

test('FT：迁移后 games.explicit_flag 列存在且默认 false（幂等）', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    await db.migrate(store); // 二次执行幂等
    const cols = await q("select column_name, column_default from information_schema.columns where table_name = 'games' and column_name = 'explicit_flag'");
    assert.equal(cols.rows.length, 1, 'explicit_flag 列存在');
    assert.match(String(cols.rows[0].column_default ?? ''), /false/, '默认 false');
    await q("insert into games (steam_appid, name) values (7101, 'g7101')");
    const row = (await q('select explicit_flag from games where steam_appid = 7101')).rows[0];
    assert.equal(row.explicit_flag, false, '新行默认 false');
  } finally {
    await store.close();
  }
});

test('FT：explicit 回填候选 = adult_flag=true 且 explicit_flag=false（1 天冷却；已删除/未成人/已 explicit 不选）', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    // 成人但未判 explicit → 候选
    await q("insert into games (steam_appid, name, adult_flag, explicit_flag) values (7201, 'g7201', true, false)");
    // 已 explicit → 不选（收敛）
    await q("insert into games (steam_appid, name, adult_flag, explicit_flag) values (7202, 'g7202', true, true)");
    // 非成人 → 不选
    await q("insert into games (steam_appid, name, adult_flag, explicit_flag) values (7203, 'g7203', false, false)");
    // 冷却中（刚处理过）→ 不选
    await q("insert into games (steam_appid, name, adult_flag, explicit_flag, backfill_at) values (7204, 'g7204', true, false, now())");
    // 已删除 → 不选
    await q("insert into games (steam_appid, name, adult_flag, explicit_flag, deleted) values (7205, 'g7205', true, false, true)");

    const ids = await listExplicitBackfillCandidates(q, { limit: 20 });
    assert.deepEqual(ids, [7201], '只有 adult=true 且 explicit=false 且冷却期满的行入选');
  } finally {
    await store.close();
  }
});

test('FT：explicit 回填写 explicit_flag、不写 steam_status/steam_checked_at/offer，explicit=true 退出候选收敛', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    await q("insert into games (steam_appid, name, adult_flag, explicit_flag) values (7301, 'g7301', true, false), (7302, 'g7302', true, false)");

    const fetchImpl = async (appids) => {
      const [appid] = appids;
      if (appid === 7301) {
        // 纯色情游戏（美区响应）：descriptor 4 → explicit
        return { backend: 'official', items: [normalizeOfficial(7301, { name: '黄油X', required_age: '18', content_descriptors: { ids: [4] }, ratings: {} })] };
      }
      // 2077 型（美区响应）：descriptor 3 → 成人但非色情
      return { backend: 'official', items: [normalizeOfficial(7302, { name: '2077型', required_age: '18', content_descriptors: { ids: [3] }, ratings: { esrb: { rating: 'M' } } })] };
    };
    const events = [];
    const logger = { info: (e, f) => events.push([e, f]), warn: (e, f) => events.push([e, f]) };

    const result = await runExplicitBackfillRound(q, { limit: 10, batch: 10, rateMs: 1000, fetchMetadataImpl: fetchImpl, logger });

    assert.equal(result.done, 2);
    assert.equal(result.wrote, 2, '两行都写入了分级');
    assert.equal(result.explicitWrote, 1, '本轮新判 explicit 1 款');
    assert.equal(result.aborted429, false);
    assert.equal(result.before.explicit, 0, '回填前 explicit=0');
    assert.equal(result.after.explicit, 1, '回填后 explicit=1（验收③：前后计数）');

    const rows = (await q('select steam_appid, explicit_flag, adult_flag, mature_flag, steam_status, steam_checked_at from games where steam_appid in (7301, 7302) order by steam_appid')).rows;
    assert.deepEqual(
      rows.map((r) => [r.steam_appid, r.explicit_flag]),
      [[7301, true], [7302, false]],
      'descriptor 4 → explicit=true；descriptor 3 → explicit=false（2077 口径）',
    );
    for (const r of rows) {
      assert.equal(r.steam_status, null, '不写 steam_status（只写分级）');
      assert.equal(r.steam_checked_at, null, '不推 steam_checked_at 游标');
    }
    const offers = (await q('select count(*)::int as n from offers')).rows[0].n;
    assert.equal(offers, 0, '不写价格 offer——本位币价格口径不受 cc=us 影响');

    // 收敛：explicit=true 的行退出候选；false 的行在 1 天冷却内也不重选
    assert.deepEqual(await listExplicitBackfillCandidates(q, { limit: 10 }), [], '回填后（冷却期内）候选为空');
    // 冷却过期后：只剩 explicit=false 的行重新候选（次日重采幂等，descriptor 变更时能更新）
    await q("update games set backfill_at = now() - interval '2 days' where steam_appid in (7301, 7302)");
    assert.deepEqual(await listExplicitBackfillCandidates(q, { limit: 10 }), [7302], '冷却过期后只有 explicit=false 的行重入候选');

    // 日志留档
    assert.ok(events.some(([e]) => e === 'steam.meta.explicit_backfill_before'), '开工计数日志');
    assert.ok(events.some(([e]) => e === 'steam.meta.explicit_backfill_done'), '收工计数日志');
  } finally {
    await store.close();
  }
});

test('FT：setSteamStatus 显式写 explicit_flag（false/true 显式写，null 不覆盖）', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    await q("insert into games (steam_appid, name, adult_flag, explicit_flag) values (7401, 'g7401', true, false)");
    // null（无分级数据）→ 不覆盖
    await db.setSteamStatus(q, { steamAppid: 7401, status: 'ok', requiredAge: null, contentDescriptors: null, ageRatings: null });
    let row = (await q('select explicit_flag from games where steam_appid = 7401')).rows[0];
    assert.equal(row.explicit_flag, false, 'explicitFlag 传 null 不覆盖已有值');
    // 显式 true
    await db.setSteamStatus(q, { steamAppid: 7401, explicitFlag: true });
    row = (await q('select explicit_flag from games where steam_appid = 7401')).rows[0];
    assert.equal(row.explicit_flag, true, 'explicitFlag=true 显式写');
    // 显式 false（重新判定为 2077 型）
    await db.setSteamStatus(q, { steamAppid: 7401, explicitFlag: false });
    row = (await q('select explicit_flag from games where steam_appid = 7401')).rows[0];
    assert.equal(row.explicit_flag, false, 'explicitFlag=false 显式写');
  } finally {
    await store.close();
  }
});

test('FT：rating=explicit 前台列表筛选只出 explicit（读模型与 legacy 双口径）', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    await q("insert into games (steam_appid, name, adult_flag, explicit_flag, mature_flag) values (7501, '纯黄油', true, true, false), (7502, '2077型', true, false, false), (7503, '正常', false, false, false)");
    await q("insert into platforms (code, name, kind) values ('steam', 'Steam', 'official') on conflict (code) do nothing");
    for (const appid of [7501, 7502, 7503]) {
      await q("insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) select id, 'steam', 'cn', current_date, 1000, 'CNY' from games where steam_appid = " + appid);
      const gid = (await q('select id from games where steam_appid = ' + appid)).rows[0].id;
      // 读模型快照行（与 game-search-filter.test.js 同一 seed 口径）
      await db.refreshGameRegionPrices(q, gid);
      await db.refreshGameRegionHist(q, gid);
    }
    for (const legacy of [false, true]) {
      const prev = process.env.READ_MODEL;
      if (legacy) process.env.READ_MODEL = 'legacy'; else delete process.env.READ_MODEL;
      try {
        const r = await db.gameSearch(q, { region: 'cn', compact: true, adult: 'badge', rating: 'explicit' });
        assert.deepEqual(
          r.rows.map((x) => x.steam_appid),
          [7501],
          `${legacy ? 'legacy' : '读模型'}：rating=explicit 只出 explicit_flag（2077 型不出现）`,
        );
        const row = r.rows[0];
        assert.equal(row.explicit_flag, true, `${legacy ? 'legacy' : '读模型'}：响应带 explicit_flag（角标渲染前提）`);
      } finally {
        if (prev === undefined) delete process.env.READ_MODEL; else process.env.READ_MODEL = prev;
      }
    }
  } finally {
    await store.close();
  }
});

test('FT：后台 /api/admin/games 的 rating=explicit 筛选 + adminGameStats.explicit 计数', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    await q("insert into games (steam_appid, name, adult_flag, explicit_flag, mature_flag) values (7601, '黄油', true, true, false), (7602, '宽成人', true, false, false), (7603, '成熟', false, false, true), (7604, '普通', false, false, false)");
    const { adminGamesWhereParts, listAdminGames, adminGameStats } = await import('../src/store/admin-games-repository.js');
    const w = adminGamesWhereParts({ ratingParam: 'explicit' });
    assert.equal(w.ratingWhere, ' and g.explicit_flag', 'rating=explicit 拼成 explicit_flag 条件');
    const list = await listAdminGames(q, { ratingWhere: w.ratingWhere, pageSize: 20 });
    assert.deepEqual(list.rows.map((r) => r.name), ['黄油'], 'rating=explicit 只出色情游戏');
    assert.equal(list.rows[0].explicit_flag, true, '列表行带 explicit_flag');
    const s = await adminGameStats(q);
    assert.equal(s.adult, 2, '成人（宽）计数 = 2');
    assert.equal(s.explicit, 1, '色情游戏（严格）计数 = 1（explicit < adult）');
    assert.equal(s.mature, 1, '成熟计数 = 1');
  } finally {
    await store.close();
  }
});
