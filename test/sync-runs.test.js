// 手动同步任务记录：落库生命周期、中断标记、状态/记录接口权限。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';

// 测试里关掉登录验证码
process.env.CAPTCHA_ENABLED = '0';

test('同步记录：插入 → 完成 → 列表 → 重启中断标记', async () => {
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);

    const run = await db.insertSyncRun(q, { mode: 'steamall', args: 'src/cli.js sync steamall --limit 200' });
    assert.ok(run.id > 0, '要返回任务 id');
    const running = await db.runningSyncRun(q);
    assert.equal(running.id, run.id, '刚开始应处于运行中');

    await db.finishSyncRun(q, run.id, { status: 'ok', exitCode: 0, output: '完成：200 条元数据' });
    const list = await db.listSyncRuns(q, { limit: 10 });
    assert.equal(list.length, 1);
    assert.equal(list[0].status, 'ok');
    assert.equal(list[0].exit_code, 0);
    assert.match(list[0].output, /200 条元数据/);
    assert.ok(list[0].finished_at, '结束时间要写入');
    assert.equal(await db.runningSyncRun(q), null, '完成后不再是 running');

    // 服务重启残留：running 记录被标成失败，避免同步按钮永远禁用
    const r2 = await db.insertSyncRun(q, { mode: 'catalog' });
    assert.equal((await db.runningSyncRun(q)).id, r2.id);
    assert.equal(await db.markStaleSyncRuns(q), 1);
    const row = (await q('select status, output from sync_runs where id = $1', [r2.id])).rows[0];
    assert.equal(row.status, 'failed');
    assert.match(row.output, /服务重启/);

    // CO-1/A5：任务失败原因——最近一条 failed 记录的输出；成功记录/别的 mode 不命中
    await db.insertSyncRun(q, { mode: 'app-sync', args: 'src/cli.js app-sync' }).then((r) =>
      db.finishSyncRun(q, r.id, { status: 'failed', exitCode: 1, output: 'App Release 同步失败：network' }),
    );
    assert.equal(await db.lastFailedSyncRun(q, 'app-sync'), 'App Release 同步失败：network', '取该 mode 最近失败原因');
    assert.equal(await db.lastFailedSyncRun(q, 'steam-prices'), null, '别的 mode 不命中');
  } finally {
    await store.close();
  }
});

test('B3 实测耗时：sync_runs 成功运行平均秒，失败行与样本不足的 mode 不参与', async () => {
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    // steam-prices：两条成功（30s/90s → 平均 60s）+ 一条失败 1000s（不参与）
    for (const [sec, status] of [[30, 'ok'], [90, 'ok'], [1000, 'failed']]) {
      const r = await db.insertSyncRun(q, { mode: 'steam-prices' });
      await q("update sync_runs set started_at = now() - ($1 || ' seconds')::interval where id = $2", [String(sec), r.id]);
      await db.finishSyncRun(q, r.id, { status, exitCode: status === 'ok' ? 0 : 1 });
    }
    // heat：只有 1 条成功 → 样本不足（minRuns=2）不回传，预算回落理论值
    const h = await db.insertSyncRun(q, { mode: 'heat' });
    await q("update sync_runs set started_at = now() - interval '10 seconds' where id = $1", [h.id]);
    await db.finishSyncRun(q, h.id, { status: 'ok', exitCode: 0 });
    const map = await db.observedSyncRunSeconds(q);
    assert.equal(map.size, 1, '只有样本达标的 mode 回传');
    const sec = map.get('steam-prices');
    assert.ok(Math.abs(sec - 60) < 0.5, `平均应为 60s，实际 ${sec}`);
    assert.equal(map.get('heat'), undefined, '样本不足不回传（minRuns=2）');
  } finally {
    await store.close();
  }
});

test('回填接口：匿名 401，管理员空状态，未运行时停止返回 409', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    assert.equal((await fetch(base + '/api/admin/backfill/status')).status, 401, '匿名不能看回填状态');
    assert.equal(
      (await fetch(base + '/api/admin/backfill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status,
      401,
      '匿名不能启动回填',
    );

    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

    const st = await (await fetch(base + '/api/admin/backfill/status', { headers: { cookie } })).json();
    assert.equal(st.running, false);
    assert.equal(st.busy, false);
    assert.equal(st.progress, null);
    assert.equal(st.last, null);

    // 没有任务在跑时，停止应明确拒绝而不是静默成功
    const stop = await fetch(base + '/api/admin/backfill/stop', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(stop.status, 409);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('重写名字接口：匿名 401，管理员空状态，未运行时停止返回 409', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    assert.equal((await fetch(base + '/api/admin/rename/status')).status, 401, '匿名不能看重写名字状态');
    assert.equal(
      (await fetch(base + '/api/admin/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status,
      401,
      '匿名不能启动重写名字',
    );

    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

    const st = await (await fetch(base + '/api/admin/rename/status', { headers: { cookie } })).json();
    assert.equal(st.running, false);
    assert.equal(st.busy, false);
    assert.equal(st.progress, null);
    assert.equal(st.last, null);

    const stop = await fetch(base + '/api/admin/rename/stop', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(stop.status, 409, '没有任务在跑时停止应明确拒绝');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('同步状态/记录接口：匿名 401，管理员 200，未运行 running=false', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    assert.equal((await fetch(base + '/api/admin/sync/status')).status, 401, '匿名不能看同步状态');
    assert.equal((await fetch(base + '/api/admin/sync/runs')).status, 401, '匿名不能看同步记录');

    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

    const st = await (await fetch(base + '/api/admin/sync/status', { headers: { cookie } })).json();
    assert.equal(st.running, false);
    assert.equal(st.run, null);
    assert.equal(st.output, '');
    assert.equal(st.last, null);

    const runs = await (await fetch(base + '/api/admin/sync/runs?limit=5', { headers: { cookie } })).json();
    assert.deepEqual(runs.runs, []);
  } finally {
    await srv.close();
    await store.close();
  }
});

// ============================================================ CO-5/B4-2 第九轮静态锁
// admin-sync 域（B4 #9：sync/heat/backfill/rename/circuit）从 server.js/pg.js 巨石拆出后，
// 四组静态断言按新落点指向：
//   · 路由分支 → src/routes/admin-sync.js；
//   · 域专属 SQL → src/store/admin-sync-repository.js；pg.js 必须 re-export
//     （旧 db.* 导入签名不变），无 DDL 搬家（sync_runs 表跨模块共用：cli/scheduler/启动清理）；
//   · server.js 只留单入口接线（管理段），且必须真实调用——删掉调用即红（防死模块）；
//   · 旧分支不得残留在 server.js（防双实现）。
// 反向自检口径：删掉 routes/admin-sync.js 任一路由分支 → 第 1 组断言红；
// 删掉 server.js 的入口接线 → 第 2 组红；把分支抄回 server.js → 第 3 组红；
// 删 pg.js re-export → 第 4 组红。

const AS_ROUTES = readFileSync(fileURLToPath(new URL('../src/routes/admin-sync.js', import.meta.url)), 'utf8');
const AS_REPO = readFileSync(fileURLToPath(new URL('../src/store/admin-sync-repository.js', import.meta.url)), 'utf8');
const AS_SERVER = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const AS_PG = readFileSync(fileURLToPath(new URL('../src/store/pg.js', import.meta.url)), 'utf8');

test('CO-5/B4-2 第九轮：admin-sync 路由分支全部在 src/routes/admin-sync.js（管理段单入口，删任一支即红）', () => {
  // sync 三条
  assert.match(AS_ROUTES, /path === '\/api\/admin\/sync' && req\.method === 'POST'/, 'sync 启动分支在新文件');
  assert.match(AS_ROUTES, /path === '\/api\/admin\/sync\/status' && req\.method === 'GET'/, 'sync/status 分支在新文件');
  assert.match(AS_ROUTES, /path === '\/api\/admin\/sync\/runs' && req\.method === 'GET'/, 'sync/runs 分支在新文件');
  // circuit 一条
  assert.match(AS_ROUTES, /path === '\/api\/admin\/circuit\/reset' && req\.method === 'POST'/, 'circuit/reset 分支在新文件');
  // backfill 三条
  assert.match(AS_ROUTES, /path === '\/api\/admin\/backfill' && req\.method === 'POST'/, 'backfill 启动分支在新文件');
  assert.match(AS_ROUTES, /path === '\/api\/admin\/backfill\/stop' && req\.method === 'POST'/, 'backfill/stop 分支在新文件');
  assert.match(AS_ROUTES, /path === '\/api\/admin\/backfill\/status' && req\.method === 'GET'/, 'backfill/status 分支在新文件');
  // heat 三条
  assert.match(AS_ROUTES, /path === '\/api\/admin\/heat' && req\.method === 'POST'/, 'heat 启动分支在新文件');
  assert.match(AS_ROUTES, /path === '\/api\/admin\/heat\/stop' && req\.method === 'POST'/, 'heat/stop 分支在新文件');
  assert.match(AS_ROUTES, /path === '\/api\/admin\/heat\/status' && req\.method === 'GET'/, 'heat/status 分支在新文件');
  // rename 三条
  assert.match(AS_ROUTES, /path === '\/api\/admin\/rename' && req\.method === 'POST'/, 'rename 启动分支在新文件');
  assert.match(AS_ROUTES, /path === '\/api\/admin\/rename\/stop' && req\.method === 'POST'/, 'rename/stop 分支在新文件');
  assert.match(AS_ROUTES, /path === '\/api\/admin\/rename\/status' && req\.method === 'GET'/, 'rename/status 分支在新文件');
  // 单入口形态（§15.3 位置语义：管理段）
  assert.match(AS_ROUTES, /export async function handleAdminSyncAdmin\(ctx\)/, '管理段入口');
  // 守卫与语义随路由
  assert.match(AS_ROUTES, /if \(!requireAdmin\(\)\) return true/, '管理段守卫');
  assert.match(AS_ROUTES, /new Set\(\['catalog', 'steam-prices', 'steamall', 'itad', 'gog', 'humble', 'sonkwo'\]\)/, 'CC 批四源 MODES 随路由');
  assert.match(AS_ROUTES, /err\.code === 'BUSY'/, '409 互斥语义随路由（startSteamJob BUSY）');
  assert.match(AS_ROUTES, /error: '当前没有运行中的任务'/, 'stop 无任务 409 语义随路由');
  assert.match(AS_ROUTES, /error: '缺少任务名'/, 'circuit/reset 缺名 400 语义随路由');
  assert.match(AS_ROUTES, /child\.kill\('SIGTERM'\)/, 'SIGTERM + 10s SIGKILL 停止语义随路由');
  assert.match(AS_ROUTES, /ctx\.startSteamJob|startSteamJob\(\{ mode/, '任务启动走宿主闭包 startSteamJob（语义共享）');
  assert.match(AS_ROUTES, /syncState\.(child|run|output|stopRequested)/, '槽位状态读写走 syncState 持有对象（语义共享）');
  assert.match(AS_ROUTES, /invalidateSyncStatusCache\(\)/, '任务启停/熔断重置后缓存失效语义随路由');
  assert.match(AS_ROUTES, /await import\('\.\.\/backfill\.js'\)/, 'backfill 工具动态导入路径已修正为 ../backfill.js');
  assert.match(AS_ROUTES, /resetCircuit\(name\)/, '熔断重置走 scheduler.js resetCircuit');
  // 路由模块只做编排：不许出现 SQL 字面量（全部走 repository）
  assert.ok(!/select |insert |update |delete from /.test(AS_ROUTES), 'routes/admin-sync.js 不写 SQL 字面量');
  // 未命中返回 false，宿主继续
  assert.match(AS_ROUTES, /return false;/, '未命中返回 false，宿主继续');
});

test('CO-5/B4-2 第九轮：server.js 必须真实接线管理段入口（删掉调用即红，防死模块）', () => {
  assert.match(AS_SERVER, /import \{ handleAdminSyncAdmin \} from '\.\/routes\/admin-sync\.js'/, 'server.js 必须导入域路由入口');
  // 锁「完整调用形态」：必须是 if (await handleXxx(...)) return;——只断言字符串存在会被 if(false) 包一层绕过
  assert.match(AS_SERVER, /if \(\s*await handleAdminSyncAdmin\(\{[\s\S]{0,1200}?path,[\s\S]{0,1200}?req,[\s\S]{0,1200}?res,[\s\S]{0,1200}?syncStatusTtlMs,[\s\S]{0,600}?\}\)\s*\)\s*return;/, '管理段接线（完整形态，且消费返回值）');
  // 管理段 ctx 关键字段必须传齐：漏传 url 分页参数丢失、漏传 requireAdmin 守卫失效、
  // 漏传 user 审计落空、漏传 startSteamJob/syncState 槽位分家、漏传缓存字段状态漂移
  assert.match(AS_SERVER, /await handleAdminSyncAdmin\(\{[\s\S]{0,1200}?url,/);
  assert.match(AS_SERVER, /await handleAdminSyncAdmin\(\{[\s\S]{0,1200}?requireAdmin,/);
  assert.match(AS_SERVER, /await handleAdminSyncAdmin\(\{[\s\S]{0,1200}?user,/);
  assert.match(AS_SERVER, /await handleAdminSyncAdmin\(\{[\s\S]{0,1200}?startSteamJob,/);
  assert.match(AS_SERVER, /await handleAdminSyncAdmin\(\{[\s\S]{0,1200}?syncState,/);
  assert.match(AS_SERVER, /await handleAdminSyncAdmin\(\{[\s\S]{0,1200}?syncStatusCache,/);
  assert.match(AS_SERVER, /await handleAdminSyncAdmin\(\{[\s\S]{0,1200}?invalidateSyncStatusCache,/);
  assert.match(AS_SERVER, /await handleAdminSyncAdmin\(\{[\s\S]{0,1200}?syncStatusTtlMs,/);
  // 位置语义锁：调用必须在 requireAdmin 就绪之后的管理段——本域最早路由 sync POST 的原位置
  // （games 域主段接线之后、#10 admin-settings 接线之前；users 邮箱绑定段已随 B4 #11 拆走、
  // logs 段已随 B4 #12 拆走，锚点改为下一段 admin-access 接线）
  assert.match(AS_SERVER, /await handleGamesRoutes\(\{[\s\S]*?await handleAdminSyncAdmin\(\{/s, '接线在 games 域主段接线之后（本域原位置）');
  assert.match(AS_SERVER, /await handleAdminSyncAdmin\(\{[\s\S]*?await handleAdminAccessAdmin\(\{/s, '接线在 admin-access 接线之前（本域原位置，users/logs 段已随 #11/#12 拆走）');
});

test('CO-5/B4-2 第九轮：admin-sync 路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/path === '\/api\/admin\/sync' && req\.method/.test(AS_SERVER), 'sync 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/sync\/status' && req\.method/.test(AS_SERVER), 'sync/status 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/sync\/runs' && req\.method/.test(AS_SERVER), 'sync/runs 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/circuit\/reset' && req\.method/.test(AS_SERVER), 'circuit/reset 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/backfill' && req\.method/.test(AS_SERVER), 'backfill 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/backfill\/stop' && req\.method/.test(AS_SERVER), 'backfill/stop 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/backfill\/status' && req\.method/.test(AS_SERVER), 'backfill/status 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/heat' && req\.method/.test(AS_SERVER), 'heat 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/heat\/stop' && req\.method/.test(AS_SERVER), 'heat/stop 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/heat\/status' && req\.method/.test(AS_SERVER), 'heat/status 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/rename' && req\.method/.test(AS_SERVER), 'rename 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/rename\/stop' && req\.method/.test(AS_SERVER), 'rename/stop 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/rename\/status' && req\.method/.test(AS_SERVER), 'rename/status 分支不得残留在 server.js');
  // 边界锁：其它 admin 域路由留宿主（#10 smtp/emails 与 #11 bulk 已拆到 routes/admin-settings.js / routes/admin-users.js、#12 steam-logs 已拆到 routes/admin-reports.js、#16 wishlists）
  assert.match(AS_SERVER, /await handleAdminUsersAdmin\(\{/, 'admin bulk 段已随 admin-users 域拆到 routes/admin-users.js（B4 #11）');
  assert.match(AS_SERVER, /await handleAdminReportsAdmin\(\{/, 'admin steam-logs 段已随 admin-reports 域拆到 routes/admin-reports.js（B4 #12）');
  assert.match(AS_SERVER, /await handleAdminWatchlistAdmin\(\{/, 'admin wishlists 段已随 admin-watchlist 域拆到 routes/admin-watchlist.js（B4 #16）');
  // 中间件判据锁：sync/status|runs 访问日志豁免留 server.js（isLoggablePath 是中间件，§15.4）
  assert.match(AS_SERVER, /path === '\/api\/admin\/sync\/status' \|\| path === '\/api\/admin\/sync\/runs'/, 'sync/status|runs 访问日志豁免留 server.js（中间件）');
});

test('CO-5/B4-2 第九轮：admin-sync-repository.js 签名不变 + pg.js re-export（删 re-export 即红）', () => {
  // 搬家函数签名与拆分前一致（旧 db.* 导入签名不变）
  assert.match(AS_REPO, /export async function listSyncRuns\(q, \{ limit = 20 \} = \{\}\)/, 'listSyncRuns 签名与拆分前一致');
  assert.match(AS_REPO, /left join lateral/, 'fetch_runs 汇总 lateral join 随函数搬家');
  // pg.js 必须 re-export（旧 db.* 导入签名不变；test 与 routes/admin-sync.js 照旧走聚合壳）
  assert.match(AS_PG, /export \{ listSyncRuns \} from '\.\/admin-sync-repository\.js'/, 'pg.js 必须 re-export listSyncRuns');
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(!/export (async )?function listSyncRuns/.test(AS_PG), 'pg.js 不允许保留旧函数定义（只许 re-export）');
  // 边界判据锁：跨模块共用 SQL 与 DDL 留在 pg.js（cli.js / scheduler.js / 启动清理共用）
  assert.match(AS_PG, /create table if not exists sync_runs \(/, 'sync_runs 表 DDL 留 pg.js');
  assert.match(AS_PG, /export async function insertSyncRun\(q, \{ mode, args = null \}\)/, 'insertSyncRun 留 pg.js（cli.js 同步命令共用）');
  assert.match(AS_PG, /export async function finishSyncRun\(q, id, \{ status = 'ok', exitCode = null, output = null \}\)/, 'finishSyncRun 留 pg.js（cli.js 同步命令共用）');
  assert.match(AS_PG, /export async function runningSyncRun\(q\)/, 'runningSyncRun 留 pg.js（scheduler.js 互斥共用）');
  assert.match(AS_PG, /export async function markStaleSyncRuns\(q\)/, 'markStaleSyncRuns 留 pg.js（server.js 启动清理共用）');
  assert.match(AS_PG, /export async function sourceSyncStats\(q\)/, 'sourceSyncStats 留 pg.js（cli.js 进度条共用）');
  assert.match(AS_PG, /export async function observedSyncRunSeconds\(q, \{ sinceDays = 30, minRuns = 2 \} = \{\}\)/, 'observedSyncRunSeconds 留 pg.js（scheduler 预算共用）');
  assert.match(AS_PG, /export async function lastFailedSyncRun\(q, mode\)/, 'lastFailedSyncRun 留 pg.js（scheduler 失败原因共用）');
  assert.match(AS_PG, /export async function lastSyncRunStartedByMode\(q\)/, 'lastSyncRunStartedByMode 留 pg.js（scheduler 重启恢复共用）');
  // repository 不搬家 DDL
  assert.ok(!/create table/.test(AS_REPO), 'admin-sync-repository.js 不搬家 DDL');
});
