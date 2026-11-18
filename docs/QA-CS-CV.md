# QA：CS 对齐审核后台生成 + CV 查询不排除已拥有（第 2 轮）

> 基线 32886e8（站点）/ edfb8e4（App）→ HEAD 站点 2a03188 + 补充修正提交（详情列全 + 202 契约断言）、App 0945006 + 补充修正提交（详情列全）。
> 判据 = docs/ALIGN-DB-SLOW.md §2/§3（CS）与 docs/APP-SEARCH-OWNED.md §2/§4（CV）。
> 第 1 轮（2026-11-18）：✅ 放行（通过 12 / 需人工确认 2）；独立裁判 qa-cs-cv 补审提出 1 条偏差 + 1 条测试缺口，第 2 轮已修复并复检。
> 结论：✅ 放行 —— 通过 12 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口 | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | CS | 打开对齐审核立即返回「后台生成中（已处理 X/Y 组）」，完成后自动展示队列（不再 504/暂无数据） | 后台 → 游戏管理 → 对齐审核 | ✅ | server.js 202 分支；api.test 首请求 202 硬断言；冒烟 202→轮询 2 次就绪 |
| 2 | CS | 队列完整（无 partial 空结果）：前处理不计入预算、后台算完为止 | 同上 | ✅ | server.js startedAt 在索引后、budgetMs=Infinity；冒烟 total=45 无 partial |
| 3 | CS | 二次打开 ≤1s（缓存命中），连续刷新只算一次 | 同上 | ✅ | align-query.js background/run；冒烟二次 5ms；align-perf 单飞用例（反向自检变红验证） |
| 4 | CS | 计算期间全站其它接口不受影响（setImmediate 分片 + slow_query 区分事件循环阻塞） | 全站 count/site 等 | ✅（部署后 P95 🔎） | 冒烟重算期间 count/site 200；index.js eventLoopLagMs |
| 5 | CS | 文案修正：删「点刷新可继续」，改为「后台生成中…自动刷新」 | 对齐审核页 | ✅ | AlignAdmin.vue el-alert 文案 |
| 6 | CV | Web「全部/感兴趣/不感兴趣」列表与搜索包含已拥有游戏（卡片标「已拥有 账号名」） | 前台首页/搜索 | ✅（部署后目视 🔎） | Home.vue owned=include；api.test CV 用例 include 可见 |
| 7 | CV | 「已拥有」页签保持只显示已拥有 | 首页页签 | ✅ | Home.vue 仍 only |
| 8 | CV | 已拥有详情终态：只留「去 Steam 商店」+ **全部账号名列全**（Web 已有，App 对齐） | 详情页 | ✅ | App DetailScreen ownedByFullText 列全（第 2 轮修正）；Web USER-ALERTS 已实现 |
| 9 | CV | App 列表/搜索 owned=include + 卡片已拥有徽标（前 2 账号 +N，列表口径） | App 首页/搜索/卡片 | ✅ | App HomeScreen/SearchScreen/GameCard；OwnedByTextTest 6 项 |
| 10 | CV | 服务端默认口径不变（exclude），其它调用方不受影响 | /api/games/search | ✅ | pg.js gameSearch 默认未改；api.test exclude 对照 |
| 11 | CV | 详情接口 owned_by 账号名（App 消费） | /api/games/:appid | ✅ | api.test 详情断言 owned_by 账号名 |
| 12 | CV | 未登录行为不变 | 前台/App | ✅ | 游客无 owned 概念；api.test 既有游客用例仍绿 |

## 第 2 轮复检（独立裁判补审意见 → 修复 → 复检）

| 意见 | 判定 | 修复 | 复检 |
|---|---|---|---|
| CV 偏差：App 详情账号行用「前 2 +N」，规格决策 3 要求详情**列全**（Web 列全） | ⚠️ 偏差 | `ownedByFullText`（全部账号 `、` 连接）用于详情；列表徽标保持前 2 +N（决策 3 列表口径）；新增单测「详情列全——超过两个账号全部列出」 | ✅ OwnedByTextTest 6 项全绿、构建成功 |
| CS 测试缺口：api.test 未硬锁 202 契约（删 202 分支 CD 用例仍绿） | 风险级 | CD 对齐审核用例加 `firstAlignStatus` 首请求断言 202 | ✅ api.test 28/28（含 202 硬断言） |

## 验证记录（本会话亲自重跑）

- `npm test` 主链：0 fail（日志 F:\dsh\cs-cv-npmtest.log）
- `node test/align-perf.test.js`：16/16（含 CS background/进度/refresh 用例）
- `node test/api.test.js`：28/28（CV 用例 + 202 契约硬断言 + CD 对齐轮询适配）
- `npm run frontend:build` ✓；`npm run scan` ✅ 干净
- App：`gradlew testDebugUnitTest` 4 类 24 项全绿（OwnedByTextTest 6 项）；`assembleRelease` BUILD SUCCESSFUL
- HTTP 冒烟（F:\dsh\cn-e2e\http-smoke-cs-cv.mjs）：CS 202→轮询 555ms 就绪→缓存 5ms→重算期间 count/site 200；CV include/exclude 语义正确
- 反向自检：① 删 background 的 computing 复用分支 → align-perf「CS background」用例红（恢复后 16/16）；② 独立裁判 qa-cs-cv 复验 RC1 同结论、RC2（删 202 分支）→ 已用 202 硬断言补齐

## 需人工确认

1. 部署后 P95：计算期间 /api/games/count、/api/site 的实际延迟（本地 pglite 数据量小，生产 19.6 万行下分片效果需部署后观察）。
2. App 侧已拥有徽标/终态的真机目视（模拟器本轮卡在启动早期未完成走查；App 单测 + 构建 + 代码走查已覆盖自动层，真机属 R2）。

## 复检记录

- 第 1 轮（2026-11-18）：✅ 放行（通过 12 / 需人工确认 2）。
- 第 2 轮（2026-11-18）：独立裁判补审 → 修 1 偏差（详情列全）+ 补 1 测试缺口（202 硬断言）→ 复检通过，✅ 放行。
