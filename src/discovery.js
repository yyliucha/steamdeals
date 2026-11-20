// CH 批（docs/DISCOVERY-FOR-YOU.md）：Steam Deck 认证 + 好评率采集 与 个性化「为你推荐」。
// 借鉴 Drakey83/steam-deals 的 A/B/C 三件能力；采集走 Steam 商店搜索 API（同域共享 200 次/5 分钟配额），
// 「为你推荐」是本地计算（零外部请求）。
import { fetchJson } from './http.js';
import * as db from './store/pg.js';
import { bestMatch } from './match.js';
import { contentRegion, baseRegion } from './sync-regions.js';

const SEARCH_URL = 'https://store.steampowered.com/api/search/results';

/** 解析搜索 API 一行：deck_compat 0/1/2/3、review_score 1-9（缺失保持 null）。 */
export function parseQualityRow(item = {}) {
  const deck = [0, 1, 2, 3].includes(Number(item.deck_compat)) ? Number(item.deck_compat) : null;
  const score = Number(item.review_score);
  return {
    appid: Number(item.appid),
    deckCompat: deck,
    reviewScore: Number.isFinite(score) && score >= 1 && score <= 9 ? score : null,
    reviewScoreDesc: item.review_desc ? String(item.review_desc).slice(0, 100) : null,
    reviewTotal: Number(item.review_total) || null,
  };
}

/**
 * 一轮采集：翻页 search/results（sort_by=Reviews_DESC，每页 50，只写库里已存在的 appid）+
 * 名称回退（热门未覆盖队列逐个名称搜索 → match.js 打分 ≥0.86 采纳，否则 nomatch 7 天退避）。
 * fetchImpl 可注入（测试）。返回统计，日志 discovery.round_done。
 */
export async function runDiscoveryRound({ q, pages = 100, fallbackLimit = 100, logger = null, fetchImpl = null, rateMs = 1200 }) {
  const doFetch = fetchImpl ?? ((u, opts) => fetchJson(u, { logger, label: 'discovery.search', ...opts }));
  let matched = 0;
  let requests = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // EH/EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §10/§11）：搜索走内容区
  // （默认 us——国区商店不显示的游戏也能进 Deck 认证/好评率候选集；价格口径与此无关）。
  const cc = contentRegion();

  // ① 翻页主路径
  for (let page = 1; page <= Math.max(1, Number(pages)); page += 1) {
    let rows = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { json } = await doFetch(`${SEARCH_URL}?sort_by=Reviews_DESC&count=50&start=${(page - 1) * 50}&cc=${cc}`, {});
      requests += 1;
      if (Array.isArray(json?.items)) {
        rows = json.items;
        break;
      }
      await sleep(500);
    }
    if (!rows?.length) break; // 翻页到头
    const appids = rows.map((r) => Number(r.appid)).filter(Number.isFinite);
    if (!appids.length) continue;
    const existing = (await q('select steam_appid from games where steam_appid = any($1::int[])', [appids])).rows.map((r) => Number(r.steam_appid));
    const byAppid = new Map(rows.map((r) => [Number(r.appid), r]));
    for (const appid of existing) {
      const parsed = parseQualityRow(byAppid.get(appid) ?? {});
      await q(
        `update games set deck_compat = $2, review_score = $3, review_score_desc = $4, review_total = $5, quality_checked_at = now()
          where steam_appid = $1`,
        [appid, parsed.deckCompat, parsed.reviewScore, parsed.reviewScoreDesc, parsed.reviewTotal],
      );
      matched += 1;
    }
    await sleep(Number(rateMs));
  }

  // ② 名称回退：热门 + 未覆盖队列（沿用 game_source_sync 状态机）
  const fallback = (
    await q(
      `select g.id, g.steam_appid, g.name, g.name_en, g.heat, g.is_free
         from games g
         left join game_source_sync s on s.game_id = g.id and s.platform_code = 'steam-quality'
        where g.steam_appid is not null and g.deck_compat is null
          and not g.deleted and not g.adult_flag
          and (s.game_id is null
               or (s.status = 'nomatch' and s.last_tried_at < now() - interval '7 days')
               or (s.status = 'failed' and s.last_tried_at < now() - make_interval(days => least(30, power(2, s.fail_count)::int))))
        order by (g.heat is not null) desc, g.heat desc nulls last, g.id
        limit $1`,
      [Number(fallbackLimit)],
    )
  ).rows;
  let fallbackRequests = 0;
  let fallbackMatched = 0;
  for (const g of fallback) {
    const rawTerm = (g.name_en || g.name).trim().slice(0, 80);
    const term = encodeURIComponent(rawTerm);
    let json = null;
    try {
      ({ json } = await doFetch(`${SEARCH_URL}?term=${term}&cc=${cc}`, {}));
      fallbackRequests += 1;
    } catch (err) {
      logger?.warn?.('discovery.fallback_failed', { appid: g.steam_appid, message: String(err?.message ?? err).slice(0, 120) });
      await db.sourceSyncMark(q, { gameId: g.id, platform: 'steam-quality', status: 'failed', externalId: String(g.steam_appid), ok: false, error: String(err?.message ?? '').slice(0, 200) });
      continue;
    }
    const items = Array.isArray(json?.items) ? json.items : [];
    let best = null;
    for (const item of items) {
      const cand = { name: item.name ?? null, nameEn: null, steam_appid: Number(item.appid) };
      const hit = bestMatch(rawTerm, [cand], { minScore: 0.86 });
      if (hit && hit.candidate.steam_appid === Number(g.steam_appid)) {
        best = parseQualityRow(item);
        break;
      }
    }
    if (best) {
      await q(
        'update games set deck_compat = $2, review_score = $3, review_score_desc = $4, review_total = $5, quality_checked_at = now() where steam_appid = $1',
        [g.steam_appid, best.deckCompat, best.reviewScore, best.reviewScoreDesc, best.reviewTotal],
      );
      await db.sourceSyncMark(q, { gameId: g.id, platform: 'steam-quality', status: 'matched', externalId: String(g.steam_appid), ok: true });
      fallbackMatched += 1;
      logger?.info?.('discovery.fallback_matched', { appid: g.steam_appid });
    } else {
      await db.sourceSyncMark(q, { gameId: g.id, platform: 'steam-quality', status: 'nomatch', externalId: String(g.steam_appid), ok: false });
      logger?.info?.('discovery.fallback_nomatch', { appid: g.steam_appid });
    }
    await sleep(Number(rateMs));
  }

  logger?.info?.('discovery.round_done', { pages: Number(pages), matched, fallbackRequests, fallbackMatched, requests, contentRegion: cc });
  return { matched, fallbackRequests, fallbackMatched, requests };
}

const BEHAVIOR_WEIGHTS = { detail: 2, price_history: 2, dlc: 2, buy_click: 4, wishlist: 3, search: 1 };

/**
 * 「为你推荐」：本地画像计算（零外部请求）。
 * 画像 = 绑定 Steam 库 playtime 加权（log 权重、近 2 周加倍）∪ 标记三态 ∪ 行为权重；
 * 候选排除已拥有/不感兴趣/成人（hide 口径），按 tags 预过滤 + 标签相似度与综合分混合打分，
 * 每条带 because（贡献最大的已拥有游戏名）。每用户实例级缓存 15 分钟由调用方处理。
 */
export async function computeForYou(q, { userId, region = baseRegion(), limit = 20, tasteWeight = 50, scoreWeights = { discount: 40, review: 35, heat: 25 }, logger = null }) {
  const profile = (await q('select 1 from steam_accounts where user_id = $1 limit 1', [userId])).rows.length > 0;
  if (!profile) return { profile: false, games: [] };

  const taste = Number(tasteWeight) / 100;
  const dW = Number(scoreWeights.discount) / 100;
  const rW = Number(scoreWeights.review) / 100;
  const hW = Number(scoreWeights.heat) / 100;

  // 画像：Steam 库 playtime（近 2 周加倍 + log）+ 标记 + 行为
  const tagVotes = new Map(); // tag -> 权重
  const becauseOf = new Map(); // game_id -> { name, contribution }
  const addVotes = (tags, weight, name, gameId) => {
    for (const tag of tags ?? []) {
      tagVotes.set(tag, (tagVotes.get(tag) ?? 0) + weight);
      const prev = becauseOf.get(gameId) ?? { name, contribution: 0 };
      prev.contribution += weight;
      becauseOf.set(gameId, prev);
    }
  };
  const owned = (
    await q(
      `select g.id, g.name, g.tags, sg.playtime_minutes, sg.last_played_at
         from steam_accounts a
         join steam_games sg on sg.steam_account_id = a.id
         join games g on g.steam_appid = sg.appid
        where a.user_id = $1 and g.tags is not null and not g.deleted`,
      [userId],
    )
  ).rows;
  for (const row of owned) {
    const mins = Number(row.playtime_minutes ?? 0);
    if (mins <= 0) continue;
    let w = Math.log1p(mins) * 2;
    if (row.last_played_at && Date.now() - new Date(row.last_played_at).getTime() < 14 * 86400_000) w *= 2;
    addVotes(row.tags, w, row.name, Number(row.id));
  }
  const flags = (
    await q(
      `select f.game_id, f.interested, f.owned as flag_owned, (w.id is not null) as wishlisted
         from user_game_flags f
         left join watchlist w on w.user_id = f.user_id and w.game_id = f.game_id
        where f.user_id = $1`,
      [userId],
    )
  ).rows;
  const flagGames = (await q('select id, name, tags from games where id = any($1::int[])', [flags.map((f) => Number(f.game_id))])).rows;
  for (const f of flags) {
    const g = flagGames.find((x) => Number(x.id) === Number(f.game_id));
    if (!g?.tags) continue;
    const w = (f.interested === false ? -1 : 0) + (f.interested === true ? 2 : 0) + (f.wishlisted ? 1 : 0) + (f.flag_owned ? 2 : 0);
    if (w !== 0) addVotes(g.tags, w, g.name, Number(g.id));
  }
  const behaviors = (await q('select b.game_id, b.action, b.count, g.tags from user_behaviors b left join games g on g.id = b.game_id where b.user_id = $1', [userId])).rows;
  for (const b of behaviors) {
    const w = (BEHAVIOR_WEIGHTS[b.action] ?? 1) * Math.min(Number(b.count), 10);
    if (w > 0 && b.tags) addVotes(b.tags, w, '你的行为偏好', -1);
  }

  const topTags = [...tagVotes.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t]) => t);
  if (!topTags.length) return { profile: true, games: [] };

  const excludedOwned = new Set(flags.filter((f) => f.flag_owned).map((f) => Number(f.game_id)));
  const candidates = (
    await q(
      `select g.id, g.steam_appid, g.name, g.name_en, g.tags, g.heat, g.review_score, g.is_free, g.steam_status,
              (select min(price_cents) from offers o where o.game_id = g.id and o.region = $3 and o.in_stock) as min_price,
              (select min(min_price_cents) from daily_prices dp where dp.game_id = g.id) as hist_min
         from games g
        where not g.deleted and not g.blocked and not g.adult_flag
          and g.tags && $1::text[]
          and g.id <> all($2::int[])
        limit 400`,
      [topTags, [...excludedOwned]],
      region,
    )
  ).rows;

  const scored = candidates.map((g) => {
    const ownedMatch = [...becauseOf.values()].sort((a, b) => b.contribution - a.contribution)[0];
    const overlap = (g.tags ?? []).reduce((s, t) => s + (tagVotes.get(t) ?? 0), 0);
    const normOverlap = overlap / Math.max(1, topTags.length);
    const discountScore = g.min_price != null && g.hist_min != null && g.hist_min > 0 ? Math.min(100, ((g.hist_min - g.min_price) / g.hist_min) * 100) : 0;
    const reviewScore = ((g.review_score ?? 5) / 9) * 100;
    const heatScore = Math.min(100, (Number(g.heat ?? 0) || 0) * 100);
    const composite = dW * discountScore + rW * reviewScore + hW * heatScore;
    const score = taste * normOverlap * 100 + (1 - taste) * composite;
    return { ...g, score, because: ownedMatch && ownedMatch.contribution > 0 ? ownedMatch.name : null };
  });

  scored.sort((a, b) => b.score - a.score);
  logger?.info?.('personal.for_you_served', { userId, candidates: candidates.length, served: Math.min(limit, scored.length) });
  return { profile: true, games: scored.slice(0, limit) };
}

export function behaviorActionWeight(action) {
  return BEHAVIOR_WEIGHTS[action] ?? null;
}
