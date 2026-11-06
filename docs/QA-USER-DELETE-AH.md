# QA：AH——用户彻底删除（第 1 轮）

> 基线 ea2ff36 → HEAD b7947ef；判据 [docs/USER-LIFECYCLE.md](USER-LIFECYCLE.md) §8 验收 1–4、14（AH 范围 = §9 批次表 AH 行）；
> 开发描述来源：所有者派发消息（TODO 编号 AH）。
> 结论：✅ 放行 —— 通过 5 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条功能一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | AH | 用户表行内「删除」按钮（自己的行不显示；最后一个可用管理员置灰并提示） | 后台 → 用户管理 → 管理操作列 | ✅ | `AdminExtras.vue:5`（`v-if="row.id !== me?.id"` + `:disabled="!canDeleteUser(row)"` + tooltip） |
| 2 | AH | 删除确认弹窗：列出会话/Steam 账号/愿望单与标记数，**必须输入用户名**才能提交，可选原因 | 后台 → 用户管理 → 删除 | ✅ | `AdminExtras.vue:7`（`deleteDialog` + `:disabled="confirm !== username"`） |
| 3 | AH | 输错确认用户名 → 400「请输入完整用户名确认」，列表不变 | `DELETE /api/admin/users/:username` | ✅ | `pg.js:1403`（`deleteUserAudited` confirmUsername 校验）+ `test/admin-user-delete.test.js:23` |
| 4 | AH | 删除成功后列表立即少一行、「最近删除」立即多一行（无整页刷新） | 后台 → 用户管理 | ✅ | `AdminExtras.vue:163-165`（`submitDeleteUser` → `loadUsers()` + `loadDeletions()`；末页最后一条回退页码） |
| 5 | AH | 被删用户立即掉线（会话随 users 级联删除，下一次请求 401） | 后端 | ✅ | `pg.js:1438`（`delete from users`；sessions 级联）+ 测试断言 `test/admin-user-delete.test.js:41` |
| 6 | AH | 删除后库内无残留（含两张无外键的 Steam 表手动清） | 后端 | ✅ | `pg.js:1431-1436`（事务先清 `steam_games`/`steam_wishlist`）+ 测试断言 |
| 7 | AH | 删除审计（谁删谁/时间/关联计数/原因，邮箱打码，无密码/Key/token） | 后端 `admin_user_deletions` | ✅ | `pg.js:243-255`（建表）+ `pg.js:1440-1443`（落库）+ 测试断言 `email_masked='b***@example.com'` |
| 8 | AH | 护栏：删自己 400、最后一个可用管理员 409、不存在 404 | `DELETE /api/admin/users/:username` | ✅ | `pg.js:1401-1412` + 测试护栏四态 |
| 9 | AH | 删除后用户名可立即重新注册 | 后端 | ✅ | 测试 `test/admin-user-delete.test.js:61`（同用户名 createUser 成功） |
| 10 | AH | 「最近删除」只读审计表 + 按用户名模糊搜索（部分匹配、大小写不敏感、清空恢复全部） | 后台 → 用户管理 → 最近删除 | ✅ | `AdminExtras.vue:6`（搜索框 `@clear`）+ `server.js:2269`（`?q=` ilike）+ `pg.js:1459` + 测试 |
| 11 | AH | `listUsers` 附带会话数/Steam 账号数（弹窗展示用） | `GET /api/admin/users` | ✅ | `pg.js:1352-1354` + 测试 |

## 逐条核对（规格 §8 验收 → 证据）

| # | 条目（AH 范围：验收 1–4、14） | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | 弹窗必须输入用户名才能提交；输错返回 400，列表不变 | 读模板 disabled + db 校验 + 测试 | `AdminExtras.vue:7` `:disabled="deleteDialog.confirm !== deleteDialog.username"`；`pg.js:1403`；测试护栏 400 | ✅ |
| 2 | 删除后列表立即少一行（无整页刷新）、最近删除立即多一行；被删用户会话失效（下次请求 401） | 读 submitDeleteUser + sessions 级联 | `AdminExtras.vue:163-165`；`pg.js:1438` 级联删 sessions；测试 `:41` 断言 token 行没了 | ✅ |
| 3 | 库内：users/sessions/user_prefs/user_game_flags/user_wishlist/announcement_reads/steam_accounts 无残留；steam_games/steam_wishlist 无该 SteamID 行；审计表新增 1 行且无敏感字段 | 测试直读各表 | `test/admin-user-delete.test.js` 第 2 条用例逐表断言（含 user_game_flags/announcement_reads，b7947ef 补齐）；审计断言打码/无敏感列 | ✅ |
| 4 | 护栏：删自己 400；删最后一个可用管理员 409；目标不存在 404 | db 函数 + 测试 | `pg.js:1401-1412`；测试第 1 条用例四态 | ✅ |
| 14 | 最近删除按用户名搜索：部分匹配、大小写不敏感、清空恢复全部 | 读接口 + 前端清空行为 + 测试 | `pg.js:1459`（ilike `'%'||q||'%'`）；`AdminExtras.vue:6` 搜索框 `clearable @clear="loadDeletions"`；测试 ilike/limit | ✅ |

## 需人工确认

- 浏览器端目视：弹窗文案/置灰 tooltip/最近删除表排版/「删除后立即少一行」的动效——静态证据齐全，未做浏览器手工回归（本地无后台账号环境）。
- 会话失效的"下一次请求 401"为级联删除的逻辑推论（sessions 行没了 → userBySession 查不到 → 401），未起真实 HTTP 会话实测；测试断言了 sessions 行删除。

## 争议项

- AH 的 DELETE 响应未带 `notify` 字段（规格 §4.1 响应示例里有 `notify: 'queued'|'skipped_no_email'`）。开发按 §9 批次表「AH 先不含通知」省略，前端 toast 统一「已删除」。AJ 批接入通知时需补回两档 notify 与对应文案——质检意见：属批次边界内的合理省略，记录待 AJ 追平（已写入 CHANGELOG「通知邮件随 AJ 批接入」）。

## 复检记录

- 第 1 轮（2026-11-06）：重跑 `npm test`（54 文件 / 462 项 / fail 0）、`frontend:build`（1.86s）、`scan`（无凭据）→ ✅ 放行，无打回项。
- 第 2 轮（2026-11-06，独立复核，应所有者要求重检 AH+AI）：基线 ea2ff36 → HEAD 9f9f1e8；
  重跑 `npm test`（56 文件 / 472 项 / fail 0）、`frontend:build`（1.43s）、`scan`（无凭据）、`git diff --check`（0）；
  抽查实现与测试未变（`deleteUserAudited` 护栏四态 + 级联/手动清理/审计脱敏/重新注册/搜索，测试 4/4 锁定）→ ✅ 放行，与第 1 轮一致。
