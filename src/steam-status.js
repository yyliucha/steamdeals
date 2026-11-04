// Steam 状态与分级落库的共用函数（docs/STEAM-SYNC-STATUS-AND-RATING.md §14.3）：
// 「一次 appdetails 响应 → 状态判定 + 分级派生 + 写库」收敛成一个函数，
// cmdBackfill（appdetails 回退路径）与 cmdSteamStatus 两条路径共用，判定口径唯一。
import * as db from './store/pg.js';
import { classifySteamStatus } from './adapters/steam.js';
import { classifyContentRating } from './adapters/steam-meta.js';

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
 * - 分级字段本次没拿到（null）→ 不覆盖已有值（db.setSteamStatus 用 coalesce 处理）。
 *
 * 返回 { status, rating, wroteStatus }：status 为 null 表示本次判定不了；wroteStatus 表示游标是否推进。
 */
export async function applySteamDetails(q, { appid, cnEntry = null, hkEntry = null, meta = null }) {
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
    return { status, rating, wroteStatus: false };
  }
  await db.setSteamStatus(q, {
    steamAppid: appid,
    status,
    requiredAge,
    contentDescriptors: hasRating ? descriptorIds : null,
    ageRatings: hasRating ? ratings : null,
    adultFlag: hasRating ? rating.adultFlag : null,
    matureFlag: hasRating ? rating.matureFlag : null,
  });
  return { status, rating, wroteStatus: status != null };
}
