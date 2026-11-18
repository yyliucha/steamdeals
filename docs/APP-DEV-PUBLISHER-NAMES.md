# 开发商/发行商名称脏数据修复（CR 批）（待开发）

> 状态：**待确认（2026-11-17，所有者截图反馈）**。
> 关联：[TODO.md](TODO.md) CR 条目、[APP-PARITY.md](APP-PARITY.md)（CM-1 App 侧展示兜底）、
> [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md)（元数据同步口径）。

## 1. 现象（所有者 2026-11-17 截图，Android App 详情页）

「黎明杀机（Dead by Daylight，appid 381210）」详情页开发商/发行商显示原始 JSON：

```
开发商  {"name":"Behaviour Interactive Inc.","creator_clan_account_id":33367148}
发行商  {"name":"Behaviour Interactive Inc.","creator_clan_account_id":33367148}
```

期望：`开发商 Behaviour Interactive Inc.`（纯名称）。

## 2. 现状取证（代码证据）

| 环节 | 证据 | 结论 |
|---|---|---|
| 数据源（GetItems 批量商店接口） | `src/adapters/store-browse.js:90-91`：`developers: Array.isArray(basic.developers) ? basic.developers : null` —— **原样透传**；GetItems 的 `basic_info.developers` 是**对象数组** `[{name, creator_clan_account_id}]` | ❌ 未归一化 |
| 另一数据源（appdetails） | `src/adapters/steam-meta.js:111-112`：`data.developers ?? null` —— appdetails 的该字段是**字符串数组** `["Behaviour Interactive Inc."]` | ✅ 本身干净 |
| 再一数据源（steamcmd PICS） | `src/adapters/steam-meta.js:153-163`：按 `associations[].name` 提取字符串 | ✅ 本身干净 |
| 写库 | `src/store/pg.js:3331/3372`（`writeGames` 写 `developers text[]`）：node-pg 对对象元素自动 `JSON.stringify` → 库里元素变成 `{"name":…,"creator_clan_account_id":…}` 字符串 | ❌ 脏数据落库 |
| 站点 API | `g.developers` 原样返回（`gameDetail`/搜索 SELECT） | 把脏字符串暴露给所有客户端 |
| 站点 Web 详情 | `frontend/src/pages/Home.vue` **没有**开发商/发行商渲染 | App 是唯一显示面 |
| App 展示 | `steamdeals-app` `NameListSerializer`（CM-1，e183584 / App 2.20.0）已兼容「对象数组 / JSON 对象文本」并取 `name` | App 2.20.0+ 已兜住；截图是旧版客户端仍在直接显示原文 |

**根因**：唯一未归一化的入口是 GetItems（`mapStoreItem`）；脏元素随 `writeGames` 落库后长期存在（`coalesce(excluded.developers, games.developers)` 也不会把它洗掉）。

## 3. 修复范围（建议）

| # | 项 | 说明 |
|---|---|---|
| CR-1 | **写入归一化（根因）** | `mapStoreItem` 对 `developers`/`publishers` 做与 `genres` 同款归一化：元素为字符串→去首尾空白后保留；元素为对象→取 `name`；过滤空值；去重保序；上限 20。`normalizeOfficial`/`normalizeSteamcmd` 口径不变 |
| CR-2 | **历史脏数据清洗（幂等）** | 迁移内一次性清洗：元素含 `"name":` 特征的用**纯正则提取**名称（v2.24.2 起，不再 `::jsonb` 解析——生产存在 `{CRYTIME}` 等占位符非 JSON 元素，cast 会 22P02 崩 bootstrap），再按 CR-1 口径去空/去重/保序；无脏元素时不更新（二次执行无副作用）。清洗范围 `games.developers`/`games.publishers` |
| CR-3 | **接口契约** | `/api/games/:appid`、`/api/games/by-id/:id`、`/api/app/games`（列表/详情）返回的 `developers`/`publishers` 保证为**字符串数组或 null**，不含 `{` |
| CR-4 | **测试进主链** | 新增 `test/dev-publisher-names.test.js`：① `mapStoreItem` 对象数组→名称数组（含 creator_clan_account_id 夹具）；② 字符串数组/脏 JSON 文本/混合/空值/超 20 去重；③ `writeGames` 写库读回为纯字符串；④ 迁移清洗：造脏行→`migrate`→干净且幂等；⑤ 详情接口真跑断言无 `{` |

**不在本批**：① App 侧代码（CM-1 已修，2.20.0 起生效）；② Web 详情新增开发商/发行商展示（当前无此 UI，如需展示另立条目，页面类需先出 demo）。

## 4. 澄清清单（所有者确认）

1. **Web 详情是否顺带展示开发商/发行商？** 现状 Web 完全不展示（截图仅 App）。建议：本批只修数据与契约，不做 Web UI；确需展示则另立条目（附 demo）。
2. **清洗方式**：建议迁移内嵌幂等 SQL（随部署自动生效，无需人工跑命令）；备选 CLI `admin fix-names`（可手动重跑 + 记日志）。是否采用迁移内嵌？
3. **归一化细节**：去首尾空白、去空、去重保序、**上限 20 条**、单条超长截断 200 字符——按此执行？
4. **App 侧**：本批不动 App 仓库（CM-1 已兜底），确认？
5. **验收数据**：部署后跑一次统计（下方 §6）确认脏行归零；是否要求同时抽查 3 款已知脏数据游戏？

## 5. 验收

1. `mapStoreItem({ basic_info: { developers: [{name:'X', creator_clan_account_id:1}] } })` → `developers: ['X']`；混合数组/空值/重复按口径处理（主链测试）。
2. `writeGames` 写对象数组成员 → 库里读回纯字符串（PG 测试）。
3. 造脏行（元素为 `{"name":"Y"}` 文本）→ 跑 `migrate()` → 归为 `['Y']`；再跑一次无变化（幂等，主链测试）。
4. `GET /api/games/381210` 与 `/api/app/games` 的 `developers`/`publishers` 不含 `{`（真跑断言）。
5. `npm test` / `frontend:build` / `scan` 全绿；`migrate()` 连跑两次不报错。
6. 部署后 App 旧版（< 2.20.0）**不再显示 JSON**（数据已干净）；新版显示一致（人工确认 1 款）。

## 6. 部署后统计命令（只读）

```sql
select count(*) as dirty_rows from games
 where (developers is not null and exists (select 1 from unnest(developers) e where e ~ '"name"\s*:'))
    or (publishers is not null and exists (select 1 from unnest(publishers) e where e ~ '"name"\s*:'));
-- 期望 0；清洗前可用于度量影响面。
-- 注（v2.24.2）：以 `{` 开头但无 `"name":` 特征的占位符元素（{CRYTIME} 等）按设计保留、不计脏；
-- 生产实测 `"name":` 元素已 0、占位符仅 4 个（2026-11-18 取证）。
```

## 7. 影响面与风险

- 数据：仅 `developers`/`publishers` 两列元素形态；不删不改名称本身。
- 兼容：App 2.20.0 的 `NameListSerializer` 对纯字符串数组原样返回（无损）；Web 无展示。
- 回滚：清洗为幂等 UPDATE，无 schema 变更；回滚只需重新入库（无副作用）。

## 8. 实施顺序

1. CR-1 归一化（`src/adapters/store-browse.js` + 共享 helper 与 `normalizeOfficial`/`normalizeSteamcmd` 复用）；
2. CR-2 迁移清洗（`src/store/pg.js` ALTERS 末尾，幂等 SQL）；
3. CR-4 测试（`test/dev-publisher-names.test.js` 进主链）；
4. 文档回写（PROJECT-OVERVIEW / 本文件状态 / TODO / INDEX）。
