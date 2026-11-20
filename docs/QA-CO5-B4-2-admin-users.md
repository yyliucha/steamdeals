# QA：CO-5/B4-2 第十六轮 admin-users 域拆分（第 1 轮）

> 基线 d5becd2（#21 games 完成后的 worktree HEAD）→ 本轮交付 = 工作区未提交 diff（拆分提交待本报告完成后一并提交）；
> 判据：docs/ARCHITECTURE.md §15「域路由拆分模式」+ 夜班工人任务书（B4 #11 admin 用户批量：users/bulk/bulk-ops + DT-4 后台重置密码发码）；
> 开发描述来源：夜班监工派工 prompt（自包含，本报告为工人自检）。
> 结论：✅ 放行 —— 通过 17 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（接口路径） | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | B4#11 | 用户列表（管理员只读） | GET /api/admin/users | ✅ 已交付 | routes/admin-users.js；test/admin-bulk.test.js 18/18 |
| 2 | B4#11 | 最近删除审计（用户名模糊搜索，只读） | GET /api/admin/users/deletions | ✅ 已交付 | routes/admin-users.js；test/admin-user-delete.test.js 4/4 |
| 3 | B4#11 | 建号入口下线：管理员触发 410，用户只能自助注册（DT-3） | POST /api/admin/users | ✅ 已交付 | routes/admin-users.js；test/admin-users.test.js:42-67 |
| 4 | B4#11 | 编辑用户：显示名/角色/启用状态；角色变更与禁用落审计、字段变化发通知、单条禁用立即踢会话 | PATCH /api/admin/users/:username | ✅ 已交付 | routes/admin-users.js；test/admin-users.test.js:96-127 |
| 5 | B4#11 | 彻底删除用户：确认用户名/删自己/最后管理员三重守卫 + 级联清理 + 审计 + 删除通知 | DELETE /api/admin/users/:username | ✅ 已交付 | routes/admin-users.js；test/admin-user-delete.test.js 4/4 |
| 6 | B4#11 | 邮箱验证发码/校验（绑定验证，5 分钟有效、5 次尝试） | POST /api/admin/users/:username/email/code + /email/verify | ✅ 已交付 | routes/admin-users.js；test/mail-templates.test.js 17/17 |
| 7 | B4#11 | 绑定/解绑登录邮箱：格式校验、旧库补列兜底、审计脱敏、双通知 | POST /api/admin/users/:username/email | ✅ 已交付 | routes/admin-users.js；test/email-change.test.js 7/7 |
| 8 | B4#11 | 管理员解锁：清零失败计数与锁定 | POST /api/admin/users/:username/unlock | ✅ 已交付 | routes/admin-users.js；test/auth-lockout.test.js 11/11 |
| 9 | B4#11 | 后台重置密码发码：独立 admin_reset 分桶冷却、retryAfterSec 回传、verify_code 模板（DT-4） | POST /api/admin/users/:username/reset-code | ✅ 已交付 | routes/admin-users.js；test/auth-pages.test.js 14/14 |
| 10 | B4#11 | 重置密码：验证码模式（失败不关弹窗、剩余次数、过期/无码提示）+ 直设/留空生成临时密码（强制首登改密、踢会话、审计、通知） | POST /api/admin/users/:username/password | ✅ 已交付 | routes/admin-users.js；test/auth-pages.test.js:153-171 |
| 11 | B4#11 | 编辑弹窗只读展示绑定 Steam 账号（昵称 + SteamID；DT-3） | GET /api/admin/users/:username/steam-accounts | ✅ 已交付 | routes/admin-users.js；test/admin-users.test.js:69-94 |
| 12 | B4#11 | 按用户踢全部会话（管理员踢自己保留当前会话） | DELETE /api/admin/users/:username/sessions | ✅ 已交付 | routes/admin-users.js；test/sessions.test.js 17/17 |
| 13 | B4#11 | 批量操作统一入口：白名单派发（20 组 target/action）、键规范化去重、高危二次确认、守卫、审计落库、互斥回执、缓存失效 | POST /api/admin/bulk | ✅ 已交付 | routes/admin-users.js；test/admin-bulk.test.js 18/18 |
| 14 | B4#11 | 批量操作记录审计（列表 + 详情含键样本） | GET /api/admin/bulk-ops + /api/admin/bulk-ops/:id | ✅ 已交付 | routes/admin-users.js；test/admin-bulk.test.js:428-447 |

## 逐条核对（拆分规格 → 证据）

| # | 条目（ARCHITECTURE §15 / 任务书） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | routes/admin-users.js 只做 HTTP 编排，不写 SQL 字面量 | grep + 静态锁 | admin-users.js 全文无 select/insert/update/delete from/alter table；test/admin-users.test.js「不写 SQL 字面量」断言 | ✅ |
| 2 | ctx 基座按 §15.2 + 域特有按引用传入且注释「语义共享」 | 读文件 | 基座 path/req/res/url/q/logger/json/readBody/user/requireAdmin/ip/token；banIpExclusive/invalidateAdminGamesCache/invalidateListCache/appealEmail 逐一注释语义共享 | ✅ |
| 3 | 入口形态按 §15.3：管理段单入口；返回 true/false 约定 | 读文件 + 静态锁 | 单入口 handleAdminUsersAdmin；凡写响应 (json(...), true)、末尾 return false；静态锁第 1 组 | ✅ |
| 4 | 调用位置原样：管理段、sessions 接线之后 revoke-others 之前（kickAll 原位置） | grep + 静态锁两条 | server.js 接线块；test/admin-users.test.js「sessions 之后 / revoke-others 之前」两条位置语义锁 | ✅ |
| 5 | 20 个 pg.js 函数搬家，签名照抄 | 静态锁逐函数正则 | admin-users-repository.js 中 unlockUser/updateUser/deleteUserAudited/listUserDeletions + bulk 16 函数签名与拆分前逐字一致（test 第 4 组） | ✅ |
| 6 | 域内联 SQL 抽新函数（13 个） | 对照拆分前 server.js | userSessionKickTarget/userEmailTarget/userEmailIdRow/userStateRow/userIdRow/insertAdminEmailCode/pendingEmailCode/bumpEmailCodeAttempts/consumeEmailCode/markEmailVerified/recentEmailCodes/adminBindEmail/ensureUsersEmailColumns；发码 sent_ok 回写复用 admin-settings 域 markEmailCodeSent/Failed（SQL 逐字一致） | ✅ |
| 7 | pg.js 顶部 re-export 保旧签名；禁止删已有 re-export | git diff | pg.js 新增 33 项 admin-users re-export；既有各域 re-export 零删改 | ✅ |
| 8 | 跨域通用 SQL 留 pg.js；DDL 不动 | grep + git diff | listUsers（cli）/setUserPassword（auth-routes）/writeAuditLog（admin-access/alert 推送）/deleteSessionsOfUser（revoke-others/auth）/bulkSetFreeStatus（steam-status）留 pg.js；users/admin_bulk_ops 等表 DDL 在 pg.js SCHEMA 未动 | ✅ |
| 9 | DT-3 改动不被回退（任务书特别要求） | git diff 核对 | POST /api/admin/users 410 下线、users/kick 批量只留踢会话、steam-accounts 只读走 db.listBoundSteamAccounts（me-repository）逐字保留；test/admin-users.test.js 3/3、admin-bulk 18/18 全绿 | ✅ |
| 10 | DT-4 重置密码发码接口一并纳入 users 域（任务书特别要求） | 读文件 + 测试 | reset-code + password 两路由随域拆入 admin-users.js；test/auth-pages.test.js 14/14（DT-4 验收 3/4 断言改指新落点） | ✅ |
| 11 | bulk 白名单派发表与 helper 随域移入；banIpExclusiveSql 留宿主 | 读文件 | BULK_KEY_ERROR/BULK_ACTIONS/normalizeBulkKey/bulkMissing/bulkEach/21 个 bulk helper 移入 admin-users.js 模块级；helper 经 def.run 参数拿 banIpExclusive 宿主闭包；banIpExclusiveSql 留 server.js（admin-access 域共用） | ✅ |
| 12 | 外部契约零变化（路径/参数/响应/错误码/权限） | 真跑运行时测试 | api.test 38/38、admin-bulk 18/18、admin-users 7/7、admin-user-delete 4/4、admin-console-ia 22/22、session-heartbeat 7/7、account-notify 8/8、email-change 7/7、password-change 4/4、setup 4/4、isolation 7/7、admin-games 6/6、sessions 17/17、reviews 31/31、mail-templates 17/17、announcements 8/8、align 15/15、sync-runs 9/9、auth-lockout 11/11、auth-pages 14/14、profile 15/15 全绿 | ✅ |
| 13 | 静态断言测试指向新文件 + 四组锁 | 读测试文件 | test/admin-users.test.js 新增 4 组锁；sessions/reviews/mail-templates/sync-runs/align/announcements/auth-pages 7 个文件的边界锁与位置锚改指新落点（不降断言质量） | ✅ |
| 14 | 反向自检：删分支/接线/re-export → 测试必须红 | 实测（删后恢复） | ① 改坏 reset-code 分支 → 组 1 红（fail 1）→ 恢复全绿；② 断 server.js 接线 → 行为测试 ×3 + 组 2 红（fail 4）→ 恢复全绿；③ 删 pg.js unlockUser re-export → 组 4 红（fail 1）→ 恢复 7/7 全绿 | ✅ |
| 15 | test:1..4 全绿（commit-own 沙箱基线除外） | 实测 | test:1 链式到末（仅 commit-own 4 项红=沙箱 spawn EPERM 基线）、test:2 全绿、test:3 全绿、test:4 全绿 | ✅ |
| 16 | frontend:build + scan | 实测 | 默认命令被沙箱拦（同前几域）→ 等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` ✓ built in 5.87s；npm run scan 干净 | 🔎（变体，CI 兜底） |
| 17 | 纪律：无新 tag / 不碰部署配置 / 产物不进提交 / 不改共用文档 / 不碰 package.json | git 取证 | git tag 无新增；diff 仅 server.js/pg.js/10 个 test 文件 + 2 新文件；frontend/dist 已忽略；B4-QUEUE/ACTIVE-SESSIONS/CHANGELOG/ARCHITECTURE 等共用文档零改动；package.json 未动 | ✅ |

## 域边界判定（B4 #11 admin 用户批量 与相邻域的关系）

1. **盘点**：`grep users/bulk` 全 server.js——/api/admin/users* 12 组（kickAll 1369、email/code 2112、email/verify 2164、
   DELETE/PATCH userMatch 2193、steam-accounts 2302、reset-code 2314、password 2378、unlock 2462、email 2501、
   GET users 2662、deletions 2668、POST users 2701）+ bulk/bulk-ops 3 组（2890/2988/2994）。
2. **本轮拆走**：以上全部按 #11 拆入 src/routes/admin-users.js + src/store/admin-users-repository.js。
   **DT-4 边界**（B4-QUEUE 备注 18:45 行）：后台重置密码发码接口（reset-code + password 验证码模式）按规格
   落在 server.js 原管理段，本轮一并纳入 users 域——契约与静态锁保持（test/auth-pages.test.js DT-4 验收 3/4
   断言改指新落点）。**DT-3 历史**：v2.28.0（4a40737/9646308）对 admin users 区的改动（POST users 410 下线、
   steam-accounts 只读走 me-repository 的 listBoundSteamAccounts、bulk users/kick 只留踢会话、PATCH 审计）
   逐字保留未回退（git diff 核对 + admin-users/admin-bulk 测试全绿）。BULK_KEY_ERROR/BULK_ACTIONS 白名单
   派发表与 21 个 bulk helper 只被本域 bulk 路由使用，随域移入模块级。
3. **留宿主（不属于本域）**：
   - `/api/admin/games*`（B4 #15）、`/api/admin/images*`（B4 #13）、admin 报表/备份/日志区块
     （/api/admin/reports*、backup、logs、steam-logs，B4 #12）——留 server.js 零改动；
   - `/api/user/sessions/revoke-others`（前台主段）——留 server.js；
   - `banIpExclusiveSql`（黑/白名单互斥 SQL 编排 + 内存态同步）——跨域共用（admin-access 域单条封禁/信任
     与本域 bulk 批量封禁/信任都经 banIpExclusive 宿主闭包走这里），§15.4 判据留 server.js；
     banIpExclusive 定义上移到 admin-users 接线之前（kickAll 原位置在其定义之前，避免 TDZ；行为不变）。
4. **SQL 归属判据**（§15.5 第 4 步）：
   - 搬入 admin-users-repository.js（只被本域使用）：unlockUser/updateUser/deleteUserAudited/
     listUserDeletions + bulk 16 函数（bulkSetGamesBlocked/Deleted、bulkDeleteAnnouncements、
     bulkSetAnnouncementsActive、bulkGetAbuseReviews/bulkRejectAbuseReviews、bulkRemoveBlockedIps/
     WhitelistIps/DeviceBans、usersForBulk/countActiveAdmins/bulkSetUsersDisabled/deleteSessionsOfUsers、
     createBulkOp/listBulkOps/getBulkOp）+ 域内联新函数 13 个（asIdList/asTextList 模块级 helper 随搬）；
   - 留 pg.js（跨模块共用）：listUsers（cli.js）、setUserPassword（auth-routes.js）、writeAuditLog
     （admin-access 域/alert 手动推送/auth 域）、deleteSessionsOfUser（前台 revoke-others/routes/auth.js/
     kickAll/禁用踢会话）、bulkSetFreeStatus（steam-status）、addBlockedIp/addWhitelistIp/clearAbuseBan/
     markReviewsAutoBanned 等（admin-access 域与 banIpExclusiveSql 共用）；
   - 无 DDL 搬家：users/admin_bulk_ops/admin_user_deletions 等表 DDL 在 pg.js SCHEMA 不动；
   - 发码 sent_ok 回写复用 admin-settings 域的 markEmailCodeSent/markEmailCodeFailed（SQL 逐字一致，不重复定义）。
   测试锁第 4 组把「旧定义不得残留 pg.js + 跨域函数留 pg.js + repository 不搬 DDL」固化。
5. **拆分过程事故记录（已修复并测试验证，供监工知悉）**：批量删除 server.js 区块时曾误伤三处跨域内容——
   ① banIpExclusiveSql（admin-access 域共用）被随 bulk helper 区块一起删除；② admin-access 域接线
   （handleAdminAccessAdmin）被随 users GET 区块一起删除；③ pg.js 的 writeAuditLog（跨模块通用审计）
   被随 bulk 函数尾块一起删除。三处均已逐字恢复原内容，并通过 admin-bulk 18/18、reviews 31/31、
   admin-users 7/7、test:1-4 全链验证；本域静态锁已把「banIpExclusiveSql 留 server.js、admin-access
   接线留 server.js、writeAuditLog 留 pg.js」三条固化为断言（防复发）。

## 打回清单

无。

## 需人工确认

- 条目 16：frontend:build 默认命令在本机沙箱被拦（vite 加载配置的 bundling 阶段失败），
  改用等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` 构建成功；
  默认命令在 CI（docker 构建前端）验证——与前几域 QA 同口径。
- 条目 15：test:1 里 commit-own.test.js 4 项红为本机沙箱已知环境限制（spawn EPERM 类基线），
  CI（test-main）兜底验证；其余分段全绿。与前几域 QA 同口径。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-20）：自检 17 项 → 17 通过 / 0 缺失 / 0 偏差 / 2 需人工确认（均为本机沙箱
  环境限制，CI 兜底）→ ✅ 放行。反向自检已实测 ×3：改坏 reset-code 分支 → 静态锁组 1 红（fail 1）；
  断 server.js 接线 → 行为测试 ×3 + 组 2 红（fail 4）；删 pg.js unlockUser re-export → 组 4 红
  （fail 1）→ 三次均恢复后全绿。拆分中误删的跨域内容（banIpExclusiveSql/admin-access 接线/
  writeAuditLog）已逐字恢复并全链复验，且三条「留宿主/留 pg.js」断言已固化防复发。
- 推送前 rebase 冲突解决（两批，均在 worker B 提交时 origin/main 前进）：
  ① origin/main 前进至 #12 admin 报表备份日志（4a93c01）——server.js/reviews.test.js/
  sync-runs.test.js 三文件冲突，按「双方域已拆走的内容整块删除、对方 #12 的 handleAdminReportsAdmin
  接线与 re-export 保留」解决；② origin/main 前进至 #13 admin 图片（652e6f7）——server.js/
  pg.js/reviews.test.js 冲突，按「POST users 410（#11 已拆）删除、对方 #13 的 handleAdminImagesAdmin
  接线与 imageCoverageRows re-export 保留、两域 re-export 块并列」解决。合并后复验：
  api.test 38/38、admin-users 7/7、admin-bulk 18/18、reviews 31/31、sync-runs 9/9、align 15/15、
  announcements 8/8、auth-pages 14/14、mail-templates 17/17、sessions 17/17、
  test:2/3/4 全链绿。合并带动的边界锁锚点更新（users/images/logs 段拆走后的位置锚）已同步
  修正于 reviews/sync-runs/align/admin-users 测试文件。
