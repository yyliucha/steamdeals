// CO-5/B4-2 第十六轮（docs/DESIGN-AUDIT.md B4）：admin-users 域（B4 #11：后台用户批量
// /api/admin/users*、/api/admin/bulk、/api/admin/bulk-ops + DT-4 后台重置密码发码）路由已从
// server.js 抽到本文件。管理段单入口 handleAdminUsersAdmin(ctx)：调用位置不能动，必须在
// requireAdmin 就绪之后的管理段——取本域最早路由 /api/admin/users/:name/sessions（kickAll）
// 的原位置（handleAdminSessionsAdmin 之后、前台 revoke-others 之前）；401/403 语义依赖该位置
// （原位置语义，移动 = 改契约）。
//
// 域内 16 组路由 path+method 互不重叠、与相邻其它域路由（/api/admin/settings*、appeal admin、
// auth 主段、games 主段、admin-access、admin-sync、images、reports、steam-logs 等）无同 path
// 双匹配，集中在管理段一处不改变匹配语义；模块内保持原相对顺序。
// 边界判定：只拆 /api/admin/users*、bulk、bulk-ops 与 DT-4 后台重置密码发码（reset-code/
// password）；/api/admin/games*（B4 #15）、admin 报表/备份/日志（B4 #12）、/api/admin/images*
// （B4 #13）、/api/user/sessions/revoke-others（前台主段）留 server.js。
//
// 跨模块共享状态按引用传 ctx（语义共享，勿改成拷贝）：banIpExclusive（宿主闭包——本域
// bulk 批量封禁/信任与 admin-access 域单条封禁/信任共用同一 banIpExclusiveSql 互斥口径，
// 先例 B4 #8）、invalidateAdminGamesCache/invalidateListCache（宿主短缓存——bulk 写操作与
// 宿主 admin 写操作失效同一份）、appealEmail（宿主闭包——模板联系人）、token（kickAll 踢
// 自己会话保护，只读）。
//
// 域内模块级状态：BULK_KEY_ERROR / BULK_ACTIONS 白名单派发表与全部 bulk helper 只被本域
// bulk 路由使用，随域移入模块级（先例：watchlist 域 watchUserFails）；banIpExclusiveSql
// 本身跨域共用（admin-access 域）留 server.js（§15.4 判据），本域 helper 经 run 参数拿引用。
//
// 本文件只做 HTTP 输入输出编排，不写 SQL 字面量（全部走 repository / pg.js 通用 SQL）。
import * as db from '../store/pg.js';
import * as mailTemplates from '../mail-templates.js';
import * as accountNotify from '../account-notify.js';
import * as passwordPolicy from '../password-policy.js';
import * as visitors from '../visitors.js';
import * as ratelimit from '../ratelimit.js';
import * as devices from '../devices.js';
import { maskEmail } from '../auth-routes.js';
import { formatDateTime } from '../format.js';
import { baseUrl } from '../steam-login.js';

// ---------------------------------------------------------------- 后台批量操作（随域移入）
//
// 设计见 docs/ADMIN-BULK-ACTIONS.md：所有列表共用一个 POST /api/admin/bulk，
// 靠这张白名单派发表决定「哪些 target/action 合法、单次上限多少、是不是高危」。
// 未登记的组合一律 400 —— 新增一个列表必须显式改这张表，不允许隐式放行。
//
// 两种执行形态：
//   · 纯 SQL 批量（解封/恢复/启停/忽略/删除/禁用）：一次 update/delete ... = any(数组)，
//     returning 出来的就是成功集，没返回的记 skipped；
//   · 逐条复用单条逻辑（封 IP / 封设备 / 信任 / 设备封禁）：上限只有 50，串行执行，
//     单条异常记 failed 不影响其它条（与 ingest 的失败模型一致）。

const BULK_KEY_ERROR = {
  id: '条目 id 不合法',
  ip: 'IP 格式不正确（支持 1.2.3.4 单个 IP 或 1.2.3.0/24 网段）',
  fingerprint: '设备指纹不合法',
};

const BULK_ACTIONS = {
  'reviews/approve-ip': { max: 50, risk: 'high', keyType: 'id', run: bulkReviewApproveIp },
  'reviews/approve-device': { max: 50, risk: 'high', keyType: 'id', run: bulkReviewApproveDevice },
  'reviews/reject': { max: 200, risk: 'low', keyType: 'id', run: bulkReviewReject },
  'visitors/ban-ip': { max: 50, risk: 'high', keyType: 'ip', run: bulkVisitorBanIp },
  'visitors/trust': { max: 200, risk: 'low', keyType: 'ip', run: bulkVisitorTrust },
  'games/restore': { max: 1000, risk: 'low', keyType: 'id', run: bulkGameRestore },
  'games/block': { max: 50, risk: 'high', keyType: 'id', run: bulkGameBlock },
  'games/unblock': { max: 200, risk: 'low', keyType: 'id', run: bulkGameUnblock },
  'games/delete': { max: 50, risk: 'high', keyType: 'id', run: bulkGameDelete },
  'announcements/delete': { max: 50, risk: 'high', keyType: 'id', run: bulkAnnouncementDelete },
  'announcements/activate': { max: 200, risk: 'low', keyType: 'id', run: bulkAnnouncementActivate },
  'announcements/deactivate': { max: 200, risk: 'low', keyType: 'id', run: bulkAnnouncementDeactivate },
  'blacklist/unban': { max: 200, risk: 'low', keyType: 'ip', run: bulkBlacklistUnban },
  'whitelist/remove': { max: 200, risk: 'low', keyType: 'ip', run: bulkWhitelistRemove },
  'device-bans/unban': { max: 200, risk: 'low', keyType: 'fingerprint', run: bulkDeviceBanRemove },
  'abuse/unban': { max: 200, risk: 'low', keyType: 'ip', run: bulkAbuseUnban },
  'sessions/kick': { max: 200, risk: 'low', keyType: 'id', run: bulkSessionKick },
  'devices/ban': { max: 50, risk: 'high', keyType: 'fingerprint', run: bulkDeviceBan },
  'users/disable': { max: 50, risk: 'high', keyType: 'id', guard: bulkGuardUserDisable, run: bulkUserDisable },
  'users/enable': { max: 200, risk: 'low', keyType: 'id', run: bulkUserEnable },
  // DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：批量操作只保留「批量踢会话」——禁用/启用/删除/重置密码不做批量
  'users/kick': { max: 200, risk: 'high', keyType: 'id', run: bulkUserKick },
  // CY 批（docs/DATA-ISOLATION.md §3）：wishlists/delete 已从白名单移除——愿望单属用户私有数据，
  // 管理员只读，未登记组合一律 400（不提供任何写通道）。
};

/** 键规范化：IP 走 visitors.normalizeBanInput（与单条接口同一口径），非法返回 null。 */
function normalizeBulkKey(keyType, raw) {
  if (keyType === 'ip') return visitors.normalizeBanInput(raw);
  if (keyType === 'fingerprint') {
    const fp = String(raw ?? '').trim().toLowerCase();
    return /^[a-f0-9]{32,64}$/.test(fp) ? fp : null;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 纯 SQL 批量的收尾：返回真正改动的键，其余记为 skipped（幂等重放不虚报成功）。 */
function bulkMissing(keys, doneKeys, reason) {  const done = new Set(doneKeys.map((k) => String(k)));
  return keys.filter((k) => !done.has(String(k))).map((k) => ({ key: String(k), status: 'skipped', reason }));
}

/** 逐条执行的小工具：把单条异常收敛成 failed，不影响其它条。 */
async function bulkEach(keys, handler) {
  const results = [];
  let ok = 0;
  let touched = false;
  for (const key of keys) {
    try {
      const outcome = await handler(key);
      if (outcome === 'done') {
        ok += 1;
        touched = true;
      } else {
        results.push({ key: String(key), status: 'skipped', reason: outcome || '状态已一致' });
      }
    } catch (err) {
      results.push({ key: String(key), status: 'failed', reason: String(err?.message ?? err).slice(0, 120) });
    }
  }
  return { ok, results, touched };
}

async function bulkReviewApproveIp({ q, keys, user, banIpExclusive }) {
  const rows = await db.bulkGetAbuseReviews(q, keys);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const { ok, results, touched } = await bulkEach(keys, async (key) => {
    const review = byId.get(String(key));
    if (!review) return '审核记录不存在';
    if (review.status !== 'pending') return '已处理过';
    if (!review.ip) return '该记录没有 IP';
    // 互斥 helper：加黑移白 + 待审标记（内存黑名单由循环后统一刷一次）
    await banIpExclusive(review.ip, `批量审核通过（${review.rule}）by ${user.username}`, 'ban', { refresh: false });
    await db.finishAbuseReview(q, review.id, { status: 'approved', reviewedBy: user.id, note: '批量封 IP' });
    return 'done';
  });
  if (touched) await visitors.refreshBlocklist(q).catch(() => {});
  return { ok, results };
}

async function bulkReviewApproveDevice({ q, keys, user }) {
  const rows = await db.bulkGetAbuseReviews(q, keys);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const { ok, results, touched } = await bulkEach(keys, async (key) => {
    const review = byId.get(String(key));
    if (!review) return '审核记录不存在';
    if (review.status !== 'pending') return '已处理过';
    if (!review.fingerprint) return '该记录没有设备指纹';
    await db.upsertDeviceBan(q, {
      fingerprint: review.fingerprint,
      deviceId: review.device_id,
      note: `批量审核通过（${review.rule}）by ${user.username}`,
    });
    await db.finishAbuseReview(q, review.id, { status: 'approved', reviewedBy: user.id, note: '批量封设备' });
    return 'done';
  });
  if (touched) await devices.loadBans(q).catch(() => {});
  return { ok, results };
}

async function bulkReviewReject({ q, keys, user }) {
  const done = await db.bulkRejectAbuseReviews(q, { ids: keys, reviewedBy: user.id, note: '批量忽略' });
  return { ok: done.length, results: bulkMissing(keys, done, '审核记录不存在或已处理') };
}

async function bulkVisitorBanIp({ q, keys, user, banIpExclusive }) {
  let removedFromWhitelist = 0;
  const { ok, results, touched } = await bulkEach(keys, async (ip) => {
    const outcome = await banIpExclusive(ip, `批量封禁 by ${user.username}`, 'ban', { refresh: false });
    if (outcome.removedFromWhitelist) removedFromWhitelist += 1;
    return 'done';
  });
  if (touched) await visitors.refreshBlocklist(q).catch(() => {});
  return { ok, results, removedFromWhitelist };
}

async function bulkVisitorTrust({ q, keys, user, banIpExclusive }) {
  let removedFromBlacklist = 0;
  const { ok, results } = await bulkEach(keys, async (ip) => {
    const outcome = await banIpExclusive(ip, `批量信任 by ${user.username}`, 'trust', { refresh: false });
    if (outcome.removedFromBlacklist) removedFromBlacklist += 1;
    return 'done';
  });
  // 加白会互斥删除黑名单条目：内存黑名单必须跟着刷，否则删掉的条目还挡着路
  if (removedFromBlacklist) await visitors.refreshBlocklist(q).catch(() => {});
  return { ok, results, removedFromBlacklist };
}

async function bulkGameRestore({ q, keys }) {
  const done = await db.bulkSetGamesDeleted(q, { ids: keys, deleted: false });
  return { ok: done.length, results: bulkMissing(keys, done, '游戏不存在或未删除') };
}

async function bulkGameBlock({ q, keys }) {
  const done = await db.bulkSetGamesBlocked(q, { ids: keys, blocked: true });
  return { ok: done.length, results: bulkMissing(keys, done, '游戏不存在或已禁用') };
}

async function bulkGameUnblock({ q, keys }) {
  const done = await db.bulkSetGamesBlocked(q, { ids: keys, blocked: false });
  return { ok: done.length, results: bulkMissing(keys, done, '游戏不存在或已是启用状态') };
}

async function bulkGameDelete({ q, keys }) {
  const done = await db.bulkSetGamesDeleted(q, { ids: keys, deleted: true });
  return { ok: done.length, results: bulkMissing(keys, done, '游戏不存在或已在回收站') };
}

async function bulkAnnouncementDelete({ q, keys }) {
  const done = await db.bulkDeleteAnnouncements(q, keys);
  return { ok: done.length, results: bulkMissing(keys, done, '公告不存在或已删除') };
}

async function bulkAnnouncementActivate({ q, keys }) {
  const done = await db.bulkSetAnnouncementsActive(q, { ids: keys, active: true });
  return { ok: done.length, results: bulkMissing(keys, done, '公告不存在或已是启用状态') };
}

async function bulkAnnouncementDeactivate({ q, keys }) {
  const done = await db.bulkSetAnnouncementsActive(q, { ids: keys, active: false });
  return { ok: done.length, results: bulkMissing(keys, done, '公告不存在或已是停用状态') };
}

/** BE 批（docs/WISHLIST-SITE-ONLY.md §4.2）批量删愿望单已随 CY 批移除——愿望单属用户私有数据，管理员只读。 */
async function bulkBlacklistUnban({ q, keys }) {
  const done = await db.bulkRemoveBlockedIps(q, keys);
  // 内存黑名单必须同步刷新，否则这批 IP 仍会被 403（验收 §8.3 专门盯这条）
  if (done.length) await visitors.refreshBlocklist(q).catch(() => {});
  return { ok: done.length, results: bulkMissing(keys, done, '不在黑名单中') };
}

async function bulkWhitelistRemove({ q, keys }) {
  const done = await db.bulkRemoveWhitelistIps(q, keys);
  for (const ip of done) ratelimit.removeWhitelist(ip);
  return { ok: done.length, results: bulkMissing(keys, done, '不在白名单中') };
}

async function bulkDeviceBanRemove({ q, keys }) {
  const done = await db.bulkRemoveDeviceBans(q, keys);
  if (done.length) await devices.loadBans(q).catch(() => {});
  return { ok: done.length, results: bulkMissing(keys, done, '不在设备封禁列表中') };
}

async function bulkAbuseUnban({ q, keys }) {
  // BJ 批 C1：批量同口径——只清 ip_abuse（含内存态），绝不动 ip_blacklist；审计由 admin_bulk_ops 负责
  const { ok, results } = await bulkEach(keys, async (ip) => {
    const removed = await ratelimit.clearAbuse(q, ip);
    return removed ? 'done' : '没有临时封禁记录';
  });
  return { ok, results };
}

// BK 批（docs/SESSION-MANAGEMENT.md §3.3）：批量踢会话——按对外 id 逐条删，审计走 admin_bulk_ops
async function bulkSessionKick({ q, keys }) {
  const { ok, results } = await bulkEach(keys, async (id) => {
    const row = await db.deleteSessionById(q, Number(id));
    return row ? 'done' : '会话不存在或已过期';
  });
  return { ok, results };
}

async function bulkDeviceBan({ q, keys, options, user }) {
  const minutes = Number(options?.minutes);
  const permanent = options?.permanent === true || !Number.isFinite(minutes) || minutes <= 0;
  const until = permanent ? null : new Date(Date.now() + minutes * 60_000).toISOString();
  const note = String(options?.note ?? '').trim().slice(0, 200) || `批量封禁 by ${user.username}`;
  const { ok, results } = await bulkEach(keys, async (fingerprint) => {
    await db.upsertDeviceBan(q, { fingerprint, deviceId: null, note, until });
    return 'done';
  });
  if (ok) await devices.loadBans(q).catch(() => {});
  return { ok, results };
}

/** 用户批量禁用的守卫：不能把最后一个可用管理员禁掉，也不能禁用自己。 */
async function bulkGuardUserDisable({ q, keys, user }) {
  const rows = await db.usersForBulk(q, keys);
  const disablingAdmins = rows.filter((row) => row.role === 'admin' && !row.disabled).length;
  if (disablingAdmins > 0) {
    const remaining = await db.countActiveAdmins(q, { excludeIds: keys });
    if (remaining <= 0) return '不能禁用最后一个可用管理员';
  }
  if (rows.some((row) => row.id === user.id)) return '不能禁用自己的账号';
  return null;
}

// 批量禁用/启用不发用户通知（docs/USER-LIFECYCLE.md 决策 9：只记日志；单条操作才发）
async function bulkUserDisable({ q, keys }) {
  const done = await db.bulkSetUsersDisabled(q, { ids: keys, disabled: true });
  // 禁用要立即生效：删掉这些用户的会话，否则旧 cookie 还能继续用
  if (done.length) await db.deleteSessionsOfUsers(q, done.map((row) => row.id));
  const doneIds = done.map((row) => row.id);
  return { ok: done.length, results: bulkMissing(keys, doneIds, '用户不存在或已是禁用状态') };
}

async function bulkUserEnable({ q, keys }) {
  const done = await db.bulkSetUsersDisabled(q, { ids: keys, disabled: false });
  return { ok: done.length, results: bulkMissing(keys, done.map((row) => row.id), '用户不存在或已是启用状态') };
}

// DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：批量踢会话——按用户 id 删掉全部会话（下一次请求即退出登录）
async function bulkUserKick({ q, keys }) {
  const rows = await db.usersForBulk(q, keys);
  const removed = await db.deleteSessionsOfUsers(q, rows.map((row) => row.id));
  const doneIds = rows.map((row) => row.id);
  return { ok: doneIds.length, removed, results: bulkMissing(keys, doneIds, '用户不存在') };
}

/**
 * admin-users 域管理段入口：命中返回 true（已处理并结束响应），未命中返回 false（宿主继续）。
 */
export async function handleAdminUsersAdmin(ctx) {
  const {
    path,
    req,
    res,
    url,
    q,
    logger,
    json,
    readBody,
    user,
    requireAdmin,
    ip,
    token,
    appealEmail, // 语义共享：宿主闭包（serveBanPage/申诉域模板联系人同一定义）
    banIpExclusive, // 语义共享：宿主闭包（与 admin-access 域共用同一 banIpExclusiveSql 互斥口径）
    invalidateAdminGamesCache, // 语义共享：宿主闭包（bulk 写操作与 #15 admin games 短缓存共用失效）
    invalidateListCache, // 语义共享：宿主闭包（bulk 写操作与宿主其它写操作失效同一前台缓存）
  } = ctx;

  // BK 批（docs/SESSION-MANAGEMENT.md §3.3）：按用户踢全部会话（users 区，B4 #11）
  const kickAllMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/sessions$/);
  if (kickAllMatch && req.method === 'DELETE') {
    if (!requireAdmin()) return true;
    const targetName = decodeURIComponent(kickAllMatch[1]);
    const trow = await db.userSessionKickTarget(q, targetName);
    if (!trow) return (json(res, 404, { error: '没有该用户' }), true);
    // 目标是当前管理员自己时保留当前会话（规格 §3.3）
    const removed = await db.deleteSessionsOfUser(q, trow.id, { exceptToken: trow.id === user.id ? token : null });
    logger?.info('session.kick_all', { username: targetName, removed, by: user.username });
    return (json(res, 200, { removed }), true);
  }

  // ---- 管理员：验证邮箱归属（发码 / 校验）----
  const bindCode = path.match(/^\/api\/admin\/users\/([^/]+)\/email\/code$/);
  if (bindCode && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const auth = await import('../email-auth.js');
    const { sendMail } = await import('../notify.js');
    const username = decodeURIComponent(bindCode[1]);
    const target = await db.userEmailTarget(q, username);
    if (!target) return (json(res, 404, { error: '没有该用户' }), true);
    if (!target.email) return (json(res, 400, { error: '该用户还没有绑定邮箱' }), true);
    const cfg = await auth.smtpConfig(q);
    if (!auth.isSmtpConfigured(cfg)) return (json(res, 503, { error: 'SMTP 未配置，无法发送验证邮件' }), true);
    const code = auth.generateCode();
    const insId = await db.insertAdminEmailCode(q, {
      email: target.email,
      userId: target.id,
      purpose: 'bind',
      codeHash: auth.hashCode(target.email, code),
      subject: 'SteamDeals 邮箱验证码',
      body: '验证码邮件正文未保存。',
      expiresMinutes: 5,
    });
    try {
      // AI 批：绑定验证码同样套用 verify_code 模板（停用时回退纯文本）
      const tpl = await mailTemplates.resolveTemplate(q, 'verify_code').catch(() => null);
      const expiryAt = new Date(Date.now() + 5 * 60 * 1000);
      let mail = { subject: 'SteamDeals 邮箱验证码', text: '验证码：' + code + '\n有效期 5 分钟。', html: null };
      if (tpl?.enabled) {
        mail = mailTemplates.renderTemplate({
          subject: tpl.subject,
          bodyHtml: tpl.bodyHtml,
          bodyText: tpl.bodyText ?? '',
          vars: {
            username: target.username,
            action: '绑定邮箱',
            time: formatDateTime(expiryAt),
            code,
            siteUrl: baseUrl(req),
            contactEmail: appealEmail(),
          },
        });
      }
      await sendMail(
        { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from, to: target.email,
          subject: mail.subject, text: mail.text, html: mail.html },
        { logger },
      );
      await db.markEmailCodeSent(q, insId);
      logger?.info('api.user_email_code_sent', { username, by: user.username });
      return (json(res, 200, { ok: true, hint: '验证码已发送到 ' + target.email }), true);
    } catch (err) {
      await db.markEmailCodeFailed(q, insId, String(err.message).slice(0, 200));
      return (json(res, 502, { error: '发送失败：' + String(err.message).slice(0, 160) }), true);
    }
  }

  const bindVerify = path.match(/^\/api\/admin\/users\/([^/]+)\/email\/verify$/);
  if (bindVerify && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const auth = await import('../email-auth.js');
    const body = await readBody(req);
    const code = String(body.code ?? '').trim();
    const username = decodeURIComponent(bindVerify[1]);
    const target = await db.userEmailIdRow(q, username);
    if (!target) return (json(res, 404, { error: '没有该用户' }), true);
    if (!target.email) return (json(res, 400, { error: '该用户还没有绑定邮箱' }), true);
    const row = await db.pendingEmailCode(q, { email: target.email, purpose: 'bind' });
    if (!row) return (json(res, 400, { error: '没有可用的验证码，请先发送' }), true);
    if (new Date(row.expires_at).getTime() < Date.now()) return (json(res, 400, { error: '验证码已过期，请重新发送' }), true);
    if (row.attempts >= 5) return (json(res, 429, { error: '尝试次数过多，请重新发送' }), true);
    if (!auth.verifyCodeHash(target.email, code, row.code_hash)) {
      await db.bumpEmailCodeAttempts(q, row.id);
      return (json(res, 400, { error: '验证码不正确' }), true);
    }
    await db.consumeEmailCode(q, row.id);
    await db.markEmailVerified(q, target.id);
    logger?.info('api.user_email_verified', { username, by: user.username });
    return (json(res, 200, { ok: true }), true);
  }

  const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch && req.method === 'DELETE') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const username = decodeURIComponent(userMatch[1]);
    // AJ 批：删除通知必须在删库前取好收件邮箱（docs/USER-LIFECYCLE.md §4.2）
    const pre = await db.userStateRow(q, username);
    const result = await db.deleteUserAudited(q, {
      username,
      confirmUsername: String(body.confirmUsername ?? ''),
      operator: user.username,
      operatorId: user.id,
      reason: String(body.reason ?? '').trim() || null,
    });
    if (!result.ok) return (json(res, result.status, { error: result.error }), true);
    logger?.info('admin.user_deleted', {
      username,
      role: result.deleted.role ?? null,
      steamAccounts: result.deleted.steamAccounts,
      sessions: result.deleted.sessions,
      by: user.username,
      reason: String(body.reason ?? '').trim() || null,
    });
    // AJ 批：account_deleted 通知异步发送（响应 notify:'queued'，不阻塞删除）；
    // 发送失败只记日志 + mail_log，不影响已完成的删除（决策 6）
    let notify = 'skipped_no_email';
    if (String(pre?.email ?? '').trim()) {
      notify = 'queued';
      void accountNotify.notifyUserActionQueued({
        q,
        logger,
        user: { username, email: pre.email },
        action: 'account_deleted',
        actor: user.username,
        siteUrl: baseUrl(req),
        contactEmail: appealEmail(),
      });
    }
    return (json(res, 200, { ok: true, deleted: result.deleted, notify }), true);
  }
  if (userMatch && req.method === 'PATCH') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const username = decodeURIComponent(userMatch[1]);
    const before = await db.userStateRow(q, username);
    if (!before) return (json(res, 404, { error: '没有该用户' }), true);
    const row = await db.updateUser(q, {
      username,
      displayName: body.display_name,
      role: body.role,
      disabled: body.disabled,
    });
    if (!row) return (json(res, 404, { error: '没有该用户或没有要改的字段' }), true);
    // BK-1（docs/SESSION-MANAGEMENT.md §3.6-1）：单条禁用立即踢会话（与批量禁用同口径）
    if (row.disabled && !before.disabled) {
      const removed = await db.deleteSessionsOfUser(q, row.id).catch(() => 0);
      logger?.info('user.disabled_sessions_revoked', { username, removed, by: user.username });
    }
    logger?.info('api.user_updated', { username, by: user.username, ...body });
    // DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：角色变更 / 禁用启用落审计
    // （admin.user_edit / admin.user_disabled）；审计失败绝不阻塞主流程（CZ 批同口径）。
    if (body.role !== undefined && String(body.role) !== String(before.role ?? '')) {
      await db.writeAuditLog(q, { actorId: user.id, actor: user.username, action: 'admin.user_edit', target: username, detail: { field: 'role', from: String(before.role ?? 'user'), to: String(body.role) }, ip });
    }
    if (body.disabled !== undefined && Boolean(body.disabled) !== Boolean(before.disabled)) {
      await db.writeAuditLog(q, { actorId: user.id, actor: user.username, action: 'admin.user_disabled', target: username, detail: { disabled: Boolean(body.disabled) }, ip });
    }
    // AJ 批：字段实际变化才发通知；一次请求最多一封，优先级 disabled > role > display_name
    // （docs/USER-LIFECYCLE.md §4.2）。快操作 await 发送，结果进响应；失败不影响已保存的修改。
    let action = null;
    let extra = {};
    if (body.disabled !== undefined && Boolean(body.disabled) !== Boolean(before.disabled)) {
      action = Boolean(body.disabled) ? 'account_disabled' : 'account_enabled';
    } else if (body.role !== undefined && String(body.role) !== String(before.role ?? '')) {
      action = 'account_role_changed';
      extra = { action: body.role === 'admin' ? '管理员' : '普通用户' };
    } else if (body.display_name !== undefined && String(body.display_name ?? '') !== String(before.display_name ?? '')) {
      action = 'account_renamed';
      extra = { action: String(body.display_name ?? '').trim() || '（已清除）' };
    }
    const reply = { user: row };
    if (action) {
      const notifyResult = await accountNotify.notifyUserActionQueued({
        q,
        logger,
        user: { username, email: before.email },
        action,
        extra,
        actor: user.username,
        siteUrl: baseUrl(req),
        contactEmail: appealEmail(),
      });
      reply.notify = { status: notifyResult.status, error: notifyResult.error ?? null };
    }
    return (json(res, 200, reply), true);
  }

  // DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：编辑弹窗只读展示绑定 Steam 账号（昵称 + SteamID）
  // SQL 落 me-repository（B4 #6 域拆分边界：steam_accounts 绑定查询不在 server.js 内联）
  const userSteamMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/steam-accounts$/);
  if (userSteamMatch && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const username = decodeURIComponent(userSteamMatch[1]);
    const target = await db.userIdRow(q, username);
    if (!target) return (json(res, 404, { error: '没有该用户' }), true);
    return (json(res, 200, { accounts: await db.listBoundSteamAccounts(q, target.id) }), true);
  }

  // ---- DT-4（docs/ADMIN-PERMISSIONS.md）：后台重置密码发码（purpose='admin_reset'）----
  // 冷却按场景分桶：只与 admin_reset 互斥，不占用前台登录/注册/重置发码额度（反之亦然）；
  // 成功/429 都返回 retryAfterSec 供前端倒计时（三态：发送中/剩余秒数/可重发）。
  const resetCodeMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/reset-code$/);
  if (resetCodeMatch && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const auth = await import('../email-auth.js');
    const { sendMail } = await import('../notify.js');
    const username = decodeURIComponent(resetCodeMatch[1]);
    const target = await db.userEmailTarget(q, username);
    if (!target) return (json(res, 404, { error: '没有该用户' }), true);
    if (!target.email) return (json(res, 400, { error: '该用户还没有绑定邮箱' }), true);
    const recent = await db.recentEmailCodes(q, { email: target.email, purpose: 'admin_reset', limit: 20 });
    const limit = auth.checkRateLimit(recent);
    if (!limit.ok) {
      logger?.warn('auth.otp_failed', { email: maskEmail(target.email), purpose: 'admin_reset', reason: limit.reason, retryAfterSec: limit.retryAfterSec });
      return (json(res, 429, {
        error: limit.reason === 'cooldown' ? `请 ${limit.retryAfterSec} 秒后再试` : '发送过于频繁，请稍后再试',
        retryAfterSec: limit.retryAfterSec,
      }), true);
    }
    const cfg = await auth.smtpConfig(q);
    if (!auth.isSmtpConfigured(cfg)) return (json(res, 503, { error: 'SMTP 未配置，无法发送验证邮件' }), true);
    const code = auth.generateCode();
    const insId = await db.insertAdminEmailCode(q, {
      email: target.email,
      userId: target.id,
      purpose: 'admin_reset',
      codeHash: auth.hashCode(target.email, code),
      subject: 'SteamDeals 重置密码验证码',
      body: '验证码邮件正文未保存。',
      expiresMinutes: 10,
    });
    try {
      // AI 批：验证码同样套用 verify_code 模板（停用时回退纯文本）
      const tpl = await mailTemplates.resolveTemplate(q, 'verify_code').catch(() => null);
      const expiryAt = new Date(Date.now() + 10 * 60 * 1000);
      let mail = { subject: 'SteamDeals 重置密码验证码', text: '验证码：' + code + '\n有效期 10 分钟。', html: null };
      if (tpl?.enabled) {
        mail = mailTemplates.renderTemplate({
          subject: tpl.subject,
          bodyHtml: tpl.bodyHtml,
          bodyText: tpl.bodyText ?? '',
          vars: {
            username: target.username,
            action: '重置密码',
            time: formatDateTime(expiryAt),
            code,
            siteUrl: baseUrl(req),
            contactEmail: appealEmail(),
          },
        });
      }
      await sendMail(
        { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from, to: target.email,
          subject: mail.subject, text: mail.text, html: mail.html },
        { logger },
      );
      await db.markEmailCodeSent(q, insId);
      logger?.info('auth.otp_requested', { email: maskEmail(target.email), purpose: 'admin_reset', sent: true, by: user.username });
      return (json(res, 200, { ok: true, hint: '验证码已发送到 ' + target.email, retryAfterSec: auth.SEND_COOLDOWN_SEC }), true);
    } catch (err) {
      await db.markEmailCodeFailed(q, insId, String(err.message).slice(0, 200));
      logger?.error('auth.otp_failed', { email: maskEmail(target.email), purpose: 'admin_reset', reason: 'send_error', message: String(err.message).slice(0, 200) });
      return (json(res, 502, { error: '发送失败：' + String(err.message).slice(0, 160) }), true);
    }
  }

  const pwdMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
  if (pwdMatch && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const rawPassword = String(body.password ?? '');
    const username = decodeURIComponent(pwdMatch[1]);
    const before = await db.userEmailIdRow(q, username);
    if (!before) return (json(res, 404, { error: '没有该用户' }), true);
    // DT-4（docs/ADMIN-PERMISSIONS.md）：验证码模式——重置密码弹窗「确认重置」。
    // 校验管理员在弹窗里输入的验证码（purpose='admin_reset'）：失败不重置、返回剩余次数
    // （前端弹窗不关、显示「还剩 N 次机会」）；过期/无码给出可重发提示（前端显示「重新发送」）。
    const code = String(body.code ?? '').trim();
    if (code) {
      if (!before.email) return (json(res, 400, { error: '该用户还没有绑定邮箱' }), true);
      const auth = await import('../email-auth.js');
      if (!/^\d{6}$/.test(code)) return (json(res, 400, { error: '验证码格式不正确' }), true);
      const row = await db.pendingEmailCode(q, { email: before.email, purpose: 'admin_reset' });
      if (!row) {
        logger?.warn('auth.otp_rejected', { email: maskEmail(before.email), purpose: 'admin_reset', reason: 'no_code', by: user.username });
        return (json(res, 400, { error: '没有可用的验证码，请先发送', code: 'no_code' }), true);
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        logger?.warn('auth.otp_rejected', { email: maskEmail(before.email), purpose: 'admin_reset', reason: 'expired', by: user.username });
        return (json(res, 400, { error: '验证码已过期，请重新发送', code: 'expired' }), true);
      }
      if (row.attempts >= auth.CODE_MAX_ATTEMPTS) {
        logger?.warn('auth.otp_rejected', { email: maskEmail(before.email), purpose: 'admin_reset', reason: 'too_many_attempts', by: user.username });
        return (json(res, 429, { error: '尝试次数过多，请重新发送验证码', code: 'too_many' }), true);
      }
      if (!auth.verifyCodeHash(before.email, code, row.code_hash)) {
        await db.bumpEmailCodeAttempts(q, row.id);
        const remaining = Math.max(0, auth.CODE_MAX_ATTEMPTS - (row.attempts + 1));
        logger?.warn('auth.otp_rejected', { email: maskEmail(before.email), purpose: 'admin_reset', reason: 'wrong_code', attempts: row.attempts + 1, remaining, by: user.username });
        return (json(res, 400, { error: '验证码不正确', remainingAttempts: remaining }), true);
      }
      await db.consumeEmailCode(q, row.id);
      // 验证码通过：生成临时密码重置（只回一次），强制首登改密 + 踢全部会话（与直设密码同口径）
      const generated = passwordPolicy.generateTempPassword();
      const rowU = await db.setUserPassword(q, { username, password: generated, mustChange: true });
      if (!rowU) return (json(res, 404, { error: '没有该用户' }), true);
      await db.deleteSessionsOfUser(q, before.id).catch(() => 0);
      logger?.info('api.user_password_reset_by_code', { username, by: user.username });
      await db.writeAuditLog(q, {
        actorId: user.id,
        actor: user.username,
        action: 'admin.password_reset_code',
        target: `user:${username}`,
        detail: { method: 'email_code' },
        ip,
      }).catch(() => {});
      return (json(res, 200, { ok: true, tempPassword: generated, message: '密码已重置，请把临时密码交给用户（首次登录需修改）' }), true);
    }
    // AK-3（docs/AUTH-REDESIGN.md §4.5）：密码可留空 → 生成临时密码（响应只回一次）；
    // 重置一律 must_change_password=true；不再顺带启用账号（启用/禁用是独立动作）
    const generated = rawPassword ? null : passwordPolicy.generateTempPassword();
    const password = rawPassword || generated;
    const policyError = passwordPolicy.passwordPolicyError(password, { username, email: before.email ?? '' });
    if (policyError) return (json(res, 400, { error: policyError }), true);
    const row = await db.setUserPassword(q, { username, password, mustChange: true });
    if (!row) return (json(res, 404, { error: '没有该用户' }), true);
    logger?.info('api.user_password_reset', { username, by: user.username });
    // AJ 批：重置密码同步发通知；正文只写"已重置，请向管理员获取新密码"，
    // 绝不出现新密码明文（docs/USER-LIFECYCLE.md 决策 3）
    const notifyResult = await accountNotify.notifyUserActionQueued({
      q,
      logger,
      user: { username, email: before.email },
      action: 'account_password_reset',
      actor: user.username,
      siteUrl: baseUrl(req),
      contactEmail: appealEmail(),
    });
    return (json(res, 200, {
      ok: true,
      notify: { status: notifyResult.status, error: notifyResult.error ?? null },
      ...(generated ? { tempPassword: generated } : {}),
    }), true);
  }

  // AK-2（docs/AUTH-REDESIGN.md §4.4）：管理员解锁——清零失败计数与锁定
  const unlockMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/unlock$/);
  if (unlockMatch && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const username = decodeURIComponent(unlockMatch[1]);
    const row = await db.unlockUser(q, { username });
    if (!row) return (json(res, 404, { error: '没有该用户' }), true);
    logger?.info('admin.user_unlocked', { username, by: user.username });
    return (json(res, 200, { user: row }), true);
  }

  // ---- 管理员：给用户绑定/解绑登录邮箱 ----
  const bindMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/email$/);
  if (bindMatch && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const auth = await import('../email-auth.js');
    const raw = String(body.email ?? '').trim();
    const email = raw ? auth.normalizeEmail(raw) : null;
    if (raw && !email) return (json(res, 400, { error: '邮箱格式不正确' }), true);
    const username = decodeURIComponent(bindMatch[1]);
    // AJ 批：改邮箱前先读旧邮箱（变更通知的收件人判定用，docs/USER-LIFECYCLE.md 决策 8/18）
    const oldRow = await db.userStateRow(q, username);
    if (!oldRow) return (json(res, 404, { error: '没有该用户' }), true);
    const doBind = () => db.adminBindEmail(q, { email, username });
    try {
      let r;
      try {
        r = await doBind();
      } catch (err) {
        // 旧库可能缺列：补建后重试一次，避免只报"服务器错误"
        if (String(err.code) === '42703') {
          await db.ensureUsersEmailColumns(q);
          r = await doBind();
        } else {
          throw err;
        }
      }
      if (!r.rows.length) return (json(res, 404, { error: '没有该用户' }), true);
      logger?.info('api.user_email_bound', {
        username,
        email: email ? String(email).replace(/^(.)(.*)(@.*)$/, '$1***$3') : null,
        by: user.username,
      });
      // CZ 批（docs/EMAIL-CHANGE.md 决策 5）：管理员重置邮箱是安全兜底，必须落审计 admin.email_reset
      // （新旧邮箱脱敏）；审计失败绝不阻塞绑定（audit_logs 表由迁移提供，早期库缺失时静默跳过）。
      await db.writeAuditLog(q, {
        actorId: user.id,
        actor: user.username,
        action: 'admin.email_reset',
        target: username,
        detail: {
          oldEmail: maskEmail(String(oldRow.email ?? '')),
          newEmail: email ? maskEmail(email) : null,
        },
        ip,
      });
      // AJ 批：改邮箱发两封（docs/USER-LIFECYCLE.md §4.2/决策 18）——异步发送，响应 notify:'queued'，
      // 避免两封串行拖住请求。旧邮箱收「登录邮箱已变更」（旧邮箱为空/未验证时改发新邮箱），
      // 新邮箱收「绑定成功」；新旧邮箱相同时只发「绑定成功」一封；解绑（新邮箱为空）不发。
      const reply = { user: r.rows[0] };
      if (email) {
        const oldEmail = String(oldRow.email ?? '').trim();
        const oldUsable = Boolean(oldEmail && oldRow.email_verified);
        const same = Boolean(oldEmail && oldEmail.toLowerCase() === email.toLowerCase());
        const base = {
          q,
          logger,
          user: { username, email },
          actor: user.username,
          siteUrl: baseUrl(req),
          contactEmail: appealEmail(),
          extra: { action: maskEmail(email) },
        };
        if (!same) {
          void accountNotify.notifyUserActionQueued({ ...base, action: 'account_email_changed', to: oldUsable ? oldEmail : email });
        }
        void accountNotify.notifyUserActionQueued({ ...base, action: 'account_email_bound', to: email });
        reply.notify = 'queued';
      }
      return (json(res, 200, reply), true);
    } catch (err) {
      if (String(err.code) === '23505') return (json(res, 409, { error: '这个邮箱已被其他账号绑定' }), true);
      logger?.error('api.user_email_bind_failed', {
        username,
        code: err.code ?? null,
        message: String(err.message).slice(0, 200),
        by: user.username,
      });
      return (json(res, 500, { error: '绑定失败：' + String(err.message).slice(0, 160) }), true);
    }
  }

  if (path === '/api/admin/users' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    return (json(res, 200, { users: await db.listUsers(q) }), true);
  }

  // 最近删除审计（docs/USER-LIFECYCLE.md §4.5，AH 批）：只读，按用户名模糊搜索
  if (path === '/api/admin/users/deletions' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const search = String(url.searchParams.get('q') ?? '').trim().slice(0, 80);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
    return (json(res, 200, { deletions: await db.listUserDeletions(q, { search, limit }) }), true);
  }

  // DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：新建用户入口下线——管理员不再建号，
  // 用户只能走自助注册（邮箱 OTP：POST /api/auth/register/request → verify）。
  if (path === '/api/admin/users' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    logger?.info('admin.user_create_rejected', { by: user.username });
    return (json(res, 410, { error: '管理员不再支持新建用户，请用户自助注册' }), true);
  }

  // ---- 管理员：批量操作（统一入口 + 白名单派发表，见 docs/ADMIN-BULK-ACTIONS.md）----
  if (path === '/api/admin/bulk' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const startedAt = Date.now();
    let body;
    try {
      body = await readBody(req, 256 * 1024);
    } catch {
      return (json(res, 400, { error: '请求格式错误' }), true);
    }
    if (!body || typeof body !== 'object') return (json(res, 400, { error: '请求格式错误' }), true);
    const target = String(body.target ?? '').trim();
    const action = String(body.action ?? '').trim();
    const reject = async (status, reason) => {
      logger?.warn('admin.bulk_rejected', {
        target,
        action,
        reason,
        count: Array.isArray(body.keys) ? body.keys.length : 0,
        by: user.username,
      });
      return (json(res, status, { error: reason }), true);
    };
    const def = BULK_ACTIONS[`${target}/${action}`];
    if (!def) return reject(400, '不支持的批量操作');
    if (!Array.isArray(body.keys)) return reject(400, 'keys 必须是数组');
    if (!body.keys.length) return reject(400, '请先选择要操作的条目');
    // 逐条校验 → 规范化 → 去重：IP 的大小写/CIDR 写法、指纹大小写、id 写成字符串都算同一个键
    const keys = [];
    const seen = new Set();
    for (const raw of body.keys) {
      const key = normalizeBulkKey(def.keyType, raw);
      if (key == null) return reject(400, BULK_KEY_ERROR[def.keyType]);
      const sig = String(key);
      if (seen.has(sig)) continue;
      seen.add(sig);
      keys.push(key);
    }
    if (!keys.length) return reject(400, '请先选择要操作的条目');
    if (keys.length > def.max) return reject(400, `单次最多 ${def.max} 条`);
    // 高危动作必须在服务端二次确认，不能只靠前端弹窗
    if (def.risk === 'high') {
      const confirmCount = Number(body.confirmCount);
      if (!Number.isInteger(confirmCount) || confirmCount !== keys.length) {
        return reject(400, `高危操作需要确认条数（本次 ${keys.length} 条）`);
      }
    }
    if (def.guard) {
      const blockedReason = await def.guard({ q, keys, user });
      if (blockedReason) return reject(409, blockedReason);
    }
    let outcome;
    try {
      outcome = await def.run({ q, keys, options: body.options, user, logger, banIpExclusive });
    } catch (err) {
      logger?.error('admin.bulk_failed', { target, action, message: String(err.message).slice(0, 200), by: user.username });
      return (json(res, 500, { error: '批量执行失败，请稍后重试' }), true);
    }
    const results = (outcome.results || []).slice(0, 200);
    const ok = Number(outcome.ok) || 0;
    const failed = results.filter((item) => item.status === 'failed').length;
    const skipped = results.filter((item) => item.status === 'skipped').length;
    const durationMs = Date.now() - startedAt;
    let opId = null;
    try {
      const op = await db.createBulkOp(q, {
        actorId: user.id,
        actor: user.username,
        target,
        action,
        total: keys.length,
        ok,
        failed,
        skipped,
        keysSample: keys.map((k) => String(k)),
        options: body.options ?? null,
        ip,
        durationMs,
      });
      opId = op.id;
    } catch (err) {
      // 审计写失败不影响已执行的结果，但必须留下证据
      logger?.error('admin.bulk_audit_failed', { target, action, message: String(err.message).slice(0, 200) });
    }
    logger?.info('admin.bulk', { opId, target, action, total: keys.length, ok, failed, skipped, by: user.username });
    for (const item of results.filter((r) => r.status === 'failed').slice(0, 20)) {
      logger?.warn('admin.bulk_item_failed', { target, action, key: String(item.key).slice(0, 64), message: item.reason });
    }
    const reply = { opId, total: keys.length, ok, failed, skipped, results };
    // 互斥回执（docs/BAN-AND-SECURITY-FIXES.md §4.1）：批量封/信任时带被互斥移除的对侧条目数
    if (Number.isFinite(outcome.removedFromWhitelist)) reply.removedFromWhitelist = outcome.removedFromWhitelist;
    if (Number.isFinite(outcome.removedFromBlacklist)) reply.removedFromBlacklist = outcome.removedFromBlacklist;
    // B2 批：批量操作可能改 games 列表内容（封/恢复/删/停用等），短缓存立即失效
    invalidateAdminGamesCache();
    invalidateListCache(); // DX 批：批量封/恢复/删/停用同样影响前台列表，一并失效
    return (json(res, 200, reply), true);
  }

  // ---- 管理员：批量操作记录（审计：谁、何时、对哪个列表、做了什么、成败多少）----
  if (path === '/api/admin/bulk-ops' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const target = url.searchParams.get('target') || null;
    return (json(res, 200, { ops: await db.listBulkOps(q, { limit, target }) }), true);
  }
  const bulkOpMatch = path.match(/^\/api\/admin\/bulk-ops\/(\d+)$/);
  if (bulkOpMatch && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const op = await db.getBulkOp(q, Number(bulkOpMatch[1]));
    if (!op) return (json(res, 404, { error: '记录不存在' }), true);
    return (json(res, 200, { op }), true);
  }

  return false;
}
