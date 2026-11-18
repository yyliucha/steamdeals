#!/usr/bin/env node
// CO-4/D6 基线门禁（docs/DESIGN-AUDIT.md D6 行；与 CK 批 e2e 发版报告联动，见 docs/E2E-SUITE.md）：
//   coverage —— 主链测试覆盖率阈值断言（Node 内置 --test-coverage-* 阈值，主链文件清单从 package.json 解析）；
//   perf     —— 关键查询性能散点断言（列表 /api/games 与搜索 /api/games/search 的 P95，pglite + 种子数据）；
//   e2e      —— 解析 e2e 报告 HTML 内嵌的 results JSON，断言无失败行 + 每行耗时低于阈值。
// 阈值一律先宽松防误报，env 可调；本地可用 --record 把实测写入 docs/baselines.json 的 records。
// 用法：
//   node scripts/baseline-gate.mjs --mode=coverage|perf|e2e|all
//   [--files=<逗号分隔的测试文件>]（覆盖主链清单，测试/调试用）
//   [--e2e-report=<报告 HTML 路径>]（e2e 模式必需，all 模式可选）
//   [--record]（把本轮实测追加进 docs/baselines.json，仅本地使用）
// env 覆盖：GATE_COVERAGE_LINES / GATE_COVERAGE_BRANCHES / GATE_COVERAGE_FUNCTIONS /
//           GATE_GAMES_P95_MS / GATE_GAMES_SEARCH_P95_MS / GATE_E2E_ROW_MS
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINES_PATH = join(REPO_ROOT, 'docs', 'baselines.json');

// 内置默认（最宽松兜底；实际阈值以 docs/baselines.json 为准，env 覆盖两者）
const BUILTIN = {
  coverage: { lines: 30, branches: 20, functions: 20 },
  perf: { gamesP95Ms: 150, gamesSearchP95Ms: 300 },
  e2e: { rowMs: 30_000 },
};

function loadBaselines() {
  try {
    return JSON.parse(readFileSync(BASELINES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function envNum(name) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** 阈值：env > docs/baselines.json > 内置默认。 */
function threshold(group, key, envName) {
  const base = loadBaselines();
  return envNum(envName) ?? (Number(base[group]?.[key]) || BUILTIN[group][key]);
}

/** 从 package.json 的 test 脚本递归解析主链测试文件清单（与 npm test 实际执行一致）。 */
export function mainChainFiles(pkgPath = join(REPO_ROOT, 'package.json')) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const scripts = pkg.scripts ?? {};
  const files = [];
  const seen = new Set();
  const collect = (script) => {
    for (const m of String(script ?? '').matchAll(/node\s+(test\/[\w\-./]+\.js)/g)) {
      const f = m[1];
      if (!seen.has(f)) {
        seen.add(f);
        files.push(f);
      }
    }
    for (const m of String(script ?? '').matchAll(/npm run (test:\d+)/g)) {
      const ref = m[1];
      if (!seen.has(`ref:${ref}`)) {
        seen.add(`ref:${ref}`);
        collect(scripts[ref]);
      }
    }
  };
  collect(scripts.test);
  return files;
}

function run(cmd, args, { quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: REPO_ROOT,
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
    });
    const out = [];
    if (quiet) {
      child.stdout.on('data', (d) => out.push(d));
      child.stderr.on('data', (d) => out.push(d));
    }
    child.on('close', (code) => resolve({ code: code ?? 1, output: Buffer.concat(out).toString('utf8') }));
  });
}

// ---------------- 判定纯函数（供测试直接锁行为；gate* 模式内调用后据 exitCode 透传） ----------------

/**
 * 覆盖率判定：Node --test-coverage 的阈值在运行器内完成（不达标即非零退出），
 * 这里只负责把退出码转成判定结果，并保留报告尾部供排查。
 */
export function coverageGateDecision(exitCode, tail) {
  return { ok: exitCode === 0, reason: exitCode === 0 ? '覆盖率达标' : `覆盖率阈值未达标（退出码 ${exitCode}）`, tail };
}

/** 性能散点判定：P95 严格小于阈值（宽松阈值防误报，超限即红）。 */
export function perfGateDecision(measured, thresholds) {
  const { listP95, searchP95 } = measured;
  const { gamesP95Ms, gamesSearchP95Ms } = thresholds;
  const fails = [];
  if (!(listP95 < gamesP95Ms)) fails.push(`/api/games 列表 P95=${listP95}ms ≥ 阈值 ${gamesP95Ms}ms`);
  if (!(searchP95 < gamesSearchP95Ms)) fails.push(`/api/games/search 搜索 P95=${searchP95}ms ≥ 阈值 ${gamesSearchP95Ms}ms`);
  return { ok: fails.length === 0, reason: fails.join('；') || '性能散点达标', fails };
}

/** 解析 e2e 报告 HTML 内嵌的 results JSON（无则返回 null，联动跳过）。 */
export function parseE2eResults(html) {
  const m = String(html ?? '').match(/<script[^>]*id="e2e-results"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** e2e 联动判定：失败行 0 且每行耗时低于阈值（预算截断行不计超时）。 */
export function e2eGateDecision(results, rowMs) {
  const rows = results?.rows ?? [];
  const fails = rows.filter((r) => r.status === 'fail');
  const slow = rows.filter((r) => r.status !== 'truncated' && Number(r.durationMs) > rowMs);
  const reasons = [];
  if (fails.length) reasons.push(`e2e 失败行：${fails.map((r) => r.id).join(', ')}`);
  if (slow.length) reasons.push(`e2e 超时行：${slow.map((r) => `${r.id}(${r.durationMs}ms)`).join(', ')}`);
  return { ok: reasons.length === 0, reason: reasons.join('；') || 'e2e 报告联动达标', fails, slow };
}

// ---------------- coverage ----------------
async function gateCoverage(filesOverride) {
  const files = filesOverride && filesOverride.length ? filesOverride : mainChainFiles();
  const lines = threshold('coverage', 'lines', 'GATE_COVERAGE_LINES');
  const branches = threshold('coverage', 'branches', 'GATE_COVERAGE_BRANCHES');
  const functions = threshold('coverage', 'functions', 'GATE_COVERAGE_FUNCTIONS');
  console.log(`[gate:coverage] 主链测试 ${files.length} 个文件；阈值 lines=${lines}% branches=${branches}% funcs=${functions}%（env 可调）`);
  const args = [
    '--test',
    '--experimental-test-coverage',
    `--test-coverage-lines=${lines}`,
    `--test-coverage-branches=${branches}`,
    `--test-coverage-functions=${functions}`,
    '--test-coverage-include=src/**/*.js',
    ...files,
  ];
  const { code, output } = await run(process.execPath, args, { quiet: true });
  const decision = coverageGateDecision(code ?? 1, output.split(/\r?\n/).slice(-25).join('\n'));
  console.log(decision.tail);
  console.log(`[gate:coverage] ${decision.ok ? '✅' : '❌'} ${decision.reason}`);
  if (!decision.ok) process.exitCode = 1;
  return decision;
}

// ---------------- perf ----------------
function p95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

async function gatePerf(record = false) {
  const gamesMs = threshold('perf', 'gamesP95Ms', 'GATE_GAMES_P95_MS');
  const searchMs = threshold('perf', 'gamesSearchP95Ms', 'GATE_GAMES_SEARCH_P95_MS');
  console.log(`[gate:perf] 列表 P95<${gamesMs}ms、搜索 P95<${searchMs}ms（pglite + 种子 3 游戏，各测 20 次）`);
  // 复用 e2e 本地栈（pglite 临时库 + 真 HTTP + 种子数据），不依赖 Docker/真实 PG
  const { startE2EStack } = await import('../test/e2e/lib/server.mjs');
  const stack = await startE2EStack(REPO_ROOT);
  const timing = async (fn) => {
    const t0 = performance.now();
    await fn();
    return performance.now() - t0;
  };
  try {
    const listMs = [];
    const searchMsList = [];
    // 预热 2 次（连接池/查询计划稳定），再测 20 次
    for (let i = 0; i < 2; i += 1) {
      await fetch(`${stack.base}/api/games?page=1&pageSize=20&region=cn&type=all&sort=discount&owned=include`);
      await fetch(`${stack.base}/api/games/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ page: 1, pageSize: 20, region: 'cn', sort: 'discount', owned: 'include' }),
      });
    }
    for (let i = 0; i < 20; i += 1) {
      listMs.push(await timing(() => fetch(`${stack.base}/api/games?page=1&pageSize=20&region=cn&type=all&sort=discount&owned=include`)));
      searchMsList.push(await timing(() => fetch(`${stack.base}/api/games/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ page: 1, pageSize: 20, region: 'cn', sort: 'discount', owned: 'include' }),
      })));
    }
    const listP95 = Math.round(p95(listMs) * 10) / 10;
    const searchP95 = Math.round(p95(searchMsList) * 10) / 10;
    console.log(`[gate:perf] /api/games 列表 P95=${listP95}ms（阈值 ${gamesMs}ms）；/api/games/search 搜索 P95=${searchP95}ms（阈值 ${searchMs}ms）`);
    if (record) {
      const base = loadBaselines();
      const rec = { at: new Date().toISOString().slice(0, 10), gamesP95Ms: listP95, gamesSearchP95Ms: searchP95, env: process.env.GATE_GAMES_P95_MS ?? '' };
      base.records = [...(base.records ?? []), rec];
      writeFileSync(BASELINES_PATH, `${JSON.stringify(base, null, 2)}\n`, 'utf8');
      console.log('[gate:perf] 已写入 docs/baselines.json 的 records');
    }
    const decision = perfGateDecision({ listP95, searchP95 }, { gamesP95Ms: gamesMs, gamesSearchP95Ms: searchMs });
    console.log(`[gate:perf] ${decision.ok ? '✅' : '❌'} ${decision.reason}`);
    if (!decision.ok) process.exitCode = 1;
    return { ...decision, listP95, searchP95 };
  } finally {
    await stack.close().catch(() => {});
  }
}

// ---------------- e2e 报告联动 ----------------
async function gateE2e(reportPath) {
  const rowMs = threshold('e2e', 'rowMs', 'GATE_E2E_ROW_MS');
  if (!reportPath || !existsSync(reportPath)) {
    console.log(`[gate:e2e] ⏭ 未提供 e2e 报告（--e2e-report=<HTML>），跳过联动（发版报告会话跑完全量后用本模式复核）`);
    return { ok: true, skipped: true };
  }
  const html = readFileSync(reportPath, 'utf8');
  const results = parseE2eResults(html);
  if (!results) {
    console.error('[gate:e2e] ❌ 报告里没有可解析的 e2e-results 内嵌 JSON（旧版报告）');
    process.exitCode = 1;
    return { ok: false };
  }
  const decision = e2eGateDecision(results, rowMs);
  console.log(`[gate:e2e] 报告行数 ${results.rows?.length ?? 0}，失败 ${decision.fails.length}，超时行(${rowMs}ms) ${decision.slow.length}`);
  console.log(`[gate:e2e] ${decision.ok ? '✅' : '❌'} ${decision.reason}`);
  if (!decision.ok) process.exitCode = 1;
  return decision;
}

// ---------------- 参数解析与入口 ----------------
function argValue(args, name) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

// 只有作为 CLI 入口执行时才跑 main——被测试 import 时只导出纯函数（否则 import 会误触全量门禁）。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runMain();
}

async function runMain() {
const args = process.argv.slice(2);
const mode = argValue(args, 'mode') ?? 'all';
const filesOverride = (argValue(args, 'files') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const e2eReport = argValue(args, 'e2e-report');
const record = args.includes('--record');

const wanted = mode === 'all' ? ['coverage', 'perf', 'e2e'] : [mode];
console.log(`[gate] 模式：${wanted.join(' + ')}（env 阈值可调：GATE_COVERAGE_LINES/Branches/Functions、GATE_GAMES_P95_MS、GATE_GAMES_SEARCH_P95_MS、GATE_E2E_ROW_MS）`);

for (const m of wanted) {
  if (m === 'coverage') await gateCoverage(filesOverride);
  if (m === 'perf') await gatePerf(record);
  if (m === 'e2e') await gateE2e(e2eReport);
}
}
