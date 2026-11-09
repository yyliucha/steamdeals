// 添加愿望单（docs/WISHLIST-FIX.md §6，AA 批）：失败账号 reason 透传（响应 + 日志）、
// 空选仅本站、无 AppID 仅本站（gameId 路径）、未配 Key 拒推、解密失败原因、
// 推送成功写 steam_wishlist、已在本站重复幂等；前端弹窗置灰/提示/仅加入本站（静态断言）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { ensureSteamSchema } from '../src/steam-login.js';
import { loadSecretKey, encryptSecret } from '../src/email-auth.js';
import { startApiServer, resetLoginThrottleForTest } from '../src/server.js';

process.env.CAPTCHA_ENABLED = '0';

const events = [];
const logger = {
  trace() {},
  debug() {},
  info: (e, f) => events.push([e, f]),
  warn: (e, f) => events.push([e, f]),
  error: (e, f) => events.push([e, f]),
};

const pushCalls = [];
async function setup({ pushImpl = null } = {}) {
  resetLoginThrottleForTest();
  pushCalls.length = 0;
  events.length = 0;
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureSteamSchema(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'alice', password: 'k7Qw!2mXp3nZ', role: 'user', email: 'alice@example.com' });
  const alice = (await q("select id from users where username = 'alice'")).rows[0];
  await q("insert into games (steam_appid, name) values (700001, '有AppID')");
  await q("insert into games (steam_appid, name) values (null, '无AppID')");
  const pushWishlist = pushImpl
    ? async (args) => { pushCalls.push(args); return pushImpl(args); }
    : null;
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1', logger, steamWishlistPush: pushWishlist });
  const base = `http://127.0.0.1:${srv.port}`;
  const loginRes = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'k7Qw!2mXp3nZ' }),
  });
  const cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];
  const post = async (path, body) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return { store, q, srv, post, alice };
}

function failedLogFor(gameId, steamId) {
  const evt = events.find(([e, f]) => e === 'steam.wishlist_manual_add' && f.gameId === gameId);
  return evt?.[1] ?? null;
}

test('验收 6：空选仅加入本站（不弹推送、不报错）；日志 failed 为空数组', async () => {
  const { store, q, srv, post, alice } = await setup();
  try {
    const game = (await q("select id from games where steam_appid = 700001")).rows[0];
    const r = await post('/api/wishlist', { appid: 700001 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, appid: 700001, added: [], alreadyIn: [], failed: [] });
    const w = (await q('select * from user_wishlist where user_id = $1 and game_id = $2', [alice.id, game.id])).rows;
    assert.equal(w.length, 1, '本站愿望单写入');
    assert.equal(pushCalls.length, 0, '空选不推任何账号');
    const log = failedLogFor(game.id, null);
    assert.ok(log, 'steam.wishlist_manual_add 日志存在');
    assert.deepEqual(log.failed, [], '失败列表为空数组（含 reason 结构）');
    // 重复加入幂等（本站不重复插入）
    await post('/api/wishlist', { appid: 700001 });
    assert.equal((await q('select count(*)::int as n from user_wishlist')).rows[0].n, 1, '重复加入幂等');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('验收 5：未配 API Key 的账号 → failed.reason 透传（响应 + 日志都带原因）', async () => {
  const { store, q, srv, post, alice } = await setup();
  try {
    const game = (await q("select id from games where steam_appid = 700001")).rows[0];
    await q("insert into steam_accounts (steam_id, persona_name, user_id) values ('76561198000000001', 'A', $1)", [alice.id]);
    const r = await post('/api/wishlist', { appid: 700001, steamIds: ['76561198000000001'] });
    assert.equal(r.status, 200);
    assert.equal(r.body.failed.length, 1);
    assert.equal(r.body.failed[0].steamId, '76561198000000001');
    assert.equal(r.body.failed[0].reason, '该账号未配置 API Key');
    assert.equal(pushCalls.length, 0, '未配 Key 不推');
    const log = failedLogFor(game.id, null);
    assert.deepEqual(log.failed, [{ steamId: '76561198000000001', reason: '该账号未配置 API Key' }], '日志带原因（§4-1）');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('验收 5：API Key 解密失败 → reason=API Key 解密失败（不静默变推送失败）', async () => {
  const { store, q, srv, post, alice } = await setup();
  try {
    await q("insert into steam_accounts (steam_id, user_id, api_key_enc) values ('76561198000000002', $1, 'not-valid-cipher')", [alice.id]);
    const r = await post('/api/wishlist', { appid: 700001, steamIds: ['76561198000000002'] });
    assert.equal(r.body.failed[0].reason, 'API Key 解密失败');
    assert.equal(pushCalls.length, 0);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('验收 2：推送成功 → added + steam_wishlist 写入；已在愿望单 → alreadyIn 不重复推', async () => {
  const { store, q, srv, post, alice } = await setup({ pushImpl: async () => ({ ok: true }) });
  try {
    const secret = loadSecretKey();
    await q("insert into steam_accounts (steam_id, user_id, api_key_enc) values ('76561198000000003', $1, $2)", [alice.id, encryptSecret('REALKEY', secret)]);
    const r = await post('/api/wishlist', { appid: 700001, steamIds: ['76561198000000003'] });
    assert.deepEqual(r.body.added, ['76561198000000003'], 'added 含账号');
    assert.equal(r.body.failed.length, 0);
    assert.equal(pushCalls.length, 1);
    assert.equal(pushCalls[0].appid, 700001);
    const sw = (await q("select * from steam_wishlist where steam_id = '76561198000000003' and appid = 700001")).rows;
    assert.equal(sw.length, 1, 'steam_wishlist 乐观写入');
    // 已在 Steam 愿望单 → alreadyIn，不再调推送
    const r2 = await post('/api/wishlist', { appid: 700001, steamIds: ['76561198000000003'] });
    assert.deepEqual(r2.body.alreadyIn, ['76561198000000003']);
    assert.equal(pushCalls.length, 1, '不重复推送');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('验收 2：推送失败 → reason 透传（响应与日志）', async () => {
  const { store, q, srv, post, alice } = await setup({ pushImpl: async () => ({ ok: false, reason: 'Steam 拒绝：403 Forbidden' }) });
  try {
    const secret = loadSecretKey();
    await q("insert into steam_accounts (steam_id, user_id, api_key_enc) values ('76561198000000004', $1, $2)", [alice.id, encryptSecret('REALKEY', secret)]);
    const r = await post('/api/wishlist', { appid: 700001, steamIds: ['76561198000000004'] });
    assert.equal(r.body.failed[0].reason, 'Steam 拒绝：403 Forbidden');
    const game = (await q("select id from games where steam_appid = 700001")).rows[0];
    const log = failedLogFor(game.id, null);
    assert.deepEqual(log.failed, [{ steamId: '76561198000000004', reason: 'Steam 拒绝：403 Forbidden' }]);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('验收 6：无 Steam AppID 的条目走 gameId 路径 → appid=null、仅本站，不报错', async () => {
  const { store, q, srv, post, alice } = await setup();
  try {
    const game = (await q("select id from games where steam_appid is null")).rows[0];
    const r = await post('/api/wishlist', { gameId: game.id, steamIds: ['76561198000000005'] });
    assert.equal(r.status, 200);
    assert.equal(r.body.appid, null, 'appid=null 是前端「仅本站」提示的信号');
    assert.deepEqual(r.body.added, []);
    assert.equal((await q('select count(*)::int as n from user_wishlist where game_id = $1', [game.id])).rows[0].n, 1, '本站写入');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('前端（静态断言）：无 AppID 直达仅本站、无账号直达并提示可绑定、失败提示带 reason、弹窗置灰与文案', () => {
  const src = readFileSync(fileURLToPath(new URL('../frontend/src/pages/Home.vue', import.meta.url)), 'utf8');
  assert.match(src, /if\(!game\.steam_appid\)return addWishlist\(game,\[\]\)/, '§4-6 无 AppID 不弹多选');
  assert.match(src, /if\(!steamAccounts\.value\.length\)return addWishlist\(game,\[\],\{siteOnlyHint:'已加入本站愿望单；绑定 Steam 账号可同步推送'\}\)/, '§4-4 无账号提示可绑定');
  assert.match(src, /f\.reason\|\|'推送失败'/, '§4-2 失败提示带 reason');
  assert.match(src, /未配置 API Key，不可推送/, '§4-3 未配 Key 账号注明不可推送');
  assert.match(src, /:disabled="!acc\.api_key_set \|\| wishAccAlready\(acc\)"/, '§4-3 未配 Key 置灰');
  assert.match(src, /confirmWishlist\(true\)">仅加入本站</, '§4-5 空选「仅加入本站」按钮');
  assert.match(src, /已加入本站愿望单（该条目无 Steam AppID，仅本站）/, '§4-6 无 AppID 成功提示');
});
