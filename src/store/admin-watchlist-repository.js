// CO-5/B4-2 第十七轮（docs/DESIGN-AUDIT.md B4）：admin-watchlist 域专属 SQL。
//
// 本文件只含 B4 #16「admin 提醒愿望单」域（/api/admin/watchlist*、/api/admin/wishlists）
// 专属的数据访问函数（签名与拆分前一致）；pg.js 顶部 re-export 保持旧 db.* 导入签名不变
// （routes/admin-watchlist.js、server.js 其它段与现有测试照旧走聚合壳）。跨域共用的通用 SQL
// （upsertWatch/deleteWatch/listWatches——CLI watch add/del/list 共用、watchCandidates/
// markNotified——alerts 引擎与 CLI report 共用、getUserWatch——games 域详情回显）留 pg.js；
// 愿望单落库 SQL（addUserWishlist/removeUserWishlist/listWishlists）在 steam-accounts.js
// （公开 watchlist 域与 admin wishlists 共用，跨模块原地）。watchlist 表 DDL 在 pg.js SCHEMA
// （跨模块共用），不搬家。

import { OFFICIAL_KINDS } from './pg.js';

/** migrate 的目标用户行（id → id/username）。 */
export async function adminWatchTargetUser(q, userId) {
  const r = await q('select id, username from users where id = $1', [userId]);
  return r.rows[0] ?? null;
}

/** watchDel 的提醒行（id → id/user_id/game_id，403 判定与审计用）。 */
export async function watchRowById(q, wid) {
  const r = await q("select id, user_id, game_id from watchlist where id = $1 and region = 'cn'", [wid]);
  return r.rows[0] ?? null;
}

/** 管理员：按提醒 id 清理任意一条（含用户级），返回被删行（审计用）。 */
export async function deleteWatchById(q, { id, region = 'cn' }) {
  const r = await q('delete from watchlist where id = $1 and region = $2 returning id, user_id, game_id', [id, region]);
  return r.rows[0] ?? null;
}

/**
 * 管理员：全站提醒清单（含用户名/昵称；分页 + 可选用户名筛选 + CU-1「无报价」筛选）。
 * EJ（docs/DISPLAY-NAME-RULE.md）：多带 display_name——展示层按「昵称 → 用户名」口径，
 * 筛选仍按 username（账号标识，登录用）。
 */
export async function listAllWatchesAdmin(q, { region = 'cn', page = 1, pageSize = 20, username = null, noPriceOnly = false } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
  const pg = Math.max(1, Number(page) || 1);
  const offset = (pg - 1) * size;
  const params = [region];
  let where = "w.region = $1";
  if (username) {
    params.push(`%${String(username).trim()}%`);
    where += ` and u.username ilike $${params.length}`;
  }
  // CU-1（docs/USER-ALERTS-GOVERNANCE.md §2）：「无报价」= 该游戏无任何在售报价
  // （口径与 CL 批一致：官方+授权渠道、CN 区、在售——即 current_cents 同口径的 EXISTS 判定）。
  if (noPriceOnly) {
    where += ` and not exists (select 1 from offers o2 join platforms p2 on p2.code = o2.platform_code
                 where o2.game_id = g.id and o2.region = $1 and o2.in_stock and p2.kind in ${OFFICIAL_KINDS})`;
  }
  const total = Number(
    (await q(
      `select count(*)::int as n from watchlist w left join users u on u.id = w.user_id join games g on g.id = w.game_id where ${where}`,
      params,
    )).rows[0]?.n ?? 0,
  );
  const rows = await q(
    `select w.id, w.user_id, u.username, nullif(btrim(u.display_name), '') as display_name,
            w.game_id, w.target_cents, w.note, w.source, w.created_at,
            w.last_notified_cents, w.last_notified_at,
            g.steam_appid, coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name,
            (select min(o.price_cents) from offers o
               join platforms p on p.code = o.platform_code
              where o.game_id = g.id and o.region = $1 and o.in_stock
                and p.kind in ${OFFICIAL_KINDS}) as current_cents,
            (select min(d.min_price_cents) from daily_prices d
               join platforms p on p.code = d.platform_code
              where d.game_id = g.id and d.region = $1
                and p.kind in ${OFFICIAL_KINDS}) as hist_low,
            exists (select 1 from offers o
               join platforms p on p.code = o.platform_code
              where o.game_id = g.id and o.region = $1 and o.in_stock
                and p.kind in ${OFFICIAL_KINDS}) as has_price,
            (select coalesce(json_agg(x order by x."userId"), '[]'::json) from (
               select distinct sa.user_id as "userId", u2.username, nullif(btrim(u2.display_name), '') as display_name, u2.email
                 from steam_wishlist sw
                 join steam_accounts sa on sa.steam_id = sw.steam_id
                 join users u2 on u2.id = sa.user_id
                where sw.appid = g.steam_appid
             ) x) as claimable_users
       from watchlist w
       join games g on g.id = w.game_id
       left join users u on u.id = w.user_id
      where ${where}
      order by w.created_at desc
      limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, size, offset],
  );
  return { items: rows.rows, total, page: pg, pageSize: size, pages: Math.max(1, Math.ceil(total / size)) };
}

/**
 * CU-2（docs/USER-ALERTS-GOVERNANCE.md §2/§3）：站点级提醒批量迁移给用户。
 * 目标用户已有同 (game_id, region) 用户级行 → 合并（站点级行删除，用户级行已覆盖该游戏提醒）；
 * 否则站点级行 user_id 从 NULL 更新为目标用户（partial 唯一索引自动从站点级换档到用户级）。
 * 只认 user_id IS NULL 的行；用户级行不在此接口范围（管理员只读）。
 * 返回 { migrated, merged, requested }。
 */
export async function migrateSiteWatches(q, { ids, userId, region = 'cn' }) {
  const cleanIds = [...new Set((ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!cleanIds.length || !Number.isInteger(userId) || userId <= 0) return { migrated: 0, merged: 0, requested: cleanIds.length };
  const r = await q(
    `with targets as (
       select w.id, w.game_id from watchlist w
        where w.id = any($1::bigint[]) and w.user_id is null and w.region = $3
     ),
     merged as (
       delete from watchlist w using targets t
        where w.id = t.id
          and exists (select 1 from watchlist u2
                       where u2.user_id = $2 and u2.game_id = t.game_id and u2.region = $3)
        returning w.id
     ),
     migrated as (
       update watchlist w set user_id = $2
        from targets t
        where w.id = t.id
          and not exists (select 1 from watchlist u2
                           where u2.user_id = $2 and u2.game_id = t.game_id and u2.region = $3)
        returning w.id
     )
     select (select count(*)::int from merged) as merged,
            (select count(*)::int from migrated) as migrated`,
    [cleanIds, userId, region],
  );
  const row = r.rows[0] ?? { merged: 0, migrated: 0 };
  return { migrated: Number(row.migrated), merged: Number(row.merged), requested: cleanIds.length };
}

/** CU-2：批量删除站点级提醒（用户级行只读不在此范围），返回被删行供审计。 */
export async function deleteSiteWatches(q, { ids, region = 'cn' }) {
  const cleanIds = [...new Set((ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!cleanIds.length) return [];
  const r = await q(
    `delete from watchlist where id = any($1::bigint[]) and user_id is null and region = $2 returning id, game_id`,
    [cleanIds, region],
  );
  return r.rows;
}
