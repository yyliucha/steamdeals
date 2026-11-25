// FU 批：OpenTelemetry 接入（src/otel.js）的行为锁。
// 锁住三条约束：
//   1) 无 APM_TOKEN 时完全跳过（本地/CI 不受影响、不报错）；
//   2) 配置组装正确：OTLP url = endpoint 去尾斜杠 + /v1/traces、header 为 x-tps-token、
//      服务名取 OTEL_SERVICE_NAME（默认 steamdeals）；
//   3) 有 token 但上报端点不可达：探针只失败、业务进程照常执行退出（不中断主流程）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('buildOtelOptions：默认值、token 守卫与 url 拼接', async () => {
  // 测试进程本身不能有 token，否则顶层 IIFE 会真的启动 SDK
  delete process.env.APM_TOKEN;
  delete process.env.OTEL_SERVICE_NAME;
  const { buildOtelOptions } = await import('../src/otel.js');

  const off = buildOtelOptions({});
  assert.equal(off.enabled, false, '无 APM_TOKEN 时探针必须关闭');
  assert.equal(off.endpoint, 'http://plap-shanghai.apm.tencentcs.com:4319', '默认内网接入点');
  assert.equal(off.url, 'http://plap-shanghai.apm.tencentcs.com:4319/v1/traces', 'OTLP trace 路径');
  assert.equal(off.serviceName, 'steamdeals', '默认服务名');
  assert.equal(off.sampleRate, 0.1, '采样率默认 0.1（控制上报量与费用）');
  assert.deepEqual(off.headers, {}, '无 token 不得携带任何 header');

  const on = buildOtelOptions({ APM_TOKEN: 'test-token', OTEL_SERVICE_NAME: 'steamdeals-scheduler' });
  assert.equal(on.enabled, true, '有 APM_TOKEN 时探针开启');
  assert.deepEqual(on.headers, { 'x-tps-token': 'test-token' }, 'token 必须走 x-tps-token header（腾讯云接入示例）');
  assert.equal(on.serviceName, 'steamdeals-scheduler', 'OTEL_SERVICE_NAME 可覆盖服务名');

  const slash = buildOtelOptions({ APM_TOKEN: 't', APM_ENDPOINT: 'http://example.com/' });
  assert.equal(slash.url, 'http://example.com/v1/traces', 'endpoint 尾斜杠必须去除，否则拼出双斜杠坏地址');

  // 采样率三态：env 覆盖 / 0 回退默认 / 非法值回退默认
  assert.equal(buildOtelOptions({ APM_TOKEN: 't', APM_SAMPLE_RATE: '0.5' }).sampleRate, 0.5, 'APM_SAMPLE_RATE 可覆盖');
  assert.equal(buildOtelOptions({ APM_TOKEN: 't', APM_SAMPLE_RATE: '0' }).sampleRate, 0.1, '采样率 0 回退默认 0.1');
  assert.equal(buildOtelOptions({ APM_TOKEN: 't', APM_SAMPLE_RATE: 'abc' }).sampleRate, 0.1, '非法采样率回退默认 0.1');
});

test('无 token：--import 预加载后 CLI --help 正常退出（本地跳过探针）', () => {
  const r = spawnSync(process.execPath, ['--import', './src/otel.js', 'src/cli.js', '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, APM_TOKEN: '' },
  });
  assert.equal(r.status, 0, `无 token 启动失败：${r.stderr}`);
});

test('有 token 但上报端点不可达：探针失败不中断业务进程', () => {
  // 真实路径：SDK 启动 + HTTP 插桩 + 首轮 batch 上报全走一遍，端点必然连接失败；
  // 业务代码（alive）必须照常打印、进程正常退出码 0。
  const script = [
    "const { request } = require('node:http');",
    "const req = request('http://127.0.0.1:1/', () => {});",
    "req.on('error', () => {});",
    "req.end();",
    "setTimeout(() => console.log('alive'), 600);",
  ].join('');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--import', './src/otel.js', '-e', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      APM_TOKEN: 'dummy-token',
      APM_ENDPOINT: 'http://127.0.0.1:1', // 必然连接失败
      OTEL_BSP_SCHEDULE_DELAY: '100', // 加速首轮上报，让失败路径真实发生
      OTEL_BSP_EXPORT_TIMEOUT: '300',
    },
  });
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 0, `探针失败导致进程异常：${r.stderr}`);
  assert.match(r.stdout, /alive/, '业务代码必须照常执行');
  // 锁「探针失败不拖慢业务」：exporter 重试定时器必须限时（timeoutMillis），
  // 否则短命 CLI 子进程会被拖 ~10 秒才退出（调度器 spawn 的子命令每次退出都变慢）
  assert.ok(elapsed < 5000, `探针失败拖慢进程退出（耗时 ${elapsed}ms，应 <5s）`);
});
