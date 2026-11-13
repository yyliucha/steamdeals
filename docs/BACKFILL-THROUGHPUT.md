# 增量回填吞吐与配额治理（候选去噪 / 429 软退出重排 / 每日节奏 / 失败隔离 / 观测）

> 状态：**已确认待开发（2026-11-13）；已实现并发布 v2.11.1（2026-11-13，e734673；QA ✅ 放行 docs/QA-BACKFILL-THROUGHPUT-BL.md）**。编号 **BL**（BL-1 / BL-2 / BL-3）。
> 关联：[SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md)（AC-4 每日配额预算 / AC-6 429 全局退避 / AC-9 新游戏优先）、
> [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md)（六态口径）、[TODO.md](TODO.md) 的 BL 条目。

## 1. 现象与代码事实（2026-11-13 核对）

**所有者描述**：增量回填一周才跑一次；手动点「立即运行」触发了 429，本轮就结束了，后面的不再同步；
担心数据积压越来越多、429 越来越频繁，想要一个"能把数据都同步过来"的方案。

| # | 事实 | 证据 |
|---|---|---|
| 1 | 回填是**每周一轮**、上限 5 万、每批 100、批间隔 3 秒 | `src/scheduler.js:206-215`（`STEAM_BACKFILL_INTERVAL_MIN=10080`、`STEAM_BACKFILL_LIMIT=50000`） |
| 2 | 遇到 403/429 **整轮立即中止**（三处 abort），不做部分完成 | `src/cli.js:1834-1836`、`:1852-1853`、`:1879-1881` |
| 3 | 进度不会丢：每批写完就 `markBackfilled`（含"没拿到报价"的），下一轮从剩余候选继续 | `src/cli.js:1907`、候选的 `backfill_at < now() - interval '1 day'` 冷却 `:1806` |
| 4 | 429 前 `http.js` 会先**睡到冷却结束再重试**；默认只重试 1 次，仍失败才抛出 → 一次 429 的代价是"先等 30 分钟 + 整轮作废" | `src/http.js:298-303`、`:243-249`、`:404-411` |
| 5 | **候选不排除"永远不会有价"的游戏**：条件是「缺描述 / 无 Steam 报价 / 有价缺图」，没有看 `steam_status` | `src/cli.js:1802-1812` |
| 6 | 六态里 `free`（免费）/`coming_soon`（未发售）/`region_locked`（锁国区）/`not_found`（国区不可售）**永远满足"无 Steam 报价"** → 每轮重复入队、重复请求 | 六态口径 `src/store/pg.js:382`、`:2896-2920`；候选 SQL 见第 5 条 |
| 7 | AC-4 预算把回填按"理论值"折算成**约 8.3 分钟/天**，超预算时**只缩 `steam-status`** | `src/scheduler.js:346-361`（`backfillDailyMin`）、`:368-387` |
| 8 | 重任务全局单槽串行（`STEAM_HEAVY`），429 不是任务并发造成的，是**配额总量**被价格刷新/热度/状态/回填补满 | `src/scheduler.js:256`、`:270-281` |
| 9 | 观测缺口：调度状态只有 `lastResult/耗时/失败原因`，**没有本轮进度、剩余量、429 次数**；`adminGameStats` 有六态计数但**没有"回填队列/已排除"口径** | `src/scheduler.js:434-467`、`src/store/pg.js:2896-2920` |
| 10 | 失败无隔离：`markBackfilled` 每批都会写，失败条目第二天就重新可选，反复烧配额 | `src/cli.js:1907` + 候选 1 天冷却 |

**一句话根因**：候选里混着大量"永远同步不出结果"的游戏（六态已定性），它们把每周 5 万的配额吃掉一大半；
剩下的量一旦碰到 429 就整轮作废、再等一周——**不是"同步不到"，是"分母错 + 失败代价太大 + 节奏太稀"**。

## 2. 已确认的决策（2026-11-13 所有者，8 项）

| # | 决策 |
|---|---|
| 1 | 目标取**稳态**：直接改每日小步、慢慢收敛；**不做**专门的"一次性追赶模式" |
| 2 | 候选**排除四态**：`free` / `coming_soon` / `region_locked` / `not_found`（这些不再回填） |
| 3 | 429 改**软退出**：本轮收尾、保留进度，不再整轮记失败 |
| 4 | 429 后**1 小时内自动重排**一轮（每小时最多 1 次；连续 3 次软退出则放弃，等正常日轮） |
| 5 | 节奏：**每天 1 轮、limit 5000**（原每周 1 轮 / 50000） |
| 6 | 失败隔离：同一 appid **连续 3 次**拿不到数据 → **跳过 30 天** |
| 7 | 观测①：后台显示**待回填 / 已排除 / 跳过中**数量 |
| 8 | 观测②：任务卡显示**本轮进度 + 预计剩余天数 + 429 次数与最近时间** |

## 3. 设计

### 3.1 候选去噪 + 每日节奏（BL-1）

**候选 SQL**（`src/cli.js` 的 `cmdBackfill`，在现有条件上追加两条）：

```sql
-- 新增：四态已由 steam-status 定性，不会再产生报价，回填只白烧配额
and coalesce(g.steam_status, '') not in ('free', 'coming_soon', 'region_locked', 'not_found')
-- 新增（BL-3）：失败隔离期内不再入选
and (g.backfill_skip_until is null or g.backfill_skip_until < now())
```

- `no_price`（国区无价）**不排除**：可能后续有价，保留重试（见 §7 待确认 1）；
- 排序仍按"新游戏优先"（`created_at desc nulls last, id desc`，AC-9 决策不变）；
- `backfill_at` 的 1 天冷却保留（防止同一批在本次运行内被反复选中）。

**节奏**（默认值改两处，env 仍可覆盖）：

| 项 | 现在 | 本批 |
|---|---|---|
| `STEAM_BACKFILL_INTERVAL_MIN` | 10080（每周） | **1440（每天）** |
| `STEAM_BACKFILL_LIMIT` | 50000 | **5000** |
| `--batch` / `--sleep` | 100 / 3000 | 不变 |

`steamDailyBudgetMinutes` 会按新参数自动重算：`(5000/100)*3/60 + (5000/100)*10*0.4/60 ≈ 5.8 分钟/天`，
总预算仍 < 24h，**本批不改预算分配逻辑**（仍是超预算只缩 `steam-status`，见 §6）。

### 3.2 429 软退出 + 1 小时重排 + partial 语义（BL-2）

**① 子进程侧（`src/cli.js` `cmdBackfill`）**

- 三处 `abort()`（403/429）改为**软退出**：

```js
// 403/429：不再抛错；记 partial 日志 + 进度文件，退出码 75（EX_TEMPFAIL）
logger.warn('backfill.partial', { reason: `http_${err.status}`, done, stored, priced, failed, batches });
console.log(`本轮因 HTTP ${err.status} 提前收尾：已处理 ${done} 款，进度已保留，1 小时内自动重试`);
process.exitCode = 75;
return;
```

- 其它错误（405/网络/代理全失败）保持现有行为（失败/中止）；
- 退出前写一次进度文件（见 §3.5）。

**② HTTP 层（`src/http.js`）**

- 现在 `STEAM_429_RETRIES=0` 时会在**写冷却文件之前** `break`（`:404-411`），导致"快速失败"不共享全局冷却。
  本批调整为：**首次 429 就先 `writeSteam429Until`**（含 `at`/`label` 字段），再决定是否按 `STEAM_429_RETRIES` 重试；
  这样回填可以 `STEAM_429_RETRIES=0` 快速失败，其它任务也能看到冷却；
- 冷却文件追加字段（向后兼容，读仍只认 `until`）：`{ until, at, label }` —— `at` 用于后台显示"最近 429 时间"。

**③ 调度器（`src/scheduler.js`）**

- 给 `backfill` 子进程传 `STEAM_429_RETRIES=0`（与 `steam-prices` 的 `Infinity` 相反：回填**不**在请求里长睡，
  交给"1 小时重排"）；
- `runJob` 退出处理区分三种：`0 → ok`、`75 → partial`（记 `scheduler.job_partial`，**不计失败**）、其它 → failed；
- `recordJobResult`：code 75 时 `failures` 不变、不开熔断（现有实现 `code===0` 才清零，需显式放行 75）；
- **重排机制**：新增 `data/scheduler-retry.json`（`{ backfill: { at, streak, reason } }`）
  - partial 后写 `at = now + 60min`，`streak += 1`；
  - `planTick` 的 due 判定改为 `正常到期 || retry.at <= now`（仍受重任务单槽互斥）；
  - `streak >= 3` → 清掉 retry（等正常日轮，避免整夜刷 429）；
  - 成功（exit 0）→ 清 retry 与 streak；
- 状态文件（`data/scheduler-status.json`）增加 `lastResult: 'partial'` 与 `retryAt`。

### 3.3 失败隔离（BL-3）

`games` 加列（`migrate()` 幂等）：

```sql
alter table games add column if not exists backfill_fail_count int not null default 0;
alter table games add column if not exists backfill_skip_until timestamptz;
create index if not exists idx_games_backfill_skip on games (backfill_skip_until) where backfill_skip_until is not null;
```

计数规则：

- **失败** = 该 appid 在 GetItems 与 appdetails 回退里都**没拿到元数据**（HTTP 错误 / 缺字段 / 完全没返回）；
- **成功** = 拿到元数据（哪怕没有报价——免费/锁区不算失败，它们由六态排除）；
- 每批结束后：成功项 `count=0`；失败项 `count+1`；`count >= 3` → `skip_until = now() + interval '30 days'`，日志
  `backfill.item_skipped { appid, count }`；30 天后自动重入（再失败 3 次再跳 30 天）；
- 429 软退出时本轮未处理的条目不计数（没有"失败"事实，只是没轮到）。

### 3.4 观测（BL-2 / BL-3）

**① 回填进度文件** `data/backfill-progress.json`（子进程每批后原子写；单条记录，覆盖式）：

```json
{
  "startedAt": "…", "updatedAt": "…", "result": "running|ok|partial|failed",
  "done": 3200, "limit": 5000, "batches": 32,
  "stored": 3100, "priced": 900, "failed": 40,
  "candidateTotal": 68000, "remaining": 64800,
  "ratePerMin": 210, "count429": 1, "last429At": "…", "retryAt": "…"
}
```

- `candidateTotal` 在本轮开始时按候选 SQL 数一次；`remaining = max(0, candidateTotal - done)`（近似，页面标注"约"）；
- `count429/last429At`：本轮计数 + 最近一次 429 时间（可与 `data/steam-429.json` 的 `at` 合并取新值）。

**② 指标卡**（`GET /api/admin/games/stats` 追加 3 个字段，前端「游戏管理 → 游戏目录」现有指标网格追加 3 张卡）：

| 字段 | 口径 |
|---|---|
| `backfill_pending` | 新候选谓词（排除四态 + 跳过期）的数量 |
| `backfill_excluded` | 四态中"仍缺描述 / 无 Steam 报价 / 有价缺图"的数量（= 本次被排除掉的量，用于对账） |
| `backfill_skipped` | `backfill_skip_until > now()` 的数量 |

**③ 任务卡**（「游戏管理 → 同步与回填」）：

- 「上次结果」支持 `partial`：黄色「部分完成」（hover 显示 `HTTP 429 · 已处理 3200/5000 · 剩余约 64800`）；
- 「失败原因」列显示 `429 累计 N 次 · 最近 HH:mm`；
- 「状态」列：partial 后显示「重试于 HH:mm」；
- `/api/admin/sync/status` 合并 `scheduler-status.json` 与 `backfill-progress.json`（只读文件，不加 DB 查询）。

### 3.5 改动清单

| 文件 | 改动 |
|---|---|
| `src/cli.js` | 候选 SQL 追加四态 + skip 条件；403/429 改软退出（exit 75）；每批写进度文件；失败计数/跳过 |
| `src/http.js` | 首次 429 即落盘冷却（含 `at`/`label`），再按 `STEAM_429_RETRIES` 决定重试 |
| `src/scheduler.js` | `STEAM_429_RETRIES=0`（backfill）；退出码 75 的 partial 语义；`data/scheduler-retry.json` 重排；status 增 `partial/retryAt` |
| `src/store/pg.js` | `games` 加 `backfill_fail_count` / `backfill_skip_until`；失败计数/跳过 SQL；`adminGameStats` 追加 3 字段 |
| `src/backfill.js` | 进度文件读写与解析（复用现有 `parseBackfillProgress` 格式） |
| `src/server.js` | `/api/admin/sync/status` 合并进度文件；`/api/admin/games/stats` 透传新字段 |
| `frontend/src/pages/AdminModules.vue` | 指标卡 3 张；任务卡 partial 标签 / 429 信息 / 重试时间 |
| 测试 | `test/backfill.test.js`（候选谓词、软退出码、进度文件）、`test/scheduler.test.js`（partial 不熔断、retry 到期）、`test/pg.test.js` 或新文件（计数/跳过/统计） |

## 4. 验收

1. **候选去噪**：构造 `free` / `coming_soon` / `region_locked` / `not_found` / `no_price` / 正常缺价各一条 →
   只有 `no_price` 与正常缺价入候选；四态不入选；生产侧「待回填」与「已排除」两数相加 = 旧候选数（对账一致）。
2. **每日节奏**：默认 `interval=1440`、`limit=5000`；任务表频率显示「每 1 天」；AC-4 总预算 < 24h 且无
   `scheduler.budget_exceeded` 告警；env 覆盖（`STEAM_BACKFILL_INTERVAL_MIN` / `STEAM_BACKFILL_LIMIT`）仍生效。
3. **429 软退出**：模拟 429 → 进程退出码 75；日志 `backfill.partial` 含 done/failed；调度器记
   `lastResult='partial'`、`failures` 不增加、不触发熔断（连续 3 次 partial 也不熔断）；`admin_bulk` 之类不受影响。
4. **1 小时重排**：partial 后 `data/scheduler-retry.json` 写入 `at ≈ now+60min`；把 `at` 改到过去 → 下一 tick
   回填被再次调度（受重任务单槽约束）；连续 3 次 partial → 不再重排，等日轮；一次成功 → 清空 retry/streak。
5. **全局冷却**：`STEAM_429_RETRIES=0` 时首次 429 仍写 `data/steam-429.json`（含 `at`），其它任务读到冷却后
   不再立刻打 Steam；冷却结束（30 分钟）后请求恢复。
6. **失败隔离**：构造同一 appid 连续 3 次拿不到元数据 → `backfill_skip_until = now+30d`、候选排除、日志
   `backfill.item_skipped`；30 天后自动重入；中途成功一次 → 计数清零。
7. **观测**：进度文件字段完整；`/api/admin/sync/status` 返回合并后的进度；指标卡三个数字与库内一致；
   任务卡显示「部分完成」、429 次数/最近时间、重试时间；「预计剩余天数」= `remaining / 上一轮实际处理数`（取整，页面标注"约"）。
8. **权限与兼容**：`/api/admin/games/stats`、`/api/admin/sync/status` 未登录 401 / 非管理员 403；
   老库迁移幂等（连续两次 migrate 无副作用）；没有 `backfill_skip_until` 的旧行默认不跳过。
9. **测试与构建**：`npm test` 全绿（含上述新增断言）、`npm run frontend:build`、`npm run scan`。
10. **部署侧只读复核**（发版后）：候选数（新口径）与四态数、`data/backfill-progress.json` 的 `done/limit`、
    24 小时内任务是否按"每天 1 轮"运行、429 次数是否下降（对比上一周）。

## 5. 实施顺序与依赖

| 子项 | 内容 | 依赖 | 解锁 |
|---|---|---|---|
| **BL-1** | 候选去噪（四态排除）+ 每日节奏（1440 / 5000） | 无 | BL-3（候选 SQL 在其上追加 skip 条件） |
| **BL-2** | 429 软退出 + partial 语义 + 1 小时重排 + 全局冷却落盘 + 任务卡观测 | 无 | BL-3 的"预计剩余/429"展示复用进度文件 |
| **BL-3** | 失败隔离（计数 + 跳过 30 天）+ 指标卡 3 张 | **BL-1**（候选 SQL）、**BL-2**（进度文件） | 无 |

## 6. 本批不做

1. **不改成"一次性追赶模式"**（所有者选稳态）；
2. **不动价格刷新 / 热度回填 / steam-status 的限额与优先级**（AC-4 预算只缩 status 的现状保留）；
3. **不把回填并进 `steam-status`**：合并评估——`steam-status` 是逐条全量 appdetails（6000/天、约 5h），
   回填要的是"元数据/封面/首价"，合并会把 status 单轮拉长并延后状态探针，本批只做去噪与节奏；
4. **不改 429 冷却 30 分钟与退避公式**（只改"谁在什么时候落盘"）；
5. **不动 `rename` / `catalog` 的候选条件**；
6. **不改六态口径**（`no_price` 仍留在回填候选）；
7. **不做多实例/外部队列**（单容器调度够用）。

## 7. 待确认（不阻塞开工，已有默认值）

1. `no_price`（国区无价）**保留**在回填候选（可能后续有价）；若希望也排除，改一处 SQL 即可；
2. 跳过期默认 **30 天**（连续 3 次失败），到期自动重试；若想更久/更短可调；
3. 「预计剩余天数」按**上一轮实际处理数**估算（不是理论 limit），页面标注"约"；若更想要"按限速理论值"再改。
