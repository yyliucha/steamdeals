// 名称匹配：归一化、bigram 相似度、候选挑选，以及 CE 批（2026-11-16 误匹配事故）加固回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  bigrams,
  diceCoefficient,
  nameVariants,
  similarity,
  scorePair,
  bestMatch,
  confidenceLabel,
  evaluatePair,
  extractNumbers,
  hasContentWord,
  buildCandidateIndex,
  preselectCandidates,
} from '../src/match.js';

test('归一化：去版本词、平台标注与标点', () => {
  assert.equal(normalizeName('全境封锁2 标准版（Steam）'), '全境封锁2');
  assert.equal(normalizeName('Cyberpunk 2077 (Steam)'), 'cyberpunk 2077');
  assert.equal(normalizeName('Some Game - Deluxe Edition'), 'some game');
  assert.equal(normalizeName('ELDEN RING™'), 'elden ring');
  assert.equal(normalizeName('巫师3：狂猎 年度版'), '巫师3 狂猎');
});

test('归一化：CE 新增版本/内容词（重制版/传奇版/季票/服装/合集…）', () => {
  assert.equal(normalizeName('幻世录 重制版'), '幻世录');
  assert.equal(normalizeName('碧蓝幻想Versus：崛起 传奇版'), '碧蓝幻想versus 崛起');
  assert.equal(normalizeName('巴士模拟器 27 - 第1年季票'), '巴士模拟器 27 第1年');
  assert.equal(normalizeName('龙之剑:觉醒 - 服装'), '龙之剑 觉醒');
  assert.equal(normalizeName('星球大战：前线 经典版'), '星球大战 前线');
  assert.equal(normalizeName('Some Game - Season Pass'), 'some game');
});

test('中英混合标题能拆出两种写法', () => {
  const variants = nameVariants("全境封锁2 标准版（Steam） Tom Clancy's The Division 2 - Standard Edition (Steam)");
  assert.ok(variants.includes('全境封锁2'), `缺少中文写法：${variants.join(' | ')}`);
  assert.ok(
    variants.some((v) => v.includes('tom clancy') && v.includes('division 2')),
    `缺少英文写法：${variants.join(' | ')}`,
  );
});

test('bigram 与 Dice：相同为 1，无关为 0', () => {
  assert.deepEqual(bigrams('abc'), ['ab', 'bc']);
  assert.deepEqual(bigrams('a'), ['a']);
  assert.equal(diceCoefficient('cyberpunk 2077', 'cyberpunk 2077'), 1);
  assert.equal(diceCoefficient('cyberpunk 2077', 'stardew valley'), 0);
});

test('相似度：完全一致为 1', () => {
  assert.equal(similarity('赛博朋克 2077', '赛博朋克 2077'), 1);
});

test('相似度：包含关系给部分分（本体 vs 版本名）', () => {
  const score = similarity('愚者不灭', '愚者不灭 荣光痴人版');
  assert.ok(score > 0.4, `本体与版本名应有较高相似度，实际 ${score}`);
});

test('相似度：跨语言得分低（共享数字只带来一点点）', () => {
  const score = scorePair('赛博朋克 2077', 'Cyberpunk 2077');
  // 「20/07/77」这些数字 bigram 会贡献约 0.4，但远低于匹配阈值 0.86
  assert.ok(score < 0.5, `中英直接比较不该接近阈值，实际 ${score}`);
  assert.ok(score < 0.86);
});

test('scorePair：中文对中文、英文对英文都能命中', () => {
  assert.ok(scorePair('赛博朋克 2077', '赛博朋克 2077') > 0.9);
  assert.ok(scorePair('Cyberpunk 2077 (Steam)', 'Cyberpunk 2077') > 0.9);
});

test('bestMatch：在干扰项里挑出正确候选', () => {
  const candidates = [
    { name: '星露谷物语', steam_appid: 1 },
    { name: '空洞骑士', steam_appid: 2 },
    { name: '赛博朋克 2077', steam_appid: 3 },
  ];
  const best = bestMatch('赛博朋克 2077 标准版（Steam）', candidates, { minScore: 0.8 });
  assert.equal(best.candidate.steam_appid, 3);
  assert.ok(best.score >= 0.8);
});

test('bestMatch：都低于阈值时返回 null（宁可不匹配）', () => {
  const candidates = [{ name: '星露谷物语', steam_appid: 1 }];
  assert.equal(bestMatch('赛博朋克 2077', candidates, { minScore: 0.8 }), null);
});

test('bestMatch：支持自定义字段（中英文名并列比较）', () => {
  const candidates = [{ name: '艾尔登法环', nameEn: 'ELDEN RING', steam_appid: 1245620 }];
  const best = bestMatch('ELDEN RING Deluxe Edition', candidates, { minScore: 0.8 });
  assert.equal(best.candidate.steam_appid, 1245620);
  assert.match(best.matchedField, /ELDEN/i);
});

test('置信度标签与阈值一致', () => {
  assert.equal(confidenceLabel(0.98), '自动');
  assert.equal(confidenceLabel(0.94), '自动');
  assert.equal(confidenceLabel(0.9), '待确认');
  assert.equal(confidenceLabel(0.5), '无候选');
});

// ─────────────────────────────────────────────────────────────────────
// CE 批（规格 SONKWO-STEAM-MATCH.md §9）：2026-11-16 误匹配事故回归。
// 守的约束：共享"重制版/代号/星球大战/觉醒/传奇版/TCG/MX"等短通用词的
// 提案一律不再自动、甚至不再进提案；正确样例仍自动。
// ─────────────────────────────────────────────────────────────────────

const REGRESSION_CASES = [
  // [杉果名, 事故中错误匹配到的候选, appid]
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

for (const [sonkwoName, wrongCandidate, appid] of REGRESSION_CASES) {
  test(`误匹配回归：${sonkwoName} ↛ ${wrongCandidate}`, () => {
    // 最强断言：不进提案（bestMatch 为 null，说明连 0.86 阈值都够不到）
    const best = bestMatch(sonkwoName, [{ name: wrongCandidate, steam_appid: appid }], { minScore: 0.86 });
    assert.equal(best, null, `${sonkwoName} 与「${wrongCandidate}」不得再进提案`);
    // 双保险：就算将来阈值变化，也绝不允许自动
    const ev = evaluatePair(sonkwoName, wrongCandidate);
    assert.equal(ev.auto, false, `${sonkwoName} 与「${wrongCandidate}」绝不允许自动`);
    assert.ok(ev.score < 0.86, `提案分应低于 0.86，实际 ${ev.score}`);
  });
}

test('误匹配回归：正确候选仍能在错误候选里胜出（空之轨迹 the 2nd）', () => {
  const best = bestMatch(
    '空之轨迹 the 2nd（豪华版）',
    [
      { name: '空之轨迹 the 1st', steam_appid: 3447040 },
      { name: '空之轨迹 the 2nd', steam_appid: 3447050 },
    ],
    { minScore: 0.86 },
  );
  assert.equal(best.candidate.steam_appid, 3447050, '应选中 the 2nd 而不是 the 1st');
  assert.equal(best.auto, true);
});

test('正确样例仍自动：愚者不灭 / 神盾力量 / 忙作一团 / 血色序曲', () => {
  for (const name of ['愚者不灭', '神盾力量：斯考利安战争', '忙作一团', '血色序曲']) {
    const best = bestMatch(name, [{ name, steam_appid: 1 }], { minScore: 0.86 });
    assert.ok(best, `${name} 应产生提案`);
    assert.equal(best.auto, true, `${name} 完整名一致应自动`);
  }
});

test('正确样例仍自动：内核之心（中文名完整相等）', () => {
  const best = bestMatch('内核之心', [{ name: '内核之心', nameEn: 'Kernel Core', steam_appid: 2 }]);
  assert.ok(best);
  assert.equal(best.auto, true);
  assert.equal(best.matchedField, '内核之心');
});

test('中文↔英文：纯英文名对等仍自动（杉果页英文名 → nameEn）', () => {
  const best = bestMatch('The Thalassa', [{ name: '塔拉萨号', nameEn: 'The Thalassa', steam_appid: 3 }]);
  assert.equal(best.candidate.steam_appid, 3);
  assert.equal(best.auto, true, '英文名完整相等应自动');
  assert.equal(best.matchedField, 'The Thalassa');
});

test('中英混合标题经英文片段仍进提案，但只进人工（完整分不足 0.94）', () => {
  const best = bestMatch('塔拉萨号（Steam）The Thalassa', [{ name: '塔拉萨号', nameEn: 'The Thalassa', steam_appid: 3 }], {
    minScore: 0.86,
  });
  assert.ok(best, '混合标题应通过英文片段进提案');
  assert.equal(best.candidate.steam_appid, 3);
  assert.equal(best.auto, false, '混合标题的完整标题分 <0.94，只能人工确认');
  assert.ok(best.fullScore < 0.94, `完整分应为 ${best.fullScore}（<0.94）`);
});

test('版次剥离：重制版 / 年度版不影响自动判定', () => {
  assert.equal(evaluatePair('幻世录 重制版', '幻世录').auto, true, '重制版剥掉后应等于本体');
  assert.equal(evaluatePair('巫师3：狂猎 年度版', '巫师3 狂猎').auto, true);
  assert.equal(evaluatePair('巴士模拟器 27 - 第1年季票', '巴士模拟器 27 第1年').auto, false, '季票是内容词，只进人工');
});

test('数字/序数/罗马数字一致性：不一致直接判负', () => {
  assert.equal(scorePair('空之轨迹 the 2nd', '空之轨迹 the 1st'), 0, '2nd vs 1st');
  assert.equal(scorePair('巴士模拟器 27 - 第1年季票', '巴士模拟器 21'), 0, '27 vs 21');
  assert.equal(scorePair('文明 VI', '文明 V'), 0, 'VI vs V');
  assert.equal(scorePair('全境封锁 2', '全境封锁'), 0, '一边有数字一边没有也判负');
});

test('数字一致时不误伤：the 2nd 对 the 2nd、VI 对 6', () => {
  assert.equal(evaluatePair('空之轨迹 the 2nd', '空之轨迹 the 2nd').auto, true);
  assert.equal(evaluatePair('文明 VI', '文明 6').numbersOk, true, '罗马 VI 与数字 6 等价');
  assert.equal(evaluatePair('赛博朋克 2077', '赛博朋克 2077').auto, true);
});

test('内容词只进人工审核：分数再高也不自动', () => {
  const pass = evaluatePair('巴士模拟器 27 季票', '巴士模拟器 27');
  assert.equal(pass.score, 1, '剥掉季票后完整归一化相等');
  assert.equal(pass.auto, false, '含季票只能人工');
  assert.ok(pass.reasons.includes('content_word'));
  assert.equal(evaluatePair('赛博朋克 2077 DLC', '赛博朋克 2077').auto, false, 'DLC');
  assert.equal(evaluatePair('无主之地 合集', '无主之地').auto, false, '合集');
  assert.equal(evaluatePair('龙之剑:觉醒 服装', '龙之剑 觉醒').auto, false, '服装');
});

test('片段限制：共享短通用词不再产生 1.00 假高分', () => {
  assert.ok(scorePair('造船师：猎鹰战纪', '堡垒：猎鹰战纪') < 0.86, '共享「猎鹰战纪」');
  assert.ok(scorePair('代号：探戈', '代号：文字生存') < 0.86, '共享「代号」');
  assert.ok(scorePair('MX摩托越野赛', 'MX赛车世界') < 0.86, '共享「MX」');
  assert.ok(scorePair('TCG卡牌店模拟器', 'Epic Cards Battle(TCG)') < 0.86, '共享「TCG」');
});

test('片段加分门：完整分 <0.8 时片段不生效（空格变体，避开副标题分隔符）', () => {
  // 愚者不灭 vs 愚者不灭 荣光痴人版（空格连接，不触发 DG 副标题规则）——
  // 完整分 0.42，共同片段「愚者不灭」「荣光痴人版」都 <6 字，不得把分抬上去。
  const ev = evaluatePair('愚者不灭', '愚者不灭 荣光痴人版');
  assert.equal(ev.score, ev.fullScore, '完整分 <0.8 时片段不得加分');
  assert.ok(ev.score < 0.86, `不应进提案，实际 ${ev.score}`);
});

test('DG 副标题：主标题精确命中 → 0.92 + subtitle 理由，只进人工', () => {
  const ev = evaluatePair('愚者不灭', '愚者不灭：荣光痴人版');
  assert.equal(ev.score, 0.92, '主标题「愚者不灭」精确命中 → 0.92');
  assert.equal(ev.auto, false, '副标题命中只进人工，不自动确认');
  assert.ok(ev.reasons.includes('subtitle'), `reasons 应含 subtitle，实际 ${ev.reasons}`);
});

test('extractNumbers：数字 / 序数 / 罗马数字 / 第X年', () => {
  assert.deepEqual(extractNumbers('the 2nd'), [2]);
  assert.deepEqual(extractNumbers('第1年'), [1]);
  assert.deepEqual(extractNumbers('第二部曲'), [2]);
  assert.deepEqual(extractNumbers('文明 VI'), [6]);
  assert.deepEqual(extractNumbers('文明 V'), [5]);
  assert.deepEqual(extractNumbers('巴士模拟器 27 - 第1年季票'), [1, 27]);
  assert.deepEqual(extractNumbers('MX摩托越野赛'), [], 'MX(1010) 这类罗马缩写不当数字');
  assert.deepEqual(extractNumbers('愚者不灭'), []);
});

test('hasContentWord：内容词命中（只进人工审核的依据）', () => {
  assert.equal(hasContentWord('巴士模拟器 27 - 第1年季票'), true, '季票');
  assert.equal(hasContentWord('龙之剑:觉醒 - 服装'), true, '服装');
  assert.equal(hasContentWord('赛博朋克 2077 DLC'), true, 'DLC');
  assert.equal(hasContentWord('Borderlands: The Handsome Collection'), true, 'Collection');
  assert.equal(hasContentWord('捉鬼敢死队 重制版'), false, '重制版是版本词不是内容词');
  assert.equal(hasContentWord('愚者不灭'), false);
});

// ─────────────────────────────────────────────────────────────────────
// DG 批（docs/TODO.md DG 条目）：副标题感知 + 候选索引补 name_en。
// 守的约束：断箭组（主标题 + 副标题）显示 0.90–0.93 候选并标「副标题」理由、
// 不自动确认；版次剥离后相等的标题仍 1.0 自动；季票等内容词仍只进人工；
// 蛇形 name_en 进候选索引（server.js 直接喂 DB 行的路径）。
// ─────────────────────────────────────────────────────────────────────

test('DG：断箭组——中文副标题主标题精确命中，0.92 + subtitle + 不自动', () => {
  // 线上取证：孤儿行「断箭: 俄罗斯国民近卫军」候选「断箭」（appid 1604270）此前 <0.86 被丢
  const candidates = [{ name: '断箭', steam_appid: 1604270 }];
  const best = bestMatch('断箭: 俄罗斯国民近卫军', candidates);
  assert.ok(best, '断箭组应显示候选');
  assert.equal(best.candidate.steam_appid, 1604270);
  assert.ok(best.score >= 0.90 && best.score <= 0.93, `副标题命中分数应在 0.90–0.93，实际 ${best.score}`);
  assert.ok(best.reasons.includes('subtitle'), `应标「副标题」理由，实际 ${best.reasons}`);
  assert.equal(best.auto, false, '副标题命中不自动确认（落需人工区）');
});

test('DG：英文副标题——Broken Arrow: Russian Guard 命中 Broken Arrow', () => {
  const best = bestMatch('Broken Arrow: Russian Guard', [{ name: '断箭', nameEn: 'Broken Arrow', steam_appid: 1604270 }]);
  assert.ok(best, '英文副标题主标题命中应有候选');
  assert.equal(best.candidate.steam_appid, 1604270);
  assert.ok(best.score >= 0.90 && best.score <= 0.93, `实际 ${best.score}`);
  assert.ok(best.reasons.includes('subtitle'));
  assert.equal(best.auto, false);
});

test('DG：全角冒号与破折号切分同样生效（纯中文命中）', () => {
  const ev1 = evaluatePair('断箭：俄罗斯国民近卫军', '断箭');
  assert.equal(ev1.score, 0.92, '全角冒号切分');
  assert.ok(ev1.reasons.includes('subtitle'));
  const ev2 = evaluatePair('断箭 - 俄罗斯国民近卫军', '断箭');
  assert.equal(ev2.score, 0.92, '连字符切分');
  assert.ok(ev2.reasons.includes('subtitle'));
  const ev3 = evaluatePair('断箭 — 俄罗斯国民近卫军', '断箭');
  assert.equal(ev3.score, 0.92, '破折号切分');
});

test('DG：带版本词的副标题仍命中（版本词剥掉后副标题仍有信息量）', () => {
  const ev = evaluatePair('断箭：俄罗斯国民近卫军 豪华版', '断箭');
  assert.equal(ev.score, 0.92);
  assert.ok(ev.reasons.includes('subtitle'));
  assert.equal(ev.auto, false);
});

test('DG：版次剥离后相等的标题仍 1.0 自动（副标题规则不回退 CE 口径）', () => {
  const ev = evaluatePair('消逝的光芒：困兽 决定版', '消逝的光芒：困兽');
  assert.equal(ev.score, 1, '决定版剥掉后完整归一化相等');
  assert.equal(ev.auto, true, '版次相等仍自动');
  assert.ok(!ev.reasons.includes('subtitle'), '完整相等时不标副标题理由');
});

test('DG：内容词副标题不触发副标题规则，仍提示内容词且不自动', () => {
  // 副标题「季票」剥掉后无信息量 → 走正常规则：完整相等 + 内容词 → 分数 1.0、只进人工
  const ev = evaluatePair('巴士模拟器 27 - 季票', '巴士模拟器 27');
  assert.equal(ev.score, 1);
  assert.equal(ev.auto, false, '季票是内容词，只进人工');
  assert.ok(ev.reasons.includes('content_word'), '仍提示内容词');
  assert.ok(!ev.reasons.includes('subtitle'), '纯内容词副标题不算副标题命中');
});

test('DG：共享前缀误匹配不触发副标题规则（CE 护栏）', () => {
  // 双方都有副标题、主标题只是共享前缀（星球大战 绝地 vs 星球大战）时不得给 0.90+
  const ev = evaluatePair('星球大战：前线 经典版', '星球大战 绝地：陨落的武士团');
  assert.ok(ev.score < 0.86, `共享前缀不得抬进提案区，实际 ${ev.score}`);
  assert.ok(!ev.reasons.includes('subtitle'));
});

test('DG：候选索引补 name_en——蛇形字段进索引，英文名 token 可召回', () => {
  const index = buildCandidateIndex([
    { name: '断箭', name_en: 'Broken Arrow', steam_appid: 1604270 },
  ]);
  // 英文副标题走英文 token 召回（旧默认只读 nameEn 驼峰，此用例会召回失败）
  const pre = preselectCandidates(['Broken Arrow: Russian Guard'], index, { maxCandidates: 2000 });
  assert.ok(pre.length >= 1, 'name_en 应进索引并召回候选');
  assert.equal(pre[0].steam_appid, 1604270);
  // 中文名路径不受影响
  const preZh = preselectCandidates(['断箭：俄罗斯国民近卫军'], index, { maxCandidates: 2000 });
  assert.equal(preZh[0].steam_appid, 1604270);
});
