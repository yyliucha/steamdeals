// CO-5/B4-2 第四轮（docs/DESIGN-AUDIT.md B4）：watchlist/wishlist 域 repository——用户级
// 到价提醒的专属 SQL，从 src/store/pg.js 巨石抽出（函数签名与拆分前完全一致）。
//
// 归属判定：只含「仅 watchlist/wishlist 用户段路由使用」的 SQL（CL 批 docs/USER-ALERTS.md）；
// 跨域共用的 SQL 留在 pg.js——
//   · upsertWatch / deleteWatch / listWatches（CLI watch add/del 也共用，B4 #18）；
//   · getUserWatch（游戏详情 watch 字段回显，games 域 B4 #21 也共用）；
//   · deleteWatchById / listAllWatchesAdmin / migrateSiteWatches / deleteSiteWatches /
//     watchCandidates（管理段 B4 #16 与 alerts 引擎共用）；
//   · watchlist 表 DDL（含 source/user_id 迁移）留在 pg.js——alerts/CLI/管理段/详情
//     字段都读写该表，属跨域共用表（与认证域先例一致：无 DDL 搬家）。
//   · 愿望单落库 SQL（addUserWishlist/removeUserWishlist/listWishlists）在 steam-accounts.js
//     （跨域模块：steam accounts 域与本站愿望单共用），本文件不放。
//
// 拆分约定（见 docs/ARCHITECTURE.md「域路由拆分模式」）：
//   · 域 SQL 落 src/store/<domain>-repository.js；
//   · pg.js 以 `export { … } from './watchlist-repository.js'` re-export——routes/watchlist.js
//     与现有测试一律照旧走 pg.js 聚合壳（db.* 签名不变）。
//
// OFFICIAL_KINDS 是跨域通用 SQL 片段（pg.js 内 80+ 处使用），从 pg.js import（live binding，
// 循环由 ESM 处理：本文件顶层只声明函数、运行期才取值），不在此重复定义防漂移。
import { OFFICIAL_KINDS } from './pg.js';

/** 用户级 upsert：同 (user_id, game_id, region) 重复只更新目标价/备注（§7 去重与幂等）。 */
export async function upsertUserWatch(q, { userId, gameId, region = 'cn', targetCents = null, note = null, source = 'manual' }) {
  const r = await q(
    `insert into watchlist (user_id, game_id, region, target_cents, note, source)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, game_id, region) where user_id is not null do update
       set target_cents = excluded.target_cents, note = excluded.note, source = excluded.source
     returning id`,
    [userId, gameId, region, targetCents, note, source],
  );
  return Number(r.rows[0].id);
}

/** 用户级删除：只删当前用户该游戏的提醒（幂等，返回 removed 0/1）。 */
export async function deleteUserWatch(q, { userId, gameId, region = 'cn' }) {
  const r = await q('delete from watchlist where user_id = $1 and game_id = $2 and region = $3', [userId, gameId, region]);
  return r.rowCount ?? 0;
}

/** 当前用户的提醒列表（join 游戏 + 当前价/史低/货币），按加入时间倒序。 */
export async function listUserWatches(q, { userId, region = 'cn' } = {}) {
  const r = await q(
    `select w.id, w.game_id, w.target_cents, w.note, w.created_at, w.last_notified_cents, w.last_notified_at,
            g.steam_appid, coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name,
            (select min(o.price_cents) from offers o
               join platforms p on p.code = o.platform_code
              where o.game_id = g.id and o.region = $2 and o.in_stock
                and p.kind in ${OFFICIAL_KINDS}) as current_cents,
            (select o.currency from offers o
               join platforms p on p.code = o.platform_code
              where o.game_id = g.id and o.region = $2 and o.in_stock
                and p.kind in ${OFFICIAL_KINDS}
              order by o.price_cents asc limit 1) as currency,
            (select min(d.min_price_cents) from daily_prices d
               join platforms p on p.code = d.platform_code
              where d.game_id = g.id and d.region = $2
                and p.kind in ${OFFICIAL_KINDS}) as hist_low
       from watchlist w
       join games g on g.id = w.game_id
      where w.user_id = $1 and w.region = $2
      order by w.created_at desc`,
    [userId, region],
  );
  return r.rows;
}
