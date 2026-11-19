// DL 批（docs/ALIGN-SNAPSHOT.md）：对齐审核快照落库——数据签名、快照读写/prune、
// 确认/忽略后的同事务快照更新（纯函数）、后台生成（freshness + 24h 兜底 + 写库前比对签名）。
// 废弃内存缓存语义：库快照即真相，读请求不再经过「生成中 + 旧列表」。
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { alignSkuFile } from './align-compute.js';

export const ALIGN_SNAPSHOT_KEEP = 5;
export const ALIGN_SNAPSHOT_MAX_AGE_MS_DEFAULT = 24 * 3600_000;

/** 24h 强制重算兜底（可用 env 缩短验证，规格 §8.6）。 */
export const alignSnapshotMaxAgeMs = (env = process.env) => {
  const hours = Number(env.ALIGN_SNAPSHOT_MAX_AGE_HOURS);
  return Number.isFinite(hours) && hours > 0 ? hours * 3600_000 : ALIGN_SNAPSHOT_MAX_AGE_MS_DEFAULT;
};

const tsMs = (v) => {
  const t = v == null ? null : new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
};

/**
 * 数据签名（规格 §4）：sha1('|' 连接三段)
 *   skus:  skus.json 的 size + mtimeMs（文件变化即失效）
 *   games: games 表 count(*) + max(updated_at)（任何游戏行变化即失效）
 *   gsm:   game_source_map count(*) + max(coalesce(reviewed_at, created_at))（对齐决定变化即失效）
 * 任一变化 → 签名不同 → 后台重算；相同 → 直接用库快照。
 */
export async function computeAlignSignature({ q, skuFile = null }) {
  const file = skuFile ?? alignSkuFile();
  let skuPart;
  try {
    const st = statSync(file);
    skuPart = `skus:${st.size}:${Math.floor(st.mtimeMs)}`;
  } catch {
    skuPart = 'skus:0:0'; // 文件不存在按空处理（与 readAlignSkus 同口径）
  }
  const games = (await q('select count(*)::int as n, max(updated_at) as m from games')).rows[0] ?? {};
  const gsm = (await q('select count(*)::int as n, max(coalesce(reviewed_at, created_at)) as m from game_source_map')).rows[0] ?? {};
  const parts = [
    skuPart,
    `games:${Number(games.n ?? 0)}:${tsMs(games.m)}`,
    `gsm:${Number(gsm.n ?? 0)}:${tsMs(gsm.m)}`,
  ];
  return createHash('sha1').update(parts.join('|')).digest('hex');
}

/** 最新快照 = generated_at 倒序 limit 1（当前队列的唯一真相）。 */
export async function loadLatestAlignSnapshot(q) {
  const r = await q('select * from align_snapshots order by generated_at desc, id desc limit 1');
  return r.rows[0] ?? null;
}

/** 同事务场景：先锁最新行（FOR UPDATE 防并发操作丢更新），再取全行。无快照返回 null。 */
export async function loadLatestAlignSnapshotForUpdate(q) {
  const lock = await q('select id from align_snapshots order by generated_at desc, id desc limit 1 for update');
  const id = lock.rows[0]?.id;
  if (id == null) return null;
  return (await q('select * from align_snapshots where id = $1', [id])).rows[0] ?? null;
}

/** 只保留最近 ALIGN_SNAPSHOT_KEEP 条（规格 §8.8）。 */
export async function pruneAlignSnapshots(q) {
  await q(
    `delete from align_snapshots
      where id not in (select id from align_snapshots order by generated_at desc, id desc limit $1)`,
    [ALIGN_SNAPSHOT_KEEP],
  );
}

/** 写入一条新快照（成功路径）并 prune。 */
export async function insertAlignSnapshot(q, { payload, counts, signature, generatedMs = null }) {
  await q(
    `insert into align_snapshots (payload, counts, signature, generated_ms)
     values ($1::jsonb, $2::jsonb, $3, $4)`,
    [JSON.stringify(payload), JSON.stringify(counts), signature, generatedMs],
  );
  await pruneAlignSnapshots(q);
}

/**
 * 生成失败可见（规格 §7.2）：把失败原因写到最新快照行的 error 字段；
 * 表空时插一条空 payload 的失败行，让 GET 返回失败态而不是永远 202 生成中。
 */
export async function markAlignSnapshotError(q, message) {
  const reason = String(message ?? '未知错误').slice(0, 500);
  const latest = await loadLatestAlignSnapshot(q);
  if (latest) {
    await q('update align_snapshots set error = $1 where id = $2', [reason, latest.id]);
    return latest.id;
  }
  const r = await q(
    `insert into align_snapshots (payload, counts, signature, error)
     values ('{}'::jsonb, '{}'::jsonb, '', $1) returning id`,
    [reason],
  );
  return r.rows[0].id;
}

/** 队列里一个组的统计桶（与 alignGroupCounts 口径一致）：auto / manual / noCandidate。 */
export function groupBucket(group) {
  if (!group?.best) return 'noCandidate';
  return (group.best.score ?? 0) >= 0.94 ? 'auto' : 'manual';
}

/**
 * 动作后快照更新（纯函数，规格 §5 同事务语义的核心）：
 * 从 payload.items 移除已处理组、counts 相应递减（groups/skus 与 auto/manual/noCandidate 桶），
 * 钳制 ≥0；dirty 由调用方在 UPDATE 语句置位。
 * 反向自检：去掉这一步（操作后不更新快照）→「确认 3 组后立即刷新仍看到这 3 组」的测试必须红。
 */
export function applyAlignSnapshotAction(snapRow, { removedGroups = [] }) {
  const payload = snapRow?.payload && typeof snapRow.payload === 'object' ? snapRow.payload : { items: [] };
  const items = Array.isArray(payload.items) ? payload.items : [];
  const counts = snapRow?.counts && typeof snapRow.counts === 'object' ? snapRow.counts : {};
  const removeKeys = new Set(removedGroups.map((g) => g.key));
  const nextItems = items.filter((g) => !removeKeys.has(g.key));
  const nextCounts = { ...counts };
  const clamp = (k, v) => {
    if (nextCounts[k] == null) return;
    nextCounts[k] = Math.max(0, Number(nextCounts[k]) - v);
  };
  clamp('groups', removedGroups.length);
  clamp('skus', removedGroups.reduce((s, g) => s + (g.skuIds?.length ?? 0), 0));
  clamp('auto', removedGroups.filter((g) => groupBucket(g) === 'auto').length);
  clamp('manual', removedGroups.filter((g) => groupBucket(g) === 'manual').length);
  clamp('noCandidate', removedGroups.filter((g) => groupBucket(g) === 'noCandidate').length);
  return { payload: { ...payload, items: nextItems }, counts: nextCounts };
}

/** 同事务内执行的动作后快照更新（由 confirm/ignore 事务调用；行已 FOR UPDATE）。 */
export async function updateAlignSnapshotAfterAction(q, snapRow, { removedGroups = [] }) {
  const { payload, counts } = applyAlignSnapshotAction(snapRow, { removedGroups });
  await q(
    `update align_snapshots
        set payload = $2::jsonb, counts = $3::jsonb, dirty = true, last_action_at = now()
      where id = $1`,
    [snapRow.id, JSON.stringify(payload), JSON.stringify(counts)],
  );
}

/** restore 等「队列将因重算变化」的动作：只标 dirty + 触发后台重算，不做行级移除。 */
export async function markAlignSnapshotDirty(q, snapRow) {
  await q('update align_snapshots set dirty = true, last_action_at = now() where id = $1', [snapRow.id]);
}

/**
 * 后台生成入口（HTTP 触发与 CLI 调度任务共用）：
 * 1. 算签名 → 与最新快照相同且未超 24h → 直接用库快照（日志 align.snapshot_fresh）；
 * 2. 不同（或 force / 超龄）→ 重算 → **算完再取一次签名**（计算有幂等副作用：归档/补写会改 gsm）→
 *    写库前再比对最新快照签名（多实例并发不重复写）→ 插入新行 + prune；
 * 3. **动作竞态防护（规格 §5 的基石）**：计算期间若确认/忽略/恢复同事务更新过快照（dirty + last_action_at
 *    落在本轮计算窗口内），本轮结果基于动作前状态、会覆盖动作后的有效队列——重算重试（≤3 次）；
 *    仍撞上则**延后不覆盖**（返回 deferred，调用方链式触发下一轮）——快照永远保持「操作后有效队列」；
 * 4. 失败 → 写 error 字段 + 日志 align.snapshot_failed 并 rethrow（调度任务据此红条，规格 §7.2）。
 */
export async function ensureAlignSnapshot({ q, compute, logger, force = false, maxAgeMs = ALIGN_SNAPSHOT_MAX_AGE_MS_DEFAULT }) {
  const signature = await computeAlignSignature({ q });
  const latest = await loadLatestAlignSnapshot(q);
  const ageMs = latest ? Date.now() - tsMs(latest.generated_at) : Infinity;
  if (!force && latest && latest.signature === signature && ageMs < maxAgeMs) {
    logger?.info?.('align.snapshot_fresh', { signature });
    return { fresh: true, snapshot: latest, signature };
  }
  const startedAt = Date.now();
  try {
    // 动作竞态：计算窗口内快照被动作更新（last_action_at ≥ 本轮开始）→ 重算（最多 3 次）
    let result = null;
    let deferred = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const attemptStartedAt = Date.now();
      result = await compute({ onProgress: () => {} });
      const latestNow = await loadLatestAlignSnapshot(q);
      const actionDuring = Boolean(latestNow?.dirty && latestNow.last_action_at != null && tsMs(latestNow.last_action_at) >= attemptStartedAt);
      if (!actionDuring) {
        deferred = false;
        break;
      }
      deferred = true;
      logger?.info?.('align.snapshot_recompute_after_action', { attempt: attempt + 1 });
    }
    const payload = { items: result.groups, partial: Boolean(result.partial) };
    const counts = result.align.alignGroupCounts(result.groups, result.inherit, result.contentWords);
    // 计算副作用（内容词归档 / 断箭补写）会改 game_source_map——存「算后签名」，下一轮才是稳定比对基线
    const postSignature = await computeAlignSignature({ q });
    // 多实例：写库前比对最新快照签名，别人已写过同一结果就不重复写（规格 §7.5）
    const raced = await loadLatestAlignSnapshot(q);
    if (!force && raced && raced.signature === postSignature) {
      logger?.info?.('align.snapshot_fresh', { signature: postSignature, skipped: true });
      return { fresh: true, snapshot: raced, signature: postSignature };
    }
    // 重试后仍与动作重叠：本轮结果过时，不覆盖动作后的脏快照，等链式下一轮（triggerAlignGeneration 保证）
    if (deferred || (raced?.dirty && raced.last_action_at != null && tsMs(raced.last_action_at) >= startedAt)) {
      logger?.info?.('align.snapshot_reconcile_deferred', {});
      return { deferred: true, snapshot: raced, signature: postSignature };
    }
    await insertAlignSnapshot(q, {
      payload,
      counts,
      signature: postSignature,
      generatedMs: Date.now() - startedAt,
    });
    logger?.info?.('align.snapshot_generated', { groups: result.groups.length, counts, ms: Date.now() - startedAt, signature: postSignature });
    return { generated: true, signature: postSignature, snapshot: await loadLatestAlignSnapshot(q) };
  } catch (err) {
    const reason = String(err?.message ?? err).slice(0, 200);
    await markAlignSnapshotError(q, reason);
    logger?.error?.('align.snapshot_failed', { reason });
    throw err;
  }
}
