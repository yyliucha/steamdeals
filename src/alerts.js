// 降价提醒：判定 + 简报。投递实现见 src/notify.js。
//
// 判定是纯函数（行 → 命中列表），因为它决定"要不要打扰用户"，必须能单测。
import { yuanAmount } from './format.js';

export const REASON = {
  TARGET: 'target', // 到设定的目标价
  HIST_LOW: 'hist_low', // 没设目标，跌到史低
  MANUAL: 'manual', // DF 批：管理员手动推送（强制推送未达条件时）
};

export const REASON_LABEL = {
  [REASON.TARGET]: '已达目标价',
  [REASON.HIST_LOW]: '跌至史低',
  [REASON.MANUAL]: '手动推送',
};

const yuan = (cents) => (cents == null ? '—' : `¥${yuanAmount(cents)}`);

/**
 * 从 watchCandidates 的行里挑出需要提醒的。
 * 去重规则：已经用「相同或更低」的价格通知过，就不再重复打扰。
 */
export function evaluateAlerts(rows, { now = new Date() } = {}) {
  const hits = [];
  for (const row of rows ?? []) {
    const current = row.current_cents == null ? null : Number(row.current_cents);
    if (current == null) continue; // 没在售就不提醒

    const target = row.target_cents == null ? null : Number(row.target_cents);
    const hist = row.hist_low == null ? null : Number(row.hist_low);

    let reason = null;
    if (target != null) {
      if (current <= target) reason = REASON.TARGET;
    } else if (hist != null && current <= hist) {
      reason = REASON.HIST_LOW;
    }
    if (!reason) continue;

    // 上次通知过 ¥X，现在还是 ¥X 或更贵 → 不重复
    if (row.last_notified_cents != null && current >= Number(row.last_notified_cents)) continue;

    hits.push({
      watchId: Number(row.watch_id),
      userId: row.user_id == null ? null : Number(row.user_id),
      userEmail: row.user_email ?? null,
      // CX 批（docs/USER-PROFILE-EDIT.md §2 #5）：到价提醒邮件开关——false 时用户级提醒跳过邮件投递
      userEmailAlerts: row.user_email_alerts !== false,
      gameId: Number(row.game_id),
      steamAppid: row.steam_appid ?? null,
      name: row.name,
      currentCents: current,
      targetCents: target,
      histLowCents: hist,
      atHistLow: hist != null && current <= hist,
      reason,
      note: row.note ?? null,
      detectedAt: now.toISOString(),
    });
  }
  return hits;
}

const steamUrl = (appid) => (appid ? `https://store.steampowered.com/app/${appid}/` : null);

// ---------------------------------------------------------------- DF 批：手动推送判定
// 命中口径与 evaluateAlerts 一致（current<=target / current<=hist_low），但：
//   · force=true 时未达条件的行也进命中（reason=manual）；
//   · 不做 last_notified 去重（管理员主动发，是否记去重由 mark 显式控制）；
//   · 无在售报价的行永远不能推送（无价可发）。
/** 手动推送的行判定。返回 { hits, skipped }，skipped 带 reason（not_met / no_price）与价格信息。 */
export function buildPushHits(rows, { force = false, now = new Date() } = {}) {
  const hits = [];
  const skipped = [];
  for (const row of rows ?? []) {
    const current = row.current_cents == null ? null : Number(row.current_cents);
    if (current == null) {
      skipped.push({ watchId: Number(row.watch_id), name: row.name, reason: 'no_price' });
      continue;
    }
    const target = row.target_cents == null ? null : Number(row.target_cents);
    const hist = row.hist_low == null ? null : Number(row.hist_low);
    let reason = null;
    if (target != null) {
      if (current <= target) reason = REASON.TARGET;
    } else if (hist != null && current <= hist) {
      reason = REASON.HIST_LOW;
    }
    if (!reason && !force) {
      skipped.push({
        watchId: Number(row.watch_id),
        name: row.name,
        reason: 'not_met',
        currentCents: current,
        targetCents: target,
        histLowCents: hist,
      });
      continue;
    }
    if (!reason) reason = REASON.MANUAL;
    hits.push({
      watchId: Number(row.watch_id),
      userId: row.user_id == null ? null : Number(row.user_id),
      userEmail: row.user_email ?? null,
      userEmailAlerts: row.user_email_alerts !== false,
      gameId: Number(row.game_id),
      steamAppid: row.steam_appid ?? null,
      name: row.name,
      currentCents: current,
      targetCents: target,
      histLowCents: hist,
      atHistLow: hist != null && current <= hist,
      reason,
      manual: true, // DF：手动推送标记（digest/邮件文案标注「手动推送」）
      note: row.note ?? null,
      detectedAt: now.toISOString(),
    });
  }
  return { hits, skipped };
}

/** 人读的简报（也进日志，方便只靠日志复盘"今天提醒了什么"）。 */
export function renderDigest(hits, { now = new Date() } = {}) {
  if (!hits?.length) return '没有需要提醒的价格。';
  const stamp = now.toISOString().replace('T', ' ').slice(0, 19);
  const lines = hits.map((h) => {
    const bits = [
      `${h.name}  ${yuan(h.currentCents)}`,
      h.targetCents != null ? `目标 ${yuan(h.targetCents)}` : null,
      h.histLowCents != null ? `史低 ${yuan(h.histLowCents)}` : null,
      REASON_LABEL[h.reason] ?? h.reason,
      h.manual === true ? '手动推送' : null, // DF 批：手动推送的文案标注（§4.3）
    ].filter(Boolean);
    const url = steamUrl(h.steamAppid);
    return `· ${bits.join(' · ')}${url ? `\n  ${url}` : ''}`;
  });
  return `价格提醒（${stamp}，共 ${hits.length} 条）\n${lines.join('\n')}`;
}

/** 机器投递用的结构。字段名保持中性，方便接任意 webhook。 */
export function toPayload(hits, { now = new Date() } = {}) {
  return {
    type: 'steamdeals.alerts',
    generatedAt: now.toISOString(),
    count: hits.length,
    text: renderDigest(hits, { now }),
    alerts: hits.map((h) => ({
      name: h.name,
      steamAppid: h.steamAppid,
      url: steamUrl(h.steamAppid),
      current: h.currentCents,
      target: h.targetCents,
      histLow: h.histLowCents,
      reason: h.reason,
      note: h.note,
    })),
  };
}

// ---------------------------------------------------------------- CL 批：按用户分组
// 用户级提醒（userId 非空）一人一封邮件（收件人 = 用户绑定邮箱）；站点级（NULL）走原全通道逻辑。

/**
 * 把 hits 按 user_id 分组（CL 批 docs/USER-ALERTS.md §3.3）。
 * 返回 { site: hits[], users: [{ userId, email, emailAlerts, hits }] }——users 按 userId 升序保证投递顺序稳定。
 */
export function groupAlertsByUser(hits) {
  const site = [];
  const byUser = new Map();
  for (const h of hits ?? []) {
    if (h.userId == null) {
      site.push(h);
    } else {
      const key = String(h.userId);
      if (!byUser.has(key)) {
        byUser.set(key, {
          userId: h.userId,
          email: h.userEmail ?? null,
          // 同用户同库同一开关值；任一命中带 false 即按关闭处理（保守：不打扰优先）
          emailAlerts: h.userEmailAlerts !== false,
          hits: [],
        });
      }
      byUser.get(key).hits.push(h);
    }
  }
  const users = [...byUser.values()].sort((a, b) => a.userId - b.userId);
  return { site, users };
}

// 投递实现已下沉到 src/notify.js（webhook / 企业微信 / 邮件统一走那里），
// 这里保留同名导出，避免调用方与既有测试改动。
export { postJson as postWebhook } from './notify.js';
