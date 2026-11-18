# 到价提醒治理：无报价标记 / 站点级迁移 / 史低抽检 / 刷新频率评估（CU）

> 状态：**已确认待开发（2026-11-18，基于线上 watchlist 实测数据）**。
> 关联：[TODO.md](TODO.md) CU 条目、[USER-ALERTS.md](USER-ALERTS.md)（CL 批：用户级提醒）、
> [DESIGN-AUDIT.md](DESIGN-AUDIT.md)（数据口径类技术债）。

## 1. 背景（2026-11-18 线上数据核对）

后台「到价提醒」共 15 条，**全部 `user_id IS NULL`（站点级）**，且全部**未设目标价**（= 跌至史低模式）。
核对 `watchCandidates` 口径后确认页面数据与 SQL 一致（官方+授权渠道、CN 区、在售最低价）：

| 观察 | 数据 |
|---|---|
| **2 条永远触发不了** | State of Decay 3（1340720）、Warhammer 40,000: 黑暗异端（3710600）→ `current_cents`/`hist_low` 均为空，`alerts.js` 对 `current == null` 直接跳过 |
| **多条当前价 = 史低** | Stray / Tropico 7 / Land of the Vikings / 水上乐园 / 生存日志 / 纵横秘湾 / 罗马之城 / 海狸浮生记 等，靠 `last_notified_cents` 去重避免重复提醒 |
| **史低异常偏低** | 部落幸存者：当前 ¥72.00、史低 **¥20.25** → 需抽查是否脏数据 |
| **滞后** | Steam 价格刷新默认 **1440 分钟**（每天一次），到价最多滞后一个采集周期 |

## 2. 已确认的决策（所有者 2026-11-18：四项合并为本条）

| # | 内容 |
|---|---|
| CU-1 | **「无报价」标记**：后台「到价提醒」列表对 `current_cents IS NULL` 的行显示「无报价/未发售」徽标，并支持筛选；同时在提示里说明"无在售报价时不触发提醒"。 |
| CU-2 | **站点级提醒迁移/清理**：后台列表支持**批量选择 → 迁移到指定用户**（写入 `user_id`，迁移后提醒发该用户邮箱）或**批量删除**；操作记审计；站点级保留能力不变（不强制迁移）。 |
| CU-3 | **史低抽检**：对 `部落幸存者` 等异常样本只读抽查 `daily_prices`（按平台/日期列出最低价来源），确认 ¥20.25 是真折扣还是脏数据；若脏数据 → 修复脚本 dry-run 可核对（不自动改历史）。 |
| CU-4 | **Steam 价格刷新频率评估（待定）**：现 1440 分钟/次；评估提到 720/480 的配额影响（`steam-prices` 请求数 ≈ 有价游戏数 / 批大小），给出数字与建议后再决定；**本批默认不改频率**。 |

## 3. 改动落点

- `src/store/pg.js`：`listWatches` / `watchCandidates` 增加 `has_price`（current 是否为空）字段；站点级迁移 `update watchlist set user_id=$1 where id = any($2)`。
- `src/server.js`：`/api/admin/watchlist` 返回 `hasPrice`；新增 `POST /api/admin/watchlist/migrate`（`{ ids, userId }`）与批量删除；权限与审计（`api.watch_migrated` / `api.watch_deleted`）。
- `frontend/src/pages/AdminModules.vue`（到价提醒 section）：无报价徽标 + 筛选；多选 + 迁移（选用户）/删除；确认框。
- 抽检：一次性只读 SQL（写入规格附录），不新增定时任务。

## 4. 验收

1. 列表对 State of Decay 3 / Warhammer 黑暗异端显示「无报价」，筛选"无报价"只出这两条；
2. 批量迁移 2 条到某用户 → `watchlist.user_id` 更新、页面「用户」列变为该用户、后续提醒发该用户邮箱（留证据）；
3. 批量删除 → 行消失，审计日志可见；
4. 抽检 SQL 输出：部落幸存者的 `daily_prices` 明细与最低价来源（哪个平台/日期），结论写进报告；
5. `npm test`（`listWatches` 的 hasPrice/迁移/删除断言）/ `frontend:build` / `scan` 全绿；
6. CU-4 只产出"配额评估与建议"，不改配置。

## 5. 待确认

1. CU-2 迁移目标：迁移到哪个用户？（需要一个真实用户名；或先做交互、由所有者当场选）
2. CU-3 抽检范围：只查部落幸存者，还是把所有 `hist_low` 明显低于当前价 70% 的条目都列出来抽查？
3. CU-4 是否要给出 720/480 的具体配额数字后再定（建议：给数字，不改配置）。
