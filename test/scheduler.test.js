import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jobsFromEnv, dueJobs, describeSchedule, forwardedArgs, recordJobResult, isCircuited, CIRCUIT, followUpArgs, writeStatusFile, lightConcurrency, STEAM_HEAVY, planTick, lastRunMsFromRows } from '../src/scheduler.js';

test('轻任务并行上限：SCHEDULER_LIGHT_CONCURRENCY 可调（1–8），默认 3，非法回落默认', () => {
  assert.equal(lightConcurrency({}), 3);
  assert.equal(lightConcurrency({ SCHEDULER_LIGHT_CONCURRENCY: '5' }), 5);
  assert.equal(lightConcurrency({ SCHEDULER_LIGHT_CONCURRENCY: '0' }), 1, '下限 1');
  assert.equal(lightConcurrency({ SCHEDULER_LIGHT_CONCURRENCY: '99' }), 8, '上限 8');
  assert.equal(lightConcurrency({ SCHEDULER_LIGHT_CONCURRENCY: 'abc' }), 3, '非法值回落默认');
});

test('默认任务表（含 Steam 日更/热度/重写名字/增量回填、清理、gog / humble / discover / backup / alerts / images），各自间隔', () => {
  const jobs = jobsFromEnv({});
  assert.deepEqual(jobs.map((j) => j.name), [
    'steam-prices', 'heat', 'steam-status', 'rename', 'backfill', 'prune', 'sonkwo', 'itad', 'gog', 'humble',
    'discover', 'backup', 'logs', 'alerts', 'images',
  ]);
  const interval = (name) => jobs.find((j) => j.name === name).intervalMin;
  assert.equal(interval('steam-prices'), 1440, 'Steam 价格默认每天刷新');
  assert.equal(interval('heat'), 1440, '热度默认每天刷新（首轮自动播种，之后刷过期条目）');
  assert.equal(interval('steam-status'), 1440, 'Steam 状态判定默认每天一次（X 批）');
  assert.equal(interval('rename'), 10080, '重写名字默认每周一次');
  assert.equal(interval('backfill'), 10080, '增量回填默认每周一次');
  assert.equal(interval('prune'), 10080, '清理默认每周一次');
  assert.equal(interval('itad'), 1440);
  assert.equal(interval('gog'), 720);
  assert.equal(interval('humble'), 720);
  assert.equal(interval('discover'), 720);
  assert.equal(interval('backup'), 1440, '备份每天一次');
  assert.equal(interval('logs'), 7 * 1440, '日志每 7 天清理一次');
  assert.equal(interval('alerts'), 360);
  assert.equal(interval('images'), 240, '封面图补缓存默认每 4 小时');
  const args = (name) => jobs.find((j) => j.name === name).args;
  assert.deepEqual(args('discover'), ['discover', 'sonkwo', '--ahead', '60', '--max-misses', '12']);
  assert.deepEqual(args('backup'), ['backup']);
  assert.deepEqual(args('images'), ['images', 'pull', '--limit', '200', '--sleep', '300']);
  assert.deepEqual(args('steam-prices'), ['sync', 'steam-prices', '--limit', '200000']);
  assert.deepEqual(args('heat'), ['heat', '--limit', '20000', '--sleep', '1700']);
  assert.deepEqual(args('steam-status'), ['steam-status', '--limit', '6000', '--rate', '1500']);
  assert.deepEqual(args('rename'), ['rename', '--limit', '200000', '--batch', '100', '--sleep', '1500']);
  assert.deepEqual(args('backfill'), ['backfill', '--limit', '20000', '--batch', '100', '--sleep', '3000']);
  assert.deepEqual(args('prune'), ['prune']);
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

test('steam-claim 迁移任务：只在配置了用户名与 SteamID 时出现，认领幂等', () => {
  assert.ok(!jobsFromEnv({}).some((j) => j.name === 'steam-claim'), '未配置不出现');
  assert.ok(!jobsFromEnv({ STEAM_CLAIM_USERNAME: 'admin' }).some((j) => j.name === 'steam-claim'), '缺 SteamID 不出现');
  assert.ok(
    !jobsFromEnv({ STEAM_CLAIM_STEAM_ID: '76561198000000000' }).some((j) => j.name === 'steam-claim'),
    '缺用户名不出现',
  );
  const job = jobsFromEnv({
    STEAM_CLAIM_USERNAME: 'admin',
    STEAM_CLAIM_STEAM_ID: '76561198000000000',
  }).find((j) => j.name === 'steam-claim');
  assert.ok(job, '两者都配了才出现');
  assert.deepEqual(job.args, ['steam-claim', 'admin', '76561198000000000']);
  assert.equal(job.intervalMin, 1440);
  assert.equal(job.initialDelaySec, 60);

  const off = jobsFromEnv({
    STEAM_CLAIM_USERNAME: 'admin',
    STEAM_CLAIM_STEAM_ID: '76561198000000000',
    STEAM_CLAIM_ENABLED: '0',
  });
  assert.ok(!off.some((j) => j.name === 'steam-claim'), 'STEAM_CLAIM_ENABLED=0 可关闭');
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
  });
  assert.deepEqual(jobs.map((j) => j.name), ['heat', 'rename', 'backfill', 'prune', 'sonkwo', 'alerts']);
});

test('从未跑过的任务在 initialDelay 之后才算到点', () => {
  const jobs = jobsFromEnv({ STEAM_INITIAL_DELAY_SEC: '30', SONKWO_INITIAL_DELAY_SEC: '180' });
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
  const jobs = jobsFromEnv({ SONKWO_INITIAL_DELAY_SEC: '60' });
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
  const plan = planTick({ due, heavySlot: 'steam-prices', running, lightMax: 12 });
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

  // 并行上限只约束轻任务：lightMax=1 时只发一个轻任务（prune 非重非轻，不受上限）
  const plan3 = planTick({ due, heavySlot: 'heat', running: new Set(['heat']), lightMax: 1 });
  const lightJobs3 = plan3.light.filter((j) =>
    ['sonkwo', 'itad', 'gog', 'humble', 'discover', 'steam-accounts', 'backup', 'logs', 'alerts', 'images'].includes(j.name),
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
