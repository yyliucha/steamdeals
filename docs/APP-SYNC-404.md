# app-release-sync 404 修复：改用 releases 列表接口（CT，P1）

> 状态：**已实现并发布 v2.24.4（2026-11-18，9312054；QA docs/QA-CP-CT-CO2.md 第 1 轮 ✅）**。
> 关联：[TODO.md](TODO.md) CT 条目、[APP-AUTO-UPDATE-PAGE.md](APP-AUTO-UPDATE-PAGE.md)（CJ 批：运行时同步）。

## 1. 现象与根因（2026-11-18 实测）

线上日志（09:23）：

```
scheduler.job_start job=app-release-sync args=app-sync
未同步：github_http_404
```

**验证过程（2026-11-18 13:5x，仓库已改为公开）**：

| 请求 | 结果 |
|---|---|
| `GET /repos/yyliucha/steamdeals-app/releases`（匿名） | **200**，1 条：`app-v2.19.0`（draft=false、prerelease=false、assets=latest.json/apk/sha256） |
| `GET /repos/yyliucha/steamdeals-app/releases/latest`（匿名） | **404**（反复重试仍 404） |
| 站点 `/api/app/latest` | 200（`apkPath=/app/steamdeals-2.19.0.apk`，来自镜像兜底） |
| 站点 `/app/dl/steamdeals-2.19.0.apk` | **302** → `/app/steamdeals-2.19.0.apk` **200**（CJ 兜底生效） |

**根因（两层）**：
1. 原为私有仓库 → 匿名 404（**已由所有者改公开**，问题 1 消除）；
2. `src/app-release.js` 只调 `/releases/latest`，而 GitHub 对该 release 的 latest 端点返回 **404**（列表接口正常）→ **同步仍会失败**。

## 2. 修复方案（已确认）

| # | 内容 |
|---|---|
| 1 | `src/app-release.js` 改为 **`GET /releases?per_page=10`**，在返回里取**第一条 `draft=false && prerelease=false`** 的 release；`/releases/latest` 不再作为唯一来源（可作兜底，仍取不到就报错）。 |
| 2 | **不依赖 token**：公开仓库匿名可用；保留可选 `GITHUB_TOKEN`（若请求带 token 则加认证头，为将来私有化留口），未配置时匿名请求。 |
| 3 | 日志区分失败原因：`app.sync_http_404` / `app.sync_no_release` / `app.sync_no_assets`，不再只输出 `github_http_404`。 |
| 4 | 同步产物：`data/app/<apk>` + `data/app/latest.json`（含 version/versionCode/minVersionCode/apkPath/sha256/size/releasedAt）。 |

## 3. 验收

1. `node src/cli.js app-sync` → 日志 `app.release_synced tag=app-v2.19.0`，`data/app/` 出现 APK + latest.json；
2. `GET /api/app/latest` 返回的 `apkPath` 与 `data/app/latest.json` 一致；`/app/dl/<ver>.apk` 200/302 可达；
3. 模拟 404（改一个不存在的仓库名跑测试）→ 日志为 `app.sync_http_404`，不崩溃；
4. 无 token 时正常；配置 token 时请求带 `authorization` 头（单测断言）；
5. `npm test`（新增 `test/app-release.test.js`：列表取最新、过滤 draft/prerelease、无资产报错、token 头）/ `scan` 全绿。

## 4. 待确认

1. 仓库公开后是否还要保留 token 支持？（建议保留，代码量小、私有化时不用改）
2. `data/app` 与 `frontend/public/app` 谁优先？建议：运行时同步优先，镜像文件兜底（CJ 已实现 apkPath 回落）。
