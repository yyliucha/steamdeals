// Steam 代理池（docs/PROXY-POOL.md §4.2，AM-1 批）：
// 多条 Steam 专用代理的按序选择、失败冷却（首败 60s → 5min → 30min 封顶）、成功粘住（lastGood）、
// 健康状态跨进程共享：落 data/proxy-health.json，写 tmp → rename 原子落盘，"最后写入者胜"。
// 文件里只存 sha256(url) 前 16 位当 key，绝不出现代理地址与密码（§6.1）。
// 选择顺序：lastGood（在池内且未冷却）→ 配置顺序里跳过冷却中的 → 其余；全部冷却时取"最早解冻"的那条仍试一次。

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { redactProxy, steamProxyUrls } from './proxy.js';

/** 健康文件路径（可用 PROXY_HEALTH_FILE 覆盖，测试用；生产固定 data/proxy-health.json）。 */
export function healthFile() {
  return process.env.PROXY_HEALTH_FILE ?? 'data/proxy-health.json';
}

// 冷却阶梯：fails=1 → 60s；fails=2 → 5min；fails>=3 → 30min（§2 决策 2）
const COOLDOWN_BY_FAILS = [0, 60_000, 5 * 60_000, 30 * 60_000];

/** 代理 key = sha256(url) 前 16 位（§3.2）。 */
export function proxyKey(url) {
  return createHash('sha256').update(String(url ?? '')).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------- 内存态（进程内唯一事实）

let state = { updatedAt: null, lastGood: null, proxies: {} };
let loadedFile = null;
let saveTimer = null;
let pendingFile = null;

function resetState() {
  state = { updatedAt: null, lastGood: null, proxies: {} };
}

/** 每进程启动读一次；文件不存在 / JSON 坏了 → 空状态，记 proxy.health_reset。 */
function readHealth(file, logger = null) {
  if (loadedFile === file) return;
  loadedFile = file;
  let bad = false;
  try {
    if (!existsSync(file)) return;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.proxies !== 'object') {
      bad = true;
    } else {
      state = {
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
        lastGood: typeof parsed.lastGood === 'string' ? parsed.lastGood : null,
        proxies: parsed.proxies,
      };
      return;
    }
  } catch {
    bad = true;
  }
  if (bad) {
    resetState();
    logger?.warn('proxy.health_reset', { file, message: '健康文件不存在或损坏，按空状态处理' });
  }
}

/** 变更后 1 秒防抖、写 tmp → rename 原子落盘（§3.2）。 */
function scheduleSave(file, logger = null) {
  pendingFile = file;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushHealth(logger);
  }, 1000);
  saveTimer.unref?.();
}

function flushHealth(logger = null) {
  const file = pendingFile;
  if (!file) return;
  pendingFile = null;
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({ updatedAt: new Date().toISOString(), lastGood: state.lastGood, proxies: state.proxies }, null, 2),
    );
    renameSync(tmp, file);
  } catch (err) {
    logger?.error('proxy.health_save_failed', { file, message: String(err?.message ?? err).slice(0, 160) });
  }
}

/** 测试/收尾用：立即落盘（不等 1 秒防抖）。 */
export function flushProxyHealth(logger = null) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  flushHealth(logger);
}

/** 测试用：清内存态并允许重新读盘（模拟"另一个进程刚起来"）。 */
export function resetProxyHealth() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingFile = null;
  loadedFile = null;
  resetState();
}

// ---------------------------------------------------------------- 对外 API（§4.2）

/** 该代理当前的 downUntil（未冷却返回 null）。 */
export function cooldownUntil(url, opts = {}) {
  const { file = healthFile(), logger = null } = opts;
  readHealth(file, logger);
  const rec = state.proxies[proxyKey(url)];
  if (!rec?.downUntil) return null;
  const until = Date.parse(rec.downUntil);
  return Number.isFinite(until) && until > Date.now() ? rec.downUntil : null;
}

/** 该代理的健康记录（无记录返回 null）。 */
export function healthRecord(url, opts = {}) {
  const { file = healthFile(), logger = null } = opts;
  readHealth(file, logger);
  return state.proxies[proxyKey(url)] ?? null;
}

/** 按配置顺序返回候选 URL 列表：sticky 优先、冷却中的排后面；全部冷却时取最早解冻的那条（§4.2）。 */
export function candidatesFor(host, env = process.env, opts = {}) {
  const { file = healthFile(), logger = null } = opts;
  readHealth(file, logger);
  const pool = steamProxyUrls(env);
  if (!pool.length) return [];
  const now = Date.now();
  const keyOf = new Map(pool.map((u) => [proxyKey(u), u]));
  const usable = (url) => {
    const rec = state.proxies[proxyKey(url)];
    if (!rec?.downUntil) return true;
    const until = Date.parse(rec.downUntil);
    return !Number.isFinite(until) || until <= now;
  };
  const out = [];
  const lastGoodUrl = state.lastGood ? (keyOf.get(state.lastGood) ?? null) : null;
  if (lastGoodUrl && usable(lastGoodUrl)) out.push(lastGoodUrl);
  for (const url of pool) {
    if (url === lastGoodUrl) continue;
    if (usable(url)) out.push(url);
  }
  if (!out.length) {
    // 全部在冷却：取"最早解冻"的那条仍试一次，避免长任务被卡死（§4.2）
    let earliest = pool[0];
    let earliestUntil = Infinity;
    for (const url of pool) {
      const rec = state.proxies[proxyKey(url)];
      const until = rec?.downUntil ? Date.parse(rec.downUntil) : 0;
      if (until < earliestUntil) {
        earliestUntil = until;
        earliest = url;
      }
    }
    out.push(earliest);
  }
  return out;
}

/** 取第一条没试过的候选；没有返回 null（纯函数，供"换过代理"测试与反例自检锁行为）。 */
export function nextCandidate(list, tried) {
  for (const url of list) {
    if (!tried.includes(url)) return url;
  }
  return null;
}

/** 记一次失败：fails+1、按阶梯算冷却、落盘。返回 { fails, downUntil } 供日志用。 */
export function noteProxyFailure(url, err, opts = {}) {
  const { file = healthFile(), logger = null } = opts;
  readHealth(file, logger);
  const key = proxyKey(url);
  const rec = state.proxies[key] ?? {};
  const fails = (Number(rec.fails) || 0) + 1;
  const now = new Date();
  const downUntil = new Date(now.getTime() + COOLDOWN_BY_FAILS[Math.min(fails, 3)]).toISOString();
  state.proxies[key] = {
    fails,
    downUntil,
    lastErrorAt: now.toISOString(),
    lastError: String(err?.code ?? err?.message ?? 'unknown').slice(0, 120),
    lastOkAt: rec.lastOkAt ?? null,
  };
  state.updatedAt = now.toISOString();
  scheduleSave(file, logger);
  return { fails, downUntil };
}

/** 记一次成功：失败计数清零、清冷却、记 lastGood（粘住用），落盘。 */
export function noteProxySuccess(url, opts = {}) {
  const { file = healthFile(), logger = null } = opts;
  readHealth(file, logger);
  const key = proxyKey(url);
  const now = new Date();
  state.proxies[key] = {
    fails: 0,
    downUntil: null,
    lastErrorAt: null,
    lastError: null,
    lastOkAt: now.toISOString(),
  };
  state.lastGood = key;
  state.updatedAt = now.toISOString();
  scheduleSave(file, logger);
}

/** 给 /api/admin/proxies 与 diagnose 的健康视图（地址一律 redactProxy，§4.5）。 */
export function proxyHealth(env = process.env, opts = {}) {
  const { file = healthFile(), logger = null } = opts;
  readHealth(file, logger);
  const pool = steamProxyUrls(env);
  const now = Date.now();
  const proxies = pool.map((url, i) => {
    const rec = state.proxies[proxyKey(url)];
    const until = rec?.downUntil ? Date.parse(rec.downUntil) : NaN;
    const cooling = Number.isFinite(until) && until > now;
    return {
      index: i + 1,
      proxy: redactProxy(url),
      state: cooling ? 'cooldown' : rec?.lastOkAt ? 'ok' : 'unknown',
      fails: Number(rec?.fails) || 0,
      downUntil: cooling ? rec.downUntil : null,
      lastError: rec?.lastError ?? null,
      lastErrorAt: rec?.lastErrorAt ?? null,
      lastOkAt: rec?.lastOkAt ?? null,
      // BB 批（docs/PROXY-POOL.md §11.2）：主动探测结果（与业务冷却分离）
      probeAt: rec?.probeAt ?? null,
      probeOk: typeof rec?.probeOk === 'boolean' ? rec.probeOk : null,
      probeError: rec?.probeError ?? null,
    };
  });
  const lastGoodIdx = pool.findIndex((u) => proxyKey(u) === state.lastGood);
  return {
    proxies,
    lastGood: lastGoodIdx >= 0 ? lastGoodIdx + 1 : null,
    updatedAt: state.updatedAt,
  };
}
// ---------------------------------------------------------------- 主动探测（BB 批，docs/PROXY-POOL.md §11）
// 与业务冷却分离：探测失败只更新 probe* 字段，绝不写 fails/downUntil（避免探测误杀真实链路）。

export const PROBE_TARGET = 'store.steampowered.com:443';

/**
 * CONNECT 协议层探测：TCP 通 ≠ CONNECT 通（407 要账号密码、403 是代理禁目标、代理挂了是 ECONNREFUSED）。
 * 必须用**未脱敏**地址探测（凭证在 URL 里）；返回 { ok, status, detail }，detail 不含代理地址。
 */
export function probeProxyConnect(proxyUrl, target = PROBE_TARGET, { timeoutMs = 12000 } = {}) {
  let u;
  try {
    u = new URL(String(proxyUrl).includes('://') ? String(proxyUrl) : 'http://' + String(proxyUrl));
  } catch {
    return Promise.resolve({ ok: false, status: null, detail: '代理地址无法解析' });
  }
  const secure = u.protocol === 'https:';
  const headers = { host: target };
  if (u.username) {
    const cred = `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`;
    headers['proxy-authorization'] = 'Basic ' + Buffer.from(cred).toString('base64');
  }
  return new Promise((done) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      done({ target, ...result });
    };
    let req;
    try {
      req = (secure ? httpsRequest : httpRequest)(
        { host: u.hostname, port: Number(u.port || (secure ? 443 : 80)), method: 'CONNECT', path: target, headers, timeout: timeoutMs },
        (res) => {
          res.resume();
          finish({ ok: false, status: res.statusCode ?? null, detail: `CONNECT ${target} 被当成普通请求处理：HTTP ${res.statusCode}` });
        },
      );
    } catch (err) {
      finish({ ok: false, status: null, detail: String(err?.message ?? err).slice(0, 140) });
      return;
    }
    req.on('connect', (res, sock) => {
      sock.destroy();
      const status = res.statusCode ?? null;
      const hint = status === 407 ? '需要账号密码' : status === 403 ? '代理拒绝该目标' : '';
      finish({ ok: status === 200, status, detail: status === 200 ? 'CONNECT ' + target + ' 成功（隧道已建立）' : 'CONNECT ' + target + ' → ' + status + (hint ? '（' + hint + '）' : '') });
    });
    req.on('timeout', () => {
      req.destroy();
      finish({ ok: false, status: null, detail: `CONNECT ${target} 超时（${Math.round(timeoutMs / 1000)}s）` });
    });
    req.on('error', (err) => finish({ ok: false, status: null, detail: `CONNECT ${target} 失败：${String(err?.code ?? err?.message ?? err).slice(0, 120)}` }));
    req.end();
  });
}

/** 记录一次探测结果：只写 probe*，保留 fails/downUntil/lastOkAt/lastError（§11.2）。 */
export function recordProbe(url, result, { file = healthFile(), logger = null } = {}) {
  readHealth(file, logger);
  const key = proxyKey(url);
  const rec = state.proxies[key] ?? {};
  const now = new Date();
  state.proxies[key] = {
    ...rec,
    probeAt: now.toISOString(),
    probeOk: Boolean(result?.ok),
    probeError: result?.ok ? null : String(result?.detail ?? '探测失败').slice(0, 120),
  };
  state.updatedAt = now.toISOString();
  scheduleSave(file, logger);
  return state.proxies[key];
}

/** 逐条探测池内全部代理（顺序执行，单条失败不影响其它），写健康文件并返回汇总（地址脱敏）。 */
export async function probeAllProxies(env = process.env, { file = healthFile(), logger = null, target = PROBE_TARGET, timeoutMs = 12000 } = {}) {
  const pool = steamProxyUrls(env);
  const started = Date.now();
  if (!pool.length) return { proxies: [], updatedAt: null, probed: 0, ok: 0, failed: 0 };
  logger?.info('proxy.probe_start', { count: pool.length, target });
  let ok = 0;
  for (let i = 0; i < pool.length; i += 1) {
    const result = await probeProxyConnect(pool[i], target, { timeoutMs });
    recordProbe(pool[i], result, { file, logger });
    if (result.ok) ok += 1;
    logger?.info('proxy.probe_result', { index: i + 1, proxy: redactProxy(pool[i]), ok: result.ok, status: result.status, detail: result.detail });
  }
  flushProxyHealth(logger);
  const elapsedMs = Date.now() - started;
  logger?.info('proxy.probe_done', { total: pool.length, ok, failed: pool.length - ok, elapsedMs });
  const view = proxyHealth(env, { file, logger });
  return { ...view, probed: pool.length, ok, failed: pool.length - ok, elapsedMs };
}