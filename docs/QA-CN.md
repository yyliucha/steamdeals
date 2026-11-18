# QA：对齐审核查询性能热修（CN 批，第 1 轮）

> 基线 0bfaceb（release v2.24.0）→ HEAD d039247（实现 5c723aa + 文档回写 b2b6a15；检查期间其它会话另推
> 8712c9c CR 需求、d039247 CK/CM 已发布回写，未触碰 CN 行与 CN 代码，代码与 b2b6a15 一致）。
> 判据 docs/ALIGN-QUERY-PERF.md §4 验收 1-7；开发描述来源 TODO CN「实现（2026-11-17）」段。
> 结论：✅ 放行 —— 通过 7 / 缺失 0 / 偏差 1（规格状态行未回写，记录级）/ 需人工确认 4

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | CN | 打开对齐审核直接读缓存（第二次 ≤200ms，实测 7ms） | 后台 → 游戏管理 → 对齐审核（GET /api/admin/align） | ✅ | HTTP 冒烟「缓存命中: cached=true 耗时 7 ms」；src/align-query.js:20-23；test/align-perf.test.js:16-40 |
| 2 | CN | 强制刷新重算 | 对齐审核页「刷新」按钮 → ?refresh=1 | ✅ | AlignAdmin.vue:31/121；冒烟「refresh=1: cached=false total=45」；align-query.js:19 |
| 3 | CN | 队列分页（20 条/页、可切页、总数一致；非法参数回落 1..50） | 对齐审核页分页条 → page/pageSize | ✅ | server.js:4217-4219/4236-4239；冒烟「分页 p2: rows=20 total=45」；AlignAdmin.vue:31/136 |
| 4 | CN | 显示生成时间与缓存状态（「生成于 …（缓存/本次计算）」） | 对齐审核页表格上方 | ✅ | AlignAdmin.vue:123-124；server.js:4241-4242；siteTime.js:21-34 |
| 5 | CN | 20s 预算超时返回部分结果 + 页面黄色警告提示 | 对齐审核页（partial 时 el-alert） | ✅ | align.js:116-119；server.js:4244；AlignAdmin.vue:122-123；test/align-perf.test.js:178-187 |
| 6 | CN | 计算期间站点其它接口不被阻塞（匹配循环分片让出事件循环） | 全站（/api/games/count、/api/site 等） | ✅（部署后 P95 观察 🔎） | align.js:136 + server.js:605（setImmediate 分片）；test/align-perf.test.js:201-214；冒烟「计算期间并发 count=200 site=200」 |
| 7 | CN | 确认/忽略后队列立即按新状态重算 | 对齐审核页 确认合并/忽略 → 页面自动重载 | ✅（接线代码核对；HTTP 级未验 🔎） | server.js:4314/4328（invalidate）+ AlignAdmin.vue:67/78（load）；align-query.js:46-49 + 单测 16-40 |
| 8 | CN | 候选预筛不改提案口径（CE 13 条误匹配不进、正确样例命中） | 对齐审核队列结果 | ✅（零 token 标题边界 🔎） | match.js:410-433；test/align-perf.test.js:72-157（13 条与 test/match.test.js:110-122 同源） |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格 §4 验收） | 检查手段 | 证据（文件:行 / 命令） | 判定 |
|---|---|---|---|---|
| 1 | 缓存命中 ≤200ms | QA 独立复跑 HTTP 冒烟 + 单测 + 代码位置 | 冒烟「缓存命中: cached=true 耗时 7 ms（≤200ms）」；align-query.js:11-55；**alignRunner 定义在 createApiServer 实例级、createServer handler 外**（server.js:572-611），缓存跨请求共享；test/align-perf.test.js:16-40 | ✅ |
| 2 | 计算中并发 /api/games/count 与 /api/site 不受影响 | 分片代码 + yield 单测 + 冒烟 | server.js:605（shouldYield=setImmediate）+ align.js:136（每 yieldEvery=200 组 await）；test/align-perf.test.js:201-214（断言 yield 调用 4 次）；冒烟「计算期间并发: count=200 / site=200 / align=200」 | ✅（P95 量化待部署观察 🔎） |
| 3 | 并发 5 请求只算 1 次 | 单测 + 反向自检（QA 独立复跑） | test/align-perf.test.js:42-60（computes=1）；QA 突变 A：临时副本删「computing 复用」分支 → 11 pass / 1 fail（single-flight 红），恢复后 12/12 绿 | ✅ |
| 4 | 超时返回 partial、不 5xx、不阻塞后续 | 单测 + 反向自检 + 响应代码 | align.js:116-119（超时 break、partial=true、不抛错）；server.js:4244（200 + partial 字段）；test/align-perf.test.js:178-187；QA 突变 B：删预算检查 → 11 pass / 1 fail（partial 红），恢复后绿 | ✅ |
| 5 | CE 13 条误匹配不进候选、正确样例仍命中 | 同源比对 + 口径代码比对 | test/align-perf.test.js:72-104 的 13 条与 test/match.test.js:110-122 完全同源；正确样例 106-123；budgeted 与旧 proposeAlignGroups 同 bestMatchMulti 同参（align.js:76/126）；CLI 仍走同步旧签名（cli.js:714/1305） | ✅（零 token 标题边界 🔎） |
| 6 | 分页 page/pageSize 生效、总数一致；?refresh=1 生效 | 冒烟 + 前端/后端代码 | 冒烟「分页 p2: rows=20 total=45（45 组 3 页）」「refresh=1: cached=false」；server.js:4217-4219（page≥1、pageSize 1..50 非法回落，默认 20）；AlignAdmin.vue:31（page/pageSize 进 URL）、136（PaginationBar @change 触发 load） | ✅ |
| 7 | npm test / frontend:build / scan 全绿；不自行打 tag | QA 独立重跑 | npm test：97 个文件、815 用例全 pass（exit 0）；frontend:build ✓ built in 2.10s；scan：0 高置信凭据；git tag --list 无新增 tag（v2.24.0 属基线 0bfaceb） | ✅ |

## 纪律固定检查项

| 项 | 结果 |
|---|---|
| 无擅自 tag | ✅ git tag --list 与基线一致，无新增 |
| 未碰部署/服务器配置 | ✅ diff 仅 src/frontend/test/docs/package.json 10 文件，无 compose/凭据 |
| 构建产物未入库 | ✅ diff 无 frontend/dist、日志、pgdata |
| 已推 main | ✅ HEAD d039247 == origin/main（`## main...origin/main`） |
| 文档收尾 | ✅ TODO/INDEX/PROJECT-OVERVIEW 已同步（TODO 状态行缺提交哈希、规格状态行未回写——见打回清单 1，记录级） |

## 打回清单（按严重度排序，可执行）

1. 【低 · 记录级 · 随收尾复盘补】`docs/ALIGN-QUERY-PERF.md` 标题行（L1「（待开发）」）与状态行
   （L3「已确认待开发」）未随实现回写「已实现待发版」。项目先例：MOBILE-LOGIN-ENTRY-FIX.md /
   PRICE-REPORT-EMAIL.md 在实现时即回写规格状态行；QA-SOURCE-SYNC-CC 对同款问题判「低 · 记录即可」、
   复检顺手改。建议收尾复盘补一行：`> 状态：已实现待发版（2026-11-17，5c723aa，待质检）`；
   顺带 docs/TODO.md CN 状态行补提交哈希（INDEX/OVERVIEW 已含 5c723aa）。
2. 【低 · 记录级】`GET /api/admin/align` 分页参数非法值回落（server.js:4218-4219）无单测锁定
   （冒烟只覆盖合法参数）；建议后续补 1 条边界断言（page=0/abc、pageSize=999 → 回落 1/50/20）。

## 需人工确认

1. **验收 2 的生产量化面**：本地 pglite 冒烟只有 45 组、计算窗口过小，「P95 不受影响」的量级证据
   来自分片机制单测 + 冒烟 200 响应；真实 P95 需部署后观察（align 请求耗时、count/site 延迟、容器健康检查）。
2. **零 token 标题边界（预筛口径理论差异）**：纯「中文+数字」连写标题（如「三国志14」无空格）归一化后
   是混合 token，indexTokens 两种正则都不收 → 无归一化全等候选时预筛返回空集，而旧全量比较可能命中。
   快路径已兜住完全同名情况；上线后抽查该类标题提案，如命中建议补混合 token 召回。
3. **confirm/ignore 后队列刷新的 HTTP 级验证**：接线代码已核对（server.js:4314/4328 + 前端 load()），
   runner.invalidate 有单测锁定，但未做「确认 → GET 已不含该组」的真 HTTP 断言。
4. **前端页面目视**：partial 警告条与「生成于 …」提示为代码 + 编译级核对，未做浏览器目视。

## 风险提醒（查多：diff 0bfaceb..HEAD 全量过目）

- b2b6a15 顺带夹带 CR 需求条目（docs/TODO.md + REQUIREMENTS-INDEX.md 的 CR 行）——收尾复盘吸收他会话
  未提交内容所致，内容与后续 8712c9c 需求提交一致，不属 CN 范围，不判。
- 检查期间其它会话另推 2 提交（8712c9c CR 需求、d039247 CK/CM 已发布回写）：均未触碰 CN 行与 CN 代码，
  本报告验证基于最终 HEAD d039247。
- `preselectCandidates` 快路径命中时不截断 maxCandidates（同名归一化重复 >2000 时理论超上限，实际极少）。
- `GET /api/admin/align` 响应 `computing` 字段恒 false（await 后才返回），冗余字段、前端未消费，无行为影响。
- 决策 §2 #5「只对当前页组做候选匹配」实现为「全量组计算 + 缓存 + 切片分页」——实现方式自由（验收 6
  以行为为判据已满足），与缓存模型一致，20s 预算兜底防全量过久。

## 复检记录

- 第 1 轮（2026-11-17）：✅ 放行；记录级 2 项随收尾复盘补。
