// CO-5/B4-2 第十四轮（docs/DESIGN-AUDIT.md B4）：admin-align 域路由模块——从 src/server.js
// 巨石抽出的第十四个域（B4 队列 #17：后台对齐审核 /api/admin/align*）。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · GET  /api/admin/align            对齐队列（库快照真相；无快照 202 firstRun；?refresh=1
//                                      后台重算不阻塞；分页/统计卡/生成态字段）
//   · GET  /api/admin/align/preview    合并预览（单组 ?key= / 批量 ?keys=，孤儿行 + 不可撤销提示）
//   · POST /api/admin/align/confirm    确认（单条 key+appid / 批量 keys，写映射 + 同事务更新快照）
//   · POST /api/admin/align/ignore     忽略（单条 key / 批量 keys，写 ignored + 同事务更新快照）
//   · GET  /api/admin/align/ignored    已忽略视图（q 过滤）
//   · POST /api/admin/align/restore    恢复为待处理（快照标脏 + 后台重算）
//   · GET  /api/admin/align/history    审阅记录
//   · GET  /api/admin/align/search     手动搜索候选（name/name_en/steam_appid）
//
// 单入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3）：
//   · handleAdminAlignAdmin(ctx)：requireAdmin 就绪后的管理段——本域全部 8 组路由
//     （管理段形态先例=admin-access 域 handleAdminAccessAdmin / admin-sync 域
//     handleAdminSyncAdmin / admin-settings 域 handleAdminSettingsAdmin）。
//   返回值约定：true = 已处理并结束响应；false = 未命中本域，宿主继续。凡写过响应的分支
//   必须返回 true（json(...) 自身返回 undefined，直接 return json(...) 会让宿主误判未命中
//   继续跑完整条链 → 二次写头 ERR_HTTP_HEADERS_SENT）。
//
// 留在 server.js 的未拆段（不属于本域）：
//   · triggerAlignGeneration 宿主闭包——后台生成 single-flight（进程内链式排队）留在 server.js，
//     经 ctx 按引用传入（语义共享：GET 首次/refresh 与 confirm/ignore/restore 动作后的重算
//     共用同一在途 Promise 链，防止动作后旧重算覆盖新队列；对齐 admin-sync 域 syncState 先例）；
//   · runGated 宿主闭包——并发闸 Map 留在 server.js，经 ctx 按引用传入（语义共享：与其它
//     管理接口共用宿主同一闸表；HEAVY_GATE_CONFIG 的 'GET /api/admin/align' 键也在 server.js）；
//   · computeAlignGroups / ensureAlignSnapshot / alignSnapshotMaxAgeMs 供 triggerAlignGeneration
//     闭包使用留在宿主（CLI align-snapshot 调度任务也走 ensureAlignSnapshot 共享函数）；
//   · store 测试注入参数经 ctx 按引用传入（语义共享：宿主 createApiServer 的 store 参数，
//     与 api.test.js 注入同一 store 实例；本域事务走 store.tx）；
//   · /api/admin/bulk 派发表无 align 条目（对齐审核全部走本域路由，不涉 bulk）；
//   · align.js / align-compute.js / align-snapshot.js 是共享业务模块（CLI align-snapshot
//     也走），保持独立文件不动，本域经 import 引用。
import * as db from '../store/pg.js';
import { parseAlignPage } from '../align-query.js';
import { readAlignSkus } from '../align-compute.js';
import {
  loadLatestAlignSnapshot,
  loadLatestAlignSnapshotForUpdate,
  updateAlignSnapshotAfterAction,
  markAlignSnapshotDirty,
} from '../align-snapshot.js';

// DE 批（docs/ALIGN-REVIEW-UI.md §2/§3）：对齐组 → 接口行映射（链接字段 + top-N 候选明细 + 英文名）。
const alignSteamUrl = (appid) => (appid != null ? `https://store.steampowered.com/app/${appid}/` : null);
const mapAlignRows = (groups) => groups.map((g) => {
  const best = g.best;
  const candidate = best?.candidate ?? null;
  return {
    key: g.key,
    name: g.name,
    nameEn: (g.items ?? []).flatMap((i) => (i.titles ?? []).slice(1)).find(Boolean) ?? null,
    skuCount: g.skuIds.length,
    skuIds: g.skuIds,
    skuUrls: g.skuIds.map((id) => `https://www.sonkwo.hk/sku/${id}`),
    auto: g.auto,
    score: best?.score ?? null,
    lastReviewed: g.lastReviewed ?? null, // DH 批：最近处理（操作人/时间/动作；恢复为待处理的组可见）
    method: best?.method ?? null,
    matchedField: best?.matchedField ?? null,
    contentWord: Boolean(best?.contentWord),
    reasons: best?.reasons ?? [],
    candidate: candidate
      ? { name: candidate.name ?? best.matchedField, steamAppid: candidate.steam_appid, steamUrl: alignSteamUrl(candidate.steam_appid) }
      : null,
    candidates: (g.topCandidates ?? []).map((t) => ({
      name: t.candidate.name ?? t.matchedField,
      steamAppid: t.candidate.steam_appid,
      steamUrl: alignSteamUrl(t.candidate.steam_appid),
      score: t.score,
      method: t.method,
      matchedField: t.matchedField,
      reasons: t.reasons,
      auto: t.auto,
    })),
  };
});

// DE 批（docs/ALIGN-REVIEW-UI.md §5）：单组确认的内部步骤——合并孤立行 + 映射落库；
// 单条与批量确认共用，返回 { mapped, merged }。store 为宿主注入的事务能力（confirmGroup 需要）。
const confirmAlignKey = async ({ q, align, group, appid, games, user, method = 'manual', logger, store }) => {
  const target = games.find((g) => Number(g.steam_appid) === appid);
  if (!target) throw new Error(`库里没有 appid ${appid}`);
  const merged = [];
  for (const skuId of group.skuIds) {
    const alias = await db.gameAliasGameId(q, 'sonkwo', String(skuId));
    if (alias) {
      const fromId = Number(alias.game_id);
      if (fromId !== Number(target.id)) {
        const source = await db.gameSteamAppidById(q, fromId);
        if (source && source.steam_appid == null) {
          const res = await db.mergeGames(q, { fromGameId: fromId, toGameId: Number(target.id), logger });
          merged.push({ fromId, moved: res.moved ?? 0, dropped: res.dropped ?? 0, merged: Boolean(res.merged) });
        } else {
          logger?.warn('match.skip_merge', { skuId, fromId, reason: 'source_has_appid' });
        }
      }
    }
  }
  const outcome = await align.confirmGroup({ store, q, group, appid, steamGames: games, reviewedBy: user.id, method, confidence: group.best?.score ?? 1, mergeGame: () => ({ merged: false }) });
  return { mapped: outcome.skus, merged };
};

/**
 * 管理段：server.js 在 requireAdmin 就绪之后调用——后台对齐审核全部路由。
 * 每条分支自己 requireAdmin()（401/403 文案由宿主守卫统一输出，契约不变）。
 * ctx 域特有字段（§15.2，按引用传入、语义共享，勿改成拷贝）：
 *   · ctx.triggerAlignGeneration  宿主闭包——后台生成 single-flight（进程内链式排队）；
 *   · ctx.runGated                宿主闭包——并发闸（'GET /api/admin/align' ≤1，503 文案统一）；
 *   · ctx.store                   createApiServer 注入的 store（本域事务走 store.tx，测试注入同实例）。
 */
export async function handleAdminAlignAdmin(ctx) {
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
    requireAdmin,
    store,
    runGated,
    triggerAlignGeneration,
  } = ctx;

  // ---- DL 批（docs/ALIGN-SNAPSHOT.md §5）：对齐审核——只读库快照 + 操作同事务更新快照 ----
  // 队列真相 = align_snapshots 最新行；不再有内存 TTL/invalidate/staleCache。
  // 读：无快照（首次部署）→ 202 firstRun 并触发后台生成；有快照 → 200（分页在内存切片）。
  // ?refresh=1：请求后台立即重算（不阻塞），返回当前快照 + refreshing。
  // 操作（confirm/ignore/restore）：与映射写入同事务更新快照——读请求立刻拿到新队列。

  if (path === '/api/admin/align' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    // B1 批（docs/DESIGN-AUDIT.md B1）：读接口并发闸（≤1；重算本体在后台 single-flight）
    await runGated('GET /api/admin/align', 1, async () => {
    const refresh = url.searchParams.get('refresh') === '1';
    const { page, pageSize } = parseAlignPage(url.searchParams);
    const latest = await loadLatestAlignSnapshot(q);
    if (!latest) {
      // 首次部署（表空）：触发后台生成（single-flight），前端只此一次显示「首次生成中」（规格 §5/§7.1）
      triggerAlignGeneration();
      logger?.info('align.snapshot_read', { firstRun: true });
      { json(res, 202, { generating: true, firstRun: true, page, pageSize }); return true; }
    }
    if (refresh) {
      // ?refresh=1：后台立即重算，不阻塞本次响应（规格 §5）
      triggerAlignGeneration({ force: true });
    }
    const payload = latest.payload ?? {};
    const rows = mapAlignRows(payload.items ?? []);
    const counts = latest.counts ?? {};
    logger?.info('align.snapshot_read', { stale: Boolean(latest.dirty), refreshing: refresh, total: rows.length });
    json(res, 200, {
      groups: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
      counts, // { groups, skus, auto, manual, noCandidate, inherited, ignored, contentWords, contentWordSkus }
      inherited: counts.inherited ?? 0, // 兼容旧前端字段
      generatedAt: latest.generated_at ?? null,
      cached: true, // 库快照即缓存（签名不变时无重算，规格 §8.3）
      dirty: Boolean(latest.dirty),
      refreshing: refresh,
      partial: Boolean(payload.partial),
      error: latest.error ?? null, // 最近一次生成失败原因（成功为 null，规格 §7.2）
    });
    }, (msg) => json(res, 503, { error: msg }));
    return true;
  }

  // 合并预览：该组同归一化名的孤立游戏行（报价/快照数 + 不可撤销提示）
  // DE 批：支持 ?keys=a,b 批量预览（批量确认弹窗显示「将合并 M 条孤儿行」）。
  // DL 批：组来源改为库快照 payload.items（不再同步全量计算）。
  const alignPreviewMatch = path.match(/^\/api\/admin\/align\/preview$/);
  if (alignPreviewMatch && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const key = String(url.searchParams.get('key') ?? '').trim();
    const keysParam = String(url.searchParams.get('keys') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const latest = await loadLatestAlignSnapshot(q);
    const groups = latest?.payload?.items ?? [];
    const orphanRowsFor = async (group) => {
      const orphans = [];
      for (const name of [...new Set(group.items.map((i) => i.name))]) {
        const rows = await db.listOrphanGameRows(q, name);
        orphans.push(...rows.map((r) => ({ id: Number(r.id), name: r.name, offers: Number(r.offers), snapshots: Number(r.snapshots) })));
      }
      return orphans;
    };
    if (key) {
      const group = groups.find((g) => g.key === key);
      if (!group) { json(res, 404, { error: '队列里没有该组' }); return true; }
      const target = group.best?.candidate?.steam_appid;
      if (!target) { json(res, 400, { error: '该组没有候选，请手动搜索指定目标' }); return true; }
      json(res, 200, {
        key,
        target: { name: group.best.candidate.name ?? group.best.matchedField, steamAppid: target },
        skuIds: group.skuIds,
        orphans: await orphanRowsFor(group),
        irreversible: true,
      });
      return true;
    }
    if (keysParam.length) {      if (keysParam.length > 200) { json(res, 400, { error: '单次批量预览最多 200 组' }); return true; }
      const found = new Map(groups.map((g) => [g.key, g]));
      const missing = keysParam.filter((k) => !found.has(k));
      if (missing.length) { json(res, 404, { error: `队列里没有该组：${missing.join('、')}` }); return true; }
      const previews = [];
      for (const k of keysParam) {
        const group = found.get(k);
        const target = group.best?.candidate?.steam_appid;
        if (!target) {
          previews.push({ key: k, error: '该组没有候选，请手动搜索指定目标' });
          continue;
        }
        previews.push({
          key: k,
          name: group.name,
          skuCount: group.skuIds.length,
          target: { name: group.best.candidate.name ?? group.best.matchedField, steamAppid: target },
          skuIds: group.skuIds,
          orphans: await orphanRowsFor(group),
          irreversible: true,
        });
      }
      { json(res, 200, { keys: keysParam, previews }); return true; }
    }
    { json(res, 400, { error: '缺少 key / keys' }); return true; }
  }

  if (path === '/api/admin/align/confirm' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const singleKey = String(body?.key ?? '').trim();
    const keys = Array.isArray(body?.keys) ? body.keys.map((k) => String(k ?? '')).filter(Boolean) : [];
    const method = body?.method || 'manual';
    // DE 批：批量确认——body.keys 用各组当前候选，每组独立回执。
    // A3 批：确认只写 game_source_map（库为唯一真相），不再写回 skus.json。
    // DL 批（docs/ALIGN-SNAPSHOT.md §5）：映射写入与快照更新同一事务——成功后从 payload 移除
    // 已处理组、counts 递减、dirty=true；读请求立即拿到不含这些组的新队列（不再 invalidate 全量）。
    if (keys.length) {
      if (keys.length > 200) { json(res, 400, { error: '单次批量确认最多 200 组' }); return true; }
      const align = await import('../align.js');
      const out = await store.tx(async (tx) => {
        const snap = await loadLatestAlignSnapshotForUpdate(tx);
        const groups = snap?.payload?.items ?? [];
        const results = [];
        let totalMapped = 0;
        let totalMerged = 0;
        const removed = [];
        for (const k of keys) {
          const group = groups.find((g) => g.key === k);
          if (!group) { results.push({ key: k, error: '队列里没有该组（可能已被处理）' }); continue; }
          const appid = group.best?.candidate?.steam_appid;
          if (appid == null) { results.push({ key: k, error: '该组没有候选' }); continue; }
          try {
            const target = await db.gameBySteamAppid(tx, appid);
            if (!target) throw new Error(`库里没有 appid ${appid}`);
            const r = await confirmAlignKey({ q: tx, align, group, appid, games: [target], user, method, logger, store });
            totalMapped += r.mapped;
            totalMerged += r.merged.length;
            results.push({ key: k, appid, mapped: r.mapped, merged: r.merged.length });
            removed.push(group);
          } catch (err) {
            results.push({ key: k, error: String(err?.message ?? err) });
          }
        }
        // 同事务更新快照：移除已处理组 + counts 递减 + dirty（规格 §5）
        if (snap && removed.length) await updateAlignSnapshotAfterAction(tx, snap, { removedGroups: removed });
        return { results, totalMapped, totalMerged };
      });
      triggerAlignGeneration(); // 签名已变（映射写入）→ 后台重算一致性，快照本身已是新队列
      logger?.info('match.batch_confirmed', { by: user.username, keys, results: out.results });
      { json(res, 200, { ok: true, results: out.results, totalMapped: out.totalMapped, totalMerged: out.totalMerged }); return true; }
    }
    if (singleKey) {
      const appid = Number(body?.appid);
      if (!Number.isFinite(appid)) { json(res, 400, { error: '参数不合法（key + appid）' }); return true; }
      const align = await import('../align.js');
      // 守卫（只读，不占锁）：组在队列、目标在库
      const latest = await loadLatestAlignSnapshot(q);
      const guardGroup = latest?.payload?.items?.find((g) => g.key === singleKey);
      if (!guardGroup) { json(res, 404, { error: '队列里没有该组（可能已被处理）' }); return true; }
      const target = await db.gameBySteamAppid(q, appid);
      if (!target) { json(res, 404, { error: `库里没有 appid ${appid}` }); return true; }
      // 合并孤立行（只合并无 appid 的源行；有 appid 冲突跳过）——不可自动撤销
      let mapped = 0;
      let merged = [];
      try {
        await store.tx(async (tx) => {
          const snap = await loadLatestAlignSnapshotForUpdate(tx);
          const group = snap?.payload?.items?.find((g) => g.key === singleKey) ?? guardGroup;
          const r = await confirmAlignKey({ q: tx, align, group, appid, games: [target], user, method, logger, store });
          mapped = r.mapped;
          merged = r.merged;
          // 同事务更新快照（组已被并发处理时不重复移除——apply 用 key 过滤，安全）
          if (snap) await updateAlignSnapshotAfterAction(tx, snap, { removedGroups: [group] });
        });
      } catch (err) {
        if (err?.httpStatus) { json(res, err.httpStatus, { error: err.message }); return true; }
        throw err;
      }
      triggerAlignGeneration(); // 签名已变 → 后台重算一致性
      logger?.info('match.confirmed', { by: user.username, key: singleKey, appid, skus: guardGroup.skuIds, merged });
      { json(res, 200, { ok: true, mapped, merged: merged.length, appid }); return true; }
    }
    { json(res, 400, { error: '参数不合法（key + appid 或 keys）' }); return true; }
  }

  if (path === '/api/admin/align/ignore' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const singleKey = String(body?.key ?? '').trim();
    const keys = Array.isArray(body?.keys) ? body.keys.map((k) => String(k ?? '')).filter(Boolean) : [];
    // DE 批：批量忽略——每组独立回执。DL 批：与快照更新同事务（规格 §5）。
    if (keys.length) {
      if (keys.length > 200) { json(res, 400, { error: '单次批量忽略最多 200 组' }); return true; }
      const align = await import('../align.js');
      const out = await store.tx(async (tx) => {
        const snap = await loadLatestAlignSnapshotForUpdate(tx);
        const groups = snap?.payload?.items ?? [];
        const results = [];
        let totalIgnored = 0;
        const removed = [];
        for (const k of keys) {
          const group = groups.find((g) => g.key === k);
          if (!group) { results.push({ key: k, error: '队列里没有该组（可能已被处理）' }); continue; }
          const ignored = await align.ignoreGroup({ q: tx, group, reviewedBy: user.id });
          totalIgnored += ignored.ignored;
          results.push({ key: k, ignored: ignored.ignored });
          removed.push(group);
        }
        if (snap && removed.length) await updateAlignSnapshotAfterAction(tx, snap, { removedGroups: removed });
        return { results, totalIgnored };
      });
      triggerAlignGeneration(); // 签名已变 → 后台重算一致性
      logger?.info('match.batch_ignored', { by: user.username, keys, results: out.results });
      { json(res, 200, { ok: true, results: out.results, ignored: out.totalIgnored }); return true; }
    }
    if (singleKey) {
      const align = await import('../align.js');
      const latest = await loadLatestAlignSnapshot(q);
      const guardGroup = latest?.payload?.items?.find((g) => g.key === singleKey);
      if (!guardGroup) { json(res, 404, { error: '队列里没有该组（可能已被处理）' }); return true; }
      let ignored = 0;
      await store.tx(async (tx) => {
        const snap = await loadLatestAlignSnapshotForUpdate(tx);
        const group = snap?.payload?.items?.find((g) => g.key === singleKey) ?? guardGroup;
        const r = await align.ignoreGroup({ q: tx, group, reviewedBy: user.id });
        ignored = r.ignored;
        if (snap) await updateAlignSnapshotAfterAction(tx, snap, { removedGroups: [group] });
      });
      triggerAlignGeneration(); // 签名已变 → 后台重算一致性
      logger?.info('match.ignored', { by: user.username, key: singleKey, skus: guardGroup.skuIds });
      { json(res, 200, { ok: true, ignored }); return true; }
    }
    { json(res, 400, { error: '缺少 key 或 keys' }); return true; }
  }

  // ---- DH 批（docs/ALIGN-INTEGRITY.md §2 B1/C1、§3）：已忽略视图 / 恢复为待处理 / 审阅记录 ----
  if (path === '/api/admin/align/ignored' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const align = await import('../align.js');
    const entries = readAlignSkus();
    const qFilter = String(url.searchParams.get('q') ?? '').trim().slice(0, 60);
    const groups = await align.loadIgnoredGroups({ q, entries, qFilter });
    { json(res, 200, { groups, total: groups.length }); return true; }
  }

  if (path === '/api/admin/align/restore' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const align = await import('../align.js');
    const body = await readBody(req);
    const key = String(body?.key ?? '').trim();
    if (!key) { json(res, 400, { error: '缺少 key' }); return true; }
    const entries = readAlignSkus();
    const skuIds = align.skuIdsForGroupKey(entries, key);
    if (!skuIds.length) { json(res, 404, { error: '没有该组（可能已不在 skus.json）' }); return true; }
    // DL 批：恢复与快照标脏同事务（该组将在后台重算后重新入队；读请求不被重算阻塞）
    const restored = await store.tx(async (tx) => {
      const snap = await loadLatestAlignSnapshotForUpdate(tx);
      const r = await align.restoreIgnoredGroup({ q: tx, skuIds, reviewedBy: user.id });
      if (snap) await markAlignSnapshotDirty(tx, snap);
      return r;
    });
    if (!restored) { json(res, 404, { error: '该组没有已忽略的映射' }); return true; }
    triggerAlignGeneration(); // 签名已变（pending 映射）→ 后台重算，恢复组重新入队
    logger?.info('align.restored', { by: user.username, key, skus: restored });
    { json(res, 200, { ok: true, restored }); return true; }
  }

  if (path === '/api/admin/align/history' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const align = await import('../align.js');
    const key = String(url.searchParams.get('key') ?? '').trim();
    if (!key) { json(res, 400, { error: '缺少 key' }); return true; }
    const entries = readAlignSkus();
    const records = await align.loadGroupHistory({ q, entries, key });
    { json(res, 200, { records }); return true; }
  }

  if (path === '/api/admin/align/search' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const kw = String(url.searchParams.get('q') ?? '').trim().slice(0, 60);
    if (!kw) { json(res, 200, { games: [] }); return true; }
    const rows = await db.searchAlignGames(q, kw);
    { json(res, 200, { games: rows }); return true; }
  }

  return false;
}
