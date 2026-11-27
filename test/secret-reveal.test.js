// FX 批（docs/SECRET-REVEAL.md §7 验收 1/2/3/4/5/6）：后台密钥查看统一为「密码框 + 眼睛」。
//
// 三层锁行为（前端没有组件级测试框架，沿用项目「静态 / 纯函数」惯例）：
//  1) 纯逻辑 frontend/src/utils/secretField.js——眼睛请求次数、30 秒回密文、未改动不提交（验收 2/3/4/5）；
//  2) 模板静态锁——四处布局分支都渲染 SecretField、旧的 revealSecret / 「已保存密钥不会自动回显」已删（验收 1）；
//  3) 真 HTTP + pglite——明文查看落 audit_logs（detail 只含 key、不含值）、非 secret 400、
//     匿名 401 / 非管理员 403、审计失败不阻塞返回（验收 6）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import * as settings from '../src/settings.js';
import { startApiServer } from '../src/server.js';
import {
  PROXY_MASK,
  SECRET_AUTO_HIDE_MS,
  eyeAction,
  parseProxyLines,
  submitDecision,
} from '../frontend/src/utils/secretField.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const adminModules = read('../frontend/src/pages/AdminModules.vue');
const secretField = read('../frontend/src/components/SecretField.vue');

// 测试里默认关掉登录验证码（与 test/api.test.js 同一约定）
process.env.CAPTCHA_ENABLED = '0';

// ---------------------------------------------------------------- 验收 2/3/4/5：纯逻辑

test('验收 2：眼睛请求次数——首次 fetch、命中缓存不重复请求、明文态再点只切密文', () => {
  assert.equal(SECRET_AUTO_HIDE_MS, 30000, '决策 3：明文 30 秒无操作自动回密文');
  assert.equal(eyeAction({ hasValue: false, loaded: null, revealed: false }), 'ignore', '未配置：不发任何请求');
  assert.equal(eyeAction({ hasValue: true, loaded: null, revealed: false }), 'fetch', '第一次点眼睛调一次接口');
  assert.equal(eyeAction({ hasValue: true, loaded: 'value', revealed: false }), 'reveal-cached', '再点眼睛命中缓存，不重复请求');
  assert.equal(eyeAction({ hasValue: true, loaded: 'value', revealed: true }), 'hide', '明文态再点 = 回 type=password');
  assert.equal(eyeAction({ hasValue: true, loaded: '', revealed: false }), 'reveal-cached', '空字符串也算已取过（不再请求）');
});

test('验收 5：未改动不提交、留空 = 保持原值、改了才提交新值', () => {
  assert.deepEqual(submitDecision({ draft: '', baseline: null }), { submit: false, reason: 'empty' }, '没输入不提交');
  assert.deepEqual(submitDecision({ draft: '   ', baseline: 'old' }), { submit: false, reason: 'empty' }, '留空 = 保持原值');
  assert.deepEqual(submitDecision({ draft: 'old', baseline: 'old' }), { submit: false, reason: 'unchanged' }, '懒加载真值未改不提交（防误覆盖）');
  assert.deepEqual(submitDecision({ draft: ' new ', baseline: 'old' }), { submit: true, reason: 'changed', value: 'new' }, '改了才提交，trim 后写入');
  assert.deepEqual(submitDecision({ draft: 'first', baseline: null }), { submit: true, reason: 'changed', value: 'first' }, '没点眼睛、直接输入新值 = 提交');
});

test('验收 1：代理多条逐行解析（每行可单独复制），掩码固定长度不泄露真实内容', () => {
  assert.deepEqual(parseProxyLines('http://a:1\nhttp://b:2'), ['http://a:1', 'http://b:2']);
  assert.deepEqual(parseProxyLines('http://a:1\r\n\r\n  http://b:2  '), ['http://a:1', 'http://b:2'], 'CRLF + 空行 + 两端空白');
  assert.deepEqual(parseProxyLines('http://a:1, http://b:2'), ['http://a:1', 'http://b:2'], '逗号分隔也兼容');
  assert.deepEqual(parseProxyLines(''), [], '空值没有行');
  assert.equal(PROXY_MASK.length, 12, '代理密文态固定 12 位掩码（不随真实条数/长度变化）');
});

test('验收 2/3/4/5：SecretField.vue 真的用了这些纯逻辑与 30 秒定时器（静态锁）', () => {
  assert.match(secretField, /eyeAction\(\{ hasValue: hasValue\.value, loaded: loadedValue\.value, revealed: revealed\.value \}\)/, '点眼睛走 eyeAction 判定');
  assert.match(secretField, /setTimeout\(hidePlain, SECRET_AUTO_HIDE_MS\)/, '30 秒定时器用常量，不写魔法数');
  assert.match(secretField, /submitDecision\(\{ draft: draft\.value, baseline: loadedOriginal\.value \}\)/, '提交走 submitDecision（懒加载真值作基线）');
  assert.match(secretField, /loadedValue\.value == null && String\(draft\.value \?\? ''\)\.trim\(\) !== ''/, '先输入新值再点眼睛：只切草稿明文，不拉旧值覆盖输入');
  assert.match(secretField, /ElMessage\.info\('没有变化，未提交'\)/, '未改动时只提示「无变化」');
  assert.match(secretField, /ElMessageBox\.confirm/, '清除有二次确认');
  assert.match(secretField, /values: \{ \[props\.field\.key\]: null \}/, '清除提交 null（回落 env/默认）');
  assert.match(secretField, /:type="revealed \? 'text' : 'password'"/, '密文/明文只切 type');
  assert.match(secretField, /:class="\{ 'is-plain': revealed \}"/, '明文态挂等宽类');
  assert.match(secretField, /\.secret-input\.is-plain :deep\(\.el-input__inner\) \{[\s\S]*?ui-monospace/, '明文态等宽字体（demo 状态②）');
  assert.match(secretField, /:disabled="!canReveal"/, '未配置时眼睛置灰不可点');
  assert.match(secretField, /@media \(max-width: 560px\)/, '移动端断点 560px');
  assert.match(secretField, /min-height: 44px/, '移动端触摸目标 ≥44px');
  assert.match(secretField, /class="secret-proxy-line"/, '代理明文逐行展示');
  assert.match(secretField, />复制<\/el-button>/, '代理每行可单独复制');
});

test('验收 1：SecretField 模板可编译（模板静态锁之外的真实编译级检查）', async () => {
  const tpl = /<template>([\s\S]*?)\n<\/template>/.exec(secretField)?.[1] ?? '';
  assert.ok(tpl, '模板段存在');
  const { compile } = await import('@vue/compiler-dom');
  compile(tpl, { mode: 'module' });
  assert.match(tpl, /<el-input/, '标准密码框');
  assert.match(tpl, /class="secret-eye"/, '自实现眼睛按钮（不用 el-input show-password）');
  assert.doesNotMatch(tpl, /show-password(?=[\s/>])/, '不用 show-password 属性：值要先懒加载');
  assert.match(tpl, />清除<\/el-button>/, '清除入口在框旁');
});

test('验收 1（DOM 断言）：SecretField 真渲染——默认 type=password + 眼睛 + 清除；未配置时眼睛 disabled', async () => {
  // 项目没有组件级测试框架：用 Vite 的 SSR 模块加载 + @vue/server-renderer 做真实渲染断言
  // （编译产物 HTML 就是浏览器首屏结构；交互态由上面的纯函数锁住）。
  const { createServer } = await import('vite');
  const { createSSRApp } = await import('vue');
  const { renderToString } = await import('@vue/server-renderer');
  const { ElButton, ElInput } = await import('element-plus');
  const server = await createServer({
    configFile: 'frontend/vite.config.js',
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  try {
    const mod = await server.ssrLoadModule('/src/components/SecretField.vue');
    const render = async (field, extra = {}) => {
      const app = createSSRApp(mod.default, { field, ...extra });
      app.use(ElInput);
      app.use(ElButton);
      app.config.warnHandler = () => {}; // SSR 下 el-* 解析告警与断言无关，压掉噪声
      return renderToString(app);
    };
    const configured = await render({ key: 'sources.steam.apiKey', label: 'Steam Web API Key', hasValue: true });
    assert.match(configured, /class="el-input__inner" type="password"/, '已配置默认渲染密码框（掩码交给浏览器）');
    assert.match(configured, /class="secret-eye"[^>]*aria-label="显示明文"/, '眼睛按钮在框内');
    assert.match(configured, />清除</, '已配置有「清除」入口');
    assert.match(configured, /点眼睛查看明文/, '提示「点眼睛查看明文」');
    assert.doesNotMatch(configured, />保存</, '没输入时没有提交入口（未动过不提交）');

    const empty = await render({ key: 'sources.steam.apiKey', label: 'Steam Web API Key', hasValue: false });
    assert.match(empty, /class="secret-eye" disabled/, '未配置：眼睛置灰不可点');
    assert.match(empty, /placeholder="尚未设置"/, '未配置：空框 placeholder「尚未设置」');
    assert.doesNotMatch(empty, />清除</, '未配置：没有清除入口');
    assert.doesNotMatch(empty, />保存</, '未配置且没输入：没有提交入口');

    // 代理多条：只读密码框（掩码由浏览器 type=password 渲染；SSR 不序列化 el-input 的 value 属性）；
    // 未配置时眼睛同样置灰，且没有清除入口。
    const proxy = await render({ key: 'network.steamProxy', label: 'Steam 专用代理', hasValue: true }, { mode: 'proxy' });
    assert.match(proxy, /class="el-input__inner" type="password" readonly/, '代理已配置：只读密码框');
    assert.match(proxy, /点眼睛逐行查看（每行可复制）/, '代理提示逐行查看/复制');
    assert.match(proxy, />清除</, '代理也有清除入口');
    const proxyEmpty = await render({ key: 'network.steamProxy', label: 'Steam 专用代理', hasValue: false }, { mode: 'proxy' });
    assert.match(proxyEmpty, /class="secret-eye" disabled/, '代理未配置：眼睛置灰');
    assert.match(proxyEmpty, /placeholder="尚未设置"/, '代理未配置：空框 + 尚未设置');
    assert.doesNotMatch(proxyEmpty, />清除</, '代理未配置：没有清除入口');
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------- 验收 1：secret 字段统一由行组件渲染

// FY-2（docs/SETTINGS-REDESIGN.md §3.2）：设置页改成「分区标题 + 一行一项」后，密钥字段仍复用本批组件
// （SettingsRow 是唯一渲染点，按 type=secret 分支走，不再在 AdminModules 里按 key 特判）。
test('验收 1：8 个 secret 全部经由 SettingsRow 的 SecretField 分支渲染（FY-2 行列表仍复用 FX 组件）', () => {
  const settingsRow = read('../frontend/src/components/SettingsRow.vue');
  assert.match(settingsRow, /import SecretField from '\.\.\/components\/SecretField\.vue'/, '行组件引入公共密钥组件');
  assert.match(settingsRow, /<SecretField/, '行内渲染 SecretField');
  assert.match(settingsRow, /mode="field\.key === 'network\.steamProxy' \? 'proxy' : 'single'"/, 'Steam 多条代理走 proxy 模式，其余单值模式');
  assert.match(settingsRow, /v-else-if="field\.type === 'secret'"/, '按 type 分支（不按 key 硬编码）');
  assert.equal((settingsRow.match(/<SecretField/g) ?? []).length, 1, '只有一个 SecretField 渲染点（8 个密钥统一走它）');
  assert.match(adminModules, /<SettingsRow v-for="field in sec\.fields"/, '设置页每项一行（密钥也是行）');
  assert.ok(!adminModules.includes('<SecretField'), '设置页不再有手写的密钥框（全部交行组件）');
  // 8 个 secret 全覆盖：sources 2 / alerts 3 / network 3，全部落在行组件里渲染
  const expected = [
    'sources.steam.apiKey',
    'sources.itad.apiKey',
    'alerts.smtp.pass',
    'alerts.webhookUrl',
    'alerts.wecomUrl',
    'network.steamProxy',
    'network.httpsProxy',
    'network.appSyncProxy',
  ];
  assert.deepEqual(settings.SETTINGS.filter((d) => d.secret).map((d) => d.key).sort(), [...expected].sort(), '本批覆盖的 8 个 secret 设置项');
  for (const key of expected) {
    const field = settings.SETTING_MAP.get(key);
    assert.equal(field.type, 'secret', `${key} 是 secret`);
    assert.ok(['sources', 'alerts', 'network'].includes(field.group), `${key} 落在设置页的三个分组里`);
  }
});

test('FX 清理：旧 revealSecret / 明文塞输入框 / 「已保存密钥不会自动回显」提示 / 代理查看弹窗全部移除', () => {
  assert.doesNotMatch(adminModules, /revealSecret/, '旧「查看」把明文塞进输入框的逻辑已删');
  assert.doesNotMatch(adminModules, /secretDialog/, '两个代理的旧查看/编辑弹窗已删');
  assert.doesNotMatch(adminModules, /clearSecrets/, '旧「清除」checkbox 状态已删');
  assert.doesNotMatch(adminModules, /secretPlaceholder/, '旧「已设置，留空保持原值」placeholder 已删');
  assert.doesNotMatch(adminModules, /已保存密钥不会自动回显/, '旧提示已删（新交互点眼睛即可看）');
  // FY-2：整份「保存设置」批量提交已删除（改为每项即时保存），密钥因此不会被批量覆盖；
  // 即时保存回写视图时也显式跳过密钥明文（不落 settingValues/savedValues）。
  assert.doesNotMatch(adminModules, /submitSettings/, '整份批量提交已删除（改为局部 values 即时保存）');
  assert.match(adminModules, /function isSecretKey\(key\)/, '回写视图时识别密钥 key');
  assert.match(adminModules, /if\(!isSecretKey\(key\)&&view\.values/, '密钥明文不回写进页面值状态（FX 决策 5）');
});

// ---------------------------------------------------------------- 验收 6：后端审计与权限（真 HTTP + pglite）

const login = async (base, username, password) => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  return { status: res.status, cookie, body: await res.json() };
};

test('验收 6：显示明文写 audit_logs（detail 只含 key、不含值）+ 400/401/403 + 审计失败不阻塞', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user' });
  await settings.ensureSettingsSchema(store);
  const srv = await startApiServer({ query: q, store, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const savedEnv = process.env.STEAM_API_KEY;
  try {
    const admin = await login(base, 'admin', 'admin123456');
    const alice = await login(base, 'alice', 'alice123456');
    const KEY = 'sources.steam.apiKey';
    const VALUE = 'fx-test-steam-api-key-123456';
    const saved = await fetch(`${base}/api/admin/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ values: { [KEY]: VALUE } }),
    });
    assert.equal(saved.status, 200, '保存密钥成功');
    await q("delete from audit_logs where action = 'admin.secret_revealed'");

    const reveal = await fetch(`${base}/api/admin/settings/value?key=${encodeURIComponent(KEY)}`, {
      headers: { cookie: admin.cookie },
    });
    assert.equal(reveal.status, 200, '管理员可查看明文');
    const revealBody = await reveal.json();
    assert.equal(revealBody.value, VALUE, '返回明文（契约 { key, value, source } 不变）');
    assert.equal(revealBody.key, KEY);

    const audits = (
      await q("select actor, actor_id, action, target, detail, ip from audit_logs where action = 'admin.secret_revealed'")
    ).rows;
    assert.equal(audits.length, 1, '显示明文落一条审计（再点眼睛不重复请求 → 不会重复写）');
    const row = audits[0];
    assert.equal(row.action, 'admin.secret_revealed');
    assert.equal(row.target, KEY, 'target = key 名');
    assert.equal(row.actor, 'admin', 'actor = 管理员用户名');
    const adminId = (await q("select id from users where username = 'admin'")).rows[0].id;
    assert.equal(row.actor_id, adminId, 'actor_id = 管理员 id');
    assert.deepEqual(row.detail, { key: KEY }, 'detail 只含 key 名');
    assert.ok(row.ip, 'ip 沿用 server 侧 clientIp（不是空）');
    assert.ok(!JSON.stringify(row).includes(VALUE), '审计里绝不含明文值');

    // 非 secret key：400「只能查看敏感字段」（回归，契约不变）
    const bad = await fetch(`${base}/api/admin/settings/value?key=alerts.smtp.port`, { headers: { cookie: admin.cookie } });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, '只能查看敏感字段');
    // 不存在的 key 也 400（不是 500）
    assert.equal((await fetch(`${base}/api/admin/settings/value?key=nope.key`, { headers: { cookie: admin.cookie } })).status, 400);

    // 非管理员：匿名 401、已登录普通用户 403
    assert.equal((await fetch(`${base}/api/admin/settings/value?key=${encodeURIComponent(KEY)}`)).status, 401, '匿名 401');
    assert.equal(
      (await fetch(`${base}/api/admin/settings/value?key=${encodeURIComponent(KEY)}`, { headers: { cookie: alice.cookie } })).status,
      403,
      '普通用户 403',
    );

    // 审计失败不阻塞主流程：删掉审计表后仍返回明文（writeAuditLog 内部吞异常）
    await q('drop table if exists audit_logs');
    const reveal2 = await fetch(`${base}/api/admin/settings/value?key=${encodeURIComponent(KEY)}`, {
      headers: { cookie: admin.cookie },
    });
    assert.equal(reveal2.status, 200, '审计写失败不影响明文返回');
    assert.equal((await reveal2.json()).value, VALUE);
  } finally {
    if (savedEnv === undefined) delete process.env.STEAM_API_KEY;
    else process.env.STEAM_API_KEY = savedEnv;
    await srv.close();
    await store.close();
  }
});
