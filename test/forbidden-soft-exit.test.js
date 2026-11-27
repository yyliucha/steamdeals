// FW-3（docs/SLOW-SYNC.md §1.3 决策 14/15、§3.1 退出码约定、§8 验收 1/5）：403 软退出（exit 76）。
//
// 三层锁：
//   1. 纯函数 softAbortExitCode：403（业务拒绝，非代理层）与 FORBIDDEN_COOLDOWN → 76；
//      COOLDOWN_ABORT / BACKUP_TIMEOUT → 75（回归）；代理层 CONNECT 403（proxyStatus 有值）不算 76。
//   2. applySoftAbort：真的把 process.exitCode 设成 76/75 并记 process.soft_abort（带 code）；
//      sync_runs 状态由 syncRunStatusFor 决定（软退出 = interrupted，不是 failed）——用真 pglite 落库验证。
//   3. 静态锁：cli.js 真的调这两个函数（删掉接线 → 本测试红）；cmdHeat 403 抛 FORBIDDEN_ROUND_END
//      且该分支不写 heat_at（docs/SLOW-SYNC.md §3.2 改动点表）。
//
// 反向自检口径：把 softAbortExitCode 里 403 分支删掉 → 第 1 组断言红；
// 把 cli.js 的 applySoftAbort 调用删掉 → 静态锁红；把 cmdHeat 的 403 分支删掉 → FORBIDDEN_ROUND_END 断言红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { softAbortExitCode, syncRunStatusFor, applySoftAbort } from '../src/soft-exit.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** 收集日志事件的假 logger（applySoftAbort 只用到 warn）。 */
function fakeLogger() {
  const events = [];
  return { events, warn: (event, fields) => events.push({ event, fields }) };
}

test('FW-3 exit 76 判定：Steam 业务 403（proxyStatus 空）与 FORBIDDEN_COOLDOWN → 76；代理层 403 / 429 / 普通错误不算', () => {
  const forbidden = Object.assign(new Error('Steam 返回 HTTP 403'), { status: 403, proxyStatus: null });
  assert.equal(softAbortExitCode(forbidden), 76, 'status=403 + proxyStatus=null（目标站拒绝）→ 76');
  const forbiddenNoKey = Object.assign(new Error('Steam 返回 HTTP 403'), { status: 403 });
  assert.equal(softAbortExitCode(forbiddenNoKey), 76, 'proxyStatus 缺失（undefined）同样按目标站拒绝');
  const proxyReject = Object.assign(new Error('Proxy response (403) !== 200 when HTTP Tunneling'), { status: 403, proxyStatus: 403 });
  assert.equal(softAbortExitCode(proxyReject), null, '代理层 CONNECT 403（proxyStatus 有值）不是 Steam 业务 403，交给代理切换/全池失败');
  const cooldown = Object.assign(new Error('Steam 处于 403 冷却期'), { status: 403, code: 'FORBIDDEN_COOLDOWN' });
  assert.equal(softAbortExitCode(cooldown), 76, '403 冷却期内不再请求 → 直接软收尾 76');
  assert.equal(softAbortExitCode(Object.assign(new Error('403'), { code: 'FORBIDDEN_ROUND_END', status: 403 })), 76, 'cmdHeat 的软收尾错误 → 76');

  // 75 回归：429 冷却超时 / 备份超时语义不变
  assert.equal(softAbortExitCode(Object.assign(new Error('429 冷却'), { code: 'COOLDOWN_ABORT', status: 429 })), 75);
  assert.equal(softAbortExitCode(Object.assign(new Error('备份超时'), { code: 'BACKUP_TIMEOUT' })), 75);

  // 非软退出：普通错误 / 502 / 无 status 的 4xx 错误照旧 failed
  assert.equal(softAbortExitCode(new Error('数据为空')), null);
  assert.equal(softAbortExitCode(Object.assign(new Error('502'), { status: 502 })), null);
  assert.equal(softAbortExitCode(null), null);
});

test('FW-3 exit 76 收口：applySoftAbort 设 process.exitCode=76 并记 process.soft_abort（带 code）；75 回归', () => {
  const logger = fakeLogger();
  const fakeProcess = { exitCode: 0 };
  const err = Object.assign(new Error('Steam 返回 HTTP 403（appid 730）'), { status: 403, code: 'FORBIDDEN_ROUND_END' });
  assert.equal(applySoftAbort(err, { mode: 'heat', logger, processObj: fakeProcess }), 76, '返回 76');
  assert.equal(fakeProcess.exitCode, 76, 'process.exitCode = 76（调度器据此判 partial）');
  assert.equal(logger.events.length, 1);
  assert.equal(logger.events[0].event, 'process.soft_abort', '日志事件名符合 域.动作');
  assert.equal(logger.events[0].fields.code, 'FORBIDDEN_ROUND_END', '带 code');
  assert.equal(logger.events[0].fields.exitCode, 76);

  // 75 回归
  const logger75 = fakeLogger();
  const p75 = { exitCode: 0 };
  assert.equal(applySoftAbort(Object.assign(new Error('429'), { code: 'COOLDOWN_ABORT' }), { mode: 'backfill', logger: logger75, processObj: p75 }), 75);
  assert.equal(p75.exitCode, 75, '429 冷却超时仍是 75（1 小时重排）');
  assert.equal(logger75.events[0].fields.code, 'COOLDOWN_ABORT');

  // 非软退出：不动 exitCode、不记事件
  const pOther = { exitCode: 0 };
  const loggerOther = fakeLogger();
  assert.equal(applySoftAbort(new Error('boom'), { logger: loggerOther, processObj: pOther }), null);
  assert.equal(pOther.exitCode, 0, '普通错误不改 exitCode（main 的 catch 会记 failed/exit 1）');
  assert.equal(loggerOther.events.length, 0);
});

test('FW-3 sync_runs 状态：403 软退出记 interrupted（不是 failed），真 pglite 落库验证；普通错误仍记 failed', async () => {
  assert.equal(syncRunStatusFor(Object.assign(new Error('403'), { status: 403, proxyStatus: null })), 'interrupted');
  assert.equal(syncRunStatusFor(Object.assign(new Error('403 冷却'), { code: 'FORBIDDEN_COOLDOWN', status: 403 })), 'interrupted');
  assert.equal(syncRunStatusFor(Object.assign(new Error('429'), { code: 'COOLDOWN_ABORT' })), 'interrupted');
  assert.equal(syncRunStatusFor(new Error('boom')), 'failed', '非软退出照旧 failed');

  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    // 与 runSyncTracked 的 catch 分支同序：判定状态 → finishSyncRun 落库
    const run403 = await db.insertSyncRun(q, { mode: 'heat', args: 'heat --limit 1' });
    await db.finishSyncRun(q, run403.id, { status: syncRunStatusFor(Object.assign(new Error('Steam 返回 HTTP 403'), { status: 403 })), output: '403 软收尾' });
    const row403 = (await q('select status, output from sync_runs where id = $1', [run403.id])).rows[0];
    assert.equal(row403.status, 'interrupted', '403 收尾的 sync_runs 是 interrupted（后台「同步记录」可见，不是失败）');
    assert.match(row403.output, /403/, '原因保留在 output 里');

    const run500 = await db.insertSyncRun(q, { mode: 'steam-status', args: 'steam-status' });
    await db.finishSyncRun(q, run500.id, { status: syncRunStatusFor(new Error('HTTP 500')), output: 'HTTP 500' });
    const row500 = (await q('select status from sync_runs where id = $1', [run500.id])).rows[0];
    assert.equal(row500.status, 'failed', '对照：普通错误仍是 failed（反向自检，证明不是所有错误都记 interrupted）');
  } finally {
    await store.close();
  }
});

test('FW-3 接线静态锁：cli.js 用 softAbortExitCode/syncRunStatusFor/applySoftAbort；cmdHeat 403 抛 FORBIDDEN_ROUND_END 且不写 heat_at', () => {
  const cli = read('src/cli.js');
  assert.match(cli, /import \{[^}]*softAbortExitCode[^}]*applySoftAbort[^}]*\} from '\.\/soft-exit\.js'/, 'cli.js 引入软退出判定模块');
  assert.match(cli, /const softAbortCode = softAbortExitCode\(err\)/, 'runSyncTracked 用 softAbortExitCode 判定（不是硬编码 err.code）');
  assert.match(cli, /finishSyncRunRecord\(run, syncRunStatusFor\(err\)/, 'sync_runs 状态由 syncRunStatusFor 决定（软退出 = interrupted）');
  assert.match(cli, /applySoftAbort\(err, \{ mode, logger \}\)/, '收口时设置 exitCode 并记 process.soft_abort');
  assert.doesNotMatch(cli, /err\?\.code === 'COOLDOWN_ABORT' \|\| err\?\.code === 'BACKUP_TIMEOUT'/, '旧的内联判定已移除（防两处口径分叉）');

  // cmdHeat（src/cli/ops.js）：403（含 FORBIDDEN_COOLDOWN）→ FORBIDDEN_ROUND_END + status 403，
  // 且该分支**不写 heat_at**（当前 appid 退避后优先补，进度只进不退）。
  const ops = read('src/cli/ops.js');
  const start = ops.indexOf("if (err.code === 'FORBIDDEN_COOLDOWN' || (err.status === 403 && err.proxyStatus == null))");
  assert.ok(start > 0, 'cmdHeat 有 403 软收尾分支');
  const block = ops.slice(start, start + 900);
  assert.match(block, /forbidden\.code = 'FORBIDDEN_ROUND_END'/, '抛带 code 的软收尾错误');
  assert.match(block, /forbidden\.status = 403/);
  assert.doesNotMatch(block, /setGameHeat|markHeatSkipped/, '403 分支不写 heat_at（不把当前 appid 标记为已处理）');
  assert.match(block, /sync\.forbidden_round_end/, '记 sync.forbidden_round_end 日志事件（docs/SLOW-SYNC.md §3.4）');
  // 429（COOLDOWN_ABORT）原样重抛仍在 403 分支之前
  assert.ok(
    ops.indexOf("if (err.code === 'COOLDOWN_ABORT') throw err;") < start,
    'COOLDOWN_ABORT 原样重抛在 403 分支之前（75 语义不变）',
  );
});

// FW-3（docs/SLOW-SYNC.md §1.3 决策 15、§8 验收第 5 条）：全 Steam 任务通用——不能只有 heat 收口。
// 中间层（steam-status 的逐款循环、fetchMetadata 的批量/回退）过去会把 403 当「这款没数据」吞掉，
// 结果整轮空转、最后记 failed（还会熔断）。FW-3 要求这些路径把 403 重抛给 runSyncTracked → exit 76。
test('FW-3 全 Steam 任务通用：steam-status / fetchMetadata / backfill 的 403 软收尾接线（删任一即红）', async () => {
  const { fetchMetadata } = await import('../src/adapters/steam-meta.js');
  // 真行为：mock 一个 403（无代理层 proxyStatus）→ fetchMetadata 必须重抛（不能返回空 items）。
  // 注意隔离 STEAM_403_FILE：http.js 会把 403 落盘成全局冷却，不隔离会污染同工作区的其它测试
  // （steam-meta.test.js 等按真实 data/steam-403.json 走冷却检查）。
  const prev403 = process.env.STEAM_403_FILE;
  const sandbox403 = join(tmpdir(), `fw3-meta-403-${process.pid}-${Date.now()}.json`);
  process.env.STEAM_403_FILE = sandbox403;
  try {
    const forbidden = () => Object.assign(new Error('Steam 返回 HTTP 403'), { status: 403, proxyStatus: null });
    await assert.rejects(
      () => fetchMetadata([730], { backend: 'official', fetchImpl: async () => { throw forbidden(); } }),
      (err) => softAbortExitCode(err) === 76,
      'fetchMetadata 遇 403 重抛（否则 backfill/rename 会把冷却期当「没数据」逐款空转）',
    );
  } finally {
    if (prev403 == null) delete process.env.STEAM_403_FILE;
    else process.env.STEAM_403_FILE = prev403;
    rmSync(sandbox403, { force: true });
  }

  // 静态锁：三处中间层都接入了统一判定
  const meta = read('src/adapters/steam-meta.js');
  assert.match(meta, /import \{ softAbortExitCode \} from '\.\.\/soft-exit\.js'/, 'steam-meta 引入统一判定');
  assert.equal([...meta.matchAll(/rethrowForbiddenSoftExit\(err\);/g)].length, 2, 'official 与 steamcmd 两个后端都重抛 403');
  const status = read('src/steam-status.js');
  assert.match(status, /if \(softAbortExitCode\(err\) === 76\) throw err;/, 'steam-status 逐款循环遇 403 立即收轮（不计数为失败、不空转）');
  const ops = read('src/cli/ops.js');
  const softStart = ops.indexOf('const softExit = (status) => {');
  assert.ok(softStart > 0, 'cmdBackfill 的 softExit 存在');
  const softBlock = ops.slice(softStart, softStart + 700);
  assert.match(softBlock, /if \(status === 403\) \{/, '403 走独立分支');
  assert.match(softBlock, /err\.status = 403;[\s\S]{0,80}throw err;/, '403 抛错给 runSyncTracked 统一收口（exit 76）');
  assert.match(softBlock, /process\.exitCode = 75;/, '429 仍走既有 exit 75（1 小时重排）不受影响');
});
// FW-3（docs/SLOW-SYNC.md §4、§8 验收第 7 条）：后台任务卡/任务表展示——不重设计操作区，只加状态 tag。
// 判据：任务组的子步骤行有 tag；数据来自 /api/admin/sync/status 的 forbidden / rateGate；
// 76 的失败原因走既有 partialReason（row.lastError ← scheduler-status.json 的 lastOutcome.error）。
// GA-1（docs/SYNC-PAGE-REDESIGN.md）：同步页搬到 composables/useSyncAdmin.js + components/sync/*，
// 两类 tag 收在子步骤行的「状态」格内联显示（原桌面表/移动卡片两套模板合成一套行内重排）。
test('FW-3 后台展示静态锁：任务组子步骤行有 403 冷却 / 速率闸门 tag，且读 status 新字段', () => {
  const vue = read('frontend/src/composables/useSyncAdmin.js');
  const table = read('frontend/src/components/sync/TaskGroupTable.vue');
  assert.match(vue, /state\.status\?\.forbidden/, 'tag 数据来自 status.forbidden');
  assert.match(vue, /state\.status\?\.rateGate/, 'tag 数据来自 status.rateGate');
  assert.match(vue, /403 冷却 · 剩余 \$\{left\} 分钟/, '文案：403 冷却 · 剩余 N 分钟');
  assert.match(vue, /速率闸门 已用 \$\{Math\.round\(used\)\}\/\$\{Math\.round\(perMin\)\}/, '文案：速率闸门 已用 N/M');
  assert.match(table, /<el-tag v-if="forbiddenTagText" type="info" size="small"/, '子步骤行状态格显示 403 冷却 tag');
  assert.match(table, /<el-tag v-if="rateGateTagText" type="info" size="small"/, '子步骤行状态格显示速率闸门 tag');
  assert.match(table, /<th>失败原因<\/th>/, '任务表保留「失败原因」列（不重设计操作区）');
  assert.match(table, /\{\{ partialReason\(s\) \}\}/, '76 的收尾原因通过既有「失败原因」列显示');
  assert.match(table, /return row\.lastError \|\| '—'/, 'partialReason 对非 backfill 任务取 row.lastError（= jobFailureError(76) 文案）');
  // scheduler-status.json 的 lastError 就是 outcome.error（76 时 = 「HTTP 403 收尾（进度已保留，下一轮继续）」）
  const sched = read('src/scheduler.js');
  assert.match(sched, /lastError: outcome \? outcome\.error : null/, '状态文件带 lastError（前端据此显示 403 收尾原因）');
  assert.match(sched, /lastResult: outcome \? outcome\.result : null/, '状态文件带 lastResult=partial（前端「部分完成」tag）');
});

