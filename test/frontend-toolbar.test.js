// EO（docs/TODO.md「首页工具栏 1100–1300px 挤成一行」）：工具栏响应式断点的静态锁。
// 守的约束（2026-11-24 排查出的真实根因，不是"看起来像"）：
//   1) 宽屏 >1360px 保持单行（下拉固定 132px）；
//   2) 1360px 及以下：搜索框整行 + 下拉两列（calc(50% - 5px) + min-width 118px），
//      覆盖原来的空档 1201–1300 与拥挤的 1100–1200；
//   3) 平板 900 / 小屏 600 两档存在（ROADMAP「体验与性能优化」批次 2）；
//   4) 根因锁：修复前 main.css 末尾有一条**没有媒体查询包裹**的
//      `.toolbar .el-select{flex:0 0 132px;width:132px}`，它以同特异性、后出现的方式
//      覆盖了 1200px 内的两列规则，导致 6 个下拉固定 132px 挤成一行——这条规则不允许再以全局形态出现；
//   5) 层叠顺序锁：≤420px 的一列规则必须排在 600 档之后，否则窄屏会被 600 档的"两列"覆盖回两列。
// 反向自检：把修复前的全局规则喂给同一个解析器，断言必须判红——证明本文件真的能抓住该缺陷。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');

/** 返回 openIdx 处 `{` 对应的 `}` 下标（忽略字符串内的花括号——本文件 CSS 不含字符串块）。 */
function matchBrace(css, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 规则所在媒体查询（如 "@media(max-width:1360px)"）；全局规则返回 null。 */
function mediaAt(css, pos) {
  for (const m of css.matchAll(/@media[^{]*\{/g)) {
    const start = m.index;
    const end = matchBrace(css, m.index + m[0].length - 1);
    if (pos > start && pos < end) return m[0].replace(/\{$/, '').trim();
  }
  return null;
}

/** 极简 CSS 规则表：{ media, selector, decls, index }；嵌套在 @media 里的规则照常展开。 */
function rulesOf(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    out.push({ media: mediaAt(css, m.index), selector, decls: m[2].trim(), index: m.index });
  }
  return out;
}

/** 把 main.css 拆成结构，供多条断言共用（只解析一次）。 */
function parseToolbarCss(css) {
  const rules = rulesOf(css);
  const isSelect = (r) => /(^|[\s,])\.toolbar\s+\.el-select$/.test(r.selector);
  const isSearch = (r) => /(^|[\s,])\.toolbar\s+\.search$/.test(r.selector);
  return {
    rules,
    selectRules: rules.filter(isSelect),
    searchRules: rules.filter(isSearch),
    inMedia: (cond) => rules.filter((r) => r.media === cond),
  };
}

const css = read('frontend/src/styles/main.css');
const parsed = parseToolbarCss(css);

test('EO：1360px 及以下搜索框整行 + 下拉两列（覆盖 1101–1300 空档）', () => {
  const m = parsed.inMedia('@media(max-width:1360px)');
  const search = m.find((r) => /\.toolbar\s+\.search$/.test(r.selector));
  assert.ok(search, '1360px 档必须有 .toolbar .search 规则');
  assert.match(search.decls, /flex:1 1 100%/, '搜索框必须占整行（flex:1 1 100%）');

  const sel = m.find((r) => /\.toolbar\s+\.el-select$/.test(r.selector));
  assert.ok(sel, '1360px 档必须有 .toolbar .el-select 规则');
  assert.match(sel.decls, /calc\(50% - 5px\)/, '下拉按两列均分：calc(50% - 5px)');
  assert.match(sel.decls, /min-width:118px/, 'min-width 118px 防「全部发行」被压成「全…」');
  assert.match(sel.decls, /width:auto/, '宽度交给 flex，不能固定 132px');
});

test('EO：900 / 600 两档平板与小屏工具栏存在（且同样搜索整行 + 两列）', () => {
  for (const cond of ['@media(max-width:900px)', '@media(max-width:600px)']) {
    const m = parsed.inMedia(cond);
    const search = m.find((r) => /\.toolbar\s+\.search$/.test(r.selector));
    const sel = m.find((r) => /\.toolbar\s+\.el-select$/.test(r.selector));
    assert.ok(search, `${cond} 必须有搜索框整行规则`);
    assert.ok(sel, `${cond} 必须有下拉两列规则`);
    assert.match(search.decls, /flex:1 1 100%/, `${cond} 搜索框占整行`);
    assert.match(sel.decls, /calc\(50% - 4px\)|calc\(50% - 5px\)/, `${cond} 下拉两列`);
    assert.match(sel.decls, /min-width:118px/, `${cond} 保留下拉最小宽度`);
  }
});

test('EO 根因锁：不存在"无媒体查询包裹"的全局 132px 下拉规则', () => {
  const globalFixed = parsed.selectRules.filter((r) => r.media === null && /flex:0 0 132px/.test(r.decls) && /width:132px/.test(r.decls));
  assert.equal(globalFixed.length, 0, '全局 132px 规则会覆盖所有窄屏两列布局（1100–1300 挤一行的根因），只能出现在 >1360px 的媒体查询里');
});

test('EO：宽屏 >1360px 保持单行（下拉固定 132px 只在该档）', () => {
  const wide = parsed.inMedia('@media(min-width:1361px)').filter((r) => /\.toolbar\s+\.el-select$/.test(r.selector));
  assert.equal(wide.length, 1, '>1360px 档必须且只能有一条下拉固定宽度规则');
  assert.match(wide[0].decls, /flex:0 0 132px/, '宽屏下拉固定 132px');
  assert.match(wide[0].decls, /width:132px/, '宽屏下拉固定宽度 132px');
  // 基础规则也在（>1360 时与媒体查询规则一致，双保险）
  const base = parsed.selectRules.find((r) => r.media === null && /flex:0 0 auto/.test(r.decls));
  assert.ok(base, '基础规则 .toolbar .el-select{flex:0 0 auto;width:132px} 必须保留');
});

test('EO 层叠顺序锁：≤420px 一列规则排在 600 档之后（否则窄屏被覆盖回两列）', () => {
  const mobileOneCol = parsed.selectRules.filter((r) => /flex-basis:100%/.test(r.decls));
  assert.ok(mobileOneCol.length >= 1, '≤420px 必须有一条下拉占满整行规则');
  const at420 = mobileOneCol.find((r) => r.media === '@media(max-width:420px)');
  assert.ok(at420, '一列规则必须在 420px 档内');
  const at600 = parsed.selectRules.find((r) => r.media === '@media(max-width:600px)');
  assert.ok(at600, '600 档必须存在');
  assert.ok(at420.index > at600.index, '420 档必须后出现（同特异性下后出现才生效）');
});

test('EO 反向自检：修复前的全局 132px 规则会被同一解析器判红', () => {
  const broken = '.toolbar .el-select{flex:0 0 132px;width:132px}';
  const p = parseToolbarCss(css + '\n' + broken);
  const bad = p.selectRules.filter((r) => r.media === null && /flex:0 0 132px/.test(r.decls) && /width:132px/.test(r.decls));
  assert.ok(bad.length >= 1, '注入修复前的全局规则后，根因锁断言必须命中（证明断言有效，不是永远为真）');
  // 另一条反向自检：1360 档若丢失则搜索整行断言必须失败
  const p2 = parseToolbarCss(css.replace('@media(max-width:1360px)', '@media(max-width:1200px)'));
  const m = p2.inMedia('@media(max-width:1360px)');
  assert.equal(m.length, 0, '把 1360 改回 1200 后，1360 档必须查不到（证明断点断言不是摆设）');
});
