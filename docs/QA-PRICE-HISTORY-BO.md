# QA：BO 价格历史删表格 + 趋势线 150px（第 1 轮）

> 基线 `e80f1cc` → HEAD `257a2a6`；判据 [PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md) §11.4 验收；
> 开发描述来源：TODO BO 条目。
>
> 结论：✅ 放行 —— 通过 5 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | BO | 详情页价格历史不再显示日期表格、移动卡片与分页条（与趋势线重复的内容移除） | 首页 → 详情 → 价格历史 | ✅ 已交付 | PriceHistoryReport.vue 全文（无 `<table`/`phr-table`/`phr-pager`/`isNarrow`/`PAGE_SIZE`）；test/price-history-report.test.js:28-32 |
| 2 | BO | 趋势线 76px → **150px**（移动端 ≤760px 为 120px、满宽） | 同上 | ✅ 已交付 | 组件 :93（`viewBox="0 0 840 150"`）；main.css `.phr-chart svg{…height:150px}` + `@media (max-width:760px){.phr-chart svg{height:120px}}`（QA 直查 True） |
| 3 | BO | 史低位置画**虚线参考线** + 轴标签（左「¥区间最低 · 史低线」绿、右「区间 首日 → 末日」） | 同上 | ✅ 已交付 | 组件 :90（轴标签）、:94（`stroke-dasharray="4 4"` 参考线）、:49-51（`lowY` 计算） |
| 4 | BO | 底部说明改为当前区间条数 +「史低已标出」，随区间切换变化 | 同上 | ✅ 已交付 | 组件 :107（`共 {{ filtered.length }} 条 · … · 史低已标出`） |
| 5 | BO | 平线（区间最低=最高）垂直居中；无历史仍显示「暂无历史记录」 | 同上 | ✅ 已交付 | 组件 :47（`maxV === minV ? H / 2`）、:109（空态） |
| 6 | BO | 回归测试：无 table 断言 + `viewBox 840×150` + 史低线/虚线 + 保留 BN 的 v-for+v-if 全组件扫描与编译级回归 | `npm test` | ✅ 已交付 | test/price-history-report.test.js（5 项全绿） |

## 逐条核对（规格 §11.4 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 有历史详情只有指标卡+区间切换+150px 趋势线（参考线/轴标签）+底部说明，无表格/卡片/分页，Console 无错误 | 源码 + 编译级断言 | 组件 :84-107（结构）、:93（viewBox 150）、:94（虚线）；无 `<table`/`phr-table`/`phr-pager`（QA 直查 True）；test :26-63（编译产物断言） | ✅ |
| 2 | 区间切换后趋势线/轴标签/条数同步变化；无历史显示「暂无历史记录」 | 源码复核（响应式计算） | `range`/`filtered`/`chart`/`lowDots` 全部 computed 依赖 `range`（:22-66）；轴标签与条数直接绑定 `filtered`（:90-92、:107）；空态 :109 | ✅ |
| 3 | 移动端（≤760px）：趋势线 120px、满宽、无表格，史低圆点与参考线正常 | CSS 直查 | `.phr-chart svg{display:block;width:100%;height:150px}`、`@media (max-width:760px){.phr-chart svg{height:120px}}`（QA 直查 True）；圆点/参考线在 SVG 内（:94-99），随 SVG 缩放 | ✅ |
| 4 | 史低口径不变：圆点数量 = 史低价出现天数；平线垂直居中 | 源码复核 | `lowDots` 仍按 `histLow`（全期）过滤 `chart.pts`（:62-66）；:47 `maxV === minV ? H / 2`；test :34 锁平线 | ✅ |
| 5 | 测试断言更新并通过（含 BN 扫描与编译级回归）；原表格断言删除 | 真跑 | test/price-history-report.test.js 5/5（`node test/price-history-report.test.js`）；无 `phr-cards` 正断言、有 doesNotMatch 系列；BN 扫描（:39-53）与编译级回归（:55-73）保留 | ✅ |
| 6 | `npm test` / `frontend:build` / `scan` 全绿 | 重跑 | `npm test` 退出 0（无 not ok）；`frontend:build` ✓ built in 1.78s；`scan` 无凭据 | ✅ |
| 7 | 部署侧复核：线上有历史详情只有趋势线、Console 干净 | 无法本地执行 | 部署人员按规格 §11.4.7 复核 | 🔎 |

## 打回清单

无。

## 需人工确认

- 验收 1/3 的浏览器目视（150px/120px 实际渲染、参考线与轴标签视觉、Console 无错误）需部署后确认：本地以静态断言 + 编译级回归 + CSS 直查覆盖结构，无浏览器环境；
- 部署侧按 §11.4.7 打开任意有历史详情抽查（桌面 + 移动端断点）。

## 风险提醒（非打回）

- 测试属静态 + 编译级断言（沿用 BN 惯例），「趋势线 150px 真渲染」由 CSS 直查（QA 侧）与 viewBox 断言锁定，浏览器目视转部署后复核；
- 主链 npm test 已覆盖本文件（原在链上，未改动 package.json）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-13）：初检即 ✅ 放行，无打回项。
