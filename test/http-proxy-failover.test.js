// 代理池故障切换（docs/PROXY-POOL.md §7 验收 2、3、4、5、6，AM-1 批）：
// 全部用本地假代理 + 假目标做真实转发链路，并把「每次尝试实际用的代理」记进日志断言——
// 只断言"最终成功"不算，旧实现（route 在循环外算一次）也能成功，那是假绿。
// 另配反例自检（把 nextCandidate 恒返第一条时本文件必须变红），自检结果贴在交付汇报里。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchText } from '../src/http.js';
import { resetProxyHealth } from '../src/proxy-pool.js';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

/** 记录所有日志事件（http.request 里的 proxy 字段 = 每次尝试实际用的代理）。 */
function captureLogger(events) {
  const rec = (level) => (event, fields) => {
    events.push({ level, event, ...(fields ?? {}) });
  };
  return { trace: rec('trace'), debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') };
}

/**
 * 本地拓扑：
 *  · target  = 假 Steam 目标（可调状态码）；
 *  · proxy   = 正常转发的假代理（记录收到的 absolute-form 请求，并把 steam 域名改写到本地 target）；
 *  · deadPort / deadPort2 = 先占后放的两个端口（连上即 ECONNREFUSED）。
 */
async function makeTopology({ status = 200 } = {}) {
  let respondStatus = status;
  const hits = [];
  const target = http.createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(respondStatus, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, ok: respondStatus === 200 }));
  });
  const targetPort = await listen(target);
  const proxy = http.createServer((req, res) => {
    const u = new URL(req.url);
    const upstream = http.request(
      { hostname: '127.0.0.1', port: targetPort, path: `${u.pathname}${u.search}`, method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', (err) => res.writeHead(502).end(String(err.message)));
    req.pipe(upstream);
  });
  const proxyPort = await listen(proxy);
  const grabDeadPort = async () => {
    const s = http.createServer(() => {});
    const p = await listen(s);
    await new Promise((r) => s.close(r));
    return p;
  };
  const deadPort = await grabDeadPort();
  const deadPort2 = await grabDeadPort();
  const close = async () => {
    await new Promise((r) => proxy.close(r));
    await new Promise((r) => target.close(r));
  };
  return { targetPort, proxyPort, deadPort, deadPort2, hits, close, setStatus: (s) => { respondStatus = s; } };
}

/** 每个测试独立的健康文件 + 干净环境。 */
function isolateEnv() {
  const saved = { ...process.env };
  const file = join(mkdtempSync(join(tmpdir(), 'proxy-failover-')), 'proxy-health.json');
  process.env.PROXY_HEALTH_FILE = file;
  delete process.env.HTTPS_PROXY;
  delete process.env.HTTP_PROXY;
  delete process.env.NO_PROXY;
  delete process.env.steam_proxy;
  resetProxyHealth();
  return {
    restore() {
      process.env = saved;
      resetProxyHealth();
    },
  };
}

test('验收 2：第 1 条拒绝连接 → 同一请求内切第 2 条成功；两次尝试用的代理不同（硬断言）+ switch 日志', async () => {
  const topo = await makeTopology();
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  process.env.STEAM_PROXY = `http://127.0.0.1:${topo.deadPort}\nhttp://127.0.0.1:${topo.proxyPort}`;
  try {
    const res = await fetchText('http://store.steampowered.com/t/failover', { retries: 2, logger });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).ok, true, '最终成功');
    const attempts = events.filter((e) => e.event === 'http.request');
    assert.ok(attempts.length >= 2, '至少尝试两次');
    assert.equal(attempts[0].proxy, `http://127.0.0.1:${topo.deadPort}`, '第 1 次走第 1 条');
    assert.equal(attempts[1].proxy, `http://127.0.0.1:${topo.proxyPort}`, '第 2 次走第 2 条');
    assert.notEqual(attempts[0].proxy, attempts[1].proxy, '★ 第 2 次尝试的代理 ≠ 第 1 次（防假绿硬断言：旧实现 route 在循环外也能"成功"）');
    const switches = events.filter((e) => e.event === 'http.proxy_switch');
    assert.equal(switches.length, 1, '切换只发生一次');
    assert.equal(switches[0].from, `http://127.0.0.1:${topo.deadPort}`);
    assert.equal(switches[0].to, `http://127.0.0.1:${topo.proxyPort}`);
    assert.equal(switches[0].reason, 'ECONNREFUSED', '日志带切换原因（验收 2）');
    assert.deepEqual(topo.hits, ['/t/failover'], '目标只被打到一次');
  } finally {
    env.restore();
    await topo.close();
  }
});

test('验收 3/4：第 1 条冷却后，后续请求直接从第 2 条开始（不再撞死的）；成功者粘住', async () => {
  const topo = await makeTopology();
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  process.env.STEAM_PROXY = `http://127.0.0.1:${topo.deadPort}\nhttp://127.0.0.1:${topo.proxyPort}`;
  try {
    // 第 1 个请求：死代理进 60s 冷却，好代理成功并粘住
    await fetchText('http://store.steampowered.com/t/1', { retries: 2, logger });
    // 第 2 个请求：直接走好代理，只尝试一次
    await fetchText('http://store.steampowered.com/t/2', { retries: 2, logger });
    const attempts2 = events.filter((e) => e.event === 'http.request' && String(e.url).includes('/t/2'));
    assert.equal(attempts2.length, 1, '第 2 个请求只尝试一次（第 1 条冷却中，不先撞一次死的）');
    assert.equal(attempts2[0].proxy, `http://127.0.0.1:${topo.proxyPort}`, '直接从第 2 条开始');
    assert.deepEqual(topo.hits, ['/t/1', '/t/2']);
    // 健康视图：死代理冷却中、好代理 ok + lastGood
    const { proxyHealth } = await import('../src/proxy-pool.js');
    const health = proxyHealth(process.env);
    assert.equal(health.proxies[0].state, 'cooldown');
    assert.equal(health.proxies[1].state, 'ok');
    assert.equal(health.lastGood, 2, '成功者被粘住');
  } finally {
    env.restore();
    await topo.close();
  }
});

test('验收 5：两条都失败 → PROXY_ALL_FAILED（不回退直连），日志 http.proxy_all_failed', async () => {
  const topo = await makeTopology();
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  process.env.STEAM_PROXY = `http://127.0.0.1:${topo.deadPort}\nhttp://127.0.0.1:${topo.deadPort2}`;
  try {
    await assert.rejects(
      fetchText('http://store.steampowered.com/t/all-dead', { retries: 2, logger }),
      (err) => err.code === 'PROXY_ALL_FAILED' && /所有代理均失败（2 条）/.test(err.message),
      '全部失败必须报 PROXY_ALL_FAILED',
    );
    const requests = events.filter((e) => e.event === 'http.request');
    assert.equal(requests.length, 2, '只试了两条代理——没有第三次"直连"尝试（决策 3）');
    const allFailed = events.find((e) => e.event === 'http.proxy_all_failed');
    assert.ok(allFailed, '日志有 http.proxy_all_failed');
    assert.equal(allFailed.count, 2);
    assert.ok(allFailed.lastError, '带最后失败原因');
  } finally {
    env.restore();
    await topo.close();
  }
});

test('验收 6：目标 500 不切换（两次尝试同一代理）；429 不切换不重试', async () => {
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  const topo = await makeTopology({ status: 500 });
  process.env.STEAM_PROXY = `http://127.0.0.1:${topo.proxyPort}\nhttp://127.0.0.1:${topo.deadPort}`;
  try {
    await assert.rejects(
      fetchText('http://store.steampowered.com/t/500', { retries: 1, logger }),
      (err) => err.status === 500,
    );
    const req500 = events.filter((e) => e.event === 'http.request');
    assert.equal(req500.length, 2, '500 按原重试逻辑重试一次');
    assert.equal(req500[0].proxy, req500[1].proxy, '两次尝试同一代理（HTTP 5xx 不切换）');
    assert.equal(events.filter((e) => e.event === 'http.proxy_switch').length, 0, '无切换日志');
    // 429：不切换、不重试（STEAM_429_RETRIES=0 防 30 分钟等待）
    topo.setStatus(429);
    process.env.STEAM_429_RETRIES = '0';
    await assert.rejects(
      fetchText('http://store.steampowered.com/t/429', { retries: 1, logger }),
      (err) => err.status === 429,
    );
    const req429 = events.filter((e) => e.event === 'http.request' && String(e.url).includes('/t/429'));
    assert.equal(req429.length, 1, '429 不重试');
    assert.equal(req429[0].proxy, `http://127.0.0.1:${topo.proxyPort}`, '429 不切换代理（绕配额=作弊）');
    assert.equal(events.filter((e) => e.event === 'http.proxy_switch').length, 0);
  } finally {
    env.restore();
    await topo.close();
  }
});

test('验收 1：老的单行 STEAM_PROXY 照常工作——不启用池（仍按原重试语义，不报 PROXY_ALL_FAILED）', async () => {
  const topo = await makeTopology();
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  process.env.STEAM_PROXY = `http://127.0.0.1:${topo.deadPort}`;
  try {
    await assert.rejects(
      fetchText('http://store.steampowered.com/t/single', { retries: 2, logger }),
      (err) => err.code === 'ECONNREFUSED' && err.code !== 'PROXY_ALL_FAILED',
      '单条配置保持旧失败语义',
    );
    const requests = events.filter((e) => e.event === 'http.request');
    assert.equal(requests.length, 3, '单条配置按原重试次数（retries=2 → 3 次尝试）');
    assert.ok(requests.every((r) => r.proxy === `http://127.0.0.1:${topo.deadPort}`), '全部走同一条');
    assert.equal(events.filter((e) => e.event === 'http.proxy_switch').length, 0, '不产生切换日志');
  } finally {
    env.restore();
    await topo.close();
  }
});

test('fetchImpl 注入：不启用代理池、不建 dispatcher（行为完全不变）', async () => {
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  process.env.STEAM_PROXY = `http://127.0.0.1:1\nhttp://127.0.0.1:2`;
  try {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => 'fake-ok', headers: { get: () => null }, url: 'http://store.steampowered.com/t' };
    };
    const res = await fetchText('http://store.steampowered.com/t', { fetchImpl, logger });
    assert.equal(res.body, 'fake-ok');
    assert.equal(calls, 1, '只调一次注入的实现');
    const req = events.find((e) => e.event === 'http.request');
    assert.equal(req.via, 'custom', '注入时 via=custom，不碰代理池');
    assert.equal(events.filter((e) => e.event === 'http.proxy_switch').length, 0);
  } finally {
    env.restore();
  }
});

test('非 Steam 主机：即使配了多条 STEAM_PROXY 也不启用代理池（走通用代理/直连，行为不变）', async () => {
  const topo = await makeTopology();
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  process.env.STEAM_PROXY = `http://127.0.0.1:${topo.deadPort}\nhttp://127.0.0.1:${topo.proxyPort}`;
  process.env.HTTPS_PROXY = `http://127.0.0.1:${topo.proxyPort}`;
  try {
    const res = await fetchText(`http://127.0.0.1:${topo.targetPort}/t/nonsteam`, { retries: 0, logger });
    assert.equal(res.status, 200, '非 Steam 主机经通用代理成功');
    const req = events.find((e) => e.event === 'http.request');
    assert.equal(req.via, 'proxy', '走通用代理分支');
    assert.equal(events.filter((e) => e.event === 'http.proxy_switch').length, 0, '池不参与');
  } finally {
    env.restore();
    await topo.close();
  }
});
