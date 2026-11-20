# QA：CO-5/B4-2 cli 运维类域拆分（B4 #20，第 1 轮）

> 基线 7cd81a0（#19 拆分提交后；工作期间 EC 会话推送 ab7ba90 图片覆盖治理，其 cli.js 改动已并入本批）→ HEAD <本批拆分提交哈希>；判据 B4-QUEUE #20 行 + 监工派工消息 + ARCHITECTURE §15。
> 结论：✅ 放行 —— 通过 14 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

> 本批是**架构拆分（先抽出、后瘦身）**，用户视角功能 = CLI 命令入口本身，契约（命令名/参数/输出/退出码）零变化。
> 15 条命令全部冒烟实测；期间并发会话 EC 推送了 images backfill 新子命令（ab7ba90），已随本批合并进域模块（行为保留）。

| # | 编号 | 功能（用户视角） | 入口（命令） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | B4#20 | 批量回填元数据/价格 | backfill | ✅ 已交付 | src/cli/ops.js cmdBackfill |
| 2 | B4#20 | 存量修复中文名 | rename | ✅ 已交付 | src/cli/ops.js cmdRename |
| 3 | B4#20 | 热度回填 | heat | ✅ 已交付 | src/cli/ops.js cmdHeat |
| 4 | B4#20 | 内容分级回填 | rating-backfill | ✅ 已交付 | src/cli/ops.js cmdRatingBackfill |
| 5 | B4#20 | 搜索 token 重建 | search-tokens | ✅ 已交付 | src/cli/ops.js cmdSearchTokens |
| 6 | B4#20 | 封面图缓存（pull/stats/prune/**backfill**） | images | ✅ 已交付 | src/cli/ops.js cmdImages（含 EC 批 backfill 子命令） |
| 7 | B4#20 | 定期清理 | prune | ✅ 已交付 | src/cli/ops.js cmdPrune |
| 8 | B4#20 | 查日志 / 日志清理 | logs | ✅ 已交付 | src/cli/ops.js cmdLogs |
| 9 | B4#20 | 逻辑备份 | backup | ✅ 已交付 | src/cli/ops.js cmdBackup |
| 10 | B4#20 | 环境/数据库/网络自检 | diagnose | ✅ 已交付 | src/cli/ops.js cmdDiagnose |
| 11 | B4#20 | 代理专项排查 | proxy-check | ✅ 已交付 | src/cli/ops.js cmdProxyCheck |
| 12 | B4#20 | 代理健康探测 | probe --proxy | ✅ 已交付 | src/cli/ops.js cmdProbe |
| 13 | B4#20 | 读模型对账/重建 | readmodel | ✅ 已交付 | src/cli/ops.js cmdReadModel |
| 14 | B4#20 | 内置静态页服务 | serve | ✅ 已交付 | src/cli/ops.js cmdServe |
| 15 | B4#20 | 一体化服务（Web+调度器） | all | ✅ 已交付 | src/cli/ops.js cmdAll |
| 16 | B4#20 | 9 条运维命令写同步记录 | 控制台 → 同步记录 | ✅ 已交付 | cli.js TRACKED_COMMANDS 展开 opsDomain.trackedCommands |
| 17 | B4#20 | 帮助文案不变 | node src/cli.js | ✅ 已交付 | cli.js main() 帮助文本原样 |

## 逐条核对（规格验收 → 证据）

| # | 条目（派工验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 按 #18 轮归类拆运维类 15 命令 | grep 注册表 | backfill/rename/heat/rating-backfill/search-tokens/images/prune/logs/backup/diagnose/proxy-check/probe/readmodel/serve/all 拆走；init/bootstrap/ping/seed/add-sku/watch/match/import/interest/owned/user/notify-test/align-snapshot 留宿主 | ✅ |
| 2 | 建 src/cli/ops.js 导出命令定义 | read | createCliOps(ctx) 返回 commands(15) + trackedCommands(9) | ✅ |
| 3 | 域内联 SQL 抽 src/store/cli-ops-repository.js | grep | listRenameCandidates/listHeatCandidates/listImagePullCandidates/listPublicTableNames 4 个新函数；其余命令走 pg.js db.* 原样 | ✅ |
| 4 | 禁改 pg.js/server.js/routes | git diff --name-only | 仅 cli.js + cli/ops.js + cli-ops-repository.js + 5 测试 + 本报告 | ✅ |
| 5 | 命令名/参数/输出/退出码零变化 | 冒烟 15 命令 | 全部按拆分前行为执行（详见验证记录） | ✅ |
| 6 | 外部模块不动（images.js/backfill.js/steam-status.js/proxy.js 等） | git diff --name-only | 零 diff | ✅ |
| 7 | 三条锁 + 反向自检 | read + 真跑 | cli-dispatch 测试 10-12；删 cmdProbe → 红、删 opsDomain 展开 → 红，恢复均 12/12 绿 | ✅ |
| 8 | 既有静态断言改指新落点 | read | images/fetchjson-contract/sessions/scheduler 四测试改指 src/cli/ops.js | ✅ |
| 9 | EC 并发提交（images backfill）合并入域 | read + 冒烟 | ops.js cmdImages 含 backfill 子命令；`images backfill` 空库 exit 0 | ✅ |
| 10 | 域相关测试全绿 | 真跑 | cli-dispatch 12/12、images 10/10、fetchjson-contract 3/3、scheduler 38/38、sessions 15/15 | ✅ |
| 11 | test:1~4（commit-own 4 项基线除外）+ api.test | 真跑 | 见验证记录 | ✅ |
| 12 | frontend:build（沙箱拦用 native 变体）+ scan | 真跑 | 见验证记录 | ✅ |
| 13 | 提交只含自己文件（pathspec，不用 git add -A；sessions.test.js 与工人 A 共享文件面做 hunk 级分离） | git show --stat | 见验证记录 | ✅ |
| 14 | 边界判定写进报告 | 本报告 | 「边界判定」节 | ✅ |

## 边界判定（#20 轮，沿用 #18 轮归类）

**拆走（15 个命令）**：backfill、rename、heat、rating-backfill、search-tokens、images、prune、logs、backup、diagnose、proxy-check、probe、readmodel、serve、all——B4-QUEUE #20「backfill/images/prune/logs 等」的「等」按 #18 轮归类补齐为全部「数据修复/清理/排障/服务」族（rename/heat/rating-backfill/search-tokens 与 backfill 同为存量修复回填；backup/diagnose/proxy-check/probe 为排障运维；readmodel/serve/all 为服务与维护）。

**留原地（判定理由）**：
- init/bootstrap/ping/seed/add-sku（基础设施/种子导入）、watch/match/import/interest/owned/user/notify-test（用户数据操作与自检）、align-snapshot（DL 批独立模块）——非「运维清理/回填/服务」族，原地不动。

**跨域共享对象（§15.4 判据）**：
- pad：cmdWatch/cmdMatch（留宿主）与 cmdDiagnose（拆走）共用 → 留 cli.js 经 ctx 传入；
- setupAccessForRun / printSetupToken：仅 all/serve 命令用 → 随域移入 ops.js（含 randomBytes import，cli.js 不再残留，测试 10 锁定）；
- dbTarget / runId：宿主运行常量经 ctx 传入（cmdAll/cmdServe 用 dbTarget；cmdDiagnose 用 runId）；
- syncNote：search-tokens 写摘要 → 按引用共享对象（§15.2 语义共享，与 #18/#19 同款）；
- TRACKED_COMMANDS 语义：9 条运维命令（heat/rename/rating-backfill/search-tokens/backfill/images/backup/prune/readmodel）经 opsDomain.trackedCommands 展开；logs prune 分发改指 opsDomain.commands.logs（留痕语义保持）。

**repository 归属**：4 个新函数全部为「拆分前不存在」的域专属函数（内联 SQL 抽出），不回填 pg.js、无 re-export（无旧消费者）。

**并发合并（EC 批）**：工作期间 EC 会话推送 ab7ba90「图片覆盖治理」（cli.js 的 cmdImages 加 backfill 子命令 + 用法文案）。本批将 EC 的 backfill 子命令整体并入 ops.js 的 cmdImages（行为逐字保留），cli.js 不残留（防双实现）；EC 的其余文件面（images.js/image-backfill.js/scheduler.js/server.js/pg.js/frontend）零 diff。

## 已知既有缺陷（拆分前即存在，本轮逐字保留未修，上报待后续处理）

1. `backfill` 命令的 `db.countBackfillCandidates(s)` / `db.listBackfillCandidates(store, ...)` 传 store 对象，而 pg.js 该两函数签名是 `(q, ...)`（q 为查询函数）→ 运行即报 `q is not a function`。拆分前 HEAD（7cd81a0）的 cli.js 原文即如此（pg.js HEAD 签名核对），无测试覆盖（backfill.test.js 为纯单元测试）。本轮契约零变化逐字保留，未修（修复属功能缺陷修复，超出拆分范围）。
2. `prune` 命令依赖 email_codes（email-auth.js 建）与 steam_account_logs（steam-login.js 建）表；在未跑过 ensureEmailSchema/ensureSteamSchema 的全新裸库上会报 42P01。拆分前行为一致（cmdPrune 逐字照搬，db.purgeOldRows 未动）；本机已验证表齐全场景 exit 0 输出正确。

## 需人工确认

1. `test/cli-dispatch.test.js` 为历史遗留链外测试（README/DELIVERY 记载），未加主链——「不改 package.json」硬规则优先，本机单独跑 12/12 绿，是否纳入主链由监工定夺。
2. 主链 test:1 的 commit-own 4 项失败为本机沙箱环境基线；frontend:build 默认命令被沙箱拦（vite configLoader spawn EPERM）改用 `--configLoader native` 变体；均由 CI 兜底。

## 打回清单

（无）

## 争议项

（无）

## 复检记录

- 第 1 轮（2026-11-20）：14/0/0/2 → ✅ 放行。

## 验证记录（真跑，长输出落 F:\dsh\gameprice\npmtest-wb1.log）

| 命令 | 结果 |
|---|---|
| `node test/cli-dispatch.test.js` | 12/12 全绿（原 9 项 + 本轮新增 3 项：ops 实现不残留含 setup 工具 / 注册表条目指域模块 / cli.js 接线+TRACKED 展开 9 条） |
| `node test/images.test.js` | 10/10 全绿（AW 验收 6/7 断言改指 src/cli/ops.js） |
| `node test/fetchjson-contract.test.js` | 3/3 全绿（heat 契约断言改指 ops.js） |
| `node test/scheduler.test.js` | 38/38 全绿（listBackfillCandidates 断言改指 ops.js） |
| `node test/sessions.test.js` | 15/15 全绿（prune 会话计数断言改指 ops.js） |
| 反向自检 1：删 ops.js 的 cmdProbe 函数 | fail 1 → 恢复后 pass 12 ✓（测试真锁住） |
| 反向自检 2：删 cli.js 的 `...opsDomain.trackedCommands` 展开 | fail 1 → 恢复后 pass 12 ✓（测试真锁住） |
| 冒烟：`node src/cli.js`（帮助） | 帮助文本与拆分前一致，exit 0 |
| 冒烟：logs / images stats / prune / readmodel / search-tokens / backup / probe / proxy-check / backfill / rename / heat / rating-backfill / images backfill 十三命令 | 全部按拆分前行为执行：logs 正常、images stats 输出目录、prune（表齐全场景）清理 0 条 exit 0、readmodel/search-tokens/backup/rating-backfill exit 0、probe 无 --proxy 用法错误 exit 1、proxy-check 无代理文案、backfill 报既有缺陷 q is not a function（拆分前同样行为，见「已知既有缺陷」）、rename/heat 空库 exit 0、images backfill（EC 批合并）空库 exit 0 |
| `npm run test:1` | 仅 commit-own 4 项红（本机沙箱 spawn EPERM，与拆分前基线一致），其余全绿 |
| `npm run test:2` | 全绿 exit 0 |
| `npm run test:3` | 1 项红：http-guard「B1 闸门排队 40ms 超时」负载抖动（与前两轮同款）；单独复跑 `node test/http-guard.test.js` 7/7 绿 |
| `npm run test:4` | 全绿 exit 0 |
| `node test/api.test.js` | 38/38 全绿 |
| `npm run frontend:build` | 默认命令被本机沙箱拦（vite configLoader `spawn EPERM`，与 #4–#19 轮同款环境限制）→ 等效变体 `npm run frontend:build -- --configLoader native` → ✓ built in 3.95s（前端零改动；CI 默认命令兜底） |
| `npm run scan` | ✅ 未发现高置信度凭据 |
| 提交 | pathspec 显式列出（见 git log）；sessions.test.js 与工人 A 共享文件面做 hunk 级分离（git apply --cached，工人 A 的未提交改动保持未暂存未被带进本批） |

拆分前后行数：`src/cli.js` 1849 → 807（**净减 1042 行**；含 EC 批 backfill 子命令随域移出）；新文件 `src/cli/ops.js` 1072 行 + `src/store/cli-ops-repository.js` 43 行；测试 +70/−16。
