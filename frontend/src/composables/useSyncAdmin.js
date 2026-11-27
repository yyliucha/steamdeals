// GA-1（docs/SYNC-PAGE-REDESIGN.md §2.2/§3）：同步与回填页的共享状态与接口封装。
//
// 页面结构 = 概览 4 卡 → 任务组表（主区）→ 折叠「数据质量」→ 折叠「工具」。
// 四块的数据都来自同一批只读接口（规格 §4 无新接口），互相联动三件事：
//   ① 概览数字 / 组行健康 / 折叠摘要都读同一份 syncStatus + freshness + 429queue，8 秒轮询一次；
//   ② 「立即运行」统一走 confirm → 提交 → 按钮置「已提交」+ toast（约 15 秒生效）；
//   ③ 「需要关注」卡要能把最近失败的任务组滚到视野里并展开——展开状态在组表组件里，由 shell 转发。
//
// 与旧 AdminModules 的游戏管理段相比：任务组/子步骤的渲染口径（groupState / stepRow / partialReason）
// 原样搬过来，只是从「一页平铺 10 块」收成「概览 + 主表 + 两折叠」。
import { computed, reactive } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { redirectToLogin } from '../utils/session.js';
import { fmtDateTime as dateTime } from '../utils/siteTime.js';

/** 后台统一 fetch（与 AdminModules / AlignAdmin / useVisitorsAdmin 同口径：401 软跳登录、错误抛 Error）。 */
export function syncApi(path, options = {}) {
  return fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  }).then(async (r) => {
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* 非 JSON 响应 */ }
    if (r.status === 401) {
      redirectToLogin();
      throw new Error(data.error || '登录已过期');
    }
    if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status });
    return data;
  });
}

const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });

/** 子步骤 mode → 中文 label（后端 groups[].steps[].name 是 mode；label 缺失时兜底）。 */
export const TASK_LABELS = {
  'steam-prices': '价格刷新',
  catalog: '目录同步',
  backfill: '增量回填（含中文名）',
  rename: '重写名字',
  heat: '热度回填',
  itad: 'ITAD 匹配',
  gog: 'GOG 匹配',
  humble: 'Humble 匹配',
  sonkwo: '杉果同步',
  'steam-status': '状态判定',
  'rating-backfill': '分级回填（含色情分级）',
  'explicit-backfill': '色情游戏回填',
  'steam-discovery': 'Deck 发现',
  'app-release-sync': 'App 版本',
  'align-snapshot': '对齐快照',
  'steam-accounts': '账号同步',
  'steam-claim': '认领账号',
  prune: '定期清理（天级）',
  logs: '日志清理',
  backup: '备份',
  alerts: '到价提醒',
  images: '封面缓存（含补图）',
  'images-backfill': '缺图回填',
  report: '价格报表',
  readmodel: '读模型对账（含搜索词重建）',
  'search-tokens-rebuild': '搜索词重建',
  discover: '杉果发现',
  'proxy-probe': '代理探测',
};

/** 组名 → label 兜底（后端 groups 已带 label，此表只在缺 label 时用）。 */
const GROUP_LABELS = {
  'steam-prices': 'Steam 价格',
  'steam-meta': 'Steam 元数据',
  'multi-platform': '多平台报价',
  'catalog-discovery': '目录与发现',
  images: '图片同步',
  index: '索引维护',
  system: '系统维护',
  'steam-accounts': 'Steam 账号',
  heat: '热度回填',
  'app-release': 'App 版本同步',
  'align-snapshot': '对齐快照',
  'proxy-alerts': '代理与提醒',
};

/**
 * 手动任务兜底清单（后端未升级、响应里没有 manualJobs 时用——GA-2 之后后端会下发，
 * 前端按返回渲染、不写死任务数）。GA-1 时后端尚未精简，这四项仍可能出现在调度器里，
 * 因此这里只作兜底：`manualJobs` 有值时一律以后端为准。
 */
const MANUAL_FALLBACK = [
  { name: 'catalog', label: '目录同步（全量）', runnable: true, reason: null },
  { name: 'logs', label: '日志清理', runnable: true, reason: null },
  { name: 'report', label: '价格报表', runnable: true, reason: null },
  { name: 'steam-claim', label: '认领未归属账号', runnable: true, reason: null },
];

/** 子步骤级「立即运行」有独立端点的 mode（其余步骤纯调度，不提供手动入口）。 */
const RUNNABLE_STEP_MODES = ['steam-prices', 'catalog', 'itad', 'gog', 'humble', 'sonkwo', 'heat', 'backfill', 'rename', 'explicit-backfill', 'steam-status'];

const EMPTY_APP_CARD = { latest: null, source: null, lastSyncAt: null, lastError: null, syncing: false };

/** 页面状态（模块级：同一时刻只挂载一个同步页，离开时 resetSyncUi 清瞬态）。 */
const state = reactive({
  status: null,
  freshness: {},
  queue429: {},
  gamesStats: {},
  appCard: { ...EMPTY_APP_CARD },
  backfillProgress: null,
  loading: false,
  /** 已提交（15 秒内按钮置「已提交」）：key = step:<mode> / group:<name> / manual:<name> / fresh:<mode> / init / app */
  submitted: new Set(),
});

let submittedTimers = new Map();

function markSubmitted(key) {
  state.submitted.add(key);
  const prev = submittedTimers.get(key);
  if (prev) clearTimeout(prev);
  submittedTimers.set(key, setTimeout(() => {
    state.submitted.delete(key);
    submittedTimers.delete(key);
  }, 15000));
}

export function fmtInterval(m) {
  const n = Number(m) || 0;
  if (n < 60) return `每 ${n} 分钟`;
  if (n < 1440) return `每 ${Math.round(n / 60)} 小时`;
  const d = Math.round(n / 1440);
  return d === 7 ? '每周' : `每 ${d} 天`;
}

export function fmtDur(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' 秒';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' 分';
  const h = Math.floor(m / 60);
  return h + ' 小时 ' + (m % 60) + ' 分';
}

export function fmtHM(v) {
  if (!v) return '';
  try {
    const d = new Date(v);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  } catch {
    return '';
  }
}

export function useSyncAdmin() {
  const runningJob = computed(() => {
    const st = state.status;
    if (!st?.running) return '';
    return String(st?.run?.mode || '');
  });

  /** 子步骤行（口径沿用 FJ 批：429 partial / 熔断 / 排队 / 估算 全部保留）。 */
  function stepRow(j) {
    const p = state.status?.backfillProgress || null;
    const ss = state.status?.sourceStats?.byPlatform || {};
    const name = j.name || '';
    const partial = name === 'backfill' && j.lastResult === 'partial'
      ? {
          done: p?.done || 0,
          limit: p?.limit || 0,
          remaining: p?.remaining || 0,
          count429: p?.count429 || 0,
          last429At: p?.last429At || null,
          etaDays: p?.done > 0 ? Math.max(1, Math.round((p?.remaining || 0) / p.done)) : null,
        }
      : null;
    return {
      name,
      label: TASK_LABELS[name] || j.label || name,
      freq: fmtInterval(j.intervalMin),
      intervalMin: j.intervalMin,
      lastRunAt: j.lastRunAt || null,
      nextRunAt: j.nextRunAt || null,
      openUntil: j.openUntil || null,
      failures: j.failures || 0,
      running: Boolean(j.running),
      lastElapsedMs: j.lastElapsedMs ?? null,
      lastResult: j.lastResult || null,
      lastError: j.lastError || null,
      waitingFor: j.waitingFor || null,
      retryAt: j.retryAt || null,
      estimate: j.estimate || null,
      partial,
      stats: ss[name] || null,
    };
  }

  /** 任务组行：后端 schedule.groups 为准（不写死组数与子步骤），label 缺省用兜底表。 */
  const groups = computed(() => {
    const list = state.status?.schedule?.groups || [];
    return list.map((g) => {
      const steps = (g.steps || []).map(stepRow);
      const runs = steps.map((s) => s.lastRunAt).filter(Boolean).sort();
      return {
        name: g.name,
        label: g.label || GROUP_LABELS[g.name] || g.name,
        steps,
        lastRunAt: runs.length ? runs[runs.length - 1] : null,
      };
    });
  });

  /** 手动任务组：后端 manualJobs 优先（GA-2 起下发）；缺省用兜底清单。 */
  const manualJobs = computed(() => {
    const list = state.status?.manualJobs;
    if (Array.isArray(list) && list.length) return list;
    return MANUAL_FALLBACK;
  });

  const warnings = computed(() => state.status?.warnings || []);
  const steamClaimConfigured = computed(() => Boolean(state.status?.schedule?.steamClaimConfigured));

  /** 组健康聚合：任一 running → 运行中；任一 failed → 失败；任一 openUntil 未过 → 熔断；否则有运行 → 正常。 */
  function groupState(row) {
    const steps = row.steps || [];
    if (steps.some((s) => s.running)) return 'running';
    if (steps.some((s) => s.lastResult === 'failed')) return 'failed';
    const now = Date.now();
    if (steps.some((s) => s.openUntil && new Date(s.openUntil).getTime() > now)) return 'open';
    return steps.some((s) => s.lastRunAt) ? 'ok' : 'none';
  }
  function groupFailTitle(row) {
    const f = (row.steps || []).find((s) => s.lastResult === 'failed' && s.lastError);
    return f ? `失败原因：${f.lastError}` : (row.label || '');
  }
  function groupOpenText(row) {
    const now = Date.now();
    const opens = (row.steps || []).map((s) => s.openUntil).filter((t) => t && new Date(t).getTime() > now).sort();
    return opens.length ? `熔断至 ${dateTime(opens[0])}` : '熔断';
  }
  /**
   * 「需要关注」= 组内**存在失败子步骤**的组（不受「同组另有步骤在跑」影响——
   * 组行状态仍按 running 优先显示，但失败事实不能被运行中盖掉：概览卡与定位都用这份清单）。
   */
  const failedGroups = computed(() => groups.value.filter((g) => (g.steps || []).some((s) => s.lastResult === 'failed')));

  // FW-3：403 冷却 / 速率闸门标签（与任务健康面板同口径，收敛到组行状态位）
  const forbiddenTagText = computed(() => {
    const f = state.status?.forbidden;
    if (!f?.active) return '';
    const left = Number(f.remainingMin);
    return Number.isFinite(left) && left > 0 ? `403 冷却 · 剩余 ${left} 分钟` : '';
  });
  const rateGateTagText = computed(() => {
    const g = state.status?.rateGate;
    if (!g) return '';
    const perMin = Number(g.perMin);
    const tokens = Number(g.tokens);
    if (!Number.isFinite(perMin) || perMin <= 0 || !Number.isFinite(tokens)) return '';
    const used = Number.isFinite(Number(g.used)) ? Number(g.used) : Math.max(0, perMin - tokens);
    return `速率闸门 已用 ${Math.round(used)}/${Math.round(perMin)}`;
  });

  /** 分级回填最近运行时间（内容分级统计的「最近回填时间」读它，与旧页同口径）。 */
  const ratingBackfillLastRunAt = computed(() => {
    const j = (state.status?.schedule?.jobs || []).find((x) => x.name === 'rating-backfill');
    return j?.lastRunAt || null;
  });

  // ---- 概览 4 卡 ----
  const kpi = computed(() => {
    const f = state.freshness || {};
    const d1 = (k) => Number(f?.[k]?.d1) || 0;
    const parts = { prices: d1('prices'), status: d1('status'), names: d1('names'), images: d1('images') };
    const today = parts.prices + parts.status + parts.names + parts.images;
    const run = state.status?.run || null;
    const elapsedMin = run?.startedAt ? Math.max(0, Math.round((Date.now() - new Date(run.startedAt).getTime()) / 60000)) : null;
    // 回填类任务带进度（done/limit/百分比/速度）——原「任务实时进度」块并进概览卡（规格 §3-5）
    const p = state.status?.running ? state.backfillProgress : null;
    const progress = p && Number(p.limit) > 0 ? { done: Number(p.done) || 0, limit: Number(p.limit) || 0, percent: Number(p.percent) || 0, ratePerMin: Number(p.ratePerMin) || 0 } : null;
    return {
      running: runningJob.value ? 1 : 0,
      runningLabel: runningJob.value ? (TASK_LABELS[runningJob.value] || runningJob.value) : '空闲',
      runningElapsedMin: elapsedMin,
      runningProgress: progress,
      failed: failedGroups.value.length,
      failedNames: failedGroups.value.slice(0, 2).map((g) => g.label),
      queue: Number(state.queue429?.count) || 0,
      queueOldestAt: state.queue429?.oldestAt || null,
      today,
      parts,
    };
  });

  // ---- 折叠摘要 ----
  const qualitySummary = computed(() => {
    const pending = Number(state.gamesStats?.ratingPending) || 0;
    const price7 = Number(state.freshness?.prices?.d7) || 0;
    const queue = Number(state.queue429?.count) || 0;
    return `分级未回填 ${pending.toLocaleString('zh-CN')} · 价格超 7 天 ${price7.toLocaleString('zh-CN')} · 429 队列 ${queue}`;
  });
  const toolsSummary = computed(() => {
    const l = state.appCard?.latest;
    return `初始化全量同步 · App 版本 ${l ? `${l.version}（${l.versionCode}）` : '—'}`;
  });

  // ---- 数据加载 ----
  async function loadStatus() {
    try {
      state.status = await syncApi('/api/admin/sync/status');
      if (state.status?.running) {
        try {
          const d = await syncApi('/api/admin/backfill/status');
          state.backfillProgress = d.progress || null;
        } catch { /* 进度读失败不打断任务表 */ }
      } else {
        state.backfillProgress = null;
      }
    } catch (e) {
      ElMessage.error(e?.message || String(e));
    }
  }

  async function loadFreshness() {
    try {
      const d = await syncApi('/api/admin/sync/freshness');
      state.freshness = d.stats || {};
      state.queue429 = await syncApi('/api/admin/sync/429queue');
    } catch (e) {
      ElMessage.error(e?.message || String(e));
    }
  }

  async function loadGamesStats() {
    try {
      const d = await syncApi('/api/admin/games/stats');
      state.gamesStats = d.stats || {};
    } catch { /* 统计卡读失败静默，不打断任务表 */ }
  }

  async function loadAppCard() {
    try {
      state.appCard = await syncApi('/api/admin/app-sync/status');
    } catch { /* App 版本卡读失败静默 */ }
  }

  async function refreshAll() {
    state.loading = true;
    try {
      await Promise.all([loadStatus(), loadFreshness(), loadGamesStats(), loadAppCard()]);
    } finally {
      state.loading = false;
    }
  }

  // ---- 动作 ----
  /** 确认弹窗（与旧页同款文案口径：默认参数、与其它任务自动互斥）。 */
  async function confirmRun(label, { danger = false } = {}) {
    try {
      await ElMessageBox.confirm(
        '将使用默认参数立即执行；与其它任务自动互斥，撞 403/429 会软收尾并保留进度。',
        `运行「${label}」？`,
        { type: danger ? 'warning' : 'info', confirmButtonText: '确认运行', cancelButtonText: '取消' },
      );
      return true;
    } catch {
      return false;
    }
  }

  /** 子步骤级立即运行（沿用现有端点，只有有端点的 mode 给按钮）。 */
  async function runStep(name) {
    const key = `step:${name}`;
    if (state.submitted.has(key)) return;
    const label = TASK_LABELS[name] || name;
    if (!(await confirmRun(label))) return;
    try {
      if (['steam-prices', 'catalog', 'itad', 'gog', 'humble', 'sonkwo'].includes(name)) {
        await syncApi('/api/admin/sync', json('POST', { mode: name }));
      } else {
        await syncApi(`/api/admin/${name}`, json('POST', {}));
      }
      markSubmitted(key);
      ElMessage.success(`已提交运行「${label}」（约 15 秒内生效）`);
      await loadStatus();
    } catch (e) {
      ElMessage.error(e?.message || String(e));
    }
  }

  /** 组级立即运行（202 启动 / 200 无到期 / 409 BUSY）。 */
  async function runGroup(row) {
    const key = `group:${row.name}`;
    if (state.submitted.has(key)) return;
    if (!(await confirmRun(`${row.label}（组）`))) return;
    try {
      const d = await syncApi(`/api/admin/sync/groups/${row.name}/run`, json('POST', {}));
      markSubmitted(key);
      if (d.started) {
        const labels = (d.queued || []).map((m) => TASK_LABELS[m] || m);
        ElMessage.success(labels.length ? `已启动：${labels.join('、')}` : '已启动组内到期子步骤');
      } else {
        ElMessage.info(d.reason || '无到期子步骤');
      }
      await loadStatus();
    } catch (e) {
      if (e?.status === 409 || e?.message === 'BUSY' || e?.message === 'HTTP 409') ElMessage.warning('组内有任务正在运行，请稍后再试');
      else ElMessage.error(e?.message || String(e));
    }
  }

  /** 手动任务（不进调度器）：POST /api/admin/sync/manual（GA-2 起后端支持）。 */
  async function runManual(job) {
    const key = `manual:${job.name}`;
    if (state.submitted.has(key)) return;
    if (!job.runnable) {
      ElMessage.warning(job.reason || '该任务当前不可运行');
      return;
    }
    if (!(await confirmRun(job.label || job.name))) return;
    try {
      await syncApi('/api/admin/sync/manual', json('POST', { name: job.name }));
      markSubmitted(key);
      ElMessage.success(`已提交运行「${job.label || job.name}」（约 15 秒内生效）`);
      await loadStatus();
    } catch (e) {
      ElMessage.error(e?.message || String(e));
    }
  }

  /** 数据时效「补跑」与 429「立即补」：走同一确认/反馈（与旧页同端点）。 */
  async function runFreshness(mode) {
    const key = `fresh:${mode}`;
    if (state.submitted.has(key)) return;
    const labels = { 'steam-prices': '补跑价格', 'steam-status': '补跑状态', rename: '补跑中文名', images: '补跑图片', backfill: '立即补 429' };
    if (!(await confirmRun(labels[mode] || '补跑'))) return;
    try {
      if (mode === 'steam-prices') await syncApi('/api/admin/sync', json('POST', { mode: 'steam-prices' }));
      else if (mode === 'steam-status') await syncApi('/api/admin/steam-status', json('POST', {}));
      else if (mode === 'images') await syncApi('/api/admin/images/backfill', json('POST', {}));
      else if (mode === 'rename') await syncApi('/api/admin/rename', json('POST', {}));
      else if (mode === 'backfill') await syncApi('/api/admin/backfill', json('POST', {}));
      else return;
      markSubmitted(key);
      ElMessage.success(`已提交「${labels[mode]}」，进度见任务表`);
      await Promise.all([loadStatus(), loadFreshness()]);
    } catch (e) {
      ElMessage.error(e?.message || String(e));
    }
  }

  /** 初始化全量同步（危险动作：二次确认文案保留「默认 20 万上限」）。 */
  async function runInitSync() {
    if (state.submitted.has('init')) return;
    try {
      await ElMessageBox.confirm(
        '初始化全量同步将全量回填目录元数据与国区价格（默认 20 万上限，可能持续数小时；撞 429 自动收尾保留进度，1 小时后自动重排）。确认开始？',
        '初始化全量同步',
        { type: 'warning', confirmButtonText: '开始全量同步', cancelButtonText: '取消' },
      );
    } catch {
      return;
    }
    try {
      await syncApi('/api/admin/init-sync', json('POST', {}));
      markSubmitted('init');
      ElMessage.success('初始化全量同步已提交，可在任务表与进度条查看');
      await loadStatus();
    } catch (e) {
      ElMessage.error(e?.message || String(e));
    }
  }

  /** App 版本立即同步（成功/失败文案沿用旧页）。 */
  async function syncAppNow() {
    if (state.submitted.has('app')) return;
    try {
      const d = await syncApi('/api/admin/app-sync', json('POST', {}));
      await loadAppCard();
      if (d.ok) ElMessage.success(d.version ? `App 已同步到 ${d.version}${d.reason ? `（${d.reason}）` : ''}` : 'App 已同步');
      else ElMessage.error(`App 同步失败：${d.reason || '未知原因'}`);
      markSubmitted('app');
    } catch (e) {
      ElMessage.error(e?.message || String(e));
    }
  }

  /** 认领未归属 Steam 账号（Steam 账号组的手动分支，未配置时按钮已置灰）。 */
  async function runSteamClaim() {
    if (state.submitted.has('step:steam-claim')) return;
    if (!steamClaimConfigured.value) {
      ElMessage.warning('未配置 STEAM_CLAIM_USERNAME / STEAM_CLAIM_STEAM_ID');
      return;
    }
    try {
      await ElMessageBox.confirm(
        '扫描未归属的 Steam 账号，并把它们认领到已配置的账号（STEAM_CLAIM_USERNAME / STEAM_CLAIM_STEAM_ID）。',
        '认领未归属账号',
        { type: 'warning', confirmButtonText: '开始认领', cancelButtonText: '取消' },
      );
    } catch {
      return;
    }
    try {
      const d = await syncApi('/api/admin/steam-claim', json('POST', {}));
      markSubmitted('step:steam-claim');
      ElMessage.success(d.message || (d.claimed != null ? `已认领 ${d.claimed} 个账号` : '认领任务已提交'));
      await loadStatus();
    } catch (e) {
      ElMessage.error(e?.message || String(e));
    }
  }

  /** 停止当前任务（rename/heat 有专用 stop 端点，其余走 backfill/stop）。 */
  async function stopCurrent() {
    const mode = state.status?.run?.mode || '';
    const path = mode === 'rename' ? '/api/admin/rename/stop' : mode === 'heat' ? '/api/admin/heat/stop' : '/api/admin/backfill/stop';
    try {
      await syncApi(path, json('POST', {}));
      ElMessage.success('已请求停止');
      await loadStatus();
    } catch (e) {
      ElMessage.error(e?.message || String(e));
    }
  }

  /** 手动重置任务熔断（6 小时冷却 → 立即可跑）。 */
  async function resetCircuit(row) {
    try {
      const d = await syncApi('/api/admin/circuit/reset', json('POST', { name: row.name }));
      ElMessage.success(d.handled ? '熔断已重置' : '本进程无调度器，重置不影响（重启即清）');
      await loadStatus();
    } catch (e) {
      ElMessage.error(e?.message || String(e));
    }
  }

  /** 离开页面时清瞬态（已提交标记、定时器）。 */
  function resetSyncUi() {
    for (const t of submittedTimers.values()) clearTimeout(t);
    submittedTimers = new Map();
    state.submitted.clear();
  }

  return {
    state,
    kpi,
    groups,
    manualJobs,
    warnings,
    failedGroups,
    runningJob,
    steamClaimConfigured,
    forbiddenTagText,
    rateGateTagText,
    ratingBackfillLastRunAt,
    qualitySummary,
    toolsSummary,
    groupState,
    groupFailTitle,
    groupOpenText,
    runnableStep: (name) => RUNNABLE_STEP_MODES.includes(name),
    stepRunLabel: (name) => (name === 'heat' ? '热度回填' : name === 'backfill' ? '增量回填' : name === 'rename' ? '重写名字' : name === 'explicit-backfill' ? '色情游戏回填' : name === 'steam-status' ? '状态判定' : '立即运行'),
    loadStatus,
    loadFreshness,
    loadGamesStats,
    loadAppCard,
    refreshAll,
    runStep,
    runGroup,
    runManual,
    runFreshness,
    runInitSync,
    syncAppNow,
    runSteamClaim,
    stopCurrent,
    resetCircuit,
    resetSyncUi,
    fmtInterval,
    fmtDur,
    fmtHM,
    dateTime,
  };
}
