# 数据隔离：用户私有数据管理员只读（CY，已发布 v2.25.0）

> 状态：**已发布 v2.25.0（2026-11-19，实现 3351f9f；QA docs/QA-CY.md 第 1 轮 ✅ 放行 6/0/0/0；`test/isolation.test.js` 随本批注册进主链 test:4）**。
> 关联：[TODO.md](TODO.md) CY 条目、[USER-PROFILE-EDIT.md](USER-PROFILE-EDIT.md)（CX：个人资料）、
> [USER-ALERTS.md](USER-ALERTS.md)（CL：用户级提醒）、[HANDOVER.md](HANDOVER.md) §6（权限）。

## 1. 现状（2026-11-18 代码核对）

用户级数据目前两类接口并存：

| 类型 | 接口 | 现状 |
|---|---|---|
| 用户自己的（按 `session.user.id`） | `/api/watchlist`、`/api/wishlist`、`/api/steam/accounts`、`/api/games/:appid/interest` | 已是"自己的"（前端不传 userId） |
| **管理员跨用户**（`/api/admin/*`） | `/api/admin/watchlist`（全站到价提醒）、`/api/admin/wishlists`（站点愿望单）、`/api/admin/views`（访问记录）、`/api/admin/steam-logs`、`/api/admin/devices`、`/api/admin/sessions` | **管理员可写**（如后台「全站到价提醒」有「删除」按钮，会删用户提醒） |

**问题**：用户私有数据（愿望单/到价提醒/标记/Steam 绑定）可被管理员直接修改/删除，没有只读边界。

## 2. 已确认口径（所有者 2026-11-18）

| 类别 | 接口 | 管理员权限 |
|---|---|---|
| **用户私有数据** | `/api/admin/watchlist`（`user_id IS NOT NULL` 的行）、`/api/admin/wishlists`、`/api/admin/views`、Steam 绑定详情 | **只读**（可看、不可改/删） |
| **站点级数据** | `/api/admin/watchlist` 中 `user_id IS NULL` 的站点级提醒、站点公告、黑名单/白名单 | **可写**（属站点配置） |
| **账号安全** | `/api/admin/users`（封禁/解封/删除）、`/api/admin/sessions`（踢下线）、`/api/admin/devices`（设备封禁） | **可写**（运维必需） |
| **内容审核** | `/api/admin/reviews`（评论审核）、`/api/admin/appeals`（申诉处理） | **可写**（审核/处理职责） |
| **未归属 Steam 账号** | `POST /api/steam/accounts/:id/claim`（仅 `user_id IS NULL`） | **可写**（认领孤儿账号，不动他人） |
| **已归属 Steam 账号** | 解绑/别名/API Key | **只读**（管理员不可代操作） |

## 3. 改动落点

- `src/server.js`：
  - `/api/admin/watchlist` 的 **DELETE/PATCH 仅允许 `user_id IS NULL`** 的行；用户行返回 `403 {error:'用户提醒只读，请让用户自行操作'}` 并记审计 `admin.forbidden_write`；
  - `/api/admin/wishlists`、`/api/admin/views` 只保留 GET（去掉任何写方法）；
  - 用户级接口统一 `WHERE user_id = $sessionUser`，**忽略**请求里的 `userId` 参数（已有则加断言）；
  - 审计：所有管理员越权写尝试落 `audit_logs`（`action='admin.forbidden_write'`, target, actor）。
- `frontend/src/pages/AdminModules.vue`（到价提醒/站点愿望单）：用户行隐藏「删除/编辑」按钮，显示「只读」标识；站点级行保留操作。
- 测试：`test/isolation.test.js`——两个用户 A/B：A 不能读 B 的 watchlist/wishlist（403/空）；管理员 GET 全部 200、写用户行 403、写站点级 200；审计落库断言。

## 4. 验收

1. 普通用户 A：`/api/watchlist` 只返回 A 的数据；手动带 `userId=B` 无效；
2. 管理员：`/api/admin/watchlist` 返回全部（含用户名），但用户行**无删除按钮**；直接 PUT/DELETE 用户行 → **403 + 审计**；
3. 站点级提醒仍可编辑/删除（不受影响）；
4. 账号安全/申诉/评论审核操作不受影响（回归通过）；
5. 管理员查看他人 Steam 绑定为只读（无解绑/别名按钮）；
6. `npm test` / `frontend:build` / `scan` 全绿。

## 5. 待确认

1. 后台「全站到价提醒」的用户行是否也需要「代删除」的紧急通道？（建议：不提供；确有需要时由所有者走 DB/脚本）
2. 审计日志保留时长与查询入口（操作日志页已存在，建议复用）。
