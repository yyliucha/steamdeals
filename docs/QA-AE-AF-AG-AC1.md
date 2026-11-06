# QA：AE + AF + AG + AC-1（四批并做，第 1 轮）

## 功能清单（用户视角，供所有者验收）

| # | 功能（用户能感知到的一条 = 一行） | 对应批次 |
|---|---|---|
| 1 | 后台版本徽标按服务器位置自动选镜像仓库：大陆/香港查腾讯云 TCR，其他地区查 Docker Hub，不再依赖不稳定的 GitHub | AE |
| 2 | 首选仓库失败自动回退另一个；两个都失败回退 GitHub——徽标永远有兜底 | AE |
| 3 | 徽标查询结果带「来源 + 区域」（source/region），排障可查 | AE |
| 4 | 搜索关键词状态下加/删愿望单、切换感兴趣/已拥有标记，卡片立刻刷新（不再手动刷新或等 30 秒） | AF |
| 5 | 无搜索词时行为不变；不做写操作时二次搜索仍走缓存（不额外发请求） | AF |
| 6 | 后台「游戏管理」新增「链接」列（显示 N 个），点击打开抽屉，列出该游戏全部平台购买链接（逐条可打开，带平台/区服/价格/更新时间） | AG |
| 7 | 无链接但有 AppID 的游戏，抽屉里给 Steam 商店兜底链接；`javascript:` 等脏链接不显示 | AG |
| 8 | 后台游戏名 / AppID 点击复制；前台卡片标题与详情标题可复制游戏名（HTTP 环境也可用，成功/失败都有提示） | AG |
| 9 | 后台「同步记录」可见所有数据任务每轮记录（heat/rename/回填/封面图/备份/清理/提醒等，此前只有部分任务有） | AC-1 |
| 10 | 后台「同步与回填」任务表新增「上次结果 / 耗时 / 失败原因」三列，任务健康一眼可见 | AC-1 |
| 11 | Steam 重任务互相排队时，任务表显示「等待 XX」（占用者），日志记录排队开始/结束与时长 | AC-1 |
| 12 | 后台「同步与回填」页顶部提示「该有但没有」的任务（缺 STEAM_API_KEY 或被 *_ENABLED=0 关闭），不再静默消失 | AC-1 |

> 第 2 轮复检（2026-11-06 16:15）：HEAD 未变（c4bb868），全量 `npm test` 重跑 EXIT=0（56 个文件全绿）、
> `frontend:build` EXIT=0、`scan` EXIT=0；状态词审计通过；无新增 tag；结论维持 ✅ 放行。

> 基线 `87b98d1` → 交付 `cd332fa`；判据：[VERSION-SOURCE.md](VERSION-SOURCE.md) §5、[FRONTEND-STALE-LIST.md](FRONTEND-STALE-LIST.md) §5、
> [ADMIN-PLATFORM-LINKS.md](ADMIN-PLATFORM-LINKS.md) §5、[SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md) §6（AC-1 观测批）；TODO 条目 AE / AF / AG / AC。
> 结论：**✅ 放行 —— 通过 24 / 缺失 0 / 偏差 0 / 需人工确认 5**

| # | 条目 | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | AE：detectRegion（ipinfo.io，2s 超时，24h/10min 缓存） | grep `ipinfo.io` | version.js `detectRegion` | ✅ |
| 2 | AE：CN→先 TCR、其他→先 Hub（pickSourceOrder） | 单测 | test/version.test.js「pickSourceOrder」 | ✅ |
| 3 | AE：两仓库匿名 token + tags 无 v 前缀取最大 | 单测 | version.test.js「CN→只请求 TCR」「tag 过滤」 | ✅ |
| 4 | AE：TCR 401 → 换 token 重试成功（不直接回退） | 单测 | version.test.js「TCR tags 首次 401」 | ✅ |
| 5 | AE：双仓库全失败 → GitHub 兜底；geo 超时不阻塞 | 单测 | version.test.js「geo 超时与双仓库全失败」 | ✅ |
| 6 | AE：结果缓存（成功 6h / 全失败 10min）+ /api/admin/version 透传 source/region | 单测 + grep | version.test.js「结果缓存」；server.js UPDATE_CHECK=0 分支同构 | ✅ |
| 7 | AF：invalidateSearchCache + 四个写操作接线（失效在 loadGames 前） | 静态断言测试 | test/frontend-search-cache.test.js 6 项 | ✅ |
| 8 | AF：缓存能力保留（30 秒分支仍在） | 静态断言 | frontend-search-cache.test.js 第 6 项 | ✅ |
| 9 | AG：`/api/admin/games/:id/links` 只返回 http(s)、按平台排序、多区服、404/401/403 | HTTP 测试 | test/admin-games.test.js 3 项 | ✅ |
| 10 | AG：列表 `link_count` 只计合法链接 | HTTP 测试 | admin-games.test.js「列表带 link_count」 | ✅ |
| 11 | AG：clipboard.js（clipboard API + execCommand 降级）+ 抽屉/复制接线 | grep + build | utils/clipboard.js；AdminModules/Home 引用；`frontend:build` EXIT=0 | ✅ |
| 12 | AC1：auditJobs 缺 Key / `*_ENABLED=0` 显式提示 | 单测 | test/scheduler.test.js「auditJobs」2 场景 | ✅ |
| 13 | AC5：job_wait_slot/job_wait_end 日志 + 状态文件 waitingFor | 目检 + 单测 | scheduler.js 重任务循环；scheduler.test.js「状态文件带健康面板字段」 | ✅ |
| 14 | AC11：状态文件 lastElapsedMs/lastResult/lastError | 单测 | scheduler.test.js 同用例 | ✅ |
| 15 | AC10/AC3：数据任务统一 runSyncTracked（heat/rename/backfill/discover/images/backup/prune/alerts/report/logs-prune） | grep + 单测 | cli.js TRACKED_COMMANDS；cli-dispatch.test.js 2 项 | ✅ |
| 16 | AC1/AC11：/api/admin/sync/status 带 warnings + 前端任务健康列与警告条 | grep + build | server.js `auditSchedulerJobs`；AdminModules.vue 四列 + el-alert | ✅ |
| 17 | 文档四方一致：WEB/PROJECT-OVERVIEW/DOCKER-HUB/DEPLOY 与规格状态行 | grep/读 | 5 份文档均已同步；TODO/INDEX/HANDOVER 状态「已实现待发版（待质检）」 | ✅ |
| 18 | 验证重跑 | 命令输出 | `npm test` EXIT=0（56 个文件全绿，含 version 11 项 / frontend-search-cache 6 项 / admin-games 3 项 / scheduler 25 项）；`frontend:build` EXIT=0；`scan` EXIT=0 | ✅ |
| 19 | 纪律：无新增 tag、无构建产物、已推 main | git 取证 | tag 最新 v1.17.0（授权）；diff 仅源码/测试/文档；cd332fa 在 main | ✅ |
| 20–24 | AE/AF/AG 各规格其余验收条（浏览器行为/生产网络） | 本地无法验证 → 🔎（见下） | — | 🔎 ×5 |

## 需人工确认（部署后验证）

1. **AE §5 真实网络**：服务器（大陆）上 ipinfo/TCR token/tags 实际可达、徽标 source=tcr；本机测试全部用注入桩。
2. **AF §5.1-5.4 浏览器行为**：搜索态下加/删愿望单、切换标记，卡片**立刻**变化；无搜索词行为不变；二次搜索仍走缓存。静态断言已锁接线，交互需真浏览器。
3. **AG §5.6-5.8 交互**：后台复制不触发行内动作、前台复制不打开详情、手机抽屉全屏可滚动可点开链接。
4. **AC5 实跑**：调度器日志出现 `scheduler.job_wait_slot`/`job_wait_end`（重任务互相排队时），面板「等待 X」列正确显示占用者。
5. **AC10 实跑**：heat/rename 等长任务结束后 `sync_runs` 出现对应 mode 行，后台「同步记录」可见。

## 查多

- 无需求外改动；工作区出现其他会话的未跟踪文件 docs/USER-LIFECYCLE.md（未纳入本批、未提交）。

## 复检记录

第 1 轮（2026-11-06）：✅ 放行（5 项转部署后验收）。
