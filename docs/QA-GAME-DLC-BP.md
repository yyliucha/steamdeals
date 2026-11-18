# QA：BP 游戏详情 DLC 总数与列表（第 1 轮）

> 基线 `7b383e7` → HEAD `98d75e9`；判据 [GAME-DLC.md](GAME-DLC.md) §4 验收；
> 开发描述来源：TODO BP 条目。
>
> 结论：✅ 放行 —— 通过 9 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | BP | 详情页最下方「DLC（共 N 个）」区块（总数 + 内联列表，不另开抽屉） | 首页 → 详情 → 滚到底 | ✅ 已交付 | frontend/src/pages/Home.vue（`dlc-block`）；test/game-dlc.test.js 前端静态断言 |
| 2 | BP | DLC 列表：名称/价格/折扣/缺货，10 条/页翻页，每行跳 `store.steampowered.com/app/<appid>/`（新窗口、rel noopener） | 详情 → DLC 区块 | ✅ 已交付 | Home.vue（`dlcUrl`、`dlc-row`/`dlc-cards`、PaginationBar page-sizes=[10]）；server.js DLC 路由（`buy_url`） |
| 3 | BP | 「Steam 不提供 DLC 拥有数据」说明；无 DLC「暂无 DLC」；加载失败「稍后重试」；部分待同步提示 | 详情 → DLC 区块 | ✅ 已交付 | Home.vue（`dlc-note`/`dlc-empty`/`部分 DLC 信息待同步`）；test/game-dlc.test.js:163-181 |
| 4 | BP | 移动端（≤760px）DLC 卡片（名称可点 + 价格/折扣/在售） | 详情 → DLC 区块 | ✅ 已交付 | Home.vue（`isMobile` 分支 `dlc-cards`）；main.css `.dlc-card` |
| 5 | BP | 非 Steam / 从未同步过 dlc[] 的游戏不显示区块（空集） | 详情 | ✅ 已交付 | Home.vue `detail.game.steam_appid && detail.dlc?.total > 0`；server 路由 `synced:false, items:[]` |
| 6 | BP | DLC 归属随 steam-status/backfill 的 appdetails 顺带入库（GetItems 不清空已有值） | 服务端自动（不新增调度任务） | ✅ 已交付 | steam-status.js:39-47（`writeDlcAppids` + `steam.status.dlc_written`）；pg.js `upsertGameMeta` null 守卫；test/game-dlc.test.js BP-1 |
| 7 | BP | DLC 明细（名称/价格/折扣/在售）定时补齐 + 打开详情缺明细时回源（≤3 批、5s 超时、10 分钟节流、429/失败降级） | 服务端自动 | ✅ 已交付 | src/dlc-fill.js；server.js `maybeFillDlcOnRead`；steam-status 收尾 `steam.dlc.filled`；test/game-dlc.test.js（节流与降级断言） |
| 8 | BP | 接口：详情 `dlc {total,synced,filled}` + `GET /api/games/:appid/dlc?page&pageSize`（公开，名称升序、pageSize 上限 50、非法 page 回落 1） | API | ✅ 已交付 | server.js:1336-1339、dlc 路由；docs/WEB.md 权限表；test/game-dlc.test.js API 用例 |

## 逐条核对（规格 §4 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 数据提取：dlc 去重/过滤/上限 2000；GetItems 不清空已有值 | 真跑单测 | test/game-dlc.test.js:25-38（`[11,12]`、2000 上限、无字段 null）；:57-60（`upsertGameMeta` 无 dlcAppIds 不清空） | ✅ |
| 2 | 明细：GetItems → game_dlc upsert；取不到保留空行；dlc_appids 变化差集删除 | 真跑单测 | test/game-dlc.test.js:40-56（占位/差集/空数组清空）、:62-77（upsert 覆盖价格/折扣/币种） | ✅ |
| 3 | 详情接口：`dlc.total/synced/filled` 正确；无行 → `{0,false,0}` | 真跑单测 | test/game-dlc.test.js:127-129（`deepEqual {total:3,synced:true,filled:2}`）；pg.js `dlcSummary` | ✅ |
| 4 | 列表接口：分页 10（上限 50）、名称升序、buy_url；非法 page 回落 1；空集 | 真跑单测 | test/game-dlc.test.js:130-152（名称升序、buy_url、默认 10、`page=abc&pageSize=999` → 1/50、998 空集、404） | ✅ |
| 5 | 回源：缺明细首次打开触发 ≤3 批并落库；10 分钟节流；失败/429 降级不 5xx | 真跑单测 | test/game-dlc.test.js:89-109（fillDlcDetails 3 批上限/429 标记）、:133-145（fetchCalls=1 → 节流后仍 1）、:154-161（失败实现 → synced false + `DLC #203` 回退，200） | ✅ |
| 6 | 前端内联列表：区块/10 条每页/翻页/Steam 跳转/价格折扣缺货/说明文案/移动卡片/暂无 DLC/非 Steam 无区块/上千不卡 | 静态断言 + 构建 | test/game-dlc.test.js:163-181；`frontend:build` ✓（渲染正确性由编译级兜底；「上千不卡」= 分页 10 + 服务端分页，每页仅 10 行 DOM） | ✅ |
| 7 | 定时与日志：一轮后缺明细数下降；`steam.status.dlc_written`/`steam.dlc.filled`；不新增调度任务 | 代码 + 单测 | steam-status.js:42/240（日志）、:224-241（收尾 `listDlcFillGames` + `fillDlcDetails`）；test/game-dlc.test.js:190-210（round 写 dlc_appids + 日志断言）；diff 无 `src/scheduler.js`（jobsFromEnv 不变） | ✅ |
| 8 | 权限/隐私：接口公开、游客可看；不含账号/拥有信息/token | 代码复核 | server.js dlc 路由无 `requireUser`；items 仅 appid/name/price/original/discount/currency/in_stock/buy_url（server.js dlc 路由 map） | ✅ |
| 9 | `npm test` / `frontend:build` / `scan` 全绿；新测试进主链 | 重跑 | `npm test` 退出 0（无 not ok；test/game-dlc.test.js 7 项已进主链）；`node test/api.test.js` 22/22；`frontend:build` ✓；`scan` 无凭据 | ✅ |
| 10 | 部署侧复核：Anno 1800/HELLDIVERS™ 2 详情滚到底看列表与 Steam 跳转、翻页、Console 干净、24h 后覆盖上升 | 无法本地执行 | 部署人员按规格 §4.10 复核 | 🔎 |

## 打回清单

无。

## 需人工确认

- 验收 10 部署侧复核：打开 Anno 1800（DLC 多）详情，滚到底确认 DLC 区块、翻页、Steam 跳转（新窗口）、Console 干净；24h 后 `game_dlc` 明细覆盖上升（`steam-status` 每轮收尾补齐）。本地以 pglite + 注入 fetch 的接口/单测覆盖逻辑，无真实 Steam 数据与浏览器。

## 风险提醒（非打回）

- 「上千 DLC 翻页不卡」以「服务端分页 10 + 每页只渲染 10 行 DOM」保证，未做真实上千数据的前端压测（本地无该数据量）；
- 读路径回源节流是进程内 Map（重启重置），与「打开详情」的瞬时行为对齐，规格未要求持久化；
- DLC 明细补齐依赖 `STEAM_API_KEY`：未配置时定时与回源都静默跳过（列表仍显示 `DLC #<appid>` 占位），符合降级语义。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-13）：初检即 ✅ 放行，无打回项。
