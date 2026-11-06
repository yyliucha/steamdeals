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
