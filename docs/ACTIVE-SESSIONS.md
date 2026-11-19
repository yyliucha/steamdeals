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
| （示例）DL | src/align*.js、server.js(align 区)、AlignAdmin.vue | 无 | 11-20 09:00 | 11-20 18:00 | dev-DL |
| DN | src/align.js、src/server.js(align 区：computeAlignGroups/alignGroupCounts 调用点)、frontend/src/components/AlignAdmin.vue、test/{align,align-perf,api}.test.js | 无 | 11-19 11:00 | 11-19 13:00 | dev-DN(lead) |
| DQ | src/store/pg.js(profile 区)、src/server.js(profile/avatar 区，2191-3091)、frontend/src/pages/ProfilePage.vue、frontend/src/components/UserAvatar.vue、frontend/src/utils/avatar.js、test/profile.test.js、docs/PROFILE-UI-2026-11-19.md、docs/PROJECT-OVERVIEW.md；App 仓库 ui/profile、ui/me、data/api | Android 模拟器（cm35，DQ 验收用，用完即释放）+ 本地服务栈（8090 联调，用完即关） | 11-19 11:50 | 11-19 18:00 | dev-DQ(lead) |
| DP | test/e2e/lib/{browser,report}.mjs、test/e2e/runner.mjs、docs/E2E-SUITE.md、docs/TESTING-E2E.md | headless 浏览器报告 + 真实服务栈（仅 e2e:smoke 冒烟档） | 11-19 11:40 | 11-19 12:30 | dev-DP |
| DR | server.js(app-sync 区)、src/settings.js、frontend/src/pages/AdminModules.vue(同步与回填)、.dsh/skills/{steamdeals-app-build,steamdeals-build}；App 仓库 UpdateManager.kt + UpdateManagerTest.kt | 无 | 11-19 11:45 | 11-19 18:00 | dev-DR(lead) |

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
