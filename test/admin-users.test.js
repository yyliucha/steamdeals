// DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：用户管理打磨——
// ① POST /api/admin/users 建号入口下线（410，用户只能自助注册）；
// ② 编辑弹窗数据：GET /api/admin/users/:username/steam-accounts 只读展示绑定账号；
// ③ PATCH 角色变更 / 禁用启用落审计（admin.user_edit / admin.user_disabled）；
// ④ 单条禁用立即踢会话（BK-1 复用，DT-3 保留验收）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureEmailSchema } from '../src/email-auth.js';
import { ensureSteamSchema } from '../src/steam-login.js';

process.env.CAPTCHA_ENABLED = '0';

async function setup() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store); // users.email 列 + users_email_uniq 部分唯一索引（生产同款）
  await ensureSteamSchema(store); // steam_accounts（DT-3 编辑弹窗绑定账号展示用）
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  const alice = (await q("select id from users where username = 'alice'")).rows[0];
  await q(
    "insert into steam_accounts (steam_id, persona_name, alias, user_id) values ('76561198000000011', 'FF', null, $1), ('76561198000000012', 'Happy', '主号', $1)",
    [alice.id],
  );
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  return { store, q, srv, base: `http://127.0.0.1:${srv.port}`, alice };
}

const login = async (base, username, password) => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
};

test('DT-3：POST /api/admin/users 建号接口下线——匿名 401、普通用户 403、管理员 410 且不建号', async () => {
  const { store, q, srv, base } = await setup();
  try {
    const before = (await q('select count(*)::int as n from users')).rows[0].n;
    const post = (cookie) =>
      fetch(`${base}/api/admin/users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify({ username: 'bob', password: 'k7Qw!2mXp3nZ', role: 'user', email: 'bob@example.com' }),
      });
    assert.equal((await post(null)).status, 401, '匿名 401');
    const alice = await login(base, 'alice', 'alice123456');
    assert.equal((await post(alice.cookie)).status, 403, '普通用户 403');
    const admin = await login(base, 'admin', 'admin123456');
    const res = await post(admin.cookie);
    // 反向自检：把 410 改回建号逻辑 → 这里变 201，断言变红（DT-3 验收「无新建入口/接口」）
    assert.equal(res.status, 410, '管理员触发 → 410 Gone（接口下线）');
    assert.match((await res.json()).error, /自助注册/);
    const after = (await q('select count(*)::int as n from users')).rows[0].n;
    assert.equal(after, before, '410 不产生任何用户');
    assert.equal((await q("select count(*)::int as n from users where username = 'bob'")).rows[0].n, 0);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('DT-3：编辑弹窗绑定账号只读数据——昵称 + SteamID，未绑定为空数组；权限 401/403/404', async () => {
  const { store, srv, base } = await setup();
  try {
    const get = (cookie) => fetch(`${base}/api/admin/users/alice/steam-accounts`, { headers: cookie ? { cookie } : {} });
    assert.equal((await get(null)).status, 401, '匿名 401');
    const bob = await login(base, 'alice', 'alice123456');
    assert.equal((await get(bob.cookie)).status, 403, '普通用户 403');
    const admin = await login(base, 'admin', 'admin123456');
    const res = await get(admin.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.accounts.length, 2);
    assert.deepEqual(
      body.accounts.map((a) => [a.steamId, a.alias, a.personaName]),
      [
        ['76561198000000011', null, 'FF'],
        ['76561198000000012', '主号', 'Happy'],
      ],
      '昵称 + SteamID（别名优先展示由前端决定）',
    );
    assert.equal((await fetch(`${base}/api/admin/users/nobody/steam-accounts`, { headers: { cookie: admin.cookie } })).status, 404, '无此用户 404');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('DT-3：PATCH 角色变更落审计 admin.user_edit；禁用落 admin.user_disabled 且会话立即失效（BK 复用）', async () => {
  const { store, q, srv, base, alice } = await setup();
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const patch = (username, body) =>
      fetch(`${base}/api/admin/users/${username}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify(body),
      });
    // 先给 alice 造一条会话（模拟已登录）
    await q("insert into sessions (user_id, token, expires_at, ip) values ($1, 'dt3-token', now() + interval '1 day', '1.2.3.4')", [alice.id]);
    // 角色变更
    const role = await patch('alice', { role: 'admin' });
    assert.equal(role.status, 200);
    assert.equal((await q("select role from users where username = 'alice'")).rows[0].role, 'admin');
    const audit1 = await q("select detail from audit_logs where action = 'admin.user_edit' and target = 'alice'");
    assert.equal(audit1.rows.length, 1, '角色变更落 admin.user_edit 审计');
    assert.deepEqual(audit1.rows[0].detail, { field: 'role', from: 'user', to: 'admin' });
    // 禁用：会话立即失效（BK-1 复用）
    const dis = await patch('alice', { disabled: true });
    assert.equal(dis.status, 200);
    const audit2 = await q("select detail from audit_logs where action = 'admin.user_disabled' and target = 'alice'");
    assert.equal(audit2.rows.length, 1, '禁用落 admin.user_disabled 审计');
    assert.deepEqual(audit2.rows[0].detail, { disabled: true });
    const sessions = await q("select count(*)::int as n from sessions where user_id = $1", [alice.id]);
    assert.equal(sessions.rows[0].n, 0, '禁用后会话立即清空（下一次请求即退出登录）——验收⑤');
  } finally {
    await srv.close();
    await store.close();
  }
});

// ============================================================ CO-5/B4-2 第十六轮静态锁
// admin-users 域（B4 #11：后台用户批量 /api/admin/users*、bulk、bulk-ops + DT-4 后台重置
// 密码发码）从 server.js/pg.js 巨石拆出后，四组静态断言按新落点指向：
//   · 路由分支 → src/routes/admin-users.js（管理段单入口，16 组路由 + bulk 派发表随域移入）；
//   · 域专属 SQL → src/store/admin-users-repository.js；pg.js 必须 re-export（旧 db.* 导入
//     签名不变），无 DDL 搬家（users/admin_bulk_ops 等表 DDL 在 pg.js SCHEMA，跨模块共用）；
//   · server.js 只留单入口接线（管理段），且必须真实调用——删掉调用即红（防死模块）；
//   · 旧分支不得残留在 server.js（防双实现）。
// 反向自检口径：删掉 routes/admin-users.js 任一路由分支 → 第 1 组断言红；删掉 server.js 的
// 入口接线 → 第 2 组红；把分支抄回 server.js → 第 3 组红；删 pg.js re-export → 第 4 组红。
// 边界判定：只拆 /api/admin/users*、bulk、bulk-ops 与 DT-4 reset-code/password——
// /api/admin/games*（B4 #15）、/api/admin/images*（B4 #13）、admin 报表/备份/日志（B4 #12）、
// /api/user/sessions/revoke-others（前台主段）留 server.js；banIpExclusiveSql 跨域共用
// （admin-access 域单条封禁/信任）留 server.js（§15.4 判据）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const AU_ROUTES = readFileSync(fileURLToPath(new URL('../src/routes/admin-users.js', import.meta.url)), 'utf8');
const AU_REPO = readFileSync(fileURLToPath(new URL('../src/store/admin-users-repository.js', import.meta.url)), 'utf8');
const AU_SERVER = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const AU_PG = readFileSync(fileURLToPath(new URL('../src/store/pg.js', import.meta.url)), 'utf8');

test('CO-5/B4-2 第十六轮：admin-users 路由分支全部在 src/routes/admin-users.js（管理段单入口，删任一支即红）', () => {
  // users CRUD 与安全兜底
  assert.match(AU_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/users\\\/\(\[\^\/\]\+\)\\\/sessions\$\/\)/, 'kickAll 分支在新文件');
  assert.match(AU_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/users\\\/\(\[\^\/\]\+\)\\\/email\\\/code\$\/\)/, 'email/code 发码分支在新文件');
  assert.match(AU_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/users\\\/\(\[\^\/\]\+\)\\\/email\\\/verify\$\/\)/, 'email/verify 校验分支在新文件');
  assert.match(AU_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/users\\\/\(\[\^\/\]\+\)\$\/\)/, 'userMatch 分支在新文件');
  assert.match(AU_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/users\\\/\(\[\^\/\]\+\)\\\/steam-accounts\$\/\)/, 'steam-accounts 只读分支在新文件（DT-3）');
  assert.match(AU_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/users\\\/\(\[\^\/\]\+\)\\\/reset-code\$\/\)/, 'reset-code 发码分支在新文件（DT-4）');
  assert.match(AU_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/users\\\/\(\[\^\/\]\+\)\\\/password\$\/\)/, 'password 重置分支在新文件（DT-4）');
  assert.match(AU_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/users\\\/\(\[\^\/\]\+\)\\\/unlock\$\/\)/, 'unlock 分支在新文件');
  assert.match(AU_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/users\\\/\(\[\^\/\]\+\)\\\/email\$\/\)/, 'email 绑定分支在新文件');
  assert.match(AU_ROUTES, /path === '\/api\/admin\/users' && req\.method === 'GET'/, 'users 列表分支在新文件');
  assert.match(AU_ROUTES, /path === '\/api\/admin\/users\/deletions' && req\.method === 'GET'/, 'deletions 分支在新文件');
  assert.match(AU_ROUTES, /path === '\/api\/admin\/users' && req\.method === 'POST'/, 'users POST（DT-3 下线 410）分支在新文件');
  // bulk 三条
  assert.match(AU_ROUTES, /path === '\/api\/admin\/bulk' && req\.method === 'POST'/, 'bulk 分支在新文件');
  assert.match(AU_ROUTES, /path === '\/api\/admin\/bulk-ops' && req\.method === 'GET'/, 'bulk-ops 列表分支在新文件');
  assert.match(AU_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/bulk-ops\\\/\(\\d\+\)\$\/\)/, 'bulk-ops/:id 分支在新文件');
  // 单入口形态（§15.3 位置语义：管理段）
  assert.match(AU_ROUTES, /export async function handleAdminUsersAdmin\(ctx\)/, '管理段入口');
  // 守卫与语义随路由
  assert.match(AU_ROUTES, /if \(!requireAdmin\(\)\) return true/, '管理段守卫');
  assert.match(AU_ROUTES, /return \(json\(res, 410, \{ error: '管理员不再支持新建用户，请用户自助注册' \}\), true\);/, 'DT-3 建号下线 410 语义随路由');
  assert.match(AU_ROUTES, /error: '验证码已过期，请重新发送'/, 'DT-4 验证码过期 400 语义随路由');
  assert.match(AU_ROUTES, /error: limit\.reason === 'cooldown' \? `请 \$\{limit\.retryAfterSec\} 秒后再试`/, 'DT-4 冷却 429 语义随路由');
  assert.match(AU_ROUTES, /tempPassword: generated, message: '密码已重置/, 'DT-4 验证码重置成功语义随路由');
  assert.match(AU_ROUTES, /error: '不能删除最后一个可用管理员'|'不能禁用最后一个可用管理员'/, '删除/禁用守卫文案随路由');
  assert.match(AU_ROUTES, /confirmCount !== keys\.length/, 'bulk 高危二次确认语义随路由');
  assert.match(AU_ROUTES, /const BULK_ACTIONS = \{/, 'bulk 白名单派发表随域移入模块');
  assert.match(AU_ROUTES, /'users\/kick': \{ max: 200, risk: 'high', keyType: 'id', run: bulkUserKick \}/, 'DT-3 批量只留踢会话条目随域移入');
  assert.match(AU_ROUTES, /banIpExclusive\(review\.ip,/, 'bulk 审核封禁经 ctx.banIpExclusive（语义共享）');
  assert.match(AU_ROUTES, /await import\('\.\.\/email-auth\.js'\)/, 'email-auth 动态导入路径已修正为 ../email-auth.js');
  assert.match(AU_ROUTES, /await import\('\.\.\/notify\.js'\)/, 'notify 动态导入路径已修正为 ../notify.js');
  // 路由模块只做编排：不许出现 SQL 字面量（全部走 repository）
  assert.ok(!/select |insert |update |delete from |alter table/.test(AU_ROUTES), 'routes/admin-users.js 不写 SQL 字面量');
  // 未命中返回 false，宿主继续
  assert.match(AU_ROUTES, /return false;/, '未命中返回 false，宿主继续');
});

test('CO-5/B4-2 第十六轮：server.js 必须真实接线管理段入口（删掉调用即红，防死模块）', () => {
  assert.match(AU_SERVER, /import \{ handleAdminUsersAdmin \} from '\.\/routes\/admin-users\.js'/, 'server.js 必须导入域路由入口');
  // 锁「完整调用形态」：必须是 if (await handleAdminUsersAdmin(...)) return;
  assert.match(AU_SERVER, /if \(\s*await handleAdminUsersAdmin\(\{[\s\S]{0,1400}?path,[\s\S]{0,1400}?req,[\s\S]{0,1400}?res,[\s\S]{0,1400}?invalidateListCache,[\s\S]{0,400}?\}\)\s*\)\s*return;/, '管理段接线（完整形态，且消费返回值）');
  // ctx 关键字段必须传齐：漏传 url 分页参数丢失、漏传 requireAdmin 守卫失效、漏传 user 审计落空、
  // 漏传 token kickAll 自我会话保护失效、漏传 ip 审计落空、漏传 appealEmail 模板联系人缺失、
  // 漏传 banIpExclusive 与 admin-access 域口径分家、漏传缓存字段 bulk 写后缓存漂移
  assert.match(AU_SERVER, /await handleAdminUsersAdmin\(\{[\s\S]{0,1400}?url,/);
  assert.match(AU_SERVER, /await handleAdminUsersAdmin\(\{[\s\S]{0,1400}?requireAdmin,/);
  assert.match(AU_SERVER, /await handleAdminUsersAdmin\(\{[\s\S]{0,1400}?user,/);
  assert.match(AU_SERVER, /await handleAdminUsersAdmin\(\{[\s\S]{0,1400}?token,/);
  assert.match(AU_SERVER, /await handleAdminUsersAdmin\(\{[\s\S]{0,1400}?ip,/);
  assert.match(AU_SERVER, /await handleAdminUsersAdmin\(\{[\s\S]{0,1400}?appealEmail,/);
  assert.match(AU_SERVER, /await handleAdminUsersAdmin\(\{[\s\S]{0,1400}?banIpExclusive,/);
  assert.match(AU_SERVER, /await handleAdminUsersAdmin\(\{[\s\S]{0,1400}?invalidateAdminGamesCache,/);
  assert.match(AU_SERVER, /await handleAdminUsersAdmin\(\{[\s\S]{0,1400}?invalidateListCache,/);
  // 位置语义锁：调用必须在 requireAdmin 就绪后的管理段——本域最早路由 kickAll 的原位置
  // （handleAdminSessionsAdmin 之后、前台 revoke-others 之前）
  assert.match(AU_SERVER, /await handleAdminSessionsAdmin\(\{[\s\S]*?await handleAdminUsersAdmin\(\{/s, '接线在 admin-sessions 接线之后（本域原位置）');
  assert.match(AU_SERVER, /await handleAdminUsersAdmin\(\{[\s\S]*?path === '\/api\/user\/sessions\/revoke-others' && req\.method === 'POST'/s, '接线在 revoke-others 之前（本域原位置）');
  // 边界锁：其它域路由与跨域 helper 留宿主
  assert.match(AU_SERVER, /path === '\/api\/admin\/games' && req\.method === 'GET'/, 'admin games 段留 server.js（B4 #15）');
  assert.match(AU_SERVER, /await handleAdminImagesAdmin\(\{/, 'admin images 段已拆到 routes/admin-images.js（B4 #13，随 main 合并带入）');
  assert.match(AU_SERVER, /await handleAdminReportsAdmin\(\{/, 'admin reports/backup/logs 段已拆到 routes/admin-reports.js（B4 #12，随 main 合并带入）');
  assert.match(AU_SERVER, /path === '\/api\/user\/sessions\/revoke-others' && req\.method === 'POST'/, 'revoke-others 留 server.js（前台主段）');
  assert.match(AU_SERVER, /async function banIpExclusiveSql\(q, ip, note, kind/, 'banIpExclusiveSql 留 server.js（admin-access 域共用，§15.4）');
  assert.match(AU_SERVER, /await handleAdminAccessAdmin\(\{/, 'admin-access 接线留 server.js（B4 #8，不受本域拆分影响）');
});

test('CO-5/B4-2 第十六轮：admin-users 路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/const kickAllMatch = path\.match/.test(AU_SERVER), 'kickAll 分支不得残留在 server.js');
  assert.ok(!/const bindCode = path\.match/.test(AU_SERVER), 'email/code 分支不得残留在 server.js');
  assert.ok(!/const bindVerify = path\.match/.test(AU_SERVER), 'email/verify 分支不得残留在 server.js');
  assert.ok(!/const userMatch = path\.match/.test(AU_SERVER), 'userMatch 分支不得残留在 server.js');
  assert.ok(!/const userSteamMatch = path\.match/.test(AU_SERVER), 'steam-accounts 只读分支不得残留在 server.js');
  assert.ok(!/const resetCodeMatch = path\.match/.test(AU_SERVER), 'reset-code 分支不得残留在 server.js');
  assert.ok(!/const pwdMatch = path\.match/.test(AU_SERVER), 'password 分支不得残留在 server.js');
  assert.ok(!/const unlockMatch = path\.match/.test(AU_SERVER), 'unlock 分支不得残留在 server.js');
  assert.ok(!/const bindMatch = path\.match/.test(AU_SERVER), 'email 绑定分支不得残留在 server.js');
  assert.ok(!/const bulkOpMatch = path\.match/.test(AU_SERVER), 'bulk-ops/:id 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/users' && req\.method/.test(AU_SERVER), 'users 列表/建号分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/users\/deletions' && req\.method/.test(AU_SERVER), 'deletions 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/bulk' && req\.method/.test(AU_SERVER), 'bulk 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/bulk-ops' && req\.method/.test(AU_SERVER), 'bulk-ops 列表分支不得残留在 server.js');
  assert.ok(!/const BULK_ACTIONS = \{/.test(AU_SERVER), 'BULK_ACTIONS 派发表不得残留在 server.js（随域移入）');
  assert.ok(!/function normalizeBulkKey/.test(AU_SERVER), 'normalizeBulkKey 不得残留在 server.js（随域移入）');
  assert.ok(!/async function bulkGameRestore/.test(AU_SERVER), 'bulk helper 不得残留在 server.js（随域移入）');
  // 域内联 SQL 不得残留在 server.js（已抽 admin-users-repository.js）
  assert.ok(!/insert into email_codes/.test(AU_SERVER), '发码域内联 SQL 不得残留在 server.js');
  assert.ok(!/select id, username, email from users where username/.test(AU_SERVER), 'users 查询域内联 SQL 不得残留在 server.js');
});

test('CO-5/B4-2 第十六轮：admin-users-repository.js 签名不变 + pg.js re-export（删 re-export 即红）', () => {
  // 搬家函数签名与拆分前一致（旧 db.* 导入签名不变）
  assert.match(AU_REPO, /export async function unlockUser\(q, \{ username \}\)/, 'unlockUser 签名与拆分前一致');
  assert.match(AU_REPO, /export async function updateUser\(q, \{ username, displayName = undefined, role = undefined, disabled = undefined \}\)/, 'updateUser 签名与拆分前一致');
  assert.match(AU_REPO, /export async function deleteUserAudited\(q, \{ username, confirmUsername = null, operator = null, operatorId = null, reason = null \}\)/, 'deleteUserAudited 签名与拆分前一致');
  assert.match(AU_REPO, /export async function listUserDeletions\(q, \{ search = '', limit = 50 \} = \{\}\)/, 'listUserDeletions 签名与拆分前一致');
  assert.match(AU_REPO, /export async function bulkSetGamesBlocked\(q, \{ ids = \[\], blocked \}\)/, 'bulkSetGamesBlocked 签名与拆分前一致');
  assert.match(AU_REPO, /export async function bulkSetGamesDeleted\(q, \{ ids = \[\], deleted \}\)/, 'bulkSetGamesDeleted 签名与拆分前一致');
  assert.match(AU_REPO, /export async function bulkDeleteAnnouncements\(q, ids = \[\]\)/, 'bulkDeleteAnnouncements 签名与拆分前一致');
  assert.match(AU_REPO, /export async function bulkSetAnnouncementsActive\(q, \{ ids = \[\], active \}\)/, 'bulkSetAnnouncementsActive 签名与拆分前一致');
  assert.match(AU_REPO, /export async function bulkGetAbuseReviews\(q, ids = \[\]\)/, 'bulkGetAbuseReviews 签名与拆分前一致');
  assert.match(AU_REPO, /export async function bulkRejectAbuseReviews\(q, \{ ids = \[\], reviewedBy = null, note = null \}\)/, 'bulkRejectAbuseReviews 签名与拆分前一致');
  assert.match(AU_REPO, /export async function bulkRemoveBlockedIps\(q, ips = \[\]\)/, 'bulkRemoveBlockedIps 签名与拆分前一致');
  assert.match(AU_REPO, /export async function bulkRemoveWhitelistIps\(q, ips = \[\]\)/, 'bulkRemoveWhitelistIps 签名与拆分前一致');
  assert.match(AU_REPO, /export async function bulkRemoveDeviceBans\(q, fingerprints = \[\]\)/, 'bulkRemoveDeviceBans 签名与拆分前一致');
  assert.match(AU_REPO, /export async function usersForBulk\(q, ids = \[\]\)/, 'usersForBulk 签名与拆分前一致');
  assert.match(AU_REPO, /export async function countActiveAdmins\(q, \{ excludeIds = \[\] \} = \{\}\)/, 'countActiveAdmins 签名与拆分前一致');
  assert.match(AU_REPO, /export async function bulkSetUsersDisabled\(q, \{ ids = \[\], disabled \}\)/, 'bulkSetUsersDisabled 签名与拆分前一致');
  assert.match(AU_REPO, /export async function deleteSessionsOfUsers\(q, ids = \[\]\)/, 'deleteSessionsOfUsers 签名与拆分前一致');
  assert.match(AU_REPO, /export async function createBulkOp\(q, \{/, 'createBulkOp 签名与拆分前一致');
  assert.match(AU_REPO, /export async function listBulkOps\(q, \{ limit = 100, target = null \} = \{\}\)/, 'listBulkOps 签名与拆分前一致');
  assert.match(AU_REPO, /export async function getBulkOp\(q, id\)/, 'getBulkOp 签名与拆分前一致');
  // 域内联 SQL 新函数
  assert.match(AU_REPO, /export async function insertAdminEmailCode\(q, \{ email, userId, purpose, codeHash, subject, body, expiresMinutes \}\)/, 'insertAdminEmailCode 域内联 SQL 抽成新函数');
  assert.match(AU_REPO, /export async function pendingEmailCode\(q, \{ email, purpose \}\)/, 'pendingEmailCode 域内联 SQL 抽成新函数');
  assert.match(AU_REPO, /export async function adminBindEmail\(q, \{ email, username \}\)/, 'adminBindEmail 域内联 SQL 抽成新函数');
  assert.match(AU_REPO, /export async function ensureUsersEmailColumns\(q\)/, 'ensureUsersEmailColumns 域内联 SQL 抽成新函数');
  assert.match(AU_REPO, /export async function recentEmailCodes\(q, \{ email, purpose, limit = 20 \}\)/, 'recentEmailCodes 域内联 SQL 抽成新函数');
  assert.match(AU_REPO, /export async function userSessionKickTarget\(q, username\)/, 'userSessionKickTarget 域内联 SQL 抽成新函数');
  assert.match(AU_REPO, /export async function userEmailTarget\(q, username\)/, 'userEmailTarget 域内联 SQL 抽成新函数');
  assert.match(AU_REPO, /export async function userStateRow\(q, username\)/, 'userStateRow 域内联 SQL 抽成新函数');
  // pg.js 必须 re-export（旧 db.* 导入签名不变；routes/admin-users.js 与现有测试照旧走聚合壳）
  assert.match(AU_PG, /unlockUser,/, 'pg.js 必须 re-export unlockUser');
  assert.match(AU_PG, /updateUser,/, 'pg.js 必须 re-export updateUser');
  assert.match(AU_PG, /deleteUserAudited,/, 'pg.js 必须 re-export deleteUserAudited');
  assert.match(AU_PG, /listUserDeletions,/, 'pg.js 必须 re-export listUserDeletions');
  assert.match(AU_PG, /bulkSetGamesBlocked,/, 'pg.js 必须 re-export bulkSetGamesBlocked');
  assert.match(AU_PG, /bulkSetGamesDeleted,/, 'pg.js 必须 re-export bulkSetGamesDeleted');
  assert.match(AU_PG, /bulkDeleteAnnouncements,/, 'pg.js 必须 re-export bulkDeleteAnnouncements');
  assert.match(AU_PG, /bulkSetAnnouncementsActive,/, 'pg.js 必须 re-export bulkSetAnnouncementsActive');
  assert.match(AU_PG, /bulkGetAbuseReviews,/, 'pg.js 必须 re-export bulkGetAbuseReviews');
  assert.match(AU_PG, /bulkRejectAbuseReviews,/, 'pg.js 必须 re-export bulkRejectAbuseReviews');
  assert.match(AU_PG, /bulkRemoveBlockedIps,/, 'pg.js 必须 re-export bulkRemoveBlockedIps');
  assert.match(AU_PG, /bulkRemoveWhitelistIps,/, 'pg.js 必须 re-export bulkRemoveWhitelistIps');
  assert.match(AU_PG, /bulkRemoveDeviceBans,/, 'pg.js 必须 re-export bulkRemoveDeviceBans');
  assert.match(AU_PG, /usersForBulk,/, 'pg.js 必须 re-export usersForBulk');
  assert.match(AU_PG, /countActiveAdmins,/, 'pg.js 必须 re-export countActiveAdmins');
  assert.match(AU_PG, /bulkSetUsersDisabled,/, 'pg.js 必须 re-export bulkSetUsersDisabled');
  assert.match(AU_PG, /deleteSessionsOfUsers,/, 'pg.js 必须 re-export deleteSessionsOfUsers');
  assert.match(AU_PG, /createBulkOp,/, 'pg.js 必须 re-export createBulkOp');
  assert.match(AU_PG, /listBulkOps,/, 'pg.js 必须 re-export listBulkOps');
  assert.match(AU_PG, /getBulkOp,/, 'pg.js 必须 re-export getBulkOp');
  assert.match(AU_PG, /from '\.\/admin-users-repository\.js'/, 'pg.js re-export 指向 admin-users-repository.js');
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(!/export (async )?function (unlockUser|updateUser|deleteUserAudited|listUserDeletions|bulkSetGamesBlocked|bulkSetGamesDeleted|bulkDeleteAnnouncements|bulkSetAnnouncementsActive|bulkGetAbuseReviews|bulkRejectAbuseReviews|bulkRemoveBlockedIps|bulkRemoveWhitelistIps|bulkRemoveDeviceBans|usersForBulk|countActiveAdmins|bulkSetUsersDisabled|deleteSessionsOfUsers|createBulkOp|listBulkOps|getBulkOp)/.test(AU_PG), 'pg.js 不允许保留旧函数定义（只许 re-export）');
  // 边界判据锁：跨模块共用 SQL 留在 pg.js（cli/auth-routes/admin-access/steam-status 共用）
  assert.match(AU_PG, /export async function listUsers\(q\)/, 'listUsers 留 pg.js（cli.js users 命令共用）');
  assert.match(AU_PG, /export async function setUserPassword\(q, \{ username = null, userId = null, password, mustChange = false \}\)/, 'setUserPassword 留 pg.js（auth-routes 前台重置共用）');
  assert.match(AU_PG, /export async function writeAuditLog\(q, \{ actorId = null, actor = null, action, target = null, detail = null, ip = null \}\)/, 'writeAuditLog 留 pg.js（admin-access/alert 推送跨模块共用）');
  assert.match(AU_PG, /export async function deleteSessionsOfUser\(q, userId, \{ exceptToken = null \} = \{\}\)/, 'deleteSessionsOfUser 留 pg.js（前台 revoke-others/auth 域共用）');
  assert.match(AU_PG, /export async function bulkSetFreeStatus\(q\)/, 'bulkSetFreeStatus 留 pg.js（steam-status 共用）');
  // repository 不搬家 DDL
  assert.ok(!/create table/.test(AU_REPO), 'admin-users-repository.js 不搬家 DDL');
});
