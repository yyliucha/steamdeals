# 慢慢同步改造 + 403/429 代理切换（FW，待开发）

> 状态：**需求与方案已确认（2026-11-26），待开发**。
> 关联：[PROXY-POOL.md](PROXY-POOL.md)（AM 批代理池，本批**修订其决策 1**）、
> [SYNC-HARDENING.md](SYNC-HARDENING.md)（FP 批已落地 403 退避一半）、
> [DISCOVERY-FOR-YOU.md](DISCOVERY-FOR-YOU.md)（CH 批 steam-discovery 起源）、
> [SYNC-JOB-GROUPS.md](SYNC-JOB-GROUPS.md)（任务组）、[ROADMAP.md](ROADMAP.md)

## 0. 背景与目标

2026-11-26 线上 `heat` 与 `steam-discovery` 两个任务因 Steam 403（代理出口 IP 被风控）失败。
代码核实后的归因：

- **heat**：一天一轮 20000 款（`--sleep 1700` → 约 9.4 小时占重槽），4xx 立即整轮中止
  （`src/cli/ops.js:1017-1025`），当前 appid **不写 `heat_at`** → 当天进度归零，下一轮从同一位置重来；
- **steam-discovery**：一天一轮 100 页（约 4 分钟），**无断点游标**（`src/discovery.js:44-46` 每轮从 page=1），
  撞 403 后下一轮仍从第 1 页开始 → **永远只覆盖前 5,000 款（全库 2.5%）**；
- **403 无效处理**：`http.js` 只写全局冷却（1~30 分钟）后**用同一个出口 IP 再试**（`:552-566`），
  而 AM-1 决策 1 明确把「目标站返回 4xx」排除在代理切换外（[PROXY-POOL.md](PROXY-POOL.md):23/:97/:168）——
  403 是 IP 风控，不是配额，停多久都不会自己好。

目标：**低频、少 403、进度只进不退、403 预警但不中断**；并以「代理切换」直接针对 403/429 根因。

## 1. 已确认的决策（所有者 2026-11-26 逐项确认）

### 1.1 节奏与游标（FW-1）

| # | 决策 |
|---|---|
| 1 | heat 每轮 **100 款、间隔 10 分钟**（轮内保持 1.7s/款突发 ≈2.8 分钟，轮间约 7 分 10 秒静默） |
| 2 | heat 候选过期阈值 **7 天 → 30 天**（否则 14 天能力追不上 7 天需求，永久积压） |
| 3 | steam-discovery 每轮 **10 页、间隔 30 分钟**；名称回退 **100 → 10/轮** |
| 4 | steam-discovery 增加**页游标**（进度只进不退，翻到尽头重置） |
| 5 | 全量周期：heat 首轮 ≈14 天（稳态 30 天）、discovery ≈8 天；接受 |
| 6 | 接受重任务槽排队（现状已 28~36 小时/天 > 24 小时；本批净 −1.1 小时/天） |

### 1.2 403 / 429 代理切换（FW-2，**修订 AM-1 决策 1**）

| # | 决策 |
|---|---|
| 7 | **403 与 429 都切代理**；429 保持 AM-1 的「不靠多 IP 加配额」约束（见 8） |
| 8 | **全站总速率闸门 30 次/分钟**（Steam 硬上限 200 次/5 分钟 = 40/分钟，留 25% 余量）；切代理不增加总预算 |
| 9 | **每请求最多试 3 条代理**（403/429 切换时），避免一条链路把池跑一遍 |
| 10 | **403/429 冷却改为按代理落**（复用 `data/proxy-health.json`，AM-1 阶梯 60s/5min/30min）；**全池都被标记时才写全局冷却** |
| 11 | **HTTP 5xx 不切**（保持 AM-1：Steam 自身故障，换 IP 打到同一组服务器） |
| 12 | 全池 403 抛**原错误码 403**（不抛 `PROXY_ALL_FAILED`），保证 FW-3 的软退出判定可用 |
| 13 | 每条代理的出口 IP 是**固定 IP**（所有者确认：几条固定 IP 的代理，非轮换型服务） |

### 1.3 软退出与预警（FW-3）

| # | 决策 |
|---|---|
| 14 | 403：任务**软收尾**（不记 failed、不熔断），退避后下一轮自然继续；新增退出码 **76** |
| 15 | 403 软退出做成**全 Steam 任务通用**（cli.js 统一收尾），不只 heat/discovery |
| 16 | 预警：后台任务卡 + `sync_runs` 记录 + 邮件节流（连续 ≥3 次且 60 分钟未恢复发 1 封，恢复后 1 封恢复通知）；**取消 discovery 类免告警**（覆盖到、不静默） |
| 17 | 范围：heat + steam-discovery 参数/游标 + 403/429 代理切换 + 403 软退出预警；其它任务**参数不动** |

## 2. 数据模型

新增 3 处持久状态（1 个页面游标 + 1 个令牌桶文件 + 1 组代理业务冷却标记），不改表结构：

### 2.1 heat 候选阈值（改 SQL）

`src/store/cli-ops-repository.js:27`：`interval '7 days'` → `interval '30 days'`。

理由：19.6 万 ÷ 14 天 = 1.44 万/天 能力；7 天阈值稳态需 2.8 万/天 → 每天欠 1.36 万。30 天后稳态只需
6,533 款/天，余量充足（候选不足时 `cmdHeat` 的 `if (!appids.length) break` 会自动提前收轮）。

### 2.2 discovery 页游标（新增）

- **存储**：`app_meta` 表（已有 k-v，`src/settings.js:1007/1049` 在用），键 `discovery.page_cursor`；
- **值**：`{"nextPage":N,"updatedAt":"ISO","roundStartedAt":"ISO","completedAt":"ISO|null"}`；
- **推进**：每页成功写库后 → `nextPage = page + 1`；
- **重置**：翻页返回空 `items`（到头）→ `nextPage = 1` + `completedAt = now()`；
- **幂等**：同一页重复跑不重复写库（`update games ... where steam_appid=$1`）；
- **不落 `data/*.json`**：容器重建可能丢 `data/`（待核实 §10-2），`app_meta` 随库持久。

### 2.3 全站速率闸门（文件令牌桶，FW-2）

**为什么不用 DB 表**：`src/http.js` 是纯网络层、**不持有 DB 连接**（server 进程、scheduler 子进程、
各 CLI 命令共用同一出口），在 HTTP 出口做闸门只能走文件——与 `data/steam-403.json` /
`data/steam-429.json` / `data/proxy-health.json` 同款先例。

- **文件**：`data/steam-rate.json`，内容 `{"tokens":<0..30>,"at":"ISO"}`；
- **容量/补充**：容量 **30**，补充率 **30/分钟**（每 2 秒 1 个 token）；
- **取用**：请求前「读 → 按 `at` 补 token（上限 30）→ 有则扣 1 写回（tmp+rename 原子）→
  不足则 sleep 到够 1 个（最多 2 秒）」；
- **记账范围**：每次对 Steam 业务域的真实请求都扣；**代理重试也扣**（切 IP 的额外请求必须计入预算）；
  不含杉果/GOG/Humble/ITAD、不含图片 CDN、不含 `probe` 的 CONNECT 探测；
- **跨进程**：最后写入者胜（AM-1 健康文件同款）——最坏情况少扣 1~2 个 token，偶发多打几次；
  闸门 30 对硬上限 40 留 25% 余量，可接受；
- **等待上限**：累计等待超 `SYNC_RATE_MAX_WAIT_MS`（默认 5 分钟）→ 抛 `COOLDOWN_ABORT`
  （沿用既有 exit 75 + 1 小时重排；FW-3 之后再决定是否并入 76）；
- **首次/文件损坏**：按满桶（30）处理并记 `sync.rate_gate_reset`（debug），不因坏文件停摆。

### 2.4 代理业务冷却（复用，加标记）

`data/proxy-health.json`（AM-1 已落盘）每条代理追加：

- `lastErrorKind`：`'steam403' | 'steam429' | 'proxy' | null`（区分「Steam 拒了」与「代理坏了」）；
- 其余字段（`fails` / `downUntil` / `lastErrorAt` / `probeAt` / `probeOk`）语义不变。

**403/429 的冷却时长**：沿用 AM-1 阶梯 `fails=1 → 60s`、`2 → 5min`、`≥3 → 30min`
（`src/proxy-pool.js:178-197`）。

## 3. 服务端

### 3.1 退出码约定（新增 76）

| 码 | 含义 | `sync_runs` | 熔断 | 重排 |
|---|---|---|---|---|
| 0 | 成功 | ok | 清零 | 清 retry |
| 75 | 429 冷却超限收尾（既有，`src/cli.js:768`） | interrupted | 不计 | 1 小时后重排（既有） |
| **76（新增）** | **403 收尾** | interrupted | 不计 | **不重排**，按正常间隔下一轮继续 |

> 理由：heat 轮间隔 10 分钟，76 若沿用 75 的「1 小时后重排」会比自然下一轮更慢。

### 3.2 改动点

| 文件 | 改动 | 批次 |
|---|---|---|
| `src/store/cli-ops-repository.js:27` | heat 候选 `7 days` → `30 days` | FW-1 |
| `src/scheduler.js:84-85` | heat `--limit 100 --sleep 1700`、`intervalMin 10` | FW-1 |
| `src/scheduler.js:105-106` | discovery `--pages 10 --fallback 10`、`intervalMin 30` | FW-1 |
| `src/cli/sync.js:437-449` | `cmdSteamDiscovery` 读/写 `app_meta` 游标，新增 `--reset-cursor` | FW-1 |
| `src/discovery.js` | `runDiscoveryRound` 接受 `startPage`，每页推进游标，到头重置 | FW-1 |
| `src/store/pg.js` | `app_meta` 游标读写函数（FW-1 已落 `cli-sync-repository`，本批只读用） | FW-2 |
| `src/rate-gate.js`（新增） | 令牌桶读写 `data/steam-rate.json`：`takeToken({perMin, maxWaitMs})` 原子写 + 坏文件按满桶 | FW-2 |
| `src/http.js:233-242` | `isProxyLayerFailure` 之外新增 `isSteamReject(err)` = `status===403`（且 `proxyStatus==null`）或 `status===429` | FW-2 |
| `src/http.js:411-427` | 403 冷却读取改为「当前代理的 `downUntil`」；全池冷却才读全局文件 | FW-2 |
| `src/http.js:528-566` | 403/429 分支：`noteProxyFailure(route.url, {kind:'steam403'|'steam429'})` + `shouldAdvance=true` + `continue`（受 3 条上限） | FW-2 |
| `src/http.js`（请求前） | 过全局速率闸门（`src/rate-gate.js` 的 `takeToken`），代理重试也扣 token | FW-2 |
| `src/proxy-pool.js` | `noteProxyFailure` 支持 `kind`；`candidatesFor` 跳过 `downUntil` 未过期的（已有）；`proxyHealth` 输出 `lastErrorKind` | FW-2 |
| `src/cli.js:768` | `softAbort` 加 `FORBIDDEN_COOLDOWN` → exit **76** | FW-3 |
| `src/cli/ops.js:1017-1025` | `cmdHeat` 403 不抛「已中止」，改抛 `code='FORBIDDEN_ROUND_END'`（当前 appid **不写** `heat_at`） | FW-3 |
| `src/scheduler.js` | `outcomeFor(76)`→partial、`recordJobResult(76)` 不熔断、`applyRetry(76)` 不重排、`jobFailedReason(76)`=`http_403_soft_exit` | FW-3 |
| `src/scheduler.js:1122-1152` | 403 告警移到 `partial && is403`；取消 `DISCOVERY_JOBS`（`:615`）免告警；节流 60 分钟 + 连续 ≥3；恢复通知 | FW-3 |
| `src/routes/admin-sync.js` | `/api/admin/sync/status` 加 `forbidden:{count,until,remainingMin,label}` 与 `rateGate:{perMin,used}` | FW-3 |

### 3.3 403/429 切换状态机（FW-2 核心）

```
attempt = 0; triedProxies = []
while attempt < maxAttempts:
  route = nextCandidate(池, triedProxies)      // 池为空 → 单代理/直连原逻辑
  过速率闸门（30/分钟；记账含重试）
  请求
  ├─ 成功 → noteProxySuccess(route); 返回
  ├─ 代理层失败（ECONNREFUSED/超时/TLS/proxyStatus）→ noteProxyFailure(kind='proxy'); 换下一条; continue
  ├─ 403/429 且 池≥2 且 开关开 且 本轮已试 < 3
  │    → noteProxyFailure(route, {kind:'steam403'|'steam429'}); 换下一条; continue
  └─ 其它（5xx 等）→ 原重试逻辑（不换代理）
全池都撞 403/429（无剩余候选）：
  → 写全局冷却（steam-403.json / steam-429.json）
  → 抛原错误（status 保持 403/429，不包装成 PROXY_ALL_FAILED）
```

关键点：
- **5xx 不切**（决策 11）；
- **429 的 `Retry-After` 只记到该代理**，不当全局冷却；
- **每请求 3 条上限**与池长度取小；代理层失败仍可用满池长度（AM-1 原行为）；
- **全局冷却只在全池失败时写**，时长：403 从 5 分钟起（全池被封说明严重），429 沿用 30 分钟起。

### 3.4 日志事件（`域.动作` 规范）

| 事件 | 级别 | 字段 |
|---|---|---|
| `http.proxy_switch` | info | `from`（masked）、`to`（masked）、`reason`（`steam403`/`steam429`/`proxy`） |
| `http.forbidden_backoff` | warn | `proxy`（masked）、`count`、`backoffMs`（既有事件，加 `proxy` 字段） |
| `http.rate_limit_pause` | warn | 同上（加 `proxy`） |
| `http.proxy_all_rejected` | error | `status`（403/429）、`proxies`（masked 列表）、`count` |
| `sync.rate_gate_wait` | debug | `waitMs`、`used`、`perMin` |
| `sync.rate_gate_abort` | warn | `waitMs`、`perMin` |
| `sync.forbidden_round_end` | warn | `job`、`count`、`backoffMs` |
| `scheduler.job_partial` | warn | 已有，`reason=http_403_soft_exit` |
| `scheduler.forbidden_alert` / `forbidden_recovered` | info | `streak`、`windowMin` |
| `discovery.page_cursor` | debug | `nextPage`、`page`、`matched` |

### 3.5 去重与幂等

- **403 预警**：同一任务 60 分钟内最多 1 封；`streak` 只在新一次 403 +1（冷却期内软收尾不重复计数）；
- **discovery 游标**：同页重复跑不重复写库；
- **速率闸门**：同一请求的重试各记一次（计数偏多而非偏少，安全方向）；
- **代理冷却**：同一代理连续失败只累加 `fails`，不重复写多行。

## 4. 前端 / 后台

- `frontend/src/pages/AdminModules.vue`：任务卡复用现有 `lastResult==='partial'` 的「部分完成」tag
  （`:69/:87/:101` 已有），`partialReason(row)` 显示 76 文案；新增 `403 冷却 · 剩余 N 分钟` 与
  `速率闸门 已用 N/30` 两个 info tag；
- 设置页「网络与代理」健康表（AM-2 已有）加一列「失败类型」：`Steam 403` / `Steam 429` / `代理不可用`；
- **不新增页面、不重设计操作区** → 不需要 demo（技能 §5 判据），验收以接口字段 + DOM 断言为准；
- 设置页「发现与热度」卡新增 heat 两项（limit/interval），discovery 三项默认值更新。

## 5. 设置与配置

| key | env | 默认（旧 → 新） | 范围 | 批次 |
|---|---|---|---|---|
| `heat.limit`（新增） | `STEAM_HEAT_LIMIT` | 20000 → **100** | 1–200000 | FW-1 |
| `heat.intervalMin`（新增） | `STEAM_HEAT_INTERVAL_MIN` | 1440 → **10** | 1–1440 | FW-1 |
| `heat.initialDelaySec`（新增） | `STEAM_HEAT_INITIAL_DELAY_SEC` | 3600（不变） | 0–86400 | FW-1 |
| `discovery.pages` | `STEAM_DISCOVERY_PAGES` | 100 → **10** | 1–1000 | FW-1 |
| `discovery.fallbackLimit` | `STEAM_DISCOVERY_FALLBACK_LIMIT` | 100 → **10** | 1–2000 | FW-1 |
| `discovery.intervalMin` | `STEAM_DISCOVERY_INTERVAL_MIN` | 1440 → **30** | **10**–10080（原 min 60） | FW-1 |
| `sync.rotateOn403`（新增） | `SYNC_ROTATE_ON_403` | **true** | bool | FW-2 |
| `sync.rotateOn429`（新增） | `SYNC_ROTATE_ON_429` | **true** | bool | FW-2 |
| `sync.rateGatePerMin`（新增） | `SYNC_RATE_GATE_PER_MIN` | **30** | 1–40 | FW-2 |
| `sync.rotateMaxPerRequest`（新增） | `SYNC_ROTATE_MAX_PER_REQUEST` | **3** | 1–10 | FW-2 |
| `sync.rateMaxWaitMs`（新增） | `SYNC_RATE_MAX_WAIT_MS` | 300000（5 分钟） | 0–3600000 | FW-2 |
| `sync.forbiddenAlertThreshold`（新增） | `SYNC_FORBIDDEN_ALERT_THRESHOLD` | **3** | 1–50 | FW-3 |
| `sync.forbiddenAlertWindowMin`（新增） | `SYNC_FORBIDDEN_ALERT_WINDOW_MIN` | **60** | 10–1440 | FW-3 |

**升级迁移（重要）**：`settings` 表已保存的值优先于默认值（DB > env > 默认，`src/settings.js` 头部规则）。
线上若保存过 discovery 三项旧值，改默认**不生效**。

→ 迁移：`update settings set value = to_jsonb(<新值>) where key in ('discovery.pages','discovery.fallbackLimit','discovery.intervalMin') and value = to_jsonb(<旧值>)`，
用 `app_meta` 键 `slow_sync.migrated_v1` 做一次性标记（幂等）。
→ 部署后建议在设置页目视确认：heat 2 项、discovery 3 项、代理条数与健康状态。

## 6. 调度与自动化

### 6.1 参数与速率

| 任务 | 间隔 | 单轮量 | 单轮时长 | 瞬时速率 | 每天请求 | 占重槽/天 | 续跑游标 |
|---|---|---|---|---|---|---|---|
| `heat` | 10 分钟 | 100 款 | ≈2.8 分钟 | ≈35 次/分钟（轮内），闸门压到 30 | 14,400（稳态降到 6,533） | 6.8h | `games.heat_at`（30 天） |
| `steam-discovery` | 30 分钟 | 10 页 + 10 回退 | ≈24 秒 | ≈50 次/分钟（轮内），闸门压到 30 | 960 | 1.6h | `app_meta.discovery.page_cursor` |

### 6.2 合并评估（技能 §4.1 强制项）

**技术事实**：`steam-status` 请求的是**完整 appdetails**（`src/steam-status.js:187`，无 `filters`），
响应已含 `recommendations.total` 与 `release_date` —— 正是 `heat` 需要的全部字段，**零额外请求**。
理论上 heat 可并入 steam-status（每天 2 万款 ≈ 10 天一轮，比 heat 的 30 天更快，可省 **14,400 请求/天**）。

**本次不合并的 3 个理由**：

1. `steam-status` 候选**排除免费游戏**（`src/store/pg.js:3256` `steam_status is distinct from 'free'`），
   而热度需要免费游戏（CS2 / Dota2 等是热度排序主力）——合并需先改候选并重估单轮量，属独立议题；
2. 范围约束：所有者 2026-11-26 要求「其它任务不动」；
3. 频率解耦：heat 独立可单独调频，绑定 steam-status 后两者节奏耦合。

→ **后续建议单独立项**（TODO 记录、不排期），落地后 heat 可降为兜底或删除。

### 6.3 全量周期

- **heat**：首轮 19.6 万 ÷ 14,400/天 = **13.6 天**；稳态 30 天阈值下每天只需 6,533 款（能力 14,400，余量足）；
- **steam-discovery**：按 19.6 万 ÷ 50 款/页 ≈ 3,920 页 ÷ 480 页/天 = **8.2 天**（待线上核实 §10-1）。

### 6.4 重任务槽影响（理论）

| 任务 | 改前占槽/天 | 改后占槽/天 | 差 |
|---|---|---|---|
| `heat` | 20,000 × 1.7s = 9.4h | 144 轮 × 170s = 6.8h | **−2.6h** |
| `steam-discovery` | 100 页 + 100 回退 ≈ 4 分钟 | 48 轮 × (10+10) × 1.2s ≈ 1.6h | **+1.5h** |
| 合计 | — | — | **−1.1h/天** |

重槽（`STEAM_HEAVY` 单槽互斥，`src/scheduler.js:474`）总量仍 **28~36 小时/天 > 24 小时**（既有超载，
本批不解决；所有者接受排队）。

### 6.5 速率闸门对预算的影响（新增，必须知道）

闸门 30 次/分钟 = **43,200 请求/天上限**。而重槽各任务「想跑的量」约 57,000~65,000/天：

| 任务 | 每天请求（想跑） |
|---|---|
| steam-status（1~2 次/款） | 20,000~40,000 |
| rating-backfill | 20,000 |
| heat（改后） | 6,533~14,400 |
| steam-prices | 6,667 |
| backfill + explicit + rename + discovery | ≈4,200 |
| **合计** | **57,400~85,300** |

**结论**：闸门 30 是硬天花板，超出部分只能排队或减少任务量——各任务的「全量周期」会按缺口比例拉长
（例如 steam-status 若只分到一半预算，20,000 款/天会变成 3~4 万款/3 天）。这是「平安」的代价，
需要部署后按 `sync_runs` 实测校正（见 §10-3）。

### 6.6 403/429 端到端

1. 请求撞 403/429 → 该代理记 `noteProxyFailure(kind='steam403'|'steam429')`（60s/5min/30min）→ 换下一条（≤3 条）；
2. 全部代理都被标记 → 写全局冷却（403：5 分钟起；429：30 分钟起）→ 抛**原错误码**；
3. cli 收尾 → `sync_runs` 记 `interrupted` + exit **76**（403）/ **75**（429）；
4. 调度器 → `partial`、不熔断、403 不重排；下一轮按正常间隔到期；
5. 冷却未过期 → 立刻软收尾（继续不打 Steam）；过期后自动恢复；
6. 预警：连续第 3 次 403 且距上次 ≥60 分钟 → 邮件 1 封；恢复正常 → 恢复邮件 1 封；
7. 全池 403 → 额外 `http.proxy_all_rejected` 错误日志 + 池级告警（比任务级更值得看）。

## 7. 安全

- 403/429 预警邮件复用 `alerts.jobFailureEmail` 通道与收件人回退链（`src/notify.js`），**不新增凭据**；
- 代理地址一律 `redactProxy()`；`proxy-health.json` 只存 hash（AM-1 既有）；
- 撞 403 时**绝不**回退直连（AM-1 决策 3 不变）；
- 速率闸门与轮换开关只给管理员（`requireAdmin` 既有）；
- **不靠多 IP 加配额**：总预算固定 30 次/分钟，切 IP 只用于「避开被拒的那条」。

## 8. 验收

### FW-1（调度与游标，7 条）

1. scheduler 默认参数：`heat` = `['heat','--limit','100','--sleep','1700']` + `intervalMin=10`；
   `steam-discovery` = `['steam-discovery','--pages','10','--fallback','10']` + `intervalMin=30`
   （更新 `test/scheduler.test.js:79/104`、`test/discovery.test.js:81`）；
2. heat 候选 SQL 用 30 天：`heat_at` 在 8~29 天的有报价游戏**不入选**，>30 天入选（新增测试）；
3. discovery 游标推进：mock fetch 跑 10 页后 `app_meta.discovery.page_cursor.nextPage=11`；
   第二轮首个请求 `start=500`（断言 URL）；
4. 翻到尽头（`items` 空）→ 游标重置 1 并记 `completedAt`；
5. 游标落 `app_meta`（重启不丢）；`--reset-cursor` 可从 1 重来；
6. 设置页「发现与热度」卡出现 heat 两项；discovery 三项默认值更新，迁移幂等（`slow_sync.migrated_v1` 只生效一次）；
7. `npm test`（分段）+ `npm run frontend:build` + `npm run scan` 全绿。

### FW-2（代理切换，7 条）

1. 403 切代理：mock 池 2 条，第 1 条返 403 → 同一逻辑请求自动用第 2 条并成功（**断言两次请求的代理不同**，
   反例自检：`nextCandidate` 永远返回第 1 条时该测试必须变红）；
2. 429 同样切代理（同上用例，status 429）；
3. **5xx 不切**（返 500 时仍用同一条代理重试，或按原逻辑失败）；
4. **每请求最多 3 条**：池 5 条全 403 时只发 3 次请求，随后抛 403；
5. **按代理冷却**：第 1 条 403 后 `proxy-health.json` 记 `downUntil` 与 `lastErrorKind='steam403'`，
   后续请求直接从第 2 条开始（不再撞第 1 条）；
6. **全池 403 才写全局冷却**：`data/steam-403.json` 的 `until` 只在全池都被标记后出现；抛出的错误
   `err.status === 403`（不是 `PROXY_ALL_FAILED`）；
7. **速率闸门**：同一 Node 进程连续要 35 个 token（源站请求），第 31 个起被拦（容量 30、30/分钟补充）；
   `data/steam-rate.json` 的 `tokens` 随时间回升；**代理重试也扣 token**（切 3 条 = 扣 3 个）；
   等待超 `SYNC_RATE_MAX_WAIT_MS` → 抛 `COOLDOWN_ABORT`（exit 75）；
   外加 `npm test`（分段）+ `frontend:build` + `scan` 全绿。

### FW-3（软退出与预警，7 条）

1. heat 撞 403：`sync_runs` 记 `interrupted`（非 failed），进程 exit **76**；
2. 调度器 exit 76 → `partial`、`failures` 不增、连续 5 次 76 不熔断；
3. 76 **不写** `data/scheduler-retry.json`；下一轮按正常间隔到期（不 1 小时后重排）；
4. 403 冷却期/全池被封期内任务**不请求 Steam**（mock 断言 fetch 未被调用），直接软收尾；
5. 全 Steam 任务通用：`steam-prices`/`steam-status`/`backfill` 撞 `FORBIDDEN_COOLDOWN` 同样 exit 76、不熔断；
6. 预警节流：连续 3 次 403 发第 1 封；60 分钟内不重复；恢复后发恢复通知；discovery 类任务**也发**（取消免告警）；
7. 后台任务卡显示「部分完成 + 403 收尾原因」；`/api/admin/sync/status` 含
   `forbidden:{count,until,remainingMin}` 与 `rateGate:{perMin,used}`；`npm test`（分段）+ `frontend:build` + `scan` 全绿。

### 通用

- 不改表结构、不加依赖（闸门走文件不走 DB）；
- 日志事件名符合 `域.动作`；
- `npm test`（分段）+ `frontend:build` + `scan` 全绿。

## 9. 实施顺序

**FW-1 → FW-2 → FW-3**：

- FW-1 可独立上线（参数与游标先生效，403 仍按旧行为记失败，可接受一周）；
- FW-2 依赖 FW-1 无（http.js 层独立），但**依赖代理池 ≥2 条**这个部署前提；
- FW-3 的 403 软退出依赖 FW-2 的「全池 403 抛原错误码」；discovery 的软收尾依赖 FW-1 的游标保存点。

## 10. 待确认 / 待核实

1. **discovery 全量页数**：线上真正翻到尽头的页数未知（代码不落总页数），8 天按 3,920 页推算；
   部署后看 `discovery.round_done` 的 `pages` 与是否提前到头。
2. **`data/` 是否持久卷**：`data/steam-403.json`、`data/proxy-health.json` 依赖持久化；
   若容器重建丢失，冷却与代理健康会立刻失效。需部署侧确认 compose volumes（DELIVERY §4）。
3. **线上近 7 天 `sync_runs` 实测占槽**：§6.4/§6.5 是理论值，需实测校正（部署侧只读查询）。
4. **代理池条数与 IP 段**：需 ≥2 条且不同 IP 段才有切换收益；若三条来自同一服务商同一段，
   Steam 封段时一起失效（§10 待部署确认）。
5. **免费/无报价游戏热度冻结**：既有缺陷（只在首轮播种），本批不改；做 §6.2 合并时可一并解决。

## 11. 本批不做（写清楚，避免被当成漏项）

- **不把 429/403 切换做成「多 IP 加配额」**：闸门固定 30 次/分钟，切 IP 只为避开被拒的那条；
- 不改其它任务的参数（steam-status/rating-backfill/steam-prices/backfill 全部保持）；
- 不做 heat 合并进 steam-status（§6.2，单独立项）；
- 不做「自动测速/自动选最优代理」（AM-1 §9 既有决策不变）；
- 不改通用代理 `HTTPS_PROXY`（AM-1 决策 6 不变）；
- 不解决重槽超载（§6.4/§6.5 的缺口靠排队）。

## 12. 监工执行记录（FW 批）

> 按 [steamdeals-nightshift](../.dsh/skills/steamdeals-nightshift/SKILL.md) 监工流程：每阶段追加一行
> `HH:MM <阶段> <子批> <结果>`。工人**不改**本文件（由监工统一写）。

| 时间 | 阶段 | 子批 | 结果 |
|---|---|---|---|
| 17:20 | 开工 | — | 规格与条目已确认并推送 `0a9e35a`；环境验证 Node v24（`C:\Users\Administrator\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe`）跑 `test/scheduler.test.js` 48/48；ACTIVE-SESSIONS 已登记 |
| 17:21 | 评估 | — | 三子批**串行**执行（FW-1 与 FW-3 共用 `scheduler.js`；FW-1/WF-2 共用 git 暂存区，历史上出过 `b9356aa` 暂存区串扰事故）→ 不并行、不用 worktree（每子批 5~8 文件，合并成本高于收益） |
| 17:21 | 工人启动 | FW-1 | 派工人 A |
| 17:47 | 工人完成 | FW-1 | 提交 `7c21b29`（12 文件：scheduler / settings / discovery / cli-sync / store 两处 / 测试 4 个 + `package.json` test:3 一行 + 新增 `test/slow-sync.test.js`）；QA 第 1 轮 ✅ 放行（通过 7 / 缺失 0 / 偏差 0 / 需人工确认 2，报告 `docs/QA-FW-1.md`）；CI `test-main` run 45793517473 success |
| 17:52 | 监工审核 | FW-1 | ✅ 通过：① 提交范围 12 文件全在预期内，未越界改共用文档；② 复核 `test/slow-sync.test.js` 4/4、`test/scheduler.test.js` 48/48；③ 代码审查通过——游标「每页推进 / 请求失败不推进 / 空 items 重置 1 / 坏 JSON 兜底回 1」正确，迁移用真 pglite 且「显式值 50 不动 + 二次启动不再迁移」，`app_settings` 表名正确（建表在 `src/settings.js:688`） |
| 17:53 | 工人启动 | FW-2 | 派工人 B（403/429 代理切换 + 全站速率闸门） |
| 18:06 | 工人完成 | FW-2 | 提交 `09c7036`（11 文件 / +1109 −131：`src/rate-gate.js` 新增、`http.js`、`proxy-pool.js`、`settings.js`、`.gitignore`、`package.json` test:1、5 个测试）；QA 第 1 轮 ✅ 放行（7/0/0/4，报告 `docs/QA-FW-2.md`） |
| 18:12 | 监工审核 | FW-2 | ✅ 通过：① 提交 11 文件全在范围内；② 复核 `test/rate-gate.test.js` 8/8、`test/http-proxy-failover.test.js` 14/14；③ 代码审查——`isSteamReject` 正确排除代理层 403（`proxyStatus != null` 走 AM-1）、全池才写全局冷却（403 从 5 分钟起）、`steamRejected` 标记避免包装成 `PROXY_ALL_FAILED`、闸门在每次真实请求前扣 token（含重试）、5xx 不切；④ 反例自检：工人如实报「字面变异（nextCandidate 恒返第一条）不变红」，原因是按代理冷却预过滤使该变异语义等价；改用 `shouldAdvance=false` 等价变异后 5 条用例变红——解释成立、做法有效；⑤ bool 开关格式核对正确（`valueToEnv` 输出 `'1'/'0'`，与 `envFlag` 的 `!=='0'` 匹配，不存在「关不掉」bug） |
| 18:13 | 工人启动 | FW-3 | 派工人 C（403 软退出 76 + 预警节流 + 后台展示） |
| 18:52 | 工人完成 | FW-3 | 提交 `cde8ea9`（14 文件）+ `ee85ffb`（6 文件：steam-status / backfill / fetchMetadata 补 403 重抛，全 Steam 任务统一）+ `9027cb9`（QA 报告入库）；QA 第 1 轮 ✅ 放行（7/0/0/2，报告 `docs/QA-FW-3.md`）；工人自检发现验收第 5 条首版不成立（steam-status 仍 failed、backfill 仍 exit 0），第 2 提交补齐后复检通过 |
| 13:12 | 监工审核 | FW-3 | ✅ 通过：① 三提交范围合规（无越界改共用文档）；② 复核 `test/forbidden-soft-exit.test.js` 6/6、`test/scheduler.test.js` 50/50、`test/sync-harden.test.js` 22/22；③ 代码审查——`soft-exit.js` 75/76 判定正确（403 排除 `proxyStatus != null` 的代理层 403）、`recordJobResult(76)` 不熔断、`applyRetry(76)` 删旧条目（不重排）、预警节流纯函数 + 恢复通知只发一次、`/api/admin/sync/status` 的 `forbidden`/`rateGate` 形状完整（无冷却时 `active:false`，文件缺失按满桶） |
| 13:15 | 收尾 | FW | 三批全绿：TODO/INDEX 状态改「已实现待发版」、ACTIVE-SESSIONS 注销、PROJECT-OVERVIEW 回写、心跳收口；**不构建**（等所有者「构建」指令） |

