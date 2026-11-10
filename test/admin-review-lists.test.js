// AQ/AR 批（docs/ADMIN-REVIEW-LISTS.md §3/§4）：列表排序与按 IP 合并的接线、白名单与上限。
// 守：① 排序参数走白名单、不把用户输入拼进 SQL；② 两个列表接上排序、待审上限 500；③ 合并视图聚合与批量处置接上。
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
  const server = read('../src/server.js');
  assert.match(server, /\[['"]time['"], ['"]ip['"], ['"]status['"]\]\.includes\(rawSort\)/);
  assert.match(server, /listVisitorLogs\(q, \{[^}]*sort, order/);
});

test('待审列表上限 500（前端不传 limit 也拿满）', () => {
  const pg = read('../src/store/pg.js');
  assert.match(pg, /Math\.min\(Math\.max\(Number\(limit\) \|\| 500, 1\), 500\)/);
  const server = read('../src/server.js');
  assert.match(server, /'limit'\) \?\? 500/);
});

test('前端排序接线：访问明细（表头 + 持久化 + 数值 IP + 服务端参数）与合并视图排序', () => {
  const vue = read('../frontend/src/pages/AdminModules.vue');
  assert.match(vue, /prop="ip" sortable="custom"/);
  assert.match(vue, /prop="ruleCount" sortable="custom"/);
  assert.match(vue, /prop="hitsTotal" sortable="custom"/);
  assert.match(vue, /prop="last_seen" sortable="custom"/);
  assert.match(vue, /admin\.reviewMergeSort/);
  assert.match(vue, /function onMergedSortChange/);
  assert.match(vue, /compareIp\(a\.ip, b\.ip\)/);
  assert.match(vue, /admin\.visitorSort/);
  assert.match(vue, /function visitorSortParams\(\)/);
  assert.match(vue, /\.\.\.visitorSortParams\(\)/);
  assert.match(vue, /visitorSort\.value = prop && order/);
});

test('AX 批：合并视图默认且唯一——无开关、无合并 localStorage 键、无明细表；聚合/批量处置/移动卡片保留', () => {
  const vue = read('../frontend/src/pages/AdminModules.vue');
  // 修订口径（§4.5）：不再有开关与 admin.reviewMerge（合并视图排序键 admin.reviewMergeSort 仍保留）
  assert.doesNotMatch(vue, /active-text="按 IP 合并"/);
  assert.doesNotMatch(vue, /admin\.reviewMerge(?!Sort)/);
  assert.doesNotMatch(vue, /pagedReviews|reviewAction|ignoreReview|sel\.reviews/);
  // 默认渲染合并视图：标题说明 + 合并表 + 聚合逻辑 + 批量处置 + 移动卡片 + 分页
  assert.match(vue, /同一 IP 合并为一行，展开看逐条规则/);
  assert.match(vue, /ref="mergedReviewsTable"/);
  assert.match(vue, /const mergedPicked = ref/);
  assert.match(vue, /function runMergedBulk/);
  assert.match(vue, /async function mergedAct/);
  assert.match(vue, /ruleMap\.set\(r\.rule/);
  assert.match(vue, /pendingIds: pending\.map/);
  assert.match(vue, /部分已处理/);
  assert.match(vue, /已选 {{ mergedPicked\.size }} 个 IP/);
  assert.match(vue, /mergedPageSize/);
  assert.match(vue, /promptBulkConfirm\(ids\.length/);
  assert.match(vue, /v-for="row in pagedMergedReviews" :key="row\.key" class="admin-card"/);
  const css = read('../frontend/src/styles/main.css');
  assert.match(css, /\.merged-detail-row/);
  assert.match(css, /\.merge-bar/);
});
