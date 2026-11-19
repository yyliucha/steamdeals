// CO-4/B4（docs/DESIGN-AUDIT.md B4）：App 域路由模块——从 src/server.js 巨石抽出的第一个试点域。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · GET  /api/app/status          CA-1 App 启动封禁自查（预检段，见下）
//   · POST /api/auth/token          CA-1 App Bearer Token 签发（Web 登录在 server.js，与本域共用登录计数）
//   · POST /api/auth/token/revoke   CA-1 撤销当前 Bearer token（退出登录）
//   · GET  /api/app/latest          BY/CJ/DK App 版本卡（apkPath 三级派生）
//   · GET  /api/admin/app-sync/status   DR App 版本卡状态（管理员只读）
//   · POST /api/admin/app-sync          DR App 立即同步 GitHub Release（single-flight）
//
// 两个入口（顺序语义，见 docs/ARCHITECTURE.md「域路由拆分模式」）：
//   · handleAppPreflight(ctx)：拦截链/设备限流**之前**——/api/app/status 豁免一切限流（契约 §3）；
//   · handleAppRoutes(ctx)：认证上下文（user/bearer/requireAdmin）就绪之后的主段。
//
// 留在 server.js 的中间件（作用于全部 /api/app/*，不属于本域路由）：
//   · 前缀重写 /api/app/<rest> → /api/<rest>（CA-1）；Bearer 解析与 user 解析（认证上下文）；
//   · /api/app/* 封禁豁免 + 设备维度限流（CO-3/C2）。
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as db from '../store/pg.js';
import * as devices from '../devices.js';
import * as visitors from '../visitors.js';
import * as autoBan from '../auto-ban.js';
import { readLatestMeta, githubApkUrl, syncAppRelease, appApkPathFor } from '../app-release.js';

/**
 * 预检段：必须跑在设备维度限流与封禁拦截链之前（server.js 在 /api/ban/state 之后立即调用）。
 * 目前只有 /api/app/status 一个路由：无副作用、匿名、豁免封禁拦截，只回调用者自己的封禁状态。
 */
export async function handleAppPreflight(ctx) {
  const { path, req, res, json, ip, whitelisted } = ctx;
  if (path !== '/api/app/status' || req.method !== 'GET') return false;
  // CA-1（docs/APP-API.md §3）：App 启动封禁检查——检查顺序：IP 黑名单 → 设备封禁（X-Device-Id）。
  const appDeviceId = devices.normalizeDeviceId(String(req.headers['x-device-id'] ?? ''));
  let banned = false;
  let type = null;
  let until = null;
  if (!whitelisted) {
    const ipBlocked = ip && visitors.blockedBy(ip) ? true : false;
    const devBan = appDeviceId ? devices.isBanned({ deviceId: appDeviceId }) : null;
    if (ipBlocked) {
      banned = true;
      type = 'ip';
    } else if (devBan) {
      banned = true;
      type = 'device';
      until = devBan.until ? new Date(devBan.until).toISOString() : null;
    }
  }
  json(res, 200, { banned, type, until }, { 'cache-control': 'no-store' });
  return true;
}

/**
 * 主段：认证上下文就绪后调用。ctx 字段契约见 docs/ARCHITECTURE.md「路由上下文注入」。
 * 返回 true = 已处理并结束响应；false = 未命中本域，宿主继续后续路由链。
 */
export async function handleAppRoutes(ctx) {
  const {
    path,
    req,
    res,
    q,
    logger,
    json,
    readBody,
    ip,
    user,
    bearer,
    captcha,
    requireAdmin,
    frontendDir,
    appSyncDir,
    appSyncFetchImpl,
    appSync,
    loginIpFails,
    autoBanScope,
    tryAutoBan,
  } = ctx;

  // ---- CA-1（docs/APP-NATIVE.md §3.2）：App Token 认证 ----
  // POST /api/auth/token：用户名 + 密码 + 图形验证码（必填）+ rememberMe。
  // 失败限流/账号锁定与 Web 登录共用同一套计数（loginIpFails 20 次/15 分钟 → 429；账号 5 次锁 15 分钟）。
  // 明文 token 只在本响应出现一次；库中只存哈希，审计日志只记 user_id/IP/设备名。
  if (path === '/api/auth/token' && req.method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    const deviceName = String(body.deviceName ?? '').trim().slice(0, 64) || null;
    // 验证码校验放在密码之前：没通过就不消耗密码尝试次数
    if (captcha.enabled()) {
      const okCaptcha = await captcha.verify(q, body.captchaToken, body.captchaAnswer);
      if (!okCaptcha) {
        logger?.warn('api.token_captcha_failed', { ip, username: username.slice(0, 32) });
        json(res, 400, { error: '验证码错误或已过期，请重新输入' });
        return true;
      }
    }
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
      logger?.warn('auth.ip_throttled', { ip, count: ipEntry.count, via: 'token' });
      json(res, 429, { error: '尝试次数过多，请稍后再试', retryAfterSec });
      return true;
    }
    loginIpFails.set(ip, ipEntry);

    const found = await db.findUserByName(q, username);
    if (found && found.locked_until && Date.parse(found.locked_until) > now) {
      if (autoBanScope) {
        const t = autoBan.recordCredentialFail(ip);
        if (t) await tryAutoBan(t, `登录凭据爆破：15 分钟失败 ${t.count} 次`);
      }
      logger?.warn('auth.token_rejected_locked', { username });
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
      const reason = !found ? 'unknown' : found.disabled ? 'disabled' : 'bad_password';
      if (found && !found.disabled) {
        const updated = await q('update users set failed_login_count = failed_login_count + 1 where id = $1 returning failed_login_count', [
          found.id,
        ]);
        const attempts = Number(updated.rows[0]?.failed_login_count ?? 0);
        if (attempts >= 5) {
          const locked = await q("update users set locked_until = now() + interval '15 minutes' where id = $1 returning locked_until", [
            found.id,
          ]);
          logger?.warn('auth.token_locked', { username, until: locked.rows[0]?.locked_until });
        }
      }
      ipEntry.count += 1;
      loginIpFails.set(ip, ipEntry);
      logger?.warn('auth.token_failed', { username: username.slice(0, 32), reason });
      json(res, 401, { error: '用户名或密码错误' });
      return true;
    }
    await q('update users set failed_login_count = 0, locked_until = null where id = $1', [found.id]);
    const days = body.rememberMe ? 30 : 7;
    const issued = await db.insertApiToken(q, { userId: found.id, name: deviceName, days });
    logger?.info('auth.token_issued', { userId: found.id, username: found.username, deviceName: deviceName ?? null, ip, days });
    json(res, 200, {
      token: issued.token,
      expiresAt: issued.expiresAt,
      user: {
        id: found.id,
        username: found.username,
        role: found.role,
        mustChangePassword: Boolean(found.must_change_password),
      },
    });
    return true;
  }

  // POST /api/auth/token/revoke：撤销当前 Bearer token（退出登录）；无 Bearer / token 失效一律 401。
  if (path === '/api/auth/token/revoke' && req.method === 'POST') {
    if (!bearer || !user) {
      json(res, 401, { error: 'login_required' });
      return true;
    }
    const revoked = await db.revokeApiToken(q, bearer);
    logger?.info('auth.token_revoked', { userId: user.id, ip, revoked });
    json(res, 200, { ok: true });
    return true;
  }

  // ---- CJ 批（docs/APP-AUTO-UPDATE-PAGE.md §3）：优先读 data/app/latest.json（每小时同步），缺失回落镜像文件 ----
  if (path === '/api/app/latest' && req.method === 'GET') {
    const file = process.env.APP_LATEST_FILE ?? resolve(frontendDir ?? 'frontend/dist', 'app', 'latest.json');
    const { data } = readLatestMeta(process.env.APP_DATA_DIR ?? 'data/app', file);
    try {
      // BY 批（docs/MOBILE-APP-UPDATE.md §3）：versionCode/minVersionCode/notes 透传，
      // 缺失时返回 null 不报错（旧清单/旧客户端不受影响）；notes 兼容旧字符串格式（按单条处理）。
      // CJ 现场回归修复：apkPath 按文件真实存在性派生（data/app → 镜像 → null），不再无条件 /app/dl/。
      // DK 批（docs/TODO.md DK A）：本地与镜像都没有 → GitHub Release 直链兜底（不再 null）。
      json(res, 200, {
        version: data.version ?? null,
        versionCode: data.versionCode == null ? null : Number(data.versionCode),
        minVersionCode: data.minVersionCode == null ? null : Number(data.minVersionCode),
        notes: data.notes == null ? null : (Array.isArray(data.notes) ? data.notes : [data.notes]),
        apkPath: appApkPathFor(data?.version, frontendDir) ?? githubApkUrl(data?.version),
        sha256: data.sha256 ?? null,
        size: data.size == null ? null : Number(data.size),
        releasedAt: data.releasedAt ?? null,
      });
    } catch (err) {
      logger?.warn?.('api.app_latest_missing', { file, message: String(err?.message ?? err).slice(0, 120) });
      json(res, 200, { version: null, versionCode: null, minVersionCode: null, notes: null, apkPath: null, sha256: null, size: null, releasedAt: null });
    }
    return true;
  }

  // ---- DR 批（docs/APP-INSTANT-UPDATE.md §3.1）：App 版本卡状态（只读）+ 管理员立即同步 ----
  if (path === '/api/admin/app-sync/status' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const appDir = appSyncDir ?? process.env.APP_DATA_DIR ?? 'data/app';
    const file = process.env.APP_LATEST_FILE ?? resolve(frontendDir ?? 'frontend/dist', 'app', 'latest.json');
    const { data, source } = readLatestMeta(appDir, file);
    let lastSyncAt = null;
    try {
      const p = join(resolve(process.cwd(), appDir), 'latest.json');
      if (existsSync(p)) lastSyncAt = new Date(statSync(p).mtimeMs).toISOString();
    } catch { /* 无本地文件 */ }
    let lastError = null;
    try {
      lastError = await db.lastFailedSyncRun(q, 'app-sync');
    } catch { /* sync_runs 缺失时忽略 */ }
    json(res, 200, {
      latest: data
        ? {
            version: data.version ?? null,
            versionCode: data.versionCode == null ? null : Number(data.versionCode),
            releasedAt: data.releasedAt ?? null,
          }
        : null,
      source,
      lastSyncAt,
      lastError,
      syncing: Boolean(appSync.inFlight),
    });
    return true;
  }

  if (path === '/api/admin/app-sync' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const appDir = appSyncDir ?? process.env.APP_DATA_DIR ?? 'data/app';
    const syncedAt = new Date().toISOString();
    // single-flight：并发请求共用同一个进行中的 Promise（验收 §4.1「并发两次只跑一次」）
    const startedHere = !appSync.inFlight;
    if (!appSync.inFlight) {
      appSync.inFlight = (async () => {
        return syncAppRelease({
          repo: process.env.APP_RELEASE_SYNC_REPO ?? 'yyliucha/steamdeals-app',
          keep: Number(process.env.APP_RELEASE_SYNC_KEEP ?? 3),
          dir: appDir,
          force: true,
          logger,
          fetchImpl: appSyncFetchImpl,
        });
      })().finally(() => {
        appSync.inFlight = null;
      });
    }
    let result;
    try {
      result = await appSync.inFlight;
    } catch (err) {
      const message = String(err?.message ?? err).slice(0, 120);
      if (startedHere) logger?.warn('app.sync_manual', { by: user.username, reason: 'exception', message });
      else logger?.info('app.sync_manual_joined', { by: user.username, reason: 'exception' });
      await db
        .writeAuditLog(q, {
          actorId: user.id,
          actor: user.username,
          action: 'admin.app_sync',
          target: 'app-release-sync',
          detail: { outcome: 'exception', message, joined: !startedHere },
          ip,
        })
        .catch(() => {});
      json(res, 502, { ok: false, reason: 'exception', syncedAt });
      return true;
    }
    const reason = result.apkFailed ?? (result.synced ? null : result.reason);
    if (startedHere) {
      logger?.info('app.sync_manual', {
        by: user.username,
        version: result.version ?? null,
        reason: reason ?? null,
        synced: result.synced,
      });
    } else {
      logger?.info('app.sync_manual_joined', { by: user.username, version: result.version ?? null, reason: reason ?? null });
    }
    await db
      .writeAuditLog(q, {
        actorId: user.id,
        actor: user.username,
        action: 'admin.app_sync',
        target: 'app-release-sync',
        detail: { version: result.version ?? null, reason: reason ?? null, synced: result.synced, joined: !startedHere },
        ip,
      })
      .catch(() => {});
    json(res, result.synced ? 200 : 502, {
      ok: result.synced,
      version: result.version ?? null,
      apk: result.apk ?? null,
      reason: reason ?? null,
      syncedAt,
    });
    return true;
  }

  return false;
}
