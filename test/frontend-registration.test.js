// 前端注册防回归：抽屉/角标/复选框若漏注册，移动端筛选、通知、愿望单会静默失效；
// 封禁页跳转依赖 main.js 读取 __BAN_PAGE__。静态断言成本低，防止组件列表被精简时再次漏掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mainJs = readFileSync(fileURLToPath(new URL('../frontend/src/main.js', import.meta.url)), 'utf8');

test('main.js 注册了抽屉/角标/复选框（移动端筛选、通知抽屉、愿望单勾选依赖）', () => {
  for (const token of ['ElDrawer', 'ElBadge', 'ElCheckboxGroup', 'ElCheckbox']) {
    assert.match(mainJs, new RegExp(token), `main.js 应引用 ${token}`);
  }
  for (const css of ['drawer/style/css', 'badge/style/css', 'checkbox/style/css']) {
    assert.match(mainJs, new RegExp(css.replace(/\//g, '\\/')), `main.js 应加载样式 ${css}`);
  }
});

test('main.js 读取 __BAN_PAGE__ 并跳转封禁页（/banned、/appeal 除外，避免申诉死循环）', () => {
  assert.match(mainJs, /__BAN_PAGE__/);
  assert.match(mainJs, /router\.replace\('\/banned'\)/);
  assert.match(mainJs, /location\.pathname !== '\/banned'/);
  assert.match(mainJs, /location\.pathname !== '\/appeal'/);
});
