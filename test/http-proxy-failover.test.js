// 代理池故障切换（docs/PROXY-POOL.md §7 验收 2、3、4、5、6，AM-1 批）+ FW-2 403/429 切代理
// （docs/SLOW-SYNC.md §3.3、§8「FW-2」第 1~6 条）：
// 全部用本地假代理 + 假目标做真实转发链路，并把「每次尝试实际用的代理」记进日志断言——
// 只断言"最终成功"不算，旧实现（route 在循环外算一次）也能成功，那是假绿。
// 另配反例自检（把 nextCandidate 恒返第一条时本文件必须变红），自检结果贴在交付汇报里。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchText, isSteamReject } from '../src/http.js';
import { proxyKey, resetProxyHealth, flushProxyHealth } from '../src/proxy-pool.js';

// BL 批（docs/BACKFILL-THROUGHPUT.md §3.2）：429 现在「首次即落盘冷却」——
// 用临时目录隔离，避免把 data/steam-429.json 写进工作区、让后续用例被 30 分钟冷却睡死。
process.env.STEAM_429_FILE = join(mkdtempSync(join(tmpdir(), 'steam-429-failover-')), 'steam-429.json');

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

/**
 * FW-2 专用拓扑：每条代理按 behaviors[i] 行事——
 *   'ok'   → 转发到假目标（目标回 200）
 *   '403'  → 代理直接回 403（模拟「这个出口 IP 被 Steam 拒了」）
 *   '429'  → 代理直接回 429（带 Retry-After，模拟限流）
 * 每条代理记录 hits、目标记录 targetHits，用来断言「第 N 次请求实际走了哪条、目标被打了几次」。
 */
async function makePoolTopology(behaviors, { retryAfter = null } = {}) {
  const targetHits = [];
  const target = http.createServer((req, res) => {
    targetHits.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, ok: true }));
  });
  const targetPort = await listen(target);
  const proxies = [];
  for (const behavior of behaviors) {
    const hits = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url);
      if (behavior !== 'ok') {
        const headers = { 'content-type': 'application/json' };
        if (behavior === '429' && retryAfter != null) headers['retry-after'] = String(retryAfter);
        res.writeHead(Number(behavior), headers);
        res.end(JSON.stringify({ rejected: Number(behavior) }));
        return;
      }
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
    const port = await listen(server);
    proxies.push({ port, behavior, hits, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
  }
  return {
    targetHits,
    proxies,
    close: async () => {
      for (const p of proxies) await p.close();
      await new Promise((r) => target.close(r));
    },
  };
}

/** 健康文件里某条代理的记录（先 flush 掉 1 秒防抖，读真实落盘的 proxy-health.json）。 */
function healthFromFile(proxyUrl) {
  flushProxyHealth();
  const raw = JSON.parse(readFileSync(process.env.PROXY_HEALTH_FILE, 'utf8'));
  return raw.proxies[proxyKey(proxyUrl)] ?? null;
}

/** 每个测试独立的健康/冷却/闸门文件 + 干净环境（FW-2：403/429 冷却与 token 桶都落盘，必须隔离）。 */
function isolateEnv() {
  const saved = { ...process.env };
  const dir = mkdtempSync(join(tmpdir(), 'proxy-failover-'));
  process.env.PROXY_HEALTH_FILE = join(dir, 'proxy-health.json');
  process.env.STEAM_403_FILE = join(dir, 'steam-403.json');
  process.env.STEAM_429_FILE = join(dir, 'steam-429.json');
  process.env.STEAM_RATE_FILE = join(dir, 'steam-rate.json');
  // 429 不回退等待（30 分钟）——本文件只断言冷却/切换语义，不睡
  process.env.STEAM_429_RETRIES = '0';
  delete process.env.SYNC_ROTATE_ON_403;
  delete process.env.SYNC_ROTATE_ON_429;
  delete process.env.SYNC_ROTATE_MAX_PER_REQUEST;
  delete process.env.SYNC_RATE_GATE_PER_MIN;
  delete process.env.SYNC_RATE_MAX_WAIT_MS;
  delete process.env.HTTPS_PROXY;
  delete process.env.HTTP_PROXY;
  delete process.env.NO_PROXY;
  delete process.env.steam_proxy;
  resetProxyHealth();
  return {
    dir,
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

test('验收 6 / FW-2 决策 11：目标 500 不切换（两次尝试同一代理）', async () => {
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
    assert.equal(req500[0].proxy, req500[1].proxy, '两次尝试同一代理（HTTP 5xx 不切换：Steam 自身故障，换 IP 打到同一组服务器）');
    assert.equal(events.filter((e) => e.event === 'http.proxy_switch').length, 0, '无切换日志');
    assert.equal(events.filter((e) => e.event === 'http.proxy_down').length, 0, '5xx 不把代理标成失败/冷却');
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

// ---------------------------------------------------------------- FW-2：403/429 切代理

test('FW-2 验收 1：第 1 条 403 → 同一逻辑请求改用第 2 条并成功（断言两次请求的代理不同）', async () => {
  const topo = await makePoolTopology(['403', 'ok']);
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  process.env.STEAM_PROXY = topo.proxies.map((p) => p.url).join('\n');
  try {
    const res = await fetchText('http://store.steampowered.com/t/403', { retries: 2, logger });
    assert.equal(res.status, 200, '第 2 条代理成功');
    assert.equal(JSON.parse(res.body).ok, true);
    const attempts = events.filter((e) => e.event === 'http.request');
    assert.equal(attempts.length, 2, '同一逻辑请求尝试两次（第 1 条 403 → 第 2 条）');
    assert.notEqual(attempts[0].proxy, attempts[1].proxy, '★ 两次请求的代理不同（防假绿：没切换就会是同一代理）');
    assert.equal(attempts[0].proxy, topo.proxies[0].url);
    assert.equal(attempts[1].proxy, topo.proxies[1].url);
    const switches = events.filter((e) => e.event === 'http.proxy_switch');
    assert.equal(switches.length, 1);
    assert.equal(switches[0].reason, 'steam403', '切换原因 = steam403（§3.4 日志约定）');
    assert.deepEqual(topo.targetHits, ['/t/403'], '目标只被打到一次（第 1 条 403 没有转发到目标）');
    assert.deepEqual(topo.proxies.map((p) => p.hits.length), [1, 1], '两条代理各被真实请求 1 次');
  } finally {
    env.restore();
    await topo.close();
  }
});

test('FW-2 验收 2：429 同样切代理；Retry-After 只记到该代理（不写全局 429）', async () => {
  const topo = await makePoolTopology(['429', 'ok'], { retryAfter: 120 });
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  process.env.STEAM_PROXY = topo.proxies.map((p) => p.url).join('\n');
  const started = Date.now();
  try {
    const res = await fetchText('http://store.steampowered.com/t/429', { retries: 2, logger });
    assert.equal(res.status, 200, '429 → 换第 2 条成功');
    const attempts = events.filter((e) => e.event === 'http.request');
    assert.equal(attempts.length, 2);
    assert.notEqual(attempts[0].proxy, attempts[1].proxy, '★ 429 也换代理（两次请求代理不同）');
    assert.equal(events.find((e) => e.event === 'http.proxy_switch').reason, 'steam429');
    // Retry-After=120s > 阶梯首败 60s → 该代理冷却 ≈120s（max(阶梯, retryAfter)）
    const rec = healthFromFile(topo.proxies[0].url);
    assert.equal(rec.lastErrorKind, 'steam429', '失败类型写进健康文件');
    const downMs = Date.parse(rec.downUntil) - started;
    assert.ok(downMs >= 118_000 && downMs <= 125_000, `429 冷却取 max(阶梯, Retry-After)=120s，实际 ${downMs}ms`);
    assert.equal(existsSync(process.env.STEAM_429_FILE), false, 'Retry-After 不当全局冷却：不写 data/steam-429.json');
  } finally {
    env.restore();
    await topo.close();
  }
});

test('FW-2 验收 4：每请求最多 3 条代理——5 条池全 403 只发 3 次请求，随后抛 403', async () => {
  const topo = await makePoolTopology(['403', '403', '403', '403', '403']);
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  process.env.STEAM_PROXY = topo.proxies.map((p) => p.url).join('\n');
  try {
    await assert.rejects(
      fetchText('http://store.steampowered.com/t/all-403', { retries: 0, logger }),
      (err) => {
        assert.equal(err.status, 403, '抛出的错误保持 status 403');
        assert.notEqual(err.code, 'PROXY_ALL_FAILED', '★ 不包装成 PROXY_ALL_FAILED（FW-3 软退出判定依赖原错误码）');
        return true;
      },
    );
    const attempts = events.filter((e) => e.event === 'http.request');
    assert.equal(attempts.length, 3, '★ 每请求最多 3 条（默认 SYNC_ROTATE_MAX_PER_REQUEST=3），不是把 5 条跑一遍');
    assert.equal(new Set(attempts.map((a) => a.proxy)).size, 3, '3 次用了 3 条不同代理');
    assert.deepEqual(topo.proxies.map((p) => p.hits.length), [1, 1, 1, 0, 0], '第 4/5 条代理一次都没被打到');
    const rejected = events.find((e) => e.event === 'http.proxy_all_rejected');
    assert.ok(rejected, '记 http.proxy_all_rejected（error）');
    assert.equal(rejected.status, 403);
    assert.equal(rejected.count, 3);
    // 全池被拒 → 全局 403 冷却落盘（5 分钟起）
    const global = JSON.parse(readFileSync(process.env.STEAM_403_FILE, 'utf8'));
    const untilMs = Date.parse(global.until);
    assert.ok(untilMs > Date.now(), 'data/steam-403.json 写了未来 until（冷却生效）');
    assert.ok(untilMs - Date.now() <= 5 * 60_000 + 5_000, '全池被封的全局冷却从 5 分钟起');
  } finally {
    env.restore();
    await topo.close();
  }
});

test('FW-2 验收 5/6：按代理冷却——第 1 条 403 后记 downUntil/lastErrorKind，后续请求直接从第 2 条开始', async () => {
  const topo = await makePoolTopology(['403', 'ok']);
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  process.env.STEAM_PROXY = topo.proxies.map((p) => p.url).join('\n');
  try {
    // 第 1 个请求：第 1 条 403（进按代理冷却）→ 第 2 条成功
    await fetchText('http://store.steampowered.com/t/1', { retries: 2, logger });
    const rec = healthFromFile(topo.proxies[0].url);
    assert.ok(rec, 'proxy-health.json 有第 1 条的记录');
    assert.equal(rec.lastErrorKind, 'steam403', "★ 健康文件 lastErrorKind='steam403'");
    assert.ok(rec.downUntil && Date.parse(rec.downUntil) > Date.now(), '★ 健康文件写了下未来的 downUntil');
    const healthTo = readFileSync(process.env.PROXY_HEALTH_FILE, 'utf8');
    assert.ok(!healthTo.includes('127.0.0.1'), '健康文件里不出现代理地址（只存 sha256 hash key，§6.1）');
    const badHits = topo.proxies[0].hits.length;
    // 第 2 个请求：第 1 条冷却中 → 直接从第 2 条开始（不再撞第 1 条）
    const res = await fetchText('http://store.steampowered.com/t/2', { retries: 2, logger });
    assert.equal(res.status, 200);
    const attempts2 = events.filter((e) => e.event === 'http.request' && String(e.url).includes('/t/2'));
    assert.equal(attempts2.length, 1, '第 2 个请求只尝试一次（不先撞冷却中的第 1 条）');
    assert.equal(attempts2[0].proxy, topo.proxies[1].url, '直接从第 2 条开始');
    assert.equal(topo.proxies[0].hits.length, badHits, '第 1 条代理没再收到请求');
  } finally {
    env.restore();
    await topo.close();
  }
});

test('FW-2 验收 6：全池 403 才写全局冷却——抛出 err.status===403（不是 PROXY_ALL_FAILED）', async () => {
  const topo = await makePoolTopology(['403', '403']);
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  process.env.STEAM_PROXY = topo.proxies.map((p) => p.url).join('\n');
  try {
    await assert.rejects(
      fetchText('http://store.steampowered.com/t/pool-403', { retries: 0, logger }),
      (err) => {
        assert.equal(err.status, 403);
        assert.notEqual(err.code, 'PROXY_ALL_FAILED');
        return true;
      },
    );
    assert.deepEqual(topo.proxies.map((p) => p.hits.length), [1, 1], '两条代理都真实请求过');
    const until = Date.parse(JSON.parse(readFileSync(process.env.STEAM_403_FILE, 'utf8')).until);
    assert.ok(until > Date.now(), '全池都被标记后才写全局 data/steam-403.json 的 until');
    const h1 = healthFromFile(topo.proxies[0].url);
    const h2 = healthFromFile(topo.proxies[1].url);
    assert.equal(h1.lastErrorKind, 'steam403');
    assert.equal(h2.lastErrorKind, 'steam403');
    assert.ok(h1.downUntil && h2.downUntil, '两条代理各自有 downUntil（按代理冷却，不是全局一刀切）');
  } finally {
    env.restore();
    await topo.close();
  }
});

test('FW-2 回滚：SYNC_ROTATE_ON_403=0 → 退回 AM-1（不换代理、只写全局冷却）', async () => {
  const topo = await makePoolTopology(['403', 'ok']);
  const events = [];
  const logger = captureLogger(events);
  const env = isolateEnv();
  process.env.STEAM_PROXY = topo.proxies.map((p) => p.url).join('\n');
  process.env.SYNC_ROTATE_ON_403 = '0';
  try {
    await assert.rejects(
      fetchText('http://store.steampowered.com/t/no-rotate', { retries: 2, logger }),
      (err) => err.status === 403,
    );
    const attempts = events.filter((e) => e.event === 'http.request');
    assert.equal(attempts.length, 1, '开关关 → 不换代理，只打第 1 条');
    assert.equal(topo.proxies[1].hits.length, 0, '第 2 条代理没被打到');
    assert.equal(events.filter((e) => e.event === 'http.proxy_switch').length, 0, '没有切换日志');
    const until = Date.parse(JSON.parse(readFileSync(process.env.STEAM_403_FILE, 'utf8')).until);
    assert.ok(until > Date.now(), '仍按 AM-1 写全局 403 冷却');
    assert.equal(events.filter((e) => e.event === 'http.proxy_all_rejected').length, 0, '回滚模式不记「全池被拒」');
  } finally {
    env.restore();
    await topo.close();
  }
});

test('FW-2：isSteamReject 只认目标站 403/429——代理 CONNECT 的 403/407 仍走代理层失败，不混', () => {
  assert.equal(isSteamReject({ status: 403 }), true, '目标站 403 = Steam 业务拒绝（该换代理）');
  assert.equal(isSteamReject({ status: 429 }), true, '429 同样');
  assert.equal(isSteamReject({ status: 403, proxyStatus: 403 }), false, '代理 CONNECT 403 是代理配置问题，不算 Steam 拒绝');
  assert.equal(isSteamReject({ status: 407, proxyStatus: 407 }), false);
  assert.equal(isSteamReject({ status: 500 }), false, '5xx 不切');
  assert.equal(isSteamReject(new Error('fetch failed')), false);
  assert.equal(isSteamReject(null), false);
});
