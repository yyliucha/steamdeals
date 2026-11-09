---
name: gameprice-dev
description: F:\dsh\gameprice（SteamDeals 跨平台游戏比价）的开发规范：排期与状态唯一来源是 docs/TODO.md（开工先认领编号、完工把条目状态改成"已实现待发版"），完整流程见 docs/HANDOVER.md；职责只到"代码改动 + 测试用例"，不碰服务器、不碰生产数据、不擅自发版；任何改动必须真跑 npm test / frontend:build / scan 并贴输出，且同步更新 docs/PROJECT-OVERVIEW.md，最后等"构建 vX.Y.Z"人工指令；提交推 main 后直接调用 gameprice-qa 质检（不必等所有者发话，需核对它的「功能清单」表），打回项补齐才算交付；每次结束必须汇报"已做哪些 TODO 编号 / 未做哪些及原因"；TODO 被其他会话占用时按 §1.1 立即停手并上报所有者，不自行等待/覆盖。动 gameprice 代码前必读。
---

# gameprice 开发规范（职责范围：只做开发）

> **路径基准**：下文 `docs/…`、`src/…`、`frontend/…`、`test/…` 都相对**仓库根** `F:\dsh\gameprice`，
> 不是本 SKILL.md 所在目录。开工先 `cd F:\dsh\gameprice` 并确认 `git rev-parse --show-toplevel`。
>
> **技能文件位置**：`.dsh/skills/gameprice-dev/SKILL.md`，**自 2026-11-09 起随仓库提交、推 GitHub**；
> 本机 DSH 扫描路径 `F:\dsh\.dsh\skills\gameprice-dev` 是指向它的 junction（仅本机环境配置，不入库）。
> 别的机器 clone 后如需 DSH 发现该技能，按同样方式建 junction；**不要再维护第二份副本**。
>
> **分工**：聊需求、定方案、写规格用 `gameprice-requirements`；本技能只负责把规格变成代码 + 测试；
> 验收核对用 `gameprice-qa`（提交推 main 后**直接调用**、不用问所有者；它会输出「功能清单」表；打回项补齐才算交付）。
> 拿到的是交接单（`docs/<TOPIC>.md` + TODO 条目）时，先按它的「范围 / 落点 / 验收」核对，再动手。

项目：包名 `steamdeals`（当前版本以 `package.json` 为准）。Node ≥22.5（ESM）+ PostgreSQL 15 + Vue 3/Vite/Element Plus + Docker Compose。

## 0. 范围边界（先看这条，越界就是错）

**只做：代码 + 测试用例。**

| 做 | 不做 |
|---|---|
| `src/**`、`frontend/**`、`test/**`、`scripts/**` 的代码与测试 | SSH / 部署 / 拉镜像 / 重启容器 / 改服务器配置 |
| `docs/**`、`README.md`、`CHANGELOG.md` 的同步更新 | 连生产库、改生产数据、执行 `docker exec` |
| `package.json` 版本号（**仅**在收到构建指令后） | 自行 `git tag`、push tag、触发 GitHub Actions |
| 提交信息、变更说明 | 保存服务器凭据 / 真实 API key / 连接串（`npm run scan` 会拦） |

依据：[CONTRIBUTING.md](../../../CONTRIBUTING.md) 硬规则 4（服务器操作不在开发侧执行）、硬规则 5（构建与发版必须等人工指令）。

**工作节奏（用户明确要求）**：读待办 → 认领条目 → 改代码 + 补测试 → 跑验证 → 更新待办状态 → 汇报 → **停手等「构建」指令**。没听到 `构建`（或 `构建 vX.Y.Z`）就绝不打 tag、不跑发版流程。

**排期只来自待办清单（2026-11-06 所有者要求）**：做什么、先做哪个、是否做完，全部以
[docs/TODO.md](../../../docs/TODO.md) 为准；完整流程见 [docs/HANDOVER.md](../../../docs/HANDOVER.md)。
**不要接受对话里"顺手做一下"的口头需求**——要么它已经在 TODO 里，要么先退回需求会话建条目。


## 1. 开工四步

```powershell
cd F:\dsh\gameprice
git status --short; git log --oneline -5; node -p "require('./package.json').version"
```

1. 读 [docs/DELIVERY.md](../../../docs/DELIVERY.md)：开发环境、规则、发版流程、历次踩坑（第 6 节）。
2. 读 [docs/PROJECT-OVERVIEW.md](../../../docs/PROJECT-OVERVIEW.md)：架构、功能与代码落点；**改完必须回写它**。
3. 读 [docs/TODO.md](../../../docs/TODO.md) 与 [docs/UI-FIXES.md](../../../docs/UI-FIXES.md)：确认这个需求是不是已有结论/已知缺陷。
4. **认领条目**：从 TODO 里挑 `状态：待开发 / 开发中` 的编号，**开工前先说一句"本次做 <编号列表>"**；
   `待决策`、`待排查`（未出结论）、`已过时`、`依赖阻塞` 的条目不要碰。做完一条就把该条目的状态改成 `已实现待发版`。
   **遇到 `依赖阻塞`**：说明前置条目还没完成，不要绕过它硬做——在汇报里写明"被 X 阻塞"。

### 1.1 TODO 被占用时（2026-11-09 所有者新规：直接干活，收尾复盘）

`docs/TODO.md` / `docs/REQUIREMENTS-INDEX.md` 可能被别的会话同时改。**被占用就跳过 TODO/INDEX 的写入，照常干活**，不要停下等。

1. **写前探测**：`git status --short docs/TODO.md docs/REQUIREMENTS-INDEX.md` + 看 `LastWriteTime`
   （2 分钟内被改过 = 可能有人在写，自己刚写过的除外）+ `Test-Path .git/index.lock`（True = 有 git 操作）；
2. **命中就跳过这两份文件的写入**：不改状态、不加哈希、不加条目、不补 INDEX、不 `git add` 这两份文件；
   不回滚、不 `git stash`、不覆盖；
3. **照常干活**：改代码、补测试、跑验证、提交推 main（提交只 `git add` 自己的文件，**绝不 `git add -A`**）、
   质检照常调用；把「待回写的状态」记进提交信息与汇报，不要只留在对话里；
4. **收尾复盘**：本批最后提交的会话负责——先 `git pull --rebase` / `git diff`，**重读两份文件全文**吸收别人的新增，
   用 `edit` 定点替换补上本批状态（**禁止整文件 `write`**），跑 `npm run todo:progress` 同步 README；
   发现别人的内容被冲掉 → 停手、保留现场再上报，不自行补回。

完整规则（含撞车处理）见 [docs/HANDOVER.md](../../../docs/HANDOVER.md) §10。

## 2. 代码地图

| 关注点 | 文件 |
|---|---|
| CLI 入口与全部子命令 | `src/cli.js` |
| 常驻调度（`jobsFromEnv` 目前 19 个任务） | `src/scheduler.js` |
| HTTP 服务、静态页、封禁页注入 | `src/server.js`、`src/serve.js`、`src/*-routes.js` |
| 采集适配器（统一返回 `RawOffer[]`） | `src/adapters/{steam,sonkwo,gog,humble,itad,steam-meta,steam-catalog,sonkwo-discover,store-browse}.js` |
| 入库：指纹判重、upsert、快照、日聚合 | `src/ingest.js` |
| **全部 SQL 与迁移** | `src/store/pg.js` |
| 连接池、查询日志、时区 | `src/store/index.js` |
| 出网、代理分流、重试 | `src/http.js`、`src/proxy.js` |
| 结构化日志与脱敏 | `src/log.js` |
| 业务设置 schema（约 50 项，落库热加载） | `src/settings.js` |
| 名称匹配 / 多区比价 / 静态曲线页 | `src/match.js`、`src/compare.js`、`src/report.js` |
| 关注与提醒 | `src/alerts.js`、`src/notify.js` |
| 前端入口与组件注册 | `frontend/src/main.js`（控制台组件走 `admin-ui.js` 懒加载） |
| 前端路由 / 页面 / 样式 token | `frontend/src/router/index.js`、`pages/`、`styles/main.css` |
| 测试与真实夹具 | `test/*.test.js`、`test/fixtures/real-*` |
| 爬取勘查脚本 | `scripts/inspect.js`、`mine-bundle.js`、`find-api.js`、`extract.js` |

## 3. 编码硬约束

1. **ESM + 无构建**：`"type":"module"`；服务端不允许引入 TS/打包步骤。运行时依赖只有 `pg`/`undici`/`@electric-sql/pglite`，**不要加重型依赖**（CONTRIBUTING 明确拒绝）。
2. **金额一律整数分**（`*_cents`），禁止浮点；不同币种**不折算**，`region` + `currency` 是显式维度。
3. **日期用 `YYYY-MM-DD` 字符串**语义（查询里 `::text`），别让 `Date` 对象参与 SQL 比较（见 ARCHITECTURE §4.3）。
4. **渠道约束是结构约束**：`platforms.kind` 只允许 `official` / `authorized_reseller` / `c2c`；面向主榜与史低的查询**两条路径都要过滤**（视图 `v_lowest_official` 和 `daily_prices` 聚合），C2C 永不进主榜。改这条等于改产品边界，要先问。
5. **日志**：新事件用 `域.动作`，域仅限 `http` / `db` / `adapter.<平台>` / `ingest` / `sync` / `scheduler` / `diagnose` / `process`；失败路径必须带 URL、状态码、响应片段；敏感值交给 `src/log.js` 脱敏，不手写。
6. **采集限速 ≥1 秒/请求**，禁止并发轰炸；解析失败**返回空数组并记事件**，不要抛出中断整轮采集。
7. **新平台四步**：先 `node scripts/inspect.js <url>` 勘查 → 写 `src/adapters/x.js`（导出 `descriptor` + `fetchXxx`）→ 在 `src/store/pg.js` 的 `migrate()` 注册平台 → 用**真实页面夹具**写测试；同步更新 `docs/DATA-SOURCES.md`。
8. **PostgreSQL 15 语法**，不要用 16+ 的 `any_value` / `json_table`。
9. **新增数据类 CLI 命令必须并进调度器**：`src/scheduler.js` 的 `jobsFromEnv` 加定时任务（参数/间隔/首轮延迟都可用环境变量调），并在 `test/scheduler.test.js` 断言默认参数与开关（硬规则 3，否则视为功能没做完）。
10. **新增业务设置走 `src/settings.js` 的 `def()`**（页面可改、热加载），只有部署期参数才留在 env。

## 4. 前端约定

- **Element Plus 按需注册，漏一个就静默失效**：新用组件要在 `frontend/src/main.js` 同时加三处——`import`、`import 'element-plus/es/components/<x>/style/css'`、`app.use()` 的数组；控制台专用组件加在 `frontend/src/admin-ui.js`。`test/frontend-registration.test.js` 会拦住漏注册。
- 主题用语义化 CSS 变量（`html.dark` + `styles/main.css` token），不要写死颜色；亮暗色跟随 `composables/useTheme.js`。
- 时间展示统一走 `frontend/src/utils/siteTime.js`（站点时区），别用本地时区直接 `toLocaleString`。
- 响应式三档断点 900 / 760 / 420；手机与桌面是 `v-if` 双结构，触摸目标 ≥44px。
- 改完前端必须 `npm run frontend:build`（`frontend/dist/` 不入库）。
- `web/*.html` 是**无构建产物时的旧回退页**，不跟随新接口；只有需求明确要求时才改，改完跑 `node scripts/check-html-syntax.mjs web/index.html web/console.html web/setup.html`。

## 5. 测试规范

- 统一 `node:test` + `node:assert/strict`，一个模块一个 `test/<模块>.test.js`，可单独 `node test/compare.test.js` 直接跑。
- **主链** = `package.json` 的 `test` 脚本（一串 `node test/*.test.js` 用 `&&` 串联，首个失败即中断）。新增主链测试**必须**加进那个脚本。
- **链外**（按需单跑）：`test/api.test.js`（起真实 HTTP 服务 + pglite）、`test/email-auth.test.js`、`test/cli-dispatch.test.js`。动到 API/权限/标记就必跑 `node test/api.test.js`。
- 本地不需要真 PG：pglite 已验证 PG 语义；DDL 在 pglite 上 10–30 秒属正常，别当卡死。
- 解析类断言一律打真实夹具（`test/fixtures/real-*`），**不写假 HTML**——假 HTML 测不出站点改版。
- 测试注释写清"这条断言守的是什么约束"，现有测试都是这个风格。

## 6. 文档收尾（是交付的一部分，不是可选）

- **必改 `docs/TODO.md`**：本批条目的 `**状态：…**` 改成 `已实现待发版`（打回后改回 `开发中`），并补提交哈希；
  状态词只能用 `待开发 / 开发中 / 已实现待发版 / 待质检 / 质检通过 / 质检打回 / 已发布 vX.Y.Z / 待排查 / 待决策 / 已过时`。
- **README 进度摘要**：改完 TODO 状态后运行 `npm run todo:progress`（CI `docs-progress` 会校验）；规则见 [docs/TODO-PROGRESS.md](../../../docs/TODO-PROGRESS.md)。
- **解锁下游**：扫一遍 TODO，把 `依赖：` 指向本条的条目从 `依赖阻塞` 改成 `待开发`，并在汇报里给 `🔓 解锁` 行。
- **必改 `docs/REQUIREMENTS-INDEX.md`**：该编号那一行的状态跟着改（新增批次时加行）。
- **必改** `docs/PROJECT-OVERVIEW.md`：功能与代码落点表、模块职责、验证记录；不允许"代码新、文档旧"。
- 新增 `docs/*.md` 时，相对链接必须指向真实文件（`test/docs.test.js` 会校验 README / CONTRIBUTING / CHANGELOG / docs 的链接，断链即红）。
- `CHANGELOG.md` 条目跟版本号一起写；**没收到构建指令就不动版本号**，也不要提前写"已发布"。
- 中文文案用全角标点；描述"为什么"优先于"怎么做"。

## 7. 验证命令（没跑过不许说"做完了"）

```powershell
cd F:\dsh\gameprice
node test/<最相关的>.test.js    # 先跑单文件，秒级定位
npm test                        # 主链全绿才算完成
npm run frontend:build          # 动过 frontend/ 必跑
npm run scan                    # 提交前凭据自检
node --check src/xxx.js         # 新增/大改文件先过语法
```

配合 `verify-before-done` 技能：回复里给 **命令 → 关键输出行 → 结论**。本地无 Docker、无 Steam 出口，采集类命令网络失败是预期，不算 bug——但要在汇报里说明"未做真实抓取验证"。

## 8. 构建与发版：等「构建」指令

硬规则 5：`git tag` + push 会立刻触发 `docker-hub` / `docker-tcr` 构建并推镜像，
**只有项目所有者明确说「构建」（或「构建 vX.Y.Z」）才能执行**。

**日常开发本身就包含提交（推 `main` 不触发构建）**：验证全绿后不要留 WIP 等发版，
立即 `git add <具体路径>`（**不要 `git add -A`**——工作区常有其它会话的改动；技能文件已随仓库提交，
改技能就单独 `git add .dsh/skills/<name>/SKILL.md`）→ `git commit -m "<type>(<scope>): <摘要>"`
（feat/fix/refactor/test/docs/chore，见 CONTRIBUTING 提交规范）→ `git push origin main`。
然后**立刻直接调用 `gameprice-qa`**（**不等所有者发话、不问"要不要质检"**）：把 TODO 编号 + 规格路径 +
基线/HEAD 哈希交给质检（同会话加载 skill 即可）；质检会产出「功能清单」表（用户视角、一条功能一行），
你按那张表核对"是不是真的都交付了"；
❌ 打回项必须补齐（修复照常提交推 main）并复检通过，拿到 ✅/⚠️ 结论后，
才把「待发版」状态写进 `docs/DELIVERY.md` 末尾「当前状态」，停手等指令，**不要提前改版本号**。

**听到「构建」指令后，按这个顺序一次做完**（对应 `docs/DELIVERY.md` §3）：

1. **文档先落地，和代码进同一个 commit**（这是「构建」的一部分，不是可选项）：
   - `CHANGELOG.md` 顶部加 `## [X.Y.Z] - YYYY-MM-DD`，按 Keep a Changelog 分「新增 / 修复 / 测试」，写清为什么；
   - `README.md` 功能表（状态标 ✅ 并写边界与限制）、命令参考、已知限制；
   - `docs/PROJECT-OVERVIEW.md` 的功能与代码落点表 + 验证记录；
   - 本次规格文档状态改「已实现并发布 vX.Y.Z」，`docs/TODO.md` 条目标题同步改已发布；
   - `docs/DELIVERY.md`「当前状态」补版本、tag、验证结果和「服务器部署待执行」。
2. **版本号**：`npm version <X.Y.Z> --no-git-tag-version`（只改 `package.json` + `package-lock.json`，不自动打 tag）。
   规则：`X.0.0` 大版本 / `X.Y.0` 新功能 / `X.Y.Z` 修 bug；每次发版恰好一个 tag，tag 名固定 `vX.Y.Z`。
3. **验证（全绿才继续）**：`npm test`、`npm run frontend:build`、`npm run scan`；动过 API/权限/标记再单独跑
   `node test/api.test.js`。失败就修，不要带着红字打 tag。
4. **提交推 main**：`git add <具体路径>`（**不要 `git add -A`**——工作区常有其它会话的改动；
   技能已随仓库提交，改技能单独 add）→ `git commit -m "release: vX.Y.Z <一句话摘要>"` → `git push origin main`。
5. **打 tag 推 tag（= 触发构建）**：`git tag -a vX.Y.Z -m "SteamDeals X.Y.Z：<摘要>"` → `git push origin vX.Y.Z`。
6. **盯 CI**：`gh auth switch --user yyliucha`（有 workflow 权限的账号）→ `gh run list --limit 2` →
   `gh run view <id> --json jobs` 确认 publish 与 `Verify manifests` 都是 success →
   `gh auth switch --user boxiang-sun_shortcut` 切回默认账号。
7. **汇报**：版本号、commit、tag、两个 workflow 的结果；并提醒服务器升级由**部署人员**按 `docs/DEPLOY.md` 执行
   （开发侧不碰服务器，仓库不保存服务器凭据）。

## 9. 已知坑速查

- Steam `appdetails`：多 appid **只接受 `filters=price_overview`**，带 `recommendations` 会 400；热度只能逐 appid 请求。配额 200 次/5 分钟，价格/目录/回填/热度共用。
- 日志出现 `http.rate_limit_pause` 是在按 30 分钟→1h→2h→…→6h 冷却重试，不是卡死。
- 容器里没有 `curl`；bash 双引号里的 `!` 会历史展开（脚本外层用单引号）。
- 封禁页跳转只能靠 `src/server.js` 的 `serveBanPage` 注入内联脚本 `history.replaceState`；`main.js` 里 `router.replace` 已实测无效（ES module 提升）。
- Element Plus 组件漏注册 = 页面静默不渲染，不报错。
- `??` 遇空字符串不回退（申诉邮箱因水合成 `''` 断过四级回退链）——需要回退时用 `||`。
- `out/`、`logs/`、`data/*-pgdata/`、`frontend/dist/` 都在 `.gitignore`，别往提交里塞。
- 生产库 19.6 万条目、有国区报价 10.6 万；本地库是 pglite，**不要用本地数据量推断线上行为**。



## 10. 交付汇报格式（缺一段都算没汇报）

**每次结束必须给"已做 / 未做 / 状态更新"三行**（所有者靠它判断清单进度）：

```
✅ 已做：<编号> <一句话> —— 验证：<命令> → <关键输出>
⏳ 未做：<编号> —— 原因：<等决策 / 等日志 / 依赖 XX / 本轮没排到>
📄 状态更新：docs/TODO.md 里把 <编号> 改成 <新状态>
🔓 解锁：<依赖本条的编号，已从「依赖阻塞」改为「待开发」；没有则写"无">
```

**开发完成、还没收到构建指令**：

```
✅ 改动：<文件清单> + 一句话说清做了什么
✅ 验证：<命令> → <关键输出> → 通过 / 未通过（附原因）
🧪 质检：gameprice-qa 第 N 轮 → ✅ 放行（通过 X / 缺失 0 / 需人工确认 W；报告 docs/QA-*.md 未提交）
📋 功能清单：见质检汇报的「功能清单」表（本批全部功能，一条一行）
🔖 提交：<短哈希> 已提交并推 main（推 main 不触发构建）
📄 文档：docs/PROJECT-OVERVIEW.md 已同步（改了哪些表/段落）
⏸ 待命：未打 tag、未触发构建，等"构建 vX.Y.Z"指令
```

**发版完成（按 §8 跑完整套）**：

```
📦 版本：vX.Y.Z（package.json / package-lock.json 已改）
🔖 tag：vX.Y.Z 已推送，main 已同步
✅ 验证：npm test 全绿（N 个文件）/ frontend:build / scan 干净
🚀 CI：docker-hub <run-id> <结论>；docker-tcr <run-id> <结论>
🖥 服务器：待部署人员按 docs/DEPLOY.md 升级到 X.Y.Z（开发侧不执行）
```

任何没跑过的验证都要明说"未验证，仅目检"——这是本项目最忌讳的失败模式（历史上出现过三次"代码看着对、数据其实错"）。
