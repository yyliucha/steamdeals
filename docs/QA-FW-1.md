# QA：FW-1（慢慢同步——heat/discovery 低频化 + discovery 页游标 + 设置与升级迁移）（第 1 轮）

> 基线 `0a9e35a` → HEAD `7c21b29`；判据 [SLOW-SYNC.md](SLOW-SYNC.md) §8「FW-1」7 条 +
> [TODO.md](TODO.md) FW 子批表；开发描述来源：夜班监工交接单（FW-1 子批，2026-11-26）。
> 结论：**✅ 放行** —— 通过 7 / 缺失 0 / 偏差 0 / 需人工确认 2（部署后设置页目视、真实 403 下的游标续跑）
>
> 本报告由工人按 `steamdeals-nightshift` 流程自查产出，**未提交**（`docs/QA-*.md` 默认入库外留档）；
> `docs/TODO.md` 状态由监工统一回写（工人纪律：本批不改发布档）。

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | FW-1 | 热度回填改成「每轮 100 款、10 分钟一轮」，首轮延迟仍 1 小时 | 后台「运行与同步」任务表 `heat`；调度命令 `heat --limit 100 --sleep 1700` | ✅ | `src/scheduler.js:85`、`:86`；`test/scheduler.test.js:79/105` |
| 2 | FW-1 | 热度候选只重刷「30 天前刷过且有报价」的游戏（不再 7 天） | 每次 `heat` 轮询的候选 SQL | ✅ | `src/store/cli-ops-repository.js:31`；`test/slow-sync.test.js:38` |
| 3 | FW-1 | Steam 发现改成「每轮 10 页 + 10 条名称回退、30 分钟一轮」 | 后台任务表 `steam-discovery`；调度命令 `steam-discovery --pages 10 --fallback 10` | ✅ | `src/scheduler.js:108`、`:109`；`test/scheduler.test.js:80/106` |
| 4 | FW-1 | Steam 发现断点续跑：页游标存库，撞 403/重启后从原页继续，不再永远只覆盖前 5000 款 | 自动（每轮结束写 `app_meta.discovery.page_cursor`） | ✅ | `src/discovery.js:14/20/145`；`test/slow-sync.test.js:101` |
| 5 | FW-1 | 发现翻到尽头（空 items）→ 游标重置为 1 并记 `completedAt` | 自动（下一轮从第 1 页重新播种） | ✅ | `src/discovery.js:126/152`；`test/slow-sync.test.js:128` |
| 6 | FW-1 | 手动重跑：`steam-discovery --reset-cursor` 从第 1 页开始 | CLI：`node src/cli.js steam-discovery --reset-cursor` | ✅ | `src/cli/sync.js:440/444`、`src/discovery.js:45`；`test/slow-sync.test.js:140` |
| 7 | FW-1 | 设置页「发现与热度」卡新增热度 3 项（每轮条数/间隔/首轮延迟），发现 3 项默认值更新为 10/10/30（间隔下限 60→10） | 后台 → 系统设置 → 数据源与采集 → 发现与热度（热度三项在「高级设置」折叠内） | ✅ | `src/settings.js:81-83`、`398-400`、`404/409/414`；`test/settings.test.js:513` |
| 8 | FW-1 | 升级迁移：线上已保存的旧默认值一次性改成新默认（100→10 / 100→10 / 1440→30），只生效一次，显式改过的不动 | 进程启动初始化链路（`initializeSettings`），无需人工操作 | ✅ | `src/settings.js:1180/1194/1232`；`test/settings.test.js:557` |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格 §8 FW-1） | 检查手段 | 证据（文件:行 + 关键片段） | 判定 |
|---|---|---|---|---|
| 1 | scheduler 默认参数：heat = `['heat','--limit','100','--sleep','1700']` + `intervalMin=10`；steam-discovery = `['steam-discovery','--pages','10','--fallback','10']` + `intervalMin=30`（更新 scheduler/discovery 测试） | 读代码 + 跑 `test/scheduler.test.js`、`test/discovery.test.js` | `src/scheduler.js:85` `args: ['heat', '--limit', String(num(env.STEAM_HEAT_LIMIT, 100)), '--sleep', '1700']`；`:86` `intervalMin: num(env.STEAM_HEAT_INTERVAL_MIN, 10)`；`:108` `--pages …10 …--fallback …10`；`:109` `intervalMin: num(env.STEAM_DISCOVERY_INTERVAL_MIN, 30)`。测试 `test/scheduler.test.js:79/80/105/106`；`test/discovery.test.js:81` 断言 `STEAM_DISCOVERY_PAGES, 10`（原 100） | ✅ |
| 2 | heat 候选 SQL 用 30 天：`heat_at` 在 8~29 天的有报价游戏**不入选**，>30 天入选（新增测试） | 真实 pglite 库插 8/29/31/40 天前 + 无报价 + 已删除的样本，跑真实候选 SQL | `src/store/cli-ops-repository.js:31` `g.heat_at < now() - interval '30 days'`；`test/slow-sync.test.js:38-75`：8101(8天)=不入选、8102(29天)=不入选、8103(31天)=入选、8104(无报价)=不入选、8105(已删除)=不入选、8106(null)=入选（首轮播种）。旧 7 天口径下 8101/8102 会变红（反向自检见文件头注释） | ✅ |
| 3 | discovery 游标推进：mock fetch 跑 10 页后 `app_meta.discovery.page_cursor.nextPage=11`；第二轮首个请求 `start=500`（断言 URL） | 真实 pglite 库 + mock fetch，断言每一次请求 URL 的 `start` 与库里的游标行 | `src/discovery.js:145` 每页写 `{nextPage: page}`；`test/slow-sync.test.js:101-126`：10 次请求 start 依次 `0,50,…,450`；`readDiscoveryCursor(q).nextPage === 11`；`app_meta` 行值含 `"nextPage":11`；第二轮首个 URL `start=500`、`stats.startPage===11` | ✅ |
| 4 | 翻到尽头（`items` 空）→ 游标重置 1 并记 `completedAt` | 同上，第二轮直接返回空 items | `src/discovery.js:126` `reachedEnd = true`、`:152` 写 `{nextPage:1, completedAt}`；`test/slow-sync.test.js:128-138` 断言 `nextPage===1`、`completedAt` 与 `roundStartedAt` 都是可解析 ISO 时间 | ✅ |
| 5 | 游标落 `app_meta`（重启不丢）；`--reset-cursor` 可从 1 重来 | 断言值真实写入 `app_meta` 表（非 `data/*.json`）+ reset 参数行为 | `src/store/cli-sync-repository.js` 新增 `readAppMeta/writeAppMeta`（upsert 到 `app_meta`）；`src/discovery.js:14` 键名；`src/cli/sync.js:440/444` 参数映射；`test/slow-sync.test.js:117-118` 断言 `app_meta` 行；`:140-161`：游标先设 7 → `--reset-cursor` 首个请求 `start=0`、跑 1 页后游标 2；不带参数时从第 2 页续跑 `start=50` | ✅ |
| 6 | 设置页「发现与热度」卡出现 heat 两项；discovery 三项默认值更新；迁移幂等（`slow_sync.migrated_v1` 只生效一次） | 设置 schema 单测 + 真实 pglite 迁移两轮 | heat 三项 `section='discovery'`（`src/settings.js:81-83`，页卡 = `SETTINGS_SECTIONS` 的 `discovery`「发现与热度」，`src/settings.js:132`）；默认 100/10/3600 与范围 1–200000 / 1–1440 / 0–86400（`:404/409/414`，用例 `test/settings.test.js:513`）；discovery 10/10/30、min=10（`:398-400`，用例 `:543`）；迁移 `src/settings.js:1194-1217`（`value = to_jsonb(新值) where value = to_jsonb(旧值)`），标记 `SLOW_SYNC_MIGRATED_KEY`（`:1180`），启动链路 `:1232` 调用；用例 `test/settings.test.js:557`：旧默认→新默认、显式值 50 不动、第二次启动把 pages 改回 100 后**不再迁移** | ✅ |
| 7 | `npm test`（分段）+ `frontend:build` + `scan` 全绿 | 亲自重跑本批相关测试 + 构建 + 扫描；全量分段由 CI `test-main`（push main 必跑）执行 | 见下方「验证记录」：scheduler 48/48、discovery 5/5、slow-sync 4/4、settings 19/19、setup 4/4、cli-ops 3/3、sync-harden 22/22；`vite build ✓ built in 1m 5s`；`scan-secrets ✅ 未发现高置信度凭据`；api.test 40/40（启动/设置链路回归）；**GitHub Actions `test-main` 对 `7c21b29` 结论 `success`**（`npm test` 四段全量 + `api.test` + `frontend:build` + `scan`，workflow run 45793517473） | ✅ |

## 纪律检查（对应 steamdeals-qa §6）

| # | 检查项 | 结果 |
|---|---|---|
| 1 | `git tag --list` / `git tag --points-at HEAD` | 本批**未打 tag**（`git tag --points-at 7c21b29` = 空）；仓库既有 131 个历史 tag 未动 |
| 2 | diff 是否碰部署/服务器配置/凭据 | 否：12 个文件全部是 `src/**`、`test/**`、`package.json` 的 test:3 脚本行；无 compose/DEPLOY/凭据 |
| 3 | 构建产物 / 日志是否进提交 | 否：`frontend/dist/`、`*.log`、`data/**` 均未入提交（`git diff --name-only 0a9e35a..HEAD` 无匹配）；工作区已有他人未提交文件未纳入 |
| 4 | 是否推 `main` | 是：`0a9e35a..7c21b29  main -> main`（`git -c http.sslBackend=openssl push origin main`） |
| 5 | 文档收尾 | **本批按监工纪律不改发布档**（`docs/TODO.md`/`REQUIREMENTS-INDEX`/`DONE`/`DELIVERY`/`CHANGELOG`/`README` 均未改）；`docs/PROJECT-OVERVIEW.md` 待监工统一回写（本批新增 heat 三项设置、discovery 游标两个落点） |

## 风险提醒 / 主动说明（不判错）

1. **预算估算同步改了默认值**（规格 §3.2 表未单列）：`src/scheduler.js:684` `theoreticalRunSeconds` 的 heat 默认 20000→100、
   `:703` `steamDailyBudgetMinutes` 的 heat 间隔默认 1440→10。理由：不改则任务参数与预算估算两套口径（任务按 100 款/10 分钟跑、
   预算仍按 2 万/天算），任务卡「估算」与自动缩量都会失真。副作用：默认预算仍 >24h（约 2071 分钟），`applySteamBudget`
   照旧自动缩 `steam-status`（既有机制，实测值部署后校正）。
2. **CLI 手工命令的 `--pages/--fallback` 默认值仍是 100/100**：监工交接单要求「`--pages` 语义不变」；调度器由设置/Hydrate 的
   `STEAM_DISCOVERY_PAGES=10` 显式传参，故线上节奏是 10 页。手工 `steam-discovery` 是显式大批量跑，不受影响。
3. **heat 三项放在「发现与热度」卡的折叠（高级设置）内**：该卡已有 3 项常用，CQ 批 SETTINGS-IA「每卡常用 ≤3 项」由
   `test/settings.test.js:386` 锁死；heat 三项可见但默认折叠。
4. **发现游标只在「取到有效 items」后推进**：请求失败（403/429/网络）时游标停在原页（下一轮续跑），这是「进度只进不退」的
   前提，也是 FW-3 软收尾的保存点。

## 需人工确认

| # | 条目 | 为什么本地验不了 | 上线后看什么 |
|---|---|---|---|
| 1 | 设置页「发现与热度」卡实际目视 | 需求明确「不新增页面、不改重设计」，样式由 schema 驱动；本地只做 schema/DOM 契约断言，未起 headless 截图（本批无 demo 要求） | 后台 → 系统设置 → 数据源与采集 → 「发现与热度」卡：展开「高级设置」应见 热度每轮条数/间隔/首轮延迟；discovery 三项显示 10/10/30 |
| 2 | 真实 403 下的游标续跑 | 本地无 Steam 出口（技能 §7：采集类网络失败是预期），只用 mock fetch 断言 | 部署后撞 403 的下一轮：`app_meta` 里 `discovery.page_cursor.nextPage` 与上一轮结束时一致（不回到 1）；日志 `discovery.page_cursor` 的 page 从原页继续 |

> 原「全量分段（test:1~4）」一条**已由 CI 覆盖**：GitHub Actions `test-main` 对 `7c21b29` 结论 `success`
> （run 45793517473，`npm test` 四段 + `api.test` + `frontend:build` + `scan`），故移出人工确认。

## 争议项（待所有者裁定）

- 无。

## 验证记录（命令 + 关键输出）

```powershell
$node='C:\Users\Administrator\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe'
& $node test/scheduler.test.js   # ℹ tests 48 | pass 48 | fail 0
& $node test/discovery.test.js   # ℹ tests 5  | pass 5  | fail 0
& $node test/slow-sync.test.js   # ℹ tests 4  | pass 4  | fail 0   （新增，覆盖验收 2~5）
& $node test/settings.test.js    # ℹ tests 19 | pass 19 | fail 0   （含 FW-1 设置项/迁移两项新用例）
& $node test/setup.test.js       # ℹ tests 4  | pass 4  | fail 0
& $node test/cli-ops.test.js     # ℹ tests 3  | pass 3  | fail 0
& $node test/sync-harden.test.js # ℹ tests 22 | pass 22 | fail 0
& $node test/api.test.js         # ℹ tests 40 | pass 40 | fail 0   （启动/设置链路回归）
& $node node_modules\vite\bin\vite.js build --config frontend/vite.config.js  # ✓ built in 1m 5s
& $node scripts/scan-secrets.js  # 扫描 869 个文件 ✅ 未发现高置信度凭据

# CI（push main 自动触发）：gh run view 45793517473
# test-main completed success（HEAD 7c21b29；npm test 四段全量 + api.test + frontend:build + scan）
```

## 复检记录

- 第 1 轮（2026-11-26）：按规格 §8 FW-1 逐条取证 + 亲自重跑 + CI `test-main` 绿，✅ 放行
  （通过 7 / 缺失 0 / 偏差 0 / 需人工确认 2）。无打回项。
