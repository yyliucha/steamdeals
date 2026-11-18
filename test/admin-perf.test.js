// B2 批（docs/DESIGN-AUDIT.md B2）：admin 列表接口提速——链外压测（不在主链，本地实测用）。
// 在 pglite 里造 ~6 万游戏 + 报价 + 3 万采集记录的合成数据，对 /api/admin/games 的
// 列表 SQL / count SQL 与 /api/admin/sync/status 的 listSyncRuns / sourceSyncStats
// 分别测「无新索引（drop 后）」与「有新索引」两组耗时，打印对比表。
// 注意：pglite 单机数值不等于生产 PostgreSQL（198k 行 + 并行），
// 这里验证的是结构收益（有序索引替代全表排序、部分索引 count 走 index-only、
// lateral join 走 (platform_code, started_at) 索引），线上部署后按同一脚本口径复核。
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';

const NEW_INDEXES = ['idx_games_updated', 'idx_games_live', 'idx_fetch_runs_platform_started'];

// 与 server.js /api/admin/games 处理器逐字一致的两条 SQL（kw 为空串、无平台/状态/报价筛选）
const ADMIN_COUNT_SQL =
  "select count(*)::int as n from games g " +
  "where ('' = '' or replace(replace(lower(coalesce(g.name, '')), ' ', ''), '　', '') like '%' || '' || '%' " +
  "or replace(replace(lower(coalesce(g.name_en, '')), ' ', ''), '　', '') like '%' || '' || '%' " +
  "or exists (select 1 from game_aliases a where a.game_id = g.id and replace(replace(lower(coalesce(a.platform_title, '')), ' ', ''), '　', '') like '%' || '' || '%') " +
  "or cast(g.steam_appid as text) = '') and not g.deleted";
const ADMIN_ROWS_SQL =
  "select g.id, g.steam_appid, coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name, g.name_en, g.app_type, g.blocked, g.deleted, g.deleted_at, g.updated_at, " +
  "(g.description is not null and g.description <> '') as has_desc, " +
  "g.steam_status, g.steam_checked_at, g.required_age, g.adult_flag, g.mature_flag, " +
  "(select count(*) from offers o where o.game_id = g.id) as offer_count, " +
  "(select min(o.price_cents) from offers o where o.game_id = g.id and o.platform_code = 'steam' and o.in_stock) as steam_price, " +
  "(select coalesce(array_agg(distinct p.name), '{}') from offers o2 join platforms p on p.code = o2.platform_code where o2.game_id = g.id) as platform_names, " +
  "(select coalesce(array_agg(distinct o3.platform_code), '{}') from offers o3 where o3.game_id = g.id) as platform_codes, " +
  "(select count(*)::int from offers o4 where o4.game_id = g.id and o4.buy_url ~ '^https?://') as link_count " +
  "from games g where ('' = '' or replace(replace(lower(coalesce(g.name, '')), ' ', ''), '　', '') like '%' || '' || '%' " +
  "or replace(replace(lower(coalesce(g.name_en, '')), ' ', ''), '　', '') like '%' || '' || '%' " +
  "or exists (select 1 from game_aliases a where a.game_id = g.id and replace(replace(lower(coalesce(a.platform_title, '')), ' ', ''), '　', '') like '%' || '' || '%') " +
  "or cast(g.steam_appid as text) = '') and not g.deleted " +
  "order by g.updated_at desc nulls last, g.id desc limit $1 offset $2";

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function timed(q, sql, params, rounds = 5) {
  await q(sql, params); // 预热（pglite 首次解析/缓存）
  const samples = [];
  for (let i = 0; i < rounds; i += 1) {
    const t0 = performance.now();
    await q(sql, params);
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

async function measure(label, q) {
  const count = await timed(q, ADMIN_COUNT_SQL, [], 5);
  const rows = await timed(q, ADMIN_ROWS_SQL, [20, 0], 5);
  const syncRuns = await timed(q, 'bench-list-sync-runs', [], 5);
  const srcStats = await timed(q, 'bench-source-sync-stats', [], 5);
  return { label, countMs: count, rowsMs: rows, syncRunsMs: syncRuns, sourceStatsMs: srcStats };
}

async function main() {
  const store = await openStore('pglite:', {});
  const raw = (sql, p) => store.query(sql, p);
  const q = async (sql, p) => {
    if (sql === 'bench-list-sync-runs') return db.listSyncRuns(raw, { limit: 1 });
    if (sql === 'bench-source-sync-stats') return db.sourceSyncStats(raw);
    return raw(sql, p);
  };
  await db.migrate(store);
  console.log('[bench] migrate 完成，开始造数（6 万游戏 / 6 万报价 / 3 万 fetch_runs / 2 千 source_sync）…');
  const t0 = performance.now();
  await raw(`insert into platforms (code, name, kind) values ('steam', 'Steam 国区', 'official') on conflict do nothing`);
  await raw(`insert into games (name, name_en, steam_appid, app_type, created_at, updated_at, deleted)
             select 'Game ' || g, 'Game ' || g, 1000000 + g, 'game',
                    now() - (g || ' days')::interval, now() - (g || ' minutes')::interval, false
             from generate_series(1, 60000) g`);
  await raw(`insert into offers (game_id, platform_code, product_type, region, currency, price_cents, original_cents, discount_pct, in_stock, buy_url, first_seen_at, last_seen_at)
             select id, 'steam', 'official_direct', 'cn', 'CNY', 100 + (id % 5000), 100 + (id % 5000), 0, true,
                    'https://store.steampowered.com/app/' || steam_appid || '/', now() - interval '2 days', now() - interval '1 hour'
             from games`);
  await raw(`insert into fetch_runs (platform_code, started_at, finished_at, status, requests, total, ok, skipped, failed)
             select 'steam-prices', now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval + interval '20 minutes', 'done', 100, 100, 90, 5, 5
             from generate_series(1, 30000) g`);
  await raw(`insert into game_source_sync (game_id, platform_code, status, last_tried_at)
             select id, 'sonkwo', (array['matched', 'nomatch', 'failed', 'pending'])[1 + (id % 4)], now() - interval '1 day'
             from games limit 2000`);
  console.log(`[bench] 造数完成 ${Math.round(performance.now() - t0)}ms`);

  // 有新索引（migrate 已建）先测，再 drop 测"旧行为"，避免 drop 影响后续断言
  const after = await measure('有索引', q);
  for (const idx of NEW_INDEXES) await raw(`drop index if exists ${idx}`);
  const before = await measure('无索引', q);

  const fmt = (ms) => `${ms.toFixed(1)}ms`;
  console.log('');
  console.log('================ B2 实测对比（pglite 合成数据 60k games）================');
  console.log('| 指标 | 无新索引（旧） | 有新索引（新） | 降幅 |');
  console.log('|---|---|---|---|');
  for (const [key, name] of [
    ['countMs', 'admin games count(*)'],
    ['rowsMs', 'admin games 列表 20 行'],
    ['syncRunsMs', 'listSyncRuns(limit 1)'],
    ['sourceStatsMs', 'sourceSyncStats'],
  ]) {
    const b = before[key];
    const a = after[key];
    console.log(`| ${name} | ${fmt(b)} | ${fmt(a)} | ${b > 0 ? ((1 - a / b) * 100).toFixed(0) + '%' : '-'} |`);
  }
  console.log('=====================================================================');

  // 目标（DESIGN-AUDIT B2）：两项接口整体 <500ms。这里断言 SQL 层单步耗时留有充足余量。
  assert.ok(after.rowsMs < 800, `列表 SQL 有索引应 <800ms，实际 ${fmt(after.rowsMs)}`);
  assert.ok(after.countMs < 800, `count SQL 有索引应 <800ms，实际 ${fmt(after.countMs)}`);
  assert.ok(after.syncRunsMs < 800, `listSyncRuns 有索引应 <800ms，实际 ${fmt(after.syncRunsMs)}`);
  assert.ok(after.sourceStatsMs < 800, `sourceSyncStats 有索引应 <800ms，实际 ${fmt(after.sourceStatsMs)}`);
  // 结构收益必须真实存在（有序索引替代全表排序：列表 SQL 必有提升）
  assert.ok(after.rowsMs < before.rowsMs, `列表 SQL 有索引应比无索引快：${fmt(before.rowsMs)} → ${fmt(after.rowsMs)}`);

  await store.close();
  console.log('[bench] 完成');
}

main().catch((err) => {
  console.error('[bench] 失败：', err);
  process.exit(1);
});
