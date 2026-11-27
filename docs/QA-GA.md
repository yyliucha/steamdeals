# QA：GA 游戏管理拆分 + 同步与回填页重设计 + 定时任务精简 26→19（第 1 轮）

> 基线 `2ec721b`（线上 v2.32.0）→ HEAD `4993f15`；判据 [docs/SYNC-PAGE-REDESIGN.md](SYNC-PAGE-REDESIGN.md) §7「验收（8 条，分两批）」；
> 开发描述来源：夜班工人会话交付说明（GA-1 / GA-2 两个子批、两个提交）。
> 结论：**⚠️ 有条件放行** —— 通过 7 / 缺失 0 / 偏差 1（验收 4，两处表现差异已说明）/ 需人工确认 3。

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | GA-1 | 后台左侧「内容运营」出现三项一级菜单：游戏目录 / 同步与回填 / 对齐审核 | 控制台侧栏 | ✅ | `frontend/src/pages/Console.vue:133`（🎮/🔄/🧩） |
| 2 | GA-1 | 三项点击各自直达独立页面，游戏管理不再有内部 tab | 控制台 → 三项菜单 | ✅ | `Console.vue:124`（nativeSections）、`AdminModules.vue:4/17/18` |
| 3 | GA-1 | 同步与回填页顶部 4 张概览卡：运行中 / 需要关注 / 429 补跑队列 / 今日待补 | 同步与回填 → 概览条 | ✅ | `components/sync/SyncKpiBar.vue:14-42`、`useSyncAdmin.js:271` |
| 4 | GA-1 | 「需要关注」点一下滚到最近失败任务组并展开 | 概览卡「需要关注」 | ✅ | `SyncAdmin.vue:39-57`、`TaskGroupTable.vue:74` |
| 5 | GA-1 | 「运行中」卡显示当前任务与已跑时长；回填类任务显示已补进度（done/limit/%/速度） | 概览卡「运行中」 | ✅ | `useSyncAdmin.js:271-296`、`SyncKpiBar.vue:18-19` |
| 6 | GA-1 | 任务组表：12 组组行显示 名称 / 子步骤数 / 最近运行 / 健康 / 立即运行 | 同步与回填 → 任务与调度 | ✅ | `TaskGroupTable.vue:143-167`（组行） |
| 7 | GA-1 | 点组行展开/收起子步骤表；「全部收起」一键收起 | 组行 / 表头按钮 | ✅ | `TaskGroupTable.vue:43-48,135,167-215` |
| 8 | GA-1 | 组级「立即运行」→ 确认弹窗 → 按钮置「已提交」+ toast（约 15 秒生效） | 组行右侧按钮 | ✅ | `useSyncAdmin.js:365-397`、`TaskGroupTable.vue:156-158` |
| 9 | GA-1 | 子步骤级「立即运行」同上；运行中的子步骤给「停止」（能力不随旧块删除而丢） | 子步骤表 → 操作列 | ✅ | `useSyncAdmin.js:379-397,522`、`TaskGroupTable.vue:186-190` |
| 10 | GA-1 | 任务告警（缺 Key / 被 `*_ENABLED=0` 关掉）收进任务表头部提示条 | 任务与调度 表头 | ✅ | `TaskGroupTable.vue:134-137` |
| 11 | GA-1 | 末尾「手动任务（不进调度器）」组：catalog / logs / report / steam-claim，可展开、可立即运行、不可运行时置灰并给原因 | 任务表最后一组 | ✅ | `TaskGroupTable.vue:218-250`、`useSyncAdmin.js:420-437` |
| 12 | GA-1 | 折叠「数据质量」收起时标题行显示摘要（分级未回填 · 价格超 7 天 · 429 队列） | 数据质量折叠标题 | ✅ | `SyncFold.vue:25`、`useSyncAdmin.js:303-308` |
| 13 | GA-1 | 数据质量 → 内容分级统计 5 卡（成人/色情/成熟/已回填/未回填）+ 最近回填时间（只读，无列表入口） | 数据质量展开 | ✅ | `SyncQualityPanel.vue:16-26` |
| 14 | GA-1 | 数据质量 → 数据时效 4 卡（超 1/3/7 天）+「补跑价格/状态/中文名/图片」 | 数据质量展开 | ✅ | `SyncQualityPanel.vue:30-58` |
| 15 | GA-1 | 数据质量 → 429 补跑队列 3 卡 +「立即补 429」（队列空时置灰） | 数据质量展开 | ✅ | `SyncQualityPanel.vue:62-76` |
| 16 | GA-1 | 折叠「工具」摘要（初始化全量同步 · App 版本 x.y.z）；展开见初始化全量同步（二次确认，保留 20 万上限文案）+ App 版本 4 卡 + 立即同步 | 工具折叠 | ✅ | `SyncToolsPanel.vue`、`useSyncAdmin.js:460-494` |
| 17 | GA-1 | 移动端 ≤980px：概览 2 列、任务组行两行（名称一行/状态一行）、子步骤表横向滚动；≤768 控制台 ☰ 抽屉不变 | 手机/窄屏 | ✅ | `components/sync/sync.css:90-105`、`Console.vue`（navDrawer） |
| 18 | GA-1 | 页面 8 秒轮询（页面不可见时跳过，切回前台补一次） | 同步与回填页自动 | ✅ | `SyncAdmin.vue:76-85` |
| 19 | GA-2 | 定时任务 26 → **19**（合并 4 处 + 转手动 3 个），界面仍 12 组 + 手动组 4 个 | 调度器 / 任务表 | ✅ | `src/scheduler.js:114-290`、`test/scheduler-slim.test.js` 验收 5 |
| 20 | GA-2 | `rename` 合并进 `backfill`：回填顺带写中文名（候选并入「中文名待补」，英文名进 name_en） | 定时 backfill / `node src/cli.js backfill` | ✅ | `src/cli/ops.js:482,647`、`src/store/pg.js:3077`、`src/backfill.js:115` |
| 21 | GA-2 | `search-tokens-rebuild` 合并进 `readmodel`：对账收尾顺带增量重建 token（`--tokens 0` 可关） | 定时 readmodel / CLI | ✅ | `src/cli/ops.js:913-941` |
| 22 | GA-2 | `images-backfill` 合并进 `images`：每轮 pull 前先补一批缺图（`--backfill-limit 0` 可关） | 定时 images / CLI | ✅ | `src/cli/ops.js:1114-1134` |
| 23 | GA-2 | `explicit-backfill` 合并进 `rating-backfill`：候选并入 strict 色情分级分支（`--no-explicit` 可回退旧口径） | 定时 rating-backfill / CLI | ✅ | `src/steam-status.js:300-330`、`src/cli/ops.js:816-846` |
| 24 | GA-2 | `catalog` / `logs` / `report` 移出调度器，只留「立即运行」（CLI 命令保留） | 手动任务组 / CLI | ✅ | `src/scheduler.js:66-112` |
| 25 | GA-2 | `prune` 保留定时但 **10080（周）→ 1440（天）** | 调度器 | ✅ | `src/scheduler.js:236-243` |
| 26 | GA-2 | 降频 4 处：`proxy-probe` 30 / `app-release-sync` 60 / `align-snapshot` 120 / `sonkwo` 180（env 仍可覆盖） | 调度器 | ✅ | `src/scheduler.js:181,192,251,273` |
| 27 | GA-2 | 手动任务「立即运行」接口 + 状态接口下发手动清单（前端不写死） | `POST /api/admin/sync/manual`、`sync/status.manualJobs` | ✅ | `src/routes/admin-sync.js:172-193,277` |
| 28 | GA-2 | 被合并/转手动任务的 CLI 命令与参数**不删**（仍可手动跑） | CLI | ✅ | 见「验收 8 证据」的 CLI 实跑 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 内容运营组三项一级菜单，点击直达；不再有内部 tab | 读 Console/AdminModules + 真栈截图 + 静态锁 | `Console.vue:133`（三项 + 图标）、`:124`；`AdminModules.vue:4/17/18`；截图 `docs/design/ga-sync-implemented-default.png`（侧栏三项） | ✅ |
| 2 | 同步与回填页自上而下：概览条 → 任务表 → 折叠数据质量 → 折叠工具；**页面没有平铺 10 个区块**（静态锁） | 读 SyncAdmin/composable + SSR 渲染顺序 + 静态锁 | `SyncAdmin.vue:91-100`；`test/sync-page-redesign.test.js`（验收 2 两条：顺序 + `adult-stats-card/app-version-card/task-state/任务健康` 在模板与整份文件中均不存在）；SSR 断言 `iKpi < iTable < 数据质量 < 工具` | ✅ |
| 3 | 概览 4 卡数字来自 `sync/status` + `freshness` + `429queue`；「需要关注」点击滚到失败组并展开；折叠收起时标题行显示摘要 | 读接口调用 + SSR 数字断言 + 截图 | `useSyncAdmin.js:317,333,335,271`；`SyncAdmin.vue:39-57`；SSR 断言 `<b>1</b>/<b>2</b>/<b>37</b>/<b>32,201</b>` 与摘要「分级未回填 112,325 · 价格超 7 天 109,312 · 429 队列 37」；截图 `ga-sync-implemented-default.png`（收起态仍显示摘要） | ✅ |
| 4 | 12→11 任务组 + 手动任务组：点击展开/收起；组级与子步骤级「立即运行」弹确认 → 按钮置灰 + toast；告警收表头；移动端 ≤980px 侧栏变顶部横向菜单 | 读组件 + SSR 真渲染 + 真栈截图（1300/375） | 组与手动组：`TaskGroupTable.vue:143-250`；确认+已提交：`useSyncAdmin.js:365-397,117-131`；告警：`TaskGroupTable.vue:134-137`；980：`sync.css:90-105`；截图 `ga-sync-implemented-{default,expanded,375}.png` | ⚠️ 偏差（2 处，见「偏差与说明」） |
| 5 | `jobsFromEnv` 定时任务 **26 → 19**（合并 4 + 转手动 3 + prune 保留改天级），界面组 12 + 手动组 4 | 单测（任务名集合逐项 + prune 1440）+ 运行时打印 | `test/scheduler-slim.test.js`（验收 5：19 个名字逐项、`prune=1440`、12 组且每组非空、预算口径 5 mode）；`test/scheduler.test.js`（默认任务表 19 项）；实跑 `jobsFromEnv({STEAM_API_KEY,ALERT_WEBHOOK_URL})` → 19 | ✅ |
| 6 | 降频 4 项默认值（30/60/120/180，env 仍可覆盖） | 单测 | `test/scheduler-slim.test.js`（验收 6：4 个默认值 + 4 个 env 覆盖 + prune 覆盖回周级） | ✅ |
| 7 | 4 处合并逻辑真生效（backfill 写中文名 / readmodel 重建 token / images 补图 / rating-backfill 含 strict 色情分级） | pglite 真库 + CLI 命令实跑 + 变异自检 | `test/scheduler-slim.test.js` 验收 7-a~7-d（候选并集、`upsertGameMeta` 落中文名 + name_en、readmodel 输出重建行且 `--tokens 0` 不重建、images 输出补缺图行、strict 候选含 adult&&!explicit 且写 explicit_flag）；变异 8/8 变红 | ✅ |
| 8 | 5 个手动任务仍可「立即运行」（catalog/prune/logs/report/steam-claim），被合并任务 CLI 未删；分段测试 + 构建 + 扫描全绿 | HTTP 端点测试 + CLI 实跑 + 4 段测试 + build + scan | 端点：`src/routes/admin-sync.js:172-193`；`test/api.test.js` 断言 `/api/admin/sync/manual` 404/400 与 GET 404；CLI 实跑（见下）exit=0；`test:1~4` 全绿；`vite build` ✓；`scan-secrets` ✓ | ✅ |

### 验收 8 的 CLI 实跑记录（pglite 临时库，不碰生产、不出网）

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `node src/cli.js logs prune --days 7` | 0 | 日志清理完成：删除 22 个文件，保留 10 个（阈值 7 天） |
| `node src/cli.js report price --hours 24` | 0 | `report.price … changed=0 drops=0 rises=0 newLows=0` |
| `node src/cli.js search-tokens --limit 10` | 0 | 搜索 token 重建（增量）完成：处理 0 行，写入 0 行 |
| `node src/cli.js rename --limit 1 --fallback 0` | 0 | 完成：处理 0 款，写入元数据 0 条（其中带回中文名 0 款） |
| `node src/cli.js explicit-backfill --limit 1 --batch 1 --rate 1000` | 0 | adult 计数：0 → 0；explicit：0 → 0 |
| `node src/cli.js images backfill --limit 1` | 0 | 缺图回填完成：扫描 0 款，补 header_image 0 款 |
| `node src/cli.js prune` | 0 | `maintenance.cleanup …`（各项 0 条） |
| `node src/cli.js readmodel check --sample 5 --tokens-limit 10` | 0 | 顺带重建搜索 token（增量）：处理 0 行，写入 0 行 |

> `catalog` 需要 STEAM_API_KEY 与真实 Steam 出口（本机不可达，未实跑）；其可运行性由 `manualJobsFromEnv` 的 `runnable/reason` 与 `/api/admin/sync/manual` 的 400 分支覆盖。`prune` 仍为定时任务（验收 5 的口径），这里顺带验证 CLI 可用。

### 测试与构建证据（本轮亲自重跑）

| 命令 | 结果 |
|---|---|
| `node test/scheduler.test.js` | pass 52 / fail 0 |
| `node test/scheduler-slim.test.js`（GA-2 新增） | pass 7 / fail 0 |
| `node test/sync-page-redesign.test.js`（GA-1 新增，含 Vite SSR 真渲染） | pass 9 / fail 0 |
| `node test/sync-harden.test.js`（任务书写的 sync-health 实为 sync-harden） | pass 22 / fail 0 |
| `node test/image-coverage.test.js` | pass 11 / fail 0 |
| `node test/admin-console-ia.test.js` | pass 24 / fail 0 |
| `node test/admin-console-mobile.test.js` | pass 10 / fail 0 |
| `node test/api.test.js`（真 HTTP + pglite） | pass 41 / fail 0 |
| `npm test` 分段（`test:1` / `test:2` / `test:3` / `test:4`，以 DSH Node v24 逐文件跑） | 31 / 37 / 42 / 36 个文件，全绿（0 failed） |
| `node node_modules/vite/bin/vite.js build --config frontend/vite.config.js` | ✓ built（`frontend/dist` 不入库） |
| `node scripts/scan-secrets.js` | ✅ 未发现高置信度凭据 |
| 变异自检（8 条故意改错 → 期望变红） | 8/8 按预期变红 |

## demo 逐状态对照（规格 §5 + demo 文件 `docs/design/sync-page-redesign-2026-11-27.html`）

| demo 状态 | demo 表现 | 实现 | 判定 |
|---|---|---|---|
| 默认态（`-1.png`） | 侧栏三项；概览 4 卡；任务表 12 组 + 手动组；两折叠收起带摘要 | `docs/design/ga-sync-implemented-default.png`：四项逐一对应（真实数据渲染：20 组内子步骤 + 4 手动任务 + 告警条） | ✅（默认展开态差异见「偏差 3」） |
| 折叠展开态（`?open=quality,tools`，`-2.png`） | 数据质量 = 分级 5 卡 + 最近回填 → 时效 4 卡带补跑 → 429 三卡带立即补；工具 = 初始化全量 + App 版本 4 卡 | `docs/design/ga-sync-implemented-expanded.png`：顺序、文案、按钮一致 | ✅ |
| 组行展开（`expand=0`） | 子步骤表 7 列（子步骤/频率/上次/下次/结果/耗时/操作） | 实现 9 列（多「失败原因」「状态」两列，保留原页运维信息） | ⚠️ 偏差 1 |
| 980px 断点 | 侧栏变顶部横向菜单；组行两行；子步骤表横向滚动 | 页面内三件（概览 2 列/组行两行/表横向滚动）✓；**侧栏**由控制台既有的 ≤768 ☰ 抽屉承担，768–980 仍为左侧竖栏 | ⚠️ 偏差 2 |
| 375px | —（demo 未给手机图） | `ga-sync-implemented-375.png`：☰ 抽屉 + 概览 2×2 + 组行两行，无横向溢出 | ✅ |

## 偏差与说明（不构成打回）

1. **子步骤表列数：实现 9 列，demo 7 列**。多出的「失败原因」「状态」是旧页的运维信息（403 冷却 / 速率闸门 / 熔断 / 重试 / 失败原因），spec §2.2 的结构描述并未要求删列；删掉会丢失排障入口。若要求严格贴合 demo，可把两列合并进「上次结果」的悬停提示（改动 1 处模板 + 1 条断言）。
2. **「移动端 ≤980px 侧栏变顶部横向菜单」**：真实控制台的移动导航是 BW 批既定的「≤768 ☰ 抽屉」（有独立测试锁），把全局侧栏在 980 改成横向菜单会推翻既有设计并影响所有后台页。本批在 980 断点内完成页面内三件套（概览 2 列 / 组行两行 / 子步骤表横向滚动），导航形态交给既有抽屉。**该条需所有者裁定**：接受现状（推荐）还是要求控制台全局改 980 横向菜单。
3. **默认展开态**：demo 默认展开首组（`-1.png` 里 Steam 价格已展开，属 demo 便于截图的行为）；实现默认全部收起。spec §3 未要求默认展开，交互（点行展开/全部收起）一致。
4. **「今日待补」口径**：demo 的 11,203 与它自己的副标题（593+10,306+16,572）不自洽（纯假数据）。实现取 `freshness` 四类「超 1 天」之和，副标题逐类列明，可核对。

## 需人工确认

1. **真实任务运行时观感**：概览卡「运行中 · 已跑 N 分钟」的时长只在后台手动触发（`syncState.run.startedAt`）时可得；调度器子进程的 running 子步骤只能显示「运行中」（scheduler-status.json 不含开始时间）。上线后请目视一次定时任务运行中的卡片文案。
2. **移动端真机**：980/375 已用 headless Chrome 截图验证无横向溢出；真机触控目标（≥44px）与暗色主题观感建议在手机上看一眼（截图 `ga-sync-implemented-375.png`）。
3. **`npm run e2e` 全量**未跑（按任务纪律不跑 e2e 全量）；本批 e2e 影响面是后台菜单与同步页，建议发版前跑一次 smoke。

## 风险提醒（非本批引入，未修复）

- `node src/cli.js init` 在 main 上失败：`ReferenceError: ping is not defined`（`src/cli.js:144`）。本批 `git diff 2ec721b..HEAD -- src/cli.js` 为空，属既有缺陷（部署脚本用 `bootstrap`，暂未暴露）；建议单开条目修。
- `test/admin-games-split.test.js` 有 1 条既有红（「接线在 wishlists 段之后」，`server.js` 已无 `listWishlists` 调用）——该文件不在主链 `npm test` 里，非本批改动导致。

## 纪律检查

| 项 | 结论 |
|---|---|
| `git tag --list` | 无新增 tag（未打 tag、未触发构建） |
| diff 是否碰部署/服务器配置/凭据 | 否（仅前端组件/composable、scheduler、CLI、store、route、tests） |
| 构建产物是否进提交 | 否（`frontend/dist/` 未提交）；截图在 `docs/design/`（与既有设计图一致） |
| 是否推 main | 是（`b4be166` / `d28fc2c` / `4993f15` 已推 origin/main） |
| `docs/PROJECT-OVERVIEW.md` 同步 | **未改**——按本批任务红线（发布类文档由监工统一改），需监工在构建时补「同步页/任务精简」落点 |
| `docs/TODO.md` 状态回写 | **未改**（同上红线）；GA 条目现应改为 `质检通过`，待监工补回 |

## 打回清单

- 无必修项。上述「偏差与说明」1–4 与「需人工确认」1–3 供所有者/监工裁定；若裁定要求严格贴合 demo（列数、默认展开），按偏差 1/3 的说明改 1 处模板即可，工作量约 10 分钟。

## 复检记录

- 第 1 轮（2026-11-28）：基线 `2ec721b` → HEAD `4993f15`；逐条核对 8 条验收 + demo 5 个状态 + 纪律 6 项；
  亲自重跑 8 个关键测试文件 + `test:1~4` 四段 + `api.test.js` + `vite build` + `scan-secrets`；变异自检 8/8 变红；
  真栈（pglite + headless Chrome）截图 3 张（默认/展开/375）。结论：⚠️ 有条件放行（无打回项，4 条偏差说明 + 3 条需人工确认）。
