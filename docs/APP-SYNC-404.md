# app-release-sync 404（私有仓库 + 无 token）（CT，P1）

> 状态：**已确认待开发（2026-11-18，线上日志）**。
> 关联：[TODO.md](TODO.md) CT 条目、[APP-AUTO-UPDATE-PAGE.md](APP-AUTO-UPDATE-PAGE.md)（CJ 批：运行时同步）、
> [CJ 条目](TODO.md)。

## 1. 现象与根因

线上日志（2026-11-18 09:23）：

```
[09:23:36] scheduler.job_start job=app-release-sync args=app-sync
未同步：github_http_404
[09:23:38] scheduler.job_done job=app-release-sync code=0 elapsedMs=2429
```

**根因**：
1. `src/app-release.js` 调 `https://api.github.com/repos/yyliucha/steamdeals-app/releases/latest` **未带任何认证头**；
2. `steamdeals-app` 是**私有仓库** → 匿名访问返回 **404**（不是 403，GitHub 对私有资源返回 404）；
3. 结果：`data/app` 永远为空 → `/app/dl/...` 404 → `/app` 页下载走站点自托管失败（CJ 已加 apkPath 回落，但运行时同步形同虚设）。

## 2. 修复方案（三选一，建议 A）

| 方案 | 做法 | 评价 |
|---|---|---|
| **A（推荐）** | 给同步任务支持 `GITHUB_TOKEN`：请求加 `authorization: Bearer <token>`；容器 env 注入（只记变量名，不入库）；无 token 时跳过并记 `app.sync_no_token` | 私有仓库可继续私有；token 只读（`public_repo`/`contents:read` 即可） |
| B | 把 `steamdeals-app` 改成公开仓库 | 最简单，但仓库含构建产物/说明，公开需所有者确认 |
| C | 站点 CI 构建期拉取（GitHub Actions 有权限） | 与 CJ 的"构建期兜底"建议一致，可与 A 并存 |

## 3. 验收

1. 配置 token 后手动 `node src/cli.js app-sync` → `data/app/` 出现 APK + latest.json（日志 `app.release_synced`）；
2. 无 token 时日志明确 `app.sync_no_token`（不再伪装成 `github_http_404`），且后台任务卡显示失败原因；
3. `GET /api/app/latest` 返回 `apkPath=/app/dl/<ver>.apk` 且该 URL 200；
4. token 仅出现在容器环境变量，`npm run scan` 干净；
5. `npm test` 全绿（新增 `test/app-release-auth.test.js`：有 token 走认证头、无 token 跳过）。

## 4. 待确认

1. 选 A（token）还是 B（公开仓库）？A 需要所有者生成一个只读 token 并注入部署环境（变量名 `GITHUB_TOKEN`）。
2. token 权限最小化：`Contents: Read`（fine-grained）或 `public_repo`（classic）。
