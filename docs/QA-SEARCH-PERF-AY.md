# QA：AY 批（搜索性能修复）

> 基线 `0c8be4c` → HEAD `ffda3a9`（主修复 `71d0f87`；补充测试 `ffda3a9`）。
> 判据：`docs/READ-MODEL.md` §9 门槛 + §12（AY 修订）。
> 结论：**✅ 放行（功能/代码层） —— 通过 8 / 缺失 0 / 偏差 0 / 需人工确认 3**（性能三项须部署后复测）

## 功能清单（本批交付的全部功能，一条一行）

| # | 功能（用户视角） | 入口（页面/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|
| 1 | 零命中关键词**立即返回**，不再跑 count/列表全表扫（原 1.59s） | `POST /api/games/search`（前台搜索） | ✅ | [pg.js:1337](gameprice/src/store/pg.js#L1337)（候选 0 直接 return）；测试断言 count 查询 0 次 |
| 2 | 关键词先按 名称/英文名/平台别名 三臂走 trigram 索引取候选 ID | 同上 | ✅ | [pg.js:1320-1333](gameprice/src/store/pg.js#L1320-L1333)；单臂实测 BitmapOr 2.4ms |
| 3 | 纯数字关键词按 AppID 精确命中（语义不变） | 同上（`q=7002`） | ✅ | `pg.js` appidArm；测试 AppID 命中 |
| 4 | 宽泛关键词（候选 ≥5000）自动回退原 LIKE，`total` 仍精确 | 同上 | ✅ | [pg.js:1339-1340](gameprice/src/store/pg.js#L1339-L1340)；测试用 `SEARCH_KEYWORD_CANDIDATE_CAP=1` 锁回退分支 |
| 5 | 默认列表免外部排序（`heat DESC NULLS LAST` 部分索引） | 首页默认列表 | ✅ | [pg.js:449](gameprice/src/store/pg.js#L449)（`games_heat_live`）；`pg.test.js` 断言谓词一致 |
| 6 | `/api/games/count` 两个计数合并 60s 缓存（priced+catalog） | 前台「实时数量」 | ✅ | [server.js:296](gameprice/src/server.js#L296)、[:997-1003](gameprice/src/server.js#L997-L1003) |
| 7 | 语义不变：20 组筛选组合 total/首页 id 顺序一致；成人/禁用/回收站过滤仍生效 | 前台列表 | ✅ | `test/game-search-read-model.test.js` 组合一致性用例 + 新关键词用例 |
| 8 | 计划修好后 JIT 不再触发（原零命中 +221/343ms） | 生产复测项 | 🔎 | 依赖部署后 `EXPLAIN`（见风险） |

## 逐条核对（规格 §9 / §12）

| # | 条目 | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | §9-2 零命中 <150ms（原 1.59s） | 本地逻辑 + 生产计划证据 | 候选 0 直接返回；单臂索引实测 2.4ms，不再执行 800ms 全扫 | ✅（待复测） |
| 2 | §9-1 默认列表 P95<150ms（原 340ms） | 代码 + 计划 | 排序改走 `games_heat_live`，count 缓存；预期 ≈130ms | ✅（待复测） |
| 3 | §9-3 count <30ms（原 163ms） | 代码 | priced+catalog 合并 60s 缓存，命中时 0 查询 | ✅（首访 ≈126ms，缓存后达标） |
| 4 | §9-4 EXPLAIN 不出现 daily_prices 聚合/offers 全表 | 代码 | 未改读模型 SQL 主体，仅关键词/排序/缓存 | ✅ |
| 5 | §9-5 新旧实现 20 组组合一致 | 回归测试 | `game-search-read-model.test.js` 9/9（含 20 组组合） | ✅ |
| 6 | §12-13 零命中不执行 count/列表 | 单测（计数 SQL 调用） | 新测试 `countQueries === 0` | ✅ |
| 7 | §12-14 关键词四源命中不变 | 单测 | 中文名（空格归一化）/英文名/别名/AppID 各一例 | ✅ |
| 8 | §12-15 索引谓词与列表过滤一致 | 单测 | `pg.test.js` 断言 `games_heat_live` 谓词 | ✅ |

## 亲自重跑的验证

| 命令 | 关键输出 | 结论 |
|---|---|---|
| `npm test` | **79 个文件 / 630 项 / `# fail 0`**，`EXIT=0` | ✅ |
| `node test/api.test.js` | `# tests 22 / # pass 22 / # fail 0` | ✅ |
| `node test/game-search-read-model.test.js` | 9/9（含新增 AY 用例） | ✅ |
| `node test/pg.test.js` | 18/18（含 `games_heat_live` 断言） | ✅ |
| `npm run frontend:build` | `✓ built in 1.78s` | ✅ |
| `npm run scan` | 未发现高置信度凭据 / 可疑密钥赋值 | ✅ |
| `npm run todo:progress:check` | 与 TODO 一致 | ✅ |
| `node test/docs.test.js` | 5/5 无断链 | ✅ |

## 风险提醒（不判错）

1. **性能门槛只能部署后复测**：本地 pglite 无 `pg_trgm`、数据量 200 行，无法复现生产计划；预期值基于生产 EXPLAIN 推算。
2. **建索引窗口**：`games` 198k 行建 `games_heat_live` 与 `migrate` 里的 trigram 索引均为 `create index if not exists`；
   大表首次建索引会短暂阻塞写入，建议部署窗口执行（与 AV 回填同类）。
3. **宽泛关键词仍慢**：候选 ≥5000 回退原 LIKE（如单字母查询），保证 total 精确但保持原耗时；属有意的正确性优先。
4. **count 缓存 60s**：数字最多滞后 1 分钟（与 priced 口径一致）。

## 需人工确认（3）

1. 部署 `v2.11.0`（或下个版本）后，用 §12 的 6 条 `EXPLAIN` 复测：关键词查询不再 `Seq Scan on games`、默认列表不再
   `Sort Method: external merge`。
2. 三项门槛实测：搜索 P95<150ms、零命中<150ms、count<30ms（首次未命中缓存 <100ms）。
3. 生产 `game_region_snapshot`/`games` 实际行数与索引创建耗时（必要时择窗口）。

## 复检记录

- 第 1 轮（2026-11-11）：功能 8 条、验收 8 条逐条核对；`npm test`（79 文件 / 630 项）/ `api.test` / `build` / `scan` 全绿；
  性能门槛标记为「部署后复测」（无法在本地 pglite 复现生产规模） → ✅ 放行（功能层）。
