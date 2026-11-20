// 前端注册防回归：抽屉/角标/复选框若漏注册，移动端筛选、通知、愿望单会静默失效；
// 封禁页跳转必须在 serveBanPage 注入的内联脚本里完成（main.js 的 router.replace 已被证实无效）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mainJs = readFileSync(fileURLToPath(new URL('../frontend/src/main.js', import.meta.url)), 'utf8');
const serverJs = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
const adminUiJs = readFileSync(fileURLToPath(new URL('../frontend/src/admin-ui.js', import.meta.url)), 'utf8');

test('main.js 注册了抽屉/角标/复选框/气泡（移动端筛选、通知抽屉、愿望单勾选、价格悬停线图依赖）', () => {
  for (const token of ['ElDrawer', 'ElBadge', 'ElCheckboxGroup', 'ElCheckbox', 'ElPopover']) {
    assert.match(mainJs, new RegExp(token), `main.js 应引用 ${token}`);
  }
  for (const css of ['drawer/style/css', 'badge/style/css', 'checkbox/style/css', 'popover/style/css']) {
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

// ---------------------------------------------------------------- EC 批（docs/IMAGE-COVERAGE.md §8 EC-3）

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

test('EC-3 品牌占位组件：S 标 + 游戏名首字，模板可编译', async () => {
  const src = read('../frontend/src/components/CoverPlaceholder.vue');
  const { compile } = await import('@vue/compiler-dom');
  // 编译级断言：只编译 template 段，模板不合法直接抛错（静态字符串断言查不出模板错误）
  const tpl = /<template>([\s\S]*?)<\/template>/.exec(src)?.[1] ?? '';
  assert.ok(tpl, '模板段存在');
  compile(tpl, { mode: 'module' });
  assert.match(tpl, />S</, '占位必须带品牌 S 标');
  assert.match(src, /\.charAt\(0\)\.toUpperCase\(\)/, '首字 = 游戏名首字符大写');
  assert.match(tpl, /ph-char/, '首字渲染节点');
  // 反向自检：删掉模板里的 <i class="ph-s">S</i> → 第一条断言变红（S 标缺失）；把 name 换成固定字符串
  // 常量 → charAt 断言变红（首字不再跟随游戏名）。空名回退 S 保证占位永不空白。
  assert.match(src, /\(props\.name \|\| 'S'\)/, '空名回退 S');
});

test('EC-3 封面使用点统一引用 CoverPlaceholder，失败路径不再 display:none 空白块', () => {
  const points = {
    '../frontend/src/pages/Home.vue': ['列表与详情', 2], // import 1 处 + 列表 1 处 + 详情 1 处 = 3 次出现
    '../frontend/src/components/GameDetailDialog.vue': ['后台详情弹窗', 1],
    '../frontend/src/pages/ProfilePage.vue': ['愿望单/游戏库弹窗', 1],
    '../frontend/src/pages/AdminModules.vue': ['游戏目录列表', 1],
    '../frontend/src/pages/AdminExtras.vue': ['Steam 游戏库', 1],
    '../frontend/src/components/GameLinksDrawer.vue': ['平台链接抽屉', 1],
  };
  for (const [file, [label]] of Object.entries(points)) {
    const src = read(file);
    assert.match(src, /CoverPlaceholder/, `${label}（${file}）必须渲染品牌占位`);
    // 封面 img 的失败处理不允许 display:none（那是空白块）；反向自检：把 @error 改回 display:none → 变红
    assert.doesNotMatch(
      src,
      /\/img\/steam\/[\s\S]{0,140}display='none'/,
      `${label}（${file}）封面失败不得再 display:none`,
    );
  }
  const home = read('../frontend/src/pages/Home.vue');
  const n = home.split('CoverPlaceholder').length - 1;
  assert.ok(n >= 3, `Home.vue 列表与详情都渲染占位（import + 2 使用点，实际 ${n} 处）`);
});

// ---------------------------------------------------------------- EM 批（docs/STEAM-SYNC-TIMEOUT.md EL-3）

test('EM EL-3：后台 Steam 同步按钮走「触发 202 + 轮询 sync-status」，失败显示原因不再笼统超时', () => {
  const src = read('../frontend/src/pages/AdminExtras.vue');
  // 反向自检：把轮询改回「一次 POST 等结果」→ 这些断言变红（sync-status 引用消失）；
  // 把按钮文案改回不带「同步中…」→ 第二条变红。
  assert.match(src, /sync-status/, '轮询 sync-status 状态接口');
  assert.match(src, /同步中…/, '按钮有「同步中…」状态文案');
  assert.match(src, /60000/, '轮询最长 60s');
  assert.match(src, /setTimeout\(r,2000\)/, '轮询间隔 2s');
  assert.match(src, /accepted/, '处理 202 {accepted} 触发响应');
  assert.match(src, /同步失败：/, '失败显示明确原因');
  assert.doesNotMatch(src, /请求超时，请稍后再试/, '不再出现笼统超时错误（验收③）');
});
