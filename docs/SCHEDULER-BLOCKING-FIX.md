# 调度器长任务阻塞修复（已发布 v1.16.1）

> 状态：**已实现并发布 v1.16.1（2026-11-05）**；tag `v1.16.1` 已推送，镜像构建见 CI。
> **遗留**：`steamStatus.initialDelaySec` 没有做成设置项（其他任务都有），线上只能靠环境变量
> `STEAM_STATUS_INITIAL_DELAY_SEC`；已登记为 [TODO.md](TODO.md) 的 Y 条目。
> 关联：[DELIVERY.md](DELIVERY.md)（数据任务与自动化）、[PROJECT-OVERVIEW.md](PROJECT-OVERVIEW.md)、
> [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md)（`steam-status` 任务）、
> [TODO.md](TODO.md)。

## 1. 现象

所有者反馈"游戏两天没同步"。2026-11-05 生产只读诊断：

| 证据 | 值 |
|---|---|
| 容器启动 | `2026-11-05T05:31:26Z`（13:31 北京）——**只跑了 1.4 小时，不是两天**；之前被 v1.15.2 / v1.16.0 两次发版重启 |
| 正在运行的子进程 | `node /app/src/cli.js sync steam-prices --limit 200000`，已跑 **91 分钟** |
| `data/scheduler-status.json` | `updatedAt` 停在启动时刻 `05:31:28Z`，**所有任务 `lastRunAt: null`** |
| 日志 | 13:31:58 只有一条 `scheduler.job_start`（steam-prices），之后无任何任务启动 |
| 数据 | `steam_status`：null 174,976 / free 23,251 / not_found 331；最近判定 `11-04T09:30Z` |

## 2. 根因

**调度器主循环被重任务阻塞**（`src/scheduler.js:536-538`）：

```js
running.add(job.name);
const { code } = await runJob(job);   // runJob 只在子进程 exit 时 resolve（:360-387）
completeJob(job, code);
```

- `steam-prices` 每天扫全部有 Steam 报价的游戏（10.6 万，30/批 + 1100ms ≈ **90 分钟以上**）；
- 这段时间内 tick 循环停在 `await`，**其它任务无法派发**（含 60 分钟周期的 `sonkwo`、每日的 `alerts`/`steam-accounts`）；
- 状态文件只在启动与任务完成时写（`:424`、`:484`），所以运维看不到"调度器在跑但卡住"。

**次要问题**：

1. `steam-status` 不在 `STEAM_HEAVY`（`:224`），会走轻任务分支**并行**打 Steam，与配额互相抢（与它自己的注释"互斥串行"矛盾）；
2. `lastRunMs` 只在内存 → **每次发版重启，所有任务重新计时**；`steam-status` 首轮延迟 6 小时，频繁发版时永远轮不到；
3. `steam-status` 周期 7 天 × 上限 8000 → 17.5 万条要 5 个月。

## 3. 方案

### P0-1 重任务改为「非阻塞发射 + 全局单槽」

保留"同一时刻只有一个 Steam 重任务"的语义，但**不阻塞 tick**：

```js
let heavySlot = null;          // 当前占用的重任务名
const launchHeavy = (job) => {
  heavySlot = job.name;
  running.add(job.name);
  runJob(job)
    .then(({ code }) => completeJob(job, code))
    .catch((err) => { logger.error('scheduler.job_unexpected', { job: job.name, err }); completeJob(job, -1); })
    .finally(() => { heavySlot = null; wake(); });   // 结束时立即唤醒 tick，不用等到下个 sleep
};
```

- tick 循环里改成 `if (heavySlot) continue; launchHeavy(job);`，**不再 await**；
- 轻任务循环保持不变，于是 `sonkwo`/`gog`/`alerts` 在 `steam-prices` 运行期间照常跑；
- 熔断、`sync_runs` 互斥、子进程 kill 等逻辑不变。

### P0-2 `steam-status` 归入 `STEAM_HEAVY`

`STEAM_HEAVY` 增加 `'steam-status'`，并在 `test/scheduler.test.js` 断言（防回归）。

### P1-1 首轮延迟与重启恢复

- `lastRunMs` 启动时从 `sync_runs` 里按 `mode` 读最近一次 `started_at` 恢复（按 mode 名匹配 `steam-prices` / `steam-status` …），
  而不是一律 `null`；
- 无历史记录的任务保留 `initialDelaySec`，但 `steam-status` 首轮延迟从 21600s 降到 **600s**（10 分钟）。

### P1-2 `steam-status` 节奏

- `steamStatus.intervalMin` 默认 **1440**（每天）而不是 10080；
- `steamStatus.limit` 默认 **12000**（约 5 小时/天）；
- 效果：17.5 万 ≈ **2 周**补完，期间与其它 Steam 任务串行、不抢配额。

### P2 状态文件每个 tick 刷新

`writeStatusFile(...)` 移到 while 循环末尾（每 tick 一次），`updatedAt` 能反映调度器存活；
`running` 集合据此在页面上显示"正在跑的任务"。

## 4. 影响面

| 文件 | 改动 |
|---|---|
| `src/scheduler.js` | 重任务非阻塞发射 + `heavySlot`；`STEAM_HEAVY` 加 `steam-status`；`lastRunMs` 启动恢复；每 tick 写状态文件 |
| `src/settings.js` | `steamStatus.intervalMin` 默认 1440、`steamStatus.limit` 默认 12000 |
| `test/scheduler.test.js` | 断言：重任务集合含 `steam-status`；`steam-prices` 运行期间轻任务仍可发射；`lastRunMs` 恢复逻辑 |
| 文档 | `DELIVERY.md` 数据任务表（steam-status 每天）、`PROJECT-OVERVIEW.md`、`CHANGELOG.md` |

## 5. 验收

1. 人为让 `steam-prices` 跑（或模拟长任务）：期间 `sonkwo`/`alerts`/`steam-accounts` **仍按周期执行**，日志有它们的 `scheduler.job_start`。
2. 同一时刻**最多一个** Steam 重任务在跑（`running` 集合与日志可验证）。
3. 重启容器后，`scheduler-status.json` 的 `nextRunAt` 不再全部从 0 重新计时（有历史的任务按记录恢复）。
4. `steam-status` 首轮在启动后约 10 分钟内触发；之后每天一轮、每轮 12000 条。
5. `scheduler-status.json` 的 `updatedAt` 每 tick 刷新（与当前时间相差 ≤ tickMs）。
6. `npm test` 全绿（`test/scheduler.test.js` 新增断言）、`npm run frontend:build`、`npm run scan`。

## 6. 已确认的决策（2026-11-05）

| # | 决策 |
|---|---|
| 1 | `steam-status` **每天一轮、每轮 12000 条**（约 5 小时/天），17.5 万约 2 周补完 |
| 2 | `steam-prices` **本批不动**（仍每天 90 分钟+），缩量按 [TODO.md](TODO.md) 的"热点优先 + 冷门降频"单独优化 |
