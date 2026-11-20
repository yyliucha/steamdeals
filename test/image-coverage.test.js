// BC 批（docs/IMAGE-COVERAGE.md §4）：封面图补图覆盖率——
// ① steam-status 同一次 appdetails 响应顺带补 header_image（只在库内为空时写）；
// ② images.limit 默认 500；③ POST /api/admin/images/reset-miss 清空缺图负缓存（鉴权 + cleared）。
// EC 批（docs/IMAGE-COVERAGE.md §8）：④ 缺图回填 backfillMissingHeaders（缺图数下降）；
// ⑤ 覆盖看板 GET /api/admin/images/coverage（数字与 SQL 一致、分页、原因、鉴权）；
// ⑥ 手动回填 POST /api/admin/images/backfill（鉴权 + 202 + single-flight 409）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { applySteamDetails } from '../src/steam-status.js';
import { backfillMissingHeaders } from '../src/image-backfill.js';
import * as settings from '../src/settings.js';

test('fillHeaderImage：库内为空才写，已有值不被覆盖（coalesce 保护）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await db.ensureGame(q, { steamAppid: 990001, name: 'BC Test' });
    const first = await db.fillHeaderImage(q, { steamAppid: 990001, url: 'https://shared.akamai.steamstatic.com/a/header.jpg' });
    assert.equal(first.rowCount, 1, '首次写入');
    const row = (await q('select header_image from games where steam_appid = $1', [990001])).rows[0];
    assert.match(row.header_image, /a\/header\.jpg/);
    const second = await db.fillHeaderImage(q, { steamAppid: 990001, url: 'https://shared.akamai.steamstatic.com/b/header.jpg' });
    assert.equal(second.rowCount, 0, '已有值时不覆盖');
    const after = (await q('select header_image from games where steam_appid = $1', [990001])).rows[0];
    assert.match(after.header_image, /a\/header\.jpg/);
  } finally {
    await store.close();
  }
});

test('steam-status：appdetails 带 header_image 时顺带补齐（即使状态判定不了也照补）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const logs = [];
  const logger = { info: (event, data) => logs.push({ event, data }), warn: (event, data) => logs.push({ event, data }), debug: () => {} };
  try {
    await db.ensureGame(q, { steamAppid: 990002, name: 'BC Header' });
    const meta = { headerImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/990002/x/header.jpg' };
    const out = await applySteamDetails(q, { appid: 990002, meta, logger });
    assert.equal(out.headerImageFilled, true, '返回标记已补');
    assert.ok(logs.some((l) => l.event === 'steam-status.header_image_filled' && l.data.appid === 990002), '日志事件');
    const row = (await q('select header_image from games where steam_appid = $1', [990002])).rows[0];
    assert.match(row.header_image, /store_item_assets/);
    // 第二次同响应：已有值不重复写
    const again = await applySteamDetails(q, { appid: 990002, meta, logger });
    assert.equal(again.headerImageFilled, false);
  } finally {
    await store.close();
  }
});

test('images.limit 默认 500（BC 批）', () => {
  const def = settings.SETTINGS.find((d) => d.key === 'images.limit');
  assert.ok(def, '设置项存在');
  assert.equal(def.default, 500);
});

test('POST /api/admin/images/reset-miss：匿名 401、普通用户 403、管理员 200 且返回 cleared', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  const savedEnv = { ...process.env };
  process.env.CAPTCHA_ENABLED = '0';
  let srv;
  try {
    srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${srv.port}`;
    const login = async (username, password) => {
      const res = await fetch(`${base}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(res.status, 200, `登录 ${username}`);
      return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    };
    assert.equal((await fetch(`${base}/api/admin/images/reset-miss`, { method: 'POST' })).status, 401, '匿名 401');
    const aliceCookie = await login('alice', 'alice123456');
    assert.equal(
      (await fetch(`${base}/api/admin/images/reset-miss`, { method: 'POST', headers: { cookie: aliceCookie } })).status,
      403,
      '普通用户 403',
    );
    const adminCookie = await login('admin', 'admin123456');
    const res = await fetch(`${base}/api/admin/images/reset-miss`, { method: 'POST', headers: { cookie: adminCookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.cleared, 'number', '返回 cleared 数量');
  } finally {
    await srv?.close?.();
    await store.close();
    process.env = savedEnv;
  }
});
// 回归：BC 批的回填候选必须是「OR 扩展」，不能写成独立 AND（那样反而收窄候选、补不到图）
// BL 批起候选谓词统一在 src/store/pg.js 的 backfillCandidateWhere（CLI 与统计共用）。
test('backfill 候选 SQL：header_image 条件并入描述/报价的 OR 组', () => {
  const src = readFileSync(new URL('../src/store/pg.js', import.meta.url), 'utf8');
  assert.match(
    src,
    /or \(g\.header_image is null and exists \(select 1 from offers o where o\.game_id = g\.id\)\)\)/,
    'header_image 条件在括号内以 OR 连接',
  );
  assert.doesNotMatch(src, /"and \(g\.header_image is null and exists/, '不能是独立的 AND 条件');
});

// ---------------------------------------------------------------- EC 批（docs/IMAGE-COVERAGE.md §8）

test('EC-2 缺图回填：扫描 header_image 为空 → 逐 appid 元数据重同步补齐，缺图数下降', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const logs = [];
  const logger = { info: (e, d) => logs.push({ event: e, data: d }), warn: (e, d) => logs.push({ event: e, data: d }), debug: () => {} };
  try {
    await db.ensureGame(q, { steamAppid: 991001, name: 'EC Backfill A' });
    await db.ensureGame(q, { steamAppid: 991002, name: 'EC Backfill B' });
    await db.ensureGame(q, { steamAppid: 991003, name: 'EC Backfill C' });
    const before = (await q('select count(*)::int as n from games where header_image is null')).rows[0].n;
    assert.equal(before, 3, '起点：3 款都缺 header_image');
    const urlFor = {
      991001: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/991001/a/header.jpg',
      991002: null, // Steam 无资产：不补
      991003: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/991003/c/header.jpg',
    };
    const fetchMeta = async (appids) => ({ items: appids.map((id) => (urlFor[id] ? { headerImage: urlFor[id] } : {})) });
    const r = await backfillMissingHeaders(q, { fetchMeta, limit: 10, sleepMs: 0, logger });
    assert.deepEqual(
      { scanned: r.scanned, filled: r.filled, skipped: r.skipped, failed: r.failed },
      { scanned: 3, filled: 2, skipped: 1, failed: 0 },
      '2 款补齐、1 款无资产跳过',
    );
    const after = (await q('select count(*)::int as n from games where header_image is null')).rows[0].n;
    assert.equal(after, 1, '回填后缺图数下降（3 → 1）——验收②');
    assert.ok(logs.some((l) => l.event === 'images.backfill_filled' && l.data.appid === 991001), '日志 images.backfill_filled');
    assert.ok(logs.some((l) => l.event === 'images.backfill_done' && l.data.filled === 2), '日志 images.backfill_done');
    // 收敛 + 不覆盖：第二轮候选只剩 991002（无资产）→ scanned 1、filled 0；
    // 已补的值不被改写（反向自检：去掉 fillHeaderImage 的 where header_image is null 后，
    // 第二轮会重新扫描到已有值的行并改写 → filled 变非 0，本断言变红）
    const again = await backfillMissingHeaders(q, { fetchMeta, limit: 10, sleepMs: 0, logger });
    assert.deepEqual({ scanned: again.scanned, filled: again.filled, skipped: again.skipped }, { scanned: 1, filled: 0, skipped: 1 });
    const row = (await q('select header_image from games where steam_appid = $1', [991001])).rows[0];
    assert.match(row.header_image, /a\/header\.jpg/, '首轮已补的值保持（coalesce 语义）');
  } finally {
    await store.close();
  }
});

test('EC-2 缺图回填：单款元数据拉取失败不中断整轮，failed 计数并记日志', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const logs = [];
  const logger = { info: () => {}, warn: (e, d) => logs.push({ event: e, data: d }), debug: () => {} };
  try {
    await db.ensureGame(q, { steamAppid: 991004, name: 'EC Fail A' });
    await db.ensureGame(q, { steamAppid: 991005, name: 'EC Fail B' });
    let calls = 0;
    const fetchMeta = async () => {
      calls += 1;
      if (calls === 1) throw new Error('ETIMEDOUT 超时');
      return { items: [{ headerImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/991005/x/header.jpg' }] };
    };
    const r = await backfillMissingHeaders(q, { fetchMeta, limit: 10, sleepMs: 0, logger });
    assert.deepEqual({ filled: r.filled, failed: r.failed, skipped: r.skipped }, { filled: 1, failed: 1, skipped: 0 });
    const failLog = logs.find((l) => l.event === 'images.backfill_item_failed');
    assert.ok(failLog, '失败记 images.backfill_item_failed');
    assert.match(String(failLog.data.message), /ETIMEDOUT/, '失败原因进日志');
    const n = (await q('select count(*)::int as n from games where header_image is null')).rows[0].n;
    assert.equal(n, 1, '只有失败那款仍缺图');
  } finally {
    await store.close();
  }
});

test('EC-1 覆盖看板：数字与 SQL 一致、缺图列表分页标原因、reset-miss 后回落、鉴权 401/403', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ec-img-'));
  const savedImgDir = process.env.IMG_DIR;
  const savedCaptcha = process.env.CAPTCHA_ENABLED;
  process.env.IMG_DIR = dir;
  process.env.CAPTCHA_ENABLED = '0';
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  // A：header_image 空；B：有直链且本地已缓存 header；C：有直链本地无缓存 → 负缓存 CDN 404
  await db.ensureGame(q, { steamAppid: 992001, name: 'EC NoHeader' });
  await db.ensureGame(q, { steamAppid: 992002, name: 'EC Cached' });
  await q("update games set header_image = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/992002/x/header.jpg' where steam_appid = 992002");
  mkdirSync(join(dir, '992002'), { recursive: true });
  writeFileSync(join(dir, '992002', 'header.jpg'), Buffer.from('fake jpeg'));
  await db.ensureGame(q, { steamAppid: 992003, name: 'EC Miss404' });
  await q("update games set header_image = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/992003/x/header.jpg' where steam_appid = 992003");
  const imageFetch = async () => {
    const e = new Error('HTTP 404');
    e.status = 404;
    throw e;
  };
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1', imageFetch });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    // 制造负缓存：请求 C 的 header → 404 → notfound 负缓存（key 992003/header）
    assert.equal((await fetch(`${base}/img/steam/992003/header`)).status, 404);
    const login = async (username, password) => {
      const res = await fetch(`${base}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(res.status, 200, `登录 ${username}`);
      return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    };
    assert.equal((await fetch(`${base}/api/admin/images/coverage`)).status, 401, '匿名 401');
    const aliceCookie = await login('alice', 'alice123456');
    assert.equal((await fetch(`${base}/api/admin/images/coverage`, { headers: { cookie: aliceCookie } })).status, 403, '普通用户 403');
    const adminCookie = await login('admin', 'admin123456');
    const res = await fetch(`${base}/api/admin/images/coverage?pageSize=50`, { headers: { cookie: adminCookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stats.totalGames, 3);
    assert.equal(body.stats.withHeaderImage, 2);
    assert.equal(body.stats.missing, 2, '缺图 = header_image 空 1 + CDN 404 1');
    assert.deepEqual(body.stats.missingByReason, { noHeader: 1, cdn404: 1, fetchFailed: 0 });
    assert.equal(body.stats.cachedGames, 1, '本地已缓存 1 款（imageStats）');
    assert.equal(body.list.total, 2);
    const sqlNoHeader = (await q('select count(*)::int as n from games g where g.steam_appid is not null and not g.deleted and g.header_image is null')).rows[0].n;
    assert.equal(body.stats.missingByReason.noHeader, sqlNoHeader, 'noHeader 与 SQL 统计一致——验收①');
    const byAppid = Object.fromEntries(body.list.items.map((it) => [it.steam_appid, it.reason]));
    assert.equal(byAppid[992001], 'header_image 空');
    assert.equal(byAppid[992003], 'CDN 404');
    // 分页可翻页：pageSize=1 时两页各 1 条且不重复
    const p1 = await (await fetch(`${base}/api/admin/images/coverage?page=1&pageSize=1`, { headers: { cookie: adminCookie } })).json();
    const p2 = await (await fetch(`${base}/api/admin/images/coverage?page=2&pageSize=1`, { headers: { cookie: adminCookie } })).json();
    assert.equal(p1.list.items.length, 1);
    assert.equal(p2.list.items.length, 1);
    assert.notEqual(p1.list.items[0].id, p2.list.items[0].id, '两页不重复');
    // 重置缺图负缓存（复用已有接口）后 C 的 404 记录消失 → missing 回落
    const cleared = await (await fetch(`${base}/api/admin/images/reset-miss`, { method: 'POST', headers: { cookie: adminCookie } })).json();
    assert.equal(cleared.cleared, 1, '清了 1 条负缓存');
    const after = await (await fetch(`${base}/api/admin/images/coverage`, { headers: { cookie: adminCookie } })).json();
    assert.equal(after.stats.missing, 1, 'reset-miss 后缺图数回落');
  } finally {
    await srv.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
    if (savedImgDir === undefined) delete process.env.IMG_DIR;
    else process.env.IMG_DIR = savedImgDir;
    if (savedCaptcha === undefined) delete process.env.CAPTCHA_ENABLED;
    else process.env.CAPTCHA_ENABLED = savedCaptcha;
  }
});

test('EC-2 手动回填接口：匿名 401、普通用户 403、管理员 202、single-flight 重复触发 409', async () => {
  const savedCaptcha = process.env.CAPTCHA_ENABLED;
  process.env.CAPTCHA_ENABLED = '0';
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  let busy = false;
  let started = 0;
  const startSteamJobImpl = async ({ mode, args }) => {
    if (busy) {
      const e = new Error('已有任务在运行（同步/回填），请等它结束');
      e.code = 'BUSY';
      throw e;
    }
    busy = true;
    started += 1;
    assert.equal(mode, 'images-backfill');
    assert.deepEqual(args.slice(0, 3), ['src/cli.js', 'images', 'backfill']);
    return { runId: 7, pid: 42 };
  };
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1', startSteamJobImpl });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const post = (cookie) => fetch(`${base}/api/admin/images/backfill`, { method: 'POST', headers: cookie ? { cookie } : {} });
    assert.equal((await post(null)).status, 401, '匿名 401');
    const alice = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'alice123456' }),
    });
    const aliceCookie = (alice.headers.get('set-cookie') ?? '').split(';')[0];
    assert.equal((await post(aliceCookie)).status, 403, '普通用户 403');
    const admin = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    const adminCookie = (admin.headers.get('set-cookie') ?? '').split(';')[0];
    const first = await post(adminCookie);
    assert.equal(first.status, 202);
    const firstBody = await first.json();
    assert.equal(firstBody.started, true);
    assert.equal(firstBody.mode, 'images-backfill');
    assert.equal(firstBody.runId, 7);
    const second = await post(adminCookie);
    assert.equal(second.status, 409, 'single-flight：任务进行中重复触发 409');
    assert.match((await second.json()).error, /已有任务在运行/);
    assert.equal(started, 1, '注入的启动器只被调用一次');
  } finally {
    await srv.close();
    await store.close();
    if (savedCaptcha === undefined) delete process.env.CAPTCHA_ENABLED;
    else process.env.CAPTCHA_ENABLED = savedCaptcha;
  }
});