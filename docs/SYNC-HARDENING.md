# 同步机制完善（FP，待开发，2026-11-25）

> 所有者反馈（2026-11-25）：详情「更新于 11-08」、折扣活动没同步、中文名缺失、后台数据陈旧。
> 排查确认根因：**sync_runs 的僵尸 running 记录导致 heavy slot 被 backup 永久占用**（backup 卡死 39 小时）→
> steam-prices/steam-status/backfill/rating-backfill 全部无限等待。所有者要求「同步机制完善」。

## 1. 根因链

| # | 问题 | 证据 |
|---|---|---|
| 1 | `backup` 卡死（全量 JSON 导出 20 万游戏，无超时保护） | sync_runs：11-24 10:55 起 `status='running'` 39 小时 |
| 2 | scheduler 启动从 DB 恢复 heavy slot（`runningSyncRun`）——僵尸记录被当成「正在跑」 | 日志 `job_wait_slot occupiedBy=backup runId=1795`，重启后仍占用 |
| 3 | heavy slot 单槽串行：backup 卡死 → 价格/状态/回填/发现全部排队 | scheduler-status 多个 `job_deferred_busy` |
| 4 | steam-status 6000/天、backfill 5000/天、rating-backfill 5000/天 —— 20 万目录 30–40 天一轮 | 参数 |
| 5 | 无时效监控 | 只能靠用户发现 |

## 2. 需求（P0 → P2）

### P0 僵尸锁修复
- `runningSyncRun` 恢复时**校验僵尸**：`status='running' AND started_at < now() - interval '2 hours'` → 自动标记 `interrupted`，
  不占用 heavy slot（阈值可用 env `SYNC_STALE_RUN_HOURS` 默认 2）；
- scheduler 启动时（或 SIGTERM 排空结束）把 DB 中所有 `status='running'` 记录标记 `interrupted`（与 EU 批对内存任务一致）；
- 日志 `scheduler.stale_run_interrupted`。

### P1 backup 稳定性
- 备份改**流式/分页写出**（避免一次性大 JSON 内存膨胀）；单轮超时（默认 30 分钟）自动中断并标记 `interrupted`；
- 备份失败不占槽（P0 已覆盖恢复；本轮保证运行中不无限卡）。

### P1 heavy 分槽/低峰
- backup / prune / logs 移至**低峰时段**（如 03:00–05:00）且使用**独立槽**，不与 steam-prices / steam-status / backfill 抢槽；
- 实现：`heavyJobs` 分组（`heavySteam` / `heavyMaint`）——两槽互不影响；同一时刻最多各一个。

### P2 提速 + 429 队列 + 初始化
- steam-status / backfill / rating-backfill 默认上限提到 **3–5 万/天**（env 可配，默认保守 20000）；
- 429 记录队列：429 的 appid 入 `sync_429_queue`，下一轮**优先补 429**；
- 后台「初始化全量同步」按钮（管理员二次确认）+ 进度卡片（总数/成功/429/剩余）。

## 3. 验收

1. 模拟僵尸：插入一条 3 小时前 `status='running'` 的记录 → 重启 scheduler → 该记录被标记 interrupted，heavy slot 空闲，steam-prices 正常开始；
2. backup 运行超过 30 分钟被中断并标记 interrupted（不永久占槽）；
3. 低峰时段 backup 不阻塞价格/状态任务（两槽独立）；
4. 提速后 steam-status 单轮 limit 可配 3–5 万（env）；
5. 429 队列与初始化按钮可用（进度可见）；
6. 后台「数据时效」卡片：价格/状态/中文名/图片 各自「超 1/3/7 天未更新」数量 + 一键补跑；
7. `npm test`（分段）+ `frontend:build` + `scan` 全绿。

## 4. 补充（2026-11-25 实测新增）

### 4.1 429 冷却策略
- 现状：`http.rate_limit_wait` 会等待完整冷却期（实测 30 分钟 `delayMs≈1798909`）——批量任务挂起占槽；
- 需求：冷却等待超过阈值（`SYNC_429_MAX_WAIT_MS` 默认 5 分钟）→ **中断本轮**（exit 75 + 标记 interrupted），
  不占 heavy slot；短冷却（≤5 分钟）才等待；日志 `sync.cooldown_abort`。

### 4.2 shape 误报（免费/下架/区域限制）
- 现状：`ingest.shape_threshold` 把「无 price_overview」的免费/下架/区域限制游戏计入 shapeMismatch → 误报 ERROR（实测 998/998，而 offers=3997/5000 正常）；
- 需求：区分「预期缺失」（免费/未发行/区域限制/未发售）与「契约漂移」（有价游戏字段缺失）；
  仅当「有价游戏」shape 缺失比例超阈值才告警；日志/后台分别统计。

### 4.3 403 处理（区别于 429）
- 现状：steam-discovery HTTP 403（代理经 Steam 风控）→ 任务失败邮件；
- 需求：403 单独退避（指数退避 + 降速）+ 连续 N 次才告警（避免单次 403 刷失败邮件）；
  discovery 类非核心任务 403 不触发失败邮件（仅日志）。
