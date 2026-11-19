# QA：CO-5/B4-2 第六轮 me 域拆分（第 1 轮）

> 基线 fb31adc（#5 announcements 完成后 HEAD）→ 本轮交付 = 工作区未提交 diff（待监工回写 B4-QUEUE 后提交）；
> 判据：docs/ARCHITECTURE.md §15「域路由拆分模式」+ 夜班工人任务书（B4 #6 me）；
> 开发描述来源：夜班监工派工 prompt（自包含，本报告为工人自检）。
> 结论：✅ 放行 —— 通过 17 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（接口路径） | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | B4#6 | 当前用户资料：匿名 200 user:null；登录回完整本人资料（昵称/简介/头像元信息/邮箱验证态/注册时间）+ prefs + steamBound + timezone | GET /api/me | ✅ 已交付 | routes/me.js:44-82；test/profile.test.js:114-129 |
| 2 | B4#6 | 保存本人偏好：theme/tab/sort/emailAlerts 等（缺省沿用现值；匿名 401） | POST /api/prefs | ✅ 已交付 | routes/me.js:84-93；test/api.test.js:123-160 |
| 3 | B4#6 | 头像公开只读：custom 输出库内字节（ETag/304 长缓存）；无头像 404 | GET /api/avatar/:userId | ✅ 已交付 | routes/me.js:98-130；test/profile.test.js:191-234 |
| 4 | B4#6 | 编辑个人资料：昵称 2–20 字 / 简介 ≤200 字（管理员可空、普通用户必填）；只认可编辑字段；越权 userId 无效 | PATCH /api/me/profile | ✅ 已交付 | routes/me.js:134-193；test/profile.test.js:136-170 |
| 5 | B4#6 | 上传自定义头像：dataUrl 魔数/大小校验（≤512KB、413/400 语义）后存库 | POST /api/me/avatar | ✅ 已交付 | routes/me.js:196-254；test/profile.test.js:186-231 |
| 6 | B4#6 | 移除自定义头像（回退首字） | DELETE /api/me/avatar | ✅ 已交付 | routes/me.js:256-263；test/profile.test.js:226-232 |
| 7 | B4#6 | 我的游戏库与统计：每 Steam 账号一卡（绑定时间/默认判定）+ 5 项汇总（仅本人，匿名 401） | GET /api/me/library | ✅ 已交付 | routes/me.js:266-297；test/profile.test.js:266-327 |
| 8 | B4#6 | 邮箱验证码发送/校验、更换登录邮箱（**留在 src/auth-routes.js，DT-2 排除区不拆半截**） | POST /api/me/email/request、verify | ✅ 已交付（未拆，按边界判据留） | auth-routes.js:521、:668；test/email-change.test.js（test:4 内 10/10 绿） |

## 逐条核对（拆分规格 → 证据）

| # | 条目（ARCHITECTURE §15 / 任务书） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | routes/me.js 只做 HTTP 编排，不写 SQL 字面量 | grep SQL 关键字 + 静态锁 | routes/me.js 全文无 select/insert/update/delete from；test/profile.test.js「routes 不写 SQL 字面量」断言 | ✅ |
| 2 | 从 ctx 解构固定基座（§15.2） | 读文件 | routes/me.js:37（path/req/res/q/logger/json/readBody/user/requireUser 全部基座字段，无域特有共享状态） | ✅ |
| 3 | 域特有共享状态按引用传 + 注释「语义共享」 | grep | 本域无跨模块共享状态（无计数 Map/单飞对象/闭包），me.js:22 注释已声明 | ✅ |
| 4 | 入口形态按 §15.3 选；返回 true=已处理/false=未命中 | 读文件 + 静态锁 | 单入口 handleMeRoutes（主段）；各分支写响应后 return true、末尾 return false（routes/me.js:82、93、130、193、254、263、297） | ✅ |
| 5 | 位置语义不能挪（原位置换入接线） | grep 调用点行号 | server.js:1565（主段，must_change_password 白名单 1318-1332 之后、原 me 区块位置）；白名单中间件（/api/me、/api/avatar/*）未动 | ✅ |
| 6 | repository 函数签名与拆分前一致 | 静态锁逐函数正则 | test/profile.test.js 签名断言 9 条（getUserPublic/updateUserProfile/avatarOfUser/setUserAvatar/clearUserAvatar/userLibraryStats/normalizePrefs/getPrefs/savePrefs 与拆分前逐字一致） | ✅ |
| 7 | 域内联 SQL 抽成 repository 新函数 | 对照拆分前 server.js | countBoundSteamAccounts（原 /api/me steamBound 内联 select）、boundAtOfSteamAccount（原 /api/me/library bindTimes 内联 select）→ me-repository.js:173-191 | ✅ |
| 8 | pg.js 顶部 re-export；禁止删除任何已有 re-export | git diff | pg.js:81-102 新增 13 项 re-export + import getUserPublic（供内部 setDefaultSteamAccount 调用）；既有 app/appeal/auth/watchlist/announcements re-export 零删改 | ✅ |
| 9 | 跨域通用 SQL 留 pg.js | grep + git diff | setDefaultSteamAccount/clearDefaultSteamIfMatches/userLibraryItems 留 pg.js（steam accounts 域 B4 #7 使用）；user_prefs DDL 留 pg.js（watchCandidates 也 join）；判据见「域边界判定」 | ✅ |
| 10 | 外部契约零变化（路径/参数/响应/错误码） | 真跑运行时测试 | test/profile.test.js 13/13 绿；api.test.js 37/37 绿；email-change/password-change/sessions/setup/admin-bulk 等涉 /api/me 测试全绿 | ✅ |
| 11 | 静态断言测试指向新文件 + 三条锁 | 读测试文件 | test/profile.test.js 新增 5 组：路由分支在新文件 / 宿主真实接线（含 ctx 字段）/ 旧分支不残留 server.js（防双实现）/ repository+re-export 锁（含跨域 SQL 防误搬）/ 域边界锁（me/email 留 auth-routes.js） | ✅ |
| 12 | 反向自检：删分支 → 测试必须红 | 实测（删后恢复） | 临时改 routes/me.js library 分支路径 → 静态锁测试 3 红 + library/profile 运行时测试红（fail 3、exit 1）→ 恢复后 13/13 绿 | ✅ |
| 13 | test:1..4 全绿（commit-own EPERM 除外） | 实测 | test:1 230ok/4notok（仅 commit-own 4 项，spawn EPERM 沙箱限制）、test:2 313ok、test:3 258ok、test:4 240ok（含本域 profile 13/13） | ✅ |
| 14 | api.test.js 全绿 | 实测 | 37/37 绿 | ✅ |
| 15 | frontend:build + scan | 实测 | 默认命令被沙箱拦（configLoader bundling 失败）→ 等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` ✓ built in 1.92s；npm run scan：717 文件，✅ 无凭据 | 🔎（变体，CI 兜底） |
| 16 | 纪律：无新 tag / 不碰部署配置 / 产物不进提交 / 不改共用文档 | git 取证 | git tag 无新增；diff 仅 server.js/pg.js/profile.test.js + 2 新文件（+ACTIVE-SESSIONS 本地登记不入库）；frontend/dist 未入 status；ARCHITECTURE/TODO/B4-QUEUE 等共用文档零改动（回写由监工统一做） | ✅ |
| 17 | 域边界判定写入报告并静态锁固化（任务书要求） | 读报告 + 测试 | 本报告「域边界判定」+ test/profile.test.js 第 5 组边界锁 | ✅ |

## 域边界判定（B4 #6 me 与 me/email 的关系，任务书要求写进报告）

1. **盘点**：`grep /api/me` 全 src——server.js 里 me 区块连续一整块（原 1561–1784）：`GET /api/me`、
   `POST /api/prefs`、`GET /api/avatar/:userId`、`PATCH /api/me/profile`、`POST|DELETE /api/me/avatar`、
   `GET /api/me/library`；另有 must_change_password 白名单 `p === '/api/me'`、`p.startsWith('/api/avatar/')`
   （原 1320/1327，中间件）。`/api/me/email/request|verify` 在 src/auth-routes.js（:521、:668），
   与 `/api/auth/email/request|verify`（:99、:234）同一模块 handleEmailAuth。
2. **判定**：`/api/me/email/*` 与 `/api/auth/email*` 实为同一模块（auth-routes.js）→ 按 ARCHITECTURE
   §15.6 第三轮选域理由「DT-2 排除区、与 /api/auth/email* 同模块不拆半截」**整块留原地**，不进 me 域；
   其余 /api/me/* 全部按 #6 拆。测试锁第 5 组固化该边界（auth-routes.js 必须仍含四个 email 分支、
   routes/me.js 不得出现 /api/me/email 路由分支）。
3. **随域拆出的相邻路由**：`POST /api/prefs` 与 `GET /api/avatar/:userId` 虽不在 /api/me/* 前缀下，
   但与 me 区块同处 server.js「当前用户与偏好 + CX 个人资料」连续区块、共享同一批 SQL
   （getPrefs/savePrefs、avatarOfUser），按 #5 announcements 先例「同一模块整批拆」随 me 域拆走；
   两条路径契约不变，且 `/api/avatar/*` 的 must_change_password 白名单仍是 server.js 中间件。
4. **SQL 归属判据**：setDefaultSteamAccount/clearDefaultSteamIfMatches（server.js 2353/2364，
   steam accounts 域路由）、userLibraryItems（server.js 2280/2296，steam accounts 域弹窗）→ 留 pg.js；
   user_prefs 表 DDL 被 pg.js watchCandidates（alerts 引擎）left join → 跨域共用表，DDL 留 pg.js
   （watchlist/announcements 先例：无 DDL 搬家）。测试锁第 4 组把「跨域函数留在 pg.js」一并固化，
   防后续 B4 #7 轮误搬。

## 打回清单

无。

## 需人工确认

- 条目 15：frontend:build 默认命令在本机沙箱被拦（vite 加载配置的 bundling 阶段失败），
  改用等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` 构建成功；
  默认命令在 CI（docker 构建前端）验证——与 #4/#5 域 QA 同口径。
- 条目 13：test:1 里 commit-own.test.js 4 项红为本机沙箱 spawn EPERM 已知环境限制
  （与 #4/#5 域 QA 同口径），CI（test-main）兜底验证；其余 230 项全绿。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-20）：自检 17 项 → 17 通过 / 0 缺失 / 0 偏差 / 2 需人工确认（均为本机沙箱
  环境限制，CI 兜底）→ ✅ 放行。反向自检已实测：删路由分支 → 测试红（fail 3）→ 恢复全绿。
