// FZ 批（docs/VISITORS-REDESIGN.md §1~§7）：访问记录重设计的**前端静态契约**。
//
// 这份测试守的是「改回去就变红」的硬约束，不是"文件里有几个字"：
//   ① 左导航 7 块 + `?view=` 可直达/可后退（push 而非 replace）+ 移动端下拉；
//   ② 概览 6 张卡与 overview 接口一一对应、待审 >0 标红可点、30 秒自动刷新且仅页面可见时；
//   ③ **处置入口唯一**：行内四动作/批量三动作只在「异常处置」；访问分析与 IP 抽屉没有任何封禁/信任动作；
//   ④ IP 抽屉字段齐全 + 两条跳转（去异常处置 / 去 IP 封禁）；
//   ⑤ 访问分析默认 active 口径（排除已封禁+已信任，临时封保留）、明细同口径；
//   ⑥ 处置后行消失 + 5 秒撤销 + 回上一页 + 待审计数同步；
//   ⑦ 四类解封各在自己那页；解除临时封禁不删黑名单；状态词集中一个映射表；
//   ⑧ 移动端 375px：左导航下拉、抽屉全屏、卡片化；
// 以及 AdminModules 只保留挂载点（games 段不动）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  VISITOR_STATUS,
  VISITOR_STATUS_FILTERS,
  VISITOR_STATUS_ORDER,
  REVIEW_STATUS,
  abuseSourceLabel,
  banRemaining,
  visitorStatusLabel,
  visitorStatusText,
} from '../frontend/src/utils/visitorStatus.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const shell = read('../frontend/src/components/visitors/VisitorsAdmin.vue');
const overview = read('../frontend/src/components/visitors/VisitorsOverview.vue');
const review = read('../frontend/src/components/visitors/VisitorsReview.vue');
const analysis = read('../frontend/src/components/visitors/VisitorsAnalysis.vue');
const drawer = read('../frontend/src/components/visitors/IpDetailDrawer.vue');
const banIp = read('../frontend/src/components/visitors/VisitorsBanIp.vue');
const banDevice = read('../frontend/src/components/visitors/VisitorsBanDevice.vue');
const banTemp = read('../frontend/src/components/visitors/VisitorsBanTemp.vue');
const whitelist = read('../frontend/src/components/visitors/VisitorsWhitelist.vue');
const css = read('../frontend/src/components/visitors/visitors.css');
const composable = read('../frontend/src/composables/useVisitorsAdmin.js');
const modules = read('../frontend/src/pages/AdminModules.vue');

// ---------------------------------------------------------------- 状态词（§1 决策 13 / §3-5）
test('FZ：状态词集中一个映射表——五个 IP 状态 + 审核记录状态是两个维度', () => {
  assert.deepEqual(VISITOR_STATUS_ORDER, ['normal', 'intercepted', 'banned', 'blocked', 'trusted']);
  assert.deepEqual(
    VISITOR_STATUS_ORDER.map((s) => VISITOR_STATUS[s].label),
    ['正常', '被拦截', '临时封', '已封禁', '已信任'],
    '五个状态词与规格 §1 决策 13 逐字一致',
  );
  assert.equal(visitorStatusLabel('blocked'), '已封禁');
  assert.equal(visitorStatusLabel('banned'), '临时封');
  assert.equal(visitorStatusLabel('nope'), '未知', '未知状态有兜底文案，不显示 undefined');
  // 审核记录状态（第二维度）与 IP 状态分开
  assert.deepEqual(Object.keys(REVIEW_STATUS), ['pending', 'approved', 'rejected', 'auto_banned']);
  assert.equal(REVIEW_STATUS.pending.label, '待审');
  assert.equal(REVIEW_STATUS.approved.label, '已处置');
  assert.equal(REVIEW_STATUS.rejected.label, '已忽略');
  assert.equal(REVIEW_STATUS.auto_banned.label, '自动封禁');
  assert.equal(abuseSourceLabel('auto:path-probe'), '漏洞路径探测');
  assert.equal(abuseSourceLabel('manual:temp'), '人工临时封');
});

test('FZ：临时封显示剩余时间（分钟 / 小时 / 天三档，过期不显示）', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  assert.equal(banRemaining(new Date(now + 6 * 60_000).toISOString(), now), '剩余 6 分钟');
  assert.equal(banRemaining(new Date(now + 90 * 60_000).toISOString(), now), '剩余 1 小时 30 分钟');
  assert.equal(banRemaining(new Date(now + 26 * 3600_000).toISOString(), now), '剩余 1 天 2 小时');
  assert.equal(banRemaining(new Date(now - 60_000).toISOString(), now), '', '已过期不给「剩余」');
  assert.equal(banRemaining(null, now), '');
  assert.equal(visitorStatusText({ status: 'banned', ban_until: new Date(now + 6 * 60_000).toISOString() }, now), '临时封 · 剩余 6 分钟');
  assert.equal(visitorStatusText({ status: 'trusted' }, now), '已信任');
  // 状态筛选：默认有效访问 + 五态 + 全部
  assert.deepEqual(VISITOR_STATUS_FILTERS.map((f) => f.value), ['active', 'normal', 'intercepted', 'banned', 'blocked', 'trusted', 'all']);
  assert.equal(VISITOR_STATUS_FILTERS[0].label, '有效访问（默认）');
});

// ---------------------------------------------------------------- ① 左导航 7 块 + ?view=
test('FZ-1：左导航恰好七块（概览/异常处置/访问分析/IP 封禁/设备封禁/临时封禁/白名单）', () => {
  assert.deepEqual(
    [...composable.matchAll(/\{ id: '([a-z-]+)', icon/g)].map((m) => m[1]),
    ['overview', 'review', 'analysis', 'ban-ip', 'ban-device', 'ban-temp', 'whitelist'],
  );
  for (const label of ['概览', '异常处置', '访问分析', 'IP 封禁', '设备封禁', '临时封禁', '白名单']) {
    assert.ok(shell.includes(`label: '${label}'`) || composable.includes(`label: '${label}'`), `导航含「${label}」`);
  }
  assert.match(shell, /<aside class="vs-nav"[\s\S]*?v-for="item in VISITOR_VIEWS"/, '左侧导航按同一份七块清单渲染');
  // 旧「四个横 tab」已下线
  assert.doesNotMatch(shell + analysis + review, /visitorTabs|module-tabs/);
  assert.doesNotMatch(modules, /visitorTabs|visitorView/, 'AdminModules 不再有旧的访问记录横 tab 状态');
});

test('FZ-1：?view= 记录当前块——可直达、换块用 push（后退可回）', () => {
  assert.match(composable, /id 与 URL `\?view=` 一一对应/, '七块 id 与 URL 参数同源');
  assert.match(shell, /route\.query\.view/, '读 URL 的 view');
  assert.match(shell, /watch\(\(\) => route\.query\.view/, 'URL 变化 → 当前块跟着变（前进/后退可用）');
  assert.match(shell, /router\.push\(\{ path: route\.path, query: \{ \.\.\.route\.query, view: id \} \}\)/, '换块 push 进历史且保留其它 query');
  assert.match(shell, /VISITOR_VIEWS\.some\(\(v\) => v\.id === String\(route\.query\.view\)\)/, '直达未知 view 回落概览');
});

// ---------------------------------------------------------------- ② 概览
test('FZ-1：概览 6 张数字卡与 /api/admin/visitors/overview 一一对应，待审标红可点', () => {
  for (const key of ['today_requests', 'today_blocked', 'pending_reviews', 'temp_bans', 'blacklist', 'whitelist']) {
    assert.ok(overview.includes(key), `卡片绑定 ${key}`);
  }
  for (const label of ['今日请求', '被拦截', '待审异常', '临时封', 'IP 黑名单', '白名单']) {
    assert.ok(overview.includes(`label: '${label}'`), `卡片文案「${label}」`);
  }
  assert.match(overview, /hot: Number\(state\.overview\.pending_reviews\) > 0/, '待审 >0 标红');
  assert.match(overview, /view: 'review'/, '待审卡可点进异常处置');
  assert.match(overview, /requestView\(card\.view\)/, '点击换块');
  assert.match(css, /\.vs-kpi\.hot\{[^}]*var\(--danger\)/, '红卡样式（danger）');
  assert.match(composable, /\/api\/admin\/visitors\/overview/, '只走 overview 一个接口拿 6 个数');
});

test('FZ-1：概览 30 秒自动刷新，且只在页面可见时拉数', () => {
  assert.match(shell, /setInterval\(pollOverview, 30000\)/, '30 秒轮询');
  assert.match(shell, /document\.visibilityState !== 'visible'/, '不可见时不拉');
  assert.match(shell, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/, '切回前台立即补一次');
  assert.match(shell, /onBeforeUnmount\(\(\) => \{[\s\S]*?clearInterval\(overviewTimer\)/, '卸载清定时器');
});

// ---------------------------------------------------------------- ③ 处置入口唯一
test('FZ-2：异常处置是唯一处置入口——行内四动作 + 批量三动作', () => {
  assert.match(review, /actRow\(row, 'tempban', m\)/, '行内临时封');
  assert.match(review, /actRow\(row, 'permban'\)/, '行内永久封');
  assert.match(review, /actRow\(row, 'trust'\)/, '行内信任');
  assert.match(review, /actRow\(row, 'ignore'\)/, '行内忽略');
  for (const m of [10, 60, 1440]) assert.match(review, new RegExp(`:command="${m}"`), `临时封 ${m} 分钟`);
  assert.match(review, /runMergedBulk\('approve-ip'\)/, '批量封 IP');
  assert.match(review, /runMergedBulk\('approve-device'\)/, '批量封设备');
  assert.match(review, /runMergedBulk\('reject'\)/, '批量忽略');
  assert.match(review, /\/api\/admin\/reviews\/act/, '单条动作走既有 reviews/act');
  assert.match(review, /target: 'reviews', action: 'approve-ip'/, '永久封走既有批量 reviews 口径');
});

test('FZ-2：访问分析与 IP 抽屉没有封禁/信任动作（模板静态锁）', () => {
  const forbidden = ['actRow(', 'runMergedBulk(', 'reviewAct(', 'banIp(', 'addWhitelist(', '/api/admin/reviews/act', '/api/admin/bulk', "blacklist', { method: 'POST'", "whitelist', { method: 'POST'"];
  for (const [name, src] of [['访问分析', analysis], ['IP 抽屉', drawer]]) {
    for (const bad of forbidden) {
      assert.ok(!src.includes(bad), `${name} 不得出现处置调用：${bad}`);
    }
    for (const label of ['永久封', '临时封', '封禁 IP']) {
      assert.ok(!src.includes(`>${label}<`), `${name} 不得出现处置按钮「${label}」`);
    }
  }
  assert.match(analysis, /行内唯一动作：详情（只读抽屉）/, '分析行内只有详情');
  assert.doesNotMatch(banIp, /runMergedBulk|reviews\/act/, 'IP 封禁页只解封/添加，不处置');
  assert.doesNotMatch(banDevice, /reviews\/act|approve-device/, '设备封禁页只解封');
});

// ---------------------------------------------------------------- ④ IP 抽屉
test('FZ-2：IP 详情抽屉只读且字段齐全，给两条跳转', () => {
  for (const field of ['地区', '状态', '访问次数', '独立路径', '设备', '最近访问', '异常规则']) {
    assert.ok(drawer.includes(field), `抽屉含「${field}」`);
  }
  assert.match(drawer, /requestView\('review', target\)/, '有待审 → 去异常处置（并定位）');
  assert.match(drawer, /requestView\('ban-ip'\)/, '已封禁 → 去 IP 封禁');
  assert.match(drawer, /v-if="pendingCount"[^>]*去异常处置|<el-button v-if="pendingCount"[^>]*>去异常处置/, '按待审条件显示跳转');
  assert.match(drawer, /只读：封禁 \/ 信任 \/ 封设备只在「异常处置」操作/, '抽屉文案明确只读');
  assert.match(drawer, /:size="isMobile \? '100%' : '520px'"/, '移动端全屏抽屉');
  // 跨块复用：只挂一次（shell 里），各列表点 IP 都是 openIpDetail
  assert.equal((shell.match(/<IpDetailDrawer/g) || []).length, 1, '抽屉在 shell 挂一次（跨块复用）');
  for (const [name, src] of [['访问分析', analysis], ['异常处置', review], ['IP 封禁', banIp], ['临时封禁', banTemp], ['白名单', whitelist]]) {
    assert.match(src, /openIpDetail\(/, `${name} 点 IP 打开抽屉`);
  }
  assert.match(drawer, /filter\(\(r\) => r\.ip === target && r\.status === 'pending'\)/, '抽屉的待审规则按该 IP 过滤');
  assert.match(drawer, /location: 定位|去异常处置[\s\S]{0,200}定位|requestView\('review', target\)/, '定位交接给异常处置');
});

// ---------------------------------------------------------------- ⑤ 访问分析口径
test('FZ-2：访问分析只读、默认 active（排除已封禁+已信任，临时封保留）、明细同口径', () => {
  assert.match(analysis, /const status = ref\('active'\)/, '默认有效访问');
  assert.match(analysis, /VISITOR_STATUS_FILTERS/, '状态筛选来自集中映射表（含 active/trusted/all）');
  assert.match(analysis, /status: status\.value/, 'IP 统计与明细都把 status 传给接口');
  assert.match(analysis, /status: status\.value, sort: 'time', order: 'desc' \}\);\n\s*if \(q\.value\.trim\(\)\) qs\.set\('ip'/, '明细走 /api/admin/visitors（服务端同源口径）');
  assert.match(analysis, /status === 'active' && \(hidden\.blocked \|\| hidden\.trusted\)/, '显示「已隐藏 N 个已封禁 / M 个已信任」');
  for (const d of [1, 7, 30]) assert.match(analysis, new RegExp(`:value="${d}"`), `时间窗 ${d} 天`);
  assert.match(analysis, /for \(const key of Object\.keys\(ipDetails\)\) delete ipDetails\[key\]\s*;\s*\n\s*reload\(true\)/, '时间窗切换清空展开缓存');
  // 后端默认口径同步（否则前端默认 active 只是装饰）
  const routes = read('../src/routes/admin-access.js');
  assert.match(routes, /const status = \['active', 'normal', 'intercepted', 'banned', 'blocked', 'trusted', 'all'\]\.includes\(rawStatus\) \? rawStatus : 'active'/, 'by-ip 默认 active');
  assert.match(routes, /\? \(visitorStatuses\.includes\(rawStatus\) \? rawStatus : 'active'\)/, '明细默认 active');
});

// ---------------------------------------------------------------- ⑥ 处置后移出与撤销
test('FZ-2：处置后行消失 + 撤销 toast 5 秒 + 当前页空了回上一页 + 待审计数同步', () => {
  assert.match(review, /reviews\.value = reviews\.value\.filter\(\(r\) => \(r\.ip \|\| '\(空\)'\) !== row\.key\)/, '行从队列消失');
  assert.match(review, /bumpOverview\(\{ pending_reviews: -1 \}\)/, '待审数 -1');
  assert.match(review, /duration: 5000/, '撤销窗口 5 秒');
  assert.match(review, /'撤销'/, 'toast 带撤销');
  assert.match(review, /applyPendingDelta\(1\)/, '撤销后待审数回填');
  assert.match(review, /reviews\.value\.splice\(insertAt, 0, \.\.\.entry\.raw\)/, '撤销后行回原位');
  assert.match(review, /mergedPager\.page\.value -= 1/, '当前页空了回上一页');
  assert.match(review, /\/api\/admin\/blacklist\/\$\{encodeURIComponent\(ip\)\}`, \{ method: 'DELETE' \}/, '撤销 = 移出黑名单');
  assert.match(review, /\/api\/admin\/whitelist\/\$\{encodeURIComponent\(ip\)\}`, \{ method: 'DELETE' \}/, '信任撤销 = 移出白名单');
  assert.match(review, /\/api\/admin\/abuse\/\$\{encodeURIComponent\(ip\)\}`, \{ method: 'DELETE' \}/, '临时封撤销 = 清临时封');
});

// ---------------------------------------------------------------- ⑦ 四类解封各在自己那页
test('FZ-2：四类解封各在自己那页（IP / 设备 / 临时 / 白名单）', () => {
  assert.match(banIp, /admin\/blacklist\/\$\{encodeURIComponent\(row\.ip\)\}`, \{ method: 'DELETE' \}/, 'IP 封禁页解封');
  assert.match(banIp, /admin\/blacklist', \{ method: 'POST'/, 'IP 封禁页手动添加（含 CIDR 提示）');
  assert.match(banIp, /1\.2\.3\.0\/24/, '提示支持 CIDR');
  assert.match(banDevice, /admin\/device-bans\/\$\{encodeURIComponent\(row\.fingerprint\)\}`, \{ method: 'DELETE' \}/, '设备封禁页解封');
  assert.doesNotMatch(banDevice, /devices\/ban'/, '设备封禁页不提供封禁入口');
  assert.match(banTemp, /admin\/abuse\/\$\{encodeURIComponent\(ip\)\}`, \{ method: 'DELETE' \}/, '临时封禁页解除');
  assert.match(banTemp, /只解除自动临时封禁，不会移除 IP 黑名单/, '解除临时封禁不删黑名单（文案）');
  assert.match(banTemp, /只删除记录，不会移除 IP 黑名单/, '清除记录同样不动黑名单');
  assert.match(banTemp, /const abuseFilter = ref\('active'\)/, '默认只列生效中');
  assert.match(banTemp, /status=\$\{abuseFilter\.value\}/, '筛选透传接口');
  assert.match(whitelist, /admin\/whitelist\/\$\{encodeURIComponent\(row\.ip\)\}`, \{ method: 'DELETE' \}/, '白名单移除');
  assert.match(whitelist, /admin\/whitelist', \{ method: 'POST'/, '白名单添加');
  assert.match(whitelist, /加白自动移黑 \+ 清临时封禁/, '加白互斥口径文案');
  // 各页只用集中映射表，不再各写一套状态词
  for (const [name, src] of [['访问分析', analysis], ['IP 抽屉', drawer], ['临时封禁', banTemp]]) {
    assert.match(src, /from '\.\.\/\.\.\/utils\/visitorStatus\.js'/, `${name} 从集中映射表取文案`);
  }
  assert.doesNotMatch(analysis, /'已封禁':|'封禁中':|'被拦截':/, '分析不再自建状态词表');
  assert.doesNotMatch(modules, /abuseSourceLabel|row\.status==='banned'\?'封禁中'/, 'AdminModules 不再保留旧状态词实现');
});

// ---------------------------------------------------------------- ⑧ 移动端
test('FZ-2：375px 左导航变下拉、抽屉全屏、列表卡片化无横向溢出', () => {
  assert.match(shell, /class="vs-nav-mobile"/, '移动端下拉容器');
  assert.match(shell, /<el-select :model-value="activeView"[\s\S]{0,400}?@change="selectView"/, '下拉换块');
  assert.match(css, /@media\(max-width:760px\)\{[\s\S]*?\.vs-nav\{display:none\}/, '760 断点隐藏左导航');
  assert.match(css, /\.vs-nav-mobile\{display:block/, '760 断点显示下拉');
  assert.match(css, /\.vs-page \.admin-card \.el-button\{min-height:44px\}/, '卡片按钮触摸目标 ≥44px');
  for (const [name, src] of [['异常处置', review], ['访问分析', analysis], ['IP 封禁', banIp], ['设备封禁', banDevice], ['临时封禁', banTemp], ['白名单', whitelist]]) {
    assert.match(src, /class="game-card-list"/, `${name} 有移动卡片分支`);
    assert.match(src, /v-if="!isMobile"/, `${name} 桌面表格包在 !isMobile 内`);
  }
  assert.match(drawer, /:size="isMobile \? '100%' : '520px'"/, '抽屉移动端 100%');
  assert.match(css, /\.vs-toolbar > \.el-input\{flex:1 1 100%/, '移动端工具栏不撑破');
});

// ---------------------------------------------------------------- AdminModules 边界
test('FZ：AdminModules 只剩挂载点——games 段与旧 visitors 段互不影响', () => {
  assert.match(modules, /<template v-else-if="section==='visitors'"><VisitorsAdmin \/><\/template>/, 'visitors 段只挂新组件');
  assert.match(modules, /import VisitorsAdmin from '\.\.\/components\/visitors\/VisitorsAdmin\.vue'/, '按需引入');
  // 旧访问记录实现已移出（不留下第二个处置入口）
  for (const gone of ['loadVisitorView', 'sel.visitors', 'mergedPicked', 'blacklistBulkActions', 'abuseBulkActions', 'openBulkDeviceBan', 'visitorSummary']) {
    assert.ok(!modules.includes(gone), `AdminModules 不得残留 ${gone}`);
  }
  // games 段（GA 批另一工人负责）保持原样：本次只读不动
  assert.match(modules, /section==='games'/, 'games 段仍在');
  assert.match(modules, /gameView=ref\('directory'\)/, '游戏目录状态未动');
});
