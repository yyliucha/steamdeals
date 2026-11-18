# QA：多源采集推进 CC 批（第 1 轮）

> 基线 7264a76 → 判据提交 49ec3e6（CC 实现）+ e0a2acc（状态回写）；判定时仓库 HEAD=f693562（CE 批随后提交，未动 CC 文件）。
> 判据 docs/SOURCE-SYNC-COVERAGE.md §4 验收 1–8（设计 §3、§5 本批不做）；开发描述来源 docs/TODO.md CC 条目。
> 结论：❌ 打回 —— 通过 7 / 缺失 0 / 偏差 1（必修）/ 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口/任务） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | CC | ITAD 同步不再永远扫同一批前 50 条：每轮按「待处理（热点/近 90 天访问优先）→ 未命中 7 天窗口 → 已匹配按间隔刷新 → 失败 2^n 天退避（上限 30 天）」游标推进不同游戏 | 定时任务 itad / 后台「同步与回填 → ITAD 匹配 → 立即运行」/ CLI `sync itad` | ✅ | src/store/pg.js:851-885（sourceSyncCandidates）；src/cli.js:660-668；test/source-sync.test.js:45-70 |
| 2 | CC | GOG 同步同样按游标推进全目录（不再永远前 50 条） | 定时任务 gog / 后台「GOG 匹配 → 立即运行」/ CLI `sync gog` | ✅ | src/cli.js:880-900（syncByTitle）；test/source-sync.test.js:72-101 |
| 3 | CC | Humble 同步同样按游标推进全目录 | 定时任务 humble / 后台「Humble 匹配 → 立即运行」/ CLI `sync humble` | ✅ | 同上 |
| 4 | CC | ITAD 优先英文名搜索（无英文名才用中文名），命中后缓存 ITAD id，后续刷新直接按 id 批量取价、不再重复搜索 | 定时任务 itad / 后台「立即运行」 | ✅ | src/cli.js:675-700（`g.name_en \|\| g.name`、`g.external_id ?? null` 短路 search、`fetchPrices(ids)` 批量）；test/source-sync.test.js:136-137 |
| 5 | CC | GOG 命中后缓存 product id，二次刷新按 id 直取（区服/币种透传、toOffer 同构） | 定时任务 gog | ✅ | src/adapters/gog.js:156-175（fetchById `ids=` 参数）；src/cli.js:905-908；test/source-sync.test.js:142,152 |
| 6 | CC | Humble 命中后缓存 slug，二次刷新按 slug 直拉商品页（JSON-LD 校验、toOffer 同构） | 定时任务 humble | ✅ | src/adapters/humble.js:91-102（fetchBySlug + parseProductLd）；src/cli.js:905-908；test/source-sync.test.js:143,153 |
| 7 | CC | 未命中 7 天内不重复探测；失败按 2^n 天退避（上限 30 天）后自动重试 | 各源定时任务 | ✅ | src/store/pg.js:861-864（nomatch/failed 窗口 SQL）；test/source-sync.test.js:77-97（拨表真跑） |
| 8 | CC | 后台「同步与回填」任务表从 5 项扩到 9 项（新增 ITAD/GOG/Humble/杉果），可「立即运行」，运行中互斥 409 | 后台 → 同步与回填 | ✅ | frontend/src/pages/AdminModules.vue:323-325（TASK_META/TASK_ORDER 9 项）、:522（runTask 四源走 /api/admin/sync）；src/server.js:2674（MODES 四源）、2683-2687（startSteamJob BUSY→409） |
| 9 | CC | 任务表新增「覆盖」列：每源显示 匹配 / 未命中 / 待探测 数量 | 后台 → 同步与回填 | ✅ | frontend/src/pages/AdminModules.vue:18（`row.stats.matched/nomatch/pending`）；src/server.js:2705-2713（sourceStats）；src/store/pg.js:899-911 |
| 10 | CC | 系统设置新增四源「每轮条数」（ITAD/GOG/Humble 默认 50；杉果默认 0=全部 SKU） | 后台 → 系统设置 → 数据源与采集 | ⚠️ | src/settings.js:69-72（4 项定义）；**杉果默认 0 被实现当作「0 条」而非「全部 SKU」——见打回清单 1** |
| 11 | CC | 每轮结束写进度日志 `sync.source_progress`（scanned/matched/nomatch/failed/remaining）+ `sync.done`，四源都有 | 服务器日志 | ✅ | src/cli.js:647-648（sonkwo）、742-744（itad）、932-934（gog/humble 共用） |
| 12 | CC | 部署后：热点游戏优先出现 ITAD/GOG/Humble 报价、后台指标「未探测」持续下降 | 游戏目录 / 后台指标卡 | 🔎 | 验收 8，本地无法验证（见「需人工确认」） |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格 §4 验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 连续两次运行处理不同游戏（tried 递增 / remaining 递减） | 读候选 SQL + 测试断言 | src/store/pg.js:851-885（left join 无行即 pending、limit+状态过滤同游戏同源只取一次）；test/source-sync.test.js:45-70（两轮不重叠 + pending 12→2 递减，pglite 真跑） | ✅ |
| 2 | 状态落库（matched/nomatch/failed）+ offers 回填 matched + 老数据无行=pending | 读 DDL/迁移/测试 | src/store/pg.js:376-389（SOURCE_SYNC_DDL：PK(game_id,platform_code)+idx_gss_pending）、477-483（回填 `on conflict do nothing` 幂等）；test/source-sync.test.js:28-43 | ✅ |
| 3 | ITAD 优先英文名；external_id=ITAD id；二次批量取价不再 search | 读 cmdSyncItad + 测试 | src/cli.js:676-702（`g.name_en \|\| g.name`、`g.external_id ?? null` 时跳过 searchGame、`fetchPrices(ids)` 批量）；test/source-sync.test.js:136-137 | ✅ |
| 4 | GOG/Humble 命中存 id/slug，二次走 id/slug；未命中 7 天不重复 | 读 syncByTitle matched 分支 + 适配器 + 窗口 SQL | src/cli.js:904-912（`g.status==='matched' && externalId` → fetchById/fetchBySlug）；src/adapters/gog.js:156-175、humble.js:91-102；src/store/pg.js:862（nomatch 7 天窗口）；test/source-sync.test.js:77-90 | ✅ |
| 5 | 后台 4 源可见/立即运行/409/上次运行与匹配剩余 | 读 server + 前端 | src/server.js:2674、2683-2687、2705-2713；frontend/src/pages/AdminModules.vue:18、323-325、522；test/source-sync.test.js:145-149 | ✅ |
| 6 | 日志 sync.source_progress/sync.done 带进度；npm test 全绿 | 读日志点 + 重跑 | src/cli.js:647-648、742-744、932-934；重跑：npm test 88 文件 0 fail（exit 0） | ✅ |
| 7 | 不新增定时任务（复用 itad/gog/humble/sonkwo） | diff scheduler.js + 静态断言 | 7264a76..HEAD 未改 src/scheduler.js；既有任务 `args: ['sync','sonkwo'|'itad'|'gog'|'humble']` 保留；test/source-sync.test.js:154-157 | ✅ |
| 8 | 部署侧：两轮调度后「未探测」下降、三源报价出现（热点优先） | 无法本地验证 | —— | 🔎 |

## 打回清单（按严重度排序）

1. **【必修 · 偏差】杉果每轮条数默认 0 实际让杉果同步空转（违反规格 §5.1「不改杉果现有队列与节奏」）**
   - 事实链：src/settings.js:72 定义 `sources.sonkwo.limit` 默认 0、help 写「0 = 全部 SKU」；hydrateSettings（src/settings.js:825-831）无条件把默认值写回 env；src/cli.js:607 `const limit = Number(process.env.SOURCES_SONKWO_LIMIT || flag('limit', skus.length))` 里 `'0'` 是 truthy 字符串 → limit=0 → `skus.slice(0, 0)` 为空。
   - 实证（pglite 水合后打印）：`SOURCES_SONKWO_LIMIT="0"`、`limit=0、targets=0`。CLI 与调度器两条路径都会先水合（src/cli.js:2780-2782；src/scheduler.js:638/789 + spawn 带 process.env），因此**默认配置下每轮 `sync sonkwo` 处理 0 个 SKU，杉果报价静默停止刷新**（只打 sync.start/sync.done，不报错）。
   - 修复建议：src/cli.js:607 改为「env 数值 >0 才采用，否则取 skus.length」（如 `const n = Number(process.env.SOURCES_SONKWO_LIMIT); const limit = n > 0 ? n : skus.length;`），或在 cmdSyncSonkwo 里显式实现「0=全部」语义；并在 test/source-sync.test.js 补一条断言锁住「默认水合值下 sonkwo 目标数 = skus 总数」（当前 5 项测试没锁这条）。
2. 【风险 · 记录即可】CE 加固改动混入 CC 提交：49ec3e6 在 cli.js cmdMatch 里加了 `--yes` 二次确认与 `best.auto/best.reasons` 依赖，而当时 src/match.js 尚未提供 auto/reasons（e0a2acc 时点 `match --apply` 会自动应用 0 条）。当前 HEAD=f693562 已由 CE 批 5392852 补齐 match.js，契约一致、不再破坏；留痕提醒：批次提交只放本批文件。
3. 【低 · 记录即可】docs/SOURCE-SYNC-COVERAGE.md 标题行仍是「…（待开发）」，与状态行「已实现待发版」不一致；复检时顺手改。另 e0a2acc 删除了 TODO CC 条目的「依赖：无（…不改 Steam/杉果既有队列）」行，不影响判定。

## 需人工确认

- **验收 8**：部署后连续观察两轮调度——后台「未探测」持续下降、GOG/Humble/ITAD 报价开始出现且热点游戏优先。本地/静态无法验证。
- 附带观察项：修复打回项 1 之前，杉果任务每轮 `scanned=0`（空转），部署观察时请一并核对杉果报价是否仍在刷新。

## 争议项

- 无。

## 复检记录

- 第 1 轮（2026-11-16）：❌ 打回 1 项必修（杉果 limit 默认 0 空转）+ 2 项记录。复检时只重查打回项 + 新增 diff + `npm test`/`source-sync` 兜底。
- **第 2 轮（2026-11-16）：✅ 放行 —— 通过 7 / 缺失 0 / 偏差 0 / 需人工确认 1（沿用第 1 轮：验收 8 部署后连续两轮观察）。**
  - 重查范围：打回项 + 新增 diff（`64c30d1..HEAD` = 6540719 修复 + f952dfa 状态回写，5 文件 11 增 4 删，全部落在打回范围；未动 CE 批文件）+ `npm test` 兜底。
  - 必修 1 已修复（src/cli.js:609-612）：显式换算 `rawLimit === 0 ? skus.length : rawLimit`，负值/非法被 `rawLimit >= 0` 与 `Number.isFinite` 挡掉回落 `flag('limit', skus.length)`。**运行时实证**（pglite 真实 `hydrateSettings` 后逐分支评估同一表达式）：默认水合 env=`"0"` → limit=全部 SKU；env=`"25"` → 25；env 未设 → 回落 flag（全部）；env=`"-5"`/`"abc"` → 回落，**任何分支不再出现 0 条空转**。
  - 回归锁已补（test/source-sync.test.js:154-155）：`assert.match(cli, /rawLimit === 0 \? skus\.length : rawLimit/)` 锁住换算表达式，与 src/cli.js:611 逐字符吻合；settings.js:72 默认 0 + help「0 = 全部 SKU」与换算语义一致，规格 §5.1「杉果仍按 SKU 文件」不受影响（默认值走「全部」即原节奏）。
  - 重跑：`node test/source-sync.test.js` → `# tests 5 / # pass 5 / # fail 0`；`npm test` → 88 个测试文件全链 exit 0（链尾 secrets.test.js `# fail 0`）；`npm run frontend:build` → `✓ built in 2.91s`；`npm run scan` → 扫描 473 个文件、✅ 未发现高置信度凭据。
  - 记录项收尾：SOURCE-SYNC-COVERAGE.md 标题已改「已实现待发版」（第 1 轮记录项 3）✅；第 1 轮记录项 2（CE 加固混入）已由 CE 批 5392852 补齐 match.js，契约一致 ✅。
  - 部署观察提醒（验收 8）：修复前杉果每轮 `scanned=0` 空转，部署后请核对杉果报价恢复刷新（`sync.start skus>0`）且不再有 `skus: 0` 的 sync.done。

## 重跑验证（本次实跑，输出关键行）

| 命令 | 结果 |
|---|---|
| `npm test` | 88 个测试文件全部 `# fail 0`，exit code 0（约 24 分钟） |
| `node test/source-sync.test.js` | `# tests 5 / # pass 5 / # fail 0` |
| `npm run frontend:build` | `✓ built in 2.80s` |
| `npm run scan` | 扫描 472 个文件，✅ 未发现高置信度凭据 |
| `node test/settings.test.js` / `test/setup.test.js`（HEAD 变动后补跑） | 8/8、4/4 通过（含 69 项计数断言） |
| pglite 水合实证（打回项 1 证据） | `SONKWO env hydrated = "0"` → `limit= 0  targets= 0` |

## 纪律项

- `git tag --list`：无 CC 新 tag（v2.18.0 属于区间内 f71242b 发版提交，非 CC）✅
- 49ec3e6 提交内容仅 src/test/docs/前端/package.json，无构建产物、无日志文件（apk/idsig/latest.json 来自 f71242b）✅
- `main...origin/main`：已推送 ✅
- docs/PROJECT-OVERVIEW.md:107 已同步 CC 行（已实现待发版）✅
- 未碰部署/服务器配置、未 git add/commit ✅
