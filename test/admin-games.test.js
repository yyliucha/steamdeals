// AG 批（docs/ADMIN-PLATFORM-LINKS.md）：后台单游戏平台链接接口。
// 验收要点：链接只返回 http(s)（javascript: 过滤）、按平台排序、同平台多区服都在、
// 列表带 link_count、非管理员 403、无此游戏 404。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';

process.env.CAPTCHA_ENABLED = '0';

async function setup() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await q("insert into platforms (code, name, kind) values ('steam','Steam 国区','official'),('sonkwo','杉果','authorized_reseller') on conflict do nothing");
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  const g1 = (await q("insert into games (steam_appid, name, is_free) values (7001,'链接测试',false) returning id")).rows[0].id;
  const g2 = (await q("insert into games (steam_appid, name, is_free) values (7002,'无链接',false) returning id")).rows[0].id;
  const g3 = (await q("insert into games (steam_appid, name, is_free) values (7003,'脏数据',false) returning id")).rows[0].id;
  const offer = async (gameId, platform, region, buyUrl, price = 1000) => {
    await q(
      'insert into offers (game_id, platform_code, product_type, region, currency, price_cents, original_cents, discount_pct, in_stock, buy_url, last_seen_at) values ($1,$2,$3,$4,$5,$6,$6,0,true,$7,now())',
      [gameId, platform, platform === 'steam' ? 'official_direct' : 'authorized_direct', region, 'CNY', price, buyUrl],
    );
  };
  // g1：steam cn + steam us（同平台两区服）+ sonkwo（不同平台）
  await offer(g1, 'steam', 'cn', 'https://store.steampowered.com/app/7001/');
  await offer(g1, 'steam', 'us', 'https://store.steampowered.com/app/7001/?cc=us');
  await offer(g1, 'sonkwo', 'cn', 'https://www.sonkwo.hk/sku/7001');
  // g3：脏链接（javascript: 不应出现）
  await offer(g3, 'steam', 'cn', 'javascript:alert(1)');
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  return { store, q, srv, base: `http://127.0.0.1:${srv.port}`, g1, g2, g3 };
}

const login = async (base, username, password) => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
};

test('AG：链接接口只返回 http(s) 且按平台排序，同平台多区服都在', async () => {
  const { store, q, srv, base, g1 } = await setup();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const res = await fetch(`${base}/api/admin/games/${g1}/links`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.game.name, '链接测试');
    assert.equal(body.links.length, 3);
    const urls = body.links.map((l) => l.buy_url);
    assert.ok(urls.every((u) => /^https?:\/\//.test(u)), '只允许 http/https');
    assert.deepEqual(body.links.map((l) => l.platform_name), ['Steam 国区', 'Steam 国区', '杉果'], '按平台名排序');
    assert.deepEqual(body.links.map((l) => l.region), ['cn', 'us', 'cn'], '同平台两个区服都在');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('AG：列表带 link_count；脏链接（javascript:）不计入也不出现在抽屉', async () => {
  const { store, srv, base, g1, g2, g3 } = await setup();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const list = await (await fetch(`${base}/api/admin/games?page=1&pageSize=20`, { headers: { cookie } })).json();
    const byId = new Map(list.games.map((g) => [g.id, g.link_count]));
    assert.equal(byId.get(g1), 3, '3 条合法链接');
    assert.equal(byId.get(g2), 0, '无链接为 0');
    assert.equal(byId.get(g3), 0, 'javascript: 不算链接');
    const links = await (await fetch(`${base}/api/admin/games/${g3}/links`, { headers: { cookie } })).json();
    assert.equal(links.links.length, 0, '脏数据不出现在抽屉');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('AG：权限——匿名 401、普通用户 403；不存在的游戏 404', async () => {
  const { store, srv, base, g1 } = await setup();
  try {
    const anon = await fetch(`${base}/api/admin/games/${g1}/links`);
    assert.equal(anon.status, 401);
    const alice = await login(base, 'alice', 'alice123456');
    const forbidden = await fetch(`${base}/api/admin/games/${g1}/links`, { headers: { cookie: alice } });
    assert.equal(forbidden.status, 403);
    const cookie = await login(base, 'admin', 'admin123456');
    const missing = await fetch(`${base}/api/admin/games/999999/links`, { headers: { cookie } });
    assert.equal(missing.status, 404);
  } finally {
    await srv.close();
    await store.close();
  }
});

// ---------------------------------------------------------------- DV 批（docs/ITAD-SOURCE-FILTER.md §2 方案 A）

async function setupSourceFilter() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await q("insert into platforms (code, name, kind) values ('steam','Steam 国区','official') on conflict do nothing");
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const addGame = async (appid, name) =>
    Number((await q('insert into games (steam_appid, name, is_free) values ($1,$2,false) returning id', [appid, name])).rows[0].id);
  const g1 = await addGame(8001, '有 Steam 报价');
  const g2 = await addGame(8002, '有报价且有 ITAD 匹配');
  const g3 = await addGame(8003, '无报价仅 ITAD 匹配');
  const offer = async (gameId) => {
    await q(
      "insert into offers (game_id, platform_code, product_type, region, currency, price_cents, original_cents, discount_pct, in_stock, last_seen_at) values ($1,'steam','official_direct','cn','CNY',1000,1000,0,true,now())",
      [gameId],
    );
  };
  await offer(g1);
  await offer(g2);
  // ITAD 来源标记：g2（有报价）+ g3（无报价）——来源筛选与报价存在性无关
  await q("insert into game_source_sync (game_id, platform_code, status) values ($1,'itad','matched')", [g2]);
  await q("insert into game_source_sync (game_id, platform_code, status) values ($1,'itad','matched')", [g3]);
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1', adminCacheTtlMs: 100 });
  return { store, q, srv, base: `http://127.0.0.1:${srv.port}`, g1, g2, g3 };
}

test('DV：platform=itad 走来源判定（game_source_sync matched），不再查不存在的 itad 报价', async () => {
  const { store, q, srv, base, g1, g2, g3 } = await setupSourceFilter();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const itad = await (await fetch(`${base}/api/admin/games?page=1&pageSize=20&platform=itad`, { headers: { cookie } })).json();
    // 反向自检：改回「offers.platform_code=itad」旧语义 → total 恒为 0，本断言变红（规格 §1 根因）
    const sqlMarked = (await q("select count(*)::int as n from game_source_sync where platform_code = 'itad' and status = 'matched'")).rows[0].n;
    assert.equal(itad.total, sqlMarked, '数量与库内 ITAD matched 标记一致——验收①');
    assert.equal(itad.total, 2);
    const ids = new Set(itad.games.map((g) => g.id));
    assert.ok(ids.has(g2) && ids.has(g3), 'g2（有报价）与 g3（无报价）都在来源筛选下出现');
    assert.ok(!ids.has(g1), '没有 ITAD 标记的游戏不出现');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('DV：其它平台筛选行为不变（仍按 offers.platform_code）', async () => {
  const { store, srv, base, g1, g2, g3 } = await setupSourceFilter();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const steam = await (await fetch(`${base}/api/admin/games?page=1&pageSize=20&platform=steam`, { headers: { cookie } })).json();
    assert.equal(steam.total, 2, 'steam 筛选 = 有 steam 报价的游戏（g1/g2）');
    const ids = new Set(steam.games.map((g) => g.id));
    assert.ok(ids.has(g1) && ids.has(g2));
    assert.ok(!ids.has(g3), 'g3 无 steam 报价不出现——与改动前一致（验收②）');
    const all = await (await fetch(`${base}/api/admin/games?page=1&pageSize=20`, { headers: { cookie } })).json();
    assert.equal(all.total, 3, '不带 platform 不受影响');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('DV：ITAD 采集新匹配一批游戏后，刷新即可在「ITAD（来源）」下看到（验收③）', async () => {
  const { store, q, srv, base } = await setupSourceFilter();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const before = await (await fetch(`${base}/api/admin/games?page=1&pageSize=20&platform=itad`, { headers: { cookie } })).json();
    assert.equal(before.total, 2);
    // 模拟新一批采集匹配：g1 新增 itad matched 标记
    const g1row = (await q('select id from games where steam_appid = 8001')).rows[0];
    await q("insert into game_source_sync (game_id, platform_code, status) values ($1,'itad','matched')", [g1row.id]);
    // 列表有短缓存（B2 批，本测试注入 100ms）：等缓存过期后刷新即见新标记
    await new Promise((r) => setTimeout(r, 250));
    const after = await (await fetch(`${base}/api/admin/games?page=1&pageSize=20&platform=itad`, { headers: { cookie } })).json();
    assert.equal(after.total, 3, '新标记立即可见（无缓存脏读）');
    const ids = new Set(after.games.map((g) => g.id));
    assert.ok(ids.has(g1row.id));
  } finally {
    await srv.close();
    await store.close();
  }
});
