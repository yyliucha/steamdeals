// B2 批（docs/DESIGN-AUDIT.md B2）：admin 列表接口提速——短缓存行为 + 契约不变。
// /api/admin/games 与 /api/admin/sync/status 各带 3s 短缓存（测试注入长 TTL）：
// 相同 query 3s 内重复请求不重跑重查询；query 不同各自独立；游戏写操作/任务操作后立即失效；
// 缓存命中与未命中的返回契约逐字段一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ingestOffers } from '../src/ingest.js';

// 测试里默认关掉登录验证码（与 api.test.js 一致）
process.env.CAPTCHA_ENABLED = '0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup({ adminCacheTtlMs = 60000, syncStatusTtlMs = 60000, countGames = false, countSync = false } = {}) {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await ingestOffers(store, {
    platform: { code: 'steam', name: 'Steam 国区', kind: 'official' },
    offers: [{
      platformCode: 'steam', platformProductId: '413150', steamAppid: 413150, title: '星露谷物语',
      productType: 'official_direct', region: 'cn', currency: 'CNY', priceCents: 4800, originalCents: 4800,
      discountPct: 0, inStock: true, buyUrl: 'https://store.steampowered.com/app/413150/', meta: {},
    }],
  });
  const counters = { games: 0, sync: 0 };
  const countingQ = async (sql, p) => {
    if (/from games g/.test(sql)) counters.games += 1;
    if (/from sync_runs sr/.test(sql)) counters.sync += 1;
    return q(sql, p);
  };
  const srv = await startApiServer({ query: countingQ, adminCacheTtlMs, syncStatusTtlMs, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const loginRes = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
  });
  const cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];
  assert.equal(loginRes.status, 200, '管理员登录成功');
  return { store, q, srv, base, cookie, counters };
}

test('B2：/api/admin/games 短缓存——同 query 命中不重查，不同 query 独立，写操作立即失效', async () => {
  const { store, srv, base, cookie, counters } = await setup();
  try {
    const url1 = `${base}/api/admin/games?page=1&pageSize=20&q=&platform=&status=&rating=&offers=`;
    const first = await fetch(url1, { headers: { cookie } });
    assert.equal(first.status, 200);
    const b1 = await first.json();
    assert.equal(counters.games, 2, '首次请求执行一次重查询（count + 列表两条 SQL）');
    assert.deepEqual(Object.keys(b1).sort(), ['games', 'page', 'pageSize', 'pages', 'total'].sort(), '契约字段不变');
    assert.equal(b1.page, 1);
    assert.equal(b1.pageSize, 20);
    assert.ok(b1.games.length >= 1, '列表有数据');

    const second = await fetch(url1, { headers: { cookie } });
    const b2 = await second.json();
    assert.equal(counters.games, 2, '相同 query 3s 内命中缓存，不再重查');
    assert.deepEqual(b2, b1, '缓存命中返回与未命中完全一致');

    const url2 = `${base}/api/admin/games?page=2&pageSize=20&q=&platform=&status=&rating=&offers=`;
    await fetch(url2, { headers: { cookie } });
    assert.equal(counters.games, 4, '不同 query（翻页）各自独立，重新查询');

    // 游戏写操作（编辑 blocked）→ 缓存立即失效，同一 URL 再查一次
    const block = await fetch(`${base}/api/games/413150/blocked`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ blocked: true }),
    });
    assert.equal(block.status, 200);
    await fetch(url1, { headers: { cookie } });
    assert.equal(counters.games, 6, '写操作后同一 URL 重新查询（缓存已失效）');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('B2：/api/admin/sync/status 短缓存——重复请求不重查；任务操作（熔断重置）后立即失效', async () => {
  const { store, srv, base, cookie, counters } = await setup();
  try {
    const first = await fetch(`${base}/api/admin/sync/status`, { headers: { cookie } });
    assert.equal(first.status, 200);
    const s1 = await first.json();
    assert.equal(counters.sync, 1, '首次请求执行一次 listSyncRuns');
    for (const key of ['running', 'run', 'output', 'last', 'schedule', 'backfillProgress', 'sourceStats', 'warnings']) {
      assert.ok(key in s1, `契约字段 ${key} 保留`);
    }

    const second = await fetch(`${base}/api/admin/sync/status`, { headers: { cookie } });
    const s2 = await second.json();
    assert.equal(counters.sync, 1, '3s 内重复请求命中缓存');
    assert.deepEqual(s2, s1, '缓存命中返回一致');

    // 熔断重置（任务状态写操作）→ 失效 → 再查执行一次
    const reset = await fetch(`${base}/api/admin/circuit/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'steam-prices' }),
    });
    assert.equal(reset.status, 200);
    await fetch(`${base}/api/admin/sync/status`, { headers: { cookie } });
    assert.equal(counters.sync, 2, '任务操作后缓存失效，重新查询');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('B2：TTL 到期后重新查询（注入 50ms TTL 验证过期路径）', async () => {
  const { store, srv, base, cookie, counters } = await setup({ adminCacheTtlMs: 50, syncStatusTtlMs: 50 });
  try {
    const url = `${base}/api/admin/games?page=1&pageSize=20&q=&platform=&status=&rating=&offers=`;
    await fetch(url, { headers: { cookie } });
    await fetch(url, { headers: { cookie } });
    assert.equal(counters.games, 2, 'TTL 内命中缓存');
    await sleep(80);
    await fetch(url, { headers: { cookie } });
    assert.equal(counters.games, 4, 'TTL 到期后重新查询');
  } finally {
    await srv.close();
    await store.close();
  }
});
