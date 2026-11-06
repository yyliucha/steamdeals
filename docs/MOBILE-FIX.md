# 手机端适配修复（已发布 v1.16.2）

> 状态：**已实现并发布 v1.16.2（2026-11-06）**；tag `v1.16.2` 已推送，镜像构建见 CI。
> 真机验收（红米 K100 Pro Max + 小米自带浏览器）需部署后在手机上执行，见 §5。
> 关联：[MOBILE-PWA.md](MOBILE-PWA.md)（PWA 已发布 v1.16.0）、[MOBILE-VIEWPORT.md](MOBILE-VIEWPORT.md)（真机视口，v1.10.0）、
> [WEB.md](WEB.md)、[TODO.md](TODO.md)。

## 1. 现象与真机证据

所有者用**红米 K100 Pro Max + 小米自带浏览器**访问，`?debug=1` 浮层输出：

```
innerWidth 980 / screen.width 400 / DPR 3 / isMobile true / desktopMode true
UA Mozilla/5.0 (X11; Linux x86_64) ...（桌面 UA）
```

问题表现：① 详情页/部分内容右侧被裁、横向溢出；② 没有安装提示，手动创建的快捷方式打开仍是浏览器（有地址栏）；③ 怀疑还有页面没适配。

**结论链**：

| 事实 | 证据 |
|---|---|
| 浏览器把布局视口当 **980**（忽略 `<meta viewport>`） | debug 浮层 `innerWidth 980` |
| 代码用 zoom 把 CSS 视口压回 400，所以**列表页其实是对的** | `frontend/src/main.js:38-47`：`zoom = innerWidth/screen.width = 2.45` |
| 但 **`vw` 单位不受 `zoom` 影响**：`100vw` 仍是 980 | `Home.vue` 的 `.mobile-full{width:100vw!important;max-width:100vw}` |
| 详情弹窗因此 980 宽塞进 400 视口 → 右侧被裁 | 截图 |
| 有一条死规则：`html.mobile-layout` 这个 class **从未被添加** | `Home.vue:250` 全仓仅此一处引用 |
| 没有任何安装提示逻辑 | 全仓无 `beforeinstallprompt` / `appinstalled` |
| 后台表格**未卡片化** | `AdminModules.vue:101` 的 `isMobile` 定义后未使用；`main.css` 无 `el-table` 响应式规则 |
| README 却写着"后台游戏目录、访问记录在手机上改卡片式" | `README.md:129`（文档与实现不符） |

## 2. 已确认的决策（2026-11-06）

| # | 决策 |
|---|---|
| 1 | **桌面模式先做轻量兜底**：保留 zoom + 顶部提示"请关闭桌面版网站"，**不**按 980 视口重做布局 |
| 2 | **后台表格真做卡片化**：先做游戏目录、访问记录；其余表格加"左右滑动"提示，后续迭代 |
| 3 | **允许调整移动端视觉**（字号/间距/触摸目标/卡片样式） |
| 4 | **安装按钮放顶部条**（可关闭）；不支持安装的浏览器给 Chrome 操作说明 |

## 3. 方案

### A. 消除 `vw/vh` 逃逸（根因修复）

| 位置 | 改动 |
|---|---|
| `Home.vue` `.mobile-full` | `width:100vw!important` → `width:100%!important`；`max-width:100vw` → `max-width:100%`；`height:100vh` → `height:100%`，另加 `height:100dvh` 兜底 |
| `Home.vue:78` 弹窗宽度 | `:width="isMobile ? '100%' : (isNarrow ? '96vw' : '880px')"` |
| `Home.vue:250` 死规则 | 删除 `:global(html.mobile-layout) .detail-dialog{…100vw…}`，全屏样式统一由 `.mobile-full` 承担 |
| 图片 | `.m-cover img`、`.detail-cover` 补 `max-width:100%;height:auto` |
| `main.css` `.storefront` | `min-height:100vh` → `min-height:100dvh`（保留 `100vh` 作为 fallback 前置声明） |
| 全局 | `html,body{max-width:100%;overflow-x:hidden}`；el-table 自身的横向滚动不受影响（它有内部滚动容器） |

### B. 桌面模式提示（轻量兜底）

- `desktopMode` 判定沿用 `Home.vue:131-139`；
- 判定为真时，移动端顶部插一条**可关闭**提示条：
  「检测到浏览器按『桌面版网站』渲染，建议在浏览器菜单关闭后刷新，可获得完整手机版体验」+「刷新」按钮；
- 关闭状态存 `sessionStorage`（本次会话不再提示）；
- 保留现有 zoom 补偿，不改其公式（`main.js:41`），但 A 之后 `vw` 不再逃逸，缩放才真正完整。
- 同一提示在「我的」页放一条常驻说明（避免关闭后找不到）。

### C. 安装提示（PWA）

新增 `frontend/src/composables/useInstallPrompt.js`：

```js
// beforeinstallprompt：Chrome/Edge 触发；preventDefault 后保存事件，点按钮时 prompt()
// appinstalled / matchMedia('(display-mode: standalone)')：已安装则隐藏入口
// 不支持（小米自带浏览器/微信）：返回 supported:false，由 UI 给 Chrome 操作说明
```

UI：

| 场景 | 表现 |
|---|---|
| 支持安装且未安装 | 移动端顶部条「安装到桌面」按钮，点击调 `prompt()` |
| 已 standalone / 已安装 | 不显示 |
| 不支持 | 不显示按钮；「我的」页显示说明：请用 **Chrome** 打开 → 菜单 →「安装应用」；若之前建过快捷方式，先删除再装 |

### D. 后台表格卡片化

- `AdminModules.vue:101` 的 `isMobile` 改为响应式（`matchMedia` + `resize` 监听，阈值 760）；
- **游戏目录**：`v-if="isMobile"` 渲染卡片列表（封面、名称、AppID、Steam 价、信息/状态/同步状态/分级标签、操作按钮、勾选框），`v-else` 保留 el-table；
- **访问记录**（访问明细/待审/设备/已封设备/黑名单/白名单/自动封禁）：同样卡片化，字段与现有列一致；
- 其余表格（用户、Steam 账号、回收站、公告、日志等）：外层包 `.table-scroll`，右侧加渐隐遮罩 + 首屏提示"左右滑动查看更多"；
- 卡片与表格**共用同一份数据与操作方法**，不新增接口。

### E. 移动端视觉微调（允许改）

- 触摸目标统一 ≥44px（筛选/分段/底部导航/操作按钮）；
- 卡片间距 14 → 12、圆角统一 14px；价格与标题层级对比加强；
- 底部导航 `padding-bottom: env(safe-area-inset-bottom)`；
- 搜索框与「筛选」按钮等高对齐；
- 字号基线：正文 14、说明 12、价格 20+，避免 zoom 补偿后偏小。

## 4. 影响面

| 文件 | 改动 |
|---|---|
| `frontend/src/pages/Home.vue` | A（vw/vh、弹窗宽度、死规则、图片）、B 提示条、C 安装按钮、E 视觉 |
| `frontend/src/main.js` | 仅保留/微调 zoom 兜底；不再新增全局 hack |
| `frontend/src/composables/useInstallPrompt.js` | **新增** |
| `frontend/src/pages/AdminModules.vue` | D：响应式 isMobile + 游戏目录/访问记录卡片 + 其余表格滚动提示 |
| `frontend/src/pages/AdminExtras.vue` | D：其余表格滚动提示（用户/Steam 账号/回收站等） |
| `frontend/src/styles/main.css` | A（overflow-x、dvh）、D（`.table-scroll` 遮罩）、E（断点内视觉） |
| `test/frontend-mobile.test.js` | **新增**：静态断言——`Home.vue` 中不再出现 `100vw`/`mobile-layout`；`main.js` 保留 zoom 兜底；`main.css` 含 `100dvh`；`AdminModules` 卡片分支存在 |
| `README.md:129` | 按实际实现修正"后台表格卡片化"的表述 |

## 5. 验收

1. **真机（红米 K100 Pro Max + 小米自带浏览器，桌面模式保持开启）**：打开首页 → 详情弹窗**不再横向溢出**；页面不能左右拖动。
2. 同机型关闭「桌面版网站」后刷新：布局与字号明显更正常（对照截图）。
3. 桌面模式检测生效：顶部出现提示条；点「刷新」重新加载；关闭后本次会话不再出现。
4. 支持安装的浏览器（建议用 Chrome 验证）：顶部出现「安装到桌面」；点击后安装成功，从桌面启动为 **standalone 无地址栏**。
5. 不支持的浏览器：「我的」页能看到 Chrome 安装说明，且不出现误导性的安装按钮。
6. 后台「游戏目录」在手机上为**卡片列表**（不横向滚动），勾选与批量操作可用；桌面端仍为表格。
7. 后台「访问记录」各 tab 在手机上为卡片；其余表格出现"左右滑动"提示且能滚动。
8. PC 端零回归：首页列表/详情/筛选、控制台各模块与改动前一致。
9. `npm test` 全绿（新增 `test/frontend-mobile.test.js` 进主链）、`npm run frontend:build`、`npm run scan`。

## 6. 实施顺序

1. **A（根因）**：先去掉 `100vw/100vh`，真机复测详情页是否还溢出——这一步最可能一次性解决截图问题；
2. **B 桌面模式提示**（小）；
3. **C 安装提示**（composable + 顶部条 + 「我的」说明）；
4. **D 后台卡片化**（先游戏目录 → 访问记录 → 其余滚动提示）；
5. **E 视觉微调**；
6. 测试与文档（README 表述、`docs/WEB.md`、`PROJECT-OVERVIEW`、CHANGELOG）。

## 7. 待确认

无（四项决策已于 2026-11-06 确认）。
