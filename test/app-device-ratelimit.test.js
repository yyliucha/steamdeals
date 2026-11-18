// CO-3/C2（docs/DESIGN-AUDIT.md C2）：/api/app/* 设备维度限流 + 审计。
// 守的约束：
//   1. 同设备超限 → 429（带 retryAfterSec 与 Retry-After），不同设备互不影响（X-Device-Id 为键）；
//   2. 封禁/黑名单豁免不回归：被封禁设备、被黑名单 IP 仍能访问 /api/app/*（只按设备窗口 429），
//      Web 路径（/api/me 等）照旧 403——豁免只对 App 命名空间；
//   3. 超限落审计事件 app.device_rate_limited（含设备 id / 计数 / 阈值）；
//   4. 阈值走 env（settings def() 水合后为 APP_DEVICE_RATE_*，与 ratelimit.configureFromEnv 同款热加载）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import * as devices from '../src/devices.js';
import * as visitors from '../src/visitors.js';
import * as appRateLimit from '../src/app-ratelimit.js';
import { startApiServer } from '../src/server.js';

process.env.CAPTCHA_ENABLED = '0';

test('单元：滑动窗口按设备独立计数，超限带 retryAfterSec，不封禁只 429', () => {
  appRateLimit.resetState();
  appRateLimit.configure({ enabled: true, max: 3, windowSec: 60 });

  for (let i = 0; i < 3; i += 1) {
    const v = appRateLimit.hitDevice('dev-window-0001');
    assert.equal(v.limited, false, `第 ${i + 1} 次不应超限`);
    assert.equal(v.count, i + 1);
  }
  const fourth = appRateLimit.hitDevice('dev-window-0001');
  assert.equal(fourth.limited, true, '第 4 次必须 429');
  assert.equal(fourth.count, 4);
  assert.equal(fourth.max, 3);
  assert.equal(fourth.windowSec, 60);
  assert.ok(fourth.retryAfterSec >= 1, 'retryAfterSec 至少 1 秒');

  // 不同设备互不影响（C2 验收核心：一个设备刷爆不影响其它设备）
  const other = appRateLimit.hitDevice('dev-window-0002');
  assert.equal(other.limited, false, '其它设备不受同窗口影响');
});

test('单元：无设备 id 不进入限流；开关与 env 配置生效', () => {
  appRateLimit.resetState();
  assert.deepEqual(appRateLimit.hitDevice(''), { limited: false }, '无设备 id → 不计数（仍受全局 IP 限流）');
  assert.deepEqual(appRateLimit.hitDevice(null), { limited: false });

  appRateLimit.configure({ enabled: false, max: 1, windowSec: 60 });
  assert.equal(appRateLimit.hitDevice('dev-off-0001').limited, false, '开关关闭 → 不限流');

  const oldMax = process.env.APP_DEVICE_RATE_MAX;
  const oldWindow = process.env.APP_DEVICE_RATE_WINDOW_SEC;
  try {
    process.env.APP_DEVICE_RATE_MAX = '7';
    process.env.APP_DEVICE_RATE_WINDOW_SEC = '120';
    appRateLimit.configureFromEnv();
    const cfg = appRateLimit.currentConfig();
    assert.equal(cfg.max, 7);
    assert.equal(cfg.windowSec, 120);
    assert.equal(cfg.enabled, true);
  } finally {
    if (oldMax === undefined) delete process.env.APP_DEVICE_RATE_MAX;
    else process.env.APP_DEVICE_RATE_MAX = oldMax;
    if (oldWindow === undefined) delete process.env.APP_DEVICE_RATE_WINDOW_SEC;
    else process.env.APP_DEVICE_RATE_WINDOW_SEC = oldWindow;
    appRateLimit.resetState();
  }
});

test('HTTP：同设备超限 429 + 异设备不受影响 + 审计事件落日志', async () => {
  appRateLimit.resetState();
  devices.resetState();
  // 阈值注入：startApiServer 启动时 configureFromEnv 会读到这里写好的低阈值
  process.env.APP_DEVICE_RATE_MAX = '3';
  process.env.APP_DEVICE_RATE_WINDOW_SEC = '60';
  const events = [];
  const logger = {
    info: () => {},
    warn: (event, fields) => events.push({ event, fields }),
    error: () => {},
  };

  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1', logger });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const headers = { 'x-device-id': 'dev-aaaa-0001' };
    const url = `${base}/api/app/me`;
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(url, { headers });
      assert.equal(res.status, 200, `第 ${i + 1} 次应 200（当前窗口阈值 3）`);
    }
    const limited = await fetch(url, { headers });
    assert.equal(limited.status, 429, '同设备第 4 次必须 429');
    const body = await limited.json();
    assert.ok(Number.isInteger(body.retryAfterSec) && body.retryAfterSec >= 1, '429 带 retryAfterSec');
    assert.ok(Number(limited.headers.get('retry-after')) >= 1, '429 带 Retry-After 头（APP-API 契约）');

    // 异设备不受影响（设备 B 用自己的窗口）
    const other = await fetch(url, { headers: { 'x-device-id': 'dev-bbbb-0002' } });
    assert.equal(other.status, 200, '不同设备互不影响');

    // 审计事件：超限必须落 app.device_rate_limited（含设备 id / 计数 / 阈值）
    const audit = events.filter((e) => e.event === 'app.device_rate_limited');
    assert.ok(audit.length >= 1, '审计事件必须落日志');
    assert.equal(audit[0].fields.deviceId, 'dev-aaaa-0001');
    assert.equal(audit[0].fields.count, 4);
    assert.equal(audit[0].fields.max, 3);
    assert.equal(audit[0].fields.windowSec, 60);

    // /api/app/status 不受设备窗口计数（契约 §3：仍只受全局基础限流）——
    // 设备 A 已超限，但 status 仍 200。
    const status = await fetch(`${base}/api/app/status`, { headers });
    assert.equal(status.status, 200, '/api/app/status 保持 200（不在设备窗口内计数）');
  } finally {
    await srv.close();
    await store.close();
    delete process.env.APP_DEVICE_RATE_MAX;
    delete process.env.APP_DEVICE_RATE_WINDOW_SEC;
    appRateLimit.resetState();
    devices.resetState();
  }
});

test('HTTP：封禁/黑名单豁免不回归（App 命名空间 200，Web 路径照旧 403）', async () => {
  appRateLimit.resetState();
  devices.resetState();
  process.env.APP_DEVICE_RATE_MAX = '100';
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  // 设备封禁：内存态注入（device_id 与 X-Device-Id 一致）
  devices.rememberBan({ fingerprint: 'f'.repeat(64), device_id: 'dev-ban-000001', note: '测试封禁', until: null });
  // IP 黑名单：把测试 IP 写进 ip_blacklist 并刷新内存态
  await q(`insert into ip_blacklist (ip, note) values ('127.0.0.1', 'C2 测试') on conflict (ip) do nothing`);
  await visitors.refreshBlocklist(q);

  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    // App 命名空间：被封设备 + 被黑名单 IP → 仍 200（豁免不回归，只按设备窗口限流）
    const appRes = await fetch(`${base}/api/app/me`, { headers: { 'x-device-id': 'dev-ban-000001' } });
    assert.equal(appRes.status, 200, '/api/app/* 豁免设备封禁与 IP 黑名单（设计取舍不变）');

    // Web 路径照旧被黑名单拦截（豁免只对 App 命名空间，Web /api/* 行为不变）
    const webRes = await fetch(`${base}/api/me`);
    assert.equal(webRes.status, 403, 'Web /api/me 仍被 IP 黑名单 403');
  } finally {
    await srv.close();
    await q(`delete from ip_blacklist where ip = '127.0.0.1'`);
    await visitors.refreshBlocklist(q);
    await store.close();
    delete process.env.APP_DEVICE_RATE_MAX;
    appRateLimit.resetState();
    devices.resetState();
  }
});
