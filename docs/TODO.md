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
