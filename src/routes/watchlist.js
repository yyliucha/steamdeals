// CO-5/B4-2 第四轮（docs/DESIGN-AUDIT.md B4）：watchlist/wishlist 域路由模块——从 src/server.js
// 巨石抽出的第四个域（用户视角；管理段 /api/admin/watchlist*、/api/admin/wishlists 属 B4 队列
// #16 后续轮次，留在 server.js）。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · GET    /api/watchlist            登录用户到价提醒列表（CL 批 docs/USER-ALERTS.md §3.1）
//   · POST   /api/watchlist            添加/更新提醒（gameId 或 appid 二选一；每用户 30 次/分）
//   · DELETE /api/watchlist/:gameId    删除提醒（幂等 removed 0/1；每用户 30 次/分）
//   · POST   /api/wishlist             手动愿望单（BE 批 docs/WISHLIST-SITE-ONLY.md §4.1，只写本站 + 建史低提醒）
//   · DELETE /api/wishlist/:appid      按 Steam appid 移出愿望单（不删本站行则 404）
//   · DELETE /api/wishlist/id/:gameId  按本站 gameId 移出愿望单
//
// 单一入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3）：
//   · handleWatchlistRoutes(ctx)：认证上下文（user/requireUser）就绪之后的主段——本域全部
//     路由都 requireUser，无预检段/公开段需求；移动调用位置 = 改契约（401/429 语义依赖该位置）。
//
// 返回值约定：true = 已处理并结束响应；false = 未命中本域，宿主继续。凡写过响应的分支
// 必须返回 true（json(...) 自身返回 undefined，直接 return json(...) 会让宿主误判未命中
// 继续跑完整条链 → 二次写头 ERR_HTTP_HEADERS_SENT，拆分回归实测踩过）。
//
// 留在 server.js 的中间件与未拆段（不属于本域）：
//   · /api/steam/accounts/:id/(library|wishlist|claim)(/sync)（steam accounts 域，B4 #7）；
//   · /api/admin/watchlist*、/api/admin/wishlists（管理段，B4 #16）；
//   · 游戏详情 watch 字段（getUserWatch）与搜索 wishlist 筛选（games 域，B4 #21）。
//
// 域内共享状态：watchUserFails 计数 Map 只被本域用户段写操作使用，随域移入（与认证域
// passwordCheckHits 同先例）；模块级 = 进程级——跨请求共享同一 Map（语义共享：进程级计数、
// 重启清零，与拆分前 server.js 模块级 Map 同语义，勿改成请求级或"传值拷贝"）。
import * as db from '../store/pg.js';
import * as steamAccountsMod from '../steam-accounts.js';

// CL 批（docs/USER-ALERTS.md §8）：用户级到价提醒写操作每用户 30 次/分
const watchUserFails = new Map(); // userId -> { count, windowStart }
const watchUserLimited = (userId) => {
  const now = Date.now();
  const entry = watchUserFails.get(userId) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart >= 60_000) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  watchUserFails.set(userId, entry);
  return entry.count > 30;
};

/**
 * 主段：server.js 在认证上下文（user/requireUser）就绪后、requireAdmin 管理段之前调用。
 * ctx 字段契约见 docs/ARCHITECTURE.md「路由上下文注入」。
 * 返回 true = 已处理并结束响应；false = 未命中本域，宿主继续后续路由链。
 */
export async function handleWatchlistRoutes(ctx) {
  const { path, req, res, q, logger, json, readBody, user, requireUser } = ctx;

  // ---- CL 批（docs/USER-ALERTS.md §3.1）：用户级到价提醒（登录必需；POST/DELETE 每用户 30 次/分）----
  if (path === '/api/watchlist' && req.method === 'GET') {
    if (!requireUser()) return true;
    json(res, 200, { watches: await db.listUserWatches(q, { userId: user.id, region: 'cn' }) });
    return true;
  }

  if (path === '/api/watchlist' && req.method === 'POST') {
    if (!requireUser()) return true;
    if (watchUserLimited(user.id)) {
      json(res, 429, { error: '请求过于频繁', retryAfterSec: 60 });
      return true;
    }
    const body = await readBody(req);
    let gameId = Number(body.gameId);
    if (!Number.isFinite(gameId) || gameId <= 0) {
      const appid = Number(body.appid);
      const found = Number.isFinite(appid) && appid > 0 ? await db.gameDetail(q, { steamAppid: appid }) : null;
      if (!found) {
        json(res, 404, { error: '没有该游戏' });
        return true;
      }
      gameId = found.id;
    } else {
      const found = await db.gameDetail(q, { gameId });
      if (!found) {
        json(res, 404, { error: '没有该游戏' });
        return true;
      }
    }
    let targetCents = null;
    if (body.targetCents != null && body.targetCents !== '') {
      const n = Math.round(Number(body.targetCents));
      if (!Number.isFinite(n) || n < 0) {
        json(res, 400, { error: '目标价不合法' });
        return true;
      }
      targetCents = n;
    }
    const note = String(body.note ?? '').trim().slice(0, 200) || null;
    const id = await db.upsertUserWatch(q, { userId: user.id, gameId, region: 'cn', targetCents, note });
    logger?.info('api.watch_user_saved', { userId: user.id, gameId, targetCents });
    json(res, 200, { ok: true, id });
    return true;
  }

  const userWatchDel = path.match(/^\/api\/watchlist\/(\d+)$/);
  if (userWatchDel && req.method === 'DELETE') {
    if (!requireUser()) return true;
    if (watchUserLimited(user.id)) {
      json(res, 429, { error: '请求过于频繁', retryAfterSec: 60 });
      return true;
    }
    const removed = await db.deleteUserWatch(q, { userId: user.id, gameId: Number(userWatchDel[1]), region: 'cn' });
    logger?.info('api.watch_user_deleted', { userId: user.id, gameId: Number(userWatchDel[1]), removed });
    json(res, 200, { ok: true, removed });
    return true;
  }

  // ---- 手动愿望单（BE 批 docs/WISHLIST-SITE-ONLY.md §4.1）：只写本站 + 建史低提醒，不再推 Steam ----
  if (path === '/api/wishlist' && req.method === 'POST') {
    if (!requireUser()) return true;
    const body = await readBody(req);
    const game = await db.gameDetail(q, { steamAppid: Number(body.appid) || null, gameId: Number(body.gameId) || null, userId: user.id });
    if (!game) {
      json(res, 404, { error: '没有该游戏' });
      return true;
    }
    // 旧前端可能仍带 steamIds：忽略（不报错、不推送、不写 steam_wishlist）
    await steamAccountsMod.addUserWishlist(q, { userId: user.id, gameId: game.id });
    logger?.info('wishlist.added', { userId: user.id, gameId: game.id, appid: game.steam_appid ?? null });
    // added/alreadyIn/failed 只为兼容旧前端（现在永远是空数组）
    json(res, 200, { ok: true, appid: game.steam_appid ?? null, added: [], alreadyIn: [], failed: [], site: true });
    return true;
  }

  const wishDel = path.match(/^\/api\/wishlist\/(\d+)$/);
  const wishDelById = path.match(/^\/api\/wishlist\/id\/(\d+)$/);
  if ((wishDel || wishDelById) && req.method === 'DELETE') {
    if (!requireUser()) return true;
    const game = wishDel
      ? await db.gameDetail(q, { steamAppid: Number(wishDel[1]) })
      : await db.gameDetail(q, { gameId: Number(wishDelById[1]) });
    if (!game) {
      json(res, 404, { error: '没有该游戏' });
      return true;
    }
    const removed = await steamAccountsMod.removeUserWishlist(q, { userId: user.id, gameId: game.id });
    logger?.info('wishlist.removed', { userId: user.id, gameId: game.id, siteRemoved: removed.removed });
    json(res, 200, { ok: true, siteRemoved: removed.removed, watchesCleaned: removed.watchesCleaned, removedFromSteam: [], failed: [] });
    return true;
  }

  return false;
}
