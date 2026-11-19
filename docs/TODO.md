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

## 类型汇总（2026-11-19）

| 类型 | 数量 | 编号 |
|---|---|---|
| 🐞 缺陷 | 1 | DU |
| ✨ 功能 | 1 | DT-2 |
| ⚙️ 调整 | 5 | DT-1 / DT-3 / DT-4 / DT-5 / DV |
| 🧹 技术债 | 2 | CO-5 / DX |
| 🧪 测试基建 | 0 | — |
| 📝 文档流程 | 0 | — |
| 🔬 调研 | 0 | — |
| 已过时 | 1 | DM |

---

## CO-5. 开发中（🧹 技术债）：B4-2 巨石拆分第三轮（认证域）

**类型：** 🧹 技术债（重构，外部契约零变化）
**状态：** 质检通过（第三轮：认证域——`src/routes/auth.js` + `src/store/auth-repository.js`，契约零变化；QA docs/QA-CO5-B4-2.md 第 1 轮 16/0/0/1；等构建指令）
**优先级：** P2 —— 巨石渐进瘦身（CO-4/B4 已随 v2.27.1 发布 app/appeal 两域；剩余域拆分按 DONE.md 口径另行立项 B4-2/CO-5，本条目承接第三轮）
**依赖：** 无（**避开** `/api/games*`（DX 待开发改游戏查询区）、`/api/me*`（DT-2 待开发会加接口）；与 DW 零重叠）
**解锁：** 无
**规格**：[ARCHITECTURE.md](ARCHITECTURE.md) §15（域路由拆分模式）+ [DESIGN-AUDIT.md](DESIGN-AUDIT.md) B4 + 本轮交接消息（验收①–⑥与纪律）

- **范围（一次一个域，本轮只做认证域）**：① 路由 → `src/routes/auth.js`（只做 HTTP 编排、不写 SQL）：
  `POST /api/device`（公开段）+ `GET /api/captcha`、`POST /api/login`、`POST /api/password/check`、
  `POST /api/logout`、`POST /api/user/password`、`GET /api/auth/steam/start`、
  `GET /api/auth/steam/callback`（主段）；② SQL → `src/store/auth-repository.js`
  （登录失败计数/锁定/改密/Steam 绑定专属 SQL；pg.js 保留 re-export 兼容，通用 SQL 留 pg.js）；
  ③ 上下文注入照 §15；④ 修该域静态断言测试指向新文件（不降断言质量）；
  ⑤ 契约零变化（路径/参数/响应/错误码/验证码/会话行为不变）；⑥ ARCHITECTURE §15 补第三轮记录。
  不做其它域/行为变更/前端/新依赖。邮箱验证码/注册/换邮箱仍在 `src/auth-routes.js`（独立模块 +
  含 `/api/me/email/*` 属 DT-2 排除区，本轮不动）。
- **验收**：沿用 QA-CO4-B4.md 口径（域代码在 routes/+repository（拆分前后行数对比）；全量 `test:1..4` +
  `api.test` + `frontend:build` + `scan` 全绿；静态断言全绿 + 反向自检（删路由分支必红）；
  ARCHITECTURE §15 步骤清单与实际一致；交付说明含域选择理由/净减行数/下一轮建议）。

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




