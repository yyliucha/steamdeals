# QA：admin 会话域拆分（CO-5/B4-2 第十一轮，第 1 轮）

> 基线 5ce2e50 → 工作区（未提交，含本域拆分）；判据 docs/ARCHITECTURE.md §15「域路由拆分模式」checklist（§15.1–§15.5）与 docs/B4-QUEUE.md #14 行；开发描述来源：B4 #14 工人会话（worker-admin，复用 #10 会话）。
> 结论：✅ 放行 —— 通过 12 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条功能一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | B4#14 | 后台查看在线会话列表（按用户名/IP 过滤、含过期开关、分页、总数） | 后台 → 会话管理 → `GET /api/admin/sessions` | ✅ | src/routes/admin-sessions.js:44–79；test/sessions.test.js 15/15 |
| 2 | B4#14 | 会话列表绝不泄漏 token、昵称列按「昵称→用户名」回退、标注当前会话 | 同上 | ✅ | src/routes/admin-sessions.js:58–78 |
| 3 | B4#14 | 后台按会话 id 踢下线（踢掉后该会话立刻 401） | 后台 → 会话管理 → 踢下线 → `DELETE /api/admin/sessions/:id` | ✅ | src/routes/admin-sessions.js:82–96；test/sessions.test.js「踢单条后目标 401」用例 |
| 4 | B4#14 | 以上接口的管理员权限门禁（匿名 401 / 普通用户 403） | 2 条路由 | ✅ | test/sessions.test.js:217–218 |

## 逐条核对（规格验收 → 证据）

| # | 条目（ARCHITECTURE §15 checklist） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | §15.5-2 盘点域内路由、无其它路由抢占同一 path+method | grep `/api/admin/sessions` 与 `sessions` 全 server.js | 域内仅 2 条（GET /api/admin/sessions、DELETE /api/admin/sessions/:id）；无同 path+method 双匹配 | ✅ |
| 2 | §15.1 建 src/routes/<domain>.js：只做 HTTP 编排，不写 SQL 字面量 | 读文件 + 静态锁 | src/routes/admin-sessions.js 89 行；test/sessions.test.js 静态锁「不写 SQL 字面量」 | ✅ |
| 3 | §15.1 建 src/store/<domain>-repository.js：签名照抄、跨域共用留 pg.js | 读文件 + 对比拆前 pg.js | repository 50 行：listSessions 签名与拆前一致；deleteSessionById（#11 bulkSessionKick 共用）/deleteSessionsOfUser（auth-routes/routes/auth.js/kickAll/revoke-others/禁用共用）/deleteSessionsOfUsers/touchSession/deleteSessionByToken 留 pg.js | ✅ |
| 4 | §15.1 pg.js re-export 永不允许删除 | 读 pg.js 顶部 | 新增 `export { listSessions } from './admin-sessions-repository.js'`；既有 re-export 全保留 | ✅ |
| 5 | §15.2 ctx 组装：基座 + 域特有按引用 | 读接线与 routes | server.js 接线传 path/req/res/url/q/logger/json/user/requireAdmin/token；token 只读（current 标记/踢下线审计） | ✅ |
| 6 | §15.3 入口形态正确（2 条全在 requireAdmin 之后） | 读拆前分支 | 2 条均在管理段 → 单入口 handleAdminSessionsAdmin；接线取本域最早路由 GET sessions 原位置（auth 主段接线之前、revoke-others 之前） | ✅ |
| 7 | §15.4 中间件与未拆段留 server.js | 读 diff | kickAll（/api/admin/users/:name/sessions，users 区 #11）、revoke-others（前台主段）、bulk 派发表 sessions/kick 条目全部留宿主 | ✅ |
| 8 | §15.5-6 修静态断言测试 + 三条锁 + 反向自检 | 读测试 + 真跑反向自检 | test/sessions.test.js 追加四组静态锁（分支落点/宿主接线/防双实现/repository re-export + 边界锁）；**反向自检实录**：真删 routes/admin-sessions.js 的 DELETE sessions/:id 分支 → 第 1 组静态锁红（`sessions/:id 踢下线分支在新文件`）+ 行为锁红（踢下线用例失败），恢复后 15/15 绿 | ✅ |
| 9 | §15.5-7 验证全绿 | 亲自重跑 | 见「验证命令与输出」 | ✅ |
| 10 | 契约零变化 | 逐分支对照拆前 server.js | 2 条路由逻辑照抄（return json → json+return true 形态转换）；响应字段/错误码/查询参数语义不变 | ✅ |
| 11 | 纪律：无新增 tag / 无构建产物 / 不碰部署配置 / 不改共用文档 | git tag --list、git status、diff 全量过目 | 无新增 tag（最新 v2.27.7 为既有）；frontend/dist 未暂存；diff 仅 server.js/pg.js/sessions.test.js/两新文件 | ✅ |

## 验证命令与输出（本批相关，2026-11-20 16:30–17:25 实跑）

| 命令 | 结果 |
|---|---|
| `node test/sessions.test.js` | 15/15 通过（原 11 项 + 本批四组静态锁 4 项；含反向自检后复跑） |
| `node test/isolation.test.js` | 7/7 通过（含 DELETE /api/admin/sessions/:id 跨实例用例） |
| `npm run test:1` | commit-own 4 项已知沙箱基线红（与拆分前一致）；其余文件全绿；中断后的 serve 12/12、appeal-system 24/24 补跑绿 |
| `npm run test:2` | 全绿（exit 0） |
| `npm run test:3` | http-guard 第 4 项「GATE_WAIT_TIMEOUT」偶发时序失败（本机多任务并发高负载，40ms 排队窗口未触发拒绝）→ 单独复跑 7/7 绿；链中断后 21 个文件补跑全绿（exit 0） |
| `npm run test:4` | 全绿（exit 0，含 sessions.test.js） |
| `node test/api.test.js` | 38/38 通过 |
| `npm run frontend:build` | 默认命令被本机沙箱拦（vite configLoader spawn EPERM，与 #4–#10 轮同款环境限制）→ 等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` ✓ built in 3.88s（本批前端零改动） |
| `npm run scan` | ✅ 干净（761 文件，无高置信度凭据） |

## 拆分前后行数对比

| 文件 | 变化 |
|---|---|
| src/server.js | −42 / +29（净 −13） |
| src/store/pg.js | −31 / +12（净 −19） |
| src/routes/admin-sessions.js | 新 89 行 |
| src/store/admin-sessions-repository.js | 新 50 行 |
| test/sessions.test.js | +83（四组静态锁 + 边界锁） |

## 打回清单

（无）

## 需人工确认

- 条目 1：`npm run frontend:build` 默认命令在本机沙箱被拦（vite 配置加载阶段 `spawn EPERM`，与前几轮同款环境限制）；等效变体 `--configLoader native` 构建成功（3.88s）证明前端链完好，本批前端零改动；CI 每次推送以默认命令全量兜底。
- 条目 2：`test/commit-own.test.js` 4 项在本机沙箱必红（spawn EPERM 等），与拆分前基线一致、与本批改动无关；test:3 的 http-guard GATE_WAIT_TIMEOUT 一项为本机并发负载下的偶发时序（单独复跑 7/7 绿），CI 兜底。

## 争议项

（无）

## 复检记录

- 第 1 轮（2026-11-20）：首次检查，12 项核对全部通过、0 打回；反向自检（真删路由分支 → 静态锁与行为锁均红）已做并恢复；✅ 放行。
