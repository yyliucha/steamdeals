// BF 批（docs/DB-LEGACY-CLEANUP.md §4）：新库 migrate + ensureSteamSchema 之后，
// 已下线对象（steam_sessions 表、users.steam_id、offers.risk_level、user_wishlist.steam_ids）
// 不得再被代码 DDL 重建；保留对象（api_key_enc / content_descriptors / hide_uninterested 等）必须仍在。
// 这些断言锁的是「代码与库同步清理」——只删库不删代码，migrate 会把对象建回来。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { ensureSteamSchema } from '../src/steam-login.js';
import { ingestOffers } from '../src/ingest.js';

const steamPlatform = { code: 'steam', name: 'Steam 国区', kind: 'official' };

function offer(appid, priceCents) {
  return {
    platformCode: 'steam',
    platformProductId: String(appid),
    steamAppid: appid,
    title: `game-${appid}`,
    productType: 'official_direct',
    region: 'cn',
    currency: 'CNY',
    priceCents,
    originalCents: priceCents,
    discountPct: 0,
    inStock: true,
    buyUrl: `https://store.steampowered.com/app/${appid}/`,
    meta: {},
  };
}

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureSteamSchema(store);
  return store;
}

const columns = async (store, table) =>
  (await store.query('select column_name from information_schema.columns where table_name = $1 order by ordinal_position', [table])).rows.map(
    (r) => r.column_name,
  );

test('BF：新库 migrate 后不再有 steam_sessions / users.steam_id / offers.risk_level / user_wishlist.steam_ids', async () => {
  const store = await fresh();
  try {
    const tables = (await store.query("select table_name from information_schema.tables where table_schema = 'public'")).rows.map((r) => r.table_name);
    assert.ok(!tables.includes('steam_sessions'), 'steam_sessions 表不再创建');
    const users = await columns(store, 'users');
    assert.ok(!users.includes('steam_id'), 'users.steam_id 列不再创建（含 users_steam_uniq 索引）');
    const offers = await columns(store, 'offers');
    assert.ok(!offers.includes('risk_level'), 'offers.risk_level 列不再创建');
    const uw = await columns(store, 'user_wishlist');
    assert.ok(!uw.includes('steam_ids'), 'user_wishlist.steam_ids 列不再创建');
  } finally {
    await store.close();
  }
});

test('BF：保留对象仍在（api_key_enc / content_descriptors / age_ratings / interested / owned / hide_uninterested）', async () => {
  const store = await fresh();
  try {
    const accounts = await columns(store, 'steam_accounts');
    assert.ok(accounts.includes('api_key_enc'), 'steam_accounts.api_key_enc 保留（账号同步用 key）');
    const games = await columns(store, 'games');
    for (const name of ['content_descriptors', 'age_ratings', 'interested', 'owned']) {
      assert.ok(games.includes(name), `games.${name} 保留`);
    }
    const prefs = await columns(store, 'user_prefs');
    assert.ok(prefs.includes('hide_uninterested'), 'user_prefs.hide_uninterested 保留（老客户端兼容）');
  } finally {
    await store.close();
  }
});

test('BF：offers 入库不再写 risk_level，INSERT 路径可跑通', async () => {
  const store = await fresh();
  try {
    const stats = await ingestOffers(store, { platform: steamPlatform, offers: [offer(1091500, 9900)] });
    assert.equal(stats.inserted, 1, '无 risk_level 字段时 INSERT 正常');
    const row = (
      await store.query('select price_cents from offers where game_id = (select id from games where steam_appid = 1091500) limit 1')
    ).rows[0];
    assert.equal(Number(row.price_cents), 9900);
  } finally {
    await store.close();
  }
});
