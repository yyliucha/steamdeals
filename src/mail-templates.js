// 邮件模板（docs/USER-LIFECYCLE.md §3.1/§4.3/§6，AI 批）：
// 9 个事件（8 类账号通知 + 验证码）的默认模板与渲染都在这里。
// 表 mail_templates 里没有该 event 行 = 用默认；「恢复默认」= 删表行。
// 统一页脚由 renderTemplate 追加，模板正文里没有也改不到它。
// 变量白名单：siteName / siteUrl / username / action / time / operator / contactEmail / code（仅验证码事件）。

export const TEMPLATE_VARIABLES = ['siteName', 'siteUrl', 'username', 'action', 'time', 'operator', 'contactEmail', 'code'];

export const TEMPLATE_EVENTS = [
  { event: 'account_disabled', label: '账号停用', variables: ['siteName', 'siteUrl', 'username', 'action', 'time', 'operator', 'contactEmail'] },
  { event: 'account_enabled', label: '账号恢复', variables: ['siteName', 'siteUrl', 'username', 'action', 'time', 'operator', 'contactEmail'] },
  { event: 'account_deleted', label: '账号删除', variables: ['siteName', 'siteUrl', 'username', 'action', 'time', 'operator', 'contactEmail'] },
  { event: 'account_renamed', label: '显示名修改', variables: ['siteName', 'siteUrl', 'username', 'action', 'time', 'operator', 'contactEmail'] },
  { event: 'account_email_changed', label: '登录邮箱已变更', variables: ['siteName', 'siteUrl', 'username', 'action', 'time', 'operator', 'contactEmail'] },
  { event: 'account_email_bound', label: '新邮箱绑定成功', variables: ['siteName', 'siteUrl', 'username', 'action', 'time', 'operator', 'contactEmail'] },
  { event: 'account_role_changed', label: '权限变更', variables: ['siteName', 'siteUrl', 'username', 'action', 'time', 'operator', 'contactEmail'] },
  { event: 'account_password_reset', label: '密码重置', variables: ['siteName', 'siteUrl', 'username', 'action', 'time', 'operator', 'contactEmail'] },
  { event: 'verify_code', label: '验证码', variables: ['siteName', 'siteUrl', 'username', 'action', 'time', 'operator', 'contactEmail', 'code'] },
];

/** 默认模板：表里没存过的就用这套（主题不含 CR/LF；正文不含密码/token/Key/IP/SteamID/完整邮箱）。 */
export const DEFAULT_TEMPLATES = {
  account_disabled: {
    subject: '你的账号已被停用',
    bodyHtml:
      '<p>{{username}}，你好：</p><p>你的 SteamDeals 账号已于 {{time}} 被停用。</p><p>如有疑问请联系站点管理员。</p>',
    bodyText: '{{username}}，你好：\n你的 SteamDeals 账号已于 {{time}} 被停用。\n如有疑问请联系站点管理员。',
  },
  account_enabled: {
    subject: '你的账号已恢复',
    bodyHtml: '<p>{{username}}，你好：</p><p>你的 SteamDeals 账号已于 {{time}} 恢复，现在可以正常登录了。</p>',
    bodyText: '{{username}}，你好：\n你的 SteamDeals 账号已于 {{time}} 恢复，现在可以正常登录了。',
  },
  account_deleted: {
    subject: '你的账号已被删除',
    bodyHtml:
      '<p>{{username}}，你好：</p><p>你的 SteamDeals 账号已于 {{time}} 被删除，相关数据已清除。</p><p>如有异议请通过 {{contactEmail}} 联系站点管理员。</p>',
    bodyText: '{{username}}，你好：\n你的 SteamDeals 账号已于 {{time}} 被删除，相关数据已清除。\n如有异议请通过 {{contactEmail}} 联系站点管理员。',
  },
  account_renamed: {
    subject: '你的显示名已修改',
    bodyHtml: '<p>{{username}}，你好：</p><p>你的显示名已于 {{time}} 被修改为「{{action}}」。</p>',
    bodyText: '{{username}}，你好：\n你的显示名已于 {{time}} 被修改为「{{action}}」。',
  },
  account_email_changed: {
    subject: '你的登录邮箱已变更',
    bodyHtml:
      '<p>{{username}}，你好：</p><p>你的登录邮箱已于 {{time}} 变更为「{{action}}」。</p><p>如果这不是你本人的操作，请立即通过 {{contactEmail}} 联系站点管理员。</p>',
    bodyText: '{{username}}，你好：\n你的登录邮箱已于 {{time}} 变更为「{{action}}」。\n如果这不是你本人的操作，请立即通过 {{contactEmail}} 联系站点管理员。',
  },
  account_email_bound: {
    subject: '新邮箱绑定成功',
    bodyHtml:
      '<p>{{username}}，你好：</p><p>「{{action}}」已于 {{time}} 绑定为你的 SteamDeals 登录邮箱，今后登录验证邮件将发送到该邮箱。</p><p>如果这不是你本人的操作，请立即通过 {{contactEmail}} 联系站点管理员。</p>',
    bodyText: '{{username}}，你好：\n「{{action}}」已于 {{time}} 绑定为你的 SteamDeals 登录邮箱。\n如果这不是你本人的操作，请立即通过 {{contactEmail}} 联系站点管理员。',
  },
  account_role_changed: {
    subject: '你的账号权限已变更',
    bodyHtml: '<p>{{username}}，你好：</p><p>你的账号权限已于 {{time}} 变更为「{{action}}」。</p>',
    bodyText: '{{username}}，你好：\n你的账号权限已于 {{time}} 变更为「{{action}}」。',
  },
  account_password_reset: {
    subject: '你的密码已被重置',
    bodyHtml:
      '<p>{{username}}，你好：</p><p>你的登录密码已于 {{time}} 被重置。请向站点管理员获取新密码，登录后请立即修改。</p>',
    bodyText: '{{username}}，你好：\n你的登录密码已于 {{time}} 被重置。请向站点管理员获取新密码，登录后请立即修改。',
  },
  verify_code: {
    subject: 'SteamDeals 验证码',
    bodyHtml:
      '<p>{{username}}，你好：</p><p>你的验证码是：<strong style="font-size:24px;letter-spacing:4px">{{code}}</strong></p><p>用途：{{action}}。{{time}} 前有效，用完即失效。如果不是你本人操作，请忽略这封邮件。</p>',
    bodyText: '{{username}}，你好：\n你的验证码是：{{code}}\n用途：{{action}}。{{time}} 前有效，用完即失效。\n如果不是你本人操作，请忽略这封邮件。',
  },
};

/** 3 套示例版式（§5.2「套用示例」）：预填主题与正文，带常用变量，不自动保存。 */
export const SAMPLE_THEMES = [
  {
    id: 'plain',
    label: '简洁版',
    subject: '{{siteName}} 通知',
    bodyHtml:
      '<p>{{username}}，你好：</p><p>{{action}}</p><p style="color:#6b7280;font-size:12px">{{time}} · {{operator}}</p>',
  },
  {
    id: 'card',
    label: '卡片版',
    subject: '{{siteName}} 通知',
    bodyHtml:
      '<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;max-width:480px"><h2 style="margin:0 0 12px;font-size:16px">{{siteName}}</h2><p>{{username}}，你好：</p><p>{{action}}</p><p style="color:#6b7280;font-size:12px;margin:16px 0 0">{{time}} · {{operator}}</p></div>',
  },
  {
    id: 'formal',
    label: '正式版',
    subject: '{{siteName}} 账号通知',
    bodyHtml:
      '<p>{{username}}，您好：</p><p>兹通知：{{action}}。</p><p>时间：{{time}}。如有疑问，请通过 {{contactEmail}} 与站点管理员联系。</p><p>此致<br>{{siteName}}（{{operator}}）</p>',
  },
];

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** HTML → 纯文本兜底：去标签、解实体、压缩空白（不引第三方库）。 */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 统一页脚：渲染时由代码追加，模板作者改不到（§4.4）。 */
function footerHtml(siteUrl, contactEmail) {
  return (
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">` +
    `<p style="color:#6b7280;font-size:12px;line-height:1.6">SteamDeals · ${escapeHtml(siteUrl)} · 联系 ${escapeHtml(contactEmail)}<br>本邮件由系统自动发送，请勿直接回复。</p>`
  );
}
function footerText(siteUrl, contactEmail) {
  return `\n---\nSteamDeals · ${siteUrl} · 联系 ${contactEmail}\n本邮件由系统自动发送，请勿直接回复。`;
}

/**
 * 渲染模板：变量全部 HTML 转义；白名单外的变量原样保留（保存时提示）；
 * bodyText 为空时从 bodyHtml 自动生成纯文本兜底；页脚追加在正文之后。
 */
export function renderTemplate({ subject, bodyHtml, bodyText = '', vars = {} }) {
  const values = { siteName: 'SteamDeals', siteUrl: '', username: '', action: '', time: '', operator: '站点管理员', contactEmail: '', ...vars };
  const fill = (src) => String(src ?? '').replace(/\{\{(\w+)\}\}/g, (whole, name) => {
    if (!(name in values)) return whole; // 未知变量原样保留
    return escapeHtml(values[name]);
  });
  const html = fill(bodyHtml) + footerHtml(values.siteUrl, values.contactEmail);
  const text = (bodyText ? fill(bodyText) : htmlToText(fill(bodyHtml))) + footerText(values.siteUrl, values.contactEmail);
  return { subject: fill(subject), html, text };
}

/** 模板里出现了白名单之外的 {{xxx}} → 返回未知变量名列表（保存时提示，不阻断）。 */
export function unknownVariables(bodyHtml, subject = '') {
  const seen = new Set();
  const scan = (src) => {
    for (const m of String(src ?? '').matchAll(/\{\{(\w+)\}\}/g)) {
      if (!TEMPLATE_VARIABLES.includes(m[1])) seen.add(m[1]);
    }
  };
  scan(bodyHtml);
  scan(subject);
  return [...seen];
}

/** 预览 / 测试邮件的示例变量（docs §4.3 preview/test）。 */
export function templateVarsForPreview(event, to = '', contactEmail = '') {
  return {
    siteUrl: 'https://steamdeals.example.com',
    username: 'demo_user',
    action: event === 'verify_code' ? '登录' : '示例动作说明',
    time: '2026-11-06 12:00',
    operator: '站点管理员',
    contactEmail: contactEmail || 'admin@example.com',
    code: event === 'verify_code' ? '123456' : '',
    to,
  };
}

/** 合并 DB 行与代码默认：返回 { subject, bodyHtml, bodyText, enabled, isDefault }。 */
export async function resolveTemplate(q, event) {
  const def = DEFAULT_TEMPLATES[event] ?? { subject: '', bodyHtml: '', bodyText: '' };
  const r = await q('select subject, body_html, body_text, enabled from mail_templates where event = $1', [event]);
  const row = r.rows[0];
  return row
    ? { subject: row.subject, bodyHtml: row.body_html, bodyText: row.body_text, enabled: Boolean(row.enabled), isDefault: false }
    : { subject: def.subject, bodyHtml: def.bodyHtml, bodyText: def.bodyText, enabled: true, isDefault: true };
}

/**
 * PUT 模板的保存前校验（docs §4.3/§7.4-5，纯函数便于测试）：
 * 主题去 CR/LF 且 ≤200、HTML ≤20000、非验证码事件禁 {{code}}；未知变量不阻断，返回 warnings。
 */
export function validateTemplatePayload(event, { subject = '', bodyHtml = '', bodyText = null }) {
  const cleanSubject = String(subject ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!cleanSubject || cleanSubject.length > 200) return { ok: false, error: '主题必填且不超过 200 字（已去除换行）' };
  const html = String(bodyHtml ?? '');
  if (html.length > 20000) return { ok: false, error: 'HTML 正文不超过 20000 字' };
  if (event !== 'verify_code' && /\{\{\s*code\s*\}\}/.test(html)) {
    return { ok: false, error: '只有验证码模板可以使用 {{code}} 变量' };
  }
  const warnings = unknownVariables(html, cleanSubject).map((name) => `未知变量：${name}（已保存，将原样显示）`);
  return { ok: true, subject: cleanSubject, bodyHtml: html, bodyText, warnings };
}
