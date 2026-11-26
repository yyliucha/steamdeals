// 全站速率闸门（docs/SLOW-SYNC.md §1.2 决策 8、§2.3，FW-2 批）：
// Steam 硬上限 200 次/5 分钟 = 40/分钟，这里留 25% 余量固定 30 次/分钟；**切代理不增加总预算**。
//
// 为什么是文件而不是 DB 表：src/http.js 是纯网络层、不持有 DB 连接（server 进程、scheduler 子进程、
// 各 CLI 命令共用同一个出口），在 HTTP 出口做闸门只能走文件——与 data/steam-403.json /
// data/steam-429.json / data/proxy-health.json 同款先例。
//
// 文件内容：data/steam-rate.json → {"tokens":<0..perMin>,"at":"ISO"}
//   - 容量 = perMin（默认 30）；补充率 = perMin/分钟（默认每 2 秒 1 个 token）；
//   - 取用：读 → 按 at 补充（上限 perMin）→ 有则扣 1 写回（tmp + rename 原子）→
//     不足则 sleep 到够 1 个（单次最多等 2 秒、循环累积）→ 累计等待超 maxWaitMs 抛 COOLDOWN_ABORT；
//   - 文件缺失 / 坏 JSON → 按满桶处理并记 sync.rate_gate_reset（debug），不因坏文件停摆；
//   - 跨进程：最后写入者胜（AM-1 健康文件同款）——最坏少扣 1~2 个 token，偶发多打几次；
//     闸门 30 对硬上限 40 留 25% 余量，可接受。
//
// tokens 允许小数：按毫秒精确补充（整数会让「等 2 秒才 +1」的粒度误差累积到分钟级）。
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** 默认容量/补充率（次/分钟）——Steam 硬上限 40/分钟留 25% 余量。 */
export const DEFAULT_PER_MIN = 30;
/** 默认累计等待上限 5 分钟（超过 → COOLDOWN_ABORT，沿用既有 exit 75 + 1 小时重排）。 */
export const DEFAULT_MAX_WAIT_MS = 300_000;
/** 单次最多睡 2 秒（循环累积到 maxWaitMs）。 */
export const MAX_SLEEP_STEP_MS = 2_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 闸门状态文件路径（可用 STEAM_RATE_FILE 覆盖，测试用；生产固定 data/steam-rate.json）。 */
export function rateFilePath(env = process.env) {
  return env.STEAM_RATE_FILE ?? 'data/steam-rate.json';
}

/** 容量/补充率：env SYNC_RATE_GATE_PER_MIN（1–40，默认 30；非法值回落默认而不是 0，避免死锁）。 */
export function rateGatePerMin(env = process.env) {
  const raw = Number(env?.SYNC_RATE_GATE_PER_MIN);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_PER_MIN;
  return Math.min(40, Math.trunc(raw));
}

/** 累计等待上限：env SYNC_RATE_MAX_WAIT_MS（0–3600000，默认 5 分钟；0 = 一分不等，直接中断）。 */
export function rateMaxWaitMs(env = process.env) {
  const raw = Number(env?.SYNC_RATE_MAX_WAIT_MS);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_MAX_WAIT_MS;
  return Math.min(3_600_000, Math.trunc(raw));
}

// ---------------------------------------------------------------- 纯函数（可单测）

/**
 * 按 at 补充 token（纯函数）：tokens + 经过分钟数 × perMin，封顶 perMin、下限 0。
 * state 坏（tokens 非数字）→ 满桶；at 缺失/非法 → 不补充（保持原值并夹取范围）。
 */
export function refillTokens(state, nowMs, perMin = DEFAULT_PER_MIN) {
  const cap = Math.max(1, Math.trunc(Number(perMin) || DEFAULT_PER_MIN));
  const tokens = Number(state?.tokens);
  if (!Number.isFinite(tokens)) return cap; // 坏 state → 满桶（不错杀成 0 让全站停摆）
  const clamped = Math.min(cap, Math.max(0, tokens));
  const at = Date.parse(String(state?.at ?? ''));
  if (!Number.isFinite(at)) return clamped;
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  if (now <= at) return clamped; // 时钟回拨/别的进程写得更晚：不补充
  return Math.min(cap, clamped + ((now - at) / 60_000) * cap);
}

/**
 * 取 1 个 token 的决策（纯函数）：
 *   - 够 1 个 → { tokens: 扣掉后的余量, waitMs: 0, available: 补充后余量 }
 *   - 不够   → { tokens: 补充后余量, waitMs: 需要等的毫秒数, available: 补充后余量 }
 * waitMs 用 ceil，保证醒来时至少够 1 个（向上取整不会少等）。
 */
export function takeDecision(state, nowMs, perMin = DEFAULT_PER_MIN) {
  const cap = Math.max(1, Math.trunc(Number(perMin) || DEFAULT_PER_MIN));
  const available = refillTokens(state, nowMs, cap);
  if (available >= 1) return { tokens: available - 1, waitMs: 0, available };
  return { tokens: available, waitMs: Math.ceil(((1 - available) * 60_000) / cap), available };
}

/** 写状态（tmp + rename 原子落盘；失败只记日志，不影响请求）。 */
function writeState(file, state, logger = null) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(state));
    renameSync(`${file}.tmp`, file);
    return true;
  } catch (err) {
    logger?.warn('sync.rate_gate_write_failed', { file, message: String(err?.message ?? err).slice(0, 160) });
    return false;
  }
}

/** 读状态；文件缺失 / 坏 JSON → null（调用方按满桶处理并记 reset）。 */
function readState(file, logger = null) {
  let raw;
  try {
    if (!existsSync(file)) {
      logger?.debug('sync.rate_gate_reset', { file, reason: 'missing', message: '闸门文件不存在，按满桶处理' });
      return null;
    }
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    logger?.debug('sync.rate_gate_reset', { file, reason: 'unreadable', message: String(err?.message ?? err).slice(0, 120) });
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Number.isFinite(Number(parsed.tokens))) {
      logger?.debug('sync.rate_gate_reset', { file, reason: 'corrupt', message: '闸门文件内容非法，按满桶处理' });
      return null;
    }
    return { tokens: Number(parsed.tokens), at: parsed.at ?? null };
  } catch (err) {
    logger?.debug('sync.rate_gate_reset', { file, reason: 'corrupt', message: String(err?.message ?? err).slice(0, 120) });
    return null;
  }
}

// ---------------------------------------------------------------- 取 token

/**
 * 取一个 Steam 请求 token（每个真实请求一次，代理重试也扣）。
 *
 * 选项：
 *   perMin     容量/补充率（次/分钟，默认 30）
 *   maxWaitMs  累计等待上限（默认 5 分钟）→ 超限抛 err.code='COOLDOWN_ABORT'
 *   file       状态文件（默认 data/steam-rate.json，可用 STEAM_RATE_FILE 覆盖）
 *   logger     结构化日志（sync.rate_gate_wait / sync.rate_gate_abort / sync.rate_gate_reset）
 *   label      任务标签（只进日志）
 *   now/sleepFn  测试注入的时钟与睡眠实现（生产不传）
 *
 * 返回 { tokens, waitedMs, perMin }（waitedMs = 本次累计等待）。
 */
export async function takeToken(opts = {}) {
  const {
    perMin = rateGatePerMin(),
    maxWaitMs = rateMaxWaitMs(),
    file = rateFilePath(),
    logger = null,
    label = null,
    now = () => Date.now(),
    sleepFn = sleep,
  } = opts;
  const cap = Math.max(1, Math.trunc(Number(perMin) || DEFAULT_PER_MIN));
  const limit = Math.max(0, Math.trunc(Number(maxWaitMs) || 0));
  let waitedMs = 0;
  for (;;) {
    const nowMs = Number(now());
    const state = readState(file, logger);
    const decision = takeDecision(state, nowMs, cap);
    if (decision.waitMs <= 0) {
      writeState(file, { tokens: decision.tokens, at: new Date(nowMs).toISOString() }, logger);
      return { tokens: decision.tokens, waitedMs, perMin: cap };
    }
    // 单次最多等 2 秒（循环累积）——长时间占槽的任务也要能被 COOLDOWN_ABORT 及时打断。
    const step = Math.min(decision.waitMs, MAX_SLEEP_STEP_MS);
    if (waitedMs + step > limit) {
      logger?.warn('sync.rate_gate_abort', {
        waitMs: waitedMs + step,
        maxWaitMs: limit,
        perMin: cap,
        ...(label ? { label } : {}),
        message: '全站速率闸门等待超过上限，本轮中断（COOLDOWN_ABORT → exit 75 + interrupted）',
      });
      const err = new Error(
        `Steam 全站速率闸门（${cap} 次/分钟）等待已超上限 ${limit}ms，本轮中断（SYNC_RATE_MAX_WAIT_MS 可调）`,
      );
      err.code = 'COOLDOWN_ABORT';
      err.waitMs = waitedMs + step;
      throw err;
    }
    logger?.debug('sync.rate_gate_wait', {
      waitMs: step,
      used: Math.max(0, Math.round(cap - decision.available)),
      perMin: cap,
      ...(label ? { label } : {}),
    });
    await sleepFn(step);
    waitedMs += step;
  }
}

/**
 * FW-3（docs/SLOW-SYNC.md §3.2/§4、§8 验收第 7 条）：后台展示用闸门状态——
 * 读 data/steam-rate.json（STEAM_RATE_FILE 可覆盖），按 at 补 token 到当前时刻；
 * 文件缺失/坏 JSON → 按满桶（tokens = perMin）。只读，不扣 token。
 *
 * 返回 { perMin, tokens, used }：used = perMin − tokens（后台「速率闸门 已用 N/M」）。
 */
export function rateGateInfo({ env = process.env, nowMs = Date.now(), file = rateFilePath(env), logger = null } = {}) {
  const perMin = rateGatePerMin(env);
  const state = readState(file, logger);
  const tokens = state ? refillTokens(state, nowMs, perMin) : perMin;
  const round1 = (n) => Math.round(n * 10) / 10;
  return {
    perMin,
    tokens: round1(Math.min(perMin, Math.max(0, tokens))),
    used: round1(Math.min(perMin, Math.max(0, perMin - tokens))),
  };
}
