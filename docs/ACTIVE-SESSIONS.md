# 活跃会话登记表（并发开发协调）

> 规则（2026-11-19 起，所有者确认）：**任何开发/质检/构建会话开工前先读本表 → 登记 → 收工注销**。
> 目的：解决多会话并行时的「同文件抢占、暂存区串扰、回退重放、独占资源冲突」四类问题（背景见
> `docs/AUDIT-2026-11-19.md` 的多会话事故记录）。
>
> **登记项**：条目编号｜会改的文件面（目录级）｜是否独占资源（e2e 全量 / Android 模拟器 / headless 浏览器报告 /
> 真实服务栈 / 打 tag 构建）｜开始时间｜预计结束｜会话标识。
>
> **判定**：
> - 文件面与已有登记**重叠** → 排队或协商（谁先登记谁先做，后到的等或换条目）；
> - **独占资源**已被登记 → 等它释放（同一时刻只有一个会话持有同一独占资源）；
> - 只读检查、单测/主链分段（端口随机、pglite 临时库）**不需要登记**。

## 当前活跃（维护这张表；注销即删行）

| 条目 | 文件面 | 独占资源 | 开始 | 预计结束 | 会话 |
|---|---|---|---|---|---|
| 2.28.0 专项监工（DU/DV/EC/EM/DT-1~5 开发+质检+构建，所有者 16:12 授权） | 主树零改动（开发全程在 worktree gp-wt-228a/b 隔离，主树只读）；构建阶段改发布文档+package.json（pathspec） | 打 tag 构建（排队：v2.27.8 会话与 B4 监工之后；版本 2.28.0 大版本） | 16:17 | ≈21:30 | lead（2.28.0 监工） |
| 工人 1：DU/DT-1/DT-2/DT-4/DT-5 | worktree F:\dsh\gp-wt-228a（frontend/**、src/routes/auth.js、src/routes/me.js、src/routes/watchlist.js、store 相关——与主树完全隔离） | 无 | 16:25 | ≈19:00 | 工人 1（subagent）——五条全推 main（DU 791d729/DT-1 7f5edba/DT-2 403e6f2/DT-4 4c49f7c/DT-5 c19f514），QA 全放行 |
| 工人 2：EC/EM/DV/DT-3 | worktree F:\dsh\gp-wt-228b（src/server.js、src/steam-login.js、src/routes/site.js、src/steam-accounts.js、frontend 图片/同步区、test/相关——与主树完全隔离） | 无 | 16:25 | ≈19:30 | 工人 2（subagent）——已提交 EC/EM/DV；DT-3 由 worker-dt3 接手（18:27，rebase 冲突解决中） |
| B4 夜班监工（18:25 轮接管，schedule-960679da；所有者 16:20 指示：恢复拆域、只拆域不构建；16:25 轮 18:55 让位收工交接） | docs/B4-QUEUE.md、docs/ACTIVE-SESSIONS.md（发布文档/package.json 不碰——构建会话独占）；调度工人改 src/（域拆分） | 无（不构建、不打 tag） | 18:25 | ≈21:00 | 监工会话（定时唤醒，schedule-960679da） |
| B4 #17 admin align（18:25 轮监工派工） | worktree F:\dsh\gp-wt-17（src/server.js、src/store/pg.js、新 src/routes/admin-align.js + src/store/admin-align-repository.js、test/（align 相关）、docs/QA-CO5-B4-2-admin-align.md）——不碰 admin users 区（DT-3 4a40737 刚改）、不碰发布文档 | 无 | 19:05 | ≈20:30 | 工人（subagent） |
| 2.28.0 监工 18:27 备注 | 主树 pull（a1d2dfc→4c49f7c，B4 v2.27.9 已发 tag）：本地 3 个与远端 blob 一致的未跟踪文件（QA-CO5-B4-2-admin-sessions.md / routes/admin-sessions.js / store/admin-sessions-repository.js）已备份至 F:\dsh\pull-backup-20261120 后移除；autostash 恢复时仅 test/sessions.test.js 冲突，已解决为「远端版 + #20 第十二轮 prune 断言指向 cli/ops.js」并暂存；autostash 保留在 stash@{0} 未 drop；其余主树在途改动原样保留（B4 工人 B #20 的域，本会话不再动主树） | — | — | — | — |

## 独占资源一览（同一时刻只允许一个会话持有）

| 资源 | 说明 | 典型操作 |
|---|---|---|
| **e2e 全量** | `npm run e2e`（含 e2e_ 账号建删、模拟器走查） | 报告会话、发版前门禁 |
| **Android 模拟器/真机** | `steamdeals35` 或 adb 真机 | e2e --device、App 安装验证 |
| **headless 浏览器报告** | Chrome `--print-to-pdf` 出报告 | 测试报告会话 |
| **真实服务栈** | 本地起完整服务跑 api/e2e 联调 | 冒烟、接口联调 |
| **打 tag 构建** | `git tag vX.Y.Z` + 推 tag（触发 CI） | 构建会话（同一时刻只有一个） |

## 历史事故（为什么要这张表）

- `b9356aa`：需求会话 commit 时把他人暂存区的 CX/DF 代码一起提交（暂存区串扰）；
- `77c9f8f` / `e5cfef1`：并行会话回退时用陈旧索引重放，短暂覆盖他人改动（已恢复）；
- `93e1241`：CX 首页入口被并发覆盖（已补回）；
- 教训：**开工先读表、文件面重叠就等；提交前暂存区必须为空**。
