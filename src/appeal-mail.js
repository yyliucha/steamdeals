// 申诉系统邮件正文（docs/APPEAL-SYSTEM.md §6 + §10.5，O/BQ 批次）：
// ① 新申诉通知管理员（收件人走申诉邮箱回退链、Reply-To=申请人）；
// ② 处理结果回信申请人。
// BQ 批（§10.5）：通知邮件正文顶部放「信任 / 拒绝」两个 inline-CSS 按钮，
// 链接 https://<域名>/appeal/act#t=<token>（token 在 URL fragment，不进访问日志/Referer）；
// 纯文本备用版附完整 URL + 有效期说明。所有用户输入统一 HTML 转义（§10.6）。
import { escapeHtml } from './mail-templates.js';

const BUTTON_TRUST =
  'display:inline-block;margin:6px 8px 6px 0;padding:10px 20px;border-radius:8px;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px';
const BUTTON_REJECT =
  'display:inline-block;margin:6px 0;padding:10px 20px;border-radius:8px;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px';

/** BQ 确认页链接：token 放 fragment。origin 来自服务端 baseUrl(req)（HTTPS 域名）。 */
export function appealActionUrl(origin, token) {
  const base = String(origin ?? '').replace(/\/+$/, '');
  return `${base}/appeal/act#t=${encodeURIComponent(token)}`;
}

/**
 * 新申诉通知管理员。actionUrl 为空时只有摘要（SMTP 未配不发，但函数本身照常可渲染）；
 * 非空（BQ）时正文顶部加两个按钮，纯文本版附完整链接与有效期说明。
 */
export function appealAdminMail({ siteName = 'SteamDeals', code, ip = null, reason = null, banUntil = null, contact, message = '', actionUrl = null }) {
  const subject = `[SteamDeals] 新申诉 ${code}`;
  const esc = escapeHtml;
  const until = banUntil ? new Date(banUntil).toISOString() : '';
  const lines = [
    `申诉编号：${code}`,
    `IP：${ip || '未知'}`,
    `封禁原因：${reason || '未记录'}`,
    `解封时间：${until ? new Date(until).toLocaleString('zh-CN') : '未记录'}`,
    `联系方式：${contact}`,
    '',
    '申诉说明：',
    message,
  ];
  let text = `[${siteName}] 新申诉 ${code}\n\n${lines.join('\n')}`;
  if (actionUrl) {
    text += `\n\n邮件内快速处理：\n${actionUrl}\n（链接 14 天内有效，处理一次后失效；也可登录后台「申诉管理」处理。）`;
  }
  const summaryHtml = `
    <p>收到一条新的解封申诉：</p>
    <table style="border-collapse:collapse;font-size:13px" cellpadding="6">
      <tr><td style="color:#6b7280">申诉编号</td><td><strong>${esc(code)}</strong></td></tr>
      <tr><td style="color:#6b7280">IP</td><td>${esc(ip || '未知')}</td></tr>
      <tr><td style="color:#6b7280">封禁原因</td><td>${esc(reason || '未记录')}</td></tr>
      <tr><td style="color:#6b7280">解封时间</td><td>${esc(until ? new Date(until).toLocaleString('zh-CN') : '未记录')}</td></tr>
      <tr><td style="color:#6b7280">联系方式</td><td>${esc(contact)}</td></tr>
    </table>
    <p style="white-space:pre-wrap">${esc(message)}</p>`;
  const buttonsHtml = actionUrl
    ? `<p style="margin:14px 0 4px"><a href="${esc(actionUrl)}" style="${BUTTON_TRUST}">信任并解封</a><a href="${esc(actionUrl)}" style="${BUTTON_REJECT}">拒绝并保持封禁</a></p><p style="color:#6b7280;font-size:12px">点击后先打开确认页，再点按钮才执行；链接 14 天内有效，处理一次后失效。也可登录后台「申诉管理」处理。</p>`
    : '<p style="color:#6b7280;font-size:12px">请在后台「访问与安全 → 申诉管理」中处理本条申诉。</p>';
  const html = `<div style="font:14px/1.7 -apple-system,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;color:#1f2937">${buttonsHtml}${summaryHtml}</div>`;
  return { subject, text, html };
}

/** 处理结果回信申请人：resolved=已解封可访问；否则=未通过+理由。 */
export function appealResultMail({ siteName = 'SteamDeals', code, resolved, note = '' }) {
  const subject = `[SteamDeals] 申诉处理结果 ${code}`;
  const esc = escapeHtml;
  const text = resolved
    ? `[${siteName}] 申诉处理结果 ${code}\n\n你的解封申诉已通过，相关限制已解除，现在可以正常访问站点。\n如有疑问请直接回复本邮件。`
    : `[${siteName}] 申诉处理结果 ${code}\n\n很抱歉，你的解封申诉未通过。\n原因：${note || '未通过审核'}\n如有疑问请直接回复本邮件。`;
  const html = resolved
    ? `<div style="font:14px/1.7 -apple-system,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;color:#1f2937"><p>你的解封申诉（<strong>${esc(code)}</strong>）已通过，相关限制已解除，现在可以正常访问站点。</p><p style="color:#6b7280;font-size:12px">如有疑问请直接回复本邮件。</p></div>`
    : `<div style="font:14px/1.7 -apple-system,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;color:#1f2937"><p>很抱歉，你的解封申诉（<strong>${esc(code)}</strong>）未通过。</p><p>原因：${esc(note || '未通过审核')}</p><p style="color:#6b7280;font-size:12px">如有疑问请直接回复本邮件。</p></div>`;
  return { subject, text, html };
}

/** 后台「复制回复内容」用：生成给申请人的回复文本（解封/拒绝两种口径）。 */
export function appealReplyText({ code, resolved, note = '' }) {
  if (resolved) return `你的解封申诉（${code}）已通过，相关限制已解除，现在可以正常访问站点。`;
  return `你的解封申诉（${code}）未通过。原因：${note || '未通过审核'}。如有疑问请回复申诉邮件。`;
}
