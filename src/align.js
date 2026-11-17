// CD 批（docs/SONKWO-STEAM-MATCH.md §4/§5）：跨平台对齐核心——CLI 与后台审核共用。
// 职责：加载 Steam 候选、收集杉果条目（skus.json + 孤儿游戏行）、按去重组提案、
// 决定继承（confirmed 自动回填 / ignored 自动跳过）、确认/忽略落 game_source_map。
import { bestMatchMulti, alignGroupKey, buildCandidateIndex, preselectCandidates } from './match.js';
import * as db from './store/pg.js';

export const SONKWO = 'sonkwo';

/** 读 skus.json 并补上孤儿游戏行里的英文名（按同名归一化对查）。 */
export function loadSonkwoItems(entries, orphanRows = []) {
  const enByName = new Map();
  for (const g of orphanRows) {
    const key = alignGroupKey(SONKWO, g.name);
    if (key && g.name_en) enByName.set(key, g.name_en);
  }
  return (entries ?? [])
    .filter((e) => e?.name)
    .map((e) => {
      const key = alignGroupKey(SONKWO, e.name);
      return {
        skuId: Number(e.skuId),
        name: e.name,
        appid: e.appid ?? null,
        titles: [e.name, key ? (enByName.get(key) ?? null) : null].filter(Boolean),
      };
    });
}

/**
 * 决定继承：confirmed → 回填 skus.json 并返回 appid；ignored → 跳过。
 * 返回 { items, inheritApplied }。
 */
export function applyMapInheritance(items, maps) {
  const out = [];
  let inheritApplied = 0;
  for (const item of items) {
    const m = maps.get(String(item.skuId));
    if (!m) {
      out.push(item);
      continue;
    }
    if (m.decision === 'ignored') continue; // 自动忽略，不再排队
    if (m.decision === 'confirmed' && m.game_id != null) {
      item.appid = m.game_id; // 继承映射（调用方负责把 appid 写回 skus.json）
      inheritApplied += 1;
      continue;
    }
    out.push(item);
  }
  return { items: out, inheritApplied };
}

/** 按去重组键把 items 分组（同步、纯内存；预算版与旧版共用）。 */
function groupItems(items) {
  const groups = new Map();
  for (const item of items ?? []) {
    const key = alignGroupKey(SONKWO, item.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, name: item.name, items: [], best: null, auto: false });
    groups.get(key).items.push(item);
  }
  return groups;
}

/**
 * 按去重组提案：稳定键 = platform + normalizeName(杉果名)。
 * 返回 { groups: [{ key, name, skuIds, best, auto }] }（组内 SKU 一次处理）。
 * 同步、全量比较（CLI 与旧调用兼容；后台走 proposeAlignGroupsBudgeted）。
 */
export function proposeAlignGroups(items, steamGames, { minScore = 0.86, autoScore = 0.94 } = {}) {
  const groups = groupItems(items);
  const out = [];
  for (const group of groups.values()) {
    const allTitles = [...new Set(group.items.flatMap((i) => i.titles))];
    // 候选字段：DB 行是 name/name_en（蛇形），默认 getFields 的 nameEn 驼峰兜底
    const best = bestMatchMulti(allTitles, steamGames ?? [], {
      minScore,
      autoScore,
      getFields: (c) => [c.name, c.name_en ?? c.nameEn],
    });
    group.best = best;
    group.auto = Boolean(best?.auto);
    group.skuIds = group.items.map((i) => i.skuId);
    out.push(group);
  }
  // 队列按组计数；无候选在前还是按分数？稳定顺序：分数降序
  out.sort((a, b) => (b.best?.score ?? -1) - (a.best?.score ?? -1));
  return out;
}

/**
 * CN 批（docs/ALIGN-QUERY-PERF.md §2/§3）：带预算/分片/候选预筛的版本，后台专用、口径与上同。
 * - candidateIndex：buildCandidateIndex(steamGames) 的产物；缺省回退全量比较；
 * - 每组先 preselectCandidates（≤2000 候选），再 bestMatchMulti——把「组数 × 19.6 万」降到组数 × ≤2000；
 * - shouldYield：每处理 yieldEvery 组 await 一次（服务端传 setImmediate 分片，不让事件循环被独占）；
 * - budgetMs：总时间预算（配合 startedAt），超时停止并 partial=true（返回已算部分，不抛错）。
 * 返回 { groups, partial }。
 */
export async function proposeAlignGroupsBudgeted(items, steamGames, {
  minScore = 0.86,
  autoScore = 0.94,
  candidateIndex = null,
  maxCandidates = 2000,
  budgetMs = Infinity,
  startedAt = null,
  yieldEvery = 200,
  shouldYield = null,
} = {}) {
  const groups = groupItems(items);
  const index = candidateIndex ?? (steamGames ? buildCandidateIndex(steamGames) : null);
  const t0 = startedAt ?? Date.now();
  const out = [];
  let processed = 0;
  let partial = false;
  for (const group of groups.values()) {
    if (Date.now() - t0 > budgetMs) {
      partial = true;
      break;
    }
    const allTitles = [...new Set(group.items.flatMap((i) => i.titles))];
    // 候选字段：DB 行是 name/name_en（蛇形），默认 getFields 的 nameEn 驼峰兜底
    const getFields = (c) => [c.name, c.name_en ?? c.nameEn];
    const candidates = index
      ? preselectCandidates(allTitles, index, { maxCandidates })
      : steamGames ?? [];
    const best = bestMatchMulti(allTitles, candidates, {
      minScore,
      autoScore,
      getFields,
    });
    group.best = best;
    group.auto = Boolean(best?.auto);
    group.skuIds = group.items.map((i) => i.skuId);
    out.push(group);
    processed += 1;
    if (shouldYield && processed % yieldEvery === 0) await shouldYield(processed);
  }
  // 队列按组计数；无候选在前还是按分数？稳定顺序：分数降序
  out.sort((a, b) => (b.best?.score ?? -1) - (a.best?.score ?? -1));
  return { groups: out, partial };
}

/** 孤儿游戏行：无 appid 且有杉果报价（后台队列与 CLI 共用）。 */
export async function loadOrphanSonkwoGames(q) {
  const r = await q(
    `select distinct g.id, g.name, g.name_en
       from games g
       join offers o on o.game_id = g.id and o.platform_code = $1
      where g.steam_appid is null and not g.deleted`,
    [SONKWO],
  );
  return r.rows;
}

/** 确认一组：skus.json 写 appid + 映射落库（confirmed）+ 合并孤立行。返回操作结果。 */
export async function confirmGroup({ store, q, group, appid, steamGames, reviewedBy = null, method = 'manual', confidence = 1, mergeGame }) {
  const target = steamGames.find((g) => g.steam_appid === Number(appid));
  if (!target) throw new Error(`库里没有 appid ${appid}`);
  const results = { skus: 0, merged: 0, errors: [] };
  for (const skuId of group.skuIds) {
    try {
      await db.upsertSourceMap(q, {
        platformCode: SONKWO,
        productId: String(skuId),
        gameId: Number(target.id),
        method,
        confidence,
        decision: 'confirmed',
        reviewedBy,
      });
      results.skus += 1;
    } catch (err) {
      results.errors.push(String(err?.message ?? err));
    }
  }
  // 合并同归一化名的孤儿游戏行
  const names = [...new Set(group.items.map((i) => i.name))];
  for (const name of names) {
    const orphans = (await q(
      `select g.id from games g join offers o on o.game_id = g.id and o.platform_code = $1
        where g.steam_appid is null and g.name = $2 and not g.deleted`,
      [SONKWO, name],
    )).rows;
    for (const row of orphans) {
      if (Number(row.id) === Number(target.id)) continue;
      try {
        const res = await mergeGame({ fromGameId: Number(row.id), toGameId: Number(target.id) });
        if (res?.merged) results.merged += 1;
      } catch (err) {
        results.errors.push(String(err?.message ?? err));
      }
    }
  }
  return results;
}

/** 忽略一组：映射落库（ignored），同组新 SKU 自动继承。 */
export async function ignoreGroup({ q, group, reviewedBy = null }) {
  for (const skuId of group.skuIds) {
    await db.upsertSourceMap(q, {
      platformCode: SONKWO,
      productId: String(skuId),
      gameId: null,
      decision: 'ignored',
      reviewedBy,
    });
  }
  return { ignored: group.skuIds.length };
}
