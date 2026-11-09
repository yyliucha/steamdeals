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

test('三条路由与标题（§5.1）', () => {
  for (const [path, title] of [['/login', '登录 · SteamDeals'], ['/register', '注册 · SteamDeals'], ['/change-password', '修改密码 · SteamDeals']]) {
    assert.match(routerJs, new RegExp(`path: '${path}'`), `${path} 路由`);
    assert.ok(routerJs.includes(title), `${path} 标题`);
  }
});

test('首页：登录跳 /login?next=…，不再弹登录框；用户菜单有修改密码入口；401 跳登录；mustChange 跳改密页', () => {
  assert.match(home, /function goLogin\(\)\{router\.push\(\{path:'\/login',query:\{next:route\.fullPath\}\}\);?\}/, 'goLogin 带回跳');
  assert.ok(!home.includes('loginVisible'), '首页登录弹窗已移除');
  assert.ok(!home.includes('<el-dialog v-model="loginVisible"'), '无登录弹窗模板');
  assert.match(home, /router\.push\('\/change-password'\)/, '用户菜单修改密码入口');
  assert.match(home, /res\.status===401&&path!=='\/api\/me'&&path!=='\/api\/login'/, '401 跳登录（游客 /api/me 除外）');
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

test('后台：随机生成 + 临时密码弹窗（只显示一次）+ 重置留空生成临时密码（§5.5）', () => {
  assert.match(userCreateDrawer, /随机生成/, '随机生成按钮（建号抽屉内，AT 批搬移）');
  assert.match(userCreateDrawer, /留空自动生成临时密码/, '建号留空提示（抽屉内）');
  assert.match(adminExtras, /tempPwdDialog/, '临时密码弹窗');
  assert.match(adminExtras, /showTempPassword/, '展示临时密码');
  assert.match(adminExtras, /copyTempPassword/, '复制临时密码');
  assert.match(adminExtras, /仅显示一次/, '只显示一次提示');
  assert.match(userCreateDrawer, /tempPassword/, '抽屉内一次性展示临时密码');
  assert.match(adminExtras, /inputPattern:\/\^\$\|\^\.\{12,200\}\$/, '重置留空生成临时密码（校验放行空值）');
});

test('站点信息带注册就绪状态（/api/site → registration.enabled/smtpReady）', () => {
  assert.match(siteServer, /registration: \{ enabled: registrationEnabled, smtpReady: registrationSmtpReady \}/, '/api/site 返回注册状态');
});
