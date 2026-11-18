---
name: steamdeals-app-build
description: SteamDeals App（F:\dsh\steamdeals-app，yyliucha/steamdeals-app）的发版技能：收到所有者「发 app-vX.Y.Z」指令后加载执行——版本号必须单调递增（versionCode = major*10000+minor*100+patch，覆盖安装不倒退）、构建 APK（gradlew assembleRelease，同 keystore 签名，密钥不入库）、生成 latest.json 作为 Release 资产（CJ 契约：versionCode 无法从 tag 推算，站点 app-release-sync 从资产读）、打 annotated tag 推 tag、建 GitHub Release（APK/sha256/latest.json 三资产）、验证站点 /api/app/latest 返回新版本、模拟器覆盖安装自测、按 §6 汇报；不擅自发版、不碰服务器；与 steamdeals-build 联动（双仓库条目站点构建时同步发 App）。
---

# App 发版（SteamDeals / steamdeals-app）

> **路径基准**：App 仓库 `F:\dsh\steamdeals-app`（origin = github.com/yyliucha/steamdeals-app，公开）；站点仓库 `F:\dsh\gameprice`。
> **技能维护**：本文件随站点仓库提交；改动后执行 `pwsh F:\dsh\gameprice-skills\sync.ps1` 同步镜像仓库
> （junction 与「不维护第二份副本」的完整说明见 `steamdeals-requirements` SKILL.md 头部）。
>
> **分工**：站点发版用 `steamdeals-build`；**本技能只负责 App 仓库的 tag / Release / 站点同步验证**。
> 提交身份一律 `yyliucha <jacksunyx@outlook.com>`（见 `F:\dsh\git-identity-map.md`）。

## 0. 触发与前置

- **触发词**：所有者说「**发 app-vX.Y.Z**」（或「发 App」= 用当前 main 的版本号自动发）。
  只有明确收到该指令才动手——日常开发只提交推 main，不建 Release。
- **前置**：App 仓库 main 已含本批全部 App 改动并推送；版本号已按 §1 递增（`app/build.gradle.kts`）。
- 与 `steamdeals-build` 联动：站点构建会话发现本批条目标注「**涉及 App 仓库**：是」时，
  会**同步调用本技能**发对应 App 版本（见站点 build 技能 §3.8）。

## 1. 版本号规则（必须单调递增）

- `app/build.gradle.kts`：`versionCode = major*10000 + minor*100 + patch`、`versionName = "X.Y.Z"`。
- **覆盖安装约束**：新 versionCode 必须 > 已发布 tag 对应 versionCode（旧 TWA 21800、app-v2.19.0 = 21900、
  app-v2.20.0 = 22000 …），永不倒退、永不重复。
- tag 命名 `app-vX.Y.Z`（与站点 `vX.Y.Z` 区分；只打 annotated tag）。
- 「发 App」自动推算：直接发当前 main 里的 versionCode/versionName（发版前核对它大于已发布 tag 的 versionCode）。

## 2. 联动规则（与 steamdeals-build / steamdeals-dev）

- **双仓库条目**：TODO 条目带「**涉及 App 仓库**：是」的（如 CX/DA/CZ/DC），站点构建时本技能被同步调用，
  两版一起汇报（站点 vX.Y.Z + app-vX.Y.Z）。
- **依赖顺序**：App 依赖站点新接口的（如 DA 的 `/api/games` 筛选参数）→ 先发站点版并部署，再发 App；
  App 不依赖站点的（如 DC 纯 App 端）→ 可独立发。
- **dev 侧**：双仓库条目完工时，dev 汇报必须注明「站点提交 <哈希> + App 提交 <哈希>；构建需双发」。

## 3. 发版流程（按序）

1. **环境**：`cd F:\dsh\steamdeals-app` → `git -c http.sslBackend=openssl pull --rebase origin main`；
   确认 JDK 17 + Android SDK（`F:\Android\sdk`）可用、keystore 路径与 App 仓库构建脚本一致（密钥不入库）。
2. **构建**：`.\gradlew.bat assembleRelease`（同 keystore 签名；产物 `app/build/outputs/apk/release/app-release.apk`）。
3. **产物**：计算 APK 的 SHA-256（`Get-FileHash -Algorithm SHA256`）。
4. **latest.json**（**必须作为 Release 资产**，CJ 契约：versionCode 无法从 tag 推算）：
   `{ version, versionCode, minVersionCode, notes[], size, sha256, releasedAt }`——`minVersionCode` 保持 21600 不变，
   notes 写清本批 App 改动。
5. **打 tag 推 tag**：`git tag -a app-vX.Y.Z -m "SteamDeals App vX.Y.Z：<摘要>"` → 推送。
6. **建 Release**：`gh release create app-vX.Y.Z <apk> <sha256 文件> <latest.json> --title "SteamDeals App X.Y.Z" --notes "<摘要>"`；
   三资产缺一不可（站点 `app-release-sync` 从 Release 资产读 versionCode 与下载链接）。
7. **站点同步验证**：站点仓库 `node src/cli.js app-sync --force`（或等每小时自动任务），
   然后本机起站点服务确认 `GET /api/app/latest` 返回新 versionCode。
8. **自测**：模拟器（steamdeals35）安装新 APK 覆盖安装成功、版本号显示正确。

## 4. 验证与验收

- tag 已推送且指向本次构建提交；Release 含 **APK / sha256 / latest.json 三资产**；
- latest.json 的 versionCode/version/minVersionCode 与 APK 一致；
- 站点 `/api/app/latest`（app-sync 后）返回新 versionCode；`/app/dl/<file>` 可下载；
- 模拟器覆盖安装 + 启动正常；旧版本下次检查会看到更新提示（minVersionCode 逻辑由 App 内置）。

## 5. 纪律

- 只收指令才发；不碰服务器/生产数据（部署由部署人员执行）；身份 yyliucha；Release 资产齐全才算发完。

## 6. 汇报格式

```
📦 App 版本：app-vX.Y.Z（versionCode NNNNN；站点联动版本 vX.Y.Z 如有）
🔖 tag：app-vX.Y.Z 已推送（<短哈希>）；Release 已建，三资产齐全
✅ 验证：模拟器覆盖安装 OK；站点 /api/app/latest = 新 versionCode（app-sync 后）
🖥 服务器：站点版本待部署（如本批依赖站点接口）
⚠️ 未纳入：<App 仓库未推送的提交 / 未发原因>
```
