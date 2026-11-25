# 接入腾讯云 APM（OpenTelemetry）（FU，已发布 v2.30.0；v2.30.1 为 gRPC 修正，待发版）

> 所有者要求（2026-11-25）：项目接入腾讯云 APM（应用性能监控）——Node.js 应用，OpenTelemetry 协议。
> 我们的部署是 Docker Compose（不是 TKE），不能用 Operator 自动注入；用 OpenTelemetry SDK 手动接入。
>
> **v2.30.1 修正（2026-11-25 晚，本轮）**：腾讯云 APM 的 4319 接入点**只接受 HTTP/2（h2c），h1 被关闭**，
> 原有 `@opentelemetry/exporter-trace-otlp-http` 的 `POST /v1/traces` 上报不成立；官方示例要求用
> `@opentelemetry/exporter-trace-otlp-grpc` + `url: 'http://pl.ap-shanghai.apm.tencentcs.com:4319'`，
> 且 **token 必须以 Resource 属性上报**（不是 header）。详见 §5 变更记录。

## 1. 接入方案

### 依赖（package.json）

```json
"@opentelemetry/sdk-node": "^0.301.2",
"@opentelemetry/exporter-trace-otlp-grpc": "^0.301.2",
"@opentelemetry/resources": "^3.1.1",
"@opentelemetry/semantic-conventions": "^1.45.0",
"@opentelemetry/instrumentation-http": "^0.301.2"
```

- gRPC exporter 会自动带上 `@grpc/grpc-js`（`otlp-grpc-exporter-base` 的依赖），不需要显式声明；
- 已移除 `@opentelemetry/exporter-trace-otlp-http`（v2.30.1 起不用）；`@opentelemetry/sdk-trace` 由
  `sdk-node` 传递安装，采样器从它导入（3.1.x 起 `sdk-trace-base` 已并入）。

### `src/otel.js`（ESM，启动前加载）

```js
// 腾讯云 APM 接入（OTLP gRPC / h2c）——token 从环境变量注入，不入库
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace';

const endpoint = (process.env.APM_ENDPOINT || 'http://pl.ap-shanghai.apm.tencentcs.com:4319')
  .replace(/\/+$/, '').replace(/\/v1\/traces$/, '');   // gRPC 只接受 host:port，路径由 exporter 自带
const token = process.env.APM_TOKEN || '';
const serviceName = process.env.OTEL_SERVICE_NAME || 'steamdeals';

const sdk = new NodeSDK({
  resource: defaultResource().merge(resourceFromAttributes({
    'service.name': serviceName,
    SERVICE_NAME: serviceName,   // 与 service.name 同值，便于控制台按服务名分组
    APM_TOKEN: token,            // 腾讯云要求 token 走 Resource 属性
    token,                       // 官方 Node 文档的 Resource key 是小写 token，两个都带最稳
    APP_ID: process.env.APM_APP_ID || serviceName,
    SERVER_ID: process.env.APM_SERVER_ID || serviceName,
    'host.name': process.env.APM_SERVER_ID || serviceName,
  })),
  traceExporter: new OTLPTraceExporter({
    url: endpoint,               // http:// 前缀 → h2c 明文；不要拼 /v1/traces
    timeoutMillis: 1500,         // 上报 deadline：连不上快速放弃，不拖慢短命 CLI
  }),
  sampler: new TraceIdRatioBasedSampler(Number(process.env.APM_SAMPLE_RATE ?? 0.1) || 0.1),
  instrumentations: [new HttpInstrumentation()],
});
sdk.start();
```

- 若进程退出前需要 `sdk.shutdown()`——**不要**加：serve/scheduler 已有自己的 SIGTERM 排空逻辑（EU-5），
  再挂 handler 会抢时序，并把没有 handler 的短命令的 SIGTERM 默认退出行为吞掉。
- 探针自身失败只 `console.error` 后停用，不抛错中断启动（`src/otel.js` 里 `try/catch` 包住整个 SDK 组装）。

### 启动注入

- `scripts/docker-entrypoint.sh`：`export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import ./src/otel.js"`
  （对 bootstrap / serve / scheduler / 一次性 CLI 统一生效；`test/deploy.test.js` 有断言锁）；
- 本地/CI/测试没有 `APM_TOKEN` 时 `src/otel.js` 直接返回，不启动 SDK。

### 部署配置（服务器 compose，token 不入库）

```yaml
environment:
  APM_TOKEN: "<腾讯云 token>"                    # 必填；真实值只放服务器 compose
  OTEL_SERVICE_NAME: "steamdeals-app"            # 或 steamdeals-scheduler
  APM_ENDPOINT: "http://pl.ap-shanghai.apm.tencentcs.com:4319"   # 可省（默认值就是这个）
  APM_SAMPLE_RATE: "0.1"                         # 可省，默认 0.1
  APM_APP_ID: "<业务系统 ID>"                     # 可选，默认取 OTEL_SERVICE_NAME
  APM_SERVER_ID: "<实例 ID>"                      # 可选，默认取 OTEL_SERVICE_NAME
```

- **不需要 `NODE_TLS_REJECT_UNAUTHORIZED` 之类的开关**：4319 是 h2c 明文（`http://` 前缀 → `credentials.createInsecure()`）；
- token 只作为 Resource 属性出现在 OTLP 报文里，不写进 URL、不用 header/metadata。

## 2. 试点顺序

1. 先在 **scheduler 容器**（`OTEL_SERVICE_NAME=steamdeals-scheduler`）接入，观察控制台有数据、无性能问题；
2. 再给 **app 容器**接入（`steamdeals-app`）；
3. 探针异常不影响主流程（otel.js 失败只打日志、不抛错中断启动）。

## 3. 验收

1. 腾讯云 APM 控制台出现 `steamdeals-app` / `steamdeals-scheduler` 服务与 Trace；
2. 站点/调度功能不受影响（HTTP 延迟无明显变化，`npm test` 全绿）；
3. token 不出现在仓库（只服务器 compose env）；
4. 本地/CI 无 `APM_TOKEN` 时自动跳过（不报错）；
5. **（v2.30.1 新增）**本机用假 OTLP gRPC 服务可验证：h2c 链路通、报文 Resource 属性里有 token、
   `x-tps-token` header 不再出现（`test/otel.test.js` 端到端用例已锁）。

## 4. 本地验证方法

```powershell
cd F:\dsh\gameprice
node test/otel.test.js        # 4/4：配置组装 / 无 token 跳过 / 假 gRPC 端到端 / 端点不可达不拖进程
```

端到端用例的做法：用 `@grpc/grpc-js` 起一个假 `TraceService/Export`，子进程 `--import ./src/otel.js`
指向它的端口，断言收到的 protobuf 报文 body 里含 token（Resource 属性）、gRPC metadata 里没有 token。

## 5. 变更记录

| 版本 | 变更 | 原因 |
|---|---|---|
| v2.30.0（07db9a9） | OTLP **HTTP** exporter，`POST {endpoint}/v1/traces`，token 走 `x-tps-token` header，默认端点 `plap-shanghai…:4319` | 初版接入（按当时的规格示例） |
| v2.30.1（本轮） | 换 **OTLP gRPC** exporter（`@opentelemetry/exporter-trace-otlp-grpc`），url 只给 `http://pl.ap-shanghai.apm.tencentcs.com:4319`，token 改 Resource 属性（`APM_TOKEN` + 官方 `token`），新增 `SERVICE_NAME`/`APP_ID`/`SERVER_ID`/`host.name`，删除 `x-tps-token` header | 腾讯云 APM 的 4319 只接受 HTTP/2（h2c），h1 被关闭；官方要求 gRPC + Resource 属性上报 token；顺带修正默认域名拼写（`plap-` → `pl.`：本机实测 `plap-shanghai…` 与 `pl-ap-shanghai…` 都是 NXDOMAIN，只有 `pl.ap-shanghai.apm.tencentcs.com` 解析到 169.254.0.177） |
