# QA：后台移动端重设计 BW（第 1 轮）

> 基线 e970c2f → HEAD 9149a4c（实现提交 605e05a）；判据 [MOBILE-REDESIGN.md](MOBILE-REDESIGN.md) §5（5.1 结构 / 5.2 卡片与操作 / 5.3 验收 1–5）+ §1 决策 9（桌面 ≥1025px 不变、移动 ≤768px 新结构、768–1024 沿用压缩布局）+ §10 效果图 ④（后台首页：☰ 抽屉 + 指标卡 + 任务健康 + 模块入口网格；表格页改卡片；允许微调间距/字号，不得改变结构与信息层级）；开发描述来源：提交 605e05a 的 commit message（自述本地验证全绿）。
> 结论：**⚠️ 有条件放行 —— 通过 17 / 缺失 0 / 偏差 2 / 需人工确认 3**。TODO 状态回写为 **质检打回**（2 项偏差为 CSS 级联冲突，必修后复检第 2 轮）。

## 功能清单（本批交付的全部功能，一条功能一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | BW | 手机打开 `/console`：侧栏收进 ☰ 抽屉 | 后台 → 顶栏 ☰ | ✅ | Console.vue:2,18,36,67–72（≤768px） |
| 2 | BW | 抽屉沿用 5 分组 13 模块导航（与桌面侧栏同一份 groups） | ☰ 抽屉 | ⚠️ | Console.vue:22,93–99（13 模块全在；≤760px 分组标题被旧 CSS 隐藏，见打回项 2） |
| 3 | BW | 抽屉内搜索管理功能 | ☰ 抽屉 → 搜索框 | ✅ | Console.vue:20 |
| 4 | BW | 抽屉内「申诉管理」待处理角标 | ☰ 抽屉 | ✅ | Console.vue:24,74–80 |
| 5 | BW | 顶栏显示当前模块标题 | 后台顶栏 | ✅ | Console.vue:37–41 |
| 6 | BW | 顶栏通知铃 → 站点通知模块 | 后台顶栏 🔔 | ⚠️ | Console.vue:44,122（≤760px 被旧 CSS 隐藏，见打回项 1） |
| 7 | BW | 用户管理表格改卡片（勾选/改名/邮箱/验证/重置密码/踢会话/禁用/删除） | 后台 → 用户管理 | ✅ | AdminExtras.vue:6–14 |
| 8 | BW | 回收站表格改卡片（勾选/恢复/全选当前筛选） | 后台 → 回收站 | ✅ | AdminExtras.vue:21–29 |
| 9 | BW | Steam 账号改卡片（同步/别名/API Key/解绑/未归属认领/游戏库） | 后台 → Steam 账号 | ✅ | AdminExtras.vue:54–66 |
| 10 | BW | 登录会话改卡片（勾选/踢下线/踢全部/用户名·IP 筛选） | 后台 → 登录会话 | ✅ | AdminExtras.vue:85–93 |
| 11 | BW | 操作日志 5 个 tab 全部改卡片 + 日志行点击展开详情 | 后台 → 操作日志 | ✅ | AdminLogs.vue:26,53,81,102–116,152,169,511–515 |
| 12 | BW | 批量操作吸底条（已选 N + 执行；手机卡片与桌面表格共用同一选择集） | 用户/回收站/会话列表 | ✅ | AdminExtras.vue:7,22,86 + main.css:45 + useBulkSelection.js:38–49 |
| 13 | BW | 批量执行回执弹窗（两视图都弹） | 批量执行后 | ✅ | AdminExtras.vue:98,166–185 |
| 14 | BW | 危险操作二次确认（高危批量手输条数；踢下线/解绑等确认框） | 各危险按钮 | ✅ | useBulkSelection.js:81–103；AdminExtras.vue:195,206,218 |
| 15 | BW | 弹窗在手机上全屏 + 底部吸附按钮（保存/取消） | 编辑游戏/删除用户/API Key/详情等弹窗 | ✅ | main.css:41–42（EP 2.14.7 弹窗默认不 append-to-body，选择器真实生效） |
| 16 | BW | 系统设置：tabs 横向滚动 + 输入项全宽 + 保存设置 | 后台 → 系统设置 | ✅ | AdminModules.vue:80,83,556 + main.css:43 |
| 17 | BW | 数据统计：指标卡两列 + 图表/表格横滑 | 后台 → 数据统计 | ✅ | AdminModules.vue:89–90 + 内联 @media≤560 两列 |
| 18 | BW | 游戏管理/访问记录等 13 模块在手机可达并完成核心操作（卡片化沿用 Z 批既有实现） | 后台各模块 | ✅ | AdminModules.vue:2,9,31（既有 760 断点卡片分支） |
| 19 | BW | 桌面端（≥1025px）后台布局与表格不变 | 桌面 `/console` | ✅ | Console.vue:3（aside v-if="!isMobile"）；AdminExtras.vue:5,20,84；AdminLogs.vue:14,38,66；main.css 仅追加无删除 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | §5.3-1 手机打开 /console：侧栏收进 ☰ 抽屉，5 分组 13 模块都能进入 | 读 Console.vue groups；数模块数 | Console.vue:93–99（4+2+4+1+2=13 模块，与规格清单一致）；:18–31 抽屉复用 visibleGroups | ✅ 静态 + 🔎 真机目视 |
| 2 | §5.3-2 抽查游戏管理核心操作（查看/筛选/分页/编辑保存） | 读 AdminModules games 分支 | AdminModules.vue:7–11（筛选条/指标卡/卡片+勾选/分页/编辑弹窗） | ✅ |
| 3 | §5.3-2 抽查访问记录核心操作 | 读 AdminModules visitors 分支 | AdminModules.vue:31（卡片分支 + 封禁/信任操作） | ✅ |
| 4 | §5.3-2 抽查用户管理核心操作 | 读 AdminExtras users 分支 | AdminExtras.vue:4–17（卡片全操作 + 新建用户抽屉 + 分页） | ✅ |
| 5 | §5.3-2 抽查系统设置核心操作 | 读 AdminModules settings | AdminModules.vue:80–83（保存设置/搜索/分组 tabs；:556 tabs 横滚） | ✅ |
| 6 | §5.3-2 抽查操作日志核心操作 | 读 AdminLogs | AdminLogs.vue:26–179（5 tab 卡片 + 筛选 + 分页 + 展开） | ✅ |
| 7 | §5.3-3 卡片字段与桌面表格一致 | 字段逐列比对 | 用户卡 AdminExtras.vue:10 vs 表:5；回收站卡 :25 vs 表:20；会话卡 :89 vs 表:84；Steam 卡 :57 vs 表:36–41；日志卡 AdminLogs.vue:26,53,81 vs 表:15–22,39–50 | ✅（email_verified 标签未上卡片，见风险提醒） |
| 8 | §5.3-3 批量吸底条计数与执行回执正确 | 共用选择集 + BulkBar 计数 + 回执 | useBulkSelection.js:16–30（count=selectedKeys 去重）；AdminExtras.vue:7/22/86 与桌面 5/20/84 同一 sel.*；BulkResultDialog :98 | ✅ |
| 9 | §5.3-4 表单全屏弹窗保存成功、取消不写库 | 取消按钮只关弹窗；保存逻辑未改动 | AdminExtras.vue:15（取消 → visible=false）；main.css:41–42 全屏 CSS；EP 2.14.7 dialog.mjs appendToBody 默认 false、frontend 无 append-to-body 用法（grep 0 处）→ `.m-shell .el-dialog` 选择器生效 | ✅ 静态 + 🔎 真机保存/取消实测 |
| 10 | §5.3-4 危险操作有确认 | grep confirm/promptBulkConfirm | AdminExtras.vue:195,206,218,236；useBulkSelection.js:81–103 | ✅ |
| 11 | §5.3-5 桌面端 /console 布局与现在一致 | diff 无桌面样式删除；表格/侧栏 v-if 保留 | git diff e970c2f..HEAD -- main.css（仅追加）；Console.vue:3；AdminExtras.vue:5,20,84；AdminLogs.vue:14,38,66,93 | ✅ + 🔎 桌面目视（header 多包一层 .admin-heading 无样式，见风险提醒） |
| 12 | §1 决策 9 ≤768px 走新结构 | Console 768 断点 vs 内容区断点 | Console.vue:69–72（≤768）；AdminExtras.vue:120（≤760）；AdminLogs.vue:218（≤760）；AdminModules.vue:132（760）+ :528（resize 监听 720） | ⚠️ 断点不一致（761–768 与 721–760 窗口走旧结构，见打回项 3 / 风险提醒） |
| 13 | §10 效果图 ④ ☰ 抽屉沿用 5 分组 | 抽屉内 .admin-nav 在 ≤760 的级联 | main.css @media≤760：`.admin-nav{flex-direction:row;overflow-x:auto;gap:5px}` `.nav-heading{display:none}` `.admin-nav button{width:auto;white-space:nowrap}`；BW 块 `.m-nav-drawer .admin-nav` 只覆盖 flex/overflow 未重置 flex-direction | ⚠️ 真机（≤760）抽屉变横向条带、分组标题隐藏（打回项 2） |
| 14 | §5.1 顶栏 ☰ + 当前模块 + 通知 | header-actions 结构 + 旧 CSS | Console.vue:36–44；main.css @media≤760：`.header-actions .el-button:first-child{display:none}` 命中 🔔 | ⚠️ 真机（≤760）通知铃被隐藏（打回项 1） |
| 15 | 重点自查：搜索框与待处理角标保留 | 抽屉模板 | Console.vue:20（el-input filter）、:24（appealsPending nav-count） | ✅ |
| 16 | 重点自查：批量三列表手机/桌面共用一个选择集 | has/toggle 与 onSelectionChange 同源 | AdminExtras.vue:139–143（sel.recycle/users/sessions）；useBulkSelection.js:33–49 | ✅ |
| 17 | 重点自查：BulkBar 在手机分支也渲染 | count `<BulkBar` | AdminExtras.vue:5,7,20,22,84,86（6 个）；test/admin-bulk.test.js:96（断言 6） | ✅ |
| 18 | 重点自查：el-dialog 未 append-to-body（CSS 生效前提） | grep append-to-body | frontend/src 0 处；EP 2.14.7 dialog/drawer teleport `disabled=!appendToBody`（默认 false） | ✅ |
| 19 | 重点自查：UserCreateDrawer/AnnouncementDrawer/AppealsAdmin 已是抽屉 | 读组件 | UserCreateDrawer.vue:2（min(560px,100vw)）；AnnouncementDrawer.vue:2–5（min(660px,100vw)）；AppealsAdmin.vue:147（isMobile?'100%'） | ✅ |
| 20 | 测试真锁住：新断言进主链且锁行为 | 读测试 + package.json | test/admin-console-mobile.test.js:16–53（768 断点/抽屉/卡片分支/桌面表格保留/吸底 CSS）；package.json test 链 86 文件（含新文件，位于 admin-console-ia 之后） | ✅（CSS 级联冲突未被锁，见打回项 4） |
| 21 | 纪律：无新增 tag | git tag 创建时间 | 最新 tag v2.17.0 / app-v2.16.0 均 2026-11-14，早于基线 | ✅ |
| 22 | 纪律：提交无构建产物/日志 | git show --stat | 605e05a 仅 11 个源码/文档文件 | ✅ |
| 23 | 纪律：已推 main | git status -sb | `## main...origin/main`（无 ahead/behind） | ✅ |
| 24 | 纪律：PROJECT-OVERVIEW 同步 | diff | docs/PROJECT-OVERVIEW.md:103 BW 行已加；REQUIREMENTS-INDEX.md:61 BW 行已同步 | ✅ |
| 25 | 查多：未碰前台 Home.vue / BU/BV/BX 条目 / 服务器配置 | git diff --name-only | 11 文件全部为 console 前端 + 测试 + 4 文档；TODO.md 仅 BW 状态行 | ✅ |

## 打回清单（按严重度排序，可执行：补什么、在哪补）

1. **通知铃在真机（≤760px）被隐藏**（必修）：`main.css` 旧媒体块 `.header-actions .el-button:first-child{display:none}`（Z 批遗留，之前因 span 在前而空转）现在命中 BW 新增的 🔔 按钮（Console.vue:44 是 .header-actions 第一个 el-button）。→ 改该规则为不命中（如加 `.m-shell` 例外 / 改成类名定位 / 在 BW 块补 `.m-shell .header-actions .el-button:first-child{display:inline-flex}` 类复位），并在 test/admin-console-mobile.test.js 加一条级联断言（如「main.css 中 header-actions first-child 规则必须排除 .m-shell」或改为断言 CSS 文件里 `.m-shell .header-actions .el-button:first-child` 存在 display 复位）。
2. **抽屉在真机（≤760px）丢失 5 分组结构与底部块**（必修）：旧媒体块 `.admin-nav{flex-direction:row;overflow-x:auto;gap:5px}`、`.nav-heading{display:none}`、`.admin-nav button{width:auto;white-space:nowrap;padding:8px 10px}`、`.admin-bottom{display:none}` 同时作用于抽屉内的同名 class（Console.vue:21–30）；BW 块 `.m-nav-drawer .admin-nav{flex:1;min-height:0;overflow:auto}` 未重置 flex-direction，也未恢复 nav-heading/admin-bottom。→ 在 BW 块补：`.m-nav-drawer .admin-nav{flex-direction:column;gap:4px}`、`.m-nav-drawer .admin-nav button{width:100%;white-space:normal}`、`.m-nav-drawer .nav-heading{display:block}`、`.m-nav-drawer .admin-bottom{display:flex;flex-direction:column}`；测试补断言「存在 .m-nav-drawer .admin-nav{flex-direction:column}」。
3. **断点不一致（761–768 / 721–760 窗口走旧结构）**（必修或说明）：Console 用 768，AdminExtras/AdminLogs 用 760，AdminModules 初始 760 但 resize 监听 720（AdminModules.vue:132 vs :528，预存问题）。规格 §1 决策 9「≤768 走新结构」。→ 建议统一为 768（AdminExtras:120 / AdminLogs:218 / AdminModules:132,528），并把 AdminModules 的 720 监听改为 768 或与 760 一致；若有意保留 760（表格卡片切换成本），在规格或 QA 争议项里由所有者拍板，但 761–768 窗口「m-shell 已生效 + 桌面表格」的组合至少要在代码里避免（卡片分支断点 ≤ shell 断点）。
4. **测试未锁 CSS 级联**（建议）：admin-console-mobile.test.js 只断言 CSS 字符串存在，未断言新旧规则冲突；第 1/2 项修复时同步补断言，防止再次假绿。

## 需人工确认（真机目视，本地无法验证，绝不硬判 ✅）

1. 验收 1/2 的真机操作：小米浏览器/Chrome 打开 /console，抽屉滑出、13 模块点选、5 个抽查模块的查看/筛选/分页/编辑保存/批量执行全链路（本地只有静态 + 构建证据）。
2. 验收 4 的交互实测：全屏弹窗「保存成功 / 取消不写库」（静态可证取消只关弹窗、保存代码未改动，但真机保存链路需走一遍）、sticky 吸底条是否遮挡最后一张卡、iOS Safari 上 `100dvh` 全屏弹窗表现。
3. 桌面端（≥1025px）目视：admin-header 新增 .admin-heading/.m-head-row 包裹层（无样式，理论不影响 .admin-header 的 flex 布局），建议随手过一眼。

## 争议项（待所有者裁定）

- 效果图 ④「后台首页」的**指标卡 + 任务健康 + 模块入口网格**：实现没有独立「后台首页」屏——默认进入「游戏管理」（自带 9 张指标卡）；「任务健康」在 操作日志 → 运行与同步 tab；模块入口由 ☰ 抽屉承担（列表而非网格）。规格 §5.1/§5.3 文本未定义独立首页，质检不判缺失；若所有者要求按效果图补首页屏，请先更新规格再派单。
- 卡片信息取舍：用户卡片未展示 `email_verified`（已验证/未验证）标签（AdminExtras.vue:10 vs 表:5），符合 §5.2「每卡 2–4 行关键信息」的裁剪原则，但严格对照验收 3 属字段精简；已按 ✅ 处理，如所有者在意可补。

## 复检记录

- 第 1 轮（2026-11-16）：基线 e970c2f → HEAD 9149a4c。重跑 `npm test`（86 文件链，exit 0，末文件 tests 5 / pass 5 / fail 0）、`npm run frontend:build`（✓ built in 2.46s）、`npm run scan`（✅ 无凭据）。判定 ⚠️ 有条件放行（通过 17 / 缺失 0 / 偏差 2 / 需人工确认 3），打回 2 项 CSS 级联必修 + 1 项断点必修或说明 + 1 项测试补锁建议；TODO 状态回写「质检打回」。修复后第 2 轮只重查打回项 + 新增 diff + `npm test` 兜底。
- 第 2 轮复检（2026-11-16）：基线 9149a4c → HEAD b54efd3（打回修复 8817207 + 状态回写 b54efd3；BY 批 92cae3e 由另一质检负责，不判）。**结论：✅ 放行（通过 19 / 缺失 0 / 偏差 0 / 需人工确认 3——真机 3 项沿用第 1 轮）**，功能清单 #2/#6 由 ⚠️ 改 ✅。逐项：
  - 打回项 ① 通知铃 ✅：Console.vue:44 铃铛加专属 class `m-bell`；main.css:54–55 追加 `.m-shell .header-actions .el-button:first-child{display:inline-flex}` 与 `.m-shell .header-actions .el-button.m-bell{display:inline-flex}`，位于文件末尾（偏移 16541+，旧规则偏移 8889 在 `@media(max-width:760px)` 内），特异性 (0,4,0) > 旧规则 (0,3,0)，顺序在后 → 真生效；构建产物 index css 验证两条规则已合并输出且位置正确；`.m-shell` 仅手机壳（Console.vue:2），桌面不受影响。
  - 打回项 ② 抽屉级联 ✅：main.css:50–53 追加 `.m-nav-drawer .admin-nav{flex-direction:column;overflow-x:visible;gap:4px}`、`.m-nav-drawer .admin-nav button{width:100%;white-space:normal}`、`.m-nav-drawer .nav-heading{display:block}`、`.m-nav-drawer .admin-bottom{display:flex}`，特异性 (0,2,x) 全部盖过旧 ≤760 规则 (0,1,x) 且追加在文件末尾；EP 2.14.7 编译源码确认 el-drawer 的 `$attrs`（含 class）合并到 `.el-drawer` 面板元素 → 后代选择器真实命中抽屉内容。
  - 断点统一 ✅（建议项核实）：AdminExtras.vue:120 / AdminLogs.vue:218 均 760 → 768（与 Console 一致）；AdminModules.vue:132 保持 760（Z 批遗留，按复检口径允许；:528 resize 监听 720 为预存问题，不在本批）。
  - 回归锁 ✅：test/admin-console-mobile.test.js:56–68 新增「级联修复」test（1 个 test 块、8 条断言：4 条抽屉规则 + m-bell class/CSS + 两组件 768 断点，全部直读源码文件锁行为；断言数多于要求，覆盖完整）。主链已含该文件。
  - 新增 diff：`git diff 9149a4c..HEAD` 全量过目——8817207 仅 5 个 BW 文件（25 增 3 删，CSS 仅追加无删除，无桌面回归）；b54efd3 仅 TODO/INDEX 状态行；无新增 tag、无构建产物/日志入提交、未碰部署配置。
  - 验证重跑：`npm test`（主链 exit 0 全绿；BW 文件 tests 5 / pass 5 / fail 0，含级联回归锁）、`npm run frontend:build`（✓ built in 3.51s，产物含全部级联规则）、`npm run scan`（465 文件 ✅ 无凭据）。
  - 观察项（不阻断）：① PROJECT-OVERVIEW.md:104 BW 行「4 项静态断言进主链」未随测试增至 5 项（轻微文档滞后，建议开发顺手改）；② 测试未断言 `.m-shell .header-actions .el-button:first-child` 复位规则本身（m-bell 主修复规则已锁，first-child 属双保险）。
  - 状态回写：docs/TODO.md 与 docs/REQUIREMENTS-INDEX.md 被另一会话（CB 批）占用（git status 显示在途未提交改动），按 HANDOVER §10 占用规则跳过回写——**状态回写待收尾复盘补：BW 应为「质检通过」**（TODO.md 状态行建议文案：`质检通过（2026-11-16，605e05a + 打回修复 8817207；QA 报告 docs/QA-CONSOLE-MOBILE-BW.md 第 2 轮 ✅ 放行；真机验收 3 项随部署侧）`；INDEX BW 行状态列改 `质检通过（2026-11-16，605e05a + 打回修复 8817207）`）。
