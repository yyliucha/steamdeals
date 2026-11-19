// CO-5/B4-2 第五轮（docs/DESIGN-AUDIT.md B4）：announcements 域路由模块——从 src/server.js
// 巨石抽出的第五个域（公开列表 + 登录已读 + 管理 CRUD）。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · GET    /api/announcements               公开列表：只回生效窗口内；登录用户附带服务端 readIds
//   · POST   /api/announcements/read          登录用户标记已读（幂等；只写真实存在的公告 id）
//   · GET    /api/admin/announcements         管理员列表（limit 收敛 1–200）
//   · POST   /api/admin/announcements         管理员创建（标题/内容必填；level 白名单）
//   · PATCH|PUT /api/admin/announcements/:id  管理员更新（不存在 404）
//   · DELETE /api/admin/announcements/:id     管理员删除（幂等 removed 0/1）
//
// 三入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3；本域是首个
// 「公开段 + 主段 + 管理段」三段域，公开段先例=认证域、管理段先例=申诉域）：
//   · handleAnnouncementsPublic(ctx)：拦截链之后、认证上下文解析（must_change_password 白名单）
//     之前——游客与待改密用户也要能读到公告，移动位置 = 改契约；
//   · handleAnnouncementsRoutes(ctx)：认证上下文（user/requireUser）就绪后的主段——已读写表；
//   · handleAnnouncementsAdmin(ctx)：requireAdmin 就绪后的管理段——公告 CRUD。
//   返回值约定：true = 已处理并结束响应；false = 未命中本域，宿主继续。凡写过响应的分支
//   必须返回 true（json(...) 自身返回 undefined，直接 return json(...) 会让宿主误判未命中
//   继续跑完整条链 → 二次写头 ERR_HTTP_HEADERS_SENT，拆分回归实测踩过）。
//
// 留在 server.js 的中间件与未拆段（不属于本域）：
//   · /api/site（杂项域，B4 #7）——与本域公开 GET 相邻但不同域；
//   · resolveSession 闭包（与 adminBypass / 主 user 三处共享同一请求级 promise，BK 批
//     §3.2 会话解析收敛）——留在 server.js，经 ctx 按引用传入（语义共享）；
//   · /api/admin/bulk 的 announcements/delete|activate|deactivate 批量操作条目与
//     bulkAnnouncement* 包装函数——走批量分发端点（B4 #11 admin 用户批量域），非本域路由。
//
// 域内共享状态：toIso 是纯函数（拆分前 server.js 的模块级 helper），只被本域管理段使用，
// 随域移入模块（与 watchlist 域 watchUserLimited 同先例）。
import * as db from '../store/pg.js';

const toIso = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * 公开段：server.js 在拦截链之后、认证上下文解析之前调用（原 /api/site 之后的位置）。
 * ctx.resolveSession 是宿主的请求级会话解析闭包——语义共享：与 adminBypass / 主 user
 * 共享同一 promise（同一请求最多查一次 userBySession），必须按引用传入，勿改成拷贝。
 */
export async function handleAnnouncementsPublic(ctx) {
  const { path, req, res, q, json, resolveSession } = ctx;

  if (path === '/api/announcements' && req.method === 'GET') {
    const rows = await db.listAnnouncements(q, { activeOnly: true, limit: 200 });
    // 登录用户附带服务端已读 id（跨设备跟随账号）；游客本地记录，接口只给空数组
    const sessUser = await resolveSession();
    const readIds = sessUser ? await db.listAnnouncementReads(q, sessUser.id) : [];
    json(
      res,
      200,
      {
        announcements: rows.map((r) => ({
          id: Number(r.id),
          title: r.title,
          body: r.body,
          level: r.level,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
        })),
        readIds,
      },
      { 'cache-control': 'no-store' },
    );
    return true;
  }

  return false;
}

/**
 * 主段：server.js 在认证上下文（user/requireUser）就绪后调用——公告已读写表。
 * ctx 字段契约见 docs/ARCHITECTURE.md「路由上下文注入」。
 */
export async function handleAnnouncementsRoutes(ctx) {
  const { path, req, res, q, logger, json, readBody, user, requireUser } = ctx;

  if (path === '/api/announcements/read' && req.method === 'POST') {
    if (!requireUser()) return true;
    const body = await readBody(req);
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    // 只写真实存在的公告 id（客户端可能带已删除的旧 id，FK 会拒绝）
    const valid = ids.length ? await db.filterExistingAnnouncementIds(q, ids) : [];
    if (valid.length) {
      await db.markAnnouncementsRead(q, { userId: user.id, ids: valid });
    }
    logger?.info('announcement.read', { userId: user.id, count: valid.length });
    json(res, 200, { ok: true, readIds: valid });
    return true;
  }

  return false;
}

/**
 * 管理段：server.js 在 requireAdmin 就绪之后调用——公告 CRUD。
 * 每条分支自己 requireAdmin()（401/403 文案由宿主守卫统一输出，契约不变）。
 */
export async function handleAnnouncementsAdmin(ctx) {
  const { path, req, res, url, q, logger, json, readBody, user, requireAdmin } = ctx;

  if (path === '/api/admin/announcements' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200) || 200, 1), 200);
    json(res, 200, { announcements: await db.listAnnouncements(q, { limit }) });
    return true;
  }
  if (path === '/api/admin/announcements' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const title = String(body.title ?? '').trim().slice(0, 120);
    const text = String(body.body ?? '').trim().slice(0, 4000);
    if (!title || !text) {
      json(res, 400, { error: '标题和内容不能为空' });
      return true;
    }
    const row = await db.createAnnouncement(q, {
      title,
      body: text,
      level: ['info', 'warning', 'critical'].includes(body.level) ? body.level : 'info',
      active: body.active !== false,
      startsAt: toIso(body.startsAt),
      endsAt: toIso(body.endsAt),
      createdBy: user.id,
    });
    logger?.info('announcement.created', { id: row.id, by: user.username });
    json(res, 200, { announcement: row });
    return true;
  }
  const annMatch = path.match(/^\/api\/admin\/announcements\/(\d+)$/);
  if (annMatch && (req.method === 'PATCH' || req.method === 'PUT')) {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const title = String(body.title ?? '').trim().slice(0, 120);
    const text = String(body.body ?? '').trim().slice(0, 4000);
    if (!title || !text) {
      json(res, 400, { error: '标题和内容不能为空' });
      return true;
    }
    const row = await db.updateAnnouncement(q, Number(annMatch[1]), {
      title,
      body: text,
      level: ['info', 'warning', 'critical'].includes(body.level) ? body.level : 'info',
      active: body.active !== false,
      startsAt: toIso(body.startsAt),
      endsAt: toIso(body.endsAt),
    });
    if (!row) {
      json(res, 404, { error: '公告不存在' });
      return true;
    }
    logger?.info('announcement.updated', { id: row.id, by: user.username });
    json(res, 200, { announcement: row });
    return true;
  }
  if (annMatch && req.method === 'DELETE') {
    if (!requireAdmin()) return true;
    const removed = await db.deleteAnnouncement(q, Number(annMatch[1]));
    logger?.info('announcement.deleted', { id: Number(annMatch[1]), removed, by: user.username });
    json(res, 200, { removed });
    return true;
  }

  return false;
}
