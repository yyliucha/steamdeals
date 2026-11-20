// CO-5/B4-2 第十六轮（docs/DESIGN-AUDIT.md B4）：admin-images 域路由模块——从 src/server.js
// 巨石抽出的第十六个域（B4 队列 #13：后台图片 /api/admin/images）。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · GET  /api/admin/images               封面图本地缓存统计（images.imageStats：游戏/图/字节数）
//   · POST /api/admin/images/reset-miss    清空进程内「缺图」负缓存（BC 批，返回 cleared 条数）
//   · GET  /api/admin/images/coverage      图片覆盖看板（EC 批：缺图集合 = header_image 空 ∪ 负缓存；
//                                          统计卡 + 分页缺图列表带原因：header_image 空/CDN 404/抓取失败）
//   · POST /api/admin/images/backfill      手动触发缺图回填（EC 批：复用同步子进程槽位 single-flight，
//                                          CLI `images backfill`，忙时 409）
//
// 单入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3）：
//   · handleAdminImagesAdmin(ctx)：requireAdmin 就绪后的管理段——本域全部 4 条路由
//     （管理段形态先例=admin-access 域 handleAdminAccessAdmin / admin-settings 域
//     handleAdminSettingsAdmin）。
//   返回值约定：true = 已处理并结束响应；false = 未命中本域，宿主继续。凡写过响应的分支
//   必须返回 true（json(...) 自身返回 undefined，直接 return json(...) 会让宿主误判未命中
//   继续跑完整条链 → 二次写头 ERR_HTTP_HEADERS_SENT）。
//
// 留在 server.js 的中间件与未拆段（不属于本域）：
//   · /img/:appid/:size 图片代理路由与 imgMissCache 负缓存的「写」留在 server.js（§15.4 判据：
//     所有公开图片请求都经过代理路由，不是本域专用）；本域只读/清空，经 ctx 按引用传入
//     （语义共享：reset-miss 清空与 coverage 读取必须与代理路由写同一份 Map，勿改成拷贝）；
//   · startSteamJob 宿主闭包（同步子进程槽位 single-flight）经 ctx 按引用传入（语义共享：
//     与 admin-sync 域任务启停共用同一子进程槽位）；startSteamJobImpl（EC 批测试注入替身）
//     同样经 ctx 传入，本域保持 `startSteamJobImpl ?? startSteamJob` 优先级；
//   · images.js 模块是共享业务模块（/img/ 代理路由与 cli/ops.js 的 images 命令也走），
//     保持独立文件不动，本域经 import 引用 imageStats；
//   · /api/admin/games*（B4 #15）、/api/admin/users*|bulk*（B4 #11）、
//     /api/admin/watchlist*|wishlists（B4 #16）等其它 admin 域路由留 server.js。
import * as db from '../store/pg.js';
import * as images from '../images.js';

/**
 * 管理段：server.js 在 requireAdmin 就绪之后调用——后台图片全部路由。
 * 每条分支自己 requireAdmin()（401/403 文案由宿主守卫统一输出，契约不变）。
 * ctx 域特有字段（§15.2，按引用传入、语义共享，勿改成拷贝）：
 *   · ctx.imgMissCache       宿主负缓存 Map——reset-miss 清空/coverage 读取与 /img/ 代理写同一份；
 *   · ctx.startSteamJob      宿主闭包——backfill 复用同步子进程槽位（与 admin-sync 域共用）；
 *   · ctx.startSteamJobImpl  EC 批测试注入替身（默认宿主闭包 startSteamJob）。
 */
export async function handleAdminImagesAdmin(ctx) {
  const { path, req, res, url, q, logger, json, user, requireAdmin, imgMissCache, startSteamJob, startSteamJobImpl } = ctx;

  // ---- 管理员：封面图本地缓存统计 ----
  if (path === '/api/admin/images' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    json(res, 200, { images: images.imageStats() });
    return true;
  }

  // BC 批（docs/IMAGE-COVERAGE.md §3.3）：清空进程内「缺图」负缓存——补了 header_image 后不必等 24h
  if (path === '/api/admin/images/reset-miss' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const cleared = imgMissCache.size;
    imgMissCache.clear();
    logger?.info('steam.img_miss_cleared', { cleared });
    json(res, 200, { cleared });
    return true;
  }

  // EC 批（docs/IMAGE-COVERAGE.md §8 EC-1）：图片覆盖看板——
  // 缺图集合 = header_image 为 null 的游戏 ∪ 负缓存（header 尺寸）里有记录的游戏；
  // 列表原因三种：header_image 空 / CDN 404（负缓存 notfound）/ 抓取失败（负缓存 error）。
  if (path === '/api/admin/images/coverage' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const page = Math.max(Number(url.searchParams.get('page') ?? 1) || 1, 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') ?? 50) || 50, 1), 200);
    const rows = await db.imageCoverageRows(q);
    const byAppid = new Map(rows.map((r) => [r.steamAppid, r]));
    const totalGames = rows.length;
    const withHeader = rows.filter((r) => r.headerImage).length;
    const noHeader = totalGames - withHeader;
    // 负缓存 key 形如 `<appid>/header`；只看 header 尺寸，且库里有该游戏才算看板缺图
    const missByAppid = new Map();
    for (const [key, miss] of imgMissCache) {
      if (!key.endsWith('/header')) continue;
      const appid = Number(key.slice(0, -'/header'.length));
      if (!Number.isFinite(appid) || !byAppid.has(appid)) continue;
      missByAppid.set(appid, miss);
    }
    let cdn404 = 0;
    let fetchFailed = 0;
    for (const [appid, miss] of missByAppid) {
      if (!byAppid.get(appid)?.headerImage) continue; // header_image 空优先级更高，计入 noHeader
      if (miss?.kind === 'notfound') cdn404 += 1;
      else fetchFailed += 1;
    }
    const missing = noHeader + cdn404 + fetchFailed;
    const cache = images.imageStats();
    const missAppids = [...missByAppid.keys()];
    const missingList = await db.imageCoverageMissingRows(q, {
      missAppids: missAppids.map(String),
      pageSize,
      offset: (page - 1) * pageSize,
    });
    const items = missingList.map((r) => ({
      id: Number(r.id),
      steam_appid: Number(r.steam_appid),
      name: r.name,
      reason: !r.header_image ? 'header_image 空' : missByAppid.get(Number(r.steam_appid))?.kind === 'notfound' ? 'CDN 404' : '抓取失败',
    }));
    json(res, 200, {
      stats: {
        totalGames,
        withHeaderImage: withHeader,
        cachedGames: cache.games,
        cachedImages: cache.images,
        cachedBytes: cache.bytes,
        missing,
        missingByReason: { noHeader, cdn404, fetchFailed },
      },
      list: { items, page, pageSize, total: missing },
    });
    return true;
  }

  // EC 批（docs/IMAGE-COVERAGE.md §8 EC-2）：手动触发缺图回填——复用同步子进程槽位（single-flight），
  // 已有任务在跑时 409；子进程跑 CLI `images backfill`，限速防 429。
  if (path === '/api/admin/images/backfill' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500);
    try {
      const job = await (startSteamJobImpl ?? startSteamJob)({
        mode: 'images-backfill',
        args: ['src/cli.js', 'images', 'backfill', '--limit', String(limit)],
        by: user.username,
      });
      json(res, 202, { started: true, runId: job.runId, mode: 'images-backfill' });
      return true;
    } catch (err) {
      if (err?.code === 'BUSY') {
        json(res, 409, { error: '已有任务在运行（同步/回填），请等它结束' });
        return true;
      }
      throw err;
    }
  }

  return false;
}
