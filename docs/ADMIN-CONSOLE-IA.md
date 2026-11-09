# 后台信息架构改版：新增改抽屉 · 操作日志合并 · 设置/邮件 tab · 价格走势线图

> 状态：**已实现并发布 v2.4.0（2026-11-09，a500811）**——所有者已确认 Q1–Q4、Q7；Q5 定为 **C：右侧抽屉浮层（不跳页）**；
> Q6/Q8/Q9 按建议默认（§12）。QA ✅ 放行（docs/QA-ADMIN-CONSOLE-IA-AT.md，通过 14 / 缺失 0 / 偏差 0 / 需人工确认 4）。
> 原型：[docs/design/admin-console-ia.html](design/admin-console-ia.html) + [总览图](design/admin-console-ia-overview.png)。
> 关联：[PROJECT-OVERVIEW.md](PROJECT-OVERVIEW.md) · [WEB.md](WEB.md) · [USER-LIFECYCLE.md](USER-LIFECYCLE.md) ·
> [ADMIN-PARITY.md](ADMIN-PARITY.md) · [UNSAVED-GUARD.md](UNSAVED-GUARD.md) · [HANDOVER.md](HANDOVER.md)

一句话：**「新建/编辑」从列表页里拆成右侧抽屉浮层（不跳页）；把散落在四个页面的日志并进一个「操作日志」菜单（5 个 tab）；
把「邮件服务」「系统设置」两张长页面改成 tab；把价格报表底部「近 7 天变化」改成悬停「变化」列弹出的走势线图。**

## 1. 已确认的决策（所有者原话，2026-11-09）

| # | 所有者原话 | 我的理解 | 状态 |
|---|---|---|---|
| 1 | 图一 新加用户，开启新页面，不要做到这个页面里面，这里只需要有一个用户列表 | 「用户管理」页只留用户列表；新建用户改成**浮层**（右上入口打开），不再内嵌表单 | 已明确 |
| 2 | 新开一个菜单，菜单名：**操作日志**；这个里面会把所有页面中和日志有关的都合并到一起；用户的最新删除合并到里面；就一个页面，页面用 tab 来区分 | 新增菜单「操作日志」，一页多 tab，收拢全站日志类页面 | 已明确 |
| 3 | 图二 新建通知一样做成一个页面 | 「站点通知」页只留公告列表；新建/编辑通知改成**同样的浮层** | 已明确 |
| 4 | 访问记录不要调整 | 「访问记录」四块（访问明细 / 异常审核 / 封禁与白名单 / 设备）本批零改动 | 已明确 |
| 5 | steam 账号，增加日志，日志放到 操作日志 中 | Steam 账号的绑定/解绑/认领/同步等动作落日志，展示在「操作日志」的一个 tab | 已明确 |
| 6 | 邮件服务，现在所有元素都在一个页面里，这里也要调整布局 | 「邮件服务」按功能拆 tab（配置 / 模板 / 测试） | 已明确 |
| 7 | 系统设置 当前这种收缩展示的不好，做成 tab | 现有 6 段 `el-collapse` 改成 6 个 tab | 已明确 |
| 8 | 数量统计：价格变化：近 7 天变化 做成移动到变化上面之后，显示线图，下面的近 7 天变化去掉不要了 | 删除底部「近 7 天变化」表；鼠标移到「变化」列 → 就地弹该游戏近 7 天线图 | 已明确 |

### 1.1 确认记录（2026-11-09）

| 编号 | 问题 | 决定 |
|---|---|---|
| Q1 | 要不要「账号操作」审计 tab（新建/禁用/改名/改邮箱/重置密码/公告发布/设置保存） | **完全按建议：本期不做**。本批只收 5 类现有日志 + Steam 账号日志；账号操作审计下期单独立项（§13 第 5 步） |
| Q2 | 邮件「发送记录」搬不搬 | **搬**，只留一个入口（操作日志 · 邮件发送）；邮件服务顶部留「查看发送记录 ↗」 |
| Q3 | 实时输出是否进 tab | **进**，「运行与同步」tab 里上表下输出；只在打开该 tab 时轮询 |
| Q4 | Steam 日志事件与保留期 | **7 类动作**（绑定/解绑/认领/同步游戏库/同步愿望单/更换 API Key/级联删除）+ **保留 180 天** |
| Q5 | 「新页面」开在哪 | **C：右侧抽屉浮层**（不跳页，列表原地不动）；新建用户、新建/编辑通知都用抽屉；`?section=users&drawer=new` 可直达，关闭回列表且筛选不丢 |
| Q6 | 用户删除 tab 上限 50 → 200 + 日期范围 | 所有者未单独回复，**按建议默认**；不同意再改 |
| Q7 | 线图数据怎么取、口径是什么 | **随列表一次返回**（`series` 并进 `/api/admin/reports/price`），悬停零延迟、无额外请求；口径＝该游戏近 7 天每日最低价（国区、官方渠道、跨平台取最低） |
| Q8 | 操作日志要不要 CSV 导出 | 所有者未回复，**本批不做** |
| Q9 | 价格表颜色「降价红 / 涨价绿」要不要对调 | 所有者未回复，**本批不动** |

## 2. 现状核对（代码证据）

| 页面 | 现状 | 证据 |
|---|---|---|
| 侧栏菜单 | 4 组 11 项：内容运营（游戏管理/回收站/站点通知）、访问与安全（访问记录）、账号与服务（用户管理/Steam 账号/邮件服务）、系统（系统设置/数据统计/批量操作记录/运行日志） | `frontend/src/pages/Console.vue:46-52` |
| 用户管理 | 第 1 张卡是**内嵌的新建用户表单**（用户名/初始密码/随机生成/邮箱/角色/创建账号），第 2 张是列表，第 3 张是「最近删除」 | `frontend/src/pages/AdminExtras.vue:3-4`、`:6` |
| 用户删除审计 | 表 `admin_user_deletions`；接口 `GET /api/admin/users/deletions?q=&limit=`，默认 50、最大 200 | `src/store/pg.js`（建表段）、`src/server.js:2559` |
| 站点通知 | 同一页：顶部「发布站点通知」表单（标题/级别/状态/正文/开始/结束/发布）+ 下方公告卡片列表 | `frontend/src/pages/AdminModules.vue:53` |
| 批量操作记录 | 独立菜单 `bulk-ops`，表 `admin_bulk_ops`，接口 `GET /api/admin/bulk-ops` + `/bulk-ops/:id` | `AdminModules.vue:66`、`src/server.js:3121` |
| 运行日志 | 独立菜单 `sync`（落进 `v-else`）：上半「同步记录」`sync_runs` 最近 20 轮，下半实时输出（10 秒轮询） | `AdminExtras.vue:49-52`、`:208`；`src/server.js:2119`、`:2486` |
| 邮件服务 | 一个页面 4 张卡：邮件配置（SMTP/收件人/申诉邮箱）、邮件模板（9 个事件）、发送测试、最近发送记录（验证码/通知两个子 tab） | `AdminExtras.vue:39-47`、`:44` |
| 系统设置 | 6 段 `el-collapse` 折叠：数据源与采集 / 站点与内容 / 账号与登录 / 通知与提醒 / 网络与代理 / 高级 | `AdminModules.vue:59`、`src/settings.js:188-195` |
| 数据统计·价格变化 | 指标 4 卡（降价/涨价/新史低/价格变化）+ 变化明细表 + **底部「近 7 天变化」表**（`daily` 来自 `priceChangesByDay`） | `AdminModules.vue:73`、`:457`、`src/server.js`（`/api/admin/reports/price`）、`src/store/pg.js:686` |
| 价格变化行 | 每行带 `game_id` + `steam_appid`（按 offer 的最近一次变价），已足够做「按游戏取 7 天序列」 | `src/store/pg.js:603-660` |
| Steam 账号 | 有绑定/解绑/认领/同步/换 Key 的写操作，但**没有任何审计表**，只有 `logger` 打点 | `src/steam-accounts.js:16/34/97/114/313`；`src/steam-login.js:16-30` |
| 未保存守卫 | `users` 的「新建用户」与 `announcements` 的表单各自注册了脏来源；改成抽屉后仍要在宿主页注册 | `AdminExtras.vue:82`、`AdminModules.vue:472-475`、`useUnsavedGuard.js:61-74` |

## 3. 目标信息架构

```
内容运营     游戏管理 / 回收站 / 站点通知（列表页；新建/编辑→右侧抽屉）
访问与安全   访问记录（不动）
账号与服务   用户管理（列表页；新建→右侧抽屉） / Steam 账号 / 邮件服务（3 tab）
日志审计     操作日志（新）  ← 吸收「批量操作记录」「运行日志」「用户管理·最近删除」「邮件服务·发送记录」
系统         系统设置（6 tab） / 数据统计（价格变化悬停线图）
```

| 菜单项 | 改版后 | 旧入口处置 |
|---|---|---|
| 用户管理 `users` | 只留列表 + 「＋ 新建用户」（开抽屉） | 内嵌表单删除；「最近删除」→ 操作日志 · 用户删除 |
| 新建用户抽屉 | `?section=users&drawer=new`；右侧 560px 抽屉 | 抽屉内：账号信息 / 初始密码 / 创建后通知 |
| 站点通知 `announcements` | 只留公告列表 + 「＋ 新建通知」（开抽屉） | 内嵌表单删除 |
| 新建/编辑通知抽屉 | `?section=announcements&drawer=new&id=`；右侧 660px 抽屉 | 「编辑」也开同一抽屉，带原内容 |
| 操作日志 `op-logs`（新） | 一页 5 tab（见 §4） | 删除 `bulk-ops`、`sync` 两个菜单；`users` 的最近删除、`mail` 的发送记录卡移除 |
| 邮件服务 `mail` | 3 tab：邮件配置 / 邮件模板 / 发送测试 | 发送记录 → 操作日志 · 邮件发送（页头留「查看发送记录 ↗」） |
| 系统设置 `settings` | 6 tab | 折叠面板删除 |
| 数据统计 `stats` | 价格变化：悬停线图 | 底部「近 7 天变化」表删除 |

## 4. 操作日志的 tab 口径（5 个 tab）

| tab | 内容 | 数据来源 | 现有接口 | 本期改动 |
|---|---|---|---|---|
| `user-deletions` 用户删除 | 彻底删除审计（用户名/角色/时间/操作者/Steam 账号数/原因） | `admin_user_deletions` | `GET /api/admin/users/deletions?q=&limit=` | 前端搬移；搜索保留；上限 50→200 + 日期范围 |
| `bulk` 批量操作 | 谁、何时、对哪个列表、成功/失败多少；点开看每条明细 | `admin_bulk_ops` | `GET /api/admin/bulk-ops?limit=&target=`、`/bulk-ops/:id` | 前端搬移 |
| `steam` Steam 账号 | 绑定/解绑/认领/同步游戏库/同步愿望单/更换 API Key/级联删除 | `steam_account_logs`（**新表**，§5） | 新增 `GET /api/admin/steam-logs` | 建表 + 埋点 + 页面 |
| `mail` 邮件发送 | 验证码 / 通知两类发送记录，成功失败原因 | `email_codes` / `mail_log` | `GET /api/admin/mail/log?limit=` | 前端搬移，保留两个子筛选 |
| `run` 运行与同步 | 同步记录 `sync_runs`（20 轮）+ 实时输出尾巴 | `sync_runs` + `logs/app-*.jsonl` | `GET /api/admin/sync/runs`、`GET /api/admin/logs` | 前端搬移；10 秒轮询只在该 tab 打开时跑 |

说明：**「账号操作」审计 tab 本期不做**（Q1），下期单独立项；tab 顺序即上表顺序。

通用：顶部 tab 显示条数；切 tab 懒加载 + 内存缓存；`?section=op-logs&tab=xxx` 可直达（刷新/收藏/从别页跳转）；
所有接口仍走 `requireAdmin()`；CSV 导出本期不做（Q8）。

## 5. 数据模型：`steam_account_logs`（新）

```sql
create table if not exists steam_account_logs (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  action       text not null,          -- bind | unbind | claim | sync-library | sync-wishlist | api-key | delete-cascade
  steam_id     text not null,
  persona_name text,                   -- 动作发生时的昵称快照
  user_id      integer,                -- 故意不挂外键：用户被删后这条证据要留下
  username     text,                   -- 归属用户名快照
  actor        text not null,          -- 'admin:xxx' | 'scheduler' | 'self'
  result       text not null,          -- ok | failed
  detail       jsonb,                  -- { added,removed,total } / { httpStatus, reason }
  elapsed_ms   integer,
  error        text                    -- 截断 200 字符
);
create index if not exists steam_logs_time on steam_account_logs (created_at desc);
create index if not exists steam_logs_steam on steam_account_logs (steam_id, created_at desc);
```

- **迁移**：`steam-login.js` 的 `ensureSteamSchema` 里 `create table if not exists`（与现有 steam 表同处，幂等，老库自动补）。
- **埋点位置**（失败不能影响主流程）：`syncAccountLibrary`(`:16`)、`syncAccountWishlist`(`:34`)、`unbindAccount`(`:97`)、
  `claimAccount`(`:114`)、`setAccountApiKey`(`:313`) 各记一条；绑定（steam 回调）与「删用户级联」各记一条。
- **保留期**：180 天，并入现有 `prune` 任务（`cli.js:2055 cmdPrune` → `db.purgeOldRows` 增 `steamDays`，默认 180，可 `--steam-days`），
  **不新建定时任务**。

## 6. 服务端

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/admin/steam-logs` | GET | 新。参数 `limit`(≤500) / `steamId` / `action` / `result` / `days`(默认 30)；返回 `{ entries, total }` |
| `/api/admin/reports/price` | GET | 改：**去掉 `daily`**（底部表删除后无人使用），**新增 `series`**：`{ [gameId]: [{day, price_cents, currency}] }`，用报告里出现的 `game_id` 一次 `group by game_id, day` 查出近 7 天（`dailyMinSeries` 加 `days` 窗口或新查询 `dailyMinSeriesBatch`，只统计官方渠道）；`days` 参数默认 7、上限 30 |
| 其余 5 个日志接口 | GET | 复用，不改契约（`users/deletions`、`bulk-ops`、`mail/log`、`sync/runs`、`logs`） |

- 为什么「随列表一次返回」：价格报告上限 100 行 → 序列最多 100×7=700 行，一次查询、一个响应；
  悬停即出图、零额外请求。行数若将来放大，再退回「悬停懒加载 + 缓存」。
- 日志事件（`src/log.js`）：`admin.steam_log.write` / `admin.steam_log.failed`。
- `requireAdmin()` 全部保留；响应字段命名沿用现有（`day` 是 `::text`，金额是整数分）。

## 7. 前端落点

| 文件 | 改动 |
|---|---|
| `frontend/src/pages/Console.vue` | 新分组「日志审计」；删 `bulk-ops`/`sync` 两项；新增 `op-logs`；`watch` 增加 `route.query.tab` 与 `route.query.drawer`（切菜单时清抽屉参数） |
| `frontend/src/pages/AdminLogs.vue`（新） | 操作日志 5 tab，懒加载 + 缓存，tab 与 URL 双向同步；`run` tab 打开时才起 10 秒轮询（离开即清） |
| `frontend/src/components/UserCreateDrawer.vue`（新） | 新建用户抽屉（560px）：账号信息 / 初始密码 / 创建后通知；成功后抽屉内一次性展示临时密码（可复制），关闭即回列表 |
| `frontend/src/components/AnnouncementDrawer.vue`（新） | 新建/编辑通知抽屉（660px）：标题/正文/级别/状态/开始结束时间 + 前台预览；`?id=` 为编辑 |
| `frontend/src/pages/AdminExtras.vue` | 删用户页的新建表单与「最近删除」卡（约 `:3-6`），换成「＋ 新建用户」按钮 + 抽屉；邮件页拆 3 tab，删发送记录卡；Steam 页加「操作日志」入口与行内「日志」链接 |
| `frontend/src/pages/AdminModules.vue` | 删公告内嵌表单（`:53`），换成「＋ 新建通知」+ 抽屉、「编辑」开抽屉；设置 `el-collapse`→`tabs`（`:59`）；统计删底部表，`变化`列挂 popover 读 `priceReport.series`（`:73`） |

要点（都是踩过的坑）：

1. **Element Plus 组件必须注册**（`frontend/src/main.js`）：本批要用的 `ElTabs`/`ElDrawer`/`ElPopover` 确认在清单里，
   缺一个就是页面静默不渲染（`ElDrawer` 之前踩过）。
2. **抽屉不跳页，未保存守卫照旧**：抽屉挂在宿主页里，脏来源仍由 `users` / `announcements` 两页注册
   （`registerUnsavedSource({ id:'new-user' | 'announcement', label, isDirty, save, discard })`）；
   `saveAndLeave()` 会无条件调用 `save()`（`useUnsavedGuard.js:69`），**不能传空的 save**，否则「保存并离开」直接抛错。
   抽屉关闭前也要过 `requestLeave()`（点遮罩 / ✕ / Esc 都算离开）。
3. **路由与抽屉状态**：`?section=users&drawer=new` 可直达；关闭用 `router.replace` 去掉 `drawer`（保留 section 与筛选参数），
   这样刷新不会莫名回到空白页；切菜单时强制关抽屉（`Console.select()` 里先关抽屉再过 `requestLeave()`）。
4. **URL 兼容**：`?section=bulk-ops`→`?section=op-logs&tab=bulk`；`?section=sync`→`op-logs&tab=run`；
   `?section=users`（原最近删除）→ 页头按钮 `op-logs&tab=user-deletions`；`?section=mail&tab=records` → 重定向到 `op-logs&tab=mail`。
   旧书签不能 404（`Console.vue:53-55` 的 section 白名单要加映射）。
5. **移动端**：抽屉 ≤768 全屏（`width:100vw`，底部按钮吸底）；tab 条横向滚动；操作日志表格沿用现有 `el-table`
   横向滚动 + 「左右滑动查看更多」提示。
6. **标题与描述**：菜单项 `label/description` 不变；抽屉标题写清「新建用户 / 编辑通知」。
7. **线图**：纯前端手写 SVG（与 `PriceHistoryReport.vue` 同风格），不引图表库；`el-popover` 的 `manual` 或 CSS hover + 300ms 延迟；
   无数据时给「暂无 7 天数据」空态；`viewBox` 自适应，`resize` 不重排。

## 8. 设置与配置

本批**不新增设置项**。系统设置的 6 个 tab 直接复用 `src/settings.js` 的 `GROUPS`（id/title/description 都不改），只换渲染方式；
搜索框保留（跨 tab 搜，命中时在该 tab 上显示命中数并自动切过去）；顶部「保存设置 / 重新加载 / 配置修订 / 未保存点」保留。

## 9. 调度与自动化

- 本批**没有新的数据同步/采集任务**（都是后台页面与读写审计），不涉及配额与单轮时长。
- 唯一的定时相关改动：`steam_account_logs` 的 180 天保留期并进现有 `prune`（每周一次，`scheduler.js:109-114`），
  不新增 job；`test/scheduler.test.js` 的默认任务清单断言不变。
- 实时输出轮询是**前端**行为（10 秒），不属于调度器。

## 10. 安全

- 所有日志接口 `requireAdmin()`；日志内**不写** API Key / 密码 / 完整邮箱（沿用现有打码规则）。
- `error` 字段截断 200 字符；`detail` 只放计数与状态码，不放请求头。
- 操作日志是只读页：除「批量操作详情」外不提供任何写操作。

## 11. 验收（可观测）

1. 侧栏不再有「批量操作记录」「运行日志」；新增「日志审计 / 操作日志」；搜索功能仍能搜到「操作日志」。
2. 用户管理页顶部**没有**新建表单，只有列表 + 「＋ 新建用户」；点击右侧滑出抽屉（页面不跳转、列表不刷新）；
   `?section=users&drawer=new` 可直达；关闭后筛选/分页/滚动位置不丢；刷新页面回到列表（不带抽屉）。
3. 新建用户成功 → 抽屉内一次性展示临时密码（可复制）→ 关闭后列表出现新用户。
4. 站点通知页顶部没有发布表单；「＋ 新建通知」开抽屉并带前台预览；发布后列表立即出现；
   「编辑」开同一抽屉且字段已回填，`?section=announcements&drawer=new&id=…` 可直达。
5. 操作日志 **5 个 tab** 均可打开，数据与改版前单页一致（用户删除的行数/内容与旧页相同）；
   `?tab=` 直达与刷新保持；切 tab 不重复请求（第二次走缓存）。
6. Steam 账号页做一次同步/解绑 → 操作日志 · Steam 账号立即出现一条（动作/账号/操作者/结果/耗时），失败也记录并带原因；
   用户被删除后其 Steam 日志仍在（不级联删）。
7. 邮件服务只有 3 个 tab；「查看发送记录」跳到操作日志 · 邮件发送，两个子筛选可用。
8. 系统设置 6 个 tab 与旧 6 个分组一一对应，项数一致；搜索「代理」能定位到「网络与代理」；保存/未保存点/离开确认仍生效。
9. 数据统计·价格变化：底部没有「近 7 天变化」表；悬停任一「变化」**立即**出现该游戏近 7 天线图（7 天最低/当前），
   移开消失；无历史数据给空态；打开页面时网络面板**没有**逐行额外的 series 请求。
10. 图表的 7 天最低值与该游戏详情页价格历史一致（抽 2 个游戏对数）。
11. 旧书签 `?section=bulk-ops`、`?section=sync` 自动落到 `op-logs` 对应 tab，不白屏、不 404。
12. 移动端（≤768）：抽屉全屏、按钮吸底；tab 可横向滚动；表格可横向滑动，无横向溢出。
13. 未保存守卫：新建用户抽屉填一半点遮罩/✕/切菜单 → 弹窗；「保存并离开」能创建成功并关抽屉；「放弃修改」清空表单。
14. 通用：`npm test` 全绿、`npm run frontend:build` 成功、`npm run scan` 无命中；`docs.test.js` 文档链接不破。

## 12. 默认项（所有者未单独回复，先按此执行，要改随时说）

| 编号 | 默认 | 影响 |
|---|---|---|
| Q6 | 用户删除 tab 上限 200 + 日期范围筛选 | 只改前端参数，不动接口上限 |
| Q8 | 本批不做 CSV 导出 | 少一个按钮与一个接口 |
| Q9 | 价格表颜色保持「降价红 / 涨价绿」 | 原型里画成绿降红涨，实现时按现状，不混入无关改动 |

## 13. 实施顺序

1. **纯前端、零后端**：① 用户管理抽屉化 ② 站点通知抽屉化 ③ 邮件服务 tab ④ 系统设置 tab —— 一条改动。
2. **操作日志外壳**：新菜单 + 5 tab + 现有 4 类数据搬移（用户删除/批量/邮件/运行）+ URL 兼容（Steam tab 先空态）。
3. **Steam 日志**：建表 + 埋点 + `GET /api/admin/steam-logs` + tab 接数据 + prune 加保留期。
4. **价格线图**：`/api/admin/reports/price` 去 `daily` 加 `series` + 前端 popover + 删底部表。
5. **（下期，需另立项）账号操作审计**：新表 `admin_audit_logs` + 十几处埋点 + 第 6 个 tab。
