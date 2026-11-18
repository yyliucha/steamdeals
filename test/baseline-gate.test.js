// CO-4/D6 基线门禁测试（docs/DESIGN-AUDIT.md D6 行）：
// 守的约束——门禁判定逻辑能复现红/绿（反向自检：阈值不可达/超限输入 → 判定失败）；
// 主链文件清单解析与 package.json 的 test 脚本一致；e2e 报告联动判定失败行与超时行。
// 说明：真 spawn 门禁进程在 Windows node:test 运行器内不可靠（spawnSync 子进程 argv 丢失、status 9，
// 见 docs/QA 复检记录），故测试直接锁判定纯函数（scripts/baseline-gate.mjs 导出的 *GateDecision）；
// 门禁真跑的「红/绿」由开发与 CI 实跑验证（CI 的 test job 每发版必跑）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mainChainFiles,
  coverageGateDecision,
  perfGateDecision,
  parseE2eResults,
  e2eGateDecision,
} from '../scripts/baseline-gate.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('D6：主链文件清单解析——与 package.json test 脚本一致且文件都存在', () => {
  const files = mainChainFiles();
  assert.ok(files.length >= 90, `主链文件数应 ≥90（当前 ${files.length}）`);
  for (const f of files) {
    assert.ok(existsSync(join(ROOT, f)), `主链文件存在：${f}`);
  }
  assert.ok(files.includes('test/style-tokens.test.js'), '包含既有主链文件');
});

test('D6 反向自检：覆盖率不达标（非零退出）→ 判定红，达标 → 绿', () => {
  const bad = coverageGateDecision(1, '…all files | 38.36 |…');
  assert.equal(bad.ok, false, '非零退出必须判红');
  assert.match(bad.reason, /覆盖率阈值未达标/, '理由写清未达标');
  const good = coverageGateDecision(0, '…all files | 45.00 |…');
  assert.equal(good.ok, true, '零退出必须判绿');
});

test('D6 反向自检：性能散点超阈值 → 判定红（阈值 0/超限都红），达标 → 绿', () => {
  // 阈值 0：任何实测都红（等价于 CI 里 GATE_GAMES_P95_MS=0 复现失败）
  const zero = perfGateDecision({ listP95: 80, searchP95: 90 }, { gamesP95Ms: 0, gamesSearchP95Ms: 0 });
  assert.equal(zero.ok, false, '0 阈值必然红');
  // 实测 = 阈值（不含等于）也红——严格小于才通过
  const eq = perfGateDecision({ listP95: 150, searchP95: 100 }, { gamesP95Ms: 150, gamesSearchP95Ms: 300 });
  assert.equal(eq.ok, false, '实测等于阈值必须红（严格小于）');
  assert.match(eq.reason, /列表 P95=150ms/, '理由带散点与阈值');
  // 低于阈值 → 绿
  const ok = perfGateDecision({ listP95: 149.9, searchP95: 299 }, { gamesP95Ms: 150, gamesSearchP95Ms: 300 });
  assert.equal(ok.ok, true, '低于阈值必须绿');
});

test('D6：e2e 报告联动——失败行/超时行判红，干净报告判绿，旧版/坏 JSON 判不可解析', () => {
  const html = (rows) => `<!doctype html><html><body><script type="application/json" id="e2e-results">${JSON.stringify({ rows }).replaceAll('</', '<\\/')}</script></body></html>`;
  // 失败行 → 红
  const bad = e2eGateDecision(parseE2eResults(html([{ id: 'home', status: 'fail', durationMs: 100 }])), 30_000);
  assert.equal(bad.ok, false, '有失败行必须红');
  assert.match(bad.reason, /e2e 失败行/, '理由带失败行');
  // 超时行 → 红（预算截断行不计超时）
  const slow = e2eGateDecision(parseE2eResults(html([
    { id: 'home', status: 'pass', durationMs: 99_999 },
    { id: 'tail', status: 'truncated', durationMs: 400_000 },
  ])), 1_000);
  assert.equal(slow.ok, false, '超时行必须红');
  assert.equal(slow.slow.length, 1, '预算截断行不算超时');
  // 干净报告 → 绿
  const ok = e2eGateDecision(parseE2eResults(html([{ id: 'home', status: 'pass', durationMs: 500 }])), 1_000);
  assert.equal(ok.ok, true, '干净报告必须绿');
  // 旧版报告（无内嵌 JSON）→ null（联动跳过，不判错）
  assert.equal(parseE2eResults('<html>旧版报告</html>'), null, '旧版报告返回 null');
  assert.equal(parseE2eResults(html([{}])).rows.length, 1, '内嵌 JSON 可解析');
});

test('D6：docs/baselines.json 结构齐全（阈值分组 + records 数组）', () => {
  const b = JSON.parse(readFileSync(join(ROOT, 'docs', 'baselines.json'), 'utf8'));
  assert.ok(typeof b.coverage?.lines === 'number' && b.coverage.lines > 0, 'coverage.lines 数字阈值');
  assert.ok(typeof b.perf?.gamesP95Ms === 'number' && b.perf.gamesP95Ms > 0, 'perf.gamesP95Ms 数字阈值');
  assert.ok(typeof b.e2e?.rowMs === 'number' && b.e2e.rowMs > 0, 'e2e.rowMs 数字阈值');
  assert.ok(Array.isArray(b.records), 'records 数组');
});
