# QA：异常审核按 IP 合并视图（AR 批，第 1 轮）

> 基线 62d39c6 → HEAD 0aa6842；判据 docs/ADMIN-REVIEW-LISTS.md §4.4；开发描述来源 docs/ADMIN-REVIEW-LISTS.md §4。
> 结论：✅ 放行 —— 通过 7 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AR | 待审列表「按 IP 合并」开关（默认关，记住选择） | 后台 → 访问记录 → 异常审核 → 开关 | ✅ | `AdminModules.vue`（`admin.reviewMerge` + `onMergeToggle` + localStorage） |
| 2 | AR | 同一 IP 多条规则合成一行（规则摘要/总次数/首次→最近/设备数/状态） | 合并视图 | ✅ | `sortedMergedReviews` 聚合（`ruleMap`/`hitsTotal`/`devices`/`status`） |
| 3 | AR | 展开行看每条规则明细（规则/次数/路径/时间/状态） | 合并视图 → 展开 | ✅ | `type="expand"` + `merged-detail-row` |
| 4 | AR | 封 IP / 封设备 / 忽略作用于该 IP 全部待审记录，弹窗写明条数并要求输入确认 | 合并视图 → 操作 | ✅ | `mergedAct`（确认文案含 N 规则/M 命中/K 设备/共 X 条 + `confirmCount`） |
| 5 | AR | 勾选合并行 → 操作条显示「已选 N 个 IP · M 条待审」，批量执行 | 合并视图 → 勾选 | ✅ | `mergedPicked`/`mergedPickedCount`/`runMergedBulk`（复用 `/api/admin/bulk`） |
| 6 | AR | 关掉开关回到明细视图，排序/筛选状态保留 | 开关 | ✅ | `v-if="!reviewMerge"` / `v-else` 双表结构，排序状态各自持久化 |
| 7 | AR | 移动端每张卡一个 IP，展开/处置可用 | 合并视图（手机） | ✅ | `v-else` 卡片列表（`pagedMergedReviews`） |
| 8 | AR | 大表排序性能 | 线上 | 🔎 | 与 AQ 同款「先看 EXPLAIN」口径，上线后抽查 |

## 逐条核对（规格 §4.4 → 证据）

| # | 条目 | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | 合并后规则摘要/总次数/首末时间/设备数正确 | 读代码 | `sortedMergedReviews`：`ruleMap.set(r.rule, +1)`、`hitsTotal` reduce、`firsts[0]`/`days[last]`、fingerprint/device_id 去重 Set | ✅ |
| 2 | 展开可见每条规则的次数/路径/时间/状态/指纹 | 读代码 | expand 模板遍历 `row.rows`，含 `r.hits`/`r.path`/`dateTime(r.last_seen)`/状态 tag | ✅ |
| 3 | 状态混合显示「部分已处理」；只看待审时只统计 pending | 读代码 | `status: pending.length ? 'pending' : (… 'auto_banned' : 'partial')`；`pendingIds`/`pendingCount` 只看 pending | ✅ |
| 4 | 处置范围=全部待审、弹窗条数与实际一致 | 读代码 | `mergedAct` 用 `row.pendingIds`，提示含计数并要求输入相等数字；封设备按指纹去重 | ✅ |
| 5 | 勾选合并行批量栏显示 IP 数与记录数 | 读代码 | `merge-bar`：`已选 {{ mergedPicked.size }} 个 IP · {{ mergedPickedCount }} 条待审` | ✅ |
| 6 | 关开关回明细、状态保留 | 读代码 | 扁平表 `v-if="!isMobile && !reviewMerge"`、卡片 `v-else-if="!reviewMerge"`；`reviewSort`/`mergedSort` 分 key 存 localStorage | ✅ |
| 7 | 移动端卡片化 | 读代码 | `v-else` 卡片块遍历 `pagedMergedReviews`（IP/首末时间/摘要/状态/操作） | ✅ |
| 8 | npm test / frontend:build / scan | 重跑 | `npm test` 全链到 secrets.test.js 5/5；`npm run frontend:build` ✓；`npm run scan` 干净；`node test/admin-review-lists.test.js` 6/6 | ✅ |

## 打回清单

无。

## 需人工确认

- 合并开关/展开行/操作条的实际交互与视觉（表头排序箭头、勾选回显、弹窗文案）需页面目视。
- 大表（500 行）聚合性能与分页体感，上线后抽查。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：✅ 放行（通过 7 / 缺失 0 / 偏差 0 / 需人工确认 1）。
