// CO-5/B4-2 第六轮（docs/DESIGN-AUDIT.md B4）：me 域路由模块——从 src/server.js 巨石
// 抽出的第六个域（当前用户资料/偏好/头像 + 头像公开只读 + 我的游戏库）。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · GET    /api/me                  当前用户：匿名 200 user:null；登录回完整本人资料 +
//                                       prefs + steamBound + timezone（CX/DA 批口径）
//   · POST   /api/prefs               保存本人偏好（theme/tab/sort/emailAlerts 等；缺省沿用现值）
//   · GET    /api/avatar/:userId      头像公开只读：custom 输出库内字节（ETag/304 长缓存）；
//                                       无头像 404（DQ 起 steam 来源已退役，不再 302）
//   · PATCH  /api/me/profile          昵称 2–20 字 / 简介 ≤200 字（管理员可空）；只认可编辑字段
//   · POST   /api/me/avatar           上传自定义头像（dataUrl 魔数/大小校验，≤512KB）
//   · DELETE /api/me/avatar           移除自定义头像（回退首字）
//   · GET    /api/me/library          我的游戏库与统计（每账号一卡 + 5 项汇总）
//   · /api/me/email/request|verify    留在 src/auth-routes.js（与 /api/auth/email* 同模块，
//                                       DT-2 排除区不拆半截——第三轮选域理由）
//
// 单一入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3）：
//   · handleMeRoutes(ctx)：认证上下文（user/requireUser）就绪之后的主段——本域全部路由
//     都在该位置执行（/api/me 与 /api/avatar/* 在 must_change_password 白名单里，
//     白名单检查是 server.js 中间件、留宿主）；移动调用位置 = 改契约（401/403 语义依赖该位置）。
//
// 返回值约定：true = 已处理并结束响应；false = 未命中本域，宿主继续。凡写过响应的分支
// 必须返回 true（json(...) 自身返回 undefined，直接 return json(...) 会让宿主误判未命中
// 继续跑完整条链 → 二次写头 ERR_HTTP_HEADERS_SENT，拆分回归实测踩过）。
//
// 留在 server.js 的中间件与未拆段（不属于本域）：
//   · must_change_password 白名单（p === '/api/me'、p.startsWith('/api/avatar/')）；
//   · /api/steam/accounts/*（steam accounts 域，B4 #7；其解绑/default 用
//     clearDefaultSteamIfMatches/setDefaultSteamAccount，留在 pg.js）；
//   · 本域无跨模块共享状态（无计数 Map/单飞对象/闭包），ctx 只需基座字段。
import * as db from '../store/pg.js';
import * as steamAccountsMod from '../steam-accounts.js';
import * as visitors from '../visitors.js';
import { SESSION_COOKIE_NAME } from '../session-cookie.js';

/** 与 auth-routes.js 的 parseCookiesLocal 同语义：me 域 ctx 无 token/cookies 字段（基座不动），
 *  current 会话判定需要当前会话 token——从原始请求头解析（与 server.js 主链同一 cookie 名）。 */
function cookieToken(req) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE_NAME) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** me 域 ctx 无 url 字段（基座不动）：查询参数从原始 req.url 解析（path 前缀重写不影响 query）。 */
function searchParamsOf(req) {
  try {
    return new URL(String(req.url ?? ''), 'http://local').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/**
 * 主段：server.js 在认证上下文（user/requireUser）就绪后调用。
 * ctx 字段契约见 docs/ARCHITECTURE.md「路由上下文注入」。
 * 返回 true = 已处理并结束响应；false = 未命中本域，宿主继续后续路由链。
 */
export async function handleMeRoutes(ctx) {
  const { path, req, res, q, logger, json, readBody, user, requireUser } = ctx;

  // ---- 当前用户与偏好 ----
  if (path === '/api/me' && req.method === 'GET') {
    const prefs = user ? await db.getPrefs(q, user.id) : null;
    // CX 批（docs/USER-PROFILE-EDIT.md §3）：user 带完整本人资料（display_name/bio/avatar 元信息）。
    // 本批无他人资料入口，email 只回显自己（CL 批口径不变）。
    const me = user ? await db.getUserPublic(q, user.id) : null;
    json(res, 200, {
      user: me
        ? {
            id: me.id,
            username: me.username,
            role: me.role,
            mustChangePassword: Boolean(user.must_change_password),
            email: me.email ?? null,
            emailVerified: Boolean(me.email_verified),
            displayName: me.display_name ?? null,
            bio: me.bio ?? null,
            avatarSource: me.avatar_source ?? null,
            avatarMime: me.avatar_mime ?? null,
            avatarUpdatedAt: me.avatar_updated_at ?? null,
            createdAt: me.created_at ?? null,
          }
        : null,
      prefs,
      // DA 批（docs/APP-FILTER-SERVER-SIDE.md §3）：App「已拥有」chip 仅登录且已绑定 Steam 时显示，
      // 站点 /api/me 与 App /api/app/me 共用本路由，steamBound 口径一致。
      steamBound: user ? (await db.countBoundSteamAccounts(q, user.id)) > 0 : false,
      // 站点时区（系统设置里的「时区」）：前端用它格式化时间，而不是浏览器本地时区
      timezone: process.env.TZ || 'Asia/Shanghai',
    });
    return true;
  }

  if (path === '/api/prefs' && req.method === 'POST') {
    if (!requireUser()) return true;
    const body = await readBody(req);
    const prefs = await db.savePrefs(q, user.id, body);
    logger?.info('api.prefs_saved', { userId: user.id, ...prefs });
    json(res, 200, { prefs });
    return true;
  }

  // ---- CX 批（docs/USER-PROFILE-EDIT.md §3）：个人资料编辑（只改自己；管理员与用户同一套接口）----

  // 头像公开只读：custom 输出库内字节（ETag/长缓存）；无头像 404（前端回退首字）。
  // DQ 批（docs/PROFILE-UI-2026-11-19.md 决策 1）：steam: 头像来源已退役（迁移清空），不再 302 到 Steam CDN。
  const avatarMatch = path.match(/^\/api\/avatar\/(\d+)$/);
  if (avatarMatch && req.method === 'GET') {
    const avatarUserId = Number(avatarMatch[1]);
    const row = await db.avatarOfUser(q, avatarUserId);
    if (!row) {
      json(res, 404, { error: '没有该用户' });
      return true;
    }
    const source = row.avatar_source ?? null;
    if (source === 'custom' && row.avatar_bytes) {
      const etag = `"av-${avatarUserId}-${row.avatar_updated_at ? new Date(row.avatar_updated_at).getTime() : 0}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag, 'cache-control': 'public, max-age=31536000, immutable' });
        res.end();
        return true;
      }
      res.writeHead(200, {
        'content-type': row.avatar_mime ?? 'image/png',
        'content-length': row.avatar_bytes.length,
        etag,
        'cache-control': 'public, max-age=31536000, immutable',
      });
      res.end(row.avatar_bytes);
      return true;
    }
    json(res, 404, { error: 'no avatar' });
    return true;
  }

  // 昵称 2–20 字 / 简介 ≤200 字（管理员可空；普通用户必填）。校验只认 body 里这三个可编辑字段 + 偏好两项，
  // 用户名 / 邮箱 / 角色 / userId 一律忽略（只读；越权传 userId 无效——写的是 session 用户自己）。
  if (path === '/api/me/profile' && req.method === 'PATCH') {
    if (!requireUser()) return true;
    const body = await readBody(req);
    const isAdmin = user.role === 'admin';
    const chars = (s) => [...String(s ?? '')].length;
    let displayName;
    if (body.displayName !== undefined && body.displayName !== null) {
      const raw = String(body.displayName).trim();
      const n = chars(raw);
      if (isAdmin) {
        displayName = raw || null;
      } else {
        if (n < 2 || n > 20) {
          json(res, 400, { error: '昵称需要 2–20 个字符' });
          return true;
        }
        displayName = raw;
      }
    }
    let bio;
    if (body.bio !== undefined && body.bio !== null) {
      const raw = String(body.bio).trim();
      const n = chars(raw);
      if (n > 200) {
        json(res, 400, { error: '个人简介不能超过 200 字' });
        return true;
      }
      if (isAdmin) {
        bio = raw || null;
      } else {
        if (n < 1) {
          json(res, 400, { error: '个人简介必填（1–200 字）' });
          return true;
        }
        bio = raw;
      }
    }
    let theme = undefined;
    if (body.theme !== undefined) {
      if (body.theme === null || body.theme === 'light' || body.theme === 'dark') theme = body.theme;
      else {
        json(res, 400, { error: '主题只能是 light / dark / null（跟随系统）' });
        return true;
      }
    }
    let emailAlerts = undefined;
    if (body.emailAlerts !== undefined) emailAlerts = Boolean(body.emailAlerts);
    const me = await db.updateUserProfile(q, { userId: user.id, displayName, bio });
    const prefs = await db.savePrefs(q, user.id, { theme, email_alerts: emailAlerts });
    logger?.info('api.profile_saved', { userId: user.id, displayName: displayName ?? me.display_name, bioSet: bio !== undefined, theme, emailAlerts });
    json(res, 200, {
      user: {
        id: me.id,
        username: me.username,
        role: me.role,
        email: me.email ?? null,
        emailVerified: Boolean(me.email_verified),
        displayName: me.display_name ?? null,
        bio: me.bio ?? null,
        avatarSource: me.avatar_source ?? null,
        avatarMime: me.avatar_mime ?? null,
        avatarUpdatedAt: me.avatar_updated_at ?? null,
        createdAt: me.created_at ?? null,
      },
      prefs,
    });
    return true;
  }

  // 自定义头像上传：JSON dataUrl（客户端裁剪 256×256，JPG/PNG/WebP/GIF，≤512KB），服务端校验魔数 + 大小后存库
  if (path === '/api/me/avatar' && req.method === 'POST') {
    if (!requireUser()) return true;
    // 头像 dataUrl 上限 512KB，请求体放宽到 600KB；超限时暂停读取并回 413（不 destroy 连接，客户端能拿到响应）
    const readAvatarBody = (r, limit) =>
      new Promise((done, fail) => {
        let size = 0;
        const chunks = [];
        r.on('data', (c) => {
          size += c.length;
          if (size > limit) {
            fail(new Error('too large'));
            r.pause();
            return;
          }
          chunks.push(c);
        });
        r.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (!raw) return done({});
          try {
            done(JSON.parse(raw));
          } catch {
            fail(new Error('invalid json'));
          }
        });
        r.on('error', fail);
      });
    const body = await readAvatarBody(req, 600 * 1024).catch(() => null);
    if (!body) {
      json(res, 413, { error: '请求体过大或不是有效 JSON' }, { connection: 'close' });
      return true;
    }
    const dataUrl = String(body?.dataUrl ?? '');
    if (dataUrl.length > 512 * 1024) {
      json(res, 413, { error: '头像过大：请裁剪为 256×256 后上传（≤512KB）' });
      return true;
    }
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
    if (!m) {
      json(res, 400, { error: '头像格式不支持：只接受 JPG / PNG / WebP / GIF 的 base64 dataUrl' });
      return true;
    }
    const mime = m[1].toLowerCase();
    let bytes;
    try {
      bytes = Buffer.from(m[2], 'base64');
    } catch {
      json(res, 400, { error: '头像数据不是有效的 base64' });
      return true;
    }
    if (!bytes.length) {
      json(res, 400, { error: '头像数据为空' });
      return true;
    }
    // 魔数校验（防把任意二进制伪装成图片存库）
    const sig = (hex) => bytes.subarray(0, hex.length / 2).toString('hex') === hex;
    const valid =
      (mime === 'image/png' && sig('89504e470d0a1a0a')) ||
      (mime === 'image/jpeg' && sig('ffd8ff')) ||
      (mime === 'image/gif' && (sig('474946383761') || sig('474946383961'))) ||
      (mime === 'image/webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP');
    if (!valid) {
      json(res, 400, { error: '头像文件内容与格式不符' });
      return true;
    }
    const after = await db.setUserAvatar(q, { userId: user.id, bytes, mime });
    logger?.info('api.avatar_uploaded', { userId: user.id, mime, bytes: bytes.length });
    json(res, 200, { avatarSource: after.avatar_source, avatarMime: after.avatar_mime, avatarUpdatedAt: after.avatar_updated_at });
    return true;
  }

  if (path === '/api/me/avatar' && req.method === 'DELETE') {
    if (!requireUser()) return true;
    const after = await db.clearUserAvatar(q, user.id);
    logger?.info('api.avatar_removed', { userId: user.id });
    json(res, 200, { avatarSource: after.avatar_source, avatarMime: after.avatar_mime, avatarUpdatedAt: after.avatar_updated_at });
    return true;
  }

  // 我的游戏库与统计（仅本人）：每账号一卡 + 5 项汇总
  if (path === '/api/me/library' && req.method === 'GET') {
    if (!requireUser()) return true;
    const me = await db.getUserPublic(q, user.id);
    const accounts = await steamAccountsMod.listUserAccounts(q, user.id);
    const bindTimes = new Map();
    for (const a of accounts) {
      bindTimes.set(a.steam_id, await db.boundAtOfSteamAccount(q, a.steam_id));
    }
    const list = accounts.map((a) => ({
      steamId: a.steam_id,
      name: a.alias || a.persona_name || a.steam_id,
      personaName: a.persona_name ?? null,
      avatar: a.avatar ?? null,
      owned: Number(a.games ?? 0),
      wishlist: Number(a.wishlist ?? 0),
      lastSyncedAt:
        a.library_synced_at && a.wishlist_synced_at
          ? new Date(Math.max(new Date(a.library_synced_at).getTime(), new Date(a.wishlist_synced_at).getTime())).toISOString()
          : a.library_synced_at ?? a.wishlist_synced_at ?? null,
      boundAt: bindTimes.get(a.steam_id),
      // DQ 批（docs/PROFILE-UI-2026-11-19.md §3）：默认判定读 default_steam_id（与头像解耦）
      isDefault: me.default_steam_id != null && String(me.default_steam_id) === String(a.steam_id),
    }));
    const stats = await db.userLibraryStats(q, user.id);
    json(res, 200, { accounts: list, stats });
    return true;
  }

  // ---- DT-2（docs/ADMIN-PERMISSIONS.md）：用户级会话数据（只返回当前用户）----

  if (path === '/api/me/sessions' && req.method === 'GET') {
    if (!requireUser()) return true;
    const params = searchParamsOf(req);
    // 防御：userId 强制 = session.user.id（repository 内部 where user_id = user.id），
    // 忽略请求里任何传入的 userId/username；越权数据在此不可达。
    const list = await db.listMySessions(q, {
      userId: user.id,
      includeExpired: params.get('includeExpired') === '1',
      limit: Number(params.get('limit') ?? 20),
      offset: Number(params.get('offset') ?? 0),
    });
    // 绝不把 token 下发前端；region 只读缓存，不触发外部归属地查询（与 /api/admin/sessions 同口径）
    const token = cookieToken(req);
    json(res, 200, {
      sessions: list.rows.map((r) => ({
        id: Number(r.id),
        username: r.username,
        displayName: r.display_name ?? null,
        role: r.role,
        disabled: Boolean(r.disabled),
        ip: r.ip ?? null,
        region: r.ip ? visitors.cachedRegion(r.ip) : null,
        userAgent: r.user_agent ?? null,
        deviceId: r.device_id ?? null,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        expiresAt: r.expires_at,
        current: Boolean(token && user && Number(r.id) === Number(user.sess_id)),
      })),
      total: list.total,
    });
    return true;
  }

  const mySessRevoke = path.match(/^\/api\/me\/sessions\/(\d+)\/revoke$/);
  if (mySessRevoke && req.method === 'POST') {
    if (!requireUser()) return true;
    // DT-2：只能踢自己的会话——删除条件同时限定 sessions.id 与 user_id，
    // 非自己的会话恒 null → 404（与「踢别人」同为 404，不泄露他人会话存在性）。
    const row = await db.revokeMySession(q, { sessId: Number(mySessRevoke[1]), userId: user.id });
    if (!row) {
      json(res, 404, { error: '会话不存在或已过期' });
      return true;
    }
    logger?.info('session.revoke_self', { id: row.id, username: row.username, userId: user.id, current: cookieToken(req) === row.token });
    json(res, 200, { removed: 1 });
    return true;
  }

  return false;
}
