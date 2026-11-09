# QA：后台信息架构改版 AT 批（第 1 轮）

> 基线 f39b2b8 → HEAD 09f682d（主体 a500811）；判据 docs/ADMIN-CONSOLE-IA.md §11 验收 1–14；开发描述来源 docs/TODO.md AT 条目。
> 结论：✅ 放行 —— 通过 14 / 缺失 0 / 偏差 0 / 需人工确认 4（目视/真机类，代码与口径已核对）

## 功能清单（本批交付的全部功能，一条功能一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AT | 侧栏新增「日志审计 / 操作日志」菜单，移除「批量操作记录」「运行日志」，搜索可搜到 | 控制台侧栏 / 搜索框 | ✅ 已交付 | Console.vue:49-59；test/admin-bulk.test.js:96-98 |
| 2 | AT | 用户管理页只留列表 +「＋ 新建用户」右侧抽屉（不跳页、列表不刷新、关闭后筛选分页不丢） | 控制台 → 用户管理 → ＋ 新建用户 | ✅ 已交付 | AdminExtras.vue:4,8,82-86；UserCreateDrawer.vue:5,7 |
| 3 | AT | 新建用户成功 → 抽屉内一次性展示临时密码（可复制），关闭后列表出现新用户 | 同上 | ✅ 已交付 | UserCreateDrawer.vue:14-16,98,111；server.js:2799 |
| 4 | AT | `?section=users&drawer=new` 直达抽屉；刷新回列表 | URL | ✅ 已交付 | AdminExtras.vue:82-86,189,193 |
| 5 | AT | 站点通知页只留公告列表 +「＋ 新建通知 / 编辑」右侧抽屉（带前台预览、发布后列表立即出现、编辑字段回填） | 控制台 → 站点通知 | ✅ 已交付 | AdminModules.vue:50-52,405-426；AnnouncementDrawer.vue:21,115 |
| 6 | AT | `?section=announcements&drawer=new&id=…` 直达编辑抽屉 | URL | ✅ 已交付 | AdminModules.vue:405-426,481,484 |
| 7 | AT | 操作日志一页 5 tab：用户删除 / 批量操作 / Steam 账号 / 邮件发送 / 运行与同步（顶部条数、?tab= 直达、切 tab 懒加载+缓存） | 控制台 → 操作日志 | ✅ 已交付 | AdminLogs.vue:5,29,54,81,111,198,236 |
| 8 | AT | 用户删除 tab：按用户名搜索 + 上限 200 + 日期范围筛选 | 操作日志 → 用户删除 | ✅ 已交付 | AdminLogs.vue:229-237 |
| 9 | AT | Steam 账号操作审计：绑定/解绑/认领/同步库/同步愿望单/换 API Key/级联删除 7 类落库（失败带原因、含耗时）；用户被删后日志仍在 | Steam 账号页操作后 → 操作日志 → Steam 账号 | ✅ 已交付 | steam-accounts.js:48-60,108-127,168-186,220-234,428-438；pg.js（delete-cascade）；test/admin-console-ia.test.js:113-148 |
| 10 | AT | Steam 账号页「操作日志 ↗」入口 + 每行「日志」链接 | 控制台 → Steam 账号 | ✅ 已交付 | AdminExtras.vue:16,24 |
| 11 | AT | 邮件服务 3 tab（配置/模板/发送测试）+ 页头「查看发送记录 ↗」单一入口 | 控制台 → 邮件服务 | ✅ 已交付 | AdminExtras.vue:41-47 |
| 12 | AT | 发送记录保留验证码 / 通知两个子筛选 | 操作日志 → 邮件发送 | ✅ 已交付 | AdminLogs.vue:81-108,330 |
| 13 | AT | 系统设置折叠面板改 6 tab（与旧 6 分组一一对应、项数一致），搜索自动定位 tab，保存/未保存点/离开确认照旧 | 控制台 → 系统设置 | ✅ 已交付 | AdminModules.vue:60,441,462,484 |
| 14 | AT | 价格变化删除底部「近 7 天变化」表；悬停「变化」列即时弹该游戏近 7 天线图（7 天最低/当前/空态），无逐行额外请求 | 控制台 → 数据统计 → 价格变化 | ✅ 已交付 | AdminModules.vue:66,472；PriceSparkline.vue:41-59；server.js:2838 |
| 15 | AT | 旧书签 `?section=bulk-ops` / `?section=sync` / `?section=mail&tab=records` 自动落到操作日志对应 tab，不 404 | URL | ✅ 已交付 | Console.vue:59-70,109-111 |
| 16 | AT | Steam 日志保留 180 天自动清理（并入每周 prune，`--steam-days` 可调） | 调度器 prune 任务 | ✅ 已交付 | pg.js（purgeOldRows steamDays）；cli.js（cmdPrune）；test/admin-console-ia.test.js:151-166 |
| 17 | AT | 新接口 `GET /api/admin/steam-logs`（limit≤500/steamId/action/result/days，返回 entries+total，仅管理员）；`/api/admin/reports/price` 去 daily 加 series | API | ✅ 已交付 | server.js:3190；steam-log.js:60-97；test/admin-console-ia.test.js:179-203 |

## 逐条核对（规格 §11 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 侧栏无「批量操作记录」「运行日志」，新增「日志审计/操作日志」，搜索可搜到 | grep Console.vue；测试断言 | Console.vue:49-59（无两旧 label、有 op-logs）；admin-bulk.test.js:96-98 | ✅ |
| 2 | 用户管理页无新建表单，只有列表+「＋ 新建用户」；抽屉不跳页不刷新；?drawer=new 直达；关闭筛选分页不丢；刷新回列表 | grep + 静态核对 | AdminExtras.vue:4（无内嵌表单、按钮开抽屉不调 loadUsers）、8、82-86、189/193；test/admin-console-ia.test.js:250-259 | ✅（滚动位置真机目视见 🔎） |
| 3 | 新建成功 → 抽屉内一次性展示临时密码（可复制）→ 关闭后列表出现新用户 | grep + 接口核对 | UserCreateDrawer.vue:14-16,98,111；AdminExtras.vue:8（@created=loadUsers）；server.js:2766-2799（tempPassword） | ✅ |
| 4 | 站点通知无发布表单；「＋ 新建通知」开抽屉带预览；发布后列表立即出现；编辑同一抽屉回填；?drawer=new&id 直达 | grep + 静态核对 | AdminModules.vue:50-52（无 announcement-form）、405-426（resolveAnnouncementDrawer 等列表加载后按 id 回填）、481/484；AnnouncementDrawer.vue:21,115 | ✅ |
| 5 | 操作日志 5 tab 均可打开，数据与旧单页一致；?tab= 直达与刷新保持；切 tab 不重复请求 | grep + 接口清单核对 | AdminLogs.vue:5/29/54/81/111（5 tab）、198（loaded 缓存）、236/264/272/308/330/361（与旧页同接口）；test/admin-console-ia.test.js:232-248 | ✅ |
| 6 | 同步/解绑后日志立即出现（动作/账号/操作者/结果/耗时），失败也记录带原因；用户被删后日志仍在 | 函数级测试 + 埋点 grep | steam-accounts.js:32-69,73-140,159-193,199-241,423-445；server.js:1336/1400（绑定/认领）；pg.js deleteUserAudited 内 delete-cascade；test/admin-console-ia.test.js:113-148（含删除后 4 条仍在） | ✅ |
| 7 | 邮件服务只有 3 tab；「查看发送记录」跳操作日志·邮件发送，两个子筛选可用 | grep | AdminExtras.vue:41-47（3 tab + 41 入口）；AdminLogs.vue:81-108（验证码/通知子 tab） | ✅ |
| 8 | 系统设置 6 tab 与旧 6 分组一一对应，项数一致；搜「代理」定位「网络与代理」；保存/未保存点/离开确认仍生效 | grep + 逻辑核对 | AdminModules.vue:60（el-tabs over filteredGroups=settingsSchema.groups）、441（loadSettings 不变）、462（搜索自动切到第一个命中 tab）、484（registerUnsavedSource settings 保留） | ✅ |
| 9 | 价格变化底部无「近 7 天变化」表；悬停「变化」立即出现近 7 天线图（7 天最低/当前）；移开消失；无数据空态；无逐行额外 series 请求 | grep + 接口核对 | AdminModules.vue:66（popover+PriceSparkline，无 daily 表）、472（loadStats 一次拉 series）；PriceSparkline.vue:41-59；server.js:2828-2838（dailyMinSeriesBatch 一次查出） | ✅（hover 手感真机目视见 🔎） |
| 10 | 图表的 7 天最低值与详情页价格历史一致（抽 2 游戏对数） | 口径核对 | 两侧同源：daily_prices + p.kind in OFFICIAL_KINDS + region='cn'（pg.js dailyMinSeriesBatch vs dailyMinSeries；Home.vue 详情 series 同源） | 🔎 需人工确认（上线后抽 2 游戏对数；本地无真实数据） |
| 11 | 旧书签 bulk-ops/sync 自动落到 op-logs 对应 tab，不 404 | grep + 测试断言 | Console.vue:59-70、109-111；admin-bulk.test.js:97（映射断言） | ✅ |
| 12 | 移动端 ≤768：抽屉全屏、按钮吸底；tab 横向滚动；表格横向滑动无溢出 | grep + 样式核对 | UserCreateDrawer.vue:5（min(560px,100vw)）+ @media 768 sticky 按钮；AnnouncementDrawer.vue:5；AdminModules.vue:512（nav-wrap overflow-x）；AdminLogs.vue:189-192（m-console 沿用既有滑动提示体系） | 🔎 真机目视（结构已就位） |
| 13 | 未保存守卫：抽屉填一半点遮罩/✕/切菜单 → 弹窗；「保存并离开」创建成功并关抽屉；「放弃修改」清表单 | grep + 既有机制测试 | UserCreateDrawer.vue:68（registerUnsavedSource save=submit/discard=resetForm）、123（before-close→requestLeave）；AnnouncementDrawer.vue:85,130；test/unsaved-guard.test.js（断言改指向抽屉组件） | ✅ |
| 14 | npm test 全绿 / frontend:build / scan 无命中 / docs.test.js 链接不破 | 亲自重跑 | `npm test` → 74 个文件 exit 0；`frontend:build` → ✓ built in 1.24s；`scan` → ✅ 无凭据命中；docs.test.js 在主链内 | ✅ |

## 纪律固定检查项

1. `git tag --list`：无新增 tag（最新 v2.3.0，属 AS 批）✅
2. diff 未碰部署/服务器配置（无 compose/DEPLOY/凭据改动）✅
3. 构建产物未进提交（`git show a500811 --name-only` 无 dist/logs/pgdata/out）✅
4. 已推 main（a500811、09f682d）✅
5. docs/PROJECT-OVERVIEW.md 已同步（AT 行 + steam_account_logs 数据概念 + AH/AI 行落点更新）✅

## 查多（风险提醒，不判错）

- 提交 a500811 只含 AT 相关 hunk；工作区 images/D1 会话的未提交改动（cmdImages prune、pg_trgm、README 封面图缓存行）未混入，隔离正确。
- AnnouncementDrawer / UserCreateDrawer 随宿主页 v-if 挂载，未保存来源注册/注销与组件生命周期一致（原有机制，无新增风险）。

## 需人工确认

- 验收 10：7 天最低与详情页对数——口径已核对一致（同表同渠道同区服），本地无真实数据，上线后抽 2 游戏目视对数。
- 验收 12：真机（≤768）目视抽屉全屏/按钮吸底/tab 与表格滑动。
- 验收 2/9：滚动位置保持与 hover 弹出手感属浏览器行为，静态结构正确，建议上线后顺带目视。

## 打回清单

- 无。

## 复检记录

- 第 1 轮（2026-11-09）：初检即 ✅ 放行，无需复检。
