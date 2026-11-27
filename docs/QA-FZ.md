# QA：FZ 访问记录重设计（第 1 轮）

> 基线 `de6bd89` → HEAD `c0a4fd2`（本批两个提交：`05525c2` 主体 + `c0a4fd2` 列宽收敛）；
> 判据 [VISITORS-REDESIGN.md](VISITORS-REDESIGN.md) §7 验收 8 条 + §1 决策 13 条 + §3 关键交互 6 条；
> 开发描述来源：监工 fz-worker 交接单（本会话），demo `docs/design/visitors-redesign-2026-11-27.html`（`-1/-2/-3.png`）+ `visitor-ban-2026-11-27.html`。
> 结论：✅ 放行 —— 通过 8 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | FZ | 访问记录左侧导航七块：概览 / 异常处置 / 访问分析 / IP 封禁 / 设备封禁 / 临时封禁 / 白名单 | 后台 → 访问记录 | ✅ | `useVisitorsAdmin.js:13-21`（七块清单）、`VisitorsAdmin.vue:105`（渲染） |
| 2 | FZ | 每块有独立 URL（`?view=`），可直达、浏览器后退可回 | `/console?section=visitors&view=review` | ✅ | `VisitorsAdmin.vue:28-38`（读 query + watch + `router.push`） |
| 3 | FZ | 移动端左导航收成顶部下拉（≤760px） | 375px 视口 | ✅ | `VisitorsAdmin.vue:114-116`、`visitors.css:110,112`（760 断点隐藏左导航 / 显示下拉） |
| 4 | FZ | 概览 6 张数字卡：今日请求 / 被拦截 / 待审 / 临时封 / 黑名单 / 白名单 | 概览 | ✅ | `VisitorsOverview.vue:11-18`、`src/store/admin-access-repository.js:217`（一次查询 6 个数） |
| 5 | FZ | 待审 > 0 时标红，点卡片进异常处置 | 概览 → 待审异常卡 | ✅ | `VisitorsOverview.vue:14`（hot）、`VisitorsOverview.vue:43`（点击换块） |
| 6 | FZ | 概览每 30 秒自动刷新，且只在页面可见时拉数 | 概览停留 | ✅ | `VisitorsAdmin.vue:66,85`（visibilityState、setInterval 30000） |
| 7 | FZ | 异常处置：按 IP 合并的待审队列，行可展开看逐条规则 | 异常处置 → 待审列表 | ✅ | `VisitorsReview.vue:48-68`（聚合）、展开行模板 |
| 8 | FZ | 行内临时封：10 分钟 / 1 小时 / 1 天 | 异常处置 → 行内「临时封」▾ | ✅ | `VisitorsReview.vue:423-431`（`:command="10/60/1440"`） |
| 9 | FZ | 行内永久封（加黑 + 待审退出） | 异常处置 → 行内「永久封」 | ✅ | `VisitorsReview.vue:169`（bulk approve-ip）、`:433` |
| 10 | FZ | 行内信任（加白 + 清临时封） | 异常处置 → 行内「信任」 | ✅ | `VisitorsReview.vue:434`、`src/routes/admin-access.js:353+`（reviews/act trust） |
| 11 | FZ | 行内忽略 | 异常处置 → 行内「忽略」 | ✅ | `VisitorsReview.vue:435`、bulk reject |
| 12 | FZ | 行内封设备（保留，二次确认输条数） | 异常处置 → 行内「封设备」 | ✅ | `VisitorsReview.vue:436`（行内按钮）、`:186-205`（banDeviceRow 二次确认） |
| 13 | FZ | 批量封 IP / 封设备 / 忽略（勾选合并行） | 异常处置 → 勾选 → 批量条 | ✅ | `VisitorsReview.vue:271-300`（批量处置）、`:358-368`（merge-bar） |
| 14 | FZ | 处置后该行立即从队列消失、待审数减 1 | 异常处置处置后 | ✅ | `VisitorsReview.vue:222-231`（过滤 + bumpOverview + 补页） |
| 15 | FZ | toast「撤销」5 秒：移出黑/白名单或清临时封、行回原位 | 处置成功后的右上 toast | ✅ | `VisitorsReview.vue:240-247`（撤销 toast）、`:253-266`（undo） |
| 16 | FZ | 当前页处置空了自动回上一页 | 异常处置翻页边界 | ✅ | `VisitorsReview.vue:230` |
| 17 | FZ | 访问分析只读：行内只留「详情」，无封禁/信任按钮 | 访问分析 | ✅ | `VisitorsAnalysis.vue:142,223`（行内只有详情）、`:155`（只读说明）；静态锁见 `test/admin-visitors-redesign.test.js` 「访问分析与 IP 抽屉没有封禁/信任动作」 |
| 18 | FZ | IP 统计（默认）/ 明细子视图 + 时间窗 1/7/30 | 访问分析 → 子视图切换 / 时间窗 | ✅ | `VisitorsAnalysis.vue:161-168`（子视图 + 时间窗） |
| 19 | FZ | 状态筛选默认「有效访问」（排除已封禁 + 已信任；临时封保留） | 访问分析 → 状态下拉 | ✅ | `VisitorsAnalysis.vue:19`（`ref('active')`）、`src/routes/admin-access.js:139`（默认 active） |
| 20 | FZ | 切「已封禁 / 已信任 / 全部」可查历史；明细与统计同口径 | 访问分析 → 状态下拉 | ✅ | `src/store/admin-access-repository.js:95-116`（明细同源口径）、`:164`（by-ip active 过滤） |
| 21 | FZ | 搜索 + 展开详情（最近访问 / 路径 top） | 访问分析 → IP/路径搜索、行展开 | ✅ | `VisitorsAnalysis.vue:69-90`（两条加载）、`:132-141`（展开详情） |
| 22 | FZ | IP 详情抽屉（只读）：地区 / 状态 / 访问次数 / 独立路径 / 设备 / 最近访问 / 异常规则 | 任意列表点 IP | ✅ | `IpDetailDrawer.vue:116-176` |
| 23 | FZ | 抽屉「去异常处置」并定位该 IP（展开 + 高亮） | 抽屉底部按钮 | ✅ | `IpDetailDrawer.vue:176`、`VisitorsReview.vue:306-331`（focusIp 定位） |
| 24 | FZ | 抽屉「去 IP 封禁」（已封禁时） | 抽屉底部按钮 | ✅ | `IpDetailDrawer.vue:177` |
| 25 | FZ | IP 封禁页：解封 | IP 封禁 → 行内「解封」 | ✅ | `VisitorsBanIp.vue:70`（DELETE blacklist） |
| 26 | FZ | IP 封禁页：手动添加（支持 CIDR） | IP 封禁 → 手动添加 | ✅ | `VisitorsBanIp.vue:53`（POST）、`:87`（CIDR 提示） |
| 27 | FZ | 设备封禁页：搜索 + 解封（封禁入口不在此页） | 设备封禁 → 搜索 / 解封 | ✅ | `VisitorsBanDevice.vue:47-61`（解封）、`:93`（操作列固定最右） |
| 28 | FZ | 临时封禁页：生效中 / 已过期 / 全部 | 临时封禁 → 筛选 | ✅ | `VisitorsBanTemp.vue:19`（默认 active）、`:85-89`（筛选下拉） |
| 29 | FZ | 临时封禁页解除：只清 ip_abuse，不删黑名单 | 临时封禁 → 解除封禁 / 清除记录 | ✅ | `VisitorsBanTemp.vue:46-54`（确认文案 + DELETE abuse） |
| 30 | FZ | 白名单页：添加 | 白名单 → 添加 | ✅ | `VisitorsWhitelist.vue:67`（POST）、`:84`（DELETE） |
| 31 | FZ | 白名单页：移出 | 白名单 → 行内「移出」 | ✅ | `VisitorsWhitelist.vue:84` |
| 32 | FZ | 白名单「限流」口径可见（不限制 + 当前阈值说明） | 白名单页顶部说明 / 限流列 | ✅ | `VisitorsWhitelist.vue:32`（不限制）、`:19-27`（阈值文案） |
| 33 | FZ | 状态词全站统一：正常 / 被拦截 / 临时封 / 已封禁 / 已信任（集中一个映射表） | 全站（分析 / 抽屉 / 封禁页） | ✅ | `frontend/src/utils/visitorStatus.js:10-27`、`:64-90` |
| 34 | FZ | 左侧导航徽标：待审数（>0 标红）/ 黑名单 / 临时封 / 白名单 / 分析 IP 数 / 设备封禁数 | 左导航每块右侧 | ✅ | `VisitorsAdmin.vue:47-62`（badgeOf / isHot） |
| 35 | FZ | 移动端列表卡片化、375px 无横向溢出 | 375px 视口 | ✅ | 六个子页均 `v-else class="game-card-list"`；headless「375px 无横向溢出」两条断言 |
| 36 | FZ | 抽屉移动端全屏 | 375px 视口点 IP | ✅ | `IpDetailDrawer.vue:102`（`:size="isMobile ? '100%' : '520px'"`） |
| 37 | FZ | 后端新增 `GET /api/admin/visitors/overview`（一次查询 6 个数） | 接口 | ✅ | `src/routes/admin-access.js:120-124`、`src/store/admin-access-repository.js:217` |
| 38 | FZ | 后端 `status` 新增 `active`（默认）/`trusted`（白名单派生），明细与 by-ip 同口径 | `GET /api/admin/visitors`、`/by-ip` | ✅ | `src/routes/admin-access.js:101-113,139`、`src/store/admin-access-repository.js:95,164,184` |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格 §7 验收） | 检查手段 | 证据（文件:行 / 命令） | 判定 |
|---|---|---|---|---|
| 1 | 左导航 7 块；`?view=` 可直达每块、浏览器后退可回 | 读实现 + headless 真点（换块写 URL、`history.back()` 回概览）+ 静态锁 | `VisitorsAdmin.vue:12-38,112-116`；headless `PASS 点导航写入 ?view=review` / `PASS 浏览器后退回到概览` / `PASS 左导航恰好 7 块`；`test/admin-visitors-redesign.test.js` 两条 | ✅ |
| 2 | 概览 6 卡与接口一致；待审 > 0 标红可点；30 秒自动刷新（可见时） | headless 读页面 6 个数 vs `/api/admin/visitors/overview` 比对；插 2 条访问日志后等 33s 看今日请求 +N；静态锁 30s+visibilityState | headless `PASS 概览 6 个数字与接口一致 [10,1,2,1,1,1]` / `PASS 待审 >0 标红` / `PASS 概览 30 秒自动刷新（27→30）`；`VisitorsAdmin.vue:64-88` | ✅ |
| 3 | 异常处置是唯一处置入口（行内四动作 + 批量三动作）；访问分析与 IP 抽屉无封禁/信任按钮 | headless 断言行/批量按钮存在、分析页与抽屉按钮清单（抽屉只有「关闭 / 去异常处置」）；静态 `doesNotMatch` 锁 | headless `PASS 行内动作「临时封/永久封/信任/忽略」`、`PASS 批量动作「封 IP/封设备」`、`PASS 抽屉无封禁/信任按钮 — 按钮：关闭\|去异常处置`；`test/admin-visitors-redesign.test.js` 两条 | ✅ |
| 4 | IP 抽屉内容齐全 + 两条跳转 | headless 打开抽屉逐字段断言、点「去异常处置」看高亮 + 展开；静态锁字段与两跳转 | headless `PASS IP 抽屉含 地区/状态/访问次数/独立路径/设备/最近访问/异常规则`、`PASS 抽屉「去异常处置」定位该 IP（高亮 + 展开规则）`；`IpDetailDrawer.vue:116-177` | ✅ |
| 5 | 访问分析默认 active：已封禁/已信任不出现；切「已封禁」可查；明细同口径 | headless 断言默认列表不含黑/白名单 IP、含临时封 IP；切「已封禁」后列表 = 该 IP；明细视图同集合 | headless `PASS 默认 active 不含已封禁/已信任 IP`、`PASS 默认 active 含临时封 IP`、`PASS 切「已封禁」可查历史 IP`、`PASS 明细「已封禁」同口径`；`test/visitor-overview.test.js` 三条 | ✅ |
| 6 | 处置后行消失 + toast 撤销 5 秒 + 回上一页 + 计数同步 | headless 真点「永久封」→ 确认 → 行消失/待审 2→1/黑名单命中；点撤销 → 行回原位/黑名单移除/徽标回 2 | headless `PASS 处置后行消失`、`PASS 处置后待审数减 1`、`PASS toast 带「撤销」`、`PASS 撤销后行回原位`、`PASS 撤销后黑名单已移除`、`PASS 撤销后待审数与队列行一致`；`VisitorsReview.vue:220-265` | ✅ |
| 7 | 四类解封各在自己那页；解除临时封禁不删黑名单；状态词全站统一 | 静态锁四页各自的 DELETE 接口（blacklist / device-bans / abuse / whitelist）+ 临时封禁页 0 处 blacklist 引用；状态词集中映射表被各页引用 | `VisitorsBanIp.vue:70`、`VisitorsBanDevice.vue:70`、`VisitorsBanTemp.vue:54`（且 `doesNotMatch(admin/blacklist)`）、`VisitorsWhitelist.vue:84`；`visitorStatus.js:10-27`；`test/admin-visitors-redesign.test.js`、`test/bj-abuse-views.test.js` | ✅ |
| 8 | 375px 左导航下拉、抽屉全屏、无横向溢出；`npm test`（分段）+ `frontend:build` + `scan` 全绿 | headless 375px 三断言；分段跑主链四段；构建；凭据扫描 | headless `PASS 375px 左导航收成顶部下拉 {nav:none,mobile:block}`、`PASS 375px 无横向溢出（概览/分析）`、`PASS 375px 抽屉全屏（374.99）`；`test:1~4` 逐文件 0 失败；`vite build` ✓；`scan-secrets` ✅ | ✅ |

## 验证重跑记录（QA 自己跑，不信转述）

| 命令 | 关键输出 | 结论 |
|---|---|---|
| `test/admin-visitors-redesign.test.js` | `tests 14 / pass 14 / fail 0` | 前端静态契约全绿 |
| `test/visitor-overview.test.js` | `tests 5 / pass 5 / fail 0` | 概览 + active/trusted + 明细同口径 |
| `test/visitor-ip-stats.test.js` | `tests 8 / pass 8` | by-ip 默认 active / trusted / 明细同口径 |
| `test/api.test.js`（动过 API 必跑） | `tests 41 / pass 41 / fail 0` | 全量 API 无回归 |
| `test/admin-review-lists / admin-ux-security / admin-bulk / admin-edit-dialog / bj-abuse-views / admin-console-mobile / frontend-mobile / reviews` | 全部 `fail 0` | 迁移后的旧断言没有降级 |
| `test:1` / `test:2` / `test:3` / `test:4`（分段，逐文件跑） | 四段全部 `ok`，`DONE failed=0` | 主链分段全绿 |
| `vite build --config frontend/vite.config.js` | `✓ built`（Console 包 387.90 kB） | 编译通过 |
| `node scripts/scan-secrets.js` | ✅ 未发现高置信度凭据 | 无凭据入库 |
| headless 逐状态对照（自建临时脚本，仓库外运行） | `共 62 项，通过 62，失败 0` | 与 demo 的 7 块 / 6 卡 / 抽屉 / 四页 / 375px 逐状态对齐 |

**截图（供人工目视，均在仓库外 `F:\dsh\fz-shots\`）**：`01-overview.png`、`02b-review.png`、`02-review-drawer.png`、`03-analysis.png`、`04-ban-ip.png`、`04-ban-device.png`、`04-ban-temp.png`、`04-whitelist.png`、`05-mobile-overview.png`、`06-mobile-drawer.png`。
QA 侧已用读图能力逐张核对：七块左导航 + 计数徽标、概览 6 卡（待审红 / 临时封黄）、异常处置行内四动作 + 展开逐条规则、抽屉七项字段 + 两条跳转、四个封禁页各自的解封按钮（操作列固定在右侧，窄容器也不被截断）、375px 顶部下拉 + 双列卡片 + 抽屉全屏。

## 纪律检查（steamdeals-dev §0/§8 硬规则）

1. `git tag --list`：本批**未新增 tag**（最新仍是 `v2.32.0`，本批两次提交都不打 tag）；
2. 未碰部署/服务器配置（本批提交 28 个文件全部是 `frontend/src`、`src/routes|store`、`test`、`package.json`）；
3. 无构建产物入库（`frontend/dist/`、`*.log`、`data/`、`out/` 均未进提交）；
4. 已按要求推 `main`（`05525c2`、`c0a4fd2` 两次 push origin/main；推 main 不触发构建）；
5. `docs/PROJECT-OVERVIEW.md` **未同步** —— 按本批交接单「文档由监工统一改」执行，见「需人工确认」。

## 打回清单

无（通过 8 / 缺失 0 / 偏差 0）。

已修复的过程问题（复检已覆盖）：
- 首轮 headless 目视发现「IP 封禁 / 临时封禁 / 访问分析」表格在 1280px 下操作列被挤出可视区 → 已收敛列宽并把操作列 `fixed="right"`（`c0a4fd2`），复检截图确认解封/解除/详情按钮常驻可见。

## 需人工确认

1. **`docs/PROJECT-OVERVIEW.md` 未回写**：按交接单红线，本文件由监工统一更新。建议补两处：
   ① 「功能与代码落点」加一行：访问记录七块 ＝ `frontend/src/components/visitors/*`（壳 `VisitorsAdmin.vue`＋共享态 `composables/useVisitorsAdmin.js`＋状态词 `utils/visitorStatus.js`）；
   ② 接口表补 `GET /api/admin/visitors/overview`（6 个数字）与 `visitors|by-ip` 的 `status` 新增 `active`（默认）/`trusted`。
2. **`docs/TODO.md` 的 FZ 状态未回写**：按交接单红线不改（监工统一改）。建议改为「已实现待发版」并记提交 `05525c2`（+ `c0a4fd2` 列宽收敛），同时按 QA 结论标「质检通过」。
3. **所有者目视建议**：demo 与实现已逐状态对照（见上），但「与 demo 的主观音感（间距/字号/图标）是否一致」仍建议所有者过一眼 `01-overview.png` / `02b-review.png` / `03-analysis.png`。

## 争议项（待所有者裁定）

无。

## 复检记录

- 第 1 轮（2026-11-27）：开发侧自检（主链分段 + api.test + build + scan + headless 62 项）→ QA 静态/接口/页面复核 →
  发现表格列宽问题已先行修复（`c0a4fd2`）→ 复跑相关测试 + headless 62/62 → ✅ 放行。
