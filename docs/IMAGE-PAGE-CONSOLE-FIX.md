# 数据统计「图片与备份」页 console 三报错修复（GB，待开发）

> 状态：**已确认待开发（2026-11-27）**。所有者实测截图：访问「数据统计 → 图片与备份」时 console 三条报错 +
> 图片覆盖看板数字全空（`—`）。
> 关联：`src/routes/admin-images.js`（`GET /api/admin/images/coverage`）、
> `src/store/admin-images-repository.js`（`imageCoverageRows`）、`frontend/index.html`、`frontend/public/`、
> [IMAGE-COVERAGE.md](IMAGE-COVERAGE.md)（EC 批原始规格）

## 1. 三问题的根因（2026-11-27 代码核实）

| # | console 现象 | 根因 | 影响 |
|---|---|---|---|
| 1 | `Failed to load resource: 503`（请求 `coverage`） | `imageCoverageRows()` 是**全表查询**（`select g.steam_appid, g.header_image from games where …`，线上约 19.6 万行），把全部行拉到 Node 内存再 `filter` 统计；超过 `requestTimeoutMs=15000` → 服务端 503「请求超时，请稍后再试」 | **图片覆盖看板数字全部显示 `—`**（前端 `coverage.stats.totalGames ?? '—'`），功能不可用 |
| 2 | `Failed to load resource: 404` | `frontend/index.html:12` 的 `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />` 指向的文件**在 `frontend/public/` 不存在**（只有 `icon-192.png` / `icon-512.png`） | iOS 添加到主屏时无自定义图标（回退系统截图），且每次访问一次 404 |
| 3 | `apple-mobile-web-app-capable is deprecated` | `frontend/index.html:10` 只写了旧标签 | 低危：Chrome 提示；iOS 仍认旧标签，但新规范要求 `mobile-web-app-capable` |
| 4 | `Permissions policy violation: unload`（`hm.js`） | **第三方**（百度统计）使用已废弃的 `unload` 事件，Chrome 117+ 默认禁用 | **不修**：非本站代码，不影响功能；站点侧无法消除（除非删除统计），仅 console 噪音 |

## 2. 修复方案

### 2.1 coverage 接口改 SQL 聚合（P0）

`src/store/admin-images-repository.js` 新增两个聚合函数（替代全量拉行）：

```sql
-- 总数 / 有 header_image 数（一次聚合）
select count(*)::int as total,
       count(header_image)::int as with_header
  from games
 where steam_appid is not null and not deleted;

-- 只查负缓存里那些 appid 是否在库、是否有 header_image（负缓存是内存 Map，量小）
select steam_appid, header_image from games
 where steam_appid = any($1::int[]);
```

`src/routes/admin-images.js` 的 coverage 分支改用上述聚合：
- `totalGames = total`、`withHeaderImage = with_header`、`noHeader = total - with_header`；
- `cdn404` / `fetchFailed` 只遍历「负缓存 ∩ 库内」的小集合；
- 缺图分页列表保持 `imageCoverageMissingRows`（本来就是分页，不动）；
- **接口响应契约不变**（`{stats:{...}, items, total, page, pageSize}` 字段与语义一致）。

### 2.2 apple-touch-icon（P1）

- 生成 `frontend/public/apple-touch-icon.png`（180×180，从 `icon-512.png` 缩放；无 Pillow 时可用 `icon-192.png` 直接拷贝改引用）；
- 若生成 180×180 成功 → `index.html` 引用不动；否则改引用为 `/icon-192.png`。

### 2.3 mobile-web-app-capable（P2）

`frontend/index.html` 在旧标签旁**新增** `<meta name="mobile-web-app-capable" content="yes" />`
（旧 `apple-mobile-web-app-capable` 保留，iOS 需要）；`test/pwa.test.js` 增加「新标签存在」断言。

## 3. 验收（4 条）

1. **coverage 接口不再超时**：本机用 20 万行量级的 pglite 数据集请求 `GET /api/admin/images/coverage`，
   响应 < 1s（或断言「只执行了 count 聚合 + 小 IN 查询 + 分页，不再 select 全表」——用 SQL 静态断言兜底）；
2. 看板数字正确：`totalGames` / `withHeaderImage` / `cachedGames` / `missing` 与库内 SQL 口径一致（沿用 `test/image-coverage.test.js` 的既有断言并补充聚合口径）；
3. `frontend/public/apple-touch-icon.png` 存在（或引用指向存在的文件）；`index.html` 含 `mobile-web-app-capable`；
   `test/pwa.test.js` 通过；
4. `npm test`（分段）+ `frontend:build` + `scan` 全绿。

## 4. 本批不做

- 不动百度统计（`unload` 提示保持，见 §1 #4）；
- 不改看板前端布局/字段（数字空态改「加载失败 + 重试」属于前端体验，等 FY-2 改完 `AdminModules.vue` 后另批处理）；
- 不改 EC 批的缺图负缓存与回填任务逻辑。
