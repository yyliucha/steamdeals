# 前台愿望单显示 Steam 账号（EW，已实现并发布 v2.28.5，2026-11-23）

> 所有者要求（2026-11-23）：「前台显示 steam 账号即可」——在「我的愿望单」页显示该游戏来自哪个 Steam 账号
> （只显示，不做账号选择/推送，保持 v2.9.0「愿望单仅本站」口径）。
> 历史：v2.9.0（WISHLIST-SITE-ONLY.md 决策 6）曾「详情/卡片不再列 Steam 账号」——本条目为恢复「只读展示」。

## 1. 现状（代码证据）

| 项 | 事实 | 位置 |
|---|---|---|
| 「我的愿望单」页 | 列：游戏/AppID/当前价/史低/加入时间/操作，**无 Steam 账号列** | `frontend/src/pages/UserSections.vue`（wishlist section） |
| 数据接口 | `GET /api/me/wishlist` → `listWishlists(userId)`：查 `user_wishlist`，字段无 Steam 账号 | `src/routes/watchlist.js:157`、`src/steam-accounts.js:listWishlists` |
| Steam 导入愿望单 | `steam_wishlist(steam_id, appid, ...)` 按账号同步；`steam_accounts(alias, persona_name)` | `steam-accounts.js` |
| 历史 | v2.9.0 前前台卡片/详情显示「愿望单账号（Steam 账号名）」+ 加入弹窗账号多选；决策 6 全面解耦后删除 | `docs/WISHLIST-SITE-ONLY.md §1/§2` |

## 2. 需求

- 「我的愿望单」新增「Steam 账号」列（桌面表格 + 移动卡片一行）：
  - 显示该愿望单游戏在**当前用户已绑定 Steam 账号**的导入愿望单（`steam_wishlist`）中命中的账号名
    （`alias` 优先，回退 `persona_name`；多账号并排，超过 2 个折叠「+N」）；
  - 无命中 → 显示「本站添加（无 Steam 来源）」；
- **只读**：不做账号选择、不推送 Steam、不影响加入/移除逻辑（保持 v2.9.0 口径）。

## 3. 实现

- 后端：`/api/me/wishlist` 返回行附加 `steam_accounts: string[]`——
  `select string_agg(coalesce(nullif(btrim(a.alias),''), a.persona_name, a.steam_id), ',')` 
  from `steam_wishlist sw join steam_accounts a on a.steam_id = sw.steam_id`
  where `a.user_id = <当前用户>` and `sw.appid = g.steam_appid`（按行聚合，多账号一次查询/联表）；
- 前端 `UserSections.vue`：桌面加列 `<el-table-column label="Steam 账号">`（账号名 + 多账号 +N）；
  移动卡片加 `<small>Steam 账号：…</small>`；无来源显示「本站添加」；
- 不做：账号选择弹窗、Steam 推送、愿望单存储结构改动。

## 4. 参考 demo

- `docs/design/my-wishlist-steam-account-demo.html`
- `docs/design/my-wishlist-steam-account-demo.png`

## 5. 验收

1. 单账号：显示该账号名；多账号：并排显示（>2 折叠 +N）；
2. 无 Steam 来源：显示「本站添加（无 Steam 来源）」；
3. 只读：加入/移除/同步功能不受影响；
4. 普通用户只能看到**自己**的 Steam 账号（越权不可见，A/B 双用户验证）；
5. `npm test`（分段）+ `frontend:build` + `scan` 全绿；截图对照。

## 6. 补充核查（2026-11-23，两层愿望单现状）

**后端已完整支持两个层面**（无需新增功能）：

| 层 | 数据 | SQL/字段 | 现状 |
|---|---|---|---|
| ① Steam 同步层 | `steam_wishlist`（按账号同步导入） | `WISHLISTED_SQL` 合并判定；**`WISHLISTED_BY_SQL` 已返回 `wishlisted_by` = `[{steamId,name}]`（多账号）** | ✅ 已在 `/api/games` 返回（games-repository.js:344/378/400） |
| ② 手动层 | `user_wishlist`（前台手动添加） | `SITE_WISHLISTED_SQL` → `site_wishlisted` 标记 | ✅ 已实现（POST /api/wishlist 只写本站，不推 Steam） |

**缺的只是前端展示**：
- 前台游戏卡片/详情**未渲染 `wishlisted_by`**（账号名不显示）；
- 「我的愿望单」页接口 `listWishlists` 未返回 `steam_accounts`（需补）。

## 7. 更新后的范围（EW）

- **EW-1** 前台游戏卡片（首页/搜索共用）显示 `wishlisted_by` 账号名（多个、>2 折叠 +N）；
- **EW-2** 游戏详情弹窗显示所属 Steam 账号（多个）；
- **EW-3** 「我的愿望单」页加「Steam 账号」列（接口补 `steam_accounts`）；
- **两层支持已存在**（① Steam 同步 ② 手动添加），本条目**只补展示**，不新增数据/写回逻辑；站点仍不修改 Steam 愿望单。
