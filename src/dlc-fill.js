// BP 批（docs/GAME-DLC.md §3.2/§3.3）：DLC 明细补齐的共用函数。
//
// 两条调用腿：
//  1. steam-status 每轮收尾：取「有 dlc_appids、明细缺 name/price」的游戏（最多 STEAM_DLC_FILL_GAMES 个），
//     GetItems 批量补，每轮最多 STEAM_DLC_FILL_BATCH 批（100 条/批）；
//  2. 详情读路径回源：单游戏、最多 3 批（含超时 5s）、按游戏 10 分钟节流由调用方控制。
// 429 / 失败：跳过并返回 aborted429（不影响 dlc_appids 本身——那在 appdetails 同响应里已经写了）。
import * as db from './store/pg.js';
import { fetchStoreItems } from './adapters/store-browse.js';

/**
 * 补齐指定游戏的 DLC 明细。
 * @param {object} opts.maxBatches 最多 GetItems 批数（总上限；单游戏调用传 3 = 每游戏 ≤3 批）
 * @param {object} opts.timeoutMs   每批超时（读路径 5s；定时路径默认不限制）
 * @returns {{games:number,dlcs:number,batches:number,aborted429:boolean}}
 */
export async function fillDlcDetails(q, { gameIds = [], maxBatches = 3, timeoutMs = null, key = process.env.STEAM_API_KEY, fetchImpl = null, logger = null } = {}) {
  const result = { games: 0, dlcs: 0, batches: 0, aborted429: false };
  if (!key) return result; // 没有 API key（本地/未配置）：静默跳过，调用方降级
  const ids = [...new Set((gameIds ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return result;
  const rows = await db.listDlcMissingAppids(q, { gameIds: ids });
  if (!rows.length) return result;
  const byGame = new Map();
  for (const r of rows) {
    const gid = Number(r.gameId);
    if (!Number.isFinite(gid)) continue;
    if (!byGame.has(gid)) byGame.set(gid, []);
    byGame.get(gid).push(Number(r.appid));
  }
  const cap = Math.min(Math.max(Number(maxBatches) || 3, 1), 30);
  const fetchUse = fetchImpl ?? fetchStoreItems;
  let used = 0;
  let filled = 0;
  for (const [gameId, appids] of byGame) {
    const queue = [...appids];
    while (queue.length && used < cap) {
      const chunk = queue.splice(0, 100);
      try {
        const got = await fetchUse(chunk, { key, logger, timeoutMs, throwOnFatal: false });
        used += 1;
        if (got?.items?.length) filled += await db.upsertGameDlc(q, { gameId, items: got.items });
        else if (!got?.items?.length && got?.failed?.length) break; // 整批失败：换下一个游戏，别空转
      } catch (err) {
        used += 1;
        if (err?.status === 429) {
          result.aborted429 = true;
          break;
        }
        logger?.warn?.('steam.dlc.fill_failed', { gameId, message: String(err?.message ?? err).slice(0, 160) });
        break;
      }
    }
    if (result.aborted429 || used >= cap) break;
  }
  result.games = byGame.size;
  result.dlcs = filled;
  result.batches = used;
  return result;
}
