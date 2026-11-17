// CA-1（docs/APP-NATIVE.md §3）：App Token 认证静态契约——守的是「表结构 / 哈希落库 /
// 路由存在 / 封禁豁免只对 /api/app/* 生效 / 401 login_required 语义」这些不可破坏的结构约束。
// 运行时的 token 生命周期（签发/过期/撤销/禁用/限流/验证码）在链外 test/api.test.js 真跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src');
const pg = readFileSync(join(ROOT, 'store', 'pg.js'), 'utf8');
const server = readFileSync(join(ROOT, 'server.js'), 'utf8');

test('CA-1 数据表：api_tokens 结构与唯一哈希索引', () => {
  assert.match(pg, /create table if not exists api_tokens \(/);
  assert.match(pg, /token_hash\s+text not null unique/, 'token_hash 必须唯一');
  assert.match(pg, /references users\(id\) on delete cascade/, '用户删除级联清 token');
  assert.match(pg, /expires_at\s+timestamptz not null/);
  assert.match(pg, /revoked_at\s+timestamptz/);
  assert.match(pg, /create index if not exists idx_api_tokens_user on api_tokens \(user_id\)/);
});

test('CA-1 明文不落库：签发只存 sha256 哈希，查询/撤销按哈希', () => {
  assert.match(pg, /apiTokenHash\(token\)/, 'insertApiToken 必须哈希后落库');
  assert.match(pg, /insertApiToken[\s\S]{0,600}?\[userId, apiTokenHash\(token\), name, String\(days\)\]/, '插入参数里只有哈希，没有明文');
  assert.match(pg, /userByApiToken[\s\S]{0,400}expires_at > now\(\) and t\.revoked_at is null and not u\.disabled/, '校验过期/撤销/禁用');
  assert.match(pg, /revokeApiToken[\s\S]{0,300}revoked_at = now\(\)/);
});

test('CA-1 路由：token 签发/撤销、app 状态、Bearer 解析、前缀重写', () => {
  assert.match(server, /path === '\/api\/auth\/token' && req\.method === 'POST'/);
  assert.match(server, /path === '\/api\/auth\/token\/revoke' && req\.method === 'POST'/);
  assert.match(server, /path === '\/api\/app\/status' && req\.method === 'GET'/);
  assert.match(server, /Bearer\\s\+\(\[A-Za-z0-9_-\]\{16,\}\)\$/, 'Bearer 头解析（正则字面量文本）');
  assert.match(server, /userByApiToken\(q, bearer\)/, 'Bearer 走 api_tokens 换用户');
  // 前缀重写：/api/app/<rest> → /api/<rest>，精确例外 latest/status
  assert.match(server, /path = '\/api' \+ path\.slice\('\/api\/app'\.length\)/, '前缀重写实现');
  assert.match(server, /path !== '\/api\/app\/latest' && path !== '\/api\/app\/status'/, 'latest/status 不重写');
});

test('CA-1 401 语义：Bearer 请求的未登录统一 login_required', () => {
  assert.match(server, /error: bearer \? 'login_required' : '需要登录'/, 'Bearer=login_required，Web 文案不变');
  assert.match(server, /if \(!bearer \|\| !user\) return json\(res, 401, \{ error: 'login_required' \}\)/, 'revoke 无有效 Bearer 401');
});

test('CA-1 封禁豁免只对 /api/app/*：Web /api/* 拦截链不变', () => {
  assert.match(server, /appNamespace = path === '\/api\/app\/status' \|\| path\.startsWith\('\/api\/app\/'\)/);
  assert.match(server, /!appNamespace && !adminBypass && !whitelisted \? devices\.isBanned/, '设备封禁检查带 appNamespace 豁免');
  assert.match(server, /!appNamespace && !adminBypass && !whitelisted \? visitors\.blockedBy\(ip\)/, 'IP 黑名单检查带 appNamespace 豁免');
  // 基础限流保留：限流分支不允许带 appNamespace 豁免
  const rateBlock = server.match(/if \(ip && !whitelisted && !adminBypass[\s\S]{0,500}?verdict\.limited\)/)?.[0] ?? '';
  assert.ok(!/appNamespace/.test(rateBlock), '全局 API 基础限流不豁免 /api/app/*');
});

test('CA-1 审计与节流：不记明文、5 分钟节流写 last_used_at', () => {
  assert.match(server, /auth\.token_issued/, '签发审计事件');
  assert.match(server, /auth\.token_revoked/, '撤销审计事件');
  assert.match(server, /apiTokenSeenAt[\s\S]{0,300}5 \* 60_000/, 'last_used_at 5 分钟节流');
  const issueLog = server.match(/logger\?\.info\('auth\.token_issued', \{[\s\S]{0,200}?\}\)/)?.[0] ?? '';
  assert.ok(!/issued\.token/.test(issueLog), '审计日志不能带明文 token');
});

test('CA-1 契约文档存在且链接真实（以 APP-API.md 为 App 唯一口径）', () => {
  const doc = readFileSync(join(process.cwd(), 'docs', 'APP-API.md'), 'utf8');
  assert.match(doc, /\/api\/app\/auth\/token/, 'App 只调 /api/app/* 前缀');
  assert.match(doc, /\/api\/app\/status/);
  assert.match(doc, /login_required/);
  assert.match(doc, /前缀重写/);
});
