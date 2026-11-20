// CO-5/B4-2 第十一轮（docs/DESIGN-AUDIT.md B4）：admin-sessions 域路由模块——从 src/server.js
// 巨石抽出的第十一个域（B4 队列 #14：后台会话列表 / 单条踢下线）。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · GET    /api/admin/sessions     会话列表（user/ip 过滤 + includeExpired + 分页 + total；
//                                     绝不把 token 下发前端；region 走只读缓存）
//   · DELETE /api/admin/sessions/:id 按对外 id 踢单条会话（404 = 会话不存在或已过期）
//
// 单入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3）：
//   · handleAdminSessionsAdmin(ctx)：requireAdmin 就绪后的管理段——本域全部 2 条路由
//     （管理段形态先例=admin-access 域 handleAdminAccessAdmin / admin-sync 域
//     handleAdminSyncAdmin / admin-settings 域 handleAdminSettingsAdmin）。
//   返回值约定：true = 已处理并结束响应；false = 未命中本域，宿主继续。凡写过响应的分支
//   必须返回 true（json(...) 自身返回 undefined，直接 return json(...) 会让宿主误判未命中
//   继续跑完整条链 → 二次写头 ERR_HTTP_HEADERS_SENT）。
//
// 留在 server.js 的未拆段（不属于本域）：
//   · DELETE /api/admin/users/:name/sessions（kickAll，按用户踢全部）——path 属
//     /api/admin/users/* 区（B4 #11 admin 用户批量），且与 revoke-others 共用
//     deleteSessionsOfUser 口径，留宿主；
//   · POST /api/user/sessions/revoke-others——前台主段（requireUser，非 admin 域），留宿主；
//   · /api/admin/bulk 派发表的 sessions/kick 条目（bulkSessionKick，B4 #11）留宿主；
//   · 跨域共用 SQL（deleteSessionById / deleteSessionsOfUser / touchSession 等）留 pg.js
//     （见 admin-sessions-repository.js 头部归属判定）。
//
// 本域无跨模块共享状态（无域内限流桶/持有对象），ctx 只需基座字段 + token
// （current 判定：标记当前管理员自己的会话行）。
import * as db from '../store/pg.js';
import * as visitors from '../visitors.js';

/**
 * 管理段：server.js 在 requireAdmin 就绪之后调用——后台会话列表与踢下线。
 * 每条分支自己 requireAdmin()（401/403 文案由宿主守卫统一输出，契约不变）。
 * ctx.token 是会话 cookie 值（认证上下文已解析），用于列表 current 标记与踢下线审计。
 */
export async function handleAdminSessionsAdmin(ctx) {
  const { path, req, res, url, q, logger, json, user, requireAdmin, token } = ctx;

  // ---- BK 批（docs/SESSION-MANAGEMENT.md §3.3）：会话列表 ----
  if (path === '/api/admin/sessions' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const list = await db.listSessions(q, {
      user: String(url.searchParams.get('user') ?? '').trim(),
      ip: String(url.searchParams.get('ip') ?? '').trim(),
      includeExpired: url.searchParams.get('includeExpired') === '1',
      limit: Number(url.searchParams.get('limit') ?? 20),
      offset: Number(url.searchParams.get('offset') ?? 0),
    });
    // 绝不把 token 下发前端；region 只读缓存，不触发外部归属地查询
    json(res, 200, {
      sessions: list.rows.map((r) => ({
        id: Number(r.id),
        username: r.username,
        // EJ（docs/DISPLAY-NAME-RULE.md）：「用户」列按「昵称 → 用户名」显示；
        // username 保留（踢下线/筛选等按账号标识走，登录仍用 username）。
        // SQL 已把空白昵称归一为 null（nullif(btrim(...), '')），前端 `displayName || username` 回退用户名。
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

  // ---- BK 批（docs/SESSION-MANAGEMENT.md §3.3）：按对外 id 踢单条会话 ----
  const sessKick = path.match(/^\/api\/admin\/sessions\/(\d+)$/);
  if (sessKick && req.method === 'DELETE') {
    if (!requireAdmin()) return true;
    const row = await db.deleteSessionById(q, Number(sessKick[1]));
    if (!row) {
      json(res, 404, { error: '会话不存在或已过期' });
      return true;
    }
    logger?.info('session.kicked', { id: row.id, username: row.username, by: user.username, current: token === row.token });
    json(res, 200, { removed: 1 });
    return true;
  }

  return false;
}
