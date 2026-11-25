## [2.30.1] - 2026-11-25

FU 腾讯云 APM 接入改用 OTLP **gRPC**（修正 v2.30.0 的 HTTP 上报在 4319 上不成立）+ 默认接入点域名笔误纠正（⚙️ 修复/调整，无新功能 → 小版本，2.30.0 → 2.30.1 连续递增、不跳号）。站点单仓库，App 无改动。

### 修复

- **FU APM 接入改 gRPC（6e23406）**：腾讯云 APM 的 4319 只接受 HTTP/2（h2c），v2.30.0 的 `@opentelemetry/exporter-trace-otlp-http` 往 `POST /v1/traces` 上报会被拒；换 `@opentelemetry/exporter-trace-otlp-grpc`（自动带 `@grpc/grpc-js`），`url` 只给 `host:port`（`http://` 前缀 → h2c 明文，`timeoutMillis` 1.5s 限时不拖慢短命 CLI）。
- **token 改 Resource 属性上报**：Resource 增加 `APM_TOKEN` + 官方 `token`（同值，避免只认小写 key 的服务端丢数据）、`SERVICE_NAME`、`APP_ID`/`SERVER_ID`（可选，`OTEL_SERVICE_NAME` 兜底）、`host.name`；删除 `x-tps-token` header（gRPC 走 metadata，header 那套不生效）。无 token 静默跳过、`APM_SAMPLE_RATE` 采样、`HttpInstrumentation` 行为不变。
- **默认接入点域名纠正（b594eaf）**：内网接入点是 `pl.<region>.apm.tencentcs.com`（点分隔）——`plap-shanghai…`（v2.30.0 文档笔误）与 `pl-ap-shanghai…` 均 NXDOMAIN，实测只有 `pl.ap-shanghai.apm.tencentcs.com` 解析到 169.254.0.177；默认值改对，并把历史笔误 `plap-shanghai…` 在 `normalizeEndpoint` 里自动纠正（照抄旧文档的 `APM_ENDPOINT` 也不会静默连不上）。

### 测试

- `test/otel.test.js` 重写为 4 用例（主链 test:4）：配置组装/端点归一化（含历史笔误纠正）/资源属性、无 token `--import` 跳过、**假 OTLP gRPC 服务端到端**（报文 body 含 token 与资源属性键、gRPC metadata 无 `x-tps-token`）、端点不可达不中断且 <5s 退出。
- 本机验证（构建会话）：`node test/otel.test.js` 4/4、`test/deploy.test.js` 24/24、`test/docs.test.js` 5/5、`test/isolation.test.js` 7/7、主链 `test:4` exit 0、`scan` 干净；反向自检（v2.30.0 旧 HTTP 实现跑同一端到端断言）必红，证明测试真锁住 gRPC + Resource 属性；全量主链由 CI 兜底。
- QA：FU 第 2 轮 ✅ 放行（通过 9 / 缺失 0 / 偏差 0 / 需人工确认 1——腾讯云控制台需部署后确认）；轮内自检发现并修复域名缺陷（b594eaf）。

### 部署提示

- 服务器 compose env：`APM_TOKEN`（必填）、`OTEL_SERVICE_NAME`（app 用 `steamdeals-app` / scheduler 用 `steamdeals-scheduler`）、可选 `APM_ENDPOINT`（默认即 `http://pl.ap-shanghai.apm.tencentcs.com:4319`，**注意是 `pl.` 不是 `plap-`**）、`APM_SAMPLE_RATE`（默认 0.1）、可选 `APM_APP_ID`/`APM_SERVER_ID`；4319 是 h2c 明文，**无需** NODE_TLS 开关。
- 本版无 schema 变更、无接口变更、无前端改动，升级只需重建 app/scheduler 容器。

## [2.30.0] - 2026-11-25

FK App 资产同步 COS 换源 + FM 史低误报修复 + FL 设置页全分组折叠 + FP 同步机制完善 + FQ 按钮点击反馈 + FR backup 后台功能化 + FT 成人内容分级细分（色情游戏）+ FU 腾讯云 APM 接入 + FV 站点 head/foot 注入（✨ 新功能面 4：FT 分级细分 / FP 同步机制 / FU APM / FV 注入 → 大版本，2.29.1 → 2.30.0 连续递增、不跳号）。站点 + App 双仓库（App 提交 b924926 + 2916dc3，随本批发 app-v2.25.1/22501）。

### 新增

- **FT 成人内容分级细分（站点 cd2829e；App 2916dc3）**：新增 `games.explicit_flag`（严格 = descriptor 4 或 ESRB AO；`adult_flag` 宽口径不变）；前台/App 筛选入口「18R」改「色情游戏」（`rating=explicit`）、18+ 角标仅 explicit、hide 仍排除全部成人内容（宽）；后台「内容分级统计」拆「成人内容（宽）/色情游戏（严格）」两行 + 「内容分级」筛选加「色情游戏（严格）」；新增 `explicit-backfill` 存量回填（候选 ≈4759、限速 1.5s/款、1 天冷却、429 收轮；调度 steam-meta 组子步骤 + 后台任务卡「立即运行」）。**部署后**：`node src/cli.js explicit-backfill --limit 5000 --rate 1500`（约 2 小时）或后台「色情游戏回填」立即运行。
- **FU 腾讯云 APM 接入（07db9a9）**：OpenTelemetry OTLP HTTP 上报 `plap-shanghai.apm.tencentcs.com:4319`（`--import ./src/otel.js` 统一注入 bootstrap/serve/scheduler）；`APM_SAMPLE_RATE` 默认 0.1；无 `APM_TOKEN` 自动跳过（本地/CI 零影响）；token 只放服务器 compose env（仓库零凭据）。
- **FV 站点 head/foot 注入（66a7046 + 修复 b445771）**：后台「站点与内容」可配 Head（</head> 前）/Foot（</body> 前）注入（20KB 上限、仅管理员、保存热加载、免改代码发版）；注入内联/外链 `<script>` 自动打 per-request CSP nonce（严格档可执行）；响应 no-cache；无配置字节级不变；/api、/assets、/app/*.apk 不注入。

### 调整

- **FK App 资产同步换源（5ad406b）**：`network.appSyncSource`（github/cos，默认 github）+ `network.appSyncCosBase` + `network.appSyncFallbackGithub`（默认开）三项设置；`syncAppRelease` 支持 COS 拉 latest.json/APK/sha256（60s 超时、文件名严格校验防路径注入），cos 失败自动回退 GitHub 并记 `app.release_fallback`。
- **FL 系统设置页所有分组统一折叠（0f22937 + 打回修复 4052489）**：无高级字段的分组（时区与显示/站点与内容/全局/发现与热度/同步区域）也生成折叠按钮与折叠体；搜索命中无高级字段的折叠组自动展开（`foldAutoOpenAll`）；折叠行标题回退分组标题（`foldTitle||title`）；默认收起 + localStorage 记忆与其它组一致。
- **FP 同步机制完善（0cdddb1）**：P0 僵尸锁（running 超 2h 自动 interrupted、启动/排空清理 DB running 记录）；backup 流式分页 + 30 分钟超时；backup/prune 低峰窗口（默认 03:00–05:00）+ 独立维护槽（不与价格/状态抢 heavy 槽）；steam-status/backfill/rating-backfill 提速默认 2 万/天（env 可配）；429 补跑队列 + 后台「初始化全量同步」按钮；后台「数据时效」卡片；403 告警口径收敛（连续 ≥3 次才告警、discovery 类只记日志）。
- **FQ 按钮点击反馈规范（1f70ea5）**：`useAction` composable（loading 防连点 + ≥200ms 不闪烁 + 成功/失败 ElMessage）；后台全部刷新/操作按钮接入（「已刷新/已保存/已启动」提示、失败可读文案）。
- **FR backup 改为后台功能（1f70ea5）**：移除调度任务与 CLI 自动跑；后台「备份」卡手动备份/列表/下载/删除（严格文件名白名单 `backup-YYYY-MM-DD.json.gz` 防路径穿越）；`system.backupEnabled` 默认 false（按钮禁用 + 接口 403 双保险）；复用 FP 流式 createBackup。

### 修复

- **FM 价格提醒史低误报（b497566）**：hist_low 改「今天以前」；跌破标「新史低」、持平标「跌至史低」、未跌破不提醒；同价不重复显示史低段；未降价不显示史低；有目标价行为不变。

### App

- **FO 搜索框回车即搜（App b924926）**：IME 动作设「搜索」，软键盘回车即提交（与按钮同一逻辑：trim 非空 → 隐藏键盘 → submitKeyword；空词无动作；历史页/结果页一致）。
- **FT App 端（App 2916dc3）**：18R chip 改「色情游戏」、rating=explicit、18+ 角标仅 explicit（联动站点 cd2829e）。

### 测试

- QA 全部放行、无打回：FK 9/0/0/3、FM 5/0/0/2、FL 第 2 轮 ✅（打回 3 项全落实）、FP 22/0/0/3、FQ/FR 9/0/0/1、FT 10/0/0/2、FU 4/0/0/1、FV 5/0/0/1、FO 4/0/0/0。
- 本机验证（构建会话）：本批相关测试（settings 17/17、app-release-sync、alerts、sync-harden、explicit-rating、otel、head-foot-injection 等）+ `api.test.js` + `frontend:build` ✓ + `scan` 干净；全量主链由 CI 兜底。

## [2.29.1] - 2026-11-24

FI 内容分级——后台可筛 + 前台/App 按 `site.adultDisplay` 三态控制 + FJ 同步服务合并为 12 个任务组（⚙️ 调整 2，无新功能面 → 小版本，2.29.0 → 2.29.1 连续递增）。站点 + App 双仓库（App 提交 `4266359`，随本批发 app-v2.25.0/22500）。

### 调整

- **FI 内容分级：后台恢复筛选 + 前台/App 按参数控制（31126db；App 4266359）**：后台游戏管理恢复「内容分级」筛选下拉（全部 / 成人（18+）/ 成熟 / 未分级 → `rating=adult|mature|none`，`loadGames` 带 `rating`，**不读 site.adultDisplay**，管理端始终可筛）；前台 `Home.vue` 18R 入口按 `/api/site` 的 `adultDisplay` 三态显隐——hide（默认）无入口且 `adult=hide`（大陆合规），badge/show 显示入口、选中 `adult=badge|show&rating=adult`，18+ 角标仅 badge 渲染（show 普通展示无角标），策略变化重置开关并重载；`src/store/games-repository.js` compact 列表补 `steam_status/adult_flag/mature_flag` 三字段（18+/成熟/状态角标渲染前提，既有缺陷，读模型与 legacy 双路径）；`test/adult-display-control.test.js` 8 条替换 `remove-18r-entry.test.js` 旧测试并注册 test:3。App 仓库同步（18R chip 按 `adultDisplay!=='hide'` 显隐、`adult` 恒传站点策略、年龄确认弹窗恢复、`GameCard` 角标仅 badge、`HomeFilterParamsTest` 六组映射）。FH 统计卡片保留。
- **FJ 同步服务合并为任务组 25→12（0ec74d2；复检修复 3029238）**：`src/scheduler.js` 新增 `JOB_GROUPS` 12 组定义（Steam 价格 / Steam 元数据 / 多平台报价 / 目录与发现 / 图片同步 / 索引维护 / 系统维护 / Steam 账号 / 热度 / App 版本 / 对齐快照 / 代理与提醒）+ `jobsFromEnv` 按组序重排带 `group` 字段 + `planTick` 组内到期子步骤按声明顺序串行（`groupBusy`，heavy slot 互斥，不传 jobs 退化为旧行为）+ `writeStatusFile` 输出 groups；子步骤保留原 mode 写 `sync_runs`（历史/告警口径不变）；`steam-claim` 移出定时改手动按钮（`POST /api/admin/steam-claim`，未配置 400）；后台「同步与回填」12 组行 + 展开子步骤 + 组级/子步骤级立即运行（`POST /api/admin/sync/groups/:name/run` 组内链式串行、HTTP 立即 202）；status 响应补 `groups` 字段（旧字段保留兼容）；`test/scheduler.test.js` FJ 7 项（组定义与优先级 / 组内串行 / 跨组并行 / 无 jobs 退化 / 状态文件 groups / 空组保留）。

### 测试

- QA：`docs/QA-FI.md` 第 1 轮 ✅ 放行（通过 9 / 缺失 0 / 偏差 0 / 需人工确认 2）+ `docs/QA-FJ.md` 第 1 轮 ✅ 放行（通过 14 / 缺失 0 / 偏差 1 已修 / 需人工确认 2）。
- 相关测试：`adult-display-control` 8/8、`scheduler` 7/7（FJ）、`api` 38/38、`game-search-filter` 10/10、`game-search-read-model` 16/16、`baseline-gate` 5/5；`npm run frontend:build` ✓；`npm run scan` 干净；headless Chrome 三态 DOM 断言 18/18（QA 轮）+ 后台成人筛选条数与 rating 一致；App `gradlew testDebugUnitTest` + `assembleDebug` 成功。
- 人工目视项（部署后）：后台「内容分级」筛选与 12 组任务行/展开子步骤、前台/App 三态 18R 入口与角标（默认 hide 无入口）。

## [2.29.0] - 2026-11-24

EO 首页工具栏窄屏断点修复 + EP 后台其余列表手机端卡片化 + EY 我的愿望单合并 Steam 愿望单（✨ 新增 1 / ⚙️ 调整 1 / 🐞 修复 1 —— EY 带来「本站 + Steam 合并展示」新功能面，所有者 2026-11-24 11:25 确认按新功能定档 → 大版本，2.28.10 → 2.29.0 连续递增、不跳号）。本批只含站点（Web 前后端），不涉及 App 仓库。

### 新增

- **EY 我的愿望单合并 Steam 愿望单（0f7aa26）**：`/api/me/wishlist` 合并 `user_wishlist`（本站）与 `steam_wishlist`（该用户绑定账号导入）——`src/steam-accounts.js` 新增 `listMergedWishlists`（UNION 后按 `game_id` 聚合，返回 `sources`/`site_wishlist_id`/`steam_accounts`，搜索/分页/越权均覆盖两层；后台 `/api/admin/wishlists` 原查询零变化）；`frontend/src/pages/UserSections.vue` 加「来源」列（本站 / Steam / 本站 + Steam），**Steam-only 行标「只读」且无任何操作按钮**，合并行「移除」只删本站（确认框写明 Steam 侧不受影响），列表 key 改 `game_id`；站点对 Steam 愿望单保持只读（不写回）。

### 调整

- **EP 后台其余列表手机端卡片化（fddc422）**：`AdminModules.vue` 任务健康 / 价格变化 / 浏览排行 / 图片覆盖缺图 4 张表补 `<template v-if="!isMobile">` 表格 + `.game-card-list` 卡片（操作「立即运行/重置熔断」与分页保留）；`AdminExtras.vue`「未归属 Steam 账号」手机端不再整块消失、卡片内可认领；`AlignAdmin.vue` 对齐审核队列/已忽略两视图卡片化（勾选/批量确认/换候选/忽略/明细展开/记录/恢复全部可用）；`AdminLogs`/`UserSections`/`AppealsAdmin` 卡片按钮触摸目标统一 ≥44px；**断点统一 760**（删除另挂的 720px 监听，解决 720–760px 旋转后跳回表格）；桌面端表格列/排序/分页/批量逻辑不变。

### 修复

- **EO 首页工具栏 1100–1300px 挤成一行（31138c1；代码随 v2.28.10 镜像成像，发布记录归本版）**：`frontend/src/styles/main.css` 2 列断点 `@media(max-width:1200px)` → `1360px`（搜索框整行 + 下拉 2 列 `flex:1 1 calc(50% - 5px);min-width:118px`），补 900/600 两档；根因是末尾无媒体查询的全局 `.toolbar .el-select{flex:0 0 132px}` 覆盖窄屏，改包进 `@media(min-width:1361px)`；420px 一列规则保持最后（层叠顺序锁）。headless Chrome 实测 1100/1200/1300/900 四档无横向溢出、6 个下拉三行两列、placeholder 完整，1440 保持单行 6×132px；新增 `test/frontend-toolbar.test.js`（6 条含反向自检，进主链 test:3）。

### 测试

- QA：`docs/QA-EO.md` ✅ 放行（通过 6 / 缺失 0 / 偏差 0 / 需人工确认 2）+ `docs/QA-EP.md` ✅ 放行（通过 10 / 缺失 0 / 偏差 0 / 需人工确认 1）+ `docs/QA-EY.md` ✅ 放行（通过 5 / 缺失 0 / 偏差 0 / 需人工确认 2）。
- 相关测试：`frontend-toolbar` 6/6、`admin-console-mobile` 10/10、`wishlist-site-only` 14/14、`watchlist-user` 13/13、`wishlist` 6/6、`frontend-mobile` 13/13、`align` 15/15、`admin-console-ia` 23/23、`api` 38/38；`npm run frontend:build` ✓；`npm run scan` 干净。
- 人工目视项（部署后）：首页 1100–1300px 工具栏分行与下拉文字；愿望单三种行（仅本站/仅 Steam/合并）来源与按钮显隐；后台 375px 下任务健康/价格变化/浏览排行/缺图/未归属账号/对齐审核卡片与操作。

## [2.28.10] - 2026-11-24

FG 移除 18R 查询入口 + FH 成人内容统计 + ER CLI 遗留缺陷 + FF 卡片英文名占位 + FB 后台顶栏版本徽标 + EN CSP 加固（⚙️ 调整 5 / 🐞 缺陷 1 / 🧹 技术债 1，无新功能面 → 小版本，2.28.9 → 2.28.10 连续递增）。站点 + App 双仓库（App 提交 `67b0e78`）。

### 调整

- **FG 移除 18R 查询入口（7e0387d、89d5eb4；App 67b0e78）**：Web 前台删除 PC「18R」按钮、移动端 chip、筛选抽屉 18R 分组、`adultFilter` 状态与 `toggleAdult`，请求不再构造 `adult=badge&rating=adult`；后台游戏管理删除「内容分级」筛选下拉与成人/成熟点击 chip（更多指标 12→10）。**能力保留**：`/api/games` 的 `adult`/`rating` 与 `/api/admin/games` 的 `rating` 参数、`adult_flag`/`mature_flag` 数据、`rating-backfill` 任务、`SITE_ADULT_DISPLAY`（默认 `hide`，`badge` 时仍出 18+ 角标）。App 删除首页/搜索 18R chip 与年龄确认弹窗，`HomeFilterParams` 固定 `adult=hide` 且不带 `rating`，DataStore `adultEnabled` 字段保留（升级兼容）。
- **FH 成人内容统计（7e0387d、89d5eb4）**：后台「游戏管理 → 同步与回填」新增「内容分级统计」只读卡片——成人/成熟总数、分级已回填/未回填（口径 `required_age` 已采到/未采到，与 `listRatingBackfillCandidates` 候选一致）、最近回填时间（调度状态 `rating-backfill.lastRunAt`）；`adminGameStats` 加 `ratingBackfilled`/`ratingPending` 经 `/api/admin/games/stats` 透传，无成人内容列表/查询入口（全库计数，含未上架/禁用，与前台可见数可能不同）。
- **FF 游戏卡片英文名占位（fcd0263）**：英文名行改为始终渲染 + `.game-subtitle{min-height:1.4em;line-height:1.4}`，无英文名（或与主名相同）时用空占位撑住，有/无英文名的卡片等高、价格与标签不再错位；移动端同 class 生效。
- **FB 后台顶栏（bce21bd）**：删除顶栏「返回网站 ↗」按钮，保留用户菜单单一入口；版本徽标从仅管理员改为**所有登录用户可见**（移动端隐藏）；`GET /api/admin/version` 从 `requireAdmin()` 改登录用户可读（未登录仍 401），`force=1` 仅管理员生效、普通用户静默忽略（不触发外网检查），响应契约不变。
- **EN CSP 安全加固（5c637a1 → bce21bd）**：`src/server.js` 输出三档 CSP（默认 `enforce` 正式 / `report-only` 观察 / `off` 关闭），SPA 严格档用 `'self'` + per-request nonce + 内联样式 hash（不放 `script-src 'unsafe-inline'`），旧 `web/` 回退页兼容档，封禁页/申诉页注入脚本带 nonce；新增 `POST /api/csp-report` 上报 → `csp.violation` 日志；`src/settings.js` 加 CSP 模式设置项（保存即热加载）。

### 修复

- **ER B4/cli 拆分遗留 3 项（92ac6a0）**：① `cli backfill` 把 store 传给 `countBackfillCandidates`/`listBackfillCandidates`（签名要 q）→ 改传 `s.query`；② `cli prune` 在未跑 ensure 的裸库报 `42P01` → purge 前幂等 ensure `email_codes`/`steam_account_logs`；③ #18 拆分遗留 `cmdBackfill` 价格回退分支调用 `syncPrices` 断引用 → import 已补并加回归锁；新增 `test/cli-ops.test.js`（3 条行为/回归锁，注册 test:4）。

### 测试

- QA：`docs/QA-FG-FH.md` 第 2 轮 + `docs/QA-BATCH-2026-11-24.md` → FG/FH/ER/FF/FB/EN **全部 ✅ 放行**（0 功能打回项；23 条用户视角功能清单）。
- 相关测试：`cli-ops` 3/3、`frontend-mobile` 13/13、`admin-console-ia` 23/23、`mail-templates` 17/17、`settings` 15/15、`csp` 11/11、`api` 38/38、`version` 11/11、`remove-18r-entry` 6/6、`serve` 12/12、`http-guard` 7/7、`admin-ux-security` 6/6、`admin-games` 6/6；主链分段 test:3/test:4 相关段全绿；`npm run frontend:build` ✓；`npm run scan` 干净。
- App：`gradlew :app:testDebugUnitTest --tests "cn.yyliucha.steamdeals.HomeFilterParamsTest"` → BUILD SUCCESSFUL（1m22s），测试报告 `tests=11 failures=0 errors=0`。
- 人工目视项（部署后）：前台/App 无 18R 入口截图、后台统计卡截图、普通用户版本徽标截图、FF 两种卡片并排、CSP 正式档下登录/列表/后台/App WebView 功能正常。

## [2.28.9] - 2026-11-24

FE 个人资料 Steam 账号同步按钮 + 按钮样式（⚙️ 调整 1，无新功能面 → 小版本，2.28.8 → 2.28.9 连续递增）。本批只含 Web 前端，不涉及 App 仓库。

### 调整

- **个人资料 Steam 账号「同步游戏库 / 同步愿望单」按钮（0bc2733）**：`frontend/src/pages/ProfilePage.vue` Steam 账号 Tab 每个账号操作区新增两个按钮（普通用户本人可用）——点击 → POST `.../library|wishlist/sync`（EM 批异步 202）→ 按钮「同步中…」禁用 → 2s 轮询 `GET .../sync-status` 最长 60s → 完成后 `loadLibrary` 刷新该页已拥有/愿望单统计并提示结果；无 API Key 账号点同步按后端 400 映射为「该账号缺少 API Key，请先配置」（不再报 500）；手机端操作区 6 按钮 2×N 网格、触摸目标 ≥44px。后端接口与权限未改（仍 `requireUser` + `requireAccountOwner`）。
- **个人资料页按钮样式统一（0bc2733）**：排查确认模板全部为 `el-button`（源码/组件注册/样式导入/构建产物均正常），线上原生观感为旧构建/缓存 → 本版重建产物即修复；headless Chrome 断言锁住（12 个按钮全部 el-button、无未注册自定义标签、计算样式圆角 3px + 边框 + 白底）。

### 测试

- QA docs/QA-FE.md 第 1 轮 ✅ 放行（通过 5 / 缺失 0 / 偏差 0 / 需人工确认 2 = 真实 Steam 成功链路、截图目视）。
- `test/profile.test.js` 16/16（含 FE 编译级静态锁：轮询参数 60000、无 Key 文案、手机端网格，双向反向自检）；`test/steam-accounts.test.js` 18/18；主链分段 test:1~4 全绿；`npm run frontend:build` ✓；`npm run scan` 干净（829 文件）。

## [2.28.8] - 2026-11-23

FC 调度器 compose 文件级拆分——app 与 scheduler 两个文件独立发布（🧹 技术债，业务不剥离 → 无新功能面 → 小版本，2.28.7 → 2.28.8 连续递增）。本批不涉及 App 仓库。

### 调整

- **生产变体 compose 文件级拆分（5ef3c2c）**：新增 `compose.scheduler.hub.yaml`（独立项目 `steamdeals-scheduler`，
  external 网络 `steamdeals_default` + external 卷 `steamdeals_appdata`/`steamdeals_logs`，无 depends_on——跨项目靠
  `DB_WAIT_SEC=60` 重试 + 启动顺序兜底）；`compose.hub.yaml` 删除 scheduler 服务段（只留 db+app），其余 4 个变体不动。
  发版命令两套互不牵连：app 发版 `pull app && up -d app`（不再重建 scheduler），scheduler 升级/回滚只动 scheduler 文件。
- **`scripts/scheduler-service.sh` 双 compose 上下文**：新增 `SCHEDULER_COMPOSE_FILES`（默认 `-f compose.scheduler.hub.yaml`，
  可环境变量覆盖），install/remove/status 的 up/stop/rm/ps/logs 全部走 scheduler 上下文；防双调度器检查与 app 查询仍走
  app 上下文。
- **文档**：docs/DEPLOY.md 两套发布命令 + 「命令与文件归属」表（含 env 双份同步提醒）+ 首次启动顺序（先 app 后 scheduler）；
  docs/DELIVERY.md 部署提示与部署后验证清单（app 发版后 scheduler 未重建、scheduler 独立重建后心跳）。

### 测试

- QA docs/QA-FC.md 第 1 轮 ✅ 放行（通过 8 / 缺失 0 / 偏差 0 / 需人工确认 2=服务器实跑项）。
- `test/scheduler-service.test.js` 12/12（静态锁随拆分更新 + 反向自检 + mock 场景实跑双上下文断言）；
  `test/deploy.test.js` 24/24（FC 段断言 hub 无 scheduler + scheduler 文件接 app 网络）；`test/docs.test.js` 5/5；`scan` 干净。

## [2.28.7] - 2026-11-23

EZ 个人资料页 Tab 版 + FA 用户菜单切换账户（⚙️ 调整 ×2，均无新功能面 → 小版本，2.28.6 → 2.28.7 连续递增）。本批不涉及 App 仓库。

### 调整

- **EZ 个人资料页 Tab 版（8eeb1f4）**：`frontend/src/pages/ProfilePage.vue` 五分区重排为 `el-tabs` 三 Tab——基本信息 / Steam 账号（绑定+游戏库合并：每账号一行（名/默认徽标/SteamID/绑定时间 + 已拥有/愿望单/最近同步）+ 查看已拥有/查看愿望单/设为默认/解绑 + 底部「＋ 绑定新的 Steam 账号」）/ 偏好与统计（主题/邮件 + 三项统计）；保存/取消固定底部（sticky，三 Tab 共用同一表单）；手机端 Tab 横向滚动 + 单列布局 + 底部固定保存；全部按钮 el-button；原功能不变（头像/邮箱/简介/绑定/解绑/默认/主题/邮件/统计/未保存离开提示）。规格见 [docs/PROFILE-PAGE-SLIM.md](docs/PROFILE-PAGE-SLIM.md)。
- **FA 用户菜单「切换账户」（8eeb1f4）**：`frontend/src/pages/Console.vue` 用户菜单新增「切换账户」，顺序与 demo 一致（个人资料/修改密码/返回网站 ↗/（分隔线）切换账户/退出登录，退出登录红字）；切换 = POST /api/logout → `/login?switch=1`（提示「切换账户：已退出当前会话…」）→ 登录成功回原页面；退出登录保持现状（回首页）。规格见 [docs/PROFILE-PAGE-SLIM.md](docs/PROFILE-PAGE-SLIM.md) §3。

### 测试

- QA docs/QA-EZ-FA.md 第 1 轮 ✅ 放行（通过 11 / 缺失 0 / 偏差 0 / 需人工确认 1=截图目视，截图 8 张在 `F:\dsh\ez-fa-shots\` 待所有者目视）。
- 本批相关测试全绿（profile 15/15 + admin-console-ia 23/23 + auth-pages 14/14 + session-heartbeat 7/7 + frontend-registration 9/9）+ 主链分段 test:1~4 + `frontend:build` ✓ + `scan` 干净。

## [2.28.6] - 2026-11-23

EV 部署回归修复（serve 默认端口 8090 与 compose 映射 8080 不一致 → 502）——🐞 缺陷修复，无新功能面 → 小版本，2.28.5 → 2.28.6 连续递增。

### 修复

- **`serve` 默认端口 8090 → 8080（EV 回归）**：EV 拆分后 app 用 `command: ["serve"]`，但 cmdServe 默认端口
  8090，compose 端口映射为容器 8080 → nginx 502（生产实测 `api.listen port=8090` + `127.0.0.1:8520` 无响应）。
  修复：`cmdServe` 默认端口改为 8080（与 `cmdAll` 及 compose 一致）；WEB_PORT 环境变量仍可覆盖。
## [2.28.5] - 2026-11-23

v2.28.4 构建未发布（CI 红：EW 旧静态断言过期）→ 修正后连发；含 backfill 回归修复。

### 修复

- **EW 旧静态断言更新（test/wishlist.test.js）**：v2.9.0 时代「卡片/详情不再拼接 Steam 账号名」断言与 EW
  「恢复只读展示 wishlisted_by」冲突 → 改为 `assert.match(home, /wishlistByText/)`（允许只读展示），
  仍保留「禁止账号选择/多选/推送」的断言（直写本站、空 body 删除）。
- **backfill 回归修复**（同 v2.28.4 内容）：countBackfillCandidates 兼容 store 调用 + ops.js 传 s.query。
## [2.28.4] - 2026-11-23

B4/cli 拆分回归修复（backfill 任务每次调度失败）——🐞 缺陷修复，无新功能面 → 小版本，2.28.3 → 2.28.4 连续递增。

### 修复

- **backfill `q is not a function` 回归（EX）**：B4/cli 拆分后 `src/cli/ops.js` 把 **store 对象**传给
  `db.countBackfillCandidates(q)`，而该函数按 q 函数调用 → 每次调度 `TypeError: q is not a function`（生产
  日志 `/app/src/store/pg.js` + 失败邮件）。修复：ops.js 显式传 `s.query`；pg.js 兼容 `q 函数 / store({query})`
  两种调用；`test/backfill-throughput.test.js` 增加 store 调用回归用例（反向自检）。
# 变更日志

## [2.28.3] - 2026-11-23

EU 定时任务重启韧性 + EV 调度器独立进程化（🐞 缺陷 1 + ⚙️ 部署调整 1，均无新功能面 → 小版本，2.28.2 → 2.28.3 连续递增）。本批不涉及 App 仓库。

### 修复

- **EU 定时任务重启韧性（3c6d752）**：发版重启不再把在跑任务误报成失败——`scheduler.stop()` 停机过程中非零退出的任务判定为 `interrupted`（`src/scheduler.js` 新纯函数 `outcomeFor`），不记 `job_failed`、不发失败邮件、不进熔断计数；CLI 子进程收到 SIGTERM 先把 `sync_runs.status` 记为 `interrupted`（含「进程收到 SIGTERM」说明）再以 143 退出（新模块 `src/cli-interrupt.js`）；服务重启残留的 running 记录由 `markStaleSyncRuns` 标 `interrupted`（原 failed）；后台「任务健康条 / 同步记录 / 同步与回填任务表」新增「被重启中断」显示（info 标签，不标红）。停机时跳过失败原因查询，消除 `Cannot use a pool` 日志噪音。**EU-5 排空（drain）**：scheduler 收到停机信号不再立即打断在跑任务——先等它们自然完成（`SCHEDULER_DRAIN_TIMEOUT_MS` 默认 10 分钟，compose 的 scheduler 服务 `stop_grace_period: 10m` 配套），超时才 SIGTERM（被打断的按 EU-1 记「被重启中断」）——按 EV §6 发版顺序升级时任务零中断。规格见 [docs/SCHEDULER-RESTART-RESILIENCE.md](docs/SCHEDULER-RESTART-RESILIENCE.md)。

### 调整

- **EU-2 steam-prices 分批断点续跑**：`sync steam-prices` 新增 `--batch`（默认 5000，调度器任务参数 `STEAM_PRICE_BATCH` 可调）——每轮只处理一批（5000 款 ≈ 4–5 分钟，原整轮 106 分钟），批内每 1000 个 appid 落一次断点（新模块 `src/sync-resume.js`，`data/scheduler-resume.json`，无 schema 变更）；被重启打断后下一轮自动排除已处理 appid、不重跑；断点超过 36 小时自动作废。规格见 [docs/SCHEDULER-RESTART-RESILIENCE.md](docs/SCHEDULER-RESTART-RESILIENCE.md)。
- **EV 调度器独立进程化（8dcd41a）**：compose 五个变体（compose.yaml / hub / cn / 两个 external-db）的 app 改为 `command: ["serve"]`（只跑 Web/API），新增独立 `scheduler` 服务（与 app 同镜像、`command: []` → `RUN_MODE=scheduler` → `node src/scheduler.js`、共享 data/logs 卷、`depends_on db`、`restart: unless-stopped`）——发版只重启 app、不打断定时任务；`scripts/scheduler-service.sh install|remove|status` 一键安装/删除/查看（install 防双调度器：app 仍在跑 all 拒绝，幂等，并校验 `scheduler.start` 日志；remove 一键删除——停容器 + rm 容器 + 清 `data/scheduler-*.json` 状态 + 校验无残留，业务数据不动；status 显示容器状态、最近心跳与当前 heavy slot 任务）。规格见 [docs/SCHEDULER-AS-SERVICE.md](docs/SCHEDULER-AS-SERVICE.md)。
- **部署文档**：DELIVERY 第 4 节新增「发版避让长任务」（重启前查长任务，等待 ≤10 分钟或跳过）与「调度器独立服务」（install/status/remove、发版只重启 app、调度器代码更新才 restart scheduler）。

### 测试

- QA docs/QA-EU.md 第 1 轮 ✅ 放行（5/0/0/2）、docs/QA-EV.md 第 1 轮 ✅ 放行（5/0/0/2）（QA 报告默认不入库，纯文本引用）。
- 新增主链：`test/cli-interrupt.test.js`（SIGTERM 收尾——纯逻辑全平台 + 真信号 CI Linux）、`test/sync-resume.test.js`（断点读写/排除/过期/脏数据）、`test/scheduler-service.test.js`（五个 compose 静态锁 + 脚本语义锁 + mock docker 场景实跑 install/remove/status）；`test/scheduler.test.js` +41 项 EU 断言（outcomeFor/分批参数/静态锁）、`test/sync-runs.test.js` 更新 interrupted 语义、`test/log-schema.test.js` 快照补 `scheduler.job_interrupted`、`test/deploy.test.js` app command 断言随 EV 更新。
- 主链分段 test:1~4 全绿；`node test/api.test.js` 38/38；`node test/cli-dispatch.test.js` 12/12；`frontend:build` ✓；`scan` 干净；CI test-main（3c6d752）✅。

## [2.28.2] - 2026-11-23

ET 设置页布局系统修复（⚙️ 调整，无新功能面 → 小版本，2.28.1 → 2.28.2 连续递增）。本批不涉及 App 仓库。

### 修复

- **ET 设置页布局系统修复（64d9f48）**：`frontend/src/pages/AdminModules.vue` 设置 tab 非 plain 分支——`displaySettingsFields` 改按 section 分组返回 `{sec,entries}[]`；模板每 section 一张 `.settings-card`（卡片内 cardHead→cardBody→rows/grid→fold→foldBody）；样式 `.settings-sections` 两列网格 `repeat(2,minmax(0,1fr))`（≤960px 单列）、`.settings-card` 容器边框/圆角、head/body 去独立边框、fold 卡片内全宽。修复「数据源与采集 / 站点与内容 / 高级」三 tab 卡片零件（卡头/字段/折叠）被拆成独立网格项导致的左右错位与大片空白；plain 组（auth/security/alerts/network）与邮件/初始化页不动；字段功能（保存/恢复默认/搜索/只看非默认/折叠记忆/secret 编辑）不变。规格见 [docs/SETTINGS-LAYOUT-FIX.md](docs/SETTINGS-LAYOUT-FIX.md)。

### 测试

- QA docs/QA-ET.md 第 1 轮 ✅ 放行（5/0/0/1）；`node test/settings.test.js` 15/15、主链分段 test:1~4 全绿、`npm run frontend:build` ✓、`npm run scan` 干净；headless Chrome 实测三 tab 卡片结构（每 section 一张卡、两列网格、390px 单列、折叠在卡片内）与功能回归（保存/恢复默认/搜索高亮/折叠自动展开）。

## [2.28.1] - 2026-11-21

CO-5/B4-2 巨石拆分第十四~十七轮交付（8 域：admin align / admin 用户批量 / admin 报表备份日志 / admin 图片 / admin 游戏目录 / admin 提醒愿望单 / cli 运维类 / 公开 games，契约零变化）（🧹 技术债重构，无新功能面 → 小版本，2.28.0 → 2.28.1 连续递增）。本批不涉及 App 仓库。**B4 队列 21 域全部拆完。**

### 技术债

- **第十四轮 admin align 域（队列 #17，4817d49）**：`src/routes/admin-align.js` 415 + `src/store/admin-align-repository.js` 78；管理段单入口对齐审核路由组（候选/确认/忽略/撤销/审阅记录/快照/批量操作）；`triggerAlignGeneration`（single-flight）/`runGated`（并发闸）/store（事务）按引用传 ctx，`computeAlignGroups`/`ensureAlignSnapshot`/`alignSnapshotMaxAgeMs` 留宿主（CLI align-snapshot 共享）；`src/server.js` 净 −325、`pg.js` +4；QA 12/0/0/2。
- **第十五轮 admin 报表备份日志域（队列 #12，4a93c01）**：`src/routes/admin-reports.js` 195 + `src/store/admin-reports-repository.js` 20 + `test/admin-reports.test.js` 139；管理段单入口 6 条路由（backups/backup/logs/reports/price×2/steam-logs）；跨域共用函数留原处（priceChanges 族/steam-log/backup.js）；`src/server.js` 净 −118，本域零 SQL 搬家；QA 16/0/0/2。
- **第十六轮 admin 图片域（队列 #13，652e6f7）**：`src/routes/admin-images.js` 135 + `src/store/admin-images-repository.js` 39 + `test/admin-images.test.js` 147；管理段单入口 4 条路由（images GET/reset-miss/coverage/backfill）；`imageCoverageRows` 搬家 + 域内联 SQL 抽 `imageCoverageMissingRows`；`src/server.js` 净 −57；QA 16/0/0/2。
- **第十七轮 admin 用户批量域（队列 #11，9905946）**：`src/routes/admin-users.js` 859 + `src/store/admin-users-repository.js` 407；`/api/admin/users*` 全 12 组路由拆走（kickAll/email code+verify/DELETE+PATCH/steam-accounts/reset-code/password/unlock/email/users/deletions/POST users 410）；`src/server.js` 净 −830、`src/store/pg.js` 净 −302（13 files +1796/−1272）；QA 17/0/2/0。
- **第十八轮 admin 游戏目录域（队列 #15，42ee800）**：`src/routes/admin-games.js` 173 + `src/store/admin-games-repository.js` 206 + `test/admin-games-split.test.js` 161；管理段单入口 5 条路由（stats/games/:id/links/deleted/merge）；`adminGameStats`/`adminGameLinks`/`listDeletedGames` 搬家；`src/server.js` 净 −103、`src/store/pg.js` 净 −70；QA 17/0/0/2。
- **第十九轮 admin 提醒愿望单域（队列 #16，beb25e4）**：`src/routes/admin-watchlist.js` + `src/store/admin-watchlist-repository.js`；admin 视角 8 组路由（wishlists GET/watchlist GET+POST/单条+批量 push/migrate/delete/DELETE :id）拆走，手动推送频控三件套随域移入模块级；`src/server.js` 净 −278、`src/store/pg.js` 净 −100；QA 16/0/2/0。
- **cli 运维类域（队列 #20，8249e56）**：`src/cli/ops.js` 1139 + `src/store/cli-ops-repository.js` 47；`src/cli.js` 净减 1164 行；拆走 serve/all/backfill/images/prune/logs/report 等运维命令入口（含 EC `images backfill` 随域合并）；命令名/参数/输出/退出码零变化；QA 14/0/0/2。
- **公开 games 域（队列 #21，d46b51a）**：`src/routes/games.js` 436 + `src/store/games-repository.js` 600 + 测试 +188；`/api/games/*` 全 16 组路由拆走（含 POST requireAdmin 管理员写操作，路径在 `/api/games/*` 前缀下归 #21）；`/api/admin/games*` 留 #15、isLoggablePath 豁免中间件留 server.js；`src/server.js` 净 −370、`src/store/pg.js` 净 −537；QA 17/0/2/0。
- 拆分模式见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §15；**B4 队列 21/21 域全部「已拆」**（docs/B4-QUEUE.md）；本轮 6 域净减 server.js ≈1676 / pg.js ≈1009。

### 测试

- QA 八域全部第 1 轮 ✅ 放行（0 打回）：#17 12/0/0/2、#12 16/0/0/2、#13 16/0/0/2、#11 17/0/2/0、#15 17/0/0/2、#16 16/0/2/0、#20 14/0/0/2、#21 17/0/2/0（需人工确认项为沙箱 commit-own EPERM / frontend:build 环境限制，CI 兜底；报告 docs/QA-CO5-B4-2-*.md）。
- 站点：`node test/api.test.js` 38/38、`npm run frontend:build` ✓、`npm run scan` 干净、主链 test:1–4 全绿（test:1 仅 commit-own 4 项本机沙箱基线红，与改动无关）。部署提示：纯技术债重构，无 schema/接口/配置变化，升级即可。

## [2.28.0] - 2026-11-20

DU + DV + EC + EM + DT-1~5 八条合并发版（✨ 功能 1 条 + ⚙️ 调整 5 条 + 🐞 缺陷 2 条，含新功能面 → 大版本，2.27.9 → 2.28.0 连续递增）。本批不涉及 App 仓库。

### 新增

- **DT-2 用户级数据接口 + 5 页数据接入（站点 403e6f2）**：`GET /api/me/sessions`（仅返回当前用户会话）、`POST /api/me/sessions/:id/revoke`（只能踢自己，非自己 404）、`GET /api/me/wishlist`（分页/搜索，复用 wishlist 服务层）；普通用户 5 页（个人资料/登录会话/到价提醒/愿望单/公告）全部接入用户级接口，管理员页面保持 admin 接口；以上接口强制 `session.user.id`、忽略传入 userId、越权 403/404 并审计。规格见 [docs/ADMIN-PERMISSIONS.md](docs/ADMIN-PERMISSIONS.md) DT-2。
- **EC 图片覆盖治理（站点 ab7ba90）**：EC-1 管理后台「图片覆盖看板」（游戏总数/有 header_image 数/本地已缓存数/缺图数 + 缺图游戏列表分页标原因：header_image 空 / CDN 404 / 抓取失败 + 重置缺图负缓存）；EC-2 缺图回填任务（`src/image-backfill.js` + CLI `images backfill` + 调度任务 images-backfill，限速 ≥1.2s/请求防 429，日志 `images.backfill_*`，手动按钮 `POST /api/admin/images/backfill` single-flight）；EC-3 前端缺图品牌占位（CoverPlaceholder S 标/首字，列表与详情统一，不再空白块）。规格见 [docs/IMAGE-COVERAGE.md](docs/IMAGE-COVERAGE.md) §8。
- **EM Steam 同步超时修复（站点 ba9b0b0）**：EL-1 同步类请求单次超时 30s→8s（快速失败交给代理池切换，切换/冷却日志保持可观测）；EL-2 愿望单/库同步改「触发后台任务 + 立即返回 202」（同账号 single-flight 重复触发 409「进行中」）+ `GET /api/steam/accounts/:id/sync-status`（进程内状态 + steam_logs 兜底 → idle/running/lastResult）；EL-3 后台按钮「同步中…」+ 2s 轮询（最长 60s）+ 完成后刷新列表并提示结果/失败原因 + 重试，不再出现笼统「请求超时」。规格见 [docs/STEAM-SYNC-TIMEOUT.md](docs/STEAM-SYNC-TIMEOUT.md)。
- **DT-1 菜单与路由权限隔离（站点 7f5edba）**：admin 全量菜单 / 普通用户仅 5 页（个人资料/登录会话/我的到价提醒/我的愿望单/站点公告）；删除「Steam 账号」菜单项（管理员账号查看需求并入「用户管理 → 编辑用户」弹窗只读显示）；路由守卫：无权限 section 直达 URL 重定向 profile + 「无权限」提示。规格见 [docs/ADMIN-PERMISSIONS.md](docs/ADMIN-PERMISSIONS.md) DT-1。
- **DT-3 用户管理打磨（站点 4a40737）**：删除「新建用户」（按钮 + `POST /api/admin/users` 接口下线 410，用户只能自助注册）；行内五操作：编辑（仅改角色 admin/user，用户名/邮箱/绑定 Steam 账号只读展示）/重置密码（单条）/禁用·启用/踢会话/删除，角色变更与禁用二次确认 + 审计（`admin.user_edit`/`admin.user_disabled`）；批量只保留「批量踢会话」；禁用用户会话立即失效（复用 BK）；e2e 建号链迁自助注册。规格见 [docs/ADMIN-PERMISSIONS.md](docs/ADMIN-PERMISSIONS.md) DT-3。
- **DT-4 验证码体验（站点 4c49f7c）**：验证码冷却按场景分桶（后台「重置密码发码」不占用前台登录/注册/重置额度）+ `retryAfterSec` 供前端倒计时；所有验证码按钮统一倒计时 60s（发送中/剩余秒数/可重发三态）；重置密码弹窗打开不发码、点「发送验证码」才发、验证失败不关弹窗（显示还剩 N 次机会）、过期显示「重新发送」。规格见 [docs/ADMIN-PERMISSIONS.md](docs/ADMIN-PERMISSIONS.md) DT-4。
- **DT-5 前后台入口（站点 c19f514）**：前台未登录顶栏「登录」按钮（跳 /login）；登录后前台不显示「退出登录/修改密码」；Console 全局顶栏（所有 section 共用）「返回网站 ↗ + 用户徽标」下拉菜单树（个人资料/修改密码/返回网站/退出登录，普通用户同样可用）；退出后回到未登录态且心跳基线正确。规格见 [docs/ADMIN-PERMISSIONS.md](docs/ADMIN-PERMISSIONS.md) DT-5。

### 修复

- **DU 个人简介 placeholder 插值未绑定（站点 791d729）**：ProfilePage.vue 静态 `placeholder="…{{ … }}…"` 改 `:placeholder` 动态绑定——admin 显示「介绍一下自己（可选）」、普通用户「介绍一下自己（1–200 字）」。
- **DV 游戏管理「ITAD」筛选改来源筛选（站点 0a6b978）**：`platform=itad` 改走来源判定（`game_source_sync` 有 matched 标记），其余平台仍按 `offers.platform_code` 不变；前端平台下拉分「平台/来源」两组（「ITAD（来源）」视觉区分）；不动采集链路。规格见 [docs/ITAD-SOURCE-FILTER.md](docs/ITAD-SOURCE-FILTER.md)。

### 测试

- QA 八条全部第 1 轮 ✅ 放行（0 打回）：DU 3/0/0/0、DV 5/0/0/0、EC 4/0/0/1、EM 5/0/0/1、DT-1 6/0/0/1、DT-2 10/0/0/1、DT-3 5/0/0/1、DT-4 8/0/0/1、DT-5 6/0/0/1（需人工确认项均为本机沙箱 headless 渲染限制，CI 兜底；报告 docs/QA-DU.md、QA-DV.md、QA-EC.md、QA-EM.md、QA-DT-1~5.md）。
- 站点：`node test/api.test.js` 38/38、`npm run frontend:build` ✓、`npm run scan` 干净、主链 test:1–4 全绿（test:1 仅 commit-own 4 项本机沙箱基线红，与改动无关）。部署提示：EC 看板/回填任务首轮执行、EM 同步异步化（触发即 202 + sync-status 轮询）、DT 权限/菜单与普通用户 5 页、DV「ITAD（来源）」筛选上线生效。

## [2.27.9] - 2026-11-20

CO-5/B4-2 巨石拆分第十/十一/十二/十三轮交付（admin 系统设置域 + cli 同步类域 + cli 报表类域 + admin 会话域，契约零变化）（🧹 技术债重构，无新功能面 → 小版本，2.27.8 → 2.27.9 连续递增）。本批不涉及 App 仓库。

### 技术债

- **巨石拆分第十轮（CO-5/B4-2 admin 系统设置域，B4 队列 #10，站点 5ce2e50）**：`src/routes/admin-settings.js`（管理段单入口 11 条路由——`GET /api/admin/version`、`GET|POST /api/admin/smtp`、`POST /api/admin/smtp/test`、`GET /api/admin/emails`、`GET /api/admin/mail/templates`、`POST /api/admin/mail/templates/:event/(reset|preview|test)`、`PUT /api/admin/mail/templates/:event`、`GET /api/admin/mail/log`、`GET /api/admin/proxies`、`POST /api/admin/proxies/probe`）+ `src/store/admin-settings-repository.js`（`listMailTemplates`/`upsertMailTemplate`/`resetMailTemplate`/`listMailLog` 4 函数搬家 + 域内联 SQL 抽 5 新函数）；`insertMailLog` 跨模块共用留 `pg.js`、DDL 留 `email-auth.js`；DX 批 smtp 的 `invalidateSiteCache` 失效并入（语义随路由）；`src/server.js` 净 −225、`src/store/pg.js` 净 −5；**外部契约零变化**。
- **巨石拆分第十一轮（CO-5/B4-2 cli 同步类域，B4 队列 #18，站点 9bc710a）**：`src/cli/sync.js` 924 行 + `src/store/cli-sync-repository.js` 84 行；`src/cli.js` 3026→2128 **净减 898 行**；拆走 17 个命令入口（`sync` 9 target——all/steam/steam-prices/steamall/catalog/sonkwo/itad/gog/humble，加 `steam-accounts`/`steam-claim`/`app-sync`/`steam-discovery`/`steam-status`/`discover sonkwo`）；命令名/参数/输出/退出码零变化；`pg.js`/`server.js`/`routes` 零 diff（域内联 SQL 抽 9 个 repository 新函数）；`runSyncTracked`/`syncNote` 等跨域共享按引用传参。
- **巨石拆分第十二轮（CO-5/B4-2 cli 报表类域，B4 队列 #19，站点 2aa8b15）**：`src/cli/report.js` 333 行 + `src/store/cli-report-repository.js` 9 行；`src/cli.js` 2128→1831 **净减 297 行**；拆走 7 个命令（`report`/`alerts`/`stats`/`history`/`list`/`chart`/`compare`）；命令名/参数/输出/退出码零变化；`pg.js`/`server.js`/`routes` 零 diff（`compareGameBySteamAppid` 唯一内联 SQL 抽 repository）；`yuan`/`width`/`pad` 跨域共享按引用传参、`sparkline`/`BLOCKS` 唯一使用者是 history 随域移出。
- **巨石拆分第十三轮（CO-5/B4-2 admin 会话域，B4 队列 #14，站点 9659435）**：`src/routes/admin-sessions.js` 89 行 + `src/store/admin-sessions-repository.js` 50 行；管理段单入口 2 条路由（`GET /api/admin/sessions` 列表 + `DELETE /api/admin/sessions/:id` 踢下线）；`listSessions` 唯一专属 SQL 搬家（签名照抄），`deleteSessionById`（#11 bulk 共用）/`deleteSessionsOfUser`（禁用共用）/`deleteSessionsOfUsers`/`touchSession`/`deleteSessionByToken`（中间件）留 `pg.js`，sessions 表 DDL 留 migrate()；kickAll/revoke-others/bulk 派发条目留宿主（#11/主段）；`src/server.js` 净 −13、`src/store/pg.js` 净 −19；**外部契约零变化**。
- 拆分模式见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §15；已交付 13 域（app/appeal/auth/watchlist/announcements/me/site/admin-access/admin-sync/admin-settings/admin-sessions/cli-sync/cli-report），剩余 B4 队列 #11–#13/#15–#17/#20–#21 继续按 [docs/B4-QUEUE.md](docs/B4-QUEUE.md) 推进。

### 测试

- QA（本批 4 块全部放行）：#10 ✅ docs/QA-CO5-B4-2-admin-settings.md 第 1 轮（17/0/0/2）；#14 ✅ docs/QA-CO5-B4-2-admin-sessions.md 第 1 轮（12/0/0/2）；#18 ✅ docs/QA-CO5-B4-2-cli-sync.md 第 1 轮（15/0/0/2）；#19 ✅ docs/QA-CO5-B4-2-cli-report.md 第 1 轮（13/0/0/2）。需人工确认项均为本机沙箱环境限制（commit-own spawn EPERM 基线 / frontend:build 默认命令被拦改用 `--configLoader native` 变体），CI 兜底。
- 站点：域拆分静态锁（分支在新文件/宿主真实接线/旧分支不残留防双实现）+ 反向自检（真删分支实测必红）；mail-templates 17/17、email-auth 9/9、sync-runs 9/9、proxy-pool 8/8、version 11/11、sessions 17/17、isolation 7/7、cli-dispatch 5/5→9/9（#18 三条新锁 + 反向自检 ×2；#19 报表类 4 项锁 + 反向自检 ×2）、app-release-sync 7/7、scheduler 38/38、alerts-html 3/3、price-report-html 4/4、compare 7/7、report 14/14、alerts 8/8、notify 14/14；`node test/api.test.js` 38/38、`npm run frontend:build`（native 变体）✓、`npm run scan` 干净；主链 test:1–4 全绿（test:1 仅 commit-own 4 项沙箱基线红，与改动无关）。

## [2.27.8] - 2026-11-20

ED + EH + EI + EL + EK + DX 合并发版（🧪 测试基建 1 条 + ⚙️ 调整 3 条 + 🐞 缺陷 1 条 + 🧹 技术债 1 条，均无新功能面 → 小版本，2.27.7 → 2.27.8 连续递增）。本批不涉及 App 仓库（六条均为站点侧）。

### 技术债

- **DX 列表/站点接口性能优化（站点 090af4c）**：gameSearch count 合并（四分支 rows 查询带 `count(*) over()`，无关键词列表 count+rows 从 2 条 SQL 合并为 1 条，空页回落独立 count、total 口径不变）；列表 45s 短 TTL 内存缓存（`src/search-cache.js`；key=归一化筛选参数+region+userId 摘要+游客哈希；命中日志 `search.cache_hit`；gen=sync_runs max(id) 感知调度器跨进程同步；同步/后台操作主动失效）；`/api/site` 60s 缓存（设置保存/SMTP 保存失效、重启清空）；`test/search-perf.test.js` 5 项进主链 test:3。本机线上只读压测（部署前 v2.27.7，N=30）：列表 P50 327ms/P95 349ms、搜索 P50 535–586/P95 599–644ms、/api/site P50 60/P95 68ms；**部署后同条件复测目标：列表/搜索 P95 ≤150ms、/api/site ≤50ms**。规格见 [docs/SEARCH-FIX-PERF.md](docs/SEARCH-FIX-PERF.md) §DX。

### 修复

- **EK App Release 同步资产下载支持专用代理（站点 cc4fcf5）**：线上 `app-release-sync` 每 15 分钟连续失败（大陆服务器直连 `release-assets.githubusercontent.com` 超时，`reason=apk_download/latest_download`）。`src/settings.js` 新增 `network.appSyncProxy`（secret，env `APP_RELEASE_SYNC_PROXY`）；`src/app-release.js` 三件套资产下载（latest.json / APK / sha256）配置非空时走 `undici.ProxyAgent`（复用 http.js `proxyAgentOptions`，零新依赖）且该次超时 30s，留空保持现状（直连、10s）；下载前记 `app.release_proxy` 日志（`via=proxy/direct`，代理地址打码）。专用代理只作用于资产下载，不复用 `network.httpsProxy`（避免波及 itad/gog/humble/images 出站）。规格见 [docs/APP-RELEASE-SYNC-PROXY.md](docs/APP-RELEASE-SYNC-PROXY.md)。

### 调整

- **EH 同步逻辑去 cn（内容类链路：steam-status + discovery，站点 897476c）**：`src/steam-status.js` 状态/分级 appdetails `cc=cn`→`cc=us`（失败兜底 cc=hk 判锁区保留）；`src/discovery.js` 搜索 `cc=cn`→`cc=us`；价格链路（steam.js/backfill/sync steam-prices）保持 `cc=cn` 不动（国区报价是业务核心）。规格见 [docs/STEAM-SYNC-STATUS-AND-RATING.md](docs/STEAM-SYNC-STATUS-AND-RATING.md) §10。
- **EI 同步双区域配置（contentRegion=us 内容拿全量 + baseRegion=cn/CNY 价格本位币可配）**：新增 `src/sync-regions.js`（`contentRegion`/`baseRegion`/`baseCurrency`/`regionContext` 单点读取，默认 us / cn / CNY）；后台「系统设置 → 同步区域」三项配置（`sync.contentRegion` / `site.baseRegion` / `site.baseCurrency`，区域两字母/货币三字母校验归一化，保存后调度器约 15 秒内生效、下一轮同步生效）；内容链路（steam-meta/steam-status/discovery/rating-backfill）读 contentRegion，价格链路（steam.js/sync/backfill）读 baseRegion+baseCurrency；前台默认 region 跟随 baseRegion；steam-status 仅 content=base 时顺带写本位币 offer。规格见 [docs/STEAM-SYNC-STATUS-AND-RATING.md](docs/STEAM-SYNC-STATUS-AND-RATING.md) §11。
  > 说明：EH+EI 的实现 897476c 此前已随 v2.27.6 镜像一并成像（当时 QA 尚未走完）；本批为两者 QA 通过后的**补发版记录**（QA-EH-EI 9/0/0/2），镜像内容无新增代码。
- **EL 后台「添加/编辑」统一弹窗（站点 e0821f9）**：IP 黑/白名单添加改「添加黑名单/添加白名单」按钮 + 弹窗（IP/备注/确认）；站点通知新建/编辑抽屉→el-dialog（before-close 脏确认、URL 直达保留）；Steam 专用代理内联编辑→弹窗（列表增删/上移下移/清空/健康状态表/立即检测/保存回写，脏草稿并入未保存守卫）；通用出网/App 同步专用代理内联输入→「编辑」按钮 + 弹窗（掩码显示、http/https 校验、留空保持、清除直连）；申诉处理抽屉→弹窗（处理表单在弹窗内、动作放 footer）；移动端 ≤768px 弹窗全宽。保留搜索栏 inline-form、只读查看抽屉与前台弹窗。交互 headless Chrome CDP 20/20 + 前后截图 `F:\dsh\el-shots\{before,after}`。规格见 [docs/ADMIN-EDIT-DIALOG.md](docs/ADMIN-EDIT-DIALOG.md)。

### 测试基建

- **ED test-main 加文档路径忽略（站点 143d97e）**：`.github/workflows/test-main.yml` 的 on.push 加 `paths-ignore`（`docs/**`、`**/*.md`、`CHANGELOG.md`、`data/**`）——纯文档提交不再触发/取消重跑 test-main，省 CI 时间；代码路径（`src/**`、`frontend/**`、`test/**`、`scripts/**`、`package.json`、`package-lock.json`、`.github/**`）一律不忽略；docker-hub/docker-tcr 只在 tag 触发，不动。

### 测试

- QA（本批 6 条全部放行）：ED ✅ docs/QA-ED.md 第 1 轮（4/0/0/0）/ EH+EI ✅ docs/QA-EH-EI.md 第 1 轮（9/0/0/2，2 项为上线后覆盖率观察）/ EL ✅ docs/QA-EL.md 第 1 轮（5/0/0/2）/ EK ✅ docs/QA-EK.md 第 1 轮（6/0/0/1）/ DX ✅ docs/QA-DX.md 第 1 轮（6/0/0/1）。
- 本机发版门禁：相关测试（sync-regions / steam-status / steam-meta / adapters / settings / app-release-sync / app-release / admin-edit-dialog / discovery）+ 主链分段 test:1~4 兜底 + `node test/api.test.js` + `npm run frontend:build` + `npm run scan`（输出见 release 提交与 docs/DELIVERY.md）。

## [2.27.7] - 2026-11-20

EJ 昵称显示规则统一（Web + App）（显示口径调整，无新功能面 → 小版本，2.27.6 → 2.27.7 连续递增）。App 仓库同步发布 **app-v2.24.2（22402）**。

### 修复

- **昵称显示规则统一（EJ，站点 f340d78 + 8d72320；App 6254978）**：全站「用户」展示统一为 **显示名 = 昵称（trim 后非空）? 昵称 : 用户名**——后台用户管理列表/卡片、登录会话、到价提醒（含「Steam 愿望单候选」提示与「迁移给用户」下拉）、愿望单、Steam 操作日志「归属用户」、异常审核「审阅记录」操作人，以及前台「我的」用户菜单与 App「我的」账号卡；昵称清空后两端即时回退用户名；用户管理去掉并列的「显示名」列（不做昵称与用户名并列）；登录/账号安全与所有按账号操作的接口仍用 `username`，审计「操作者」保留账号标识。服务端 `listSessions`/`listAllWatchesAdmin`（含 `claimable_users`）/`listWishlists`/`listSteamLogs`/align 查询补 `display_name`（`nullif(btrim(...), '')` 归一，空白昵称不作数），`/api/admin/sessions` 响应带 `displayName`。规格见 [docs/DISPLAY-NAME-RULE.md](docs/DISPLAY-NAME-RULE.md)。
- **巡检修掉两处既有偏差（同批）**：① 前台 `Home.vue`/`Console.vue` 用户 chip 读 `user.display_name`，而 `/api/me` 返回 `displayName` —— 有昵称也永远回退用户名，已改读 `displayName`；② App `initialOf(displayName ?: username)` 对空白昵称不判空，会显示 `S` 而不是用户名首字，改走 `displayNameOrNull`。
- **App（App 仓库 6254978，随 app-v2.24.2）**：新增 `ui/components/DisplayName.kt`（`displayNameOrNull`/`displayNameOf`）；`MeScreen` 账号卡显示名 + 头像首字、`ProfileEditScreen` 头像首字同口径；`username` 只用于登录与账号标识。

### 测试

- 站点：`test/sessions.test.js`（会话列表 `displayName` 有昵称/清空回退）、`test/watchlist-user.test.js`（到价提醒 `display_name`）、`test/wishlist-site-only.test.js`（愿望单 `display_name`）、`test/admin-console-ia.test.js`（Steam 日志 `user_display_name`，用户删后回退 username）、`test/profile.test.js`（前端静态锁：各用户列 `display_name || username`、无并列展示、`/api/me` 用 `displayName`）。
- App：`DisplayNameTest` 5 项（有昵称 / trim / 空白回退 / 双空占位 / 不并列）。
- 验证：相关测试与 `node test/api.test.js` 38/38 全绿、`npm run frontend:build` ✅、`npm run scan` ✅、App `assembleRelease` ✅ + 单测 88/88。QA：docs/QA-EJ.md 第 1 轮 ✅ 通过 5/缺失 0/偏差 0/需人工确认 0（两端截图：Web 用户管理/会话/首页 + App「我的」昵称与回退）。

## [2.27.6] - 2026-11-20

CO-5/B4-2 巨石拆分第九轮交付（admin 同步任务域，契约零变化）（技术债重构，无新功能面 → 小版本，2.27.5 → 2.27.6 连续递增）。

### 技术债

- **巨石拆分第九轮（CO-5/B4-2 admin 同步任务域，B4 队列 #9，站点 3997083）**：`src/routes/admin-sync.js`（管理段单入口 13 条路由——`POST /api/admin/sync`、`GET /api/admin/sync/status`、`GET /api/admin/sync/runs`、`POST /api/admin/circuit/reset`、`POST /api/admin/backfill`、`POST /api/admin/backfill/stop`、`GET /api/admin/backfill/status`、`POST /api/admin/heat`、`POST /api/admin/heat/stop`、`GET /api/admin/heat/status`、`POST /api/admin/rename`、`POST /api/admin/rename/stop`、`GET /api/admin/rename/status`）+ `src/store/admin-sync-repository.js`（`listSyncRuns` 唯一专属 SQL 搬家；`insertSyncRun`/`finishSyncRun`/`runningSyncRun`/`markStaleSyncRuns`/`sourceSyncStats` 等跨域共用 SQL 留 `pg.js` + re-export 兼容壳）；`syncState` 持有对象与 `startSteamJob` 闭包按引用共享（「语义共享，勿改成拷贝」注释）；`src/server.js` 净 −205（+59/−264）、`src/store/pg.js` 净 −8（+13/−21）；**外部契约零变化**（路径/参数/响应/错误码不变）。
- 拆分模式见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §15；已交付九域（app/appeal/auth/watchlist/announcements/me/site/admin-access/admin-sync），剩余域继续按 docs/B4-QUEUE.md 队列推进（下一域 #10 admin 系统设置）。

### 调整

- **EH + EI 同步双区域配置化（站点 897476c；构建期间由其实施会话提交并推 main，随本版一并成像）**：新增 `src/sync-regions.js`（`contentRegion`/`baseRegion`/`baseCurrency`/`regionContext` 单点读取——settings 水合后的 env，默认 us / cn / CNY）；后台「系统设置 → 同步区域」三项配置（`sync.contentRegion` / `site.baseRegion` / `site.baseCurrency`，区域两字母/货币三字母校验归一化）；内容链路（`steam-meta`/`steam-status`/`discovery`/`rating-backfill`）统一按内容区请求（默认 us，绕过国区商店隐藏拿全量），价格链路（`steam.js`/`sync steam-prices`/`backfill`/`steamall`）按本位币区域+货币请求（默认 cn/CNY，国区报价口径不变）；`steam-status` 写价门控——仅 content=base 时顺带写本位币 offer，防内容区货币价混进本位币报价；前台查询默认 region 跟随 `baseRegion`（列表/详情/为你推荐/管理提醒清单/价格历史 CSV）；各链路日志带 `regions:{content,base,currency}`。QA：docs/QA-EH-EI.md 第 1 轮 ✅ 放行（9/0/0/2，2 项为上线后覆盖率观察）。规格见 docs/STEAM-SYNC-STATUS-AND-RATING.md §10/§11。

### 测试

- QA（本批 1 块全部放行）：B4-2 第九轮 ✅ docs/QA-CO5-B4-2-admin-sync.md 第 1 轮（14/0/0/1）；需人工确认项为本机沙箱环境限制（`frontend:build` 默认命令被拦，改用 native loader 变体），CI 兜底。
- 站点：`test/sync-runs.test.js` 新增四组静态锁（分支在新文件 / 宿主真实接线 / 旧分支不残留 / re-export 边界判据）+ 反向自检（删 heat/stop 分支实测必红）；`test/source-sync.test.js` 静态断言指向 `src/routes/admin-sync.js`；`admin-cache.test.js`（B2 短缓存+熔断失效）、`api.test.js` 与主链分段回归。

## [2.27.5] - 2026-11-20

EF 18R 数据同步与筛选修复 + EG 公告角标已读修复（均为 🐞 缺陷修复 → 小版本，2.27.4 → 2.27.5 连续递增）。App 仓库同步发布 app-v2.24.0（22400）。

### 修复

- **EF（18R 数据同步与筛选，站点 7a3ac2b + App 358ebc5）**：元数据 `appdetails` 请求 `cc=cn` → `cc=us`（国区商店隐藏成人内容导致 `content_descriptors` 采不到、全库 adult_flag 仅约 20 个）；价格口径调用点保持 `cc=cn` 不变；新增 `rating-backfill` 命令（cc=us 重采分级、只写分级不写价、限速 ≥1s、429 收轮 exit 75、前后 adult/mature 计数日志、断点续跑）+ 并入调度器；前台 `/api/games` 支持 `rating=adult|mature|none`（与后台同口径）；Web 首页 18R 筛选开关（选中 `adult=badge&rating=adult` 只看 18R + 角标、取消恢复全部）；App 18R chip 同步改「筛选」语义。
- **EG（公告角标已读后不消失，站点 7eb5d4a + App 3458bce）**：站点 `GET /api/announcements` 公开段补 Bearer 解析——此前 readIds 只认 Cookie 会话，App 登录用户恒拿空数组，已读标记虽落库但每次刷新/重进/重启角标回跳；匿名仍空数组契约不变。App `AnnouncementsState` 标记纪元守卫——标记已读后晚到的陈旧快照只与内存并集不覆盖、请求期间登录态切换旧快照作废（取代 DZ 的 markInFlight 闩）；经 `AnnouncementsGateway` 缝与网络解耦。

### 测试

- QA（本批 2 条全部放行）：EF ✅ docs/QA-EF.md 第 1 轮（13/0/0/3）/ EG ✅ docs/QA-EG.md 第 1 轮（3/0/0/0）。
- 站点：`test/announcements.test.js` EG 回归（Bearer 标记→GET 回读，修复前实测红→绿）+ 18R/rating 相关（steam-meta/scheduler/api）+ 主链分段 + `api.test.js` + `frontend:build` + `scan`；App：JVM 单测 83/83（`AnnouncementsStateTest` 5 项用可控假网关复现陈旧快照晚到，反向自检并集改直落 → 2 项竞态用例红）+ `assembleRelease` + 模拟器覆盖安装自测（18R 筛选只看 18R / 角标已读归零）。

## [2.27.4] - 2026-11-20

CO-5/B4-2 巨石拆分第七/八轮交付（site 杂项域 + admin 访问安全域，契约零变化）（技术债重构，无新功能面 → 小版本，2.27.3 → 2.27.4 连续递增）。

### 技术债

- **巨石拆分第七轮（CO-5/B4-2 site 杂项域）**：`src/routes/site.js`（预检段 `GET /api/ban/state` + 公开段 `GET /api/site` + 主段 `/api/steam/*` 全 10 条——账号列表/兼容信息/认领/游戏库与同步/愿望单与同步/改别名与自配 API Key/解绑/设默认）+ `src/store/site-repository.js`（setDefaultSteamAccount/clearDefaultSteamIfMatches/userLibraryItems 3 函数搬家 + 域内联 SQL 抽新函数）；`/api/admin/wishlists` 留 #16、`/api/admin/steam-logs` 留 #12；banState 限流桶与 MAX_ACCOUNTS_PER_USER 消费方随域迁入（语义共享注释）；`src/server.js` 净 −243、`src/store/pg.js` 净 −50；**外部契约零变化**。
- **巨石拆分第八轮（CO-5/B4-2 admin 访问安全域）**：`src/routes/admin-access.js`（管理段单入口 20 条路由——views / visitors 与 by-ip / blacklist / whitelist / abuse / devices + device-bans / reviews 审批四操作）+ `src/store/admin-access-repository.js`（15 函数搬家 + 域内联 SQL 抽 4 新函数）；封禁拦截链/黑名单加载等中间件留 server.js（§15.4 中间件 ≠ 路由）；跨域共用 SQL（listBlockedIps/insertDeviceLog 等）留 pg.js；`src/server.js` 净 −285、`src/store/pg.js` 净 −199。
- 拆分模式见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §15；已交付 app/appeal/auth/watchlist/announcements/me/site/admin-access 八域；剩余域继续按 docs/B4-QUEUE.md 队列推进（下一域 #9 admin 同步任务）。

### 测试

- QA（本批 2 块全部放行）：B4-2 第七轮 ✅ docs/QA-CO5-B4-2-site.md 第 1 轮（18/0/0/2）、第八轮 ✅ docs/QA-CO5-B4-2-admin-access.md 第 1 轮（20/0/0/1）；需人工确认项均为本机沙箱环境限制（commit-own 测试 spawn EPERM、frontend:build 默认命令被拦），CI 兜底。

## [2.27.3] - 2026-11-20

CO-5/B4-2 巨石拆分第四/五/六轮交付（watchlist/wishlist + announcements + me 三域，契约零变化）（技术债重构，无新功能面 → 小版本，2.27.2 → 2.27.3 连续递增）。

### 技术债

- **巨石拆分第四轮（CO-5/B4-2 watchlist/wishlist 域）**：`src/routes/watchlist.js`（用户段 6 条路由——`GET/POST /api/watchlist`、`DELETE /api/watchlist/:gameId`、`POST /api/wishlist`、`DELETE /api/wishlist/:appid`、`DELETE /api/wishlist/id/:gameId`）+ `src/store/watchlist-repository.js`（upsertUserWatch/deleteUserWatch/listUserWatches 签名照抄；域内联 SQL 抽新函数）；admin 段/steam-accounts 段留 server.js（B4 #16/#7）；`watchUserFails` 限流 Map 只被本域使用、随域移入（语义共享注释）；`src/server.js` 净 −53、`src/store/pg.js` 净 −33；**外部契约零变化**。
- **巨石拆分第五轮（CO-5/B4-2 announcements 域）**：`src/routes/announcements.js`（公开段 `GET /api/announcements` + 主段 `POST /api/announcements/read` + 管理段 `GET/POST /api/admin/announcements` + `PATCH|PUT/DELETE /api/admin/announcements/:id`，首个「公开段 + 主段 + 管理段」三段域）+ `src/store/announcements-repository.js`（CRUD 4 函数签名不变 + 域内联 SQL 抽 3 新函数）；`/api/admin/bulk` 派发表 announcements 三条目留 #11；announcements 表 DDL 跨域共用留 pg.js；`src/server.js` 净 −65、`src/store/pg.js` 净 −22。
- **巨石拆分第六轮（CO-5/B4-2 me 域）**：`src/routes/me.js`（`GET /api/me`、`POST /api/prefs`、`GET /api/avatar/:userId`、`PATCH /api/me/profile`、`POST|DELETE /api/me/avatar`、`GET /api/me/library`）+ `src/store/me-repository.js`；`/api/me/email/*` 与 `/api/auth/email*` 同属 auth-routes.js 模块（DT-2 排除区）整块留原地不拆半截；setDefaultSteamAccount/clearDefaultSteamIfMatches/userLibraryItems 与 user_prefs DDL 跨域共用留 pg.js；`src/server.js` 净 −201、`src/store/pg.js` 净 −110。
- 拆分模式见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §15；已交付 app/appeal/auth/watchlist/announcements/me 六域；剩余域继续按 docs/B4-QUEUE.md 队列推进。

### 测试

- QA（本批 3 块全部放行）：B4-2 第四轮 ✅ docs/QA-CO5-B4-2-watchlist.md 第 1 轮（10/0/0/2）、第五轮 ✅ docs/QA-CO5-B4-2-announcements.md 第 1 轮（16/0/0/2）、第六轮 ✅ docs/QA-CO5-B4-2-me.md 第 1 轮（17/0/0/2）；需人工确认项均为本机沙箱环境限制（commit-own 测试 spawn EPERM、frontend:build 默认命令被拦），CI 兜底。

## [2.27.2] - 2026-11-19

CO-5/B4-2 巨石拆分第三轮交付（认证域，契约零变化）（技术债重构，无新功能面 → 小版本，2.27.1 → 2.27.2 连续递增）。

### 技术债

- **巨石拆分第三轮（CO-5/B4-2 认证域）**：`src/routes/auth.js`（认证域 8 条路由——公开段 `POST /api/device` + 主段 `GET /api/captcha`、`POST /api/login`、`POST /api/password/check`、`POST /api/logout`、`POST /api/user/password`、`GET /api/auth/steam/start`、`GET /api/auth/steam/callback`）+ `src/store/auth-repository.js`（登录失败计数/锁定/改密/Steam 绑定 10 个 SQL 新函数）；`src/store/pg.js` re-export 兼容壳；`src/server.js` 认证区换为两入口接线（`loginIpFails`/`appealBucketLimited`/`bindStates` 共享状态留宿主）；**外部契约零变化**（路径/参数/响应/错误码不变）。已交付 app/appeal/auth 三域；剩余域拆分继续按 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §15 与 docs/B4-QUEUE.md 队列推进。

### 测试

- QA：B4-2 ✅ docs/QA-CO5-B4-2.md 第 1 轮（16/0/0/1）。

## [2.27.1] - 2026-11-19

CO-4/B4 巨石拆分两域交付（试点 App 域 + 第二轮申诉域，契约零变化）+ DW 搜索关键词参数位错位修复（技术债重构 + 缺陷修复，无新功能面 → 小版本，2.27.0 → 2.27.1 连续递增）。

### 修复

- **搜索关键词参数位错位（DW，P0）**：`src/store/pg.js` `gameSearch` 关键词归一化拆两个显式变量——`kwNormCandidate`（`$1`=kw，仅供候选探测 SQL 与 `fuzzyCandidateIds`，绑定 `[kw, …]`）与 `kwNorm`（`$2`=kw，主查询 count/rows/排序，绑定 `filterParams=[region, kw, …]`），注释约束两者不可互换（互换 = 精确名 LIKE 匹配 cap/42P18，新测试必红）；`filterParams` 顺序不变、候选查询绑定不变、其它搜索逻辑不动。新增 `test/game-search-exact.test.js` 进主链 test:3（无 `search_tokens` 游戏精确名命中「侠盗猎车手」/「Grand Theft Auto V」、搜索不因 region 值命中、`gta5/gta6/xdlc6/grand theft auto` 回归、`zzz不存在词`/`cn` 零命中；注入错位（表达式与绑定参数位不一致）反向自检必红后转绿）。

### 技术债

- **巨石拆分两域（CO-4/B4）**：试点 App 域 `src/routes/app.js`（App 域 6 条路由——`GET /api/app/status` 预检段 + `/api/auth/token`、`/api/auth/token/revoke`、`/api/app/latest`、`/api/admin/app-sync/status`、`/api/admin/app-sync` 主段）+ `src/store/app-repository.js`（`api_tokens` DDL + 4 个 token 函数）；第二轮申诉域 `src/routes/appeal.js`（申诉域 5 条路由——公开段 `/api/appeal`、`/api/appeal/:code`、`/api/appeal/action` + 管理段 `/api/admin/appeals`、`/api/admin/appeals/:id/resolve`）+ `src/store/appeal-repository.js`（`appeals` DDL + 12 个申诉 SQL 函数）；`src/store/pg.js` 两域 re-export 兼容壳；`src/server.js` 试点 -216 行、第二轮再 -267 行（域路由换为入口接线，appealExempt 豁免与限流桶等中间件留原地）；**外部契约零变化**（路径/参数/响应/错误码不变）。已交付 app/appeal 两域；剩余 ~18 个域拆分另行立项（B4-2/CO-5）。拆分模式见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §15。

### 测试

- QA（本批 2 块全部放行）：B4 ✅ docs/QA-CO4-B4.md 第 1/2 轮（16/0/0/1）、DW ✅ docs/QA-DW.md 第 1 轮（6/0/0/1）。

## [2.27.0] - 2026-11-19

DP + DQ + DN + DR + DS + DL 合并发版：e2e 浏览器 Edge → Chrome、个人资料页打磨（头像与 Steam 账号解耦，Web + App）、对齐审核内容词 SKU 默认归档、App 发版后即刻可更新（后台立即同步）、搜索全自动派生（缩写/罗马数字/拼音，零人工）、对齐审核快照落库（含新功能面 → 大版本，2.26.0 → 2.27.0）。App 仓库同步发布 app-v2.22.0（22200）。

### 新增

- **e2e 浏览器 Edge → Chrome（DP）**：`test/e2e` 默认浏览器探测顺序 Program Files Chrome → Program Files (x86) Chrome → PATH chrome → 最后回退 Edge 并提示；launchChrome/CDP 逻辑不变、日志文案改；预检/报告「Node / 浏览器」显示实际浏览器；PDF 打印（CDP 优先 + 独立进程兜底）走 Chrome；e2e:smoke Chrome 实测 7/8（admin-login 行失败为 CX 批 UserAvatar 既有 avatar 404，非本批引入）。
- **个人资料页打磨（DQ，Web + App）**：`users.default_steam_id` 列 + 迁移（回填自 `avatar_source`、清空 `steam:%` 来源）——设为默认/解绑只改 `default_steam_id`、头像不变；头像规则统一：只有 custom 走 `/api/avatar`，否则昵称首字母/首字 + 品牌色（Web/App 同一 `avatarInitial` 口径）；资料页去「从 Steam 选头像」入口、账号卡两行等宽按钮（窄屏不竖排）、统计三项卡片（合计入标题行）、开关副说明「降价时发邮件提醒」；App ProfileEditScreen/MeScreen 同套布局。
- **对齐审核内容词 SKU 默认归档（DN）**：季票/服装/DLC 等内容词 SKU（含杉果自定义命名）自动归档为 ignored（`method=content_word`）——不进待对齐队列、不占「待对齐组」计数；本体 SKU 不受影响；「已忽略」chip 计数含内容词归档并注明「内容词自动归档」、已忽略视图标注并可恢复（误判经恢复回队）。
- **App 发版后即刻可更新（DR，站点 + App）**：`POST /api/admin/app-sync`（requireAdmin + single-flight + 审计 `admin.app_sync` + 日志 `app.sync_manual`）+ 运行与同步页「App 版本卡」（当前版本/上次同步时间/失败原因/「立即同步」按钮，8 秒轮询）；`APP_RELEASE_SYNC_INTERVAL_MIN` 默认 60→15 + settings 项 `app.syncIntervalMin`（页面可改、保存热加载）；App `THROTTLE_MS` 24h→1h（启动/回前台；手动检查不节流不写时间）——安卓构建完成后点「立即同步」数十秒内手机即可见更新提示，不点则 15 分钟自动同步兜底。
- **搜索全自动派生（DS）**：`games.search_tokens text[]` + GIN 索引（纯派生数据、全部算法生成、可全量重建，零人工）：归一化/去重音/字母数字汉字 token 拆/缩写跳虚词/罗马数字 I–XII↔阿拉伯 1–12 双向/拼音全拼+首字母+数字组合（上限 40 条，存储与查询用同一函数）；写入路径（upsertGameMeta/ensureGame）顺带生成 + 定时任务 search-tokens-rebuild（每 6 小时增量 ≤5 万行）+ CLI `search-tokens --full`；gameKeywordSql 加 token 源（数组重叠 + 子串兼容）；gameSearch 三级排序（原名/中文名 0 > token/平台别名 1 > 模糊 2）+ 零命中 pg_trgm 模糊兜底（name 臂 0.4 / token 臂 0.6）+ `search.miss` 零命中日志（只记日志不建人工映射）——gta6 / xdlc6 / portal ii 均可命中。
- **对齐审核快照落库（DL）**：`align_snapshots` 表（payload/counts/signature/generated_at/generated_ms/dirty/last_action_at/error，保留最近 5 条）+ 数据签名动态失效（skus.json size+mtime、games count+max(updated_at)、gsm count+max(reviewed_at)；签名不变直接用库快照，24h 强制重算兜底）；新调度任务 `align-snapshot`（默认每 30 分钟、首轮延迟 30 秒）+ CLI `align-snapshot`（runSyncTracked 留痕）；`GET /api/admin/align` 只读库快照（无快照 202 firstRun、`?refresh=1` 后台重算不阻塞）；确认/忽略/恢复同事务更新快照——读请求立即拿到新队列，彻底消除「确认后旧列表还要再审」；废弃内存缓存 invalidate/staleCache 语义；前端只读快照 + 首次生成横幅 + 乐观移除 + counts 即时更新。

### 测试

- 本批相关测试进主链：`test/search-derive.test.js`/`test/game-search-alias.test.js`（DS）、`test/align-snapshot.test.js`（DL，test:3）、`test/profile.test.js`（DQ，test:4）、`test/align.test.js`/`test/align-perf.test.js`（DN 用例 + 反向自检）、`test/api.test.js`（DR 两用例：权限 401/403 + single-flight + 落盘 + 卡片一致 + 失败 502 reason；DN/DL 运行时用例）、`test/settings.test.js`/`test/scheduler.test.js`/`test/app-release-sync.test.js`/`test/http-guard.test.js`（DR 默认 15 与豁免断言）。
- QA（本批 6 块全部放行）：DP ✅ [docs/QA-DP.md] 第 1 轮（4/0/0/0）、DQ ✅ [docs/QA-DQ.md] 第 1 轮（9/0/0/3）、DN ✅ [docs/QA-DN.md] 第 1 轮（10/0/0/1）、DR ✅ [docs/QA-DR.md] 第 1 轮（8/0/0/2）、DS ✅ [docs/QA-DS.md] 第 1 轮（5/0/0/3）、DL ✅ [docs/QA-DL.md] 第 1 轮（9/0/0/0）。

## [2.26.0] - 2026-11-19

CU 四项 + DF + CO-4/D4 + CO-4/D6 + CO-4/E4 合并发版：到价提醒治理（无报价徽标 / 站点级迁移 / 史低抽检 / 刷新频率评估）、到价提醒手动推送、移动/桌面双结构渐进合并、覆盖率与性能基线门禁、日志统一字段规范（含新功能面 CU-2 迁移与 DF 手动推送 → 大版本）。

### 新增

- **到价提醒「无报价」徽标与筛选（CU-1）**：后台「到价提醒」列表对无任何在售报价（官方+授权渠道、CN 区、在售，与 `current_cents` 同口径）的提醒行显示「无报价」徽标（悬停说明「无在售报价时不触发提醒」）+ 状态筛选（`GET /api/admin/watchlist?status=no_price`，count 与列表同条件），无报价行永不触发。
- **站点级提醒按 Steam 愿望单反查与迁移（CU-2）**：列表行带 `claimableUsers`（`steam_wishlist` → `steam_accounts.user_id` 反查，多用户全列、同用户多账号去重）；行内/批量「迁移给用户」（`POST /api/admin/watchlist/migrate`——站点级行 `user_id` NULL→目标用户，目标已有同游戏用户级行则合并删站点级行，邮件发该用户邮箱）；批量删除站点级（`POST /api/admin/watchlist/delete`）；审计 `admin.watch_migrated` / `admin.watch_deleted`。
- **到价提醒手动推送（DF）**：后台每行「推送」→ 确认弹窗（游戏/用户/当前价/史低/上次提醒/渠道）→ 立即发送；**强制推送**（未达条件也发，文案标注手动推送）与**更新最近提醒时间**（mark 默认勾选）两个选项；批量「推送选中」合并一封邮件（正文列出全部命中游戏）+ 逐条结果；单条 `POST /api/admin/watchlist/:id/push` 与批量 `POST /api/admin/watchlist/push`；5 分钟内存频控（429 带 retryAfterSec）；无通道按钮禁用；用户级提醒不可推（403 + `admin.forbidden_write`）；审计 `admin.alert_pushed`（sent/not_met/rate_limited 全落）。
- **CU-3 史低抽检 / CU-4 刷新频率评估（分析类，无代码）**：结论落规格 §6/§7 附录（异常样本判定 SQL + daily_prices 明细 SQL + 结论清单——部落幸存者 ¥20.25 确认真实促销史低；720/480 配额数字与建议——720 可接受 / 480 不推荐），未改任何配置。

### 技术债

- **移动/桌面双结构渐进合并（CO-4/D4）**：Home.vue 两套 v-if 分支（游戏卡片/到价提醒列表/结果行/骨架/空态/分页）合并为单一共享列表区（卡片同 DOM 双态 class + `desktop-only`/`mobile-only` 显隐），v-if 77→38 行；`isMobile` 断点判定未动；桌面 1280×900 与移动 390×844 四态截图前后像素对比零视觉差异。
- **覆盖率/性能基线门禁（CO-4/D6）**：新增 `scripts/baseline-gate.mjs`（coverage/perf/e2e 三模式——主链覆盖率阈值 + 关键查询 P95 散点 + e2e 发版报告联动，阈值 env 可调宽松防误报）；docker-hub / docker-tcr 两个 workflow 的 test job 挂门禁；`test/baseline-gate.test.js` 5 项进主链（含判定反向自检）。
- **日志统一字段规范（CO-4/E4）**：scheduler / adapter / ingest 三个试点域失败事件统一 `reason/url/status`（`failFields` 自动提取 + 域白名单）；任务失败/熔断事件补 reason；单轮入库解析/失败超阈值（max(5, ⌈总数×50%⌉)）记 error 级聚合告警（阈值设置页可调）；[docs/LOGGING-SCHEMA.md](docs/LOGGING-SCHEMA.md) 字段规范与告警阈值表成文 + `test/log-schema.test.js` 事件名快照锁。

### 测试

- 本批相关测试进主链：`test/watchlist-noprice.test.js`（CU-1，test:2）、`test/watchlist-migrate.test.js`（CU-2，test:2）、`test/alert-push.test.js`（DF，9 项，test:2）、`test/baseline-gate.test.js`（D6，5 项，test:3）、`test/log-schema.test.js`（E4，test:1）。
- QA（本批 8 块全部放行）：CU-1 ✅ [docs/QA-CU1.md] 第 2 轮（3/0/0/1）、CU-2 ✅ [docs/QA-CU2.md]（5/0/0/2）、CU-3 ✅ [docs/QA-CU3.md]（4/0/0/2）、CU-4 ✅ [docs/QA-CU4.md]（4/0/0/1）、DF ✅ [docs/QA-DF.md] 第 1 轮（9/0/0/2）、D4 ✅ [docs/QA-D4.md] 第 1 轮、D6 ✅ [docs/QA-D6.md] 第 1 轮、E4 ✅ [docs/QA-CO4-E4.md]（4/0/0/1）。

## [2.25.0] - 2026-11-19

CO-1/A3 + CO-2/B3 + CQ + CW + CX + CY + CZ + DA + DC + DH + DK 合并发版：系统设置信息架构、后台游戏详情弹窗、个人资料编辑、用户数据隔离、更换登录邮箱、App 筛选服务端化、App 公告、对齐审核数据完整性、App 更新失败修复、双真相源收敛与任务预算实测化（含新功能条目 → 大版本）。App 仓库同步发布 app-v2.21.0。

### 新增

- **系统设置信息架构重构（CQ）**：数据源按 6 张平台卡渲染（每卡常用 ≤3 项、其余进「高级 N 项」折叠默认收起、标题行带摘要）；站点常用 4 项 + 「推荐与评分」折叠；高级拆 4 折叠组；只看非默认（刷新保持）、来源标注三类（数据库/环境变量/默认）、恢复默认（单行/分组、二次确认）、搜索命中折叠项自动展开高亮；不改任何 key/默认值/语义；移动端单列。
- **后台「游戏目录」点游戏名弹详情（CW）**：640px 弹窗（封面/中英名/AppID/同步与分级徽标/发售·开发商·发行商·类型·平台·分级/价格条/简介 4 行可展开/DLC 数与 Steam 评测数 + 底部固定「在 Steam 商店查看」新窗口）；未同步/无 appid/回收站三态兜底；移动端 100% 宽；数据只用站内已同步 Steam 数据（不实时请求）。
- **个人资料编辑（CX，Web + App）**：管理员与普通用户同一套页面与接口、只能改自己；头像存库（客户端裁剪 256×256、`GET /api/avatar/:userId` 输出、默认头像 = 已绑 Steam 账号（多账号可选其一）或自定义上传、无头像回退首字）；昵称（2–20）/简介（≤200）/主题/邮件提醒开关可编辑，用户名/邮箱/角色只读；Steam 账号卡（设为默认/解绑保留历史/新增绑定）；其它页面有头像处显示头像；App 端同样支持（新增绑定在浏览器打开）。
- **数据隔离（CY）**：用户私有数据（提醒/愿望单/访问记录/Steam 绑定）管理员只读——越权写 403 + `audit_logs` 审计 `admin.forbidden_write`；站点级提醒、账号安全（封禁/会话/设备）、申诉处理、内容审核、未归属账号认领保留可写；用户级接口忽略请求里的 `userId`；前端用户行隐藏操作按钮并标「只读」。
- **更换登录邮箱（CZ，Web + App）**：`POST /api/me/email/request|verify`——不泄露占用（已占用静默跳过发码）、验证码通过后才提示 409；成功更新邮箱并删全部会话 + 撤销全部 App token（当前请求后续 401 → 跳登录）；审计 `auth.email_changed` + 双邮件（旧邮箱「登录邮箱已变更」+ 新邮箱「绑定成功」）；验证码 10 分钟/5 次、24h 最多 1 次、未验证也能换（换完变已验证）；管理员重置邮箱保留（审计 `admin.email_reset`）；Web 资料页两步对话框 + App 底部弹层两步（成功清 token 跳登录）。
- **App 筛选/排序服务端化（DA，站点 + App）**：`/api/games` 新增 `discountOnly / histLowOnly / freeOnly / unreleased`（4 开关互斥，优先级 unreleased > freeOnly > histLowOnly > discountOnly，count 与列表同条件）+ `sort=heat|release`；删除死字段 `user_prefs.only_discount`（迁移 drop 列）；`/api/me` 增 `steamBound`；App chip 全部服务端筛选 + 分页重置、「已拥有」chip 复用 `owned=only`（仅登录+已绑定 Steam 显示）；Web 复用同参数保证口径一致。
- **App 公告角标与公告列表（DC，纯 App 端）**：首页右上角铃铛 + 「我的」里的「公告」入口；未读角标（0 隐藏）→ 公告列表弹层（标题/级别色点/时间/已读态）→ 点开详情；进入/点击后上报已读、下拉刷新；游客可看公告、已读存本地（重启保留，登录后与服务端合并）。
- **对齐审核数据完整性（DH）**：继承缺口——`applyMapInheritance` 同时参考 `skus.json` 已有 appid（有则不入队、库无映射自动补写 + 日志 `align.map_backfilled`）；「已忽略」视图 + 二次确认恢复为待处理（审计 `align.restored`）；每组显示最近处理（操作人/时间/动作）+ 审阅记录抽屉；确认弹窗对孤儿行合并提示。

### 修复

- **App 检查更新失败（DK）**：`/api/app/latest` 的 apkPath 在本地 `data/app` 与镜像都无 APK 时兜底 GitHub Release 直链（不再 null）；App 端下载地址不可用单独提示「新版下载地址暂不可用，请到站点 /app 页下载」、不再笼统报「检查更新失败」（`UpdateManager.decideUpdate` 纯函数 → Unavailable/Failed 两分支）；`apk_download` 失败带 `apkFailed` 标记、`cmdAppSync` 抛错 → 任务健康条显红（A5 接线）；same_version 跳过加 APK 存在性检查（APK 缺失重新下载补齐，每小时自愈）。

### 技术债

- **双真相源收敛（CO-1/A3）**：对齐映射以 `game_source_map` 为唯一真相，match/confirm 全路径删除 `skus.json` 写回（`skus.json` 降为只读兼容、仅旧数据回落）；同步读路径统一「库优先、文件回落」口径（confirmed 才参与解析）。
- **任务预算实测化（CO-2/B3）**：Steam 每日配额预算从理论常数改 `sync_runs` 实测耗时（每 mode 平均秒 × 每日轮数；样本不足/非法值回落理论值）；任务卡「耗时」列显示实际与估算差（估算优先实测、无实测标「理论」、超估算标黄）。

### 测试

- 主链补齐 `test/isolation.test.js`（CY 核心安全断言，A/B 两用户 + 管理员三视角）注册进 test:4（审计 2026-11-19 §③遗漏 1）。
- QA（全部第 1 轮放行，另注轮次）：CO-1/A3 ✅ [docs/QA-CO1-A3.md]（25/0/0/0）、CO-2/B3 ✅ [docs/QA-CO2-B3.md]（15/0/0/1）、CQ ✅ [docs/QA-CQ.md] 第 3 轮（9/0/0/2）、CW ✅ [docs/QA-CW.md]（11/0/0/2）、CX ✅ [docs/QA-CX.md]（14/0/0/1）、CY ✅ [docs/QA-CY.md]（6/0/0/0）、CZ ✅ [docs/QA-CZ.md]（11/0/0/2）、DA ✅ [docs/QA-DA.md]（6/0/0/2）、DC ✅ [docs/QA-DC.md]、DH ✅ [docs/QA-DH.md] 第 2 轮、DK ✅ [docs/QA-DK.md]（6/0/0/2）；另 2026-11-19 多会话并行审计 [docs/AUDIT-2026-11-19.md] 确认改坏项已全部恢复。

## [2.24.5] - 2026-11-18

DG + DI + DJ + CO-1/A5 + CO-2/B5 + CO-4/D1 合并发版：对齐匹配修复、测试环境隔离与主链分段、e2e 整轮总预算与独立报告流程、同步任务失败可见、读模型双写守卫、设计 token 收敛（无新功能面 → 小版本）。

### 修复

- **对齐匹配修复（DG）**：候选索引默认字段补 DB 蛇形列 `name_en`（修复 `buildCandidateIndex(games)` 漏索引英文名导致候选分数低于阈值被丢弃）；**副标题感知**——按 `：: - — /` 切主标题，主标题精确/包含命中时给 0.90–0.93 分 + 理由 `subtitle`（落在「需人工」区，不自动确认），修「断箭: 俄罗斯国民近卫军」等副标题/别名拉低整串相似度 → 无候选的问题；季票/DLC 等内容词仍不自动确认。
- **同步任务失败可见（CO-1/A5）**：任务失败不再只落日志——「运行与同步」任务健康条显红并显示失败原因（优先 `sync_runs` 里的真实原因，取不到回退退出码）；`app-release-sync` 失败不再静默（真失败抛错 → 健康条显红；同版本/无新 Release 仍算正常跳过）；可选「任务失败邮件告警」（`alerts.jobFailureEmail` 默认关，开启后失败发信给告警收件人，复用提醒邮件 SMTP）。

### 测试

- **测试环境隔离与主链分段（DI）**：`test/serve.test.js` 的 CJ-回归用例注入 `APP_DATA_DIR` 临时目录，不再读工作区 `data/` 运行时产物（CO-3 会话被 `data/app/latest.json` 干扰整链红的根因根治，含反向自检）；主链 `npm test` 拆 `test:1`~`test:4` 四段逐段串行，中断从失败段 `npm run test:N` 续跑；新增 `npm run test:reset` 白名单复位脚本（默认 dry-run、`--apply` 移出、`--restore` 移回，备份到仓库外，源数据与 `*pgdata*` 永不入选）。
- **e2e 整轮总预算 + 独立报告流程（DJ）**：`test/e2e/runner.mjs` 整轮默认 20 分钟 deadline（`E2E_BUDGET_MS` / `--budget-ms=` 可调），到点强制收尾——剩余未跑项标「预算截断」、照常生成 HTML/PDF 报告、退出码三态（0 全绿 / 1 有失败 / 2 预算截断）；预算纯函数单测进主链 test:4；发版后 e2e 全量由独立报告会话执行（`steamdeals-test` §2.3，报告 PDF 落仓库外 `F:\dsh\e2e-reports\`），不再阻塞构建。

### 技术债

- **读模型双写一致性守卫（CO-2/B5）**：快照写入唯一网关 `snapshotWrite`（全部 INSERT/UPDATE/DELETE 收敛，绕过直写即被静态锁拦下）；对账变更优先（底层比快照新的疑似陈旧行先查、随机补齐兜底）；每日 readmodel 任务带 `--fix` 自动修复，手动 `readmodel check` 默认仍只报告。
- **设计 token 收敛（CO-4/D1）**：`main.css` 新增间距/圆角/字号/层级四族 CSS 变量（值 1:1 取自组件现有高频值），Home/AdminModules/AdminExtras 三个样式体量最大的组件 372 处裸 px 按 token 引用 + 重复规则合并 22 条；规则 426→404、声明 889→872；headless Edge 前后截图像素对比视觉零变化（负值保留字面量，`-var(--x)` 前缀负号陷阱已静态锁）。

## [2.24.4] - 2026-11-18

CP + CT + CO-2（B1/B2）+ CO-3（C2/C4/C5）+ DE 合并发版：手机识别、App 同步修复、请求治理与后台提速、App 接口设备限流与契约守卫、对齐审核页改版。

### 修复

- **手机端识别增强（CP）**：服务端三信号判定——UA 品牌特征（MiuiBrowser/HuaweiBrowser/VivoBrowser/HeyTapBrowser/OppoBrowser）+ `Sec-CH-UA-Mobile: ?1` + 纯桌面 UA 排除；`index.html` 内联 `screen.width <= 640` 兜底跳转（`sessionStorage('mred')` 防循环）。修复小米浏览器「桌面版网站」模式伪装桌面 UA 导致手机打不开下载页的漏判；豁免列表（console/login/register/app/banned/appeal/setup/change-password 与 /api/*）不变，PC/平板永不跳。
- **app-release-sync 404（CT）**：`/releases/latest` 对该 release 返回 404 → 改走 `GET /repos/{repo}/releases?per_page=10` 取第一条非 draft/prerelease（latest 仅兜底）；仓库已公开，token 可选；失败日志区分 `app.sync_http_404` / `app.sync_no_release` / `app.sync_no_assets`。
- **统一请求超时 + 重型接口并发闸（CO-2/B1）**：统一 15s 看门狗（超时 503 + `http.request_timeout` 日志，长连接白名单豁免静态资源/图片代理/APK 下载/静态曲线页/CSV 导出/手动备份）+ `HEAVY_GATE_CONFIG` 并发闸（admin 游戏列表/对齐 ≤1、公开搜索 GET+POST 共用 ≤2），排队满/超时 503，超时与闸门均有日志可观测。
- **admin 列表接口提速（CO-2/B2）**：`/api/admin/games` 排序走有序索引（`idx_games_updated`）、存活计数走部分索引（`idx_games_live`）、`/sync/status` lateral join 走 `idx_fetch_runs_platform_started` + 两端点 3s 短缓存（写操作立即失效）；返回契约逐字段不变；本地 pglite 60k 合成数据实测列表 SQL -94%。
- **App 接口设备维度限流（CO-3/C2）**：`/api/app/*` 保持封禁/黑名单豁免，新增以 `X-Device-Id` 为键的独立滑动窗口限流（超限 429 + `Retry-After`，不封禁，审计 `app.device_rate_limited`；设置 `app.deviceRateMax`/`app.deviceRateWindowSec` 热加载）。
- **日期/金额统一 helper（CO-3/C4）**：后端 `src/format.js`（`formatMoney`/`formatDay`/`formatDateTime` 等）+ 前端 `utils/money.js`、`siteTime.fmtDay`，全仓散落 `/100` 与手拼日期收敛，行为不变、调用方签名不变。
- **对齐审核页改版（DE）**：头部状态徽标 + 生成时间 / 5 统计卡 / 生成中进度条（total 分组后立即上报，不再 0/0，可先用旧结果）/ 搜索 + 5 筛选 chip / 批量确认·忽略（二次确认 + 审计）/ 分数色条 + 建议徽标 + 明细展开面板 / 前端筛选分页 / 空态互斥（仅「已完成且 0 组」）；接口 202 补 `total`+`cachedRows`（stale 旧结果分页）+`failed/error`、200 补 `counts`、预览/确认/忽略支持批量 `keys`（≤200、逐组回执）。

### 测试

- 新增 `test/app-release.test.js`（6 项）、`test/http-guard.test.js`（7 项）、`test/admin-cache.test.js`（3 项）、`test/app-device-ratelimit.test.js`（4 项）、`test/format.test.js`（8 项）、`test/money-format.test.js`（5 项）、`test/app-contract.test.js`（APP-API 契约逐字段守卫）进主链；`test/align-perf.test.js`（+6 项 stale/失败态/onGrouped/topN/counts/ignoredGroups）、`test/align.test.js`、`test/api.test.js`（B1 并发闸 HTTP 级用例 + DE 202 轮询全流程）扩展；CP 四组 UA HTTP 用例与前后端豁免一致断言。
- QA：CP/CT/CO-2 ✅ docs/QA-CP-CT-CO2.md 第 1 轮（通过 15/需人工确认 2：红米真机 + 线上四组 UA，部署后）；CO-3 ✅ docs/QA-CO3.md 第 1 轮（放行）；DE ⚠️ 有条件放行 docs/QA-DE.md 第 1 轮（通过 7/偏差 1 已修/需人工确认 1：移动端目视，部署后）。

## [2.24.3] - 2026-11-18

P0 双修：对齐审核后台生成（不再队列恒空）+ 所有查询不排除已拥有（App 不再搜不到自己的游戏）。

### 修复

- **对齐审核后台生成（CS）**：冷缓存时 `GET /api/admin/align` 返回 `202 {generating, processed, total}`（前端 3s 轮询，完成后自动展示完整队列）——修复 v2.24.1/2.24.2 上线后「页面能打开但队列恒空」的 P0（根因：20s 预算计时起点含前处理，前处理超 20s 后匹配循环第一次检查即截断为空）。预算语义修正：`startedAt` 移到匹配循环开始前，后台计算算完为止（setImmediate 分片保证不阻塞事件循环），不再返回 partial 空结果；文案改「后台生成中（已处理 X/Y 组），完成后自动刷新」。`db.slow_query` 增加 `eventLoopLagMs` 观测（setImmediate 往返），区分 DB 时间与事件循环阻塞，防止再次误判为 DB 慢。
- **所有查询不排除已拥有（CV）**：Web「全部/感兴趣/不感兴趣」列表与搜索显式传 `owned=include`（「已拥有」页签保持 only；服务端默认口径不变）；已拥有游戏显示 Steam 账号名徽标（前 2 个 +N）。App 同步：首页/搜索请求带 `owned=include`、卡片「已拥有 · 账号名」徽标、详情终态只留「去 Steam 购买」+ 标题下账号名（消费 `/api/games/:appid` 的 `owned_by`）。修复「安卓 App 搜索已拥有游戏 → 暂无数据」的 P0 体验事故。

### 测试

- `test/align-perf.test.js` 16 项（新增 CS 后台生成/进度上报/refresh 重算用例 + 反向自检）；`test/api.test.js` 28 项（新增 CV include/exclude/详情 owned_by 用例，CD 对齐审核用例适配 202 轮询模型）；App JVM 单测 23 项（新增 `OwnedByTextTest` 5 项）。HTTP 冒烟：CS 202→轮询 555ms 就绪→缓存 5ms→重算期间 count/site 并发 200；CV include/exclude 语义正确。

## [2.24.2] - 2026-11-18

CR 迁移 22P02 线上事故热修：v2.24.1 升级后 bootstrap 崩溃重启循环。

### 修复

- **迁移清洗不再解析 JSON**：CR 历史脏元素清洗从 `::jsonb ->> 'name'` 改为纯正则提取 `"name":"…"`——生产存在 `{CRYTIME}`、`{COMPANY_NAME_GOES_HERE}` 这类以 `{` 开头但非 JSON 的占位符元素，旧实现把它们送进 `::jsonb` 抛 `invalid input syntax for type json (22P02)`，bootstrap 失败 → 容器重启循环。现在任何元素都不再抛错：合法 JSON 对象提取 name、非法/截断元素丢弃、占位符与纯文本原样保留。
- **幂等稳定**：WHERE 从「元素以 `{` 开头」收紧为「元素含 `"name":` 特征」——清洗产物（name 值本身含花括号）不会再被二次误解析；无脏行时二次迁移无变化。
- 回归测试：`test/dev-publisher-names.test.js` 新增事故形态夹具（合法/截断/无引号键/空对象/花括号名/转义引号/占位符 + 二次幂等断言）；反向自检（换回 `::jsonb` 用例必红，pglite 复现 22P02 语义）。

## [2.24.1] - 2026-11-17

对齐审核查询拖垮站点（CN）：P0 事故热修——把「每次请求全量重算 19.6 万行」改为「后台计算 + 缓存读」。

### 修复

- **对齐审核结果缓存（TTL 10 分钟）+ single-flight**：`src/align-query.js`（新增 `createAlignRunner`）——并发请求共享同一个计算 Promise（并发 5 次只算 1 次）；`?refresh=1` 强制重算；confirm/ignore 修改队列后自动失效。缓存命中实测 7ms（验收 ≤200ms）；runner 定义在 `createApiServer` 实例级（跨请求共享）。
- **候选预筛**：`src/match.js`（`buildCandidateIndex`/`indexTokens`/`preselectCandidates`）——归一化全等快路径 + 信息 token 召回、共享数降序截断 ≤2000；「组数 × 19.6 万」降到「组数 × ≤2000」。口径零变化：CE 13 条误匹配仍不进提案、正确样例仍命中（与 `test/match.test.js` 同源锁定）。
- **匹配循环分片 + 20s 时间预算**：`src/align.js`（`proposeAlignGroupsBudgeted`）每 200 组 `setImmediate` 让出事件循环（计算期间 `/api/games/count`、`/api/site` 不被阻塞）；超时返回 `partial:true` 与已算部分，不 5xx。`proposeAlignGroups` 保持同步旧签名，CLI 零改动。
- **接口分页 + 前端状态**：`GET /api/admin/align?page&pageSize=20&refresh=1`（非法参数回落 1..50，`parseAlignPage` 纯函数）；响应带 `generatedAt/cached/partial`；后台「对齐审核」显示生成时间/缓存状态、partial 黄色警告、刷新按钮强制重算（计算中禁点防叠加）。
- **开发商/发行商名称脏数据修复（CR，服务端）**：`GetItems` 归一化对象数组 → 名称（`src/adapters/store-browse.js`）；迁移幂等清洗 `games.developers/publishers` 历史脏元素（JSON 对象文本 → 名称，`src/store/pg.js`，连跑两次不报错）；API 契约改字符串数组。与已发布的 App 侧展示兜底（CM-1 `NameListSerializer`）配合，双端不再出现原始 JSON。测试 `test/dev-publisher-names.test.js` 5 项进主链。

### 测试

- `test/align-perf.test.js`（新增 13 项进主链）：缓存/单飞/预筛口径（CE 回归 + 正确样例）/预算 partial/分片/截断/分页边界；反向自检 2 处（改坏实现 → 测试变红后恢复）。HTTP 冒烟（pglite + 真服务）：缓存命中 7ms、45 组分页、计算期间 count/site 并发 200。

## [2.24.0] - 2026-11-17

e2e 测试套件（CK）+ App 功能补齐（CM）：把「真实测试 = 上线门槛」落成可重复脚本，并补齐 App 与 Web 的差异项。

### 新增

- **e2e 测试套件（CK）**：`npm run e2e`（全量：功能矩阵 49 行——前台 / 后台 13 模块 / 用户·愿望单·站点通知·Steam 账号四类完整增删改 / App 安装·覆盖安装·启动·六屏走查 / 公网只读）+ `npm run e2e:smoke`（核心链路 ≤5 分钟）。headless Edge 经 DevTools 协议直连（DOM/Console/截图/PDF），**零新增运行时依赖**；Android 默认模拟器 `steamdeals35` 自动拉起/收尾关闭、真机 `--device=real` 无设备立即中断并打印连接步骤；后台从新建 `e2e_<时间戳>` 账号开始（开场清 `e2e_%` 孤儿、收尾断言无残留）；HTML 报告 → PDF 输出 `F:\dsh\e2e-reports\<日期>-<短哈希>.pdf`（仓库外不入库）。矩阵支持 `--only`/`--tag`，**新功能必须加矩阵行**；微信内置浏览器只做 UA 页面级断言；`--online --expect-version=` 部署后公网只读验收（版本/页面/关键接口 200/TTFB，不碰服务器）。验收：全量 42 通过/0 失败/3 环境 skip（186s）、smoke 8/8（38s）、反向自检（删 DLC 区块 → 行红 + 截图留档 → 恢复后绿）。文档 [docs/TESTING-E2E.md](docs/TESTING-E2E.md)，规格 [docs/E2E-SUITE.md](docs/E2E-SUITE.md)。
- **App 功能补齐（CM，App 仓库 `steamdeals-app` v2.20.0）**：开发商/发行商名称兼容解析（字符串数组 / JSON 对象文本 / 对象数组，统一取 `name`）；详情页 DLC 列表（10 条/页、分页）；价格历史区间切换与指标；游戏名一键复制（中英文两行）。站点侧同步 e2e 矩阵 4 行（实测 3 过 1 按环境跳过：生产 game_dlc 未同步时 DLC 区块行按环境 skip，同步后自动生效）。

### 测试

- `test/e2e/`（matrix.json + runner.mjs + lib/{server,browser,adb,account,mail,report,online,steps}.mjs，约 2800 行）；`npm run e2e` / `npm run e2e:smoke` 脚本；DELIVERY 发版清单加「e2e 全量通过」门禁。



### 新增

- **用户级到价提醒**：每个登录用户管理自己的提醒。详情页三段式操作区（购买 / 我的标记 chips / 到价提醒区块——参考行「当前 ¥X · 史低 ¥Y」+ ¥ 输入框 + 「按史低」「减 10%」快捷按钮 + 保存；已设置显示绿色 pill「提醒中 ¥X」+ 取消）；新增「到价提醒」列表页（桌面 tab + 移动「提醒」入口，游戏名可点开详情、目标/当前/史低/加入时间、取消即移除、分页 20、空态引导）。接口：`GET/POST /api/watchlist` + `DELETE /api/watchlist/:gameId`（登录必需、写操作每用户 30 次/分限流）；详情接口新增 `watch` 回显字段。
- **已拥有改为终态（只认 Steam 库）**：已拥有 = 绑定 Steam 账号库并集（`user_game_flags.owned` 不再参与口径，历史字段保留但无效）；不再提供手动「已拥有」按钮。已拥有时显示「✓ 已拥有 · 全部账号名」，只保留「去 Steam 商店」，感兴趣/不感兴趣/愿望单/到价提醒/复制名全部隐藏（**管理员同样遵守**）；Steam 库同步发现已拥有 → 自动删除该用户该游戏的愿望单行与到价提醒行。
- **提醒按用户分组发信**：降价邮件收件人 = 用户本人邮箱；同用户多游戏合并一封；未绑定邮箱跳过并记 `alert.skipped_no_email`；站点级（NULL）提醒行为不变（webhook/企业微信/`ALERT_EMAIL_TO`）。
- **后台「到价提醒」全站清单**：新 section（分页 + 用户名筛选 + 删除确认），删除按提醒 id 清理任意一条并记审计 `api.watch_deleted`。

### 变更

- `watchlist` 表加 `user_id` 列（NULL = 站点级历史数据），旧整表唯一约束改为用户级/站点级两个部分唯一索引；站点级函数只碰 NULL 行。
- `/api/admin/watchlist` 由站点级清单改为全站分页清单（兼容旧加/删入口按新语义处理）。
- `/api/me` 返回本人 email（提醒保存后前端提示绑定邮箱）。

## [2.22.1] - 2026-11-17

CJ 现场回归修复：线上 v2.22.0 部署后 /app 页「下载 APK」404。

### 修复

- **/app 页下载链接死链（CJ 现场回归）**：`/api/app/latest` 此前无条件返回 `apkPath=/app/dl/<ver>.apk`，但首次部署/同步任务首轮未跑或失败时 `data/app` 为空、该 URL 404。现在 apkPath 按文件真实存在性三级派生——`data/app`（GitHub Release 每小时同步）优先 `/app/dl/<ver>.apk`，否则镜像内 `app/<ver>.apk` 存在则回落 `/app/<ver>.apk`，都没有返回 null（BY 契约）；`/app/dl/<file>` 文件不存在时 302 兜底到 `/app/<file>`；同时把 `/app/dl/` 路由移到静态资源分支之前（原位置为死代码，任何请求都到不了该路由）。回归断言进 `test/serve.test.js`（data/app 为空/有文件/两边都没有/302 兜底四分支）。

## [2.22.0] - 2026-11-17

原生 Android 站点侧落地 + 提醒邮件 HTML 化 + App v2.19.0 入库：CA（App Token 认证与 `/api/app/*` 契约 + 手机前台跳转与 /app 改版）+ CI（提醒邮件 HTML 化 + 申诉页视觉对齐）+ CG App v2.19.0 APK（同 keystore 覆盖旧 TWA）。

### 新增

- **原生 Android 站点侧（CA）**：`api_tokens` 表 + `POST /api/auth/token`（验证码必填，IP 20 次/15 分钟、账号 5 次锁 15 分钟与 Web 共用）+ `POST /api/auth/token/revoke`；`/api/app/*` 前缀重写（`/api/app/latest`、`/api/app/status` 精确例外）并豁免 IP 黑名单/设备封禁（保留全局基础限流）；`GET /api/app/status` 启动封禁检查（`X-Device-Id` → `{banned,type}`）；用户接口 Bearer 失效统一 401 `login_required`；契约 [docs/APP-API.md](docs/APP-API.md)。Web 侧（CA-5）：手机 UA 前台页面 302 → `/app`（`app.mobileRedirectEnabled` 开关**默认关闭**，豁免 console/login/register/app/banned/appeal/setup/change-password 与 /api/*）；微信内置浏览器显示「右上角 → 在浏览器打开」提示；/app 页改版为主推原生 App（保留 APK 下载与 GitHub 兜底）。
- **提醒邮件 HTML 化（CI）**：到价提醒邮件品牌头 + 逐条卡片 + Steam 链接（600px 内联 CSS、全字段转义、无外部资源；纯文本兜底；webhook/企微仍纯文本）。
- **申诉管理页视觉对齐（CI）**：分段控件主色选中、桌面表格卡片式空态、「到期」并入封禁原因副行、间距收紧（移动端卡片不变）。
- **App v2.19.0 入库**：原生 Android App（CG，独立仓库 `steamdeals-app`）APK 入库随镜像（versionCode 21900，同 keystore 覆盖旧 TWA 无需卸载；清单含 versionCode/notes/minVersionCode）。

### 修复

- 本版本无缺陷修复批次（全部为新功能条目）；CA-5 开发期同步修 2 处测试口径（settings 计数 85→86、setup.test.js 同步）。

## [2.21.0] - 2026-11-17

后台安全与个性化三连批：CF 后台体验与自动封禁收紧 + CD 跨平台对齐（审核页/映射落库/ITAD 反解）+ CH Deck 认证/好评率/为你推荐。

### 新增

- **后台体验与安全（CF）**：申诉管理筛选行左分段右刷新 + 邮件处理说明；Steam 账号重复卡片修复；游戏管理 4 主指标 + 「更多指标」折叠；自动封禁改 strict 硬规则（漏洞路径 ≥3 签名/窗口、登录爆破 ≥50/15 分钟、极端频率 5 倍 × 连续 2 窗口、异常 UA ≥2/10 分钟）→ 阶梯临时封 10min/1h/1d 封顶、永不自动永久；普通超频只 429；审核四操作（临时封/永久封/信任/忽略）+ 证据字段 + 审计；申诉对所有封禁开放、未封只提示；`security.autoBan.*` 8 项设置热加载。
- **跨平台对齐（CD）**：杉果 SKU 按去重组排队（同归一化名多 SKU 一行）、后台「对齐审核」页（合并预览/确认/忽略/换候选+手动搜索）、决定继承；映射落 `game_source_map`（skus.json 兼容回落）；英文名参与匹配（name_zh/name_en）；sonkwo 收尾自动增量匹配（`MATCH_ON_SONKWO`，不新增 cron）；ITAD deal.url 跟随 itad.link 跳转反解 appid（失败回退名称匹配）。
- **个性化推荐 + Deck + 好评率（CH）**：`steam-discovery` 每天 100 页翻页采集 Deck 认证与好评率（热门名称回退 7 天退避）；列表 Deck/好评率徽标与筛选、「综合评分」排序（0.4 折扣 + 0.35 好评 + 0.25 热度，权重可调）；「为你推荐」tab（绑定账号 20 条 + because 解释，未绑定引导，游客无入口，排除已拥有/不感兴趣/成人）；行为上报白名单幂等（开关关闭 202）；免费角标 + 去 Steam 领取。

### 修复

- Steam 账号桌面重复卡片（v-else 挂在 v-if 上）；杉果匹配器 CE 加固随 v2.19.0 发布。

## [2.19.0] - 2026-11-16


格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。



CE 杉果匹配器加固 + CC 多源采集推进。

### 新增

- **多源采集推进（CC）**：ITAD / GOG / Humble 从「永远只处理前 50 条」改为带游标的分批推进——
  每游戏 × 每源状态表（`game_source_sync`，迁移幂等 + 既有报价回填 matched），候选按
  「待处理（热度/近 90 天访问优先）→ 未命中 7 天窗口 → 已匹配按源间隔 → 失败 2^n 天退避（上限 30 天）」
  排序，连续两轮处理不同游戏、剩余数单调递减；ITAD 优先英文名搜索、命中缓存 ITAD id 后按 id
  批量取价不再重复搜索；GOG 命中缓存 product id、Humble 命中缓存 slug，二次刷新直接按 id/slug 取；
  后台「同步与回填」页任务表 5→9 项（四源可「立即运行」，运行中 409），新增「覆盖」列
  （匹配/未命中/待探测）；系统设置新增四源「每轮条数」（默认 50，杉果 0 = 全部 SKU）；
  不新增定时任务。

### 修复

- **杉果匹配器加固（CE）**：杉果→Steam 匹配改为完整标题计分 + 片段限制 + 数字/序数/罗马数字
  一致性校验，内容词只进人工候选，自动应用条件收紧（防止误合并）。
- **CC 打回修复**：杉果「每轮条数」设置默认 0（= 全部 SKU）曾被水合后的 `"0"` 字符串当作「0 条」
  处理，默认配置下 `sync sonkwo` 每轮空转——现显式换算 0 → 全部 SKU（含回归锁测试）。

## [2.18.0] - 2026-11-16

移动端与邮件四连批：BT 手机登录入口修复 + BW 后台手机端重设计 + BY 安卓 App 内置更新 + CB 价格报表邮件 HTML 化。

### 新增

- **手机登录入口修复（BT）**：所有进登录页的入口统一走 `openLogin` 整页硬跳（`frontend/src/utils/login-entry.js`），
  修复小米浏览器「我的」面板点登录后"面板关了、登录页不出现"的历史栈竞态；`next` 只接受站内相对路径；
  懒加载 chunk 失败时 `router.onError` 整页重载目标路由一次（sessionStorage 防循环）；封禁自助恢复（BR 批）
  的验证码接口纳入豁免白名单。
- **后台移动端重设计（BW）**：手机（≤768px）打开 `/console` 侧栏收进 ☰ 抽屉（沿用 5 分组 13 模块 + 搜索 +
  待处理角标），顶栏 ☰ + 当前模块 + 通知铃；用户/回收站/Steam 账号/登录会话/操作日志五个模块与同步记录的
  表格改卡片（筛选/排序/分页保留、批量条吸底、危险操作确认沿用）；弹窗手机全屏 + 底部吸附按钮；桌面端
  （≥1025px）布局不变。
- **安卓 App 内置更新（BY）**：App 启动/回前台（24h 一次）检测新版本，原生「发现新版本」对话框
  （版本/大小/更新说明；可稍后/忽略此版本，低于 `minVersionCode` 强制更新）；下载默认仅 Wi-Fi（移动网络弹选择）、
  进度条、SHA-256 校验（不匹配删除并提示）、站点不可达自动回落 GitHub Release；下载完成经 PackageInstaller
  拉起系统安装确认（同 keystore 覆盖升级、数据保留）；「我的 → 检查更新」手动入口（TWA 内触发检查，
  浏览器 1.5s 回落 `/app`）；`latest.json` / `/api/app/latest` 新增 `versionCode`/`minVersionCode`/`notes`
  （旧客户端忽略新字段）。
- **价格报表邮件 HTML 化（CB）**：`report price --notify` 的邮件升级为 HTML（品牌头 + 日期、KPI 三卡、
  降价 Top 5（站内搜索与 Steam 链接）、涨价 Top 3、近 7 天迷你柱状趋势、CTA、页脚；600px 内联 CSS + table、
  ≤480px 单列适配、动态字段全转义）；`multipart/alternative` 保留纯文本 fallback；webhook/企业微信仍纯文本；
  新增设置 `site.publicUrl`（env `SITE_PUBLIC_URL`）供邮件内站内链接。

### 修复

- 手机浏览器前台不再建设移动版 web（CA 决策后：手机访问引导到 `/app` 下载页，由 CA 原生 App 承接）；
  BU/BV/BX/BZ 已过时，BY/CB 由所有者重新派发落地。

## [2.17.0] - 2026-11-14

BS 批：安卓 App（TWA，不上架）+ 可清缓存离线 + 双通道分发。

### 新增

- **安卓版 App（TWA）**：`android/` 工程入库（Bubblewrap，包名 `cn.yyliucha.steamdeals`，站点
  `https://sd.yyliucha.cn`），versionName 跟随 `/api/site`（当前 2.16.0）、versionCode 21600；
  安装后全屏运行（`/.well-known/assetlinks.json` 数字资产校验，含 keystore SHA-256 指纹），
  Steam 等站外链接由 **Custom Tabs** 打开（带返回）；不做推送与角标。
- **可清缓存离线（service worker）**：只缓存 `/assets/*`（带 hash）与封面图 `/img/*`；
  **HTML、`/api/*`、`/manifest.webmanifest` 永不缓存**；导航请求始终走网络（断网不回旧页面）；
  站点版本变化 → 顶部「已更新到 vX.Y.Z，点击刷新」，点刷新清空全部缓存 + SW 更新 + reload；
  `activate` 清旧版本缓存；URL 加 `?nosw=1` 可停用（排查旧页面）。
- **双通道分发**：站点 `/app` 下载页（版本/大小/SHA-256/安装步骤/已知限制 + GitHub 备用链接，
  `GET /api/app/latest` 读 `frontend/public/app/latest.json`）；签名 APK **入库随镜像**
  （`frontend/public/app/steamdeals-<version>.apk` + `latest.json`，`.gitignore` 不忽略交付包）；
  GitHub Release（tag `app-v<version>`）放同一个包 + `.sha256`。
- **静态白名单补齐**：`/.well-known/assetlinks.json`、`/sw.js`、`/app/*.apk` 进 `frontendDir`
  静态白名单（`application/json` / `no-cache` / `.apk` Content-Type），`/app` 登记 `FRONTEND_PAGES`。

### 测试

- `test/serve.test.js`：assetlinks/sw/apk 200 + Content-Type + no-cache、`/api/app/latest` 透传断言；
- `test/pwa.test.js`：SW 规则重写为 BS 口径（main.js 单点注册、`?nosw=1`、`?build=`、只缓存两类、
  导航走网络、caches.delete/skipWaiting），并防"第二处注册"回归。

## [2.16.0] - 2026-11-14

BR + O + BQ 批：封禁自助恢复与手机/CGNAT 适配、申诉系统站内受理 + 后台申诉管理、申诉邮件内一键信任/拒绝。

### 新增

- **封禁自助恢复与手机/CGNAT 适配（BR）**：页面/API/静态资源三个独立限流桶（默认 120/150/300 次/分钟，
  阈值进「系统设置 → 安全与限流」`security.rateLimit.pageMax/apiMax`，保存即热加载；Compose 变量更名
  `RATE_LIMIT_PAGE_MAX`/`RATE_LIMIT_API_MAX`，旧 `RATE_LIMIT_MAX` 不再读取）；封禁期内的升级计数
  **只累计 API 请求**——手机正常刷新页面/图片不再把 10 分钟封禁刷成当天封，纯 API 高频仍被拦并三振升级；
  `GET /api/ban/state` 返回自查三件套 `ip`/`whitelisted`/`until`；后台加白即清内存临时封禁（响应
  `clearedBan`，不重启立即恢复）；封禁页显示「约 X 分钟后恢复」+ 脱敏 IP（`1.2.3.x`）。
- **申诉系统站内受理（O）**：封禁页 → 申诉页站内提交（联系邮箱必填 + 说明 10–2000 字 + 图形验证码
  一次性 + 每 IP 3 条/小时 + 同 IP 同内容幂等返回原编号 + `AP-XXXXXX`），**SMTP 未配置也入库**；
  管理员通知邮件（收件人=申诉邮箱回退链、`From`=SMTP 账号、`Reply-To`=申请人，写发送记录）；
  后台「访问与安全 → 申诉管理」（侧栏带待处理角标）：列表（待处理/已处理/全部）+ 详情抽屉
  （内容/设备指纹/封禁记录/处理表单/复制回复）+ 5 种处理动作（解封 IP / 解封设备 / 两者 / 拒绝+理由 /
  仅备注）联动现有解封逻辑并回信申请人，已处理返回 409；`GET /api/appeal/:code` 按编号查进度
  （不回显内部信息）；`/api/appeal` 与验证码在封禁拦截链放行（被封用户可完成提交）。
- **申诉邮件内一键处理（BQ）**：管理员通知邮件正文顶部「信任并解封 / 拒绝并保持封禁」两个按钮 →
  确认页 `/appeal/act`（token 放 URL fragment、只存 sha256、14 天有效、处理一次失效、预览零副作用）；
  token 即凭据不要求登录；信任 = 解封 IP + 设备；拒绝可填理由（5–500 字，默认文案兜底）；
  与后台共用状态机先到先得（后到显示已处理）；token 过期/伪造统一 404、连续错误 429；
  `POST /api/appeal/action` 每 IP 10 次/分钟限流，日志不写 token。

### 测试

- 新增 `test/appeal-system.test.js`（19 项，接入 `npm test` 主链）：提交入库与 token 列、通知/结果邮件
  （假 SMTP 断言 To/Reply-To/发送记录）、SMTP 未配三处可用、验证码与 3 条/小时、幂等、后台列表/权限、
  解封联动与 409、查进度脱敏、BQ 邮件按钮与 fragment 链接端到端执行、preview 零副作用、先到先得、
  过期/伪 token 404、黑名单 IP 真验证码端到端提交（质检打回回归）。
- `test/ratelimit.test.js` / `test/reviews.test.js` 补 BR 分桶与升级只计 API、加白即清封、封禁页 payload、
  默认阈值 20 次刷新不误封等验收级断言。

## [2.14.0] - 2026-11-13

BP 批：游戏详情·DLC 总数与内联列表（含价格/购买链接；不含拥有状态——Steam 公开 API 不提供）。

### 新增

- **详情页 DLC 区块（内联）**：详情弹窗最下方「DLC（共 N 个）」列表——每行名称（点击跳
  `https://store.steampowered.com/app/<appid>/`，新窗口、`rel="noopener noreferrer nofollow"`）、
  价格（含原价/折扣/缺货状态）、10 条/页翻页；移动端（≤760px）卡片化；明确标注
  「Steam 不提供 DLC 拥有数据」；无 DLC 显示「暂无 DLC」，加载失败显示「稍后重试」、部分缺失显示
  「部分 DLC 信息待同步」；非 Steam / 从未同步过 dlc[] 的游戏不显示该区块。
- **DLC 数据与补齐**：`games.dlc_appids`（appdetails 的 `dlc[]`，去重/过滤/上限 2000）随 steam-status 与
  backfill 的同一次 appdetails 响应**顺带写入**（零额外请求，`steam.status.dlc_written` 日志；GetItems 路径
  不清空已有值）；`game_dlc` 明细表（名称/价格/折扣/币种/在售）由 steam-status 每轮**收尾补齐**
  （`STEAM_DLC_FILL_GAMES=50`、`STEAM_DLC_FILL_BATCH=30`，`steam.dlc.filled` 日志）+ 打开详情缺明细时
  **读路径回源**（≤3 批 GetItems、超时 5s、按游戏 10 分钟节流、429/失败静默降级不 5xx）；
  `dlc_appids` 变化时差集清理下架 DLC。**不新增调度任务**。
- **接口**：详情接口追加 `dlc {total, synced, filled}` 摘要；新增公开接口
  `GET /api/games/:appid/dlc?page=1&pageSize=10`（名称升序、pageSize 上限 50、非法 page 回落 1、
  `buy_url` 由 appid 构造、名称缺失回退 `DLC #<appid>`、非 Steam/未同步返回空集）。

### 测试

- 新增 `test/game-dlc.test.js`（7 项，接入 `npm test` 主链）：dlcAppIds 提取/去重/上限、占位/差集/不清空、
  upsert 明细、fillDlcDetails 批数上限与 429 标记、详情摘要与列表接口（分页/排序/buy_url/节流/降级）、
  steam-status 轮次顺带写入与日志、前端静态断言（区块/跳转/移动卡片/文案）。

## [2.13.0] - 2026-11-13

BO 批：价格历史界面精简——删日期表格、趋势线加高到 150px（所有者方案 B）。

### 新增

- **史低虚线参考线 + 轴标签**：趋势图在史低价位置画虚线（`stroke-dasharray`），图上方左侧标
  「¥区间最低 · 史低线」（绿色）、右侧标「区间 首日 → 末日」；图下方保留首末日期与
  「● 史低 ¥x · 最近史低日」。
- **趋势线加高**：76px → **150px**（移动端 ≤760px 为 **120px**、满宽），把原来日期表格占的空间给趋势线。

### 变更

- **删除日期表格**：桌面 `<table>`、移动端卡片列表与分页条全部移除（与趋势线重复、还要滚动）；
  底部说明改为「共 N 条 · 每天取官方渠道最低价（不含 C2C）· 史低已标出」，条数随区间切换（30/90/全部）
  变化；史低圆点（全期口径，数量 = 史低价出现天数）与「暂无历史记录」空态不变；
  平线（区间最低 = 最高）垂直居中，不再贴底。

### 测试

- `test/price-history-report.test.js`：删除表格相关断言；新增无 `table`/`phr-table`/`phr-pager`、
  `viewBox="0 0 840 150"`、史低线/虚线、CSS 150px + 媒体查询 120px 断言；
  **保留 BN 批的 v-for+v-if 全组件扫描与编译级回归**（旧渲染 bug 不再回来）。

## [2.12.1] - 2026-11-13

修复批：BN 价格历史区块整块不渲染（`v-for` 与 `v-if` 写在同一元素）。

### 修复

- **价格历史区块整块不渲染（BN）**：史低圆点的 `<circle>` 同时写了 `v-for` 与 `v-if`——Vue 3 里 `v-if` 优先级更高，
  编译后判断被提到 `renderList` 外、引用循环变量 `p`，运行时抛 `TypeError` → 整个 `PriceHistoryReport` 组件渲染
  失败（指标条/「价格历史」标题/趋势线/表格/空态全部消失，数据本身没丢）。改为 JS 预计算 `lowDots`
  （史低日数据 + 坐标），模板只保留 `v-for`；`chart` 同时产出 `pts` 数组，去掉模板里对 `points` 的
  `split(' ')` 二次解析。史低全期口径、区间切换（30/90/全部）、分页、空态均不变。

### 测试

- `test/price-history-report.test.js`：删掉「把坏写法当预期」的静态断言；新增**全组件扫描**（禁止同一元素混用
  `v-for`/`v-if`，可复用到其它组件）与 **`@vue/compiler-dom` 编译级断言**（产物不得含循环外 `_ctx.p.` 引用、
  须 `_renderList(_ctx.lowDots`）；测试内先用旧写法编译自检检测器有效（旧写法放回必红）。

## [2.12.0] - 2026-11-13

BM 批：登录页 404 修复 + 会话失效软跳 + 会话心跳（修复 v2.11.0 暴露的登录页白名单缺口）。

### 新增

- **会话心跳（BM-4）**：登录态页面全局每 5 分钟 + 切回前台探测 `/api/me`，只在「上次探测已登录 → 这次未登录」
  时软跳登录页；游客、离线/5xx/429 不跳，`/login`、`/register`、`/setup`、`/banned`、`/appeal` 等公开页不探测，
  全局只挂一个定时器、不续期会话（`frontend/src/composables/useSessionHeartbeat.js`，`main.js` 挂一次）。
- **后台 401 统一软跳 + 过期提示（BM-3）**：新增 `redirectToLogin(reason='expired')`（先 `bypassNextGuard()` 再
  `router.push('/login?next=…&reason=expired')`，不再整页导航），后台 5 处 401 硬跳全部改用它；登录页在
  `reason=expired` 时提示「登录已过期，请重新登录」；前台首页软跳补 `reason`；主动退出登录标记心跳基线，不误跳。

### 修复

- **`/login`、`/register`、`/change-password` 直接打开/刷新返回纯文本 `not found`（BM-1，v2.11.0 生产现象）**：
  SPA 回退白名单补齐这三个页面（`src/server.js` 导出 `FRONTEND_PAGES`），并新增「前端 router 路径 ⊆ 服务端白名单」
  一致性测试——以后新增页面漏登记会直接测试失败。
- **部署即登出（BM-2）**：老会话迁移改为 `last_seen_at = now()`（不再回填 `created_at`）——登录超过 7 天的会话
  不会在部署后第一次请求就被判空闲过期；幂等、不延长 `expires_at`、不动 IP/UA 绑定口径。

### 测试

- `test/serve.test.js`：新增页面路由断言（`/login` 等直接返回 200 + index.html、未登记路径仍 404）与
  router↔白名单一致性测试；
- `test/session-heartbeat.test.js`：新增软跳/心跳静态断言（源码无 `window.location.href='/login`、5 处统一）
  + `shouldRedirectFor` / `isPublicPage` / `probeSession`（mock fetch：503/离线/游客不跳）运行时断言；
  两文件均接入 `npm test` 主链。

## [2.11.1] - 2026-11-13

修复批：BL 增量回填吞吐与配额治理（候选去噪 + 429 软退出重排 + 每日节奏 + 失败隔离 + 观测）。

### 修复

- **回填候选去噪（BL-1）**：候选谓词排除 `free / coming_soon / region_locked / not_found` 四态
  （它们永远不会有报价，回填只白烧配额）；`no_price`（国区无价）保留重试；候选谓词统一进
  `src/store/pg.js` 的 `backfillCandidateWhere`（CLI 与统计共用，防两处分叉）。
- **每日节奏（BL-1）**：回填从每周一轮、上限 5 万改为**每天一轮、上限 5000**（env 仍可覆盖），
  AC-4 每日预算自动重算、总量仍 <24h。
- **429 软退出（BL-2）**：遇到 403/429 不再整轮作废——本轮进度保留（exit 75 = partial），
  调度器 1 小时内自动重排一轮（连续 3 次放弃等日轮、成功一次清零），failures 不累计、不触发熔断；
  首次 429 即写全局冷却文件（含 `at`/`label`），其它任务不再立刻打 Steam；
  `data/backfill-progress.json` 记录本轮进度（done/limit/remaining/429 次数等），
  `/api/admin/sync/status` 合并返回。
- **失败隔离（BL-3）**：同一 appid 连续 3 次拿不到元数据 → 跳过 30 天（`backfill_fail_count` /
  `backfill_skip_until` + 部分索引），到期自动重入，成功一次清零；429 软退出时未处理的条目不计数。
- **观测**：后台指标卡新增「待回填 / 已排除 / 跳过中」；任务卡「上次结果」支持「部分完成」
  （hover 显示 HTTP 429 · 已处理 X/Y · 剩余约 Z · 预计约 N 天），失败原因列显示 429 累计次数与最近时间，
  状态列显示「重试于 HH:mm」。

### 移除

- README「开发进度」自动摘要与 `docs-progress` 门禁下线（2026-11-12 所有者决定，见 [docs/TODO-PROGRESS.md](docs/TODO-PROGRESS.md) §0）：
  README 只保留指向 `docs/TODO.md` 的链接；删除 `scripts/todo-progress.js`、`.github/workflows/docs-progress.yml`、
  `test/todo-progress.test.js` 与两个 npm script。原因：该检查依赖人工步骤、反复变红、且不参与镜像构建。

### 测试

- 新增 `test/backfill-throughput.test.js`（5 项：候选去噪、进度文件、失败隔离、统计对账）并接入 `npm test` 主链；
- `test/scheduler.test.js` 增 BL-2（partial 不熔断、1 小时重排、连续 3 次放弃、成功清零、dueJobs 重排判定）；
- `test/http-error.test.js` 增 429 落盘 at/label 断言；`test/http-proxy-failover.test.js` 与
  `test/image-coverage.test.js` 随谓词迁移更新。

## [2.11.0] - 2026-11-12

新功能批：BK 会话治理——登录会话列表/踢下线 + 过期清理 + 空闲超时与 IP·UA 绑定（规格 [docs/SESSION-MANAGEMENT.md](docs/SESSION-MANAGEMENT.md)）。

### 新增

- **登录会话列表与踢下线（后台）**：`GET /api/admin/sessions`（用户名/IP 筛选、`includeExpired`、分页；
  每行 `{id,username,role,disabled,ip,region,userAgent,deviceId,createdAt,lastSeenAt,expiresAt,current}`，**绝不返回 token**）；
  单条踢 `DELETE /api/admin/sessions/:id`、按用户踢 `DELETE /api/admin/users/:username/sessions`
  （目标是自己时保留当前会话）、批量踢走 `/api/admin/bulk` 的 `sessions/kick`；后台「账号与服务 → 登录会话」页
  （列齐全、当前会话标记、批量确认）；`last_seen_at` 每会话 5 分钟内存节流写。
- **空闲超时 + IP/UA 绑定**：`auth.sessionIdleDays`（默认 7，0=关闭）空闲失效；`auth.sessionBindIp`（IPv4 /24、
  IPv6 /64 前缀比较，`src/session-fingerprint.js`）与 `auth.sessionBindUa`（浏览器家族+主版本）绑定校验；
  不一致即删行、清 cookie、记 `session.idle_expired` / `session.bound_mismatch`；升级前的老会话（无指纹键）不误踢。
- **前台「退出其它所有设备」**：改密页新增卡片 + `POST /api/user/sessions/revoke-others`（保留当前会话）。
- **会话解析收敛**：同一请求最多查一次会话（原 3 处 `userBySession` 收敛为 `resolveSession`）。

### 修复

- **单条禁用用户立即踢会话**（此前只有批量禁用会踢）；`userBySession` 兜底过滤 `disabled`；
  用户列表「登录会话 N 个」只统计未过期。
- **过期会话行无人清理**：并入现有 `prune`（每周），输出「登录会话 N 条」，连跑幂等；
  空闲兜底分支随 `auth.sessionIdleDays` 生效。

### 测试

- 新增 `test/sessions.test.js`（10 用例覆盖规格 §4 验收 1–19，入主链）；修正 3 个既有测试的计数断言
  与「换设备」用例的 IP 头（绑定语义下旧测试漏带 `x-forwarded-for` 会被正确踢掉）。

## [2.10.2] - 2026-11-11

修复批：BJ 黑名单 IP 不再写入自动封禁 + 自动封禁记录口径 + 解封语义拆分（规格 [docs/BAN-AND-SECURITY-FIXES.md](docs/BAN-AND-SECURITY-FIXES.md) §10）。

### 修复

- **拦截链黑名单前置**：IP 黑名单检查提到频率限制之前——黑名单 IP 一律立即 403（不再先被限流计数、
  打满阈值后变 429）；命中不计数、不三振、不升级、不写 `ip_abuse` / 异常审核；采样拦截日志保留
  （同 IP 每分钟 ≤1 条）；`/api/ban/state` 与封禁页判定类型优先级改 设备 → 黑名单 → 自动封禁。
- **自动封禁记录口径**：`GET /api/admin/abuse` 默认只列生效中（`status=active|expired|all`），每行带
  `active` 与 `in_blacklist`/`blacklist_entry`（运行时 CIDR 匹配）；后台新增状态列（生效中/已过期/仅计数）、
  筛选下拉与红色「已在黑名单」标注（悬停显示命中的 CIDR 条目与备注），移出黑名单后标注消失。
- **解封语义拆分**：自动封禁页「解除封禁/清除记录」只清 `ip_abuse`（含内存态），黑名单页解封只删
  `ip_blacklist`，批量同口径（`ratelimit.unban` 退场，改 `clearAbuse`/`clearBanMemory`）；两处按钮都带
  确认框说明不越界。
- **黑名单优先**：审核通过 / 手动封 IP / 批量封 IP 写黑名单时，清掉该 IP 的 `ip_abuse.banned_until`/
  `ban_source`（行保留做审计）；迁移幂等清理存量「已被黑名单覆盖」的临时封禁字段。
- **自动封禁记录保留 90 天**：并入现有 prune（`--abuse-days` 可覆盖），过期行与很旧的仅计数行自动清理。

### 测试

- `test/admin-bulk.test.js` +4（黑名单 IP 200 次全 403 零写入、双向解封粒度、CIDR 标注消失）；
  `test/visitors.test.js` +3（listAbuse 三口径、clearAbuseBan 与迁移幂等、purge 保留期）；
  `test/ratelimit.test.js` 改 clearAbuse/clearBanMemory；`test/reviews.test.js` 审批清临时封禁断言；
  新增 `test/bj-abuse-views.test.js`（前端静态断言，入主链）。

## [2.10.1] - 2026-11-11

修复批：AY 搜索性能修复 + BF 数据库遗留对象清理 + BG 站点通知未保存误报。

### 修复

- **搜索性能（AY 批）**：关键词两段式——三臂 trigram 候选收敛（名称/英文名/平台别名，上限 5000），
  候选为 0 直接返回空（零命中不再全表扫）、命中 ≤5000 用 `g.id = any()`、超限回落原 LIKE；新增部分索引
  `games_heat_live (heat desc nulls last) where live` 消除默认排序的外部归并落盘；`/api/games/count`
  priced+catalog 合并 60 秒缓存。性能门槛（列表 <150ms / 零命中 <150ms / count <30ms）**待部署后复测**
  （[README-MODEL.md](docs/READ-MODEL.md) §12）。
- **数据库遗留对象清理（BF 批）**：删除已下线对象的建表/加列 DDL 与读写——
  `steam_sessions` 表、`users.steam_id` 列与 `users_steam_uniq` 索引、`offers.risk_level` 列与 INSERT 字段、
  后台用户列表的 `steam_id` 选择、`user_wishlist.steam_ids` 列及其读写；保留 `steam_accounts.api_key_enc`
  （账号同步用 key）与 `content_descriptors`/`age_ratings`/`interested`/`owned`/`hide_uninterested`；
  生产库清理 SQL 见 [DB-LEGACY-CLEANUP.md](docs/DB-LEGACY-CLEANUP.md) §3（部署侧执行，幂等）。
- **站点通知未保存误报（BG 批）**：抽屉脏判定初始快照从空串改为初始表单，打开站点通知页未做任何编辑
  不再误报「还有没保存的修改」；打开抽屉编辑后守卫照常生效。

### 测试

- 新增 `test/db-legacy-cleanup.test.js`（3 项：新库 migrate 后遗留对象不重建、保留对象仍在、offers INSERT 可跑通）
  并接入 `npm test` 主链；
- `test/unsaved-guard.test.js` 增 BG 回归（初始快照 = 初始表单、不得空串、fillFrom 仍重置）；
- `test/wishlist.test.js` / `test/wishlist-push.test.js` 断言改为不依赖 `user_wishlist.steam_ids` 列。

## [2.10.0] - 2026-11-11

BI 批：访问明细 IP 统计——自动临时封禁显示（封禁中 + 剩余时间）与状态筛选（规格 [docs/VISIT-IP-STATS.md](docs/VISIT-IP-STATS.md) §8）。

### 新增

- IP 统计状态扩展为四态：`已封禁`（手动黑名单，红）/ `封禁中`（自动临时封禁未过期，橙 + 剩余时间）/
  `被拦截`（时间窗内有拦截采样，黄描边）/ `正常`（灰）；手动黑名单优先于自动封禁。
- 接口 `GET /api/admin/visitors/by-ip` 追加 `ban_until` / `ban_source` 字段与 `status` 筛选参数
  （`all | normal | intercepted | banned | blocked`，白名单，与时间窗/关键词/分页叠加）。
- 前端 IP 统计顶部加状态筛选下拉；状态列显示「封禁中 · 剩余 m:ss（>1 小时显示 h 小时 m 分）」。

### 测试

- `test/visitor-ip-stats.test.js` 增补：自动封禁中 / 黑名单优先 / 过期回落 / 状态筛选 / 前端静态接线。
## [2.9.0] - 2026-11-10

BE / BH 两批：愿望单仅本站（去 Steam 关联 + 后台清单）+ 访问记录按 IP 统计（默认 IP 视图 + 黑白名单统计列 + 设备按设备码）。

### 新增

- 后台「内容运营 → 愿望单」：全站清单（用户/游戏/当前价/史低/加入时间）+ 关键词/分页 + 单条/批量删除（max 200，复用 `bulk_ops` 审计），不提供新增入口。
- 每账号 API Key 改为**账号同步用**（游戏库/愿望单）：未配置或无效直接报错、不回退全局 `STEAM_API_KEY`；系统采集任务仍用全局 key；绑定新账号后不再自动同步。

### 变更

- 愿望单加入/移除只写本站：`POST/DELETE /api/wishlist` 忽略旧 `steamIds`、不再推 Steam、不再写 `steam_wishlist`；
  移除仍清自动史低提醒；`user_wishlist` 新增代理主键 `id`（只增列，复合主键保留）。
- 前台 `Home.vue` 去掉 Steam 账号多选弹窗与卡片/详情账号展示，加入直写本站、移除二次确认；「愿望单」tab 不变。

### 测试

- 重写 `test/wishlist.test.js`（site-only 语义 + 旧字段兼容），新增 `test/wishlist-site-only.test.js`（后台清单/删除/批量/权限 + §4.4 静态接线），`test/admin-bulk.test.js` 计数 +1。
### 访问记录按 IP 统计（BH 批）

规格 [docs/VISIT-IP-STATS.md](docs/VISIT-IP-STATS.md)（已实现待发版）。

### 新增

- `GET /api/admin/visitors/by-ip`（IP 统计视图：每 IP 一行，访问次数 / 首次→最近 / 独立路径 / 设备数 / 地区 / 状态；`days=1|7|30`、`sort=visits|lastAt|ip` 白名单、分页、关键词）与 `GET /api/admin/visitors/by-ip/:ip`（展开行：最近 20 条访问 + 路径 top5）。
- 黑白名单列表每行追加近 7 天 `visits / last_at / devices`。
- 设备列表按 `device_id` 聚合（无设备码回退指纹）：多 IP/UA 汇总、出现次数、封禁状态；封禁仍按指纹。

### 变更

- 前台后台「访问明细」默认 IP 统计视图，可切回明细；时间窗 1/7/30 天同时作用于两个视图；明细接口新增 `days` 参数。
- 设备表列改为「设备（按设备码聚合）/ IP / 出现次数 / 状态」，移动端卡片同步。

### 测试

- 新增 `test/visitor-ip-stats.test.js`（窗口过滤/三种排序/状态/详情展开/黑白名单统计/设备聚合/前端静态接线），并入主链。
## [2.8.0] - 2026-11-10

AZ / BA / BB / BC 四批：异常审核规则摘要精简、运行与同步页重设计、代理健康主动探测、封面图补图覆盖率。

### 新增

- **异常审核规则摘要精简（AZ）**：列内只显示「首规则 ×n · 共 N 条规则」，悬停弹层列全部规则（单规则不弹），移动端同口径。
- **运行与同步页重设计（BA）**：顶部任务健康条（点 chip 过滤日志、60 秒刷新）、同步记录精简为 6 列并默认 5 轮折叠、
  日志面板固定 55vh 内部滚动（sticky 筛选条 + 行点击展开完整字段）。
- **代理健康主动探测（BB）**：设置页「立即检测」+ `probe --proxy` 命令 + 每 10 分钟 `proxy-probe` 任务；
  CONNECT 协议层探测，结果写 `probe*` 字段、与业务冷却分离；「未知」改为「未检测/探测失败」。
- **封面图补图覆盖率（BC）**：`steam-status` 同一次 appdetails 顺带补 `header_image`、`backfill` 候选纳入
  「有价但无 header_image」、`images.limit` 默认 500、后台「清除缺图缓存」（`POST /api/admin/images/reset-miss`）。

### 测试

- 新增 `test/proxy-probe.test.js`（成功/407/超时、不进业务冷却、脱敏、健康文件无明文）与
  `test/image-coverage.test.js`（header_image 补齐不覆盖、默认 500、reset-miss 鉴权）；
  `test/scheduler.test.js` 增 proxy-probe 与 images 500 断言；`test/admin-review-lists.test.js` /
  `test/admin-console-ia.test.js` / `test/proxy-pool-ui.test.js` 增补静态断言。
## [2.7.0] - 2026-11-10

AW 批：封面图回源（404 快失败 + 超时收紧 + 负缓存分层 + `header_image` 直链，规格 [docs/IMAGE-FETCH.md](docs/IMAGE-FETCH.md)）
+ AX 批：异常审核「按 IP 合并」定为默认唯一视图（规格 [docs/ADMIN-REVIEW-LISTS.md](docs/ADMIN-REVIEW-LISTS.md) §4.5）。

### 新增

- **封面图 404 快失败**：同一张不存在的图不再连试 3 个 CDN——`downloadImage` 遇到 404/410 立即失败
  （返回 `notFound`），首页缺图从 2–6.6s 降到 1 次请求；超时单候选 8s→3s、整次兜底预算 5s（不再累加到 24s），
  超时/网络错误照旧换候选。
- **负缓存分层**：404/410 记 24 小时、超时/网络错误记 10 分钟（`IMG_MISS_TTL`），期内重复请求不再触发网络。
- **`header_image` 直链**：header 尺寸优先用 Steam 新资产完整 URL（仅 `https` + `.steamstatic.com` 白名单，
  防 SSRF；直链 404 回退老路径），解决 2024 后上架游戏老路径无资产的问题。
- **封面占位块**：首页卡片/移动卡片/详情弹窗封面失败或无 AppID 时显示 CSS 占位块（渐变 + 游戏名首字），
  不再用站点 favicon 兜底。
- **`images pull` 统计 notFound**：预取 404 缺图单独计数（`404 缺图 N 张`），不混进失败告警。
- **异常审核合并视图默认唯一**：进入「异常审核」直接是按 IP 合并视图；删除「按 IP 合并」开关与
  `admin.reviewMerge` localStorage、明细表与逐条处置——处置一律按整 IP（封 IP / 封设备 / 忽略作用于该 IP
  全部待审记录，确认弹窗写明条数）；保留只看待审/全部筛选、合并视图排序、展开逐条规则、批量栏
  「已选 N 个 IP · M 条待审」、移动端卡片与分页。

### 测试

- `test/images.test.js` +6 项：404 单次调用 / 超时换候选 / 总预算 / 负缓存分层（TTL 注入）/ 直链白名单与回退 /
  前端占位与 pull 统计静态断言。
- `test/admin-review-lists.test.js`：断言改为「无开关、无 `admin.reviewMerge`、默认渲染合并表」；
  `test/admin-bulk.test.js` 勾选列与工具条计数随明细表移除更新；`test/reviews.test.js` 悬停提示断言改合并展开行。

## [2.6.0] - 2026-11-10

AV 批：首页列表读模型——`game_region_snapshot` 把「每请求全库聚合」改成「入库时算一次、读的时候只查一行」
（规格 [docs/READ-MODEL.md](docs/READ-MODEL.md)）。

### 新增

- **读模型表 `game_region_snapshot`**：`(game_id, region)` 一行的当前价 / 折扣 / Steam 价 / 平台标签 /
  史低 / 新史低 / 更新时间，覆盖全部区服 + 4 条索引（折扣/价格/最近可见/单游戏）；迁移时表空则一次性回填
  （offers ∪ daily_prices 并集，日志 `readmodel.backfill_start/done`，失败不吞异常），首次启动会慢一次。
- **入库时维护（同库强一致）**：`ingestOffers` 每个 offer 写库后 `refreshGameRegionPrices`（1–3ms 重算该游戏
  全部区服当前价列，列表同一轮可见）；日聚合写入后 `touchDailyAggregate`（日界切换维护 `hist_low` /
  `prev_hist_low` / `hist_low_day`，c2c 不进史低）；`mergeGames` 尾部刷新 from/to 两个游戏（价格 + 史低取并集）。
- **读路径切换**：`gameSearch`（compact 与非 compact 两分支）与 `/api/games/count` 改读快照——
  去掉 `price_rollup` / `daily_rollup` 两个全库 CTE 与逐行 `exists(daily_prices)`；`/api/games/count` 的
  priced 计数加 60 秒进程内缓存（口径不变）；`READ_MODEL=legacy` 环境变量一键回滚旧 SQL（表保留）。
- **对账与重建**：`node src/cli.js readmodel check --sample 200 [--fix]`（抽样实时聚合逐字段比对，差异非零退出）/
  `readmodel rebuild [--region cn]`（全量重建）；新增每日调度任务 `readmodel`（抽样 200，差异记任务失败可观测）。

### 测试

- 新增 `test/game-search-read-model.test.js`（8 项，入 `npm test` 主链）：新旧实现 20 组筛选组合
  （sort/type/released/marks/关键词/游客与登录 + 非 compact）total 与首页 id 顺序完全一致；
  写价后快照同轮更新；跨天 prev_hist_low 日界切换；合并后 from/to 快照正确；禁用/回收站/成人 hide 过滤；
  抽样对账 0 差异 + corrupt 发现 + `--fix`/`rebuild` 修复；`READ_MODEL=legacy` 回滚可用。
- `test/scheduler.test.js` 补 `readmodel` 任务默认参数/开关断言；既有测试的原始 SQL 种价点补读模型刷新。

## [2.5.0] - 2026-11-09

AU 批：`pg_trgm` 搜索索引 + 封面图缓存总量上限 + 愿望单诚实口径（AA 方案 A）。见 [docs/TODO.md](docs/TODO.md) 的 AU 条目。

### 新增

- **搜索索引（D1）**：迁移建 `pg_trgm` 扩展与 3 条表达式 GIN 索引（`games.name` / `games.name_en` /
  `game_aliases.platform_title`），表达式与 `gameKeywordSql` 的字段侧归一化逐字一致（去半角/全角空格 + lower）；
  本地 pglite 无扩展时静默跳过、迁移不中断。
- **封面图缓存总量上限（D2）**：新设置 `images.maxBytes`（字节，0=不限）；超限按 mtime 从最旧清理（只删 `.jpg`）；
  `node src/cli.js images prune --max-bytes <字节>` 手动清理；`images pull` 结束自动清理（调度器任务同样生效）。

### 修复

- **愿望单提示口径（AA 方案 A）**：Steam `AddToWishlist` 对 Web API Key 返回 401（已停止接受第三方写入），
  前端弹窗与加入/移除提示改为「仅本站保存」「Steam 推送暂不支持」，不再出现「推送失败」字样；
  服务端失败日志与 reason、推送分支代码保留，每日只读同步不受影响。

### 测试

- `test/images.test.js`：超限按最旧删除 / 上限内不动 / 0=不限；
  `test/pg.test.js`：迁移含三条索引表达式 + pglite 两次 migrate 不中断；
  `test/wishlist.test.js`：诚实口径断言（含「不再出现推送失败」反例）。

## [2.4.0] - 2026-11-09

AT 批：后台信息架构改版——新建/编辑改右侧抽屉、操作日志合并 5 tab、邮件与设置 tab 化、价格变化悬停线图（规格 [docs/ADMIN-CONSOLE-IA.md](docs/ADMIN-CONSOLE-IA.md)）。

### 新增

- **新建用户 / 新建·编辑站点通知改右侧抽屉**：用户管理与站点通知页只留列表；抽屉不跳页、列表不刷新、
  关闭后筛选/分页/滚动位置不丢；`?section=users&drawer=new`、`?section=announcements&drawer=new&id=…` 可直达；
  新建用户成功后临时密码在抽屉内一次性展示（可复制）；通知抽屉带前台预览；未保存离开提醒对抽屉照常生效。
- **操作日志（新菜单，5 tab）**：侧栏新增「日志审计 / 操作日志」，删除「批量操作记录」「运行日志」两个菜单；
  一页收拢用户删除 / 批量操作 / Steam 账号 / 邮件发送 / 运行与同步（含实时输出，10 秒轮询只在 tab 打开时跑）；
  `?tab=` 直达、切 tab 懒加载 + 内存缓存、顶部显示条数；旧书签 `?section=bulk-ops` / `?section=sync` /
  `?section=mail&tab=records` 自动映射不 404；用户删除 tab 上限 200 + 日期范围筛选。
- **Steam 账号操作审计**：新表 `steam_account_logs` 记录绑定 / 解绑 / 认领 / 同步游戏库 / 同步愿望单 /
  更换 API Key / 级联删除 7 类动作（失败也记录并带原因与耗时；`user_id` 不挂外键——用户被删后日志仍在）；
  `GET /api/admin/steam-logs`（limit≤500 / steamId / action / result / days）；保留 180 天并入现有
  `prune` 周任务（`--steam-days` 可调）；Steam 账号页「操作日志 ↗」入口与行内「日志」链接。
- **邮件服务 3 tab**：配置 / 模板 / 发送测试分开；发送记录只留「查看发送记录 ↗」一个入口（跳到操作日志·邮件发送）。
- **系统设置 6 tab**：折叠面板改为 tab（与旧 6 分组一一对应、项数一致），搜索命中自动切到对应 tab。
- **价格变化悬停线图**：删除底部「近 7 天变化」表；悬停「变化」列即时弹该游戏近 7 天线图（7 天最低 / 当前、
  无数据空态）；`/api/admin/reports/price` 移除 `daily`、新增 `series`（报告内 game_id 一次查出每日最低，无逐行请求）。

### 测试

- 新增 `test/admin-console-ia.test.js`（11 项：审计落库/失败记录/删用户后日志保留/180 天清理/序列批量查询/
  接口鉴权与筛选/前端接线静态断言）接入 `npm test` 主链；
  `unsaved-guard` / `auth-pages` / `admin-bulk` / `proxy-pool-ui` / `frontend-registration` / `api.test.js`
  断言随抽屉化与报表字段更新。

## [2.3.0] - 2026-11-09

AS 批：README 开发进度摘要（自动生成）+ docs-progress CI 防漂移 + README 过期项修正。

### 新增

- **README「开发进度」自动摘要**：`docs/TODO.md` 仍是唯一排期来源，`scripts/todo-progress.js`
  解析每条目的状态行，生成 README 标记块（当前版本 / 进行中 / 接下来 / 最近 5 个完成 + 计数）；
  未知状态进「待分类」不静默丢失；生成不含时间戳、可重复生成。
- **本地命令**：`npm run todo:progress`（生成）/ `npm run todo:progress:check`（校验）。
- **CI `docs-progress`**：README 与 TODO 不一致时变红并提示命令，只在相关文件变更时运行，不触发镜像构建。

### 修复

- **README 过期描述**：Docker 部署行改「已发布镜像」；多区服两处口径统一为「同屏并排」；
  删除过期「路线图」段（已完成项不再挂 `[ ]`），未排期产品项迁入 `docs/ROADMAP.md`。

### 测试

- 新增 `test/todo-progress.test.js`（8 项：分类顺序、最近 5 个、待分类兜底、标记替换、幂等、check 语义），
  接入 `npm test` 主链。

## [2.2.1] - 2026-11-09

Steam 价格同步优化（F 批）：限速收紧 + 热点优先 / 冷门降频。

### 新增

- **Steam 价格同步优化（F 批）**：`steam-prices` 请求间隔 1100 → **1600ms**（约 187 次/5 分钟，
  回到 Steam 200 次/5 分钟配额内，不再靠 429 冷却兜底）；选取条件改**热点优先 + 冷门降频**——
  热点（近 90 天有访问 / 有用户标记 / `heat ≥ 1`）每天刷，冷门在最近价格快照超过 **3 天**未更新才刷，
  排序 `is_hot desc, last_snap asc`；阈值可用 `STEAM_PRICES_HOT_HEAT_MIN`（默认 1）/
  `STEAM_PRICES_COLD_DAYS`（默认 3）调整；不新增调度任务。测试 `test/steam-prices-priority.test.js`。
## [2.2.0] - 2026-11-09

后台列表排序（AQ 批）+ 三个线上问题的修复（heat/catalog 静默失效、未保存弹窗反复出现）一起交付。

### 新增

- **价格历史报表视图（AP 批，docs/PRICE-HISTORY-REPORT.md）**：游戏详情价格历史从 chip 网格改为**报表视图**——
  指标条（区间最低 / 区间最高 / 当前较史低 / 记录天数）+ 手写 SVG 趋势线（史低点绿）+ 表格（日期 / 当日最低 /
  较前一日 / 标记，**史低行整行高亮 + 徽标**），范围「近 30 天 / 近 90 天 / 全部」，移动端卡片化。
- **后台游戏列布局 + 平台链接抽屉重做（AO 批，docs/ADMIN-LINKS-DRAWER.md）**：游戏列改 flex——名称单行省略、
  复制图标固定行尾、英文名悬停看全名；复制内容 = **中英文两行**（相同/仅中文时仅一行）；**点游戏名开抽屉**（复制只点图标）；
  抽屉重做：封面 + 中英文名 + AppID + 每条渠道一张卡（平台/区服/现价/划线原价/折扣/库存/更新时间/打开）+ 空态兜底 + 移动端全屏。
- **异常审核「按 IP 合并」视图（AR 批，docs/ADMIN-REVIEW-LISTS.md §4）**：待审列表加「按 IP 合并」开关（默认关，
  状态存 localStorage）；同 IP 的多条规则合成一行（规则摘要 / 总次数 / 首末时间 / **设备数** / 状态），
  展开看每条明细；处置（封 IP / 封设备 / 忽略）作用于该 IP **全部待审记录**，确认弹窗写明条数；
  状态混合显示「部分已处理」；勾选合并行 = 该 IP 全部待审，批量栏显示「N 个 IP · M 条记录」；移动端卡片化。
- **后台访问/异常列表排序（AQ 批，docs/ADMIN-REVIEW-LISTS.md §3）**：
  - 异常审核列表**客户端排序**：最近出现 / IP / 次数 / 规则，默认「最近出现 ↓」，
    IP 按**数值序**（IPv4 转整数、IPv6/异常值排后、空值最后），排序状态存 `localStorage`，切换不重置筛选；
  - 访问明细**服务端排序**：`GET /api/admin/visitors` 新增 `sort=time|ip|status` + `order=asc|desc` **白名单**
    （非法回落默认；IP 用零填充字符串键，不用 `ip::inet` 防脏数据炸查询），换排序回第 1 页；
  - 异常审核拉取上限 300 → **500**，列表头显示「共 N 条（上限 500）」。

### 修复

- **愿望单六项产品缺陷（AA 批，docs/WISHLIST-FIX.md §4）**：失败账号的日志与提示带**原因**
  （未配 Key / 解密失败 / Steam 拒绝）、无 Steam AppID 条目明确「仅本站」不再弹多选、
  无绑定账号提示「绑定后可同步推送」、未配 Key 账号在弹窗置灰注明；新增 `test/wishlist.test.js`（7 项）。
- **heat 任务静默失效（C1，docs/TODO.md C 段）**：AB 批把 `fetchJson` 改为返回 `{...res, json}` 后，
  `heat` 仍按旧契约解包（`data[appid]`）→ 永远取到 undefined → **全量「无效跳过」、写 0 条热度**；
  `steam-catalog` 同因空跑（新游戏进不了库）。改为 `data.json` 解包，新增
  `test/fetchjson-contract.test.js` 锁契约，防再犯。
- **后台「放弃修改」后弹窗反复出现（AN 回归）**：`discard()` 只放行一次导航、不清任何草稿，而 Console 切换
  section 不卸载组件 → 草稿一直挂着、每次导航都弹。现在注册签名支持 `discard` 回调，五个编辑面各自清草稿，
  新增 2 项回归测试（「放弃后 dirtySources 为 0、下次导航直接放行」）。

### 文档

- **AA 方案 A 定案（docs/WISHLIST-OAUTH.md）**：愿望单推送 Steam 失败根因为 `HTTP 401 → api.steampowered.com`
  （写接口不接受 Web API Key，只读 GetWishlist 正常）；经所有者确认采用**方案 A「诚实提示」**——
  改为中性文案「已加入本站愿望单（Steam 推送暂不支持）」+ 文档说明，不投入 OAuth 改造。开发描述已入规格，待排期。

## [2.1.0] - 2026-11-09

认证与账号系统（AK/AL）、Steam 代理池设置页（AM-2）、后台未保存离开提醒（AN）与同步可靠性（AC-2/3/4）九批一起交付。

### 新增

- **密码策略 + 哈希升级（AK-1 批，docs/AUTH-REDESIGN.md §4.1/§4.2）**：
  - 新增 `src/password-policy.js` 与 `src/data/common-passwords.js`（Top 1 万常见密码 + 常见词数字尾巴变体）：
    最低 **12 位**（≤200）、含用户名/邮箱 @ 前部分、全同字符、连续序列判定与 0–4 评分；
  - scrypt 版本化哈希 `$scrypt$32768$8$1$…`（旧 `salt:hash` 兼容，登录成功**静默升级**）；
    登录时评估 `weak_password` 落库；六个设置密码入口统一策略（初始化/后台建号/后台重置/自助重置/CLI/注册/改密）；
  - `POST /api/password/check`（匿名、每 IP 每分钟 30 次）给前端强度条。

- **登录防护 + 后台安全标识（AK-2 批，docs/AUTH-REDESIGN.md §4.3/§4.4）**：
  同 IP 15 分钟失败 ≥20 次 → 429（不消耗账号尝试次数）；账号 5 次错密码锁 15 分钟（第 6 次 429 + 剩余时间）；
  成功清零；登录失败统一「用户名或密码错误」（不暴露禁用）；管理员解锁（`POST /api/admin/users/:username/unlock`）；
  「记住我」30 天/默认 7 天；后台用户列表「已锁定/弱密码/需改密」tag。

- **账号流程（AK-3 批，docs/AUTH-REDESIGN.md §4.5–4.8）**：
  后台建号/重置密码可留空 → 16 位随机临时密码（只回一次）+ 首登强制改密；重置不再顺带启用账号；
  开放自助注册（开关 `auth.registrationEnabled`、SMTP 未配置 503、唯一性 409、图形验证码 + 发码限流、
  建号即验证并自动登录）；登录用户修改密码（旧密码校验、踢其它会话保留当前、weak 清除）；
  `must_change_password` 用户业务接口 403（白名单放行）。

- **登录 / 注册 / 改密页面（AL 批，docs/AUTH-REDESIGN.md §5）**：
  独立 `/login`（桌面左右分栏 + 移动单列、三模式、Caps Lock 提示、错误就地、记住我、回跳 next 站内校验）、
  `/register`（强度条 + 60 秒倒计时 + 不可用说明）、`/change-password`（forced 提示）；
  首页不再弹登录框；任意接口 401 → `/login?next=…`；后台新建/重置密码「随机生成」+ 临时密码弹窗。

- **Steam 代理池设置页（AM-2 批，docs/PROXY-POOL.md §5）**：
  「网络与代理」的 Steam 专用代理从单行输入改为**列表编辑器**（查看并编辑走明文通道、增/删/上移/下移、
  上限 10 条、清空全部；前端校验 http/https 与 ≤10 报行号，服务端兜底）+ 健康状态表
  （正常/冷却中倒计时/未知、连续失败、冷却到、最近错误）+ 每 10 秒自动刷新。

- **未保存修改的离开提醒（AN 批，docs/UNSAVED-GUARD.md）**：
  系统设置/邮件配置/站点通知/编辑游戏/新建用户五个编辑面有未保存修改时，切菜单或离开路由弹三选一
  （保存并离开/放弃修改/留在本页）；刷新关闭不拦；401 跳转 bypass；当前菜单项未保存小圆点。

- **同步价格/吞吐/可靠性三批（AC-2/3/4 批，docs/SYNC-FAILURE-MODES.md）**：
  `steam-status` 判 ok 顺带写首次报价 + 「已同步」口径 = ok+有报价；回填新游戏优先 + 上限 5 万 +
  每日 Steam 配额预算超限自动降频告警；熔断面板可见 + 手动重置（`POST /api/admin/circuit/reset`）；
  429 冷却落盘跨子进程共享（`data/steam-429.json`）；报价解析结构校验（`adapter.<平台>.shape_mismatch`）。

### 修复

- 修复 AI 批遗留的测试断言过期（验证码模板主题与 multipart 正文提取）。

### 测试

- 新增 `test/password-policy.test.js`（11 项）、`test/auth-lockout.test.js`（6 项）、`test/register.test.js`（4 项）、
  `test/password-change.test.js`（4 项）、`test/auth-pages.test.js`（7 项）、`test/proxy-pool-ui.test.js`（4 项）、
  `test/unsaved-guard.test.js`（5 项）接入主链；扩展 `test/steam-status.test.js`（AC8）、`test/scheduler.test.js`（AC9/AC4/AC2）、
  `test/http-error.test.js`（AC6）、`test/pg.test.js`（AC7）；主链 66 文件 / 542 项全绿。

## [2.0.0] - 2026-11-06

账号生命周期三件套（用户彻底删除 AH、邮件模板化 AI、账号变更通知 AJ）与 Steam 代理池 AM-1 一并交付，跃升大版本 2.0.0。

### 新增

- **邮件模板 + HTML 邮件 + 发送记录（AI 批，docs/USER-LIFECYCLE.md §3.1/§3.3/§4.3/§4.4/§4.5/§5.2）**：
  - `buildMessage`/`sendMail` 支持 **HTML 多部分**（`multipart/alternative`，text/plain 兜底 + text/html，均 base64）；
    主题在 `encodeSubject` 里先过滤 CR/LF（防头注入）；
  - 新增 `src/mail-templates.js`：9 个事件（8 类账号通知 + 验证码）默认模板、渲染（变量 HTML 转义、
    未知变量原样保留、统一页脚代码追加、text 自动兜底）、保存前校验（主题 ≤200 去换行、HTML ≤20000、
    `{{code}}` 仅验证码可用）、3 套示例版式（简洁/卡片/正式）；
  - 模板存 `mail_templates`（表里没有 = 用代码默认；恢复默认 = 删表行）；管理接口
    `GET/PUT /api/admin/mail/templates`、`POST .../:event/reset|preview|test`（测试发 10 秒限流、写 `mail_log`）；
  - 通知类邮件落 `mail_log`（`GET /api/admin/mail/log`），验证码仍由 `email_codes` 记录；
    登录/重置/绑定三类验证码邮件套用 `verify_code` 模板（模板被停用时回退内置纯文本，验证码是功能性邮件不断发）；
  - 「邮件服务」页新增模板卡（事件 tab、启停、主题/HTML 编辑、变量按钮、预览/发测试/套用示例/恢复默认/保存）
    与「最近发送记录」验证码/通知双 tab；`admin-ui.js` 补注册 `ElTabs`/`ElTabPane`。

- **用户彻底删除（AH 批，docs/USER-LIFECYCLE.md §3.2/§4.1/§5.1）**：
  `DELETE /api/admin/users/:username`（`confirmUsername` 必填精确匹配）——删自己 400、最后一个可用管理员 409、
  不存在 404；单事务先清 `steam_games`/`steam_wishlist`（两张表无外键）再删 `users`（其余级联，被删用户会话立即失效）；
  审计落 `admin_user_deletions`（邮箱打码、关联计数、操作者快照、可选原因，不含密码/Key/token）；
  删除后用户名可立即重新注册。前端用户表加「删除」（自己那行不渲染、最后一个可用管理员置灰）+
  确认弹窗（列出会话/Steam 账号/愿望单与标记，输入用户名才可提交，可选原因只进审计）+
  「最近删除」只读审计表（按用户名模糊搜索，`GET /api/admin/users/deletions?q=`）。
  `listUsers` 附带 `sessions`/`steam_accounts` 计数供弹窗展示。通知邮件随 AJ 批接入。

- **账号变更通知（AJ 批，docs/USER-LIFECYCLE.md §4.2/§6）**：
  - 新增 `src/account-notify.js`：8 类事件（禁用/启用/删除/改名/改邮箱/改角色/重置密码 + 邮箱绑定成功）渲染与发送，
    模块级串行队列（同进程一封一封发）、单封超时 8 秒失败不重试、每次真实发送写 `mail_log`（成功/失败都落，actor 记真实操作者）；
  - 四个入口接入：PATCH 改用户（字段实际变化才发、一次请求最多一封、优先级 禁用 > 角色 > 显示名、结果进响应）、
    改邮箱（发两封：旧邮箱「登录邮箱已变更」+ 新邮箱「绑定成功」；旧邮箱空/未验证改发新邮箱；新旧相同只发一封；解绑不发）、
    重置密码（正文绝不写新密码）、删除（异步 `notify:'queued'`）；批量禁用/启用不发（决策 9）、创建用户不通知；
  - 操作者统一「站点管理员」（`mail_log.actor` 另记真实操作者）；正文不含密码/token/API Key/IP/完整邮箱，删除原因不进邮件；
    模板停用跳过（`skipped_disabled`）、未绑定邮箱跳过并提示（`skipped_no_email`）、发送失败不影响业务（`failed`）；
    前端各入口带 notify 回执 toast。

- **Steam 代理池后端（AM-1 批，docs/PROXY-POOL.md §3/§4）**：
  - `network.steamProxy` 支持多条（换行/逗号分隔、去重、上限 10 条、非法行报行号；老单行 = 1 条且行为完全不变）；
  - 新增 `src/proxy-pool.js`：候选顺序（最近成功者粘住优先 → 配置顺序跳过冷却中的 → 全部冷却取最早解冻再试一次）、
    失败冷却 60s / 5min / 30min 封顶、成功清零；健康状态落 `data/proxy-health.json`（sha256 key 不含地址密码、
    1 秒防抖 + tmp→rename 原子写、跨子进程共享）；
  - `http.js` 把选代理挪进重试循环：只有代理层失败（连不上/超时/TLS/代理 CONNECT 4xx/5xx）才换下一条，
    目标 HTTP 5xx 与 429 不切换（429 按出口 IP 限流，切代理等于绕配额）；全部失败抛 `PROXY_ALL_FAILED` **不回退直连**；
    `GET /api/admin/proxies`（仅管理员、地址脱敏）返回每条状态（正常/冷却中/未知、连续失败、最近错误）；
    diagnose 输出代理池条数与每条状态。

### 测试

- 新增 `test/mail-templates.test.js`（7 项）、`test/notify-html.test.js`（3 项）接入主链：
  默认模板/变量转义/未知变量/页脚/text 兜底、校验（CR/LF、{{code}}、未知变量警告）、示例版式、DB 存取；
  multipart 结构、纯文本兼容、主题防注入。

- 新增 `test/admin-user-delete.test.js`（4 项）接入主链：护栏四态、级联清理 + 手动清无外键表 + 审计脱敏、
  删除后可重新注册 + 列表计数、最近删除模糊搜索（ilike/limit）。

- 新增 `test/account-notify.test.js`（8 项）接入主链：8 事件渲染与 mail_log、跳过/失败路径、串行队列、
  PATCH 四类入口与优先级、密码正文无明文、改邮箱两封（含相同只发一封/旧邮箱未验证改发新邮箱/解绑不发）、
  删除异步通知与批量不发（决策 9）。

- 新增 `test/proxy-pool.test.js`（8 项）、`test/http-proxy-failover.test.js`（7 项）接入主链：
  多条解析/候选顺序/冷却阶梯/健康文件脱敏与重启持久/设置校验（行号、≤10）/`/api/admin/proxies` 权限与脱敏；
  故障切换断言「第 2 次尝试的代理 ≠ 第 1 次」（逐次记录实际代理）+ 反例自检（`nextCandidate` 恒返第一条 → 套件变红）。

## [1.18.0] - 2026-11-06

### 新增

- **版本徽标按服务器 IP 选镜像仓库（AE 批，docs/VERSION-SOURCE.md）**：`detectRegion()`（`ipinfo.io`，
  2s 超时、成功缓存 24h / 失败 10min）→ 大陆/香港优先腾讯云 TCR、其他地区优先 Docker Hub
  （两仓库都走匿名 token，401 换新 token 重试；tag 无 `v` 前缀、过滤 `X.Y.Z` 取最大）；
  首选失败回退另一仓库、双失败回退 GitHub；结果带 `source`/`region`；成功缓存 6h / 全失败 10min。
- **后台平台链接抽屉 + 游戏名复制（AG 批，docs/ADMIN-PLATFORM-LINKS.md）**：后台「游戏管理」新增
  「链接」列（`link_count`，只计 http/https），点击打开抽屉按需加载该游戏全部平台链接
  （`GET /api/admin/games/:id/links`，按平台/区服排序、`javascript:` 过滤、无链接但有 AppID 给 Steam 兜底）；
  后台游戏名/AppID 与前台卡片/详情标题点击复制（`frontend/src/utils/clipboard.js`：clipboard API +
  `execCommand` 降级，HTTP 环境可用）。
- **同步观测与任务健康（AC-1 批，docs/SYNC-FAILURE-MODES.md §6）**：heat/rename/backfill/discover/images/
  backup/prune/alerts/report/logs-prune 全部写 `sync_runs`（后台「同步记录」可见）；重任务排队可观测
  （`scheduler.job_wait_slot`/`job_wait_end` 日志 + 状态文件 `waitingFor`）；后台任务表新增「上次结果 /
  耗时 / 失败原因 / 等待」列；`/api/admin/sync/status` 返回 `warnings`（缺 `STEAM_API_KEY` 或被
  `*_ENABLED=0` 关闭的任务），「同步与回填」页顶部显式提示。

### 修复

- **搜索态写操作后列表不刷新（AF 批，docs/FRONTEND-STALE-LIST.md）**：加/删愿望单、切换感兴趣/已拥有
  标记、取消提醒成功后先失效 30 秒搜索缓存再重拉列表（`invalidateSearchCache()`），不再"点了没反应"；
  无搜索词与缓存能力不变。

### 测试

- 新增 `test/frontend-search-cache.test.js`（6 项静态断言）与 `test/admin-games.test.js`（3 项 HTTP 级）；
  `test/version.test.js` 新增 7 项（CN→TCR / US→Hub / 401 换 token / geo 降级 / 缓存 / tag 过滤）；
  `test/scheduler.test.js` 新增 2 项（auditJobs / 状态文件健康字段）；主链 56 个文件全绿。

## [1.17.0] - 2026-11-06

### 新增

- **搜索支持中英文（含平台中文别名，AD 批 docs/SEARCH-I18N.md）**：
  - 关键词条件收敛到 `db.gameKeywordSql`——`name` / `name_en` / `game_aliases.platform_title`
    三源命中（exists 子查询防重复行），前台搜索与后台「游戏管理」搜索同口径；
  - 空格（半角/全角）在关键词与字段两侧都归一化后再包含匹配，搜「英雄连 3」与「英雄连3」结果一致；
  - 纯数字关键词继续按 AppID 精确匹配（走索引）；
  - `rename` 任务候选放开为「name 不含中文即补中文名」（写入仍走 `upsertGameMeta`，
    人工维护的名字不会被覆盖）。不做人工中文别名字段、不做拼音搜索（所有者已确认）。

### 测试

- `test/store-browse.test.js` 新增 3 项：中文命中 name 与平台别名 + 英文回归、空格/全角归一化一致、
  后台「游戏管理」搜索 HTTP 层同口径验证。

## [1.16.4] - 2026-11-06

### 修复

- **Steam 状态判定整轮静默不写库（AB 批，docs/STEAM-STATUS-FIX.md）**：
  - 根因：取 appdetails 条目时少取 `.json`（`res[appid]` 应为 `res.json[appid]`）→ 两个 entry 恒为 undefined
    → 状态判定全空 → 整轮请求 200 但 **0 行写入**，且无任何失败日志；
  - 写入不可静默：`wrote` 只统计真的写进库的行；判定不了记 `steam-status.skip_write`（debug）、
    写库未命中记 `steam-status.write_miss`（warn）；本轮全部没写入直接抛错，不再静默"成功"；
  - 限速按「每个请求」计（cn/hk 各 sleep 一次，非 429 的 4xx 也 sleep）；撞 429 立即收轮，不再睡 30 分钟空转；
  - 整轮复用数据库连接（原每条新建连接池）；每轮写 `sync_runs`（后台「同步记录」可观测）；
  - 空数组/空对象不再覆盖已有分级；`content_descriptors` 补显式 `::int[]`。
- **补 `steamStatus.initialDelaySec` 设置项（原 Y 批并入）**：`STEAM_STATUS_INITIAL_DELAY_SEC`，默认 600 秒，
  可在「系统设置」调整；`steamStatus.limit` 默认 **12000 → 6000**（约 5 小时/轮，避免单轮拖过夜撞配额）。
  **注意：库里已保存的 12000 会覆盖默认值，部署后需在系统设置里同步改。**

### 测试

- `test/steam-status.test.js` 新增 3 项：appid 不在库 → 写入未命中不算成功、空数组/空 ratings 不清空已有分级、
  `runSteamStatusRound` 一轮四态（取 `.json` 写入 / 无条目跳过不写库 / 4xx 继续 / 429 立即收轮）；
  `test/scheduler.test.js` 新增 env 覆盖用例；`test/settings.test.js` 57 项定义 + 水合断言。

## [1.16.3] - 2026-11-06

### 修复

- **后台建号「邮箱被占用却已创建用户」**：此前「建号」与「绑邮箱」是两步请求——邮箱已被其他账号
  占用时第二步报错、账号却已落库，前端提示失败后刷新列表会冒出幽灵用户，换邮箱重试又因用户名重复再失败。
  现在 `POST /api/admin/users` 支持可选 `email`，账号与邮箱同一次写入：邮箱占用返回
  409「这个邮箱已被其他账号绑定」、用户名重复返回 409「用户名已存在」（原来是 500），两者都**不产生残号**；
  老库缺 `email` 列时自动补列重试（与绑邮箱路由同款兜底）；前端改为单次请求。

### 测试

- 新增 `test/admin-users.test.js`（6 项）接入主链：带邮箱建号一次落库、邮箱占用 409 且用户数不变（原子）、
  用户名重复 409、非法邮箱 400、不带邮箱向后兼容 201、匿名 401 / 普通用户 403。

## [1.16.2] - 2026-11-06

### 修复

- **手机端详情弹窗右侧被裁（Z 批，docs/MOBILE-FIX.md）**：真机（红米 K100 Pro Max + 小米自带浏览器）
  忽略 `<meta viewport>`、按 980 排版；`main.js` 的 zoom 兜底把列表页压回正常宽度，但 **`vw` 不受 zoom 影响**，
  `.mobile-full{width:100vw}` 仍是 980 → 详情弹窗被裁。移动端全屏样式改回 `%`/`dvh`、弹窗宽度绑 `100%`，
  图片补 `max-width:100%`，删除从未生效的 `html.mobile-layout` 死规则，`html,body` 全局防横向溢出。

### 新增

- **桌面版网站渲染提示**：检测到 `screen.width≤640 && innerWidth>700` 时，移动端顶部给可关闭提示条
  （关闭状态存 sessionStorage）+「我的」页常驻说明；zoom 兜底公式保持不变。
- **安装到桌面（PWA）**：`frontend/src/composables/useInstallPrompt.js` 监听 `beforeinstallprompt` /
  `appinstalled` / `display-mode: standalone`；Chrome 可用时顶部出「安装到桌面」，不支持的小米浏览器
  在「我的」页显示 Chrome 安装说明（旧快捷方式先删再装）。
- **后台表格手机卡片化**：游戏目录与访问记录各 tab（访问明细/待审/最近设备/已封设备/黑名单/白名单/自动封禁）
  在手机上渲染卡片列表（勾选与批量操作可用，字段与表格列一致，游戏卡补齐同步状态/分级标签）；
  其余表格加「左右滑动查看更多」提示与右侧渐隐。`isMobile` 改为 760 断点响应式（resize/旋转监听）。

### 变更

- 移动端视觉微调：卡片间距 12、触摸目标统一 ≥44px、搜索框与筛选按钮等高（44px）。

### 测试

- 新增 `test/frontend-mobile.test.js`（5 项）接入主链：Home.vue 无 `100vw`/`100vh`/`mobile-layout`、
  `main.css` 含 `100dvh`/防溢出/滑动提示、`main.js` 保留 zoom 兜底、安装提示与桌面模式提示接线、
  `AdminModules` 卡片分支与 760 断点。

## [1.16.1] - 2026-11-05

### 修复

- **调度器长任务阻塞（X 批，docs/SCHEDULER-BLOCKING-FIX.md）**：
  - Steam 重任务改为「非阻塞发射 + 全局单槽」（`heavySlot`）：tick 循环不再 `await runJob(job)`，
    `steam-prices` 跑 90 分钟期间 `sonkwo`/`gog`/`alerts`/`steam-accounts` 等轻任务照常派发；
    槽位在 `.finally` 里释放并 `wake()` 立即唤醒，两个重任务并行打配额是红线（`scheduler.heavy_slot_released` 可观测）；
  - `steam-status` 归入 `STEAM_HEAVY`（此前走轻任务分支，会与价格/热度并行打 Steam 配额）；
  - 启动时从 `sync_runs` 按 mode 恢复 `lastRunMs`：发版重启不再把全部任务打回首轮延迟重新计时；
  - `data/scheduler-status.json` 每个 tick 刷新，`updatedAt` 能反映调度器存活。

### 变更

- `steam-status` 节奏（X 批已确认）：首轮延迟 6 小时 → **10 分钟**、周期每周 → **每天**、每轮上限 8000 → **12000**
  （约 5 小时/天，约两周补完 17.5 万条）。`steamStatus.limit`/`steamStatus.intervalMin` 设置项默认值同步改；
  **线上若曾在系统设置页保存过旧值，需在「系统设置」里确认/重置这两项**（设置优先级：数据库 > 环境变量 > 默认值）。

### 测试

- `test/scheduler.test.js` 22 项（+3）：`steam-status` ∈ `STEAM_HEAVY`、重任务占槽期间轻任务照常派发
  （`planTick`）、`lastRunMs` 恢复（坏行跳过、按间隔计时）；`test/settings.test.js` 默认值断言同步。

## [1.16.0] - 2026-11-05

### 新增

- **手机端 PWA（docs/MOBILE-PWA.md）**：`manifest.webmanifest`（`standalone` + `portrait`，主题色对齐暗色 token）
  与 192/512 图标（512 声明 `any maskable`，由 `web/favicon.svg` 导出）；`index.html` 补 manifest /
  theme-color / apple-mobile-web-app-* / apple-touch-icon。手机浏览器「添加到主屏幕」后全屏运行、无地址栏；
  购买仍跳 Steam 商店，**不做购物车、不做站内购买**。
- **统一网络失败提示**：`frontend/src/utils/network.js` 包装 fetch，断网/超时统一换成语义化错误
  「网络不可用，请检查连接后重试」；App.vue 顶部提示条 + 首页列表空态可重试；**不做离线缓存**，
  没有 service worker（避免"看到旧页面"）。
- **Android 返回键先关浮层**：`frontend/src/composables/useBackGuard.js` 以 `history.pushState`/`popstate`
  管理浮层栈——详情弹窗、筛选抽屉、站点通知、登录、愿望单弹窗打开时入栈，返回键只关最上层；
  仅手机结构生效，PC 端浏览器返回保持原行为。
- **版本检查与「已更新」提示（§2.1 半自动更新）**：`frontend/src/composables/useVersionGuard.js`
  启动时记 `/api/site` 的 `version` 基线，`visibilitychange` 切回前台再查，不一致 → 顶部提示
  「已更新到 vX.Y.Z，点击刷新」（全局唯一、可关闭）；`AUTO_RELOAD=false` 默认不自动刷新，
  避免丢弹窗/表单状态；离线或请求失败静默跳过、不误报。

### 变更

- `src/server.js` 的 `serveFrontendStatic` 把 `/manifest.webmanifest` 与 `/icon-*.png` 交给 `frontendDir`
  （此前会落到 `outDir` → 404，导致「添加到主屏幕」静默失效）；补 `.webmanifest` 的 MIME。
- `frontend/src/utils/network.js` 导出 `rawFetch`：版本探测这类后台请求失败不点亮全局断网提示条。

### 测试

- 新增 `test/pwa.test.js`（9 项）接入主链：manifest 字段齐全、图标存在且 PNG 尺寸正确、
  `index.html` 引用完整、前端无 serviceWorker 注册、服务端 PWA 根文件路由、版本比较纯函数
  （相等/不等/首次为空）、断网提示与 AbortError 不误报。

## [1.15.2] - 2026-11-04

### 修复

- **`STEAM_STATUS_LIMIT` 进系统设置**：此前只在调度器读环境变量，控制台看不到也改不了。
  新增设置项 `steamStatus.limit`（env `STEAM_STATUS_LIMIT`，默认 **8000** ≈ 3.3 小时/天，
  三周补完 17.5 万条；上限 200000）——「系统设置 → 数据源与采集 → 高级」可改、保存即热加载；
  调度器与 `steam-status` CLI 的默认上限同步改为 8000

## [1.15.1] - 2026-11-04

### 新增

- **后台内容分级筛选（docs/STEAM-SYNC-STATUS-AND-RATING.md §13）**：
  `GET /api/admin/games` 加 `rating=adult|mature|none`（可与搜索/平台/同步状态叠加）；
  `adminGameStats` 加 `adult` / `mature` 计数（成人+成熟+未标注 = 未删除总数）；
  后台筛选栏加「内容分级」下拉与「成人/成熟」两张指标卡（点击即筛选）；
  「全部同步状态」下拉从旧两项改为与六态指标卡一一对应
- **backfill 顺带写 Steam 状态与分级（同规格 §14.3）**：新增 `src/steam-status.js` 的 `applySteamDetails`
  共用函数（状态 `classifySteamStatus` + 分级 `classifyContentRating` + 落库 `setSteamStatus`）；
  `cmdBackfill` 的 appdetails 回退路径逐条调用（省约 6.9 万次重复请求），`cmdSteamStatus` 改调同一函数，口径唯一

### 变更

- `db.setSteamStatus` 写入语义收紧：`status=null` 不写 `steam_checked_at` 游标（留给 steam-status 判定）；
  分级字段传 `null` 用 `coalesce` 不覆盖已有值；`adultFlag`/`matureFlag` 传 `null` 不覆盖

### 测试

- `test/steam-status.test.js` 6 → 10 项：`entryFromMeta` 分支、全写/不写游标/不覆盖已有分级、重复跑幂等
- `test/api.test.js` 新增筛选用例：成人/成熟/未标注筛出正确、与状态叠加、三者之和=未删除总数

## [1.15.0] - 2026-11-04

### 新增

- **Steam 同步状态可解释（docs/STEAM-SYNC-STATUS-AND-RATING.md）**：
  - `games` 加 7 列幂等迁移（`steam_status` / `steam_checked_at` / `required_age` / `content_descriptors` /
    `age_ratings` / `adult_flag` / `mature_flag`）+ partial index；免费游戏一次 SQL 置位（2.3 万条不发请求）
  - 六态状态机：`ok` / `free` / `coming_soon` / `region_locked` / `no_price` / `not_found` / 未探测——
    每款游戏能回答"为什么没有价格"；「待同步」重定义为 未探测 或 `ok` 缺简介，9.2 万不再永远不归零
  - `steam-status` 任务并入调度器（默认每周、首轮延迟 6 小时避开热度播种期）：逐 appid 全量 appdetails
    （`cc=cn`，`success:false` 补 `cc=hk` 判定锁区），状态与分级**共用同一次请求**，`steam_checked_at` 作续跑游标，
    失败不写游标下轮重试；与 heat/backfill/catalog/价格共用 Steam 配额、任务互斥
- **锁国区标注**：国区不可售但港区可售/免费 → `region_locked`，后台标「锁国区」，前台标「国区不可售」且不出国区价格（不隐藏）
- **内容分级标注**：`required_age` / `content_descriptors` / `age_ratings` 原样落库；按平台标签派生
  `adult_flag`（descriptors 3/4 或 ESRB AO）与 `mature_flag`（descriptors 2/5、PEGI≥18、required_age≥18）——
  只做平台标签→站点策略映射，不做法律定性。新设置 `site.adultDisplay` = `hide`（默认，前台不显示、后台可见）/
  `badge`（带「成人内容」角标）/ `show`；`steamStatus.rateMs` / `steamStatus.intervalMin` 可调
- **后台指标卡重定义**：游戏目录改为 已同步 / 未探测 / 免费 / 未发售 / 锁国区 / 国区无价 / 国区不可售 / 其他 分项
  （点击即按 `status` 筛选），列表新增「同步状态」「分级」两列

### 测试

- 新增 `test/steam-status.test.js` 6 项并接入主链（六态判定、分级派生、迁移置位、任务写回/续跑、前台成人过滤）；
  `npm test` 48 个文件全绿；scheduler / settings / setup / api 的计数断言同步更新

## [1.14.2] - 2026-11-04

### 新增

- **仅封禁可见页面统一守卫（docs/BAN-AND-SECURITY-FIXES.md）**：
  - `BAN_ONLY_PAGES` 注册表（`/banned`、`/banned/`、`/banned.html`、`/appeal`、`/appeal/`）：未封禁 / 管理员 /
    封禁已过期访问一律 302 回首页；判定只在拦截链（只读复用 `deviceBan` / `blockedBy` / `bannedUntil`，
    页面路由零二次判定）
  - 新增只读接口 `GET /api/ban/state`（豁免拦截链与频率计数、只用内存态、自带 1 次/秒 + 30 次/分钟限流，
    只回调用者自己的 `{banned,type,until}`）；前端共享 `useBanOnlyPage` composable（挂载 + 每 30 秒 + 切回标签页复查），
    解封后自动回首页
  - `ban.page_view` 观测日志（`at: gate|ban_only` + `mobile`），`ban.redirect_home` 带 `from`
- **黑/白名单双向互斥（同规格 §4）**：加黑自动移白、加白自动移黑（单条与批量回执 `removedFromWhitelist/Blacklist`）；
  `banIpExclusive` 收敛单条/审核/批量四个入口；`migrate()` 幂等存量清理（白名单优先，被覆盖的临时封禁一并清空）
- **待审口径 A（同规格 §5）**：待审 = 全部 `pending`（去掉 `NOT_ACTIVE_BAN` 二次过滤，列表与计数同口径）；
  状态列补全 待审 / 已封禁 / 已忽略 / 自动退出 四种标签 + 悬停备注与处理时间
- **申诉 URL 去敏感化（docs/URL-PARAM-PRIVACY.md 方案 A）**：`/appeal` 只带 `?code=AP-XXXXXX`，
  站点名与申诉邮箱由服务端注入 `window.__APPEAL__`（封禁用户调不了 `/api/site`）；申诉页不再展示原因/解除时间，
  旧链接多余参数忽略并在前端清洗地址栏

### 修复

- 申诉编号 `Math.random()` → `crypto.randomBytes` + 去易混字符（0/O/1/I），保持 `AP-XXXXXX`
- `/banned*`、`/appeal*` 响应带 `X-Robots-Tag: noindex, nofollow`；`/appeal` 补 `Cache-Control: no-store`；
  新增 `GET /robots.txt`（Disallow `/console` `/banned` `/appeal` `/api/`）
- 申诉 `code` 白名单整串校验（`^[A-Za-z0-9-]{1,16}$`，非法按空处理、不反射输入）

### 测试

- `test/reviews.test.js` 19 → 24 项：`BAN_ONLY_PAGES` 逐页遍历（未封禁 302 / 被封禁 403 或 200）、
  `/api/ban/state` 三类型与豁免与限流、待审口径 A
- `test/visitors.test.js` 5 → 8 项：互斥（store 层 / 迁移清理 / HTTP 层内存态）
- `test/admin-bulk.test.js` 12 → 13 项：批量互斥回执
- 新增 `test/appeal-security.test.js` 6 项并接入主链：302 / 注入 / 非法 code / robots / 响应头 / 编号随机 / 前端静态断言

## [1.14.1] - 2026-11-03

### 修复

- **封禁页守卫（docs/BAN-PAGE-GUARD.md）**：`/banned` 不再无条件返回 403 封禁页——未封禁的人
  （手动输入网址、收藏夹、封禁到期后刷新、管理员）此前会看到「解封时间：暂未设定」的假封禁页。
  现在 `/banned` 一律 302 回首页（`location: /`、`cache-control: no-store`、日志 `ban.redirect_home`）：
  判定只在拦截链（设备封禁 / 频率封禁 / IP 黑名单三道闸）完成，真正被封禁的请求仍由 `denyBanned`
  返回封禁页（403/429）；页面路由不做二次判定（避免第二份口径、误伤管理员与白名单）。
  前端 `BanPage.vue` 加 `__BAN_PAGE__` 缺失守卫（`location.replace('/')`），SPA 内部误入不再渲染假封禁页。

### 测试

- `test/reviews.test.js` 新增 7 条封禁页守卫断言（19 项）：未封禁 302（含 `/banned/`）、IP 黑名单命中 403
  （注入 `__BAN_PAGE__`）、设备封禁 403（换 IP 同样）、频率封禁 429 + `Retry-After`、管理员 bypass 302、
  封禁过期 302、日志事件（`ban.redirect_home` / `ban.page`）与 BanPage 守卫静态断言

## [1.14.0] - 2026-11-03

### 新增

- **后台 11 个列表批量操作（docs/ADMIN-BULK-ACTIONS.md）**：
  - 统一入口 `POST /api/admin/bulk`：`src/server.js` 的 `BULK_ACTIONS` 白名单派发表（19 个 target/action）、
    单次上限（高危 50 / 常规 200 / 回收站恢复 1000）、高危动作**服务端**二次校验 `confirmCount`、
    逐条回执（`ok` / `skipped` / `failed` + 原因），单条失败不影响其它条
  - 覆盖：待审列表（封 IP / 封设备 / 忽略）、访问明细（封 IP / 信任加白）、回收站（恢复，含「全选当前筛选」≤1000）、
    站点通知（删除 / 启用 / 停用）、IP 黑名单（解封）、IP 白名单（移除）、已封设备（解封）、自动封禁记录（解封）、
    游戏目录（禁用 / 启用 / 删除进回收站）、最近设备（封禁 10 分钟 / 1 小时 / 1 天 / 永久）、用户管理（禁用 / 启用）
  - 内存态同步：黑名单、白名单、设备封禁改动后立即刷新，不需重启（验收用"解封后再访问 200"验证）
  - 用户批量禁用守卫：不能禁用自己、不能禁用最后一个可用管理员（409）；禁用后立即删除该用户会话
  - 审计表 `admin_bulk_ops` + 后台「系统 → 批量操作记录」页（操作者/时间/目标/动作/总数/成功/失败/耗时 + 键样本详情）
  - 前端复用件 `useBulkSelection`（键去重 + 翻页清空）、`BulkBar`、`BulkResultDialog`；移动端卡片列表补勾选框

### 修复

- **`admin-ui.js` 漏注册 `ElRadio` / `ElRadioGroup`**：控制台「设备封禁」弹窗的时长单选此前静默不渲染；
  本次批量封禁复用同一交互，补齐注册并加 `test/frontend-registration.test.js` 防回归

### 测试

- 新增 `test/admin-bulk.test.js`（12 项，真 PGlite + 真 HTTP）并接入 `npm test` 主链：
  前端接入静态断言、鉴权、参数整单拒绝、单次上限、高危确认、内存态同步、公告部分失败、用户守卫与会话失效、
  设备封禁/解封、回收站、审计查询、键规范化与去重

## [1.13.0] - 2026-11-03

### 新增

- **后台功能对齐（docs/ADMIN-PARITY.md）**：
  - 「访问与安全」新增第 4 个 tab「设备」：最近设备表（`GET /api/admin/devices`）+ 按时长封禁
    （10 分钟/1 小时/1 天/永久，`POST /api/admin/devices/ban`）+ 已封设备表（`GET /api/admin/device-bans`）
    + 解封（`DELETE /api/admin/device-bans/:fingerprint`，二次确认）
  - 游戏目录工具栏「高级」→「合并重复游戏」弹窗（源/目标 AppID → `POST /api/admin/games/merge`，
    成功提示迁移/去重条数并刷新列表）
  - 运行日志页新增「同步记录」表（`GET /api/admin/sync/runs`，列：开始时间/模式/状态/请求数/总量/
    成功/跳过/失败/耗时/备注，失败行标红）；后端 `listSyncRuns` 附带同一轮 fetch_runs 汇总
  - 任务实时进度：任务运行中轮询 `GET /api/admin/backfill/status`，显示
    `已完成 X / 总 Y（Z%）· 速度 N 款/分钟 · 预计剩余 M 分钟`

## [1.12.1] - 2026-11-03

### 修复

- **申诉邮箱回退链被空串截断**：`appealEmail()` 原来用 `??` 链，而设置水合会把未填的
  `ALERT_EMAIL_TO` 写成空字符串（非 null），导致「发件人/SMTP 账号」明明有值也取不到——
  新增 `src/appeal.js` 的 `appealEmailFrom`（`||` 链 + trim：申诉邮箱 → 邮件收件人 → 发件人 → SMTP 账号）；
  新增系统设置「申诉邮箱」（`alerts.appealEmail`，留空按上述顺序回退，保存即热加载）

### 变更

- **邮件配置合并到「邮件服务」页**：新增「邮件配置」卡片（`MailSettingsForm.vue`，自包含加载/渲染/保存，
  8 个邮件字段按 schema 顺序、secret 留空保持原值/勾选清空传 null、保存后 emit 刷新状态卡）；
  系统设置页过滤邮件 key，「降价提醒」分组改为「通知与提醒」（提醒开关与间隔、Webhook/企业微信，
  邮件配置在邮件服务页）；系统设置保存不再提交邮件 key（docs/MAIL-CONFIG-PAGE.md 方案 A）

## [1.12.0] - 2026-11-03

### 修复

- **封禁页跳转（最终方案）**：v1.11.0 在 main.js 里 `router.replace('/banned')` 实测无效
  （ES module 提升导致 `createWebHistory` 已按旧地址初始化）——改为 `serveBanPage` 注入的内联脚本
  在模块加载前 `history.replaceState(null,'','/banned')`（`/banned`、`/appeal` 除外）；
  main.js 移除无效跳转。无头 Edge 实测：注入后 `pathname==='/banned'`、`.ban-card` 存在、
  `.storefront` 不挂载、`/appeal` 正常放行
- **验证码加载失败提示**：`loadCaptcha` 失败时 `ElMessage.warning('验证码加载失败，点击验证码重试')`，
  空态显示可点击的「点击重试」占位块（封禁/断网时不再只剩破图）

## [1.11.0] - 2026-11-03

### 修复

- **抽屉/角标/复选框未注册（v1.6.0 起的隐性 bug）**：main.js 补注册 `ElDrawer`/`ElBadge`/
  `ElCheckbox`/`ElCheckboxGroup`（含样式）——此前 `<el-drawer>` 等被当普通标签渲染，导致手机
  筛选/我的菜单/通知抽屉点不开、内容铺在页面流里、未读角标不显示、愿望单弹窗无法勾选账号
  （**推送到 Steam 账号从未真正可用**）
- **封禁页入口**：main.js 在 mount 前读取服务端注入的 `window.__BAN_PAGE__` 并
  `router.replace('/banned')`（`/banned`、`/appeal` 除外防死循环）——被封用户刷新任意路径
  直接看到封禁卡片与「申请解封」入口
- 新增 `test/frontend-registration.test.js` 静态防回归断言（组件注册 + __BAN_PAGE__ 跳转）

## [1.10.0] - 2026-11-03

### 修复

- **移动端真机适配（强制 viewport）**：红米 K100 Pro Max 实测「桌面版网站」模式下字体小、按钮点不中——
  根因是布局视口仍按 ~980px 缩放。修复：`frontend/index.html` 内联脚本在
  `screen.width<=640 && innerWidth>700` 时改写 viewport 为 `width=390, initial-scale=1,
  maximum-scale=1, user-scalable=no`（sessionStorage 防循环 reload 一次）；main.js 提供 zoom
  兜底（meta 无效内核）；`-webkit-text-size-adjust:100%` 防系统二次缩放；移动端字号基线校准
  （正文 ≥14px、tab 15px、底部导航 56px + 安全区、抽屉内容 `max-height:70vh` 滚动）；
  新增 `?debug=1` 调试浮层（innerWidth/screen.width/DPR/isMobile/desktopMode/UA）供真机截图自检。
  真机 14 项清单见 [docs/MOBILE-VIEWPORT.md §4](docs/MOBILE-VIEWPORT.md)

## [1.9.0] - 2026-11-03

### 新增

- **封禁标记（替代「仅过滤」）**：封禁动作发生时——`rate`/`rate-day`/`path` 自动封禁、手动黑名单、
  审核「封 IP」——把该 IP 的所有 `pending` 审核标记为 `auto_banned`（note 区分「自动封禁/手动封禁」），
  旧记录**永久退出待审**（解封不恢复）；该 IP 之后的新异常仍生成新 pending（不永久屏蔽）；
  审核列表 `status` 支持 `pending | all`（all 为审计视图）；`NOT_ACTIVE_BAN` 保留作双保险
- **移动端独立设计**：`isMobile` 判定（`max-width:640` 或「桌面版网站」特征
  `screen.width<=640 && innerWidth>700`）后 `v-if` 双结构，PC 不再被 CSS 断点压缩——
  移动端：52px 顶栏（Logo+铃铛+菜单）、搜索行、筛选 chips、分段 tab、单列大卡（标题 16px/价格 21px/
  按钮 ≥44px）、底部 4 入口（首页/心愿单/已拥有/我的）、筛选底部弹层（单选组+应用/重置）、
  全屏详情 + 底部固定操作栏、「加载更多」分页；触摸与安全区按规格

### 修复

- **PC 筛选区**：工具栏恢复单行（搜索 flex + 4 个 132px 下拉 + 刷新），筛选抽屉只在移动端渲染，
  窄断点覆盖规则不再波及 PC（1920/1440/1280 无回归）

## [1.8.0] - 2026-11-03

### 新增

- **愿望单归属**：列表/详情返回 `wishlisted_by[{steamId,name}]` 与 `site_wishlisted`（本站手动项）；
  卡片徽标「愿望单 · FF、Happy」（>2 个 `+N`），详情列全并悬停显示 SteamID；
  添加弹窗标注「已在愿望单」且默认不勾选，`POST /api/wishlist` 返回 `alreadyIn` 不重复推送
- **愿望单选择性移除**：`DELETE /api/wishlist/*` 接受 `{ steamIds, siteWishlist }`——移除弹窗列出
  「本站 + 各账号」默认全选、可取消勾选；缺省 body 保持旧行为（删本站 + 回推全部持有账号）
- **站点通知中心**：顶栏铃铛 + 未读角标 + 抽屉（未读高亮、已读淡色、全部标为已读）；
  登录用户已读状态存服务端（新表 `announcement_reads`，`GET /api/announcements` 附 `readIds`，
  `POST /api/announcements/read` 写入，跨设备跟随账号）；游客仍存本地（兼容旧 max-id 格式）；
  进站未读弹窗保留
- **移动端响应式重做**：断点 1024/768/480；「桌面版网站」兜底判定
  （`screen.width<=640 && innerWidth>700`）给 `<html>` 加 `mobile-layout` 类强制移动布局——
  单列卡、筛选进抽屉、顶栏精简（菜单收主题/登录）、详情全屏、已拥有/愿望单按钮收进详情、
  触摸目标 ≥44px、字号 ≥13px；PC 布局无回归
- **调度器轻任务并行**：sonkwo/itad/gog/humble/discover/steam-accounts/backup/logs/alerts/images
  可在 Steam 重任务（heat/steam-prices 等，仍严格串行且与手动同步互斥）运行时并行执行，
  并发上限 `SCHEDULER_LIGHT_CONCURRENCY`（默认 3，1–8）——解决 heat 首轮播种期其它源被饿数小时的问题；
  chart 后续任务串行执行避免并发写静态页

### 修复

- **自动封禁的 IP 不再出现在「异常审核」待审列表与计数**（`listAbuseReviews`/`countPendingReviews`
  排除 `ip_abuse.banned_until > now()`；只过滤显示不改状态，解封后自动恢复）

### 变更

- **移除账号库「DLC」列与 `*` 标记**：`IPlayerService/GetOwnedGames` 只返回游戏、不含 DLC 拥有记录
  （Steam 公开 API 限制），DLC 数天然恒为 0 且易误导——账号列表上方改为诚实说明
  「Steam API 不返回 DLC 拥有数据」，同步提示去掉「其中 DLC N 款」；`type_unknown` 仅留日志/诊断
  （方案 A，见 [docs/STEAM-DLC.md](docs/STEAM-DLC.md)）

## [1.7.0] - 2026-11-02

### 新增

- **账号库 DLC 统计**：`GetOwnedGames` 本身不带游戏类型字段，账号库的 DLC 数量按目录
  `games.app_type` 统计；后台「Steam 账号」页新增 **DLC 列**（与游戏库/愿望单并列），
  类型未知的游戏标 `*` 并悬停提示
- **同步时自动补全目录类型**：库同步后，把该账号拥有的、目录里 `app_type` 缺失的 appid
  批量走 `IStoreBrowseService/GetItems`（一次 100 个）补全类型——只挑缺失的，天然收敛
  （补全后每日同步近乎零额外请求）；补全失败只记日志（`steam.app_types_failed`），不影响同步。
  手动「同步游戏库」的完成提示同步带上「其中 DLC N 款」

### 变更

- 绑定成功、手动同步、调度器每日 `steam-accounts` 任务都带类型补全步骤；
  日志新增 `steam.app_types_backfilled` / `steam.app_types_missing`（带 steamId 与计数）

## [1.6.0] - 2026-11-02

### 新增

- **手动愿望单 + 推送到 Steam 账号**：前台游戏卡/详情新增「愿望单」按钮——加入本站的同时
  写进所选 Steam 账号的愿望单；绑定 1 个账号直接推送，多个账号弹窗多选（可「仅加入本站」）。
  新表 `user_wishlist` 存手动愿望单（`steam_ids` 记录推送账号），前台「愿望单」推导 =
  手动 ∪ Steam 同步；手动项同样自动加入价提醒（`watchlist.source='user_wishlist'`，史低提醒）
- **每账号自配 API Key**：Steam 写愿望单必须用该账号自己注册的 Web API Key
  （`IWishlistService/AddToWishlist` 未文档化接口，见 [STEAM-ACCOUNTS.md §16](docs/STEAM-ACCOUNTS.md)）。
  后台「Steam 账号 → API Key」配置，AES-256-GCM 密文存储、不回显；未配 Key 的账号同步不受影响，
  只是不能推送/回推
- **移除同步回推**：`DELETE /api/wishlist/:appid` 清站点行与自动提醒，并向「添加时选过的账号 ∪
  愿望单里持有该条目的账号」推 `RemoveFromWishlist`；推送失败只记日志，由每日同步对账收敛

### 变更

- 愿望单推送采用防御式解析：HTTP 2xx 且响应无显式 `success:false` 即成功；成功乐观写
  `steam_wishlist`，Steam 若实际未接受，每日 `steam-accounts` 同步差集删除兜底
- 新增日志事件：`adapter.steam.wishlist_add_ok/_failed`、`adapter.steam.wishlist_remove_ok/_failed`、
  `steam.wishlist_manual_add/remove`（带 steamId / appid / 原因）

> **已知限制**：AddToWishlist 属未文档化接口，真实行为需服务器上线后实测验证（本机无 Steam 出口）。

## [1.5.0] - 2026-11-02

### 新增

- **Steam 多账号绑定**：每个站点用户可绑定最多 5 个 Steam 账号，一个 Steam 账号只属一人。
  绑定走 OpenID + 一次性 state（防 CSRF，5 分钟过期），必须已登录站点账号；回调校验 state 后
  检查唯一性/上限（占用与超限返回 409），成功后自动同步该账号的游戏库与愿望单。
  后台「Steam 账号」页改为账号列表：同步游戏库/愿望单、改别名（前台徽标优先显示别名）、
  解绑（级联清理数据与愿望单自动提醒）、认领历史未归属账号；存量账号也可用 CLI `steam-claim`
  或 compose 配置 `STEAM_CLAIM_USERNAME`/`STEAM_CLAIM_STEAM_ID` 由调度器幂等认领
- **「已拥有」按用户推导**：前台「已拥有」= 手动标记 ∪ 该用户所有绑定账号游戏库的并集；
  `user_game_flags.owned=false` 永久排除（再同步不恢复，可点「恢复已拥有」回到跟随推导）；
  列表/详情返回 `owned_by[{steamId,name}]`，卡片显示「已拥有 · FF、XX」（>2 个 `+N`，详情列全）。
  全局 `games.owned` 废弃（前台不再读取）；已拥有/谁拥有仅当前登录用户可见
- **愿望单同步 + 独立标签页**：新增 `steam_wishlist` 表，前台新增「愿望单」标签页；
  愿望单游戏自动加入价提醒（`watchlist.source='steam_wishlist'`，目标价为空 = 史低提醒，
  手动设过的目标价不被覆盖）；移出愿望单/解绑只清理自动提醒
- **调度器每日 `steam-accounts` 任务**：所有已绑定账号逐个串行同步库与愿望单（间隔 ≥1s，
  单账号失败只记日志继续下一个），需要 `STEAM_API_KEY`；
  `STEAM_ACCOUNTS_INTERVAL_MIN` / `STEAM_ACCOUNTS_SLEEP_MS` 可调

### 修复

- **库/愿望单同步只增不删**：同步改为差集删除（`appid <> all(本次集合)`），账号移出库/愿望单的
  游戏不再残留——旧逻辑会让「已拥有」在退库后永远不消失
- **绑定回调对非浏览器客户端**：成功绑定一律 302；错误按请求方返回 302（浏览器回控制台展示）或
  JSON 状态码（API 客户端拿到 400/409 与错误码）

### 变更

- `steam_sessions` 停用（表保留不再写入）：Steam 身份改由站点会话决定，旧 `steam_session` cookie 直接失效
- 前台游客不再显示「已拥有」标签页与已拥有标记（本地已拥有标记一并移除，愿望单/已拥有是登录用户专属维度）
- 规格与实现记录见 [docs/STEAM-ACCOUNTS.md](docs/STEAM-ACCOUNTS.md)，验收标准 §14 全数覆盖
  （`test/steam-accounts.test.js` + `test/scheduler.test.js` 断言）

## [1.4.9] - 2026-11-02

### 修复

- **Steam 登录校验永远失败（`snippet="[object Object]"`）**：`verifyCallback` 把 `fetchText`
  返回的 `{ body, status, … }` 对象直接当字符串匹配，`/is_valid/` 永远匹配不上——
  连接再正常也会判"Steam 校验失败"。改为读取 `body` 文本，并补回归测试
  （`is_valid:true` 通过、`is_valid:false`/HTML 拒绝）。此 bug 自首次实现 OpenID 登录就存在

## [1.4.8] - 2026-11-02

### 修复

- **Steam 登录"Steam 校验失败"**（大陆应用服务器 + 香港代理的典型场景）：明文 HTTP 代理的
  `CONNECT steamcommunity.com` 被大陆→香港链路的 DPI 重置，导致 OpenID 二次校验失败。
  应用侧支持 **https 代理**（TLS 壳）：`proxyAgentOptions` 对 `https://` 代理放行自签证书
  （`proxyTls.rejectUnauthorized=false`，TLS 只负责隐藏 CONNECT 目标域名）。
  运维侧配套：香港代理机用 stunnel（或 gost）给 tinyproxy 加 TLS 壳、安全组放行新端口、
  「系统设置 → 网络 → Steam 专用代理」填 `https://用户:密码@代理:8531`（详见 DELIVERY 排障记录）

## [1.4.7] - 2026-10-30

### 新增

- **游戏目录指标卡即筛选**：目录游戏 / 待同步 / 已同步 / 有报价 四张卡可点击，点一下下方列表按对应
  口径刷新（当前生效的卡高亮，再点一次取消；与「同步状态」下拉联动）；「已删除」卡点击跳转回收站
- `GET /api/admin/games` 新增 `offers=priced|none` 参数（对应「有报价」口径）
- 控制台支持 URL `?section=` 联动切换选中页（回收站跳转复用）

## [1.4.6] - 2026-10-30

### 变更

- **「同步与回填」页精简为一表 + 状态卡**：去掉 6 个卡片、4 组参数输入框和「① 导入目录 / ② 增量同步」按钮；
  五个任务（价格刷新 / 目录同步 / 增量回填 / 重写名字 / 热度回填）各一行，显示频率、上次/下次运行、
  状态（空闲 / 运行中 / 失败 N 次 / 熔断至）与「立即运行」（默认参数，任务互斥）；
  运行中的任务在下方状态卡显示实时输出，可「停止」
- 控制台移除 `steamall`（增量同步）入口——功能已被 `backfill`（批量 GetItems）覆盖且快 3-4 倍；
  CLI 与 `POST /api/admin/sync` 的 `steamall` 兼容保留
- `POST /api/admin/sync` 的 `mode` 白名单扩为 `catalog` / `steam-prices` / `steamall`（缺省 `steam-prices`）

### 新增

- **时间字段时区设置化**：新增系统设置「时区」（`system.timezone`，env `TZ`，默认 `Asia/Shanghai`）。
  保存后：数据库会话时区随连接生效（`current_date` / `date_trunc` 的"按天"归属、psql 时间显示都是东八区），
  日志 `ts` 改为带偏移的 ISO（如 `2026-10-30T16:42:23+08:00`）、日志文件按本地日期分片，
  前端所有时间显示改用站点时区（`/api/me` 下发，`Intl` 指定 `timeZone`），不再跟随浏览器本地时区。
  时区校验白名单 + 非法回落 `Asia/Shanghai`；运行中改设置约 30 秒内新连接生效，重启保证全部生效
- 后台侧栏版本徽标移到顶部右侧（与主题切换并排，有新版时高亮提示）；
  侧栏底部改两行布局并加 `overflow` / `flex` 收缩约束，修复徽标被挤出侧栏的问题（[UI-FIXES.md](docs/UI-FIXES.md) 第 1 条）

## [1.4.5] - 2026-10-30

### 新增

- **控制台「重写名字」卡片**（游戏管理 → 同步与回填）：可直接触发/停止 `rename`，
  最多处理 / 每批 / 间隔可调，实时显示批次进度（已处理、带回中文名、失败）；
  对应新接口 `POST /api/admin/rename`、`POST /api/admin/rename/stop`、
  `GET /api/admin/rename/status`（管理员权限；与同步/回填/热度共用子进程槽位，忙时 409）
- `src/backfill.js` 新增 `renameArgs` / `parseRenameProgress`（rename 批次行多「带回中文名」字段，独立解析）

### 修复

- 状态文件 `scheduler-status.json` 的 `nextRunAt`：从未跑过的任务按首轮延迟计算，
  不再显示成"一个间隔之后"（此前 rename 首轮会显示成一周后，实际是 2 小时后）

## [1.4.4] - 2026-10-30

### 修复

- **TCR 镜像缺版本 tag（v1.4.3 部署报 not found）**：`docker-tcr` 工作流的版本号 tag
  原来只取 `package.json`（当时仍为 1.4.0，历史发布未按规范 bump），导致腾讯云 TCR 上
  没有 `1.4.3` 这个镜像 tag，服务器 `docker compose up` 拉取失败。修复：
  1. 工作流改为**打 tag 触发时取 git tag**（去 `v` 前缀），手动触发才回退 `package.json`；
  2. 本次补 `npm version 1.4.4`，镜像内版本号与控制台显示、镜像 tag 重新对齐
- 发布与升级流程、服务器操作边界固化进文档：[docs/DEPLOY.md](docs/DEPLOY.md)、
  [docs/DELIVERY.md](docs/DELIVERY.md)、[CONTRIBUTING.md](CONTRIBUTING.md)（硬规则 4：
  服务器操作由部署人员执行，仓库不保存服务器凭据）

## [1.4.3] - 2026-10-30

### 修复

- **同步游戏没有中文名**（生产 19.6 万行里仅 1.14 万有中文名）：目录导入
  （`IStoreService/GetAppList` 无语言参数）把英文基础名写进了 `name`，而回填的
  名字写入是"只补空缺"（`coalesce(games.name, …)`），中文名拿到后被静默丢弃。
  修复分三层：
  1. `importCatalogGames`：目录导入按内容分流——含中文的写 `name`，否则写 `name_en`，
     `name` 留空等回填补 schinese 本地化名
  2. `upsertGameMeta` / `ensureGame`：允许用中文名覆盖"机器英文名"
     （`name_en` 为空且 `name` 不含中文），并把被替换的英文名挪进 `name_en`；
     人工维护的名字（中文名、或 `name_en` 已有人工值）仍然不被覆盖
  3. 新增 CLI `node src/cli.js rename`：存量修复，挑"name 为空或仍是机器英文名"的行
     用 GetItems 重取覆盖（`--limit 200000 --batch 100 --sleep 1500`，无简中的行保持英文）；
     **已纳入调度器**：每周自动跑一轮（`STEAM_RENAME_LIMIT / STEAM_RENAME_INTERVAL_MIN` 可调，
     与后台手动同步/回填互斥，跑完自动重建静态页），无需每次人工执行
- **调度器补齐"纯系统跑"的两块人工缺口**（目标：部署后不需要人去服务器执行任何命令）：
  1. 新增 `catalog` 任务：每周同步 Steam 全量目录（幂等），新游戏自动进库，需要 `STEAM_API_KEY`，
     可调 `STEAM_CATALOG_INTERVAL_MIN / STEAM_CATALOG_INITIAL_DELAY_SEC`
  2. 新增 `backfill` 任务：每周增量回填元数据/说明/价格（`STEAM_BACKFILL_LIMIT` 默认 20000），
     有说明+报价的游戏自动跳过、没活秒退
  3. Steam 重任务（价格/热度/改名/回填/目录）统一与后台手动任务互斥，避免并行冲击限流；
     backfill 写报价后自动重建静态页
- 贡献指南新增硬规则 3：新命令/新数据任务必须同步进自动调度，人工命令不得成为上线必经步骤
  （见 [CONTRIBUTING.md](CONTRIBUTING.md#三条硬规则)）
- **回填不写 `app_type`**：真实 GetItems 的 `type` 是数字枚举（Game=0、DLC=4、…），
  旧实现按字符串判断且 0 是 falsy，导致 `app_type` 永远为空（生产仅 1,180 行有值，
  全部来自 appdetails 路径）；`mapStoreItem` 改为按 EStoreAppType 枚举表映射
- 展示兜底：`name` 为空时前台/报表回退显示 `name_en`
  （`coalesce(nullif(g.name,''), nullif(g.name_en,''), 'appid:'||appid)`）
- `sync itad` 检索名回退：`name` 为空时用 `name_en`（英文名更适合 ITAD 搜索）

## [1.4.2] - 2026-10-30

### 修复

- **热度回填改为逐 appid 请求**：实测 Steam appdetails 只要 appids 多于 1 个，
  无 filters 或 `filters=recommendations,release_date` 都返回 400，批量只接受
  `filters=price_overview`；单 appid 请求 69 字节可用，因此逐款回填
  （约 1.7s/款，全量约 90 小时，靠 `heat_at` 游标分多周续跑）
- 调度器热度任务参数同步：`--limit 20000 --sleep 1700`（去掉 `--batch`）
- 1.4.1 的"失败批次记 heat_at 防原地打转、4xx 立即中止"保留，并细化到单 appid 粒度

## [1.4.1] - 2026-10-30

### 修复

- **热度回填线上 400 空转**：批量 appids + `filters=recommendations,release_date` 被 Steam 拒绝
  （批量时 filters 白名单只有 `price_overview` 类，单 appid 才接受 recommendations）；
  改为**不带 filters** 的全量批量请求，并顺带把 `app_type` 一起回填
- **失败批次不再原地打转**：网络类失败的本批写 `heat_at` 跳过（下轮调度再试），
  游标继续前进；4xx（含 429/风控）立即中止任务，不再烧配额反复重试同一批

## [1.4.0] - 2026-10-30

批次 5：安全加固 + 体验修正（排查结论见 [docs/ROADMAP.md](docs/ROADMAP.md)）。

### 变更

- **「全部」页签改为「未标记」口径**：排除已标 感兴趣 / 不感兴趣 的游戏（已拥有本就由
  `owned=exclude` 排除）；`POST /api/games/search` 新增 `marks=unmarked`（登录用户按个人标记行判断，
  游客按 `guestFlags.excludeIds`），旧行为 `marks=any` 不变
- **首页工具栏响应式**：`≤1200px` 时搜索框独占一行、四个下拉两列排布（`min-width:118px`），
  宽屏单行；不再出现控件被挤成 10px 间距
- **热度周任务上限 5000 → 20000**（`STEAM_HEAT_LIMIT`）：10.6 万条有价游戏从 21 周轮一遍
  缩短到约 5 周

### 新增

- `node src/cli.js prune`：定期清理 `visitor_logs`（180 天）/ `fetch_runs`、`sync_runs`（90 天）/
  `email_codes`（7 天），调度器每周执行（`PRUNE_INTERVAL_MIN` / `PRUNE_ENABLED`）
- `VISITOR_GEO=0`：不再把访客 IP 发给第三方归属地服务（隐私开关）

### 安全

- Steam 登录回调地址只信任可信反代：`TRUST_PROXY=1` 且来源在 `TRUSTED_PROXY_IPS` 时才采纳
  `X-Forwarded-Host/Proto`，防 Host/协议伪造（新增 `test/steam-login.test.js` 3 项）
- 全站响应带 `Content-Security-Policy-Report-Only`（观察阶段，`default-src 'self'` +
  Element Plus 所需 inline style；跑稳后转强制）

### 测试

- `npm test` 44 文件全绿；`api.test.js` 新增「未标记」过滤 5 条断言（含游客 `excludeIds`）；
  scheduler 测试覆盖 prune 任务与新热度上限

## [1.3.0] - 2026-10-30

热度排序与发行时间筛选（计划 `docs/PLAN.md` 批次 4）。

### 新增

- `games` 新增 `heat / heat_reviews / heat_at` 列与 `(heat desc)` 索引；
  热度公式 = `log10(1 + 评测数) * 0.7 + 新作加权 * 0.3`（发行满 1 年衰减到一半）
- 新命令 `node src/cli.js heat --limit 200000 --batch 30 --sleep 1700`：
  用 `appdetails?filters=recommendations,release_date` 批量回填评测数与发行日期
  （30 个/批、约 1.7 秒间隔，全量约 3 小时）；按 `heat_at is null` 自动续跑，
  成功与否都记 `heat_at` 防止同一批反复选中
- 后台「游戏管理 → 同步与回填」新增热度回填卡片（开始/停止/最近输出），
  接口 `POST /api/admin/heat`、`/api/admin/heat/stop`、`GET /api/admin/heat/status`
- 调度器每周跑一次 `heat`（`STEAM_HEAT_INTERVAL_MIN` 默认 10080 分钟，首轮延迟 1 天，
  每周限量 5000 款，只刷新「heat_at 过期且已有报价」的条目）

### 变更

- **列表排序**：`heat desc nulls last` 是第一排序键（用户选的折扣/价格/名称作次序），
  没有热度数据的游戏排在最后而不是消失
- 前台新增「发行时间」筛选：不限 / 近 30 天 / 近 1 年 / 近 3 年
- 热度任务与同步/回填共用子进程槽位（同一时刻只允许一个 Steam 重任务），
  并享受 `STEAM_429_RETRIES=Infinity` 的长任务退避
- 全程一次都没拿到数据时热度任务按失败退出（避免空跑被记成成功）

## [1.2.0] - 2026-10-30

前台交互修复、亮暗色主题与移动端适配（计划见 `docs/PLAN.md` 批次 1–3）。

### 新增

- **亮暗色主题**：约 30 个语义化颜色 token 替换全部硬编码颜色；`html.dark` + Element Plus
  暗色变量；`index.html` 内联脚本防首屏闪烁；未选择时跟随系统并实时响应系统变化
- 前台顶栏与后台头部各有一个「🌙/🌞」切换按钮，状态共用；登录用户写服务端
  `user_prefs.theme`（跨设备），系统设置页提供「跟随系统」入口；`/banned`、`/appeal`、`/setup`
  一并支持暗色
- **首页目录统计**：大数字改为「收录条目（含 DLC/软件）+ 其中有报价 N 款」
  （`GET /api/games/count` 排除已删除/禁用）
- **站点通知弹窗**：页面内不再放公告元素；只有比已读 id 更新的公告才弹，最多展示 5 条，
  关闭即记已读（`steamdeals.notice-read.v1`）
- **搜索边打边查**：300ms 防抖 + 中文输入法合成期不查 + 最少 2 字符（纯数字 AppID ≥4 位）
  + 请求取消与序号防乱序 + 30 秒结果缓存 + 回车立即查询 + 搜索词同步到 URL
- **「不感兴趣/感兴趣/已拥有」三态**：卡片与详情弹窗都是三个显式按钮；登录用户支持
  `'clear'` 清除个人标记（回退全局）；游客删 localStorage key
- **后台「检测新版本」**：侧栏底部显示当前版本，有新版本显示「↑ 新版 vX 可用」链接，
  点击带 `force=1` 重查，进入控制台自动查一次（走服务端 6 小时缓存）
- **后台查询输入框统一 Enter 触发**：设置搜索、侧栏功能搜索补上 Enter 行为；
  黑名单/白名单/测试邮件/新建用户等表单输入支持 Enter 提交
- **移动端**：断点 900/760/420；工具栏 2×2、卡片单列、弹窗宽度 `min(…, 92vw)`；
  后台游戏目录与访问记录在 ≤720px 改用卡片式渲染；分页在手机上只保留上/下页

### 变更

- 详情弹窗宽度响应式（`880px` / `96vw`），报价行栅格改固定比例，手机两行布局；
  价格历史网格自适应列宽
- `PaginationBar` 只有一页时不再渲染（`hideOnSinglePage`），避免「Total 1 / Go to 1」噪声
- Element Plus 配置中文 locale（分页、下拉占位等不再出现英文 `Total / Go to / Select`）
- 历史 CSV 接口默认关闭：`/api/games/:appid/history.csv` 返回 404（与未知路由一致），
  设 `HISTORY_CSV_ENABLED=1` 才放行；前台导出入口已删除
- 搜索关键词是纯数字时按 `steam_appid = $2::int` 精确匹配，避免全表 cast

### 修复

- 详情弹窗在手机上溢出（`850px` 固定宽度 + 失效的 `:deep(.el-dialog)` 规则）
- 报价行第二列 `1fr` 吃掉全部宽度导致的巨大空隙
- 后台游戏管理两个筛选下拉显示英文「Select」
- 登录用户无法清除个人标记（`setUserGameFlag` 原来把 `null` 当「不改动」）

## [1.1.0] - 2026-10-30

游客本地标记、全站列表分页与独立申诉页。

### 新增

- **游客本地标记**：未登录也能标记「感兴趣 / 已拥有」，存浏览器 localStorage
  （`steamdeals.guest-game-flags.v1`）；列表改走新的 `POST /api/games/search`，
  带 `guestFlags`（interestedIds / uninterestedIds / ownedIds）在服务端按 id 筛选，
  各上限 5000 个、非数字丢弃；登录后忽略该字段，改按数据库用户标记
- **`/appeal` 申诉页**（Vue）：从封禁页带申诉编号 / 原因 / 到期时间 / 申诉邮箱跳转，
  生成申诉邮件正文并支持复制兜底；服务端对 `/appeal` 跳过封禁与限流判定，
  被封 IP / 设备也能打开该页（仍只放行构建产物），申诉内容不落库
- **PaginationBar 分页组件** + `useListPagination`：前台详情的报价与价格历史、
  后台用户 / 回收站 / Steam 库 / 邮件 / 日志 / 公告 / 黑白名单 / 自动封禁 /
  价格变化 / 浏览排行 / 备份等列表全部改为分页显示

### 变更

- `GET /api/games`：默认 `pageSize` 50→20、上限 200→100；新增 `compact=1`
  只返回卡片字段（价格 CTE 汇总，省一次聚合子查询）
- 成功的 `POST /api/games/search` 不写访问记录；前台搜索请求可中止，翻页会取消旧请求
- 后台接口 `limit` 参数化：邮件记录、公告、浏览排行、价格报表、异常审核
- `offers` / `daily_prices` 增加 `(region, game_id)` 复合索引
- 详情接口补充 `user_interested` / `user_owned` 原始用户标记字段

### 修复

- 游客在卡片上切换标记后详情弹窗与列表同步刷新；登录态下标记以用户数据为准

### 测试

- `npm test`（40 个文件）全绿；`test/api.test.js` 21 项通过；`frontend:build` 通过
- 冒烟验证：`POST /api/games/search` 返回 48 款、guestFlags 三种过滤结果正确、
  非法 id 被丢弃；`/appeal` 带参渲染正常；游客点击标记写入 localStorage 并即时生效

## [1.0.0] - 2026-10-29

前后台页面全面迁移到 Vue 3 + Vite + Element Plus，旧的零构建页面保留为回退。

### 新增

- **Vue 3 前端工程** `frontend/`：Vite 构建、Vue Router 路由、Element Plus 组件；
  前台首页、初始化向导、封禁页、管理控制台全部由 Vue 渲染
- **管理控制台重做**：游戏管理、回收站、站点通知、访问记录、用户管理、Steam 账号、
  邮件服务、系统设置、数据统计、运行日志共 10 个模块；侧栏分组 + 功能搜索 +
  `?section=` 深链
- 服务端新增 `frontendDir` 静态分发：`/`、`/console`、`/setup`、`/banned` 与 `/assets/*`
  由 `frontend/dist` 提供；没有构建产物时自动回退旧的 `web/` 页面
- 封禁页改为 Vue 渲染：服务端把站点名/申诉邮箱/到期时间/申诉编号注入
  `window.__BAN_PAGE__`，封禁期间只放行该页所需的 `/assets/*.js|css`
- 游戏列表返回 `currency` 字段（`src/store/pg.js`），前台按报价币种显示价格
- 新增 [docs/PROJECT-OVERVIEW.md](docs/PROJECT-OVERVIEW.md)：项目全貌、功能落点与维护约定，
  README / ARCHITECTURE 已互相链接

### 变更

- **`Dockerfile` 改为多阶段构建**：先在 `node:22-bookworm-slim` 里 `npm ci` + `vite build`
  产出 `frontend/dist`，再拷进运行镜像；`frontend/dist/` 不入库
- `vue`、`vue-router`、`element-plus`、`@element-plus/icons-vue`、`vite`、
  `@vitejs/plugin-vue` 从 `dependencies` 移到 `devDependencies`（运行时只需要构建产物）
- 新增 `npm run frontend:dev` / `frontend:build` / `frontend:preview`
- 旧 `web/console.html` 支持 `?embed` 隐藏侧栏，便于旧模块嵌入

### 修复

- 封禁页申诉按钮兜底：点击后先展示完整申诉全文，复制成功才提示「已复制」，
  复制失败则聚焦只读文本框，没装邮件客户端的环境下也能手动复制

### 测试

- `npm test`（40 个文件）全绿；`email-auth` / `api` / `cli-dispatch` 三个链外文件单独跑也通过
- `npm run frontend:build` 构建通过；`npm ci --dry-run` 确认 lockfile 与 `package.json` 一致
- `node scripts/check-html-syntax.mjs`（含 `banned.html`）通过
- 本地 `serve` 冒烟：`/`、`/console`、`/banned`、`/assets/*` 返回预期内容，缺失资源 404，
  封禁页正确注入 `window.__BAN_PAGE__`
- 浏览器渲染验证：首页渲染出 47 款游戏与报价；后台 10 个模块逐个切换无 JS 报错
  （仅本机无 Steam 出口导致封面图 404，属环境限制）

## [0.32.0] - 2026-10-29

Steam 定时任务改为「每日刷新已有报价」，长任务遇到 429 自动退避重试。

### 变更

- **定时任务拆分**：`sync steamall`（增量补全）改为后台「数据回填」负责；
  定时任务变为 `steam-prices`：只刷新**已经有 Steam 报价**的游戏，默认**每天一次**
  （`STEAM_PRICE_INTERVAL_MIN=1440`），首轮延迟 600 秒
- 设置项 `sources.steam.intervalMin` → `sources.steam.priceIntervalMin`，
  环境变量 `STEAM_INTERVAL_MIN` → `STEAM_PRICE_INTERVAL_MIN`（旧值不再读取，默认 1440）
- `sync steamall` 跳过 1 天内已回填过的游戏；没有待补游戏时正常退出（不再报错）
- 控制台同步记录的「steam-prices」显示为「Steam 价格刷新」

### 修复

- **429 长任务自动重试**：新增 `STEAM_429_RETRIES`（默认 1）；后台回填与定时价格任务设为
  `Infinity`，冷却按 30 分钟 → 1 小时 → 2 小时…最多 6 小时递增后自动重试，
  不会因一次 429 直接退出（手动同步仍是有限重试）
- 回填说明文案更新：任务在服务器后台运行，关页面/关电脑不影响

### 测试

- `scheduler.test.js` / `settings.test.js` 随新任务名与新设置键更新

## [0.31.3] - 2026-10-29

回填取价遵守 Steam appdetails 的限流。

### 修复

- Steam `store/api/appdetails` 限 **200 次/5 分钟**（≈ 最低 1.5 秒/请求），
  回填价格回退原来 1.1 秒/批（约 270 次/5 分钟），超限会被 429 并触发 30 分钟冷却
- 回填价格回退改为：**单批 50 个、间隔 2 秒**（150 次/5 分钟），留出限流余量
- `syncPrices` / `syncMeta` 默认间隔从 1.1 秒同步改成 2 秒
- 429 行为不变：全局冷却 30 分钟后只重试一次，避免把代理 IP 打进风控

## [0.31.2] - 2026-10-29

设置页保存栏不再吸顶，避免遮住顶部搜索栏。

### 修复

- `#settingsBar` 从 `position:sticky` 改为普通文档流（保留底部间距），展开设置项时不会覆盖搜索栏

## [0.31.1] - 2026-10-29

限流退避修正：429 重试改为 20 秒。

### 修复

- 出网请求遇到 429（限流）时，重试等待从 500ms 提高到 **20 秒**，避免连续重试把出口 IP 打进风控；
  403 仍然不重试

## [0.31.0] - 2026-10-29

安全加固 + 控制台导航重构。

### 新增

- **首次初始化口令自动生成**：未配置 `SETUP_TOKEN` 时启动生成一次性随机口令并打印到日志，
  防止公网部署被别人抢先初始化；配置了则仍用配置值
- **`TRUSTED_PROXY_IPS`**：`TRUST_PROXY=1` 时必须同时列出代理来源 IP/CIDR 才信任
  `X-Forwarded-For` / `X-Real-IP`，公网直连请求不能再伪造转发头；私有网段仍自动信任
- 5 个 compose 变体透传 `TRUST_PROXY` / `TRUSTED_PROXY_IPS` / `RATE_LIMIT_*`

### 变更

- **会话 Cookie 统一**：密码登录、邮箱验证码、首次初始化共用一个构造函数，
  统一 `HttpOnly` + `SameSite=Lax`，HTTPS 下自动加 `Secure`
- **验证码邮件正文不再落库**：数据库只存哈希与脱敏占位，老库启动时自动清洗历史正文
- 邮箱验证码请求改为统一通用提示（不区分邮箱未绑定/禁用/未验证/发信失败），防账号枚举
- 密码长度统一为 8–200 位（邮箱重置密码、CLI 创建用户）
- 限流内存表加容量上限、配置值做范围校验；补充 IPv6 链路本地/保留网段识别
- **控制台导航重构**：侧栏分组 + 功能搜索 + 吸顶子导航，设置页吸顶保存栏与搜索联动

### 测试

- `email-auth.test.js` 更新为「正文不存明文验证码」：验证码只从发出的邮件里取并校验哈希

## [0.30.5] - 2026-10-29

修复回填原地打转：同一批游戏被反复处理，价格永远写不进去。

### 修复

- **回填原地打转**：`upsertGameMeta` 不写 `description`，且选择条件里
  `not exists (steam offer)` 对无报价游戏永远为真，导致每批都选中同一批游戏
  （实测 20 个单批请求全部是 `appid=730`，「写入 10000」只是同一批跑了 100 遍）
  - 新增 `games.backfill_at`：处理过的游戏（无论有没有拿到报价）一天内不再被选中
  - `upsertGameMeta` 现在会写 `description`（只填空，不覆盖人工编辑）
  - 每批写库后统一 `markBackfilled`，进度是真正的新游戏
- 诊断日志：GetItems 无价格时打 `store_browse.no_price_shape`（顶层字段 + `best_purchase_option` 字段）；
  appdetails 0 报价时打 `adapter.steam.no_offers`，带响应片段，用于区分「success:false / 免费 / 锁区」

### 测试

- `pg.test.js` 新增：`description` 写入、`backfill_at` 标记、已有说明不被覆盖（12/12）

## [0.30.4] - 2026-10-29

回填价格改用 appdetails 回退取价：不再依赖 GetItems 的价格字段。

### 修复

- **GetItems 拿不到价格**（字段名/接口变化，实测 `priced=0`）：回填对没有价格的 appid 自动用
  `store.steampowered.com/api/appdetails` 批量回退（30 个/请求、1.1s 间隔），拿到 `price_overview`
  后再写 `offers` / `daily_prices`
- GetItems 自带价格仍然优先使用；两路结果按 appid 去重，不会重复写
- 新增 `backfill.price_fallback` 日志（回退 appid 数 / 请求数 / 拿到报价数）；
  回退遇到 403/429 立即中止，避免把出口 IP 打进风控
- 单批「价格 0 条」的提示改为「GetItems 与 appdetails 回退都没拿到」

### 测试

- `backfill.test.js` 新增 4 项：缺价 appid 筛选与去重、GetItems 报价转换、两路报价合并去重

## [0.30.3] - 2026-10-29

修复回填「有元数据、没价格」的真正原因：价格字段名解析错了。

### 修复

- **`mapStoreItem` 读错价格字段**：Steam `GetItems` 返回的是
  `final_price_in_cents` / `original_price_in_cents` / `discount_pct`，
  之前读的是 `final_price.amount`，导致每条的 `priceOverview` 都是 null →
  `offers` / `daily_prices` 一条没写，前端「有价格」一直停在约 1000 款
- 同时兼容旧形态（`final_price` 为整数或 `{amount}`）和 `purchase_options` 数组；
  免费游戏用 `is_free` 判断
- 说明：`include_best_purchase_option` 在 proto 里默认就是 true，0.30.1 补的那一项无害，
  但不是问题根因（请求前后响应字节数完全一致）

### 测试

- `store-browse.test.js` 增加真实字段名、免费游戏 `is_free` 的用例（共 10 项）

## [0.30.2] - 2026-10-29

控制台游戏管理：去掉「显示图片」开关，图片列改为始终显示。

### 变更

- 移除「显示图片」复选框和条件判断：列表加载即显示封面（仍保留 `loading="lazy"`，滚动到才加载）
- 没有 appid 的游戏继续显示 `—`，图片加载失败时自动隐藏

## [0.30.1] - 2026-10-29

修复数据回填只写元数据、不写价格：GetItems 必须显式要价格字段。

### 修复

- **GetItems 请求补 `include_best_purchase_option: true`**：不加这一项 Steam 不返回
  `best_purchase_option`，回填日志里的「写入 10000」只是元数据，价格一条没写，
  前端「有价格」一直停在原来的约 1000 款（列表只显示有价格的游戏）
- `mapStoreItem` 兼容 `final_price` 的两种形态（`{amount,currency}` 与整数 + `currency_code`），
  以及价格放在 `purchase_options` 数组里的情况
- 回填日志新增「价格 N 条」；一批里一条价格都没拿到时写 `backfill.batch_no_price` 警告，
  结束时价格 0 条给出明确提示（批次进度行格式保持不变，控制台进度解析不受影响）

### 测试

- `store-browse.test.js` 补 3 项：请求体必须带 `include_best_purchase_option`、
  整数价格形态、`purchase_options` 形态

## [0.30.0] - 2026-10-29

自动封禁恢复，改为**按天三振**：10 分钟 → 30 分钟 → 封到当天结束。

### 变更

- 页面/API 超频重新**自动封禁**（不再只记录等人工审批）：
  第 1 次封 **10 分钟**、第 2 次 **30 分钟**、第 3 次 **封到当天结束**（次日 0 点自动恢复）
- **每天最多 3 次**：封到当天结束后不再累加/升级，`strikes` 封顶在 3
- 三振按天重置：跨天后 `strikes` 归零，重新从 10 分钟起算（新增 `ip_abuse.strike_day`）
- 封禁期内继续请求仍按 `blockedEscalate`（默认 100 次）升一档；**永不自动写永久黑名单**
- 每次自动封禁同时写一条「待审核」记录，管理员可提前解封或改为永久封
- 扫描器/未知路径策略不变：只记录待审核，由管理员决定封不封
- 控制台规则说明、README 同步更新

### 修复

- 封禁页申诉按钮点击无反馈：没装邮件客户端时 `mailto:` 不会有任何反应，
  现在点击会**复制申诉内容并显示申诉邮箱**，另提供「复制申诉内容」按钮（9 种语言）

### 测试

- `ratelimit.test.js`：第 3 次封到次日 0 点、`nextMidnight` 边界、当天封顶后不再累加
- `reviews.test.js` 新增真 PGlite 集成用例：三振升级 → 封顶后不再累加 → 重启后恢复「当天封禁」→ 次日 `strike_day` 归零重新封 10 分钟
- `reviews.test.js` 增加封禁页申诉兜底按钮/提示区域的断言

## [0.29.1] - 2026-10-29

修复封禁页「发送申诉邮件」点了没反应。

### 修复

- 申诉按钮是 `mailto:` 链接：没装邮件客户端（或浏览器/内置浏览器拦截 mailto）时点击完全没有反馈。
  现在点击后**同时复制申诉内容**并在页面显示「如果邮件客户端没有打开，请手动发送到 xxx@…」
- 新增「复制申诉内容」按钮（9 种语言都有对应文案），复制失败时提示手动记录申诉编号和邮箱
- 切换语言会重置提示、更新按钮文案

### 测试

- `reviews.test.js` 增加断言：封禁页必须包含复制兜底按钮和可见提示区域

## [0.29.0] - 2026-10-29

站点通知、设备指纹、封禁提示页；同时把「自动封禁」改成「记录待审核，管理员审批」。

### 新增

- **站点通知**：后台「站点通知」页可写标题/正文/级别/启停/生效时间窗口，前台顶部横幅展示，
  用户点 × 关闭后本机不再提示；接口 `GET /api/announcements`（公开）与
  `GET/POST/PATCH/DELETE /api/admin/announcements`（管理员）
- **设备指纹**：前台页面加载时上报平台/语言/时区/屏幕/CPU/内存/WebGL/Canvas 等，
  服务端只存 sha256 指纹（不存原始 canvas）；控制台「访问记录 → 设备」可看最近设备并一键封禁，
  封禁按指纹生效，同一设备换 IP 也会命中；接口 `POST /api/device`（公开）、
  `GET /api/admin/devices`、`GET/POST/DELETE /api/admin/device-bans`
- **封禁提示页** `web/banned.html`：按浏览器语言（简体/繁体/英/日/韩/俄/西/法/德）展示，
  带申诉编号和 `mailto:` 申诉入口；封禁响应改为：浏览器请求返回提示页（403 + HTML），
  API/脚本仍返回纯文本。申诉邮箱由 `APPEAL_EMAIL` 配置，站点名由 `SITE_NAME` 配置；
  每次返回提示页记 `ban.page`（含申诉编号），收到申诉邮件后可按编号在日志里定位
- **异常请求审核**：扫描器路径（`.env`/`.git`/`*.php`/`..` 等）、未知路径超阈值、IP 超频
  只写入 `abuse_reviews`（同 IP+规则合并计数），不再自动封禁；控制台「访问记录 → 待审核」
  可对每条记录选择「封 IP / 封设备 / 忽略」，审批后才写黑名单/设备封禁

### 变更

- **限流不再自动写永久黑名单**：超频只做 10/30 分钟临时限流并记一条待审核，
  是否永久封由管理员决定（避免共享出口被几分钟内升成永久）

### 测试

- 新增 `test/reviews.test.js`（9 项）：扫描路径只记录不封、正常资源不误报、未知路径阈值、
  超频进审核、管理员审批后 403 + 多语言提示页、设备上报/封禁、拦截日志采样、限流分桶、XFF 防伪造
- 新增 `test/announcements.test.js`（2 项）：生效窗口过滤、管理员增改删与公开接口
- 新增 `test/devices.test.js`（5 项）：设备 ID 校验、字段截断、指纹稳定性、写库节流、设备→指纹映射
- `ratelimit.test.js` 更新：不再自动永久封，第三次超频只续临时封禁并标记待审核

## [0.28.0] - 2026-10-29

回填任务搬到后台：控制台直接启动/停止、看实时进度；回填本身更快、遇到限流会立刻停。

### 新增

- **控制台「数据回填」卡片**：上限 / 每批 / 间隔 / 回退数可调，支持开始、停止，
  实时显示批次、已处理比例、写入/回退/失败、速度；任务记入「同步记录」（模式「数据回填」）
- 新增管理员接口 `POST /api/admin/backfill`、`POST /api/admin/backfill/stop`、
  `GET /api/admin/backfill/status`
- 回填与同步**共用同一个子进程槽位**：同一时间只跑一个 Steam 任务，避免叠加请求触发限流

### 变更

- 回填写库从「每款一个数据库连接」改为「每批一个连接」（100 次/批 → 1 次/批）
- 新增 `--fallback N`：单条回退上限可调，0 = 关闭单条回退
- `fetchStoreItems` 支持 `throwOnFatal`：403/405/429 直接抛给调用方处理

### 修复

- 回填遇到 **429/403 立即中止**（之前只在单请求上退避 20 秒，任务会继续打）；
  405 直接提示镜像过旧（需要 ≥0.25.2 的 GET + input_json 实现）
- 停止任务先 SIGTERM，10 秒未退再 SIGKILL；任务状态记为「已停止」

### 测试

- 新增 `test/backfill.test.js`：参数收敛、子进程参数拼装、进度解析
- `sync-runs.test.js` 增加回填接口的权限 / 空状态 / 停止 409 断言
- `store-browse.test.js` 增加 `throwOnFatal` 行为断言

## [0.27.0] - 2026-10-29

访问安全：限流分桶、扫描路径自动临时封禁、拦截日志与正常访问分开统计。

### 新增

- **路径守卫**（`src/guard.js`）：白名单 = 页面/图标/`outDir` 下真实存在的静态文件/`/api/`/`/img/`/`robots.txt` 等良性探测；
  扫描器签名（`.env`、`.git`、`*.php`、`..`、`/wp-`、`/phpmyadmin`、`/etc/passwd` 等）命中立即 403 并封禁
- **封禁策略**：首次 1 小时、24 小时内重犯 24 小时，独立 `path_strikes` 计数，**永不自动写永久黑名单**；
  封禁期内继续请求不参与三振升级（避免共享出口被几分钟内升成永久）
- **未知路径**：默认只记录（`PATH_BAN_UNKNOWN_MODE=log`），可配成达到阈值（默认 10 分钟内 30 个不同路径）后封禁
- **拦截日志**：`visitor_logs` 新增 `blocked` / `block_reason`，429/403/路径封禁按 IP 每分钟采样一条；
  控制台访问记录新增「正常访问 / 被拦截 / 全部」筛选，被拦截请求不计入今日访问量
- 自动封禁列表新增「路径封禁次数 / 来源（频率限制 or 路径规则）」列

### 修复

- **限流误伤**：原先封面图等静态资源也计入 60 次/60 秒，正常翻页可能把用户顶到阈值并被封。改为两个桶：
  页面/API 默认 60 次/60 秒，静态资源/图片默认 300 次/60 秒（`RATE_LIMIT_ASSET_MAX`）
- **XFF 伪造**：`clientIp` 改为优先 `X-Real-IP`、否则取 `X-Forwarded-For` **最后一跳**，并校验必须是合法 IP。
  之前取第一个值，反代使用 `$proxy_add_x_forwarded_for` 时客户端可伪造任意 IP（配合自动封禁等于"任意 IP 拉黑器"）

### 测试

- 新增 `test/guard.test.js`（6 项）：白名单、扫描器签名、编码/大小写归一化、未知路径去重计数、资源判定
- 新增 `test/pathban.test.js`（7 项）：XFF 只信最后一跳、扫描路径临时封禁且不自动永久、正常页面+封面不封、
  未知路径阈值、拦截日志采样与统计隔离、访问记录接口筛选、限流分桶

## [0.26.2] - 2026-10-29

前台列表布局：封面与游戏名固定同一行，名字不再折行。

### 修复

- 首列改成 flex：封面固定 92×43（窄屏 64×30），游戏名单行显示，超长用省略号
  （悬停看全名）；英文名不再另起一行，改为跟在中文名后面的小字
- 表格固定列宽（现价 180 / 原价 96 / 折扣 80 / 各平台 236），名字列吃剩余空间；
  内容区 1100 → **1240px**，长名字不再把表格撑出卡片、也不再被价格列挤到折行
- 现价下方的「其他平台最低」压成 11px 单行；窄屏隐藏（各平台列的胶囊已有同样信息）
- 窄屏（≤760px）表格保持列宽、卡片内横向滚动，封面缩到 64×30，名字仍单行省略

### 测试

- 无新增自动化测试；用 Playwright 在 1526 / 1280 / 900 / 390 四档宽度渲染真实页面核对：
  每行封面与名字垂直居中对齐、名字单行、表格不超出卡片（详见提交说明）

## [0.26.3] - 2026-10-29

访问统计口径修正：一次刷新不再记十几条。

### 修复

- **GET 类 API 数据请求（2xx/3xx）不再写入访问记录**：之前一次控制台刷新会打约 10 个
  `/api/*` 请求，每个都记一条，导致「刷新一下访问量跳十几」
- 仍然记录：页面访问（`/`、`/console`、`/game/*`）、登录与修改类请求（POST 等）、
  以及所有 4xx/5xx（含 403 拉黑、429 限流），排障信息不丢

### 测试

- `visitors.test.js` 改为断言「登录 POST 有记录、GET /api/games 不记录」
## [0.26.1] - 2026-10-29

控制台轮询降噪。

### 变更

- 轮询类接口（`/api/admin/sync/status`、`/api/admin/sync/runs`）**不再写访问日志**，
  避免控制台开着页面就把访问统计刷高
- 控制台同步状态轮询：3 秒 → **10 秒**，页面不可见时降到 30 秒
- 日志页自动刷新：3 秒 → **10 秒**，页面不可见时暂停

## [0.26.0] - 2026-10-29

取消前台自动刷新；修正封禁期内请求不计数的问题。

### 变更

- **前台不再自动刷新**：移除 10 秒一次的数据指纹轮询，改为顶部「刷新」按钮手动触发
  （手机/多标签页不会再因为自动轮询被限流误伤；切换页签/排序/搜索仍会重新拉数据）

### 修复

- **限流升级逻辑**：之前封禁期内的请求直接 429 返回、**完全不计入任何计数**，
  所以出现「某 IP 访问 634 次、累计超频却只有 1 次」的怪现象。现在封禁期内的请求
  会累计「违禁请求」，每满 **100 次**直接升级一档封禁（10 分钟 → 30 分钟 → 永久黑名单），
  升级动作写日志 `rate.banned escalated=true`
- 429 响应补上 `Retry-After` 头，明确告诉客户端还要等多久

### 测试

- `ratelimit.test.js` 改为验证「封禁期内继续请求会升级」：10 分钟 → 30 分钟 → 永久

## [0.25.2] - 2026-10-29

修复 GetItems 批量接口 405。

### 修复

- Steam 的 `IStoreBrowseService/GetItems` **只接受 GET**（POST 返回 405），改为
  `GET ?key=&input_json=<JSON>`
- 响应统一包在 `response` 里，按 `response.store_items` 读取（兼容直接返回 `store_items`）

## [0.25.1] - 2026-10-28

站点图标：补上 SteamDeals 的 favicon（品牌渐变 + 百分号），三个页面统一引用。

### 新增

- **`web/favicon.svg`**：64×64 圆角方块，`#22d3ee → #4f46e5` 品牌渐变 + 白色百分号（与前台 logo 同一个渐变）
- **`web/favicon.ico`**：32×32 PNG 压缩 ICO，老浏览器和 `/favicon.ico` 默认请求不再 404
- **`web/apple-touch-icon.png`**：180×180 全出血方图，iOS「添加到主屏幕」用
- 前台 / 控制台 / 初始化三个页面都加了 `rel="icon"` 与 `apple-touch-icon`；
  初始化未完成时也放行图标，`/setup` 页标签页图标不再被 302 掉

### 测试

- 新增 `test/favicon.test.js`：三个页面引用一致且文件存在、SVG/ICO/PNG 格式合法性（含 ICO 头部与内嵌 PNG 校验）

## [0.25.0] - 2026-10-28

批量回填全量游戏的元数据与国区价格。

### 新增

- **ackfill 命令**：用 `IStoreBrowseService/GetItems`（一次最多 100 个 appid，需 `STEAM_API_KEY`）
  批量补名称/类型/开发商/发行商/简介/国区现价与原价，配合 `upsertGameMeta` + `ingestOffers` 落库
- 单批失败或个别 appid 不返回时，自动**回退单个 appdetails**（每批最多 10 个，避免拖慢）
- 只处理「缺说明或缺 Steam 报价」的游戏，可断点续跑；默认**不下载图片**（之后 `images pull` 只补有价格的）
- 用法：`node src/cli.js backfill --batch 50 --sleep 1500 --limit 20000`

### 测试

- 新增 `test/store-browse.test.js`：请求体（100 上限/上下文）、字段映射（含免费/DLC/无价）、
  分批与缺失 appid 收集、无 key 抛错
## [0.24.5] - 2026-10-28

修复前台列表卡在「加载中…」。

### 修复

- 0.23.3 引入的「新史低」标签有一处变量自引用（`lowTag` 初始化时引用自己），
  导致列表渲染抛 ReferenceError、页面一直停在「加载中…」——已改为
  `isNewLow ? 新史低 : (atLow ? 史低 : 空)`
## [0.24.4] - 2026-10-28

Steam 限流（429/403）处理：更长退避 + 触发中止。

### 修复

- 429/403 的重试退避从 0.5 秒改为 **20 秒**（原来 0.5 秒重试只会加重封禁）
- `sync steamall` 连续 **5 次 403/429** 立即**中止本轮**并以非 0 退出，
  让调度器熔断（连续 3 次失败暂停 6 小时），不再一小时一次地硬打

### 运维建议

- 被限流后先在「系统设置 → 数据源与采集」关掉 Steam，等 1~2 小时
- 恢复时用 `--limit 20~50 --sleep 8~10 --concurrency 1`，不要同时补图（`SYNC_IMAGES_ENABLED=0`）
## [0.24.3] - 2026-10-28

合并重复的邮件配置入口。

### 变更

- 侧栏「邮箱配置」改名为「邮件测试」，**删除重复的 SMTP 表单**（主机/端口/账号/授权码统一在「系统设置 → 降价提醒」维护）
- 该页保留：发送测试邮件、验证码发送记录（用途/结果/时间/内容查看）
- 测试邮件必须显式填写收件邮箱（不再从已删除的账号输入框取值）
## [0.24.2] - 2026-10-28

控制台：设置页保存栏悬浮 + Ctrl+S；数据统计页加锚点导航。

### 新增

- **系统设置**：保存栏改为**吸顶悬浮**，滚动到任何位置都能直接保存；支持 `Ctrl+S / Cmd+S`（仅在设置页生效）
- **数据统计**：顶部新增锚点导航（价格变动 / 近 7 天趋势 / 图片缓存 / 备份 / 浏览排行），点击平滑跳转
## [0.24.1] - 2026-10-28

Steam 登录：OpenID 校验失败时自动改直连重试。

### 修复

- 代理把 `steamcommunity.com` 连接重置（`ECONNRESET`）时，OpenID 校验再**直连重试一次**，
  并在日志里记 `steam.openid_retry_direct`；两次都失败才提示「Steam 校验失败」
- `diagnose` 增加 `proxy:connect:community`（专门验证 `steamcommunity.com:443` 的隧道）
## [0.24.0] - 2026-10-28

增量同步顺带下载封面图。

### 新增

- `sync steamall` 在写完元数据/价格后，**顺手把本次同步游戏的封面图下载到本地**
  （默认尺寸 `capsule_sm_120` + `header`，每张间隔 200ms；失败只记日志不影响同步结果）
- 同步结束会打印「封面图：成功 N 张，失败 M 张」，并写进同步记录的结果摘要
- 参数：`--images 0` 关闭、`--image-sleep` 调节间隔、`--image-sizes` 指定尺寸；
  环境变量 `SYNC_IMAGES_ENABLED=0` 可全局关闭（关掉后仍由 4 小时的补图任务兜底）
## [0.23.3] - 2026-10-28

前台区分「新史低」与「史低」。

### 新增

- 列表接口新增 `prev_hist_low`（**今天之前**的历史最低价，不含当天快照）
- 前台：当前价低于 `prev_hist_low` 时显示橙色 **新史低**；否则达到历史最低显示绿色 **史低**
- 详情弹窗同步显示「史低」金额（口径不变）
## [0.23.2] - 2026-10-28

停用邮箱验证码登录；发信增加 IP 与全站额度。

### 变更

- **前台登录只保留密码登录**：移除「邮箱验证码」登录入口（邮箱仍用于绑定验证与忘记密码）
- **发信防轰炸**：除原有的「同邮箱 60 秒冷却 + 每小时上限」外，新增
  **单 IP 每小时最多 10 封**、**全站每天最多 200 封**；超限返回 429 并提示稍后再试
- 超限事件记日志：`auth.otp_ip_limited` / `auth.otp_daily_limited`
## [0.23.1] - 2026-10-28

访问记录页拆分子视图，明细表内部滚动。

### 变更

- 「访问记录」页拆成两个子标签：**访问记录**（明细）与 **统计 / 黑名单 / 白名单 / 自动封禁**
- 访问记录表格改为**固定高度内部滚动 + 表头吸顶**（最多 58vh），数据再多也不会把页面拉长
- 默认进入「访问记录」明细视图；切换标签不重新请求数据
## [0.23.0] - 2026-10-28

登录增加图形验证码，进一步压低爆破空间。

### 新增

- **登录图形验证码**（自托管 SVG，不依赖第三方）：4 位字符（去掉 0/O/1/I），旋转 + 噪点 + 干扰线，
  一次性、5 分钟过期、用完即删；答案只存库、不下发前端
- GET /api/captcha 取图（匿名，禁止缓存）；POST /api/login 必须带 `captchaToken` + `captchaAnswer`，
  验证码校验在密码校验之前——错误验证码不消耗密码尝试次数，也不泄露账号是否存在
- 控制台登录框、前台登录弹窗都已接入；点击图片或「换一张」可刷新
- `CAPTCHA_ENABLED=0` 可关闭（离线调试/自动化测试用）

### 测试

- pi.test.js 新增：验证码下发 SVG 且落库、开启后无验证码登录 400、错误验证码 400
- 会登录的测试文件统一在测试进程内关闭验证码（不干扰既有断言）
## [0.22.0] - 2026-10-28

安全加固（频率限制/白名单/响应头）、控制台布局优化、定时任务状态展示。

### 安全修复（按严重程度）

- **高：无任何频率限制** → 新增 IP 频率限制：60 秒内超过 60 次页面/API 请求判定异常，
  第 1 次封 10 分钟、第 2 次 30 分钟、第 3 次自动写入永久黑名单；内网/本机（反代、健康检查）不计数
- **高：登录接口可被爆破** → 同上限流覆盖 `/api/login`（超频即 429）
- **中：会话 Cookie 缺 `Secure`** → HTTPS 请求（含反代 `x-forwarded-proto: https`）时自动加 `Secure`
- **中：缺安全响应头** → 统一加 `X-Content-Type-Options`、`X-Frame-Options: DENY`、
  `Referrer-Policy`、`Permissions-Policy`，HTTPS 下加 HSTS
- **中：`X-Forwarded-For` 可伪造绕过限流/黑名单** → 只有直连来源是内网/本机（即反代）时才采信 XFF，
  否则一律用 socket 地址；可用 `TRUST_PROXY=1` 强制信任

### 新增

- **IP 白名单**：`ip_whitelist` 表 + 控制台增删；白名单不受频率限制与黑名单影响
- **自动封禁记录**：`ip_abuse` 表，控制台可看超频次数/封禁到期时间，支持手动解封
- **接口**：`GET/POST /api/admin/whitelist`、`DELETE /api/admin/whitelist/:ip`、
  `GET /api/admin/abuse`、`DELETE /api/admin/abuse/:ip`
- **定时任务状态**：调度器把各任务的间隔/上次/下次运行写 `data/scheduler-status.json`，
  控制台「游戏管理」顶部展示「手动同步立即执行 / 定时同步按间隔自动跑」，并显示 steam 下次运行时间

### 变更

- **同步记录更紧凑**：默认只显示最近 5 条，「展开全部」看 20 条；结果列单行截断，完整内容悬停查看
- **系统设置页**：顶部新增分组跳转 + 搜索框（按名称/键/帮助过滤），每个分组可折叠

### 审计结论（无需修改的项）

- SQL 全部参数化（备份表名取自代码内白名单）；静态文件服务已做 `resolve` 越界拦截；
  图片路由限定 appid 数字与尺寸白名单；密码用 scrypt 加盐；会话 token 32 字节随机；
  Cookie `HttpOnly + SameSite=Lax`；邮箱验证码存哈希；敏感设置 AES 加密存储

## [0.21.2] - 2026-10-28

前台自动刷新改为「数据指纹」轮询，数据没变就不重拉列表。

### 变更

- **前台实时更新优化**：每 10 秒只查 `GET /api/games/stamp`（游戏数 / 报价数 / 最新报价时间），
  指纹变了才调 `/api/games` 重新拉列表；页面切回前台时同样只查指纹
- **指纹接口不写访问记录**（`isLoggablePath` 排除），自己的轮询不会再把自己的访问统计刷高

### 测试

- `api.test.js` 新增：指纹字段齐全、数据变化后指纹改变、轮询不产生访问记录

## [0.21.1] - 2026-10-28

同步失败不再只有 `fetch failed`：代理拒绝建隧道时，直接把代理的回答写进同步记录。

### 修复

- **代理拒绝 CONNECT 的报错说清楚了**：undici 把真实原因埋在三层 `cause` 里（最外层 `fetch failed`、
  中间层是 `code=0` 的 `Request was cancelled.`、最底层才是 `Proxy response (407) !== 200 when HTTP Tunneling`）。
  现在顺着 `cause` 链挖到底，同步记录显示 `fetch failed (PROXY_407) → api.steampowered.com · 代理要求认证… · 经 steam-proxy`，
  日志同时记 `proxyStatus` / `cause`，不再出现毫无意义的 `code=0`
- **403/407 不再无意义重试**：这是代理配置问题，重试 3 次只会拖慢并刷屏；代理 5xx 仍然重试
- **`diagnose` 增加代理隧道探测**：对 `store.steampowered.com:443` 与 `api.steampowered.com:443` 各发一次 CONNECT，
  直接打印代理的状态码（407 要账号密码、403 是代理不放行、200 才算通）；探测用未脱敏的代理地址，带账号密码也能验通
- **代理地址格式配错时会明说**：`STEAM_PROXY=socks5://…` 这类值原来被静默丢弃、回落直连，
  `diagnose` 现在报 `proxy:format` 失败

### 测试

- 新增 `test/http-error.test.js`：三层 cause 链解析、`code=0` 不当错误码、407 不重试且提示可操作、
  起本地假代理真实走一遍 undici `ProxyAgent`（407 → `PROXY_407` 且只请求一次，502 → 重试）

## [0.21.0] - 2026-10-28

控制台显示当前版本，并在有新版本时提示。

### 新增

- **侧栏版本号**：控制台左下角显示「版本 v0.21.0」（取自 `package.json`，点击可立即重新检查）
- **新版本提示**：检查 GitHub 仓库的 release / tag，若比当前版本新，显示「↑ 新版 vX 可用」，
  点击跳到对应 release 页
- **接口**：`GET /api/admin/version`（管理员），返回 `{current, latest, updateAvailable, url, checkedAt, error}`；
  服务端缓存 6 小时（GitHub 未认证额度只有 60 次/小时），`UPDATE_CHECK=0` 可完全关闭出网检查，
  `UPDATE_REPO` 可换检查的仓库
- 检查失败（没网/被墙/额度耗尽）只在 `error` 里说明，不影响页面

### 测试

- 新增 `test/version.test.js`：版本解析/数值比较、无 release 时退回 tags、已是最新、缓存与强制刷新、网络失败
- `api.test.js` 新增：版本接口返回当前版本、`UPDATE_CHECK=0` 时不出网、匿名 401

## [0.20.2] - 2026-10-28

设置项敏感字段可查看明文（按需解密 + 审计），非敏感字段本来就地明文。

### 新增

- **敏感字段「查看 / 隐藏」**：系统设置里已配置的密钥（代理地址、API Key、Webhook、SMTP 授权码等）
  输入框旁新增「查看」按钮，点一下按需拉取明文、再点隐藏；未配置时按钮不出现
- **接口**：`GET /api/admin/settings/value?key=<设置键>`（管理员，仅 `secret` 类型字段），
  每次查看记 `settings.revealed` 审计日志（含操作人）
- 列表接口依旧不回显密钥（避免批量泄漏），明文只在显式点击时返回

### 测试

- `api.test.js` 新增：保存敏感字段 → 列表不回显 → 单独查看得到明文 → 非敏感字段 400 → 匿名 401

## [0.20.1] - 2026-10-28

`diagnose` 增加 Steam Web API Key 校验。

### 新增

- `diagnose` 新增 `steam.api_key` 检查（`ISteamUser/GetPlayerSummaries`）：
  `store/api/appdetails` 是免 key 的，同步成功不能证明 key 有效；这项单独验证
  403 / 结构异常会明确提示 key 无效

## [0.20.0] - 2026-10-28

收尾四件：区服筛选、单款历史 CSV、后台备份入口、日志时间范围。

### 新增

- **前台区服筛选**：筛选栏新增「国区/港区/台区/美区/日区/俄区/土区/阿区」下拉，
  列表价格随区服切换（不同币种不折算）；区服选择记入浏览器缓存
- **单款价格历史 CSV**：`GET /api/games/:appid/history.csv?days=90`（带 BOM）；
  详情弹窗加「导出价格历史 CSV」按钮
- **后台备份入口**：「数据统计」页可「立即备份」并查看已有备份文件与大小；
  `POST /api/admin/backup`、`GET /api/admin/backups`（管理员）
  备份逻辑抽到 `src/backup.js`，CLI `backup` 与接口共用同一实现
- **日志时间范围**：「日志」页新增「最近 1 小时 / 6 小时 / 24 小时」过滤（`?minutes=`）

### 修复

- 备份流程在 `email_codes` 表不存在时（未初始化/测试环境）不再整体失败，跳过该清理并记警告

### 测试

- `api.test.js` 新增：备份生成与列表、匿名 401、单款历史 CSV 内容、区服筛选、日志时间参数

## [0.19.9] - 2026-10-28

价格报表主动推送。

### 新增

- **`report price --notify`**：把报表（降/涨价条数、新史低、Top 涨跌、近 7 天趋势）推到已配置的
  webhook / 企业微信 / 邮件通道
- **调度器 `report` 任务**：配置了任意提醒通道后自动启用，默认每天推一次
  （`REPORT_ENABLED=0` 关闭，`REPORT_INTERVAL_MIN` 调间隔）

### 测试

- `scheduler.test.js` 新增：无通道时不建任务、有通道时参数正确、`REPORT_ENABLED=0` 可关

## [0.19.8] - 2026-10-28

采集健康度覆盖全部源；前台支持按类型（游戏 / DLC）筛选。

### 新增

- **`fetch_runs` 覆盖全部同步源**：`steamall / catalog / sonkwo / itad / gog / humble` 每次同步都写一行
  （`sync steam` 原本就有，避免重复写入）；`stats` 命令与排障能直接看到每个源的采集健康度
- **类型筛选**：`GET /api/games?type=game|dlc|all`；前台筛选栏新增「全部类型 / 游戏 / DLC」下拉

### 测试

- `api.test.js` 新增：type 过滤（游戏/DLC/默认/非法值回落）

## [0.19.7] - 2026-10-28

`sync steamall` 并发抓取提速。

### 新增

- **并发池**（`src/pool.js`）：固定 worker 数循环取活，天然限流；单项失败隔离、结果保序
- `sync steamall` 新增 `--concurrency`（默认 **4**，上限 16），配合 `--sleep` 控制总速率；
  `--concurrency 1` 回到原来的串行行为
- 调度器的 steam 任务显式传 `--concurrency`/`--sleep`，可用 `STEAM_CONCURRENCY` / `STEAM_SLEEP_SEC` 调整

### 测试

- 新增 `test/pool.test.js` 4 项：并发上限、结果顺序、错误隔离、空列表/非法并发

## [0.19.6] - 2026-10-28

前台「到价提醒」入口（关注列表此前只能 CLI 操作）。

### 新增

- **详情弹窗到价提醒**（管理员登录可见）：填目标价（元，留空=只跟史低）→ 保存；
  已关注时显示「更新 / 取消提醒」与当前状态
- **接口**：`GET /api/admin/watchlist`、`POST /api/admin/watchlist`（`{gameId | appid, targetCents}`）、
  `DELETE /api/admin/watchlist/:gameId`——管理员专属（普通用户 403、匿名 401）

### 测试

- `api.test.js` 新增：按 appid 解析、留空覆盖成史低、普通用户 403、匿名 401、删除生效

## [0.19.5] - 2026-10-28

同步结束后控制台自动刷新数据。

### 变更

- **同步完成自动刷新**：任务从「运行中」转为结束的瞬间，自动重新拉取
  游戏列表、同步进度统计、同步记录，并弹出「同步完成，数据已刷新」提示——不再需要手动点刷新
- 只有真正观察到过「运行中」状态才触发刷新（进入页面时不会重复请求）
- 前台本来就有 10 秒自动刷新，不受影响

## [0.19.4] - 2026-10-28

按用户的收藏/标记（混合模式：个人优先，未标记回退全局）。

### 新增

- **`user_game_flags` 表**：`(user_id, game_id, interested, owned)`，字段为 null 表示"未标记"
- **个人标记接口**：`POST /api/games/:appid/flags`、`POST /api/games/id/:id/flags`
  （登录用户，`{interested?: bool, owned?: bool}`），返回该游戏对自己的生效值
- **生效规则（混合）**：`coalesce(个人标记, 全局标记)`
  —— 登录用户设置过就用自己的；没设置过就用管理员在 `games` 上维护的全局标记；
  未登录访客看到的是全局标记
- 列表与详情接口在登录态下返回**个人生效的** `interested` / `owned`，页签筛选也按生效值过滤
- 前台详情弹窗的「标记不感兴趣 / 标记已拥有」按钮对**所有登录用户**开放（之前只有管理员能点）

### 说明

- 管理员的全局标记仍在：CLI `interest/owned` 与旧接口继续维护它，作为"策展默认值"
- 个人标记写入后优先；想恢复跟随全局，把个人标记重新设成与全局相同的值即可

### 测试

- `api.test.js` 新增：全局已拥有 → 匿名/管理员列表被排除；alice 个人取消已拥有后可见；
  详情返回个人生效值；匿名写个人标记 401

## [0.19.3] - 2026-10-28

多区服展示、合并重复游戏入口、移动端适配。

### 新增

- **详情弹窗支持多区服**：报价表新增「区服」列（国区/港区/美区/俄区/土区…），金额按币种显示
  （¥/$/€/₽/₺ 等，不同币种不折算）；多区服数据本来就在库里有，之前前端没展示
- **合并重复游戏入口**（控制台「合并重复游戏」卡片）：填两个 Steam appid，
  把源的报价/快照/日聚合/关注迁移到目标后删除源行；接口 `POST /api/admin/games/merge`
- **移动端基础适配**：前台/控制台窄屏下侧栏折叠、表格横向滚动、字号与间距收紧

### 测试

- `api.test.js` 新增合并接口断言（报价迁移、源行删除、匿名 401、同源同目标 400）

## [0.19.2] - 2026-10-28

价格报表增强：新史低、按天趋势、CSV 导出。

### 新增

- **国内镜像入口**：`compose.cn.yaml` / `compose.cn.external-db.yaml` 使用腾讯云 TCR 公开镜像
  `ccr.ccs.tencentyun.com/tcb-100003189690-pljp/steamdeals`，国内不依赖 Docker Hub；
  `docker-tcr` 工作流负责推 amd64 app 镜像并镜像 `postgres:15-alpine`
- **新史低统计**：报表里新增 `newLows`——窗口内降价的游戏里，现价 ≤ 历史最低（日聚合）的条数
- **按天趋势**（`GET /api/admin/reports/price?days=7` 的 `daily`）：近 N 天每天降价/涨价/合计条数；
  控制台「数据统计 → 近 7 天变动趋势」
- **CSV 导出**：`GET /api/admin/reports/price.csv?hours=24`（管理员，带 BOM 便于 Excel 打开中文）；
  控制台价格变动卡片有「导出 CSV」按钮；CLI 支持 `report price --csv`（重定向到文件）
- `report price` 命令同时打印新史低与近 N 天趋势

### 测试

- `api.test.js` 补新史低、按天趋势数组、CSV 内容与匿名 401 断言

## [0.19.1] - 2026-10-28

前台服务端搜索/分页；同步任务（含定时）全部落记录；折扣字段上线。

### 新增

- **前台服务端搜索与分页**：`GET /api/games?q=&page=&pageSize=&sort=&interest=&owned=`
  返回 `{ games, total, page, pageSize, pages }`；搜索走全库（不再只搜已加载的 500 条），
  排序（折扣/价格/名称）由数据库完成，翻页按服务端数据拉取
- **字段 `discount`**：游戏的最大官方折扣，前台「折扣」列终于有值（此前一直显示 —，排序也失效）
- **同步任务全量留痕**：`sync steamall / catalog / sonkwo / itad / gog / humble` 以及 `sync steam`
  都写 `sync_runs`（控制台触发的任务复用同一条记录，不重复），定时同步也能在「同步记录」里看到；
  成功时把一行摘要（元数据条数、价格条数、涨跌条数）写进结果列

### 变更

- 前台列表改为服务端分页（每页 50/100/200 条可选），页大小、页码、搜索词、页签、排序都会反映到请求
- `sortGames` 不再参与 `/api/games`（排序下推到 SQL）

### 测试

- `api.test.js` 新增服务端分页/全库搜索/折扣排序断言（10 项）

## [0.19.0] - 2026-10-28

后台游戏管理新增「同步进度统计」与「同步状态筛选」。

### 新增

- **同步概览统计**（`GET /api/admin/games/stats`）：库内总数、有 appid 数、**待同步信息数**、
  已同步数（含进度百分比）、有报价数、已删除数；控制台游戏管理页直接在列表上方显示
- **同步状态筛选**：游戏列表新增下拉「全部同步状态 / 待同步信息 / 已同步」
  （`GET /api/admin/games?sync=pending|done`）——可以直接筛出还没补说明/没 Steam 价格的游戏

### 说明

- 「待同步」判定与 `sync steamall` 的选择条件一致：有 appid、未删除，且（缺说明 或 没有 Steam 价格）
- 目录里没有 appid 的行（如纯杉果游戏）不计入同步进度分母

### 测试

- `api.test.js` 新增：统计字段、待同步 → 已同步转换、pending/done 过滤、匿名 401

## [0.18.9] - 2026-10-27

价格报表第一版：每次同步的价格简报 + 涨跌榜。

### 新增

- **快照记住前价**：`price_snapshots.prev_price_cents`，入库时写入上一条快照的价格
  （之后涨跌、降幅都能直接算，不用再翻历史快照）
- **每次同步的价格简报**：`sync steamall` 结束时打印本次降价/涨价条数与 Top 榜
- **`report price` 命令**：`node src/cli.js report price --hours 24 --limit 10`
- **`GET /api/admin/reports/price?hours=24&limit=10`**（管理员）：返回汇总 + 降价 Top / 涨价 Top
- 控制台「数据统计」新增「价格变动（近 24 小时）」：降价/涨价条数 + 涨跌榜（原价 → 现价 → 幅度 → 时间）

### 说明

- 只统计带有前价的新快照；功能上线前写入的旧快照没有前价，不会进报表
- 「新史低」暂未纳入本期（需要与日聚合的最低价做对比，下期补）

### 测试

- `api.test.js` 新增：快照前价写入、报表统计与榜单、匿名 401

## [0.18.8] - 2026-10-27

后台编辑/前台详情 404 修复（单款查询不再依赖列表前 500 名）。

### 修复

- `/api/games/:appid` 与 `/api/games/by-id/:id` 之前是「取概览前 500 条再搜目标」，
  排在 500 名之后、或还没有报价数据的游戏会返回 404——控制台点「编辑」报「载入失败：没有该游戏」
- 新增 `db.gameDetail`（单款按 appid / 内部 id 直查，字段与列表一致），两条详情路由改用它；
  不再受 limit、排序与「必须有日价格」的限制

### 测试

- `api.test.js` 新增：不在列表里的游戏（无报价）也能取详情、按内部 id 也能取

## [0.18.7] - 2026-10-27

游戏逻辑删除（回收站）与平台列。

### 新增

- **逻辑删除**：games.deleted / deleted_at；后台游戏列表每行新增「删除」按钮（二次确认），
  数据与报价全部保留，只是不再展示
- **回收站页面**：控制台新「回收站」页列出已删除游戏（含平台、报价数、删除时间），可一键恢复；
  接口 GET /api/admin/games/deleted
- **平台列**：后台游戏列表新增「平台」列（Steam/杉果/GOG/Humble… 多个则多个标签），
  并支持按平台筛选（GET /api/admin/games?platform=steam）
- 新接口：POST /api/games/:appid/deleted 与 POST /api/games/id/:id/deleted（管理员，{deleted:true|false}）

### 变更

- 前台列表与详情排除已删除游戏；后台列表默认排除（deleted=only 查回收站、include 两边都看）
- 增量同步不再同步已删除的游戏（sync steamall 选择条件加 not g.deleted）

### 测试

- api.test.js 新增：平台列下发、逻辑删除前后台排除、回收站可见、恢复后恢复展示、报价数据未真删

## [0.18.6] - 2026-10-27

控制台用户列表列错位修复。

### 修复

- 用户表行里多渲染了一个「Steam 绑定」单元格、表头却没有对应列，导致从「角色」开始整体右移一格
  （角色格显示「未绑定」、状态格显示 admin）。移除该单元格，列对齐恢复
- 角色改为中文展示（管理员 / 普通用户），表下补一行角色与状态说明，避免看不懂 admin/user

## [0.18.5] - 2026-10-27

无 Steam appid 的游戏（杉果等）也能标记不感兴趣/已拥有。

### 修复

- 上一版把「标记不感兴趣 / 标记已拥有」按钮限定为有 Steam appid 的游戏，
  导致杉果专属游戏详情里没有这两个按钮。现在补上按**内部 id** 的接口：
  `POST /api/games/id/:id/interest` 与 `POST /api/games/id/:id/owned`（管理员），详情弹窗自动选择用哪条
- `setOwned` 支持 `gameId`，与 `setInterest` 对齐

### 测试

- `api.test.js` 增加无 appid 游戏按内部 id 标记的断言（匿名 401 / 管理员落库）

## [0.18.4] - 2026-10-27

前台偏好双写（数据库 + 浏览器缓存）；「全部」过滤已拥有与不感兴趣。

### 新增

- **偏好随账号走**：`user_prefs` 新增 `tab` 列，页签 + 排序按用户保存；
  登录用户打开页面按数据库里的个人习惯加载（同时镜像到 `localStorage`），未登录按浏览器缓存加载；
  切换页签/排序时**同时写数据库与浏览器缓存**（写库失败不影响本地生效）
- `GET /api/me` 返回的 `prefs` 带 `tab`；`POST /api/prefs` 对非法值归一化
  （`tab` 只认 all/on/off/owned，`sort` 只认 discount/price/name）

### 变更

- **Docker 命名统一为 `steamdeals`**：compose 项目名、PostgreSQL 库名/用户、命名卷、源码镜像 tag、
  文档示例全部从 `gameprice` 切换；Docker Hub 镜像仍是 `s1065420329/steamdeals`
- **「全部」页签过滤掉「不感兴趣」与「已拥有」**（之前只隐藏已拥有）；
  已拥有只在「已拥有」里出现，不感兴趣只在「不感兴趣」里出现
- 旧 `hide_uninterested` 字段保留兼容：`tab=on` 时自动置 true

### 测试

- `api.test.js` 补充页签偏好落库、`/api/me` 回带、非法值归一化断言

## [0.18.3] - 2026-10-27

游戏详情弹窗布局调整（原来 320px 太窄，表头与内容被挤成竖排）。

### 变更

- 详情弹窗宽度改为 `min(860px, 94vw)`，最大高度 88vh 可滚动；窄屏下表格区域横向滚动
- 弹窗内表格不再折行（`white-space: nowrap`），列宽恢复正常；关闭按钮不参与压缩
- 头图限制最大宽度 520px 并居中，避免宽屏下图过高
- 前端简易后台弹窗同样放宽（`min(720px, 94vw)`）

## [0.18.2] - 2026-10-27

修复「标记不感兴趣/已拥有后，列表与页签不更新」。

### 修复

- 前台刷新签名漏了 `interested` / `owned`：标记请求已写入数据库，但 `load()` 比对签名认为"没变化"，
  不重渲染——于是切到「不感兴趣」页签看到的还是旧列表。签名补上这两个字段（及类型）后立即重绘
- 列表行新增「不感兴趣」标签（`已拥有` 原本就有），标记后当场可见，不用刷新页面
- 详情弹窗的标记按钮：失败时弹出错误提示（以前静默）；没有 Steam appid 的杉果游戏不再显示这两个按钮（避免点了 404）

### 说明

- `感兴趣 / 不感兴趣 / 已拥有` 是**全局标记**，存在 `games.interested` / `games.owned` 列，只有管理员可以改；
  `user_prefs` 只存每个用户自己的展示偏好（隐藏不感兴趣 / 只看折扣 / 排序），不是标记本身

## [0.18.1] - 2026-10-27

封面图本地缓存：下载一次后由本机磁盘直接提供，之后不再依赖 CDN / 代理（VPS 只用于采集数据）。

### 新增

- **图片本地缓存**（`src/images.js`）：`<IMG_DIR>/<appid>/<size>.jpg`，默认 `data/images`；
  `data` 是 compose 挂到宿主机的卷，重建容器不丢
- **`images pull` 命令**：批量补图（默认 `capsule_sm_120,header`，支持 `--limit/--sleep/--sizes`），
  只补「有价格数据」的游戏（列表/详情才用得到），已缓存齐全的自动跳过
- **`images stats`**：已缓存张数 / 覆盖游戏数 / 体积
- **调度器 `images` 任务**：默认每 4 小时补 200 款（`IMAGES_ENABLED` / `IMAGES_INTERVAL_MIN` /
  `IMAGES_LIMIT` / `IMAGES_SLEEP_MS` 可调）
- **`GET /api/admin/images`** 与控制台「数据统计 → 封面图缓存」：张数 / 覆盖 / 体积 / 目录
- `.gitignore` 忽略 `data/images/`

### 修复

- **`/img/steam/<appid>/<size>` 路由此前永远不可达**：非 `/api/` 路径会先被静态资源分支处理并 404，
  于是图片请求根本到不了图片路由——这是「前台只有名字没有图」的真正原因（与代理无关）。
  现在 `/img/` 与 `/api/` 一样先走路由，再回落到静态文件
- 图片路由改为「内存热缓存 → 本地磁盘 → 三条 CDN 兜底并落盘」；命中本地后不再出网，
  失败结果缓存 5 分钟避免拖满超时

### 测试

- 新增 `images.test.js` 4 项：路径安全（appid 只留数字 / size 白名单）、读写与统计、
  下载落盘（注入 fetchBuffer，全失败不落盘）、`/img` 路由命中本地文件时不再触网

## [0.18.0] - 2026-10-27

Docker Hub 零配置部署：业务配置落库 + 首次 `/setup` 初始化 + 控制台系统设置 + 调度器热加载。

### 新增

- **设置存储**：`app_settings`（jsonb + 密钥密文）与 `app_meta`（初始化状态 / settings.revision）；
  50 项业务设置集中定义在 `src/settings.js`，SMTP 继续复用 `smtp_settings`
- **首次初始化 `/setup`**：创建第一个管理员 + 写业务设置 + 标记完成，全部在一个事务里；
  完成前页面 302 到 `/setup`、业务 API 返回 428，健康检查不受影响
- **`SETUP_TOKEN`**：可选初始化口令，防止公网被抢先初始化
- **控制台「系统设置」页**：按服务端 schema 渲染分组表单；密钥只显示「已配置」，留空保持、可显式清除
- **`GET/POST /api/admin/settings`**：管理员读写设置，保存后递增 revision
- **调度器热加载**：初始化完成前等待，不采集；轮询 revision，设置变更后重新水合 env 并重建任务表
- **Docker Hub**：`compose.hub.yaml`（自带 PostgreSQL、命名卷、零 `.env`）与
  `compose.hub.external-db.yaml`（已有库，连接串写在 compose 命令里）
- **发布工作流**：GitHub Actions 多架构构建 `linux/amd64,linux/arm64`，测试 + 容器冒烟 + 推送 `s1065420329/steamdeals`
- **文档**：`docs/DOCKER-HUB.md`，README/DEPLOY/QUICKSTART/WEB 同步更新

### 变更

- CLI 启动时自动水合数据库设置；老部署（已有管理员）自动导入旧 `.env` 并标记初始化完成
- `all` 模式入口先 bootstrap 再启动，保证首次部署导入种子游戏
- 容器默认使用命名卷，不再需要 `mkdir` / `chown`；`.dockerignore` 排除 `data/secret.key`、测试数据库与备份
- `.env.example` 缩减为部署参数；业务配置不再需要改 `.env`

### 测试

- 新增 `settings.test.js`（默认值/密钥加密/env 导入/水合/事务）与 `setup.test.js`（拦截、初始化、口令、老库迁移）
- `deploy.test.js` 增加 Hub compose、外部库 compose、发布工作流、`.dockerignore` 守卫

## [0.17.7] - 2026-10-27

Steam 登录整体移到后台，前台只展示优惠数据。

### 变更

- **前台移除 Steam 页签与登录入口**：去掉「Steam」tab、Steam 面板、登录弹窗里的「用 Steam 账号登录」按钮及相关脚本；
  本地偏好里残留的 `steam` 页签自动回落到「全部」
- **控制台新增「Steam 账号」页**（仅后台）：OpenID 登录 / 退出、游戏库同步（时长、最低价、未入库标记）、
  单款点击打开 Steam 商店页；原有 `/api/steam/*` 接口不变
- 前台功能收敛为：游戏优惠列表、筛选排序、搜索、详情价格曲线、各平台报价

### 测试

- `deploy.test.js` 新增守卫：前台不得出现 Steam 登录入口/面板/页签，控制台必须有登录与同步入口

## [0.17.6] - 2026-10-27

后台同步体验：不跳页、按钮禁用、实时输出、同步记录；前台分页吸底。

### 新增

- **同步记录**（`sync_runs` 表 + 控制台「同步记录」表）：每次手动同步的任务号、模式、状态、耗时、
  退出码与输出尾巴；服务重启残留的 running 记录启动时自动标失败
- **同步实时输出**：`GET /api/admin/sync/status` 返回运行状态与输出；控制台在同步卡片内滚动显示
- **`GET /api/admin/sync/runs`**：同步历史列表（管理员）
- 同一时间只允许一个同步：运行中再点返回 409（前端按钮同时禁用，结束自动恢复）

### 变更

- 点「增量同步」不再跳转到「日志」页，只提示任务号并原地显示进度；成功/失败后按钮自动恢复
- `sync steamall` 取到 0 条时打印排查指引（`diagnose` 的 `net:steam` 一行）
- 前台分页条改**吸底常驻**（`position:sticky`），长列表滚动时始终可见

### 测试

- 新增 `test/sync-runs.test.js` 2 项；全套 26 个文件 216 项全绿

## [0.17.5] - 2026-10-27

封面图链路诊断细化。

### 变更

- `/img/steam` 兜底路径去重：三条互不重复的路（Cloudflare 代理 → Akamai 直连 → Cloudflare 强制直连）
- `diagnose` 图片探测拆成三行 `net:img:cf-proxy` / `net:img:ak-direct` / `net:img:cf-direct`，
  与图片路由逐条对应；`fetchText` 新增 `forceDirect`（跳过代理决策）

## [0.17.4] - 2026-10-27

Steam 封面图多路兜底（线上图片 404 的修复）。

### 修复

- `/img/steam/<appid>/<size>` 原来只走 Cloudflare CDN 且必须经代理，代理不通就 404。
  现在按 **Cloudflare(代理) → Akamai(直连) → Cloudflare(直连) → Akamai(代理)** 依次兜底，
  每条路 8 秒超时；成功过的路按 appid 记忆复用，失败也缓存 5 分钟避免每次拖满超时
- 图片失败日志从 debug 提到 **warn**（`steam.img_miss` 带失败原因），INFO 级别日志也能看到为什么没图
- `fetchBuffer` 新增 `forceDirect` 参数（跳过代理决策）

### 变更

- `diagnose` 新增两条封面图链路探测：`net:img:cloudflare` / `net:img:akamai`，
  图片打不开时跑 `docker compose exec app node src/cli.js diagnose` 一眼定位是哪条路不通

## [0.17.3] - 2026-10-27

游戏类型（游戏 / DLC）在前台体现；开发商/发行商同步补强。

### 新增

- 前台列表：DLC / 试玩 / 音乐等非游戏类型显示**类型徽标**（`app_type` 由 `gameOverview` 下发）；
  游戏详情弹窗 facts 首项显示「类型」，控制台游戏列表新增「类型」列
- 同步日志输出 DLC 数量（`sync.steamall.done` 带 `dlc` 计数）

### 修复 / 变更

- **类型大小写统一**：官方接口（`dlc`）与 steamcmd 镜像（`DLC`）的 `type` 全部归一化成小写入库
  （新增 `normalizeType`；`upsertGameMeta` 防御性再归一，老库大小写混用的数据随下次同步自动纠正，
  前端按小写匹配，旧数据也能立即正确显示）
- 开发商 / 发行商：此前已在同步链路中提取落库（两个后端都抓 `developers` / `publishers`），
  本次补上入库断言与 DLC 落库测试，保证不再回退

### 测试

- `steam-meta.test.js` 新增类型归一化用例；`gamemeta.test.js` 新增开发商/发行商/DLC 落库用例（共 214 项全绿）

## [0.17.2] - 2026-10-27

验证码邮件内容落库，用户收不到邮件时管理员可直接提供验证码。

### 新增

- `email_codes` 表新增 `subject` / `body` 列：登录、重置密码、绑邮箱、SMTP 测试四类邮件的
  主题与正文在**发送前**就落库（发送失败也能查到内容）
- 控制台「验证码发送记录」新增「查看」按钮：弹窗展示邮件主题/正文 + 元信息（收件人、用途、过期时间、是否已使用），
  「复制验证码」一键复制正文里的 6 位码
- `GET /api/admin/emails` 返回 `subject` / `body` / `expires_at` / `used_at`

### 变更

- 每日备份任务顺带清理 3 天前的邮件记录（正文含明文验证码，不留存太久）

### 测试

- `test/email-auth.test.js` 新增 2 项：schema 含 subject/body 列；假 SMTP 端到端
  （发码 → 正文验证码可哈希校验 → 管理员接口可读 → 过期清理），共 8 项

## [0.17.1] - 2026-10-27

前台实时刷新提速 + 真实游戏数量 + 详情弹窗头图。

### 新增

- **`GET /api/games/count`**（匿名可读）：返回库内游戏总数与"已有价格"的游戏数。
  列表接口最多 500 条，此前后台游戏超过 500 款时前台数量永远停在 500，看起来像"没更新"
- **详情弹窗 Steam 头图**：打开游戏详情时顶部显示 `/img/steam/<appid>/header`（加载失败自动隐藏）

### 变更

- 前台实时刷新从 60 秒加快到 **10 秒**；页面从后台切回可见时立即刷新一次；
  Steam 页签也随每次轮询刷新（游戏库/时长同步后不用手动刷新）
- 前台顶部元信息改为「库内 N 款 · 有价格 N 款 · 更新于 HH:mm:ss（自动刷新）」

## [0.17.0] - 2026-10-27

访问者记录与 IP 黑名单；控制台游戏管理页重构。

### 新增

- **访问记录**：每次页面/API 请求落库 `visitor_logs`（IP + 归属地 + 路径 + 状态码），
  静态资源不记；IP 归属地异步解析（ip-api.com → ipwho.is 兜底，24h 内存缓存，内网地址不查）
- **后台「访问记录」页**：今日访问/独立 IP/黑名单数汇总、近 24h 高频 IP、分页记录（可按 IP/路径过滤）
- **IP 黑名单**：后台增删（支持单个 IP 与 IPv4 CIDR），命中即整站 403（server 层拦截、常驻内存零查询），
  管理员会话自动放行避免自我锁死
- **游戏管理页重构**：删除「愿望单导入」卡片与「单个游戏编辑」区块；
  列表「编辑」改为弹窗（说明/禁用）；「同步 Steam」卡片置顶

### 修复

- `src/steam-login.js` 误用 `../http.js` 导入：Steam 登录及所有位于其后的后台路由全部 500（`70cab61` 引入）
- 全新库上 `/api/admin/users` 报 `column "email" does not exist`：users 表的 email/steam_id 列补进迁移
- `deploy.test.js` 的 shebang 断言跟随入口脚本改为 `#!/bin/bash`

### 测试

- `test/visitors.test.js` 5 项（IP/CIDR 校验与匹配、记录落库与过滤、黑名单拦截与管理员放行、权限隔离）并纳入 `npm test`

## [0.16.0] - 2026-10-26

前后端分离落地：有了真正的 Web 前端与用户系统。

### 新增

- **`web/` 前端工程**（零构建单页）：列表 + 筛选（全部/感兴趣/不感兴趣/已拥有）+ 排序（折扣/价格/名称）
- **游戏详情弹窗**：客户端 SVG 价格曲线、各平台报价、开发商/发行商/分类
- **后台管理页**（仅管理员）：用户列表、浏览排行；可直接标记感兴趣/已拥有
- **访客本地偏好**：未登录也能筛选排序，选择存 `localStorage`，不上传服务端
- **`user` 命令**：`user add <名> [--admin]`，密码只显示一次；`user list`
- **`backup` 命令**：8 张核心表导出 gzip JSON 到 `data/backup`，保留最近 7 份
- **浏览记录 90 天清理**（随备份任务执行）
- **[docs/WEB.md](docs/WEB.md)**：API 契约、权限矩阵、部署要点

### 修复

- `serve` 启动报 `startApiServer is not defined`（导入缺失），全栈服务无法启动
- Steam `appdetails` 批量请求返回 400：改为逐个 appid 请求，并顺带取分类与价格字段
- 元数据曾覆盖人工维护的游戏名：改为只补空缺

### 变更

- 仓库更名 `gameprice` → **`steamdeals`**（旧地址 301 重定向）
- `discover`（杉果目录发现）默认关闭：以 Steam 为准，只在需要补 SKU 映射时手动开启
- 调度器新增每日 `backup` 任务（`BACKUP_ENABLED=0` 可关）

### 测试

- `test/api.test.js` 5 项（匿名可读、权限隔离、登录登出、密码哈希、已拥有）
- 调度器测试更新为 8 个任务


## [0.15.0] - 2026-10-26

用户系统与只读 API。

### 新增

- `users` / `sessions` / `user_prefs` / `page_views` 四张表，migrate 幂等创建
- scrypt 加盐哈希 + httpOnly cookie 会话（7 天）
- API：`/api/games`、`/api/games/:appid`、`/api/login`、`/api/logout`、`/api/me`、`/api/prefs`、`/api/admin/*`
- 权限隔离：匿名只读，写操作需登录/管理员；**Web 层没有任何改价接口**

## [0.14.0] - 2026-10-26

不用 nginx，直接 `IP:端口` 看页面。

### 新增

- **内置静态页服务** `serve`（`src/serve.js`，零依赖，用 node:http）
  - compose 新增 `web` 服务，复用同一个镜像，默认对外 **8090**（避开已被占用的 80）
  - `WEB_PORT` 可改端口，`OUT_DIR` 决定服务哪个目录
  - 安全边界：只读 `OUT_DIR` 之内（路径穿越 403）、只允许 GET/HEAD（其余 405）、
    HTML 不缓存（页面上是价格）、`x-content-type-options: nosniff`
- `serve --port/--dir/--host`，`--port 0` 时由系统分配

### 说明

宿主机上常有 nginx 占着 80，且用户只想"IP+端口直接访问"。为此不引 nginx、不加反代，
而是把静态服务做进应用：少一个组件就少一处故障点。想挂到已有 nginx 也可以，
把 `OUT_DIR` 设成 `data/out`，nginx 直接指过去（教程里有配置）。

### 验证

- `test/serve.test.js` 5 项：路径穿越（含 URL 编码 `../` 与空字节）、内容类型、GET/HEAD/405
- 真实运行：对着 48 款游戏的生成目录起服务，
  `GET /` 200（14KB）、`GET /game-105600.html` 200、`GET /nope` 404、`HEAD /` 只有头
- 部署测试新增断言：web 服务复用镜像、端口 `${WEB_PORT:-8090}:8080`、不含 nginx
- 合计 195 项

## [0.13.0] - 2026-10-26

修掉两个会让首次部署直接失败的坑（是我之前的"零配置"说法不够准确）。

### 修复

- **`docker compose up` 不会启动数据库**：`db` 服务原来挂在 `profiles: ["bundled"]` 下，
  而没有 `.env` 时 `COMPOSE_PROFILES` 为空 → db 不启动 → app 连 `db:5432` 被拒、无限重启。
  现在 db 默认随 `up` 启动；用外部数据库时执行 `docker compose up -d app` 只起 app。
- **宿主机挂载目录权限**：容器以 `node`(uid 1000) 运行，`./data`、`./logs` 属主是 root 时
  写日志 `EACCES`，报错藏在启动日志深处。现在入口脚本启动前检查可写性，
  直接打印修复命令（`sudo chown -R 1000:1000 ./data ./logs`）并以 2 退出。

### 新增

- **[docs/QUICKSTART.md](docs/QUICKSTART.md)**：云服务器从零部署教程——装 Docker、权限、
  验收四命令、提醒通道配置、静态页托管（`OUT_DIR=data/out` + nginx）、网络方案、日常运维、
  故障速查表
- 部署测试新增断言：db 不得依赖 profile 才启动；入口脚本必须检查挂载目录可写

### 验证

- `test/deploy.test.js` 10 项、`test/docs.test.js` 5 项（含新文档的链接检查）全绿
- `bash -n scripts/docker-entrypoint.sh` 通过；`compose.yaml` YAML 解析通过
- **本机没有 Docker，镜像仍未经真实构建**：以上是结构与语法验证

## [0.12.0] - 2026-10-26

国内服务器访问 Steam 的问题，有了可配的出口。

### 新增

- **按主机分流的出网代理**（`src/proxy.js` + `src/http.js`）
  - `STEAM_PROXY`：只作用于 Steam 域名（store/api/community）
  - `HTTPS_PROXY`：通用代理，受 `NO_PROXY` 排除
  - 境内源（杉果）和可达源（GOG/Humble）保持直连——全走代理既慢又浪费流量
  - 支持 `http(s)://`（undici `ProxyAgent`），**不支持 socks5**；代理密码在日志与 `diagnose` 中脱敏
  - 每个请求日志带 `via=direct|proxy|steam-proxy`，失败信息也带上走了哪条路
- `diagnose` 增加 `proxy:steam` / `proxy:others` 两行，部署后第一眼就能确认出口配置
- `scripts/local-proxy.js`：零依赖的最小代理（HTTP absolute-form + HTTPS CONNECT），
  用来验证"请求确实被转发了"而无需第三方工具

### 验证

- `test/proxy.test.js` 10 项：决策矩阵、NO_PROXY 匹配、密码脱敏、**本地起代理真实转发**
- 真实 HTTPS 验证：`HTTPS_PROXY=http://127.0.0.1:8899` 下，`import steam` 成功且日志 `via=proxy`，
  代理端记录 `CONNECT api.steamcmd.net:443`；`STEAM_PROXY` 下 Steam 请求记录
  `CONNECT store.steampowered.com:443` 并报 `经 steam-proxy`
- 合计 184 项

## [0.11.0] - 2026-10-26

游戏信息不用手填了。

### 新增

- **Steam 游戏信息导入** `import steam`
  - 支持 `--appids 730,570`、`--urls <商店链接>`、`--file <清单>`（每行一个 appid 或链接）
  - 写入中文名、英文名、类型、封面、发行日期、开发商/发行商
  - **双后端自动回落**：先探官方 `appdetails`（5s 超时），不通则用 `api.steamcmd.net`
    （Steam PICS 数据镜像，实测本机可达），实际用的后端记进 `steam.meta.done`
  - `--backend auto|official|steamcmd` 可强制指定
- 实测：6 个 appid 全部导入成功，中文名与封面齐全

### 修复

- **元数据把人工维护的名字改坏了**：730 的 `sc_schinese` 还是旧的「反恐精英：全球攻势」，
  第一版"元数据覆盖"策略把它盖掉了「反恐精英 2」。现在名字**只补空缺不覆盖**
  （`coalesce(games.name, excluded.name)`）；`is_free` 用 null 判断，镜像给不了时不会误改成 false。

### 已知

- 镜像**不提供 `is_free`**，也**不能按名字搜索**（只能给 appid 或商店链接）。
  官方接口可达时这两个限制都不存在。

### 测试

- 新增 `test/steam-meta.test.js` 11 项、`test/gamemeta.test.js` 5 项
- 合计 174 项

## [0.10.0] - 2026-10-26

采集完自动刷新页面，不用再手动跑 `chart`。

### 新增

- **曲线页自动重建**：调度器在采集类任务成功后自动执行 `chart`
  - 触发条件：任务是 steam/sonkwo/itad/gog/humble/discover 且退出码为 0
  - `CHART_ON_SYNC=0` 可关闭（例如页面由 CI 构建）
  - `OUT_DIR` 可配置输出目录
  - 重建失败只记 `scheduler.job_failed`（job 名 `sonkwo:chart`），不影响主任务状态
- 实测：46 个杉果 SKU 同步完成（65.5s，41 条新快照）→ 自动重建 48 款游戏、49 个文件、337ms

### 测试

- 调度测试新增 1 项：成功触发 / 失败不触发 / 非采集任务不触发 / 可关闭
- 合计 158 项

## [0.9.0] - 2026-10-26

`region` 终于不只是数据库里的一个字段。

### 新增

- **多区服采集**：GOG 支持按国家/币种查询，`sync gog --regions cn,us`（或 `GOG_REGIONS`）
  - 显式区服映射表（cn/hk/tw/us/jp/ru/tr/ar → 国家 + 币种），未知区服直接报错
  - 实测：泰拉瑞亚 cn ¥36.00 / us $9.99，星露谷 cn ¥48.00 / us $14.99
- **多区服对比** `compare <appid>`
  - 按区服分组、组内按价格排序、标出"该区最低"
  - **不同币种不做汇率折算**，只并排展示并明确提示不可直接比较
  - `--region cn` 只看单区、`--json` 输出机器可读结构
- 存储层 `regionOffers()`：跨区查询，同样只统计官方/授权渠道

### 设计说明

不做汇率折算的理由：折算需要实时汇率，硬编码会把比较做**错**；用户真正关心的是
"这个区多少钱"，而不是"折成人民币多少"（后者还涉及支付方式能否落地）。所以只在
**同币种内**比数字。

### 测试

- `test/compare.test.js` 7 项、`test/regions.test.js` 4 项、gog 区服 2 项
- 合计 157 项

## [0.8.0] - 2026-10-26

把"46 条孤立价格"和"Steam 游戏"接上的那一环。

### 新增

- **跨平台名称匹配** `match`
  - 归一化：去版本词（标准版/豪华版/Deluxe/Ultimate/GOTY…）、去平台标注、全角转半角、去标点
  - 相似度用**字符 bigram 的 Dice 系数**（中文无词边界，比编辑距离稳），并对"包含关系"给部分分
  - 标题拆成中/英多个写法分别比较（杉果标题常是「中文名 版本（Steam） English Name」）
  - 阈值分级：≥0.94 自动应用、0.86–0.94 待人工 `--confirm`、<0.86 无候选
  - `--apply` 写入 `data/skus.json`；`--confirm <skuId> <appid>` 手工确认
- **重复游戏行合并** `mergeGames()`
  - 确认 appid 后，把早期按名称建出的孤立行并进 Steam 游戏行：
    报价（快照跟随 offer_id）、日聚合（同键取 LEAST）、别名、关注列表，最后删源行
  - 同平台同渠道类型的重复报价保留目标行，源行快照一并清理

### 修复（都是真实数据暴露的）

- **`™` 被 NFKC 展开成 "TM"**：`ELDEN RING™` 归一化成 `elden ringtm`，匹配不到。
  改为先去商标符号再 normalize。
- **中文片段把数字删了**：早期用"删掉所有 ASCII 取中文"，`全境封锁2` 变成 `全境封锁`。
  改为"必须以汉字开头、允许后接数字"的匹配。
- **纯数字被当成中文变体**：`Cyberpunk 2077` 生成变体 `2077`，与中文标题里的 `2077`
  得到 0.6 的假高分。中文片段现在要求以汉字开头。

### 测试

- `test/match.test.js` 11 项、`test/merge.test.js` 5 项（真 PG 语义）
- 合计 144 项

### 已知

- 真实运行 `match` 对 46 个杉果 SKU 返回 0 提案——它们与现有 24 款 Steam 游戏没有交集。
  这是数据覆盖问题，扩大游戏库后即可work。

## [0.7.0] - 2026-10-26

杉果不用再手工加 SKU 了。

### 新增

- **杉果 SKU 自动发现** `discover sonkwo`
  - 杉果没有搜索接口（loader 服务端报错、`/api/*` 已下线 410），改为**按 sku id 顺序探测**：
    id 连续、密度约 70%，未上架/已下架的 id 返回 200 的空壳页（无价格），用解析结果区分
  - 策略：从前沿（已知最大 id）向后扫，**连续 N 个空壳即停**，通常十几到几十次请求
  - 发现的 SKU（含名称）自动并入 `data/skus.json`，已有 `appid` 映射与名称不会被覆盖
  - 扫描水位记录在 `data/sonkwo-discovery.json`（已 gitignore）
  - 调度器新增 `discover` 任务（默认 12 小时一次）
- 实测：扫 120 个 id 命中 46 个商品（111442–111491 密集区，111492 后为空壳），新增 45 条

### 修复

- **空壳页被记成 ERROR**：批量发现时 74 个空壳页产生 74 条 `adapter.sonkwo.no_price` 错误日志，
  会污染 `error-*.jsonl`。现在能区分"这个 id 没有商品"（`adapter.sonkwo.not_a_product`，debug 级）
  与"商品页解析不出价格"（仍是 error 级）。

### 工具

- `scripts/probe-skus.js`：按区间抽样统计 SKU 密度，用于设计扫描窗口；
  判定标准与适配器一致（能解析出报价才算商品）

### 测试

- 新增 `test/discover.test.js` 9 项：区间计算、连续空壳停止、404/异常容错、合并去重
- sonkwo 测试补空壳识别 2 项
- 合计 128 项

## [0.6.0] - 2026-10-26

真正做到一键部署、零配置开箱即用。

### 新增

- **自动建库**：`ensureDatabase()` 在连接前检查目标库，不存在就连维护库 `/postgres` 执行
  `CREATE DATABASE`（标识符转义、支持 URL 编码的中文库名）。无建库权限时只记 `db.autocreate_failed`
  并继续，让后续真实连接报出更明确的错误。
- **compose 零配置**：去掉必填的 `POSTGRES_PASSWORD`，内置库改用 `trust` 认证且**不发布端口**；
  `docker compose up -d --build` 三条命令即可，不需要 `.env`、不需要先建库建表。
- **CLI 自动降级**：没有 `DATABASE_URL` 也没有 `--db` 时，自动使用嵌入式 PG（`data/pgdata`），
  本地试验零前置。

### 测试

- 新增 `test/store.test.js` 10 项，其中最后一项用 **PGlite + PGLiteSocketServer 起真 TCP Postgres**，
  实测 `CREATE DATABASE` 成功、重复调用变为 `exists`、并在 `pg_database` 里查到新库。
- 部署测试新增断言：compose 默认免密启动、数据库端口不对外、`DATABASE_URL` 与 trust 匹配。
- 合计 117 项。

## [0.5.0] - 2026-10-26

提醒终于能推到手上了。

### 新增

- **三种提醒通道**（`src/notify.js`），可同时配置
  - 通用 webhook（原有）
  - 企业微信群机器人：`errcode=0` 才算成功，HTTP 200 但 errcode 非 0 会判失败
  - 邮件：自实现 SMTP 客户端，支持隐式 TLS(465) 与 STARTTLS(587)、AUTH PLAIN / LOGIN
- **`notify-test` 命令**：给所有已配置通道发一条测试消息，部署时先跑这个
- `alerts` 输出每个通道的投递结果（✔/✘ + 状态码）；任一通道成功才标记已通知
- `channelsFromEnv()` / `hasNotifier()`：通道完全由环境变量决定，调度器据此决定是否传 `--mark`

### 实现说明

- 邮件没有引入 nodemailer：运行时依赖仍只有 `pg`，且协议对话可在本地假 SMTP 服务器上逐行断言
- 中文主题按 RFC 2047（`=?UTF-8?B?...?=`）编码，正文 base64 + 76 字符折行，避免客户端乱码
- 通道失败只记日志不抛异常：一个通道挂了不能影响其它通道和整轮任务

### 测试

- 新增 `test/notify.test.js` 10 项，其中 SMTP 全流程用 `net.createServer` 起假服务器，
  断言 `EHLO → AUTH PLAIN(base64 校验) → MAIL/RCPT → DATA → QUIT` 与收到的 MIME 内容
- 合计 106 项

## [0.4.0] - 2026-10-26

数据源从 1 个变成 3 个。

### 新增

- **GOG 适配器**（`sync gog`）
  - 用官方商店前端的 catalog 接口，直接拿 CNY 价格，无需解析页面
  - 实测 24 款中匹配 8 款（泰拉瑞亚 ¥36、星露谷 ¥48、空洞骑士 ¥58、茶杯头 ¥68、死亡细胞 ¥40、赛博朋克 ¥89、博德之门 3 ¥298、冰汽时代 ¥16）
  - **只接受标题归一化后完全相等的产品**：GOG 的 `like:` 是模糊搜索，GOG 不卖的游戏会返回无关热门商品，宁可判空也不能张冠李戴
- **Humble 适配器**（`sync humble`）
  - 搜索接口被 Cloudflare 挡（403），改为按英文名生成 slug 探测商品页，解析 schema.org JSON-LD 的 `offers.price`
  - 名称必须完全一致才接受；404 与"重定向到商店首页"都按"这家店没有"处理
- **英文名支持**：`data/games.json` 增加 `nameEn`，`seed` 写入 `games.name_en`（GOG/Humble 只能按英文检索）
- 调度器新增 `gog` / `humble` 任务（默认 12 小时一次）
- 报价可携带 `steamAppid`，按名检索的源据此并入已有游戏行而不是新建

### 修复

- **GOG 折扣算错**：`price.finalMoney.discount` 是"省了多少钱"（如 209），不是百分比；改为由 final/base 自行计算，`-70%` 才不会被显示成 `209%`
- **Humble 把"不存在"当成"页面结构变了"**：商品不存在时会被 302 到商店首页并返回 200（700KB 无 JSON-LD），现在检查最终 URL 判定为 `redirected`
- **GOG 报价没有带上 steamAppid**，导致 8 款游戏被建成英文名的新行（实测 `noAppId=8`）；修复后 `noAppId=0`、游戏总数不变

### 未接入

- **Fanatical**：商品页是 SPA（HTML 里没有价格），数据走 Algolia 代理，而 `/algolia/key` 被 Cloudflare 返回 403。没有可靠取数路径，暂不实现，避免用错误数据充数。

## [0.3.0] - 2026-10-26

从"能看"到"会叫你"。

### 新增

- **关注列表**（`watchlist` 表，第 8 张表）
  - `watch add <appid> --target 99`：到目标价提醒
  - `watch add <appid>`：不带目标价时，跌到史低才提醒
  - `watch rm` / `watch list`
- **降价提醒** `alerts`
  - 两种触发语义：目标价优先，未设目标时看是否破史低
  - **按价格去重**：同价位不重复打扰，更便宜才再通知（不用时间窗口）
  - `--json` 输出机器可读载荷、`--mark` 记录已通知、`--webhook URL` 投递
  - 没配 webhook 时**不标记**已通知，避免静默吞掉提醒；投递失败不标记、下轮重试
- **采集熔断**
  - 同一任务连续失败 `CIRCUIT_THRESHOLD`（默认 3）次后暂停 `CIRCUIT_COOLDOWN_MIN`（默认 360）分钟
  - 熔断期间只记 `scheduler.circuit_skip`，不再请求目标站；成功一次即复位
- **老库自动迁移**：命令执行前检查 `to_regclass`，缺表自动补 DDL，不需要记住先跑 `init`
- 调度器新增 `alerts` 任务（默认 6 小时一次）；`ALERT_WEBHOOK_URL` 存在时才传 `--mark`

### 修复

- 演示数据里多平台报价被归到同一平台的问题，现在会记 `ingest.platform_mismatch`（上个版本的行为修复，本次补测试）

## [0.2.0] - 2026-10-26

价格历史终于能"看"了。

### 新增

- **静态价格页** `node src/cli.js chart`
  - 列表页：每款游戏当前最低价、原价、折扣、史低、迷你看板
  - 详情页：90 天价格曲线 + 当前最低 / 历史最低 / 区间均价 / 区间最高 + 各平台报价表
  - 纯静态：内联 SVG，无外部 JS/CSS/字体，离线可打开；单页约 7KB
  - 所有外部文本（游戏名、平台名）转义
- **演示数据脚本** `scripts/demo-seed.js`：造 3 款游戏 90 天曲线，用于本地看效果或截图
- 存储层新增查询：`gameOverview` / `dailyMinSeries` / `dailyPlatformSeries` / `offersOfGame`

### 修复

- **多平台报价会被归到错误的平台**：`ingestOffers` 用批次的 `platform` 作为默认值，若一个批次里混了多个平台而 offer 未自带 `platform` 字段，后来的报价会被静默记到第一个平台名下（演示数据里"杉果 ¥118"被显示成"Steam 国区"）。现在会记 `ingest.platform_mismatch` 告警，演示脚本也改为逐条携带 platform。
- **Y 轴刻度不可读**：原实现按数据范围 ±8% 均分，出现 ¥83 / ¥141 这类标签；改为 1/2/5 × 10ⁿ 步长对齐。

## [0.1.0] - 2026-10-26

首个可用版本：从零到"能自动采集、能查历史、能远程排障、能一键部署"。

### 新增

- **采集适配器**
  - Steam 国区：官方 `appdetails`，支持逗号分隔批量、限速、失败重试
  - 杉果：解析商品页内嵌 `window.__remixContext` 结构化 JSON，DOM 仅作兜底
  - IsThereAnyDeal：官方 REST API（`/games/search/v1`、`/games/prices/v3`），按商店拆成独立平台
- **存储（PostgreSQL 15）**
  - 六张表 + 一个主榜视图：`games` / `game_aliases` / `offers` / `price_snapshots` / `daily_prices` / `fetch_runs` / `v_lowest_official`
  - "只收官方渠道"做成视图约束，C2C 无法进入主榜
  - 快照按内容指纹判重，价格不变不写入
- **调度**
  - 常驻调度器，三个任务各自独立子进程，崩溃不影响其它任务
  - 首轮触发错开（30s / 180s / 300s），避免启动瞬间打满
- **日志**
  - JSONL 结构化日志，`runId` 串联一次命令的全部事件
  - 请求级埋点：`http.request/response/retry/error/fail`，带 `requestId`
  - 密钥自动脱敏，连接串只抹密码
  - 按大小轮转（8MB / 保留 10 份），错误额外落一份 `error-*.jsonl`
  - `logs` 命令支持按级别 / 事件 / runId / 时间过滤
- **运维**
  - `diagnose`：环境、数据库、网络逐项自检并落盘报告
  - `ping`：健康检查命令
  - `bootstrap`：容器启动时建表 + 首次导入，幂等
- **部署**
  - Dockerfile：非 root、tini、`npm ci --omit=dev`、healthcheck
  - compose：内置 postgres:15（可选 profile），支持外部库
  - `.gitattributes` 锁定 LF，避免 CRLF 破坏容器入口脚本
- **文档**
  - README：定位、边界、架构、命令、配置、限制
  - `docs/ARCHITECTURE.md`：设计取舍、失败模型、扩展新平台指南
  - `docs/DATA-SOURCES.md`：四个数据源的可达性实测与勘查方法
  - `docs/DEPLOY.md`：两种部署方式、运维命令、故障排查表

### 修复

开发期由测试抓到的三个会产生**错误数据**的缺陷：

- **杉果取错版本价格**：页面顶部先渲染"荣光痴人版 ¥269"，本 SKU 实际 ¥198。原实现取第一个价格，现改为按 `sku_id` 精确匹配 JSON，DOM 兜底只认"购买区"块。
- **DATE 被解析成带时区的 `Date`**：跨时区会差一天，导致日聚合把一天拆成两天、史低判断偏移。改为 identity parser + SQL `::text`。
- **错误日志被读两遍**：error 同时写入 `app-*.jsonl` 与 `error-*.jsonl`，`readLogs` 不区分来源导致重复计数。

### 已知问题

- Steam 官方接口在国内网络直连不可达（`UND_ERR_CONNECT_TIMEOUT`），需出口或改走 ITAD。
- 杉果无可用搜索接口，SKU 需人工维护（`data/skus.json`）。
- ITAD 响应结构按官方文档实现，尚未用真实 key 验证。
- 无失败熔断：某源持续 403 时仍需人工关闭。
- 无前端界面，当前只有 CLI。

