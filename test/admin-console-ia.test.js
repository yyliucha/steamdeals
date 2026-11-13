// AT 批（docs/ADMIN-CONSOLE-IA.md §11 验收）：
// 1) steam_account_logs 审计：7 类动作落库、失败也记、用户被删后日志仍在、prune 保留 180 天；
// 2) GET /api/admin/steam-logs：鉴权 + 筛选 + total（真 PGlite + 真 HTTP）；
// 3) /api/admin/reports/price：去 daily、加 series（悬停线图一次查出，无逐行请求）；
// 4) 前端接线：侧栏 op-logs、旧书签映射、5 tab、抽屉化、设置 6 tab、价格表无「近 7 天」表。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureSteamSchema } from '../src/steam-login.js';
import { ensureEmailSchema } from '../src/email-auth.js';
import { recordSteamLog, listSteamLogs, STEAM_LOG_ACTIONS } from '../src/steam-log.js';
import * as steamAccounts from '../src/steam-accounts.js';
import * as ratelimit from '../src/ratelimit.js';
import * as guard from '../src/guard.js';
import * as devices from '../src/devices.js';

const WEB = fileURLToPath(new URL('../web', import.meta.url));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const SID = '76561198000000001';
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

process.env.TRUST_PROXY = '1';
process.env.CAPTCHA_ENABLED = '0';
process.env.RATE_LIMIT_ENABLED = '1';
process.env.RATE_LIMIT_PAGE_MAX = '10000';
process.env.RATE_LIMIT_API_MAX = '10000';
process.env.RATE_LIMIT_ASSET_MAX = '10000';
process.env.PATH_REVIEW_ENABLED = '0';
const ADMIN_IP = '198.18.0.9';

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureSteamSchema(store);
  const q = (sql, p) => store.query(sql, p);
  return { store, q };
}

async function boot() {
  ratelimit.resetState();
  guard.resetState();
  devices.resetState();
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureSteamSchema(store);
  const q = (sql, p) => store.query(sql, p);
  const admin = await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({
    query: q,
    outDir: WEB,
    port: 0,
    host: '127.0.0.1',
    getSetupState: async () => ({ completed: true }),
    imageFetch: async () => ({ body: PNG, bytes: PNG.length, contentType: 'image/png' }),
  });
  return {
    q,
    admin,
    base: `http://127.0.0.1:${srv.port}`,
    close: async () => {
      await srv.close();
      await store.close();
    },
  };
}

async function login(base, username, password) {
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ADMIN_IP },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `${username} 登录失败`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

// ---------------------------------------------------------------- 审计表函数级

test('recordSteamLog：7 类动作入库；失败也记并带原因；未知动作拒绝', async () => {
  const { store, q } = await fresh();
  try {
    for (const action of STEAM_LOG_ACTIONS) {
      assert.equal(await recordSteamLog(q, { action, steamId: SID, actor: 'self', result: 'ok' }), true, `${action} 应写入`);
    }
    const bad = await recordSteamLog(q, { action: 'hack', steamId: SID });
    assert.equal(bad, false, '白名单外的动作不落库');
    await recordSteamLog(q, { action: 'sync-library', steamId: SID, actor: 'scheduler', result: 'failed', detail: { reason: 'HTTP 429' }, error: 'x'.repeat(300), elapsedMs: 42 });
    const all = await listSteamLogs(q, { limit: 100, days: 30 });
    assert.equal(all.total, 8, '7 条 ok + 1 条 failed');
    assert.equal(all.entries.length, 8);
    const failed = all.entries.find((e) => e.action === 'sync-library');
    assert.equal(failed.result, 'failed');
    assert.equal(failed.actor, 'scheduler');
    assert.equal(failed.elapsed_ms, 42);
    assert.equal(failed.error.length, 200, 'error 截断 200 字符');
    const filtered = await listSteamLogs(q, { action: 'bind', result: 'ok', steamId: SID });
    assert.equal(filtered.total, 1, 'action/result/steamId 筛选生效');
    assert.equal((await listSteamLogs(q, { action: 'unbind' })).total, 1);
    assert.equal((await listSteamLogs(q, { limit: 3 })).entries.length, 3, 'limit 生效');
  } finally {
    await store.close();
  }
});

test('sync/unbind 写审计（ok 与 failed）；用户被删后 Steam 日志仍在（验收 6）', async () => {
  const { store, q } = await fresh();
  try {
    await db.createUser(q, { username: 'admin1', password: 'password123', role: 'admin' });
    const bob = await db.createUser(q, { username: 'bob', password: 'password123' });
    await q('insert into steam_accounts (steam_id, persona_name, user_id) values ($1, $2, $3)', [SID, 'Bob', bob.id]);
    // 成功同步：fake fetch，不真出网
    await steamAccounts.syncAccountLibrary(q, { steamId: SID, apiKey: 'x', fetchImpl: async () => [{ appid: 730, name: 'CS2', playtimeMinutes: 1 }], log: { actor: 'self', userId: bob.id, username: 'bob', personaName: 'Bob' } });
    // 失败同步：fetch 抛错 → 审计 failed + 原样上抛
    await assert.rejects(
      steamAccounts.syncAccountLibrary(q, { steamId: SID, apiKey: 'x', fetchImpl: async () => { throw new Error('HTTP 429'); } }),
      /HTTP 429/,
    );
    // 解绑
    await steamAccounts.unbindAccount(q, { steamId: SID, userId: bob.id, log: { actor: 'self', username: 'bob' } });
    await q('insert into steam_accounts (steam_id, persona_name, user_id) values ($1, $2, $3)', [SID, 'Bob', bob.id]);
    // 删用户（级联删除账号）→ 审计要有 delete-cascade，且删完后全部日志仍在
    await db.deleteUserAudited(q, { username: 'bob', confirmUsername: 'bob', operator: 'admin1', reason: '测试' });
    const logs = await listSteamLogs(q, { steamId: SID, days: 30 });
    const actions = logs.entries.map((e) => e.action).sort();
    assert.deepEqual(actions, ['delete-cascade', 'sync-library', 'sync-library', 'unbind'], '同步/失败/解绑/级联删除都落日志');
    assert.equal((await q('select count(*)::int as n from users where username = $1', ['bob'])).rows[0].n, 0, '用户已删');
    assert.equal(logs.total, 4, '用户被删后其 Steam 日志仍在（不级联删）');
    const cascade = logs.entries.find((e) => e.action === 'delete-cascade');
    assert.equal(cascade.actor, 'admin:admin1');
    assert.equal(cascade.username, 'bob');
  } finally {
    await store.close();
  }
});

test('prune：steam_account_logs 保留 180 天（并入现有 purgeOldRows，不新建任务）', async () => {
  const { store, q } = await fresh();
  try {
    await ensureEmailSchema(store);
    await recordSteamLog(q, { action: 'bind', steamId: SID });
    await q('insert into steam_account_logs (action, steam_id, actor, result, created_at) values ($1,$2,$3,$4, now() - interval \'200 days\')', ['bind', SID, 'self', 'ok']);
    const r = await db.purgeOldRows(q, { steamDays: 180 });
    assert.equal(r.steamAccountLogs, 1, '只清 180 天前的行');
    assert.equal((await q('select count(*)::int as n from steam_account_logs')).rows[0].n, 1, '新行保留');
    const short = await db.purgeOldRows(q, { steamDays: 0 });
    assert.equal(short.steamAccountLogs, 1, 'steamDays 参数可调（默认 180 由 cli 传入）');
  } finally {
    await store.close();
  }
});

// ---------------------------------------------------------------- 价格序列

test('dailyMinSeriesBatch：一次查出多个游戏近 N 天每日最低（官方渠道、国区、跨平台取最小）', async () => {
  const { store, q } = await fresh();
  try {
    const g1 = Number((await q("insert into games (steam_appid, name, is_free) values (9001, 'A', false) returning id")).rows[0].id);
    const g2 = Number((await q("insert into games (steam_appid, name, is_free) values (9002, 'B', false) returning id")).rows[0].id);
    const day = (n) => `current_date - ${n}`;
    await q('insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) values ' +
      `(${g1},'steam','cn',${day(6)},1000,'CNY'),(${g1},'steam','cn',${day(5)},900,'CNY'),(${g1},'gog','cn',${day(5)},800,'CNY'),` +
      `(${g1},'steam','cn',${day(4)},1200,'CNY'),(${g2},'steam','cn',${day(0)},500,'CNY'),(${g1},'steam','us',${day(1)},1,'CNY'),` +
      `(${g1},'steam','cn',${day(10)},700,'CNY'),(${g1},'steam','cn',${day(30)},600,'CNY')`);
    const out = await db.dailyMinSeriesBatch(q, { gameIds: [g1, g2], days: 7 });
    assert.deepEqual(out[g2], [{ day: out[g2][0].day, price_cents: 500, currency: 'CNY' }], 'g2 只有今天一条');
    assert.equal(out[g1].length, 3, 'g1 7 天窗口内 3 个不同的天；10/30 天前与 us 区被窗口/区服过滤');
    const day5 = out[g1].find((p) => p.price_cents === 800);
    assert.ok(day5, '同一天 steam 900 / gog 800 → 跨平台取最小 800');
    assert.deepEqual(await db.dailyMinSeriesBatch(q, { gameIds: [], days: 7 }), {}, '空集合返回空对象');
    assert.equal((await db.dailyMinSeriesBatch(q, { gameIds: [g1], days: 30 }))[g1].length, 4, 'days 窗口可调（30 天含第 10 天、不含第 30 天那条）');
  } finally {
    await store.close();
  }
});

// ---------------------------------------------------------------- HTTP 层

test('GET /api/admin/steam-logs：匿名 401、普通用户 403、管理员拿到 entries+total 且筛选生效', async () => {
  const { q, base, close } = await boot();
  try {
    await recordSteamLog(q, { action: 'bind', steamId: SID, actor: 'self', result: 'ok' });
    await recordSteamLog(q, { action: 'unbind', steamId: SID, actor: 'self', result: 'failed', error: '网络错误' });
    const anon = await fetch(base + '/api/admin/steam-logs');
    assert.equal(anon.status, 401);
    await db.createUser(q, { username: 'bob', password: 'bob12345678' });
    const bobCookie = await login(base, 'bob', 'bob12345678');
    assert.equal((await fetch(base + '/api/admin/steam-logs', { headers: { cookie: bobCookie, 'x-forwarded-for': ADMIN_IP } })).status, 403);
    const cookie = await login(base, 'admin', 'admin123456');
    const all = await (await fetch(base + '/api/admin/steam-logs?limit=500', { headers: { cookie, 'x-forwarded-for': ADMIN_IP } })).json();
    assert.equal(all.total, 2);
    assert.equal(all.entries.length, 2);
    assert.equal(all.entries[0].action, 'unbind', '倒序（最近在前）');
    const okOnly = await (await fetch(base + '/api/admin/steam-logs?result=ok', { headers: { cookie, 'x-forwarded-for': ADMIN_IP } })).json();
    assert.equal(okOnly.total, 1);
    const none = await (await fetch(base + '/api/admin/steam-logs?steamId=76561198000009999', { headers: { cookie, 'x-forwarded-for': ADMIN_IP } })).json();
    assert.equal(none.total, 0);
  } finally {
    await close();
  }
});

test('GET /api/admin/reports/price：响应有 series、没有 daily（验收 9：悬停零额外请求）', async () => {
  const { q, base, close } = await boot();
  try {
    const cookie = await login(base, 'admin', 'admin123456');
    const d = await (await fetch(base + '/api/admin/reports/price?hours=24&limit=100&days=7', { headers: { cookie, 'x-forwarded-for': ADMIN_IP } })).json();
    assert.ok(d.report && typeof d.report === 'object', 'report 字段还在');
    assert.ok(d.series && typeof d.series === 'object', 'series 字段存在（按 gameId 索引）');
    assert.equal('daily' in d, false, 'daily 已移除（底部表删除后无人使用）');
    // 有变化行时 series 只含报告里出现的 game_id（一次查出，不逐行请求）
    const gid = 12345;
    await q('insert into games (id, steam_appid, name, is_free) values ($1, 9999, $2, false)', [gid, 'seed']);
    const off = (await q("insert into offers (game_id, platform_code, product_type, region, price_cents, currency, in_stock) values ($1, 'steam', 'app', 'cn', 900, 'CNY', true) returning id", [gid])).rows[0].id;
    await q('insert into price_snapshots (offer_id, price_cents, prev_price_cents, raw_hash) values ($1, 900, 1000, \'h\')', [off]);
    await q("insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) values ($1, 'steam', 'cn', current_date - 1, 850, 'CNY')", [gid]);
    const d2 = await (await fetch(base + '/api/admin/reports/price?hours=24&limit=100&days=7', { headers: { cookie, 'x-forwarded-for': ADMIN_IP } })).json();
    const ids = [...(d2.report.topDrops || []), ...(d2.report.topRises || [])].map((r) => r.game_id);
    assert.ok(ids.includes(gid), 'seed 的变化行进入报告');
    assert.ok(String(gid) in d2.series, 'series 按报告里的 game_id 一次返回（无 daily 数据的游戏不出序列，悬停显示空态）');
    assert.equal(d2.series[String(gid)][0].price_cents, 850, '序列口径=官方渠道每日最低');
    assert.ok(Object.keys(d2.series).length <= ids.length, 'series 不包含报告外的游戏');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------- 前端接线（静态断言）

test('Console：侧栏无「批量操作记录/运行日志」，有「日志审计/操作日志」；旧书签映射不 404（验收 1/11）', () => {
  const c = read('../frontend/src/pages/Console.vue');
  assert.ok(!c.includes("label:'批量操作记录'"), '侧栏不再有「批量操作记录」');
  assert.ok(!c.includes("label:'运行日志'"), '侧栏不再有「运行日志」');
  assert.match(c, /name:'日志审计'/, '新分组「日志审计」');
  assert.match(c, /id:'op-logs',label:'操作日志'/, '「操作日志」菜单项');
  assert.match(c, /'bulk-ops': \{ section: 'op-logs', tab: 'bulk' \}/, '?section=bulk-ops → op-logs&tab=bulk');
  assert.match(c, /sync: \{ section: 'op-logs', tab: 'run' \}/, '?section=sync → op-logs&tab=run');
  assert.match(c, /tab==='records'/, '?section=mail&tab=records → op-logs&tab=mail');
  assert.match(c, /AdminLogs v-else-if="selected === 'op-logs'"/, 'op-logs 渲染 AdminLogs');
});

test('AdminLogs：5 个 tab 顺序与口径、tab↔URL 双向同步、懒加载缓存、run 轮询只在 tab 打开时跑（验收 5）', () => {
  const l = read('../frontend/src/pages/AdminLogs.vue');
  for (const tab of ['user-deletions', 'bulk', 'steam', 'mail', 'run']) {
    assert.match(l, new RegExp(`<el-tab-pane name="${tab}">`), `应有 ${tab} tab`);
  }
  assert.match(l, /route\.query\.tab/, 'tab 从 URL 读（?tab= 直达/刷新保持）');
  assert.match(l, /\{ \.\.\.route\.query, tab \}/, '切 tab 写回 URL');
  assert.match(l, /loaded\[tab\]/, '切 tab 懒加载 + 内存缓存（第二次不重复请求）');
  assert.match(l, /activeTab\.value === 'run' && autoLogs\.value && !document\.hidden/, '10 秒轮询只在 run tab 打开时跑');
  assert.match(l, /\/api\/admin\/users\/deletions\?/, '用户删除数据来源不变');
  assert.match(l, /limit: '200'/, '用户删除上限 200（Q6 默认）');
  assert.match(l, /\/api\/admin\/bulk-ops/, '批量操作数据来源不变');
  assert.match(l, /\/api\/admin\/steam-logs/, 'Steam tab 接新接口');
  assert.match(l, /\/api\/admin\/mail\/log/, '邮件发送数据来源不变');
  assert.match(l, /\/api\/admin\/sync\/runs/, '运行与同步数据来源不变');
});

test('抽屉化：用户管理/站点通知顶部无内嵌表单，抽屉组件挂载 + URL 直达（验收 2/4/13）', () => {
  const extras = read('../frontend/src/pages/AdminExtras.vue');
  const modules = read('../frontend/src/pages/AdminModules.vue');
  assert.ok(!extras.includes('新建用户</h3>'), '用户管理页不再有内嵌新建表单卡');
  assert.ok(!extras.includes('<h3>最近删除</h3>'), '最近删除卡已搬进操作日志');
  assert.match(extras, /<UserCreateDrawer v-model:visible="newUserDrawer"/, '新建用户抽屉挂载');
  assert.match(extras, /drawer:'new'/, '?section=users&drawer=new 可直达');
  assert.ok(!modules.includes('announcement-form'), '站点通知页不再有内嵌发布表单');
  assert.match(modules, /<AnnouncementDrawer v-model:visible="announcementDrawer.visible"/, '通知抽屉挂载');
  assert.match(modules, /drawer:'new'/, '?section=announcements&drawer=new 可直达');
  const userDrawer = read('../frontend/src/components/UserCreateDrawer.vue');
  const anDrawer = read('../frontend/src/components/AnnouncementDrawer.vue');
  assert.match(userDrawer, /requestLeave/, '抽屉关闭前过未保存守卫');
  assert.match(userDrawer, /tempPassword/, '创建成功后抽屉内一次性展示临时密码');
  assert.match(userDrawer, /copyText/, '临时密码可复制');
  assert.match(anDrawer, /requestLeave/, '通知抽屉关闭前过未保存守卫');
  assert.match(anDrawer, /前台预览/, '通知抽屉带前台预览');
  assert.match(anDrawer, /form\.id \? 'PATCH' : 'POST'/, '新建/编辑共用同一抽屉（同接口两态）');
});

test('邮件 3 tab + 发送记录单一入口；设置 6 tab；价格表无「近 7 天」表且有悬停线图（验收 7/8/9）', () => {
  const extras = read('../frontend/src/pages/AdminExtras.vue');
  const modules = read('../frontend/src/pages/AdminModules.vue');
  for (const tab of ['邮件配置', '邮件模板', '发送测试']) {
    assert.match(extras, new RegExp(`label="${tab}"`), `邮件服务应有 ${tab} tab`);
  }
  assert.ok(!extras.includes('<h3>最近发送记录</h3>'), '邮件页不再有发送记录卡');
  assert.match(extras, /查看发送记录 ↗/, '邮件页头留「查看发送记录」入口');
  assert.match(extras, /goOpLogs\('mail'\)/, '发送记录入口跳操作日志 · 邮件发送（单一入口）');
  assert.match(modules, /class="settings-tabs"/, '系统设置用 el-tabs');
  assert.ok(!modules.includes('el-collapse'), '系统设置不再用折叠面板');
  assert.match(modules, /activeSettingsTab/, '设置 tab 状态');
  assert.ok(!modules.includes('近 7 天变化'), '价格变化底部「近 7 天变化」表已删除');
  assert.match(modules, /<PriceSparkline/, '「变化」列挂悬停线图');
  assert.match(modules, /el-popover placement="left"[\s\S]*trigger="hover"/, '悬停弹线图');
  assert.match(modules, /priceSeries\[row\.game_id\]/, '线图数据来自随列表一次返回的 series（无逐行请求）');
  const spark = read('../frontend/src/components/PriceSparkline.vue');
  assert.match(spark, /暂无 7 天数据/, '无数据空态');
  assert.match(spark, /svg viewBox/, '手写 SVG（不引图表库）');
});

test('组件注册：ElPopover 进 main.js 三处（import / 样式 / app.use），漏注册会静默不渲染', () => {
  const m = read('../frontend/src/main.js');
  assert.match(m, /\bElPopover\b/, 'import ElPopover');
  assert.match(m, /popover\/style\/css/, '加载 popover 样式');
  assert.match(m, /ElPopover[,\]]/, 'app.use 数组含 ElPopover');
});
// BA 批（docs/RUN-SYNC-REDESIGN.md §4）：运行与同步页重设计——任务健康条 / 记录 6 列 + 5 轮折叠 / 固定高度日志面板。
test('BA 批：运行与同步页——健康条、记录精简与 5 轮折叠、日志面板固定高度/行展开', () => {
  const vue = read('../frontend/src/pages/AdminLogs.vue');
  // ① 任务健康条：接 /api/admin/sync/status，chip 可过滤日志，60 秒自动刷新
  assert.match(vue, /任务健康/, '健康条标题');
  assert.match(vue, /api\/admin\/sync\/status/, '读调度器状态接口');
  assert.match(vue, /v-for="j in jobs"[^>]*class="health-chip"/, '任务 chip 列表');
  assert.match(vue, /toggleJobFilter\(j\.name\)/, '点 chip 过滤日志');
  assert.match(vue, /setInterval\(\(\) => \{\s*if \(activeTab\.value === 'run' && !document\.hidden\) loadHealth\(\);/, '60 秒刷新健康条');
  // ② 同步记录：6 列（时间/模式/状态/结果/耗时/备注）+ 默认 5 轮 + 展开全部
  assert.match(vue, /label="结果"/, '合并结果列');
  assert.doesNotMatch(vue, /label="请求数"/, '旧的请求数列已合并');
  assert.doesNotMatch(vue, /label="总量"/);
  assert.match(vue, /const visibleRuns = computed\(\(\) => \(showAllRuns\.value \? syncRuns\.value : syncRuns\.value\.slice\(0, 5\)\)\)/, '默认 5 轮');
  assert.match(vue, /showAllRuns = !showAllRuns/, '展开/收起全部');
  // ③ 日志面板：固定高度 55vh 内滚 + sticky 头 + 行点击展开完整字段
  assert.match(vue, /\.log-panel-body\{max-height:55vh;overflow-y:auto/, '55vh 内部滚动');
  assert.match(vue, /\.log-panel-head\{position:sticky/, '筛选条 sticky');
  assert.match(vue, /@click="toggleLogExpanded\(index\)"/, '日志行点击展开');
  assert.match(vue, /v-if="expandedLogs\.has\(index\)"/, '展开完整字段');
  assert.match(vue, /@media \(max-width:760px\)\{\.log-panel-body\{max-height:50vh\}/, '移动端 50vh');
});