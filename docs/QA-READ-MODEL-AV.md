# QA：首页列表读模型 game_region_snapshot（AV 批，第 1 轮）

> 基线 b1464e4 → HEAD 9d588fe；判据 docs/READ-MODEL.md §9 验收 1–12；开发描述来源 docs/TODO.md AV 条目。
> 结论：✅ 放行 —— 通过 12 / 缺失 0 / 偏差 0 / 需人工确认 3（性能与 EXPLAIN 属上线后外部实测）

## 功能清单（本批交付的全部功能，一条功能一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AV | 首页列表改读读模型（价格/折扣/Steam 价/平台标签/史低/新史低入库时算好），不再每次请求全库聚合 | `POST /api/games/search`（compact）/ `GET /api/games`（非 compact） | ✅ 已交付 | pg.js:1365-1445（读模型分支）、789-823（DDL+索引） |
| 2 | AV | 「有价游戏出现在列表」口径不变（有历史或有报价的游戏有快照行） | 列表 | ✅ 已交付 | pg.js:825-873（回填 offers ∪ daily 并集）、1304-1312 |
| 3 | AV | 采集写一次新价 → 列表价格同一轮可见 | 采集 → 首页列表 | ✅ 已交付 | ingest.js:103,131；test/game-search-read-model.test.js:188-207 |
| 4 | AV | 「新史低」角标：今天出新低亮、跨天首次写入 prev 正确切换（前端沿用 prev_hist_low 字段） | 首页卡片 | ✅ 已交付 | pg.js:935-967（日界切换）；Home.vue:33,70（角标条件不变）；测试 :209-241 |
| 5 | AV | `/api/games/count` 改读快照 + 60 秒缓存（priced 跨区服去重口径不变） | 首页实时数量 | ✅ 已交付 | server.js:281,971-985 |
| 6 | AV | 合并游戏后 from/to 两侧快照正确（级联删除 + 价格/史低取并集） | 后台合并 | ✅ 已交付 | pg.js:2809-2814；测试 :243-263 |
| 7 | AV | 禁用/回收站/成人（hide）游戏不进列表 | 列表筛选 | ✅ 已交付 | 测试 :265-278 |
| 8 | AV | 迁移表空时一次性回填（失败不吞异常，日志 readmodel.backfill_*） | 启动迁移 | ✅ 已交付 | pg.js:443-457,825-873；DEPLOY.md:51-57 |
| 9 | AV | `readmodel check --sample 200 [--fix]` / `rebuild [--region]` 对账与重建 | CLI | ✅ 已交付 | cli.js:2073-2100；pg.js:2829-2907 |
| 10 | AV | 每日 `readmodel` 调度任务（抽样 200 对账，差异记任务失败可观测） | 调度器 | ✅ 已交付 | scheduler.js:117-124；test/scheduler.test.js:69-100 |
| 11 | AV | `READ_MODEL=legacy` 环境变量一键回滚旧 SQL（表保留） | 运维 | ✅ 已交付 | pg.js:1304；测试 :305-319 |
| 12 | AV | 新旧实现结果一致（20 组筛选组合 total 与首页顺序），写入/对账有测试锁住 | 测试 | ✅ 已交付 | test/game-search-read-model.test.js（8 项入主链） |

## 逐条核对（规格 §9 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 列表 TTFB P95 < 150ms（默认筛选） | 代码层核对 + 上线实测 | 读模型查询无全库 CTE（pg.js:1365-1445）；性能数字待上线后外部实测 | 🔎 需人工确认（本地无生产数据量，无法测 TTFB） |
| 2 | `q=zzzz` 零命中 < 150ms | 同上 | 同上（成本与结果无关的问题由 count 走快照 join 解决） | 🔎 需人工确认 |
| 3 | `/api/games/count` < 30ms（首次未命中缓存 <100ms） | 代码层 + 上线实测 | server.js:978-982（快照 count + 60s 缓存） | 🔎 需人工确认 |
| 4 | EXPLAIN 无 daily_prices 聚合、无全表 offers 聚合 | 静态核对读模型 SQL + 上线 EXPLAIN | 读模型分支：`join game_region_snapshot`，无 price_rollup/daily_rollup（pg.js:1365,1439；旧 CTE 仅存在于 legacy 回滚分支，属预期） | ✅（代码层）+ 🔎（线上 EXPLAIN 待部署后复核） |
| 5 | 新旧实现 20 组组合 total 与第一页 id 顺序完全一致 | 跑 test/game-search-read-model.test.js | 8/8 通过，20 组合（sort×type×released×marks×关键词×游客/登录 + 非 compact）逐一断言 total/pages/ids 相等 | ✅ |
| 6 | 新史低角标：今天写新低亮；跨天首次写入 prev_hist_low 正确切换 | 数据层测试 + 前端接线静态核对 | 测试 :209-241（prev 滚动 9900→保持，c2c 不进史低但日界照切）；Home.vue:33,70 角标条件 `current_low < prev_hist_low` 与旧口径一致 | ✅ |
| 7 | 合并游戏后 from/to 快照正确 | 测试 | 测试 :243-263（from 级联删除、to 价 5000=并集最低、史低/prev 4000） | ✅ |
| 8 | 禁用/回收站不出现；详情页/价格历史/后台报表不受影响 | 测试 + 主链 | 测试 :265-278；详情走实时 offers 未套读模型（规格决策 5）；`npm test` exit 0（含 api.test.js 22 项、report/pg/merge 全绿） | ✅ |
| 9 | 采集写一次新价 → 快照同一轮更新 | 测试（ingestOffers 真实路径） | 测试 :188-207（同轮 price/hist 更新、同日 prev 不动） | ✅ |
| 10 | `readmodel check --sample 200` 对账 0 差异 | 测试 | 测试 :280-303（正常 0 差异；corrupt 后发现、--fix 修复、rebuild 兜底后 0 差异） | ✅ |
| 11 | npm test 全绿（新测试进主链）、frontend:build、scan 干净 | 亲自重跑 | `npm test` → 75 个文件 exit 0；`frontend:build` → ✓ built in 1.00s；`scan` → ✅ 无命中；game-search-read-model.test.js 已入 package.json 主链 | ✅ |
| 12 | docs.test.js 无断链；PROJECT-OVERVIEW / DEPLOY 同步 | 主链 + 文档核对 | docs.test.js 在主链内绿；PROJECT-OVERVIEW AV 行 + 数据概念、DEPLOY 回填窗口/回滚/对账说明已补 | ✅ |

## 纪律固定检查项

1. `git tag --list`：无新增 tag（最新 v2.5.0，属 AU 批）✅
2. diff 未碰部署/服务器配置（DEPLOY.md 仅文档说明，无 compose/凭据）✅
3. 构建产物未进提交（无 dist/logs/pgdata/out）✅
4. 已推 main（9d588fe）✅
5. docs/PROJECT-OVERVIEW.md 已同步 ✅

## 查多（风险提醒，不判错）

- 既有测试的原始 SQL 种价点（api/steam-accounts/wishlist-push/store-browse/steam-status）补了 `refreshGameRegionPrices`/`refreshGameRegionHist` 调用——生产路径不受影响（唯一写入口 ingestOffers 已接线，steam-status 写价也走 ingestOffers）。
- `refreshGameRegionHist` 现在会先补齐 daily-only 游戏的行（与回填「daily ∪ offers」语义一致），对 mergeGames 是增强不是破坏。
- 工作区另有未跟踪的 `docs/NGINX-PERF.md`（部署侧 gzip 另批）未纳入本提交，属预期。

## 需人工确认

- 验收 1/2/3（性能数字）：本地 pglite 无 19.6 万行/千万级 daily 数据，TTFB 与 count 延迟必须**上线后**按规格 §9 同口径实测（curl 或浏览器网络面板 P95）。
- 验收 4 后半：上线后对列表 SQL 跑 `EXPLAIN`，确认命中 `grs_region_*` 索引或对快照的 hash join、无 daily_prices/全表 offers 聚合。

## 打回清单

- 无。

## 复检记录

- 第 1 轮（2026-11-09）：初检即 ✅ 放行（3 项性能类转上线实测），无需复检。
