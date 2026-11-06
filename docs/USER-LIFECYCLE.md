# 用户生命周期：彻底删除 + 变更通知 + 邮件模板化（已确认待开发）

> 状态：**需求与方案已确认（2026-11-06），待开发**。本批拆三条待办（编号待入 [TODO.md](TODO.md) 时落定，
> 暂记 **AH** 删除 / **AI** 邮件模板与 HTML / **AJ** 账号变更通知）。
> 关联：[ADMIN-PARITY.md](ADMIN-PARITY.md)（后台模块）、[MAIL-CONFIG-PAGE.md](MAIL-CONFIG-PAGE.md)（邮件服务页）、
> [WEB.md](WEB.md)（接口）、[HANDOVER.md](HANDOVER.md)（状态词与流程）。

## 1. 现状（代码事实，2026-11-06 核对）

| 项 | 事实 | 证据 |
|---|---|---|
| 用户列表动作 | 只有 **改名 / 邮箱 / 验证 / 重置密码 / 禁用·启用**，**没有删除** | `frontend/src/pages/AdminExtras.vue:5` |
| 后端用户接口 | `GET/POST /api/admin/users`、`PATCH /api/admin/users/:username`（display_name/role/disabled）、`POST .../password`；**没有 DELETE** | `src/server.js:2225`、`:2265`、`:1731`、`:1747` |
| 操作后刷新 | 改名、禁用/启用已 `await loadUsers()`；删除需新加同款刷新 | `AdminExtras.vue:125`、`:129` |
| 用户变更邮件 | **完全没有**：全仓邮件只有验证码、测试邮件、降价提醒、价格报表四类 | `src/auth-routes.js:110`、`src/server.js:1690`、`:2083`、`src/cli.js:743` |
| 批量禁用/启用 | 走 `POST /api/admin/bulk`（`target=users`），**不触发任何邮件** | `AdminExtras.vue:94`、`server.js` 的 `/api/admin/bulk` |
| 邮件构造 | `buildMessage()` 只生成 **text/plain**（base64），无 `multipart/alternative` | `src/notify.js:92-112` |
| SMTP 超时 | `sendMail` 默认 `timeoutMs=15000` | `src/notify.js:242` |
| 发送记录 | 「最近发送记录」读 `email_codes`（验证码/绑定专用，`code_hash` 非空），**通知类邮件没有落表** | `AdminExtras.vue:40`、`server.js:2114`、`src/email-auth.js:133` |
| 改邮箱 | 绑定时 `email_verified=false`；**变更前不读旧邮箱**，没有变更通知 | `server.js:2136` |
| 硬删除级联 | 级联删 `sessions`、`user_prefs`、`user_game_flags`、`user_wishlist`、`announcement_reads`、`steam_accounts`（含 API Key）；`page_views`/`announcements.created_by`/`email_codes.user_id` 置空；**`steam_games`/`steam_wishlist` 无外键，必须手动清** | `src/store/pg.js:203-262`、`src/steam-login.js:16-71` |
| 审计先例 | `admin_bulk_ops` 冗余存 `actor` 用户名（用户删除后记录仍可读） | `src/store/pg.js:311-326` |

## 2. 已确认的决策（2026-11-06 所有者）

| # | 决策 |
|---|---|
| 1 | **做硬删除**；保留删除审计（谁删了谁/时间/原因/关联数据计数，**不含密码与完整邮箱**）；**不能删自己**；不能删到"一个可用管理员都不剩" |
| 2 | 删除确认 = 弹窗 + **输入用户名**确认；**本期不做批量删除** |
| 3 | 通知事件：**禁用 / 启用 / 删除 / 改名 / 改邮箱 / 改角色 / 重置密码** 共 7 类操作；改邮箱一次发两封（已变更 + 绑定成功），所以邮件事件是 **8 类**；重置密码邮件**不含新密码**，只写"已重置，请向管理员获取新密码" |
| 4 | 邮件格式 = **HTML 多部分（multipart/alternative，含纯文本兜底）** |
| 5 | 模板范围 = **账号通知 8 类 + 验证码邮件（共 9 个模板）**；降价提醒/申诉回复下一批；模板存**独立表**，每事件可单独启停 |
| 6 | 邮件失败**不影响业务操作**；未绑定邮箱**跳过并提示**；结果进日志 + 界面提示 |
| 7 | **新增 `mail_log`**：所有非验证码外发邮件（账号通知、测试邮件、以后的降价提醒）统一落一行；「最近发送记录」分 **验证码 / 通知** 两个 tab |
| 8 | **改邮箱的通知发旧邮箱**（防账号被盗的关键提醒）；旧邮箱为空或未验证时改发新邮箱 |
| 9 | **批量禁用/启用不发用户通知**（只记日志）；单条操作才发 |
| 10 | 禁用/删除弹窗加**可选"原因"**：只进审计与日志，**不进邮件** |
| 11 | 用户管理页加「最近删除」只读表（最近 50 条） |
| 12 | 模板**统一页脚由代码追加**（站点名/地址/联系邮箱/请勿回复）；`{{code}}` 只对验证码事件可用；主题不加前缀 |
| 13 | 发送**串行**、单封超时 **8 秒**、失败不重试 |
| 14 | 删除后**用户名立即可重新注册**（唯一约束随删行释放；审计表保留历史） |
| 15 | 通知里操作者统一写「站点管理员」，不暴露具体管理员账号 |
| 16 | 「最近删除」支持**按用户名搜索**（模糊匹配，服务端 `q` 参数） |
| 17 | 模板除 9 类默认文案外，再预置 **3 套示例版式**（简洁 / 卡片 / 正式），可一键套用后再改 |
| 18 | 改邮箱发 **两封**：旧邮箱收"登录邮箱已变更"、新邮箱收"绑定成功"确认；新旧邮箱相同时只发一封 |

## 3. 数据模型

### 3.1 `mail_templates`（新增，跟着 `ensureEmailSchema` 建）

```sql
create table if not exists mail_templates (
  event      text primary key,            -- account_disabled | account_enabled | account_deleted
                                          -- | account_renamed | account_email_changed | account_email_bound
                                          -- | account_role_changed | account_password_reset | verify_code
  subject    text not null,
  body_html  text not null,
  body_text  text,                        -- 空 = 由 HTML 自动生成纯文本兜底
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);
```

- **默认值写在代码里**（`src/mail-templates.js` 的 `DEFAULT_TEMPLATES`）；表里没有该 event 行 = 用默认，
  「恢复默认」= `delete from mail_templates where event=$1`。
- 统一页脚**不进模板正文**：渲染时由代码追加，模板作者改不到它。

### 3.2 `admin_user_deletions`（新增，审计）

```sql
create table if not exists admin_user_deletions (
  id             bigserial primary key,
  username       text not null,
  role           text not null,
  email_masked   text,                    -- 例：a***@163.com；无邮箱为 null
  steam_accounts int not null default 0,
  sessions       int not null default 0,
  deleted_by     text not null,           -- 操作者用户名快照（操作者以后被删也能读）
  deleted_by_id  integer references users(id) on delete set null,
  reason         text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_admin_user_deletions_time on admin_user_deletions (created_at desc);
```

**不存**：`password_hash`、完整邮箱、Steam API Key、SteamID 列表、会话 token、IP。

### 3.3 `mail_log`（新增，通知类邮件发送记录）

```sql
create table if not exists mail_log (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  event       text not null,              -- account_disabled … | test | price_alert（以后）
  to_email    text not null,              -- 仅管理员页面可见；写日志时打码
  subject     text,
  ok          boolean not null default false,
  error       text,
  actor       text                        -- 触发者：管理员用户名 / 'system'
);
create index if not exists idx_mail_log_time on mail_log (created_at desc);
```

- 验证码邮件仍由 `email_codes` 记录（那张表要存 `code_hash`/有效期，不能合并）；
  页面上两个 tab：**验证码**（读 `email_codes`）/ **通知**（读 `mail_log`）。

### 3.4 不新增业务设置

模板不塞 `app_settings`（否则「系统设置」页会被十几个模板字段淹没，也无法做每事件启停）；
站点名用常量 `SteamDeals`，站点地址取请求 Origin（`{{siteUrl}}`），联系邮箱取 `alerts.appealEmail`。

## 4. 服务端

### 4.1 删除接口 `DELETE /api/admin/users/:username`

请求体：`{ confirmUsername: string, reason?: string }`

校验顺序（任一失败直接返回，不落库）：

| 情况 | 返回 |
|---|---|
| 非管理员 | 403（既有 `requireAdmin`） |
| 目标不存在 | 404 `{ error: '没有该用户' }` |
| `confirmUsername !== username` | 400 `{ error: '请输入完整用户名确认' }` |
| 目标是当前登录用户 | 400 `{ error: '不能删除自己' }` |
| 目标是启用中的管理员，且删除后**可用管理员**为 0（`role='admin' and not disabled`） | 409 `{ error: '不能删除最后一个可用管理员' }` |

执行（单事务）：

1. 取 `email`、`email_verified`、`role`、`disabled`、SteamID 列表、`sessions` 计数、`steam_accounts` 计数；
2. `delete from steam_games where steam_id = any($1)`、`delete from steam_wishlist where steam_id = any($1)`（无外键，必须显式清）；
3. `delete from users where username=$1`（其余表靠级联 / 置空，**已有会话立即失效**）；
4. `insert into admin_user_deletions (...)` 落审计（`reason` 可空）。

响应：`{ ok: true, deleted: { username, steamAccounts, sessions }, notify: 'queued' | 'skipped_no_email' }`

- 事务提交后**异步**发通知（不 await、不阻塞响应）：`notifyUserAction({ action: 'account_deleted', ... })`；
  发送失败只记日志 + `mail_log`，不影响已完成的删除。
- 日志：`admin.user_deleted { username, role, steamAccounts, sessions, by, reason }`。

### 4.2 通知模块 `src/account-notify.js`（新增）

```js
export async function notifyUserAction({
  q, logger, user,        // { username, email, display_name?, role?, disabled?, email_verified? }
  action,                 // 8 类事件之一
  operator = '站点管理员',
  siteUrl,
  to = null,              // 覆盖收件人（改邮箱时用旧邮箱）
  extra = {},             // 模板变量补充
})
// 返回 { status: 'sent' | 'skipped_no_email' | 'skipped_disabled' | 'failed', error? }
```

- 读模板（表 → 默认值）→ `enabled=false` 直接跳过 → 无收件人返回 `skipped_no_email`；
- 渲染变量（HTML 转义）→ 追加统一页脚 → `sendMail({ ..., subject, text, html })`；
- **每次发送写一行 `mail_log`**（成功 `ok=true`，失败写 `error`；日志里的收件人打码）；
- 日志事件：`admin.user_notify_sent { action, username, event }` / `admin.user_notify_failed { action, error }`；
- **串行队列**：模块级 `let queue = Promise.resolve()`，同一进程内一封一封发，避免 SMTP 并发被限流；
  单封 `timeoutMs: 8000`，失败不重试；
- 被调用点：
  - `PATCH /api/admin/users/:username`：请求体增加可选 `reason`（只写日志）→ 先读旧行 → `updateUser` → 对比字段：
    `disabled` 变 true/false → `account_disabled`/`account_enabled`；`role` 变了 → `account_role_changed`；
    `display_name` 变了 → `account_renamed`；**一次请求最多发一封**（同时改了多项时取优先级最高的一条：
    disabled > role > display_name），快操作 **await 发送**，响应体增加 `notify: { status, error? }`；
  - `POST /api/admin/users/:username/email`：先读旧行（`email`、`email_verified`）→ 绑定（新邮箱 `email_verified=false`）→
    **发两封（异步，响应 `notify:'queued'`，避免两封串行拖住请求）**：旧邮箱收 `account_email_changed`
    （安全提醒；旧邮箱为空/未验证时改发新邮箱）、新邮箱收 `account_email_bound`（绑定成功确认）；
    **新旧邮箱相同时只发「绑定成功」一封**；
  - `POST .../password` → `account_password_reset`；
  - `DELETE` → `account_deleted`（先取邮箱，删完再异步发）；
  - **`/api/admin/bulk` 的 users 禁用/启用不调用本模块**（决策 9）。
- 创建用户不通知（初始密码由管理员当面给，邮件里不能写密码）。

### 4.3 模板 API（仅管理员）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/mail/templates` | 9 个事件：`{ event, label, subject, body_html, body_text, enabled, isDefault, variables }` |
| PUT | `/api/admin/mail/templates/:event` | `{ subject, body_html, body_text?, enabled }`；校验：event 在白名单、subject ≤200 且**去掉 CR/LF**、body_html ≤20000、非验证码事件不允许出现 `{{code}}` |
| POST | `/api/admin/mail/templates/:event/reset` | 删表行，恢复默认 |
| POST | `/api/admin/mail/templates/:event/preview` | 用示例数据渲染，返回 `{ subject, html, text }`，不发送 |
| POST | `/api/admin/mail/templates/:event/test` | `{ to }` 发给指定地址（默认当前管理员邮箱），走同一发送路径并写 `mail_log(actor=当前管理员)` |

### 4.4 HTML 邮件（`src/notify.js`）

- `buildMessage({ from, to, subject, text, html })`：
  - 有 `html` → `Content-Type: multipart/alternative; boundary="..."`，两段（text/plain + text/html，均 base64）；
  - 无 `html` → 保持现在的 `text/plain` 单段（向后兼容，测试邮件/降价提醒不受影响）。
- `sendMail({ ..., html })` 透传。
- **主题头注入防护**：`encodeSubject` 之前把 `\r\n` 去掉（现在纯 ASCII 主题会原样进头部，模板可注入 `Bcc:`）。
- HTML 变量值统一 `escapeHtml()`；未知变量原样保留，保存时提示。
- 统一页脚（代码追加，模板不可改）：

```html
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
<p style="color:#6b7280;font-size:12px;line-height:1.6">
  SteamDeals · {{siteUrl}} · 联系 {{contactEmail}}<br>本邮件由系统自动发送，请勿直接回复。
</p>
```

### 4.5 两个只读接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/users/deletions?q=&limit=50` | 读 `admin_user_deletions`；`q` 按用户名模糊匹配（`username ilike '%'||$1||'%'`），倒序，limit ≤ 200 |
| GET | `/api/admin/mail/log?limit=200` | 读 `mail_log`，倒序，limit ≤ 500；`to_email` 只在管理员页面展示 |

## 5. 前端

### 5.1 用户管理（`AdminExtras.vue` 用户表）

- 行内新增 `<el-button link type="danger" @click="deleteUser(row)">删除</el-button>`：
  - `row.id === props.me?.id` 时不渲染（`Console.vue:20` 已传 `:me="user"`；后端仍兜底）；
  - 目标是启用中的管理员且 `activeAdminIds`（`AdminExtras.vue:85`）只剩 1 个时置灰 + tooltip「最后一个可用管理员不能删除」。
- `deleteUser(row)`：打开一个 **`el-dialog`**（别用 `ElMessageBox.prompt`——它只有一个输入框，放不下"确认用户名 + 原因"）：
  - 顶部 `el-alert type="error"` 列出将删除的内容：登录会话 N 个、绑定 Steam 账号 M 个、愿望单与游戏标记；
    并写明"删除后立即退出登录，**不可恢复**"；
  - 输入框 1（必填）：必须输入 `row.username` 才能点确认；
  - 输入框 2（可选）：删除原因——只进审计，**不进邮件**；
  - 底部：取消 / 确认删除（`disabled` 直到用户名匹配，`loading` 期间防重复提交）；
  - 提交 `DELETE /api/admin/users/<username>`（带 `confirmUsername`、`reason`）；
  - 成功 → `await loadUsers()` + `await loadDeletions()`；若删的是当前页最后一条且 `usersPage>1` → `usersPage--` 并重拉；
  - toast：`notify==='queued'` → 「已删除，通知邮件稍后发送」；`skipped_no_email` → 「已删除（该用户未绑定邮箱，未发送通知）」。
- 列表下方新增「最近删除」只读表（`GET /api/admin/users/deletions`）：用户名 / 角色 / 删除时间 / 操作者 / 关联 Steam 账号数 / 原因；
  表头一个**搜索框**（按用户名模糊搜，回车或点「搜索」触发，清空恢复全部），空态「暂无删除记录」。

### 5.2 邮件服务页（`AdminExtras.vue` `section==='mail'`）

- 新增「邮件模板」卡：事件 tab（**8 个账号通知 + 验证码**）；每个 tab：启用开关、主题输入、
  HTML 正文 textarea（等宽字体）、变量按钮条（点击插入）、按钮 **预览 / 套用示例 / 发送测试 / 恢复默认 / 保存**；
- 「套用示例」下拉提供 **3 套版式**（简洁版 / 卡片版 / 正式版）：选中后把示例填进主题与正文（**不自动保存**，
  再点保存才生效），示例里已带常用变量，方便直接改文案；
- 预览：弹窗内 `v-html`（管理员自己写的内容，不做富文本编辑器、不引第三方依赖）；
- 变量条：`{{siteName}}` `{{siteUrl}}` `{{username}}` `{{action}}` `{{time}}` `{{operator}}` `{{contactEmail}}`
  （验证码事件额外有 `{{code}}`）；
- 保存前校验未知变量（`{{...}}` 不在白名单）→ 允许保存但 `ElMessage.warning`；非验证码事件含 `{{code}}` → 直接拒绝；
- 「最近发送记录」改为两个 tab：**验证码**（现有 `email_codes`）/ **通知**（`mail_log`，列：时间 / 事件 / 收件人 / 主题 / 结果 / 错误）。

## 6. 通知内容（默认模板要点）

| 事件 | 默认主题 | 收件人 | 正文要点（**均不含敏感信息**） |
|---|---|---|---|
| `account_disabled` | 你的账号已被停用 | 当前邮箱 | 停用时间、原因（不展示内部备注）、联系管理员 |
| `account_enabled` | 你的账号已恢复 | 当前邮箱 | 恢复时间、可直接登录 |
| `account_deleted` | 你的账号已被删除 | 删除前邮箱 | 删除时间、数据已清除、如有异议如何联系（**不写原因**） |
| `account_renamed` | 你的显示名已修改 | 当前邮箱 | 新显示名、时间 |
| `account_email_changed` | 你的登录邮箱已变更 | **旧邮箱**（旧邮箱空/未验证 → 新邮箱） | 变更时间、新邮箱打码、如非本人操作立即联系管理员 |
| `account_email_bound` | 新邮箱绑定成功 | **新邮箱** | 绑定时间、该邮箱今后用于登录验证、如非本人操作立即联系管理员 |
| `account_role_changed` | 你的账号权限已变更 | 当前邮箱 | 新角色（管理员/普通用户）、时间 |
| `account_password_reset` | 你的密码已被重置 | 当前邮箱 | **不写密码**；"请向管理员获取新密码，登录后立即修改"、时间 |
| `verify_code` | 验证码（登录/重置/绑定） | 请求邮箱 | 6 位验证码、5 分钟有效、非本人操作忽略 |

变量：`{{siteName}}`（固定 SteamDeals）、`{{siteUrl}}`、`{{username}}`、`{{action}}`、`{{time}}`（站点时区）、
`{{operator}}`（固定「站点管理员」）、`{{contactEmail}}`（`alerts.appealEmail`）、`{{code}}`（仅验证码）。
**禁止**出现在模板变量里：密码、临时密码、token、API Key、IP、SteamID、完整邮箱。

## 7. 安全

1. 删除/模板/记录接口全部 `requireAdmin`；删除必须 `confirmUsername` 精确匹配；
2. 不能删自己；不能删到 0 个可用管理员（后端判定 `role='admin' and not disabled`）；
3. 审计表只留脱敏信息（邮箱打码、不存 token/Key）；
4. 主题去 `\r\n` 防头注入；HTML 变量 `escapeHtml`；
5. 模板长度上限（subject 200 / HTML 20000）；`test` 接口限流（同一管理员 10 秒 1 次）；
6. 删除事务里先清 `steam_games`/`steam_wishlist` 再删用户，避免孤儿数据；
7. `mail_log.to_email` 只渲染在管理员页面，写日志时打码。

## 8. 验收

1. 删除弹窗必须输入用户名才能提交；输错返回 400，列表不变；
2. 删除成功后**列表立即少一行**（无整页刷新），「最近删除」立即多一行；被删用户已有会话失效（其浏览器下一次请求即 401/跳登录）；
3. 删除后库内：`users` 无该行；`sessions`/`user_prefs`/`user_game_flags`/`user_wishlist`/`announcement_reads`/`steam_accounts` 无该用户数据；
   `steam_games`/`steam_wishlist` 无该用户 SteamID 的行；`admin_user_deletions` 新增 1 行且无敏感字段；
4. 护栏：删自己 400；删最后一个可用管理员 409；目标不存在 404；
5. 7 类操作各触发通知（SMTP 用桩断言收件人/主题/正文），正文不含密码/token/API Key/IP/完整邮箱；
   **改邮箱触发两封**：旧邮箱收「已变更」（旧邮箱未验证时改发新邮箱）、新邮箱收「绑定成功」；新旧邮箱相同时只发一封；
6. 未绑定邮箱的用户：操作成功、`notify=skipped_no_email`、界面提示"未发送"；
7. 模拟 SMTP 失败：业务操作仍成功，日志有 `admin.user_notify_failed`、`mail_log.ok=false`；
   PATCH 类界面提示"通知发送失败"，删除类只进日志；
8. HTML 邮件是 `multipart/alternative`，含 text/plain 兜底；同一封在 QQ 邮箱网页版显示正常（**人工确认项**）；
9. 模板：9 个事件可编辑/启停/恢复默认/预览/发送测试，保存后立即生效（下一封即用新模板）；
   非验证码模板写 `{{code}}` 被拒绝；
10. 安全：主题带 `\r\n` 被过滤；变量 `{{username}}` 为 `<script>` 时被转义；未知变量保存有提示；
11. 批量禁用/启用：只记日志、**不发**任何用户邮件；
12. 「最近发送记录」两个 tab 都能看到对应记录（通知 tab 能看到账号通知与测试邮件，含成功/失败）；
13. `npm test` 全绿（新增 `test/admin-user-delete.test.js`、`test/mail-templates.test.js`、`test/notify-html.test.js` 并接入主链）、
    `npm run frontend:build`、`npm run scan`；
14. 「最近删除」按用户名搜索：部分匹配、大小写不敏感、清空后恢复全部；
15. 模板「套用示例」3 套版式都能填入编辑器、可保存、预览里变量能正确替换。

## 9. 实施顺序

| 批次 | 内容 | 依赖 |
|---|---|---|
| **AH** 用户彻底删除 | §4.1 + §5.1（删除按钮/确认/刷新/最近删除）+ `admin_user_deletions` + 测试（先不含通知） | 无 |
| **AI** 邮件模板 + HTML + 发送记录 | §4.4 + `mail_templates`/`mail_log` + §4.3 + §4.5 + §5.2（含 3 套示例版式）+ 验证码邮件接入 | 无 |
| **AJ** 账号变更通知 | §4.2 + 8 类事件接入（改邮箱两封；含 AH 删除后的异步通知） | **AI**（模板与 HTML 发送能力） |

## 10. 本期不做（写清楚，避免后面被当成漏项）

- 批量删除用户（批量栏仍只有禁用/启用）；
- 用户自助注销账号；
- 批量禁用/启用的用户通知（决策 9）；
- 降价提醒 / 申诉回复的模板化（下一批）；
- 富文本可视化编辑器（只做 HTML 源码 + 预览，避免引第三方依赖）；
- 删除时保留用户数据快照（"彻底删除"= 不保留）；
- 邮件发送失败重试 / 退信处理。
