// CO-5/B4-2 第十七轮（B4 队列 #15）：admin 游戏目录域拆分的静态锁——
// 1) 五条路由分支在新文件 src/routes/admin-games.js（删任一分支即红）；
// 2) server.js 真实接线 handleAdminGamesAdmin（完整调用形态 + runGated/adminGamesCache/
//    invalidateAdminGamesCache/invalidateListCache/adminCacheTtlMs 引用字段 + 位置语义，
//    删掉调用即红，防死模块）；
// 3) 旧分支不残留在 server.js（加回一条旧分支即红，防双实现）；
// 4) repository 签名与拆分前一致 + pg.js re-export + 旧定义不残留（防双实现）；
// 5) 跨模块共用 SQL 留 pg.js 定义（gameKeywordSql/gameDetail/mergeGames/backfillCandidateWhere）；
// 6) DV 批 ITAD 平台筛选 SQL 片段逐字随域搬入 repository（不回退）；
// 7) HTTP 冒烟：匿名 401、普通用户 403、管理员可用（契约零变化的行为验证）。
// 反向自检：删掉 admin-games.js 里任一路由分支 → 用例 1 红；删掉 server.js 接线 → 用例 2 红；
// 在 server.js 加回一条旧分支 → 用例 3 红；把 adminGameStats 定义加回 pg.js → 用例 4 红。
// 注：AG 批平台链接的行为测试在 test/admin-games.test.js（既有文件不动），本文件只放拆分锁。
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
const AG_ROUTES = readFileSync(fileURLToPath(new URL('../src/routes/admin-games.js', import.meta.url)), 'utf8');
const AG_SERVER = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const AG_PG = readFileSync(fileURLToPath(new URL('../src/store/pg.js', import.meta.url)), 'utf8');
const AG_REPO = readFileSync(fileURLToPath(new URL('../src/store/admin-games-repository.js', import.meta.url)), 'utf8');

test('CO-5/B4-2 第十七轮：admin-games.js 五条路由分支齐全（删任一分支即红）', () => {
  assert.match(AG_ROUTES, /path === '\/api\/admin\/games\/stats' && req\.method === 'GET'/, 'stats 概览分支在新文件');
  assert.match(AG_ROUTES, /path === '\/api\/admin\/games' && req\.method === 'GET'/, 'games 列表分支在新文件');
  assert.match(AG_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/games\\\/\(\\d\+\)\\\/links\$\/\)/, 'links 分支在新文件');
  assert.match(AG_ROUTES, /path === '\/api\/admin\/games\/deleted' && req\.method === 'GET'/, 'deleted 回收站分支在新文件');
  assert.match(AG_ROUTES, /path === '\/api\/admin\/games\/merge' && req\.method === 'POST'/, 'merge 合并分支在新文件');
  // 路由模块不写 SQL 字面量（§15.1）：列表 count/rows、平台筛选与 where 片段、links 守卫行都抽到 repository
  assert.ok(!/\bselect\s/.test(AG_ROUTES) && !/\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i.test(AG_ROUTES), '路由模块不内联 SQL');
  // requireAdmin 守卫逐条保留（401/403 文案由宿主守卫统一输出，契约不变）
  assert.equal((AG_ROUTES.match(/if \(!requireAdmin\(\)\) return true;/g) ?? []).length, 5, '五条路由都带 requireAdmin 守卫');
  // B1/B2 语义保持：并发闸键与上限、缓存 TTL 判定与拆分前一致
  assert.match(AG_ROUTES, /runGated\('GET \/api\/admin\/games', 1, async \(\) => \{/, '并发闸键与上限保持（B1 批）');
  assert.match(AG_ROUTES, /gamesCacheNow - adminGamesCache\.at < adminCacheTtlMs/, '短缓存 TTL 判定保持（B2 批）');
  // merge 语义保持：写操作后失效后台短缓存 + DX 批前台列表缓存
  assert.match(AG_ROUTES, /invalidateAdminGamesCache\(\);\s*\n\s*invalidateListCache\(\);/, 'merge 后双缓存失效保持');
});

test('CO-5/B4-2 第十七轮：server.js 必须真实接线 handleAdminGamesAdmin（删掉调用即红，防死模块）', () => {
  assert.match(AG_SERVER, /import \{ handleAdminGamesAdmin \} from '\.\/routes\/admin-games\.js'/, 'server.js 必须导入域路由入口');
  // 锁「完整调用形态」：必须是 if (await handleXxx(...)) return;——只断言字符串存在会被 if(false) 包一层绕过；
  // 括号形态 = 参数对象闭合 + 调用闭合两层，正则用显式换行锚定（\}\)\s*\) 会卡在第一个 ) 上）。
  assert.match(
    AG_SERVER,
    /if \(\s*await handleAdminGamesAdmin\(\{[\s\S]{0,800}?path,[\s\S]{0,800}?req,[\s\S]{0,800}?res,[\s\S]{0,800}?url,[\s\S]{0,800}?q,[\s\S]{0,800}?logger,[\s\S]{0,800}?json,[\s\S]{0,800}?readBody,[\s\S]{0,800}?user,[\s\S]{0,800}?requireAdmin,[\s\S]{0,800}?runGated,[\s\S]{0,800}?adminGamesCache,[\s\S]{0,800}?invalidateAdminGamesCache,[\s\S]{0,800}?invalidateListCache,[\s\S]{0,600}?adminCacheTtlMs,[\s\S]{0,40}?\}\)\s*\n\s*\)\s*\n\s*return;/,
    '管理段接线（完整形态，且消费返回值）',
  );
  // 位置语义锁：调用必须在 requireAdmin 就绪之后的管理段——本域最早路由 stats 的原位置
  // （wishlists 段之后、admin watchlist 段之前，移动 = 改契约）
  assert.match(AG_SERVER, /listWishlists\(q, \{ limit, keyword, userId: filterUserId \}\)[\s\S]*?await handleAdminGamesAdmin\(\{/s, '接线在 wishlists 段之后（本域原位置）');
  assert.match(AG_SERVER, /await handleAdminGamesAdmin\(\{[\s\S]*?管理员：到价提醒/s, '接线在 admin watchlist 段之前（本域原位置）');
});

test('CO-5/B4-2 第十七轮：admin-games 路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/path === '\/api\/admin\/games\/stats' && req\.method/.test(AG_SERVER), 'stats 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/games' && req\.method/.test(AG_SERVER), 'games 列表分支不得残留在 server.js');
  assert.ok(!/const linkMatch = path\.match/.test(AG_SERVER), 'links 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/games\/deleted' && req\.method/.test(AG_SERVER), 'deleted 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/games\/merge' && req\.method/.test(AG_SERVER), 'merge 分支不得残留在 server.js');
  // 域内 helper 已随域移入模块
  assert.ok(!/const platformCond =/.test(AG_SERVER), 'DV 批 platformCond 不得残留在 server.js（随域入 repository）');
  assert.ok(!/const adminGamesPayload =/.test(AG_SERVER), '列表 payload 组装不得残留在 server.js');
  // 中间件/共享状态留宿主（§15.4/语义共享）
  assert.match(AG_SERVER, /'GET \/api\/admin\/games': 1,/, 'HEAVY_GATE_CONFIG 闸键留 server.js（共享配置）');
  assert.match(AG_SERVER, /const adminGamesCache = \{ value: null, key: null, at: 0 \};/, 'adminGamesCache 本体留 server.js（多域共享）');
});

test('CO-5/B4-2 第十七轮：admin-games-repository.js 签名不变 + pg.js re-export + 共用 SQL 留 pg.js（删 re-export 即红）', () => {
  // 搬家函数签名与拆分前一致（旧 db.* 导入签名不变）
  assert.match(AG_REPO, /export async function adminGameStats\(q\) \{/, 'adminGameStats 签名与拆分前一致');
  assert.match(AG_REPO, /export async function adminGameLinks\(q, \{ gameId \}\)/, 'adminGameLinks 签名与拆分前一致');
  assert.match(AG_REPO, /export async function listDeletedGames\(q, \{ limit = 200 \} = \{\}\)/, 'listDeletedGames 签名与拆分前一致');
  // 域内联 SQL 抽出的新函数
  assert.match(AG_REPO, /export function adminGamesPlatformCond\(platform, index\)/, 'DV 批平台筛选片段已抽 adminGamesPlatformCond');
  assert.match(AG_REPO, /export function adminGamesWhereParts\(\{ deletedParam = 'exclude', offersParam = '', sync = '', statusParam = '', ratingParam = '' \} = \{\}\)/, 'where 片段集合已抽 adminGamesWhereParts');
  assert.match(AG_REPO, /export async function listAdminGames\(q, \{ kw = '', deletedWhere = '', offersWhere = '', syncWhere = '', ratingWhere = '', platform = '', pageSize = 20, offset = 0 \}\)/, '列表 count+rows 已抽 listAdminGames');
  assert.match(AG_REPO, /export async function adminGameLinkRow\(q, gameId\)/, 'links 守卫行已抽 adminGameLinkRow');
  // DV 批 ITAD 来源判定 SQL 逐字保持（拆分只移动不改行为）
  assert.match(AG_REPO, /game_source_sync gs where gs\.game_id = g\.id and gs\.platform_code = 'itad' and gs\.status = 'matched'/, 'DV 批 ITAD 来源判定片段逐字保持');
  assert.ok(!/create table/.test(AG_REPO), 'repository 不搬 DDL');
  // pg.js 必须 re-export（旧 db.* 导入签名不变；test 与 routes/admin-games.js 照旧走聚合壳）
  assert.match(AG_PG, /export \{\s*adminGameStats,[\s\S]{0,400}?adminGamesWhereParts,[\s\S]{0,300}?adminGameLinkRow,[\s\S]{0,200}?\} from '\.\/admin-games-repository\.js'/, 'pg.js 必须 re-export 七个函数');
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(!/export (async )?function adminGameStats/.test(AG_PG), 'pg.js 不允许保留 adminGameStats 定义（只许 re-export）');
  assert.ok(!/export (async )?function adminGameLinks/.test(AG_PG), 'pg.js 不允许保留 adminGameLinks 定义（只许 re-export）');
  assert.ok(!/export (async )?function listDeletedGames/.test(AG_PG), 'pg.js 不允许保留 listDeletedGames 定义（只许 re-export）');
  // 边界判据锁：跨模块共用 SQL 留在 pg.js（#21 域搜索 / CLI merge / align 域共用）
  assert.match(AG_PG, /export function gameKeywordSql\(kwParam, \{ appidAsInt = false, appidAsText = false, tokenCond = null \} = \{\}\)/, 'gameKeywordSql 留 pg.js（#21 域共用片段）');
  assert.match(AG_PG, /export function backfillCandidateWhere\(\{ includeCooldown = true, includeSkip = true, excludeStates = true \} = \{\}\)/, 'backfillCandidateWhere 留 pg.js（CLI 回填共用）');
  assert.match(AG_PG, /export async function mergeGames\(/, 'mergeGames 留 pg.js（CLI/align 共用）');
});

test('CO-5/B4-2 第十七轮：HTTP 冒烟——匿名 401、普通用户 403、管理员可访问（契约零变化）', async () => {
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
    await db.createUser(q, { username: 'alice', password: 'alice123456' });
    await db.ensureGame(q, { steamAppid: 998001, name: 'AG Test A' });
    await db.ensureGame(q, { steamAppid: 998002, name: 'AG Test B' });
    const srv = await startApiServer({
      query: q,
      outDir: WEB,
      port: 0,
      host: '127.0.0.1',
      getSetupState: async () => ({ completed: true }),
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
      for (const p of ['/api/admin/games/stats', '/api/admin/games', '/api/admin/games/deleted']) {
        assert.equal((await fetch(base + p)).status, 401, `${p} 匿名 401`);
      }
      assert.equal((await fetch(base + '/api/admin/games/1/links')).status, 401, 'links 匿名 401');
      assert.equal((await fetch(base + '/api/admin/games/merge', { method: 'POST' })).status, 401, 'merge 匿名 401');
      // 普通用户 403
      const aliceCookie = await login('alice', 'alice123456');
      assert.equal((await fetch(base + '/api/admin/games', { headers: { cookie: aliceCookie, 'x-forwarded-for': '198.18.0.9' } })).status, 403, 'games 普通用户 403');
      assert.equal((await fetch(base + '/api/admin/games/stats', { headers: { cookie: aliceCookie, 'x-forwarded-for': '198.18.0.9' } })).status, 403, 'stats 普通用户 403');
      // 管理员可访问
      const adminCookie = await login('admin', 'admin123456');
      const h = { cookie: adminCookie, 'x-forwarded-for': '198.18.0.9' };
      const stats = await (await fetch(base + '/api/admin/games/stats', { headers: h })).json();
      assert.ok(stats.stats && Number.isFinite(stats.stats.total) && stats.stats.total >= 2, 'stats 返回概览');
      const list = await (await fetch(base + '/api/admin/games?page=1&pageSize=5', { headers: h })).json();
      assert.ok(Number.isFinite(list.total) && Array.isArray(list.games), 'games 列表返回 total+games');
      const links = await (await fetch(base + '/api/admin/games/999999/links', { headers: h })).json();
      assert.equal(links.error, '没有该游戏', 'links 不存在的游戏 404 文案');
      const del = await (await fetch(base + '/api/admin/games/deleted', { headers: h })).json();
      assert.ok(Array.isArray(del.games), 'deleted 返回数组');
      // merge：源和目标同一个 → 400 文案（不真合并，避免动数据）
      const mergeSame = await fetch(base + '/api/admin/games/merge', {
        method: 'POST',
        headers: { ...h, 'content-type': 'application/json' },
        body: JSON.stringify({ fromAppid: 998001, toAppid: 998001 }),
      });
      assert.equal(mergeSame.status, 400);
      assert.match((await mergeSame.json()).error, /同一个游戏/, 'merge 同源 400 文案');
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
  }
});
