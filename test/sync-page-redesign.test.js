// GA-1（docs/SYNC-PAGE-REDESIGN.md §2 / §3 / §7-1~4）：游戏管理拆分 + 同步与回填页重设计的静态锁与真渲染断言。
//
// 四组断言：
//   ① 菜单拆三项：内容运营组出现 游戏目录 / 同步与回填 / 对齐审核（图标与描述按 demo），
//      三者都是一级 section，游戏管理不再有内部 tab；
//   ② 页结构：概览 4 卡 → 任务组表（主区）→ 折叠「数据质量」→ 折叠「工具」；模板里**不再有**旧页平铺的
//      10 个区块（adult-stats-card / app-version-card / 独立「任务健康」块）；
//   ③ 交互接线：概览卡定位失败组、组行展开、立即运行置「已提交」+ toast、告警收表头、折叠摘要、
//      手动任务组（不进调度器）；
//   ④ 移动端 ≤980px：概览 2 列、任务组行两行、子步骤表横向滚动（≤768 的控制台导航由 BW 批的 ☰ 抽屉承担）。
//
// ⑤ 真渲染（Vite SSR + @vue/server-renderer，与 secret-reveal / settings-immediate-save 同一套办法）：
//      按假数据渲染 SyncAdmin，断言 4 张概览卡的**数字**、12 组组行、手动组 4 行、告警条、折叠摘要、
//      以及「已提交」态按钮置灰——纯静态 grep 拿不到这些。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (rel) => readFileSync(`${ROOT}${rel}`, 'utf8');

const consoleVue = read('frontend/src/pages/Console.vue');
const modules = read('frontend/src/pages/AdminModules.vue');
const syncAdmin = read('frontend/src/components/sync/SyncAdmin.vue');
const kpiBar = read('frontend/src/components/sync/SyncKpiBar.vue');
const taskTable = read('frontend/src/components/sync/TaskGroupTable.vue');
const foldVue = read('frontend/src/components/sync/SyncFold.vue');
const quality = read('frontend/src/components/sync/SyncQualityPanel.vue');
const tools = read('frontend/src/components/sync/SyncToolsPanel.vue');
const css = read('frontend/src/components/sync/sync.css');
const composable = read('frontend/src/composables/useSyncAdmin.js');

// 模板段（去掉 <style>，静态锁只看模板——样式里的历史选择器不算「页面上还平铺着这些块」）
const templateOf = (src) => src.slice(0, src.indexOf('</template>'));

// ---------------------------------------------------------------- ① 菜单拆三项（验收 1）

test('GA-1 验收 1：内容运营组出现三项一级菜单（游戏目录 / 同步与回填 / 对齐审核），图标与描述按 demo', () => {
  assert.match(consoleVue, /id:'games',label:'游戏目录',glyph:'🎮'/, '游戏目录（🎮）');
  assert.match(consoleVue, /id:'sync',label:'同步与回填',glyph:'🔄'/, '同步与回填（🔄）');
  assert.match(consoleVue, /id:'align',label:'对齐审核',glyph:'🧩'/, '对齐审核（🧩）');
  // 三项都在「内容运营」组里（组内顺序：游戏目录 → 同步与回填 → 对齐审核）
  const group = consoleVue.match(/name:'内容运营',items:\[(.*?)\]\}/s)?.[1] ?? '';
  assert.ok(group.includes("id:'games'") && group.includes("id:'sync'") && group.includes("id:'align'"), '三项都在内容运营组');
  assert.ok(group.indexOf("id:'games'") < group.indexOf("id:'sync'") && group.indexOf("id:'sync'") < group.indexOf("id:'align'"), '组内顺序与 demo 一致');
  // 不再是「游戏管理」一项 + 内部 tab
  assert.ok(!consoleVue.includes("label:'游戏管理'"), '「游戏管理」菜单项已拆掉');
  // 同步/对齐是一级 section：走 AdminModules 而不是 AdminExtras
  assert.match(consoleVue, /const nativeSections=\['games','sync','align'/, 'nativeSections 含 sync / align');
  // `sync` 曾是旧书签别名（→ 操作日志 run tab），GA-1 起是真正的一级菜单，映射必须删掉
  assert.ok(!/sync:\s*\{\s*section:\s*'op-logs'/.test(consoleVue), 'LEGACY_SECTION 不再把 ?section=sync 映射到操作日志');
  assert.match(consoleVue, /const LEGACY_SECTION = \{ 'bulk-ops'/, 'bulk-ops 旧书签映射仍保留');
});

test('GA-1 验收 1：AdminModules 按 section 分派 games / sync / align，游戏管理不再有内部 tab', () => {
  assert.match(modules, /<template v-else-if="section==='sync'"><SyncAdmin \/><\/template>/, 'section=sync 渲染 SyncAdmin');
  assert.match(modules, /<template v-else-if="section==='align'"><AlignAdmin \/><\/template>/, 'section=align 渲染 AlignAdmin');
  assert.match(modules, /import SyncAdmin from '\.\.\/components\/sync\/SyncAdmin\.vue'/, '同步页组件挂载');
  // 游戏管理段不再有内部 tab（.module-tabs 样式保留——统计页的价格变化/浏览排行仍用它）
  assert.ok(!modules.includes("gameView==='directory'"), '游戏管理页内 tab（gameView）已删除');
  assert.ok(!modules.includes('gameView'), 'gameView 三态已取消');
  const gamesBlock = modules.slice(modules.indexOf("section==='games'"), modules.indexOf("section==='sync'"));
  assert.ok(!gamesBlock.includes('module-tabs'), '游戏目录段内没有 tab');
  // 游戏目录段仍在（拆菜单不等于删功能）
  assert.match(modules, /<template v-if="section==='games'">/, '游戏目录段保留');
});

// ---------------------------------------------------------------- ② 页结构 + 旧布局删除（验收 2）

test('GA-1 验收 2：同步页自上而下 = 概览条 → 任务表 → 折叠数据质量 → 折叠工具', () => {
  const order = ['SyncKpiBar', 'TaskGroupTable', '数据质量', '工具'];
  const positions = order.map((k) => syncAdmin.indexOf(k));
  assert.ok(positions.every((p) => p >= 0), '四块都在 SyncAdmin 里');
  assert.ok(positions.every((v, i) => i === 0 || v > positions[i - 1]), `顺序为 ${order.join(' → ')}`);
  assert.match(syncAdmin, /<SyncFold ref="qualityFold" title="数据质量" :summary="qualitySummary">/, '数据质量折叠（标题行带摘要）');
  assert.match(syncAdmin, /<SyncFold ref="toolsFold" title="工具" :summary="toolsSummary">/, '工具折叠（标题行带摘要）');
  assert.match(syncAdmin, /<SyncQualityPanel \/>/, '折叠内容 = 分级统计 + 数据时效 + 429 队列');
  assert.match(syncAdmin, /<SyncToolsPanel \/>/, '折叠内容 = 初始化全量 + App 版本');
});

test('GA-1 验收 2（静态锁）：模板里不再有旧页平铺的顶层卡片与独立「任务健康」块', () => {
  const tpl = templateOf(modules);
  for (const gone of ['adult-stats-card', 'app-version-card', 'task-state', 'fp-freshness-card', 'fp-queue-card', 'fp-init-card', '任务健康', '任务告警', 'notice-card']) {
    assert.ok(!tpl.includes(gone), `AdminModules 模板不再有旧同步页区块：${gone}`);
  }
  // 整份文件都不再残留这些类名（代码搬走、样式留尸也算没删干净）
  for (const gone of ['adult-stats-card', 'app-version-card', 'task-state', 'fp-freshness-card', 'fp-queue-card', 'fp-init-card']) {
    assert.ok(!modules.includes(gone), `AdminModules 文件不再出现 ${gone}`);
  }
  // 旧页的 10 个区块只剩在「数据质量 / 工具」两个折叠里（不是平铺）
  const flatBlocks = ['内容分级统计', '数据时效', '429 补跑队列', '初始化全量同步', 'App 版本'];
  for (const block of flatBlocks) assert.ok(!tpl.includes(block), `AdminModules 模板不再平铺「${block}」`);
  assert.ok(quality.includes('内容分级统计') && quality.includes('数据时效') && quality.includes('429 补跑队列'), '三块在「数据质量」折叠内');
  assert.ok(tools.includes('初始化全量同步') && tools.includes('App 版本'), '两块在「工具」折叠内');
});

// ---------------------------------------------------------------- ③ 交互接线（验收 3 / 4）

test('GA-1 验收 3：概览 4 卡数字来自 status + freshness + 429queue；「需要关注」定位失败组并展开；折叠摘要', () => {
  // 数据源（无新接口）
  assert.match(composable, /syncApi\('\/api\/admin\/sync\/status'\)/, '概览读 sync/status');
  assert.match(composable, /syncApi\('\/api\/admin\/sync\/freshness'\)/, '数据时效读 sync/freshness');
  assert.match(composable, /syncApi\('\/api\/admin\/sync\/429queue'\)/, '429 队列读 sync/429queue');
  // 4 卡
  for (const label of ['运行中', '需要关注', '429 补跑队列', '今日待补']) assert.ok(kpiBar.includes(label), `概览卡「${label}」`);
  // 「今日待补」= freshness 四类 d1 之和（副标题逐类列出）
  assert.match(composable, /const parts = \{ prices: d1\('prices'\), status: d1\('status'\), names: d1\('names'\), images: d1\('images'\) \}/, '今日待补按四类 d1 聚合并列明细');
  assert.match(kpiBar, /价格 \{\{ kpi\.parts\.prices/, '副标题逐类显示');
  // 「需要关注」点击 → 滚到失败组并展开
  assert.match(kpiBar, /data-jump="fail" @click="\$emit\('jump', 'fail'\)"/, '失败卡可点');
  assert.match(syncAdmin, /groupTable\.value\?\.expandGroup\?\.\(first\.name\)/, '展开最近失败组');
  assert.match(syncAdmin, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/, '滚动到该组');
  assert.match(taskTable, /function expandGroup\(name\) \{[\s\S]{0,200}expanded\.add\(name\)/, '组表暴露 expandGroup');
  // 折叠收起时标题行显示摘要
  assert.match(foldVue, /<span class="sync-fold-sum">\{\{ summary \}\}<\/span>/, '折叠标题行右侧显示摘要');
  assert.match(composable, /分级未回填 \$\{pending\.toLocaleString\('zh-CN'\)\} · 价格超 7 天/, '数据质量摘要口径');
  assert.match(composable, /初始化全量同步 · App 版本/, '工具摘要口径');
});

test('GA-1 验收 4：任务组表——组行展开、组级/子步骤级立即运行确认 + 置「已提交」、告警收进表头、手动任务组', () => {
  // 组行点击展开/收起
  assert.match(taskTable, /@click="toggle\(g\.name\)"/, '点组行展开/收起');
  assert.match(taskTable, /:aria-expanded="expanded\.has\(g\.name\)"/, '展开态可读（aria-expanded）');
  assert.match(taskTable, /v-show="expanded\.has\(g\.name\)" class="sync-steps-scroll"/, '子步骤表随展开显示');
  // 组级与子步骤级都弹确认（composable 的 confirmRun → ElMessageBox.confirm）
  assert.match(composable, /async function confirmRun\(label/, '统一确认弹窗');
  assert.match(composable, /await ElMessageBox\.confirm\(\s*'将使用默认参数立即执行/, '确认文案（默认参数 + 自动互斥）');
  assert.match(taskTable, /@click\.stop="runGroup\(g\)"/, '组级立即运行');
  assert.match(taskTable, /@click="runStep\(s\.name\)"/, '子步骤级立即运行');
  // 提交后按钮置「已提交」（15 秒） + toast
  assert.match(composable, /function markSubmitted\(key\)[\s\S]{0,400}15000/, '已提交态 15 秒后恢复');
  assert.match(composable, /ElMessage\.success\(`已提交运行「\$\{label\}」（约 15 秒内生效）`\)/, '提交后 toast');
  assert.match(taskTable, /submitted\.has\(`group:\$\{g\.name\}`\) \? '已提交' : '立即运行'/, '组行按钮已提交态');
  assert.match(taskTable, /submitted\.has\(`step:\$\{s\.name\}`\) \? '已提交' : stepRunLabel\(s\.name\)/, '子步骤按钮已提交态');
  // 告警收进任务表头部提示条（不再单独一块）
  assert.match(taskTable, /<el-alert v-if="warnings\.length" type="warning"/, '告警提示条在任务表内');
  assert.match(taskTable, /任务 <strong>\{\{ w\.name \}\}<\/strong> 缺失：/, '缺 Key / 被关掉的提示文案');
  // 手动任务组（末尾、只保留立即运行）
  assert.match(taskTable, /手动任务（不进调度器）/, '手动任务组标题');
  assert.match(taskTable, /data-manual="\$?\{?job\.name/, '手动任务行带 data-manual');
  assert.match(taskTable, /job\.name === 'steam-claim' \? runSteamClaim\(\) : runManual\(job\)/, 'steam-claim 走认领端点，其余走手动任务端点');
  assert.match(composable, /syncApi\('\/api\/admin\/sync\/manual'/, '手动任务「立即运行」接口');
  // 组数与子步骤不写死
  assert.match(composable, /const list = state\.status\?\.schedule\?\.groups \|\| \[\];/, '任务组按接口返回渲染');
  assert.match(composable, /const list = state\.status\?\.manualJobs;/, '手动组按接口返回渲染');
});

test('GA-1 验收 4：运行中任务并入概览卡与组行（不再有独立「任务健康」块），停止/进度能力不丢', () => {
  assert.match(composable, /running: runningJob\.value \? 1 : 0/, '运行中并入概览卡');
  assert.match(composable, /runningElapsedMin/, '概览卡显示已跑时长');
  assert.match(composable, /runningProgress/, '回填类进度（done/limit/百分比）并入概览卡');
  assert.match(kpiBar, /已补 \{\{ kpi\.runningProgress\.done/, '概览卡显示补跑进度');
  assert.match(taskTable, /stepStateText\(s\)/, '子步骤行显示运行中/等待/熔断');
  assert.match(taskTable, /groupState\(g\) === 'running'|healthText\(g\)/, '组行按健康聚合显示运行中');
  // 原「任务健康」块里的停止按钮不能随块一起丢掉：运行中的子步骤行给「停止」
  assert.match(taskTable, /<el-button v-if="s\.running" link type="danger" @click="stopCurrent\(\)">停止<\/el-button>/, '运行中子步骤可停止');
  assert.match(composable, /const path = mode === 'rename' \? '\/api\/admin\/rename\/stop' : mode === 'heat' \? '\/api\/admin\/heat\/stop' : '\/api\/admin\/backfill\/stop'/, '停止端点按 mode 分派（沿用旧页）');
  assert.ok(!taskTable.includes('task-state'), '不再有独立任务健康块');
});

// ---------------------------------------------------------------- ④ 移动端（验收 4）

test('GA-1 验收 4（移动端 ≤980px）：概览 2 列 / 任务组行两行 / 子步骤表横向滚动', () => {
  const mq = css.match(/@media\(max-width:980px\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(mq, 'sync.css 有 980px 断点（与 demo 一致）');
  assert.match(mq, /\.sync-kpis\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/, '概览 4 卡 → 2 列');
  assert.match(mq, /\.sync-row\{grid-template-columns:20px minmax\(0,1fr\);row-gap:4px/, '任务组行改两行（名称一行、状态一行）');
  assert.match(mq, /\.sync-row \.col-hide\{display:none\}/, '窄屏隐藏桌面列（不横向溢出）');
  assert.match(mq, /\.sync-row-2\{display:flex;grid-column:2/, '第二行（健康 + 最近运行 + 立即运行）');
  assert.match(css, /\.sync-steps-scroll\{overflow-x:auto/, '子步骤表容器横向滚动');
  assert.match(css, /\.sync-steps\{width:100%;min-width:840px/, '子步骤表固定最小宽度（窄屏靠容器滚动）');
  // 任务组行第二行确实渲染了（不是只有样式）
  assert.match(taskTable, /<span class="sync-row-2">/, '组行含第二行结构');
  assert.match(taskTable, /class="sync-row-2-act"/, '第二行含立即运行按钮');
  // ≤768 的控制台导航（BW 批的 ☰ 抽屉）保持不变——980 断点只管页面内重排
  assert.match(consoleVue, /navDrawer=ref\(false\)/, '≤768 侧栏仍收进 ☰ 抽屉（BW 批既有）');
  assert.match(consoleVue, /m-nav-drawer/, '抽屉容器保留');
});

// ---------------------------------------------------------------- ⑤ 真渲染（DOM 断言）

const ISO = '2026-11-27T08:00:00.000Z';
const fakeStatus = {
  running: true,
  run: { mode: 'steam-status', startedAt: ISO },
  schedule: {
    jobs: [],
    groups: [
      { name: 'steam-prices', label: 'Steam 价格', steps: [{ name: 'steam-prices', intervalMin: 1440, lastRunAt: ISO, lastResult: 'ok', lastElapsedMs: 120000 }] },
      {
        name: 'steam-meta',
        label: 'Steam 元数据',
        steps: [
          { name: 'steam-status', intervalMin: 1440, running: true, lastRunAt: ISO },
          { name: 'rating-backfill', intervalMin: 1440, lastRunAt: ISO, lastResult: 'failed', lastError: 'HTTP 403' },
          { name: 'backfill', intervalMin: 1440, lastRunAt: ISO, lastResult: 'partial' },
        ],
      },
      { name: 'multi-platform', label: '多平台报价', steps: [
        { name: 'sonkwo', intervalMin: 180, lastRunAt: ISO, lastResult: 'ok' },
        { name: 'itad', intervalMin: 1440, lastRunAt: ISO, lastResult: 'ok' },
        { name: 'gog', intervalMin: 720, lastRunAt: ISO, lastResult: 'ok' },
        { name: 'humble', intervalMin: 720, lastRunAt: ISO, lastResult: 'ok' },
      ] },
      { name: 'catalog-discovery', label: '目录与发现', steps: [
        { name: 'steam-discovery', intervalMin: 30, lastRunAt: ISO, lastResult: 'ok' },
        { name: 'discover', intervalMin: 720, lastRunAt: ISO, lastResult: 'ok' },
      ] },
      { name: 'images', label: '图片同步', steps: [{ name: 'images', intervalMin: 240, lastRunAt: ISO, lastResult: 'ok' }] },
      { name: 'index', label: '索引维护', steps: [{ name: 'readmodel', intervalMin: 1440, lastRunAt: ISO, lastResult: 'ok' }] },
      { name: 'system', label: '系统维护', steps: [{ name: 'prune', intervalMin: 1440, lastRunAt: ISO, lastResult: 'ok' }] },
      { name: 'steam-accounts', label: 'Steam 账号', steps: [{ name: 'steam-accounts', intervalMin: 1440, lastRunAt: ISO, lastResult: 'ok' }] },
      { name: 'heat', label: '热度回填', steps: [{ name: 'heat', intervalMin: 10, lastRunAt: ISO, lastResult: 'failed', lastError: 'HTTP 429' }] },
      { name: 'app-release', label: 'App 版本同步', steps: [{ name: 'app-release-sync', intervalMin: 60, lastRunAt: ISO, lastResult: 'ok' }] },
      { name: 'align-snapshot', label: '对齐快照', steps: [{ name: 'align-snapshot', intervalMin: 120, lastRunAt: ISO, lastResult: 'ok' }] },
      { name: 'proxy-alerts', label: '代理与提醒', steps: [
        { name: 'proxy-probe', intervalMin: 30, lastRunAt: ISO, lastResult: 'ok' },
        { name: 'alerts', intervalMin: 360, lastRunAt: ISO, lastResult: 'ok' },
      ] },
    ],
    steamClaimConfigured: false,
  },
  manualJobs: [
    { name: 'catalog', label: '目录同步（全量）', runnable: false, reason: 'STEAM_API_KEY 未配置' },
    { name: 'logs', label: '日志清理', runnable: true, reason: null },
    { name: 'report', label: '价格报表', runnable: false, reason: '未配置提醒通道' },
    { name: 'steam-claim', label: '认领未归属账号', runnable: false, reason: '未配置 STEAM_CLAIM_USERNAME / STEAM_CLAIM_STEAM_ID' },
  ],
  warnings: [{ name: 'steam-accounts', reason: 'STEAM_API_KEY 未配置' }],
  forbidden: { active: false },
  rateGate: null,
  backfillProgress: null,
  sourceStats: null,
};
const fakeFreshness = {
  prices: { d1: 593, d3: 44, d7: 109312, total: 110000 },
  status: { d1: 10306, d3: 2546, d7: 189973, total: 200000 },
  names: { d1: 16572, d3: 32499, d7: 126173, total: 160000 },
  images: { d1: 4730, d3: 28207, d7: 111057, total: 140000 },
};
const fakeGamesStats = { adult: 4803, explicit: 1034, mature: 15798, ratingBackfilled: 90500, ratingPending: 112325 };

test('GA-1 验收 3/4（真渲染）：SyncAdmin 渲染 4 卡数字、12 组行、手动组 4 行、告警条与折叠摘要', async () => {
  const { createServer } = await import('vite');
  const { createSSRApp } = await import('vue');
  const { renderToString } = await import('@vue/server-renderer');
  const { ElButton, ElAlert, ElTag } = await import('element-plus');
  const server = await createServer({
    configFile: 'frontend/vite.config.js',
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  try {
    const mod = await server.ssrLoadModule('/src/components/sync/SyncAdmin.vue');
    const { useSyncAdmin } = await server.ssrLoadModule('/src/composables/useSyncAdmin.js');
    const api = useSyncAdmin();
    api.state.status = fakeStatus;
    api.state.freshness = fakeFreshness;
    api.state.queue429 = { count: 37, maxAttempts: 3, oldestAt: ISO };
    api.state.gamesStats = fakeGamesStats;
    api.state.appCard = { latest: { version: '2.25.1', versionCode: 22501 }, lastSyncAt: ISO, lastError: 'apk_download', syncing: false };
    // 已提交态：一个子步骤 + 一个组（验证按钮文案与置灰）
    api.state.submitted.add('step:steam-prices');
    api.state.submitted.add('group:steam-meta');

    const app = createSSRApp(mod.default);
    app.use(ElButton);
    app.use(ElAlert);
    app.use(ElTag);
    app.config.warnHandler = () => {};
    const html = await renderToString(app);

    // ① 概览 4 卡：运行中 1（steam-status）、需要关注 2（steam-meta + heat）、429 队列 37、今日待补 32201
    assert.match(html, /class="sync-kpi run"[^>]*>[\s\S]*?<b>1<\/b>/, '运行中 = 1');
    assert.match(html, /状态判定[\s\S]{0,40}已跑 \d+ 分钟/, '运行中卡显示当前任务与已跑分钟');
    assert.match(html, /class="sync-kpi fail"[^>]*>[\s\S]*?<b>2<\/b>/, '需要关注 = 2（失败组数）');
    assert.match(html, /Steam 元数据 · 热度回填/, '失败组名摘要');
    assert.match(html, /class="sync-kpi queue"[^>]*>[\s\S]*?<b>37<\/b>/, '429 队列 = 37');
    assert.match(html, /class="sync-kpi" data-jump="today"[\s\S]*?<b>32,201<\/b>/, '今日待补 = 价格 593 + 状态 10306 + 中文名 16572 + 缺封面 4730 = 32201');
    assert.match(html, /价格 593 · 状态 10,306 · 中文名 16,572 · 缺封面 4,730/, '今日待补副标题逐类明细');

    // ② 任务组表：12 组 + 手动组；组行带 data-group，手动任务行带 data-manual
    const groupRows = html.match(/class="sync-row"[^>]*data-group="[^"]+"/g) ?? [];
    assert.equal(groupRows.length, 13, `12 个任务组 + 手动任务组共 13 行（实际 ${groupRows.length}）`);
    assert.match(html, /data-group="steam-meta"/, 'Steam 元数据组行');
    assert.match(html, /data-group="manual"/, '手动任务组行');
    assert.match(html, /12 个任务组 · <b>19 个定时任务 \+ 4 个手动任务<\/b>/, '表头统计（19 定时 + 4 手动）');
    for (const name of ['catalog', 'logs', 'report', 'steam-claim']) assert.match(html, new RegExp(`data-manual="${name}"`), `手动任务行 ${name}`);
    assert.match(html, /已提交/, '已提交态按钮文案');
    assert.match(html, /<button[^>]*disabled[^>]*>[\s\S]{0,160}?已提交/, '已提交后按钮置灰');
    assert.match(html, /任务 <strong>steam-accounts<\/strong> 缺失：STEAM_API_KEY 未配置/, '表头告警条（缺 Key）');
    assert.match(html, /不可运行/, '不可运行的手动任务标「不可运行」');
    assert.match(html, /未配置提醒通道/, '不可运行原因可见');

    // ③ 子步骤表：表头 9 列齐全（v-show 收起时仍在 DOM 里，展开即可见）
    for (const th of ['子步骤', '频率', '上次运行', '下次运行', '上次结果', '耗时', '失败原因', '状态', '操作']) {
      assert.ok(html.includes(`>${th}</th>`), `子步骤表头含「${th}」`);
    }
    assert.match(html, /每 10 分钟/, '频率格式化（10 分钟）');
    assert.match(html, /HTTP 403/, '失败原因透出');

    // ④ 折叠区：标题 + 摘要（收起态也算——摘要必须在）
    assert.match(html, /<h2>数据质量<\/h2>/, '数据质量折叠标题');
    assert.match(html, /分级未回填 112,325 · 价格超 7 天 109,312 · 429 队列 37/, '数据质量摘要（收起时也显示）');
    assert.match(html, /<h2>工具<\/h2>/, '工具折叠标题');
    assert.match(html, /初始化全量同步 · App 版本 2\.25\.1（22501）/, '工具摘要');
    assert.match(html, /成人内容（宽）[\s\S]{0,80}4,803/, '分级统计 5 卡（成人内容）');
    assert.match(html, /App 版本[\s\S]{0,120}立即同步/, 'App 版本卡与立即同步');

    // ⑤ 页面顺序：概览 → 任务表 → 数据质量 → 工具（旧页 10 块平铺已被折叠取代）
    const iKpi = html.indexOf('class="sync-kpis"');
    const iTable = html.indexOf('任务与调度');
    const iFoldQ = html.indexOf('<h2>数据质量</h2>');
    const iFoldT = html.indexOf('<h2>工具</h2>');
    assert.ok(iKpi >= 0 && iKpi < iTable && iTable < iFoldQ && iFoldQ < iFoldT, '四块顺序正确');
    // 旧页的扁平卡片类名一个都不该出现在渲染结果里
    for (const gone of ['adult-stats-card', 'app-version-card', 'task-state']) assert.ok(!html.includes(gone), `渲染结果不含 ${gone}`);
  } finally {
    await server.close();
  }
});
