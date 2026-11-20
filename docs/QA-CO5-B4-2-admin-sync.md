# QA：admin-sync 域拆分（CO-5/B4-2 第九轮，B4 #9）（第 1 轮）

> 基线 9e212b7 → HEAD 工作区（未提交）；判据 docs/B4-QUEUE.md #9 行 + docs/ARCHITECTURE.md §15（15.1–15.6）+ 先例域（admin-access 管理段单入口 / announcements 管理段 / site 三段）。
> 结论：✅ 放行 —— 通过 14 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条功能一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | B4#9 | 一键同步（catalog/steam-prices/steamall/itad/gog/humble/sonkwo 七模式，占用中 409） | 后台 → 任务 → 立即同步 → `POST /api/admin/sync` | ✅ | src/routes/admin-sync.js:76 |
| 2 | B4#9 | 查看同步状态（运行态/最近记录/调度/回填进度/四源统计/告警，3s 短缓存） | 后台 → 任务 → `GET /api/admin/sync/status` | ✅ | src/routes/admin-sync.js:108 |
| 3 | B4#9 | 查看同步任务记录列表 | 后台 → 任务 → `GET /api/admin/sync/runs` | ✅ | src/routes/admin-sync.js:140 |
| 4 | B4#9 | 手动重置任务熔断 | 后台 → 任务 → 重置熔断 → `POST /api/admin/circuit/reset` | ✅ | src/routes/admin-sync.js:148 |
| 5 | B4#9 | 启动数据回填（批量补元数据/价格，占用中 409） | 后台 → 任务 → 回填 → `POST /api/admin/backfill` | ✅ | src/routes/admin-sync.js:163 |
| 6 | B4#9 | 停止回填（SIGTERM + 10s SIGKILL 兜底；无任务 409） | 后台 → 任务 → 停止 → `POST /api/admin/backfill/stop` | ✅ | src/routes/admin-sync.js:185 |
| 7 | B4#9 | 查看回填状态（running/busy/progress/last） | 后台 → 任务 → `GET /api/admin/backfill/status` | ✅ | src/routes/admin-sync.js:207 |
| 8 | B4#9 | 启动热度回填（limit/batch/sleep 参数钳制） | 后台 → 任务 → 热度 → `POST /api/admin/heat` | ✅ | src/routes/admin-sync.js:222 |
| 9 | B4#9 | 停止热度回填 | 后台 → 任务 → 停止 → `POST /api/admin/heat/stop` | ✅ | src/routes/admin-sync.js:244 |
| 10 | B4#9 | 查看热度回填状态 | 后台 → 任务 → `GET /api/admin/heat/status` | ✅ | src/routes/admin-sync.js:261 |
| 11 | B4#9 | 启动重写名字（机器英文名 → 中文，默认间隔 1500ms） | 后台 → 任务 → 重写名字 → `POST /api/admin/rename` | ✅ | src/routes/admin-sync.js:274 |
| 12 | B4#9 | 停止重写名字 | 后台 → 任务 → 停止 → `POST /api/admin/rename/stop` | ✅ | src/routes/admin-sync.js:296 |
| 13 | B4#9 | 查看重写名字状态 | 后台 → 任务 → `GET /api/admin/rename/status` | ✅ | src/routes/admin-sync.js:313 |

## 逐条核对（B4-QUEUE #9 + ARCHITECTURE §15 验收）

| # | 条目（B4-QUEUE #9 + ARCHITECTURE §15.5 checklist） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 域盘点：sync/heat/backfill/rename/circuit 全量盘点、无同 path+method 抢占 | grep `path === '/api/admin` | 拆分前 server.js 共 13 条本域路由分支（sync 3 / backfill 3 / heat 3 / rename 3 / circuit 1），逐一确认无其它路由同 path+method；isLoggablePath 中 sync/status\|runs 豁免是访问日志中间件非路由 | ✅ |
| 2 | 边界：#12 steam-logs、#16 wishlists、#11 bulk 派发表、DT-2 排除区、steam-accounts 模块、封禁拦截链/黑名单加载等中间件不动 | git diff + grep | server.js diff 无 /api/admin/steam-logs、/api/admin/wishlists、/api/admin/bulk、auth-routes.js、steam-accounts.js、steam-login.js 触碰；中间件（isLoggablePath 豁免）留 server.js:3920 附近 | ✅ |
| 3 | routes/admin-sync.js 只做 HTTP 输入输出编排、不写 SQL 字面量 | 静态锁 | sync-runs.test.js 组 1 锁 `!/select \|insert \|update \|delete from /` 绿；SQL 全走 db.listSyncRuns/db.sourceSyncStats | ✅ |
| 4 | ctx 解构按 §15.2：基座 + 域特有按引用（语义共享注释） | 读路由模块 | src/routes/admin-sync.js:55-73 基座 10 字段；startSteamJob/syncState/syncStatusCache/invalidateSyncStatusCache 按引用传并有「语义共享，勿改成拷贝」注释；syncStatusTtlMs 常量拷贝 | ✅ |
| 5 | 入口形态按 §15.3：管理段单入口（参照 admin-access） | 读路由模块 | src/routes/admin-sync.js:74 `export async function handleAdminSyncAdmin(ctx)` 单入口；每分支 `if (!requireAdmin()) return true`；写响应分支全部 `json(...); return true`；尾部 `return false` | ✅ |
| 6 | repository：域专属 SQL 函数签名照抄；域内联 SQL 抽新函数 | 读 repository + 静态锁 | src/store/admin-sync-repository.js listSyncRuns 签名与拆分前一致（sync-runs.test.js 组 4 锁）；本域路由无内联 SQL 字面量（无需抽新函数） | ✅ |
| 7 | 跨域共用 SQL 留 pg.js（判定：有没有别的域/模块也用） | grep 使用面 | insertSyncRun/finishSyncRun（cli.js）、runningSyncRun（scheduler.js）、markStaleSyncRuns（server.js 启动清理）、sourceSyncStats（cli.js）、observedSyncRunSeconds/lastFailedSyncRun/lastSyncRunStartedByMode（scheduler.js）全部留 pg.js（组 4 边界判据锁） | ✅ |
| 8 | pg.js 顶部 re-export，旧 db.* 导入签名不变，migrate() 继续消费 DDL | 静态锁 | pg.js:145 `export { listSyncRuns } from './admin-sync-repository.js'`；sync_runs 表 DDL 留 pg.js SCHEMA（migrate() 未动）；app-token.test.js re-export 锁在 test:4 验证 | ✅ |
| 9 | server.js 原位置换入入口调用、组装 ctx、旧分支不残留 | 静态锁 + 反向自检 | 接线在 games/description 之后、smtp 之前（sync POST 原位置）；组 2/组 3 锁绿；反向自检：破坏 heat/stop 分支 → 组 1 红，恢复后绿 | ✅ |
| 10 | 测试三锁（分支在新文件/宿主真实接线/旧分支不残留）+ 反向自检 | 实测 | sync-runs.test.js 组 1-4；反向自检实测红（删分支） | ✅ |
| 11 | 测试链全绿 | 命令输出 | 见「重跑验证」节 | ✅ |
| 12 | 契约零变化（路径/参数/响应/错误码） | 行为测试 | 13 条路由行为由既有 sync-runs.test.js（5 个行为测试：401/409/200/空状态）、admin-cache.test.js（B2 短缓存+熔断失效）、source-sync.test.js（四源静态契约）、admin-perf.test.js（listSyncRuns/sourceSyncStats 基准）覆盖，全绿 | ✅ |
| 13 | 四方一致（后端/前端/测试/文档） | grep | 前端 AdminModules.vue 未动（消费路径不变）；静态断言 source-sync.test.js 指向新文件；文档 ARCHITECTURE §15.6/B4-QUEUE 由监工回写（工人不改共用文档） | ✅ |
| 14 | 同步/停止逻辑语义共享（跨请求同一槽位） | 代码走查 | syncState 持有对象按引用传入，startSteamJob 闭包与路由读写同一份（server.js:522-531 定义、admin-sync.js 解构）；stop 分支写 syncState.stopRequested、startSteamJob finish 读同一字段记 cancelled | ✅ |

## 重跑验证（QA 亲自重跑，触及 server.js/pg.js 共享底层 → 兜底跑失败段）

- `node test/sync-runs.test.js` → 9/9 pass（含新增四组静态锁）
- `node test/admin-cache.test.js` → 3/3 pass（B2 sync/status 短缓存 + circuit/reset 失效）
- `node test/source-sync.test.js` → 5/5 pass（四源静态契约已指向新文件）
- `node test/admin-perf.test.js` → 基准跑完（listSyncRuns 2.0ms / sourceSyncStats 64.7ms，无断言失败）
- `node test/reviews.test.js` → 31/31 pass（第八轮静态锁回归，防串扰）
- `npm run test:1` → exit 1 仅 commit-own 4 项红（spawn EPERM，本机沙箱环境已知基线，与本批无关）；其余全部绿
- `npm run test:2` → exit 0 全绿
- `npm run test:3` → exit 0 全绿
- `npm run test:4` → exit 0 全绿（含 app-token.test.js re-export 锁）
- `node test/api.test.js` → 38/38 pass
- `npm run frontend:build` → 默认命令被本机沙箱拦（vite configLoader 解析失败）→ 等效变体 `npm run frontend:build -- --configLoader native` → ✓ built in 28.09s
- `npm run scan` → 未发现高置信度凭据

## 打回清单

（空——无打回项）

## 需人工确认

- frontend:build 默认命令被本机沙箱拦截（与前几轮同一环境限制），等效变体 `--configLoader native` 已通过；CI 每次推送全量兜底。

## 查多（需求外改动风险提醒）

- 工作区存在其它会话遗留的未跟踪文件（docs/QA-*.md、*.log、off/、undefined/ 等）——**不属于本批**，工人提交仅限本域 6 个文件（pathspec），不带走、不触碰。
- server.js/pg.js 的 diff 经逐行核对全为本域改动（无他人 hunk 混入）。

## 复检记录

- 第 1 轮（2026-11-20）：✅ 放行（14/0/0/1）。开发期间自查修复两处：① pg.js 误删 insertSyncRun/finishSyncRun（跨模块共用函数）导致行为测试红，已恢复并补边界判据锁；② 静态锁 insertSyncRun 签名正则与实际签名不符，已修正。反向自检实测：破坏 heat/stop 分支 → 组 1 断言红 → 恢复后全绿。
