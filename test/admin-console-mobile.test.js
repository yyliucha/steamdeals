// BW 批（docs/MOBILE-REDESIGN.md §5）：后台移动端重设计的前端静态断言——
// ≤768px 侧栏收进 ☰ 抽屉（5 分组 13 模块沿用）；用户/回收站/Steam/会话/操作日志表格改卡片
// （桌面表格保留 v-if="!isMobile"）；批量条吸底；危险操作确认沿用；桌面端不变。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const consoleVue = readFileSync(ROOT + 'frontend/src/pages/Console.vue', 'utf8');
const extras = readFileSync(ROOT + 'frontend/src/pages/AdminExtras.vue', 'utf8');
const logs = readFileSync(ROOT + 'frontend/src/pages/AdminLogs.vue', 'utf8');
const mainCss = readFileSync(ROOT + 'frontend/src/styles/main.css', 'utf8');

test('BW：Console.vue 手机端 ☰ 抽屉导航（768 断点、13 模块沿用、顶栏通知铃）', () => {
  assert.match(consoleVue, /navDrawer=ref\(false\)/, '抽屉开关状态');
  assert.match(consoleVue, /matchMedia\('\(max-width: 768px\)'\)/, '移动断点 768');
  assert.match(consoleVue, /m-nav-drawer/, '☰ 抽屉容器');
  assert.match(consoleVue, /m-menu-btn/, '顶栏 ☰ 按钮');
  assert.match(consoleVue, /m-shell/, '移动 shell class');
  assert.match(consoleVue, /goAnnouncements/, '顶栏通知铃入口（站点通知模块）');
  // 抽屉与桌面侧栏共用同一份分组渲染（5 分组 13 模块沿用，非新清单）
  const groupDefs = (consoleVue.match(/items:\[/g) || []).length;
  assert.ok(groupDefs >= 5, `分组定义仍在（${groupDefs} 组）`);
});

test('BW：AdminExtras 用户/回收站/Steam/会话——桌面表格 v-if 保留 + 手机卡片分支', () => {
  for (const anchor of ['sel.users.count', 'sel.recycle.count', 'sel.sessions.count']) {
    assert.match(extras, new RegExp(`v-if="!isMobile" class="module-card table-card"><BulkBar :count="${anchor.replace(/\./g, '\\.')}"`), `${anchor} 桌面表格保留 v-if="!isMobile"`);
  }
  assert.match(extras, /sel\.users\.has\(u\)/, '用户卡片复选框');
  assert.match(extras, /sel\.recycle\.has\(g\)/, '回收站卡片复选框');
  assert.match(extras, /sel\.sessions\.has\(s\)/, '会话卡片复选框');
  assert.match(extras, /steamAccounts[\s\S]*?admin-card/, 'Steam 账号卡片分支');
  assert.match(extras, /unownedAccounts[\s\S]*?claimSteam\(a\)/, '未归属账号认领卡片');
  assert.match(extras, /pagedSteamGames[\s\S]*?admin-card/, '游戏库卡片分支');
  // 桌面表格仍在（移动端分支不删除桌面列）
  assert.match(extras, /<el-table ref="usersTable"/, '桌面用户表格保留');
  assert.match(extras, /<el-table ref="sessTable"/, '桌面会话表格保留');
});

test('BW：AdminLogs 五个 tab 的表格都有手机卡片分支（日志行点击展开保留）', () => {
  for (const anchor of ['pagedDeletions', 'bulkOps', 'pagedSteamLogs', 'pagedMailRecords', 'mailLogEntries', 'visibleRuns']) {
    assert.match(logs, new RegExp(`v-else class="game-card-list"[\\s\\S]*?${anchor}`), `${anchor} 手机卡片分支`);
  }
  assert.match(logs, /toggleLogExpanded/, '日志行点击展开详情保留');
  assert.match(logs, /v-if="!isMobile"/, '桌面表格分支保留');
});

test('BW：批量条吸底 + 安全区避让（main.css）', () => {
  assert.match(mainCss, /\.m-shell \.bulk-bar\{position:sticky;bottom:/, '批量条吸底');
  assert.match(mainCss, /env\(safe-area-inset-bottom\)/, '安全区避让');
  assert.match(mainCss, /\.m-shell\{grid-template-columns:1fr\}/, '移动 shell 单列');
});
