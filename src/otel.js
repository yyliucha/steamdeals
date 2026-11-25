// FU：腾讯云 APM 接入（OpenTelemetry OTLP HTTP，规格 docs/APM-TENCENT.md）。
// 通过 `node --import ./src/otel.js`（docker-entrypoint.sh 里的 NODE_OPTIONS）在业务代码之前加载：
//   - 有 APM_TOKEN 才启动 SDK 并上报 Trace；
//   - 没有 token 直接返回——本地开发 / CI / 测试 / 未配置 APM 的部署完全不受影响，不报错；
//   - 探针自身失败只打日志、绝不中断业务进程（APM 是旁路观测，不能拖垮主流程）。
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
// 规格示例写 @opentelemetry/sdk-trace-base，但 3.1.x 起该包已并入 @opentelemetry/sdk-trace
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace';

// 配置组装独立成纯函数，供测试锁住「url 拼接 / token header / 采样率 / 无 token 跳过」约束。
export function buildOtelOptions(env = process.env) {
  const endpoint = (env.APM_ENDPOINT || 'http://plap-shanghai.apm.tencentcs.com:4319').replace(/\/+$/, '');
  const token = env.APM_TOKEN || '';
  const serviceName = env.OTEL_SERVICE_NAME || 'steamdeals';
  // 采样率默认 0.1（控制上报量与费用）；0/非法值同样回退 0.1（与规格一致）
  const sampleRate = Number(env.APM_SAMPLE_RATE ?? 0.1) || 0.1;
  return {
    enabled: Boolean(token),
    endpoint,
    url: `${endpoint}/v1/traces`,
    serviceName,
    sampleRate,
    headers: token ? { 'x-tps-token': token } : {}, // header 名以腾讯云控制台接入示例为准
  };
}

// 顶层执行一次：--import 预加载与测试动态 import 走同一条路径。
export const otelState = (() => {
  const opts = buildOtelOptions();
  if (!opts.enabled) return { enabled: false, sdk: null, opts };
  let sdk = null;
  try {
    sdk = new NodeSDK({
      // resources 3.x 起 Resource 是接口：用 defaultResource 合并 service.name（保留 SDK 默认属性）
      resource: defaultResource().merge(resourceFromAttributes({ [ATTR_SERVICE_NAME]: opts.serviceName })),
      traceExporter: new OTLPTraceExporter({
        url: opts.url,
        headers: opts.headers,
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
