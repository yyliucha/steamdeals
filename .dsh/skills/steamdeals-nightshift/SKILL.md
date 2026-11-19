---
name: steamdeals-nightshift
description: SteamDeals/gameprice 夜班自动化流水线（监工 + 工人）：定时任务唤醒监工会话，监工按 docs/B4-QUEUE.md 队列调度子代理「工人」逐域拆分（开发+QA），每 2–3 个域批量构建发版（版本连续递增、质检门禁、CI 双绿）；含心跳/超时/接管容错，解决「构建卡死、监控停摆」问题。当所有者要求「夜间自动跑 CO-4 域拆分/构建流水线」「开夜班」或需要排查夜班卡死时使用；被监工/工人身份运行的会话在开工前必须读本技能。
---

# 夜班流水线（监工 + 工人）

> 权威事实源：`docs/B4-QUEUE.md`（队列 + 进度 + 备注心跳）。本技能是流程规范，**任何规则变更先改 skill，再改 B4-QUEUE**。
> 所有者授权：2026-11-19 起，夜间可自动「开发 → 质检 → 构建 → 再开发」循环（每次构建仍受 `steamdeals-build` 门禁约束）。

## 0. 角色与边界

| 角色 | 谁 | 职责 | 不做 |
|---|---|---|---|
| **监工** | 定时任务唤醒的新会话（每 4 小时兜底） | 调度工人、接管卡死、批量构建、更新发布文档、写心跳 | 不亲自开发域（除非接管） |
| **工人** | 监工用 `subagent` 启动的独立会话（每域一个） | 按 `ARCHITECTURE §15` 拆一个域 + 修测试 + 跑 QA + 提交代码/测试/QA 报告 + 返回摘要 | 不构建、不打 tag、不改发布文档（CHANGELOG/DONE/DELIVERY/INDEX/TODO/PROJECT-OVERVIEW/B4-QUEUE/ARCHITECTURE） |

- 工人之间**并行 ≤2 个**，按文件面分组（互不重叠；共用文档只由监工改）；
- 所有会话开工前登记 `docs/ACTIVE-SESSIONS.md`，收工注销。

## 1. 队列与心跳（防卡死）

- **队列**：`docs/B4-QUEUE.md` 表格（# / 域 / 状态 / 版本 / 提交）——每完成一个域，监工更新该行；
- **心跳**：监工每进入/完成一个阶段就在 B4-QUEUE「备注」追加一行：`HH:MM <阶段> <域/版本> <结果>`；
  阶段 = 开工 / 工人启动 / 工人完成 / 构建开始 / 构建完成 / CI 结果 / 接管；
- **恢复**：卡死后下一轮监工只读 B4-QUEUE 备注即可知道做到哪一步。

## 2. 监工流程（每轮）

1. **pull + 读文档**：`git pull --rebase --autostash`；读 B4-QUEUE、ARCHITECTURE §15、ACTIVE-SESSIONS、TODO、DELIVERY、`git tag`；
2. **接管检查（防停摆）**：
   - ACTIVE-SESSIONS 有登记且**开始时间 > 4 小时前** → 判旧会话卡死：删登记行、备注记录；
   - 备注最后心跳 = 「构建开始未完成」→ 检查工作区：发布文档完整 → **接手提交 + 打 tag + 推送 + 盯 CI**；
     残缺/冲突 → `git checkout` 丢弃该文件并记录，重新构建；
   - 备注最后心跳 = 「工人进行中」→ 有未提交代码就接手完成（提交+QA），否则标记该域「阻塞」跳过；
3. **开发循环**：取 B4-QUEUE 第一个「未拆」域（并行 ≤2、文件面不重叠）→ `subagent` 启动工人（prompt 自包含：
   读 B4-QUEUE/ARCHITECTURE §15/试点范例 → 拆分 → 质检 → 只提交代码+测试+QA 报告 → 返回摘要）→
   `wait_agent` 等待 **≤30 分钟**（超时判失败、标记阻塞、立即接下一个）→ 每阶段写心跳；
4. **批量构建**：每 **2–3 个域**（或预算剩 45 分钟）→ 版本 = `package.json` 小版本 **+1（连续递增，禁止跳号）** →
   更新发布文档（CHANGELOG/DONE/DELIVERY/INDEX/TODO/PROJECT-OVERVIEW/B4-QUEUE/ARCHITECTURE）→
   pathspec 提交 → 打 annotated tag → 推送 main+tag → 盯 CI（docker-hub/docker-tcr/test-main）**最多 25 分钟**，
   超时写「CI 待确认 <runId>」**继续不阻塞**；CI 红修复重试 ≤1 次，仍红记录停手；
5. **收尾**：预算（约 3.5 小时 / 最多 6 个域 / 队列空 / 上下文将满）→ 注销登记 + 写最后心跳 →
   汇报「拆了哪些域 / 版本 / CI 状态 / 剩余队列 / 卡点」。

## 3. 工人流程（每域）

1. 自包含 prompt：读 B4-QUEUE 指定域 + ARCHITECTURE §15 + 试点范例（`src/routes/app.js`、`appeal.js`、`auth.js`）；
2. 按 §15 拆分：`src/routes/<domain>.js`（HTTP 编排，不写 SQL）+ `src/store/<domain>-repository.js`
   （签名不变，pg.js 保留 re-export 兼容，通用 SQL 留 pg.js）；上下文注入照 §15；契约零变化；
3. 修该域静态断言测试（指新文件，不降断言质量）；
4. 加载 `steamdeals-qa` 质检（报告 `docs/QA-CO5-B4-2-<域>.md`）；打回修复重检；
5. 通过后**只提交**：代码 + 测试 + QA 报告（pathspec）；**不改共用文档、不构建、不打 tag**；
6. 返回摘要：域 / 提交哈希 / QA 结论 / 净减行数 / 阻塞点（如有）。

## 4. 定时任务配置（schedule_create 模板）

```
title: 夜班自动执行 CO-4 域拆分与构建
target: new（每轮新会话）
rrule: DTSTART;TZID=Asia/Shanghai:<起始>\nRRULE:FREQ=HOURLY;INTERVAL=4;COUNT=4（兜底唤醒；监工在轮内自适应节奏）
prompt: 指向本技能 + docs/B4-QUEUE.md（自包含：读文档 → 接管检查 → 开发循环 → 批量构建 → 收尾）
```
- **不要**把节奏固定成「每 4 小时必须做一个域」——监工在轮内发现工人完成就立即接下一个（快域不排队）；
- 4 小时只是**兜底唤醒**（防整夜停摆），不是节奏。

## 5. 已知事故与教训（务必遵守）

| 事故 | 教训 |
|---|---|
| 2026-11-19 v2.27.2 构建会话写完文档后卡在「提交/tag」前 49 分钟 | 构建步骤必须**逐步写心跳**；监工在接管检查里核对工作区并接手收尾 |
| 文档提交连续 push 导致 test-main 反复 cancelled | 多个文档改动尽量**合并一次提交**；或给 test-main 加 `paths-ignore`（docs/**） |
| 工人改共用文档导致并行冲突 | 工人只提交代码/测试/QA 报告；发布文档由监工统一改 |
| 并行工人抢文件面 | 并行 ≤2 且按文件面分组；开工前查 ACTIVE-SESSIONS |
| 版本号被多个会话同时递增 | 版本只由监工在构建时递增（写进心跳）；禁止工人改 package.json |

## 6. 维护规则（所有者 2026-11-19 要求）

- 本技能是夜班机制的**唯一规范**：以后排查/解决夜班相关问题，必须**先更新本技能**，再同步 `docs/B4-QUEUE.md`；
- 技能改动后执行 `pwsh F:\dsh\gameprice-skills\sync.ps1` 同步镜像；
- 相关技能（dev/qa/build）已加引用：以监工/工人身份运行的会话，开工前先读本技能。
