# 对齐审核二次修复：事件循环阻塞与首屏体验（CS，P0 事故追加）

> 状态：**已确认待开发（2026-11-18，EXPLAIN 复核后修正：DB 侧 91ms，瓶颈在应用事件循环）**。
> 关联：[TODO.md](TODO.md) CS 条目、[ALIGN-QUERY-PERF.md](ALIGN-QUERY-PERF.md)（CN 批：缓存/单飞/预筛/预算）、
> [SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md)。

## 1. 事故复现与修正后的根因（2026-11-18 线上 v2.24.0）

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
| 1 | **完成 v2.24.1 发版**（本批最关键）：提交已 staged 的改动 → 打 tag 前确认 `git cat-file -e v2.24.1:src/align-query.js` 成功 → 推 tag → CI 双绿 → 部署。上线后对齐页应恢复（首次计算 ≤ 20s 预算 + 缓存）。 |
| 2 | **观测修正**：`db.slow_query` 需区分「DB 执行时间」与「事件循环阻塞」——建议在 query 外层记录 `pg` 的 `query_time`（服务端）或在 `db.slow_query` 里同时输出 `eventLoopLagMs`（可用 `perf_hooks.monitorEventLoopDelay` 近似），避免再次把阻塞误判为慢查询。 |
| 3 | **首屏后台化（可选增强）**：计算改为服务启动后/首次进入时**后台**触发，接口冷缓存返回 `202 {generating:true}` + 前端轮询 3s——把"首次 20s"变成"页面立刻打开、列表稍后出现"。CN 已有缓存与预算，此项属体验优化。 |
| 4 | **候选索引节流刷新（可选）**：`games` 变更后（catalog 同步完成）失效候选索引，避免每次计算重建 20 万对象。 |

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
