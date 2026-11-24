# 内容分级：后台可筛 + 前台/App 按参数控制（FI，待开发，2026-11-24）

> 所有者要求（2026-11-24）：
> 1) 后台恢复「内容分级」筛选（管理端无限制）；
> 2) **前台也支持查成人数据**，但由系统参数控制——`site.adultDisplay`（`hide`/`badge`/`show`，默认 `hide`）；
> 3) 这个参数就是为**国家政策合规**设计的：默认隐藏（大陆不允许散布黄色信息），国外部署可设 `badge`/`show`。

## 1. 现状（代码证据）

| 项 | 现状 |
|---|---|
| 参数 | `site.adultDisplay`（settings，enum：hide/badge/show，默认 **hide**）→ env `SITE_ADULT_DISPLAY`；`/api/site` 返回 `adultDisplay` |
| 前端读取 | Home.vue 已读 `siteAdultDisplay`（`loadSiteInfo`），但 18R 入口已被 FG 移除 |
| 后台筛选入口 | FG 移除（后端 `rating` 参数保留） |
| 后台列表 | 默认全显示（含成人） |
| 统计卡片 | FH 已上（adult/mature 数量 + 回填覆盖） |

## 2. 需求（参数控制口径）

### FI-1 后台（管理端，始终可用）
- 恢复「内容分级」筛选：全部 / 成人（18+）/ 成熟 / 未分级 → `rating=adult|mature|none`；
- 后台列表默认全显示（含成人）；
- **不受 `site.adultDisplay` 影响**（管理端始终可查）。

### FI-2 前台（按参数控制）
- **`hide`（默认，大陆合规）**：前台**不显示** 18R 筛选入口；列表请求 `adult=hide`（成人内容不展示）；
- **`badge`**：显示 18R 筛选入口；选中 → `adult=badge&rating=adult`（只显示 18R 游戏 + 18+ 角标）；
- **`show`**：显示 18R 筛选入口；成人内容按普通内容展示（带 18+ 角标）；
- 参数值从 `/api/site` 的 `adultDisplay` 读取（已存在链路）。

### FI-3 App（按参数控制）
- 仅当站点 `adultDisplay != 'hide'` 时显示 18R chip（本地开关 `adultEnabled` 保留）；
- 为 `hide` 时不显示入口、请求 `adult=hide`。

## 3. 验收

1. **默认 hide**：前台无 18R 入口、列表无成人内容；后台可筛（FI-1）；
2. **设 badge**：前台出现 18R 入口，选中只看 18R（带角标）；后台筛选正常；
3. **设 show**：前台成人内容按普通展示（带角标）；
4. App：hide 无入口；badge/show 显示 18R chip；
5. 参数实时生效（`/api/site` 读取，刷新页面）；
6. `npm test`（分段）+ `frontend:build` + `scan` 全绿；截图对照（hide/badge 两态）。
