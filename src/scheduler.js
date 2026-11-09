// 容器里的常驻调度器：按间隔跑采集任务。
//
// 每个任务是独立子进程，任务崩了（OOM、未捕获异常）不会把调度器一起带走，
// 符合"采集挂掉但服务还在"的目标。
//
// 纯函数（jobsFromEnv / dueJobs / describeSchedule）单独导出，
// 测试时刻表逻辑不需要真的等一小时。
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLogger, serializeError } from './log.js';
import { hasNotifier } from './notify.js';
import { openStore } from './store/index.js';
import * as db from './store/pg.js';
import * as settings from './settings.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'cli.js');
const TICK_MS = 15000;

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function jobsFromEnv(env = process.env) {
  return [
    {
      name: 'catalog',
      // 每周同步一次 Steam 全量目录（幂等：已存在的 appid 跳过）——新游戏自动进库，
      // 不需要人去控制台点「导入目录」。需要 STEAM_API_KEY，没配时该任务不出现。
      args: ['sync', 'catalog'],
      intervalMin: num(env.STEAM_CATALOG_INTERVAL_MIN, 10080),
      initialDelaySec: num(env.STEAM_CATALOG_INITIAL_DELAY_SEC, 3600),
      enabled: env.STEAM_ENABLED !== '0' && String(env.STEAM_API_KEY ?? '').trim().length > 10,
    },
    {
      name: 'steam-prices',
      // 每日只刷新已经有 Steam 报价的游戏；初次导入/补详情由后台回填完成。
      args: ['sync', 'steam-prices', '--limit', String(num(env.STEAM_PRICE_LIMIT, 200000))],
      intervalMin: num(env.STEAM_PRICE_INTERVAL_MIN, 1440),
      initialDelaySec: num(env.STEAM_INITIAL_DELAY_SEC, 600),
      enabled: env.STEAM_ENABLED !== '0',
    },
    {
      name: 'heat',
      // 每天跑热度（评测数 + 发行日期）：**首轮自动全量播种**（heat_at 为 null 的都会被选中），
      // 之后只刷"过期 7 天且有报价"的条目。appdetails 批量只接受 price_overview，
      // 热度必须逐 appid 请求（约 1.7s/款）；每天 20000 款 ≈ 9.4 小时，
      // 19.6 万款约 10 天播完，**无需手工执行任何命令**。
      args: ['heat', '--limit', String(num(env.STEAM_HEAT_LIMIT, 20000)), '--sleep', '1700'],
      intervalMin: num(env.STEAM_HEAT_INTERVAL_MIN, 1440),
      initialDelaySec: num(env.STEAM_HEAT_INITIAL_DELAY_SEC, 3600),
      enabled: env.STEAM_ENABLED !== '0',
    },
    {
      name: 'steam-status',
      // 每天判定一次 Steam 同步状态 + 内容分级（docs/STEAM-SYNC-STATUS-AND-RATING.md）：
      // 逐 appid 全量 appdetails（cc=cn 失败补 cc=hk），状态与分级共用同一次请求；
      // 免费已由迁移一次性置位；steam_checked_at 作续跑游标，失败不写游标下轮重试；
      // 归入 STEAM_HEAVY 与价格/热度/回填互斥串行；每款平均 2 请求，6000 款 ≈ 5 小时/轮（AB 批从 12000 下调）。
      args: ['steam-status', '--limit', String(num(env.STEAM_STATUS_LIMIT, 6000)), '--rate', String(num(env.STEAM_STATUS_RATE_MS, 1500))],
      intervalMin: num(env.STEAM_STATUS_INTERVAL_MIN, 1440),
      initialDelaySec: num(env.STEAM_STATUS_INITIAL_DELAY_SEC, 600),
      enabled: env.STEAM_ENABLED !== '0',
    },
    {
      name: 'rename',
      // 每周重写一次名字：目录导入留下的机器英文名补成中文（英文挪进 name_en），
      // 顺带覆盖"后来才补了简中"的游戏。选择条件自带收敛，没名字可改时秒退。
      args: ['rename', '--limit', String(num(env.STEAM_RENAME_LIMIT, 200000)), '--batch', '100', '--sleep', '1500'],
      intervalMin: num(env.STEAM_RENAME_INTERVAL_MIN, 10080),
      initialDelaySec: num(env.STEAM_RENAME_INITIAL_DELAY_SEC, 7200),
      enabled: env.STEAM_ENABLED !== '0',
    },
    {
      name: 'backfill',
      // 每周增量回填：给目录里新进的游戏补元数据/说明/价格（GetItems + appdetails 回退）。
      // 选择条件自带收敛（有说明+报价的跳过），没活时秒退；与其它 Steam 任务串行不抢限流。
      // AC-3/AC9（2026-11-09）：上限从每周 2 万提高到 5 万，且队列按收录时间新游戏优先。
      args: ['backfill', '--limit', String(num(env.STEAM_BACKFILL_LIMIT, 50000)), '--batch', '100', '--sleep', '3000'],
      intervalMin: num(env.STEAM_BACKFILL_INTERVAL_MIN, 10080),
      initialDelaySec: num(env.STEAM_BACKFILL_INITIAL_DELAY_SEC, 10800),
      enabled: env.STEAM_ENABLED !== '0',
    },
    {
      name: 'steam-accounts',
      // 每天同步所有已绑定 Steam 账号的游戏库与愿望单（差集删除 + 愿望单→到价提醒对账），
      // 账号间串行、间隔 ≥ 1s；单个账号失败只记日志继续下一个。需要 STEAM_API_KEY。
      args: ['steam-accounts', '--sleep', String(num(env.STEAM_ACCOUNTS_SLEEP_MS, 1000))],
      intervalMin: num(env.STEAM_ACCOUNTS_INTERVAL_MIN, 1440),
      initialDelaySec: num(env.STEAM_ACCOUNTS_INITIAL_DELAY_SEC, 1500),
      enabled: env.STEAM_ENABLED !== '0' && String(env.STEAM_API_KEY ?? '').trim().length > 10,
    },
    {
      name: 'steam-claim',
      // 一次性迁移：把历史未归属的 Steam 账号认领到指定用户（幂等，已归属则秒退）。
      // 只在配置了 STEAM_CLAIM_USERNAME + STEAM_CLAIM_STEAM_ID 时出现，认领完成后可删配置。
      args: ['steam-claim', String(env.STEAM_CLAIM_USERNAME ?? ''), String(env.STEAM_CLAIM_STEAM_ID ?? '')],
      intervalMin: num(env.STEAM_CLAIM_INTERVAL_MIN, 1440),
      initialDelaySec: num(env.STEAM_CLAIM_INITIAL_DELAY_SEC, 60),
      enabled:
        env.STEAM_CLAIM_ENABLED !== '0' &&
        Boolean(String(env.STEAM_CLAIM_USERNAME ?? '').trim()) &&
        Boolean(String(env.STEAM_CLAIM_STEAM_ID ?? '').trim()),
    },
    {
      name: 'prune',
      // 每周清理：访问记录 180 天、采集/任务记录 90 天、验证码 7 天
      args: ['prune'],
      intervalMin: num(env.PRUNE_INTERVAL_MIN, 10080),
      initialDelaySec: 43200,
      enabled: env.PRUNE_ENABLED !== '0',
    },
    {
      name: 'sonkwo',
      args: ['sync', 'sonkwo'],
      intervalMin: num(env.SONKWO_INTERVAL_MIN, 60),
      initialDelaySec: num(env.SONKWO_INITIAL_DELAY_SEC, 180),
      enabled: env.SONKWO_ENABLED !== '0',
    },
    {
      name: 'itad',
      args: ['sync', 'itad'],
      intervalMin: num(env.ITAD_INTERVAL_MIN, 1440),
      initialDelaySec: num(env.ITAD_INITIAL_DELAY_SEC, 300),
      enabled: env.ITAD_ENABLED !== '0',
    },
    {
      name: 'gog',
      args: ['sync', 'gog'],
      intervalMin: num(env.GOG_INTERVAL_MIN, 720),
      initialDelaySec: num(env.GOG_INITIAL_DELAY_SEC, 600),
      enabled: env.GOG_ENABLED !== '0',
    },
    {
      name: 'humble',
      args: ['sync', 'humble'],
      intervalMin: num(env.HUMBLE_INTERVAL_MIN, 720),
      initialDelaySec: num(env.HUMBLE_INITIAL_DELAY_SEC, 720),
      enabled: env.HUMBLE_ENABLED !== '0',
    },
    {
      name: 'discover',
      // 杉果 SKU 增量发现：从前沿向后探测，连续空壳即停，通常十几到几十次请求
      args: ['discover', 'sonkwo', '--ahead', '60', '--max-misses', '12'],
      intervalMin: num(env.DISCOVER_INTERVAL_MIN, 720),
      initialDelaySec: num(env.DISCOVER_INITIAL_DELAY_SEC, 900),
      enabled: env.DISCOVER_ENABLED !== '0',
    },
    {
      name: 'backup',
      // 每日逻辑备份（gzip JSON），保留最近 7 份；顺带清理过期浏览记录
      args: ['backup'],
      intervalMin: num(env.BACKUP_INTERVAL_MIN, 1440),
      initialDelaySec: num(env.BACKUP_INITIAL_DELAY_SEC, 3600),
      enabled: env.BACKUP_ENABLED !== '0',
    },
    {
      name: 'logs',
      // 每 7 天清理一次日志文件，避免无限增长
      args: ['logs', 'prune', '--days', '7'],
      intervalMin: num(env.LOGS_PRUNE_DAYS, 7) * 1440,
      initialDelaySec: 900,
      enabled: env.LOGS_PRUNE_ENABLED !== '0',
    },
    {
      name: 'alerts',
      // 只有配了任意提醒通道才在检查后标记已通知，否则只做只读检查，避免静默吞掉提醒
      args: hasNotifier(env) ? ['alerts', '--mark'] : ['alerts'],
      intervalMin: num(env.ALERTS_INTERVAL_MIN, 360),
      initialDelaySec: num(env.ALERTS_INITIAL_DELAY_SEC, 420),
      enabled: env.ALERTS_ENABLED !== '0',
    },
    {
      name: 'images',
      // 封面图补缓存：下载到 data/images（宿主机卷），之后前台直接读本地文件，不再依赖 CDN/代理
      args: [
        'images',
        'pull',
        '--limit',
        String(num(env.IMAGES_LIMIT, 200)),
        '--sleep',
        String(num(env.IMAGES_SLEEP_MS, 300)),
      ],
      intervalMin: num(env.IMAGES_INTERVAL_MIN, 240),
      initialDelaySec: num(env.IMAGES_INITIAL_DELAY_SEC, 1200),
      enabled: env.IMAGES_ENABLED !== '0',
    },
    {
      name: 'report',
      // 价格报表推送：只在配置了提醒通道时启用（--notify 内部还会再判断一次）
      args: ['report', 'price', '--hours', '24', '--notify'],
      intervalMin: num(env.REPORT_INTERVAL_MIN, 1440),
      initialDelaySec: num(env.REPORT_INITIAL_DELAY_SEC, 900),
      enabled: env.REPORT_ENABLED !== '0' && hasNotifier(env),
    },
  ].filter((j) => j.enabled && j.intervalMin > 0);
}

/** 熔断参数：连续失败 threshold 次后，暂停该任务 cooldownMs。 */
export const CIRCUIT = { threshold: 3, cooldownMs: 6 * 3600_000 };

/** 记录一次任务结果，返回新的健康状态。纯函数，便于单测。 */
export function recordJobResult(state, { code, nowMs, threshold = CIRCUIT.threshold, cooldownMs = CIRCUIT.cooldownMs }) {
  if (code === 0) return { failures: 0, openUntil: null, opened: false };
  const failures = (state?.failures ?? 0) + 1;
  if (failures >= threshold) {
    return { failures, openUntil: nowMs + cooldownMs, opened: true };
  }
  return { failures, openUntil: state?.openUntil ?? null, opened: false };
}

/** 熔断是否仍然生效。 */
export function isCircuited(state, nowMs) {
  return Boolean(state?.openUntil && nowMs < state.openUntil);
}

// 采集类任务成功后需要刷新静态页的，列在这里（backfill 会写新报价，也要重建）
const SYNC_LIKE = new Set(['steam', 'sonkwo', 'itad', 'gog', 'humble', 'discover', 'rename', 'backfill']);

// Steam 重任务：与后台手动同步/回填/热度共用配额与槽位，有手动任务在跑时让路。
// 它们都打 store.steampowered.com/appdetails（200 次/5 分钟配额），必须串行互斥。
// steam-status 也在其中（X 批）：逐 appid 全量请求，与价格/热度/回填并列重任务槽。
export const STEAM_HEAVY = new Set(['steam-prices', 'rename', 'backfill', 'heat', 'catalog', 'steam-status']);

// 轻任务：目标站与配额都和重任务独立（杉果国内源、GOG/Humble catalog、备份/日志/提醒/图片），
// 允许在 heat/steam-prices 等长任务运行时并行执行——否则 heat 首轮播种 9 小时会饿死所有其它源。
const LIGHT_JOBS = new Set(['sonkwo', 'itad', 'gog', 'humble', 'discover', 'steam-accounts', 'backup', 'logs', 'alerts', 'images']);

/** 轻任务并行上限（环境变量 SCHEDULER_LIGHT_CONCURRENCY 可调，默认 3，范围 1–8）。 */
export function lightConcurrency(env = process.env) {
  const n = Number(env.SCHEDULER_LIGHT_CONCURRENCY ?? 3);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 8) : 3;
}

/**
 * 每 tick 的派发计划（纯函数，便于回归测试，X 批 P0-1）：
 * - 重任务：`heavySlot` 非空或已在 running 时一个都不排（全局单槽，串行互斥）；
 * - 轻任务：**不受重任务槽影响**（steam-prices 跑 90 分钟期间 sonkwo/alerts 照常发），
 *   只受 running 去重与 lightMax 并行上限约束；非重非轻的任务（如 prune）不受上限约束（与旧行为一致）。
 */
export function planTick({ due, heavySlot = null, running = new Set(), lightMax = 3, heavyJobs = STEAM_HEAVY, lightJobs = LIGHT_JOBS }) {
  const light = [];
  const heavy = [];
  const lightRunning = [...running].filter((name) => lightJobs.has(name)).length;
  for (const job of due) {
    if (heavyJobs.has(job.name)) {
      if (!heavySlot && !running.has(job.name)) heavy.push(job);
      continue;
    }
    if (running.has(job.name)) continue;
    if (lightJobs.has(job.name) && light.length + lightRunning >= lightMax) continue;
    light.push(job);
  }
  return { light, heavy };
}

/**
 * 把 `select mode, max(started_at) group by mode` 的结果行转成 Map(jobName -> ms)（X 批 P1-1）。
 * 只有 mode 是合法字符串、时间能解析的行才恢复；坏行跳过，绝不阻塞调度器启动。
 */
export function lastRunMsFromRows(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    if (!row || typeof row.mode !== 'string' || !row.mode) continue;
    // null / 空串 / 非法时间一律视为"没跑过"，不恢复（new Date(null) 是 epoch 0，必须显式挡掉）
    if (row.last == null || row.last === '') continue;
    const ms = new Date(row.last).getTime();
    if (Number.isFinite(ms)) map.set(row.mode, ms);
  }
  return map;
}

/**
 * 任务成功后的后续动作。
 * 采集完不重建曲线页，用户就得手动跑 chart——这条链本来就是"自动刷新"的价值所在。
 * CHART_ON_SYNC=0 可关（例如只想采集、页面由 CI 构建）。
 */
export function followUpArgs(jobName, code, env = process.env) {
  if (code !== 0) return null;
  if (env.CHART_ON_SYNC === '0') return null;
  if (!SYNC_LIKE.has(jobName)) return null;
  return ['chart'];
}

/**
 * 哪些任务到点了。
 * 从未跑过：startedMs + initialDelaySec 触发（首轮错开，避免同时打满）。
 * 跑过的：lastRun + intervalMin 触发。
 */
export function dueJobs(jobs, { nowMs, startedMs, lastRunMs }) {
  return jobs.filter((job) => {
    const last = lastRunMs.get(job.name);
    const nextAt = last == null ? startedMs + job.initialDelaySec * 1000 : last + job.intervalMin * 60_000;
    return nowMs >= nextAt;
  });
}

export function describeSchedule(jobs) {
  return jobs.map((j) => `${j.name} 每 ${j.intervalMin} 分钟（首轮 ${j.initialDelaySec}s 后）`).join('；');
}

// ---------------------------------------------------------------- AC-4：每日 Steam 配额预算

/**
 * AC-4（docs/SYNC-FAILURE-MODES.md AC4）：四任务的每日串行总时长估算（分钟）。
 * 口径与任务实现一致：
 *  - steam-prices：每 30 款一批约 1.1s（batchSize=30/rateLimitMs=1100，cmd 内固定）；
 *  - heat：每款约 1.7s（scheduler 里 --sleep 1700 固定）；
 *  - steam-status：每款平均 2 次请求 × rate；
 *  - backfill：每 100 款一批 GetItems 间隔 3s + 每批最多 10 个单条回退（各 0.4s），
 *    并按 intervalMin 折算成每日分摊（每周跑一次 → 除以 7）。
 */
export function steamDailyBudgetMinutes(env = process.env) {
  const priceMin = (num(env.STEAM_PRICE_LIMIT, 200000) / 30) * 1.1 / 60;
  const heatMin = num(env.STEAM_HEAT_LIMIT, 20000) * 1.7 / 60;
  const statusMin = num(env.STEAM_STATUS_LIMIT, 6000) * 2 * (num(env.STEAM_STATUS_RATE_MS, 1500) / 60000);
  const backfillLimit = num(env.STEAM_BACKFILL_LIMIT, 50000);
  const backfillRoundMin = (backfillLimit / 100) * 3 / 60 + (backfillLimit / 100) * 10 * 0.4 / 60;
  const backfillDailyMin = backfillRoundMin / Math.max(1, num(env.STEAM_BACKFILL_INTERVAL_MIN, 10080) / 1440);
  return {
    priceMin,
    heatMin,
    statusMin,
    backfillRoundMin,
    backfillDailyMin,
    total: priceMin + heatMin + statusMin + backfillDailyMin,
  };
}

/**
 * AC-4：总时长超过 24 小时（1440 分钟）时自动降频——只缩 steam-status 的每日限额
 * （唯一可调的大项），把总量压回预算内并记 `scheduler.budget_exceeded` 告警。
 * 返回 { jobs, budget, adjusted }，jobs 是调整后的副本。
 */
export function applySteamBudget(jobs, env = process.env, logger = null) {
  const budget = steamDailyBudgetMinutes(env);
  if (budget.total <= 1440) return { jobs, budget, adjusted: false };
  const others = budget.priceMin + budget.heatMin + budget.backfillDailyMin;
  const statusTargetMin = Math.max(120, 1440 - others); // 至少给 status 留 2 小时
  const statusPerGameMin = 2 * (num(env.STEAM_STATUS_RATE_MS, 1500) / 60000);
  const newLimit = Math.max(500, Math.floor(statusTargetMin / statusPerGameMin));
  const adjusted = jobs.map((j) => {
    if (j.name !== 'steam-status') return j;
    const args = [...j.args];
    const idx = args.indexOf('--limit');
    if (idx >= 0) args[idx + 1] = String(newLimit);
    return { ...j, args };
  });
  logger?.warn?.('scheduler.budget_exceeded', {
    totalMin: Math.round(budget.total),
    targetMin: 1440,
    adjustedSteamStatusLimit: newLimit,
  });
  return { jobs: adjusted, budget, adjusted: true };
}

/**
 * AC1（docs/SYNC-FAILURE-MODES.md AC1）：该有但没有的任务——缺 `STEAM_API_KEY`（catalog/steam-accounts）
 * 或被 `*_ENABLED=0` 显式关闭的任务。返回警告清单，后台「同步与回填」页显式提示，不静默消失。
 */
export function auditJobs(env = process.env) {
  const jobs = jobsFromEnv(env);
  const present = new Set(jobs.map((j) => j.name));
  const warnings = [];
  const hasKey = String(env.STEAM_API_KEY ?? '').trim().length > 10;
  if (!hasKey) {
    if (!present.has('catalog')) warnings.push({ name: 'catalog', reason: 'STEAM_API_KEY 未配置' });
    if (!present.has('steam-accounts')) warnings.push({ name: 'steam-accounts', reason: 'STEAM_API_KEY 未配置' });
  }
  const switches = [
    ['steam-prices', 'STEAM_ENABLED'],
    ['heat', 'STEAM_ENABLED'],
    ['steam-status', 'STEAM_ENABLED'],
    ['rename', 'STEAM_ENABLED'],
    ['backfill', 'STEAM_ENABLED'],
    ['sonkwo', 'SONKWO_ENABLED'],
    ['itad', 'ITAD_ENABLED'],
    ['gog', 'GOG_ENABLED'],
    ['humble', 'HUMBLE_ENABLED'],
    ['discover', 'DISCOVER_ENABLED'],
    ['backup', 'BACKUP_ENABLED'],
    ['prune', 'PRUNE_ENABLED'],
    ['logs', 'LOGS_PRUNE_ENABLED'],
    ['alerts', 'ALERTS_ENABLED'],
    ['images', 'IMAGES_ENABLED'],
  ];
  for (const [name, envName] of switches) {
    if (!present.has(name) && String(env[envName] ?? '') === '0') warnings.push({ name, reason: `${envName}=0` });
  }
  // report 的开关还有第二道条件：配置了提醒通道才出现
  if (!present.has('report') && String(env.REPORT_ENABLED ?? '') !== '0') {
    warnings.push({ name: 'report', reason: '未配置提醒通道' });
  }
  return warnings;
}

/**
 * 把调度器状态写到文件，Web 进程读它来展示「定时任务 / 下次运行」。
 * 跨进程通信不值得上 IPC：一个小 JSON 足够，读不到就当没有。
 */
export function writeStatusFile(jobs, { lastRunMs, health, running, tickMs = 60000, lastOutcome = null, waitingSince = null, file = process.env.SCHEDULER_STATUS_FILE || 'data/scheduler-status.json' } = {}) {
  try {
    const now = Date.now();
    const payload = {
      updatedAt: new Date(now).toISOString(),
      tickMs,
      jobs: jobs.map((j) => {
        const last = lastRunMs?.get?.(j.name) ?? null;
        const h = health?.get?.(j.name) ?? {};
        const outcome = lastOutcome?.get?.(j.name) ?? null;
        const waiting = waitingSince?.get?.(j.name) ?? null;
        return {
          name: j.name,
          intervalMin: j.intervalMin,
          lastRunAt: last ? new Date(last).toISOString() : null,
          // 从未跑过的任务，下一次是「首轮延迟」；跑过的按间隔。之前这里一律按间隔算，
          // 导致首轮任务（如 rename 首轮 +7200s）在状态文件里显示成一周后。
          nextRunAt: new Date((last ?? now) + (last == null ? j.initialDelaySec * 1000 : j.intervalMin * 60_000)).toISOString(),
          running: Boolean(running?.has?.(j.name)),
          failures: Number(h.failures ?? 0),
          openUntil: h.openUntil ? new Date(h.openUntil).toISOString() : null,
          // AC11（docs/SYNC-FAILURE-MODES.md）：任务健康面板字段
          lastElapsedMs: outcome ? outcome.elapsedMs : null,
          lastResult: outcome ? outcome.result : null,
          lastError: outcome ? outcome.error : null,
          // AC5：重任务排队等待（被谁占用、从何时开始等）
          waitingFor: waiting ? { occupiedBy: waiting.occupiedBy, since: new Date(waiting.at).toISOString() } : null,
        };
      }),
    };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(payload, null, 2));
  } catch {
    /* 状态文件写失败不影响调度 */
  }
}

/**
 * 调度器自己的通用参数要透传给每个子任务，否则 `scheduler.js --db pglite:...`
 * 这种用法下子任务会找不到库（Docker 里靠 DATABASE_URL 侥幸不出问题，本地必踩）。
 */
export function forwardedArgs(argv = process.argv) {
  const out = [];
  for (const name of ['--db', '--log-dir', '--level']) {
    const i = argv.indexOf(name);
    if (i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) out.push(name, argv[i + 1]);
  }
  return out;
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  return value && !value.startsWith('--') ? value : null;
}

export async function main() {
  const logger = createLogger({ prefix: 'scheduler', level: process.env.LOG_LEVEL ?? 'info' });
  const dbTarget = String(argValue('--db') ?? process.env.DATABASE_URL ?? '');
  if (!dbTarget || dbTarget.startsWith('pglite:')) {
    throw new Error('scheduler 需要 PostgreSQL：请设置 DATABASE_URL（PGlite 不能被子进程并发访问）');
  }

  const store = await openStore(dbTarget, { logger, timezone: process.env.TZ });
  const q = (sql, p) => store.query(sql, p);

  let stopping = false;
  const children = new Map(); // 并发子进程：job.name -> child（轻任务并行，重任务同一时刻最多一个）
  let wake = null;

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info('scheduler.stop', { signal, children: children.size });
    for (const child of children.values()) {
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* 已退出 */
        }
      }, 5000).unref();
    }
    wake?.();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  const sleepInterruptible = (ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  const runJob = (job) =>
    new Promise((resolve) => {
      const startedAt = Date.now();
      const args = [CLI, ...job.args, ...forwardedArgs()];
      logger.info('scheduler.job_start', { job: job.name, args: args.slice(1).join(' ') });
      const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          // 价格刷新是无人值守任务：429 时按安全退避等待并重试，避免周期任务永久漏掉这一轮。
          ...(job.name === 'steam-prices' ? { STEAM_429_RETRIES: 'Infinity' } : {}),
        },
        stdio: 'inherit',
      });
      children.set(job.name, child);
      child.on('error', (err) => {
        children.delete(job.name);
        logger.error('scheduler.job_spawn_failed', { job: job.name, err: serializeError(err) });
        resolve({ code: -1 });
      });
      child.on('exit', (code, signal) => {
        children.delete(job.name);
        const elapsedMs = Date.now() - startedAt;
        if (code === 0) logger.info('scheduler.job_done', { job: job.name, code, elapsedMs });
        else logger.error('scheduler.job_failed', { job: job.name, code, signal, elapsedMs });
        resolve({ code: code ?? -1 });
      });
    });

  try {
    await db.migrate(store);
    const initialized = await settings.initializeSettings({ store, logger });

    // 初始化完成前不采集：用户还没配数据源/Key，先跑只会刷失败日志。
    let waitingLogged = false;
    while (!stopping && !(await settings.isSetupComplete(q))) {
      if (!waitingLogged) {
        logger.info('scheduler.waiting_setup', { hint: '打开 /setup 完成初始化后自动开始采集' });
        console.log('系统尚未初始化：请打开 /setup 完成设置，完成前不会采集。');
        waitingLogged = true;
      }
      await sleepInterruptible(15000);
    }
    if (stopping) return;

    await settings.hydrateSettings({ store, logger });
    await store.setTimezone?.(process.env.TZ); // 时区设置水合后立即生效
    let jobs = jobsFromEnv();
    // AC-4（docs/SYNC-FAILURE-MODES.md AC4）：每日 Steam 配额预算——超 24h 自动缩 steam-status 并告警
    const budget = applySteamBudget(jobs, process.env, logger);
    jobs = budget.jobs;
    let lastRevision = await settings.getRevision(q);
    let circuitThreshold = num(process.env.CIRCUIT_THRESHOLD, CIRCUIT.threshold);
    let circuitCooldownMs = num(process.env.CIRCUIT_COOLDOWN_MIN, CIRCUIT.cooldownMs / 60_000) * 60_000;

    const startedMs = Date.now();
    const lastRunMs = new Map();
    // P1-1（X 批）：重启后从 sync_runs 恢复每个 mode 的最近开始时间，避免每次发版重启都
    // 把全部任务打回首轮延迟计时（6 小时首轮的任务在频繁发版时永远轮不到）。
    try {
      const rows = await db.lastSyncRunStartedByMode(q);
      for (const [name, ms] of lastRunMsFromRows(rows)) lastRunMs.set(name, ms);
      if (lastRunMs.size) logger.info('scheduler.lastrun_restored', { jobs: [...lastRunMs.keys()] });
    } catch (err) {
      logger.warn('scheduler.lastrun_restore_failed', { err: serializeError(err) });
    }
    const health = new Map(); // job.name -> { failures, openUntil }
    const running = new Set();
    const startedAt = new Map(); // job.name -> 本次启动毫秒（AC11 耗时）
    const lastOutcome = new Map(); // job.name -> { elapsedMs, result, error }（AC11 健康面板）
    const waitingSince = new Map(); // job.name -> { at, occupiedBy }（AC5 重任务排队可观测）
    let heavySlot = null; // 正在跑的 Steam 重任务名（全局单槽，X 批 P0-1：串行但不阻塞 tick）
    const lightMax = lightConcurrency(process.env);
    // chart 后续任务串行链：避免多个 chart 子进程并发写 out/
    let followUpChain = Promise.resolve();

    // 任务收尾（并行任务各自完成时调用）：记录时间/健康度、状态文件、串行触发后续 chart
    const completeJob = (job, code) => {
      running.delete(job.name);
      lastRunMs.set(job.name, Date.now());
      const started = startedAt.get(job.name) ?? Date.now();
      startedAt.delete(job.name);
      lastOutcome.set(job.name, {
        elapsedMs: Date.now() - started,
        result: code === 0 ? 'ok' : 'failed',
        error: code === 0 ? null : `exit code ${code}`,
      });
      waitingSince.delete(job.name);
      writeStatusFile(jobs, { lastRunMs, health, running, tickMs: TICK_MS, lastOutcome, waitingSince });
      const followUp = followUpArgs(job.name, code, process.env);
      if (followUp && !stopping) {
        followUpChain = followUpChain
          .then(async () => {
            if (stopping) return;
            logger.info('scheduler.followup', { job: job.name, args: followUp.join(' ') });
            await runJob({ name: `${job.name}:chart`, args: followUp });
          })
          .catch(() => {});
      }
      const state = health.get(job.name) ?? { failures: 0, openUntil: null };
      const next = recordJobResult(state, {
        code,
        nowMs: Date.now(),
        threshold: circuitThreshold,
        cooldownMs: circuitCooldownMs,
      });
      health.set(job.name, next);
      if (next.opened) {
        logger.error('scheduler.circuit_tripped', {
          job: job.name,
          failures: next.failures,
          openUntil: new Date(next.openUntil).toISOString(),
        });
      } else if (code === 0 && (state.failures ?? 0) > 0) {
        logger.info('scheduler.circuit_reset', { job: job.name, afterFailures: state.failures });
      }
    };

    /** 非阻塞发射一个任务（熔断检查在发射前做）。 */
    const launch = (job, now) => {
      const state = health.get(job.name) ?? { failures: 0, openUntil: null };
      if (isCircuited(state, now)) {
        logger.warn('scheduler.circuit_skip', {
          job: job.name,
          failures: state.failures,
          openUntil: new Date(state.openUntil).toISOString(),
        });
        lastRunMs.set(job.name, now);
        return;
      }
      running.add(job.name);
      startedAt.set(job.name, Date.now());
      runJob(job)
        .then(({ code }) => completeJob(job, code))
        .catch((err) => {
          logger.error('scheduler.job_unexpected', { job: job.name, err: serializeError(err) });
          completeJob(job, -1);
        });
    };

    /**
     * 非阻塞发射一个 Steam 重任务并占用全局单槽（X 批 P0-1）：
     * tick 循环不再 await 它，子进程结束后才释放槽位——轻任务在它运行期间照常派发。
     * 槽位释放放在 .finally，completeJob 之外再加一道保险，两个 Steam 重任务并行打配额是红线。
     */
    const launchHeavy = (job) => {
      heavySlot = job.name;
      running.add(job.name);
      startedAt.set(job.name, Date.now());
      const waiting = waitingSince.get(job.name);
      if (waiting) {
        waitingSince.delete(job.name);
        logger.info('scheduler.job_wait_end', { job: job.name, waitedMs: Date.now() - waiting.at, occupiedBy: waiting.occupiedBy });
      }
      runJob(job)
        .then(({ code }) => completeJob(job, code))
        .catch((err) => {
          logger.error('scheduler.job_unexpected', { job: job.name, err: serializeError(err) });
          completeJob(job, -1);
        })
        .finally(() => {
          heavySlot = null;
          logger.info('scheduler.heavy_slot_released', { job: job.name });
          wake?.(); // 槽位一空立即唤醒 tick，不用等到下个 sleep 结束
        });
    };

    if (!jobs.length) logger.warn('scheduler.no_jobs', { hint: '所有任务均被禁用或间隔为 0' });
    logger.info('scheduler.start', {
      jobs: jobs.map((j) => j.name),
      schedule: describeSchedule(jobs),
      node: process.version,
      tickMs: TICK_MS,
      setupCompleted: initialized.completed,
      lightConcurrency: lightMax,
    });
    writeStatusFile(jobs, { lastRunMs, health, running, tickMs: TICK_MS });

    while (!stopping) {
      // 设置页保存后 revision +1：重新水合 env 并重建任务表，无需重启容器
      const revision = await settings.getRevision(q);
      if (revision !== lastRevision) {
        await settings.hydrateSettings({ store, logger });
        await store.setTimezone?.(process.env.TZ);
        jobs = jobsFromEnv();
        jobs = applySteamBudget(jobs, process.env, logger).jobs; // AC-4：设置变更后同样过预算
        circuitThreshold = num(process.env.CIRCUIT_THRESHOLD, CIRCUIT.threshold);
        circuitCooldownMs = num(process.env.CIRCUIT_COOLDOWN_MIN, CIRCUIT.cooldownMs / 60_000) * 60_000;
        lastRevision = revision;
        logger.info('scheduler.settings_reloaded', { revision, jobs: jobs.map((j) => j.name) });
      }

      const now = Date.now();
      const due = dueJobs(jobs, { nowMs: now, startedMs, lastRunMs });

      // 每 tick 的派发计划（X 批 P0-1）：重任务槽被占只挡重任务，轻任务照常发。
      const plan = planTick({ due, heavySlot, running, lightMax });

      // 1) 轻任务：非阻塞并行发射（上限 lightMax）。heat/steam-prices 等长任务运行时它们照常跑，
      //    不会出现"steam-prices 90 分钟饿死杉果/提醒"这类排队。
      for (const job of plan.light) {
        if (stopping) break;
        launch(job, now);
      }

      // 2) Steam 重任务：非阻塞发射 + 全局单槽（heavySlot 被占时本 tick 不再派发新的）。
      for (const job of plan.heavy) {
        if (stopping) break;
        if (heavySlot) {
          // AC5：被正在跑的重任务占槽——只在进入排队时记一次，面板可看到占用者与等待时长
          if (!waitingSince.has(job.name)) {
            waitingSince.set(job.name, { at: now, occupiedBy: heavySlot });
            logger.info('scheduler.job_wait_slot', { job: job.name, occupiedBy: heavySlot });
          }
          break;
        }

        // 后台手动回填/同步也写 sync_runs；让 Steam 重任务等它结束再执行，避免并行冲击 Steam。
        const activeSync = await db.runningSyncRun(q).catch(() => null);
        if (activeSync) {
          if (!waitingSince.has(job.name)) {
            waitingSince.set(job.name, { at: now, occupiedBy: activeSync.mode });
            logger.info('scheduler.job_wait_slot', { job: job.name, occupiedBy: activeSync.mode, runId: activeSync.id });
          }
          logger.info('scheduler.job_deferred_busy', { job: job.name, runId: activeSync.id, mode: activeSync.mode });
          continue;
        }

        const state = health.get(job.name) ?? { failures: 0, openUntil: null };
        if (isCircuited(state, now)) {
          // 熔断期内不再打目标站：持续 403 时继续重试只会更快被封
          waitingSince.delete(job.name);
          logger.warn('scheduler.circuit_skip', {
            job: job.name,
            failures: state.failures,
            openUntil: new Date(state.openUntil).toISOString(),
          });
          lastRunMs.set(job.name, now);
          continue;
        }

        launchHeavy(job);
      }
      if (stopping) break;
      // P2（X 批）：状态文件每个 tick 都写一次，updatedAt 才能反映调度器存活
      // （此前只在启动与任务完成时写，长任务运行期间看起来像卡死）。
      writeStatusFile(jobs, { lastRunMs, health, running, tickMs: TICK_MS, lastOutcome, waitingSince });
      await sleepInterruptible(TICK_MS);
    }

    logger.info('scheduler.exit', {});
  } finally {
    await store.close().catch(() => {});
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;if (invokedDirectly) {
  main().catch((err) => {
    const logger = createLogger({ prefix: 'scheduler' });
    logger.fatal('scheduler.crash', { err: serializeError(err) });
    process.exit(1);
  });
}
