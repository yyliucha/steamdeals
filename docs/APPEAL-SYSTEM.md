# 申诉系统改造：服务端受理 + 后台申诉管理（待开发）

> 状态：**需求与方案已确认（2026-11-03），待开发**；**2026-11-13 追加 BQ：邮件内一键「信任 / 封禁」**（见 §10）。
> 替代现有「mailto 客户端发信 + 邮件里人工处理」流程。
> 关联：[FRONTEND-RENDER-FIX.md](FRONTEND-RENDER-FIX.md)（封禁页跳转，需先修）、
> [APPEAL-EMAIL.md](APPEAL-EMAIL.md)（申诉邮箱设置，已实现）。

## 1. 已确认的决策

| # | 决策 |
|---|---|
| 1 | 申诉提交**入库 + 后台页面处理**，同时给管理员发一封通知邮件（SMTP 未配也不影响入库） |
| 2 | 处理结果（通过/拒绝）**回邮件通知申请人** |
| 3 | 联系邮箱**必填**（邮箱格式校验） |
| 4 | 防刷：**每 IP 每小时最多 3 条** + 提交需**图形验证码**（复用现有 `/api/captcha`） |
| 5 | 后台处理动作：解封 IP / 解封设备 / 两者都解 / 拒绝（必填理由）/ 仅备注 |
| 6 | **（BQ，2026-11-13）** 管理员通知邮件里带「信任（解封 IP+设备）」「拒绝（继续封）」两个入口，点开是**确认页**，再点按钮才执行（防邮件预取误执行） |
| 7 | **（BQ）** 该入口链接 14 天有效、处理一次即失效；**token 即凭据，不要求登录**；与后台共用同一状态机，先到先得 |

> BQ 的完整设计（token 模型、接口、确认页、安全、验收）见 §10，本节表格只记决策。

## 2. 数据模型

```sql
create table if not exists appeals (
  id           bigserial primary key,
  code         text not null unique,                 -- AP-XXXXXX（去易混字符）
  ip           text,
  device_id    text,
  fingerprint  text,
  reason       text,                                 -- 提交时的封禁原因（快照）
  ban_until    timestamptz,                          -- 提交时的解封时间（快照）
  contact      text not null,                        -- 申请人联系邮箱
  message      text,                                 -- 申诉说明
  status       text not null default 'pending',      -- pending | resolved | rejected
  action       text,                                 -- unban_ip | unban_device | both | reject | note
  note         text,                                 -- 管理员备注 / 拒绝理由
  created_at   timestamptz not null default now(),
  handled_at   timestamptz,
  handled_by   bigint references users(id) on delete set null
);
create index if not exists appeals_status on appeals (status, created_at desc);
create index if not exists appeals_ip on appeals (ip);
create index if not exists appeals_contact on appeals (contact);
```

## 3. 服务端

### 3.1 `POST /api/appeal`（公开，需放行封禁拦截）

在封禁检查的路径白名单里加 `/api/appeal`（与 `/appeal` 同等待遇），仅此 API 放行。

请求：

```json
{ "contact": "user@example.com", "message": "申诉说明（≥10 字）", "captchaToken": "…", "captchaAnswer": "ABCD" }
```

处理：

1. 校验：`contact` 必填且邮箱格式；`message` 长度 10–2000；验证码通过 `captcha.verify`（一次性）；
2. 频率限制：按 IP 每小时最多 3 条（用内存计数 + 库内 `count(*) where ip=$1 and created_at > now()-interval '1 hour'` 双保险）；
   同一 IP + 相同 `message` 重复提交 → 直接返回已有编号（幂等）；
3. 取上下文：`ip`（visitors.clientIp）、`device_id/fingerprint`（cookie/上报）、
   当前封禁原因与 `ban_until`（来自 `ip_abuse` / `device_bans`，取不到则为空）；
4. 生成编号 `AP-XXXXXX`；写 `appeals`（**SMTP 未配置也成功**）；
5. 发送管理员通知邮件（失败只记日志，不影响返回）：
   - 收件人 = 「申诉邮箱」（`APPEAL_EMAIL` → 邮件收件人 → 发件人 → SMTP 账号）
   - `From` = SMTP 账号（站点），**`Reply-To` = 申请人 contact**
   - 主题 `[SteamDeals] 新申诉 AP-XXXX`，正文含 IP / 原因 / 到期 / 联系方式 / 说明
6. 返回 `{ ok: true, code }`。

### 3.2 `GET /api/admin/appeals?status=pending|all&limit=`

管理员列表（默认 pending，按 created_at desc）。含 id/code/ip/contact/reason/ban_until/status/created_at/action。

### 3.3 `POST /api/admin/appeals/:id/resolve`

```json
{ "action": "unban_ip | unban_device | both | reject | note", "note": "备注/理由" }
```

| action | 行为 |
|---|---|
| `unban_ip` | 解封该 IP（删 `ip_blacklist` 行 + 清 `ip_abuse.banned_until` + `ratelimit.unban`） |
| `unban_device` | 解封该设备指纹（删 `device_bans` 行） |
| `both` | 两者都解 |
| `reject` | `status='rejected'`，`note` 必填（拒绝理由） |
| `note` | 仅记录备注，`status` 保持 pending（不改封禁） |

- 写 `action/note/handled_at/handled_by/status`；
- 发送结果邮件给申请人（`To=contact`）：`resolved` → 「已解封，可访问」；`rejected` → 「未通过 + 理由」；
  邮件失败只记日志；
- 并发保护：处理前检查 `status='pending'`，已处理返回 409。

### 3.4 `GET /api/appeal/:code`（可选，公开，限频）

申请人查进度：`{ status, handled_at, note }`；不回显内部 IP/设备指纹。

## 4. 前台 `AppealPage.vue` 改造

- 表单：
  - 联系邮箱（必填，`el-input` + 格式校验）
  - 申诉说明（`el-input type=textarea`，10–2000 字，显示字数）
  - 图形验证码（复用 `/api/captcha`，点击刷新）
- 提交按钮 → `POST /api/appeal`：
  - 成功：显示「已受理，编号 AP-XXXX；结果会发送到你的邮箱」，隐藏表单；
  - 验证码错误 → 提示并刷新验证码；频率限制 → 「提交过于频繁，请 1 小时后再试」；
- **移除 mailto 依赖**（保留「复制申诉内容」作为兜底）；
- 页面从 query 取 `code/reason/until` 仅用于展示（不再依赖 email 参数）。

## 5. 后台「申诉管理」页

- 侧栏「访问与安全」新增 `appeals`：**申诉管理**
- 列表：编号 / 提交时间 / IP / 联系方式 / 封禁原因 / 到期 / 状态 / 操作
- 筛选：待处理（默认）/ 已处理（resolved+rejected）/ 全部；显示待处理数量
- 详情抽屉：
  - 申诉内容、联系方式（mailto 链接）、设备指纹、封禁记录（IP/设备/到期）
  - 处理表单：动作（解封 IP / 解封设备 / 两者都解 / 拒绝+理由 / 仅备注）+ 备注
  - 「复制回复内容」按钮（生成给申请人的回复文本）
- 处理成功后列表刷新；已处理记录只读展示

## 6. 邮件通知规范

| 场景 | 收件人 | Reply-To | 主题 |
|---|---|---|---|
| 新申诉通知管理员 | 申诉邮箱（回退链） | 申请人 contact | `[SteamDeals] 新申诉 AP-XXXX` |
| 处理结果通知申请人 | 申请人 contact | 申诉邮箱 | `[SteamDeals] 申诉处理结果 AP-XXXX` |

- `From` 一律 = SMTP 账号（站点）；**不得伪造申请人邮箱为 From**（163 会拒信）；
- 两封邮件都写入现有发送记录（邮件服务页「最近发送记录」可见）。

## 7. 安全

- `/api/appeal` 放行封禁拦截，但限制请求体（如 16KB）与字段长度；
- 验证码一次性、5 分钟过期；频率限制按 IP；
- 响应不回显内部 IP/指纹；编号不可枚举（随机 6 位大写字母+数字，去易混字符）；
- 后台接口全部要求管理员。

## 8. 验收

1. 被封手机：封禁页 →「申请解封」→ 填邮箱+说明+验证码 → 提交成功并显示编号；
2. 后台「申诉管理」出现待处理记录，可查看详情；
3. 处理「解封 IP」→ 申请人刷新可正常访问；「拒绝」→ 状态 rejected 且理由必填；
4. 处理结果邮件发送到申请人邮箱（SMTP 可用时）；未配置 SMTP 时提交仍成功；
5. 1 小时内第 4 次提交被拒（频率限制）；验证码错误 → 400；
6. 同一 IP 重复相同内容 → 返回已有编号（不重复入库）；
7. `npm test` 全绿 + `npm run frontend:build` 通过 + `npm run scan` 干净；
8. **不自行构建**（硬规则 5）。

## 9. 实施顺序

1. 先修封禁页跳转（[FRONTEND-RENDER-FIX.md](FRONTEND-RENDER-FIX.md) §2，否则被封用户到不了申诉页）；
2. `appeals` 表 + `POST /api/appeal`（含放行、验证码、限流、通知邮件）；
3. 后台申诉管理页 + resolve 接口（联动解封 + 结果邮件）；
4. 前台申诉页改造（去掉 mailto）；
5. 测试（PGlite：入库/幂等/限流/状态机；SMTP 用假服务器）→ 构建验证 → 提交推 main。

## 10. 邮件内一键「信任 / 封禁」（BQ，2026-11-13 确认）

> 目标：管理员在邮件里就能处理申诉，不必登录后台。**只对 BQ 这一块做增量**，其余仍按 §3–§5。

### 10.1 已确认的决策（所有者，2026-11-13）

| # | 决策 |
|---|---|
| 1 | 通知邮件里两个入口：**信任（解封 IP + 设备）**、**拒绝（继续封禁）**；要分别解封就回后台页 |
| 2 | 点邮件里的链接 → 打开站内**确认页**（只读），再点按钮才执行 → 邮件安全扫描/预取的 GET 不会产生任何副作用 |
| 3 | 链接 **14 天**有效；**处理一次即失效**，之后打开只显示处理结果 |
| 4 | **token 即凭据，不要求管理员登录**；token 只对**一条申诉**有效 |
| 5 | 收件人沿用现有「申诉邮箱」设置（`alerts.appealEmail` → `ALERT_EMAIL_TO` → `SMTP_FROM` → `SMTP_USER` 回退链），不新增设置项 |
| 6 | 拒绝时可填写理由（确认页预填默认文案），与后台 `reject` 的「note 必填」语义一致 |
| 7 | 邮件操作与后台操作**共用同一状态机**：先到先得，后到的返回「已处理」而不是报错 |

### 10.2 数据模型（并入 §2 建表；O 尚未发布，因此直接进 `create table appeals`）

若按增量迁移写成 `alter table`，等价写法：

```sql
alter table appeals add column if not exists action_token_hash    text;          -- sha256(token)，不存明文
alter table appeals add column if not exists action_expires_at    timestamptz;   -- 提交时 now() + 14 days
alter table appeals add column if not exists handled_via          text;          -- 'console' | 'email'
create index if not exists appeals_action_token on appeals (action_token_hash);
```

- token 明文只出现在邮件链接里，库里存 `sha256(token)`（hex）；处理成功后置 `action_token_hash = null`（旧链接立即失效）。
- `handled_via` 供后台列表显示处理来源（邮件 / 后台），审计用。

### 10.3 服务端

**`POST /api/appeal/action`**（公开，需在封禁拦截里与 `/api/appeal` 同样放行）

请求体（单一端点，全部 POST，杜绝 GET 副作用）：

```json
{ "token": "<32 字节 base64url>", "op": "preview | trust | reject", "note": "拒绝理由（reject 时用）" }
```

| op | 行为 |
|---|---|
| `preview` | 校验 token → 返回申诉摘要：`code` / `status` / `ipMasked` / `reason` / `banUntil` / `contactMasked` / `message`（截断 1000 字）/ `createdAt` / `canAct`（`status==='pending'` 且未过期） |
| `trust` | 事务内 `update appeals set status='resolved', action='both', handled_at=now(), handled_via='email', action_token_hash=null where action_token_hash=$1 and status='pending' returning *`；0 行 → **409** 并返回当前状态；成功后解封（见下） |
| `reject` | 同上，`status='rejected', action='reject', note=$2`；`note` 空则用默认文案「未通过审核，如仍有疑问请回复本邮件」 |

解封动作（`trust`）复用现有能力，不新写一套：

1. IP：删 `ip_blacklist` 行 → `db.clearAbuseBan` → `ratelimit.clearBanMemory` → `visitors.refreshBlocklist`；
2. 设备：按 `device_id`（优先）/`fingerprint` 删 `device_bans` 行 → `devices.forget`（内存态同步）；
3. 写 `handled_at/handled_via`，发结果邮件给申请人（§3.3 已有）。

限制与观测：

- 限流：每 IP 每分钟 10 次（内存桶，独立于全站限流）；token 连续错误 10 次/小时 → 429；
- token 不存在/过期/已处理且被置空 → 统一 **404「链接无效或已过期」**，不区分原因（防枚举）；
- 日志事件：`appeal.action_email`（`{ code, op, outcome }`，**不写 token**）、`appeal.action_refused`（`{ reason: 'expired' | 'handled' | 'bad_token' }`）；
- 响应不回显完整 IP / 完整邮箱 / device_id / fingerprint。

### 10.4 前端

**新增 `frontend/src/pages/AppealActionPage.vue` + 路由 `/appeal/act`**

- 邮件链接形如 `https://<站点域名>/appeal/act#t=<token>`：token 放在 **URL fragment**（不进服务端访问日志、不进 Referer）；
- 页面读取 `location.hash` 里的 `t`：无 token → 「链接无效」；有 token → `POST /api/appeal/action {op:'preview'}` 渲染摘要；
- 两个按钮：**信任并解封**（主）、**拒绝并保持封禁**（拒绝弹出理由输入，预填默认文案）；
- 结果四态：`已处理（信任）` / `已处理（拒绝）` / `链接已过期` / `链接无效`；成功后提示「处理结果会邮件通知申请人」；
- 移动端单列、按钮 ≥44px，与登录页同一套 `auth-*` 视觉；
- 路由必须登记进 `FRONTEND_PAGES`（[server.js](../src/server.js) 白名单）并同步 `test/serve.test.js` 的一致性断言——否则硬打开会落到旧 `web/` 目录（BM 那个 404 的教训）。

### 10.5 邮件模板

- 主题沿用 `[SteamDeals] 新申诉 AP-XXXXXX`；
- 正文顶部两个按钮（inline CSS 的 `<a>`，不依赖外部样式），链接即 §10.4 的确认页；
- 纯文本备用版附完整 URL + 一句「链接 14 天内有效，处理一次后失效」；
- 邮件照旧写入发送记录（§6）；**SMTP 未配置时不发信**，申诉照常入库、后台照常处理。

### 10.6 安全

- token：32 字节随机（base64url），只存 sha256；生成于申诉提交时；14 天过期；处理成功后置空；
- 无 GET 写入：确认页与 `preview` 都不改状态，防邮件网关/安全扫描误触发；
- token 出现在 fragment，不进服务端日志/Referer；代码里禁止把 token 写入日志或 `analytics`；
- 邮件可能被转发：靠「一次性 + 14 天 + `handled_via` 审计」控制影响面；
- 拒绝理由长度 5–500 字，入库前 trim；不做 HTML 注入（邮件模板统一转义）。

### 10.7 验收（在 §8 基础上新增）

| # | 验收 |
|---|---|
| 9 | 提交申诉后，管理员邮箱收到的邮件里有「信任」「拒绝」两个按钮，点开是确认页，**页面本身不产生任何状态变化** |
| 10 | 确认页「信任」→ 申诉 `resolved`、IP 与设备都被解封、申请人可正常访问、申请人收到结果邮件 |
| 11 | 确认页「拒绝」→ 可填理由 → `rejected` + 理由入库，申请人收到结果邮件 |
| 12 | 同一链接重复点、或与后台同时处理 → 只生效一次，后到者显示「已处理」，不重复解封/不重复发信 |
| 13 | 第 15 天打开链接 → 「链接已过期」；处理过再打开 → 显示处理结果与时间 |
| 14 | 只对链接发 GET（模拟邮件安全扫描）→ 零状态变化 |
| 15 | 未配置 SMTP：申诉入库成功、后台可处理、确认页仍可用 |
| 16 | 篡改/伪造 token → 404 统一文案；连续错误触发 429 |
| 17 | `npm test` 全绿 + `npm run frontend:build` 通过 + `npm run scan` 干净；**不自行构建** |

### 10.8 实施顺序

1. 先做 O（`appeals` 表 + `POST /api/appeal` + 通知邮件 + 后台处理）；
2. token 列与生成/校验（`sha256`、14 天、一次性）；
3. `POST /api/appeal/action`（preview/trust/reject）+ 放行 + 限流 + 日志；
4. 邮件模板加两个按钮；
5. 确认页 `/appeal/act` + 白名单 + 结果四态；
6. 测试（PGlite：token 校验/过期/一次性/并发；假 SMTP 断言邮件含两个链接）→ 构建验证 → 提交推 main。

### 10.9 待确认问题

无（§10.1 的 5 项已由所有者 2026-11-13 确认）。后续可选（不在本批）：把「拒绝理由」做成邮件回复即可解析（需 IMAP 收信解析，成本高，暂不做）。
