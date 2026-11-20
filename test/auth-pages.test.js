// 登录 / 注册 / 改密页面（docs/AUTH-REDESIGN.md §7 验收 10 + §5，AL 批）：
// 前端无组件级测试框架，沿用静态源码断言惯例：三条路由与标题、首页不再弹登录框（跳 /login?next=…）、
// 密码可见切换 + Caps Lock 提示 + 错误就地显示 + 记住我、回跳 next 只允许站内路径、
// 注册页强度条（/api/password/check + ElProgress）+ 60 秒倒计时 + 不可用说明、
// 改密页 forced 提示、后台新建/重置的随机生成与临时密码弹窗、401 跳登录。编译正确性由 frontend:build 兜底。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const routerJs = read('../frontend/src/router/index.js');
const home = read('../frontend/src/pages/Home.vue');
const login = read('../frontend/src/pages/LoginPage.vue');
const register = read('../frontend/src/pages/RegisterPage.vue');
const changePwd = read('../frontend/src/pages/ChangePasswordPage.vue');
const adminExtras = read('../frontend/src/pages/AdminExtras.vue');
const userCreateDrawer = read('../frontend/src/components/UserCreateDrawer.vue');
const mainJs = read('../frontend/src/main.js');
const siteServer = read('../src/server.js');
const siteRoutes = read('../src/routes/site.js');

test('三条路由与标题（§5.1）', () => {
  for (const [path, title] of [['/login', '登录 · SteamDeals'], ['/register', '注册 · SteamDeals'], ['/change-password', '修改密码 · SteamDeals']]) {
    assert.match(routerJs, new RegExp(`path: '${path}'`), `${path} 路由`);
    assert.ok(routerJs.includes(title), `${path} 标题`);
  }
});

test('首页：登录跳 /login?next=…，不再弹登录框；DT-5 起登录后前台无退出/修改密码入口；401 跳登录；mustChange 跳改密页', () => {
  assert.match(home, /function goLogin\(\)\{openLogin\(\);?\}/, 'goLogin 走统一硬跳 openLogin（BT 批）');
  assert.match(home, /import \{ openLogin \} from '\.\.\/utils\/login-entry\.js'/, 'Home 引入 login-entry helper');
  assert.ok(!home.includes('loginVisible'), '首页登录弹窗已移除');
  assert.ok(!home.includes('<el-dialog v-model="loginVisible"'), '无登录弹窗模板');
  // DT-5（docs/ADMIN-PERMISSIONS.md）：登录后前台不显示「退出登录 / 修改密码」
  // （退出/改密统一在控制台顶栏用户菜单树）——旧「用户菜单修改密码入口」被规格取代。
  assert.ok(!home.includes("router.push('/change-password')"), '前台不再有修改密码入口（DT-5）');
  assert.ok(!/退出（\{\{ user\.displayName/.test(home), '移动抽屉不再有退出按钮（DT-5）');
  assert.ok(!home.includes('@click="logout"'), '前台不再有退出按钮（DT-5）');
  assert.match(home, /<el-button v-if="!user" plain @click="goLogin">登录<\/el-button>/, '未登录显示「登录」按钮（跳 /login）');
  assert.match(home, /class="user-chip"/, '登录后显示用户徽标（点进个人资料）');
  assert.match(home, /res\.status===401&&path!=='\/api\/me'&&path!=='\/api\/login'/, '401 跳登录（游客 /api/me 除外）');
  assert.match(home, /redirectToLogin\('expired'\)/, '前台 401 统一走 redirectToLogin（BT 批硬跳）');
  assert.match(home, /d\.user\?\.mustChangePassword\)\{router\.replace\('\/change-password\?forced=1'\)/, 'mustChange 跳改密页');
});

test('登录页：三模式、可见切换、Caps Lock、就地错误、记住我、next 站内校验、验证码重试', () => {
  assert.match(login, /密码登录/, '模式一');
  assert.match(login, /邮箱验证码/, '模式二');
  assert.match(login, /忘记密码/, '模式三');
  assert.match(login, /show-password/, '密码可见切换');
  assert.match(login, /getModifierState\?\?\('CapsLock'\)|getModifierState\?\.\('CapsLock'\)/, 'Caps Lock 提示');
  assert.match(login, /fieldError\.username|fieldError\.password|fieldError\.captcha/, '错误就地显示');
  assert.match(login, /rememberMe/, '记住我');
  assert.match(login, /next\.startsWith\('\/'\) && !next\.startsWith\('\/\/'\)/, 'next 只允许站内相对路径');
  assert.match(login, /autocomplete="current-password"/, 'autocomplete');
  assert.match(login, /captcha-retry/, '验证码加载失败重试占位');
});

test('注册页：强度条（password/check + ElProgress）+ 60 秒倒计时 + 不可用说明 + 返回登录；ElProgress 已注册', () => {
  assert.match(register, /\/api\/password\/check/, '强度条接口');
  assert.match(register, /el-progress/, '强度条组件');
  assert.match(register, /codeCooldown\s*>\s*0/, '60 秒倒计时重发');
  assert.match(register, /暂未开放注册|还没有配置发信邮箱/, '不可用说明');
  assert.match(register, /返回登录/, '返回登录');
  assert.ok(mainJs.includes('ElProgress'), 'main.js 注册 ElProgress');
  assert.match(mainJs, /progress\/style\/css/, 'ElProgress 样式');
});

test('改密页：forced 提示不可关闭、当前密码、成功后提示其它设备退出', () => {
  assert.match(changePwd, /forced/, 'forced 参数');
  assert.match(changePwd, /首次登录请修改初始密码/, '首次登录提示');
  assert.match(changePwd, /:closable="false"/, '提示不可关闭');
  assert.match(changePwd, /当前密码/, '当前密码字段');
  assert.match(changePwd, /密码已修改，其它设备已退出登录/, '成功提示');
});

test('后台：随机生成 + 临时密码弹窗（只显示一次）+ 重置走验证码弹窗（DT-4 起）', () => {
  assert.match(userCreateDrawer, /随机生成/, '随机生成按钮（建号抽屉内，AT 批搬移）');
  assert.match(userCreateDrawer, /留空自动生成临时密码/, '建号留空提示（抽屉内）');
  assert.match(adminExtras, /tempPwdDialog/, '临时密码弹窗');
  assert.match(adminExtras, /showTempPassword/, '展示临时密码');
  assert.match(adminExtras, /copyTempPassword/, '复制临时密码');
  assert.match(adminExtras, /仅显示一次/, '只显示一次提示');
  assert.match(userCreateDrawer, /tempPassword/, '抽屉内一次性展示临时密码');
  // DT-4（docs/ADMIN-PERMISSIONS.md）：重置密码交互改为验证码弹窗（demo ③ admin-users-2026-11-19.html）——
  // 「确认重置」走验证码校验（后端生成临时密码、tempPwdDialog 只显示一次）；
  // 旧「留空生成临时密码」的 prompt 交互被规格取代（后端 POST /api/admin/users/:u/password 不带 code
  // 的直设密码模式保留，供未来入口复用）。
  assert.match(adminExtras, /confirmResetPwd/, '确认重置走验证码校验（DT-4 弹窗）');
});

test('站点信息带注册就绪状态（/api/site → registration.enabled/smtpReady）', () => {
  // CO-5/B4-2 第七轮：/api/site 已随 site 域抽到 src/routes/site.js（B4 #7），断言指向新落点
  assert.match(siteRoutes, /registration: \{ enabled: registrationEnabled, smtpReady: registrationSmtpReady \}/, '/api/site 返回注册状态');
  assert.ok(!siteServer.includes("path === '/api/site'"), '/api/site 分支不得残留在 server.js（防双实现）');
});

// ---------------------------------------------------------------- BT 批（docs/MOBILE-LOGIN-ENTRY-FIX.md §6）
// 登录入口统一硬跳（方案 C）：helper 结构 + next 白名单 + 懒加载 chunk 兜底。

test('BT：openLogin 结构——防循环、next 白名单、reason、location.assign 整页跳', () => {
  const entry = read('../frontend/src/utils/login-entry.js');
  assert.match(entry, /export function openLogin\(\{ reason = '', next = null \} = \{\}\)/, 'openLogin 签名（reason + next）');
  assert.match(entry, /window\.location\.pathname === '\/login'\)\s*return/, '已在登录页防循环');
  assert.match(entry, /safeNextPath\(raw\)/, 'next 走白名单函数');
  assert.match(entry, /window\.location\.assign\(`\/login\?/, 'location.assign 整页硬跳');
  assert.match(entry, /if \(reason\) qs\.set\('reason', reason\)/, 'reason=expired 透传登录页');
});

test('BT：safeNextPath 只接受站内相对路径（// 与绝对 URL 一律回落 /）', async () => {
  const { safeNextPath } = await import('../frontend/src/utils/login-entry.js');
  assert.equal(safeNextPath('/console?section=games'), '/console?section=games', '站内路径原样保留');
  assert.equal(safeNextPath('/a/b#c'), '/a/b#c', '带 hash 的站内路径保留');
  assert.equal(safeNextPath('//evil.com/x'), '/', '协议相对地址回落 /');
  assert.equal(safeNextPath('https://evil.com/x'), '/', '绝对 URL 回落 /');
  assert.equal(safeNextPath(''), '/', '空值回落 /');
  assert.equal(safeNextPath(null), '/', 'null 回落 /');
});

test('BT：main.js 注册 router.onError 懒加载 chunk 兜底（同路径每会话只硬载一次）', () => {
  assert.match(mainJs, /router\.onError\(/, '注册 onError');
  assert.match(mainJs, /Failed to fetch dynamically imported module\|Loading chunk\|Importing a module script failed/i, '只认 chunk 加载失败');
  assert.match(mainJs, /sd:chunk-retry/, 'sessionStorage 防循环标记');
  assert.match(mainJs, /sessionStorage\.setItem\(key, '1'\)/, '硬载前落标记');
  assert.match(mainJs, /window\.location\.assign\(to\.fullPath\)/, '整页重载目标路由');
});

// ===== DT-4（docs/ADMIN-PERMISSIONS.md）：验证码按钮统一三态 + 重置密码弹窗 =====
// demo 状态 ↔ 断言（admin-users-2026-11-19.html ③）：
//   ①「打开不发码 · 手动发送 + 倒计时」→ 用例 1/2/3；
//   ②「失败不关闭 · 剩余次数提示」→ 用例 4；
//   ③「已发送，58 秒后可重发；验证码 10 分钟有效」→ 用例 5。
// 反向自检：把任一处按钮删掉「发送中…」三态或把 confirmResetPwd 的 catch 改成关闭弹窗 → 对应断言红；
// 把 sendResetCode 的调用挪到打开弹窗时（自动发码）→ 用例 1 红。
test('DT-4 验收 1：所有验证码按钮统一三态（发送中…/剩余秒数/可重发）——登录/注册/后台重置弹窗', () => {
  // 登录页 + 注册页：三态 + 后端 retryAfterSec 驱动倒计时
  assert.match(login, /codeSending \? '发送中…' : codeCooldown > 0 \? `\$\{codeCooldown\}s 后重发` : '发送验证码'/, '登录页三态按钮');
  assert.match(login, /Number\(d\.retryAfterSec\) \|\| 60/, '登录页倒计时读后端 retryAfterSec');
  assert.match(register, /codeSending \? '发送中…' : codeCooldown > 0 \? `\$\{codeCooldown\}s 后重发` : '发送验证码'/, '注册页三态按钮');
  assert.match(register, /Number\(d\.retryAfterSec\) \|\| 60/, '注册页倒计时读后端 retryAfterSec');
  // 后台重置弹窗：三态 + 过期后「重新发送」（冷却结束可点）
  assert.match(adminExtras, /resetPwd\.sending \? '发送中…' : resetPwd\.cooldown > 0 \? `\$\{resetPwd\.cooldown\}s 后重发` : resetPwd\.codeSent \? '重新发送' : '发送验证码'/, '重置弹窗三态 + 重新发送');
});

test('DT-4 验收 2：重置密码弹窗打开不发码——openResetPassword 只填状态、sendResetCode 才请求', () => {
  assert.match(adminExtras, /function openResetPassword\(row\)/, '打开弹窗函数');
  assert.match(adminExtras, /openResetPassword[\s\S]{0,400}?clearInterval\(resetPwdTimer\);resetPwd\.cooldown=0/, '打开时重置倒计时（重开不自动发码）');
  assert.match(adminExtras, /\/api\/admin\/users\/\$\{encodeURIComponent\(resetPwd\.username\)\}\/reset-code/, '点「发送验证码」才调发码接口');
  assert.ok(!/openResetPassword[\s\S]{0,200}reset-code/.test(adminExtras.replace(/sendResetCode[\s\S]*?reset-code/, '')), '发码请求不在打开弹窗路径上');
});

test('DT-4 验收 3：验证失败不关弹窗 + 「还剩 N 次机会」；过期/无码提示重发', () => {
  // 失败分支：不关闭 visible，按后端 remainingAttempts 显示剩余次数
  assert.match(adminExtras, /if\(e\.data\?\.remainingAttempts!=null\)resetPwd\.error=`\$\{e\.message\}（还剩 \$\{e\.data\.remainingAttempts\} 次机会）/, '失败显示还剩 N 次机会');
  assert.match(adminExtras, /——弹窗不关闭，可直接重试/, '弹窗不关闭提示');
  // 后端：过期/无码给明确提示（前端原样展示，弹窗不关）
  const server = read('../src/server.js');
  assert.match(server, /验证码已过期，请重新发送/, '过期提示（前端显示重新发送）');
  assert.match(server, /没有可用的验证码，请先发送/, '无码提示先发送');
  assert.match(server, /remainingAttempts: remaining/, '错码响应带剩余次数');
});

test('DT-4 验收 4：后台发码不占前台额度（分桶）+ retryAfterSec 回传', () => {
  const server = read('../src/server.js');
  assert.match(server, /purpose = 'admin_reset'/, '后台发码独立 purpose 分桶');
  assert.match(server, /retryAfterSec: auth\.SEND_COOLDOWN_SEC/, '后台发码回传 retryAfterSec');
  const authRoutes = read('../src/auth-routes.js');
  assert.match(authRoutes, /where email = \$1 and purpose = \$2/, '前台登录/重置发码冷却按 purpose 过滤');
  assert.match(authRoutes, /retryAfterSec: SEND_COOLDOWN_SEC/, '前台发码成功回传 retryAfterSec');
});
