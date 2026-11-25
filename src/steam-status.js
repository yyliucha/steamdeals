// Steam 状态与分级落库的共用函数（docs/STEAM-SYNC-STATUS-AND-RATING.md §14.3）：
// 「一次 appdetails 响应 → 状态判定 + 分级派生 + 写库」收敛成一个函数，
// cmdBackfill（appdetails 回退路径）与 cmdSteamStatus 两条路径共用，判定口径唯一。
// AB 批（docs/STEAM-STATUS-FIX.md）：runSteamStatusRound 把 steam-status 一轮收敛到这里，
// fetchJsonImpl 可注入，测试能离线验证"取值 .json / 不写库 / 429 收轮"。
import * as db from './store/pg.js';
import { ingestOffers } from './ingest.js';
import { classifySteamStatus } from './adapters/steam.js';
import { classifyContentRating, normalizeOfficial, fetchMetadata } from './adapters/steam-meta.js';
import { contentRegion, baseRegion, baseCurrency } from './sync-regions.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 从归一化 meta（normalizeOfficial 输出）还原 classifySteamStatus 需要的条目形状。
 * 拿不到判定依据（既无价格/免费/未发售信息）时返回 null——调用方据此不写状态、不推游标。
 */
export function entryFromMeta(item) {
  if (!item) return null;
  if (item.isFree === true) return { success: true, data: { is_free: true } };
  if (item.priceOverview) return { success: true, data: { price_overview: item.priceOverview } };
  if (item.comingSoon) return { success: true, data: { release_date: { coming_soon: true } } };
  return null;
}

/**
 * 写入语义（§14.3，关键）：
 * - 能确定 steam_status（有价格/免费/未发售/锁区…）→ 状态 + 分级 + steam_checked_at 一起写；
 * - 拿不到状态 → 只写分级（有值才写），**不写 steam_checked_at**——游标不推进，留给 steam-status 判定；
 * - 分级字段本次没拿到（null/空）→ 不覆盖已有值（db.setSteamStatus 用 coalesce 处理；
 *   空数组/空对象与 null 同等对待——coalesce 只挡 null，空数组会把已有分级清空，AB 批 §2.5-5）。
 *
 * 返回 { status, rating, wroteStatus, ratingWritten }：status 为 null 表示本次判定不了；
 * wroteStatus 只有「状态真写进库且 UPDATE 命中行」才为 true（AB 批 §3-B：写入不可静默）；
 * ratingWritten（EF 批 §9）：分级 UPDATE 命中行（与状态无关——rating-backfill 只写分级靠它计数）。
 */
export async function applySteamDetails(q, { appid, cnEntry = null, hkEntry = null, meta = null, logger = null, price = null }) {
  // BP 批（docs/GAME-DLC.md §3.2）：同一次 appdetails 响应里顺带写 dlc_appids + game_dlc 占位（零额外请求）。
  // GetItems 路径的 meta 没有 dlcAppIds → 不写（不得清空已有值）。写失败不影响状态判定。
  let dlcWritten = null;
  if (meta?.dlcAppIds != null) {
    try {
      dlcWritten = await db.writeDlcAppids(q, { steamAppid: appid, dlcAppIds: meta.dlcAppIds });
      if (dlcWritten.changed) logger?.info?.('steam.status.dlc_written', { appid, dlc: dlcWritten.dlc });
    } catch (err) {
      logger?.warn?.('steam.status.dlc_write_failed', { appid, message: String(err?.message ?? err).slice(0, 160) });
    }
  }
  // 没有任何 appdetails 条目 → 判定不了状态（如只有 GetItems、字段不全的路径）
  const status = cnEntry == null && hkEntry == null ? null : classifySteamStatus(cnEntry, hkEntry);
  const requiredAge = meta?.requiredAge ?? null;
  const descriptorIds = Array.isArray(meta?.contentDescriptors) ? meta.contentDescriptors : [];
  const ratings = meta?.ageRatings && typeof meta.ageRatings === 'object' ? meta.ageRatings : {};
  const hasRating =
    requiredAge != null || descriptorIds.length > 0 || Object.keys(ratings).length > 0;
  const rating = classifyContentRating({ requiredAge, descriptorIds, ratings });

  // BC 批（docs/IMAGE-COVERAGE.md §3.1）：同一次 appdetails 响应里已带 header_image，顺带补齐（零额外请求）
  let headerImageFilled = false;
  if (meta?.headerImage) {
    try {
      const filled = await db.fillHeaderImage(q, { steamAppid: appid, url: String(meta.headerImage) });
      headerImageFilled = (filled?.rowCount ?? 0) > 0;
      if (headerImageFilled) logger?.info?.('steam-status.header_image_filled', { appid });
    } catch (err) {
      logger?.warn?.('steam-status.header_image_failed', { appid, message: String(err?.message ?? err).slice(0, 160) });
    }
  }
  if (status == null && !hasRating) {
    // 什么都没拿到：不写库（GetItems 且无分级字段的路径）
    return { status, rating, wroteStatus: false, offerWritten: false, headerImageFilled, dlcWritten, ratingWritten: false };
  }
  const row = await db.setSteamStatus(q, {
    steamAppid: appid,
    status,
    requiredAge,
    contentDescriptors: descriptorIds.length > 0 ? descriptorIds : null,
    ageRatings: Object.keys(ratings).length > 0 ? ratings : null,
    adultFlag: hasRating ? rating.adultFlag : null,
    matureFlag: hasRating ? rating.matureFlag : null,
  });
  // setSteamStatus 未命中（appid 不在库）返回 null：不得算写成功（AB 批 §3-B）
  const wroteStatus = status != null && row != null;
  // EF 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9）：分级字段的 UPDATE 命中行——与状态无关，
  // rating-backfill（只写分级）靠它统计真实写入数。
  const ratingWritten = row != null;
  // AC-2（docs/SYNC-FAILURE-MODES.md AC8）：判定 ok（本位币区有价）时顺带写首次 offer——
  // 与状态共用同一次 appdetails 响应，不额外消耗配额；免费/锁区/未发售不写价。
  // EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：调用方必须显式传 price={region,currency}
  // 说明「本次响应的价格口径」。steam-status 只有内容区=本位币区时才传（两区不同时响应里是
  // 内容区货币价，写进本位币 offer 会把美元价混进国区——价格口径交给 steam-prices/backfill）；
  // 不传 price 一律不写价（rating-backfill 路径与锁区判定天然走这里）。
  let offerWritten = false;
  if (wroteStatus && status === 'ok' && price && meta?.priceOverview && meta.priceOverview.final != null) {
    const offer = {
      platformCode: 'steam',
      platformProductId: String(appid),
      steamAppid: Number(appid),
      title: meta.nameZh ?? meta.nameEn ?? String(appid),
      productType: 'official_direct',
      region: price.region,
      currency: meta.priceOverview.currency ?? price.currency,
      priceCents: Math.round(meta.priceOverview.final),
      originalCents: Math.round(meta.priceOverview.initial ?? meta.priceOverview.final),
      discountPct: Number(meta.priceOverview.discountPercent ?? 0),
      inStock: true,
      buyUrl: `https://store.steampowered.com/app/${appid}/`,
      meta: {},
    };
    try {
      const st = await ingestOffers(
        { query: q },
        { platform: { code: 'steam', name: 'Steam 国区', kind: 'official' }, offers: [offer], logger },
      );
      offerWritten = (st.inserted ?? 0) + (st.updated ?? 0) > 0;
      if (offerWritten) logger?.info?.('steam-status.offer_written', { appid, priceCents: offer.priceCents });
    } catch (err) {
      // offer 写失败不影响状态与分级结果；下轮 steam-prices/backfill 仍会再试
      logger?.warn?.('steam-status.offer_failed', { appid, message: String(err?.message ?? err).slice(0, 160) });
    }
  }
  return { status, rating, wroteStatus, ratingWritten, offerWritten, headerImageFilled, dlcWritten };
}

/**
 * steam-status 一轮（AB 批 docs/STEAM-STATUS-FIX.md §3）：
 * - A 取 appdetails 条目用 `res.json[appid]`（fetchJson 返回 { ...res, json }）；
 * - B 写入不可静默：`wrote` 只统计真的写进库的行；判定不了记 `steam-status.skip_write`（debug）、
 *   写库未命中记 `steam-status.write_miss`（warn），`counts` 只统计已知状态；
 * - C 限速按「每个请求」计（内容区/hk 之后各 sleep 一次，非 429 的 4xx 异常路径也 sleep）；
 *   撞 429 立即结束本轮（不睡 30 分钟空转），下轮续跑；
 * - 候选按 steam_checked_at 游标选取；判定不了/失败不推游标，下轮重试。
 * - EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：状态/分级请求读 sync.contentRegion
 *   （默认 us——国区商店隐藏成人/锁区内容）；失败兜底仍补 cc=hk 判定锁区；
 *   顺带写价仅当 contentRegion === baseRegion（防内容区货币价混进本位币 offer）。
 *
 * fetchJsonImpl 可注入（测试离线验证）；返回 { wrote, skipped, failed, requests, counts, aborted429, attempted }。
 */
export async function runSteamStatusRound(
  q,
  {
    limit = 6000,
    batch = 30,
    rateMs = 1500,
    fetchJsonImpl = null,
    logger = null,
    onProgress = null,
    // BP 批（docs/GAME-DLC.md §3.2/§3.5）：收尾补 DLC 明细（不新增调度任务，就挂在本轮末尾）
    steamKey = process.env.STEAM_API_KEY ?? null,
    dlcFillGames = Number(process.env.STEAM_DLC_FILL_GAMES ?? 50),
    dlcFillBatches = Number(process.env.STEAM_DLC_FILL_BATCH ?? 30),
    dlcFetchImpl = null,
  } = {},
) {
  const fetchUse = fetchJsonImpl ?? (await import('./http.js')).fetchJson;
  const size = Math.min(Math.max(Number(limit) || 6000, 1), 200000);
  const step = Math.min(Math.max(Number(batch) || 30, 1), 100);
  let attempted = 0;
  let wrote = 0;
  // BC 批（docs/IMAGE-COVERAGE.md §3.1）：顺带补齐 header_image 的条数（零额外请求）
  let headerFilled = 0;
  // BP 批（docs/GAME-DLC.md §3.2）：本轮顺带写入 dlc_appids 的游戏数（零额外请求）
  let dlcWritten = 0;
  let skipped = 0;
  let failed = 0;
  let requests = 0;
  let offers = 0;
  let aborted429 = false;
  const counts = { ok: 0, free: 0, coming_soon: 0, region_locked: 0, no_price: 0, not_found: 0 };

  while (attempted < size) {
    const rows = await db.listSteamStatusCandidates(q, { limit: Math.min(step, size - attempted) });
    if (!rows.length) break;
    // EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：内容区=本位币区时，状态判定顺带写的
    // offer 才是本位币价（contentRegion 默认 us ≠ baseRegion 默认 cn → 默认不写，防美元价混进国区）。
    const cRegion = contentRegion();
    const bRegion = baseRegion();
    const offerPrice = cRegion === bRegion ? { region: bRegion, currency: baseCurrency() } : null;
    for (const row of rows) {
      const appid = row.steamAppid;
      let cnEntry = null;
      let hkEntry = null;
      let meta = null;
      try {
        const cn = await fetchUse(
          `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${cRegion}&l=schinese`,
          { logger, label: 'steam.status', timeoutMs: 30000, retries: 1 },
        );
        requests += 1;
        if (rateMs) await sleep(rateMs); // AB 批 §3-C：限速按“每个请求”计
        cnEntry = cn?.json?.[String(appid)] ?? null; // AB 批 §3-A：fetchJson 返回 { ...res, json }
        let data = cnEntry?.success === true ? cnEntry.data : null;
        if (!data) {
          // 内容区不可售/下架：补一次港区判定锁区（有价/免费=锁区）
          const hk = await fetchUse(
            `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=hk&l=schinese`,
            { logger, label: 'steam.status.hk', timeoutMs: 30000, retries: 1 },
          );
          requests += 1;
          if (rateMs) await sleep(rateMs);
          hkEntry = hk?.json?.[String(appid)] ?? null;
          data = hkEntry?.success === true ? hkEntry.data : null;
        }
        // 分级字段与状态来自同一响应；锁区时用港区数据（内容分级与区服无关）。
        meta = data ? normalizeOfficial(appid, data) : null;
      } catch (err) {
        // 网络/限流失败：不写 steam_checked_at，下轮会被重新选中（续跑）
        failed += 1;
        attempted += 1;
        logger?.warn?.('steam-status.failed', { appid, message: String(err.message ?? err).slice(0, 160) });
        if (err.status && err.status >= 400 && err.status < 500) {
          if (err.status === 429) {
            // FP 批 P2（docs/SYNC-HARDENING.md §2）：429 收轮——该 appid 入补跑队列（下一轮优先补）
            try {
              await db.record429Appids(q, [appid]);
            } catch {
              /* 队列写入失败不影响收轮 */
            }
            aborted429 = true;
            break; // AB 批 §3-C：429 立即收轮，交给下轮续跑
          }
          if (rateMs) await sleep(rateMs); // 非 429 的 4xx 也不允许无间隔连发（AB 批 §2.5-2）
          continue;
        }
        if (rateMs) await sleep(rateMs);
        continue;
      }
      const outcome = await applySteamDetails(q, { appid, cnEntry, hkEntry, meta, logger, price: offerPrice });
      attempted += 1;
      if (outcome.headerImageFilled) headerFilled += 1;
      if (outcome.dlcWritten?.changed) dlcWritten += 1;
      if (outcome.wroteStatus) {
        wrote += 1;
        if (outcome.status) counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
        if (outcome.offerWritten) offers += 1;
        // FP 批 P2：判定成功的 appid 从 429 补跑队列清除（收敛）
        try {
          await db.clear429Appids(q, [appid]);
        } catch {
          /* 队列清理失败不影响主流程 */
        }
      } else {
        skipped += 1;
        if (outcome.status == null) {
          logger?.debug?.('steam-status.skip_write', { appid, reason: 'status_unknown' });
        } else {
          logger?.warn?.('steam-status.write_miss', { appid, status: outcome.status });
        }
      }
      onProgress?.({ attempted, wrote, skipped, failed, counts, offers, headerFilled });
    }
    if (aborted429) break;
  }
  if (headerFilled > 0) logger?.info?.('steam-status.header_image_done', { filled: headerFilled });
  // BP 批（docs/GAME-DLC.md §3.2）：收尾补 DLC 明细——取「有 dlc_appids、缺 name/price」的游戏
  // （默认 50 个），GetItems 批量补（默认 ≤30 批/轮）；本轮撞过 429 则跳过明细补齐（下轮继续）。
  let dlcFill = { games: 0, dlcs: 0, batches: 0, aborted429: false };
  if (!aborted429) {
    try {
      const { fillDlcDetails } = await import('./dlc-fill.js');
      const games = await db.listDlcFillGames(q, { limit: dlcFillGames });
      dlcFill = await fillDlcDetails(q, {
        gameIds: games,
        maxBatches: dlcFillBatches,
        key: steamKey,
        fetchImpl: dlcFetchImpl,
        logger,
      });
      if (dlcFill.dlcs > 0) logger?.info?.('steam.dlc.filled', { games: dlcFill.games, dlcs: dlcFill.dlcs, batches: dlcFill.batches });
    } catch (err) {
      logger?.warn?.('steam.dlc.fill_round_failed', { message: String(err?.message ?? err).slice(0, 160) });
    }
  }
  return { wrote, skipped, failed, requests, counts, offers, headerFilled, dlcWritten, dlcFill, aborted429, attempted };
}

// ---------------------------------------------------------------- EF：内容分级回填（docs/STEAM-SYNC-STATUS-AND-RATING.md §9）

/**
 * EF 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9）：内容分级回填候选。
 * - 候选 = required_age 为 null 的行：cc=cn 时代国区商店隐藏成人内容 → appdetails 无数据 →
 *   三字段（required_age/content_descriptors/age_ratings）全空；required_age 已采到（含 0）
 *   说明国区可正常采集（描述符缺失只是本来就空）→ 不需要 us 回填，自带收敛；
 * - backfill_at 1 天冷却：断点续跑（中断后重跑跳过当天已处理行），次日重采幂等；
 * - 高嫌疑优先：genres/tags 含 色情/Nudity/Sexual 的排前面（先确认最重要的成人游戏）。
 */
export async function listRatingBackfillCandidates(q, { limit = 30 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const r = await q(
    'select g.steam_appid from games g ' +
      'where g.steam_appid is not null and not g.deleted ' +
      'and g.required_age is null ' +
      "and (g.backfill_at is null or g.backfill_at < now() - interval '1 day') " +
      "order by (case when (coalesce(array_to_string(g.genres, '|'), '') || '|' || coalesce(array_to_string(g.tags, '|'), '')) ~* '(色情|nudity|sexual)' then 0 else 1 end), g.id " +
      'limit $1',
    [size],
  );
  return r.rows.map((row) => Number(row.steam_appid)).filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * EF 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9）：内容分级回填一轮。
 * 根因：cc=cn 的 appdetails 国区商店隐藏成人内容 → content_descriptors 采不到 → 全库
 * adult_flag 仅约 20 个。本函数逐 appid 用内容区（EI 批 §11：sync.contentRegion，默认 us）重采
 * content_descriptors / required_age / age_ratings，只写分级（applySteamDetails 传
 * cnEntry/hkEntry=null：不写 steam_status、不写价格 offer——本位币价格口径不受影响）。
 * 限速按「每个请求」计（rateMs ≥ 1s）；撞 429 立即收轮（aborted429=true，调用方 exit 75
 * 由调度器 1 小时后重排）；开工前 / 收工后各记一次 adult/mature 计数（验收① steam.meta.backfill_before/done）。
 * fetchMetadataImpl 可注入（测试离线验证）；返回 { done, wrote, adultWrote, matureWrote, failed, batches, aborted429, before, after, elapsedMs }。
 */
export async function runRatingBackfillRound(
  q,
  { limit = 200000, batch = 30, rateMs = 1500, fetchMetadataImpl = null, logger = null } = {},
) {
  const fetchMeta = fetchMetadataImpl ?? fetchMetadata;
  const size = Math.min(Math.max(Number(limit) || 200000, 1), 200000);
  const step = Math.min(Math.max(Number(batch) || 30, 1), 100);
  const sleepMs = Math.max(1000, Math.min(Number(rateMs) || 1500, 60000));
  const startedMs = Date.now();
  let done = 0;
  let wrote = 0;
  let adultWrote = 0;
  let matureWrote = 0;
  let failed = 0;
  let batches = 0;
  let aborted429 = false;

  const countRating = async () =>
    (
      await q(
        "select count(*) filter (where not deleted)::int as total, " +
          'count(*) filter (where not deleted and adult_flag)::int as adult, ' +
          'count(*) filter (where not deleted and mature_flag)::int as mature from games',
      )
    ).rows[0];

  // EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：分级回填走内容区（默认 us）
  const cc = contentRegion();
  const before = await countRating();
  logger?.info?.('steam.meta.backfill_before', { total: before.total, adult: before.adult, mature: before.mature, contentRegion: cc });

  while (done < size && !aborted429) {
    const stepSize = Math.min(step, size - done);
    const appids = await listRatingBackfillCandidates(q, { limit: stepSize });
    if (!appids.length) break;
    batches += 1;

    const metas = new Map();
    for (const appid of appids) {
      try {
        const one = await fetchMeta([appid], { backend: 'official', logger, cc });
        if (one?.items?.length) metas.set(appid, one.items[0]);
      } catch (err) {
        const status = Number(err?.status) || 0;
        if (status === 429) {
          aborted429 = true;
          logger?.warn?.('steam.meta.backfill_429', { appid, done });
          break;
        }
        failed += 1;
        logger?.warn?.('steam.meta.backfill_failed', { appid, message: String(err?.message ?? err).slice(0, 160) });
      }
      if (sleepMs) await sleep(sleepMs);
    }

    let batchWrote = 0;
    let batchAdult = 0;
    let batchMature = 0;
    for (const appid of metas.keys()) {
      const outcome = await applySteamDetails(q, { appid, cnEntry: null, hkEntry: null, meta: metas.get(appid), logger });
      if (outcome.ratingWritten) {
        batchWrote += 1;
        if (outcome.rating?.adultFlag) batchAdult += 1;
        if (outcome.rating?.matureFlag) batchMature += 1;
      }
    }
    // 冷却记账：正常时无论拿没拿到数据都记一笔（当天不再重复请求，防下架行空转）；
    // 429 收轮时只记已成功采集的行——未处理行保持候选，下轮断点续跑
    await db.markBackfilled(q, aborted429 ? [...metas.keys()] : appids);
    wrote += batchWrote;
    adultWrote += batchAdult;
    matureWrote += batchMature;
    done += appids.length;
    logger?.info?.('steam.meta.backfill_batch', { batch: batches, done, wrote: batchWrote, adult: batchAdult, mature: batchMature, failed });
  }

  const after = await countRating();
  logger?.info?.('steam.meta.backfill_done', {
    done,
    wrote,
    adultWrote,
    matureWrote,
    failed,
    batches,
    total: after.total,
    adultBefore: before.adult,
    adultAfter: after.adult,
    matureBefore: before.mature,
    matureAfter: after.mature,
    aborted429,
    contentRegion: cc,
    elapsedMs: Date.now() - startedMs,
  });
  return { done, wrote, adultWrote, matureWrote, failed, batches, aborted429, before, after, elapsedMs: Date.now() - startedMs };
}
