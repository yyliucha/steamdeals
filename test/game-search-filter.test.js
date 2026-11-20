// DA 批（docs/APP-FILTER-SERVER-SIDE.md §4 验收）：App/Web 共用的四个筛选开关 + sort=heat/release。
// 锁住的约束：
//   1) discountOnly 只认官方+授权渠道、在售、折扣 > 0（C2C 折扣/缺货折扣不进）；
//   2) histLowOnly 口径 = 当前价 <= 历史最低（含当天；有价无史不命中）；
//   3) freeOnly = is_free 标记为主 + 兼容 0 元官方报价；
//   4) unreleased = release_date 在未来，无日期回退 coming_soon；不含「已发售但无报价」；
//   5) 四个开关互斥，优先级 unreleased > freeOnly > histLowOnly > discountOnly；
//   6) count（total）与列表同条件；sort=heat/release 全库排序；读模型与 legacy 双口径一致；
//   7) user_prefs.only_discount 死字段删除（迁移 drop 列 + getPrefs/savePrefs 不再读写）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { ensureSteamSchema } from '../src/steam-login.js';

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureSteamSchema(store);
  const q = (sql, p) => store.query(sql, p);
  return { store, q };
}

// 与 game-search-read-model.test.js 同模式：默认读模型 / READ_MODEL=legacy 双口径
async function searchRm(q, opts) {
  delete process.env.READ_MODEL;
  try {
    return await db.gameSearch(q, opts);
  } finally {
    delete process.env.READ_MODEL;
  }
}
async function searchLegacy(q, opts) {
  process.env.READ_MODEL = 'legacy';
  try {
    return await db.gameSearch(q, opts);
  } finally {
    delete process.env.READ_MODEL;
  }
}

/** 按 DA 筛选口径种一套数据集（每条都注释它守的口径）。 */
async function seedFilter({ q }) {
  const g = async (appid, fields) => {
    const { name, heat = null, releaseDate = null, steamStatus = null, isFree = false, deleted = false, blocked = false } = fields;
    const r = await q(
      'insert into games (steam_appid, name, heat, release_date, steam_status, is_free, deleted, blocked) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
      [appid, name, heat, releaseDate, steamStatus, isFree, deleted, blocked],
    );
    return Number(r.rows[0].id);
  };
  const offer = async (gameId, { code = 'steam', kind = 'official', price, original = null, discount = 0, inStock = true }) => {
    await q('insert into platforms (code, name, kind) values ($1,$2,$3) on conflict (code) do nothing', [code, code.toUpperCase(), kind]);
    await q(
      'insert into offers (game_id, platform_code, product_type, region, currency, price_cents, original_cents, discount_pct, in_stock) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [gameId, code, kind === 'official' ? 'official_direct' : 'authorized_direct', 'cn', 'CNY', price, original, discount, inStock],
    );
  };
  const daily = async (gameId, { price, day = 'current_date' }) => {
    await q(
      `insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) values ($1,'steam','cn',${day},$2,'CNY')`,
      [gameId, price],
    );
  };

  const ids = {};
  // 折扣口径：官方折扣命中；无折扣不命中；C2C 折扣不命中；缺货折扣不命中
  ids.d1 = await g(8001, { name: '折扣游戏', heat: 50, releaseDate: '2024-01-01' });
  ids.d2 = await g(8002, { name: '无折扣', heat: 49, releaseDate: '2024-01-02' });
  ids.d3 = await g(8003, { name: 'C2C折扣', heat: 48, releaseDate: '2024-01-03' });
  ids.d4 = await g(8004, { name: '缺货折扣', heat: 47, releaseDate: '2024-01-04' });
  await offer(ids.d1, { price: 5000, original: 10000, discount: 50 });
  await offer(ids.d2, { price: 9000, original: 9000, discount: 0 });
  await offer(ids.d3, { price: 9000, original: 9000, discount: 0 });
  await offer(ids.d3, { code: 'steampy', kind: 'c2c', price: 100, original: 10000, discount: 99 });
  await offer(ids.d4, { price: 5000, original: 10000, discount: 50, inStock: false });

  // 史低口径：当前价 = 历史最低命中；当前价 > 史低不命中；有价无史不命中
  ids.h1 = await g(8005, { name: '史低命中', heat: 46, releaseDate: '2024-01-05' });
  ids.h2 = await g(8006, { name: '史低不命中', heat: 45, releaseDate: '2024-01-06' });
  ids.h3 = await g(8007, { name: '有价无史', heat: 44, releaseDate: '2024-01-07' });
  await offer(ids.h1, { price: 5000, original: 5000, discount: 0 });
  await daily(ids.h1, { price: 5000 });
  await daily(ids.h1, { price: 6000, day: 'current_date - 1' });
  await offer(ids.h2, { price: 6000, original: 6000, discount: 0 });
  await daily(ids.h2, { price: 4000 });
  await daily(ids.h2, { price: 4000, day: 'current_date - 1' });
  await offer(ids.h3, { price: 7000, original: 7000, discount: 0 });

  // 免费口径：is_free 命中；0 元报价兼容命中；付费不命中
  ids.f1 = await g(8008, { name: '免费标记', heat: 43, releaseDate: '2024-01-08', isFree: true });
  ids.f2 = await g(8009, { name: '零元报价', heat: 42, releaseDate: '2024-01-09' });
  ids.f3 = await g(8010, { name: '付费游戏', heat: 41, releaseDate: '2024-01-10' });
  await offer(ids.f1, { price: 0, original: 0, discount: 0 });
  await offer(ids.f2, { price: 0, original: 0, discount: 0 });
  await offer(ids.f3, { price: 3000, original: 3000, discount: 0 });

  // 未发售口径：未来日期命中；无日期 + coming_soon 命中；已发售无报价不命中；已删除不命中
  ids.u1 = await g(8011, { name: '未来发售', heat: 40, releaseDate: '2099-01-01' });
  ids.u2 = await g(8012, { name: '即将推出', heat: 39, steamStatus: 'coming_soon' });
  ids.u3 = await g(8013, { name: '已发售无报价', heat: 38, releaseDate: '2020-01-01' });
  ids.u4 = await g(8014, { name: '删除的未来作', heat: 37, releaseDate: '2099-02-01', deleted: true });
  await offer(ids.u2, { price: 5000, original: 5000, discount: 0 });

  // 互斥优先级：同时满足「未发售 + 免费 + 折扣」的对照游戏（u2 有 0 元报价？重新种一个带折扣的未发售）
  ids.p1 = await g(8015, { name: '未发售兼折扣', heat: 36, releaseDate: '2099-03-01' });
  await offer(ids.p1, { price: 5000, original: 10000, discount: 50 });

  // 排序数据：heat 与 release_date 各不相同（含 null release_date 的 u2）
  for (const gid of Object.values(ids)) {
    await db.refreshGameRegionPrices(q, gid);
    await db.refreshGameRegionHist(q, gid);
  }
  return { ids };
}

test('discountOnly：只返回官方+授权渠道在售折扣（C2C/缺货/无折扣不进；验收 1）', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedFilter({ q });
    for (const compact of [true, false]) {
      const rm = await searchRm(q, { region: 'cn', compact, discountOnly: true });
      const got = rm.rows.map((r) => String(r.id)).sort();
      // p1 是「未发售兼折扣」：有在售官方折扣报价，单传 discountOnly 时也命中（口径一致）
      assert.deepEqual(got, [String(ids.d1), String(ids.p1)].sort(), `compact=${compact}：只有官方在售折扣游戏（C2C 折扣/缺货折扣/无折扣不进）`);
      assert.equal(rm.total, 2, 'total 与列表同条件');
    }
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});

test('histLowOnly：当前价 <= 历史最低才命中（含当天史低；有价无史不命中；验收 2 口径）', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedFilter({ q });
    for (const compact of [true, false]) {
      const rm = await searchRm(q, { region: 'cn', compact, histLowOnly: true });
      const got = rm.rows.map((r) => String(r.id)).sort();
      assert.deepEqual(got, [String(ids.h1)], `compact=${compact}：当前价=史低命中；当前价>史低/无史不命中`);
      assert.equal(rm.total, 1);
      const legacy = await searchLegacy(q, { region: 'cn', compact, histLowOnly: true });
      assert.deepEqual(
        legacy.rows.map((r) => String(r.id)).sort(),
        got,
        'legacy 子查询口径与读模型 rs 列口径一致',
      );
      assert.equal(legacy.total, rm.total);
    }
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});

test('freeOnly：is_free 标记 + 0 元官方报价都命中；付费不命中', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedFilter({ q });
    const rm = await searchRm(q, { region: 'cn', compact: true, freeOnly: true });
    const got = rm.rows.map((r) => String(r.id)).sort();
    assert.deepEqual(got, [String(ids.f1), String(ids.f2)].sort(), 'is_free 与 0 元报价兼容命中');
    assert.equal(rm.total, 2, 'total 与列表同条件');
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});

test('unreleased：未来日期 / 无日期 + coming_soon 命中；已发售无报价与已删除不命中', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedFilter({ q });
    const rm = await searchRm(q, { region: 'cn', compact: true, unreleased: true });
    const got = rm.rows.map((r) => String(r.id)).sort();
    // p1 的 release_date=2099-03-01 同样命中；u3（已发售无报价）与 u4（已删除）不命中
    assert.deepEqual(got, [String(ids.u1), String(ids.u2), String(ids.p1)].sort(), '不含已发售无报价（u3）与已删除（u4）');
    assert.equal(rm.total, 3);
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});

test('互斥优先级：unreleased > freeOnly > histLowOnly > discountOnly（同时传多个取第一个）', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedFilter({ q });
    // p1 同时满足 unreleased 与 discountOnly：同传时若按 unreleased，结果 = 未发售集 {u1,u2,p1}（不含只满足折扣的 d1）
    const allFour = await searchRm(q, {
      region: 'cn', compact: true, unreleased: true, freeOnly: true, histLowOnly: true, discountOnly: true,
    });
    assert.deepEqual(allFour.rows.map((r) => String(r.id)).sort(), [String(ids.u1), String(ids.u2), String(ids.p1)].sort(), 'unreleased 优先，其它开关被忽略');
    // 只传 freeOnly + histLowOnly + discountOnly → 按 freeOnly（f1/f2，不含 h1/d1/p1）
    const freeFirst = await searchRm(q, { region: 'cn', compact: true, freeOnly: true, histLowOnly: true, discountOnly: true });
    assert.deepEqual(freeFirst.rows.map((r) => String(r.id)).sort(), [String(ids.f1), String(ids.f2)].sort(), 'freeOnly 次优先');
    // 只传 histLowOnly + discountOnly → 按 histLowOnly（h1，不含 d1/p1）
    const histFirst = await searchRm(q, { region: 'cn', compact: true, histLowOnly: true, discountOnly: true });
    assert.deepEqual(histFirst.rows.map((r) => String(r.id)).sort(), [String(ids.h1)], 'histLowOnly 优先于 discountOnly');
    // 单传 discountOnly 不受影响（d1 + 未发售兼折扣的 p1）
    const discOnly = await searchRm(q, { region: 'cn', compact: true, discountOnly: true });
    assert.deepEqual(discOnly.rows.map((r) => String(r.id)).sort(), [String(ids.d1), String(ids.p1)].sort());
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});

test('sort=heat：全库按 heat desc nulls last, id desc（验收 2/4）', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedFilter({ q });
    const rm = await searchRm(q, { region: 'cn', compact: true, sort: 'heat' });
    const heats = rm.rows.map((r) => [Number(r.heat), Number(r.id)]);
    for (let i = 1; i < heats.length; i += 1) {
      const [ph, pid] = heats[i - 1];
      const [ch, cid] = heats[i];
      assert.ok(ph > ch || (ph === ch && pid > cid), `heat 降序且同 heat 时 id 降序：${heats[i - 1]} vs ${heats[i]}`);
    }
    // 读模型集合 = 有报价的游戏（u1/u3 无报价不进）；heat 最高 d1 在最前
    assert.deepEqual(rm.rows.slice(0, 4).map((r) => String(r.id)), [ids.d1, ids.d2, ids.d3, ids.d4].map(String), 'heat 降序前 4 = 折扣组');
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});

test('sort=release：全库按 release_date desc nulls last, id desc；筛选与排序正交', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedFilter({ q });
    const rm = await searchRm(q, { region: 'cn', compact: true, sort: 'release' });
    const rows = rm.rows;
    const withDate = rows.filter((r) => r.release_date != null).map((r) => String(r.id));
    const nullDate = rows.filter((r) => r.release_date == null).map((r) => String(r.id));
    // 读模型集合不含无报价的 u1/u3（口径：有历史/有报价）；u4 已删除。
    // release_date 降序：p1(2099-03-01) > f3 > f2 > f1 > h3 > h2 > h1 > d4 > d3 > d2 > d1；null（u2）最后
    assert.deepEqual(
      withDate,
      [ids.p1, ids.f3, ids.f2, ids.f1, ids.h3, ids.h2, ids.h1, ids.d4, ids.d3, ids.d2, ids.d1].map(String),
      'release_date 降序（未来最前）',
    );
    assert.deepEqual(nullDate, [String(ids.u2)], 'null release_date 排最后');
    // 筛选 + 排序组合：discountOnly + sort=heat 只有 d1 在前、p1 在后（heat 50 vs 36）
    const combo = await searchRm(q, { region: 'cn', compact: true, discountOnly: true, sort: 'heat' });
    assert.deepEqual(combo.rows.map((r) => String(r.id)), [String(ids.d1), String(ids.p1)]);
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});

test('count 与列表同条件：分页 total = 全库匹配数，第二页正确（验收 5）', async () => {
  const { store, q } = await fresh();
  try {
    const { ids } = await seedFilter({ q });
    // 折扣筛选 2 条：total=2、pages=1
    const one = await searchRm(q, { region: 'cn', compact: true, pageSize: 5, page: 1, discountOnly: true });
    assert.equal(one.total, 2);
    assert.equal(one.rows.length, 2);
    assert.equal(one.pages, 1);
    // 无筛选全库 12 款（读模型口径：有报价；u1/u3 无报价、u4 已删除不计）：pageSize=5 时 pages=3，第二页 5 条且不重复
    const all = await searchRm(q, { region: 'cn', compact: true, pageSize: 5, page: 2 });
    assert.equal(all.total, 12, '全库 12 款（读模型有报价口径）');
    assert.equal(all.rows.length, 5);
    assert.equal(all.pages, 3);
    const seen = new Set(all.rows.map((r) => String(r.id)));
    assert.equal(seen.size, 5, '第二页不重复');
    // 未发售筛选 total=3（含无报价的 u1，豁免读模型限制）与列表一致；pageSize 最小钳制 5 → 一页 3 条
    const un = await searchRm(q, { region: 'cn', compact: true, pageSize: 2, page: 1, unreleased: true });
    assert.equal(un.total, 3);
    assert.equal(un.rows.length, 3, 'total=3 与列表 3 条一致');
    assert.equal(un.pages, 1);
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});

test('EF 批：rating=adult|mature|none 读模型与 legacy 双口径一致（与后台 admin 同一条件）', async () => {
  const { store, q } = await fresh();
  try {
    // 独立数据集：三款全部带报价 + 日价（legacy 前置条件 = exists daily_prices），双口径集合一致
    const seed = async (appid, name, adult, mature) => {
      const r = await q(
        'insert into games (steam_appid, name, adult_flag, mature_flag) values ($1,$2,$3,$4) returning id',
        [appid, name, adult, mature],
      );
      const id = Number(r.rows[0].id);
      await q("insert into platforms (code, name, kind) values ('steam','Steam','official') on conflict (code) do nothing");
      await q(
        "insert into offers (game_id, platform_code, product_type, region, currency, price_cents) values ($1,'steam','official_direct','cn','CNY',1000)",
        [id],
      );
      await q(
        "insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) values ($1,'steam','cn', current_date, 1000, 'CNY')",
        [id],
      );
      await db.refreshGameRegionPrices(q, id);
      await db.refreshGameRegionHist(q, id);
      return id;
    };
    const noneId = await seed(8101, '未标注', false, false);
    const adultId = await seed(8102, '十八禁', true, false);
    const matureId = await seed(8103, '成熟作', false, true);

    for (const [rating, expected] of [
      ['adult', [adultId]],
      ['mature', [matureId]],
      ['none', [noneId]],
    ]) {
      const rm = await searchRm(q, { region: 'cn', compact: true, adult: 'badge', rating });
      const legacy = await searchLegacy(q, { region: 'cn', compact: true, adult: 'badge', rating });
      const expectIds = expected.map(String).sort();
      assert.deepEqual(rm.rows.map((r) => String(r.id)).sort(), expectIds, `rating=${rating}：读模型命中`);
      assert.deepEqual(legacy.rows.map((r) => String(r.id)).sort(), expectIds, `rating=${rating}：legacy 口径一致`);
      assert.equal(legacy.total, rm.total, `rating=${rating}：total 双口径一致`);
    }
    // 空 rating = 不过滤（「取消恢复全部」）
    const all = await searchRm(q, { region: 'cn', compact: true, adult: 'badge' });
    assert.equal(all.total, 3, '不带 rating 时三款全量可见');
  } finally {
    delete process.env.READ_MODEL;
    await store.close();
  }
});

test('user_prefs.only_discount 死字段删除：迁移 drop 列 + prefs 读写不再含该键', async () => {
  const { store, q } = await fresh();
  try {
    const col = await q(
      `select count(*)::int as n from pg_attribute where attrelid = 'user_prefs'::regclass and attname = 'only_discount'`,
    );
    assert.equal(col.rows[0].n, 0, '迁移后 user_prefs 不再有 only_discount 列');
    const user = await db.createUser(q, { username: 'bob', password: 'bob123456' });
    const saved = await db.savePrefs(q, user.id, { sort: 'price', only_discount: true });
    assert.equal(saved.only_discount, undefined, 'savePrefs 响应不再含 only_discount（传了也被忽略，兼容老客户端）');
    assert.equal(saved.sort, 'price');
    const got = await db.getPrefs(q, user.id);
    assert.equal(got.only_discount, undefined, 'getPrefs 不再返回 only_discount');
    assert.equal(got.hide_uninterested, false, 'hide_uninterested 由 tab===\'on\' 派生（默认 tab=all → false）');
  } finally {
    await store.close();
  }
});
