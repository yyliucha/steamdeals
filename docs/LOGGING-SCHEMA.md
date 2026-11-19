# 日志字段规范与告警阈值（CO-4/E4 试点）

> 状态：**开发中（2026-11-18）**。对应 [DESIGN-AUDIT.md](DESIGN-AUDIT.md) **E4 行**（「日志无统一 schema：`域.动作` 靠约定，失败原因格式不一」）。
> 关联：[SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md)（全链路失败模式清单）、`src/log.js`（结构化日志实现）。

## 1. 范围与不做

**本批试点三个域**（按落点文件划分）：

| 域 | 落点 | 说明 |
|---|---|---|
| scheduler | `src/scheduler.js` | 调度、子进程、熔断、失败告警 |
| adapter | `src/adapters/*.js`（8 个适配器） | 采集解析；既有事件名含历史前缀（`steam.meta.*` / `discover.*` / `store_browse.*`），本批**不改名**（改名即回归） |
| ingest | `src/ingest.js` | 入库、结构校验、聚合统计 |

**本批不做**：B4（巨石拆分）/ D4（双结构合并）/ D6（覆盖率门禁）；**不做日志收集与上报系统**——只在现有 `logs/*.jsonl` 落盘之上统一字段，不发外部系统。

## 2. 事件命名（`域.动作`，不回归）

- 格式：`域.动作`，动作段只允许 `[a-z0-9_.-]`；域白名单（`src/log.js` 的 `EVENT_DOMAINS`）：
  `http` / `db` / `adapter.<平台>` / `ingest` / `sync` / `scheduler` / `diagnose` / `process` / `search`（DS 批起）。
- **事件名不回归**：试点域内既有事件名一律不改、不删（新增事件必须用白名单域）。
  `steam.*` / `discover.*` / `store_browse.*` 是白名单外历史前缀，本批冻结现状，统一改名需单独立项。
- 测试锁：`test/log-schema.test.js` 快照试点域全部事件名——改名/删除即红；新增须显式加进快照并核对域白名单。

## 3. 失败事件统一字段

试点域内所有**失败事件**（error 级，以及表示"这条没成"的 warn 级）按下面四字段记录：

| 字段 | 必带条件 | 取值口径 | 示例 |
|---|---|---|---|
| `reason` | **error 级一律必带**；warn 级失败事件鼓励带 | 稳定短码，取第一个命中的：`http_<状态码>` → 错误自身 `code` → 显式传入原因 → `unknown`；截断 120 字符 | `http_429` / `ECONNREFUSED` / `shape_priceCents` / `exit_1` |
| `url` | 涉及出网请求的失败必带 | 本次失败的外部请求地址，一律过 `redactUrl` 脱敏（key/token 类参数抹掉） | `https://store.steampowered.com/api/appdetails?...&key=***` |
| `status` | 有 HTTP 响应时必带 | HTTP 状态码；无响应时为 `null` | `502` |
| `err` | 异常对象可序列化时必带 | `serializeError` 产物（message/code/stack 前 8 行/body 片段） | `{ name, message, code, status }` |

- 统一入口：`src/log.js` 的 `failFields(err, { url, reason })`——试点域失败日志一律经它拼 `reason/status/url`，
  不再手写"message: err.message 截断"这类不一致字段（`message` 可保留作补充）。
- 纯告警事件（熔断触发、聚合阈值触发）带**阈值自描述字段**（`threshold` / `cooldownMin` / `thresholdMin` / `thresholdPct`），
  不要求 `reason`——它们记录的是"越线"本身。

## 4. 告警阈值（哪些事件、连续几次、多长窗口）

| 域 | 触发事件 | 判定（阈值） | 窗口 | 动作 | 可调项 |
|---|---|---|---|---|---|
| scheduler | `scheduler.circuit_tripped`（error） | 同一任务 `scheduler.job_failed` **连续 3 次**（75 软退出不计；成功一次清零） | 按任务自身周期连续计次 | 熔断该任务 360 分钟（期间 `scheduler.circuit_skip` warn）；error 落盘 | `system.circuitThreshold`（默认 3）/ `system.circuitCooldownMin`（默认 360） |
| ingest（shape） | `ingest.shape_threshold`（error） | 单轮 `adapter.*.shape_mismatch` 条数 ≥ **max(5, ⌈总数×50%⌉)** | 一次 `ingestOffers` 调用 | error 级聚合告警（疑似站点改版/契约漂移） | `alerts.ingestAlertMin`（默认 5）/ `alerts.ingestAlertPct`（默认 50） |
| ingest（入库） | `ingest.failure_threshold`（error） | 单轮 `ingest.offer_failed` 条数 ≥ **max(5, ⌈总数×50%⌉)** | 一次 `ingestOffers` 调用 | error 级聚合告警（疑似 DB/连接故障） | 同上 |
| adapter | ——（不单独告警） | 单条解析失败（`no_price` / `shape_mismatch` 等）只落单条 warn/error | —— | 批量信号由 ingest 域的两个聚合事件兜底 | —— |

- 判定实现：`src/ingest.js` 的 `ingestAlertThresholds` / `ingestAlertBreaches`（纯函数，可测）；
  熔断判定沿用既有 `recordJobResult`（`test/scheduler.test.js` 已有阈值断言）。
- 阈值统一走 `src/settings.js` 的 `def()`（页面可改、热加载，水合进 env），不新增部署期环境变量语义。
- 与 CO-1/A5 的分工：A5 是"任务失败邮件告警"（`alerts.jobFailureEmail`，默认关）；本批是"日志里的告警阈值事件"，互不替代。

## 5. 测试锁

| 测试 | 锁什么 |
|---|---|
| `test/log-schema.test.js` | ① 试点域事件名快照（不回归）；② 事件名格式与域前缀；③ error 级失败事件必带 `reason`/`failFields`/`err`（纯告警事件豁免） |
| `test/ingest.test.js` | 阈值解析与边界、两个聚合告警的触发/不触发、`offer_failed`/`shape_mismatch` 的 `reason` 字段 |
| `test/log.test.js` | `failFields` 的 reason/status/url 提取与脱敏 |
| `test/scheduler.test.js` | 熔断阈值（3 次 → 6h 窗口）既有断言 |

## 6. grep 取证（验收证据）

```powershell
# 试点域失败事件带 reason / url / status 的证据
rg -n "failFields|reason:" src/scheduler.js src/ingest.js src/adapters/*.js
# 聚合告警事件落点
rg -n "shape_threshold|failure_threshold|circuit_tripped" src/ingest.js src/scheduler.js
# 事件名快照与字段锁
node test/log-schema.test.js
```
