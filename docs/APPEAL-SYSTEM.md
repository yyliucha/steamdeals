# 申诉系统改造：服务端受理 + 后台申诉管理（待开发）

> 状态：**需求与方案已确认（2026-11-03），待开发**。
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
