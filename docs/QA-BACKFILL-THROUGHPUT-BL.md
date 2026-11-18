# QA：BL 增量回填吞吐与配额治理（第 1 轮）

> 基线 `3881f2c` → HEAD `e734673`；判据 [BACKFILL-THROUGHPUT.md](BACKFILL-THROUGHPUT.md) §4 验收；
> 开发描述来源：所有者消息（TODO BL，BL-1 → BL-2 → BL-3）。
>
> 结论：✅ 放行 —— 通过 9 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | BL | 回填不再白烧配额：free/未发售/锁国区/国区不可售四态永久排除出回填队列（国区无价仍保留重试） | 后台 → 同步与回填（候选由服务端 SQL 决定） | ✅ 已交付 | src/store/pg.js `backfillCandidateWhere`；test/backfill-throughput.test.js:31 |
| 2 | BL | 回填节奏从每周 5 万改为每天 5000，任务表显示「每 1 天」，配额预算仍 <24h | 后台 → 同步与回填 → 任务表 | ✅ 已交付 | src/scheduler.js（1440/5000）；test/scheduler.test.js:79-100、424 |
| 3 | BL | 遇到 429/403 不再整轮作废：本轮进度保留、显示「部分完成」，不累计失败、不触发熔断 | 后台 → 同步与回填 → 任务卡 | ✅ 已交付 | src/cli.js softExit（exit 75）+ `backfill.partial`；src/scheduler.js `recordJobResult` 75 分支；test/scheduler.test.js BL-2 |
| 4 | BL | 429 后 1 小时内自动重排一轮；连续 3 次放弃等日轮；成功一次即清零重试状态 | 调度器自动（data/scheduler-retry.json） | ✅ 已交付 | src/scheduler.js `applyRetry`/`dueJobs(retry)`；test/scheduler.test.js BL-2 |
| 5 | BL | 首次 429 即写全局冷却文件（含 at/label），其它任务不再立刻打 Steam | data/steam-429.json（跨进程共享） | ✅ 已交付 | src/http.js 429 分支（write 先于 break）；test/http-error.test.js BL-2 |
| 6 | BL | 同一游戏连续 3 次拿不到数据 → 跳过 30 天（自动重入），成功一次清零 | 服务端自动（games 两列 + 部分索引） | ✅ 已交付 | src/store/pg.js `recordBackfillFailures`/`clearBackfillFailures`；test/backfill-throughput.test.js BL-3 |
| 7 | BL | 指标卡新增「待回填 / 已排除 / 跳过中」三个数字，与库内一致 | 后台 → 游戏目录 → 指标卡 | ✅ 已交付 | src/store/pg.js `adminGameStats` 三字段；frontend AdminModules.vue 三卡；test/backfill-throughput.test.js stats 对账 |
| 8 | BL | 任务卡显示「部分完成」（hover 详情）、429 次数/最近时间、重试时间、预计剩余天数 | 后台 → 同步与回填 → 任务卡 | ✅ 已交付 | frontend AdminModules.vue `partialTitle`/`partialReason`/retryAt；src/backfill.js 进度文件；server.js 合并 `backfillProgress` |
| 9 | BL | 进度文件落盘（data/backfill-progress.json，running/ok/partial/failed 与全部字段） | 文件 + `/api/admin/sync/status` | ✅ 已交付 | src/backfill.js `buildBackfillProgress`/`read`/`write`；test/backfill-throughput.test.js BL-2 |

## 逐条核对（规格 §4 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 候选去噪：四态不入选、no_price 保留；待回填+已排除=旧候选数 | 单测 + 统计对账断言 | test/backfill-throughput.test.js:31（`[5,6,7]` 断言）与 stats 测试（pending+excluded+skipped=旧候选数）；pg.js `backfillCandidateWhere` | ✅ |
| 2 | 每日节奏：interval=1440、limit=5000、任务表「每 1 天」、预算<24h、env 覆盖 | 单测 + 静态 | test/scheduler.test.js:79（1440）、:100（5000）、:424（total<=1440）；AdminModules `fmtInterval(1440)`→每 1 天；jobsFromEnv env 覆盖（既有测试） | ✅ |
| 3 | 429 软退出：exit 75、`backfill.partial` 含 done/failed、partial 不增 failures 不熔断（连续 3 次也不熔断） | 静态 + 单测 | cli.js `softExit`（`process.exitCode = 75`、`backfill.partial`、`writeProgress('partial')`）；scheduler.js `recordJobResult` code 75 分支；test/scheduler.test.js BL-2（failures 保持 2） | ✅ |
| 4 | 1 小时重排：at≈now+60min、改到过去下一 tick 再调度（受重任务单槽）、连续 3 次放弃、成功清空 | 单测 | test/scheduler.test.js BL-2（applyRetry streak 1/2/3、code 0 清空、dueJobs retry 判定）；planTick 单槽约束未动 | ✅ |
| 5 | 全局冷却：STEAM_429_RETRIES=0 仍写 at/label，其它任务读到后不再打 Steam | 单测 + 代码顺序 | test/http-error.test.js BL-2（at/label/until 落盘、readSteam429Info）；http.js 429 分支（write 在 break 之前）；readSteam429Until 既有逻辑 | ✅ |
| 6 | 失败隔离：连续 3 次跳过 30 天、候选排除、到期重入、成功清零 | 单测 | test/backfill-throughput.test.js BL-3（3 次触发/计数/到期重入/清零）；pg.js `recordBackfillFailures`（两段 UPDATE）| ✅ |
| 7 | 观测：进度文件字段完整、sync/status 合并、指标卡三数字与库一致、任务卡 partial/429/重试/预计剩余 | 单测 + 静态 | test/backfill-throughput.test.js BL-2（字段集合断言）与 stats 对账测试；server.js `backfillProgress`；AdminModules.vue `partialTitle`（done/limit/remaining/etaDays）、`partialReason`（count429/last429At）、retryAt | ✅ |
| 8 | 权限与兼容：stats/sync 401/403、老库迁移幂等、旧行默认不跳过 | 代码复核 | server.js `requireAdmin()`（既有）；migrate `add column if not exists`（pg.test 建表幂等）；谓词 `(backfill_skip_until is null or < now())` → null 通过 | ✅ |
| 9 | npm test / frontend:build / scan 全绿 | 重跑 | `npm test` 退出 0（无 not ok）、`node test/api.test.js` 22/22、`frontend:build` 1.60s、`scan` 无凭据 | ✅ |
| 10 | 部署侧只读复核（候选数/四态数、进度文件 done/limit、每日一轮、429 次数下降） | 无法本地执行 | 部署人员按规格 §4.10 执行 | 🔎 |

## 打回清单

无。

## 需人工确认

- 验收 3 的「模拟 429 → 退出码 75」：本地无 Steam 出口，softExit 路径由代码静态证据 + 调度器 partial 语义单测锁住；真实 429 行为在部署后首次触发时确认；
- 验收 10：部署侧只读复核（生产候选数与四态数、进度文件、24h 内每日一轮、429 次数趋势），开发侧不碰服务器。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-13）：初检即 ✅ 放行，无打回项。
