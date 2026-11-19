# App 发版后即刻可更新（DR，已实现并发布 v2.27.0）

> 状态：**已实现并发布 v2.27.0（2026-11-19 站点 39aaebb + App 仓库 98dabca；QA docs/QA-DR.md 第 1 轮 ✅ 8/0/0/2；App 侧 app-v2.22.0 随本批）**。
> 关联：[APP-AUTO-UPDATE-PAGE.md](APP-AUTO-UPDATE-PAGE.md)（CJ 同步/接口契约）、[APP-NATIVE.md](APP-NATIVE.md) §4.3（内置更新）。

## 1. 问题与现状（三层延迟，代码证据）

| 层 | 现状 | 最坏延迟 |
|---|---|---|
| 手机自动检查 | `UpdateManager.kt:50` `THROTTLE_MS = 24 * 60 * 60 * 1000`；启动/回前台 24h 内不重复查 | **24 小时（最大瓶颈）** |
| 服务器同步 Release | `scheduler.js` `app-release-sync`：`APP_RELEASE_SYNC_INTERVAL_MIN` 默认 60，首轮延迟 300s | 1 小时 |
| 后台入口 | **没有**「立即同步 App 版本」入口；`/api/admin/sync` 白名单不含 app-sync | 只能等每小时任务 |
| 手机手动检查 | 「我的 → 检查更新」不节流，立即查 | 手动可用 |

## 2. 目标

安卓构建（App 发版）完成后，**管理员点一下「立即同步」+ 手机打开 App（或点检查更新）→ 数十秒内看到更新提示**；即使不点，最迟约 15 分钟内自动可感知。

## 3. 方案（三处小改）

### 3.1 服务端：立即同步入口
- 新增 `POST /api/admin/app-sync`（管理员权限，`requireAdmin`）：触发一次 `syncAppRelease({ force: true })`（single-flight，防并发）；
  返回 `{ ok, version, apk, reason?, syncedAt }`；失败返回明确 reason（apk_download / latest_download / no_release）；
  日志 `app.sync_manual`（by/version/reason）；写审计（沿用 admin 操作日志风格）。
- 后台「运行与同步」页加一张 **App 版本卡**：当前 `latest.json` 版本 / versionCode / 上次同步时间 / 失败原因 +
  「立即同步」按钮（点击后 loading，成功后刷新卡片与 `/api/app/latest` 数据）。
- `APP_RELEASE_SYNC_INTERVAL_MIN` 默认 **60 → 15**；新增 settings 项 `app.syncIntervalMin`（页面可改，热加载），
  env 兜底保留。

### 3.2 App 端：缩短自动检查节流
- `UpdateManager.kt` `THROTTLE_MS`：24h → **1 小时**（30/60 分钟二选一按实现，推荐 1h）；
  「启动 + 回前台」每次触发（已有）；手动检查仍不节流、不写检查时间（保持 BY §4.5）。
- 不改下载/安装流程（SHA-256、Wi-Fi 默认、系统确认均不变）。

### 3.3 发版流程联动（技能）
- `steamdeals-app-build` §3 加一步：Release 建好后提示所有者「打开后台 → 运行与同步 → 点『立即同步 App 版本』」，
  并在汇报里给出「站点 `/api/app/latest` 当前版本」核对命令（本机只读 curl）。
- 站点 `steamdeals-build` §3.8（App 联动发版）同步提示。

## 4. 验收

1. `POST /api/admin/app-sync`：管理员 200 且服务器 `data/app/latest.json` 更新为目标版本；非管理员 401/403；
   并发两次只跑一次（single-flight）；失败返回明确 reason 并落日志；
2. 后台 App 版本卡显示版本/上次同步/失败原因；点「立即同步」后卡片与 `/api/app/latest` 一致更新；
3. `app.syncIntervalMin` 默认 15、页面可改、热加载生效（scheduler 重载）；
4. App：24h 内打开 App 也会检查（节流 ≤1h）；手动检查仍立即；`npm test`（分段）+ `frontend:build` + `scan` 全绿；
   App 构建通过 + 模拟器验证。
5. 端到端：App 发 app-vX.Y.Z → Release 三资产 → 后台点「立即同步」→ `/api/app/latest` = 新 versionCode →
   App（模拟器/真机）打开或点检查更新 → 出现更新提示（截图/录屏留档）。

## 5. 待确认

无（默认值 15 分钟 / 1 小时可按实现微调，不阻塞）。
