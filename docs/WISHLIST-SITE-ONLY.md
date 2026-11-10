# 愿望单仅本站：去 Steam 关联 + 前后端清单 + 后台可删不可加（待开发）

> 状态：**已实现并发布 v2.9.0（2026-11-10）**（含 §4.4 修订：每账号 API Key 改为账号同步用）。
> 关联：[WISHLIST-OAUTH.md](WISHLIST-OAUTH.md)（AA 批：Steam 写接口 401 的定案与诚实口径）·
> [STEAM-ACCOUNTS.md](STEAM-ACCOUNTS.md) §16 · [ADMIN-CONSOLE-IA.md](ADMIN-CONSOLE-IA.md)（控制台 IA）·
> [ADMIN-BULK-ACTIONS.md](ADMIN-BULK-ACTIONS.md)（批量处置白名单）· [WEB.md](WEB.md)

## 1. 现状（代码事实，2026-11-10 核对）

| 项 | 事实 | 证据 |
|---|---|---|
| 加入愿望单 | `POST /api/wishlist`：写本站 `user_wishlist` + 自动建史低提醒；**再对每个 `steamIds` 推送 Steam**（实测 401 全失败） | `server.js:1566-1631`、`steam-accounts.js` `addUserWishlist` |
| 移除愿望单 | `DELETE /api/wishlist/:appid` 或 `/api/wishlist/id/:gameId`，body `{ steamIds, siteWishlist }`；会尝试 Steam 回推 | `server.js:1633-1695` |
| 前台 UI | 加入时弹「选择 Steam 账号」多选弹窗；详情/卡片显示"愿望单账号"（Steam 账号名） | `Home.vue:82`（弹窗）、`:80`（详情愿望单账号）、`:211`（卡片徽标文案） |
| 前台清单 | 首页「愿望单」tab 按愿望单过滤游戏列表（含价格/史低） | `Home.vue:109`、`:215` |
| 后台清单 | **没有**愿望单清单页面/接口（`grep admin.*wishlist` 无结果） | — |
| 数据表 | `user_wishlist(user_id, game_id, steam_ids)`；`steam_wishlist` 为 Steam 同步数据（独立） | `steam-login.js:52-71` |
| Steam 愿望单同步 | `sync-wishlist` 任务照常拉 Steam 愿望单（差异删除 + 对账），与手动愿望单解耦 | `steam-accounts.js:72-140` |

## 2. 已确认的决策（2026-11-10 所有者）

| # | 决策 |
|---|---|
| 1 | 愿望单**只加到本站当前账户**，不再与 Steam 关联（不推 Steam） |
| 2 | 前台用**首页现有「愿望单」tab**，不新增页面 |
| 3 | 后台新增**「愿望单」菜单**（全站列表） |
| 4 | 后台**支持删除，不允许新加** |
| 5 | 删除粒度：**单条 + 批量** |
| 6 | **全面解耦**：加入/移除弹窗去掉 Steam 账号多选；详情/卡片不再列 Steam 账号 |
| 7 | **保留**：加入即建史低提醒（`watchlist` source=`user_wishlist`，行为不变） |

## 3. 数据模型

- `user_wishlist` 保留（`user_id` + `game_id` 唯一）；`steam_ids` 列保留但**停止写入**（新写入存 `'[]'`），
  历史值不迁移、不影响展示；
- 史低提醒规则不变（加入 → 建 `watchlist(source='user_wishlist', region='cn', target_cents=null)`；移除 → 清）；
- `steam_wishlist` 表与 `sync-wishlist` 任务**不动**（同步数据仅后台/管理用途，不再参与前台愿望单展示）。

## 4. 服务端

### 4.1 用户侧接口简化

- `POST /api/wishlist`：只收 `{ appid | gameId }`；`steamIds` 字段**忽略**（兼容旧前端，不报错、不推送）；
  只写 `user_wishlist` + 建史低提醒；日志 `wishlist.added`（`userId`、`gameId`、`appid`）；
- `DELETE /api/wishlist/:appid` / `/api/wishlist/id/:gameId`：只删本站愿望单 + 清自动提醒；
  body 兼容忽略；返回 `{ siteRemoved }`；日志 `wishlist.removed`（`userId`、`gameId`、`siteRemoved`）；
- `POST /api/wishlist` 不再加载/解密 Steam API Key、不再调用 `pushWishlist`。

### 4.2 管理端接口

- `GET /api/admin/wishlists?limit=200&q=&userId=`（仅管理员）：`user_wishlist` join `users` + `games`（name/steam_appid）+
  `game_region_snapshot`（region='cn' 的当前价/史低），返回 `{ items: [{ id, userId, username, gameId, name, steamAppid, currentLow, histLow, addedAt }], total }`；
  `q` 匹配用户名/游戏名/AppID；`userId` 精确筛选；
- `DELETE /api/admin/wishlists/:id`（仅管理员）：删该行 + 清该用户该游戏的 `watchlist(source='user_wishlist')`；
  日志 `wishlist.admin_removed`（`admin`、`userId`、`gameId`）；
- 批量：`src/server.js` 的 `BULK_ACTIONS` 增加 `'wishlists/delete'`：`max: 200`、`keyType: 'id'`、`risk: 'low'`、
  `run: bulkWishlistDelete`（复用批量二次确认与 bulk_ops 审计）；
- **不提供任何新增/编辑愿望单的管理端接口**（明确不做）。

### 4.3 鉴权与边界

- 用户侧：`requireUser()`；管理端：`requireAdmin()`；非管理员访问管理端接口 403；
- 无新增外部请求（不再碰 Steam）；不新增依赖。

### 4.4 每账号「API Key」改为账号同步用（2026-11-10 修订，替代原「下线推送 key」）

**背景**：原每账号 key 唯一用途是写愿望单（`AddToWishlist`，AA 批实测 401 已失效）；游戏库/愿望单同步一直用的是
**全局 `STEAM_API_KEY`**（数据源与采集）。2026-11-10 所有者要求：**同步时每个 Steam 账号用自己不同的 API Key**，
全局 key 只保留给系统级采集任务。

**决策（2026-11-10 所有者确认）**：

1. 账号级同步（**游戏库 / 愿望单**）一律使用**该账号自己的 API Key**（`steam_accounts.api_key_enc` 解密后使用）；
2. **未配置 → 直接报错**（「该账号未配置 API Key，请先在后台填写」），**不回退**全局 key；
3. 账号 key 无效（401/403）→ 直接报错（「该账号 API Key 无效，请检查」），**不回退**系统 key；
4. 全局 `STEAM_API_KEY`（数据源与采集）**仅保留给系统级任务**：catalog 目录导入、steam-status、backfill、heat、rename、
   discover 等无账号归属的采集；
5. **绑定新账号时不再自动同步**（此时还没有该账号的 key），提示「请先为该账号配置 API Key，再点同步」；
6. 后台 Steam 账号页「推送 Key」列改名 **「API Key」**，弹窗说明改为「用于该账号同步游戏库/愿望单；未配置时无法同步」；
7. `steam_accounts.api_key_enc` 数据列**保留**（BF 批原「删 api_key_enc 列」取消），历史值保留。

**改动清单**

- `src/steam-accounts.js` / `src/server.js`：账号同步入口改为「取该账号 key（解密）→ 无 key 报错 → 直接用」；
  账号同步路径不再使用 `requireSteamApiKey()`（系统任务路径保留）；
- `src/cli.js` 的 `steam-accounts` 调度任务：逐账号取自己的 key；未配置的账号**跳过并记日志**（`steam.account_sync_skipped`），
  不因单个账号缺 key 中断整轮；
- `src/server.js` 绑定流程：去掉绑定后的自动同步，返回「已绑定，请先配置 API Key 再同步」提示；
- 前端 `AdminExtras.vue`：「推送 Key」→「API Key」+ 文案更新；未配置 key 时同步按钮置灰或点击报错；
- 系统级任务（catalog/steam-status/backfill/heat/rename/discover）继续用全局 key，不改；
- 测试：key 选择逻辑（有 key 用账号 key、无 key 报错、key 无效报错、不回退、系统任务不受影响）。

**验收（增补到 §8）**：

9. 账号 A 配 key1、账号 B 配 key2：同步 A 实际用 key1、同步 B 用 key2（测试断言/日志）；
10. 未配置 key 的账号同步 → 报错「该账号未配置 API Key」，**不发请求、不回退**全局 key；
11. 账号 key 无效 → 报错「该账号 API Key 无效」，不回退系统 key；
12. 绑定新账号后不自动同步，提示先配置 key；
13. 系统任务（catalog 等）仍用全局 key，不受影响。

## 5. 前端（用户侧 `Home.vue`）

- `toggleWishlist`：未加入 → 直接 `POST /api/wishlist`（**无弹窗**）；已加入 → 确认后 `DELETE`（仅本站）；
- 删除：`wishlistPick` / `wishlistRemovePick` 两个弹窗、`steamAccounts` 及其加载、`wishAccAlready`、
  `openWishlistRemove`、`confirmWishlist`、`confirmWishlistRemove`；
- 详情弹窗「愿望单账号」区块：只显示「本站愿望单」标签，不再列 Steam 账号；
- 卡片徽标文案：只显示「愿望单」，不再拼账号名（`wishlistByText` 删除或改空）；
- 前台「愿望单」tab 不变（仍按 `wishlist=true` 过滤，价格/史低正常）；
- 移动端同 `toggleWishlist`；无 Steam AppID 的条目仍可加入本站愿望单。

## 6. 后台（控制台）

- `Console.vue`：内容运营组加 `{ id:'wishlist', label:'愿望单', glyph:'★', description:'全站用户愿望单，可查看与删除' }`；
  `nativeSections` 加 `'wishlist'`；
- `AdminModules.vue` 新增 `section==='wishlist'`：
  - 表格列：用户 / 游戏（名称 + AppID）/ 当前价 / 史低 / 加入时间 / 操作（删除）；
  - 筛选：关键词（用户名/游戏名/AppID）+ 分页；`BulkBar`（批量删除，二次确认）；
  - **不提供「新增」按钮**（页面说明「后台只读+删除，新增请走前台愿望单按钮」）；
  - 移动端卡片布局；
- 测试计数：`test/admin-bulk.test.js` 的勾选列/BulkBar 计数 +1（随新表格更新）。

## 7. 日志

| 事件 | 级别 | 字段 |
|---|---|---|
| `wishlist.added` | info | `userId`、`gameId`、`appid` |
| `wishlist.removed` | info | `userId`、`gameId`、`siteRemoved` |
| `wishlist.admin_removed` | info | `admin`、`userId`、`gameId` |

旧的 `steam.wishlist_manual_add` / `steam.wishlist_manual_remove`（含 Steam 推送字段）随推送路径删除。

## 8. 验收

1. 加入愿望单：不再弹 Steam 账号多选；`POST /api/wishlist` 只写本站 + 建史低提醒；卡片/详情立刻显示「愿望单」；
2. 详情/卡片不再出现 Steam 账号名；移除确认后只删本站（无 Steam 回推请求）；
3. 前台「愿望单」tab 仍能过滤出愿望单游戏，价格/史低显示正常；
4. 后台新菜单「愿望单」：全站列表正确（用户/游戏/当前价/史低/加入时间），关键词与分页可用；
5. 后台可删除（单条 + 批量，二次确认）：删除后前台消失、该用户该游戏的自动提醒被清理；页面上没有「新增」入口；
6. 权限：普通用户访问 `/api/admin/wishlists` → 403；未登录用户访问 `/api/wishlist` → 401；
7. 旧接口兼容：带 `steamIds` 的旧请求不报错、不推送 Steam；
8. `npm test` 全绿（新增 `test/wishlist-site-only.test.js` 并入主链 + `test/admin-bulk.test.js` 计数更新）、
   `npm run frontend:build`、`npm run scan`。

## 9. 实施顺序

1. 服务端：简化 POST/DELETE + `GET /api/admin/wishlists` + `DELETE /api/admin/wishlists/:id` + `wishlists/delete` 批量条目；
2. 前端 `Home.vue`：去弹窗/去 Steam 账号展示；
3. 后台：`Console.vue` 菜单 + `AdminModules.vue` 列表/筛选/批量删除；
4. 测试与文档（PROJECT-OVERVIEW / WEB.md / TODO 状态）。

## 10. 本批不做

- 恢复 Steam 愿望单推送（需 OAuth 方案 B，另立项）；
- 前台独立愿望单页面（按决策 2 用现有 tab）；
- 后台新增愿望单入口（按决策 4 明确不允许）；
- 停用 Steam 愿望单同步任务（保留，见 §1 最后一行）。

## 11. 待确认

无（5 个细节已于 2026-11-10 确认）。
