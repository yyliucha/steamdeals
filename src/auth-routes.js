// 邮箱验证码相关路由：发送验证码、校验登录/重置密码、更换登录邮箱（CZ 批）。
// 单独成模块，避免把 server.js 的主 handler 越堆越长。
//
// 日志策略（用户要求"部署后靠日志定位"）：
//   auth.otp_requested  发码请求（邮箱脱敏、用途、结果）
//   auth.otp_failed     发码失败（原因：smtp 未配置 / 发送异常 / 频率限制）
//   auth.otp_verified   校验成功（登录或改密）
//   auth.otp_rejected   校验失败（过期/未找到/次数超限/码错误）
//   auth.email_changed  CZ 批换邮箱成功（含下线会话数，邮箱脱敏）
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
import { sessionCookie, SESSION_COOKIE_NAME } from './session-cookie.js';
import { baseUrl } from './steam-login.js';
import { appealEmailFrom } from './appeal.js';
import { renderTemplate, resolveTemplate } from './mail-templates.js';
import { passwordPolicyError } from './password-policy.js';
import { formatDateTime } from './format.js';

export function maskEmail(email) {
  const v = String(email ?? '');
  const at = v.indexOf('@');
  if (at <= 0) return '***';
  const name = v.slice(0, at);
  const keep = name.length <= 2 ? 1 : 2;
  return `${name.slice(0, keep)}***${v.slice(at)}`;
}

// ---------------------------------------------------------------- CZ 批：更换登录邮箱（docs/EMAIL-CHANGE.md）

// 规格决策 3：验证码 10 分钟有效（登录码是 5 分钟，换邮箱窗口更长）、最多 5 次尝试；
// 同一用户 24 小时内最多成功更换 1 次（按已用码记录计数，成功才算）。
const CHANGE_EMAIL_TTL_SEC = 600;
const EMAIL_CHANGE_MIN_INTERVAL_SEC = 86400;

/** 与 server.js 的 parseCookies 同语义（auth 路由无法从 server.js 导入，避免循环依赖）。 */
function parseCookiesLocal(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * 换邮箱请求的会话解析：Bearer 优先、Cookie 兜底（与 server.js 主线一致）。
 * Bearer 是 App Token（api_tokens 表，sha256 哈希），Cookie 是 Web 会话（sessions 表）——两张表分开查。
 * 主线对同一请求已先做过空闲/绑定校验（不一致会先删行才放行到本模块），
 * 因此这里直接复查（自带 disabled / 过期 / 撤销过滤）即与主线安全等价。
 */
async function resolveChangeUser({ req, q }) {
  const bearerMatch = /^Bearer\s+([A-Za-z0-9_-]{16,})$/i.exec(String(req.headers.authorization ?? ''));
  const cookies = parseCookiesLocal(req.headers.cookie);
  const token = bearerMatch ? bearerMatch[1] : (cookies[SESSION_COOKIE_NAME] ?? null);
  if (!token) return null;
  try {
    const { userBySession, userByApiToken } = await import('./store/pg.js');
    if (bearerMatch) return await userByApiToken(q, token);
    return await userBySession(q, token);
  } catch {
    return null;
  }
}

/**
 * 换邮箱审计落库。audit_logs 表由 store 迁移提供（CY 批）；
 * 审计失败绝不阻塞主流程（与 writeAuditLog 同语义），表未建 / 写入失败一律吞掉。
 */
async function writeEmailAudit(q, { actorId, actor, action, target, detail, ip }) {
  try {
    await q(
      'insert into audit_logs (actor_id, actor, action, target, detail, ip) values ($1, $2, $3, $4, $5::jsonb, $6)',
      [actorId, actor, String(action), target == null ? null : String(target), detail ? JSON.stringify(detail) : null, ip ?? null],
    );
  } catch {
    /* 审计失败不影响主流程 */
  }
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
          time: formatDateTime(expiryAt),
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
          time: formatDateTime(expiryAt),
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

  // ---------------- CZ 批（docs/EMAIL-CHANGE.md §3）：更换登录邮箱 ----------------
  if (path === '/api/me/email/request') {
    const isBearer = /^Bearer\s+/i.test(String(req.headers.authorization ?? ''));
    const me = await resolveChangeUser({ req, q });
    if (!me) {
      json(res, 401, { error: isBearer ? 'login_required' : '需要登录' });
      return true;
    }
    const body = await readBody(req);
    const email = normalizeEmail(body.newEmail);
    if (!email) {
      json(res, 400, { error: '邮箱格式不正确' });
      return true;
    }
    // Bearer 会话（App）解析结果不含 email，这里单独取当前邮箱做「新旧相同」防呆
    const meEmailRow = (await q('select email from users where id = $1', [me.id])).rows[0];
    if (String(meEmailRow?.email ?? '').toLowerCase() === email) {
      json(res, 400, { error: '新邮箱与当前邮箱相同' });
      return true;
    }
    // 24 小时频控：按「已成功换过」计数（used_at 非空），失败尝试不占额度
    const lastChange = await q(
      "select used_at from email_codes where user_id = $1 and purpose = 'change_email' and used_at is not null order by used_at desc limit 1",
      [me.id],
    );
    const lastAt = lastChange.rows[0]?.used_at;
    if (lastAt) {
      const until = new Date(lastAt).getTime() + EMAIL_CHANGE_MIN_INTERVAL_SEC * 1000;
      if (until > Date.now()) {
        const retryAfterSec = Math.ceil((until - Date.now()) / 1000);
        logger?.warn('auth.email_change_rate_limited', { userId: me.id, retryAfterSec });
        json(res, 429, { error: '24 小时内只能更换一次邮箱，请稍后再试', retryAfterSec });
        return true;
      }
    }
    // 发码频率复用现有三级限流：同邮箱冷却/小时上限、同 IP 小时上限、全站每日上限
    const recent = await q(
      'select created_at, sent_ok from email_codes where email = $1 order by created_at desc limit 20',
      [email],
    );
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
    const dailyCount = (await q(
      "select count(*)::int as n from email_codes where sent_ok is not false and created_at > now() - interval '1 day'",
    )).rows[0]?.n ?? 0;
    const dailyLimit = checkGlobalDailyLimit(dailyCount);
    if (!dailyLimit.ok) {
      json(res, 429, { error: '今天系统发信量已达上限，请明天再试或联系管理员' });
      return true;
    }

    const cfg = await smtpConfig(q);
    if (!isSmtpConfigured(cfg)) {
      logger?.warn('auth.otp_failed', { purpose: 'change_email', reason: 'smtp_not_configured' });
      json(res, 503, { error: '系统还没有配置发信邮箱，请联系管理员' });
      return true;
    }

    // 不泄露占用（规格决策）：新邮箱已被他人占用时**静默跳过发信**，响应与正常发码完全一致。
    // 占用只会在 verify 的验证码通过后才提示 409——黑盒不可探测占用情况，也不给第三方邮箱发骚扰验证码。
    const occupied = await q('select id from users where email = $1 and id <> $2', [email, me.id]);
    if (occupied.rows[0]) {
      logger?.info('auth.change_email_code_skipped_occupied', { userId: me.id, email: maskEmail(email) });
      json(res, 200, { ok: true, hint: '如果邮箱可用，验证码将发送到该邮箱' });
      return true;
    }

    const code = generateCode();
    // 验证码邮件套用 verify_code 模板；模板被停用时回退内置纯文本（验证码是功能性邮件，不能断发）。
    const tpl = await resolveTemplate(q, 'verify_code').catch(() => null);
    const expiryAt = new Date(Date.now() + CHANGE_EMAIL_TTL_SEC * 1000);
    let subject = 'SteamDeals 更换邮箱验证码';
    let text =
      `你的验证码是：${code}\n` +
      '用途：更换登录邮箱\n' +
      `有效期：${Math.round(CHANGE_EMAIL_TTL_SEC / 60)} 分钟，用完即失效。\n` +
      '如果不是你本人操作，请忽略这封邮件。';
    let html = null;
    if (tpl?.enabled) {
      const rendered = renderTemplate({
        subject: tpl.subject,
        bodyHtml: tpl.bodyHtml,
        bodyText: tpl.bodyText ?? '',
        vars: {
          username: me.username,
          action: '更换邮箱',
          time: formatDateTime(expiryAt),
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
       values ($1, $2, 'change_email', $3, $4, $5, $6, now() + ($7 || ' seconds')::interval)
       returning id`,
      [email, me.id, hashCode(email, code), subject, '验证码邮件正文未保存。', senderIp, String(CHANGE_EMAIL_TTL_SEC)],
    );
    const id = inserted.rows[0].id;
    try {
      const sent = await sendMail(
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
      if (!sent?.ok) throw new Error(sent?.error ?? '发送失败');
      await q('update email_codes set sent_ok = true where id = $1', [id]);
      logger?.info('auth.otp_requested', { email: maskEmail(email), purpose: 'change_email', sent: true });
      json(res, 200, { ok: true, hint: '如果邮箱可用，验证码将发送到该邮箱' });
    } catch (err) {
      const message = String(err.message).slice(0, 200);
      await q('update email_codes set sent_ok = false, error = $1 where id = $2', [message, id]);
      logger?.error('auth.otp_failed', { email: maskEmail(email), purpose: 'change_email', reason: 'send_error', message });
      json(res, 200, { ok: true, hint: '如果邮箱可用，验证码将发送到该邮箱' });
    }
    return true;
  }

  if (path === '/api/me/email/verify') {
    const isBearer = /^Bearer\s+/i.test(String(req.headers.authorization ?? ''));
    const me = await resolveChangeUser({ req, q });
    if (!me) {
      json(res, 401, { error: isBearer ? 'login_required' : '需要登录' });
      return true;
    }
    const body = await readBody(req);
    const email = normalizeEmail(body.newEmail);
    const code = String(body.code ?? '').trim();
    if (!email || !/^\d{6}$/.test(code)) {
      json(res, 400, { error: '邮箱或验证码格式不正确' });
      return true;
    }

    const found = await q(
      `select id, user_id, code_hash, attempts, expires_at, used_at
         from email_codes
        where email = $1 and purpose = 'change_email' and used_at is null
        order by created_at desc limit 1`,
      [email],
    );
    const row = found.rows[0];
    // 验证码必须属于当前登录用户：查不到 / 归属他人一律按「没有可用的验证码」处理（不泄露他人状态）
    if (!row || Number(row.user_id) !== Number(me.id)) {
      logger?.warn('auth.otp_rejected', { email: maskEmail(email), purpose: 'change_email', reason: 'no_code' });
      json(res, 400, { error: '没有可用的验证码，请重新获取' });
      return true;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      logger?.warn('auth.otp_rejected', { email: maskEmail(email), purpose: 'change_email', reason: 'expired' });
      json(res, 400, { error: '验证码已过期，请重新获取' });
      return true;
    }
    if (row.attempts >= CODE_MAX_ATTEMPTS) {
      logger?.warn('auth.otp_rejected', { email: maskEmail(email), purpose: 'change_email', reason: 'too_many_attempts' });
      json(res, 429, { error: '尝试次数过多，请重新获取验证码' });
      return true;
    }
    if (!verifyCodeHash(email, code, row.code_hash)) {
      await q('update email_codes set attempts = attempts + 1 where id = $1', [row.id]);
      logger?.warn('auth.otp_rejected', { email: maskEmail(email), purpose: 'change_email', reason: 'wrong_code', attempts: row.attempts + 1 });
      json(res, 400, { error: '验证码不正确' });
      return true;
    }

    // ---- 验证码已通过：以下检查的结果才允许暴露（不泄露给未通过验证码的人）----
    // ① 24 小时频控（先于占用检查——避免用 429/409 的差异反推占用情况）
    const lastChange = await q(
      "select used_at from email_codes where user_id = $1 and purpose = 'change_email' and used_at is not null order by used_at desc limit 1",
      [me.id],
    );
    const lastAt = lastChange.rows[0]?.used_at;
    if (lastAt) {
      const until = new Date(lastAt).getTime() + EMAIL_CHANGE_MIN_INTERVAL_SEC * 1000;
      if (until > Date.now()) {
        const retryAfterSec = Math.ceil((until - Date.now()) / 1000);
        logger?.warn('auth.email_change_rate_limited', { userId: me.id, retryAfterSec });
        json(res, 429, { error: '24 小时内只能更换一次邮箱，请稍后再试', retryAfterSec });
        return true;
      }
    }
    // ② 新邮箱已被他人占用 → 409（规格：验证码通过后才提示）
    const occupied = await q('select id from users where email = $1 and id <> $2', [email, me.id]);
    if (occupied.rows[0]) {
      await q('update email_codes set used_at = now() where id = $1', [row.id]);
      logger?.warn('auth.email_change_conflict', { userId: me.id, email: maskEmail(email) });
      json(res, 409, { error: '该邮箱不可用' });
      return true;
    }

    // 校验通过：作废验证码（防重放），更新邮箱并下线全部会话
    await q('update email_codes set used_at = now() where id = $1', [row.id]);
    const meRow = (await q('select email, email_verified from users where id = $1', [me.id])).rows[0];
    const oldEmail = String(meRow?.email ?? '').trim();
    const oldVerified = meRow?.email_verified === true;

    const setEmail = () =>
      q('update users set email = $1, email_verified = true, email_updated_at = now() where id = $2 returning id, username, email', [
        email,
        me.id,
      ]);
    try {
      await setEmail();
    } catch (err) {
      // 老库可能没有 email_updated_at 列：补建后重试一次；唯一约束冲突 = 并发占用 → 409
      if (String(err.code) === '42703') {
        await q('alter table users add column if not exists email_updated_at timestamptz');
        await setEmail();
      } else if (String(err.code) === '23505') {
        json(res, 409, { error: '该邮箱不可用' });
        return true;
      } else {
        throw err;
      }
    }
    const { deleteSessionsOfUser } = await import('./store/pg.js');
    const removed = await deleteSessionsOfUser(q, me.id).catch(() => 0);
    // App Bearer Token 一并撤销：换邮箱后所有设备（Web 会话 + App 登录态）全部下线
    const revokedTokens = await q('update api_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [
      me.id,
    ]).catch(() => null);
    const tokensRevoked = revokedTokens?.rowCount ?? 0;
    logger?.info('auth.email_changed', {
      userId: me.id,
      username: me.username,
      sessionsRemoved: removed,
      tokensRevoked,
      oldEmail: maskEmail(oldEmail),
      newEmail: maskEmail(email),
    });

    await writeEmailAudit(q, {
      actorId: me.id,
      actor: me.username,
      action: 'auth.email_changed',
      target: me.username,
      detail: { oldEmail: maskEmail(oldEmail), newEmail: maskEmail(email), sessionsRemoved: removed, tokensRevoked },
      ip,
    });

    // 双邮件（AJ 批队列，失败不影响换邮箱结果）：
    // 旧邮箱收「登录邮箱已变更」安全通知（旧邮箱为空/未验证时改发新邮箱）；新邮箱收「绑定成功」。
    const { notifyUserActionQueued } = await import('./account-notify.js');
    const oldUsable = Boolean(oldEmail && oldVerified);
    const notifyBase = {
      q,
      logger,
      user: { username: me.username, email },
      actor: me.username,
      siteUrl: baseUrl(req),
      contactEmail: appealEmailFrom(process.env),
      extra: { action: maskEmail(email) },
    };
    void notifyUserActionQueued({ ...notifyBase, action: 'account_email_changed', to: oldUsable ? oldEmail : email });
    void notifyUserActionQueued({ ...notifyBase, action: 'account_email_bound', to: email });
    json(res, 200, { ok: true, message: '邮箱已更新，请用新邮箱重新登录' });
    return true;
  }

  return false;
}
