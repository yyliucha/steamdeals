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

## 类型汇总（2026-11-24）

| 类型 | 数量 | 编号 |
|---|---|---|
| 🐞 缺陷 | 4 | EO、ER、EU、EX |
| ✨ 功能 | 0 | — |
| ⚙️ 调整 | 10 | EP / EV / EW / EY / FB / FD / FF / FG / FH / FL |
| 🧹 技术债 | 2 | EN、FC |
| 🧪 测试基建 | 0 | — |
| 📝 文档流程 | 0 | — |
| 🔬 调研 | 0 | — |
| 已过时 | 0 | — |

---

## EN. CSP 安全加固（Report-Only → 正式）

**状态：** 已发布 v2.28.10（2026-11-24；`src/server.js` 三档 CSP（正式/观察/关闭）+ per-request nonce 放行内联脚本，`src/settings.js` 开关，`test/csp.test.js` 11 条并注册 test:3；QA ✅ 放行；规格见 [CSP-HARDENING.md](CSP-HARDENING.md)）
**类型：** 🧹 技术债
**优先级：** 中 —— 安全排查三件套中唯一未落地项（信任门、ip-api 开关已做）
**依赖：** 无
**解锁：** 无
**规格**：[CSP-HARDENING.md](CSP-HARDENING.md)（所有者 2026-11-24 决策：切正式 + 按 Report-Only 日志收敛 allowlist）

- **现状（2026-11-20 代码核实）**：`src/` 下无任何 `Content-Security-Policy` 相关代码（grep 零命中），
  ROADMAP 三件套里 `x-forwarded-host` 信任门（steam-login.js）与 `VISITOR_GEO=0` 开关（visitors.js）已落地，只剩 CSP。
- **要点**：① 加 CSP 响应头，先 `Content-Security-Policy-Report-Only` 观察、再切正式；
  ② 注意 Element Plus 的 inline style，需要 `style-src 'unsafe-inline'` 或先审计再收紧；
  ③ 补测试锁住响应头存在 + 反向自检。
- **验收**：① 响应含 Report-Only 头且页面无 CSP 违规报错；② 切换正式后前后台功能正常；
  ③ `npm test`（分段）+ `frontend:build` + `scan` 全绿。

## EO. 首页工具栏 1100–1300px 挤成一行
**状态：** 已发布 v2.29.0（2026-11-24，31138c1；代码随 v2.28.10 镜像成像，发布记录归本版；QA docs/QA-EO.md 第 1 轮 ✅ 6/0/0/2；测试 test/frontend-toolbar.test.js 6/6 + frontend-mobile 13/13 + style-tokens 3/3 + serve 12/12 绿）
**类型：** 🐞 缺陷
**优先级：** 高（用户已反馈）
**依赖：** 无
**解锁：** 无
**规格**：[ROADMAP.md](ROADMAP.md)「体验与性能优化」#1

- **现象**：新增「全部发行」后，首页工具栏在 1100–1300px 宽度挤成一行（ROADMAP 记录，用户已反馈）。
- **根因（2026-11-24 排查）**：`frontend/src/styles/main.css`
  - 基础规则 `.toolbar .el-select{flex:0 0 132px}`（固定 132px）；
  - 2 列规则只在 `@media(max-width:1200px)`——**1201–1300px 之间无规则** → 6 个下拉 + 搜索框 + 18R/刷新按钮挤一行，下拉文字被压成「中…」；
  - 1100–1200 虽有 2 列规则，但 6 个下拉 + min-width 118px 在部分宽度仍拥挤。
- **修复方案**：把 2 列断点扩到 1360px（覆盖 1100–1300）；搜索框整行 + 下拉 2 列（`flex:1 1 calc(50% - 5px);min-width:118px`）；
  补 900/600 两档（ROADMAP 批次 2）；验收 1100/1200/1300 三档不溢出、下拉文字完整。
- **实现（2026-11-24）**：`frontend/src/styles/main.css` ①2 列断点 `@media(max-width:1200px)` → `1360px`（搜索整行 + 下拉 `flex:1 1 calc(50% - 5px);width:auto;min-width:118px`）；
  ②补 `@media(max-width:900px)`（平板）与 `600px`（小屏）两档；③修复根因：原末尾全局 `.toolbar .el-select{flex:0 0 132px;width:132px}` 包进 `@media(min-width:1361px)`，不再覆盖窄屏；
  ④`760px` 档的 45% 两列统一为 `calc(50% - 5px)`；420px 一列规则保持在最后（层叠顺序锁）。Home.vue 未改（纯 CSS 解决）。
- **验证（2026-11-24）**：headless Chrome（CDP）在 1100/1200/1300/900/1440 五档实测——1100/1200/1300/900 无横向溢出（`scrollWidth<=clientWidth`）、6 个下拉 3 行 2 列、`min-width 118` 生效、placeholder 文字完整不截断；
  1440 单行 6×132px；反向自检注入修复前全局 132px 规则后断言变红（1 行 6 列）。截图 `F:\dsh\eo-shots\home-{1100,1200,1300,900,1440}.png`（不入库）。
  测试：`test/frontend-toolbar.test.js`（6 条，含反向自检）已进主链 `test:3`；相关单测 frontend-mobile 13/13、style-tokens 3/3、serve 12/12 全绿。

## EP. 后台其余列表手机端卡片化

**状态：** 已发布 v2.29.0（2026-11-24；任务健康/价格变化/浏览排行/缺图 4 表 + 未归属账号 + 对齐审核两视图卡片化，断点统一 760，卡片按钮 ≥44px；测试 admin-console-mobile 10/10；QA ✅ 放行）
**类型：** ⚙️ 调整
**优先级：** 低
**依赖：** 无（纯前端改动；开工前查 ACTIVE-SESSIONS 确认与在跑会话文件面不重叠）
**解锁：** 无
**规格**：[ROADMAP.md](ROADMAP.md)「未排期想法」

- **范围**：游戏目录/访问记录已卡片化（v1.16.2）；其余后台表格目前靠「左右滑动查看更多」提示，按同款模式补卡片化。
- **验收**：窄屏（≤760px）下受影响表格以卡片呈现、操作可用；与既有卡片化页面视觉一致；
  `frontend:build` 绿 + 无 Vue 模板警告。

## EQ. 提醒通道：多收件人分组
**状态：已满足（2026-11-24 核实：CL 批已实现「按用户分组」——用户级提醒一人一封发到用户绑定邮箱，站点级走全通道；无需开发）**
**状态：待决策**
**类型：** ✨ 功能
**优先级：** 低
**依赖：** 无
**解锁：** 无
**规格**：[ROADMAP.md](ROADMAP.md)「未排期想法」（当前只有一句话：邮件模板美化已于 v2.0.0 完成，分组投递未做）

- **状态说明**：本条目按所有者 2026-11-20 指示立项；ROADMAP 仅有目标句、无范围与验收——
  派发前需先确认「收件人组怎么定义/管理、与现邮件通道（QQ 邮箱/企业微信 webhook）的关系」，再补规格。
- **范围提示**：QQ/微信官方机器人推送已评估不做（ROADMAP 2026-11-17），提醒继续走邮件 + 企业微信群机器人两条现成通道。

## ER. B4/cli 拆分遗留缺陷修复（3 项）

**状态：** 已发布 v2.28.10（2026-11-24；①listBackfillCandidates 传 q、②cmdPrune 裸库 ensure 表、③syncPrices 回归锁；新增 test/cli-ops.test.js 并注册 test:4；QA ✅ 放行）
**类型：** 🐞 缺陷
**优先级：** 中 —— 均为拆分引入/暴露的运行期错误，cli 路径才会踩到
**依赖：** 无（cli 域 #18/#19/#20 已拆完；与 B4 剩余 admin 域文件面不重叠）
**解锁：** 无
**规格**：本条目 + [B4-QUEUE.md](B4-QUEUE.md) 备注「遗留上报」（2026-11-20 14:43 轮收尾）

- **三项（拆分前即存在或拆分引入，逐字保留未修）**：
  ① `cli backfill` 传 store 给 `countBackfillCandidates`/`listBackfillCandidates`（签名是 q 函数）→ 运行报 `q is not a function`；
  ② `cli prune` 在未跑 `ensureEmailSchema`/`ensureSteamSchema` 的裸库报 `42P01`；
  ③ #18 拆分遗留断引用：`cmdBackfill` 价格回退分支调用 `syncPrices`，import 已随 #18 移出 → `ReferenceError`。
- **验收**：① backfill 命令真实跑通（或单测锁）；② 裸库 prune 不再 42P01（测试锁）；
  ③ backfill 价格回退分支可运行；④ 相关测试 + `npm test`（分段）+ `scan` 全绿。

## ES. 生产 pg_trgm 索引命中复核（EXPLAIN）
**状态：已排查通过（2026-11-24：pg_trgm 索引有效——A/B/C 三写法均走 Bitmap Index Scan；线上热查询 36–40ms；冷请求属冷缓存，无需重建）**
**类型：** 🔬 调研
**优先级：** 低
**依赖：** 无
**解锁：** 无
**规格**：[ROADMAP.md](ROADMAP.md)「体验与性能优化」段尾注

- **事项**：AU 批的 pg_trgm 索引已落地，ROADMAP 注明「生产侧待用 EXPLAIN 复核索引命中」。
- **动作**：部署侧对模糊搜索查询执行 EXPLAIN，确认走索引而非全表扫；结果回填本条目
  （命中 → 移 DONE；未命中 → 转缺陷条目）。
- **注意**：需服务器环境（本机无生产库），由部署/运维阶段执行，不改代码。

## EY. 我的愿望单合并 Steam 愿望单展示（Steam 行只读）

**类型：** ⚙️ 调整（前台愿望单：两层合并展示，操作仅限本站）
**状态：** 已发布 v2.29.0（2026-11-24；`listMergedWishlists` 合并视图 + `include=steam`，UserSections.vue 来源列/只读行，测试 wishlist-site-only 14/14；合并展示按新功能定档 → 本版大版本依据；QA ✅ 放行）
**优先级：** P2
**依赖：** EW（账号列已发布）
**解锁：** 无
**规格**：[MY-WISHLIST-MERGED.md](MY-WISHLIST-MERGED.md)

- **需求**：「我的愿望单」= 本站（user_wishlist）+ Steam 导入（steam_wishlist）合并展示；
  **Steam 行只读无操作按钮**；同一游戏两层都有 → 合并一行（来源「本站 + Steam」），移除只删本站；
  账号列沿用 EW；分页/搜索覆盖两层。
- **实现**：`GET /api/me/wishlist?include=steam`（UNION + 按 game_id 合并，返回 sources/site_wishlist_id/steam_accounts）；
  UserSections.vue 合并渲染 + 操作条件（仅 site）。
- **验收**：见规格 §4（空/仅 Steam/两层都有/分页搜索/越权；`npm test`（分段）+ `frontend:build` + `scan` 全绿）。

## FB. 待开发（⚙️ 调整）：后台顶栏——去重「返回网站」+ 版本徽标所有登录用户可见（含更新提示）

**类型：** ⚙️ 调整（后台顶栏）
**状态：** 已发布 v2.28.10（2026-11-24；顶栏删除「返回网站」按钮保留菜单项，版本徽标所有登录用户可见，/api/admin/version 改登录可读、force=1 仅管理员；QA ✅ 放行）
**优先级：** P2
**依赖：** 无
**解锁：** 无
**规格**：[CONSOLE-HEADER-FIX.md](CONSOLE-HEADER-FIX.md)

- **现状**：`Console.vue:47` 顶栏「返回网站」按钮 + `:57` 用户菜单「返回网站」→ 重复；
  版本徽标 `:46` 仅管理员（`role==='admin'`），普通用户看不到。
- **需求**：① 删顶栏「返回网站」按钮（保留菜单项）；② 版本徽标**所有登录用户可见**（当前版本 + 新版提示）；\n  ③ `/api/admin/version` 从 requireAdmin 改为登录用户可访问（未登录 401；force=1 仅管理员）；管理员行为不变。
- **验收**：见规格 §3（单入口、普通用户显示版本号、管理员完整、移动端正常、测试全绿）。

## FD. 已落地（⚙️ 调整）：部署稳定性——nginx upstream 跟随容器 IP（发版不再 502）

**类型：** ⚙️ 调整（服务器部署配置）
**状态：** 已落地（2026-11-24 服务器配置完成并验证：重建 app 后无需 restart nginx，域名 15s 内恢复 200）
**优先级：** P1 —— 每次发版后 502
**依赖：** 无
**解锁：** 无
**规格**：[NGINX-UPSTREAM-FIX.md](NGINX-UPSTREAM-FIX.md)

- **根因**：nginx upstream 写容器名 `steamdeals:8080`，启动时解析缓存旧 IP；app 重建后 IP 变 → 502。
- **方案 A**：nginx 加入 webnet + 配置 `resolver 127.0.0.11 valid=10s` + 变量 proxy_pass（自动跟随容器 IP）；
  备选：部署清单固定加 `docker restart nginx`。
- **验收**：重建 app 后域名自动恢复（或按清单操作后恢复）；DELIVERY 部署步骤更新；502 不再复现。

## FF. 待开发（⚙️ 调整）：游戏卡片英文名缺失保持占位（不影响布局）

**类型：** ⚙️ 调整（前台卡片布局）
**状态：** 已发布 v2.28.10（2026-11-24；英文名行始终渲染 + `.game-subtitle` 固定行高，移动端同 class，test/frontend-mobile.test.js 加锁；QA ✅ 放行）
**优先级：** P2
**依赖：** 无
**解锁：** 无
**规格**：[CARD-SUBTITLE-PLACEHOLDER.md](CARD-SUBTITLE-PLACEHOLDER.md)

- **现状**：`Home.vue:70` 英文名行 `v-if="game.name_en && game.name_en !== game.name"`——无英文名时整行消失 →
  卡片高度不一致/价格错位（如 Garry's Mod）。
- **方案**：始终渲染该行并固定高度（`min-height:1.4em`）；英文名缺失/与主名相同时显示空占位；
  移动端同样处理。
- **验收**：见规格 §3（两种卡片高度一致、位置对齐；有英文名显示不变；手机端一致；测试全绿）。

## FG. 待开发（⚙️ 调整）：移除 18R 查询入口（保留数据/同步能力）

**类型：** ⚙️ 调整（合规：大陆不展示 18R 查询）
**状态：** 已发布 v2.28.10（2026-11-24；站点 Home.vue/AdminModules.vue + App HomeScreen/SearchScreen 入口移除，测试 test/remove-18r-entry.test.js；QA ✅ 放行）
**优先级：** P1 —— 合规
**依赖：** 无（EF 已发布，本次为移除入口）
**解锁：** 无
**规格**：[REMOVE-18R-ENTRY.md](REMOVE-18R-ENTRY.md)

- **移除**：Web 前台 18R 按钮 + 移动端筛选抽屉 18R 项 + 年龄确认入口；App 首页/搜索 18R chip；
  后台游戏管理「内容分级」筛选。
- **保留**：`/api/games` 的 `adult`/`rating` 参数（兼容）、`adult_flag`/`mature_flag` 数据、`rating-backfill`
  回填任务、站点策略 `SITE_ADULT_DISPLAY`（默认 hide，国外部署可设 badge/show）。
- **验收**：见规格 §3（三端无入口；API 参数仍可用；默认 hide；测试全绿）。

## FH. 待开发（⚙️ 调整）：成人内容统计（只读数字）

**类型：** ⚙️ 调整（后台统计）
**状态：** 已发布 v2.28.10（2026-11-24；/api/admin/games/stats 加 ratingBackfilled/ratingPending，后台「同步与回填」页只读统计卡；QA ✅ 放行）
**优先级：** P2
**依赖：** FG（入口移除后统计替代）
**解锁：** 无
**规格**：[ADULT-STATS.md](ADULT-STATS.md)

- **需求**：后台统计卡片显示 adult_flag 总数 / mature_flag 总数 / 回填覆盖 / 最近回填时间——**只显示数字**，
  无成人内容列表（配合 FG）。
- **验收**：见规格 §2（数字与 API 一致；无内容列表；测试全绿）。

## FL. 待开发→已实现待发版（⚙️ 调整）：系统设置页所有分组统一折叠

**类型：** ⚙️ 调整（后台设置页 UI 一致性）
**状态：** 已实现待发版（2026-11-24，实现 0f22937；补登记：本次为直接修复，未先立项，事后补条目 + QA）
**优先级：** P3
**依赖：** 无
**解锁：** 无
**规格**：本条目（所有者 2026-11-24 截图反馈：「要收缩就全部收缩，为什么还有不收缩的元素」）

- **根因**：设置页折叠按钮只在组内有 `tier=advanced` 字段时生成；「时区与显示」只有 `system.timezone`（primary）→ 无折叠按钮，与其它组不一致。
- **修复（0f22937）**：所有分组统一生成折叠按钮 + 折叠体（无 advanced 的组也折叠）；默认收起，状态 localStorage 记忆，与「调度与熔断」等一致。
- **验收**：设置页各分组（高级 tab 的调度与熔断/备份与日志/缓存与图片/时区与显示，及站点/数据源各组）均可折叠/展开；
  `frontend:build` 通过；admin-console-ia / style-tokens 测试 fail 0；截图对照（全部分组均有折叠箭头）。
