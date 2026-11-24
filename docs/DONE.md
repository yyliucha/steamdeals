# 已完成清单（已发布 / 已过时条目存档）

> 用途：承接从 [TODO.md](TODO.md) 移入的**已完成需求**——状态为 `已发布 vX.Y.Z` 或 `已过时` 的整段条目。
> 规则（2026-11-18 所有者新规）：条目发布后由 `steamdeals-build` 会话把它从 TODO **移入本清单**（保留原文与状态行）；
> 判定「已过时」由需求会话移入。本清单**只读追溯**，不再改状态。
> 待办一律看 [TODO.md](TODO.md)；全部批次总账看 [REQUIREMENTS-INDEX.md](REQUIREMENTS-INDEX.md)。

---

## FE. ~~个人资料 Steam 账号——同步按钮 + 按钮样式~~ → 已发布 v2.28.9

**类型：** ⚙️ 调整（EZ 发布后补全）
**状态：** 已发布 v2.28.9（2026-11-24，实现 0bc2733 + release 3f45cee；tag 重打 04159dde；QA [QA-FE.md](QA-FE.md) 第 1 轮 ✅ 通过 5/缺失 0/偏差 0/需人工确认 2=真实 Steam 成功链路、截图目视）
**优先级：** P2
**依赖：** EZ（已发布 v2.28.7）、EM（同步异步化已发布）
**解锁：** 无
**规格**：[PROFILE-STEAM-ACTIONS.md](PROFILE-STEAM-ACTIONS.md)

- **需求**：① Steam 账号 Tab 每账号加「同步游戏库 / 同步愿望单」按钮（普通用户本人可用；异步 202 + 轮询
  sync-status；无 API Key 给提示）；② 该页四个按钮改站内 el-button 样式（不得原生）。
- **验收**：见规格 §3（同步可用/提示/样式统一/手机端/测试全绿）。
- **实现**：ProfilePage.vue 每账号操作区加两个同步按钮（202 触发 → 2s 轮询 sync-status 最长 60s →
  完成后 loadLibrary 刷新统计；同步中「同步中…」加载态；无 Key 提示「该账号缺少 API Key，请先配置」；
  手机端操作区 2×N 网格 + 触摸目标 ≥44px）；按钮样式经源码/注册/产物排查为 el-button（无覆盖样式），
  headless Chrome 实测计算样式（圆角 3px + 边框 + 白底）与 DOM 断言确认非原生；接口权限不变（后端未改）。

## FC. ~~调度器 compose 文件级拆分——app 与 scheduler 两个文件独立发布~~ → 已发布 v2.28.8

**类型：** 🧹 技术债（部署架构拆分；业务不剥离）
**状态：** 已发布 v2.28.8（2026-11-23，实现 5ef3c2c + release ecf2362；QA [QA-FC.md](QA-FC.md) 第 1 轮 ✅ 通过 8/缺失 0/偏差 0/需人工确认 2=服务器实跑）
**优先级：** P1
**依赖：** 无（EV 批 scheduler 独立服务已发布 v2.28.3，本条目在其上拆文件）
**解锁：** 无
**规格**：[SCHEDULER-COMPOSE-SPLIT.md](SCHEDULER-COMPOSE-SPLIT.md)

- **需求**：app 与 scheduler 拆成两个 compose 文件（compose.hub.yaml + compose.scheduler.hub.yaml，\n  独立项目名 + external 网络连 db），发版命令两套互不牵连——app 发版不重建 scheduler、scheduler 升级只动\n  scheduler 文件；只拆生产变体一份（B1 档），其余 4 个变体保持现状；业务不剥离（同镜像 / 同 ./data ./logs / 同库）。
- **实现**：见规格 §3/§4（compose 拆分与网络、scripts/scheduler-service.sh 双 compose 上下文）。
- **验收**：见规格 §6（8 条；含 docs/DEPLOY.md「命令与文件归属」表——后续调整按表找文件与命令、\n  env 双份同步提醒、部署侧验证清单）。

## EZ. ~~个人资料页精简——3 个 Tab（基本信息 / Steam 账号 / 偏好与统计）~~ → 已发布 v2.28.7

**类型：** ⚙️ 调整（前台个人资料页布局合并）
**状态：** 已发布 v2.28.7（2026-11-23，实现 8eeb1f4 + release b5bb9ab；QA [QA-EZ-FA.md](QA-EZ-FA.md) 第 1 轮 ✅ 通过 11/缺失 0/偏差 0/需人工确认 1=截图目视）
**优先级：** P2
**依赖：** 无
**解锁：** 无
**规格**：[PROFILE-PAGE-SLIM.md](PROFILE-PAGE-SLIM.md)（demo：docs/design/profile-tab-demo.html/.png）

- **方案（Tab）**：el-tabs 三个 Tab（基本信息 / Steam 账号（绑定+游戏库合并）/ 偏好与统计）+ 保存固定底部；\n  手机端 Tab 横向滚动 + 底部固定保存；按钮全部用 el-button（不用原生按钮）；demo 见规格。
- **验收**：见规格 §4（Web/手机与 demo 一致；功能不变；测试全绿；截图对照）。

## FA. ~~用户菜单新增「切换账户」~~ → 已发布 v2.28.7

**类型：** ⚙️ 调整（后台用户菜单 + 登录流程）
**状态：** 已发布 v2.28.7（2026-11-23，实现 8eeb1f4 + release b5bb9ab；QA [QA-EZ-FA.md](QA-EZ-FA.md) 第 1 轮 ✅）
**优先级：** P2
**依赖：** 无
**解锁：** 无
**规格**：[PROFILE-PAGE-SLIM.md](PROFILE-PAGE-SLIM.md) §3 菜单示例（demo 底部）

- **需求**：Console 用户菜单（个人资料/修改密码/返回网站/退出登录）新增「切换账户」；保留「退出登录」。
- **行为**：
  - 切换账户：退出当前会话 → 跳登录页（提示「切换账户」）→ 登录成功后回到 Console（或原页面）；
  - 退出登录：保持现状（退出 → 首页）。
- **实现**：`Console.vue` 用户菜单加项；登录页支持 `?switch=1` 提示；`/api/auth/logout` 复用。
- **验收**：切换账户清会话并跳登录、登录后回 Console；退出登录回首页；菜单顺序与 demo 一致；
  `npm test`（分段）+ `frontend:build` + `scan` 全绿。

## EW. ~~前台愿望单显示 Steam 账号——卡片/详情/我的愿望单只读展示~~ → 已发布 v2.28.5

**类型：** ⚙️ 调整（前台展示；恢复 v2.9.0 前「显示账号」只读能力）
**状态：** 已发布 v2.28.5（2026-11-23，实现 0fcde48 + 修复 9a65cc2 + release c39cd9f；QA [QA-EW.md](QA-EW.md) 第 1 轮 ✅ 通过 7/缺失 0/偏差 0/需人工确认 2）
**优先级：** P2
**依赖：** 无（DT-2 的 /api/me/wishlist 基础上扩展）
**解锁：** 无
**规格**：[WISHLIST-STEAM-ACCOUNT.md](WISHLIST-STEAM-ACCOUNT.md)（demo：docs/design/my-wishlist-steam-account-demo.html/.png）

- **需求**：两层愿望单已支持（① Steam 同步 ② 手动添加）——本条目补展示：前台游戏**卡片/详情**显示
  `wishlisted_by` 账号名（多个、>2 折叠 +N）；「我的愿望单」加「Steam 账号」列（接口补 `steam_accounts`）；
  只读、不写回 Steam。
- **实现**：`/api/me/wishlist` 行附加 `steam_accounts`（steam_wishlist join steam_accounts，按 user 限定）；
  UserSections.vue 桌面列 + 移动卡片行；Home.vue 卡片底部信息行/移动标签区 + 详情弹窗「愿望单账号」；
  `WISHLISTED_BY_SQL` 展示名改 `nullif(btrim(alias))` 回退口径（9a65cc2）。
- **验收**：见规格 §5（单/多/无来源三种显示；只读；越权不可见；测试全绿）。
- **验证**：wishlist-site-only 11/11 + steam-accounts 16/16 + watchlist-user 13/13 + admin-console-ia 22/22 +
  game-search-read-model/exact 0 失败 + frontend:build ✓ + scan 干净 + headless Chrome 实渲染 11/11 断言
  （截图 F:\dsh\ew-shots\ew-01~06.png：卡片/详情/我的愿望单三处 × 单账号/多账号/无来源三态）。

## EX. ~~v2.28.3 backfill 回归——countBackfillCandidates 传参错误~~ → 已发布 v2.28.5

**类型：** 🐞 缺陷（B4/cli 拆分回归）
**状态：** 已发布 v2.28.5（2026-11-23，修复 08eab51 + release c39cd9f；v2.28.4 CI 红未发布，v2.28.5 补发）
**优先级：** P0 —— 生产 backfill 任务每次调度失败（q is not a function）+ 失败邮件
**依赖：** 无
**解锁：** 无
**规格**：CHANGELOG 2.28.4 修复节

- **根因**：B4/cli 拆分后 `src/cli/ops.js` 把 store 对象传给 `db.countBackfillCandidates(q)`，
  该函数按 q 函数调用 → `TypeError: q is not a function`（生产 scheduler 日志 + 失败邮件）。
- **修复**：ops.js 显式传 `s.query`；`pg.js` 兼容 `q 函数 / store({query})` 两种调用；
  `test/backfill-throughput.test.js` 增加 store 调用回归用例（反向自检）。
- **验收**：backfill-throughput/backfill 测试通过；`npm run scan` 通过；api.test 通过；上线后 backfill 任务成功。

## EU. ~~定时任务重启韧性——发版不影响定时服务~~ → 已发布 v2.28.3

**类型：** 🐞 缺陷（重启打断长任务 → 误报失败 + 丢进度）
**状态：** 已发布 v2.28.3（2026-11-23，实现 3c6d752；QA [QA-EU.md](QA-EU.md) 第 1 轮 ✅ 通过 5/缺失 0/偏差 0/需人工确认 2）
**优先级：** P1 —— 每次发版都可能误报 + 长任务重跑
**依赖：** 无
**解锁：** EV（部署架构依赖 EU 的重启韧性，已随本批发布）
**规格**：[SCHEDULER-RESTART-RESILIENCE.md](SCHEDULER-RESTART-RESILIENCE.md)

- **根因**：`scheduler.stop()` 直接 SIGTERM/KILL 子进程（不等待）→ code -1 → 判 failed 并发邮件；
  `completeJob` 查失败原因时池已 end（错 `Cannot use a pool`，次生噪音）；steam-prices 单轮 106 分钟。
- **方案**：EU-1 中断标记（interrupted 不记失败/不告警）；EU-2 steam-prices 分批 5000 + 断点续跑；
  EU-3 发版避让（部署前检查长任务/等待或跳过，写入 DELIVERY/部署脚本）；EU-4 日志降噪。
- **验收**：见规格 §4（模拟重启显示 interrupted 不告警；分批续跑；部署文档含避让；重启后恢复；测试全绿）。

## EV. ~~调度器独立进程化 + 一键安装/删除~~ → 已发布 v2.28.3

**类型：** ⚙️ 调整（部署架构：调度器与 app 分离）
**状态：** 已发布 v2.28.3（2026-11-23，实现 8dcd41a；QA [QA-EV.md](QA-EV.md) 第 1 轮 ✅ 通过 5/缺失 0/偏差 0/需人工确认 2）
**优先级：** P1 —— 发版不影响定时服务（与 EU 配套）
**依赖：** EU（重启韧性，已随本批发布）
**解锁：** 无
**规格**：[SCHEDULER-AS-SERVICE.md](SCHEDULER-AS-SERVICE.md)

- **方案**：app 改 `command: ["serve"]` 只跑 Web/API；新增独立 `scheduler` service（`node src/scheduler.js`）；
  `scripts/scheduler-service.sh install|remove|status`（remove = 一键删除所有任务：停容器 + 删配置/状态）；
  发版只重启 app、不动 scheduler；防双调度器（切换时确认旧 all 容器已停）。
- **验收**：见规格 §4（app 无调度日志；重启 app 任务不中断；remove 一键清空；无双调度器；测试全绿）。

## EJ. ~~昵称显示规则统一——有昵称显示昵称，无昵称显示用户名~~ → 已发布 v2.27.7

**类型：** ⚙️ 调整（展示口径统一，Web + App）
**状态：** 已发布 v2.27.7（2026-11-20，站点 f340d78 + 8d72320，release 提交见 git log；App 仓库 6254978 随 app-v2.24.2（22402）；QA docs/QA-EJ.md 第 1 轮 ✅ 通过 5/缺失 0/偏差 0/需人工确认 0）
**优先级：** P2 —— 显示一致性
**依赖：** 无
**解锁：** 无
**规格**：[DISPLAY-NAME-RULE.md](DISPLAY-NAME-RULE.md)
**涉及 App 仓库：** 是（App 提交 6254978，随 `app-v2.24.2` 发布）

- **规则**：显示名 = `displayName`（昵称非空）? 昵称 : `username`；前端与手机端所有用户可见位置统一。
- **现状问题**：① App `MeScreen.kt:154` 只显示用户名（有昵称也不显示）；② Web 后台用户管理列表列 `username`
  （接口已返回 `display_name`）；③ AdminExtras 用户卡片已合规（推广）；④ 会话/提醒/愿望单/前台用户菜单待核。
- **范围**：App MeScreen 显示名改 `displayName ?: username`（ProfileEdit 同步）；Web 后台各用户列改
  `display_name || username`（接口缺字段则服务端补 SELECT）；前台「我的」昵称优先。
- **验收**：见规格 §4（有昵称显示昵称/空则用户名；两端一致；认证仍用 username；App 构建 +
  `npm test`（分段）+ `frontend:build` + `scan` 全绿）。
- **实现备注**：另外修掉两处既有偏差——前台 Home/Console 读 `user.display_name` 而 `/api/me` 返回 `displayName`；
  App 头像首字对空白昵称不判空。两端截图与逐条证据见 [QA-EJ.md](QA-EJ.md)。
## DX. ~~列表/站点接口性能优化~~ → 已发布 v2.27.8

**类型：** 🧹 技术债（性能）
**状态：** 已发布 v2.27.8（实现 090af4c；QA docs/QA-DX.md 第 1 轮 ✅ 6/0/0/1；部署后按 DELIVERY 复测 P95）
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

## ED. ~~test-main 加文档路径忽略（纯文档提交不跑测试）~~ → 已发布 v2.27.8

**类型：** 🧪 测试基建（CI 效率）
**状态：** 已发布 v2.27.8（实现 143d97e；QA docs/QA-ED.md 第 1 轮 ✅ 4/0/0/0）
**优先级：** P3 —— 省 CI 时间，不影响功能
**依赖：** 无
**解锁：** 无
**规格**：本条目正文（workflow 配置小改，无独立规格）

- **背景**：2026-11-19 夜班期间多次文档提交（B4-QUEUE/ANDROID-POLISH/DELIVERY 等），test-main 每次 push
  都触发并被 concurrency 取消重跑（当晚 十几次 cancelled），浪费 CI 时间。
- **方案**：.github/workflows/test-main.yml 的 on.push 加 paths-ignore：
  docs/**、**/*.md、CHANGELOG.md、data/**（**不能忽略**：src/**、frontend/**、test/**、
  scripts/**、package.json、package-lock.json、.github/**）。docker-hub/docker-tcr 只在 tag 触发，不动。
- **验收**：① 只改 docs 的提交不触发 test-main（gh run list 确认）；② 改 src/package.json 仍触发；
  ③ workflow 语法有效（push 后 Actions 正常解析）；④ 连续文档提交不再产生 cancelled run。

## EH. ~~同步逻辑去 cn（内容类链路：steam-status + discovery）~~ → 已发布 v2.27.8

**类型：** ⚙️ 调整（同步区域口径）
**状态：** 已发布 v2.27.8（实现 897476c 已随 v2.27.6 镜像成像；2026-11-20 QA docs/QA-EH-EI.md 第 1 轮 ✅ 放行 9/0/0/2 后本批补发版记录）
**优先级：** P1 —— 内容数据完整性（成人/锁区内容被国区过滤）
**依赖：** EF（元数据已去 cn，本条目补状态/发现链路）
**解锁：** 无
**规格**：[STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md) §10

- **范围**：① `src/steam-status.js:173` 状态/分级 appdetails `cc=cn`→`cc=us`（失败兜底 cc=hk 判锁区保留）；
  ② `src/discovery.js:38/86` 搜索 `cc=cn`→`cc=us`；③ 注释/文档同步；
  **价格链路（steam.js/backfill/sync steam-prices）保持 cc=cn 不动**（国区报价是业务核心）。
- **验收**：见规格 §10（分级覆盖提升；候选集含国区不显示游戏；价格仍国区口径不变；`npm test`（分段）+ `scan` 全绿）。

## EI. ~~同步双区域配置（内容统一美国 + 本位币可配置默认中国）~~ → 已发布 v2.27.8

**类型：** ⚙️ 调整（同步区域/货币配置化）
**状态：** 已发布 v2.27.8（实现 897476c 已随 v2.27.6 镜像成像；2026-11-20 QA docs/QA-EH-EI.md 第 1 轮 ✅ 放行 9/0/0/2 后本批补发版记录）
**优先级：** P1 —— 数据完整性 + 未来国际化
**依赖：** EF（元数据 cc=us）、EH（状态/发现去 cn）——本条目把区域统一配置化
**解锁：** 无
**规格**：[STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md) §11

- **设计**：两套区域——`sync.contentRegion`（默认 **us**，内容采集/绕过锁区）+ `site.baseRegion`（默认 **cn**，
  价格/比价口径）+ `site.baseCurrency`（默认 **CNY**）；内容拿全量、价格拿本位币区域金额。
- **范围**：① 内容链路（steam-meta/steam-status/discovery）读 contentRegion；② 价格链路（steam.js/sync/backfill）
  读 baseRegion+baseCurrency；③ 前台默认 region 读配置；④ settings 暴露三项配置；⑤ 日志双区域。
- **验收**：见规格 §11（默认内容 us/价格 cn；切 baseRegion=us+USD 生效；前台跟随；分级覆盖提升；
  `npm test`（分段）+ `scan` 全绿）。

## EK. ~~App Release 同步资产下载支持专用代理（有代理走代理，无代理直连 GitHub）~~ → 已发布 v2.27.8

**类型：** 🐞 缺陷（线上同步失败：大陆直连 GitHub 资产域名超时）
**状态：** 已发布 v2.27.8（实现 cc4fcf5；QA docs/QA-EK.md 第 1 轮 ✅ 通过 6/缺失 0/偏差 0/需人工确认 1）
**优先级：** P1 —— 线上 `app-release-sync` 每 15 分钟连续失败，App 发版信息无法更新
**依赖：** 无
**解锁：** 无
**规格**：[APP-RELEASE-SYNC-PROXY.md](APP-RELEASE-SYNC-PROXY.md)

- **现象（2026-11-20 线上）**：`app-release-sync` 连续失败 `reason=apk_download / latest_download`、
  `message="The operation was aborted due to timeout"`——大陆服务器直连
  `release-assets.githubusercontent.com` 超时（实测宿主机 756B 需 3.3s，波动撞 10s 下载超时线）。
- **方案**：`src/settings.js` 新增 `network.appSyncProxy`（secret，env `APP_RELEASE_SYNC_PROXY`）；
  `src/app-release.js` 三件套下载（latest.json / APK / sha256）配置非空时走 `undici.ProxyAgent`
  （复用 http.js `proxyAgentOptions`，零新依赖）且该次超时 30s；留空保持现状（全局 fetch、10s 直连）。
- **不做**：调度频率、githubApkUrl 兜底、前端。
- **验收**：见规格 §6（6 条；含代理/直连/反向自检/代理不可用场景 +
  `test/app-release.test.js` / `test/app-release-sync.test.js` / `test/settings.test.js` + `frontend:build` + `scan`）。

## EL. ~~后台「添加/编辑」统一弹窗~~ → 已发布 v2.27.8

**类型：** ⚙️ 调整（后台交互规范）
**状态：** 已发布 v2.27.8（实现 e0821f9；QA docs/QA-EL.md 第 1 轮 ✅ 通过 5/缺失 0/偏差 0/需人工确认 2）
**优先级：** P2 —— 交互一致性
**依赖：** 无（用户角色编辑并入 DT-3，不重复）
**解锁：** 无
**规格**：[ADMIN-EDIT-DIALOG.md](ADMIN-EDIT-DIALOG.md)

- **交付（2026-11-20，e0821f9）**：EL-1/EL-2 IP 黑/白名单添加改「添加黑名单/添加白名单」按钮 + 弹窗（IP/备注/确认）；
  EL-3 站点通知新建/编辑 AnnouncementDrawer 抽屉→el-dialog（表单一致、before-close 脏确认、URL 直达保留）；
  EL-4 Steam 专用代理内联 proxy-editor→弹窗编辑（列表增删/上移下移/清空/健康状态表/立即检测/保存回写，脏草稿并入未保存守卫）；
  EL-5 通用出网代理/App 同步专用代理内联输入→「编辑」按钮 + 弹窗（掩码显示已设置/尚未设置、http/https 校验、留空保持、清除直连、查看当前值）；
  EL-6 申诉处理抽屉→弹窗（处理表单在弹窗内、动作放 footer）。移动端 ≤768px `.m-shell` 全宽；
  交互真机级验证（headless Chrome CDP 20/20：弹窗打开/保存 API 回读/非法值拦截不关弹窗/移动端 390px 全宽）+ 截图对照
  `F:\dsh\el-shots\{before,after}`。
- **范围（排查依据：frontend/src grep el-dialog/el-drawer/inline-form）**：
  EL-1 IP 黑名单添加（内联→弹窗）、EL-2 IP 白名单添加（内联→弹窗）、EL-3 站点通知新建/编辑（抽屉→弹窗）、
  EL-4 设置 Steam 专用代理编辑（内联→弹窗）、EL-5 通用/App 同步代理编辑（内联→弹窗）、
  EL-6（可选）申诉处理抽屉→弹窗。
- **保留**：搜索栏 inline-form、只读查看抽屉（审阅记录/游戏链接）、前台弹窗。
- **验收**：见规格 §5（全部为弹窗、功能一致、移动端全宽、`npm test`（分段）+ `frontend:build` + `scan` 全绿）。

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
| D1 | `pg_trgm` 搜索索引 | **已落地（2026-11-09，见 AU）**：3 条表达式 GIN 索引随 migrate 建，生产待 `EXPLAIN` 复核是否命中 |
| D2 | 图片缓存总量上限 | **已落地（2026-11-09，见 AU）**：`images.maxBytes` + `images prune --max-bytes` + pull 后自动清理 |
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


## F. ~~待实施：Steam 价格同步优化~~ → **已发布 v2.2.1（2026-11-09）**

**状态：已发布 v2.2.1（2026-11-09，f32e2b9；QA 报告 docs/QA-STEAM-PRICES-F.md）**（① 限速 1100→1600；② 热点优先 + 冷门降频。方案见下方两条）。

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

**状态：方案 A 已实现并发布 v1.8.0（2026-11-03）**（见 [docs/STEAM-DLC.md](STEAM-DLC.md)；v2.14.0 起由 BP 提供「不含拥有状态」的 DLC 列表）。

- 现象：后台「Steam 账号」页 DLC 恒为 0；某行显示 `0*`。
- 根因：`IPlayerService/GetOwnedGames` **只返回游戏、不含 DLC 拥有记录**（Steam 公开 API 无此数据），
  当前 DLC 数依赖 `steam_games` 中出现 `app_type='dlc'` 的行 → 天然 0。`*` = 前端 `type_unknown>0`
  的标记（拥有条目在 CN 商店取不到类型，锁区/下架，`backfillOwnedAppTypes` 也补不上）。
- **方案 A（已实现）**：删除「DLC」列与 `*` 标记，账号列表上方加说明「Steam API 不返回 DLC 拥有数据」；
  同步提示去掉"其中 DLC N 款"；`type_unknown` 只留日志；STEAM-ACCOUNTS/README 已知限制已补。
  不采用方案 B（可购买 DLC 总和，误导）与方案 C（Steam 登录态 cookie，安全代价高）。
- 验收：见 [docs/STEAM-DLC.md](STEAM-DLC.md) §5。


## I. ~~待开发：2026-11-03 需求批次~~ → **已实现并发布（v1.8.0，2026-11-03）**

**状态：已发布 v1.8.0（2026-11-03）**（见 [docs/UX-BATCH-2026-11-03.md](UX-BATCH-2026-11-03.md)）。

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

**状态：已过时（被后面 K 段 v1.10.0 覆盖）**（见 [docs/MOBILE-VIEWPORT.md](MOBILE-VIEWPORT.md)）。

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

**状态：已过时（回退链缺陷由 N 段 v1.12.1 修复；申诉邮箱设置并入 O 段「邮件服务页」v1.12.1）**（见 [docs/APPEAL-EMAIL.md](APPEAL-EMAIL.md)）。

- 现象：SMTP 已配置，但封禁/申诉页提示「站点尚未配置申诉邮箱」。
- 根因：`server.js` 的 `appealEmail()` 用 `??` 链，`hydrateSettings` 把 `ALERT_EMAIL_TO` 写成**空字符串**
  后 `??` 不再回退，导致 `SMTP_FROM`/`SMTP_USER` 有值也用不上。
- 修复：回退链改 `||` 并补 `SMTP_USER`（抽成 `src/appeal.js` 便于单测）；新增设置
  `alerts.appealEmail`（`APPEAL_EMAIL`，「邮件与提醒」分组，留空回退）；测试 51→52 + 新增 appeal 用例。
- 线上立即恢复：compose 加 `APPEAL_EMAIL=yyliucha@163.com` 并重启（发版前唯一可靠方式）。


## N. ~~待开发：邮件配置合并到「邮件服务」页（方案 A 已确认）~~ → **已过时（被后面的 N 段覆盖）**

> ⚠️ 重复条目：后者「N. 已实现并发布 v1.12.1」才是唯一事实。

**状态：已过时（被后面 O 段 v1.12.1 覆盖）**（见 [docs/MAIL-CONFIG-PAGE.md](MAIL-CONFIG-PAGE.md)）。

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


## O. ~~待开发：申诉系统改造——服务端受理 + 后台申诉管理~~ → **已发布 v2.16.0**

> ⚠️ 重复条目：前者「O. 已实现并发布 v1.12.1」指历史邮件配置批；本段是申诉系统改造（以本段为准）。

**状态：已发布 v2.16.0（2026-11-14；实现 7c15e50 + 修复 0576bc7；QA 报告 docs/QA-APPEAL-OBQ.md 第 2 轮 ✅ 放行）**。

- 现状：申诉页用 `mailto:` 依赖用户本地邮件客户端；邮件只能人工处理；封禁页邮箱是页面快照（旧页面会发到旧地址）。
- 目标：`POST /api/appeal` 入库（编号/IP/设备/原因/联系邮箱/说明）+ 通知管理员邮件；
  后台「访问与安全 → 申诉管理」列表 + 详情 + 处理（解封 IP/设备/两者/拒绝+理由/仅备注）；
  处理结果回邮件通知申请人；联系邮箱必填；每 IP 每小时 3 条 + 图形验证码。
- 关键点：`/api/appeal` 要在封禁拦截里放行；邮件 `From` 用 SMTP 账号、`Reply-To` 用申请人邮箱；
  SMTP 未配置不影响入库；处理动作联动现有解封逻辑（ip_blacklist / ip_abuse / device_bans）。
- 依赖：先修封禁页跳转（FRONTEND-RENDER-FIX §2）。验收见文档 §8。
- 开发汇报（O + BQ 合并版）：[DEV-BRIEF-APPEAL.md](DEV-BRIEF-APPEAL.md)
- 落地内容（2026-11-14，含 BQ）：`appeals` 表（含 token 三列）+ 4 索引；`POST /api/appeal`
  （邮箱/说明/验证码/3 条每小时/同内容幂等/AP-XXXXXX/SMTP 未配也入库）+ 封禁拦截放行；
  管理员通知邮件（回退链收件人、From=SMTP、Reply-To=申请人、写 mail_log）；后台列表/详情抽屉/
  5 动作联动解封/409 并发保护；`GET /api/appeal/:code` 查进度；申诉页去 mailto 改站内提交；
  侧栏「申诉管理」带待处理角标；`POST /api/appeal/action`（preview/trust/reject，POST-only，
  每 IP 10 次/分，错误统一 404，日志不写 token）；邮件内信任/拒绝两按钮（token 在 fragment）；
  确认页 `/appeal/act`（登记 FRONTEND_PAGES + serve.test 一致性）；与后台共用状态机先到先得。
  测试 `test/appeal-system.test.js` 16 项（真 PGlite + 真 HTTP + 假 SMTP）进主链。


## P. ~~待开发：后台功能对齐（设备 tab + 合并重复游戏 + 同步历史 + 回填进度）~~ → **已过时（被后面的 P 段覆盖）**

> ⚠️ 重复条目：后者「P. 已实现并发布 v1.13.0」才是唯一事实。

**状态：已过时（被后面 P 段 v1.13.0 覆盖）**（见 [docs/ADMIN-PARITY.md](ADMIN-PARITY.md)）。排查方法：后端 40 个 admin 路由 vs 前端调用 36 个做差集 + 旧 `web/console.html` 逐项对照。

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


## W. ~~待开发：手机端 PWA（像 App 一样打开）~~ → **已实现并发布 v1.16.0（2026-11-05）**

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


## X. ~~待开发：调度器长任务阻塞修复（重任务 await 饿死全部任务）~~ → **已实现并发布 v1.16.1（2026-11-05）**

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


## Z. ~~待开发：手机端适配修复（vw 逃逸 + 安装提示 + 后台卡片化）~~ → **已实现并发布 v1.16.2（2026-11-06）**

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


## AA. 添加愿望单推送 Steam 失败（根因已定案，方案 A 已实现并发布 v2.5.0）

**状态：方案 A 已实现并发布 v2.5.0（2026-11-09，随 AU 批，785670b；QA 报告 docs/QA-AU-D1D2AA.md）；根因定案（2026-11-09 线上日志：`HTTP 401 → api.steampowered.com`）。**
开发描述见 [WISHLIST-OAUTH.md](WISHLIST-OAUTH.md) §3/§4（只改前端文案 + 文档同步；不投入 OAuth 改造、不动凭据模型）。
§4 六项产品缺陷修复批已随 **v2.2.0 发布**（2026-11-09，5b59bfa；QA 报告 docs/QA-WISHLIST-AA.md）。
本条目剩余：方案 A「诚实提示」的文案改动**已随 AU 交付（2026-11-09）**，见 AU 条目。

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


## AK. ~~待开发：密码系统重设计（AK-1 策略与哈希 / AK-2 登录防护 / AK-3 账号流程）~~ → **已实现并发布 v2.1.0（2026-11-09）**

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


## AL. ~~待开发：登录 / 注册 / 改密页面~~ → **已实现并发布 v2.1.0（2026-11-09）**

**状态：已发布 v2.1.0（2026-11-09，77c02e5）**
**依赖：** AK-3
**解锁：** 无
**规格**：[AUTH-REDESIGN.md](AUTH-REDESIGN.md) §5 / §8 验收 10

- **需求**：登录从首页弹窗改成**独立 `/login`**（桌面左右分栏、移动单列），新增 `/register`、`/change-password`；
  密码可见切换、Caps Lock 提示、错误就地显示、记住我 7/30 天、登录回跳只允许站内路径。
- **验收**：见规格 §8 的 10。


## AM. ~~待开发：Steam 代理池（多代理按序自动切换 + 健康状态）~~ → **已实现并发布（AM-1 v2.0.0 / AM-2 v2.1.0）**

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


## AO. ~~待开发：后台游戏列与平台链接抽屉改版~~ → **已实现并发布 v2.2.0（2026-11-09）**

**状态：已发布 v2.2.0（2026-11-09，af70754；QA 报告 docs/QA-ADMIN-LINKS-DRAWER-AO.md）**
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


## AP. ~~待开发：游戏详情·价格历史报表（史低高亮）~~ → **已实现并发布 v2.2.0（2026-11-09）**

**状态：已发布 v2.2.0（2026-11-09，282d018；QA 报告 docs/QA-PRICE-HISTORY-AP.md）**
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


## AS. ~~已发布 v2.3.0：README 开发进度摘要（自动生成）~~ → **已下线（2026-11-12，方案 B）**

**状态：已发布 v2.3.0（2026-11-09，de71311；QA 报告 docs/QA-TODO-PROGRESS-AS.md）；2026-11-12 已下线（docs/TODO-PROGRESS.md §0：删生成块/脚本/CI/测试，README 只留 TODO 链接）**
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


## AT. ~~待开发：后台信息架构改版（新增改抽屉 / 操作日志合并 5 tab / 邮件与设置 tab / 价格走势线图）~~ → **已实现并发布 v2.4.0（2026-11-09）**

**状态：已发布 v2.4.0（2026-11-09，a500811；QA 报告 docs/QA-ADMIN-CONSOLE-IA-AT.md）**
**依赖：** 无
**解锁：** 无（下期「账号操作审计」等本批落地后另立项）
**规格**：[ADMIN-CONSOLE-IA.md](ADMIN-CONSOLE-IA.md)；原型 [design/admin-console-ia.html](design/admin-console-ia.html)

- **需求（2026-11-09 所有者 8 条）**：① 新建用户改右侧抽屉（不跳页），用户管理页只留列表；② 新菜单「操作日志」，
  一页 tab 收拢全站日志（用户删除 / 批量操作 / Steam 账号 / 邮件发送 / 运行与同步）；③ 新建通知同样改抽屉；
  ④ 访问记录不动；⑤ Steam 账号加日志（落操作日志）；⑥ 邮件服务拆 tab；⑦ 系统设置折叠改 tab；
  ⑧ 价格变化删底部「近 7 天变化」表，改成悬停「变化」弹近 7 天线图。
- **已确认（2026-11-09）**：账号操作审计本期不做；邮件发送记录搬进操作日志（单一入口）；
  实时输出进「运行与同步」tab；Steam 日志 7 类动作 + 保留 180 天；「新页面」= 右侧抽屉浮层（不跳页）。
- **落地内容（已实现待发版）**：`Console.vue` 加「日志审计」分组、删 `bulk-ops`/`sync` 并做旧书签映射；
  新增 `AdminLogs.vue`（5 tab，懒加载+缓存，`?tab=` 直达）/ `UserCreateDrawer.vue` / `AnnouncementDrawer.vue` /
  `PriceSparkline.vue`；新表 `steam_account_logs`（`steam-login.js` 建表）+ `src/steam-log.js` 读写 +
  `steam-accounts.js` 5 处埋点 + 绑定/认领/删用户级联埋点 + `GET /api/admin/steam-logs`；
  `/api/admin/reports/price` 去 `daily` 加 `series`（`dailyMinSeriesBatch` 一次查出）；保留期并入 `prune`（`--steam-days`）。
- **验收**：见规格 §11 的 1–14。


## AU. ~~pg_trgm 搜索索引 + 封面图缓存总量上限 + 愿望单诚实口径（AA 方案 A）~~ → **已实现并发布 v2.5.0（2026-11-09）**

**状态：已发布 v2.5.0（2026-11-09，785670b；QA 报告 docs/QA-AU-D1D2AA.md）**
**依赖：** 无
**解锁：** 无（D1/D2 由本条收口；AA 条目的「方案 A」部分由本条交付）
**规格**：[ROADMAP.md](ROADMAP.md) 的 D1/D2 + [WISHLIST-OAUTH.md](WISHLIST-OAUTH.md) §3/§4

- **D1 搜索索引**：`migrate()` 内 `create extension if not exists pg_trgm` + 3 条表达式 GIN 索引
  （`games.name` / `games.name_en` / `game_aliases.platform_title`），表达式与 `gameKeywordSql`
  的字段侧归一化逐字一致（`replace(replace(lower(coalesce(col,'')),' ',''),'　','')`）；
  整段包在 try/catch 里——本地 pglite 无 `pg_trgm` 时静默跳过、不中断迁移。
- **D2 缓存上限**：新增设置 `images.maxBytes`（字节，0=不限，高级分组，走 `def()` 热加载约 15 秒）；
  `images.pruneImages({maxBytes})` 按 mtime 从最旧删到合规（只删 `.jpg`、删不掉跳过不中断、返回
  `{removed,freedBytes,remainingBytes}`）；`node src/cli.js images prune --max-bytes <字节>` 手动清理；
  `images pull` 结束时若 `IMAGES_MAX_BYTES>0` 自动清理（调度器 `images` 任务子进程继承水合后的 env，同样生效）。
- **AA 方案 A（诚实口径）**：愿望单弹窗说明改「加入本站愿望单；Steam 已停止接受第三方写入，账号推送暂不支持（仅本站保存）」；
  加入/移除提示均不含「失败」字样（「已加入本站愿望单（Steam 推送暂不支持）」/「已按选择移除本站愿望单；Steam 回推暂不支持」）；
  服务端 `adapter.steam.wishlist_add_failed` + reason 与推送分支代码保留；`WEB.md`、`STEAM-ACCOUNTS.md` 已同步。
- **测试**：`test/images.test.js`（超限按最旧删除/上限内不动/0=不限）、`test/pg.test.js`（迁移含三索引表达式 +
  pglite 两次 migrate 不中断）、`test/settings.test.js`/`test/setup.test.js`（59 项）、`test/wishlist.test.js`（诚实口径断言）。
- **验收**：① 两次 `migrate` 不报错，本地 pglite 不因缺扩展中断；② 上限内不删、超限按最旧删、`0` 不限；
  ③ `images pull` 后按上限自动清理；④ 愿望单提示不含「失败」、文档口径一致；⑤ `npm test` / `frontend:build` / `scan` 全绿。
- **待线上验证**：生产库 `\dx` 有 `pg_trgm`、`EXPLAIN` 对关键词查询命中 Bitmap Index Scan（本机无 PG 15，标 🔎）。


## AV. ~~首页列表读模型：`game_region_snapshot`（把每请求全库聚合改成入库时维护）~~ → **已实现并发布 v2.6.0（2026-11-10）**

**状态：已发布 v2.6.0（2026-11-10，9d588fe；QA 报告 docs/QA-READ-MODEL-AV.md；性能 3 项验收转上线实测）**
**依赖：** 无
**解锁：** 无（首页性能专项；与后续「nginx gzip」部署侧改动独立）
**规格**：[READ-MODEL.md](READ-MODEL.md)

- **问题（2026-11-09 线上实测）**：首页 `POST /api/games/search` **2.78–3.86s**，`q=zzzz`（0 条、134B）仍 2.40s、
  `q=730`（appid 精确、0 条）2.42s——**成本与结果无关**；`/api/games/count` 0.36s；首页 JS 279KB + CSS 135KB 未压缩（部署侧另办）。
  根因：`gameSearch` 每次请求跑 `price_rollup`（全区服 offers）+ `daily_rollup`（千万级 daily_prices）两个 CTE、
  19.6 万 games 逐行 `exists(daily_prices)`、`count(*)` 再全扫一遍，两个 CTE 只为返回 20 行服务。
- **方案**：新增读模型表 `game_region_snapshot`（`(game_id, region)` 一行：当前价/折扣/Steam 价/平台标签/史低/新史低/更新时间），
  入库时维护：`ingestOffers` 每个 offer 写入后 `refreshGameRegionPrices(gameId)`、`upsertDaily` 后
  `touchDailyAggregate`（日界切换维护 `hist_low`/`prev_hist_low`/`hist_low_day`）、`mergeGames` 尾部刷新两个 game；
  `gameSearch`（compact 与非 compact 两分支）与 `/api/games/count` 改读读模型，去掉两个 CTE 与 `exists`；
  迁移表空时一次性回填（offers ∪ daily_prices 并集）；`READ_MODEL=legacy` 保留旧 SQL 作回滚开关。
- **落地内容（已实现待发版）**：`pg.js`（DDL+4 索引、`backfillGameRegionSnapshot`/`refreshGameRegionPrices`/
  `refreshGameRegionHist`/`touchDailyAggregate`/`readModelCheck`/`readModelRebuild`、`mergeGames` 钩子、
  `gameSearch` 读模型分支含 legacy 开关）；`ingest.js` 两写入点；`server.js` `/api/games/count` 读快照 + 60s 实例级缓存；
  `cli.js` `readmodel check [--sample 200] [--fix] / rebuild [--region]`；调度器每日 `readmodel` 任务（抽样 200，差异记失败）；
  `test/game-search-read-model.test.js`（新旧 20 组组合一致性 + 同轮更新 + 日界切换 + 合并 + 禁用/回收站 + 对账/修复/重建）。
- **配套**：`node src/cli.js readmodel check|rebuild`（抽样对账/全量重建）+ 每日 `readmodel` 调度任务（抽样 200 条）；
  `test/scheduler.test.js` 断言默认参数与开关。
- **验收**：见规格 §9——① 列表 TTFB P95 < 150ms、零命中 < 150ms；② `/api/games/count` < 30ms；
  ③ `EXPLAIN` 无 `daily_prices` 聚合、无全表 offers 聚合；④ 新旧实现 total 与第一页顺序一致（20 组组合）；
  ⑤ 写价后快照同轮更新、合并不失真、抽样对账 0 差异；⑥ `npm test` / `frontend:build` / `scan` 全绿。
- **回滚**：`READ_MODEL=legacy` 切回旧 SQL，表保留。
- **上线实测（2026-11-10 13:19–13:26，外网 TTFB，扣 TLS ≈70–85ms）**：默认筛选 **337 / 340 / 343ms**（服务端 ≈265ms）；
  `q=zzzzzz` 零命中 **1.59s**（服务端 ≈1.52s）；`/api/games/count` **163ms**（服务端 ≈84ms）。
  **三项都未达 §9 门槛（150 / 150 / 30ms）**，功能正常但性能验收未通过 → 立 **AY** 跟进（见下）。


## AW. ~~封面图回源：404 快失败 + 超时收紧 + 负缓存分层 + `header_image` 直链~~ → **已实现并发布 v2.7.0（2026-11-10）**

**状态：已发布 v2.7.0（2026-11-10，cb3fbf1；QA 报告 docs/QA-IMAGE-FETCH-AW.md）**
**依赖：** 无
**解锁：** 无（与 AV 的列表读模型互补；HTTP/2 属部署侧 [NGINX-PERF.md](NGINX-PERF.md)）
**规格**：[IMAGE-FETCH.md](IMAGE-FETCH.md)

- **问题（2026-11-10 实测 + 服务器日志）**：出口正常——老游戏未预取的尺寸能 200 取到
  （`400/library_hero` 2.82s、`400/capsule_616x353` 0.79s、`730/library_hero` 0.96s）；但 4 个新 appid
  （4266020 / 4265920 / 4848110 / 4825080）全部 `steam.img_miss`：3 个 `HTTP 404`、1 个 `aborted`，
  首页单张图要 2.0–6.6s 才 404。根因：`downloadImage` 对同一资源串行试 3 个 CDN 候选 × 8s（404 也重试）；
  负缓存只有 5 分钟；新 appid 资产在 `store_item_assets` 新路径、老路径没有；预取只覆盖约 3%。
- **方案**：404/410 立即失败不换候选；单候选 8s→3s、整次预算 5s；负缓存分层（404 24h / 其它 10min）；
  `games.header_image`（列已存在）有值时优先直链（仅 `header` 尺寸，https + `.steamstatic.com` 白名单，
  失败回退老路径）；前端失败显示 CSS 占位块（不再用 favicon 兜底）；`images pull` 复用同一逻辑并统计 `notFound`。
- **落地内容（已实现待发版）**：`src/images.js` `downloadImage` 改造（preferredUrl 候选置顶、404/410 快失败
  `notFound`、单候选 3000ms、总预算 5000ms、`steam.img_fast_fail`/`steam.img_fallback` 日志）；`src/server.js`
  `IMG_MISS_TTL` 负缓存分层（notfound 24h / error 10min，实例级 Map + 测试可注入 TTL）+ header_image 直链白名单
  `isAllowedSteamImageUrl`；`src/cli.js` `images pull` 统计 `notFound` 并入日志与摘要；`Home.vue` 封面失败/无 AppID
  显示 `.cover-placeholder`（渐变 + 首字，桌面/移动/详情三处），删除 favicon 兜底；`test/images.test.js` +6 项。
- **验收**：见规格 §5——① 404 只调 1 次；② 超时仍换候选（≥2 次）；③ 总预算 ≤5s；④ 负缓存分层生效；
  ⑤ header_image 优先且白名单拦截非 steamstatic 域名；⑥ 前端无 favicon 兜底且有占位元素；
  ⑦ 已缓存图仍 200、不触发网络；⑧ `npm test` / `frontend:build` / `scan` 全绿。


## AX. ~~异常审核「按 IP 合并」定为默认视图（去掉开关与明细表）~~ → **已实现并发布 v2.7.0（2026-11-10）**

**状态：已发布 v2.7.0（2026-11-10，736e919；QA 报告 docs/QA-ADMIN-REVIEW-AX.md）**
**依赖：** 无（AR 已发布 v2.2.0，本批是对它的修订）
**解锁：** 无
**规格**：[ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §4.5（修订口径）/ §4.1–§4.4（合并视图本身）

- **需求（2026-11-10 所有者）**：异常审核默认按 IP 合并；页面上不再有「按 IP 合并」开关（截图红框处），
  合并视图成为唯一视图。
- **决策 A（所有者确认）**：删掉明细表后不再提供「只处置某一条规则」；处置一律按**整 IP**
  （封 IP / 封设备 / 忽略），展开行仍能看到每条规则。
- **方案**：`AdminModules.vue` 删 `el-switch` + `onMergeToggle` + `admin.reviewMerge` localStorage + 明细表与明细移动卡片 +
  `sel.reviews` 多选 + `reviewsBulkActions` + 只服务明细的 `reviewAction`/`ignoreReview`；合并视图提为默认渲染；
  标题说明补「同一 IP 合并为一行，展开看逐条规则」；`test/admin-review-lists.test.js` 把「有开关 + 有 localStorage」
  断言改成「无开关、无 `admin.reviewMerge`、默认渲染合并表」。**无后端改动、无接口变化。**
- **保留**：`只看待审 / 全部（审计）` 筛选、合并视图表头排序（`admin.reviewMergeSort`）、展开明细、
  「已选 N 个 IP · M 条待审」批量栏、移动端卡片、分页。
- **验收**：进入异常审核即合并视图、页面上没有「按 IP 合并」开关；同一 IP 多规则合并/展开/设备数正确；
  「只看待审 / 全部」切换正常；整 IP 处置与确认弹窗条数一致；批量栏可用；移动端卡片正常；
  `npm test` / `frontend:build` / `scan` 全绿。
- **落地内容（已实现待发版）**：`AdminModules.vue` 删「按 IP 合并」开关与 localStorage 键、明细表与明细移动卡片、
  `sel.reviews` 多选、`reviewsBulkActions`、逐条处置 `reviewAction`/`ignoreReview` 与明细表排序状态；
  合并视图（聚合/展开/整 IP 处置/移动卡片/分页/`admin.reviewMergeSort` 排序）提为默认唯一渲染，翻页清空 IP 选择；
  标题说明补「同一 IP 合并为一行，展开看逐条规则」。测试：`admin-review-lists.test.js` 改断言（无开关/无合并键/
  默认合并表）、`admin-bulk.test.js` 计数随明细表移除更新、`reviews.test.js` 悬停提示断言改合并展开行。无后端改动。

## AY. ~~待排查：AV 读模型上线后性能未达门槛（列表 340ms / 零命中 1.59s / count 163ms）~~ → **已实现并发布 v2.10.1（2026-11-11）**

**状态：已发布 v2.10.1（2026-11-11，71d0f87；QA 报告 docs/QA-SEARCH-PERF-AY.md 未提交；性能门槛待部署复测）**
**依赖：** AV（已发布 v2.6.0）
**解锁：** 无
**规格**：[READ-MODEL.md](READ-MODEL.md) §9 性能门槛

- **实测（2026-11-10 13:19–13:26，外网 TTFB，扣除 TLS 握手 ≈70–85ms）**：
  ① `POST /api/games/search` 默认筛选 **337 / 340 / 343ms**（服务端 ≈265ms），门槛 <150ms；
  ② `q=zzzzzz` 零命中 **1.59s**（服务端 ≈1.52s），门槛 <150ms——零命中反而比有结果慢约 5 倍，明显异常；
  ③ `GET /api/games/count` **163ms**（服务端 ≈84ms），门槛 <30ms。
- **怀疑点**：关键词 OR（`name LIKE` / `name_en LIKE` / `game_aliases` EXISTS）与 `game_region_snapshot` join
  组合后退化成 19.6 万 games 全表扫 + 逐行别名探测；count 与列表各扫一遍。
- **下一步（只读）**：生产库对两条 SQL 跑 `EXPLAIN (ANALYZE, BUFFERS)`（参数：region='cn'、kw='' 与 kw='zzzzzz'），
  据计划二选一：① 关键词先用 trgm 收敛成 game_id 集合再 join 快照；② count 与列表共用一次候选集
  （`count(*) over()`）或给 count 加短缓存。
- **验收**：三项回到 §9 门槛（列表 P95<150ms、零命中<150ms、count<30ms），且列表 total/排序/筛选不变
  （复用 `test/game-search-read-model.test.js` 的组合一致性用例）。
- **结论（2026-11-11，生产 EXPLAIN）**：根因 4 条——① 关键词 `OR LIKE(名称/英文名) OR EXISTS(别名)` 混入不可索引
  子查询，trigram 索引失效（实测单独两臂 BitmapOr 仅 2.4ms、别名 1.2ms）；② 默认排序 `heat DESC NULLS LAST`
  与 `idx_games_heat`（NULLS FIRST）不匹配 → 外部排序落盘 4.5MB（94ms）；③ 列表 count 与列表数据各扫一遍
  `games`(198k)+`snapshot`(107k)（111ms），catalog 计数 76ms 且无缓存；④ 计划代价过高触发 JIT（零命中 +221/343ms）。
- **修复（已实现待发版）**：关键词两段式（三臂 trigram union 取候选 ID，零命中直接返回，命中 ≤5000 用
  `g.id = any()`，超限回落原 LIKE）+ 新增部分索引 `games_heat_live (heat desc nulls last) where live` +
  `/api/games/count` 的 priced+catalog 合并 60s 缓存。详见 [READ-MODEL.md](READ-MODEL.md) §12。
- **复测（部署后）**：用 §12 的 6 条 `EXPLAIN (ANALYZE, BUFFERS)` 复核（不再出现 `Seq Scan on games` 与
  `Sort Method: external merge`），并按 §9 三项门槛实测。
- **部署状态（2026-11-11 复核）**：生产 `https://sd.yyliucha.cn/api/site` 在复核时为 v2.10.0；本批修复已随
  **v2.10.1** 发布（`71d0f87` / `ffda3a9`）→ **待部署复测**：服务器升级到 v2.10.1 后，按上面两条复测并把结果
  回写本条目。


## AZ. ~~待开发：异常审核「规则摘要」列精简（首规则 ×n · 共 N 条规则 + hover 弹层）~~ → **已实现并发布 v2.8.0（2026-11-10）**

**状态：已发布 v2.8.0（2026-11-10，4c5c98d；QA 报告 docs/QA-AZ-BA-BB-BC.md）**
**依赖：** AX（已发布 v2.7.0）
**解锁：** 无
**规格**：[ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §4.6

- **问题（2026-11-10 所有者，合并视图截图）**：规则摘要列把该 IP 的全部规则逐条拼出
  （`cms-probe ×1 · script-ext ×1 · secret-file ×1 · vcs-dir ×1`），一个 IP 带 3–4 条规则就占满整行。
- **方案**：列内只显示 `首规则 ×n · 共 N 条规则`（首规则 = 次数最多，`row.rules` 已按次数降序）；
  悬停弹层（el-popover）列出全部规则 `规则 ×n`；明细仍以展开行为准；移动端卡片同口径。
- **改动**：`AdminModules.vue` 合并表 ruleCount 列 + 移动卡片；`test/admin-review-lists.test.js` 断言改「首规则 + 共 N 条规则 + popover」。
- **验收**：见规格 §4.6——列固定宽不溢出；hover 弹层列全部规则；单规则 IP 不出现空弹层；移动端同口径；`npm test` / `frontend:build` / `scan` 全绿。


## BA. ~~待开发：运行与同步页重设计（任务健康条 + 记录精简 + 固定高度日志面板）~~ → **已实现并发布 v2.8.0（2026-11-10）**

**状态：已发布 v2.8.0（2026-11-10，44942fd；QA 报告 docs/QA-AZ-BA-BB-BC.md）**
**依赖：** 无（复用 `/api/admin/sync/status`、`/api/admin/logs`、`/api/admin/sync/runs` 现有接口）
**解锁：** 无
**规格**：[RUN-SYNC-REDESIGN.md](RUN-SYNC-REDESIGN.md)

- **问题（2026-11-10 所有者，页面截图）**：同步记录 10 列 × 20 行 + 日志筛选/摘要/300 条日志卡片 ≈ 2100px+，
  日志永远在最下面，每次都要滚到底。
- **方案（方案 A）**：① 顶部任务健康条（chips：任务名/最近状态/耗时/下次运行，点 chip 过滤日志，60s 自动刷新）；
  ② 同步记录列合并为 6 列（时间/模式/状态/结果/耗时/备注），默认最近 5 轮 + 展开全部；
  ③ 日志面板固定高度 55vh 内部滚动，筛选条 sticky 在面板头，日志行紧凑单行 + 点击展开完整字段；
  ④ 移动端健康条横向滚动、日志面板 50vh。
- **验收**：见规格 §4——1440×900 一屏可见健康条 + 记录前 5 行 + 日志头；日志面板内部滚动不拉长页面；
  chip 过滤可用；记录 5 轮折叠；日志行展开/筛选/自动刷新可用；移动端无横向溢出；`npm test` / `frontend:build` / `scan` 全绿。


## BB. ~~待开发：代理健康主动探测（立即检测按钮 + 每 10 分钟定时任务）~~ → **已实现并发布 v2.8.0（2026-11-10）**

**状态：已发布 v2.8.0（2026-11-10，96d28a9；QA 报告 docs/QA-AZ-BA-BB-BC.md）**
**依赖：** AM-1 / AM-2（代理池，已发布）
**解锁：** 无
**规格**：[PROXY-POOL.md](PROXY-POOL.md) §11

- **问题（2026-11-10 所有者，设置页截图）**：健康状态显示「未知」——健康数据只来自真实 Steam 请求
  （`http.js` → `proxy-pool.js` 写 `data/proxy-health.json`），没有主动探测；代理没被真实请求用过就永远未知。
- **方案**：`POST /api/admin/proxies/probe`（CONNECT 协议层探测，复用 diagnose 的 `probeProxyConnect`）；
  设置页「立即检测」按钮；定时任务 `proxy-probe`（每 10 分钟，`PROXY_PROBE_ENABLED=0` 可关）；
  探测结果与业务冷却**分离**（探测失败不写 coolsdown）；「未知」改为「未检测」+ 上次检测时间；日志脱敏。
- **验收**：见规格 §11.6——探测结果正确、不误改业务冷却、定时任务默认参数与开关断言、脱敏、
  老配置兼容、`npm test` / `frontend:build` / `scan` 全绿。


## BC. ~~待开发：封面图补图覆盖率（header_image 补全 + 预取扩大 + 缺图缓存可手动清）~~ → **已实现并发布 v2.8.0（2026-11-10）**

**状态：已发布 v2.8.0（2026-11-10，3ebc515；QA 报告 docs/QA-AZ-BA-BB-BC.md）**
**依赖：** AW（已发布 v2.7.0；本批在其上提高覆盖率，占位块保留为兜底）
**解锁：** 无
**规格**：[IMAGE-COVERAGE.md](IMAGE-COVERAGE.md)

- **问题（2026-11-10 所有者，前台截图）**：新游戏前台封面显示占位块（W/C/G/夜 等）。根因：价格类同步入库的
  游戏没有 `header_image`（只有元数据同步才写），老路径又 404；AW 批的 24h 负缓存让「补上后也要等 24h」；
  `images pull` 每轮 200 款覆盖约 3%。
- **方案**：① `steam-status` 顺带写 `header_image`（同一次全量 appdetails 响应已有字段，零额外请求）+
  `backfill` 候选追加「有价但 header_image 为空」；② `images.limit` 默认 200→500（生产已保存旧值需部署侧调）；
  ③ 后台「清除缺图缓存」按钮 + `POST /api/admin/images/reset-miss`；④ 前端占位块保持 v2.7.0 设计。
- **验收**：见规格 §4——`steam-status.header_image_filled` >0、backfill 补齐、limit 默认 500、reset-miss 生效、
  占位块行为不变、`npm test` / `frontend:build` / `scan` 全绿。


## BD. ~~待开发：后台链接抽屉「最低价」醒目（方案 A：整卡高亮 + 角标）~~ → **已实现并发布 v2.8.0（2026-11-10）**

**状态：已发布 v2.8.0（2026-11-10，0124f79；QA 报告 docs/QA-LINKS-LOWEST-BD.md）**
**依赖：** AO（链接抽屉，已发布 v2.1.0）
**解锁：** 无
**规格**：[ADMIN-LINKS-DRAWER.md](ADMIN-LINKS-DRAWER.md) §12

- **问题（2026-11-10 所有者，链接抽屉截图）**：多个渠道价格并列无重点，要自己比价。
- **方案（方案 A）**：最低价那张卡整卡高亮（绿描边 + 淡绿底 + 发光 + 「★ 最低价」角标 + 价格放大变绿）；
  口径：币种不折算（首项币种锚定）、缺货不参与、至少 2 条可比且唯一最低才标；纯前端。
- **验收**：见规格 §12——三渠道时 GOG 高亮；跨币种不比较；缺货/单条/同价不标；移动端生效；`npm test` / `frontend:build` / `scan` 全绿。


## BE. ~~待开发：愿望单仅本站（去 Steam 关联 + 前后端清单 + 后台可删不可加）~~ → **已实现并发布 v2.9.0（2026-11-10）**

**状态：已发布 v2.9.0（2026-11-10，66f0c18；QA 报告 docs/QA-WISHLIST-SITE-ONLY.md）**
**依赖：** AA（已发布 v2.5.0：Steam 写接口 401 的诚实口径铺垫）
**解锁：** 无
**规格**：[WISHLIST-SITE-ONLY.md](WISHLIST-SITE-ONLY.md)

- **需求（2026-11-10 所有者）**：愿望单只加到本站当前账户，不再与 Steam 关联；添加后前后端都有清单可看；
  后台支持删除、不允许新加。
- **已确认决策**：① 前台用首页现有「愿望单」tab（不新增页面）；② 后台新增「愿望单」菜单（全站列表）；
  ③ 删除粒度 = 单条 + 批量（二次确认）；④ 全面解耦（加入/移除弹窗去 Steam 账号多选、详情/卡片不再列账号）；
  ⑤ 保留加入即建史低提醒。
- **服务端**：`POST /api/wishlist` 只收 `{appid|gameId}`（旧 `steamIds` 忽略不报错、不推 Steam）；`DELETE /api/wishlist/*`
  只删本站 + 清提醒；新增 `GET /api/admin/wishlists`（join 用户/游戏/快照价，筛选+分页）、`DELETE /api/admin/wishlists/:id`、
  批量 `wishlists/delete`（BulkActions，max 200）；**不提供新增接口**。另：每账号 API Key 改为**账号同步用**
  （游戏库/愿望单各自用自己账号的 key，未配置/无效直接报错、不回退；全局 key 仅系统级任务；绑定后不自动同步；
  后台列改名「API Key」——见规格 §4.4）。
- **前台**：`Home.vue` 去弹窗/去账号多选/去 Steam 账号展示；加入直接写本站；移除确认后只删本站；「愿望单」tab 不变。
- **后台**：`Console.vue` 内容运营组加「愿望单」菜单；`AdminModules.vue` 新 section（用户/游戏/当前价/史低/加入时间/删除，
  关键词+分页，BulkBar 批量删除，移动端卡片，**无新增入口**）。
- **验收**：见规格 §8——加入不弹多选只写本站并建史低提醒；详情/卡片无 Steam 账号；前台 tab 过滤正常；后台列表/筛选/分页正确；
  单条+批量删除生效且清自动提醒、无新增入口；权限 401/403、旧 steamIds 请求兼容；`npm test` / `frontend:build` / `scan` 全绿。


## BF. ~~待开发：数据库遗留对象清理（已下线功能的表/列）~~ → **已实现并发布 v2.10.1（2026-11-11）**

**状态：已发布 v2.10.1（2026-11-11，b46896e；QA 报告 docs/QA-BF-BG-2026-11-11.md）**
**依赖：** BE（仅 B 组两列需等 BE 发布；A 组可立即做）
**解锁：** 无
**规格**：[DB-LEGACY-CLEANUP.md](DB-LEGACY-CLEANUP.md)

- **实测（2026-11-10 生产库只读）**：`steam_sessions` 1 行（FF 旧会话，已停用）；`users.steam_id` 0 行非空；
  `offers.risk_level` 107050 行全 'A'（只写不读）；`steam_accounts.api_key_enc` 2 行（Happy/FF，推送 key 已失效）；
  `user_wishlist.steam_ids` 1 行非空；`games.content_descriptors` 6222 / `age_ratings` 26016 非空（保留）。
- **处理**：A 组（与 BE 无关，可立即做）= 删 `steam_sessions` 表、`users.steam_id` 列+索引、`offers.risk_level` 列
  （含删 INSERT 字段与 SELECT）；B 组（依赖 BE 发布）= 删 `user_wishlist.steam_ids` 列；保留 `steam_accounts.api_key_enc`
  （2026-11-10 修订：改为账号同步用 key）、`content_descriptors`/`age_ratings`/`interested`/`owned`/`hide_uninterested`。
- **关键**：代码 DDL 与库同步删（否则 `create table if not exists`/`add column if not exists` 会重建或写回报错）；
  部署期 SQL 幂等、放部署侧，先只读核对再写。
- **验收**：见规格 §4——新库不再出现被删对象、grep 无代码引用、业务回归、部署 SQL 幂等、`npm test` 全绿。


## BG. ~~待开发：BUG——站点通知页未编辑即误报「未保存的修改」~~ → **已实现并发布 v2.10.1（2026-11-11）**

**状态：已发布 v2.10.1（2026-11-11，4a4ecd2；QA 报告 docs/QA-BF-BG-2026-11-11.md）**
**依赖：** AN（未保存守卫）/ AT（站点通知抽屉），均已发布
**解锁：** 无
**规格**：[UNSAVED-GUARD.md](UNSAVED-GUARD.md) §11

- **现象（2026-11-10 所有者，截图）**：打开「内容运营 → 站点通知」页、什么都没改，切菜单即弹「还有没保存的修改」，
  侧栏当前项也显示「●」未保存小圆点。
- **根因**：`frontend/src/components/AnnouncementDrawer.vue` 的脏判定快照初始化为空串（`let snapshot = ''`），
  而 `snapshot` 只在 `fillFrom()`（抽屉打开时）赋值 → 页面挂载、抽屉关闭时 `isDirty()` 恒为 true
  （`'' !== JSON.stringify(form)`）。其余四个编辑面初始脏判定均为 false，仅此一处写错。
- **修复**：`let snapshot = JSON.stringify(form);`（初始快照 = 初始表单；打开抽屉时 `fillFrom` 仍会重置）。
- **回归**：`test/unsaved-guard.test.js` 增加断言，锁住「抽屉未打开时不算脏」的初始快照口径。
- **验收**：打开站点通知页不出现未保存圆点/弹窗；打开抽屉编辑后才算脏（点取消会弹确认）；其余编辑面不变；
  `npm test` / `frontend:build` / `scan` 全绿。


## BH. ~~待开发：访问记录按 IP 统计（访问明细默认 IP 视图 + 黑白名单统计列 + 设备按设备码）~~ → **已实现并发布 v2.9.0（2026-11-10）**

**状态：已发布 v2.9.0（2026-11-10，1f9e76a；QA 报告 docs/QA-VISIT-IP-STATS.md）**
**依赖：** 无（复用异常审核按 IP 合并的交互先例）
**解锁：** 无
**规格**：[VISIT-IP-STATS.md](VISIT-IP-STATS.md)

- **需求（2026-11-10 所有者）**：访问明细、封禁与白名单做成**按 IP 统计**、默认就是 IP；设备按**设备码**统计。
- **已确认决策**：① 访问明细默认「IP 统计视图」（每 IP 一行），可切换回逐条「明细」；② IP 统计列 =
  IP/归属地区/访问次数/首次→最近/独立路径数/设备数/状态（正常·被拦截·已封禁），展开看最近访问与路径 top；
  ③ 封禁与白名单**保留两张表**，每行加访问次数/最近访问/设备数；④ 设备按 `device_id` 聚合、无设备码回退
  `fingerprint` 并标注，**设备封禁仍按指纹**；⑤ 统计默认近 7 天、可切 1/7/30 天、分页 20。
- **改动**：服务端新增 `GET /api/admin/visitors/by-ip`（时间窗+排序白名单）、黑白名单列表加统计列、
  `listDevices` 按设备码聚合；前端 `AdminModules.vue` 访问明细视图切换 + 展开行、两张表加列、设备列调整。
- **验收**：见规格 §4——IP 统计默认、明细可切、状态区分、黑白名单统计列、设备码聚合与「无设备码」标注、
  时间窗切换生效、`npm test`（新增 `test/visitor-ip-stats.test.js` 进主链）/ `frontend:build` / `scan` 全绿。


## BI. ~~待开发：访问明细 IP 统计——自动临时封禁显示与状态筛选~~ → **已实现并发布 v2.10.0（2026-11-11）**

**状态：已发布 v2.10.0（2026-11-11，be91c43；QA 报告 docs/QA-IP-BAN-STATUS.md）**
**依赖：** BH（已发布 v2.9.0：IP 统计视图）
**解锁：** 无
**规格**：[VISIT-IP-STATS.md](VISIT-IP-STATS.md) §8

- **背景（2026-11-11 所有者截图）**：IP 统计里「被拦截」只代表窗口内有拦截**采样**；自动三振的临时封禁
  （`ip_abuse.banned_until` 未过期）在列表里看不到，所有者误以为「频繁访问没被封」。
- **决策**：状态扩展为 4 态——`已封禁`（手动黑名单）/ `封禁中`（自动临时封禁，显示剩余时间）/
  `被拦截`（窗口内有拦截但当前未封）/ `正常`；IP 统计加状态筛选（全部/正常/被拦截/封禁中/已封禁）。
- **改动**：`listVisitorsByIp` 追加 `ban_until/ban_source` 与 `banned` 状态（手动黑名单优先）；接口加 `status`
  白名单筛选；前端状态列 tag + 剩余时间、筛选下拉；测试补「封禁中/过期回落/黑名单优先」三态。
- **验收**：见规格 §8——自动封禁显示「封禁中 + 剩余时间」、过期回落、黑名单优先显示「已封禁」、
  状态筛选与时间窗/分页/关键词叠加正确、`npm test` / `frontend:build` / `scan` 全绿。


## BJ. ~~待开发：黑名单 IP 不再写入自动封禁 + 自动封禁记录口径 + 解封语义拆分~~ → **已发布 v2.10.2（2026-11-11）**

**状态：已发布 v2.10.2（2026-11-11）**
**依赖：** 无（BI 已发布 v2.10.0，其「封禁中 / 已封禁」状态口径可复用）
**解锁：** 无
**规格**：[BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md) §10

- **现象（2026-11-11 所有者截图，生产 v2.10.0「访问记录 → 封禁与白名单」）**：已审核封禁的 IP 仍出现在「自动封禁记录」里
  （`45.138.12.10` 审核通过 rate-limit、`45.138.12.6` 审核通过 vcs-dir）；自动封禁记录中
  `45.138.12.10`（rate、封禁至 2026/11/02 10:01）、`34.65.66.120` / `34.65.89.81`（rate-day）、
  `142.86.110.204`、`34.156.56.208`、`34.70.39.109` 等「封禁至」早已过期却仍显示。
  白名单 `101.82.244.116` / `223.166.239.55` 本批不涉及。
- **根因（代码证据）**：① 限流计数 `ratelimit.hit`（`src/server.js:515`）在 IP 黑名单检查（`:543`）之前，
  `hit` 只豁免白名单（`src/ratelimit.js:244`），黑名单 IP 照样计数，封禁期内再打满 `blockedEscalate=100` 就升级并
  `applyBan` 再写 `ip_abuse`（`:198-205`，还把 pending 审核标 `auto_banned`）；② `listAbuse`
  （`src/store/pg.js:2268-2278`）不按 `banned_until` 过滤，过期行永远显示，前端也没有状态列/「已在黑名单」标注
  （`AdminModules.vue:50`）；③ 审核通过只写 `ip_blacklist`、不清 `ip_abuse`（`src/server.js:3253` → `:3291-3303` →
  `src/store/pg.js:2213-2220`）；④ 自动封禁页「解封」调 `ratelimit.unban`，它**同时删 `ip_abuse` 和 `ip_blacklist`**
  （`src/ratelimit.js:296-314`），会把审核封禁一起解除。
- **已确认决策（15 项：A1 / B1 / H1 / C1 / D1 / E1）**：① 黑名单检查提到限流之前，命中不计数、不三振、不升级、
  不写 `ip_abuse`、不写异常审核，仍保留每分钟 1 条的采样拦截日志；白名单/管理员/内网/申诉页豁免不变；
  ② 自动封禁记录默认只显示「生效中」+ 状态列（生效中/已过期/仅计数）+「已在黑名单」标注（运行时 `matchesIpEntry`，含 CIDR）
  + 状态筛选；③ 存量只清「已被黑名单覆盖」的 `banned_until`/`ban_source`（行保留），过期行并入现有 `prune` 保留 90 天
  （不新建定时任务）；④ 自动封禁页「解除封禁 / 清除记录」只清 `ip_abuse`，黑名单页「解封」只删 `ip_blacklist`，批量同口径；
  ⑤ 审核通过 / 手动封 IP / 批量封 IP 写黑名单时把该 IP 的 `ip_abuse.banned_until` 置空（行保留）；
  ⑥ 本批不改三振阈值/时长/档位、设备封禁、白名单逻辑、访问明细统计，也不清理 `setBanUntil`/`applyExternalBan` 死代码。
- **改动**：`src/server.js`（拦截链换序、`/api/admin/abuse` 加 `status` 与 `in_blacklist`/`blacklist_entry`、
  `DELETE /api/admin/abuse/:ip` 改 `clearAbuse`、`banIpExclusiveSql` 加清临时封禁、`banState` 类型优先级）、
  `src/ratelimit.js`（`clearAbuse` / `clearBanMemory`，`unban` 退场）、`src/store/pg.js`（`listAbuse` 的 status/active/排序、
  `clearAbuseBan`、`purgeOldRows` 加 `abuseDays=90`、`migrate()` 加黑名单覆盖清理 SQL）、`src/cli.js`（prune 输出计数）、
  `frontend/src/pages/AdminModules.vue`（筛选/状态列/标注/按钮文案/确认框/空态）、对应测试。
- **验收**：见规格 §10.6——黑名单 IP 连续 200 次请求**全 403** 且 `ip_abuse` 无新行；默认只列生效中、状态筛选与
  「已在黑名单」标注（含 CIDR）；解封粒度不再互删；审核通过后 `ip_abuse.banned_until` 为空且行保留；迁移幂等、
  prune 保留 90 天；权限 401/403、审计事件与批量回执；`npm test` / `frontend:build` / `scan` 全绿。
  部署侧按规格 §10.7 三条只读 SQL 复核。


## BK. ~~待开发：会话治理（登录会话列表/踢下线 + 过期清理 + 空闲超时与绑定）~~ → **已发布 v2.11.0（2026-11-12）**

**状态：已发布 v2.11.0（2026-11-12）**
**依赖：** 无（BK-1 / BK-2 可独立开工；BK-3 依赖 BK-2，见下方批次表）
**解锁：** 无
**规格**：[SESSION-MANAGEMENT.md](SESSION-MANAGEMENT.md)

- **现状（2026-11-12 核对）**：系统是服务端有状态会话——登录即写 `sessions` 行（`src/store/pg.js:1954-1963`），
  cookie `gp_session`（HttpOnly/SameSite=Lax，仅 https 加 Secure），每次请求按 `expires_at > now()` 校验
  （`pg.js:1966-1975`）；密码登录 7 天 / 勾「记住我」30 天（`server.js:902-904`）。但：① 没有会话列表与踢下线；
  ② **单条禁用用户不踢会话**（批量禁用会踢，`server.js:3517-3520`），且 `userBySession` 不查 `users.disabled`
  → 被禁用者旧 cookie 可继续用到 7/30 天后；③ 过期会话行无人清理（`purgeOldRows` 不含 sessions），
  用户列表「登录会话」计数也不过期过滤（`pg.js:1752`）→ 数字虚高、看着像"永不下线"；④ 只有 7/30 天固定到期，
  **没有空闲超时、没有 IP/UA 绑定**。
- **已确认决策（12 项）**：①「过一段时间必须重新登录」= **空闲超时 7 天** + 保持绝对上限（不勾记住我 7 天 / 勾 30 天）；
  ② 会话可视化与踢下线**只做后台**：全局列表 + 单条/批量踢 + 按用户踢全部；③ 列表全字段（IP/归属地、UA 摘要、
  设备码、创建、最近活动、到期、当前会话）+ 最近活动**每 token 每 5 分钟最多写一次**；④ 清理**并入现有 `prune`**
  （每周，不新建任务）；⑤ 审计 `session.*`；⑥ **IP 变化即失效**、**UA 变化即失效**；⑦ 前台加「退出其它所有设备」按钮；
  ⑧ 改密/重置全踢（现状）保持；⑨ B 组修复：单条禁用立即踢、`userBySession` 过滤 `disabled`、会话计数只算未过期、
  `prune` 清过期行；⑩ 不引入新依赖、不改记住我 7/30、不做前台设备列表页。
- **批次（顺序 BK-1 → BK-2 → BK-3）**：
  - **BK-1（B，独立，先做）**：单条禁用踢会话 + `userBySession` 过滤 `disabled` + 用户列表会话计数口径 + `prune` 清过期行；
  - **BK-2（A，独立）**：`sessions` 加列迁移（id/ip/ip_key/ua/ua_key/device_id/last_seen_at + 索引）、解析收敛为一次/请求、
    后台「账号与服务 → 登录会话」列表 + 单条/批量/按用户踢 + `last_seen_at` 节流 + 审计；
  - **BK-3（C，依赖 BK-2）**：空闲超时 7 天、IP/UA 绑定（失败即删会话）、`auth.sessionIdleDays` / `auth.sessionBindIp` /
    `auth.sessionBindUa` 设置项、前台「退出其它所有设备」、`prune` 扩展清空闲会话。
- **改动落点**：`src/store/pg.js`（migrate 加列、`userBySession`/`createSession`/会话列表与删除 SQL、`listUsers` 计数、
  `purgeOldRows`）、`src/server.js`（解析收敛、后台会话接口 + 单条禁用踢会话、`/api/user/sessions/revoke-others`、
  `BULK_ACTIONS['sessions/kick']`）、`src/cli.js`（prune 输出）、`src/settings.js`（3 个 auth 设置项）、
  `frontend/src/pages/Console.vue`（菜单）、`AdminModules.vue`（会话列表/批量/移动卡片）、`ChangePasswordPage.vue`（退出其它设备）、
  测试（新增 `test/sessions.test.js` 接入主链）。
- **验收**：见规格 §4——BK-1：禁用即踢 + 401、`disabled` 兜底、会话计数只算未过期、`prune` 删除过期行且幂等；
  BK-2：列表字段/筛选/分页/当前会话标记、**响应不含 token**、单条/批量/按用户踢生效且 401、权限 401/403、
  `last_seen_at` 5 分钟节流；BK-3：空闲 7 天失效（可设 0 关闭）、IPv4 /24 与 IPv6 /64 同段不误踢、UA 家族+主版本、
  老会话不被绑定校验踢掉、前台退出其它设备、改密/重置行为不倒退、`prune` 扩展、`npm test` / `frontend:build` / `scan` 全绿。


## BL. ~~待开发：增量回填吞吐与配额治理（候选去噪 + 429 软退出重排 + 每日节奏 + 失败隔离 + 观测）~~ → **已实现并发布 v2.11.1（2026-11-13）**

**状态：已发布 v2.11.1（2026-11-13，e734673；QA 报告 docs/QA-BACKFILL-THROUGHPUT-BL.md）**
**依赖：** 无（BL-1 / BL-2 可独立开工；BL-3 依赖 BL-1 的候选 SQL 与 BL-2 的进度文件，见批次表）
**解锁：** 无
**规格**：[BACKFILL-THROUGHPUT.md](BACKFILL-THROUGHPUT.md)

- **现象（2026-11-13 所有者）**：增量回填一周一次；手动点「立即运行」触发 429 后本轮直接结束，后面的不再同步；
  担心积压越来越多、429 越来越频繁。
- **根因（代码证据）**：① 候选 SQL 不排除"永远不会有价"的游戏——`free / coming_soon / region_locked / not_found`
  永远满足"无 Steam 报价"（`src/cli.js:1802-1812` + 六态口径 `src/store/pg.js:382`），每周重复入队白烧配额；
  ② 403/429 **整轮中止**（`cli.js:1834-1836/1852/1879`），而下一轮是 7 天后（`scheduler.js:211`）；
  ③ 429 前 `http.js` 会先睡冷却再重试（`http.js:298-303`、`:243-249`），一次 429 = 等 30 分钟 + 整轮作废；
  ④ AC-4 预算把回填按理论值算成约 8.3 分钟/天（`scheduler.js:350-352`），超预算只缩 `steam-status`
  （`:368-387`）——真实耗时被低估；⑤ 失败无隔离：每批都 `markBackfilled`（`cli.js:1907`），失败条目次日重新入选；
  ⑥ 观测缺口：调度状态无本轮进度/剩余/429 计数（`scheduler.js:434-467`）。
- **已确认决策（8 项）**：① 目标取**稳态**（直接每日小步，不做一次性追赶模式）；② 候选**排除四态**
  `free / coming_soon / region_locked / not_found`；③ 429 改**软退出**（本轮收尾、保留进度、不整轮失败）；
  ④ 429 后 **1 小时内自动重排**（每小时最多 1 次；连续 3 次放弃等日轮）；⑤ 节奏 **每天 1 轮、limit 5000**
  （原每周 1 轮 / 50000）；⑥ 同一 appid **连续失败 3 次 → 跳过 30 天**；⑦ 指标卡显示**待回填 / 已排除 / 跳过中**；
  ⑧ 任务卡显示**本轮进度 + 预计剩余天数 + 429 次数与最近时间**。
- **批次（顺序 BL-1 → BL-2 → BL-3）**：
  - **BL-1（独立）**：候选 SQL 去噪（四态 + skip 条件骨架）+ 节奏（`STEAM_BACKFILL_INTERVAL_MIN=1440`、
    `STEAM_BACKFILL_LIMIT=5000`）；AC-4 预算自动重算（≈5.8 分钟/天），不改预算分配；
  - **BL-2（独立）**：429 软退出（exit 75）+ partial 语义（不熔断）+ `data/scheduler-retry.json` 1 小时重排
    + `http.js` 首次 429 即落盘冷却（含 `at`）+ `data/backfill-progress.json` + 任务卡观测；
  - **BL-3（依赖 BL-1/BL-2）**：`games` 加 `backfill_fail_count`/`backfill_skip_until`、失败计数与 30 天跳过、
    `adminGameStats` 追加 3 字段与指标卡 3 张。
- **改动落点**：`src/cli.js`（候选 SQL、软退出、进度文件、失败计数）、`src/http.js`（429 落盘顺序与 `at`）、
  `src/scheduler.js`（`STEAM_429_RETRIES=0`、partial、retry 文件、status 字段）、`src/store/pg.js`（迁移、计数/跳过、
  `adminGameStats`）、`src/backfill.js`（进度读写）、`src/server.js`（`/api/admin/sync/status` 合并进度）、
  `frontend/src/pages/AdminModules.vue`（指标卡 + 任务卡）、对应测试。
- **验收**：见规格 §4——四态不入选、`no_price` 仍入选；默认每天 5000；429 退出码 75 且不熔断、1 小时重排生效、
  连续 3 次不再重排；首次 429 即写全局冷却；连续失败 3 次跳过 30 天；指标卡/进度/429 信息与库一致；
  迁移幂等、权限 401/403；`npm test` / `frontend:build` / `scan` 全绿。


## BM. ~~待开发：登录页硬跳 404（/login 未登记 SPA 回退）+ 会话失效跳转口径~~ → **已实现并发布 v2.12.0（2026-11-13）**

**状态：已发布 v2.12.0（2026-11-13，43063ef；QA 报告 docs/QA-SESSION-BM.md）**
**依赖：** 无（BK 已发布 v2.11.0，本条修它暴露的登录页路由缺口）
**解锁：** 无
**规格**：[SESSION-MANAGEMENT.md](SESSION-MANAGEMENT.md) §8

- **现象（2026-11-13 11:13，生产 v2.11.0）**：离开一段时间后回后台页（`/console?section=games`），再操作时整页跳到
  `/login?next=%2Fconsole%3Fsection%3Dgames`，页面只有纯文本 **`not found`**，无法登录。
- **根因（代码证据）**：① SPA 回退白名单没有 `/login`、`/register`、`/change-password`（`src/server.js:3750`），
  未命中路径落到旧 `web/` 目录 → `serveStatic` 返回纯文本 404（`:3726`）；全仓 `src/` 没有任何 `'/login'` 字符串；
  这三个页面是 AL 批（v2.1.0）新增的，白名单从未更新（`router/index.js:21-23`）。② 后台页 401 处理是
  `window.location.href='/login?next=…'` **整页跳转**（`AdminModules.vue:329`、`AdminExtras.vue:116`、`AdminLogs.vue:211`、
  `AnnouncementDrawer.vue:95`、`UserCreateDrawer.vue:76`），而前台首页是 `router.push` 软跳（`Home.vue:200`）——
  所以登录页平时"能用"，只有硬跳才 404。③ 会话失效来源：空闲超时 / IP·UA 绑定 / 自然到期；
  其中老会话的 `last_seen_at` 被迁移回填成 `created_at`（`src/store/pg.js:450-452`）→ 登录超过 7 天的会话
  在部署后第一次请求就被判空闲过期（`server.js:477-487`）。
- **已确认决策（4 项）**：**BM-1（P0）** 白名单补齐 `/login`、`/register`、`/change-password` + 一致性测试；
  **BM-2（P1）** 迁移改为老会话 `last_seen_at = now()`，今后部署不再"部署即登出"（已发生的不回滚）；
  **BM-3** 统一 401 为**软跳**：新增 `redirectToLogin(reason)`（`bypassNextGuard` + `router.push`，带 `next` 与 `reason`），
  5 处后台硬跳全部改用它，登录页提示「登录已过期，请重新登录」；
  **BM-4** **做心跳**：`useSessionHeartbeat` 在 `main.js` 挂一次，每 5 分钟 + 切回前台探测 `/api/me`，
  "上次已登录→这次未登录"才软跳；游客/离线/5xx 不跳，公开页不探测，不动会话策略。
- **改动落点**：`src/server.js`（白名单）；`src/store/pg.js`（迁移口径）；`frontend/src/utils/session.js`（新增
  `redirectToLogin`）、`frontend/src/composables/useSessionHeartbeat.js`（新增）、`frontend/src/main.js`（挂心跳）、
  `frontend/src/pages/LoginPage.vue`（`reason` 提示）、5 处 401 硬跳改为共享 helper（`AdminModules/AdminExtras/AdminLogs/
  AnnouncementDrawer/UserCreateDrawer`）、`Home.vue` 软跳补 `reason`；
  `test/serve.test.js`（页面路径 200 + 白名单一致性）、`test/session-heartbeat.test.js`（心跳/软跳静态断言，接入主链）。
- **验收**：见规格 §8.5——`/login`、`/register`、`/change-password` 直接打开/刷新返回 200 登录页；白名单一致性测试；
  会话失效后后台页正确回登录页且能登录回 `next`；5 处 401 行为一致、源码无 `window.location.href='/login`；
  登录页显示过期提示；心跳 ≤5 分钟/回前台即软跳、游客与离线不跳、公开页不探测、只一个定时器；
  迁移幂等；`npm test` / `frontend:build` / `scan` 全绿。


## BN. ~~待开发：BUG——价格历史区块整个不渲染（v-for 与 v-if 同元素导致渲染抛错）~~ → **已实现并发布 v2.12.1（2026-11-13）**

**状态：已发布 v2.12.1（2026-11-13，c0b1b4a；QA 报告 docs/QA-PRICE-HISTORY-BN.md）**
**依赖：** 无（AP 批已发布 v2.2.0，本条修它遗留的渲染缺陷）
**解锁：** 无
**规格**：[PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md) §10

- **现象（2026-11-13 所有者截图，生产 v2.11.0）**：打开有历史价格的游戏详情（HELLDIVERS™ 2），报价列表之后
  **整块空白**——「区间最低/区间最高/当前较史低/记录天数」指标条、「价格历史」标题、趋势线、表格、
  「暂无历史记录」全都不见；`当前最低/历史最低/各区服报价` 正常（数据没丢）。
- **根因（代码证据）**：`frontend/src/components/PriceHistoryReport.vue:109` 的
  `<circle v-for="(p, i) in filtered" v-if="p.price_cents === histLow" …>` 把 `v-for` 与 `v-if` 写在同一个元素上；
  Vue 3 里 `v-if` 优先级更高，编译后把判断提到 `renderList` **外面**（`@vue/compiler-dom` 实测产物：
  `(_ctx.p.price_cents === _ctx.histLow) ? _renderList(_ctx.filtered, (p,i)=>…) : …`），`p` 在循环外不存在 →
  运行时 `TypeError: Cannot read properties of undefined (reading 'price_cents')` → **整个组件渲染失败**
  （连空态一起消失）。该写法自 AP 批 `282d018` 起就存在；现有测试只做静态字符串断言、还把坏写法当成预期
  （`test/price-history-report.test.js` 断言 `p.price_cents === histLow`），所以没拦住。
- **已确认决策（2 项）**：① 模板不再混用——低点圆点改为 JS 预计算 `lowDots`（数据 + 坐标），模板只保留 `v-for`；
  `chart` 同时产出点数组，去掉模板里的 `split(' ')` 二次解析；② 补**会渲染**的回归测试（compile 级或 SSR 级），
  旧写法放回去必须红。
- **改动落点**：`frontend/src/components/PriceHistoryReport.vue`（`chart` 返回 `pts`、新增 `lowDots`、模板改 `v-for`）、
  `test/price-history-report.test.js`（删"坏写法当预期"的断言；加「同元素禁止 v-for+v-if」与编译级/渲染级断言）。
- **验收**：见规格 §10.4——有历史游戏：指标条/趋势线/表格全部出现、史低高亮正确、Console 无 TypeError；
  无历史游戏：显示「暂无历史记录」；区间切换与分页正常；新测试能复现旧 bug（旧写法→红）；
  `npm test` / `frontend:build` / `scan` 全绿；部署侧打开有历史详情 Console 干净。


## BO. ~~待开发：价格历史删掉日期表格 + 趋势线加高到 150px~~ → **已实现并发布 v2.13.0（2026-11-13）**

**状态：已发布 v2.13.0（2026-11-13，257a2a6；QA 报告 docs/QA-PRICE-HISTORY-BO.md）**
**依赖：** BN（已发布 v2.12.1，本条在其修复后的组件上做界面精简）
**解锁：** 无
**规格**：[PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md) §11

- **需求（2026-11-13 所有者）**：趋势线下面的「日期 / 当日最低 / 较前一日 / 标记」表格和趋势线是同一件事，重复占地方、
  还要滚动 → **表格不要显示**；把空间给趋势线（选定方案 B）。
- **已确认决策（4 项）**：① 删除日期表格（桌面 `<table>` + 移动端卡片 + 分页条，连带 `page/PAGE_SIZE/paged/totalPages/isNarrow`）；
  ② 趋势线 **76px → 150px**（移动端 120px）；③ 加**史低虚线参考线** + 轴标签（左 `¥区间最低 · 史低线`、右 `区间 首日 → 末日`）；
  ④ 保留 4 张指标卡、区间切换（30/90/全部）、史低圆点、底部说明（改为当前区间条数 +「史低已标出」）。
- **改动落点**：`frontend/src/components/PriceHistoryReport.vue`（删表格/卡片/分页与相关 computed；`chart` 补 `lowY/minV/maxV`；
  SVG `viewBox 840×150`；平线垂直居中；参考线与轴标签）、`frontend/src/styles/main.css`（删未使用的 `.phr-table/.phr-cards` 样式）、
  `test/price-history-report.test.js`（删 `phr-cards`/表格断言，加"无 table/phr-table/phr-pager"、`viewBox="0 0 840 150"`、
  `史低线`、`stroke-dasharray`；保留 BN 的 v-for+v-if 扫描与编译级回归）。
- **验收**：见规格 §11.4——有历史详情只有指标卡 + 区间切换 + 150px 趋势线（含参考线/轴标签）+ 底部说明，**无表格/卡片/分页**；
  区间切换后趋势线、轴标签、条数同步变化；移动端 120px 无表格；无历史仍显示「暂无历史记录」；平线垂直居中；
  史低圆点数量不变；`npm test` / `frontend:build` / `scan` 全绿；部署后线上 Console 干净。


## BP. ~~待开发：游戏详情·DLC 总数与列表（含价格/购买链接，不含拥有状态）~~ → **已实现并发布 v2.14.0（2026-11-13）**

**状态：已发布 v2.14.0（2026-11-13，98d75e9；QA 报告 docs/QA-GAME-DLC-BP.md）**
**依赖：** 无（BO 是价格历史区块，与本条不同组件；都在详情弹窗，并行时注意 `Home.vue` 只 BP 加一行）
**解锁：** 无
**规格**：[GAME-DLC.md](GAME-DLC.md)

- **需求（2026-11-13 所有者）**：游戏详情里能看到「这个游戏已出的 DLC 数量」和「DLC 列表（哪些在售、多少钱）」。
- **硬约束（先决事实）**：**Steam 公开 API 不返回 DLC 拥有数据**（`GetOwnedGames` 只有游戏条目）——
  项目 v1.7.0 的 DLC 列因此恒为 0、v1.8.0 已下线（[STEAM-DLC.md](STEAM-DLC.md) §2/§3、README「已知限制 11」）。
  所有者确认：**不做拥有状态**，只做总数 + 列表，并明确标注"Steam 不提供 DLC 拥有数据"。
- **已确认决策（8 项）**：① 不做拥有状态；② 口径 = `appdetails.dlc[]` 全部（含原声带/美术集/未发售）；
  ③ **详情弹窗内直接展示 DLC 列表**（详情最下方、分页 10），每行带 `Steam ↗` 跳
  `https://store.steampowered.com/app/<appid>/`——**不另开抽屉**（所有者 2026-11-13 追加）；
  ④ 总数入库**并入 `steam-status`/`backfill`**（同一次 appdetails 顺带写，零额外请求，不新建定时任务）；
  ⑤ 列表要**价格 + 折扣 + 购买链接**（`GetItems` CN/CNY 批量取）；
  ⑥ 明细以定时补齐为主，打开详情缺明细允许**读路径回源一次**（≤3 批、按游戏 10 分钟节流、失败降级）；
  ⑦ 不引新依赖、不做 DLC 到价提醒/史低/愿望单；⑧ 非 Steam 游戏不显示 DLC 区块。
- **改动落点**：`src/store/pg.js`（`games.dlc_appids` + `game_dlc` 迁移、upsert/差集、分页查询）、
  `src/adapters/steam-meta.js`（`normalizeOfficial` 提取 `dlcAppIds`）、`src/steam-status.js`（顺带写 + 收尾补明细）、
  `src/cli.js`（backfill appdetails 路径写入）、`src/adapters/store-browse.js`（复用 `fetchStoreItems`）、
  `src/server.js`（详情 `dlc` 摘要 + `/api/games/:appid/dlc` + 回源节流）、
  `frontend/src/pages/Home.vue`（详情最下方内联 DLC 列表：分页 10、Steam 跳转、移动端卡片）、对应测试。
- **验收**：见规格 §4——`dlc_appids` 去重/过滤/上限、GetItems 不清空已有值；`game_dlc` 名称/价格/折扣/在售与差集清理；
  详情 `dlc.total/synced/filled`；列表分页 10（上限 50）/名称升序/`buy_url`；回源 ≤3 批 + 10 分钟节流 + 失败不 5xx；
  前端详情内联列表可用、翻页正常、每行可跳 Steam、明确"不提供拥有数据"、移动端卡片、非 Steam 无区块；
  `steam-status` 一轮后缺失数下降、日志可查、**不新增调度任务**；`npm test` / `frontend:build` / `scan` 全绿。


## BQ. ~~待开发：申诉邮件内一键「信任 / 封禁」~~ → **已发布 v2.16.0**

**状态：已发布 v2.16.0（2026-11-14，随 O 同批；实现 7c15e50 + 修复 0576bc7；QA 报告 docs/QA-APPEAL-OBQ.md 第 2 轮 ✅ 放行）**
**依赖：** O 段——已随本批完成，解阻塞；第 1 轮打回原因在 O（`/api/captcha` 未放行封禁拦截），BQ 本身验收 9–17 全过
**解锁：** 无
**规格**：[APPEAL-SYSTEM.md](APPEAL-SYSTEM.md) §10（10.1 决策 / 10.3 接口 / 10.4 确认页 / 10.7 验收）
**开发汇报**：[DEV-BRIEF-APPEAL.md](DEV-BRIEF-APPEAL.md)（O + BQ 的 17 个功能点、接口/邮件清单、6 步顺序，交接用）

- **需求（2026-11-13 所有者）**：用户发起申诉时给管理员邮箱发信，**管理员在邮件里直接「信任」或「封禁」**，不必登录后台。
- **已确认决策（5 项，均在对话中由所有者选定）**：① 邮件里两个动作——**信任（解封 IP+设备）**、**拒绝（继续封）**；
  ② 点链接先到**确认页**，再点按钮才执行（防邮件预取/安全扫描误触）；③ 链接 **14 天**有效、**处理一次即失效**；
  ④ **token 即凭据、不要求登录**（只对一条申诉有效）；⑤ 收件人**沿用「申诉邮箱」设置**回退链，不新增设置。
- **实现要点**：`appeals` 加 `action_token_hash`（只存 sha256）/`action_expires_at`/`handled_via`；
  新增 `POST /api/appeal/action`（`preview|trust|reject`，POST-only、无 GET 副作用）并在封禁拦截里放行；
  邮件模板正文顶部加两个按钮链接 `https://<域名>/appeal/act#t=<token>`（token 放 fragment，不进访问日志/Referer）；
  新增确认页 `AppealActionPage.vue` + 路由 `/appeal/act` 并登记 `FRONTEND_PAGES` 与 `test/serve.test.js`；
  拒绝可填理由（预填默认文案）；与后台共用状态机（先到先得，后到显示「已处理」）。
- **验收**：见规格 §10.7 第 9–17 条（邮件按钮 → 确认页零副作用 → 信任/拒绝生效 → 重复点幂等 → 过期/伪造 token 统一 404 →
  SMTP 未配仍可用 → `npm test` / `frontend:build` / `scan` 全绿；**不自行构建**）。






















## BR. ~~待开发：封禁自助恢复 + 手机/CGNAT 适配 + 可观测~~ → **已发布 v2.16.0**

**状态：已发布 v2.16.0（2026-11-14；实现 b8ee317 + 验收断言 edcaaa7；QA 报告 docs/QA-BAN-BR.md 第 1 轮 ✅ 放行）**
**依赖：** 无
**解锁：** 无
**规格**：[BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md) §11（11.2 决策 / 11.3 参数 / 11.7 验收）

- **触发（2026-11-13，生产 v2.12.1）**：手机端「访问几次就被封」；把手机 IP 加进白名单后**仍**提示
  「请求过于频繁（封禁中）」。
- **只读核查结论**：该文案唯一对应 `src/ratelimit.js:266` —— **该 IP 正处于临时超频封禁期内**（不是黑名单/设备/当天封，
  三种文案不同）；白名单是整段跳过拦截的，所以"加白仍封"只能是**当前请求 IP 不在白名单**（手机 CGNAT 出口漂移 / 加错 IP）；
  而系统**没有给用户任何自查手段**（`/api/ban/state` 不告诉自己是谁、在不在白名单）。
- **已确认决策（4 项，所有者 2026-11-13 点头）**：
  ① **加白即清封**（写白名单时清内存临时封禁，响应回 `clearedBan`）；
  ② **`/api/ban/state` 返回自查三件套**（`ip` / `whitelisted` / `until`）；
  ③ **封禁页可读**（剩余时间 + 脱敏 IP + 申诉入口）；
  ④ **手机/CGNAT 适配**：页面桶与 API 桶分离，封禁期内**页面 GET 不累计升级计数**，阈值走设置项
  （默认：页面 120/分、API 150/分、资源 300/分）。
- **改动落点**：`src/ratelimit.js`（分桶 + 升级只计 API）、`src/settings.js`（`security.rateLimit.pageMax/apiMax`）、
  `src/server.js`（`ban/state` 三件套、`banIpExclusiveSql(trust)` 加 `clearBanMemory` 与 `clearedBan`、`denyBanned` 加
  `remainingSec/ipMasked`）、`frontend/src/pages/BanPage.vue`（文案）、控制台加白提示、对应测试。
- **验收**：见规格 §11.7 第 1–6 条（封禁页可读 + 加白立即恢复 + 白名单不被升级 + 手机正常浏览不误封 + 三振/黑名单语义不变 +
  `npm test` / `frontend:build` / `scan` 全绿；**不自行构建**）。

## BS. ~~待开发：安卓 App（TWA，不上架）+ 可清缓存离线 + 双通道分发~~ → **已实现并发布 v2.17.0（2026-11-14，站点侧）**

**状态：已过时停发（2026-11-17 被 CA/CG 原生 App 取代，App tag app-v2.19.0 已发布；旧 TWA 包不再发布）**
**依赖：** 无（推翻了 [MOBILE-PWA.md](MOBILE-PWA.md) §1 决策 #1「不上架、不打 APK、不引入 Android 工具链」与 §3「不加 service worker」，所有者 2026-11-14 确认）
**解锁：** 先补服务端静态白名单（`/.well-known/assetlinks.json`、`/sw.js`、`/app/*.apk`），否则 TWA 退化带地址栏、离线不生效、APK 下不到
**规格**：[MOBILE-APP-TWA.md](MOBILE-APP-TWA.md)

> **2026-11-16 后续决策：已被 CA（原生 Android App）取代，TWA 停发；旧 TWA 用户可同包名/同签名直接覆盖安装原生 App。**
- **需求（2026-11-14 所有者）**：做一个不上架商店的安卓 App；要比 PWA 更像 App、点 Steam 外链不整页跳出；
  同时接受"可清缓存"的离线，并要能从站点和 GitHub 两处下载。
- **已确认决策（8 项）**：① 只做 Android；② 允许引入 Android 工具链（JDK 17 + cmdline-tools + SDK，密钥不入库）；
  ③ 方案 **TWA（Bubblewrap）**，不重写界面；④ **双通道分发**：站点 `/app` 下载页（APK 托管自家服务器 + SHA-256）+ GitHub Release；
  ⑤ **离线做但要"可清缓存"**：只缓存 `/assets/*` 与封面图，HTML/API 永不缓存，版本变化清缓存 + 顶部提示；
  ⑥ 原生能力接受 Web 方案（`navigator.share` + 浏览器下载），**不换 Capacitor 壳**；
  ⑦ Bubblewrap 生成的 `android/` 工程**入库**（签名密钥不入库；构建产物 `android/app-release*.apk` 不入库，**交付包入库**见下条）；⑧ **不做推送与角标**（TWA 无原生推送，Web Push 依赖 FCM 国内不可达）。
- **APK 交付（2026-11-14 追加确认，方案 A）**：签名包**入库**到 `frontend/public/app/steamdeals-<version>.apk` + `latest.json`，
  Vite 构建时进 `dist/` → 随镜像发布，**构建+部署后 `/app` 页即可下载，无需额外部署步骤**；只保留最近 3 个版本；
  `.gitignore` 只忽略 `android/app-release*.apk`，**不能写 `*.apk`**（否则交付包提交不进去）。
  **顺序固定**：出 APK → 入库 + 更新清单 → 提交推 main → 所有者下令「构建 vX.Y.Z」→ CI 镜像 → 部署可用。
- **实现要点**：`/.well-known/assetlinks.json`（包名 `cn.yyliucha.steamdeals` + keystore SHA-256）、`/sw.js`、`/app/*.apk`
  三处都要进 `src/server.js` 的 `frontendDir` 静态白名单并补 `test/serve.test.js` 断言（本项目"构建成功但线上 404"的老坑）；
  SW 只缓存带 hash 的资源，导航请求始终走网络；`GET /api/app/latest` 提供版本/SHA-256/大小；
  新增 `/app` 下载页并登记 `FRONTEND_PAGES`；站内 Steam 链接统一 `target="_blank"` 交给 Custom Tabs；
  versionName 跟随 `/api/site`，versionCode 按 `major*10000+minor*100+patch`；
  收尾把 `MOBILE-PWA.md` §1 决策 #1 与 §3 标注"已被 BS 推翻，策略见 MOBILE-APP-TWA.md §4"。
- **验收**：见规格 §8 第 1–12 条（全屏无地址栏 / 外链走 Custom Tabs / 登录态独立 / 返回键关浮层 / 版本提示与清缓存 /
  断网不返回旧页面 / `/app` 页可下载并校验 SHA-256 / assetlinks+sw 有测试断言 / GitHub Release 可用 /
  **镜像内含 APK（`frontend/dist/app/` 有包）+ `.gitignore` 不忽略交付包** /
  不放宽安全策略 + `npm test` + `frontend:build` + `scan` 全绿；**不自行构建站点版本**）。


## BT. 待开发：手机端点「登录」不出现登录页（浮层 history 竞态）→ 登录入口改硬跳

**状态：质检通过（2026-11-16，eba879c；QA 报告 docs/QA-LOGIN-ENTRY-BT.md 第 1 轮 ✅ 放行；验收 1/4/8 真机复核随部署侧）**
**依赖：** 无（与移动端重设计解耦，可单独发）
**解锁：** 无（移动端登录页重做 / 前台 / 后台重设计另批，建议本条先上）
**规格**：[MOBILE-LOGIN-ENTRY-FIX.md](MOBILE-LOGIN-ENTRY-FIX.md)

- **现象（2026-11-16 所有者真机，小米浏览器）**：首页 →「我的」底部面板 → 点「登录」→ **面板关闭后什么都不发生**，
  登录页（账号/密码页）不出现；直接打开 `/login` 正常。
- **根因（代码证据）**：手机面板的登录按钮是 `mySheet=false;goLogin()`（`Home.vue:78`），`goLogin()` 用
  `router.push({path:'/login'…})`（`Home.vue:133-134`，promise 未处理）；面板一关，返回键守卫 `release()` 会
  `window.history.back()`（`useBackGuard.js:27-36/46-61`）→ **把刚 push 的 /login 退回去**；登录页还是懒加载路由
  （`router/index.js:24`），chunk 失败时 `router.push` 也会静默中止。小米浏览器的 history/popstate 时序让它稳定复现。
  **不是会话/cookie 问题，也不是登录接口问题。**
- **已确认决策（方案 C）**：① 登录入口改为**整页硬跳** `location.assign('/login?next=…')`，不依赖 SPA 路由与浮层历史栈；
  ② **所有进入登录页的入口统一**走同一个 helper（桌面「登录」、手机「我的」面板、未登录点搜索/愿望单、401 会话失效跳转）；
  ③ 加 `router.onError` 兜底：懒加载 chunk 失败时整页重载目标路由（同路径每会话只一次）；
  ④ 登录页仍保持 SPA，登录成功 `router.replace(next)` 不变；⑤ 本批**不改登录页视觉/交互**。
- **改动落点**：新增 `frontend/src/utils/login-entry.js`（`openLogin()`：next 安全 + reason）；
  `frontend/src/pages/Home.vue`（`goLogin()` 改调 `openLogin`）；`frontend/src/utils/session.js`
  （`redirectToLogin` 改走 `openLogin({reason})`，去掉动态 import router / bypassNextGuard）；`frontend/src/main.js`
  （`router.onError` chunk 兜底）；新增前端静态断言测试。
- **验收**：见规格 §6——小米浏览器真机点「登录」能出现登录页并登录成功；入口矩阵（桌面/手机面板/未登录 Tab/401）全部可达；
  带 `next` 登录后回原页；chunk 失败自动硬载一次且不循环；返回键不卡死；`next` 只接受站内相对路径；
  注册/改密站内跳转不回归；`npm test` / `frontend:build` / `scan` 全绿；部署后真机复测。


## BU. ~~依赖阻塞：移动端登录页重做~~ → **已过时（2026-11-16：CA 原生 App 决策后，手机前台只给下载页）**

**状态：已过时（2026-11-16 被 CA 取代；桌面 web 登录页维持现状）**
**效果图：** [MOBILE-REDESIGN.md](MOBILE-REDESIGN.md) §10（2026-11-16 已确认）
**依赖：** BT（登录入口硬跳，未完成）
**解锁：** BV（前台重设计的登录/我的页风格）
**规格**：[MOBILE-REDESIGN.md](MOBILE-REDESIGN.md) §3

- 需求：按移动端重做登录页——全屏单列、48px 输入/主按钮、键盘弹出时主按钮吸附底部、验证码图可刷新，
  底部带「下载安卓版 App」与注册入口；已登录访问 `/login` 直接回首页。
- 验收：见规格 §3.2——小米浏览器/iPhone Safari/微信/Chrome 均可登录；键盘不遮挡；验证码失败可重试；
  `reason=expired` 提示；`next` 只接受站内相对路径；桌面端不变；`npm test` / `frontend:build` / `scan` 全绿。


## BV. ~~依赖阻塞：前台移动端重设计（底部 Tab）~~ → **已过时（2026-11-16：CA 决策，手机前台只给下载页）**

**状态：已过时（2026-11-16 被 CA 取代；前台移动 web 不再建设）**
**效果图：** [MOBILE-REDESIGN.md](MOBILE-REDESIGN.md) §10（2026-11-16 已确认）
**依赖：** BU（登录页与"我的"页风格）
**解锁：** 无
**规格**：[MOBILE-REDESIGN.md](MOBILE-REDESIGN.md) §4

- 需求：前台手机端换成底部 Tab 架构——首页单列大卡、搜索独立页（含历史）、愿望单页、我的页；
  详情改全屏页（`/game/:appid`，桌面回落到首页弹窗）；通知/登录/注册/改密沿用新风格；桌面端不变。
- 验收：见规格 §4.3——四 Tab 切换不写 history；详情返回保留滚动与筛选；首页加载更多；未登录点愿望单进登录页（硬跳）；
  微信内可浏览/登录/看详情、无横向溢出；桌面端一致；`npm test` / `frontend:build` / `scan` 全绿。


## BW. 待开发：后台移动端重设计（☰ 抽屉 + 表格全卡片 + 批量吸底 + 表单全屏）

**状态：质检通过（2026-11-16，605e05a + 打回修复 8817207；QA 报告 docs/QA-CONSOLE-MOBILE-BW.md 第 2 轮 ✅ 放行；真机验收 3 项随部署侧）**
**范围（2026-11-16 CA 决策后）：仅 `/console` 后台手机端；前台手机浏览器改为 `/app` 下载页，前台移动 web 不再建设。**
**效果图：** [MOBILE-REDESIGN.md](MOBILE-REDESIGN.md) §10（2026-11-16 已确认）
**依赖：** 无（可与 BV 并行）
**解锁：** 无
**规格**：[MOBILE-REDESIGN.md](MOBILE-REDESIGN.md) §5

- 需求：`/console` 手机端侧栏收进 ☰ 抽屉（沿用 5 分组 13 模块）；内容区表格全部改卡片（保留筛选/排序/分页 20）；
  批量操作改吸底条；表单/编辑改全屏抽屉；统计页单列图表；桌面端不变。
- 验收：见规格 §5.3——13 模块都可进入，抽查游戏管理/访问记录/用户管理/系统设置/操作日志可完成核心操作；
  卡片字段与桌面表格一致；批量计数与回执正确；表单保存/取消正确；危险操作有确认；桌面端一致；
  `npm test` / `frontend:build` / `scan` 全绿。


## BX. ~~待开发：手机浏览器首访「下载安卓 App」提示~~ → **已过时（2026-11-16：手机访问直接给下载页）**

**状态：已过时（2026-11-16 被 CA 取代；首访提示由“手机访问即下载页”替代）**
**依赖：** 无
**解锁：** 无
**规格**：[MOBILE-REDESIGN.md](MOBILE-REDESIGN.md) §6

- 需求：安卓浏览器（非微信、非 standalone）首次访问在底部 Tab 上方弹一次「📱 安卓版 App 已上线 · 下载」；
  点下载进 `/app`（记录 seen），点 × 永久不再弹（记录 dismissed）；**微信 / iOS 不弹**；不复用 beforeinstallprompt。
- 验收：小米浏览器首访出现一次、关闭后不再出现、点下载进 `/app`；微信/iOS 不出现；TWA standalone 不出现；
  清 localStorage 后可重新出现；`npm test` / `frontend:build` / `scan` 全绿。


## BY. 待开发：安卓 App 内置更新（检测 → 提示 → 下载 → 用户确认安装）

**状态：质检通过（2026-11-16，92cae3e + 第 1 轮打回修复 8585dba；QA 报告 docs/QA-APP-UPDATE-BY.md 第 2 轮 ✅ 放行；真机 2 项随部署侧：安装确认/覆盖升级数据保留、GitHub 兜底实测）**
**依赖：** 无（BS 已发布 v2.17.0 / app-v2.16.0；批内 BY-1 服务端字段先行，BY-2 依赖 BY-1）
**解锁：** 无
**规格**：[MOBILE-APP-UPDATE.md](MOBILE-APP-UPDATE.md)

- **现状（2026-11-16 核对）**：网页内容有版本提示（`useVersionGuard`「已更新，点击刷新」），但 **APK 本体没有内置更新**——
  BS 规格 §3.4 明确「App 内检查更新只做提示 + 打开发布页，不做静默安装」；当前 `LauncherActivity` 是 Bubblewrap
  默认模板、无更新代码；`latest.json`/`/api/app/latest` 也**没有 versionCode**。用户只能手动去 `/app` 重新下载。
- **为什么必须动原生**：TWA 里跑 Chrome，网页**读不到已安装 APK 的版本号**、也**没有安装 APK 的权限**；
  "检测→下载→安装"只能由原生做，但仍保持 TWA/Bubblewrap，**不换壳**。
- **已确认决策（5 组）**：① 加原生更新模块（不换壳）；② 检查时机 = 启动 + 回前台（每 24h 最多一次）+「我的」页手动入口；
  ③ 策略 = 可选中「稍后/忽略此版本」，低于 `minVersionCode` 时强制；④ 下载 = 站点优先、GitHub 兜底、默认仅 Wi-Fi（可手动用流量）；
  ⑤ 元数据 = `latest.json` / `/api/app/latest` 增加 `versionCode` + `notes` + `minVersionCode`。
- **改动落点**：`frontend/public/app/latest.json`（新字段）+ `src/server.js`（`/api/app/latest` 透传）；
  `android/` 工程（`LauncherActivity`/新增 update 模块：检查、原生对话框、DownloadManager 下载、SHA-256 校验、
  `PackageInstaller`/FileProvider 安装、`REQUEST_INSTALL_PACKAGES`、Android 8+ 未知来源引导、忽略版本记录、
  站点→GitHub 回落）；`AndroidManifest.xml`（权限 + `steamdeals://check-update` intent-filter）；
  `frontend`（「我的」页「检查更新」链接 + 1.5s 回落 `/app`）；发版清单与文档（MOBILE-APP-TWA/DELIVERY/README）。
- **验收**：见规格 §6——`latest.json`/接口字段正确；旧版启动出现原生更新对话框（版本/大小/说明）；
  「稍后/忽略此版本」行为正确、低于 `minVersionCode` 强制；默认仅 Wi-Fi、SHA-256 校验失败删除并提示；
  同一签名覆盖升级成功、数据保留；「我的→检查更新」可用、浏览器回落 `/app`；站点不可达回落 GitHub；
  `npm test` / `frontend:build` / `scan` 全绿。**注意**：2.16.0 及更早的 App 没有更新模块，需手动装一次新版后才会收到提示。


## BZ. ~~依赖阻塞：App 代码仓库拆分~~ → **已过时（2026-11-16：CA 直接新建独立 App 仓库）**

**状态：已过时（2026-11-16 被 CA 取代；不再迁移 android/）**
**依赖：** BY（App 内置更新，未完成；避免同时迁移原生模块）
**解锁：** 无
**规格**：[MOBILE-APP-REPO-SPLIT.md](MOBILE-APP-REPO-SPLIT.md)

- **诉求（2026-11-16 所有者）**：App 代码新开一个 GitHub 仓库。
- **已确认决策**：① `android/` 拆到独立**公开**新仓库（建议名 `steamdeals-app`），只放 Android 工程 + 构建说明 + Release；
  ② 规格 / TODO / 发版清单**仍留站点仓库**（唯一排期来源）；③ APK 由**站点 CI 从 app 仓库 Release 拉取**并生成 `latest.json`，
  国内用户仍从站点 `/app` 下载；④ **BY 完成后**再执行；⑤ 架构维持 TWA（不换壳），包名 / 签名 / `assetlinks` 指纹 / `app-v` tag 规则不变。
- **改动落点（执行时）**：新仓库迁入 `android/` + 独立 CI（签名密钥走 GitHub Secrets，Release 上传 APK+sha256）；
  站点仓库删除 `android/`、不再提交 APK、新增 `scripts/fetch-app-release.mjs`（按显式 `APP_RELEASE_TAG` 拉取 + 校验 + 写 latest.json）、
  两个 docker workflow 在 `vite build` 前执行；`/api/app/latest` 与 `/app` 页不改；DELIVERY 发版步骤拆两段。
- **验收**：见规格 §4——新仓库独立构建同签名 APK/Release；站点 CI 拉取后 `/app` 可下载、`/api/app/latest` 正确（含 BY 字段）；
  站点仓库不再含 `android/` 与 APK 二进制；全流程（app tag → 站点构建 → 部署 → 下载 → App 内更新）回归；
  包名/签名/assetlinks 不变；站点侧 `npm test` / `frontend:build` / `scan` 全绿。




## CA. ~~待开发：原生 Android 的站点侧（Token/API + Web 手机端改造，不含 Android 工程）~~ → **已发布 v2.22.0**

**状态：已发布 v2.22.0（2026-11-17，CA-5 实现 09af208。CA-1 质检 ✅ docs/QA-CA1.md 第 1 轮；CA-5 质检 ✅**
**docs/QA-CA5.md 第 1 轮——手机前台跳转开关（默认关闭）/ 微信提示 / /app 改版，通过 9 / 缺失 0 / 偏差 0 / 需人工确认 1）**
**依赖：** 无（CA-5 手机前台跳转开关默认关闭，等 CG 发布后开启；旧 TWA 退场归 CG）
**解锁：** CG（Android 工程）；**取代**：BS（TWA）、BU/BV/BX（移动 web 重设计）、BY（TWA 内置更新）、BZ（拆 android/）；BW 保留（仅后台手机端）
**规格**：[APP-NATIVE.md](APP-NATIVE.md)（§3 CA-1 / §5 CA-5）

- **需求（2026-11-16 所有者）**：App 与 Web 完全拆开（代码/仓库、页面、部署、认证独立），数据库共用；App 改原生 Android，
  页面与 web 不同；手机浏览器前台只给 App 下载页；App 第一期功能与 web 对齐。
- **已确认决策（5 组）**：① 完全拆分（四独立）；② 共用同一 PG，经同一后端 API（App 不直连 DB）；③ Android 工程（CG）用原生 Kotlin + Compose；CA 只做站点侧；
  ④ 手机浏览器前台 → `/app`（`/console`、`/login`、`/app` 豁免），微信内给“在浏览器打开”提示；⑤ 先规格 + 效果图再开发。
- **改动落点（CA，仅站点侧）**：后端 `src/server.js`（Bearer Token 中间件、`/api/auth/token`、`/api/auth/token/revoke`、
  `/api/app/*` 前缀重写（精确例外 `/api/app/latest`、`/api/app/status`；只对该前缀豁免黑名单/设备封禁）、`/api/app/status`、
  `/api/app/latest` 补 `versionCode`/`minVersionCode`/`notes`）、`src/store/pg.js`（`api_tokens` 表 + 迁移）、
  **`docs/APP-API.md` 契约已产出**（App 唯一接口口径）；
  Web 侧手机 UA 跳转（**默认关闭的开关**，等 CG 发布后开启）、`/app` 页改版（暂保留现有 APK 下载）、微信内“在浏览器打开”提示；
  **不建 Android 仓库、不做 APK**。
- **验收（CA）**：见规格 §3/§5——Token 登录/过期/撤销/限流/审计；`/api/app/*` 黑名单/设备封禁豁免但保留基础限流；
  Web 侧手机跳转开关可开/关、微信提示、`/app` 页可下载现有包；桌面/移动 Web 行为符合 §5；`npm test` / `frontend:build` / `scan` 全绿。
- **进度（2026-11-17）**：**CA-1 已实现待发版**——`api_tokens` 表 + Token 签发/撤销 + `/api/app/*` 前缀重写（例外 latest/status）+ `/api/app/status`；
  契约 docs/APP-API.md；测试 test/app-token.test.js（主链）+ test/api.test.js（生命周期真跑）；质检 ✅ 放行（docs/QA-CA1.md，第 1 轮，通过 12/缺失 0/偏差 0/需人工确认 1）。
  **CA-5 已实现待发版**——`src/settings.js`（`app.mobileRedirectEnabled`，默认关闭，等 CG 发布后开启）、`src/server.js`
  （手机 UA + 前台页面 302 → `/app`，豁免 console/login/register/app/banned/appeal/setup/change-password 与 /api/*，日志 `http.mobile_redirect`）、
  `frontend/src/pages/AppDownloadPage.vue`（改版为主推原生 App + 微信 UA 显示「右上角 → 在浏览器打开」提示 + 保留现有 APK 下载）、
  test/serve.test.js（跳转生命周期真跑）+ test/frontend-mobile.test.js（页面静态断言）+ test/settings.test.js（86 项）；旧 TWA 停发归 CG 收尾。


## CG. ~~依赖阻塞：原生 Android App（CA-2~4，独立仓库 steamdeals-app）~~ → **已发布 app-v2.19.0**

**状态：质检通过（2026-11-17 第 1 轮，docs/QA-CG.md 未提交。App 仓库 `steamdeals-app` 本地 main，**
**提交 cd2aaec → 0a07994 → a3dd168；六屏模拟器走查 + 覆盖安装 + 封禁/更新全链路验证，通过 22 / 缺失 0 / 偏差 0 /**
**需人工确认 4（均为 CA 站点侧部署项）；App 仓库尚未推 GitHub，remote 待所有者定）**
**依赖：** CA（Token/API、`/api/app/*` 契约）
**解锁：** CA-5 的手机前台跳转开关、旧 TWA 退场
**规格**：[APP-NATIVE.md](APP-NATIVE.md) §4（技术栈/页面/更新/游客模式）

- 范围：新建仓库 `steamdeals-app`（Kotlin/Compose + OkHttp/kotlinx.serialization + Coil + DataStore）；
  CA-2 骨架/登录/Token 持久化；CA-3 首页/搜索/详情（DLC/历史）；CA-4 愿望单/我的/通知/主题/内置更新；
  启动 `/api/app/status` 命中黑名单/设备封禁 → 「你已经被封禁」+「已知晓」→ 退出；游客可浏览，用户操作弹登录，
  `pendingAction` 登录后自动完成一次；包名复用 `cn.yyliucha.steamdeals` + 现有 keystore；管理界面后置。
- 验收：见 APP-NATIVE §7 的 Android 项——六屏可走通、游客模式、`pendingAction`、启动封禁提示、同签名覆盖旧 TWA、内置更新；
  APK 构建由 Android 工具链完成；旧 TWA 停发在 CG 收尾处理。
- **实现记录（2026-11-17）**：包名 `cn.yyliucha.steamdeals`、minSdk 24/targetSdk 36、versionCode 21900（>旧 TWA 21800）、
  同 keystore 签名（指纹 `48a30df9…` 与旧包一致）；接口全部按 APP-API.md 走 `/api/app/*`（`X-Device-Id` 头由安装时
  生成的 UUID 提供）；登录 Token/主题/搜索历史落 DataStore；验证码 SVG 渲染为位图；价格历史用 Compose Canvas 原生绘制；
  内置更新沿用 BY 契约（versionCode/notes/minVersionCode、Wi-Fi 默认、SHA-256 校验、系统安装确认、白名单主机）；
  模拟器（API 35，WHPX）联调本地后端走通六屏：游客浏览/登录门槛弹层/登录后回原页自动完成刚才一次操作（后端
  `api.user_flag` 日志佐证）/愿望单增删/主题切换/公告已读/检查更新下载校验安装/封禁对话框退出进程。
- **已知限制（App README 同步）**：① 首页「折扣/史低/免费/未发售」筛选与「热度/发行时间/价格」排序按已加载数据
  本地处理（列表行自带 `discount/prev_hist_low/release_date/heat` 字段；服务端补 `filter` 参数后替换
  `HomeScreenState.applyDisplay` 即可）；② 契约端点 `POST /api/games/:appid/interest` 当前服务端仍是管理员专用，
  App 收到 403 时回退现有用户级 `/api/games/:appid/flags`（请求体相同，契约放开后自动失效）；③ 内置更新下载用
  OkHttp 流式 + 应用内进度条（BY 契约的 DownloadManager 属 TWA 实现细节，校验/默认 Wi-Fi/系统确认/白名单均一致）；
  ④ 注册完成后回登录页预填用户名（Token 登录仍需再输一次图形验证码，服务端验证码必填）；⑤「已拥有」标记第一期
  未做（APP-API.md 未提供 App 端 owned 接口）。


## CB. ~~待开发：价格报表邮件 HTML 化 + 内容增强~~ → **已发布 v2.18.0（2026-11-16）**

**状态：质检通过（2026-11-16，c5fc536 + 第 1 轮打回修复 becff89，第 2 轮复检）。打回摘要：第 1 轮偏差 1 条——§3.1 `@media (max-width:480px)` 单列适配缺失——已补 head 内 `<style>` 媒体查询（主表格全宽、KPI 卡与表格单元堆叠）+ 4 条断言（docs/QA-PRICE-REPORT-CB.md）。**
**依赖：** 无（CB-1 渲染模块先行；CB-2 依赖 CB-1）
**解锁：** 无
**规格**：[PRICE-REPORT-EMAIL.md](PRICE-REPORT-EMAIL.md)

- **现状（2026-11-16 核对）**：`report price --notify` 每天由调度器执行（`src/scheduler.js:209-214`），邮件正文是纯文本
  （`src/cli.js:2354-2370` 拼 `text`）；邮件层其实**已支持 HTML**（`buildMessage` 输出 `multipart/alternative`，
  `test/notify-html.test.js`），但 `deliver()` 只透传 `text`（`src/notify.js:324-330`），所以现在收到的都是纯文本。
- **需求**：邮件改 HTML 并丰富内容——品牌头 + 日期、KPI 三卡（降价/涨价/新史低）、降价 Top 5（名称/平台/原价→现价/折扣/
  站内与 Steam 链接）、涨价 Top 3、近 7 天迷你柱状趋势、CTA、页脚；手机端可读。
- **改动落点**：新增 `src/price-report-html.js`（`renderPriceReport()` → `{subject, html, text}`，零依赖、纯函数、
  内联 CSS + table 布局、无外部资源、HTML 转义）；`src/notify.js`（`deliver()` 增加 `html` 并传给 email 通道，
  webhook/wecom 仍纯文本）；`src/cli.js`（`cmdReport --notify` 接入渲染模块，subject 含日期与数字）；
  `src/settings.js`（新增 `site.publicUrl`，env `SITE_PUBLIC_URL`，默认 `https://sd.yyliucha.cn`）；
  `docs/MAIL-CONFIG-PAGE.md` 补一节；新增 `test/price-report-html.test.js`，扩展 `test/notify.test.js`。
- **验收**：见规格 §4——HTML 含 KPI/Top/7 天/链接/转义、无外部资源与 flex/grid；`deliver` 带 html → multipart 两段，
  webhook/wecom 仍 text；假 SMTP/本地验证 HTML 段可解码；QQ/163/企业微信邮箱/手机显示正常；
  `npm test` / `scan` 全绿；部署后手动跑一次 `report price --notify` 确认收到 HTML。


## CC. 待开发：多源采集推进——ITAD / GOG / Humble 覆盖全目录 + 命中率 + 后台触发

**状态：已发布 v2.19.0（2026-11-16，12f4f42；QA 报告 docs/QA-SOURCE-SYNC-CC.md 两轮 ✅；验收 8 待部署观察）。第 1 轮打回摘要：杉果每轮条数默认 0 被当作「0 条」→ 默认配置下 sync sonkwo 空转——已修复：0/未设 → 全部 SKU + 回归锁。**
**解锁：** 无
**规格**：[SOURCE-SYNC-COVERAGE.md](SOURCE-SYNC-COVERAGE.md)

- **现象（2026-11-16 后台截图）**：数据源开关全开、ITAD Key 已维护，但游戏目录里只有杉果/Steam 的同步痕迹；
  指标「已同步 60464 / 未探测 101595 / 待回填 133447」。
- **根因（代码证据）**：ITAD 候选 `order by id limit 50`（`src/cli.js:636-643`）、GOG/Humble 候选
  `where steam_appid/name_en ... order by id limit 50`（`src/cli.js:821-829`）——**每次都是同一批前 50 条，没有游标/状态**；
  ITAD 还优先用中文名搜索（命中率低且不缓存 id）；GOG 只认精确标题、Humble 靠 slug 猜；杉果是 `data/skus.json` 驱动；
  Steam 有热点/冷门队列所以看起来正常。后台「同步与回填」只列/触发 5 个任务（`AdminModules.vue:324`），
  `/api/admin/sync` 也只接受 catalog/steam-prices/steamall——**四个源任务无法从后台手动触发**。
- **改动落点**：`src/store/pg.js`（`game_source_sync` 表 + 迁移 + offers 回填 matched + 候选查询）、
  `src/cli.js`（ITAD/GOG/Humble 候选按 pending→nomatch→refresh 取数；ITAD 优先 `name_en`、命中缓存 external_id、
  批量取价；GOG/Humble 缓存 product id/slug 后按 id 刷新）、`src/server.js`（`/api/admin/sync` 支持 itad/gog/humble/sonkwo）、
  `frontend/src/pages/AdminModules.vue`（`TASK_ORDER` 增加四源、显示上次运行/匹配/剩余）、
  `src/settings.js`（每源 `limit`，默认 50）、日志 `sync.source_progress`、对应测试。
- **验收**：见规格 §4——连续两次运行处理不同游戏、状态落库、ITAD 英文名优先且 external_id 复用、
  GOG/Humble 命中缓存、后台四源可触发（运行中 409）、日志有进度、`npm test` 全绿、部署后观察「未探测」下降；
  **不新增定时任务**（复用现有 itad/gog/humble/sonkwo 任务）。


## CD. 待开发：跨平台对齐（杉果 + ITAD）——自动匹配 + 英文名/Steam 链接 + 后台审核 + 调度化

**状态：已发布 v2.21.0（2026-11-17，e5fced8；QA 报告 docs/QA-CD.md）**
**依赖：** 无（匹配器与 `applySkuMapping` 已存在，本批增强 + 接调度/后台）
**解锁：** 无
**规格**：[SONKWO-STEAM-MATCH.md](SONKWO-STEAM-MATCH.md)

- **现象（2026-11-16 后台截图）**：杉果-only 行（消逝的光芒系列、塔拉萨号、造物主2、内核之心、军火大学模拟器、血色之月…）
  没有 `steam_appid`、Steam 价为空、同步状态「未探测」。
- **ITAD 同样需要对齐（2026-11-16 复核）**：`itad.js:100` 固定 `steamAppid: null`，deal 按商店拆成 steam/gog/humble 等平台后落到按标题新建的孤立行；
  `deal.url` 实测是 `itad.link` 跳转（规格 §10），需**跟随 301/302 取最终 URL**，最终是 `store.steampowered.com/app/<id>/` 才可反解；
  反解不可用时退回"英文名 ↔ name_en"名称匹配；GOG/Humble 的 `syncByTitle` 已注入 `steamAppid`（`cli.js:821+`），不需要匹配，覆盖/命中归 CC。
- **后台审核（2026-11-16 确认）**：新增「游戏管理 → 对齐审核」页；**按去重组处理**（稳定键 = platform + normalizeName(杉果名)）：
  同游戏多条 SKU 只出现一行、组内一次确认/忽略即处理整组、已确认/已忽略的决定对后续同组新 SKU 自动继承、队列按组计数；
  确认前弹合并预览（报价/快照/alias 迁移，不可自动撤销）；批量确认先不做；映射落 **`game_source_map` 表**（`skus.json` 仅做兼容回落）。
- **现状/根因**：杉果页**没有 Steam appid**（`sonkwo.js:190`），只能靠名称；项目已有 `match.js`（bigram Dice + 版本词剥离，
  ≥0.94 自动 / 0.86–0.94 人工）与 `match`/`--apply`/`--confirm` 命令，映射写 `data/skus.json` 并合并孤立行；
  **但 `match` 不在调度器里、只用中文名、0.86–0.94 没有后台审核入口**。实测：Dying Light Deluxe=1.00、Definitive(RL)=0.944；
  中文↔中文=1.00；**中文↔英文=0.00**（塔拉萨号/造物主2 这类必须靠杉果页英文名匹配）。
- **改动落点**：`src/store/pg.js`（`game_source_map` 表 + 迁移/回填）、`src/match.js`（中/英双变体、exact 快路径、候选索引、版本词补充）、
  `src/adapters/itad.js`（跟随 itad.link 重定向取最终 URL、反解 appid、同一 ITAD game 的其它商店 deal 挂到同一游戏、别名落库）、
  `src/cli.js`（`match` 支持英文名与 `--auto-score` 生效、输出 method）、`src/scheduler.js`（sonkwo 收尾追加 match 增量——优先合并）、
  `frontend/src/pages/AdminModules.vue` + `src/server.js`（对齐审核页：**去重组队列**/合并预览/确认·忽略·手动搜索/决定继承，映射写 `game_source_map`）、
  对应测试与文档。
- **验收**：见规格 §5/§8——ITAD 跟随跳转后能反解 appid（或回退名称匹配）；塔拉萨号等经英文名匹配成功；Dying Light 按阈值自动；
  sonkwo 收尾自动跑、有 `match.summary`；**审核页按去重组展示**（同归一化名多 SKU 只一行）、确认/忽略一次处理整组、
  已确认/已忽略组的新 SKU 自动继承、连续两次运行队列组数不增长；确认前有合并预览与审计；
  `sync sonkwo` 后报价挂到 Steam 游戏、「未探测」下降；不误合并（抽查）；`npm test` 全绿。
- **进度（2026-11-17）**：实现中——`game_source_map` 表与映射函数、`src/align.js`（去重组提案/决定继承/确认忽略）、
  `match` 英文名 + 孤儿扫描 + 组级提案（`match.summary`）、sonkwo 收尾 match 步（`MATCH_ON_SONKWO`）、
  后台「对齐审核」页（队列/合并预览/确认/忽略/换候选手动搜索 + `match.confirmed/ignored` 审计）、
  ITAD itad.link 跳转反解 appid（失败回退名称匹配）。测试 test/align.test.js + api.test.js 运行时用例。


## CE. 待开发（高优先级）：杉果匹配器加固 + 2026-11-16 误合并数据修复

**状态：已发布 v2.19.0（2026-11-16，12f4f42；QA 第 1 轮 ✅，报告 docs/QA-CE.md；cli.js/overview 的 CE 改动随 49ec3e6 一并入 main；数据修复已完成不属本批；CD 的自动应用暂停）**
**依赖：** 无（必须先于 CD 的自动应用完成）
**解锁：** CD（自动应用）、杉果源恢复
**规格**：[SONKWO-STEAM-MATCH.md](SONKWO-STEAM-MATCH.md) §9

- **事故（2026-11-16）**：运维执行 `match --apply`（50 + 200 两轮，共写入 66 条映射）后，提案出现大量 1.00 分误匹配：
  幻世录 重制版 → 地铁2033 重制版、捉鬼敢死队 重制版 → 地铁2033、空之轨迹 the 2nd → the 1st、
  龙之剑:觉醒 服装 → 沙丘：觉醒、星球大战 银河赛车手 → 绝地、MX摩托越野赛 → MX赛车世界、TCG卡牌店模拟器 → Epic Cards Battle、
  巴士模拟器 27 季票 → 巴士模拟器 21、碧蓝幻想 传奇版 → 质量效应传奇版 等（详见规格 §9 表）。
- **根因**：`nameVariants` 片段组合取最大分（共享"重制版/代号/星球大战/觉醒/TCG/MX"即 1.00）；`EDITION_WORDS` 缺
  重制版/传奇版/经典版/增强版/重装上阵版/季票/通行证/服装/皮肤/故事包/扩展包/合集；无数字/序数一致性校验；
  自动阈值 0.94 对片段 1.0 失效。
- **改动落点**：`src/match.js`（完整标题计分、片段长度/通用词限制、数字/序数与内容词校验、自动条件收紧）、
  `src/cli.js`（`--apply` 打印逐条对照 + `--yes` 二次确认）、`test/match.test.js`（误匹配回归集）、
  数据修复脚本（关杉果源 → 清错误 appid → 按 `offers.buy_url like '%/sku/<skuId>'` 迁回报价/重建孤立行/修正 alias，先 dry-run）。
- **验收**：见规格 §9——上表 13 条不再自动匹配；正确样例（愚者不灭、神盾力量、忙作一团、血色序曲、内核之心等）仍自动；
  修复脚本 dry-run 输出可核对；修完再开杉果源、无新增误挂；`npm test` 全绿。


## CF. 待开发：后台体验与安全策略（申诉布局 / Steam 账号重复渲染 / 指标压缩 / 自动封禁收紧）

**状态：已发布 v2.21.0（2026-11-17，31483fb；QA 报告 docs/QA-CF.md）**
**依赖：** 无（CE/CC 已发布，文件不再被占用）
**解锁：** 无
**规格**：[ADMIN-UX-SECURITY.md](ADMIN-UX-SECURITY.md)

- **现象（2026-11-16 后台截图）**：① 申诉管理按钮分散；② Steam 账号桌面出现重复卡片（渲染 bug：`AdminExtras.vue:54` 的 v-else 挂在游戏库 v-if 上）；
  ③ 游戏管理 13 个指标卡占半屏；④ 自动封禁易误伤、审核入口不顺手。
- **已确认决策（6 项）**：① 图一/二/三全部按效果图改；② 自动封禁改"严格硬规则"；③ 硬规则 = 漏洞路径探测 + 登录凭据爆破 +
  极端频率 + 异常 UA 名单；④ 临时封 10min→1h→1天封顶，永久只能人工；⑤ 普通超频只 429（不做人机挑战）；⑥ 扩展现有「异常审核」tab
  （证据抽屉/临时封/永久封/信任/忽略）；申诉对所有封禁类型开放，未封只提示。
- **改动落点**：`AppealsAdmin.vue`（筛选行/刷新重排）、`AdminExtras.vue`（v-else 修复）、`AdminModules.vue`（4 主指标 + 更多指标折叠）、
  `src/ratelimit.js`（strict 模式/阶梯/硬规则）、`src/guard.js`（UA 名单/路径阈值）、`src/server.js`（审核证据/操作接口）、
  `src/settings.js`（`security.autoBan.*` 热加载）、对应测试。
- **验收**：见规格 §6——桌面不再重复卡片；指标折叠；普通超频 429 不封；四类硬规则自动临时封；阶梯/永不自动永久/白名单/申诉解封；
  审核证据与操作审计；`npm test` / `frontend:build` / `scan` 全绿。


## CH. 开发中：个性化推荐 + Deck 认证 + 好评率（借鉴 steam-deals）

**状态：已发布 v2.21.0（2026-11-17，b575dcc；QA 报告 docs/QA-CH.md）**
**依赖：** 无（CF/CD 已完成）
**解锁：** CG 的「为你推荐」App 支持
**规格**：[DISCOVERY-FOR-YOU.md](DISCOVERY-FOR-YOU.md)

- 借鉴 [Drakey83/steam-deals](https://github.com/Drakey83/steam-deals) 三件能力 + 两件搭车项（免费角标/行为学习），全部经所有者 2026-11-17 拍板。
- 改动落点：`src/discovery.js`（翻页+名称回退+computeForYou）、`src/store/pg.js`（games 5 列 + tags GIN + user_behaviors/user_search_logs + prune）、
  `src/server.js`（gameSearch score/reviewMin/deck + /api/games/for-you + /api/behavior）、`src/scheduler.js`（steam-discovery 任务 + STEAM_HEAVY）、
  `src/settings.js`（discovery.*/personal.* 8 项）、`frontend/src/pages/Home.vue`（综合评分排序/好评率与 Deck 筛选/徽标/免费角标/为你推荐 tab）。
- 验收：见规格 §9 七条。


## CI. ~~待发版：价格提醒邮件 HTML 化 + 申诉管理页视觉对齐~~ → **已发布 v2.22.0**

**状态：已发布 v2.22.0（2026-11-17，实现 d5e6dc2；质检 ✅ docs/QA-CI.md 第 1 轮）**
**依赖：** 无（CB 报表 HTML 渲染已发布 v2.18.0；CF 申诉页结构改动已发布 v2.21.0）
**解锁：** 无
**规格**：[ALERT-MAIL-APPEAL-UX.md](ALERT-MAIL-APPEAL-UX.md)

- **现象（2026-11-17 所有者截图）**：① 价格提醒邮件是纯文本（「价格提醒（时间，共 N 条）· 名称 ¥89 · 史低 ¥89 · 跌至史低 + Steam 链接」），
  与 CB 批的 HTML 报表邮件风格不一致；② 申诉管理页（v2.21.0）结构已改（标题区 / 筛选行位置），但视觉未对齐效果图：
  tab 仍是旧 `module-tabs`、空态是 el-table 默认「暂无数据」黑条、表格多「到期」列、间距与效果图有差异。
- **已确认决策（3 项）**：① CI-1 复用 CB 报表样式（品牌头 + 卡片列表），webhook/企微仍纯文本、不引新依赖；
  ② CI-2 按 [效果图](design/admin-ux-security-2026-11-16.png) 逐项对齐（分段控件 / 空态 / 表格列 / 间距），「到期」并入「封禁原因」列；
  ③ 不改数据模型、不新增调度任务与接口。
- **改动落点（CI-1）**：新增 `src/alerts-html.js`（`renderAlertsHtml()`：内联 CSS + table + 转义 + 卡片）、
  `src/cli.js`（提醒路径传 `html`）、`src/alerts.js`（保留文本兜底）、新增 `test/alerts-html.test.js`（进主链）。
- **改动落点（CI-2）**：`frontend/src/components/AppealsAdmin.vue`（分段控件 / 空态 / 表格列与样式 / 间距）；
  测试补静态断言（分段控件与空态存在、无「到期」独立列）。
- **验收**：见规格 §9——① 提醒邮件为 HTML（multipart 两段）且 webhook/企微仍纯文本、动态字段转义、无外部资源；
  ② 申诉页分段控件主色选中、空态卡片式、列与效果图一致、移动端卡片不变、PC 无回归；
  ③ `npm test` / `frontend:build` / `scan` 全绿；**不自行构建**。
- **待确认**：§11 两条（「到期」是否保留独立列；空态文案是否随筛选联动）。


## CJ. ~~开发中：安卓版 App 发版后 /app 页自动更新（站点自托管 + GitHub 兜底）~~ → **已发布 v2.22.1（主体 v2.22.0 + 现场回归修复）**

**状态：已发布 v2.22.1（2026-11-17：主体 517ffb6 随 v2.22.0 发布，QA ✅ docs/QA-CJ.md 第 1 轮；现场回归修复 b726af4 质检 ✅**
**docs/QA-CJ-regression.md，随 v2.22.1 发布；CI 双绿 docker-hub 44051124638 / docker-tcr 44051124347；服务器部署待执行）**
**依赖：** 无（App 仓库 `app-v2.19.0` Release 已就绪，含 APK + sha256）
**解锁：** 无
**规格**：[APP-AUTO-UPDATE-PAGE.md](APP-AUTO-UPDATE-PAGE.md)

- **现象（2026-11-17 所有者截图）**：`https://sd.yyliucha.cn/app` 仍显示 2.18.0。根因两处：① `/api/app/latest` 读镜像内
  `frontend/dist/app/latest.json`（`src/server.js:1801-1803`），不重新构建镜像不会更新——2.19.0 的 latest.json 在
  v2.21.0 tag 之后（`9f68a1e`）才提交，部署 v2.21.0 仍显示 2.18.0；② 每次 App 发版需人工 4 步（构建 APK → 拷进
  `frontend/public/app/` → 手改 latest.json → 提交并等站点重新构建）。所有者要求：App 更新后页面自动更新，不人工维护。
- **已确认决策（4 项）**：① 站点自托管下载 + GitHub Release 兜底链接；② 同步任务每小时 1 次（GitHub API 每轮 1 次调用）；
  ③ App 构建时把 `latest.json` 作为 Release 资产上传（versionCode/minVersionCode/notes 无法从 tag 推算）；
  ④ 站点仓库不再要求手工入库新 APK 与 latest.json（存量 2.19.0 保留作镜像兜底）。
- **改动落点**：新增 `src/app-release.js`（GitHub Release 轮询 + 下载 + sha256 校验 + 原子写 + 保留最近 3 个）、
  `src/cli.js`（`app-sync` 调试命令）、`src/scheduler.js`（`app-release-sync` 任务进 jobsFromEnv，轻任务不进 STEAM_HEAVY）、
  `src/server.js`（`/api/app/latest` 优先读 `data/app/latest.json`，缺失回落镜像文件；新增 `/app/dl/<file>` 白名单下载路由）、
  `frontend/src/pages/AppDownloadPage.vue`（GitHub 备用链接改 `yyliucha/steamdeals-app`）、对应测试与文档。
- **验收**：见规格 §9——① `app-sync --force` 后 data/app 有 APK+latest.json，`/api/app/latest` 返回新版本；② 同版本跳过、
  断网保留旧值且不 5xx；③ `/app/dl/` 白名单 200/404、HEAD 可用；④ `/app` 页显示新版本并可下载、备用链接指向新仓库；
  ⑤ 只保留最近 3 个 APK；⑥ `npm test` / `frontend:build` / `scan` 全绿；不自行打 tag。
- **待确认**：§11 两条（Release 必须含 latest.json 资产；存量旧 TWA 2.16.0 APK 是否顺带删除）。
- **现场回归（2026-11-17 线上 v2.22.0，已修复 b726af4，质检 ✅ docs/QA-CJ-regression.md）**：部署后 `/app` 页「下载 APK」报 404（Chrome「无法下载 - 没有文件」）。
  **实测证据**：`/api/app/latest` 返回 `apkPath=/app/dl/steamdeals-2.19.0.apk` 且该 URL **404**；
  镜像内旧路径 `/app/steamdeals-2.19.0.apk` **200** 可下载。**根因**：`src/server.js:1831` 无条件生成
  `/app/dl/steamdeals-<ver>.apk`——即使 `readLatestMeta` 走的是**镜像回落**分支（`data/app` 为空：首次部署、
  同步任务首轮未跑或失败），apkPath 没有跟着回落。
  **修复（3 处）**：① apkPath 仅在 `data/app/steamdeals-<ver>.apk` 存在时用 `/app/dl/…`；否则若镜像内
  `app/steamdeals-<ver>.apk` 存在则回落 `/app/<ver>.apk`；都没有返回 `null`；
  ② `/app/dl/<file>` 文件不存在时 **302 到 `/app/<file>`** 兜底旧链接；
  ③ 回归测试：`serve.test.js` 断言「`data/app` 为空时 apkPath 回落镜像路径」，并覆盖"同步失败/断网时页面不死链"。
- **现场回归后续（2026-11-17 15:56 部署侧取证）**：容器 `Up 20 minutes (healthy)`（≈15:36 重启，与 15:39 的首页
  20s 超时吻合，属重启窗口）；调度日志 itad/images/proxy-probe 均正常；但 `docker exec steamdeals ls -la /app/data/app`
  **目录为空**（仅创建于 15:40）→ 同步任务未产出 APK，`/app/dl/<ver>.apk` 持续 404。
  待查：`docker logs steamdeals 2>&1 | grep -i 'app.release'`（network / no_latest_asset / 未运行）。
  **待定建议（需所有者拍板）**：④ **构建期兜底**——站点 CI（GitHub Actions 可访问 GitHub）在构建镜像时从 App 仓库
  Release 拉 APK + latest.json 放进镜像，运行时 `app-release-sync` 降级为"发版后免重建镜像"的加速器；
  这样国内服务器拉不到 api.github.com 也不影响 `/app` 页可用。⑤ 同步失败必须在后台任务卡/日志可见，不得静默。


## CK. ~~开发中：e2e 测试套件（功能矩阵 + headless Edge + Android 模拟器/真机 + 公网只读 + PDF 报告）~~ → **已发布 v2.24.0**

**状态：已发布 v2.24.0（2026-11-17，实现 test(e2e) 65af42b + release 0bfaceb；QA ✅ docs/QA-E2E-SUITE-CK.md 第 1 轮——通过 6 / 缺失 0 / 偏差 0 / 需人工确认 0；实测全量 42 通过 / 0 失败 / 3 环境 skip、smoke 8/8 38s、反向自检删 DLC 区块行红并留档）**
**依赖：** 无（CJ 的新功能矩阵行在 CJ 落地后补）
**解锁：** 后续各批次「真实测试=上线门槛」可自动执行；`steamdeals-test` 技能的 R1 级验证有工具支撑
**规格**：[E2E-SUITE.md](E2E-SUITE.md)

- **现状（2026-11-17）**：`test/` 99 个文件、主链 95 个，全是单元/接口层；浏览器级、App 级、线上验收
  全靠人工（BT/BW/BY/CG 多批靠"部署后真机目视"收尾）。
- **已确认决策（10 项）**：① 两档 `e2e`（全量）/`e2e:smoke`（核心）；② 矩阵 `test/e2e/matrix.json` 可自定义
  （`--only`/`--tag`），新功能必须加行；③ headless Edge 做 DOM/Console/截图/PDF，**不引 playwright**；
  ④ 默认模拟器 `steamdeals35`，真机 `--device=real` 且**无设备立即中断**并给连接步骤；⑤ 后台从新建
  `e2e_<时间戳>` 用户开始 → 登录/改密 → 13 模块 → 彻底删除，开场清 `e2e_%` 孤儿、只删该前缀；
  ⑥ 163 邮箱凭据放仓库外 `F:\dsh\e2e-secrets\mail.env`，IMAP 拉取断言；⑦ 报告 HTML→PDF 输出到
  `F:\dsh\e2e-reports\`（**不入库**）；⑧ 微信只做 UA 仿真、不做客户端自动化；⑨ `--online` 部署后公网只读验收
  （`/api/site`/页面/截图/TTFB，不碰服务器）；⑩ 不新增运行时依赖。
- **改动落点**：新增 `test/e2e/`（`matrix.json` + `runner.mjs` + `lib/{server,browser,adb,report,account,online}.mjs`）、
  `package.json`（`e2e` / `e2e:smoke` 脚本）、`docs/TESTING-E2E.md`（怎么跑/怎么加行/报告位置）、
  DELIVERY 发版清单加「e2e 全量通过」门禁。
- **验收**：见规格 §8——① `e2e:smoke` ≤5 分钟、全量逐行有结果、PDF 在 `F:\dsh\e2e-reports\`、仓库 `git status` 干净；
  ② 设备预检（无真机立即中断、模拟器自动启停）；③ `e2e_` 账号建删无残留、中断后重跑可清孤儿；
  ④ **反向自检**：删掉 DLC 区块 → 该行失败且截图/Console 留档；⑤ `--only` 生效、新矩阵行必须出现在报告；
  ⑥ `npm test` / `frontend:build` / `scan` 全绿、不新增运行时依赖。
- **待确认**：无（§10 三条已确认并入规格 §1 #11–#13：后台四类模块走增删改、App 覆盖安装用 2.19.0 作旧版、`--online` 部署后跑）。


## CL. ~~待开发：用户级到价提醒（列表页 + 已拥有隐藏 + 后台全站清单）~~ → 已发布 v2.23.0

**状态：已发布 v2.23.0（2026-11-17，e196382，lead 实现；QA ✅ docs/QA-CL.md 第 1 轮——通过 8 / 需人工确认 2：部署后 UI 目视 + 邮件实发）**
**依赖：** 无
**解锁：** 无
**规格**：[USER-ALERTS.md](USER-ALERTS.md)

- **问题（2026-11-17 所有者）**：到价提醒目前只是管理员在详情弹窗能设置（`watchlist` 无 `user_id`、接口全部
  `requireAdmin()`），前端没有任何列表页 → **忘记哪款游戏就没有入口移除**。
- **已确认决策（5 项）**：① 改为**用户级**（每个登录用户管理自己的提醒）；② 详情页可加/删 + 新增
  「到价提醒」列表页可取消；③ **已拥有是终态且完全读 Steam 库**（`owned_by` 并集，**不开放手动「已拥有」标记**）：
  显示全部拥有账号名 + **只保留「去 Steam 商店」**，其余按钮与到价提醒全部隐藏，**管理员同样遵守**；
  ④ 数据联动：变为已拥有时删除该用户该游戏的**愿望单行与到价提醒行**；⑤ 降价邮件发**用户本人邮箱**
  （未绑定则跳过并提示），站点级企业微信通道不变。
- **改动落点**：`src/store/pg.js`（`watchlist` 加 `user_id` + 部分唯一索引 + 用户级 CRUD + 管理员全站列表）、
  `src/server.js`（`/api/watchlist` 用户接口、详情 `watch` 字段、`/api/admin/watchlist` 扩展）、
  `src/alerts.js`（按用户分组发信、无邮箱跳过）、`frontend/src/pages/Home.vue`（详情弹窗权限与已拥有隐藏 +
  「到价提醒」tab/移动入口）、`frontend/src/pages/AdminModules.vue`（全站清单）、`test/watchlist-user.test.js`。
- **验收**：见规格 §9——① 普通用户可加删、已拥有隐藏、管理员不隐藏；② 列表页可取消、空态、分页；
  ③ 用户隔离（A 删不掉 B 的）；④ 邮件收件人=用户本人、同用户多游戏合并一封、无邮箱跳过、站点级行为不变；
  ⑤ 后台清单可删且有审计；⑥ 迁移两次不报错、旧数据保留；⑦ `npm test` / `frontend:build` / `scan` 全绿。


## CM. App 功能补齐（与 Web 对齐的差异项）→ 站点侧已发布 v2.24.0

**状态：已发布 v2.24.0（2026-11-17 站点侧，随 CK release 0bfaceb；QA docs/QA-CM.md 第 1 轮 ✅ 放行；App 仓库 steamdeals-app e183584 / 2.20.0，App 侧 app-v2.20.0 tag/Release 等所有者指令）**
**依赖：** 无（DLC 与历史接口已就绪）；CM-5 需站点 `/api/app/games` 扩展、CM-6 需登录态核实
**解锁：** 无
**规格**：[APP-PARITY.md](APP-PARITY.md)

- **实测依据（2026-11-17 模拟器 steamdeals35 + 2.19.0 APK）**：多平台报价 ✅（GOG/Steam/Humble 并列）；
  价格历史 ✅ 有曲线但**无区间切换/无区间指标**；**DLC 列表 ❌ 未做**（纪元1800 实测无区块，接口已就绪）；
  复制游戏名 ❌；**开发商/发行商显示原始 JSON**（纪元1800 `{"name":"Ubisoft Mainz"}`）；已拥有/到价提醒 ❌。
- **已确认决策（5 项）**：① 本批只做差异补齐（CM-1~CM-4）；② 已拥有终态 App 一期不做（无 Steam 绑定），
  接入后按 [USER-ALERTS.md](USER-ALERTS.md) §1 #3 执行；③ 筛选/排序服务端化列 CM-5（二期可选）；
  ④ 公告角标 CM-6 待登录态核实；⑤ App 改动在 `steamdeals-app` 仓库、CM-5 服务端改动在站点仓库。
- **改动落点**：App 仓库（详情页开发者/发行商解析、DLC 区块、价格历史区间与指标、复制名）；
  站点仓库（仅 CM-5：`/api/app/games` 透传筛选/排序参数）。
- **实现（2026-11-17，App 仓库 e183584，版本 2.20.0/22000）**：`NameListSerializer`（兼容字符串数组 /
  JSON 对象文本 / 对象数组取 name）、DLC 分页 10（价格/折扣/缺货/Steam 跳转/「Steam 不提供 DLC 拥有数据」，
  无 DLC 不显示）、`PriceHistoryModel` 纯函数（30/90/全部 + 区间指标，口径对齐 Web §11）+ 史低虚线参考线
  与全部史低日绿点、标题旁复制按钮（中英两行，缺一回退单行）；JVM 单测 18 项（`gradlew testDebugUnitTest`，
  生产真实夹具 + 反向自检）；模拟器 e2e：生产只读验证 CM-1/CM-3/CM-4 与多平台报价回归，DLC 区块用
  debug 包 + 本地 mock（`F:\dsh\cm-e2e\mock-server.mjs`，仓库外）验证分页/缺货/翻页/跳转。
- **数据侧备注**：生产 `game_dlc` 尚未同步（所有抽查游戏 `dlc.total=0, synced=false`），上线后 DLC 区块
  随 steam-status/backfill 同步自然出现；App 端逻辑已按规格实现并经 mock 验证。
- **验收**：见规格 §4——① 纪元1800 显示 Ubisoft Mainz / Ubisoft（无 JSON）；② DLC 区块分页/价格/跳转/说明；
  ③ 历史区间切换与指标与 Web 一致；④ 复制名成功；⑤ 既有功能不回归；⑥ 模拟器安装新包截图核对；⑦ App 构建同签名可覆盖。


## CN. ~~待开发（P0 插队，最高优先）：对齐审核查询拖垮站点~~ → **已发布 v2.24.1（2026-11-17，实现 5c723aa + 收尾 2060586）**

**状态：已发布 v2.24.1（2026-11-17，5c723aa + 2060586；QA 报告 docs/QA-CN.md 第 1 轮 ✅ 放行——通过 7 / 缺失 0 / 偏差 1 记录级 / 需人工确认 4）**
**优先级：** **P0 —— 其余所有待开发条目（CL/CK/CM/CO）为它让路**；破坏性/线上事故类问题永远最高优先
**依赖：** 无
**解锁：** 无
**规格**：[ALIGN-QUERY-PERF.md](ALIGN-QUERY-PERF.md)

- **现象（2026-11-17 线上 v2.22.1）**：后台「游戏管理 → 对齐审核」一直转圈/超时（`align` 请求无响应），
  同时 `/api/admin/games` 2.1s、`/api/admin/sync/status` 1.7s，最终**站点容器重启**（"镜像被搞挂"）。
- **根因（代码证据）**：`GET /api/admin/align` 每次请求在 Node 主线程全量重算（`src/server.js:4181-4190`）：
  取 19.6 万游戏行 + 全量 skus.json + 对每个组调用 `bestMatchMulti`（`src/match.js` 逐候选大分子相似度）
  = 组数 × 19.6 万次比较；**无缓存、无 single-flight、无时间上限** → 事件循环被占满 → 全站超时 → 健康检查失败重启。
- **已确认决策（6 项）**：① 改"后台生成 + 缓存读"（TTL 10 分钟，`?refresh=1` 重算）；② 候选预筛（每标题 ≤2000 候选，
  复用 trigram 索引）；③ single-flight + 20s 时间预算（超时返回 `partial`）；④ 匹配循环分片 `setImmediate`/worker，
  不独占事件循环；⑤ 接口分页 `page/pageSize=20`；⑥ 不改匹配算法口径（CD/CE 行为不变）。
- **改动落点**：`src/server.js`（缓存/single-flight/分页/超时）、`src/align.js`（候选索引 + 分片）、
  `src/match.js`（候选预筛辅助）、`frontend/src/components/AlignAdmin.vue`（生成时间/刷新/partial 提示）、
  `test/align-perf.test.js`（新增，进主链）。
- **验收**：见规格 §4——① 缓存命中 ≤200ms；② 计算中并发 `/api/games/count` 与 `/api/site` P95 不受影响；
  ③ 并发 5 请求只算 1 次；④ 超时返回 partial 不 5xx；⑤ CE 13 条误匹配仍不进自动候选；⑥ 分页/刷新生效；
  ⑦ `npm test` / `frontend:build` / `scan` 全绿；不自行打 tag（建议 v2.22.2 热修）。
- **待确认**：缓存 TTL 10 分钟是否合适；`/api/admin/games`、`/sync/status` 的慢是否另开条目（建议另开）。
- **实现（2026-11-17）**：`src/align-query.js`（新增：createAlignRunner——结果缓存 TTL 10 分钟 + single-flight 并发共享计算 Promise + invalidate）、
  `src/match.js`（buildCandidateIndex/indexTokens/preselectCandidates——归一化全等快路径 + 信息 token 召回慢路径、共享数降序截断 ≤2000）、
  `src/align.js`（proposeAlignGroupsBudgeted——候选预筛 + 每 200 组 setImmediate 分片 + 20s 预算超时返回 partial；proposeAlignGroups 保持同步旧签名，CLI 零改动）、
  `src/server.js`（alignRunner 实例级跨请求共享；`GET /api/admin/align` 分页 page/pageSize=20 + `?refresh=1` + 响应带 generatedAt/cached/partial；
  confirm/ignore 后 invalidate 失效缓存）、`frontend/src/components/AlignAdmin.vue`（刷新=强制重算、生成时间/缓存状态/partial 警告提示）、
  `test/align-perf.test.js`（新增 12 项进主链：缓存/单飞/预筛口径（CE 13 条 + 正确样例）/预算 partial/分片/截断；反向自检 2 处变红验证）。
  验证：npm test 全绿 / frontend:build / scan 干净；HTTP 冒烟（pglite + 真服务）：首次 5 并发只算 1 次、缓存命中 7ms ≤200ms、分页 45 组 20/页、
  计算期间 /api/games/count 与 /api/site 并发 200 不阻塞、匿名 401。


## CP. ~~待开发（P1，边缘场景）：手机端识别增强（小米浏览器桌面 UA 漏判 → 打不开下载页）~~ → **已发布 v2.24.4（2026-11-18，75a7e7f）**

**状态：已发布 v2.24.4（2026-11-18，75a7e7f；QA 报告 docs/QA-CP-CT-CO2.md 第 1 轮 ✅——通过 15/需人工确认 2：红米真机 + 线上四组 UA，待部署后验证）**
**优先级：** P1 —— 仅影响「桌面版网站」模式/部分 webview 用户（真机正常模式已验证可跳转），排在 CN/事故之后
**依赖：** 无（`app.mobileRedirectEnabled` 已在生产打开）
**解锁：** 无
**规格**：[MOBILE-DETECT-FIX.md](MOBILE-DETECT-FIX.md)

- **实测（2026-11-17 线上，开关已开）**：iPhone Safari / Android Chrome → **302 `/app`** ✅；
  **小米浏览器「桌面版网站」模式 → 200 不跳**（UA `X11; Linux x86_64 … MiuiBrowser/17.0`，不含 `mobile`）；PC 200 不跳（正确）。
- **根因**：`src/server.js:102` `isMobileUa = /mobile/i.test(ua)` 只认 UA 字面量，桌面模式偽装 UA 漏判。
- **已确认决策（6 项）**：① 三信号判定（UA 特征 / `Sec-CH-UA-Mobile: ?1` / 前端 `screen.width<=640` 兜底）；
  ② `index.html` 内联兜底脚本（`sessionStorage` 防循环、只跳一次）；③ 豁免列表不变（console/login/register/app/banned/appeal/setup/change-password 与 /api/*）；
  ④ PC 与宽屏（>640）永不跳；⑤ 微信内跳 `/app` 后显示「在浏览器打开」提示；⑥ 不引入 UA 库。
- **改动落点**：`src/server.js`（多信号 `isMobileUa` + 日志记录命中信号）、`frontend/index.html`（内联兜底脚本）、
  `test/frontend-mobile.test.js` / `test/serve.test.js`（静态断言：脚本存在、豁免一致）。
- **验收**：见规格 §4——① 四组 UA 实测（含小米桌面 UA 必须跳）；② 红米真机进入 `/app` 且不循环；③ 豁免路径不跳；
  ④ 微信内显示提示；⑤ PC/平板不跳；⑥ `npm test` / `frontend:build` / `scan` 全绿；不自行打 tag。


## CS. ~~待开发（P0 未完成）：对齐审核预算截断 → 队列恒为空~~ → **已发布 v2.24.3（2026-11-18，2a03188）**

**状态：已发布 v2.24.3（2026-11-18，2a03188；QA 报告 docs/QA-CS-CV.md 第 1 轮 ✅——通过 12 / 需人工确认 2：部署后 P95 + App 真机目视）**
**优先级：** P0 —— 功能仍不可用（页面能打开但队列为空）
**依赖：** CN（已发布 v2.24.1；v2.24.2 已部署）
**解锁：** 无
**规格**：[ALIGN-DB-SLOW.md](ALIGN-DB-SLOW.md)

- **现象（2026-11-18 12:09，v2.24.2）**：页面不再 504，但显示「匹配计算超时，当前为部分结果」+
  「生成于 12:09:35」+ **队列「暂无数据」**（只有"自动继承 68 条"）。
- **根因**：`ALIGN_BUDGET_MS=20s` 的 `startedAt` 在**前处理之前**（读 skus.json、加载 20 万行、建候选索引、
  继承映射）；前处理 >20s → 分组循环第一次检查即 `break` → `partial=true` 且 `groups=[]`；
  且「点刷新可继续」不成立（`refresh=1` 从头重算）。
- **历史**：v2.24.0 的 504 是 CN 未进镜像（已由 v2.24.1 修复）；DB 侧 EXPLAIN 91ms，**无需索引/VACUUM**；
  30s 慢查询日志实为事件循环阻塞的误报。
- **修复（6 项）**：① 预算 `startedAt` 移到匹配循环开始前（前处理不计入）；② **改为后台生成**：进入/刷新触发后台计算
  （可超 20s，setImmediate 分片），接口只读缓存，冷缓存返回 `202 {generating,processed}` + 前端轮询 3s，完成后自动展示；
  ③ 文案改为「后台生成中（已处理 X/Y），完成后自动刷新」，删除"点刷新可继续"；④ `db.slow_query` 区分 DB 时间与
  事件循环阻塞；⑤ 候选索引按 games 变更节流刷新（可选）；⑥ 观测 `align.computed`（groups/partial/ms）。
- **验收**：见规格 §3——首次进入后 ≤60s 内出完整队列（无空表）、二次 ≤1s、无 `partial` 空结果、
  计算期间其它接口不受影响、连续刷新只算 1 次、`npm test` / `frontend:build` / `scan` 全绿。
- **验收**：见规格 §3——部署后不再 504、首次 ≤20s 内完成、二次刷新 ≤1s、计算期间其它接口不受影响、
  连续刷新只算 1 次、`npm test` / `frontend:build` / `scan` 全绿。


## CT. ~~待开发：app-release-sync 404 → 改用 releases 列表接口（仓库已公开，不再需要 token）~~ → **已发布 v2.24.4（2026-11-18，9312054）**

**状态：已发布 v2.24.4（2026-11-18，9312054；QA 报告 docs/QA-CP-CT-CO2.md 第 1 轮 ✅；releases 列表接口 + 可选 token + 日志区分）**
**优先级：** P1（影响 App 自动同步；下载链路已有镜像兜底，用户可下载）
**依赖：** CJ（已发布 v2.22.1）
**解锁：** 无
**规格**：[APP-SYNC-404.md](APP-SYNC-404.md)

- **现象**：`app-release-sync` 输出「未同步：github_http_404」，`data/app` 一直为空。
- **根因（2026-11-18 复核）**：① 仓库原为私有 → 匿名 404（**已由所有者改公开**）；
  ② `src/app-release.js` 只调 `/releases/latest`，而 GitHub 对该 release 的 **latest 端点返回 404**（`/releases` 列表 200 正常）
  → 即使公开仍会失败。
- **验证**：匿名 `GET /releases` → 200（`app-v2.19.0`，assets=latest.json/apk/sha256）；`/releases/latest` → 404；
  站点 `/api/app/latest` 200（`apkPath=/app/steamdeals-2.19.0.apk`）；`/app/dl/…` → 302 → 站点自托管 **200**。
- **修复**：① 改为 `GET /releases?per_page=10` 取**第一条非 draft/prerelease**（latest 仅兜底）；② **不依赖 token**
  （公开仓库匿名可用，保留可选 `GITHUB_TOKEN` 认证头）；③ 日志区分 `app.sync_http_404 / no_release / no_assets`；
  ④ 同步产物 `data/app/<apk> + latest.json`。
- **验收**：见规格 §3——`app-sync` 成功落盘、`/api/app/latest` 与 latest.json 一致、模拟 404 不崩、无 token 正常、
  `npm test`（新增 `test/app-release.test.js`）/ `scan` 全绿。
- **待确认**：仓库公开后是否保留 token 支持（建议保留，代码量小）。


## CV. ~~待开发（P0 体验）：所有查询不再排除已拥有（列表 + 搜索；App 对齐）~~ → **已发布 v2.24.3（2026-11-18，站点 2a03188 + App 仓库 0945006）**

**状态：已发布 v2.24.3（2026-11-18，站点 2a03188 + App 仓库 0945006；QA 报告 docs/QA-CS-CV.md 第 1 轮 ✅——通过 12 / 需人工确认 2：部署后 P95 + App 真机目视）**
**优先级：** P0 —— 用户搜不到自己的游戏（App 体验事故）
**依赖：** CL（详情终态已发布 v2.23.0）
**解锁：** 无
**规格**：[APP-SEARCH-OWNED.md](APP-SEARCH-OWNED.md)

- **现象**：安卓 App 搜索「赛博朋克2077」→「暂无数据」；Web 能搜到；App 数据感觉很少。
- **实测**：用 App 相同参数/UA 请求 → 服务端 `total=1`（搜索正常）；**根因是 `owned='exclude'` 默认**
  （`Home.vue:238` 列表与搜索都排除已拥有；App 未传 owned → 服务端默认排除）。
- **已确认口径（6 项）**：① **所有查询不排除已拥有**（全部/感兴趣/不感兴趣 + 搜索都 `owned=include`）；
  ② 「已拥有」页签保留为筛选（only）；③ 已拥有游戏显示**对应 Steam 账号**（列表徽标已有，详情列全）；
  ④ 已拥有详情**按钮不同（终态）**：只留「去 Steam 商店」——Web 已实现，App 对齐；⑤ 服务端默认值不变（前端显式传）；
  ⑥ App 列表/搜索带 `owned=include`，详情按终态显示；站点 `/api/app/games/:appid` **补 `owned_by`（已确认）**，App 显示账号名。
- **改动落点**：`frontend/src/pages/Home.vue`（owned include）、App `SearchScreen/HomeScreen`（owned include + 徽标/终态）、
  `src/server.js` 的 `/api/app/games/:appid` 补 `owned_by`（若确认）、测试（api.test 断言 + App JVM 单测）。
- **验收**：见规格 §4——① 登录已拥有时 Web/App 列表与搜索都能看到并标账号；② 详情只留 Steam 商店 + 账号名；
  ③ 未登录行为不变；④ 「已拥有」页签仍只显示已拥有；⑤ 服务端默认值未变；⑥ `npm test` / `frontend:build` / `scan` 全绿。


## DB. 已过时（2026-11-18 合并入 CX）：个人主页（原"公开资料页"）

**状态：已过时（所有者确认：不做公开主页，任何人都只能看/改自己的资料；管理员同样）**
**去向：** 并入 **CX**「我的资料」（编辑 + 我的游戏库/统计，仅本人可见）

- 原设想 `/u/:username` 公开页**取消**；不提供任何访问他人资料的入口或 URL。
- 多 Steam 账号展示、必填校验、我的愿望单/已拥有/统计 → 全部写进 [USER-PROFILE-EDIT.md](USER-PROFILE-EDIT.md)。


## DE. ~~待开发：对齐审核页改版（布局重做 + 进度/空态修正）~~ → **已发布 v2.24.4（2026-11-18，318e678 + 729d0e9）**

**状态：已发布 v2.24.4（2026-11-18，318e678 + 偏差修复 729d0e9；QA 报告 docs/QA-DE.md 第 1 轮 ⚠️ 有条件放行——通过 7/偏差 1（已修）/需人工确认 1：移动端目视，待部署后）**
**依赖：** CS（已发布 v2.24.3 ✅，后台生成已实现）
**解锁：** 无
**规格**：[ALIGN-REVIEW-UI.md](ALIGN-REVIEW-UI.md)
**Demo**：[design/align-review-redesign-2026-11-18.html](design/align-review-redesign-2026-11-18.html)（页面改版）+
[design/admin-confirm-no-toggle-2026-11-18.html](design/admin-confirm-no-toggle-2026-11-18.html)（批量确认/孤儿行提示/审计）

- **问题（2026-11-18 线上 v2.24.3）**：横幅长期显示「0/0 组」（`total` 在分组完成前为 0）；生成中同时出现「暂无数据」+
  「没有待对齐的组」两种语义；缺统计、缺搜索/筛选、批量操作弱、信息密度低。
- **新布局**：头部状态（已生成/生成中/失败 + 生成时间 + 刷新）→ **5 个统计卡**（待对齐组/SKU/自动/需人工/继承）→
  生成中进度条（`X/Y`，Y 在分组后立即上报）→ 工具栏（搜索 + 4 个筛选 chip + 批量确认/忽略）→ 表格（勾选/组名/SKU 数/
  候选/分数色条/方式/建议/操作）→ 分页；**空态只在"已完成且 0 组"时出现**。
- **接口**：`/api/admin/align` 生成中返回 `202 {generating, processed, total, stale}`（total 分组后立即上报，
  同时可返回上一轮缓存分页数据）；完成返回 `counts {groups, skus, auto, manual, noCandidate, inherited}` + `generatedAt`。
- **验收**：见规格 §4 的 9 行「demo 状态 ↔ 断言」——头部状态/统计数值/进度不出现 0/0/搜索筛选/表格色条与徽标/批量操作/
  空态互斥/分页/移动端；`npm test` / `frontend:build` / `scan` 全绿。
- **已确认（2026-11-18）**：保留「本次自动继承」卡；不加「候选来源平台」列；本批不做「批量手动搜索」（二期）。


## CO. ~~待开发：设计审计技术债清理（21 项 → 4 批，每日推进）~~ → **已发布 v2.27.1（2026-11-19）**

**状态：已发布 v2.27.1（2026-11-19；21 项全部收口——B4 已交付 app/appeal 两域，QA docs/QA-CO4-B4.md 第 1/2 轮 ✅ 16/0/0/1；E1 文档归档已完成（不进版本）；剩余 ~18 个域拆分另行立项（B4-2/CO-5），本次发布只结两域）**

| 批次 | 子项 | 内容 | 状态 |
|---|---|---|---|
| **CO-2** | B1 | **统一请求超时 + 重型接口并发闸**（中间件，15s 超时；单接口并发 ≤1–2） | 已发布 v2.24.4（75a7e7f） |
| **CO-2** | B2 | admin 列表接口提速（`/api/admin/games` 2.1s、`/sync/status` 1.7s：走读模型/索引 + 短缓存） | 已发布 v2.24.4（75a7e7f） |
| **CO-3** | C2 | `/api/app/*` 保持豁免但加**设备维度限流** + 审计 | 已发布 v2.24.4（89c8dfd） |
| **CO-3** | C4 | 日期/金额统一 helper（后端格式化 + 前端 money util），替换散落 `/100` | 已发布 v2.24.4（89c8dfd） |
| **CO-3** | C5 | 契约漂移校验（APP-API ↔ 代码字段一致性测试，仿 `serve.test.js` 白名单断言） | 已发布 v2.24.4（89c8dfd） |
| **CO-1** | A5 | 同步任务失败可见（后台「任务健康」标红 + 可选邮件告警；`app-release-sync` 失败不再静默） | 已发布 v2.24.5（c4e2695；QA docs/QA-CO1-A5.md 第 1 轮 ✅） |
| **CO-2** | B5 | 读模型双写一致性守卫（入库唯一入口 + 对账任务增强） | 已发布 v2.24.5（5b1cbfb；QA docs/QA-B5.md 第 1 轮 ✅） |
| **CO-4** | D1 | 样式 token 收敛（`main.css` 46 行 vs 组件内联超长 CSS） | 已发布 v2.24.5（2ee09af；QA docs/QA-D1.md 第 1 轮 ✅） |
| **CO-1** | A3 | `skus.json` 与 `game_source_map` 双真相源 → 以库为唯一真相、skus.json 只读兼容 | 已发布 v2.25.0（6a9ecc3 + 随行提交；QA docs/QA-CO1-A3.md 第 1 轮 ✅ 25/0/0/0） |
| **CO-2** | B3 | 任务预算改**实测耗时**（AC-4 估算）；任务卡显示实际与估算差 | 已发布 v2.25.0（7a324b0 + 收尾 693dcb5；QA docs/QA-CO2-B3.md 第 1 轮 ✅ 15/0/0/1） |
| **CO-4** | D4 | 移动/桌面双结构 `v-if` 渐进合并（CSS 优先） | 已发布 v2.26.0（56d8573；QA docs/QA-D4.md 第 1 轮 ✅） |
| **CO-4** | D6 | 覆盖率/性能基线门禁（与 CK 的 e2e 报告联动） | 已发布 v2.26.0（40517d5；QA docs/QA-D6.md 第 1 轮 ✅） |
| **CO-4** | E4 | 日志统一字段规范（关键域失败字段 + 告警阈值） | 已发布 v2.26.0（551f4b1 + e5cfef1；QA docs/QA-CO4-E4.md ✅ 放行 4/0/0/1） |
| **CO-4** | B4 | 巨石拆分（`server.js`/`pg.js`/`cli.js` 渐进拆 routes/repository，先一个域试点） | 已发布 v2.27.1（2026-11-19，试点 App 域 0c8f5ff + 第二轮申诉域 34a7bcc；QA docs/QA-CO4-B4.md 第 1/2 轮 ✅ 16/0/0/1；**已交付 app/appeal 两域（routes/app.js + app-repository.js、routes/appeal.js + appeal-repository.js，契约零变化）；剩余 ~18 个域拆分另行立项（B4-2/CO-5）**——本次发布只结两域） |


## DG. ~~质检通过：对齐匹配修复（副标题/别名导致低分 → 无候选）~~ → **已发布 v2.24.5（2026-11-18，afc5a91 + 12a6de7）**

**状态：已发布 v2.24.5（2026-11-18，afc5a91 + JSDoc 12a6de7；QA 报告 docs/QA-DG.md 第 1 轮 ✅ 放行）**
**依赖：** DE（对齐页改版，共用同一接口）
**解锁：** 无

- **取证（2026-11-18 服务器实查）**：`skus.json` 的 SKU 111465 已映射（`appid=1604270`，会被继承、不入队列）；
  队列里那条是**孤儿游戏行** `games.id=1545848`（无 appid，`name='断箭: 俄罗斯国民近卫军'`，`name_en='Broken Arrow: Russian Guard'`）；
  候选存在：`games.id=53038`（appid 1604270，`name='断箭'`，`name_en='Broken Arrow'`）→ **候选没漏，是分数低于 0.86 被丢弃**。
- **根因**：匹配按整串标题打分，副标题（"俄罗斯国民近卫军"/"Russian Guard"）拉低相似度；`buildCandidateIndex` 还漏了 `name_en`
  （`server.js` 调 `buildCandidateIndex(games)` 用默认 `c.nameEn`，DB 行是 `name_en`）。
- **修复**：① 索引 getFields 改为 `[c.name, c.name_en]`（一处）；② **副标题感知**：按 `：: - — /` 切主标题，主标题精确/包含命中时
  给 0.90–0.93 的分数 + 理由 `subtitle`（落在"需人工"区，不自动确认）；③ 内容词（季票/DLC）仍不自动确认；
  ④ 单元测试覆盖：带副标题、带英文副标题、带版本词、纯中文命中。
- **验收**：断箭组显示候选（分数 0.90–0.93，标"副标题"理由）；季票组仍提示内容词；`npm test` / `frontend:build` / `scan` 全绿。


## DI. ~~质检通过：测试环境隔离与主链分段（A 隔离 + B 分段 + C 复位）~~ → **已发布 v2.24.5（2026-11-18，3acd1b8）**

**状态：已发布 v2.24.5（2026-11-18，3acd1b8；QA 报告 docs/QA-DI.md 第 1 轮 ✅ 放行，通过 4/缺失 0）**
**依赖：** 无（2026-11-18 CO-3 会话两次全量测试被环境干扰，本条目把应对措施固化）
**解锁：** 无
**规格**：[TEST-ENV-ISOLATION.md](TEST-ENV-ISOLATION.md)

- **背景（CO-3 会话实测）**：① 本机 `data/app/latest.json` 同步产物让 `serve.test.js` CJ-回归用例红
  （测试读真实工作区 `data/`，手工移到 `F:\dsh\data-app-co3-bak` 才绿）；② 主链 100+ 文件单条 `&&` 链
  （8–15 分钟）中途被中断需从头重跑（手工 4 段串行后通过）。
- **A 测试隔离**：`test/serve.test.js` CJ-回归用例改用 `APP_DATA_DIR` 临时目录注入（`src/server.js:163` 已支持，
  无需改服务端）+ 反向自检（不注入 + 放假产物必须红）。
- **B 主链分段**：`package.json` 拆 `test:1`~`test:4` 四段，`test` 逐段串行；中断从失败段续跑；同步
  dev/test/qa/build 四个技能的验证命令说明。
- **C 环境复位**：`scripts/test-env-reset.mjs`（`npm run test:reset`）白名单精确移走运行时产物到仓库外
  `F:\dsh\test-env-bak\<时间戳>\`（默认 dry-run，`--apply` 执行，`--restore` 可恢复）；**绝不整删 `data/`**——
  `skus.json`/`games.json`/`secret.key` 源数据与 `*pgdata*` 调试库永不入选。
- **验收**：见规格 §4——A：data/app 有产物时 serve.test.js 仍全绿 + 反向自检红；B：四段互不依赖、失败段可续跑；
  C：dry-run 只打印、--apply 后源数据完好、幂等；`npm test` 全绿 + `scan` 干净。


## DJ. ~~质检通过：发版测试报告（独立会话）+ e2e 整轮总预算~~ → **已发布 v2.24.5（2026-11-18，c87dfe0）**

**状态：已发布 v2.24.5（2026-11-18，c87dfe0；QA 报告 docs/QA-DJ.md 第 1 轮 ✅ 放行，通过 6/缺失 0/需人工确认 2）**
**依赖：** CK（已发布 v2.24.0）
**解锁：** 无
**规格**：[E2E-SUITE.md](E2E-SUITE.md)

- **背景**：e2e 全量已移出构建门禁（build 技能 7e4c8fa 已改）——发版完成后由所有者开**独立报告会话**跑全量出 PDF；
  整轮需要总预算兜底，到点强制收尾，避免跑不完拖住后续轮次。
- **范围**：① `test/e2e/runner.mjs` 整轮总预算（默认 20 分钟 deadline，`E2E_BUDGET_MS` / `--budget-ms=` 可调，测试可缩短），
  到点**强制收尾**——剩余未跑项标「预算截断」、照常生成 HTML/PDF 报告、退出码三态（0 全绿 / 1 有失败 / 2 预算截断）；
  ② 补 runner 预算单测（`test/e2e/budget.test.js`：缩短预算到点截断 + 正常轮不截断 + 退出码三态，进主链 test:4）；
  ③ `steamdeals-test` 技能新增 §2.3「发版测试报告（独立会话）」流程（发版后所有者开独立会话 → 加载 steamdeals-test →
  跑 `npm run e2e` 全量 → PDF 落 `F:\dsh\e2e-reports\<日期>-<短哈希>.pdf` → 汇报 X 通过 / Y 失败 / Z skip / W 预算截断 →
  失败项转 QA/开发按反模式清单处理）+ §2.2 表「发版前必跑」同步为「发版后由独立报告会话跑」；④ 本条目 + INDEX 行。
- **不做**：build 技能（已改好）、任何 e2e 矩阵行增删、服务器/生产数据。
- **验收**：① 模拟慢轮（缩短预算）到点强制收尾、剩余项标「预算截断」、PDF 照常生成；② 正常全量在预算内不截断；
  ③ 按 §2.3 描述的流程能跑通（至少命令链路验证，PDF 落 `F:\dsh\e2e-reports\`）；④ `npm test`（主链相关段）+ `npm run scan` 全绿。


## CQ. ~~质检通过：系统设置信息架构重构（平台卡片 + 常用/高级折叠 + 只看非默认）~~ → **已发布 v2.25.0（2026-11-19，6850e5b + 修复 b705824/50f5e45）**

**状态：已发布 v2.25.0（2026-11-19，实现 6850e5b + 修复 b705824/50f5e45；QA 报告 docs/QA-CQ.md 第 3 轮 ✅ 9/0/0/2）**
**依赖：** 无
**解锁：** 无
**规格**：[SETTINGS-IA.md](SETTINGS-IA.md)

- **痛点（实测）**：`settings.js` 86 个配置项平铺——sources 32、advanced 16、alerts 13、security 10、site 8、auth 4、network 3；
  「数据源与采集」把开关/间隔/条数/限速/Key 混在一起，`高级` 16 项一屏到底，越加越难维护。
- **已确认决策（7 项）**：① 数据源按平台卡片（全局/Steam/杉果/ITAD/GOG+Humble/发现与热度）；② 每卡常用 ≤3 项，
  其余进「高级 N 项」折叠（默认收起，标题行带摘要）；③ 站点与内容常用 4 项 + 「推荐与评分 4 项」折叠；
  ④ 高级拆 4 折叠组（调度与熔断/备份与日志/缓存与图片/时区与显示）；⑤ 通用能力：只看非默认、来源标注（数据库/环境变量/默认）、
  恢复默认（单行+分组）、搜索命中自动展开高亮；⑥ **不改任何 key/默认值/语义**，只在 `def()` 加 meta（section/tier/summary）
  并由 schema 接口下发；⑦ 保存/重新加载/15 秒热加载行为不变。
- **改动落点**：`src/settings.js`（86 项补 meta）、`src/settings-routes.js`/`src/server.js`（schema 带 meta + `source` + `isDefault`）、
  `frontend/src/pages/AdminModules.vue`（卡片/折叠/过滤/恢复/搜索展开）、`test/settings.test.js` 扩展。
- **验收**：见规格 §4——① 6 张平台卡、每卡常用 ≤3；② 折叠默认收起且标题带摘要；③ 站点/高级折叠组符合 demo；
  ④ 只看非默认生效且刷新保持；⑤ 来源标注三类正确；⑥ 恢复默认（单行/分组）生效；⑦ 搜索命中折叠项自动展开高亮；
  ⑧ 保存/重载/权限行为不变；⑨ `npm test` / `frontend:build` / `scan` 全绿；移动端单列。
- **已确认（2026-11-18）**：折叠标题行带摘要；恢复默认（单行/分组）二次确认；移动端单列卡片 + 折叠保留。


## CW. ~~质检通过：后台「游戏目录」点游戏名弹详情（Steam 数据 + 商店跳转）~~ → **已发布 v2.25.0（2026-11-19，实现随 b9811f8 入 main）**

**状态：已发布 v2.25.0（2026-11-19，实现随 b9811f8 入 main；QA 报告 docs/QA-CW.md 第 1 轮 ✅ 放行 11/0/0/2）**
**依赖：** 无
**解锁：** 无
**规格**：[ADMIN-GAME-POPUP.md](ADMIN-GAME-POPUP.md)（含 demo 状态↔断言表）
**Demo**：[design/admin-game-popup-2026-11-18.html](design/admin-game-popup-2026-11-18.html)

- **现状**：后台游戏名是纯文本（`AdminModules.vue` L67），无点击；已有 `GET /api/games/:appid` 返回
  `{game, offers, series, dlc, watch}`；`GAME_SELECT` **缺 `header_image`、`release_date`** 两列。
- **需求（6 项）**：① 点游戏名弹小弹窗（640px，移动端 100%）；② 内容 = 封面 + 中英名 + AppID + 徽标 +
  发售/开发商/发行商/类型/平台/分级 + 价格条（当前/史低/折扣）+ 简介（4 行可展开）；③ 数据用**站内已同步的
  Steam 数据**（不实时请求）；④ 底部固定「**在 Steam 商店查看**」→ `https://store.steampowered.com/app/<appid>/` 新窗口；
  ⑤ 未同步/无 appid 有明确兜底；⑥ 游戏名用蓝色虚线下划线样式，不影响行内按钮。
- **改动落点**：`src/store/pg.js`（`GAME_SELECT` +2 列）、`frontend/src/pages/AdminModules.vue`（点击 + 弹窗 + fetch + 兜底）、
  `test/api.test.js`（详情含 `header_image`/`release_date` 断言）。
- **验收**：见规格 §4 的 11 行「demo 状态 ↔ 断言」——列表点击、徽标、封面、字段、价格、简介展开、Steam 跳转、
  无 appid 兜底、移动端、`npm test` / `frontend:build` / `scan` 全绿。
- **已确认（2026-11-18）**：回收站同样支持；弹窗加 **DLC 数量 + Steam 评测数**（复用同一详情响应，
  `heat_reviews` 随 `GAME_SELECT` 返回）；简介保持 4 行截断 + 展开。


## CX. ~~质检通过：个人资料编辑（Web + App；头像存库/双 Steam 账号/换绑）~~ → **已发布 v2.25.0（2026-11-19，站点随 b9356aa/93e1241/2f01b59 入 main + App 仓库 6f68e81）**

**状态：已发布 v2.25.0（2026-11-19，QA 报告 docs/QA-CX.md 第 1 轮 ✅ 14/0/0/1；审计 docs/AUDIT-2026-11-19.md 已确认改坏项已补回；站点实现随 b9356aa/93e1241/2f01b59 入 main + App 仓库 6f68e81）**
**依赖：** 无（CY 的数据隔离可并行）
**涉及 App 仓库**：是（app-v2.21.0 随本批）
**解锁：** 无
**规格**：[USER-PROFILE-EDIT.md](USER-PROFILE-EDIT.md)
**Demo**：[design/profile-web-2026-11-18.html](design/profile-web-2026-11-18.html) / [design/profile-android-2026-11-18.html](design/profile-android-2026-11-18.html)

- **现状**：`users` 无头像/bio 列；`/api/me` 只有 GET；没有个人资料页；Steam 账号已有列表/别名/解绑（解绑保留历史），
  绑定走 Steam 登录。
- **需求（8 项）**：① 管理员/用户同一套页面与接口，只能改自己；② **头像存数据库**（bytea + mime + source），
  客户端裁剪 256×256，`GET /api/avatar/:userId` 输出；③ 头像来源 = 已绑 Steam 账号（**多账号可选其一**）或自定义上传；
  ④ 昵称（2–20）/简介（≤200）/主题/邮件提醒开关可编辑；用户名/邮箱（二期换邮箱）/角色只读；
  ⑤ Steam 账号卡：列表 + **设为默认 / 解绑（保留历史）/ 新增绑定**；⑥ **App 端同样支持**（新增在浏览器打开绑定流程）；
  ⑦ 其它页面有头像处显示头像；⑧ 与 CY 的只读边界一致（管理员不能改别人的资料）。
- **改动落点**：`pg.js`（users 加列 + profile/avatar/默认账号）、`server.js`（`PATCH /api/me/profile`、
  `POST/DELETE /api/me/avatar`、`GET /api/avatar/:userId`、`POST /api/steam/accounts/:id/default`）、
  `frontend/src/pages/ProfilePage.vue`（新）+ Console 入口、App `ProfileEditScreen`、`test/profile.test.js`。
- **验收**：见规格 §4 的 10 行「demo 状态 ↔ 断言」——头像展示/默认头像切换/双账号列表/设为默认/解绑/新增、表单校验、
  只读字段、越权 403、`npm test` / `frontend:build` / `scan` 全绿 + App 模拟器验证。
- **补充（2026-11-18 沟通）**：**我的资料仅本人可见**（无他人访问入口，管理员同样）；**必填**昵称/简介/邮箱（管理员昵称/简介可空，
  邮箱仍必填；老用户邮箱为空不强制补全）；**多 Steam 账号用卡片**（每账号一卡：头像/昵称/SteamID/已拥有数/愿望单数/最近同步）；
  资料页下半部展示我的游戏库与统计（仅本人）；DB 已并入本条目。


## CY. ~~质检通过：数据隔离（用户私有数据管理员只读）~~ → **已发布 v2.25.0（2026-11-19，3351f9f）**

**状态：已发布 v2.25.0（2026-11-19，实现 3351f9f；QA 报告 docs/QA-CY.md 第 1 轮 ✅ 放行 6/0/0/0；审计 §③遗漏 1 的测试链修复——`test/isolation.test.js` 已随本批注册进主链 test:4）**
**优先级：** P1（安全/合规）
**依赖：** CX（个人资料页，同批发布）
**解锁：** 无
**规格**：[DATA-ISOLATION.md](DATA-ISOLATION.md)

- **现状**：用户级接口已按 `session.user.id`；但 `/api/admin/watchlist`（全站到价提醒）、`/api/admin/wishlists`、
  `/api/admin/views` 等**管理员可写用户数据**（后台有删除按钮），没有只读边界。
- **边界（已确认）**：用户私有数据（提醒/愿望单/访问记录/Steam 绑定）**管理员只读**；站点级提醒、账号安全
  （封禁/会话/设备）、申诉处理、内容审核、未归属账号认领**保留可写**。
- **改动**：`/api/admin/watchlist` 写操作仅允许 `user_id IS NULL`；用户行写 → **403 + 审计 `admin.forbidden_write`**；
  `/api/admin/wishlists`、`/api/admin/views` 去掉写方法；前端用户行隐藏操作按钮并标「只读」；
  用户级接口忽略请求里的 `userId`；新增 `test/isolation.test.js`（A/B 两用户 + 管理员三视角）。
- **验收**：见规格 §4——① A 只看自己的；② 管理员看全部但用户行不可写（越权 403 + 审计）；③ 站点级可写；
  ④ 账号安全/申诉/审核回归通过；⑤ 管理员查看 Steam 绑定只读；⑥ `npm test` / `frontend:build` / `scan` 全绿。


## CZ. ~~质检通过：更换登录邮箱（邮箱体系收尾；验证码登录/忘记密码已实现）~~ → **已发布 v2.25.0（2026-11-19，站点 ac52955 + App 仓库 7c01820）**

**状态：已发布 v2.25.0（2026-11-19，站点 ac52955 + App 仓库 7c01820；QA 报告 docs/QA-CZ.md 第 1 轮 ✅ 放行 11/0/0/2——App 重登目视、demo 像素目视；管理员重置邮箱审计随 CY 提交 3351f9f 入 main）**
**来源：** [USER-PROFILE-EDIT.md](USER-PROFILE-EDIT.md) §5、[APP-NATIVE.md](APP-NATIVE.md) §6 第 4 条
**依赖：** CX（个人资料页，同批发布）、现有邮件服务（SMTP 已配置）
**涉及 App 仓库**：是（app-v2.21.0 随本批）
**解锁：** 无
**规格**：[EMAIL-CHANGE.md](EMAIL-CHANGE.md)
**Demo**：[design/email-change-2026-11-18.html](design/email-change-2026-11-18.html)（Web）/ [design/email-change-android-2026-11-18.html](design/email-change-android-2026-11-18.html)（App）

- **现状（代码核对）**：邮箱验证码登录（`/api/auth/email/request|verify` purpose=login）、忘记密码（purpose=reset）、
  邮箱验证码注册（`/api/auth/register/request|verify`）**都已实现**并有前端入口；**用户自助更换邮箱没有**——
  只有管理员能改用户邮箱（`server.js:3506`）。→ 本批只做换邮箱 + 加固，不重复实现已有功能。
- **已确认决策（5 项）**：① 验证码发**新邮箱**、旧邮箱收安全通知；② 换成功**全部会话下线**（含当前，跳登录）；
  ③ 验证码 10 分钟/5 次；**换邮箱 24h 最多 1 次**；④ 未验证邮箱也能换（换完变已验证）；
  ⑤ **保留管理员重置邮箱能力**（安全兜底）+ 审计 + 通知用户。
- **接口**：`POST /api/me/email/request`（不泄露占用）、`POST /api/me/email/verify`（占用在验证码通过后才提示 409；
  成功→更新 email/email_verified、删全部会话、审计 `auth.email_changed`、发两封邮件）；管理员重置接口保留。
- **前端**：资料页邮箱行加「更换邮箱」→ 两步对话框（新邮箱+验证码）；**App 端同样支持**（底部弹层两步，成功后清 token 跳登录）。
- **验收**：见规格 §4——① 换成功双邮件 + email_verified；② 会话全清（当前 401 跳登录）；③ 验证码错误/过期/超次数提示；
  ④ 24h 频控 429；⑤ 未验证可换；⑥ 管理员重置仍可用 + 审计；⑦ App 端可完整走通换邮箱；⑧ npm test（email-change 7 项）/ frontend:build / scan 全绿。


## DA. ~~质检通过：CM-5 App 筛选/排序服务端化（方案 A：站点 + App 一起做）~~ → **已发布 v2.25.0（2026-11-19，站点 b46669a + App 仓库 4334823）**

**状态：已发布 v2.25.0（2026-11-19，站点 b46669a + App 仓库 4334823；QA 报告 docs/QA-DA.md 第 1 轮 ✅ 放行 6/0/0/2——App 空态目视、部署后 P95 ≤500ms 抽测）**
**来源：** [APP-PARITY.md](APP-PARITY.md) §57（CM-5）、[APP-NATIVE.md](APP-NATIVE.md) §4.4（"筛选 ⚠️ 本地按已加载数据"）
**依赖：** 无（站点 `/api/games` 已支持 sort=discount/price/name/score、type、released；需扩展筛选参数）
**涉及 App 仓库**：是（app-v2.21.0 随本批；**App 依赖本批站点 `/api/games` 参数——先发站点、部署后再升级 App**）
**解锁：** 无
**规格**：[APP-FILTER-SERVER-SIDE.md](APP-FILTER-SERVER-SIDE.md)

- **现状（代码证据）**：App `HomeScreen.kt` 的 `HomeFilter`（全部/折扣/史低/免费/未发售）是**本地筛选已加载数据**；
  注释明确"服务端 /api/games 目前只支持 sort 与 type/released"。→ 用户只能筛出**已加载的约 50 条**里的折扣游戏。
- **范围（方案 A）**：站点 `/api/games` 增加 `discountOnly / histLowOnly / freeOnly / unreleased` + `sort=heat|release`，
  4 个开关互斥（优先级 unreleased > freeOnly > histLowOnly > discountOnly），count 与列表同条件；App chip 改为
  **服务端筛选 + 分页重置**；**第 5 个 chip「已拥有」复用 `owned=only`**（仅登录+已绑定 Steam 显示）；Web 复用同参数保证口径一致。
- **附带（已确认）**：`user_prefs.only_discount` 是**死字段**（存但未用）→ **删除**（迁移 drop 列）。
- **已确认口径**：史低 = 当前价 = 历史最低（与详情页一致）；未发售**不含**"已发售无报价"；已拥有 = 多账号 Steam 库存并集。
- **验收**：见规格 §4——① App 折扣筛选返回全库结果；② Web/App 同条件总数一致；②b 已拥有 chip 返回库存并集/未绑定不显示；
  ③ 空态/分页正确；④ count 与列表一致；⑤ P95 ≤500ms；⑥ `npm test` / `frontend:build` / `scan` 全绿 + App 模拟器逐 chip 截图。
- **已确认（2026-11-18 开发完成时）**：App 本期做（双仓库同批提交）；Web 前台复用同一批参数（接口共用解析保证口径一致，Web UI 不改版）。


## DC. ~~待开发：App 公告角标与公告列表（CM-6）~~ → **已发布 v2.25.0（2026-11-19，App 仓库 ef17e9a）**

**状态：已发布 v2.25.0（2026-11-19，App 仓库 ef17e9a；QA docs/QA-DC.md 第 1 轮 ✅ 放行）**
**来源：** [APP-PARITY.md](APP-PARITY.md) §65
**依赖：** 站点 `GET /api/announcements` + `POST /api/announcements/read`（均已实现）、App 登录态
**涉及 App 仓库**：是（app-v2.21.0 随本批；纯 App 端）

- **现状（代码核对）**：后端已齐——`announcements`（active/starts_at/ends_at）、`announcement_reads(user_id, announcement_id)`、
  读接口返回公告 + 当前用户 `readIds`（游客空数组）、已读上报接口；**App 端没有公告列表/角标**。
- **已确认口径**：① 入口 = **首页右上角铃铛 + 「我的」里的「公告」**；② 未读 = **所有 active 公告中不在 readIds 的**；
  ③ **游客可看公告**，已读存本地（登录后与服务端合并）。
- **范围（纯 App 端）**：铃铛角标（未读数，0 隐藏）→ 公告列表弹层（标题/级别色点/时间/已读态）→ 点开详情；
  进入/点击后上报已读；下拉刷新；未读数为 0 时角标消失。
- **验收**：未读公告出现角标数字；点开列表后逐条已读、角标递减；全部已读后角标消失；游客本地已读重启 App 仍保留；
  登录后本地已读合并到服务端；`npm test`（如站点补 unreadCount 则加断言）/ App 构建 + 模拟器验证。


## DH. ~~待开发：对齐审核数据完整性（继承缺口/忽略撤销/审阅痕迹）~~ → **已发布 v2.25.0（2026-11-19，d3c67ec + 修复 cc8e351）**

**状态：已发布 v2.25.0（2026-11-19，d3c67ec + 修复 cc8e351；QA docs/QA-DH.md 第 2 轮 ✅）**
**依赖：** DG（匹配修复，已发布 v2.24.5）、DE（页改版，已发布 v2.24.4）
**解锁：** 无
**规格**：[ALIGN-INTEGRITY.md](ALIGN-INTEGRITY.md)

- **问题**：A 继承缺口——`applyMapInheritance` 只认 `game_source_map`，不认 `skus.json` 已有 `appid`（断箭 SKU 111465 已映射仍入队）；
  B 忽略不可撤销（无「已忽略」视图/恢复）；C 审阅痕迹不可见（`reviewed_by` 有存但页面无展示）；D 孤儿行合并无提示。
- **修复**：A1 继承同时参考 item.appid（有则不入队，库无映射则自动补写 + 日志 `align.map_backfilled`）；
  A2 队列标「已映射（待同步）」+ 一键补写；B1 「已忽略」视图 + 恢复为待处理（审计 `align.restored`）；
  C1 每组显示最近处理（操作人/时间/动作）；D1 确认弹窗提示孤儿行合并。
- **接口**：`GET /api/admin/align/ignored`、`POST /api/admin/align/restore {key}`、`GET /api/admin/align/history?key=`、
  `POST /api/admin/align/map`。
- **验收**：见规格 §4——① 断箭组不再入队且映射补写；② 已忽略可列出/恢复；③ 审阅记录可查；④ 孤儿行合并提示；
  ⑤ `npm test` / `frontend:build` / `scan` 全绿。
- **已确认（2026-11-18）**：补写=**自动**（计算时补写 + 日志 align.map_backfilled）；恢复已忽略=**需要二次确认**。


## DK. ~~质检通过（修 bug）：App 检查更新失败——apkPath 缺 GitHub 直链兜底~~ → **已发布 v2.25.0（2026-11-19，站点 d65542f + App 仓库 8fb6328）**

**状态：已发布 v2.25.0（2026-11-19，站点 d65542f + App 仓库 8fb6328；QA docs/QA-DK.md 第 1 轮 ✅ 放行 6/0/0/2）**
**优先级：** P1 —— App 更新链路不可用（有新版但提示失败）
**依赖：** 无（CJ/BY 内置更新契约已发布）
**解锁：** 无
**涉及 App 仓库**：是（app-v2.21.0 随本批；App 端提示分支）
**规格**：本条目 + [APP-AUTO-UPDATE-PAGE.md](APP-AUTO-UPDATE-PAGE.md)（CJ 契约）+ [APP-NATIVE.md](APP-NATIVE.md)（内置更新）

- **现象（2026-11-19 01:54 手机实测）**：「我的 → 检查更新」弹「检查更新失败，请稍后再试」；
  线上 `GET https://sd.yyliucha.cn/api/app/latest` 返回 200：`version=2.20.0`、`versionCode=22000`、
  `sha256`/`size` 与 GitHub Release 一致，但 **`apkPath: null`**。
- **根因（代码证据）**：① `src/app-release.js:146-166` APK 下载失败只记 `release_failed`（reason=apk_download）、
  latest.json 照常落盘 → 服务器 `data/app` 有元数据、无 APK（国内服务器拉 GitHub 资产域名超时是已知风险）；
  ② 站点 `/api/app/latest` 的 apkPath 按文件存在性派生（CJ 回归修复），无本地 APK 且镜像无该版本 → `null`；
  ③ App `UpdateManager.kt:75` `resolveApkUrl(latest.apkPath) ?: return CheckResult.Failed` → 报「检查更新失败」。
- **修复**：A **服务端兜底**：apkPath 为 null 时返回 GitHub Release 直链
  `https://github.com/yyliucha/steamdeals-app/releases/download/app-v<version>/steamdeals-<version>.apk`
  （App 白名单已含 github.com / githubusercontent.com，见 `UpdateManager.kt:107`）；
  B **App 端体验**：apkPath 缺失分支区分提示「新版下载地址暂不可用，请到站点 /app 页下载」，不再笼统报失败；
  C 观测：`apk_download` 失败在后台任务健康可见（A5 已具备，部署后核对）；
  **D 同步自愈（2026-11-19 追加，代码证据 `src/app-release.js:116-124`）**：`same_version` 跳过判断必须
  加 APK 文件存在性检查——本地 latest.json 同版本但 `steamdeals-<version>.apk` 缺失时**不得跳过**、应重新下载；
  否则一旦某轮 APK 下载失败（如本次），每小时调度会永远 same_version 跳过、APK 永不补齐。
- **验收**：① 模拟 apkPath 缺失（data/app 无 APK、镜像无该版本）→ 接口返回 GitHub 直链（形如
  `/releases/download/app-v…/steamdeals-…apk`）且不为 null；② App 该分支提示新文案且不报「失败」（单测）；
  ③ 正常同步场景（data/app 有 APK）不回归；④ `npm test`（分段）+ `npm run scan` 全绿。
- **实现（2026-11-19）**：A `src/app-release.js` 新增 `githubApkUrl`（版本不合法仍 null）+
  `src/server.js` `/api/app/latest` 的 `apkPath = appApkPathFor(…) ?? githubApkUrl(…)`；
  B App 端 `UpdateManager.decideUpdate` 纯函数——apkPath 缺失/非法返回 `Unavailable`（提示
  「新版下载地址暂不可用，请到站点 /app 页下载」，网络失败仍是 `Failed`）+ `UpdateDialogHost` 新分支 +
  `UpdateManagerTest` 9 项；C apk_download 失败带 `apkFailed` 标记、`cmdAppSync` 抛错 → 任务健康条显红；
  D（同批追加）same_version 跳过加 APK 存在性检查（APK 缺失重新下载补齐，每小时自愈）。


## CU. ~~待开发：到价提醒治理（无报价标记 / 站点级迁移 / 史低抽检 / 刷新频率评估）~~ → **已发布 v2.26.0（2026-11-19）**

**状态：已发布 v2.26.0（2026-11-19；CU-1 实现 b5f5663 + 恢复 77c9f8f，QA 报告 docs/QA-CU1.md 第 2 轮 ✅ 3/0/0/1；CU-2 实现 b7ab402，QA 报告 docs/QA-CU2.md 第 1 轮 ✅ 5/0/0/2；CU-3 规格 §6 附录（分析类无代码），QA 报告 docs/QA-CU3.md 第 1 轮 ✅ 4/0/0/2；CU-4 规格 §7 附录（未改配置），QA 报告 docs/QA-CU4.md 第 1 轮 ✅ 4/0/0/1）**
**依赖：** CL（已发布 v2.23.0，用户级提醒）
**解锁：** 无
**规格**：[USER-ALERTS-GOVERNANCE.md](USER-ALERTS-GOVERNANCE.md)

- **实测（2026-11-18）**：15 条提醒全部为**站点级**（user_id 为空）、全部未设目标价（跌至史低模式）；
  其中 **2 条无任何报价**（State of Decay 3 / Warhammer 黑暗异端）→ 永远不触发；
  多条当前价=史低（靠 last_notified 去重）；**部落幸存者史低 ¥20.25 可疑**（当前 ¥72）。
- **四项（合并交付）**：CU-1 列表「无报价」徽标+筛选（实现 b5f5663 + 恢复 77c9f8f，QA-CU1 第 2 轮 ✅）；CU-2 站点级提醒按 Steam 愿望单反查用户
  （`steam_wishlist` → `steam_accounts.user_id`，多用户全部列出，可一键迁移给这些用户，审计）（b7ab402，QA-CU2 第 1 轮 ✅）；
  **CU-3 史低抽检（全部异常样本**，不只部落幸存者，只读 SQL，脏数据才修）（规格 §6 附录 SQL + 结论清单，QA-CU3 第 1 轮 ✅；部落幸存者 ¥20.25 = 真实促销史低，非脏数据）；CU-4 Steam 刷新频率评估
  （默认不改，只出 720/480 配额数字与建议）（规格 §7 评估，QA-CU4 第 1 轮 ✅；建议 720 可接受 / 480 不推荐，未改任何配置）。
- **改动落点**：src/store/pg.js（hasPrice + 迁移/批量删）、src/server.js（/api/admin/watchlist 扩展 +
  /migrate + 批量删除 + 审计）frontend/src/pages/AdminModules.vue（徽标/筛选/多选/迁移）、测试。
- **验收**：见规格 §4——① 无报价两行有徽标且可筛选；② 迁移后 user_id/收件人变化；③ 批量删除+审计；
  ④ 抽检 SQL 结论；⑤ npm test / frontend:build / scan 全绿；⑥ CU-4 只出建议不改配置。
- **待确认**：无（2026-11-18 已定：迁移目标=按 Steam 愿望单反查的用户，多个全列；抽检=全部异常样本；CU-4=只出配额数字）。


## DF. ~~待开发：到价提醒手动推送（重发按钮）~~ → **已发布 v2.26.0（2026-11-19，578f063）**

**状态：已发布 v2.26.0（2026-11-19，578f063；QA 报告 docs/QA-DF.md 第 1 轮 ✅ 9/0/0/2）**
**依赖：** CL（用户级提醒，已发布）、现有 `notify.js` 通道
**解锁：** 无
**规格**：[ALERT-MANUAL-PUSH.md](ALERT-MANUAL-PUSH.md)
**Demo**：[design/alert-manual-push-2026-11-18.html](design/alert-manual-push-2026-11-18.html)（单条推送）+
[design/admin-confirm-no-toggle-2026-11-18.html](design/admin-confirm-no-toggle-2026-11-18.html)（批量推送合并一封/确认/审计）

- **现状**：提醒只由 `alerts` 定时任务触发（每 360 分钟）；后台每行只有「删除」，没有手动发送。
- **需求**：每行加「推送」→ 确认弹窗（游戏/用户/当前价/史低/上次提醒/渠道）→ 立即发送；
  **强制推送**（未达条件也发）与**更新最近提醒时间**（写 `last_notified`，默认勾选）两个选项；无通道时按钮禁用。
- **接口**：`POST /api/admin/watchlist/:id/push { force, mark }`（单条）与 `POST /api/admin/watchlist/push { ids }`（批量合并一封邮件），
  复用 `evaluateAlerts`/`renderDigest`/`notify`；**5 分钟**频控；审计 `admin.alert_pushed`。
- **验收**：见规格 §4——达标/未达标/强制/mark 去重/频控 429/无通道禁用/审计落库/`npm test`+`frontend:build`+`scan` 全绿。
- **已确认（2026-11-18）**：① **只有管理员能推**，用户级提醒**不可推**（只站点级）；② mark **默认勾选**；
  ③ **支持一键推送/批量**，批量**只发一封邮件**（正文列出所有勾选游戏）；④ 频控 **5 分钟**。


## DP. ~~质检通过：e2e 浏览器从 Edge 换成 Chrome（headless Chrome + Edge 回退）~~ → **已发布 v2.27.0（2026-11-19，实现 24780ef）**

**状态：已发布 v2.27.0（2026-11-19，实现 24780ef；QA docs/QA-DP.md 第 1 轮 ✅ 4/0/0/0）**
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


## DQ. ~~质检通过：个人资料页打磨——头像与 Steam 账号解耦 + 布局调整~~ → **已发布 v2.27.0（2026-11-19，站点 e62fb4e/a1af397 + App 795c791）**

**状态：已发布 v2.27.0（2026-11-19，站点 e62fb4e/a1af397 + App 795c791；QA docs/QA-DQ.md 第 1 轮 ✅ 9/0/0/3）**
**依赖：** 无（CX 已发布 v2.25.0）
**解锁：** 无
**规格**：[PROFILE-UI-2026-11-19.md](PROFILE-UI-2026-11-19.md)（决策 5 项 + 数据/前端/验收齐全）；demo [design/profile-layout-2026-11-19.html](design/profile-layout-2026-11-19.html) + 同名 .png
**涉及 App 仓库**：是（app-v2.22.0 随本批；App 仓库提交 795c791）

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


## DN. ~~质检通过：对齐审核内容词 SKU 默认归档（无效数据处理，不进待审队列）~~ → **已发布 v2.27.0（2026-11-19，实现 0c5fde4）**

**状态：已发布 v2.27.0（2026-11-19，实现 0c5fde4；QA docs/QA-DN.md 第 1 轮 ✅ 通过 10/缺失 0/偏差 0/需人工确认 1）**
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


## DR. ~~质检通过：App 发版后即刻可更新（后台立即同步 + App 检查节流 1h + 同步间隔 15 分钟可配）~~ → **已发布 v2.27.0（2026-11-19，站点 39aaebb + App 仓库 98dabca）**

**状态：已发布 v2.27.0（2026-11-19，站点 39aaebb + App 仓库 98dabca；QA docs/QA-DR.md 第 1 轮 ✅ 8/0/0/2）**
**优先级：** P1 —— App 发版后手机要立刻能检测到更新
**依赖：** CJ（app-release-sync / latest.json 契约）、DK（失败原因与 apkPath 兜底）——均已发布
**解锁：** 无
**规格**：[APP-INSTANT-UPDATE.md](APP-INSTANT-UPDATE.md)
**涉及 App 仓库**：是（app-v2.22.0 随本批）

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


## DS. ~~质检通过：搜索全自动派生（gta6/拼音/拼错都能搜，零人工）~~ → **已发布 v2.27.0（2026-11-19，实现 d607e27）**

**状态：已发布 v2.27.0（2026-11-19，实现 d607e27；QA docs/QA-DS.md 第 1 轮 ✅ 通过 5/缺失 0/偏差 0/需人工确认 3）**
**依赖：** 无（复用 AD 批 gameKeywordSql 三源 + AU 批 pg_trgm 索引）
**解锁：** 无
**规格**：[SEARCH-ALIASES.md](SEARCH-ALIASES.md)

- **痛点（2026-11-19）**：搜 gta6 / xdlc6 / portal ii 等民间简写找不到游戏——搜索只有 name/name_en/平台别名
  三源 LIKE，没有缩写/罗马数字/拼音派生；谐音梗（给她爱6）按规格 §7 覆盖边界如实告知不覆盖。
- **方案（零人工，规格 §0 决策 4 项）**：① `games.search_tokens text[]`（纯派生数据）+ GIN 索引，全部算法生成、
  可随时全量重建，不做 manual_aliases、不做后台别名入口；② `src/search-derive.js` 纯函数（归一化/去重音/
  字母数字汉字 token 拆/缩写跳虚词/罗马数字 I–XII↔阿拉伯 1–12 双向/拼音全拼+首字母+数字组合，上限 40 条，
  存储与查询用同一函数）；③ 写入路径（upsertGameMeta/ensureGame）顺带生成 + 定时任务 search-tokens-rebuild
  （每 6 小时增量 ≤5 万行）+ CLI `search-tokens --full`；④ gameKeywordSql 加 token 源（数组重叠 + 子串兼容），
  gameSearch 候选加 token 臂、分级排序（原名/中文名 0 > token/平台别名 1 > 模糊 2）、零命中 pg_trgm 模糊兜底
  （name 臂 0.4 可调 / token 臂 0.6）、`search.miss` 零命中日志（只记日志不建人工映射）。
- **验收**：规格 §6 的 8 条——含 gta6/GTA VI/gta 6 命中 GTA VI 且原名命中排最前、xdlc6/全拼命中侠盗猎车手6、
  gtaa6 模糊兜底（生产 trgm 验证）、派生任务增量/全量、零人工 grep 断言、反向自检清空 tokens 必红、
  P95 ≤300ms（生产复测）。


## DL. ~~质检通过：对齐审核快照落库（后台生成 + 签名动态失效）~~ → **已发布 v2.27.0（2026-11-19，实现 1e49eeb）**

**状态：已发布 v2.27.0（2026-11-19，实现 1e49eeb；QA docs/QA-DL.md 第 1 轮 ✅ 9/0/0/0）**
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


## DW. ~~质检通过（🐞 缺陷）：搜索关键词参数错位——精确名匹配实际在匹配 region~~ → **已发布 v2.27.1（2026-11-19）**

**类型：** 🐞 缺陷（Bug，P0）
**状态：已发布 v2.27.1（2026-11-19，修复 fc410af + 锁行为测试 77f8214；QA 报告 docs/QA-DW.md 第 1 轮 ✅ 6/0/0/1）**
**优先级：** P0 —— 搜索功能正确性（中文精确名搜不到）
**依赖：** 无
**解锁：** 无
**规格**：[SEARCH-FIX-PERF.md](SEARCH-FIX-PERF.md) §DW

- **根因**：`src/store/pg.js` `gameSearch` 里关键词归一化有两套参数位——候选探测/fuzzy 是独立查询
  （绑定 `[kw, cap]`，`$1`=kw），主查询绑定 `filterParams=[region, kw]`（`$2`=kw）；同名 `kwNorm`（`$1` 版）
  与 `kwNorm2`（`$2` 版）并存易误用。线上「侠盗猎车手」0 条的实测绑定 `$1='cn'、$2='侠盗猎车手'` 表明
  精确名匹配一度绑到 region 位（本仓库 HEAD 经 pglite 实测各查询绑定正确，疑为线上部署版本差异；
  修复以「参数位显式化 + 测试锁行为」为准，线上复验留部署后验收）。
- **线上表现**：搜「侠盗猎车手」「侠盗猎车手 V」→ 0 条（GTA V 的 name 明明存在）；「侠盗」98 条、
  「Grand Theft Auto」142 条全靠 token/trgm 兜底；DS 测试 9/9 绿因为用例没覆盖「仅 name 精确匹配」。
- **修复**：`gameSearch` 关键词归一化拆两个显式变量——`kwNormCandidate`（`$1` 版，仅供候选探测 SQL 与
  `fuzzyCandidateIds`，绑定 `[kw, …]`）与 `kwNorm`（`$2` 版，主查询 count/rows/排序，绑定 `[region, kw, …]`），
  注释写明两者不可互换（互换 = 精确名 LIKE 匹配 cap/42P18，新测试必红）；`filterParams` 顺序不变、
  候选查询绑定不变、其它搜索逻辑不动。
- **补测试（反向自检）**：新增 `test/game-search-exact.test.js`（进主链 test:3）——无 `search_tokens` 的游戏
  搜中文名「侠盗猎车手」/英文名「Grand Theft Auto V」必须命中；注入错位（表达式与绑定参数位不一致）
  实测必红后才修复转绿；回归 `gta5/gta6/xdlc6/grand theft auto` 仍命中；`zzz不存在词`、`cn` → 0；
  搜索不因 region 值命中。
- **验收**：见规格 §DW（本地用例全绿；线上「侠盗猎车手」返回 GTA 系列；`npm test`（分段）+ `frontend:build` + `scan` 全绿）。

## CO-5. ~~开发中（🧹 技术债）：B4-2 巨石拆分第三轮（认证域）~~ → **已发布 v2.27.2（2026-11-19）**

**类型：** 🧹 技术债（重构，外部契约零变化）
**状态：已发布 v2.27.2（2026-11-19，拆分 00a838f + 架构记录 8867077 + 质检回写 d779b69；QA 报告 docs/QA-CO5-B4-2.md 第 1 轮 ✅ 16/0/0/1）**
**优先级：** P2 —— 巨石渐进瘦身（CO-4/B4 已随 v2.27.1 发布 app/appeal 两域；本条目为第三轮认证域）
**依赖：** 无（**避开** `/api/games*`（DX 待开发改游戏查询区）、`/api/me*`（DT-2 待开发会加接口）；与 DW 零重叠）
**解锁：** 无
**规格**：[ARCHITECTURE.md](ARCHITECTURE.md) §15（域路由拆分模式）+ [DESIGN-AUDIT.md](DESIGN-AUDIT.md) B4

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

## DY. ~~待开发（🐞 缺陷）：安卓页面衔接状态丢失~~ → **已发布 app-v2.23.0（2026-11-20）**

**类型：** 🐞 缺陷（App 端导航状态）
**状态：已发布 app-v2.23.0（2026-11-20，App 3f14b04；QA docs/QA-DY-DZ.md 第 2 轮 ✅）**
**涉及 App 仓库**：是（app-v2.23.0 随本批）
**规格**：[ANDROID-POLISH.md](ANDROID-POLISH.md) §DY（站点零改动）

- **方案**：搜索状态提升 ViewModel（SearchScreenState）；Home/Wishlist/Profile 数据与筛选提升 AppViewModel
  （账号切换 reset 防串号）；Detail 转返回栈级 viewModel(key=detail-appid)；列表滚动 LazyListState.Saver、
  表单滚动 ScrollState.Saver；非敏感输入 rememberSaveable（密码/验证码按安全惯例不落）；ARCHITECTURE §16
  「Android 导航状态保存规范」。
- **交付**：模拟器实测——搜索→详情→返回（词/结果/滚动保留）、首页滚动保留、注册表单旋转/进程重建保留；
  JVM 单测 + 构建全绿（78 项）。

## DZ. ~~待开发（⚙️ 调整）：公告未读角标无法清除~~ → **已发布 app-v2.23.0（2026-11-20）**

**类型：** ⚙️ 调整（App 端公告体验）
**状态：已发布 app-v2.23.0（2026-11-20，App 7c5cb58；QA docs/QA-DY-DZ.md 第 2 轮 ✅）**
**涉及 App 仓库**：是（app-v2.23.0 随本批）
**规格**：[ANDROID-POLISH.md](ANDROID-POLISH.md) §DZ

- **方案**：弹层「全部已读」（登录 markAnnouncementsRead / 游客本地 DataStore）→ 角标立即消失；
  markInFlight 闩防「全部已读后立即刷新」回跳；单条已读保留；游客↔登录合并沿用 DC 批 mergeLocalReadsToServer。
- **交付**：模拟器实测——角标 1 → 全部已读 → 立即消失 → 重启不回来；游客本地已读落盘取证；
  AnnouncementsModelTest +2 项。

## EA. ~~待开发（⚙️ 调整）：安卓体验包（攒批）~~ → **已发布 app-v2.23.0（2026-11-20）**

**类型：** ⚙️ 调整（App 端体验优化）
**状态：已发布 app-v2.23.0（2026-11-20，App fb56db5/4e837e0/0258d2d/5f071e5/c5317af/0db5266+749e580；QA docs/QA-EA-1-3.md、QA-EA-4-6.md 第 1 轮 ✅）**
**涉及 App 仓库**：是（app-v2.23.0 随本批）
**规格**：[ANDROID-POLISH.md](ANDROID-POLISH.md) §EA

- **子项**：EA-1 下拉刷新（首页/搜索/愿望单/详情 PullToRefreshBox）；EA-2 搜索空态引导（没找到「xx」+ 重试/清空搜索）；
  EA-3 详情分享（系统 ACTION_SEND：名称 + 站点 ?q= 直达链接）；EA-4 我的页版本号（BuildConfig.VERSION_NAME）+
  清除图片缓存（仅 Coil 缓存，不动登录态）；EA-5 详情骨架屏（呼吸 alpha，镜像首屏结构）；EA-6 全局弱网提示条
  （ApiClient 网络层回调 + 底栏上方横幅可重试，修复 bottomBar 单 Slot 重叠 749e580）。
- **交付**：模拟器逐项实测（下拉刷新/空态/分享面板/版本行/断网横幅+恢复重试）；78 项单测全绿。

## EB. ~~待开发（✨ 功能）：安卓 18R 内容选项~~ → **已发布 app-v2.23.0（2026-11-20）**

**类型：** ✨ 功能（App 端内容选项）
**状态：已发布 app-v2.23.0（2026-11-20，App 5346afb；QA docs/QA-EB.md 第 1 轮 ✅）**
**涉及 App 仓库**：是（app-v2.23.0 随本批）
**规格**：[ANDROID-POLISH.md](ANDROID-POLISH.md) §EB（含三源核对）

- **口径**：首页/搜索 chips「18R」；开=adult=badge（显示 + 红色「18+」角标，与成熟内容样式区分）/ 关=adult=hide；
  首次开启弹「确认已满 18 岁」（未确认不切换）；默认关闭 + DataStore（adult_enabled/adult_confirmed）记忆；
  站点零改动（服务端 adult 参数已支持）。
- **交付**：模拟器实测（chip/首次弹窗/确认落盘/重启记忆）；HomeFilterParamsTest +2 项（hide/badge 映射）；
  详情接口无 adult 过滤（18R 详情可打开）。线上当前无 18R 数据，「显示 18R 游戏」目视待真实数据出现后补验。

## EF. ~~质检通过（🐞 缺陷）：18R 数据同步与筛选修复（元数据 cc=cn 锁国区 → 成人内容采不到）~~ → **已发布 v2.27.5（2026-11-20，站点 7a3ac2b + App 仓库 358ebc5；app-v2.24.0 随本批）**

**类型：** 🐞 缺陷（数据同步 + 筛选）
**状态：已发布 v2.27.5（2026-11-20，站点 7a3ac2b + App 仓库 358ebc5；QA docs/QA-EF.md 第 1 轮 ✅ 放行 13/0/0/3；**涉及 App 仓库**：是（app-v2.24.0 随本批））
**优先级：** P1 —— 18R 数据缺失 + App 筛选语义错误
**依赖：** 无
**解锁：** 无
**规格**：[STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md) §9

- **根因**：src/adapters/steam-meta.js:209 appdetails 请求带 &cc=cn——国区商店隐藏成人内容 →
  content_descriptors 采不到 → 全库 adult_flag 仅约 20 个（hide 109352 vs badge 109372）。
- **修复**：① 元数据采集 cc=cn → cc=us（保留 l=schinese；价格接口仍 cc=cn 不动）；
  ② 全量回填 content_descriptors（新回填命令/复用 rename，限速防 429）；③ 前台 /api/games 支持
  ating=adult|mature|none；④ Web 前台加 18R 筛选；⑤ App 18R chip 改筛选（adult=badge&rating=adult）。
- **实现**：① etchMetadata cc 参数化（默认 us，价格口径调用点显式 cn）；② 新增 ating-backfill
  命令（cc=us 重采三字段、只写分级不写价、限速 ≥1s、429 收轮 exit 75、前后 adult 计数日志、断点续跑）
  + 并入调度器（STEAM_HEAVY/预算）；③ gameSearch 加 ating（与后台 admin 同口径）；④ Home.vue
  18R 开关（桌面+移动抽屉，选中 adult=badge&rating=adult，取消恢复全部，角标 18+）；⑤ App
  HomeScreen/SearchScreen 开=badge&rating=adult / 关=hide（App 358ebc5）。
- **验收**：见规格 §9（回填后 adult 数显著增加且有计数日志；Web/App 筛选只显示 18R + 角标；价格国区口径不变；
  
pm test（分段）+ rontend:build + scan 全绿）。

## EG. ~~质检通过（🐞 缺陷）：通知角标已读后不消失（ABC 三场景）~~ → **已发布 v2.27.5（2026-11-20，站点 7eb5d4a + App 仓库 3458bce；app-v2.24.0 随本批）**

**类型：** 🐞 缺陷（App 公告角标）
**状态：已发布 v2.27.5（2026-11-20，站点 7eb5d4a + App 仓库 3458bce；QA docs/QA-EG.md 第 1 轮 ✅ 放行 3/0/0/0；**涉及 App 仓库**：是（app-v2.24.0 随本批））
**优先级：** P1 —— 角标常驻误导
**依赖：** 无
**解锁：** 无
**涉及 App 仓库**：是（app-v2.24.0 随本批）
**规格**：[ANDROID-POLISH.md](ANDROID-POLISH.md) §EG

- **现象**：A 打开公告列表 / B 点开公告详情 / C 点「全部已读」——三种操作后首页铃铛角标仍显示 1。
- **排查**：服务端 /api/announcements/read 是否保存；efresh() 覆盖竞态（markInFlight 闩）；
  角标与弹层未读是否同源；游客本地 DataStore 写入；ABC 分别复现定位。
- **修复**：① 站点 GET /api/announcements 公开段补 Bearer 解析（此前只认 Cookie 会话，App 登录用户
  恒拿空 readIds → 刷新即回跳的根因）；② App AnnouncementsState 标记纪元守卫（陈旧快照只并集不覆盖、
  会话切换快照作废，取代 markInFlight 闩）+ 网关缝解耦 + AnnouncementsStateTest 5 项锁竞态。
- **验收**：ABC 三场景角标正确（B 递减 / C 立即归零 / A 按口径）；下拉刷新/重进首页/重启 App 不复现；
  App 构建通过——模拟器（10s 延迟代理放大竞态）+ 单测 83 项 + 站点测试全绿。

## CO-5（第九轮，#9）. ~~开发中（🧹 技术债）：B4-2 巨石拆分第九轮（admin 同步任务域）~~ → **已发布 v2.27.6（2026-11-20）**

**类型：** 🧹 技术债（重构，外部契约零变化）
**状态：已发布 v2.27.6（2026-11-20，拆分 3997083；QA 报告 docs/QA-CO5-B4-2-admin-sync.md 第 1 轮 ✅ 14/0/0/1）**
**优先级：** P2 —— 巨石渐进瘦身（B4 队列 #9；已交付九域：app/appeal/auth/watchlist/announcements/me/site/admin-access/admin-sync）
**依赖：** 无
**解锁：** 无（下一域 #10 admin 系统设置）
**规格**：[ARCHITECTURE.md](ARCHITECTURE.md) §15（域路由拆分模式）+ [B4-QUEUE.md](B4-QUEUE.md) #9

- **范围**：admin 同步任务域 13 条路由全拆——`POST /api/admin/sync`、`GET /api/admin/sync/status`、
  `GET /api/admin/sync/runs`、`POST /api/admin/circuit/reset`、`POST /api/admin/backfill`、
  `POST /api/admin/backfill/stop`、`GET /api/admin/backfill/status`、`POST /api/admin/heat`、
  `POST /api/admin/heat/stop`、`GET /api/admin/heat/status`、`POST /api/admin/rename`、
  `POST /api/admin/rename/stop`、`GET /api/admin/rename/status`；管理段单入口 `handleAdminSyncAdmin`（参照 admin-access）。
- **边界**：`listSyncRuns` 唯一专属 SQL 搬家到 `src/store/admin-sync-repository.js`；`insertSyncRun`/`finishSyncRun`/
  `runningSyncRun`/`markStaleSyncRuns`/`sourceSyncStats` 等跨域共用留 `pg.js`（cli/scheduler/server 都在用）+ re-export 兼容壳；
  `syncState` 持有对象与 `startSteamJob` 闭包按引用传入（语义共享，勿改成拷贝）；`syncStatusCache`/`invalidateSyncStatusCache`
  按引用共享；sync_runs 表 DDL 留 pg.js（migrate() 未动）。
- **交付**：`src/server.js` 净 −205（+59/−264）、`src/store/pg.js` 净 −8（+13/−21）；新增 `src/routes/admin-sync.js` 356 行 +
  `src/store/admin-sync-repository.js` 38 行；`test/sync-runs.test.js` +123 行四组静态锁（分支在新文件 / 宿主真实接线 /
  旧分支不残留 / re-export 边界判据）+ 反向自检（删 heat/stop 分支实测必红）；`test/source-sync.test.js` 静态断言指向新文件；
  **外部契约零变化**（路径/参数/响应/错误码不变）。
- **验收**：QA 14/0/0/1 放行；`npm run test:1..4` + `node test/api.test.js` + `frontend:build` + `scan` 全绿
  （人工确认 1 项为本机沙箱 `frontend:build` 默认命令被拦，改用 native loader 变体，CI 兜底）。

## DU. ~~🐞 缺陷：个人资料「个人简介」placeholder 插值未绑定（显示 {{ }} 源码）~~ → **已发布 v2.28.0（2026-11-20）**

**类型：** 🐞 缺陷（Bug）
**状态：已发布 v2.28.0（2026-11-20，实现 791d729；QA docs/QA-DU.md 第 1 轮 ✅ 3/0/0/0）**
**优先级：** P3
**规格**：TODO 正文（1 行修复）

- **现象**：个人资料页「个人简介」文本框显示 `介绍一下自己（{{ isAdmin ? '可选' : '1–200 字' }}）` 源码。
- **修复**：`frontend/src/pages/ProfilePage.vue` 静态 `placeholder` 改 `:placeholder` 动态绑定；全项目静态插值扫描并入 profile.test.js 防复发。
- **验收**：admin「介绍一下自己（可选）」/普通用户「介绍一下自己（1–200 字）」；测试全绿。

## DV. ~~⚙️ 调整：游戏管理「ITAD」筛选改为来源筛选~~ → **已发布 v2.28.0（2026-11-20）**

**类型：** ⚙️ 调整（筛选语义修正）
**状态：已发布 v2.28.0（2026-11-20，实现 0a6b978；QA docs/QA-DV.md 第 1 轮 ✅ 5/0/0/0）**
**优先级：** P2
**规格**：[ITAD-SOURCE-FILTER.md](ITAD-SOURCE-FILTER.md)

- **修复（方案 A）**：`platform=itad` 改走来源判定（`game_source_sync` matched 标记，参数数组不带 platform），其余平台仍按 `offers.platform_code`；前端平台下拉分「平台/来源」两组（「ITAD（来源）」）；不动采集链路。
- **验收**：ITAD（来源）筛出有匹配标记的游戏；其它平台不变；测试全绿。

## DT. ~~后台用户管理与权限隔离（DT-1~DT-5）~~ → **已发布 v2.28.0（2026-11-20）**

**类型：** ⚙️ 调整（DT-2 含 ✨ 功能）
**状态：已发布 v2.28.0（2026-11-20，实现 7f5edba/403e6f2/4a40737/4c49f7c/c19f514；QA docs/QA-DT-1~5.md 第 1 轮 ✅ 全放行）**
**规格**：[ADMIN-PERMISSIONS.md](ADMIN-PERMISSIONS.md)
**Demo**：[design/admin-users-2026-11-19.html](design/admin-users-2026-11-19.html) + [design/admin-menu-permissions-2026-11-19.html](design/admin-menu-permissions-2026-11-19.html)

- **DT-1（7f5edba）**：admin 全量菜单 / 普通用户仅 5 页；删「Steam 账号」菜单；无权限 section 守卫跳 profile + 提示。QA 6/0/0/1 ✅
- **DT-2（403e6f2）**：`GET /api/me/sessions` + `POST /api/me/sessions/:id/revoke` + `GET /api/me/wishlist`；5 页切用户级接口；强制 session.user.id、越权 403/404 并审计。QA 10/0/0/1 ✅
- **DT-3（4a40737）**：删新建用户（接口下线 410）；行内编辑角色/重置密码/禁用/踢会话/删除 + 审计；批量只留踢会话；绑定 Steam 账号只读；禁用即时踢会话；e2e 建号链迁自助注册。QA 5/0/0/1 ✅（争议项：UserCreateDrawer.vue 文件保留待所有者裁定是否移除）
- **DT-4（4c49f7c）**：验证码冷却按场景分桶 + retryAfterSec；倒计时 60s 三态；重置密码弹窗打开不发码/失败不关/过期可重发。QA 8/0/0/1 ✅
- **DT-5（c19f514）**：前台未登录「登录」按钮、登录后无退出/改密；Console 全局顶栏用户菜单树（含退出，心跳基线正确）。QA 6/0/0/1 ✅

## EC. ~~⚙️ 调整：图片覆盖治理（覆盖看板 / 缺图回填 / 占位图）~~ → **已发布 v2.28.0（2026-11-20）**

**类型：** ⚙️ 调整（运维可视化 + 数据补齐）
**状态：已发布 v2.28.0（2026-11-20，实现 ab7ba90；QA docs/QA-EC.md 第 1 轮 ✅ 4/0/0/1）**
**优先级：** P2
**规格**：[IMAGE-COVERAGE.md](IMAGE-COVERAGE.md) §8

- **EC-1**：后台图片覆盖看板（总数/header_image/本地缓存/缺图数 + 缺图列表分页标原因 + 重置负缓存，`GET /api/admin/images/coverage`）。
- **EC-2**：缺图回填（`src/image-backfill.js` + CLI `images backfill` + 调度任务 images-backfill，限速 ≥1.2s/请求防 429，日志 `images.backfill_*`，手动 `POST /api/admin/images/backfill` single-flight）。
- **EC-3**：前端品牌占位 CoverPlaceholder（S 标/首字，列表与详情统一）。
- **验收**：看板数据一致、回填后缺图数下降、占位图显示；测试全绿。

## EM. ~~🐞 缺陷：Steam 同步超时（愿望单/库同步被 15s 看门狗砍掉）~~ → **已发布 v2.28.0（2026-11-20）**

**类型：** 🐞 缺陷（同步功能超时不可用）
**状态：已发布 v2.28.0（2026-11-20，实现 ba9b0b0；QA docs/QA-EM.md 第 1 轮 ✅ 5/0/0/1）**
**优先级：** P1
**规格**：[STEAM-SYNC-TIMEOUT.md](STEAM-SYNC-TIMEOUT.md)

- **EL-1**：同步类请求单次超时 30s→8s（快速失败交给代理池切换）。
- **EL-2**：愿望单/库同步改后台任务 + 立即 202（single-flight 409）+ `GET /api/steam/accounts/:id/sync-status`。
- **EL-3**：后台按钮「同步中…」+ 2s 轮询（≤60s）+ 结果/失败原因 + 重试。
- **验收**：触发即返回后台同步中、轮询后列表更新、失败原因可见；测试全绿。

## DM. ~~对齐审核批量操作超时短期补丁~~ → **已过时（并入 DL）**

**类型：** 🐞 缺陷（已过时）
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
- **过时原因**：DL（对齐审核快照落库，[ALIGN-SNAPSHOT.md](ALIGN-SNAPSHOT.md)）已发布 v2.27.0，短期补丁方案不再派发。

## ET. ~~设置页布局系统修复（卡片容器包裹，方案 A）~~ → 已发布 v2.28.2

**类型：** ⚙️ 调整（后台布局重构）
**状态：已发布 v2.28.2（2026-11-23；实现 64d9f48；QA docs/QA-ET.md 第 1 轮 ✅ 5/0/0/1）**
**优先级：** P1 —— 系统设置页布局错乱
**依赖：** EL（设置弹窗）已完成，不冲突
**解锁：** 无
**规格**：[SETTINGS-LAYOUT-FIX.md](SETTINGS-LAYOUT-FIX.md)（demo：docs/design/settings-layout-demo.html/.png）

- **根因**：AdminModules 设置页把 cardHead/cardBody/字段/折叠当独立网格项 → 卡片零件错位（截图）。
- **范围**：sources / site / advanced 三个 tab（非 plain 分支）；plain 组（auth/security/alerts/network）
  与邮件/初始化页正常不动。
- **方案 A**：displaySettingsFields 按 section 分组 + 每 section 一个 .settings-card 容器（两列网格、
  卡片内字段对齐、折叠全宽）；字段功能不变。
- **验收**：三个 tab 与 demo 一致、移动端单列、功能不变、
pm test（分段）+ rontend:build + scan 全绿、截图对照。
