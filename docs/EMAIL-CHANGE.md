# 更换登录邮箱（CZ 二期：邮箱体系收尾）（已发布 v2.25.0）

> 状态：**已发布 v2.25.0（2026-11-19，站点 ac52955 + App 仓库 7c01820；QA docs/QA-CZ.md 第 1 轮 ✅ 放行 11/0/0/2；App 发版 app-v2.21.0）**。决策与验收口径见 §2/§4（2026-11-18，所有者 5 项决策已确认；App 端同样支持）。
> Demo：[design/email-change-2026-11-18.html](design/email-change-2026-11-18.html)（Web）/ [design/email-change-android-2026-11-18.html](design/email-change-android-2026-11-18.html)（App）
> 关联：[TODO.md](TODO.md) CZ 条目、[USER-PROFILE-EDIT.md](USER-PROFILE-EDIT.md)（CX 资料页）、
> [AUTH-REDESIGN.md](AUTH-REDESIGN.md)（AK 批邮箱验证码登录取证）、`src/auth-routes.js`（现有 OTP 实现）。

## 1. 现状（2026-11-18 代码核对）

| 能力 | 现状 | 证据 |
|---|---|---|
| 邮箱验证码登录 | ✅ 已实现 | `src/auth-routes.js`：`/api/auth/email/request` + `/verify`（purpose=login）；`LoginPage.vue` 已接入 |
| 忘记密码（验证码重置） | ✅ 已实现 | 同接口 `purpose=reset` → `setUserPassword` |
| 邮箱验证码注册 | ✅ 已实现 | `/api/auth/register/request` + `/register/verify`；`RegisterPage.vue` 已接入 |
| **用户自助更换邮箱** | ❌ **无** | 仅管理员可绑定/解绑用户邮箱（`server.js:3506`，含旧邮箱通知逻辑） |
| OTP 基础设施 | ✅ | `email_codes`（purpose/attempts/used_at/过期）+ 频控 + 审计日志 |

→ 本批**不重复实现**验证码登录/忘记密码，只做「更换邮箱」+ 少量加固。

## 2. 已确认决策（所有者 2026-11-18）

| # | 决策 |
|---|---|
| 1 | 流程：个人资料页「更换邮箱」→ **验证码发到新邮箱** → 校验通过才更新 → **旧邮箱收安全通知**。 |
| 2 | 换成功后 **全部会话下线**（含当前会话），前端跳登录并提示「邮箱已更新，请用新邮箱重新登录」。 |
| 3 | 频控：验证码 10 分钟有效、最多 5 次尝试（复用现有 OTP 机制）；**换邮箱 24 小时内最多 1 次**。 |
| 4 | 未验证邮箱的用户**也可以换**；换成功后 `email_verified = true`。 |
| 5 | **保留管理员的邮箱重置能力**（安全兜底），但必须记审计 + 通知用户。 |

## 3. 接口设计

| 方法与路径 | 说明 |
|---|---|
| `POST /api/me/email/request` | 登录用户；body `{ newEmail }`；校验格式；**不泄露占用情况**（已占用也返回"验证码已发送"）；写 `email_codes(purpose='change_email', user_id, new_email)`；频控（用户 24h 1 次 + IP 频控复用现有）。 |
| `POST /api/me/email/verify` | 登录用户；body `{ newEmail, code }`；校验 OTP（purpose/attempts/过期）；通过后：① 新邮箱已被他人占用 → `409 {error:'该邮箱不可用'}`；② 更新 `users.email / email_verified=true / email_updated_at`；③ 删除该用户**全部会话**；④ 审计 `auth.email_changed`；⑤ 发两封邮件（旧邮箱：「登录邮箱已变更」安全通知；新邮箱：「绑定成功」）。 |
| `PATCH /api/admin/users/:id/email`（已有，保留） | 管理员重置邮箱；补审计 `admin.email_reset` + 通知（已有通知逻辑复用）。 |

前端：`ProfilePage.vue` 邮箱行加「更换邮箱」按钮 → 对话框（新邮箱输入 + 发送验证码 + 6 位验证码 + 确认）；
成功后跳登录页并提示。**App 端（`ProfileEditScreen`）同样支持**：同一套接口，底部弹层两步完成（见 Android demo）；
成功后清本地 token 并跳登录页。

## 4. 验收

1. 换邮箱成功：`users.email` 更新、`email_verified=true`、旧邮箱收安全通知、新邮箱收绑定成功；
2. 换完成后当前会话失效（下一次请求 401 → 跳登录），其它设备会话也被踢；
3. 验证码错误/过期/超次数有明确提示；新邮箱被占用在**验证码通过后**才提示（不泄露）；
4. 24 小时内第二次换邮箱被 429 拒绝并给 `retryAfterSec`；
5. 未验证邮箱用户可正常换；
6. 管理员重置邮箱仍可用，且落审计 + 通知；
7. **App 端可完整完成换邮箱**（发送验证码 → 验证 → 清 token 跳登录），与 Web 共用接口；App 模拟器走通 + 截图；
8. `npm test`（`test/email-change.test.js`：成功/占用/过期/频控/会话清空/审计）/ `frontend:build` / `scan` 全绿。

## 5. 已确认（2026-11-18）

1. **App 端本期就做更换邮箱**（不是占位）——同一套接口，底部弹层两步完成；
2. 管理员重置邮箱保留，需二次确认（输入用户昵称确认）。

