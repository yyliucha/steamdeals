# QA：后台访问/异常列表排序（AQ 批，第 1 轮）

> 基线 fc4f886 → HEAD 8a20304；判据 docs/ADMIN-REVIEW-LISTS.md §3.4；开发描述来源 docs/ADMIN-REVIEW-LISTS.md §3。
> 结论：✅ 放行 —— 通过 5 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AQ | 异常审核表头排序（最近出现 / IP / 次数 / 规则，默认最近出现↓） | 后台 → 访问记录 → 异常审核 → 点表头 | ✅ | `AdminModules.vue`（`sortable="custom"` ×4 + `:default-sort="reviewSort"`）、`ipSort.js:21` |
| 2 | AQ | IP 按数值排序（9.x→45.x→100.x→193.x，同一 IP 连续） | 两个列表 | ✅ | `ipSort.js:30-47`、`test/ip-sort.test.js`（4 项全绿） |
| 3 | AQ | 访问明细表头排序（时间 / IP / 结果，服务端白名单） | 后台 → 访问记录 → 访问明细 → 点表头 | ✅ | `pg.js:1706 visitorOrderClause`、`server.js`（`['time','ip','status'].includes(rawSort)`）、`test/admin-review-lists.test.js` |
| 4 | AQ | 排序状态刷新后保留；换排序回到第 1 页、筛选不丢 | 同上 | ✅ | `AdminModules.vue`（`loadSortState/saveSortState` + `localStorage['admin.reviewSort'/'visitorSort']`、`onVisitorSortChange→loadVisitors(1)`） |
| 5 | AQ | 待审拉取上限 300 → 500 + 列表头计数 | 后台 → 异常审核 | ✅ | `pg.js`（`Math.min(…,500)`）、`server.js`（`'limit' ?? 500`）、列表头「共 N 条（上限 500）」 |
| 6 | AQ | 十万行量级访问明细排序性能不退化 | 线上 | 🔎 | 本地无生产数据；规格已定「先看 EXPLAIN 再决定加索引」，上线后抽查 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格 §3.4） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 两列表头可点，默认最近出现↓，IP 排序数值序 | grep + 单测 | `AdminModules.vue`（`prop="last_seen" sortable="custom"`、`prop="ip" sortable="custom"`）、`test/ip-sort.test.js:6-14` | ✅ |
| 2 | 同一 IP 多行连续 | 单测 | `test/ip-sort.test.js:16-22`（断言分组后相邻） | ✅ |
| 3 | 换排序回第 1 页；筛选不丢 | grep | `onVisitorSortChange`→`loadVisitors(1)`；`onReviewSortChange` 只重置 `reviewsPager.page`，不动 `reviewStatus` | ✅ |
| 4 | 刷新后排序保留 | grep | `loadSortState('admin.reviewSort'/'admin.visitorSort', …)` | ✅ |
| 5 | 非法 sort/order 回落默认 | 单测 | `test/admin-review-lists.test.js:12-15`（`visitorOrderClause('bad','asc')==='id asc'`） | ✅ |
| 6 | 十万行同量级 | — | 无生产数据；未加索引（规格 §6 说先看 EXPLAIN） | 🔎 |
| 7 | npm test / frontend:build / scan 全绿 | 重跑 | `npm test` 全链到最后一个文件 secrets.test.js 5/5（链式 && 即全绿）；`node test/api.test.js` 22/22；`npm run frontend:build` ✓ built in 1.10s；`npm run scan` 干净 | ✅ |

## 打回清单

无。

## 需人工确认

- 条目 6：访问明细按 IP 排序在大表上的实际耗时（上线后 `EXPLAIN ANALYZE` 抽查；若超阈值再补 `(blocked, ip)` 复合索引，规格已预留）。
- 排序交互的视觉与手感触达（表头箭头、点击循环升/降）需页面目视。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：✅ 放行（通过 5 / 缺失 0 / 偏差 0 / 需人工确认 1）。
