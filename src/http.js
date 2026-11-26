// 唯一出网点。所有外部请求都从这里走，因此这里也是"排障信息最全"的地方。
//
// 每个请求会产生三类记录：
//   http.request   发出前（url / attempt / 超时设置）
//   http.response  成功（status / bytes / elapsedMs / contentType）
//   http.retry     重试（原因 / 等待多久）
//   http.error     最终失败（错误码 / 主机名 / 响应片段）
// 只有 requestId 相同的记录属于同一次尝试，排障时按它串起来即可。
import { redactUrl } from './log.js';
import * as undici from 'undici';
import { decideProxy, redactProxy, steamProxyUrls } from './proxy.js';
import * as proxyPool from './proxy-pool.js';
// FW-2（docs/SLOW-SYNC.md §2.3）：全站速率闸门（文件令牌桶）——每次对 Steam 业务域的真实请求都扣，
// 代理重试也扣；切 IP 不增加总预算。
import { takeToken, rateGatePerMin, rateMaxWaitMs } from './rate-gate.js';

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 steamdeals/0.2 (personal use)';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 代理连接复用：同一代理地址只建一个 Agent
const agents = new Map();

/**
 * 拼 ProxyAgent 构造参数。
 * https 代理（stunnel/gost 自建 TLS 壳）通常用自签证书：TLS 这层的作用是让
 * 中间设备看不到 CONNECT 里的目标域名（大陆→香港链路的 DPI 会重置明文的
 * `CONNECT steamcommunity.com`），证书校验不是目的，故放行自签。
 * http 代理保持原样（undici 直接收 URI 字符串）。
 */
export function proxyAgentOptions(proxyUrl) {
  return proxyUrl.startsWith('https://')
    ? { uri: proxyUrl, proxyTls: { rejectUnauthorized: false } }
    : proxyUrl;
}

/** 给一个代理 URL 建/取复用的 Agent（route.url 保留未脱敏地址，供代理池记状态）。 */
function dispatcherForUrl(proxyUrl, via = 'steam-proxy') {
  if (!agents.has(proxyUrl)) {
    agents.set(proxyUrl, new undici.ProxyAgent(proxyAgentOptions(proxyUrl)));
  }
  return { dispatcher: agents.get(proxyUrl), via, proxy: redactProxy(proxyUrl), url: proxyUrl };
}

/** 按目标主机挑选出网通道；返回 null 表示直连。 */
function dispatcherFor(host) {
  const decision = decideProxy(host, process.env);
  if (!decision.url) return { dispatcher: null, via: 'direct', proxy: null };
  return dispatcherForUrl(decision.url, decision.via);
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

const rid = () => Math.random().toString(36).slice(2, 10);

// Steam 429 没有 Retry-After 时，保守冷却 30 分钟；不要用短间隔重试继续触发风控。
const STEAM_429_COOLDOWN_MS = 30 * 60 * 1000;
let steamCooldownUntil = 0;

/**
 * FP 批 P0（docs/SYNC-HARDENING.md §4.1）：429 冷却等待上限（毫秒）——env SYNC_429_MAX_WAIT_MS，默认 5 分钟。
 * 冷却剩余超过上限 → COOLDOWN_ABORT 中断本轮（调用方 exit 75 + interrupted，不占 heavy slot）；
 * 短冷却（≤ 上限）保持等待。纯函数便于测试。
 */
export function sync429MaxWaitMs(env = process.env) {
  const n = Number(env.SYNC_429_MAX_WAIT_MS ?? 5 * 60_000);
  return Number.isFinite(n) && n > 0 ? n : 5 * 60_000;
}

// AC-4/AC6（docs/SYNC-FAILURE-MODES.md AC6）：429 全局退避预算——冷却时间落盘跨子进程共享
// （每个任务都是独立子进程，内存态各睡各的 30 分钟；落盘后任何进程都会尊重最早的冷却）。
// 测试可用 STEAM_429_FILE 覆盖路径。
import { existsSync as _fsExists, readFileSync as _fsRead, writeFileSync as _fsWrite, renameSync as _fsRename, mkdirSync as _fsMkdir } from 'node:fs';
import { dirname as _fsDirname } from 'node:path';
export const steam429FilePath = () => process.env.STEAM_429_FILE ?? 'data/steam-429.json';
export function readSteam429Until(nowMs = Date.now()) {
  try {
    const parsed = JSON.parse(_fsRead(steam429FilePath(), 'utf8'));
    const t = Date.parse(parsed?.until);
    return Number.isFinite(t) && t > nowMs ? t : 0;
  } catch {
    return 0;
  }
}
export function writeSteam429Until(untilMs, { at = null, label = null } = {}) {
  try {
    const file = steam429FilePath();
    _fsMkdir(_fsDirname(file), { recursive: true });
    // BL 批（docs/BACKFILL-THROUGHPUT.md §3.2）：追加 at/label（读仍只认 until，向后兼容）
    _fsWrite(
      `${file}.tmp`,
      JSON.stringify({ until: new Date(untilMs).toISOString(), at: at ?? new Date().toISOString(), label }),
    );
    _fsRename(`${file}.tmp`, file);
  } catch {
    /* 退避文件写失败不影响内存冷却 */
  }
}

/** 读冷却文件完整信息 { until, at, label } | null（`until` 已过期时整体视为无冷却）。 */
export function readSteam429Info(nowMs = Date.now()) {
  try {
    const raw = _fsRead(steam429FilePath());
    if (!raw) return null;
    const data = JSON.parse(raw);
    const until = Date.parse(String(data?.until ?? ''));
    if (!Number.isFinite(until) || until <= nowMs) return null;
    return { until, at: data?.at ?? null, label: data?.label ?? null };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- FP 批 P0：403 单独退避（docs/SYNC-HARDENING.md §4.3）

const STEAM_403_BASE_MS = 60_000; // 首次 403 冷却 1 分钟
const STEAM_403_MAX_MS = 30 * 60_000; // 上限 30 分钟

/** FP P0：403 冷却落盘路径（测试可用 STEAM_403_FILE 覆盖）。 */
export const steam403FilePath = () => process.env.STEAM_403_FILE ?? 'data/steam-403.json';

/** FP P0：连续第 count 次 403 的退避时长——指数退避 1m→2m→4m…上限 30m。纯函数。 */
export function steam403BackoffMs(count) {
  const n = Math.max(1, Math.trunc(Number(count) || 1));
  return Math.min(STEAM_403_MAX_MS, STEAM_403_BASE_MS * 2 ** (n - 1));
}

/** FP P0：读 403 冷却 { until, count, at, label } | null（until 过期视为无冷却）。 */
export function readSteam403Info(nowMs = Date.now()) {
  try {
    const raw = _fsRead(steam403FilePath());
    if (!raw) return null;
    const data = JSON.parse(raw);
    const until = Date.parse(String(data?.until ?? ''));
    if (!Number.isFinite(until) || until <= nowMs) return null;
    return { until, count: Math.trunc(Number(data?.count) || 1), at: data?.at ?? null, label: data?.label ?? null };
  } catch {
    return null;
  }
}

/** FP P0：写 403 冷却（原子：tmp + rename；失败不影响内存行为）。 */
export function writeSteam403Until(untilMs, { count = 1, at = null, label = null } = {}) {
  try {
    const file = steam403FilePath();
    _fsMkdir(_fsDirname(file), { recursive: true });
    _fsWrite(
      `${file}.tmp`,
      JSON.stringify({ until: new Date(untilMs).toISOString(), count: Math.trunc(Number(count) || 1), at: at ?? new Date().toISOString(), label }),
    );
    _fsRename(`${file}.tmp`, file);
  } catch {
    /* 退避文件写失败不影响内存冷却 */
  }
}

/**
 * FP P0：读 403 连续次数（带衰减）——距上次 403 超过最大冷却（30 分钟）清零，
 * 否则累计（冷却到期恢复请求后再 403 时退避继续翻倍，而不是永远从头 1 分钟）。
 */
export function readSteam403Streak(nowMs = Date.now()) {
  try {
    const raw = _fsRead(steam403FilePath());
    if (!raw) return 0;
    const data = JSON.parse(raw);
    const count = Math.trunc(Number(data?.count) || 0);
    const at = Date.parse(String(data?.at ?? ''));
    if (!Number.isFinite(at)) return count;
    return nowMs - at > STEAM_403_MAX_MS ? 0 : count;
  } catch {
    return 0;
  }
}

function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
}

function isSteamHost(host) {
  return host === 'steampowered.com' || host.endsWith('.steampowered.com');
}

// 出网错误的"翻译表"：把 undici/Node 的英文错误码变成能照着做的中文提示。
const CODE_HINTS = {
  ENOTFOUND: 'DNS 解析失败（域名不存在或 DNS 不可用）',
  ECONNREFUSED: '连接被拒绝（端口没有服务）',
  ECONNRESET: '连接被对端重置（常见于风控或中间设备）',
  ETIMEDOUT: '连接超时（目标不可达或被阻断）',
  UND_ERR_CONNECT_TIMEOUT: '连接超时（目标不可达或被阻断）',
  UND_ERR_HEADERS_TIMEOUT: '等待响应头超时',
  UND_ERR_BODY_TIMEOUT: '读取响应体超时',
  UND_ERR_SOCKET: '连接被关闭',
  UND_ERR_ABORTED: '请求被中止（常见于代理拒绝隧道或连接被重置）',
  UND_ERR_PRX_TLS: '代理的 HTTPS 证书校验失败（自签证书？换 http:// 或导入证书）',
  CERT_HAS_EXPIRED: '证书过期',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: '证书校验失败（可能有中间人代理）',
  DEPTH_ZERO_SELF_SIGNED_CERT: '证书是自签名的（可能有中间人代理）',
  ERR_TLS_CERT_ALTNAME_INVALID: '证书域名不匹配（可能有中间人代理）',
};

/** undici 在代理拒绝建隧道时抛的英文原因，形如 "Proxy response (407) !== 200 when HTTP Tunneling" */
const PROXY_TUNNEL_RE = /Proxy response \((\d{3})\) !== 200/;

/** 代理 CONNECT 的状态码 → 人话。诊断命令也复用这张表。 */
export const PROXY_STATUS_HINTS = {
  400: '代理不接受 CONNECT（配的可能是反向代理，不是 HTTP 正向代理）',
  403: '代理拒绝放行该域名（检查代理规则/白名单）',
  405: '代理不允许 CONNECT（配的可能不是 HTTP 正向代理）',
  407: '代理要求认证（在代理地址里带上账号密码：用户名:密码@主机:端口）',
  421: '代理无法处理该目标',
  502: '代理连不上目标（代理侧故障，稍后重试）',
  503: '代理暂时不可用（稍后重试）',
  504: '代理连目标超时（稍后重试）',
};

export function proxyStatusHint(status) {
  return PROXY_STATUS_HINTS[status] ?? `代理拒绝建立隧道（HTTP ${status}）`;
}

/** 配了代理却连不上代理本身时，这几个错误码更可能是"代理没开/地址错"，而不是目标站点的问题。 */
const PROXY_UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);

// AM-1（docs/PROXY-POOL.md 决策 1）：只有网络层/代理层失败才换代理——连不上、超时、TLS 错误、
// 代理 CONNECT 4xx/5xx。目标返回 HTTP 5xx / 429 是"有响应"，不切换（429 按出口 IP 限流，切代理等于绕配额）。
const PROXY_SWITCH_CODES = new Set([
  'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'UND_ERR_SOCKET', 'EPIPE', 'ABORTED', 'UND_ERR_ABORTED',
  'UND_ERR_PRX_TLS', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function isProxyLayerFailure(info, aborted) {
  return aborted || info.proxyStatus != null || PROXY_SWITCH_CODES.has(info.code);
}

// ---------------------------------------------------------------- FW-2：403/429 切代理（docs/SLOW-SYNC.md §1.2 决策 7~12、§3.3）
// 修订 AM-1 决策 1（原「HTTP 5xx 与 429 都不切换」）：403 是出口 IP 被拒（不是配额，等多久都不会好），
// 429 也切代理但总量不增（全站闸门 30 次/分钟）。5xx 仍不切（Steam 自身故障，换 IP 打到同一组服务器）。

/** 403/429 开关（设置页水合到 env；默认开，'0' 关闭 = 回滚到 AM-1 行为）。 */
const envFlag = (value, fallback = true) => (value == null || value === '' ? fallback : String(value) !== '0');

export function rotateOn403(env = process.env) {
  return envFlag(env.SYNC_ROTATE_ON_403);
}

export function rotateOn429(env = process.env) {
  return envFlag(env.SYNC_ROTATE_ON_429);
}

/** 每请求 403/429 最多试几条代理（env SYNC_ROTATE_MAX_PER_REQUEST，1–10，默认 3）。 */
export function rotateMaxPerRequest(env = process.env) {
  const n = Number(env.SYNC_ROTATE_MAX_PER_REQUEST);
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(10, Math.trunc(n));
}

/**
 * FW-2：Steam 业务拒绝 = 目标站回 403/429，且**不是代理层问题**（err.proxyStatus == null）。
 * 代理 CONNECT 的 403/407 是代理配置/隧道问题，仍走 AM-1 的代理层失败逻辑（isProxyLayerFailure），
 * 两者不能混：一个该换代理，一个该修代理。
 */
export function isSteamReject(err) {
  if (!err || (err.status !== 403 && err.status !== 429)) return false;
  return err.proxyStatus == null;
}

// 全池 403（说明几条出口 IP 一起被封）的全局冷却起点：5 分钟起，随连续次数翻倍、30 分钟封顶。
export const STEAM_403_POOL_BASE_MS = 5 * 60_000;

/** FW-2：全池被拒后的全局 403 退避——5m→10m→20m→30m 封顶（单代理/直连仍用 steam403BackoffMs 1m 起）。 */
export function steam403PoolBackoffMs(count) {
  const n = Math.max(1, Math.trunc(Number(count) || 1));
  return Math.min(STEAM_403_MAX_MS, STEAM_403_POOL_BASE_MS * 2 ** (n - 1));
}

/** 把错误码翻译与出网通道合起来，得到最终给用户看的一句提示。 */
export function errorHint(info, route, { aborted = false, timeoutMs = 0 } = {}) {
  if (aborted) return `超时（${timeoutMs}ms 内无响应）`;
  if (route?.via && route.via !== 'direct' && PROXY_UNREACHABLE_CODES.has(info.code)) {
    return `连不上代理${route.proxy ? ` ${route.proxy}` : ''}（确认代理在运行、地址/端口正确）`;
  }
  return info.hint;
}

/** 顺着 err.cause 挖到最底层：undici 把真实原因埋了 2~3 层，只看最外层等于没打日志。 */
export function rootCause(err, depth = 0) {
  if (!err || typeof err !== 'object' || depth > 8) return null;
  const next = err.cause;
  if (!next || typeof next !== 'object' || next === err) return err;
  return rootCause(next, depth + 1) ?? err;
}

/**
 * 把 fetch/undici 的错误翻译成 { code, hint, cause, proxyStatus, retryable }。
 *
 * 实测 undici 8.x 的代理隧道失败长这样（最外层完全看不出原因）：
 *   TypeError: fetch failed
 *     cause: DOMException { message: 'Request was cancelled.', code: 0 }   ← 数字 0，不是错误码
 *       cause: AbortError { message: 'Proxy response (407) !== 200 when HTTP Tunneling' }
 * 所以必须挖到底层，否则同步记录里只有 "fetch failed" + code=0。
 */
export function explainError(err) {
  for (let cur = err, guard = 0; cur && typeof cur === 'object' && guard < 8; cur = cur.cause, guard += 1) {
    const m = PROXY_TUNNEL_RE.exec(String(cur.message ?? ''));
    if (!m) continue;
    const proxyStatus = Number(m[1]);
    return {
      code: `PROXY_${proxyStatus}`,
      hint: proxyStatusHint(proxyStatus),
      cause: `代理 CONNECT 返回 ${proxyStatus}`,
      proxyStatus,
      retryable: proxyStatus >= 500,
    };
  }

  const codes = [];
  for (let cur = err, guard = 0; cur && typeof cur === 'object' && guard < 8; cur = cur.cause, guard += 1) {
    for (const value of [cur.code, cur.errno]) {
      if (value == null || value === 0 || value === '') continue;
      const text = String(value);
      if (!codes.includes(text)) codes.push(text);
    }
  }
  // 已知错误码优先；DOMException 的 code=0（"未知"）上面已经排除
  const code = codes.find((c) => CODE_HINTS[c]) ?? codes[0] ?? '';
  const deep = rootCause(err);
  const deepMessage = String(deep?.message ?? '').slice(0, 200);
  // HTTP 4xx/5xx 的 message 已经是"HTTP 500"，再塞进 cause 只是重复
  const cause = !err?.status && !/^(fetch failed|Request was cancelled\.?)$/i.test(deepMessage) ? deepMessage : '';
  return { code, hint: CODE_HINTS[code] ?? '', cause, proxyStatus: null, retryable: null };
}

/**
 * 发请求拿文本。返回 {body,status,bytes,elapsedMs,contentType,finalUrl}。
 * opts: {logger, label, headers, timeoutMs, retries, fetchImpl, method, body}
 */
export async function fetchText(url, opts = {}) {
  const {
    logger = null,
    label = 'http',
    headers = {},
    timeoutMs = 20000,
    retries = 2,
    fetchImpl = null,
    method = 'GET',
    body,
    forceDirect = false,
  } = opts;

  // 传入 fetchImpl 时（测试/特殊场景）不干预出网通道；
  // forceDirect 强制直连（诊断/兜底用）；否则按主机决定是否走代理。
  const host = hostOf(url);
  const steamHost = isSteamHost(host);
  // AM-1：Steam 代理池（docs/PROXY-POOL.md §4.3）——只有走 Steam 专用代理的请求才启用；
  // 老单行配置 = 1 条代理，保持旧行为（验收 1「照常工作」，含 407 只请求一次等语义），≥2 条才启用池。
  const configuredPool = !fetchImpl && !forceDirect && decideProxy(host, process.env).via === 'steam-proxy'
    ? steamProxyUrls(process.env)
    : [];
  const poolUrls = configuredPool.length >= 2 ? configuredPool : [];
  const maxAttempts = poolUrls.length ? Math.min(10, Math.max(retries + 1, poolUrls.length)) : 0;
  const triedProxies = [];
  let poolCandidates = [];
  let route = null;
  const doFetch = fetchImpl ?? undici.fetch;
  const retryConfig = process.env.STEAM_429_RETRIES ?? '1';
  const configuredSteam429Retries = Number(retryConfig);
  const steam429RetriesMax = retryConfig === 'Infinity'
    ? Infinity
    : Number.isFinite(configuredSteam429Retries)
      ? Math.max(0, configuredSteam429Retries)
      : 1;

  let lastError;
  let lastFailureInfo = null;
  let attempt = 0;
  let retriesUsed = 0;
  let steam429Retries = 0;
  let shouldAdvance = true; // 是否要为下一次尝试重新选代理（代理层失败 / 403/429 切换才置 true）
  let pendingSwitchReason = null; // 下一次 http.proxy_switch 的 reason（proxy 错误码 / steam403 / steam429）
  let steamRejected = false; // FW-2：403/429 已无法再换代理 → 已写全局冷却，最终抛原错误（不包装 PROXY_ALL_FAILED）

  // FW-2（docs/SLOW-SYNC.md §1.2 决策 7~12）：403/429 切代理开关 + 每请求上限 + 全站闸门参数。
  const rotate403 = rotateOn403(process.env);
  const rotate429 = rotateOn429(process.env);
  const rotateMax = rotateMaxPerRequest(process.env);
  // 决策 8：闸门只对 Steam 业务域的真实请求生效；fetchImpl 是注入的替身（没有真实请求）不扣 token。
  const gateEnabled = steamHost && !fetchImpl;
  const gatePerMin = rateGatePerMin(process.env);
  const gateMaxWaitMs = rateMaxWaitMs(process.env);

  /** AM-1：全部候选失败 → 报错并记日志，绝不回退直连（docs/PROXY-POOL.md 决策 3）。 */
  const throwAllFailed = () => {
    const reasons = poolUrls.map((u) => {
      const rec = proxyPool.healthRecord(u, { logger });
      return `${redactProxy(u)}（${rec?.lastError ?? '未知错误'}）`;
    });
    logger?.error('http.proxy_all_failed', {
      count: poolUrls.length,
      lastError: String(lastFailureInfo?.code ?? lastError?.code ?? lastError?.message ?? 'unknown').slice(0, 120),
    });
    const allFailed = new Error(`所有代理均失败（${poolUrls.length} 条）：${reasons.join('；')}`);
    allFailed.code = 'PROXY_ALL_FAILED';
    allFailed.status = lastError?.status;
    allFailed.cause = lastError?.cause;
    throw allFailed;
  };

  /**
   * 429 全局冷却（内存 + 落盘）：剩余超 SYNC_429_MAX_WAIT_MS → COOLDOWN_ABORT（exit 75 + interrupted），
   * 短冷却（≤ 上限）等待后继续。仅在无池（单代理/直连/注入 fetchImpl）或全池都不可用时检查。
   */
  const waitSteam429Cooldown = async () => {
    const effective429 = Math.max(steamCooldownUntil, readSteam429Until());
    if (!steamHost || effective429 <= Date.now()) return;
    const delayMs = effective429 - Date.now();
    // FP 批 P0（docs/SYNC-HARDENING.md §4.1）：冷却剩余超上限 → 中断本轮，不空转占槽。
    const maxWait = sync429MaxWaitMs(process.env);
    if (delayMs > maxWait) {
      logger?.warn('sync.cooldown_abort', {
        label,
        delayMs,
        maxWaitMs: maxWait,
        ...(route?.proxy ? { proxy: route.proxy } : {}),
        message: 'Steam 429 冷却剩余超过 SYNC_429_MAX_WAIT_MS，本轮中断（exit 75 + interrupted，不占槽）',
      });
      const err = new Error(
        `Steam 429 冷却剩余约 ${Math.round(delayMs / 60000)} 分钟，超过上限 ${Math.round(maxWait / 60000)} 分钟，本轮中断（SYNC_429_MAX_WAIT_MS 可调）`,
      );
      err.status = 429;
      err.code = 'COOLDOWN_ABORT';
      throw err;
    }
    logger?.warn('http.rate_limit_wait', {
      label,
      delayMs,
      ...(route?.proxy ? { proxy: route.proxy } : {}),
      message: 'Steam 处于 429 冷却期，等待后再请求',
    });
    await sleep(delayMs);
  };

  /** 403 全局冷却：冷却期内不请求 Steam，直接抛 FORBIDDEN_COOLDOWN（status 403，调用方按 403 收轮）。 */
  const throwIfSteam403Cooldown = () => {
    const info = steamHost ? readSteam403Info() : null;
    if (!info) return;
    const err = new Error(
      `Steam 处于 403 冷却期（连续 ${info.count} 次被拒），约 ${Math.max(1, Math.round((info.until - Date.now()) / 60000))} 分钟后可重试`,
    );
    err.status = 403;
    err.code = 'FORBIDDEN_COOLDOWN';
    logger?.warn('sync.forbidden_cooldown', {
      label,
      count: info.count,
      until: new Date(info.until).toISOString(),
      ...(route?.proxy ? { proxy: route.proxy } : {}),
      message: '403 冷却期内不再请求（退避 + 降速）',
    });
    throw err;
  };

  /**
   * 为本次尝试选一条池内代理。
   * FW-2（docs/SLOW-SYNC.md §3.3）：冷却改成**按代理**——downUntil 未过期的候选直接跳过、不再请求；
   * **只有全池都不可用（或可用候选都试过）时才读全局** `data/steam-403.json` / `data/steam-429.json`，
   * 否则会变成「一条代理被拒 → 所有代理一起停」。
   * 全池冷却且全局也无冷却时，仍按 AM-1 兜底试最早解冻的一条（避免长任务被卡死）。
   * 返回 null 表示池内候选全部试过（调用方按 AM-1 报 PROXY_ALL_FAILED）。
   */
  const poolRouteForAttempt = async () => {
    poolCandidates = proxyPool.candidatesFor(host, process.env, { logger });
    const available = poolCandidates.filter((u) => !proxyPool.cooldownUntil(u, { logger }));
    let next = proxyPool.nextCandidate(available, triedProxies);
    let coolingOverride = null;
    if (!next) {
      // 全池都在冷却 / 可用候选都试过 → 这时才看全局冷却（403 冷却期直接失败、429 冷却期按上限等待或中断）
      await waitSteam429Cooldown();
      throwIfSteam403Cooldown();
      next = poolCandidates.find((u) => !triedProxies.includes(u)) ?? null;
      if (!next) return null;
      coolingOverride = proxyPool.cooldownUntil(next, { logger });
    }
    const nextRoute = dispatcherForUrl(next, 'steam-proxy');
    if (route?.proxy && route.proxy !== nextRoute.proxy) {
      logger?.info('http.proxy_switch', {
        from: route.proxy,
        to: nextRoute.proxy,
        reason: String(pendingSwitchReason ?? lastFailureInfo?.code ?? lastError?.code ?? lastError?.message ?? 'cooldown').slice(0, 60),
      });
    }
    if (coolingOverride) {
      logger?.warn('http.proxy_cooldown_override', { proxy: nextRoute.proxy, downUntil: coolingOverride });
    }
    triedProxies.push(next);
    return nextRoute;
  };

  while (true) {
    attempt += 1;
    if (fetchImpl) {
      // 注入替身：行为与旧版一致（仍先看全局冷却，测试靠它锁 429/403 冷却语义）
      await waitSteam429Cooldown();
      throwIfSteam403Cooldown();
      route = { dispatcher: null, via: 'custom', proxy: null };
    } else if (poolUrls.length) {
      if (shouldAdvance) {
        route = await poolRouteForAttempt();
        if (!route) throwAllFailed(); // AM-1：候选全部试过 → PROXY_ALL_FAILED，不回退直连
      }
      // 非代理层失败的重试：复用同一条代理，不切换（AM-1 原语义）
    } else {
      // 单代理 / 直连：保持原有全局冷却语义（每次尝试前检查）
      await waitSteam429Cooldown();
      throwIfSteam403Cooldown();
      route = forceDirect ? { dispatcher: null, via: 'direct', proxy: null } : dispatcherFor(host);
    }
    shouldAdvance = false;
    const requestId = rid();
    // FW-2 决策 8（docs/SLOW-SYNC.md §2.3）：每个真实请求（含代理重试）都过全站闸门；
    // 不足则 sleep 到够 1 个 token（单次最多 2 秒、累计超上限抛 COOLDOWN_ABORT）。
    if (gateEnabled) {
      await takeToken({ perMin: gatePerMin, maxWaitMs: gateMaxWaitMs, logger, label });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    logger?.debug('http.request', {
      label,
      requestId,
      attempt,
      method,
      url: redactUrl(url),
      timeoutMs,
      via: route.via,
      ...(route.proxy ? { proxy: route.proxy } : {}),
    });

    try {
      const res = await doFetch(url, {
        method,
        body,
        signal: controller.signal,
        redirect: 'follow',
        ...(route.dispatcher ? { dispatcher: route.dispatcher } : {}),
        headers: {
          accept: 'application/json, text/html;q=0.9, */*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'user-agent': USER_AGENT,
          ...headers,
        },
      });
      const text = await res.text();
      const elapsedMs = Date.now() - startedAt;

      logger?.info('http.response', {
        label,
        requestId,
        attempt,
        status: res.status,
        bytes: text.length,
        elapsedMs,
        contentType: res.headers.get('content-type'),
        finalUrl: redactUrl(res.url || url),
        via: route.via,
      });

      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.body = text.slice(0, 500);
        err.retryAfter = res.headers.get('retry-after');
        throw err;
      }
      // AM-1：成功 → 失败计数清零、记 lastGood（下个请求粘住这条）
      if (poolUrls.length && route?.url) {
        proxyPool.noteProxySuccess(route.url, { logger });
        logger?.debug('http.proxy_ok', { proxy: route.proxy });
      }
      return { body: text, status: res.status, bytes: text.length, elapsedMs, contentType: res.headers.get('content-type'), finalUrl: res.url };
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      lastError = err;
      const info = explainError(err);
      const aborted = err.name === 'AbortError';
      const code = aborted ? 'ABORTED' : info.code;
      lastFailureInfo = { code, message: String(err.message ?? '').slice(0, 120) };
      const hint = errorHint(info, route, { aborted, timeoutMs });
      // 代理拒绝隧道（403/407）是配置问题，重试 3 次只会拖慢并刷屏；5xx 才值得再试
      const retryable = aborted
        ? true
        : info.proxyStatus != null
          ? info.retryable
          : !err.status || err.status === 429 || err.status >= 500;

      logger?.warn('http.error', {
        label,
        requestId,
        attempt,
        elapsedMs,
        status: err.status ?? null,
        code,
        hint,
        message: String(err.message).slice(0, 200),
        // undici 把真正的网络原因埋在 cause 链最底层（如 "Proxy response (407) !== 200 when HTTP Tunneling"、
        // ECONNREFUSED、证书错误）。只打 "fetch failed" 等于没打，排障时必须有这一行。
        ...(info.cause ? { cause: info.cause } : {}),
        ...(info.proxyStatus != null ? { proxyStatus: info.proxyStatus } : {}),
        bodySnippet: err.body ? err.body.slice(0, 300) : undefined,
        via: route.via,
        retryable,
      });

      // FW-2（docs/SLOW-SYNC.md §1.2 决策 7~12、§3.3）：Steam 目标站 403/429 = 出口 IP 被拒/限流。
      // 池 ≥2 且开关开且未超「每请求最多 N 条」→ 按代理记冷却后换下一条（同一逻辑请求继续）；
      // 否则（池用尽 / 开关关 / 已达上限 / 单代理直连）→ 写全局冷却并抛**原错误**（status 保持
      // 403/429，不包装 PROXY_ALL_FAILED——FW-3 的软退出判定依赖原错误码）。
      // 代理 CONNECT 的 403/407 不在这里（proxyStatus != null），仍走下面的 AM-1 代理层失败逻辑。
      const steamReject = steamHost && isSteamReject(err);
      if (steamReject) {
        const status = err.status;
        const kind = status === 403 ? 'steam403' : 'steam429';
        const switchOn = status === 403 ? rotate403 : rotate429;
        const untried = poolUrls.filter((u) => !triedProxies.includes(u));
        const canRotate = Boolean(route?.url) && poolUrls.length >= 2 && switchOn
          && triedProxies.length < rotateMax && untried.length > 0 && attempt < maxAttempts;
        const poolRotation = poolUrls.length >= 2 && switchOn;
        if (poolRotation && route?.url) {
          // 按代理记冷却（决策 10）：能继续切就换下一条；不能切（池用尽/已达上限）也要把当前这条标记掉——
          // 「全池都被标记」才写全局冷却（验收 6），否则下轮全局冷却到期后会立刻再撞同一条。
          // 429 的 Retry-After 只记到该代理（不当全局冷却）；冷却时长取 max(阶梯, retryAfter)。
          const minCooldownMs = status === 429 ? retryAfterMs(err.retryAfter) : 0;
          const rec = proxyPool.noteProxyFailure(
            route.url,
            { code: kind, message: `HTTP ${status}` },
            { logger, kind, minCooldownMs },
          );
          logger?.warn('http.proxy_down', { proxy: route.proxy, fails: rec.fails, downUntil: rec.downUntil, kind });
          if (canRotate) {
            pendingSwitchReason = kind;
            shouldAdvance = true; // 下一条代理（同一逻辑请求，不 break）
            continue;
          }
        }
        if (status === 403) {
          // FP 批口径保留：连续次数按带衰减的 streak 累计；FW-2 全池被拒从 5 分钟起
          //（AM-1 单代理/直连仍 1 分钟起，回滚开关关掉时行为不变）。
          const count = Math.min(readSteam403Streak() + 1, 20);
          const backoffMs = poolRotation ? steam403PoolBackoffMs(count) : steam403BackoffMs(count);
          writeSteam403Until(Date.now() + backoffMs, { count, at: new Date().toISOString(), label });
          logger?.warn('http.forbidden_backoff', {
            label,
            requestId,
            status: 403,
            count,
            backoffMs,
            ...(route?.proxy ? { proxy: route.proxy } : {}),
            message: 'Steam 403（风控/代理被拒）：已记录退避冷却，冷却期内不再请求',
          });
        } else {
          // BL 批（docs/BACKFILL-THROUGHPUT.md §3.2）：首次 429 即落盘全局冷却（含 at/label）。
          const nextRetry = steam429Retries + 1;
          const backoffMs = Math.min(6 * 60 * 60 * 1000, STEAM_429_COOLDOWN_MS * (2 ** (nextRetry - 1)));
          const delayMs = Math.max(backoffMs, retryAfterMs(err.retryAfter));
          writeSteam429Until(Math.max(steamCooldownUntil, Date.now() + delayMs), { at: new Date().toISOString(), label });
          logger?.warn('http.rate_limit_pause', {
            label,
            requestId,
            status: 429,
            retry: nextRetry,
            delayMs,
            retryAfter: err.retryAfter ?? null,
            ...(route?.proxy ? { proxy: route.proxy } : {}),
            message: 'Steam 429：已记录全局冷却（at/label）',
          });
          // 开关关（回滚 AM-1）时保留既有「按 STEAM_429_RETRIES 等待后同代理重试」语义；
          // 全池已用尽/已达上限（FW 语义）则直接抛原错误，不再睡 30 分钟。
          if (!poolRotation && steam429Retries < steam429RetriesMax) {
            steam429Retries = nextRetry;
            steamCooldownUntil = Math.max(steamCooldownUntil, Date.now() + delayMs);
            await sleep(delayMs);
            continue; // shouldAdvance=false：复用同一条代理
          }
        }
        if (poolRotation) {
          logger?.error('http.proxy_all_rejected', {
            status,
            proxies: triedProxies.map((u) => redactProxy(u)),
            count: triedProxies.length,
            message: '池内可用代理都被 Steam 403/429 拒绝（或已达每请求上限），已写全局冷却',
          });
        }
        steamRejected = true; // 最终抛原错误（status 保持 403/429）
        break;
      }

      // AM-1：代理层失败 → 记冷却并换下一条（docs/PROXY-POOL.md 决策 1/2）；
      // HTTP 5xx 是"有响应"，走下面的原重试逻辑，不切换代理（FW-2 决策 11 保持不变）。
      if (poolUrls.length && route?.url && isProxyLayerFailure(info, aborted)) {
        const rec = proxyPool.noteProxyFailure(
          route.url,
          { code, message: String(lastError?.message ?? '').slice(0, 120) },
          { logger, kind: 'proxy' },
        );
        logger?.warn('http.proxy_down', { proxy: route.proxy, fails: rec.fails, downUntil: rec.downUntil, kind: 'proxy' });
        pendingSwitchReason = String(code || 'proxy').slice(0, 60);
        shouldAdvance = true; // 下一条代理
        if (attempt < maxAttempts) continue;
      }

      if (!retryable || retriesUsed >= retries) break;
      // 403 不应重试；其他短暂错误按普通退避处理。
      if (err.status === 403) break;
      retriesUsed += 1;
      const delayMs = err.status === 429 ? 20_000 : 500 * retriesUsed;
      logger?.info('http.retry', { label, requestId, attempt, delayMs, status: err.status ?? null });
      await sleep(delayMs);
    } finally {
      clearTimeout(timer);
    }
  }

  // FW-2：全池 403/429 时已写全局冷却并直接抛原错误（steamRejected 分支），不包装成 PROXY_ALL_FAILED；
  // 其它情况（代理层失败把候选试完）仍按 AM-1 报 PROXY_ALL_FAILED，不回退直连。
  if (!steamRejected && poolUrls.length && poolCandidates.length && triedProxies.length >= poolCandidates.length) {
    throwAllFailed();
  }

  const info = explainError(lastError);
  const code = info.code;
  const hint = errorHint(info, route, { aborted: lastError?.name === 'AbortError' });
  let errHost = url;
  try {
    errHost = new URL(url).host;
  } catch {
    /* 保留原串 */
  }
  const finalErr = new Error(
    `${lastError?.message ?? 'request failed'}${code ? ` (${code})` : ''} → ${errHost}${hint ? ` · ${hint}` : ''}` +
      `${route.via !== 'direct' ? ` · 经 ${route.via}${route.proxy ? `(${route.proxy})` : ''}` : ''}`,
  );
  finalErr.status = lastError?.status;
  finalErr.body = lastError?.body;
  finalErr.code = code;
  finalErr.via = route.via;
  finalErr.cause = lastError?.cause;
  finalErr.proxyStatus = info.proxyStatus ?? undefined;
  finalErr.detail = info.cause || undefined;
  logger?.error('http.fail', {
    label,
    url: redactUrl(url),
    code,
    hint,
    status: lastError?.status ?? null,
    ...(info.cause ? { cause: info.cause } : {}),
    ...(info.proxyStatus != null ? { proxyStatus: info.proxyStatus } : {}),
    via: route.via,
  });
  throw finalErr;
}

/**
 * 发请求拿 JSON。解析失败时把响应片段打进日志——远端返回了 HTML 错误页
 * 是最常见的一类问题，光看 "Unexpected token <" 根本没法修。
 */
export async function fetchJson(url, opts = {}) {
  const res = await fetchText(url, opts);
  const { logger = null, label = 'http' } = opts;
  try {
    return { ...res, json: JSON.parse(res.body) };
  } catch (err) {
    logger?.error('http.parse_error', {
      label,
      status: res.status,
      bytes: res.bytes,
      contentType: res.contentType,
      bodySnippet: res.body.slice(0, 500),
      message: err.message,
    });
    const e = new Error(`响应不是合法 JSON：${err.message}`);
    e.status = res.status;
    e.body = res.body.slice(0, 500);
    throw e;
  }
}

/** 拉取原始字节（图片等二进制），走同一套代理与重试逻辑。 */
export async function fetchBuffer(url, opts = {}) {
  const { logger = null, label = 'img', timeoutMs = 15000, retries = 1, headers = {}, forceDirect = false } = opts;
  const route = forceDirect ? { dispatcher: null, via: 'direct', proxy: null } : dispatcherFor(hostOf(url));
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await undici.fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        ...(route.dispatcher ? { dispatcher: route.dispatcher } : {}),
        headers: { 'user-agent': USER_AGENT, ...headers },
      });
      if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
      const buf = Buffer.from(await res.arrayBuffer());
      return { body: buf, bytes: buf.length, status: res.status, contentType: res.headers.get('content-type') ?? 'image/jpeg' };
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('fetchBuffer failed');
}
