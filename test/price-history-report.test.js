// AP 批（docs/PRICE-HISTORY-REPORT.md §6）：价格历史报表的接线。
// 守：史低全期口径且所有史低日高亮；区间口径不与顶部卡片重复；前端无导出按钮。
// BN 批（§10）：v-for 与 v-if 不允许写在同一元素（旧写法会让整个组件渲染失败），并用编译器产物做渲染级回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const componentPath = '../frontend/src/components/PriceHistoryReport.vue';

test('AP 组件：指标条/范围切换/趋势线/史低高亮/卡片分页齐全', () => {
  const c = read(componentPath);
  assert.match(c, /区间最低/);
  assert.match(c, /区间最高/);
  assert.match(c, /当前较史低/);
  assert.match(c, /记录天数/);
  assert.match(c, /近 30 天/);
  assert.match(c, /近 90 天/);
  assert.match(c, /全部/);
  assert.match(c, /svg viewBox="0 0 840 76"/);
  // BN：史低高亮改为 JS 预计算（lowDots），模板里只 v-for
  assert.match(c, /const lowDots = computed/);
  assert.match(c, /v-for="\(d, k\) in lowDots"/);
  assert.match(c, /d\.p\.price_cents === histLow/, 'lowDots 过滤口径');
  assert.match(c, /史低/);
  assert.match(c, /已是史低/);
  assert.match(c, /phr-cards/);
  assert.doesNotMatch(c, /导出/);
});

test('BN：模板里没有元素同时写 v-for 与 v-if（全组件扫描，防止别的组件再犯）', () => {
  const srcRoot = fileURLToPath(new URL('../frontend/src/', import.meta.url));
  const files = readdirSync(srcRoot, { recursive: true })
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => f.endsWith('.vue'));
  assert.ok(files.length > 20, `扫到组件文件（${files.length} 个）`);
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(`${srcRoot}/${f}`, 'utf8');
    // 只看标签本身：Vue 3 里同一元素混用 v-for/v-if 会把 v-if 提到循环外（旧 bug 的根因）
    for (const tag of src.match(/<[a-zA-Z][^>]*>/g) ?? []) {
      if (/\bv-for=/.test(tag) && /\bv-if=/.test(tag)) offenders.push(`${f}: ${tag.slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [], '禁止同一元素混用 v-for 与 v-if');
});

test('BN：组件模板编译产物不再引用循环外的 p（渲染级回归）', async () => {
  const { compile } = await import('@vue/compiler-dom');
  // 自检：把旧写法拿去编译，产物确实把判断提到 renderList 外 —— 证明检测器有效（旧写法放回必红）
  const badCode = compile('<circle v-for="(p,i) in filtered" v-if="p.price_cents === histLow" />', { mode: 'module' }).code;
  assert.match(badCode, /_ctx\.p\.price_cents/, '旧写法的编译产物在循环外引用 p（正是旧 bug 根因）');

  // 组件现在：模板编译后不得出现 _ctx.p 这种循环外引用，且史低圆点来自预计算数组
  const src = read(componentPath);
  const start = src.indexOf('<template>');
  const end = src.lastIndexOf('</template>');
  assert.ok(start >= 0 && end > start, '能取出 SFC 模板');
  const tpl = src.slice(start + '<template>'.length, end);
  const code = compile(tpl, { mode: 'module' }).code;
  assert.doesNotMatch(code, /_ctx\.p\./, '编译产物不得在循环外引用 p');
  assert.match(code, /_ctx\.lowDots/, '史低圆点走 lowDots 预计算');
  assert.match(code, /_renderList\(_ctx\.lowDots/, 'lowDots 仍是 v-for 循环（渲染所有史低日）');
});

test('AP 首页接线：Home.vue 用组件替换旧网格，删掉 series 分页', () => {
  const home = read('../frontend/src/pages/Home.vue');
  assert.match(home, /import PriceHistoryReport/);
  assert.match(home, /<PriceHistoryReport :series="detail.series\|\|\[\]"/);
  assert.doesNotMatch(home, /pagedSeries/);
  assert.doesNotMatch(home, /series-list/);
});

test('AP 样式落库', () => {
  const css = read('../frontend/src/styles/main.css');
  assert.match(css, /\.phr-table tr\.low td/);
  assert.match(css, /\.phr-chart svg/);
  assert.match(css, /\.phr-card\.low/);
});
