// CO-5/B4-2 第三轮（docs/DESIGN-AUDIT.md B4）：认证域路由模块——从 src/server.js 巨石抽出的第三个域。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · POST /api/device                 设备注册（公开段，见下）
//   · GET  /api/captcha                图形验证码（与申诉域共用限流桶，按引用传 ctx）
//   · POST /api/login                  Web 账号密码登录（与 App token 登录共用 IP 失败计数 Map）
//   · POST /api/password/check         密码强度评估（匿名，每 IP 每分钟 30 次）
//   · POST /api/logout                 登出（撤销当前会话 cookie）
//   · POST /api/user/password          登录用户改密（AK-3：旧密码校验 + 策略 + 踢其它会话）
//   · GET  /api/auth/steam/start       Steam 绑定发起（CX 批，back=profile 回个人资料页）
//   · GET  /api/auth/steam/callback    Steam OpenID 回调绑定（state 防 CSRF + 唯一性/上限校验）
//
// 两个入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3）：
//   · handleAuthPublic(ctx)：拦截链之后、认证上下文解析**之前**——/api/device 必须在
//     must_change_password 白名单之前（改密页也要能注册设备，原位置语义，移动 = 改契约）；
//   · handleAuthRoutes(ctx)：认证上下文（user/bearer/requireUser）就绪之后的主段
//     （must_change_password 白名单是中间件、留在 server.js；本域全部路由都在它之后）。
//
// 留在 server.js 的中间件（作用于整条请求链，不属于本域路由）：
//   · /api/captcha GET 的拦截链豁免（appealExempt）、must_change_password 白名单；
//   · loginIpFails 计数 Map（与 App token 登录共用）、bindStates（Steam state 持有）、
//     appealBucketLimited 限流桶（与 /api/captcha 共用）——都按引用传 ctx（语义共享）；
//   · 邮箱验证码/注册/换邮箱仍独立成 src/auth-routes.js（含 /api/me/email/*，属 DT-2 排除区，本轮不动）。
import * as db from '../store/pg.js';
import * as devices from '../devices.js';
import * as captcha from '../captcha.js';
import * as autoBan from '../auto-ban.js';
import * as passwordPolicy from '../password-policy.js';
import * as steamMod from '../steam-login.js';
import * as steamLogMod from '../steam-log.js';
import { sessionCookie } from '../session-cookie.js';
import { ipSessionKey, uaSessionKey } from '../session-fingerprint.js';

// CX 批：每用户最多绑定 5 个 Steam 账号。server.js 的 /api/steam/accounts 也用它（同一上限），
// 所以从本域导出、server.js 导入——单一定义，避免两处漂移。
export const MAX_ACCOUNTS_PER_USER = 5;

// gp_device 与 server.js 的 DEVICE_COOKIE 同值：cookie 解析（读）留在 server.js 拦截链，
// 签发（写）随设备注册路由移入本文件——两端必须保持一致。
const DEVICE_COOKIE = 'gp_device';
const deviceCookie = (req, value, maxAgeSec) => sessionCookie(req, value, maxAgeSec, DEVICE_COOKIE);

// AK-1（docs/AUTH-REDESIGN.md §4.1）：/api/password/check 匿名限流计数（每 IP 每分钟 30 次，内存态）。
// 只被本域一个路由使用，随域移入；模块级 = 进程级（与拆分前 server.js 模块级 Map 同语义）。
const passwordCheckHits = new Map();

// 与 server.js 的 wantsHtml 同语义（认证域模块不能 import server.js，避免循环依赖）——
// Steam 回调失败时决定返回 JSON 还是 302 到控制台提示。
const wantsHtml = (req) =>
  /text\/html/i.test(String(req.headers.accept ?? '')) && !String(req.url ?? '').startsWith('/api/');

/**
 * 公开段：server.js 在拦截链之后、认证上下文解析之前调用（与申诉公开段同位置）。
 * 目前只有 /api/device 一个路由：匿名、无副作用入口，设备封禁判定在这里做。
 * 返回 true = 已处理并结束响应；false = 未命中本域，宿主继续后续路由链。
 */
export async function handleAuthPublic(ctx) {
  const { path, req, res, q, logger, json, readBody, ip } = ctx;

  if (path === '/api/device' && req.method === 'POST') {
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
    const deviceId = devices.normalizeDeviceId(body?.deviceId);
    const details = devices.sanitizeDetails(body?.details);
    const fingerprint = devices.fingerprintOf(details);
    const cookie = deviceCookie(req, deviceId, deviceId ? 31536000 : 0);
    const ban = devices.isBanned({ deviceId, fingerprint });
    if (ban) {
      logger?.warn('device.banned', { ip, deviceId: deviceId || null, fingerprint: fingerprint.slice(0, 16), until: ban.until });
      json(res, 403, { banned: true, until: ban.until, reason: ban.note || '设备已被封禁' }, { 'set-cookie': cookie });
      return true;
    }
    if (deviceId) devices.rememberDevice(deviceId, fingerprint, details);
    if (devices.shouldLog(deviceId || fingerprint)) {
      db.insertDeviceLog(q, { ip, deviceId, fingerprint, userAgent: req.headers['user-agent'], details }).catch(() => {});
    }
    json(res, 200, { ok: true, fingerprint: fingerprint.slice(0, 16) }, { 'set-cookie': cookie });
    return true;
  }

  return false;
}

/**
 * 主段：认证上下文（user/bearer/requireUser）就绪后调用。ctx 字段契约见
 * docs/ARCHITECTURE.md「路由上下文注入」。loginIpFails 与 App token 登录共用同一计数 Map
 * （按引用传递，两边写同一份）；bindStates 由 server.js 持有（按引用传递）；steamVerify 是
 * 测试注入的 verifyCallback 替身（默认走 Steam OpenID 校验）。
 * 返回 true = 已处理并结束响应；false = 未命中本域，宿主继续后续路由链。
 */
export async function handleAuthRoutes(ctx) {
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
    token,
    deviceId,
    captcha,
    requireUser,
    loginIpFails,
    autoBanScope,
    tryAutoBan,
    appealBucketLimited,
    bindStates,
    steamVerify,
  } = ctx;

  // ---- 登录 / 登出 ----
  // ---- 图形验证码（登录前置，匿名可拿；缓存禁止）----
  if (path === '/api/captcha' && req.method === 'GET') {
    // O 批打回修复：放行拦截链后自带轻量限流（每 IP 30 张/分钟），防止被封 IP 刷验证码表
    if (appealBucketLimited(ip, 'captcha', 30, 60_000)) {
      json(res, 429, { error: '请求过于频繁' }, { 'cache-control': 'no-store', 'retry-after': '60' });
      return true;
    }
    const cap = await captcha.issue(q);
    json(res, 200, cap, { 'cache-control': 'no-store' });
    return true;
  }

  if (path === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    // 验证码校验放在密码之前：没通过就不会消耗一次密码尝试，也不会泄露账号是否存在
    if (captcha.enabled()) {
      const okCaptcha = await captcha.verify(q, body.captchaToken, body.captchaAnswer);
      if (!okCaptcha) {
        logger?.warn('api.login_captcha_failed', { ip, username: username.slice(0, 32) });
        json(res, 400, { error: '验证码错误或已过期，请重新输入' });
        return true;
      }
    }
    // AK-2（docs/AUTH-REDESIGN.md §4.3）：IP 限速——同 IP 15 分钟失败 ≥20 次 → 429，不再消耗账号尝试次数
    const now = Date.now();
    const ipEntry = loginIpFails.get(ip) ?? { count: 0, windowStart: now };
    if (now - ipEntry.windowStart >= 15 * 60_000) {
      ipEntry.count = 0;
      ipEntry.windowStart = now;
    }
    if (ipEntry.count >= 20) {
      // CF 批：被 429 挡下的尝试也计入凭据爆破计数（≥50 次自动临时封）
      if (autoBanScope) {
        const t = autoBan.recordCredentialFail(ip);
        if (t) await tryAutoBan(t, `登录凭据爆破：15 分钟失败 ${t.count} 次`);
      }
      const retryAfterSec = Math.ceil((ipEntry.windowStart + 15 * 60_000 - now) / 1000);
      logger?.warn('auth.ip_throttled', { ip, count: ipEntry.count });
      json(res, 429, { error: '尝试次数过多，请稍后再试', retryAfterSec });
      return true;
    }
    loginIpFails.set(ip, ipEntry);

    const found = await db.findUserByName(q, username);
    // 账号锁定：5 次失败锁 15 分钟（锁定期内即使密码正确也先 429）
    if (found && found.locked_until && Date.parse(found.locked_until) > now) {
      if (autoBanScope) {
        const t = autoBan.recordCredentialFail(ip);
        if (t) await tryAutoBan(t, `登录凭据爆破：15 分钟失败 ${t.count} 次`);
      }
      logger?.warn('auth.login_rejected_locked', { username });
      json(res, 429, {
        error: '尝试次数过多，请稍后再试',
        lockedUntil: found.locked_until,
        retryAfterSec: Math.max(1, Math.ceil((Date.parse(found.locked_until) - now) / 1000)),
      });
      return true;
    }
    if (!found || found.disabled || !db.verifyPassword(password, found.password_hash)) {
      // CF 批：失败计入凭据爆破计数（≥50 次自动临时封；20 次起只 429 不变）
      if (autoBanScope) {
        const t = autoBan.recordCredentialFail(ip);
        if (t) await tryAutoBan(t, `登录凭据爆破：15 分钟失败 ${t.count} 次`);
      }
      // 统一 401「用户名或密码错误」：不再暴露账号是否存在/是否被禁用（验收 11）；原因只进日志
      const reason = !found ? 'unknown' : found.disabled ? 'disabled' : 'bad_password';
      let attempts = 0;
      if (found && !found.disabled) {
        attempts = await db.bumpLoginFailCount(q, found.id);
        if (attempts >= 5) {
          const lockedUntil = await db.lockUserAccount(q, found.id);
          logger?.warn('auth.login_locked', { username, until: lockedUntil });
        }
      }
      ipEntry.count += 1;
      loginIpFails.set(ip, ipEntry);
      logger?.warn('auth.login_failed', { username: username.slice(0, 32), reason, attempts });
      json(res, 401, { error: '用户名或密码错误' });
      return true;
    }
    // 成功：清零失败计数与锁定（验收 3「成功一次清零」）
    await db.resetLoginFailState(q, found.id);
    // AK-1：旧哈希静默升级 + 弱密码评估落库（不强制改密）
    let rehashed = false;
    if (db.passwordNeedsRehash(found.password_hash)) {
      await db.rehashUserPassword(q, found.id, db.hashPassword(password));
      rehashed = true;
      logger?.info('auth.password_rehashed', { userId: found.id });
    }
    const weak = passwordPolicy.evaluatePassword(password, { username: found.username, email: found.email ?? '' });
    await db.setUserWeakPassword(q, found.id, !weak.ok);
    // 记住我：勾选 30 天，不勾 7 天（决策）
    const days = body.rememberMe ? 30 : 7;
    const sessionToken = await db.createSession(q, {
      userId: found.id,
      days,
      // BK 批：建会话记录客户端指纹（IP/UA 归一化键 + 设备码）
      ip,
      ipKey: ipSessionKey(ip),
      userAgent: req.headers['user-agent'] ?? null,
      uaKey: uaSessionKey(req.headers['user-agent']),
      deviceId,
    });
    logger?.info('auth.login_ok', { userId: found.id, username: found.username, rehashed, weak: !weak.ok, days });
    json(
      res,
      200,
      {
        user: {
          id: found.id,
          username: found.username,
          role: found.role,
          mustChangePassword: Boolean(found.must_change_password),
        },
      },
      { 'set-cookie': sessionCookie(req, sessionToken, days * 86400) },
    );
    return true;
  }

  // AK-1（docs/AUTH-REDESIGN.md §4.1）：密码强度评估（匿名，每 IP 每分钟 30 次，只评估不回显用户信息）
  if (path === '/api/password/check' && req.method === 'POST') {
    const body = await readBody(req);
    const now = Date.now();
    const minuteKey = Math.floor(now / 60_000);
    const entry = passwordCheckHits.get(ip) ?? { minute: minuteKey, count: 0 };
    if (entry.minute !== minuteKey) {
      entry.minute = minuteKey;
      entry.count = 0;
    }
    entry.count += 1;
    if (entry.count > 30) {
      json(res, 429, { error: '请求过于频繁，请稍后再试' });
      return true;
    }
    passwordCheckHits.set(ip, entry);
    json(
      res,
      200,
      passwordPolicy.evaluatePassword(String(body.password ?? ''), {
        username: String(body.username ?? ''),
        email: String(body.email ?? ''),
      }),
    );
    return true;
  }

  if (path === '/api/logout' && req.method === 'POST') {
    await db.deleteSession(q, token);
    json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(req, '', 0) });
    return true;
  }

  // AK-3（docs/AUTH-REDESIGN.md §4.7）：登录用户修改密码——旧密码校验、策略、踢其它会话（保留当前）
  if (path === '/api/user/password' && req.method === 'POST') {
    if (!requireUser()) return true;
    const body = await readBody(req);
    const oldPassword = String(body.oldPassword ?? '');
    const newPassword = String(body.newPassword ?? '');
    const row = await db.userPasswordHash(q, user.id);
    if (!row || !db.verifyPassword(oldPassword, row.password_hash)) {
      json(res, 400, { error: '当前密码不正确' });
      return true;
    }
    const policyError = passwordPolicy.passwordPolicyError(newPassword, { username: user.username });
    if (policyError) {
      json(res, 400, { error: policyError });
      return true;
    }
    await db.changeUserPassword(q, user.id, db.hashPassword(newPassword));
    await db.deleteSessionsOfUser(q, user.id, { exceptToken: token });
    logger?.info('auth.password_changed', { userId: user.id });
    json(res, 200, { ok: true, message: '密码已修改，其它设备已退出登录' });
    return true;
  }

  if (path === '/api/auth/steam/start' && req.method === 'GET') {
    if (!requireUser()) return true;
    // CX 批：资料页发起的绑定带 back=profile，成功后回跳个人资料页；其余保持回 Steam 账号页
    const back = url.searchParams.get('back') === 'profile' ? 'profile' : 'steam';
    const state = steamMod.issueBindState(bindStates, user.id);
    const target = steamMod.buildLoginUrl(steamMod.baseUrl(req), state, { back });
    logger?.info('steam.bind_start', { userId: user.id, host: req.headers.host, back });
    res.writeHead(302, { location: target, 'cache-control': 'no-store' });
    res.end();
    return true;
  }

  if (path.startsWith('/api/auth/steam/callback')) {
    // CX 批：绑定成功/失败都回到发起处（profile=个人资料页；默认=Steam 账号页）
    const back = url.searchParams.get('back') === 'profile' ? 'profile' : 'steam';
    const bindResult = (location) => {
      const params = new URL(location, 'http://localhost').searchParams;
      // 成功（带 steamBound）一律 302；错误时浏览器 302 到控制台展示提示、API 客户端回 JSON 状态码
      if (params.has('steamBound') || !params.has('steamError')) {
        res.writeHead(302, { location, 'cache-control': 'no-store' });
        res.end();
        return true;
      }
      if (wantsHtml(req)) {
        res.writeHead(302, { location, 'cache-control': 'no-store' });
        res.end();
        return true;
      }
      const code = String(params.get('steamError') ?? '');
      const messages = {
        state: '绑定链接已失效或过期，请重新发起绑定',
        conflict: '该 Steam 账号已被其他用户绑定',
        limit: '最多绑定 5 个 Steam 账号',
        verify: 'Steam 校验失败，请重试',
      };
      const status = code === 'conflict' || code === 'limit' ? 409 : 400;
      json(res, status, { error: messages[code] ?? '绑定失败，请重试', code });
      return true;
    };
    // 1) 校验 state（防 CSRF / 防串号）＋ 与当前站点会话用户一致
    const stateUserId = steamMod.consumeBindState(bindStates, url.searchParams.get('state'));
    if (!stateUserId) {
      logger?.warn('steam.bind_state_invalid', { ip });
      return bindResult(`/console?section=${back}&steamError=state`);
    }
    if (!user || Number(user.id) !== Number(stateUserId)) {
      logger?.warn('steam.bind_session_mismatch', { stateUserId, sessionUserId: user?.id ?? null });
      return bindResult(`/console?section=${back}&steamError=state`);
    }
    // 2) Steam OpenID 校验 → steamId
    const steamId = await (steamVerify ?? steamMod.verifyCallback)(url, { logger });
    if (!steamId) return bindResult(`/console?section=${back}&steamError=verify`);
    // 3) 唯一性 / 上限校验
    const ownerId = await db.steamAccountOwnerId(q, steamId);
    if (ownerId != null && Number(ownerId) !== Number(user.id)) {
      logger?.warn('steam.bind_conflict', { steamId, ownedBy: ownerId, by: user.id });
      return bindResult(`/console?section=${back}&steamError=conflict`);
    }
    if (ownerId == null) {
      const count = await db.countUserSteamAccounts(q, user.id);
      if (count >= MAX_ACCOUNTS_PER_USER) {
        logger?.warn('steam.bind_limit', { steamId, userId: user.id, count });
        return bindResult(`/console?section=${back}&steamError=limit`);
      }
    }
    // 4) 落库（已绑定同人 = 幂等，只刷新昵称/头像）
    const apiKey = String(process.env.STEAM_API_KEY ?? '').trim();
    const persona = await steamMod.fetchPersona({ apiKey, steamId, logger });
    await db.upsertSteamAccount(q, { steamId, personaName: persona.personaName, avatar: persona.avatar, userId: user.id });
    logger?.info('steam.bind_ok', { steamId, userId: user.id, persona: persona.personaName ?? null });
    // DQ 批（docs/PROFILE-UI-2026-11-19.md 决策 1/§3）：绑定新账号不再自动改动头像（头像永远由用户上传）。
    // AT 批（docs/ADMIN-CONSOLE-IA.md §5）：绑定落一条审计；同步类动作由 syncAccount* 各自记录。
    await steamLogMod.recordSteamLog(q, {
      action: 'bind',
      steamId,
      personaName: persona.personaName,
      userId: user.id,
      username: user.username,
      actor: 'self',
      result: 'ok',
    });
    // BE 批（docs/WISHLIST-SITE-ONLY.md §4.4 决策 5）：绑定新账号**不再自动同步**（此时还没有该账号的 key），
    // 前台提示「请先为该账号配置 API Key，再点同步」。
    return bindResult(`/console?section=${back}&steamBound=1&steamNeedKey=1`);
  }

  return false;
}
