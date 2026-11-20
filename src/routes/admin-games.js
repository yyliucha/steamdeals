// CO-5/B4-2 第十七轮（docs/DESIGN-AUDIT.md B4）：admin-games 域路由模块——从 src/server.js
// 巨石抽出的第十七个域（B4 队列 #15：后台游戏目录 /api/admin/games* 管理段）。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · GET  /api/admin/games/stats        游戏同步概览（六态分项/回填队列口径/内容分级计数）
//   · GET  /api/admin/games              游戏列表（分页/搜索/平台筛选（DV 批 ITAD 来源）/
//                                        同步状态/报价/回收站/内容分级；B1 并发闸 ≤1 + B2 短缓存 3s）
//   · GET  /api/admin/games/:id/links    单游戏全部平台链接（AG 批，仅 http/https）
//   · GET  /api/admin/games/deleted      回收站（逻辑删除的游戏，按删除时间倒序）
//   · POST /api/admin/games/merge        合并重复游戏（from → to，按 Steam appid 指定）
//
// 单入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3）：
//   · handleAdminGamesAdmin(ctx)：requireAdmin 就绪后的管理段——本域全部 5 条路由
//     （管理段形态先例=admin-access 域 handleAdminAccessAdmin / admin-settings 域
//     handleAdminSettingsAdmin）。
//   返回值约定：true = 已处理并结束响应；false = 未命中本域，宿主继续。凡写过响应的分支
//   必须返回 true（json(...) 自身返回 undefined，直接 return json(...) 会让宿主误判未命中
//   继续跑完整条链 → 二次写头 ERR_HTTP_HEADERS_SENT）。
//
// 留在 server.js 的中间件与未拆段（不属于本域）：
//   · runGated 宿主闭包（并发闸 Map）经 ctx 按引用传入（语义共享：'GET /api/admin/games'
//     键在 HEAVY_GATE_CONFIG 留 server.js，与 admin-align 等管理接口共用同一闸表）；
//   · adminGamesCache 短缓存对象与 invalidateAdminGamesCache 宿主闭包经 ctx 按引用传入
//     （语义共享：本域列表写缓存、merge 后失效；#21 routes/games.js 删除/屏蔽/说明写操作
//     与 server.js bulk 也走同一失效闭包）；
//   · invalidateListCache 宿主闭包（DX 批前台列表缓存）经 ctx 按引用传入（语义共享：
//     合并改变前台列表内容，与其它管理写操作共用同一份缓存失效）；
//   · /api/games/* 公开区已随 B4 #21 拆到 routes/games.js（含 /interest /owned 管理权限
//     写操作），本域不碰；
//   · /api/admin/users*|bulk*（B4 #11）、/api/admin/watchlist*|wishlists（B4 #16）
//     等其它 admin 域路由留 server.js。
import * as db from '../store/pg.js';

/**
 * 管理段：server.js 在 requireAdmin 就绪之后调用——后台游戏目录全部路由。
 * 每条分支自己 requireAdmin()（401/403 文案由宿主守卫统一输出，契约不变）。
 * ctx 域特有字段（§15.2，按引用传入、语义共享，勿改成拷贝）：
 *   · ctx.runGated                   宿主闭包——'GET /api/admin/games' 并发闸（≤1，503 文案统一）；
 *   · ctx.adminGamesCache            宿主短缓存对象——列表读写同一份（多副本各自缓存，先例同 gameCountCache）；
 *   · ctx.invalidateAdminGamesCache  宿主闭包——merge 后立即失效本域列表缓存；
 *   · ctx.invalidateListCache        宿主闭包——合并改变前台列表内容，失效 DX 批前台缓存；
 *   · ctx.adminCacheTtlMs            宿主参数——短缓存 TTL（默认 3s）。
 */
export async function handleAdminGamesAdmin(ctx) {
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
    runGated,
    adminGamesCache,
    invalidateAdminGamesCache,
    invalidateListCache,
    adminCacheTtlMs,
  } = ctx;

  // ---- 管理员：游戏同步概览（待同步数量统计）----
  if (path === '/api/admin/games/stats' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    json(res, 200, { stats: await db.adminGameStats(q) });
    return true;
  }

  // ---- 管理员：游戏列表（分页 + 搜索 + 平台筛选 + 同步状态 + 回收站）----
  if (path === '/api/admin/games' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    // B1 批（docs/DESIGN-AUDIT.md B1）：重查询接口并发闸（≤1）
    return await runGated('GET /api/admin/games', 1, async () => {
      // B2 批（docs/DESIGN-AUDIT.md B2）：短缓存命中直接返回（key = 完整 query；写操作后立即失效）
      const gamesCacheKey = 'admin/games?' + url.search;
      const gamesCacheNow = Date.now();
      if (adminGamesCache.key === gamesCacheKey && adminGamesCache.value && gamesCacheNow - adminGamesCache.at < adminCacheTtlMs) {
        json(res, 200, adminGamesCache.value);
        return true;
      }
      const kw = String(url.searchParams.get('q') ?? '').trim();
      const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
      const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') ?? 20) || 20, 5), 200);
      const offset = (page - 1) * pageSize;
      const platform = String(url.searchParams.get('platform') ?? '').trim();
      const sync = String(url.searchParams.get('sync') ?? '').trim();
      // 报价筛选：priced=有任意平台报价，none=没有任何报价（控制台指标卡点击用）
      const offersParam = String(url.searchParams.get('offers') ?? '').trim();
      const deletedParam = String(url.searchParams.get('deleted') ?? 'exclude');
      // 同步状态（docs/STEAM-SYNC-STATUS-AND-RATING.md §4）：
      //   sync=pending（旧参数，兼容）= 从未探测或 ok 但缺简介；done=ok 且有简介
      //   status=<steam_status|pending|synced|other>（新参数，指标卡点击用）
      const statusParam = String(url.searchParams.get('status') ?? '').trim();
      // 内容分级筛选（docs/STEAM-SYNC-STATUS-AND-RATING.md §13.2）：可与搜索/平台/同步状态叠加
      const ratingParam = String(url.searchParams.get('rating') ?? '').trim();
      // where 片段与平台筛选 SQL 片段（DV 批 docs/ITAD-SOURCE-FILTER.md §2 方案 A）都在
      // repository——ITAD 走 game_source_sync 来源判定，其余平台按 offers.platform_code。
      const { deletedWhere, offersWhere, syncWhere, ratingWhere } = db.adminGamesWhereParts({
        deletedParam,
        offersParam,
        sync,
        statusParam,
        ratingParam,
      });
      const { total, rows: gamesRows } = await db.listAdminGames(q, {
        kw,
        deletedWhere,
        offersWhere,
        syncWhere,
        ratingWhere,
        platform,
        pageSize,
        offset,
      });
      const adminGamesPayload = { total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), games: gamesRows };
      adminGamesCache.value = adminGamesPayload;
      adminGamesCache.key = gamesCacheKey;
      adminGamesCache.at = Date.now();
      json(res, 200, adminGamesPayload);
      return true;
    }, (msg) => json(res, 503, { error: msg }));
  }

  // ---- 管理员：单游戏全部平台链接（AG 批 docs/ADMIN-PLATFORM-LINKS.md §3-A，仅 http/https）----
  const linkMatch = path.match(/^\/api\/admin\/games\/(\d+)\/links$/);
  if (linkMatch && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const gameId = Number(linkMatch[1]);
    const g = await db.adminGameLinkRow(q, gameId);
    if (!g) {
      json(res, 404, { error: '没有该游戏' });
      return true;
    }
    json(res, 200, { game: g, links: await db.adminGameLinks(q, { gameId }) });
    return true;
  }

  // ---- 管理员：回收站（逻辑删除的游戏）----
  if (path === '/api/admin/games/deleted' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const limit = Number(url.searchParams.get('limit') ?? 200);
    json(res, 200, { games: await db.listDeletedGames(q, { limit }) });
    return true;
  }

  // ---- 管理员：合并重复游戏（把 from 并进 to，按 Steam appid 指定）----
  if (path === '/api/admin/games/merge' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const fromAppid = Number(body.fromAppid);
    const toAppid = Number(body.toAppid);
    if (!Number.isFinite(fromAppid) || !Number.isFinite(toAppid)) {
      json(res, 400, { error: '需要 fromAppid 与 toAppid' });
      return true;
    }
    if (fromAppid === toAppid) {
      json(res, 400, { error: '源和目标不能是同一个游戏' });
      return true;
    }
    const from = await db.gameDetail(q, { steamAppid: fromAppid });
    const to = await db.gameDetail(q, { steamAppid: toAppid });
    if (!from) {
      json(res, 404, { error: '源游戏不存在：' + fromAppid });
      return true;
    }
    if (!to) {
      json(res, 404, { error: '目标游戏不存在：' + toAppid });
      return true;
    }
    const result = await db.mergeGames(q, { fromGameId: from.id, toGameId: to.id, logger });
    logger?.info('api.game_merged', { fromAppid, toAppid, ...result, by: user.username });
    invalidateAdminGamesCache();
    invalidateListCache(); // DX 批：合并改变列表内容，前台缓存立即失效
    json(res, 200, { result });
    return true;
  }

  return false;
}
