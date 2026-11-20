# QA：CO-5/B4-2 cli 同步类域拆分（B4 #18，第 1 轮）

> 基线 7bce0b6 → HEAD 9bc710a（拆分提交）；判据 B4-QUEUE #18 行 + 任务书（B4 夜班工人 B prompt）+ ARCHITECTURE §15。
> 结论：✅ 放行 —— 通过 15 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

> 本批是**架构拆分（先抽出、后瘦身）**，用户视角功能 = CLI 命令入口本身，契约（命令名/参数/输出/退出码）零变化。
> 每条命令都验证了「入口仍可调、行为与拆分前一致」。

| # | 编号 | 功能（用户视角） | 入口（命令） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | B4#18 | 一键同步（各源串行 + 页面重建） | `node src/cli.js sync all` | ✅ 已交付 | src/cli/sync.js cmdSyncAll |
| 2 | B4#18 | 拉取 Steam 国区价格 | `sync steam` | ✅ 已交付 | src/cli/sync.js cmdSyncSteam |
| 3 | B4#18 | 每日刷新已有 Steam 报价（热点优先） | `sync steam-prices` | ✅ 已交付 | src/cli/sync.js cmdSyncSteamPrices |
| 4 | B4#18 | 补元数据/说明/价格 + 封面图 | `sync steamall` | ✅ 已交付 | src/cli/sync.js cmdSyncSteamAll |
| 5 | B4#18 | 导入 Steam 全量应用目录 | `sync catalog` | ✅ 已交付 | src/cli/sync.js cmdImportSteamCatalog |
| 6 | B4#18 | 按 SKU 抓杉果价格 + 收尾自动匹配 | `sync sonkwo` | ✅ 已交付 | src/cli/sync.js cmdSyncSonkwo |
| 7 | B4#18 | 走 ITAD 官方 API 取价 | `sync itad` | ✅ 已交付 | src/cli/sync.js cmdSyncItad |
| 8 | B4#18 | 按英文名查 GOG 商店 | `sync gog` | ✅ 已交付 | src/cli/sync.js cmdSyncGog |
| 9 | B4#18 | 按英文名探测 Humble 商品页 | `sync humble` | ✅ 已交付 | src/cli/sync.js cmdSyncHumble |
| 10 | B4#18 | 同步所有已绑定 Steam 账号库+愿望单 | `steam-accounts` | ✅ 已交付 | src/cli/sync.js cmdSteamAccounts |
| 11 | B4#18 | 认领未归属 Steam 账号（迁移） | `steam-claim` | ✅ 已交付 | src/cli/sync.js cmdSteamClaim |
| 12 | B4#18 | App Release 同步（失败显红） | `app-sync` | ✅ 已交付 | src/cli/sync.js cmdAppSync |
| 13 | B4#18 | Steam 发现轮 | `steam-discovery` | ✅ 已交付 | src/cli/sync.js cmdSteamDiscovery |
| 14 | B4#18 | Steam 同步状态判定 + 内容分级 | `steam-status` | ✅ 已交付 | src/cli/sync.js cmdSteamStatus |
| 15 | B4#18 | 自动发现杉果 SKU | `discover sonkwo` | ✅ 已交付 | src/cli/sync.js cmdDiscover |
| 16 | B4#18 | 同步记录可见（sync_runs + fetch_runs） | 控制台 → 同步记录 | ✅ 已交付 | cli.js TRACKED_COMMANDS 展开域 trackedCommands |
| 17 | B4#18 | 用法帮助文案不变 | `node src/cli.js` | ✅ 已交付 | cli.js main() 帮助文本原样 |

## 逐条核对（规格验收 → 证据）

| # | 条目（任务书验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 盘点全部命令归类；只拆同步类，报表/运维原地 | grep 注册表 + 逐命令归位 | cli.js commands 40 键；拆走 17 入口（sync 9 target + 7 命令 + steam-claim），#19/#20 全部留 cli.js | ✅ |
| 2 | 建 src/cli/sync.js 导出命令定义；cli.js 只留装配 | read + grep | src/cli/sync.js createCliSync(ctx)；cli.js syncDomain 装配 | ✅ |
| 3 | TRACKED_COMMANDS 注册表语义保持 | grep | cli.js `...syncDomain.trackedCommands` + 全部 16 键在表 | ✅ |
| 4 | 域内联 SQL 抽 cli-sync-repository（9 函数）；禁改 pg.js/server.js/routes | git diff --name-only | 仅 cli.js/cli/sync.js/cli-sync-repository.js + 7 个测试 + 本报告；pg.js/server.js/routes 零 diff | ✅ |
| 5 | cli 对 pg.js 现有 db.* 调用不动（无 re-export 需求） | grep | sync.js 仍 `db.startFetchRun/finishFetchRun/importCatalogGames/...` 原样 | ✅ |
| 6 | 契约零变化：命令名/参数/输出/退出码 | 冒烟 | `node src/cli.js` 帮助原样；`sync bogus` 用法错误 + exit 1；`sync itad` 无 key 跳过 exit 0 | ✅ |
| 7 | 外部模块（steam-accounts/steam-status/discovery 等）不动 | git diff --name-only | 无外部模块文件 | ✅ |
| 8 | 测试三条锁：分支在新文件 / cli.js 接线 / 旧分支不残留 | read | test/cli-dispatch.test.js 5 项 | ✅ |
| 9 | 反向自检：删分支→红→恢复 | 真跑 | 删 `target === 'steam'` → fail 1；删 dispatchSync 接线 → fail 1；恢复均 pass 5 | ✅ |
| 10 | 域相关测试全绿 | 真跑 | cli-dispatch 5/5、app-release-sync 7/7、scheduler 38/38、steam-prices-priority 3/3、source-sync 5/5、wishlist-site-only 5/5、align 11/11 | ✅ |
| 11 | test:1~4 全绿（commit-own 4 项基线除外） | 真跑 | test:1 仅 commit-own 4 红（基线）；test:2/3/4 全绿（test:3 http-guard B1 闸门 40ms 超时属负载抖动，单独复跑 7/7 绿） | ✅ |
| 12 | api.test.js 全绿 | 真跑 | 见「验证记录」 | ✅ |
| 13 | frontend:build + scan | 真跑 | 见「验证记录」 | ✅ |
| 14 | 提交只含自己文件（pathspec） | git show --stat | 见「验证记录」 | ✅ |
| 15 | 边界判定写进报告 | 本报告 | 「边界判定」节 | ✅ |

## 边界判定（本轮 cli 拆分约定，首次执行）

**拆走（#18 同步类，17 个命令入口）**：
- `sync` 全家族 9 个 target：all / steam / steam-prices / steamall / catalog / sonkwo / itad / gog / humble；
- `steam-accounts`、`steam-claim`（B4-QUEUE #18 点名；steam-claim 是 steam-accounts 的配套迁移命令，同一外部模块、调度器同族任务）；
- `app-sync`、`steam-discovery`、`steam-status`、`discover`（TRACKED_COMMANDS 内注释自证「同步/发现」语义：App Release 同步 / Steam 发现 / Steam 同步状态判定；discover 是杉果采集前道，scheduler 每日任务）。

**留原地（#19/#20/其它，全部未动）**：
- #19 报表类：report、alerts、stats、history、list、chart、compare；
- #20 运维类：backfill、rename、heat、rating-backfill、search-tokens、images、prune、logs、backup、diagnose、proxy-check、probe、readmodel、serve、all；
- 其它（基础设施/用户标记/对齐）：init、bootstrap、ping、seed、add-sku、watch、match、import、interest、owned、user、notify-test、align-snapshot。

**跨域共享对象（按 §15.4 判据留宿主，ctx 传引用）**：
- `runSyncTracked` + `beginSyncRunRecord`/`finishSyncRunRecord`/`beginFetchRunRecord`/`finishFetchRunRecord`：TRACKED_COMMANDS 通用包装（#19/#20 命令也走它）→ 留 cli.js，经 ctx 传入 sync.js；
- `applySkuMapping`：cmdMatch（留原地）与 runSonkwoMatchStep（拆走）共用 → 留 cli.js 经 ctx 传引用（语义共享）；其内联 SQL 抽到 cli-sync-repository.js（gameBySteamAppid / sonkwoAliasGameId / gameAppidRowById）；
- `syncNote` 摘要字符串：拆前是 cli.js 顶层 `let syncNote`，拆后域命令也要写 → 改为 `const syncNote = { note: '' }` 按引用共享（§15.2 语义共享注释），runSyncTracked 读 `.note`；留原地的 search-tokens / align-snapshot 写入点同步改 `.note`（仅赋值目标变更，输出契约不变）。

**repository 归属**：9 个新函数全部是「拆分前不存在」的域专属函数（内联 SQL 抽出），因此按任务约定**不回填 pg.js、无 re-export**（无旧消费者）。cli 命令对 pg.js 现有 `db.*` 函数的调用全部保持原样（sync.js 与 cli.js 各自 import pg.js）。

## 需人工确认

1. `test/cli-dispatch.test.js` 是历史遗留「链外」测试（README/DELIVERY 记载：主链 `npm test` 之外的 3 个链外文件之一），本轮未加入主链——**硬规则「不改 package.json」优先**，是否纳入主链由监工/后续批次决定；本机已单独跑 5/5 绿。
2. 主链 test:1 的 commit-own 4 项失败与 test:3 http-guard B1 闸门 40ms 超时均为本机沙箱环境/负载基线（B4-QUEUE 备注与 DELIVERY 均有记载；http-guard 单独复跑 7/7 绿），由 CI 兜底。

## 打回清单

（无）

## 争议项

（无）

## 复检记录

- 第 1 轮（2026-11-20）：15/0/0/2 → ✅ 放行。

## 验证记录（真跑，长输出落 F:\dsh\gameprice\npmtest-wb1.log）

| 命令 | 结果 |
|---|---|
| `node test/cli-dispatch.test.js` | 5/5 全绿（新 5 项：调度目标指新文件+不残留 / 全家族完整 / steamall 实现分发共存 / cli.js 接线防死模块 / 17 实现不残留防双实现） |
| `node test/app-release-sync.test.js` | 7/7 全绿（2 处断言改指 sync.js + 接线断言） |
| `node test/scheduler.test.js` | 38/38 全绿（steamall 排序锁改指 repository） |
| `node test/steam-prices-priority.test.js` | 3/3 全绿（改指 sync.js + repository） |
| `node test/source-sync.test.js` | 5/5 全绿（四源契约改指 sync.js） |
| `node test/wishlist-site-only.test.js` | 5/5 全绿（账号 key 查询改指 repository） |
| `node test/align.test.js` | 11/11 全绿（CD 接线/A3 断言改指 sync.js） |
| 反向自检 1：删 sync.js `target === 'steam'` 分支 | fail 1 → 恢复后 pass 5 ✓（测试真锁住） |
| 反向自检 2：删 cli.js `return syncDomain.dispatchSync();` 接线 | fail 1 → 恢复后 pass 5 ✓（测试真锁住） |
| 冒烟：`node src/cli.js`（帮助） | 帮助文本与拆分前一致，exit 0 |
| 冒烟：`node src/cli.js sync bogus` | 完整用法错误文案 + exit 1（契约不变） |
| 冒烟：`node src/cli.js sync itad --db pglite:./data/cliqa-tmp-pgdata` | 「未配置 ITAD_API_KEY，跳过」+ runSyncTracked 写 sync_runs 链路正常 + exit 0（临时库已删） |
| `npm run test:1` | 仅 commit-own 4 项红（本机沙箱 spawn EPERM，与拆分前基线一致），其余全绿 |
| `npm run test:2` | 全绿 exit 0 |
| `npm run test:3` | 1 项红：http-guard「B1 闸门排队 40ms 超时」负载抖动；单独复跑 `node test/http-guard.test.js` 7/7 绿 |
| `npm run test:4` | 全绿 exit 0 |
| `node test/api.test.js` | 38/38 全绿 |
| `npm run frontend:build` | 默认命令被本机沙箱拦（vite configLoader `spawn EPERM`，与 #4–#9 轮同款环境限制）→ 等效变体 `npm run frontend:build -- --configLoader native` → ✓ built in 3.00s（前端零改动；CI 默认命令兜底） |
| `npm run scan` | 750 文件，✅ 无高置信度凭据 |
| 提交 | pathspec 显式列出（见 git log），未碰他人未提交文件 |

拆分前后行数：`src/cli.js` 3026 → 2128（**净减 898 行**）；新文件 `src/cli/sync.js` 924 行 + `src/store/cli-sync-repository.js` 84 行；测试 +163/−1031（cli.js 大删）。
