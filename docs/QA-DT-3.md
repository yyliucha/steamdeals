# QA：DT-3 用户管理打磨（第 1 轮）

> 基线 0a6b978 → HEAD（worktree 分支 wt-228-srv，未提交）；判据 docs/ADMIN-PERMISSIONS.md「DT-3 用户管理打磨」验收 +
> design/admin-users-2026-11-19.html demo；
> 开发描述来源：夜班监工派发（工人 2，worktree F:\dsh\gp-wt-228b）。
> 结论：✅ 放行 —— 通过 5 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | DT-3 | 无新建用户入口（按钮 + 抽屉 + URL 直达全删），POST /api/admin/users 下线（410），用户只能自助注册 | 控制台 → 用户管理；POST /api/admin/users | ✅ | AdminExtras.vue（无「＋ 新建用户」）；server.js 410；test/admin-users.test.js |
| 2 | DT-3 | 行内编辑弹窗：仅可改角色（admin/user），用户名/邮箱/绑定 Steam 账号只读 | 用户管理 → 编辑 | ✅ | AdminExtras.vue 编辑弹窗（对齐 demo ②）；GET /api/admin/users/:username/steam-accounts |
| 3 | DT-3 | 行内五操作：编辑 / 重置密码 / 禁用·启用 / 踢会话 / 删除（改名/邮箱/验证入口移除） | 用户管理行内操作列 | ✅ | AdminExtras.vue 操作列；test/frontend-registration.test.js DT-3 锁 |
| 4 | DT-3 | 角色变更、禁用、删除二次确认 + 审计（admin.user_edit / admin.user_disabled） | 同上 | ✅ | server.js PATCH 审计段；test/admin-users.test.js 审计断言 |
| 5 | DT-3 | 批量只保留「批量踢会话」（users/kick 后端新动作；禁用/启用批量移除） | 用户管理批量工具条 | ✅ | AdminExtras.vue usersBulkActions；BULK_ACTIONS 'users/kick'；test/admin-bulk.test.js |
| 6 | DT-3 | 禁用用户会话立即失效（复用 BK 会话管理） | 禁用按钮 | ✅ | server.js PATCH disabled → deleteSessionsOfUser（BK-1）；测试断言 |
| 7 | DT-3 | e2e 建号链迁移自助注册（registerCode 步骤 + verify） | test/e2e 矩阵 | ✅ | steps.mjs registerCode；account.mjs createUser；matrix.json 6 处 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 无新建入口/接口；用户只能自助注册 | HTTP 测试 401/403/410 + 前端静态断言 + e2e 建号迁移 | test/admin-users.test.js（410 且不建号）；test/frontend-registration.test.js DT-3；matrix.json | ✅ |
| 2 | 编辑仅角色可改且审计（admin.user_edit） | HTTP 测试 PATCH role → audit_logs 断言 | test/admin-users.test.js「PATCH 角色变更落审计」 | ✅ |
| 3 | 行内五个操作可用 | 前端静态断言五入口 + 既有 resetPassword/toggleUser/kickAllSessions/delete 测试绿 | test/frontend-registration.test.js DT-3 + 既有测试 | ✅ |
| 4 | 批量仅踢会话 | BULK_ACTIONS users/kick + 前端 actions 断言 + HTTP 测试（踢后会话失效、skipped 明细） | test/admin-bulk.test.js DT-3 | ✅ |
| 5 | 禁用用户会话立即失效（复用 BK） | HTTP 测试：禁用后 sessions 清空 | test/admin-users.test.js（BK-1 复用断言） | ✅ |
| demo 对齐 | 编辑弹窗文案/结构对齐 demo ②（仅可修改角色/用户名邮箱只读/绑定账号只读/角色两选项） | 静态断言 | test/frontend-registration.test.js DT-3（「仅可修改角色」等） | ✅ |

## 打回清单

无。

## 需人工确认

- 编辑弹窗视觉与 demo 的实际渲染效果（浏览器目视；demo 关键交互已映射成测试断言）。
- e2e 全量里的 account-create-login 行（自助注册链路）需发版后报告会话实跑——本沙箱无模拟器/无 spawn，只做了矩阵 JSON 校验与步骤代码语法检查。

## 争议项

- UserCreateDrawer.vue 组件文件保留（不再有入口引用）：规格只要求删「按钮 + POST 接口」，组件文件删除会连带破坏 auth-pages/unsaved-guard/session-heartbeat 三个测试对组件内部质量的锁；保留为死代码不影响任何入口。如所有者要求彻底删除组件文件，下一批连同三个测试一起改造。

## 复检记录

- 第 1 轮（2026-11-20）：开发自测多轮（audit bulkMissing 语义、password-policy verify 需 settings schema、测试断言适配），全绿后质检。
- 提交前 rebase 合并 DT-4（重置密码弹窗）/DT-5（全局顶栏）/v2.27.9（B4 拆分）：AdminExtras.vue 行内操作与 DT-4 弹窗共存（重置密码行内按钮=openResetPassword）；server.js 的 DT-3 steam-accounts 路由与 DT-4 reset-code 路由并存；合并后全部相关测试重跑绿。

## 备注

- TODO 状态由监工统一回写（夜班工人不改 docs/TODO.md 及任何共用文档，监工指令例外）。
- 本报告在 worktree 内（F:\dsh\gp-wt-228b\docs\QA-DT-3.md），与主树隔离。

## 验证输出（QA 亲自重跑，rebase 合并 DT-4/DT-5 后）

- `node test/admin-users.test.js` → 3/3 绿（410 下线 / steam-accounts 只读 / PATCH 审计+禁用踢会话）
- `node test/admin-bulk.test.js` → 绿（含 DT-3 users/kick）
- `node test/password-policy.test.js` → 11/11 绿（建号入口迁自助注册，策略断言保留）
- `node test/password-change.test.js` → 4/4 绿（410 + 重置临时密码保留）
- `node test/admin-console-ia.test.js` → 绿（新建入口断言反转）
- `node test/frontend-registration.test.js` → 绿（DT-3 前端锁）
- `node test/isolation.test.js / sessions.test.js / account-notify.test.js / auth-pages.test.js / unsaved-guard.test.js / session-heartbeat.test.js / auth-lockout.test.js / email-change.test.js / register.test.js` → 全绿
- `node test/api.test.js` → 38/38 绿（动过 API 必跑）
- `npm run frontend:build` → ✓ built in 3.66s
- `npm run scan` → ✅ 未发现高置信度凭据
- `node -e JSON.parse(matrix.json)` → OK；`node --check test/e2e/lib/steps.mjs / account.mjs` → OK
