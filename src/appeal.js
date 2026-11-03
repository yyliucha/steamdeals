// 申诉邮箱回退链：专用设置 → 告警收件人 → SMTP 发件人 → SMTP 账号。
// 必须用 || 链：hydrateSettings 会把未填的设置水合成空字符串（''），
// ?? 只对 null/undefined 回退，会被空串截断（docs/APPEAL-EMAIL.md §2）。
export function appealEmailFrom(env = process.env) {
  return String(
    (env.APPEAL_EMAIL || '').trim() ||
      (env.ALERT_EMAIL_TO || '').trim() ||
      (env.SMTP_FROM || '').trim() ||
      (env.SMTP_USER || '').trim(),
  );
}
