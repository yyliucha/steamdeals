# 新会话交接：可直接开发的功能批次（2026-11-09）

> 本文是**给新开发会话的开场白**：把当前可直接开工的功能整理成批次清单（编号/规格/验收要点）。
> 背景：v2.1.0 已发布（AM-2/AN/AK×3/AL/AC-2~4 九批）；AA 六项缺陷修复批已质检通过待发版（5b59bfa）；
> **当前会话已转入运维排查（AA 根因日志 / C1 heat 探测 / C2 compose 文件名），以下功能不与其冲突**。

## 0. 开工前必读

- 流程与硬规则：[docs/HANDOVER.md](HANDOVER.md)、[docs/DELIVERY.md](DELIVERY.md)（六步：认领 → 代码+测试 → 验证 → 文档同步 → 提交推 main → 调用 gameprice-qa 质检并回写 TODO）。
- 状态唯一来源 [docs/TODO.md](TODO.md)：开工先认领编号（状态 → 开发中），完工改「已实现待发版」，质检后改「质检通过」；写 TODO/INDEX 前先探测是否被其他会话占用（§1.1）。
- **不打 tag、不构建、不发版**（硬规则 5，等所有者「构建 vX.Y.Z」）；不碰服务器（硬规则 4）。
- 验证基线：`npm test` 67 文件/549 项全绿 + `node test/api.test.js` 22 项 + `npm run frontend:build` + `npm run scan`。
- 前端无组件级测试框架：用**静态源码断言**（读 .vue/.js 断言 token），编译正确性由 `frontend:build` 兜底（参考 `test/auth-pages.test.js`）。

## 1. 建议顺序与批次清单（4 批 + 1 项可选，全部是前端/小改）

### ① AQ — 后台访问/异常列表排序（先做：解锁 AR）

- **状态**：待开发 | **依赖**：无 | **解锁**：AR
- **规格**：[ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §3 | **验收**：§3.4（7 条）
- **开发描述**：
  - 新建 `frontend/src/utils/ipSort.js`：`compareIp(a,b)`——IPv4 转整数比较；IPv6/异常值排 IPv4 之后按字符串；空值最后（可单测 `test/ip-sort.test.js`）。
  - 异常审核（后台「异常审核」列表）**客户端排序**：表头可点 最近出现/IP/次数/规则；默认「最近出现 ↓」，点击循环 升→降→回默认；切换不重置筛选；排序状态存 `localStorage['admin.reviewSort']`。
  - 访问明细**服务端排序**：`GET /api/admin/visitors` 加 `sort`(`time|ip|status`)/`order`(`asc|desc`) 白名单（不拼接用户输入，非法回落默认）；IP 用**零填充字符串键**排序，**不用 `ip::inet`**（脏数据会炸整条查询）；换排序时前端 `visitorPage=1`；状态存 `localStorage['admin.visitorSort']`。
  - 异常审核上限 300 → **500**：`pg.js listAbuseReviews` 上限 `Math.min(…,500)`、`/api/admin/reviews` 默认 `limit=500`、前端不传 limit；列表头显示「共 N 条（上限 500）」，超 500 提示先按 IP 合并（AR）或按状态筛选。
  - 测试：新增 `test/ip-sort.test.js` + 接口 `sort/order` 用例并入主链。

### ② AR — 异常审核「按 IP 合并」视图（AQ 完成后）

- **状态**：依赖阻塞（AQ） | **依赖**：AQ | **解锁**：无
- **规格**：[ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §4 | **验收**：§4.4（8 条）
- **开发描述**：
  - 待审列表头部「按 IP 合并」开关（默认关，localStorage）。
  - 前端按 `ip` 聚合（≤500 行，**不改后端**）：规则摘要（去重计数，组内按 hits 降序）/ 总次数 / 首末时间 / 设备数（去重指纹）/ 状态（有 pending=待审、全 auto_banned=已封禁、混合=部分已处理）；展开行显示每条规则明细。
  - 处置复用 `POST /api/admin/bulk`：封 IP=`reviews/approve-ip`、封设备=`reviews/approve-device`（指纹去重分批）、忽略=`reviews/reject`；确认弹窗写明「将处理 `<IP>` 的 N 条规则 / M 次命中 / K 个设备」，高危动作沿用二次确认。
  - 勾选合并行 = 该 IP 全部待审记录，批量栏显示「已选 N 个 IP · M 条记录」；执行后刷新。
  - 合并视图支持排序（最近出现/IP/总次数/规则数），复用 AQ 的 `compareIp()`；移动端卡片化（每卡一个 IP，展开看规则）。
  - 测试：静态断言 + 主链。

### ③ AO — 后台游戏列与平台链接抽屉改版

- **状态**：待开发 | **依赖**：无 | **解锁**：无
- **规格**：[ADMIN-LINKS-DRAWER.md](ADMIN-LINKS-DRAWER.md) | **验收**：§8（10 条）| **实施顺序**：§9（单批，预计半天，纯前端）
- **开发描述**：
  - 新增 `frontend/src/components/GameLinksDrawer.vue`：抽屉（头部/每渠道一张卡/空态/移动端全屏）；props `visible/game/links/loading`。
  - `AdminModules.vue` 游戏列：名称 flex 单行省略、复制图标固定行尾、英文名 `title` 悬停看全名；**点游戏名开抽屉、点复制只复制**（`@click.stop`）；抽屉改用新组件，删旧 `links-drawer-head`/`link-row` 样式。
  - 复制内容 = `中英文两行`（`utils/gameNames.js` 新增 `nameCopyText()`，可单测；中英相同/只有中文时仅一行）；成功图标变 ✓ 1.2s + toast。
  - 卡片字段：平台/区服/现价/划线原价/折扣/库存/更新时间/打开（不再粘连）；缺货降透明度仍可打开；排序：国区在前、同区价格升序；空态：无链接给兜底按钮（有 `steam_appid` 时可开 Steam 商店页）。
  - 接口**不改**（`/api/admin/games/:id/links` 已含全部字段）。
  - 测试：新增 `test/admin-links-drawer.test.js`（静态断言：组件存在/flex 类名/复制两行/空态/移动端）并入主链；`docs/WEB.md` 补一句。

### ④ AP — 游戏详情·价格历史报表（史低高亮）

- **状态**：待开发 | **依赖**：无 | **解锁**：无
- **规格**：[PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md) | **验收**：§6（10 条）| **实施顺序**：§7（单批，纯前端，预计半天）| **本期不做**：§8 清单
- **开发描述**：
  - 详情页价格历史从 chip 网格改为**报表视图**：指标条（区间最低/区间最高/当前较史低/记录天数；当前=全期史低显示「已是史低」）+ 手写 **SVG 趋势线**（史低点绿点、只有 1 条只画点、悬停提示）+ 表格（日期/当日最低/较前一日/标记；**史低行整行高亮+徽标**；默认每页 10 条；空态）。
  - 范围「近 30 天 / 近 90 天 / 全部」，锚点=最后一条记录日期，切换时指标条/趋势线/表格同步；「较前一日」与上一条有记录的日期比较（金额+百分比），持平/首条文案正确。
  - 移动端：指标条两列、表格变卡片、史低卡绿色边；深/浅色主题对比度正常。
  - **不改接口**（`detail.series` 已含全量每日最低，只取 `cn` 一条线）；后端 CSV 路由与 `HISTORY_CSV_ENABLED` 不动；**不做**前端导出按钮。
  - 测试：新增静态测试并入主链。

### ⑤ F（可选，需所有者点头再做）— Steam 价格同步优化

- **状态**：等排期（2026-11-02 方案已定）| **依赖**：无
- **说明**：见 [TODO.md](TODO.md) F 段。① 一行小改：`cmdSyncSteamPrices` 的 `rateLimitMs 1100→1500~2000`（当前略超 200 次/5 分钟配额，靠 429 兜底）；② 热点优先+冷门降频（需设计：改 `cmdSyncSteamPrices` 选择条件，不动调度器）。**涉及线上同步节奏，先问所有者**。

## 2. 不要碰（当前会话正在做）

- **AA 根因**（愿望单推 Steam 失败）：六项缺陷已修完；根因等服务器日志定性，属当前会话。
- **C1**（heat 全 `success:false`）：等服务器探测结果，属当前会话。
- **C2**（compose 文件名）：纯运维，属当前会话。
- 服务器部署 / 发版 / tag：一律等指令。

## 3. 收尾清单（每批）

1. `npm test` + `node test/api.test.js`（动过 API 时）+ `npm run frontend:build` + `npm run scan` 全绿并贴输出；
2. 文档同步：TODO（状态行）/ REQUIREMENTS-INDEX / PROJECT-OVERVIEW（加行）/ DELIVERY（待发版 bullet）/ 规格文档状态；
3. 提交推 main（`feat(范围): 摘要`）后调用 gameprice-qa 质检（核对「功能清单」表），回写 TODO → 质检通过；
4. 结束汇报：已做哪些编号 / 未做哪些及原因。
