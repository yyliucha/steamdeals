# QA：FW-3 403 软退出（exit 76）+ 预警节流 + 后台展示（第 1 轮）

> 基线 `dee8234` → HEAD `cde8ea9`（第 1 提交）+ `ee85ffb`（第 2 提交：全 Steam 任务通用补丁 + 基线遗留修正）。
> 判据：`docs/SLOW-SYNC.md` §1.3（决策 14~17）、§3.1（退出码 76）、§3.2（改动点表）、§3.4（日志事件）、
> §6.6（403 端到端）、§8「FW-3」7 条 + 通用项；开发描述来源：夜班监工 FW-3 交接单（自包含 8 项）。
> 结论：**✅ 放行** —— 通过 7 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | FW-3 | Steam 403 时任务**软收尾**：本轮进度保留、退出码 76、不记失败、不熔断、下一轮按正常间隔继续（不 1 小时后重排） | 调度器 / CLI 全部 Steam 任务 | ✅ | `src/soft-exit.js:15/25/35`；`src/cli.js:772-778`；真跑：`node src/cli.js heat --limit 1` → `EXIT=76` + `sync_runs=interrupted` |
| 2 | FW-3 | heat 撞 403 时**当前 appid 不写 `heat_at`**（退避后仍会被选中，进度只进不退） | `heat` 命令 | ✅ | `src/cli/ops.js:1021-1038`；真跑后 `games.heat_at` 仍为 null |
| 3 | FW-3 | 后台任务卡/任务表显示「部分完成」+「HTTP 403 收尾（进度已保留，下一轮继续）」 | 后台 → 游戏 → 任务 | ✅ | `frontend/src/pages/AdminModules.vue:101`（`partialReason(row)`）；`src/scheduler.js:394-400/1070` |
| 4 | FW-3 | 后台显示「403 冷却 · 剩余 N 分钟」info tag（桌面表格 + 移动卡片） | 同上 | ✅ | `AdminModules.vue:499` + 模板 4 处（组表/组卡/普通表/普通卡） |
| 5 | FW-3 | 后台显示「速率闸门 已用 N/M」info tag（桌面表格 + 移动卡片） | 同上 | ✅ | `AdminModules.vue:500` + 模板 4 处 |
| 6 | FW-3 | 403 预警邮件：连续 ≥3 次且距上次 ≥60 分钟才发 1 封；**discovery 类不再免告警** | 邮件（SMTP） | ✅（节流逻辑）/ 🔎（真发信） | `src/scheduler.js:660-705`（纯函数）/`1268-1288`（接线）；`test/scheduler.test.js:662` |
| 7 | FW-3 | 403 恢复通知：任务恢复成功且曾发过预警 → 发 1 封「403 已恢复」 | 邮件（SMTP） | ✅（逻辑）/ 🔎（真发信） | `src/scheduler.js:685/1294-1310`；`test/scheduler.test.js` 恢复断言 |
| 8 | FW-3 | 设置页「高级 → 调度与熔断」新增两项可调：403 预警连续次数阈值（默认 3）、预警最小间隔（默认 60 分钟） | 后台 → 系统设置 → 高级 → 调度与熔断 | ✅ | `src/settings.js:489/494`（def）+ `:117/118`（meta）；`test/settings.test.js:190` |
| 9 | FW-3 | 429（`COOLDOWN_ABORT`）语义**不变**：exit 75 + 1 小时重排（回归） | 调度器 / CLI | ✅ | `src/soft-exit.js:16`；`src/scheduler.js:471-479`；`test/scheduler.test.js:631`、`test/forbidden-soft-exit.test.js:30/51` |

## 逐条核对（规格 §8「FW-3」7 条 + 通用项）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行 / 命令 + 关键输出） | 判定 |
|---|---|---|---|---|
| 1 | heat 撞 403：`sync_runs` 记 interrupted（非 failed），进程 exit 76 | 纯函数 + 真 pglite + **真跑 CLI** | · `src/cli.js:772-778`：`softAbortExitCode(err)` → `finishSyncRunRecord(run, syncRunStatusFor(err))` → `applySoftAbort`<br>· 真跑（403 冷却文件 + 临时 pglite 库）：`node src/cli.js heat --limit 1 --sleep 1 --db pglite:…` → `WARN process.soft_abort … mode=heat code=FORBIDDEN_ROUND_END status=403 exitCode=76` / `EXIT=76`；库内 `sync_runs: heat \| interrupted \| Steam 返回 HTTP 403（appid 730）…`；`games.heat_at=null` | ✅ |
| 2 | 调度器 exit 76 → partial、`failures` 不增、连续 5 次 76 不熔断 | 单测（纯函数） | `src/scheduler.js:366`（75/76 同款不熔断）、`:418-427`（outcomeFor 76 → partial）；`test/scheduler.test.js:628-663`：连跑 5 次断言 `failures===2`、`openUntil===null`、`opened===false`；反向自检「真失败仍熔断」在同一用例 | ✅ |
| 3 | 76 **不写** `data/scheduler-retry.json`；已有条目要删掉 | 单测（纯函数） | `src/scheduler.js:465-470`（76 → `delete next[job]`）；`test/scheduler.test.js:658-666`：`applyRetry({}, {code:76})` → `{}`；`applyRetry({heat:{at,streak}}, {code:76})` → `{}`（旧 at 不会提前唤醒） | ✅ |
| 4 | 403 冷却期/全池被封期内任务**不请求 Steam**，直接软收尾 | 既有测试 + 新增判定 | · `test/sync-harden.test.js:251-282`：冷却期第二次调用 `err.code==='FORBIDDEN_COOLDOWN'` 且 `calls` 计数仍为 1（不发起请求）<br>· `test/forbidden-soft-exit.test.js:30`：`FORBIDDEN_COOLDOWN`（status 403）→ 76<br>· 真跑四任务时日志无任何 `http.request`（冷却文件 `@` 26~27 分钟后到期） | ✅ |
| 5 | 全 Steam 任务通用：`steam-prices`/`steam-status`/`backfill` 撞 403 同样 exit 76、不熔断 | **真跑四个 CLI** + 静态锁 | 同一 403 冷却文件下真跑：`steam-status` → `EXIT=76`（`code=FORBIDDEN_COOLDOWN`）、`heat` → 76（`FORBIDDEN_ROUND_END`）、`backfill` → 76（中间层重抛）、`sync steam-prices` → 76；库内四条 `sync_runs` 全 `interrupted`。第 1 轮曾发现 steam-status（failed）/backfill（exit 0）未走 76 → 第 2 提交补 `src/steam-status.js:212`、`src/adapters/steam-meta.js:23/240/258`、`src/cli/ops.js:517-522`（403 抛错），并加 `test/forbidden-soft-exit.test.js:131` 行为/静态锁 | ✅ |
| 6 | 预警节流：连续 3 次发第 1 封；60 分钟内不重复；恢复后发恢复通知；discovery 类**也发** | 单测（纯函数时序）+ 静态锁 | `src/scheduler.js:660-685`（`forbiddenAlertDecision`/`shouldNotifyForbiddenRecovered`）、`:1268-1310`（`scheduler.forbidden_alert` / `scheduler.forbidden_recovered`）、`:649`（取消 discovery 免告警）；`test/scheduler.test.js:662`：3 次发第 1 封 → 第 4/5 次（窗口内）不发 → 61 分钟后重新累计 3 次发第 2 封 → 恢复只发一次；`test/sync-harden.test.js:301-311`：`shouldAlert403('steam-discovery',99)===true`（改掉旧「永不告警」断言） | ✅ |
| 7 | 后台任务卡显示「部分完成 + 403 收尾原因」；`/api/admin/sync/status` 含 `forbidden:{count,until,remainingMin}` 与 `rateGate:{perMin,used}` | 接口测试（真 HTTP）+ 前端静态锁 + 构建 | · 接口：`src/routes/admin-sync.js:220-239`；`test/api.test.js:939`（真登录 + 真 HTTP）：无冷却 `active:false/count:0/until:null/remainingMin:0`、闸门满桶 `tokens=30/used=0`；写冷却后 `count=2/label=pool/remainingMin 1..5`、`tokens=12/used=18`；普通用户 403<br>· 前端：`AdminModules.vue:497-500` computed 读 `syncStatus.forbidden/rateGate`，模板 4 处 tag；「部分完成」复用既有 tag，`partialReason(row)` 取 `row.lastError = jobFailureError(76)`<br>· `test/forbidden-soft-exit.test.js:157`（DOM 级静态锁：两套模板都有 tag、文案逐字）<br>· `vite build` → `✓ built in 1.47s` | ✅ |
| 8 | 通用：不改表结构、不加依赖；日志事件 `域.动作`；主链（分段）+ `frontend:build` + `scan` 全绿 | 命令重跑 | `git diff dee8234..HEAD -- package.json` 只有 test:2 注册 1 行（无依赖变更）；事件名快照 `test/log-schema.test.js:34-45` 同步（删 `scheduler.discovery_forbidden`、加 `forbidden_alert/recovered/recovered_skipped`）；`scan-secrets` → `✅ 未发现高置信度凭据`；`vite build` → 通过；主链 4 段见「验证命令重跑」 | ✅ |

## 验证命令重跑（QA 侧亲自执行）

```powershell
$node='C:\Users\Administrator\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe'
```

| 命令 | 关键输出 |
|---|---|
| `& $node test/scheduler.test.js` | `ℹ tests 50` / `pass 50` / `fail 0` |
| `& $node test/forbidden-soft-exit.test.js` | `ℹ tests 6` / `pass 6` / `fail 0` |
| `& $node test/sync-harden.test.js` | `ℹ tests 22` / `pass 22` / `fail 0` |
| `& $node test/settings.test.js` | `ℹ tests 21` / `pass 21` / `fail 0`（含 `FW-3：403 预警节流 2 项…`） |
| `& $node test/rate-gate.test.js` | `ℹ tests 8` / `pass 8` / `fail 0` |
| `& $node test/api.test.js` | `ℹ tests 41` / `pass 41` / `fail 0`（含 `FW-3：/api/admin/sync/status 返回 forbidden…`） |
| `& $node test/steam-meta.test.js` / `steam-status.test.js` / `backfill.test.js` / `cli-ops.test.js` / `rating-backfill.test.js` / `backfill-throughput.test.js` | 依次 17/17、17/17、8/8、3/3、4/4、5/5 全绿 |
| 主链分段 `test:1 → test:2 → test:3 → test:4`（同一 `node`，`cmd /c` 串联） | `test:1`/`test:2`/`test:3` 全绿（exit 0）；`test:4` 曾因**基线遗留**红（`test/setup.test.js:86` 设置项计数停在 105——FW-2 只更新了 `settings.test.js`、漏了 setup schema 断言；FW-2 提交当时即红）→ 本次更新为 112 后 `test:4` 全绿（exit 0） |
| `& $node node_modules\vite\bin\vite.js build --config frontend/vite.config.js` | `✓ built in 1.47s` |
| `& $node scripts/scan-secrets.js` | `✅ 未发现高置信度凭据（token / 私钥 / 带真实密码的连接串）` |
| 真跑 4 个 Steam 任务（403 冷却文件 + 临时 pglite 库） | `EXIT steam-status=76 / heat=76 / backfill=76 / sync steam-prices=76`；`sync_runs` 四条全 `interrupted` |

## 打回清单（按严重度排序）

- 无。第 1 轮自检发现并已修复（见「复检记录」），复检通过。

## 需人工确认

1. **真实邮件发送**：本地无 SMTP/收件人，节流与恢复的「发/不发」由纯函数时序与日志事件锁住（`scheduler.forbidden_alert` / `scheduler.forbidden_recovered`），真发信需生产环境开任务失败邮件开关后目视 1 封。
2. **后台页面视觉**：按规格 §4「不新增页面、不重设计操作区，验收以接口字段 + DOM 断言为准」，本轮用接口测试 + 模板静态锁 + 构建通过验收；未做 headless 截图（新增信息仅为两个 info tag 与一列状态，不涉及布局重排）。

## 争议项（待所有者裁定）

- 无。

## 复检记录

- **第 1 轮（2026-11-26）**：人工核对 7 条验收时发现「全 Steam 任务通用」（第 5 条）不成立——`steam-status` 逐款循环与 `backfill` 中间层把 403 当「这款没数据」吞掉，真跑分别为 `exit 1 / failed` 与 `exit 0`；`fetchMetadata`（backfill/rename 共用）同样吞错。已补第 2 提交 `ee85ffb`：`src/steam-status.js:212`、`src/adapters/steam-meta.js:23/240/258`、`src/cli/ops.js:517-522`（403 抛错 → `runSyncTracked` 统一 76），并加 `test/forbidden-soft-exit.test.js:131`（fetchMetadata 真行为 + 三处接线静态锁）。复跑：四任务真跑全 76 + `sync_runs` 全 `interrupted`；主链 4 段全绿；`frontend:build` / `scan` 全绿 → 放行。
- **同轮附带修正基线遗留**：`test/setup.test.js:86` 的设置项计数停在 105（FW-2 加 5 项时漏改），导致基线 `dee8234` 的 `test:4` 就是红的；FW-3 加 2 项后一并更新为 112，`test:4` 复跑全绿（`ee85ffb`）。此项不影响 FW-3 判定，记录以免被误认为本轮引入。
