// GetItems 批量接口：请求体、字段映射、分批与失败收集（用假 fetch，不发真实请求）。
// AD 批（docs/SEARCH-I18N.md）：搜索中英文 + 平台中文别名 + 空格/全角归一化（真 PGlite + 真 HTTP 后台搜索）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { buildBody, mapStoreItem, fetchStoreItems, CHUNK } from '../src/adapters/store-browse.js';

process.env.CAPTCHA_ENABLED = '0';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://api.steampowered.com/test',
    headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
    text: async () => JSON.stringify(body),
  };
}

test('请求体：最多 100 个 id，带国区/语言上下文', () => {
  const body = buildBody([730, 570], { country: 'CN', language: 'schinese' });
  assert.deepEqual(body.ids, [{ appid: 730 }, { appid: 570 }]);
  assert.equal(body.context.country_code, 'CN');
  assert.equal(body.context.language, 'schinese');
  assert.equal(body.data_request.include_basic_info, true);
  assert.equal(body.data_request.include_best_purchase_option, true, '不带这个字段 GetItems 不返回价格');
  assert.equal(CHUNK, 100);
});

test('字段映射：名称/类型/开发商/简介/国区价格', () => {
  const item = mapStoreItem({
    appid: 730,
    name: 'Counter-Strike 2',
    type: 'app',
    basic_info: {
      short_description: '<b>FPS</b> 游戏&amp;经典',
      developers: ['Valve'],
      publishers: ['Valve'],
      genres: [{ description: '动作' }],
    },
    best_purchase_option: {
      final_price: { amount: 0, currency: 'CNY' },
      original_price: { amount: 0, currency: 'CNY' },
      discount_percent: 0,
    },
  });
  assert.equal(item.steamAppid, 730);
  assert.equal(item.nameZh, 'Counter-Strike 2');
  assert.equal(item.appType, 'game');
  assert.deepEqual(item.developers, ['Valve']);
  assert.deepEqual(item.genres, ['动作']);
  assert.equal(item.description, 'FPS 游戏&经典');
  assert.equal(item.isFree, true);
  assert.equal(item.priceOverview.final, 0);
});

test('字段映射：DLC 与无价格', () => {
  const item = mapStoreItem({ appid: 123, name: 'DLC', type: 'dlc', basic_info: {} });
  assert.equal(item.appType, 'dlc');
  assert.equal(item.priceOverview, null);
  assert.equal(mapStoreItem(null), null);
});

test('字段映射：真实 GetItems 的 type 是数字枚举（0=game、4=dlc、6=software）', () => {
  assert.equal(mapStoreItem({ appid: 1, name: 'G', type: 0, basic_info: {} }).appType, 'game', '普通游戏 type=0 必须映射成 game');
  assert.equal(mapStoreItem({ appid: 2, name: 'D', type: 4, basic_info: {} }).appType, 'dlc');
  assert.equal(mapStoreItem({ appid: 3, name: 'S', type: 6, basic_info: {} }).appType, 'software');
  assert.equal(mapStoreItem({ appid: 4, name: 'X', type: 99, basic_info: {} }).appType, null, '未知枚举值不瞎猜');
  assert.equal(mapStoreItem({ appid: 5, name: 'X', basic_info: {} }).appType, null, '没有 type 留空');
  // 字符串形态（旧测试契约）保持不变
  assert.equal(mapStoreItem({ appid: 6, name: 'A', type: 'app', basic_info: {} }).appType, 'game');
});

test('字段映射：真实 GetItems 字段 final_price_in_cents / discount_pct', () => {
  const item = mapStoreItem({
    appid: 271590,
    name: 'Grand Theft Auto V',
    type: 'app',
    is_free: false,
    basic_info: { short_description: '开放世界' },
    best_purchase_option: {
      packageid: 12345,
      final_price_in_cents: 11900,
      original_price_in_cents: 17900,
      discount_pct: 33,
      formatted_final_price: '¥119.00',
    },
  });
  assert.equal(item.priceOverview.final, 11900);
  assert.equal(item.priceOverview.initial, 17900);
  assert.equal(item.priceOverview.discountPercent, 33);
  assert.equal(item.priceOverview.currency, 'CNY');
  assert.equal(item.isFree, false);
});

test('字段映射：int64 价格是字符串（"11900"）也要能解析', () => {
  const item = mapStoreItem({
    appid: 271590,
    name: 'GTA V',
    type: 'app',
    is_free: false,
    basic_info: {},
    best_purchase_option: {
      final_price_in_cents: '11900',
      original_price_in_cents: '17900',
      discount_pct: 33,
    },
  });
  assert.equal(item.priceOverview.final, 11900);
  assert.equal(item.priceOverview.initial, 17900);
  assert.equal(item.priceOverview.discountPercent, 33);
});

test('字段映射：免费游戏 is_free 为 true（没有购买选项也不影响）', () => {
  const item = mapStoreItem({ appid: 570, name: 'Dota 2', type: 'app', is_free: true, basic_info: {} });
  assert.equal(item.isFree, true);
  assert.equal(item.priceOverview, null);
});

test('字段映射：final_price 是整数时也能解出价格（旧形态兼容）', () => {
  const item = mapStoreItem({
    appid: 570,
    name: 'Dota 2',
    type: 'app',
    basic_info: {},
    best_purchase_option: { final_price: 19800, original_price: 29800, discount_percent: 33, currency_code: 'CNY' },
  });
  assert.equal(item.priceOverview.final, 19800);
  assert.equal(item.priceOverview.initial, 29800);
  assert.equal(item.priceOverview.discountPercent, 33);
  assert.equal(item.priceOverview.currency, 'CNY');
  assert.equal(item.isFree, false);
});

test('字段映射：价格放在 purchase_options 数组里也能取', () => {
  const item = mapStoreItem({
    appid: 440,
    name: 'TF2',
    type: 'app',
    basic_info: {},
    purchase_options: [{ final_price: { amount: 0, currency: 'CNY' }, original_price: { amount: 0, currency: 'CNY' } }],
  });
  assert.equal(item.priceOverview.final, 0);
  assert.equal(item.isFree, true);
});

test('分批请求：150 个 id 分两批，缺失的 appid 进 failed', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(new URL(url).searchParams.get('input_json'));
    calls.push(body.ids.length);
    if (calls.length === 1) {
      // 第一批返回 100 个里的 99 个（漏掉第一个）
      const ids = body.ids.map((x) => x.appid).slice(1);
      return jsonResponse({ response: { store_items: ids.map((id) => ({ appid: id, name: 'G' + id, type: 'app' })) } });
    }
    const ids = body.ids.map((x) => x.appid);
    return jsonResponse({ response: { store_items: ids.map((id) => ({ appid: id, name: 'G' + id, type: 'app' })) } });
  };
  const appids = Array.from({ length: 150 }, (_, i) => 1000 + i);
  const r = await fetchStoreItems(appids, { key: 'k', fetchImpl });
  assert.equal(calls.length, 2, '应分成两批');
  assert.equal(calls[0], 100);
  assert.equal(calls[1], 50);
  assert.equal(r.items.length, 149);
  assert.deepEqual(r.failed, [1000]);
});

test('没有 key 时抛错（由调用方回退单条接口）', async () => {
  await assert.rejects(() => fetchStoreItems([730], {}), /STEAM_API_KEY/);
});

test('throwOnFatal：405/429/403 直接抛出，交回调用方中止回填', async () => {
  const fetchImpl = async () => jsonResponse({}, 405);
  await assert.rejects(() => fetchStoreItems([730], { key: 'k', fetchImpl, throwOnFatal: true }), /HTTP 405/);
  // 默认行为不变：只记 failed，继续下一批
  const r = await fetchStoreItems([730, 570], { key: 'k', fetchImpl });
  assert.deepEqual(r.failed, [730, 570]);
  assert.equal(r.items.length, 0);
});

// ---------------------------------------------------------------- AD 批：搜索中英文（docs/SEARCH-I18N.md §5 验收）
// 守护的约束：① 中文能命中 name 与平台别名；② 英文仍能命中；③ 空格/全角空格归一化后结果一致；
// ④ 后台「游戏管理」搜索同口径（同一 helper 组装 SQL）。

async function searchSetup() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await q("insert into platforms (code, name, kind) values ('steam','Steam 国区','official') on conflict do nothing");
  const seed = async (appid, name, nameEn) => {
    await q('insert into games (steam_appid, name, name_en, is_free) values ($1,$2,$3,false)', [appid, name, nameEn]);
    await q("insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) select id,'steam','cn',current_date,1000,'CNY' from games where steam_appid = $1", [appid]);
    const gid = (await q('select id from games where steam_appid = $1', [appid])).rows[0].id;
    // AV 批：原始 SQL 种价不进读模型，手动刷新（gameSearch 默认走读模型）
    await db.refreshGameRegionPrices(q, gid);
    await db.refreshGameRegionHist(q, gid);
    return gid;
  };
  const g1 = await seed(6001, '英雄连3', 'Company of Heroes 3');
  const g2 = await seed(6002, 'Company of Heroes 2', null); // name_en 为空、别名才有中文
  const g3 = await seed(6003, 'Counter-Strike 2', 'CS2');
  await q("insert into game_aliases (game_id, platform_code, platform_title, platform_product_id) values ($1,'steam','英雄连2','sku-coh2'), ($2,'steam','反恐精英 2','sku-cs2')", [g2, g3]);
  return { store, q };
}

test('AD：中文命中 name 与平台别名，英文命中 name/name_en 回归', async () => {
  const { store, q } = await searchSetup();
  try {
    const zh = await db.gameSearch(q, { region: 'cn', keyword: '英雄连', page: 1, pageSize: 20 });
    assert.equal(zh.total, 2, '搜「英雄连」应命中 name 的英雄连3 与别名命中的 CoH2');
    assert.deepEqual(zh.rows.map((r) => r.steam_appid).sort(), [6001, 6002]);

    const en = await db.gameSearch(q, { region: 'cn', keyword: 'company of heroes', page: 1, pageSize: 20 });
    assert.equal(en.total, 2, '英文关键词（含空格）仍能命中');
    assert.deepEqual(en.rows.map((r) => r.steam_appid).sort(), [6001, 6002]);

    const aliasZh = await db.gameSearch(q, { region: 'cn', keyword: '反恐精英', page: 1, pageSize: 20 });
    assert.equal(aliasZh.total, 1, '纯别名命中的游戏也能搜到');
    assert.equal(aliasZh.rows[0].steam_appid, 6003);
  } finally {
    await store.close();
  }
});

test('AD：空格与全角空格归一化后结果一致；纯数字按 AppID 命中', async () => {
  const { store, q } = await searchSetup();
  try {
    const plain = await db.gameSearch(q, { region: 'cn', keyword: '英雄连3', page: 1, pageSize: 20 });
    const spaced = await db.gameSearch(q, { region: 'cn', keyword: '英雄连 3', page: 1, pageSize: 20 });
    const fullWidth = await db.gameSearch(q, { region: 'cn', keyword: '英雄连　3', page: 1, pageSize: 20 });
    assert.deepEqual(
      [plain, spaced, fullWidth].map((r) => r.rows.map((x) => x.steam_appid).sort()),
      [[6001], [6001], [6001]],
      '带空格 / 全角空格 / 不带空格的结果一致',
    );

    const byAppid = await db.gameSearch(q, { region: 'cn', keyword: '6003', page: 1, pageSize: 20 });
    assert.equal(byAppid.total, 1, '纯数字关键词按 AppID 精确命中');
    assert.equal(byAppid.rows[0].steam_appid, 6003);
  } finally {
    await store.close();
  }
});

test('AD：后台「游戏管理」搜索同口径（HTTP 层验证 §5.4）', async () => {
  const { store, q } = await searchSetup();
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const res = await fetch(`${base}/api/admin/games?q=${encodeURIComponent('英雄连2')}&page=1&pageSize=10`, {
      headers: { cookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 1, '后台搜索也命中平台别名');
    assert.equal(body.games[0].steam_appid, 6002);
  } finally {
    await srv.close();
    await store.close();
  }
});
