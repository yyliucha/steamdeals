// 未保存修改的离开提醒（docs/UNSAVED-GUARD.md §7 验收 11，AN 批）：
// 前端无组件级测试框架，沿用 frontend-registration.test.js 的静态源码断言惯例，锁住：
// composable 五个接口、弹窗标题与三按钮、App.vue 挂载、路由守卫注册、五个编辑面全部注册、
// Console 切换前先询问、401/非管理员跳转 bypass、不拦刷新关闭（无 beforeunload）。
// 编译正确性由 frontend:build 兜底。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const composable = read('../frontend/src/composables/useUnsavedGuard.js');
const dialog = read('../frontend/src/components/UnsavedLeaveDialog.vue');
const app = read('../frontend/src/App.vue');
const routerJs = read('../frontend/src/router/index.js');
const consoleJs = read('../frontend/src/pages/Console.vue');
const adminModules = read('../frontend/src/pages/AdminModules.vue');
const adminExtras = read('../frontend/src/pages/AdminExtras.vue');
const mailForm = read('../frontend/src/components/MailSettingsForm.vue');

test('composable 五个接口齐全（§4.1），弹窗状态放模块级 reactive', () => {
  for (const fn of ['registerUnsavedSource', 'dirtySources', 'requestLeave', 'installRouterGuard', 'bypassNextGuard', 'saveAndLeave', 'discard', 'stay']) {
    assert.match(composable, new RegExp(`export (async )?function ${fn}\\b|export const ${fn}\\b`), `缺 ${fn}`);
  }
  assert.match(composable, /export const unsavedDialog = reactive\(\{ open: false, labels: \[\] \}\)/, '弹窗状态是模块级 reactive（Console 卸载后仍在）');
  assert.match(composable, /pendingPromise/, '已有弹窗时复用同一个 Promise（防重复弹）');
  assert.match(composable, /await source\.save\(\)/, '保存并离开按注册顺序逐个 await save');
});

test('弹窗：标题与三按钮文案（§3.1），失败留在本页并提示', () => {
  assert.match(dialog, /还有没保存的修改/, '标题');
  assert.match(dialog, /保存并离开/, '主按钮');
  assert.match(dialog, /放弃修改/, '按钮 2');
  assert.match(dialog, /留在本页/, '按钮 3');
  assert.match(dialog, /「\$\{unsavedDialog\.labels\.join\('」「'\)\}」还有修改没保存，离开后会丢失。要先保存吗？/, '多来源正文列出来源名');
  assert.match(dialog, /ElMessage\.error/, '保存失败给错误提示');
  assert.match(dialog, /ElMessage\.success\('已保存'\)/, '全部成功 toast 已保存');
  assert.match(dialog, /@close="stay"/, '右上角 × / Esc = 留在本页');
});

test('挂载与守卫：App.vue 挂全局弹窗、router 注册 beforeEach（§4.2/§4.3）', () => {
  assert.match(app, /UnsavedLeaveDialog/, 'App.vue 引入并挂载弹窗');
  assert.match(routerJs, /installRouterGuard\(router\)/, '路由守卫注册一次');
  assert.match(consoleJs, /requestLeave/, 'Console 切菜单前询问');
  assert.match(consoleJs, /if\(item\.id===selected\.value\)return/, '同菜单项重复点击直接返回');
  assert.match(consoleJs, /bypassNextGuard\(\)/, '非管理员/身份校验失败跳转前 bypass');
});

test('五个编辑面全部注册（§4.4），且保存回调是抛错版（失败才能留在本页）', () => {
  assert.match(adminModules, /label:'系统设置'/, '系统设置面');
  assert.match(adminModules, /label:'站点通知'/, '站点通知面');
  assert.match(adminModules, /label:'编辑游戏'/, '编辑游戏面');
  assert.match(mailForm, /label: '邮件配置'/, '邮件配置面');
  assert.match(adminExtras, /label:'新建用户'/, '新建用户面');
  assert.match(adminModules, /save:submitSettings/, '系统设置 save = submitSettings（抛错版）');
  assert.match(adminModules, /save:submitAnnouncement/, '站点通知 save = submitAnnouncement（抛错版）');
  assert.match(adminModules, /save:submitGameSave/, '编辑游戏 save = submitGameSave（抛错版）');
  assert.match(mailForm, /save: submit/, '邮件配置 save = submit（抛错版）');
  assert.match(adminExtras, /save:submitCreateUser/, '新建用户 save = submitCreateUser（抛错版）');
  assert.match(adminModules, /announcementSnapshot/, '站点通知快照比较');
  assert.match(adminModules, /gameSnapshot/, '编辑游戏快照比较');
  assert.match(adminExtras, /role!=='user'/, '新建用户角色默认不算脏');
});

test('边界：不拦刷新/关闭（无 beforeunload，决策 3）；菜单当前项有脏来源时显示小圆点', () => {
  for (const [name, src] of [['composable', composable], ['Console', consoleJs]]) {
    assert.ok(!src.includes('beforeunload'), `${name} 不得注册 beforeunload`);
  }
  assert.match(consoleJs, /hasDirtySources\(\)/, '菜单小圆点按脏来源刷新');
  assert.match(consoleJs, /nav-dirty/, '小圆点样式');
});
