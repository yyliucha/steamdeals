// 整轮总预算（DJ 批，交接范围 ①；无独立规格文档，以 TODO DJ 条目范围/验收为准）：
// 默认 20 分钟 deadline，E2E_BUDGET_MS 环境变量 / --budget-ms= 可调（测试可缩短）。
// 到点强制收尾：剩余未跑矩阵行标「预算截断」（status='truncated'），照常生成 HTML/PDF 报告；
// 退出码三态：0 全绿 / 1 有失败 / 2 预算截断（截断优先于失败——轮次不完整，不能让调用方误判"全绿"，
// 也不宜把未跑项当失败；失败明细仍在报告里逐行可见）。
// 本模块为纯函数、零副作用：test/e2e/budget.test.js 直接单测（进主链 test:4）。

export const DEFAULT_BUDGET_MS = 20 * 60 * 1000; // 20 分钟（规格：整轮总预算默认 20 分钟 deadline）
export const TRUNCATED_STATUS = 'truncated';
export const TRUNCATED_REASON = (budgetMs) => `预算截断：整轮预算 ${budgetMs}ms 已耗尽，剩余未跑项强制收尾`;

/**
 * 解析整轮预算毫秒数。优先级：CLI --budget-ms= 显式值 > 环境变量 E2E_BUDGET_MS > 默认 20 分钟。
 * <=0 视为「禁用预算」（无 deadline，仅调试用）；非有限数/负数以外的非法值抛错（宁红不静默）。
 */
export function resolveBudgetMs({ envMs, cliMs } = {}) {
  for (const raw of [cliMs, envMs]) {
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`整轮预算必须是有限毫秒数（E2E_BUDGET_MS / --budget-ms=）：${raw}`);
    if (n < 0) throw new Error(`整轮预算不能为负（E2E_BUDGET_MS / --budget-ms=）：${raw}`);
    if (n === 0) return 0; // 禁用（调试用）
    return Math.floor(n);
  }
  return DEFAULT_BUDGET_MS;
}

/** 整轮 deadline（相对 performance.now() 同源单调时钟；budgetMs<=0 时返回 null = 无预算）。 */
export function deadlineFor(startedAtMs, budgetMs) {
  return budgetMs > 0 ? startedAtMs + budgetMs : null;
}

/** 是否已到点（到点即截：nowMs >= deadlineMs，含恰好相等——宁早一秒收尾，不拖过预算）。 */
export function isBudgetExceeded(nowMs, deadlineMs) {
  return deadlineMs !== null && nowMs >= deadlineMs;
}

/**
 * 把剩余未跑的矩阵行标记为「预算截断」。
 * 不修改传入的 row 对象（与 runner 主循环里 rec = { ...row } 的口径一致）；
 * durationMs=0、无产物、无 Console 错误，skipReason 写入预算截断原因（报告逐行可见）。
 */
export function truncateRows(rows, { budgetMs }) {
  return rows.map((row) => ({
    ...row,
    status: TRUNCATED_STATUS,
    skipReason: TRUNCATED_REASON(budgetMs),
    durationMs: 0,
    artifacts: [],
    consoleErrors: [],
    error: null,
  }));
}

/**
 * 退出码三态。口径（DJ 交接范围 ①）：预算截断优先于失败——轮次不完整即 2；
 * 完整轮里按「有失败 → 1、全绿 → 0」区分。
 */
export function exitCode({ failed = 0, truncated = 0 } = {}) {
  if (truncated > 0) return 2;
  if (failed > 0) return 1;
  return 0;
}
