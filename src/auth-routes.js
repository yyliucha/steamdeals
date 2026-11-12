// 邮箱验证码相关路由：发送验证码、校验登录/重置密码。
// 单独成模块，避免把 server.js 的主 handler 越堆越长。
//
// 日志策略（用户要求"部署后靠日志定位"）：
//   auth.otp_requested  发码请求（邮箱脱敏、用途、结果）
//   auth.otp_failed     发码失败（原因：smtp 未配置 / 发送异常 / 频率限制）
//   auth.otp_verified   校验成功（登录或改密）
//   auth.otp_rejected   校验失败（过期/未找到/次数超限/码错误）
import {
  generateCode,
  hashCode,
  verifyCodeHash,
  normalizeEmail,
  checkRateLimit,
  checkIpRateLimit,
  checkGlobalDailyLimit,
  SEND_DAILY_GLOBAL_LIMIT,
  smtpConfig,
  isSmtpConfigured,
  CODE_TTL_SEC,
  CODE_MAX_ATTEMPTS,
} from './email-auth.js';
import { sendMail } from './notify.js';
import { clientIp } from './visitors.js';
import { sessionCookie } from './session-cookie.js';
import { baseUrl } from './steam-login.js';
import { appealEmailFrom } from './appeal.js';
import { renderTemplate, resolveTemplate } from './mail-templates.js';
import { passwordPolicyError } from './password-policy.js';

export function maskEmail(email) {
  const v = String(email ?? '');
  const at = v.indexOf('@');
  if (at <= 0) return '***';
  const name = v.slice(0, at);
  const keep = name.length <= 2 ? 1 : 2;
  return `${name.slice(0, keep)}***${v.slice(at)}`;
}

/** 返回 true 表示这个请求已被本模块处理。captcha 由 server.js 传入（AK-3 注册用）。 */
export async function handleEmailAuth({ path, req, res, q, logger, json, readBody, captcha = null, ip = null }) {
  if (req.method !== 'POST') return false;

  // ---------------- 发送验证码 ----------------
  if (path === '/api/auth/email/request') {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const purpose = body.purpose === 'reset' ? 'reset' : 'login';
    if (!email) {
      json(res, 400, { error: '邮箱格式不正确' });
      return true;
    }

    const recent = await q(
      'select created_at, sent_ok from email_codes where email = $1 order by created_at desc limit 20',
      [email],
    );
    const limit = checkRateLimit(recent.rows);
    if (!limit.ok) {
      logger?.warn('auth.otp_failed', {
        email: maskEmail(email),
        purpose,
        reason: limit.reason,
        retryAfterSec: limit.retryAfterSec,
      });
      json(res, 429, {
        error: limit.reason === 'cooldown' ? `请 ${limit.retryAfterSec} 秒后再试` : '发送过于频繁，请稍后再试',
        retryAfterSec: limit.retryAfterSec,
      });
      return true;
    }

    // 防止拿同一台机器换着邮箱轰炸：按来源 IP 限流 + 全站每日上限
    const senderIp = clientIp(req);
    const ipRecent = await q(
      "select created_at, sent_ok from email_codes where ip = $1 and created_at > now() - interval '1 hour' order by created_at desc limit 50",
      [senderIp],
    );
    const ipLimit = checkIpRateLimit(ipRecent.rows);
    if (!ipLimit.ok) {
      logger?.warn('auth.otp_ip_limited', { ip: senderIp, reason: ipLimit.reason, retryAfterSec: ipLimit.retryAfterSec });
      json(res, 429, { error: '这个网络发送验证码太频繁，请稍后再试', retryAfterSec: ipLimit.retryAfterSec });
      return true;
    }
    const dailyCount = (await q(
      "select count(*)::int as n from email_codes where sent_ok is not false and created_at > now() - interval '1 day'",
    )).rows[0]?.n ?? 0;
    const dailyLimit = checkGlobalDailyLimit(dailyCount);
    if (!dailyLimit.ok) {
      logger?.warn('auth.otp_daily_limited', { count: dailyCount, limit: SEND_DAILY_GLOBAL_LIMIT });
      json(res, 429, { error: '今天系统发信量已达上限，请明天再试或联系管理员' });
      return true;
    }

    const cfg = await smtpConfig(q);
    if (!isSmtpConfigured(cfg)) {
      logger?.warn('auth.otp_failed', { purpose, reason: 'smtp_not_configured' });
      json(res, 503, { error: '系统还没有配置发信邮箱，请联系管理员' });
      return true;
    }

    const userRow = await q('select id, username, disabled, email_verified from users where email = $1', [email]);
    const target = userRow.rows[0] ?? null;
    if (!target || target.disabled || target.email_verified !== true) {
      logger?.warn('auth.otp_failed', {
        email: maskEmail(email), purpose,
        reason: !target ? 'email_not_bound' : target.disabled ? 'user_disabled' : 'email_unverified',
      });
      json(res, 200, { ok: true, hint: '如果邮箱已绑定且可用，验证码将发送到该邮箱' });
      return true;
    }

    const code = generateCode();
    // AI 批（docs/USER-LIFECYCLE.md §5.2）：验证码邮件套用 verify_code 模板；
    // 模板被停用时回退内置纯文本（验证码是功能性邮件，不能因模板停用而断发）。
    const tpl = await resolveTemplate(q, 'verify_code').catch(() => null);
    const expiryAt = new Date(Date.now() + CODE_TTL_SEC * 1000);
    let subject = purpose === 'reset' ? 'SteamDeals 重置密码验证码' : 'SteamDeals 登录验证码';
    let text =
      `你的验证码是：${code}\n` +
      `用途：${purpose === 'reset' ? '重置密码' : '登录'}\n` +
      `有效期：${Math.round(CODE_TTL_SEC / 60)} 分钟，用完即失效。\n` +
      '如果不是你本人操作，请忽略这封邮件。';
    let html = null;
    if (tpl?.enabled) {
      const rendered = renderTemplate({
        subject: tpl.subject,
        bodyHtml: tpl.bodyHtml,
        bodyText: tpl.bodyText ?? '',
        vars: {
          username: target.username,
          action: purpose === 'reset' ? '重置密码' : '登录',
          time: `${String(expiryAt.getFullYear()).padStart(4, '0')}-${String(expiryAt.getMonth() + 1).padStart(2, '0')}-${String(expiryAt.getDate()).padStart(2, '0')} ${String(expiryAt.getHours()).padStart(2, '0')}:${String(expiryAt.getMinutes()).padStart(2, '0')}`,
          code,
          siteUrl: baseUrl(req),
          contactEmail: appealEmailFrom(process.env),
        },
      });
      subject = rendered.subject;
      text = rendered.text;
      html = rendered.html;
    }
    const inserted = await q(
      `insert into email_codes (email, user_id, purpose, code_hash, subject, body, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval)
       returning id`,
      [email, target.id, purpose, hashCode(email, code), subject, '验证码邮件正文未保存。', String(CODE_TTL_SEC)],
    );
    const id = inserted.rows[0].id;

    try {
      await sendMail(
        {
          host: cfg.host,
          port: cfg.port,
          secure: cfg.secure,
          user: cfg.user,
          pass: cfg.pass,
          from: cfg.from,
          to: email,
          subject,
          text,
          html,
        },
        { logger },
      );
      await q('update email_codes set sent_ok = true where id = $1', [id]);
      logger?.info('auth.otp_requested', { email: maskEmail(email), purpose, sent: true });
      json(res, 200, { ok: true, hint: '如果邮箱已绑定且可用，验证码将发送到该邮箱' });
    } catch (err) {
      const message = String(err.message).slice(0, 200);
      await q('update email_codes set sent_ok = false, error = $1 where id = $2', [message, id]);
      logger?.error('auth.otp_failed', { email: maskEmail(email), purpose, reason: 'send_error', message });
      json(res, 200, { ok: true, hint: '如果邮箱已绑定且可用，验证码将发送到该邮箱' });
    }
    return true;
  }

  // ---------------- 校验验证码 ----------------
  if (path === '/api/auth/email/verify') {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const code = String(body.code ?? '').trim();
    const purpose = body.purpose === 'reset' ? 'reset' : 'login';
    if (!email || !/^\d{6}$/.test(code)) {
      json(res, 400, { error: '邮箱或验证码格式不正确' });
      return true;
    }

    const found = await q(
      `select id, user_id, code_hash, attempts, expires_at, used_at
         from email_codes
        where email = $1 and purpose = $2 and used_at is null
        order by created_at desc limit 1`,
      [email, purpose],
    );
    const row = found.rows[0];
    if (!row) {
      logger?.warn('auth.otp_rejected', { email: maskEmail(email), purpose, reason: 'no_code' });
      json(res, 400, { error: '没有可用的验证码，请重新获取' });
      return true;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      logger?.warn('auth.otp_rejected', { email: maskEmail(email), purpose, reason: 'expired' });
      json(res, 400, { error: '验证码已过期，请重新获取' });
      return true;
    }
    if (row.attempts >= CODE_MAX_ATTEMPTS) {
      logger?.warn('auth.otp_rejected', { email: maskEmail(email), purpose, reason: 'too_many_attempts' });
      json(res, 429, { error: '尝试次数过多，请重新获取验证码' });
      return true;
    }
    if (!verifyCodeHash(email, code, row.code_hash)) {
      await q('update email_codes set attempts = attempts + 1 where id = $1', [row.id]);
      logger?.warn('auth.otp_rejected', { email: maskEmail(email), purpose, reason: 'wrong_code', attempts: row.attempts + 1 });
      json(res, 400, { error: '验证码不正确' });
      return true;
    }

    const resetPassword = purpose === 'reset' ? String(body.password ?? '') : null;
    if (purpose === 'reset') {
      // AK-1（docs/AUTH-REDESIGN.md §4.1）：自助重置统一走密码策略
      const policyError = passwordPolicyError(resetPassword, { email });
      if (policyError) {
        json(res, 400, { error: policyError });
        return true;
      }
    }

    // 校验通过：立刻作废，防止重放
    await q('update email_codes set used_at = now() where id = $1', [row.id]);

    if (purpose === 'reset') {
      const { setUserPassword } = await import('./store/pg.js');
      const updated = await setUserPassword(q, { username: null, userId: row.user_id, password: resetPassword });
      logger?.info('auth.otp_verified', { email: maskEmail(email), purpose: 'reset', ok: Boolean(updated) });
      json(res, 200, { ok: true, message: '密码已重置，请用新密码登录' });
      return true;
    }

    const userRow = await q('select id, username, role, disabled from users where id = $1', [row.user_id]);
    const account = userRow.rows[0];
    if (!account || account.disabled) {
      logger?.warn('auth.otp_rejected', { email: maskEmail(email), purpose, reason: 'account_unavailable' });
      json(res, 403, { error: '账号不可用' });
      return true;
    }
    const { createSession } = await import('./store/pg.js');
    const { ipSessionKey, uaSessionKey } = await import('./session-fingerprint.js');
    const token = await createSession(q, {
      userId: account.id,
      ip,
      ipKey: ipSessionKey(ip),
      userAgent: req.headers['user-agent'] ?? null,
      uaKey: uaSessionKey(req.headers['user-agent']),
    });
    logger?.info('auth.otp_verified', { email: maskEmail(email), purpose: 'login', username: account.username });
    json(
      res,
      200,
      { user: { id: account.id, username: account.username, role: account.role } },
      { 'set-cookie': sessionCookie(req, token, 604800) },
    );
    return true;
  }

  // ---------------- AK-3：自助注册（docs/AUTH-REDESIGN.md §4.6）----------------
  if (path === '/api/auth/register/request') {
    const body = await readBody(req);
    const username = String(body.username ?? '').trim();
    const email = normalizeEmail(body.email);
    if (!/^[^\s/]{3,32}$/.test(username)) {
      json(res, 400, { error: '用户名需要 3-32 个字符，且不能包含空格或斜杠' });
      return true;
    }
    if (!email) {
      json(res, 400, { error: '邮箱格式不正确' });
      return true;
    }
    if (captcha?.enabled?.()) {
      const okCaptcha = await captcha.verify(q, body.captchaToken, body.captchaAnswer);
      if (!okCaptcha) {
        json(res, 400, { error: '验证码错误或已过期，请重新输入' });
        return true;
      }
    }
    const cfg = await smtpConfig(q);
    if (!isSmtpConfigured(cfg)) {
      json(res, 503, { error: '系统暂不可注册（未配置发信邮箱），请联系管理员' });
      return true;
    }
    // 开关：app_settings（'0' = 关闭）优先，环境变量兜底；避免走 readSettings（需要密钥文件）
    const regRow = (await q("select value from app_settings where key = 'auth.registrationEnabled'")).rows[0];
    const regEnabled = regRow ? String(regRow.value) !== '0' : process.env.AUTH_REGISTRATION_ENABLED !== '0';
    if (!regEnabled) {
      json(res, 403, { error: '暂未开放注册，请联系管理员' });
      return true;
    }
    const dupUser = (await q('select id from users where username = $1', [username])).rows[0];
    if (dupUser) {
      json(res, 409, { error: '用户名已被使用' });
      return true;
    }
    const dupEmail = (await q('select id from users where email = $1', [email])).rows[0];
    if (dupEmail) {
      json(res, 409, { error: '邮箱已被注册' });
      return true;
    }
    // 发码频率：复用 email-auth 的三级限流（同邮箱冷却/小时上限、同 IP 小时上限、全站每日上限）
    const recent = await q('select created_at, sent_ok from email_codes where email = $1 order by created_at desc limit 20', [email]);
    const limit = checkRateLimit(recent.rows);
    if (!limit.ok) {
      json(res, 429, {
        error: limit.reason === 'cooldown' ? `请 ${limit.retryAfterSec} 秒后再试` : '发送过于频繁，请稍后再试',
        retryAfterSec: limit.retryAfterSec,
      });
      return true;
    }
    const senderIp = clientIp(req);
    const ipRecent = await q(
      "select created_at, sent_ok from email_codes where ip = $1 and created_at > now() - interval '1 hour' order by created_at desc limit 50",
      [senderIp],
    );
    const ipLimit = checkIpRateLimit(ipRecent.rows);
    if (!ipLimit.ok) {
      json(res, 429, { error: '这个网络发送验证码太频繁，请稍后再试', retryAfterSec: ipLimit.retryAfterSec });
      return true;
    }
    const dailyCount =
      (await q("select count(*)::int as n from email_codes where sent_ok is not false and created_at > now() - interval '1 day'")).rows[0]?.n ?? 0;
    const dailyLimit = checkGlobalDailyLimit(dailyCount);
    if (!dailyLimit.ok) {
      json(res, 429, { error: '今天系统发信量已达上限，请明天再试或联系管理员' });
      return true;
    }

    const code = generateCode();
    const tpl = await resolveTemplate(q, 'verify_code').catch(() => null);
    const expiryAt = new Date(Date.now() + CODE_TTL_SEC * 1000);
    let subject = 'SteamDeals 注册验证码';
    let text = `你的验证码是：${code}\n用途：注册账号\n有效期：${Math.round(CODE_TTL_SEC / 60)} 分钟，用完即失效。\n如果不是你本人操作，请忽略这封邮件。`;
    let html = null;
    if (tpl?.enabled) {
      const rendered = renderTemplate({
        subject: tpl.subject,
        bodyHtml: tpl.bodyHtml,
        bodyText: tpl.bodyText ?? '',
        vars: {
          username,
          action: '注册账号',
          time: `${String(expiryAt.getFullYear()).padStart(4, '0')}-${String(expiryAt.getMonth() + 1).padStart(2, '0')}-${String(expiryAt.getDate()).padStart(2, '0')} ${String(expiryAt.getHours()).padStart(2, '0')}:${String(expiryAt.getMinutes()).padStart(2, '0')}`,
          code,
          siteUrl: baseUrl(req),
          contactEmail: appealEmailFrom(process.env),
        },
      });
      subject = rendered.subject;
      text = rendered.text;
      html = rendered.html;
    }
    const inserted = await q(
      `insert into email_codes (email, user_id, purpose, code_hash, subject, body, ip, expires_at)
       values ($1, null, 'register', $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)
       returning id`,
      [email, hashCode(email, code), subject, '验证码邮件正文未保存。', senderIp, String(CODE_TTL_SEC)],
    );
    const id = inserted.rows[0].id;
    try {
      const sent = await sendMail(
        { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from, to: email, subject, text, html },
        { logger },
      );
      if (!sent?.ok) throw new Error(sent?.error ?? '发送失败');
      await q('update email_codes set sent_ok = true where id = $1', [id]);
      logger?.info('auth.otp_requested', { email: maskEmail(email), purpose: 'register', sent: true });
      json(res, 200, { ok: true, hint: '验证码已发送到邮箱，请查收' });
    } catch (err) {
      const message = String(err.message).slice(0, 200);
      await q('update email_codes set sent_ok = false, error = $1 where id = $2', [message, id]);
      logger?.error('auth.otp_failed', { email: maskEmail(email), purpose: 'register', reason: 'send_error', message });
      json(res, 200, { ok: true, hint: '如果邮箱可用，验证码将发送到该邮箱' });
    }
    return true;
  }

  if (path === '/api/auth/register/verify') {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const code = String(body.code ?? '').trim();
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    if (!email || !/^\d{6}$/.test(code)) {
      json(res, 400, { error: '邮箱或验证码格式不正确' });
      return true;
    }
    const found = await q(
      `select id, user_id, code_hash, attempts, expires_at, used_at from email_codes
        where email = $1 and purpose = 'register' and used_at is null
        order by created_at desc limit 1`,
      [email],
    );
    const row = found.rows[0];
    if (!row) {
      json(res, 400, { error: '没有可用的验证码，请先获取' });
      return true;
    }
    if (Date.parse(row.expires_at) < Date.now()) {
      json(res, 400, { error: '验证码已过期，请重新获取' });
      return true;
    }
    if (row.attempts >= CODE_MAX_ATTEMPTS) {
      json(res, 429, { error: '尝试次数过多，请重新获取验证码' });
      return true;
    }
    if (!verifyCodeHash(email, code, row.code_hash)) {
      await q('update email_codes set attempts = attempts + 1 where id = $1', [row.id]);
      json(res, 400, { error: '验证码不正确' });
      return true;
    }
    await q('update email_codes set used_at = now() where id = $1', [row.id]);
    if (!/^[^\s/]{3,32}$/.test(username)) {
      json(res, 400, { error: '用户名需要 3-32 个字符，且不能包含空格或斜杠' });
      return true;
    }
    const regRow = (await q("select value from app_settings where key = 'auth.registrationEnabled'")).rows[0];
    const regEnabled = regRow ? String(regRow.value) !== '0' : process.env.AUTH_REGISTRATION_ENABLED !== '0';
    if (!regEnabled) {
      json(res, 403, { error: '暂未开放注册，请联系管理员' });
      return true;
    }
    const policyError = passwordPolicyError(password, { username, email });
    if (policyError) {
      json(res, 400, { error: policyError });
      return true;
    }
    try {
      const { createUser, createSession } = await import('./store/pg.js');
      const { ipSessionKey, uaSessionKey } = await import('./session-fingerprint.js');
      const created = await createUser(q, { username, password, role: 'user', email });
      await q('update users set email_verified = true where id = $1', [created.id]);
      const token = await createSession(q, {
        userId: created.id,
        ip,
        ipKey: ipSessionKey(ip),
        userAgent: req.headers['user-agent'] ?? null,
        uaKey: uaSessionKey(req.headers['user-agent']),
      });
      logger?.info('auth.registered', { userId: created.id, username });
      json(
        res,
        201,
        { user: { id: created.id, username: created.username, role: created.role } },
        { 'set-cookie': sessionCookie(req, token, 604800) },
      );
    } catch (err) {
      if (String(err.code) === '23505') {
        const dupEmail = String(err.constraint ?? err.message ?? '').includes('email');
        json(res, 409, { error: dupEmail ? '邮箱已被注册' : '用户名已被使用' });
        return true;
      }
      throw err;
    }
    return true;
  }

  return false;
}
