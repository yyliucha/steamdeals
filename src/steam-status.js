// Steam 状态与分级落库的共用函数（docs/STEAM-SYNC-STATUS-AND-RATING.md §14.3）：
// 「一次 appdetails 响应 → 状态判定 + 分级派生 + 写库」收敛成一个函数，
// cmdBackfill（appdetails 回退路径）与 cmdSteamStatus 两条路径共用，判定口径唯一。
// AB 批（docs/STEAM-STATUS-FIX.md）：runSteamStatusRound 把 steam-status 一轮收敛到这里，
// fetchJsonImpl 可注入，测试能离线验证"取值 .json / 不写库 / 429 收轮"。
import * as db from './store/pg.js';
import { ingestOffers } from './ingest.js';
import { classifySteamStatus } from './adapters/steam.js';
import { classifyContentRating, normalizeOfficial } from './adapters/steam-meta.js';

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
 * 返回 { status, rating, wroteStatus }：status 为 null 表示本次判定不了；
 * wroteStatus 只有「状态真写进库且 UPDATE 命中行」才为 true（AB 批 §3-B：写入不可静默）。
 */
export async function applySteamDetails(q, { appid, cnEntry = null, hkEntry = null, meta = null, logger = null }) {
  // 没有任何 appdetails 条目 → 判定不了状态（如只有 GetItems、字段不全的路径）
  const status = cnEntry == null && hkEntry == null ? null : classifySteamStatus(cnEntry, hkEntry);
  const requiredAge = meta?.requiredAge ?? null;
  const descriptorIds = Array.isArray(meta?.contentDescriptors) ? meta.contentDescriptors : [];
  const ratings = meta?.ageRatings && typeof meta.ageRatings === 'object' ? meta.ageRatings : {};
  const hasRating =
    requiredAge != null || descriptorIds.length > 0 || Object.keys(ratings).length > 0;
  const rating = classifyContentRating({ requiredAge, descriptorIds, ratings });

  if (status == null && !hasRating) {
    // 什么都没拿到：不写库（GetItems 且无分级字段的路径）
    return { status, rating, wroteStatus: false, offerWritten: false };
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
  // AC-2（docs/SYNC-FAILURE-MODES.md AC8，2026-11-09 确认）：判定 ok（国区有价）时顺带写首次 offer——
  // 与状态共用同一次 appdetails 响应，不额外消耗配额；免费/锁区/未发售不写价。
  let offerWritten = false;
  if (wroteStatus && status === 'ok' && meta?.priceOverview && meta.priceOverview.final != null) {
    const offer = {
      platformCode: 'steam',
      platformProductId: String(appid),
      steamAppid: Number(appid),
      title: meta.nameZh ?? meta.nameEn ?? String(appid),
      productType: 'official_direct',
      region: 'cn',
      currency: meta.priceOverview.currency ?? 'CNY',
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
  return { status, rating, wroteStatus, offerWritten };
}

/**
 * steam-status 一轮（AB 批 docs/STEAM-STATUS-FIX.md §3）：
 * - A 取 appdetails 条目用 `res.json[appid]`（fetchJson 返回 { ...res, json }）；
 * - B 写入不可静默：`wrote` 只统计真的写进库的行；判定不了记 `steam-status.skip_write`（debug）、
 *   写库未命中记 `steam-status.write_miss`（warn），`counts` 只统计已知状态；
 * - C 限速按「每个请求」计（cn/hk 之后各 sleep 一次，非 429 的 4xx 异常路径也 sleep）；
 *   撞 429 立即结束本轮（不睡 30 分钟空转），下轮续跑；
 * - 候选按 steam_checked_at 游标选取；判定不了/失败不推游标，下轮重试。
 *
 * fetchJsonImpl 可注入（测试离线验证）；返回 { wrote, skipped, failed, requests, counts, aborted429, attempted }。
 */
export async function runSteamStatusRound(q, { limit = 6000, batch = 30, rateMs = 1500, fetchJsonImpl = null, logger = null, onProgress = null } = {}) {
  const fetchUse = fetchJsonImpl ?? (await import('./http.js')).fetchJson;
  const size = Math.min(Math.max(Number(limit) || 6000, 1), 200000);
  const step = Math.min(Math.max(Number(batch) || 30, 1), 100);
  let attempted = 0;
  let wrote = 0;
  let skipped = 0;
  let failed = 0;
  let requests = 0;
  let offers = 0;
  let aborted429 = false;
  const counts = { ok: 0, free: 0, coming_soon: 0, region_locked: 0, no_price: 0, not_found: 0 };

  while (attempted < size) {
    const rows = await db.listSteamStatusCandidates(q, { limit: Math.min(step, size - attempted) });
    if (!rows.length) break;
    for (const row of rows) {
      const appid = row.steamAppid;
      let cnEntry = null;
      let hkEntry = null;
      let meta = null;
      try {
        const cn = await fetchUse(
          `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=cn&l=schinese`,
          { logger, label: 'steam.status', timeoutMs: 30000, retries: 1 },
        );
        requests += 1;
        if (rateMs) await sleep(rateMs); // AB 批 §3-C：限速按“每个请求”计
        cnEntry = cn?.json?.[String(appid)] ?? null; // AB 批 §3-A：fetchJson 返回 { ...res, json }
        let data = cnEntry?.success === true ? cnEntry.data : null;
        if (!data) {
          // 国区不可售/下架：补一次港区判定锁区（有价/免费=锁国区）
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
            aborted429 = true;
            break; // AB 批 §3-C：429 立即收轮，交给下轮续跑
          }
          if (rateMs) await sleep(rateMs); // 非 429 的 4xx 也不允许无间隔连发（AB 批 §2.5-2）
          continue;
        }
        if (rateMs) await sleep(rateMs);
        continue;
      }
      const outcome = await applySteamDetails(q, { appid, cnEntry, hkEntry, meta, logger });
      attempted += 1;
      if (outcome.wroteStatus) {
        wrote += 1;
        if (outcome.status) counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
        if (outcome.offerWritten) offers += 1;
      } else {
        skipped += 1;
        if (outcome.status == null) {
          logger?.debug?.('steam-status.skip_write', { appid, reason: 'status_unknown' });
        } else {
          logger?.warn?.('steam-status.write_miss', { appid, status: outcome.status });
        }
      }
      onProgress?.({ attempted, wrote, skipped, failed, counts, offers });
    }
    if (aborted429) break;
  }
  return { wrote, skipped, failed, requests, counts, offers, aborted429, attempted };
}
