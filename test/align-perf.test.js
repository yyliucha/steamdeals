// CN 批（docs/ALIGN-QUERY-PERF.md §4）：对齐审核查询性能修复的回归锁。
// 守的约束：① 缓存 + single-flight（并发只算一次）；② 候选预筛不改匹配口径
// （CE 13 条误匹配仍不进提案、正确样例仍命中）；③ 20s 预算返回 partial 不 5xx；
// ④ 匹配循环分片（yield 被调用）。全部纯逻辑/纯函数，无网络、无 pglite。
// 反向自检：① 删 align-query.js 的「computing 复用」分支 → single-flight 用例红；
//           ② 删 match.js preselectCandidates 的快路径 → 「快路径只含精确候选」用例红；
//           ③ 删 proposeAlignGroupsBudgeted 的预算检查 → partial 用例红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlignRunner, parseAlignPage } from '../src/align-query.js';
import { buildCandidateIndex, preselectCandidates, bestMatch, evaluatePair } from '../src/match.js';
import { proposeAlignGroupsBudgeted, loadSonkwoItems } from '../src/align.js';

// ── 一、缓存 + single-flight（align-query.js）──────────────────────────

test('CN：runner 首次计算、缓存命中、refresh 强制重算、invalidate 失效', async () => {
  let computes = 0;
  const runner = createAlignRunner({
    compute: async () => {
      computes += 1;
      return { n: computes, generatedAt: Date.now() };
    },
    ttlMs: 60_000,
  });
  const r1 = await runner.run();
  assert.equal(r1.n, 1);
  const r2 = await runner.run(); // TTL 内 → 命中缓存
  assert.equal(r2.n, 1, '第二次读缓存，不重算');
  assert.equal(computes, 1);
  assert.equal(runner.getState().fromCache, true);

  const r3 = await runner.run({ refresh: true });
  assert.equal(r3.n, 2, 'refresh 强制重算');
  assert.equal(computes, 2);
  assert.equal(runner.getState().fromCache, false);

  runner.invalidate();
  const r4 = await runner.run();
  assert.equal(r4.n, 3, 'invalidate 后重算');
});

test('CN：single-flight——并发 5 个请求只算 1 次', async () => {
  let computes = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const runner = createAlignRunner({
    compute: async () => {
      computes += 1;
      await gate; // 让计算挂住，逼出并发窗口
      return { n: computes };
    },
    ttlMs: 60_000,
  });
  // 同时发起 5 个 run（都挂在 gate 上），放行后统一收结果——并发窗口内只允许一次 compute
  const pending = [runner.run(), runner.run(), runner.run(), runner.run(), runner.run()];
  release();
  const settled = await Promise.all(pending);
  assert.equal(computes, 1, '并发请求共享同一个计算 Promise');
  assert.ok(settled.every((r) => r.n === 1));
});

test('CN：ttlMs=0 时每次都重算（可测性锚点）', async () => {
  let computes = 0;
  const runner = createAlignRunner({ compute: async () => ({ n: ++computes }), ttlMs: 0 });
  await runner.run();
  await runner.run();
  assert.equal(computes, 2);
});

test('CN：分页参数解析——非法/越界回落（page≥1；1≤pageSize≤50）', () => {
  const q = (s) => new URL(`http://x/?${s}`).searchParams;
  assert.deepEqual(parseAlignPage(q('')), { page: 1, pageSize: 20 }, '缺省回落');
  assert.deepEqual(parseAlignPage(q('page=3&pageSize=10')), { page: 3, pageSize: 10 });
  assert.deepEqual(parseAlignPage(q('page=abc&pageSize=xyz')), { page: 1, pageSize: 20 }, '非数字回落');
  assert.deepEqual(parseAlignPage(q('page=0&pageSize=0')), { page: 1, pageSize: 20 }, '0 回落');
  assert.deepEqual(parseAlignPage(q('page=-5&pageSize=999')), { page: 1, pageSize: 50 }, '越界钳制');
  assert.deepEqual(parseAlignPage(q('page=2.9&pageSize=2.9')), { page: 2, pageSize: 2 }, '小数截断与 parseInt 同语义');
});

// ── 四、后台生成（CS 批，docs/ALIGN-DB-SLOW.md §2 #3）──────────────────

test('CS：background 冷缓存触发计算但立即返回 generating，完成后缓存就绪', async () => {
  let computes = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const runner = createAlignRunner({
    compute: async () => {
      computes += 1;
      await gate;
      return { n: computes, generatedAt: Date.now() };
    },
    ttlMs: 60_000,
  });
  const s1 = runner.background(); // 冷缓存：触发计算、不等待
  assert.equal(s1.generating, true);
  assert.equal(runner.getState().computing, true, '后台计算已启动');
  assert.equal(computes, 1);

  const s2 = runner.background(); // 计算中：共享，不叠加
  assert.equal(s2.generating, true);
  assert.equal(computes, 1, '连续触发只算 1 次（single-flight）');

  release();
  await runner.run(); // 等待完成后缓存就绪
  assert.equal(runner.getState().cached, true);
  const s3 = runner.background();
  assert.equal(s3.ready, true, '缓存就绪后 background 返回 ready');
});

test('CS：compute 进度经 onProgress 上报（processed/total）', async () => {
  let captured = null;
  const runner = createAlignRunner({
    compute: async ({ onProgress }) => {
      onProgress(40, 100);
      onProgress(100, 100);
      return { generatedAt: Date.now() };
    },
    ttlMs: 60_000,
  });
  runner.background();
  await runner.run();
  // 计算完成后进度清空；期间通过 getState 观测（此处断言回调链路在测试内被调用过）
  assert.ok(true, 'onProgress 回调已由 compute 调用（captured 验证见下）');
  const runner2 = createAlignRunner({
    compute: async ({ onProgress }) => {
      onProgress(40, 100);
      await new Promise((r) => setImmediate(r));
      onProgress(100, 100);
      captured = runner2.getState();
      return { generatedAt: Date.now() };
    },
    ttlMs: 60_000,
  });
  runner2.background();
  await runner2.run();
  assert.equal(captured.computing, true, '计算期间 getState 可见 computing');
  assert.deepEqual(
    { processed: captured.processed, total: captured.total },
    { processed: 100, total: 100 },
    '进度经 onProgress 上报',
  );
});

test('CS：refresh 后台重算（缓存过期强制重算，ready 前 generating）', async () => {
  let computes = 0;
  const runner = createAlignRunner({
    compute: async () => ({ n: ++computes, generatedAt: Date.now() }),
    ttlMs: 60_000,
  });
  await runner.run();
  assert.equal(computes, 1);
  const s = runner.background({ refresh: true });
  assert.equal(s.generating, true, 'refresh 强制重算');
  await runner.run();
  assert.equal(computes, 2);
});

// ── 二、候选预筛不改口径（match.js + CE 回归数据）─────────────────────

const REGRESSION_CASES = [
  // [杉果名, 事故中错误匹配到的候选, appid]（与 test/match.test.js CE 批同源）
  ['幻世录 重制版', '地铁2033 重制版', 286690],
  ['捉鬼敢死队 重制版', '地铁2033 重制版', 286690],
  ['代号：探戈', '代号：文字生存', 2416990],
  ['星球大战：前线 经典版', '星球大战 绝地：陨落的武士团', 1172380],
  ['星球大战：银河赛车手（豪华版）', '绝地：陨落的武士团', 1172380],
  ['碧蓝幻想Versus：崛起 传奇版', '质量效应 传奇版', 1328670],
  ['龙之剑:觉醒 - 服装', '沙丘：觉醒', 1172710],
  ['空之轨迹 the 2nd（豪华版）', '空之轨迹 the 1st', 3447040],
  ['MX摩托越野赛', 'MX赛车世界', 3975740],
  ['巴士模拟器 27 - 第1年季票', '巴士模拟器 21', 976590],
  ['TCG卡牌店模拟器', 'Epic Cards Battle(TCG)', 381560],
  ['造船师：猎鹰战纪', '堡垒：猎鹰战纪', 290100],
  ['求救信号：生存岛', '生存岛', 1817670],
];

test('CN：候选预筛后 CE 13 条误匹配仍不进提案（口径不变）', () => {
  // 守的约束：预筛是收敛候选集，不是放宽匹配——误匹配对要么不进候选集，
  // 要么进候选集后 evaluatePair 仍把它拒在 0.86 阈值外，且永不自动。
  for (const [sonkwoName, wrongCandidate, appid] of REGRESSION_CASES) {
    const index = buildCandidateIndex([{ name: wrongCandidate, steam_appid: appid }]);
    const pre = preselectCandidates([sonkwoName], index, { maxCandidates: 2000 });
    if (pre.length === 0) {
      assert.ok(true, `${sonkwoName} 预筛后无候选（不进提案）`);
      continue;
    }
    const best = bestMatch(sonkwoName, pre, { minScore: 0.86 });
    assert.equal(best, null, `${sonkwoName} 与「${wrongCandidate}」预筛后仍不得进提案`);
    const ev = evaluatePair(sonkwoName, wrongCandidate);
    assert.equal(ev.auto, false, `${sonkwoName} 与「${wrongCandidate}」绝不允许自动`);
  }
});

test('CN：候选预筛后正确样例仍命中且自动（口径不变）', () => {
  const cases = [
    ['愚者不灭', { name: '愚者不灭', steam_appid: 1 }],
    ['神盾力量：斯考利安战争', { name: '神盾力量：斯考利安战争', steam_appid: 2 }],
    ['忙作一团', { name: '忙作一团', steam_appid: 3 }],
    ['血色序曲', { name: '血色序曲', steam_appid: 4 }],
    ['内核之心', { name: '内核之心', nameEn: 'Kernel Core', steam_appid: 5 }],
    ['The Thalassa', { name: '塔拉萨号', nameEn: 'The Thalassa', steam_appid: 6 }],
  ];
  for (const [sonkwoName, candidate] of cases) {
    const index = buildCandidateIndex([candidate]);
    const pre = preselectCandidates([sonkwoName], index, { maxCandidates: 2000 });
    const best = bestMatch(sonkwoName, pre, { minScore: 0.86 });
    assert.ok(best, `${sonkwoName} 预筛后应仍有候选`);
    assert.equal(best.auto, true, `${sonkwoName} 应仍自动`);
    assert.equal(best.candidate.steam_appid, candidate.steam_appid);
  }
});

test('CN：空之轨迹 the 2nd 经预筛仍在错误候选里胜出（数字校验保留）', () => {
  const index = buildCandidateIndex([
    { name: '空之轨迹 the 1st', steam_appid: 3447040 },
    { name: '空之轨迹 the 2nd', steam_appid: 3447050 },
  ]);
  const pre = preselectCandidates(['空之轨迹 the 2nd（豪华版）'], index, { maxCandidates: 2000 });
  const best = bestMatch('空之轨迹 the 2nd（豪华版）', pre, { minScore: 0.86 });
  assert.equal(best.candidate.steam_appid, 3447050, '应选中 the 2nd 而不是 the 1st');
  assert.equal(best.auto, true);
});

test('CN：快路径——归一化全等时预筛只含精确候选', () => {
  const others = [];
  for (let i = 0; i < 100; i += 1) others.push({ name: `无关游戏 ${i}`, steam_appid: 1000 + i });
  const target = { name: '幻境旅者', steam_appid: 9999 };
  const index = buildCandidateIndex([...others, target]);
  const pre = preselectCandidates(['幻境旅者'], index, { maxCandidates: 2000 });
  assert.equal(pre.length, 1, '快路径只返回归一化全等的候选');
  assert.equal(pre[0].steam_appid, 9999);
});

test('CN：慢路径——token 召回共享数降序且截断 ≤2000', () => {
  const candidates = [];
  for (let i = 0; i < 3000; i += 1) {
    candidates.push({ name: `沙盒探索者 ${i}`, name_en: `Sandbox Explorer ${i}`, steam_appid: i });
  }
  const index = buildCandidateIndex(candidates);
  // 标题带「特典」→ 归一化名不与任何候选全等，走 token 召回慢路径
  const pre = preselectCandidates(['沙盒探索者 2099 特典'], index, { maxCandidates: 2000 });
  assert.ok(pre.length > 1 && pre.length <= 2000, `token 召回并截断到 ≤2000，实际 ${pre.length}`);
  const best = bestMatch('沙盒探索者 2099 特典', pre, { minScore: 0.86 });
  assert.equal(best.candidate.steam_appid, 2099, '共享 token 最多的精确候选排在前面、未被截掉');
});

// ── 三、预算 partial 与分片（align.js budgeted 版本）──────────────────

function mkItems(names) {
  return names.map((name, i) => ({
    skuId: 1000 + i,
    name,
    titles: [name],
  }));
}

const STEAM_GAMES = [
  { name: '愚者不灭', steam_appid: 1 },
  { name: '神盾力量：斯考利安战争', steam_appid: 2 },
  { name: '忙作一团', steam_appid: 3 },
  { name: '血色序曲', steam_appid: 4 },
  { name: '无关游戏甲', steam_appid: 5 },
  { name: '无关游戏乙', steam_appid: 6 },
];

test('CN：预算耗尽返回 partial=true 与已算部分（不抛错、不 5xx）', async () => {
  const items = mkItems(['愚者不灭', '神盾力量：斯考利安战争', '忙作一团', '血色序曲', '无关候选丙']);
  // startedAt 倒填 + budgetMs=1 → 第一组前即超时
  const { groups, partial } = await proposeAlignGroupsBudgeted(items, STEAM_GAMES, {
    startedAt: Date.now() - 1000,
    budgetMs: 1,
  });
  assert.equal(partial, true);
  assert.equal(groups.length, 0, '超时即停，返回已算部分（这里为 0 组）');
});

test('CN：预算充足时全量完成 partial=false，顺序仍分数降序', async () => {
  const items = mkItems(['无关候选丙', '愚者不灭', '忙作一团']);
  const { groups, partial } = await proposeAlignGroupsBudgeted(items, STEAM_GAMES, {
    budgetMs: 60_000,
  });
  assert.equal(partial, false);
  assert.equal(groups.length, 3);
  const scores = groups.map((g) => g.best?.score ?? -1);
  const sorted = [...scores].sort((a, b) => b - a);
  assert.deepEqual(scores, sorted, '队列仍按分数降序稳定排序');
});

test('CN：分片——每 yieldEvery 组调用一次 shouldYield', async () => {
  // 45 个互不相同的名字 → 45 个去重组（同名会合并，必须错开）
  const names = [];
  for (let i = 0; i < 45; i += 1) names.push(`无关游戏 ${i}`);
  const items = mkItems(names);
  let yields = 0;
  const { partial } = await proposeAlignGroupsBudgeted(items, STEAM_GAMES, {
    budgetMs: 60_000,
    yieldEvery: 10,
    shouldYield: async () => { yields += 1; },
  });
  assert.equal(partial, false);
  assert.equal(yields, 4, '45 组 / 每 10 组 yield 一次 = 4 次（第 10/20/30/40 组后）');
});

test('CN：组去重与 skuIds 保持（预筛路径不改变组结构）', async () => {
  const items = [
    { skuId: 1, name: '愚者不灭', titles: ['愚者不灭'] },
    { skuId: 2, name: '愚者不灭 豪华版', titles: ['愚者不灭 豪华版'] },
    { skuId: 3, name: '忙作一团', titles: ['忙作一团'] },
  ];
  // 同归一化名（豪华版被剥）的两条 SKU 合并为一组
  const { groups } = await proposeAlignGroupsBudgeted(items, STEAM_GAMES, { budgetMs: 60_000 });
  assert.equal(groups.length, 2);
  const anno = groups.find((g) => g.skuIds.length === 2);
  assert.ok(anno, '愚者不灭/豪华版同组（skuIds=2）');
});
