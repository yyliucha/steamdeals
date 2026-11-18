// e2e 整轮总预算纯函数单测（DJ 批）。守的约束（对应 TODO DJ 验收 ①② + 退出码三态）：
// - 缩短预算到点必须强制收尾：剩余未跑行标「预算截断」；
// - 正常轮（默认 20 分钟预算）在预算内绝不截断；
// - 退出码三态区分：0 全绿 / 1 有失败 / 2 预算截断（截断优先于失败）。
// 反向自检（每轮做一次，改坏必须红）：
//   把 lib/budget.mjs 的 isBudgetExceeded 里 `nowMs >= deadlineMs` 改成 `nowMs > deadlineMs`
//   （到点那一刻不再判超）→ 「到点强制截断」用例必须红；
//   把 exitCode 的 `truncated > 0` 判据删掉 → 「截断 → 2 / 截断优先于失败」用例必须红。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BUDGET_MS,
  TRUNCATED_STATUS,
  resolveBudgetMs,
  deadlineFor,
  isBudgetExceeded,
  truncateRows,
  exitCode,
} from './lib/budget.mjs';

test('默认整轮预算 = 20 分钟（无 env/CLI 输入）', () => {
  // 守：规格「默认 20 分钟 deadline」——漂移默认值（如改成 15 分钟）必须红。
  assert.equal(resolveBudgetMs({}), DEFAULT_BUDGET_MS);
  assert.equal(DEFAULT_BUDGET_MS, 20 * 60 * 1000);
  assert.equal(resolveBudgetMs({ envMs: '', cliMs: undefined }), DEFAULT_BUDGET_MS);
});

test('E2E_BUDGET_MS 环境变量可缩短预算；--budget-ms= 显式值优先', () => {
  // 守：测试/报告会话能缩短预算模拟到点截断（交接验收 ① 的前置）。
  assert.equal(resolveBudgetMs({ envMs: '60000' }), 60000);
  assert.equal(resolveBudgetMs({ envMs: '1' }), 1);
  assert.equal(resolveBudgetMs({ envMs: '60000', cliMs: '90000' }), 90000);
  assert.equal(resolveBudgetMs({ envMs: '90000', cliMs: '60000' }), 60000);
  // 守：<=0 = 禁用预算（调试用），而不是"立即截断全部行"（预算 0 不应成为事故开关）。
  assert.equal(resolveBudgetMs({ envMs: '0' }), 0);
});

test('非法预算值抛错（宁红不静默）', () => {
  assert.throws(() => resolveBudgetMs({ envMs: 'abc' }), /整轮预算必须是有限毫秒数/);
  assert.throws(() => resolveBudgetMs({ envMs: '-5' }), /整轮预算不能为负/);
});

test('缩短预算到点强制截断：剩余未跑行全部标「预算截断」', () => {
  // 守：交接验收 ①——到点强制收尾，剩余项标「预算截断」，且不改动输入行、带统一原因。
  const rows = [
    { id: 'a', name: '行 A' },
    { id: 'b', name: '行 B' },
  ];
  const startedAt = 1000;
  const budgetMs = 500; // 缩短预算
  const deadline = deadlineFor(startedAt, budgetMs);
  assert.equal(deadline, 1500);
  // 到点那一刻（恰好相等）也必须截（>=，不是 >）——这是"强制收尾"的口径。
  assert.equal(isBudgetExceeded(1500, deadline), true);
  assert.equal(isBudgetExceeded(1501, deadline), true);
  const recs = truncateRows(rows, { budgetMs });
  assert.equal(recs.length, 2);
  for (const rec of recs) {
    assert.equal(rec.status, TRUNCATED_STATUS);
    assert.ok(rec.skipReason.includes('预算截断'), `原因必须含「预算截断」：${rec.skipReason}`);
    assert.ok(rec.skipReason.includes('500ms'));
    assert.equal(rec.durationMs, 0);
    assert.deepEqual(rec.artifacts, []);
    assert.deepEqual(rec.consoleErrors, []);
  }
  // 输入行不被改写（runner 主循环依赖 row 原对象继续存在）。
  assert.equal(rows[0].status, undefined);
  assert.equal(rows[1].skipReason, undefined);
});

test('正常轮不截断：默认 20 分钟预算内绝不触发', () => {
  // 守：交接验收 ②——正常全量在预算内不截断（用默认预算，模拟跑了 10 分钟还远未到点）。
  const startedAt = 100_000;
  const deadline = deadlineFor(startedAt, DEFAULT_BUDGET_MS);
  assert.equal(deadline, 100_000 + DEFAULT_BUDGET_MS);
  assert.equal(isBudgetExceeded(startedAt + 10 * 60 * 1000, deadline), false); // +10 分钟，未到点
  assert.equal(isBudgetExceeded(startedAt + DEFAULT_BUDGET_MS - 1, deadline), false); // 差 1ms，未到点
  // 未到点时 runner 不调用 truncateRows（截断由"到点"触发，不由预算值本身触发）。
  assert.equal(isBudgetExceeded(startedAt + DEFAULT_BUDGET_MS, deadline), true); // 恰好到点即截
});

test('禁用预算（<=0）没有 deadline，永不截断', () => {
  assert.equal(deadlineFor(123, 0), null);
  assert.equal(isBudgetExceeded(999_999_999, null), false);
});

test('退出码三态：0 全绿 / 1 有失败 / 2 预算截断（截断优先于失败）', () => {
  // 守：交接范围 ①「退出码区分全绿 / 有失败 / 预算截断三态」。
  assert.equal(exitCode({ failed: 0, truncated: 0 }), 0);
  assert.equal(exitCode({ failed: 2, truncated: 0 }), 1);
  assert.equal(exitCode({ failed: 0, truncated: 3 }), 2);
  // 截断优先：轮次不完整时即使也有失败，退出码仍是 2（失败明细在报告里，调用方靠码区分"轮没跑完"）。
  assert.equal(exitCode({ failed: 1, truncated: 2 }), 2);
});
