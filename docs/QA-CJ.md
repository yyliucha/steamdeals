# QA：CJ App 发版后 /app 页自动更新（第 1 轮）

> 基线 6d93306（认领）→ HEAD 61e8ec6；判据 [APP-AUTO-UPDATE-PAGE.md](APP-AUTO-UPDATE-PAGE.md) §9。
> 结论：✅ 放行 —— 通过 6 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（用户视角，一条一行）

| # | 功能 | 入口 | 状态 | 证据 |
|---|---|---|---|---|
| 1 | 每小时自动同步 GitHub Release（latest.json+APK+sha256，同版本跳过、失败不删旧文件） | 定时任务 app-release-sync | ✅ | src/app-release.js；test/app-release-sync.test.js（下载/跳过/断网/prune） |
| 2 | /api/app/latest 优先读 data/app（apkPath=/app/dl/<ver>.apk），镜像文件兜底 | GET /api/app/latest | ✅ | server.js readLatestMeta；serve.test.js BS-1 更新 |
| 3 | /app/dl/<file> 白名单下载（仅 steamdeals-x.y.z.apk、≤50MB、no-store、HEAD 可用、非白名单 404） | GET/HEAD /app/dl/… | ✅ | server.js 路由；app-release-sync.test.js 静态断言 |
| 4 | GitHub 备用链接改 steamdeals-app | /app 下载页 | ✅ | AppDownloadPage.vue；静态断言 |
| 5 | 只保留最近 3 个 APK | 同步任务 | ✅ | pruneApks 单测（4 个版本留 3 个） |
| 6 | 收尾三件：app-v2.19.0 补传 latest.json 资产 ✓、旧 TWA 2.16.0/2.18.0 包删除 ✓、发版清单固化（DELIVERY/APP-NATIVE 写入待 v2.22.0 流程结束后执行） | — | ✅/待补 | gh release 资产已核实（3 资产） |
| 7 | npm test 93 文件 0 fail / frontend:build ✓ / scan 干净 | — | ✅ | 实跑输出 |

## 需人工确认
- 部署侧验证：服务器 `app-sync` 跑一轮后 /app 显示 2.19.0、下载可用（开发侧不执行服务器命令）。
- 「每次 app-v 发版必须带 latest.json」的 DELIVERY 清单/APP-NATIVE §5 固化：v2.22.0 发版流程进行中，按边界未动这两份发版文件，留收尾复盘补写。

## 复检记录
- 第 1 轮（2026-11-17）：实跑 npm test（93 文件 0 fail，NPM_EXIT=0）/ frontend:build / scan → ✅ 放行。
