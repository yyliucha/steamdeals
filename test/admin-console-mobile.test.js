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

test('BW：级联修复——旧 ≤760 压缩规则不得命中 ☰ 抽屉与顶栏（QA 第 1 轮打回回归锁）', () => {
  // 抽屉内恢复分组标题 / 纵向导航 / 底部账号区（旧规则 .nav-heading{display:none} 等不能命中抽屉）
  assert.match(mainCss, /\.m-nav-drawer \.admin-nav\{flex-direction:column/, '抽屉导航保持纵向');
  assert.match(mainCss, /\.m-nav-drawer \.nav-heading\{display:block\}/, '抽屉分组标题可见');
  assert.match(mainCss, /\.m-nav-drawer \.admin-bottom\{display:flex\}/, '抽屉底部账号/返回网站可见');
  assert.match(mainCss, /\.m-nav-drawer \.admin-nav button\{width:100%/, '抽屉按钮恢复全宽');
  // 顶栏通知铃不被旧规则 .header-actions .el-button:first-child{display:none} 隐藏
  assert.match(consoleVue, /m-bell/, '通知铃带专属 class');
  assert.match(mainCss, /\.m-shell \.header-actions \.el-button\.m-bell\{display:inline-flex\}/, '通知铃强制可见');
  // 断点统一：BW 新增组件用 768
  assert.match(extras, /max-width: 768px/, 'AdminExtras 断点 768');
  assert.match(logs, /max-width: 768px/, 'AdminLogs 断点 768');
});

// ---------------------------------------------------------------- EP 批（docs/TODO.md EP）
// 后台其余列表手机端卡片化：任务健康/价格变化/浏览排行/图片覆盖缺图 + 未归属 Steam 账号 + 对齐审核，
// 统一 `<template v-if="!isMobile">表格</template><div v-else class="game-card-list">…admin-card…</div>`；
// 桌面表格不动，操作按钮全部保留（含勾选/批量/确认/忽略/恢复），触摸目标 ≥44px。
const modules = readFileSync(ROOT + 'frontend/src/pages/AdminModules.vue', 'utf8');
const align = readFileSync(ROOT + 'frontend/src/components/AlignAdmin.vue', 'utf8');
const userSections = readFileSync(ROOT + 'frontend/src/pages/UserSections.vue', 'utf8');
const appeals = readFileSync(ROOT + 'frontend/src/components/AppealsAdmin.vue', 'utf8');

test('EP：AdminModules 任务健康/价格变化/浏览排行/缺图列表都有手机卡片分支（桌面表格保留）', () => {
  for (const [name, dataExpr, cardVFor] of [
    ['任务健康', 'taskRows', 'v-for="row in taskRows"'],
    ['价格变化', 'priceRows', 'v-for="row in priceRows"'],
    ['浏览排行', 'viewRowsPage', 'v-for="(row, i) in viewRowsPage"'],
    ['图片覆盖缺图', 'coverage.list.items', 'v-for="row in coverage.list.items"'],
  ]) {
    assert.ok(
      modules.includes(`<template v-if="!isMobile"><el-table :data="${dataExpr}"`),
      `${name}：桌面表格包在 v-if="!isMobile" 内（桌面行为不变）`,
    );
    assert.ok(modules.includes(`${cardVFor} `) || modules.includes(cardVFor), `${name}：卡片按同一数据源渲染`);
    assert.match(modules, new RegExp(`${cardVFor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^]{0,240}?class="admin-card"`), `${name}：卡片用既有 .admin-card 结构`);
  }
  // EP 前 9 个分支（游戏/访问/待审/设备/黑白名单/自动封禁）+ EP 新增 4 个 = ≥13。
  // FZ 批（docs/VISITORS-REDESIGN.md）：访问记录七块搬到 components/visitors/*，卡片分支数与
  // 「页面是否卡片化」一起统计（拆文件不改行为，总量不得下降）。
  const visitorSources = ['VisitorsReview', 'VisitorsAnalysis', 'VisitorsBanIp', 'VisitorsBanDevice', 'VisitorsBanTemp', 'VisitorsWhitelist']
    .map((n) => readFileSync(`${ROOT}frontend/src/components/visitors/${n}.vue`, 'utf8'));
  const branches = (modules.match(/v-else class="game-card-list"/g) || []).length
    + visitorSources.reduce((sum, src) => sum + (src.match(/v-else class="game-card-list"/g) || []).length, 0);
  assert.ok(branches >= 13, `后台列表卡片分支 ≥13（实际 ${branches}）`);
  // 断点统一到 760（旧代码在 onMounted 里另挂了 720 监听，旋转后会在 720–760 之间跳回表格）
  assert.match(modules, /matchMedia\('\(max-width: 760px\)'\)/, 'isMobile 断点 760');
  assert.match(modules, /mobileQuery\.addEventListener\('change',onMobileChange\)/, '断点变化监听 760（不另挂 720）');
  assert.ok(!modules.includes("matchMedia('(max-width: 720px)')"), '不得残留 720 监听');
});

test('EP：未归属 Steam 账号手机端可认领（原 v-if 只给桌面，手机看不到）', () => {
  assert.ok(!extras.includes('v-if="!isMobile && unownedAccounts.length"'), '容器不再整体排除手机');
  assert.match(extras, /v-if="unownedAccounts\.length"[^>]*class="module-card table-card"/, '容器两种宽度都渲染');
  assert.ok(
    extras.includes('<template v-if="!isMobile"><div class="table-scroll"><el-table :data="unownedAccounts"'),
    '桌面表格保留 v-if="!isMobile"',
  );
  assert.match(extras, /v-for="row in unownedAccounts"[^]{0,240}?class="admin-card"/, '手机卡片分支');
  assert.match(extras, /v-for="row in unownedAccounts"[^]{0,600}?claimSteam\(row\)/, '卡片内保留认领操作');
});

test('EP：对齐审核队列/已忽略两个视图都有手机卡片，勾选与操作不丢', () => {
  assert.match(align, /matchMedia\('\(max-width: 760px\)'\)/, '对齐审核断点 760');
  assert.ok(align.includes('<div class="module-card table-card align-card" v-loading="loading"><template v-if="!isMobile">'), '两个桌面表格包进 v-if="!isMobile"');
  assert.match(align, /v-else class="game-card-list"/, '手机卡片容器');
  assert.match(align, /v-for="row in pagedRows"[^]{0,240}?class="admin-card"/, '队列卡片');
  assert.match(align, /v-for="row in ignored\.rows"[^]{0,240}?class="admin-card"/, '已忽略卡片');
  for (const fn of ['openConfirm(row)', 'openSearch(row)', 'ignoreGroup(row)', 'openHistory(row)', 'restoreIgnored(row)']) {
    assert.ok(align.includes(fn), `卡片保留操作 ${fn}`);
  }
  assert.match(align, /togglePickRow/, '卡片勾选（不依赖桌面表格 ref，批量确认/忽略仍可用）');
  assert.match(align, /isPicked\(row\)/, '卡片勾选回显');
  // 桌面表格的 expand 明细在卡片里换成行内展开（SKU 链接 + 全部候选），操作不丢
  assert.match(align, /toggleCardDetail/, '卡片「明细」行内展开');
  assert.match(align, /isCardOpen\(row\)/, '明细展开状态回显');
  assert.ok(align.includes('align-card-detail'), '明细详情块存在');
  assert.match(align, /align-detail-cands/, '明细里保留候选列表');
});

test('EP：卡片操作按钮触摸目标 ≥44px（全部已卡片化后台页统一）', () => {
  for (const [name, src] of [
    ['AdminModules', modules],
    ['AdminExtras', extras],
    ['AdminLogs', logs],
    ['UserSections', userSections],
    ['AlignAdmin', align],
    ['AppealsAdmin', appeals],
  ]) {
    const compact = src.replace(/\s+/g, '');
    assert.ok(
      compact.includes('@media(max-width:760px){.admin-card.el-button{min-height:44px;}}'),
      `${name}：卡片内按钮 ≥44px`,
    );
  }
  // FZ 批：访问记录七块共用一份 visitors.css（.vs-page 作用域），760 断点下卡片按钮同样 ≥44px
  const visitorsCss = readFileSync(`${ROOT}frontend/src/components/visitors/visitors.css`, 'utf8').replace(/\s+/g, '');
  assert.ok(visitorsCss.includes('.vs-page.admin-card.el-button{min-height:44px}'), '访问记录七块：卡片内按钮 ≥44px');
});

test('EP：控制台普通用户列表（会话/到价提醒/愿望单）既有卡片分支不回归', () => {
  const branches = (userSections.match(/v-else class="game-card-list"/g) || []).length;
  assert.ok(branches >= 3, `UserSections 三个列表卡片分支（实际 ${branches}）`);
  for (const anchor of ['v-for="s in sessions"', 'v-for="w in watches"', 'v-for="w in wishItems"']) {
    assert.ok(userSections.includes(anchor), `卡片循环存在：${anchor}`);
  }
});
