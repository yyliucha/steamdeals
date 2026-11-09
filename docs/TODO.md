# 待办总览（未完成事项清单）

> 最后更新：2026-11-06 15:30（并入 AG 批、部署自检脚本、AD 待部署验收、AB 部署侧待办）。这是**当前所有未完成事项**的总清单，接手会话先看这个，再看
> [REQUIREMENTS-INDEX.md](REQUIREMENTS-INDEX.md)（**需求批次总账**：规格 + 状态 + 是否已有开发描述）、
> [DELIVERY.md](DELIVERY.md)（流程/发版）与 [UI-FIXES.md](UI-FIXES.md)（界面缺陷细节）。
> 完成一项就把标题改成 ~~删除线~~ 并标注完成版本。
> 注：K/M/N/O/P 各出现两次是历史遗留（旧编号被改写后保留了原文），阅读时以后出现的为准。
>
> **状态词（唯一口径）**：`待开发` / `依赖阻塞` / `开发中` / `已实现待发版` / `待质检` / `质检通过` / `质检打回` / `已发布 vX.Y.Z` / `待排查` / `待决策` / `已过时`。
> **每个待办条目必须有一行 `**状态：…**`**——本文件是开发、质检两个 skill 的**唯一事实来源**，靠这一行判断是否可开工、是否已交付。

---

## A. ~~立即待办（v1.4.6 时代）~~ → **已过时，保留供追溯**

| # | 事项 | 现状 | 下一步 | 备注 |
|---|---|---|---|---|
| A1 | **v1.4.6 构建** | 代码已提交推 main（`b561854`），版本号 1.4.6，**tag 未打、构建未触发** | 收到所有者"构建 v1.4.6"指令后：`git tag -a v1.4.6 -m "…" && git push origin v1.4.6`，等 `docker-hub`/`docker-tcr` 双绿 | 硬规则 5：构建必须等人工指令 |
| A2 | **服务器升级到 1.4.6** | 服务器当前 **v1.4.5**（截图确认） | 构建双绿后按 [DELIVERY.md 第 4 节](DELIVERY.md#4-部署到服务器)执行（TCR tag 用 `1.4.6`）；注意 compose 文件名不是 compose.yaml | 部署后控制台「同步与回填」才会变成精简版 |
| A3 | **rename 数据验收** | 名字修复已上线 1.4.5，`rename` 在每次启动 +2h 自动跑一轮（约 50 分钟） | 跑完后执行验收脚本（DELIVERY 第 4 节 / 验证命令），预期 `有中文名` 从 11,420 → 10 万+ | 若数字不涨，抓 `docker logs` 里 `rename.done` 的计数 |

## B. 已提出、尚未实现的功能

### B1. ~~时间字段时区设置化~~（2026-10-30 提出）→ **已实现（v1.4.6）**

**需求**：把"系统时间基准"做成可配置设置（例如东八区），让**记录与展示**的时间都是东八区。

**落地内容（v1.4.6）**：

- 新增设置 `system.timezone`（env `TZ`，默认 `Asia/Shanghai`，见 [settings.js](../src/settings.js)）。
- 数据库会话时区随连接生效（[store/index.js](../src/store/index.js)：连接池 `options: -c timezone=…`
  + `connect` 事件 + `store.setTimezone()` 热更新；PGlite 同步支持；时区白名单校验，非法回落 Asia/Shanghai）。
  保存设置后 `settings-routes.js` / 调度器 revision 重载会调用 `setTimezone`，约 30 秒内新连接生效。
- 日志 `ts` 带偏移 ISO、文件按本地日期分片（[log.js](../src/log.js) 的 `tsInZone`）。
- 前端时间显示统一用站点时区（`/api/me` 下发 `timezone`，`frontend/src/utils/siteTime.js`）。

**遗留提醒**：改时区设置后**旧连接**仍是旧时区，重启服务保证全部生效；heat 的 C1 仍待探测。

## C. 线上问题 / 需要探测

**状态：已发布 v2.2.0（2026-11-09，b01aaf8 修复）；C2 已确认（2026-11-09）。部署后按 C1 行「下一步」验证。**

| # | 事项 | 现状 | 下一步 |
|---|---|---|---|
| C1 | ~~**heat 逐 appid 全 `success:false`**~~ | **已定案（2026-11-09 线上取证）**：不是 Steam 参数问题——`fetchJson` 自 AB 批返回 `{...res, json}`，heat 与 steam-catalog 仍按旧契约解包（`data[appid]`），永远取到 undefined → 全部「无效跳过」。日志铁证：`heat.entry_invalid` 的 shape 是 fetchJson 包装对象、body 里 `success:true`。**修复已提交 main（b01aaf8）：`data.json` 解包 + `test/fetchjson-contract.test.js` 回归锁** | 随下个版本构建部署后验证 `heat.done withHeat>0`；已标记的旧条目 7 天后自动重选 |
| C2 | 服务器 compose 文件名 | **已确认（2026-11-09）：`/home/ubuntu/steamdeals/docker-compose.yml`**（`docker inspect steamdeals --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}'` 取证） | 已写入 DELIVERY §4 |

## D. 文档中挂着、但优先级低或已决定不做

| # | 事项 | 状态 |
|---|---|---|
| D1 | `pg_trgm` 搜索索引 | 未做，需要生产 `EXPLAIN ANALYZE` 数据（当前 `like '%kw%'` 114.87ms，阈值 150ms）；见 [ROADMAP](ROADMAP.md) |
| D2 | 图片缓存总量上限 | 可选未做（当前靠 `IMAGES_LIMIT` 控制每轮数量） |
| D3 | `app_type` 全量回填 | **已决定放弃**（v1.4.3 起 GetItems 的 `type` 枚举已正确写入，新数据会自动带类型） |
| D4 | 侧栏「版本」徽标位置修复 | **已修（v1.4.6）**：徽标移到后台 header 右侧 + 侧栏底部两行布局与收缩约束；见 [UI-FIXES.md 第 1 条](UI-FIXES.md#1-后台侧栏版本检测被挤出侧栏底部v145-实测) |

## E. 流程约束（不要再踩）

- **构建必须等所有者明确指令**（硬规则 5，见 [CONTRIBUTING.md](../CONTRIBUTING.md)）：日常只提交推 `main`，
  **不得自行打 tag / 触发 CI 构建**。
- **服务器操作由部署人员执行**（硬规则 4）：开发侧不碰服务器。
- 新功能必须同步进调度器（硬规则 3），人工命令只作调试手段。
- **部署后先跑一键自检**：[DEPLOY.md](DEPLOY.md) 末尾「发布后自检（一键）」把脚本落到项目目录 `scripts/check-deploy.sh`
  （未跟踪），覆盖容器/镜像版本/调度任务/429 计数/数据概况/API 冒烟；发布内容涉及同步链路时再加 `--write`
  （真实写 3 条 `steam-status`）。

## F. 待实施：Steam 价格同步优化（方案已定，2026-11-02，等排期）

**状态：质检通过（2026-11-09，f32e2b9；QA 报告 docs/QA-STEAM-PRICES-F.md）**（① 限速 1100→1600；② 热点优先 + 冷门降频。方案见下方两条）。

调查结论：目录/回填/改名/热度都已是增量；唯一"全量重拉"的是价格刷新——每天把**有 Steam 报价的
10.6 万款**逐个重拉（约 3500 次请求、1 小时+）。Steam 没有价格差分接口，无法直接"只拉变更"，只能缩小轮询集合。

1. **间隔收紧**（小改，一行）：`cmdSyncSteamPrices` 现在是 `batchSize=30, rateLimitMs=1100`
   ≈ 272 次/5 分钟，**略超 appdetails 的 200 次/5 分钟配额**（目前靠 429 冷却兜底）。
   建议调到 `rateLimitMs=1500~2000`，代价是每天多跑 30–50 分钟。
2. **热点优先 + 冷门降频**（需设计）：按"有在售报价 + 近 90 天有访问/被标记/热度高"优先每天刷，
   其余游戏 3–7 天一轮，减少每日请求量。改选择条件（`cmdSyncSteamPrices` 的 appid 查询）即可，无需动调度器。

> 讨论中其余两条建议不适用：付费商店接口 403/`success:false` 已按 skipped 处理（不写脏数据）；
> 数据库是 PostgreSQL（不是 SQLite），容器以 node 用户运行（非 root），调度在进程内（非 systemd timer）。

## G. ~~待开发：Steam 多账号绑定 + 已拥有/愿望单同步~~ → **已实现并发布（v1.5.0，2026-11-02）**

**状态：已发布 v1.5.0**。规格见 [docs/STEAM-ACCOUNTS.md](STEAM-ACCOUNTS.md)（§14 验收标准 7 条已实现）。

落地内容：

1. `steam_accounts` 加 `user_id`/`alias`（一账号只属一人，每用户上限 5）；`steam_sessions` 停用（表保留不写入）。
2. 前台「已拥有」= 手动 `owned=true` ∪ 所有绑定账号库并集；`owned=false` 永久排除（再同步不恢复，可恢复跟随推导）；
   `owned_by[{steamId,name}]` 徽标（>2 显示 +N，详情列全）；全局 `games.owned` 废弃；游客不可见。
3. `steam_wishlist` 表 + 前台独立「愿望单」标签页；愿望单自动加入价提醒
   （`watchlist.source='steam_wishlist'`，目标价空=史低；手动优先不覆盖；移出/解绑只清理自动项）。
4. 库/愿望单同步一律**差集删除**（`appid <> all(本次集合)`，修掉旧版只增不删的 bug）；
   绑定成功自动同步；调度器每日 `steam-accounts` 任务逐个串行（间隔 ≥1s，单账号失败隔离）。
5. 绑定流程：站点登录 → `/api/auth/steam/start`（state 防 CSRF，5 分钟）→ 回调校验 → 唯一性/上限 409。
6. 后台「Steam 账号」页改账号列表（同步库/愿望单、改别名、解绑、认领）；CLI `steam-claim` +
   调度器认领任务（`STEAM_CLAIM_USERNAME`/`STEAM_CLAIM_STEAM_ID`）供存量 FF 账号迁移。

上线后部署人员无需手工跑任何命令：升级后 `steam-accounts` 每日任务自动同步；认领走后台按钮或调度器配置。

## H. ~~待开发：DLC 统计问题~~ → **已实现并发布（方案 A，v1.8.0，2026-11-03）**

**状态：方案 A 已实现并推 main**（见 [docs/STEAM-DLC.md](STEAM-DLC.md)）。

- 现象：后台「Steam 账号」页 DLC 恒为 0；某行显示 `0*`。
- 根因：`IPlayerService/GetOwnedGames` **只返回游戏、不含 DLC 拥有记录**（Steam 公开 API 无此数据），
  当前 DLC 数依赖 `steam_games` 中出现 `app_type='dlc'` 的行 → 天然 0。`*` = 前端 `type_unknown>0`
  的标记（拥有条目在 CN 商店取不到类型，锁区/下架，`backfillOwnedAppTypes` 也补不上）。
- **方案 A（已实现）**：删除「DLC」列与 `*` 标记，账号列表上方加说明「Steam API 不返回 DLC 拥有数据」；
  同步提示去掉"其中 DLC N 款"；`type_unknown` 只留日志；STEAM-ACCOUNTS/README 已知限制已补。
  不采用方案 B（可购买 DLC 总和，误导）与方案 C（Steam 登录态 cookie，安全代价高）。
- 验收：见 [docs/STEAM-DLC.md](STEAM-DLC.md) §5。

## I. ~~待开发：2026-11-03 需求批次~~ → **已实现并发布（v1.8.0，2026-11-03）**

**状态：代码完成并推 main，等"构建 vX.Y.Z"指令**（见 [docs/UX-BATCH-2026-11-03.md](UX-BATCH-2026-11-03.md)）。

1. **愿望单归属** ✅：`WISHLISTED_BY_SQL`/`SITE_WISHLISTED_SQL`，列表/详情返回 `wishlisted_by`/`site_wishlisted`；
   徽标「愿望单 · 账号名」（>2 显示 +N）；移除弹窗「本站 + 账号」默认全选可取消；
   `DELETE /api/wishlist/*` 接受 `{steamIds, siteWishlist}`（缺省保持旧行为）；`POST` 返回 `alreadyIn`。
2. **审核联动** ✅：`listAbuseReviews`/`countPendingReviews` 排除封禁中 IP（解封自动恢复，只过滤不改状态）。
3. **通知中心** ✅：`announcement_reads` 表 + `readIds` + `POST /api/announcements/read`；
   顶栏铃铛/角标/抽屉，未读弹窗保留；登录用户服务端已读、游客本地（兼容旧 max-id）。
4. **移动端响应式** ✅：断点 1024/768/480 + 「桌面版模式」兜底（`screen.width<=640 && innerWidth>700`）
   加 `mobile-layout` 类：单列卡、筛选抽屉、顶栏精简、详情全屏、触摸 ≥44px；PC 无回归。

**附带（同批次获批）**：调度器轻任务并行——sonkwo/gog/humble/itad/discover/steam-accounts/backup/logs/alerts/images
可在 Steam 重任务运行时并行执行（`SCHEDULER_LIGHT_CONCURRENCY` 默认 3），解决 heat 首轮播种期其它源被饿数小时的问题；
chart 后续任务串行执行。

验收：见文档各节；通用验证 `npm test` + `frontend:build` + `scan`。

## J. ~~待开发：PC 筛选修复 + 移动端独立设计 + 封禁标记~~ → **已实现并发布（v1.9.0，2026-11-03）**

**状态：已发布 v1.9.0**。规格见 [docs/UX-REDESIGN-2026-11-03.md](UX-REDESIGN-2026-11-03.md)，
效果图见 [docs/design/](design/)（pc-home / mobile-home / mobile-filter / mobile-detail，含 HTML 源文件）。

1. **PC 修复（阻断）**：筛选区恢复一行工具栏（搜索 + 4 个 132px 下拉 + 刷新）；`el-drawer` 只在移动端渲染；
   窄断点覆盖规则限定作用域，PC 三档无回归。
2. **移动端独立设计**：设备判定（matchMedia 或 screen.width<=640 && innerWidth>700）后渲染独立结构——
   顶栏 + 搜索行 + chips + 分段 tab + 单列大卡（标题 16px/价格 21px/按钮 ≥44px）+ 底部 4 入口
   （首页/心愿单/已拥有/我的）+ 筛选底部弹层 + 全屏详情 + 加载更多。
3. **封禁标记**：封禁动作（自动 rate/path、手动黑名单、审核封 IP）把该 IP 的 pending 审核标记为 `auto_banned`
   （旧记录永久退出待审，解封不恢复；之后新异常仍会生成新记录）；保留 `NOT_ACTIVE_BAN` 双保险；
   审核列表 `status=all` 可看历史。
4. 已发布部分（v1.8.0）不动：愿望单归属、通知中心、审核过滤（本次改为标记）。

验收：见文档各节；通用验证 `npm test` + `frontend:build` + `scan`。

## K. ~~待开发：移动端真机适配补丁（强制 viewport）~~ → **已过时（被后面的 K 段覆盖）**

> ⚠️ 重复条目：后者「K. 已实现并发布 v1.10.0」才是唯一事实，本条保留供追溯。

**状态：已定位、规格已写、待开发**（见 [docs/MOBILE-VIEWPORT.md](MOBILE-VIEWPORT.md)）。

- 现象：红米 K100 Pro Max 上字体仍小、按钮点不中、部分功能不可用（v1.9.0 已有移动端结构）。
- 根因：浏览器处于「桌面版网站」模式，按 ~980px 布局后缩放；v1.8.0/v1.9.0 只切换了布局，**未改写 viewport**。
- 修复：`index.html` 内联脚本检测 `screen.width<=640 && innerWidth>700` → 改写 meta viewport 为
  `width=390, initial-scale=1`（sessionStorage 防刷新循环）；`zoom = innerWidth/screen.width` 作最后兜底；
  `?debug=1` 显示 innerWidth/screen.width/DPR/isMobile 浮层。
- 自检：文档 §4 的 14 项真机清单（搜索/筛选/排序/加载更多/卡片操作/详情/登录/绑定/通知/我的/底部导航/桌面版模式）。
- 验收：红米真机 14 项全过；PC 无回归；`frontend:build` + `npm test` 通过。

## K. ~~待开发：移动端真机适配（强制 viewport）~~ → **已实现并发布（v1.10.0，2026-11-03）**

**状态：已发布 v1.10.0**。规格见 [docs/MOBILE-VIEWPORT.md](MOBILE-VIEWPORT.md)。

红米 K100 Pro Max 实测「桌面版网站」模式下字体小/按钮点不中：根因是布局视口 ~980px 缩放。
修复：index.html 内联改写 viewport（width=390 + 禁缩放 + sessionStorage 防循环 reload）、
main.js zoom 兜底、text-size-adjust 基线、字号/触摸校准、?debug=1 调试浮层。
真机 14 项自检清单待部署后在红米 K100 Pro Max 上逐项验证（部署由所有者执行）。

## L. ~~待开发：前端渲染修复（抽屉/角标/复选框未注册 + 封禁页跳转）~~ → **已实现并发布（v1.11.0，2026-11-03）**

**状态：问题一已发布 v1.11.0；问题二（封禁页）v1.11.0 的实现实测无效，需改为 index.html 内联跳转；问题三（验证码）已确认由封禁导致，非 bug（体验改进可选，低优先级）**。规格见 [docs/FRONTEND-RENDER-FIX.md](FRONTEND-RENDER-FIX.md)。

- main.js 补注册 ElDrawer/ElBadge/ElCheckbox/ElCheckboxGroup（修复移动筛选/我的/通知抽屉/角标/愿望单勾选，
  推送到 Steam 账号自 v1.6.0 起首次可用）；mount 前读取 __BAN_PAGE__ 跳 /banned（/appeal 除外）。
- 新增 test/frontend-registration.test.js 静态防回归；验收见文档 §1/§2。
- **问题三（§2.5）结论**：手机验证码加载不出来 = 手机 IP 被封禁导致 `/api/captcha` 403，**非独立 bug**；
  封禁页修复后不会再进入登录页。体验改进（失败提示 + 占位重试）列为低优先级可选。



## M. ~~待开发：封禁页跳转最终方案 + 验证码失败提示~~ → **已实现并发布（v1.12.0，2026-11-03）**

**状态：已发布 v1.12.0**。见 [docs/FRONTEND-RENDER-FIX.md](FRONTEND-RENDER-FIX.md) §2/§2.5。

- v1.11.0 的 main.js router.replace 实测无效（ES module 提升），改为 serveBanPage 注入内联脚本
  history.replaceState('/banned')，无头 Edge 实测通过（pathname=/banned、.ban-card 存在、/appeal 放行）。
- loadCaptcha 失败 ElMessage.warning + 可点击重试占位块。

## M. ~~待开发：申诉邮箱回退链缺陷 + 新增「申诉邮箱」设置~~ → **已过时（被后面的 M 段覆盖）**

> ⚠️ 重复条目：后者「M. 已实现并发布 v1.12.1」才是唯一事实。

**状态：已定位，待开发**（见 [docs/APPEAL-EMAIL.md](APPEAL-EMAIL.md)）。

- 现象：SMTP 已配置，但封禁/申诉页提示「站点尚未配置申诉邮箱」。
- 根因：`server.js` 的 `appealEmail()` 用 `??` 链，`hydrateSettings` 把 `ALERT_EMAIL_TO` 写成**空字符串**
  后 `??` 不再回退，导致 `SMTP_FROM`/`SMTP_USER` 有值也用不上。
- 修复：回退链改 `||` 并补 `SMTP_USER`（抽成 `src/appeal.js` 便于单测）；新增设置
  `alerts.appealEmail`（`APPEAL_EMAIL`，「邮件与提醒」分组，留空回退）；测试 51→52 + 新增 appeal 用例。
- 线上立即恢复：compose 加 `APPEAL_EMAIL=yyliucha@163.com` 并重启（发版前唯一可靠方式）。

## N. ~~待开发：邮件配置合并到「邮件服务」页（方案 A 已确认）~~ → **已过时（被后面的 N 段覆盖）**

> ⚠️ 重复条目：后者「N. 已实现并发布 v1.12.1」才是唯一事实。

**状态：方案已确认（A，2026-11-03），待开发**（见 [docs/MAIL-CONFIG-PAGE.md](MAIL-CONFIG-PAGE.md)）。

- 现状：SMTP/邮件字段在「系统设置 → 降价提醒」，测试发送与记录在「邮件服务」页，配置分散。
- 方案：邮件服务页 = 状态卡 + 邮件配置表单（8 个字段）+ 发送测试 + 发送记录；
  系统设置只留 通知开关/间隔/Webhook/企业微信（分组改名「通知与提醒」）。
- 实现：`utils/settings.js` 的 `MAIL_SETTING_KEYS` + 新增 `MailSettingsForm.vue`（加载/渲染/保存，
  secret 留空保持原值、清空传 null）；AdminModules 的 `fieldsByGroup` 过滤邮件 key。后端零改动。
- 依赖：先做 M（申诉邮箱设置项 + 回退链修复）；验收见文档 §5。

## N. ~~待开发：申诉邮箱回退链缺陷~~ → **已实现并发布（v1.12.1，2026-11-03）**

**状态：已发布 v1.12.1**。规格见 [docs/APPEAL-EMAIL.md](APPEAL-EMAIL.md)。

- 根因：appealEmail() 用 ?? 链，水合空串截断回退 → SMTP_FROM/SMTP_USER 有值也取不到。
- 修复：新增 src/appeal.js appealEmailFrom（|| 链 + trim，四级回退）；server.js 改用；
  设置新增「申诉邮箱」（alerts.appealEmail，string，留空回退）；测试 52 项 + test/appeal.test.js。

## O. ~~待开发：邮件配置合并到邮件服务页（方案 A）~~ → **已实现并发布（v1.12.1，2026-11-03）**

**状态：已发布 v1.12.1**。规格见 [docs/MAIL-CONFIG-PAGE.md](MAIL-CONFIG-PAGE.md)。

- utils/settings.js（MAIL_SETTING_KEYS/isMailSettingKey）+ MailSettingsForm.vue（8 个邮件字段，
  加载 /api/admin/settings、保存 POST 只提交邮件 key、secret 留空保持/勾选清空传 null、emit saved）。
- 邮件服务页插入「邮件配置」卡；说明改「配置保存在此页，保存后立即生效」。
- 系统设置过滤邮件 key；alerts 分组改「通知与提醒」；保存不再提交邮件 key。

## O. ~~待开发：申诉系统改造——服务端受理 + 后台申诉管理~~ → **已过时（被后面的 O 段覆盖）**

> ⚠️ 重复条目：后者「O. 已实现并发布 v1.12.1」才是唯一事实。

**状态：需求与方案已确认（2026-11-03），待开发**（见 [docs/APPEAL-SYSTEM.md](APPEAL-SYSTEM.md)）。

- 现状：申诉页用 `mailto:` 依赖用户本地邮件客户端；邮件只能人工处理；封禁页邮箱是页面快照（旧页面会发到旧地址）。
- 目标：`POST /api/appeal` 入库（编号/IP/设备/原因/联系邮箱/说明）+ 通知管理员邮件；
  后台「访问与安全 → 申诉管理」列表 + 详情 + 处理（解封 IP/设备/两者/拒绝+理由/仅备注）；
  处理结果回邮件通知申请人；联系邮箱必填；每 IP 每小时 3 条 + 图形验证码。
- 关键点：`/api/appeal` 要在封禁拦截里放行；邮件 `From` 用 SMTP 账号、`Reply-To` 用申请人邮箱；
  SMTP 未配置不影响入库；处理动作联动现有解封逻辑（ip_blacklist / ip_abuse / device_bans）。
- 依赖：先修封禁页跳转（FRONTEND-RENDER-FIX §2）。验收见文档 §8。

## P. ~~待开发：后台功能对齐（设备 tab + 合并重复游戏 + 同步历史 + 回填进度）~~ → **已过时（被后面的 P 段覆盖）**

> ⚠️ 重复条目：后者「P. 已实现并发布 v1.13.0」才是唯一事实。

**状态：已排查，待开发**（见 [docs/ADMIN-PARITY.md](ADMIN-PARITY.md)）。排查方法：后端 40 个 admin 路由 vs 前端调用 36 个做差集 + 旧 `web/console.html` 逐项对照。

1. **设备指纹 + 设备封禁**（用户已确认方案 B）：访问记录下新增第 4 个 tab「设备」——
   最近设备（`GET /api/admin/devices`）+ 封禁（`POST /api/admin/devices/ban`）+
   已封设备列表（`GET /api/admin/device-bans`）+ 解封（`DELETE /api/admin/device-bans/:fingerprint`）。
2. **合并重复游戏**：游戏目录工具栏「高级」→ 弹窗调 `POST /api/admin/games/merge`（源 AppID → 目标 AppID）。
3. **同步运行历史**：运行日志页加「同步记录」表（`GET /api/admin/sync/runs`，时间/模式/状态/条数/耗时/备注）。
4. **回填实时进度**（可选）：任务运行中轮询 `GET /api/admin/backfill/status` 显示百分比。
   另：`heat/status`、`rename/status` 新旧前端都没用，属冗余接口。

验收与改动点见文档 §2/§3；后端接口均已存在（除 2.4 可能需补字段）。

## P. ~~待开发：后台功能对齐（ADMIN-PARITY）~~ → **已实现并发布（v1.13.0，2026-11-03）**

**状态：已发布 v1.13.0**。规格见 [docs/ADMIN-PARITY.md](ADMIN-PARITY.md)。

- 设备 tab（最近设备/时长封禁/已封设备/解封）；游戏目录「高级」合并重复游戏；
  运行日志页「同步记录」表（后端 listSyncRuns 附带 fetch_runs 汇总）；任务实时进度轮询。

## Q. ~~待开发：后台列表批量操作（多选 + 批量执行）~~ → **已实现并发布（v1.14.0，2026-11-03）**

**状态：已发布 v1.14.0**（tag 已推送，`docker-hub` / `docker-tcr` 构建见 CI）。规格见 [ADMIN-BULK-ACTIONS.md](ADMIN-BULK-ACTIONS.md)。

- 现状（开发前）：后台 15 个列表 **0 个多选、0 个批量接口**，处置只能逐行点。
- 已实现（A+B 共 11 个）：待审列表、访问明细、回收站、站点通知、IP 黑名单、IP 白名单、已封设备、自动封禁记录
  （A）；游戏目录、最近设备、用户列表（只禁用/启用）（B）。
- 方案：统一 `POST /api/admin/bulk`（白名单派发表 + 单次上限 + 高危 `confirmCount` + 逐条回执）；
  审计表 `admin_bulk_ops` +「系统 → 批量操作记录」页；常规列表本页勾选，回收站支持「全选筛选结果」（≤1000）。
- 不做：Steam 账号同步/认领、投放任务、只读列表、用户批量重置密码。
- 验证：`test/admin-bulk.test.js` 12 项（真 PGlite + 真 HTTP）已接入主链；`npm test` / `frontend:build` / `scan` 全绿。
- 实现偏差与落点见规格 §11。

## R. ~~待开发：封禁页守卫（未封禁访问 `/banned` 回首页）~~ → **已实现并发布（v1.14.1，2026-11-03）**

**状态：已发布 v1.14.1**（tag 已推送，CI 见 DELIVERY）。规格见 [BAN-PAGE-GUARD.md](BAN-PAGE-GUARD.md)。

- 现状（开发前）：`/banned` 无条件返回 403 封禁页（`src/server.js:522-527`），没被封的人也会看到「解封时间：暂未设定」的假页面。
- 根因：真正的封禁请求已被设备封禁 / 频率封禁 / IP 黑名单三道闸提前拦下，**到达该分支 ⇔ 未被封禁**。
- 方案：该分支改为 **302 → `/`**（`cache-control: no-store`，日志 `ban.redirect_home`），不在页面路由里二次判定
  （避免第二份口径、误伤管理员与白名单）；前端 `BanPage.vue` 加 `__BAN_PAGE__` 缺失守卫兜底。
- 决策：三类封禁都算（IP 黑名单 / 设备 / 频率）；管理员也跳首页；过期封禁视为未封禁；不做"解封自动跳回"。
- 验证：`node test/reviews.test.js` 19 项全绿（302 / IP 403 / 设备 403 换 IP / 频率 429+Retry-After / 管理员 bypass / 过期 302 /
  日志与前端守卫）；版本号与 CHANGELOG 等收到「构建」指令后一起改。


## S. ~~待开发：封禁与安全修复批次（封禁页入口收敛 + 黑白名单互斥 + 待审口径）~~ → **已实现并发布（v1.14.2，2026-11-04）**

**状态：已发布 v1.14.2**（tag 已推送，CI 见 DELIVERY）。规格见 [BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md)。

- **问题一（手机端打开封禁/申诉页不跳首页）**：**真因已定案（2026-11-04）**——所有者手机实际打开的是
  `https://sd.yyliucha.cn/appeal?code=…`，即 **`/appeal` 申诉页，不是 `/banned`**。`/appeal` 被 `src/server.js:341`
  的 `appealPage` **故意豁免**所有封禁判定（369/378/409 三处都 `!appealPage`），且 v1.14.1 的 302 只覆盖 `/banned`
  （528 行），因此**未封禁的人打开 `/appeal` 永远不跳首页**——与所有者"当前没有这个功能"的描述完全一致。
  之前三轮排查（v1.14.0 假页面 `ban.page_direct`、HTTP 黑名单 403、nginx `access_log off`）均为干扰项，已各自排除。
  **修复（已按 2026-11-04 追加要求泛化）**：不做逐页补丁，改为「仅封禁可见页面」统一治理——
  `BAN_ONLY_PAGES` 注册表（`/banned`、`/banned/`、`/banned.html`、`/appeal`、`/appeal/`，以后新增同类页面登记即生效）
  + 服务端统一只读判定（复用已算好的 `deviceBan`/`hit` + `ratelimit.bannedUntil`，禁用 `hit()` 防三振副作用）：
  未封禁一律 302 `/`，被封禁者正常看到该页。
  **解封后不得继续显示**：新增只读接口 `/api/ban/state`（豁免拦截链与频率计数，自带 1 次/秒限流）
  + 前端共享 `useBanOnlyPage` composable（挂载即查 + 每 30 秒 + 切回标签页复查），解封后自动回首页。
  详见规格 §3.1–3.6。顺带发现该 URL 的 `email=` 为空 → 线上 `APPEAL_EMAIL` 可能未配置（配置问题，单独确认）。
- **问题二（黑白名单并存）**：`addBlockedIp` / `addWhitelistIp` 互不清理，运行期白名单胜出（黑名单形同虚设，删白后复活）。
  方案：双向互斥 helper（覆盖单条/批量/审核封 IP 共 4 处）+ 存量清理迁移（白名单优先）+ CIDR 只提示不自动删。
- **问题三（待审筛选为空）**：① 状态标签只有 `auto_banned`/其他两分支，`approved`/`rejected` 全显示成「待审」；
  ② `NOT_ACTIVE_BAN` 二次过滤把封禁中的 pending 行隐藏（计数同样），与 v1.9.0 的 `auto_banned` 机制重复。
  方案（口径 A）：去掉 `NOT_ACTIVE_BAN`，待审=全部 pending，状态列补全 4 种标签，计数与列表一致。

## T. ~~待开发：URL 参数隐私化（敏感页面不再把信息放进 URL）~~ → **已实现并发布（v1.14.2，2026-11-04）**

**状态：已发布 v1.14.2**（tag 已推送，CI 见 DELIVERY）。规格见 [URL-PARAM-PRIVACY.md](URL-PARAM-PRIVACY.md)。

- 起因：所有者要求"所有 URL 跳转不要有明文、前后端加密"。核对后纠正三个前提：① 传输层已是 HTTPS + HSTS
  （`src/server.js:2784`）；② 加密 URL 防不住爬虫，真实泄漏面是分享/历史/Referer/收录/日志/缓存；
  ③ 前端不能持对称密钥（等于公开）。**结论：不加密，直接把敏感信息移出 URL（方案 A）**。
- 范围：全站盘点 9 处 URL 参数，敏感的只有 `BanPage.vue:17` 的 `/appeal?code&reason&until&email`。
  只治理敏感页面，不做全站 URL 加密。
- 方案：URL 只留 `?code=AP-XXXXXX`；站点名/申诉邮箱由服务端注入 `window.__APPEAL__`（封禁用户调不了 `/api/site`）；
  申诉页不再展示原因/解除时间（封禁页仍展示，管理员按编号查 `ban.page` 日志）；旧链接忽略多余参数并 `replaceState` 清洗。
- 配套加固 5 项：申诉编号改 `crypto.randomBytes`（现在是 `Math.random()`）、`X-Robots-Tag: noindex` + `robots.txt`、
  `/appeal` 加 `no-store`、日志不落 query（现状已满足）、未来"按 code 查上下文"接口必须限流。
- 与 [S 批次](BAN-AND-SECURITY-FIXES.md) 的 `/appeal` 守卫是同一处服务端改动，建议合并实施。

## U. ~~待开发：Steam 同步状态 + 锁国区 + 内容分级标注~~ → **已实现并发布（v1.15.0，2026-11-04）**

**状态：已发布 v1.15.0**（tag 已推送，CI 见 DELIVERY）。规格见 [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md)。

- **起因**：后台「游戏目录」显示 92,580 条待同步。实测（2026-11-04 生产库只读 + 20 条 cc=cn/hk 探针）：
  从未回填仅 242 条（0.26%），**免费游戏 23,185（25%）**，缺 Steam 报价 92,152（99.5%），缺简介 11,878；
  探针结果 14 条未发售 / 6 条锁国区（港区有价或免费）/ **0 条"国区其实有价"** → **不是回填漏数据**。
- **结论**：「待同步」把「免费 / 未发售 / 锁区 / 真失败」混成一个数字，永远不会归零，必须重定义。
- **方案**：`games` 加 `steam_status/steam_checked_at/required_age/content_descriptors/age_ratings/adult_flag/mature_flag`；
  状态机六态；锁区用 `cc=cn` 的 `success:false` + `cc=hk` 复核确认；分级字段本来就在同一次 appdetails 响应里
  （`steam-meta.js:179` 无 filters），只是 `normalizeOfficial` 没解析——**一次请求同时拿状态和分级**。
- **新任务**：`steam-status`（并入 `jobsFromEnv`），待探测约 6.9 万次 + 锁区复核约 2.1 万次 ≈ **37 小时**，可中断续跑；
  免费 2.3 万不消耗请求（`is_free` 已在库，一次 SQL 置位）。
- **展示策略（2026-11-04 已拍板）**：成人内容（descriptors 3/4 或 ESRB AO）**前台不显示、后台正常显示**，
  做成配置 `site.adultDisplay` = `hide`(默认)/`badge`/`show`（部分国家成人内容合法，不硬编码）；成熟内容加角标；
  锁国区**不隐藏**，只标「国区不可售」且不出国区价格；未发售标「尚未发售」。
  **代码只做平台标签→站点策略映射，不做法律定性**。
- **决策已全部确认（2026-11-04）**：成人内容前台隐藏（配置可切 `badge`/`show`）、18+ 以 descriptors 3/4 + ESRB AO
  为主口径、锁国区不隐藏只标注。规格 §11 已改为「已确认的决策」，无遗留待确认项。

## V. ~~待开发：后台内容分级筛选（单独查看 18+）+ backfill 合并写分级~~ → **已实现并发布（v1.15.1，2026-11-04）**

**状态：已发布 v1.15.1**（tag 已推送，CI 见 DELIVERY）。规格见 [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md) §13/§14.3。

- 现状：v1.15.0 已有「分级」列（成人红标 / 成熟黄标 / 其余「—」），但**没有任何筛选入口**，
  指标卡也没有成人/成熟计数——想单独看 18+ 只能翻页找。
- 方案：`GET /api/admin/games` 加 `rating=adult|mature|none`；`adminGameStats` 加 `adult`/`mature` 计数；
  筛选栏加「内容分级」下拉（全部 / 成人(18+) / 成熟 / 未标注）；指标卡加「成人 N」「成熟 N」（点击筛选）。
- 顺手修：筛选下拉的「全部同步状态」仍是旧口径（待同步/已同步），改为与六态指标卡一一对应。
- 验收：筛选条数与卡片一致；成人+成熟+未标注 = 未删除总数；可与其它筛选叠加；前台行为不变。
- 前置提醒：目前 `steam-status` 才跑到 121 条，筛出来会很少，属采集进度问题而非筛选 bug。
- **与定时任务的关系（2026-11-04 追加，规格 §14）**：筛选是查询条件、不需要任务；采集已是 `steam-status` 定时任务。
  可合并项只有一个——`backfill` 本来就逐条拉全量 appdetails，接上 `classifyContentRating` 即可零成本写分级
  （省约 6.9 万次请求）；`steam-prices`/`heat` 的接口形态拿不到分级，不能合并。
  **成本更正**：实际候选是所有非免费游戏 **175,184** 条，单轮约 **73–80 小时**（不是原估的 37 小时），
  建议 `STEAM_STATUS_LIMIT` 调成每日 8000（约 3.3 小时）分三周补完，避免单轮挂 3 天抢配额。
- **第二部分（2026-11-04 追加，已纳入本批）**：抽 `src/steam-status.js` 的共用函数，让 `backfill` 在拉 appdetails 时
  顺手写状态与分级——**能确定状态才写 `steam_checked_at`**，分级字段「有值才写、不覆盖」；
  `steam-status` 改调同一函数保证口径一致。效果：约 6.9 万条不必重复请求，全量时间减半。详见规格 §14.3/§14.3.1。

## W. 手机端 PWA（像 App 一样打开）

**状态：已实现并发布 v1.16.0（2026-11-05）**（见 [MOBILE-PWA.md](MOBILE-PWA.md)）；Android 真机「添加到主屏幕 / 更新提示 / 离线不误报」验收待服务器部署后执行。

- **目标**：手机上"添加到主屏幕"后全屏运行，像 App；**不上架、不打 APK、不引入 Android 工具链**。
- **做**：`manifest.webmanifest`（standalone + 192/512 图标 + theme-color）、`index.html` 引用、
  统一网络失败提示（断网提示、不缓存）、Android 返回键关闭浮层（`history.pushState` + `popstate`）。
- **版本检查（半自动更新）**：启动与切回前台时比对 `/api/site` 的 `version`（`server.js:657`），不一致时顶部提示
  「已更新到 vX.Y.Z，点击刷新」，**默认不自动刷新**（详情弹窗/表单会丢状态）；离线时静默跳过。
  部署侧需确认 nginx 未对 HTML 加 `expires`/`proxy_cache`（否则重新打开也是旧版）。
- **不做**：service worker / 离线缓存（会重演"看到旧页面"）、推送、离线包。
- **购物车方案已否决（决策存档）**：站内待买清单意义不足（所有者判断，最终还是跳 Steam 自己买）；
  Steam 自动加购技术上不可行（购物车无 Web API，需网页登录态 = 账号密码 + Steam Guard，越出项目
  "不绕过登录与签名校验"的边界，README:474）。**手机端与 PC 一致**：点进详情 → 跳转 Steam 商店 → 用户自己买。
- **验收**：见规格 §7（standalone 生效、manifest 字段齐全、断网提示、返回键行为、PC 零变化）。

## X. 调度器长任务阻塞修复（重任务 await 饿死全部任务）

**状态：已实现并发布 v1.16.1（2026-11-05）**（见 [SCHEDULER-BLOCKING-FIX.md](SCHEDULER-BLOCKING-FIX.md)）。

- **现象**：所有者反馈"两天没同步"。生产诊断（2026-11-05）：容器只跑了 1.4 小时（两次发版重启），
  `steam-prices --limit 200000` 已运行 **91 分钟**；`scheduler-status.json` 的 `updatedAt` 停在启动时刻，
  **所有任务 `lastRunAt: null`**；日志只有一条 `scheduler.job_start`。
- **根因**：`src/scheduler.js:536-538` 重任务 `await runJob(job)`，子进程不退出就阻塞整个 tick 循环
  （`runJob` 只在 exit 时 resolve）→ `sonkwo`(60min)/`gog`/`alerts`/`steam-status` 全部饿死。
  v1.8.0 的"轻任务并行"只对同一 tick 内已发射的任务有效。
- **修复**：P0 重任务改"非阻塞发射 + 全局单槽"（保留串行语义、不阻塞 tick）；`steam-status` 加进 `STEAM_HEAVY`；
  P1 `lastRunMs` 启动时从 `sync_runs` 恢复（避免每次发版重置计时）、`steam-status` 首轮延迟降到 10 分钟、
  周期改每天、上限 12000（约 2 周补完 17.5 万）；P2 状态文件每 tick 刷新（可观测）。
- **验收**：长任务运行期间轻任务照常跑；同一时刻只一个重任务；重启后 nextRunAt 不全部重置；status 文件每 15 秒更新。
- **交接单**：[HANDOVER-X-SCHEDULER.md](HANDOVER-X-SCHEDULER.md)（含改动点、行号、风险与验收命令）。
- **已确认**：`steam-status` 每天 12000 条；`steam-prices` 本批不动（缩量另行优化）。

## Y. ~~待开发：补 `steamStatus.initialDelaySec` 设置项~~ → **已并入 AB 批，已发布 v1.16.4**

**状态：已发布 v1.16.4（随 AB 批）**（见 [STEAM-STATUS-FIX.md](STEAM-STATUS-FIX.md) §3-F）。

- **背景**：X 批（v1.16.1）把 `steam-status` 首轮延迟默认值从 21600s 改成 600s，但**只改代码默认、没加设置项**。
  其他任务都有（`sources.steam/sonkwo/itad/gog/humble/discover.initialDelaySec`），`steam-status` 漏了 →
  线上无法在「系统设置 → 数据源」调整，只能改 compose 环境变量并重启。
- **补充事实**：`cmdSteamStatus` 不写 `sync_runs`，所以 X 批的 `lastRunMs` 恢复对它不生效——
  每次重启仍按 `initialDelaySec` 重新计时（默认 600s，可接受）。
- **改动**：
  - `src/settings.js`：在 `steamStatus.rateMs/limit/intervalMin` 之后加一行
    `def('steamStatus.initialDelaySec', 'STEAM_STATUS_INITIAL_DELAY_SEC', 'sources', 'Steam 状态判定首轮延迟（秒）', 'int', 600, { min: 0, max: 86400, advanced: true })`
  - `test/settings.test.js`：断言该 def 存在、默认 600、DB 值能水合到 `process.env.STEAM_STATUS_INITIAL_DELAY_SEC`
  - `test/scheduler.test.js`：断言 `jobsFromEnv` 读取该环境变量作为 `initialDelaySec`
  - 文档：`docs/DELIVERY.md` 数据任务/环境变量表补一行；前端无需改（设置页按 schema 渲染）
- **验收**：设置页出现「Steam 状态判定首轮延迟（秒）」；保存后热加载生效；默认 600；`npm test` 全绿；不自行打 tag。

## Z. 手机端适配修复（vw 逃逸 + 安装提示 + 后台卡片化）

**状态：已实现并发布 v1.16.2（2026-11-06）**（见 [MOBILE-FIX.md](MOBILE-FIX.md)）；红米 + 小米浏览器真机验收待部署后执行。

- **真机证据**（红米 K100 Pro Max + 小米自带浏览器）：`?debug=1` 显示 `innerWidth 980 / screen.width 400 /
  DPR 3 / isMobile true / desktopMode true`，UA 为桌面 `X11; Linux x86_64` —— 浏览器忽略 viewport meta，按 980 排版。
- **根因**：`main.js:38-47` 用 `zoom=innerWidth/screen.width=2.45` 把 CSS 视口压回 400（列表页因此正常），
  但 **`vw` 不受 zoom 影响**：`Home.vue` 的 `.mobile-full{width:100vw}` 仍是 980 → 详情弹窗右侧被裁。
  另有一条死规则 `html.mobile-layout`（class 从未添加）。
- **安装提示缺失**：全仓无 `beforeinstallprompt`；小米浏览器只会建普通书签，打开仍是浏览器外观。
- **后台表格未卡片化**：`AdminModules.vue:101` 的 `isMobile` 是死变量，`main.css` 无 el-table 响应式；
  README:129 却写"已卡片式"（文档与实现不符，需同步修正）。
- **方案**：A 去掉移动端 `vw/vh`（改 `%`/`dvh`）+ 图片 max-width；B 桌面模式顶部提示（保留 zoom）；
  C 新增 `useInstallPrompt` + 顶部「安装到桌面」+ 不支持时给 Chrome 说明；D 后台游戏目录/访问记录卡片化、
  其余表格加横向滚动提示；E 视觉微调（触摸 ≥44px）。
- **验收**：真机详情页不再横向溢出、安装按钮可用、后台卡片化不横向滚动、PC 零回归、`npm test` 全绿。

## AA. 待开发：添加愿望单推送 Steam 失败（根因已定案，方案 A 已确认）

**状态：根因定案（2026-11-09 线上日志：`HTTP 401 → api.steampowered.com`）；方案 A「诚实提示 + 明确不可用」已由所有者确认（2026-11-09），待开发**。
开发描述见 [WISHLIST-OAUTH.md](WISHLIST-OAUTH.md) §3/§4（只改前端文案 + 文档同步；不投入 OAuth 改造、不动凭据模型）。
§4 六项产品缺陷修复批已随 **v2.2.0 发布**（2026-11-09，5b59bfa；QA 报告 docs/QA-WISHLIST-AA.md）。
本条目剩余：方案 A「诚实提示」的文案改动待开发（见上）。

- **现象（2026-11-06 13:38 已补全）**：多选弹窗勾选 Steam 账号后提交 → 游戏进了本站「愿望单」，但**没有归属到该 Steam 账号**；
  前端提示「已加入本站愿望单；76561198268202591 推送失败」；后台确认该账号**已配置 API Key**。
  即：本站 `user_wishlist` 写入成功，`pushWishlistItem()` 失败。
  **已出审计文档**：[WISHLIST-FIX.md](WISHLIST-FIX.md)——链路、4 条候选根因、6 项无论根因都要修的产品缺陷。
  日志一到即可定性并出开发描述。
- **待补信息（下次排查先问）**：
  1. 操作路径：首页卡片「愿望单」按钮 / 详情页 / 「心愿单」页？
  2. 界面表现：有无错误提示？文案是什么？
  3. 时间点与所用账号（是否管理员、是否已绑定 Steam 账号）；
  4. 该 Steam 账号是否已配置自己的 **API Key**（推送依赖它）。
- **已知代码落点（排查用）**：
  - 前端入口：`frontend/src/pages/Home.vue`（愿望单按钮与多账号选择弹窗 `wishlistPick`）；
  - 接口：`src/server.js:1311` 起的 `/api/wishlist`（POST 加入、DELETE 移除）；
  - 推送 Steam：`src/steam-accounts.js` 的 `pushWishlistItem`（`IWishlistService/AddToWishlist`，
    未文档化接口，需要该账号自配 API Key；失败只记日志、每日同步对账兜底）；
  - 存储：`user_wishlist` 表（`src/steam-login.js:63`），并联动 `watchlist` 自动到价提醒。
- **排查步骤（下次执行）**：
  1. 只读跑 `docker exec steamdeals node /app/src/cli.js logs --event wishlist --since 360 --limit 30`，
     取 `adapter.steam.wishlist_add_failed` 的 `status` / `snippet`；
  2. 看接口返回码（400 参数 / 403 权限 / 409 重复 / 500 内部错误）；
  3. 确认账号是否配置 API Key、Steam OpenID 是否仍有效；
  4. 区分「站内入库失败」与「入库成功但推 Steam 失败」——两者用户感知相似但根因不同；
  5. **三种日志形态的定性**（详见 [WISHLIST-FIX.md](WISHLIST-FIX.md) §3）：`401/403` → 鉴权（Key 不被接受/无效）；
     `200` + `success:false` → Steam 拒绝；**只有 `steam.wishlist_manual_add`、没有 `add_failed`** → 失败发生在调用 Steam
     之前（解密失败 / 未配 Key），这条路径当前没有独立日志。

## AB. ~~待开发：Steam 状态判定整轮静默不写库（JSON 取错）~~ → **已发布 v1.16.4（2026-11-06）**

**状态：已发布 v1.16.4（2026-11-06），生产验证通过。** 规格见 [STEAM-STATUS-FIX.md](STEAM-STATUS-FIX.md)。

- **生产验证（2026-11-06 15:18，服务器 1.16.4）**：手动跑 `steam-status --limit 5 --rate 3000` →
  `steam-status.done { wrote: 5, skipped: 0, failed: 0, requests: 5, ok: 5 }`；
  库内复查 `steam_checked_at > now() - interval '10 minutes'` → `[ { st: 'ok', n: 5 } ]`，
  证明写入真实落库，不再"跑满不写"。
- **未验证项**：调度器整轮（`--limit 6000`）尚未开始——被 `steam-prices` 单槽占用（见 AC4/AC5）。
- **部署侧待办（2026-11-06）**：`steamStatus.limit` 的库内值若仍是 **12000**，要在「系统设置 → 数据源」改成 **6000**
  （代码默认已改，但 DB 值会覆盖默认，见 [STEAM-STATUS-FIX.md](STEAM-STATUS-FIX.md) §3-G/§7-1）；
  改完用「发布后自检」脚本第 6 项看「近24h判定」是否接近 6000。

- **现象**：`steam-status` 12:39 启动、请求持续 200 成功，但「近 24h 判定 = 0」、`max(steam_checked_at)=11-04`，
  抽查 appid 全是 null，且**没有一条 `steam-status.failed`**——请求成功但一条都没写库。
- **真因（P0）**：`src/cli.js:2179`/`:2189` 把 `fetchJson` 返回对象当成 payload 取：
  `const cnEntry = cn?.[String(appid)]`（应 `cn?.json?.[...]`），`hkEntry` 同错 → 两个 entry 恒为 `undefined`
  → `applySteamDetails` 判定 `status=null` → 直接 return 不写库；而 `done += 1` 照加，整轮"跑满"但 0 行写入。
- **P0 附带**：每行最多 2 个请求但只 sleep 一次 → 约 300–400 次/5 分钟，超 Steam 200 次/5 分钟配额；
  撞 429 后 `http.js:55` 冷却 **30 分钟**，单轮被拖成"卡死"；`cli.js:2205` 的 429 分支 `break` 只跳内层循环。
- **P1**：`cli.js:2196` 逐条 `withStore`（每条新建连接池）；`setSteamStatus` 未命中返回 null 但无人校验（静默 no-op）。
- **方案**：A 修 `.json` 取值；B 写入不可静默（`wroteStatus` 决定 done、`write_miss` 日志、未知状态单列）；
  C 限速按每请求计 + 429 结束整轮 + `limit` 12000→6000（约 5 小时/轮）；D 连接提到循环外；E 每轮写 `sync_runs`。
- **同链路审计追加（规格 §2.5）**：① `outcome` 是死变量，`wroteStatus` 被丢弃；② 非 429 的 4xx 走 `continue`
  跳过 `sleep` → 无间隔连发；③ `done/counts` 不看是否真写库 → 汇总"判定几百条"但库里 0 行；
  ④ 收尾只判 `done===0 && failed>0`，全 skipped 会静默通过；⑤ `descriptorIds` 为空数组时会覆盖已有分级
  （`coalesce` 挡不住 `[]`）；⑥ 国区失败时每行都补 hk，是超配额的直接原因；
  ⑦ **写入路径从未真正执行过**，`content_descriptors` 参数未显式 `::int[]`，修好后首次写入可能暴露类型问题，
  必须在 `--limit 20` 验收时确认。- **验收**：`--limit 20` 后抽查 appid 的 `steam_status`/`steam_checked_at` 都有值；`done` 与真实写入一致；
  撞 429 立即收轮；指标卡下降量 = done；`npm test` 全绿。

## AC. 待办：同步不可达的未保证项（A1–A11 汇总）

**依赖：** AC6、AC8 原本依赖 AB——**AB 已随 v1.16.4 发布（2026-11-06），依赖已解除**，
可以基于 1.16.4 起的 `steam-status` 日志与数据做验证；其余 AC1–AC5、AC7、AC9–AC11 本就不依赖。

**状态：AC-1 已发布 v1.18.0（2026-11-06）；AC-2/AC-3/AC-4 已发布 v2.1.0（2026-11-09）——AC 四批全部完成**。总表与证据见 [SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md)；
当前"完全没同步"的直接原因是 AB 批（[STEAM-STATUS-FIX.md](STEAM-STATUS-FIX.md)），以下是不依赖 AB 的独立缺口：

- **AC1** 启动校验"该有但没有"的任务（缺 `STEAM_API_KEY` / 被 `*_ENABLED=0` 关掉），后台显式提示，不要静默消失。
  **2026-11-06 实测**：1.16.4 启动日志 `jobs=["catalog",…,"steam-accounts",…]` 含这两项 → 本部署 `STEAM_API_KEY` 已配置，AC1 针对的是其它/未来部署。
- **AC2** 熔断/代理失败/429 在后台可见，并支持手动重置熔断（现在熔断 3 次=6 小时、内存态、重启清零、无人知晓）。
- **AC3** `heat`/`rename` 也写 `sync_runs`（或落盘 lastRun）（**`steam-status` 已随 AB 批写入 `sync_runs`**），避免每次发版重启都重置节奏。
- **AC4** 每日 Steam 配额预算：`steam-prices`(~90min)+`heat`+`backfill`+`steam-status`(目标 5h) 串行总时长必须 <24h，超了自动降频并告警。
- **AC5** 后台显示"重任务被占用"的时长与占用者。**2026-11-06 实测：重任务之间互相等待时完全无日志**——scheduler.job_deferred_busy 只在**手动 sync** 占用时打印（scheduler.js:590），`steam-prices` 占槽导致 `steam-status` 排队时没有任何输出，"没跑"只能靠算时间。建议加 `scheduler.job_wait_slot`。
- **AC6** 429 改为全局退避预算（本轮跳过并记录），不要每个子进程各睡 30 分钟。
- **AC7** 解析增加结构校验（关键字段缺失记 `shape_mismatch`），字段改名不要静默变 null。
- **AC8** 明确"状态 ok"与"有报价"的关系：`steam-status` 判 ok 时顺带写 offer，或 `backfill` 优先这些游戏；
  并复核「已同步」口径（现在是 ok+有简介，不要求有价格）。
- **AC9** 新游戏优先入回填队列（按 created_at/catalog 时间排序），现在按 id 顺序排队，新游戏可能等数周。
- **AC10** 所有数据任务统一写 `sync_runs`，后台「同步记录」可见每轮结果。
- **AC11** 后台加「任务健康」面板：上次运行/耗时/结果/失败原因/下次时间/是否在跑。

> **已确认（2026-11-06）**：5 个问题已答，AC 从「待决策」转「待开发」，按下列 4 批推进（**一次只做一批**：
> 做完一批把该批状态改成 `已实现待发版`、调质检，再开下一批；**AC-1 先做**）：
>
> | 批次 | 包含 | 状态 | 对应链路 |
> |---|---|---|---|
> | **AC-1 观测批** | AC1、AC3、AC5、AC10、AC11 | **已发布 v1.18.0（2026-11-06）** | ① 后台状态一直「未探测」 |
> | **AC-2 价格批** | AC8（已确认：判 ok 时顺带写 offer + 复核「已同步」口径） | **已发布 v2.1.0（2026-11-09）** | ② 列表里没价格 |
> | **AC-3 吞吐批** | AC9（已确认：新游戏优先 + 提高 backfill 上限）、AC4 | **已发布 v2.1.0（2026-11-09）** | ③ 新游戏收录太慢 |
> | **AC-4 可靠性批** | AC2、AC6、AC7 | **已发布 v2.1.0（2026-11-09）** | 剩余项（未单独决策，按原描述做） |
>
> 第 ④ 条链路（账号库 / 愿望单不更新）不在 AC1–AC11：愿望单推送见本文件的 **AA** 条目（等一条日志），
> 账号库同步若还有问题再单独立项。

### 基于 v1.16.4 日志可验证的条目（2026-11-06 起）

| 条目 | 需要的证据（都是只读） |
|---|---|
| **AC8** | `steam-status.done` 里的 `wrote / skipped / failed`；`steam_status='ok'` 的数量与「有报价」的差值 |
| **AC6** | 是否仍出现 `http.rate_limit_pause delayMs=1800000` 或「命中 Steam 429」 |
| **AC3** | `sync_runs` 里有没有 `steam-status` 行；重启后 `nextRunAt` 是否接着算而不是重新等 600s |
| **AC4** | 各任务 `scheduler.job_done` 的 `elapsedMs`：`steam-prices` / `heat` / `backfill` / `steam-status` 四者之和 |
| **AC1** | `scheduler.start` 的 `jobs=[…]` 里是否包含 `catalog`、`steam-accounts`（缺就是没配 `STEAM_API_KEY`） |
| **AC2** | 是否出现 `circuit_skip`，或同一任务连续 `job_failed` |

## AD. ~~待开发：搜索支持中英文（含平台中文别名）~~ → **已发布 v1.17.0（2026-11-06）**

**状态：已发布 v1.17.0（2026-11-06）**。规格见 [SEARCH-I18N.md](SEARCH-I18N.md)。

- **待部署验收（2026-11-06 15:31 实测）**：`https://sd.yyliucha.cn/api/site` 仍返回 `"version":"1.16.4"` → v1.17.0
  **已发布未部署**；升级后按规格验收：搜「英雄连」命中 CoH3、英文仍命中、带/不带空格结果一致、后台搜索同样生效。

- **现象**：前台用中文搜不到（如搜「英雄连」找不到 `Company of Heroes 3`），英文可搜到；卡片标题本身显示英文。
- **根因**：① `pg.js:1030-1033` / `server.js:1501-1502` 的搜索只匹配 `games.name` 与 `name_en`，
  **不匹配 `game_aliases.platform_title`**（杉果等平台的中文标题）；② `upsertGameMeta` 只有在 Steam 返回中文名时才
  把 `name` 换成中文，欧美游戏没有官方中文名时就一直是英文；③ `cmdRename` 的候选条件要求 `name_en` 为空，
  一旦 `name_en` 被填就**永远不再补中文名**。
- **方案**：A 搜索加 `game_aliases` 子查询；B 关键词与字段做空格/全角归一化；C（可选）人工中文别名字段；
  D（可选）命中来源参与排序。不做拼音搜索。
- **验收**：搜「英雄连」命中 CoH3、搜英文仍命中、带空格与不带空格结果一致、后台搜索同样生效、耗时不超过 2 倍。
- **已确认（2026-11-06）**：放开 `rename` 给不含中文名的游戏补中文名；搜索必须命中平台别名；不做人工别名字段、不做拼音搜索。

## AE. ~~待开发：版本检测按服务器 IP 选择镜像仓库（TCR / Docker Hub）~~ → **已发布 v1.18.0（2026-11-06）**

**状态：已发布 v1.18.0（2026-11-06）**
**依赖：** 无
**解锁：** 无
**规格**：[VERSION-SOURCE.md](VERSION-SOURCE.md)
**实测（2026-11-06，规格 §6.1）**：TCR 匿名列 tag 需先取 token（首次 401 是标准 challenge，可签发）；
两个仓库的 tag 都是 `X.Y.Z`、**无 `v` 前缀**；Docker Hub 在大陆超时；`ip-api.com` 不可用（HTTPS 403 / HTTP 超时）。

- **现状**：`src/version.js` 只查 `api.github.com`（release → tags，缓存 6h）。大陆服务器经常超时/限流，
  徽标停在旧版本；且徽标说"有新版"时，用户实际拉镜像的仓库（TCR / Docker Hub）可能还没同步。
- **目标**：按服务器网络位置自动选源，**不做设置项**、代码硬编码：
  大陆/香港 → 优先 TCR；其他 → 优先 Docker Hub；首选失败回退另一个；两者都失败回退 GitHub。
- **方案**：`detectRegion()`（IP 归属，缓存 24h）→ `checkRegistryLatest()`（Hub 走匿名 token；TCR 先取匿名
  token 再列 tags/list，过滤 `^\d+\.\d+\.\d+$` 取最大——两个仓库都没有 `v` 前缀）→ 顺序选择；结果带 `source`/`region`，前端本批不改。
- **已确认（2026-11-06）**：允许调用第三方 IP 归属接口——**用 `ipinfo.io`**（`ip-api.com` 实测不可用：HTTPS 403、HTTP 超时）；
  降级策略不变（2s 超时 + 24h 缓存 + 失败转双探）。
- **风险（实测已消解）**：TCR 首次 401 只是标准 Bearer challenge，匿名 token 可签发；按 token 流程实现即可，
  不能按"401 即回退 Hub"（大陆到 Hub 不通，见规格 §6.1）。
- **验收**：CN→TCR、US→Hub、TCR 401→取 token 后成功（不直接回退）、双失败→GitHub、geo 超时不阻塞、无 v 前缀的 tag 能解析、缓存生效、`npm test` 全绿。

## AF. ~~待开发：愿望单/标记操作后列表不刷新（搜索缓存未失效）~~ → **已发布 v1.18.0（2026-11-06）**

**状态：已发布 v1.18.0（2026-11-06）**（根因已确认）
**依赖：** 无
**解锁：** 无
**规格**：[FRONTEND-STALE-LIST.md](FRONTEND-STALE-LIST.md)

- **现象**：加/移除愿望单后卡片仍是操作前状态，需手动刷新；**只在有搜索词时复现**。
- **根因**：`Home.vue:211` `loadGames()` 有 30 秒搜索结果缓存（`cacheKey` 仅当 `q` 非空建立），
  而 `addWishlist`(:257)、`confirmWishlistRemove`(:256)、`setGameFlag`(:247) 写完都直接 `await loadGames(page.value)`，
  **没有任何一处让缓存失效** → 命中旧缓存，列表不更新。缓存 key 也没有数据版本维度。
- **方案**：新增 `invalidateSearchCache()`（`searchCache.clear()`）或 `refreshAfterMutation()`，
  在每个写操作成功后、`loadGames` 之前调用；覆盖愿望单加/删、感兴趣/不感兴趣/已拥有、取消提醒。
- **验收**：搜索态下加/删愿望单卡片立刻变化；无搜索词行为不变；**缓存能力保留**（无写操作时二次搜索仍走缓存）；
  `npm test` + `frontend:build`。

## AG. ~~待开发：后台平台链接抽屉 + 游戏名点击复制（后台与前台）~~ → **已发布 v1.18.0（2026-11-06）**

**状态：已发布 v1.18.0（2026-11-06）**
**依赖：** 无
**解锁：** 无
**规格**：[ADMIN-PLATFORM-LINKS.md](ADMIN-PLATFORM-LINKS.md)

- **需求（设计向）**：不是把链接塞进单元格，而是加一个**入口列**（显示 `N 个`），点击开**抽屉**列出该游戏
  所有平台链接（可逐条打开）；同时后台游戏名**点击复制**，前台也要能复制游戏名。
- **方案**：
  - 新增 `GET /api/admin/games/:id/links`（仅管理员，`buy_url ~ '^https?://'` 过滤脏数据）；
  - 列表接口只加 `link_count`，链接按需加载，避免列表变重；
  - 前端 `AdminModules.vue`：链接列 + el-drawer（手机全屏）+ 名称/AppID 复制按钮；
  - 新增 `frontend/src/utils/clipboard.js`（clipboard API + `execCommand` 降级，HTTP 环境也能用）；
  - `Home.vue` 卡片标题、详情标题加复制图标（`@click.stop`，不触发打开详情）。
- **默认**：抽屉而不是独立页；前台点图标复制（点标题仍打开详情）；ITAD 不算购买渠道；抽屉显示价格与最后更新时间。
- **验收**：数量与抽屉内容一致、同平台多区服都显示、`javascript:` 不渲染、后台复制不触发其他动作、
  前台复制不打开详情、手机抽屉全屏、`npm test` + `frontend:build` + `scan`。

## AH. 已发布 v2.0.0：用户彻底删除（硬删除 + 最近删除审计）

**状态：已发布 v2.0.0（2026-11-06，8f53365；QA 报告 docs/QA-USER-DELETE-AH.md）**
**依赖：** 无
**解锁：** 无（AJ 还要等 AI）
**规格**：[USER-LIFECYCLE.md](USER-LIFECYCLE.md) §3.2 / §4.1 / §4.5 / §5.1 / §8 验收 1–4、14

- **需求**：用户管理加「彻底删除」——弹窗列出将删除的会话 / Steam 账号 / 愿望单与标记，**必须输入用户名**才能确认；
  删除后列表**立刻刷新**、被删用户立即掉线；下方「最近删除」只读审计表，支持按用户名搜索。
- **方案**：`DELETE /api/admin/users/:username`（`confirmUsername` 必填）+ 守卫（不能删自己 / 不能删到 0 个可用管理员 / 不存在 404）；
  事务里先清 `steam_games`/`steam_wishlist`（**那两张表没有外键**）再删 `users`（其余级联）；
  落 `admin_user_deletions`（打码邮箱、关联计数、操作者、原因）；原因只进审计、**不进邮件**。
- **验收**：见规格 §8 的 1–4 与 14。

## AI. 已发布 v2.0.0：邮件模板化 + HTML 邮件 + 发送记录

**状态：已发布 v2.0.0（2026-11-06，4570d81；QA 报告 docs/QA-USER-LIFECYCLE-AI.md）**
**依赖：** 无
**解锁：** AJ
**规格**：[USER-LIFECYCLE.md](USER-LIFECYCLE.md) §3.1 / §3.3 / §4.3 / §4.4 / §5.2 / §8 验收 8–10、15

- **需求**：邮件内容太简陋——改成 **HTML 邮件**（保留纯文本兜底），并在「邮件服务」页做模板定制：
  9 个事件（8 类账号通知 + 验证码），可启停、预览、发测试、恢复默认、套用 3 套示例版式（简洁/卡片/正式）。
- **方案**：`buildMessage` 支持 `multipart/alternative`；新增 `mail_templates`（默认值写在代码里）与 `mail_log`（通知类发送记录）；
  `GET/PUT /api/admin/mail/templates` + preview/reset/test；「最近发送记录」拆「验证码 / 通知」两个 tab；
  主题过滤 CR/LF、HTML 变量转义。
- **验收**：见规格 §8 的 8–10 与 15。

## AJ. 已发布 v2.0.0：账号变更通知（7 类操作 / 8 类邮件）

**状态：已发布 v2.0.0（2026-11-06，dfdad47；QA 报告 docs/QA-USER-NOTIFY-AJ.md）**
**依赖：** AI、AH
**解锁：** 无
**规格**：[USER-LIFECYCLE.md](USER-LIFECYCLE.md) §4.2 / §6 / §8 验收 5–7、11

- **需求**：禁用 / 启用 / 删除 / 改名 / 改邮箱 / 改角色 / 重置密码都要给用户发邮件；正文**不含**密码、token、API Key、IP、完整邮箱；
  操作者统一写「站点管理员」；**改邮箱发两封**（旧邮箱安全提醒 + 新邮箱绑定成功，新旧相同只发一封）；
  **批量禁用/启用不发**。
- **方案**：新增 `src/account-notify.js`（模板渲染 + 串行队列 + 8 秒超时 + 写 `mail_log`），接到 5 个入口；
  删除走异步（响应 `notify:'queued'`），PATCH/重置同步（结果进响应）；未绑定邮箱跳过并提示。
- **验收**：见规格 §8 的 5–7 与 11。

## AK. 待开发：密码系统重设计（AK-1 策略与哈希 / AK-2 登录防护 / AK-3 账号流程）

**状态：AK-1/AK-2/AK-3 已发布 v2.1.0（2026-11-09）**
**依赖：** 无（子批依赖见下表）
**解锁：** AL
**规格**：[AUTH-REDESIGN.md](AUTH-REDESIGN.md)

| 批次 | 内容 | 状态 |
|---|---|---|
| **AK-1** 密码策略 + 哈希升级 | 12 位 + 弱口令黑名单（六个入口统一）、scrypt 2^15 + 版本化格式 + 登录静默 rehash、`weak_password` 三态、`POST /api/password/check` | **已发布 v2.1.0（2026-11-09）** |
| **AK-2** 登录防护 + 后台标识 | 5 次失败锁 15 分钟、IP 20 次/15 分钟限速、验证码常开、管理员解锁、列表「已锁定 / 弱密码 / 需改密」tag | **已发布 v2.1.0（2026-11-09）** |
| **AK-3** 账号流程 | 随机临时密码 + 首次登录强制改密、自助注册（邮箱验证码 / 唯一性 / 开关 / SMTP 未配置 503）、修改密码（踢其它会话）、重置不再顺带启用账号 | **已发布 v2.1.0（2026-11-09）** |

- **现状**：密码只校验 8–200 位（`12345678` 能过）；scrypt 默认参数且格式无版本；登录无失败锁定与 IP 限速；没有自助注册与改密入口。
- **验收**：见规格 §8 的 1–9 与 11。

## AL. 待开发：登录 / 注册 / 改密页面

**状态：已发布 v2.1.0（2026-11-09，77c02e5）**
**依赖：** AK-3
**解锁：** 无
**规格**：[AUTH-REDESIGN.md](AUTH-REDESIGN.md) §5 / §8 验收 10

- **需求**：登录从首页弹窗改成**独立 `/login`**（桌面左右分栏、移动单列），新增 `/register`、`/change-password`；
  密码可见切换、Caps Lock 提示、错误就地显示、记住我 7/30 天、登录回跳只允许站内路径。
- **验收**：见规格 §8 的 10。

## AM. Steam 代理池（多代理按序自动切换 + 健康状态）

**状态：AM-1 已发布 v2.0.0（2026-11-06）；AM-2 已发布 v2.1.0（2026-11-09，b7c49df）**
**依赖：** 无（子批依赖见下表）
**解锁：** 无
**规格**：[PROXY-POOL.md](PROXY-POOL.md)

| 批次 | 内容 | 状态 |
|---|---|---|
| **AM-1** 代理池后端 | `network.steamProxy` 支持多行多条（≤10）、新增 `src/proxy-pool.js`（顺序/粘住/冷却/落盘）、`http.js` 把选代理挪进重试循环、`GET /api/admin/proxies`、日志与测试 | **已发布 v2.0.0（2026-11-06，4e6b0a0）** |
| **AM-2** 设置页 | 「网络与代理」列表编辑器（增删 / 上移 / 下移 / 清空）+ 每条健康状态表 | **已发布 v2.1.0（2026-11-09）** |

- **测试要求（防假绿）**：必须断言「第 2 次尝试用的代理 ≠ 第 1 次」，并做反例自检（临时永远用第一条，测试要变红）；
  只断言"最终请求成功"不算——旧实现（`route` 在循环外）也满足成功。

- **需求**：Steam 专用代理可配多条，第一条失败自动切下一条；失败的那条冷却（60s / 5min / 30min），成功者粘住；
  全部失败直接报错（**不回退直连**）；HTTP 5xx 与 429 **不切换**（429 按出口 IP 限流，切代理等于绕配额）。
- **现状**：`route` 在重试循环外算一次（`http.js:186`），代理挂了两条重试也还是撞同一台；配置是单个 secret 字符串。
- **验收**：见规格 §7。

## AN. 已发布 v2.1.0：未保存修改的离开提醒

**状态：已发布 v2.1.0（2026-11-09，ac9cbf4）；回归修复已发布 v2.2.0（2026-11-09，f10d683：「放弃修改」只放行一次不清草稿 → 弹窗反复出现，已修 + 2 项回归测试）**
**依赖：** 无
**解锁：** 无
**规格**：[UNSAVED-GUARD.md](UNSAVED-GUARD.md)（回归修复见 §7）

- **需求**：编辑过（系统设置 / 邮件配置 / 站点通知 / 编辑游戏 / 新建用户）之后切菜单或离开页面，弹窗提示：
  「还有没保存的修改」→「…还有修改没保存，离开后会丢失。要先保存吗？」按钮 **保存并离开 / 放弃修改 / 留在本页**。
- **方案**：新增 `useUnsavedGuard.js` + 全局 `UnsavedLeaveDialog.vue`（挂 App.vue）；五个面注册 `{label, isDirty, save}`；
  拦截点是 `Console.select()` 与 `router.beforeEach`；**刷新/关闭不拦**，401/退出登录不拦。
- **验收**：见规格 §6。

## AO. 后台游戏列与平台链接抽屉改版

**状态：质检通过（2026-11-09，af70754；QA 报告 docs/QA-ADMIN-LINKS-DRAWER-AO.md）**
**依赖：** 无
**解锁：** 无
**规格**：[ADMIN-LINKS-DRAWER.md](ADMIN-LINKS-DRAWER.md)

- **问题（2026-11-09 截图）**：① 游戏名 + 复制图标换行到第二行；② 英文名被省略号截断且不能复制；
  ③ 链接抽屉挤成一行（`¥99.992026/11/08 20:15:09` 价格与时间粘连），太简陋。
- **方案**：游戏列改 flex（名称单行省略、复制图标固定行尾、英文名 title 悬停看全名）；
  **一次复制 = 中英文两行**；**点游戏名打开抽屉**（复制只点图标，`@click.stop`）；
  抽屉重做：封面 + 中英文名 + AppID + 复制；每条渠道一张卡（平台 / 区服 / 现价 / 划线原价 / 折扣 / 库存 / 更新时间 / 打开）
  + 空态 Steam 兜底；移动端全屏。**纯前端，不改接口**。
- **验收**：见规格 §8。

## AP. 游戏详情·价格历史报表（史低高亮）

**状态：质检通过（2026-11-09，282d018；QA 报告 docs/QA-PRICE-HISTORY-AP.md）**
**依赖：** 无
**解锁：** 无
**规格**：[PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md)

- **问题（2026-11-09 截图）**：价格历史是一串 `日期 + 价格` 的网格 chip，看不出趋势；史低（11-07/11-08 都是 ¥65.34）
  和 ¥198 的 chip 长得一模一样，没有任何突出。
- **方案**：改成**报表视图**——指标条（区间最低 / 区间最高 / 当前较史低 / 记录天数）+ 手写 SVG 趋势线（史低点标绿）
  + 表格（日期 / 当日最低 / 较前一日 / 标记），史低行整行高亮 + 徽标；范围「近 30 天 / 近 90 天 / 全部」；
  移动端卡片列表。**纯前端，不改接口**（`detail.series` 已是全量每日最低）。
- **验收**：见规格 §6。

## AQ. 已发布 v2.2.0：后台访问/异常列表排序（数值 IP + 上限 500）

**状态：已发布 v2.2.0（2026-11-09，8a20304）**
**依赖：** 无
**解锁：** AR
**规格**：[ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §3

- **需求**：异常审核（截图这个列表）与访问明细都支持点表头排序：最近出现 / **IP（数值顺序）** / 次数 / 规则；
  默认「最近出现 ↓」，排序状态存 localStorage；异常审核拉取上限 300 → **500**。
- **方案**：异常审核 ≤500 条**客户端排序**（新增 `compareIp()`：IPv4 转整数、IPv6 排后）；
  访问明细**服务端排序**（`/api/admin/visitors` 加 `sort/order` 白名单，IP 用零填充键排序，**不用 `ip::inet` 强转**避免脏数据报错）。
- **验收**：见规格 §3.4。

## AR. 已发布 v2.2.0：异常审核「按 IP 合并」视图（下一期）

**状态：已发布 v2.2.0（2026-11-09，0aa6842）**
**依赖：** AQ
**解锁：** 无
**规格**：[ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §4

- **需求**：待审列表加「按 IP 合并」开关（默认关）：同一 IP 的多个规则合成一行（规则摘要 / 总次数 / 首末时间 / **设备数** / 状态），
  展开看每条规则；处置（封 IP / 封设备 / 忽略）作用于该 IP **全部待审记录**，弹窗写明条数。
- **方案**：前端按 `ip` 聚合（≤500 行，不改后端），处置复用 `POST /api/admin/bulk` 的 `reviews/approve-ip|approve-device|reject`；
  状态混合显示「部分已处理」；排序复用 AQ 的 `compareIp()`。
- **验收**：见规格 §4.4。

## AS. 待开发：README 开发进度摘要（自动生成）

**状态：待开发（2026-11-09）**
**依赖：** 无
**解锁：** 无
**规格**：[TODO-PROGRESS.md](TODO-PROGRESS.md)

- **需求**：README 现有「路线图」是手写的，已经与事实不一致（锁国区仍标未完成、Docker 镜像仍写「未构建」、
  多区服对比同页一处 ✅ 一处 🚧）；所有者希望打开 GitHub 首页就能看待办进度，又不想再维护第二份清单。
- **决策**：README 自动进度块；`docs/TODO.md` 仍是唯一来源；范围 = 进行中 + 接下来 + 最近 5 个完成；
  脚本 + CI `--check` 防漂移；本期不上 GitHub Issues / Projects。
- **方案**：新增 `scripts/todo-progress.js` 解析 TODO 的 `**状态：…**` 行，生成 README 标记块（`--check` 校验）；
  替换旧「路线图」段、修正 README 过期项；加轻量 `docs-progress` workflow。**纯脚本 + 文档 + CI，不改业务代码**。
- **验收**：见规格 §10。















