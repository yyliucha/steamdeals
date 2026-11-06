# 后台游戏管理：平台链接抽屉 + 游戏名点击复制（待开发）

> 状态：**需求已确认（2026-11-06），待开发**。
> 关联：[ADMIN-PARITY.md](ADMIN-PARITY.md)、[WEB.md](WEB.md)、[TODO.md](TODO.md) 的 AG 条目。

## 1. 需求（设计向，不是字面加一列）

1. 后台「游戏管理 → 游戏目录」加一个**链接入口列**：单元格只显示数量（如 `3 个`），
   **点击展开抽屉（或独立页面）**，里面是该游戏**所有平台链接的清单**（可逐条打开）；
2. **后台游戏名支持点击复制**；
3. **前台也要有复制游戏名**的能力；
4. 不把多条链接硬塞进单元格（列宽不够、手机更糟）。

## 2. 现状（代码事实）

- 链接在 `offers.buy_url`（`pg.js:53`），按 `(game_id, platform_code, region)` 存，同平台可能多条；
- 后台列表 `GET /api/admin/games`（`server.js:1448`）不返回任何链接；
- 后台表格列：勾选 / 游戏 / 平台 / Steam 价 / 信息 / 报价 / 状态 / 同步状态 / 分级 / 操作；
- 前台卡片标题在 `Home.vue:33` 附近的 `.game-title`，详情标题在弹窗头部；
- 尚无统一复制工具函数（全仓没有 `navigator.clipboard`）。

## 3. 方案

### A. 新增接口：单游戏的全部链接

`GET /api/admin/games/:id/links`（仅管理员）：

```sql
select o.platform_code, p.name as platform_name, o.region, o.currency,
       o.price_cents, o.original_cents, o.discount_pct, o.in_stock,
       o.buy_url, o.last_seen_at
  from offers o join platforms p on p.code = o.platform_code
 where o.game_id = $1 and o.buy_url ~ '^https?://'
 order by p.name, o.region, o.last_seen_at desc
```

返回 `{ game: { id, steam_appid, name, name_en }, links: [...] }`；
`buy_url ~ '^https?://'` 过滤脏数据（`javascript:` 之类）。

### B. 列表接口只返回数量

`/api/admin/games` 的列表 SQL 加一列 `link_count`（不返回完整链接，避免列表变重）：

```sql
(select count(*)::int from offers o where o.game_id = g.id and o.buy_url ~ '^https?://') as link_count
```

### C. 前端：链接入口列 + 抽屉

- 列名「链接」，单元格：`{{ row.link_count }} 个`（0 显示 `—`，不可点）；
- 点击 → 打开 **el-drawer**（桌面右侧 520px，手机全屏，复用 Z 批的 `mobile-full` 思路）；
- 抽屉内容：
  - 顶部：游戏名 + AppID，各带复制按钮；
  - 列表：每行 `平台名 · 区服 · 价格 · 最后更新` + 「打开」按钮（`target="_blank" rel="noopener noreferrer"`）；
  - 空态：若无链接但有 `steam_appid`，给一条 Steam 商店兜底链接（`https://store.steampowered.com/app/<appid>`，弱化样式）；
- 抽屉打开时才请求接口（按需加载，不用列表数据）。

### D. 复制能力（后台 + 前台）

新增 `frontend/src/utils/clipboard.js`：

```js
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 继续降级 */ }
  // HTTP 环境或旧浏览器：临时 textarea + execCommand
  ...
}
```

理由：站点可能跑在 HTTP（或部分浏览器屏蔽 clipboard API），必须有降级，否则"点了没反应"。

接入点：

| 位置 | 交互 |
|---|---|
| 后台表格「游戏」列 | 名称旁一个复制图标（点击只复制，不触发其他动作），悬浮提示"复制游戏名" |
| 后台链接抽屉 | 游戏名、AppID 各一个复制按钮 |
| 前台卡片标题 | 标题旁小复制图标（`@click.stop`，不触发打开详情） |
| 前台详情弹窗标题 | 同样加一个复制按钮 |

复制成功 `ElMessage.success('已复制')`；失败 `ElMessage.warning('复制失败，请手动选择')`。

### E. 不做

- 不做链接有效性校验（404 照常显示）；
- 不做批量复制/导出 CSV（后续需要再提）；
- 不在前台展示平台链接（仅后台）。

## 4. 影响面

| 文件 | 改动 |
|---|---|
| `src/server.js` | 新增 `GET /api/admin/games/:id/links`；列表 SQL 加 `link_count` |
| `src/store/pg.js` | 新增 `adminGameLinks(q, { gameId })`（SQL 见 §3-A） |
| `frontend/src/utils/clipboard.js` | **新增**：`copyText()`（clipboard API + execCommand 降级） |
| `frontend/src/pages/AdminModules.vue` | 链接列 + 抽屉 + 名称复制按钮 + 样式 |
| `frontend/src/pages/Home.vue` | 卡片标题、详情标题加复制按钮（`@click.stop`） |
| `test/admin-games.test.js` | 新增：链接接口只返回 http(s)、按平台排序、非管理员 403 |
| `docs/WEB.md` | 补接口与字段说明 |

## 5. 验收

1. 有 3 个平台链接的游戏：列表显示「3 个」，点击打开抽屉，三条都在，点击可打开；
2. 同一平台两个区服：抽屉里两行都显示（区服不同）；
3. 无链接：显示 `—`，不可点击；
4. 无链接但有 AppID：抽屉里出现 Steam 商店兜底链接；
5. `buy_url` 为 `javascript:` 的记录**不出现在**抽屉里；
6. 后台点击游戏名复制成功（提示"已复制"），且**不触发**行内其他动作；
7. 前台卡片标题旁复制图标可复制，且**不打开详情**；详情标题同样可复制；
8. 手机宽度下抽屉全屏、可滚动、可点开链接；
9. `npm test` 全绿（`test/admin-games.test.js`）、`npm run frontend:build`、`npm run scan`。

## 6. 待确认（不阻塞，按默认实现）

| # | 问题 | 默认 |
|---|---|---|
| 1 | 链接入口用**抽屉**还是独立页面？ | 抽屉（不打断当前列表位置） |
| 2 | 前台"点击复制"是点**标题文字**，还是标题旁的小图标？ | **小图标**（点标题文字仍打开详情，避免误触） |
| 3 | ITAD 聚合站算不算链接？ | 不算（不是购买渠道） |
| 4 | 抽屉里要不要显示价格与最后更新时间？ | 显示（运营判断链接是否过期有用） |
