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
const cli = readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
const syncMod = readFileSync(new URL('../src/cli/sync.js', import.meta.url), 'utf8');
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
