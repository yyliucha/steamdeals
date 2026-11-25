# 接入腾讯云 APM（OpenTelemetry）（FU，待开发，2026-11-25）

> 所有者要求（2026-11-25）：项目接入腾讯云 APM（应用性能监控）——Node.js 应用，OpenTelemetry 协议，
> 「内网上报」接入点：`http://plap-shanghai.apm.tencentcs.com:4319`（HTTP）/ `https://plap-shanghai.apm.tencentcs.com:4320`（HTTPS）。
> **注意**：我们的部署是 Docker Compose（不是 TKE），不能用 Operator 自动注入；用 OpenTelemetry SDK 手动接入。

## 1. 接入方案

### 依赖（package.json）
```json
"@opentelemetry/sdk-node": "^0.5x",
"@opentelemetry/exporter-trace-otlp-http": "^0.5x",
"@opentelemetry/resources": "^1.x",
"@opentelemetry/semantic-conventions": "^1.x",
"@opentelemetry/instrumentation-http": "^0.5x"
```
（版本以 npm 最新兼容 Node 22 为准；npm ci 后 lock 更新）

### `src/otel.js`（ESM，启动前加载）
```js
// 腾讯云 APM 接入（OTLP HTTP）——token 从环境变量注入，不入库
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

const endpoint = process.env.APM_ENDPOINT || 'http://plap-shanghai.apm.tencentcs.com:4319';
const token = process.env.APM_TOKEN || '';
const serviceName = process.env.OTEL_SERVICE_NAME || 'steamdeals';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
  }),
  traceExporter: new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
    headers: token ? { 'x-tps-token': token } : {},   // token header 以腾讯云控制台示例为准
  }),
  instrumentations: [new HttpInstrumentation()],
});
sdk.start();
```
- 若进程退出前需要 `sdk.shutdown()`——可加 `process.on('SIGTERM', () => sdk.shutdown().finally(() => process.exit(0)))`（注意与 docker-entrypoint/tini 信号转发的配合，别破坏 EU-5 排空）。

### 启动注入
- `docker-entrypoint.sh` 或 Dockerfile CMD：`node --import ./src/otel.js src/cli.js ...`（Node 22 ESM 支持 `--import`）；
- 更简单：compose 里 `environment: NODE_OPTIONS: "--import ./src/otel.js"`（仅当 otel.js 存在；建议做成「无 APM_TOKEN 时直接跳过」的守卫，避免本地/测试受影响）。

### Docker Compose（服务器侧，token 不入库）
```yaml
environment:
  APM_TOKEN: "<腾讯云 token>"          # 真实值只放服务器 compose
  OTEL_SERVICE_NAME: "steamdeals-app"  # 或 steamdeals-scheduler
  APM_ENDPOINT: "http://plap-shanghai.apm.tencentcs.com:4319"
```

## 2. 试点顺序

1. 先在 **scheduler 容器**（`OTEL_SERVICE_NAME=steamdeals-scheduler`）接入，观察控制台有数据、无性能问题；
2. 再给 **app 容器**接入（`steamdeals-app`）；
3. 探针异常不影响主流程（otel.js 失败只打日志、不抛错中断启动）。

## 3. 验收

1. 腾讯云 APM 控制台出现 `steamdeals-app` / `steamdeals-scheduler` 服务与 Trace；
2. 站点/调度功能不受影响（HTTP 延迟无明显变化，`npm test` 全绿）；
3. token 不出现在仓库（只服务器 compose env）；
4. 本地/CI 无 `APM_TOKEN` 时自动跳过（不报错）。
