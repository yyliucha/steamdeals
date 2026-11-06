// 手机端适配修复（docs/MOBILE-FIX.md）：静态断言守住根因——
// vw 不受 zoom 影响（真机 980 视口下 100vw 仍是 980，详情弹窗右侧被裁），
// 全屏样式必须改回 %/dvh；mobile-layout 死规则删除；桌面模式提示与安装入口存在；
// 后台卡片分支与滑动提示存在；main.js 的 zoom 兜底保留（Z 批不改公式）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const home = readFileSync(ROOT + 'frontend/src/pages/Home.vue', 'utf8');
const mainJs = readFileSync(ROOT + 'frontend/src/main.js', 'utf8');
const mainCss = readFileSync(ROOT + 'frontend/src/styles/main.css', 'utf8');
const adminModules = readFileSync(ROOT + 'frontend/src/pages/AdminModules.vue', 'utf8');
const installPrompt = readFileSync(ROOT + 'frontend/src/composables/useInstallPrompt.js', 'utf8');

test('Home.vue 不再用 100vw/100vh 撑全屏，mobile-layout 死规则已删', () => {
  assert.ok(!home.includes('100vw'), '100vw 不受 zoom 影响，是详情弹窗右侧被裁的根因，必须清零');
  assert.ok(!home.includes('100vh'), '100vh 同理（改用 100%/100dvh）');
  assert.ok(!home.includes('mobile-layout'), 'html.mobile-layout 的 class 从未被添加，死规则必须删除');
  assert.match(home, /100dvh/, '全屏高度用 dvh 兜底');
  assert.match(home, /max-width:100%/, '图片与弹窗都要限宽');
});

test('main.css 全局防横向溢出 + dvh 基线 + 后台表格滑动提示', () => {
  assert.match(mainCss, /overflow-x:hidden/, 'html/body 必须防横向拖动');
  assert.match(mainCss, /min-height:100dvh/, 'storefront 用 dvh（100vh 保留作 fallback）');
  assert.match(mainCss, /左右滑动查看更多/, '其余表格的滑动提示文案存在');
});

test('main.js 保留 zoom 兜底（桌面版网站渲染补偿，Z 批不改公式）', () => {
  assert.match(mainJs, /document\.documentElement\.style\.zoom/, 'zoom 兜底必须保留');
  assert.match(mainJs, /innerWidth \/ window\.screen\.width/, 'zoom 公式保持 innerWidth/screen.width');
});

test('桌面模式提示条与安装入口（B/C）', () => {
  assert.match(home, /桌面版网站/, '桌面模式提示文案存在');
  assert.match(home, /dismissDesktopHint/, '提示条可关闭（sessionStorage）');
  assert.match(home, /安装到桌面/, '安装按钮存在');
  assert.match(home, /useInstallPrompt/, 'Home 使用安装提示 composable');
  assert.match(installPrompt, /beforeinstallprompt/, '监听 beforeinstallprompt');
  assert.match(installPrompt, /appinstalled/, '监听 appinstalled');
  assert.match(installPrompt, /display-mode: standalone/, 'standalone 判定');
});

test('AdminModules 手机卡片分支存在，断点 760 响应式', () => {
  assert.match(adminModules, /game-card-list/, '卡片列表分支存在');
  assert.match(adminModules, /v-if="!isMobile"/, '桌面端保留表格');
  assert.match(adminModules, /max-width: 760px/, '手机断点 760');
  assert.match(adminModules, /addEventListener\('change'/, '断点变化监听（resize/旋转）');
  // 游戏目录 + 访问记录各 tab（访问明细/待审/最近设备/已封设备/黑名单/白名单/自动封禁）都要有卡片分支
  const cardBranches = (adminModules.match(/v-else class="game-card-list"/g) || []).length;
  assert.ok(cardBranches >= 8, `访问记录各 tab 都要有卡片分支，实际 ${cardBranches}`);
});
