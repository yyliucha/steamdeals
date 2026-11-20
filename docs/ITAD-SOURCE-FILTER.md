# 游戏管理「ITAD」筛选改为来源筛选（DV，待开发）

> 状态：**已实现并发布 v2.28.0（2026-11-20，实现 0a6b978；QA docs/QA-DV.md 第 1 轮 ✅ 5/0/0/0）**。关联：`src/adapters/itad.js`、`src/server.js` 游戏管理列表筛选、`AdminModules.vue` 平台下拉。

## 1. 问题（代码证据）

- ITAD 是**聚合数据源**：采集的报价归到具体商店平台（`steam` / `gog` / `humble` / `fanatical` / `itad_<shopId>`），
  **从不写 `platform_code='itad'` 的报价**（`itad.js:24-32` `platformForShop`）；
- 后台「平台」筛选对 ITAD 用 `exists(... offers ... platform_code='itad')` → 永远为假，
  所以「ITAD」筛选永远 0 条（2026-11-19 线上截图确认，非数据丢失、非近期改坏）；
- ITAD 的源覆盖实际记录在 `game_source_sync(game_id, platform_code='itad', status='matched', external_id)`（`cli.js:844`）。

## 2. 方案 A（已确认）

- **筛选语义**：「ITAD」从「平台筛选」改为「来源筛选」——
  `exists (select 1 from game_source_sync gs where gs.game_id = g.id and gs.platform_code = 'itad' and gs.status = 'matched')`；
- **前端**：平台下拉里 `itad` 标签改为「**ITAD（来源）**」，与平台选项视觉区分（分隔线或分组）；
  其余平台（steam/sonkwo/gog/humble/steampy）行为不变；
- **后端**：`platform=itad` 参数走来源判定（上述 SQL），其它平台仍走 `offers.platform_code`；
- 不动采集链路（ITAD 报价仍归具体平台）；`pg.js:633` 启动补标记 SQL 保留（无害）。

## 3. 验收

1. 后台「游戏管理」选「ITAD（来源）」→ 列出有 ITAD 匹配标记（`game_source_sync.status='matched'`）的游戏，数量与库内 ITAD 标记一致；
2. 选其它平台（steam/sonkwo/gog/humble/steampy）结果与改动前一致；
3. ITAD 采集新匹配一批游戏后，刷新即可在「ITAD（来源）」下看到；
4. 前端标签/提示清楚区分「平台」与「来源」；
5. `npm test`（分段，含后台列表筛选测试）+ `npm run frontend:build` + `npm run scan` 全绿。

## 4. 待确认

无。
