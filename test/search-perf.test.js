// DX 批（docs/SEARCH-FIX-PERF.md §DX）：列表/站点接口性能优化的回归锁。
//
// 锁住的约束：
//   1) count 合并：gameSearch 无关键词时 count+rows 只有 1 条 SQL（原 2 次 round-trip），
//      total 与独立 count(*)（读模型同口径）一致；空页（offset 越界）回落 count 查询仍精确；
//   2) 短 TTL 缓存：命中不再执行列表 SQL（只对列表 SQL 注入 100ms 延迟：回源路径每次
//      100ms+，命中路径只剩 1ms 级 gen 主键查询，P95 必须 ≤150ms；去掉缓存命中分支则
//      30 次请求全部回源、列表 SQL 计数 +30、用例红——反向自检以 SQL 计数为硬锁）；
//      gen 变化（调度器跨进程同步）/ 管理员写操作（屏蔽）两种失效路径都正确回源；
//   3) /api/site 缓存：命中零 DB 查询且响应一致；TTL 与配置变更（设置保存）都正确失效。
//
// 反向自检（删掉对应实现必须红）：
//   · 删掉 gameSearch 的 count(*) over() 合并 → 「无关键词只 1 条 SQL」用例红；
//   · 删掉 /api/games 的缓存命中分支 → 「命中 P95 ≤150ms」用例红（每次 2×100ms 延迟）；
//   · 删掉 gen 校验 → 「调度同步后立即回源」用例红；
//   · 删掉 /api/site 缓存 → 「第二次请求零 site 查询」用例红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { ingestOffers } from '../src/ingest.js';
import { startApiServer } from '../src/server.js';
import { createListCache, stableHash } from '../src/search-cache.js';

// 测试里默认关掉登录验证码（api.test.js 同款）
process.env.CAPTCHA_ENABLED = '0';

/** 升序 P95（ceil(0.95*n)-1 索引）。 */
function p95(samples) {
  assert.ok(samples.length >= 10, 'P95 需要至少 10 个样本');
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

// ── 1. 缓存纯逻辑（假时钟，秒级）─────────────────────────────────────

test('DX：createListCache——TTL/容量/世代/invalidate/key 隔离', () => {
  let clock = 1000;
  const cache = createListCache({ ttlMs: 45_000, maxEntries: 2, now: () => clock });

  cache.set('a', { v: 1 }, 5);
  assert.deepEqual(cache.get('a', 5), { v: 1 }, 'gen 匹配命中');
  assert.equal(cache.get('a', 6), undefined, 'gen 不匹配 = miss（跨进程同步感知）');
  assert.equal(cache.get('a', 5), undefined, 'miss 即删除条目');

  cache.set('b', { v: 2 }, null);
  clock += 44_000;
  assert.deepEqual(cache.get('b'), { v: 2 }, 'TTL 内命中');
  clock += 1001;
  assert.equal(cache.get('b'), undefined, 'TTL 过期 miss（30–60s 区间由调用方注入）');

  cache.set('x', 1);
  cache.set('y', 2);
  cache.set('z', 3); // 超过 maxEntries=2 → 逐出最旧的 x
  assert.equal(cache.get('x'), undefined, '容量超限逐出最旧条目');
  assert.equal(cache.get('z'), 3);

  cache.invalidate();
  assert.equal(cache.get('y'), undefined, 'invalidate 清空（管理员写操作后主动失效）');
  assert.equal(cache.size, 0);

  cache.set('k1', 1);
  cache.set('k2', 2);
  assert.equal(cache.get('k1'), 1, '不同 key 互不覆盖');
});

test('DX：stableHash——同串同值、异串异值、长度恒定', () => {
  assert.equal(stableHash('abc'), stableHash('abc'));
  assert.notEqual(stableHash('abc'), stableHash('abd'));
  const long = Array.from({ length: 5000 }, (_, i) => String(i)).join(',');
  assert.equal(stableHash(long).length, 8, '长 guestFlags 数组哈希后键长恒定（不进原始 id 串）');
});

// ── 2. gameSearch count 合并（pglite 真库）───────────────────────────

async function freshStore() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  return { store, q };
}

/** 种 4 款游戏：3 款有 cn 报价（1 款成人、1 款禁用）、1 款仅 us 区、1 款已删除。 */
async function seedPerf({ store, q }) {
  const g = async (appid, fields = {}) => {
    const r = await q(
      `insert into games (steam_appid, name, name_en, app_type, heat, release_date, adult_flag, blocked, deleted, is_free)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false) returning id`,
      [appid, fields.name, fields.nameEn ?? null, fields.appType ?? 'game', fields.heat ?? 50, fields.releaseDate ?? null, fields.adult ?? false, fields.blocked ?? false, fields.deleted ?? false],
    );
    return Number(r.rows[0].id);
  };
  const offer = async (gameId, { region = 'cn', price, discount = 0 }) => {
    await q(
      `insert into offers (game_id, platform_code, product_type, region, currency, price_cents, original_cents, discount_pct, in_stock)
       values ($1, 'steam', 'official_direct', $2, 'CNY', $3, $3, $4, true)`,
      [gameId, region, price, discount],
    );
    await q(`insert into platforms (code, name, kind) values ('steam', 'Steam 国区', 'official') on conflict (code) do nothing`);
  };
  const ids = {};
  ids.a = await g(7001, { name: '反恐精英 2', nameEn: 'Counter-Strike 2', heat: 90, releaseDate: '2023-09-27' });
  ids.b = await g(7002, { name: '传送门2', nameEn: 'Portal 2', heat: 80, releaseDate: '2011-04-19' });
  ids.c = await g(7003, { name: '成人游戏', nameEn: 'Adult Game', adult: true });
  ids.blocked = await g(7004, { name: '已禁用', nameEn: 'Blocked', blocked: true });
  ids.us = await g(7005, { name: '美区独占', nameEn: 'US Only' });
  ids.deleted = await g(7006, { name: '已删除', nameEn: 'Deleted', deleted: true });
  await offer(ids.a, { price: 12000 });
  await offer(ids.b, { price: 3000, discount: 28 });
  await offer(ids.c, { price: 5000 });
  await offer(ids.blocked, { price: 2000 });
  await offer(ids.us, { region: 'us', price: 1500 });
  await offer(ids.deleted, { price: 2000 });
  for (const gid of [ids.a, ids.b, ids.c, ids.blocked, ids.us, ids.deleted]) {
    await db.refreshGameRegionPrices(q, gid);
    await db.refreshGameRegionHist(q, gid);
  }
  return { ids };
}

test('DX：gameSearch count 合并——一次查询拿 total、与 count(*) 一致、空页回落精确', async () => {
  const { store, q } = await freshStore();
  try {
    await seedPerf({ store, q });
    const stats = { list: 0, countFallback: 0 };
    const countingQ = async (sql, p) => {
      if (sql.includes('count(*) over()')) stats.list += 1;
      if (/^select count\(\*\)::int as n/.test(sql.replace(/\s+/g, ' ').trim())) stats.countFallback += 1;
      return store.query(sql, p);
    };

    // 无关键词：候选查询不触发、count 与 rows 合并 → 只 1 条 SQL（合并前是 count + rows 两条）
    const base = await db.gameSearch(countingQ, { region: 'cn', pageSize: 20 });
    assert.equal(stats.list, 1, '无关键词时 count+rows 合并为 1 条 SQL（不再两次 round-trip）');
    assert.equal(stats.countFallback, 0, '非空页不回落 count 查询');
    // total 与独立 count(*)（读模型同口径）一致
    const counted = await q(
      `select count(*)::int as n from games g
        left join game_region_snapshot rs on rs.game_id = g.id and rs.region = $1
       where rs.game_id is not null and not g.deleted and not g.adult_flag and g.blocked = false`,
      ['cn'],
    );
    assert.equal(base.total, counted.rows[0].n, 'total 与独立 count(*) 一致（3 款：2 正常 + 1 禁用被排除）');
    assert.equal(base.total, 2);
    assert.ok(base.rows.every((r) => !('total_rows' in r)), '窗口列不随行返回（响应契约不变）');

    // 关键词：候选查询 1 + 合并 rows 1 = 2 条 SQL（合并前是 3 条）；total 精确
    const byKw = await db.gameSearch(countingQ, { region: 'cn', keyword: '传送门', pageSize: 20 });
    assert.equal(byKw.total, 1, '关键词 total 精确');
    assert.equal(byKw.rows[0].name, '传送门2');
    assert.equal(stats.list, 2, '关键词路径只有 1 条合并 rows 查询（+1 条候选查询不算在内）');

    // 空页（offset 越界）：rows 空 → 回落 count 查询，total 仍精确
    const emptyPage = await db.gameSearch(countingQ, { region: 'cn', page: 99, pageSize: 20 });
    assert.equal(emptyPage.rows.length, 0);
    assert.equal(emptyPage.total, 2, '空页回落 count 查询后 total 精确');
    assert.equal(stats.countFallback, 1, '空页执行 1 次 count 回落');
  } finally {
    await store.close();
  }
});

// ── 3. 真实 HTTP：列表缓存 P95 + 失效路径 + /api/site 缓存 ──────────

async function setupHttp({ listCacheTtlMs = 45_000, siteCacheTtlMs = 60_000, delayMs = 100 } = {}) {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const rawQ = (sql, p) => store.query(sql, p);
  await db.createUser(rawQ, { username: 'admin', password: 'admin123456', role: 'admin' });
  await ingestOffers(store, {
    platform: { code: 'steam', name: 'Steam 国区', kind: 'official' },
    offers: [
      {
        platformCode: 'steam',
        platformProductId: '413150',
        steamAppid: 413150,
        title: '星露谷物语',
        productType: 'official_direct',
        region: 'cn',
        currency: 'CNY',
        priceCents: 4800,
        originalCents: 4800,
        discountPct: 0,
        inStock: true,
        buyUrl: 'https://store.steampowered.com/app/413150/',
        meta: {},
      },
    ],
  });
  await rawQ(`insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency)
              select id, 'steam', 'cn', current_date - 1, 4800, 'CNY' from games where steam_appid = 413150`);
  const baseGid = (await rawQ('select id from games where steam_appid = 413150')).rows[0].id;
  await db.refreshGameRegionHist(rawQ, baseGid);

  // 慢查询探针：只对列表 SQL 注入 delayMs 延迟（gen 是 1ms 主键查询、不注入，贴近真实语义），
  // 命中缓存时应只剩 gen 查询（列表 SQL 计数不再增加），回源时列表 SQL +1（100ms 延迟）。
  // 反向自检：删掉缓存命中分支 → 30 次请求全部回源 → 列表 SQL 计数 +30、必红。
  const stats = { total: 0, gen: 0, list: 0, site: 0 };
  const slowQuery = async (sql, p) => {
    stats.total += 1;
    if (sql.includes('coalesce(max(id), 0)')) stats.gen += 1;
    if (sql.includes('count(*) over()')) {
      stats.list += 1;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    if (sql.includes('app_settings') || sql.includes('smtp')) stats.site += 1;
    return store.query(sql, p);
  };
  const srv = await startApiServer({ query: slowQuery, store, port: 0, host: '127.0.0.1', listCacheTtlMs, siteCacheTtlMs });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = async () => {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };
  return { store, rawQ, slowQuery, stats, srv, base, login };
}

test('DX：真实 HTTP——列表缓存命中 P95 达标、gen/主动失效回源、total 正确', async (t) => {
  const { store, rawQ, stats, srv, base, login } = await setupHttp();
  try {
    const getList = () => fetch(`${base}/api/games`);

    // 首次：回源（gen + 列表 SQL），列表 SQL 注入 100ms 延迟——缓存未命中路径必然慢于命中路径
    const first = await getList();
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.total, 1, 'seed 后列表 total=1');
    assert.ok(firstBody.games.some((g) => g.steam_appid === 413150));
    assert.ok(stats.list >= 1, '首请求执行列表 SQL');

    // 命中：连续 30 次——每次都只有 gen 查询（列表 SQL 不再增加），P95 ≤150ms 达标
    const beforeList = stats.list;
    const samples = [];
    for (let i = 0; i < 30; i += 1) {
      const t0 = Date.now();
      const res = await getList();
      samples.push(Date.now() - t0);
      const body = await res.json();
      assert.equal(body.total, 1, `第 ${i + 1} 次命中响应 total 不变`);
    }
    assert.equal(stats.list, beforeList, '30 次命中期间列表 SQL 零执行（缓存真锁住）');
    assert.ok(p95(samples) <= 150, `命中路径 P95 ≤150ms，实测 ${p95(samples)}ms（规格目标）`);

    // gen 失效：调度器跨进程同步写 sync_runs → 下一次请求必须回源
    await rawQ(`insert into sync_runs (mode, status) values ('test-sync', 'running')`);
    const afterSync = await (await getList()).json();
    assert.equal(afterSync.total, 1);
    assert.equal(stats.list, beforeList + 1, '数据世代变化 → 缓存视为过期，立即回源（跨进程同步感知）');

    // 主动失效：管理员屏蔽游戏 → 缓存立即失效 → 列表回源且内容变化
    await getList(); // 重建缓存
    const beforeBlock = stats.list;
    const cookie = await login();
    const blocked = await fetch(`${base}/api/games/413150/blocked`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ blocked: true }),
    });
    assert.equal(blocked.status, 200);
    const afterBlock = await (await getList()).json();
    assert.equal(afterBlock.total, 0, '屏蔽后默认列表（blocked=exclude）不再包含该游戏');
    assert.equal(stats.list, beforeBlock + 1, '管理员写操作 → 缓存立即失效并回源');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('DX：真实 HTTP——/api/site 缓存命中零查询、TTL 与配置变更失效', async () => {
  const { store, stats, srv, base, login } = await setupHttp({ siteCacheTtlMs: 500 });
  try {
    const getSite = () => fetch(`${base}/api/site`);

    const first = await (await getSite()).json();
    assert.equal(first.name, 'SteamDeals');
    assert.ok(typeof first.registration.enabled === 'boolean');
    const siteQueriesAfterFirst = stats.site;
    assert.ok(siteQueriesAfterFirst >= 1, '首次 /api/site 查开关/SMTP（基线耗时来源）');

    const second = await (await getSite()).json();
    assert.deepEqual(second, first, '命中缓存响应与首查完全一致');
    assert.equal(stats.site, siteQueriesAfterFirst, '命中期间零 site 查询（缓存真锁住）');

    // TTL 失效：500ms 过后重查
    await new Promise((r) => setTimeout(r, 550));
    await getSite();
    assert.ok(stats.site > siteQueriesAfterFirst, 'TTL 过期后回源重查');

    // 配置变更失效：管理员保存设置（afterHydrate）→ 立即失效
    await getSite();
    const beforeSave = stats.site;
    const cookie = await login();
    const saved = await fetch(`${base}/api/admin/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ values: {} }),
    });
    assert.equal(saved.status, 200, '空 patch 保存也走 hydrate/失效链');
    await getSite();
    assert.ok(stats.site > beforeSave, '设置保存 → site 缓存立即失效并回源');
  } finally {
    await srv.close();
    await store.close();
  }
});
