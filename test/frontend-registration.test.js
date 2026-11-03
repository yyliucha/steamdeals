// 前端注册防回归：抽屉/角标/复选框若漏注册，移动端筛选、通知、愿望单会静默失效；
// 封禁页跳转必须在 serveBanPage 注入的内联脚本里完成（main.js 的 router.replace 已被证实无效）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mainJs = readFileSync(fileURLToPath(new URL('../frontend/src/main.js', import.meta.url)), 'utf8');
const serverJs = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const adminUiJs = readFileSync(fileURLToPath(new URL('../frontend/src/admin-ui.js', import.meta.url)), 'utf8');

test('main.js 注册了抽屉/角标/复选框（移动端筛选、通知抽屉、愿望单勾选依赖）', () => {
  for (const token of ['ElDrawer', 'ElBadge', 'ElCheckboxGroup', 'ElCheckbox']) {
    assert.match(mainJs, new RegExp(token), `main.js 应引用 ${token}`);
  }
  for (const css of ['drawer/style/css', 'badge/style/css', 'checkbox/style/css']) {
    assert.match(mainJs, new RegExp(css.replace(/\//g, '\\/')), `main.js 应加载样式 ${css}`);
  }
});

test('admin-ui.js 注册了 radio（设备封禁弹窗的时长选择依赖）', () => {
  for (const token of ['ElRadio', 'ElRadioGroup']) {
    assert.match(adminUiJs, new RegExp(`\\b${token}\\b`), `admin-ui.js 应引用 ${token}`);
  }
  assert.match(adminUiJs, /radio\/style\/css/, 'admin-ui.js 应加载 radio 样式');
});

test('封禁页跳转：serveBanPage 注入的内联脚本在模块加载前改地址（/banned、/appeal 除外）', () => {
  assert.match(serverJs, /window\.__BAN_PAGE__=\$\{payload\}/, '服务端应注入 __BAN_PAGE__ payload');
  assert.match(serverJs, /history\.replaceState\(null,''/i, '内联脚本应改地址到 /banned');
  assert.match(serverJs, /location\.pathname!=='\/banned'/, '应排除 /banned 防循环');
  assert.match(serverJs, /location\.pathname!=='\/appeal'/, '应排除 /appeal 保住申诉入口');
});
