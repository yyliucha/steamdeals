// CO-5/B4-2 第十五轮（B4 队列 #12）：admin 报表备份日志域拆分的静态锁——
// 1) 八条路由分支在新文件 src/routes/admin-reports.js（FR 批新增 backups/:name 下载/删除，删任一分支即红）；
// 2) server.js 真实接线 handleAdminReportsAdmin（完整调用形态 + 基座字段 + 位置语义，
//    删掉调用即红，防死模块）；
// 3) 旧分支不残留在 server.js（加回一条旧分支即红，防双实现）；
// 4) repository 存在且本域 SQL 归属正确（跨模块共用留 pg.js 定义、pg.js 不 re-export 新文件）；
// 5) steamLogMod 动态 import 已随域移出 server.js；
// 6) HTTP 冒烟：匿名 401、管理员可访问（拆到新文件后契约零变化的行为验证）；
// 7) FR 批 HTTP 冒烟：列表带 mtime+backupEnabled、下载流、删除、路径穿越 404、开关校验。
// 反向自检：删掉 admin-reports.js 里任一路由分支 → 用例 1 红；删掉 server.js 接线 → 用例 2 红；
// 在 server.js 加回一条旧分支 → 用例 3 红；把 priceChanges 定义从 pg.js 删掉 → 用例 4 红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureSettingsSchema } from '../src/settings.js';

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

test('CO-5/B4-2 第十五轮：admin-reports.js 八条路由分支齐全（删任一分支即红）', () => {
  assert.match(AR_ROUTES, /path === '\/api\/admin\/backups' && req\.method === 'GET'/, 'backups 列表分支在新文件');
  assert.match(AR_ROUTES, /path === '\/api\/admin\/backup' && req\.method === 'POST'/, 'backup 手动备份分支在新文件');
  assert.match(AR_ROUTES, /path\.startsWith\('\/api\/admin\/backups\/'\) && req\.method === 'GET'/, 'FR 批：backups/:name 下载分支在新文件');
  assert.match(AR_ROUTES, /path\.startsWith\('\/api\/admin\/backups\/'\) && req\.method === 'DELETE'/, 'FR 批：backups/:name 删除分支在新文件');
  assert.match(AR_ROUTES, /path === '\/api\/admin\/logs' && req\.method === 'GET'/, 'logs 最近日志分支在新文件');
  assert.match(AR_ROUTES, /path === '\/api\/admin\/reports\/price' && req\.method === 'GET'/, 'reports/price 分支在新文件');
  assert.match(AR_ROUTES, /path === '\/api\/admin\/reports\/price\.csv' && req\.method === 'GET'/, 'reports/price.csv 分支在新文件');
  assert.match(AR_ROUTES, /path === '\/api\/admin\/steam-logs' && req\.method === 'GET'/, 'steam-logs 分支在新文件');
  // 路由模块不写 SQL 字面量（§15.1）：全部走 db.* 聚合壳 / steam-log.js / backup.js
  assert.ok(!/\bselect\s/.test(AR_ROUTES) && !/\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i.test(AR_ROUTES), '路由模块不内联 SQL');
  // requireAdmin 守卫逐条保留（401/403 文案由宿主守卫统一输出，契约不变）
  assert.equal((AR_ROUTES.match(/if \(!requireAdmin\(\)\) return true;/g) ?? []).length, 8, '八条路由都带 requireAdmin 守卫');
  // FR 批：备份文件名白名单锁（防路径穿越——:name 只接受 backup-YYYY-MM-DD.json.gz）
  assert.match(AR_ROUTES, /BACKUP_NAME_RE = \/\^backup-\\d\{4\}-\\d\{2\}-\\d\{2\}\\\.json\\\.gz\$\/;/, '下载/删除共用严格文件名白名单');
  // FR 批：POST 手动备份受 system.backupEnabled 开关校验（false → 403「备份功能已关闭」）
  assert.match(AR_ROUTES, /system\.backupEnabled.*=== false/, 'POST backup 开关校验');
  assert.match(AR_ROUTES, /备份功能已关闭/, '开关关闭时 403 文案「备份功能已关闭」');
  // FR 批：列表响应带 mtime 与 backupEnabled（前端按此禁用按钮/显示时间）
  assert.match(AR_ROUTES, /backupEnabled: settings\.values\['system\.backupEnabled'\] !== false/, '列表响应带 backupEnabled');
  assert.match(AR_ROUTES, /mtime = statSync\(b\.path\)\.mtime\.toISOString\(\)/, '列表项带 mtime');
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
  // （admin-settings 接线之后、admin-sync 之前；games/merge 已随 B4 #17 games 域拆到
  // routes/admin-games.js，server.js 不再有该文本——位置语义改锁 admin-sync 前置）。
  assert.match(AR_SERVER, /await handleAdminSettingsAdmin\(\{[\s\S]*?await handleAdminReportsAdmin\(\{/s, '接线在 admin-settings 之后（本域原位置）');
  assert.match(AR_SERVER, /await handleAdminReportsAdmin\(\{[\s\S]*?await handleAdminSyncAdmin\(\{/s, '接线在 admin-sync 之前（本域原位置）');
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

test('CO-5/B4-2 第十五轮：HTTP 冒烟——匿名 401、管理员可访问全部 8 条路由（契约零变化）', async () => {
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
      // 匿名 401：8 条路由全部拦截
      for (const p of ['/api/admin/backups', '/api/admin/logs', '/api/admin/reports/price', '/api/admin/reports/price.csv', '/api/admin/steam-logs']) {
        assert.equal((await fetch(base + p)).status, 401, `${p} 匿名 401`);
      }
      assert.equal((await fetch(base + '/api/admin/backup', { method: 'POST' })).status, 401, 'backup 匿名 401');
      assert.equal((await fetch(base + '/api/admin/backups/backup-2026-11-25.json.gz')).status, 401, 'backups/:name 下载匿名 401');
      assert.equal((await fetch(base + '/api/admin/backups/backup-2026-11-25.json.gz', { method: 'DELETE' })).status, 401, 'backups/:name 删除匿名 401');
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

// FR 批（docs/BACKUP-AS-FEATURE.md §3）：备份下载/删除/穿越/开关的行为锁——
// 用临时 BACKUP_DIR 造文件（不动 data/backup 真实目录），逐条验证：
//   列表带 mtime+backupEnabled → 下载 200 且内容一致 → 非法名/穿越 404 → 删除 200 且列表少一项。
test('FR：备份下载/删除/路径穿越/开关校验（真实 HTTP 行为）', async () => {
  const tmpDir = fileURLToPath(new URL('../test/.tmp-backups-fr', import.meta.url));
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const good = 'backup-2026-11-25.json.gz';
  const payload = Buffer.from('fake-gzip-body-123');
  writeFileSync(`${tmpDir}/${good}`, payload);
  process.env.BACKUP_DIR = tmpDir;
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    // FR 批：backupEnabled 走 app_settings 表——开关校验需要 settings schema 就绪
    await ensureSettingsSchema(store);
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
      const login = await fetch(base + '/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.18.0.9' },
        body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
      });
      const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
      const hdr = { cookie, 'x-forwarded-for': '198.18.0.9' };

      // 列表：带 mtime 与 backupEnabled（默认 true——settings.js 默认 false 的改动在 FP 合流后生效，
      // 此处锁「响应结构带开关字段」，默认值变化不破坏前端 `!== false` 判读）
      const list = await (await fetch(base + '/api/admin/backups', { headers: hdr })).json();
      assert.equal(list.backups.length, 1, '列表含造出的 1 份备份');
      assert.equal(list.backups[0].name, good, '列表项名');
      assert.ok(list.backups[0].size > 0 && typeof list.backups[0].mtime === 'string', '列表项带 size 与 mtime');
      assert.equal(typeof list.backupEnabled, 'boolean', '响应带 backupEnabled 开关');

      // 下载：200 + 附件头 + 内容一致
      const dl = await fetch(base + `/api/admin/backups/${good}`, { headers: hdr });
      assert.equal(dl.status, 200, '下载 200');
      assert.match(dl.headers.get('content-disposition') ?? '', /attachment; filename=/, '附件下载头');
      assert.deepEqual(Buffer.from(await dl.arrayBuffer()), payload, '下载内容一致');

      // 路径穿越与非法名一律 404，不落到文件系统外
      for (const bad of ['../package.json', '..%2Fpackage.json', '%2e%2e%2fpackage.json', 'etc%2Fpasswd', 'backup-2026-11-25.json', 'backup-2026-11-25.json.gz%00.html', 'x']) {
        const res = await fetch(base + `/api/admin/backups/${bad}`, { headers: hdr });
        assert.equal(res.status, 404, `非法名 ${bad} → 404`);
      }
      assert.equal(existsSync(`${tmpDir}/package.json`), false, '穿越尝试未写出文件');
      const del404 = await fetch(base + '/api/admin/backups/..%2Fpackage.json', { method: 'DELETE', headers: hdr });
      assert.equal(del404.status, 404, '穿越删除 404');
      assert.equal(existsSync(fileURLToPath(new URL('../package.json', import.meta.url))), true, '仓库根 package.json 未被穿越删除');

      // 删除：200 + 列表少一项 + 磁盘文件消失
      const del = await (await fetch(base + `/api/admin/backups/${good}`, { method: 'DELETE', headers: hdr })).json();
      assert.equal(del.deleted, good, '删除响应带文件名');
      assert.equal(del.backups.length, 0, '删除后列表为空');
      assert.equal(existsSync(`${tmpDir}/${good}`), false, '磁盘文件已删除');

      // 开关关闭（system.backupEnabled=false 写库）→ POST 403「备份功能已关闭」
      await q(`insert into app_settings (key, value, updated_at) values ('system.backupEnabled', 'false'::jsonb, now())
               on conflict (key) do update set value = excluded.value`, []);
      const off = await (await fetch(base + '/api/admin/backup', { method: 'POST', headers: { ...hdr, 'content-type': 'application/json' }, body: '{}' })).json();
      assert.equal(off.error, '备份功能已关闭：请先在系统设置开启「允许后台手动备份」', '开关关闭 POST 403 文案');
      const offStatus = await fetch(base + '/api/admin/backup', { method: 'POST', headers: { ...hdr, 'content-type': 'application/json' }, body: '{}' });
      assert.equal(offStatus.status, 403, '开关关闭 POST 403 状态码');
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.BACKUP_DIR;
  }
});
