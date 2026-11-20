// CO-5/B4-2 第七轮（docs/DESIGN-AUDIT.md B4）：site 域路由模块——从 src/server.js 巨石
// 抽出的第七个域（站点信息 / Steam 账号管理 / 封禁状态自查，B4 队列 #7「杂项」）。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · GET  /api/ban/state                      只读封禁自查（预检段，见下）
//   · GET  /api/site                           站点信息 + 注册就绪状态（公开段）
//   · GET  /api/steam/accounts                 本人绑定账号列表（管理员附未归属账号）
//   · GET  /api/steam/me                       兼容接口：旧单账号字段 + accounts 数组
//   · POST /api/steam/accounts/:id/claim       管理员认领未归属账号
//   · GET|POST /api/steam/accounts/:id/library      库列表（搜索/分页）/ 账号级同步（POST /sync）
//   · GET|POST /api/steam/accounts/:id/wishlist     愿望单列表 / 账号级同步（POST /sync）
//   · PATCH /api/steam/accounts/:id            改别名 / 自配 API Key（AES-256-GCM 加密落库）
//   · DELETE /api/steam/accounts/:id           解绑（级联清库/愿望单 + 默认账号收口）
//   · POST /api/steam/accounts/:id/default     设为默认 Steam 账号
//
// 三入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3；首个
// 「预检段 + 公开段 + 主段」三段域，预检段先例=App 域、公开段先例=认证域）：
//   · handleSitePreflight(ctx)：设备维度限流与封禁拦截链**之前**——被封禁者也要拿得到
//     自己的封禁状态（docs/BAN-AND-SECURITY-FIXES.md §3.3），移动位置 = 改契约；
//   · handleSitePublic(ctx)：拦截链之后、认证上下文解析（must_change_password 白名单）
//     之前——注册页/改密页在认证前也要读站点信息；
//   · handleSiteRoutes(ctx)：认证上下文（user/requireUser/requireAdmin）就绪后的主段——
//     全部 /api/steam/* 路由。
//   返回值约定：true = 已处理并结束响应；false = 未命中本域，宿主继续。凡写过响应的分支
//   必须返回 true（json(...) 自身返回 undefined，直接 return json(...) 会让宿主误判未命中
//   继续跑完整条链 → 二次写头 ERR_HTTP_HEADERS_SENT，拆分回归实测踩过）。
//
// 留在 server.js 的中间件与未拆段（不属于本域）：
//   · /api/app/* 设备维度限流、封禁/黑名单拦截链、must_change_password 白名单（含
//     p === '/api/site' 条目）——作用于整条请求链的中间件；
//   · /api/admin/wishlists（admin 段，B4 #16）、/api/admin/steam-logs（B4 #12）——
//     同用 steam-accounts/steam-log 模块但属其它域，留宿主；
//   · ensureSteamSchemaOnce 幂等建表（中间件行为：先于任何查询存在）留 server.js。
//
// 域内共享状态：banStateBuckets/banStateLimited 限流桶只被本域 /api/ban/state 使用，
// 随域移入（与 watchlist 域 watchUserFails 同先例）；模块级 = 进程级——跨请求共享同一
// Map（语义共享：进程级计数、重启清零，与拆分前 server.js 模块级 Map 同语义，勿改成
// 请求级或「传值拷贝」）。siteName / appealEmail 是宿主闭包（serveBanPage 等仍用），
// 经 ctx 按引用传入（§15.2 闭包函数先例）。
import * as db from '../store/pg.js';
import * as devices from '../devices.js';
import * as visitors from '../visitors.js';
import * as ratelimit from '../ratelimit.js';
import * as steamAccountsMod from '../steam-accounts.js';
import * as steamLogMod from '../steam-log.js';
import { VERSION } from '../settings.js';
import { MAX_ACCOUNTS_PER_USER } from './auth.js';

// /api/ban/state 的自带限流：每 IP 1 次/秒、30 次/分钟（防被当成探测接口；docs/BAN-AND-SECURITY-FIXES.md §3.3）。
const banStateBuckets = new Map(); // ip -> { last, minute: number[] }
function banStateLimited(ip) {
  const key = String(ip || 'anon');
  if (banStateBuckets.size > 10_000) banStateBuckets.clear();
  const now = Date.now();
  const bucket = banStateBuckets.get(key);
  const minute = (bucket?.minute ?? []).filter((t) => now - t < 60_000);
  if (minute.length >= 30) {
    banStateBuckets.set(key, { last: now, minute });
    return true;
  }
  if (bucket && now - bucket.last < 1000) {
    banStateBuckets.set(key, { last: bucket.last, minute });
    return true;
  }
  minute.push(now);
  banStateBuckets.set(key, { last: now, minute });
  return false;
}

/**
 * 预检段：server.js 在拦截链之前调用（/api/ban/state 原位置，handleAppPreflight 之前）。
 * 只读封禁状态接口（客户端复核用，docs/BAN-AND-SECURITY-FIXES.md §3.3）：
 * 必须在拦截链之前——被封禁者也要拿得到自己的状态。只用内存态（devices.isBanned /
 * ratelimit.bannedUntil / visitors.blockedBy），不查库、不计数；自带限流 1 次/秒、30 次/分钟；
 * 只回调用者自己的 {banned,type,until,ip,whitelisted}（BR 批 §11.4 自查三件套），
 * 不含名单内容、不含他人 IP。
 */
export async function handleSitePreflight(ctx) {
  const { path, req, res, json, ip, whitelisted, deviceId } = ctx;
  if (path !== '/api/ban/state' || req.method !== 'GET') return false;
  if (banStateLimited(ip)) {
    json(res, 429, { error: '请求过于频繁' }, { 'cache-control': 'no-store', 'retry-after': '1' });
    return true;
  }
  let state = { banned: false, ip: ip || null, whitelisted };
  if (!whitelisted) {
    const devBan = deviceId ? devices.isBanned({ deviceId }) : null;
    const ipBlocked = ip ? visitors.blockedBy(ip) : null;
    const rateUntil = ip ? ratelimit.bannedUntil(ip) : null;
    // BJ 批 A1：类型优先级 设备 → 黑名单 → 自动封禁（与拦截链一致；黑名单 IP 不再被报成 rate）
    if (devBan) state = { banned: true, type: 'device', until: devBan.until ? new Date(devBan.until).toISOString() : null, ip: ip || null, whitelisted: false };
    else if (ipBlocked) state = { banned: true, type: 'ip', until: null, ip: ip || null, whitelisted: false };
    else if (rateUntil) state = { banned: true, type: 'rate', until: new Date(rateUntil).toISOString(), ip: ip || null, whitelisted: false };
  }
  json(res, 200, state, { 'cache-control': 'no-store' });
  return true;
}

/**
 * 公开段：server.js 在拦截链之后、认证上下文解析之前调用（原 /api/site 位置，
 * handleAnnouncementsPublic 之前）。siteName / appealEmail 是宿主闭包（serveBanPage /
 * 申诉域仍用），经 ctx 按引用传入（语义共享）。
 * DX 批（docs/SEARCH-FIX-PERF.md §DX）：60s 短缓存——响应里的注册开关/SMTP 就绪状态
 * 来自 DB 查询（基线 257ms 主要耗在这两次查询），缓存由宿主提供（{ value, at } 按实例
 * 隔离）；配置变更（设置保存/SMTP 保存）或重启时宿主主动失效，TTL 兜底。
 */
export async function handleSitePublic(ctx) {
  const { path, req, res, q, json, siteName, appealEmail, siteCache = null, siteCacheTtlMs = 60_000 } = ctx;
  if (path !== '/api/site' || req.method !== 'GET') return false;
  // DX 批：命中直接复用整份响应体（契约与未命中完全一致）
  if (siteCache && siteCache.value && Date.now() - siteCache.at < siteCacheTtlMs) {
    json(res, 200, siteCache.value);
    return true;
  }
  // AL 批（docs/AUTH-REDESIGN.md §5.3）：注册页用——开关与 SMTP 就绪状态（不可用时不显示表单）
  let registrationEnabled = true;
  let registrationSmtpReady = false;
  try {
    const regRow = await db.registrationEnabledRow(q);
    registrationEnabled = regRow ? String(regRow.value) !== '0' : process.env.AUTH_REGISTRATION_ENABLED !== '0';
    const { smtpConfig, isSmtpConfigured } = await import('../email-auth.js');
    registrationSmtpReady = isSmtpConfigured(await smtpConfig(q));
  } catch {
    /* 表不存在等兜底：默认开放、SMTP 未就绪 */
  }
  const payload = {
    name: siteName(),
    version: VERSION,
    appealEmail: appealEmail(),
    // 前台成人内容展示策略（hide/badge/show），Home 卡片按它决定角标
    adultDisplay: String(process.env.SITE_ADULT_DISPLAY ?? 'hide'),
    registration: { enabled: registrationEnabled, smtpReady: registrationSmtpReady },
  };
  if (siteCache) {
    siteCache.value = payload;
    siteCache.at = Date.now();
  }
  json(res, 200, payload);
  return true;
}

// EM 批（docs/STEAM-SYNC-TIMEOUT.md EL-2）：单账号同步任务进程内状态（single-flight + 结果查询）。
// key = `${steamId}:${kind}`；进程内 Map 跨请求共享；重启后兜底读 steam_account_logs。
// 多 worker/多实例部署下同账号可能并发触发一次以上——Steam 侧 upsert 幂等，无数据损坏风险。
const syncTasks = new Map();

/** 测试用：清空同步任务状态（模块级 Map 跨测试共享）。 */
export function resetSteamSyncTasksForTest() {
  syncTasks.clear();
}

/**
 * 主段：server.js 在认证上下文（user/requireUser/requireAdmin）就绪后调用——
 * /api/steam/* 全部路由（Steam 多账号绑定 / 游戏库 / 愿望单）。
 * ctx 字段契约见 docs/ARCHITECTURE.md「路由上下文注入」。
 */
export async function handleSiteRoutes(ctx) {
  const { path, req, res, url, q, logger, json, readBody, user, requireUser, requireAdmin, invalidateListCache = null } = ctx;

  // BE 批（docs/WISHLIST-SITE-ONLY.md §4.4）：账号级同步（游戏库/愿望单）一律用该账号自己的 API Key；
  // 未配置或解密失败直接报错，**不回退**全局 STEAM_API_KEY（全局 key 只给系统级采集任务）。
  const requireAccountApiKey = async (steamId) => {
    const apiKeyEnc = await db.accountApiKeyEnc(q, steamId);
    if (apiKeyEnc == null) {
      json(res, 400, { error: '该账号未配置 API Key，请先在后台填写' });
      return null;
    }
    try {
      const auth = await import('../email-auth.js');
      const apiKey = auth.decryptSecret(apiKeyEnc, auth.loadSecretKey());
      if (!apiKey) throw new Error('decrypt_failed');
      return apiKey;
    } catch {
      json(res, 400, { error: '该账号 API Key 无效，请检查' });
      return null;
    }
  };

  // 当前登录用户对该账号的所有权检查：返回账号行（含昵称/归属用户名快照，供审计），无权/不存在返回 null（响应已写出）
  const requireAccountOwner = async (steamId) => {
    const row = await db.accountOwnerRow(q, steamId);
    if (!row) {
      json(res, 404, { error: '没有该 Steam 账号' });
      return null;
    }
    if (row.user_id == null || Number(row.user_id) !== Number(user.id)) {
      json(res, 403, { error: '这个 Steam 账号不属于当前用户' });
      return null;
    }
    return row;
  };

  // EM 批（docs/STEAM-SYNC-TIMEOUT.md EL-2）：同步状态查询——
  // 运行态读进程内 Map；lastResult 优先进程内最近完成，进程重启后兜底 steam_account_logs。
  const emSyncStatus = async (steamId) => {
    const row = await requireAccountOwner(steamId);
    if (!row) return true;
    const keys = [`${steamId}:wishlist`, `${steamId}:library`];
    const running = keys.map((k) => syncTasks.get(k)).find((t) => t?.running) ?? null;
    const lastDone =
      keys
        .map((k) => syncTasks.get(k))
        .filter((t) => t && !t.running && t.finishedAt)
        .sort((a, b) => (String(b.finishedAt) > String(a.finishedAt) ? 1 : -1))[0] ?? null;
    let lastResult = null;
    if (lastDone) {
      lastResult = {
        ok: !lastDone.error,
        kind: lastDone.kind,
        ...(lastDone.result ?? {}),
        error: lastDone.error ?? null,
        finishedAt: lastDone.finishedAt,
      };
    } else {
      // 兜底：进程重启后从 steam_account_logs 取最近一次同步结果
      const { entries } = await steamLogMod.listSteamLogs(q, { steamId, limit: 5, days: 365 });
      const last = entries.find((e) => e.action === 'sync-library' || e.action === 'sync-wishlist');
      if (last) {
        const detail = typeof last.detail === 'string' ? (() => { try { return JSON.parse(last.detail); } catch { return {}; } })() : (last.detail ?? {});
        lastResult = {
          ok: last.result === 'ok',
          kind: last.action === 'sync-library' ? 'library' : 'wishlist',
          ...detail,
          error: last.error ?? null,
          finishedAt: last.created_at,
        };
      }
    }
    json(res, 200, {
      status: running ? 'running' : 'idle',
      task: running ? { kind: running.kind, startedAt: running.startedAt } : null,
      lastResult,
    });
    return true;
  };

  if (path === '/api/steam/accounts' && req.method === 'GET') {
    if (!requireUser()) return true;
    const accounts = await steamAccountsMod.listUserAccounts(q, user.id);
    const unowned = user.role === 'admin' ? await steamAccountsMod.listUnownedAccounts(q) : [];
    json(res, 200, { accounts, unowned, limit: MAX_ACCOUNTS_PER_USER });
    return true;
  }

  if (path === '/api/steam/me' && req.method === 'GET') {
    // 兼容接口：旧单账号字段取第一个绑定账号，新前端用 accounts 数组。
    const accounts = user ? await steamAccountsMod.listUserAccounts(q, user.id) : [];
    const first = accounts[0] ?? null;
    json(res, 200, {
      steamId: first?.steam_id ?? null,
      persona_name: first?.persona_name ?? null,
      avatar: first?.avatar ?? null,
      accounts,
    });
    return true;
  }

  const accountMatch = path.match(/^\/api\/steam\/accounts\/([^/]+)$/);
  const accountAction = path.match(/^\/api\/steam\/accounts\/([^/]+)\/(library|wishlist|claim)(?:\/(sync))?$/);
  // EM 批（docs/STEAM-SYNC-TIMEOUT.md EL-2）：GET /api/steam/accounts/:id/sync-status（独立路径，不在 accountAction 内）
  const syncStatusMatch = path.match(/^\/api\/steam\/accounts\/([^/]+)\/sync-status$/);
  if (syncStatusMatch && req.method === 'GET') {
    if (!requireUser()) return true;
    return emSyncStatus(decodeURIComponent(syncStatusMatch[1]));
  }
  if (accountAction) {
    if (!requireUser()) return true;
    const steamId = decodeURIComponent(accountAction[1]);

    // 认领（迁移）：管理员把未归属账号划到自己名下
    if (accountAction[2] === 'claim' && req.method === 'POST') {
      if (!requireAdmin()) return true;
      const found = await db.claimTargetRow(q, steamId);
      if (!found) {
        json(res, 404, { error: '没有该 Steam 账号' });
        return true;
      }
      if (found.user_id != null) {
        json(res, 409, { error: '该账号已被认领' });
        return true;
      }
      await db.claimSteamAccount(q, { steamId, userId: user.id });
      // DQ 批（docs/PROFILE-UI-2026-11-19.md §3）：认领账号不再自动改动头像。
      // AT 批（docs/ADMIN-CONSOLE-IA.md §5）：认领落审计（失败吞异常，不影响认领）
      await steamLogMod.recordSteamLog(q, {
        action: 'claim',
        steamId,
        personaName: found.persona_name,
        userId: user.id,
        username: user.username,
        actor: `admin:${user.username}`,
        result: 'ok',
      });
      logger?.info('steam.claim', { steamId, userId: user.id, by: user.username });
      json(res, 200, { ok: true });
      return true;
    }
    // EM 批（docs/STEAM-SYNC-TIMEOUT.md EL-2）：库同步改「触发后台任务 + 立即返回 202」——
    // 拉 Steam + 逐条写库全部移出请求（原同步阻塞会被 15s 看门狗砍掉）；
    // 同账号 single-flight：进行中重复触发 409「进行中」。
    if (accountAction[2] === 'library' && req.method === 'POST' && accountAction[3] === 'sync') {
      const row = await requireAccountOwner(steamId);
      if (!row) return true;
      const apiKey = await requireAccountApiKey(steamId);
      if (!apiKey) return true;
      const taskKey = `${steamId}:library`;
      const existing = syncTasks.get(taskKey);
      if (existing?.running) {
        json(res, 409, { error: '该账号正在同步中，请稍候' });
        return true;
      }
      const task = { kind: 'library', running: true, startedAt: new Date().toISOString(), finishedAt: null, result: null, error: null };
      syncTasks.set(taskKey, task);
      void (async () => {
        try {
          const result = await steamAccountsMod.syncAccountLibrary(q, {
            steamId,
            apiKey,
            logger,
            log: { actor: 'self', userId: user.id, username: user.username, personaName: row.persona_name },
          });
          // 补全目录类型（类型未知数靠 app_type；只挑缺失的，天然收敛）
          const types = await steamAccountsMod.backfillOwnedAppTypes(q, { steamId, apiKey, logger });
          const stats = await steamAccountsMod.ownedTypeStats(q, steamId);
          task.result = { ...result, typeUnknown: stats.typeUnknown, typesChecked: types.checked, typesTyped: types.typed };
          invalidateListCache?.(); // DX 批：库同步后 owned 维度变化，前台列表缓存立即失效
        } catch (err) {
          task.error =
            err?.status === 401 || err?.status === 403
              ? '该账号 API Key 无效，请检查'
              : '拉取游戏库失败：' + String(err?.message ?? err).slice(0, 160);
        } finally {
          task.running = false;
          task.finishedAt = new Date().toISOString();
        }
      })();
      json(res, 202, { accepted: true, status: 'running' });
      return true;
    }
    // EM 批（docs/STEAM-SYNC-TIMEOUT.md EL-2）：愿望单同步同上——后台任务 + 202 + single-flight。
    if (accountAction[2] === 'wishlist' && req.method === 'POST' && accountAction[3] === 'sync') {
      const row = await requireAccountOwner(steamId);
      if (!row) return true;
      const apiKey = await requireAccountApiKey(steamId);
      if (!apiKey) return true;
      const taskKey = `${steamId}:wishlist`;
      const existing = syncTasks.get(taskKey);
      if (existing?.running) {
        json(res, 409, { error: '该账号正在同步中，请稍候' });
        return true;
      }
      const task = { kind: 'wishlist', running: true, startedAt: new Date().toISOString(), finishedAt: null, result: null, error: null };
      syncTasks.set(taskKey, task);
      void (async () => {
        try {
          const result = await steamAccountsMod.syncAccountWishlist(q, {
            steamId,
            apiKey,
            userId: user.id,
            logger,
            log: { actor: 'self', userId: user.id, username: user.username, personaName: row.persona_name },
          });
          task.result = result;
          invalidateListCache?.(); // DX 批：愿望单同步后 wishlist 维度变化，前台列表缓存立即失效
        } catch (err) {
          task.error =
            err?.status === 401 || err?.status === 403
              ? '该账号 API Key 无效，请检查'
              : '拉取愿望单失败：' + String(err?.message ?? err).slice(0, 160);
        } finally {
          task.running = false;
          task.finishedAt = new Date().toISOString();
        }
      })();
      json(res, 202, { accepted: true, status: 'running' });
      return true;
    }
    // CX 批（docs/USER-PROFILE-EDIT.md §3）：库列表支持搜索/分页（弹窗用）；
    // 不带参数保持旧行为（一次取到 500 条，后台「Steam 账号」页沿用 in_db/current_low 字段）。
    if (accountAction[2] === 'library' && req.method === 'GET') {
      const row = await requireAccountOwner(steamId);
      if (!row) return true;
      const hasParams = url.searchParams.has('q') || url.searchParams.has('page') || url.searchParams.has('pageSize');
      const kw = String(url.searchParams.get('q') ?? '').trim().slice(0, 80);
      const page = Number(url.searchParams.get('page') ?? 1);
      const pageSize = hasParams ? Number(url.searchParams.get('pageSize') ?? 10) : 500;
      const data = await db.userLibraryItems(q, { steamId, kind: 'library', kw, page, pageSize });
      json(res, 200, {
        steamId,
        games: data.items,
        total: data.total,
        page: data.page,
        pageSize: data.pageSize,
      });
      return true;
    }
    // CX 批：愿望单条目列表（弹窗「愿望单」tab）
    if (accountAction[2] === 'wishlist' && req.method === 'GET') {
      const row = await requireAccountOwner(steamId);
      if (!row) return true;
      const kw = String(url.searchParams.get('q') ?? '').trim().slice(0, 80);
      const page = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
      const data = await db.userLibraryItems(q, { steamId, kind: 'wishlist', kw, page, pageSize });
      json(res, 200, {
        steamId,
        items: data.items,
        total: data.total,
        page: data.page,
        pageSize: data.pageSize,
      });
      return true;
    }
    json(res, 404, { error: 'not found' });
    return true;
  }

  if (accountMatch && req.method === 'PATCH') {
    if (!requireUser()) return true;
    const steamId = decodeURIComponent(accountMatch[1]);
    const row = await requireAccountOwner(steamId);
    if (!row) return true;
    const body = await readBody(req);
    const raw = String(body.alias ?? '').trim().slice(0, 64);
    const alias = raw || null;
    await db.updateSteamAccountAlias(q, { steamId, alias });
    // 账号自配 API Key（写愿望单用）：明文只进不出，AES-256-GCM 加密落库；clearApiKey=true 清除
    let apiKeyChanged = null;
    if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
      const auth = await import('../email-auth.js');
      const enc = auth.encryptSecret(body.apiKey.trim(), auth.loadSecretKey());
      await steamAccountsMod.setAccountApiKey(q, {
        steamId,
        apiKeyEnc: enc,
        log: { actor: 'self', userId: user.id, username: user.username, personaName: row.persona_name },
      });
      apiKeyChanged = true;
    } else if (body.clearApiKey === true) {
      await steamAccountsMod.setAccountApiKey(q, {
        steamId,
        apiKeyEnc: null,
        log: { actor: 'self', userId: user.id, username: user.username, personaName: row.persona_name },
      });
      apiKeyChanged = false;
    }
    const apiKeySet = await db.steamAccountApiKeySet(q, steamId);
    logger?.info('steam.alias_set', { steamId, alias, userId: user.id, apiKeyChanged });
    json(res, 200, { ok: true, alias, apiKeySet });
    return true;
  }

  if (accountMatch && req.method === 'DELETE') {
    if (!requireUser()) return true;
    const steamId = decodeURIComponent(accountMatch[1]);
    const row = await requireAccountOwner(steamId);
    if (!row) return true;
    const result = await steamAccountsMod.unbindAccount(q, {
      steamId,
      userId: user.id,
      logger,
      log: { actor: 'self', userId: user.id, username: user.username, personaName: row.persona_name },
    });
    // DQ 批（docs/PROFILE-UI-2026-11-19.md §3）：解绑的是默认账号 → 只清 default_steam_id（头像不受影响）
    await db.clearDefaultSteamIfMatches(q, { userId: user.id, steamId });
    json(res, 200, result);
    return true;
  }

  // DQ 批（docs/PROFILE-UI-2026-11-19.md §3）：设为默认 Steam 账号——只写 default_steam_id（每用户一个默认），与头像解耦
  const accountDefaultMatch = path.match(/^\/api\/steam\/accounts\/([^/]+)\/default$/);
  if (accountDefaultMatch && req.method === 'POST') {
    if (!requireUser()) return true;
    const steamId = decodeURIComponent(accountDefaultMatch[1]);
    const row = await requireAccountOwner(steamId);
    if (!row) return true;
    const me = await db.setDefaultSteamAccount(q, { userId: user.id, steamId });
    logger?.info('steam.default_set', { steamId, userId: user.id });
    json(res, 200, { ok: true, defaultSteamId: me.default_steam_id ?? null });
    return true;
  }

  return false;
}
