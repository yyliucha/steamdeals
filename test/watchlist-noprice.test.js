// CU-1（docs/USER-ALERTS-GOVERNANCE.md §2/§4 验收 1/5）：后台全站到价提醒「无报价」徽标 + 筛选。
//
// 锁三件事：
//   1. has_price 判定口径 = 该游戏无任何在售报价（与 CL 批一致：官方+授权渠道、CN 区、in_stock）
//      —— 有官方/授权在售报价 → true；无任何报价 → false；只有 c2c 报价 → false；缺货 → false；
//   2. 筛选：status=no_price 只出「无报价」行，total 精确；
//   3. HTTP 契约：/api/admin/watchlist 行带 hasPrice 布尔；status=no_price 服务端筛选；
//      前端静态锁：徽标文案「无报价」+ 筛选下拉 + 提示「无在售报价时不触发提醒」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ingestOffers } from '../src/ingest.js';

process.env.CAPTCHA_ENABLED = '0';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function setup() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  return { store, q };
}

const offerFor = (appid, over = {}) => ({
  platformCode: 'steam',
  platformProductId: String(appid),
  steamAppid: appid,
  title: `游戏${appid}`,
  productType: 'official_direct',
  region: 'cn',
  currency: 'CNY',
  priceCents: 9900,
  originalCents: 9900,
  discountPct: 0,
  inStock: true,
  buyUrl: `https://store.steampowered.com/app/${appid}/`,
  meta: {},
  ...over,
});

/** 建游戏（可带报价；不报价则只建 games 行）。 */
async function makeGame(q, store, appid, { offers = [], platform = { code: 'steam', name: 'Steam 国区', kind: 'official' } } = {}) {
  if (offers.length) {
    await ingestOffers(store, { platform, offers });
  } else {
    await db.ensureGame(q, { steamAppid: appid, name: `游戏${appid}`, nameEn: null, meta: null });
  }
  const r = await q('select id from games where steam_appid = $1', [appid]);
  return Number(r.rows[0].id);
}

test('CU-1 口径：has_price 只认官方+授权渠道在售报价（c2c / 缺货 / 无报价都算无报价）', async () => {
  const { store, q } = await setup();
  try {
    const withOfficial = await makeGame(q, store, 500001, { offers: [offerFor(500001, { priceCents: 9900 })] });
    const c2cOnly = await makeGame(q, store, 500002, {
      platform: { code: 'steampy', name: 'SteamPy', kind: 'c2c' },
      offers: [offerFor(500002, { platformCode: 'steampy', priceCents: 100 })],
    });
    const outOfStock = await makeGame(q, store, 500003, { offers: [offerFor(500003, { inStock: false })] });
    const noOffer = await makeGame(q, store, 500004);
    const authorized = await makeGame(q, store, 500005, {
      platform: { code: 'sonkwo', name: '杉果', kind: 'authorized_reseller' },
      offers: [offerFor(500005, { platformCode: 'sonkwo', priceCents: 5000 })],
    });

    await db.upsertWatch(q, { gameId: withOfficial, targetCents: null });
    await db.upsertWatch(q, { gameId: c2cOnly, targetCents: null });
    await db.upsertWatch(q, { gameId: outOfStock, targetCents: null });
    await db.upsertWatch(q, { gameId: noOffer, targetCents: null });
    await db.upsertWatch(q, { gameId: authorized, targetCents: null });

    const all = await db.listAllWatchesAdmin(q, { pageSize: 50 });
    const byGame = (id) => all.items.find((i) => Number(i.game_id) === id);
    assert.equal(all.total, 5);
    assert.equal(byGame(withOfficial).has_price, true, '官方在售报价 → has_price=true');
    assert.equal(byGame(authorized).has_price, true, '授权渠道在售报价 → has_price=true');
    assert.equal(byGame(c2cOnly).has_price, false, '只有 c2c 报价不算在售报价（与 CL 批主榜口径一致）');
    assert.equal(byGame(outOfStock).has_price, false, '缺货报价不算在售');
    assert.equal(byGame(noOffer).has_price, false, '无任何报价 → has_price=false');
    assert.equal(byGame(c2cOnly).current_cents, null, 'current_cents 与 has_price 同口径（c2c 不进主榜）');

    const noPrice = await db.listAllWatchesAdmin(q, { pageSize: 50, noPriceOnly: true });
    assert.equal(noPrice.total, 3, '筛选「无报价」只出 c2c/缺货/无报价三行');
    assert.ok(noPrice.items.every((i) => i.has_price === false), '筛选结果全部 has_price=false');
    assert.ok(!noPrice.items.some((i) => Number(i.game_id) === withOfficial), '有报价的不在筛选结果里');
  } finally {
    await store.close();
  }
});

test('CU-1 HTTP：/api/admin/watchlist 带 hasPrice；status=no_price 服务端筛选；普通用户 403 不回归', async () => {
  const { store, q } = await setup();
  const admin = (await db.createUser(q, { username: 'nopriceadmin', password: 'wpass123456', role: 'admin' })).id;
  const u = (await db.createUser(q, { username: 'nopriceuser', password: 'wpass123456', role: 'user' })).id;
  const gPrice = await makeGame(q, store, 500006, { offers: [offerFor(500006, { priceCents: 8800 })] });
  const gNone = await makeGame(q, store, 500007);
  await db.upsertWatch(q, { gameId: gPrice, targetCents: null });
  await db.upsertUserWatch(q, { userId: u, gameId: gNone, targetCents: null });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = async (username, password) => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };
  try {
    const cookieAdmin = await login('nopriceadmin', 'wpass123456');
    const cookieU = await login('nopriceuser', 'wpass123456');
    assert.equal((await fetch(`${base}/api/admin/watchlist`, { headers: { cookie: cookieU } })).status, 403, '普通用户 403 不回归');

    const all = await (await fetch(`${base}/api/admin/watchlist?pageSize=50`, { headers: { cookie: cookieAdmin } })).json();
    assert.equal(all.total, 2);
    assert.equal(typeof all.items[0].hasPrice, 'boolean', '每行带 hasPrice 布尔');
    assert.ok(all.items.every((i) => !('has_price' in i)), '契约用驼峰 hasPrice');

    const none = await (await fetch(`${base}/api/admin/watchlist?pageSize=50&status=no_price`, { headers: { cookie: cookieAdmin } })).json();
    assert.equal(none.total, 1, '筛选「无报价」只出 1 行');
    assert.equal(none.items[0].hasPrice, false);
    assert.equal(Number(none.items[0].game_id), gNone, '就是无报价那条');
    assert.equal(none.items[0].current_cents, null);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('CU-1 前端：徽标「无报价」+ 筛选下拉 + 「无在售报价时不触发提醒」提示（静态锁）', () => {
  const text = readFileSync(`${ROOT}/frontend/src/pages/AdminModules.vue`, 'utf8');
  assert.match(text, /!w\.hasPrice/, '表格游戏列按 hasPrice 显示徽标');
  assert.match(text, />无报价<\/el-tag>/, '徽标文案「无报价」');
  assert.match(text, /该游戏无任何在售报价，提醒不会触发/, '徽标悬停说明无报价不触发');
  assert.match(text, /value="no_price"/, '筛选下拉含「无报价」选项');
  assert.match(text, /qs\.set\('status',watchStatus\.value\)/, '筛选值拼进接口请求 status 参数');
  assert.match(text, /无在售报价时不触发提醒/, '筛选行提示文案');
});
