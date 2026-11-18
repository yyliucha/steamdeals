# QA：BN 价格历史区块整块不渲染（第 1 轮）

> 基线 `6178fe1` → HEAD `c0b1b4a`；判据 [PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md) §10.4 验收；
> 开发描述来源：TODO BN 条目（技术负责消息「开发 BN」）。
>
> 结论：✅ 放行 —— 通过 4 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | BN | 有价格历史的游戏详情页重新出现完整「价格历史」区块（指标条 + 标题 + 趋势线 + 表格） | 首页 → 游戏详情 → 价格历史 | ✅ 已交付 | frontend/src/components/PriceHistoryReport.vue:64-96（`chart.pts`、`lowDots`）；:116（`v-for="(d,k) in lowDots"`） |
| 2 | BN | 史低圆点/行高亮仍按全期史低口径正确渲染（圆点数量 = 史低价出现天数） | 详情 → 价格历史 → 趋势线/表格 | ✅ 已交付 | 组件 :88-94（`d.p.price_cents === histLow` 过滤）；test/price-history-report.test.js:25 |
| 3 | BN | 无历史的详情页仍显示「暂无历史记录」 | 详情 → 价格历史 | ✅ 已交付 | 组件 :142（`v-else` 空态）；:99（`v-if="chart"` 分支未改） |
| 4 | BN | 回归测试能复现旧 bug：旧写法放回 → 测试红（v-for+v-if 全组件扫描 + 编译产物断言） | `npm test` | ✅ 已交付 | test/price-history-report.test.js:32（全组件扫描）、:49（编译级 + 检测器自检） |

## 逐条核对（规格 §10.4 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 有历史详情：指标条/「价格历史」标题/趋势线/表格出现、史低高亮正确、Console 无 TypeError | 源码 + 编译级断言 | 组件 :67-100（chart 产出 `pts`/`points`/`area`）、:88-94（`lowDots` 预计算）、:104-140（指标条/标题/表格未改）；test :49-65 断言编译产物无 `_ctx.p.` 循环外引用、`_renderList(_ctx.lowDots` 仍循环 | ✅ |
| 2 | 无历史详情：显示「暂无历史记录」，无异常 | 源码复核 | 组件 :103（`<template v-if="chart">`）、:142（`v-else` 空态），空态路径未改动 | ✅ |
| 3 | 区间切换与表格分页正常；史低圆点数量 = 史低价出现天数（全期口径） | 源码复核 | `histLow`（:34）、`lowDays`（:35）口径未变；`lowDots` 用 `histLow` 过滤 `chart.pts`（与 `filtered` 一一对应，:88-94）；`range`/`page` 逻辑未改 | ✅ |
| 4 | 回归测试锁住 bug：旧写法放回 → 测试红；原指标条/趋势线/样式断言保留 | **QA 亲自复现** | 临时把旧写法（`v-for="(p, i) in filtered" v-if="p.price_cents === histLow"`）放回：`node test/price-history-report.test.js` → `not ok 1/2/3`、`# fail 3`；还原后 5/5 通过。测试文件保留指标条/趋势线/样式断言（:12-31、:67-80） | ✅ |
| 5 | `npm test` 全绿、`frontend:build`、`scan` | 重跑 | `npm test` 退出 0（无 not ok）；`frontend:build` ✓ built in 1.57s；`scan` 无凭据 | ✅ |
| 6 | 部署侧复核：线上有历史详情趋势线出现且 Console 干净 | 无法本地执行 | 部署人员按规格 §10.4.6 复核 | 🔎 |

## 打回清单

无。

## 需人工确认

- 验收 1/6 的浏览器目视（Console 无 TypeError、趋势线正常显示）需部署后确认：本地以编译级断言 + 旧写法反向复现锁住根因，无浏览器环境；
- 部署侧按 §10.4.6 打开任意有历史详情抽查趋势线与 Console。

## 风险提醒（非打回）

- 现有 `test/price-history-report.test.js` 属静态 + 编译级断言，不启动浏览器；「渲染级」由 `@vue/compiler-dom` 产物断言覆盖（规格 §10.3 推荐方案），已在测试内用旧写法自检检测器有效性（旧写法 → 编译产物出现 `_ctx.p.price_cents` 循环外引用 → 断言红）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-13）：初检即 ✅ 放行，无打回项。
