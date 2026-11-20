# 待办总览（未完成事项清单）

> 最后更新：2026-11-19（已完成需求移入 [DONE.md](DONE.md)，本清单只保留未完成条目）。
> 接手会话先看本清单，再看 [REQUIREMENTS-INDEX.md](REQUIREMENTS-INDEX.md)（**需求批次总账**：全部批次的规格 + 状态 + 是否已有开发描述）、
> [DONE.md](DONE.md)（**已完成/已过时条目存档**）、[DELIVERY.md](DELIVERY.md)（流程/发版）与 [UI-FIXES.md](UI-FIXES.md)（界面缺陷细节）。
> **清单分工（2026-11-18 所有者新规）**：本清单**只放待办**；条目变为 `已发布 vX.Y.Z` 或 `已过时` 后**整段移入 [DONE.md](DONE.md)**
> （发布时由 `steamdeals-build` 会话移动；判定过时由需求会话移动），不再留在本清单。

> **【需求封板 · 2026-11-18 所有者（2026-11-18 晚口径修订）】**：**只接本清单（TODO）已立项的条目**——包括封板前已沟通、已建条目的新功能类（CW/CX/CY/CZ/DA/DC/DF 等）；**TODO 之外的新需求一律只记录、不排期、不建开发会话**，等所有者解封（规则见 [HANDOVER.md](HANDOVER.md) §11）。
> **状态词（唯一口径；本清单只出现未完成态）**：`待开发` / `依赖阻塞` / `开发中` / `已实现待发版` / `待质检` / `质检通过` / `质检打回` / `待排查` / `待决策`。
> `已发布 vX.Y.Z` 与 `已过时` 在发布/判定后移入 [DONE.md](DONE.md)，不在本清单出现。
> **每个待办条目必须有一行 `**状态：…**`**——本文件是开发、质检两个 skill 的**唯一事实来源（待办侧）**，靠这一行判断是否可开工、是否已交付。
> **README 进度**：排期与状态以本清单 + [DONE.md](DONE.md) 为准；README 只放一条指向本页的链接，**不再生成摘要**。

> **类型分类（2026-11-19 所有者确认）**：每个条目必须有一行 `**类型：** <emoji 类型>`：
> 🐞 缺陷（Bug）/ ✨ 功能（Feature）/ ⚙️ 调整（Refine，现有功能口径·交互·布局·文案）/ 🧹 技术债（重构·拆分·性能）/
> 🧪 测试基建（测试·CI·e2e·脚本）/ 📝 文档流程 / 🔬 调研（评估分析，无代码产出）。汇总表随增删维护。

## 类型汇总（2026-11-20）

| 类型 | 数量 | 编号 |
|---|---|---|
| 🐞 缺陷 | 3 | DU / EF / EG |
| ✨ 功能 | 1 | DT-2 |
| ⚙️ 调整 | 6 | DT-1 / DT-3 / DT-4 / DT-5 / DV / EC |
| 🧹 技术债 | 1 | DX |
| 🧪 测试基建 | 1 | ED |
| 📝 文档流程 | 0 | — |
| 🔬 调研 | 0 | — |
| 已过时 | 1 | DM |

---

## DM. 已过时（2026-11-19 所有者要求彻底解决，并入 DL）：对齐审核批量操作超时短期补丁

**状态：已过时（2026-11-19 所有者指示「彻底解决不要短期」——全部并入 [DL](ALIGN-SNAPSHOT.md)，本条目不再派发）**
**类型：** 🐞 缺陷（已过时）
**优先级：** P1 —— 批量确认/忽略「有几率超时」，影响审核效率
**依赖：** 无（DL 是长期根治；DM 为短期补丁、可独立先行）
**解锁：** 无
**规格**：本条目 + [ALIGN-QUERY-PERF.md](ALIGN-QUERY-PERF.md)（CN 缓存/单飞）+ [ALIGN-DB-SLOW.md](ALIGN-DB-SLOW.md)（CS 后台生成）

- **现象（2026-11-19 线上 v2.25.0）**：对齐审核批量确认/忽略「有几率」报超时错误。
- **根因（代码证据）**：① `server.js:5143/5187` 批量 confirm/ignore 入口每次 `buildAlignGroups()`
  → `align-query.js:71-84` 冷缓存时**同步等待全量计算**（~20 万 games + 候选索引，线上 20s+）；
  ② `server.js:5161/5175` 每次确认/忽略后 `alignRunner.invalidate()` **清空整个缓存** → 下一次操作必然冷算；
  ③ B1 批统一 15s 请求看门狗（`server.js:477` `requestTimeoutMs=15000`、`:827-847` 503 +
  `http.request_timeout`），豁免名单（`:134`）不含 align POST → **同步全算超过 15s 被 503 打断**。
- **修复（短期补丁）**：① 操作接口不再同步全量重算——优先用上一轮完整结果（`staleCache`，DE 批已保留）
  匹配组；仅完全无缓存（部署后首次）才同步算一次；② 操作后**不再 `invalidate()` 全量**：从缓存中
  增量移除已处理组并更新 counts（或标记 stale + 后台重算，读走旧结果）；③ 若仍可能长，接口返回
  明确「后台处理中」而非 503；④ 补测试：确认后 10 分钟内再做批量操作不触发全量计算；
  慢计算模拟下批量接口不被看门狗打断。不做：DL 的快照落库本体（另一条）。
- **验收**：① 确认一组后立刻批量确认 200 组 → 无全量重算、响应 <1s；② 冷缓存首次批量操作
  返回明确状态而非 503 超时；③ 现有 align 测试全绿 + 反向自检（去掉 staleCache 路径必须红）；
  ④ `npm test`（分段）+ `scan` 全绿。

## DU. 🐞 缺陷：个人资料「个人简介」placeholder 插值未绑定（显示 {{ }} 源码）

**类型：** 🐞 缺陷（Bug）
**状态：** 待开发（2026-11-19 所有者截图发现）
**优先级：** P3 —— 纯显示文案，不影响功能
**依赖：** 无
**解锁：** 无
**规格**：本交接（1 行修复，无独立规格）

- **现象（2026-11-19）**：个人资料页「个人简介」文本框显示
  `介绍一下自己（{{ isAdmin ? '可选' : '1–200 字' }}）` 源码。
- **根因**：`frontend/src/pages/ProfilePage.vue:56` 用静态属性 `placeholder="..."`（缺 `:` 动态绑定），
  Vue 不会在静态属性值里插值 `{{ }}`。
- **修复**：改为 `:placeholder="`介绍一下自己（${isAdmin ? '可选' : '1–200 字'}）`"`；
  全项目扫描仅此一处（grep `="[^"]*\{\{` 无其它命中）。
- **验收**：admin 显示「介绍一下自己（可选）」、普通用户显示「介绍一下自己（1–200 字）」；
  `npm test`（分段）+ `npm run frontend:build` + `npm run scan` 全绿。

## DV. 待开发（⚙️ 调整）：游戏管理「ITAD」筛选改为来源筛选

**类型：** ⚙️ 调整（筛选语义修正）
**状态：** 待开发（2026-11-19 排查确认：ITAD 是来源不是平台，平台筛选永远 0 条）
**优先级：** P2 —— 后台筛选可用性
**依赖：** 无
**解锁：** 无
**规格**：[ITAD-SOURCE-FILTER.md](ITAD-SOURCE-FILTER.md)

- **根因**：ITAD 报价归具体商店平台（steam/gog/humble/fanatical/itad_*），**从不写 platform_code='itad'**；
  后台「平台」筛选对 ITAD 用 `offers.platform_code='itad'` → 永远 0 条。ITAD 真实覆盖在
  `game_source_sync(platform_code='itad', status='matched')`。
- **修复（方案 A）**：`platform=itad` 改走来源判定
  `exists (select 1 from game_source_sync gs where gs.game_id=g.id and gs.platform_code='itad' and gs.status='matched')`；
  前端下拉 `itad` 标签改「ITAD（来源）」并视觉区分；其余平台筛选不变；不动采集链路。
- **验收**：见规格 §3（ITAD（来源）筛出有匹配标记的游戏；其它平台不变；采集新匹配后刷新可见；标签区分清楚；
  `npm test`（分段）+ `frontend:build` + `scan` 全绿）。

## DX. 待开发（🧹 技术债）：列表/站点接口性能优化

**类型：** 🧹 技术债（性能）
**状态：** 待开发（2026-11-19 实测基线：列表 582ms/搜索 389–478ms/`/api/site` 257ms）
**优先级：** P1 —— 首屏与搜索体验
**依赖：** DW（同 `gameSearch` 区域，先修后优化）
**解锁：** 无
**规格**：[SEARCH-FIX-PERF.md](SEARCH-FIX-PERF.md) §DX

- **目标**：列表/搜索 P95 ≤150ms（基线 340–580ms）；`/api/site` ≤50ms（基线 257ms）；total 正确性不变。
- **方案**：① count 与 rows 合并（`count(*) over()` 或 index-only count）；② 列表 30–60s 短 TTL 内存缓存
  （key=筛选参数+region+userId 摘要；同步完成/后台操作后失效）；③ `/api/site` 60s 缓存；④ 新增
  `test/search-perf.test.js` 断言 P95 + 线上只读压测记录进 DELIVERY。
- **验收**：见规格 §DX（P95 达标；total 与 count(*) 一致；缓存失效正确；`npm test`（分段）+ `scan` 全绿；
  压测结果贴交付说明）。

## DT. 待开发：后台用户管理与权限隔离（拆 5 个子需求，一次会话一个）

**状态：待开发（2026-11-19 所有者 93–97 轮沟通确认；拆 DT-1~DT-5）**
**类型：** ⚙️ 调整（DT-2 含 ✨ 功能）
**依赖：** 无（各子需求依赖见子表；CO-4 B4 可并行，文件面不重叠）
**解锁：** 无
**规格**：[ADMIN-PERMISSIONS.md](ADMIN-PERMISSIONS.md)
**Demo**：[design/admin-users-2026-11-19.html](design/admin-users-2026-11-19.html)（用户管理/编辑/重置密码/全局顶栏）+
[design/admin-menu-permissions-2026-11-19.html](design/admin-menu-permissions-2026-11-19.html)（两套菜单/前台登录入口），同名 .png 已出。

| 子需求 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| **DT-1** | 菜单与路由权限隔离（admin 全量 / 普通用户 5 页；删「Steam 账号」菜单；路由守卫） | 无 | 待开发 |
| **DT-2** | 用户级数据接口（`/api/me/sessions`+踢自己、`/api/me/wishlist`）+ 5 页切用户级接口 | DT-1 | 待开发 |
| **DT-3** | 用户管理打磨（去新建用户；行内 编辑角色/重置密码/禁用/踢会话/删除；批量只留踢会话；编辑弹窗显示绑定账号只读；审计） | 无 | 待开发 |
| **DT-4** | 验证码体验（冷却按场景分桶 + 倒计时 60s + 重置密码弹窗不发码/失败不关/可重发） | 无 | 待开发 |
| **DT-5** | 前后台入口（前台登录按钮、去前台退出/改密；Console 全局顶栏用户菜单树含退出） | 无 | 待开发 |

- **执行方式**：DT-3/DT-4/DT-5 可并行；DT-1 → DT-2 串行（同一会话或先后会话均可）；每个子需求独立提交 + 独立质检。
- **验收**：各子需求见规格对应小节（含「demo 状态↔断言」）；`npm test`（分段）+ `frontend:build` + `scan` 全绿。





## EC. 待开发（⚙️ 调整）：图片覆盖治理（覆盖看板 / 缺图回填 / 占位图）

**类型：** ⚙️ 调整（运维可视化 + 数据补齐）
**状态：** 待开发（2026-11-19 所有者确认三点立项）
**优先级：** P2 —— 图片缺失可观测、可回填
**依赖：** 无
**解锁：** 无
**规格**：[IMAGE-COVERAGE.md](IMAGE-COVERAGE.md) §8

- **背景**：实测热门 10/10、冷门抽样 19/20 图片 200；个别游戏 header_image 为空（PEAK 3527290）→ 缺图；
  同步服务未停，缺的是「可观测 + 回填 + 占位」。
- **范围**：EC-1 后台图片覆盖看板（总数/有 header_image/已缓存/缺图数 + 缺图列表 + 重置负缓存）；
  EC-2 缺图回填任务（扫描 header_image 空 → 元数据重同步补图，限速/日志）；
  EC-3 前端缺图占位（品牌占位图，列表/详情统一）。
- **验收**：见规格 §8（看板数据一致；回填后缺图数下降；占位图显示；
pm test（分段）+ rontend:build + scan 全绿）。

## ED. 待开发（🧪 测试基建）：test-main 加文档路径忽略（纯文档提交不跑测试）

**类型：** 🧪 测试基建（CI 效率）
**状态：** 待开发（2026-11-19 夜班观察确认）
**优先级：** P3 —— 省 CI 时间，不影响功能
**依赖：** 无
**解锁：** 无
**规格**：本条目正文（workflow 配置小改，无独立规格）

- **背景**：2026-11-19 夜班期间多次文档提交（B4-QUEUE/ANDROID-POLISH/DELIVERY 等），test-main 每次 push
  都触发并被 concurrency 取消重跑（当晚 十几次 cancelled），浪费 CI 时间。
- **方案**：.github/workflows/test-main.yml 的 on.push 加 paths-ignore：
  docs/**、**/*.md、CHANGELOG.md、data/**（**不能忽略**：src/**、rontend/**、	est/**、
  scripts/**、package.json、package-lock.json、.github/**）。docker-hub/docker-tcr 只在 tag 触发，不动。
- **验收**：① 只改 docs 的提交不触发 test-main（gh run list 确认）；② 改 src/package.json 仍触发；
  ③ workflow 语法有效（push 后 Actions 正常解析）；④ 连续文档提交不再产生 cancelled run。

## EF. 质检通过（🐞 缺陷）：18R 数据同步与筛选修复（元数据 cc=cn 锁国区 → 成人内容采不到）

**类型：** 🐞 缺陷（数据同步 + 筛选）
**状态：** 质检通过（2026-11-20 开发会话站点 7a3ac2b + App 仓库 358ebc5；QA docs/QA-EF.md 第 1 轮 ✅ 放行 通过 13/缺失 0/偏差 0/需人工确认 3；**涉及 App 仓库**：是（app-vX.Y.Z 随本批））
**优先级：** P1 —— 18R 数据缺失 + App 筛选语义错误
**依赖：** 无
**解锁：** 无
**规格**：[STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md) §9

- **根因**：`src/adapters/steam-meta.js:209` appdetails 请求带 `&cc=cn`——国区商店隐藏成人内容 →
  `content_descriptors` 采不到 → 全库 adult_flag 仅约 20 个（hide 109352 vs badge 109372）。
- **修复**：① 元数据采集 `cc=cn` → `cc=us`（保留 l=schinese；价格接口仍 cc=cn 不动）；
  ② 全量回填 content_descriptors（新回填命令/复用 rename，限速防 429）；③ 前台 `/api/games` 支持
  `rating=adult|mature|none`；④ Web 前台加 18R 筛选；⑤ App 18R chip 改筛选（adult=badge&rating=adult）。
- **实现**：① `fetchMetadata` cc 参数化（默认 us，价格口径调用点显式 cn）；② 新增 `rating-backfill`
  命令（cc=us 重采三字段、只写分级不写价、限速 ≥1s、429 收轮 exit 75、前后 adult 计数日志、断点续跑）
  + 并入调度器（STEAM_HEAVY/预算）；③ `gameSearch` 加 `rating`（与后台 admin 同口径）；④ Home.vue
  18R 开关（桌面+移动抽屉，选中 adult=badge&rating=adult，取消恢复全部，角标 18+）；⑤ App
  HomeScreen/SearchScreen 开=badge&rating=adult / 关=hide（App 358ebc5）。
- **验收**：见规格 §9（回填后 adult 数显著增加且有计数日志；Web/App 筛选只显示 18R + 角标；价格国区口径不变；
  `npm test`（分段）+ `frontend:build` + `scan` 全绿）。

## EG. 已实现待发版（🐞 缺陷）：通知角标已读后不消失（ABC 三场景）

**类型：** 🐞 缺陷（App 公告角标）
**状态：** 质检通过（2026-11-20；App 仓库 3458bce + 站点 7eb5d4a；QA docs/QA-EG.md 第 1 轮 ✅）
**优先级：** P1 —— 角标常驻误导
**依赖：** 无
**解锁：** 无
**涉及 App 仓库**：是（app-vX.Y.Z 随本批）
**规格**：[ANDROID-POLISH.md](ANDROID-POLISH.md) §EG

- **现象**：A 打开公告列表 / B 点开公告详情 / C 点「全部已读」——三种操作后首页铃铛角标仍显示 1。
- **排查**：服务端 `/api/announcements/read` 是否保存；`refresh()` 覆盖竞态（markInFlight 闩）；
  角标与弹层未读是否同源；游客本地 DataStore 写入；ABC 分别复现定位。
- **修复**：① 站点 `GET /api/announcements` 公开段补 Bearer 解析（此前只认 Cookie 会话，App 登录用户
  恒拿空 readIds → 刷新即回跳的根因）；② App `AnnouncementsState` 标记纪元守卫（陈旧快照只并集不覆盖、
  会话切换快照作废，取代 markInFlight 闩）+ 网关缝解耦 + `AnnouncementsStateTest` 5 项锁竞态。
- **验收**：ABC 三场景角标正确（B 递减 / C 立即归零 / A 按口径）；下拉刷新/重进首页/重启 App 不复现；
  App 构建通过——模拟器（10s 延迟代理放大竞态）+ 单测 83 项 + 站点测试全绿。
