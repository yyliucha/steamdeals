# 查询口径修复：所有查询不再排除已拥有（CV，P0 体验）

> 状态：**已确认待开发（2026-11-18，所有者口径：系统查询不排除已拥有）**。
> 关联：[TODO.md](TODO.md) CV 条目、[USER-ALERTS.md](USER-ALERTS.md) §1 #3（已拥有终态）、
> [APP-PARITY.md](APP-PARITY.md)（App 与 Web 对齐）、[APP-API.md](APP-API.md)（App 契约）。

## 1. 现象与根因（2026-11-18 实测）

**现象**：安卓 App 搜索「赛博朋克2077」→「暂无数据」；Web 能搜到；App 数据量偏少。

**根因**：查询默认 `owned='exclude'`——
- 前端 `Home.vue:238`：`owned: activeTab==='owned' ? 'only' : 'exclude'`（「全部 / 感兴趣 / 不感兴趣」都排除已拥有，**搜索也用这条**）；
- 服务端 `gameSearch` 默认 `owned='exclude'`（`src/store/pg.js:1553`）；
- App 搜索请求未带 `owned` → 服务端默认排除 → 登录用户的已拥有游戏整批消失；
- 实测：用 App 相同参数/UA 请求 `/api/app/games?q=赛博朋克2077…` 返回 `total=1`，**服务端搜索本身正常**。

## 2. 已确认口径（所有者 2026-11-18）

| # | 决策 |
|---|---|
| 1 | **系统所有查询不排除已拥有**：「全部 / 感兴趣 / 不感兴趣」列表与**搜索**都包含已拥有游戏（`owned=include`）。 |
| 2 | 「已拥有」页签保留为**筛选**（`owned=only`），不做删除。 |
| 3 | **已拥有游戏显示对应的 Steam 账号**：列表卡片徽标显示账号名（现已有 `已拥有 xxx +N`）；详情页显示「已拥有账号：全部账号」。 |
| 4 | **已拥有游戏按钮不同（终态）**：详情页其余操作隐藏，**只保留「去 Steam 商店」**——Web 已实现（`USER-ALERTS` §1 #3）；App 需对齐。 |
| 5 | 服务端 `gameSearch` 默认值**保持不变**（`exclude`），由前端显式传 `include`（避免影响其它调用方/后台）。 |
| 6 | App 端：列表/搜索带 `owned=include`；已拥有卡片显示「已拥有」徽标；详情按钮按终态显示（无账号名时显示「已拥有」）。 |

## 3. 改动落点

- `frontend/src/pages/Home.vue`：`loadGames` 的 `owned` 由 `exclude` 改 `include`（`已拥有` tab 仍 `only`）；确认搜索与列表同口径；
  卡片徽标沿用现有 `ownedByText`（前两个账号 +N）；详情终态保持（已实现）。
- `frontend` 之外：`GET /api/games` 不变；如后台某处依赖默认 `exclude`，确认不回归（后台游戏管理用独立接口）。
- App（`steamdeals-app`）：`SearchScreen`/`HomeScreen` 请求加 `owned=include`；卡片与详情按 `owned` 字段显示徽标；
  详情终态（只留 Steam 商店）——账号名需要 `/api/app/games/:appid` 返回 `owned_by`（当前契约只有 `flags`）：
  **站点侧给 App 详情补 `owned_by`（只读账号名数组）**，App 展示；若暂不加，App 先显示「已拥有」。
- 测试：`test/api.test.js`/`gameSearch` 断言「include 时不排除已拥有」；App JVM 单测断言请求带 `owned=include`。

## 4. 验收

1. 登录且已拥有：Web「全部」列表与搜索都能看到该游戏，卡片标「已拥有 账号名」；详情只显示「去 Steam 商店」+ 账号名；
2. App：搜索「赛博朋克2077」出现结果且标「已拥有」；详情无其它操作按钮（或按 §3 的降级显示）；
3. 未登录：行为不变（无已拥有概念，不标徽标）；
4. 「已拥有」页签仍只显示已拥有游戏；
5. 服务端默认值未变（其它调用方不受影响）；
6. `npm test` / `frontend:build` / `scan` 全绿；App 侧构建 + 模拟器验证。

## 5. 待确认

1. App 详情是否补 `owned_by`（账号名）？建议补（与 Web 一致）；不补则 App 只显示「已拥有」。
2. 「全部」列表包含已拥有后，首页统计/筛选是否需要在 UI 上提示"含已拥有"？（建议不提示，徽标已足够）
