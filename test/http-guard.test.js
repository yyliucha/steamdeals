// B1 批（docs/DESIGN-AUDIT.md B1）：统一请求超时 + 重型接口并发闸——
// 闸门单测（并发上限/FIFO/队列满 GATE_BUSY/排队超时 GATE_WAIT_TIMEOUT/任务抛错不破坏闸）；
// 配置表与超时白名单静态断言（重型接口必须登记、静态资源/导出必须豁免）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConcurrencyGate } from '../src/http-guard.js';
import { HEAVY_GATE_CONFIG, isTimeoutExemptPath } from '../src/server.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('B1 闸门：并发上限 max 严格生效，全部任务最终完成', async () => {
  const gate = createConcurrencyGate({ max: 2, maxQueue: 20, waitMs: 5000 });
  let active = 0;
  let peak = 0;
  const task = async (i) => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(15);
    active -= 1;
    return i;
  };
  const results = await Promise.all([1, 2, 3, 4, 5].map((i) => gate.run(() => task(i))));
  assert.deepEqual(results, [1, 2, 3, 4, 5], '排队任务不丢');
  assert.equal(peak, 2, `同一时刻最多 2 个在执行，实际峰值 ${peak}`);
  assert.equal(gate.pending, 0, '结束后无排队');
  assert.equal(gate.active, 0, '结束后无占用');
});

test('B1 闸门：队列 FIFO，完成顺序与启动顺序一致', async () => {
  const gate = createConcurrencyGate({ max: 1, maxQueue: 20, waitMs: 5000 });
  const order = [];
  const task = async (i) => {
    await sleep(5);
    order.push(i);
    return i;
  };
  await Promise.all([0, 1, 2, 3].map((i) => gate.run(() => task(i))));
  assert.deepEqual(order, [0, 1, 2, 3], '先到先执行');
});

test('B1 闸门：队列超 maxQueue 立即 GATE_BUSY，不等任务结束', async () => {
  const gate = createConcurrencyGate({ max: 1, maxQueue: 1, waitMs: 5000 });
  let released = false;
  const slow = gate.run(async () => {
    await sleep(60);
    released = true;
  });
  const waiting = gate.run(async () => sleep(60)); // 占掉唯一排队位
  await sleep(5);
  await assert.rejects(gate.run(async () => 'never'), (err) => err.code === 'GATE_BUSY', '第三个请求（队列已满）→ GATE_BUSY');
  await Promise.all([slow, waiting]);
  assert.equal(released, true, '前两个任务正常完成');
  // 队列空出来后可继续接受任务（闸没有被 busy 破坏）
  assert.equal(await gate.run(async () => 'ok'), 'ok');
});

test('B1 闸门：排队超 waitMs 抛 GATE_WAIT_TIMEOUT，槽位释放后其它任务照常', async () => {
  const gate = createConcurrencyGate({ max: 1, maxQueue: 20, waitMs: 40 });
  const slow = gate.run(async () => sleep(80));
  await sleep(5);
  await assert.rejects(gate.run(async () => 'x'), (err) => err.code === 'GATE_WAIT_TIMEOUT', '排队 40ms 未等到槽位 → GATE_WAIT_TIMEOUT');
  await slow;
  assert.equal(await gate.run(async () => 'after'), 'after', '超时移除后闸门仍正常');
});

test('B1 闸门：任务抛错释放槽位，后续任务不被卡死', async () => {
  const gate = createConcurrencyGate({ max: 1, maxQueue: 20, waitMs: 5000 });
  await assert.rejects(gate.run(async () => {
    throw new Error('boom');
  }), /boom/);
  assert.equal(await gate.run(async () => 'fine'), 'fine', '错误任务之后槽位已释放');
});

test('B1 配置表：重型接口登记且并发 ≤2（admin 列表/对齐 ≤1，公开搜索 GET/POST 共用 ≤2）', () => {
  // 这条断言守的是"新增长查询接口必须显式登记并发上限"——改配置即改系统保护边界
  assert.deepEqual(HEAVY_GATE_CONFIG['GET /api/admin/games'], 1, '/api/admin/games 并发 ≤1');
  assert.deepEqual(HEAVY_GATE_CONFIG['GET /api/admin/align'], 1, '/api/admin/align 并发 ≤1');
  assert.deepEqual(HEAVY_GATE_CONFIG['games-search'], 2, '/api/games 与 /api/games/search 共用一把闸 ≤2');
  assert.ok(!('GET /api/games' in HEAVY_GATE_CONFIG) && !('POST /api/games/search' in HEAVY_GATE_CONFIG),
    '公开搜索只在 games-search 登记一次（两路由共用，防止合计并发翻倍）');
  for (const [key, max] of Object.entries(HEAVY_GATE_CONFIG)) {
    assert.ok(max >= 1 && max <= 2, `${key} 并发上限在 1–2`);
  }
});

test('B1 超时白名单：静态资源/图片代理/APK 下载/CSV 导出/备份豁免，业务 API 不豁免', () => {
  for (const p of ['/assets/index-a1b2.js', '/styles/main.css', '/img/steam/413150.jpg', '/app/dl/steamdeals-2.19.0.apk',
    '/app/steamdeals-2.16.0.apk', '/out/chart/413150.html', '/api/games/413150/history.csv', '/api/admin/reports/price.csv',
    '/api/admin/backup', '/manifest.webmanifest', '/icon-192.png']) {
    assert.equal(isTimeoutExemptPath(p), true, `白名单豁免：${p}`);
  }
  for (const p of ['/api/games', '/api/site', '/api/admin/games', '/api/admin/align', '/api/games/stamp', '/console']) {
    assert.equal(isTimeoutExemptPath(p), false, `业务路径不豁免：${p}`);
  }
});
