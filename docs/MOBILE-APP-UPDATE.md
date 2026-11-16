# 安卓 App 内置更新：检测新版本 → 提示 → 下载 → 用户确认安装（待开发）

> 状态：**已确认待开发（2026-11-16，所有者确认 5 组细节）**。编号 **BY**。
> 关联：[MOBILE-APP-TWA.md](MOBILE-APP-TWA.md)（BS 批 TWA App / `/app` 下载页 / BS §3.4「不做静默安装」）、
> [MOBILE-REDESIGN.md](MOBILE-REDESIGN.md)（移动端重设计，互不依赖）、[TODO.md](TODO.md) 的 BY 条目。

## 1. 现状（2026-11-16 核对）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **网页内容**有更新提示：站点版本变化 → 顶部「已更新到 vX.Y.Z，点击刷新」，刷新清缓存拿新页面 | `frontend/src/composables/useVersionGuard.js`（MOBILE-PWA §2.1） |
| 2 | **APK 本体没有更新机制**：BS 规格明确「App 内检查更新只做提示 + 打开发布页，**不做静默安装**」；当前 `LauncherActivity` 是 Bubblewrap 默认模板，无任何更新代码 | [MOBILE-APP-TWA.md](MOBILE-APP-TWA.md) §3.4；[LauncherActivity.java](../android/app/src/main/java/cn/yyliucha/steamdeals/LauncherActivity.java) |
| 3 | 版本元数据不足：`latest.json` 只有 `version/apkPath/sha256/size/releasedAt`，**没有 versionCode**；`/api/app/latest` 原样返回这几个字段 | `frontend/public/app/latest.json`、`src/server.js` 的 `/api/app/latest` |
| 4 | 现状下用户只能手动到 `/app` 或 GitHub Release 重新下载安装 | `frontend/src/pages/AppDownloadPage.vue` |
| 5 | App 包名 `cn.yyliucha.steamdeals`、versionName 跟随 `/api/site`、versionCode = major×10000+minor×100+patch（当前 2.16.0/21600）、minSdk 21 | `android/twa-manifest.json`、`MOBILE-APP-TWA.md` §2 |

**网页为什么做不了**：TWA 里跑的是 Chrome，网页**读不到已安装 APK 的版本号**（TWA 不注入 JS 桥），**也没有安装 APK 的权限**。
所以"检测 → 下载 → 安装"必须由原生做；本批在 TWA 工程里加更新模块，**不换壳**（仍 Bubblewrap/TWA）。

**与 BS 决策的关系**：BS 否掉的是「**静默**自动更新」；本批是"提示 + 用户确认安装"，不违反该决策。

## 2. 已确认的决策（2026-11-16 所有者，5 组）

| # | 决策 |
|---|---|
| 1 | **加原生更新模块**（在 `android/` 工程内实现检查/下载/安装），仍 TWA，不换壳 |
| 2 | 检查时机：**启动时** + **回到前台时（每 24 小时最多一次）** + 「我的」页**手动入口** |
| 3 | 策略：**默认可选**（稍后 / 忽略此版本）；低于 `minVersionCode` 时**强制更新** |
| 4 | 下载：**站点 APK 优先**，失败回落 **GitHub Release**；**默认仅 Wi-Fi**，可手动允许用流量 |
| 5 | 元数据：`latest.json` / `/api/app/latest` 增加 **`versionCode`** + **`notes`（更新说明）** + **`minVersionCode`** |

## 3. 数据契约（BY-1）

`frontend/public/app/latest.json` 扩展（向后兼容，旧客户端忽略新字段）：

```json
{
  "version": "2.18.0",
  "versionCode": 21800,
  "minVersionCode": 21600,
  "apkPath": "/app/steamdeals-2.18.0.apk",
  "sha256": "…64 位小写…",
  "size": 1472278,
  "releasedAt": "2026-11-20",
  "notes": ["修复登录入口", "新增移动端底部 Tab"]
}
```

- `GET /api/app/latest` 原样透传上述字段（缺失时返回 `null`，保持现有 200 形状）；
- `versionCode` 规则沿用 `major*10000+minor*100+patch`（发版时与 `android/twa-manifest.json` 的 `appVersionCode` 一致）；
- `minVersionCode`：低于该值的旧版必须更新（默认 = 上一版，可手写提高）；
- `notes`：字符串数组（App 内对话框逐条显示）；旧格式字符串也兼容（按单条处理）。

## 4. Android 端设计（BY-2）

### 4.1 检查

- 触发：`LauncherActivity` 启动时；`onResume` 且距上次检查 ≥24h；「我的」页手动入口（见 4.5）；
- 请求：`GET https://sd.yyliucha.cn/api/app/latest`（HTTPS、超时 5s、不带缓存），失败静默（不阻塞进站）；
- 比较：`latest.versionCode > BuildConfig.VERSION_CODE` → 有更新；
  `latest.versionCode <= 当前版本` → 无更新；
  `minVersionCode > 当前版本` → **强制**（不可"稍后/忽略"）；
- "忽略此版本"存 `SharedPreferences`（`ignoredVersionCode`）；强制更新时忽略记录不生效。

### 4.2 提示

- 原生对话框（非 Web）：标题「发现新版本 vX.Y.Z」+ 大小（MB）+ 更新说明（notes 逐条）+ 按钮；
- 可选更新：`立即更新` / `稍后` / `忽略此版本`；
- 强制更新：只给 `立即更新`（返回键不可取消）。

### 4.3 下载

- 源顺序：`apkPath`（站点，绝对化到 `https://sd.yyliucha.cn`）→ 失败回落 GitHub Release 同一版本的 APK；
- **仅允许 https + 白名单主机**（`sd.yyliucha.cn`、`github.com`/`objects.githubusercontent.com`），其它 URL 拒绝；
- 网络策略：默认仅 Wi-Fi 下载；当前是移动网络时弹「仅 Wi-Fi 下载 / 使用流量下载」二选一；
- 下载器：`DownloadManager`（系统通知 + 应用内进度条，进度轮询 `query`）；
- 校验：下载完成后本地算 **SHA-256** 与 `latest.sha256` 比对，不一致 → 删除 + 提示「安装包校验失败，请重试或到下载页手动更新」。

### 4.4 安装

- 首选 `PackageInstaller` 会话（API 21+）：写入 APK 后 `commit`，系统弹安装确认；
- 兼容/兜底：`FileProvider` 生成 content URI → `ACTION_VIEW`（`application/vnd.android.package-archive`，`FLAG_GRANT_READ_URI_PERMISSION`）；
- Android 8.0+：先检查 `canRequestPackageInstalls()`，false 时跳
  `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` 引导用户允许本应用安装；
- **签名必须同一 keystore**（换签名只能卸载重装）；版本号必须单调递增，否则系统拒绝覆盖安装；
- 安装完成后 App 进程通常会被替换/退出，重新打开即新版。

### 4.5 手动入口

- 「我的」页新增「检查更新」项，链接使用自定义 scheme `steamdeals://check-update`
  （`AndroidManifest.xml` 注册 intent-filter；TWA 内点击会拉起本 App 的检查逻辑）；
- 浏览器/非 App 环境打开该链接无响应 → 前端 1.5s 后回落到 `/app` 下载页（兜底）；
- 手动检查不写"已检查时间"，不影响 24h 节流。

### 4.6 失败与回退

- 检查失败：静默（不打扰），下次启动/回前台再试；
- 下载/安装失败：对话框给「重试」+「打开发布页」（`/app`，系统浏览器）；
- 站点不可达：跳过本站，直接试 GitHub Release；两者都失败 → 提示手动更新。

## 5. 服务端 / 发版流程（BY-1）

- `/api/app/latest` 透传新字段（`versionCode/minVersionCode/notes`），补测试断言；
- 发版清单增加：
  1. `android/twa-manifest.json` 的 `appVersionName/appVersionCode` = 本次版本；
  2. 出包后写 `latest.json`：`version/versionCode/minVersionCode/apkPath/sha256/size/releasedAt/notes`；
  3. 保留最近 3 个 APK；`cache-control: no-cache`（已有）；
  4. 同一 APK 传 GitHub Release（tag `app-v<version>`）作为下载兜底；
- 说明：**2.16.0 及更早的 App 没有更新模块**，这些用户需要**手动装一次**新版；之后才能收到 App 内更新提示。

## 6. 验收

1. **元数据**：`latest.json` 含 `versionCode/minVersionCode/notes`；`/api/app/latest` 正确透传；字段缺失时返回 null 不报错；旧 `/app` 页不受影响。
2. **启动检查**：把 `latest.versionCode` 调高（或装旧包）→ 打开 App 出现原生「发现新版本」对话框，显示版本/大小/更新说明。
3. **策略**：点「稍后」本次不更新，下次启动再提示；点「忽略此版本」后**同版本不再提示**，出现更高版本会再提示；
   把 `minVersionCode` 调到高于当前版本 → 强制更新（无稍后/忽略，返回键不可取消）。
4. **下载**：默认仅 Wi-Fi；移动网络弹出选择；下载有进度；SHA-256 不匹配时删除并提示失败；下载失败可重试或打开 `/app`。
5. **安装**：下载完成后拉起系统安装确认；Android 8+ 首次引导"允许安装未知应用"；**同一签名**覆盖升级成功、数据保留；
   不同签名/版本号不递增时安装被拒（预期，弹提示）。
6. **手动入口**：「我的 → 检查更新」能触发检查（TWA 内）；浏览器里点同链接 1.5s 后回落 `/app`。
7. **兜底**：站点不可达时回落 GitHub Release；两者都失败提示手动更新，不卡死。
8. **构建**：`versionCode` 单调递增、签名指纹不变；APK 与 `latest.json` 的 sha256/大小一致。
9. **测试**：`npm test`（`/api/app/latest` 新字段断言）、`npm run frontend:build`（`/app` 页与手动入口链接）、`npm run scan`；Android 侧构建由 BS 流程执行。

## 7. 实施顺序与依赖

| 子项 | 内容 | 依赖 |
|---|---|---|
| **BY-1** | `latest.json` / `/api/app/latest` 新字段 + 发版清单 + 测试 | 无 |
| **BY-2** | Android 更新模块：检查/对话框/下载校验/安装/权限/失败回退 | BY-1（字段） |
| **BY-3** | 手动入口（scheme intent-filter + 「我的」页链接 + 回落） | BY-2 |
| **BY-4** | 文档同步（MOBILE-APP-TWA.md 更新章节、DELIVERY 发版步骤、README 已知限制解除） | BY-1~3 |

## 8. 本批不做

1. **不做静默安装**（系统不允许，保持"用户确认"）；
2. 不做 Play 商店内更新（不上架，BS 决策）；
3. 不做增量/差分更新（bsdiff 等）；
4. 不做推送通知提醒更新（App 打开时才检查）；
5. 不做 iOS（TWA 仅安卓）；
6. 不改包名/签名（`cn.yyliucha.steamdeals` + 现有 keystore）。

## 9. 待确认（有默认值，不阻塞）

1. `notes` 用字符串数组（推荐）还是单段字符串；
2. `minVersionCode` 默认取"上一版"还是"当前最新版"（影响强制范围，建议上一版）；
3. GitHub 兜底下载地址用 Release 资产直链还是 `releases/latest` 跳转（建议直链 + 版本号）；
4. App 内是否显示"当前版本 vX.Y.Z"（原生对话框或「我的」页；网页拿不到，需原生展示）。
