// FW 批（docs/SLOW-SYNC.md §8 FW-1）：慢慢同步——heat 候选 30 天阈值 + discovery 页游标（app_meta）。
//
// 断言质量：全部锁「行为」，不是「函数没抛错」——
//   ① heat：用真实 SQL 选出候选行，锁住 8~29 天前刷过的**不入选**、>30 天入选（7 天旧口径下会红）；
//   ② 游标：断言真实请求 URL 的 start 参数 + app_meta 里的真实游标值（内存态会红）；
//   ③ 到头：断言 nextPage 重置为 1 且 completedAt 非空；
//   ④ --reset-cursor：断言首个请求 start=0 且游标从 1 重新推进。
//
// 反向自检（跑过并恢复）：
//   ① 把 cli-ops-repository 的 `30 days` 改回 `7 days` → 测试 1 红（8/29 天的行会入选）；
//   ② 删掉 runDiscoveryRound 里每页的 writeDiscoveryCursor → 测试 2/3 红（app_meta 无游标/nextPage 不推进）；
//   ③ 删掉到头重置分支 → 测试 3 红（nextPage 仍 11、completedAt 为 null）；
//   ④ 让 discoveryRoundOptions 忽略 --reset-cursor → 测试 4 红（首个请求 start=300 而非 0）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { ensureSettingsSchema } from '../src/settings.js';
import { listHeatCandidates } from '../src/store/cli-ops-repository.js';
import { runDiscoveryRound, readDiscoveryCursor, discoveryRoundOptions, DISCOVERY_CURSOR_KEY } from '../src/discovery.js';

let store;
let q;

test.before(async () => {
  store = await openStore('pglite:', {});
  await db.migrate(store); // games/offers/game_source_sync 等业务表
  await ensureSettingsSchema(store); // app_meta（游标表，settings 的建表语句里）
  q = (sql, params) => store.query(sql, params);
});

test.after(async () => {
  await store?.close();
});

// ------------------------------------------------------------------ ① heat 候选 30 天阈值

test('FW-1 heat 候选：8~29 天前刷过的不入选、>30 天入选（旧 7 天阈值会红）', async () => {
  const mkGame = async (appid, heatDays) => {
    const r = await q(
      `insert into games (steam_appid, name, is_free, heat_at)
       values ($1, $2, false, case when $3::int is null then null else now() - make_interval(days => $3::int) end)
       returning id`,
      [appid, `heat-${appid}`, heatDays],
    );
    return Number(r.rows[0].id);
  };
  const addOffer = async (gameId) => {
    await q(
      `insert into offers (game_id, platform_code, product_type, region, currency, price_cents, in_stock)
       values ($1, 'steam', 'app', 'cn', 'CNY', 1000, true)`,
      [gameId],
    );
  };

  const idFresh = await mkGame(8101, 8); // 8 天前刷过：旧 7 天阈值入选，新 30 天阈值不入选
  const idNear = await mkGame(8102, 29); // 29 天：同上
  const idStale = await mkGame(8103, 31); // 31 天：两种阈值都入选（本条只能证明 >30 入选）
  const idNoPrice = await mkGame(8104, 40); // 40 天但没报价：永不入选（候选要求 exists offers）
  const idDeleted = await mkGame(8105, 40); // 40 天但有报价、已删除：不入选
  for (const id of [idFresh, idNear, idStale, idDeleted]) await addOffer(id);
  await q('update games set deleted = true where id = $1', [idDeleted]);

  const rows = (await listHeatCandidates(q, { size: 100 })).rows;
  const selected = rows.map((r) => Number(r.steam_appid));
  assert.ok(selected.includes(8103), '31 天前刷过且有报价 → 入选（>30 天）');
  assert.ok(!selected.includes(8101), '8 天前刷过 → 不入选（若还是 7 天阈值这条会变红）');
  assert.ok(!selected.includes(8102), '29 天前刷过 → 不入选');
  assert.ok(!selected.includes(8104), '无报价 → 不入选');
  assert.ok(!selected.includes(8105), '已删除 → 不入选');
  // 空 heat_at 的种子行不受 30 天阈值影响（首轮播种）：顺手锁住，防改成「都要有报价」
  await mkGame(8106, null);
  const again = (await listHeatCandidates(q, { size: 100 })).rows.map((r) => Number(r.steam_appid));
  assert.ok(again.includes(8106), 'heat_at 为空 → 入选（首轮播种）');
});

// ------------------------------------------------------------------ ② discovery 页游标

const makeFlag = (args) => (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

/** mock fetch：start=… 翻页接口返回指定 items；term=… 名称回退返回空（本文件不需要回退）。 */
function makeFetch(itemsForPage) {
  const urls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('term=')) return { json: { items: [] } };
    const start = Number(new URL(u).searchParams.get('start'));
    return { json: { items: itemsForPage(start) } };
  };
  return { urls, fetchImpl };
}

const pageRow = (appid) => ({ appid, deck_compat: 3, review_score: 9, review_desc: '好评如潮', review_total: 10 });

test('FW-1 游标推进：mock fetch 跑 10 页后 app_meta.discovery.page_cursor.nextPage=11；第二轮首个请求 start=500', async () => {
  await q("insert into games (steam_appid, name, is_free, deck_compat) values (730, 'CS2', true, 3)");
  // 第一轮：10 页都返回同一款（库内已有 → 每页写库并推进游标）
  const first = makeFetch(() => [pageRow(730)]);
  const stats1 = await runDiscoveryRound({ q, pages: 10, fallbackLimit: 0, fetchImpl: first.fetchImpl, rateMs: 0 });
  assert.equal(first.urls.length, 10, '跑满 10 页（每页 1 次请求）');
  assert.deepEqual(
    first.urls.map((u) => new URL(u).searchParams.get('start')),
    ['0', '50', '100', '150', '200', '250', '300', '350', '400', '450'],
    '请求 start 按页递增（每页 50，从第 1 页 0 开始）',
  );
  assert.equal(stats1.startPage, 1, '首轮从第 1 页开始');
  assert.equal(stats1.reachedEnd, false);
  let cursor = await readDiscoveryCursor(q);
  assert.equal(cursor.nextPage, 11, '10 页成功写库后游标推进到 11');
  assert.equal(cursor.completedAt, null, '没翻到尽头不写 completedAt');
  const raw = (await q('select value from app_meta where key = $1', [DISCOVERY_CURSOR_KEY])).rows[0]?.value;
  assert.ok(raw?.includes('"nextPage":11'), `游标真实落在 app_meta（重启不丢）：${raw}`);

  // 第二轮：第一页就返回空 items = 翻到尽头 → 重置；完成前先断言首个请求 start=500（从游标续跑）
  const second = makeFetch(() => []);
  const stats2 = await runDiscoveryRound({ q, pages: 10, fallbackLimit: 0, fetchImpl: second.fetchImpl, rateMs: 0 });
  assert.equal(new URL(second.urls[0]).searchParams.get('start'), '500', '第二轮首个请求从第 11 页开始（start=500）');
  assert.equal(stats2.startPage, 11);
  assert.equal(stats2.reachedEnd, true, '空 items = 翻到尽头');
});

test('FW-1 到头重置：items 为空 → nextPage=1 且 completedAt 落库（ISO 时间）', async () => {
  // 承接上一轮：当前游标已重置为 1，这里再从 1 跑一轮到头，验证重置分支独立成立
  const { urls, fetchImpl } = makeFetch(() => []);
  const stats = await runDiscoveryRound({ q, pages: 10, fallbackLimit: 0, fetchImpl, rateMs: 0 });
  assert.equal(new URL(urls[0]).searchParams.get('start'), '0', '从头开始（游标已是 1）');
  assert.equal(stats.reachedEnd, true);
  const cursor = await readDiscoveryCursor(q);
  assert.equal(cursor.nextPage, 1, '翻到尽头 → 游标重置为 1');
  assert.ok(cursor.completedAt && !Number.isNaN(Date.parse(cursor.completedAt)), `completedAt 是 ISO 时间：${cursor.completedAt}`);
  assert.ok(cursor.roundStartedAt && !Number.isNaN(Date.parse(cursor.roundStartedAt)), 'roundStartedAt 也在');
});

test('FW-1 --reset-cursor：从第 1 页重来（首个请求 start=0），游标从 1 重新推进', async () => {
  // 先把游标推到第 7 页（模拟上次跑到一半）
  await q('update app_meta set value = $2 where key = $1', [
    DISCOVERY_CURSOR_KEY,
    JSON.stringify({ nextPage: 7, updatedAt: new Date().toISOString(), roundStartedAt: new Date().toISOString(), completedAt: null }),
  ]);
  assert.equal((await readDiscoveryCursor(q)).nextPage, 7, '前置：游标在第 7 页');

  const opts = discoveryRoundOptions(makeFlag(['steam-discovery', '--pages', '1', '--fallback', '0', '--reset-cursor']));
  assert.deepEqual(opts, { pages: 1, fallbackLimit: 0, rateMs: 1200, startPage: 1, resetCursor: true }, '--reset-cursor → startPage=1');
  const { urls, fetchImpl } = makeFetch(() => [pageRow(730)]);
  await runDiscoveryRound({ q, ...opts, rateMs: 0, fetchImpl });
  assert.equal(new URL(urls[0]).searchParams.get('start'), '0', '--reset-cursor 生效：首个请求回第 1 页（start=0）');
  assert.equal((await readDiscoveryCursor(q)).nextPage, 2, '从 1 重新推进：跑 1 页后游标到 2');

  // 不带 --reset-cursor：startPage=null（runDiscoveryRound 内部读游标，默认续跑）
  const plain = discoveryRoundOptions(makeFlag(['steam-discovery', '--pages', '1']));
  assert.equal(plain.startPage, null, '默认不重置：交给 runDiscoveryRound 读游标');
  const resumed = makeFetch(() => [pageRow(730)]);
  await runDiscoveryRound({ q, ...plain, rateMs: 0, fetchImpl: resumed.fetchImpl });
  assert.equal(new URL(resumed.urls[0]).searchParams.get('start'), '50', '不带参数时从游标第 2 页续跑（start=50）');
});
