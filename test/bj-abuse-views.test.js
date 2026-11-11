// BJ 批（docs/BAN-AND-SECURITY-FIXES.md §10.6 验收 2/4/12）前端静态断言：
// 自动封禁区块的筛选、状态列、「已在黑名单」标注、按钮文案、确认框口径。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../frontend/src/pages/AdminModules.vue', import.meta.url)), 'utf8');

test('BJ：自动封禁筛选（生效中=默认/已过期/全部）与状态列', () => {
  assert.match(src, /const abuseFilter=ref\('active'\)/, '默认只列生效中');
  assert.match(src, /label="已过期" value="expired"/, '已过期筛选存在');
  assert.match(src, /label="全部" value="all"/, '全部筛选存在');
  assert.match(src, /status=\$\{abuseFilter\.value\}/, 'loadSecurity 把筛选透传给接口');
  assert.match(src, /生效中<\/el-tag><el-tag v-else-if="row\.banned_until" type="info" size="small">已过期/, '状态列：生效中/已过期');
  assert.match(src, /仅计数<\/el-tag>/, '状态列：仅计数');
});

test('BJ：「已在黑名单」标注含 CIDR 条目与备注（hover 提示）', () => {
  assert.match(src, /row\.in_blacklist/, '行级标注字段');
  assert.match(src, /blacklist_entry\|\|row\.ip/, 'hover 显示命中的黑名单条目（含 CIDR）');
  assert.match(src, /blacklist_note/, 'hover 显示备注');
  assert.match(src, />已在黑名单<\/el-tag>/, '标注 tag 文案');
});

test('BJ：解封粒度文案——自动封禁只清 ip_abuse，黑名单解封不恢复自动封禁', () => {
  assert.match(src, /只解除自动临时封禁，不会移除 IP 黑名单/, '自动封禁解除确认框口径');
  assert.match(src, /只删除记录，不会移除 IP 黑名单/, '清除记录确认框口径');
  assert.match(src, /该操作不会恢复该 IP 的自动封禁记录/, '黑名单解封确认框口径');
  assert.match(src, /解除临时封禁/, '批量按钮文案（不再叫解封）');
  assert.match(src, /row\.active\?'解除封禁':'清除记录'/, '行内按钮按状态切换文案');
});
