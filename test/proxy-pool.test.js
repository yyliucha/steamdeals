// Steam 代理池（docs/PROXY-POOL.md §7 验收 1、3、4、7、10 + §3.1/§4.5，AM-1 批）：
// 多条解析（换行/逗号/去重/老单行兼容）、候选顺序（sticky 优先 / 冷却跳过 / 全部冷却取最早解冻）、
// 冷却阶梯（60s/5min/30min）、成功清零粘住、健康文件落盘（不含地址与密码、坏文件重置、重启仍冷却）、
// proxyHealth 视图脱敏、设置校验（行号报错 / ≤10 / 去重归一化）、GET /api/admin/proxies 权限与脱敏。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { parseProxyList, steamProxyUrls, decideProxy } from '../src/proxy.js';
import * as settings from '../src/settings.js';
import {
  proxyKey,
  candidatesFor,
  nextCandidate,
  noteProxyFailure,
  noteProxySuccess,
  proxyHealth,
  cooldownUntil,
  healthRecord,
  resetProxyHealth,
  flushProxyHealth,
} from '../src/proxy-pool.js';

process.env.CAPTCHA_ENABLED = '0';

const tmpDir = () => mkdtempSync(join(tmpdir(), 'proxy-health-'));
const fileIn = (dir) => join(dir, 'proxy-health.json');
const P1 = 'http://127.0.0.1:7001';
const P2 = 'http://127.0.0.1:7002';
const P3 = 'http://user:secret@127.0.0.1:7003';

test('parseProxyList：换行/逗号分隔、去空、去重、非法丢弃；steamProxyUrls 读 env', () => {
  assert.deepEqual(parseProxyList(''), []);
  assert.deepEqual(parseProxyList('http://127.0.0.1:7001'), ['http://127.0.0.1:7001'], '老单行 = 1 条（验收 1）');
  assert.deepEqual(parseProxyList('http://a:1\nhttp://b:2'), ['http://a:1', 'http://b:2'], '换行分隔');
  assert.deepEqual(parseProxyList('http://a:1, http://b:2 ,'), ['http://a:1', 'http://b:2'], '逗号分隔 + 去空');
  assert.deepEqual(parseProxyList('http://a:1\nhttp://a:1\nhttp://b:2'), ['http://a:1', 'http://b:2'], '去重保留首次');
  assert.deepEqual(parseProxyList('http://a:1\nsocks5://x:1\nnot a url'), ['http://a:1'], '非法行丢弃');
  assert.deepEqual(parseProxyList('127.0.0.1:7001'), ['http://127.0.0.1:7001'], '缺协议补 http://');
  assert.deepEqual(steamProxyUrls({ STEAM_PROXY: 'http://a:1\nhttp://b:2' }), ['http://a:1', 'http://b:2']);
  assert.deepEqual(steamProxyUrls({ steam_proxy: 'http://a:1,http://b:2' }), ['http://a:1', 'http://b:2'], '小写 env 也行');
  assert.deepEqual(steamProxyUrls({}), []);
});

test('decideProxy：多条配置仍返回第一条（旧语义），老调用方兼容', () => {
  assert.deepEqual(decideProxy('store.steampowered.com', { STEAM_PROXY: 'http://a:1\nhttp://b:2' }), {
    via: 'steam-proxy',
    url: 'http://a:1',
  });
});

test('冷却阶梯：首败 60s、二连败 5min、三连败 30min 封顶；成功清零并记 lastGood', () => {
  const file = fileIn(tmpDir());
  resetProxyHealth();
  try {
    const now = Date.now();
    const r1 = noteProxyFailure(P1, { code: 'ECONNREFUSED' }, { file });
    assert.ok(Date.parse(r1.downUntil) - now >= 59_000 && Date.parse(r1.downUntil) - now <= 61_000, '首败冷却 60 秒');
    const r2 = noteProxyFailure(P1, { code: 'ETIMEDOUT' }, { file });
    assert.ok(Date.parse(r2.downUntil) - now >= 299_000, '二连败冷却 5 分钟');
    const r3 = noteProxyFailure(P1, { code: 'EPIPE' }, { file });
    assert.ok(Date.parse(r3.downUntil) - now >= 1_799_000, '三连败冷却 30 分钟封顶');
    assert.equal(r3.fails, 3);
    assert.equal(healthRecord(P1, { file }).lastError, 'EPIPE', '记录最近错误');
    noteProxySuccess(P1, { file });
    assert.equal(healthRecord(P1, { file }).fails, 0, '成功清零失败计数');
    assert.equal(cooldownUntil(P1, { file }), null, '成功清冷却');
    assert.equal(proxyHealth({ STEAM_PROXY: P1 }, { file }).proxies[0].state, 'ok');
    assert.equal(proxyHealth({ STEAM_PROXY: P1 }, { file }).lastGood, 1, '粘住记 lastGood');
  } finally {
    resetProxyHealth();
  }
});

test('候选顺序：sticky 优先；冷却中的排后面；全部冷却取最早解冻；nextCandidate 跳过已试', () => {
  const file = fileIn(tmpDir());
  resetProxyHealth();
  try {
    const env = { STEAM_PROXY: [P1, P2].join('\n') };
    assert.deepEqual(candidatesFor('store.steampowered.com', env, { file }), [P1, P2], '初始按配置顺序');
    noteProxySuccess(P2, { file });
    assert.deepEqual(candidatesFor('store.steampowered.com', env, { file }), [P2, P1], '成功者粘住优先');
    noteProxyFailure(P2, { code: 'ECONNREFUSED' }, { file });
    assert.deepEqual(candidatesFor('store.steampowered.com', env, { file }), [P1], '粘住的在冷却 → 跳过（验收 3/4）');
    noteProxyFailure(P1, { code: 'ECONNREFUSED' }, { file });
    const all = candidatesFor('store.steampowered.com', env, { file });
    assert.equal(all.length, 1, '全部冷却仍给一条（避免长任务卡死）');
    assert.ok([P1, P2].includes(all[0]), '取的是池内代理');
    assert.equal(nextCandidate([P1, P2], [P1]), P2);
    assert.equal(nextCandidate([P1, P2], [P1, P2]), null, '全部试过返回 null');
  } finally {
    resetProxyHealth();
  }
});

test('健康文件：落盘不含代理地址与密码；重启（清内存）后冷却仍在；坏文件当空状态', () => {
  const file = fileIn(tmpDir());
  resetProxyHealth();
  try {
    noteProxyFailure(P3, { code: 'ECONNREFUSED' }, { file });
    flushProxyHealth();
    const raw = readFileSync(file, 'utf8');
    assert.ok(!raw.includes('7003'), '文件里不出现代理端口/地址（验收 10）');
    assert.ok(!raw.includes('secret'), '文件里不出现密码');
    assert.ok(raw.includes(proxyKey(P3)), '只存 sha256 key');
    resetProxyHealth(); // 模拟另一个进程刚启动
    assert.ok(cooldownUntil(P3, { file }), '重启后冷却状态仍在（读文件，验收 7）');
    writeFileSync(file, '{broken');
    resetProxyHealth();
    assert.deepEqual(candidatesFor('store.steampowered.com', { STEAM_PROXY: P3 }, { file }), [P3], '坏文件当空状态，不抛异常');
  } finally {
    resetProxyHealth();
  }
});

test('proxyHealth 视图：ok/cooldown/unknown、地址脱敏、lastGood 是序号', () => {
  const file = fileIn(tmpDir());
  resetProxyHealth();
  try {
    const env = { STEAM_PROXY: [P1, P2, P3].join('\n') };
    const h1 = proxyHealth(env, { file });
    assert.deepEqual(h1.proxies.map((p) => p.state), ['unknown', 'unknown', 'unknown'], '从未用过 = unknown');
    assert.equal(h1.lastGood, null);
    noteProxySuccess(P2, { file });
    noteProxyFailure(P1, { code: 'ECONNREFUSED' }, { file });
    const h2 = proxyHealth(env, { file });
    assert.equal(h2.proxies[0].state, 'cooldown');
    assert.equal(h2.proxies[1].state, 'ok');
    assert.equal(h2.proxies[2].state, 'unknown');
    assert.equal(h2.lastGood, 2, 'lastGood 是序号（从 1 起）');
    assert.equal(h2.proxies[2].proxy, 'http://***@127.0.0.1:7003', '密码脱敏');
    assert.ok(!JSON.stringify(h2).includes('secret'), '视图不含密码');
    assert.equal(h2.proxies[0].fails, 1);
    assert.match(h2.proxies[0].lastError, /ECONNREFUSED/);
    assert.ok(h2.proxies[0].downUntil, '冷却中有 downUntil');
  } finally {
    resetProxyHealth();
  }
});

test('设置校验：多条合法（去重归一化）、非法行报行号、最多 10 条、老单行兼容、通用代理不受影响', () => {
  const d = settings.SETTING_MAP.get('network.steamProxy');
  const ok = validateSettingProxy(d, 'http://a:1\nhttp://b:2\nhttp://a:1');
  assert.equal(ok.ok, true);
  assert.equal(ok.value, 'http://a:1\nhttp://b:2', '去重 + 换行归一化');
  assert.equal(validateSettingProxy(d, '').ok, true, '空值允许（清空）');
  assert.equal(validateSettingProxy(d, 'http://a:1').ok, true, '老单行兼容');
  const bad = validateSettingProxy(d, 'http://a:1\nsocks5://x:1');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /第 2 行/, '非法行报出行号');
  const many = validateSettingProxy(d, Array.from({ length: 11 }, (_, i) => `http://a:${i}`).join('\n'));
  assert.equal(many.ok, false);
  assert.match(many.error, /最多 10 条/);
  const gen = validateSettingProxy(settings.SETTING_MAP.get('network.httpsProxy'), 'http://a:1');
  assert.equal(gen.ok, true, '通用代理仍是单条校验');
});

function validateSettingProxy(d, value) {
  return settings.validateSetting(d, value);
}

test('GET /api/admin/proxies：匿名 401、普通用户 403、管理员 200 且地址脱敏；没配返回空', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  const savedEnv = { ...process.env };
  process.env.PROXY_HEALTH_FILE = fileIn(tmpDir());
  process.env.STEAM_PROXY = `${P1}\n${P3}`;
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = async (username, password) => {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };
  try {
    assert.equal((await fetch(`${base}/api/admin/proxies`)).status, 401, '匿名 401');
    const aliceCookie = await login('alice', 'alice123456');
    assert.equal((await fetch(`${base}/api/admin/proxies`, { headers: { cookie: aliceCookie } })).status, 403, '普通用户 403');
    const adminCookie = await login('admin', 'admin123456');
    const res = await fetch(`${base}/api/admin/proxies`, { headers: { cookie: adminCookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.proxies.length, 2);
    assert.equal(body.proxies[0].proxy, 'http://127.0.0.1:7001');
    assert.equal(body.proxies[1].proxy, 'http://***@127.0.0.1:7003', '密码脱敏');
    assert.ok(!JSON.stringify(body).includes('secret'), '响应不含密码');
    delete process.env.STEAM_PROXY;
    const empty = await (await fetch(`${base}/api/admin/proxies`, { headers: { cookie: adminCookie } })).json();
    assert.deepEqual(empty.proxies, [], '没配代理 → 空列表');
  } finally {
    await srv.close();
    await store.close();
    process.env = savedEnv;
    resetProxyHealth();
  }
});
