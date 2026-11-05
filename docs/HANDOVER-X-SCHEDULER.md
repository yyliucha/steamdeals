# 开发交接单：X 批「调度器长任务阻塞修复」

> 给开发会话（实现用）。需求方为所有者，需求与方案已确认（2026-11-05）。
> 规格：[SCHEDULER-BLOCKING-FIX.md](SCHEDULER-BLOCKING-FIX.md)。待办：[TODO.md](TODO.md) 的 X 条目。

## 0. 开工前

```bash
cd F:\dsh\gameprice
git log --oneline -3          # 期望 HEAD 为 v1.16.0 之后
git status --short            # 工作区应只有本批文档改动
node -p "require('./package.json').version"
```

**工作区未提交文件**（随本批一起提交）：`docs/SCHEDULER-BLOCKING-FIX.md`（新）、`docs/HANDOVER-X-SCHEDULER.md`（新）、
`docs/TODO.md`（X 条目）。`.dsh/` 已在 `.gitignore`，不要提交。

## 1. 需求一句话

调度器用 `await runJob()` 跑重任务，子进程不退出就阻塞整个 tick 循环；`steam-prices` 每天跑 90 分钟以上，
**这期间所有其它任务（含 60 分钟周期的 `sonkwo`、每天的 `alerts`/`steam-accounts`、`steam-status`）全部饿死**。
本批要让它"串行但不等"，并顺带修掉 `steam-status` 的分级、首轮延迟与节奏问题。

## 2. 诊断证据（已核实，不必重新查）

| 证据 | 值 |
|---|---|
| 容器启动 | `2026-11-05T05:31:26Z`（13:31 北京） |
| 运行中的子进程 | `node /app/src/cli.js sync steam-prices --limit 200000`，已跑 **91 分钟** |
| `data/scheduler-status.json` | `updatedAt` 停在启动时刻；**所有任务 `lastRunAt: null`** |
| 日志 | 13:31:58 一条 `scheduler.job_start`（steam-prices），之后无任何 `job_start` |
| 数据 | `steam_status`：null 174,976 / free 23,251 / not_found 331；最近判定 `11-04T09:30Z` |

## 3. 改动清单（按实施顺序）

### P0-1 重任务改为「非阻塞发射 + 全局单槽」

文件：`src/scheduler.js`

- 现状：`launch`（`:455-473`）用于轻任务；重任务在 `:513-539` 的循环里 `await runJob(job)`（`runJob` 在 `:360-387`，
  只有子进程 exit 才 resolve），因此 tick 循环（`while`，`:486` 起）被阻塞。
- 改为：新增 `let heavySlot = null`；重任务走 `launchHeavy(job)`：

```js
const launchHeavy = (job) => {
  heavySlot = job.name;
  running.add(job.name);
  runJob(job)
    .then(({ code }) => completeJob(job, code))
    .catch((err) => {
      logger.error('scheduler.job_unexpected', { job: job.name, err: serializeError(err) });
      completeJob(job, -1);
    })
    .finally(() => { heavySlot = null; wake?.(); });
};
```

- 重任务循环内：`if (heavySlot || running.has(job.name)) continue;`（保留 `runningSyncRun` 互斥、熔断 `circuit_skip`、
  `lastRunMs.set` 逻辑不变），然后 `launchHeavy(job)`。
- **注意**：`completeJob` 会 `running.delete`，`.finally` 里置空 `heavySlot`；两者顺序不敏感，但都要在。

### P0-2 `steam-status` 归入 `STEAM_HEAVY`

- `:224` 的集合加 `'steam-status'`；
- `test/scheduler.test.js` 增加断言：`STEAM_HEAVY`（若未导出，则通过行为断言）包含 `steam-status`。

### P1-1 `lastRunMs` 启动时从 `sync_runs` 恢复

- 现状：`const lastRunMs = new Map()`（`:413`），重启即清空，所有任务重新按 `initialDelaySec` 计时；
  `dueJobs`（`:253`）在无记录时用 `startedMs + initialDelaySec`。
- 改为：启动时查 `select mode, max(started_at) as last from sync_runs group by mode`，按 `mode` 名（与 job.name 同名）
  填充 `lastRunMs`；查询失败只记 warn，不阻塞启动。

### P1-2 `steam-status` 首轮延迟与节奏

| 项 | 现在 | 改为 |
|---|---|---|
| `STEAM_STATUS_INITIAL_DELAY_SEC` | 21600（6 小时） | **600**（10 分钟） |
| `steamStatus.intervalMin` | 10080（每周） | **1440**（每天） |
| `steamStatus.limit` | 8000 | **12000** |

落点：`src/scheduler.js:63-65` 的默认值 + `src/settings.js` 的 `def('steamStatus.*')`（`:74`、`:80`、`:86`）。
注意：设置项是"数据库 > 环境变量 > 默认值"，改默认值只影响**未在页面保存过**的部署；线上若已保存过旧值，
需要在交付说明里写"请在系统设置里确认/重置这三项"。

### P2 状态文件每 tick 刷新

- `writeStatusFile`（`:269`）现在只在启动（`:484`）与任务完成（`:424`）时调用；
- 改为：`while` 循环末尾每 tick 调一次（`tickMs` 传 `TICK_MS`），使 `updatedAt` 可反映调度器存活。

## 4. 约束

- 不改 `steam-prices` 的请求策略（配额/批量/限速保持原样）；
- 不新增运行时依赖；PG 15 语法；
- 保持"同一时刻最多一个 Steam 重任务"的语义（`heavySlot` 单槽）；
- `runJob` 的 `stdio: 'inherit'`、子进程 kill、熔断、`sync_runs` 互斥逻辑都不要动；
- 新增/修改逻辑补日志事件时沿用 `scheduler.*` 域。

## 5. 验收（对应规格 §5）

1. 让 `steam-prices` 跑起来的期间（可临时把 limit 调小模拟长任务），`sonkwo`/`alerts`/`steam-accounts` 仍按周期出现
   `scheduler.job_start`；
2. 同一时刻最多一个 Steam 重任务（`data/scheduler-status.json` 的 `running` 与日志可验证）；
3. 重启后 `nextRunAt` 不再全部从 0 重新计时（有历史记录的任务按 `lastRunMs` 恢复）；
4. `steam-status` 启动后约 10 分钟内首轮触发；之后每天一轮、每轮 12000 条；
5. `scheduler-status.json` 的 `updatedAt` 与当前时间差 ≤ `tickMs`；
6. `npm test` 全绿（`test/scheduler.test.js` 新增断言）、`npm run frontend:build`、`npm run scan`。

## 6. 风险提示

- **并发语义**：改成非阻塞后，若 `heavySlot` 清理遗漏，可能出现两个重任务并行打 Steam（配额翻倍、429 风险）。
  建议在 `completeJob` 与 `.catch` 两处都保证释放，并加一条日志 `scheduler.heavy_slot_released` 便于观测。
- **`stdio: 'inherit'`**：非阻塞后子进程输出仍写同一 stdout，不影响。
- 部署后首日建议观察一次 `scheduler.job_start` 序列，确认轻任务不再被饿死。

## 7. 交付与红线

- 改完同步 `docs/DELIVERY.md`（数据任务表：`steam-status` 改每天）、`docs/PROJECT-OVERVIEW.md`、`CHANGELOG.md`；
- 规格 §6 已把两项决策记为"已确认"，无需再问；
- **不自行打 tag / 触发构建**（硬规则 5），等"构建 vX.Y.Z"指令；
- 回复格式：命令 → 关键输出 → 结论；未跑的验证要明说没跑。
