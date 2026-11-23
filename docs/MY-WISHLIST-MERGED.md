# 我的愿望单：合并 Steam 愿望单展示（EY，待开发，2026-11-23）

> 所有者要求（2026-11-23）：「本站点添加的游戏 + steam 愿望单一起展示；这里只对本站添加的愿望单操作，
> steam 的没有操作按钮。」

## 1. 现状（代码证据）

| 项 | 事实 | 位置 |
|---|---|---|
| 我的愿望单页 | 只显示本站手动愿望单（`user_wishlist`）；空时提示「去前台逛一逛」 | `frontend/src/pages/UserSections.vue`（wishlist section） |
| 接口 | `GET /api/me/wishlist` → `listWishlists(userId)`：只查 `user_wishlist` | `src/routes/watchlist.js:157`、`src/steam-accounts.js:listWishlists` |
| Steam 导入愿望单 | `steam_wishlist(steam_id, appid, name, synced_at)` 按账号同步；`steam_accounts` 有 alias/persona_name | `steam-accounts.js` |
| 账号展示 | EW 已加「Steam 账号」列（wishlisted_by/steam_accounts） | 已发布 v2.28.x |
| 操作 | 本站行有「移除」（DELETE /api/wishlist/:appid）；Steam 愿望单站点只读（不写回 Steam） | `src/routes/watchlist.js` |

## 2. 需求

「我的愿望单」页合并展示两层，**Steam 行只读、无操作按钮**：

1. **数据**：合并 `user_wishlist`（本站）与 `steam_wishlist`（该用户绑定账号导入）；
2. **行语义**：
   - 同一游戏两层都有 → **合并为一行**，来源标注「本站 + Steam 账号」；操作仅对本站行生效（移除）；
   - 仅 Steam 导入 → 一行，来源「Steam 账号」；**无移除/无任何操作按钮**；
   - 仅本站 → 一行，来源「本站」；有移除按钮；
3. **账号列**：已有 EW 的 Steam 账号列（Steam 行显示来源账号；本站行若同时命中显示账号）；
4. **分页/搜索**：合并视图统一分页（SQL UNION + 聚合），搜索覆盖两层；
5. 站点对 Steam 愿望单**只读**（不写回）。

## 3. 实现要点

- 接口扩展（或新增 `GET /api/me/wishlist?include=steam`）：
  ```sql
  with site as (select uw.id, uw.game_id, uw.created_at, 'site' as src from user_wishlist uw where uw.user_id=$1),
       steam as (select null::bigint as id, g.id as game_id, max(sw.synced_at) as created_at, 'steam' as src
                 from steam_wishlist sw join steam_accounts sa on sa.steam_id=sw.steam_id
                 join games g on g.steam_appid=sw.appid
                 where sa.user_id=$1 group by g.id)
  select ... from (site union all steam) 按 game_id 去重合并（src 合并成数组/布尔标记）
  ```
  行返回：`game_id/name/steam_appid/current_low/hist_low/sources:['site','steam']/site_wishlist_id(可移除)/steam_accounts[]`；
- 前端 `UserSections.vue`：合并列表；「移除」按钮仅 `sources.includes('site')` 时显示；Steam-only 行显示「Steam 导入（只读）」标签；
- 不改：加入/移除本站逻辑、Steam 只读口径、账号列（EW）。

## 4. 验收

1. 空账号：只有本站行；移除后刷新消失；
2. 仅 Steam：显示 Steam 行（来源账号、无操作按钮）；
3. 两层都有：合并一行（来源「本站 + Steam」），有移除按钮（只删本站，Steam 侧不受影响）；
4. 分页/搜索覆盖两层；越权（A/B 双用户）不可见他人数据；
5. `npm test`（分段）+ `frontend:build` + `scan` 全绿；截图对照。
