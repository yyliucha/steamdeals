# Steam 同步超时修复（EL，待开发，2026-11-20）

> 现象（2026-11-20 所有者）：后台「同步愿望单」报 `{"error":"请求超时，请稍后再试"}`；删掉第一条代理仍超时。
> 关联：`src/steam-login.js`（Steam API 调用）、`src/http.js`（代理池 AM-1）、`src/server.js`（看门狗）、
> `src/routes/site.js`（同步路由）、`src/steam-accounts.js`（同步实现）。

## 1. 根因（代码证据）

| # | 事实 | 位置 |
|---|---|---|
| 1 | 愿望单同步是**同步阻塞接口**：拉 Steam API + 逐条写库 + 对账，全部在请求内 | `steam-accounts.js:87` `syncAccountWishlist`；`routes/site.js` POST .../wishlist/sync |
| 2 | Steam API 单次请求**超时 30s**（可重试 1 次） | `steam-login.js:252` `fetchJson(url,{timeoutMs:30000,retries:1})` |
| 3 | 统一请求看门狗 **15s** 且同步路由**不在豁免名单** | `server.js:447` `requestTimeoutMs=15000`；`server.js:180` `isTimeoutExemptPath` |
| 4 | 代理池切换逻辑存在（失败→冷却→换下一条），**但单条超时 30s 让切换来不及发生** | `http.js` AM-1（`poolRouteForAttempt`/`http.proxy_switch`） |

**结论**：30s 单代理超时 > 15s 看门狗——代理切换还没发生就被看门狗砍掉；同步接口本身也可能超过 15s。

## 2. 方案

### EL-1 代理快速失败（让多代理真正生效）
- `steam-login.js` 的 Steam 同步类调用（`fetchWishlist`/`fetchOwnedGames`/其它同步链路）单次 timeout
  **30s → 8s**；失败交给代理池切换（不长时间重试同一代理）；
- 代理切换/冷却日志保持（`http.proxy_switch` / `http.proxy_cooldown_override`），可观测。

### EL-2 同步异步化（彻底摆脱看门狗）
- `POST /api/steam/accounts/:id/wishlist/sync` 与 `/library/sync` 改为**触发后台任务 + 立即返回**
  （202 `{accepted:true}`；同账号 single-flight，重复触发返回「进行中」）；
- 新增同步状态查询：复用 `steam_logs`（`steam.wishlist_synced`/失败记录）或进程内状态
  （`GET /api/steam/accounts/:id/sync-status` → `idle/running/lastResult`）；
- 前端：点击同步 → 按钮「同步中…」→ 轮询（2s，最长 60s）→ 完成后刷新列表并提示结果；
  失败显示原因（代理失败/429/网络）。

### EL-3 后台 UI 结果反馈
- 成功：「已同步 N 条（新增/删除/自动提醒 M 个）」；失败：明确原因 + 重试按钮；
- 不再出现「请求超时，请稍后再试」这种笼统错误。

## 3. 验收

1. 代理慢/一条不可用时：单次 Steam 请求 8s 内失败并**切换下一条**（日志 `http.proxy_switch` 可见）；
2. 触发同步 → **立即**返回「后台同步中」→ 轮询完成后列表更新（不再有 15s 超时）；
3. 后台显示同步结果/失败原因；重复触发返回「进行中」；
4. 正常网络下单账号愿望单同步成功率与改造前一致；
5. `npm test`（分段）+ `frontend:build` + `scan` 全绿；无 schema 变更。

## 4. 边界

- 不改 Steam API 契约、不改代理池切换策略（只缩短单次超时）；
- EL-1 与 EL-2 可分两次提交/两次 QA；
- 不做：多账号并发同步（保持串行）；玩家 API Key 加密逻辑不动。
