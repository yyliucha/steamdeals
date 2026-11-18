# 待办总览（未完成事项清单）

> 最后更新：2026-11-18（已完成需求移入 [DONE.md](DONE.md)，本清单只保留未完成条目）。
> 接手会话先看本清单，再看 [REQUIREMENTS-INDEX.md](REQUIREMENTS-INDEX.md)（**需求批次总账**：全部批次的规格 + 状态 + 是否已有开发描述）、
> [DONE.md](DONE.md)（**已完成/已过时条目存档**）、[DELIVERY.md](DELIVERY.md)（流程/发版）与 [UI-FIXES.md](UI-FIXES.md)（界面缺陷细节）。
> **清单分工（2026-11-18 所有者新规）**：本清单**只放待办**；条目变为 `已发布 vX.Y.Z` 或 `已过时` 后**整段移入 [DONE.md](DONE.md)**
> （发布时由 `steamdeals-build` 会话移动；判定过时由需求会话移动），不再留在本清单。

> **【需求封板 · 2026-11-18 所有者（2026-11-18 晚口径修订）】**：**只接本清单（TODO）已立项的条目**——包括封板前已沟通、已建条目的新功能类（CW/CX/CY/CZ/DA/DC/DF 等）；**TODO 之外的新需求一律只记录、不排期、不建开发会话**，等所有者解封（规则见 [HANDOVER.md](HANDOVER.md) §11）。
> **状态词（唯一口径；本清单只出现未完成态）**：`待开发` / `依赖阻塞` / `开发中` / `已实现待发版` / `待质检` / `质检通过` / `质检打回` / `待排查` / `待决策`。
> `已发布 vX.Y.Z` 与 `已过时` 在发布/判定后移入 [DONE.md](DONE.md)，不在本清单出现。
> **每个待办条目必须有一行 `**状态：…**`**——本文件是开发、质检两个 skill 的**唯一事实来源（待办侧）**，靠这一行判断是否可开工、是否已交付。
> **README 进度**：排期与状态以本清单 + [DONE.md](DONE.md) 为准；README 只放一条指向本页的链接，**不再生成摘要**。

---

## CO. 待开发：设计审计技术债清理（21 项 → 4 批，每日推进）

**状态：已发布子项（CO-2 B1/B2、CO-3 C2/C4/C5、CO-1 A5、CO-2 B5、CO-4 D1）已移入 [DONE.md](DONE.md)；A3 已实现待发版（6a9ecc3）；剩余 B3/B4/D4/E4/D6 待开发（源清单 [DESIGN-AUDIT.md](DESIGN-AUDIT.md)，每条含证据与建议）；E1 文档归档已完成（不进版本）**
**依赖：** 无（A2/A4/C1/D5 已分别由 CL/CJ/CK 覆盖，本批只做"未开"的 15 项）
**解锁：** 无
**推进规则**：每个开发会话**至少认领 1 条**（开工把该行改「开发中」），当天实现+测试+提交，
把该行改「已实现待发版」并**回写 DESIGN-AUDIT.md「跟踪」列**；一次会话不跨批次混做，批次顺序由所有者定。
**通用验收**：每条按 DESIGN-AUDIT.md 的「建议」给出可测断言 + `npm test` / `frontend:build` / `scan` 全绿；不自行打 tag。

| 批次 | 子项 | 内容（对应审计编号） | 状态 |
|---|---|---|---|
| **CO-1** | A3 | `skus.json` 与 `game_source_map` 双真相源 → 以库为唯一真相、skus.json 只读兼容 | 已实现待发版（2026-11-18，6a9ecc3） |
| **CO-2** | B3 | 任务预算改**实测耗时**（AC-4 估算）；任务卡显示实际与估算差 | 待开发 |
| **CO-4** | B4 | 巨石拆分（`server.js`/`pg.js`/`cli.js` 渐进拆 routes/repository，先一个域试点） | 待开发 |
| **CO-4** | D4 | 移动/桌面双结构 `v-if` 渐进合并（CSS 优先） | 已实现待发版 |
| **CO-4** | E1 | TODO 历史段归档（K/M/N/O/P 重复字母、A 段 v1.4.6） | 质检通过（2026-11-18 文档归档完成，需求会话直接交付，无 QA 轮；历史段已移 DONE.md） |
| **CO-4** | E4 | 日志统一字段规范（关键域失败字段 + 告警阈值） | 待开发 |
| **CO-4** | D6 | 覆盖率/性能基线门禁（与 CK 的 e2e 报告联动） | 待开发（CK 已发布 v2.24.0，依赖解除） |

> 已被其它条目覆盖、**不重复做**：A1→CN、A2→CL、A4→CJ、C1→CL、D5→CK、D2/D3 已有测试防护、E3 已有规则。


## CQ. 待开发：系统设置信息架构重构（平台卡片 + 常用/高级折叠 + 只看非默认）

**状态：待开发（2026-11-17，demo v2 已确认 `design/settings-ia-2026-11-17-v2`；§6 三条已拍板：折叠带摘要/恢复默认二次确认/移动端单列卡片）**
**依赖：** 无
**解锁：** 无
**规格**：[SETTINGS-IA.md](SETTINGS-IA.md)

- **痛点（实测）**：`settings.js` 86 个配置项平铺——sources 32、advanced 16、alerts 13、security 10、site 8、auth 4、network 3；
  「数据源与采集」把开关/间隔/条数/限速/Key 混在一起，`高级` 16 项一屏到底，越加越难维护。
- **已确认决策（7 项）**：① 数据源按平台卡片（全局/Steam/杉果/ITAD/GOG+Humble/发现与热度）；② 每卡常用 ≤3 项，
  其余进「高级 N 项」折叠（默认收起，标题行带摘要）；③ 站点与内容常用 4 项 + 「推荐与评分 4 项」折叠；
  ④ 高级拆 4 折叠组（调度与熔断/备份与日志/缓存与图片/时区与显示）；⑤ 通用能力：只看非默认、来源标注（数据库/环境变量/默认）、
  恢复默认（单行+分组）、搜索命中自动展开高亮；⑥ **不改任何 key/默认值/语义**，只在 `def()` 加 meta（section/tier/summary）
  并由 schema 接口下发；⑦ 保存/重新加载/15 秒热加载行为不变。
- **改动落点**：`src/settings.js`（86 项补 meta）、`src/settings-routes.js`/`src/server.js`（schema 带 meta + `source` + `isDefault`）、
  `frontend/src/pages/AdminModules.vue`（卡片/折叠/过滤/恢复/搜索展开）、`test/settings.test.js` 扩展。
- **验收**：见规格 §4——① 6 张平台卡、每卡常用 ≤3；② 折叠默认收起且标题带摘要；③ 站点/高级折叠组符合 demo；
  ④ 只看非默认生效且刷新保持；⑤ 来源标注三类正确；⑥ 恢复默认（单行/分组）生效；⑦ 搜索命中折叠项自动展开高亮；
  ⑧ 保存/重载/权限行为不变；⑨ `npm test` / `frontend:build` / `scan` 全绿；移动端单列。
- **已确认（2026-11-18）**：折叠标题行带摘要；恢复默认（单行/分组）二次确认；移动端单列卡片 + 折叠保留。


## CU. 待开发：到价提醒治理（无报价标记 / 站点级迁移 / 史低抽检 / 刷新频率评估）

**状态：待开发（2026-11-18，四项合并；基于线上 watchlist 实测）**
**依赖：** CL（已发布 v2.23.0，用户级提醒）
**解锁：** 无
**规格**：[USER-ALERTS-GOVERNANCE.md](USER-ALERTS-GOVERNANCE.md)

- **实测（2026-11-18）**：15 条提醒全部为**站点级**（user_id 为空）、全部未设目标价（跌至史低模式）；
  其中 **2 条无任何报价**（State of Decay 3 / Warhammer 黑暗异端）→ 永远不触发；
  多条当前价=史低（靠 last_notified 去重）；**部落幸存者史低 ¥20.25 可疑**（当前 ¥72）。
- **四项（合并交付）**：CU-1 列表「无报价」徽标+筛选；**CU-2 站点级提醒按 Steam 愿望单反查用户**
  （`steam_wishlist` → `steam_accounts.user_id`，多用户全部列出，可一键迁移给这些用户，审计）；
  **CU-3 史低抽检（全部异常样本**，不只部落幸存者，只读 SQL，脏数据才修）；CU-4 Steam 刷新频率评估
  （默认不改，只出 720/480 配额数字与建议）。
- **改动落点**：src/store/pg.js（hasPrice + 迁移/批量删）、src/server.js（/api/admin/watchlist 扩展 +
  /migrate + 批量删除 + 审计）frontend/src/pages/AdminModules.vue（徽标/筛选/多选/迁移）、测试。
- **验收**：见规格 §4——① 无报价两行有徽标且可筛选；② 迁移后 user_id/收件人变化；③ 批量删除+审计；
  ④ 抽检 SQL 结论；⑤ npm test / frontend:build / scan 全绿；⑥ CU-4 只出建议不改配置。
- **待确认**：无（2026-11-18 已定：迁移目标=按 Steam 愿望单反查的用户，多个全列；抽检=全部异常样本；CU-4=只出配额数字）。


## CW. 待开发：后台「游戏目录」点游戏名弹详情（Steam 数据 + 商店跳转）

**状态：开发中（2026-11-18，所有者需求；demo 已出）**
**依赖：** 无
**解锁：** 无
**规格**：[ADMIN-GAME-POPUP.md](ADMIN-GAME-POPUP.md)（含 demo 状态↔断言表）
**Demo**：[design/admin-game-popup-2026-11-18.html](design/admin-game-popup-2026-11-18.html)

- **现状**：后台游戏名是纯文本（`AdminModules.vue` L67），无点击；已有 `GET /api/games/:appid` 返回
  `{game, offers, series, dlc, watch}`；`GAME_SELECT` **缺 `header_image`、`release_date`** 两列。
- **需求（6 项）**：① 点游戏名弹小弹窗（640px，移动端 100%）；② 内容 = 封面 + 中英名 + AppID + 徽标 +
  发售/开发商/发行商/类型/平台/分级 + 价格条（当前/史低/折扣）+ 简介（4 行可展开）；③ 数据用**站内已同步的
  Steam 数据**（不实时请求）；④ 底部固定「**在 Steam 商店查看**」→ `https://store.steampowered.com/app/<appid>/` 新窗口；
  ⑤ 未同步/无 appid 有明确兜底；⑥ 游戏名用蓝色虚线下划线样式，不影响行内按钮。
- **改动落点**：`src/store/pg.js`（`GAME_SELECT` +2 列）、`frontend/src/pages/AdminModules.vue`（点击 + 弹窗 + fetch + 兜底）、
  `test/api.test.js`（详情含 `header_image`/`release_date` 断言）。
- **验收**：见规格 §4 的 11 行「demo 状态 ↔ 断言」——列表点击、徽标、封面、字段、价格、简介展开、Steam 跳转、
  无 appid 兜底、移动端、`npm test` / `frontend:build` / `scan` 全绿。
- **已确认（2026-11-18）**：回收站同样支持；弹窗加 **DLC 数量 + Steam 评测数**（复用同一详情响应，
  `heat_reviews` 随 `GAME_SELECT` 返回）；简介保持 4 行截断 + 展开。


## CX. 开发中：个人资料编辑（Web + App；头像存库/双 Steam 账号/换绑）

**状态：开发中（2026-11-18 晚开工；所有者 5 项决策已确认；两个 demo 已出）**
**依赖：** 无（CY 的数据隔离可并行）
**解锁：** 无
**规格**：[USER-PROFILE-EDIT.md](USER-PROFILE-EDIT.md)
**Demo**：[design/profile-web-2026-11-18.html](design/profile-web-2026-11-18.html) / [design/profile-android-2026-11-18.html](design/profile-android-2026-11-18.html)

- **现状**：`users` 无头像/bio 列；`/api/me` 只有 GET；没有个人资料页；Steam 账号已有列表/别名/解绑（解绑保留历史），
  绑定走 Steam 登录。
- **需求（8 项）**：① 管理员/用户同一套页面与接口，只能改自己；② **头像存数据库**（bytea + mime + source），
  客户端裁剪 256×256，`GET /api/avatar/:userId` 输出；③ 头像来源 = 已绑 Steam 账号（**多账号可选其一**）或自定义上传；
  ④ 昵称（2–20）/简介（≤200）/主题/邮件提醒开关可编辑；用户名/邮箱（二期换邮箱）/角色只读；
  ⑤ Steam 账号卡：列表 + **设为默认 / 解绑（保留历史）/ 新增绑定**；⑥ **App 端同样支持**（新增在浏览器打开绑定流程）；
  ⑦ 其它页面有头像处显示头像；⑧ 与 CY 的只读边界一致（管理员不能改别人的资料）。
- **改动落点**：`pg.js`（users 加列 + profile/avatar/默认账号）、`server.js`（`PATCH /api/me/profile`、
  `POST/DELETE /api/me/avatar`、`GET /api/avatar/:userId`、`POST /api/steam/accounts/:id/default`）、
  `frontend/src/pages/ProfilePage.vue`（新）+ Console 入口、App `ProfileEditScreen`、`test/profile.test.js`。
- **验收**：见规格 §4 的 10 行「demo 状态 ↔ 断言」——头像展示/默认头像切换/双账号列表/设为默认/解绑/新增、表单校验、
  只读字段、越权 403、`npm test` / `frontend:build` / `scan` 全绿 + App 模拟器验证。
- **补充（2026-11-18 沟通）**：**我的资料仅本人可见**（无他人访问入口，管理员同样）；**必填**昵称/简介/邮箱（管理员昵称/简介可空，
  邮箱仍必填；老用户邮箱为空不强制补全）；**多 Steam 账号用卡片**（每账号一卡：头像/昵称/SteamID/已拥有数/愿望单数/最近同步）；
  资料页下半部展示我的游戏库与统计（仅本人）；DB 已并入本条目。


## CY. 待开发：数据隔离（用户私有数据管理员只读）

**状态：待开发（2026-11-18，所有者确认边界）**
**优先级：** P1（安全/合规）
**依赖：** CX（个人资料页）
**解锁：** 无
**规格**：[DATA-ISOLATION.md](DATA-ISOLATION.md)

- **现状**：用户级接口已按 `session.user.id`；但 `/api/admin/watchlist`（全站到价提醒）、`/api/admin/wishlists`、
  `/api/admin/views` 等**管理员可写用户数据**（后台有删除按钮），没有只读边界。
- **边界（已确认）**：用户私有数据（提醒/愿望单/访问记录/Steam 绑定）**管理员只读**；站点级提醒、账号安全
  （封禁/会话/设备）、申诉处理、内容审核、未归属账号认领**保留可写**。
- **改动**：`/api/admin/watchlist` 写操作仅允许 `user_id IS NULL`；用户行写 → **403 + 审计 `admin.forbidden_write`**；
  `/api/admin/wishlists`、`/api/admin/views` 去掉写方法；前端用户行隐藏操作按钮并标「只读」；
  用户级接口忽略请求里的 `userId`；新增 `test/isolation.test.js`（A/B 两用户 + 管理员三视角）。
- **验收**：见规格 §4——① A 只看自己的；② 管理员看全部但用户行不可写（越权 403 + 审计）；③ 站点级可写；
  ④ 账号安全/申诉/审核回归通过；⑤ 管理员查看 Steam 绑定只读；⑥ `npm test` / `frontend:build` / `scan` 全绿。


## CZ. 待开发：更换登录邮箱（邮箱体系收尾；验证码登录/忘记密码已实现）

**状态：待开发（2026-11-18 沟通完成；5 项决策已确认；规格已出）**
**来源：** [USER-PROFILE-EDIT.md](USER-PROFILE-EDIT.md) §5、[APP-NATIVE.md](APP-NATIVE.md) §6 第 4 条
**依赖：** CX（个人资料页）、现有邮件服务（SMTP 已配置）
**解锁：** 无
**规格**：[EMAIL-CHANGE.md](EMAIL-CHANGE.md)
**Demo**：[design/email-change-2026-11-18.html](design/email-change-2026-11-18.html)（Web）/ [design/email-change-android-2026-11-18.html](design/email-change-android-2026-11-18.html)（App）

- **现状（代码核对）**：邮箱验证码登录（`/api/auth/email/request|verify` purpose=login）、忘记密码（purpose=reset）、
  邮箱验证码注册（`/api/auth/register/request|verify`）**都已实现**并有前端入口；**用户自助更换邮箱没有**——
  只有管理员能改用户邮箱（`server.js:3506`）。→ 本批只做换邮箱 + 加固，不重复实现已有功能。
- **已确认决策（5 项）**：① 验证码发**新邮箱**、旧邮箱收安全通知；② 换成功**全部会话下线**（含当前，跳登录）；
  ③ 验证码 10 分钟/5 次；**换邮箱 24h 最多 1 次**；④ 未验证邮箱也能换（换完变已验证）；
  ⑤ **保留管理员重置邮箱能力**（安全兜底）+ 审计 + 通知用户。
- **接口**：`POST /api/me/email/request`（不泄露占用）、`POST /api/me/email/verify`（占用在验证码通过后才提示 409；
  成功→更新 email/email_verified、删全部会话、审计 `auth.email_changed`、发两封邮件）；管理员重置接口保留。
- **前端**：资料页邮箱行加「更换邮箱」→ 两步对话框（新邮箱+验证码）；**App 端同样支持**（底部弹层两步，成功后清 token 跳登录）。
- **验收**：见规格 §4——① 换成功双邮件 + email_verified；② 会话全清（当前 401 跳登录）；③ 验证码错误/过期/超次数提示；
  ④ 24h 频控 429；⑤ 未验证可换；⑥ 管理员重置仍可用 + 审计；⑦ App 端可完整走通换邮箱；⑧ npm test（email-change 7 项）/ frontend:build / scan 全绿。


## DA. 已实现待发版：CM-5 App 筛选/排序服务端化（方案 A：站点 + App 一起做）

**状态：已实现待发版（2026-11-18，站点 b46669a + App 4334823；验收 1/2/2b/3/4/5 本地+模拟器验证通过，P95 ≤500ms 待部署后线上抽测）**
**来源：** [APP-PARITY.md](APP-PARITY.md) §57（CM-5）、[APP-NATIVE.md](APP-NATIVE.md) §4.4（"筛选 ⚠️ 本地按已加载数据"）
**依赖：** 无（站点 `/api/games` 已支持 sort=discount/price/name/score、type、released；需扩展筛选参数）
**解锁：** 无
**规格**：[APP-FILTER-SERVER-SIDE.md](APP-FILTER-SERVER-SIDE.md)

- **现状（代码证据）**：App `HomeScreen.kt` 的 `HomeFilter`（全部/折扣/史低/免费/未发售）是**本地筛选已加载数据**；
  注释明确"服务端 /api/games 目前只支持 sort 与 type/released"。→ 用户只能筛出**已加载的约 50 条**里的折扣游戏。
- **范围（方案 A）**：站点 `/api/games` 增加 `discountOnly / histLowOnly / freeOnly / unreleased` + `sort=heat|release`，
  4 个开关互斥（优先级 unreleased > freeOnly > histLowOnly > discountOnly），count 与列表同条件；App chip 改为
  **服务端筛选 + 分页重置**；**第 5 个 chip「已拥有」复用 `owned=only`**（仅登录+已绑定 Steam 显示）；Web 复用同参数保证口径一致。
- **附带（已确认）**：`user_prefs.only_discount` 是**死字段**（存但未用）→ **删除**（迁移 drop 列）。
- **已确认口径**：史低 = 当前价 = 历史最低（与详情页一致）；未发售**不含**"已发售无报价"；已拥有 = 多账号 Steam 库存并集。
- **验收**：见规格 §4——① App 折扣筛选返回全库结果；② Web/App 同条件总数一致；②b 已拥有 chip 返回库存并集/未绑定不显示；
  ③ 空态/分页正确；④ count 与列表一致；⑤ P95 ≤500ms；⑥ `npm test` / `frontend:build` / `scan` 全绿 + App 模拟器逐 chip 截图。
- **已确认（2026-11-18 开发完成时）**：App 本期做（双仓库同批提交）；Web 前台复用同一批参数（接口共用解析保证口径一致，Web UI 不改版）。


## DC. 待开发：App 公告角标与公告列表（CM-6）

**状态：开发中（2026-11-18 沟通完成；3 项口径已确认）**
**来源：** [APP-PARITY.md](APP-PARITY.md) §65
**依赖：** 站点 `GET /api/announcements` + `POST /api/announcements/read`（均已实现）、App 登录态

- **现状（代码核对）**：后端已齐——`announcements`（active/starts_at/ends_at）、`announcement_reads(user_id, announcement_id)`、
  读接口返回公告 + 当前用户 `readIds`（游客空数组）、已读上报接口；**App 端没有公告列表/角标**。
- **已确认口径**：① 入口 = **首页右上角铃铛 + 「我的」里的「公告」**；② 未读 = **所有 active 公告中不在 readIds 的**；
  ③ **游客可看公告**，已读存本地（登录后与服务端合并）。
- **范围（纯 App 端）**：铃铛角标（未读数，0 隐藏）→ 公告列表弹层（标题/级别色点/时间/已读态）→ 点开详情；
  进入/点击后上报已读；下拉刷新；未读数为 0 时角标消失。
- **验收**：未读公告出现角标数字；点开列表后逐条已读、角标递减；全部已读后角标消失；游客本地已读重启 App 仍保留；
  登录后本地已读合并到服务端；`npm test`（如站点补 unreadCount 则加断言）/ App 构建 + 模拟器验证。


## DF. 待开发：到价提醒手动推送（重发按钮）

**状态：待开发（2026-11-18 沟通完成；4 个口径已确认；demo 已出）**
**依赖：** CL（用户级提醒，已发布）、现有 `notify.js` 通道
**解锁：** 无
**规格**：[ALERT-MANUAL-PUSH.md](ALERT-MANUAL-PUSH.md)
**Demo**：[design/alert-manual-push-2026-11-18.html](design/alert-manual-push-2026-11-18.html)（单条推送）+
[design/admin-confirm-no-toggle-2026-11-18.html](design/admin-confirm-no-toggle-2026-11-18.html)（批量推送合并一封/确认/审计）

- **现状**：提醒只由 `alerts` 定时任务触发（每 360 分钟）；后台每行只有「删除」，没有手动发送。
- **需求**：每行加「推送」→ 确认弹窗（游戏/用户/当前价/史低/上次提醒/渠道）→ 立即发送；
  **强制推送**（未达条件也发）与**更新最近提醒时间**（写 `last_notified`，默认勾选）两个选项；无通道时按钮禁用。
- **接口**：`POST /api/admin/watchlist/:id/push { force, mark }`（单条）与 `POST /api/admin/watchlist/push { ids }`（批量合并一封邮件），
  复用 `evaluateAlerts`/`renderDigest`/`notify`；**5 分钟**频控；审计 `admin.alert_pushed`。
- **验收**：见规格 §4——达标/未达标/强制/mark 去重/频控 429/无通道禁用/审计落库/`npm test`+`frontend:build`+`scan` 全绿。
- **已确认（2026-11-18）**：① **只有管理员能推**，用户级提醒**不可推**（只站点级）；② mark **默认勾选**；
  ③ **支持一键推送/批量**，批量**只发一封邮件**（正文列出所有勾选游戏）；④ 频控 **5 分钟**。


## DH. 待开发：对齐审核数据完整性（继承缺口/忽略撤销/审阅痕迹）

**状态：质检通过（2026-11-18，d3c67ec + 修复 cc8e351；QA docs/QA-DH.md 第 2 轮 ✅）**
**依赖：** DG（匹配修复）、DE（页改版）
**解锁：** 无
**规格**：[ALIGN-INTEGRITY.md](ALIGN-INTEGRITY.md)

- **问题**：A 继承缺口——`applyMapInheritance` 只认 `game_source_map`，不认 `skus.json` 已有 `appid`（断箭 SKU 111465 已映射仍入队）；
  B 忽略不可撤销（无「已忽略」视图/恢复）；C 审阅痕迹不可见（`reviewed_by` 有存但页面无展示）；D 孤儿行合并无提示。
- **修复**：A1 继承同时参考 item.appid（有则不入队，库无映射则自动补写 + 日志 `align.map_backfilled`）；
  A2 队列标「已映射（待同步）」+ 一键补写；B1 「已忽略」视图 + 恢复为待处理（审计 `align.restored`）；
  C1 每组显示最近处理（操作人/时间/动作）；D1 确认弹窗提示孤儿行合并。
- **接口**：`GET /api/admin/align/ignored`、`POST /api/admin/align/restore {key}`、`GET /api/admin/align/history?key=`、
  `POST /api/admin/align/map`。
- **验收**：见规格 §4——① 断箭组不再入队且映射补写；② 已忽略可列出/恢复；③ 审阅记录可查；④ 孤儿行合并提示；
  ⑤ `npm test` / `frontend:build` / `scan` 全绿。
- **已确认（2026-11-18）**：补写=**自动**（计算时补写 + 日志 align.map_backfilled）；恢复已忽略=**需要二次确认**。







