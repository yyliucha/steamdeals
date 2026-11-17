# 安卓版 App 发版后 /app 页自动更新（站点自托管 + GitHub 兜底）（待开发）

> 状态：**已确认待开发（2026-11-17）**。
> 关联：[TODO.md](TODO.md) CJ 条目、[APP-NATIVE.md](APP-NATIVE.md) §5（/app 页与分发口径）、
> [MOBILE-APP-UPDATE.md](MOBILE-APP-UPDATE.md)（App 内置更新契约：versionName/versionCode/minVersionCode/notes）、
> [APP-API.md](APP-API.md)（`/api/app/latest` 契约）。

## 1. 已确认的决策

| # | 决策（所有者 2026-11-17 确认） |
|---|---|
| 1 | **下载来源**：站点自托管（服务器自动把 APK 拉到本地，`/app` 下载走本站，国内快）+ **GitHub Release 作为兜底链接**。 |
| 2 | **同步频率**：每小时 1 次（GitHub API 每轮 1 次调用，额度无压力；App 发版后最多 1 小时页面生效）。 |
| 3 | **App 发布物契约**：App 构建时把 `latest.json`（version / versionCode / minVersionCode / notes / sha256 / size / releasedAt）作为 **Release 资产**上传，与 APK、`.sha256` 同批；站点同步直接取用，不靠人工改文件。 |
| 4 | 站点仓库**不再要求手工入库**新 APK 与 latest.json（存量 2.19.0 保留作镜像兜底）；发版清单相应简化。 |
| 5 | **现有 Release 由 CJ 开发会话一次性补齐**：给 `app-v2.19.0` 补传 `latest.json` 资产（`gh release upload --clobber`），
并把握手约定写进发版清单（DELIVERY / APP-NATIVE §5）：**以后每次 `app-v` 发版必须带 latest.json**——不靠口头传话，CG 会话照清单执行。 |
| 6 | 已停发的旧 TWA 包 `frontend/public/app/steamdeals-2.16.0.apk` **随本批删除**（只留 2.19.0 作镜像兜底，避免混淆）。 |

## 2. 现状（代码证据，2026-11-17 核对）

- `/api/app/latest` 读**镜像内文件**：`src/server.js:1801-1803`，`APP_LATEST_FILE` 默认 `frontend/dist/app/latest.json`
  （构建时由 `frontend/public/app/latest.json` 拷入）→ **不重新构建镜像就不会更新**。
- 当前手工维护链条：构建 APK → 拷进 `frontend/public/app/` → 手改 `latest.json` → 提交 → 等站点重新构建部署。
  已发生的事实：2.19.0 的 `latest.json` 在 v2.21.0 打 tag **之后**（`9f68a1e`）才提交，所以部署 v2.21.0 后
  `/app` 仍显示 2.18.0，要等 v2.22.0 镜像才带上 2.19.0——证明该模式不可持续。
- App 仓库 Release 已就绪：`app-v2.19.0`（APK 1,905,024 字节 + `.sha256`，sha256 `c42454b7…`）。
- `/app` 页的「GitHub Release」备用链接仍指向旧站点仓库 `yyliucha/steamdeals`（`AppDownloadPage.vue:35`），应为 `yyliucha/steamdeals-app`。

## 3. 服务端

### 3.1 新增 `src/app-release.js`

- `syncAppRelease({ repo, dataDir, keep = 3, timeoutMs })`：
  1. `GET https://api.github.com/repos/<repo>/releases/latest`（5s 超时；可配 GitHub token 提额度，可不配）；
  2. 校验 tag 形如 `app-v<X.Y.Z>`；取资产 `latest.json` / `steamdeals-<X.Y.Z>.apk` / `.sha256`；
  3. 与本地 `data/app/latest.json` 比对 version：相同 → 跳过（幂等）；
  4. 下载资产到 `data/app/`：APK 文件名 `steamdeals-<version>.apk`，`.sha256` 同名，latest.json 为 `data/app/latest.json`；
     **先写 `.tmp` 再 rename**（原子写）；校验下载文件的 sha256 与 latest.json 一致，不一致丢弃并记失败；
  5. 只保留最近 `keep` 个 APK（按版本排序删除更旧的）；
  6. 返回 `{ ok, version, downloaded | skipped, error }`；失败**绝不删除**已有文件。
- 日志：`app.release_synced` / `app.release_skipped` / `app.release_failed`（带 reason、HTTP 状态）。

### 3.2 `/api/app/latest` 读取优先级

- 优先 `data/app/latest.json`（运行时同步文件）；缺失或解析失败 → 回落 `APP_LATEST_FILE`（镜像内文件）。
- 响应体字段与 [APP-API.md](APP-API.md) 一致（version/versionCode/minVersionCode/notes/size/sha256/apkPath/releasedAt）；
  `apkPath` 由服务端按同步后的本地文件生成（`/app/dl/steamdeals-<version>.apk`），保证与自托管文件一致。

### 3.3 下载路由（站点自托管）

- 新增 `GET /app/dl/<file>`：只允许 `^steamdeals-[\d.]+\.apk$` 白名单，只读 `data/app/`，**不列目录**；
- 响应头：`content-type: application/vnd.android.package-archive`、`content-length`、`cache-control: no-store`；
- 文件不存在 404；超过 50MB 拒绝；支持 HEAD。

### 3.4 CLI（调试用）

- `node src/cli.js app-sync [--repo <owner/repo>] [--force]`：跑一轮同步并打印结果（`--force` 忽略版本相同跳过）。

## 4. 调度与自动化

- **新任务 `app-release-sync`** 进 `jobsFromEnv`（`src/scheduler.js`）：
  - `APP_RELEASE_SYNC_ENABLED`（默认 1）、`APP_RELEASE_SYNC_INTERVAL_MIN`（默认 60）、
    `APP_RELEASE_SYNC_REPO`（默认 `yyliucha/steamdeals-app`）、`APP_RELEASE_SYNC_KEEP`（默认 3）；
  - **不进 `STEAM_HEAVY`**（不占 Steam 配额，属轻任务）；
  - `test/scheduler.test.js` 断言默认参数与开关。
- **合并评估（为什么不并进已有任务）**：`images` 是封面缓存、`version` 是站点镜像版本探测，均不涉及下载 APK
  与写本地清单；本任务每轮 1 次 API + 最多 3 个文件下载（~2MB），`并进任何 Steam 任务都会平白增加耦合`，
  且需独立开关便于失败隔离 → **独立新建**。
- **单轮时长**：秒级（1 次 API + 2–3 个小文件）；失败只影响本任务，不阻塞其它任务。
- **续跑/幂等**：按 version 比对，同版本跳过；原子写；失败保留旧文件；GitHub 不可达（大陆网络偶发）只记日志，
  不影响 `/app` 页面（继续用上次成功或镜像兜底）。

## 5. 前端 / 后台

- `frontend/src/pages/AppDownloadPage.vue`：备用链接仓库改 `yyliucha/steamdeals-app`；
  其余不动（版本/大小/时间/SHA 均来自 `/api/app/latest`，已就绪）。
- 后台无新增页面；同步状态可看运行日志（`app.release_synced`）。

## 6. 设置与配置

- 部署期参数走 env（上表 4 个），不进 `src/settings.js`（属部署环境参数，页面无需改）；
  可选 GitHub token 用 `GITHUB_TOKEN`（仅变量名，不入库，`npm run scan` 校验）。

## 7. 安全

- 下载路由文件名白名单 + 目录固定，防路径穿越；不列目录；大小上限 50MB。
- 同步只访问 `api.github.com` 与 `objects.githubusercontent.com`（Release 资产域名），不新增其它外呼。
- 下载后校验 sha256（取自同 Release 的 latest.json），防止被篡改/半包。
- 不含凭据；token 只读环境变量。

## 8. 去重与幂等

- 版本号即稳定键：同版本不重复下载；`keep=3` 按版本排序收敛，重复同步不产生重复文件。
- 同步任务与镜像内兜底文件并存：运行时文件优先、镜像文件兜底，二者不互相覆盖。

## 9. 验收

1. `node src/cli.js app-sync --force` → `data/app/` 出现 `steamdeals-2.19.0.apk` + `latest.json` + `.sha256`；
   `GET /api/app/latest` 返回 2.19.0/21900 且 `apkPath` 指向 `/app/dl/steamdeals-2.19.0.apk`。
2. 同版本再跑 → `skipped`（不重复下载）；断网跑 → `app.release_failed` 且旧数据仍在、接口不 5xx。
3. 下载路由：`GET /app/dl/steamdeals-2.19.0.apk` 200 且 Content-Type 正确；非白名单文件名 404；
   文件不存在 404；HEAD 可用。
4. `/app` 页显示新版本且可下载；「GitHub Release」备用链接指向 `steamdeals-app`。
5. 保留策略：造 4 个版本文件 → 同步后只剩最近 3 个。
6. `scheduler.test.js` 断言默认 60 分钟/开关/repo；`npm test` / `frontend:build` / `scan` 全绿；不自行打 tag。

## 10. 实施顺序

0. **开工首步（一次性补齐，属本批交付）**：给现有 `app-v2.19.0` Release 补传 `latest.json`
   （`gh release upload app-v2.19.0 frontend\public\app\latest.json --repo yyliucha/steamdeals-app --clobber`），
   让 CJ 的同步任务第一次运行就有真实数据可拉；同一提交里把「每次 `app-v` 发版必须带 latest.json」写进
   DELIVERY 发版清单与 APP-NATIVE §5，并删除旧 TWA 包 `frontend/public/app/steamdeals-2.16.0.apk`。
1. `src/app-release.js` + CLI `app-sync`（先能手动同步成功）；
2. `/api/app/latest` 优先级 + `/app/dl/` 下载路由；
3. 定时任务进 `jobsFromEnv` + 测试；
4. 前端备用链接 + 文档收尾；
5. 部署后首次验证：服务器上 `app-sync` 一轮 → `/app` 显示 2.19.0（不依赖重新构建镜像）。

## 11. 待确认问题

无（原两条已升为决策：§1 #5「现有 Release 一次性补齐 latest.json + 发版清单固化约定」、
§1 #6「旧 TWA 2.16.0 APK 随本批删除」）。实施时按 §1 与 §10 第 0 步执行即可。
