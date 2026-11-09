# QA：同步吞吐批（AC-3 批，第 1 轮）

> 基线 976b6c9 → HEAD 0377606；判据 [docs/SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md) AC9/AC4 + [docs/TODO.md](TODO.md) AC 段；
> 开发描述来源：开发会话汇报（df5aa30 代码 + 0377606 文档）。
> 结论：✅ 放行 —— 通过 9 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/接口/行为） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AC-3 | 回填队列新游戏优先（按收录时间倒序），新游戏不再排在数周后 | backfill / steamall 自动任务 | ✅ | cli.js（两处 `order by g.created_at desc nulls last, g.id desc`）；test/scheduler.test.js:433 |
| 2 | AC-3 | 每周回填上限 2 万 → 5 万 | 调度任务默认参数 | ✅ | scheduler.js（STEAM_BACKFILL_LIMIT 50000）；test:433 |
| 3 | AC-3 | 每日 Steam 配额预算：prices+heat+status+backfill(周摊) 串行估算 | 调度器启动/设置重载 | ✅ | scheduler.js（steamDailyBudgetMinutes）；test:417 |
| 4 | AC-3 | 总时长超 24h 自动降频（缩 steam-status 限额，至少保留 2 小时）并告警 | 调度器 | ✅ | scheduler.js（applySteamBudget + scheduler.budget_exceeded）；test:417 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | AC9 回填按 created_at/catalog 时间排序（新游戏优先） | 静态断言两处 + 单测 | cli.js；test/scheduler.test.js:433-438 | ✅ |
| 2 | AC9 提高 backfill 上限（Q4 已确认） | 默认参数断言 50000 | scheduler.js:81；test/scheduler.test.js:98 | ✅ |
| 3 | AC4 每日预算 <24h（默认配置） | 单测：默认 total ≤1440 | test/scheduler.test.js:417-421 | ✅ |
| 4 | AC4 超了自动降频并告警 | 单测：抬 heat 后 adjusted=true、新限额 < 原值、调整后回预算内、告警事件 | test:422-432 | ✅ |
| 5 | AC4 启动与设置重载都过预算 | 代码两处调用 | scheduler.js:551、:688 | ✅ |
| 6 | 预算口径与任务实现一致（每 30 款 1.1s / 每款 1.7s / 2 请求×rate / 周摊） | 代码注释与公式核对 | scheduler.js（steamDailyBudgetMinutes） | ✅ |
| 7 | npm test 全绿 + build + scan | 亲自重跑 | npm test 66 文件/539 项 fail 0；build ✓；scan 干净 | ✅ |
| 8 | 纪律：无新 tag / 无产物入提交 / 已推 main / OVERVIEW+DELIVERY 同步 | git 取证 | 无新 tag；origin/main=0377606 | ✅ |
| 9 | 已解锁 AC-4（TODO 状态从依赖阻塞 → 待开发） | TODO 状态行 | docs/TODO.md AC 段 | ✅ |

## 亲自重跑验证（2026-11-09）

```
npm test               → 66 个文件 / pass 539 / fail 0
npm run frontend:build → ✓
npm run scan           → ✅ 未发现高置信度凭据 / 未发现可疑密钥赋值
```

## 打回清单

无。

## 需人工确认

- 上线后观察：新进目录的游戏在下一轮 backfill 是否先于老游戏出现价格/说明（真实 Steam 数据）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：初检即通过，无打回项。
