// CO-5/B4-2 第十五轮（B4 队列 #12）：admin 报表备份日志域拆分的静态锁——
// 1) 六条路由分支在新文件 src/routes/admin-reports.js（删任一分支即红）；
// 2) server.js 真实接线 handleAdminReportsAdmin（完整调用形态 + 基座字段 + 位置语义，
//    删掉调用即红，防死模块）；
// 3) 旧分支不残留在 server.js（加回一条旧分支即红，防双实现）；
// 4) repository 存在且本域 SQL 归属正确（跨模块共用留 pg.js 定义、pg.js 不 re-export 新文件）；
// 5) steamLogMod 动态 import 已随域移出 server.js；
// 6) HTTP 冒烟：匿名 401、管理员可访问（拆到新文件后契约零变化的行为验证）。
// 反向自检：删掉 admin-reports.js 里任一路由分支 → 用例 1 红；删掉 server.js 接线 → 用例 2 红；
// 在 server.js 加回一条旧分支 → 用例 3 红；把 priceChanges 定义从 pg.js 删掉 → 用例 4 红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';

process.env.TRUST_PROXY = '1';
process.env.CAPTCHA_ENABLED = '0';
process.env.RATE_LIMIT_ENABLED = '1';
process.env.RATE_LIMIT_PAGE_MAX = '10000';
process.env.RATE_LIMIT_API_MAX = '10000';
process.env.RATE_LIMIT_ASSET_MAX = '10000';
process.env.PATH_REVIEW_ENABLED = '0';

const WEB = fileURLToPath(new URL('../web', import.meta.url));
const AR_ROUTES = readFileSync(fileURLToPath(new URL('../src/routes/admin-reports.js', import.meta.url)), 'utf8');
const AR_SERVER = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const AR_PG = readFileSync(fileURLToPath(new URL('../src/store/pg.js', import.meta.url)), 'utf8');
const AR_REPO_PATH = fileURLToPath(new URL('../src/store/admin-reports-repository.js', import.meta.url));

test('CO-5/B4-2 第十五轮：admin-reports.js 六条路由分支齐全（删任一分支即红）', () => {
  assert.match(AR_ROUTES, /path === '\/api\/admin\/backups' && req\.method === 'GET'/, 'backups 列表分支在新文件');
  assert.match(AR_ROUTES, /path === '\/api\/admin\/backup' && req\.method === 'POST'/, 'backup 手动备份分支在新文件');
  assert.match(AR_ROUTES, /path === '\/api\/admin\/logs' && req\.method === 'GET'/, 'logs 最近日志分支在新文件');
  assert.match(AR_ROUTES, /path === '\/api\/admin\/reports\/price' && req\.method === 'GET'/, 'reports/price 分支在新文件');
  assert.match(AR_ROUTES, /path === '\/api\/admin\/reports\/price\.csv' && req\.method === 'GET'/, 'reports/price.csv 分支在新文件');
  assert.match(AR_ROUTES, /path === '\/api\/admin\/steam-logs' && req\.method === 'GET'/, 'steam-logs 分支在新文件');
  // 路由模块不写 SQL 字面量（§15.1）：全部走 db.* 聚合壳 / steam-log.js / backup.js
  assert.ok(!/\bselect\s/.test(AR_ROUTES) && !/\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i.test(AR_ROUTES), '路由模块不内联 SQL');
  // requireAdmin 守卫逐条保留（401/403 文案由宿主守卫统一输出，契约不变）
  assert.equal((AR_ROUTES.match(/if \(!requireAdmin\(\)\) return true;/g) ?? []).length, 6, '六条路由都带 requireAdmin 守卫');
});

test('CO-5/B4-2 第十五轮：server.js 必须真实接线 handleAdminReportsAdmin（删掉调用即红，防死模块）', () => {
  assert.match(AR_SERVER, /import \{ handleAdminReportsAdmin \} from '\.\/routes\/admin-reports\.js'/, 'server.js 必须导入域路由入口');
  // 锁「完整调用形态」：必须是 if (await handleXxx(...)) return;——只断言字符串存在会被 if(false) 包一层绕过；
  // 这个形态锁住"调用且消费返回值结束响应"。括号形态 = 参数对象闭合 + 调用闭合两层，
  // 正则用显式换行锚定（\}\)\s*\) 会卡在第一个 ) 上）。
  assert.match(
    AR_SERVER,
    /if \(\s*await handleAdminReportsAdmin\(\{[\s\S]{0,800}?path,[\s\S]{0,800}?req,[\s\S]{0,800}?res,[\s\S]{0,800}?url,[\s\S]{0,800}?q,[\s\S]{0,800}?logger,[\s\S]{0,800}?json,[\s\S]{0,800}?user,[\s\S]{0,600}?requireAdmin,[\s\S]{0,40}?\}\)\s*\n\s*\)\s*\n\s*return;/,
    '管理段接线（完整形态，且消费返回值）',
  );
  // 位置语义锁：调用必须在 requireAdmin 就绪之后的管理段——本域最早路由 backups 的原位置
  // （admin-settings 接线之后、games/merge 之前；原 history.csv 段已随 B4 #21 games 域拆走，移动 = 改契约）
  assert.match(AR_SERVER, /await handleAdminSettingsAdmin\(\{[\s\S]*?await handleAdminReportsAdmin\(\{/s, '接线在 admin-settings 之后（本域原位置）');
  assert.match(AR_SERVER, /await handleAdminReportsAdmin\(\{[\s\S]*?合并重复游戏/s, '接线在 admin games/merge 之前（本域原位置）');
});

test('CO-5/B4-2 第十五轮：admin-reports 路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/path === '\/api\/admin\/backups' && req\.method/.test(AR_SERVER), 'backups 分支不得残留在 server.js');
  // 中间件豁免（isTimeoutExemptPath）允许 path === '/api/admin/backup' 但不带 method——路由分支必须带 method
  assert.ok(!/path === '\/api\/admin\/backup' && req\.method/.test(AR_SERVER), 'backup 分支不得残留在 server.js（超时豁免中间件留宿主）');
  assert.ok(!/path === '\/api\/admin\/logs' && req\.method/.test(AR_SERVER), 'logs 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/reports\/price' && req\.method/.test(AR_SERVER), 'reports/price 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/reports\/price\.csv' && req\.method/.test(AR_SERVER), 'reports/price.csv 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/steam-logs' && req\.method/.test(AR_SERVER), 'steam-logs 分支不得残留在 server.js');
  // 域内 helper 已随域移入模块
  assert.ok(!/const scopeOf =/.test(AR_SERVER), 'scopeOf 定义不得残留在 server.js');
  // steamLogMod 动态 import 与 backup.js 函数调用已随域移出 server.js
  assert.ok(!/const steamLogMod = await import/.test(AR_SERVER), 'steamLogMod 动态 import 不得残留在 server.js');
  assert.ok(!/listBackups\(|createBackup\(/.test(AR_SERVER), 'backup.js 函数调用不得残留在 server.js');
  // 超时豁免中间件保留（§15.4：手动备份是长任务，豁免统一请求超时看门狗）
  assert.match(AR_SERVER, /path === '\/api\/admin\/backup'\) return true;/, 'backup 超时豁免留 server.js（中间件）');
});

test('CO-5/B4-2 第十五轮：admin-reports-repository.js 存在 + 本域 SQL 归属正确（共用留 pg.js 定义，pg.js 不 re-export 新文件）', () => {
  assert.ok(existsSync(AR_REPO_PATH), 'repository 文件必须存在（§15.1 每域一对文件）');
  const repo = readFileSync(AR_REPO_PATH, 'utf8');
  assert.match(repo, /零函数搬家/, '归属判定：本域零 SQL 搬家记录在 repository');
  assert.ok(!/create table/.test(repo), 'repository 不搬 DDL');
  // priceChanges/priceChangeRows/dailyMinSeriesBatch 跨模块共用（cli/sync.js、cli/report.js、
  // games 域 history.csv）→ pg.js 保留定义（不是 re-export）
  assert.match(AR_PG, /export async function priceChanges\(/, 'priceChanges 留 pg.js 定义（cli 共用）');
  assert.match(AR_PG, /export async function priceChangeRows\(/, 'priceChangeRows 留 pg.js 定义（cli 共用）');
  assert.match(AR_PG, /export async function dailyMinSeriesBatch\(/, 'dailyMinSeriesBatch 留 pg.js 定义（history.csv 共用）');
  // pg.js 不得 re-export 本域 repository（本域零搬家，无 re-export 壳）
  assert.ok(!/admin-reports-repository/.test(AR_PG), 'pg.js 不 re-export 本域 repository（零搬家）');
});

test('CO-5/B4-2 第十五轮：HTTP 冒烟——匿名 401、管理员可访问全部 6 条路由（契约零变化）', async () => {
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
    const srv = await startApiServer({
      query: q,
      outDir: WEB,
      port: 0,
      host: '127.0.0.1',
      getSetupState: async () => ({ completed: true }),
    });
    try {
      const base = `http://127.0.0.1:${srv.port}`;
      // 匿名 401：6 条路由全部拦截
      for (const p of ['/api/admin/backups', '/api/admin/logs', '/api/admin/reports/price', '/api/admin/reports/price.csv', '/api/admin/steam-logs']) {
        assert.equal((await fetch(base + p)).status, 401, `${p} 匿名 401`);
      }
      assert.equal((await fetch(base + '/api/admin/backup', { method: 'POST' })).status, 401, 'backup 匿名 401');
      // 管理员登录
      const login = await fetch(base + '/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.18.0.9' },
        body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
      });
      assert.equal(login.status, 200, '管理员登录');
      const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
      // 管理员可访问：backups 数组 / logs entries / reports report+series / steam-logs entries+total
      const j = await (await fetch(base + '/api/admin/backups', { headers: { cookie, 'x-forwarded-for': '198.18.0.9' } })).json();
      assert.ok(Array.isArray(j.backups), 'backups 返回数组');
      const l = await (await fetch(base + '/api/admin/logs', { headers: { cookie, 'x-forwarded-for': '198.18.0.9' } })).json();
      assert.ok(Array.isArray(l.entries) && Number.isFinite(l.count), 'logs 返回 entries+count');
      const r = await (await fetch(base + '/api/admin/reports/price', { headers: { cookie, 'x-forwarded-for': '198.18.0.9' } })).json();
      assert.ok(r.report && typeof r.series === 'object', 'reports/price 返回 report+series');
      const csv = await fetch(base + '/api/admin/reports/price.csv', { headers: { cookie, 'x-forwarded-for': '198.18.0.9' } });
      assert.equal(csv.status, 200, 'price.csv 管理员 200');
      assert.match(await csv.text(), /^appid,name,platform/, 'price.csv 表头');
      const s = await (await fetch(base + '/api/admin/steam-logs', { headers: { cookie, 'x-forwarded-for': '198.18.0.9' } })).json();
      assert.ok(Array.isArray(s.entries) && Number.isFinite(s.total), 'steam-logs 返回 entries+total');
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
  }
});
