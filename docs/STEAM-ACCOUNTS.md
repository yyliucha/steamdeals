# Steam 多账号绑定与「已拥有 / 愿望单」同步（规格，已实现）

> 状态：**v1.5.0 已发布；§16「手动愿望单 + Steam 推送」已实现并发布（v1.6.0，2026-11-02）**。本文档是实现的唯一依据，改动前先读完全文。
> 实现落点：`src/steam-accounts.js`（同步/对账/认领/解绑）、`src/steam-login.js`（schema、OpenID state、
> `fetchWishlist`）、`src/store/pg.js`（推导 SQL）、`src/server.js`（API 路由）、`src/cli.js`
> （`steam-accounts` / `steam-claim`）、`src/scheduler.js`（`steam-accounts` 每日任务 + `steam-claim`
> 可选任务）、`frontend/src/pages/Home.vue`（愿望单标签页与徽标）、`frontend/src/pages/AdminExtras.vue`
> （账号列表页）。测试：`test/steam-accounts.test.js` + `test/scheduler.test.js` 新增断言。
> 相关文档：[DELIVERY.md](DELIVERY.md)（流程）、[TODO.md](TODO.md)（排期）、[ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 1. 目标

1. 一个**站点用户**可以绑定多个 Steam 账号（上限 5 个），每个 Steam 账号只能属于一个站点用户。
2. Steam 库同步后，前台「已拥有」按**当前登录用户**推导：手动标记 ∪ 其所有绑定账号库的并集。
3. 前台显示"哪个 Steam 账号拥有"：`已拥有 · FF、XX`（>2 个显示 `+N`，详情页列全）。
4. Steam 愿望单同步到前台，**新增独立「愿望单」标签页**；愿望单游戏**自动加入到价提醒**。
5. 可见性：**只有当前登录用户能看到自己的「已拥有 / 愿望单」**；游客与其它用户看不到。

## 2. 现状（改动前的事实）

| 项 | 现状 |
|---|---|
| Steam 登录 | 与站点用户体系**独立**；cookie `steam_session` 单 token → 一个浏览器只能挂 1 个 Steam 账号 |
| `steam_accounts` | `steam_id`(PK)、`persona_name`、`avatar`、`last_login_at`（**无 user_id**） |
| `steam_games` | `steam_id + appid` + 时长；upsert，**从不删除**已退库条目 |
| 库同步 | 只写 `steam_games`，**不标记已拥有** |
| 前台「已拥有」 | `games.owned`（**全局**，游客可见）+ `user_game_flags.owned`（站点用户手动） |
| 前台标签页 | 全部 / 感兴趣 / 不感兴趣 / 已拥有（**无愿望单**） |

## 3. 目标模型

```
站点用户 users 1 ── N steam_accounts（user_id，上限 5，steam_id 全局唯一归属）
                         │
                         ├── steam_games    该账号拥有的 appid
                         └── steam_wishlist 该账号愿望单的 appid

前台「已拥有」= user_game_flags.owned = true          （手动加）
              ∪（未被 owned=false 永久排除 且 appid ∈ 该用户所有账号的 steam_games）
前台「愿望单」= appid ∈ 该用户所有账号的 steam_wishlist
```

**归属主体已确认**：必须是站点用户（系统本来就要求先注册/由管理员建号再登录 Steam）——
Steam 登录动作即"绑定到当前站点用户"，不需要额外的强制绑定流程，但**必须已登录站点账号**。

## 4. 数据模型（DDL）

```sql
-- Steam 账号归属站点用户；一个 Steam 账号只能属于一个用户（换绑需先解绑）
alter table steam_accounts add column if not exists user_id bigint references users(id) on delete cascade;
alter table steam_accounts add column if not exists alias text;   -- 后台可起别名，前台优先显示别名
create index if not exists steam_accounts_user on steam_accounts (user_id);

-- 愿望单（需要 STEAM_API_KEY；账号"游戏详情/愿望单"必须公开）
create table if not exists steam_wishlist (
  steam_id  text not null,
  appid     integer not null,
  name      text,
  synced_at timestamptz not null default now(),
  primary key (steam_id, appid)
);
create index if not exists steam_wishlist_appid on steam_wishlist (appid);

-- 到价提醒来源标记：愿望单自动创建的提醒可随解绑/移出愿望单清理
alter table watchlist add column if not exists source text not null default 'manual'; -- manual | steam_wishlist

-- 查询性能：按 appid 反查哪些账号拥有
create index if not exists steam_games_appid on steam_games (appid);
```

**语义（沿用现有列，不新增表）**：`user_game_flags.owned`

| 值 | 含义 |
|---|---|
| `true` | 手动标记已拥有（即便 Steam 库里没有也显示已拥有） |
| `false` | **永久排除**：Steam 库里有也不显示已拥有；下次同步不恢复（用户可在前台恢复为 null） |
| `null`（无行） | 跟随推导（Steam 库 ∪ 手动） |

**`games.owned`（全局）废弃**：前台不再读取；不迁移历史值（如需保留，一次性写入每个用户的
`user_game_flags.owned=true` 由用户自行决定，默认不迁移）。

**`steam_sessions` 停用**：绑定关系落在 `steam_accounts.user_id`，身份由站点会话决定；
旧 cookie `steam_session` 直接失效（保留表不再写入，后续版本可删）。

## 5. 推导规则（SQL 语义）

按当前站点用户 `$uid` 计算单款游戏：

```sql
-- 是否已拥有
effective_owned =
     exists (select 1 from user_game_flags f
              where f.user_id = $uid and f.game_id = g.id and f.owned = true)
  or (not exists (select 1 from user_game_flags f2
                   where f2.user_id = $uid and f2.game_id = g.id and f2.owned = false)
      and exists (select 1 from steam_games sg
                   join steam_accounts sa on sa.steam_id = sg.steam_id
                  where sa.user_id = $uid and sg.appid = g.steam_appid))

-- 谁拥有（列表里聚合，最多取前 3 个 + 总数）
owned_by = (select json_agg(json_build_object(
                 'steamId', sa.steam_id,
                 'name', coalesce(sa.alias, sa.persona_name, sa.steam_id)) order by sa.steam_id)
              from steam_games sg join steam_accounts sa on sa.steam_id = sg.steam_id
             where sa.user_id = $uid and sg.appid = g.steam_appid)

-- 愿望单
wishlisted = exists (select 1 from steam_wishlist sw
                      join steam_accounts sa on sa.steam_id = sw.steam_id
                     where sa.user_id = $uid and sw.appid = g.steam_appid)
```

## 6. 可见性与权限

| 主体 | 已拥有 | 愿望单 | 谁拥有 |
|---|---|---|---|
| 游客 | 不显示 | 不显示 | — |
| 登录用户 | 自己账号推导 ∪ 手动 | 自己账号 | 自己的账号名 |
| 管理员 | 同上（不去看别人的绑定数据） | 同上 | 同上 |

- 前台筛选 `owned=only / exclude`、`wishlist=true` 都按当前登录用户计算；未登录时这些筛选无效（返回全量）。
- `owned_by` 只在**当前用户**范围内可见；接口不回传其它用户的绑定关系。

## 7. 绑定 / 解绑流程

**前置**：用户必须先登录站点账号（现有系统本来就要求注册或管理员建号）。

1. 前台/后台点「绑定 Steam 账号」→ `GET /api/auth/steam/start`
2. 生成一次性 `state`（随机串 + 绑定到当前站点用户会话，5 分钟过期）→ 作为 `openid.return_to` 的查询参数
3. Steam 回调 `/api/auth/steam/callback`：
   - 校验 `state`（防 CSRF / 防串号）
   - `verifyCallback` 取 steamId
   - 若 `steam_accounts.steam_id` 已存在且 `user_id` 不同 → 409「该 Steam 账号已被其他用户绑定」
   - 若已存在且属于当前用户 → 幂等（只更新昵称/头像）
   - 若当前用户已绑定 ≥ 5 个 → 409「最多绑定 5 个 Steam 账号」
   - 落库 `user_id`，**自动同步库 + 愿望单**，302 回 `/console?section=steam`（或前台 `/#steam`）
4. 解绑 `DELETE /api/steam/accounts/:steamId`：删 `steam_accounts` 行（级联删 steam_games/wishlist），
   清理该账号 `source='steam_wishlist'` 的自动提醒；手动标记与排除记录保留。

> 说明：不要求用户"先绑定才能登录"这种额外流程——只要站点账号存在，登录 Steam 的动作本身就是绑定。

## 8. 同步策略

| 触发 | 范围 |
|---|---|
| 绑定成功 | 该账号：库 + 愿望单（各 1 次请求） |
| 后台「同步游戏库」/「同步愿望单」 | 该账号 |
| 调度器每日任务 `steam-accounts` | 所有已绑定账号，逐个串行（间隔 ≥ 1s） |

- API：`IPlayerService/GetOwnedGames`（`include_appinfo=1&include_played_free_games=1`）、
  `IWishlistService/GetWishlist`（都需要 `STEAM_API_KEY`；愿望单还要求账号公开）。
- **必须做差集删除**（现存 bug：只 upsert 不删，账号移出库后"已拥有"永远不消失）：

```sql
-- 单账号同步完成后（appids = 本次拉到的集合）
delete from steam_games   where steam_id = $1 and appid <> all($2::int[]);
delete from steam_wishlist where steam_id = $1 and appid <> all($2::int[]);
```

- 配额：GetOwnedGames/GetWishlist 属 Key 配额（10 万/天），几十个账号绰绰有余。
- 失败隔离：单个账号失败只记日志继续下一个；连续失败触发调度器熔断（已有机制）。
- **DLC 统计与类型补全**：`GetOwnedGames` 不带游戏类型字段，账号库的 DLC 数按目录
  `games.app_type` 统计。库同步后自动补全类型——只挑 `app_type IS NULL` 的已拥有 appid
  走 `IStoreBrowseService/GetItems`（一次 100 个），补全后天然收敛（下次同步近乎零请求）；
  失败只记日志（`steam.app_types_failed`）。后台「Steam 账号」页展示 DLC 数与类型未知数
  （`*` 提示可再同步补全）。

## 9. 愿望单 → 到价提醒

- 愿望单同步后，对每个愿望单 appid：
  1. 找到 `games.steam_appid = appid` 的行（目录 19.7 万，绝大多数能命中；命中不了就跳过并计数）
  2. 写 `watchlist(game_id, region='cn', target_cents=null, note='Steam 愿望单', source='steam_wishlist')`
  3. `(game_id, region)` 已存在则**不覆盖**用户手动设过的目标价（手动优先）
- 移出愿望单 / 解绑账号：只删 `source='steam_wishlist'` 且**没有其它账号仍在愿望单里**的提醒
- 手动删除的自动提醒：记录 `user_game_flags`？不需要——直接删 watchlist 行即可；下次同步会重新创建，
  若用户不想收到提醒，用「不感兴趣」或新建 `watchlist_optout` 记录（本期不做，列为已知限制）

## 10. 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/steam/accounts` | 当前用户已绑定账号列表（id/昵称/别名/头像/游戏数/愿望单数/最近同步） |
| GET | `/api/auth/steam/start` | 开始绑定（带 state，要求站点已登录） |
| GET | `/api/auth/steam/callback` | OpenID 回调：校验 state → 绑定 → 自动同步 |
| DELETE | `/api/steam/accounts/:steamId` | 解绑（级联清理） |
| POST | `/api/steam/accounts/:steamId/library/sync` | 同步该账号游戏库（差集删除） |
| POST | `/api/steam/accounts/:steamId/wishlist/sync` | 同步该账号愿望单（差集删除 + 自动提醒） |
| PATCH | `/api/steam/accounts/:steamId` | 改别名 |
| GET | `/api/steam/me` | 兼容：返回当前用户绑定的账号数组（旧的单账号字段保留一版兼容） |
| — | `/api/games/search` / 详情 | 返回新增 `owned_by`、`wishlisted`；`owned` 改为按当前用户推导 |
| — | 前台筛选 | 新增 `wishlist=true`；`owned=only/exclude` 按当前用户 |

## 11. 前端改动

**后台「Steam 账号」页**（`AdminExtras.vue`，section=steam）

- 单账号卡片 → 账号列表：头像 / 昵称（别名优先）/ SteamID / 游戏数 / 愿望单数 / 最近同步 / 操作
  （同步库、同步愿望单、改别名、解绑）
- 顶部「绑定新账号」按钮（已达 5 个时禁用并提示）
- 空状态：提示"先绑定一个 Steam 账号"；有历史未归属账号时显示「认领」（迁移用，见 §12）

**前台**（`Home.vue`）

- 新增「愿望单」标签页（`wishlist=true`）
- 游戏卡：`已拥有 · FF、XX` 徽标（>2 个 `+N`）；`愿望单` 徽标
- 详情弹窗：已拥有账号完整列表（悬停显示 SteamID）
- 游客：不显示已拥有/愿望单标记；筛选里隐藏这两个维度

## 12. 迁移方案

1. `steam_accounts.user_id` 允许为空（`alter … add column if not exists`，幂等）。存量账号认领已实现三条等价路径：
   后台「Steam 账号」页的「认领到当前管理员」按钮 / CLI `node src/cli.js steam-claim <用户名> <steamId>` /
   调度器任务（compose 配置 `STEAM_CLAIM_USERNAME` + `STEAM_CLAIM_STEAM_ID` 后自动跑，幂等秒退，认领后可删配置）。
2. `games.owned` 全局值不迁移（详见 §4）。
3. `steam_session` cookie 失效不影响登录（身份改由站点会话决定；`steam_sessions` 表保留但不再写入）。
4. 首次上线后调度器的 `steam-accounts` 每日任务（或后台手动点「同步游戏库」）会把存量 `steam_games` 补齐差集删除。

## 13. 索引与性能

- `steam_accounts(user_id)`、`steam_games(appid)`、`steam_wishlist(appid)` 必建。
- 单个用户的库通常 500–5000 条，`exists` 子查询走上述索引，19.7 万目录分页查询不应明显变慢；
  上线前用生产 `EXPLAIN ANALYZE` 验证 `owned=only` 的耗时（阈值：单查询 >150ms 再优化，考虑物化 `user_owned_appids`）。

## 14. 验收标准

1. 用户 A 绑定 2 个 Steam 账号（一个有 CS2、一个有 L4D2）→ 前台两个游戏都显示"已拥有"，并分别标注账号名。
2. 用户 B 登录 → 看不到 A 的任何已拥有/愿望单标记；游客同样看不到。
3. 账号把某游戏移出库后再同步 → 该游戏不再显示"已拥有"（差集删除生效）。
4. 手动取消"已拥有"（Steam 库里有）→ 标记消失；再次同步**不恢复**；点"恢复"可回到跟随推导。
5. 愿望单同步后：前台「愿望单」标签有数据；对应游戏自动出现在 `watchlist`（`source='steam_wishlist'`，
   目标价为空=史低提醒）；移出愿望单后自动提醒被清理，手动机提醒不受影响。
6. 绑定第 6 个账号 → 409 提示；绑定已被他人占用的 Steam 账号 → 409。
7. 全部改动 `npm test` 全绿 + `npm run frontend:build` 通过；不自行构建（硬规则 5）。

## 15. 明确不做 / 已知限制

- 不支持同一个 Steam 账号被多个站点用户共用（已确认）。
- 愿望单→提醒不做"用户级静默开关"（本期）；不想收到提醒可标记「不感兴趣」（现有机制）。
- 不做"好友/家庭共享库"（Steam Families）识别。
- 不展示其它用户的绑定信息（管理员也没有跨用户查看入口，本期）。

## 16. 手动愿望单与 Steam 推送（需求 2026-11-02，已实现并发布 v1.6.0）

**需求**：前台点「愿望单」除加入本站外，一并写进所选 Steam 账号的愿望单；多账号时弹窗让用户选择。

**约束（已查证）**：Steam 写愿望单只有两条路——
① 官方 `IWishlistService/AddToWishlist`（未文档化，[xPaw](https://steamapi.xpaw.me/IWishlistService#AddToWishlist)），
写操作需要**该账号自己注册的 Web API Key**；② `store.steampowered.com/api/addtowishlist` 需要账号登录后的
`sessionid` cookie，OpenID 绑定拿不到。因此采用方案①：每个绑定账号在后台「Steam 账号 → API Key」配置自己的 key。

**实现**：

- `steam_accounts.api_key_enc`（AES-256-GCM 加密，明文只进不出）；后台账号页可配/清 Key，列表显示状态。
- 新表 `user_wishlist(user_id, game_id, steam_ids[], created_at)`：手动愿望单落库，
  `steam_ids` 记用户选择推送的账号（移除时按此回推删除）。
- 前台推导：愿望单 = 手动（user_wishlist）∪ Steam 同步（steam_wishlist）；手动添加同样自动加入价提醒
  （`watchlist.source='user_wishlist'`，目标价空=史低；手动设过目标价的不随移除清理）。
- API：`POST /api/wishlist`（body: appid|gameId + steamIds[]，只接受本人账号）→ 站点落库 + 逐账号推送，
  成功乐观写 `steam_wishlist`（Steam 若实际未接受，每日同步差集删除兜底）；`DELETE /api/wishlist/:appid`
  （或 `/id/:gameId`）→ 清站点行 + 回推 `RemoveFromWishlist`（添加时选过的账号 ∪ 持有该条目的账号，
  只处理配了 key 的）+ 对账自动提醒。
- 前端：游戏卡/详情「愿望单」按钮；多账号弹窗多选（无 Key 的账号禁用并提示，可「仅加入本站」）；
  单账号直接推送；无绑定账号只落本站。
- 推送解析防御式：HTTP 2xx 且响应无显式 `success:false` 即成功；失败带原因记
  `adapter.steam.wishlist_add_failed / wishlist_remove_failed`。

**已知限制**：AddToWishlist 属未文档化接口，真实行为需**服务器上线后验证**（本机无 Steam 出口）；
未配 Key 的账号只能同步不能推送/回推，靠每日同步对账收敛。
