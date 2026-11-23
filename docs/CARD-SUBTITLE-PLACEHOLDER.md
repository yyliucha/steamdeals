# 游戏卡片英文名占位（FF，待开发，2026-11-23）

> 所有者反馈（2026-11-23 首页截图）：`Garry's Mod` 等**没有英文名**的卡片比其它卡片少一行（英文名行消失），
> 导致价格/标签位置错位（卡片高度不一致）。要求：**没有英文名时保留元素占位，不影响布局**。

## 1. 现状（代码证据）

`frontend/src/pages/Home.vue:70`：

```html
<div v-if="game.name_en && game.name_en !== game.name" class="game-subtitle">{{ game.name_en }}</div>
```

- 无 `name_en`（或与主名相同）→ 整行不渲染 → 卡片少一行 → 布局塌陷/错位；
- 移动端同结构（`m-subtitle`）。

## 2. 方案（保留元素占位）

- **始终渲染** `.game-subtitle`（即使内容为空/与主名相同），内容为空时用 `&nbsp;` 或 `aria-hidden` 占位；
- 或 CSS 固定该行高度：`.game-subtitle{min-height:1.4em;line-height:1.4}`（推荐，不依赖内容）；
- 主名与英文名相同/缺失时：显示空占位行（不重复显示主名）；
- 移动端同样处理（`m-subtitle` 固定高度）。

## 3. 验收

1. 无英文名的游戏卡片（如 Garry's Mod）与有英文名的卡片**高度一致**、价格/标签位置对齐；
2. 有英文名的卡片显示不变；
3. 主名与英文名相同时不重复显示（空占位）；
4. 移动端卡片同样对齐；
5. `npm test`（分段）+ `frontend:build` + `scan` 全绿；截图对照（含/不含英文名两种卡片并排）。
