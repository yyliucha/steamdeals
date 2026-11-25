// CO-5/B4-2 第十五轮（docs/DESIGN-AUDIT.md B4）：games 域专属 SQL。
//
// 本文件只含 /api/games/* 域专属的数据访问函数（签名与拆分前一致）；pg.js 顶部
// re-export 保持旧 db.* 导入签名不变（routes/games.js、server.js 其它段与现有测试
// 照旧走聚合壳）。跨域共用的通用 SQL（gameDetail / regionOffers / dailyMinSeries /
// offersOfGame / setInterest / setOwned / setGameDescription / gameKeywordSql /
// GAME_SELECT 等共享片段）留 pg.js——本文件从 pg.js 导入共享片段，避免两处漂移。
// games/daily_prices/offers 等表 DDL 在 pg.js SCHEMA（跨模块共用），不搬家。

import {
  OFFICIAL_KINDS,
  GAME_SELECT,
  GAME_SELECT_RM,
  EFFECTIVE_OWNED_SQL,
  OWNED_BY_SQL,
  WISHLISTED_SQL,
  WISHLISTED_BY_SQL,
  SITE_WISHLISTED_SQL,
  gameKeywordSql,
} from './pg.js';
import { deriveQueryTokens, queryOverlapTokens, queryLikePatterns } from '../search-derive.js';

// DS 批（docs/SEARCH-ALIASES.md §4）：pg_trgm 可用性探测——pglite（本地测试）没有 pg_trgm 扩展，
// 探测一次后缓存，模糊兜底在无扩展环境整体跳过（主查询行为不受影响）。
let trgmProbe = null;
async function trgmAvailable(q) {
  if (trgmProbe === null) {
    try {
      await q(`select similarity($1::text, $2::text) as s`, ['a', 'a']);
      trgmProbe = true;
    } catch {
      trgmProbe = false;
    }
  }
  return trgmProbe;
}

/**
 * DS 批（docs/SEARCH-ALIASES.md §4）：模糊兜底候选（拼错容忍），仅在主查询零命中时调用。
 * 段 1：name/name_en 的 trgm 相似度 ≥ 阈值（默认 0.4，`SEARCH_FUZZY_THRESHOLD` 可调；
 *       走 AU 批的 games_name_trgm / games_name_en_trgm GIN 索引）；
 * 段 2：段 1 无结果时再对 search_tokens 做 token 级相似度 ≥ 0.6（unnest 全表，代价高但触发概率低）。
 * 返回游戏 id 列表（空 = 无模糊命中或扩展不可用）。
 * 本函数是独立查询：绑定 [kw, 阈值, cap]，$1=kw——kwNormExpr 必须用 $1 版（kwNormCandidate）。
 */
async function fuzzyCandidateIds(q, kw, kwNormExpr, norm, cap, nameThreshold) {
  if (!(await trgmAvailable(q))) return [];
  const arm1 = await q(
    `select g.id from games g
      where similarity(${norm('g.name')}, ${kwNormExpr}) >= $2
         or similarity(${norm('g.name_en')}, ${kwNormExpr}) >= $2
      limit $3`,
    [kw, nameThreshold, cap],
  );
  const pick = (rows) => rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
  if (arm1.rows.length) return pick(arm1.rows);
  const arm2 = await q(
    `select g.id from games g
      where exists (select 1 from unnest(g.search_tokens) t where similarity(t, ${kwNormExpr}) >= $2)
      limit $3`,
    [kw, 0.6, cap],
  );
  return pick(arm2.rows);
}

/**
 * 服务端搜索 + 分页 + 排序（前台列表用）。
 * 返回 { rows, total, page, pageSize, pages }。
 * 关键词在前端只过滤页面内数据的时代已经结束：现在能搜全库。
 */
export async function gameSearch(
  q,
  { region = 'cn', page = 1, pageSize = 20, keyword = '', sort = 'discount', interest = 'all', owned = 'exclude', blocked = 'exclude', userId = null, typeFilter = 'all', released = 'all', marks = 'any', compact = false, guestFlags = null, wishlist = false, adult = 'hide', rating = '', reviewMin = null, deck = 'all', discountOnly = false, histLowOnly = false, freeOnly = false, unreleased = false } = {},
  logger = null,
) {
  // DA 批（docs/APP-FILTER-SERVER-SIDE.md §2）：四个筛选开关互斥（App 单选 chip），
  // 同时传多个按优先级 unreleased > freeOnly > histLowOnly > discountOnly 取第一个——在这里归一，口径对全部调用方一致。
  if (unreleased) {
    freeOnly = false;
    histLowOnly = false;
    discountOnly = false;
  } else if (freeOnly) {
    histLowOnly = false;
    discountOnly = false;
  } else if (histLowOnly) {
    discountOnly = false;
  }
  const kw = String(keyword ?? '').trim();
  const size = Math.min(Math.max(Number(pageSize) || 20, 5), 100);
  const pg = Math.max(1, Number(page) || 1);
  const offset = (pg - 1) * size;

  // 生效标记：登录用户个人标记优先，未标记回退全局（games.interested / games.owned）
  const col = (name) => (userId ? `coalesce(uf.${name}, g.${name})` : `g.${name}`);
  const userJoin = (index) => (userId ? `left join user_game_flags uf on uf.game_id = g.id and uf.user_id = $${index}` : '');
  const filterParams = [region, kw];
  if (userId) filterParams.push(userId);
  const bindFilter = (value) => {
    filterParams.push(value);
    return `$${filterParams.length}`;
  };

  // AV 批（docs/READ-MODEL.md §5）：读模型模式下「有历史/有报价」的语义由快照行存在承担，
  // 去掉 exists(daily_prices)；READ_MODEL=legacy 保留旧 SQL 作回滚开关（表保留不删数据）。
  const useReadModel = process.env.READ_MODEL !== 'legacy';
  // AY 批（docs/READ-MODEL.md §10）：关键词先走 trigram/别名候选取 ID——
  // 零命中直接返回（生产实测原「逐行 LIKE + 别名 EXISTS」零命中 800ms+，还触发 JIT +220ms）；
  // 命中数在阈值内用 g.id = any($n)（主键 ScalarArrayOp）替代逐行函数计算；
  // 超过阈值（宽泛词）才回落原 LIKE 条件，保证 total 精确。
  // 上限可用环境变量覆盖（测试专用；生产默认 5000）：命中数达到上限时回退原 LIKE，保证 total 精确。
  const KEYWORD_CANDIDATE_CAP = Math.max(1, Number(process.env.SEARCH_KEYWORD_CANDIDATE_CAP) || 5000);
  // DS 批（docs/SEARCH-ALIASES.md §4）：模糊兜底相似度阈值（拼错容忍；规格：阈值可调，默认 0.4）。
  const FUZZY_NAME_THRESHOLD = Math.max(0.1, Math.min(0.9, Number(process.env.SEARCH_FUZZY_THRESHOLD) || 0.4));
  const startedAt = Date.now();
  const norm = (expr) => `replace(replace(lower(coalesce(${expr}, '')), ' ', ''), '　', '')`;
  // DW（docs/SEARCH-FIX-PERF.md §DW）：关键词归一化两套参数位、两套表达式，显式区分：
  // - 候选探测 SQL 与 fuzzy 兜底是独立查询，绑定 [kw, …]——$1=kw，用 kwNormCandidate；
  // - 主查询（count/rows/排序）绑定 filterParams=[region, kw, …]——$2=kw，用 kwNorm。
  // 二者绝不能互换：把 $2 版表达式塞进候选查询会让精确名 LIKE 匹配 cap（42804/0 命中），
  // 把候选查询绑定改成 [region, kw, …] 会让未引用的 $1 触发 42P18（pglite/生产一致）。
  const kwNormCandidate = `replace(replace(lower($1), ' ', ''), '　', '')`;
  const kwNorm = `replace(replace(lower($2), ' ', ''), '　', '')`;
  const isAppidKw = /^\d{1,10}$/.test(kw);
  // DS 批：查询侧与存储侧同一派生函数；纯数字（AppID 语义）与空关键词不派生 token。
  const queryTokens = deriveQueryTokens(kw);
  const overlapTokens = queryOverlapTokens(queryTokens);
  const likePatterns = queryLikePatterns(queryTokens);
  const hasTokenArm = kw !== '' && queryTokens.length > 0;
  // token 命中条件：数组重叠（GIN）或任意 token 子串兼容（xdlc6 → 存储 xdlcs6 靠 %xdlc% 命中）。
  // 派生 token 只含 [a-z0-9\u4e00-\u9fff]、模式为 '%tok%'，无引号/反斜杠——安全内联，避免参数
  // 在 count（无 order by）查询里未被引用而触发 42P18，且参数编号与 userId/ids 绑定完全解耦。
  const inlineArr = (arr) => (arr.length ? `array[${arr.map((t) => `'${t}'`).join(', ')}]::text[]` : "'{}'::text[]");
  const tokSql = inlineArr(overlapTokens);
  const patSql = inlineArr(likePatterns);
  const tokenArmSql = hasTokenArm
    ? `(g.search_tokens && ${tokSql} or exists (select 1 from unnest(g.search_tokens) t where t like any (${patSql})))`
    : 'false';
  let matchedBy = null;
  let keywordCond;
  if (kw) {
    const appidArm = isAppidKw ? ' union select g.id from games g where g.steam_appid = $1::int' : '';
    const found = await q(
      `select id from (
          select g.id from games g
           where ${norm('g.name')} like '%' || ${kwNormCandidate} || '%'
              or ${norm('g.name_en')} like '%' || ${kwNormCandidate} || '%'
          union
          select a.game_id as id from game_aliases a
           where ${norm('a.platform_title')} like '%' || ${kwNormCandidate} || '%'
          union
          select g.id from games g
           where ${hasTokenArm ? `g.search_tokens && ${tokSql} or exists (select 1 from unnest(g.search_tokens) t where t like any (${patSql}))` : 'false'}
          ${appidArm}
        ) t limit $2`,
      [kw, KEYWORD_CANDIDATE_CAP],
    );
    let ids = found.rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    // DS 批：主查询零命中 → pg_trgm 模糊兜底（拼错容忍；无扩展环境整体跳过）
    if (!ids.length && hasTokenArm) {
      const fuzzyIds = await fuzzyCandidateIds(q, kw, kwNormCandidate, norm, KEYWORD_CANDIDATE_CAP, FUZZY_NAME_THRESHOLD);
      if (fuzzyIds.length) {
        ids = fuzzyIds;
        matchedBy = 'fuzzy';
      }
    }
    if (!ids.length) {
      // DS 批：零命中日志——词、派生 token、耗时；只记日志，不建人工映射（规格 §4）。
      logger?.info('search.miss', { kw, tokens: queryTokens, fuzzy: matchedBy === 'fuzzy', elapsedMs: Date.now() - startedAt });
      return { rows: [], total: 0, page: pg, pageSize: size, pages: 1, matchedBy };
    }
    if (ids.length >= KEYWORD_CANDIDATE_CAP) {
      keywordCond = isAppidKw
        ? gameKeywordSql('$2', { appidAsInt: true })
        : gameKeywordSql('$2', { tokenCond: tokenArmSql });
    } else {
      // 保留 $2 引用：userJoin 固定用 $3，参数编号不能变，未被引用的 $2 会让 PG 无法推断类型（42P18）
      keywordCond = `$2::text is not null and g.id = any(${bindFilter(ids)}::bigint[])`;
    }
  } else {
    keywordCond = gameKeywordSql('$2');
  }
  // DS 批（docs/SEARCH-ALIASES.md §4）：命中分级排序——原名/中文名直接命中 0 > 派生 token/平台别名命中 1 > 模糊 2；
  // 再走原有 sort（无搜索词时 rankPrefix 为空，排序行为完全不变）。
  // 主查询里 $1=region、$2=kw——排序分级用 $2 版关键词归一化（kwNorm；候选探测才用 $1 版 kwNormCandidate）。
  const rankExpr = !kw
    ? null
    : matchedBy === 'fuzzy'
      ? '2'
      : `(case when ${norm('g.name')} like '%' || ${kwNorm} || '%' or ${norm('g.name_en')} like '%' || ${kwNorm} || '%' then 0 ` +
        `when ${tokenArmSql} or exists (select 1 from game_aliases a where a.game_id = g.id and ${norm('a.platform_title')} like '%' || ${kwNorm} || '%') then 1 else 2 end)`;
  const rankPrefix = rankExpr ? `${rankExpr} asc, ` : '';
  const conds = [
    // DA 批：unreleased 筛选要能看到「无报价/无历史的未来游戏」，豁免 legacy 的 daily_prices 前置条件
    ...(useReadModel || unreleased ? [] : ['exists (select 1 from daily_prices d where d.game_id = g.id and d.region = $1)']),
    'not g.deleted',
    keywordCond,
  ];
  // 成人内容展示策略（docs/STEAM-SYNC-STATUS-AND-RATING.md §5.2）：
  // hide=前台不展示（默认），badge/show 不过滤（展示方式由前端角标决定）。只做平台标签映射，不做法律定性。
  if (adult === 'hide') conds.push('not g.adult_flag');
  // EF 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9）：前台 rating 筛选——与后台 /api/admin/games 同一口径
  // （adult=只看成人（宽）；mature=只看成熟；none=只看未标注（双 false）；空=不过滤）。
  // FT 批（docs/EXPLICIT-RATING.md §2.3）：explicit=只看色情游戏（严格，descriptor 4/AO）。
  if (rating === 'adult') conds.push('g.adult_flag');
  else if (rating === 'explicit') conds.push('g.explicit_flag');
  else if (rating === 'mature') conds.push('g.mature_flag');
  else if (rating === 'none') conds.push('not g.adult_flag and not g.mature_flag');
  if (guestFlags && !userId) {    // 游客：感兴趣/不感兴趣沿用浏览器本地标记；已拥有与愿望单是登录用户专属维度，
    // owned=only/exclude 与 wishlist=true 对游客一律无效（规格 §6：未登录返回全量）。
    const interestIds = interest === 'on' ? guestFlags.interestedIds : interest === 'off' ? guestFlags.uninterestedIds : null;
    if (interestIds) conds.push(interestIds.length ? `g.id = any(${bindFilter(interestIds)}::bigint[])` : 'false');
  } else {
    // 感兴趣/不感兴趣是用户自己的分类，不使用 games.interested 的全局默认值（通常默认为 true）。
    if (interest === 'on') conds.push(userId ? 'uf.interested = true' : `${col('interested')} = true`);
    if (interest === 'off') conds.push(userId ? 'uf.interested = false' : `${col('interested')} = false`);
    // 已拥有：CL 批起只认绑定账号 Steam 库并集（user_game_flags.owned 不再参与口径，字段保留）。
    if (userId) {
      if (owned === 'exclude') conds.push(`not ${EFFECTIVE_OWNED_SQL('$3')}`);
      if (owned === 'only') conds.push(`(${EFFECTIVE_OWNED_SQL('$3')})`);
    }
    // 愿望单：登录用户专属筛选。
    if (userId && wishlist) conds.push(`(${WISHLISTED_SQL('$3')})`);
  }
  if (blocked === 'exclude') conds.push('g.blocked = false');
  if (blocked === 'only') conds.push('g.blocked = true');
  // 「全部」页签排除已标记（unmarked）：登录用户按个人标记行判断（全局 games.interested 默认 true，不能用 coalesce）；
  // 游客按前端合并的 id 列表排除；已拥有已由 owned='exclude' 覆盖。
  if (marks === 'unmarked') {
    if (userId) {
      conds.push('uf.interested is null');
    } else if (guestFlags?.excludeIds?.length) {
      conds.push(`not (g.id = any(${bindFilter(guestFlags.excludeIds)}::bigint[]))`);
    }
  }
  // 类型筛选：game / dlc（app_type 入库时已统一小写）
  if (typeFilter === 'game' || typeFilter === 'dlc') conds.push(`lower(coalesce(g.app_type, '')) = '${typeFilter}'`);
  // 发行时间筛选（热度批次落库的 release_date）
  if (released === '30d') conds.push("g.release_date >= current_date - interval '30 days'");
  else if (released === '1y') conds.push("g.release_date >= current_date - interval '1 year'");
  else if (released === '3y') conds.push("g.release_date >= current_date - interval '3 years'");
  // CH 批（docs/DISCOVERY-FOR-YOU.md §3）：好评率/Deck 筛选（白名单在 server 层，这里只拼条件）
  if (reviewMin >= 1 && reviewMin <= 9) conds.push(`coalesce(g.review_score, 0) >= ${Number(reviewMin)}`);
  if (deck === 'verified') conds.push('g.deck_compat = 3');
  else if (deck === 'playable') conds.push('g.deck_compat >= 2');
  else if (deck === 'ok') conds.push('g.deck_compat >= 1');
  else if (deck === 'unsupported') conds.push('g.deck_compat = 1');
  // DA 批（docs/APP-FILTER-SERVER-SIDE.md §2）：App/Web 共用的四个筛选口径。
  // 折扣：官方+授权渠道、在售、折扣 > 0（与详情 current 口径一致，exists 可走 idx_offers_discount 部分索引）。
  if (discountOnly) {
    conds.push(
      `exists (select 1 from offers o join platforms p on p.code = o.platform_code
        where o.game_id = g.id and o.region = $1 and o.in_stock and p.kind in ${OFFICIAL_KINDS} and o.discount_pct > 0)`,
    );
  }
  // 史低：当前价 = 历史最低（current_low <= hist_low；hist 含当天，两者相等即命中）。
  // 读模型直接读快照列（生产路径，无逐行子查询）；legacy 回滚用与 GAME_SELECT 同口径的子查询。
  if (histLowOnly) {
    conds.push(
      useReadModel
        ? 'rs.price_cents is not null and rs.hist_low_cents is not null and rs.price_cents <= rs.hist_low_cents'
        : `(select min(o.price_cents) from offers o join platforms p on p.code = o.platform_code
             where o.game_id = g.id and o.region = $1 and o.in_stock and p.kind in ${OFFICIAL_KINDS}) is not null
           and (select min(d.min_price_cents) from daily_prices d join platforms p on p.code = d.platform_code
             where d.game_id = g.id and d.region = $1 and p.kind in ${OFFICIAL_KINDS}) is not null
           and (select min(o.price_cents) from offers o join platforms p on p.code = o.platform_code
             where o.game_id = g.id and o.region = $1 and o.in_stock and p.kind in ${OFFICIAL_KINDS})
               <= (select min(d.min_price_cents) from daily_prices d join platforms p on p.code = d.platform_code
             where d.game_id = g.id and d.region = $1 and p.kind in ${OFFICIAL_KINDS})`,
    );
  }
  // 免费：is_free 标记为主，兼容 0 元官方报价（部分历史数据可能只落价未落标记）。
  if (freeOnly) {
    conds.push(
      `(g.is_free = true or exists (select 1 from offers o join platforms p on p.code = o.platform_code
        where o.game_id = g.id and o.region = $1 and o.in_stock and p.kind in ${OFFICIAL_KINDS} and o.price_cents = 0))`,
    );
  }
  // 未发售：release_date 在未来；无日期时回退 steam_status=coming_soon。不含「已发售但无报价」。
  if (unreleased) {
    conds.push(`(g.release_date > current_date or (g.release_date is null and g.steam_status = 'coming_soon'))`);
  }
  const where = 'where ' + conds.join(' and ');

  const priceExpr = `(select min(o.price_cents) from offers o
     join platforms p on p.code = o.platform_code
    where o.game_id = g.id and o.region = $1 and o.in_stock and p.kind in ${OFFICIAL_KINDS})`;
  const discountExpr = `(select max(o.discount_pct) from offers o
     join platforms p on p.code = o.platform_code
    where o.game_id = g.id and o.region = $1 and o.in_stock and p.kind in ${OFFICIAL_KINDS})`;
  // DA 批（docs/APP-FILTER-SERVER-SIDE.md §2）：sort=heat/release 是独立主排序（非「热度前缀+二级」结构），
  // 直接替换整段 order by；其余排序保持原结构不变（排序口径不变）。
  const primaryOrder =
    sort === 'heat'
      ? 'g.heat desc nulls last, g.id desc'
      : sort === 'release'
        ? 'g.release_date desc nulls last, g.id desc'
        : null;
  const order =
    sort === 'price'
      ? `${priceExpr} asc nulls last, name asc`
      : sort === 'name'
        ? 'name asc'
        : sort === 'score'
          ? `(0.4*coalesce(${discountExpr},0) + 0.35*(coalesce(g.review_score,5)/9.0)*100 + 0.25*coalesce(g.heat,0)) desc nulls last, name asc`
          : `${discountExpr} desc nulls last, ${priceExpr} asc nulls last, name asc`;

  // AV 批（docs/READ-MODEL.md §5.1）：读模型分支——compact 用内连接（行存在=有历史/有报价），
  // 非 compact 用左连接 + rs.game_id is not null（保持旧「exists(daily_prices)」语义）。
  const rmFromCompact = `from games g ${userJoin(3)} join game_region_snapshot rs on rs.game_id = g.id and rs.region = $1`;
  const rmFromFull = `from games g ${userJoin(3)} left join game_region_snapshot rs on rs.game_id = g.id and rs.region = $1`;
  const rmConds = useReadModel ? [...conds] : null;
  // DA 批：unreleased 筛选需要「无报价/无历史的未来游戏」也可见——读模型的「有历史/有报价」限制
  // （非 compact 的 rs.game_id is not null / compact 的内连接）在该筛选下豁免，改用 left join + 不 unshift。
  if (rmConds && !compact && !unreleased) rmConds.unshift('rs.game_id is not null');
  const rmWhereStr = rmConds ? 'where ' + rmConds.join(' and ') : null;
  const rmFromList = unreleased ? rmFromFull : rmFromCompact;
  const rmSort =
    sort === 'name'
      ? 'name asc'
      : sort === 'price'
        ? 'rs.price_cents asc nulls last, name asc'
        : sort === 'score'
          ? '(0.4*coalesce(rs.discount_pct,0) + 0.35*(coalesce(g.review_score,5)/9.0)*100 + 0.25*coalesce(g.heat,0)) desc nulls last, name asc'
          : 'rs.discount_pct desc nulls last, rs.price_cents asc nulls last, name asc';

  // DX 批（docs/SEARCH-FIX-PERF.md §DX）：count 与 rows 合并——count(*) over() 在 limit/offset
  // 之前计算，一次查询同时拿到 total 与当页行；只有空页（total=0 或 offset 越界）才退回单跑
  // count（低频路径）。窗口与旧 count 查询共用同一 from/where，口径完全一致（total 正确性不变）。
  const countFallback = async () =>
    useReadModel
      ? Number(
          (await q(
            `select count(*)::int as n ${compact ? rmFromList : rmFromFull} ${rmWhereStr}`,
            filterParams,
          )).rows[0]?.n ?? 0,
        )
      : Number(
          (await q(
            `select count(*)::int as n from games g ${userJoin(3)} ${where}`,
            filterParams,
          )).rows[0]?.n ?? 0,
        );
  const extra = userId
    ? `, ${col('interested')} as eff_interested, uf.interested as user_interested, ${EFFECTIVE_OWNED_SQL('$3')} as eff_owned, uf.owned as user_owned,
       ${OWNED_BY_SQL('$3')} as owned_by, ${WISHLISTED_SQL('$3')} as wishlisted,
       ${WISHLISTED_BY_SQL('$3')} as wishlisted_by, ${SITE_WISHLISTED_SQL('$3')} as site_wishlisted, g.heat, g.release_date,
       g.deck_compat, g.review_score, g.review_score_desc, g.review_total, g.is_free`
    : ', g.heat, g.release_date, g.deck_compat, g.review_score, g.review_score_desc, g.review_total, g.is_free';
  const compactQuery = `
    with price_rollup as (
      select o.game_id,
        min(o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}) as current_low,
        (array_agg(o.currency order by o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}))[1] as currency,
        min(o.price_cents) filter (where o.in_stock and o.platform_code = 'steam') as steam_price,
        min(o.original_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}) as current_original,
        max(o.discount_pct) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}) as discount,
        max(o.last_seen_at) as last_seen_at,
        (array_agg(p.name order by o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}))[1] as low_platform_name,
        (array_agg(o.platform_code order by o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}))[1] as low_platform
      from offers o join platforms p on p.code = o.platform_code
      where o.region = $1
      group by o.game_id
    ), daily_rollup as (
      select d.game_id,
        min(d.min_price_cents) filter (where p.kind in ${OFFICIAL_KINDS}) as hist_low,
        min(d.min_price_cents) filter (where d.day < current_date and p.kind in ${OFFICIAL_KINDS}) as prev_hist_low,
        count(*)::int as day_count
      from daily_prices d join platforms p on p.code = d.platform_code
      where d.region = $1
      group by d.game_id
    )
    select g.id, g.steam_appid, coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name,
      g.name_en, g.app_type, g.heat, g.release_date,
      ${userId ? 'uf.interested' : 'null::boolean'} as interested,
      ${userId ? 'uf.interested' : 'null::boolean'} as user_interested,
      ${userId ? 'uf.owned' : 'null::boolean'} as user_owned,
      ${userId ? EFFECTIVE_OWNED_SQL('$3') : 'false'} as owned,
      ${userId ? OWNED_BY_SQL('$3') : "'[]'::json"} as owned_by,
      ${userId ? WISHLISTED_SQL('$3') : 'false'} as wishlisted,
      ${userId ? WISHLISTED_BY_SQL('$3') : "'[]'::json"} as wishlisted_by,
      ${userId ? SITE_WISHLISTED_SQL('$3') : 'false'} as site_wishlisted,
      g.blocked, g.steam_status, g.adult_flag, g.explicit_flag, g.mature_flag, pr.current_low, pr.currency, pr.steam_price, pr.current_original,
      pr.discount, dr.hist_low, dr.prev_hist_low, dr.day_count, pr.last_seen_at,
      pr.low_platform_name, pr.low_platform, count(*) over() as total_rows
    from games g ${userJoin(3)}
    left join price_rollup pr on pr.game_id = g.id
    left join daily_rollup dr on dr.game_id = g.id
    ${where}
    order by ${rankPrefix}${primaryOrder ?? `g.heat desc nulls last, ${sort === 'name' ? 'name asc' : sort === 'price' ? 'pr.current_low asc nulls last, name asc' : 'pr.discount desc nulls last, pr.current_low asc nulls last, name asc'}, g.id asc`}
    limit __LIST_LIMIT__ offset __LIST_OFFSET__`;
  // AV 批（docs/READ-MODEL.md §5.1）：compact 读模型查询——与旧 compact 同字段（价格/史低来自 rs.*，
  // 补 rs.platform_names），排序与旧 CTE 版一致（含 g.id 兜底）。
  const compactRmQuery = `
    select g.id, g.steam_appid, coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name,
      g.name_en, g.app_type, g.heat, g.release_date,
      ${userId ? 'uf.interested' : 'null::boolean'} as interested,
      ${userId ? 'uf.interested' : 'null::boolean'} as user_interested,
      ${userId ? 'uf.owned' : 'null::boolean'} as user_owned,
      ${userId ? EFFECTIVE_OWNED_SQL('$3') : 'false'} as owned,
      ${userId ? OWNED_BY_SQL('$3') : "'[]'::json"} as owned_by,
      ${userId ? WISHLISTED_SQL('$3') : 'false'} as wishlisted,
      ${userId ? WISHLISTED_BY_SQL('$3') : "'[]'::json"} as wishlisted_by,
      ${userId ? SITE_WISHLISTED_SQL('$3') : 'false'} as site_wishlisted,
      g.blocked, g.steam_status, g.adult_flag, g.explicit_flag, g.mature_flag,
      rs.price_cents as current_low, rs.currency, rs.steam_price_cents as steam_price,
      rs.original_cents as current_original, rs.discount_pct as discount,
      rs.hist_low_cents as hist_low, rs.prev_hist_low_cents as prev_hist_low,
      (select count(*)::int from daily_prices d where d.game_id = g.id and d.region = $1) as day_count,
      rs.last_seen_at, rs.low_platform_name, rs.low_platform, rs.platform_names,
      count(*) over() as total_rows
    ${rmFromList}
    ${rmWhereStr}
    order by ${rankPrefix}${primaryOrder ?? `g.heat desc nulls last, ${rmSort}, g.id asc`}
    limit __LIST_LIMIT__ offset __LIST_OFFSET__`;
  const limitIndex = filterParams.length + 1;
  const rows = (await q(
    useReadModel
      ? compact
        ? compactRmQuery.replace('__LIST_LIMIT__', `$${limitIndex}`).replace('__LIST_OFFSET__', `$${limitIndex + 1}`)
        : `${GAME_SELECT_RM}${extra}, count(*) over() as total_rows ${rmFromFull} ${rmWhereStr} order by ${rankPrefix}${primaryOrder ?? `g.heat desc nulls last, ${rmSort}`} limit $${limitIndex} offset $${limitIndex + 1}`
      : compact
        ? compactQuery.replace('__LIST_LIMIT__', `$${limitIndex}`).replace('__LIST_OFFSET__', `$${limitIndex + 1}`)
        : `${GAME_SELECT}${extra}, count(*) over() as total_rows from games g ${userJoin(3)} ${where} order by ${rankPrefix}${primaryOrder ?? `g.heat desc nulls last, ${order}`} limit $${limitIndex} offset $${limitIndex + 1}`,
    [...filterParams, size, offset],
  )).rows;
  // DX 批：窗口列只用于 count 合并，不随行返回（响应契约不变）；空页拿不到窗口值才回落 countFallback。
  let total;
  if (rows.length) {
    total = Number(rows[0].total_rows ?? 0);
    for (const row of rows) delete row.total_rows;
  } else {
    total = await countFallback();
  }
  if (userId && !compact) {
    for (const row of rows) {
      row.interested = row.eff_interested;
      row.owned = row.eff_owned;
      delete row.eff_interested;
      delete row.eff_owned;
    }
  } else if (!userId && !compact) {
    // 游客不显示已拥有/谁拥有/愿望单（games.owned 全局值已废弃）
    for (const row of rows) {
      row.owned = false;
      row.owned_by = [];
      row.wishlisted = false;
      row.wishlisted_by = [];
      row.site_wishlisted = false;
    }
  }
  return { rows, total, page: pg, pageSize: size, pages: Math.max(1, Math.ceil(total / size)), matchedBy };
}

/**
 * /api/games/count：库内总数 + 已有价格数（前台「实时数量」）。
 * AV 批（docs/READ-MODEL.md §5.2）：priced 读读模型（distinct game_id，跨区服去重口径不变）；
 * READ_MODEL=legacy 保留旧查询。catalog 口径不变。60 秒进程内缓存在路由层（宿主闭包，每实例一份）。
 */
export async function countGamesForApi(q) {
  if (process.env.READ_MODEL === 'legacy') {
    const priced = (await q('select count(*)::int as n from (select distinct game_id from daily_prices) x')).rows[0]?.n ?? 0;
    const catalog = (await q('select count(*)::int as n from games where not deleted and not blocked')).rows[0]?.n ?? 0;
    return { priced, catalog };
  }
  // AY 批（docs/READ-MODEL.md §10）：两个计数一起缓存 60 秒，避免前台每次刷新都扫两遍全表
  const priced = (await q('select count(distinct game_id)::int as n from game_region_snapshot')).rows[0]?.n ?? 0;
  const catalog = (await q('select count(*)::int as n from games where not deleted and not blocked')).rows[0]?.n ?? 0;
  return { priced, catalog };
}

/**
 * /api/games/stamp：数据指纹（匿名可读）——前台轮询这个，变了才重新拉列表。
 * 只做低成本聚合：价格/库存变化会更新 offers.last_seen_at，新游戏/新报价会改变计数。
 */
export async function gamesStamp(q) {
  const r = await q(
    `select (select count(*)::int from games) as games,
            (select count(*)::int from offers) as offers,
            (select max(last_seen_at)::text from offers) as offers_seen`,
  );
  const row = r.rows[0] ?? {};
  return { stamp: [row.games, row.offers, row.offers_seen].join('|'), ...row };
}

/** 当前用户某游戏的提醒（详情 watch 字段回显），无则 null。 */
export async function getUserWatch(q, { userId, gameId, region = 'cn' }) {
  const r = await q(
    `select target_cents, note, created_at from watchlist
      where user_id = $1 and game_id = $2 and region = $3`,
    [userId, gameId, region],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { targetCents: row.target_cents == null ? null : Number(row.target_cents), note: row.note ?? null, createdAt: row.created_at };
}

/** 页面浏览记录（登录用户看游戏详情时写；游客不计）。 */
export async function recordView(q, { userId = null, path, appid = null }) {
  await q('insert into page_views (user_id, path, appid) values ($1, $2, $3)', [userId, path, appid]);
}

/**
 * DX 批（docs/SEARCH-FIX-PERF.md §DX）：数据世代——sync_runs 最大 id。
 * 调度器是独立进程，同步完成后无法回调 HTTP 进程；列表缓存条目记下建立时的世代，
 * 每次列表请求顺带读一次 max(id)（主键查询）即可感知「调度同步已写库」，跨进程失效。
 */
export async function dataGen(q) {
  const r = await q('select coalesce(max(id), 0)::bigint as gen from sync_runs');
  return Number(r.rows[0]?.gen ?? 0);
}

/** DLC 列表（名称升序、null 排后、appid 兜底；分页）。 */
export async function listGameDlc(q, { gameId, page = 1, pageSize = 10 }) {
  const r = await q(
    `select d.appid, d.name, d.price_cents, d.original_cents, d.discount_pct, d.currency, d.in_stock
     from game_dlc d
     where d.game_id = $1
     order by d.name asc nulls last, d.appid asc
     limit $2 offset $3`,
    [gameId, pageSize, (page - 1) * pageSize],
  );
  return r.rows.map((row) => ({
    appid: Number(row.appid),
    name: row.name ?? null,
    price_cents: row.price_cents == null ? null : Number(row.price_cents),
    original_cents: row.original_cents == null ? null : Number(row.original_cents),
    discount_pct: Number(row.discount_pct ?? 0),
    currency: row.currency ?? 'CNY',
    in_stock: row.in_stock !== false,
  }));
}

/** DLC 总数（game_dlc 行数）。 */
export async function countGameDlc(q, { gameId }) {
  const r = await q('select count(*)::int as n from game_dlc where game_id = $1', [gameId]);
  return Number(r.rows[0]?.n ?? 0);
}

/** 缺明细（name 空或 price 空）的 DLC 行数。 */
export async function countDlcMissing(q, { gameId }) {
  const r = await q(
    "select count(*)::int as n from game_dlc where game_id = $1 and (name is null or name = '' or price_cents is null)",
    [gameId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** 详情摘要：total = dlc_appids 长度；synced = 拿到过 dlc[]；filled = 已有名称+价格的条数。 */
export async function dlcSummary(q, { steamAppid }) {
  const r = await q(
    `select
       coalesce(jsonb_array_length(g.dlc_appids), 0)::int as total,
       (g.dlc_appids is not null) as synced,
       (select count(*)::int from game_dlc d where d.game_id = g.id and d.name is not null and d.name <> '' and d.price_cents is not null) as filled
     from games g where g.steam_appid = $1`,
    [steamAppid],
  );
  const row = r.rows[0];
  if (!row) return { total: 0, synced: false, filled: 0 };
  return { total: Number(row.total ?? 0), synced: row.synced === true, filled: Number(row.filled ?? 0) };
}

/** 禁用游戏：不出现在列表，但继续采集与统计。 */
export async function setGameBlocked(q, { steamAppid, gameId = null, blocked }) {
  const r = await q(
    'update games set blocked = $1, updated_at = now() where ' + (steamAppid != null ? 'steam_appid = $2' : 'id = $2') + ' returning id, name, blocked',
    [Boolean(blocked), steamAppid ?? gameId],
  );
  return r.rows[0] ?? null;
}

/** 逻辑删除 / 恢复：只改标记与时间，数据保留。支持 appid 或内部 id。 */
export async function setGameDeleted(q, { steamAppid = null, gameId = null, deleted }) {
  const params = [Boolean(deleted)];
  let where = null;
  if (steamAppid != null) {
    where = 'steam_appid = $2';
    params.push(steamAppid);
  } else if (gameId != null) {
    where = 'id = $2';
    params.push(gameId);
  } else {
    throw new Error('setGameDeleted 需要 steamAppid 或 gameId');
  }
  const r = await q(
    `update games set deleted = $1,
                       deleted_at = case when $1 then now() else null end,
                       updated_at = now()
      where ${where} returning id, name, deleted`,
    params,
  );
  return r.rows[0] ?? null;
}

/**
 * 个人标记：null 表示"不设置/保持"，写入后该字段优先于全局标记。
 * 返回该游戏的最终生效值（个人优先，回退全局）。
 */
export async function setUserGameFlag(q, { userId, gameId, interested = null, owned = null }) {
  // 语义：boolean = 设置；null/undefined = 不改动；'clear' = 显式置空（回退全局 games 标记）
  const norm = (v) => (v === 'clear' ? null : typeof v === 'boolean' ? v : null);
  const upd = [];
  if (interested === 'clear') upd.push('interested = null');
  else if (typeof interested === 'boolean') upd.push('interested = $3');
  if (owned === 'clear') upd.push('owned = null');
  else if (typeof owned === 'boolean') upd.push('owned = $4');
  const set = upd.length ? `set ${upd.join(', ')}, updated_at = now()` : 'set updated_at = now()';
  await q(
    `insert into user_game_flags (user_id, game_id, interested, owned) values ($1, $2, $3, $4)
     on conflict (user_id, game_id) do update ${set}`,
    [userId, gameId, norm(interested), norm(owned)],
  );
  const r = await q(
    `select coalesce(uf.interested, g.interested) as interested,
            ${EFFECTIVE_OWNED_SQL('$2')} as owned,
            uf.owned as user_owned
       from games g
       left join user_game_flags uf on uf.game_id = g.id and uf.user_id = $2
      where g.id = $1`,
    [gameId, userId],
  );
  return r.rows[0] ?? null;
}
