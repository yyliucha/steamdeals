// 账号变更通知（docs/USER-LIFECYCLE.md §4.2，AJ 批）：
// 7 类管理操作 → 8 类邮件事件（禁用/启用/删除/改名/改邮箱/改角色/重置密码 + 邮箱绑定成功）
// 统一在这里发：读模板（表 → 默认值）→ 模板停用跳过 → 渲染（变量全部 HTML 转义）→ 追加统一页脚 →
// SMTP 发送（单封超时 8 秒、失败不重试）→ 每次真实发送写一行 mail_log（成功/失败都落）。
// 串行队列：同一进程内一封一封发，避免 SMTP 并发被限流。
// 创建用户不通知（初始密码由管理员当面给）；批量禁用/启用不走本模块（决策 9）。
// 邮件失败绝不影响业务操作：所有路径都返回 { status, error? }，本模块不向外抛异常。

import * as mailTemplates from './mail-templates.js';
import { sendMail } from './notify.js';
import { smtpConfig, isSmtpConfigured } from './email-auth.js';
import * as db from './store/pg.js';
import { maskEmail } from './auth-routes.js';

/** 8 类账号通知事件白名单（与 mail-templates 的 TEMPLATE_EVENTS 里账号通知部分一致）。 */
export const NOTIFY_ACTIONS = [
  'account_disabled',
  'account_enabled',
  'account_deleted',
  'account_renamed',
  'account_email_changed',
  'account_email_bound',
  'account_role_changed',
  'account_password_reset',
];

/**
 * {{time}} 用站点时区（跟随 system.timezone / env TZ），格式 YYYY-MM-DD HH:mm。
 * 时区非法时回落服务器本地时间（与 src/log.js 的白名单校验同精神）。
 */
export function timeInZone(now = new Date(), tz = process.env.TZ || 'Asia/Shanghai') {
  try {
    const fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const value = fmt.format(now); // sv-SE："2026-11-06 17:45"
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) throw new Error('unexpected format');
    return value;
  } catch {
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
  }
}

/** 失败收尾：写 mail_log（ok=false + 错误）、记日志事件，返回统一的 failed 状态，绝不抛异常。 */
async function recordFailure({ q, logger, action, user, recipient, subject, error, actor }) {
  const message = String(error ?? '发送失败').slice(0, 300);
  try {
    await db.insertMailLog(q, {
      event: action,
      toEmail: recipient,
      subject,
      ok: false,
      error: message,
      actor,
    });
  } catch {
    /* mail_log 写失败不影响业务结果 */
  }
  logger?.error('admin.user_notify_failed', {
    action,
    username: user?.username ?? null,
    to: maskEmail(recipient),
    error: message,
  });
  return { status: 'failed', error: message };
}

/**
 * 发一封账号通知。返回：
 *   { status: 'sent' }              成功（已写 mail_log ok=true）
 *   { status: 'skipped_no_email' }  收件人不存在（未绑定邮箱）
 *   { status: 'skipped_disabled' }  该事件模板已停用
 *   { status: 'failed', error }     SMTP 未配置 / 发送失败（业务操作不受影响）
 */
export async function notifyUserAction({
  q,
  logger = null,
  user,                     // { username, email, ... }
  action,                   // NOTIFY_ACTIONS 之一
  operator = '站点管理员',   // 模板里展示的操作者（决策 15：不暴露具体管理员）
  actor = 'system',         // mail_log.actor：触发者（管理员用户名 / 'system'）
  siteUrl = '',
  contactEmail = '',
  to = null,                // 覆盖收件人（改邮箱时用旧邮箱）
  extra = {},               // 模板变量补充（{{action}} 文案等）
  env = process.env,
  send = sendMail,          // 测试注入假发送器
}) {
  const recipient = String(to ?? user?.email ?? '').trim();
  if (!recipient) {
    logger?.info('admin.user_notify_skipped', { action, username: user?.username ?? null, reason: 'no_email' });
    return { status: 'skipped_no_email' };
  }
  let tpl = null;
  try {
    tpl = await mailTemplates.resolveTemplate(q, action);
  } catch (err) {
    return recordFailure({
      q, logger, action, user, recipient, subject: null, actor,
      error: `读模板失败：${String(err?.message ?? err).slice(0, 160)}`,
    });
  }
  if (!tpl) return { status: 'failed', error: `未知通知事件：${action}` };
  if (!tpl.enabled) {
    logger?.info('admin.user_notify_skipped', { action, username: user?.username ?? null, reason: 'template_disabled' });
    return { status: 'skipped_disabled' };
  }

  let cfg = null;
  try {
    cfg = await smtpConfig(q, env);
  } catch (err) {
    return recordFailure({
      q, logger, action, user, recipient, subject: tpl.subject, actor,
      error: `SMTP 配置读取失败：${String(err?.message ?? err).slice(0, 160)}`,
    });
  }
  if (!isSmtpConfigured(cfg)) {
    return recordFailure({ q, logger, action, user, recipient, subject: tpl.subject, actor, error: 'SMTP 未配置' });
  }

  const rendered = mailTemplates.renderTemplate({
    subject: tpl.subject,
    bodyHtml: tpl.bodyHtml,
    bodyText: tpl.bodyText ?? '',
    vars: {
      username: user?.username ?? '',
      action: extra.action ?? '',
      time: timeInZone(),
      operator,
      siteUrl,
      contactEmail,
    },
  });
  try {
    const result = await send(
      { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from, to: recipient, subject: rendered.subject, text: rendered.text, html: rendered.html },
      { logger, timeoutMs: 8000 },
    );
    if (!result?.ok) {
      return recordFailure({ q, logger, action, user, recipient, subject: rendered.subject, actor, error: result?.error ?? '发送失败' });
    }
    try {
      await db.insertMailLog(q, { event: action, toEmail: recipient, subject: rendered.subject, ok: true, actor });
    } catch {
      /* 记录失败不吞成功状态 */
    }
    logger?.info('admin.user_notify_sent', { action, username: user?.username ?? null, to: maskEmail(recipient), actor });
    return { status: 'sent' };
  } catch (err) {
    return recordFailure({ q, logger, action, user, recipient, subject: rendered.subject, actor, error: String(err?.message ?? err) });
  }
}

// ---------------------------------------------------------------- 串行队列（§4.2）

/** 模块级队列：同一进程内一封一封发。 */
let queue = Promise.resolve();

/**
 * 排队发送（PATCH/重置密码 await 它拿到结果；删除/改邮箱 fire-and-forget）。
 * 返回的 promise 永不 reject（失败已收敛成 status: 'failed'）。
 */
export function notifyUserActionQueued(opts) {
  const run = queue.then(() => notifyUserAction(opts));
  queue = run.then(
    () => {},
    () => {},
  );
  return run;
}

/** 等队列排空（测试与删除/改邮箱的异步发送收尾用）。 */
export function waitForNotifyQueue() {
  return queue;
}
