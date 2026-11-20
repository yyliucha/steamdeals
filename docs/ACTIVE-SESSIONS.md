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
| B4 夜班监工（20:25 轮接棒，schedule-960679da；18:25 轮 20:45 收尾交棒：只拆域不构建） | docs/B4-QUEUE.md、docs/ACTIVE-SESSIONS.md（发布文档/package.json 不碰——构建会话独占）；调度工人改 src/（域拆分） | 无（不构建、不打 tag） | 21:05 | ≈00:35 | 监工会话（定时唤醒，schedule-960679da） |
| B4 #12 admin 报表备份日志（20:25 轮监工派工） | worktree F:\dsh\gp-wt-12（src/server.js、src/store/pg.js、新 src/routes/admin-reports.js + src/store/admin-reports-repository.js、test/（报表/备份/日志相关）、docs/QA-CO5-B4-2-admin-reports.md）——不碰 admin games 区、不碰发布文档 | 无 | 21:05 | ≈22:35 | 工人 A（subagent） |
| B4 #21 games（20:25 轮监工派工） | worktree F:\dsh\gp-wt-21（src/server.js、src/store/pg.js、新 src/routes/games.js + src/store/games-repository.js、test/（games 相关）、docs/QA-CO5-B4-2-games.md）——不碰 admin 报表/备份/日志区块、不碰发布文档 | 无 | 21:05 | ≈22:35 | 工人 B（subagent） |

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
