# 封面图补图覆盖率：header_image 补全 + 预取扩大 + 缺图负缓存可手动清（待开发）

> 状态：**已实现并发布 v2.8.0（2026-11-10，3ebc515）**（提高补图覆盖率；占位块保留为兜底）。
> 关联：[IMAGE-FETCH.md](IMAGE-FETCH.md)（AW 批：404 快失败 / 负缓存分层 / header_image 直链，已发布 v2.7.0）·
> [PROJECT-OVERVIEW.md](PROJECT-OVERVIEW.md) · [DEPLOY.md](DEPLOY.md)

## 1. 现状与根因（代码事实，2026-11-10 核对）

| 项 | 事实 | 证据 |
|---|---|---|
| 前台占位块 | AW 批（v2.7.0）起，封面加载失败/无 AppID 显示 `.cover-placeholder`（渐变 + 首字），不再用 favicon | `Home.vue:31,67,80,278-284` |
| 缺图链路 | 首页卡片 `cover(g)` → `/img/steam/<appid>/header`；本地无文件 → 按 `header_image` 直链（若白名单合法）→ 老路径 3 候选取；都失败 → 404 + **负缓存 24h（notfound）** | `server.js:1150-1190`、`images.js:169-207` |
| 根因① | 新游戏经价格类同步（`GetItems` 批量 / `appdetails?filters=price_overview`）入库——响应**没有 header_image**；只有走元数据同步（`backfill`/`import`/`rename` 的 `upsertGameMeta`）才会写 `header_image` | `steam-meta.js:109`、`pg.js:2459`（`header_image = coalesce(excluded.header_image, games.header_image)`） |
| 根因② | 这些游戏的老路径 `/steam/apps/<appid>/header.jpg` 也 404（2024 后资产在新路径）→ 首次访问 404 后进 24h 负缓存，**即使 header_image 后来补上，也要等负缓存过期才重试** | `server.js:194`（`IMG_MISS_TTL`） |
| 根因③ | `images pull` 每轮只补 `images.limit` 款（默认 200，间隔 240 分钟）→ 覆盖约 3%（10 万有价游戏） | `scheduler.js:185-198`、`settings.js:182` |

**结论**：缺图不是渲染 bug（占位块是设计），而是「`header_image` 入库覆盖率低 + 负缓存把恢复推迟 24h + 预取覆盖低」三层叠加。

## 2. 已确认的决策（2026-11-10 所有者）

1. **提高补图覆盖率**：`header_image` 补全 + 预取扩大 + 缺图负缓存可手动清；
2. 前端占位块保留（v2.7.0 设计不变，作为兜底）。

## 3. 设计

### 3.1 header_image 补全（合并进已有任务，零额外请求）

**合并评估（HANDOVER §4.1）**：`steam-status` 一个轮次本来就用**全量 appdetails**（响应含 `header_image`），
`backfill` 本来就走 `upsertGameMeta`（含 metadata）。两者响应里都已有该字段 → **并入已有任务，不新建任务、不加请求**。

1. `steam-status`（`steam-status.js` 的 `runSteamStatusRound` / `applySteamDetails`）：写状态时若响应有
   `header_image` 且库内为空 → 顺带 `update games set header_image = coalesce(header_image, $1)`；
2. `backfill` 候选补充：把「已有价格但 `header_image is null`」的游戏纳入候选（在现有候选 SQL 上追加条件），
   回填一次即补上（`upsertGameMeta` 已做 `coalesce` 保护，人工维护值不覆盖）；
3. 日志：`steam-status.header_image_filled`（count）——每轮写入数，便于观察收敛。

### 3.2 预取扩大（`images` 任务参数）

- `images.limit` 默认 **200 → 500**（`settings.js` `def('images.limit', ..., 500, { max: 5000 })`）；
- 间隔仍 240 分钟（单轮时长：500 款 × 2 尺寸 ×（~1.5s 取图 + 0.3s 间隔）≈ **20–25 分钟**，不挤占其它任务；实测现状
  200 款约 5 分钟，线性外推可靠）；
- 生产库若已保存旧值（`settings` 表 `images.limit`），**部署侧**在「系统设置 → 高级 → 每轮补图数量」改为 500
  （或运营直接改库），代码默认值只影响新库/未保存过的库；
- 尺寸保持 `header,capsule_sm_120` 不变（列表用 header；胶囊用于其它位置）。

### 3.3 缺图负缓存可手动清

- 后端：`POST /api/admin/images/reset-miss`（仅管理员）：清空 server 进程内 `imgMissCache`
  （`server.js` 实例 Map），返回 `{ cleared: N }`；**不动磁盘缓存、不动 `data/images`**；
- 前端：控制台「数据报表 → 图片与备份 → 封面缓存」卡片加按钮「清除缺图缓存」（二次确认，提示「清空后前台会重新尝试取图」）；
- CLI（运维兜底）：`node src/cli.js images reset-miss`（仅清进程内不可行——CLI 是独立进程，改为提示该操作需在
  server 侧做；因此 **CLI 不提供**，只保留后台按钮 + API）。

### 3.4 前端占位块

保持 v2.7.0 现状（`.cover-placeholder` 渐变 + 游戏名首字），不改样式。

## 4. 验收

1. `steam-status` 一轮后，库内 `header_image` 非空数量增加（日志 `steam-status.header_image_filled` > 0）；
2. `backfill` 候选包含「有价且 header_image 为空」的游戏，跑一轮后其 `header_image` 补齐；
3. `images.limit` 默认 500（新库），生产设置页可改；单轮时长 < 30 分钟；
4. 后台「清除缺图缓存」按钮：点击后 `POST /api/admin/images/reset-miss` 返回 cleared>0，
   随后前台请求同一游戏会重新走取图（若已有 header_image 可立即显示）；按钮有二次确认；
5. 前端占位块行为不变（失败仍显示占位块）；
6. `npm test` 全绿（新增：`test/image-coverage.test.js` 断言 reset-miss 接口与 steam-status 补 header_image；`test/scheduler` 参数）、
   `npm run frontend:build`、`npm run scan`。

## 5. 实施顺序

1. `steam-status` 顺带写 header_image + `backfill` 候选补条件（同一次响应/同一任务）；
2. `images.limit` 默认 500 + 设置页说明；
3. `reset-miss` 接口 + 后台按钮；
4. 测试与文档同步。

## 6. 本批不做

- 保证每个游戏都有 `header_image`（依赖 Steam 响应，部分游戏确实无资产）；
- 由 header_image 推导其它尺寸（hash 不可推导，AUD 批已定不做）；
- 预取全量 10 万款（带宽与配额不划算，覆盖率提升靠 3.1 + 3.2 组合）。

## 7. 待确认

无（2026-11-10 确认「提高补图覆盖率」方向）。生产已保存的 `images.limit` 旧值属部署侧操作，写进验收第 3 条。

## 8. EC 图片覆盖治理（2026-11-19 立项，待开发）

> 背景（2026-11-19 实测）：热门游戏 10/10、冷门抽样 19/20 图片 200；个别游戏 header_image 为空
> （如 PEAK 3527290）→ 图片缺失。不是同步服务停工，是「数据缺失 + 无监控 + 无占比反馈」。

- **EC-1 管理后台「图片覆盖看板」**：后台「运行与同步」（或图片区）显示：游戏总数 / 有 header_image 数 /
  本地已缓存数（imageStats）/ 缺图数 + 缺图游戏列表（分页，标原因：header_image 空 / CDN 404 / 抓取失败）+
  「重置缺图负缓存」按钮（复用已有 POST /api/admin/images/reset-miss）。
- **EC-2 缺图回填任务**：定时（或手动「重同步缺图」）扫描 header_image is null 的游戏 → 触发元数据重同步
  （rename/backfill 路径补 header_image）；限速防 429；日志 images.backfill_*；回填后缺图数下降。
- **EC-3 前端占位图**：缺图时显示品牌占位（S 标/首字），列表与详情统一，不再空白块。
- **验收**：① 看板数字与 SQL 统计一致、缺图列表可翻页；② 回填任务跑一轮后缺图数下降（对比截图/日志）；
  ③ 缺图游戏前端显示占位图；④ npm test（分段）+ frontend:build + scan 全绿。
- **不做**：全量预取、从 header 推导其它尺寸（AUD 批已定不做）。
