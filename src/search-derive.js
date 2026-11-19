// DS 批（docs/SEARCH-ALIASES.md §2）：搜索派生 token 纯函数（零人工、可全量重建）。
//
// 锁住的约束：
//   1) 输出只依赖输入（无 IO/无状态），全部小写、无空格无标点，保序去重，上限 MAX_SEARCH_TOKENS 条；
//   2) 存储侧与查询侧用同一函数（查询词当作 name 传入）——两边生成同一组组合 token，数组重叠即可命中；
//   3) 缩写跳虚词（the/a/an/of/and/in/on/at/to/for）；罗马数字 I–XII 与阿拉伯 1–12 双向互转，
//      组合 token 双向各一条（GTA VI → gtavi / gta6）；
//   4) 中文名走 pinyin-pro 全拼 + 首字母 + 数字组合（侠盗猎车手6 → xiadaoliecheshou / xdlcs / xdlcs6）；
//   5) 纯数字、罗马碎片（vi）、虚词 token 不参与 LIKE 模式与数组重叠——由调用方用
//      queryOverlapTokens / queryLikePatterns 过滤，避免「%6%」「%vi%」把结果集放宽。
import { pinyin } from 'pinyin-pro';

/** 派生 token 上限（规格 §2：去重、上限 40 条）。 */
export const MAX_SEARCH_TOKENS = 40;

/** 缩写时跳过的虚词（规格 §2.3）。 */
export const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'at', 'to', 'for']);

/** 罗马数字 → 阿拉伯（规格 §2.4：I–XII）。 */
export const ROMAN_TO_ARABIC = new Map([
  ['i', 1], ['ii', 2], ['iii', 3], ['iv', 4], ['v', 5], ['vi', 6],
  ['vii', 7], ['viii', 8], ['ix', 9], ['x', 10], ['xi', 11], ['xii', 12],
]);

/** 阿拉伯 → 罗马（规格 §2.4：1–12）。 */
export const ARABIC_TO_ROMAN = new Map([...ROMAN_TO_ARABIC].map(([roman, arabic]) => [arabic, roman]));

const FULLWIDTH_RE = /[\uFF01-\uFF5E]/g;
const TRADEMARK_RE = /[™®©]/g;
const PUNCT_RE = /[\p{P}\p{S}]+/gu;

/** 全角 → 半角（全角空格 U+3000 由 \s 处理）。 */
function halfWidth(c) {
  return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
}

/**
 * 归一化：小写；英文去重音（NFD 去 \p{M}，不依赖 PG unaccent 扩展，pglite/PG 行为一致）；
 * 全角→半角；去商标符号与全部标点/空格。输出无空格无标点的小写串。
 */
export function normalizeText(raw) {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(FULLWIDTH_RE, halfWidth)
    .toLowerCase()
    .replace(TRADEMARK_RE, '')
    .replace(PUNCT_RE, '')
    .replace(/\s+/g, '');
}

/** 归一化但保留词界（缩写分词用）：标点替换成空格后按空白切词。 */
export function normalizeWords(raw) {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(FULLWIDTH_RE, halfWidth)
    .toLowerCase()
    .replace(TRADEMARK_RE, '')
    .replace(PUNCT_RE, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** 字母/数字/汉字边界拆分：gta6 → [gta, 6]；侠盗猎车手6 → [侠盗猎车手, 6]。 */
export function splitTokens(normalized) {
  return String(normalized ?? '').match(/[a-z]+|[0-9]+|[\u4e00-\u9fff]+/g) ?? [];
}

const push = (out, t) => {
  const v = String(t ?? '');
  if (v && !out.includes(v)) out.push(v);
};

/**
 * 生成某款游戏的派生搜索 token（规格 §2 规则 1–6）。
 * 输入 { name, nameEn }（任一可为空），输出归一化 token 列表（≤40 条、去重、保序）。
 */
export function deriveSearchTokens({ name = null, nameEn = null } = {}) {
  const out = [];
  // 先英文名后原名：组合 token 都生成，顺序只影响保序去重的先后，不影响命中
  const sources = [];
  if (nameEn) sources.push({ text: nameEn });
  if (name) sources.push({ text: name });

  for (const { text } of sources) {
    const norm = normalizeText(text);
    if (!norm) continue;
    // 规则 6：原名/英文名去空格连写
    push(out, norm);
    // 规则 2：token 拆分——先按空格取词界，再按字母/数字/汉字边界拆（Grand Theft Auto VI → 5 个 token）
    const tokens = normalizeWords(text).flatMap((w) => splitTokens(w));
    for (const t of tokens) push(out, t);

    if (/[a-z]/.test(norm)) {
      // 规则 3：缩写——按原词序分词，末尾的罗马/数字词剥出来作后缀
      const words = normalizeWords(text);
      const content = [...words];
      let suffix = null;
      const last = content[content.length - 1];
      if (last && (ROMAN_TO_ARABIC.has(last) || /^\d+$/.test(last))) suffix = content.pop();
      const initials = content.filter((w) => !STOP_WORDS.has(w)).map((w) => w[0]).join('');
      if (initials.length >= 2) {
        push(out, initials);
        if (suffix) {
          const arabic = ROMAN_TO_ARABIC.has(suffix) ? ROMAN_TO_ARABIC.get(suffix) : /^\d+$/.test(suffix) ? Number(suffix) : null;
          const roman =
            arabic != null && ARABIC_TO_ROMAN.has(arabic)
              ? ARABIC_TO_ROMAN.get(arabic)
              : ROMAN_TO_ARABIC.has(suffix)
                ? suffix
                : null;
          // GTA VI → gtavi；GTA 6 → gta6（双向各一条）
          if (roman) push(out, initials + roman);
          if (arabic != null) push(out, initials + String(arabic));
        }
      }
    }

    // 规则 4：罗马数字 → 阿拉伯
    for (const t of tokens) {
      if (ROMAN_TO_ARABIC.has(t)) push(out, String(ROMAN_TO_ARABIC.get(t)));
    }
    // 规则 4：阿拉伯 1–12（位于末尾）→ 罗马，并与前一字母 token 组合（portal 2 → portalii）
    tokens.forEach((t, i) => {
      if (/^\d+$/.test(t) && i === tokens.length - 1) {
        const n = Number(t);
        if (ARABIC_TO_ROMAN.has(n)) {
          push(out, ARABIC_TO_ROMAN.get(n));
          const prev = tokens[i - 1];
          if (prev && /^[a-z]+$/.test(prev) && prev.length >= 2) push(out, prev + ARABIC_TO_ROMAN.get(n));
        }
      }
    });

    // 规则 5：拼音（仅中文名）——全拼 + 首字母 + 数字组合
    if (/[\u4e00-\u9fff]/.test(text)) {
      const han = text.match(/[\u4e00-\u9fff]+/g)?.join(' ') ?? '';
      if (han) {
        const syl = pinyin(han, { toneType: 'none', type: 'array' })
          .map((w) => String(w ?? '').trim().toLowerCase())
          .filter(Boolean);
        const full = syl.join('');
        push(out, full);
        const initials = syl.map((w) => w[0] ?? '').join('');
        if (initials.length >= 2) push(out, initials);
        const nums = norm.match(/[0-9]+$/)?.[0];
        if (nums) {
          push(out, full + nums);
          push(out, initials + nums);
        }
      }
    }
  }
  return out.slice(0, MAX_SEARCH_TOKENS);
}

/**
 * 查询侧派生：与存储侧同一函数（查询词当作 name 传入）。
 * 空关键词/纯数字关键词（AppID 搜索）返回空数组——调用方不拼 token 源。
 */
export function deriveQueryTokens(kw) {
  const raw = String(kw ?? '').trim();
  if (!raw || /^\d{1,10}$/.test(raw)) return [];
  return deriveSearchTokens({ name: raw });
}

/** 数组重叠（&&）用的查询 token：排除纯数字、罗马碎片与虚词（见文件头约束 5）。 */
export function queryOverlapTokens(tokens) {
  return tokens.filter(
    (t) => t.length >= 2 && !/^\d+$/.test(t) && !ROMAN_TO_ARABIC.has(t) && !STOP_WORDS.has(t),
  );
}

/** LIKE 子串模式（t like any(...)）用的查询 token：只留 ≥2 位纯字母、非罗马、非虚词的碎片 token。 */
export function queryLikePatterns(tokens) {
  return tokens
    .filter((t) => t.length >= 2 && /^[a-z]+$/.test(t) && !ROMAN_TO_ARABIC.has(t) && !STOP_WORDS.has(t))
    .map((t) => `%${t}%`);
}
