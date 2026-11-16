// 跨平台名称匹配（CE 批加固，2026-11-16）。
//
// 场景：杉果商品页没有 Steam appid，只能靠名称对齐。中文名、英文名、版本后缀
// （标准版/豪华版/Deluxe/Ultimate…）、括号里的平台标注都会干扰比较，所以先归一化
// 再算相似度。
//
// 相似度用「字符 bigram 的 Dice 系数」而不是编辑距离：中文没有词边界，bigram 对
// 中文和英文都稳，且对"多几个字"比编辑距离宽容。
//
// ⚠️ 2026-11-16 事故后的加固规则（规格 SONKWO-STEAM-MATCH.md §9）：
//  1. 只对「完整归一化标题」计分；片段（中/英文片段）只允许在完整标题分数 ≥0.8 时
//     参与加分，且片段长度 ≥6、非通用词——共享"重制版/代号/星球大战/觉醒/TCG/MX"
//     这类短通用词不再产生 1.00 假高分；
//  2. 数字/序数/罗马数字一致性校验（the 2nd vs the 1st、27 vs 21、II vs I），
//     两边数字集合不一致直接判负（score=0）；
//  3. 内容词（DLC/季票/通行证/服装/皮肤/故事包/扩展包/升级包/合集/三部曲…）命中
//     只进人工审核，绝不自动映射；
//  4. 自动条件收紧为：完整归一化相等，或（完整 Dice ≥0.94 且无内容词 且数字一致
//     且完整标题长度 ≥4）。
//
// 注意：这里只负责打分与自动判定，**不做落库决定**——阈值由调用方定，最终由人确认。

const EDITION_WORDS = [
  /标准版|普通版|豪华版|黄金版|年度版|完整版|决定版|终极版|数字豪华版|重制版|传奇版|经典版|增强版|重装上阵版|季票版|合集版/g,
  /季票|通行证|服装|皮肤|故事包|扩展包|升级包|合集|捆绑包|三部曲|[二三四五六七八九十百]部曲/g,
  /\b(standard|deluxe|ultimate|complete|definitive|gold|enhanced|special|premium|collector'?s?|legendary|classic)\s+edition\b/gi,
  /\bgame\s+of\s+the\s+year(\s+edition)?\b/gi,
  /\bgoty(\s+edition)?\b/gi,
  /\bremastered\b/gi,
  /\breloaded\b/gi,
  /\bseason\s*pass\b/gi,
  /\bbattle\s*pass\b/gi,
  /\bexpansion\s*pass\b/gi,
  /\bdlc\b/gi,
  /\b(expansion|upgrade|collection|bundle|trilogy|story\s*pack)\b/gi,
  /\b(costumes?|skins?)\b/gi,
];

/** 内容词：命中即「只进人工审核」，绝不自动映射（检查原始标题，不依赖归一化）。 */
const CONTENT_WORDS = [
  /\bdlc\b/i,
  /季票/,
  /通行证/,
  /服装/,
  /皮肤/,
  /故事包|剧情包/,
  /扩展包|资料片/,
  /升级包/,
  /合集|捆绑包/,
  /三部曲/,
  /[二三四五六七八九十百]部曲/,
  /\bseason\s*pass\b/i,
  /\bbattle\s*pass\b/i,
  /\bexpansion\s*pass\b/i,
  /\bexpansion\b/i,
  /\bupgrade\b/i,
  /\bcostumes?\b/i,
  /\bskins?\b/i,
  /\bstory\s*pack\b/i,
  /\bcollection\b/i,
  /\bbundle\b/i,
  /\btrilogy\b/i,
  /\bpass\b/i,
];

/** 片段通用词黑名单（长度 ≥6 是主门，这里是防长通用词的双保险）。 */
const GENERIC_FRAGMENTS =
  /^(重制版|重制|代号|星球大战|觉醒|传奇版|经典版|增强版|重装上阵|豪华版|标准版|普通版|黄金版|年度版|完整版|决定版|终极版|季票|通行证|服装|皮肤|故事包|扩展包|升级包|合集|捆绑包|三部曲|remastered|reloaded|standard|deluxe|ultimate|complete|definitive|gold|enhanced|special|premium|legendary|classic|edition|goty|season|pass|battle|expansion|upgrade|collection|bundle|trilogy|dlc|costume|skin|story|pack|game|simulator|模拟器|游戏|the)$/i;

/** 归一化：去版本/内容词、平台标注与标点。 */
export function normalizeName(raw) {
  // ™®© 必须先去掉：NFKC 会把 ™ 展开成 "TM"，让 "ELDEN RING™" 变成 "elden ringtm"
  let s = String(raw ?? '').replace(/[™®©]/g, ' ');
  s = s.normalize('NFKC').toLowerCase();
  s = s.replace(/[（(\[]\s*steam\s*[）)\]]/gi, ' ');
  for (const re of EDITION_WORDS) s = s.replace(re, ' ');
  s = s.replace(/[（(][^）)]*[）)]/g, ' ');
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return s.replace(/\s+/g, ' ');
}

/** 原始标题是否含内容词（DLC/季票/通行证/服装/皮肤/故事包/扩展包/升级包/合集/三部曲…）。 */
export function hasContentWord(raw) {
  return CONTENT_WORDS.some((re) => re.test(String(raw ?? '')));
}

const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS = { 十: 10, 百: 100, 千: 1000 };

/** 中文数词（≤ 千）转整数：二十一 → 21、一百二十 → 120。 */
function cnNumberToInt(s) {
  let total = 0;
  let section = 0;
  let num = 0;
  for (const ch of s) {
    if (CN_UNITS[ch]) {
      num = num || 1;
      section += num * CN_UNITS[ch];
      num = 0;
    } else if (CN_DIGIT[ch] !== undefined) {
      num = CN_DIGIT[ch];
    } else {
      return NaN;
    }
  }
  return total + section + num;
}

const ROMAN_VALUE = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

/**
 * 罗马数字 token 转整数；只接受单字母 I/V/X 或 ≤100 的合法组合——
 * 上限 100 是为了挡住 "MX"(1010)/"DMC"(600)/"DC"(400) 这类碰巧全由罗马字母
 * 组成的缩写，游戏标题里的罗马数字（II/IV/V/VI/XIV…）不会超过 100。
 */
function romanToInt(token) {
  const s = String(token).toUpperCase();
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  if (s.length === 1 && !/[IVX]/.test(s)) return null;
  let total = 0;
  let prev = 0;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    const v = ROMAN_VALUE[s[i].toLowerCase()];
    total += v < prev ? -v : v;
    prev = v;
  }
  return total > 0 && total <= 100 ? total : null;
}

/**
 * 提取标题里的数字/序数/罗马数字（含 the 2nd / 2 / II / 第1年），返回升序去重数组。
 * 只看原始标题（归一化会剥掉版本词，但版本词里的数字也要参与一致性校验）。
 */
export function extractNumbers(raw) {
  const s = String(raw ?? '').replace(/[０-９]/g, (d) => String('０１２３４５６７８９'.indexOf(d)));
  const out = new Set();
  for (const m of s.matchAll(/\d+(?:st|nd|rd|th)?/gi)) {
    const n = Number.parseInt(m[0], 10);
    if (Number.isFinite(n)) out.add(n);
  }
  for (const m of s.matchAll(/(?:^|[^\p{L}\p{N}])([IVXLCDM]+)(?=$|[^\p{L}\p{N}])/giu)) {
    const v = romanToInt(m[1]);
    if (v != null) out.add(v);
  }
  for (const m of s.matchAll(/第\s*([0-9]+|[一二三四五六七八九十百千]+)/g)) {
    const t = m[1];
    const v = /^[0-9]+$/.test(t) ? Number(t) : cnNumberToInt(t);
    if (Number.isFinite(v)) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

const sameNumbers = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** 两边数字集合不一致 → true（不一致直接判负）。 */
export function numbersConflict(rawA, rawB) {
  return !sameNumbers(extractNumbers(rawA), extractNumbers(rawB));
}

/** 字符 bigram 集合（单字时退化为该字本身）。 */
export function bigrams(text) {
  const chars = [...String(text ?? '').replace(/\s+/g, '')];
  if (chars.length <= 1) return chars.length ? [chars[0]] : [];
  const out = [];
  for (let i = 0; i < chars.length - 1; i += 1) out.push(chars[i] + chars[i + 1]);
  return out;
}

/** Dice 系数：2|A∩B| / (|A|+|B|)，对顺序和长度差异比编辑距离宽容。 */
export function diceCoefficient(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const countA = new Map();
  for (const g of A) countA.set(g, (countA.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of B) {
    const n = countA.get(g) ?? 0;
    if (n > 0) {
      overlap += 1;
      countA.set(g, n - 1);
    }
  }
  return (2 * overlap) / (A.length + B.length);
}

/**
 * 拆出标题的多个候选写法：
 *   杉果标题常是「中文名 版本（Steam） English Name - Edition (Steam)」，
 *   中英两部分要分别和候选的 name / name_en 比较。
 *
 * 注意：中文片段必须保留数字——「全境封锁2」的 2 是标题的一部分，
 * 早期实现按"删除所有 ASCII"来取中文，把 2 也删了，导致匹配退化。
 */
export function nameVariants(raw) {
  const text = String(raw ?? '');
  // 中文片段必须以汉字开头，否则「Cyberpunk 2077」里的 2077 会被当成中文变体，
  // 反而和中文标题里的数字产生 0.6 的假高分。
  const cjkRuns = text.match(/[\u3040-\u30ff\u3400-\u9fff][\u3040-\u30ff\u3400-\u9fff0-9]*/g) ?? [];
  const latinRuns = text.match(/[A-Za-z][A-Za-z0-9'’\-:.]*(?:\s+[A-Za-z0-9'’\-:.]+)*/g) ?? [];

  const variants = [
    normalizeName(text),
    ...cjkRuns.map((run) => normalizeName(run)),
    ...latinRuns.map((run) => normalizeName(run)),
  ].filter((v) => v && v.length >= 2 && v !== 'steam');

  return [...new Set(variants)];
}

/** 两个（已归一化的）名字的相似度：Dice 与「包含关系」取较大者。 */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dice = diceCoefficient(a, b);
  let contains = 0;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    contains = (shorter / longer) * 0.95;
  }
  return Math.max(dice, contains);
}

/** 片段是否可用：归一化后长度 ≥6 且不是通用词。 */
function isUsableFragment(fragment) {
  const compact = String(fragment ?? '').replace(/\s+/g, '');
  if (compact.length < 6) return false;
  return !GENERIC_FRAGMENTS.test(compact);
}

/**
 * 一对标题的完整判定（CE 加固核心）。
 * 返回：
 *  - score       提案展示分（数字冲突为 0；完整分 ≥0.8 时允许合格片段加分）
 *  - fullScore   完整归一化标题的相似度（自动判定只看它）
 *  - equal       完整归一化标题是否相等
 *  - numbersOk   数字/序数/罗马数字集合是否一致
 *  - contentWord 任一侧是否含内容词（命中只进人工审核）
 *  - auto        是否允许自动映射（完整相等，或完整 Dice ≥0.94 且无内容词、数字一致、长度 ≥4）
 *  - reasons     不自动的原因（number_conflict/content_word/score_below_auto/title_too_short）
 */
export function evaluatePair(titleA, titleB, { autoScore = 0.94, fragmentFloor = 0.8 } = {}) {
  const numsA = extractNumbers(titleA);
  const numsB = extractNumbers(titleB);
  const numbersOk = sameNumbers(numsA, numsB);
  const contentWord = hasContentWord(titleA) || hasContentWord(titleB);
  const a = normalizeName(titleA);
  const b = normalizeName(titleB);
  const equal = !!a && !!b && a === b;
  const fullScore = similarity(a, b);

  let score = numbersOk ? fullScore : 0;
  if (numbersOk && fullScore >= fragmentFloor) {
    for (const fa of nameVariants(titleA)) {
      if (!isUsableFragment(fa)) continue;
      for (const fb of nameVariants(titleB)) {
        if (!isUsableFragment(fb)) continue;
        const s = similarity(fa, fb);
        if (s > score) score = s;
      }
    }
  }

  const lenA = a.replace(/\s+/g, '').length;
  const lenB = b.replace(/\s+/g, '').length;
  const auto = numbersOk && !contentWord && (equal || (fullScore >= autoScore && lenA >= 4 && lenB >= 4));

  const reasons = [];
  if (!numbersOk) reasons.push('number_conflict');
  if (contentWord) reasons.push('content_word');
  if (numbersOk && !contentWord && !equal) {
    reasons.push(fullScore < autoScore ? 'score_below_auto' : 'title_too_short');
  }
  return { score, fullScore, equal, auto, numbersOk, contentWord, reasons };
}

/** 两个商品名的相似度（保持旧签名：只返回分数）。 */
export function scorePair(titleA, titleB) {
  return evaluatePair(titleA, titleB).score;
}

/**
 * 在候选里找最像的一个。
 * candidates: [{ name, nameEn }]；返回
 * { candidate, score, matchedField, fullScore, equal, auto, numbersOk, contentWord, reasons } 或 null。
 */
export function bestMatch(title, candidates, { minScore = 0.86, getFields = (c) => [c.name, c.nameEn], autoScore = 0.94 } = {}) {
  let best = null;
  for (const candidate of candidates ?? []) {
    for (const field of getFields(candidate)) {
      if (!field) continue;
      const ev = evaluatePair(title, field, { autoScore });
      if (!best || ev.score > best.score) {
        best = {
          candidate,
          score: ev.score,
          matchedField: field,
          fullScore: ev.fullScore,
          equal: ev.equal,
          auto: ev.auto,
          numbersOk: ev.numbersOk,
          contentWord: ev.contentWord,
          reasons: ev.reasons,
        };
      }
    }
  }
  if (!best || best.score < minScore) return null;
  return best;
}

/** 分数 → 人读置信度（纯分数视角；自动与否以 evaluatePair/bestMatch 的 auto 为准）。 */
export function confidenceLabel(score) {
  if (score >= 0.94) return '自动';
  if (score >= 0.86) return '待确认';
  return '无候选';
}
