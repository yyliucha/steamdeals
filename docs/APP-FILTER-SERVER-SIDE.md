# App 筛选/排序服务端化（DA = CM-5，方案 A）（待开发）

> 状态：**已确认待开发（2026-11-18，所有者选方案 A：站点 + App 一起做）**。
> 关联：[TODO.md](TODO.md) DA 条目、[APP-PARITY.md](APP-PARITY.md) §57、[APP-NATIVE.md](APP-NATIVE.md) §4.4、
> [DISCOVERY-FOR-YOU.md](DISCOVERY-FOR-YOU.md)（筛选口径）。

## 1. 现状（2026-11-18 代码核对）

- App `HomeScreen.kt` L57-62：`HomeFilter = ALL / DISCOUNT / HIST_LOW / FREE / UPCOMING`；
  L73-74 注释明确「服务端 `/api/games` 只支持 sort 与 type/released，4 个筛选先按**已加载数据**本地处理」；
- 站点 `/api/games` 现有参数：`interest / owned / blocked / sort(discount|price|name|score) / type / released / deck / marks / reviewMin / q / adult / wishlist`；
  **没有** `discountOnly / histLowOnly / freeOnly / unreleased`，也**没有** `sort=heat|release`；
- `user_prefs.only_discount` 有**存**但 `gameSearch` **未使用**（死字段，本批一并处理）。

## 2. 参数定义（站点契约）

| 参数 | 语义 | SQL 条件（与详情口径一致：region=$1，官方+授权渠道，in_stock） |
|---|---|---|
| `discountOnly=1` | 只看有折扣 | `exists (select 1 from offers o join platforms p on p.code=o.platform_code where o.game_id=g.id and o.region=$1 and o.in_stock and p.kind in ('official','authorized_reseller') and o.discount_pct > 0)` |
| `histLowOnly=1` | 只看当前价=史低 | `current_low is not null and hist_low is not null and current_low <= hist_low`（复用 `GAME_SELECT` 的 current_low/hist_low 子查询口径） |
| `freeOnly=1` | 只看免费 | `g.is_free = true`（兼容 `exists offer price_cents=0`） |
| `unreleased=1` | 只看未发售 | `g.release_date > current_date`（无 date 时回退 `g.steam_status = 'coming_soon'`） |
| `sort=heat` | 按热度 | `g.heat desc nulls last, g.id desc` |
| `sort=release` | 按发售时间 | `g.release_date desc nulls last, g.id desc` |

组合规则：4 个参数**互斥**（App 是单选 chip），同时传多个时以优先级 `unreleased > freeOnly > histLowOnly > discountOnly` 取第一个；
`sort` 与筛选正交。

## 3. 改动落点

- `src/server.js`（`/api/games` 与 guest POST 共用解析）：白名单解析 4 个开关 + 2 个排序值，透传给 `gameSearch`；
- `src/store/pg.js`（`gameSearch`）：4 个条件 + 2 个排序；`sort` 白名单加 `heat/release`；count 与列表**同条件**；
  `only_discount` 死字段处理见 §5；
- 索引：为筛选补充 `offers(game_id) where discount_pct > 0`、`games(release_date)`、`games(heat)`（按 EXPLAIN 实测决定是否必要，不盲目加）；
- App（`steamdeals-app`）：`HomeScreen`/`HomeViewModel`——chip 变更 → 带参数请求 + `page=1` 重置；筛选状态保存到本地（已有）；空态文案区分「筛选无结果」；
- Web（`Home.vue`）：筛选抽屉/排序复用同参数（若 Web 暂不做 UI，接口也先支持，保证两端口径一致）。

## 4. 验收

1. App 选「折扣」→ 返回**全库**折扣游戏（总数远大于已加载 50 条），翻页正常；
2. 「史低/免费/未发售」同样为全库结果；Web 同条件返回总数与 App 一致（同一接口对比断言）；
3. 空结果时页面显示「没有符合条件的游戏」而不是空白/加载中；
4. 切换 chip 时列表回到第一页（不追加旧数据）；
5. `count` 与列表条数一致（分页 total 正确）；
6. 性能：`/api/games` 带筛选 P95 ≤ 500ms（部署后线上抽测）；
7. `npm test`（新增筛选参数/组合/优先级断言）/ `frontend:build` / `scan` 全绿；App 模拟器逐 chip 截图。

## 5. 待确认

1. `user_prefs.only_discount` 这个死字段：**删除**（推荐，避免两套真相）还是**接线**（用户默认只看折扣）？
2. 「史低」口径确认：是「当前价 = 历史最低」还是「近期新低（低于 30/90 天内最低）」？**默认按前者**（与详情页史低一致）。
3. App 的「未发售」是否包含"已发售但无报价"？（默认不包含）
