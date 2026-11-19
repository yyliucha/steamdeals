// CO-5/B4-2 第五轮（docs/DESIGN-AUDIT.md B4）：announcements 域 repository——站点公告的
// 专属 SQL：公告 CRUD 四函数从 src/store/pg.js 巨石搬家（函数签名与拆分前完全一致），
// 已读三函数从 server.js 域内联 SQL 抽成 repository 新函数（此前路由体直接写 SQL 字面量）。
//
// 归属判定（判据：只有本域路由用 → 抽走；跨域/其它域也用 → 留 pg.js）：
//   · listAnnouncements / createAnnouncement / updateAnnouncement / deleteAnnouncement
//     只被本域公开段（GET /api/announcements）与管理段（/api/admin/announcements*）使用 → 搬家；
//   · announcements / announcement_reads 表 DDL 留在 pg.js——announcements 表被 B4 #11
//     后台批量操作（bulkDeleteAnnouncements / bulkSetAnnouncementsActive，仍在 pg.js）也读写，
//     属跨域共用表；announcement_reads 与之 FK 耦合、同块定义（watchlist/auth 先例：无 DDL 搬家）；
//   · bulkDeleteAnnouncements / bulkSetAnnouncementsActive 留在 pg.js——只被 /api/admin/bulk
//     分发（B4 #11 admin 用户批量域）使用，非本域 /api/announcements* 路由。
//
// 拆分约定（见 docs/ARCHITECTURE.md「域路由拆分模式」）：
//   · 域 SQL 落 src/store/<domain>-repository.js；
//   · pg.js 以 `export { … } from './announcements-repository.js'` re-export——routes/
//     announcements.js、server.js 其它段与现有测试一律照旧走 pg.js 聚合壳（db.* 签名不变）。

/** 公告列表：activeOnly=true 只回生效窗口内（公开段）；管理段看全部。limit 收敛 1–200。 */
export async function listAnnouncements(q, { activeOnly = false, limit = 50 } = {}) {
  const where = activeOnly
    ? `where active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())`
    : '';
  const r = await q(
    `select id, title, body, level, active, starts_at, ends_at, created_at, updated_at
       from announcements ${where} order by id desc limit $1`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return r.rows;
}

export async function createAnnouncement(q, { title, body, level = 'info', active = true, startsAt = null, endsAt = null, createdBy = null }) {
  const r = await q(
    `insert into announcements (title, body, level, active, starts_at, ends_at, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, title, body, level, active, starts_at, ends_at, created_at, updated_at`,
    [title, body, level, Boolean(active), startsAt, endsAt, createdBy],
  );
  return r.rows[0];
}

export async function updateAnnouncement(q, id, { title, body, level, active, startsAt = null, endsAt = null }) {
  const r = await q(
    `update announcements
        set title = $2, body = $3, level = $4, active = $5, starts_at = $6, ends_at = $7, updated_at = now()
      where id = $1
      returning id, title, body, level, active, starts_at, ends_at, created_at, updated_at`,
    [id, title, body, level, Boolean(active), startsAt, endsAt],
  );
  return r.rows[0] ?? null;
}

export async function deleteAnnouncement(q, id) {
  const r = await q('delete from announcements where id = $1', [id]);
  return r.rowCount ?? 0;
}

/** 登录用户已读公告 id 列表（bigint 收敛成 Number 数组，公开段 readIds 契约不变）。 */
export async function listAnnouncementReads(q, userId) {
  const r = await q('select announcement_id from announcement_reads where user_id = $1', [userId]);
  return r.rows.map((row) => Number(row.announcement_id));
}

/** 过滤真实存在的公告 id（客户端可能带已删除的旧 id，FK 会拒绝）。 */
export async function filterExistingAnnouncementIds(q, ids = []) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length) return [];
  const r = await q('select id from announcements where id = any($1::bigint[])', [list]);
  return r.rows.map((row) => Number(row.id));
}

/** 幂等标记已读：on conflict do nothing；只写校验过的真实公告 id。 */
export async function markAnnouncementsRead(q, { userId, ids = [] }) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length) return;
  await q(
    'insert into announcement_reads (user_id, announcement_id) select $1, x.id from unnest($2::bigint[]) as x(id) on conflict (user_id, announcement_id) do nothing',
    [userId, list],
  );
}
