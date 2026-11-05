# 待办总览（未完成事项清单）

> 最后更新：2026-10-30。这是**当前所有未完成事项**的总清单，接手会话先看这个，再看
> [DELIVERY.md](DELIVERY.md)（流程/发版）与 [UI-FIXES.md](UI-FIXES.md)（界面缺陷细节）。
> 完成一项就把标题改成 ~~删除线~~ 并标注完成版本。

---

## A. 立即待办（阻塞在"等指令 / 等部署"）

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

| # | 事项 | 现状 | 下一步 |
|---|---|---|---|
| C1 | **heat 逐 appid 全 `success:false`** | 线上 heat 请求返回全 `success:false`（日志"无效跳过 30"），疑似 `l=schinese` 与 `l=zh` 的差异或 `filters=recommendations,release_date` 被拒 | 在服务器跑一条最小探测：`docker exec steamdeals node --input-type=module -e '…fetchText appdetails…'`，对比不同 `l` 参数与 filters 组合的响应；确认后改 `heat` 的 URL 参数 |
| C2 | 服务器 compose 文件名 | 实际文件名不是 `compose.yaml`（历史 sed 报不存在） | `cd /home/ubuntu/steamdeals && ls compose*.*` 确认后写入本文 |

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

## F. 待实施：Steam 价格同步优化（方案已定，2026-11-02，等排期）

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

## K. 待开发：移动端真机适配补丁（强制 viewport）

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

## M. 待开发：申诉邮箱回退链缺陷 + 新增「申诉邮箱」设置

**状态：已定位，待开发**（见 [docs/APPEAL-EMAIL.md](APPEAL-EMAIL.md)）。

- 现象：SMTP 已配置，但封禁/申诉页提示「站点尚未配置申诉邮箱」。
- 根因：`server.js` 的 `appealEmail()` 用 `??` 链，`hydrateSettings` 把 `ALERT_EMAIL_TO` 写成**空字符串**
  后 `??` 不再回退，导致 `SMTP_FROM`/`SMTP_USER` 有值也用不上。
- 修复：回退链改 `||` 并补 `SMTP_USER`（抽成 `src/appeal.js` 便于单测）；新增设置
  `alerts.appealEmail`（`APPEAL_EMAIL`，「邮件与提醒」分组，留空回退）；测试 51→52 + 新增 appeal 用例。
- 线上立即恢复：compose 加 `APPEAL_EMAIL=yyliucha@163.com` 并重启（发版前唯一可靠方式）。

## N. 待开发：邮件配置合并到「邮件服务」页（方案 A 已确认）

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

## O. 待开发：申诉系统改造——服务端受理 + 后台申诉管理

**状态：需求与方案已确认（2026-11-03），待开发**（见 [docs/APPEAL-SYSTEM.md](APPEAL-SYSTEM.md)）。

- 现状：申诉页用 `mailto:` 依赖用户本地邮件客户端；邮件只能人工处理；封禁页邮箱是页面快照（旧页面会发到旧地址）。
- 目标：`POST /api/appeal` 入库（编号/IP/设备/原因/联系邮箱/说明）+ 通知管理员邮件；
  后台「访问与安全 → 申诉管理」列表 + 详情 + 处理（解封 IP/设备/两者/拒绝+理由/仅备注）；
  处理结果回邮件通知申请人；联系邮箱必填；每 IP 每小时 3 条 + 图形验证码。
- 关键点：`/api/appeal` 要在封禁拦截里放行；邮件 `From` 用 SMTP 账号、`Reply-To` 用申请人邮箱；
  SMTP 未配置不影响入库；处理动作联动现有解封逻辑（ip_blacklist / ip_abuse / device_bans）。
- 依赖：先修封禁页跳转（FRONTEND-RENDER-FIX §2）。验收见文档 §8。

## P. 待开发：后台功能对齐（设备 tab + 合并重复游戏 + 同步历史 + 回填进度）

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
