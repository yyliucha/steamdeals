// CA-1（docs/APP-NATIVE.md §3）：App Token 认证静态契约——守的是「表结构 / 哈希落库 /
// 路由存在 / 封禁豁免只对 /api/app/* 生效 / 401 login_required 语义」这些不可破坏的结构约束。
// 运行时的 token 生命周期（签发/过期/撤销/禁用/限流/验证码）在链外 test/api.test.js 真跑。
//
// CO-4/B4（docs/DESIGN-AUDIT.md B4）：App 域从 server.js/pg.js 巨石拆出后，断言按新落点指向：
//   · 表结构与 token 函数 SQL → src/store/app-repository.js；pg.js 必须 re-export（旧导入签名不变）；
//   · 路由分支（token 签发/撤销、app/status、app/latest、admin app-sync*）→ src/routes/app.js；
//   · server.js 只留认证上下文与中间件（Bearer 解析、前缀重写、封禁豁免），且必须真实调用
//     handleAppPreflight / handleAppRoutes——删掉调用即红（防「死模块」：路由文件在而宿主不接）。
// 反向自检口径：删掉 routes/app.js 任一路由分支 → 第 4 组断言红；删掉 server.js 的接线调用 → 第 5 组红；
// 把分支抄回 server.js → 第 6 组「防双实现」红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src');
const pg = readFileSync(join(ROOT, 'store', 'pg.js'), 'utf8');
const repo = readFileSync(join(ROOT, 'store', 'app-repository.js'), 'utf8');
const server = readFileSync(join(ROOT, 'server.js'), 'utf8');
const appRoutes = readFileSync(join(ROOT, 'routes', 'app.js'), 'utf8');

test('CA-1 数据表：api_tokens 结构与唯一哈希索引（SQL 落 app-repository.js）', () => {
  assert.match(repo, /create table if not exists api_tokens \(/);
  assert.match(repo, /token_hash\s+text not null unique/, 'token_hash 必须唯一');
  assert.match(repo, /references users\(id\) on delete cascade/, '用户删除级联清 token');
  assert.match(repo, /expires_at\s+timestamptz not null/);
  assert.match(repo, /revoked_at\s+timestamptz/);
  assert.match(repo, /create index if not exists idx_api_tokens_user on api_tokens \(user_id\)/);
});

test('CA-1 明文不落库：签发只存 sha256 哈希，查询/撤销按哈希（SQL 落 app-repository.js）', () => {
  assert.match(repo, /apiTokenHash\(token\)/, 'insertApiToken 必须哈希后落库');
  assert.match(repo, /insertApiToken[\s\S]{0,600}?\[userId, apiTokenHash\(token\), name, String\(days\)\]/, '插入参数里只有哈希，没有明文');
  assert.match(repo, /userByApiToken[\s\S]{0,400}expires_at > now\(\) and t\.revoked_at is null and not u\.disabled/, '校验过期/撤销/禁用');
  assert.match(repo, /revokeApiToken[\s\S]{0,300}revoked_at = now\(\)/);
});

test('CO-4/B4：pg.js 保持 re-export 兼容（旧 db.* 导入签名不变；删掉即红）', () => {
  // server.js 认证上下文与 auth-routes.js 仍 `db.userByApiToken / db.touchApiToken` 调用——
  // 这层兼容壳是拆分不回退的硬约束。
  assert.match(pg, /from '\.\/app-repository\.js'/, 'pg.js 必须 import app-repository.js');
  assert.match(
    pg,
    /export \{[\s\S]{0,200}apiTokenHash[\s\S]{0,200}insertApiToken[\s\S]{0,200}userByApiToken[\s\S]{0,200}revokeApiToken[\s\S]{0,200}touchApiToken[\s\S]{0,200}\} from '\.\/app-repository\.js'/,
    '五个 token 函数必须整体 re-export（签名不变）',
  );
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(!/export (async )?function (apiTokenHash|insertApiToken|userByApiToken|revokeApiToken|touchApiToken)/.test(pg), 'pg.js 不允许保留旧函数定义（只许 re-export）');
});

test('CA-1 路由分支：token 签发/撤销、app 状态/版本卡、admin app-sync 全部在 src/routes/app.js', () => {
  assert.match(appRoutes, /path === '\/api\/auth\/token' && req\.method === 'POST'/);
  assert.match(appRoutes, /path === '\/api\/auth\/token\/revoke' && req\.method === 'POST'/);
  assert.match(appRoutes, /path !== '\/api\/app\/status' \|\| req\.method !== 'GET'/, '/api/app/status 在预检段（反条件提前返回）');
  assert.match(appRoutes, /path === '\/api\/app\/latest' && req\.method === 'GET'/);
  assert.match(appRoutes, /path === '\/api\/admin\/app-sync\/status' && req\.method === 'GET'/);
  assert.match(appRoutes, /path === '\/api\/admin\/app-sync' && req\.method === 'POST'/);
});

test('CO-4/B4：server.js 必须真实接线两个入口（删掉调用即红，防死模块）', () => {
  assert.match(server, /import \{ handleAppPreflight, handleAppRoutes \} from '\.\/routes\/app\.js'/, 'server.js 必须导入域路由入口');
  // 锁「完整调用形态」：必须是 if (await handleAppPreflight(...)) return; ——只断言字符串存在会被
  // if (false) 包一层绕过（反向自检实测）；这个形态锁住"调用且消费返回值结束响应"。
  assert.match(server, /if \(await handleAppPreflight\(\{ path, req, res, json, ip, whitelisted \}\)\) return;/, '预检段接线（含封禁自查所需 ctx，且消费返回值）');
  assert.match(server, /if \(\s*await handleAppRoutes\(\{/, '主段接线');
  // 主段 ctx 关键字段必须传齐：漏传 loginIpFails 会让 token 路由与 Web 登录限速分家，
  // 漏传 appSync 会让 single-flight 失效——这两条是引用共享语义，不是普通配置。
  assert.match(server, /await handleAppRoutes\(\{[\s\S]{0,1200}?loginIpFails,/);
  assert.match(server, /await handleAppRoutes\(\{[\s\S]{0,1200}?appSync,/);
  assert.match(server, /await handleAppRoutes\(\{[\s\S]{0,1200}?tryAutoBan,/);
  assert.match(server, /await handleAppRoutes\(\{[\s\S]{0,1200}?requireAdmin,/);
});

test('CO-4/B4：域路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/path === '\/api\/auth\/token' && req\.method/.test(server), 'token 签发分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/app\/latest' && req\.method/.test(server), 'app/latest 分支不得残留在 server.js');
  // 注意：isTimeoutExemptPath 白名单里的 '/api/admin/app-sync' 是合法中间件配置，允许保留；
  // 锁的是「带 method 判定的路由分支」。
  assert.ok(!/path === '\/api\/admin\/app-sync[\s\S]{0,80}req\.method/.test(server), 'admin app-sync 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/app\/status' && req\.method === 'GET'/.test(server), 'app/status 分支不得残留在 server.js');
});

test('CA-1 中间件留在 server.js：Bearer 解析、前缀重写、appNamespace 豁免', () => {
  assert.match(server, /Bearer\\s\+\(\[A-Za-z0-9_-\]\{16,\}\)\$/, 'Bearer 头解析（正则字面量文本）');
  assert.match(server, /userByApiToken\(q, bearer\)/, 'Bearer 走 api_tokens 换用户（认证上下文）');
  // 前缀重写：/api/app/<rest> → /api/<rest>，精确例外 latest/status
  assert.match(server, /path = '\/api' \+ path\.slice\('\/api\/app'\.length\)/, '前缀重写实现');
  assert.match(server, /path !== '\/api\/app\/latest' && path !== '\/api\/app\/status'/, 'latest/status 不重写');
  assert.match(server, /appNamespace = path === '\/api\/app\/status' \|\| path\.startsWith\('\/api\/app\/'\)/);
  assert.match(server, /!appNamespace && !adminBypass && !whitelisted \? devices\.isBanned/, '设备封禁检查带 appNamespace 豁免');
  assert.match(server, /!appNamespace && !adminBypass && !whitelisted \? visitors\.blockedBy\(ip\)/, 'IP 黑名单检查带 appNamespace 豁免');
  // 基础限流保留：限流分支不允许带 appNamespace 豁免
  const rateBlock = server.match(/if \(ip && !whitelisted && !adminBypass[\s\S]{0,500}?verdict\.limited\)/)?.[0] ?? '';
  assert.ok(!/appNamespace/.test(rateBlock), '全局 API 基础限流不豁免 /api/app/*');
});

test('CA-1 401 语义：Bearer 请求的未登录统一 login_required', () => {
  assert.match(server, /error: bearer \? 'login_required' : '需要登录'/, 'Bearer=login_required，Web 文案不变（requireUser 在 server.js）');
  assert.match(appRoutes, /if \(!bearer \|\| !user\)/, 'revoke 前置条件在 routes/app.js');
  assert.match(appRoutes, /json\(res, 401, \{ error: 'login_required' \}\)/, 'revoke 无有效 Bearer 401');
});

test('CA-1 审计与节流：不记明文、5 分钟节流写 last_used_at', () => {
  assert.match(appRoutes, /auth\.token_issued/, '签发审计事件（随路由移入 routes/app.js）');
  assert.match(appRoutes, /auth\.token_revoked/, '撤销审计事件（随路由移入 routes/app.js）');
  assert.match(server, /apiTokenSeenAt[\s\S]{0,300}5 \* 60_000/, 'last_used_at 5 分钟节流（认证上下文，留 server.js）');
  const issueLog = appRoutes.match(/logger\?\.info\('auth\.token_issued', \{[\s\S]{0,200}?\}\)/)?.[0] ?? '';
  assert.ok(!/issued\.token/.test(issueLog), '审计日志不能带明文 token');
});

test('CA-1 契约文档存在且链接真实（以 APP-API.md 为 App 唯一口径）', () => {
  const doc = readFileSync(join(process.cwd(), 'docs', 'APP-API.md'), 'utf8');
  assert.match(doc, /\/api\/app\/auth\/token/, 'App 只调 /api/app/* 前缀');
  assert.match(doc, /\/api\/app\/status/);
  assert.match(doc, /login_required/);
  assert.match(doc, /前缀重写/);
});
