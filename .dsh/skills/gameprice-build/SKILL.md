# 构建与发版（SteamDeals / gameprice）

> **路径基准**：下文 `docs/…`、`src/…`、`test/…`、`package.json` 都相对**仓库根** `F:\dsh\gameprice`，
> 不是本 SKILL.md 所在目录。开工先 `git rev-parse --show-toplevel` 确认在仓库根。
>
> **技能文件位置**：`.dsh/skills/gameprice-build/SKILL.md`，**随仓库提交、推 GitHub**；
> 本机 DSH 扫描路径 `F:\dsh\.dsh\skills\gameprice-build` 是指向它的 junction（仅本机环境配置，不入库）。
> 别的机器 clone 后如需 DSH 发现该技能，按同样方式建 junction；**不要再维护第二份副本**。
>
> **分工**：`gameprice-dev` 实现并验证 → `gameprice-qa` 验收核对（TODO 改「质检通过」）→
> **`gameprice-build` 发布**（本技能）。构建命令由**所有者**发出；本技能负责把「质检通过」的条目打成镜像版本。

## 0. 触发与前置

- **触发词**：所有者说「**构建**」（或「构建 vX.Y.Z」）。**只有明确收到该指令才动手**——日常开发只提交推 main，
  打 tag = 触发 GitHub Actions 构建镜像（硬规则 5）。
- **前置**：该批次条目在 [docs/TODO.md](../../../docs/TODO.md) 里必须已是 `质检通过`（见 §1 门禁）。
- **工作区安全**：`git status --short` 先看一遍；**绝不 `git add -A`**——工作区常有其它会话的未提交改动，
  只 `git add` 本批自己的路径（同名文件混了他人的 hunk 时按 §2.4 拆分暂存）。

## 1. 版本号推算（每次构建都必须有版本号）

**规则（所有者 2026-11-10 确认）：没有版本号的构建不存在；只说「构建」时按下面三档自动推算，明确说「构建 vX.Y.Z」时用指定版本。**

| 档位 | 判定 | 推算（当前 vX.Y.Z） | 示例 |
|---|---|---|---|
| 补丁 | 本批只有 bug 修复 / 纯文档 / 无新功能 | `X.Y.(Z+1)` | 2.5.0 → 2.5.1 |
| 常规 | 含新功能条目 | `X.(Y+1).0` | 2.5.0 → 2.6.0 |
| 跳一小版本 | 改动特别大：**≥3 个功能条目**，或自上次 tag 起代码 diff **≥2000 行** | `X.(Y+2).0` | 2.5.0 → 2.7.0 |

推算步骤（构建开始时执行，汇报里写清依据）：

```powershell
cd F:\dsh\gameprice
git tag --list | Select-Object -Last 3          # 上一版 tag
node -p "require('./package.json').version"     # 当前版本（以它为准，不是 tag）
git diff --shortstat v<上一版>..HEAD            # 自上次发版的代码量
git log --oneline v<上一版>..HEAD               # 批次清单（按 TODO 编号归类）
```

- **范围判定**：上次 tag 之后、本次构建之前的 `质检通过` 条目 = 本批发布范围；按「修复 or 新功能 or 特别大」定档。
- **边界**：只允许跳**小版本**（+2），不自动跳大版本（`X.0.0` 必须所有者点名）；指定版本必须大于当前版本、
  且 `git tag` 里不存在（撞号 → 停止并提示）。
- **汇报必写**：`📦 版本：vX.Y.Z（推算依据：N 个新功能条目 / diff N 行 → 档位）`。

## 2. 构建门禁与并发安全（先查，再动手）

### 2.1 TODO 门禁（所有者 2026-11-10 确认）

构建前扫 [docs/TODO.md](../../../docs/TODO.md) 全部 `**状态：…**` 行：

- 上次 tag 之后的条目里存在 `质检打回` 或 `已实现待发版`（未质检）→ **拒绝构建**，列出这些编号与原因，
  等补齐质检后再构建；`待开发/依赖阻塞/待排查/待决策` 不是本批范围，不拦也不打包。
- 只有 `质检通过`（和更早批次未发版但已通过的条目）进版本；本批发布范围的编号清单写进汇报。

### 2.2 并发探测

```powershell
Test-Path .git/index.lock          # True = 有 git 操作在跑 → 停
git status --short                 # 其它会话的未提交改动，记录下来、不要提交它们
```

### 2.3 文档撞车（HANDOVER.md §10）

改 `docs/TODO.md` / `docs/REQUIREMENTS-INDEX.md` 前探测占用（2 分钟内 mtime + index.lock + git status）；
被占用就**跳过这两份文件的写入**，照常构建，状态回写留到收尾复盘（本批最后提交的会话用 `edit` 定点替换补齐）。

### 2.4 同名文件混入他人 hunk

发版要改的文件（README/CHANGELOG/TODO 等）若同时含他人未提交改动：把 `git diff <file>` 按 hunk 拆开，
只用 `git apply --cached <自己的 hunk 补丁>` 暂存自己的部分（见 §6），他人的 hunk 留在工作区**不提交**。

## 3. 发版流程（一次做完，按序）

### 3.1 文档先落地（与代码/版本号进同一个 commit）

- `CHANGELOG.md`：顶部加 `## [X.Y.Z] - YYYY-MM-DD`，按 Keep a Changelog 分「新增 / 修复 / 测试」，写清为什么；
- `README.md`：功能表状态标 ✅ 并写边界与限制、命令参考（新 CLI 命令/参数）、已知限制；
- `docs/PROJECT-OVERVIEW.md`：功能与代码落点表 + 验证记录，状态词改 `已发布 vX.Y.Z`；
- 本批规格文档状态改「已实现并发布 vX.Y.Z」；`docs/TODO.md` 条目标题同步改 `~~…~~ → 已发布 vX.Y.Z`、
  状态行写 `已发布 vX.Y.Z（<短哈希>；QA 报告 …）`；
- `docs/REQUIREMENTS-INDEX.md` 对应行同步；`docs/DELIVERY.md`「当前状态」加新版本条目
  （验证结果 + 「CI 待确认」+「服务器部署待执行」）。

### 3.2 版本号

`npm version X.Y.Z --no-git-tag-version`（只改 `package.json` + `package-lock.json`，不自动打 tag）。

### 3.3 验证（全绿才继续，失败就修）

```powershell
npm test                    # 主链全绿
npm run frontend:build      # 改过 frontend/ 必跑（保险起见每次都跑）
npm run scan                # 凭据自检
node test/api.test.js       # 动过 API/权限/标记必跑
```

### 3.4 提交推 main

`git add <本批具体路径>`（**不要 `git add -A`**；混入他人 hunk 的文件按 §2.4）→
`git commit -m "release: vX.Y.Z <一句话摘要>"` → `git push origin main`。

### 3.5 打 tag 推 tag（= 触发构建）

`git tag -a vX.Y.Z -m "SteamDeals vX.Y.Z：<摘要>"` → `git push origin vX.Y.Z`。

### 3.6 盯 CI

```powershell
gh auth switch --user yyliucha                      # 有 workflow 权限的账号
gh run list --limit 3                               # 找 headBranch=vX.Y.Z 的两条 run
gh run watch <run-id> --exit-status                 # 两个 tag run 都等完
gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
gh auth switch --user boxiang-sun_shortcut          # 切回默认账号
```

双绿标准：docker-hub（test / smoke / publish 全 success）、docker-tcr（test / publish 全 success）。

### 3.7 收尾

- `docs/DELIVERY.md` 该版本条目补 CI run id 与结论，单独 `docs(delivery): vX.Y.Z CI 双绿记录` 提交推 main；
- 汇报（§4）。服务器升级由**部署人员**按 [docs/DEPLOY.md](../../../docs/DEPLOY.md) 执行，开发侧不碰服务器。

## 4. 汇报格式（缺一段都算没汇报）

```
📦 版本：vX.Y.Z（package.json / package-lock.json 已改）
🎯 推算：本次发布范围 <TODO 编号列表>（N 个新功能条目 / 修复批 → 档位：补丁/常规/跳一小版本；指定版本则写「所有者指定」）
🔖 tag：vX.Y.Z 已推送，main 已同步（<release 短哈希> + CI 记录 <短哈希>）
✅ 验证：npm test 全绿（N 个文件）/ frontend:build / scan 干净 / api.test.js N 项
🚀 CI：docker-hub <run-id>（test/smoke/publish 全绿）；docker-tcr <run-id>（test/publish 全绿）
🖥 服务器：待部署人员按 docs/DELIVERY.md 升级到 X.Y.Z（开发侧不执行）
⚠️ 未发布/未纳入：<编号> —— 原因：<质检打回 / 未质检 / 不在本批>
```

## 5. 已知坑速查

- `git rev-parse v2.4.0` 对注释 tag 返回的是 **tag 对象**哈希（不是提交）；判断「tag 指向哪个提交」用
  `git log -1 vX.Y.Z` 或 `git show vX.Y.Z -s --format='%H'`。别看到两个哈希就以为打错了。
- tag 推送后**立刻**触发 CI；其它会话可能随后提交新代码——vX.Y.Z 镜像只含打 tag 那个提交，后续提交归下个版本，
  汇报里写清「镜像不含 tag 之后提交的 X」。
- README/TODO 这类文件常有其它会话的未提交改动：先 `git diff <file>` 看 hunk，再决定整文件提交还是拆分。
- QA 报告 `docs/QA-*.md` 默认**不进 git**，但 TODO/DELIVERY 会引用它们——引用即可，不必把报告提交（所有者另有指示除外）。
- 首次构建含 `READ_MODEL`/回填类迁移时，在 DELIVERY 条目里注明「首次启动会慢一次/需人工关注」的部署提示。
- `npm version` 不带 `--no-git-tag-version` 会自己打 tag 并触发构建——永远加 `--no-git-tag-version`，tag 由 §3.5 显式打。
