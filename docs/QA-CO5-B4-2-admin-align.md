# QA：admin align 域拆分（CO-5/B4-2 第十四轮，第 1 轮）

> 基线 ffe651e → 工作区（未提交，含本域拆分）；判据 docs/ARCHITECTURE.md §15「域路由拆分模式」checklist（§15.1–§15.5）与 docs/B4-QUEUE.md #17 行；开发描述来源：B4 #17 工人会话（worker-align，独立 worktree F:\dsh\gp-wt-17）。
> 结论：✅ 放行 —— 通过 12 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条功能一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | B4#17 | 后台查看对齐审核队列（分页/统计卡 counts/生成态字段/最近处理） | 后台 → 游戏管理 → 对齐审核 → `GET /api/admin/align` | ✅ | src/routes/admin-align.js:137–175；test/api.test.js CD/DL 用例 |
| 2 | B4#17 | 首次生成提示（无快照 202 firstRun，后台生成不阻塞） | 同上（冷启动首访） | ✅ | src/routes/admin-align.js:144–149 |
| 3 | B4#17 | 手动刷新队列（?refresh=1 后台立即重算，不阻塞本次响应） | 队列页「刷新」按钮 | ✅ | src/routes/admin-align.js:150–153 |
| 4 | B4#17 | 合并预览（单组 ?key= / 批量 ?keys=，孤儿行 + 不可撤销提示） | 确认弹窗 → `GET /api/admin/align/preview` | ✅ | src/routes/admin-align.js:178–233 |
| 5 | B4#17 | 确认对齐（单条 key+appid / 批量 keys，写映射 + 同事务更新快照） | `POST /api/admin/align/confirm` | ✅ | src/routes/admin-align.js:235–311；test/api.test.js CD/DL 用例 |
| 6 | B4#17 | 忽略对齐（单条/批量，写 ignored + 同事务更新快照） | `POST /api/admin/align/ignore` | ✅ | src/routes/admin-align.js:313–361 |
| 7 | B4#17 | 已忽略视图（q 过滤 + 内容词归档标注） | `GET /api/admin/align/ignored` | ✅ | src/routes/admin-align.js:363–368；test/api.test.js DH/DN 用例 |
| 8 | B4#17 | 恢复为待处理（快照标脏 + 后台重算重新入队） | `POST /api/admin/align/restore` | ✅ | src/routes/admin-align.js:370–393 |
| 9 | B4#17 | 审阅记录（按组查操作人/时间/动作） | `GET /api/admin/align/history` | ✅ | src/routes/admin-align.js:395–403 |
| 10 | B4#17 | 手动搜索候选（name/name_en 模糊 + steam_appid 精确，最多 20 条） | 确认弹窗搜索框 → `GET /api/admin/align/search` | ✅ | src/routes/admin-align.js:405–411 |
| 11 | B4#17 | 以上接口的管理员权限门禁（匿名 401 / 普通用户 403） | 8 组路由 | ✅ | src/routes/admin-align.js 每分支 requireAdmin；test/api.test.js 全套走 admin cookie |
| 12 | B4#17 | 队列读接口并发闸（≤1，排队超限/超时 503） | GET /api/admin/align | ✅ | src/routes/admin-align.js:140 + src/server.js HEAVY_GATE_CONFIG 键（留宿主） |

## 逐条核对（规格验收 → 证据）

| # | 条目（ARCHITECTURE §15 checklist） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | §15.5-2 盘点域内路由、无其它路由抢占同一 path+method | grep `/api/admin/align` 全 server.js + 拆前对照 | 域内 8 组路由（GET align / GET preview / POST confirm / POST ignore / GET ignored / POST restore / GET history / GET search）；无同 path+method 双匹配；/api/admin/bulk 派发表无 align 条目 | ✅ |
| 2 | §15.1 建 src/routes/<domain>.js：只做 HTTP 编排，不写 SQL 字面量 | 读文件 + 静态锁 | src/routes/admin-align.js 415 行；test/align.test.js 静态锁「不写 SQL 字面量」（正则 select/insert/update/delete from 无命中） | ✅ |
| 3 | §15.1 建 src/store/<domain>-repository.js：签名照抄、跨域共用留 pg.js | 读文件 + 对比拆前 server.js/pg.js | repository 78 行：ALIGN_SNAPSHOTS_DDL（pg.js 搬来，migrate 继续消费）+ 域内联 SQL 5 新函数（gameAliasGameId/gameSteamAppidById/listOrphanGameRows/gameBySteamAppid/searchAlignGames，SQL 逐字照抄）；game_source_map/game_aliases 等跨域表 DDL 与 mergeGames 留 pg.js；align.js/align-compute.js/align-snapshot.js 共享业务模块不动（CLI align-snapshot 也走） | ✅ |
| 4 | §15.1 pg.js re-export 永不允许删除 | 读 pg.js 顶部 | 新增 `export { ALIGN_SNAPSHOTS_DDL, gameAliasGameId, …searchAlignGames } from './admin-align-repository.js'`；既有 re-export（app/appeal/auth/watchlist/announcements/me/site/admin-access/admin-sync/admin-settings/admin-sessions）全保留；test/app-token.test.js 10/10 | ✅ |
| 5 | §15.2 ctx 组装：基座 + 域特有按引用 | 读接线与 routes | server.js 接线传 path/req/res/url/q/logger/json/readBody/user/requireAdmin + store/runGated/triggerAlignGeneration；三者为按引用语义共享（注释锁定）：triggerAlignGeneration 宿主闭包（single-flight 链式排队）、runGated 宿主闭包（并发闸 Map）、store（事务，测试注入） | ✅ |
| 6 | §15.3 入口形态正确（8 组全在 requireAdmin 之后） | 读拆前分支 | 全部在管理段 → 单入口 handleAdminAlignAdmin；接线取本域最早路由 GET align 原位置（公告管理段接线之后、bulk 之前） | ✅ |
| 7 | §15.4 中间件与未拆段留 server.js | 读 diff | triggerAlignGeneration/computeAlignGroups/ensureAlignSnapshot/alignSnapshotMaxAgeMs 留宿主（CLI align-snapshot 共享 + 闭包按引用传入）；HEAVY_GATE_CONFIG 的 'GET /api/admin/align' 键留宿主；BULK_ACTIONS 无 align 条目；admin users 区（DT-3）零改动 | ✅ |
| 8 | §15.5-6 修静态断言测试 + 三条锁 + 反向自检 | 读测试 + 真跑反向自检 | test/align.test.js CD 接线静态契约改指 src/routes/admin-align.js（原指 server.js 的 20+ 断言）+ 追加四组静态锁（分支落点/宿主接线/防双实现/repository re-export + 边界锁）；**反向自检实录**：① 真删 routes/admin-align.js 的 history 分支 → 2 红（CD 接线「审阅记录接口」+ 静态锁第 1 组「审阅记录分支在新文件」）；② 接线包 if(false) → 1 红（防死模块锁）；③ 把 history 分支抄回 server.js → 1 红（防双实现锁）；恢复后 15/15 绿 | ✅ |
| 9 | §15.5-7 验证全绿 | 亲自重跑 | 见「验证命令与输出」 | ✅ |
| 10 | 契约零变化 | 逐分支对照拆前 server.js（git show HEAD） | 8 组路由逻辑照抄（return json → json+return true 形态转换；runGated/事务/快照/日志事件全保持）；响应字段/错误码/查询参数语义不变 | ✅ |
| 11 | 纪律：无新增 tag / 无构建产物 / 不碰部署配置 / 不改共用文档 / 不碰 admin users 区 | git tag --list、git status、diff 全量过目 | 无新增 tag；frontend/dist 未暂存（.gitignore）；diff 仅 server.js/pg.js/align.test.js/两新文件；DT-3 4a40737 的 users 区行零改动 | ✅ |
| 12 | 反向自检与测试「真锁住」 | 亲跑三个反向自检 + 行为测试 | 见条目 8；api.test.js 38/38（CD/DH/DN/DL 对齐审核行为用例全过） | ✅ |

## 验证命令与输出（本批相关，2026-11-20 18:55–20:10 实跑）

| 命令 | 结果 |
|---|---|
| `node test/align.test.js` | 15/15 通过（原 11 项 + 本批四组静态锁 4 项；含三个反向自检后复跑） |
| `node test/align-perf.test.js` | 14/14 通过 |
| `node test/align-snapshot.test.js` | 10/10 通过 |
| `node test/http-guard.test.js` | 7/7 通过（HEAVY_GATE_CONFIG 'GET /api/admin/align' ≤1 键在） |
| `node test/app-token.test.js` | 10/10 通过（pg.js re-export 兼容锁在） |
| `npm run test:1` | commit-own 4 项已知沙箱基线红（stash 基线对照复现同样 4 红，非本批引入）；其余 28 个文件全绿 |
| `npm run test:2` | 全绿（exit 0） |
| `npm run test:3` | 全绿（exit 0，37 个文件含 align/align-snapshot/http-guard） |
| `npm run test:4` | 仅 profile.test.js 1 红——**基线同红**（stash 对照复现；DT-3 4a40737 在 admin users 区新增 `/api/admin/users/:name/steam-accounts` 内联 SQL，与 me 域静态锁「steamBound 内联 SQL 不得残留在 server.js」冲突，属 2.28.0 批既有缺陷，逐字保留并上报监工）；其余 30 个文件全绿 |
| `node test/api.test.js` | 38/38 通过（首轮 4 红为本域拆分引入的 return true 形态缺陷 + store 未透传，已修复复跑全绿） |
| `npm run frontend:build` | 默认命令被本机沙箱拦（vite configLoader 与 #4–#14 轮同款环境限制）→ 等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` ✓ built in 2.54s（本批前端零改动） |
| `npm run scan` | ✅ 干净（596 文件，无高置信度凭据） |

## 拆分前后行数对比

| 文件 | 变化 |
|---|---|
| src/server.js | −364 / +39（净 −325） |
| src/store/pg.js | −18 / +22（净 +4：DDL 21 行搬走、import+re-export 块 20 行） |
| src/routes/admin-align.js | 新 415 行 |
| src/store/admin-align-repository.js | 新 78 行 |
| test/align.test.js | +141 / −25（静态契约改指向 + 四组静态锁） |

## 打回清单

（无）

## 需人工确认

- 条目 1：本机沙箱环境限制两处——`npm run test:1` 的 commit-own 4 项红与 `npm run frontend:build` 默认命令被拦。均已做 stash 基线对照（commit-own 基线同红）与等效变体（native configLoader）验证，CI（test-main + docker 构建）可兜底确认。
- 条目 2：本批发现 2.28.0 批既有缺陷（拆分前即存在、逐字保留未修）——DT-3 4a40737 在 admin users 区新增的 `/api/admin/users/:name/steam-accounts` 内联 SQL（src/server.js:2650）与 me 域静态锁（test/profile.test.js:508）冲突导致 profile.test.js 1 红；本批红线不碰 users 区、不碰其它域测试文件，上报监工转 2.28.0 批处理（建议 DT-3 走 repository 函数或收窄 me 域锁）。

## 争议项（待所有者裁定）

（无）

## 复检记录

- 第 1 轮（2026-11-20）：✅ 放行（通过 12 / 缺失 0 / 偏差 0 / 需人工确认 2）。
