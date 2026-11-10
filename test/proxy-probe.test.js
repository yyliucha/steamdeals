// BB 批（docs/PROXY-POOL.md §11.6）：代理健康主动探测——
// ① CONNECT 成功/407/超时三种结果；② 探测失败不写业务冷却；③ 逐条探测 + 汇总 + 地址脱敏 + 健康文件无明文。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  probeProxyConnect,
  probeAllProxies,
  recordProbe,
  healthRecord,
  noteProxyFailure,
  resetProxyHealth,
  proxyHealth,
  flushProxyHealth,
  proxyKey,
} from '../src/proxy-pool.js';

const tmpDir = () => mkdtempSync(join(tmpdir(), 'proxy-probe-'));
const fileIn = (dir) => join(dir, 'proxy-health.json');

/** 起一个本地 TCP 服务扮演代理；handler(socket, firstChunk)。 */
function listenProxy(onData) {
  return new Promise((done) => {
    const server = createServer((socket) => {
      socket.once('data', (chunk) => onData(socket, chunk));
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port }));
  });
}
const closeServer = (server) => new Promise((done) => server.close(() => done()));

test('probeProxyConnect：200 成功 / 407 失败 / 无响应超时（都是协议层结论）', async () => {
  const ok = await listenProxy((socket, chunk) => {
    socket.end('HTTP/1.1 200 Connection Established\r\n\r\n');
    assert.match(String(chunk), /CONNECT store\.steampowered\.com:443/);
  });
  const needAuth = await listenProxy((socket) => {
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');
  });
  const silent = await listenProxy(() => {});
  try {
    const good = await probeProxyConnect(`http://user:pass@127.0.0.1:${ok.port}`, undefined, { timeoutMs: 2000 });
    assert.equal(good.ok, true);
    assert.equal(good.status, 200);
    assert.match(good.detail, /成功/);

    const bad = await probeProxyConnect(`http://u:p@127.0.0.1:${needAuth.port}`, undefined, { timeoutMs: 2000 });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 407, '407 要账号密码，原样带回状态码');
    assert.match(bad.detail, /407/);

    const timedOut = await probeProxyConnect(`http://127.0.0.1:${silent.port}`, undefined, { timeoutMs: 300 });
    assert.equal(timedOut.ok, false);
    assert.match(timedOut.detail, /超时/);
  } finally {
    await closeServer(ok.server);
    await closeServer(needAuth.server);
    await closeServer(silent.server);
  }
});

test('recordProbe：只写 probe* 字段，绝不改动业务冷却（fails/downUntil 原样）', async () => {
  const dir = tmpDir();
  const file = fileIn(dir);
  const proxy = 'http://127.0.0.1:7101';
  resetProxyHealth();
  const failure = noteProxyFailure(proxy, new Error('ECONNREFUSED'), { file });
  flushProxyHealth();
  const before = healthRecord(proxy, { file });
  assert.equal(before.fails, failure.fails);

  recordProbe(proxy, { ok: false, status: 407, detail: 'CONNECT store.steampowered.com:443 → HTTP 407' }, { file });
  flushProxyHealth();
  const after = healthRecord(proxy, { file });
  assert.equal(after.fails, before.fails, '探测失败不改连续失败次数');
  assert.equal(after.downUntil, before.downUntil, '探测失败不写业务冷却');
  assert.equal(after.probeOk, false);
  assert.match(after.probeError, /407/);
  assert.ok(after.probeAt, '记录探测时间');

  recordProbe(proxy, { ok: true, status: 200, detail: 'ok' }, { file });
  flushProxyHealth();
  const ok = healthRecord(proxy, { file });
  assert.equal(ok.probeOk, true);
  assert.equal(ok.probeError, null, '成功清掉探测错误');
  assert.equal(ok.downUntil, before.downUntil, '探测成功也不清业务冷却（两套状态分离）');
});

test('probeAllProxies：逐条探测、汇总计数、地址脱敏、健康文件无明文', async () => {
  const good = await listenProxy((socket) => socket.end('HTTP/1.1 200 Connection Established\r\n\r\n'));
  const bad = await listenProxy((socket) => socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'));
  const dir = tmpDir();
  const file = fileIn(dir);
  const secret = 'p@ss-secret';
  const env = {
    STEAM_PROXY: `http://user:${secret}@127.0.0.1:${good.port}\nhttp://127.0.0.1:${bad.port}`,
  };
  try {
    resetProxyHealth();
    const out = await probeAllProxies(env, { file, timeoutMs: 2000 });
    assert.equal(out.probed, 2);
    assert.equal(out.ok, 1);
    assert.equal(out.failed, 1);
    assert.equal(out.proxies.length, 2);
    assert.equal(out.proxies[0].probeOk, true);
    assert.equal(out.proxies[1].probeOk, false);
    assert.ok(out.proxies[0].probeAt && out.proxies[1].probeAt, '每条都有探测时间');
    // 脱敏：API 输出不含密码；健康文件只有 hash key，不含地址/密码
    assert.doesNotMatch(JSON.stringify(out), new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '输出不含代理密码');
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '健康文件不含密码');
    assert.doesNotMatch(text, /127\.0\.0\.1/, '健康文件不含代理地址');
    assert.equal(Object.keys(JSON.parse(text).proxies).length, 2, '按 hash key 落盘（每条一个）');
    // proxyHealth 视图带 probe 字段
    const view = proxyHealth(env, { file });
    assert.equal(view.proxies[0].probeOk, true);
    assert.equal(view.proxies[1].probeOk, false);
  } finally {
    await closeServer(good.server);
    await closeServer(bad.server);
  }
});

test('probeAllProxies：没配代理直接返回空（不报错、不写文件）', async () => {
  const dir = tmpDir();
  const file = fileIn(dir);
  resetProxyHealth();
  const out = await probeAllProxies({ STEAM_PROXY: '' }, { file });
  assert.equal(out.probed, 0);
  assert.deepEqual(out.proxies, []);
  assert.equal(existsSync(file), false, '未配置代理时不落文件');
});
