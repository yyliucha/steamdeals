# App 代码仓库拆分：android/ 迁出到独立仓库（BY 完成后执行）（待开发）

> 状态：**方案已确认，待 BY 完成后执行（2026-11-16 所有者确认）**。编号 **BZ**。
> **2026-11-16 后续（CA）**：本方案**作废**——CA 直接新建独立原生 App 仓库（见 [APP-NATIVE.md](APP-NATIVE.md) §2），
> 不再迁移 `android/` 到独立仓库。
> 关联：[MOBILE-APP-TWA.md](MOBILE-APP-TWA.md)（BS 批 TWA 工程与 APK 交付）、
> [MOBILE-APP-UPDATE.md](MOBILE-APP-UPDATE.md)（BY 内置更新，先在本仓库完成）、
> [DELIVERY.md](DELIVERY.md)（发版流程）、[TODO.md](TODO.md) 的 BZ 条目。

## 1. 现状（2026-11-16）

| 耦合点 | 现状 | 证据 |
|---|---|---|
| 代码 | `android/` Bubblewrap 工程**入库**（可复现构建） | [android/README.md](../android/README.md) |
| APK 交付 | 签名 APK **入库** `frontend/public/app/` + `latest.json`，随站点镜像发布 | `MOBILE-APP-TWA.md` §5.3、[DELIVERY.md:53-54](DELIVERY.md#L53-L54) |
| 站点接口 | `/api/app/latest` 读 `latest.json`；`/app` 页据此下载 | `src/server.js`、`AppDownloadPage.vue` |
| 信任链 | `/.well-known/assetlinks.json` 在站点仓库（包名 + keystore 指纹） | `frontend/public/.well-known/assetlinks.json` |
| 发版 | app tag `app-v<version>`（GitHub Release 附 APK）+ 站点 tag `vX.Y.Z`（APK 先进镜像） | `DELIVERY.md` §3 |

## 2. 已确认的决策（2026-11-16 所有者）

| # | 决策 |
|---|---|
| 1 | **拆代码**：`android/` 迁到独立 **公开** 新仓库（建议名 `steamdeals-app`），只含 Android 工程 + 构建说明 + Release 产物 |
| 2 | **规格/TODO/发版清单仍留站点仓库**（TODO 仍是唯一排期来源），不迁排期 |
| 3 | **APK 交付**：站点 CI 构建时从 app 仓库 **Release 拉取** APK + 生成 `latest.json`；国内用户仍从站点 `/app` 下载 |
| 4 | **执行时机：BY（App 内置更新）完成后**——避免同时迁移原生更新模块 |
| 5 | **架构不变**：继续 TWA（Bubblewrap），不换 WebView 壳；BY 之后若原生需求继续增长，再另批评估 |
| 6 | 包名 `cn.yyliucha.steamdeals`、签名 keystore、`assetlinks.json` 指纹、app tag 规则 `app-v<version>` **全部不变** |

## 3. 迁移步骤（执行时）

1. **新仓库**：创建公开仓库（建议 `steamdeals-app`），迁入 `android/`（保留历史可用 `git filter-repo`/subtree；不保留则快照 + 说明）；
2. **新仓库 CI**：`assembleRelease` → 签名（密钥走 GitHub Secrets，**不入库**）→ 打 `app-v<version>` tag → Release 上传 APK + `.sha256`；
3. **站点仓库**：
   - 删除 `android/`（保留一行 README 指向新仓库）；`frontend/public/app/` 不再提交 APK，调整 `.gitignore`；
   - 新增 `scripts/fetch-app-release.mjs`：按 `APP_RELEASE_TAG`（显式固定，可复现）拉取 Release APK → 校验 sha256/大小 → 写 `frontend/public/app/latest.json`；
   - 两个 docker workflow 在 `vite build` 前执行该脚本（GitHub Actions 内可直接下载 Release 资产）；
   - `/api/app/latest` 与 `/app` 页**无需改动**（仍读 `frontend/dist/app/latest.json`）；
   - `DELIVERY.md` 发版步骤改为两段：先 app 仓库发 `app-vX` → 再站点构建（CI 自动拉取）；
4. **文档**：更新 `MOBILE-APP-TWA.md` / `DELIVERY.md` / `README` 的构建与发版说明；规格与 TODO 仍留站点仓库。

## 4. 验收

1. 新仓库可独立构建出**同签名** APK（CI 绿），Release 含 APK + `.sha256`；
2. 站点 CI 拉取后：`/app` 可下载、`/api/app/latest` 字段正确（含 BY 的 `versionCode/minVersionCode/notes`）；
3. 站点仓库不再包含 `android/` 与 APK 二进制（历史提交除外）；
4. 全流程回归：app tag → 站点构建 → 部署 → `/app` 下载 → 旧版 App 收到 App 内更新提示（BY 功能）；
5. 包名/签名/`assetlinks` 不变；桌面与移动网页不受影响；
6. 站点侧 `npm test` / `frontend:build` / `scan` 全绿。

## 5. 本批不做

1. 不换包名、不换签名（换签名只能卸载重装）；
2. 不迁移规格/TODO/发版清单（仍留站点仓库）；
3. 不引入对象存储/CDN（APK 走 GitHub Release → 站点镜像）；
4. 不在本批评估 WebView 壳（另批）。

## 6. 待确认（有默认值，不阻塞）

1. 新仓库名（默认 `steamdeals-app`）与可见性（默认公开，便于 CI 匿名拉取）；
2. 是否保留 `android/` 的 git 历史（默认保留，filter-repo）；
3. 站点 CI 用显式 `APP_RELEASE_TAG`（默认，可复现）还是"最新 app-v tag"；
4. app 仓库的签名密钥管理（默认 GitHub Secrets；本机签名后上传也可）。
