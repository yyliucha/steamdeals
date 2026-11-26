// FW-3（docs/SLOW-SYNC.md §1.3 决策 14/15、§3.1 退出码约定、§3.4 日志事件）：
// 软退出（soft abort）退出码判定——从 cli.js 抽出来，便于单测锁住「哪个错误算 75 / 76」。
//
//   75：429 冷却超限（COOLDOWN_ABORT）/ 备份超时（BACKUP_TIMEOUT）——既有语义不变：
//       sync_runs 记 interrupted、调度器 1 小时后重排；
//   76：**403 收尾**（FW-3 新增）——Steam 业务 403：
//       · err.code === 'FORBIDDEN_COOLDOWN'（403 冷却期内不再请求，http.js 直接抛）；
//       · 或 err.status === 403 且 err.proxyStatus == null（目标站拒绝，**不是**代理层 CONNECT 403）；
//       sync_runs 同样记 interrupted，但调度器**不熔断、不重排**（下一轮按正常间隔到期）。
//
// 为什么必须排除 proxyStatus：代理隧道被拒（407/403 建隧道失败）属于「代理坏了」，
// 由 FW-2 的代理切换/全池失败路径处理，不能当成「Steam 拒了本任务」而软收尾。

/** 软退出退出码：75 = 429 冷却/备份超时；76 = 403 收尾；null = 非软退出（照旧记 failed）。 */
export function softAbortExitCode(err) {
  if (err?.code === 'COOLDOWN_ABORT' || err?.code === 'BACKUP_TIMEOUT') return 75;
  if (err?.code === 'FORBIDDEN_COOLDOWN') return 76;
  // cmdHeat 把 403 包成 FORBIDDEN_ROUND_END（status=403、无 proxyStatus）也落在这一条；
  // 任何走 runSyncTracked 的 Steam 任务撞原样 403 同样命中（决策 15：全 Steam 任务通用）。
  if (Number(err?.status) === 403 && err?.proxyStatus == null) return 76;
  return null;
}

/** sync_runs 的状态：软退出记 interrupted（进度已保留），其余记 failed。 */
export function syncRunStatusFor(err) {
  return softAbortExitCode(err) != null ? 'interrupted' : 'failed';
}

/**
 * 执行软退出收口：设置 process.exitCode 并记 `process.soft_abort`（带 code）。
 * 返回 null 表示不是软退出（调用方继续 throw，记 failed）；返回 75/76 表示已收口（调用方 return）。
 *
 * processObj / logger 可注入，单测不需要动真进程退出码。
 */
export function applySoftAbort(err, { mode = null, logger = null, processObj = process } = {}) {
  const exitCode = softAbortExitCode(err);
  if (exitCode == null) return null;
  if (processObj) processObj.exitCode = exitCode;
  logger?.warn?.('process.soft_abort', {
    mode,
    code: err?.code ?? null,
    status: Number.isFinite(Number(err?.status)) ? Number(err.status) : null,
    exitCode,
    message: String(err?.message ?? '').slice(0, 200),
  });
  return exitCode;
}
