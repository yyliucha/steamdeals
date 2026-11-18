# QA：异常审核「按 IP 合并」定为默认唯一视图（AX 批，第 1 轮）

> 基线 e0cb9f9 → HEAD 736e919；判据 docs/ADMIN-REVIEW-LISTS.md §4.4（修订口径 §4.5）+ 开发描述验收要点 1–5；开发描述来源 docs/TODO.md AX 条目。
> 结论：✅ 放行 —— 通过 5 / 缺失 0 / 偏差 0 / 需人工确认 1（真机目视：桌面展开交互与移动端卡片）

## 功能清单（本批交付的全部功能，一条功能一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AX | 进入「异常审核」直接是合并视图，页面上没有「按 IP 合并」开关，源码不再出现 `admin.reviewMerge` | 控制台 → 访问记录 → 异常审核 | ✅ 已交付 | AdminModules.vue:33,117,139；test/admin-review-lists.test.js:54-59 |
| 2 | AX | 同一 IP 多条规则合并一行：规则摘要/总次数/首次→最近/设备数/状态（待审·已封禁·部分已处理）；展开看每条规则 | 同上 | ✅ 已交付 | AdminModules.vue:33（合并表+展开列）、sortedMergedReviews 聚合（:146-193 区域） |
| 3 | AX | 处置一律按整 IP（封 IP/封设备/忽略作用于该 IP 全部待审记录），确认弹窗写明条数并输入确认；批量栏「已选 N 个 IP · M 条待审」 | 同上 | ✅ 已交付 | AdminModules.vue:33（merge-bar）、195-231（mergedAct 确认条数）、222-246（runMergedBulk） |
| 4 | AX | 只看待审 / 全部（审计）切换正常；合并视图表头排序（admin.reviewMergeSort 持久化）、分页保留；移动端卡片化（每卡一个 IP） | 同上 | ✅ 已交付 | AdminModules.vue:33（select + 移动卡片 v-for pagedMergedReviews）、142-146（mergedSort 持久化） |
| 5 | AX | 明细表与逐条处置（reviewAction/ignoreReview/sel.reviews/reviewsBulkActions）完全移除，无后端改动 | 前端 | ✅ 已交付 | test/admin-review-lists.test.js:57-59（doesNotMatch）；AdminModules.vue 无残留（grep 验证） |

## 逐条核对（开发描述验收要点 → 证据）

| # | 条目（验收要点） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 进入即合并视图、无开关、源码无 `admin.reviewMerge` | 静态断言 + grep | test/admin-review-lists.test.js:55-57（`doesNotMatch /active-text="按 IP 合并"/`、`doesNotMatch /admin\.reviewMerge(?!Sort)/`）；AdminModules.vue:117/139（注释已改措辞，无裸键） | ✅ |
| 2 | 合并行字段正确、展开看每条规则 | 静态断言（聚合逻辑保留）+ 测试 | test:60-71（mergedReviewsTable、ruleMap、pendingIds、部分已处理、merged-detail-row CSS）；聚合逻辑 sortedMergedReviews 原样保留（rules 按 hits 降序/hitsTotal/firstSeen/lastSeen/devices/status） | ✅ |
| 3 | 整 IP 处置与确认弹窗条数一致；批量栏可用 | 静态断言 | test:62-66,72-73（runMergedBulk、mergedAct、promptBulkConfirm(ids.length)、「已选 {{ mergedPicked.size }} 个 IP」）；mergedAct 弹窗写明「N 条规则 / M 次命中 / K 个设备（共 X 条记录）」并要求输入条数（AdminModules.vue:202-210） | ✅ |
| 4 | 筛选/排序/分页/移动端卡片不回归 | 静态断言 + 主链 | test:56（`prop="ip" sortable` 等排序接线）、:64（mergedPageSize）、:72（移动卡片 v-for pagedMergedReviews）；`npm test` exit 0 | ✅（真机目视见 🔎） |
| 5 | npm test 全绿（断言已改）、frontend:build、scan 干净 | 亲自重跑 | `npm test` → 75 个文件 exit 0；`frontend:build` → ✓ built in 1.29s；`scan` → ✅ 无命中 | ✅ |

## 纪律固定检查项

1. `git tag --list`：无新增 tag（最新 v2.6.0）✅
2. diff 未碰部署/服务器配置 ✅
3. 构建产物未进提交 ✅
4. 已推 main（736e919）✅
5. docs/PROJECT-OVERVIEW.md 已同步（AR/AX 行合并更新）✅

## 查多（风险提醒，不判错）

- `test/admin-bulk.test.js` 的「11 个列表」计数随明细表移除改为「10 表格 + 通知 + 合并视图」（勾选列 8→7、BulkBar 9→8）——是本批预期变化，非范围外改动。
- `reviews.test.js` 的「状态列悬停提示（reviewStatusHint）」断言改为「合并展开行保留逐条规则明细」——reviewStatusHint 随明细表删除，属规格 §4.5 明确要求的删除。
- 后端零改动：`/api/admin/reviews`、`POST /api/admin/bulk`（reviews/approve-ip|approve-device|reject）接口与上限均未动。

## 需人工确认

- 真机目视：桌面合并表展开行交互、移动端（≤760）每卡一个 IP 的卡片布局与展开；本地无浏览器环境，静态结构已核对。

## 打回清单

- 无。

## 复检记录

- 第 1 轮（2026-11-10）：初检即 ✅ 放行，无需复检。
