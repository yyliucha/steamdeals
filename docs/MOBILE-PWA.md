# 手机端 PWA：像 App 一样打开（待开发）

> 状态：**已实现，待发版（2026-11-05）**；已提交 main，等「构建 vX.Y.Z」指令。
> 真机验收（Android Chrome「添加到主屏幕」）需部署后在手机上确认，见 §7。
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
| 服务端 | 静态文件方式提供 `/manifest.webmanifest`（放入 `frontend/public`，构建后随 dist 输出，无需新路由） |

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
| `frontend/index.html` | manifest / theme-color / apple-touch-icon 引用 |
| `frontend/public/manifest.webmanifest` + 图标 PNG | 新增（构建后随 `dist` 输出） |
| `frontend/src/main.js` 或 `App.vue` | 网络失败统一提示（全局 fetch 拦截器） |
| `frontend/src/pages/Home.vue` | 返回键入栈处理（详情弹窗 / 抽屉 / 筛选层） |
| 测试 | `test/pwa.test.js`：manifest 字段齐全、图标文件存在、`index.html` 引用正确、无 service worker 注册 |

## 7. 验收

1. Android Chrome 打开站点 →「添加到主屏幕」→ 桌面出现独立图标，启动后**无地址栏**（standalone）。
2. `manifest.webmanifest` 可访问且字段齐全（name/short_name/start_url/display/icons/theme_color）。
3. 断网后操作 → 出现「网络不可用，请检查连接后重试」；恢复网络后可重试成功，**没有**离线可用的假象。
4. 详情弹窗打开时按 Android 返回键 → **关闭弹窗**，不退出 PWA；再按一次才退出。
5. 手机端「购买」按钮仍是跳转 Steam 商店页（与 PC 一致）；没有出现购物车入口。
6. PC 端行为零变化（回归检查列表页、详情、筛选、主题）。
7. 通用验证：`npm test` 全绿（新增 `test/pwa.test.js` 进主链）、`npm run frontend:build`、`npm run scan`；不自行打 tag。

## 8. 实施顺序

1. `manifest.webmanifest` + 图标 + `index.html` 引用（先让"添加到主屏幕"可用）；
2. 服务端/构建产物确认 `manifest` 能访问；
3. 网络失败统一提示；
4. Android 返回键处理；
5. 测试与文档同步（`docs/WEB.md` 页面表、`docs/PROJECT-OVERVIEW.md`、`README.md`、`CHANGELOG.md`）。

## 9. 待确认

无（PWA 范围、不做购物车、手机端保留购买按钮均已在 2026-11-05 确认）。
