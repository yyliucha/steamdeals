# App 资产同步换源（FK，待开发，2026-11-24）

> 所有者决策（2026-11-24）：**方案 B 换源**——服务器直连 GitHub Release 资产会被中断（curl 56，1m30s 后失败），
> 改从**腾讯云 COS/对象存储**同步 App 资产；GitHub Release 保留为备用通道。

## 1. 现状（问题）

- `src/app-release.js` 的 `syncAppRelease` 只从 GitHub Release API/资产下载；
- 服务器 → `github.com` 首页可通（200），但 **release 资产下载被中断**（`curl (56)`，1.5 分钟失败）；
  直连下载超时 10s、代理 30s——即使调大也绕不过连接中断；
- `app-release-sync` 任务因此失败（apk_download）。

## 2. 方案（可配置源 + 双通道）

### 配置项（新增，后台「系统设置 → 网络与代理 / 数据源与采集」）
| key | env | 说明 |
|---|---|---|
| `network.appSyncSource` | `APP_RELEASE_SYNC_SOURCE` | enum：`github`（默认）/ `cos`——App 资产同步源 |
| `network.appSyncCosBase` | `APP_RELEASE_SYNC_COS_BASE` | string：COS 桶访问域名（如 `https://<bucket>.cos.<region>.myqcloud.com/steamdeals-app`） |

### 同步逻辑（`syncAppRelease`）
1. `source=cos`：`GET ${base}/latest.json` → 解析 version/notes → 下载 `${base}/steamdeals-<version>.apk` + `.sha256`
   → 写 `data/app/`（与 GitHub 路径同一落盘格式）；
2. `source=github`：保持现状（GitHub Release）；
3. **自动回退**：source=cos 失败且 `APP_RELEASE_SYNC_FALLBACK=1`（默认 1）→ 回退 GitHub 尝试一次，日志标注；
4. 失败原因区分：`cos_download` / `cos_404` / `apk_download` 等。

### App 构建（steamdeals-app-build 技能更新）
- Release 构建后：**双上传**——GitHub Release 三资产（保留）+ **COS 上传**（`coscli cp` 或 `coscmd`）：
  `latest.json`、`steamdeals-<v>.apk`、`.sha256` → 桶目录（与 base 对应）；
- COS 上传凭证由所有者在本机配置（coscli 配置文件），技能只写命令模板。

## 3. 需要所有者提供（部署时）

1. COS 桶：bucket 名 / region / 访问域名；
2. 上传方式：`coscli`（推荐）或 `coscmd`，以及密钥（只配在所有者本机，不入库）；
3. 后台填写 `network.appSyncCosBase` 后点「立即同步」验证。

## 4. 验收

1. 后台设 `appSyncSource=cos` + base 后，「立即同步」从 COS 拉取最新 App 资产成功（`data/app/latest.json` + APK）；
2. `source=github` 仍可用；cos 失败自动回退 GitHub（日志可见）；
3. `node src/cli.js app-sync` 双源可用；后台任务健康正常；
4. `npm test`（分段）+ `frontend:build` + `scan` 全绿；截图（设置项）。
