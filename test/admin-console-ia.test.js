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
    // EJ（docs/DISPLAY-NAME-RULE.md §4）：审计日志「归属用户」列按「昵称 → 用户名」显示。
    await db.updateUser(q, { username: 'bob', displayName: '  鲍勃  ' });
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
    // EJ：日志行带 user_display_name（昵称 trim 后）；用户被删后 join 不到 → null，
    // 展示层回退日志里的 username（账号标识，审计必需）。
    // 反向自检：删掉 left join users / 去掉 trim → 断言红。
    assert.equal(cascade.user_display_name, null, '用户已删除 → 昵称 join 不到（回退 username）');
    const syncLog = logs.entries.find((e) => e.action === 'sync-library');
    assert.equal(syncLog.user_display_name, null, '删除后历史行同样 join 不到昵称');
    // 未删除用户的历史日志能带出昵称
    const carol = await db.createUser(q, { username: 'carol', password: 'password123' });
    await db.updateUser(q, { username: 'carol', displayName: '卡罗尔' });
    await recordSteamLog(q, { action: 'claim', steamId: SID, userId: carol.id, username: 'carol', actor: 'admin:admin1', result: 'ok' });
    const withNick = await listSteamLogs(q, { steamId: SID, days: 30 });
    const claim = withNick.entries.find((e) => e.action === 'claim');
    assert.equal(claim.user_display_name, '卡罗尔', '有昵称的日志带出昵称');
    assert.equal(claim.username, 'carol', '账号标识仍保留（审计口径）');
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

test('抽屉化：用户管理/站点通知顶部无内嵌表单，编辑组件挂载 + URL 直达（验收 2/4/13；EL 批通知改弹窗）', () => {
  const extras = read('../frontend/src/pages/AdminExtras.vue');
  const modules = read('../frontend/src/pages/AdminModules.vue');
  assert.ok(!extras.includes('新建用户</h3>'), '用户管理页不再有内嵌新建表单卡');
  assert.ok(!extras.includes('<h3>最近删除</h3>'), '最近删除卡已搬进操作日志');
  // DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：新建用户入口整体下线（按钮 + 抽屉 + URL 直达都无）
  assert.ok(!extras.includes('UserCreateDrawer'), '新建用户抽屉不再挂载（DT-3 下线）');
  assert.ok(!extras.includes('openNewUserDrawer'), '无新建用户入口函数');
  assert.ok(!extras.includes("＋ 新建用户"), '无「＋ 新建用户」按钮');
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

test('邮件 3 tab + 发送记录单一入口；价格表无「近 7 天」表且有悬停线图（验收 7/8/9）', () => {
  const extras = read('../frontend/src/pages/AdminExtras.vue');
  const modules = read('../frontend/src/pages/AdminModules.vue');
  for (const tab of ['邮件配置', '邮件模板', '发送测试']) {
    assert.match(extras, new RegExp(`label="${tab}"`), `邮件服务应有 ${tab} tab`);
  }
  assert.ok(!extras.includes('<h3>最近发送记录</h3>'), '邮件页不再有发送记录卡');
  assert.match(extras, /查看发送记录 ↗/, '邮件页头留「查看发送记录」入口');
  assert.match(extras, /goOpLogs\('mail'\)/, '发送记录入口跳操作日志 · 邮件发送（单一入口）');
  assert.ok(!modules.includes('el-collapse'), '系统设置不再用折叠面板');
  assert.ok(!modules.includes('近 7 天变化'), '价格变化底部「近 7 天变化」表已删除');
  assert.match(modules, /<PriceSparkline/, '「变化」列挂悬停线图');
  assert.match(modules, /el-popover placement="left"[\s\S]*trigger="hover"/, '悬停弹线图');
  assert.match(modules, /priceSeries\[row\.game_id\]/, '线图数据来自随列表一次返回的 series（无逐行请求）');
  const spark = read('../frontend/src/components/PriceSparkline.vue');
  assert.match(spark, /暂无 7 天数据/, '无数据空态');
  assert.match(spark, /svg viewBox/, '手写 SVG（不引图表库）');
});

// FY-1（docs/SETTINGS-REDESIGN.md §2/§3.1/§3.2、验收 1/2/3）：
// 设置页横向 7 tab 下线 → 左侧竖排导航（7 个对象组、项数徽标、当前组高亮 + 品牌色条、底部版本脚注）+
// `/console/settings/:group` 二级路由（未知组回落 sources、/console 重定向、点组 = push 可后退）+
// 右侧仍是「面包屑 + 组标题/描述 + 现有卡片/网格/折叠渲染」。
// 反向自检：把 el-tabs 塞回设置模板 / 删掉 goSettingsGroup 的 push 分支 → 本用例必红。
test('FY-1：系统设置左导航 7 组 + /console/settings/:group 路由 + 横向 tab 下线（验收 1/2/3）', () => {
  const modules = read('../frontend/src/pages/AdminModules.vue');
  const router = read('../frontend/src/router/index.js');
  const consoleVue = read('../frontend/src/pages/Console.vue');
  const settingsUtil = read('../frontend/src/utils/settings.js');

  // ① 验收 3：横向 7 tab 静态锁——设置页不再出现 el-tabs / el-tab-pane / 旧 tab 容器
  assert.ok(!modules.includes('el-tabs'), '设置页不再渲染横向 tab（el-tabs 已移除）');
  assert.ok(!modules.includes('el-tab-pane'), '设置页不再有 tab-pane');
  assert.ok(!modules.includes('settings-tabs'), '旧 .settings-tabs 容器/样式已移除');
  assert.match(modules, /class="settings-sections"/, '右侧仍按分区渲染（本批不改卡片，FY-2 才重写行列表）');
  assert.match(modules, /class="setting-grid"/, '平铺组仍是网格（不改渲染）');
  assert.match(modules, /settings-fold/, '折叠入口仍是原按钮（不改渲染）');

  // ② 验收 1：左导航 7 组（图标 + 名称 + 项数徽标）、当前组高亮 + 左侧品牌色条、底部版本脚注
  assert.match(modules, /class="settings-nav"/, '左侧竖排导航容器');
  assert.match(modules, /\.settings-nav\{width:236px/, '左导航宽 236px（规格 §3.2）');
  assert.match(modules, /v-for="g in settingsGroups"[\s\S]{0,220}settings-nav-ico[\s\S]{0,120}settings-nav-name[\s\S]{0,120}groupItemCount\(g\.id\)/, '每组 = 图标 + 名称 + 项数徽标');
  assert.match(modules, /:class="\{ on: g\.id===activeSettingsGroup \}"/, '当前组高亮');
  assert.match(modules, /box-shadow:inset 3px 0 0 var\(--brand\)/, '当前组左侧品牌色条');
  assert.match(modules, /settings-nav-foot/, '左导航底部信息区');
  assert.match(modules, /版本 \{\{ settingsSchema\?\.version\|\|'—' \}\} · 配置修订 \{\{ settingsSchema\?\.revision\|\|0 \}\}/, '底部显示 版本 · 配置修订');
  assert.match(modules, /改一项即存，约 15 秒生效/, '底部「改一项即存，约 15 秒生效」（即时保存文案占位，FY-2 才实现）');
  assert.match(modules, /const settingsGroups=computed[\s\S]{0,220}SETTINGS_GROUP_IDS\.map/, '7 组顺序取前端 id 白名单、标题/图标以 schema 为准');

  // ③ 验收 3：面包屑「管理控制台 / 系统设置 / 当前组」
  assert.match(modules, /管理控制台 <span>\/<\/span> 系统设置 <span>\/<\/span> \{\{ activeSettingsGroupItem\?\.title \}\}/, '面包屑三级');

  // ④ 验收 1/2：点组 = push 换 URL（后退能回上一组）；未知组回落 sources；/console 无 section 重定向默认组
  assert.match(modules, /const nav=replace\?router\.replace\(path\):router\.push\(path\)/, '换组默认 router.push（浏览器后退可回上一组）');
  assert.match(modules, /router\.push\(path\)/, 'push 分支存在');
  assert.match(modules, /bypassNextGuard\(\)/, '同页换组不丢草稿，放过未保存离开询问');
  assert.match(router, /path: '\/console\/settings\/:group\?'/, '二级路由 /console/settings/:group?（可选组）');
  assert.match(router, /isSettingsGroupId\(to\.params\.group\)/, '未知组校验');
  assert.match(router, /path: `\/console\/settings\/\$\{DEFAULT_SETTINGS_GROUP\}`, query: to\.query/, '未知组 / 无组回落默认组 sources（保留查询串）');
  assert.match(router, /to\.query\.section \? true : \{ path: `\/console\/settings\/\$\{DEFAULT_SETTINGS_GROUP\}`/, '裸 /console 重定向默认组；带 ?section= 的旧书签保持原行为');
  assert.match(settingsUtil, /SETTINGS_GROUP_IDS = \['sources', 'site', 'access', 'alerts', 'network', 'schedule', 'ops'\]/, '7 组 id 白名单');
  assert.match(settingsUtil, /DEFAULT_SETTINGS_GROUP = 'sources'/, '默认组 = sources');
  assert.match(router, /import \{ DEFAULT_SETTINGS_GROUP, isSettingsGroupId \} from '\.\.\/utils\/settings\.js'/, '路由复用同一份组 id 白名单');

  // ⑤ 移动端 ≤560px：左导航收成顶部「<组名> · N 项 ▾」下拉
  assert.match(modules, /class="settings-nav-mobile"/, '移动端下拉容器');
  assert.match(modules, /<el-select :model-value="activeSettingsGroup"[\s\S]{0,160}@change="goSettingsGroup"/, '下拉切组');
  assert.match(modules, /:label="`\$\{g\.icon\} \$\{g\.title\} · \$\{groupItemCount\(g\.id\)\} 项`"/, '下拉标签 = 组名 · N 项');
  assert.match(modules, /@media\(max-width:560px\)\{\.settings-page\{display:block\}\.settings-nav\{display:none\}/, '≤560px 竖排导航隐藏、下拉出现');

  // ⑥ Console：/console/settings/* 选中「系统设置」，菜单进设置用 push，旧 ?section=settings 归一
  assert.match(consoleVue, /const SETTINGS_PATH = '\/console\/settings'/, 'Console 识别二级路由');
  assert.match(consoleVue, /selected\.value = 'settings'/, '路径变化 → 选中系统设置');
  assert.match(consoleVue, /router\.push\(DEFAULT_SETTINGS_PATH\)/, '菜单「系统设置」push 进默认组（可后退回上一模块）');
  assert.match(consoleVue, /id==='settings'&&user\.value\?\.role==='admin'/, '旧书签 ?section=settings → 二级路由');
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
  // CO-1/A5：失败 chip 显红并显示失败原因（截断单行，悬停 title 看全文）
  assert.match(vue, /jobState\(j\) === 'failed' && j\.lastError/, '失败 chip 显示失败原因');
  assert.match(vue, /class="chip-reason"/, '失败原因行样式');
  assert.match(vue, /jobFailTitle\(j\)/, '悬停显示完整失败原因');
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

// ===== DT-1（docs/ADMIN-PERMISSIONS.md）：菜单与路由权限隔离 =====
// demo 状态 ↔ 断言映射（design/admin-menu-permissions-2026-11-19.html）：
//   ①「管理员菜单（全量）＋『Steam 账号』菜单已删除」→ 用例 1/2；
//   ②「普通用户菜单（5 项）＋其余分组不渲染」→ 用例 3/4；
//   ③「直接访问无权限 section 会被路由守卫跳回个人资料」→ 用例 5/6/7。
// 反向自检：把 {id:'steam',…} 加回 groups → 用例 1 红；把 USER_SECTIONS 减员或把「无权限」
// 提示删掉 → 用例 3/6 红；删掉模板 UserSections 分支 → 用例 7 红。
test('DT-1 验收 1：admin 菜单全量且「Steam 账号」菜单项已删除（无残留入口）', () => {
  const c = read('../frontend/src/pages/Console.vue');
  assert.ok(!c.includes("id:'steam'"), '侧栏不再有「Steam 账号」菜单项（账号管理并入个人资料）');
  assert.ok(!c.includes("label:'Steam 账号'"), '「Steam 账号」文案无残留');
  // admin 全量菜单（demo ① 逐项）：
  for (const item of [
    'id:\'games\',label:\'游戏管理\'',
    'id:\'recycle\',label:\'回收站\'',
    'id:\'announcements\',label:\'站点通知\'',
    'id:\'wishlist\',label:\'愿望单\'',
    'id:\'watchlist\',label:\'到价提醒\'',
    'id:\'visitors\',label:\'访问记录\'',
    'id:\'appeals\',label:\'申诉管理\'',
    'id:\'users\',label:\'用户管理\'',
    'id:\'sessions\',label:\'登录会话\'',
    'id:\'mail\',label:\'邮件服务\'',
    'id:\'op-logs\',label:\'操作日志\'',
    'id:\'settings\',label:\'系统设置\'',
    'id:\'stats\',label:\'数据统计\'',
  ]) {
    assert.ok(c.includes(item), `admin 全量菜单应含 ${item}`);
  }
  for (const name of ["name:'内容运营'", "name:'访问与安全'", "name:'账号与服务'", "name:'日志审计'", "name:'系统'"]) {
    assert.ok(c.includes(name), `分组 ${name} 保留`);
  }
});

test('DT-1 验收 2：普通用户仅 5 页（个人资料/登录会话（我的设备）/我的到价提醒/我的愿望单/站点公告）', () => {
  const c = read('../frontend/src/pages/Console.vue');
  // 允许集与顺序（demo ② 逐字文案）
  assert.match(c, /const USER_SECTIONS = \['profile', 'sessions', 'watchlist', 'wishlist', 'announcements'\]/, 'USER_SECTIONS 恰好 5 项且顺序与 demo 一致');
  assert.match(c, /id: 'profile', label: '个人资料'/, '普通用户菜单：个人资料');
  assert.match(c, /id: 'sessions', label: '登录会话（我的设备）'/, '普通用户菜单：登录会话（我的设备）');
  assert.match(c, /id: 'watchlist', label: '我的到价提醒'/, '普通用户菜单：我的到价提醒');
  assert.match(c, /id: 'wishlist', label: '我的愿望单'/, '普通用户菜单：我的愿望单');
  assert.match(c, /id: 'announcements', label: '站点公告'/, '普通用户菜单：站点公告（只读）');
  assert.match(c, /name: '我的'/, '普通用户分组名「我的」（其余分组不渲染）');
});

test('DT-1 验收 3：普通用户菜单只渲染「我的」组（visibleGroups 按角色取 USER_GROUPS）', () => {
  const c = read('../frontend/src/pages/Console.vue');
  assert.match(c, /const source=isUserRole\.value\?USER_GROUPS:groups/, 'visibleGroups 普通用户走 USER_GROUPS');
  assert.match(c, /const isUserRole = computed\(\(\) => Boolean\(user\.value && user\.value\.role !== 'admin'\)\)/, '普通用户角色判定');
  assert.match(c, /const isAdminUser = computed\(\(\) => user\.value\?\.role === 'admin'\)/, 'admin 角色判定');
});

test('DT-1 验收 4：直达无权限 section → 跳 profile + 「无权限」提示（watch 路由变化）', () => {
  const c = read('../frontend/src/pages/Console.vue');
  assert.match(c, /if\(isUserRole\.value && !USER_SECTIONS\.includes\(id\)\)/, 'watch 守卫按允许集拦截');
  assert.match(c, /if\(id\)ElMessage\.warning\('无权限'\)/, '跳回时提示「无权限」');
  assert.match(c, /selected\.value='profile';\s*router\.replace\(\{path:'\/console',query:\{section:'profile'\}\}\)/, '跳回 profile（URL 同步改写）');
});

test('DT-1 验收 5：首帧直达（onMounted）同样拦截——无权限 section 跳 profile+提示，允许集 section 保留', () => {
  const c = read('../frontend/src/pages/Console.vue');
  assert.match(c, /if\(initial&&USER_SECTIONS\.includes\(initial\)\)\{\s*selected\.value=initial;/, '直达允许集 section（sessions/watchlist/wishlist/announcements）保留');
  assert.match(c, /if\(initial\)ElMessage\.warning\('无权限'\);/, '直达无权限 section 提示「无权限」');
});

test('DT-1 验收 6：普通用户 4 个数据页渲染 UserSections（admin 渲染 AdminModules/AdminExtras 不变）', () => {
  const c = read('../frontend/src/pages/Console.vue');
  assert.match(c, /<AdminModules v-if="isAdminUser && nativeSections\.includes\(selected\)"/, 'admin 页面保持 AdminModules（admin 接口不变）');
  assert.match(c, /<AdminExtras v-else :section="selected"/, 'admin 其它 section 保持 AdminExtras');
  assert.match(c, /<UserSections v-else-if="isUserRole" :section="selected"/, '普通用户 4 数据页渲染 UserSections');
  const u = read('../frontend/src/pages/UserSections.vue');
  assert.match(u, /defineProps\(\{ section:/, 'UserSections 接收 section');
  for (const label of ['登录会话（我的设备）', '我的到价提醒', '我的愿望单', '站点公告']) {
    assert.ok(u.includes(label), `UserSections 含「${label}」页壳`);
  }
});

// ===== DT-2（docs/ADMIN-PERMISSIONS.md）：普通用户 5 页全部切用户级接口 =====
// 四方一致：后端端点（me.js/watchlist.js）↔ 前端消费（UserSections）↔ 测试断言（本组 + sessions/wishlist HTTP 组）。
// 反向自检：把 UserSections 的 /api/me/sessions 改回 /api/admin/sessions → 用例 1 红；
// 把 /api/me/wishlist 改回 /api/admin/wishlists → 用例 3 红（管理员接口不可越权调用的前端接线即失效）。
test('DT-2 前端接线：会话页 /api/me/sessions*、到价提醒 /api/watchlist、愿望单 /api/me/wishlist、公告 /api/announcements；个人资料不变', () => {
  const u = read('../frontend/src/pages/UserSections.vue');
  const c = read('../frontend/src/pages/Console.vue');
  // 会话：列表 + 撤销走 /api/me/sessions*（绝不调 admin 接口）
  assert.match(u, /api\('\/api\/me\/sessions\?limit=200'\)/, '会话列表 GET /api/me/sessions');
  assert.match(u, /api\(`\/api\/me\/sessions\/\$\{row\.id\}\/revoke`/, '撤销会话 POST /api/me/sessions/:id/revoke');
  assert.ok(!u.includes('/api/admin/sessions'), '普通用户会话页不得调 admin 接口');
  // 到价提醒：/api/watchlist（用户级）
  assert.match(u, /api\('\/api\/watchlist'\)/, '到价提醒 GET /api/watchlist');
  assert.match(u, /api\(`\/api\/watchlist\/\$\{row\.game_id\}`/, '取消提醒 DELETE /api/watchlist/:gameId');
  assert.ok(!u.includes('/api/admin/watchlist'), '普通用户到价提醒页不得调 admin 接口');
  // 愿望单：/api/me/wishlist + 移除走用户级 DELETE /api/wishlist/id/:gameId
  assert.match(u, /api\(`\/api\/me\/wishlist\?\$\{p\}`\)/, '愿望单 GET /api/me/wishlist（分页/搜索）');
  assert.match(u, /api\(`\/api\/wishlist\/id\/\$\{row\.game_id\}`/, '移除愿望单 DELETE /api/wishlist/id/:gameId');
  assert.ok(!u.includes('/api/admin/wishlists'), '普通用户愿望单页不得调 admin 接口');
  // 公告：/api/announcements + 已读 POST /api/announcements/read
  assert.match(u, /api\('\/api\/announcements'\)/, '公告 GET /api/announcements');
  assert.match(u, /api\('\/api\/announcements\/read'/, '已读 POST /api/announcements/read');
  assert.ok(!u.includes('/api/admin/announcements'), '普通用户公告页不得调 admin 接口');
  // 个人资料不变：Console 里 profile 仍渲染 ProfilePage（/api/me*，CX 批口径）
  assert.match(c, /<ProfilePage v-else-if="selected === 'profile'"/, '个人资料仍渲染 ProfilePage（接口不变）');
});

// ===== DT-5（docs/ADMIN-PERMISSIONS.md）：前后台入口 =====
// demo 状态 ↔ 断言（design/admin-menu-permissions-2026-11-19.html「前台顶栏」+
// design/admin-users-2026-11-19.html ④「全局顶栏」）：
//   ① 前台未登录只显示「登录」；已登录不显示退出/改密 → auth-pages.test.js DT-5 断言；
//   ② Console 全局顶栏（所有 section 共用）：版本徽标 + 用户徽标（FB：返回网站只在菜单里）→ 用例 1；
//   ③ 徽标下拉菜单树：个人资料/修改密码/返回网站/退出登录（普通用户同样可用）→ 用例 2；
//   ④ 退出后回到未登录态且心跳基线正确 → 用例 3（session-heartbeat.test.js 同步锁）。
// 反向自检：删掉 header-actions 里任一 el-dropdown-item 或把 doLogout 的 markSessionLoggedOut
// 删掉 → 对应断言红；把 user-chip 换成只读文字（无下拉）→ 用例 1 红。
test('DT-5 验收 1 + FB：Console 全局顶栏（所有 section 共用）右上「版本徽标 + 用户徽标」，返回网站单一入口', () => {
  const c = read('../frontend/src/pages/Console.vue');
  // FB（docs/CONSOLE-HEADER-FIX.md §2-1/§3-1）：顶栏「返回网站 ↗」按钮删除，
  // 只保留用户菜单里的入口（单一入口；菜单断言在下面验收 2）。
  assert.ok(!c.includes('header-back'), '顶栏不再有 header-back 按钮（FB 去重）');
  assert.match(c, /<el-dropdown-item command="site">返回网站 ↗<\/el-dropdown-item>/, '返回网站入口只保留在用户菜单');
  // FB（§2-2/§3-2）：版本徽标从「仅 admin」改为「所有登录用户可见」，移动端隐藏保持紧凑（§2-4）
  assert.match(c, /<span v-if="user && !isMobile" class="header-version"/, '版本徽标所有登录用户可见（移动端隐藏）');
  assert.match(c, /@click="loadVersion\(user\?\.role==='admin'\)"/, '普通用户点击只读缓存（force 仅管理员，§2-3）');
  // FB：进入控制台自动查一次版本（所有登录用户；走服务端缓存，接口本身也已对登录用户开放）
  assert.match(c, /if\(user\.value\)\{loadVersion\(false\);\}/, '所有登录用户进入控制台自动查一次版本');
  // 顶栏在 admin-header（每个 section 共用的外壳），不在任何具体 section 组件内
  assert.match(c, /class="header-actions"/, '顶栏操作区存在');
  assert.match(c, /class="user-chip header-userchip"/, '用户徽标');
  assert.match(c, /<UserAvatar :user-id="user\.id" :name="user\.displayName \|\| user\.username" :size="22"/, '徽标显示头像+昵称（EJ 口径）');
  assert.match(c, /<el-dropdown v-if="user" trigger="click"/, '徽标可点开下拉（登录用户）');
});

test('DT-5 验收 2：徽标下拉菜单树——个人资料/修改密码/返回网站/切换账户/退出登录（普通用户同样可用）', () => {
  const c = read('../frontend/src/pages/Console.vue');
  for (const item of ['command="profile"', 'command="password"', 'command="site"', 'command="switch"', 'command="logout"']) {
    assert.ok(c.includes(item), `菜单树含 ${item}`);
  }
  for (const label of ['个人资料', '修改密码', '返回网站 ↗', '切换账户', '退出登录']) {
    assert.ok(c.includes(`>${label}<`) || c.includes(`>${label}</span><`), `菜单文案 ${label}`);
  }
  // FA 批：菜单顺序与 demo 一致——个人资料 → 修改密码 → 返回网站 →（分隔线）切换账户 → 退出登录
  // 顺序在 <el-dropdown-menu> 片段内比较（全文 indexOf 会被侧栏/其它文案干扰）
  const menuBlock = c.match(/<el-dropdown-menu>([\s\S]*?)<\/el-dropdown-menu>/)?.[1] ?? '';
  const order = ['个人资料', '修改密码', '返回网站 ↗', '切换账户', '退出登录'].map((l) => menuBlock.indexOf(l));
  assert.ok(order.every((i) => i >= 0), '五项文案全部存在于用户菜单');
  assert.ok(order.every((v, i) => i === 0 || v > order[i - 1]), `菜单顺序与 demo 一致（实际序 ${order.join(' < ')}）`);
  // 分隔线在「切换账户」上（divided），退出登录紧随其后无分隔——demo 的 hr 位置
  assert.match(c, /command="switch" divided/, '分隔线在「切换账户」上方');
  assert.match(c, /command="logout"><span class="user-menu-danger">退出登录<\/span>/, '退出登录红字（demo 的 danger 项）');
  // 菜单树在全局顶栏（不区分 admin/user 角色条件）——普通用户同样可用
  assert.ok(!/el-dropdown[^>]*user\?\.role/.test(c), '菜单树不受角色条件限制（普通用户同样可用）');
  assert.match(c, /async function onUserCommand\(cmd\)/, '菜单命令分发');
  assert.match(c, /cmd==='password'[\s\S]{0,120}router\.push\('\/change-password'\)/, '修改密码 → /change-password');
  assert.match(c, /cmd==='switch'[\s\S]{0,80}doSwitchAccount\(\)/, '切换账户 → doSwitchAccount');
  assert.match(c, /cmd==='logout'[\s\S]{0,80}doLogout\(\)/, '退出登录 → doLogout');
});

test('FA 验收：切换账户退出会话 → /login?switch=1（next=原页面）→ 登录后回原页面；退出登录仍回首页', () => {
  const c = read('../frontend/src/pages/Console.vue');
  const login = read('../frontend/src/pages/LoginPage.vue');
  // 切换账户复用 /api/logout 清会话 + 心跳基线（BM-4），与退出登录同款兜底
  assert.match(c, /async function doSwitchAccount\(\)/, 'doSwitchAccount 存在');
  assert.match(c, /fetch\('\/api\/logout'/, '切换账户先 POST /api/logout 清会话');
  assert.match(c, /markSessionLoggedOut\(\)/, '切换账户标记心跳基线（防误判会话失效）');
  assert.match(c, /user\.value=null/, '切换账户清本地用户态');
  // 整页硬跳登录页统一走 openLogin（BM-3 唯一允许入口）：
  // switchAccount=1 → /login?switch=1&next=<当前页面>，登录成功后回原页面
  assert.match(c, /import \{ openLogin \} from '\.\.\/utils\/login-entry\.js'/, 'Console 引入统一硬跳入口 openLogin');
  assert.match(c, /openLogin\(\{ switchAccount: true \}\)/, '切换账户走 openLogin({switchAccount:true})（next 缺省=当前页面）');
  // 退出登录保持现状：回首页
  assert.match(c, /router\.replace\('\/'\)/, '退出登录仍回前台首页');
  // 登录页：?switch=1 显示「切换账户」提示，登录成功走 next（safeNext 已有白名单锁）
  assert.match(login, /route\.query\.switch === '1'/, '登录页识别 switch=1');
  assert.match(login, /switchHint/, 'switchHint 控制提示条');
  assert.match(login, /切换账户：已退出当前会话，请登录其他账号/, '切换账户提示文案');
  assert.match(login, /router\.replace\(safeNext\(\)\)/, '登录成功回 next（原页面）');
});

test('DT-5 验收 3：退出后回到未登录态且心跳基线正确', () => {
  const c = read('../frontend/src/pages/Console.vue');
  assert.match(c, /async function doLogout\(\)/, 'doLogout');
  assert.match(c, /fetch\('\/api\/logout'/, 'POST /api/logout 撤销会话');
  assert.match(c, /markSessionLoggedOut\(\);/, '主动退出标记心跳基线（BM-4，防心跳误判会话失效）');
  assert.match(c, /user\.value=null;/, '本地用户态清空（回到未登录态）');
  assert.match(c, /router\.replace\('\/'\)/, '退出后回前台首页');
});