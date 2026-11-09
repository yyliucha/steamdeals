// AQ 批（docs/ADMIN-REVIEW-LISTS.md §3）：列表排序的接线与上限。
// 守两件事：① 排序参数走白名单、不把用户输入拼进 SQL；② 两个列表确实接上了排序、待审上限是 500。
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

test('前端两个列表都接上了排序（表头 + 持久化 + 数值 IP + 服务端参数）', () => {
  const vue = read('../frontend/src/pages/AdminModules.vue');
  // 异常审核（客户端）：四列可排 + 默认最近出现 + localStorage
  assert.match(vue, /prop="last_seen" sortable="custom"/);
  assert.match(vue, /prop="ip" sortable="custom"/);
  assert.match(vue, /prop="hits" sortable="custom"/);
  assert.match(vue, /prop="rule" sortable="custom"/);
  assert.match(vue, /admin\.reviewSort/);
  assert.match(vue, /compareIp\(a\.ip, b\.ip\)/);
  // 访问明细（服务端）：三列可排 + sort/order 参数
  assert.match(vue, /admin\.visitorSort/);
  assert.match(vue, /function visitorSortParams\(\)/);
  assert.match(vue, /\.\.\.visitorSortParams\(\)/);
  assert.match(vue, /visitorSort\.value = prop && order/);
});

