# 项目总览：SteamDeals / gameprice

本文是后续维护者与 AI 会话的项目入口，概括产品边界、当前架构、功能落点和已知限制。它描述仓库代码，不代表所有外部数据源或部署环境都已验证可用。

**新会话上手、日常开发、发版构建与部署的完整步骤见 [DELIVERY.md](DELIVERY.md)**（含构建镜像的 tag 流程与踩坑汇总），本文只讲"代码长什么样"。

## 后续开发的必做收尾：同步更新本文

每次新增或实质修改功能，在实现完成时**必须检查并更新本文件**，不能只改代码、测试或 CHANGELOG。把这条规则视为功能交付的一部分；即使本次会话被压缩、换模型或交给另一个 AI，也应先读本文并遵守。若仓库中存在适用的 `AGENTS.md`，同时遵循其中要求。

完成代码后，至少核对并按需更新以下内容：

1. **架构与代码落点**：模块职责、请求/数据流、入口和相关文件是否变化。
2. **功能与状态**：在“功能与代码落点”表中新增或修正能力、状态、限制和主要文件；区分已实现、已测试、真实环境已验证、受凭据/网络限制、尚未实现，不要把其中一种说成另一种。
3. **数据与配置**：新增/修改的数据实体、API/CLI 入口、环境变量或后台设置、部署依赖及迁移要求是否需要记录；敏感值只记录变量名，不记录真实凭据。
4. **验证和未完成事项**：记录本次实际执行的测试或运行验证及结果；未执行的验证明确标注未验证，不根据代码存在推断生产可用。
5. **专项文档链接**：若功能已有 README、WEB、DEPLOY、DATA-SOURCES 或 ARCHITECTURE 等专项说明，保持它们与本总览一致，并补上互相可发现的链接。
6. **对外描述同步（发布必做）**：每次**发布新版本（打 tag 构建镜像）时，必须按发布时点的真实功能更新全部对外描述**——`README.md` 的功能表/命令参考/环境变量/已知限制、`docs/` 各专项文档、CHANGELOG，以及 **GitHub 仓库的 About/description 与 topics**（用 `gh repo edit --description ...`）。不允许出现"文档说没有 Web 服务、实际上线了整套 Vue 后台"这类错位；改代码的会话若不打 tag，也要把这项列入交付说明，由发布会话执行。

最终回复前做一次文档收尾检查：总览中的文件路径确实存在、功能状态与当前实现相符、没有把计划写成已完成。若判断不需要修改本文，也要先核对相关章节，并在交付说明中简要说明核对过且无需变更。只更新 CHANGELOG 不满足这项要求。

## 项目定位

SteamDeals 是以 Steam AppID 为游戏主键的跨平台游戏价格采集、比较和历史追踪服务。它采集 Steam、杉果、GOG、Humble 和 IsThereAnyDeal 等来源的报价，记录价格变化，提供 CLI、静态价格页和 Web 管理界面。

产品约束：主榜和史低统计仅纳入官方商店及授权零售商；C2C 报价不参与官方最低价。每条报价应可追溯到平台、区服、抓取时间和购买链接。项目不提供站内购买或代购，也不承诺对商品真伪作超出来源边界的保证。

## 技术栈与运行入口

- 服务端：Node.js ≥22.5，ES modules；运行依赖为 `pg`、`undici`、`@electric-sql/pglite`。
- 数据库：PostgreSQL 15（兼容目标从文档/SQL约束看为 PostgreSQL 10+）；无 `DATABASE_URL` 时 CLI 可使用嵌入式 PGlite。
- Web 前端：Vue 3、Vue Router、Element Plus、Vite；前端源码在 `frontend/`，由服务端提供静态资源和 JSON API。
- 部署：Docker Compose；可使用内置 PostgreSQL 或外部数据库。生产镜像构建时打包前端静态资源。
- 命令行入口：`src/cli.js`；常驻任务入口：`src/scheduler.js`；HTTP 服务入口：`src/server.js`，静态资源服务辅助模块：`src/serve.js`。

## 系统结构

```text
浏览器
  ├─ Vue 应用 frontend/src (路由、页面、组件、样式)
  ├─ 静态曲线页 out/ (由 chart 生成)
  └─ JSON API / 登录、初始化、管理接口
           │
           ▼
Node.js 服务 src/server.js
  ├─ setup/auth/settings/访问控制等路由模块
  ├─ 业务与安全模块：用户、会话、验证码、限流、IP/CIDR 黑名单、访问记录
  ├─ CLI/报表/提醒/备份/导入等共用业务模块
  └─ scheduler.js 子进程调度采集与提醒任务
           │
           ├────────── 数据源 adapters ── RawOffer ── ingest.js
           │                                      │
           └──────────────────────────────────────┤
                                                  ▼
                                       store/index.js + store/pg.js
                                                  │
                                                  ▼
                                      PostgreSQL / 嵌入式 PGlite
```

### 数据采集与入库

适配器位于 `src/adapters/`，按平台把外部响应解析成统一报价。`src/ingest.js` 负责平台/游戏/别名归并、当前报价 upsert、价格变化快照和按日聚合；数据库连接与 SQL 集中在 `src/store/`。HTTP 请求、代理选择和重试封装在 `src/http.js`、`src/proxy.js`。

标准数据链：调度器或 CLI 启动采集 → 适配器抓取并解析 → ingest 写当前报价与历史 → `fetch_runs` 记录运行结果 → 成功采集后可自动重建曲线页。详细失败模型和设计理由见 [ARCHITECTURE.md](ARCHITECTURE.md)。

### Web 服务与前端

`src/server.js` 负责组合 HTTP API、初始化/认证/设置路由和静态前端；辅助路由分别在 `src/setup-routes.js`、`src/auth-routes.js`、`src/settings-routes.js`。`src/serve.js` 提供静态文件服务。前端是 `frontend/` 里的 Vue 3 应用（Vue Router + Element Plus + Vite），主页面和后台页面位于 `frontend/src/pages/`；服务端按 `frontendDir` 提供构建产物（含 PWA 的 `/manifest.webmanifest` 与 `/icon-*.png`），`web/` 下的旧页面只在没有 `frontend/dist/index.html` 时作为回退。

安全与用户能力由服务端模块承载：`src/session-cookie.js`、`src/email-auth.js`、`src/captcha.js`、`src/ratelimit.js`、`src/guard.js`、`src/visitors.js`、`src/devices.js`、`src/steam-login.js`。不要仅凭前端隐藏按钮判断授权；权限必须由 API 校验。

## 功能与代码落点

尚未实现、但已经留痕的议题见 [ROADMAP.md](ROADMAP.md)（例如 Steam 锁国区与 18+ 内容的地区化展示）。

| 能力 | 主要文件 | 当前状态/边界 |
|---|---|---|
| Steam 国区价格 | `src/adapters/steam.js` | 已实现；运行需要 Steam 站点可达，国内通常需出口代理 |
| 杉果采集与 SKU 自动发现 | `src/adapters/sonkwo.js`, `sonkwo-discover.js`, `src/match.js` | 采集、发现和名称匹配已实现；商品覆盖取决于 SKU 库 |
| GOG / Humble / ITAD | `src/adapters/gog.js`, `humble.js`, `itad.js` | GOG 已可用；Humble 命中有限；ITAD 需要 API key，未经真实 key 完整验证 |
| Steam 元数据导入 | `src/adapters/steam-meta.js`, `steam-catalog.js` | 支持官方与 steamcmd 镜像后端及回落 |
| **Steam 同步状态与内容分级** | `src/adapters/steam.js`（`classifySteamStatus`）、`src/adapters/steam-meta.js`（分级解析）、`src/steam-status.js`（`applySteamDetails` 共用落库 + `runSteamStatusRound` 一轮循环）、`src/store/pg.js`（7 列 + `steam-status` 选取/写回）、`src/cli.js`（`steam-status` 命令 + backfill 合并写入）、`src/scheduler.js`（每日任务，X 批起）、`frontend/src/pages/AdminModules.vue`（指标卡 7 分项 + 状态/分级列 + 分级筛选）、`Home.vue`（角标/隐藏） | 已实现并发布 v1.15.0：状态机六态（ok/free/coming_soon/region_locked/no_price/not_found/pending）让「为什么没价格」可解释；锁国区=cc=cn 失败 + cc=hk 复核；成人/成熟内容按平台标签派生（`site.adultDisplay` = hide/badge/show，默认前台隐藏、后台可见）；免费游戏一次 SQL 置位；`steam-status` 任务与分级共用同一次请求、`steam_checked_at` 续跑。**V 批（已实现并发布 v1.15.1）**：后台 `rating=adult|mature|none` 分级筛选 + 指标卡成人/成熟计数；backfill 的 appdetails 回退路径经 `applySteamDetails` 顺带写状态与分级（省约 6.9 万次请求，拿不到状态不推游标、分级 null 不覆盖）。**AB 批（已实现并发布 v1.16.4，2026-11-06）**：修复整轮静默不写库（appdetails 条目少取 `.json` 导致 0 写入）；`runSteamStatusRound` 收敛一轮逻辑——写入不可静默（`wrote` 只计真写入、`skip_write`/`write_miss` 可观测、全跳过必须报错）、限速按每请求计、429 立即收轮、整轮复用连接、每轮写 `sync_runs`；`steamStatus.limit` 默认 12000→6000（约 5 小时/轮），补 `steamStatus.initialDelaySec` 设置项（原 Y 批）。规格见 [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md) 与 [STEAM-STATUS-FIX.md](STEAM-STATUS-FIX.md) |
| 当前价、快照、日历史、史低 | `src/ingest.js`, `src/store/pg.js` | 价格变化才写快照；主榜及历史低价查询过滤非官方/授权渠道 |
| 比价、历史和静态曲线 | `src/compare.js`, `src/report.js`, `src/cli.js` | CLI 查询与 `chart` 静态 HTML 曲线 |
| Web/API、安装和账户 | `src/server.js`, `src/*-routes.js`, `frontend/` | Vue 前端覆盖前台、初始化、封禁页与控制台十个模块；`web/` 旧页面仅作无构建产物时的回退；具体入口见 [WEB.md](WEB.md)。**管理员建号原子化（已实现并发布 v1.16.3）**：`POST /api/admin/users` 支持可选 `email`，账号与邮箱同一次 INSERT 落库——邮箱被占用（`users_email_uniq`）返回 409「这个邮箱已被其他账号绑定」且**不产生残号**（修「先建号、再绑邮箱」两步式留下幽灵用户的 bug）；用户名重复同样 409。**搜索中英文（AD 批，已实现并发布 v1.17.0）**：关键词条件收敛到 `db.gameKeywordSql`——`name`/`name_en`/`game_aliases.platform_title` 三源命中（exists 子查询防重复行），关键词与字段两侧去空格（半角/全角）归一化，纯数字按 AppID 精确命中；后台「游戏管理」搜索同口径复用；`rename` 候选放开为「name 不含中文即补中文名」（`upsertGameMeta` 覆盖保护仍在）。规格见 [SEARCH-I18N.md](SEARCH-I18N.md) |
| **用户彻底删除（AH 批）** | `src/store/pg.js`（`deleteUserAudited` / `listUserDeletions` + `admin_user_deletions` 审计表）、`src/server.js`（`DELETE /api/admin/users/:username` + `GET /api/admin/users/deletions`）、`frontend/src/pages/AdminExtras.vue`（删除按钮/确认弹窗/最近删除表）、`test/admin-user-delete.test.js` | 已发布 v2.0.0（2026-11-06）：硬删除 + 最近删除审计——弹窗必须输入用户名确认（删自己 400、最后一个可用管理员 409、不存在 404）；单事务先清 `steam_games`/`steam_wishlist`（无外键）再删 `users`（其余级联，会话立即失效）；审计行只存脱敏快照（邮箱打码/关联计数/操作者/原因）；删除后用户名可立即重新注册；`listUsers` 附带 sessions/steam_accounts 计数供弹窗展示。规格见 [USER-LIFECYCLE.md](USER-LIFECYCLE.md) |
| **邮件模板 + HTML 邮件 + 发送记录（AI 批）** | `src/mail-templates.js`（9 事件默认模板/渲染/校验/示例版式）、`src/notify.js`（multipart/alternative + 主题防注入）、`src/email-auth.js`（`mail_templates`/`mail_log` 建表）、`src/store/pg.js`（模板与日志存取）、`src/auth-routes.js`/`src/server.js`（验证码邮件套模板 + 模板管理接口）、`frontend/src/pages/AdminExtras.vue`（模板卡 + 发送记录双 tab）、`frontend/src/admin-ui.js`（ElTabs/ElTabPane 注册）、`test/mail-templates.test.js`、`test/notify-html.test.js` | 已发布 v2.0.0（2026-11-06）：HTML 多部分邮件（text/plain 兜底，主题去 CR/LF 防注入）；9 事件模板可编辑/启停/预览/发测试/恢复默认/套用 3 套示例版式（`{{code}}` 仅验证码可用，未知变量只警告，统一页脚代码追加）；登录/重置/绑定验证码邮件套 `verify_code` 模板（停用回退纯文本）；`mail_log` 记录通知类发送（验证码仍走 `email_codes`）；「最近发送记录」分验证码/通知两个 tab。规格见 [USER-LIFECYCLE.md](USER-LIFECYCLE.md) |
| **账号变更通知（AJ 批）** | `src/account-notify.js`（`notifyUserAction` 渲染+发送+mail_log、模块级串行队列）、`src/server.js`（PATCH/改邮箱/重置密码/删除四个入口接入，批量入口按决策 9 不接）、`frontend/src/pages/AdminExtras.vue`（notify 回执 toast）、`test/account-notify.test.js` | 已发布 v2.0.0（2026-11-06）：7 类管理操作触发 8 类通知邮件（禁用/启用/删除/改名/改邮箱/改角色/重置密码 + 邮箱绑定成功）；改邮箱发两封（旧邮箱收「登录邮箱已变更」、新邮箱收「绑定成功」；旧邮箱空/未验证改发新邮箱；新旧相同只发一封；解绑不发）；删除走异步（响应 `notify:'queued'`），PATCH/重置密码同步且结果进响应（`notify:{status,error}`）；模板停用跳过（`skipped_disabled`）、未绑定邮箱跳过并提示（`skipped_no_email`）、发送失败不影响业务（`failed`，落 `mail_log ok=false`）；串行队列单封超时 8 秒失败不重试；操作者固定「站点管理员」、`mail_log.actor` 记真实操作者；正文不含密码/token/Key/IP/完整邮箱，删除原因只进审计与日志；批量禁用/启用不发（决策 9）。规格见 [USER-LIFECYCLE.md](USER-LIFECYCLE.md) |
| **Steam 代理池后端（AM-1 批）** | `src/proxy.js`（`parseProxyList`/`steamProxyUrls` 多条解析）、`src/proxy-pool.js`（候选顺序/冷却/粘住/健康文件）、`src/http.js`（选代理挪进重试循环）、`src/settings.js`（多行校验 ≤10 与行号报错）、`src/server.js`（`GET /api/admin/proxies`）、`src/cli.js`（diagnose 输出池状态）、`test/proxy-pool.test.js`、`test/http-proxy-failover.test.js` | 已发布 v2.0.0（2026-11-06）：`network.steamProxy` 支持多条（换行/逗号分隔、去重、≤10，老单行 = 1 条且保持旧行为）；只有代理层失败（连不上/超时/TLS/代理 CONNECT 4xx/5xx）才在同一次请求内切换，目标 HTTP 5xx/429 不切换；失败冷却 60s/5min/30min、成功清零并粘住（lastGood 优先）、全部冷却取最早解冻；全部失败抛 `PROXY_ALL_FAILED` **不回退直连**；健康状态落 `data/proxy-health.json`（sha256 key 不含地址密码、tmp→rename 原子写、跨子进程共享）；`GET /api/admin/proxies` 返回脱敏状态（ok/cooldown/unknown）；测试断言「第 2 次尝试代理 ≠ 第 1 次」并做过反例自检（nextCandidate 恒返第一条 → 测试变红）。规格见 [PROXY-POOL.md](PROXY-POOL.md) |
| **Steam 代理池设置页（AM-2 批）** | `frontend/src/pages/AdminModules.vue`（列表编辑器 + 健康状态表 + 10 秒自动刷新）、`test/proxy-pool-ui.test.js` | 已发布 v2.1.0（2026-11-09）：「网络与代理」的 Steam 专用代理从单行输入改为**列表编辑器**——「查看并编辑」走现有明文通道（`GET /api/admin/settings/value?key=network.steamProxy`）填入可编辑列表，每行 上移/下移/删除，底部 添加一条（满 10 置灰）/清空全部；保存 = 非空行按顺序 `join('\n')` 提交 `network.steamProxy`（清空传 `null`），前端先校验 http/https 与 ≤10（报行号），服务端仍兜底；列表下方**健康状态表**（#/代理/状态/连续失败/冷却到/最近错误，状态 正常绿/冷却中倒计时黄/未知灰，地址脱敏由 API 保证）+「刷新」按钮 + 网络分组展开且页面可见时每 10 秒自动刷新 + 保存后立即刷新。规格见 [PROXY-POOL.md](PROXY-POOL.md) |
| **未保存修改的离开提醒（AN 批）** | `frontend/src/composables/useUnsavedGuard.js`（模块级来源表 + requestLeave + 路由守卫）、`frontend/src/components/UnsavedLeaveDialog.vue`（全局三选一弹窗）、`frontend/src/App.vue`（挂载）、`frontend/src/router/index.js`（beforeEach）、`frontend/src/pages/Console.vue`（select 先询问 + 菜单小圆点 + 401 bypass）、`AdminModules.vue`/`MailSettingsForm.vue`/`AdminExtras.vue`（五个编辑面注册）、`test/unsaved-guard.test.js` | 已发布 v2.1.0（2026-11-09）：系统设置/邮件配置/站点通知/编辑游戏/新建用户五个编辑面有未保存修改时，切菜单（Console.select）或路由离开（router.beforeEach）弹三选一「保存并离开 / 放弃修改 / 留在本页」；保存并离开按注册顺序逐个 await 保存、任一失败留在本页并提示；保存成功 toast 已保存；刷新/关闭不拦（无 beforeunload）；401/非管理员跳转走 bypassNextGuard；当前菜单项带未保存小圆点。规格见 [UNSAVED-GUARD.md](UNSAVED-GUARD.md) |
| **密码策略 + 哈希升级（AK-1 批）** | `src/password-policy.js`（策略纯函数 + 入口错误文案）、`src/data/common-passwords.js`（Top 1 万 + 词根变体）、`src/store/pg.js`（`$scrypt$32768$8$1$` 版本化格式 + 旧格式兼容 + 5 个补列）、`src/server.js`（登录静默 rehash + 弱密码评估落库 + `POST /api/password/check` 匿名限流）、`src/setup-routes.js`/`src/auth-routes.js`/`src/cli.js`（入口统一策略）、`test/password-policy.test.js` | 已发布 v2.1.0（2026-11-09）：密码最低 12 位（最长 200）+ 弱口令黑名单（Top 1 万 + 常见词数字尾巴）+ 含用户名/邮箱片段 + 全同字符 + 连续序列判定与 0–4 评分；六个设置密码入口统一调用（初始化/后台建号/后台重置/自助重置/CLI/注册与改密后续接入）；scrypt N=32768 版本化哈希（`$scrypt$N$r$p$…`），旧 `salt:hash` 继续可验、登录成功静默升级并更新 `password_updated_at`；登录时评估 `weak_password` 落库（三态）；`POST /api/password/check`（匿名、每 IP 每分钟 30 次）返回 `{ok,score,reasons,suggestions}` 供前端强度条。规格见 [AUTH-REDESIGN.md](AUTH-REDESIGN.md) |
| **登录防护 + 后台安全标识（AK-2 批）** | `src/server.js`（登录重写：IP 限速/锁定/统一 401/记住我）、`src/store/pg.js`（`unlockUser` + listUsers/findUserByName 带安全字段）、`frontend/src/pages/AdminExtras.vue`（已锁定/弱密码/需改密 tag + 解锁按钮）、`test/auth-lockout.test.js` | 已发布 v2.1.0（2026-11-09）：同 IP 15 分钟失败 ≥20 次 → 429（不消耗账号尝试次数）；账号 5 次错密码锁 15 分钟（第 6 次 429 + 剩余时间，锁定期内正确密码也 429）；成功清零；登录失败统一「用户名或密码错误」（禁用原因只进日志，验收 11）；管理员解锁（`POST /api/admin/users/:username/unlock` + 审计）；「记住我」30 天/默认 7 天；登录与 /api/me 响应带 `mustChangePassword`；后台用户列表「已锁定（红+解锁）/ 弱密码（红）/ 需改密（黄）」tag。规格见 [AUTH-REDESIGN.md](AUTH-REDESIGN.md) |
| **账号流程（AK-3 批）** | `src/settings.js`（`auth.registrationEnabled` 开关 + auth 分组）、`src/password-policy.js`（`generateTempPassword`）、`src/store/pg.js`（createUser/setUserPassword 支持 mustChange、重置不再顺带启用）、`src/server.js`（建号/重置留空生成临时密码、`POST /api/user/password`、首登强制改密 403 守卫）、`src/auth-routes.js`（`/api/auth/register/request|verify`）、`test/register.test.js`、`test/password-change.test.js` | 已发布 v2.1.0（2026-11-09）：后台建号/重置密码可留空 → 16 位随机临时密码（响应只回一次）且 `must_change_password=true`，重置**不再顺带启用账号**；自助注册（开关关闭 403、SMTP 未配置 503、用户名 3-32 无空格斜杠、唯一性 409、图形验证码 + 三级发码限流、`purpose='register'` 6 位码、建号 `email_verified=true` 并自动登录）；登录用户改密（旧密码错 400、策略校验、踢其它会话保留当前、`weak_password` 清除）；`must_change_password` 用户业务接口 403（`code='must_change_password'`，白名单 /api/me、/api/logout、/api/user/password、/api/site、/api/captcha、/api/password/check 与静态资源），改密后恢复。规格见 [AUTH-REDESIGN.md](AUTH-REDESIGN.md) |
| **登录 / 注册 / 改密页面（AL 批）** | `frontend/src/pages/LoginPage.vue`、`RegisterPage.vue`、`ChangePasswordPage.vue`（新增）、`frontend/src/router/index.js`（三条路由）、`frontend/src/pages/Home.vue`（登录跳 /login?next、去弹窗、修改密码入口、401 跳转、mustChange 跳改密页）、`frontend/src/pages/Console.vue`/`AdminModules.vue`/`AdminExtras.vue`（mustChange 与 401 处理 + 后台随机生成/临时密码弹窗）、`frontend/src/main.js`（ElProgress）、`src/server.js`（/api/site 带注册就绪状态）、`test/auth-pages.test.js` | 已发布 v2.1.0（2026-11-09）：独立 `/login`（桌面左右分栏品牌区 + 420px 表单卡、移动 ≤900px 单列、三模式分段切换、密码可见切换 + Caps Lock 提示 + 错误就地显示 + 记住我 30 天 + 验证码重试占位，登录成功回跳 `next` 只允许站内相对路径）、`/register`（用户名/邮箱/验证码 60 秒倒计时/密码/确认 + 300ms 防抖强度条；开关关闭或 SMTP 未配置显示不可用说明 + 返回登录）、`/change-password`（当前/新/确认 + 强度条，`forced=1` 顶部不可关闭提示，成功提示并回首页）；首页不再弹登录框；会话过期任意接口 401 → `/login?next=…`；后台新建/重置密码留空 → 临时密码弹窗（只显示一次、可复制）+「随机生成」按钮。规格见 [AUTH-REDESIGN.md](AUTH-REDESIGN.md) |
| **同步价格批（AC-2 批）** | `src/steam-status.js`（判 ok 顺带写首次 offer）、`src/cli.js`（done 日志带写价计数）、`src/store/pg.js`（`adminGameStats` 口径）、`test/steam-status.test.js` | 已发布 v2.1.0（2026-11-09）：`steam-status` 判定 `ok`（国区有价）时**顺带写该游戏的首次 offer**（与状态共用同一次 appdetails 响应，不额外消耗配额；价格用国区 final，锁区/无价/免费不写；fingerprint 幂等不重复写）；「已同步」口径复核为 **ok + 有报价**（免费不要求报价），与用户感知一致。规格见 [SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md) AC8 |
| **同步吞吐批（AC-3 批）** | `src/cli.js`（回填候选排序：`created_at desc` 新游戏优先）、`src/scheduler.js`（回填默认上限 2 万→5 万；`steamDailyBudgetMinutes` + `applySteamBudget` 每日配额预算）、`test/scheduler.test.js` | 已发布 v2.1.0（2026-11-09）：回填队列**新游戏优先**（按收录时间倒序，backfill 与 steamall 两处），不再按 id 排队数周；每周回填上限 2 万 → **5 万**；每日 Steam 配额预算——prices+heat+backfill(周摊)+status 四任务串行估算超 24h 时**自动缩 steam-status 限额**并记 `scheduler.budget_exceeded` 告警（启动与设置重载都生效）。规格见 [SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md) AC9/AC4 |
| **同步可靠性批（AC-4 批）** | `src/scheduler.js`（`registerCircuitReset`/`resetCircuit` 熔断手动重置钩子）、`src/server.js`（`POST /api/admin/circuit/reset`）、`frontend/src/pages/AdminModules.vue`（熔断行「重置熔断」按钮）、`src/http.js`（`readSteam429Until`/`writeSteam429Until` 429 冷却落盘）、`src/ingest.js`（`rawOfferShapeIssue` 结构校验）、`test/scheduler.test.js`、`test/http-error.test.js`、`test/pg.test.js` | 已发布 v2.1.0（2026-11-09）：熔断状态在任务面板可见（熔断至 X）并支持**手动重置**（后台按钮 → `POST /api/admin/circuit/reset` → 清零失败计数与冷却，立即恢复可跑，审计日志）；429 退避**落盘跨子进程共享**（`data/steam-429.json` 原子写，任何子进程都尊重最早的冷却，不再各睡各的 30 分钟）；报价解析**结构校验**——`priceCents`/`title`/`region` 缺失记 `adapter.<平台>.shape_mismatch` 并跳过该条，字段改名不再静默变 null。规格见 [SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md) AC2/AC6/AC7 |
| **Steam 价格同步优化（F 批）** | `src/cli.js`（`cmdSyncSteamPrices`：限速 1100→1600ms；选取 SQL 改热点优先+冷门降频）、`test/steam-prices-priority.test.js` | 已发布 v2.2.1（2026-11-09）：① 请求间隔 1100→**1600ms**（约 187 次/5 分钟，落回 Steam 200 次/5 分钟配额内，不再靠 429 冷却兜底）；② 选取条件改为**热点优先 + 冷门降频**——热点（近 90 天有访问 `page_views` / 有用户标记 `user_game_flags` / `heat ≥ 1`）每天刷，冷门仅在最近价格快照（`price_snapshots.captured_at`）超过 **3 天**未更新才刷，排序 `is_hot desc, last_snap asc`；阈值可调：`STEAM_PRICES_HOT_HEAT_MIN`（默认 1）、`STEAM_PRICES_COLD_DAYS`（默认 3）；不新增调度任务、不动 `jobsFromEnv`。计划见 [TODO.md](TODO.md) F 段 |
| **价格历史报表（AP 批）** | `frontend/src/components/PriceHistoryReport.vue`（指标条 + SVG 趋势线 + 表格/卡片）、`frontend/src/pages/Home.vue`（替换旧网格并清理 series 分页与死样式）、`test/price-history-report.test.js` | 已发布 v2.2.0（2026-11-09）：详情页价格历史改为报表视图——指标条（区间最低/区间最高/当前较史低/记录天数，避免与顶部当前价/史低卡重复）、范围「近 30 天 / 近 90 天 / 全部」（锚点=最后一条记录日期）、手写 SVG 趋势线（史低点绿点 + 悬停提示）、表格（日期/当日最低/较前一日/标记，**史低行整行高亮 + 徽标**，每页 10 条）；「较前一日」与前一条有记录的日期比较（金额+百分比，持平/首条文案）；移动端卡片化（史低卡绿边）；**无前端导出按钮**（后端 CSV 与 `HISTORY_CSV_ENABLED` 不动）。规格见 [PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md) |
| **游戏列与平台链接抽屉改版（AO 批）** | `frontend/src/components/GameLinksDrawer.vue`（抽屉：头部/渠道卡片/空态）、`frontend/src/utils/gameNames.js`（`nameCopyText` 中英文两行）、`frontend/src/pages/AdminModules.vue`（游戏列 flex 布局 + 点名字开抽屉 + 复制 ✓ 反馈）、`test/admin-links-drawer.test.js` | 已发布 v2.2.0（2026-11-09）：游戏列名称单行省略、复制图标固定行尾（hover 才亮、成功变 ✓ 1.2s）；英文名悬停 title 看全名；**一次复制 = 中英文两行**（相同/缺失回退单行）；**点游戏名打开链接抽屉**、点图标只复制（`@click.stop`）；抽屉重做——封面+中英文名+AppID+「复制中英文名 / 复制 AppID」chips，每条渠道一张卡（平台色点/区服标签/现价/划线原价/折扣/库存/相对更新时间/打开 ↗，国区优先、同区价格升序，缺货降透明度），空态给 Steam 商店兜底，底部口径说明；移动端全屏。规格见 [ADMIN-LINKS-DRAWER.md](ADMIN-LINKS-DRAWER.md) |
| **异常审核按 IP 合并（AR 批）** | `frontend/src/pages/AdminModules.vue`（合并开关/聚合计算/合并表格与卡片/合并批量处置）、`frontend/src/styles/main.css`（merge-bar/merged-detail 样式）、`test/admin-review-lists.test.js`（静态断言） | 已实现待发版（2026-11-09）：待审列表加「按 IP 合并」开关（默认关，`localStorage['admin.reviewMerge']`）；同一 IP 的多条规则合成一行——规则摘要（`rule ×n`，按次数降序）/ 总次数 / 首次→最近 / 设备数 / 状态（有 pending=待审、全 auto_banned=已封禁、混合=部分已处理）；展开行显示每条规则的次数/路径/时间/状态；处置（封 IP / 封设备 / 忽略）作用于该 IP **全部待审记录**，确认弹窗写明「N 条规则 / M 次命中 / K 个设备（共 X 条记录）」并要求输入条数；封设备按指纹去重；勾选合并行 = 该 IP 全部待审记录，合并操作条显示「已选 N 个 IP · M 条待审」；合并视图支持排序（最近出现/IP/总次数/规则数，复用 `compareIp`，localStorage 持久化）；移动端每张卡一个 IP。规格见 [ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §4 |
| **访问/异常列表排序（AQ 批）** | `frontend/src/utils/ipSort.js`（`compareIp` 数值 IP 排序）、`frontend/src/pages/AdminModules.vue`（两个列表表头排序 + localStorage 持久化 + 待审上限 500 提示）、`src/store/pg.js`（`visitorOrderClause` 白名单排序子句 + `listVisitorLogs` sort/order + `listAbuseReviews` 上限 500）、`src/server.js`（`/api/admin/visitors` sort/order 白名单）、`test/ip-sort.test.js`、`test/admin-review-lists.test.js` | 已发布 v2.2.0（2026-11-09）：异常审核列表**客户端排序**（最近出现/IP/次数/规则，默认「最近出现 ↓」，IP 按数值序——IPv4 转整数、IPv6/异常值排后按字符串、空值最后——状态存 `localStorage['admin.reviewSort']`，切换回第 1 页不重置筛选）；访问明细**服务端排序**（`sort=time|ip|status` + `order=asc|desc` 白名单，非法回落默认；IP 用零填充字符串键排序、不用 `ip::inet` 防脏数据炸查询；状态存 `localStorage['admin.visitorSort']`，换排序回第 1 页）；待审拉取上限 300 → **500**（列表头显示「共 N 条（上限 500）」）。规格见 [ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §3 |
| **线上问题修复批（v2.2.0）** | `src/cli.js`（heat 取 `data.json`）、`src/adapters/steam-catalog.js`（catalog 取 `data.json`）、`test/fetchjson-contract.test.js`、`frontend/src/composables/useUnsavedGuard.js`（`discard` 回调机制）、五个编辑面各加 `discard`、`test/unsaved-guard.test.js`（+2 项回归） | 已发布 v2.2.0（2026-11-09）：① **C1**——AB 批 `fetchJson` 改契约后 heat/catalog 仍按旧契约解包（heat 全量无效跳过、catalog 空跑），改 `data.json` 解包并加契约回归测试；② **AN 回归**——「放弃修改」只放行一次不清草稿导致弹窗反复出现，改为注册签名支持 `discard`、五个面各自清草稿。规格见 [TODO.md](TODO.md) C 段与 [UNSAVED-GUARD.md](UNSAVED-GUARD.md) §7 |
| **愿望单缺陷修复批（AA 批）** | `src/server.js`（`steam.wishlist_manual_add` 日志失败项带 reason）、`frontend/src/pages/Home.vue`（失败 toast 带 reason、无 AppID 不弹多选直接仅本站、无绑定账号提示可绑定同步）、`test/wishlist.test.js` | 已发布 v2.2.0（2026-11-09）：六项产品缺陷全修——① 服务端日志记每个失败账号的 `{steamId, reason}`；② 前端推送失败提示带原因（未配 Key / 解密失败 / Steam 拒绝）；③ 未配 API Key 账号弹窗置灰注明；④ 无绑定账号提示「绑定 Steam 账号可同步推送」；⑤ 空选按钮「仅加入本站」；⑥ 无 Steam AppID 条目明确「仅本站」（不再弹多选）。**根因（Steam 写接口 401）已定案，方案 A「诚实提示」待开发**（[WISHLIST-OAUTH.md](WISHLIST-OAUTH.md)）。规格见 [WISHLIST-FIX.md](WISHLIST-FIX.md) §4/§6 |
| **手机端 PWA** | `frontend/public/manifest.webmanifest`、`icon-192.png`、`icon-512.png`、`frontend/index.html`、`src/server.js`（`serveFrontendStatic` + `isFrontendPublicFile`）、`frontend/src/utils/network.js`、`frontend/src/composables/useBackGuard.js`、`useVersionGuard.js`、`frontend/src/pages/Home.vue`、`frontend/src/App.vue`（更新/断网提示条） | 已实现并发布 v1.16.0（2026-11-05 验证：`npm test` 49 个文件 419 项全绿 / `node test/api.test.js` 22 项全绿 / `frontend:build` / `scan` 干净）：`display: standalone` + `orientation: portrait`，192/512 图标（512 声明 maskable），主题色对齐暗色 token；**不做 service worker / 离线缓存 / 推送 / 购物车**；fetch 失败统一提示「网络不可用，请检查连接后重试」并可重试；Android 返回键先关闭浮层再退出（仅手机结构，PC 不接管）；**版本检查**（§2.1）：启动记基线 + `visibilitychange` 比对 `/api/site` 的 `version`，不一致顶部提示「已更新到 vX.Y.Z，点击刷新」，`AUTO_RELOAD=false`，离线静默跳过。规格见 [MOBILE-PWA.md](MOBILE-PWA.md) |
| **手机端适配修复（Z 批）** | `frontend/src/pages/Home.vue`（vw/vh 根因、桌面模式提示、安装入口、视觉微调）、`frontend/src/composables/useInstallPrompt.js`、`frontend/src/pages/AdminModules.vue` / `AdminExtras.vue`（卡片化 + 滑动提示）、`frontend/src/styles/main.css`、`test/frontend-mobile.test.js` | 已实现并发布 v1.16.2（2026-11-06）：真机（红米 + 小米自带浏览器忽略 viewport、按 980 排版）详情弹窗右侧被裁——`vw` 不受 zoom 影响，移动端全屏样式改回 `%`/`dvh`、删除 `html.mobile-layout` 死规则；桌面版网站渲染时顶部可关闭提示（保留 zoom 兜底）；Chrome 触发 `beforeinstallprompt` 时顶部「安装到桌面」，不支持时「我的」页给 Chrome 操作说明；后台游戏目录/访问记录各 tab 手机卡片式（勾选/批量可用），其余表格「左右滑动查看更多」提示；触摸目标 ≥44px。规格见 [MOBILE-FIX.md](MOBILE-FIX.md) |
| 封禁与申诉 | `src/devices.js`, `src/ratelimit.js`, `src/server.js`（`BAN_ONLY_PAGES` 注册表 + `/api/ban/state`）、`frontend/src/pages/BanPage.vue`, `AppealPage.vue`, `composables/useBanOnlyPage.js` | 仅封禁可见页面统一守卫（`/banned`、`/banned.html`、`/appeal`：未封禁/管理员/封禁过期一律 302 回首页，判定只在拦截链）；客户端每 30 秒复查，解封后自动回首页；申诉 URL 只带 `?code=`（站点信息注入 `__APPEAL__`，申诉走邮件、不落库）；`/appeal` 对封禁 IP/设备放行；黑/白名单双向互斥；待审口径 = 全部 `pending` |
| 关注、降价提醒、通知 | `src/alerts.js`, `src/notify.js` | 目标价/史低触发；Webhook、企业微信机器人、SMTP |
| **后台列表批量操作** | `src/server.js`（`BULK_ACTIONS` 派发表 + `/api/admin/bulk`）、`src/store/pg.js`（`bulk*` SQL + `admin_bulk_ops`）、`frontend/src/composables/useBulkSelection.js`、`components/BulkBar.vue`、`components/BulkResultDialog.vue`、`pages/AdminModules.vue`、`pages/AdminExtras.vue`、`pages/Console.vue` | 已实现并发布 v1.14.0（2026-11-03 验证：`npm test` 46 个测试文件全绿 / `frontend:build` / `scan` 干净）：11 个列表可多选批量执行（待审/访问明细/回收站/站点通知/IP 黑名单/IP 白名单/已封设备/自动封禁/游戏目录/最近设备/用户）；单次上限与高危确认由服务端派发表决定，成功/跳过/失败逐条回执，审计落 `admin_bulk_ops`。规格见 [ADMIN-BULK-ACTIONS.md](ADMIN-BULK-ACTIONS.md) |
| 定时采集与熔断 | `src/scheduler.js`（`jobsFromEnv` / `dueJobs` / `planTick` / `lastRunMsFromRows`）、`src/store/pg.js`（`lastSyncRunStartedByMode`） | 已实现并发布 v1.16.1：任务隔离子进程运行；Steam 重任务**非阻塞发射 + 全局单槽**（`heavySlot`），长任务运行期间轻任务照常派发（X 批，见 [SCHEDULER-BLOCKING-FIX.md](SCHEDULER-BLOCKING-FIX.md)）；`steam-status` 归入重任务、每天一轮 12000 条；启动时从 `sync_runs` 恢复 `lastRunMs`（发版重启不重置计时）；状态文件每 tick 刷新；连续失败会在冷却期内暂停调度任务 |
| **版本检测按 IP 选仓库（AE 批）** | `src/version.js`（`detectRegion` / `fetchRegistryLatest` / `checkRegistryLatest` / `pickSourceOrder`）、`src/server.js`（`/api/admin/version` 透传 `source`/`region`）、`test/version.test.js` | 已实现并发布 v1.18.0（2026-11-06）：徽标先按服务器 IP（`ipinfo.io`，2s 超时 + 24h 缓存）选源——大陆/香港优先 TCR、其他优先 Docker Hub，两仓库都走匿名 token（401 换新 token 重试，tag 无 `v` 前缀取 `X.Y.Z` 最大），全失败回退 GitHub；结果缓存成功 6h / 全失败 10min。规格见 [VERSION-SOURCE.md](VERSION-SOURCE.md) |
| **搜索态写操作列表不刷新（AF 批）** | `frontend/src/pages/Home.vue`（`invalidateSearchCache`）、`test/frontend-search-cache.test.js` | 已实现并发布 v1.18.0（2026-11-06）：愿望单加/删、感兴趣/已拥有标记、取消提醒成功后先失效 30 秒搜索缓存再 `loadGames`；无搜索词与缓存能力不变。规格见 [FRONTEND-STALE-LIST.md](FRONTEND-STALE-LIST.md) |
| **后台平台链接抽屉 + 复制（AG 批）** | `src/store/pg.js`（`adminGameLinks`）、`src/server.js`（`/api/admin/games/:id/links` + 列表 `link_count`）、`frontend/src/utils/clipboard.js`、`pages/AdminModules.vue`（链接列 + 抽屉 + 复制）、`pages/Home.vue`（卡片/详情标题复制）、`test/admin-games.test.js` | 已实现并发布 v1.18.0（2026-11-06）：后台「游戏目录」链接入口列（`N 个`）点击开抽屉按需加载（仅 http/https，`javascript:` 过滤，同平台多区服各一行，无链接但有 AppID 时给 Steam 商店兜底）；后台游戏名/AppID 与前台卡片/详情标题点击复制（clipboard API + `execCommand` 降级，HTTP 环境可用）；手机抽屉全屏。规格见 [ADMIN-PLATFORM-LINKS.md](ADMIN-PLATFORM-LINKS.md) |
| **同步观测与任务健康（AC-1 批）** | `src/scheduler.js`（`auditJobs`、状态文件 `lastElapsedMs/lastResult/lastError/waitingFor`、`job_wait_slot`/`job_wait_end` 日志）、`src/cli.js`（数据任务统一 `runSyncTracked`）、`src/server.js`（`/api/admin/sync/status` 带 `warnings`）、`pages/AdminModules.vue`（任务健康列 + 缺失任务提示）、`test/scheduler.test.js` | 已实现并发布 v1.18.0（2026-11-06）：heat/rename/backfill/discover/images/backup/prune/alerts/report/logs-prune 全部写 `sync_runs`（后台「同步记录」可见）；重任务排队可观测（进入排队记 `job_wait_slot`、启动记 `job_wait_end`，面板显示占用者）；后台任务表新增「上次结果 / 耗时 / 失败原因 / 等待」列；`/api/admin/sync/status` 返回 `warnings`（缺 `STEAM_API_KEY` 或被 `*_ENABLED=0` 关闭的任务），「同步与回填」页显式提示。规格见 [SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md) §6 |
| 日志、自检、备份、回填 | `src/log.js`, `src/probe.js`, `src/backup.js`, `src/backfill.js` | JSONL 结构化日志、脱敏、健康检查及运维命令 |
| Docker 部署 | `Dockerfile`, `compose*.yaml`, `scripts/docker-entrypoint.sh` | Compose 文件和镜像流程已配置；执行部署前按目标 Compose 与镜像仓库确认 |
| **README 开发进度摘要（AS 批）** | `scripts/todo-progress.js`（解析 TODO 状态行 + 生成/`--check`）、`README.md`（`<!-- TODO-PROGRESS:START/END -->` 标记块）、`.github/workflows/docs-progress.yml`、`test/todo-progress.test.js` | 已实现待发版（2026-11-09）：`docs/TODO.md` 仍是唯一来源，脚本生成 README「开发进度」块（进行中 / 接下来 / 最近 5 个完成 + 当前版本 + 计数，未知状态进「待分类」）；`--check` 由 CI `docs-progress` 校验防漂移；替换旧手写「路线图」并修正 Docker/多区服/锁国区过期描述，未排期产品项迁入 ROADMAP。规格见 [TODO-PROGRESS.md](TODO-PROGRESS.md) |

## 关键数据概念

- `games`：以 Steam AppID 为中心的游戏主记录；来源标题可以先形成待匹配记录，再通过匹配流程归并。
- `platforms`：数据平台及 `kind` 渠道类型（官方、授权零售商、C2C）。
- `offers`：当前报价；唯一维度包含游戏、平台、产品类型与区服。
- `price_snapshots`：价格变化历史；相同价格状态不重复写入。
- `daily_prices`：按天聚合，用于趋势与史低；面向官方主榜的查询必须保留渠道类型过滤。
- `fetch_runs`：每次采集的健康度和结果；关注/提醒、用户权限、运行配置等其他表结构集中在 `src/store/pg.js` 的迁移 SQL。
- `admin_bulk_ops`：后台批量操作的审计（操作者、目标列表、动作、总数/成功/失败/跳过、键样本、耗时），
  后台「系统 → 批量操作记录」页读取；键样本最多存 50 个，避免一次写入上千条 IP。

金额使用整数分存储，区服和币种是显式维度，不对不同币种擅自换算。日期应保留为 `YYYY-MM-DD` 字符串语义，避免时区偏移。

## 配置与部署入口

- 环境变量和默认值：查看 `src/settings.js`、`README.md`。
- Web 设置：部署初始化后可在控制台系统设置中管理业务配置；敏感凭据不应写入版本控制。
- 本地快速开始：查看 [README 快速开始](../README.md#快速开始)。
- 生产/云服务器部署：查看 [QUICKSTART.md](QUICKSTART.md)、[DEPLOY.md](DEPLOY.md)。
- 拉取已发布镜像：查看 [DOCKER-HUB.md](DOCKER-HUB.md) 及 `compose.hub.yaml`、`compose.cn.yaml`。
- 数据源可达性与限制：[DATA-SOURCES.md](DATA-SOURCES.md)。

## 常用命令

```sh
node src/cli.js bootstrap       # 幂等初始化数据库并导入初始游戏库
node src/cli.js diagnose        # 检查运行环境、数据库和外部连通性
node src/cli.js sync all        # 执行可配置的数据源采集
node src/cli.js list            # 查询官方/授权渠道主榜
node src/cli.js history 1091500 # 查看指定 AppID 的历史
node src/cli.js chart           # 生成静态价格曲线页
node src/cli.js serve           # 启动 Web/API 服务
node src/scheduler.js           # 启动常驻调度器
```

完整参数以 `README.md` 命令参考和 `src/cli.js` 实现为准。

## 测试与维护约定

测试在 `test/`，按模块拆分；`npm test` 顺序执行测试文件。新增功能应补相应模块测试，并更新本总览、相关专项文档及 README 的功能状态。数据源“代码存在”不等于“生产可用”：验证状态应分别注明代码覆盖、真实请求验证、凭据要求和网络前提。发布说明不得把未实际构建/启动的 Docker 镜像说成已验证。**每次发版必须同步全部对外描述**（README 功能表/命令/环境变量、docs 各文档、GitHub 仓库 About/description 与 topics），以发布时点的真实功能为准——这也是“后续开发的必做收尾”第 6 条，属于交付的一部分。

遇到与本文冲突时，以当前代码和专项文档为准，并修订本文，避免把它当作运行时规范。






