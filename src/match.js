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
// DG 批（2026-11-18，docs/TODO.md DG 条目）：副标题感知——按 ：: - — / 切主标题，
// 主标题精确/包含命中给 0.90–0.93 的分数 + 理由 subtitle（落在"需人工"区，不自动确认）；
// 只在完整分低于自动阈值且不相等时启用，版次剥离后相等的标题仍走 1.0 自动，CE 口径不回退。
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

// ─────────────────────────────────────────────────────────────────────
// DG 批（docs/TODO.md DG 条目）：副标题感知——
// 「断箭: 俄罗斯国民近卫军」这类带副标题的标题整串打分会被副标题拉低，
// 候选明明在库里（「断箭」）却因 <0.86 被丢弃。按 ：: - — / 切主标题，
// 主标题精确/包含命中给 0.90–0.93 + 理由 subtitle（落在「需人工」区，不自动确认）。
// ─────────────────────────────────────────────────────────────────────

/** 副标题分隔符（DG 批）：全角/半角冒号、连字符、破折号、斜杠。 */
const SUBTITLE_SPLIT_RE = /[:：\/—–-]/u;

/** 拆主标题/副标题：按第一个分隔符切，返回 { main, subtitle }（原文；无分隔符时 subtitle 为空串）。 */
export function splitSubtitle(raw) {
  const text = String(raw ?? '');
  const m = SUBTITLE_SPLIT_RE.exec(text);
  if (!m) return { main: text.trim(), subtitle: '' };
  return { main: text.slice(0, m.index).trim(), subtitle: text.slice(m.index + 1).trim() };
}

/** 副标题是否有信息量：剥掉版本/内容词后仍有 ≥2 个紧凑字符且非通用词。 */
function meaningfulSubtitle(rawSub) {
  const n = normalizeName(rawSub).replace(/\s+/g, '');
  if (n.length < 2 || GENERIC_FRAGMENTS.test(n)) return null;
  return n;
}

/** 主标题可用性：≥2 个紧凑字符、非通用词、非纯数字（防「代号」「星球大战」这类共享前缀）。 */
function usableMain(normalizedMain) {
  const m = String(normalizedMain ?? '').replace(/\s+/g, '');
  if (m.length < 2) return null;
  if (GENERIC_FRAGMENTS.test(m) || /^[0-9]+$/.test(m)) return null;
  return m;
}

/**
 * 副标题感知命中判定，返回 { score }（0.90–0.93）或 null。
 * 命中条件（仅在数字一致、完整标题不相等、完整分低于自动阈值时评估，CE 口径不回退）：
 *  1. 主标题精确命中对方完整归一化标题（「断箭: 俄罗斯国民近卫军」↔「断箭」）→ 0.92；
 *  2. 双方都有副标题且主标题相等 → 0.92；
 *  3. 包含命中：主标题是对方完整标题的真子串，且对方没有副标题、主标题 ≥4 字、
 *     对方多出的部分 ≤8 字——防「星球大战」⊂「星球大战 绝地 陨落的武士团」
 *     这类共享前缀被当成副标题命中（CE 13 条误匹配不回退的关键护栏）。
 */
function subtitleHit(titleA, titleB, normA, normB) {
  const sa = splitSubtitle(titleA);
  const sb = splitSubtitle(titleB);
  const subA = sa.subtitle ? meaningfulSubtitle(sa.subtitle) : null;
  const subB = sb.subtitle ? meaningfulSubtitle(sb.subtitle) : null;
  if (!subA && !subB) return null;
  const fullA = normA.replace(/\s+/g, '');
  const fullB = normB.replace(/\s+/g, '');
  const mainA = usableMain(normalizeName(sa.main));
  const mainB = usableMain(normalizeName(sb.main));
  if (mainA && mainA === fullB) return { score: 0.92 };
  if (mainB && mainB === fullA) return { score: 0.92 };
  if (subA && subB && mainA && mainB && mainA === mainB) return { score: 0.92 };
  if (mainA && !subB && mainA.length >= 4 && fullB.includes(mainA) && fullB.length > mainA.length && fullB.length <= mainA.length + 8) return { score: 0.9 };
  if (mainB && !subA && mainB.length >= 4 && fullA.includes(mainB) && fullA.length > mainB.length && fullA.length <= mainB.length + 8) return { score: 0.9 };
  return null;
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
  // DG 批：副标题感知——主标题精确/包含命中给 0.90–0.93（覆盖片段加分，保证落在需人工区）。
  // 只在不相等且完整分低于自动阈值时评估：版次剥离后相等的标题仍走 1.0 自动，不回退 CE 口径。
  if (numbersOk && !equal && fullScore < autoScore) {
    const sub = subtitleHit(titleA, titleB, a, b);
    if (sub) {
      score = sub.score;
      reasons.push('subtitle');
    }
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

/**
 * CD 批（docs/SONKWO-STEAM-MATCH.md §4.2）：多输入变体匹配——杉果标题的
 * 中文名 + 英文名（孤儿游戏行 games.name_en）分别对候选的 name/name_en 计分，
 * 取最高分，记录 matchedTitle 与 method（name_zh / name_en）。
 */
export function bestMatchMulti(titles, candidates, { minScore = 0.86, getFields = (c) => [c.name, c.nameEn], autoScore = 0.94 } = {}) {
  let best = null;
  for (const title of titles ?? []) {
    if (!title) continue;
    const hit = bestMatch(title, candidates, { minScore, getFields, autoScore });
    if (hit && (!best || hit.score > best.score)) {
      best = { ...hit, matchedTitle: title, method: /[\u3400-\u9fff]/.test(title) ? 'name_zh' : 'name_en' };
    }
  }
  return best;
}

/**
 * DE 批（docs/ALIGN-REVIEW-UI.md §3「明细数据」）：按分数降序返回 top-N 候选，
 * 供「明细」面板渲染（名称/AppID/分数/reasons/来源）。口径与 bestMatchMulti 一致：
 * 同一候选取（标题 × 字段）里最高分的一条，top-1 就是 bestMatchMulti 的结果。
 * 不设 minScore 下限——低于阈值的候选也要进明细（管理员可看到"低分候选"再人工判定）。
 */
export function topMatches(titles, candidates, { getFields = (c) => [c.name, c.nameEn], autoScore = 0.94, topN = 5 } = {}) {
  const byCandidate = new Map();
  for (const title of titles ?? []) {
    if (!title) continue;
    const method = /[\u3400-\u9fff]/.test(title) ? 'name_zh' : 'name_en';
    for (const candidate of candidates ?? []) {
      let best = null;
      for (const field of getFields(candidate)) {
        if (!field) continue;
        const ev = evaluatePair(title, field, { autoScore });
        if (!best || ev.score > best.score) best = { ev, field };
      }
      if (!best) continue;
      const entry = {
        candidate,
        score: best.ev.score,
        matchedField: best.field,
        matchedTitle: title,
        method,
        fullScore: best.ev.fullScore,
        equal: best.ev.equal,
        auto: best.ev.auto,
        numbersOk: best.ev.numbersOk,
        contentWord: best.ev.contentWord,
        reasons: best.ev.reasons,
      };
      const prev = byCandidate.get(candidate);
      if (!prev || entry.score > prev.score) byCandidate.set(candidate, entry);
    }
  }
  return [...byCandidate.values()].sort((a, b) => b.score - a.score).slice(0, topN);
}

/** CD 批：审核队列去重组的稳定键 = platform + normalizeName(杉果名)。 */
export function alignGroupKey(platformCode, title) {
  const normalized = normalizeName(title).replace(/\s+/g, '');
  return normalized ? `${platformCode}:${normalized}` : null;
}

/** 分数 → 人读置信度（纯分数视角；自动与否以 evaluatePair/bestMatch 的 auto 为准）。 */
export function confidenceLabel(score) {
  if (score >= 0.94) return '自动';
  if (score >= 0.86) return '待确认';
  return '无候选';
}

// ─────────────────────────────────────────────────────────────────────
// CN 批（docs/ALIGN-QUERY-PERF.md §2/§3）：候选预筛——
// 线上事故根因是「组数 × 19.6 万行」全量比较。预筛先按归一化全等（快路径）
// 与信息 token（中文全串+前 2 字前缀、英文 ≥3 字单词）把候选收敛到 ≤2000，
// 再交给 bestMatchMulti 打分。召回策略保守：正确候选共享的 token 全命中，
// 且「token 共享数降序截断」保证高相似候选不被截掉；CE 的 13 条误匹配
// 只共享已归一化剥掉的通用词，预筛后直接不进候选集（口径方向与原实现一致）。
// ─────────────────────────────────────────────────────────────────────

/** 英文通用停用词：作为召回 token 会命中数万行，无区分度且可能挤掉真候选。 */
const TOKEN_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'game', 'games', 'edition', 'deluxe', 'standard', 'ultimate',
  'complete', 'definitive', 'simulator', 'version', 'digital', 'collection', 'bundle', 'demo',
]);

/**
 * 归一化名 → 信息 token 集合。
 * 英文：≥3 字且非停用词的单词；中文：连续汉字串整体 + 前 2 字前缀（提高召回）。
 */
export function indexTokens(normalizedName) {
  const out = new Set();
  for (const w of String(normalizedName ?? '').split(/\s+/)) {
    if (/^[a-z0-9]+$/.test(w)) {
      if (w.length >= 3 && !TOKEN_STOP_WORDS.has(w)) out.add(w);
    } else if (/^[\u3400-\u9fff]+$/.test(w)) {
      out.add(w);
      if (w.length >= 2) out.add(w.slice(0, 2));
    }
  }
  return [...out];
}

/**
 * 候选内存索引：归一化名快查表 + token 倒排表（候选 → token 命中数，用于排序截断）。
 * candidates: [{ name, nameEn }]（19.6 万行量级）；构建一次、多组复用。
 * 默认字段是 DB 蛇形 name/name_en（DG 批：server.js 直接喂库行，旧默认只读 nameEn
 * 驼峰，name_en 从未进索引 → 英文名 token 召回漏候选）。
 */
export function buildCandidateIndex(candidates, { getFields = (c) => [c.name, c.name_en ?? c.nameEn] } = {}) {
  const byNorm = new Map(); // 归一化名 → candidates[]
  const byToken = new Map(); // token → candidates[]
  const shared = new Map(); // candidate → token 命中数（排序截断用）
  const list = candidates ?? [];
  for (const c of list) {
    const seen = new Set();
    for (const f of getFields(c)) {
      if (!f) continue;
      const n = normalizeName(f);
      if (!n) continue;
      if (!byNorm.has(n)) byNorm.set(n, []);
      byNorm.get(n).push(c);
      for (const tok of indexTokens(n)) {
        if (seen.has(tok)) continue;
        seen.add(tok);
        if (!byToken.has(tok)) byToken.set(tok, []);
        byToken.get(tok).push(c);
        shared.set(c, (shared.get(c) ?? 0) + 1);
      }
    }
  }
  return { candidates: list, byNorm, byToken, shared, getFields };
}

/**
 * 预筛：返回该组用于打分的候选子集（≤ maxCandidates）。
 * 快路径：任一变体归一化全等命中 → 只返回这些命中（完整相等一定在集合内，口径零损失）。
 * 慢路径：所有变体的 token 召回并集，按「与标题共享 token 数」降序截断——
 * 高相似候选共享的 token 多、一定排在前，截断不会漏掉本应命中的候选。
 */
export function preselectCandidates(titles, index, { maxCandidates = 2000 } = {}) {
  if (!index?.candidates?.length || !titles?.length) return [];
  const normTitles = [...new Set((titles ?? []).map((t) => normalizeName(t)).filter(Boolean))];
  if (!normTitles.length) return [];

  // 快路径：归一化全等
  const exact = new Map();
  for (const t of normTitles) {
    for (const c of index.byNorm.get(t) ?? []) {
      if (!exact.has(c)) exact.set(c, true);
    }
  }
  if (exact.size) return [...exact.keys()];

  // 慢路径：token 召回 + 共享数降序截断
  const scored = new Map();
  const tokens = new Set();
  for (const t of normTitles) for (const tok of indexTokens(t)) tokens.add(tok);
  for (const tok of tokens) {
    for (const c of index.byToken.get(tok) ?? []) {
      scored.set(c, (scored.get(c) ?? 0) + 1);
    }
  }
  if (!scored.size) return [];
  const out = [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return out.slice(0, maxCandidates);
}
