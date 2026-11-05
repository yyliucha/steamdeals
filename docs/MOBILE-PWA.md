# 手机端 PWA：像 App 一样打开（已发布 v1.16.0）

> 状态：**已实现并发布 v1.16.0（2026-11-05）**；tag `v1.16.0` 已推送，镜像构建见 CI。
> 真机验收（Android Chrome「添加到主屏幕」、更新提示、离线不误报）待服务器部署后在手机上确认，见 §7。
> 关联：[MOBILE-VIEWPORT.md](MOBILE-VIEWPORT.md)（移动端真机适配，已发布 v1.10.0）、
> [WEB.md](WEB.md)（页面与 API）、[TODO.md](TODO.md)。

## 1. 背景与已确认的决策

所有者目标：**手机上像 App 一样打开站点**；**不做购物车**、不做站内购买，手机端与 PC 行为一致——
点进详情 → 跳转 Steam 商店 → 用户自己登录购买。

| # | 决策 |
|---|---|
| 1 | 做 **PWA**（加到主屏幕），**不上架、不打包 APK、不引入 Android 工具链** |
| 2 | **不做离线**：没网就提示网络问题，不缓存页面（避免"看到旧页面"） |
| 3 | **不做推送**（现有 webhook / 企业微信 / 邮件够用） |
| 4 | **不做购物车**（站内清单与 Steam 自动加购都已评估并否决，见 §4） |
| 5 | 手机端**保留「购买」按钮**，行为与 PC 一致：跳转 Steam 商店页 |

## 2. 要做的事

| 项 | 内容 |
|---|---|
| `manifest.webmanifest` | `name: SteamDeals`、`short_name: SteamDeals`、`start_url: /`、`display: standalone`、`orientation: portrait`、`theme_color`（与 `main.css` 暗色 token 对齐）、`background_color`、`icons`（192/512 各一份 + `purpose: maskable`） |
| 图标 | 由现有 `web/favicon.svg` 导出 192/512 PNG；`apple-touch-icon` 文件已有，补 `<link>` 引用 |
| meta | `frontend/index.html` 补 `theme-color`、`<link rel="manifest">`、`apple-mobile-web-app-*`（capable / status-bar-style / title） |
| 全屏 | `display: standalone`，从桌面图标启动无地址栏 |
| 网络失败提示 | 统一拦截 fetch 失败（断网 / 超时）：页面级空态「网络不可用，请检查连接后重试」+ 可重试提示；**不缓存、不排队重放** |
| Android 返回键 | 详情弹窗 / 抽屉 / 筛选层打开时 `history.pushState` 入栈，`popstate` **关闭浮层**而不是退出应用 |
| 服务端 | 静态文件方式提供 `/manifest.webmanifest` 与两个图标（放入 `frontend/public`，构建后随 dist 输出）；**但必须把它们加进 `serveFrontendStatic` 的 `frontendDir` 白名单**，否则请求会落到 `outDir` → 404（详见 §6） |

### 2.1 版本检查与更新提示（半自动更新，默认只提示）

现状事实：没有 service worker 时，**重新打开/刷新**一定会拿到新版（`index.html` 是 `cache-control: no-cache`，
见 `src/server.js:2998`；Vite 资源带 hash），但**停在页面上不会自己变**——这正是之前"手机看到旧页面"的原因。

补一套"半自动"：

```js
// frontend/src/composables/useVersionGuard.js
// 1) 启动时 GET /api/site（已有 version 字段，src/server.js:657）记下 siteVersion
// 2) visibilitychange 回到前台时再取一次
// 3) 版本不同 → 显示顶部提示条「已更新到 vX.Y.Z，点击刷新」
// 4) 默认**不自动 reload**（AUTO_RELOAD = false）：详情弹窗/搜索输入/后台表单会丢状态
```

要求：

- 只比较版本字符串，不做模糊匹配；请求失败（离线）时静默跳过，不弹"更新"；
- 提示条全局唯一，重复检测不叠加；用户可关闭（关闭后本次会话不再提示）；
- 刷新按钮走 `location.reload()`，不阻塞其它交互；
- 若将来想改成自动刷新，把 `AUTO_RELOAD` 打开即可，但**只在没有打开浮层且无未提交表单时**才 reload。

**部署侧确认项**（不由开发侧执行）：nginx 若对 HTML 加了 `expires` / `proxy_cache`，手机拿到的可能仍是旧 HTML，
届时连"重新打开"都不会更新——部署时需确认 HTML 响应头仍是 `no-cache`。

## 3. 明确不做

- **不加 service worker**：不做离线、不做预缓存。理由：会引入"版本不更新 / 看到旧页面"问题，而本项目已因
  "旧页面"排查过两轮（封禁页、nginx 日志）。
- **不做推送**：Web Push 在国内不可用，且已决定不需要。
- **不打 APK**：不上架、不引入 Android Studio / Gradle / 签名密钥；改代码即生效。

## 4. 决策存档：为什么不做购物车

> 这条写在这里，避免以后的会话重新提一遍。

### 4.1 站内待买清单（曾评估过，**否决**）

- 原设想：手机端「购买」换成「加入待买」，存账号跨设备，清单里看价格变化 + 按最低价平台跳转。
- 否决理由（所有者判断）：**意义不大**——清单最终还是跳到 Steam 让用户自己买，多一层清单没有改变购买路径；
  而手机端直接点进详情跳转，少一个概念、少一套表与页面。
- 已放弃的附带项：`user_cart` 表、清单页、备注/排序、导出 JSON、加入时价格快照。

### 4.2 Steam 自动加购（**技术上不可行 + 越界**）

| 事实 | 依据 |
|---|---|
| 愿望单能写，是因为有 `IWishlistService/AddToWishlist`（key + steamid + appid） | `src/steam-accounts.js:235-252` |
| **购物车没有对应 Web API**：属于商店网页会话，需要 `sessionid` + `steamLoginSecure`（= 账号密码 + Steam Guard），参数还要 `subid` 与地区，页面改版即失效 | 商店加购为网页表单/Ajax |
| 现有凭据只有加密后的 **API Key**（`api_key_enc`），不含任何密码或 cookie | `src/steam-login.js:22`、`src/steam-accounts.js:314` |
| 项目合规边界写着"**不绕过登录与签名校验**" | `README.md:474` |

**结论**：手机端与 PC 一致，跳转购买、用户自己登录 —— 方案最安全，也最少维护成本。

## 5. 已知体验取舍（写清，避免以后当成 bug）

- PWA 全屏下点外链（Steam 商店页）会**跳出到系统浏览器**，买完需手动切回——PWA 固有限制；只有装 APK/TWA
  用 Custom Tabs 才能缓解，而本项目明确不上架，接受这一点。
- Android 上「添加到主屏幕」入口在 Chrome/Edge 菜单里；部分国产 ROM 浏览器不支持独立窗口，仍以标签页打开。

## 6. 影响面

| 文件 | 改动 |
|---|---|
| `frontend/public/manifest.webmanifest` | **新增**：`name/short_name=SteamDeals`、`start_url="/"`、`display="standalone"`、`orientation="portrait"`、`theme_color`、`background_color`、`icons`（192/512，其一 `purpose:"maskable"`） |
| `frontend/public/icon-192.png`、`icon-512.png` | **新增**：由 `web/favicon.svg` 导出（`frontend/public` 目录当前不存在，需创建；Vite root 是 `frontend/`，public 内容会原样拷到 dist 根） |
| `frontend/index.html` | 补 `<link rel="manifest" href="/manifest.webmanifest">`、`<meta name="theme-color" content="…">`、`<link rel="apple-touch-icon" href="/apple-touch-icon.png">`、`apple-mobile-web-app-capable/status-bar-style/title` |
| `src/server.js` 的 `serveFrontendStatic`（约 2826 行） | **【最易漏】静态白名单**：现在只有 `/`、若干页面路径、`/assets/*` 从 `frontendDir` 出，其余全走 `outDir`（`out/` 静态曲线页）。必须把 `/manifest.webmanifest`、`/icon-192.png`、`/icon-512.png` 加进 `frontendDir` 分支（或加 `/icon-` 前缀规则），否则**构建成功但线上 404** |
| `frontend/src/pages/Home.vue`（`request()` 约 170 行） | 网络失败统一提示：fetch 抛错（断网/超时）→ 页面级「网络不可用，请检查连接后重试」+ 可重试；**不缓存、不排队重放** |
| `frontend/src/pages/Home.vue` 浮层 | 返回键入栈：`filterDrawer`（约 73 行）、`noticeDialog`（约 81 行）、`detailVisible`（约 163 行）打开时 `history.pushState`，`popstate` 关最上层浮层；可抽 `useBackGuard(visibleRef)` |
| `frontend/src/composables/useVersionGuard.js` | **新增**：启动 + `visibilitychange` 比对 `/api/site` 的 `version`（`src/server.js:657`），不一致显示「已更新到 vX.Y.Z，点击刷新」；离线静默跳过；`AUTO_RELOAD=false` |
| `frontend/src/App.vue` | 顶部更新提示条（全局唯一、可关闭）+（可选）全局网络错误提示条 |
| `test/pwa.test.js` | **新增**（进 `package.json` 的 test 链）：manifest 可解析且字段齐全；两个图标文件存在且 PNG 尺寸正确（读 IHDR）；`index.html` 含 manifest/theme-color/apple-touch-icon 引用；`main.js`/`index.html` **没有** serviceWorker 注册；版本比较纯函数（相等/不等/首次为空）用例 |

**不在本批范围**：`user_cart` 表、购物车页面、Steam 加购接口、任何登录态/密码/cookie 存储（见 §3、§4）。

## 7. 验收

1. Android Chrome 打开站点 →「添加到主屏幕」→ 桌面出现独立图标，启动后**无地址栏**（standalone）。
2. `manifest.webmanifest` 可访问（HTTP 200，`content-type: application/manifest+json` 或 `application/json`）且字段齐全
   （name/short_name/start_url/display/icons/theme_color）。
3. 断网后操作 → 出现「网络不可用，请检查连接后重试」；恢复网络后可重试成功，**没有**离线可用的假象。
4. 详情弹窗打开时按 Android 返回键 → **关闭弹窗**，不退出 PWA；再按一次才退出；筛选抽屉与通知弹窗同样。
5. 手机端「购买」按钮仍是跳转 Steam 商店页（与 PC 一致）；没有出现购物车/待买入口。
6. PC 端行为零变化（回归检查列表页、详情、筛选、主题）。
7. 部署新版本后，手机切回前台 → 顶部出现「已更新到 vX.Y.Z，点击刷新」；点刷新后版本号变化、页面无旧状态残留。
8. 离线状态下切回前台 → **不弹**更新提示（请求失败静默跳过），也不误报"已更新"。
9. 通用验证：`npm test` 全绿（新增 `test/pwa.test.js` 进主链）、`npm run frontend:build`、`npm run scan`；不自行打 tag。

## 8. 实施顺序

1. `manifest.webmanifest` + 图标 + `index.html` 引用（先让"添加到主屏幕"可用）；
2. 服务端/构建产物确认 `manifest` 能访问；
3. 网络失败统一提示；
4. Android 返回键处理；
5. 版本检查与更新提示（`useVersionGuard` + 顶部提示条，默认不自动刷新）；
6. 测试与文档同步（`docs/WEB.md` 页面表、`docs/PROJECT-OVERVIEW.md`、`README.md`、`CHANGELOG.md`）。

## 9. 待确认

无（PWA 范围、不做购物车、手机端保留购买按钮均已在 2026-11-05 确认）。

> 更新策略默认**只提示不自动刷新**；若以后要自动刷新，把 `useVersionGuard` 的 `AUTO_RELOAD` 打开，
> 并保留"有浮层/未提交表单时不刷新"的保护。
