# QA：CU-2 站点级提醒按 Steam 愿望单反查候选 + 一键迁移 + 批量删除（第 1 轮）

> 基线 b2f27d1（CU-1 补收尾后）→ HEAD ee219a1；实现提交 b7ab402（代码/测试）+ ee219a1（文档回写）。
> 判据：[USER-ALERTS-GOVERNANCE.md](USER-ALERTS-GOVERNANCE.md) §2 CU-2 + §3 改动落点 + §4 验收 2/3/5。
> 结论：✅ 放行 —— 通过 5 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | CU-2 | 站点级提醒行显示「候选 N 人」tag（Steam 愿望单反查的用户，悬停列用户名，同用户多账号去重） | 后台 → 到价提醒（桌面表格 + 移动卡片） | ✅ 已交付 | `src/store/pg.js:2171-2181`（claimable_users 聚合 distinct user_id）；`AdminModules.vue:76/80`（tag 渲染）；口径断言 `test/watchlist-migrate.test.js:66-83` |
| 2 | CU-2 | 行级「迁移」：弹窗选候选用户（带邮箱）→ 该行归该用户，「用户」列变该用户名 | 后台 → 到价提醒 → 行「迁移」按钮 | ✅ 已交付 | `AdminModules.vue:86/88`（按钮+dialog）；`src/store/pg.js:2200-2228`（migrateSiteWatches）；HTTP 断言 `test/watchlist-migrate.test.js:169-177`（user_id/username 变化） |
| 3 | CU-2 | 多选 + 「迁移给用户」：批量把多条站点级提醒迁移到同一用户 | 后台 → 到价提醒 → 勾选 → 迁移给用户 | ✅ 已交付 | `AdminModules.vue:75`（批量按钮）、`472-493`（dialog 逻辑）；`src/server.js:3298-3320`（POST migrate）；断言 `:161-169`（migrated=2） |
| 4 | CU-2 | 目标用户已有同游戏提醒 → 自动合并（不产生重复行，站点级行移除） | 迁移接口（服务端自动） | ✅ 已交付 | `src/store/pg.js:2207-2221`（merged CTE）；断言 `test/watchlist-migrate.test.js:123-136`（merged=1、总行数不变） |
| 5 | CU-2 | 多选 + 「批量删除」站点级提醒 | 后台 → 到价提醒 → 勾选 → 批量删除 | ✅ 已交付 | `AdminModules.vue:75/494-503`；`src/server.js:3322-3341`（POST delete）；断言 `:186-197`（removed=2） |
| 6 | CU-2 | 迁移/批量删除均记审计（可后台审计查到操作人/目标/明细） | audit_logs（后台审计） | ✅ 已交付 | `src/server.js:3310-3319`（admin.watch_migrated）、`3330-3339`（admin.watch_deleted）；断言 `:179-186`、`:196-198`（actor/detail 落库） |
| 7 | CU-2 | 无人认领（无愿望单候选）的站点级行保持站点级（无迁移入口） | 后台 → 到价提醒 | ✅ 已交付 | `AdminModules.vue:86`（v-if 候选非空才显示迁移）；口径断言 `:83-84`（无候选 → []） |
| 8 | CU-2 | 用户级提醒保持只读（不可勾选、不可迁移、不被批量删除误伤） | 后台 → 到价提醒 | ✅ 已交付 | `AdminModules.vue:77-78`（selectable 仅站点级）；`src/store/pg.js:2205/2236`（where user_id is null）；断言 `:190-193`（混入用户级 id 被忽略、用户行仍在） |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 2 | 批量迁移 2 条到某用户 → `watchlist.user_id` 更新、页面「用户」列变为该用户、后续提醒发该用户邮箱（留证据） | 读代码 + 跑测试 | `src/store/pg.js:2217-2228`（update user_id=$2，仅 NULL 行）；`test/watchlist-migrate.test.js:169-177`（迁移后接口行 user_id=目标、username=目标用户名——页面用户列数据源）；收件人证据 `:138-143`（`watchCandidates` 迁移后 `user_email`=目标用户邮箱，达标提醒按该邮箱投递） | ✅ |
| 3 | 批量删除 → 行消失，审计日志可见 | 读代码 + 跑测试 | `src/store/pg.js:2232-2240`（delete returning）；`test/watchlist-migrate.test.js:186-198`（removed=2、audit_logs admin.watch_deleted 落库且 detail.ids=2） | ✅ |
| 5 | `npm test`（迁移/删除断言）/ `frontend:build` / `scan` 全绿 | 亲自重跑 | `node test/watchlist-migrate.test.js` 4/4；`watchlist.test.js` 5/5、`watchlist-user.test.js` 8/8、`watchlist-noprice.test.js` 3/3（CU-1 回归）；`node test/api.test.js` 33/33；`npm run test:2` exit 0（含新文件）；`npm run test:1/3/4` exit 0（共享底层兜底）；`npm run frontend:build` 2.24s；`npm run scan` 干净 | ✅ |
| 规格 §2 | 反查口径：`steam_wishlist` → `steam_accounts.user_id`，多用户全部列出；无人认领保持站点级 | 读代码 + 跑测试 | `src/store/pg.js:2171-2181`（sw.appid = g.steam_appid，join steam_accounts→users，distinct userId 去重）；`test/watchlist-migrate.test.js:57-84`（u1/u2 全列、u1 双账号去重、无候选 []）；UI 无候选不出现迁移入口（`AdminModules.vue:86` v-if） | ✅ |
| 规格 §3 | 权限与审计（api.watch_migrated / api.watch_deleted） | 读代码 + 跑测试 | `src/server.js:3298/3322`（requireAdmin）；`3310`（logger api.watch_migrated）、`3314`（writeAuditLog admin.watch_migrated）、`3330/3335`（删除同）；`test/watchlist-migrate.test.js:156-159`（普通用户 403、目标用户不存在 404） | ✅ |
| 纪律 | 范围：只做 CU-2（不做 CU-3 抽检 / CU-4 配额） | 查 diff | `git diff b2f27d1..HEAD --stat`：12 文件全部在 CU-2 范围（pg.js/server.js/AdminModules.vue/package.json/4 测试/4 文档）；无抽检/配额改动 | ✅ |

## 纪律固定检查项

1. `git tag --list`：无擅自新增 tag ✅
2. 未碰部署/服务器配置/凭据 ✅
3. 无构建产物进提交（frontend/dist 不在 diff）✅
4. 已推 main ✅（b7ab402 + ee219a1 on origin/main）
5. PROJECT-OVERVIEW 已同步 ✅（ee219a1 加 CU-2 行，CU-1 行升级为质检通过）

## 需人工确认

- 条目 1/2/3/5（线上目视）：本地为 pglite 合成数据；行为断言已锁（接口/审计/静态锁），部署后请所有者到「后台 → 到价提醒」目视：候选 tag、迁移弹窗（候选下拉带邮箱）、批量删除，并抽查一条真实迁移。
- 条目 2（邮件实发）：迁移后达标邮件实际投递到目标用户邮箱——生产 SMTP 链路，本地无法验证；证据为 `watchCandidates` 收件人断言（`user_email`=目标邮箱）。
- 性能（生产）：`claimable_users` 是每行一个相关子查询（json_agg），watchlist 线上仅 15 行、分页 20；`steam_wishlist_appid` 索引在位（`src/steam-login.js:51`），预期无虞，无需额外措施。

## 打回清单

- 无。

## 复检记录

- 第 1 轮（2026-11-19）：✅ 放行（5/0/0/2）。
- 第 1 轮期间修复 1 处回归：`test/admin-bulk.test.js` 前端静态锁「AdminModules 7 个勾选列」——CU-2 到价提醒表格新增第 8 个勾选列（批量迁移/删除走专用接口，不用统一 BulkBar），断言与注释同步更新（7→8、标题 11→12 个表格）；修复后 `node test/admin-bulk.test.js` 17/17、`npm run test:3` 整段 exit 0，其余三段 exit 0（共享底层兜底）。
