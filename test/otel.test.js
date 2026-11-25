// FU 批：OpenTelemetry 接入（src/otel.js）的行为锁。
// 锁住四条约束：
//   1) 无 APM_TOKEN 时完全跳过（本地/CI 不受影响、不报错）；
//   2) 配置组装正确：接入点为 gRPC host:port（默认 pl.ap-shanghai…:4319，去尾斜杠/容忍旧
//      /v1/traces 后缀）、服务名取 OTEL_SERVICE_NAME（默认 steamdeals）、采样率默认 0.1；
//   3) v2.30.1 gRPC 修正：token 必须以 **Resource 属性**上报（APM_TOKEN 与官方 key token 同值），
//      不能再走 `x-tps-token` header——端到端起一个假 OTLP gRPC 服务，断言报文 body 里有 token、
//      gRPC metadata 里没有它；
//   4) 有 token 但上报端点不可达：探针只失败、业务进程照常执行退出（不中断/不拖慢主流程）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import grpc from '@grpc/grpc-js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('buildOtelOptions：默认值、token 守卫、gRPC 端点归一化与资源属性', async () => {
  // 测试进程本身不能有 token，否则顶层 IIFE 会真的启动 SDK
  delete process.env.APM_TOKEN;
  delete process.env.OTEL_SERVICE_NAME;
  const { buildOtelOptions, buildResourceAttributes, normalizeEndpoint } = await import('../src/otel.js');

  const off = buildOtelOptions({});
  assert.equal(off.enabled, false, '无 APM_TOKEN 时探针必须关闭');
  assert.equal(off.endpoint, 'http://pl.ap-shanghai.apm.tencentcs.com:4319', '默认接入点必须是 gRPC h2c 的 4319（pl.<region> 是点分隔，实测唯一可解析）');
  assert.equal(off.serviceName, 'steamdeals', '默认服务名');
  assert.equal(off.sampleRate, 0.1, '采样率默认 0.1（控制上报量与费用）');
  assert.equal(off.url, undefined, 'gRPC 接入不再拼 /v1/traces 这种 HTTP 路径');
  assert.equal(off.headers, undefined, 'gRPC 接入不再用 HTTP header 传 token');

  const on = buildOtelOptions({ APM_TOKEN: 'test-token', OTEL_SERVICE_NAME: 'steamdeals-scheduler' });
  assert.equal(on.enabled, true, '有 APM_TOKEN 时探针开启');
  assert.equal(on.serviceName, 'steamdeals-scheduler', 'OTEL_SERVICE_NAME 可覆盖服务名');

  // token 走 Resource 属性：腾讯云官方 Node 文档的 key 是 token，操作口径是 APM_TOKEN，两个都要有
  assert.equal(on.resourceAttributes.APM_TOKEN, 'test-token', 'token 必须作为 APM_TOKEN 资源属性');
  assert.equal(on.resourceAttributes.token, 'test-token', '同时带官方 key token（否则服务端可能丢弃）');
  assert.equal(on.resourceAttributes.SERVICE_NAME, 'steamdeals-scheduler', 'SERVICE_NAME 资源属性取服务名');
  assert.equal(on.resourceAttributes['service.name'], 'steamdeals-scheduler', '标准 service.name 同步设置');
  assert.equal(on.resourceAttributes.APP_ID, 'steamdeals-scheduler', 'APP_ID 未配置时用服务名兜底');
  assert.equal(on.resourceAttributes.SERVER_ID, 'steamdeals-scheduler', 'SERVER_ID 未配置时用服务名兜底');
  assert.equal(on.resourceAttributes['host.name'], 'steamdeals-scheduler', '实例名 host.name 用兜底值');

  const custom = buildResourceAttributes(
    { APM_APP_ID: 'app-123', APM_SERVER_ID: 'srv-9' },
    { token: 't', serviceName: 'steamdeals-app' },
  );
  assert.equal(custom.APP_ID, 'app-123', 'APM_APP_ID 可覆盖 APP_ID');
  assert.equal(custom.SERVER_ID, 'srv-9', 'APM_SERVER_ID 可覆盖 SERVER_ID');
  assert.equal(custom['host.name'], 'srv-9', '实例名跟 SERVER_ID 走');

  // 端点归一化：尾斜杠、沿用旧 HTTP 地址时多出的 /v1/traces 都要吃掉，gRPC 只接受 host:port
  assert.equal(normalizeEndpoint('http://example.com:4319/'), 'http://example.com:4319', '尾斜杠必须去除');
  assert.equal(normalizeEndpoint('http://example.com:4319/v1/traces'), 'http://example.com:4319', '旧 HTTP 路径必须去掉');
  assert.equal(normalizeEndpoint('http://example.com:4319/v1/traces/'), 'http://example.com:4319', '路径+尾斜杠也要归一化');
  assert.equal(normalizeEndpoint(''), 'http://pl.ap-shanghai.apm.tencentcs.com:4319', '空值回退默认接入点');
  // v2.30.0 文档的笔误域名照抄到 compose 会 NXDOMAIN：必须自动纠正回官方格式
  assert.equal(
    normalizeEndpoint('http://plap-shanghai.apm.tencentcs.com:4319'),
    'http://pl.ap-shanghai.apm.tencentcs.com:4319',
    '历史笔误域名 plap-shanghai 必须纠正为 pl.ap-shanghai',
  );

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

// 假 OTLP TraceService：只为收报文，不做 protobuf 解码（Resource 属性是 UTF-8 字符串，直接字节匹配即可）
function startFakeOtlpGrpc() {
  const requests = [];
  const metadata = [];
  const server = new grpc.Server();
  server.addService(
    {
      Export: {
        path: '/opentelemetry.proto.collector.trace.v1.TraceService/Export',
        requestStream: false,
        responseStream: false,
        requestSerialize: (v) => v,
        requestDeserialize: (b) => b,
        responseSerialize: (v) => v,
        responseDeserialize: (b) => b,
      },
    },
    {
      Export: (call, callback) => {
        requests.push(Buffer.from(call.request));
        metadata.push(call.metadata);
        // 空 ExportTraceServiceResponse：OTLP 成功响应的合法形式
        callback(null, Buffer.alloc(0));
      },
    },
  );
  return new Promise((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err);
      resolve({ server, port, requests, metadata });
    });
  });
}

test('有 token：gRPC 上报把 token 放进 Resource 属性（报文 body），不再走 header', async () => {
  const { server, port, requests, metadata } = await startFakeOtlpGrpc();
  // 业务侧的一个普通 HTTP 服务：子进程请求它，产生一个出站 span 触发上报
  const httpServer = createHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const httpPort = httpServer.address().port;

  // 子进程：真实走 `--import ./src/otel.js` + HttpInstrumentation + gRPC exporter → 我们的假服务
  const script = [
    "const { request } = require('node:http');",
    `const req = request('http://127.0.0.1:${httpPort}/', (res) => { res.resume(); });`,
    "req.on('error', () => {});",
    'req.end();',
    "setTimeout(() => console.log('alive'), 900);",
  ].join('');
  const child = spawn(process.execPath, ['--import', './src/otel.js', '-e', script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      APM_TOKEN: 'tok-fu-grpc-01',
      APM_ENDPOINT: `http://127.0.0.1:${port}`,
      OTEL_SERVICE_NAME: 'steamdeals-otel-e2e',
      APM_SAMPLE_RATE: '1', // 端到端必须全采样，否则 0.1 采样率下大概率判定不到上报
      OTEL_BSP_SCHEDULE_DELAY: '100', // 加速首轮上报，让端到端在测试时间里发生
      OTEL_BSP_EXPORT_TIMEOUT: '1200',
    },
  });
  let childErr = '';
  child.stderr.on('data', (d) => { childErr += d; });

  try {
    // 等假服务收到至少一个 OTLP 请求（最多 8 秒）；收到就说明 h2c gRPC 链路真的通了
    const deadline = Date.now() + 8000;
    while (requests.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(requests.length > 0, `假 OTLP gRPC 服务没收到任何请求（子进程 stderr: ${childErr}）`);

    const body = Buffer.concat(requests);
    // Resource 属性在报文里是明文 UTF-8：token 出现在 body 就证明「没走 header，走资源属性」
    assert.ok(body.includes(Buffer.from('tok-fu-grpc-01')), 'token 必须出现在 OTLP 报文 body（Resource 属性）');
    assert.ok(body.includes(Buffer.from('APM_TOKEN')), '报文必须带 APM_TOKEN 资源属性键');
    assert.ok(body.includes(Buffer.from('steamdeals-otel-e2e')), 'OTEL_SERVICE_NAME 必须作为服务名上报');
    assert.ok(body.includes(Buffer.from('SERVICE_NAME')), '报文必须带 SERVICE_NAME 资源属性键');
    assert.ok(body.includes(Buffer.from('SERVER_ID')), '报文必须带 SERVER_ID 资源属性键');

    const metaMap = metadata[0].getMap();
    assert.equal(metaMap['x-tps-token'], undefined, 'v2.30.1 起不得再用 x-tps-token header 传 token');
  } finally {
    child.kill();
    httpServer.close();
    server.forceShutdown();
  }
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
