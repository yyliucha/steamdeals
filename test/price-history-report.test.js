// AP 批（docs/PRICE-HISTORY-REPORT.md §6）：价格历史报表的接线。
// 守：史低全期口径且所有史低日高亮；区间口径不与顶部卡片重复；前端无导出按钮。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('AP 组件：指标条/范围切换/趋势线/史低高亮/卡片分页齐全', () => {
  const c = read('../frontend/src/components/PriceHistoryReport.vue');
  assert.match(c, /区间最低/);
  assert.match(c, /区间最高/);
  assert.match(c, /当前较史低/);
  assert.match(c, /记录天数/);
  assert.match(c, /近 30 天/);
  assert.match(c, /近 90 天/);
  assert.match(c, /全部/);
  assert.match(c, /svg viewBox="0 0 840 76"/);
  assert.match(c, /p.price_cents === histLow/);
  assert.match(c, /史低/);
  assert.match(c, /已是史低/);
  assert.match(c, /phr-cards/);
  assert.doesNotMatch(c, /导出/);
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
