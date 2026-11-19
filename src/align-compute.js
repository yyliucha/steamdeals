// DL 批（docs/ALIGN-SNAPSHOT.md）：对齐审核全量计算的共享实现——
// 从 server.js 抽出，供 HTTP 服务（后台生成快照）与 CLI `align-snapshot` 调度任务复用。
// 计算本体有副作用（内容词归档 / 断箭补写映射），幂等；签名见 align-snapshot.js §4 口径。
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCandidateIndex } from './match.js';

/** skus.json 路径（env 可覆盖，测试用）——与 server.js 原口径一致。 */
export const alignSkuFile = () => process.env.ALIGN_SKU_FILE || resolve(process.cwd(), 'data', 'skus.json');

/** 读 skus.json：空/坏文件按空数组处理（不抛错中断生成）。 */
export const readAlignSkus = () => {
  try {
    if (existsSync(alignSkuFile())) {
      const parsed = JSON.parse(readFileSync(alignSkuFile(), 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    /* 空/坏文件按空处理 */
  }
  return [];
};

/**
 * 依赖注入工厂：{ q, db, logger } 来自调用方（server 实例 / CLI）。
 * 返回 { computeAlignGroups }——单次全量计算（CN/CS/DN/DH 批口径不变）：
 * 候选索引建在计算内；匹配循环 setImmediate 分片；后台生成模型下不设 20s 硬截断。
 */
export function createAlignCompute({ q, db, logger }) {
  const computeAlignGroups = async ({ onProgress } = {}) => {
    const wallStartedAt = Date.now();
    const align = await import('./align.js');
    const entries = readAlignSkus();
    const games = (await q('select id, steam_appid, name, name_en from games where steam_appid is not null')).rows;
    const orphanRows = await align.loadOrphanSonkwoGames(q);
    const items = align.loadSonkwoItems(entries, orphanRows);
    const allSkuIds = items.map((i) => String(i.skuId));
    const maps = await db.sourceMapsByProducts(q, 'sonkwo', allSkuIds);
    // DN 批（docs/TODO.md DN）：内容词 SKU 默认归档——名称命中内容词（复用 match.js hasContentWord，
    // 季票/服装/DLC 等，含杉果自定义命名）且库无映射 → 不进待对齐队列（自动归档，不计入「待对齐组」）；
    // 归档写 game_source_map（ignored，method=content_word）供「已忽略」视图查看/恢复（DH 能力）；
    // confirmed/pending/ignored 的人工决定优先（恢复为 pending 后重新入队、不重复归档）。
    const contentWords = align.archiveContentWordItems(items, maps);
    const archivedWritten = await align.writeContentWordArchives({ q, archived: contentWords.archived, logger });
    if (contentWords.groups) {
      logger?.info('align.content_word_skipped', { groups: contentWords.groups, skus: contentWords.skus, archived: archivedWritten });
    }
    const inherit = align.applyMapInheritance(contentWords.items, maps);
    // DH 批（docs/ALIGN-INTEGRITY.md §2 A1/§5.1）：skus.json 已带 appid、库无映射 →
    // 计算时自动补写 game_source_map（confirmed，method=skus_backfill）+ 日志 align.map_backfilled。
    const backfilled = await align.writeBackfilledMaps({ q, backfill: inherit.backfill, steamGames: games, logger });
    // DH 批（§2 C1）：每组「最近处理」——队列里的组只可能是 pending（恢复为待处理）留下的痕迹
    const reviewedBySku = new Map(
      (await q(
        `select m.product_id, m.decision, m.reviewed_by, m.reviewed_at, u.username
           from game_source_map m
           left join users u on u.id = m.reviewed_by
          where m.platform_code = 'sonkwo' and m.product_id = any($1::text[])`,
        [allSkuIds],
      )).rows.map((r) => [String(r.product_id), r]),
    );
    const candidateIndex = buildCandidateIndex(games);
    const { groups, partial } = await align.proposeAlignGroupsBudgeted(inherit.items, games, {
      candidateIndex,
      maxCandidates: 2000,
      budgetMs: Infinity, // CS 批：后台生成算完为止（partial 兜底仅防 future 回归）
      startedAt: Date.now(), // 预算只约束匹配循环，前处理不计入（CS #2）
      onGrouped: (total) => onProgress?.(0, total), // DE 批：分组完成立即上报总数（进度不出现 0/0）
      shouldYield: async (processed, totalGroups) => {
        onProgress?.(processed, totalGroups);
        await new Promise((r) => setImmediate(r));
      },
    });
    for (const g of groups) {
      const traces = g.skuIds
        .map((id) => reviewedBySku.get(String(id)))
        .filter((r) => r?.decision === 'pending' && r.reviewed_at != null)
        .sort((a, b) => new Date(b.reviewed_at) - new Date(a.reviewed_at));
      if (traces.length) {
        g.lastReviewed = { by: traces[0].username ?? null, at: traces[0].reviewed_at, action: '恢复' };
      }
    }
    logger?.info('align.computed', { groups: groups.length, partial, backfilled, contentWordGroups: contentWords.groups, ms: Date.now() - wallStartedAt });
    return { align, entries, games, groups, inherit, contentWords, partial, generatedAt: Date.now() };
  };

  return { computeAlignGroups };
}
