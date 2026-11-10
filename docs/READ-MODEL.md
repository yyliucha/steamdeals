# 首页列表读模型：`game_region_snapshot`（已实现并发布 v2.6.0）

> 状态：**已实现并发布 v2.6.0（2026-11-10，9d588fe；QA ✅ 放行 docs/QA-READ-MODEL-AV.md，性能 3 项转上线实测）**——
> 所有者确认：① 覆盖全部区服；② 允许一次性回填；③ 「新史低」接受跨天口径（实现用日界增量，另留夜间对账兜底）。
> 关联：[ARCHITECTURE.md](ARCHITECTURE.md) · [PROJECT-OVERVIEW.md](PROJECT-OVERVIEW.md) · [DEPLOY.md](DEPLOY.md) ·
> [HANDOVER.md](HANDOVER.md) · [TODO.md](TODO.md) 的 AV 条目

一句话：**把「每次请求现算全库聚合」改成「入库时算一次、读的时候只查一行」**——新增 `(game, region)` 粒度的读模型表，
`gameSearch` 与 `/api/games/count` 改读它，去掉 `price_rollup` / `daily_rollup` 两个全库 CTE 与 `exists(daily_prices)`。

## 1. 已确认的决策（2026-11-09）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 区服覆盖 | **全部区服**（`offers.region` 出现过的都建行），不做「仅 cn」；前台切区服同样受益 |
| 2 | 首次回填 | **允许一次性回填**（迁移时表空则全量回填），期间列表可短暂变慢/偏旧，完成后恢复 |
| 3 | 「新史低」口径 | 允许跨天口径；实现上采用**日界切换的增量维护**（比夜间全量重算更准也更省），夜间只跑抽样对账 |
| 4 | 技术边界 | **不引入 Redis / 缓存中间件 / 新运行时依赖**；读模型与 `offers` 同库、由唯一写入方维护 |
| 5 | 详情页 | 保持实时查 `offers`（单游戏，毫秒级），不套读模型，避免双份口径 |

## 2. 问题与证据（2026-11-09 线上实测）

| 请求 | TTFB | 说明 |
|---|---|---|
| `POST /api/games/search`（首页列表） | 2.78–3.86s | 首页慢的主因 |
| 同上 `q=zzzz`（0 条、响应 134B） | 2.40s | **成本与匹配行数无关** |
| 同上 `q=730`（appid 精确匹配、0 条） | 2.42s | 同上 |
| 同上 `sort=name` / `pageSize=5` | 2.85s / 2.78s | 与排序、页大小无关 |
| `GET /api/games/count` | 0.36s | 每次首页都跑，无缓存 |
| `GET /assets/index-*.js` | 279KB 未压缩 | 部署侧 nginx gzip 另办（不在本批） |

代码根因（`src/store/pg.js` 的 `gameSearch`）：

1. `price_rollup` CTE：`from offers ... where o.region=$1 group by o.game_id` —— 每次请求聚合**整个区服的 offers**；
2. `daily_rollup` CTE：`from daily_prices ... where d.region=$1 group by d.game_id` —— 每次请求聚合**千万级历史**；
3. `where exists (select 1 from daily_prices d where d.game_id=g.id and d.region=$1)` —— 19.6 万 games 逐行探测；
4. `select count(*)` 用同一套条件**再全扫一遍**；
5. 两个 CTE 都只为返回的 20 行服务。

## 3. 数据模型

```sql
create table if not exists game_region_snapshot (
  game_id           bigint not null references games(id) on delete cascade,
  region            text   not null,
  -- 当前价（官方渠道 = official + authorized_reseller，仅 in_stock）
  price_cents       integer,
  currency          text,
  original_cents    integer,
  discount_pct      integer,
  steam_price_cents integer,            -- 只看 Steam 平台的最低在售价
  low_platform      text,
  low_platform_name text,
  platform_names    text[],             -- 该区服在售的平台名（卡片标签）
  offers_count      integer not null default 0,
  last_seen_at      timestamptz,
  -- 历史（来自 daily_prices 的日聚合）
  hist_low_cents       integer,
  prev_hist_low_cents  integer,         -- 今天以前的史低（「新史低」角标）
  hist_low_day         date,            -- hist_low 最新覆盖到哪一天（日界切换用）
  updated_at        timestamptz not null default now(),
  primary key (game_id, region)
);

-- 列表排序/筛选（只覆盖有当前价的行）
create index if not exists grs_region_discount on game_region_snapshot (region, discount_pct desc, price_cents asc) where price_cents is not null;
create index if not exists grs_region_price    on game_region_snapshot (region, price_cents asc) where price_cents is not null;
create index if not exists grs_region_seen     on game_region_snapshot (region, last_seen_at desc) where price_cents is not null;
-- 计数与 join 用
create index if not exists grs_game on game_region_snapshot (game_id);
```

- 空间：有价游戏 10.6 万 × 区服（1–8）× ~150B ≈ **150–300MB**（含索引），可接受。
- 行存在即表示「该游戏在该区服出现过官方报价或历史」，与现有 `exists(daily_prices)` 的语义对齐（见 §6.3）。

## 4. 写入与维护（本批的核心）

写入方只有 `src/ingest.js` 的 `ingestOffers()`（唯一写 offers 的地方）与 `mergeGames()`（唯一删/移 offers 的地方），
因此可以在同库内做到强一致，不需要队列。

| 函数 | 位置 | 触发 | 行为 |
|---|---|---|---|
| `refreshGameRegionPrices(q, gameId)` | `src/store/pg.js` 新增 | 每个 offer `insertOffer/updateOffer` 之后 | 一条 `insert ... select ... from offers ... where game_id=$1 group by region on conflict (game_id,region) do update` 重算该**游戏的全部区服**当前价列；单游戏只扫几行，1–3ms |
| `touchDailyAggregate(q, {gameId, region, priceCents})` | 同上 | `upsertDaily()` 之后（`ingest.js:120`） | 维护 `hist_low`/`prev_hist_low`/`hist_low_day`：`hist_low_day` 落后于今天 → 先把 `hist_low` 抄进 `prev_hist_low` 再更新（**日界切换**，见下） |
| `refreshGameRegionPrices` | 同上 | `mergeGames()` 尾部（移动 offers 与 daily 之后） | 对 `from` / `to` 两个 game 都刷新 |
| 级联 | FK | 游戏被硬删 | `on delete cascade` 自动清行；回收站是 `deleted` 标记，行保留、由 join 过滤 |

**日界切换规则（`prev_hist_low` 为什么不需要夜间全量重算）**：
`prev_hist_low` 的定义是「今天以前的日最低」，而「今天第一次写入之前」的 `hist_low` 恰好等于它。
所以只要记录 `hist_low_day`：写入时若 `hist_low_day < current_date` → `prev_hist_low = hist_low`、`hist_low_day = current_date`，
再 `hist_low = least(hist_low, price)`；同一天内只更新 `hist_low`。补历史日期属异常路径（采集只写 `current_date`），
由对账兜底。

## 5. 读路径改造

### 5.1 `gameSearch`（`src/store/pg.js`）

```sql
from games g
join game_region_snapshot rs on rs.game_id = g.id and rs.region = $1
where g.deleted = false and g.blocked = false
  and (关键词 / 类型 / 发行时间 / 成人 / 用户标记 …)   -- 条件不变，去掉 exists(daily_prices)
order by rs.discount_pct desc nulls last, rs.price_cents asc nulls last, g.name asc, g.id asc
limit $n offset $m
```

- `total`：同一 `from/where` 的 `count(*)`（hash join 到该区服快照，19.6 万行 → 预计 20–50ms）；
- 字段来源：`current_low/currency/current_original/discount/steam_price/low_platform(_name)/platform_names/last_seen_at`
  全部取 `rs.*`；`hist_low/prev_hist_low` 取 `rs.hist_low_cents/prev_hist_low_cents`；`heat/release_date/name/app_type` 仍取 `games`；
  用户维度（`interested/owned/wishlisted/marks`）仍取 `user_game_flags`/`steam_games`/`user_wishlist`，不进货；
- `compact` 与非 `compact`（`/api/games` 路径）**两条分支都要切**，避免只改一半；
- 保留旧实现：环境变量 `READ_MODEL=legacy` 时走原 SQL（回滚开关，见 §9）。

### 5.2 `/api/games/count`（`src/server.js`）

- `priced` 改为 `select count(distinct game_id) from game_region_snapshot`（全区分开算太慢，保持现在的「跨区服去重」口径）；
- 加 60 秒进程内缓存（单实例；多副本时各自缓存，数值偏差可接受）；
- `catalog` 不变（`games` 表 count）。

### 5.3 行为等价性清单（开发时逐条核对）

| 字段/行为 | 现在 | 改后 |
|---|---|---|
| 有价游戏出现在列表 | `exists(daily_prices)` | 快照行存在（回填时取 offers ∪ daily_prices 的 game/region 并集） |
| 排序 discount/price/name | 现算 CTE | 快照列 + 索引，顺序一致（`nulls last` 保持） |
| 「新史低」角标 | `prev_hist_low` | 快照列（日界增量） |
| 平台标签 | 现算 `array_agg` | `rs.platform_names` |
| 游客/登录差异 | guestFlags / userId | 不变（只换价格来源） |
| 页大小上限 100、`page` 越界 | 现状 | 不变 |

## 6. 迁移与回填

1. `migrate()` 里 `create table if not exists` + 索引（幂等，每次启动都跑）；
2. **表空时一次性回填**（`select count(*) from game_region_snapshot limit 1` 为空才执行）：

```sql
-- 行集合：offers ∪ daily_prices 的 (game, region)
insert into game_region_snapshot (game_id, region, ...)
select ... from offers o join platforms p ... group by o.game_id, o.region
on conflict (game_id, region) do update set ...;
-- 历史字段：一次聚合 daily_prices（官方渠道），hist_low_day = current_date
```

3. 回填日志：`readmodel.backfill_start/done`（行数、耗时）；估 10–60 秒（生产量级），`DEPLOY.md` 注明首次启动会慢一次；
4. 回填可重跑（`on conflict do update`），中断后重启继续。

## 7. 一致性、对账与回滚

- **强一致范围**：同一事务外的单条 upsert；`offers` 写入成功后立即刷新，列表最迟下一次请求可见；
- **对账（兜底）**：`node src/cli.js readmodel check [--sample 200] [--fix]`
  - 抽样 200 个 game/region：实时聚合 `offers`/`daily_prices` 与快照逐字段比对；
  - `--fix` 就地修；`readmodel rebuild [--region cn]` 全量重建（运维手段）；
- **回滚**：`READ_MODEL=legacy` 环境变量 → 走旧 SQL；表可保留（不删数据）；
- **失败模式**：写入点漏挂 → 抽样对账能发现并修；回填失败 → 启动日志报错、表为空时下次启动重试（列表暂时为空需人工介入，故回填失败必须 `logger.error` 且不吞异常）。

## 8. 调度与自动化

| 项 | 结论 |
|---|---|
| 是否新增任务 | **新增 `readmodel` 任务（每日）** 跑 `readmodel check --sample 200`；不能并进 `prune`（周级清理，粒度不符） |
| 单轮时长 | 抽样 200 条实时聚合 ≈ 1–3s；不受 Steam 配额影响 |
| 续跑游标 | 无需（幂等、按抽样重跑） |
| 测试断言 | `test/scheduler.test.js` 补默认参数/开关断言（本仓库硬规则 3） |

## 9. 性能目标与验收

**性能（上线后外部实测，与 §2 同口径）**

1. `POST /api/games/search`（page=1/pageSize=20/默认筛选）TTFB **P95 < 150ms**（现在 2.8s）；
2. 同上 `q=zzzz`（零命中）**< 150ms**；
3. `GET /api/games/count` **< 30ms**（首次未命中缓存 < 100ms）；
4. 列表 SQL 的 `EXPLAIN` 里**不出现**对 `daily_prices` 的聚合、不出现全表 `offers` 聚合（应看到 `grs_region_*` 索引或对快照的 hash join）。

**功能（回归，必须逐条过）**

5. 同一数据集下新旧实现结果一致：抽 20 组筛选组合（sort×type×released×marks×关键词×游客/登录），
   `total` 与第一页 `id` 顺序完全相同（写成测试，锁住行为）；
6. 「新史低」角标：今天写入新低 → 角标亮；跨天后第一次写入 → `prev_hist_low` 正确切换；
7. 合并游戏后：`from`/`to` 两个 game 的快照都正确（`from` 的行被删除或归零，`to` 的价/史低取并集）；
8. 游戏禁用/回收站：列表不出现（`g.blocked`/`g.deleted` 仍在 `games` 上过滤）；
9. 详情页、价格历史、后台报表不受影响（`npm test` + `node test/api.test.js`）。

**一致性**

10. 采集写一次新价 → 快照同一轮更新（测试断言）；`readmodel check --sample 200` 对账 0 差异。

**通用**

11. `npm test` 全绿（新增测试进 `package.json` 主链）、`npm run frontend:build`、`npm run scan` 干净；
12. `docs.test.js` 无断链；`PROJECT-OVERVIEW` / `DEPLOY` 同步（读模型表、`READ_MODEL` 开关、首次回填窗口）。

## 10. 实施顺序（每步可独立上线/回滚）

1. **建表 + 写入维护**：DDL、`refreshGameRegionPrices`、`touchDailyAggregate`、接 3 个写入点、单测；读路径不动。
2. **回填 + 对账**：迁移回填、`readmodel check/rebuild` CLI、`readmodel` 每日任务 + scheduler 测试。
3. **读路径切换**：`gameSearch` 两分支 + `/api/games/count` + `READ_MODEL` 开关 + 新旧一致性测试。
4. **上线观测**：按 §9 实测 TTFB / EXPLAIN，达标后把旧 SQL 标记为「仅回滚用」。

## 11. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 写入点漏挂导致快照陈旧 | 列表价格旧 | 抽样对账 + 单测覆盖 3 个写入点 |
| 回填时间超预期 | 首次启动慢 | 日志 + `DEPLOY` 注明；可离线预先回填 |
| 新索引让写变慢 | 采集写放大 | 只有 3 个索引，单行 upsert；采集本身限速 1.6s/次 |
| 行为差异（如「有历史无现价」的游戏） | 列表条数变化 | 回填取 `offers ∪ daily_prices` 并集，§5.3 逐条核对 |
