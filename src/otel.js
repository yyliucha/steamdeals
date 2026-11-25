// FU：腾讯云 APM 接入（OpenTelemetry OTLP **gRPC**，规格 docs/APM-TENCENT.md）。
// 通过 `node --import ./src/otel.js`（docker-entrypoint.sh 里的 NODE_OPTIONS）在业务代码之前加载：
//   - 有 APM_TOKEN 才启动 SDK 并上报 Trace；
//   - 没有 token 直接返回——本地开发 / CI / 测试 / 未配置 APM 的部署完全不受影响，不报错；
//   - 探针自身失败只打日志、绝不中断业务进程（APM 是旁路观测，不能拖垮主流程）。
//
// v2.30.1 修正（腾讯云 APM 接入要求）：
//   - 接入点 4319 是 gRPC（HTTP/2 h2c）端口，只接受 h2；OTLP HTTP 的 POST /v1/traces 会被拒，
//     所以 exporter 换成 @opentelemetry/exporter-trace-otlp-grpc（自带 @grpc/grpc-js）。
//   - token 以 **Resource 属性**上报（腾讯云官方 Node 文档的 key 是 `token`，Operator/环境变量口径是
//     `APM_TOKEN`，两个都带上），不再用 `x-tps-token` header——gRPC 走 metadata，header 那套不生效。
//   - url 只写 host:port（http:// 前缀决定用 h2c 明文凭据），不能拼 /v1/traces：路径由 exporter 自带。
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
// 规格示例写 @opentelemetry/sdk-trace-base，但 3.1.x 起该包已并入 @opentelemetry/sdk-trace
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace';

// 腾讯云 APM 内网 gRPC 接入点（h2c，4319）。别改成 HTTP 的 :4320 或拼 /v1/traces。
// 域名是 `pl.<region>.apm.tencentcs.com`（pl 与 region 之间是点，v2.30.0 文档误写成 plap-shanghai…）；
// 本机实测只有这个名字能解析（内网解析到 169.254.0.177），`plap-` / `pl-ap-` 都是 NXDOMAIN。
export const DEFAULT_APM_ENDPOINT = 'http://pl.ap-shanghai.apm.tencentcs.com:4319';
const DEFAULT_APM_HOST = 'pl.ap-shanghai.apm.tencentcs.com';
// v2.30.0 规格/文档里的历史笔误域名：照抄旧值部署会拿到 NXDOMAIN，升级后自动纠正回来。
const LEGACY_APM_HOST = 'plap-shanghai.apm.tencentcs.com';

// 归一化接入点：去空格与尾斜杠；容忍沿用旧 HTTP 接入地址时多出来的 /v1/traces
// （gRPC exporter 只取 host:port，路径会被它警告并忽略，这里提前清掉免得刷日志）；
// 并把历史笔误域名纠正为官方格式。
export function normalizeEndpoint(raw) {
  return String(raw || DEFAULT_APM_ENDPOINT)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/traces$/, '')
    .replace(LEGACY_APM_HOST, DEFAULT_APM_HOST);
}

// Resource 属性组装独立成纯函数，供测试锁住「token 走资源属性 / 服务名 / APP_ID·SERVER_ID 兜底」。
export function buildResourceAttributes(env = process.env, { token = '', serviceName = 'steamdeals' } = {}) {
  // APP_ID / SERVER_ID 可选：没配就用服务名兜底，同一份 compose 只改 OTEL_SERVICE_NAME 也能上报。
  const appId = env.APM_APP_ID || serviceName;
  const serverId = env.APM_SERVER_ID || serviceName;
  return {
    [ATTR_SERVICE_NAME]: serviceName,
    // 腾讯云接入示例里的资源属性名（大写口径）；SERVICE_NAME 与 service.name 同值，便于控制台按名字分组
    SERVICE_NAME: serviceName,
    APM_TOKEN: token,
    // 腾讯云官方 Node 文档的 Resource key 是小写 `token`（OTEL_RESOURCE_ATTRIBUTES='token=…'）；
    // 只报 APM_TOKEN 时若服务端只认 token 会被丢弃，两个 key 同值都带上最稳。
    token,
    APP_ID: appId,
    SERVER_ID: serverId,
    // 实例名（官方文档 key 为 host.name）；不设则控制台实例名为空，用 SERVER_ID 兜底值
    'host.name': serverId,
  };
}

// 配置组装独立成纯函数，供测试锁住「端点归一化 / token 守卫 / 采样率 / 资源属性」约束。
export function buildOtelOptions(env = process.env) {
  const endpoint = normalizeEndpoint(env.APM_ENDPOINT);
  const token = env.APM_TOKEN || '';
  const serviceName = env.OTEL_SERVICE_NAME || 'steamdeals';
  // 采样率默认 0.1（控制上报量与费用）；0/非法值同样回退 0.1（与规格一致）
  const sampleRate = Number(env.APM_SAMPLE_RATE ?? 0.1) || 0.1;
  return {
    enabled: Boolean(token),
    endpoint,
    serviceName,
    sampleRate,
    resourceAttributes: buildResourceAttributes(env, { token, serviceName }),
  };
}

// 顶层执行一次：--import 预加载与测试动态 import 走同一条路径。
export const otelState = (() => {
  const opts = buildOtelOptions();
  if (!opts.enabled) return { enabled: false, sdk: null, opts };
  let sdk = null;
  try {
    sdk = new NodeSDK({
      // resources 3.x 起 Resource 是接口：用 defaultResource 合并资源属性（保留 SDK 默认属性）
      resource: defaultResource().merge(resourceFromAttributes(opts.resourceAttributes)),
      traceExporter: new OTLPTraceExporter({
        // 只给 host:port（http:// 前缀 → h2c 明文），路径由 gRPC exporter 自带
        url: opts.endpoint,
        // 上报失败时 exporter 内部重试定时器是 ref 的，默认最长会拖住短命 CLI 子进程约 10 秒
        // （调度器 spawn 的 sync 等子命令每次退出都变慢）；压到 1.5 秒：内网 APM 延迟毫秒级，
        // 连不上就快速放弃，绝不能反过来拖慢业务。
        timeoutMillis: 1500,
      }),
      // FU 采样率：APM_SAMPLE_RATE 默认 0.1，控制上报量与费用（规格 888a8b9）
      sampler: new TraceIdRatioBasedSampler(opts.sampleRate),
      instrumentations: [new HttpInstrumentation()],
    });
    sdk.start();
  } catch (err) {
    // 启动失败（依赖缺失/配置异常）只打日志停用探针，不让业务进程因此退出。
    console.error(`[otel] SDK 启动失败，探针停用：${err?.stack || err}`);
    return { enabled: false, sdk: null, opts };
  }
  return { enabled: true, sdk, opts };
})();

// 故意不注册 SIGTERM 的 sdk.shutdown() 钩子：serve/scheduler 已有自己的 SIGTERM 排空逻辑
// （EU-5，见 src/scheduler.js、src/cli/ops.js）；这里再挂 handler 会与排空抢时序，且对
// 没有 handler 的短命令（如 bootstrap）会把 SIGTERM 默认退出行为吞掉导致挂住。
// 停机瞬间最后一批未上报的 span 丢失可接受——APM 是观测旁路，不牺牲主流程停机正确性。
