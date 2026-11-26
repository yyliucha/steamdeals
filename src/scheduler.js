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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createLogger, serializeError, failFields } from './log.js';
import { hasNotifier, deliver, jobFailureEmailChannel, buildJobFailureMail } from './notify.js';
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

// FP 批 P2（docs/SYNC-HARDENING.md §2）：steam-status 每轮默认上限 20000（与 settings.steamStatus.limit 默认一致）。
// 预算机制判定「显式配置」时拿它作基准：env/设置页保存过非默认值 → 尊重用户配置不自动缩量。
export const STEAM_STATUS_LIMIT_DEFAULT = 20000;

// FJ 批（docs/SYNC-JOB-GROUPS.md）：同步服务合并为 12 个任务组——后台不再显示 25 行碎片，
// 而是组行 + 展开子步骤。组只是调度层：组内到期子步骤按声明顺序（= 优先级）串行执行，
// 子步骤仍按原 mode 写 sync_runs（历史/告警/健康面板/熔断恢复不变）。steam-claim 移出定时，
// 改后台「Steam 账号」组手动按钮触发（steamClaimArgs 取参数，未配置时返回 null）。
export const JOB_GROUPS = [
  { name: 'steam-prices', label: 'Steam 价格', steps: ['steam-prices'] },
  { name: 'steam-meta', label: 'Steam 元数据', steps: ['steam-status', 'rating-backfill', 'explicit-backfill', 'backfill', 'rename'] },
  { name: 'multi-platform', label: '多平台报价', steps: ['sonkwo', 'itad', 'gog', 'humble'] },
  { name: 'catalog-discovery', label: '目录与发现', steps: ['catalog', 'steam-discovery', 'discover'] },
  { name: 'images', label: '图片同步', steps: ['images', 'images-backfill'] },
  { name: 'index', label: '索引维护', steps: ['readmodel', 'search-tokens-rebuild'] },
  { name: 'system', label: '系统维护', steps: ['prune', 'logs'] },
  { name: 'steam-accounts', label: 'Steam 账号', steps: ['steam-accounts'] },
  { name: 'heat', label: '热度回填', steps: ['heat'] },
  { name: 'app-release', label: 'App 版本同步', steps: ['app-release-sync'] },
  { name: 'align-snapshot', label: '对齐快照', steps: ['align-snapshot'] },
  { name: 'proxy-alerts', label: '代理与提醒', steps: ['proxy-probe', 'alerts', 'report'] },
];

export function jobsFromEnv(env = process.env) {
  const flat = [
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
      // EU-2（docs/SCHEDULER-RESTART-RESILIENCE.md）：--batch 每轮只处理一批（默认 5000 ≈ 4–5 分钟），
      // 批间落断点，发版重启打断后下一轮从断点续跑，不再整轮 106 分钟重跑。
      args: [
        'sync',
        'steam-prices',
        '--limit',
        String(num(env.STEAM_PRICE_LIMIT, 200000)),
        '--batch',
        String(num(env.STEAM_PRICE_BATCH, 5000)),
      ],
      intervalMin: num(env.STEAM_PRICE_INTERVAL_MIN, 1440),
      initialDelaySec: num(env.STEAM_INITIAL_DELAY_SEC, 600),
      enabled: env.STEAM_ENABLED !== '0',
    },
    {
      name: 'heat',
      // FW 批（docs/SLOW-SYNC.md §1.1/§6.1）：热度回填低频化——每轮 100 款（轮内 1.7s/款 ≈ 2.8 分钟）、
      // 间隔 10 分钟（轮间静默 ≈ 7 分钟），首轮延迟仍 3600 秒（首轮自动全量播种，heat_at 为 null 都选中）。
      // 之后只刷"过期 30 天且有报价"的条目（见 cli-ops-repository 的 listHeatCandidates）：
      // 20 万目录按 100 款/10 分钟 ≈ 1.44 万/天 ≈ 14 天播种完，稳态 30 天一轮只需 ≈6,533 款/天。
      // appdetails 批量只接受 price_overview，热度必须逐 appid 请求（约 1.7s/款）。
      args: ['heat', '--limit', String(num(env.STEAM_HEAT_LIMIT, 100)), '--sleep', '1700'],
      intervalMin: num(env.STEAM_HEAT_INTERVAL_MIN, 10),
      initialDelaySec: num(env.STEAM_HEAT_INITIAL_DELAY_SEC, 3600),
      enabled: env.STEAM_ENABLED !== '0',
    },
    {
      name: 'steam-status',
      // 每天判定一次 Steam 同步状态 + 内容分级（docs/STEAM-SYNC-STATUS-AND-RATING.md）：
      // 逐 appid 全量 appdetails（EH/EI 批 §10/§11：内容区 cc=contentRegion，默认 us；失败补 cc=hk），
      // 状态与分级共用同一次请求；免费已由迁移一次性置位；steam_checked_at 作续跑游标，失败不写游标下轮重试；
      // 归入 STEAM_HEAVY 与价格/热度/回填互斥串行；每款平均 2 请求。
      // FP 批（docs/SYNC-HARDENING.md §2 P2）：默认上限 6000 → 20000（20 万目录约 10 天一轮，env 可配 3–5 万）。
      args: ['steam-status', '--limit', String(num(env.STEAM_STATUS_LIMIT, STEAM_STATUS_LIMIT_DEFAULT)), '--rate', String(num(env.STEAM_STATUS_RATE_MS, 1500))],
      intervalMin: num(env.STEAM_STATUS_INTERVAL_MIN, 1440),
      initialDelaySec: num(env.STEAM_STATUS_INITIAL_DELAY_SEC, 600),
      enabled: env.STEAM_ENABLED !== '0',
    },
    {
      name: 'steam-discovery',
      // CH 批（docs/DISCOVERY-FOR-YOU.md §6）：翻页采集 Deck 认证 + 好评率（search/results，
      // 与 appdetails 同域共享 200 次/5 分钟配额 → 归入 STEAM_HEAVY 互斥串行）。
      // FW 批（docs/SLOW-SYNC.md §1.1/§2.2）：10 页 ×50 款 + 10 条名称回退、30 分钟一轮（≈24 秒）；
      // 页游标落 app_meta（discovery.page_cursor），只进不退，翻到尽头才重置为 1（断点续跑）。
      args: ['steam-discovery', '--pages', String(num(env.STEAM_DISCOVERY_PAGES, 10)), '--fallback', String(num(env.STEAM_DISCOVERY_FALLBACK_LIMIT, 10))],
      intervalMin: num(env.STEAM_DISCOVERY_INTERVAL_MIN, 30),
      initialDelaySec: num(env.STEAM_DISCOVERY_INITIAL_DELAY_SEC, 1800),
      enabled: env.STEAM_ENABLED !== '0' && env.STEAM_DISCOVERY_ENABLED !== '0',
    },
    {
      name: 'app-release-sync',
      // CJ 批（docs/APP-AUTO-UPDATE-PAGE.md §4）：同步 App Release 到本地（轻任务，不进 STEAM_HEAVY；GitHub API 每轮 1 次调用）
      // DR 批（docs/APP-INSTANT-UPDATE.md §3.1）：默认 60→15 分钟；settings app.syncIntervalMin 可改（DB 热加载，
      // env APP_RELEASE_SYNC_INTERVAL_MIN 兜底——水合后本处读到的已是 DB 值，保存设置后任务表重建生效）。
      args: ['app-sync'],
      intervalMin: num(env.APP_RELEASE_SYNC_INTERVAL_MIN, 15),
      initialDelaySec: num(env.APP_RELEASE_SYNC_INITIAL_DELAY_SEC, 300),
      enabled: env.APP_RELEASE_SYNC_ENABLED !== '0',
    },
    {
      name: 'align-snapshot',
      // DL 批（docs/ALIGN-SNAPSHOT.md §5）：对齐审核快照后台生成——每轮算数据签名，与最新快照
      // 不同（或超 24h）才重算写库；失败写快照 error + sync_runs 原因（任务健康条红标）。
      // 首轮延迟 30 秒：部署后空表兜底生成，前台首次进入不再长时间「生成中」。
      args: ['align-snapshot'],
      intervalMin: num(env.ALIGN_SNAPSHOT_INTERVAL_MIN, 30),
      initialDelaySec: num(env.ALIGN_SNAPSHOT_INITIAL_DELAY_SEC, 30),
      enabled: env.ALIGN_SNAPSHOT_ENABLED !== '0',
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
      name: 'rating-backfill',
      // EF 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9）：每天回填一批内容分级（EI 批 §11：
      // 内容区 cc=contentRegion，默认 us——国区商店隐藏成人内容 → adult_flag 全库仅约 20 个）。
      // 与价格/热度/回填共用 200 次/5 分钟配额 → STEAM_HEAVY 互斥串行；候选自带收敛
      // （required_age 已采到即不再选），全量播完后日常增量由 steam-status 维护。429 收轮 exit 75，1 小时后自动重排续跑。
      // FP 批（docs/SYNC-HARDENING.md §2 P2）：默认上限 5000 → 20000（env 可配）。
      args: ['rating-backfill', '--limit', String(num(env.STEAM_RATING_BACKFILL_LIMIT, 20000)), '--batch', '30', '--rate', String(num(env.STEAM_RATING_BACKFILL_RATE_MS, 1500))],
      intervalMin: num(env.STEAM_RATING_BACKFILL_INTERVAL_MIN, 1440),
      initialDelaySec: num(env.STEAM_RATING_BACKFILL_INITIAL_DELAY_SEC, 14400),
      enabled: env.STEAM_ENABLED !== '0',
    },
    {
      name: 'explicit-backfill',
      // FT 批（docs/EXPLICIT-RATING.md §2.2）：色情游戏（严格分级）存量回填——候选 =
      // adult_flag=true 且 explicit_flag=false（存量约 4759 个，约 2 小时/轮）；1 天冷却断点续跑，
      // explicit=true 退出候选收敛。以存量回填为主、手动「立即运行」触发，默认 7 天兜底重扫一次
      // （冷却 1 天，7 天间隔下每轮重扫存量、可捕捉 descriptor 变更）；STEAM_HEAVY 互斥串行。
      args: ['explicit-backfill', '--limit', String(num(env.STEAM_EXPLICIT_BACKFILL_LIMIT, 5000)), '--batch', '30', '--rate', String(num(env.STEAM_EXPLICIT_BACKFILL_RATE_MS, 1500))],
      intervalMin: num(env.STEAM_EXPLICIT_BACKFILL_INTERVAL_MIN, 10080),
      initialDelaySec: num(env.STEAM_EXPLICIT_BACKFILL_INITIAL_DELAY_SEC, 21600),
      enabled: env.STEAM_ENABLED !== '0',
    },
    {
      name: 'backfill',
      // 每天增量回填（BL-1，docs/BACKFILL-THROUGHPUT.md §3.1）：给目录里新进的游戏补元数据/说明/价格
      // （GetItems + appdetails 回退）。选择条件自带收敛（有说明+报价的跳过），没活时秒退；
      // 与其它 Steam 任务串行不抢限流。BL-1：每周 → 每天、上限 5 万 → 5000（稳态小步收敛）。
      // FP 批（docs/SYNC-HARDENING.md §2 P2）：默认上限 5000 → 20000（env 可配）。
      args: ['backfill', '--limit', String(num(env.STEAM_BACKFILL_LIMIT, 20000)), '--batch', '100', '--sleep', '3000'],
      intervalMin: num(env.STEAM_BACKFILL_INTERVAL_MIN, 1440),
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
    // FJ 批：steam-claim 已移出定时任务——后台「Steam 账号」组的手动按钮触发（steamClaimArgs 取参数）。
    {
      name: 'prune',
      // 每周清理：访问记录 180 天、采集/任务记录 90 天、验证码 7 天
      args: ['prune'],
      intervalMin: num(env.PRUNE_INTERVAL_MIN, 10080),
      initialDelaySec: 43200,
      enabled: env.PRUNE_ENABLED !== '0',
    },
    {
      name: 'proxy-probe',
      // BB 批（docs/PROXY-POOL.md §11.4）：每 10 分钟 CONNECT 探测代理池一次；只做协议层 CONNECT，
      // 不请求 Steam 业务接口（不占配额），探测失败不写业务冷却（避免误杀），结果落 health 文件 probe* 字段。
      args: ['probe', '--proxy'],
      intervalMin: num(env.PROXY_PROBE_INTERVAL_MIN, 10),
      initialDelaySec: num(env.PROXY_PROBE_INITIAL_DELAY_SEC, 120),
      enabled: env.PROXY_PROBE_ENABLED !== '0',
    },
    {
      name: 'readmodel',
      // AV 批（docs/READ-MODEL.md §8）：每日抽样对账 200 个 (game,region)。
      // B5 批（docs/DESIGN-AUDIT.md B5 行）：每日任务带 --fix 自动修复——快照是纯派生数据、
      // 修复走 refresh* 唯一写入路径（口径与对账一致、幂等），自动修复把「列表价与详情不一致」
      // 的窗口上限压到 24 小时；变更优先增量校验优先扫「底层比快照新」的疑似陈旧行。
      // 发现差异仍记 readmodel.check（diffs/fixed 字段），修复不静默；手动 check 默认仍只报告不修。
      args: ['readmodel', 'check', '--sample', String(num(env.READMODEL_SAMPLE, 200)), '--fix'],
      intervalMin: num(env.READMODEL_INTERVAL_MIN, 1440),
      initialDelaySec: num(env.READMODEL_INITIAL_DELAY_SEC, 3600),
      enabled: env.READMODEL_ENABLED !== '0',
    },
    {
      name: 'search-tokens-rebuild',
      // DS 批（docs/SEARCH-ALIASES.md §3）：增量重算派生搜索 token（search_tokens 为空/从未生成/
      // 名字在生成后被改过的行）；轻任务（纯本地计算、无 Steam 请求），每 6 小时一轮、
      // 每轮上限 5 万行——迁移后存量约 19.8 万行首轮铺满约 1 天，此后每轮秒退。--full 全量重建走 CLI。
      args: ['search-tokens', '--limit', String(num(env.SEARCH_TOKENS_LIMIT, 50000))],
      intervalMin: num(env.SEARCH_TOKENS_INTERVAL_MIN, 360),
      initialDelaySec: num(env.SEARCH_TOKENS_INITIAL_DELAY_SEC, 900),
      enabled: env.SEARCH_TOKENS_ENABLED !== '0',
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
    // FR 批（docs/BACKUP-AS-FEATURE.md §2.1）：backup 已移出调度任务——不再定时自动跑、
    // 不再走 CLI 自动链路，改为后台「统计 → 图片与备份」手动功能（POST /api/admin/backup）。
    // HEAVY_MAINT / 低峰窗口仍保留 backup 名字：手动触发经 runSyncTracked 的备份照旧走 maint 槽。
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
        String(num(env.IMAGES_LIMIT, 500)),
        '--sleep',
        String(num(env.IMAGES_SLEEP_MS, 300)),
      ],
      intervalMin: num(env.IMAGES_INTERVAL_MIN, 240),
      initialDelaySec: num(env.IMAGES_INITIAL_DELAY_SEC, 1200),
      enabled: env.IMAGES_ENABLED !== '0',
    },
    {
      name: 'images-backfill',
      // EC 批（docs/IMAGE-COVERAGE.md §8 EC-2）：缺图回填——header_image 为空的游戏逐 appid
      // 重同步元数据补封面（限速 ≥1s/请求防 429）；补完即收敛，缺图数逐轮下降。
      args: [
        'images',
        'backfill',
        '--limit',
        String(num(env.IMAGES_BACKFILL_LIMIT, 100)),
        '--sleep',
        String(num(env.IMAGES_BACKFILL_SLEEP_MS, 1200)),
      ],
      intervalMin: num(env.IMAGES_BACKFILL_INTERVAL_MIN, 360),
      initialDelaySec: num(env.IMAGES_BACKFILL_INITIAL_DELAY_SEC, 1800),
      enabled: env.IMAGES_BACKFILL_ENABLED !== '0',
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
  // FJ 批：按 JOB_GROUPS 的组顺序与组内优先级重排（组只是调度层，子步骤原 mode 不变），
  // 每个 job 带上 group 字段供组串行调度/状态文件/后台组行使用。
  const byName = new Map(flat.map((j) => [j.name, j]));
  return JOB_GROUPS.flatMap((g) => g.steps.map((name) => byName.get(name)).filter(Boolean).map((j) => ({ ...j, group: g.name })));
}

/** FJ 批：把带 group 字段的扁平 jobs 按 JOB_GROUPS 聚合回组结构（含 label，供状态文件 groups 字段）。 */
export function groupsFromJobs(jobs) {
  return JOB_GROUPS.map((g) => ({ name: g.name, label: g.label, steps: (jobs ?? []).filter((j) => j.group === g.name) }));
}

/** FJ 批：按 env 构建 12 个任务组（steps 只含启用且间隔 >0 的子步骤）。 */
export function jobGroupsFromEnv(env = process.env) {
  return groupsFromJobs(jobsFromEnv(env));
}

/** FJ 批：steam-claim 手动按钮的命令参数；未配置用户名/SteamID 返回 null（按钮提示未配置）。 */
export function steamClaimArgs(env = process.env) {
  const username = String(env.STEAM_CLAIM_USERNAME ?? '').trim();
  const steamId = String(env.STEAM_CLAIM_STEAM_ID ?? '').trim();
  if (!username || !steamId) return null;
  return ['steam-claim', username, steamId];
}

/** 熔断参数：连续失败 threshold 次后，暂停该任务 cooldownMs。 */
export const CIRCUIT = { threshold: 3, cooldownMs: 6 * 3600_000 };

// AC-4/AC2（docs/SYNC-FAILURE-MODES.md AC2）：熔断手动重置——scheduler.start 注册钩子，
// /api/admin/circuit/reset 通过 resetCircuit 触发（scheduler 与 web 同进程时生效）。
const circuitResetHooks = new Set();
export function registerCircuitReset(fn) {
  circuitResetHooks.add(fn);
  return () => circuitResetHooks.delete(fn);
}
export function resetCircuit(name) {
  let handled = false;
  for (const fn of circuitResetHooks) handled = fn(name) || handled;
  return handled;
}

/** 记录一次任务结果，返回新的健康状态。纯函数，便于单测。 */
export function recordJobResult(state, { code, nowMs, threshold = CIRCUIT.threshold, cooldownMs = CIRCUIT.cooldownMs }) {
  if (code === 0) return { failures: 0, openUntil: null, opened: false };
  // BL-2（docs/BACKFILL-THROUGHPUT.md §3.2）：75 = 429/403 软退出（partial）——本轮已保留进度，
  // 不算失败：failures 不变、不累计、不触发熔断。
  if (code === 75) return { failures: state?.failures ?? 0, openUntil: state?.openUntil ?? null, opened: false };
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

// ---------------------------------------------------------------- CO-1 A5：任务失败可见（docs/DESIGN-AUDIT.md A5）

/**
 * 任务对应的 sync_runs mode：sync 系子命令的 mode 是第二个参数（`sync steam-prices` → steam-prices），
 * 其余命令的 mode 就是命令本身（`app-sync` / `heat` / `probe`…）。调度器按它取最近失败原因。
 */
export function syncRunModeFor(job) {
  const args = Array.isArray(job?.args) ? job.args : [];
  return args[0] === 'sync' ? String(args[1] ?? '') : String(args[0] ?? job?.name ?? '');
}

/**
 * 任务失败原因的最终取值：优先 sync_runs 里的真实原因（runSyncTracked 写的 err.message），
 * 取不到回退退出码；75（429/403 软退出）保持原有 partial 文案；成功为 null。
 */
export function jobFailureError(code, runReason) {
  if (code === 0) return null;
  if (code === 75) return 'HTTP 429/403 提前收尾（进度已保留，1 小时后重排）';
  return String(runReason || `exit code ${code}`);
}

/**
 * E4 批（docs/LOGGING-SCHEMA.md §4）：`scheduler.job_failed` 的 reason 稳定短码。
 * 75 = 429/403 软退出；其余优先用 sync_runs 里的真实原因（截断），取不到回退 `exit_<code>`。
 */
export function jobFailedReason(code, runReason) {
  if (code === 75) return 'http_429_soft_exit';
  return String(runReason || `exit_${code}`).slice(0, 160);
}

/**
 * EU-1（docs/SCHEDULER-RESTART-RESILIENCE.md）：任务收尾结果判定（纯函数）。
 * 停机过程中非零退出 = 被重启打断 → interrupted：不记 failed、不发失败邮件、不进熔断计数；
 * 停机瞬间恰好正常退出（code 0）仍记 ok，不算中断。
 */
export function outcomeFor(code, runReason, stopping = false) {
  if (stopping && code !== 0) {
    return { result: 'interrupted', error: '服务重启，任务被中断' };
  }
  if (code === 0) return { result: 'ok', error: null };
  // BL-2：75 = 429/403 软退出 → partial（不记失败、不熔断）
  if (code === 75) return { result: 'partial', error: jobFailureError(75, null) };
  return { result: 'failed', error: jobFailureError(code, runReason) };
}

// ---------------------------------------------------------------- BL-2：429 软退出后的 1 小时重排（docs/BACKFILL-THROUGHPUT.md §3.2）

export const retryFilePath = () => process.env.SCHEDULER_RETRY_FILE ?? 'data/scheduler-retry.json';

/** 读重排状态 { job: { at, streak, reason } }；缺失/损坏返回 {}。 */
export function readRetryState() {
  try {
    const parsed = JSON.parse(readFileSync(retryFilePath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 写重排状态（原子：tmp + rename）。 */
export function writeRetryState(state = {}) {
  try {
    mkdirSync(dirname(retryFilePath()), { recursive: true });
    writeFileSync(retryFilePath(), JSON.stringify(state, null, 2));
  } catch {
    /* 写失败不影响调度 */
  }
}

/**
 * 更新重排状态（纯函数）：
 * - code 0（成功）→ 清掉该任务的重排与连击；
 * - code 75（partial）→ at = now + 60 分钟、streak + 1；连续 3 次 partial → 清掉重排（等正常日轮，避免整夜刷 429）；
 * - 其它失败 → 不动。
 */
export function applyRetry(state = {}, { job, code, nowMs }) {
  const next = { ...state };
  if (code === 0) {
    delete next[job];
    return next;
  }
  if (code === 75) {
    const cur = next[job] ?? {};
    const streak = Number(cur.streak ?? 0) + 1;
    if (streak >= 3) {
      delete next[job];
    } else {
      next[job] = { at: new Date(nowMs + 60 * 60_000).toISOString(), streak, reason: 'http_429' };
    }
  }
  return next;
}

// 采集类任务成功后需要刷新静态页的，列在这里（backfill 会写新报价，也要重建）
const SYNC_LIKE = new Set(['steam', 'sonkwo', 'itad', 'gog', 'humble', 'discover', 'rename', 'backfill']);

// Steam 重任务：与后台手动同步/回填/热度共用配额与槽位，有手动任务在跑时让路。
// 它们都打 store.steampowered.com/appdetails（200 次/5 分钟配额），必须串行互斥。
// steam-status 也在其中（X 批）：逐 appid 全量请求，与价格/热度/回填并列重任务槽。
export const STEAM_HEAVY = new Set(['steam-prices', 'rename', 'backfill', 'rating-backfill', 'explicit-backfill', 'heat', 'steam-status', 'steam-discovery', 'catalog']);

// FP 批（docs/SYNC-HARDENING.md §2 P1）：heavy 分两槽——heavySteam（价格/状态/回填/发现，STEAM_HEAVY）
// 与 heavyMaint（backup/prune/logs）互不影响，同一时刻各槽最多一个任务。
// backup/prune 额外受低峰窗口约束（maintWindow），logs 只占槽不限时段。
export const HEAVY_MAINT = new Set(['backup', 'prune', 'logs']);

/** FP 批：任务归属的 heavy 槽组名——maint（backup/prune/logs）或 steam（其余重任务）。 */
export function heavyGroupFor(name) {
  return HEAVY_MAINT.has(name) ? 'maint' : 'steam';
}

// 轻任务：目标站与配额都和重任务独立（杉果国内源、GOG/Humble catalog、提醒/图片），
// 允许在 heat/steam-prices 等长任务运行时并行执行——否则 heat 首轮播种 9 小时会饿死所有其它源。
// DL 批：align-snapshot 是本地库计算（不占外部配额），归轻任务受并行上限约束。
// FP 批：backup/logs 移出轻任务 → heavyMaint 独立槽（不再与价格/状态抢槽，也不受 lightMax 上限）。
const LIGHT_JOBS = new Set(['sonkwo', 'itad', 'gog', 'humble', 'discover', 'steam-accounts', 'alerts', 'images', 'images-backfill', 'align-snapshot']);

/** 轻任务并行上限（环境变量 SCHEDULER_LIGHT_CONCURRENCY 可调，默认 3，范围 1–8）。 */
export function lightConcurrency(env = process.env) {
  const n = Number(env.SCHEDULER_LIGHT_CONCURRENCY ?? 3);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 8) : 3;
}

/**
 * 每 tick 的派发计划（纯函数，便于回归测试，X 批 P0-1）：
 * - 重任务：heavySlot 非空或已在 running 时一个都不排（全局单槽，串行互斥）；
 * - 轻任务：**不受重任务槽影响**（steam-prices 跑 90 分钟期间 sonkwo/alerts 照常发），
 *   只受 running 去重与 lightMax 并行上限约束；非重非轻的任务（如 prune）不受上限约束（与旧行为一致）。
 * - FJ 批（docs/SYNC-JOB-GROUPS.md）：组内串行——传 `jobs`（带 group 字段）后，某组已有子步骤在跑
 *   （或本 tick 已选中一个）时，该组其它到期子步骤不派发；不传 jobs 则退化为旧行为（组不生效）。
 * - FP 批（docs/SYNC-HARDENING.md §2 P1）：传 `heavyGroups`（{ groupOf, busy:Set }）后 heavy 按槽组分槽——
 *   某槽组 busy 只挡该槽组的重任务，另一槽组照常派发；不传 = 旧单槽行为（heavySlot）。
 */
export function planTick({ due, heavySlot = null, running = new Set(), lightMax = 3, heavyJobs = STEAM_HEAVY, lightJobs = LIGHT_JOBS, jobs = null, heavyGroups = null }) {
  const light = [];
  const heavy = [];
  const groupOf = jobs ? new Map(jobs.map((j) => [j.name, j.group])) : null;
  const groupBusy = new Set();
  if (groupOf) {
    for (const name of running) {
      const g = groupOf.get(name);
      if (g) groupBusy.add(g);
    }
  }
  const lightRunning = [...running].filter((name) => lightJobs.has(name)).length;
  for (const job of due) {
    const g = groupOf?.get(job.name) ?? null;
    if (g && groupBusy.has(g)) continue;
    if (heavyJobs.has(job.name)) {
      // FP：分槽模式——只挡所属槽组 busy；旧单槽模式——heavySlot 非空即挡全部
      const hg = heavyGroups ? heavyGroups.groupOf(job.name) : null;
      const slotBusy = heavyGroups ? (hg ? heavyGroups.busy.has(hg) : false) : Boolean(heavySlot);
      if (!slotBusy && !running.has(job.name)) {
        heavy.push(job);
        if (g) groupBusy.add(g);
      }
      continue;
    }
    if (running.has(job.name)) continue;
    if (lightJobs.has(job.name) && light.length + lightRunning >= lightMax) continue;
    if (g) groupBusy.add(g);
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

// ---------------------------------------------------------------- FP 批：同步机制完善（docs/SYNC-HARDENING.md）

/** FP P0：僵尸运行阈值（小时）——env SYNC_STALE_RUN_HOURS，默认 2。 */
export function syncStaleRunHours(env = process.env) {
  return num(env.SYNC_STALE_RUN_HOURS, 2);
}

/**
 * FP P0：sync_runs 的 running 记录是否已是僵尸（超过 staleHours 小时还没结束）。
 * 纯函数：status 非 running / started_at 缺失或不可解析一律返回 false——不误杀正在跑或无法判定的记录。
 */
export function isStaleSyncRun(row, { nowMs = Date.now(), staleHours = 2 } = {}) {
  if (!row || row.status !== 'running') return false;
  if (row.started_at == null || row.started_at === '') return false;
  const ms = new Date(row.started_at).getTime();
  if (!Number.isFinite(ms)) return false;
  const hours = Number.isFinite(Number(staleHours)) && Number(staleHours) > 0 ? Number(staleHours) : 2;
  return nowMs - ms > hours * 3600_000;
}

/**
 * FP P1：backup/prune 低峰窗口（默认 03:00–05:00，env 可配）。
 * SYNC_MAINT_WINDOW_START_HOUR / SYNC_MAINT_WINDOW_END_HOUR（0–23）；时区 SYNC_MAINT_WINDOW_TZ（IANA，默认 Asia/Shanghai）。
 * startHour > endHour 视为跨零点窗口（如 22–02）。
 */
export function maintWindow(env = process.env) {
  const hour = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 23 ? Math.trunc(n) : fallback;
  };
  return {
    startHour: hour(env.SYNC_MAINT_WINDOW_START_HOUR, 3),
    endHour: hour(env.SYNC_MAINT_WINDOW_END_HOUR, 5),
    tz: String(env.SYNC_MAINT_WINDOW_TZ ?? 'Asia/Shanghai'),
  };
}

/** FP P1：nowMs 是否落在低峰窗口内（按窗口时区取小时；时区非法回落 false，宁可晚发不误发）。 */
export function inMaintWindow(nowMs = Date.now(), win = maintWindow()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: win.tz, hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
    if (!Number.isFinite(h)) return false;
    return win.startHour <= win.endHour ? h >= win.startHour && h < win.endHour : h >= win.startHour || h < win.endHour;
  } catch {
    return false;
  }
}

/** FP P1：任务此刻能否派发——backup/prune 受低峰窗口约束，其余任务不受限。 */
export function inMaintWindowFor(name, nowMs = Date.now(), env = process.env) {
  if (name !== 'backup' && name !== 'prune') return true;
  return inMaintWindow(nowMs, maintWindow(env));
}

// ---------------------------------------------------------------- FP 批 P0：403 告警口径（docs/SYNC-HARDENING.md §4.3）

/** FP P0：discovery 类非核心任务——403 只日志、不发失败邮件。 */
export const DISCOVERY_JOBS = new Set(['steam-discovery', 'discover']);

/** FP P0：失败原因是否 403 类（sync_runs 里的 err.message，如「Steam 返回 HTTP 403…」）。纯函数。 */
export function is403Failure(reason) {
  return /403/.test(String(reason ?? ''));
}

/**
 * FP P0：403 连续失败是否该告警——连续 ≥3 次才发失败邮件（单次 403 是风控常态，不刷屏）；
 * discovery 类任务任何次数都不告警（仅日志）。纯函数。
 */
export function shouldAlert403(jobName, streak, { threshold = 3, discoveryJobs = DISCOVERY_JOBS } = {}) {
  if (discoveryJobs.has(jobName)) return false;
  return Number(streak ?? 0) >= threshold;
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
export function dueJobs(jobs, { nowMs, startedMs, lastRunMs, retry = null }) {
  return jobs.filter((job) => {
    const last = lastRunMs.get(job.name);
    const nextAt = last == null ? startedMs + job.initialDelaySec * 1000 : last + job.intervalMin * 60_000;
    if (nowMs >= nextAt) return true;
    // BL-2：429 软退出后的 1 小时重排——正常到期之外，重排时间到了也算 due（仍受重任务单槽互斥）
    const at = retry?.[job.name]?.at ?? null;
    return Boolean(at && Date.parse(at) <= nowMs);
  });
}

export function describeSchedule(jobs) {
  return jobs.map((j) => `${j.name} 每 ${j.intervalMin} 分钟（首轮 ${j.initialDelaySec}s 后）`).join('；');
}

// ---------------------------------------------------------------- AC-4：每日 Steam 配额预算

/** AC-4 的五个 Steam 重任务 mode 列表（B3 批共用：预算/任务卡估算只覆盖这五个；EF 批加 rating-backfill）。 */
export const STEAM_BUDGET_MODES = ['steam-prices', 'heat', 'steam-status', 'backfill', 'rating-backfill', 'explicit-backfill'];

/**
 * AC-4 单轮理论耗时（秒）——口径与任务实现一致：
 *  - steam-prices：每 30 款一批约 1.1s（batchSize=30/rateLimitMs=1100，cmd 内固定）；
 *  - heat：每款约 1.7s（scheduler 里 --sleep 1700 固定）；FW 批每轮默认 100 款（100×1.7s ≈ 2.8 分钟/轮）。
 *  - steam-status：每款平均 2 次请求 × rate；
 *  - backfill：每 100 款一批 GetItems 间隔 3s + 每批最多 10 个单条回退（各 0.4s）；
 *  - rating-backfill（EF 批）：每款 1 次请求 × rate（默认 1.5s）。
 *  - explicit-backfill（FT 批）：每款 1 次请求 × rate（默认 1.5s）。
 */
export function theoreticalRunSeconds(env = process.env) {
  const backfillLimit = num(env.STEAM_BACKFILL_LIMIT, 20000);
  return {
    'steam-prices': (num(env.STEAM_PRICE_LIMIT, 200000) / 30) * 1.1,
    heat: num(env.STEAM_HEAT_LIMIT, 100) * 1.7,
    'steam-status': num(env.STEAM_STATUS_LIMIT, 20000) * 2 * (num(env.STEAM_STATUS_RATE_MS, 1500) / 1000),
    backfill: (backfillLimit / 100) * 3 + (backfillLimit / 100) * 10 * 0.4,
    'rating-backfill': num(env.STEAM_RATING_BACKFILL_LIMIT, 20000) * (num(env.STEAM_RATING_BACKFILL_RATE_MS, 1500) / 1000),
    'explicit-backfill': num(env.STEAM_EXPLICIT_BACKFILL_LIMIT, 5000) * (num(env.STEAM_EXPLICIT_BACKFILL_RATE_MS, 1500) / 1000),
  };
}

/**
 * AC-4（docs/SYNC-FAILURE-MODES.md AC4）：四任务的每日串行总时长估算（分钟）。
 * B3 批（docs/DESIGN-AUDIT.md B3）：预算改**实测耗时**——observed（sync_runs 成功运行平均秒，
 * `db.observedSyncRunSeconds`）优先，样本不足的 mode 回落理论值。
 * 每 mode 每日轮数 = 1440 / intervalMin（intervalMin 至少按 1 分钟折算，防止 0 除）。
 */
export function steamDailyBudgetMinutes(env = process.env, observed = null) {
  const theo = theoreticalRunSeconds(env);
  const perDay = (intervalMin) => 1440 / Math.max(1, intervalMin);
  const runsPerDay = {
    'steam-prices': perDay(num(env.STEAM_PRICE_INTERVAL_MIN, 1440)),
    heat: perDay(num(env.STEAM_HEAT_INTERVAL_MIN, 10)),
    'steam-status': perDay(num(env.STEAM_STATUS_INTERVAL_MIN, 1440)),
    backfill: perDay(num(env.STEAM_BACKFILL_INTERVAL_MIN, 1440)),
    'rating-backfill': perDay(num(env.STEAM_RATING_BACKFILL_INTERVAL_MIN, 1440)),
    'explicit-backfill': perDay(num(env.STEAM_EXPLICIT_BACKFILL_INTERVAL_MIN, 10080)),
  };
  const secOf = (mode) => {
    const obs = observed?.get?.(mode);
    return obs != null && Number.isFinite(obs) && obs > 0 ? Number(obs) : theo[mode];
  };
  const priceMin = (secOf('steam-prices') * runsPerDay['steam-prices']) / 60;
  const heatMin = (secOf('heat') * runsPerDay.heat) / 60;
  const statusMin = (secOf('steam-status') * runsPerDay['steam-status']) / 60;
  const backfillRoundMin = secOf('backfill') / 60;
  const backfillDailyMin = (secOf('backfill') * runsPerDay.backfill) / 60;
  const ratingBackfillDailyMin = (secOf('rating-backfill') * runsPerDay['rating-backfill']) / 60;
  const explicitBackfillDailyMin = (secOf('explicit-backfill') * runsPerDay['explicit-backfill']) / 60;
  return {
    priceMin,
    heatMin,
    statusMin,
    backfillRoundMin,
    backfillDailyMin,
    ratingBackfillDailyMin,
    explicitBackfillDailyMin,
    total: priceMin + heatMin + statusMin + backfillDailyMin + ratingBackfillDailyMin + explicitBackfillDailyMin,
  };
}

/**
 * B3 批：任务卡「实际 vs 估算」——四个 Steam 重任务的单轮耗时：
 * estSec = 理论估算（theoreticalRunSeconds），obsSec = sync_runs 实测平均（没有样本为 null）。
 * 返回 Map(jobName → { estSec, obsSec })。
 */
export function jobRuntimeEstimates(jobs, env = process.env, observed = null) {
  const theo = theoreticalRunSeconds(env);
  const map = new Map();
  for (const j of jobs ?? []) {
    const mode = syncRunModeFor(j);
    if (!(mode in theo)) continue;
    const obs = observed?.get?.(mode);
    map.set(j.name, { estSec: theo[mode], obsSec: obs != null && Number.isFinite(obs) && obs > 0 ? Number(obs) : null });
  }
  return map;
}

/**
 * AC-4：总时长超过 24 小时（1440 分钟）时自动降频——只缩 steam-status 的每日限额
 * （唯一可调的大项），把总量压回预算内并记 `scheduler.budget_exceeded` 告警。
 * B3 批：observed（sync_runs 实测平均秒）参与预算；缩量每款速率同样优先用实测折算（有实测按实测/限额，无实测按理论 2×rate）。
 * FP 批 P2（docs/SYNC-HARDENING.md §2）：`explicitSteamStatusLimit=true` 时（部署 env/设置页显式配置过
 * STEAM_STATUS_LIMIT）尊重用户配置不自动缩量——否则提速验收「env 可配 3–5 万」会被预算机制吞掉；
 * 只有运行默认值（未显式配置）时才自动缩量保护串行槽。返回 { jobs, budget, adjusted }，jobs 是调整后的副本。
 */
export function applySteamBudget(jobs, env = process.env, logger = null, observed = null, { explicitSteamStatusLimit = false } = {}) {
  const budget = steamDailyBudgetMinutes(env, observed);
  if (budget.total <= 1440) return { jobs, budget, adjusted: false };
  if (explicitSteamStatusLimit) {
    logger?.info?.('scheduler.budget_skipped', {
      totalMin: Math.round(budget.total),
      targetMin: 1440,
      message: 'STEAM_STATUS_LIMIT 为显式配置（env/设置页），尊重用户配置不自动缩量',
    });
    return { jobs, budget, adjusted: false };
  }
  const others = budget.priceMin + budget.heatMin + budget.backfillDailyMin + budget.ratingBackfillDailyMin + budget.explicitBackfillDailyMin;
  const statusTargetMin = Math.max(120, 1440 - others); // 至少给 status 留 2 小时
  // B3 批：每款速率优先用实测（observed 平均秒 ÷ 当前限额），没有实测才用理论 2×rate
  const statusLimit = num(env.STEAM_STATUS_LIMIT, 20000);
  const obsStatus = observed?.get?.('steam-status');
  const statusPerGameMin =
    obsStatus != null && Number.isFinite(obsStatus) && obsStatus > 0
      ? obsStatus / Math.max(1, statusLimit) / 60
      : 2 * (num(env.STEAM_STATUS_RATE_MS, 1500) / 60000);
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
    source: observed && observed.size ? 'observed' : 'theoretical', // B3 批：标注预算来源（无实测样本回落理论）
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
    ['rating-backfill', 'STEAM_ENABLED'],
    ['explicit-backfill', 'STEAM_ENABLED'],
    ['backfill', 'STEAM_ENABLED'],
    ['sonkwo', 'SONKWO_ENABLED'],
    ['itad', 'ITAD_ENABLED'],
    ['gog', 'GOG_ENABLED'],
    ['humble', 'HUMBLE_ENABLED'],
    ['discover', 'DISCOVER_ENABLED'],
    ['prune', 'PRUNE_ENABLED'],
    ['logs', 'LOGS_PRUNE_ENABLED'],
    ['alerts', 'ALERTS_ENABLED'],
    ['images', 'IMAGES_ENABLED'],
    ['images-backfill', 'IMAGES_BACKFILL_ENABLED'],
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
export function writeStatusFile(jobs, { lastRunMs, health, running, tickMs = 60000, lastOutcome = null, waitingSince = null, retry = null, estimates = null, groups = null, file = process.env.SCHEDULER_STATUS_FILE || 'data/scheduler-status.json' } = {}) {
  try {
    const now = Date.now();
    // FJ 批：单行状态构造复用——jobs 与 groups[].steps 用同一口径（group 字段随行输出）
    const row = (j) => {
      const last = lastRunMs?.get?.(j.name) ?? null;
      const h = health?.get?.(j.name) ?? {};
      const outcome = lastOutcome?.get?.(j.name) ?? null;
      const waiting = waitingSince?.get?.(j.name) ?? null;
      return {
        name: j.name,
        group: j.group ?? null,
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
        // BL-2：429 软退出后的重排时间（后台「状态」列显示重试于 HH:mm）
        retryAt: retry?.[j.name]?.at ?? null,
        // B3 批（docs/DESIGN-AUDIT.md B3）：单轮耗时估算（理论）与实测（sync_runs 平均秒）——任务卡显示实际与估算差
        estimate: estimates?.get?.(j.name) ?? null,
      };
    };
    const payload = {
      updatedAt: new Date(now).toISOString(),
      tickMs,
      jobs: jobs.map(row),
      // FJ 批：12 组（组名/label/子步骤状态）——后台组行数据源；旧 jobs 字段保留（兼容）
      groups: groups ? groups.map((g) => ({ name: g.name, label: g.label, steps: g.steps.map(row) })) : undefined,
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

  // EU-5（docs/SCHEDULER-RESTART-RESILIENCE.md §EU-5）：排空（drain）——收到停机信号后不再打断在跑任务，
  // 等它们自然完成（默认 ≤10 分钟，SCHEDULER_DRAIN_TIMEOUT_MS 可调）；超时才 SIGTERM（+5s SIGKILL），
  // 被超时打断的任务按 EU-1 记「被重启中断」。发版按 EV §6 顺序走时任务零中断。
  const drainTimeoutMs = num(process.env.SCHEDULER_DRAIN_TIMEOUT_MS, 10 * 60_000);
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info('scheduler.stop', { signal, children: children.size, drainTimeoutMs, drain: 'wait for running jobs' });
    wake?.();
    // 主循环已因 stopping 退出、不再派发新任务；这里只挂一个排空超时定时器——
    // 在跑子进程的句柄会让进程继续存活，任务自然完成后进程才退出。
    const drainTimer = setTimeout(() => {
      if (children.size === 0) return;
      logger.warn('scheduler.drain_timeout', { signal, children: [...children.keys()], drainTimeoutMs, action: 'SIGTERM 剩余子进程（EU-1 interrupted）' });
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
    }, drainTimeoutMs);
    drainTimer.unref?.();
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
          // BL-2（docs/BACKFILL-THROUGHPUT.md §3.2）：回填不在请求里长睡——429 快速失败（exit 75），
          // 由调度器 1 小时后重排；冷却已由 http 层落盘共享。
          ...(job.name === 'backfill' ? { STEAM_429_RETRIES: '0' } : {}),
        },
        stdio: 'inherit',
      });
      children.set(job.name, child);
      child.on('error', (err) => {
        children.delete(job.name);
        logger.error('scheduler.job_spawn_failed', { job: job.name, ...failFields(err), err: serializeError(err) });
        resolve({ code: -1, spawnFailed: true });
      });
      child.on('exit', (code, signal) => {
        children.delete(job.name);
        const elapsedMs = Date.now() - startedAt;
        if (code === 0) logger.info('scheduler.job_done', { job: job.name, code, elapsedMs });
        // 失败/软退出的 error/warn 在 completeJob 里记（那里才拿得到 sync_runs 里的真实原因）
        else if (code === 75)
          logger.warn('scheduler.job_partial', {
            job: job.name,
            code,
            elapsedMs,
            reason: jobFailedReason(code, null),
            message: 'HTTP 429/403 软退出：本轮收尾，1 小时后重排',
          });
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
    // B3 批（docs/DESIGN-AUDIT.md B3）：预算与任务卡估算用 sync_runs 实测耗时（缺样本/查询失败回落理论值）
    const refreshObserved = async () => {
      try {
        return await db.observedSyncRunSeconds(q);
      } catch (err) {
        logger.warn('scheduler.observed_fetch_failed', { ...failFields(err), err: serializeError(err) });
        return new Map();
      }
    };
    let observed = await refreshObserved();
    // AC-4（docs/SYNC-FAILURE-MODES.md AC4）：每日 Steam 配额预算——超 24h 自动缩 steam-status 并告警。
    // FP 批 P2：STEAM_STATUS_LIMIT 为显式配置（env/设置页非默认值）时不自动缩量（尊重提速配置）。
    const statusLimitIsExplicit = String(process.env.STEAM_STATUS_LIMIT ?? '') !== String(STEAM_STATUS_LIMIT_DEFAULT);
    const budget = applySteamBudget(jobs, process.env, logger, observed, { explicitSteamStatusLimit: statusLimitIsExplicit });
    jobs = budget.jobs;
    let estimates = jobRuntimeEstimates(jobs, process.env, observed);
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
      logger.warn('scheduler.lastrun_restore_failed', { ...failFields(err), err: serializeError(err) });
    }

    // FP 批 P0（docs/SYNC-HARDENING.md §2）：启动清理僵尸 running——
    // 1) 超过 SYNC_STALE_RUN_HOURS（默认 2）的记录 = 僵尸，单独标记并记 scheduler.stale_run_interrupted；
    // 2) 剩余 running（上一进程非正常退出遗留）全部标记 interrupted（与 EU 批语义一致，不占 heavy slot）。
    try {
      const staleHours = syncStaleRunHours(process.env);
      const staleCount = await db.interruptStaleSyncRuns(q, { staleHours });
      if (staleCount > 0) {
        logger.warn('scheduler.stale_run_interrupted', { count: staleCount, staleHours, message: '僵尸 running 记录已标记 interrupted（不再占 heavy slot）' });
      }
      const restCount = await db.markStaleSyncRuns(q);
      if (restCount > 0) logger.info('scheduler.running_runs_interrupted', { count: restCount, reason: 'startup' });
    } catch (err) {
      logger.warn('scheduler.stale_cleanup_failed', { ...failFields(err), err: serializeError(err) });
    }
    const health = new Map(); // job.name -> { failures, openUntil }
    const http403Streak = new Map(); // FP P0：job.name -> 403 连续失败次数（≥3 才告警，成功/非 403 清零）
    // AC-4/AC2：熔断手动重置钩子（后台按钮 → resetCircuit → 清零该任务熔断）
    registerCircuitReset((name) => {
      const state = health.get(name);
      if (!state) return false;
      state.failures = 0;
      state.openUntil = null;
      logger.info('scheduler.circuit_reset_manual', { job: name });
      return true;
    });
    const running = new Set();
    const startedAt = new Map(); // job.name -> 本次启动毫秒（AC11 耗时）
    const lastOutcome = new Map(); // job.name -> { elapsedMs, result, error }（AC11 健康面板）
    const waitingSince = new Map(); // job.name -> { at, occupiedBy }（AC5 重任务排队可观测）
    // FP 批 P1：heavy 双槽（steam / maint）——backup/prune/logs 走 maint 槽，与价格/状态互不影响
    const heavySlots = { steam: null, maint: null };
    const lightMax = lightConcurrency(process.env);
    // BL-2：429 软退出后的 1 小时重排状态（data/scheduler-retry.json）
    let retryState = readRetryState();
    // chart 后续任务串行链：避免多个 chart 子进程并发写 out/
    let followUpChain = Promise.resolve();

    // 任务收尾（并行任务各自完成时调用）：记录时间/健康度、状态文件、串行触发后续 chart
    const completeJob = async (job, result) => {
      const { code, spawnFailed = false } = result ?? {};
      running.delete(job.name);
      lastRunMs.set(job.name, Date.now());
      const started = startedAt.get(job.name) ?? Date.now();
      startedAt.delete(job.name);
      // CO-1/A5：失败原因从 sync_runs 取（子进程退出前已落库），取不到回退退出码。
      // EU-4（docs/SCHEDULER-RESTART-RESILIENCE.md）：停机时不查——store 已 close，
      // 查询只会打出「Cannot use a pool」噪音（真失败原因已由子进程 SIGTERM 收尾写库）。
      let runReason = null;
      if (!stopping && code !== 0 && code !== 75) {
        try {
          runReason = await db.lastFailedSyncRun(q, syncRunModeFor(job));
        } catch (err) {
          logger.warn('scheduler.failure_reason_failed', { job: job.name, ...failFields(err), err: serializeError(err) });
        }
      }
      const outcome = {
        elapsedMs: Date.now() - started,
        // EU-1：stopping && code!==0 → interrupted（不告警、不熔断）；其余沿用 ok/partial/failed 口径
        ...outcomeFor(code, runReason, stopping),
      };
      lastOutcome.set(job.name, outcome);
      // E4 批（docs/LOGGING-SCHEMA.md §4）：job_failed 带 reason 稳定短码（job_spawn_failed 已单独记过，不重复）
      if (outcome.result === 'failed' && !spawnFailed) {
        logger.error('scheduler.job_failed', {
          job: job.name,
          code,
          elapsedMs: outcome.elapsedMs,
          reason: jobFailedReason(code, runReason),
        });
      }
      // EU-1：被重启中断不告警——interrupted 只落状态文件/健康面板「被重启中断」，不发失败邮件
      if (outcome.result === 'interrupted') {
        logger.info('scheduler.job_interrupted', { job: job.name, code, elapsedMs: outcome.elapsedMs });
      }
      // CO-1/A5：失败邮件告警（开关 settings alerts.jobFailureEmail，默认关；收件人走告警回退链）
      // FP 批 P0（docs/SYNC-HARDENING.md §4.3）：403 单独口径——连续 ≥3 次才告警（单次不刷失败邮件）；
      // discovery 类任务（steam-discovery/discover）403 只日志、永不告警。
      if (outcome.result === 'failed') {
        const is403 = is403Failure(outcome.error);
        if (is403) {
          http403Streak.set(job.name, (http403Streak.get(job.name) ?? 0) + 1);
        } else {
          http403Streak.delete(job.name);
        }
        if (is403 && !shouldAlert403(job.name, http403Streak.get(job.name))) {
          const streak = http403Streak.get(job.name) ?? 0;
          if (DISCOVERY_JOBS.has(job.name)) {
            logger.info('scheduler.discovery_forbidden', {
              job: job.name,
              code,
              streak,
              message: 'discovery 类任务 403：仅记日志，不发失败邮件',
            });
          } else {
            logger.info('scheduler.forbidden_deferred', {
              job: job.name,
              code,
              streak,
              message: '403 失败暂不告警（连续 ≥3 次才发失败邮件）',
            });
          }
        } else {
          await alertJobFailure(job, code, outcome.error).catch((err) =>
            logger.warn('scheduler.failure_alert_failed', { job: job.name, ...failFields(err), err: serializeError(err) }),
          );
        }
      }
      retryState = applyRetry(retryState, { job: job.name, code, nowMs: Date.now() });
      writeRetryState(retryState);
      waitingSince.delete(job.name);
      writeStatusFile(jobs, { lastRunMs, health, running, tickMs: TICK_MS, lastOutcome, waitingSince, retry: retryState, estimates, groups: groupsFromJobs(jobs) });
      const followUp = followUpArgs(job.name, code, process.env);
      if (followUp && !stopping) {
        followUpChain = followUpChain
          .then(async () => {
            if (stopping) return;
            const chartName = `${job.name}:chart`;
            logger.info('scheduler.followup', { job: job.name, args: followUp.join(' ') });
            const res = await runJob({ name: chartName, args: followUp });
            // chart 任务是直调 runJob、不过 completeJob——失败同样记 scheduler.job_failed（带 reason 稳定短码）
            if (res.code !== 0 && res.code !== 75 && !res.spawnFailed) {
              logger.error('scheduler.job_failed', {
                job: chartName,
                code: res.code,
                reason: jobFailedReason(res.code, null),
              });
            }
          })
          .catch(() => {});
      }
      // EU-1：interrupted 不进熔断计数——重启打断不是任务自身的连续失败，误熔断会让下一轮被跳过
      if (outcome.result === 'interrupted') return;
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
          threshold: circuitThreshold,
          cooldownMin: Math.round(circuitCooldownMs / 60_000),
          openUntil: new Date(next.openUntil).toISOString(),
        });
      } else if (code === 0 && (state.failures ?? 0) > 0) {
        logger.info('scheduler.circuit_reset', { job: job.name, afterFailures: state.failures });
      }
    };

    /** CO-1/A5：任务失败邮件告警——开关关/未配 SMTP 时只记日志不发信。 */
    const alertJobFailure = async (job, code, reason) => {
      const channel = jobFailureEmailChannel(process.env);
      if (!channel) {
        logger.info('scheduler.failure_alert_skipped', { job: job.name, code, reason });
        return;
      }
      const mail = buildJobFailureMail({ job: job.name, code, reason, at: new Date() });
      const res = await deliver([channel], { subject: mail.subject, text: mail.text, logger });
      logger.info('scheduler.failure_alert', { job: job.name, code, ok: res.ok, to: channel.to.length });
    };

    /** 非阻塞发射一个任务（熔断检查在发射前做）。 */
    const launch = (job, now) => {
      const state = health.get(job.name) ?? { failures: 0, openUntil: null };
      if (isCircuited(state, now)) {
        logger.warn('scheduler.circuit_skip', {
          job: job.name,
          failures: state.failures,
          threshold: circuitThreshold,
          cooldownMin: Math.round(circuitCooldownMs / 60_000),
          openUntil: new Date(state.openUntil).toISOString(),
        });
        lastRunMs.set(job.name, now);
        return;
      }
      running.add(job.name);
      startedAt.set(job.name, Date.now());
      runJob(job)
        .then((result) => completeJob(job, result))
        .catch((err) => {
          logger.error('scheduler.job_unexpected', { job: job.name, ...failFields(err), err: serializeError(err) });
          completeJob(job, { code: -1, spawnFailed: true });
        });
    };

    /**
     * 非阻塞发射一个 heavy 槽任务并占用对应槽组（X 批 P0-1 + FP 批 P1 双槽）：
     * tick 循环不再 await 它，子进程结束后才释放槽位——轻任务在它运行期间照常派发。
     * 槽位释放放在 .finally，completeJob 之外再加一道保险，同槽组两个任务并行打配额是红线。
     */
    const launchHeavy = (job, group = 'steam') => {
      heavySlots[group] = job.name;
      running.add(job.name);
      startedAt.set(job.name, Date.now());
      const waiting = waitingSince.get(job.name);
      if (waiting) {
        waitingSince.delete(job.name);
        logger.info('scheduler.job_wait_end', { job: job.name, waitedMs: Date.now() - waiting.at, occupiedBy: waiting.occupiedBy });
      }
      runJob(job)
        .then((result) => completeJob(job, result))
        .catch((err) => {
          logger.error('scheduler.job_unexpected', { job: job.name, ...failFields(err), err: serializeError(err) });
          completeJob(job, { code: -1, spawnFailed: true });
        })
        .finally(() => {
          if (heavySlots[group] === job.name) heavySlots[group] = null;
          logger.info('scheduler.heavy_slot_released', { job: job.name, group });
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
    writeStatusFile(jobs, { lastRunMs, health, running, tickMs: TICK_MS, retry: retryState, estimates, groups: groupsFromJobs(jobs) });

    while (!stopping) {
      // 设置页保存后 revision +1：重新水合 env 并重建任务表，无需重启容器
      const revision = await settings.getRevision(q);
      if (revision !== lastRevision) {
        await settings.hydrateSettings({ store, logger });
        await store.setTimezone?.(process.env.TZ);
        jobs = jobsFromEnv();
        observed = await refreshObserved(); // B3 批：设置变更后同样按实测耗时重算预算
        jobs = applySteamBudget(jobs, process.env, logger, observed, { explicitSteamStatusLimit: statusLimitIsExplicit }).jobs; // AC-4：设置变更后同样过预算
        estimates = jobRuntimeEstimates(jobs, process.env, observed);
        circuitThreshold = num(process.env.CIRCUIT_THRESHOLD, CIRCUIT.threshold);
        circuitCooldownMs = num(process.env.CIRCUIT_COOLDOWN_MIN, CIRCUIT.cooldownMs / 60_000) * 60_000;
        lastRevision = revision;
        logger.info('scheduler.settings_reloaded', { revision, jobs: jobs.map((j) => j.name) });
      }

      const now = Date.now();
      // BL-2：重排状态参与 due 判定（正常到期 || retry.at 已到）
      const due = dueJobs(jobs, { nowMs: now, startedMs, lastRunMs, retry: retryState });

      // FP 批 P1：backup/prune 低峰窗口过滤——窗口外不派发（任务保持 due，窗口一到即发）
      const dueInWindow = due.filter((j) => inMaintWindowFor(j.name, now, process.env));

      // 每 tick 的派发计划（X 批 P0-1）：重任务槽被占只挡重任务，轻任务照常发。
      // FJ 批：传 jobs（带 group 字段）启用组内串行——组内子步骤同一时刻最多一个在跑。
      // FP 批 P1：heavyJobs 扩为 STEAM_HEAVY ∪ HEAVY_MAINT，按 heavyGroups 分槽互不影响。
      const heavyJobsAll = new Set([...STEAM_HEAVY, ...HEAVY_MAINT]);
      const busyGroups = new Set(['steam', 'maint'].filter((g) => heavySlots[g]));
      const plan = planTick({
        due: dueInWindow,
        running,
        lightMax,
        jobs,
        heavyJobs: heavyJobsAll,
        heavyGroups: { groupOf: heavyGroupFor, busy: busyGroups },
      });

      // 1) 轻任务：非阻塞并行发射（上限 lightMax）。heat/steam-prices 等长任务运行时它们照常跑，
      //    不会出现"steam-prices 90 分钟饿死杉果/提醒"这类排队。
      for (const job of plan.light) {
        if (stopping) break;
        launch(job, now);
      }

      // 2) heavy 任务：非阻塞发射 + 双槽（steam/maint，槽组被占时本 tick 该组不再派发）。
      for (const job of plan.heavy) {
        if (stopping) break;
        const group = heavyGroupFor(job.name);
        if (heavySlots[group]) {
          // AC5：被同槽组正在跑的任务占槽——只在进入排队时记一次，面板可看到占用者与等待时长
          if (!waitingSince.has(job.name)) {
            waitingSince.set(job.name, { at: now, occupiedBy: heavySlots[group] });
            logger.info('scheduler.job_wait_slot', { job: job.name, occupiedBy: heavySlots[group], group });
          }
          continue;
        }

        // 后台手动回填/同步也写 sync_runs；让 heavy 任务等它结束再执行，避免并行冲击 Steam。
        const activeSync = await db.runningSyncRun(q).catch(() => null);
        if (activeSync) {
          // FP 批 P0：runningSyncRun 恢复时校验僵尸——running 超时自动 interrupted，不占槽（不 continue，清完直接派发）
          const staleHours = syncStaleRunHours(process.env);
          if (isStaleSyncRun(activeSync, { nowMs: now, staleHours })) {
            const n = await db.interruptStaleSyncRuns(q, { staleHours }).catch(() => 0);
            logger.warn('scheduler.stale_run_interrupted', {
              runId: activeSync.id,
              mode: activeSync.mode,
              startedAt: activeSync.started_at,
              count: n,
              staleHours,
              message: 'runningSyncRun 恢复时判为僵尸，已自动 interrupted（不占 heavy slot）',
            });
          } else {
            if (!waitingSince.has(job.name)) {
              waitingSince.set(job.name, { at: now, occupiedBy: activeSync.mode });
              logger.info('scheduler.job_wait_slot', { job: job.name, occupiedBy: activeSync.mode, runId: activeSync.id });
            }
            logger.info('scheduler.job_deferred_busy', { job: job.name, runId: activeSync.id, mode: activeSync.mode });
            continue;
          }
        }

        const state = health.get(job.name) ?? { failures: 0, openUntil: null };
        if (isCircuited(state, now)) {
          // 熔断期内不再打目标站：持续 403 时继续重试只会更快被封
          waitingSince.delete(job.name);
          logger.warn('scheduler.circuit_skip', {
            job: job.name,
            failures: state.failures,
            threshold: circuitThreshold,
            cooldownMin: Math.round(circuitCooldownMs / 60_000),
            openUntil: new Date(state.openUntil).toISOString(),
          });
          lastRunMs.set(job.name, now);
          continue;
        }

        launchHeavy(job, group);
      }
      if (stopping) break;
      // P2（X 批）：状态文件每个 tick 都写一次，updatedAt 才能反映调度器存活
      // （此前只在启动与任务完成时写，长任务运行期间看起来像卡死）。
      writeStatusFile(jobs, { lastRunMs, health, running, tickMs: TICK_MS, lastOutcome, waitingSince, estimates, groups: groupsFromJobs(jobs) });
      await sleepInterruptible(TICK_MS);
    }

    // FP 批 P0：SIGTERM/SIGINT 排空结束——把 DB 里残留的 running 记录标记 interrupted
    //（与 EU 批对内存任务一致；子进程退出前已各自收尾，这里兜底清理并发/异常遗留）。
    if (stopping) {
      try {
        const n = await db.markStaleSyncRuns(q);
        if (n > 0) logger.info('scheduler.running_runs_interrupted', { count: n, reason: 'shutdown' });
      } catch (err) {
        logger.warn('scheduler.shutdown_cleanup_failed', { ...failFields(err), err: serializeError(err) });
      }
    }

    logger.info('scheduler.exit', {});
  } finally {
    await store.close().catch(() => {});
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;if (invokedDirectly) {
  main().catch((err) => {
    const logger = createLogger({ prefix: 'scheduler' });
    logger.fatal('scheduler.crash', { ...failFields(err), err: serializeError(err) });
    process.exit(1);
  });
}
