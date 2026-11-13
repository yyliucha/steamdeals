# 申诉系统开发汇报（O + BQ，交接用）

> 用途：**开发会话的开工底稿**。把 specs 里的功能点按"能直接派活"的粒度摊平，方便一次看全。
> 事实来源（冲突时以它们为准）：[TODO.md](TODO.md) 的 **O / BQ** 两条、[APPEAL-SYSTEM.md](APPEAL-SYSTEM.md)（O = §1–§9，BQ = §10）、[REQUIREMENTS-INDEX.md](REQUIREMENTS-INDEX.md)。
> 本文件**不新增需求**，只做汇总；需求变更请先改规格与 TODO。
> 记录时间：2026-11-13。

## 0. 一句话与范围

把「被封 → 点 mailto → 人工看邮件」改成「**站内提交入库 → 后台处理 / 邮件一键处理 → 结果回信给申请人**」。

| 条目 | 内容 | 当前状态 | 规格 |
|---|---|---|---|
| **O** | 申诉系统改造：服务端受理 + 后台申诉管理 | `待开发` | [APPEAL-SYSTEM.md](APPEAL-SYSTEM.md) §1–§9 |
| **BQ** | 申诉邮件内一键「信任 / 封禁」 | `依赖阻塞`（依赖 O） | [APPEAL-SYSTEM.md](APPEAL-SYSTEM.md) §10 |

**建议合成一批**：先 O 后 BQ；O 的第 3 步做完后台就能处理申诉，BQ 是在那封通知邮件上加两个按钮，可同一版交付、也可拆两版。

## 1. 功能点清单（17 项）

### A 组 · 数据与后端（O）

| 编号 | 功能点 | 行为与规则 | 落点 |
|---|---|---|---|
| O-1 | `appeals` 表 | 编号/IP/设备/原因快照/到期快照/联系邮箱/说明/状态/动作/备注/时间/处理人 + 索引；BQ 的 3 列一并建 | `src/store/pg.js` |
| O-2 | `POST /api/appeal` | 公开接口：邮箱必填+格式、说明 10–2000 字、图形验证码一次性、**每 IP 每小时 3 条**、同 IP 同内容幂等返回原编号、生成 `AP-XXXXXX`、**SMTP 未配也入库成功** | `src/server.js` |
| O-3 | 封禁拦截放行 | `/api/appeal`（含 BQ 的 `/api/appeal/action`）与 `/appeal` 同等待遇放行，其余照旧 | `src/server.js` |
| O-4 | 管理员通知邮件 | 收件人回退链（申诉邮箱 → 告警收件人 → 发件人 → SMTP 账号）；`From`=SMTP 账号、`Reply-To`=申请人；主题 `[SteamDeals] 新申诉 AP-XXXXXX`；正文含 IP/原因/到期/联系方式/说明；失败只记日志；写入发送记录 | `src/notify.js`、`src/mail-templates.js` |
| O-5 | `GET /api/admin/appeals` | 管理员；`status=pending\|all`、分页；返回编号/IP/联系/原因/到期/状态/动作 | `src/server.js` |
| O-6 | `POST /api/admin/appeals/:id/resolve` | 5 动作：`unban_ip` / `unban_device` / `both` / `reject`（理由必填）/ `note`；联动解封 + 回信申请人；已处理返回 **409** | `src/server.js`、`src/store/pg.js` |
| O-7 | `GET /api/appeal/:code`（可选） | 申请人按编号查进度；不回显内部 IP/指纹；限频 | `src/server.js` |

### B 组 · 前台（O）

| 编号 | 功能点 | 行为与规则 | 落点 |
|---|---|---|---|
| O-8 | 申诉页改造 | 联系邮箱（必填+校验）、说明（10–2000 字带计数）、图形验证码（复用 `/api/captcha`，点击刷新）、提交成功显示编号并隐藏表单、验证码错/限流分别提示、**去掉 mailto**（保留「复制申诉内容」兜底） | [AppealPage.vue](../frontend/src/pages/AppealPage.vue) |

### C 组 · 后台（O）

| 编号 | 功能点 | 行为与规则 | 落点 |
|---|---|---|---|
| O-9 | 侧栏入口 | 「访问与安全」新增 `appeals`：申诉管理（带待处理数量） | [Console.vue](../frontend/src/pages/Console.vue) |
| O-10 | 申诉列表 | 编号/提交时间/IP/联系方式/封禁原因/到期/状态/操作；筛选：待处理（默认）/已处理/全部 | [AdminModules.vue](../frontend/src/pages/AdminModules.vue) 或 AdminExtras 新分区 |
| O-11 | 详情抽屉 | 申诉内容、联系方式（mailto）、设备指纹、封禁记录、处理表单、「复制回复内容」 | 同上 |
| O-12 | 处理动作联动 | 解封 IP（删黑名单 + 清 `ip_abuse.banned_until` + 清内存封禁 + 刷新黑名单）；解封设备（删 `device_bans` + 清设备内存）；拒绝写理由；仅备注不改状态 | `src/server.js` + 现有 `db` / `devices` / `ratelimit` |

### D 组 · 邮件内一键处理（BQ）

| 编号 | 功能点 | 行为与规则 | 落点 |
|---|---|---|---|
| BQ-1 | token 模型 | 32 字节随机、库中只存 `sha256`、**14 天**过期、处理成功即置空、`handled_via` 记 `console\|email` | `src/store/pg.js` |
| BQ-2 | `POST /api/appeal/action` | 三动作 `preview / trust / reject`；**全部 POST，无任何 GET 副作用**（防邮件预取）；`trust` 事务内抢 `status='pending'`，0 行→409；限流每 IP 10 次/分；错误统一 404；日志 `appeal.action_email`（不写 token） | `src/server.js` |
| BQ-3 | 通知邮件加按钮 | 正文顶部两个 inline-CSS 按钮，链接 `https://<域名>/appeal/act#t=<token>`（**token 放 fragment**，不进访问日志/Referer）；纯文本备用版附完整 URL + 有效期说明 | `src/mail-templates.js` |
| BQ-4 | 确认页 `/appeal/act` | 读 `location.hash` 取 token → `preview` 渲染摘要 → 两按钮执行；拒绝弹理由（预填默认文案）；四态结果（已信任/已拒绝/已过期/无效）；移动端单列、按钮 ≥44px；**必须登记 `FRONTEND_PAGES` + [serve.test.js](../test/serve.test.js) 一致性断言** | `frontend/src/pages/AppealActionPage.vue`（新建）、`src/server.js`、[serve.test.js](../test/serve.test.js) |
| BQ-5 | 与后台共用状态机 | 先到先得，后到显示「已处理」不重复解封；邮件与后台都写 `handled_at/handled_via` 可审计 | `src/server.js` |

## 2. 数据模型（一次建表）

```sql
create table if not exists appeals (
  id bigserial primary key,
  code text not null unique,                 -- AP-XXXXXX
  ip text, device_id text, fingerprint text,
  reason text, ban_until timestamptz,        -- 提交时快照
  contact text not null, message text,
  status text not null default 'pending',    -- pending | resolved | rejected
  action text, note text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by bigint references users(id) on delete set null,
  action_token_hash text,                    -- BQ：sha256，不存明文
  action_expires_at timestamptz,             -- BQ：now() + 14 days
  handled_via text                           -- BQ：console | email
);
create index if not exists appeals_status on appeals (status, created_at desc);
create index if not exists appeals_ip on appeals (ip);
create index if not exists appeals_contact on appeals (contact);
create index if not exists appeals_action_token on appeals (action_token_hash);
```

## 3. 接口清单

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/appeal` | 公开（放行封禁） | 提交申诉，返回编号 |
| GET | `/api/appeal/:code` | 公开（限频） | 查进度（可选） |
| POST | `/api/appeal/action` | 公开（token 即凭据，放行封禁） | BQ：preview / trust / reject |
| GET | `/api/admin/appeals` | 管理员 | 列表 + 筛选 + 分页 |
| POST | `/api/admin/appeals/:id/resolve` | 管理员 | 5 种处理动作 |

## 4. 邮件清单（3 封；BQ 不新增邮件）

| 场景 | 收件人 | Reply-To | 主题 | BQ 变化 |
|---|---|---|---|---|
| 新申诉通知 | 申诉邮箱（回退链） | 申请人 | `[SteamDeals] 新申诉 AP-XXXXXX` | **正文加「信任」「拒绝」两个按钮** |
| 处理结果通知 | 申请人 | 申诉邮箱 | `[SteamDeals] 申诉处理结果 AP-XXXXXX` | 无 |
| SMTP 未配置 | — | — | 不发信；申诉照常入库，后台与确认页照常可处理 | — |

## 5. 安全与硬约束

- 限流：提交每 IP 3 次/小时；BQ 动作每 IP 10 次/分；token 错误 10 次/小时 → 429。
- 验证码：一次性、5 分钟过期（现有 `src/captcha.js`）。
- token：只存 hash、fragment 传递、14 天、一次性；日志禁止出现 token。
- 响应不回显完整 IP / 邮箱 / 指纹；编号不可枚举。
- 项目约束：不引新依赖、PG 15 语法、Element Plus 组件必须注册、移动端断点 1024/768/420。

## 6. 实施顺序（6 步）

1. **O-1 表 + O-2 接口 + O-3 放行 + O-4 通知邮件**（先跑通「提交 → 收信」）
2. **O-8 前台申诉页改造**（去掉 mailto）
3. **O-5 / O-6 后台接口 + O-9 / O-10 / O-11 / O-12 后台页面**
4. **BQ-1 token + BQ-2 动作接口 + BQ-3 邮件按钮**
5. **BQ-4 确认页 + 白名单/一致性测试 + BQ-5 共用状态机**
6. 测试（PGlite + 假 SMTP）→ `npm test` / `npm run frontend:build` / `npm run scan` → 提交推 main

## 7. 验收（17 条）

| # | 验收 |
|---|---|
| 1 | 被封手机：封禁页 → 申诉页 → 填邮箱+说明+验证码 → 提交成功并显示编号 |
| 2 | 后台「申诉管理」出现待处理记录，可看详情 |
| 3 | 后台「解封 IP」→ 申请人刷新可访问；「拒绝」→ 理由必填、状态 rejected |
| 4 | 申请人收到处理结果邮件；未配 SMTP 时提交仍成功 |
| 5 | 1 小时内第 4 次提交被拒；验证码错误 → 400；同 IP 同内容重复提交返回原编号 |
| 6 | 管理员邮件含「信任」「拒绝」按钮，点开是确认页，**页面本身零状态变化** |
| 7 | 确认页「信任」→ resolved + IP/设备解封 + 申请人可访问 + 结果邮件 |
| 8 | 确认页「拒绝」→ 可填理由 → rejected + 理由入库 + 结果邮件 |
| 9 | 重复点链接 / 与后台同时处理 → 只生效一次，后到显示「已处理」 |
| 10 | 第 15 天打开 → 「链接已过期」；处理过再打开 → 显示结果 |
| 11 | 仅对链接发 GET（模拟邮件安全扫描）→ 零状态变化 |
| 12 | 伪造/篡改 token → 统一 404；连续错误 → 429 |
| 13 | `npm test` 全绿 |
| 14 | `npm run frontend:build` 通过 |
| 15 | `npm run scan` 干净 |
| 16 | 移动端申诉页/确认页单列、按钮 ≥44px |
| 17 | **不自行构建**（等「构建 vX.Y.Z」人工指令） |

## 8. 明确不做

- 不做「邮件回复即处理」（IMAP 收信解析，成本高）
- 不做申诉附件、不做自动解封时限、不接第三方工单系统
- 不改现有封禁/限流策略本身（O 只做申诉侧联动解封）

## 9. 开发红线

认领 [TODO.md](TODO.md) 的 O → BQ 状态；改动必须真跑 `npm test` / `npm run frontend:build` / `npm run scan` 并贴输出；不碰服务器、不动生产数据、**不擅自打 tag / 发版**；交付后状态改「已实现待发版」并调 `gameprice-qa` 质检，按 `docs/HANDOVER.md` §3 汇报「已做 / 未做 / 状态更新」。

## 10. 派活模板（复制给开发会话）

```
新需求已入待办：docs/TODO.md 的 O（状态：待开发）→ BQ（依赖阻塞，O 完成后解阻塞）。
先读 docs/HANDOVER.md → docs/DEV-BRIEF-APPEAL.md → docs/APPEAL-SYSTEM.md（§1–§9 / §10）；
按 DEV-BRIEF 第 6 节的 6 步顺序做，做完把状态改成「已实现待发版」，调 gameprice-qa，按 HANDOVER §3 汇报。
```
