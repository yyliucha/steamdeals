# 对齐审核二次修复：事件循环阻塞与首屏体验（CS，P0 事故追加）

> 状态：**已确认待开发（2026-11-18，EXPLAIN 复核后修正：DB 侧 91ms，瓶颈在应用事件循环）**。
> 关联：[TODO.md](TODO.md) CS 条目、[ALIGN-QUERY-PERF.md](ALIGN-QUERY-PERF.md)（CN 批：缓存/单飞/预筛/预算）、
> [SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md)。

## 1. 事故复现与修正后的根因（2026-11-18 线上 v2.24.0）

**追加现象（2026-11-18 12:09，v2.24.2 已部署）**：页面不再 504，但显示
「匹配计算超时，当前为部分结果」+「生成于 12:09:35」+ **队列「暂无数据」**（仅"自动继承 68 条"）。
**原因**：`ALIGN_BUDGET_MS=20s` 的计时起点 `startedAt` 在**前处理之前**（读 skus.json、加载 20 万行、
建候选索引、继承映射）；前处理一旦 >20s，分组循环第一次检查即 `break` → `partial=true` 且 `groups=[]`。
且页面提示「点刷新可继续」不成立——`?refresh=1` 是**从头重算**，不能续算。

现象：「对齐审核」504（nginx 60s）；日志：

```
db.slow_query sql="select id, steam_appid, name, name_en from games where steam_appid is not null"
  rows=200495 elapsedMs=30556 / 30344
```

**DB 侧复核（EXPLAIN ANALYZE，2026-11-18）**：

```
Seq Scan on games  (cost=0.00..24327.12 rows=200505 width=49) (actual time=0.016..82.028 rows=200495)
  Filter: (steam_appid IS NOT NULL)  Rows Removed by Filter: 17
  Buffers: shared hit=6805 read=15517
Execution Time: 91.086 ms
```

**修正结论**：
- **数据库不慢**：该查询 91ms；`n_dead_tup=38694`（19%）属正常，autovacuum 会处理 → **不需要建索引、不需要手工 VACUUM**；
- **30 秒来自应用侧**：老代码（v2.24.0）每次请求在 Node 主线程做「组数 × 19.6 万」的全量匹配、**无 yield**，
  事件循环被占满 → 查询完成回调被延迟，`db.slow_query` 的 `elapsedMs` 把阻塞时间也算进去 → 看起来像 DB 慢；
- **根本原因是部署缺口**：CN（缓存/单飞/候选预筛 ≤2000/20s 预算/setImmediate 分片）**没有进入 v2.24.0 镜像**
  （`v2.24.0` tag 内无 `src/align-query.js`，`2060586` 非 tag 祖先；v2.24.0 = CK + CM）。

## 2. 修复方案（按优先级）

| # | 内容 |
|---|---|
| 1 | **完成 v2.24.1 发版**（已由发版会话完成；v2.24.2 也已部署）——CN 的缓存/预筛/单飞已生效，不再 504。 |
| 2 | **预算语义修正**：`startedAt` 改为「分组匹配循环开始前」，前处理（读文件/查库/建索引/继承）不计入 20s 预算；预算只约束匹配循环。 |
| 3 | **改为后台生成（核心）**：进入页面/点刷新时**触发后台计算**（可超过 20s，用 setImmediate 分片继续），接口只读缓存；冷缓存返回 `202 {generating:true,processed}` + 前端轮询 3s；计算完成后自动展示，**不再返回"部分结果/暂无数据"**。 |
| 4 | **修正文案**：删除「点刷新可继续」；改为「后台生成中（已处理 X/Y 组），完成后自动刷新」。 |
| 5 | **观测修正**：`db.slow_query` 区分 DB 执行时间与事件循环阻塞（或同时记录 event-loop lag），避免再次误判为 DB 慢。 |
| 6 | **候选索引节流刷新（可选）**：`games` 变更后（catalog 同步完成）失效候选索引，避免每次计算重建 20 万对象。 |

## 3. 验收

1. 部署 v2.24.1 后：打开「对齐审核」不再 504；首次计算在 20s 预算内完成并出列表；
2. 第二次及以后刷新 ≤1s（缓存命中）；
3. 计算期间 `/api/games/count`、`/api/site` P95 不受影响（CN 的 setImmediate 分片生效）；
4. 日志出现 `align.computed`（含 `groups/partial/ms`）；`db.slow_query` 不再把普通查询记成 30s（若做了 #2）；
5. 连续刷新 10 次只计算 1 次（缓存/单飞断言）；
6. `npm test` / `frontend:build` / `scan` 全绿。

## 4. 部署侧只读复核（已完成，供记录）

```sql
EXPLAIN (ANALYZE, BUFFERS) select id, steam_appid, name, name_en from games where steam_appid is not null;
-- 结果：Execution Time 91.086 ms（Seq Scan 属正常，200,495 行）
select relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum from pg_stat_user_tables where relname='games';
-- 结果：n_dead_tup=38,694（19%），无需特别处理
```

## 5. 待确认

1. #2（事件循环阻塞观测）是否随本批做？建议做（成本小、能防止再次误判）。
2. #3（后台生成）是否随本批做？建议做（把"首次 20s"变成"立即打开"）。
3. 发版由发版会话完成；若 tag 仍缺失，先完成 tag 再谈后续优化。
