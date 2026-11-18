# 后台「游戏目录」点游戏名弹详情（CW，待开发）

> 状态：**已确认待开发（2026-11-18，所有者需求；demo：[design/admin-game-popup-2026-11-18.html](design/admin-game-popup-2026-11-18.html)）**。
> 关联：[TODO.md](TODO.md) CW 条目、[ADMIN-CONSOLE-IA.md](ADMIN-CONSOLE-IA.md)（AT 批后台信息架构）、
> [APP-PARITY.md](APP-PARITY.md)（详情字段口径）、[IMAGE-FETCH.md](IMAGE-FETCH.md)（封面取图）。

## 1. 现状（2026-11-18 代码核对）

- 后台「游戏目录」列表的游戏名是**纯文本**：`AdminModules.vue` L67
  `<span class="game-name">{{ row.name||row.name_en||('appid:'+row.steam_appid) }}</span>`，**无点击行为**；
- 已有单款详情接口 `GET /api/games/:appid`（`src/server.js` L2139）→ 返回
  `{ game, offers, series, dlc, watch }`；`game` 来自 `GAME_SELECT`，含
  `description / developers / publishers / genres / tags / steam_status / required_age / 价格与史低 / 分级标记`；
- **缺两个字段**：`GAME_SELECT` **不含 `header_image` 与 `release_date`** → 弹窗要显示封面和发售日期需补；
- 封面：前台用 `/img/steam/<appid>/header`（已实测 200，可复用）；Steam 商店链接：
  `https://store.steampowered.com/app/<appid>/`。

## 2. 已确认需求

| # | 内容 |
|---|---|
| 1 | 后台「游戏目录」点**游戏名** → 弹出**小弹窗**（约 640px，移动端 100%）显示游戏详情；关闭不影响列表状态。 |
| 2 | 弹窗内容（自上而下）：**封面大图**（`/img/steam/<appid>/header`）→ 中文名 + 英文名 + AppID + 徽标（同步状态/分级）→ 元信息网格（**发售日期、开发商、发行商、类型、平台、分级**）→ **价格条**（当前最低 / 史低 / 折扣）→ **简介**（4 行截断，可展开）→ 底部操作栏。 |
| 3 | **数据来源 = 站内已同步的 Steam 数据**（`GET /api/games/:appid`），**不做实时 Steam 请求**（避免限流与延迟）；缺字段显示「—」。 |
| 4 | 弹窗**最下面固定「在 Steam 商店查看」**按钮：`https://store.steampowered.com/app/<appid>/`，新窗口（`target=_blank rel=noopener`）；无 `steam_appid` 时按钮禁用并提示「该游戏未关联 Steam」。 |
| 5 | 未同步（`steam_status` 非 ok / 无简介）时：弹窗顶部显示「未同步」徽标 + 一行提示「详情待同步，可稍后重试」，其余已有字段照常显示。 |
| 6 | 游戏名点击样式：蓝色虚线下划线（`link` 样式），可选中复制；不影响「编辑/禁用/删除」按钮。 |

## 3. 改动落点

- `src/store/pg.js`：`GAME_SELECT` 增加 `g.header_image, g.release_date`（两列，一处改动，详情与前台共用）。
- `src/server.js`：`/api/games/:appid` 无需改契约（字段随 `game` 返回）；若后台需要独立权限可复用（只读，管理员已登录）。
- `frontend/src/pages/AdminModules.vue`：游戏名列改为可点击；新增 `gameDetailDialog`（el-dialog）+ `openGameDetail(row)`（`request('/api/games/'+row.steam_appid)` + loading/错误态）；
  封面失败回退首字占位（复用前台 `firstChar` 模式）；价格格式复用现有 `money()`；底部按钮跳 Steam。
- 测试：`test/api.test.js` 断言 `/api/games/:appid` 返回 `header_image`/`release_date`；前端编译级（`frontend:build`）+ 演示截图核对。

## 4. 验收（demo 状态 ↔ 断言）

| demo 状态 | 断言点 | 预期 |
|---|---|---|
| 列表游戏名为蓝色虚线下划线 | 样式与可点击 | 点名字弹出弹窗；点「编辑/禁用/删除」不弹 |
| 弹窗顶部「已同步 / 成熟」徽标 | 状态映射 | 同步 ok 显示「已同步」；未同步显示「未同步」；分级按 mature/adult |
| 封面大图（神界：原罪2） | 图片 URL | `src=/img/steam/435150/header`，加载失败显示首字占位 |
| 标题「神界：原罪2 - 终极版 / Divinity: Original Sin 2…」+ AppID 435150 | 字段 | 中英名与 AppID 正确；缺英文名回退单行 |
| 元信息网格 6 项 | 字段 | 发售日期 2017-09-14、开发商/发行商 Larian Studios、类型、平台、分级 |
| 价格条「当前最低 ¥133.00 / 史低 ¥66.50 / -0%」 | 数值 | 与列表行价格一致（同 region=cn、官方+授权口径） |
| 简介 4 行 + 「展开全部简介」 | 截断与展开 | 超过 4 行出现展开；点击后全文 |
| 底部「在 Steam 商店查看 ↗」 | 跳转 | 新窗口打开 `https://store.steampowered.com/app/435150/`；无 appid 时禁用并提示 |
| 无 appid 的游戏 | 兜底 | 弹窗显示「未关联 Steam」，按钮禁用，不报错 |
| 移动端 | 适配 | 弹窗宽 100%，可滚动，按钮可达 |
| 通用 | `npm test` / `frontend:build` / `scan` | 全绿 |

## 5. 已确认（2026-11-18 所有者「没问题，接受」）

1. **回收站列表同样支持**该弹窗（组件复用）；
2. 弹窗内**加 DLC 数量与 Steam 评测数**——两者复用同一 `GET /api/games/:appid` 响应（`dlc` 摘要已返回；
   评测数把 `g.heat_reviews` 一并加进 `GAME_SELECT`），不额外发请求；
3. 简介默认**保持 4 行**截断 + 「展开全部简介」。
