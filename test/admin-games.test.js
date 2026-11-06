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
