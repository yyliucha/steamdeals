# 成人内容统计（FH，待开发，2026-11-23）

> 所有者要求（2026-11-23）：色情游戏在大陆不允许展示，但**要能统计出来**（开源项目，国外部署可用同步）。

## 1. 需求

后台提供**只读统计**（不展示内容）：

| 指标 | 说明 |
|---|---|
| `adult_flag` 总数 | Steam 标记成人内容（descriptors 3/4 或 ESRB AO）的游戏数 |
| `mature_flag` 总数 | 成熟内容（descriptors 2/5、PEGI 18、required_age≥18） |
| 已回填/未回填 | rating-backfill 覆盖情况（`steam_status` 已判定 vs 未判定） |
| 最近回填时间 | `rating-backfill` 最近一轮（日志/任务记录） |

- 位置：后台「统计 → 图片与备份」或「同步与回填」页新增「内容分级统计」卡片（或独立区块）；
- 数据接口：复用现有统计（`pg.js` 已有 adult/mature 计数：`count(*) filter (where adult_flag)` 等）；
- **只显示数字**，不提供成人内容列表/查询入口。

## 2. 验收

1. 后台统计卡片显示 adult/mature 总数、回填覆盖、最近回填时间；
2. 数字与 `/api/games` 的 `adult=hide`/`badge` 差值一致（抽查）；
3. 无成人内容列表/查询入口（配合 FG）；
4. `npm test`（分段）+ `frontend:build` + `scan` 全绿；截图。
