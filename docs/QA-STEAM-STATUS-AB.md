# QA：AB——Steam 状态判定整轮静默不写库（第 1 轮）

> 基线 `e192cd1` → 交付 `e432d2f`；判据 [docs/STEAM-STATUS-FIX.md](STEAM-STATUS-FIX.md) §4 影响面 + §5 验收九条；TODO 条目 AB（含 Y）。
> 结论：**✅ 放行 —— 通过 12 / 缺失 0 / 偏差 0 / 需人工确认 2**

| # | 条目 | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | A：取 appdetails 条目改 `.json[appid]`（cn/hk 两处） | grep `\.json\?\.\[String\(appid\)\]` | steam-status.js `runSteamStatusRound` 内 cn/hk 各一处 | ✅ |
| 2 | B：写入不可静默——wrote 只计真写入，skip_write/write_miss 可观测 | grep `wroteStatus\|skip_write\|write_miss` | steam-status.js：applySteamDetails 返回 `status != null && row != null`；round 里 wrote/skipped 分支 + debug/warn 日志 | ✅ |
| 3 | B：收尾「全跳过必须报错」 | grep `未写入任何数据` | cli.js `cmdSteamStatus`：`wrote === 0 && attempted > 0` 抛错 | ✅ |
| 4 | B：counts 只统计已知状态 | grep `counts\[outcome.status\]` | steam-status.js：仅在 `outcome.wroteStatus` 分支计入 | ✅ |
| 5 | B：空数组/空对象不覆盖已有分级 | grep `descriptorIds.length > 0` | steam-status.js applySteamDetails：空→传 null | ✅ |
| 6 | C：限速按每请求计（cn/hk 各 sleep）+ 非 429 的 4xx 也 sleep | grep `await sleep\(rateMs\)` | steam-status.js：3 处（cn 后 / hk 后 / 异常路径） | ✅ |
| 7 | C：429 立即收轮 | grep `aborted429` | steam-status.js：429 置位 break，外层 while 检查 | ✅ |
| 8 | C+G：limit 默认 12000→6000（settings + scheduler + README） | grep `6000` | settings.js / scheduler.js 默认 6000；README 环境变量行 6000；spec §7 标注部署需同步系统设置 | ✅ |
| 9 | D：整轮复用连接 | 读 cmdSteamStatus | cli.js：`withStore` 一次，`runSteamStatusRound(q, …)` 循环内复用 q | ✅ |
| 10 | E：每轮写 sync_runs | grep `runSyncTracked\('steam-status'` | cli.js main()：`steam-status` 走 runSyncTracked | ✅ |
| 11 | F：`steamStatus.initialDelaySec` 设置项（原 Y） | grep `initialDelaySec` | settings.js def（env `STEAM_STATUS_INITIAL_DELAY_SEC`，默认 600）；scheduler 读 env | ✅ |
| 12 | 测试真锁住：取值/不写库/write_miss/空数组不覆盖/429 收轮/水合/默认值 | 单跑 + 主链 | `test/steam-status.test.js` 13 项（新增 3 项：写入未命中、空数组不覆盖、runSteamStatusRound 四态）；`test/scheduler.test.js` 23 项（AB 环境变量用例）；`test/settings.test.js` 8 项（57 项定义 + 水合 1800）；`test/setup.test.js` 4 项（fields 57） | ✅ |
| 13 | §5.8 验证重跑 | 命令输出 | `npm test` EXIT=0（51 文件全绿）；`frontend:build` EXIT=0（1.42s）；`scan` EXIT=0 | ✅ |
| 14 | §5.9 不自行打 tag | git tag | 无新增 tag（v1.16.3 为上一版发布 tag） | ✅ |

## 需人工确认（本地无法验证，部署后执行）

1. §5.1/5.4/5.7：`node src/cli.js steam-status --limit 20` 后抽查这批 appid 的 `steam_status`/`steam_checked_at` 都有值、`steam-status.done` 的 `wrote` 与库内变化一致、请求间隔 ≥ rate、指标卡「未探测」下降量 = wrote。本机无 Steam 出口，需在服务器或部署后验证。
2. §7.1：`steamStatus.limit` 库内已保存值会覆盖代码默认——部署后需在「系统设置 → 数据源与采集」把 12000 同步改为 6000（或告知我改），否则默认值调整不生效。

## 查多（需求外改动）

- README 环境变量行把过期的默认值（10080/8000/21600）修正为当前实际（1440/6000/600）——属文档一致性修正，与 AB 直接相关，记录。
- 需求会话留下的台账文档（HANDOVER/REQUIREMENTS-INDEX/各规格）随本次入库（42ebf6d）——为「唯一事实来源」落地，非代码改动。

## 复检记录

第 1 轮（2026-11-06）：无打回项，✅ 放行（2 项转线上验收）。

第 2 轮（2026-11-06，独立复核，范围 = TODO AB 条目；基线 07ee88a → 复核时 HEAD 08a110c）：

- 复核期间并发会话完成发版：`08a110c release: v1.16.4`（tag `v1.16.4`），TODO/REQUIREMENTS-INDEX 的 AB 状态已由该会话改为「已发布 v1.16.4」——与本轮结论一致，质检侧不再重复回写。
- 独立重读实现与测试：A（`cn?.json?.[appid]`/hk 同）、B（`wroteStatus = status != null && row != null`、
  `skip_write` debug / `write_miss` warn、`wrote===0 && attempted>0` 抛错、空数组/空对象传 null）、
  C（cn/hk/异常路径各 sleep、429 → `aborted429` + 收轮）、D（cli 一次 `withStore`，`runSteamStatusRound(q)` 复用）、
  E（`runSyncTracked('steam-status')` 写 sync_runs）、F（settings 新增 `steamStatus.initialDelaySec`，57 项）、
  G（limit 6000 默认 + 文档提醒库值覆盖）——与第 1 轮结论一致，无新发现缺失/偏差。
- 测试真锁住复核：`test/steam-status.test.js` 13/13（含「无条目不写库不推游标」「429 收轮」「空数组不覆盖」
  「写入未命中 wroteStatus=false」）；`scheduler`/`settings`/`setup` 断言同步。
- 重跑验证：`npm test` → 51 文件 / 437 项 / fail 0；`npm run frontend:build` → ✓ 1.47s；`npm run scan` → 无高置信度凭据。
  （重跑时工作区存在并发会话的 AD 批未提交改动，测试仍全绿。）
- 纪律复核：`frontend/dist` 等产物未入库；diff 未碰部署/凭据；PROJECT-OVERVIEW/README/DELIVERY 已同步；
  `v1.16.4` tag 由并发会话的 release commit 产生（非本质检会话操作）。
- 结论：**✅ 放行**（与第 1 轮一致；2 项仍需线上验证：§5.1/5.4/5.7 真机写入与限速、§7.1 库里
  `steamStatus.limit` 旧值需在系统设置同步为 6000）。
