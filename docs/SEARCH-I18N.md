# 搜索支持中英文（含平台中文别名）（待开发）

> 状态：**需求已确认（2026-11-06），待开发**。范围：A 别名搜索 + B 归一化 + D 放宽 `rename`；C 人工别名不做，拼音不做。
> 关联：[WEB.md](WEB.md)（前台搜索）、[STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md)（名字来源）、
> [TODO.md](TODO.md) 的 AD 条目。

## 1. 现象

所有者反馈：**前台用中文搜不到游戏**（例如搜「英雄连」找不到 `Company of Heroes 3`），英文名可以搜到。

截图佐证：卡片标题显示英文 `Company of Heroes 3`，说明库里的 `name` 就是英文。

## 2. 根因（代码事实）

### 2.1 搜索只匹配 `games.name` 与 `games.name_en`

`src/store/pg.js:1030-1033`、`src/server.js:1501-1502`：

```sql
($2 = '' or lower(coalesce(g.name,'')) like lower('%'||$2||'%')
        or lower(coalesce(g.name_en,'')) like lower('%'||$2||'%'))
```

**没有匹配 `game_aliases.platform_title`**——而杉果商品名通常是中文（如「英雄连3」），
也就是说：即使库里某处存在中文名，搜索也用不上。

### 2.2 `name` 是英文的原因

- `upsertGameMeta`（`pg.js:1895-1911`）只有在 appdetails 返回的 `excluded.name` **含中文**时才会把
  `name` 换成中文、把旧英文名挪进 `name_en`；
- 若 Steam 的 `l=schinese` 对该游戏返回的仍是英文名（不少欧美游戏没有官方中文名），`name` 就一直是英文；
- 此时中文社区习惯叫法（「英雄连3」）在库里**根本不存在**，任何搜索都补不出来。

### 2.3 不一致：`rename` 任务也只处理"没有英文名"的游戏

`cmdRename`（`cli.js:1926-1931`）的候选条件是：

```sql
and (g.name is null or g.name = ''
     or ((g.name_en is null or g.name_en = '') and g.name !~ '[一-龥]'))
```

`name_en` 一旦被填（哪怕与 `name` 相同），该游戏就**永远不会再被 rename 处理**——
所以"英文名游戏补中文名"这件事，现有任务覆盖不到。

## 3. 方案

### A. 搜索范围扩展（P0）

在现有条件上增加：

1. `game_aliases.platform_title`（杉果/GOG/Humble 的本地化标题）；
2. 可选：`steam_wishlist.name`、`steam_games.name`（账号库里同步下来的名字，含中文）。

实现用 `exists` 子查询，避免 JOIN 造成重复行：

```sql
and (… existing name/name_en …
     or exists (select 1 from game_aliases a
                 where a.game_id = g.id
                   and lower(a.platform_title) like lower('%'||$2||'%'))
    )
```

### B. 查询归一化（P0）

中文输入常见问题：空格、全角/半角、标点。搜索前把关键词与目标字段都做归一化：

```sql
-- 去掉空格与全角空格，统一小写
replace(replace(lower(coalesce(g.name,'')), ' ', ''), '　', '') like replace(lower($2), ' ', '')
```

- 前端输入框同时 `trim()`；
- 建议只对关键词做归一化、字段侧用 `replace(...)`，索引会失效，但当前 `like '%kw%'` 本来就不走索引（198k 行实测 114ms），可接受。

### C. 中文别名兜底（P1，解决"Steam 没有官方中文名"）

对于 Steam 侧没有中文名的游戏（如 `Company of Heroes 3`），提供两种来源：

1. **平台别名**：杉果/GOG 的中文名（若该游戏在这些平台有收录）——A 步已覆盖；
2. **人工中文别名**（可选）：`games.name_zh_alias text`，后台可编辑；搜索命中别名时展示中文名但保留英文原名。

> 不建议做拼音搜索：需要额外词库/扩展，收益与维护成本不匹配；先做 A/B/C。

### D. 结果排序（P2）

命中多个来源时优先级：`name`（精确前缀）> `name`（包含）> `name_en` > 别名。
当前是统一排序（折扣/价格），命中来源不参与排序；若"搜中文却排在后面"成为问题再加权重。

## 4. 影响面

| 文件 | 改动 |
|---|---|
| `src/store/pg.js` | `listGames` 搜索条件加 `game_aliases` 子查询 + 归一化；`listAdminGames` 同步 |
| `src/server.js` | `/api/games`、`/api/admin/games` 的搜索条件与 pg.js 保持一致（两处目前是重复 SQL，建议收敛到 store） |
| `src/cli.js` | `cmdRename` 候选条件放开：`name` 不含中文就尝试补中文（需评估请求量） |
| `frontend/src/pages/Home.vue` | 搜索输入 `trim()`；（可选）结果行显示"别名命中"提示 |
| `test/store-browse.test.js` | 新增：中文命中 `name`、中文命中别名、英文命中 `name_en`、空格/全角归一化 |

## 5. 验收

1. 搜「英雄连」能命中 `Company of Heroes 3`（通过别名或中文名）；
2. 搜「company of heroes」仍能命中（回归）；
3. 搜「英雄连 3」（带空格）与「英雄连3」结果一致；
4. 后台「游戏管理」搜索同样生效；
5. 搜索耗时不超过现状 2 倍（198k 行、当前约 114ms）；
6. `npm test` 全绿（`test/store-browse.test.js` 新增用例）、`npm run frontend:build`、`npm run scan`。

## 6. 待确认

| # | 问题 | 默认取向 |
|---|---|---|
已确认（2026-11-06）：

| # | 决策 |
|---|---|
| 1 | **放开 `rename`**：`name` 不含中文的游戏都尝试补中文名（一次性大量 Steam 请求，按 200 次/5 分钟排队，跑几天可接受） |
| 2 | **不做**人工中文别名字段（`name_zh_alias`） |
| 3 | **要**：搜索必须命中平台别名（`game_aliases.platform_title`） |
| 4 | 不做拼音搜索 |
