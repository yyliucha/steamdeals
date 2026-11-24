# 同步服务合并为任务组（FJ，待开发，2026-11-24）

> 所有者反馈（2026-11-24）：「打开页面，后面的服务太多太多」——当前调度器 25 个任务碎片化（同一 Steam 接口拆
> 4 个任务、四个平台各一任务等）。所有者确认合并为 **12 个任务组**（组行 + 展开子步骤；steam-claim 改手动分支）。

## 1. 现状（25 个调度任务）

`src/scheduler.js` 的 `jobs` 扁平列表：catalog / steam-prices / heat / steam-status / steam-discovery /
app-release-sync / align-snapshot / rename / rating-backfill / backfill / steam-accounts / steam-claim / prune /
proxy-probe / readmodel / search-tokens-rebuild / sonkwo / itad / gog / humble / discover / backup / logs / alerts /
images / images-backfill / report。

## 2. 目标分组（12 组）

| # | 组名 | 子步骤（原 mode 保留） | 调度策略 |
|---|---|---|---|
| 1 | Steam 价格 | steam-prices | 原 1440min（分批 5000） |
| 2 | **Steam 元数据** | steam-status + rating-backfill + backfill + rename | 组内按优先级串行：未探测 → 缺分级 → 缺说明 → 缺中文名；各自原限速 |
| 3 | **多平台报价** | sonkwo + itad + gog + humble | 按到达期：sonkwo 60 / itad 1440 / gog 720 / humble 720 |
| 4 | **目录与发现** | catalog + steam-discovery + discover | 10080 / 1440 / 720 |
| 5 | **图片同步** | images + images-backfill | 240 / 360 |
| 6 | **索引维护** | readmodel + search-tokens-rebuild | 1440 / 360 |
| 7 | **系统维护** | prune + logs + backup | 10080 / 10080 / 1440 |
| 8 | **Steam 账号** | steam-accounts + steam-claim（**手动分支**） | accounts 1440；claim 不再定时，后台按钮触发 |
| 9 | 热度回填 | heat | 原 1440 |
| 10 | App 版本同步 | app-release-sync | 原 15min |
| 11 | 对齐快照 | align-snapshot | 原 30min |
| 12 | 代理与提醒 | proxy-probe + alerts + report | 10 / 360 / 1440 |

**保留独立**：1/9/10/11（核心/独立链路，不并入）。

## 3. 实现要点

1. **组调度器**：`jobs` 从扁平改为组定义：
   ```js
   { name: 'steam-meta', label: 'Steam 元数据', steps: [
       { mode: 'steam-status', intervalMin: 1440, args: [...] }, ... ] }
   ```
   每 tick：组内**到期且未在跑**的子步骤按优先级**串行**执行（heavy slot 互斥不变，不并发）。
2. **sync_runs 兼容**：子步骤仍用**原 mode** 写 sync_runs/告警/健康面板（历史/熔断/lastrun 恢复不变）；组只是调度层。
3. **后台 UI**：同步页 25 行 → **12 组行**（组名/最近运行/健康状态）；点击展开子步骤（mode/上次运行/结果/「立即运行」）。
4. **「立即运行」**：组级 = 跑组内到期子步骤；子步骤级 = 只跑该 mode（原行为）。
5. **间隔/限速**：沿用各子步骤原环境变量（组不引入新参数）。
6. **steam-claim**：从定时移除；改「Steam 账号」组内的手动分支（后台按钮「认领未归属账号」触发一次）。
7. **API 兼容**：`/api/admin/sync/status` 新增 `groups` 字段；旧 `jobs` 字段保留一版（兼容）。

## 4. 风险与边界

| 风险 | 处理 |
|---|---|
| 组内子步骤同抢 Steam 接口（元数据组 4 步都调 appdetails） | 组内串行，共用 429 冷却 |
| 后台按 mode 状态/筛选 | 保留 mode 级 API；UI 组展开 |
| 调度记录/告警按 mode | 不变 |
| 迁移期间新旧并存 | 一次性替换 jobs 定义；旧 mode 仍可手动触发 |

## 5. 验收

1. 后台同步页显示 **12 个组**（非 25 行碎片）；
2. 组内子步骤按到期/优先级执行，`sync_runs` 仍按 mode 记录（历史一致）；
3. 「立即运行」组级/子步骤级可用；steam-claim 手动分支可触发；
4. steam-meta 组 4 步不并发、共用限速；
5. `npm test`（分段）+ `frontend:build` + `scan` 全绿；截图对照（合并前后）。

## 6. 实现（2026-11-24，监工接力轮）

- **组定义**：`src/scheduler.js` 顶部 `JOB_GROUPS`（12 组 name/label/steps，steps 顺序 = 组内优先级）；
  `jobsFromEnv` 的 25 个任务字面量不变，末尾按 JOB_GROUPS 组序重排并给每个 job 打 `group` 字段；
  `groupsFromJobs`/`jobGroupsFromEnv` 聚合回组结构（空组保留——无 `STEAM_API_KEY` 时 Steam 账号组 steps 为空但组仍在）。
- **组内串行**：`planTick` 新增 `jobs` 参数——传了就启用组内串行（某组已有子步骤在跑或本 tick 已选中一个时，
  该组其它到期子步骤不派发）；不传退化为旧行为（组约束不生效）。main() tick 传 `jobs`。
  跨组行为不变：重任务全局单槽、轻任务 lightMax 并行上限照旧。
- **sync_runs 兼容**：子步骤原 mode 不变（`steam-status`/`rating-backfill`/… 照旧写历史/告警/健康面板）；
  组只是调度层，不引入新参数、间隔沿用各子步骤原环境变量。
- **状态文件**：`writeStatusFile` 输出 `groups`（12 组 name/label/steps，行结构与 jobs 同口径、带 group 字段）；
  旧 `jobs` 字段保留（AdminLogs 健康条等兼容方继续可用）。
- **API**：`GET /api/admin/sync/status` 的 schedule 补 `steamClaimConfigured`（是否有
  `STEAM_CLAIM_USERNAME` + `STEAM_CLAIM_STEAM_ID`，后台按钮据此置灰）；
  `POST /api/admin/sync/groups/:name/run` 组级立即运行——读状态文件判到期（从未跑过视为到期；
  跑过的按 `lastRunAt + intervalMin`），到期子步骤按组内顺序**链式串行**执行（每个结束才启动下一个，
  HTTP 立即返回 202；用户手动停止后不再启动下一个）；无到期子步骤返回 200 `started:false`；
  `POST /api/admin/steam-claim` 手动认领（复用 startSteamJob 槽位，未配置返回 400）。
- **steam-claim 移出定时**：原定时任务对象删除；`steamClaimArgs(env)` 导出供 API 取参数
  （`['steam-claim', username, steamId]`，未配置 null）。CLI 命令保留（cli-dispatch 测试锁定）。
- **后台 UI**：AdminModules.vue「同步与回填」任务表改 12 组行（expand 展开子步骤）+ 组级「立即运行」+
  子步骤级立即运行（沿用现有端点）+ Steam 账号组「认领未归属账号」按钮；AdminLogs.vue 健康条按组 chip。
- **测试**：`test/scheduler.test.js` FJ 7 项（组定义与优先级、planTick 组内串行、跨组并行、
  无 jobs 退化兼容、状态文件 groups、空组保留、steamClaimArgs）+ 旧断言随组序更新；
  scheduler 48/48、sync-runs 9/9、cli-dispatch 12/12、api 38/38。
