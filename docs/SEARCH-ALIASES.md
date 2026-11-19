# 搜索别名（民间简写）：GTA6 这类简称能搜到（DS，待开发）

> 状态：**已确认待开发（2026-11-19 所有者 5 项口径）**。关联：[SEARCH-I18N.md](SEARCH-I18N.md)（AD 批中英文搜索）、`src/store/pg.js` `gameKeywordSql`。

## 1. 问题与现状（代码证据）

- 搜索只匹配 `name / name_en / game_aliases.platform_title`（pg.js:1615 三源 exists 子查询）；
- 「Grand Theft Auto VI」不含 `gta6` 连续串，也没有罗马数字↔阿拉伯转换 → 搜 `gta6` / `GTA 6` 无结果；
- `game_aliases` 是**平台商品标题**（有 `platform_code` 外键、唯一键 `(platform_code, platform_product_id)`），不适合存「搜索别名」。

## 2. 已确认的决策（2026-11-19 所有者）

| # | 决策 |
|---|---|
| 1 | 搜索别名存 **`games.search_aliases text[]`**（不用 game_aliases 表） |
| 2 | **自动生成 + 人工维护**：自动（英文缩写 + 罗马数字变体）与人工并存，人工不被自动覆盖 |
| 3 | 自动规则：英文名**首字母缩写**（跳过 The/A/An/Of/And/In/On/At/To/For）+ **罗马数字↔阿拉伯双向**（VI↔6）+ 去空格/大写归一；如 `Grand Theft Auto VI` → `GTAVI / GTA 6 / GTA6 / Grand Theft Auto 6`；中文别名（侠盗猎车手6）靠人工补 |
| 4 | 人工别名入口：后台「游戏目录 → 编辑」弹窗加「搜索别名（逗号分隔）」字段 |
| 5 | 别名命中**降权**（原名/中文名命中优先，别名命中次之） |

## 3. 数据模型

```sql
alter table games add column if not exists search_aliases text[] not null default '{}';  -- 自动生成
alter table games add column if not exists manual_aliases text[] not null default '{}';  -- 人工维护（不被覆盖）
create index if not exists games_alias_trgm on games
  using gin (replace(lower(coalesce(array_to_string(search_aliases || manual_aliases, ' '), '')), ' ', '') gin_trgm_ops);
```

- 自动变体**上限 20 条**（去重、去空、按长度排序）；
- 人工别名写入 `manual_aliases`；自动生成任务**只重算 `search_aliases`**，绝不碰 `manual_aliases`。

## 4. 自动生成（写入 name_en 的路径统一调用）

- 触发点：`upsertGameMeta` / `rename`（回填中文名时）/ `backfill`（写 name_en 时）；
- 规则：
  1. 分词（空格/连字符/冒号拆分）→ 跳虚词 → 首字母连写（`GTA`）；单词数 <2 时跳过缩写；
  2. 罗马数字识别（词为 I/II/III/IV/V/VI/VII/VIII/IX/X/XI/XII 且位于末尾附近）→ 阿拉伯数字变体；阿拉伯→罗马反向也给一条；
  3. 组合生成：`缩写+数字连写 / 缩写+空格+数字 / 全名+阿拉伯数字 / 全名+罗马数字`；
  4. 与原名相同或为空的结果丢弃。

## 5. 搜索与排序（`gameKeywordSql`）

- 关键词侧：与现有归一化一致（去空格、小写）；`search_aliases || manual_aliases` 任一元素归一化后 LIKE/`%kw%` 命中（走 trgm 索引）；
- 排序：`case when (name/name_en 命中) then 0 else 1 end` 作为次级排序键（别名命中降权）；其余排序口径不变；
- **对齐匹配不受影响**：`match.js` 不读 `search_aliases`/`manual_aliases`（别名只服务搜索）。

## 6. 后台

- 游戏目录「编辑」弹窗：新增「搜索别名（逗号分隔）」输入框，读/写 `manual_aliases`；
  保存后提示「别名仅影响搜索，不影响对齐」；接口 `PATCH /api/admin/games/:id` 扩展 `manualAliases` 字段（校验 ≤20 条、单条 ≤40 字、去重）。

## 7. 验收

1. 搜 `gta6`、`GTA 6`、`gta vi` 均命中 `Grand Theft Auto VI`（自动变体生效），且**排在原名命中的结果之后**；
2. 搜 `侠盗猎车手6` 命中（该中文名若在 name 中则直接命中；否则人工别名补充后命中）；
3. 后台给某游戏加人工别名 `testalias1` → 搜索命中；再跑一次自动生成任务，人工别名**仍在**；
4. 别名不参与对齐匹配：`game_source_map` 匹配结果不因别名变化；
5. 自动变体上限/去重生效；`npm test`（分段，含新增 search-alias 测试）+ `npm run frontend:build` + `npm run scan` 全绿；
6. 反向自检：删掉别名 JOIN → `gta6` 用例必须红。

## 8. 待确认

无（5 项口径已定）。
