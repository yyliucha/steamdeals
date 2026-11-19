# 搜索全自动派生（DS，质检通过；零人工方案）

> 状态：**质检通过（2026-11-19 实现 d607e27；QA docs/QA-DS.md 第 1 轮 ✅ 5/0/0/3；全自动、完全摆脱人工）**。
> 关联：[SEARCH-I18N.md](SEARCH-I18N.md)（AD 中英文搜索）、`src/store/pg.js` `gameKeywordSql`。
> 业界先例：Prysm（pg_trgm + unaccent 模糊，自动处理缩写/拼错/地区名）、电商拼音字段（全拼+首字母自动派生）、
> Elasticsearch pinyin 分词器、阿里云 OpenSearch 拼音简拼——本方案与其一致，**不建人工别名库**。

## 0. 决策（2026-11-19）

1. **零人工**：不做 `manual_aliases`、不做后台别名维护入口、不依赖「别名配了才有」的机制；
2. 派生索引**全部由算法生成**（拼音 / 缩写 / 罗马数字↔阿拉伯 / token），可随时全量重建；
3. 匹配 = 派生 token 包含匹配 + **pg_trgm 模糊兜底**（拼错容忍）；
4. 排序：原名/中文名直接命中 > 派生 token 命中 > 模糊命中。

## 1. 数据模型（纯派生，可重建）

```sql
alter table games add column if not exists search_tokens text[] not null default '{}';
create index if not exists games_search_tokens on games using gin (search_tokens);
```

- `search_tokens` 是**派生数据**（不是人工录入），内容变化只靠重建/增量任务；
- 现有 `game_aliases.platform_title` 仍参与匹配（平台商品标题，保留现状）。

## 2. 派生规则（`src/search-derive.js` 纯函数，单测覆盖）

输入 `{ name, nameEn }`，输出归一化 token 列表（去重、上限 40 条）：

1. **归一化**：小写；去标点/空格/商标符号（`™®©`）；全角→半角；英文去重音（JS `normalize('NFD')` 去 `\p{M}`，**不依赖 PG unaccent 扩展**，pglite/PG 行为一致）；
2. **token 拆分**：字母/数字/汉字边界（`GTA6` → `gta` + `6`；`Grand Theft Auto VI` → 5 个 token）；
3. **缩写**：`nameEn` 分词（跳过 the/a/an/of/and/in/on/at/to/for）→ 首字母连写（`GTA`）+ 与末尾数字组合（`GTA VI` / `GTA 6` / `GTA6` / `GTAVI`）；
4. **罗马数字↔阿拉伯**：词为 I/II/III/IV/V/VI/VII/VIII/IX/X/XI/XII → 阿拉伯变体；阿拉伯 1–12（位于末尾附近）→ 罗马变体；双向各一条；
5. **拼音**（中文名）：`pinyin-pro` → 全拼（`xia dao lie che shou`）+ 首字母（`xdlcs`）+ 数字组合（`xdlcs6`）；
6. **原名变体**：原名/英文名去空格连写（`grandtheftautovi`）。

## 3. 触发与维护（全自动）

- **写入路径顺带生成**：`upsertGameMeta` / `rename` / `backfill` 写 `name`/`name_en` 时同步计算 `search_tokens`（与现有写库同一条 SQL）；
- **定时任务 `search-tokens-rebuild`**（并入 `jobsFromEnv`）：每轮扫描 `search_tokens='{}'` 或名字已变更的行，增量重算；
  支持 `--full` 全量重建（CLI：`node src/cli.js search-tokens --full`）；
- 派生失败只记日志（`search.derive_failed`），不阻断写库。

## 4. 搜索与排序（`gameKeywordSql`）

- 查询侧用**同一派生函数**处理关键词（归一化 + token + 拼音/缩写变体，取 1–3 个查询 token）；
- 命中条件：`search_tokens && $tokens`（数组包含）**或** `exists(select 1 from unnest(search_tokens) t where t like '%'||kw||'%')`
  （兼容子串）；保留现有 `name / name_en / game_aliases.platform_title` 三源；
- **模糊兜底**：主查询（上述）无结果时，再用 `similarity(name_or_env, kw) ≥ 0.4` 或 `search_tokens % 0.6`（trgm）跑第二级；
  结果标注 `matchedBy: 'fuzzy'`（前端不展示，仅日志/调试）；
- 排序：`case` 分级（name/name_en 命中 0 > token 命中 1 > 模糊命中 2），再走原有 sort；
- 日志：`search.miss`（词、派生 token、耗时）——**只记日志，不建人工映射**（供后续评估阈值）。

## 5. 依赖与兼容

- 新增 npm 依赖 **`pinyin-pro`**（纯 JS、无网络、无原生编译；构建/扫描需验证）——若 CI/scan 不允许新增，退化为内置精简拼音表（常用 3500 字）；
- `pg_trgm` 扩展已在用（D1 批索引）；**不依赖 `unaccent` 扩展**（重音归一在 JS 层）；
- pglite（本地测试）与 PG 行为一致：派生在 JS 层、索引只是加速。

## 6. 验收

1. 搜 `gta6` / `GTA VI` / `gta 6` → 命中 `Grand Theft Auto VI`（派生缩写+罗马数字）；原名命中排最前；
2. 搜 `xdlc6` / `xia dao lie che shou 6` → 命中 `侠盗猎车手6`（拼音派生）；
3. 搜 `gtaa6`（拼错）→ 模糊兜底命中（阈值可调，默认 0.4）；
4. 派生任务：新写 name 的游戏下一轮即有 tokens；`--full` 全量重建可跑（19.8 万行预算内完成）；
5. **零人工确认**：代码/后台无 manual_aliases、无「别名管理」入口（grep 断言）；
6. 反向自检：清空某游戏 search_tokens → `gta6` 用例必须红；
7. `npm test`（分段）+ `npm run frontend:build` + `npm run scan` 全绿；pglite 与 PG 语义一致；
8. 性能：搜索 P95 ≤ 300ms（19.8 万行，现 LIKE 实测 114ms，token 匹配走 GIN 应更快；模糊兜底仅无结果时触发）。

## 7. 覆盖边界（如实告知）

| 输入 | 覆盖 |
|---|---|
| `gta6` / `GTA VI` / `GTA 6` / `gtaa6` | ✅ 缩写 + 罗马数字 + 模糊 |
| `xdlc6` / `xia dao lie che shou 6` | ✅ 拼音全拼/首字母 |
| `给她爱6`（谐音梗） | ❌ 算法无法覆盖；后续可选「无结果自动学习」（置信度阈值自动建映射，不人工）或向量检索，本批不做 |

## 8. 待确认

无（阈值/规则细节由实现自定，验收按 §6）。
