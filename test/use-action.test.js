// FQ 批（docs/UI-BUTTON-FEEDBACK.md §4）：useAction composable 行为锁——
// 1) 防连点：loading 期间再次 run 直接忽略（fn 只执行一次，不发起第二次请求）；
// 2) loading 至少持续 minMs（默认 200ms），立即完成的 fn 也不会闪烁；
// 3) 成功走 successMsg（文案或 (result)=>文案），失败走 errorMsg（缺省 e.message）；
// 4) refresh 回调在成功后执行（用真实延时锁顺序）；
// 5) holdMin 纯函数：未到 minMs 补足、已过则立即 resolve。
// 反向自检：删掉防连点分支 → 用例 1 红；删掉 holdMin 等待 → 用例 2 红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { useAction, holdMin } from '../frontend/src/composables/useAction.js';

// FQ 批模板层静态锁：Vue 模板 ref 解包只对顶层属性生效——`:loading="backupAction.loading"`
// 会把 Ref 对象当 truthy 传给按钮（aria-disabled="[object Object]"，按钮永远 loading）。
// 正确写法：loading 提为顶层别名（const backupLoading=backupAction.loading）后绑定 `:loading="backupLoading"`。
// 反向自检：把模板里任一 `:loading="xxxLoading"` 改回 `xxxAction.loading` 或删掉别名行 → 本用例红。
const ADMIN_MODULES = readFileSync(fileURLToPath(new URL('../frontend/src/pages/AdminModules.vue', import.meta.url)), 'utf8');

test('FQ 模板层：:loading 不得直接绑定嵌套 Action.loading（Ref 不解包恒 truthy），必须走顶层别名', () => {
  assert.ok(!/:loading="[a-zA-Z]+Action\.loading"/.test(ADMIN_MODULES), '模板不得出现 :loading="xxxAction.loading"（嵌套 ref 不解包）');
  assert.match(ADMIN_MODULES, /backupLoading=backupAction\.loading/, 'backupLoading 顶层别名存在（FR 备份按钮绑定它）');
  assert.match(ADMIN_MODULES, /:loading="backupLoading"/, '备份按钮绑定顶层别名 backupLoading');
  assert.match(ADMIN_MODULES, /:loading="statsLoading"/, '统计刷新按钮绑定顶层别名 statsLoading');
  // appSyncAction 的 loading 在模板文本表达式里同样需要顶层别名（否则状态恒「同步中…」）
  assert.ok(!/\{\{[^}]*appSyncAction\.loading[^}]*\}\}/.test(ADMIN_MODULES), '模板插值不得直接读 appSyncAction.loading');
});

function fakeMsgs() {
  const out = [];
  return {
    out,
    successMsg: (m) => out.push(['success', m]),
    errorMsg: (m) => out.push(['error', m]),
  };
}

test('FQ：loading 期间再次 run 直接忽略（防连点，fn 只执行一次）', async () => {
  const msgs = fakeMsgs();
  const { loading, run } = useAction(msgs);
  let calls = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const first = run(async () => {
    calls += 1;
    await gate;
    return 'a';
  });
  const second = await run(async () => {
    calls += 1;
    return 'b';
  });
  assert.equal(second, null, '连点第二次直接返回 null');
  assert.equal(loading.value, true, '第一次仍在 loading');
  release();
  assert.equal(await first, 'a', '第一次正常返回结果');
  assert.equal(calls, 1, 'fn 只执行了一次');
});

test('FQ：loading 至少持续 minMs——立即完成的 fn 也补足 200ms', async () => {
  const msgs = fakeMsgs();
  const { run } = useAction(msgs);
  const startedAt = Date.now();
  await run(async () => 'ok', { success: '已刷新' });
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 200 - 30, `实际耗时 ${elapsed}ms 不短于 200ms（留 30ms 计时误差）`);
  assert.deepEqual(msgs.out, [['success', '已刷新']], '成功提示已发出');
});

test('FQ：成功提示支持函数文案（接收结果），失败缺省取 e.message', async () => {
  const msgs = fakeMsgs();
  const { run } = useAction(msgs);
  await run(async () => ({ rows: 42 }), { success: (d) => `备份完成：${d.rows} 行`, minMs: 0 });
  assert.deepEqual(msgs.out, [['success', '备份完成：42 行']], '函数文案用结果拼出');
  await run(async () => {
    throw new Error('连接失败');
  }, { minMs: 0 });
  assert.deepEqual(msgs.out[1], ['error', '连接失败'], '失败缺省取 e.message');
});

test('FQ：refresh 回调在成功后执行且能拿到结果', async () => {
  const msgs = fakeMsgs();
  const { run } = useAction(msgs);
  const order = [];
  let refreshed = null;
  await run(async () => {
    order.push('fn');
    return { n: 7 };
  }, { success: '已保存', refresh: (d) => {
    refreshed = d;
    order.push('refresh');
  }, minMs: 0 });
  assert.deepEqual(order, ['fn', 'refresh'], 'fn 先于 refresh');
  assert.equal(refreshed?.n, 7, 'refresh 拿到 fn 结果');
  assert.deepEqual(msgs.out, [['success', '已保存']], '成功提示先于 refresh（按代码顺序在 refresh 之前）');
});

test('FQ：holdMin 纯函数——未到点补足、已过点立即 resolve', async () => {
  const t1 = Date.now();
  await holdMin(t1, 60);
  assert.ok(Date.now() - t1 >= 60 - 30, '未到 60ms 会等待补足');
  const t2 = Date.now();
  await holdMin(t2 - 500, 200);
  assert.ok(Date.now() - t2 < 40, '已过 200ms 立即完成');
});
