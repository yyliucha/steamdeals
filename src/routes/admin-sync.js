// CO-5/B4-2 第九轮（docs/DESIGN-AUDIT.md B4）：admin-sync 域路由模块——从 src/server.js
// 巨石抽出的第九个域（B4 队列 #9：后台手动同步任务 sync/heat/backfill/rename/circuit）。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · POST /api/admin/sync            一键同步（catalog/steam-prices/steamall/itad/gog/humble/sonkwo）
//   · GET  /api/admin/sync/status     同步状态（3s 短缓存 + 运行态/最近记录/调度/回填进度/四源统计/告警）
//   · GET  /api/admin/sync/runs       同步任务记录列表
//   · POST /api/admin/circuit/reset   手动重置任务熔断（内存态，同进程 scheduler 生效）
//   · POST /api/admin/backfill        数据回填（批量补全量元数据/价格，与同步共用子进程槽位）
//   · POST /api/admin/backfill/stop   停止回填（SIGTERM + 10s 后 SIGKILL 兜底）
//   · GET  /api/admin/backfill/status 回填状态（running/busy/progress/last）
//   · POST /api/admin/heat            热度回填（limit/batch/sleep 参数钳制）
//   · POST /api/admin/heat/stop       停止热度回填
//   · GET  /api/admin/heat/status     热度回填状态
//   · POST /api/admin/rename          重写名字（目录导入机器英文名 → 中文，默认间隔 1500ms）
//   · POST /api/admin/rename/stop     停止重写名字
//   · GET  /api/admin/rename/status   重写名字状态（running/busy/progress/last）
//
// 单入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3）：
//   · handleAdminSyncAdmin(ctx)：requireAdmin 就绪后的管理段——本域全部 13 条路由
//     （管理段形态先例=申诉域 handleAppealAdmin / 公告域 handleAnnouncementsAdmin /
//     admin-access 域 handleAdminAccessAdmin）。
//   返回值约定：true = 已处理并结束响应；false = 未命中本域，宿主继续。凡写过响应的分支
//   必须返回 true（json(...) 自身返回 undefined，直接 return json(...) 会让宿主误判未命中
//   继续跑完整条链 → 二次写头 ERR_HTTP_HEADERS_SENT）。
//
// 留在 server.js 的中间件与未拆段（不属于本域）：
//   · startSteamJob 宿主闭包——子进程槽位（spawn/kill/输出尾巴/落库）管理留在 server.js，
//     经 ctx 按引用传入（语义共享：本域全部任务与宿主共用同一槽位与状态）；
//   · syncState（{ child, run, output, settled, stopRequested }）进程级状态持有对象留在
//     server.js，经 ctx 按引用传入（语义共享：startSteamJob 闭包与路由读写同一份状态）；
//   · syncStatusCache / invalidateSyncStatusCache 短缓存留在 server.js 闭包，经 ctx 传入
//     （语义共享：任务启停/熔断重置后立即失效，路由与宿主同一份）；
//   · isLoggablePath 里 /api/admin/sync/status|runs 的访问日志豁免是中间件，留 server.js；
//   · /api/admin/steam-logs（B4 #12）、/api/admin/wishlists（B4 #16）、/api/admin/bulk
//     派发表条目（B4 #11）、/api/admin/smtp|emails 等（B4 #10）留本文件不动；
//   · 跨域共用 SQL（insertSyncRun/finishSyncRun/runningSyncRun/markStaleSyncRuns/
//     sourceSyncStats 等）留 pg.js（见 admin-sync-repository.js 头部归属判定）。
import * as db from '../store/pg.js';
import { auditJobs as auditSchedulerJobs, resetCircuit, jobsFromEnv, steamClaimArgs, syncRunModeFor } from '../scheduler.js';
import { readFileSync } from 'node:fs';

/**
 * FJ 批：组级立即运行的到期判定（纯函数，便于单测）——
 * 状态文件里没有 lastRunAt（从未跑过）视为到期；跑过的按 lastRunAt + intervalMin 到期。
 * 返回 { due: [...到期子步骤], skipped: [...未到期子步骤名] }。
 */
export function dueGroupSteps(steps, schedule) {
  const lastBy = new Map();
  for (const j of schedule?.jobs ?? []) {
    const ms = Date.parse(j.lastRunAt);
    if (Number.isFinite(ms)) lastBy.set(j.name, ms);
  }
  const now = Date.now();
  const due = steps.filter((s) => {
    const last = lastBy.get(s.name);
    return last == null ? true : now >= last + s.intervalMin * 60_000;
  });
  return { due, skipped: steps.filter((s) => !due.includes(s)).map((s) => s.name) };
}

/**
 * 管理段：server.js 在 requireAdmin 就绪之后调用——后台同步任务全部路由。
 * 每条分支自己 requireAdmin()（401/403 文案由宿主守卫统一输出，契约不变）。
 * ctx 域特有字段（§15.2，按引用传入、语义共享，勿改成拷贝）：
 *   · ctx.startSteamJob      宿主闭包——启动/互斥/记录 sync_runs（与 CLI 同表，跨请求共享槽位）；
 *   · ctx.syncState          进程级任务状态持有对象 { child, run, output, settled, stopRequested }；
 *   · ctx.syncStatusCache    短缓存对象 { value, at }——启停/熔断重置后失效，与宿主同份；
 *   · ctx.invalidateSyncStatusCache 宿主闭包——缓存失效；
 *   · ctx.syncStatusTtlMs    短缓存 TTL（测试注入，创建时定值，拷贝即可）。
 */
export async function handleAdminSyncAdmin(ctx) {
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
    startSteamJob,
    syncState,
    syncStatusCache,
    invalidateSyncStatusCache,
    syncStatusTtlMs,
  } = ctx;

  // 一键同步：把动作丢给子进程，避免 HTTP 请求挂几分钟。
  // 记录到 sync_runs（开始/结束/输出尾巴），前端轮询状态显示实时输出。
  // 控制台只暴露 catalog / steam-prices（全量补元数据已由 /api/admin/backfill 承担，
  // steamall 仍保留给 CLI 与老调用方，不再作为页面入口）。
  if (path === '/api/admin/sync' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    // CC 批（docs/SOURCE-SYNC-COVERAGE.md §3.4）：四源任务可后台立即运行（spawn `sync <mode>`）
    const MODES = new Set(['catalog', 'steam-prices', 'steamall', 'itad', 'gog', 'humble', 'sonkwo']);
    const mode = MODES.has(String(body.mode)) ? String(body.mode) : 'steam-prices';
    const args = ['src/cli.js', 'sync', mode];
    if (mode === 'steamall') {
      const limit = Math.min(Math.max(Number(body.limit ?? 200) || 200, 1), 2000);
      const sleep = Math.min(Math.max(Number(body.sleep ?? 2) || 2, 1), 30);
      args.push('--limit', String(limit), '--sleep', String(sleep));
    }
    try {
      const job = await startSteamJob({ mode, args, by: user.username });
      invalidateSyncStatusCache();
      json(res, 202, { started: true, runId: job.runId, mode, pid: job.pid });
      return true;
    } catch (err) {
      if (err.code === 'BUSY') {
        json(res, 409, { error: err.message, run: err.run });
        return true;
      }
      throw err;
    }
  }

  // ---- FJ 批（docs/SYNC-JOB-GROUPS.md）：组级立即运行 + steam-claim 手动分支 ----

  // 组级立即运行：跑组内到期子步骤（组内串行、顺序执行）。HTTP 立即返回 202，
  // 后台链式逐个启动（每个子步骤结束才启动下一个），前端轮询 /api/admin/sync/status 看进度。
  if (path.startsWith('/api/admin/sync/groups/') && path.endsWith('/run') && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const groupName = path.slice('/api/admin/sync/groups/'.length, -'/run'.length);
    const steps = jobsFromEnv(process.env).filter((j) => j.group === groupName);
    if (!steps.length) {
      json(res, 404, { error: '未知任务组' });
      return true;
    }
    // 到期判定：状态文件里没有 lastRunAt（从未跑过）视为到期；跑过的按 lastRunAt + intervalMin
    let schedule = null;
    try {
      schedule = JSON.parse(readFileSync(process.env.SCHEDULER_STATUS_FILE ?? 'data/scheduler-status.json', 'utf8'));
    } catch {
      schedule = null;
    }
    const { due: dueSteps, skipped } = dueGroupSteps(steps, schedule);
    if (!dueSteps.length) {
      json(res, 200, { started: false, group: groupName, reason: '组内没有到期的子步骤', skipped });
      return true;
    }
    // 后台链式顺序执行（组内串行，不并发抢同一目标源）；用户手动停止后不再启动组内下一个
    void (async () => {
      for (const step of dueSteps) {
        const mode = syncRunModeFor(step);
        try {
          await startSteamJob({ mode, args: ['src/cli.js', ...step.args], by: user.username });
        } catch (err) {
          logger?.error('api.group_run_step_failed', { group: groupName, mode, err: String(err?.message ?? err) });
          return;
        }
        while (!syncState.settled) await new Promise((r) => setTimeout(r, 1000));
        if (syncState.stopRequested) return;
      }
    })();
    invalidateSyncStatusCache();
    json(res, 202, { started: true, group: groupName, queued: dueSteps.map((s) => syncRunModeFor(s)), skipped });
    return true;
  }

  // steam-claim 手动分支：把历史未归属账号认领给指定用户一次（幂等，原 FJ 批移出的定时任务）
  if (path === '/api/admin/steam-claim' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const args = steamClaimArgs(process.env);
    if (!args) {
      json(res, 400, { error: '未配置 STEAM_CLAIM_USERNAME / STEAM_CLAIM_STEAM_ID' });
      return true;
    }
    try {
      const job = await startSteamJob({ mode: 'steam-claim', args: ['src/cli.js', ...args], by: user.username });
      invalidateSyncStatusCache();
      json(res, 202, { started: true, runId: job.runId, pid: job.pid });
      return true;
    } catch (err) {
      if (err.code === 'BUSY') {
        json(res, 409, { error: err.message, run: err.run });
        return true;
      }
      throw err;
    }
  }

  // （CO-4/B4：DR 批 /api/admin/app-sync、/api/admin/app-sync/status 已随 App 域抽到 src/routes/app.js）

  if (path === '/api/admin/sync/status' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    // B2 批（docs/DESIGN-AUDIT.md B2）：短缓存（TTL 3s）；任务启停/熔断重置后立即失效
    const syncStatusNow = Date.now();
    if (syncStatusCache.value && syncStatusNow - syncStatusCache.at < syncStatusTtlMs) {
      json(res, 200, syncStatusCache.value);
      return true;
    }
    const running = Boolean(syncState.child);
    const last = await db.listSyncRuns(q, { limit: 1 }).catch(() => []);
    let schedule = null;
    try {
      const file = process.env.SCHEDULER_STATUS_FILE ?? 'data/scheduler-status.json';
      schedule = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      schedule = null;
    }
    // FJ 批（docs/SYNC-JOB-GROUPS.md）：schedule 上补 steamClaimConfigured——后台「Steam 账号」组
    // 「认领未归属账号」按钮据此启用/禁用（未配置 STEAM_CLAIM_USERNAME/STEAM_CLAIM_STEAM_ID 时置灰）。
    if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
      schedule.steamClaimConfigured = Boolean(steamClaimArgs(process.env));
    }
    // BL-2（docs/BACKFILL-THROUGHPUT.md §3.4）：合并回填进度文件（只读文件，不加 DB 查询）
    const { readBackfillProgress } = await import('../backfill.js');
    // CC 批（docs/SOURCE-SYNC-COVERAGE.md §3.4）：四源状态汇总（matched/nomatch/failed/pending）
    const sourceStats = await db.sourceSyncStats(q).catch(() => null);
    const syncStatusPayload = {
      running,
      run: running ? syncState.run : null,
      output: syncState.output.slice(-6000),
      last: last[0] ?? null,
      schedule,
      backfillProgress: readBackfillProgress(),
      sourceStats,
      // AC1（docs/SYNC-FAILURE-MODES.md）：该有但没有的任务，后台显式提示（缺 Key / 被 *_ENABLED=0 关闭）
      warnings: auditSchedulerJobs(process.env),
    };
    syncStatusCache.value = syncStatusPayload;
    syncStatusCache.at = Date.now();
    json(res, 200, syncStatusPayload);
    return true;
  }

  if (path === '/api/admin/sync/runs' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const limit = Number(url.searchParams.get('limit') ?? 20);
    json(res, 200, { runs: await db.listSyncRuns(q, { limit }) });
    return true;
  }

  // AC-4/AC2（docs/SYNC-FAILURE-MODES.md AC2）：手动重置任务熔断（内存态，同进程 scheduler 生效）
  if (path === '/api/admin/circuit/reset' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const name = String(body.name ?? '').trim();
    if (!name) {
      json(res, 400, { error: '缺少任务名' });
      return true;
    }
    const handled = resetCircuit(name);
    logger?.info('api.circuit_reset', { name, by: user.username, handled });
    invalidateSyncStatusCache();
    json(res, 200, { ok: true, handled });
    return true;
  }

  // ---- 管理员：数据回填（批量补全量元数据/价格，与同步共用子进程槽位）----
  if (path === '/api/admin/backfill' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const { normalizeBackfillParams, backfillArgs } = await import('../backfill.js');
    const params = normalizeBackfillParams(body);
    try {
      const job = await startSteamJob({ mode: 'backfill', args: backfillArgs(params), params, by: user.username });
      logger?.info('api.backfill_started', { runId: job.runId, by: user.username, ...params });
      invalidateSyncStatusCache();
      json(res, 202, { started: true, runId: job.runId, pid: job.pid, params });
      return true;
    } catch (err) {
      if (err.code === 'BUSY') {
        json(res, 409, { error: err.message, run: err.run });
        return true;
      }
      throw err;
    }
  }

  if (path === '/api/admin/backfill/stop' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    if (!syncState.child) {
      json(res, 409, { error: '当前没有运行中的任务' });
      return true;
    }
    const child = syncState.child;
    const runId = syncState.run?.id ?? null;
    syncState.stopRequested = true;
    child.kill('SIGTERM');
    // 10 秒还没退就强杀，避免卡死子进程一直占着槽位
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* 已退出 */
      }
    }, 10000);
    killTimer.unref?.();
    logger?.warn('api.backfill_stop', { runId, pid: child.pid, by: user.username });
    invalidateSyncStatusCache();
    json(res, 202, { stopping: true, runId, pid: child.pid });
    return true;
  }

  if (path === '/api/admin/backfill/status' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const { parseBackfillProgress } = await import('../backfill.js');
    const isBackfill = syncState.run?.mode === 'backfill';
    const runs = await db.listSyncRuns(q, { limit: 10 }).catch(() => []);
    json(res, 200, {
      running: Boolean(syncState.child) && isBackfill,
      busy: Boolean(syncState.child),
      mode: syncState.run?.mode ?? null,
      run: syncState.run,
      output: syncState.output.slice(-6000),
      progress: isBackfill ? parseBackfillProgress(syncState.output) : null,
      last: runs.find((r) => r.mode === 'backfill') ?? null,
    });
    return true;
  }

  // ---- 管理员：热度回填（与同步/回填共用子进程槽位，天然互斥）----
  if (path === '/api/admin/heat' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const pickNum = (v, def, min, max) => Math.max(min, Math.min(Number(v ?? def) || def, max));
    const params = {
      limit: pickNum(body.limit, 200000, 1, 200000),
      batch: pickNum(body.batch, 30, 1, 100),
      sleep: pickNum(body.sleep, 1700, 0, 60000),
    };
    try {
      const job = await startSteamJob({
        mode: 'heat',
        args: ['heat', '--limit', String(params.limit), '--batch', String(params.batch), '--sleep', String(params.sleep)],
        params,
        by: user.username,
      });
      logger?.info('api.heat_started', { runId: job.runId, by: user.username, ...params });
      json(res, 202, { started: true, runId: job.runId, pid: job.pid, params });
      return true;
    } catch (err) {
      if (err.code === 'BUSY') {
        json(res, 409, { error: err.message, run: err.run });
        return true;
      }
      throw err;
    }
  }

  if (path === '/api/admin/heat/stop' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    if (!syncState.child) {
      json(res, 409, { error: '当前没有运行中的任务' });
      return true;
    }
    const child = syncState.child;
    const runId = syncState.run?.id ?? null;
    syncState.stopRequested = true;
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* 已退出 */
      }
    }, 10000);
    killTimer.unref?.();
    logger?.warn('api.heat_stop', { runId, pid: child.pid, by: user.username });
    json(res, 202, { stopping: true, runId, pid: child.pid });
    return true;
  }

  if (path === '/api/admin/heat/status' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const isHeat = syncState.run?.mode === 'heat';
    json(res, 200, {
      running: Boolean(syncState.child) && isHeat,
      busy: Boolean(syncState.child),
      mode: syncState.run?.mode ?? null,
      run: syncState.run,
      output: syncState.output.slice(-6000),
    });
    return true;
  }

  // ---- 管理员：重写名字（把目录导入留下的机器英文名换成中文，与同步/回填共用槽位）----
  if (path === '/api/admin/rename' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const { normalizeBackfillParams, renameArgs } = await import('../backfill.js');
    const params = normalizeBackfillParams(body);
    // rename 默认间隔 1500ms（比回填轻），控制台未传时按 1500
    if (body.sleep == null || body.sleep === '') params.sleep = 1500;
    try {
      const job = await startSteamJob({ mode: 'rename', args: renameArgs(params), params, by: user.username });
      logger?.info('api.rename_started', { runId: job.runId, by: user.username, ...params });
      json(res, 202, { started: true, runId: job.runId, pid: job.pid, params });
      return true;
    } catch (err) {
      if (err.code === 'BUSY') {
        json(res, 409, { error: err.message, run: err.run });
        return true;
      }
      throw err;
    }
  }

  if (path === '/api/admin/rename/stop' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    if (!syncState.child) {
      json(res, 409, { error: '当前没有运行中的任务' });
      return true;
    }
    const child = syncState.child;
    const runId = syncState.run?.id ?? null;
    syncState.stopRequested = true;
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* 已退出 */
      }
    }, 10000);
    killTimer.unref?.();
    logger?.warn('api.rename_stop', { runId, pid: child.pid, by: user.username });
    json(res, 202, { stopping: true, runId, pid: child.pid });
    return true;
  }

  if (path === '/api/admin/rename/status' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const { parseRenameProgress } = await import('../backfill.js');
    const isRename = syncState.run?.mode === 'rename';
    const runs = await db.listSyncRuns(q, { limit: 10 }).catch(() => []);
    json(res, 200, {
      running: Boolean(syncState.child) && isRename,
      busy: Boolean(syncState.child),
      mode: syncState.run?.mode ?? null,
      run: syncState.run,
      output: syncState.output.slice(-6000),
      progress: isRename ? parseRenameProgress(syncState.output) : null,
      last: runs.find((r) => r.mode === 'rename') ?? null,
    });
    return true;
  }

  // ---- FP 批 P2（docs/SYNC-HARDENING.md §2）：数据时效卡片 / 429 补跑队列 / 初始化全量同步 / steam-status 补跑 ----

  // 数据时效统计：价格/状态/中文名/图片各自「超 1/3/7 天未更新」数量（卡片数据源）
  if (path === '/api/admin/sync/freshness' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    json(res, 200, { stats: await db.dataFreshnessStats(q) });
    return true;
  }

  // 429 补跑队列统计（后台卡片可见：排队数/最早入队/最大重试次数）
  if (path === '/api/admin/sync/429queue' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    json(res, 200, await db.sync429QueueStats(q));
    return true;
  }

  // 初始化全量同步：一次性全量回填元数据/价格（与同步/回填共用槽位；429 收轮 exit 75 进度保留）
  if (path === '/api/admin/init-sync' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const limit = Math.max(1, Math.min(Number(body.limit ?? 200000) || 200000, 200000));
    try {
      const job = await startSteamJob({
        mode: 'init-sync',
        args: ['init-sync', '--limit', String(limit)],
        params: { limit },
        by: user.username,
      });
      logger?.info('api.init_sync_started', { runId: job.runId, by: user.username, limit });
      invalidateSyncStatusCache();
      json(res, 202, { started: true, runId: job.runId, pid: job.pid, params: { limit } });
      return true;
    } catch (err) {
      if (err.code === 'BUSY') {
        json(res, 409, { error: err.message, run: err.run });
        return true;
      }
      throw err;
    }
  }

  // steam-status 手动补跑（数据时效卡片「状态」一键补跑；参数钳制与 heat 同款）
  if (path === '/api/admin/steam-status' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const pickNum = (v, def, min, max) => Math.max(min, Math.min(Number(v ?? def) || def, max));
    const params = {
      limit: pickNum(body.limit, 20000, 1000, 200000),
      batch: pickNum(body.batch, 30, 1, 100),
      rate: pickNum(body.rate, 1500, 0, 60000),
    };
    try {
      const job = await startSteamJob({
        mode: 'steam-status',
        args: ['steam-status', '--limit', String(params.limit), '--batch', String(params.batch), '--rate', String(params.rate)],
        params,
        by: user.username,
      });
      logger?.info('api.steam_status_started', { runId: job.runId, by: user.username, ...params });
      invalidateSyncStatusCache();
      json(res, 202, { started: true, runId: job.runId, pid: job.pid, params });
      return true;
    } catch (err) {
      if (err.code === 'BUSY') {
        json(res, 409, { error: err.message, run: err.run });
        return true;
      }
      throw err;
    }
  }

  return false;
}
