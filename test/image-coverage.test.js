// BC 批（docs/IMAGE-COVERAGE.md §4）：封面图补图覆盖率——
// ① steam-status 同一次 appdetails 响应顺带补 header_image（只在库内为空时写）；
// ② images.limit 默认 500；③ POST /api/admin/images/reset-miss 清空缺图负缓存（鉴权 + cleared）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { applySteamDetails } from '../src/steam-status.js';
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
test('backfill 候选 SQL：header_image 条件并入描述/报价的 OR 组', () => {
  const src = readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
  assert.match(
    src,
    /or \(g\.header_image is null and exists \(select 1 from offers o where o\.game_id = g\.id\)\)\)/,
    'header_image 条件在括号内以 OR 连接',
  );
  assert.doesNotMatch(src, /"and \(g\.header_image is null and exists/, '不能是独立的 AND 条件');
});