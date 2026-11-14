# 安卓 App（TWA，不上架）+ 可清缓存离线 + 双通道分发：规格

> 状态：**需求与方案已确认，待开发（2026-11-14）**。编号：**BS**（TODO 条目）。
> 前置决策推翻（所有者 2026-11-14 确认）：[MOBILE-PWA.md](MOBILE-PWA.md) §1 决策 #1「不上架、不打 APK、不引入 Android 工具链」、§3「不加 service worker」。
> 关联：[MOBILE-PWA.md](MOBILE-PWA.md)（现有 PWA 与已知取舍）、[SESSION-MANAGEMENT.md](SESSION-MANAGEMENT.md)（UA 绑定）、[BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md) §11（BR）、[WEB.md](WEB.md)（接口表）、[DELIVERY.md](DELIVERY.md)（发版流程）。

## 1. 已确认的决策（所有者 2026-11-14）

| # | 决策 |
|---|---|
| 1 | **只做 Android**；iOS 继续用 PWA（TestFlight ¥688/年、90 天一轮，不属本批） |
| 2 | **允许引入 Android 工具链**（JDK 17 + Android command-line tools + SDK）；签名密钥不入库 |
| 3 | 方案 **TWA（Bubblewrap）**，复用现有 PWA，不重写界面 |
| 4 | **分发双通道**：GitHub Release + **站点内的「安卓版」页面**（APK 托管自家服务器，附版本与 SHA-256） |
| 5 | **离线做，但用"可清缓存"策略**：只缓存带 hash 的静态资源与封面图，**HTML 与 API 永不缓存**；版本变化强制清缓存 + 顶部提示 |
| 6 | 原生能力**接受 Web 方案**：分享用 `navigator.share`、下载走浏览器下载器；**不换 Capacitor 壳** |
| 7 | **Bubblewrap 生成的 Android 工程入库**（可复现构建）；`*.keystore` / `*.jks` / `*.apk` 不入库 |
| 8 | 本批**不含推送与应用角标**（TWA 无原生推送；Web Push 依赖 FCM，国内不可达） |

## 2. 现实约束（写清，避免当成 bug）

1. **TWA 不是自绘 UI**：Chrome 内核渲染本站，界面/交互/登录态与浏览器一致——零改动的优点，也是无法做原生控件的限制。
2. **推送不可行**：TWA 无原生推送；Web Push 依赖 FCM/GCM，国内不可达。现有到价提醒继续走邮件 / 企业微信 webhook。
3. **应用角标不可行**：TWA 无 Badging API。
4. **外链行为**：TWA 里非同站链接由 **Custom Tabs** 打开（带返回），比 PWA「整页跳系统浏览器」体验好；但不是应用内 WebView。
5. **本站实测环境**：Java 23 已装、**Android SDK / adb / gradle / bubblewrap 全无** → 首次要装（约 1–2 GB）；AGP 建议 JDK 17。

## 3. Phase A · TWA 打包

### 3.1 工程与产物

| 项 | 内容 |
|---|---|
| 包名 | `cn.yyliucha.steamdeals`（固定；换签名会导致升级必须卸载重装） |
| 生成/构建 | `@bubblewrap/cli`：`init` → `build`；工程目录 `android/` **入库**（§1-7） |
| 站点 URL | `https://sd.yyliucha.cn`，`start_url = /` |
| 图标 / 启动色 | 复用 `frontend/public/icon-512.png` 与 manifest 的 `theme_color` |
| 版本号 | `versionName` 跟随 `/api/site` 的 `version`；`versionCode` 单调递增（规则：major*10000 + minor*100 + patch） |
| 签名 | 本地 keystore 备份到私有位置；`.gitignore` 加 `*.keystore`、`*.jks`、`android/local.properties`、**`android/app-release*.apk`**；**不要写 `*.apk`**（否则交付包提交不进去，见下一行） |
| **APK 交付位置** | **入库**：`frontend/public/app/steamdeals-<version>.apk` → Vite 构建时拷进 `frontend/dist/app/` → 随镜像发布。**只保留最近 3 个版本**，更早的删文件（SHA-256 留在 GitHub Release / CHANGELOG） |

### 3.2 必须新增的服务端静态资源（**【最易漏】两个都是构建成功但线上 404 的老坑**）

| 路径 | 作用 | 要求 |
|---|---|---|
| `/.well-known/assetlinks.json` | TWA 数字资产校验（缺了会带地址栏） | `application/json`、`no-cache`；内容含包名 + keystore SHA-256 指纹；**加进 `src/server.js` 的 `frontendDir` 静态白名单** |
| SW 文件由 Vite 输出（`/sw.js` 或 `/assets/sw-*.js`） | 离线缓存 | 同上白名单处理；不允许落到旧 `web/` |

`test/serve.test.js` 补断言：`/.well-known/assetlinks.json`、`/sw.js` 返回 200 且 Content-Type 正确。

### 3.3 外链与返回键

- 站点内 Steam 链接统一 `target="_blank" rel="noopener"` → 交给 Custom Tabs；
- 返回键：站内回上一页 / 浮层关闭优先（现有 `history.pushState` 逻辑保留）/ 根页面退出。

### 3.4 更新机制

- 复用 `useVersionGuard`：`/api/site` 版本变化 → 顶部提示条「已更新到 vX.Y.Z，点击刷新」；
- App 内「检查更新」只做**提示 + 打开发布页**（站点下载页或 GitHub Release），不做静默安装。

## 4. Phase B · 可清缓存离线（service worker）

**原则：离线只兜"静态观感"，绝不兜数据。**

| 项 | 规则 |
|---|---|
| 缓存对象 | 只缓存 `/assets/*`（Vite 带 hash）与封面图；**HTML、`/api/*`、`/manifest.webmanifest` 一律不缓存** |
| 导航请求 | 始终走网络（不返回缓存的 index.html），离线时显示现有「网络不可用」空态 |
| 版本变化 | `useVersionGuard` 检测到 `/api/site` 版本变化 → 顶部提示；用户点「刷新」时 `caches.delete(...)` + `registration.update()` + `location.reload()` |
| 旧版本清理 | SW `activate` 时删掉非当前版本前缀的缓存（`steamdeals-static-<buildId>`） |
| 卸载开关 | 提供 `?nosw=1` 或后台设置关闭 SW（排查"看到旧页面"用） |

> 这条与 [MOBILE-PWA.md](MOBILE-PWA.md) §3「不加 SW」相反，**以本规格为准**；`MOBILE-PWA.md` 收尾时补一行"已被 BS 推翻，策略见 §4"。

## 5. Phase C · 双通道分发

### 5.1 站点下载页（新增）

| 项 | 内容 |
|---|---|
| 页面 | `frontend/src/pages/AppDownloadPage.vue` + 路由 `/app`（**必须登记 `FRONTEND_PAGES` + `test/serve.test.js`**） |
| 入口 | 首页底部/「我的」里一个「安卓版 App」链接（`/app`） |
| 内容 | 版本号（来自 `/api/site` 或新接口）、APK 大小、SHA-256、安装步骤（允许未知来源）、已知限制（无推送/无角标）、GitHub 备用链接 |
| 数据 | 新增 `GET /api/app/latest`：返回 `{ version, apkPath, sha256, size, releasedAt }`（读 `frontend/public/app/` 同目录的 `latest.json`，发版时随 APK 一起提交，不查库） |
| 文件 | APK 与 `latest.json` 都在 `frontend/public/app/`（**入库**，随镜像）；`cache-control: no-cache`（避免缓存旧包）；**因为 `frontend/dist/` 不入库，改动 APK/清单后必须重新构建镜像才生效** |

### 5.2 GitHub Release

- tag：`app-v<version>`（与站点 `vX.Y.Z` 分开）；
- 资产：**同一个** APK 文件 + `.sha256`（与站点里的包字节一致，SHA-256 必须相同）；
- 说明：安装步骤、SHA-256、与站点版本对应关系、已知限制。

### 5.3 为什么 APK 必须"先入库、再下令构建"

镜像构建只看仓库内容：`Dockerfile` 的 frontend 阶段执行 `npm run frontend:build`，`frontend/public/**` 会被拷进 `dist/` 再进镜像。
所以顺序是固定的：

```
本机出 APK → 放进 frontend/public/app/ + 更新 latest.json → 提交推 main
→ 所有者下令「构建 vX.Y.Z」→ CI 出镜像（此时包已在镜像里）→ 服务器升级 → /app 可下载
```

若先构建再放 APK，那一次的镜像里没有包，页面会 404，得再等一次构建。

## 6. 与现有系统的交互（不放宽任何安全策略）

| 机制 | 影响 | 结论 |
|---|---|---|
| 会话 **UA 绑定**（`ua_key`） | TWA = Chrome 内核，UA 与手机 Chrome 一致 | ✅ 不影响；App 与浏览器是两个独立会话 |
| 会话 **IP 绑定** | 同手机同出口 | ✅ 按 BK 规则不变 |
| 限流 / 封禁 | App 请求同样计入页面/API 桶 | 不做特殊放行（BR 的页面桶分离已上线 v2.16.0，对 App 有利） |
| 设备指纹 / 黑名单 | UA 与浏览器相同，不产生新指纹 | ✅ 无需新增白名单 |
| 版本提示 | `/api/site` 已有 `version` | ✅ 直接复用 |

## 7. 工具链（一次性，不入库）

1. JDK 17（Temurin）；2. Android command-line tools + `platforms;android-35` + `build-tools;35.0.0`；
3. `npx @bubblewrap/cli`；4. `keytool` 生成 keystore；5. `bubblewrap init/build`；6. `apksigner verify --print-certs` 取 SHA-256 指纹。

## 8. 验收

| # | 验收 |
|---|---|
| 1 | 安装后全屏无地址栏（assetlinks 校验通过），图标/启动色与站点一致 |
| 2 | 点 Steam 外链 → Custom Tabs 打开，返回键回到 App 原页面 |
| 3 | App 内登录成功、刷新保持登录；与手机浏览器各自独立会话 |
| 4 | 浮层（详情/抽屉/筛选）用返回键关闭而不是退出 App |
| 5 | 站点版本升级后 App 内出现「已更新到 vX.Y.Z，点击刷新」；点刷新后缓存清空、拿到新版本 |
| 6 | 断网时：静态资源可显示，**HTML/API 不返回旧内容**，页面显示「网络不可用」提示 |
| 7 | `GET /api/app/latest` 返回正确版本与 SHA-256；站点 `/app` 页可下载并校验通过 |
| 8 | `/.well-known/assetlinks.json`、`/sw.js` 均 200 且测试有断言；`FRONTEND_PAGES` 含 `/app` |
| 9 | GitHub Release 有同名 APK + SHA-256，README 有「安卓版」入口 |
| 10 | 不放宽任何安全策略（UA/IP 绑定、限流、封禁不变）；`npm test` / `npm run frontend:build` / `npm run scan` 全绿；**不自行构建站点版本**（等「构建 vX.Y.Z」） |
| 11 | **镜像内含 APK**：构建产物里存在 `frontend/dist/app/steamdeals-<version>.apk`；部署后 `/app` 页直接可下载，不需要额外部署步骤 |
| 12 | `.gitignore` 只忽略 `android/app-release*.apk`；`git check-ignore -v frontend/public/app/*.apk` 必须**不命中**（交付包能提交） |

## 9. 实施顺序

1. 工具链就位（JDK 17 + cmdline-tools + SDK）；
2. 服务端静态白名单：`/.well-known/assetlinks.json`、`/sw.js`、`/app/*.apk` + `test/serve.test.js` 断言；
3. service worker（§4 规则）+ 版本清理 + `?nosw=1`；
4. `GET /api/app/latest` + `/app` 下载页 + 首页入口；
5. Bubblewrap init/build + 签名 + 指纹回填 assetlinks；
6. 真机验收 §8 第 1–6 条；
7. **APK 交付入库**：签名包放进 `frontend/public/app/` + 写 `latest.json`（版本/大小/SHA-256）→ 提交推 main（**必须在"下令构建"之前**，见 §5.3）；
8. 等所有者下令「构建 vX.Y.Z」→ CI 出镜像 → 部署后 `/app` 页可下载；同时把**同一个包**传 GitHub Release（tag `app-v<version>`）+ README「安卓版」入口；
9. 收尾：`MOBILE-PWA.md` §1 决策 #1、§3 标注"已被 BS 推翻"；`DELIVERY.md` 发布步骤补一行「APK 先入库再下令构建」。

## 10. 明确不做

- iOS；应用商店上架；原生界面重写；
- 静默自动更新（需系统权限）；
- 推送与应用角标（TWA 不可行，改用现有邮件/企业微信）；
- Capacitor 壳（所有者选择接受 Web 分享/下载能力）。
