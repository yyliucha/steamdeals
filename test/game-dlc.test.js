// BP 批（docs/GAME-DLC.md §4 验收）：DLC 总数与列表——
// dlc_appids 提取/去重/上限、game_dlc 占位/补齐/差集、详情摘要、列表接口分页与回源节流、前端静态断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { normalizeOfficial } from '../src/adapters/steam-meta.js';
import { fillDlcDetails } from '../src/dlc-fill.js';
import { startApiServer } from '../src/server.js';
import { runSteamStatusRound } from '../src/steam-status.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  return store;
}
const qOf = (store) => (sql, p) => store.query(sql, p);

test('BP-1：normalizeOfficial 提取 dlcAppIds——正整数、去重、上限 2000；无 dlc 字段为 null', () => {
  const a = normalizeOfficial(916440, { name: 'Anno 1800', type: 'game', dlc: [11, 12, 12, 0, -3, 'x', 1.5] });
  assert.deepEqual(a.dlcAppIds, [11, 12], '去重/过滤非正整数');
  const many = Array.from({ length: 2100 }, (_, i) => i + 1);
  const b = normalizeOfficial(916440, { dlc: many });
  assert.equal(b.dlcAppIds.length, 2000, '上限 2000');
  assert.equal(b.dlcAppIds[1999], 2000);
  const c = normalizeOfficial(916440, { name: 'x' });
  assert.equal(c.dlcAppIds, null, '无 dlc 字段 → null（不清空已有值）');
});

test('BP-1：writeDlcAppids 建占位行 + 差集清理；空数组清空明细；upsertGameMeta 不写 null 覆盖', async () => {
  const store = await fresh();
  try {
    const q = qOf(store);
    await db.upsertGameMeta(q, { steamAppid: 916440, nameZh: 'Anno 1800' });
    const w = await db.writeDlcAppids(q, { steamAppid: 916440, dlcAppIds: [11, 12] });
    assert.equal(w.dlc, 2);
    assert.ok(w.gameId, '返回 gameId');
    let rows = await db.listGameDlc(q, { gameId: w.gameId });
    assert.deepEqual(rows.map((r) => r.appid).sort(), [11, 12], '占位行已建');
    assert.equal(rows.every((r) => r.name === null), true, '占位行 name 为空');

    // 补一批明细后改 dlc 列表 → 差集删除
    await db.upsertGameDlc(q, { gameId: w.gameId, items: [{ steamAppid: 11, nameZh: 'DLC A', priceOverview: { final: 4800, initial: 4800, discountPercent: 0, currency: 'CNY' } }] });
    await db.writeDlcAppids(q, { steamAppid: 916440, dlcAppIds: [11] });
    rows = await db.listGameDlc(q, { gameId: w.gameId });
    assert.deepEqual(rows.map((r) => r.appid), [11], '差集删除 12');

    // dlc=[] → 全部清理
    await db.writeDlcAppids(q, { steamAppid: 916440, dlcAppIds: [] });
    assert.equal(await db.countGameDlc(q, { gameId: w.gameId }), 0, '空数组清空明细');
    const s = await db.dlcSummary(q, { steamAppid: 916440 });
    assert.deepEqual(s, { total: 0, synced: true, filled: 0 }, 'dlc=[] 是 synced（拿到过 dlc[]，为空）');

    // GetItems 路径（dlcAppIds=null）不得清空已有值
    await db.writeDlcAppids(q, { steamAppid: 916440, dlcAppIds: [11] });
    await db.upsertGameMeta(q, { steamAppid: 916440, nameZh: 'Anno 1800' });
    const s2 = await db.dlcSummary(q, { steamAppid: 916440 });
    assert.equal(s2.total, 1, 'upsertGameMeta 无 dlcAppIds 不清空');
  } finally {
    await store.close();
  }
});

test('BP-1：upsertGameDlc upsert 名称/价格/折扣/币种', async () => {
  const store = await fresh();
  try {
    const q = qOf(store);
    await db.upsertGameMeta(q, { steamAppid: 1, nameZh: 'G' });
    const w = await db.writeDlcAppids(q, { steamAppid: 1, dlcAppIds: [101] });
    await db.upsertGameDlc(q, { gameId: w.gameId, items: [{ steamAppid: 101, nameZh: 'DLC X', priceOverview: { final: 2400, initial: 4800, discountPercent: 50, currency: 'CNY' } }] });
    await db.upsertGameDlc(q, { gameId: w.gameId, items: [{ steamAppid: 101, nameZh: 'DLC X 新', priceOverview: { final: 1200, initial: 4800, discountPercent: 75, currency: 'CNY' } }] });
    const [row] = await db.listGameDlc(q, { gameId: w.gameId });
    assert.equal(row.name, 'DLC X 新', 'upsert 覆盖');
    assert.equal(row.price_cents, 1200);
    assert.equal(row.discount_pct, 75);
    assert.equal(row.currency, 'CNY');
  } finally {
    await store.close();
  }
});

test('BP-2：fillDlcDetails 每游戏 ≤3 批（读路径）+ 整批失败换游戏 + 429 标记', async () => {
  const store = await fresh();
  try {
    const q = qOf(store);
    await db.upsertGameMeta(q, { steamAppid: 1, nameZh: 'G1' });
    await db.upsertGameMeta(q, { steamAppid: 2, nameZh: 'G2' });
    const g1 = (await db.writeDlcAppids(q, { steamAppid: 1, dlcAppIds: [11, 12, 13] })).gameId;
    const g2 = (await db.writeDlcAppids(q, { steamAppid: 2, dlcAppIds: [21] })).gameId;
    const calls = [];
    const fake = async (appids) => {
      calls.push([...appids]);
      if (appids.includes(21)) throw Object.assign(new Error('limited'), { status: 429 });
      return { items: appids.map((a) => ({ steamAppid: a, nameZh: `N${a}`, priceOverview: { final: 100, initial: 100, discountPercent: 0, currency: 'CNY' } })), failed: [] };
    };
    const r = await fillDlcDetails(q, { gameIds: [g1, g2], maxBatches: 3, key: 'test', fetchImpl: fake });
    assert.ok(r.dlcs >= 3, 'g1 明细补齐');
    assert.equal(calls.length, 2, 'g1 一批 + g2 一批后 429 停（≤3 批上限内）');
    assert.equal(r.aborted429, true, '429 标记');
    // 429 不影响已有 dlc_appids
    assert.equal((await db.dlcSummary(q, { steamAppid: 2 })).total, 1);
  } finally {
    await store.close();
  }
});

test('BP-2/3：详情 dlc 摘要 + 列表接口（分页/排序/buy_url/非法页回落/上限 50/非 Steam 空集/回源节流与降级）', async () => {
  const store = await fresh();
  try {
    const q = qOf(store);
    process.env.STEAM_API_KEY = 'test-key';
    await db.upsertGameMeta(q, { steamAppid: 100, nameZh: 'Base' });
    await db.upsertGameMeta(q, { steamAppid: 998, nameZh: 'NeverSynced' }); // 从未拿到过 dlc[]
    await db.writeDlcAppids(q, { steamAppid: 100, dlcAppIds: [201, 202, 203] });
    // 201/202 有明细；203 缺明细（触发回源）
    const gid = (await db.dlcSummary(q, { steamAppid: 100 }), (await q('select id from games where steam_appid=100')).rows[0].id);
    await db.upsertGameDlc(q, { gameId: gid, items: [
      { steamAppid: 201, nameZh: 'Alpha DLC', priceOverview: { final: 4800, initial: 4800, discountPercent: 0, currency: 'CNY' } },
      { steamAppid: 202, nameZh: 'Beta DLC', priceOverview: { final: 2400, initial: 4800, discountPercent: 50, currency: 'CNY' } },
    ] });

    let fetchCalls = 0;
    const dlcFetchImpl = async (appids) => {
      fetchCalls += 1;
      return { items: appids.map((a) => ({ steamAppid: a, nameZh: `DLC ${a}`, priceOverview: { final: 9900, initial: 9900, discountPercent: 0, currency: 'CNY' } })), failed: [] };
    };
    const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1', dlcFetchImpl });
    const base = `http://127.0.0.1:${srv.port}`;
    try {
      // 详情摘要
      const det = await (await fetch(`${base}/api/games/100`)).json();
      assert.deepEqual(det.dlc, { total: 3, synced: true, filled: 2 }, '详情 dlc 摘要');
      // 列表：回源触发（203 缺明细）→ 补齐；排序名称升序；buy_url
      const r1 = await (await fetch(`${base}/api/games/100/dlc`)).json();
      assert.equal(r1.total, 3);
      assert.equal(r1.synced, true, '回源补齐后 synced');
      assert.deepEqual(r1.items.map((d) => d.name), ['Alpha DLC', 'Beta DLC', 'DLC 203'], '名称升序');
      assert.equal(r1.items[0].buy_url, 'https://store.steampowered.com/app/201/', 'buy_url 由 appid 构造');
      assert.equal(r1.pageSize, 10, '默认 10');
      assert.equal(fetchCalls, 1, '首次打开触发回源');
      // 10 分钟内再次打开不再请求（节流）
      await fetch(`${base}/api/games/100/dlc`);
      assert.equal(fetchCalls, 1, '节流：10 分钟内不回源');
      // 非法 page 回落 1；pageSize 上限 50
      const r2 = await (await fetch(`${base}/api/games/100/dlc?page=abc&pageSize=999`)).json();
      assert.equal(r2.page, 1);
      assert.equal(r2.pageSize, 50);
      // 从未同步过 dlc[] 的游戏：空集 + synced false（前端不显示区块）
      const r3 = await (await fetch(`${base}/api/games/998/dlc`)).json();
      assert.deepEqual(r3, { total: 0, page: 1, pageSize: 10, synced: false, items: [] });
      // 不存在的游戏 404
      assert.equal((await fetch(`${base}/api/games/123456/dlc`)).status, 404);
    } finally {
      await srv.close();
    }
    // 回源失败降级：新的实例、失败实现 → synced false + 名称回退，不 5xx
    const failing = async () => { throw Object.assign(new Error('limited'), { status: 429 }); };
    const srv2 = await startApiServer({ query: q, port: 0, host: '127.0.0.1', dlcFetchImpl: failing });
    try {
      await db.writeDlcAppids(q, { steamAppid: 100, dlcAppIds: [201, 202, 203, 204] }); // 新增缺明细行
      const r4 = await (await fetch(`http://127.0.0.1:${srv2.port}/api/games/100/dlc?page=1&pageSize=10`)).json();
      assert.equal(r4.synced, false, '回源失败 synced=false');
      const names = r4.items.map((d) => d.name);
      assert.ok(names.includes('DLC #203') || names.includes('DLC #204'), '缺明细名称回退 DLC #<appid>');
    } finally {
      await srv2.close();
      delete process.env.STEAM_API_KEY;
    }
  } finally {
    await store.close();
  }
});

test('BP-1/4：steam-status 一轮顺带写 dlc_appids（日志 steam.status.dlc_written；不新增调度任务）', async () => {
  const store = await fresh();
  try {
    const q = qOf(store);
    await db.upsertGameMeta(q, { steamAppid: 7, nameZh: 'G7' });
    const fakeFetch = async (url) => ({
      json: {
        '7': { success: true, data: { name: 'G7', type: 'game', is_free: true, dlc: [71, 72, 71] } },
      },
      ok: true,
      status: 200,
    });
    const events = [];
    const logger = { info: (e, f) => events.push([e, f]), warn: () => {}, debug: () => {} };
    const r = await runSteamStatusRound(q, { limit: 1, rateMs: 0, fetchJsonImpl: fakeFetch, logger, dlcFetchImpl: async () => ({ items: [], failed: [] }) });
    assert.equal(r.dlcWritten, 1, '本轮写 dlc_appids 的游戏数');
    assert.ok(events.some(([e, f]) => e === 'steam.status.dlc_written' && f.appid === 7 && f.dlc === 2), '日志 steam.status.dlc_written');
    const s = await db.dlcSummary(q, { steamAppid: 7 });
    assert.equal(s.total, 2, '去重后入库');
    assert.equal(s.synced, true);
  } finally {
    await store.close();
  }
});

test('BP-3：前端静态断言——内联 DLC 区块/Steam 跳转/移动端卡片/无 DLC 与同步提示/非 Steam 不显示', () => {
  const home = read('../frontend/src/pages/Home.vue');
  assert.match(home, /DLC（共 \{\{ detail\.dlc\.total \}\} 个）/);
  assert.match(home, /Steam 不提供 DLC 拥有数据/);
  assert.match(home, /dlcUrl\(d\.appid\)/, '名称与 Steam ↗ 用同一链接');
  assert.match(home, /https:\/\/store\.steampowered\.com\/app\/\$\{appid\}\//, 'Steam 商店跳转');
  assert.match(home, /rel="noopener noreferrer nofollow"/, '外部链接 noopener');
  assert.match(home, /dlc-cards/, '移动端卡片');
  assert.match(home, /暂无 DLC/, '空态');
  assert.match(home, /DLC 信息加载失败，稍后重试/, '失败文案');
  assert.match(home, /部分 DLC 信息待同步/, 'synced=false 提示');
  assert.match(home, /detail\.game\.steam_appid && detail\.dlc\?\.total > 0/, '非 Steam/无 DLC 不显示区块');
  assert.match(home, /loadDlc\(1\)/, '打开详情自动拉第 1 页');
  const bar = read('../frontend/src/components/PaginationBar.vue');
  assert.match(bar, /pageSizes/, 'PaginationBar 支持自定义每页条数');
  const css = read('../frontend/src/styles/main.css');
  assert.match(css, /\.dlc-row\{/, '列表样式');
  assert.match(css, /\.dlc-card\{/, '移动卡片样式');
});
