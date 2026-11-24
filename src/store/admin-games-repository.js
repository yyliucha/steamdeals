// CO-5/B4-2 第十七轮（docs/DESIGN-AUDIT.md B4）：admin-games 域（B4 队列 #15：后台游戏目录
// /api/admin/games* 管理段）专属 SQL——从 src/store/pg.js 巨石抽出的第十七个域 repository。
//
// 归属判定（§15.1「域专属 SQL 进 repository，通用 SQL 留 pg.js」）：
//   · 搬入本文件：adminGameStats / adminGameLinks / listDeletedGames——只被本域路由使用
//     （stats 概览 / links 单游戏平台链接 / deleted 回收站），签名与拆分前完全一致；
//   · 抽新函数：adminGamesPlatformCond（DV 批 ITAD 来源筛选 SQL 片段，拆分前内联在路由体）、
//     listAdminGames（游戏列表 count + rows 两条查询，拆分前内联在路由体）、
//     adminGameLinkRow（links 路由的游戏行守卫查询，拆分前内联在路由体）；
//   · 留在 pg.js：跨模块共用 SQL——
//     gameKeywordSql（routes/games.js #21 域搜索也走同一片段）、backfillCandidateWhere
//     （adminGameStats 的 backfill_* 口径与 CLI 回填共用，经 import 引用）、
//     gameDetail / mergeGames（#21 域、CLI merge 命令、align 域共用）、
//     setInterest / setOwned / setGameDescription 等（#21 域与 CLI 共用）——一律不搬；
//   · games 表 DDL 在 pg.js（SCHEMA 常量），本文件不搬 DDL。
//
// pg.js 顶部 import + re-export 本文件，旧 db.* 导入签名永远不变。
// 本文件 import pg.js 的共享片段（gameKeywordSql/backfillCandidateWhere）——循环导入
// 只引用函数声明（运行时才调用），#21 games-repository.js 同款先例。
import { backfillCandidateWhere, gameKeywordSql } from './pg.js';

/** 后台游戏同步概览：总数 / 有 appid / 六态分项 / 已删除 / 有报价。
 *  待同步口径（docs/STEAM-SYNC-STATUS-AND-RATING.md §4）：steam_status 为 null（从未探测）
 *  或 ok 但缺简介；free/coming_soon/region_locked/no_price/not_found 都不再计入。 */
export async function adminGameStats(q) {
  const r = await q(`
    select count(*)::int as total,
           count(*) filter (where g.steam_appid is not null)::int as with_appid,
           count(*) filter (where g.deleted)::int as deleted,
           count(*) filter (where exists (select 1 from offers o2 where o2.game_id = g.id))::int as with_offers,
           -- 已同步（AC-2，docs/SYNC-FAILURE-MODES.md AC8）：ok 且有报价——steam-status 判 ok 时顺带写首价，
           -- 口径与用户感知一致（"已同步"就得有价格）；免费游戏无报价仍属正常（不算待同步）
           count(*) filter (where g.steam_appid is not null and not g.deleted and g.steam_status = 'ok' and g.is_free is not true and exists (select 1 from offers o2 where o2.game_id = g.id))::int as synced,
           -- 待同步：从未探测，或 ok 但缺报价（非免费）
           count(*) filter (where g.steam_appid is not null and not g.deleted and (g.steam_status is null or (g.steam_status = 'ok' and g.is_free is not true and not exists (select 1 from offers o2 where o2.game_id = g.id))))::int as pending,
           -- 六态分项（指标卡）
           count(*) filter (where g.steam_appid is not null and not g.deleted and g.steam_status is null)::int as pending_probe,
           count(*) filter (where g.steam_appid is not null and not g.deleted and g.steam_status = 'free')::int as free,
           count(*) filter (where g.steam_appid is not null and not g.deleted and g.steam_status = 'coming_soon')::int as coming_soon,
           count(*) filter (where g.steam_appid is not null and not g.deleted and g.steam_status = 'region_locked')::int as region_locked,
           count(*) filter (where g.steam_appid is not null and not g.deleted and g.steam_status = 'no_price')::int as no_price,
           count(*) filter (where g.steam_appid is not null and not g.deleted and g.steam_status = 'not_found')::int as not_found,
           count(*) filter (where g.steam_appid is not null and not g.deleted and g.steam_status is not null and g.steam_status not in ('ok','free','coming_soon','region_locked','no_price','not_found'))::int as other,
           -- 内容分级计数（docs/STEAM-SYNC-STATUS-AND-RATING.md §13.2）：成人/成熟（未标注 = total-deleted 减这两项）
           count(*) filter (where not g.deleted and g.adult_flag)::int as adult,
           count(*) filter (where not g.deleted and g.mature_flag)::int as mature,
           -- FH（docs/ADULT-STATS.md）：rating-backfill 回填覆盖——口径与候选谓词一致
           -- （docs/STEAM-SYNC-STATUS-AND-RATING.md §9 listRatingBackfillCandidates）：
           -- required_age 已采到（含 0）= 已回填；仍为 null = 未回填
           count(*) filter (where g.steam_appid is not null and not g.deleted and g.required_age is not null)::int as rating_backfilled,
           count(*) filter (where g.steam_appid is not null and not g.deleted and g.required_age is null)::int as rating_pending,
           -- BL 批（docs/BACKFILL-THROUGHPUT.md §3.4）：回填队列口径
           -- 待回填 = 新候选谓词（缺描述/无报价/有价缺图，排除四态与跳过中，不带 1 天冷却——那是运行期游标不是队列口径）
           count(*) filter (where ${backfillCandidateWhere({ includeCooldown: false })} )::int as backfill_pending,
           -- 已排除 = 旧候选谓词 ∩ 四态（本次被去噪排除掉的量，用于对账：待回填 + 已排除 + 跳过中 ≈ 旧候选数）
           count(*) filter (where ${backfillCandidateWhere({ includeCooldown: false, includeSkip: false, excludeStates: false })} and coalesce(g.steam_status, '') in ('free', 'coming_soon', 'region_locked', 'not_found'))::int as backfill_excluded,
           -- 跳过中 = 失败隔离期内（连续 3 次失败 → 30 天）
           count(*) filter (where g.backfill_skip_until is not null and g.backfill_skip_until > now())::int as backfill_skipped
      from games g`);
  const row = r.rows[0] ?? {};
  const num = (k) => Number(row[k] ?? 0);
  return {
    total: num('total'),
    withAppid: num('with_appid'),
    pending: num('pending'),
    synced: num('synced'),
    deleted: num('deleted'),
    withOffers: num('with_offers'),
    // 六态分项（前端指标卡按状态筛选）
    pendingProbe: num('pending_probe'),
    free: num('free'),
    comingSoon: num('coming_soon'),
    regionLocked: num('region_locked'),
    noPrice: num('no_price'),
    notFound: num('not_found'),
    other: num('other'),
    // 内容分级计数
    adult: num('adult'),
    mature: num('mature'),
    // FH（docs/ADULT-STATS.md）：rating-backfill 回填覆盖（required_age 口径）
    ratingBackfilled: num('rating_backfilled'),
    ratingPending: num('rating_pending'),
    // BL 批（docs/BACKFILL-THROUGHPUT.md §3.4）：回填队列口径
    backfillPending: num('backfill_pending'),
    backfillExcluded: num('backfill_excluded'),
    backfillSkipped: num('backfill_skipped'),
  };
}

/**
 * AG 批（docs/ADMIN-PLATFORM-LINKS.md §3-A）：单游戏全部平台链接（仅 http/https，过滤 javascript: 等脏数据），
 * 按平台名 / 区服 / 最近更新排序；同平台多区服各一行。
 */
export async function adminGameLinks(q, { gameId }) {
  const r = await q(
    `select o.platform_code, p.name as platform_name, o.region, o.currency,
            o.price_cents, o.original_cents, o.discount_pct, o.in_stock,
            o.buy_url, o.last_seen_at
       from offers o join platforms p on p.code = o.platform_code
      where o.game_id = $1 and o.buy_url ~ '^https?://'
      order by p.name, o.region, o.last_seen_at desc`,
    [gameId],
  );
  return r.rows;
}

/** 已删除（回收站）的游戏列表，按删除时间倒序。 */
export async function listDeletedGames(q, { limit = 200 } = {}) {
  const r = await q(
    `select g.id, g.steam_appid, coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name, g.name_en,
            g.app_type, g.deleted_at,
            coalesce(array_agg(distinct p.name) filter (where p.name is not null), '{}') as platform_names,
            (select count(*)::int from offers o where o.game_id = g.id) as offer_count
       from games g
       left join offers o on o.game_id = g.id
       left join platforms p on p.code = o.platform_code
      where g.deleted
      group by g.id
      order by g.deleted_at desc nulls last
      limit $1`,
    [Math.min(Math.max(Number(limit) || 200, 1), 1000)],
  );
  return r.rows;
}

/**
 * DV 批（docs/ITAD-SOURCE-FILTER.md §2 方案 A）：平台筛选 SQL 片段——ITAD 是聚合来源不是平台：
 * platform=itad 改走来源判定（game_source_sync 有 matched 标记），其余平台仍按 offers.platform_code。
 * index 是调用查询里的占位符序号（计数查询与列表查询不同）；itad 分支没有占位符，
 * 参数数组不能带 platform（pg 会报参数数不匹配）。
 */
export function adminGamesPlatformCond(platform, index) {
  return platform === 'itad'
    ? " and exists (select 1 from game_source_sync gs where gs.game_id = g.id and gs.platform_code = 'itad' and gs.status = 'matched')"
    : platform
      ? " and exists (select 1 from offers po join platforms pp on pp.code = po.platform_code where po.game_id = g.id and po.platform_code = $" + index + ')'
      : '';
}

/**
 * 后台游戏列表的 where 片段集合（拆分前内联在 server.js 路由体内）：
 * deletedWhere（回收站口径）/ offersWhere（报价筛选）/ syncWhere（同步状态，旧 sync 参数
 * 兼容 + 新 status 参数）/ ratingWhere（内容分级）——全部是参数枚举映射的安全片段，
 * 无用户输入直插；listAdminGames 用它们拼 baseWhere。
 */
export function adminGamesWhereParts({ deletedParam = 'exclude', offersParam = '', sync = '', statusParam = '', ratingParam = '' } = {}) {
  // 默认只看正常游戏；deleted=only 就是回收站，include 两边都看
  const deletedWhere =
    deletedParam === 'only' ? ' and g.deleted = true' : deletedParam === 'include' ? '' : ' and not g.deleted';
  const offersWhere =
    offersParam === 'priced'
      ? ' and exists (select 1 from offers of1 where of1.game_id = g.id)'
      : offersParam === 'none'
        ? ' and not exists (select 1 from offers of2 where of2.game_id = g.id)'
        : '';
  // 同步状态（docs/STEAM-SYNC-STATUS-AND-RATING.md §4）：
  //   sync=pending（旧参数，兼容）= 从未探测或 ok 但缺简介；done=ok 且有简介
  //   status=<steam_status|pending|synced|other>（新参数，指标卡点击用）
  const statusWhere =
    statusParam === 'pending'
      ? ' and g.steam_appid is not null and g.steam_status is null'
      : statusParam === 'synced'
        ? " and g.steam_appid is not null and g.steam_status = 'ok' and g.description is not null and g.description <> ''"
        : statusParam === 'other'
          ? " and g.steam_appid is not null and g.steam_status is not null and g.steam_status not in ('ok','free','coming_soon','region_locked','no_price','not_found')"
          : ['ok', 'free', 'coming_soon', 'region_locked', 'no_price', 'not_found'].includes(statusParam)
            ? ` and g.steam_appid is not null and g.steam_status = '${statusParam}'`
            : '';
  const syncWhere =
    sync === 'pending'
      ? " and g.steam_appid is not null and (g.steam_status is null or (g.steam_status = 'ok' and (g.description is null or g.description = '')))"
      : sync === 'done'
        ? " and g.steam_appid is not null and g.steam_status = 'ok' and g.description is not null and g.description <> ''"
        : statusWhere;
  // 内容分级筛选（docs/STEAM-SYNC-STATUS-AND-RATING.md §13.2）：可与搜索/平台/同步状态叠加
  const ratingWhere =
    ratingParam === 'adult' ? ' and g.adult_flag'
      : ratingParam === 'mature' ? ' and g.mature_flag'
        : ratingParam === 'none' ? ' and not g.adult_flag and not g.mature_flag'
          : '';
  return { deletedWhere, offersWhere, syncWhere, ratingWhere };
}

/**
 * B2 批（docs/DESIGN-AUDIT.md B2）：后台游戏列表的计数 + 列表两条查询（拆分前内联在
 * server.js 路由体内）。deletedWhere/offersWhere/syncWhere/ratingWhere 是路由层按参数
 * 拼好的安全片段（无用户输入直插），platformCond 走本文件 adminGamesPlatformCond。
 * 返回 { total, rows }；rows 保留原始列（路由层组装 payload 与缓存）。
 */
export async function listAdminGames(q, { kw = '', deletedWhere = '', offersWhere = '', syncWhere = '', ratingWhere = '', platform = '', pageSize = 20, offset = 0 }) {
  const platformArgs = platform === 'itad' ? [] : platform ? [platform] : [];
  const baseWhere =
    'where ' + gameKeywordSql('$1', { appidAsText: true }) +
    deletedWhere + syncWhere + offersWhere + ratingWhere;
  const cnt = await q(
    'select count(*)::int as n from games g ' + baseWhere + adminGamesPlatformCond(platform, 2),
    [kw, ...platformArgs],
  );
  const rows = await q(
    'select g.id, g.steam_appid, coalesce(nullif(g.name, \'\'), nullif(g.name_en, \'\'), \'appid:\' || g.steam_appid) as name, g.name_en, g.app_type, g.blocked, g.deleted, g.deleted_at, g.updated_at, ' +
    '(g.description is not null and g.description <> \'\') as has_desc, ' +
    'g.steam_status, g.steam_checked_at, g.required_age, g.adult_flag, g.mature_flag, ' +
    '(select count(*) from offers o where o.game_id = g.id) as offer_count, ' +
    '(select min(o.price_cents) from offers o where o.game_id = g.id and o.platform_code = \'steam\' and o.in_stock) as steam_price, ' +
    // 平台列：这款游戏当前有报价的渠道（多个用数组，前端渲染成多个标签）
    '(select coalesce(array_agg(distinct p.name), \'{}\') from offers o2 join platforms p on p.code = o2.platform_code where o2.game_id = g.id) as platform_names, ' +
    '(select coalesce(array_agg(distinct o3.platform_code), \'{}\') from offers o3 where o3.game_id = g.id) as platform_codes, ' +
    // AG 批（docs/ADMIN-PLATFORM-LINKS.md）：列表只带数量，完整链接按需从 /links 接口取
    "(select count(*)::int from offers o4 where o4.game_id = g.id and o4.buy_url ~ '^https?://') as link_count " +
    'from games g ' + baseWhere + adminGamesPlatformCond(platform, 4) + ' ' +
    'order by g.updated_at desc nulls last, g.id desc limit $2 offset $3',
    [kw, pageSize, offset, ...platformArgs],
  );
  return { total: cnt.rows[0]?.n ?? 0, rows: rows.rows };
}

/** AG 批：单游戏平台链接路由的游戏行守卫查询（拆分前内联在路由体；not deleted 守卫）。 */
export async function adminGameLinkRow(q, gameId) {
  const g = await q('select id, steam_appid, name, name_en from games where id = $1 and not deleted', [gameId]);
  return g.rows[0] ?? null;
}
