// EC 批（docs/IMAGE-COVERAGE.md §8 EC-2）：缺图回填——
// 扫描 header_image is null 的游戏，逐 appid 触发元数据重同步（appdetails 响应带 header_image），
// 限速 ≥1s/请求防 Steam 429；日志统一 images.backfill_*，每轮结束缺图数收敛。
import * as db from './store/pg.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 跑一轮缺图回填。
 * fetchMeta：(appids) => Promise<{ items: [{ headerImage, ... }] }>——生产用 steam-meta.fetchMetadata
 * 逐 appid 调用；测试注入假实现（本地无 Steam 出口）。
 * 返回 { scanned, filled, failed, skipped }；失败逐条吞掉不中断整轮（与采集失败模型一致）。
 */
export async function backfillMissingHeaders(q, { fetchMeta, limit = 100, sleepMs = 1200, logger = null } = {}) {
  if (typeof fetchMeta !== 'function') throw new Error('backfillMissingHeaders 需要注入 fetchMeta');
  const rows = await db.missingHeaderImageAppids(q, { limit });
  let filled = 0;
  let failed = 0;
  let skipped = 0;
  logger?.info('images.backfill_start', { candidates: rows.length });
  for (const row of rows) {
    try {
      const { items } = await fetchMeta([row.steamAppid]);
      const meta = items?.[0] ?? null;
      if (!meta?.headerImage) {
        skipped += 1;
        logger?.info('images.backfill_no_header', { appid: row.steamAppid });
        continue;
      }
      const done = await db.fillHeaderImage(q, { steamAppid: row.steamAppid, url: meta.headerImage });
      if (done.rowCount > 0) {
        filled += 1;
        logger?.info('images.backfill_filled', { appid: row.steamAppid });
      } else {
        skipped += 1; // 并发下别人已补，不算失败
      }
    } catch (err) {
      failed += 1;
      logger?.warn('images.backfill_item_failed', { appid: row.steamAppid, message: String(err?.message ?? err).slice(0, 160) });
    }
    if (sleepMs > 0) await sleep(sleepMs);
  }
  logger?.info('images.backfill_done', { scanned: rows.length, filled, failed, skipped });
  return { scanned: rows.length, filled, failed, skipped };
}
