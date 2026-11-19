# QA：CU-1 到价提醒「无报价」徽标 + 筛选（第 1 轮 → 第 2 轮补收尾复核）

> 基线：271f65a（用户交接）；实现提交 b5f5663（pg.js/前端/测试/主链）+ b564161（PROJECT-OVERVIEW 回写）；
> server.js 路由改动被并行 DA 会话提交随 main 进入（6a9ecc3 系），内容与开发一致。
> 判据：[USER-ALERTS-GOVERNANCE.md](USER-ALERTS-GOVERNANCE.md) §2 CU-1 + §4 验收 1/5 + 交接单（本会话只做 CU-1）。
> 结论：✅ 放行 —— 通过 3 / 缺失 0 / 偏差 0 / 需人工确认 1
> 第 2 轮（2026-11-19 CU-1 补收尾 @ 29aab61）：结论维持 ✅ 放行；本报告随 TODO/INDEX/规格状态回写一并入库（见「复检记录」）。

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | CU-1 | 无任何在售报价的提醒行显示「无报价」徽标（桌面表格 + 移动卡片） | 后台 → 到价提醒 | ✅ 已交付 | `AdminModules.vue:78/81`（`v-if="!w.hasPrice"` + `>无报价</el-tag>`）；静态锁 `test/watchlist-noprice.test.js:138` |
| 2 | CU-1 | 状态筛选「无报价」只出这些行（服务端筛选，total/分页正确） | 后台 → 到价提醒 → 状态下拉 | ✅ 已交付 | `src/store/pg.js:2122-2128`（noPriceOnly）+ `src/server.js:3265-3269`（status=no_price）；HTTP 断言 `test/watchlist-noprice.test.js:110-120` |
| 3 | CU-1 | 提示「无在售报价时不触发提醒」（筛选行 + 徽标悬停说明） | 同上 | ✅ 已交付 | `AdminModules.vue:77`（muted 文案）+ `title="该游戏无任何在售报价，提醒不会触发"` |
| 4 | CU-1 | 接口契约：每行带 `hasPrice` 布尔（驼峰），`status=no_price` 参数 | `GET /api/admin/watchlist` | ✅ 已交付 | `src/server.js:3269`（has_price→hasPrice 映射）；契约断言 `test/watchlist-noprice.test.js:105-108` |
| 5 | CU-1 | 「无报价」判定口径与 CL 批一致（官方+授权渠道、CN 区、在售；仅 c2c/缺货均算无报价） | 数据层 `listAllWatchesAdmin.has_price` | ✅ 已交付 | `src/store/pg.js:2141-2145`（EXISTS 与 current_cents 同口径）；口径四态断言 `test/watchlist-noprice.test.js:79-87` |

## 逐条核对（规格验收 → 证据）

| # | 条目（验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 无报价行显示「无报价」且筛选"无报价"只出这些行（线上样本 State of Decay 3 / Warhammer 黑暗异端口径一致） | 读代码 + 跑测试 | `src/store/pg.js:2141-2145` has_price EXISTS（与 current_cents 同口径：官方+授权、CN、in_stock）；两样本线上实测 current_cents/hist_low 均为空 → has_price=false → 徽标 + 筛选命中；合成数据 HTTP 断言 `test/watchlist-noprice.test.js:110-120`（筛选 total=1 且就是无报价行）；前端静态锁 :138 | ✅（口径）+ 🔎（上线目视） |
| 5 | npm test（分段）/ frontend:build / scan 全绿 | 亲自重跑 | `node test/watchlist-noprice.test.js` → 3/3；`node test/watchlist-user.test.js` → 8/8；`node test/watchlist.test.js` → 5/5；`node test/api.test.js` → API=0；`npm run test:2` → T2=0；`npm run frontend:build` → BUILD=0（8.37s）；`npm run scan` → SCAN=0 | ✅ |
| 范围 | 本批只做 CU-1（不做 CU-2 迁移 / CU-3 抽检 / CU-4 配额） | 查 diff | `git diff 6bef7df..b564161 --stat`：仅 pg.js/AdminModules.vue/package.json/test/PROJECT-OVERVIEW +（server.js 随 DA 提交）；无迁移/抽检/配额改动 | ✅ |

## 纪律固定检查项

1. `git tag --list`：无擅自新增 tag ✅
2. 未碰部署/服务器配置/凭据 ✅
3. 无构建产物进提交（frontend/dist 未入库）✅
4. 已推 main ✅（b5f5663/b564161 on origin/main）
5. PROJECT-OVERVIEW 已回写 ✅（b564161 加 CU-1 行）

## 需人工确认

- 条目 1（线上目视）：本地无生产数据；口径与 CL 批逐字一致（同一子查询条件），两样本线上实测无报价 → 必然命中。部署后请所有者到「后台 → 到价提醒」确认 State of Decay 3（1340720）/ Warhammer 黑暗异端（3710600）两行出现「无报价」徽标，且筛选「无报价」只出这两行。
- 第 2 轮补充（2026-11-19）：公开信息只读核对——State of Decay 3 定档 **2027 年发售、当前未上架**（2026-09 仍处 alpha、2026 年底才 closed beta，Steam 无在售报价）；Warhammer 40,000: Dark Heresy 官方 Steam 页明示「**尚未在 Steam 发售**」（定档 2027-01-28；Owlcat 官网创始人包预售不属于本仓采集渠道，不形成 offers）→ 两样本 CN 区均无在售报价，`has_price=false` 判定成立。部署后目视仍保留 🔎（上线确认项，证据链见上文）。

## 打回清单

- 无。

## 状态回写说明

- `docs/TODO.md`（CU 条目）与 `docs/REQUIREMENTS-INDEX.md` 第 1 轮时被其他会话占用（HANDOVER §10.1），当时未写；CU-1「已实现待发版」由收尾复盘（§10.3）定点补回。
- 补收尾（2026-11-19）：占用已解除，TODO CU 行 / INDEX CU 行 / 规格头部状态行已按本结论回写（CU-1 质检通过），本报告随同一提交入库。

## 复检记录

- 第 1 轮（2026-11-18）：✅ 放行。
- 第 2 轮（2026-11-19，CU-1 补收尾复核 @ 29aab61）：维持 ✅ 放行（3/0/0/1）。补证据——线上两样本公开口径核对（State of Decay 3 定档 2027 未上架；Dark Heresy Steam 页明示未发售、官网预售不在采集渠道）→ `has_price=false` 成立。重跑验证：`node test/watchlist-noprice.test.js` 3/3、`node test/watchlist.test.js` 5/5、`node test/watchlist-user.test.js` 8/8、`node test/api.test.js` 33/33、`npm run test:2` exit 0、`npm run test:1/3/4` exit 0（分段全绿）、`npm run frontend:build` 2.95s、`npm run scan` 干净。
