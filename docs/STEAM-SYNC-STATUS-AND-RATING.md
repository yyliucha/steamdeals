# Steam 同步状态与内容分级标注

> 状态：**已实现（2026-11-04），待发版**——代码与测试已完成（新增 `test/steam-status.test.js` 6 项入主链），
> 未打 tag、未触发构建（硬规则 5）。
> 关联：[ROADMAP.md](ROADMAP.md)（原有的「地区限制与 18+ 内容」议题，本文件是它的落地方案）、
> [DATA-SOURCES.md](DATA-SOURCES.md)（数据源可达性）、[WEB.md](WEB.md)（后台模块）、[TODO.md](TODO.md)。
>
> 起因：后台「游戏管理 → 游戏目录」显示 **92,580 条待同步**。所有者提出：能否拿到未同步原因；锁国区要标注；
> 18+ 内容要标注，展示口径结合中国法律整理。

## 1. 实测结论（2026-11-04，生产库只读 + 20 条真实探针）

### 1.1 9.2 万的构成

| 指标 | 数值 | 占比 |
|---|---|---|
| 待同步总数 | 92,580 | 100% |
| 从未回填（`backfill_at is null`） | 242 | 0.26% |
| 回填过 | 92,338 | 99.7% |
| **免费游戏**（`is_free`） | **23,185** | **25.0%** |
| 缺简介 | 11,878 | 12.8% |
| **缺 Steam 报价** | **92,152** | **99.5%** |
| 非游戏条目（`app_type <> 'game'`） | 1 | ≈0% |
| `app_type` 为 null（接口未返回） | 11,268 | 12.2% |

### 1.2 20 条随机探针（`cc=cn` 与 `cc=hk` 各一次）

| 组合 | 条数 | 判定 |
|---|---|---|
| `cn=coming_soon` / `hk=coming_soon` | 14 | **未发售** |
| `cn=success:false` / `hk` 有价格 | 3 | **锁国区**（HKD 3900 / 7800 / 700） |
| `cn=success:false` / `hk=free` | 2 | **锁国区**（港区免费） |
| `cn=success:false` / `hk=coming_soon` | 1 | 国区下架/未上架 |
| **`cn` 有价格** | **0** | **回填管道没有漏数据** |

**结论**：92,580 不是"同步失败"，而是三类客观事实混在一个计数里——免费（永远无价）、未发售（还不是商品）、
锁区（国区不可售）。**「待同步」这个指标本身需要重定义**，否则永远不会归零。

### 1.3 现状代码（为什么会这样）

| 位置 | 现状 |
|---|---|
| `src/adapters/steam.js:44`/`:50` | 已区分 `not_found_or_region_locked` / `free` / `no_price_overview` 三种原因，但只放进 `skipped` 数组 |
| `src/cli.js:278`、`:334` | 这些原因被汇总成 `skipped: N` 一个数字，**没有落库** |
| `src/adapters/steam-meta.js:179` | 元数据请求是**全量** appdetails（`?appids=X&cc=cn&l=schinese`，无 `filters`），响应里本来就有 `required_age`、`content_descriptors`、`ratings`、`release_date.coming_soon` |
| `src/adapters/steam-meta.js:85-115` | `normalizeOfficial` **只解析**名字/简介/封面/日期/开发商/类型/价格，**分级字段全部丢弃** |
| `src/store/pg.js` games 表 | 无任何同步状态、锁区、分级字段（只有 `blocked`/`deleted` 人工语义） |
| `src/server.js:1458` | 「待同步」= 缺简介 **或** 缺 Steam 报价——因此免费/未发售永远待同步 |

## 2. 目标

1. **状态可解释**：每条游戏能回答"为什么没有价格"，后台可按状态筛选，统计卡不再是一个笼统的 9.2 万。
2. **锁区可标注**：国区不可售但港区可售的，标「锁国区」。
3. **分级可标注**：成人/成熟内容标注，并按站点策略决定前台是否展示。
4. **一次请求拿全**：状态判定与分级采集合并（同一次 appdetails 响应里都有），不额外消耗配额。

## 3. 数据模型（`games` 新增列，全部可空、幂等迁移）

| 列 | 类型 | 含义 |
|---|---|---|
| `steam_status` | text | `ok` / `free` / `coming_soon` / `region_locked` / `no_price` / `not_found` / `pending`（未探测） |
| `steam_checked_at` | timestamptz | 最近一次状态判定时间（续跑游标） |
| `required_age` | integer | Steam 年龄门槛（0/3/7/12/16/18） |
| `content_descriptors` | integer[] | Steam 内容描述符 id 列表（见 §5） |
| `age_ratings` | jsonb | 原始分级（ESRB/PEGI/USK…：`{ "esrb": "AO", "pegi": "18" }`） |
| `adult_flag` | boolean not null default false | 派生：是否成人内容（见 §5 规则） |
| `mature_flag` | boolean not null default false | 派生：是否成熟内容 |

迁移按现有风格追加到 `src/store/pg.js` 的 `alter table games add column if not exists ...` 列表；
另加索引 `create index if not exists games_steam_status on games (steam_status) where steam_status is not null`。

## 4. 状态判定规则

以 **`cc=cn` 的一次请求**为主，只有 `success:false` 时才补一次 `cc=hk`：

| 条件（按顺序） | `steam_status` | 后台标注 | 计入「待同步」 |
|---|---|---|---|
| `success:false` 且 `hk` 有价格或免费 | `region_locked` | **锁国区**（港区可售） | 否 |
| `success:false` 且 `hk=coming_soon` | `not_found` | 国区不可售 | 否 |
| `success:true` 且 `is_free` | `free` | **免费** | 否 |
| `success:true` 且无 `price_overview` 且 `coming_soon` | `coming_soon` | **尚未发售** | 否 |
| `success:true` 且无 `price_overview` 且非免费非未发售 | `no_price` | 国区无定价 | 否 |
| `success:true` 且有 `price_overview` | `ok` | 正常 | 否（已同步） |
| 从未探测 | `pending`（null） | 未探测 | 是 |

> 「待同步」重定义：`steam_status is null`（从未探测）**或** `ok` 但缺简介。已判定为
> `free`/`coming_soon`/`region_locked`/`no_price`/`not_found` 的都不再计入——这正是 9.2 万归零的关键。

## 5. 内容分级与展示策略

### 5.1 平台事实（不做法定判断）

| 字段 | 取值 |
|---|---|
| `content_descriptors.ids` | 1 部分裸露/性内容；2 频繁暴力或血腥；**3 成人限定性内容**；**4 频繁裸露或性内容**；5 一般成熟内容 |
| `required_age` | Steam 年龄门槛 |
| `ratings` | ESRB（AO / M / T / E）、PEGI（18 / 16 / 12 / 7 / 3）、USK、ACB 等 |

派生规则（可在设置里调整阈值，默认如下）：

```
adult_flag  = content_descriptors 含 3 或 4，或 ESRB = AO
mature_flag = 非 adult 且（content_descriptors 含 2 或 5，或 PEGI >= 18，或 required_age >= 18）
```

### 5.2 展示策略（站点策略，**不是法律结论**）

> 中国境内对淫秽色情内容禁止传播；暴力、赌博等实行内容审核与分级管理。**代码只做"平台标签 → 站点展示策略"的映射，
> 不对任何具体游戏作法律定性**；最终口径由所有者（必要时咨询法务）拍板，本表给的是可配置的默认值。

| 分类 | 判定 | 前台默认 | 后台 |
|---|---|---|---|
| 成人内容 | `adult_flag` | **不展示**（`site.adultDisplay='hide'`，可改为 `badge`/`show`） | **始终正常显示**，标「成人」红标 |
| 成熟内容 | `mature_flag` | 展示 + 角标「内容分级」 | 标「成熟」 |
| 锁国区 | `steam_status='region_locked'` | **展示**，标「国区不可售」，不显示国区购买按钮 | 标「锁国区」 |
| 尚未发售 | `steam_status='coming_soon'` | 展示，标「尚未发售」，不显示价格 | 标「未发售」 |

**为什么做成配置**：成人内容在部分国家/地区是合法商品，站点策略不应硬编码。当前只有站点级开关
（`site.adultDisplay`：`hide` 默认 / `badge` 只加角标 / `show` 正常展示）；等将来做多区服展示
（[ROADMAP.md](ROADMAP.md) 的区服维度）时，可把策略下沉为**按区服/按国家**配置，本批不预留复杂结构。

## 6. 采集任务（一次请求拿全）

新增后台任务 `steam-status`（并入 `src/scheduler.js` 的 `jobsFromEnv`，硬规则 3）：

| 项 | 设计 |
|---|---|
| 选取 | `steam_appid is not null and not deleted and (steam_checked_at is null or steam_checked_at < now() - interval '30 day')`，且 `steam_status is distinct from 'free'`（免费无需再探） |
| 请求 | 每 appid 一次 `appdetails?appids=X&cc=cn&l=schinese`；仅 `success:false` 时补一次 `cc=hk` |
| 写入 | `steam_status` + `steam_checked_at` + `required_age` + `content_descriptors` + `age_ratings` + `adult_flag`/`mature_flag` |
| 限速 | 沿用 200 次/5 分钟配额，`STEAM_STATUS_RATE_MS` 默认 1500ms，每批 30 |
| 时长 | 待探测 ≈ 92,580 − 23,185（免费已知）≈ **69,395 次**；锁区补港区约 +30% ≈ 21,000 次；合计 ≈ **9 万次 ≈ 37 小时**（2400 次/小时），可中断续跑 |
| 互斥 | 与 `heat` / `backfill` / `catalog` / 价格同步共用 Steam 配额，走现有后台任务槽位互斥 |
| 幂等 | 重复跑只更新状态与分级，不产生报价；不写 `offers` |

> `free` 无需请求：`is_free` 已在库中；首次迁移时直接批量写入 `steam_status='free'`（2.3 万条，一条 SQL）。

## 7. 接口与前端

| 位置 | 改动 |
|---|---|
| `GET /api/games` | 返回体带 `steam_status` / `adult_flag` / `mature_flag` / `required_age`；支持 `adult=hide\|show` 临时覆盖站点设置（默认取 `site.adultDisplay`） |
| `GET /api/admin/games` | 支持按 `steam_status` 筛选；排序键加 `steam_checked_at` |
| 后台「游戏目录」 | 指标卡由「待同步」改为 **「已同步 / 未探测 / 免费 / 未发售 / 锁国区 / 国区无价 / 其他」** 分项；状态列加徽标；新增「内容分级」列 |
| 前台卡片/详情 | 成人内容按策略隐藏；成熟内容角标；锁国区/未发售标注且不出价格 |
| 系统设置 | 新增 `site.adultDisplay`（enum：`hide` 默认 / `badge` / `show`）、`steamStatus.rateMs`、`steamStatus.intervalMin`；走 `src/settings.js` 的 `def()`。锁国区只标注、不做隐藏开关 |

## 8. 影响面

| 文件 | 改动 |
|---|---|
| `src/store/pg.js` | games 加列 + 索引；`bulkSetFreeStatus`；状态写回函数；后台筛选 SQL |
| `src/adapters/steam.js` / `steam-meta.js` | 解析 `required_age`/`content_descriptors`/`ratings`/`coming_soon`；状态判定纯函数 |
| `src/cli.js` | 新增 `steam-status` 命令（调试/回填入口），带 `--limit --batch --rate` |
| `src/scheduler.js` | 新增定时任务，默认每周、首轮延迟较长，避开热度播种期 |
| `src/server.js` | `/api/games` 与 `/api/admin/games` 字段与筛选 |
| `frontend/src/pages/Home.vue`、`AdminModules.vue` | 指标卡、状态列、分级列、前台角标与隐藏策略 |
| `docs/PROJECT-OVERVIEW.md`、`docs/WEB.md`、`docs/ROADMAP.md`、`README.md`、`CHANGELOG.md` | 状态与对外描述同步 |

## 9. 验收

1. 迁移后 `games` 五列存在且幂等；2.3 万免费游戏一次性写成 `steam_status='free'`（不消耗请求）。
2. 后台指标卡分项正确，**分项之和 = 19.8 万**；「待同步」只统计 `steam_status is null` 或 `ok 但缺简介`。
3. 抽样 20 条锁区游戏：后台显示「锁国区」，前台显示「国区不可售」且无国区价格。
4. 抽样 20 条未发售：显示「尚未发售」，不再计入待同步。
5. 成人内容：`adult_flag=true` 的游戏在 `site.adultDisplay='hide'`（默认）时前台不可见、后台始终可见并带红标；改成 `badge` 后前台可见但带角标；改成 `show` 后正常展示——三档都要验证。
6. `required_age`/`content_descriptors`/`age_ratings` 有值率抽样 ≥ 90%（以能取到 appdetails 的游戏为分母）。
7. 任务可中断续跑：`steam_checked_at` 正确推进，重复跑不产生重复请求风暴。
8. 通用验证：`npm test` 全绿（新增 `test/steam-status.test.js` 进主链）、`npm run frontend:build`、`npm run scan`；不自行打 tag。

## 10. 实施顺序

1. 迁移加列 + 免费批量置位 + 状态判定纯函数 + 单测（不发请求，先让口径正确）；
2. 指标卡与后台筛选改成新口径（此时 9.2 万会立刻拆成 2.3 万免费 + 其余"未探测"）；
3. `appdetails` 解析分级字段 + 单元测试（用现有 fixture 扩展）；
4. `steam-status` 任务 + CLI + 调度器 + 限速；
5. 前台展示策略与设置项；
6. 小批量（先 2,000 条）验证真实分布，再放开全量，避免 37 小时任务白跑；
7. 文档同步。

## 11. 已确认的决策（2026-11-04，所有者拍板）

| # | 决策 |
|---|---|
| 1 | **成人内容前台不显示、后台正常显示**，并做成配置：`site.adultDisplay` = `hide`（默认）/ `badge` / `show`。理由：部分国家成人内容是合法商品，策略不应硬编码 |
| 2 | **18+ 口径**：`content_descriptors` 含 3 或 4，或 ESRB = AO → `adult_flag`；`required_age>=18` / PEGI 18 / descriptors 2、5 → `mature_flag`（仅角标） |
| 3 | **锁国区不隐藏**：前台照常展示，只标「国区不可售」且不出国区价格；港区价格若已采集则照常展示 |

无遗留待确认项。
