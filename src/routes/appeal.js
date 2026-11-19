// CO-4/B4 第二轮（docs/DESIGN-AUDIT.md B4）：申诉域路由模块——从 src/server.js 巨石抽出的第二个域。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · POST /api/appeal                    O 批提交申诉（封禁拦截已放行；每 IP 3 条/小时 + 验证码 + 幂等）
//   · GET  /api/appeal/:code              O-7 申请人查进度（公开，限频，不回显 IP/指纹）
//   · POST /api/appeal/action             BQ 邮件动作（preview / trust / reject；token 即凭据）
//   · GET  /api/admin/appeals             O-5 后台列表（pending/done/all + 待处理计数）
//   · POST /api/admin/appeals/:id/resolve O-6 后台处理（unban_ip/unban_device/both/reject/note + 解封联动）
//
// 两个入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3）：
//   · handleAppealPublic(ctx)：公开段——必须在认证上下文解析（must_change_password 白名单）**之前**：
//     已登录但被要求改密的用户也要能提交申诉（原位置语义，移动 = 改契约）；
//   · handleAppealAdmin(ctx)：管理段——requireAdmin 就绪之后（与其它 admin 路由同段）。
// 与 App 试点域的差异：申诉没有"预检段"（拦截链豁免由 server.js 的 appealExempt 中间件承担），
// 而是按"用户解析前后"分两段——这是本域的位置硬约束。
//
// 留在 server.js 的中间件（作用于整个申诉命名空间，不属于本域路由）：
//   · appealPage/appealApi/appealExempt 判定与封禁拦截链豁免（O-3/QA 打回修复）；
//   · serveAppealPage（/appeal 页注入 __APPEAL__）、appealBucketLimited 限流桶（与 /api/captcha 共用）。
import { createHash, randomBytes } from 'node:crypto';
import * as db from '../store/pg.js';
import * as devices from '../devices.js';
import * as visitors from '../visitors.js';
import * as ratelimit from '../ratelimit.js';
import * as notify from '../notify.js';
import { normalizeEmail } from '../email-auth.js';
import { maskEmail } from '../auth-routes.js';
import { baseUrl } from '../steam-login.js';
import { appealAdminMail, appealResultMail, appealActionUrl } from '../appeal-mail.js';

// ---- 申诉系统（docs/APPEAL-SYSTEM.md §3，O 批）----
// 邮件发送：From=SMTP 账号、Reply-To 可指定；失败只记日志；两封都写发送记录（§6）。
async function sendAppealEmail(q, logger, { to, replyTo = null, subject, text, html, event }) {
  try {
    const auth = await import('../email-auth.js');
    const cfg = await auth.smtpConfig(q);
    if (!auth.isSmtpConfigured(cfg)) {
      logger?.info('appeal.notify_skipped', { event, reason: 'smtp_not_configured' });
      return { ok: false, skipped: true };
    }
    const result = await notify.sendMail(
      { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from, to, subject, text, html, replyTo },
      { logger },
    );
    await db.insertMailLog(q, { event, toEmail: to, subject, ok: result.ok, error: result.error ?? null }).catch(() => {});
    if (!result.ok) logger?.warn('appeal.mail_failed', { event, to, error: result.error });
    return result;
  } catch (err) {
    logger?.warn('appeal.mail_failed', { event, to, message: String(err.message).slice(0, 160) });
    return { ok: false, error: String(err.message).slice(0, 160) };
  }
}

// BQ 批（docs/APPEAL-SYSTEM.md §10.2）：邮件动作 token——32 字节随机（base64url），
// 库里只存 sha256 hex；明文只出现在邮件链接的 fragment 里。
function newActionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}

/** 申诉快照里的封禁原因文案（ip_abuse.ban_source → 人类可读）。 */
function appealBanReasonLabel(source) {
  if (source === 'rate') return '临时超频封禁';
  if (source === 'rate-day') return '当天超频封禁';
  if (source === 'path') return '非法路径封禁';
  return '自动封禁';
}

/** 管理员视角的申诉行：剥离 token 哈希（永不回显明文 token / 哈希）。 */
function appealRowPublic(r) {
  return {
    id: Number(r.id),
    code: r.code,
    ip: r.ip ?? null,
    device_id: r.device_id ?? null,
    fingerprint: r.fingerprint ?? null,
    reason: r.reason ?? null,
    ban_until: r.ban_until ?? null,
    contact: r.contact,
    message: r.message ?? '',
    status: r.status,
    action: r.action ?? null,
    note: r.note ?? null,
    created_at: r.created_at,
    handled_at: r.handled_at ?? null,
    handled_via: r.handled_via ?? null,
    handled_by: r.handled_by == null ? null : Number(r.handled_by),
  };
}

/**
 * 公开段：server.js 在拦截链（封禁豁免）之后、认证上下文解析之前调用。
 * ctx 字段契约见 docs/ARCHITECTURE.md「路由上下文注入」。
 * 返回 true = 已处理并结束响应；false = 未命中本域，宿主继续后续路由链。
 */
export async function handleAppealPublic(ctx) {
  const {
    path,
    req,
    res,
    q,
    logger,
    json,
    readBody,
    ip,
    captcha,
    deviceId,
    hit,
    deviceBan,
    appealBucketLimited,
    newAppealCode,
    siteName,
    appealEmail,
  } = ctx;

  // POST /api/appeal：提交申诉（封禁拦截已放行；自带每 IP 3 条/小时 + 验证码 + 幂等）
  if (path === '/api/appeal' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req, 16 * 1024);
    } catch {
      json(res, 400, { error: '请求格式错误' });
      return true;
    }
    if (!body || typeof body !== 'object') {
      json(res, 400, { error: '请求格式错误' });
      return true;
    }
    // 校验先于限流（§3.1 顺序）：非法请求不占用配额
    const contact = normalizeEmail(body.contact);
    if (!contact) {
      json(res, 400, { error: '请填写有效的联系邮箱' });
      return true;
    }
    const message = String(body.message ?? '').trim();
    if (message.length < 10 || message.length > 2000) {
      json(res, 400, { error: '申诉说明需 10–2000 字' });
      return true;
    }
    if (captcha.enabled()) {
      if (!(await captcha.verify(q, body.captchaToken, body.captchaAnswer))) {
        json(res, 400, { error: '验证码错误或已过期' });
        return true;
      }
    }
    // 频率限制：内存桶 + 库内双保险（只统计通过校验与验证码的提交）
    if (appealBucketLimited(ip, 'submit', 3, 3600_000) || (ip && await db.countAppealsSince(q, { ip, minutes: 60 }) >= 3)) {
      json(res, 429, { error: '提交过于频繁，请 1 小时后再试' }, { 'retry-after': '3600' });
      return true;
    }
    // 幂等：同一 IP + 相同说明（1 小时内）直接返回原编号，不重复入库
    const dup = ip ? await db.recentAppealByIpMessage(q, { ip, message, minutes: 60 }) : null;
    if (dup) {
      json(res, 200, { ok: true, code: dup, duplicate: true });
      return true;
    }
    // 上下文快照：封禁原因与到期（ip_abuse / 设备封禁，取不到为空）
    const fingerprint = deviceId ? devices.fingerprintFor(deviceId) : null;
    let reason = null;
    let banUntil = null;
    try {
      const abuse = (await q('select banned_until, ban_source from ip_abuse where ip = $1', [ip])).rows[0];
      if (abuse?.banned_until) {
        banUntil = new Date(abuse.banned_until).toISOString();
        reason = appealBanReasonLabel(abuse.ban_source);
      }
      const devBan = deviceId ? devices.isBanned({ deviceId }) : null;
      if (devBan) {
        reason = '设备封禁';
        banUntil = devBan.until ? new Date(devBan.until).toISOString() : banUntil;
      }
    } catch {
      /* 快照失败不阻塞提交 */
    }
    // CF 批（docs/ADMIN-UX-SECURITY.md §2.1）：申诉对所有封禁类型开放；取不到封禁记录直接提示，
    // 不展示/不接受"未封禁"的申诉（与页面「当前未被封禁，无需申诉」一致）。
    const rateUntil = ip ? ratelimit.bannedUntil(ip) : null;
    if (!reason && !hit && !rateUntil && !deviceBan) {
      logger?.info('appeal.not_banned', { ip: ip || null });
      json(res, 400, { error: '当前未被封禁，无需申诉' });
      return true;
    }
    // BQ（§10.2）：动作 token 提交时生成——32 字节随机、只存 sha256、14 天有效
    const { token, hash } = newActionToken();
    const actionExpiresAt = new Date(Date.now() + 14 * 86400_000).toISOString();
    let code = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      code = newAppealCode();
      try {
        await db.insertAppeal(q, { code, ip: ip || null, deviceId, fingerprint, reason, banUntil, contact, message, tokenHash: hash, actionExpiresAt });
        break;
      } catch (err) {
        if (String(err?.code) === '23505' && attempt < 2) continue; // 编号撞车（概率极低）重试
        throw err;
      }
    }
    logger?.info('appeal.submitted', { code, ip: ip || null, contact: maskEmail(contact) });
    // 管理员通知邮件：收件人=申诉邮箱回退链、From=SMTP 账号、Reply-To=申请人；失败只记日志
    const origin = baseUrl(req);
    const mail = appealAdminMail({
      siteName: siteName(),
      code,
      ip: ip || null,
      reason,
      banUntil,
      contact,
      message,
      actionUrl: appealActionUrl(origin, token),
    });
    const adminTo = appealEmail();
    if (adminTo) {
      await sendAppealEmail(q, logger, { to: adminTo, replyTo: contact, subject: mail.subject, text: mail.text, html: mail.html, event: 'appeal_admin_notify' });
    } else {
      logger?.info('appeal.notify_skipped', { event: 'appeal_admin_notify', reason: 'no_appeal_email' });
    }
    json(res, 200, { ok: true, code });
    return true;
  }

  // GET /api/appeal/:code（可选，公开，限频）：申请人查进度，不回显 IP/指纹
  const appealCodeMatch = path.match(/^\/api\/appeal\/([A-Za-z0-9-]{1,16})$/);
  if (appealCodeMatch && path !== '/api/appeal/action' && req.method === 'GET') {
    if (appealBucketLimited(ip, 'query', 20, 60_000)) {
      json(res, 429, { error: '请求过于频繁' }, { 'retry-after': '60' });
      return true;
    }
    const row = await db.appealStatusByCode(q, appealCodeMatch[1]);
    if (!row) {
      json(res, 404, { error: 'not found' });
      return true;
    }
    json(res, 200, { status: row.status, handled_at: row.handled_at ?? null, note: row.note ?? null });
    return true;
  }

  // BQ（docs/APPEAL-SYSTEM.md §10.3）：POST /api/appeal/action——preview / trust / reject。
  // POST-only（无任何 GET 副作用，防邮件预取/安全扫描）；token 即凭据、不要求登录；
  // token 不存在/过期/伪造统一 404「链接无效或已过期」（防枚举）；日志绝不写 token。
  if (path === '/api/appeal/action' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req, 16 * 1024);
    } catch {
      json(res, 400, { error: '请求格式错误' });
      return true;
    }
    const op = String(body?.op ?? '');
    if (!['preview', 'trust', 'reject'].includes(op)) {
      json(res, 400, { error: 'op 不合法' });
      return true;
    }
    // 限流：每 IP 每分钟 10 次（独立内存桶）
    if (appealBucketLimited(ip, 'action', 10, 60_000)) {
      json(res, 429, { error: '操作过于频繁，请稍后再试' }, { 'retry-after': '60' });
      return true;
    }
    const token = String(body?.token ?? '').trim();
    if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      // §10.3：token 连续错误 10 次/小时 → 429；其余统一 404（防枚举）
      if (appealBucketLimited(ip, 'action-bad', 10, 3600_000)) {
        json(res, 429, { error: '尝试次数过多，请稍后再试' }, { 'retry-after': '3600' });
        return true;
      }
      logger?.warn('appeal.action_refused', { op, reason: 'bad_token', ip: ip || null });
      json(res, 404, { error: '链接无效或已过期' });
      return true;
    }
    const hash = createHash('sha256').update(token).digest('hex');
    const appeal = await db.appealByTokenHash(q, hash);
    const expired = appeal && appeal.action_expires_at && new Date(appeal.action_expires_at).getTime() < Date.now();
    if (!appeal || expired) {
      if (appealBucketLimited(ip, 'action-bad', 10, 3600_000)) {
        json(res, 429, { error: '尝试次数过多，请稍后再试' }, { 'retry-after': '3600' });
        return true;
      }
      logger?.warn('appeal.action_refused', { op, reason: expired ? 'expired' : 'bad_token', code: appeal?.code ?? null, ip: ip || null });
      json(res, 404, { error: '链接无效或已过期' });
      return true;
    }
    if (op === 'preview') {
      // 零副作用：不写任何状态（§10.7 验收 9/14）
      json(res, 200, {
        code: appeal.code,
        status: appeal.status,
        ipMasked: visitors.maskIpForDisplay(appeal.ip),
        reason: appeal.reason ?? null,
        banUntil: appeal.ban_until ?? null,
        contactMasked: maskEmail(appeal.contact),
        message: String(appeal.message ?? '').slice(0, 1000),
        createdAt: appeal.created_at,
        handledAt: appeal.handled_at ?? null,
        handledVia: appeal.handled_via ?? null,
        canAct: appeal.status === 'pending',
      });
      return true;
    }
    // trust / reject：与后台共用状态机，先到先得（§10.7 验收 12）
    if (appeal.status !== 'pending') {
      logger?.info('appeal.action_email', { code: appeal.code, op, outcome: 'already_handled' });
      json(res, 409, { error: '该申诉已处理', status: appeal.status, handledAt: appeal.handled_at ?? null, handledVia: appeal.handled_via ?? null });
      return true;
    }
    let note = null;
    if (op === 'reject') {
      const raw = String(body?.note ?? '').trim();
      if (raw && raw.length < 5) {
        json(res, 400, { error: '拒绝理由至少 5 个字' });
        return true;
      }
      note = raw || '未通过审核，如仍有疑问请回复本邮件'; // §10.3 默认文案
    }
    if (note && note.length > 500) {
      json(res, 400, { error: '理由最多 500 字' });
      return true;
    }
    const nextStatus = op === 'trust' ? 'resolved' : 'rejected';
    const updated = await db.consumeAppealToken(q, {
      hash,
      status: nextStatus,
      action: op === 'trust' ? 'both' : 'reject',
      note,
      handledVia: 'email',
    });
    if (!updated) {
      // 并发：事务抢 pending 失败——后到者显示已处理，不重复解封/发信
      logger?.info('appeal.action_email', { code: appeal.code, op, outcome: 'already_handled' });
      json(res, 409, { error: '该申诉已处理', status: appeal.status, handledAt: appeal.handled_at ?? null });
      return true;
    }
    // trust：解封 IP + 设备（与后台 resolve 同一套动作，§10.3）
    if (op === 'trust') {
      if (appeal.ip) {
        await db.removeBlockedIp(q, appeal.ip).catch(() => {});
        await db.clearAbuseBan(q, appeal.ip).catch(() => {});
        ratelimit.clearBanMemory(appeal.ip);
        await visitors.refreshBlocklist(q).catch(() => {});
      }
      const fp = appeal.fingerprint ?? (appeal.device_id ? await db.fingerprintOfDeviceId(q, appeal.device_id) : null);
      if (fp) {
        await db.removeDeviceBan(q, fp).catch(() => {});
        devices.forgetBan(fp, appeal.device_id || '');
      }
    }
    logger?.info('appeal.action_email', { code: appeal.code, op, outcome: 'ok' });
    // 结果邮件给申请人（失败只记日志）
    const mail = appealResultMail({ siteName: siteName(), code: appeal.code, resolved: op === 'trust', note: op === 'trust' ? '' : note });
    await sendAppealEmail(q, logger, { to: appeal.contact, replyTo: appealEmail(), subject: mail.subject, text: mail.text, html: mail.html, event: 'appeal_result' });
    json(res, 200, { ok: true, code: appeal.code, status: nextStatus });
    return true;
  }

  return false;
}

/**
 * 管理段：server.js 在 requireAdmin 就绪之后调用（与其它 admin 路由同段）。
 * ctx 字段契约见 docs/ARCHITECTURE.md「路由上下文注入」。
 */
export async function handleAppealAdmin(ctx) {
  const {
    path,
    req,
    res,
    url,
    q,
    logger,
    json,
    readBody,
    ip,
    user,
    requireAdmin,
    siteName,
    appealEmail,
  } = ctx;

  // ---- 申诉管理（O-5/O-6，docs/APPEAL-SYSTEM.md §3.2/§3.3）----
  if (path === '/api/admin/appeals' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const status = String(url.searchParams.get('status') ?? 'pending');
    if (!['pending', 'done', 'all'].includes(status)) {
      json(res, 400, { error: 'status 只支持 pending / done / all' });
      return true;
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20) || 20, 1), 100);
    const page = Math.max(Number(url.searchParams.get('page') ?? 1) || 1, 1);
    const rows = await db.listAppeals(q, { status, limit, page });
    json(res, 200, {
      appeals: rows.map(appealRowPublic),
      total: await db.countAppeals(q, { status }),
      pending: await db.countPendingAppeals(q),
    });
    return true;
  }

  const appealResolveMatch = path.match(/^\/api\/admin\/appeals\/(\d+)\/resolve$/);
  if (appealResolveMatch && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const id = Number(appealResolveMatch[1]);
    let body;
    try {
      body = await readBody(req, 16 * 1024);
    } catch {
      json(res, 400, { error: '请求格式错误' });
      return true;
    }
    const action = String(body?.action ?? '');
    if (!['unban_ip', 'unban_device', 'both', 'reject', 'note'].includes(action)) {
      json(res, 400, { error: 'action 不合法（unban_ip / unban_device / both / reject / note）' });
      return true;
    }
    let note = String(body?.note ?? '').trim();
    if (action === 'reject' && note.length < 5) {
      json(res, 400, { error: '拒绝理由至少 5 个字' });
      return true;
    }
    if (note.length > 500) {
      json(res, 400, { error: '备注/理由最多 500 字' });
      return true;
    }
    const appeal = await db.getAppealById(q, id);
    if (!appeal) {
      json(res, 404, { error: '申诉不存在' });
      return true;
    }
    // 并发保护：where status='pending' 抢锁，0 行 = 已处理
    const updated = await db.resolveAppeal(q, { id, action, note: note || null, handledBy: user.id, handledVia: 'console' });
    if (!updated) {
      json(res, 409, { error: '该申诉已处理' });
      return true;
    }
    // 联动解封：与 BQ 邮件动作同一套动作（§3.3 / §10.3）
    const unbanIp = action === 'unban_ip' || action === 'both';
    const unbanDevice = action === 'unban_device' || action === 'both';
    const unban = { ip: false, device: false };
    if (unbanIp && appeal.ip) {
      await db.removeBlockedIp(q, appeal.ip).catch(() => {});
      await db.clearAbuseBan(q, appeal.ip).catch(() => {});
      ratelimit.clearBanMemory(appeal.ip);
      await visitors.refreshBlocklist(q).catch(() => {});
      unban.ip = true;
    }
    if (unbanDevice && (appeal.fingerprint || appeal.device_id)) {
      const fp = appeal.fingerprint ?? await db.fingerprintOfDeviceId(q, appeal.device_id);
      if (fp) {
        await db.removeDeviceBan(q, fp).catch(() => {});
        devices.forgetBan(fp, appeal.device_id || '');
      }
      unban.device = true;
    }
    logger?.info('appeal.resolved', { id, code: appeal.code, action, by: user.username, unban });
    // 结果邮件：resolved → 已解封可访问；rejected → 未通过+理由；note 不发
    if (action !== 'note') {
      const resolved = action !== 'reject';
      const mail = appealResultMail({ siteName: siteName(), code: appeal.code, resolved, note: resolved ? '' : note });
      await sendAppealEmail(q, logger, { to: appeal.contact, replyTo: appealEmail(), subject: mail.subject, text: mail.text, html: mail.html, event: 'appeal_result' });
    }
    json(res, 200, { ok: true, appeal: appealRowPublic(updated) });
    return true;
  }

  return false;
}
