# 认证与密码系统重设计 + 登录/注册页（已确认待开发）

> 状态：**已实现待发版（2026-11-09，AK-1 5a86013 / AK-2 7f6b568 / AK-3 df79db2 / AL 77c02e5）**。分两批（编号待入 [TODO.md](TODO.md) 时落定）：
> **AK 密码系统**（AK-1 策略与哈希 / AK-2 登录防护 / AK-3 账号流程）、**AL 登录·注册·改密页面**。
> 关联：[WEB.md](WEB.md)、[MAIL-CONFIG-PAGE.md](MAIL-CONFIG-PAGE.md)（验证码邮件）、
> [USER-LIFECYCLE.md](USER-LIFECYCLE.md)（AH 删除 / AI 模板 / AJ 通知，同一后台）、[HANDOVER.md](HANDOVER.md)。

## 1. 现状（代码事实，2026-11-06 核对）

| 项 | 事实 | 证据 |
|---|---|---|
| 密码规则 | 只有 **8–200 位**，`12345678` 可通过；四处校验各写一遍 | `server.js:1765`、`:2285`、`auth-routes.js:193`、`setup-routes.js:17`、`cli.js:1218` |
| 存储 | `scrypt` **默认参数**（N=16384,r=8,p=1），格式 `salt:hash`，**不带算法/参数**，以后提参数无法区分新旧 | `store/pg.js:1301-1311` |
| 登录防护 | 只有图形验证码（默认开，`CAPTCHA_ENABLED=0` 可关）；**无失败计数、无锁定、无 IP 限速** | `server.js:763-786`、`src/captcha.js` |
| 注册入口 | **没有用户自助注册**：后台「新建用户」建号（初始密码管理员手填）、首次部署 `/setup` 建管理员 | `AdminExtras.vue:4`、`router/index.js` |
| 改密码 | **登录用户没有改密入口**，只能"忘记密码 → 邮箱验证码重置" | 全仓无 `/api/user/password` |
| 会话 | 7 天，`HttpOnly; SameSite=Lax; Secure(https)`；改密时 `delete from sessions` 全踢 | `session-cookie.js`、`pg.js:1371` |
| 登录页 | 首页上的 410px 弹窗，三种模式挤在一起；无 `/login` 路由、无注册页 | `Home.vue:86` |

## 2. 已确认的决策（2026-11-06 所有者）

| # | 决策 |
|---|---|
| 1 | **三处入口全覆盖**：后台「新建用户」、首次 `/setup`、**新增用户自助注册**（三个都要） |
| 2 | 密码**最低 12 位**（最长 200）+ **弱口令黑名单**；**不加大小写/符号复杂度规则**（NIST 明确反对） |
| 3 | 老账号**不强制改密**；登录成功时**静默升级哈希**；后台**标出弱密码账号**提醒管理员 |
| 4 | 登录防爆破：**5 次失败锁 15 分钟** + IP 限速 + 验证码常开；**管理员可解锁** |
| 5 | 管理员建号/重置：**随机临时密码 + 首次登录强制改密** |
| 6 | 页面：**独立 `/login`**（桌面左右分栏）+ **`/register`** + **`/change-password`**；视觉按推荐方向 |
| 7 | 自助注册：**开放注册**、**必须邮箱验证码**、图形验证码 + 限流；**不做邀请码**；"记住我" 支持 7 / 30 天；用户名统一 **3–32 字符、不含空格或斜杠**（与 `/setup` 一致，后台建号一起收紧） |

## 3. 数据模型（`users` 补列，`pg.js` 的 ALTERS 里做）

```sql
alter table users add column if not exists must_change_password boolean not null default false;
alter table users add column if not exists failed_login_count  integer  not null default 0;
alter table users add column if not exists locked_until        timestamptz;
alter table users add column if not exists weak_password       boolean;          -- null = 未评估
alter table users add column if not exists password_updated_at timestamptz;
```

- `weak_password` 三态：`null` 未评估（老账号从没登录过）/ `true` 弱 / `false` 合格；
- 不新增表；登录失败计数落 `users`（重启不丢，管理员能看到），IP 级限流走内存 `Map`（重启清零，可接受）；
- 验证码复用 `email_codes`，**只新增用途 `register`**（`purpose` 是 text，无枚举约束）。

## 4. 服务端

### 4.1 密码策略 `src/password-policy.js`（新增，纯函数）

```js
export const MIN_LENGTH = 12;
export const MAX_LENGTH = 200;

/** 返回 { ok, score: 0..4, reasons: string[], suggestions: string[] } */
export function evaluatePassword(password, { username = '', email = '' } = {})
```

判定（任一命中即 `ok=false`，理由给前端展示）：

| reason | 条件 |
|---|---|
| `too_short` / `too_long` | 长度 <12 / >200 |
| `common` | 小写后命中内置常见密码集（`src/data/common-passwords.js`，Top 1 万，约 80KB，**不引依赖**） |
| `contains_identity` | 包含用户名或邮箱 `@` 前部分（长度 ≥4，忽略大小写） |
| `repeated` | 全部是同一字符（`aaaaaaaaaaaa`） |
| `sequential` | 纯递增/递减序列 ≥6（`123456789012`、`abcdefghijkl`） |

- 评分：12–15 字 = 2，16–19 = 3，≥20 = 4；命中 `common`/`contains_identity` 直接压到 0–1；
- **不 trim、不做 Unicode 归一化**（密码原样哈希；空格与中文都是合法字符）；
- 新增 `POST /api/password/check`（匿名、每 IP 30 次/分钟）→ 返回 `{ ok, score, reasons, suggestions }`，给前端强度条用；
- 四处入口（setup / 后台建号 / 后台重置 / 自助重置 / 注册 / 改密）**统一调用**，不再各写 `length < 8`。

### 4.2 哈希格式与升级（`src/store/pg.js`）

```
新格式： $scrypt$32768$8$1$<salt base64>$<hash base64>
旧格式： <salt hex>:<hash hex>   （N=16384,r=8,p=1，继续可验）
```

- `hashPassword()` 用 `scryptSync(pw, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64*1024*1024 })`（约 32MB/次）；
- `verifyPassword()` 兼容两种格式（**保持返回 boolean**，不改调用点签名）；
- 新增 `passwordNeedsRehash(stored)`：旧格式 → true；
- 登录成功且 `needsRehash` → `update users set password_hash=$1, password_updated_at=now()`，日志 `auth.password_rehashed`；
- 老账号不需要知道原密码就能升级（登录时明文在手）。

### 4.3 登录 `/api/login`（重写校验顺序）

```
1) 图形验证码（保持默认开）
2) IP 限速：同一 IP 15 分钟内失败 ≥20 次 → 429 + retryAfterSec（内存计数）
3) 查询用户；存在且 locked_until > now() → 429 { error:'尝试次数过多，请稍后再试', lockedUntil }
4) 校验密码（兼容旧哈希）
   失败：failed_login_count += 1；达到 5 → locked_until = now()+15min，日志 auth.login_locked
        → 统一返回 401「用户名或密码错误」（**不再提示"账号已被禁用"**，避免枚举；禁用原因只进日志）
   成功：failed_login_count=0、locked_until=null；needsRehash 则升级；评估 weak_password 并落库；
        → 200 { user, mustChangePassword }
5) 创建会话（沿用 7 天；"记住我"传 30 天，`createSession({days})` 已支持）
```

- 日志：`auth.login_ok { userId, rehashed, weak }`、`auth.login_failed { reason: 'bad_password'|'unknown'|'disabled', attempts }`、
  `auth.login_locked { username, until }`、`auth.ip_throttled { ip, count }`；**不记密码**。

### 4.4 后台：用户字段与解锁

- `listUsers` 增加 `must_change_password`、`weak_password`、`locked_until`、`failed_login_count`；
- 新增 `POST /api/admin/users/:username/unlock` → `failed_login_count=0, locked_until=null`，返回更新后的行，日志 `admin.user_unlocked { by }`；
- 用户列表：`已锁定`（红 tag + 解锁按钮）、`弱密码`（红 tag）、`需改密`（黄 tag）；
- 批量栏不加解锁（单条足够）。

### 4.5 建号 / 重置 / 初始化

| 入口 | 密码来源 | 之后 |
|---|---|---|
| 后台「新建用户」 | 管理员可留空 → 服务端生成 **16 位随机临时密码**，响应里只返回一次 `tempPassword`；填了 → 必须过策略 | `must_change_password=true` |
| 后台重置密码 | 同上（留空生成临时密码） | `must_change_password=true`；**不再顺带 `disabled=false`**（启用/禁用是独立动作，现在的 `setUserPassword` 会顺手启用账号，属意外行为） |
| 首次 `/setup` | 管理员自填，必须过策略 | `must_change_password=false` |
| 自助找回（邮箱码） | 用户自填，必须过策略 | `must_change_password=false`，踢掉其它会话 |

### 4.6 自助注册

设置开关：新增分组 `auth`（账号与登录）+ `def('auth.registrationEnabled', 'AUTH_REGISTRATION_ENABLED', 'auth', '开放用户注册', 'bool', true)`。
SMTP 未配置时注册自动不可用（返回 503 +「请联系管理员开通」），避免"注册了但收不到验证码"。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register/request` | `{ username, email, captchaToken, captchaAnswer }`：校验用户名（3–32、不含空格/斜杠，与 setup 一致）、邮箱格式、**唯一性**（409「用户名已被使用」/「邮箱已被注册」）、图形验证码、发码频率（复用 `email-auth.js` 的三级限流），发 `purpose='register'` 的 6 位码 |
| POST | `/api/auth/register/verify` | `{ email, code, username, password }`：验证码（过期/次数/错误）、复查唯一性（并发靠唯一索引兜底，23505 → 409）、密码策略、建号（`role='user'`、`email_verified=true`）、置 `email_codes.used_at`、**自动登录**（下发会话）→ 201 `{ user }` |

- 注册页只在 `auth.registrationEnabled=true` 且 SMTP 已配置时显示表单，否则显示「暂未开放注册，请联系管理员」。

### 4.7 修改密码（登录后）

`POST /api/user/password` `{ oldPassword, newPassword }`（需登录）：

1. 校验旧密码（错 → 400「当前密码不正确」）；
2. 新密码过策略；
3. 更新 `password_hash`、`weak_password=false`、`must_change_password=false`、`password_updated_at=now()`；
4. **删掉该用户其它会话**，保留当前 token（`delete from sessions where user_id=$1 and token<>$2`）；
5. 日志 `auth.password_changed { userId }`。

### 4.8 首次登录强制改密

- 会话解析后（`server.js` 主 handler 里）判断：`user.must_change_password` 且请求路径不在白名单 →
  `403 { error: '需要先修改密码', code: 'must_change_password' }`；
- 白名单：`/api/me`、`/api/logout`、`/api/user/password`、`/api/site`、`/api/captcha`、静态资源；
- `/api/login` 与 `/api/me` 的响应都带 `mustChangePassword`，前端据此跳 `/change-password?forced=1`；
- 改密成功后清标记，前端回首页/控制台。

## 5. 前端

### 5.1 路由与入口

- 新增 `/login`、`/register`、`/change-password` 三条路由（`router/index.js`），标题分别「登录 · SteamDeals」「注册 · SteamDeals」「修改密码 · SteamDeals」；
- 首页顶栏「登录」不再弹窗，跳 `/login?next=<当前路径>`；登录成功回跳 `next`（只允许站内相对路径，防开放跳转）；
- 会话过期（任意接口 401）→ 跳 `/login?next=…`；
- 用户菜单加「修改密码」入口。

### 5.2 `/login`

- 桌面：**左右分栏**——左侧品牌区（Logo + 一句卖点 + 三个数据点：收录游戏数 / 比价平台数 / 史低提醒），右侧 420px 表单卡；
  移动端（≤900px）：隐藏品牌区，单列表单卡，按钮 ≥44px；
- 模式：**密码登录 / 邮箱验证码 / 忘记密码**（分段控件，切换不丢已填内容）；
- 密码框：可见切换、Caps Lock 提示、`autocomplete="current-password"`；
- 错误就地显示在字段下方（不再只用顶部 toast）；提交按钮 loading 态防重复；
- 「记住我」勾选 → 会话 30 天，不勾 7 天；
- 验证码加载失败给可点击重试占位（沿用现有逻辑）。

### 5.3 `/register`

- 字段：用户名、邮箱、验证码（60 秒倒计时重发）、密码、确认密码；
- 密码框下方**实时强度条**（调 `/api/password/check`，300ms 防抖；只提示不阻断，提交仍以服务端策略为准）；
- 提交成功 → 自动登录并回首页；失败按字段就地提示（用户名占用/邮箱已注册/验证码错误/密码不符合）；
- 开关关闭或 SMTP 未配置 → 页面显示不可用说明 + 「返回登录」。

### 5.4 `/change-password`

- 字段：当前密码、新密码、确认密码 + 强度条；
- `forced=1` 时顶部 `el-alert`：「首次登录请修改初始密码」（不可关闭），改完才能进其它页面；
- 成功后提示「密码已修改，其它设备已退出登录」。

### 5.5 后台用户列表

- 状态列旁新增三个 tag：`已锁定`（红，带「解锁」按钮）、`弱密码`（红）、`需改密`（黄）；
- 新建用户表单：密码框旁加「随机生成」按钮，留空时提示"将生成临时密码，用户首次登录需修改"；
- 创建/重置成功后，若返回 `tempPassword`，弹窗展示一次并提供「复制」（**不可再次查看**）。

### 5.6 设计规范

- 全部用现有语义化 token（`styles/main.css` 的 `--el-*` / 亮暗色变量），不写死颜色；
- 响应式：900 / 760 / 420 三档，触摸目标 ≥44px；
- Element Plus 新用到的组件（`ElCheckbox`、`ElProgress` 等）必须**同时**在 `main.js` 补 `import` + 样式 + `app.use()`，否则静默不渲染；
- 无新增前端依赖（强度条用 `el-progress` 即可）。

## 6. 安全

1. 登录错误统一「用户名或密码错误」，**不暴露账号是否存在/是否被禁用**；
2. 锁定与 IP 限速在密码校验前后都要"不增加撞库收益"：验证码失败不消耗密码尝试，密码失败才计数；
3. 注册是唯一会提示"邮箱已注册"的地方（体验换安全，用验证码 + 限流兜底）；
4. 密码/临时密码**不进日志**、不进 URL、不落库明文；临时密码只在响应里出现一次；
5. 改密/重置后清其它会话；会话 cookie 保持 `HttpOnly; SameSite=Lax; Secure(https)`；
6. 策略接口只做强度评估、不回显任何用户信息；
7. 管理员解锁要审计（`admin.user_unlocked`）。

## 7. 验收

1. 策略：11 位拒绝；`123456789012`、`password1234`、`aaaaaaaaaaaa`、含用户名/邮箱片段的拒绝；20 位随机短语通过；
   **六个入口**（setup / 后台建号 / 后台重置 / 自助重置 / 注册 / 改密）规则一致；
2. 哈希：新账号库里是 `$scrypt$32768$8$1$…`；老账号 `salt:hash` 仍能登录，登录后自动变新格式且 `password_updated_at` 更新；
3. 锁定：连续 5 次错密码 → 第 6 次 429 + 剩余时间；15 分钟后可再试；成功一次清零；
4. IP 限速：同一 IP 15 分钟失败 20 次 → 429（不再消耗账号尝试次数）；
5. 管理员解锁：点「解锁」后立即恢复登录；列表显示「已锁定」状态；
6. 弱密码标记：老账号用弱密码登录后 `weak_password=true`，后台标红；改成强密码后变 false（未登录过的老账号显示"—"）；
7. 建号/重置：留空密码 → 返回随机临时密码（只显示一次）、`must_change_password=true`；该用户登录后任意业务接口 403 + 前端跳改密页；
   改完恢复；重置密码**不再**顺带解除禁用；
8. 自助注册：邮箱验证码 → 创建普通用户并自动登录；重复用户名/邮箱 409；开关关闭 403；SMTP 未配置 503 且页面提示；
9. 修改密码：旧密码错 400；成功后其它会话失效、当前会话保留；`weak_password` 清除；
10. 页面：`/login`、`/register`、`/change-password` 可直达；移动端单列、触摸 ≥44px；密码可见切换、Caps Lock 提示、错误就地显示；
    首页不再弹登录框；登录成功回跳 `next`（只允许站内路径）；
11. 登录失败不再暴露「账号已被禁用」；
12. `npm test` 全绿（新增 `test/password-policy.test.js`、`test/auth-lockout.test.js`、`test/register.test.js`、`test/password-change.test.js` 并入主链）、
    `npm run frontend:build`、`npm run scan`。

## 8. 实施顺序

| 批次 | 内容 | 依赖 |
|---|---|---|
| **AK-1** 密码策略 + 哈希升级 | §3 补列 + §4.1 + §4.2 + 六入口接入 + 弱密码评估落库 + `POST /api/password/check` | 无 |
| **AK-2** 登录防护 + 后台标识 | §4.3 + §4.4 + 后台 tag/解锁 + 锁定与限流测试 | AK-1（标记字段） |
| **AK-3** 账号流程 | §4.5 + §4.6 + §4.7 + §4.8 + 设置项 `auth.registrationEnabled` | AK-1（策略）；AK-2（登录响应） |
| **AL** 登录/注册/改密页面 | §5 全部（路由、三个页面、首页入口、后台表单） | AK-3（接口契约） |

## 9. 本期不做（写清楚，避免被当成漏项）

- MFA / TOTP / WebAuthn / 短信验证码；
- 第三方登录（Steam OpenID 仅用于绑定，不做站点登录）；
- 密码历史（禁止复用最近 N 次）、定期强制换密（NIST 不推荐）；
- HIBP 已泄露密码库在线比对（大陆网络不稳，后续单独评估）；
- 邀请码 / 邮箱域名白名单（**已确认不做**，开放注册 + 邮箱验证，见 §2-7）；
- 找回密码页独立化（仍放在 `/login` 的"忘记密码"模式里）。

## 10. 待确认

无。三条默认取向已于 2026-11-06 由所有者确认：**不做邀请码**、**记住我 30 天（不勾 7 天）**、**用户名统一 3–32、不含空格/斜杠**。
