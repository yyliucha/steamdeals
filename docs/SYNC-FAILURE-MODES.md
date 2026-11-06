# 同步不可达：全链路失败模式清单（排查手册）

> 状态：**排查完成，AC 拆 4 批开发（2026-11-06 所有者确认，见 §5.1 / §6）**。本文件按"用户说'没同步'"这个现象，把每一条会导致它成立的路径列出来，
> 并标注**当前是否有保证**。凡是没有保证的，都登记成 [TODO.md](TODO.md) 的 AC 条目。
> 关联：[STEAM-STATUS-FIX.md](STEAM-STATUS-FIX.md)（AB 批，已确认的真因）、
> [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md)（状态与分级设计）、
> [SCHEDULER-BLOCKING-FIX.md](SCHEDULER-BLOCKING-FIX.md)（X 批，调度器）。

## 1. "同步"在本项目里其实是 7 条链路

| # | 链路 | 入口 | 产物 | 用户看到的结果 |
|---|---|---|---|---|
| 1 | 目录 | `sync catalog` / `catalog` 任务 | `games` 行 | 游戏出现在列表 |
| 2 | 元数据 | `backfill` / `import steam` | 简介、封面、类型、**首次 offer** | 有简介、有价格 |
| 3 | 价格 | `steam-prices`/`sonkwo`/`gog`/`humble`/`itad` | `offers`/`daily_prices`/`price_snapshots` | 当前价、史低、曲线 |
| 4 | 状态与分级 | `steam-status` | `steam_status`/`adult_flag` | 后台「未探测」下降、锁区/成人标注 |
| 5 | 账号库与愿望单 | `steam-accounts` | `steam_games`/`steam_wishlist` | 已拥有、愿望单 |
| 6 | 热度 / 改名 | `heat` / `rename` | `heat`/`name` | 排序、中文名 |
| 7 | 提醒 / 图表 | `alerts` / `chart` | 通知、静态曲线页 | 到价提醒、曲线 |

**"没同步"必须落到上面某一条**——不同链路卡住的修法完全不同，先让所有者确认是哪一条（见 §5 Q1）。

## 2. 失败模式清单

### A. 调度层

| 编号 | 失败模式 | 当前有保证？ | 证据 | 待办 |
|---|---|---|---|---|
| A1 | **任务因开关/缺 key 直接消失**：`catalog`、`steam-accounts` 需要 `STEAM_API_KEY`（>10 位）才注册；`STEAM_ENABLED=0` 时全部 Steam 任务消失 | ❌ 无告警，启动日志只列"存在的"任务，用户不知道少了什么 | `scheduler.js:36`、`:93` | **AC1** |
| A2 | **熔断**：连续 3 次失败 → 该任务冷却 **6 小时**，且状态在内存里、重启清零 | ⚠️ 有实现，但后台不可见、不能手动重置 | `scheduler.js:202`、`:525-534` | **AC2** |
| A3 | **重启重置计时**：`lastRunMs` 内存态；X 批已改为从 `sync_runs` 恢复，但 **`steam-status`/`heat`/`rename` 不写 `sync_runs`**，每次发版重启后仍从头计时 | ⚠️ 部分保证（只对写 sync_runs 的任务生效） | `scheduler.js:452-460`；`cmdSteamStatus` 无 `insertSyncRun` | **AC3** |
| A4 | **单槽排队**：X 批后重任务非阻塞但有全局单槽，`steam-prices`（~90 分钟/天）+ `heat`（可达数小时）+ `backfill`（每周 2 万）+ `steam-status`（目标 5 小时/天）**串行总时长可能超过 24 小时** | ❌ 没有预算校验 | `scheduler.js:224`、`:505-539` | **AC4** |
| A5 | **手动任务占用**：后台手动同步/回填运行时，重任务会 `job_deferred_busy` 一直让位 | ⚠️ 有日志，但后台看不到"被占用多久" | `scheduler.js:518-522` | **AC5** |

### B. 网络 / HTTP

| 编号 | 失败模式 | 当前有保证？ | 证据 | 待办 |
|---|---|---|---|---|
| B1 | 代理失效（日志 `via=steam-proxy`），全部请求失败 | ⚠️ 有 `probe`/`diagnose`，但不是自动告警 | `src/proxy.js`、`src/http.js` | 并入 **AC2** |
| B2 | **429 冷却 30 分钟**，且是**进程级**（每个子进程独立）；反复 429 会反复冷却，单轮被拖成"没跑" | ❌ 无全局退避预算，也没有"本轮因 429 跳过多少"的统计 | `http.js:55`、`:192-200` | **AC6** |
| B3 | 超时/重试（`retries:1`、`timeoutMs` 各接口不同） | ⚠️ 有重试，但失败只进日志 | `http.js` | 并入 AC2 |
| B4 | 响应不是 JSON（被墙/风控页） | ⚠️ 有 `http.parse_error` 日志 | `http.js:366-380` | 并入 AC2 |

### C. 契约 / 解析

| 编号 | 失败模式 | 当前有保证？ | 证据 | 待办 |
|---|---|---|---|---|
| C1 | **`fetchJson` 返回 `{json}` 被当 payload**（已确认真因） | ❌ 已复现：整轮 200 成功但 0 写入 | `cli.js:2179`、`:2189` | **AB 批** |
| C2 | `success:false` 的三种语义（锁区/下架/未发售）混在一起 | ⚠️ 已用 hk 复核区分，但依赖港区可访问 | `steam.js:36-52` | 观察 |
| C3 | Steam 字段变化（`price_overview`、`content_descriptors` 改名） | ❌ 无结构校验，解析失败会静默变 null | `steam-meta.js:116-118` | **AC7** |

### D. 写入 / 口径

| 编号 | 失败模式 | 当前有保证？ | 证据 | 待办 |
|---|---|---|---|---|
| D1 | `setSteamStatus` 未命中静默；`done/wrote` 不区分 | ❌ AB 批一起修 | `pg.js:2130`、`steam-status.js` | **AB 批** |
| D2 | **状态判成 `ok` 却不写 `offers`**：`steam-status` 只更新 games，不产出报价；玩家看到"已同步"但列表里仍无价格，除非 `backfill` 再跑一次 | ❌ 结构性缺口 | `steam-status.js`（无 ingest/offer 写入）；`cli.js:1852` 才建 offer | **AC8** |
| D3 | **价格同步只刷"已有 offer"的游戏**（`join offers`），新游戏永远拿不到第一次价格，只能等 `backfill`（每周、2 万上限、按 id 顺序） | ❌ 新游戏入榜可能等数周 | `cli.js:301-311` | **AC9** |
| D4 | 「已同步」口径 = `steam_status='ok'` **且**有简介，**不要求有价格** | ⚠️ 与用户感知不一致（"已同步"但无价） | `pg.js: adminGameStats` | 并入 **AC8** |

### E. 观测

| 编号 | 失败模式 | 当前有保证？ | 证据 | 待办 |
|---|---|---|---|---|
| E1 | `steam-status`/`heat`/`rename`/`backfill` **不写 `sync_runs`**，后台「同步记录」看不到它们跑过没有、跑了多少 | ❌ | `cli.js` 中仅手动 sync 写 `sync_runs` | **AC10** |
| E2 | 后台没有"任务健康"视图：上次运行、耗时、结果、失败原因、下一次时间全靠翻日志 | ❌ | `data/scheduler-status.json` 只在启动/完成时写 | **AC11** |

## 3. 已确认、必须立即修的

- **AB 批**（[STEAM-STATUS-FIX.md](STEAM-STATUS-FIX.md)）：C1 + D1 + 限速 + 连接复用 + 可观测。**这是当前"看起来完全没同步"的直接原因。**

## 4. 待办清单（AC1–AC11，登记在 [TODO.md](TODO.md)）

| 编号 | 一句话 |
|---|---|
| AC1 | 启动时校验"该有但没有"的任务（缺 `STEAM_API_KEY`/任务被关），后台显式提示 |
| AC2 | 熔断/代理失败/429 在后台可见，并支持手动重置熔断 |
| AC3 | `steam-status`/`heat`/`rename` 也写 `sync_runs`（或落盘 lastRun），重启不重置节奏 |
| AC4 | 算一次"每日 Steam 配额预算"：prices + heat + status + backfill 串行总时长必须 < 24h，超了就自动降频并告警 |
| AC5 | 后台显示"重任务被手动任务占用"的时长与占用者 |
| AC6 | 429 改为全局退避预算（本轮跳过并记录原因），不再每个进程各睡 30 分钟 |
| AC7 | 解析增加结构校验（关键字段缺失记 `adapter.*.shape_mismatch`），不静默变 null |
| AC8 | 明确"状态 ok 与报价"的关系：要么 `steam-status` 判 ok 时顺带写 offer，要么 `backfill` 优先这些游戏；并复核「已同步」口径 |
| AC9 | 新游戏优先入回填队列（按 created_at 或 catalog_at 排序），不要按 id 顺序排队数周 |
| AC10 | 所有数据任务统一写 `sync_runs`，后台「同步记录」可见 |
| AC11 | 后台加「任务健康」面板：上次运行/耗时/结果/失败原因/下次时间/当前是否在跑 |

## 5. 需要所有者确认（决定优先级与改法）

| # | 问题 | 为什么要问 |
|---|---|---|
| Q1 | 你说的"没同步"，最想先解决哪一条：**列表里没价格** / **后台状态一直是未探测** / **新游戏收录太慢** / **账号库与愿望单不更新**？ | 四条链路的修法完全不同 |
| Q2 | 服务器是否配置了 `STEAM_API_KEY`？ | 缺了的话 `catalog` 与 `steam-accounts` 任务根本不存在（AC1） |
| Q3 | 是否接受"`steam-status` 判定 `ok` 时**顺带写入该游戏的价格 offer**"？ | 这是 AC8 的两种改法里最省请求的一种，但会让状态任务承担"首次建价"职责 |
| Q4 | `backfill` 每周 2 万上限是否可以提高？新游戏是否要**优先**回填（AC9）？ | 决定"新游戏多久能出现在榜上" |
| Q5 | 后台要不要做「任务健康」面板（AC11）？ | 以后"到底有没有在跑"不用再翻日志 |

### 5.1 已确认（2026-11-06）

| # | 回答 | 落地为 |
|---|---|---|
| Q1 | **四条链路都要**，优先级 ①后台状态一直「未探测」→ ②列表里没价格 → ③新游戏收录太慢 → ④账号库/愿望单不更新 | AC 拆 4 批（§6）；④ 不在 AC1–AC11，愿望单走 AA，账号库另议 |
| Q2 | **已配置**（1.16.4 启动日志 `jobs=[…,catalog,…,steam-accounts,…]` 含这两项） | AC1 仍要做，但面向其它/未来部署 |
| Q3 | **接受**：`steam-status` 判 `ok` 时顺带写该游戏的首次 offer | AC-2（AC8） |
| Q4 | **提高** `backfill` 上限 + **新游戏优先**回填 | AC-3（AC9 + AC4 预算） |
| Q5 | **做**「任务健康」面板 | AC-1（AC11） |

## 6. 开发批次（2026-11-06 确认，一次一批）

| 批次 | 包含 | 对应链路 | 状态 |
|---|---|---|---|
| **AC-1 观测批** | AC1 启动校验提示、AC3 heat/rename 写 `sync_runs`、AC5 排队日志、AC10 所有数据任务写 `sync_runs`、AC11 任务健康面板 | ① | 待开发 |
| **AC-2 价格批** | AC8 判 `ok` 顺带写 offer + 复核「已同步」口径 | ② | 依赖阻塞（AC-1） |
| **AC-3 吞吐批** | AC9 新游戏优先回填、AC4 每日配额预算与超限降频 | ③ | 依赖阻塞（AC-2） |
| **AC-4 可靠性批** | AC2 熔断可见/可重置、AC6 429 全局退避、AC7 解析结构校验 | 剩余 | 依赖阻塞（AC-3） |
