# Steam 状态判定修复：JSON 取错导致整轮静默不写库（已确认待开发）

> 状态：**已实现并发布 v1.16.4（2026-11-06）**。
> 关联：[STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md)（V 批 / `steam-status` 任务）、
> [SCHEDULER-BLOCKING-FIX.md](SCHEDULER-BLOCKING-FIX.md)（X 批，调度器）、[TODO.md](TODO.md) 的 AB 条目。

## 1. 现象（生产实测，2026-11-06）

| 观测 | 值 |
|---|---|
| `steam-status` 启动 | 12:39:16，`running: true`，`--limit 12000 --rate 1500` |
| 12:39–13:18 请求 | 持续 200 响应、`via=steam-proxy`，每个 appid 成对请求 `cc=cn` + `cc=hk` |
| 库内结果 | `近24h判定 = 0`；`max(steam_checked_at) = 2026-11-04` |
| 抽查 appid（13620/15000/15390/15400） | `steam_status = null`、`steam_checked_at = null`——**请求明明成功过** |
| 失败日志 | `grep -c 'steam-status.failed' = 0` |
| 指标卡 | 未探测 175,138 / 国区不可售 331，一晚几乎没动 |

**结论**：不是网络失败、不是 SQL 报错，是**整轮请求成功但一条都没写库**。

## 2. 根因

### P0-1（真因）取 appdetails 条目时少取 `.json`

`src/cli.js:2179` 与 `:2189`：

```js
const cn = await fetchJson(url, {...});   // 返回 { ...res, json: JSON.parse(body) }
const cnEntry = cn?.[String(appid)];      // ← 恒为 undefined（应取 cn.json[appid]）
...
hkEntry = hk?.[String(appid)];            // ← 同样错误
```

`src/http.js:366-369` 明确返回 `{ ...res, json: <解析结果> }`。

后续链路因此全部空转：

1. `let data = cnEntry?.success === true ? cnEntry.data : null;` → `null`；
2. `applySteamDetails(q, { cnEntry: undefined, hkEntry: undefined, meta: null })`；
3. 函数内 `cnEntry == null && hkEntry == null` 成立（`undefined == null` 为真）→ `status = null`；
4. `hasRating = false` → 直接 `return { wroteStatus: false }`，**不写库、不记日志**（`src/steam-status.js:44-47`）；
5. `cli.js` 仍然 `done += 1`、`counts[status]++`（undefined 键）→ 看起来跑满了 limit，实际 0 行写入。

### P0-2 请求率超 Steam 配额，429 后整轮睡 30 分钟

- 每行最多 2 个请求（cn + hk），但 `sleep(rateMs)` 只在**每行结束**执行一次（`cli.js:2214`）；
- `rate=1500ms` ⇒ 约 **2 请求 / 1.5–2s ≈ 60–80 次/分钟 ≈ 300–400 次/5 分钟**，Steam 配额是 **200 次/5 分钟**，翻倍超限；
- 实测 13:18:08 命中 429，`http.js:55` 的 `STEAM_429_COOLDOWN_MS = 30 分钟` → 进程睡 30 分钟，表现为"一晚上没动"；
- `cli.js:2205-2213` 的 429 分支 `break` 只跳内层 `for`，外层 `while` 仍会继续（真正执行到之前通常已被 http 层冷却拦下）。

### P1-1 每条判定都新建数据库连接

`cli.js:2196` 在逐条循环里 `withStore(...)`，而 `withStore` 每次 `openStore` + `ensureSchema` 探测 + `close`；
`cmdBackfill` 是每批一次（`cli.js:1772`）。12000 条 = 24000 次连接池开/关。

### P1-2 写库静默 no-op 不可观测

`db.setSteamStatus`（`src/store/pg.js:2130`）在 `update ... where steam_appid=$1` 未命中时返回 `null`，
调用方 `applySteamDetails` 不看返回值，`wroteStatus` 仍可能为 true；`cmdSteamStatus` 也不校验。
结果就是"一行 SQL 都没生效，但没有任何日志能看出来"。

## 2.5 同链路审计：追加发现（2026-11-06，静态审查）

| # | 位置 | 问题 | 影响 |
|---|---|---|---|
| 1 | `cli.js:2197` | `const outcome = await withStore(...)` 的 `outcome` **从未被使用** | `wroteStatus` 信息被丢弃，无法判断"没写" |
| 2 | `cli.js:2218-2226` | 非 429 的 4xx 走 `continue`，**跳过行末的 `sleep(rateMs)`** | 4xx 连续命中时无间隔连发，进一步触发 429 |
| 3 | `cli.js:2201-2202` | `counts[status]++; done++;` 不看是否真的写库 | 日志/汇总显示"判定了几百款"，库里 0 行（本次现象的直接表现） |
| 4 | `cli.js:2231` | `if (done === 0 && failed > 0) throw` | 修复后若"全部 status=null 未写入且无异常"，仍会以 0 退出，问题再次被隐藏 |
| 5 | `steam-status.js` | `hasRating` 为真但 `descriptorIds` 为空数组时，写入 `content_descriptors = '{}'` | 会把已有分级覆盖成空（`coalesce` 只挡 `null`，挡不住空数组） |
| 6 | `cli.js:2182-2190` | 国区 `success:false` 时**每行都补一次 hk 请求** | 平均 2 请求/行，是超配额的直接原因（配合 P0-2） |
| 7 | 待验证 | `setSteamStatus` 的 `content_descriptors = coalesce($n, ...)` 未显式 `::int[]` | 该写入路径**从未真正执行过**（被 P0-1 挡住），首次修复后可能暴露参数类型问题，必须在 `--limit 20` 验收时确认 |

> 第 7 条是"踩过才信"的典型：P0-1 让整条写入路径空转，任何潜在的参数/类型问题都被掩盖了。
> 验收必须**真的写进去**再断言，不能只看命令退出码。

## 3. 方案

### A. 修 JSON 取值（P0，真因）

```js
const cnEntry = cn?.json?.[String(appid)] ?? null;
...
hkEntry = hk?.json?.[String(appid)] ?? null;
```

同时把 `cli.js` 里的 `data` 判定改为 `cnEntry?.success === true && cnEntry.data` 的显式写法，避免 undefined 污染。

### B. 写入不可静默（P0）

- `applySteamDetails`：`status == null` 时返回 `wroteStatus: false`；**只有 `setSteamStatus` 返回非 null** 时才算写成功；
- `cmdSteamStatus` 必须**使用 `outcome`**（现在是死变量）：`done += 1` 只在 `outcome.wroteStatus` 为真时执行；
  否则计入 `skipped` 并记一条 `steam-status.skip_write { appid, reason: 'status_unknown' }`（debug 级，避免刷屏）；
- `setSteamStatus` 返回 `null` 时记 `steam-status.write_miss { appid, status }`（warn）；
- 结算日志与 `steam-status.done` 增加 `wrote / skipped / failed` 三个字段，`counts` 只统计已知状态；
- **空数组不覆盖**：`applySteamDetails` 在 `descriptorIds.length === 0` 时传 `null` 而不是 `[]`，
  避免 `coalesce` 把已有分级清空（`steam-status.js` 的 `hasRating` 判定同步调整）；
- 收尾条件改为：`wrote === 0 && attempted > 0` → 抛错（不只判 `done === 0 && failed > 0`），
  确保"全部没写进去"再也不会静默通过。

### C. 限速按「每个请求」计，并按配额收缩单轮上限（P0）

- `sleep(rateMs)` 移到 `fetchJson` 之后（cn 之后一次、hk 之后一次），保证**每个请求间隔 ≥ rate**；
- **非 429 的 4xx 异常路径也必须 sleep**（现在是 `continue` 直接跳过，等于无间隔连发）；
- `rate` 默认 1500ms 维持（1 请求/1.5s = 2400 次/小时 = 正好 200 次/5 分钟）；
- 因平均 ~2 请求/行，`steamStatus.limit` 默认 **12000 → 6000**（约 5 小时/轮），避免单轮拖过夜；
- 429：本轮**直接结束**（`return`，不 sleep、不空转），记录 `done/failed` 与原因，交给下一轮续跑。

### D. 连接提到循环外（P1）

`cmdSteamStatus` 参照 `cmdBackfill` 的写法：整轮 `withStore` 一次，循环内复用同一个 `q`。

### F. 补 `steamStatus.initialDelaySec` 设置项（原 Y 批，并入本批）

- **问题**：X 批把 `steam-status` 首轮延迟从 21600s 改成 600s，但**只改代码默认、没加设置项**；
  其它任务都有 `*.initialDelaySec`，`steam-status` 漏了 → 线上只能在 compose 改环境变量并重启。
- **改动**：`src/settings.js` 加
  `def('steamStatus.initialDelaySec', 'STEAM_STATUS_INITIAL_DELAY_SEC', 'sources', 'Steam 状态判定首轮延迟（秒）', 'int', 600, { min: 0, max: 86400, advanced: true })`；
  `test/settings.test.js` 断言存在/默认 600/DB 值能水合到 env；`test/scheduler.test.js` 断言 `jobsFromEnv` 读该变量；
  `docs/DELIVERY.md` 环境变量表补一行（前端按 schema 自动渲染，无需改页面）。
- **验收**：设置页出现该项；保存后热加载生效；默认 600。

### G. 设置默认值同步提醒

`steamStatus.limit` 默认若改 6000（§7 待确认），**必须同时在「系统设置 → 数据源」把库里现有的 12000 改掉**，
否则 DB 值覆盖默认值，改了代码也不生效（同 `initialDelaySec` 的教训）。
### E. 每轮落一条 `sync_runs`（P2，可观测）

开始写 running、结束写 ok/failed + 汇总，让后台「同步记录」能看到 `steam-status` 每轮实际判定量。

## 4. 影响面

| 文件 | 改动 |
|---|---|
| `src/cli.js` | `:2179`、`:2189` 取 `.json`；`:2196` 连接提到循环外；`:2205` 429 结束整轮；`:2214` 限速改为每请求；`done` 只在 `wroteStatus` 时递增；补 `write_miss`/`unknown` 计数；每轮写 `sync_runs` |
| `src/steam-status.js` | `applySteamDetails` 返回值语义收紧（`wroteStatus` 只在状态真的写了才 true） |
| `src/store/pg.js` | `setSteamStatus` 保留返回行；未命中由调用方记日志（不改 SQL 语义） |
| `src/settings.js` | `steamStatus.limit` 默认 12000 → 6000；新增 `steamStatus.initialDelaySec`（§3-F） |
| `test/steam-status.test.js` | 新增用例：`cn.json` 取值、undefined 条目不写库、`wroteStatus=false` 不计入 done、429 结束整轮（纯函数/桩） |

## 5. 验收

1. 手动跑一小批（如 `--limit 20`）后，抽查这批 appid 的 `steam_status` 与 `steam_checked_at` **都有值**；
2. `steam-status.done` 日志里的 `done` 与实际写入行数一致（不允许"跑满 limit 但 0 写入"）；
3. 人为制造一次写入未命中（appid 不在库）时，日志出现 `steam-status.write_miss`；
4. 连续请求间隔 ≥ `rate`（日志 `http.request` 时间戳可验），**4xx 异常路径也不允许无间隔连发**；
   撞 429 时本轮立即结束并记录，不再睡 30 分钟空转；
5. `steam-status.done` 里 `wrote` 等于数据库实际变化行数，`skipped + wrote + failed` 等于本轮尝试数；
6. `content_descriptors` 的写入参数类型确实可用（首次跑通即验证第 7 条风险），已有分级不会被空数组覆盖；
7. 指标卡：跑完一轮后「未探测」下降量与 `wrote` 一致（12000 → 6000 的默认值需同步到系统设置）；
8. `npm test` 全绿（`test/steam-status.test.js` 覆盖取值、不写库、write_miss、空数组不覆盖、429 收轮），
   `npm run frontend:build`、`npm run scan`；
9. 不自行打 tag。

## 6. 实施顺序

1. **A + B**（取值 + 不可静默）→ 先用 `--limit 20` 在服务器验证能写进去；
2. **C**（限速与 429 收尾）；
3. **D**（连接复用）；
4. **E**（sync_runs）与设置默认值；
5. 测试与文档同步（本文件状态、TODO、`docs/DELIVERY.md` 数据任务表、CHANGELOG）。

## 7. 待确认

| # | 问题 | 默认取向 |
|---|---|---|
| 1 | `steamStatus.limit` 从 12000 降到 **6000**（约 5 小时/轮，平均 2 请求/行）是否接受？ | **已按默认取向实施（代码默认 6000，e432d2f）**。注意：库里已保存过的值会覆盖默认——部署后需在「系统设置 → 数据源与采集」把 `steamStatus.limit` 同步改为 6000，否则线上仍是旧值 |
