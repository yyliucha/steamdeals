// AQ/AR 批（docs/ADMIN-REVIEW-LISTS.md §3/§4）：列表排序与按 IP 合并的接线、白名单与上限。
// 守：① 排序参数走白名单、不把用户输入拼进 SQL；② 两个列表接上排序、待审上限 500；③ 合并视图聚合与批量处置接上。
// FZ 批（docs/VISITORS-REDESIGN.md）：访问记录拆成 frontend/src/components/visitors/* 七块后，
// 本文件的断言按新落点指向（口径不变，改的是文件位置）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const { visitorOrderClause } = await import('../src/store/pg.js');

test('visitorOrderClause：只认白名单，非法值回落默认', () => {
  assert.equal(visitorOrderClause('time', 'desc'), 'id desc');
  assert.equal(visitorOrderClause('time', 'asc'), 'id asc');
  assert.equal(visitorOrderClause('bad', 'asc'), 'id asc');
  assert.equal(visitorOrderClause('ip', 'bad'), visitorOrderClause('ip', 'desc'));
  assert.match(visitorOrderClause('status', 'asc'), /^blocked asc, id desc$/);
});

test('visitorOrderClause：IP 用零填充键排序，绝不使用 ip::inet', () => {
  const clause = visitorOrderClause('ip', 'asc');
  assert.match(clause, /lpad\(split_part\(ip,'\.',1\),3,'0'\)/);
  assert.match(clause, /zzz'\|\|ip/);
  assert.doesNotMatch(clause, /inet/i);
  assert.match(clause, /nulls last, id desc$/);
});

test('访问明细路由透传 sort/order 白名单', () => {
  // CO-5/B4-2 第八轮（docs/DESIGN-AUDIT.md B4）：admin-access 域拆出后，路由分支在
  // src/routes/admin-access.js、SQL 在 src/store/admin-access-repository.js，断言按新落点指向。
  const routes = read('../src/routes/admin-access.js');
  assert.match(routes, /\[['"]time['"], ['"]ip['"], ['"]status['"]\]\.includes\(rawSort\)/);
  assert.match(routes, /listVisitorLogs\(q, \{[^}]*sort, order/);
});

test('待审列表上限 500（前端不传 limit 也拿满）', () => {
  const repo = read('../src/store/admin-access-repository.js');
  assert.match(repo, /Math\.min\(Math\.max\(Number\(limit\) \|\| 500, 1\), 500\)/);
  const routes = read('../src/routes/admin-access.js');
  assert.match(routes, /'limit'\) \?\? 500/);
});

test('前端排序接线：访问分析（表头 + 持久化 + 数值 IP + 服务端参数）与合并视图排序', () => {
  const analysis = read('../frontend/src/components/visitors/VisitorsAnalysis.vue');
  const review = read('../frontend/src/components/visitors/VisitorsReview.vue');
  assert.match(analysis, /prop="ip" sortable="custom"/);
  assert.match(analysis, /prop="visits" sortable="custom"/);
  assert.match(analysis, /:default-sort="ipSortState"/);
  assert.match(analysis, /admin\.visitorSort/);
  assert.match(analysis, /function visitorSortParams\(\)/);
  assert.match(analysis, /\.\.\.visitorSortParams\(\)/);
  assert.match(analysis, /saveSortState\('admin\.visitorSort'/);
  assert.match(review, /prop="ruleCount" sortable="custom"/);
  assert.match(review, /prop="hitsTotal" sortable="custom"/);
  assert.match(review, /prop="last_seen" sortable="custom"/);
  assert.match(review, /admin\.reviewMergeSort/);
  assert.match(review, /function onMergedSortChange/);
  assert.match(review, /compareIp\(a\.ip, b\.ip\)/);
});

test('AX 批：合并视图默认且唯一——无开关、无合并 localStorage 键、无明细表；聚合/批量处置/移动卡片保留', () => {
  const review = read('../frontend/src/components/visitors/VisitorsReview.vue');
  const modules = read('../frontend/src/pages/AdminModules.vue');
  // 修订口径（§4.5）：不再有开关与 admin.reviewMerge（合并视图排序键 admin.reviewMergeSort 仍保留）
  assert.doesNotMatch(review, /active-text="按 IP 合并"/);
  assert.doesNotMatch(review, /admin\.reviewMerge(?!Sort)/);
  assert.doesNotMatch(review, /pagedReviews|reviewAction|ignoreReview|sel\.reviews/);
  // 默认渲染合并视图：标题说明 + 合并表 + 聚合逻辑 + 批量处置 + 移动卡片 + 分页
  assert.match(review, /同一 IP 合并为一行，展开看逐条规则/);
  assert.match(review, /ref="mergedReviewsTable"/);
  assert.match(review, /const mergedPicked = ref/);
  assert.match(review, /function runMergedBulk/);
  assert.match(review, /async function actRow/);
  assert.match(review, /ruleMap\.set\(r\.rule/);
  assert.match(review, /pendingIds: pending\.map/);
  assert.match(review, /部分已处理/);
  assert.match(review, /已选 \{\{ mergedPicked\.size \}\} 个 IP/);
  assert.match(review, /mergedPageSize/);
  assert.match(review, /promptBulkConfirm\(ids\.length/);
  assert.match(review, /v-for="row in pagedMergedReviews" :key="row\.key" class="admin-card"/);
  // 旧实现不得留在 AdminModules（否则等于第二个处置入口）
  assert.doesNotMatch(modules, /mergedPicked|pagedMergedReviews|admin\.reviewMergeSort/);
  const css = read('../frontend/src/styles/main.css');
  assert.match(css, /\.merged-detail-row/);
  assert.match(css, /\.merge-bar/);
});
// AZ（docs/ADMIN-REVIEW-LISTS.md §4.6）：规则摘要列精简——只显示首规则×n + 规则总数，全部规则进 hover 弹层。
test('AZ 批：规则摘要列只显示首规则 ×n · 共 N 条规则，全部规则在 el-popover，移动端同口径', () => {
  const review = read('../frontend/src/components/visitors/VisitorsReview.vue');
  const css = read('../frontend/src/components/visitors/visitors.css');
  // 列固定宽 + 单行省略（不再随规则数变长）
  assert.match(review, /label="规则摘要" width="168"/);
  assert.match(css, /\.rule-summary\{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/, '单行省略样式');
  // 首规则 + 规则总数：文案收进 ruleSummary()，表格与移动卡片两处都调用它
  assert.match(review, /function ruleSummary\(row\) \{[\s\S]*?共 \$\{row\.ruleCount\} 条规则/, '文案 = 首规则 ×n · 共 N 条规则');
  assert.ok((review.match(/\{\{ ruleSummary\(row\) \}\}/g) || []).length >= 2, '表格与移动卡片都调用 ruleSummary');
  assert.match(review, /const first = row\.rules\[0\];[\s\S]{0,80}\$\{first\.rule\} ×\$\{first\.n\}/, '首规则展示（ruleSummary 内）');
  // hover 弹层列出全部规则，单规则不弹（disabled）
  assert.match(review, /<el-popover[^>]*trigger="hover"[^>]*:disabled="!row\.rules \|\| row\.rules\.length <= 1"/);
  assert.match(review, /<div v-for="r in row\.rules" :key="r\.rule">\{\{ r\.rule \}\} ×\{\{ r\.n \}\}<\/div>/);
  // 旧的全量拼接已移除
  assert.doesNotMatch(review, /row\.rules\.map\(r=>r\.rule/, '移动端不再逐条拼接全部规则');
});
