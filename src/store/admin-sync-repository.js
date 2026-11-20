// CO-5/B4-2 第九轮（docs/DESIGN-AUDIT.md B4）：admin-sync 域（B4 队列 #9：手动同步任务
// sync/heat/backfill/rename/circuit）专属 SQL——从 src/store/pg.js 巨石抽出的第九个域 repository。
//
// 归属判定（§15.1「域专属 SQL 进 repository，通用 SQL 留 pg.js」）：
//   · 搬入本文件：listSyncRuns——只被本域路由使用（/api/admin/sync/status 最近一条、
//     /api/admin/sync/runs 列表、/api/admin/backfill|rename/status 的 last 回填），
//     且签名与拆分前完全一致；
//   · 留在 pg.js：sync_runs 其余函数跨模块共用——
//     insertSyncRun/finishSyncRun（src/cli.js 同步命令 runSyncTracked 也写同一张表，
//     B4 #18–#20 域）、runningSyncRun（src/scheduler.js 任务互斥）、markStaleSyncRuns
//     （server.js 服务启动时清理中断记录）、sourceSyncStats（cli.js 进度条与状态接口
//     共用）、observedSyncRunSeconds/lastFailedSyncRun/lastSyncRunStartedByMode
//     （scheduler.js 调度预算/失败原因/重启恢复）——一律不搬；
//   · sync_runs 表 DDL 在 pg.js（migrate() 消费），本文件不搬 DDL。
//
// pg.js 顶部 import + re-export 本文件，旧 db.* 导入签名永远不变。

/** 同步任务记录列表（含同一轮 fetch_runs 汇总），按 id 倒序。 */
export async function listSyncRuns(q, { limit = 20 } = {}) {
  // 附带同一轮任务在 fetch_runs 里的汇总（按 mode + 时间窗口就近匹配，取不到为 null）
  const r = await q(
    `select sr.id, sr.mode, sr.args, sr.status, sr.exit_code, sr.output, sr.started_at, sr.finished_at,
            fr.requests, fr.total, fr.ok, fr.skipped, fr.failed, fr.note as fetch_note
       from sync_runs sr
       left join lateral (
         select requests, total, ok, skipped, failed, note
           from fetch_runs
          where platform_code = sr.mode
            and started_at between sr.started_at - interval '3 minutes'
                              and coalesce(sr.finished_at, now()) + interval '3 minutes'
          order by abs(extract(epoch from (started_at - sr.started_at)))
          limit 1
       ) fr on true
      order by sr.id desc limit $1`,
    [Math.min(Math.max(Number(limit) || 20, 1), 100)],
  );
  return r.rows;
}
