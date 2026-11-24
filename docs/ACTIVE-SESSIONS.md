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
| FG + FH（开发完成，质检中） | gameprice：frontend/src/pages/{Home,AdminModules}.vue、src/store/admin-games-repository.js、test/{remove-18r-entry,admin-ux-security}.test.js、package.json、docs/{TODO,REQUIREMENTS-INDEX,PROJECT-OVERVIEW}.md；steamdeals-app：ui/home、ui/search、ui/AppViewModel.kt、res/values/strings.xml、test/HomeFilterParamsTest.kt | 无 | 2026-11-24 09:35 | 2026-11-24 | lead（站点已提交 7e0387d 推 main，App 待提交；QA 进行中） |
| 监工批次 ER/EP/EY/FB/FF/EN + 批量构建 v2.28.10 起 | gameprice：src/cli*、src/routes/*、src/{server,serve,settings}.js、frontend/src/pages/*、test/*.test.js、docs/{TODO,REQUIREMENTS-INDEX,DONE,PROJECT-OVERVIEW,DELIVERY,CHANGELOG,B4-QUEUE}.md、package.json、package-lock.json；工人 worktree F:\dsh\wt\{ER,EN} | **打 tag 构建**（等 v2.28.9 CI 双绿后接） | 2026-11-24 10:05 | 2026-11-24 13:30 | lead（夜班监工：调度 ≤2 工人 + 构建） |

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
