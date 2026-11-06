# QA：手机端适配修复 Z 批（第 1 轮）

> 基线 5b085f8 → HEAD 49ec1cc；判据 docs/MOBILE-FIX.md §5 验收（9 条）；开发描述来源：会话交接单（A–E 落点）。
> 结论：⚠️ 有条件放行 —— 通过 7 / 缺失 0 / 偏差 0 / 需人工确认 2（真机验收 + PC 目视回归）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 真机详情弹窗不再横向溢出、页面不能左右拖 | grep 100vw/100vh/mobile-layout；读弹窗宽度与全屏样式；读全局防溢出 | `frontend/src/pages/Home.vue`：无 `100vw`/`100vh`/`mobile-layout`（grep 空）；`:264` `.mobile-full{width:100%!important;max-width:100%!important;height:100%;max-height:100%;height:100dvh…}`；`:80` `:width="isMobile ? '100%' : …"`；`styles/main.css:1` `html,body,#app{…overflow-x:hidden}` | ✅ 代码证据 + 🔎 真机复测 |
| 2 | 关闭桌面版网站后刷新，布局正常 | 读 isMobile 判定与 zoom 清空逻辑 | `main.js:41` `zoom = desktopMode ? innerWidth/screen.width : ''`（desktopMode=false 时清空）；`Home.vue:137-139` `matchMedia('(max-width:640px)')` 兜底 isMobile | ✅ 逻辑成立 + 🔎 真机 |
| 3 | 桌面模式提示条出现、可关闭、刷新有效 | grep 提示条模板与关闭逻辑 | `Home.vue:56` `v-if="desktopMode && !desktopHintDismissed" class="m-desktop-hint"`（含「刷新」+「✕」按钮）；`:166` `dismissDesktopHint` 写 sessionStorage；`:169` `reloadNow` → `location.reload()`；`desktopMode` 判定沿用 `screen.width<=640 && innerWidth>700`（`:137`） | ✅ |
| 4 | Chrome 顶部「安装到桌面」，装后 standalone | 读 composable 与顶部条 | `composables/useInstallPrompt.js:12-17` 监听 `beforeinstallprompt`（preventDefault 保存）/`appinstalled`/`display-mode: standalone`；`install()`（`:32-45`）调 `prompt()`；`Home.vue:57` `v-if="installCanInstall"` 顶部条；解构顶层 ref 保证模板 unwrap（`:165`） | ✅ + 🔎 HTTPS 真机验证 |
| 5 | 小米浏览器「我的」页有 Chrome 说明、无无效按钮 | grep mySheet 说明与按钮条件 | `Home.vue:78` 「安装到桌面：请用 Chrome 打开本站 → 菜单 →『安装应用』；若之前建过快捷方式，请先删除旧图标再重新安装」（`v-if="!installInstalled"`）；无 `beforeinstallprompt` 时 `canInstall=false` → 顶部条不渲染 | ✅ |
| 6 | 后台游戏目录手机卡片（不横滚）、勾选/批量可用；桌面表格 | 读卡片分支与批量接线 | `AdminModules.vue:9` 桌面 `v-if="!isMobile"` 表格 + `v-else class="game-card-list"` 卡片（`sel.games.has/toggle` 勾选、编辑/禁用/删除按钮，`:9` 卡片补同步状态/分级标签）；卡片列表为纵向 flex（`:292` 前后 `.game-card-list{display:flex;flex-direction:column;gap:8px}`） | ✅ + 🔎 真机目视 |
| 7 | 访问记录各 tab 卡片；其余表格滑动提示且能滚动 | grep 各 tab 卡片分支与提示 CSS | `AdminModules.vue:29/33/37/38/42/43/44` 共 8 处 `v-else class="game-card-list"`（访问明细/待审/最近设备/已封设备/黑名单/白名单/自动封禁）；`main.css:19` `.m-console .table-card::before{content:'左右滑动查看更多'}` + `::after` 渐隐；`AdminExtras.vue:15/27` Steam 表包 `.table-scroll`；`isMobile` 改 760 响应式（`AdminModules.vue:102`、`AdminExtras.vue:63-64`） | ✅（el-table 自带内部横向滚动，提示为叠加层） |
| 8 | PC 零回归 | 桌面走 `v-else` 原表格；vw 修改仅限 mobile-full；全局 CSS 改动评估 | 表格分支以 `!isMobile` 保留原样；`100vw→100%` 只作用 `.mobile-full`（仅手机加类）；`overflow-x:hidden` 为全局防御（PC 无横向溢出场景，el-table 内部滚动不受影响）；`.m-console` 仅在 ≤760 时挂载 | ✅ 静态 + 🔎 PC 目视回归 |
| 9 | npm test 全绿（新测试进主链）+ frontend:build + scan | 重跑 | `npm test` → 50 文件 / 427 项 / fail 0；`npm run frontend:build` → ✓ built in 1.38s；`npm run scan` → 无高置信度凭据；`package.json` test 链含 `node test/frontend-mobile.test.js` | ✅ |

## 纪律固定检查项

1. tag：`v1.16.2` 存在——由所有者「构建」指令产生（v1.16.1 之后新 tag 仅此一枚），非擅自新增 ✅
2. diff 未碰 compose/DEPLOY/凭据（16 文件：前端 + 测试 + 文档 + package.json）✅
3. 构建产物未入库：`git ls-files frontend/dist` = 0 ✅
4. 已按要求推 main（`49ec1cc`）✅
5. 文档同步：PROJECT-OVERVIEW Z 行「已实现并发布 v1.16.2」、README:129 卡片化表述已按实现修正、CHANGELOG `## [1.16.2]`、TODO/规格状态词一致 ✅

## 需人工确认

- 条目 1/2/3/4/5/6/7 的真机部分：需部署 v1.16.2 后在红米 K100 Pro Max + 小米自带浏览器按 §5 走一遍
  （详情不溢出、提示条、Chrome 安装、后台卡片、桌面模式开/关对照）；
- 条目 8 的 PC 目视回归：代码路径静态成立（桌面走原表格、`.m-console` 只在 ≤760），未做浏览器手工回归。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-06）：✅/🔎 如上，无打回项 → ⚠️ 有条件放行（条件 = 部署后真机验收 §5 第 1–8 条）。
