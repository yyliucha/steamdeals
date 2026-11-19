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
| DL(开发) | src/align-snapshot.js（新增）、src/align-compute.js（新增）、src/align-query.js、src/server.js(align 区)、src/cli.js(align-snapshot 命令)、src/scheduler.js(align-snapshot 任务)、src/store/pg.js(migrate 加 align_snapshots)、frontend/src/components/AlignAdmin.vue、test/{align-snapshot(新),align,align-perf,api,scheduler}.test.js、docs/{TODO(DL 状态行),REQUIREMENTS-INDEX(DL 行),PROJECT-OVERVIEW,ALIGN-SNAPSHOT}.md；**worktree F:\dsh\wt\dl 隔离**；与 DS 重叠面（scheduler/cli/pg/test/PROJECT-OVERVIEW）经所有者批准**并行**（各自加任务/命令/表，push 前 fetch+rebase） | 无 | 11-19 13:40 | 11-19 20:00 | dev-DL(lead) |

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
