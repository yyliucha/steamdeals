// BL 批（docs/BACKFILL-THROUGHPUT.md）：回填候选去噪 / 进度文件 / 失败隔离 / 统计口径。
// 这些断言锁的是「分母正确」——四态（free/coming_soon/region_locked/not_found）永远不会有报价，
// 混在候选里只会白烧配额；no_price 保留（可能后续有价）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import {
  buildBackfillProgress,
  writeBackfillProgress,
  readBackfillProgress,
  backfillProgressFilePath,
} from '../src/backfill.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  return store;
}

const addGame = (q, { appid, status = null, description = null, headerImage = null, backfillAt = null, skipUntil = null, seq }) =>
  q(
    'insert into games (steam_appid, name, description, header_image, steam_status, backfill_at, backfill_skip_until, created_at) ' +
      "values ($1::int, 'g'||$1::text, $2::text, $3::text, $4::text, $5::timestamptz, $6::timestamptz, now() - ($7::int || ' seconds')::interval)",
    [appid, description, headerImage, status, backfillAt, skipUntil, String(seq)],
  );

test('BL-1：候选去噪——四态排除、no_price 保留、正常缺价入选、有价有描述不入选', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    // seq 越大 created_at 越新（AC-9 新游戏优先：倒序）
    await addGame(q, { appid: 1, status: 'free', seq: 1 });
    await addGame(q, { appid: 2, status: 'coming_soon', seq: 2 });
    await addGame(q, { appid: 3, status: 'region_locked', seq: 3 });
    await addGame(q, { appid: 4, status: 'not_found', seq: 4 });
    await addGame(q, { appid: 5, status: 'no_price', seq: 5 });
    await addGame(q, { appid: 6, status: null, seq: 6 });
    await addGame(q, { appid: 7, status: 'ok', description: '', seq: 7 });
    // 有描述 + 有 Steam 报价 + 有封面 → 不是候选
    await addGame(q, { appid: 8, status: 'ok', description: '已有简介', headerImage: '/img/x.jpg', seq: 8 });
    await q("insert into platforms (code, name, kind) values ('steam', 'Steam 国区', 'official') on conflict (code) do nothing");
    await q("insert into offers (game_id, platform_code, product_type, region, currency, price_cents) values ((select id from games where steam_appid=8), 'steam', 'official_direct', 'cn', 'CNY', 9900)");

    const ids = await db.listBackfillCandidates(q, { limit: 50 });
    assert.deepEqual(ids, [5, 6, 7], '只有 no_price 与正常缺价入选；四态排除（seq 小 = 新 → 倒序在前）');

    const total = await db.countBackfillCandidates(q);
    assert.equal(total, 3, '候选计数与列表一致');
    const totalNoCooldown = await db.countBackfillCandidates(q, { includeCooldown: false, includeSkip: false });
    assert.equal(totalNoCooldown, 3, '无冷却口径同样 3');
  } finally {
    await store.close();
  }
});

test('BL-2：进度文件——字段完整、round-trip、remaining 与 count429 归一化', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-progress-'));
  const saved = process.env.BACKFILL_PROGRESS_FILE;
  process.env.BACKFILL_PROGRESS_FILE = join(dir, 'backfill-progress.json');
  try {
    const payload = {
      result: 'partial',
      done: 3200,
      limit: 5000,
      batches: 32,
      stored: 3100,
      priced: 900,
      failed: 40,
      candidateTotal: 68000,
      ratePerMin: 210,
      count429: 1,
      last429At: '2026-11-13T02:00:00.000Z',
      retryAt: '2026-11-13T03:00:00.000Z',
    };
    writeBackfillProgress(payload);
    const read = readBackfillProgress();
    assert.equal(read.result, 'partial');
    assert.equal(read.done, 3200);
    assert.equal(read.limit, 5000);
    assert.equal(read.remaining, 64800, 'remaining = candidateTotal - done');
    assert.equal(read.count429, 1);
    assert.equal(read.last429At, payload.last429At);
    assert.ok(read.updatedAt, 'updatedAt 自动补齐');
    const raw = JSON.parse(readFileSync(backfillProgressFilePath(), 'utf8'));
    assert.deepEqual(Object.keys(raw).sort(), [
      'batches', 'candidateTotal', 'count429', 'done', 'failed', 'last429At', 'limit',
      'priced', 'ratePerMin', 'remaining', 'result', 'retryAt', 'startedAt', 'stored', 'updatedAt',
    ].sort(), '文件字段与规格 §3.4 一致');
    assert.equal(readBackfillProgress().result, 'partial', '再次读取一致（幂等落盘）');
  } finally {
    if (saved === undefined) delete process.env.BACKFILL_PROGRESS_FILE;
    else process.env.BACKFILL_PROGRESS_FILE = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-2：进度文件缺失时 readBackfillProgress 返回 null（不抛错）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-progress-'));
  const saved = process.env.BACKFILL_PROGRESS_FILE;
  process.env.BACKFILL_PROGRESS_FILE = join(dir, 'nope.json');
  try {
    assert.equal(readBackfillProgress(), null);
    assert.equal(buildBackfillProgress({ result: 'ok' }).result, 'ok');
    assert.equal(buildBackfillProgress({ done: 10, candidateTotal: 5 }).remaining, 0, 'remaining 不为负');
  } finally {
    if (saved === undefined) delete process.env.BACKFILL_PROGRESS_FILE;
    else process.env.BACKFILL_PROGRESS_FILE = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-3：adminGameStats 回填口径——待回填/已排除/跳过中 与库一致（对账）', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    await q("insert into platforms (code, name, kind) values ('steam', 'Steam 国区', 'official') on conflict (code) do nothing");
    // 2001 四态且缺描述 → 已排除
    await addGame(q, { appid: 2001, status: 'free', seq: 1 });
    // 2002/2003 正常缺价 → 待回填
    await addGame(q, { appid: 2002, status: 'no_price', seq: 2 });
    await addGame(q, { appid: 2003, status: null, seq: 3 });
    // 2004 有描述+有报价+有封面 → 两边都不算
    await addGame(q, { appid: 2004, status: 'ok', description: '已有简介', headerImage: '/img/x.jpg', seq: 4 });
    await q("insert into offers (game_id, platform_code, product_type, region, currency, price_cents) values ((select id from games where steam_appid=2004), 'steam', 'official_direct', 'cn', 'CNY', 9900)");
    // 2005 正常缺价但失败隔离中 → 跳过中
    await addGame(q, { appid: 2005, status: null, seq: 5 });
    await q("update games set backfill_skip_until = now() + interval '29 days' where steam_appid = 2005");

    const stats = await db.adminGameStats(q);
    assert.equal(stats.backfillPending, 2, '待回填 = no_price + 正常缺价（2002/2003）');
    assert.equal(stats.backfillExcluded, 1, '已排除 = 四态 ∩ 旧候选（2001）');
    assert.equal(stats.backfillSkipped, 1, '跳过中 = 隔离期内（2005）');
    assert.equal(stats.backfillPending + stats.backfillExcluded + stats.backfillSkipped, 4, '对账：待回填 + 已排除 + 跳过中 = 旧候选数（2001-2003、2005）');
  } finally {
    await store.close();
  }
});

test('BL-3：失败隔离——连续 3 次跳过 30 天、成功清零、到期重入', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    await q("insert into games (steam_appid, name) values (1001, 'g1001'), (1002, 'g1002')");
    // 1002 有描述 + 有 Steam 报价 + 有封面 → 全程不是候选（只当隔离样本）
    await q("update games set description = '已有简介', header_image = '/img/x.jpg' where steam_appid = 1002");
    await q("insert into platforms (code, name, kind) values ('steam', 'Steam 国区', 'official') on conflict (code) do nothing");
    await q("insert into offers (game_id, platform_code, product_type, region, currency, price_cents) values ((select id from games where steam_appid=1002), 'steam', 'official_direct', 'cn', 'CNY', 9900)");
    const state = (appid) => q('select backfill_fail_count as c, backfill_skip_until as s from games where steam_appid=$1', [appid]).then((r) => r.rows[0]);

    const skipped1 = await db.recordBackfillFailures(q, [1001]);
    assert.deepEqual(skipped1, [], '第 1 次失败不跳过');
    await db.recordBackfillFailures(q, [1001]);
    assert.equal((await state(1001)).s, null, '第 2 次失败仍不跳过');
    const skipped3 = await db.recordBackfillFailures(q, [1001]);
    assert.equal(skipped3.length, 1, '第 3 次失败触发跳过');
    assert.equal(skipped3[0].appid, 1001);
    assert.equal(skipped3[0].count, 3);
    const s3 = await state(1001);
    assert.ok(s3.s, 'skip_until 已写入');
    assert.ok(Date.parse(s3.s) > Date.now() + 29 * 24 * 3600_000, '跳过约 30 天');

    // 隔离期内不入选候选
    await q('update games set steam_status = null, description = null where steam_appid = 1001');
    assert.equal(await db.countBackfillCandidates(q), 0, 'skip 期内不入候选');
    // 其它候选不受影响
    await q("insert into games (steam_appid, name, description) values (1003, 'g1003', null)");
    assert.equal(await db.countBackfillCandidates(q), 1, '正常候选仍入选');

    // 成功一次清零并解除跳过
    await db.clearBackfillFailures(q, [1001]);
    const cleared = await state(1001);
    assert.equal(cleared.c, 0);
    assert.equal(cleared.s, null);
    assert.equal(await db.countBackfillCandidates(q), 2, '解除后 1001 与 1003 都入候选');

    // 到期自动重入：把 1002 的报价/简介去掉让它重新成为候选，连续 3 次失败后把 skip 时间改到过去
    await q("delete from offers where game_id = (select id from games where steam_appid = 1002)");
    await q("update games set description = null, header_image = null where steam_appid = 1002");
    await db.recordBackfillFailures(q, [1002]);
    await db.recordBackfillFailures(q, [1002]);
    await db.recordBackfillFailures(q, [1002]);
    await q("update games set backfill_skip_until = now() - interval '1 second' where steam_appid = 1002");
    assert.ok((await db.listBackfillCandidates(q, { limit: 10 })).includes(1002), '30 天到期自动重入');
  } finally {
    await store.close();
  }
});
