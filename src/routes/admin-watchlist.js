// CO-5/B4-2 第十七轮（docs/DESIGN-AUDIT.md B4）：admin-watchlist 域（B4 #16：后台提醒愿望单
// /api/admin/watchlist*、/api/admin/wishlists）路由已从 server.js 抽到本文件。管理段单入口
// handleAdminWatchlistAdmin(ctx)：调用位置不能动，必须在 requireAdmin 就绪之后的管理段——
// 取本域最早路由 /api/admin/wishlists 的原位置（handleWatchlistRoutes 之后、admin games/stats
// 之前）；401/403 语义依赖该位置（原位置语义，移动 = 改契约）。
//
// 域内 8 组路由 path+method 互不重叠、与相邻其它域路由（/api/admin/games*、admin-settings、
// admin-reports、admin-sync、admin-access 等）无同 path 双匹配，集中在管理段一处不改变匹配
// 语义；模块内保持原相对顺序。边界判定：只拆 admin 视角——公开区 /api/watchlist、/api/wishlist
// 已随 B4 #4 拆在 src/routes/watchlist.js（DT-2 403e6f2 改过，本轮零触碰）；/api/admin/games*、
// stats、merge、links（B4 #15）、users/bulk（B4 #11）留 server.js。
//
// 域内模块级状态：alertPushBuckets 频控桶 / alertPushLimited / ALERT_PUSH_WINDOW_MS /
// resetAlertPushBuckets 只被本域手动推送使用，随域移入模块级（原 server.js 模块级 Map——
// 进程级共享语义不变）；server.js 顶部 re-export 保持旧导入签名（alert-push.test.js 照旧
// import { resetAlertPushBuckets } from server.js）。buildPushHits/renderDigest/toPayload
// （alerts.js）、notify、steamAccountsMod.listWishlists 是独立模块，模块内 import。
//
// 本文件只做 HTTP 输入输出编排，不写 SQL 字面量（全部走 repository / pg.js 通用 SQL）。
import * as db from '../store/pg.js';
import * as notify from '../notify.js';
import { buildPushHits, renderDigest, toPayload } from '../alerts.js';
import * as steamAccountsMod from '../steam-accounts.js';
import { baseRegion } from '../sync-regions.js';

// DF 批（docs/ALERT-MANUAL-PUSH.md §3）：手动推送 5 分钟频控——同一条（w:<id>）/同一批（b:<ids 排序连接>）
// 重复推送 → 429 { retryAfterSec }。内存窗口、重启清零（与申诉限流同款设计，防误触/刷屏）。
const alertPushBuckets = new Map(); // key -> number[]（首次推送时间戳）
export const ALERT_PUSH_WINDOW_MS = 5 * 60_000;
/** 未超限返回 null；超限返回首次推送的时间戳（调用方据此算 retryAfterSec）。 */
export function alertPushLimited(key) {
  if (alertPushBuckets.size > 5000) alertPushBuckets.clear();
  const now = Date.now();
  const list = (alertPushBuckets.get(key) ?? []).filter((t) => now - t < ALERT_PUSH_WINDOW_MS);
  if (list.length) {
    alertPushBuckets.set(key, list);
    return list[0];
  }
  list.push(now);
  alertPushBuckets.set(key, list);
  return null;
}

/** 测试用：清空手动推送频控桶。 */
export function resetAlertPushBuckets() {
  alertPushBuckets.clear();
}

/**
 * admin-watchlist 域管理段入口：命中返回 true（已处理并结束响应），未命中返回 false（宿主继续）。
 */
export async function handleAdminWatchlistAdmin(ctx) {
  const { path, req, res, url, q, logger, json, readBody, user, requireAdmin, ip } = ctx;

  // ---- 管理员：愿望单清单（BE 批 §4.2；CY 批改为只读——用户私有数据，写方法已移除）----
  if (path === '/api/admin/wishlists' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200) || 200, 1), 500);
    const keyword = String(url.searchParams.get('q') ?? '').trim();
    const filterUserId = url.searchParams.get('userId') ? Number(url.searchParams.get('userId')) : null;
    return (json(res, 200, await steamAccountsMod.listWishlists(q, { limit, keyword, userId: filterUserId })), true);
  }
  // CY 批：/api/admin/wishlists/:id 的 DELETE 已移除——愿望单属用户私有数据，管理员只读（越权写走 404/白名单拦截）

  // ---- 管理员：到价提醒（CL 批 docs/USER-ALERTS.md §3.2：全站清单只读+清理；旧加/删兼容保留）----
  if (path === '/api/admin/watchlist' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    // EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：默认 region 读本位币区域
    const region = String(url.searchParams.get('region') ?? baseRegion());
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') ?? 20) || 20, 1), 200);
    const username = String(url.searchParams.get('username') ?? '').trim() || null;
    // CU-1（docs/USER-ALERTS-GOVERNANCE.md §2）：status=no_price 只出「无报价」行
    const status = String(url.searchParams.get('status') ?? '');
    const result = await db.listAllWatchesAdmin(q, { region, page, pageSize, username, noPriceOnly: status === 'no_price' });
    // 契约：hasPrice / claimableUsers 用驼峰（规格 §3）；其余字段沿用既有蛇形命名，前端消费不动
    const items = result.items.map(({ has_price: hasPrice, claimable_users: claimableUsers, ...rest }) => ({
      ...rest,
      hasPrice: hasPrice === true,
      claimableUsers: Array.isArray(claimableUsers) ? claimableUsers : [],
    }));
    // DF 批（docs/ALERT-MANUAL-PUSH.md §2 #5）：带已配置的推送渠道名，前端据此禁用「推送」按钮（无通道不可推）
    const notifyChannels = notify.channelsFromEnv().map((c) => c.name);
    return (json(res, 200, { ...result, items, region, notifyChannels }), true);
  }

  if (path === '/api/admin/watchlist' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    let gameId = Number(body.gameId);
    if (!Number.isFinite(gameId) || gameId <= 0) {
      const appid = Number(body.appid);
      const found = Number.isFinite(appid) && appid > 0 ? await db.gameDetail(q, { steamAppid: appid }) : null;
      if (!found) return (json(res, 400, { error: '需要有效的 gameId 或 appid' }), true);
      gameId = found.id;
    }
    let targetCents = null;
    if (body.targetCents != null && body.targetCents !== '') {
      const n = Math.round(Number(body.targetCents));
      if (!Number.isFinite(n) || n < 0) return (json(res, 400, { error: '目标价不合法' }), true);
      targetCents = n;
    }
    const id = await db.upsertWatch(q, {
      gameId,
      region: 'cn',
      targetCents,
      note: String(body.note ?? '').trim().slice(0, 200) || null,
    });
    logger?.info('api.watch_saved', { gameId, targetCents, by: user.username });
    return (json(res, 200, { id }), true);
  }

  // ---- DF 批（docs/ALERT-MANUAL-PUSH.md §3）：手动推送（单条 / 批量合并一封）----
  // 复用 alerts（buildPushHits/renderDigest/toPayload）+ notify.deliver；仅站点级（用户级 403 只读）；
  // mark 默认勾选；5 分钟频控；审计 admin.alert_pushed。返回 { status, payload } 由路由直接 json。
  const adminPushWatches = async ({ ids, force, mark }) => {
    const channels = notify.channelsFromEnv();
    if (!channels.length) {
      return { status: 400, payload: { error: '未配置任何通知通道，请先在系统设置配置（邮件 / Webhook / 企业微信）' } };
    }

    // 频控：先查每个 watch 的独立桶（"同一 watch"），批量再查整批桶（"同一批"）
    const limitedWatch = ids.map((id) => ({ id, first: alertPushLimited(`w:${id}`) })).find((x) => x.first != null);
    const batchFirst = ids.length > 1 ? alertPushLimited(`b:${[...ids].sort((a, b) => a - b).join(',')}`) : null;
    const limitedFirst = limitedWatch?.first ?? batchFirst;
    if (limitedFirst != null) {
      const retryAfterSec = Math.max(1, Math.ceil((limitedFirst + ALERT_PUSH_WINDOW_MS - Date.now()) / 1000));
      await db.writeAuditLog(q, {
        actorId: user.id,
        actor: user.username,
        action: 'admin.alert_pushed',
        target: `watchlist:${ids.join(',')}`,
        detail: { ids, force, mark, outcome: 'rate_limited', retryAfterSec },
        ip,
      });
      return { status: 429, payload: { error: '5 分钟内已推送过该提醒，请稍后再试', retryAfterSec } };
    }

    const candidates = await db.watchCandidates(q);
    const wanted = new Set(ids);
    const rows = candidates.filter((r) => wanted.has(Number(r.watch_id)));
    // 用户级提醒不可推（仅站点级；与 DELETE 只读语义一致 → 403 + 审计）
    const userRow = rows.find((r) => r.user_id != null);
    if (userRow != null) {
      logger?.warn('admin.forbidden_write', { target: `watchlist:${Number(userRow.watch_id)}`, userId: Number(userRow.user_id), by: user.username, ip });
      await db.writeAuditLog(q, {
        actorId: user.id,
        actor: user.username,
        action: 'admin.forbidden_write',
        target: `watchlist:${Number(userRow.watch_id)}`,
        detail: { userId: Number(userRow.user_id), method: 'POST', path: 'push' },
        ip,
      });
      return { status: 403, payload: { error: '用户提醒不可推送，仅站点级支持' } };
    }
    if (!rows.length) return { status: 404, payload: { error: '提醒不存在或非站点级' } };

    const now = new Date();
    const { hits, skipped } = buildPushHits(rows, { force, now });
    const perRow = [
      ...hits.map((h) => ({ id: h.watchId, name: h.name, sent: true, reason: h.reason })),
      ...skipped.map((s) => ({
        id: s.watchId,
        name: s.name,
        sent: false,
        reason: s.reason,
        currentCents: s.currentCents ?? null,
        targetCents: s.targetCents ?? null,
        histLowCents: s.histLowCents ?? null,
      })),
    ];

    if (!hits.length) {
      const firstSkip = skipped[0];
      const reason = skipped.every((s) => s.reason === 'no_price') ? 'no_price' : 'not_met';
      await db.writeAuditLog(q, {
        actorId: user.id,
        actor: user.username,
        action: 'admin.alert_pushed',
        target: `watchlist:${ids.join(',')}`,
        detail: { ids, force, mark, outcome: 'not_met', perRow },
        ip,
      });
      return {
        status: 200,
        payload: {
          sent: false,
          reason,
          currentCents: firstSkip?.currentCents ?? null,
          targetCents: firstSkip?.targetCents ?? null,
          histLowCents: firstSkip?.histLowCents ?? null,
          results: perRow,
        },
      };
    }

    const { renderAlertsHtml } = await import('../alerts-html.js');
    const mail = renderAlertsHtml(hits, { now });
    const delivery = await notify.deliver(channels, {
      text: renderDigest(hits, { now }),
      html: mail.html,
      payload: toPayload(hits, { now }),
      subject: mail.subject,
      logger,
    });
    if (!delivery.ok) {
      const firstErr = delivery.results.find((r) => !r.ok);
      return { status: 502, payload: { error: `发送失败：${firstErr?.error ?? firstErr?.errcode ?? '未知原因'}` } };
    }

    if (mark) {
      for (const h of hits) await db.markNotified(q, { watchId: h.watchId, priceCents: h.currentCents });
    }
    const channelNames = delivery.results.map((r) => r.channel).join(',');
    logger?.info('api.alert_pushed', { ids: hits.map((h) => h.watchId), force, mark, channels: channelNames, by: user.username });
    await db.writeAuditLog(q, {
      actorId: user.id,
      actor: user.username,
      action: 'admin.alert_pushed',
      target: `watchlist:${ids.join(',')}`,
      detail: { ids, force, mark, outcome: 'sent', sentCount: hits.length, channels: channelNames, perRow },
      ip,
    });
    return {
      status: 200,
      payload: {
        sent: true,
        sentCount: hits.length,
        channel: channelNames,
        markApplied: mark,
        results: perRow,
      },
    };
  };

  const watchPushOne = path.match(/^\/api\/admin\/watchlist\/(\d+)\/push$/);
  if (watchPushOne && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const wid = Number(watchPushOne[1]);
    const body = await readBody(req);
    const force = body.force === true;
    const mark = body.mark !== false; // DF：更新最近提醒时间默认勾选
    const result = await adminPushWatches({ ids: [wid], force, mark });
    return (json(res, result.status, result.payload), true);
  }

  if (path === '/api/admin/watchlist/push' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) return (json(res, 400, { error: '需要选择要推送的提醒' }), true);
    const force = body.force === true;
    const mark = body.mark !== false; // 批量同单条：默认勾选
    const result = await adminPushWatches({ ids, force, mark });
    return (json(res, result.status, result.payload), true);
  }

  // CU-2（docs/USER-ALERTS-GOVERNANCE.md §2/§3）：站点级提醒批量迁移给用户（候选=Steam 愿望单反查，
  // 前端已按 claimableUsers 列出；服务端校验目标用户存在）+ 批量删除；均记审计。
  if (path === '/api/admin/watchlist/migrate' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    const userId = Number(body.userId);
    if (!ids.length) return (json(res, 400, { error: '需要选择要迁移的提醒' }), true);
    if (!Number.isInteger(userId) || userId <= 0) return (json(res, 400, { error: '需要选择目标用户' }), true);
    const targetUser = await db.adminWatchTargetUser(q, userId);
    if (!targetUser) return (json(res, 404, { error: '目标用户不存在' }), true);
    const result = await db.migrateSiteWatches(q, { ids, userId, region: 'cn' });
    if (result.migrated + result.merged === 0) return (json(res, 404, { error: '所选提醒不存在或非站点级' }), true);
    logger?.info('api.watch_migrated', { ids, toUserId: userId, toUsername: targetUser.username, by: user.username, ...result });
    await db.writeAuditLog(q, {
      actorId: user.id,
      actor: user.username,
      action: 'admin.watch_migrated',
      target: `watchlist:${ids.join(',')}`,
      detail: { ids, toUserId: userId, toUsername: targetUser.username, migrated: result.migrated, merged: result.merged },
      ip,
    });
    return (json(res, 200, { ok: true, ...result, target: { id: userId, username: targetUser.username } }), true);
  }

  if (path === '/api/admin/watchlist/delete' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (!ids.length) return (json(res, 400, { error: '需要选择要删除的提醒' }), true);
    const removed = await db.deleteSiteWatches(q, { ids, region: 'cn' });
    if (!removed.length) return (json(res, 404, { error: '所选提醒不存在或为用户级（只读）' }), true);
    for (const row of removed) {
      logger?.info('api.watch_deleted', { watchId: Number(row.id), userId: null, gameId: Number(row.game_id), by: user.username });
    }
    await db.writeAuditLog(q, {
      actorId: user.id,
      actor: user.username,
      action: 'admin.watch_deleted',
      target: `watchlist:${removed.map((x) => x.id).join(',')}`,
      detail: { ids: removed.map((x) => Number(x.id)), gameIds: removed.map((x) => Number(x.game_id)), requested: ids },
      ip,
    });
    return (json(res, 200, { ok: true, removed: removed.length }), true);
  }

  // CL 批：按提醒 id 清理任意一条（含用户级），记审计 api.watch_deleted
  // CY 批（docs/DATA-ISOLATION.md §3）：用户私有提醒管理员只读——用户行写 → 403 + 审计，
  // 站点级行（user_id IS NULL）保留清理能力。
  const watchDel = path.match(/^\/api\/admin\/watchlist\/(\d+)$/);
  if (watchDel && req.method === 'DELETE') {
    if (!requireAdmin()) return true;
    const wid = Number(watchDel[1]);
    const row = await db.watchRowById(q, wid);
    if (!row) return (json(res, 404, { error: '提醒不存在' }), true);
    if (row.user_id != null) {
      logger?.warn('admin.forbidden_write', { target: `watchlist:${wid}`, userId: Number(row.user_id), by: user.username, ip });
      await db.writeAuditLog(q, {
        actorId: user.id,
        actor: user.username,
        action: 'admin.forbidden_write',
        target: `watchlist:${wid}`,
        detail: { userId: Number(row.user_id), method: 'DELETE', path },
        ip,
      });
      return (json(res, 403, { error: '用户提醒只读，请让用户自行操作' }), true);
    }
    const deleted = await db.deleteWatchById(q, { id: wid, region: 'cn' });
    if (!deleted) return (json(res, 404, { error: '提醒不存在' }), true);
    logger?.info('api.watch_deleted', { watchId: wid, userId: null, gameId: Number(deleted.game_id), by: user.username });
    return (json(res, 200, { ok: true, removed: 1 }), true);
  }

  return false;
}
