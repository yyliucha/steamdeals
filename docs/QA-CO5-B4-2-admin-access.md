# QA：admin-access 域拆分（CO-5/B4-2 第八轮，B4 #8）（第 1 轮）

> 基线 0d9e824 → HEAD 工作区（未提交）；判据 docs/B4-QUEUE.md #8 行 + docs/ARCHITECTURE.md §15（15.1–15.6）+ 先例域（appeal 管理段 / announcements 管理段 / site 三段）。
> 结论：✅ 放行 —— 通过 20 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条功能一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | B4#8 | 查看页面浏览统计（含游戏名与当前最低价解析） | 后台 → 数据统计 → `/api/admin/views` | ✅ | src/routes/admin-access.js:71 |
| 2 | B4#8 | 查询访问记录（分页/IP/路径/状态过滤 + 今日汇总） | 后台 → 访问明细 → `/api/admin/visitors` | ✅ | src/routes/admin-access.js:97 |
| 3 | B4#8 | 按 IP 统计视图（时间窗/关键词/排序/状态筛选） | 后台 → 访问明细 → `/api/admin/visitors/by-ip` | ✅ | src/routes/admin-access.js:128 |
| 4 | B4#8 | 展开单个 IP 的最近访问与热门路径 | 后台 → 访问明细 → 行展开 `/api/admin/visitors/by-ip/:ip` | ✅ | src/routes/admin-access.js:154 |
| 5 | B4#8 | 查看 IP 黑名单 | 后台 → 安全 → `/api/admin/blacklist` | ✅ | src/routes/admin-access.js:170 |
| 6 | B4#8 | 加入黑名单（互斥移白 + 待审自动标记） | 后台 → 安全 → 封禁 IP → `POST /api/admin/blacklist` | ✅ | src/routes/admin-access.js:175 |
| 7 | B4#8 | 移出黑名单 | 后台 → 安全 → 解封 → `DELETE /api/admin/blacklist/:ip` | ✅ | src/routes/admin-access.js:197 |
| 8 | B4#8 | 查看 IP 白名单（含限流配置） | 后台 → 安全 → `/api/admin/whitelist` | ✅ | src/routes/admin-access.js:211 |
| 9 | B4#8 | 加入白名单（互斥移黑 + 清临时封禁） | 后台 → 安全 → 加白 → `POST /api/admin/whitelist` | ✅ | src/routes/admin-access.js:216 |
| 10 | B4#8 | 移出白名单 | 后台 → 安全 → `DELETE /api/admin/whitelist/:ip` | ✅ | src/routes/admin-access.js:239 |
| 11 | B4#8 | 查看超频/临时封禁记录（含黑名单标注） | 后台 → 安全 → `/api/admin/abuse` | ✅ | src/routes/admin-access.js:255 |
| 12 | B4#8 | 手动解除临时封禁（不动黑名单） | 后台 → 安全 → 解封 → `DELETE /api/admin/abuse/:ip` | ✅ | src/routes/admin-access.js:274 |
| 13 | B4#8 | 查看设备指纹聚合列表 | 后台 → 设备 → `/api/admin/devices` | ✅ | src/routes/admin-access.js:288 |
| 14 | B4#8 | 查看设备封禁列表 | 后台 → 设备 → `/api/admin/device-bans` | ✅ | src/routes/admin-access.js:293 |
| 15 | B4#8 | 封禁设备（指纹格式校验 + 内存态刷新） | 后台 → 设备 → 封禁 → `POST /api/admin/devices/ban` | ✅ | src/routes/admin-access.js:297 |
| 16 | B4#8 | 解封设备 | 后台 → 设备 → 解封 → `DELETE /api/admin/device-bans/:fp` | ✅ | src/routes/admin-access.js:321 |
| 17 | B4#8 | 查看异常请求待审列表（地区/申诉状态/最近 UA 证据抽屉） | 后台 → 异常审核 → `/api/admin/reviews` | ✅ | src/routes/admin-access.js:335 |
| 18 | B4#8 | 审批通过（封 IP / 封设备 / 双封） | 后台 → 异常审核 → 封禁 → `POST /api/admin/reviews/approve` | ✅ | src/routes/admin-access.js:356 |
| 19 | B4#8 | 审批忽略 | 后台 → 异常审核 → 忽略 → `POST /api/admin/reviews/reject` | ✅ | src/routes/admin-access.js:391 |
| 20 | B4#8 | 单条四操作（临时封/永久封/信任/忽略） | 后台 → 异常审核 → 单条操作 → `POST /api/admin/reviews/act` | ✅ | src/routes/admin-access.js:405 |

## 逐条核对（规格验收 → 证据）

| # | 条目（B4-QUEUE #8 + ARCHITECTURE §15 验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 域盘点：visitors/views/devices/blacklist/whitelist/abuse/reviews 全量盘点 | grep path === 各前缀 | server.js 拆分前 20 条路由分支（+device-bans 3 条随 devices 功能块拆走） | ✅ |
| 2 | 全部 admin 路由（requireAdmin 之后）→ 管理段形态 handleAdminAccessAdmin | 读路由模块 | src/routes/admin-access.js:58 单入口、每分支 `if (!requireAdmin()) return true` | ✅ |
| 3 | 不碰封禁拦截链/黑名单加载等中间件（§15.4） | grep | banIpExclusive 闭包定义留 server.js:1413；visitors.js/devices.js/ratelimit.js 模块未动；ctx.banIpExclusive 传引用注释「语义共享」 | ✅ |
| 4 | 不碰 #7 已拆路由与 DT-2 排除区 | git diff | diff 无 /api/ban/state、/api/steam/*、/api/me/email/*、/api/auth/email* 触碰 | ✅ |
| 5 | 其它域路由留宿主（#9–#17） | grep server.js | /api/admin/users|images|reports|align|mail|sessions|games 等分支仍在 server.js | ✅ |
| 6 | 跨域共用 SQL 留 pg.js（§15.5 第 4 步判定） | grep 使用面 | listBlockedIps/removeBlockedIp/addWhitelistIp/upsertDeviceBan/removeDeviceBan/finishAbuseReview 等被 visitors.js/routes/appeal.js/#11 bulk 段共用 → 留 pg.js | ✅ |
| 7 | 域专属 SQL 搬 repository，签名照抄 | 静态锁 + 目检 | src/store/admin-access-repository.js 15 个搬家函数签名与 pg.js 拆分前一致（reviews.test.js 组 4 锁 15 条签名） | ✅ |
| 8 | 域内联 SQL 抽新函数（路由不写 SQL 字面量） | 静态锁 | adminViewsGameMap/ipAbuseBanRow/applyManualTempBan/trustIpDb 4 新函数；`!/select \|insert \|update \|delete from /` 锁绿 | ✅ |
| 9 | pg.js 顶部 re-export，旧 db.* 签名不变 | 静态锁 | pg.js:81-103 re-export 19 函数；app-token.test.js 锁绿；无残留旧定义（组 4 锁） | ✅ |
| 10 | server.js 原位置换入调用、旧分支不残留 | 静态锁 + 反向自检 | 接线在 banIpExclusive 定义后、users POST 前（views 原位置）；组 3 锁 + 实测注入旧分支→红 | ✅ |
| 11 | 测试三锁 + 反向自检 | 实测 | reviews.test.js 组 1-4；反向自检三方向实测均红（删分支/删接线/抄回分支） | ✅ |
| 12 | 测试链全绿 | 命令输出 | 见「重跑验证」节 | ✅ |
| 13 | 契约零变化（路径/参数/响应/错误码） | 行为测试 | 20 条路由行为由既有 reviews/devices/visitors/bj-abuse-views/admin-bulk/api 测试覆盖，全绿 | ✅ |
| 14 | 四方一致（后端/前端/测试/文档） | grep | 前端 AdminModules.vue 消费 20 条路由路径与后端一致（未动前端）；文档 ARCHITECTURE §15.6/B4-QUEUE 由监工回写（工人不改共用文档） | ✅ |

## 重跑验证（QA 亲自重跑，触及 server.js/pg.js 共享底层 → 兜底跑失败段）

- `node test/reviews.test.js` → 31/31 pass（含新增四组静态锁）
- `node test/admin-review-lists.test.js` → 7/7 pass（指向已修正）
- `node test/devices.test.js` → 5/5、`node test/visitors.test.js` → 11/11、`node test/visitor-ip-stats.test.js` → 8/8、`node test/bj-abuse-views.test.js` → 3/3、`node test/admin-bulk.test.js` → 17/17
- `npm run test:1` → exit 0（含 commit-own 全部通过，本次未见历史基线红项）
- `npm run test:2` → exit 0；`npm run test:3` → exit 0
- `npm run test:4` → 第 1 次 password/check 429 一项红（偶发 flake，单跑与复跑均绿）；复跑 exit 0 全绿
- `node test/api.test.js` → 37/37 pass
- `npm run frontend:build` → 默认命令被本机沙箱拦（vite configLoader 解析失败）→ 等效变体 `npm run frontend:build -- --configLoader native` → ✓ built in 4.64s
- `npm run scan` → 未发现高置信度凭据

## 打回清单

（空——无打回项）

## 需人工确认

- frontend:build 默认命令被本机沙箱拦截（与 #4/#5/#6/#7 轮同一环境限制），等效变体 `--configLoader native` 已通过；CI 每次推送全量兜底。

## 查多（需求外改动风险提醒）

- 工作区存在 EG/EF 其它会话的未提交改动（src/cli.js、src/scheduler.js、src/adapters/steam-meta.js、frontend/src/pages/Home.vue、docs/ACTIVE-SESSIONS.md、test/steam-meta.test.js）——**不属于本批**，工人提交仅限本域 6 个文件（pathspec），不带走、不触碰。server.js/pg.js 的 diff 经逐行核对全为本域改动（无他人 hunk 混入）。

## 复检记录

- 第 1 轮（2026-11-20）：✅ 放行（20/0/0/1）。开发期间自查修复两处：① server.js 漏 import 语句导致接线 500（行为测试抓获，已补）；② 静态锁第 3 组 approve/reject 防双实现盲区（反向自检实测暴露，已补锁并复验三方向）。
