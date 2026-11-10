# 访问记录按 IP 统计（访问明细 / 封禁与白名单 / 设备按设备码）（待开发）

> 状态：**已实现并发布 v2.9.0（2026-11-10）**。
> 关联：[WEB.md](WEB.md)（后台接口）· [BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md)（封禁口径）·
> [ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md)（异常审核按 IP 合并的交互先例）· [ADMIN-CONSOLE-IA.md](ADMIN-CONSOLE-IA.md)

## 1. 现状（代码事实，2026-11-10 核对）

| 项 | 事实 | 证据 |
|---|---|---|
| **访问明细** | 一次访问一行的事件流，服务端分页（默认 20/页），可按 IP/路径过滤、按时间/IP/结果排序 | `src/store/pg.js:2054` `listVisitorLogs`、`/api/admin/visitors` |
| **封禁与白名单** | 两张表**本来就是按 IP 一行**：`ip_blacklist(ip unique, note)` / `ip_whitelist(ip PK, note)` | `pg.js:149-166`、`/api/admin/blacklist`、`/api/admin/whitelist` |
| **设备** | `device_logs`（ip/device_id/fingerprint/UA/时间）**按 `fingerprint` 去重**列出（最多 50/100 条）；`device_bans` 主键是 `fingerprint`，`device_id` 只是辅助列 | `pg.js:281-305`、`listDevices` |
| **访问汇总** | 已有「今日访问/独立 IP/拦截数 + 近 24h 高频 IP」 | `pg.js:2076` `visitorSummary` |
| **异常审核** | 已按 IP 合并（AX 批，v2.7.0）——本批的「IP 视角」交互可复用其展开行样式 | `AdminModules.vue` 合并视图 |

## 2. 已确认的决策（2026-11-10 所有者）

| # | 决策 |
|---|---|
| 1 | **访问明细默认 = IP 统计视图**（每 IP 一行），可切换回「明细」（逐条事件流） |
| 2 | IP 统计列：`IP / 归属地区 / 访问次数 / 首次 → 最近 / 独立路径数 / 设备数 / 状态`（正常·被拦截·已封禁）；展开看该 IP 的最近访问与路径 |
| 3 | **封禁与白名单保留两张表**，每行加统计列：`访问次数 / 最近访问 / 设备数` |
| 4 | **设备按设备码（`device_id`）统计**；没有 `device_id` 的老记录按 `fingerprint` 归组并显示「无设备码」；设备封禁**仍按指纹**（保持现设计） |
| 5 | 统计**默认近 7 天**，可切 1 / 7 / 30 天；分页每页 20；统计查询不扫全表（走 `idx_visitor_logs_created` / `idx_visitor_logs_ip`） |

## 3. 设计

### 3.1 访问明细：IP 统计视图（默认）

- 新接口 `GET /api/admin/visitors/by-ip?days=7&page=1&pageSize=20&q=`（仅管理员）：
  - 返回 `{ items: [{ ip, region, visits, firstAt, lastAt, paths, devices, status }], total }`；
  - `visits` = 时间窗内该 IP 访问次数；`firstAt/lastAt` = 首次/最近；`paths` = `count(distinct path)`；
  - `devices` = `device_logs` 中同 IP 的去重设备数（`count(distinct coalesce(device_id, fingerprint))`，时间窗内）；
  - `status`：`ip_blacklist` 有该 IP → `blocked`（已封禁）；时间窗内有 `visitor_logs.blocked` → `intercepted`（被拦截）；其余 `normal`；
  - 排序：`visits desc`（默认）/ `lastAt desc` / `ip` 数值序（复用 `compareIp`）；
  - 归属地区取该 IP 最近一条日志的 `region`；
- 展开行：该 IP 最近 20 条访问（时间/路径/方法/状态码/是否拦截）+ 访问最多的路径 top 5；
- 「明细」视图：沿用现有 `GET /api/admin/visitors` 与表格（不删功能）；
- 前端 `AdminModules.vue`：访问明细 tab 顶部加视图切换（IP 统计 ↔ 明细），时间窗选择（1/7/30 天）绑定两个视图。

### 3.2 封禁与白名单：加统计列

- `GET /api/admin/blacklist` / `GET /api/admin/whitelist` 返回每行追加：`visits`、`lastAt`、`devices`（近 7 天，`visitor_logs` + `device_logs` 子查询）；
- 前端两张表加三列（`访问次数 / 最近访问 / 设备数`），空值显示 `—`；
- 封禁/解封/移出白名单等现有操作与批量处置**不变**。

### 3.3 设备：按设备码聚合

- `listDevices` 改为按 `coalesce(nullif(device_id,''), fingerprint)` 分组：
  - 返回 `{ key, deviceId, fingerprint, ips, userAgent, lastAt, count, banned }`；
  - `key` = `device_id`（有值时）否则 `fingerprint`，前端标注「无设备码」；
  - `banned` = 该设备是否在 `device_bans`（按指纹匹配，保持现语义）；
- 设备封禁弹窗与 `device_bans` 逻辑不变（仍按指纹封，`device_id` 挂辅助列）。

### 3.4 性能与边界

- IP 统计/设备分组查询均带时间窗条件（`created_at >= now() - interval 'N days'`），走现有索引；
- 不新增表、不新增索引（先看 `EXPLAIN`，必要时再补 `(created_at, ip)` 复合索引——本批不做）；
- 接口参数白名单（`days ∈ {1,7,30}`、排序字段枚举），不拼接用户输入。

## 4. 验收

1. 访问明细默认显示「IP 统计」：每 IP 一行，列含 IP/地区/访问次数/首次→最近/独立路径数/设备数/状态；展开能看到该 IP 最近访问与路径 top；
2. 可切回「明细」逐条视图，过滤/排序/分页与原来一致；
3. 状态区分：黑名单 IP 显示「已封禁」、时间窗内有拦截的显示「被拦截」、其余「正常」；
4. 封禁与白名单：两张表每行显示访问次数/最近访问/设备数（近 7 天），操作不受影响；
5. 设备：同一 `device_id` 合并为一行（多 IP/多 UA 汇总），无设备码的按指纹归组并标注「无设备码」；封禁仍按指纹生效；
6. 时间窗切换 1/7/30 天生效，统计随之变化；
7. `npm test` 全绿（新增 `test/visitor-ip-stats.test.js` 并入主链）、`npm run frontend:build`、`npm run scan`。

## 5. 实施顺序

1. 服务端：`/api/admin/visitors/by-ip` + 黑白名单统计列 + `listDevices` 按设备码聚合；
2. 前端：访问明细视图切换 + 展开行、封禁/白名单统计列、设备列调整；
3. 测试与文档（`.test.js` 进主链、PROJECT-OVERVIEW / WEB.md 同步）。

## 6. 本批不做

- 服务端实时聚合到物化视图（数据量增长后再评估）；
- 设备封禁改按设备码（保持按指纹）；
- 访问明细按路径聚合视图（只做 IP 统计 + 明细两种）。

## 7. 待确认

无（5 个细节已于 2026-11-10 确认）。
