// CO-5/B4-2 第十一轮（docs/DESIGN-AUDIT.md B4）：admin-sessions 域（B4 队列 #14：后台会话
// 列表/踢下线）专属 SQL——从 src/store/pg.js 巨石抽出的第十一个域 repository。
//
// 归属判定（§15.1「域专属 SQL 进 repository，通用 SQL 留 pg.js」）：
//   · 搬入本文件：listSessions——只被本域路由使用（GET /api/admin/sessions 列表，
//     user/ip 过滤 + includeExpired + 分页 + total 计数），签名与拆分前完全一致；
//   · 留在 pg.js：其余 sessions 函数跨模块共用——
//     deleteSessionById（#11 /api/admin/bulk 批量踢会话 bulkSessionKick 也走它）、
//     deleteSessionsOfUser（auth-routes 登出 / routes/auth.js 改密 / server.js
//     kickAll、revoke-others、用户禁用踢会话共用）、deleteSessionsOfUsers（#11 bulk）、
//     touchSession / deleteSessionByToken（请求链中间件：空闲超时与绑定校验）——一律不搬；
//   · sessions 表 DDL 在 pg.js（migrate() 消费），本文件不搬 DDL。
//
// pg.js 顶部 import + re-export 本文件，旧 db.* 导入签名永远不变。

/**
 * 后台会话列表：默认只列未过期；按 last_seen_at desc, created_at desc；绝不返回 token。
 * user/ip 均为 ilike 模糊过滤；limit 钳制 1–200。
 */
export async function listSessions(q, { user = '', ip = '', includeExpired = false, limit = 20, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (!includeExpired) where.push('s.expires_at > now()');
  if (user) {
    params.push(`%${user}%`);
    where.push(`u.username ilike $${params.length}`);
  }
  if (ip) {
    params.push(`%${ip}%`);
    where.push(`coalesce(s.ip, '') ilike $${params.length}`);
  }
  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  params.push(Math.min(Math.max(Number(limit) || 20, 1), 200));
  const limitIdx = params.length;
  params.push(Math.max(Number(offset) || 0, 0));
  const r = await q(
    `select s.id, s.user_id, u.username, nullif(btrim(u.display_name), '') as display_name, u.role, u.disabled,
            s.ip, s.user_agent, s.device_id, s.created_at, s.last_seen_at, s.expires_at
       from sessions s join users u on u.id = s.user_id
       ${whereSql}
      order by s.last_seen_at desc nulls last, s.created_at desc
      limit $${limitIdx} offset $${limitIdx + 1}`,
    params,
  );
  const c = await q(
    `select count(*)::int as n from sessions s join users u on u.id = s.user_id ${whereSql}`,
    params.slice(0, limitIdx - 1),
  );
  return { rows: r.rows, total: c.rows[0]?.n ?? 0 };
}
