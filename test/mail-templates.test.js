// 邮件模板（docs/USER-LIFECYCLE.md §3.1/§4.3/§4.4/§6，AI 批）：
// 9 事件默认齐全、渲染变量转义、未知变量原样保留、统一页脚、text 兜底、
// 保存前校验（主题去 CR/LF、{{code}} 仅验证码可用）、3 套示例版式、DB 存取与 mail_log。
// CO-5/B4-2 第十轮（B4 #10 admin-settings 域拆分）追加：四组静态锁（路由分支落点 /
// 宿主接线 / 防双实现 / repository re-export）+ admin-settings 域真 HTTP 行为测试
// （权限 401/403/200、SMTP 保存读回、模板 CRUD、测试邮件冷却 429）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { ensureEmailSchema } from '../src/email-auth.js';
import { startApiServer } from '../src/server.js';
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_EVENTS,
  SAMPLE_THEMES,
  renderTemplate,
  htmlToText,
  unknownVariables,
  validateTemplatePayload,
  resolveTemplate,
} from '../src/mail-templates.js';

// 测试里关掉登录验证码（HTTP 行为测试登录用）
process.env.CAPTCHA_ENABLED = '0';

test('9 个事件默认模板齐全：verify_code 才含 {{code}}，其余都不含', () => {
  assert.equal(TEMPLATE_EVENTS.length, 9, '8 类账号通知 + 验证码');
  for (const def of TEMPLATE_EVENTS) {
    const tpl = DEFAULT_TEMPLATES[def.event];
    assert.ok(tpl?.subject, `${def.event} 缺默认主题`);
    assert.ok(tpl?.bodyHtml, `${def.event} 缺默认 HTML`);
  }
  assert.match(DEFAULT_TEMPLATES.verify_code.bodyHtml, /\{\{code\}\}/);
  for (const def of TEMPLATE_EVENTS.filter((d) => d.event !== 'verify_code')) {
    assert.ok(!/\{\{\s*code\s*\}\}/.test(DEFAULT_TEMPLATES[def.event].bodyHtml), `${def.event} 不应含 {{code}}`);
  }
});

test('渲染：变量转义、未知变量原样保留、页脚追加、text 自动兜底', () => {
  const out = renderTemplate({
    subject: '你好 {{username}}',
    bodyHtml: '<p>{{username}}</p><p>{{badVar}}</p>',
    bodyText: '',
    vars: { username: '<script>alert(1)</script>', siteUrl: 'https://x.example', contactEmail: 'a@x.example' },
  });
  assert.equal(out.subject, '你好 &lt;script&gt;alert(1)&lt;/script&gt;', '主题变量也转义');
  assert.match(out.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(out.html, /\{\{badVar\}\}/, '未知变量原样保留');
  assert.match(out.html, /本邮件由系统自动发送，请勿直接回复/, '统一页脚必须由代码追加');
  assert.match(out.text, /本邮件由系统自动发送/, '纯文本也带页脚');
  assert.ok(!out.text.includes('<p>'), 'text 兜底由 HTML 去标签生成');
  // bodyText 给了就用它（仍渲染变量）
  const withText = renderTemplate({ subject: 's', bodyHtml: '<p>x</p>', bodyText: 'hi {{username}}', vars: { username: 'u' } });
  assert.match(withText.text, /hi u/);
});

test('htmlToText：去标签、解实体', () => {
  assert.equal(htmlToText('<p>a&amp;b <b>c</b></p><style>x{}</style>'), 'a&b c');
});

test('unknownVariables：白名单外的变量被揪出来', () => {
  assert.deepEqual(unknownVariables('{{username}} {{password}}'), ['password']);
  assert.deepEqual(unknownVariables('ok'), []);
});

test('validateTemplatePayload：主题去 CR/LF、{{code}} 仅验证码可用、未知变量只警告', () => {
  const ok = validateTemplatePayload('account_deleted', { subject: '好\r\nBcc: x', bodyHtml: '<p>{{username}}</p>' });
  assert.equal(ok.ok, true);
  assert.equal(ok.subject, '好 Bcc: x', '主题里的换行必须被过滤（防头注入）');
  assert.deepEqual(ok.warnings, []);
  const badCode = validateTemplatePayload('account_deleted', { subject: 's', bodyHtml: '{{code}}' });
  assert.equal(badCode.ok, false, '非验证码事件禁 {{code}}');
  const warn = validateTemplatePayload('verify_code', { subject: 's', bodyHtml: '{{code}} {{password}}' });
  assert.equal(warn.ok, true, '验证码事件允许 {{code}}');
  assert.ok(warn.warnings.length === 1 && warn.warnings[0].includes('password'), '未知变量返回警告');
  const empty = validateTemplatePayload('verify_code', { subject: '  ', bodyHtml: 'x' });
  assert.equal(empty.ok, false, '主题必填');
});

test('3 套示例版式：都带常用变量、可直接填入编辑器', () => {
  assert.equal(SAMPLE_THEMES.length, 3);
  for (const s of SAMPLE_THEMES) {
    assert.ok(s.id && s.label && s.subject && s.bodyHtml, `${s.label} 不完整`);
    assert.match(s.bodyHtml, /\{\{username\}\}/);
  }
});

test('DB 存取：upsert → 读出合并 → reset 恢复默认；mail_log 增查', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await db.upsertMailTemplate(q, { event: 'account_deleted', subject: '自定义主题', bodyHtml: '<p>{{username}}</p>', bodyText: null, enabled: false, updatedBy: 'admin1' });
    const merged = await resolveTemplate(q, 'account_deleted');
    assert.equal(merged.subject, '自定义主题');
    assert.equal(merged.enabled, false, '启停要落库');
    assert.equal(merged.isDefault, false);
    const def = await resolveTemplate(q, 'account_enabled');
    assert.equal(def.isDefault, true, '没存过的事件回落默认');

    await db.resetMailTemplate(q, 'account_deleted');
    const reset = await resolveTemplate(q, 'account_deleted');
    assert.equal(reset.isDefault, true, '恢复默认 = 删表行');

    await db.insertMailLog(q, { event: 'test', toEmail: 'x@y.com', subject: 't', ok: true, actor: 'admin1' });
    await db.insertMailLog(q, { event: 'test', toEmail: 'z@y.com', subject: 't2', ok: false, error: 'boom', actor: 'admin1' });
    const rows = await db.listMailLog(q, { limit: 10 });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].to_email, 'z@y.com', '倒序');
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].error, 'boom');
  } finally {
    await store.close();
  }
});

// ============================================================ CO-5/B4-2 第十轮静态锁
// admin-settings 域（B4 #10：smtp/mail/emails/proxies/version）从 server.js/pg.js 巨石
// 拆出后，四组静态断言按新落点指向：
//   · 路由分支 → src/routes/admin-settings.js；
//   · 域专属 SQL → src/store/admin-settings-repository.js；pg.js 必须 re-export
//     （旧 db.* 导入签名不变），无 DDL 搬家（smtp_settings/mail_templates/mail_log/
//     email_codes 表 DDL 在 email-auth.js，跨模块共用）；
//   · server.js 只留单入口接线（管理段），且必须真实调用——删掉调用即红（防死模块）；
//   · 旧分支不得残留在 server.js（防双实现）。
// 反向自检口径：删掉 routes/admin-settings.js 任一路由分支 → 第 1 组断言红；
// 删掉 server.js 的入口接线 → 第 2 组红；把分支抄回 server.js → 第 3 组红；
// 删 pg.js re-export → 第 4 组红。

const ST_ROUTES = readFileSync(fileURLToPath(new URL('../src/routes/admin-settings.js', import.meta.url)), 'utf8');
const ST_REPO = readFileSync(fileURLToPath(new URL('../src/store/admin-settings-repository.js', import.meta.url)), 'utf8');
const ST_SERVER = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const ST_PG = readFileSync(fileURLToPath(new URL('../src/store/pg.js', import.meta.url)), 'utf8');

test('CO-5/B4-2 第十轮：admin-settings 路由分支全部在 src/routes/admin-settings.js（管理段单入口，删任一支即红）', () => {
  // version 一条
  assert.match(ST_ROUTES, /path === '\/api\/admin\/version' && req\.method === 'GET'/, 'version 分支在新文件');
  // smtp 三条
  assert.match(ST_ROUTES, /path === '\/api\/admin\/smtp' && req\.method === 'GET'/, 'smtp GET 分支在新文件');
  assert.match(ST_ROUTES, /path === '\/api\/admin\/smtp' && req\.method === 'POST'/, 'smtp POST 分支在新文件');
  assert.match(ST_ROUTES, /path === '\/api\/admin\/smtp\/test' && req\.method === 'POST'/, 'smtp/test 分支在新文件');
  // emails 一条
  assert.match(ST_ROUTES, /path === '\/api\/admin\/emails' && req\.method === 'GET'/, 'emails 分支在新文件');
  // mail 四条
  assert.match(ST_ROUTES, /path === '\/api\/admin\/mail\/templates' && req\.method === 'GET'/, 'mail/templates GET 分支在新文件');
  assert.match(ST_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/mail\\\/templates\\\/\(\[a-z_\]\+\)\\\/\(reset\|preview\|test\)\$\/\)/, 'mail/templates/:event/(reset|preview|test) 分支在新文件');
  assert.match(ST_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/mail\\\/templates\\\/\(\[a-z_\]\+\)\$\/\)/, 'mail/templates/:event PUT 分支在新文件');
  assert.match(ST_ROUTES, /path === '\/api\/admin\/mail\/log' && req\.method === 'GET'/, 'mail/log 分支在新文件');
  // proxies 两条
  assert.match(ST_ROUTES, /path === '\/api\/admin\/proxies' && req\.method === 'GET'/, 'proxies GET 分支在新文件');
  assert.match(ST_ROUTES, /path === '\/api\/admin\/proxies\/probe' && req\.method === 'POST'/, 'proxies/probe 分支在新文件');
  // 单入口形态（§15.3 位置语义：管理段）
  assert.match(ST_ROUTES, /export async function handleAdminSettingsAdmin\(ctx\)/, '管理段入口');
  // 守卫与语义随路由
  assert.match(ST_ROUTES, /if \(!requireAdmin\(\)\) return true/, '管理段守卫');
  assert.match(ST_ROUTES, /process\.env\.UPDATE_CHECK === '0'/, 'UPDATE_CHECK=0 不出网语义随路由');
  assert.match(ST_ROUTES, /error: 'SMTP 配置不完整：缺少 '/, 'smtp/test 未配置 400 语义随路由');
  assert.match(ST_ROUTES, /error: '测试邮件 10 秒内只能发一次'/, '模板测试邮件 10 秒冷却 429 语义随路由');
  assert.match(ST_ROUTES, /error: '没有该模板事件'/, '模板事件白名单 404 语义随路由');
  assert.match(ST_ROUTES, /error: '请提供有效的收件邮箱'/, '模板测试收件人校验 400 语义随路由');
  assert.match(ST_ROUTES, /error: 'SMTP 未配置，无法发送测试邮件'/, '模板测试未配置 SMTP 503 语义随路由');
  assert.match(ST_ROUTES, /hasPassword: Boolean\(cfg\.pass\)/, 'SMTP 密码只回 hasPassword 语义随路由');
  assert.match(ST_ROUTES, /maskEmail\(to\)/, '邮件地址日志脱敏语义随路由');
  assert.match(ST_ROUTES, /settings\.hydrateSettings\(\{ store, logger \}\)/, 'SMTP 保存后 hydrate 热加载语义随路由');
  assert.match(ST_ROUTES, /ratelimit\.configureFromEnv\(process\.env\)/, 'BR 批限流阈值热加载语义随路由');
  assert.match(ST_ROUTES, /appRateLimit\.configureFromEnv\(process\.env\)/, 'CO-3/C2 App 限流阈值热加载语义随路由');
  assert.match(ST_ROUTES, /invalidateSiteCache\(\)/, 'DX 批 SMTP 保存后失效 site 缓存语义随路由');
  assert.match(ST_ROUTES, /versionInfo\(\{ current: VERSION, repo, logger, force \}\)/, '版本检查走 version.js versionInfo');
  assert.match(ST_ROUTES, /proxyPool\.proxyHealth\(process\.env, \{ logger \}\)/, '代理健康走 proxyPool.proxyHealth（地址脱敏在模块）');
  assert.match(ST_ROUTES, /proxyPool\.probeAllProxies\(process\.env, \{ logger \}\)/, '代理探测走 proxyPool.probeAllProxies');
  assert.match(ST_ROUTES, /mailTemplates\.validateTemplatePayload\(event, \{/, '模板保存前校验走 mail-templates.validateTemplatePayload');
  // 域内状态随域移入（先例：watchlist 域 watchUserFails）
  assert.match(ST_ROUTES, /const mailTestCooldown = new Map\(\)/, '测试邮件冷却 Map 随域移入模块级');
  // 动态导入路径已修正（routes/ 一层深 → ../）
  assert.match(ST_ROUTES, /await import\('\.\.\/email-auth\.js'\)/, 'email-auth 动态导入路径已修正为 ../email-auth.js');
  assert.match(ST_ROUTES, /await import\('\.\.\/notify\.js'\)/, 'notify 动态导入路径已修正为 ../notify.js');
  // 路由模块只做编排：不许出现 SQL 字面量（全部走 repository）
  assert.ok(!/select |insert |update |delete from /.test(ST_ROUTES), 'routes/admin-settings.js 不写 SQL 字面量');
  // 未命中返回 false，宿主继续
  assert.match(ST_ROUTES, /return false;/, '未命中返回 false，宿主继续');
});

test('CO-5/B4-2 第十轮：server.js 必须真实接线管理段入口（删掉调用即红，防死模块）', () => {
  assert.match(ST_SERVER, /import \{ handleAdminSettingsAdmin \} from '\.\/routes\/admin-settings\.js'/, 'server.js 必须导入域路由入口');
  // 锁「完整调用形态」：必须是 if (await handleXxx(...)) return;——只断言字符串存在会被 if(false) 包一层绕过
  assert.match(ST_SERVER, /if \(\s*await handleAdminSettingsAdmin\(\{[\s\S]{0,1200}?path,[\s\S]{0,1200}?req,[\s\S]{0,1200}?res,[\s\S]{0,1200}?invalidateSiteCache,[\s\S]{0,600}?\}\)\s*\)\s*return;/, '管理段接线（完整形态，且消费返回值）');
  // 管理段 ctx 关键字段必须传齐：漏传 url 查询参数丢失、漏传 requireAdmin 守卫失效、
  // 漏传 user 审计落空、漏传 store SMTP 保存后 hydrate 落空、漏传 appealEmail 模板联系人缺失、
  // 漏传 invalidateSiteCache site 缓存漂移
  assert.match(ST_SERVER, /await handleAdminSettingsAdmin\(\{[\s\S]{0,1200}?url,/);
  assert.match(ST_SERVER, /await handleAdminSettingsAdmin\(\{[\s\S]{0,1200}?requireAdmin,/);
  assert.match(ST_SERVER, /await handleAdminSettingsAdmin\(\{[\s\S]{0,1200}?user,/);
  assert.match(ST_SERVER, /await handleAdminSettingsAdmin\(\{[\s\S]{0,1200}?store,/);
  assert.match(ST_SERVER, /await handleAdminSettingsAdmin\(\{[\s\S]{0,1200}?appealEmail,/);
  assert.match(ST_SERVER, /await handleAdminSettingsAdmin\(\{[\s\S]{0,1200}?invalidateSiteCache,/);
  // 位置语义锁：调用必须在 requireAdmin 就绪之后的管理段——本域最早路由 version GET 的原位置
  // （admin-sync 接线之前、backups 之前；backups 段已随 B4 #12 拆到 admin-reports 接线）
  assert.match(ST_SERVER, /await handleAdminSettingsAdmin\(\{[\s\S]*?await handleAdminSyncAdmin\(\{/s, '接线在 admin-sync 接线之前（本域 version 原位置）');
  assert.match(ST_SERVER, /await handleAdminSettingsAdmin\(\{[\s\S]*?await handleAdminReportsAdmin\(\{/s, '接线在 backups 之前（本域 version 原位置；backups 段已随 B4 #12 拆走）');
});

test('CO-5/B4-2 第十轮：admin-settings 路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/path === '\/api\/admin\/version' && req\.method/.test(ST_SERVER), 'version 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/smtp' && req\.method/.test(ST_SERVER), 'smtp 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/smtp\/test' && req\.method/.test(ST_SERVER), 'smtp/test 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/emails' && req\.method/.test(ST_SERVER), 'emails 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/mail\/templates' && req\.method/.test(ST_SERVER), 'mail/templates 分支不得残留在 server.js');
  assert.ok(!/api\\\/admin\\\/mail\\\/templates\\\//.test(ST_SERVER), 'mail/templates/:event 正则分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/mail\/log' && req\.method/.test(ST_SERVER), 'mail/log 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/proxies' && req\.method/.test(ST_SERVER), 'proxies 分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/proxies\/probe' && req\.method/.test(ST_SERVER), 'proxies/probe 分支不得残留在 server.js');
  assert.ok(!/const mailTestCooldown = new Map\(\)/.test(ST_SERVER), '测试邮件冷却 Map 不得残留在 server.js（随域移入）');
  // 边界锁：跨域共用的邮件发送（users 邮箱绑定）与设置路由留宿主
  assert.match(ST_SERVER, /await authRoutes\.handleEmailAuth\(\{ path, req, res, q, logger, json, readBody, captcha, ip \}\)/, '邮箱验证码 auth-routes 入口留 server.js（跨域）');
  assert.match(ST_SERVER, /handleSettingsRoutes\(\{ path, req, res, q, store, logger, json, readBody, user, afterHydrate/, '/api/admin/settings* 留 server.js（settings-routes.js 独立模块）');
  assert.match(ST_SERVER, /path\.match\(\/\^\\\/api\\\/admin\\\/users\\\/\(\[\^\/\]\+\)\\\/email\\\/code\$\/\)/, 'users 邮箱发码路由留 server.js（B4 #11）');
});

test('CO-5/B4-2 第十轮：admin-settings-repository.js 签名不变 + pg.js re-export（删 re-export 即红）', () => {
  // 搬家函数签名与拆分前一致（旧 db.* 导入签名不变）
  assert.match(ST_REPO, /export async function listMailTemplates\(q\)/, 'listMailTemplates 签名与拆分前一致');
  assert.match(ST_REPO, /export async function upsertMailTemplate\(q, \{ event, subject, bodyHtml, bodyText = null, enabled = true, updatedBy = null \}\)/, 'upsertMailTemplate 签名与拆分前一致');
  assert.match(ST_REPO, /export async function resetMailTemplate\(q, event\)/, 'resetMailTemplate 签名与拆分前一致');
  assert.match(ST_REPO, /export async function listMailLog\(q, \{ limit = 200 \} = \{\}\)/, 'listMailLog 签名与拆分前一致');
  assert.match(ST_REPO, /on conflict \(event\) do update set/, '模板 upsert on conflict 语义随函数搬家');
  // 域内联 SQL 新函数
  assert.match(ST_REPO, /export async function saveSmtpSettings\(q, \{ host, port, secure, username, passwordEnc, fromAddr, enabled \}\)/, 'saveSmtpSettings 域内联 SQL 抽成新函数');
  assert.match(ST_REPO, /coalesce\(\$5, smtp_settings\.password_enc\)/, 'SMTP 密码留空保持原值语义随函数');
  assert.match(ST_REPO, /export async function listEmailCodes\(q, \{ limit = 100 \} = \{\}\)/, 'listEmailCodes 域内联 SQL 抽成新函数');
  assert.match(ST_REPO, /export async function insertTestEmailCode\(q, \{ email, subject, body \}\)/, 'insertTestEmailCode 域内联 SQL 抽成新函数');
  assert.match(ST_REPO, /export async function markEmailCodeSent\(q, id\)/, 'markEmailCodeSent 域内联 SQL 抽成新函数');
  assert.match(ST_REPO, /export async function markEmailCodeFailed\(q, id, error\)/, 'markEmailCodeFailed 域内联 SQL 抽成新函数');
  // pg.js 必须 re-export（旧 db.* 导入签名不变；routes/admin-settings.js 与现有测试照旧走聚合壳）
  assert.match(ST_PG, /listMailTemplates,/, 'pg.js 必须 re-export listMailTemplates');
  assert.match(ST_PG, /upsertMailTemplate,/, 'pg.js 必须 re-export upsertMailTemplate');
  assert.match(ST_PG, /resetMailTemplate,/, 'pg.js 必须 re-export resetMailTemplate');
  assert.match(ST_PG, /listMailLog,/, 'pg.js 必须 re-export listMailLog');
  assert.match(ST_PG, /saveSmtpSettings,/, 'pg.js 必须 re-export saveSmtpSettings');
  assert.match(ST_PG, /listEmailCodes,/, 'pg.js 必须 re-export listEmailCodes');
  assert.match(ST_PG, /insertTestEmailCode,/, 'pg.js 必须 re-export insertTestEmailCode');
  assert.match(ST_PG, /markEmailCodeSent,/, 'pg.js 必须 re-export markEmailCodeSent');
  assert.match(ST_PG, /markEmailCodeFailed,/, 'pg.js 必须 re-export markEmailCodeFailed');
  assert.match(ST_PG, /from '\.\/admin-settings-repository\.js'/, 'pg.js re-export 指向 admin-settings-repository.js');
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(!/export (async )?function (listMailTemplates|upsertMailTemplate|resetMailTemplate|listMailLog)/.test(ST_PG), 'pg.js 不允许保留旧函数定义（只许 re-export）');
  // 边界判据锁：跨模块共用 SQL 留在 pg.js（account-notify.js / routes/appeal.js 共用）
  assert.match(ST_PG, /export async function insertMailLog\(q, \{ event, toEmail, subject = null, ok = false, error = null, actor = null \}\)/, 'insertMailLog 留 pg.js（account-notify/appeal 跨模块共用）');
  // repository 不搬家 DDL
  assert.ok(!/create table/.test(ST_REPO), 'admin-settings-repository.js 不搬家 DDL');
});

// ============================================================ admin-settings 域真 HTTP 行为测试（L3）

/** 起一个 pglite + 真 HTTP 服务，建好邮件相关表，返回 { store, q, srv, base, login }。 */
async function setupMailServer() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = async (username, password) => {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };
  return { store, q, srv, base, login };
}

test('admin-settings 权限：version/smtp/emails/mail/log/proxies 匿名 401、普通用户 403', async () => {
  const { store, srv, base, login } = await setupMailServer();
  const aliceCookie = await login('alice', 'alice123456');
  try {
    for (const p of ['/api/admin/version', '/api/admin/smtp', '/api/admin/emails', '/api/admin/mail/templates', '/api/admin/mail/log', '/api/admin/proxies']) {
      assert.equal((await fetch(base + p)).status, 401, `${p} 匿名 401`);
      assert.equal((await fetch(base + p, { headers: { cookie: aliceCookie } })).status, 403, `${p} 普通用户 403`);
    }
  } finally {
    await srv.close();
    await store.close();
  }
});

test('SMTP 配置：未配置视图 → 保存 → 读回 database 源且密码不回传', async () => {
  const { store, q, srv, base, login } = await setupMailServer();
  const adminCookie = await login('admin', 'admin123456');
  try {
    const before = await (await fetch(`${base}/api/admin/smtp`, { headers: { cookie: adminCookie } })).json();
    assert.equal(before.smtp.source, 'env', '未配置时回落 env 源');
    assert.equal(before.smtp.ready, false, '未配置时 ready=false');
    assert.equal(before.smtp.hasPassword, false);

    const save = await fetch(`${base}/api/admin/smtp`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ host: 'smtp.example.com', port: 587, secure: false, user: 'sender@example.com', pass: 'secret-pass', from: '', enabled: true }),
    });
    assert.equal(save.status, 200);
    const row = (await q('select host, port, secure, username, from_addr, enabled from smtp_settings where id = 1')).rows[0];
    assert.equal(row.host, 'smtp.example.com');
    assert.equal(row.port, 587);
    assert.equal(row.secure, false);
    assert.equal(row.username, 'sender@example.com');
    assert.equal(row.enabled, true);

    const after = await (await fetch(`${base}/api/admin/smtp`, { headers: { cookie: adminCookie } })).json();
    assert.equal(after.smtp.source, 'database', '保存后读回 database 源');
    assert.equal(after.smtp.ready, true, 'host+from 齐备 → ready=true');
    assert.equal(after.smtp.hasPassword, true, '密码只回 hasPassword');
    assert.ok(!JSON.stringify(after).includes('secret-pass'), '响应不含密码明文');

    // 发件人留空回退账号
    assert.equal(after.smtp.from, 'sender@example.com', 'from 留空回退账号');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('SMTP 测试邮件：未配置 400 提示缺失项', async () => {
  const { store, srv, base, login } = await setupMailServer();
  const adminCookie = await login('admin', 'admin123456');
  try {
    const res = await fetch(`${base}/api/admin/smtp/test`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'a@b.com' }),
    });
    assert.equal(res.status, 400, 'SMTP 未配置 → 400');
    assert.match((await res.json()).error, /SMTP 配置不完整/);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('邮件模板：9 事件列表 → 保存（enabled=false）→ 读回 → 恢复默认；非法事件 404；预览三段', async () => {
  const { store, srv, base, login } = await setupMailServer();
  const adminCookie = await login('admin', 'admin123456');
  const put = (url, body) =>
    fetch(`${base}${url}`, { method: 'PUT', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const post = (url, body) =>
    fetch(`${base}${url}`, { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const list = await (await fetch(`${base}/api/admin/mail/templates`, { headers: { cookie: adminCookie } })).json();
    assert.equal(list.templates.length, 9, '9 个事件模板齐全');
    assert.equal(list.samples.length, 3, '3 套示例版式');
    assert.ok(Array.isArray(list.variables) && list.variables.includes('code'), '变量表含 code');
    for (const t of list.templates) assert.equal(t.isDefault, true, '初始全是默认');

    const bad = await put('/api/admin/mail/templates/nope', { subject: 's', body_html: '<p>x</p>' });
    assert.equal(bad.status, 404, '非法事件 404');

    const saved = await put('/api/admin/mail/templates/account_deleted', { subject: '自定义主题', body_html: '<p>{{username}}</p>', body_text: null, enabled: false });
    assert.equal(saved.status, 200);
    const list2 = await (await fetch(`${base}/api/admin/mail/templates`, { headers: { cookie: adminCookie } })).json();
    const t2 = list2.templates.find((t) => t.event === 'account_deleted');
    assert.equal(t2.isDefault, false, '保存后不再是默认');
    assert.equal(t2.enabled, false, '启停要落库');
    assert.equal(t2.subject, '自定义主题');

    const reset = await post('/api/admin/mail/templates/account_deleted/reset', {});
    assert.equal(reset.status, 200);
    const list3 = await (await fetch(`${base}/api/admin/mail/templates`, { headers: { cookie: adminCookie } })).json();
    assert.equal(list3.templates.find((t) => t.event === 'account_deleted').isDefault, true, '恢复默认 = 删表行');

    const preview = await post('/api/admin/mail/templates/account_deleted/preview', {});
    assert.equal(preview.status, 200);
    const pv = await preview.json();
    assert.ok(pv.subject && pv.html && pv.text, '预览返回 subject/html/text');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('模板测试邮件：SMTP 未配置 503 + 10 秒冷却 429（冷却在发送前生效）', async () => {
  const { store, srv, base, login } = await setupMailServer();
  const adminCookie = await login('admin', 'admin123456');
  try {
    const first = await fetch(`${base}/api/admin/mail/templates/account_deleted/test`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'admin@example.com' }),
    });
    assert.equal(first.status, 503, 'SMTP 未配置 → 503');

    const second = await fetch(`${base}/api/admin/mail/templates/account_deleted/test`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'admin@example.com' }),
    });
    assert.equal(second.status, 429, '10 秒内第二次 → 429');
    assert.match((await second.json()).error, /10 秒内只能发一次/);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('emails 与 mail/log 空态：管理员 200 空列表', async () => {
  const { store, srv, base, login } = await setupMailServer();
  const adminCookie = await login('admin', 'admin123456');
  try {
    const emails = await (await fetch(`${base}/api/admin/emails?limit=50`, { headers: { cookie: adminCookie } })).json();
    assert.deepEqual(emails.records, [], 'emails 空列表');
    const log = await (await fetch(`${base}/api/admin/mail/log?limit=50`, { headers: { cookie: adminCookie } })).json();
    assert.deepEqual(log.entries, [], 'mail/log 空列表');
  } finally {
    await srv.close();
    await store.close();
  }
});
