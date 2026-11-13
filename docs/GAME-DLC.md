# 游戏详情·DLC 总数与列表（含价格/购买链接，不含拥有状态）（已实现并发布 v2.14.0）

> 状态：**已确认待开发（2026-11-13，所有者确认 5 组 / 8 项细节）；已实现并发布 v2.14.0（2026-11-13，98d75e9；QA ✅ 放行 docs/QA-GAME-DLC-BP.md）**。编号 **BP**（BP-1 ~ BP-4）。
> 关联：[STEAM-DLC.md](STEAM-DLC.md)（DLC 拥有数不可得的历史调查与下线决策）、
> [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md)（appdetails 顺带字段先例）、
> [IMAGE-COVERAGE.md](IMAGE-COVERAGE.md)（同一次 appdetails 顺带写字段）、
> [TODO.md](TODO.md) 的 BP 条目。

## 1. 现状与硬约束（2026-11-13 核对）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **Steam 公开 API 拿不到 DLC 拥有数据**：`GetOwnedGames` 只返回"游戏"条目，不含 DLC 记录 | [steam-login.js:221-238](gameprice/src/steam-login.js#L221-L238)；[STEAM-DLC.md](gameprice/docs/STEAM-DLC.md) §2.1；README「已知限制 11」 |
| 2 | 项目曾做过 DLC 统计（v1.7.0 后台「Steam 账号」DLC 列），恒为 0，v1.8.0 已下线 | [STEAM-DLC.md](gameprice/docs/STEAM-DLC.md) §3 方案 A；[QA-STEAM-DLC.md](gameprice/docs/QA-STEAM-DLC.md) |
| 3 | **DLC 总数拿得到**：`appdetails` 响应里有 `dlc: [appid…]`，但当前归一化没取这个字段 | [steam-meta.js:101-119](gameprice/src/adapters/steam-meta.js#L101-L119)（只有名称/描述/价格/分级等） |
| 4 | `steam-status`、`backfill` **本来就在逐条拉 appdetails** → 顺带存 `dlc[]` = 零额外请求 | [steam-status.js:116](gameprice/src/steam-status.js#L116)、[cli.js:1894-1901](gameprice/src/cli.js#L1894-L1901) |
| 5 | DLC 名称/价格可用 `IStoreBrowseService/GetItems` 批量取（100 个/请求，CN 区、CNY，含折扣与在售价） | [store-browse.js:12-20](gameprice/src/adapters/store-browse.js#L12-L20)、`:70-102` |
| 6 | 详情接口目前只返回 `game / offers / series`，没有任何 DLC 字段 | [server.js:1248-1250](gameprice/src/server.js#L1248-L1250) |
| 7 | 库里没有 DLC 相关列/表（`games` 无 `dlc`，`steam_games` 只有账号拥有游戏） | [steam-accounts.js:31-58](gameprice/src/steam-accounts.js#L31-L58) |

**结论**：
- ✅ 可做：**DLC 总数**（`appdetails.dlc[]` 长度）+ **DLC 列表**（名称/价格/折扣/购买链接）；
- ❌ 不可做：**该账号拥有哪些 DLC**（公开 API 限制；本批不显示、不用 0 冒充、不引入 Steam 登录态 cookie）。

## 2. 已确认的决策（2026-11-13 所有者，5 组 / 8 项）

| # | 决策 |
|---|---|
| 1 | **不做拥有状态**：详情只显示"DLC 共 N 个"+ 列表，并明确标注「Steam 公开 API 不提供 DLC 拥有数据」 |
| 2 | 口径 = `appdetails.dlc[]` **全部**（含原声带/美术集/未发售），不做分类、不单列"未发售" |
| 3 | **详情弹窗内直接展示 DLC 列表**（在详情内容最下方，分页 10）；每行带 `Steam ↗` 跳到 `https://store.steampowered.com/app/<appid>/`；**不另开抽屉** |
| 4 | DLC 总数入库**并入现有 `steam-status` / `backfill`**（同一次 appdetails 顺带写），**不新建定时任务** |
| 5 | 列表要**价格 + 折扣 + 购买链接**（`GetItems` 批量取，CN 区/CNY） |
| 6 | 明细补齐以定时为主（status 每轮收尾补一批）；打开详情、列表缺明细时允许**读路径回源一次**（≤3 批 GetItems、按游戏 10 分钟节流、失败降级） |
| 7 | 不引入新依赖；不给 DLC 做到价提醒/史低/愿望单 |
| 8 | 非 Steam 游戏（无 `steam_appid`）不显示 DLC 入口 |

## 3. 设计

### 3.1 数据模型（BP-1）

```sql
-- 游戏 → DLC appid 列表（appdetails.dlc[] 原样，去重后存 jsonb 数组）
alter table games add column if not exists dlc_appids jsonb;

-- 每个 DLC 的展示信息（名称/价格/折扣/在售），按 (game_id, appid) 一行
create table if not exists game_dlc (
  game_id      integer not null references games(id) on delete cascade,
  appid        integer not null,
  name         text,
  price_cents  integer,
  original_cents integer,
  discount_pct integer not null default 0,
  currency     text,
  in_stock     boolean not null default true,
  synced_at    timestamptz,
  primary key (game_id, appid)
);
create index if not exists idx_game_dlc_appid on game_dlc (appid);
```

- `dlc_appids` 写入：`normalizeOfficial`（[steam-meta.js:101](gameprice/src/adapters/steam-meta.js#L101)）增加 `dlcAppIds`
  —— 只保留正整数、去重、上限 2000；`upsertGameMeta` 仅在响应**带 `dlcAppIds`** 时写该列
  （GetItems 路径没有这个字段，不能把已有值清空）；
- 差集清理：`dlc_appids` 更新后，删掉 `game_dlc` 里不在新数组中的行（DLC 下架/改版也能收敛）；
- DLC 明细行由"占位 → 补齐"两步：先按 `dlc_appids` 建 `game_dlc(game_id, appid)` 行（name/price 为空），
  再由 GetItems 补名称/价格/折扣/币种/在售。

### 3.2 写入链路（BP-1，全部并入现有定时任务）

| 数据 | 时机 | 成本 |
|---|---|---|
| `dlc_appids` | `steam-status` 每轮逐 appdetails 后（[steam-status.js:116](gameprice/src/steam-status.js#L116)）；`backfill` 的 appdetails 回退路径同 | **零额外请求**（同一次响应） |
| DLC 明细（名称/价格） | ① `steam-status` 每轮收尾：取「`dlc_appids` 非空、`game_dlc` 缺 name/price」的游戏，最多 `STEAM_DLC_FILL_GAMES`（默认 50）个，`GetItems` 批量补（最多 `STEAM_DLC_FILL_BATCH`=30 批 ×100 条/轮）；② 抽屉打开时读路径回源（见 3.3） | ① 每轮 ≤30 次 GetItems ≈ 秒级；② 每游戏 ≤3 批、10 分钟节流 |

- **合并评估**（`gameprice-requirements` §4.1）：不新建任务——`dlc_appids` 与 appdetails 同响应必须合并；
  明细用 `GetItems`（与 `backfill` 同一接口），放在 `steam-status` 收尾做，量小且天然限速；
- 日志：`steam.status.dlc_written { appid, dlc }`、`steam.dlc.filled { games, dlcs, batches }`；
- 429：沿用 `http.js` 全局冷却；命中时本轮跳过明细补齐（下一轮继续），不影响 `dlc_appids` 写入。

### 3.3 接口（BP-2）

**① 详情接口** `GET /api/games/:appid`（现有）追加一个摘要字段：

```json
"dlc": { "total": 24, "synced": true, "filled": 20 }
```

- `total` = `dlc_appids` 长度（数组为空/未同步时 0）；`synced` = 是否拿到过 `dlc[]`；
  `filled` = `game_dlc` 里已有名称/价格的条数（前端可提示「明细同步中」）；
- 不在详情里返回列表（DLC 上千时会让详情变慢）。

**② DLC 列表** `GET /api/games/:appid/dlc?page=1&pageSize=10`（公开）：

```json
{
  "total": 24, "page": 1, "pageSize": 10, "synced": true,
  "items": [{
    "appid": 2364740, "name": "Anno 1800 - Seat of Power",
    "price_cents": 4800, "original_cents": 4800, "discount_pct": 0,
    "currency": "CNY", "in_stock": true,
    "buy_url": "https://store.steampowered.com/app/2364740/"
  }]
}
```

- 排序固定 `name asc nulls last, appid asc`（列表不做搜索/排序控件；DLC 数量大靠分页）；
  `pageSize` 默认 **10**、上限 50；`page` 非法回落 1；
- 名称缺失回退 `DLC #<appid>`、价格缺失显示「—」；`buy_url` 由 appid 构造，不落库；
- **读路径回源（决策 6）**：进入本接口时若 `game_dlc` 缺明细且该游戏上次回源 >10 分钟 →
  同步拉 `fetchStoreItems`（当前页需要的最多 3 批、超时 5s），补库后再查询；
  失败/429 不报错，返回已缓存数据 + `synced:false`（前端提示"部分 DLC 信息待同步"）；
- 非 Steam 游戏返回 `{ total: 0, synced: false, items: [] }`（详情页不显示 DLC 区块）。

### 3.4 前端（BP-3）

- **详情弹窗**（`frontend/src/pages/Home.vue`）在最下方（价格历史之后）新增 **DLC 区块**：
  - 标题行：`DLC（共 24 个）` + 右侧副文案 `Steam 不提供 DLC 拥有数据`；
  - 列表行（每行）：`名称`（点击与右侧 `Steam ↗` 同一个链接，新窗口打开 `https://store.steampowered.com/app/<appid>/`）、
    价格（含原价/折扣）、在售状态（缺货标灰「缺货」）；
  - 分页 **10 条/页**（复用 `PaginationBar`，`total = dlc.total`）；
  - 移动端卡片：名称（可点跳 Steam）+ 价格 + 折扣 + 在售状态；
  - 状态：`synced=false` 时整块不显示（或显示「DLC 数据待同步」且无列表）；`total=0` 显示「暂无 DLC」；
    请求失败显示「DLC 信息加载失败，稍后重试」（不阻塞详情其它内容）；
- 打开详情时若 `dlc.total > 0` → 自动拉第 1 页；翻页再请求；切区间/关弹窗不残留状态；
- 不新增组件文件（直接写在 `Home.vue` 的详情弹窗里）；外部链接统一 `rel="noopener noreferrer nofollow"`。

### 3.5 配置与成本（BP-1）

| env | 默认 | 说明 |
|---|---|---|
| `STEAM_DLC_FILL_GAMES` | 50 | `steam-status` 每轮最多补多少个游戏的 DLC 明细 |
| `STEAM_DLC_FILL_BATCH` | 30 | 每轮 `GetItems` 批数上限（100 条/批 → 3000 条/轮） |

- 不进设置页（部署期参数留 env，符合项目规则）；
- 单轮成本：≤30 次 GetItems（约 0.3–1s/次）≈ 10–30 秒，可忽略；
- 读路径回源：每游戏 ≤3 次 GetItems、10 分钟节流、失败降级；
- 全库 DLC 明细收敛：靠"用户打开详情回源（快）+ status 收尾补齐（慢）"两条腿，不追求一次性全量。

## 4. 验收

1. **数据提取**：构造含 `dlc: [11, 12, 12, 0, -3]` 的 appdetails → `games.dlc_appids = [11,12]`（去重/过滤）；
   上限 2000；GetItems 路径（无 `dlcAppIds`）不会清空已有值。
2. **明细**：`GetItems` 返回名称/价格/折扣/币种 → `game_dlc` upsert 正确（CN 区、CNY）；
   取不到的（锁区/下架）保留行、`name` 为空、`price_cents` 为空；`dlc_appids` 变化时差集删除。
3. **详情接口**：`dlc.total` = 数组长度、`synced`/`filled` 正确；无 Steam appid → `{ total:0, synced:false }`。
4. **列表接口**：分页 10（上限 50）、名称升序、`buy_url` 正确；非法 page 回落 1；非 Steam 游戏返回空集。
5. **回源**：缺明细首次打开详情 → 触发 ≤3 批 GetItems 并落库；10 分钟内再次打开不再请求；
   GetItems 失败/429 → 仍返回列表（名称回退 `DLC #appid`）且 `synced:false`，不 5xx。
6. **前端（详情内联列表）**：详情弹窗最下方出现 `DLC（共 N 个）` 区块；列表 10 条/页、翻页正常；
   每行可点击跳 `https://store.steampowered.com/app/<appid>/`（新窗口）；价格/折扣/缺货状态正确；
   明确显示「Steam 不提供 DLC 拥有数据」；移动端卡片；无 DLC 显示「暂无 DLC」；非 Steam 游戏无该区块；
   DLC 上千（Train Simulator）翻页正常、弹窗不卡。
7. **定时与日志**：`steam-status` 一轮后缺明细的游戏数下降；日志 `steam.status.dlc_written`、
   `steam.dlc.filled` 可查；**不新增调度任务**（`jobsFromEnv` 不变）。
8. **权限/隐私**：接口全部公开、游客可看；返回体不含账号/DLC 拥有信息、不含 token。
9. `npm test` 全绿（normalize 提取、DB upsert/差集、接口分页、前端静态断言）、
   `npm run frontend:build`、`npm run scan`。
10. **部署侧复核**：打开 Anno 1800 / HELLDIVERS™ 2 详情，滚到底看 DLC 列表与 Steam 跳转；翻页正常；
    Console 干净；24h 后 `game_dlc` 明细覆盖上升。

## 5. 实施顺序与依赖

| 子项 | 内容 | 依赖 |
|---|---|---|
| **BP-1** | 迁移 + `dlc_appids` 提取/写入 + `game_dlc` + GetItems 补齐 + status 收尾 + 差集清理 + env | 无 |
| **BP-2** | 详情 `dlc` 摘要 + `/api/games/:appid/dlc` 列表 + 读路径回源与节流 | **BP-1** |
| **BP-3** | 详情内联 DLC 列表（`Home.vue`，分页 10 + Steam 跳转）+ 移动端卡片 | **BP-2** |
| **BP-4** | 测试与文档（WEB 接口表、PROJECT-OVERVIEW、README 已知限制口径、CHANGELOG 随发版） | BP-1~3 |

## 6. 本批不做

1. **不展示 DLC 拥有状态**（所有者决策 A；Steam 公开 API 不提供，也不用 0 冒充）；
2. **不引入** Steam 登录态 cookie / 手动标记 / 第三方数据源；
3. 不新建定时任务（并入 `steam-status` / `backfill`）；
4. 不做 DLC 历史价格/史低/到价提醒/愿望单；
5. 不做 DLC 分类（原声带/美术集/玩法）与"未发售"单列（口径 = 商店页 `dlc[]` 全部）；
6. 不做杉果/GOG 等非 Steam 平台的 DLC；
7. 不做后台 DLC 管理页/统计；
8. **不做抽屉/独立 DLC 页面**（所有者 2026-11-13 追加：改为详情内联列表 + Steam 商店跳转）。

## 7. 待确认（有默认值，不阻塞）

1. DLC 明细**读路径回源**（默认 ≤3 批、10 分钟节流）是否接受；若要"纯定时、慢 1–30 天"可改；
2. `STEAM_DLC_FILL_GAMES=50` / `STEAM_DLC_FILL_BATCH=30` 的默认值是否合适；
3. 购买链接默认 `https://store.steampowered.com/app/<appid>/`（不带区服参数，Steam 会按访客区服跳转）是否可接受；
4. **列表位置与密度**：默认放在详情弹窗最下方（价格历史之后）、每页 10 条；若想更靠上/每页更少，改一处即可。
