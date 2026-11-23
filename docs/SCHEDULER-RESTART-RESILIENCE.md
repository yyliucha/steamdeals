# 定时任务重启韧性（EU，已实现并发布 v2.28.3，2026-11-23）

> 现象（2026-11-23 生产）：`steam-prices` 定时任务被服务重启打断 → `exit -1` → 判失败并发邮件
> （`Cannot use a pool after calling end on the pool` 为次生噪音）。所有者要求：
> **后续发版不要影响定时服务工作。**

## 1. 现状与问题（代码证据）

| # | 事实 | 位置 |
|---|---|---|
| 1 | 停机时对所有子进程 `SIGTERM`，5s 后 `SIGKILL`，**不等待任务完成** | `src/scheduler.js` `stop()`（约 729-741） |
| 2 | 子进程被杀 → `code=-1` → `completeJob` 判 `failed` → `job_failed` 告警 + 失败邮件 | `scheduler.js:completeJob`（约 872） |
| 3 | 失败原因查询在连接池 `end` 后执行 → `Cannot use a pool...`（try/catch 已兜底，仅噪音） | `pg.js:lastFailedSyncRun`（2733） |
| 4 | `steam-prices` 单轮 `--limit 200000`，实测 **106 分钟** | `scheduler.js` 调度表 / `cli.js sync steam-prices` |
| 5 | 重启后 `lastrun_restored` 已恢复（不重排全部任务） | `scheduler.js`（已有） |

## 2. 目标（发版不影响定时服务）

1. **发版重启不产生「任务失败」误报**：在跑任务记为「被重启中断」（interrupted），不发失败邮件；
2. **长任务不丢进度**：分批 + 断点续跑，重启损失 ≤ 一批；
3. **发版流程避让**：部署/重启前检查是否有长任务在跑，选择等待或本轮跳过（文档化 + 脚本支持）；
4. 重启后调度自动恢复（已有 lastrun 恢复，验证覆盖）。

## 3. 方案

### EU-1 中断标记（核心）
- `scheduler.stop()`：置 `stopping=true` 后，把正在跑的任务在内存/`sync_runs` 标记 `interrupted`
  （子进程 SIGTERM 处理或父进程 completeJob 依据 `stopping` 判定）；
- `completeJob`：`stopping && code!==0` → outcome `interrupted`（不记 failed、不发失败邮件、健康面板显示「被重启中断」）；
- CLI 子进程收到 SIGTERM：写 `sync_runs.status='interrupted'`（含已完成进度）后退出（若已有退出处理则补）。

### EU-2 分批 + 断点续跑（steam-prices）
- `sync steam-prices` 支持 `--batch`（默认 5000）与断点（记录 offset/游标，如 `sync_runs.meta` 或专用表）；
- 单轮时长 ≤ 10 分钟；中断后下一轮从断点继续（避免整轮重跑）。

### EU-3 发版避让（部署流程）
- 部署脚本/文档：重启前检查 `scheduler` heavy slot（`GET /api/admin/sync/status` 或进程内状态）——
  有长任务在跑 → 等待完成（最长 10 分钟）或标记跳过本轮；
- DELIVERY 部署说明更新：**发版步骤包含「等待/跳过长任务」**。

### EU-4 日志降噪
- `completeJob` 的失败原因查询在 `stopping` 时跳过（或池关闭时静默），避免 `Cannot use a pool` 噪音。

## 4. 验收

1. 模拟重启（SIGTERM app）：在跑任务 → `sync_runs`/健康面板显示「interrupted」，**不发失败邮件**；
2. `steam-prices --batch 5000` 单轮 ≤10 分钟，中断后下一轮从断点续跑（不重跑已处理部分）；
3. 部署流程文档（DELIVERY/部署脚本）包含「长任务避让」步骤；
4. 重启后调度恢复正确（`lastrun_restored`，不重排）；
5. `npm test`（分段）+ `scan` 全绿；无 schema 变更（如新增 sync_runs.status 枚举值需兼容）。

## 5. 边界

- 不改任务调度频率/顺序；不改 heavy slot 策略；
- 断点续跑只对 steam-prices（其它长任务按需后续扩展）；
- 部署避让以「文档 + 脚本建议」落地，不强制改 CI 门禁。

### EU-5 排空（drain）——发版零中断

- scheduler 收到 SIGTERM：**不再启动新任务** + 等待在跑任务完成（`drainTimeout` 默认 10 分钟）；
- 超时才 SIGKILL（被超时杀掉的任务标 interrupted，走 EU-1）；
- compose 的 scheduler service 设置 `stop_grace_period: 10m`（给排空留时间）；
- 发版脚本按 EV §6 的顺序执行：app 先更新 → 等 scheduler 当前任务完成 → 更新 scheduler。
