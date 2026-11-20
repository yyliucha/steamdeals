// CO-5/B4-2 第十六轮（B4 队列 #13）：admin 图片域拆分的静态锁——
// 1) 四条路由分支在新文件 src/routes/admin-images.js（删任一分支即红）；
// 2) server.js 真实接线 handleAdminImagesAdmin（完整调用形态 + imgMissCache/startSteamJob/
//    startSteamJobImpl 引用字段 + 位置语义，删掉调用即红，防死模块）；
// 3) 旧分支不残留在 server.js（加回一条旧分支即红，防双实现）；
// 4) repository 签名与拆分前一致 + pg.js re-export + 旧定义不残留（防双实现）；
// 5) 跨模块共用 SQL（fillHeaderImage/missingHeaderImageAppids）留 pg.js 定义；
// 6) HTTP 冒烟：匿名 401、普通用户 403、管理员可用（契约零变化的行为验证）。
// 反向自检：删掉 admin-images.js 里任一路由分支 → 用例 1 红；删掉 server.js 接线 → 用例 2 红；
// 在 server.js 加回一条旧分支 → 用例 3 红；把 imageCoverageRows 定义加回 pg.js → 用例 4 红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';

process.env.CAPTCHA_ENABLED = '0';
process.env.RATE_LIMIT_ENABLED = '1';
process.env.RATE_LIMIT_PAGE_MAX = '10000';
process.env.RATE_LIMIT_API_MAX = '10000';
process.env.RATE_LIMIT_ASSET_MAX = '10000';
process.env.PATH_REVIEW_ENABLED = '0';

const WEB = fileURLToPath(new URL('../web', import.meta.url));
const AI_ROUTES = readFileSync(fileURLToPath(new URL('../src/routes/admin-images.js', import.meta.url)), 'utf8');
const AI_SERVER = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const AI_PG = readFileSync(fileURLToPath(new URL('../src/store/pg.js', import.meta.url)), 'utf8');
const AI_REPO = readFileSync(fileURLToPath(new URL('../src/store/admin-images-repository.js', import.meta.url)), 'utf8');

test('CO-5/B4-2 第十六轮：admin-images.js 四条路由分支齐全（删任一分支即红）', () => {
  assert.match(AI_ROUTES, /path === '\/api\/admin\/images' && req\.method === 'GET'/, 'images 缓存统计分支在新文件');
  assert.match(AI_ROUTES, /path === '\/api\/admin\/images\/reset-miss' && req\.method === 'POST'/, 'reset-miss 分支在新文件');
  assert.match(AI_ROUTES, /path === '\/api\/admin\/images\/coverage' && req\.method === 'GET'/, 'coverage 看板分支在新文件');
  assert.match(AI_ROUTES, /path === '\/api\/admin\/images\/backfill' && req\.method === 'POST'/, 'backfill 回填分支在新文件');
  // 路由模块不写 SQL 字面量（§15.1）：看板列表 SQL 已抽到 repository 的 imageCoverageMissingRows
  assert.ok(!/\bselect\s/.test(AI_ROUTES) && !/\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i.test(AI_ROUTES), '路由模块不内联 SQL');
  // requireAdmin 守卫逐条保留（401/403 文案由宿主守卫统一输出，契约不变）
  assert.equal((AI_ROUTES.match(/if \(!requireAdmin\(\)\) return true;/g) ?? []).length, 4, '四条路由都带 requireAdmin 守卫');
  // EC 批测试注入替身优先级保持：startSteamJobImpl ?? startSteamJob（拆分前同款表达式）
  assert.match(AI_ROUTES, /\(startSteamJobImpl \?\? startSteamJob\)\(\{/, 'backfill 启动替身优先级与拆分前一致');
  // 域专属取值：imageStats 走共享 images.js 模块、看板行/列表走 repository
  assert.match(AI_ROUTES, /images\.imageStats\(\)/, '缓存统计走共享 images.js');
  assert.match(AI_ROUTES, /db\.imageCoverageRows\(q\)/, '看板行走 repository（pg.js re-export 壳）');
  assert.match(AI_ROUTES, /db\.imageCoverageMissingRows\(q, \{/, '看板列表走 repository 新函数');
});

test('CO-5/B4-2 第十六轮：server.js 必须真实接线 handleAdminImagesAdmin（删掉调用即红，防死模块）', () => {
  assert.match(AI_SERVER, /import \{ handleAdminImagesAdmin \} from '\.\/routes\/admin-images\.js'/, 'server.js 必须导入域路由入口');
  // 锁「完整调用形态」：必须是 if (await handleXxx(...)) return;——只断言字符串存在会被 if(false) 包一层绕过；
  // 括号形态 = 参数对象闭合 + 调用闭合两层，正则用显式换行锚定（\}\)\s*\) 会卡在第一个 ) 上）。
  assert.match(
    AI_SERVER,
    /if \(\s*await handleAdminImagesAdmin\(\{[\s\S]{0,800}?path,[\s\S]{0,800}?req,[\s\S]{0,800}?res,[\s\S]{0,800}?url,[\s\S]{0,800}?q,[\s\S]{0,800}?logger,[\s\S]{0,800}?json,[\s\S]{0,800}?user,[\s\S]{0,800}?requireAdmin,[\s\S]{0,800}?imgMissCache,[\s\S]{0,800}?startSteamJob,[\s\S]{0,600}?startSteamJobImpl,[\s\S]{0,40}?\}\)\s*\n\s*\)\s*\n\s*return;/,
    '管理段接线（完整形态，且消费返回值）',
  );
  // 位置语义锁：调用必须在 requireAdmin 就绪之后的管理段——本域最早路由 images GET 的原位置
  // （DT-3 users POST 之后、公告管理接线之前，移动 = 改契约）
  assert.match(AI_SERVER, /管理员不再支持新建用户[\s\S]*?await handleAdminImagesAdmin\(\{/s, '接线在 DT-3 users POST 之后（本域原位置）');
  assert.match(AI_SERVER, /await handleAdminImagesAdmin\(\{[\s\S]*?await handleAnnouncementsAdmin\(\{/s, '接线在公告管理接线之前（本域原位置）');
});

test('CO-5/B4-2 第十六轮：admin-images 路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/path === '\/api\/admin\/images' && req\.method/.test(AI_SERVER), 'images 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/images\/reset-miss' && req\.method/.test(AI_SERVER), 'reset-miss 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/images\/coverage' && req\.method/.test(AI_SERVER), 'coverage 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/images\/backfill' && req\.method/.test(AI_SERVER), 'backfill 分支不得残留在 server.js');
  // 域内 helper 已随域移入模块
  assert.ok(!/const missByAppid =/.test(AI_SERVER), 'missByAppid 统计逻辑不得残留在 server.js');
  assert.ok(!/缺图集合 = header_image/.test(AI_SERVER), 'EC 看板注释段不得残留在 server.js');
  // imgMissCache 本体与 /img/ 代理路由仍是中间件/代理路由、留 server.js（§15.4，语义共享）
  assert.match(AI_SERVER, /const imgMissCache = new Map\(\)/, 'imgMissCache 本体留 server.js（/img/ 代理共用）');
  assert.match(AI_SERVER, /imgMissCache\.set\(key, \{ at: Date\.now\(\), kind \}\)/, '/img/ 代理负缓存写留 server.js');
});

test('CO-5/B4-2 第十六轮：admin-images-repository.js 签名不变 + pg.js re-export + 共用 SQL 留 pg.js（删 re-export 即红）', () => {
  // 搬家函数签名与拆分前一致（旧 db.* 导入签名不变）
  assert.match(AI_REPO, /export async function imageCoverageRows\(q\) \{/, 'imageCoverageRows 签名与拆分前一致');
  assert.match(AI_REPO, /steam_appid, g\.header_image from games g where g\.steam_appid is not null and not g\.deleted/, 'imageCoverageRows SQL 随函数搬家');
  // 域内联 SQL 抽出的新函数
  assert.match(AI_REPO, /export async function imageCoverageMissingRows\(q, \{ missAppids = \[\], pageSize = 50, offset = 0 \} = \{\}\)/, '看板列表内联 SQL 已抽 imageCoverageMissingRows');
  assert.match(AI_REPO, /g\.steam_appid::text = any\(\$1::text\[\]\)/, 'any($1::text[]) 谓词随函数搬家');
  assert.ok(!/create table/.test(AI_REPO), 'repository 不搬 DDL');
  // pg.js 必须 re-export（旧 db.* 导入签名不变；test 与 routes/admin-images.js 照旧走聚合壳）
  assert.match(AI_PG, /export \{ imageCoverageRows, imageCoverageMissingRows \} from '\.\/admin-images-repository\.js'/, 'pg.js 必须 re-export 两个函数');
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(!/export (async )?function imageCoverageRows/.test(AI_PG), 'pg.js 不允许保留旧函数定义（只许 re-export）');
  // 边界判据锁：跨模块共用图片 SQL 留在 pg.js（image-backfill.js 回填 / steam-status.js 顺带补齐共用）
  assert.match(AI_PG, /export async function fillHeaderImage\(q, \{ steamAppid, url \}\)/, 'fillHeaderImage 留 pg.js（image-backfill/steam-status 共用）');
  assert.match(AI_PG, /export async function missingHeaderImageAppids\(q, \{ limit = 100 \} = \{\}\)/, 'missingHeaderImageAppids 留 pg.js（image-backfill 共用）');
});

test('CO-5/B4-2 第十六轮：HTTP 冒烟——匿名 401、普通用户 403、管理员可访问全部 4 条路由（契约零变化）', async () => {
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
    await db.createUser(q, { username: 'alice', password: 'alice123456' });
    let backfillStarted = 0;
    const srv = await startApiServer({
      query: q,
      outDir: WEB,
      port: 0,
      host: '127.0.0.1',
      getSetupState: async () => ({ completed: true }),
      startSteamJobImpl: async ({ mode, args }) => {
        backfillStarted += 1;
        assert.equal(mode, 'images-backfill');
        assert.deepEqual(args, ['src/cli.js', 'images', 'backfill', '--limit', '100']);
        return { runId: 1, pid: 1 };
      },
    });
    try {
      const base = `http://127.0.0.1:${srv.port}`;
      const login = async (username, password) => {
        const res = await fetch(base + '/api/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.18.0.9' },
          body: JSON.stringify({ username, password }),
        });
        assert.equal(res.status, 200, `登录 ${username}`);
        return (res.headers.get('set-cookie') ?? '').split(';')[0];
      };
      // 匿名 401
      assert.equal((await fetch(base + '/api/admin/images')).status, 401, 'images 匿名 401');
      assert.equal((await fetch(base + '/api/admin/images/reset-miss', { method: 'POST' })).status, 401, 'reset-miss 匿名 401');
      assert.equal((await fetch(base + '/api/admin/images/coverage')).status, 401, 'coverage 匿名 401');
      assert.equal((await fetch(base + '/api/admin/images/backfill', { method: 'POST' })).status, 401, 'backfill 匿名 401');
      // 普通用户 403
      const aliceCookie = await login('alice', 'alice123456');
      assert.equal((await fetch(base + '/api/admin/images', { headers: { cookie: aliceCookie, 'x-forwarded-for': '198.18.0.9' } })).status, 403, 'images 普通用户 403');
      assert.equal((await fetch(base + '/api/admin/images/coverage', { headers: { cookie: aliceCookie, 'x-forwarded-for': '198.18.0.9' } })).status, 403, 'coverage 普通用户 403');
      // 管理员可访问
      const adminCookie = await login('admin', 'admin123456');
      const h = { cookie: adminCookie, 'x-forwarded-for': '198.18.0.9' };
      const stats = await (await fetch(base + '/api/admin/images', { headers: h })).json();
      assert.ok(stats.images && Number.isFinite(stats.images.games), 'images 返回缓存统计');
      const reset = await (await fetch(base + '/api/admin/images/reset-miss', { method: 'POST', headers: h })).json();
      assert.equal(typeof reset.cleared, 'number', 'reset-miss 返回 cleared');
      const cov = await (await fetch(base + '/api/admin/images/coverage', { headers: h })).json();
      assert.ok(cov.stats && cov.list && Array.isArray(cov.list.items), 'coverage 返回 stats+list');
      const bf = await fetch(base + '/api/admin/images/backfill', { method: 'POST', headers: h });
      assert.equal(bf.status, 202, 'backfill 管理员 202');
      assert.equal((await bf.json()).mode, 'images-backfill');
      assert.equal(backfillStarted, 1, '注入启动器被调用一次（startSteamJobImpl 优先级保持）');
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
  }
});
