# QA：CR 开发商/发行商名称脏数据修复（第 1 轮）

> 基线 5673ee9（fix(meta): CR 批）+ 2b5f88b；判据 = [APP-DEV-PUBLISHER-NAMES.md](APP-DEV-PUBLISHER-NAMES.md) §5 验收 +
> 所有者 2026-11-17 确认的 5 项决策。结论：✅ 放行 —— 通过 7 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批全部功能，一条一行）

| # | 功能（用户视角） | 入口 | 状态 | 证据 |
|---|---|---|---|---|
| 1 | App / 接口里的开发商、发行商显示为**纯名称**（不再出现 `{"name":…,"creator_clan_account_id":…}` 原始 JSON） | GetItems 写入路径 + 详情接口 | ✅ | store-browse `namesFromList` 归一化（对象取 name）；test 1「mapStoreItem 对象数组→名称（生产夹具：黎明杀机）」 |
| 2 | 名称列表口径：去首尾空白 / 过滤空值 / **去重保序** / 单条截断 200 / **上限 20** | 写入与迁移同一口径 | ✅ | test 2 六组断言（空白/重复/脏 JSON 文本兜底/截断/上限/null） |
| 3 | 历史库里已污染的旧数据在部署后**自动清洗**（无需人工跑命令），且**幂等**（重复启动结果不变） | `migrate()` 内嵌清洗 SQL | ✅ | test 3「造脏行→migrate→归一并幂等（二次无变化）」；SQL 只在含 `{` 元素时更新 |
| 4 | 详情接口契约：`developers`/`publishers` 一律**字符串数组或 null** | `/api/games/:appid` 等 | ✅ | test 5 真跑 HTTP 断言 |

## 验收逐条核对（规格 §5）

| # | 验收点 | 判定 | 证据 |
|---|---|---|---|
| 1 | `mapStoreItem({basic_info:{developers:[{name,creator_clan_account_id}]}})` → `['Behaviour Interactive Inc.']` | ✅ | test 1（生产夹具 381210）+ 断言不含 `creator_clan_account_id` |
| 2 | 混合数组/空值/重复按口径处理 | ✅ | test 2：`[' A ','A','','B']→['A','B']`；`['  ',null,42,{}]→null`；脏 JSON 文本→name；300 字→200；30 条→20 |
| 3 | `writeGames`/`upsertGameMeta` 写对象数组成员 → 库里读回纯字符串 | ✅ | test 4（PG pglite 真库断言） |
| 4 | 造脏行（元素为 `{"name":"Y"}` 文本）→ `migrate()` → 归为 `['Y']`；再跑一次无变化 | ✅ | test 3（migrate 连跑三次：建库/清洗/幂等） |
| 5 | 详情接口 `developers`/`publishers` 不含 `{` | ✅ | test 5（startApiServer + fetch 真跑） |
| 6 | `npm test` / `frontend:build` / `scan` 全绿；migrate 连跑两次不报错 | ✅ | 全链 `npm test` **EXIT=0**（本会话权威跑）；`frontend:build` ✓；`scan` ✅；test 3 内 migrate ×3 无错 |
| 7 | 部署后统计脏行归零 + 抽查 3 款已知脏游戏 | ⏳ 需人工确认 | 规格 §6 只读 SQL（dirty_rows 期望 0） |

## 四方一致检查

- **适配层**：归一化只动 GetItems 入口（`mapStoreItem`）；`normalizeOfficial`（appdetails 字符串数组）与 `normalizeSteamcmd`（associations[].name）口径不变 ✅
- **存储层**：`migrate()` 尾部幂等清洗（去空/去重保序/上限 20/截断 200，与写入同口径）；无 schema 变更、无数据删除 ✅
- **接口层**：契约字符串数组或 null（真跑断言）✅
- **测试**：`test/dev-publisher-names.test.js` 5 项进主链（package.json test 链已含）✅
- **文档**：规格 / TODO CR / INDEX CR 均在库 ✅

## 纪律项

- 本批不含 App 仓库与 Web UI 改动（所有者确认项 1/4）✅；提交不含 ce-dev 未提交的文档改动（CHANGELOG/CN 收尾行仍在其工作区）——CR 实现提交 5673ee9 + package.json 链提交 2b5f88b ✅

## 需人工确认（部署后）

1. **统计脏行归零**：规格 §6 SQL 期望 `dirty_rows = 0`（清洗前可先跑一次度量影响面）；
2. **抽查 3 款已知脏游戏**（如 381210 黎明杀机 / 纪元1800 / 其他曾显示 JSON 的详情）确认 App 与接口都显示纯名称；旧版 App（< 2.20.0）同样不再显示 JSON。

## 复检记录

- 第 1 轮（2026-11-18）：5673ee9 / 2b5f88b，放行 ✅。
