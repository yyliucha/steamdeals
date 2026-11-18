# 到价提醒手动推送（DF，待开发 / 待确认 4 点）

> 状态：**已确认待开发（2026-11-18，所有者：这里做个功能，支持重发，有个推送按钮）**；4 个口径待定。
> 关联：[TODO.md](TODO.md) DF 条目、[USER-ALERTS.md](USER-ALERTS.md)（CL）、[DATA-ISOLATION.md](DATA-ISOLATION.md)（CY）、
> `src/alerts.js`（evaluateAlerts/renderDigest/toPayload）、`src/notify.js`（投递）、`src/cli.js`（`alerts --mark` 语义）。
> Demo：[design/alert-manual-push-2026-11-18.html](design/alert-manual-push-2026-11-18.html)

## 1. 现状（2026-11-18 代码核对）

- 提醒只由调度任务 `alerts` 触发（默认每 360 分钟，`ALERTS_INTERVAL_MIN`），发送走 `notify.js`（邮件/Webhook/企业微信）；
- 后台「到价提醒」页每行只有**删除**，没有手动发送入口；
- 发送判定在 `evaluateAlerts`：`current <= target`（有目标价）或 `current <= hist_low`（无目标价）；`current == null` 跳过；
  `--mark` 会写 `last_notified_cents/at`（去重）。

## 2. 需求（已确认部分）

| # | 内容 |
|---|---|
| 1 | 后台「到价提醒」每行新增「**推送**」按钮 → 确认弹窗（游戏/用户/当前价/史低/上次提醒/渠道）→ 确认后立即发送。 |
| 2 | 弹窗提供两个选项：**强制推送**（即使未达目标价/史低也发，用于测试/补发）；**更新最近提醒时间**（写 `last_notified_*`，默认勾选）。 |
| 3 | 未配置任何通道时按钮禁用 + 提示「先在系统设置配置通知通道」。 |
| 4 | 发送结果在页面提示（成功/失败原因），并落审计。 |

## 3. 接口设计

| 方法与路径 | 说明 |
|---|---|
| `POST /api/admin/watchlist/:id/push` | body `{ force?: boolean, mark?: boolean }`；管理员；按 id 取 watch + 价格（`watchCandidates` 单条）；`force=false` 且未达条件 → `200 {sent:false, reason:'not_met'}`；达条件或 force=true → 生成 digest（复用 `renderDigest`/`toPayload`）→ `notify` 投递；`mark=true` 时更新 `last_notified_*`；返回 `{sent, channel, messageId?}`；写审计 `admin.alert_pushed`。 |
| 频控 | 同一 watch 60 秒内重复推送 → `429 {retryAfterSec}`（防误触/刷屏）。 |
| 批量（可选） | `POST /api/admin/watchlist/push` body `{ ids: [] }`，逐条发送并返回结果汇总。 |

## 4. 验收

1. 站点级可达条件：点推送 → 收件人邮箱收到「到价提醒」邮件，页面提示成功；
2. 站点级未达条件：不勾强制 → 提示「当前未达提醒条件（当前 ¥x / 目标 y）」，不发信；
3. 勾「强制推送」→ 无论是否达条件都发；文案标注「手动推送」；
4. 勾「更新最近提醒时间」→ `last_notified_cents/at` 更新，后续自动任务不重复提醒同价格；不勾 → 不改；
5. 60 秒内二次点击 → 429 提示；审计 `admin.alert_pushed` 有记录；
6. 未配置通道 → 按钮禁用 + 提示；
7. `npm test`（`test/alert-push.test.js`：达标/未达标/强制/mark/频控/通道缺失/审计）/ `frontend:build` / `scan` 全绿。

## 5. 待确认（4 点）

1. **用户级提醒能不能推？** CY 规定管理员对用户私有数据只读；推送=给用户发信，建议**只对站点级开放**（用户级行按钮禁用，提示"由用户自己的提醒设置生效"）——你的意见？
2. **「更新最近提醒时间」默认勾选**（推荐）还是不勾？
3. 是否需要**批量推送**（选中多条一次发）？
4. 频控 60 秒是否合适（或 5 分钟）？
