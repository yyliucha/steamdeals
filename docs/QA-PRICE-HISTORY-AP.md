# QA：价格历史报表（AP 批，第 1 轮）

> 基线 f489563 → HEAD 282d018；判据 docs/PRICE-HISTORY-REPORT.md §6；开发描述来源 docs/PRICE-HISTORY-REPORT.md §7。
> 结论：✅ 放行 —— 通过 8 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AP | 指标条：区间最低 / 区间最高 / 当前较史低 / 记录天数 | 游戏详情 → 价格历史 | ✅ | `PriceHistoryReport.vue`（`rangeMin/rangeMax/curVsHist/filtered.length`） |
| 2 | AP | 范围切换：近 30 天 / 近 90 天 / 全部（锚点=最后一条记录日） | 同上 → tab | ✅ | `range` ref + `filtered`（按最后记录日倒推） |
| 3 | AP | 手写 SVG 趋势线，史低点绿点 + 悬停提示 | 同上 → 图表 | ✅ | `chart` computed + `<svg viewBox>` + `<circle><title>` |
| 4 | AP | 表格：日期/当日最低/较前一日/标记，史低行整行高亮 + 徽标，每页 10 条 | 同上 → 表格 | ✅ | `rows`（含 `chg` 与 `isLow`）、`phr-table tr.low`、PAGE_SIZE=10 |
| 5 | AP | 「较前一日」与上一条有记录的日期比较（金额+百分比，持平/首条） | 同上 | ✅ | `rows` 内 `prev = list[i-1]` 分支 |
| 6 | AP | 当前等于史低显示「已是史低」 | 指标条 | ✅ | `curVsHist`（`cur<=histLow → 已是史低`） |
| 7 | AP | 移动端卡片列表，史低卡绿边 | 手机详情 | ✅ | `isNarrow` + `phr-cards`/`phr-card.low` |
| 8 | AP | 无前端导出按钮，后端 CSV 不动 | 全站 | ✅ | 组件无导出文案；`HISTORY_CSV_ENABLED` 未改 |
| 9 | AP | 深/浅色主题对比度 | 页面 | 🔎 | 全部用语义 token；需目视 |

## 逐条核对（规格 §6 → 证据）

| # | 条目 | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | 指标条四值正确、等于史低显示已是史低 | 读代码 | `curVsHist` / `rangeMin` / `rangeMax` | ✅ |
| 2 | 区间切换同步、锚点=最后记录日 | 读代码 | `filtered` 用 `lastDay` 倒推 30/90 天 | ✅ |
| 3 | 所有史低日高亮 + 徽标 | 读代码 + 单测 | `isLow: p.price_cents===histLow`；`phr-table tr.low`；静态断言含「史低」 | ✅ |
| 4 | 较前一日正确、持平/首条 | 读代码 | `chg` 三分支（↓/↑/持平/—） | ✅ |
| 5 | 每页 10 条翻页 | 读代码 | PAGE_SIZE=10 + `phr-pager` | ✅ |
| 6 | 趋势线点与日期对应、史低点绿点 | 读代码 | `chart.points` 按区间生成，`circle` 用 `filtered[i]` 坐标 | ✅ |
| 7 | 单条只画点 | 读代码 | `list.length===1 → x=W/2` | ✅ |
| 8 | 移动端卡片 | 读代码 + 单测 | `isNarrow`（matchMedia 760）+ `phr-cards` | ✅ |
| 9 | 无导出按钮 | 单测 | `assert.doesNotMatch(c, /导出/)` | ✅ |
| 10 | npm test / frontend:build / scan | 重跑 | 全链到 secrets.test.js 5/5；build ✓；scan 干净 | ✅ |

## 打回清单

无。

## 需人工确认

- 深/浅色主题下图表与高亮的对比度、移动端卡片观感需页面目视。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：✅ 放行（通过 8 / 缺失 0 / 偏差 0 / 需人工确认 1）。
