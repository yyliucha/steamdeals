# QA：CO-5/B4-2 cli 报表类域拆分（B4 #19，第 1 轮）

> 基线 9bc710a（#18 拆分提交）→ HEAD 2aa8b15（本批拆分提交）；判据 B4-QUEUE #19 行 + 监工派工消息 + ARCHITECTURE §15。
> 结论：✅ 放行 —— 通过 13 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

> 本批是**架构拆分（先抽出、后瘦身）**，用户视角功能 = CLI 命令入口本身，契约（命令名/参数/输出/退出码）零变化。
> 7 条命令全部冒烟实测（真实本地库）。

| # | 编号 | 功能（用户视角） | 入口（命令） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | B4#19 | 价格涨跌报表（含 --csv/--notify/--days） | `report price` | ✅ 已交付 | src/cli/report.js cmdReport；冒烟 exit 0 |
| 2 | B4#19 | 到价提醒检查（--mark/--json/--webhook，站点级+用户级投递） | `alerts` | ✅ 已交付 | src/cli/report.js cmdAlerts；冒烟 exit 0 |
| 3 | B4#19 | 数据量 + 采集健康度统计 | `stats` | ✅ 已交付 | src/cli/report.js cmdStats；冒烟输出与拆分前一致 |
| 4 | B4#19 | 价格轨迹（近 N 天最低价 + 史低判定） | `history <appid>` | ✅ 已交付 | src/cli/report.js cmdHistory；冒烟空态文案一致 |
| 5 | B4#19 | 主榜：各渠道最低价 | `list` | ✅ 已交付 | src/cli/report.js cmdList；冒烟表头/行格式一致 |
| 6 | B4#19 | 生成静态价格页 | `chart` | ✅ 已交付 | src/cli/report.js cmdChart；冒烟 53 款页面生成 |
| 7 | B4#19 | 多区服报价对比（--region/--json） | `compare <appid>` | ✅ 已交付 | src/cli/report.js cmdCompare；冒烟渲染一致 |
| 8 | B4#19 | 同步记录可见（alerts/report 写 sync_runs） | 控制台 → 同步记录 | ✅ 已交付 | cli.js TRACKED_COMMANDS 展开 reportDomain.trackedCommands |
| 9 | B4#19 | 帮助文案不变 | `node src/cli.js` | ✅ 已交付 | cli.js main() 帮助文本原样 |

## 逐条核对（规格验收 → 证据）

| # | 条目（派工验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 按 #18 轮归类拆报表类 7 命令，其余原地 | grep 注册表 | report/alerts/stats/history/list/chart/compare 拆走；watch/notify-test 等留宿主 | ✅ |
| 2 | 建 src/cli/report.js 导出命令定义 | read | createCliReport(ctx) 返回 commands(7) + trackedCommands(2) | ✅ |
| 3 | 域内联 SQL 抽 src/store/cli-report-repository.js | grep | compareGameBySteamAppid（cmdCompare 唯一内联 SQL 抽出）；其余 6 命令无内联 SQL（全走 db.* 函数） | ✅ |
| 4 | 禁改 pg.js/server.js/routes | git diff --name-only | 仅 cli.js + cli/report.js + cli-report-repository.js + 3 测试 + 本报告 | ✅ |
| 5 | 命令名/参数/输出/退出码零变化 | 冒烟 7 命令 | 全部正常执行，输出与拆分前一致（详见验证记录） | ✅ |
| 6 | 外部模块（report.js/alerts.js/compare.js/notify.js 等）不动 | git diff --name-only | 零 diff | ✅ |
| 7 | 三条锁：命令分支在新文件 / cli.js 接线 / 旧分支不残留 | read | test/cli-dispatch.test.js 测试 6-9 | ✅ |
| 8 | 反向自检 | 真跑 | 删 report.js cmdHistory → fail 1；删 cli.js reportDomain 展开 → fail 1；恢复均 9/9 绿 | ✅ |
| 9 | 既有静态断言改指新落点 | read | alerts-html.test.js / price-report-html.test.js 改指 src/cli/report.js | ✅ |
| 10 | 域相关测试全绿 | 真跑 | cli-dispatch 9/9、alerts-html 3/3、price-report-html 4/4、compare 7/7、report 14/14、alerts 8/8、notify 14/14 | ✅ |
| 11 | test:1~4（commit-own 4 项基线除外）+ api.test | 真跑 | 见验证记录 | ✅ |
| 12 | frontend:build（沙箱拦用 native 变体）+ scan | 真跑 | 见验证记录 | ✅ |
| 13 | 提交只含自己文件（pathspec，不用 git add -A） | git show --stat | 见验证记录 | ✅ |

## 边界判定（#19 轮，沿用 #18 轮归类）

**拆走（7 个命令）**：report、alerts、stats、history、list、chart、compare——B4-QUEUE #19「report/alerts 等」的「等」按 #18 轮归类补齐为全部「看数据/出报表」命令（stats/history/list/chart/compare 与 report/alerts 同一族：读库 + 终端/文件输出，无写库副作用；alerts 的 mark 属提醒状态回写、report 的 notify 属投递，均为既有行为）。

**留原地（判定理由）**：
- watch（关注列表增删管理，非报表展示）、notify-test（部署自检）、owned/interest/user（用户标记/管理）——用户数据操作，非报表；
- 其余 #20 运维类与基础设施命令与 #18 轮一致，原地不动。

**跨域共享对象（§15.4 判据）**：
- yuan / width / pad：cmdWatch（关注列表表格）、cmdMatch（对齐提案表）、cmdDiagnose（检查项对齐）等留宿主命令也在用 → 留 cli.js，经 ctx 传入 report.js（测试 8 锁定 ctx 组装行）；
- sparkline / BLOCKS：唯一使用者是 history 命令 → 随域移入 report.js（cli.js 不再残留，测试 9 锁定）；
- TRACKED_COMMANDS 语义：alerts/report 拆前就在 TRACKED_COMMANDS（写 sync_runs/fetch_runs）→ 域模块导出 trackedCommands，宿主展开（测试 8 锁定），注册表语义保持。

**repository 归属**：cli-report-repository.js 仅 1 个新函数（compareGameBySteamAppid，拆分前不存在、无旧消费者 → 不回填 pg.js、无 re-export）。其余 6 个命令原本就走 pg.js 的 db.* 函数（lowestOffers/priceHistory/isAtHistoricalLow/stats/priceChanges/priceChangeRows/priceChangesByDay/watchCandidates/markNotified/regionOffers），调用原样不动。

## 需人工确认

1. `test/cli-dispatch.test.js` 为历史遗留链外测试（README/DELIVERY 记载），未加主链——「不改 package.json」硬规则优先，本机单独跑 9/9 绿，是否纳入主链由监工定夺。
2. 主链 test:1 的 commit-own 4 项失败为本机沙箱环境基线（与 #18 轮及此前各轮一致）；frontend:build 默认命令被沙箱拦（vite configLoader spawn EPERM）改用 `--configLoader native` 变体；均由 CI 兜底。

## 打回清单

（无）

## 争议项

（无）

## 复检记录

- 第 1 轮（2026-11-20）：13/0/0/2 → ✅ 放行。

## 验证记录（真跑，长输出落 F:\dsh\gameprice\npmtest-wb1.log）

| 命令 | 结果 |
|---|---|
| `node test/cli-dispatch.test.js` | 9/9 全绿（原 5 项 + 本轮新增 4 项：报表实现不残留 / 注册表条目指域模块 / cli.js 接线+TRACKED 展开 / sparkline 随域） |
| `node test/alerts-html.test.js` | 3/3 全绿（CI-1 接线断言改指 src/cli/report.js） |
| `node test/price-report-html.test.js` | 4/4 全绿（CB-3 断言改指 src/cli/report.js，import 路径 ..） |
| `node test/compare.test.js` / `report.test.js` / `alerts.test.js` / `notify.test.js` | 7/7、14/14、8/8、14/14 全绿（相关模块测试） |
| 反向自检 1：删 report.js 的 cmdHistory 函数 | fail 1 → 恢复后 pass 9 ✓（测试真锁住） |
| 反向自检 2：删 cli.js 的 `...reportDomain.trackedCommands` 展开 | fail 1 → 恢复后 pass 9 ✓（测试真锁住） |
| 冒烟：`node src/cli.js`（帮助） | 帮助文本与拆分前一致，exit 0 |
| 冒烟：report/list/stats/history/compare/alerts/chart 七命令 | 全部正常执行：report 写 sync_runs exit 0、list 主榜表头/行格式一致、stats 统计输出一致、history 空态文案一致、compare 渲染一致、alerts exit 0、chart 生成 53 款价格页耗时 0.91s（输出目录仓库外，已清理） |
| `npm run test:1` | 仅 commit-own 4 项红（本机沙箱 spawn EPERM，与拆分前基线一致），其余全绿 |
| `npm run test:2` | 全绿 exit 0 |
| `npm run test:3` | 全绿 exit 0 |
| `npm run test:4` | 1 项红：images「AW 验收 1/2/3 总预算/超时兜底」真实网络抖动；单独复跑 `node test/images.test.js` 10/10 绿 |
| `node test/api.test.js` | 38/38 全绿 |
| `npm run frontend:build` | 默认命令被本机沙箱拦（vite configLoader `spawn EPERM`，与 #4–#18 轮同款环境限制）→ 等效变体 `npm run frontend:build -- --configLoader native` → ✓ built in 5.62s（前端零改动；CI 默认命令兜底） |
| `npm run scan` | ✅ 未发现高置信度凭据 |
| 提交 | pathspec 显式列出（见 git log），未碰他人未提交文件 |

拆分前后行数：`src/cli.js` 2128 → 1831（**净减 297 行**）；新文件 `src/cli/report.js` 333 行 + `src/store/cli-report-repository.js` 9 行；测试 +59/−343。
