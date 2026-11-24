# 内容分级：后台可筛 + 前台/App 按参数控制（FI，2026-11-24）

> 所有者要求（2026-11-24）：
> 1) 后台恢复「内容分级」筛选（管理端无限制）；
> 2) **前台也支持查成人数据**，但由系统参数控制——`site.adultDisplay`（`hide`/`badge`/`show`，默认 `hide`）；
> 3) 这个参数就是为**国家政策合规**设计的：默认隐藏（大陆不允许散布黄色信息），国外部署可设 `badge`/`show`。

## 0. 状态

**已实现待发版（2026-11-24）**。FG（docs/REMOVE-18R-ENTRY.md）的「前台无入口」口径被本条目按参数覆盖：
hide（默认）仍无入口（大陆合规口径不变）；badge/show 部署恢复入口。FH「内容分级统计」卡片保留不受影响。

### 实现（2026-11-24）

| 端 | 改动 |
|---|---|
| 后台 `frontend/src/pages/AdminModules.vue` | 恢复「内容分级」下拉（全部内容分级=空 / 成人（18+）=adult / 成熟=mature / 未分级=none → `rating` 参数）；`loadGames` 请求带 `rating`；点指标卡时清空分级筛选。**不读 site.adultDisplay（管理端始终可查）** |
| 前台 `frontend/src/pages/Home.vue` | 恢复 18R 入口（PC 按钮 / 移动 chips / 筛选抽屉组），三处均 `v-if="siteAdultDisplay!=='hide'"`；`loadGames` 恒传 `adult=siteAdultDisplay`，选中 18R（`adultFilter`）时加 `rating=adult`（hide 时防御不生效）；搜索缓存 key 计入 adult/rating；站点策略变化时重置开关并重载列表；18+ 角标条件 `adult_flag && siteAdultDisplay==='badge'`（红 danger，与成熟内容 warning 区分；show 无角标） |
| 后端 `src/store/games-repository.js` | 修 compact 列表响应缺字段（**既有缺陷**）：读模型与 legacy 两条 compact 查询补 `steam_status/adult_flag/mature_flag`——这是 18+/成熟/状态角标的渲染前提（成熟内容角标同样受益） |
| App `steamdeals-app` | `AppViewModel` 恢复 `adultEnabled/adultConfirmed` 投影与 `setAdultEnabled/confirmAdult`，新增 `siteAdultDisplay`（/api/site 的 adultDisplay，启动与进首页/搜索时刷新）；`HomeFilterParams.paramsFor` 加 `adultEnabled/adultDisplay`（adult 恒传站点策略，选中且非 hide 时加 rating=adult）；HomeScreen/SearchScreen 18R chip 按 `adultDisplay!=='hide'` 显隐 + 年龄确认弹窗恢复 + 策略变化重拉；`GameCard` 加 `showAdultBadge`（badge 才渲染红色 18+ 角标，show 无角标）；SessionStore 字段/写入器保留（仅注释更新） |
| 测试 | 站点：`test/adult-display-control.test.js`（8 条，替换 FG 的 remove-18r-entry.test.js 并注册 test:3）——三态入口显隐 / adult 参数口径 / badge 角标 / 后台下拉映射 / FH 卡片保留 / stats 口径 / compact 双路径分级字段；App：`HomeFilterParamsTest` 重写 FI 六组参数映射用例 |
| 验证 | 站点相关测试全绿（adult-display-control 8/8、game-search-filter 10/10、game-search-read-model 16/16、search-perf 5/5、baseline-gate 5/5、api 38/38 等）+ frontend:build ✓ + scan 干净；headless Chrome 三态 DOM 断言 18/18（hide 无入口 3 款无成人 / badge 入口+角标+选中只看 18R / show 入口+无角标+选中只看 18R / 移动抽屉 badge 含 18R 组、hide 无）；后台 headless：下拉存在 + 选成人列表 1 款与 rating 一致 + 全部恢复 4 款（「成熟」切换由 api.test.js 后端契约与静态映射锁覆盖）；App testDebugUnitTest + assembleDebug BUILD SUCCESSFUL |

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
