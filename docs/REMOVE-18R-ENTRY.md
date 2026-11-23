# 移除 18R 查询入口（FG，待开发，2026-11-23）

> 所有者要求（2026-11-23）：系统关于 18R 的**查询条件去掉**（大陆部署不允许）；但**数据与同步能力保留**
> （开源项目，国外色情不违法地区可用同步），并要**能统计**出来。

## 1. 现状（18R 查询入口清单）

| 入口 | 位置 |
|---|---|
| Web 前台「18R」按钮 | `frontend/src/pages/Home.vue:27`（`adultFilter`，`adult=badge&rating=adult`） |
| Web 移动端筛选抽屉「18R」 | `Home.vue:221/227`（`filterTemp.adult`） |
| App 18R chip | `HomeScreen.kt` / `SearchScreen.kt`（`adultEnabled` → `adult=badge&rating=adult`） |
| 后台「内容分级」筛选 | `AdminModules.vue` 游戏管理（`rating=adult/mature`，与 API 同口径） |

## 2. 需求

1. **移除查询入口**：删除上述前台/App 的 18R 筛选 UI（按钮/chip/抽屉项/年龄确认弹窗入口）；
   后台「内容分级」筛选——按所有者口径：**一并移除**（统计改由独立统计区提供，见 FH）；
2. **保留能力**（不删）：
   - `/api/games` 的 `adult` / `rating` 参数（契约兼容——命令行/国外部署仍可用）；
   - `adult_flag`/`mature_flag` 数据与 `rating-backfill` 回填任务；
   - 站点策略 `SITE_ADULT_DISPLAY`（默认 `hide`；国外部署可设 `badge/show`）；
3. **不删除** App 的 DataStore 字段（`adultEnabled`）——仅移除 UI 入口，避免升级崩溃。

## 3. 验收

1. Web 前台/移动端、App 首页/搜索：**无 18R 入口**（按钮/chip/抽屉项）；年龄确认弹窗不再出现；
2. 后台游戏管理无「内容分级」筛选（或按所有者最终口径）；
3. `/api/games?adult=badge&rating=adult` 仍可用（命令行验证）；默认站点 `hide`；
4. 数据/回填任务不受影响；`npm test`（分段）+ `frontend:build` + `scan` 全绿；App 构建通过；
5. 截图对照（前台/App 无 18R 入口）。
