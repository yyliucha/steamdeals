// EU-2（docs/SCHEDULER-RESTART-RESILIENCE.md §EU-2）：steam-prices 分批断点续跑。
//
// 落点与 data/scheduler-retry.json 同模式（默认 data/scheduler-resume.json，可用
// SCHEDULER_RESUME_FILE 覆盖），无 schema 变更。语义：
//   - 每轮只处理 --batch 个 appid，批内每完成一个 chunk 就把「已处理 appid」落盘；
//   - 正常跑完一轮 → 清空该 mode 的断点（下一轮由 last_snap 收敛性自然推进）；
//   - 被 SIGTERM 打断 → 断点残留，下一轮启动时把断点里的 appid 从候选排除（不重跑）；
//   - 断点超过 36 小时（1.5 个调度间隔）视为陈旧丢弃——调度器长期停摆后，
//     冷门报价的 last_snap 已重新过期，再排除它们反而会漏刷。
import { mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

/** 断点文件路径（与 SCHEDULER_RETRY_FILE 相同的覆盖机制）。 */
export const resumeFilePath = () => process.env.SCHEDULER_RESUME_FILE ?? 'data/scheduler-resume.json';

/** 断点有效期：只服务「中断后的下一轮」；超过即视为陈旧。 */
export const RESUME_MAX_AGE_MS = 36 * 3600_000;

/** 读断点状态 { mode: { appids: number[], savedAt } }；缺失/损坏返回 {}。 */
export function readResumeState(file = resumeFilePath()) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 取某个 mode 仍然有效的已处理 appid（纯函数）：
 * - 没有断点 / 结构不对 → []；
 * - 超过 RESUME_MAX_AGE_MS → []（陈旧丢弃）；
 * - 过滤非正整数（防脏文件）。
 */
export function validResumeAppids(state = {}, { mode, nowMs = Date.now(), maxAgeMs = RESUME_MAX_AGE_MS }) {
  const entry = state?.[mode];
  if (!entry || typeof entry !== 'object') return [];
  if (!Array.isArray(entry.appids) || !Number.isFinite(entry.savedAt)) return [];
  if (nowMs - entry.savedAt > maxAgeMs) return [];
  return entry.appids.filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0);
}

/** 更新某个 mode 的断点（纯函数）：空数组 = 清掉该 mode。 */
export function recordResume(state = {}, { mode, appids = [], nowMs = Date.now() }) {
  const next = { ...state };
  if (!appids.length) {
    delete next[mode];
    return next;
  }
  next[mode] = { appids, savedAt: nowMs };
  return next;
}

/** 清掉某个 mode 的断点（纯函数）。 */
export function clearResume(state = {}, mode) {
  const next = { ...state };
  delete next[mode];
  return next;
}

/** 写断点状态（原子：tmp + rename）；写失败不影响采集。 */
export function writeResumeState(state = {}, file = resumeFilePath()) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    // Windows 上 rename 到已存在目标会报错：先删目标再 rename（与 retry 状态同口径：文件小、失败无碍）
    rmSync(file, { force: true });
    renameSync(tmp, file);
  } catch {
    /* 断点写失败不影响采集 */
  }
}

/** 删除断点文件（一轮正常跑完）；文件不存在静默。 */
export function removeResumeFile(file = resumeFilePath()) {
  try {
    rmSync(file, { force: true });
  } catch {
    /* 删失败不影响采集 */
  }
}
