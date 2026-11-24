import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jobsFromEnv, jobGroupsFromEnv, groupsFromJobs, steamClaimArgs, dueJobs, describeSchedule, forwardedArgs, recordJobResult, isCircuited, CIRCUIT, followUpArgs, writeStatusFile, lightConcurrency, STEAM_HEAVY, planTick, lastRunMsFromRows, auditJobs, steamDailyBudgetMinutes, applySteamBudget, theoreticalRunSeconds, jobRuntimeEstimates, registerCircuitReset, resetCircuit, applyRetry, syncRunModeFor, jobFailureError, jobFailedReason, outcomeFor } from '../src/scheduler.js';

test('轻任务并行上限：SCHEDULER_LIGHT_CONCURRENCY 可调（1–8），默认 3，非法回落默认', () => {
  assert.equal(lightConcurrency({}), 3);
  assert.equal(lightConcurrency({ SCHEDULER_LIGHT_CONCURRENCY: '5' }), 5);
  assert.equal(lightConcurrency({ SCHEDULER_LIGHT_CONCURRENCY: '0' }), 1, '下限 1');
  assert.equal(lightConcurrency({ SCHEDULER_LIGHT_CONCURRENCY: '99' }), 8, '上限 8');
  assert.equal(lightConcurrency({ SCHEDULER_LIGHT_CONCURRENCY: 'abc' }), 3, '非法值回落默认');
});

// ---------------------------------------------------------------- AC-1 观测批（docs/SYNC-FAILURE-MODES.md）

const FULL_ENV = {
  STEAM_ENABLED: '1',
  STEAM_API_KEY: '0123456789ABCDEF0123456789ABCDEF',
  SONKWO_ENABLED: '1',
  ITAD_ENABLED: '1',
  GOG_ENABLED: '1',
  HUMBLE_ENABLED: '1',
  DISCOVER_ENABLED: '1',
  BACKUP_ENABLED: '1',
  PRUNE_ENABLED: '1',
  LOGS_PRUNE_ENABLED: '1',
  ALERTS_ENABLED: '1',
  IMAGES_ENABLED: '1',
  REPORT_ENABLED: '0',
};

test('AC1：auditJobs——缺 Key 提示 catalog/steam-accounts，被 *_ENABLED=0 关掉的任务逐条提示，配置齐全为空', () => {
  const missingKey = auditJobs({ ...FULL_ENV, STEAM_API_KEY: '' });
  assert.ok(missingKey.some((w) => w.name === 'catalog' && /STEAM_API_KEY/.test(w.reason)), '缺 Key 要提示 catalog');
  assert.ok(missingKey.some((w) => w.name === 'steam-accounts' && /STEAM_API_KEY/.test(w.reason)), '缺 Key 要提示 steam-accounts');

  const disabled = auditJobs({ ...FULL_ENV, STEAM_ENABLED: '0', SONKWO_ENABLED: '0' });
  assert.ok(disabled.some((w) => w.name === 'heat' && w.reason === 'STEAM_ENABLED=0'));
  assert.ok(disabled.some((w) => w.name === 'steam-prices' && w.reason === 'STEAM_ENABLED=0'));
  assert.ok(disabled.some((w) => w.name === 'sonkwo' && w.reason === 'SONKWO_ENABLED=0'));

  assert.deepEqual(auditJobs(FULL_ENV), [], '配置齐全时不应有警告');
});

test('AC11：状态文件带健康面板字段（耗时/结果/失败原因）与 AC5 排队信息', () => {
  const file = join(tmpdir(), `scheduler-status-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const jobs = jobsFromEnv({});
  const lastRunMs = new Map([['heat', Date.now() - 1000]]);
  const lastOutcome = new Map([['heat', { elapsedMs: 1234, result: 'failed', error: 'exit code 1' }]]);
  const waitingSince = new Map([['steam-status', { at: Date.now() - 5000, occupiedBy: 'steam-prices' }]]);
  writeStatusFile(jobs, { lastRunMs, health: new Map(), running: new Set(), tickMs: 60000, lastOutcome, waitingSince, file });
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    const heat = payload.jobs.find((j) => j.name === 'heat');
    assert.equal(heat.lastElapsedMs, 1234);
    assert.equal(heat.lastResult, 'failed');
    assert.equal(heat.lastError, 'exit code 1');
    assert.equal(heat.waitingFor, null, '没在排队的任务不写 waitingFor');
    const status = payload.jobs.find((j) => j.name === 'steam-status');
    assert.equal(status.waitingFor.occupiedBy, 'steam-prices');
    assert.ok(status.waitingFor.since);
  } finally {
    rmSync(file, { force: true });
  }
});

test('默认任务表（FJ 批：按 12 组顺序重排，steam-claim 已移出定时），各自间隔', () => {
  const jobs = jobsFromEnv({});
  assert.deepEqual(jobs.map((j) => j.name), [
    'steam-prices', 'steam-status', 'rating-backfill', 'backfill', 'rename', 'sonkwo', 'itad', 'gog', 'humble',
    'steam-discovery', 'discover', 'images', 'images-backfill', 'readmodel', 'search-tokens-rebuild', 'prune', 'logs', 'backup',
    'heat', 'app-release-sync', 'align-snapshot', 'proxy-probe', 'alerts',
  ]);
  const interval = (name) => jobs.find((j) => j.name === name).intervalMin;
  assert.equal(interval('steam-prices'), 1440, 'Steam 价格默认每天刷新');
  assert.equal(interval('heat'), 1440, '热度默认每天刷新（首轮自动播种，之后刷过期条目）');
  assert.equal(interval('steam-status'), 1440, 'Steam 状态判定默认每天一次（X 批）');
  assert.equal(interval('rename'), 10080, '重写名字默认每周一次');
  assert.equal(interval('rating-backfill'), 1440, 'EF 批：内容分级回填默认每天一轮（cc=us 重采描述符）');
  assert.equal(interval('backfill'), 1440, 'BL 批：增量回填默认每天一轮');
  assert.equal(interval('prune'), 10080, '清理默认每周一次');
  assert.equal(interval('readmodel'), 1440, 'AV 批：读模型对账默认每天一次');
  assert.equal(interval('proxy-probe'), 10, 'BB 批：代理健康探测默认每 10 分钟');
  assert.equal(interval('itad'), 1440);
  assert.equal(interval('gog'), 720);
  assert.equal(interval('humble'), 720);
  assert.equal(interval('discover'), 720);
  assert.equal(interval('backup'), 1440, '备份每天一次');
  assert.equal(interval('logs'), 7 * 1440, '日志每 7 天清理一次');
  assert.equal(interval('alerts'), 360);
  assert.equal(interval('images'), 240, '封面图补缓存默认每 4 小时');
  assert.equal(interval('images-backfill'), 360, 'EC 批：缺图回填默认每 6 小时一轮');
  assert.equal(interval('app-release-sync'), 15, 'DR 批：App Release 同步默认每 15 分钟（原 60；settings app.syncIntervalMin 热加载可改）');
  assert.equal(interval('align-snapshot'), 30, 'DL 批：对齐审核快照后台生成默认每 30 分钟');
  const args = (name) => jobs.find((j) => j.name === name).args;
  assert.deepEqual(args('discover'), ['discover', 'sonkwo', '--ahead', '60', '--max-misses', '12']);
  assert.deepEqual(args('backup'), ['backup']);
  assert.deepEqual(args('images'), ['images', 'pull', '--limit', '500', '--sleep', '300'], 'BC 批：每轮补图默认 500');
  assert.deepEqual(args('images-backfill'), ['images', 'backfill', '--limit', '100', '--sleep', '1200'], 'EC 批：缺图回填默认每轮 100 款、限速 1.2s/请求');
  assert.ok(!jobsFromEnv({ IMAGES_BACKFILL_ENABLED: '0' }).some((j) => j.name === 'images-backfill'), 'EC 批：IMAGES_BACKFILL_ENABLED=0 可关闭');
  assert.deepEqual(args('steam-prices'), ['sync', 'steam-prices', '--limit', '200000', '--batch', '5000'], 'EU-2：价格刷新默认每轮分批 5000（约 4–5 分钟，批间落断点）');
  assert.deepEqual(args('heat'), ['heat', '--limit', '20000', '--sleep', '1700']);
  assert.deepEqual(args('steam-status'), ['steam-status', '--limit', '6000', '--rate', '1500']);
  assert.deepEqual(args('rename'), ['rename', '--limit', '200000', '--batch', '100', '--sleep', '1500']);
  assert.deepEqual(args('rating-backfill'), ['rating-backfill', '--limit', '5000', '--batch', '30', '--rate', '1500'], 'EF 批：分级回填默认每天上限 5000、限速 1.5s/款');
  assert.deepEqual(args('backfill'), ['backfill', '--limit', '5000', '--batch', '100', '--sleep', '3000'], 'BL 批：回填默认每天上限 5000');
  assert.deepEqual(args('prune'), ['prune']);
  assert.deepEqual(args('readmodel'), ['readmodel', 'check', '--sample', '200', '--fix'], 'B5 批：每日抽样 200 对账 + 自动修复（手动 check 默认仍只报告）');
  assert.equal(interval('search-tokens-rebuild'), 360, 'DS 批：搜索 token 增量重建默认每 6 小时一轮');
  assert.deepEqual(args('search-tokens-rebuild'), ['search-tokens', '--limit', '50000'], 'DS 批：每轮上限 5 万行（轻任务，无 Steam 请求）');
  assert.ok(!jobsFromEnv({ SEARCH_TOKENS_ENABLED: '0' }).some((j) => j.name === 'search-tokens-rebuild'), 'DS 批：SEARCH_TOKENS_ENABLED=0 可关闭');
  assert.deepEqual(args('proxy-probe'), ['probe', '--proxy'], 'BB 批：探测命令与参数');
  assert.ok(!jobsFromEnv({ PROXY_PROBE_ENABLED: '0' }).some((j) => j.name === 'proxy-probe'), 'BB 批：PROXY_PROBE_ENABLED=0 可关闭');
});

test('DL align-snapshot：默认开、30 分钟间隔、首轮延迟 30 秒；env 可覆盖；显式可关', () => {
  const def = jobsFromEnv({}).find((j) => j.name === 'align-snapshot');
  assert.ok(def, '默认启用（ALIGN_SNAPSHOT_ENABLED !== 0）');
  assert.deepEqual(def.args, ['align-snapshot'], 'CLI 子命令 args');
  assert.equal(def.intervalMin, 30, '默认每 30 分钟');
  assert.equal(def.initialDelaySec, 30, '首轮延迟 30 秒（空表兜底生成）');

  const custom = jobsFromEnv({
    ALIGN_SNAPSHOT_INTERVAL_MIN: '10',
    ALIGN_SNAPSHOT_INITIAL_DELAY_SEC: '5',
  }).find((j) => j.name === 'align-snapshot');
  assert.equal(custom.intervalMin, 10, '间隔 env 可调');
  assert.equal(custom.initialDelaySec, 5, '首轮延迟 env 可调');

  assert.ok(!jobsFromEnv({ ALIGN_SNAPSHOT_ENABLED: '0' }).some((j) => j.name === 'align-snapshot'), 'ALIGN_SNAPSHOT_ENABLED=0 可关闭');
  // 失败原因进健康条：syncRunModeFor 按命令名取 mode
  assert.equal(syncRunModeFor({ name: 'align-snapshot', args: ['align-snapshot'] }), 'align-snapshot', '任务 → sync_runs mode 映射');
});

test('目录同步任务：有 STEAM_API_KEY 才出现，参数可覆盖，STEAM_ENABLED=0 一并关闭', () => {
  const key = '0123456789ABCDEF';
  const withKey = jobsFromEnv({ STEAM_API_KEY: key }).find((j) => j.name === 'catalog');
  assert.ok(withKey, '配了 key 应有目录同步任务');
  assert.deepEqual(withKey.args, ['sync', 'catalog']);
  assert.equal(withKey.intervalMin, 10080);
  assert.equal(withKey.initialDelaySec, 3600);

  assert.ok(!jobsFromEnv({}).some((j) => j.name === 'catalog'), '没有 key 不该出现目录同步任务');
  assert.ok(
    !jobsFromEnv({ STEAM_API_KEY: key, STEAM_ENABLED: '0' }).some((j) => j.name === 'catalog'),
    'STEAM_ENABLED=0 时关闭',
  );

  const custom = jobsFromEnv({
    STEAM_API_KEY: key,
    STEAM_CATALOG_INTERVAL_MIN: '60',
    STEAM_CATALOG_INITIAL_DELAY_SEC: '30',
  }).find((j) => j.name === 'catalog');
  assert.equal(custom.intervalMin, 60);
  assert.equal(custom.initialDelaySec, 30);
});

test('Steam 账号同步任务：有 STEAM_API_KEY 才出现，间隔/首轮延迟/账号间隔可覆盖', () => {
  const key = '0123456789ABCDEF';
  const job = jobsFromEnv({ STEAM_API_KEY: key }).find((j) => j.name === 'steam-accounts');
  assert.ok(job, '配了 key 应有账号同步任务');
  assert.deepEqual(job.args, ['steam-accounts', '--sleep', '1000']);
  assert.equal(job.intervalMin, 1440, '默认每天同步一次绑定账号');
  assert.equal(job.initialDelaySec, 1500);

  assert.ok(!jobsFromEnv({}).some((j) => j.name === 'steam-accounts'), '没有 key 不该出现账号同步任务');
  assert.ok(
    !jobsFromEnv({ STEAM_API_KEY: key, STEAM_ENABLED: '0' }).some((j) => j.name === 'steam-accounts'),
    'STEAM_ENABLED=0 时关闭',
  );

  const custom = jobsFromEnv({
    STEAM_API_KEY: key,
    STEAM_ACCOUNTS_INTERVAL_MIN: '60',
    STEAM_ACCOUNTS_INITIAL_DELAY_SEC: '30',
    STEAM_ACCOUNTS_SLEEP_MS: '2000',
  }).find((j) => j.name === 'steam-accounts');
  assert.deepEqual(custom.args, ['steam-accounts', '--sleep', '2000']);
  assert.equal(custom.intervalMin, 60);
  assert.equal(custom.initialDelaySec, 30);
});

test('FJ steam-claim：已移出定时任务，steamClaimArgs 只在配置齐全时返回命令（后台手动按钮用）', () => {
  assert.ok(
    !jobsFromEnv({ STEAM_CLAIM_USERNAME: 'admin', STEAM_CLAIM_STEAM_ID: '76561198000000000' }).some((j) => j.name === 'steam-claim'),
    'FJ 批：steam-claim 不再出现在定时任务表',
  );
  assert.equal(steamClaimArgs({}), null, '未配置返回 null');
  assert.equal(steamClaimArgs({ STEAM_CLAIM_USERNAME: 'admin' }), null, '缺 SteamID 返回 null');
  assert.equal(steamClaimArgs({ STEAM_CLAIM_STEAM_ID: '76561198000000000' }), null, '缺用户名返回 null');
  assert.deepEqual(
    steamClaimArgs({ STEAM_CLAIM_USERNAME: 'admin', STEAM_CLAIM_STEAM_ID: '76561198000000000' }),
    ['steam-claim', 'admin', '76561198000000000'],
    '配置齐全返回 CLI 命令（trim 后）',
  );
});

test('重写名字任务：参数与间隔可用环境变量覆盖，STEAM_ENABLED=0 一并关闭', () => {
  const custom = jobsFromEnv({
    STEAM_RENAME_LIMIT: '5000',
    STEAM_RENAME_INTERVAL_MIN: '60',
    STEAM_RENAME_INITIAL_DELAY_SEC: '30',
  }).find((j) => j.name === 'rename');
  assert.deepEqual(custom.args, ['rename', '--limit', '5000', '--batch', '100', '--sleep', '1500']);
  assert.equal(custom.intervalMin, 60);
  assert.equal(custom.initialDelaySec, 30);

  const off = jobsFromEnv({ STEAM_ENABLED: '0' });
  assert.ok(!off.some((j) => j.name === 'rename'), 'STEAM_ENABLED=0 时应关闭');
  assert.ok(!off.some((j) => j.name === 'steam-prices'));
  assert.ok(!off.some((j) => j.name === 'heat'));
});

test('配置了提醒通道才会启用价格报表推送任务', () => {
  const off = jobsFromEnv({});
  assert.ok(!off.some((j) => j.name === 'report'), '没有通道时不该有 report 任务');

  const on = jobsFromEnv({ ALERT_WEBHOOK_URL: 'https://example.com/hook' });
  const report = on.find((j) => j.name === 'report');
  assert.ok(report, '有通道时应启用');
  assert.deepEqual(report.args, ['report', 'price', '--hours', '24', '--notify']);

  const disabled = jobsFromEnv({ ALERT_WEBHOOK_URL: 'https://example.com/hook', REPORT_ENABLED: '0' });
  assert.ok(!disabled.some((j) => j.name === 'report'), 'REPORT_ENABLED=0 可关闭');
});

test('没配任何提醒通道时 alerts 只做只读检查，不标记已通知', () => {
  assert.deepEqual(jobsFromEnv({}).find((j) => j.name === 'alerts').args, ['alerts']);
  assert.deepEqual(jobsFromEnv({ ALERT_WEBHOOK_URL: 'https://example.com/hook' }).find((j) => j.name === 'alerts').args, [
    'alerts',
    '--mark',
  ]);
  // 企业微信 / 邮件任一配好，也应该在检查后标记
  assert.deepEqual(jobsFromEnv({ WECOM_WEBHOOK_URL: 'https://qyapi.weixin.qq.com/x' }).find((j) => j.name === 'alerts').args, ['alerts', '--mark']);
  assert.deepEqual(
    jobsFromEnv({ SMTP_HOST: 'smtp.example.com', ALERT_EMAIL_TO: 'a@x.com' }).find((j) => j.name === 'alerts').args,
    ['alerts', '--mark'],
  );
});

test('环境变量能改间隔与首轮延迟', () => {
  const jobs = jobsFromEnv({ STEAM_PRICE_INTERVAL_MIN: '15', SONKWO_INITIAL_DELAY_SEC: '5' });
  assert.equal(jobs.find((j) => j.name === 'steam-prices').intervalMin, 15);
  assert.equal(jobs.find((j) => j.name === 'sonkwo').initialDelaySec, 5);
});

test('AB 批：steam-status 的 limit 与 initialDelaySec 读环境变量（Y 批设置项水合）', () => {
  const jobs = jobsFromEnv({ STEAM_STATUS_LIMIT: '8000', STEAM_STATUS_INITIAL_DELAY_SEC: '1800' });
  const job = jobs.find((j) => j.name === 'steam-status');
  assert.deepEqual(job.args, ['steam-status', '--limit', '8000', '--rate', '1500'], 'limit 从 env 读');
  assert.equal(job.initialDelaySec, 1800, 'initialDelaySec 从 env 读');
});

test('显式禁用或间隔为 0 的任务会被剔除', () => {
  const jobs = jobsFromEnv({
    ITAD_ENABLED: '0',
    STEAM_PRICE_INTERVAL_MIN: '0',
    STEAM_STATUS_INTERVAL_MIN: '0',
    GOG_ENABLED: '0',
    HUMBLE_ENABLED: '0',
    DISCOVER_ENABLED: '0',
    BACKUP_ENABLED: '0',
    LOGS_PRUNE_ENABLED: '0',
    IMAGES_ENABLED: '0',
    READMODEL_ENABLED: '0',
    PROXY_PROBE_ENABLED: '0',
  });
  assert.deepEqual(jobs.map((j) => j.name), ['rating-backfill', 'backfill', 'rename', 'sonkwo', 'steam-discovery', 'images-backfill', 'search-tokens-rebuild', 'prune', 'heat', 'app-release-sync', 'align-snapshot', 'alerts']);
});

test('从未跑过的任务在 initialDelay 之后才算到点', () => {
  const jobs = jobsFromEnv({ STEAM_INITIAL_DELAY_SEC: '30', SONKWO_INITIAL_DELAY_SEC: '180', PROXY_PROBE_ENABLED: '0', ALIGN_SNAPSHOT_ENABLED: '0' });
  const startedMs = 1_000_000;
  const lastRunMs = new Map();

  assert.equal(dueJobs(jobs, { nowMs: startedMs, startedMs, lastRunMs }).length, 0);
  assert.equal(dueJobs(jobs, { nowMs: startedMs + 29_000, startedMs, lastRunMs }).length, 0);
  assert.deepEqual(
    dueJobs(jobs, { nowMs: startedMs + 31_000, startedMs, lastRunMs }).map((j) => j.name),
    ['steam-prices'],
  );
  assert.deepEqual(
    dueJobs(jobs, { nowMs: startedMs + 181_000, startedMs, lastRunMs }).map((j) => j.name),
    ['steam-prices', 'sonkwo'],
  );
});

test('跑过的任务按间隔再次到点', () => {
  const jobs = jobsFromEnv({});
  const startedMs = 0;
  const steam = jobs[0];
  const lastRunMs = new Map([['steam-prices', 1_000_000]]);

  assert.equal(dueJobs([steam], { nowMs: 1_000_000 + 59 * 60_000, startedMs, lastRunMs }).length, 0);
  assert.equal(dueJobs([steam], { nowMs: 1_000_000 + 1440 * 60_000, startedMs, lastRunMs }).length, 1);
});

test('唯一一个跑过的任务不影响其它任务的首次触发', () => {
  const jobs = jobsFromEnv({ SONKWO_INITIAL_DELAY_SEC: '60', ALIGN_SNAPSHOT_ENABLED: '0' });
  const startedMs = 0;
  const lastRunMs = new Map([['steam-prices', 500]]);
  const due = dueJobs(jobs, { nowMs: 60_000, startedMs, lastRunMs });
  assert.deepEqual(due.map((j) => j.name), ['sonkwo']);
});

test('describeSchedule 能生成可读描述', () => {
  const text = describeSchedule(jobsFromEnv({}));
  assert.match(text, /steam-prices 每 1440 分钟/);
  assert.match(text, /itad 每 1440 分钟/);
});

test('通用参数会透传给子任务（--db 不能丢）', () => {
  assert.deepEqual(
    forwardedArgs(['node', 'scheduler.js', '--db', 'pglite:./data/pgdata', '--level', 'debug']),
    ['--db', 'pglite:./data/pgdata', '--level', 'debug'],
  );
  assert.deepEqual(forwardedArgs(['node', 'scheduler.js', '--db']), [], '缺值时不透传');
  assert.deepEqual(forwardedArgs(['node', 'scheduler.js', '--db', '--level', 'info']), ['--level', 'info']);
  assert.deepEqual(forwardedArgs(['node', 'scheduler.js']), []);
});

test('熔断：连失败到阈值才打开，成功后立刻复位', () => {
  const t0 = 1_000_000;
  let state = { failures: 0, openUntil: null };

  state = recordJobResult(state, { code: 1, nowMs: t0 });
  assert.equal(state.failures, 1);
  assert.equal(isCircuited(state, t0), false, '一次失败不该熔断');

  state = recordJobResult(state, { code: 1, nowMs: t0 + 1000 });
  assert.equal(state.failures, 2);
  assert.equal(isCircuited(state, t0 + 1000), false);

  state = recordJobResult(state, { code: 1, nowMs: t0 + 2000 });
  assert.equal(state.failures, 3);
  assert.equal(state.opened, true);
  assert.equal(isCircuited(state, t0 + 3000), true, '达到阈值后应熔断');

  const success = recordJobResult(state, { code: 0, nowMs: t0 + 4000 });
  assert.equal(success.failures, 0);
  assert.equal(success.openUntil, null);
  assert.equal(isCircuited(success, t0 + 4000), false, '成功一次即复位');
});

test('熔断窗口到期后自动恢复', () => {
  const t0 = 1_000_000;
  const state = { failures: CIRCUIT.threshold, openUntil: t0 + CIRCUIT.cooldownMs };
  assert.equal(isCircuited(state, t0 + CIRCUIT.cooldownMs - 1), true);
  assert.equal(isCircuited(state, t0 + CIRCUIT.cooldownMs), false);
});

test('E4 日志 schema：jobFailedReason 稳定短码（75 软退出 / 真实原因 / 回退退出码）', () => {
  assert.equal(jobFailedReason(75, null), 'http_429_soft_exit');
  assert.equal(jobFailedReason(1, 'HTTP 502 Bad Gateway'), 'HTTP 502 Bad Gateway');
  assert.equal(jobFailedReason(1, null), 'exit_1', '取不到 sync_runs 原因时回退退出码');
  assert.equal(jobFailedReason(-1, null), 'exit_-1');
});

test('采集成功后自动重建曲线页：失败不触发、非采集任务不触发、可关闭', () => {
  assert.deepEqual(followUpArgs('sonkwo', 0, {}), ['chart']);
  assert.deepEqual(followUpArgs('gog', 0, {}), ['chart']);
  assert.deepEqual(followUpArgs('discover', 0, {}), ['chart']);
  assert.deepEqual(followUpArgs('rename', 0, {}), ['chart'], '重写名字后也要重建页面');
  assert.deepEqual(followUpArgs('backfill', 0, {}), ['chart'], '增量回填写入报价后也要重建页面');

  assert.equal(followUpArgs('sonkwo', 1, {}), null, '任务失败不该重建');
  assert.equal(followUpArgs('alerts', 0, {}), null, '提醒任务不重建');
  assert.equal(followUpArgs('sonkwo', 0, { CHART_ON_SYNC: '0' }), null, 'CHART_ON_SYNC=0 关闭');
});

test('状态文件：从未跑过的任务 nextRunAt 按首轮延迟计算，跑过的按间隔', () => {
  const jobs = [{ name: 'rename', intervalMin: 10080, initialDelaySec: 7200 }];
  const file = join(tmpdir(), `scheduler-status-${Date.now()}.json`);
  try {
    writeStatusFile(jobs, { lastRunMs: new Map(), health: new Map(), running: new Set(), file });
    const p1 = JSON.parse(readFileSync(file, 'utf8'));
    const now = Date.now();
    const first = new Date(p1.jobs[0].nextRunAt).getTime();
    assert.ok(Math.abs(first - (now + 7200_000)) < 60_000, '首轮应为 now + 7200s，而不是 now + 一周');

    const last = now - 1000;
    writeStatusFile(jobs, { lastRunMs: new Map([['rename', last]]), health: new Map(), running: new Set(), file });
    const p2 = JSON.parse(readFileSync(file, 'utf8'));
    const second = new Date(p2.jobs[0].nextRunAt).getTime();
    assert.ok(Math.abs(second - (last + 10080 * 60_000)) < 60_000, '跑过的按间隔计算');
  } finally {
    rmSync(file, { force: true });
  }
});

test('X 批：steam-status 归入重任务集合（与价格/热度/回填共用单槽，串行互斥）', () => {
  assert.ok(STEAM_HEAVY.has('steam-status'), 'steam-status 必须走重任务槽');
  assert.ok(STEAM_HEAVY.has('steam-prices'));
  assert.ok(STEAM_HEAVY.has('heat'));
  assert.ok(!STEAM_HEAVY.has('sonkwo'), '杉果仍是轻任务');
  assert.ok(!STEAM_HEAVY.has('alerts'), '提醒仍是轻任务');
});

test('X 批：重任务占用单槽期间轻任务照常派发（P0-1 回归）', () => {
  const key = '0123456789ABCDEF';
  const due = jobsFromEnv({ STEAM_API_KEY: key });
  const running = new Set(['steam-prices']);
  const plan = planTick({ due, heavySlot: 'steam-prices', running, lightMax: 20 });
  assert.equal(plan.heavy.length, 0, '重任务槽被占时不再排新的重任务');
  const lightNames = plan.light.map((j) => j.name);
  assert.ok(lightNames.includes('sonkwo'), 'steam-prices 跑 90 分钟期间 sonkwo 不被饿死');
  assert.ok(lightNames.includes('alerts'), 'alerts 不被饿死');
  assert.ok(lightNames.includes('steam-accounts'), 'steam-accounts 不被饿死');
  assert.ok(lightNames.includes('gog'), 'gog 不被饿死');
  assert.ok(plan.light.every((j) => !STEAM_HEAVY.has(j.name)), '轻任务列表不含重任务');
  assert.ok(!lightNames.includes('steam-prices'), '运行中的任务不重复派发');

  const plan2 = planTick({ due, heavySlot: null, running: new Set(), lightMax: 3 });
  assert.ok(plan2.heavy.some((j) => j.name === 'steam-prices'), '空槽时重任务可派发');
  assert.ok(plan2.heavy.some((j) => j.name === 'steam-status'), 'steam-status 走重任务槽');

  // 并行上限只约束轻任务：lightMax=1 时只发一个轻任务（prune/app-release-sync 等非重非轻不受上限）
  const plan3 = planTick({ due, heavySlot: 'heat', running: new Set(['heat']), lightMax: 1 });
  const lightJobs3 = plan3.light.filter((j) =>
    ['sonkwo', 'itad', 'gog', 'humble', 'discover', 'steam-accounts', 'backup', 'logs', 'alerts', 'images', 'images-backfill'].includes(j.name),
  );
  assert.equal(lightJobs3.length, 1, 'lightMax=1 只发一个轻任务');
  assert.equal(plan3.heavy.length, 0, 'heat 占槽时不排其它重任务');
});

test('X 批：重启后 lastRunMs 从 sync_runs 恢复，坏行跳过', () => {
  const map = lastRunMsFromRows([
    { mode: 'steam-prices', last: '2026-11-05T04:00:00Z' },
    { mode: 'steam-status', last: '2026-11-05T03:00:00Z' },
    { mode: 'sonkwo', last: null },
    { mode: 'heat', last: 'not-a-date' },
    { mode: 42, last: '2026-11-05T02:00:00Z' },
    { mode: '', last: '2026-11-05T02:00:00Z' },
  ]);
  assert.equal(map.get('steam-prices'), Date.parse('2026-11-05T04:00:00Z'));
  assert.equal(map.get('steam-status'), Date.parse('2026-11-05T03:00:00Z'));
  assert.equal(map.has('sonkwo'), false, 'null 视为没跑过，不恢复');
  assert.equal(map.has('heat'), false, '非法时间不恢复');
  assert.equal(map.has('42'), false, 'mode 必须是字符串');
  assert.equal(map.has(''), false, '空 mode 不恢复');

  // 恢复后按"最近一次 + 间隔"计时，而不是从头按首轮延迟
  const jobs = [{ name: 'steam-prices', intervalMin: 1440, initialDelaySec: 600 }];
  const due = dueJobs(jobs, { nowMs: Date.parse('2026-11-05T04:00:00Z') + 59 * 60_000, startedMs: 0, lastRunMs: map });
  assert.equal(due.length, 0, '恢复的任务没有到点不重跑');
  const due2 = dueJobs(jobs, { nowMs: Date.parse('2026-11-05T04:00:00Z') + 1440 * 60_000, startedMs: 0, lastRunMs: map });
  assert.equal(due2.length, 1, '到间隔后才重跑');
});

test('AC-4：默认配置的每日预算 <24h（不降频）；超预算时自动缩 steam-status 并告警', () => {
  const b = steamDailyBudgetMinutes({});
  assert.ok(b.total > 0);
  assert.ok(b.total <= 1440, '默认五任务总量在预算内（' + Math.round(b.total) + ' 分钟）');
  // 超预算：把 heat 拉到 3.6 万（加价格/回填/分级回填/状态后超过 24h），自动缩 steam-status 回到预算内
  const env = { STEAM_HEAT_LIMIT: '36000', STEAM_STATUS_LIMIT: '6000', STEAM_STATUS_RATE_MS: '1500' };
  const events = [];
  const logger = { warn: (e, f) => events.push([e, f]) };
  const { jobs, budget, adjusted } = applySteamBudget(jobsFromEnv(env), env, logger);
  assert.equal(adjusted, true);
  const status = jobs.find((j) => j.name === 'steam-status');
  const limitIdx = status.args.indexOf('--limit');
  const newLimit = Number(status.args[limitIdx + 1]);
  assert.ok(newLimit < 6000, 'steam-status 被降频（' + newLimit + '）');
  const after = steamDailyBudgetMinutes({ ...env, STEAM_STATUS_LIMIT: String(newLimit) });
  assert.ok(after.total <= 1440, '调整后回到预算内（' + Math.round(after.total) + ' 分钟）');
  assert.ok(events.some(([e]) => e === 'scheduler.budget_exceeded'), '告警日志');
});

test('B3：实测耗时优先——steamDailyBudgetMinutes 用 sync_runs 平均秒折算每日预算，缺样本回落理论值', () => {
  const env = {};
  const theo = steamDailyBudgetMinutes(env);
  assert.ok(theo.total > 0, '无实测时理论预算可用');
  // 实测：五个 mode 各给平均秒（steam-status 实测 300s/轮 vs 理论 5h，证明预算跟着实测走）
  const observed = new Map([
    ['steam-prices', 60],
    ['heat', 120],
    ['steam-status', 300],
    ['backfill', 600],
    ['rating-backfill', 30],
  ]);
  const obs = steamDailyBudgetMinutes(env, observed);
  assert.equal(obs.priceMin, 1, '价格：60s × 1 轮/天 = 1 分钟');
  assert.equal(obs.heatMin, 2, '热度：120s × 1 轮/天 = 2 分钟');
  assert.equal(obs.statusMin, 5, '状态：300s × 1 轮/天 = 5 分钟');
  assert.equal(obs.backfillDailyMin, 10, '回填：600s × 1 轮/天 = 10 分钟');
  assert.equal(obs.ratingBackfillDailyMin, 0.5, 'EF 分级回填：30s × 1 轮/天 = 0.5 分钟');
  assert.equal(obs.total, 18.5, '总预算 = 实测之和（不再按理论常数）');
  // 缺样本回落理论：只有 heat 有实测，其余回落
  const partial = steamDailyBudgetMinutes(env, new Map([['heat', 0.1]]));
  assert.equal(partial.heatMin, 0.1 / 60, 'heat 用实测（0.1s × 1 轮/天）');
  assert.equal(partial.priceMin, theo.priceMin, '缺实测的 mode 回落理论值');
  // 非法实测值（0/负数/NaN）当没有样本
  const junk = steamDailyBudgetMinutes(env, new Map([['steam-prices', 0], ['heat', -5], ['steam-status', Number.NaN]]));
  assert.equal(junk.total, theo.total, '非法实测值全部回落理论值');
});

test('B3：applySteamBudget 预算来源实测——实测超预算同样触发缩量并标注 source', () => {
  const env = {};
  // 实测把总预算推过 24h：status 实测 30h/轮
  const observed = new Map([
    ['steam-prices', 60],
    ['heat', 120],
    ['steam-status', 30 * 3600],
    ['backfill', 600],
  ]);
  const events = [];
  const logger = { warn: (e, f) => events.push([e, f]) };
  const { jobs, budget, adjusted } = applySteamBudget(jobsFromEnv(env), env, logger, observed);
  assert.equal(adjusted, true, '实测超预算也要缩量');
  assert.ok(budget.total > 1440, '实测总预算超过 24h');
  assert.equal(events[0][1].source, 'observed', '告警标注预算来源=实测');
  const status = jobs.find((j) => j.name === 'steam-status');
  const limitIdx = status.args.indexOf('--limit');
  assert.ok(Number(status.args[limitIdx + 1]) < 6000, 'steam-status 被降频');
  // 未超预算时不动
  const ok = applySteamBudget(jobsFromEnv({}), {}, logger);
  assert.equal(ok.adjusted, false, '理论预算内不调整');
});

test('B3：jobRuntimeEstimates 只覆盖五个 Steam 重任务，obsSec 来自实测、无实测为 null', () => {
  const jobs = jobsFromEnv({});
  const observed = new Map([['heat', 42]]);
  const est = jobRuntimeEstimates(jobs, {}, observed);
  assert.deepEqual([...est.keys()].sort(), ['backfill', 'heat', 'rating-backfill', 'steam-prices', 'steam-status'].sort(), '只给五个 Steam 重任务');
  const heat = est.get('heat');
  assert.equal(heat.obsSec, 42, '实测秒透传');
  assert.equal(heat.estSec, theoreticalRunSeconds({}).heat, '理论估算保留');
  assert.equal(est.get('steam-prices').obsSec, null, '无实测 obsSec=null（任务卡标注「理论」）');
  assert.ok(!est.has('catalog'), 'catalog 不在预算口径内');
});

test('B3：writeStatusFile 带 estimate 字段，前端任务卡显示实际/估算差（静态锁）', () => {
  const jobs = jobsFromEnv({});
  const estimates = jobRuntimeEstimates(jobs, {}, new Map([['heat', 42]]));
  const file = join(tmpdir(), `b3-status-${Date.now()}.json`);
  writeStatusFile(jobs, { lastRunMs: new Map(), health: new Map(), running: new Set(), estimates, file });
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  const heat = payload.jobs.find((j) => j.name === 'heat');
  assert.deepEqual(heat.estimate, { estSec: theoreticalRunSeconds({}).heat, obsSec: 42 }, '状态文件带 estimate');
  const sonkwo = payload.jobs.find((j) => j.name === 'sonkwo');
  assert.equal(sonkwo.estimate, null, '非预算任务不带 estimate');
  // 前端接线（静态）：任务表显示「估算」与差值文案
  const admin = readFileSync(new URL('../frontend/src/pages/AdminModules.vue', import.meta.url), 'utf8');
  assert.match(admin, /估算 \{\{ estimateText\(row\) \}\}/, '任务卡显示估算');
  assert.match(admin, /deltaText\(row\)/, '任务卡显示实际与估算差');
  assert.match(admin, /j\.estimate/, 'taskRows 透传 estimate 字段');
  assert.match(admin, /（理论）/, '无实测样本时估算标注「理论」');
});

test('AC-9/BL-1：回填候选新游戏优先 + 四态排除 + 默认每天 5000（静态断言）', () => {
  const cli = readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
  // CO-5/B4-2 第十二轮：cmdBackfill 已随 cli 运维类域拆到 src/cli/ops.js，断言按新落点指向
  const cliOps = readFileSync(new URL('../src/cli/ops.js', import.meta.url), 'utf8');
  assert.match(cliOps, /listBackfillCandidates/, '回填候选走共享谓词 db.listBackfillCandidates');
  // CO-5/B4-2 第十轮：sync steamall 已随 cli 同步类域拆走——该排序 SQL 在 cli.js 归零、
  // 只存在于 src/store/cli-sync-repository.js（steamall 一处，防双实现）。
  assert.equal((cli.match(/order by g\.created_at desc nulls last, g\.id desc limit/g) || []).length, 0, 'cli.js 不再有 steamall 排序（已拆到 cli 同步域）');
  const cliSyncRepo = readFileSync(new URL('../src/store/cli-sync-repository.js', import.meta.url), 'utf8');
  assert.equal((cliSyncRepo.match(/order by g\.created_at desc nulls last, g\.id desc limit/g) || []).length, 1, '该排序只在 cli 同步域 repository（steamall 一处）');
  const pg = readFileSync(new URL('../src/store/pg.js', import.meta.url), 'utf8');
  assert.match(pg, /order by g\.created_at desc nulls last, g\.id desc limit/, '回填按收录时间倒序（谓词在 pg.js）');
  assert.match(pg, /coalesce\(g\.steam_status, ''\) not in \('free', 'coming_soon', 'region_locked', 'not_found'\)/, 'BL-1：候选排除四态');
  assert.match(pg, /no_price/, 'BL 批：no_price 保留说明存在');
  const sched = readFileSync(new URL('../src/scheduler.js', import.meta.url), 'utf8');
  assert.match(sched, /STEAM_BACKFILL_LIMIT, 5000/, 'BL 批：回填默认上限 5000');
  assert.match(sched, /STEAM_BACKFILL_INTERVAL_MIN, 1440/, 'BL 批：回填默认每天一轮');
});

test('BL-2：429 软退出（exit 75）不计失败、不熔断；重排 1 小时/连续 3 次放弃/成功清零；dueJobs 支持重排到期', () => {
  let state = { failures: 2, openUntil: null };
  state = recordJobResult(state, { code: 75, nowMs: 1000 });
  assert.equal(state.failures, 2, 'partial 不增加 failures');
  assert.equal(state.opened, false, 'partial 不熔断');
  state = recordJobResult(state, { code: 1, nowMs: 2000 });
  assert.equal(state.failures, 3, '真失败照常累计');

  const t0 = Date.parse('2026-11-13T00:00:00Z');
  let retry = applyRetry({}, { job: 'backfill', code: 75, nowMs: t0 });
  assert.equal(Date.parse(retry.backfill.at), t0 + 3600_000, 'partial 后 1 小时重排');
  assert.equal(retry.backfill.streak, 1);
  retry = applyRetry(retry, { job: 'backfill', code: 75, nowMs: t0 });
  assert.equal(retry.backfill.streak, 2);
  retry = applyRetry(retry, { job: 'backfill', code: 75, nowMs: t0 });
  assert.equal(retry.backfill, undefined, '连续 3 次 partial 放弃重排，等正常日轮');
  retry = applyRetry({ backfill: { at: 'x', streak: 1 } }, { job: 'backfill', code: 0, nowMs: t0 });
  assert.equal(retry.backfill, undefined, '成功一次清零 retry/streak');

  const jobs = [{ name: 'backfill', intervalMin: 1440, initialDelaySec: 600 }];
  const lastRunMs = new Map([['backfill', t0]]);
  const retryState = { backfill: { at: new Date(t0 + 3600_000).toISOString() } };
  assert.equal(dueJobs(jobs, { nowMs: t0 + 59 * 60_000, startedMs: t0, lastRunMs, retry: retryState }).length, 0, '正常到期与重排都未到');
  assert.equal(dueJobs(jobs, { nowMs: t0 + 3600_000, startedMs: t0, lastRunMs, retry: retryState }).length, 1, '重排时间到了即 due（即使未到正常间隔）');
});

test('AC-2：熔断手动重置——registerCircuitReset 注册钩子，resetCircuit 触发清零', () => {
  const state = { failures: 3, openUntil: Date.now() + 3600_000 };
  const off = registerCircuitReset((name) => {
    if (name !== 'heat') return false;
    state.failures = 0;
    state.openUntil = null;
    return true;
  });
  assert.equal(resetCircuit('unknown'), false, '没有对应钩子 = 未处理');
  assert.equal(resetCircuit('heat'), true, '命中钩子清零');
  assert.equal(state.failures, 0);
  assert.equal(state.openUntil, null);
  off();
  assert.equal(resetCircuit('heat'), false, '注销后不再处理');
});

// CO-1/A5（docs/DESIGN-AUDIT.md A5）：任务失败可见——失败原因取 sync_runs 真实原因，取不到回退退出码
test('CO-1/A5：任务 → sync_runs mode 映射（sync 系取第二个参数，其余取命令名）', () => {
  assert.equal(syncRunModeFor({ name: 'app-release-sync', args: ['app-sync'] }), 'app-sync', 'App Release 同步的 mode 是命令名 app-sync');
  assert.equal(syncRunModeFor({ name: 'steam-prices', args: ['sync', 'steam-prices', '--limit', '1'] }), 'steam-prices');
  assert.equal(syncRunModeFor({ name: 'sonkwo', args: ['sync', 'sonkwo'] }), 'sonkwo');
  assert.equal(syncRunModeFor({ name: 'heat', args: ['heat', '--limit', '1'] }), 'heat');
  assert.equal(syncRunModeFor({ name: 'steam-discovery', args: ['steam-discovery', '--pages', '100'] }), 'steam-discovery');
  assert.equal(syncRunModeFor({ name: 'proxy-probe', args: ['probe', '--proxy'] }), 'probe');
  assert.equal(syncRunModeFor({ name: 'chart', args: null }), 'chart', '缺 args 回退任务名');
});

test('CO-1/A5：失败原因取值——真实原因优先，缺失回退退出码，75 保持 partial 文案，成功为 null', () => {
  assert.equal(jobFailureError(0, 'x'), null, '成功不带原因');
  assert.equal(jobFailureError(1, 'data/skus.json 为空'), 'data/skus.json 为空', '优先 sync_runs 里的真实原因');
  assert.equal(jobFailureError(1, null), 'exit code 1', '取不到原因回退退出码');
  assert.equal(jobFailureError(-1, ''), 'exit code -1', '空串同样回退');
  assert.equal(jobFailureError(75, 'ignored'), 'HTTP 429/403 提前收尾（进度已保留，1 小时后重排）', '75 软退出不是失败');
});

// CH 批（docs/DISCOVERY-FOR-YOU.md §6）：steam-discovery 任务默认参数与 STEAM_HEAVY 互斥
test('CH steam-discovery：默认 100 页/回退 100/1440 分钟，归入 STEAM_HEAVY', () => {
  const jobs = jobsFromEnv({ STEAM_ENABLED: '1' });
  const job = jobs.find((j) => j.name === 'steam-discovery');
  assert.ok(job, 'steam-discovery 任务存在');
  assert.match(job.args.join(' '), /--pages 100/, '默认 100 页');
  assert.match(job.args.join(' '), /--fallback 100/, '默认回退 100');
  assert.equal(job.intervalMin, 1440, '默认每天一轮');
  assert.ok(STEAM_HEAVY.has('steam-discovery'), '与 Steam 重任务互斥串行');
});

// ============================================================ EU 批（docs/SCHEDULER-RESTART-RESILIENCE.md）
// EU-1 中断标记：停机时非零退出 = interrupted（不记 failed / 不发邮件 / 不进熔断）；
// EU-2 分批：steam-prices --batch 默认 5000 可覆盖；EU-4 停机跳过失败原因查询。
// 反向自检口径：删掉 completeJob 的「stopping && code !== 0」分支 → outcomeFor 断言红；
// 删掉「!stopping」跳过条件 → EU-4 静态锁红；删前端「被重启中断」文案 → 前端静态锁红。

test('EU-1：outcomeFor——停机中非零退出判 interrupted（不失败/不告警），停机瞬间成功仍算 ok', () => {
  assert.deepEqual(outcomeFor(143, null, true), { result: 'interrupted', error: '服务重启，任务被中断' }, 'SIGTERM 退出码 143 + 停机中 → interrupted');
  assert.deepEqual(outcomeFor(-1, null, true), { result: 'interrupted', error: '服务重启，任务被中断' }, '被 SIGKILL/信号杀 → interrupted');
  assert.deepEqual(outcomeFor(0, null, true), { result: 'ok', error: null }, '停机瞬间恰好正常退出不算中断');
  assert.deepEqual(outcomeFor(0, null, false), { result: 'ok', error: null }, '非停机成功照旧 ok');
  assert.deepEqual(outcomeFor(75, null, false), { result: 'partial', error: 'HTTP 429/403 提前收尾（进度已保留，1 小时后重排）' }, '75 软退出照旧 partial');
  assert.deepEqual(outcomeFor(1, 'data/skus.json 为空', false), { result: 'failed', error: 'data/skus.json 为空' }, '非停机失败照旧 failed（带真实原因）');
  assert.equal(outcomeFor(1, null, true).result, 'interrupted', '停机中即使有失败原因也不判 failed');
});

test('EU-2：steam-prices 分批参数——默认 --batch 5000，STEAM_PRICE_BATCH 可覆盖', () => {
  assert.deepEqual(
    jobsFromEnv({}).find((j) => j.name === 'steam-prices').args,
    ['sync', 'steam-prices', '--limit', '200000', '--batch', '5000'],
    '默认 limit 200000 + batch 5000（每轮只处理一批，批间断点）',
  );
  assert.deepEqual(
    jobsFromEnv({ STEAM_PRICE_BATCH: '2000', STEAM_PRICE_LIMIT: '100000' }).find((j) => j.name === 'steam-prices').args,
    ['sync', 'steam-prices', '--limit', '100000', '--batch', '2000'],
    'limit/batch 都可环境变量覆盖',
  );
});

test('EU 批静态锁：scheduler 停机语义 + 前端「被重启中断」显示（删任一即红）', () => {
  const sched = readFileSync(new URL('../src/scheduler.js', import.meta.url), 'utf8');
  // EU-1：interrupted 分支存在且不触发失败邮件/熔断
  assert.match(sched, /outcomeFor\(code, runReason, stopping\)/, 'completeJob 用 outcomeFor 判定（stopping 透传）');
  assert.match(sched, /outcome\.result === 'interrupted'/, 'interrupted 分支存在');
  assert.match(sched, /if \(outcome\.result === 'interrupted'\) return;/, 'interrupted 不进熔断计数（提前返回）');
  // EU-4：停机时跳过失败原因查询（消除 Cannot use a pool 噪音）
  assert.match(sched, /if \(!stopping && code !== 0 && code !== 75\)/, '停机中不查 lastFailedSyncRun');
  // EU-5：排空（drain）——停机时不再立即打断在跑任务，等其自然完成（默认 10 分钟可调），超时才 SIGTERM
  assert.match(sched, /SCHEDULER_DRAIN_TIMEOUT_MS/, '排空超时可用环境变量调整');
  assert.match(sched, /10 \* 60_000/, '排空超时默认 10 分钟');
  assert.match(sched, /drainTimeoutMs/, 'stop() 挂排空超时定时器');
  assert.match(sched, /scheduler\.drain_timeout/, '超时打断记日志（drain_timeout）');
  assert.match(sched, /wait for running jobs/, 'stop 日志标注排空语义');
  // EU-2：分批参数进任务表
  assert.match(sched, /STEAM_PRICE_BATCH/, 'steam-prices 分批可配置');
  // 前端三处显示「被重启中断」（任务卡 / 健康条 / 同步记录）
  const adminModules = readFileSync(new URL('../frontend/src/pages/AdminModules.vue', import.meta.url), 'utf8');
  assert.match(adminModules, /lastResult==='interrupted'/, '任务表「上次结果」列支持 interrupted');
  assert.match(adminModules, /被重启中断/, '任务表显示「被重启中断」');
  const adminLogs = readFileSync(new URL('../frontend/src/pages/AdminLogs.vue', import.meta.url), 'utf8');
  assert.match(adminLogs, /j\.lastResult === 'interrupted'/, '健康条 jobState 支持 interrupted');
  assert.match(adminLogs, /interrupted: '被重启中断'/, '同步记录 status 映射支持 interrupted');
  // CLI 侧：SIGTERM 收尾接线（工厂 + 真实收尾函数；真信号行为在 cli-interrupt.test.js）
  const cli = readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
  assert.match(cli, /installSigtermHandler\(\{/, 'CLI 用 cli-interrupt 工厂安装 SIGTERM 收尾');
  assert.match(cli, /getRun: \(\) => activeSyncRun/, '收尾目标是在跑的同步记录 activeSyncRun');
  assert.match(cli, /'interrupted'/, 'SIGTERM 把 sync_runs 记为 interrupted');
  assert.match(cli, /installSigtermHandler/, '退出码 143 由工厂保证（见 src/cli-interrupt.js）');
  const cliInterrupt = readFileSync(new URL('../src/cli-interrupt.js', import.meta.url), 'utf8');
  assert.match(cliInterrupt, /process\.once\('SIGTERM'/, '工厂注册 SIGTERM');
  assert.match(cliInterrupt, /process\.exit\(exitCode\)/, '收尾后按 exitCode（143）退出');
  // 数据层：重启残留 running 记录标 interrupted 而不是 failed
  const pg = readFileSync(new URL('../src/store/pg.js', import.meta.url), 'utf8');
  assert.match(pg, /status = 'interrupted', finished_at = now\(\)/, 'markStaleSyncRuns 标 interrupted');
});

// ============================================================ FJ 批（docs/SYNC-JOB-GROUPS.md）
// 同步服务合并为 12 个任务组：组行 + 展开子步骤；组只是调度层（组内到期子步骤串行），
// sync_runs 仍按子步骤原 mode 记录；steam-claim 移出定时改后台手动按钮。
// 反向自检口径：删掉 planTick 的 groupBusy 检查 → 组内串行断言红；删掉 JOB_GROUPS 某组 → 12 组断言红。

test('FJ：12 个任务组——组名/顺序固定，组内子步骤按优先级；扁平 jobs 带 group 字段', () => {
  const groups = jobGroupsFromEnv({});
  assert.equal(groups.length, 12, '固定 12 组');
  assert.deepEqual(
    groups.map((g) => g.name),
    ['steam-prices', 'steam-meta', 'multi-platform', 'catalog-discovery', 'images', 'index', 'system', 'steam-accounts', 'heat', 'app-release', 'align-snapshot', 'proxy-alerts'],
    '组顺序固定（后台组行顺序）',
  );
  assert.equal(groups[0].label, 'Steam 价格', '组带中文 label');
  assert.deepEqual(
    groups.find((g) => g.name === 'steam-meta').steps.map((s) => s.name),
    ['steam-status', 'rating-backfill', 'backfill', 'rename'],
    '元数据组优先级：未探测 → 缺分级 → 缺说明 → 缺中文名',
  );
  assert.deepEqual(
    groups.find((g) => g.name === 'proxy-alerts').steps.map((s) => s.name),
    ['proxy-probe', 'alerts'],
    '无提醒通道时 report 不进组（启用才出现）',
  );
  const jobs = jobsFromEnv({});
  assert.ok(jobs.every((j) => typeof j.group === 'string' && j.group), '每个 job 都带 group 字段');
  assert.equal(jobs.find((j) => j.name === 'backfill').group, 'steam-meta');
  assert.equal(jobs.find((j) => j.name === 'proxy-probe').group, 'proxy-alerts');
  assert.equal(jobs.find((j) => j.name === 'app-release-sync').group, 'app-release');
  // 空组保留：无 key 时 Steam 账号组 steps 为空但组仍在（后台固定显示 12 组）
  assert.equal(groups.find((g) => g.name === 'steam-accounts').steps.length, 0, '无 STEAM_API_KEY 时账号组无子步骤');
});

test('FJ：planTick 组内串行——同组多个到期子步骤只派发优先级最高的一个', () => {
  const jobs = jobsFromEnv({});
  const meta = jobs.filter((j) => j.group === 'steam-meta');
  assert.equal(meta.length, 4, '元数据组 4 步');
  const plan = planTick({ due: meta, heavySlot: null, running: new Set(), lightMax: 3, jobs });
  assert.equal(plan.heavy.length, 1, '同组 4 步同 tick 只发一个');
  assert.equal(plan.heavy[0].name, 'steam-status', '按组内优先级发 steam-status（未探测最优先）');

  // 组内已有子步骤在跑：该组本 tick 不派发任何子步骤（不并发抢 appdetails）
  const plan2 = planTick({ due: meta, heavySlot: null, running: new Set(['steam-status']), lightMax: 3, jobs });
  assert.equal(plan2.heavy.length, 0, 'steam-status 在跑时组内其它步骤不并发');
  assert.equal(plan2.light.length, 0);
});

test('FJ：多平台报价组——组内串行（轻任务也不并发同组）', () => {
  const jobs = jobsFromEnv({});
  const multi = jobs.filter((j) => j.group === 'multi-platform');
  assert.equal(multi.length, 4);
  const plan = planTick({ due: multi, heavySlot: null, running: new Set(), lightMax: 8, jobs });
  assert.equal(plan.light.length, 1, '组内 4 步同 tick 只发一个');
  assert.equal(plan.light[0].name, 'sonkwo', '按组内顺序发 sonkwo');
  const plan2 = planTick({ due: multi, heavySlot: null, running: new Set(['sonkwo']), lightMax: 8, jobs });
  assert.equal(plan2.light.length, 0, 'sonkwo 在跑时 itad/gog/humble 不并发');
});

test('FJ：不传 jobs 时 planTick 退化为旧行为（组约束不生效，跨组并行照旧）', () => {
  const due = jobsFromEnv({}).filter((j) => ['sonkwo', 'itad', 'gog', 'humble'].includes(j.name));
  const plan = planTick({ due, heavySlot: null, running: new Set(), lightMax: 8 });
  assert.equal(plan.light.length, 4, '无组信息时四个平台任务都可并行（旧行为兼容）');
});

test('FJ：组内串行不影响跨组并行——不同组的轻任务照常并发', () => {
  const jobs = jobsFromEnv({});
  const due = jobs.filter((j) => ['sonkwo', 'images', 'alerts'].includes(j.name));
  const plan = planTick({ due, heavySlot: null, running: new Set(), lightMax: 8, jobs });
  assert.equal(plan.light.length, 3, '三个不同组的轻任务可同 tick 并发');
});

test('FJ：writeStatusFile 输出 groups（12 组含 label 与子步骤状态），jobs 保留且行带 group', () => {
  const file = join(tmpdir(), `fj-status-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const jobs = jobsFromEnv({});
  writeStatusFile(jobs, { lastRunMs: new Map(), health: new Map(), running: new Set(), groups: groupsFromJobs(jobs), file });
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(payload.groups.length, 12, '状态文件含 12 组');
    const meta = payload.groups.find((g) => g.name === 'steam-meta');
    assert.equal(meta.label, 'Steam 元数据');
    assert.deepEqual(meta.steps.map((s) => s.name), ['steam-status', 'rating-backfill', 'backfill', 'rename'], '组内子步骤状态');
    assert.ok(meta.steps[0].nextRunAt, '子步骤行含 nextRunAt');
    assert.equal(payload.jobs.find((j) => j.name === 'backfill').group, 'steam-meta', 'jobs 行带 group（兼容旧字段）');
    const sonkwo = payload.jobs.find((j) => j.name === 'sonkwo');
    assert.equal(sonkwo.intervalMin, 60, '子步骤间隔不变（组不引入新参数）');
  } finally {
    rmSync(file, { force: true });
  }
});

test('FJ：groupsFromJobs 空组保留（12 组固定，steps 可为空）', () => {
  const groups = groupsFromJobs(jobsFromEnv({ STEAM_API_KEY: '' }));
  assert.equal(groups.length, 12);
  assert.equal(groups.find((g) => g.name === 'steam-accounts').steps.length, 0, '无 key 时账号组空');
  assert.deepEqual(
    groups.find((g) => g.name === 'catalog-discovery').steps.map((s) => s.name),
    ['steam-discovery', 'discover'],
    '无 key 时目录组只剩 discovery/discover',
  );
});
