# 到价提醒治理：无报价标记 / 站点级迁移 / 史低抽检 / 刷新频率评估（CU）

> 状态：**CU-1 已交付质检通过（实现 b5f5663 + 恢复 77c9f8f，QA docs/QA-CU1.md 第 2 轮 ✅，2026-11-19）；CU-2 已交付质检通过（实现 b7ab402，QA docs/QA-CU2.md 第 1 轮 ✅ 5/0/0/2，2026-11-19）；CU-3 已交付质检通过（§6 附录，QA docs/QA-CU3.md 第 1 轮 ✅ 4/0/0/2，2026-11-19）；CU-4 开发中**。
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
| CU-2 | **站点级提醒按 Steam 愿望单反查用户**：对每条站点级提醒，用 `steam_wishlist`（`steam_id` → `steam_accounts.user_id`）反查哪些用户把该游戏加进了 Steam 愿望单；**多个用户则全部列出**，支持「迁移给这些用户」（每个用户一条 watchlist 行，收件人为各自邮箱）；无人认领则保持站点级。操作记审计。 |
| CU-3 | **史低抽检（全部异常样本）**：列出所有「史低 < 当前价 × 0.7」或史低明显异常的条目（不只部落幸存者），逐条只读核对 `daily_prices` 来源（平台/日期）；脏数据才修（dry-run 先看，不自动改历史）。 |
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

1. CU-2 迁移目标：迁移到哪个用户？（需要一个真实用户名；或先做交互、由所有者当场选）——**已定（2026-11-18）**：交互选择，多个全列
2. CU-3 抽检范围：只查部落幸存者，还是把所有 `hist_low` 明显低于当前价 70% 的条目都列出来抽查？——**已定（2026-11-18）**：全部异常样本
3. CU-4 是否要给出 720/480 的具体配额数字后再定（建议：给数字，不改配置）。

## 6. CU-3 抽检附录（2026-11-19，结论清单 + 只读 SQL）

### 6.1 结论清单（可核对）

判定标准（按 §2 CU-3）：**史低 < 当前价 × 0.7** 即「异常偏低」，逐条核对 `daily_prices` 来源。

| 样本（appid） | 当前价 | 史低 | 比值 | 判定 | 核对结论与证据 |
|---|---|---|---|---|---|
| 部落幸存者（1509510） | ¥72.00 | ¥20.25 | 28.1% | 命中 | **真实史低，非脏数据，不修**。¥20.25 = ¥81 × 0.25：2026-09 Steam 特卖本体 -75%（当轮促销时国区原价 ¥81；现行原价 ¥72 为之后调价，故 20.25/72 不呈标准折扣档位）。证据链：① 公开站点只读 API（sd.yyliucha.cn `/api/games?q=部落幸存者`，2026-11-19）：`current_low=7200`、`hist_low=2025`、`prev_hist_low=2025`、`low_platform=steam`、`low_platform_name=Steam 国区`、`release_date=2022-10-24`；② SteamDB 公开价格页缓存：CN 行「-75% ¥20.25」（Special Promotion，2026-09-24 结束）；③ steamdata.ai（1509510）：中国「¥81.00 → ¥20.25 -75%」——81×0.25=20.25 精确吻合。 |
| 深岩银河：异动核心（2605790） | ¥86.00 | ¥77.40 | 90.0% | 不命中 | demo 样本（docs/design/alert-manual-push-2026-11-18.html），比值正常 |
| 雾锁王国（1203620） | ¥138.00 | ¥124.20 | 90.0% | 不命中 | 同上 |
| Stray（1332010） | ¥98.00 | ¥98.00 | 100% | 不命中 | 同上（当前价=史低，靠 last_notified 去重） |
| 其余线上提醒条目 | — | — | — | 待线上执行 SQL① | 本地无生产库（红线：不连生产库）；线上 watchlist 其余条目的全量判定请执行 §6.2 SQL① 一次性列出。 |

> **局限说明**：公开站点 API 只能核对聚合史低与来源平台；`daily_prices` 的逐日明细（精确日期）需在线上执行 §6.2 SQL②。已知样本的公开证据（当轮促销原价 ¥81 → -75% → ¥20.25）已足以判定非脏数据。

### 6.2 只读抽检 SQL（PostgreSQL 15，线上只读执行；一次性，不新增定时任务）

```sql
-- ① 异常样本判定：全部提醒条目（站点级 + 用户级）里「史低 < 当前价 × 0.7」的
-- 口径与 listAllWatchesAdmin 完全一致：当前价 = 官方+授权渠道、CN 区、在售最低价；
-- 史低 = daily_prices 全历史最低（官方+授权渠道、CN 区）。
with watch_price as (
  select w.id as watch_id, w.user_id, g.steam_appid,
         coalesce(nullif(g.name,''), nullif(g.name_en,''), 'appid:'||g.steam_appid) as game_name,
         (select min(o.price_cents) from offers o
            join platforms p on p.code = o.platform_code
           where o.game_id = g.id and o.region = 'cn' and o.in_stock
             and p.kind in ('official','authorized_reseller')) as current_cents,
         (select min(d.min_price_cents) from daily_prices d
            join platforms p on p.code = d.platform_code
           where d.game_id = g.id and d.region = 'cn'
             and p.kind in ('official','authorized_reseller')) as hist_low
  from watchlist w join games g on g.id = w.game_id
  where w.region = 'cn'
)
select watch_id, user_id, steam_appid, game_name, current_cents, hist_low,
       round((hist_low::numeric / nullif(current_cents, 0)) * 100, 1) as hist_ratio_pct
from watch_price
where current_cents is not null and hist_low is not null
  and hist_low * 10 < current_cents * 7        -- 史低 < 当前价 × 0.7
order by hist_ratio_pct asc, steam_appid asc;

-- ② 命中样本的 daily_prices 明细与最低价来源（哪个平台/日期；示例：部落幸存者 appid=1509510，
-- 把 steam_appid 换成 SQL① 命中的样本）
select d.day, d.platform_code, p.name as platform_name, d.min_price_cents, d.currency
from daily_prices d
join platforms p on p.code = d.platform_code
join games g on g.id = d.game_id
where g.steam_appid = 1509510 and d.region = 'cn'
order by d.min_price_cents asc, d.day asc;
```

> 修复策略：SQL① 若有新命中样本，按 6.1 的方法逐条公开证据核对；确认脏数据时**先 dry-run 输出**拟删除/修正的
> `daily_prices` 行（平台/日期/价格），由所有者确认后由部署侧执行，**开发侧不自动改历史数据**。
