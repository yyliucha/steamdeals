# 对齐审核查询拖垮站点（CN：缓存 + 候选预筛 + 单飞 + 时间预算）（已实现待发版）

> 状态：**已实现待发版（2026-11-17，5c723aa；QA 报告 docs/QA-CN.md 第 1 轮 ✅ 放行）**。
> 关联：[TODO.md](TODO.md) CN 条目、[SONKWO-STEAM-MATCH.md](SONKWO-STEAM-MATCH.md)（对齐审核页与匹配口径）、
> [SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md)（同类"整轮阻塞"教训）。

## 1. 事故与根因（2026-11-17 线上 v2.22.1）

**现象**：后台「游戏管理 → 对齐审核」查询一直转圈/超时（`align` 请求无响应），页面其它请求同时变慢
（`/api/admin/games` 2.1s、`/api/admin/sync/status` 1.7s），最终**站点容器重启**（"镜像被搞挂"）。

**根因（代码证据）**：`GET /api/admin/align` 每次请求都在 **Node 主线程**做全量重算——
`src/server.js:4181-4190` 的 `buildAlignGroups()`：

1. `select id, steam_appid, name, name_en from games where steam_appid is not null` → **约 19.6 万行**进内存（每次请求）；
2. `readAlignSkus()` → 读整份 `data/skus.json`；
3. `loadOrphanSonkwoGames()` → 杉果孤儿行 join；
4. `proposeAlignGroups(items, games)` → 对每个归一化组调 `bestMatchMulti()`；
   `bestMatchMulti`（`src/match.js`）对候选**逐条**做大分子相似度 → **组数 × 19.6 万**次比较，几十亿次字符串运算；
5. **无缓存、无 single-flight、无时间上限**：连续刷新会叠加多次全量计算。

Node 单线程被占满 → 所有 HTTP 请求排队超时 → 健康检查失败 → 容器重启。

## 2. 决策（修复方向，所有者 2026-11-17 确认"记录并排期"）

| # | 决策 |
|---|---|
| 1 | **改为"后台生成 + 缓存读"**：匹配结果在服务端缓存（TTL 10 分钟），页面直接读缓存；`?refresh=1` 才重算。 |
| 2 | **候选预筛**：不再把 19.6 万行全量喂给匹配器；按标题关键词/前缀/trigram 先收敛候选（每个标题 ≤2000 条），再打分。 |
| 3 | **single-flight + 时间预算**：同一时刻只允许一次计算（并发请求共享同一个 Promise）；单次计算硬上限（如 20s，超时返回部分结果 + `partial:true`）。 |
| 4 | **不让事件循环被独占**：匹配循环每 200 次 `await setImmediate` 分片（或移入 `worker_threads`），保证其它接口可用。 |
| 5 | **接口分页**：`GET /api/admin/align?page&pageSize=20`，只对当前页组做候选匹配；总数与自动/人工分组统计随缓存返回。 |
| 6 | 本批**不改匹配算法口径**（只改取数与调度方式），避免影响 CD/CE 已验收行为。 |

## 3. 改动落点

- `src/server.js`：`buildAlignGroups()` 改缓存 + single-flight + 分页参数；新增 `GET /api/admin/align?refresh=1`；
  计算超时返回 `partial` 与提示；后台「对齐审核」页读缓存。
- `src/align.js`：`proposeAlignGroups` 支持"候选索引"（预筛后的候选集合），并支持分片等待回调。
- `src/match.js`：新增候选预筛辅助（按关键词/前缀取候选；复用 trigram 索引 `games_name_trgm`/`games_name_en_trgm`）。
- `frontend/src/components/AlignAdmin.vue`（或对应组件）：显示"生成时间/缓存状态/刷新按钮"；`partial` 时提示。
- `test/align-perf.test.js`（新增，进主链）：候选取数、缓存命中、单飞、超时 partial、分页。

## 4. 验收

1. **缓存命中**：第二次打开「对齐审核」`GET /api/admin/align` ≤200ms（服务端日志/测试断言）。
2. **不拖垮站点**：计算进行中并发打 `/api/games/count` 与 `/api/site`，P95 不受影响（测试：模拟分片 + 并发断言）。
3. **单飞**：并发 5 个请求只触发 1 次全量计算（计数器断言）。
4. **时间预算**：超时返回 `partial:true` 与已算部分，不 5xx、不阻塞后续请求。
5. **候选预筛正确性**：CE 的 13 条误匹配样本仍不进自动候选；正确样例仍能匹配（复用 `test/match.test.js` 用例）。
6. **分页**：`page/pageSize` 生效，总数一致；刷新按钮 `?refresh=1` 生效。
7. `npm test` / `frontend:build` / `scan` 全绿；**不自行打 tag**（等「构建」指令，建议 v2.22.2 热修）。

## 5. 实施顺序

1. 缓存 + single-flight + 分页（最小改动，先止血）；
2. 候选预筛（性能根治）；
3. 分片/`setImmediate` 或 worker（保险）；
4. 前端状态提示 + 测试；
5. 部署侧观察：`align` 请求耗时、容器是否再重启。

## 6. 待确认

1. 缓存 TTL 取 10 分钟是否合适（也可"手动刷新才更新"）。
2. 是否需要同时优化 `/api/admin/games`（2.1s）与 `/api/admin/sync/status`（1.7s）——建议另开条目，不混进热修。
