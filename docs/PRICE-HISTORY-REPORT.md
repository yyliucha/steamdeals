# 游戏详情·价格历史报表（已确认待开发）

> 状态：**需求与方案已确认（2026-11-09），待开发**。编号待入 [TODO.md](TODO.md) 时落定（暂记 **AP**）。
> 关联：[WEB.md](WEB.md)、[ADMIN-LINKS-DRAWER.md](ADMIN-LINKS-DRAWER.md)（同一天的后台改版）。

## 1. 现状（代码事实，2026-11-09）

| 项 | 事实 | 证据 |
|---|---|---|
| 展示 | 详情弹窗里「价格历史」是一串**网格 chip**（`日期 + 价格`），一页 7 条，两个小分页器 | `Home.vue`：`<h3>价格历史</h3><div class="series-list">…` |
| 数据 | `detail.series` = **每日最低价**（跨官方平台、国区 `cn`、按天升序），字段 `day / price_cents / currency` | `pg.js:1196` `dailyMinSeries` |
| 史低 | 详情顶部已有「历史最低」卡片（`game.hist_low`），但历史列表里**没有任何突出** | 截图：11-07/11-08 都是 ¥65.34，与 198 的 chip 长得一样 |
| 导出 | 单款历史 CSV 后端存在但**默认关闭**（`HISTORY_CSV_ENABLED=1` 才开） | `server.js:1633` |

## 2. 已确认的决策（2026-11-09 所有者）

| # | 决策 |
|---|---|
| 1 | 形态 = **指标条 + 趋势线 + 报表表格**（按 demo） |
| 2 | 时间范围 = **默认近 90 天**，可切「近 30 天 / 近 90 天 / 全部」 |
| 3 | 史低 = **全期最低**；同一价格出现多天时，**每天都标「史低」** |
| 4 | 移动端 = **卡片列表**（不横向滚动） |
| 5 | 「较前一日」= 与前一条**有记录的日期**比较（缺数据的日子跳过） |
| 6 | **前端不提供导出**；后端 CSV 能力保留（`HISTORY_CSV_ENABLED`），本批不动后端 |

## 3. 数据与计算（纯前端，不改接口）

输入：`detail.series`（升序）与 `detail.game`（`current_low` / `hist_low` / `currency`）。

| 指标 | 算法 |
|---|---|
| 当前最低 | `game.current_low`（与列表/顶部卡片同源）；缺失时取 series 最后一条 |
| 史低 | `min(series.price_cents)`；`histLowDays = series.filter(p => p.price_cents === histLow).map(p => p.day)` |
| 区间最低 / 区间最高 | `min/max(区间内 series.price_cents)` |
| 当前较史低 | `current > histLow ? '+' + pct : '已是史低'`（pct 按分计算，保留 1 位小数） |
| 记录天数 | 当前区间内的条数 |
| 区间过滤 | 以**最后一条记录日期**为锚点倒推 30 / 90 天（不是以今天为锚点，避免数据断档时区间全空） |
| 每日变化 | 与前一条**有记录**的日期比较：`↑/↓ 金额 · ±x%`；相等显示「持平」；第一条显示「—」 |
| 币种 | 沿用 `money(price_cents, currency)`，不折算 |

## 4. 界面

### 4.1 指标条（4 张卡）

`区间最低` / `区间最高` / `当前较史低`（等于全期史低时显示「已是史低」） / `记录天数`。
顶部已有的「当前最低 / 历史最低 / 折扣」三张卡**保留**，报表条用**区间口径**，避免同一个弹窗里重复显示「当前最低 / 史低」。
移动端两列换行。

### 4.2 趋势线（手写 SVG，不引图表库）

- 宽 100%、高 78px；`polyline + area`，颜色用 `--brand`；
- **史低点画绿点**（`--success`），图上方一行：`● 史低 ¥65.34 · 2026-11-08`（多个史低日时显示**最近一次**，`title` 里列出全部）；
- 只有 1 条记录时不画线、只画点；
- 点悬停 `title` 显示 `日期 · 价格`；
- 两端标首末日期（小号灰字）。

### 4.3 报表表格（桌面）

| 列 | 内容 |
|---|---|
| 日期 | `YYYY-MM-DD` |
| 当日最低 | 金额，史低用绿色加粗 |
| 较前一日 | `↑ ¥29.70 · +17.6%` / `↓ ¥132.66 · -67%` / `持平` / `—`；涨用 `--danger`、跌用 `--success` |
| 标记 | 史低 → 绿色「史低」徽标；第一条 → 灰色「首条」徽标 |

- 史低行：整行浅绿底（`rgba(52,195,155,.07)`）+ 左侧 2px 绿边；
- 排序：**最新在前**；
- 分页：客户端每页 10 条，底部「共 N 条 · 每天取官方渠道最低价」；
- 空态：「暂无历史记录」（series 为空）。

### 4.4 移动端

- 指标条两列；
- 趋势线保持；
- 表格改**卡片列表**：每张卡一行 `日期 · 价格 · 变化`，右上角「史低」徽标；史低卡浅绿边；
- 分页保留（每页 10 条）。

### 4.5 与弹窗其它部分的关系

- 顶部原有的「当前最低 / 历史最低 / 折扣」三个卡**保留**（与报表指标条不冲突：指标条多了"记录天数/较史低"）；
- 原有 `series-list` 网格与它的小分页器**删除**（`seriesPage` / `seriesPageSize` 若只在这里用，一并清理）。

## 5. 文件落点

| 文件 | 改动 |
|---|---|
| `frontend/src/components/PriceHistoryReport.vue` | **新增**：props `series`、`currentLow`、`histLow`、`currency`；内部 tabs / SVG / 表格 / 卡片 / 分页 |
| `frontend/src/pages/Home.vue` | 用组件替换 `series-list` 块；删掉不再使用的分页变量与样式 |
| `frontend/src/styles/main.css` 或组件 scoped | 报表样式；复用现有 token，不写死颜色 |
| `test/price-history-report.test.js` | **新增**：静态断言（组件存在、三个 tab 文案、「史低」徽标、SVG、移动端卡片、无导出按钮） |
| `docs/WEB.md` | 补一句「详情页价格历史为报表视图（指标条 + 趋势线 + 表格，史低高亮）」 |

## 6. 验收

1. 指标条：区间最低 / 区间最高 / 当前较史低 / 记录天数 四个值正确（区间值随 tab 变化）；当前等于全期史低时显示「已是史低」；
2. 切换「近 30 天 / 近 90 天 / 全部」：表格、指标条、趋势线同步变化；锚点是最后一条记录日期；
3. **所有**价格等于史低的日期都高亮 + 带「史低」徽标；非史低不高亮；
4. 「较前一日」与上一条有记录的日期比较，金额与百分比正确；持平/首条文案正确；
5. 表格默认每页 10 条，翻页正常；无记录时显示空态；
6. 趋势线：点数与区间条数一致、史低点绿点、两端日期正确；只有 1 条时只画点；
7. 移动端：指标条两列、表格变卡片、史低卡有绿色边；
8. 前端**没有**导出按钮；后端 CSV 路由与 `HISTORY_CSV_ENABLED` 行为不变；
9. 深色/浅色主题下文字与线条对比度正常（人工目视）；
10. `npm test` 全绿（新增静态测试并入主链）、`npm run frontend:build`、`npm run scan`。

## 7. 实施顺序

单批 **AP**：§5 的 5 个文件，纯前端；预计半天。

## 8. 本期不做（写清楚，避免被当成漏项）

- 前端导出按钮 / 导出菜单（决策 6；后端 CSV 保持现状）；
- 多平台多条线对比（`dailyPlatformSeries` 已存在，但本批只画"每日最低"一条）；
- 缩放、拖拽、区间选择（趋势线只做静态展示 + 悬停提示）；
- 跨区服对比（series 只取 `cn`）。

## 9. 待确认

无。形态、范围、史低口径、移动端、比较口径、导出边界已于 2026-11-09 确认。

## 10. 2026-11-13 修订（BN）：价格历史区块整个不渲染——`v-for` 与 `v-if` 写在同一元素

> 状态：**已确认待开发（2026-11-13）**。编号 **BN**（BUG 修复）。
> 关联：本文 §4 界面、[TODO.md](TODO.md) 的 BN 条目。

### 10.1 现象与证据（2026-11-13，生产 v2.11.0）

**现象**：打开有历史价格的游戏详情（截图：HELLDIVERS™ 2），报价列表之后**什么都没有**——
「区间最低 / 区间最高 / 当前较史低 / 记录天数」指标条、「价格历史」标题、趋势线、表格、「暂无历史记录」全部消失；
`当前最低 / 历史最低 / 折扣 / 各区服与平台报价` 正常，说明数据没丢，是展示层崩了。

| # | 结论 | 证据 |
|---|---|---|
| 1 | 低点圆点同时用了 `v-for` 与 `v-if`（同一元素） | `frontend/src/components/PriceHistoryReport.vue:109` |
| 2 | Vue 3 里 **`v-if` 优先级高于 `v-for`**，`v-if` 被提到循环外 → 引用循环变量 `p`（作用域里不存在） | 用仓库内 `@vue/compiler-dom` 对同一写法编译，产物为 `(_ctx.p.price_cents === _ctx.histLow) ? renderList(_ctx.filtered, (p,i)=>…) : …`（`p` 在 renderList 之外） |
| 3 | 运行时抛 `TypeError: Cannot read properties of undefined (reading 'price_cents')`，**整个 `PriceHistoryReport` 组件渲染失败** | 渲染函数在构造 vnode 前抛错；组件内所有区块（含空态）一起消失 |
| 4 | 该写法自 AP 批（`282d018`，v2.2.0）就存在，组件之后未再改 | `git log --oneline -- frontend/src/components/PriceHistoryReport.vue` 只有 `282d018` |
| 5 | 现有测试拦不住：只做**静态字符串断言**，且把坏写法当成了预期 | `test/price-history-report.test.js` 断言 `p.price_cents === histLow` |
| 6 | 触发条件：`detail.series` 非空（有历史）才走到 `<template v-if="chart">`；空历史会正常显示「暂无历史记录」 | `PriceHistoryReport.vue:69-83`、`:99`、`:138` |

### 10.2 已确认的决策（2026-11-13 所有者）

| # | 决策 |
|---|---|
| 1 | **模板不再混用 `v-for`/`v-if`**：低点圆点改为 JS 预计算 `lowDots`（含坐标），模板只保留 `v-for` |
| 2 | **补"会渲染"的回归测试**：把现有静态断言改掉，新增模板编译级/SSR 渲染级断言，旧写法放回去必须红 |

### 10.3 设计

**组件改造**（`frontend/src/components/PriceHistoryReport.vue`）：

```js
// chart 同时产出点数组，避免模板里 split(' ') 二次解析
const chart = computed(() => {
  ...
  const pts = list.map((p, i) => ({ x, y }));
  return { pts, points: pts.map((d) => `${d.x},${d.y}`).join(' '), area, lowLabel };
});

// 低点圆点：在 JS 里一次算好（数据 + 坐标），模板不再需要 v-if
const lowDots = computed(() => {
  if (!chart.value) return [];
  return chart.value.pts
    .map((pt, i) => ({ ...pt, p: filtered.value[i] }))
    .filter((d) => d.p.price_cents === histLow.value);
});
```

```html
<circle v-for="(d, k) in lowDots" :key="'dot' + k" :cx="d.x" :cy="d.y" r="3.5" fill="#34c39b">
  <title>{{ d.p.day }} · {{ money(d.p.price_cents) }}</title>
</circle>
```

要点：

- 史低口径不变：仍是**全期**史低（`histLow` 基于整段 `series`），圆点数量 = 史低价出现的天数；
- `filtered` 与 `chart.pts` 一一对应（同一 `list`），不会错位；
- 空历史路径不变：`chart === null` → 仍显示「暂无历史记录」。

**测试改造**（`test/price-history-report.test.js`）：

1. 删掉 `assert.match(c, /p.price_cents === histLow/)` 这类"把 bug 当预期"的断言；
2. 新增静态断言：模板里**不允许**同一元素同时出现 `v-for` 与 `v-if`（正则守 `PriceHistoryReport.vue`，可复用到其它组件）；
3. 新增**渲染级**断言（二选一，推荐 compile 级，零浏览器依赖）：
   - 用 `@vue/compiler-dom` 编译该模板片段，断言产物中**没有** `_ctx.p.` 这类循环外引用；或
   - 用 `@vue/server-renderer` 渲染一个 `series` 非空的最小用例，断言输出包含「价格历史」与 `<svg`；
4. 反向验证：把旧写法临时放回，测试必须红（QA 复检时抽查）。

**文件落点**：`frontend/src/components/PriceHistoryReport.vue`、`test/price-history-report.test.js`；
若用 SSR 断言需把 `test/price-history-report.test.js` 明确接入 `npm test` 主链（已在主链）。

### 10.4 验收

1. 打开**有历史**的游戏详情（如 HELLDIVERS™ 2）：出现指标条（区间最低/最高/当前较史低/记录天数）、「价格历史」标题、
   趋势线、表格；「史低」行与圆点高亮正确；浏览器 Console **无** `TypeError` / Vue 渲染警告。
2. 打开**无历史**的详情：显示「暂无历史记录」，无异常。
3. 区间切换（近 30 天 / 近 90 天 / 全部）与表格分页仍正常；史低圆点数量 = 史低价出现天数（全期口径不变）。
4. 回归测试：新断言能锁住该 bug（把 `v-for`+`v-if` 旧写法放回 → 测试红）；`test/price-history-report.test.js` 中原有的
   指标条/趋势线/样式断言保留。
5. `npm test` 全绿、`npm run frontend:build`、`npm run scan`。
6. 部署侧复核：线上打开任意有历史的游戏详情，趋势线出现且 Console 干净。

### 10.5 本批不做

1. 不改价格历史的数据口径与接口（`dailyMinSeries`、`series` 不变）；
2. 不改 AP 批的界面设计（指标条/趋势线/表格/史低高亮保持）；
3. 不动后台「价格走势」的 `PriceSparkline`（AT 批，独立组件）；
4. 不做多平台多线、缩放、导出（仍是 AP 批的边界）。


