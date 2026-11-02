# DLC 同步与统计：问题定位 + 需求（待开发）

> 状态：**已定位，需求待确认**（2026-11-02）。本文给下一步开发用。
> 现象来源：后台「Steam 账号」页（v1.7.0 截图）：`游戏库 606 / DLC 0*`、`游戏库 54 / DLC 0`。

---

## 1. 现象

| 现象 | 用户描述 |
|---|---|
| A | 同步游戏库后，**DLC 数量为 0**（预期应统计到自己买过的 DLC） |
| B | 某一行的 DLC 数字后带 **`*`**（如 `0*`），不清楚含义 |

## 2. 定位（根因）

### 2.1 DLC 恒为 0：数据源就不含 DLC

- 拉取实现：[steam-login.js `fetchOwnedGames`](../src/steam-login.js) 调用
  `IPlayerService/GetOwnedGames/v1/?include_appinfo=1&include_played_free_games=1`。
  该接口返回的 `response.games[]` **只有"游戏"条目**，**不包含 DLC 拥有记录**
  （Steam Web API 的公开接口没有"已拥有 DLC"这一项；社区长期反馈见
  [Steam 讨论帖](https://steamcommunity.com/discussions/forum/10/1693785669868326876)、
  [IPlayerService 文档](https://partner.steamgames.com/doc/webapi/IPlayerService)）。
- 统计实现：[steam-accounts.js `listUserAccounts`](../src/steam-accounts.js) 的 `dlc` =
  `steam_games` 中 `games.app_type='dlc'` 的条数。由于 `steam_games` 里根本没有 DLC 行，
  **这个值天然为 0**（极少数把 DLC 当独立 app 卖、又被 GetOwnedGames 返回的才会计入）。
- 结论：**这不是"没同步成功"，而是当前数据源拿不到 DLC 拥有数据**——
  即使同步成功，DLC 也永远是 0。同步提示语里的"其中 DLC N 款"会永远显示 0，容易误导。

### 2.2 `*` 的含义：类型未知计数，且常常永远补不上

- 前端：[AdminExtras.vue](../frontend/src/pages/AdminExtras.vue) DLC 列
  `row.type_unknown > 0` 时渲染 `*`，tooltip 目前写的是"有 N 款类型未知，同步游戏库会自动补全"。
- 数据：`listUserAccounts.type_unknown` = 拥有条目中 `games.app_type IS NULL` 的数量。
- 补全逻辑：[steam-accounts.js `backfillOwnedAppTypes`](../src/steam-accounts.js) 用
  `fetchStoreItems`（CN 区）批量补 `app_type`，**只挑目录里已存在且 `app_type` 为空的 appid**。
- 为什么补不全：**锁国区/已下架的拥有游戏在 CN 商店接口里取不到**（GetItems 返回空），
  `app_type` 永远是 NULL → `*` 长期存在。所以 tooltip 里"同步会自动补全"的说法不严谨。
- 另注：`type_unknown` 只统计"目录里存在且类型为空"的条目；**目录里没有的拥有条目完全不计入**
  （`join games`），所以 `*` 也不能完整反映"统计不可靠"。

## 3. 需求决策（需先定方案）

Steam 公开 API 拿不到 DLC 拥有数据。可选方案：

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A（推荐）** | DLC 列改为 **"不支持"**（显示 `—` + tooltip 说明"Steam Web API 不返回 DLC 拥有数据"）；或直接移除该列 | 诚实、零维护 | 用户看不到 DLC 数 |
| B | 改统计口径为 **"这些游戏共有多少个可购买 DLC"**（appdetails 的 `dlc[]` 求和） | 有数字看 | **不是"已拥有"**，极易误解，且要按游戏逐个请求（几百次/账号） |
| C | 用 Steam **登录态 cookie** 请求 `store.steampowered.com/dynamicstore/userdata/`（返回 `rgOwnedApps`，含 DLC） | 能拿到真 DLC | 需要用户 Steam 密码/会话 cookie，安全风险大；OpenID 拿不到登录态 → **不建议** |
| D | 只保留"类型未知"提示，去掉 DLC 数字列 | 简单 | 同 A |

**建议：A**。若一定要"已拥有 DLC"，只能走 C，需要所有者明确接受安全代价。

### 无论选哪个方案，都要修的两个"误导点"

1. 同步成功提示"其中 DLC N 款"（[AdminExtras.vue](../frontend/src/pages/AdminExtras.vue)
   `syncSteam` 的 ElMessage）——DLC 永远 0，应删掉或改为"（DLC 不支持统计）"。
2. DLC 列 tooltip「同步游戏库会自动补全」——不准确。应改为
   「有 N 款拥有游戏在国区商店取不到类型（锁区/下架），无法自动补全」。

## 4. 改动清单（按方案 A）

**后端**

- `src/steam-accounts.js`
  - `listUserAccounts`：去掉 `dlc` 子查询（或保留但改名为 `dlcKnown` 并在接口层不暴露）；
    建议改为返回 `dlcUnsupported: true`，让前端显式渲染"—"。
  - `ownedTypeStats`：`dlc` 字段可删除（或保留给调试日志），`typeUnknown` 保留。
  - 同步完成日志 `steam.library_synced` 可保留 `diffDeleted`，不需要 dlc。
- `src/server.js`（库同步接口）：返回体里的 `dlc` 删除，或改为 `dlcUnsupported: true`。

**前端**

- `frontend/src/pages/AdminExtras.vue`
  - DLC 列：显示 `—`，tooltip「Steam Web API 不返回 DLC 拥有数据（只统计游戏）」；`*` 逻辑删除。
  - 同步成功提示：去掉"其中 DLC N 款"。
  - 类型未知：若要保留提示，改成独立小徽标（如「类型未知 3」），tooltip 文案按 §3 修正。

**文档**

- [STEAM-ACCOUNTS.md](STEAM-ACCOUNTS.md) 增补"已知限制：DLC 拥有数不可得"。
- README「已知限制」补一行。

**测试**

- `test/steam-accounts*.test.js`：`listUserAccounts` 不再断言 `dlc`；若有断言 `type_unknown` 保留。
- 前端无单测，靠 `npm run frontend:build` + 后台页面目视。

## 5. 验收标准

1. 后台「Steam 账号」页 DLC 列不再显示误导性数字（按方案 A 显示 `—` + 说明 tooltip）。
2. 同步成功提示不再出现"其中 DLC 0 款"。
3. `*` 不再出现；若保留"类型未知"提示，其 tooltip 明确说明"锁区/下架条目无法自动补全"。
4. `npm test` 全绿、`npm run frontend:build` 通过；不自行构建（硬规则 5）。

## 6. 若所有者坚持要"已拥有 DLC"（方案 C 的前置条件）

需要额外确认：

- 是否接受"用户提供 Steam 登录态（cookie）"来换取 DLC 数据？这等于要求用户把 Steam 会话交给站点，
  **安全风险高**，建议不做；或只做"本地自用"模式（单用户部署）并明确写风险。
- 若不接受，则 DLC 拥有数据在本项目的数据源下**不可实现**，只能按方案 A 诚实标注。

---

### 参考

- Steam 社区讨论：`GetOwnedGames` 不返回 DLC —
  <https://steamcommunity.com/discussions/forum/10/1693785669868326876>
- Steamworks `IPlayerService` 文档：<https://partner.steamgames.com/doc/webapi/IPlayerService>
