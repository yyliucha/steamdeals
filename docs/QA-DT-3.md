# QA：DT-3 用户管理打磨（第 1 轮）

> 基线 0a6b978 → HEAD 4a40737（feat(dt-3)，已推 main；复核在 f5446eb 上重跑）；判据 docs/ADMIN-PERMISSIONS.md「DT-3 用户管理打磨」验收 +
> design/admin-users-2026-11-19.html demo ①/②；
> 开发描述来源：夜班监工派发（工人 2，worktree F:\dsh\gp-wt-228b；收尾复核由 worker-dt3 接手）。
> 结论：✅ 放行 —— 通过 5 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | DT-3 | 无新建用户入口（按钮 + 抽屉 + URL 直达全删），POST /api/admin/users 下线（410），用户只能自助注册 | 控制台 → 用户管理；POST /api/admin/users | ✅ | AdminExtras.vue:4（无「＋ 新建用户」）；server.js:3140（410）；test/admin-users.test.js |
| 2 | DT-3 | 行内编辑弹窗：仅可改角色（admin/user），用户名/邮箱/绑定 Steam 账号只读 | 用户管理 → 编辑 | ✅ | AdminExtras.vue:32（对齐 demo ②）；server.js:2700（GET /api/admin/users/:username/steam-accounts） |
| 3 | DT-3 | 行内五操作：编辑 / 重置密码 / 禁用·启用 / 踢会话 / 删除（改名/邮箱/验证入口移除） | 用户管理行内操作列 | ✅ | AdminExtras.vue:5 操作列 + :260/:217/:205/:281/:371；test/frontend-registration.test.js DT-3 锁 |
| 4 | DT-3 | 角色变更、禁用、删除二次确认 + 审计（admin.user_edit / admin.user_disabled / admin.user_deleted） | 同上 | ✅ | server.js:2664（admin.user_edit）、:2667（admin.user_disabled）、:2607（admin.user_deleted）；AdminExtras.vue:273（角色确认）/ :281（禁用确认）；test/admin-users.test.js 审计断言 |
| 5 | DT-3 | 批量只保留「批量踢会话」（users/kick 后端新动作；批量禁用/启用移除） | 用户管理批量工具条 | ✅ | AdminExtras.vue:164（usersBulkActions 仅 kick）；server.js:3783（BULK_ACTIONS users/kick）；test/admin-bulk.test.js |
| 6 | DT-3 | 禁用用户会话立即失效（复用 BK 会话管理） | 禁用按钮 | ✅ | server.js:2647-2648（PATCH disabled → deleteSessionsOfUser + user.disabled_sessions_revoked）；test/admin-users.test.js 断言 sessions 清空 |
| 7 | DT-3 | e2e 建号链迁移自助注册（registerCode 步骤 + verify） | test/e2e 矩阵 | ✅ | test/e2e/lib/steps.mjs（registerCode）；lib/account.mjs:66；matrix.json 6 处 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 无新建入口/接口；用户只能自助注册 | HTTP 测试 401/403/410 + 前端静态断言 + e2e 建号迁移 | server.js:3140（410 + admin.user_create_rejected 审计）；test/admin-users.test.js（410 且不建号 + 反向自检注释）；test/frontend-registration.test.js DT-3；matrix.json | ✅ |
| 2 | 编辑仅角色可改且审计（admin.user_edit） | HTTP 测试 PATCH role → audit_logs 断言 | server.js:2664；AdminExtras.vue:32（用户名/邮箱/绑定账号只读，仅角色可选）；test/admin-users.test.js「PATCH 角色变更落审计」 | ✅ |
| 3 | 行内五个操作可用 | 前端静态断言五入口 + resetPassword/toggleUser/kickAllSessions/delete 相关测试绿 | AdminExtras.vue:5 操作列（编辑/重置密码/踢会话/禁用·启用/删除）；test/frontend-registration.test.js DT-3 + admin-console-ia 22/22 | ✅ |
| 4 | 批量仅踢会话 | BULK_ACTIONS users/kick + 前端 actions 断言 + HTTP 测试（踢后会话失效、skipped 明细） | server.js:3783、:4028（bulkUserKick）；AdminExtras.vue:164；test/admin-bulk.test.js DT-3 | ✅ |
| 5 | 禁用用户会话立即失效（复用 BK） | HTTP 测试：禁用后 sessions 清空 | server.js:2647-2648；test/admin-users.test.js（BK-1 复用断言） | ✅ |
| demo 对齐 | 编辑弹窗文案/结构对齐 demo ②（仅可修改角色/用户名邮箱只读/绑定账号只读/角色两选项）；页头与批量条文案对齐 demo ① | 静态断言 + 代码对照 | AdminExtras.vue:4（副标题）/ :32（弹窗）；test/frontend-registration.test.js DT-3（「仅可修改角色」等） | ✅ |

## 打回清单

无。

## 需人工确认

- 编辑弹窗视觉与 demo 的实际渲染效果（浏览器目视；demo 关键交互已映射成测试断言）。
- e2e 全量里的 account-create-login 行（自助注册链路）需发版后报告会话实跑——本沙箱无模拟器/无 spawn，只做了矩阵 JSON 校验与步骤代码语法检查。
- demo 细节差异（不判偏差）：demo 中已禁用行不显示「踢会话」而实现仍显示（禁用前遗留会话仍可踢，属合理冗余）；demo 绑定账号带「（默认）」标记，实现以别名优先展示（规格只要求昵称 + SteamID 只读）。

## 争议项

- UserCreateDrawer.vue 组件文件保留（不再有入口引用）：规格只要求删「按钮 + POST 接口」，组件文件删除会连带破坏 auth-pages/unsaved-guard/session-heartbeat 三个测试对组件内部质量的锁；保留为死代码不影响任何入口。如所有者要求彻底删除组件文件，下一批连同三个测试一起改造。

## 复检记录

- 第 1 轮（2026-11-20）：开发自测多轮（audit bulkMissing 语义、password-policy verify 需 settings schema、测试断言适配），全绿后质检。
- 提交前 rebase 合并 DT-4（重置密码弹窗）/DT-5（全局顶栏）/v2.27.9（B4 拆分）：AdminExtras.vue 行内操作与 DT-4 弹窗共存（重置密码行内按钮=openResetPassword）；server.js 的 DT-3 steam-accounts 路由与 DT-4 reset-code 路由并存；AdminExtras.vue api() 401 以 main 版为基础（先 redirectToLogin 再 throw）且保留 err.data 语义；合并后全部相关测试重跑绿。
- worker-dt3 收尾复核（2026-11-20 18:31–19:05）：接手工地时处于 stash-pop 冲突残留状态（2 个 autostash + unmerged 2 文件 + 冲突标记）；期间工人 2 会话完成 rebase 提交并推送 4a40737（12 文件：11 代码/测试 + 本报告初稿）。复核：4a40737 与规格/demo 双层核对通过（逐 hunk 过目，无 scope creep）、身份 yyliucha ✓、无新增 tag、已在 origin/main 历史中（f5446eb 之下）；随后在 f5446eb 上重跑全套验证（下方输出）。stash@{0}/stash@{1} 两个 autostash 内容已备份到仓库外（F:\dsh\tmp-dt3-backup\*.patch）并确认均已落入 main/DT-3 提交，遗留 stash 未 drop（保守，供监工决策）。
- 第 2 轮（构建门禁打回修复，2026-11-20 19:29 监工要求）：GET steam-accounts 接口的绑定账号 SQL 内联在 server.js 触发 B4 #6 边界锁（profile.test「steamBound 内联 SQL 不得残留」红）——SQL 抽到 src/store/me-repository.js 新函数 listBoundSteamAccounts（server.js 只调用、pg.js re-export），profile.test 加反向锁；修复后 profile 15/15、admin-users 3/3、api 38/38 全绿。

## 备注

- TODO 状态由监工统一回写（夜班工人不改 docs/TODO.md 及任何共用文档）。
- docs/PROJECT-OVERVIEW.md 的 DT-3 同步由监工统一处理（夜班纪律）。
- 本报告在 worktree 内（F:\dsh\gp-wt-228b\docs\QA-DT-3.md），与主树隔离。

## 验证输出（worker-dt3 在 f5446eb 上亲自重跑，2026-11-20 19:00–19:05）

- `node test/admin-users.test.js` → **pass 3 / fail 0**（410 下线 / steam-accounts 只读 / PATCH 审计+禁用踢会话）
- `node test/admin-bulk.test.js` → **pass 18 / fail 0**（含 DT-3 users/kick：缺 confirmCount 400 → 200 → 旧 cookie 立即失效 + skipped 明细）
- `node test/admin-console-ia.test.js` → **pass 22 / fail 0**（新建入口断言反转）
- `node test/frontend-registration.test.js` → **pass 9 / fail 0**（DT-3 前端锁：无新建入口/五操作/批量仅踢会话/编辑弹窗）
- `node test/password-change.test.js` → **pass 4 / fail 0**（建号 410 + 后台重置临时密码机制保留）
- `node test/password-policy.test.js` → **pass 11 / fail 0**（建号入口迁自助注册，策略断言保留）
- `node test/sessions.test.js` → **pass 17 / fail 0**
- `node test/api.test.js` → **pass 38 / fail 0**（动过 API/权限必跑）
- `npm run frontend:build` → ✓ built in 4.65s
- `npm run scan` → ✅ 未发现高置信度凭据（token / 私钥 / 带真实密码的连接串）
- `git tag --list` → 无新增 tag（4a40737 不带 tag）；diff 无部署/服务器配置；构建产物未入库
