# 数据库遗留对象清理（待开发）

> 状态：**需求与方案已确认（2026-11-10）；已实现并发布 v2.10.1（2026-11-11，b46896e；QA ✅ 放行 docs/QA-BF-BG-2026-11-11.md）**。
> 生产库实测数据已取（2026-11-10）。部署侧清理 SQL 待服务器升级 v2.10.1 后由部署人员执行（§3）。
> 关联：[WISHLIST-SITE-ONLY.md](WISHLIST-SITE-ONLY.md) §4.4（推送 key 下线，本批 B 组依赖它发布）、
> [DELIVERY.md](DELIVERY.md)（部署流程）、[PROJECT-OVERVIEW.md](PROJECT-OVERVIEW.md)

## 1. 背景与实测（2026-11-10 生产库只读核对）

已下线/未落地功能在库里留下了对象；只改库不改代码会被代码 DDL 重建（`create table if not exists` /
`alter table ... add column if not exists`）或写回（`offers` INSERT 写 `risk_level`），所以必须**代码与库同步清理**。

| # | 对象 | 实测（生产库） | 判读 | 处理 |
|---|---|---|---|---|
| 1 | `steam_sessions` 表 | 1 行（FF 2026-11-02 旧登录会话） | Steam 登录已停用（身份走站点会话），表无读写 | **删表**（A 组） |
| 2 | `users.steam_id` 列 + `users_steam_uniq` 索引 | **0 行非空** | 旧 Steam 登录字段，恒 null | **删列 + 删索引**（A 组） |
| 3 | `offers.risk_level` 列 | **107,050 行全为 'A'** | 只写不读（唯一 INSERT 写入，无 SELECT） | **删列**，同步删 INSERT 字段（A 组） |
| 4 | ~~`steam_accounts.api_key_enc` 列~~ | 2 行（Happy / FF，user_id 1） | **保留**（2026-11-10 修订：改为账号同步用 key，见 [WISHLIST-SITE-ONLY.md](WISHLIST-SITE-ONLY.md) §4.4） | **不删** |
| 5 | `user_wishlist.steam_ids` 列 | **1 行非空** | BE 后停写；移除语义不再需要 | 置 `{}` 后**删列**（B 组，依赖 BE 发布） |
| 6 | `games.content_descriptors` / `games.age_ratings` | **6,222 / 26,016 非空** | 当前无读取路径，但数据是有价值的分级信息 | **保留**（不删） |
| 7 | `games.interested` / `games.owned` | 全默认（0 非默认） | SQL 仍做 fallback 读（coalesce） | **保留**（删列需先改查询，属后续优化） |
| 8 | `user_prefs.hide_uninterested` | 有行 | 旧字段，仍兼容老客户端读写 | **保留**（兼容） |

## 2. 已确认的决策（2026-11-10 所有者）

1. 可删对象：上表 **#1–#3、#5**；**#4 取消**（2026-11-10 修订：`api_key_enc` 改为账号同步用 key，见 WISHLIST-SITE-ONLY.md §4.4）；#6–#8 **保留**；
2. 代码与库同步改：删建表 DDL、删 `add column` DDL、删 `offers` INSERT 的 `risk_level` 字段；
3. 清理 SQL 放「部署侧」，幂等（`if exists`），在部署升级后执行；
4. 分两组交付：**A 组**（#1–#3）与 BE 无关、可立即做；**B 组**（#5）**依赖 BE（仅本站愿望单）发布**后再做（BE 删掉 `steam_ids` 唯一写入路径后列才可删）；
5. 不改任何业务语义（剩下的表/列全部为现行功能服务）。

## 3. 改动清单

### A 组（独立）

- `src/steam-login.js`：删除 `create table if not exists steam_sessions (...)` 及注释里"已停用"说明（改为不建表）；
- `src/store/pg.js`：删除 `alter table users add column if not exists steam_id`（pg.js:356）与 `alter table offers ...` 相关（无）；
- `src/steam-login.js:14`：删除 `create unique index ... users_steam_uniq`；
- `src/store/pg.js`（offers INSERT，:565-571 附近）：删除 `risk_level` 字段与其值（default 保留在 DDL 也无害，但列删后 DDL 里同步删）；
- 代码里若有 `users.steam_id` 读取（`pg.js:1702` 后台用户列表 SELECT）→ 删掉该列选择。

### B 组（依赖 BE）

- `src/steam-accounts.js:386-387,402`：`user_wishlist` 的 `steam_ids` 读写删除；DDL（`steam-login.js:63-71`）删列；
- `test`：`steam-accounts` / `wishlist` 相关测试断言同步（若引用 `steam_ids`）。
- **注意**：`steam_accounts.api_key_enc` **不删**（2026-11-10 修订：改为账号同步用 key）。

### 部署期 SQL（部署升级后执行；先只读核对再写）

```sql
-- 只读核对（全部应满足：sessions=0 或已清、steam_ids 已空、users.steam_id=0、risk_level 全 'A'；
--   api_key_enc 不再清理——改为账号同步用 key，数量供参考）
select count(*) as sessions_left from steam_sessions;
select count(*) filter (where api_key_enc is not null) as accounts_with_sync_key from steam_accounts;
select count(*) filter (where steam_ids is not null and array_length(steam_ids,1) > 0) as with_steam_ids from user_wishlist;
select count(*) filter (where steam_id is not null) as users_with_steam_id from users;
select risk_level, count(*) from offers group by 1;

-- 清理（幂等）
drop table if exists steam_sessions;                       -- A
drop index if exists users_steam_uniq;                     -- A
alter table users drop column if exists steam_id;          -- A
alter table offers drop column if exists risk_level;       -- A（需代码先删 INSERT 字段并发布）
update user_wishlist set steam_ids = '{}' where steam_ids is not null and array_length(steam_ids,1) > 0;  -- B
alter table user_wishlist drop column if exists steam_ids;                     -- B（BE 发布后）
```

## 4. 验收

1. 新库启动后**不再**出现 `steam_sessions` 表、`users.steam_id` 列/索引、`offers.risk_level` 列（A 组）；
2. BE 发布后启动，不再出现 `user_wishlist.steam_ids` 列（B 组）；`steam_accounts.api_key_enc` **保留**（账号同步用 key）；
3. 上述对象无任何代码引用（`grep` 验证）+ 业务功能回归：游戏目录/收藏/愿望单/后台列表/采集全部正常；
4. 部署期 SQL 幂等可重复执行；生产库执行后第 1 节只读 SQL 全部为 0/全默认；
5. `npm test` 全绿（主链）、`npm run frontend:build`（动过前端时）、`npm run scan`。

## 5. 实施顺序

1. **A 组**（先行）：删 DDL/索引/INSERT 字段 + 测试 → 提交；部署 SQL 随下一个版本执行；
2. **B 组**（等 BE 发布后）：删 DDL/读写 + 测试 → 提交；部署 SQL 随 BE 之后的版本执行。

## 6. 本批不做

- 删 `games.content_descriptors` / `age_ratings`（保留数据与列）；
- 删 `games.interested` / `games.owned`（fallback 逻辑仍依赖，另议收敛）；
- 删 `user_prefs.hide_uninterested`（兼容老客户端）；
- 动 `steam_wishlist` / `steam_games`（现行功能在用）。

## 7. 待确认

无（实测数据与处理口径已于 2026-11-10 确认）。
