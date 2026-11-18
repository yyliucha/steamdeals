// CO-3/C5（docs/DESIGN-AUDIT.md C5）：契约漂移校验——把 docs/APP-API.md 写下的字段
// 与 /api/app/* 实际返回逐字段对照（白名单断言模式，仿 test/serve.test.js 的
// FRONTEND_PAGES 一致性断言）。守的约束：
//   · 文档里写的字段，实际返回**缺一即红**（contract drift 红灯）；
//   · /api/app/status 与 /api/app/latest 是「完整形状」契约——多了未契约字段同样红；
//   · 白名单本身有反向自检：删掉一个字段，校验器必须立刻报红（防止测试失灵）；
//   · 契约文件以代码为准：本文件的白名单与 docs/APP-API.md 同步维护，发现漂移时
//     改文档（本例修复了 §4.1 discount_pct→discount、§4.3 header_image/flags→watch）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { ingestOffers } from '../src/ingest.js';
import { startApiServer } from '../src/server.js';

process.env.CAPTCHA_ENABLED = '0';

// ---------------------------------------------------------------- 契约白名单
// 每行 = docs/APP-API.md 一节；fields 是文档写出的字段名，缺一个就是漂移。
const CONTRACT = {
  captcha: { method: 'GET', path: '/api/app/captcha', doc: '§2.1', fields: ['token', 'svg'] },
  token: {
    method: 'POST', path: '/api/app/auth/token', doc: '§2.2',
    body: { username: 'alice', password: 'alice123456' },
    fields: ['token', 'expiresAt', 'user'],
    nested: { user: ['id', 'username', 'role', 'mustChangePassword'] },
  },
  me: { method: 'GET', path: '/api/app/me', doc: '§2.4', fields: ['user', 'prefs', 'timezone'] },
  prefs: { method: 'POST', path: '/api/app/prefs', doc: '§2.5', body: { theme: 'dark' }, auth: true, fields: ['prefs'] },
  status: { method: 'GET', path: '/api/app/status', doc: '§3', fields: ['banned', 'type', 'until'], exact: true },
  games: {
    method: 'GET', path: '/api/app/games?page=1&pageSize=20', doc: '§4.1',
    fields: ['games', 'total', 'page', 'pageSize', 'pages', 'sort', 'owned', 'interest', 'q', 'type'], exact: true,
    nested: {
      'games[]': ['id', 'steam_appid', 'name', 'name_en', 'current_low', 'current_original', 'currency', 'discount', 'heat', 'wishlisted', 'interested', 'owned'],
    },
  },
  search: {
    method: 'POST', path: '/api/app/games/search', doc: '§4.2',
    body: { page: 1, pageSize: 20 },
    fields: ['games', 'total', 'page', 'pageSize', 'pages', 'sort', 'owned', 'interest', 'q', 'type'], exact: true,
    nested: {
      'games[]': ['id', 'steam_appid', 'name', 'name_en', 'current_low', 'current_original', 'currency', 'discount', 'heat', 'wishlisted', 'interested', 'owned'],
    },
  },
  detail: {
    method: 'GET', path: '/api/app/games/413150', doc: '§4.3',
    fields: ['game', 'offers', 'series', 'dlc', 'watch'],
    nested: {
      game: ['id', 'steam_appid', 'name', 'name_en', 'description'],
      'offers[]': ['platform_code', 'platform_name', 'region', 'price_cents', 'original_cents', 'discount_pct', 'buy_url'],
      'series[]': ['day', 'price_cents'],
      dlc: ['total', 'synced', 'filled'],
    },
  },
  dlc: {
    method: 'GET', path: '/api/app/games/413150/dlc?page=1&pageSize=10', doc: '§4.4',
    fields: ['total', 'page', 'pageSize', 'synced', 'items'],
    nested: {
      'items[]': ['appid', 'name', 'price_cents', 'original_cents', 'discount_pct', 'currency', 'in_stock', 'buy_url'],
    },
  },
  flags: {
    method: 'POST', path: '/api/app/games/413150/flags', doc: '§5.1',
    body: { interested: true }, auth: true,
    fields: ['flags'],
    nested: { flags: ['interested', 'owned'] },
  },
  wishlistAdd: { method: 'POST', path: '/api/app/wishlist', doc: '§5.2', body: { appid: 413150 }, auth: true, fields: ['ok', 'site'] },
  wishlistDel: { method: 'DELETE', path: '/api/app/wishlist/413150', doc: '§5.2', auth: true, fields: ['ok', 'siteRemoved'] },
  announcements: {
    method: 'GET', path: '/api/app/announcements', doc: '§5.3',
    fields: ['announcements', 'readIds'],
    nested: { 'announcements[]': ['id', 'title', 'body', 'level', 'startsAt', 'endsAt'] },
  },
  announcementsRead: {
    method: 'POST', path: '/api/app/announcements/read', doc: '§5.3',
    body: { ids: [1] }, auth: true, fields: ['ok', 'readIds'],
  },
  latest: {
    method: 'GET', path: '/api/app/latest', doc: '§6',
    fields: ['version', 'versionCode', 'minVersionCode', 'apkPath', 'sha256', 'size', 'releasedAt', 'notes'], exact: true,
  },
  revoke: { method: 'POST', path: '/api/app/auth/token/revoke', doc: '§2.3', auth: true, fields: ['ok'] },
};

// ---------------------------------------------------------------- 校验器（缺一即红）
function assertFields(section, body, fields) {
  assert.ok(body && typeof body === 'object', `${section}: 响应必须是对象`);
  const missing = fields.filter((f) => !Object.prototype.hasOwnProperty.call(body, f));
  assert.deepEqual(missing, [], `${section}: 缺字段（docs/APP-API.md 写了但代码没返回 = 契约漂移）`);
}

function assertExact(section, body, fields) {
  assertFields(section, body, fields);
  const extra = Object.keys(body).filter((k) => !fields.includes(k));
  assert.deepEqual(extra, [], `${section}: 多了未契约字段（代码先改、文档没跟上 = 契约漂移）`);
}

function checkContract(name, spec, body) {
  if (spec.exact) assertExact(`${name}（${spec.doc}）`, body, spec.fields);
  else assertFields(`${name}（${spec.doc}）`, body, spec.fields);
  for (const [key, fields] of Object.entries(spec.nested ?? {})) {
    if (key.endsWith('[]')) {
      const list = body[key.slice(0, -2)];
      assert.ok(Array.isArray(list) && list.length >= 1, `${name}.${key}（${spec.doc}）: 至少要有 1 条样本才能对照字段`);
      assertFields(`${name}.${key}[0]（${spec.doc}）`, list[0], fields);
    } else {
      assertFields(`${name}.${key}（${spec.doc}）`, body[key], fields);
    }
  }
}

// ---------------------------------------------------------------- 反向自检：校验器本身能红
test('反向自检：白名单删一个字段，校验器必须立刻报红（防止测试失灵）', () => {
  const sample = { id: 1, steam_appid: 413150, discount: 33 };
  const fields = CONTRACT.games.nested['games[]'];
  assert.throws(
    () => assertFields('games[]（自检）', sample, fields.filter((f) => f !== 'discount')),
    /discount.*缺字段|缺字段/,
    '删掉 discount 后校验器必须红——证明「缺一即红」是真锁，不是摆设',
  );
  assert.throws(
    () => assertExact('status（自检）', { banned: false, type: null, until: null, leak: true }, CONTRACT.status.fields),
    /多了未契约字段/,
    '完整形状契约多一个字段同样红',
  );
});

// ---------------------------------------------------------------- 主测试：真 HTTP 逐端点对照
test('契约对照：/api/app/* 实际返回字段与 docs/APP-API.md 白名单逐字段一致', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);

  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  await ingestOffers(store, {
    platform: { code: 'steam', name: 'Steam 国区', kind: 'official' },
    offers: [
      {
        platformCode: 'steam',
        platformProductId: '413150',
        steamAppid: 413150,
        title: '星露谷物语',
        productType: 'official_direct',
        region: 'cn',
        currency: 'CNY',
        priceCents: 4800,
        originalCents: 4800,
        discountPct: 0,
        inStock: true,
        buyUrl: 'https://store.steampowered.com/app/413150/',
        meta: {},
      },
    ],
  });
  await q(`insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency)
           select id, 'steam', 'cn', current_date - 1, 4800, 'CNY' from games where steam_appid = 413150`);
  const gid = (await q('select id from games where steam_appid = 413150')).rows[0].id;
  await db.refreshGameRegionHist(q, gid);
  // DLC 样本（§4.4 items 字段对照需要至少 1 条真实行；dlc_appids 置位让 synced 走完整路径）
  await q(`insert into game_dlc (game_id, appid, name, price_cents, original_cents, discount_pct, currency, in_stock)
           values ($1, 2364740, 'DLC 测试', 1600, 1600, 0, 'CNY', true)`, [gid]);
  await q(`update games set dlc_appids = '[2364740]'::jsonb where id = $1`, [gid]);
  await q(`insert into announcements (title, body, level, active) values ('测试公告', '内容', 'info', true)`);

  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    // 1) 匿名端点（无 Bearer）
    for (const name of ['captcha', 'me', 'status', 'games', 'search', 'detail', 'dlc', 'announcements', 'latest']) {
      const spec = CONTRACT[name];
      const res = await fetch(`${base}${spec.path}`, {
        method: spec.method,
        headers: { 'content-type': 'application/json' },
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      });
      assert.equal(res.status, 200, `${name}（${spec.doc}）应 200，实际 ${res.status}`);
      checkContract(name, spec, await res.json());
    }

    // 2) 登录拿 Bearer（§2.2），之后用户端点带 Authorization 头
    const loginRes = await fetch(`${base}/api/app/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': 'dev-contract-0001' },
      body: JSON.stringify(CONTRACT.token.body),
    });
    assert.equal(loginRes.status, 200, '登录应 200（验证码已关闭）');
    const loginBody = await loginRes.json();
    checkContract('token', CONTRACT.token, loginBody);
    const bearer = loginBody.token;
    assert.ok(typeof bearer === 'string' && bearer.length >= 16, 'token 必须可继续使用');

    const authFetch = async (spec) => {
      const res = await fetch(`${base}${spec.path}`, {
        method: spec.method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      });
      assert.equal(res.status, 200, `${spec.doc} 应 200，实际 ${res.status}`);
      return res.json();
    };

    // 3) 用户端点（Bearer）——revoke 放最后（撤销后 token 失效）
    for (const name of ['prefs', 'flags', 'wishlistAdd', 'wishlistDel', 'announcementsRead']) {
      checkContract(name, CONTRACT[name], await authFetch(CONTRACT[name]));
    }

    // 4) 撤销 token（§2.3）成功后再请求必须 401 login_required（§1 错误格式）
    checkContract('revoke', CONTRACT.revoke, await authFetch(CONTRACT.revoke));
    const afterRevoke = await fetch(`${base}/api/app/auth/token/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}` },
    });
    assert.equal(afterRevoke.status, 401, '撤销后的 token 再请求应 401');
    assert.deepEqual(await afterRevoke.json(), { error: 'login_required' }, '§1 错误格式：401 { error: login_required }');
  } finally {
    await srv.close();
    await store.close();
  }
});
