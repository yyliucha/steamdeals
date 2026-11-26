// 全站速率闸门（docs/SLOW-SYNC.md §1.2 决策 8、§2.3、§8「FW-2」第 7 条）：
// 文件令牌桶 data/steam-rate.json —— 容量/补充率 = perMin（默认 30/分钟）、原子写、
// 坏文件按满桶、等待超上限抛 COOLDOWN_ABORT、代理重试每次真实请求都扣 token。
//
// 断言的是**真实行为**而不是「函数返回了」：
//   · 第 31 个 token 必须真的等一个补充周期（注入假时钟 + 假 sleep，断言等了多久、写回多少）；
//   · 「代理重试扣 token」用本地假代理 + 假目标跑真实转发链，断言 3 次尝试用了 3 条不同代理、
//     文件里 token 少了 3 个（不是「每个逻辑请求扣一次」）。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  takeToken,
  refillTokens,
  takeDecision,
  rateFilePath,
  rateGatePerMin,
  rateMaxWaitMs,
  DEFAULT_PER_MIN,
  MAX_SLEEP_STEP_MS,
} from '../src/rate-gate.js';
import { fetchText } from '../src/http.js';
import { resetProxyHealth } from '../src/proxy-pool.js';

const tmpDir = () => mkdtempSync(join(tmpdir(), 'steam-rate-'));
const fileIn = (dir) => join(dir, 'steam-rate.json');
const iso = (ms) => new Date(ms).toISOString();

/** 假时钟：sleep 推进虚拟时间，不真的睡——断言「等多久」而不是把测试跑慢。 */
function fakeClock(start = Date.parse('2026-11-26T10:00:00.000Z')) {
  let now = start;
  const sleeps = [];
  return {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
    advance: (ms) => {
      now += ms;
    },
    start,
  };
}

function captureLogger(events) {
  const rec = (level) => (event, fields) => events.push({ level, event, ...(fields ?? {}) });
  return { trace: rec('trace'), debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') };
}

test('容量与参数：默认 30 次/分钟、env 可调 1–40、等待上限默认 5 分钟且 0 合法', () => {
  assert.equal(DEFAULT_PER_MIN, 30, 'Steam 硬上限 40/分钟，留 25% 余量 = 30');
  assert.equal(rateGatePerMin({}), 30, '缺 env → 默认 30');
  assert.equal(rateGatePerMin({ SYNC_RATE_GATE_PER_MIN: '40' }), 40, 'env 可调到硬上限 40');
  assert.equal(rateGatePerMin({ SYNC_RATE_GATE_PER_MIN: '1000' }), 40, '超范围夹到 40（不放大预算）');
  assert.equal(rateGatePerMin({ SYNC_RATE_GATE_PER_MIN: '0' }), 30, '0/非法 → 回落默认（不能变成永不发 token）');
  assert.equal(rateGatePerMin({ SYNC_RATE_GATE_PER_MIN: 'abc' }), 30);
  assert.equal(rateMaxWaitMs({}), 300_000, '等待上限默认 5 分钟');
  assert.equal(rateMaxWaitMs({ SYNC_RATE_MAX_WAIT_MS: '0' }), 0, '0 合法（不等直接中断）');
  assert.equal(rateMaxWaitMs({ SYNC_RATE_MAX_WAIT_MS: '-5' }), 300_000, '负数回落默认');
  assert.equal(rateFilePath({ STEAM_RATE_FILE: 'X.json' }), 'X.json', 'STEAM_RATE_FILE 可覆盖路径（测试隔离）');
  assert.equal(rateFilePath({}), 'data/steam-rate.json', '生产默认 data/steam-rate.json');
});

test('纯函数：容量封顶 30、每 2 秒补 1 个、at 过去足够久补满、坏 state 按满桶', () => {
  const t0 = Date.parse('2026-11-26T10:00:00.000Z');
  assert.equal(refillTokens({ tokens: 30, at: iso(t0) }, t0, 30), 30, '满桶不溢出');
  assert.equal(refillTokens({ tokens: 10, at: iso(t0) }, t0 + 2000, 30), 11, '2 秒补 1 个');
  assert.equal(refillTokens({ tokens: 10, at: iso(t0) }, t0 + 60_000, 30), 30, '1 分钟补满（封顶）');
  assert.equal(refillTokens({ tokens: 10, at: iso(t0) }, t0 + 600_000, 30), 30, '10 分钟也只到容量');
  assert.equal(refillTokens({ tokens: 5, at: iso(t0) }, t0 - 1000, 30), 5, '时钟回拨/at 在未来不补充');
  assert.equal(refillTokens({ tokens: 99, at: iso(t0) }, t0, 30), 30, '坏 tokens 超容量 → 夹到容量');
  assert.equal(refillTokens({ tokens: 'bad', at: iso(t0) }, t0, 30), 30, '坏 tokens → 满桶');
  assert.equal(refillTokens(null, t0, 30), 30, '无状态（文件缺失）→ 满桶');
  assert.equal(refillTokens({ tokens: 0, at: iso(t0) }, t0, 30), 0);
  const d = takeDecision({ tokens: 0, at: iso(t0) }, t0, 30);
  assert.equal(d.waitMs, 2000, '空桶时等 2 秒补 1 个（30/分钟）');
  const d2 = takeDecision({ tokens: 30, at: iso(t0) }, t0, 30);
  assert.equal(d2.waitMs, 0);
  assert.equal(d2.tokens, 29, '够 1 个 → 扣 1 写回余量');
});

test('第 31 个 token 必须等一个补充周期（容量 30）；前 30 个不等待', async () => {
  const dir = tmpDir();
  const file = fileIn(dir);
  const clock = fakeClock();
  const events = [];
  const logger = captureLogger(events);
  // 30 次取用：全部立即成功（满桶 30）
  for (let i = 0; i < 30; i += 1) {
    const r = await takeToken({ perMin: 30, file, logger, now: clock.now, sleepFn: clock.sleep });
    assert.equal(r.waitedMs, 0, `第 ${i + 1} 个 token 不应等待`);
    assert.ok(r.tokens <= 30 - (i + 1) + 0.001, '每次取用都扣 1');
  }
  assert.equal(clock.sleeps.length, 0, '前 30 个一次都没睡');
  // 第 31 个：空桶 → 必须睡到补 1 个（2 秒），不能凭空多发
  const r31 = await takeToken({ perMin: 30, file, logger, now: clock.now, sleepFn: clock.sleep });
  assert.deepEqual(clock.sleeps, [2000], '第 31 个 token 等 2 秒（30 次/分钟 → 每 2 秒 1 个）');
  assert.equal(r31.waitedMs, 2000, '返回累计等待，便于日志/中断判定');
  const waitLog = events.find((e) => e.event === 'sync.rate_gate_wait');
  assert.ok(waitLog, '等待时记 sync.rate_gate_wait（debug）');
  assert.equal(waitLog.perMin, 30);
  // 文件是合法 JSON 且写回余量
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(typeof raw.tokens === 'number' && raw.tokens >= 0 && raw.tokens < 0.1, '等完后取了 token，余量约 0');
  assert.match(raw.at, /^\d{4}-\d{2}-\d{2}T/, 'at 是 ISO 时间');
});

test('at 过去足够久 → 下一次取用直接补满（不因旧文件停摆）', async () => {
  const dir = tmpDir();
  const file = fileIn(dir);
  const clock = fakeClock();
  writeFileSync(file, JSON.stringify({ tokens: 0, at: iso(clock.start - 10 * 60_000) }));
  const r = await takeToken({ perMin: 30, file, now: clock.now, sleepFn: clock.sleep });
  assert.equal(r.waitedMs, 0, '10 分钟足够补满，不需要等待');
  assert.ok(Math.abs(r.tokens - 29) < 0.001, '补满 30 再扣 1 = 29');
});

test('文件缺失 / 坏 JSON → 按满桶处理（记 sync.rate_gate_reset），不因坏文件停摆', async () => {
  const dir = tmpDir();
  const file = fileIn(dir);
  const clock = fakeClock();
  const events = [];
  const logger = captureLogger(events);
  // 缺失
  const miss = await takeToken({ perMin: 30, file, logger, now: clock.now, sleepFn: clock.sleep });
  assert.equal(miss.waitedMs, 0);
  assert.ok(Math.abs(miss.tokens - 29) < 0.001, '缺失 → 满桶 30 扣 1');
  assert.ok(events.some((e) => e.event === 'sync.rate_gate_reset' && e.reason === 'missing'), '缺失记 reset（debug）');
  // 坏 JSON
  writeFileSync(file, '{broken');
  events.length = 0;
  const bad = await takeToken({ perMin: 30, file, logger, now: clock.now, sleepFn: clock.sleep });
  assert.equal(bad.waitedMs, 0);
  assert.ok(Math.abs(bad.tokens - 29) < 0.001, '坏 JSON → 满桶 30 扣 1（不是 0）');
  assert.ok(events.some((e) => e.event === 'sync.rate_gate_reset' && e.reason === 'corrupt'), '坏 JSON 记 reset（debug）');
  // 坏文件已被重写为合法状态
  const fixed = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(Number.isFinite(fixed.tokens), '坏文件被原子重写为合法状态');
});

test('累计等待超 maxWaitMs → COOLDOWN_ABORT（沿用 exit 75 语义），且不扣 token、不无限等', async () => {
  const dir = tmpDir();
  const file = fileIn(dir);
  const clock = fakeClock();
  const events = [];
  const logger = captureLogger(events);
  writeFileSync(file, JSON.stringify({ tokens: 0, at: iso(clock.start) }));
  // perMin=1 → 每分钟才 1 个 token；单次最多睡 2 秒；上限 5 秒 → 第 3 次等待时超限
  await assert.rejects(
    () => takeToken({ perMin: 1, maxWaitMs: 5000, file, logger, now: clock.now, sleepFn: clock.sleep }),
    (err) => {
      assert.equal(err.code, 'COOLDOWN_ABORT', '沿用既有 COOLDOWN_ABORT（cli softAbort → exit 75 + interrupted）');
      assert.ok(err.waitMs > 5000, '错误里带需要等多久（便于排障）');
      return true;
    },
  );
  assert.deepEqual(clock.sleeps, [MAX_SLEEP_STEP_MS, MAX_SLEEP_STEP_MS], '单次最多 2 秒、循环累积到上限就中断');
  const abortLog = events.find((e) => e.event === 'sync.rate_gate_abort');
  assert.ok(abortLog, '中断记 sync.rate_gate_abort（warn）');
  assert.equal(abortLog.perMin, 1);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(raw.tokens, 0, '中断时一个 token 都没拿到（没有凭空放行）');

  // maxWaitMs=0：一次都不等，立即中断
  const clock2 = fakeClock();
  await assert.rejects(
    () => takeToken({ perMin: 30, maxWaitMs: 0, file, now: clock2.now, sleepFn: clock2.sleep }),
    (err) => err.code === 'COOLDOWN_ABORT',
  );
  assert.equal(clock2.sleeps.length, 0, 'maxWaitMs=0 不睡');
});

// ---------------------------------------------------------------- 与 http.js 集成：代理重试也扣 token

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

/**
 * 本地拓扑：1 个假 Steam 目标（固定回 status）+ N 个假代理。
 * 每个代理都把自己的端口记进 hits，便于断言「第 N 次请求实际走了哪条代理」。
 */
async function makeProxyTopology(count, status) {
  const targetHits = [];
  const target = http.createServer((req, res) => {
    targetHits.push(req.url);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: status === 200 }));
  });
  const targetPort = await listen(target);
  const proxies = [];
  for (let i = 0; i < count; i += 1) {
    const hits = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url);
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
    proxies.push({ port, hits, close: () => new Promise((r) => server.close(r)) });
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

function captureReqLogger(events) {
  const rec = (level) => (event, fields) => events.push({ level, event, ...(fields ?? {}) });
  return { trace: rec('trace'), debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') };
}

test('代理重试每次都扣 token：一次逻辑请求切 3 条代理 = 扣 3 个（不是每个逻辑请求扣 1 个）', async () => {
  const dir = tmpDir();
  const file = fileIn(dir);
  const topo = await makeProxyTopology(3, 403);
  const saved = { ...process.env };
  const events = [];
  const logger = captureReqLogger(events);
  process.env.STEAM_RATE_FILE = file;
  process.env.STEAM_403_FILE = join(dir, 'steam-403.json');
  process.env.STEAM_429_FILE = join(dir, 'steam-429.json');
  process.env.HTTPS_PROXY = '';
  delete process.env.HTTPS_PROXY;
  delete process.env.HTTP_PROXY;
  delete process.env.NO_PROXY;
  delete process.env.STEAM_429_RETRIES;
  process.env.STEAM_PROXY = topo.proxies.map((p) => `http://127.0.0.1:${p.port}`).join('\n');
  resetProxyHealth();
  try {
    await assert.rejects(
      () => fetchText('http://store.steampowered.com/t/rate-gate', { retries: 0, logger }),
      (err) => err.status === 403,
      '3 条代理全 403 → 抛原错误 403',
    );
    const attempts = events.filter((e) => e.event === 'http.request');
    assert.equal(attempts.length, 3, '每请求最多 3 条代理（默认 rotateMaxPerRequest=3）');
    const used = attempts.map((a) => a.proxy);
    assert.equal(new Set(used).size, 3, '★ 3 次尝试用了 3 条不同代理（切代理真的发生了）');
    assert.deepEqual(topo.proxies.map((p) => p.hits.length), [1, 1, 1], '3 条代理各被真实打到 1 次');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(Math.round(raw.tokens), 27, '★ 3 次真实请求扣 3 个 token（30 → 27）：代理重试也扣');
  } finally {
    process.env = saved;
    await topo.close();
    resetProxyHealth();
  }
});

test('非 Steam 主机不过闸门：token 数量完全不变（闸门只针对 Steam 业务域真实请求）', async () => {
  const dir = tmpDir();
  const file = fileIn(dir);
  // 先建一个满桶状态
  const clock = fakeClock();
  await takeToken({ perMin: 30, file, now: clock.now, sleepFn: clock.sleep });
  const before = JSON.parse(readFileSync(file, 'utf8')).tokens;
  const target = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'));
  const port = await listen(target);
  try {
    const res = await fetchText(`http://127.0.0.1:${port}/not-steam`, { retries: 0 });
    assert.equal(res.status, 200);
    const after = JSON.parse(readFileSync(file, 'utf8')).tokens;
    assert.equal(after, before, '非 Steam 主机请求不扣 token（杉果/GOG/Humble 不受闸门影响）');
  } finally {
    await new Promise((r) => target.close(r));
  }
});
