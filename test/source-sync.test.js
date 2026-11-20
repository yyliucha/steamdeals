// CC 批（docs/SOURCE-SYNC-COVERAGE.md §4）：多源采集推进——状态表/候选游标/标记/统计/四源接入。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

async function boot() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  return { store, q, close: async () => store.close() };
}

async function addGame(q, { appid, name, nameEn = null, heat = 0 }) {
  const r = await q(
    `insert into games (steam_appid, name, name_en, heat) values ($1, $2, $3, $4)
     on conflict (steam_appid) do update set name = excluded.name, name_en = excluded.name_en, heat = excluded.heat
     returning id`,
    [Number(appid), name, nameEn, heat],
  );
  return Number(r.rows[0].id);
}

test('CC-1：迁移建表 + 既有 offers 回填 matched（on conflict 幂等）', async () => {
  const { store, q, close } = await boot();
  try {
    const gid = await addGame(q, { appid: 1001, name: '测试游戏', nameEn: 'Test Game' });
    // 模拟既有报价
    await q(`insert into offers (game_id, platform_code, product_type, region, currency, price_cents) values ($1,'itad','authorized_key','cn','CNY',100)`, [gid]);
    // 再次跑 migrate：幂等（不炸）+ 回填 matched
    await db.migrate(store);
    const r = await q(`select status, external_id from game_source_sync where game_id = $1 and platform_code = 'itad'`, [gid]);
    assert.equal(r.rows.length, 1, '回填一条 matched');
    assert.equal(r.rows[0].status, 'matched', '状态 matched');
    assert.equal(r.rows[0].external_id, null, '回填只补状态不猜 id');
  } finally {
    await close();
  }
});

test('CC-1：候选游标——pending 热度/访问优先，连续两轮不重叠，remaining 递减', async () => {
  const { store, q, close } = await boot();
  try {
    const ids = [];
    for (let i = 1; i <= 12; i++) ids.push(await addGame(q, { appid: 2000 + i, name: `G${i}`, nameEn: `Game ${i}`, heat: i % 5 }));
    // 给 appid 2003 一条 90 天内的访问 → 访问过的排在热度之前
    await q(`insert into page_views (user_id, path, appid) values (null, '/game', 2003)`);
    const first = await db.sourceSyncCandidates(q, { platform: 'itad', limit: 5 });
    assert.equal(first.length, 5, '第一轮 5 条');
    assert.equal(Number(first[0].steam_appid), 2003, '有访问的优先');
    // 第一轮全部标 nomatch → 第二轮应取不同的 5 条（7 天窗口内不重复）
    for (const g of first) await db.sourceSyncMark(q, { gameId: g.game_id, platform: 'itad', status: 'nomatch', ok: false });
    const second = await db.sourceSyncCandidates(q, { platform: 'itad', limit: 5 });
    assert.equal(second.length, 5, '第二轮 5 条');
    const firstIds = new Set(first.map((g) => g.game_id));
    for (const g of second) {
      assert.ok(!firstIds.has(g.game_id), '第二轮与第一轮不重叠');
      await db.sourceSyncMark(q, { gameId: g.game_id, platform: 'itad', status: 'nomatch', ok: false });
    }
    // remaining 递减：12 款 - 已处理 10 款 = 2
    const stats = await db.sourceSyncStats(q);
    assert.equal(stats.byPlatform.itad.pending, 2, 'pending 随推进递减');
  } finally {
    await close();
  }
});

test('CC-1：nomatch 7 天窗口 + matched 间隔刷新 + failed 退避', async () => {
  const { store, q, close } = await boot();
  try {
    const gid = await addGame(q, { appid: 3001, name: '窗口游戏', nameEn: 'Window Game' });
    // nomatch 刚试过 → 不在候选
    await db.sourceSyncMark(q, { gameId: gid, platform: 'gog', status: 'nomatch', ok: false });
    let cand = await db.sourceSyncCandidates(q, { platform: 'gog', limit: 10 });
    assert.ok(!cand.some((g) => g.game_id === gid), '7 天窗口内 nomatch 不重复');
    // 把 last_tried_at 拨到 8 天前 → 重新出现
    await q(`update game_source_sync set last_tried_at = now() - interval '8 days' where game_id = $1 and platform_code = 'gog'`, [gid]);
    cand = await db.sourceSyncCandidates(q, { platform: 'gog', limit: 10 });
    assert.ok(cand.some((g) => g.game_id === gid), '超过 7 天窗口重新候选');
    // matched 刚刷新 → 不在候选；拨旧 → 出现
    await db.sourceSyncMark(q, { gameId: gid, platform: 'gog', status: 'matched', externalId: 'gog-9', ok: true });
    cand = await db.sourceSyncCandidates(q, { platform: 'gog', limit: 10, refreshInterval: '12 hours' });
    assert.ok(!cand.some((g) => g.game_id === gid), 'matched 未到间隔不刷新');
    await q(`update game_source_sync set last_ok_at = now() - interval '13 hours' where game_id = $1 and platform_code = 'gog'`, [gid]);
    cand = await db.sourceSyncCandidates(q, { platform: 'gog', limit: 10, refreshInterval: '12 hours' });
    assert.ok(cand.some((g) => g.game_id === gid), 'matched 超间隔重新候选');
    // failed 退避：fail_count=1 → 2 天
    await db.sourceSyncMark(q, { gameId: gid, platform: 'gog', status: 'failed', ok: false, error: 'boom' });
    cand = await db.sourceSyncCandidates(q, { platform: 'gog', limit: 10 });
    assert.ok(!cand.some((g) => g.game_id === gid), 'failed 在退避窗口内不候选');
    await q(`update game_source_sync set last_tried_at = now() - interval '3 days' where game_id = $1 and platform_code = 'gog'`, [gid]);
    cand = await db.sourceSyncCandidates(q, { platform: 'gog', limit: 10 });
    assert.ok(cand.some((g) => g.game_id === gid), 'failed 超过退避窗口重新候选');
  } finally {
    await close();
  }
});

test('CC-1：mark upsert——nomatch→matched 保留 external_id、fail_count 归零/累加', async () => {
  const { store, q, close } = await boot();
  try {
    const gid = await addGame(q, { appid: 4001, name: '标记', nameEn: 'Mark Game' });
    await db.sourceSyncMark(q, { gameId: gid, platform: 'humble', status: 'failed', ok: false, error: 'e1' });
    await db.sourceSyncMark(q, { gameId: gid, platform: 'humble', status: 'failed', ok: false, error: 'e2' });
    let r = await q(`select status, fail_count, last_error from game_source_sync where game_id = $1 and platform_code = 'humble'`, [gid]);
    assert.equal(r.rows[0].fail_count, 2, 'fail_count 累加');
    assert.equal(r.rows[0].last_error, 'e2', 'last_error 更新');
    await db.sourceSyncMark(q, { gameId: gid, platform: 'humble', status: 'matched', externalId: 'humble-slug', ok: true });
    r = await q(`select status, fail_count, external_id from game_source_sync where game_id = $1 and platform_code = 'humble'`, [gid]);
    assert.equal(r.rows[0].status, 'matched');
    assert.equal(r.rows[0].fail_count, 0, '命中后 fail_count 归零');
    assert.equal(r.rows[0].external_id, 'humble-slug', 'external_id 落库');
    // 再次 nomatch 不会清掉 external_id（刷新失败仍可复用旧 id）
    await db.sourceSyncMark(q, { gameId: gid, platform: 'humble', status: 'nomatch', ok: false });
    r = await q(`select external_id from game_source_sync where game_id = $1 and platform_code = 'humble'`, [gid]);
    assert.equal(r.rows[0].external_id, 'humble-slug', '旧 external_id 保留');
  } finally {
    await close();
  }
});

test('CC-2/3：静态契约——四源接入 CLI/后台/设置/日志，不新增定时任务', () => {
  const cli = readFileSync(ROOT + 'src/cli.js', 'utf8');
  const admin = readFileSync(ROOT + 'frontend/src/pages/AdminModules.vue', 'utf8');
  const settings = readFileSync(ROOT + 'src/settings.js', 'utf8');
  const scheduler = readFileSync(ROOT + 'src/scheduler.js', 'utf8');
  const gog = readFileSync(ROOT + 'src/adapters/gog.js', 'utf8');
  const humble = readFileSync(ROOT + 'src/adapters/humble.js', 'utf8');

  // 候选与状态：优先英文名、命中缓存 external_id 后不再 search
  assert.match(cli, /g\.name_en \|\| g\.name/, 'ITAD 优先英文名搜索');
  assert.match(cli, /g\.external_id \?\? null/, '命中后复用 external_id（不再重复 search）');
  assert.match(cli, /sourceSyncCandidates/, '候选游标接入');
  assert.match(cli, /sync\.source_progress/, '进度日志');
  assert.match(cli, /sync\.done/, '完成日志');
  assert.match(cli, /SOURCES_ITAD_LIMIT|SOURCES_GOG_LIMIT|SOURCES_HUMBLE_LIMIT|SOURCES_SONKWO_LIMIT/, '四源每轮条数设置接入');
  assert.match(cli, /adapter\.fetchById/, 'GOG matched 按 id 刷新');
  assert.match(cli, /adapter\.fetchBySlug/, 'Humble matched 按 slug 刷新');
  // 后台：四源可立即运行（运行中 409 复用 startSteamJob 互斥）
  // CO-5/B4-2 第九轮：/api/admin/sync 已随 admin-sync 域抽到 src/routes/admin-sync.js，断言按新落点指向
  const adminSync = readFileSync(ROOT + 'src/routes/admin-sync.js', 'utf8');
  assert.match(adminSync, /new Set\(\['catalog', 'steam-prices', 'steamall', 'itad', 'gog', 'humble', 'sonkwo'\]\)/, 'MODES 支持四源');
  assert.match(adminSync, /sourceSyncStats/, '状态接口返回四源统计');
  assert.match(admin, /TASK_ORDER=\['steam-prices','catalog','backfill','rename','heat','itad','gog','humble','sonkwo'\]/, '任务表 9 项（四源在内）');
  assert.match(admin, /\['steam-prices','catalog','itad','gog','humble','sonkwo'\]\.includes\(name\)/, '四源走 /api/admin/sync');
  assert.match(admin, /row\.stats\.matched/, '任务表显示匹配/剩余');
  // 设置项 4 条 + 适配器新函数
  assert.match(settings, /sources\.itad\.limit/, 'ITAD 每轮条数设置');
  assert.match(gog, /export async function fetchById/, 'GOG fetchById');
  assert.match(humble, /export async function fetchBySlug/, 'Humble fetchBySlug');
  // 杉果 limit：设置默认 0 = 全部 SKU（水合默认值不得导致空转，QA 第 1 轮打回项回归锁）
  assert.match(cli, /rawLimit === 0 \? skus\.length : rawLimit/, '杉果 limit 0 换算为全部 SKU');
  // 不新增定时任务：scheduler 仍只有既有的 itad/gog/humble/sonkwo 4 个源任务
  const jobNames = [...scheduler.matchAll(/name: '([a-z]+)'/g)].map((m) => m[1]);
  for (const n of ['itad', 'gog', 'humble', 'sonkwo']) assert.ok(jobNames.includes(n), `既有任务 ${n} 仍在`);
  assert.ok(!jobNames.includes('source-sync'), '不新增统一同步任务');
});
