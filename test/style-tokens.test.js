// CO-4/D1 批（docs/DESIGN-AUDIT.md D1 行）：设计 token 的静态锁。
// 守的约束：
//   1) main.css 定义四族 token（间距/圆角/字号/层级），值是组件实际在用的 px 值（1:1 映射 = 零视觉变化前提）；
//   2) 试点组件（Home/AdminModules/AdminExtras）已按 token 引用（新样式裸 px 会被评审拦，这里锁"token 在生效"）；
//   3) 全仓禁止 `-var(--x)` 前缀负号写法——Chromium 实测该写法让整条声明计算值失效
//      （CSS.supports 返回真、实际计算值却归零，是"看着等价实则断样式"的典型陷阱），负值一律保留字面量。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');

test('D1：main.css 定义四族设计 token，值为真实 px（1:1 映射）', () => {
  const css = read('frontend/src/styles/main.css');
  for (const fam of ['space', 'radius', 'font']) {
    assert.match(css, new RegExp(`--${fam}-\\d+\\s*:\\s*\\d+px`), `${fam} 族 token 必须落 main.css`);
  }
  for (const name of ['--z-overlay', '--z-nav', '--z-sticky', '--z-bottomnav', '--z-detail', '--z-top']) {
    assert.match(css, new RegExp(`${name}\\s*:\\s*\\d+`), `${name} 必须落 main.css`);
  }
});

test('D1：试点组件已按 token 引用（间距/圆角/字号/层级各至少一处）', () => {
  const files = ['frontend/src/pages/Home.vue', 'frontend/src/pages/AdminModules.vue', 'frontend/src/pages/AdminExtras.vue'];
  for (const f of files) {
    const src = read(f);
    assert.match(src, /var\(--space-\d+\)/, `${f} 应引用间距 token`);
    assert.match(src, /var\(--radius-[\w]+\)/, `${f} 应引用圆角 token`);
    assert.match(src, /var\(--font-\d+\)/, `${f} 应引用字号 token`);
  }
  // 层级 token：Home（移动详情栏/底导）+ AdminModules（设置工具栏 sticky）
  assert.match(read('frontend/src/pages/Home.vue'), /z-index:var\(--z-(detail|bottomnav|sticky|top)\)/);
  assert.match(read('frontend/src/pages/AdminModules.vue'), /z-index:var\(--z-nav\)/);
});

test('D1：全仓禁止 -var(--x) 前缀负号写法（Chromium 计算值失效陷阱）', () => {
  for (const f of ['frontend/src/styles/main.css', 'frontend/src/pages/Home.vue', 'frontend/src/pages/AdminModules.vue', 'frontend/src/pages/AdminExtras.vue']) {
    const src = read(f);
    assert.ok(!/:\s*-var\(/.test(src), `${f} 不得出现 -var(--x)（负值保留字面量 px）`);
  }
});
