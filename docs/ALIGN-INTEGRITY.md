# 对齐审核数据完整性（DH，待开发）

> 状态：**已确认待开发（2026-11-18，所有者「立DH」）**。
> 关联：[TODO.md](TODO.md) DH 条目、[ALIGN-REVIEW-UI.md](ALIGN-REVIEW-UI.md)（DE 页改版）、
> `src/align.js`（applyMapInheritance / ignoreGroup）、`src/store/pg.js`（game_source_map）。

## 1. 问题（2026-11-18 代码 + 线上数据核对）

| # | 问题 | 证据 |
|---|---|---|
| **A** | **继承缺口：已映射的 SKU 仍入队** | `applyMapInheritance()` 只查 `game_source_map`，**不认 `skus.json` 里已有的 `appid`**。断箭 SKU 111465 在 skus.json 已有 `appid=1604270`，但队列仍显示该组 |
| **B** | **忽略不可撤销** | `ignoreGroup()` 把 `decision='ignored'` 写入 `game_source_map`，页面没有「已忽略」列表/恢复入口 → 误忽略只能改库 |
| **C** | **审阅痕迹不可见** | `reviewed_by` 已落库，但页面看不到"谁、何时、确认/忽略了哪组" |
| **D** | 孤儿行合并无提示 | 断箭组会合并孤儿游戏行（`games.id=1545848`），界面没提示"确认后将合并" |

## 2. 修复方案

| 项 | 内容 |
|---|---|
| A1 | 继承规则扩展：`applyMapInheritance` 除 `game_source_map` 外，**同时参考 item 自带的 `appid`**（来自 skus.json）→ 有 appid 即视为已解决、不入队；对账时若两边不一致（skus.json 有 appid、库无映射）→ 补写映射并记日志 `align.map_backfilled`。 |
| A2 | 后台队列对"已映射但未同步"的组显示徽标「已映射（待同步）」，可一键"补写映射"。 |
| B1 | 新增「已忽略」视图（tab 或筛选）：列出 `decision='ignored'` 的组（组名/时间/操作人），支持**恢复为待处理**（删除映射行或改回 pending）。 |
| C1 | 每个组显示「最近处理」：操作人 + 时间 + 动作（确认/忽略/恢复）；对齐审核页加"审阅记录"抽屉。 |
| D1 | 确认弹窗提示："该组包含 1 条孤儿游戏行，确认后将合并到目标游戏"。 |

## 3. 接口

| 方法与路径 | 说明 |
|---|---|
| `GET /api/admin/align/ignored` | 已忽略列表（分页、搜索组名），返回 `{key,name,skus,ignoredAt,reviewedBy}`。 |
| `POST /api/admin/align/restore` | body `{ key }` → 删除该组 ignored 映射，恢复为待处理；审计 `align.restored`。 |
| `GET /api/admin/align/history?key=` | 某组的处理记录（可选，或直接在列表返回 `lastReviewed`）。 |
| `POST /api/admin/align/map` | 补写 skus.json appid → game_source_map（A2 的"补写映射"）；审计。 |

## 4. 验收

1. 断箭组：queue 中**不再出现**（skus.json 已带 appid → 视为已解决）；若库无映射则自动补写并记日志；
2. 已忽略视图：能列出历史忽略、操作人、时间；点「恢复」后该组重新回到待处理队列；
3. 审阅记录：确认/忽略后能查到 `reviewed_by` + 时间；
4. 确认弹窗对含孤儿行的组有合并提示；
5. `npm test`（继承参考 appid、补写映射、恢复、审计）/ `frontend:build` / `scan` 全绿。

## 5. 待确认

1. 「已模拟映射但未同步」自动补写的触发时机：计算时自动补写，还是只显示按钮人工点？（建议自动补写 + 日志）
2. 「已忽略」恢复是否需要二次确认（建议需要）。
