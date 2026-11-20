import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 这个测试专门防止"调度器调用了 CLI 里不存在的子命令"——
// 之前 sync steamall 的分发被误删，导致每小时任务都报"用法错误"，而且只有看日志才发现。
// B4 #18（CO-5/B4-2 第十轮）：cli 同步类域拆到 src/cli/sync.js（ARCHITECTURE §15.5 第 6 步），
// 断言改指新文件，并加三条锁：
//   ① 命令分支在新文件（sync.js 含全部 target 分发）；
//   ② cli.js 真实接线（import createCliSync + dispatchSync 进主分发 + TRACKED_COMMANDS 展开，防死模块）；
//   ③ 旧分支不残留在 cli.js（防双实现）。
// 反向自检（跑过并恢复）：删 sync.js 任一 `target === 'xxx'` 分支 → 测试 1/2 红；删 cli.js 的
// dispatchSync 接线 → 测试 4 红；把 cmdSyncSteamAll 抄回 cli.js → 测试 3/5 红。
// B4 #19（第十一轮）：cli 报表类域拆到 src/cli/report.js，同样三条锁 + 反向自检
// （删 cli.js 的 reportDomain.trackedCommands 展开 → 测试 9 红；删 report.js 的 cmdHistory → 测试 6 红）。
// B4 #20（第十二轮）：cli 运维类域拆到 src/cli/ops.js，同样三条锁 + 反向自检
// （删 cli.js 的 opsDomain.trackedCommands 展开 → 测试 13 红；删 ops.js 的 cmdProbe → 测试 10 红）。
const cli = readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
const syncMod = readFileSync(new URL('../src/cli/sync.js', import.meta.url), 'utf8');
const reportMod = readFileSync(new URL('../src/cli/report.js', import.meta.url), 'utf8');
const opsMod = readFileSync(new URL('../src/cli/ops.js', import.meta.url), 'utf8');
const scheduler = readFileSync(new URL('../src/scheduler.js', import.meta.url), 'utf8');

function schedulerSyncTargets() {
  const targets = new Set();
  const re = /args:\s*\[[^\]]*'sync',\s*'([a-z]+)'[^\]]*\]/g;
  let m;
  while ((m = re.exec(scheduler))) targets.add(m[1]);
  return [...targets];
}

// 调度器之外的手动入口（帮助文本列出的完整 sync 家族）
const ALL_SYNC_TARGETS = ['all', 'steam', 'steam-prices', 'steamall', 'catalog', 'sonkwo', 'itad', 'gog', 'humble'];

test('调度器用到的 sync 子命令分发在 src/cli/sync.js（且 cli.js 不残留双实现）', () => {
  const targets = schedulerSyncTargets();
  assert.ok(targets.length > 0, '应该能从 scheduler.js 解析出 sync 目标');
  for (const t of targets) {
    assert.ok(
      syncMod.includes(`target === '${t}'`),
      `src/cli/sync.js 缺少 'sync ${t}' 的分发（scheduler.js 正在调用它）`,
    );
    assert.ok(!cli.includes(`target === '${t}'`), `cli.js 残留 'sync ${t}' 分发（防双实现）`);
  }
});

test('sync 全家族分发完整在新文件（含调度器之外的手动入口），cli.js 不残留', () => {
  for (const t of ALL_SYNC_TARGETS) {
    assert.ok(syncMod.includes(`target === '${t}'`), `src/cli/sync.js 缺少 'sync ${t}' 的分发`);
    assert.ok(!cli.includes(`target === '${t}'`), `cli.js 残留 'sync ${t}' 分发（防双实现）`);
  }
  assert.match(syncMod, /用法: node src\/cli\.js sync all\|steam\|steam-prices\|steamall\|catalog\|sonkwo\|itad\|gog\|humble/, '未知目标仍报完整用法（退出码契约）');
});

test('sync steamall 的实现与分发同时存在于 src/cli/sync.js', () => {
  const hasImpl = syncMod.includes('cmdSyncSteamAll');
  const hasDispatch = syncMod.includes("target === 'steamall'");
  assert.equal(hasImpl, hasDispatch, '实现与分发必须同时存在，否则任务会报用法错误');
});

test('cli.js 真实接线：import 域模块 + dispatchSync 进主分发 + TRACKED_COMMANDS 展开（防死模块）', () => {
  assert.match(cli, /import \{ createCliSync \} from '\.\/cli\/sync\.js'/, 'cli.js import 域模块');
  assert.match(cli, /const syncDomain = createCliSync\(\{/, 'cli.js 组装域 ctx');
  assert.match(cli, /return syncDomain\.dispatchSync\(\);/, 'sync 命令走域模块分发（防死模块）');
  assert.match(cli, /return syncDomain\.steamClaim\(\);/, 'steam-claim 走域模块');
  assert.match(cli, /\.\.\.syncDomain\.trackedCommands/, 'TRACKED_COMMANDS 展开域命令（写 sync_runs 语义保持）');
  assert.match(cli, /'steam-accounts': syncDomain\.trackedCommands\['steam-accounts'\]/, 'commands 注册表条目指域模块（注册表语义保持）');
});

test('同步类命令实现全部在新文件，cli.js 不残留实现（防双实现）', () => {
  const impls = [
    'cmdSyncSteam',
    'cmdSyncSteamPrices',
    'cmdImportSteamCatalog',
    'cmdSyncSteamAll',
    'cmdAppSync',
    'cmdSteamDiscovery',
    'cmdSyncSonkwo',
    'runSonkwoMatchStep',
    'cmdSyncItad',
    'syncByTitle',
    'cmdSyncGog',
    'cmdSyncHumble',
    'cmdDiscover',
    'cmdSteamAccounts',
    'cmdSteamClaim',
    'cmdSteamStatus',
    'cmdSyncAll',
  ];
  for (const name of impls) {
    assert.ok(syncMod.includes(`async function ${name}`), `src/cli/sync.js 缺少实现 ${name}`);
    assert.ok(!cli.includes(`async function ${name}`), `cli.js 残留实现 ${name}（防双实现）`);
  }
});

// ── B4 #19（CO-5/B4-2 第十一轮）：cli 报表类域三条锁 ──

const REPORT_IMPLS = ['cmdReport', 'cmdAlerts', 'cmdStats', 'cmdHistory', 'cmdList', 'cmdChart', 'cmdCompare'];
const REPORT_COMMAND_KEYS = ['report', 'alerts', 'stats', 'history', 'list', 'chart', 'compare'];

test('报表类命令实现全部在 src/cli/report.js，cli.js 不残留实现（防双实现）', () => {
  for (const name of REPORT_IMPLS) {
    assert.ok(reportMod.includes(`async function ${name}`), `src/cli/report.js 缺少实现 ${name}`);
    assert.ok(!cli.includes(`async function ${name}`), `cli.js 残留实现 ${name}（防双实现）`);
  }
});

test('报表类命令注册表条目指域模块（注册表语义保持，防死模块）', () => {
  for (const key of REPORT_COMMAND_KEYS) {
    assert.ok(reportMod.includes(`${key}: cmd`), `src/cli/report.js 缺少注册条目 ${key}`);
    assert.match(cli, new RegExp(`${key}: reportDomain\\.commands\\.${key}`), `cli.js 的 commands.${key} 未指向域模块（防死模块）`);
  }
});

test('cli.js 真实接线：import 报表域模块 + TRACKED_COMMANDS 展开 alerts/report（写 sync_runs 语义保持）', () => {
  assert.match(cli, /import \{ createCliReport \} from '\.\/cli\/report\.js'/, 'cli.js import 报表域模块');
  assert.match(cli, /const reportDomain = createCliReport\(\{ args, flag, logger, withStore, yuan, pad \}\)/, 'cli.js 组装报表域 ctx（yuan/pad 跨域工具传引用）');
  assert.match(cli, /\.\.\.reportDomain\.trackedCommands/, 'TRACKED_COMMANDS 展开报表域 trackedCommands（alerts/report 写 sync_runs 语义保持）');
  assert.doesNotMatch(cli, /alerts: cmdAlerts|report: cmdReport/, 'cli.js 不再直接引用报表命令实现（防双实现）');
});

test('sparkline/BLOCKS 仅随报表域移出，cli.js 不再残留', () => {
  assert.ok(reportMod.includes('const sparkline'), 'sparkline 在报表域（history 使用）');
  assert.ok(!cli.includes('const sparkline') && !cli.includes("const BLOCKS"), 'cli.js 不再残留 sparkline/BLOCKS（history 唯一使用者已拆走）');
});

// ── B4 #20（CO-5/B4-2 第十二轮）：cli 运维类域三条锁 ──

const OPS_IMPLS = [
  'cmdBackfill',
  'cmdRename',
  'cmdHeat',
  'cmdRatingBackfill',
  'cmdSearchTokens',
  'cmdImages',
  'cmdPrune',
  'cmdLogs',
  'cmdBackup',
  'cmdDiagnose',
  'cmdProxyCheck',
  'cmdProbe',
  'cmdReadModel',
  'cmdServe',
  'cmdAll',
];
const OPS_COMMAND_KEYS = ['backfill', 'rename', 'heat', 'rating-backfill', 'search-tokens', 'images', 'prune', 'logs', 'backup', 'diagnose', 'proxy-check', 'probe', 'readmodel', 'serve', 'all'];
const OPS_TRACKED_KEYS = ['heat', 'rename', 'rating-backfill', 'search-tokens', 'backfill', 'images', 'backup', 'prune', 'readmodel'];

test('运维类命令实现全部在 src/cli/ops.js，cli.js 不残留实现（防双实现）', () => {
  for (const name of OPS_IMPLS) {
    assert.ok(opsMod.includes(`async function ${name}`) || opsMod.includes(`function ${name}`), `src/cli/ops.js 缺少实现 ${name}`);
    assert.ok(!cli.includes(`async function ${name}`) && !cli.includes(`function ${name}`), `cli.js 残留实现 ${name}（防双实现）`);
  }
  assert.ok(!cli.includes('setupAccessForRun') && !cli.includes('printSetupToken'), 'setup 口令工具随 serve/all 域移出（cli.js 不再残留）');
});

test('运维类命令注册表条目指域模块（注册表语义保持，防死模块）', () => {
  for (const key of OPS_COMMAND_KEYS) {
    assert.match(cli, new RegExp(`'?${key}'?: opsDomain\\.commands\\.?\\[?'?${key}`), `cli.js 的 commands.${key} 未指向域模块（防死模块）`);
  }
});

test('cli.js 真实接线：import 运维域模块 + TRACKED_COMMANDS 展开 9 条（写 sync_runs 语义保持）', () => {
  assert.match(cli, /import \{ createCliOps \} from '\.\/cli\/ops\.js'/, 'cli.js import 运维域模块');
  assert.match(cli, /const opsDomain = createCliOps\(\{/, 'cli.js 组装运维域 ctx');
  assert.match(cli, /\.\.\.opsDomain\.trackedCommands/, 'TRACKED_COMMANDS 展开运维域 trackedCommands（写 sync_runs 语义保持）');
  assert.match(cli, /runSyncTracked\('logs', opsDomain\.commands\.logs\)/, 'logs prune 分发走域模块（调度器留痕语义保持）');
  for (const key of OPS_TRACKED_KEYS) {
    assert.ok(!cli.includes(`${key}: cmd`), `cli.js 不再直接引用运维命令实现 ${key}（防双实现）`);
  }
});
