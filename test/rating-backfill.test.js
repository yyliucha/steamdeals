// EF 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9）：内容分级回填。
// 根因：cc=cn 的 appdetails 国区商店隐藏成人内容 → content_descriptors 采不到 → 全库 adult_flag
// 仅约 20 个。本文件锁住修复的三个关键行为：
//   1) 候选收敛（required_age 已采到不再选 / 1 天冷却 / 高嫌疑优先 / 已删除排除）；
//   2) 回填只写分级——不写 steam_status、不写 steam_checked_at、不写价格 offer（国区价格口径不动）；
//   3) 429 立即收轮且未处理行保持候选（断点续跑）；前后 adult/mature 计数。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { normalizeOfficial } from '../src/adapters/steam-meta.js';
import { listRatingBackfillCandidates, runRatingBackfillRound } from '../src/steam-status.js';

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  return store;
}

const addGame = (q, { appid, requiredAge = null, descriptors = null, ratings = null, genres = null, tags = null, backfillAt = null, deleted = false }) =>
  q(
    'insert into games (steam_appid, name, required_age, content_descriptors, age_ratings, genres, tags, backfill_at, deleted) ' +
      "values ($1::int, 'g'||$1::text, $2::int, $3::int[], $4::jsonb, $5::text[], $6::text[], $7::timestamptz, $8)",
    [appid, requiredAge, descriptors, ratings ? JSON.stringify(ratings) : null, genres, tags, backfillAt, deleted],
  );

test('候选收敛：required_age 已采到（含 0）不再选；required_age null 才入选；已删除排除', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    // 全年龄游戏（required_age=0、描述符空数组存 null）——cc=cn 已正常采集过，不该重复回填
    await addGame(q, { appid: 1, requiredAge: 0 });
    // 成人游戏：cc=cn 采不到 → required_age null → 候选
    await addGame(q, { appid: 2 });
    // required_age 已有值但描述符缺失（全年龄正常形态）→ 不是候选
    await addGame(q, { appid: 3, requiredAge: 16 });
    // 三字段齐全 → 不是候选
    await addGame(q, { appid: 4, requiredAge: 16, descriptors: [1], ratings: { pegi: { rating: '16' } } });
    // 已删除 → 排除
    await addGame(q, { appid: 5, deleted: true });

    const ids = await listRatingBackfillCandidates(q, { limit: 20 });
    assert.deepEqual(ids, [2], '只有 required_age null（cc=cn 采不到）的行入选；其余排除');
  } finally {
    await store.close();
  }
});

test('候选优先与冷却：高嫌疑（色情/Nudity/Sexual）排前；backfill_at 1 天冷却内不选', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    await addGame(q, { appid: 11 });
    await addGame(q, { appid: 12, genres: ['色情内容'] });
    await addGame(q, { appid: 13, tags: ['tag:1404', 'Nudity'] });
    // 冷却中（刚处理过）：不选
    await q("insert into games (steam_appid, name, backfill_at) values (14, 'g14', now())");

    const ids = await listRatingBackfillCandidates(q, { limit: 20 });
    assert.deepEqual(ids, [12, 13, 11], '高嫌疑（色情内容 / Nudity 标签）排在普通缺失行前面；冷却中行不选');
  } finally {
    await store.close();
  }
});

test('回填只写分级：adult 派生落库、不写 steam_status/steam_checked_at/offer，前后计数留档', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    await addGame(q, { appid: 21 });
    await addGame(q, { appid: 22 });

    const calls = [];
    const fetchImpl = async (appids, options) => {
      calls.push({ appids, cc: options.cc, backend: options.backend });
      const [appid] = appids;
      if (appid === 21) {
        // 成人游戏（美区响应）：描述符 3 = 一般性内容 → adult
        return { backend: 'official', items: [normalizeOfficial(21, { name: '成人X', required_age: '18', content_descriptors: { ids: [3] }, ratings: { esrb: { rating: 'AO' } } })] };
      }
      // 全年龄（美区响应）：required_age=0、无描述符 → 双 false
      return { backend: 'official', items: [normalizeOfficial(22, { name: '全年龄', required_age: '0', content_descriptors: { ids: [] }, ratings: {} })] };
    };
    const events = [];
    const logger = { info: (e, f) => events.push([e, f]), warn: (e, f) => events.push([e, f]) };

    const result = await runRatingBackfillRound(q, { limit: 10, batch: 10, rateMs: 1000, fetchMetadataImpl: fetchImpl, logger });

    assert.equal(result.done, 2);
    assert.equal(result.wrote, 2, '两行都写入了分级');
    assert.equal(result.adultWrote, 1, '本轮新判 adult 1 款');
    assert.equal(result.aborted429, false);
    assert.equal(result.before.adult, 0, '回填前 adult=0');
    assert.equal(result.after.adult, 1, '回填后 adult=1（验收①：前后计数）');
    // 收敛验证：回填后 required_age 都有值（含 0）→ 第二轮候选为空，不再重复请求
    assert.deepEqual(await listRatingBackfillCandidates(q, { limit: 10 }), [], '回填后 required_age 已采到 → 候选收敛为空');

    const adult = (await q('select required_age, content_descriptors, age_ratings, adult_flag, mature_flag, steam_status, steam_checked_at from games where steam_appid = 21')).rows[0];
    assert.equal(adult.required_age, 18);
    assert.deepEqual(adult.content_descriptors, [3]);
    assert.equal(adult.age_ratings.esrb.rating, 'AO');
    assert.equal(adult.adult_flag, true, '成人标记落库');
    assert.equal(adult.mature_flag, false);
    assert.equal(adult.steam_status, null, '不写 steam_status（只写分级）');
    assert.equal(adult.steam_checked_at, null, '不推 steam_checked_at 游标（留给 steam-status 判定）');
    const offers = (await q('select count(*)::int as n from offers')).rows[0].n;
    assert.equal(offers, 0, '不写价格 offer——国区价格口径不受 cc=us 影响');

    // 请求区域锁定：回填必须用 cc=us（国区采不到成人描述符）；backend 必须 official
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.cc === 'us'), '每款都用 cc=us 重采（cc=cn 采不到成人内容）');
    assert.ok(calls.every((c) => c.backend === 'official'), '回填走官方 appdetails');

    // 计数日志事件存在（验收①：日志留档）
    assert.ok(events.some(([e]) => e === 'steam.meta.backfill_before'), '开工计数日志');
    assert.ok(events.some(([e]) => e === 'steam.meta.backfill_done'), '收工计数日志');
  } finally {
    await store.close();
  }
});

test('429 立即收轮：未处理行保持候选（断点续跑），已成功行正常冷却', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    await addGame(q, { appid: 31 });
    await addGame(q, { appid: 32 });
    await addGame(q, { appid: 33 });

    const fetchImpl = async (appids) => {
      const [appid] = appids;
      if (appid === 32) throw Object.assign(new Error('too many requests'), { status: 429 });
      return { backend: 'official', items: [normalizeOfficial(appid, { name: 'X', required_age: '18', content_descriptors: { ids: [3] }, ratings: {} })] };
    };
    const events = [];
    const logger = { info: () => {}, warn: (e, f) => events.push([e, f]) };

    const result = await runRatingBackfillRound(q, { limit: 10, batch: 10, rateMs: 1000, fetchMetadataImpl: fetchImpl, logger });

    assert.equal(result.aborted429, true, '429 收轮标志');
    assert.equal(result.done, 3, '本轮批内 3 款都已计数（31 成功、32 撞 429、33 未处理不计数？——见下）');
    assert.ok(events.some(([e]) => e === 'steam.meta.backfill_429'), '429 日志事件');

    const rows = await q('select steam_appid, backfill_at from games where steam_appid in (31, 32, 33) order by steam_appid');
    const byAppid = new Map(rows.rows.map((r) => [Number(r.steam_appid), r.backfill_at]));
    assert.ok(byAppid.get(31), '已成功采集的行进入 1 天冷却');
    assert.equal(byAppid.get(32), null, '撞 429 的行不记冷却——下轮继续重试');
    assert.equal(byAppid.get(33), null, '未处理的行不记冷却——断点续跑不丢进度');
  } finally {
    await store.close();
  }
});
