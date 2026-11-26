# 慢慢同步改造：heat 热度回填 / steam-discovery Deck 发现（FW，待开发）

> 状态：**需求与方案已确认（2026-11-26），待开发**。
> 关联：[SYNC-HARDENING.md](SYNC-HARDENING.md)（FP 批 §4.3 已落地 403 退避一半）、
> [DISCOVERY-FOR-YOU.md](DISCOVERY-FOR-YOU.md)（CH 批 steam-discovery 起源）、
> [SYNC-JOB-GROUPS.md](SYNC-JOB-GROUPS.md)（任务组）、[ROADMAP.md](ROADMAP.md)（未排期想法）

## 0. 背景与目标

2026-11-26 线上 `heat` 与 `steam-discovery` 两个任务因 Steam 403（代理 IP 风控）失败。代码核实后的归因：

- **heat**：一天一轮 20000 款（`--sleep 1700` → 约 9.4 小时占重槽），4xx 立即整轮中止
  （`src/cli/ops.js:1017-1025`），当前 appid **不写 `heat_at`** → 当天进度归零，下一轮从同一位置重来；
- **steam-discovery**：一天一轮 100 页（约 4 分钟），**无断点游标**（`src/discovery.js:44-46` 每轮从 page=1），
  撞 403 后下一轮仍从第 1 页开始 → 进度不进不退。

目标：**低频、少 403、进度只进不退、403 预警但不中断**，且不扩大其它任务的参数范围。

## 1. 已确认的决策（所有者 2026-11-26 逐项确认）

| # | 决策 |
|---|---|
| 1 | heat 每轮 **100 款、间隔 10 分钟**（轮内保持 1.7s/款突发 ≈2.8 分钟，轮间约 7 分 10 秒静默） |
| 2 | heat 候选过期阈值 **7 天 → 30 天**（否则 14 天全量周期下永远积压） |
| 3 | steam-discovery 每轮 **10 页、间隔 30 分钟**；名称回退 **100 → 10/轮** |
| 4 | steam-discovery 增加**页游标**（进度只进不退，翻到尽头重置） |
| 5 | 403：任务**软收尾**（不记 failed、不熔断），退避 1~30 分钟后下一轮自然继续 |
| 6 | 403 软退出做成**全 Steam 任务通用**（cli.js 统一收尾），不只 heat/discovery |
| 7 | 预警：后台任务卡 + `sync_runs` 记录 + 邮件节流（连续 ≥3 次且 60 分钟未恢复发 1 封，恢复后 1 封恢复通知） |
| 8 | 范围：heat + steam-discovery 的参数/游标/403 语义；其它任务**参数不动** |
| 9 | 全量周期：heat ≈14 天、discovery ≈8 天（可接受；按 19.6 万款 / 3,920 页推算，见 §10-1） |
| 10 | 接受重任务槽排队（现状已 28~36 小时/天 > 24 小时；本次净 −1.1 小时/天，见 §6.4） |
| 11 | 拆两个子批 **FW-1（调度与游标）/ FW-2（403 与预警）**，各一个开发会话 |

## 2. 数据模型

**不改表结构、不加依赖。** 新增两处持久状态：

### 2.1 heat 候选阈值（改 SQL）

`src/store/cli-ops-repository.js:27`：`interval '7 days'` → `interval '30 days'`。

理由：19.6 万 ÷ 14 天 = 1.44 万/天 能力；7 天阈值稳态需 19.6万/7 = **2.8 万/天** → 每天欠 1.36 万，
积压只增不减。30 天后稳态只需 6,533 款/天，余量充足。

### 2.2 discovery 页游标（新增）

- **存储**：`app_meta` 表（已有 k-v，`src/settings.js:1007/1049` 在用），键 `discovery.page_cursor`；
- **值**：`{"nextPage":N,"updatedAt":"ISO","roundStartedAt":"ISO","completedAt":"ISO|null"}`；
- **写入时机**：每页成功写库后 → `nextPage = page + 1`；
- **重置**：翻页返回空 `items`（到头）→ `nextPage=1` + `completedAt=now()`；
- **幂等**：同一页重复跑不会重复写库（`update games ... where steam_appid=$1` 幂等）；
- **不落 `data/*.json` 的理由**：容器重建可能丢 `data/`（待核实，见 §10-2）；`app_meta` 随库持久。

### 2.3 403 冷却（复用，不加字段）

`data/steam-403.json`（`src/http.js:124`）已有 `{until,count,at,label}`，本次直接读用。

## 3. 服务端

### 3.1 退出码约定（新增 76）

| 码 | 含义 | `sync_runs` | 熔断 | 重排 |
|---|---|---|---|---|
| 0 | 成功 | ok | 清零 | 清 retry |
| 75 | 429 冷却超限收尾（既有，`src/cli.js:768`） | interrupted | 不计 | 1 小时后重排（既有） |
| **76（新增）** | **403 收尾** | interrupted | 不计 | **不重排**，按正常间隔下一轮继续 |

> 理由：heat 轮间隔只有 10 分钟，76 若沿用 75 的「1 小时后重排」会比自然下一轮更慢，反而拖慢进度。

### 3.2 改动点

| 文件 | 改动 | 依据 |
|---|---|---|
| `src/cli.js:768` | `softAbort` 判定加 `err.code === 'FORBIDDEN_COOLDOWN'`（403）→ `process.exitCode = 76`；75 语义不变 | 软退出统一收尾 |
| `src/cli/ops.js:1017-1025` | `cmdHeat` 4xx 分支：403 / `FORBIDDEN_COOLDOWN` 不再抛「已中止热度回填」，改抛带 `code='FORBIDDEN_ROUND_END'` 的软收尾错误（当前 appid **不写 `heat_at`**，退避后优先补它）；429 与其它 4xx 行为不变 | 进度只进不退 |
| `src/discovery.js` | `runDiscoveryRound` 403 → 保存游标（最后成功页 +1）后抛软收尾错误；其它错误不变 | 页游标 |
| `src/cli/sync.js:437-449` | `cmdSteamDiscovery` 读/写 `app_meta` 游标；新增 `--reset-cursor`；`--pages` 语义不变 | 页游标 |
| `src/scheduler.js` | `outcomeFor` 76 → `partial`（`jobFailureError(76)` = 「HTTP 403 收尾（进度已保留，下一轮继续）」）；`recordJobResult` 76 → 不熔断；`applyRetry` 76 → **删除**该任务 retry 条目（不重排）；`jobFailedReason(76)` = `http_403_soft_exit` | 软收尾 |
| `src/scheduler.js:1122-1152` | 403 告警从 `failed` 分支移到 `partial && is403` 分支；取消 `DISCOVERY_JOBS`（`:615`）免告警；节流 60 分钟 + 连续 ≥3 次；恢复通知 | 预警 |
| `src/routes/admin-sync.js`（`/api/admin/sync/status`） | 增加 `forbidden: {count, until, remainingMin, label}`（读 `readSteam403Info`） | 后台展示 |

### 3.3 日志事件（`域.动作` 规范）

- `sync.forbidden_round_end`：403 收尾（`job` / `label` / `count` / `backoffMs`）；
- `scheduler.job_partial`：已有，`reason=http_403_soft_exit`；
- `scheduler.forbidden_alert`：预警邮件发出（`streak` / `windowMin`）；
- `scheduler.forbidden_recovered`：恢复通知；
- `discovery.page_cursor`：游标推进（`nextPage` / `page` / `matched`，debug 级）。

### 3.4 去重与幂等

- **403 预警**：同一任务 60 分钟内最多 1 封；`streak` 只在「新一次 403」+1，冷却期内重复软收尾不重复计数；
- **discovery 游标**：同一页重复跑不重复写库（update 幂等）；
- **heat**：每款 `heat_at` 只写一次（幂等）。

## 4. 前端 / 后台

- `frontend/src/pages/AdminModules.vue` 任务表/卡片：**复用现有** `lastResult==='partial'` 的「部分完成」tag
  （`:69` / `:87` / `:101` 已有），`partialReason(row)` 显示 76 的文案；新增一个 `403 冷却 · 剩余 N 分钟` 的
  info tag（数据来自 `/api/admin/sync/status` 的 `forbidden`）；
- **不新增页面、不重设计操作区** → 按技能 §5「新设计页面或重设计页面/操作区才必须 demo」，本批**不需要 demo**；
  验收以接口字段 + DOM 断言为准；
- 设置页：`src/settings.js:127` 的「发现与热度」卡新增 heat 两项，discovery 三项默认值更新。

## 5. 设置与配置

| key | env | 默认（旧 → 新） | 范围 | 说明 |
|---|---|---|---|---|
| `heat.limit`（新增） | `STEAM_HEAT_LIMIT` | 20000 → **100** | 1–200000 | 每轮款数 |
| `heat.intervalMin`（新增） | `STEAM_HEAT_INTERVAL_MIN` | 1440 → **10** | 1–1440 | 轮间隔（分钟） |
| `heat.initialDelaySec`（新增） | `STEAM_HEAT_INITIAL_DELAY_SEC` | 3600（不变） | 0–86400 | 首轮延迟 |
| `discovery.pages` | `STEAM_DISCOVERY_PAGES` | 100 → **10** | 1–1000 | 每轮翻页数 |
| `discovery.fallbackLimit` | `STEAM_DISCOVERY_FALLBACK_LIMIT` | 100 → **10** | 1–2000 | 名称回退条数 |
| `discovery.intervalMin` | `STEAM_DISCOVERY_INTERVAL_MIN` | 1440 → **30** | **10**–10080（原 min 60） | 轮间隔 |
| `sync.forbiddenAlertThreshold`（新增） | `SYNC_FORBIDDEN_ALERT_THRESHOLD` | **3** | 1–50 | 连续 N 次 403 才预警 |
| `sync.forbiddenAlertWindowMin`（新增） | `SYNC_FORBIDDEN_ALERT_WINDOW_MIN` | **60** | 10–1440 | 预警节流窗口 |

**升级迁移（重要）**：`settings` 表已保存的值优先于默认值（DB > env > 默认，`src/settings.js` 头部规则）。
线上若保存过 discovery 三项旧值，改默认**不生效**。

→ 迁移：`update settings set value = to_jsonb(<新值>) where key in ('discovery.pages','discovery.fallbackLimit','discovery.intervalMin') and value = to_jsonb(<旧值>)`，
用 `app_meta` 键 `slow_sync.migrated_v1` 做一次性标记（幂等）。
→ 部署后建议在设置页目视确认这 5 项（heat 2 + discovery 3）。

## 6. 调度与自动化

### 6.1 参数与速率

| 任务 | 间隔 | 单轮量 | 单轮时长 | 瞬时速率 | 每天请求 | 占重槽/天 | 续跑游标 |
|---|---|---|---|---|---|---|---|
| `heat` | 10 分钟 | 100 款 | ≈2.8 分钟 | ≈35 次/分钟（轮内）；平均 10 | 14,400 | 6.8h | `games.heat_at`（30 天） |
| `steam-discovery` | 30 分钟 | 10 页 + 10 回退 | ≈24 秒 | ≈50 次/分钟（轮内）；平均 0.67 | 960 | 1.6h | `app_meta.discovery.page_cursor` |

### 6.2 合并评估（技能 §4.1 强制项）

**技术事实**：`steam-status` 请求的是**完整 appdetails**（`src/steam-status.js:187`，无 `filters`），
响应里已含 `recommendations.total` 与 `release_date` —— 正是 `heat` 需要的全部字段，**零额外请求**。
因此 heat **可以**并入 steam-status（每天 2 万款、约 10 天一轮，比 heat 的 30 天更快，
可省 **14,400 请求/天 = 10 次/分钟**）。

**本次不合并的 3 个理由**：

1. `steam-status` 候选**排除免费游戏**（`src/store/pg.js:3256` `steam_status is distinct from 'free'`），
   而热度需要免费游戏（CS2 / Dota2 等是热度排序主力）——合并必须先改候选条件并重估 steam-status 单轮量，
   属于独立议题；
2. 范围约束：所有者 2026-11-26 明确「其它任务不动」；
3. 频率解耦：heat 独立成任务可按热度变化单独调频，绑定 steam-status 后两者节奏耦合。

→ **后续建议单独立项**（TODO 记录、不排期），落地后 heat 任务可降为兜底或删除。

### 6.3 全量周期

- **heat**：19.6 万 ÷ 14,400/天 = **13.6 天 ≈ 14 天**；30 天阈值下稳态每天只需 6,533 款，余量充足；
- **steam-discovery**：按 19.6 万 ÷ 50 款/页 ≈ 3,920 页 ÷ 480 页/天 = **8.2 天**
  （**待线上核实**：Steam 搜索结果集实际页数不明，可能远小于 3,920，见 §10-1）。

### 6.4 重任务槽影响（理论）

| 任务 | 改前占槽/天 | 改后占槽/天 | 差 |
|---|---|---|---|
| `heat` | 20,000 × 1.7s = 9.4h | 144 轮 × 170s = 6.8h | **−2.6h** |
| `steam-discovery` | 100 页 + 100 回退 ≈ 4 分钟 | 48 轮 × (10 页 + 10 回退) × 1.2s ≈ 1.6h | **+1.5h** |
| 合计 | — | — | **−1.1h/天** |

重槽（`STEAM_HEAVY` 单槽互斥，`src/scheduler.js:474`）总量仍 **28~36 小时/天 > 24 小时**——这是既有超载，
不在本批解决（所有者 2026-11-26 确认接受排队）。

### 6.5 403 行为端到端

1. 请求撞 403 → `src/http.js` 写 `data/steam-403.json`（1m→2m→4m…上限 30m，已有）；
2. 任务内下一次请求 → `src/http.js:411-427` 读冷却，直接抛 `FORBIDDEN_COOLDOWN`（**不请求 Steam**）；
3. cli 收尾 → `sync_runs` 记 `interrupted` + exit **76**；
4. 调度器 → `partial`、不熔断、不重排，写状态文件；
5. 下一轮按正常间隔到期；冷却未过期 → 立刻软收尾（继续不打 Steam）；
6. 冷却过期后 → 正常请求，自动恢复；
7. 预警：连续第 3 次 403 且距上次 ≥60 分钟 → 邮件 1 封；恢复正常 → 恢复邮件 1 封。

## 7. 安全

- 403 预警邮件复用 `alerts.jobFailureEmail` 通道与收件人回退链（`src/notify.js`），**不新增任何凭据**；
- 游标只存页号，不含用户数据；
- 撞 403 时**绝不**回退直连（`src/http.js` AM-1 决策 3 不变）；
- `/api/admin/sync/status` 的 `forbidden` 字段只给管理员（`requireAdmin` 既有）。

## 8. 验收

### FW-1（调度与游标，7 条）

1. scheduler 默认参数：`heat` = `['heat','--limit','100','--sleep','1700']` + `intervalMin=10`；
   `steam-discovery` = `['steam-discovery','--pages','10','--fallback','10']` + `intervalMin=30`
   （更新 `test/scheduler.test.js:79/104` 与 `test/discovery.test.js:81`）；
2. heat 候选 SQL 用 30 天：`heat_at` 在 8~29 天的有报价游戏**不入选**，>30 天入选（新增测试）；
3. discovery 游标推进：mock fetch 跑 10 页后 `app_meta.discovery.page_cursor.nextPage=11`；
   第二轮首个请求 `start=500`（断言 URL）；
4. 翻到尽头（`items` 空）→ 游标重置 1 并记 `completedAt`；
5. 游标落 `app_meta`（重启不丢）；`--reset-cursor` 可从 1 重来；
6. 设置页「发现与热度」卡出现 heat 两项；discovery 三项默认值更新，迁移幂等（`slow_sync.migrated_v1` 只生效一次）；
7. `npm test`（分段）+ `npm run frontend:build` + `npm run scan` 全绿。

### FW-2（403 与预警，7 条）

1. heat 撞 403：`sync_runs` 记 `interrupted`（非 failed），进程 exit **76**；
2. 调度器 exit 76 → `partial`、`failures` 不增、连续 5 次 76 不熔断；
3. 76 **不写** `data/scheduler-retry.json`；下一轮按正常间隔到期（不 1 小时后重排）；
4. 403 冷却期内任务**不请求 Steam**（mock 断言 fetch 未被调用），直接软收尾；
5. 全 Steam 任务通用：`steam-prices` / `steam-status` / `backfill` 撞 `FORBIDDEN_COOLDOWN` 同样 exit 76、不熔断；
6. 预警节流：连续 3 次 403 发第 1 封；60 分钟内不重复；恢复后发恢复通知；
7. 后台任务卡显示「部分完成 + 403 收尾原因」，`/api/admin/sync/status` 含
   `forbidden:{count,until,remainingMin}`；`npm test`（分段）+ `frontend:build` + `scan` 全绿。

### 通用

- 不改表结构、不加依赖；
- 日志事件名符合 `域.动作`；
- 不改 README 的「已实现」描述（由开发交付时同步 `PROJECT-OVERVIEW.md`）。

## 9. 实施顺序

**FW-1 → FW-2**：FW-2 的 403 收尾在 discovery 上依赖 FW-1 的游标保存点；
FW-1 可独立上线（参数与游标先生效，403 仍按旧行为记失败，可接受一周内的 403）。

## 10. 待确认 / 待核实

1. **discovery 全量页数**：线上真正翻到尽头的页数未知（代码不落总页数），8 天是按 3,920 页推算；
   部署后看一轮 `discovery.round_done` 的 `pages` 与是否提前到头，再校正周期。
2. **`data/` 是否持久卷**：`data/steam-403.json`、`data/scheduler-retry.json` 依赖持久化；
   若容器重建丢失，403 冷却会立刻失效。需部署侧确认 compose 的 volumes（DELIVERY §4）。
3. **线上近 7 天 `sync_runs` 实测占槽**：§6.4 是理论值，需实测（部署侧只读查询）验证超载假设。
4. **免费/无报价游戏热度冻结**：既有缺陷（只在首轮播种，之后永不刷新），本批不改；
   若后续做 §6.2 的合并可一并解决。
