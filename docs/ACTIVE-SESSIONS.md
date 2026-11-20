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
| 工人 1：DU/DT-1/DT-2/DT-4/DT-5 | worktree F:\dsh\gp-wt-228a（frontend/**、src/routes/auth.js、src/routes/me.js、src/routes/watchlist.js、store 相关——与主树完全隔离） | 无 | 16:25 | ≈19:00 | 工人 1（subagent） |
| 工人 2：EC/EM/DV/DT-3 | worktree F:\dsh\gp-wt-228b（src/server.js、src/steam-login.js、src/routes/site.js、src/steam-accounts.js、frontend 图片/同步区、test/相关——与主树完全隔离） | 无 | 16:25 | ≈19:30 | 工人 2（subagent） |
| B4 夜班监工（14:43 轮） | docs/B4-QUEUE.md、docs/ACTIVE-SESSIONS.md、发布文档（CHANGELOG/DONE/DELIVERY/TODO/INDEX/PROJECT-OVERVIEW/ARCHITECTURE）、package.json（仅构建时）、nightshift worktree | 打 tag 构建（每批 2–3 域） | 14:47 | 18:20 | 监工会话（定时唤醒） |
| B4 夜班监工（16:25 轮，所有者 16:20 指示：恢复拆域、只拆域不构建） | docs/B4-QUEUE.md、docs/ACTIVE-SESSIONS.md（发布文档/package.json 不碰——构建会话独占）；调度工人改 src/（域拆分） | 无（不构建、不打 tag） | 16:25 | 19:55 | 监工会话（定时唤醒，schedule-960679da） |
| B4 #14 admin 会话（#10 已完成 5ce2e50，工人 A 接续） | src/server.js、src/store/pg.js、src/routes/、src/store/、test/ | 无 | 16:15 | 17:20 | 工人 A（subagent） |
| B4 #19 cli 报表类（工人 B，#18 已完成 9bc710a） | src/cli.js、src/cli/、src/store/cli-*-repository.js、test/cli-dispatch.test.js（不动 server.js/pg.js/routes） | 无 | 16:06 | 17:36 | 工人 B（subagent） |
| B4 #20 cli 运维类（16:25 轮监工派工；#19 已完成 9bc710a） | src/cli.js、src/cli/、src/store/cli-*-repository.js、test/cli-dispatch.test.js（不动 server.js/pg.js/routes/frontend；与 2.28.0 worktree 文件面无重叠） | 无 | 17:10 | ≈18:40 | 工人 C（subagent）——17:20 冲突裁决让位（旧监工工人 B 已承接 #20），已停手收尾 |
| DV（代码已备好，自包含重放文档 F:\dsh\dv-wip\REPLAY.md；重放+提交+QA 移交 2.28.0 工人 2） | worktree gp-wt-228b（src/server.js 游戏管理列表筛选区 / frontend AdminModules.vue 游戏管理区 / admin-ui.js EP 组件注册 / test） | 无 | 2026-11-20 14:55 | 移交工人 2 完成 | lead → 工人 2 |
| DV 备注 | 代码与测试已完成并验证（admin-games 4/4、frontend-registration 4/4、api 38/38）；16:13 已从主树撤出，六处改动（server.js 来源判定 / AdminModules.vue 分组 / admin-ui.js ElOptionGroup / 两个测试文件）全部写入 F:\dsh\dv-wip\REPLAY.md（基线 7bce0b6，含 old/new 精确文本与验证记录），由 2.28.0 工人 2 在 worktree 重放提交 + QA | — | — | — | — |

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
