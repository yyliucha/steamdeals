// 自动封禁（CF 批，docs/ADMIN-UX-SECURITY.md §3）：strict 模式的硬规则引擎。
//
// 原则：能 429 就不封；要封只封证据明确的硬规则、默认临时、可申诉；模糊情况全部人工审核。
// 硬规则（默认阈值，settings 可热调）：
//   · 漏洞路径探测：窗口内命中 ≥pathDistinctMax 个**不同**签名路径 → 自动临时封
//   · 登录凭据爆破：同 IP 15 分钟失败 ≥credentialIpMax 次 → 自动临时封（20 次起仍只 429）
//   · 极端频率：任一桶超过阈值 extremeMultiplier 倍且连续 extremeWindows 个 60 秒窗口 → 自动临时封
//   · 异常 UA 名单：同 IP 10 分钟命中名单 ≥2 次 → 自动临时封
// 阶梯：同一天第 1/2/3 次自动封分别 banLadderMin[0]/[1]/[2]（10min/1h/1d 封顶），跨天重置；
// **永不自动写永久黑名单**；每次自动封禁同时写一条 abuse_reviews 供管理员复核。
// mode=off 时所有记录器只返回 null（只 429 + 人工审核）；mode=legacy 时本模块不参与（ratelimit 旧三振）。
//
// 内存窗口与 ratelimit.js 同款设计：只为触发判定，落库只在真封那一刻。
import { matchesIpEntry } from './visitors.js';
import { formatDay } from './format.js';

export const DEFAULT_UA_PATTERNS = [
  'sqlmap', 'nikto', 'masscan', 'zgrab', 'nuclei', 'wpscan', 'gobuster', 'dirbuster', 'metasploit', 'acunetix', 'nessus',
];

export const DEFAULTS = {
  mode: 'strict', // strict | off | legacy
  pathDistinctMax: 3,
  pathWindowSec: 600,
  credentialIpMax: 50,
  credentialWindowSec: 15 * 60,
  extremeMultiplier: 5,
  extremeWindows: 2,
  uaPatterns: [...DEFAULT_UA_PATTERNS],
  banLadderMin: [10, 60, 1440],
};

let config = { ...DEFAULTS, uaPatterns: [...DEFAULT_UA_PATTERNS], banLadderMin: [...DEFAULTS.banLadderMin] };

const pathSignatures = new Map(); // ip -> Map(rule -> { at, paths:Set })
const credentialFails = new Map(); // ip -> { at, count }
const uaHits = new Map(); // ip -> { at, count }
const rateOverWindows = new Map(); // ip|bucket -> { at, over }
const whitelist = new Set();

export function configure(next = {}) {
  const int = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
  };
  const list = (value, fallback) => {
    const parts = String(value ?? '').split(/[,，\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    return parts.length ? parts : fallback;
  };
  config = {
    mode: ['strict', 'off', 'legacy'].includes(next.mode) ? next.mode : config.mode,
    pathDistinctMax: int(next.pathDistinctMax, config.pathDistinctMax, 1, 1000),
    pathWindowSec: int(next.pathWindowSec, config.pathWindowSec, 10, 86400),
    credentialIpMax: int(next.credentialIpMax, config.credentialIpMax, 2, 100000),
    credentialWindowSec: int(next.credentialWindowSec, config.credentialWindowSec, 60, 86400),
    extremeMultiplier: int(next.extremeMultiplier, config.extremeMultiplier, 2, 1000),
    extremeWindows: int(next.extremeWindows, config.extremeWindows, 1, 100),
    uaPatterns: next.uaPatterns === undefined ? config.uaPatterns : list(next.uaPatterns, DEFAULT_UA_PATTERNS),
    banLadderMin: next.banLadderMin === undefined ? config.banLadderMin : list(next.banLadderMin, DEFAULTS.banLadderMin).map((v) => int(v, 10, 1, 1440)),
  };
  return { ...config };
}

/** 从环境变量重配（settings 保存后 hydrate 写回 env，服务端再调本函数热加载）。 */
export function configureFromEnv(env = process.env) {
  return configure({
    mode: env.SECURITY_AUTOBAN_MODE ?? DEFAULTS.mode,
    pathDistinctMax: env.SECURITY_AUTOBAN_PATH_MAX,
    pathWindowSec: env.SECURITY_AUTOBAN_PATH_WINDOW,
    credentialIpMax: env.SECURITY_AUTOBAN_CRED_MAX,
    extremeMultiplier: env.SECURITY_AUTOBAN_EXTREME_MULT,
    extremeWindows: env.SECURITY_AUTOBAN_EXTREME_WINDOWS,
    uaPatterns: env.SECURITY_AUTOBAN_UA_PATTERNS,
    banLadderMin: env.SECURITY_AUTOBAN_LADDER,
  });
}

export function currentConfig() {
  return { ...config, uaPatterns: [...config.uaPatterns], banLadderMin: [...config.banLadderMin] };
}

export function addWhitelist(ip) {
  if (ip) whitelist.add(String(ip));
}

export function isWhitelisted(ip) {
  if (!ip) return false;
  const value = String(ip);
  for (const entry of whitelist) if (matchesIpEntry(value, entry)) return true;
  return false;
}

const enabled = (ip, now) =>
  config.mode === 'strict' && ip && !isWhitelisted(ip) && Number.isFinite(now);

const boundedSet = (map, key, value, max = 5000) => {
  if (map.size >= max && !map.has(key)) map.delete(map.keys().next().value);
  map.set(key, value);
};

function dayKey(now) {
  return formatDay(new Date(now));
}

/**
 * 漏洞路径探测：窗口内不同签名路径数 ≥ pathDistinctMax → 触发。
 * 返回 { rule, paths, count } 或 null。
 */
export function recordPathSignature(ip, rule, path, now = Date.now()) {
  if (!enabled(ip, now)) return null;
  const key = String(ip);
  const span = config.pathWindowSec * 1000;
  let perIp = pathSignatures.get(key);
  if (!perIp || now - perIp.at > span) {
    perIp = { at: now, rules: new Map() };
    boundedSet(pathSignatures, key, perIp);
  }
  let rec = perIp.rules.get(rule);
  if (!rec || now - rec.at > span) {
    rec = { at: now, paths: new Set() };
    perIp.rules.set(rule, rec);
  }
  rec.paths.add(String(path).slice(0, 200));
  // 规则去重：同一条规则命中多个路径也只算 1 个"不同签名"——按"不同规则数"判定，
  // 更贴近规格「≥3 个不同签名路径」（不同签名 = 不同 rule 类别）。
  if (perIp.rules.size >= config.pathDistinctMax) {
    const paths = [...perIp.rules.values()].map((r) => [...r.paths][0]);
    pathSignatures.delete(key); // 触发即清，下一窗口重新计数
    return { rule: 'path-probe', count: perIp.rules.size, paths };
  }
  return null;
}

/** 登录凭据爆破：同 IP 窗口内失败 ≥ credentialIpMax → 触发。 */
export function recordCredentialFail(ip, now = Date.now()) {
  if (!enabled(ip, now)) return null;
  const key = String(ip);
  const span = config.credentialWindowSec * 1000;
  let rec = credentialFails.get(key);
  if (!rec || now - rec.at > span) {
    rec = { at: now, count: 0 };
    boundedSet(credentialFails, key, rec);
  }
  rec.count += 1;
  if (rec.count >= config.credentialIpMax) {
    credentialFails.delete(key);
    return { rule: 'credential', count: rec.count };
  }
  return null;
}

/** 异常 UA 名单：同 IP 10 分钟命中 ≥2 次 → 触发。 */
export function recordUaHit(ip, now = Date.now()) {
  if (!enabled(ip, now)) return null;
  const key = String(ip);
  const span = 10 * 60_000;
  let rec = uaHits.get(key);
  if (!rec || now - rec.at > span) {
    rec = { at: now, count: 0 };
    boundedSet(uaHits, key, rec);
  }
  rec.count += 1;
  if (rec.count >= 2) {
    uaHits.delete(key);
    return { rule: 'ua-list', count: rec.count };
  }
  return null;
}

/**
 * 极端频率：count ≥ bucketMax × extremeMultiplier 且连续 extremeWindows 个 60 秒窗口 → 触发。
 * 调用方（server）只在「本窗口超限」时调用，本函数负责连续窗口判定。
 */
export function recordRateOver(ip, bucket, count, now = Date.now()) {
  if (!enabled(ip, now)) return null;
  const key = `${String(ip)}|${bucket}`;
  const windowStart = Math.floor(now / 60_000) * 60_000;
  let rec = rateOverWindows.get(key);
  if (!rec || windowStart - rec.at > 60_000) {
    rec = { at: windowStart, over: 1 };
    boundedSet(rateOverWindows, key, rec);
  } else if (windowStart === rec.at) {
    // 同一窗口重复报告不叠加
    return null;
  } else {
    rec.at = windowStart;
    rec.over += 1;
  }
  if (rec.over >= config.extremeWindows) {
    rateOverWindows.delete(key);
    return { rule: 'extreme-rate', count, windows: rec.over, bucket };
  }
  return null;
}

export function isBadUa(userAgent) {
  const ua = String(userAgent ?? '').toLowerCase();
  if (!ua) return false;
  return config.uaPatterns.some((p) => ua.includes(p));
}

/**
 * 应用自动封禁（阶梯）：同一天第 N 次自动封 → banLadderMin[min(N-1, 末位)]；
 * 写 ip_abuse（ban_source=auto:<rule>）+ 一条 abuse_reviews（供复核）+ 内存封禁（ratelimit.applyExternalBan）。
 * 返回 { until, minutes, strikes } 或 null（mode=off）。
 * ratelimit 由调用方注入，避免模块环依赖。
 */
export async function applyAutoBan(q, ip, { rule, detail = null, path = null, ratelimit = null }, now = Date.now()) {
  if (config.mode !== 'strict' || !ip) return null;
  const key = String(ip);
  // 白名单豁免：直接跳过并记日志（调用方打 auto_ban.skipped）
  if (isWhitelisted(key)) return null;
  // 当天阶梯：读 ip_abuse 今天 strikes
  let strikes = 1;
  try {
    const row = (await q('select strikes, strike_day from ip_abuse where ip = $1', [key])).rows[0];
    if (row && row.strike_day === dayKey(now)) strikes = Math.min(Number(row.strikes ?? 0) + 1, 1000);
  } catch {
    /* 表缺失时按第 1 次处理 */
  }
  const minutes = config.banLadderMin[Math.min(strikes - 1, config.banLadderMin.length - 1)];
  const until = now + minutes * 60_000;
  const untilIso = new Date(until).toISOString();
  const source = `auto:${rule}`;
  try {
    await q(
      `insert into ip_abuse (ip, strikes, strike_day, banned_until, ban_source, updated_at)
       values ($1, $2, current_date, $3::timestamptz, $4, now())
       on conflict (ip) do update set
         strikes = excluded.strikes,
         strike_day = excluded.strike_day,
         banned_until = excluded.banned_until,
         ban_source = excluded.ban_source,
         updated_at = now()`,
      [key, strikes, untilIso, source],
    );
    await q(
      `insert into abuse_reviews (ip, rule, detail, path, hits, status, created_at, updated_at)
       values ($1, $2, $3, $4, 1, 'pending', now(), now())`,
      [key, source, detail ?? `自动封禁（${rule}）`, path, ],
    );
  } catch (err) {
    // 表不存在等：只记日志，绝不阻塞请求
    return { until, minutes, strikes, dbError: String(err?.message ?? err).slice(0, 120) };
  }
  ratelimit?.applyExternalBan?.(key, until, { source: 'auto' });
  return { until, minutes, strikes };
}

/** 测试用：清空内存状态。 */
export function resetState() {
  pathSignatures.clear();
  credentialFails.clear();
  uaHits.clear();
  rateOverWindows.clear();
  whitelist.clear();
  config = { ...DEFAULTS, uaPatterns: [...DEFAULT_UA_PATTERNS], banLadderMin: [...DEFAULTS.banLadderMin] };
}
