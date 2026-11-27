// CF 批（docs/ADMIN-UX-SECURITY.md §2/§4）：后台体验与安全静态契约——
// 申诉筛选行/Steam 账号 v-else 修复/指标折叠/审核四操作/未封禁申诉提示。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONT = join(process.cwd(), 'frontend', 'src');
const appeals = readFileSync(join(FRONT, 'components', 'AppealsAdmin.vue'), 'utf8');
const extras = readFileSync(join(FRONT, 'pages', 'AdminExtras.vue'), 'utf8');
const modules = readFileSync(join(FRONT, 'pages', 'AdminModules.vue'), 'utf8');
const appealPage = readFileSync(join(FRONT, 'pages', 'AppealPage.vue'), 'utf8');
const adminUi = readFileSync(join(FRONT, 'admin-ui.js'), 'utf8');
const settings = readFileSync(join(process.cwd(), 'src', 'settings.js'), 'utf8');

test('CF 图一：申诉管理筛选行左分段右刷新 + 邮件处理说明', () => {
  assert.match(appeals, /appeal-filter-row/, '筛选行容器');
  assert.match(appeals, /邮件处理说明/, '标题区只留说明 + 邮件处理说明入口');
  assert.match(appeals, /appeal-filter-row[\s\S]{0,1500}?待处理/, '左侧分段');
  assert.match(appeals, /appeal-filter-row[\s\S]{0,1500}?刷新/, '右侧刷新');
  assert.ok(!/card-heading[\s\S]{0,400}?刷新/.test(appeals), '标题区不再放刷新按钮');
});

test('CF 图二：Steam 账号移动卡片分支改为 v-else-if="isMobile"，桌面不再重复', () => {
  assert.match(extras, /<template v-else-if="isMobile">\s*<el-empty v-if="!steamAccounts\.length"/, 'v-else 挂到 v-else-if="isMobile"');
  // 桌面游戏库展开区仍是 v-if="!isMobile…"，卡片分支只在移动端
  assert.match(extras, /v-if="!isMobile && activeAccount && libraryGames\.length"/, '桌面游戏库展开区');
  const after = extras.match(/v-if="!isMobile && activeAccount && libraryGames\.length"[\s\S]{0,3000}?<template v-else-if="isMobile">/);
  assert.ok(after, '移动卡片紧跟桌面游戏库分支之后');
});

test('CF 图三：游戏管理 4 主指标 + 更多指标折叠（10 项 chips；FG 移除成人/成熟分级筛选 chip）', () => {
  const main = modules.match(/<div class="metric-grid clickable-grid">([\s\S]*?)<\/div><details class="more-metrics">/)?.[1] ?? '';
  for (const label of ['目录游戏', '已同步', '有报价', '待回填']) {
    assert.ok(main.includes(label), `主指标含「${label}」`);
  }
  assert.ok(!main.includes('未探测'), '未探测不在主指标');
  assert.match(modules, /<details class="more-metrics"><summary>更多指标（10）/, '更多指标折叠区（10 项）');
  for (const label of ['未探测', '免费', '未发售', '锁国区', '国区无价', '国区不可售', '其他', '已删除', '已排除', '跳过中']) {
    assert.ok(modules.includes(label), `折叠区含「${label}」`);
  }
  // FG（docs/REMOVE-18R-ENTRY.md）：成人/成熟点击筛选 chip 已移除——数字改由
  // 「同步与回填」页「内容分级统计」卡片（FH）只读展示，不再作为列表筛选入口
  assert.doesNotMatch(modules, /clickMetric\('adult'\)/, '无成人点击筛选 chip');
  assert.doesNotMatch(modules, /clickMetric\('mature'\)/, '无成熟点击筛选 chip');
  assert.match(modules, /\.metric-chips/, 'chips 样式存在');
});

test('CF 审核四操作：临时封（10min/1h/1d）/永久封/信任/忽略 + 证据字段', () => {
  // FZ 批（docs/VISITORS-REDESIGN.md）：审核四操作搬到「异常处置」组件（行内四动作），
  // 来源标签搬到 utils/visitorStatus.js 集中映射表；断言语义不变。
  const review = readFileSync(join(FRONT, 'components', 'visitors', 'VisitorsReview.vue'), 'utf8');
  const banTemp = readFileSync(join(FRONT, 'components', 'visitors', 'VisitorsBanTemp.vue'), 'utf8');
  const status = readFileSync(join(FRONT, 'utils', 'visitorStatus.js'), 'utf8');
  assert.match(review, /actRow\(row, 'tempban', m\)/, '临时封下拉');
  assert.match(review, /:command="10"/, '10 分钟');
  assert.match(review, /:command="60"/, '1 小时');
  assert.match(review, /:command="1440"/, '1 天');
  assert.match(review, /actRow\(row, 'permban'\)/, '永久封');
  assert.match(review, /actRow\(row, 'trust'\)/, '信任');
  assert.match(review, /actRow\(row, 'ignore'\)/, '忽略');
  assert.match(review, /r\.region/, '地区证据');
  assert.match(review, /r\.last_ua/, 'UA 证据');
  assert.match(review, /r\.appeal_status/, '申诉状态证据');
  assert.match(adminUi, /ElDropdown/, 'ElDropdown 注册（三处：import/样式/use）');
  assert.match(adminUi, /dropdown-menu\/style\/css/, 'dropdown 样式');
  assert.match(status, /abuseSourceLabel/, '自动封禁来源标签集中在 visitorStatus.js');
  assert.match(status, /'auto:path-probe': '漏洞路径探测'/, '漏洞路径探测来源');
  assert.match(status, /'auto:credential': '登录凭据爆破'/, '凭据爆破来源');
  assert.match(status, /'auto:extreme-rate': '极端频率'/, '极端频率来源');
  assert.match(status, /'auto:ua-list': '异常 UA 名单'/, '异常 UA 来源');
  assert.match(banTemp, /abuseSourceLabel\(row\.ban_source\)/, '临时封禁页用集中来源标签');
});

test('CF 申诉可见性：未封禁只提示不展示表单；后端校验封禁上下文', () => {
  assert.match(appealPage, /当前未被封禁，无需申诉/, '未封禁提示');
  assert.match(appealPage, /api\/ban\/state/, '挂载查封禁状态');
  // CO-4/B4 第二轮：提交接口已抽到 src/routes/appeal.js——「未封禁 400」校验随路由移入新文件
  const server = readFileSync(join(process.cwd(), 'src', 'server.js'), 'utf8');
  const appealRoutes = readFileSync(join(process.cwd(), 'src', 'routes', 'appeal.js'), 'utf8');
  assert.match(appealRoutes, /当前未被封禁，无需申诉/, '提交接口校验封禁上下文（落 routes/appeal.js）');
  assert.match(appealRoutes, /path === '\/api\/appeal' && req\.method === 'POST'/, '校验所在的是提交分支');
  assert.ok(!/BAN_ONLY_PAGES = new Set\(\[[^\]]*'\/appeal'/.test(server), '/appeal 移出仅封禁可见页');
});

test('CF 设置：security.autoBan.* 8 项入 settings def', () => {
  for (const key of ['security.autoBan.mode', 'security.autoBan.pathDistinctMax', 'security.autoBan.pathWindowSec', 'security.autoBan.credentialIpMax', 'security.autoBan.extremeMultiplier', 'security.autoBan.extremeWindows', 'security.autoBan.uaPatterns', 'security.autoBan.banLadderMin']) {
    assert.ok(settings.includes(`'${key}'`), `设置项 ${key}`);
  }
  assert.match(settings, /SECURITY_AUTOBAN_MODE/, 'env 映射');
});
