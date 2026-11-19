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

---

## CO. 待开发：设计审计技术债清理（21 项 → 4 批，每日推进）

**状态：仅 B4 待开发（源清单 [DESIGN-AUDIT.md](DESIGN-AUDIT.md)）；E1 文档归档已完成（不进版本）；其余已发布子项（CO-1 A3/A5、CO-2 B1/B2/B3/B5、CO-3 C2/C4/C5、CO-4 D1/D4/D6/E4——其中 D4/D6/E4 已发布 v2.26.0）见 [DONE.md](DONE.md)**
**依赖：** 无（A2/A4/C1/D5 已分别由 CL/CJ/CK 覆盖，本批只做"未开"的 15 项）
**解锁：** 无
**推进规则**：每个开发会话**至少认领 1 条**（开工把该行改「开发中」），当天实现+测试+提交，
把该行改「已实现待发版」并**回写 DESIGN-AUDIT.md「跟踪」列**；一次会话不跨批次混做，批次顺序由所有者定。
**通用验收**：每条按 DESIGN-AUDIT.md 的「建议」给出可测断言 + `npm test` / `frontend:build` / `scan` 全绿；不自行打 tag。

| 批次 | 子项 | 内容（对应审计编号） | 状态 |
|---|---|---|---|
| **CO-4** | B4 | 巨石拆分（`server.js`/`pg.js`/`cli.js` 渐进拆 routes/repository，先一个域试点） | 待开发 |

> 已被其它条目覆盖、**不重复做**：A1→CN、A2→CL、A4→CJ、C1→CL、D5→CK、D2/D3 已有测试防护、E3 已有规则。


## DL. 待开发：对齐审核快照落库（后台生成 + 签名动态失效）

**状态：待开发（2026-11-19 所有者确认：落库、动态检测、后台生成）**
**依赖：** 无（CN/CS/DE 批已发布）
**解锁：** 无
**规格**：[ALIGN-SNAPSHOT.md](ALIGN-SNAPSHOT.md)

- **痛点（2026-11-19 线上 v2.25.0）**：对齐审核缓存是内存 TTL 10 分钟 + 硬编码（`server.js:674`），
  服务重启后首次进入必然「生成中 0/0」，前台要等；同一份结果重启即丢。
- **方案**：① 新表 `align_snapshots`（payload/counts/signature/generated_at/error，保留最近 5 条）；
  ② 数据签名（skus.json size+mtime、games count+max(updated_at)、game_source_map count+max(reviewed_at)）——
  签名不变直接用库快照，变化才后台重算；24h 强制重算兜底；③ 新调度任务 `align-snapshot`
  （默认每 30 分钟、首轮延迟 30 秒）；④ `GET /api/admin/align` 只读快照；无快照首次 202；
  `?refresh=1` 后台重算不阻塞；**⑤ 确认/忽略成功后同事务更新快照**（从 payload 移除已处理组、counts 递减、
  `dirty=true`）——读请求立即拿到新队列，**彻底消除「确认后旧列表还要再审」**；废弃 `invalidate()`/`staleCache`
  内存语义；⑥ 前端操作成功后本地乐观移除该组 + counts 更新，再读快照；「生成中」进度只在首次生成出现。
- **验收**：见规格 §8 的 9 条——含「确认 3 组后立即刷新页面 → 这 3 组立刻消失、counts 递减、无生成中」。

## DM. 已过时（2026-11-19 所有者要求彻底解决，并入 DL）：对齐审核批量操作超时短期补丁

**状态：已过时（2026-11-19 所有者指示「彻底解决不要短期」——全部并入 [DL](ALIGN-SNAPSHOT.md)，本条目不再派发）**
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

## DP. 质检通过：e2e 浏览器从 Edge 换成 Chrome（headless Chrome + Edge 回退）

**状态：质检通过（2026-11-19 QA docs/QA-DP.md 第 1 轮 ✅ 4/0/0/0；实现 24780ef；需求会话写入时被 v2.26.0 构建会话占用，开发会话按交接补建）**
**依赖：** 无（CK e2e 套件已发布 v2.24.0）
**解锁：** 无
**规格**：本交接 + [E2E-SUITE.md](E2E-SUITE.md) + [TESTING-E2E.md](TESTING-E2E.md)

- **背景（2026-11-19）**：本机 Chrome 157 headless 实测正常（dump-dom 成功、stderr 0）；受限沙箱下
  Edge mojo 命名管道被拒；所有者指定 e2e 用 Chrome。
- **范围**：① `test/e2e/lib/browser.mjs`：findEdge → findChrome（探测顺序：Program Files Chrome →
  Program Files (x86) Chrome → PATH chrome → 最后回退 Edge 并提示）；launchEdge → launchChrome
  （CDP 逻辑不变，日志文案改）；② `test/e2e/runner.mjs`：预检文案/路径（Chrome 优先）、
  「headless Chrome 已就绪」；③ `test/e2e/lib/report.mjs`：print-to-pdf 用 Chrome；
  ④ `docs/E2E-SUITE.md`、`docs/TESTING-E2E.md`：Edge → Chrome（保留回退 Edge 兼容说明）。
  不做：e2e 矩阵行、其它 e2e 逻辑、App/模拟器部分、技能文件（87d0f11 已改好）。
- **验收**：① `npm run e2e:smoke` 用 Chrome 跑通（报告显示浏览器为 Chrome）——实测 7/8（admin-login
  行失败为 CX 批 UserAvatar 既有 avatar 404，2026-11-18 Edge 时代报告同样失败，非本批引入）；
  ② Chrome 缺失时回退 Edge 或明确报错（注入路径验证 4 分支）；③ 代码无「Edge 优先」残留逻辑；
  ④ `npm test`（分段）+ `scan` 全绿（test:4 期间 DR 在途 92≠91 已由 DR 批提交消解，QA 复跑全绿）。

## DQ. 质检通过：个人资料页打磨——头像与 Steam 账号解耦 + 布局调整

**状态：质检通过（2026-11-19 QA docs/QA-DQ.md 第 1 轮 ✅ 9/0/0/3；站点 e62fb4e/a1af397 + App 795c791；需求会话写入时被 v2.26.0 构建会话占用，开发会话按交接补建）**
**依赖：** 无（CX 已发布 v2.25.0）
**解锁：** 无
**规格**：[PROFILE-UI-2026-11-19.md](PROFILE-UI-2026-11-19.md)（决策 5 项 + 数据/前端/验收齐全）；demo [design/profile-layout-2026-11-19.html](design/profile-layout-2026-11-19.html) + 同名 .png
**涉及 App 仓库**：是（app-vX.Y.Z 随本批；App 仓库提交 795c791）

- **范围**：① `users.default_steam_id` 列 + 迁移（回填自 `avatar_source`，`steam:%` 头像清空）；
  ② 头像解耦：`setDefaultSteamAccount` 只写 `default_steam_id`、解绑只清该列、删除绑定自动设头像逻辑（`setDefaultSteamAccountIfUnset`）、
  `isDefault` 改读 `default_steam_id`；③ 头像规则：只有 custom 走 `/api/avatar`，否则首字母/首字+品牌色（Web+App 统一）；
  ④ Web ProfilePage/UserAvatar + App ProfileEditScreen/MeScreen 按 demo 调整（两行按钮、统计三项、开关文案）。
  不做：改 CX 其它已发布功能、新增头像来源、后端契约以外的新接口。
- **验收**：规格 §6 的 8 行 demo 状态↔断言（尤其：设为默认只改 `default_steam_id` 头像不变；
  无「从 Steam 选头像」入口；两行按钮窄屏不竖排；统计去重）；`npm test`（分段）+ api.test +
  `frontend:build` + `scan` 全绿；App 模拟器对照 demo 截图。
- **实现**：站点 e62fb4e（迁移+解耦+头像规则+Web 页面+test/profile.test.js 8 项进主链）；
  App 795c791（ProfileEditScreen/MeScreen/ProfileRequests/Dtos/JVM 单测）。

## DN. 已实现待发版：对齐审核内容词 SKU 默认归档（无效数据处理，不进待审队列）

**状态：已实现待发版（2026-11-19，实现 0c5fde4）**
**优先级：** P2 —— 审核效率（队列被内容词 SKU 反复占用人工）
**依赖：** 无（复用 CE 批内容词判定 + DH 已忽略/恢复能力）
**解锁：** 无
**规格**：本条目 + [SONKWO-STEAM-MATCH.md](SONKWO-STEAM-MATCH.md)（CE 批内容词口径）+ [ALIGN-INTEGRITY.md](ALIGN-INTEGRITY.md)（已忽略视图/恢复）

- **痛点（2026-11-19 线上）**：待对齐队列剩余全是内容词 SKU——巴士模拟器 27 第1年季票、龙之剑:觉醒 服装 ×3；
  它们 Steam 上有对应 DLC（appid 4488260 / 5245420 等），但**不是本体、不该与本体重合**，现在要人工逐个「忽略」。
- **已确认口径（2026-11-19）**：内容词类 SKU（名称命中 服装/皮肤/季票/通行证/套装/DLC 等；含杉果自定义命名的同类商品）
  视为**无效数据**——默认**不进入待对齐队列**（自动归档，不计入「待对齐组」），不需要人工审核；
  误判可通过「已忽略」视图恢复（DH 能力）。
- **实现**：`computeAlignGroups` 对每组做内容词判定（复用 `match.js` 现有内容词/版本词校验与 EDITION_WORDS），
  命中 → 不进 `items`（计入 `ignoredGroups` 或新增 `contentWords` 计数），日志 `align.content_word_skipped`（含计数）；
  对齐审核页「已忽略」chip 计数包含内容词归档，chip 旁注明「内容词自动归档」；可选单列「内容词 N」chip。
- **验收**：① 内容词 SKU（季票/服装/DLC）不出现在待对齐队列、不占「待对齐组」计数；② 本体 SKU 不受影响；
  ③ 「已忽略」可查看/恢复内容词归档组；④ 反向自检：去掉内容词判定后这些组重新进队列 → 测试必须红；
  ⑤ `npm test`（分段）+ `npm run frontend:build` + `npm run scan` 全绿。
- **实现**：0c5fde4（`archiveContentWordItems` 判定 + `writeContentWordArchives` 归档落库（ignored + `method=content_word`）、
  `loadIgnoredGroups` 组级标注、`alignGroupCounts` 增 `contentWords/contentWordSkus`、`computeAlignGroups` 接线 +
  日志 `align.content_word_skipped`、AlignAdmin「已忽略」chip 注明 + 已忽略视图标注；单元/契约/运行时测试 + 反向自检）。

## DR. 质检通过：App 发版后即刻可更新（后台立即同步 + App 检查节流 1h + 同步间隔 15 分钟可配）

**状态：质检通过（2026-11-19 QA docs/QA-DR.md 第 1 轮 ✅ 8/0/0/2；站点 39aaebb + App 仓库 98dabca）**
**优先级：** P1 —— App 发版后手机要立刻能检测到更新
**依赖：** CJ（app-release-sync / latest.json 契约）、DK（失败原因与 apkPath 兜底）——均已发布
**解锁：** 无
**规格**：[APP-INSTANT-UPDATE.md](APP-INSTANT-UPDATE.md)
**涉及 App 仓库**：是（app-vX.Y.Z 随本批）

- **痛点（2026-11-19 线上 v2.25.0）**：App 发版后三层延迟——手机启动/回前台 24h 内不重复检查
  （UpdateManager THROTTLE_MS 24h，最大瓶颈）、站点每小时才同步一次 GitHub Release、后台没有
  「立即同步」入口——「安卓构建完成 → 手机立刻能更新」做不到。
- **方案（规格 §3 三处小改）**：
  ① 站点：`POST /api/admin/app-sync`（requireAdmin + single-flight + 审计 + 日志 app.sync_manual）
  + 运行与同步页「App 版本卡」（当前版本/上次同步时间/失败原因/「立即同步」按钮）；
  `APP_RELEASE_SYNC_INTERVAL_MIN` 默认 60→15 + settings 项 `app.syncIntervalMin`（页面可改，热加载）；
  ② App：`THROTTLE_MS` 24h→1h（启动/回前台；手动检查不节流、不写时间不变）；
  ③ 技能：steamdeals-app-build §3 / steamdeals-build §3.8 加「发版后提示去后台点立即同步」。
  不做：GitHub webhook（后置）、下载/安装流程、app-release-sync 的 DK 逻辑（已发布）。
- **验收**：见规格 §4 的 5 条——含管理员 200 / 非管理员 401-403 / 并发 single-flight 只跑一次 /
  失败明确 reason；卡片与 /api/app/latest 一致；app.syncIntervalMin 默认 15 热加载；App 1h 内会检查；
  端到端「发版→点同步→App 更新提示」（截图留档，发版会话执行）。



