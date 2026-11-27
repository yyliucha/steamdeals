---
name: steamdeals-release
description: SteamDeals 站点发布技能：由 steamdeals-build 在 CI 双绿后交接（读 docs/releases/vX.Y.Z.json 清单），把指定 tag 发布到生产服务器——自动注入镜像 tag（不改项目文件）、按清单决定发 app 还是 scheduler、健康与版本校验、失败自动回滚、回写清单与 DELIVERY；不构建、不改版本号、不碰 nginx/数据库。适用于"发布 vX.Y.Z""发到服务器""部署上线""回滚线上版本"这类请求。
---

# 生产发布（SteamDeals / gameprice）

> **链路（2026-11-27 起）**：
> dev 实现 → qa 质检通过 → **steamdeals-build 构建**（推算版本号、打 tag、盯 CI 双绿、写清单）
> → **steamdeals-release 发布（本技能）** → 验证 → 回写清单/DELIVERY → 按 §4 汇报。
>
> 本技能只做「把已构建好的镜像换成线上」。**不产出代码、不改版本号、不打 tag。**

## 0. 触发与输入

- **触发**：
  1. `steamdeals-build` 写完结 `docs/releases/vX.Y.Z.json` 后交接（自动进入本技能）；
  2. 所有者直接说「发布 vX.Y.Z」「发到服务器」「部署上线」；
  3. 所有者说「回滚 / 回滚到 vX.Y.Z」→ 走 §5。
- **输入清单**：`docs/releases/vX.Y.Z.json`（由构建技能写，**发布范围完全以它为准**）：

```json
{
  "version": "2.31.0",
  "tag": "v2.31.0",
  "targets": ["app"],
  "image": "ccr.ccs.tencentyun.com/tcb-100003189690-pljp/steamdeals",
  "registryTag": "2.31.0",
  "ci": { "docker_hub": "success", "docker_tcr": "success" },
  "scope": ["CL", "CM"],
  "notes": "一句话说明本版内容",
  "builtAt": "2026-11-27T08:00:00Z"
}
```

- `targets` 取值：`["app"]`（只发站点）、`["scheduler"]`（只发定时服务）、`["app","scheduler"]`（两者）。
  **本技能不自行推断 targets**——清单没有 `scheduler` 就绝不动调度器。
- **清单缺失时**（只有「发布 vX.Y.Z」指令）：现场补建清单——`git tag -l vX.Y.Z` 确认 tag、`gh run list` 确认 CI，
  `targets` 默认 `["app"]`，并在汇报里注明「清单缺失，已按默认 app 补建」；不得擅自加 scheduler。
- 版本与镜像 tag 的映射：`v2.31.0` → 镜像 tag `2.31.0`（**TCR 不带 v**），由服务器侧脚本自动处理。

## 1. 门禁（任一不过就停，不发布）

| # | 门禁 | 命令 |
|---|---|---|
| 1 | tag 存在且指向 main 上的提交 | `git -C F:\dsh\gameprice tag -l vX.Y.Z`；`git show vX.Y.Z -s --format=%H` 在 `git log origin/main` 里 |
| 2 | CI 双绿 | 清单 `ci.docker_hub` / `ci.docker_tcr` 均为 `success`；可疑时 `gh run list --limit 5` 复核 |
| 3 | 线上健康 | `ssh deploy@<host> status`：app 为 `healthy` / `running` |
| 4 | 版本未发布过 | 线上版本 ≠ 目标版本；相同版本只允许「所有者明确要求重发」 |
| 5 | 磁盘余量 | 服务器侧脚本内检查（≥5G） |
| 6 | 未被叫停 | 所有者说「先别发 / 等我说」时不发 |

**门禁失败 → 停手，把失败项原文贴给所有者，不做任何发布动作。**

## 2. 发布（顺序固定，一次做完）

```powershell
# ① 记基线（只读）
ssh -i $env:USERPROFILE\.ssh\id_ed25519_steamdeals -o IdentitiesOnly=yes deploy@sd.yyliucha.cn status

# ② 发 app（清单 targets 含 app 时）
ssh ... deploy@sd.yyliucha.cn "deploy vX.Y.Z"

# ③ 发 scheduler（清单 targets 含 scheduler 时，在 app 之后）
ssh ... deploy@sd.yyliucha.cn "deploy-scheduler vX.Y.Z"
```

服务器侧脚本自动完成：

1. 备份 compose / scheduler compose / nginx `steamdeals.conf` / 当前镜像信息 → `/var/backups/steamdeals/pre-<tag>-<时间>/`；
2. 记录回滚点（当前镜像 tag 或 digest）→ `/var/lib/steamdeals/last-good`；
3. 写 `/var/lib/steamdeals/override-*.yaml` **注入新镜像 tag**（**不改项目里的 compose 文件**，这是"自动改版本号发布"的实现方式）；
4. `docker compose pull <svc>` → `up -d --no-deps <svc>`（不动依赖、不动 db）；
5. 轮询健康（最长 180 秒）→ 校验容器内 `package.json` 版本 → 校验 `https://sd.yyliucha.cn/api/site` 版本；
6. 失败**自动回滚**到 last-good 并退出非 0；回滚也失败则明确报「需人工介入」。

> 也可直接跑 `pwsh -File <本技能>\scripts\release.ps1 -Version vX.Y.Z`
> （`-DryRun` 只做门禁与计划、不发布；`-Rollback` 回滚；`-Targets app,scheduler` 覆盖清单）。

### 2.5 App 安装包上传（2026-11-27 起；**不重建镜像**）

站点 `/app/dl/<file>` 只读容器内 `/app/data/app`（宿主挂载目录），**上传即可下载**——不需要重建站点镜像。

- **前置（一次性，服务器 root）**：`bash scripts/server/install-put-app.sh '<专用公钥>'`
  ——生成 `put-app` / `put-latest` 命令，并追加 `steamdeals-put-app` 专用 key；
  **不碰 deploy 现有通道**（deploy 的 ForceCommand 白名单只读命令，不能传文件）。
- **客户端**：`bash scripts/upload-app.sh <apk> [latest.json]`
  （专用 key `~/.ssh/id_ed25519_steamdeals_putapp`，可用 `STEAMDEALS_PUTAPP_KEY` 覆盖）。
- **验证**：`curl -sI https://sd.yyliucha.cn/app/dl/<file>` 200；`curl -s https://sd.yyliucha.cn/api/app/latest` 版本正确。
- **边界**：本通道只传 APK 与 `latest.json`（站点 `/app/data/app`），**不发容器、不动镜像**；
  站点代码变更仍走 §2 的镜像发布。

## 3. 发布后验证（缺一不算完）

| 项 | 通过标准 |
|---|---|
| 线上版本 | `status` 里「容器内版本」= X.Y.Z；`/api/site` 的 `version` = X.Y.Z |
| 健康 | app `healthy`；scheduler（如发）`healthy` |
| 自检 | `ssh ... check` 输出到 `=== 完成 ===`，`api/site ok` / `api/search ok` |
| 公网冒烟 | 首页 200、`/login` 200、`/api/games/search` 返回 `total` |
| 错误日志 | `ssh ... "logs 300"` 里 5 分钟窗口无新增 `ERROR`/`error` 堆栈 |
| 公网只读 e2e | `node test/e2e/runner.mjs --online --expect-version=X.Y.Z`（失败不阻塞但必须写进汇报） |

## 4. 回写与汇报

1. 清单回写 `release` 字段（`status` / `releasedAt` / `appImage` / `schedulerImage` / `siteVersion`）；
2. `docs/DELIVERY.md` 加一条发布记录：版本、tag、时间、验证输出、回滚点、CI run；
3. 对话里按下面格式汇报：

```
🚀 发布：vX.Y.Z → 生产（app / app+scheduler）
🖥 线上：版本 X.Y.Z，healthy；回滚点 <上一个镜像 tag>
✅ 验证：/api/site 版本一致 / 首页 / 登录 / 搜索 / 自检脚本 / e2e（如跑）
📝 清单：docs/releases/vX.Y.Z.json 已回写 success；DELIVERY 已记录
⚠️ 异常：<无 / 具体现象 + 已回滚>
```

## 5. 回滚

- 「回滚」→ `ssh ... deploy@<host> rollback`（回 last-good，即上一次发布前的镜像）；
- 「回滚到 vX.Y.Z」→ `ssh ... deploy@<host> rollback vX.Y.Z`；
- 回滚后**同样跑 §3 验证**；在 DELIVERY 与清单里记 `status=rolled-back`；
- 回滚不动数据（发布只换镜像），若涉及数据问题先停手、单独排查。

## 6. 禁止（硬红线）

- 不构建、不打 tag、不改 `package.json` / CHANGELOG 版本号；
- **不发清单以外的容器**（清单没有 scheduler 就不动 scheduler）；
- 不碰 nginx 配置、数据库内容、本机以外的其它容器；
- CI 未双绿、tag 未推送时不发布；
- 不把服务器密码/私钥写进技能、仓库或对话（私钥只在本机 `~/.ssh`）；
- 发布失败且自动回滚失败时，不反复重试，先上报。

## 7. 通道与环境

| 项 | 值 |
|---|---|
| 主机 | `sd.yyliucha.cn`（默认，可用环境变量 `STEAMDEALS_HOST` 覆盖） |
| 账号 | `deploy`（受限：只能 `status` / `check` / `logs` / `version` / `deploy` / `deploy-scheduler` / `rollback`） |
| 私钥 | `%USERPROFILE%\.ssh\id_ed25519_steamdeals`（可用 `STEAMDEALS_SSH_KEY` 覆盖；**不写入仓库**） |
| 站点 | `https://sd.yyliucha.cn`（可用 `STEAMDEALS_SITE` 覆盖） |
| 服务器侧脚本 | `/opt/steamdeals/deploy.sh`（root 所有，deploy 用户不可写）；镜像 tag 由 `/var/lib/steamdeals/override-*.yaml` 注入 |
| 发布记录 | `/var/log/steamdeals-deploy/releases.log`；配置备份 `/var/backups/steamdeals/`（750 root） |

> 换服务器/换账号：只改 `STEAMDEALS_HOST` / `STEAMDEALS_SSH_KEY` / `STEAMDEALS_SITE`，脚本与技能不用改。

## 8. 已知坑

- **TCR 镜像 tag 不带 `v`**：`v2.31.0` → 拉 `2.31.0`；服务器脚本已自动去 `v`，不要手工拼。
- **数据库是外部库**（compose 里无 `db` 服务、app 容器无 `pg_dump`）：发布**不做库备份**；发布只换镜像、不改数据，迁移是幂等建表。涉及数据迁移的版本要在清单 `notes` 里写明并单独确认。
- **发版后 502**：nginx 已改 `resolver` + 变量 `proxy_pass`，容器 IP 变化会自动跟随；若仍 502，先 `status` 看 nginx 容器，不要重启整个 compose。
- **同版本重发**：`deploy` 默认跳过相同版本；确需重发用 `--force`（会 `--force-recreate`）。
- **scheduler 单独发**：只发 scheduler 不影响 app；但 app 与 scheduler 共用同一镜像 tag，两者版本必须一致。
- **清单入库**：`docs/releases/*.json` 与 DELIVERY 一起提交，作为发布审计；不要把它当临时文件删掉。
