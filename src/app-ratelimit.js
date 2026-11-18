// CO-3/C2（docs/DESIGN-AUDIT.md C2）：/api/app/* 设备维度限流。
//
// 背景：/api/app/* 豁免 IP 黑名单与设备封禁（App 可用性的设计取舍，CA-1 契约），
// 只有全局 API 基础限流（150 次/分钟/IP）兜底。攻击者换 IP 就能绕过——
// 这里补一个**按设备**的滑动窗口：X-Device-Id 为键，每个设备独立计数，
// 超限只 429（带 retryAfterSec / Retry-After），**不封禁、不写库、不影响其它设备**；
// 审计事件由调用方记（app.device_rate_limited）。
//
// 阈值走业务设置 app.deviceRateMax / app.deviceRateWindowSec（settings def() →
// env 热加载，与 ratelimit.js 同款 configureFromEnv 模式）；env 未配置用默认值。
//
// 无有效 X-Device-Id 的请求不进入本限流（仍受全局 IP 基础限流约束），
// 避免把所有没带头部的客户端塞进同一个匿名桶互踩。

export const DEFAULTS = {
  enabled: true,
  max: 300, // 每窗口允许的 App 请求数（正常使用无感；全局 IP 限流 150/分钟更严）
  windowSec: 60, // 窗口长度（秒）
};

const MAX_TRACKED_DEVICES = 20_000;
const MAX_TRACKED_HITS = 200_000;

const windows = new Map(); // deviceId -> number[]（窗口内时间戳）
let config = { ...DEFAULTS };

export function configure(next = {}) {
  const boundedInt = (value, fallback, min, ceiling) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min ? Math.min(Math.floor(n), ceiling) : fallback;
  };
  config = {
    enabled: next.enabled === undefined ? config.enabled : Boolean(next.enabled),
    max: boundedInt(next.max, config.max, 1, 100_000),
    windowSec: boundedInt(next.windowSec, config.windowSec, 1, 3600),
  };
  return { ...config };
}

/** 从环境变量重配（设置页保存后 hydrate 写回 env → 服务端再调一次本函数即热加载）。 */
export function configureFromEnv(env = process.env) {
  return configure({
    enabled: env.APP_DEVICE_RATE_ENABLED !== '0',
    max: Number(env.APP_DEVICE_RATE_MAX ?? DEFAULTS.max),
    windowSec: Number(env.APP_DEVICE_RATE_WINDOW_SEC ?? DEFAULTS.windowSec),
  });
}

export function currentConfig() {
  return { ...config };
}

function setWindowEntry(map, key, value) {
  map.delete(key);
  while (map.size >= MAX_TRACKED_DEVICES) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
  map.set(key, value);
}

/**
 * 记一次设备请求。返回 { limited, count, max, windowSec, retryAfterSec }。
 * 只有判定超限才给 retryAfterSec（下一次可再试的秒数，从窗口内最早一次命中推算）。
 */
export function hitDevice(deviceId) {
  if (!config.enabled || !deviceId) return { limited: false };
  const key = String(deviceId);
  const now = Date.now();
  const span = config.windowSec * 1000;
  const list = (windows.get(key) ?? []).filter((t) => now - t < span);
  list.push(now);
  // 只保留触发阈值所需的最近 max+1 个时间戳，并限制总量（与 ratelimit.js 同款防膨胀）。
  if (list.length > config.max + 1) list.splice(0, list.length - config.max - 1);
  if (list.length > MAX_TRACKED_HITS) list.splice(0, list.length - MAX_TRACKED_HITS);
  setWindowEntry(windows, key, list);

  if (list.length <= config.max) {
    return { limited: false, count: list.length, max: config.max, windowSec: config.windowSec };
  }
  const oldest = list[0];
  return {
    limited: true,
    count: list.length,
    max: config.max,
    windowSec: config.windowSec,
    retryAfterSec: Math.max(1, Math.ceil((oldest + span - now) / 1000)),
  };
}

/** 测试用：清空内存状态。 */
export function resetState() {
  windows.clear();
  config = { ...DEFAULTS };
}
