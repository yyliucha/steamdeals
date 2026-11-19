// CN 批（docs/ALIGN-QUERY-PERF.md §4）：对齐审核查询性能修复的回归锁。
// 守的约束：① 候选预筛不改匹配口径（CE 13 条误匹配仍不进提案、正确样例仍命中）；
// ② 20s 预算返回 partial 不 5xx；③ 匹配循环分片（yield 被调用）。
// DE 批（docs/ALIGN-REVIEW-UI.md §3/§4）：④ 分组完成立即上报总数（进度不出现 0/0）；
// ⑤ top-N 候选（明细面板）与 counts 统计口径、ignoredGroups 计数。
// DL 批（docs/ALIGN-SNAPSHOT.md §5）：内存缓存运行器（createAlignRunner 的 TTL/single-flight/
// staleCache/invalidate）已废弃删除——缓存相关回归锁移入 test/align-snapshot.test.js（签名/落库/24h/prune）。
// 反向自检：① 删 match.js preselectCandidates 的快路径 → 「快路径只含精确候选」用例红；
//           ② 删 proposeAlignGroupsBudgeted 的预算检查 → partial 用例红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAlignPage } from '../src/align-query.js';
import { buildCandidateIndex, preselectCandidates, bestMatch, bestMatchMulti, evaluatePair } from '../src/match.js';
import { proposeAlignGroupsBudgeted, alignGroupCounts, applyMapInheritance } from '../src/align.js';

test('CN：分页参数解析——非法/越界回落（page≥1；1≤pageSize≤50）', () => {
  const q = (s) => new URL(`http://x/?${s}`).searchParams;
  assert.deepEqual(parseAlignPage(q('')), { page: 1, pageSize: 20 }, '缺省回落');
  assert.deepEqual(parseAlignPage(q('page=3&pageSize=10')), { page: 3, pageSize: 10 });
  assert.deepEqual(parseAlignPage(q('page=abc&pageSize=xyz')), { page: 1, pageSize: 20 }, '非数字回落');
  assert.deepEqual(parseAlignPage(q('page=0&pageSize=0')), { page: 1, pageSize: 20 }, '0 回落');
  assert.deepEqual(parseAlignPage(q('page=-5&pageSize=999')), { page: 1, pageSize: 50 }, '越界钳制');
  assert.deepEqual(parseAlignPage(q('page=2.9&pageSize=2.9')), { page: 2, pageSize: 2 }, '小数截断与 parseInt 同语义');
});

// ── 候选预筛不改口径（match.js + CE 回归数据）─────────────────────

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

// ── 预算 partial 与分片（align.js budgeted 版本）──────────────────

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

// ── DE 批（docs/ALIGN-REVIEW-UI.md）：分组即报总数 / top-N 明细 / counts ──

test('DE：分组完成立即上报总数——onGrouped 先于匹配循环，进度 total 不出现 0/0', async () => {
  const names = [];
  for (let i = 0; i < 30; i += 1) names.push(`无关游戏 ${i}`);
  const items = mkItems(names);
  const seen = [];
  await proposeAlignGroupsBudgeted(items, STEAM_GAMES, {
    budgetMs: 60_000,
    yieldEvery: 10,
    onGrouped: (total) => seen.push(['grouped', total]),
    shouldYield: async (processed, totalGroups) => seen.push(['yield', processed, totalGroups]),
  });
  assert.deepEqual(seen[0], ['grouped', 30], '分组完成即回调总数 30（在第一次 yield 之前）');
  assert.ok(seen.slice(1).every((e) => e[0] === 'yield'), '之后才是匹配进度');
});

test('DE：topCandidates——top-1 与 bestMatchMulti 同口径、按分数降序、低于阈值候选也在明细里', async () => {
  const games = [
    { id: 1, steam_appid: 111, name: '塔拉萨号', name_en: 'The Thalassa' },
    { id: 2, steam_appid: 222, name: '塔拉萨号 豪华版', name_en: 'The Thalassa Deluxe' },
    { id: 3, steam_appid: 333, name: '无关游戏甲', name_en: null },
  ];
  const items = mkItems(['塔拉萨号']);
  const { groups } = await proposeAlignGroupsBudgeted(items, games, { budgetMs: 60_000, topN: 5 });
  const g = groups[0];
  assert.ok(g.topCandidates.length >= 2, '明细面板有多个候选');
  const scores = g.topCandidates.map((t) => t.score);
  const sorted = [...scores].sort((a, b) => b - a);
  assert.deepEqual(scores, sorted, 'topCandidates 按分数降序');
  const viaMulti = bestMatchMulti(['塔拉萨号'], games, { minScore: 0.86, getFields: (c) => [c.name, c.name_en ?? c.nameEn] });
  assert.equal(g.best?.candidate?.steam_appid, viaMulti?.candidate?.steam_appid, 'top-1 与 bestMatchMulti 同口径');
  assert.equal(g.best?.score, viaMulti?.score);
  assert.equal(g.topCandidates[0].score, g.best.score, 'best 即 topCandidates[0]');

  // 低于 0.86 的候选：best=null（不进提案），但 topCandidates 仍列出（明细可见低分候选）
  const lowItems = mkItems(['代号：探戈']);
  const lowGames = [{ id: 9, steam_appid: 999, name: '代号：文字生存', name_en: null }];
  const low = (await proposeAlignGroupsBudgeted(lowItems, lowGames, { budgetMs: 60_000, topN: 5 })).groups[0];
  assert.equal(low.best, null, '低于阈值不进提案');
  assert.ok(low.topCandidates.length >= 1 && low.topCandidates[0].score < 0.86, '低分候选进 topCandidates（明细面板）');
});

test('DE：alignGroupCounts——auto≥0.94 / manual 0.86–0.94 / noCandidate / skus / inherited / ignored / contentWords（DN 批）', () => {
  const groups = [
    { skuIds: [1, 2], best: { score: 0.97 } },
    { skuIds: [3], best: { score: 0.90 } },
    { skuIds: [4], best: null },
  ];
  const counts = alignGroupCounts(groups, { inheritApplied: 68, ignoredGroups: 2 }, { groups: 1, skus: 2 });
  assert.deepEqual(counts, {
    groups: 3,
    skus: 4,
    auto: 1,
    manual: 1,
    noCandidate: 1,
    inherited: 68,
    ignored: 2,
    contentWords: 1,
    contentWordSkus: 2,
  }, '5 统计卡与「已忽略」chip 的计数口径（含内容词归档计数）');
});

test('DE：applyMapInheritance 返回 ignoredGroups（按去重组计数）', () => {
  const items = [
    { skuId: 1, name: '断箭', titles: ['断箭'] },
    { skuId: 2, name: '断箭', titles: ['断箭'] },
    { skuId: 3, name: '愚者不灭', titles: ['愚者不灭'] },
  ];
  const maps = new Map([
    ['1', { decision: 'ignored' }],
    ['2', { decision: 'ignored' }],
    ['3', { decision: 'ignored' }],
  ]);
  const { items: rest, inheritApplied, ignoredGroups } = applyMapInheritance(items, maps);
  assert.equal(rest.length, 0);
  assert.equal(inheritApplied, 0);
  assert.equal(ignoredGroups, 2, '两条同名 SKU 只算 1 个已忽略组');
});
