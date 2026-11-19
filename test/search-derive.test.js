// DS 批（docs/SEARCH-ALIASES.md §2/§6）：搜索派生 token 纯函数单测。
// 锁住的约束：
//   1) 归一化幂等一致（重音/全角/商标/标点全被消除），pglite/PG 行为一致（重音归一在 JS 层）；
//   2) 存储侧与查询侧同一函数——gta6/GTA VI/gta 6 的查询 token 必与 Grand Theft Auto VI 的存储 token 重叠；
//   3) 罗马数字↔阿拉伯双向（Portal 2 → portalii；VI → 6）；缩写跳虚词（GTA 不含 the/of）；
//   4) 中文名拼音派生（全拼/首字母/数字组合）；
//   5) 纯数字、罗马碎片、虚词 token 不进数组重叠与 LIKE 模式（反向自检：过滤条件去掉必红）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SEARCH_TOKENS,
  normalizeText,
  splitTokens,
  deriveSearchTokens,
  deriveQueryTokens,
  queryOverlapTokens,
  queryLikePatterns,
} from '../src/search-derive.js';

test('归一化：小写 + 去重音 + 全角转半角 + 商标/标点/空格全消', () => {
  assert.equal(normalizeText('Grand Theft Auto™ VI'), 'grandtheftautovi');
  assert.equal(normalizeText('Pokémon X'), 'pokemonx');
  assert.equal(normalizeText('ＧＴＡ　６'), 'gta6');
  assert.equal(normalizeText('G.T.A. VI © 2026'), 'gtavi2026');
  assert.equal(normalizeText(''), '');
  assert.equal(normalizeText(null), '');
});

test('token 拆分：字母/数字/汉字边界', () => {
  assert.deepEqual(splitTokens('gta6'), ['gta', '6']);
  assert.deepEqual(splitTokens('侠盗猎车手6'), ['侠盗猎车手', '6']);
  assert.deepEqual(splitTokens(''), []);
});

test('英文缩写 + 罗马数字：Grand Theft Auto VI（验收 1 的派生侧）', () => {
  const tokens = deriveSearchTokens({ name: null, nameEn: 'Grand Theft Auto VI' });
  // 原名连写 + 词 token
  assert.ok(tokens.includes('grandtheftautovi'), '原名去空格连写');
  assert.ok(tokens.includes('grand') && tokens.includes('theft') && tokens.includes('auto'), '词 token');
  // 缩写（跳虚词）+ 罗马↔阿拉伯组合双向
  assert.ok(tokens.includes('gta'), '首字母缩写');
  assert.ok(tokens.includes('gtavi'), 'GTA + VI');
  assert.ok(tokens.includes('gta6'), 'GTA + 6');
  assert.ok(tokens.includes('6') && tokens.includes('vi'), 'VI→6 双向');
  // 全部小写无空格
  assert.ok(tokens.every((t) => t === t.toLowerCase() && !/\s/.test(t)));
});

test('罗马数字↔阿拉伯双向：Portal 2 → portalii；Civilization VI → civilizationvi', () => {
  const portal = deriveSearchTokens({ name: null, nameEn: 'Portal 2' });
  assert.ok(portal.includes('portal2'), '原名连写');
  assert.ok(portal.includes('portalii'), '阿拉伯 2 → 罗马 ii 组合');
  assert.ok(portal.includes('ii') && portal.includes('2'), '双向 token');
  const civ = deriveSearchTokens({ name: null, nameEn: 'Civilization VI' });
  assert.ok(civ.includes('civilizationvi'), '罗马数字词并入连写');
  assert.ok(civ.includes('6'), 'VI → 6');
});

test('拼音派生：侠盗猎车手6 → 全拼/首字母/数字组合（验收 2）', () => {
  const tokens = deriveSearchTokens({ name: '侠盗猎车手6', nameEn: null });
  assert.ok(tokens.includes('xiadaoliecheshou'), '全拼');
  assert.ok(tokens.includes('xdlcs'), '首字母');
  assert.ok(tokens.includes('xiadaoliecheshou6'), '全拼 + 数字');
  assert.ok(tokens.includes('xdlcs6'), '首字母 + 数字');
  assert.ok(tokens.includes('侠盗猎车手'), '中文 token 保留');
});

test('查询侧与存储侧同函数：gta6 / GTA VI / gta 6 的查询 token 必与 GTA VI 存储 token 重叠', () => {
  const stored = deriveSearchTokens({ name: null, nameEn: 'Grand Theft Auto VI' });
  for (const kw of ['gta6', 'GTA VI', 'gta 6', 'GTA6']) {
    const q = queryOverlapTokens(deriveQueryTokens(kw));
    assert.ok(q.some((t) => stored.includes(t)), `查询「${kw}」的 token ${JSON.stringify(q)} 与存储无重叠`);
  }
});

test('查询 token 过滤：纯数字/罗马碎片/虚词不进重叠与 LIKE 模式（宽泛性守卫）', () => {
  const q = deriveQueryTokens('gta6');
  const ovl = queryOverlapTokens(q);
  const pats = queryLikePatterns(q);
  assert.ok(!ovl.includes('6'), '纯数字不进数组重叠');
  assert.ok(!ovl.includes('vi'), '罗马碎片不进数组重叠');
  assert.ok(ovl.includes('gta6') && ovl.includes('gtavi'), '组合 token 保留');
  assert.ok(!pats.some((p) => p === '%6%' || p === '%vi%'), '纯数字/罗马碎片不生成 LIKE 模式');
  assert.ok(pats.includes('%gta%'), '字母碎片生成 LIKE 模式');
  // xdlc6 缺一个首字母（xdlcs → xdlc）：靠字母碎片 LIKE 兜底命中
  assert.ok(queryLikePatterns(deriveQueryTokens('xdlc6')).includes('%xdlc%'));
});

test('纯数字关键词（AppID 搜索）与空关键词：不派生 token', () => {
  assert.deepEqual(deriveQueryTokens('730'), []);
  assert.deepEqual(deriveQueryTokens(''), []);
  assert.deepEqual(deriveQueryTokens('  '), []);
});

test('去重与上限：token 不重复、不超过 MAX_SEARCH_TOKENS', () => {
  const tokens = deriveSearchTokens({ name: '刺客信条：奥德赛 黄金版 2 完全版', nameEn: 'Assassin\'s Creed Odyssey - Gold Edition 2' });
  assert.equal(new Set(tokens).size, tokens.length, '无重复');
  assert.ok(tokens.length <= MAX_SEARCH_TOKENS, `条数 ${tokens.length} 超上限 ${MAX_SEARCH_TOKENS}`);
});

test('反向自检：去掉罗马数字组合（gtavi）派生后，GTA VI 查询将无法命中', () => {
  // 模拟「组合生成被禁用」：从存储 token 中剔除组合 token 后，查询 token 无重叠——证明组合路径是命中必要条件
  const stored = deriveSearchTokens({ name: null, nameEn: 'Grand Theft Auto VI' });
  const degraded = stored.filter((t) => t !== 'gtavi' && t !== 'gta6' && t !== 'gta');
  const q = queryOverlapTokens(deriveQueryTokens('GTA VI'));
  assert.ok(q.some((t) => stored.includes(t)), '完整派生可命中（对照）');
  assert.ok(!q.some((t) => degraded.includes(t)), '剔除组合/缩写 token 后必不命中');
});
