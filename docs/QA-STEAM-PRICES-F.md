# QA：Steam 价格同步优化（F 批，第 1 轮）

> 基线 7ce4919 → HEAD f32e2b9；判据 docs/TODO.md F 段（①限速 ②热点优先+冷门降频）；开发描述来源 docs/TODO.md F 段。
> 结论：✅ 放行 —— 通过 5 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | F | Steam 价格刷新限速 1100→1600ms（落回 200 次/5 分钟配额内） | 定时任务 `steam-prices` / 后台同步按钮 | ✅ | `cli.js`（`rateLimitMs: 1600`）、`test/steam-prices-priority.test.js` |
| 2 | F | 热点游戏每天刷：近 90 天有访问 / 有用户标记 / 热度≥1 | 同上（选取逻辑） | ✅ | `cli.js` 选取 SQL（`is_hot`：page_views 90d / user_game_flags / `coalesce(g.heat,0) >= $2`） |
| 3 | F | 冷门游戏降频：最近价格快照超过 3 天未更新才刷 | 同上 | ✅ | `make_interval(days => $3)` + `last_snap < now() - …` |
| 4 | F | 排序：热点优先、冷门按最久未更新优先 | 同上 | ✅ | `order by t.is_hot desc, t.last_snap asc, t.steam_appid` |
| 5 | F | 阈值可调（环境变量） | 部署配置 | ✅ | `STEAM_PRICES_HOT_HEAT_MIN`（默认 1）、`STEAM_PRICES_COLD_DAYS`（默认 3） |
| 6 | F | 线上实际请求量与配额余量 | 线上 | 🔎 | 需部署后看 `steam-prices` 一轮的请求数与 429 频率 |

## 逐条核对

| # | 条目 | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | 限速收紧 | 读代码 + 静态测试 | `rateLimitMs: 1600`；测试断言 1100 不再出现 | ✅ |
| 2 | 热点定义三选一 | 读代码 | `exists(page_views 90d) or exists(user_game_flags) or heat >= $2` | ✅ |
| 3 | 冷门 3 天降频 | 读代码 | `where t.is_hot or t.last_snap < now() - make_interval(days => $3)` | ✅ |
| 4 | 快照时间口径 | 读代码 | `price_snapshots.captured_at` 经 `offers` 关联到 `game_id`（`po.platform_code='steam'`） | ✅ |
| 5 | 不动调度器 | 读代码 | 只改 `cmdSyncSteamPrices`，未动 `jobsFromEnv`/`scheduler.js` | ✅ |
| 6 | npm test / scan | 重跑 | 全链到 secrets.test.js 5/5；`npm run scan` 干净 | ✅ |

## 打回清单

无。

## 需人工确认

- 部署后一轮 `steam-prices` 的实际时长与 429 出现频率（规格目标：每天请求量显著低于 10.6 万全量，且 5 分钟速率不再超 200）。
- 热点阈值（heat≥1 ≈ 二三十条评测）是否需要按线上数据调整——已留 `STEAM_PRICES_HOT_HEAT_MIN` 环境变量。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：✅ 放行（通过 5 / 缺失 0 / 偏差 0 / 需人工确认 1）。
