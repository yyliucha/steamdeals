// CO-5/B4-2 第十五轮（docs/DESIGN-AUDIT.md B4）：games 域（B4 #21：公开 /api/games/*）
// 路由已从 server.js 抽到本文件。主段单入口 handleGamesRoutes(ctx)：调用位置不能动，
// 必须在认证上下文（user/requireUser/requireAdmin）就绪后的主段——取本域最早路由
// /api/games/for-you 的原位置（handleAuthRoutes 之后、handleMeRoutes 之前）；
// 401/403 语义依赖该位置（原位置语义，移动 = 改契约）。
//
// 域内 16 组路由 path+method 互不重叠、与相邻其它域路由（/api/me、/api/announcements、
// /api/steam、/api/admin/*）无同 path 双匹配，集中在主段一处不改变匹配语义。
// 边界判定：只拆公开 /api/games/*——/api/admin/games*（列表/stats/merge/links/deleted）
// 归 B4 #15 admin 游戏目录，留 server.js；/api/behavior（CH 批行为上报）不属 /api/games/*
// 前缀，留 server.js。
//
// 跨模块共享状态按引用传 ctx（语义共享，勿改成拷贝）：runGated（宿主并发闸 Map，
// games-search 闸与 /api/admin/games 共用同一 gates 实例）、listCache/invalidateListCache
// （宿主 DX 批前台列表缓存，域内写操作与宿主 admin 写操作失效同一份）、
// invalidateAdminGamesCache（宿主闭包，#15 admin games 短缓存与本域删除/屏蔽/说明
// 写操作共用失效）、gameCountCache（宿主每实例闭包对象，60s count 缓存多实例互不干扰）、
// maybeFillDlcOnRead/dlcsReadThrottleMs/dlcFetchImpl（宿主闭包与测试注入，每实例
// dlcFillAttempts 节流 Map 隔离语义不变）。forYouCache（进程级 Map）只被本域使用，
// 随域移入模块级（先例：watchlist 域 watchUserFails）。
//
// 本文件只做 HTTP 输入输出编排，不写 SQL 字面量（全部走 repository / pg.js 通用 SQL）。
import * as db from '../store/pg.js';
import { baseRegion } from '../sync-regions.js';
import { yuanAmount } from '../format.js';
import { stableHash } from '../search-cache.js';

// CH 批（docs/DISCOVERY-FOR-YOU.md §3）：为你推荐 15 分钟进程级缓存（只被本域使用，
// 随域移入模块级；重启清零与原语义一致）。
const forYouCache = new Map();
// 单款价格历史 CSV 默认关闭：线上暂不对外提供（避免被试探出导出能力）；HISTORY_CSV_ENABLED=1 才放行
const historyCsvEnabled = () => process.env.HISTORY_CSV_ENABLED === '1';

/**
 * games 域主段入口：命中返回 true（已处理并结束响应），未命中返回 false（宿主继续）。
 */
export async function handleGamesRoutes(ctx) {
  const {
    path,
    req,
    res,
    url,
    q,
    logger,
    json,
    readBody,
    user,
    requireUser,
    requireAdmin,
    runGated, // 语义共享：宿主并发闸 Map（games-search 闸与 /api/admin/games 共用 gates 实例）
    listCache, // 语义共享：宿主 DX 批前台列表缓存实例（get/set 与宿主 invalidateListCache 同一份）
    invalidateListCache, // 语义共享：宿主闭包（域内标记写操作与宿主 admin 写操作失效同一缓存）
    invalidateAdminGamesCache, // 语义共享：宿主闭包（#15 admin games 短缓存与本域删除/屏蔽/说明共用失效）
    gameCountCache, // 语义共享：宿主每实例闭包对象（60s count 缓存，多实例互不干扰）
    maybeFillDlcOnRead, // 语义共享：宿主闭包（每实例 dlcFillAttempts 节流 Map 隔离语义不变）
    dlcReadThrottleMs, // 宿主测试注入：读路径回源的按游戏节流窗口
    dlcFetchImpl, // 宿主测试注入：回源 fetch 替身
  } = ctx;

  // ---- CH 批（docs/DISCOVERY-FOR-YOU.md §3）：个性化推荐 + 行为上报 ----
  if (path === '/api/games/for-you' && req.method === 'POST') {
    if (!requireUser()) return true;
    const { computeForYou } = await import('../discovery.js');
    const key = `foryou:${user.id}`;
    const cache = forYouCache.get(key);
    if (cache && Date.now() - cache.at < 15 * 60_000) return (json(res, 200, cache.body), true);
    const env = process.env;
    const result = await computeForYou(q, {
      userId: user.id,
      // EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：前台查询默认 region 读本位币区域
      region: baseRegion(),
      limit: 20,
      tasteWeight: Number(env.PERSONAL_TASTE_WEIGHT ?? 50),
      scoreWeights: {
        discount: Number(env.PERSONAL_SCORE_DISCOUNT_W ?? 40),
        review: Number(env.PERSONAL_SCORE_REVIEW_W ?? 35),
        heat: Number(env.PERSONAL_SCORE_HEAT_W ?? 25),
      },
      logger,
    });
    const body = { profile: result.profile, games: result.games?.map((g) => ({
      id: Number(g.id), steam_appid: g.steam_appid, name: g.name, name_en: g.name_en,
      min_price: g.min_price, is_free: g.is_free, because: g.because, review_score: g.review_score,
      deck_compat: g.deck_compat, steam_status: g.steam_status,
    })) ?? [] };
    forYouCache.set(key, { at: Date.now(), body });
    if (forYouCache.size > 2000) forYouCache.clear();
    return (json(res, 200, body), true);
  }

  // ---- 游戏数量（匿名可读）：库内总数 + 已有价格数，前台"实时数量"靠它 ----
  // AV 批（docs/READ-MODEL.md §5.2）：priced 改读读模型（distinct game_id，跨区服去重口径不变）
  // + 60 秒进程内缓存；READ_MODEL=legacy 保留旧查询。catalog 口径不变。
  if (path === '/api/games/count' && req.method === 'GET') {
    // AY 批（docs/READ-MODEL.md §10）：两个计数一起缓存 60 秒，避免前台每次刷新都扫两遍全表
    const now = Date.now();
    if (gameCountCache.value == null || now - gameCountCache.at > 60_000) {
      gameCountCache.value = await db.countGamesForApi(q);
      gameCountCache.at = now;
    }
    return (json(res, 200, gameCountCache.value), true);
  }

  // ---- 数据指纹（匿名可读）：前台轮询这个，变了才重新拉列表 ----
  // 只做低成本聚合：别再让每次自动刷新都跑一遍完整列表查询。
  // 说明：价格/库存变化会更新 offers.last_seen_at，新游戏/新报价会改变计数，
  // 所以这三项足够判断"列表内容是否需要重新拉"。
  if (path === '/api/games/stamp' && req.method === 'GET') {
    return (json(res, 200, await db.gamesStamp(q), { 'cache-control': 'no-store' }), true);
  }

  // ---- 游戏列表（匿名可读）：GET 保留旧接口；POST 用于游客本地标记筛选 ----
  // B1 批（docs/DESIGN-AUDIT.md B1）：GET 与 POST 搜索共用一把并发闸（≤2）
  const guestSearchPost = path === '/api/games/search' && req.method === 'POST';
  if ((path === '/api/games' && req.method === 'GET') || guestSearchPost) {
    const body = guestSearchPost ? await readBody(req, 256 * 1024) : {};
    return await runGated('games-search', 2, async () => {
    const getInput = (key) => guestSearchPost ? body?.[key] : url.searchParams.get(key);
    const oneOf = (key, allowed, fallback) => {
      const v = String(getInput(key) ?? '').trim();
      return allowed.includes(v) ? v : fallback;
    };
    const interest = oneOf('interest', ['all', 'on', 'off'], 'all');
    const ownedParam = oneOf('owned', ['exclude', 'only', 'include'], 'exclude');
    const blockedParam = oneOf('blocked', ['exclude', 'only', 'include'], 'exclude');
    const sort = oneOf('sort', ['discount', 'price', 'name', 'score', 'heat', 'release'], 'discount');
    const typeFilter = oneOf('type', ['all', 'game', 'dlc'], 'all');
    const released = oneOf('released', ['all', '30d', '1y', '3y'], 'all');
    // DA 批（docs/APP-FILTER-SERVER-SIDE.md §2）：筛选开关白名单（'1'/'true' 视为开），
    // 互斥优先级 unreleased > freeOnly > histLowOnly > discountOnly 在 gameSearch 内归一（口径对全部调用方一致）。
    const flagOn = (key) => ['1', 'true'].includes(String(getInput(key) ?? '').trim());
    const discountOnly = flagOn('discountOnly');
    const histLowOnly = flagOn('histLowOnly');
    const freeOnly = flagOn('freeOnly');
    const unreleased = flagOn('unreleased');
    // CH 批（docs/DISCOVERY-FOR-YOU.md §3）：好评率与 Deck 筛选（白名单）
    const reviewMin = Number(getInput('reviewMin') ?? 0);
    const deck = oneOf('deck', ['all', 'verified', 'playable', 'ok', 'unsupported'], 'all');
    // 成人内容展示策略（docs/STEAM-SYNC-STATUS-AND-RATING.md §5.2）：
    // hide=前台不展示（默认，由系统设置 site.adultDisplay 决定）；badge/show 不过滤
    const adult = oneOf('adult', ['hide', 'badge', 'show'], String(process.env.SITE_ADULT_DISPLAY ?? 'hide'));
    // EF 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9）：前台 rating 筛选——与后台 /api/admin/games
    // 同一口径（adult=只看 18R；mature=只看成熟；none=只看未标注；空=不过滤）。
    const rating = oneOf('rating', ['adult', 'mature', 'none'], '');
    // marks=unmarked：「全部」页签——排除用户已标 感兴趣/不感兴趣 的游戏（已拥有由 owned 参数排除）
    const marks = oneOf('marks', ['any', 'unmarked'], 'any');
    const compact = guestSearchPost || url.searchParams.get('compact') === '1';
    const keyword = String(getInput('q') ?? '').slice(0, 80);
    const pageSize = Math.min(
      Math.max(Number(guestSearchPost ? getInput('pageSize') ?? 20 : url.searchParams.get('pageSize') ?? url.searchParams.get('limit') ?? 20) || 20, 5),
      100,
    );
    const page = Math.max(1, Number(getInput('page') ?? 1) || 1);
    const maxBigintId = 9223372036854775807n;
    const normalizeIds = (value) => Array.isArray(value)
      ? [...new Set(value.slice(0, 5000).map((id) => String(id)).filter((id) => /^\d{1,19}$/.test(id) && BigInt(id) > 0n && BigInt(id) <= maxBigintId))]
      : [];
    const guestFlags = guestSearchPost && !user ? {
      interestedIds: normalizeIds(body?.guestFlags?.interestedIds),
      uninterestedIds: normalizeIds(body?.guestFlags?.uninterestedIds),
      ownedIds: normalizeIds(body?.guestFlags?.ownedIds),
      excludeIds: normalizeIds(body?.guestFlags?.excludeIds),
    } : null;
    // DX 批（docs/SEARCH-FIX-PERF.md §DX）：缓存 key = 归一化筛选参数 + region + userId 摘要。
    // 游客长 id 数组走稳定哈希（键长恒定，避免 5000 个 id 把 Map 键撑爆）。
    const region = String(getInput('region') ?? baseRegion()).slice(0, 12);
    const guestFlagsKey = guestFlags ? stableHash(JSON.stringify(guestFlags)) : '';
    const cacheKey = JSON.stringify([
      region, page, pageSize, keyword, sort, interest, ownedParam, blockedParam,
      user?.id ?? null, typeFilter, released, marks, compact, guestFlagsKey,
      adult, rating, Number.isFinite(reviewMin) && reviewMin >= 1 && reviewMin <= 9 ? reviewMin : null,
      deck, discountOnly, histLowOnly, freeOnly, unreleased,
      Boolean(user && guestSearchPost && body?.wishlist === true),
    ]);
    // DX 批：数据世代校验——调度器同步是独立进程（无法回调本进程失效缓存），
    // 每次列表请求顺带读一次 sync_runs max(id)（主键轻查询）感知跨进程写库。
    const gen = await db.dataGen(q).catch(() => null);
    const hit = listCache.get(cacheKey, gen);
    if (hit !== undefined) {
      logger?.info('search.cache_hit', { key: cacheKey.slice(0, 120), gen: gen ?? null, userId: user?.id ?? null });
      return (json(res, 200, hit), true);
    }
    const result = await db.gameSearch(q, {
      // EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：前台查询默认 region 读本位币区域
      region,
      page,
      pageSize,
      keyword,
      sort,
      interest,
      owned: ownedParam,
      blocked: blockedParam,
      userId: user?.id ?? null,
      typeFilter,
      released,
      marks,
      compact,
      guestFlags,
      adult,
      rating,
      reviewMin: Number.isFinite(reviewMin) && reviewMin >= 1 && reviewMin <= 9 ? reviewMin : null,
      deck,
      // DA 批（docs/APP-FILTER-SERVER-SIDE.md §2）：App/Web 共用筛选开关（count 与列表同条件在 gameSearch 内保证）
      discountOnly,
      histLowOnly,
      freeOnly,
      unreleased,
      // 愿望单是登录用户专属维度；游客传入的 wishlist=true 一律无效
      wishlist: Boolean(user && guestSearchPost && body?.wishlist === true),
    }, logger);
    const payload = {
      games: result.rows,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      pages: result.pages,
      sort,
      owned: ownedParam,
      interest,
      q: keyword,
      type: typeFilter,
    };
    listCache.set(cacheKey, payload, gen);
    return (json(res, 200, payload), true);
    }, (msg) => (json(res, 503, { error: msg }), true));
  }

  // ---- 单个游戏（匿名可读）----
  // ---- 单个游戏（按内部 id，用于没有 Steam appid 的杉果游戏）----
  const byIdMatch = path.match(/^\/api\/games\/by-id\/(\d+)$/);
  if (byIdMatch && req.method === 'GET') {
    const id = Number(byIdMatch[1]);
    // EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：详情默认 region 读本位币区域；
    // offers/series 跟随同一次请求的 region（原硬编码 'cn' 会与显式 region 参数打架）
    const region = String(url.searchParams.get('region') ?? baseRegion()).slice(0, 12);
    const game = await db.gameDetail(q, { gameId: id, region, userId: user?.id ?? null, adult: String(process.env.SITE_ADULT_DISPLAY ?? 'hide') });
    if (!game) return (json(res, 404, { error: '没有该游戏' }), true);
    const offers = await db.offersOfGame(q, { gameId: game.id, region });
    const series = await db.dailyMinSeries(q, { gameId: game.id, region });
    // CL 批（docs/USER-ALERTS.md §3.1）：详情回显当前用户的到价提醒（游客 null）
    const watch = user ? await db.getUserWatch(q, { userId: user.id, gameId: game.id, region: 'cn' }) : null;
    if (user) await db.recordView(q, { userId: user.id, path: `/game/id/${id}`, appid: game.steam_appid ?? null });
    return (json(res, 200, { game, offers, series, watch }), true);
  }

  const gameMatch = path.match(/^\/api\/games\/(\d+)$/);
  if (gameMatch && req.method === 'GET') {
    const appid = Number(gameMatch[1]);
    // 单款查询：不走"列表前 500 名"，否则排在后面的游戏会 404（后台编辑曾因此失败）
    // EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：详情默认 region 读本位币区域
    const region = String(url.searchParams.get('region') ?? baseRegion()).slice(0, 12);
    const game = await db.gameDetail(q, { steamAppid: appid, region, userId: user?.id ?? null, adult: String(process.env.SITE_ADULT_DISPLAY ?? 'hide') });
    if (!game) return (json(res, 404, { error: '没有该游戏' }), true);
    const offers = await db.regionOffers(q, { steamAppid: appid });
    const series = await db.dailyMinSeries(q, { gameId: game.id, region });
    // BP 批（docs/GAME-DLC.md §3.3）：详情只带摘要（DLC 上千时列表走单独接口，详情不拖慢）
    const dlc = await db.dlcSummary(q, { steamAppid: appid });
    // CL 批（docs/USER-ALERTS.md §3.1）：详情回显当前用户的到价提醒（游客 null）
    const watch = user ? await db.getUserWatch(q, { userId: user.id, gameId: game.id, region: 'cn' }) : null;
    if (user) await db.recordView(q, { userId: user.id, path: `/game/${appid}`, appid });
    return (json(res, 200, { game, offers, series, dlc, watch }), true);
  }

  // ---- BP 批（docs/GAME-DLC.md §3.3）：DLC 列表（公开）----
  const dlcMatch = path.match(/^\/api\/games\/(\d+)\/dlc$/);
  if (dlcMatch && req.method === 'GET') {
    const appid = Number(dlcMatch[1]);
    const game = await db.gameDetail(q, { steamAppid: appid });
    if (!game) return (json(res, 404, { error: '没有该游戏' }), true);
    // 非 Steam 游戏（无 steam_appid）：空集，前端不显示 DLC 区块
    if (!game.steam_appid) return (json(res, 200, { total: 0, page: 1, pageSize: 10, synced: false, items: [] }), true);
    const pageRaw = Number(url.searchParams.get('page') ?? 1);
    const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
    const psRaw = Number(url.searchParams.get('pageSize') ?? 10);
    const pageSize = Math.min(Math.max(Number.isInteger(psRaw) && psRaw > 0 ? psRaw : 10, 1), 50);
    // 读路径回源：缺明细且该游戏上次回源 >10 分钟 → 最多 3 批 GetItems（失败/429 降级，不 5xx）
    try {
      await maybeFillDlcOnRead({ gameId: game.id, appid, throttleMs: dlcReadThrottleMs, fetchImpl: dlcFetchImpl });
    } catch (err) {
      logger?.warn?.('api.dlc_read_fill_failed', { appid, message: String(err?.message ?? err).slice(0, 160) });
    }
    const missing = await db.countDlcMissing(q, { gameId: game.id });
    const total = await db.countGameDlc(q, { gameId: game.id });
    const summary = await db.dlcSummary(q, { steamAppid: appid });
    const items = await db.listGameDlc(q, { gameId: game.id, page, pageSize });
    json(res, 200, {
      total,
      page,
      pageSize,
      // 拿到过 dlc[]（dlc_appids 非空）且没有缺明细的行 = 完整；从未同步过 = false（前端不显示区块）
      synced: summary.synced && missing === 0,
      items: items.map((d) => ({
        appid: d.appid,
        // 名称缺失回退 DLC #<appid>（回源失败时的降级展示）
        name: d.name || `DLC #${d.appid}`,
        price_cents: d.price_cents,
        original_cents: d.original_cents,
        discount_pct: d.discount_pct,
        currency: d.currency,
        in_stock: d.in_stock,
        buy_url: `https://store.steampowered.com/app/${d.appid}/`,
      })),
    });
    return true;
  }

  // ---- 登录用户：个人标记（个人优先，未标记回退全局标记）----
  const flagsByAppid = path.match(/^\/api\/games\/(\d+)\/flags$/);
  const flagsById = path.match(/^\/api\/games\/id\/(\d+)\/flags$/);
  if ((flagsByAppid || flagsById) && req.method === 'POST') {
    if (!requireUser()) return true;
    const body = await readBody(req);
    let gameId = null;
    if (flagsByAppid) {
      const found = await db.gameDetail(q, { steamAppid: Number(flagsByAppid[1]) });
      if (!found) return (json(res, 404, { error: '没有该游戏' }), true);
      gameId = found.id;
    } else {
      gameId = Number(flagsById[1]);
    }
    // 'clear' = 显式清除个人标记（回退全局）；boolean = 设置；其余 = 不改动
    const pick = (v) => (v === 'clear' ? 'clear' : typeof v === 'boolean' ? v : null);
    const flags = await db.setUserGameFlag(q, {
      userId: user.id,
      gameId,
      interested: pick(body.interested),
      owned: pick(body.owned),
    });
    if (!flags) return (json(res, 404, { error: '没有该游戏' }), true);
    logger?.info('api.user_flag', { userId: user.id, gameId, interested: flags.interested, owned: flags.owned });
    invalidateListCache(); // DX 批：个人标记直接影响 interest/owned 过滤与列值，前台缓存立即失效
    return (json(res, 200, { flags }), true);
  }

  // ---- 管理员：标记兴趣、看用户 ----
  const interestMatch = path.match(/^\/api\/games\/(\d+)\/interest$/);
  if (interestMatch && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const appid = Number(interestMatch[1]);
    const row = await db.setInterest(q, { steamAppid: appid, interested: Boolean(body.interested) });
    if (!row) return (json(res, 404, { error: '没有该游戏' }), true);
    logger?.info('api.interest', { appid, interested: row.interested, by: user.username });
    invalidateListCache(); // DX 批：全局兴趣标记影响列表 interest 列，前台缓存立即失效
    return (json(res, 200, { game: row }), true);
  }

  // ---- 管理员：标记已拥有 ----
  const ownedMatch = path.match(/^\/api\/games\/(\d+)\/owned$/);
  if (ownedMatch && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const appid = Number(ownedMatch[1]);
    const row = await db.setOwned(q, { steamAppid: appid, owned: Boolean(body.owned) });
    if (!row) return (json(res, 404, { error: '没有该游戏' }), true);
    logger?.info('api.owned', { appid, owned: row.owned, by: user.username });
    invalidateListCache(); // DX 批：全局拥有标记影响列表 owned 列，前台缓存立即失效
    return (json(res, 200, { game: row }), true);
  }

  // ---- 管理员：按内部 id 标记（杉果等没有 Steam appid 的游戏）----
  const byIdInterest = path.match(/^\/api\/games\/id\/(\d+)\/interest$/);
  if (byIdInterest && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const gameId = Number(byIdInterest[1]);
    const row = await db.setInterest(q, { gameId, interested: Boolean(body.interested) });
    if (!row) return (json(res, 404, { error: '没有该游戏' }), true);
    logger?.info('api.interest_by_id', { gameId, interested: row.interested, by: user.username });
    invalidateListCache(); // DX 批：同全局兴趣标记，前台缓存立即失效
    return (json(res, 200, { game: row }), true);
  }

  const byIdOwned = path.match(/^\/api\/games\/id\/(\d+)\/owned$/);
  if (byIdOwned && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const gameId = Number(byIdOwned[1]);
    const row = await db.setOwned(q, { gameId, owned: Boolean(body.owned) });
    if (!row) return (json(res, 404, { error: '没有该游戏' }), true);
    logger?.info('api.owned_by_id', { gameId, owned: row.owned, by: user.username });
    invalidateListCache(); // DX 批：同全局拥有标记，前台缓存立即失效
    return (json(res, 200, { game: row }), true);
  }

  // ---- 单款价格历史 CSV（默认关闭，见 historyCsvEnabled）----
  const historyCsv = path.match(/^\/api\/games\/(\d+)\/history\.csv$/);
  if (historyCsv && req.method === 'GET') {
    if (!historyCsvEnabled()) return (json(res, 404, { error: 'not found' }), true);
    const appid = Number(historyCsv[1]);
    const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 90) || 90, 1), 3650);
    const game = await db.gameDetail(q, { steamAppid: appid });
    if (!game) return (json(res, 404, { error: '没有该游戏' }), true);
    const cutoff = Date.now() - days * 86400000;
    // EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：CSV 区域跟随本位币区
    const series = (await db.dailyMinSeries(q, { gameId: game.id, region: baseRegion() })).filter(
      (p) => new Date(p.day).getTime() >= cutoff,
    );
    const lines = ['date,price_cents,price,currency'];
    for (const p of series) lines.push([p.day, p.price_cents, yuanAmount(p.price_cents), p.currency].join(','));
    const body = '\uFEFF' + lines.join('\r\n');
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="history-' + appid + '.csv"',
      'cache-control': 'no-store',
    });
    res.end(body);
    return true;
  }

  // ---- 管理员：逻辑删除 / 恢复（按 appid 或内部 id）----
  const delByAppid = path.match(/^\/api\/games\/(\d+)\/deleted$/);
  const delById = path.match(/^\/api\/games\/id\/(\d+)\/deleted$/);
  if ((delByAppid || delById) && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const target = delByAppid ? { steamAppid: Number(delByAppid[1]) } : { gameId: Number(delById[1]) };
    const row = await db.setGameDeleted(q, { ...target, deleted: body.deleted !== false });
    if (!row) return (json(res, 404, { error: '没有该游戏' }), true);
    logger?.info('api.game_deleted', { ...target, deleted: row.deleted, by: user.username });
    invalidateAdminGamesCache();
    invalidateListCache(); // DX 批：删除/恢复改变列表内容，前台缓存立即失效
    return (json(res, 200, { game: row }), true);
  }

  // ---- 管理员：禁用游戏 / 编辑说明 / 触发 Steam 同步 ----
  const blockMatch = path.match(/^\/api\/games\/(\d+)\/blocked$/);
  if (blockMatch && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const row = await db.setGameBlocked(q, { steamAppid: Number(blockMatch[1]), blocked: Boolean(body.blocked) });
    if (!row) return (json(res, 404, { error: '没有该游戏' }), true);
    logger?.info('api.game_blocked', { appid: Number(blockMatch[1]), blocked: row.blocked, by: user.username });
    invalidateAdminGamesCache();
    invalidateListCache(); // DX 批：屏蔽/取消屏蔽改变列表内容，前台缓存立即失效
    return (json(res, 200, { game: row }), true);
  }

  const descMatch = path.match(/^\/api\/games\/(\d+)\/description$/);
  if (descMatch && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const row = await db.setGameDescription(q, {
      steamAppid: Number(descMatch[1]),
      description: String(body.description ?? ''),
      overwrite: Boolean(body.overwrite),
    });
    if (!row) return (json(res, 404, { error: '没有该游戏' }), true);
    logger?.info('api.game_description', { appid: Number(descMatch[1]), by: user.username });
    invalidateAdminGamesCache();
    return (json(res, 200, { game: row }), true);
  }

  return false;
}
