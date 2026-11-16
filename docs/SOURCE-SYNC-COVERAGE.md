# 多源采集推进：ITAD / GOG / Humble 覆盖全目录 + 命中率 + 后台触发（待开发）

> 状态：**已实现待发版（2026-11-16，本地验证全绿，待质检）**。编号 **CC**。
> 关联：[DATA-SOURCES.md](DATA-SOURCES.md)（各源可达性与 ITAD Key）、[ADMIN-CONSOLE-IA.md](ADMIN-CONSOLE-IA.md)（同步与回填页）、
> [TODO.md](TODO.md) 的 CC 条目。

## 1. 现象与代码核对（2026-11-16）

**现象**：设置页已开启 Steam / 杉果 / ITAD / GOG / Humble（ITAD Key 已维护），但游戏目录里只有杉果和 Steam
的报价/同步痕迹；后台指标「已同步 60464 / 未探测 101595 / 待回填 133447」。

**核对结论：不是开关没生效，是 ITAD / GOG / Humble 的候选集永远只取"前 N 条"，没有游标/进度状态。**

| # | 证据 | 说明 |
|---|---|---|
| 1 | 调度任务存在：`itad`（默认 1440 分钟）、`gog`/`humble`（默认 720 分钟）、`sonkwo`（60 分钟） | `src/scheduler.js:134-160`；开关为真时会自动跑 |
| 2 | ITAD 候选：`select steam_appid, coalesce(nullif(name,''), name_en) ... order by id limit $1` | `src/cli.js:636-643`——**每次都是 id 最小的 50 条**，没有 offset/游标 |
| 3 | GOG/Humble 候选：`where steam_appid is not null and name_en is not null order by id limit $1` | `src/cli.js:821-829`——同上，永远前 50 条；`limit` 默认 50 |
| 4 | ITAD 搜索优先用**中文名**（`coalesce(nullif(name,''), name_en)`） | 中文标题在 ITAD 命中率低，命中后也不缓存 ITAD id，下次重新搜 |
| 5 | GOG 只接受**精确标题**（`pickExactMatch`）；Humble 按 slug 猜测商品页 | `src/adapters/gog.js:58-65`、`src/adapters/humble.js:33-90`——未命中只累加 `noMatch`，不落状态 |
| 6 | 杉果同步用的是 `data/skus.json`（人工维护的 SKU 列表），不是全目录 | `src/cli.js:604-625`——所以杉果只有"加过的 SKU"有报价 |
| 7 | Steam 价格有正经队列（热点优先 + 冷门按天刷新） | `src/cli.js:303-340`——所以 Steam 看起来"有同步" |
| 8 | 后台「同步与回填」只列/触发 5 个任务：steam-prices / catalog / backfill / rename / heat；`/api/admin/sync` 只接受 catalog / steam-prices / steamall | `AdminModules.vue:324`、`src/server.js` 的 `/api/admin/sync`——**ITAD/GOG/Humble/杉果无法从后台手动触发** |
| 9 | 调度器 spawn 子进程时会带 `process.env`（含 `settings.hydrateSettings` 水合后的 `ITAD_API_KEY`） | `src/scheduler.js:594-605`、`settings.js:820-830`——Key 配好后任务能读到 |

**结论**：ITAD/GOG/Humble 的定时任务其实在跑，但每次都处理同一批前 50 个游戏（且 ITAD 用中文名搜、GOG/Humble 命中率有限），
所以 20 万目录里只有最早的一小部分有这三家的报价；再叠加后台不能手动触发，看起来就像"只有杉果和 Steam 在同步"。

## 2. 目标

1. ITAD / GOG / Humble 能**推进覆盖整个目录**（分批、可续跑、有进度），而不是永远前 50；
2. 命中率可提升（ITAD 优先英文名、匹配后缓存外部 ID，GOG/Humble 复用商品 ID/slug）；
3. 后台「同步与回填」能**看到并手动触发**这四个源任务，能看到上次运行/匹配/剩余；
4. 全流程可观测（日志 + 后台进度），不新增定时任务（并入现有 `itad`/`gog`/`humble`/`sonkwo` 任务）。

## 3. 设计

### 3.1 数据模型：每游戏 × 每源的状态

```sql
create table if not exists game_source_sync (
  game_id        integer not null references games(id) on delete cascade,
  platform_code  text not null,                 -- itad / gog / humble / sonkwo
  status         text not null default 'pending', -- pending | matched | nomatch | failed
  external_id    text,                          -- ITAD id / GOG product id / Humble slug / 杉果 sku
  last_tried_at  timestamptz,
  last_ok_at     timestamptz,
  fail_count     integer not null default 0,
  last_error     text,
  primary key (game_id, platform_code)
);
create index if not exists idx_gss_pending on game_source_sync (platform_code, status, last_tried_at);
```

- 迁移时从现有 `offers` 回填 `matched`（`insert ... select game_id, platform_code, 'matched', ... on conflict do nothing`）；
- 老数据没有状态行 = `pending`（按"无行即待处理"处理，避免一次性写 20 万行）。

### 3.2 候选选择（每源独立）

每次运行按优先级取 `limit` 条（默认 50，设置项 `sources.<source>.limit`）：

1. **pending**（无状态行）优先，按热度/访问优先：`heat` 降序、近 90 天有 `page_views` 的优先、`id` 升序；
2. **nomatch** 重试：`last_tried_at < now() - interval '7 days'`；
3. **matched 刷新**：`last_ok_at < now() - interval '<源 interval>'`（复用现有间隔设置）；
4. 同一游戏同一源只处理一次；`failed` 按退避（`fail_count` 阶梯，最多 30 天）。

- 每轮结束后写日志 `sync.source_progress { platform, scanned, matched, nomatch, failed, remaining }`；
- 后台展示每个源的：上次运行时间、本次处理数、已匹配/待处理剩余。

### 3.3 各源适配

| 源 | 处理 | 命中率/复用 |
|---|---|---|
| **ITAD** | 只对 pending 游戏做 `searchGame`（优先 `name_en`，没有英文名再用中文名）；命中后把 ITAD id 写入 `external_id`，**后续刷新直接用 id 批量取价**（`fetchPrices` 一次多 id），不再重复搜索 | 匹配后 `status=matched`；`no_game_ids` 不再整轮跳过 |
| **GOG** | 搜索命中后写 `external_id`（GOG product id）；后续优先按 id 刷新（若 GOG 有按 id 的接口），否则按间隔重新搜索 | 精确标题匹配失败记 `nomatch`，7 天后重试 |
| **Humble** | 命中后写 `external_id`（slug）；后续直接按 slug 拉商品页 | slug 猜测失败记 `nomatch`，7 天后重试 |
| **杉果** | 保持 `data/skus.json` 驱动（不改成全目录） | 只补 `external_id = skuId`，状态同步 |

### 3.4 后台触发与展示

- `AdminModules.vue` 的 `TASK_ORDER` 增加 `itad`、`gog`、`humble`、`sonkwo`，任务表显示上次运行/结果；
- `/api/admin/sync` 的 `MODES` 增加这四个（或新增 `/api/admin/sync/source`），spawn `sync <mode> --limit <n>`；
  运行中返回 409（复用现有互斥）；「立即运行」使用默认 limit；
- 系统设置 → 数据源与采集：每个源增加「每次处理条数」设置（默认 50）。

### 3.5 覆盖面与时间预期（写清，避免误解）

- 全目录 20 万 × 每轮 50 条 → 单靠 720 分钟一轮，**覆盖全量要几年**；因此：
  - 默认优先**热点/访问过的游戏**（先让用户看得到的游戏有 GOG/Humble/ITAD 报价）；
  - 冷门游戏按 7 天重试/刷新；
  - 需要更快时把 `sources.<source>.limit` 调大（例如 500/轮）并接受更长的单轮时间（GOG/Humble 每条约 1.2–1.5s）；
- 本批不承诺"一次跑完全部 20 万"，而是让覆盖**单调推进且可见**。

## 4. 验收

1. **连续两次运行处理不同游戏**：第二次 `scanned` 的游戏与第一次不重叠（或至少 `tried` 总数单调递增、`remaining` 递减）；
2. **状态落库**：`game_source_sync` 有 matched/nomatch/failed 行；已存在 offers 的源回填为 matched；
3. **ITAD**：优先英文名搜索；匹配后 `external_id` 为 ITAD id，第二次直接批量取价、不再 search（日志无重复 search）；
4. **GOG/Humble**：命中保存 id/slug，二次刷新走 id/slug；未命中 7 天内不重复（有重试窗口）；
5. **后台**：同步与回填页能看到 4 个源任务、可「立即运行」；运行中 409；显示上次运行与匹配/剩余；
6. **日志**：`sync.source_progress`、`sync.done` 带 scanned/matched/nomatch/remaining；`npm test` 全绿；
7. **不新增定时任务**（复用现有 itad/gog/humble/sonkwo 任务与 `jobsFromEnv`）；
8. **部署侧**：连续观察两次调度后，后台「未探测」下降、GOG/Humble/ITAD 报价开始出现（热点游戏优先）。

## 5. 本批不做

1. 不改 Steam/杉果现有队列与节奏（Steam 热点/冷门逻辑已有；杉果仍按 SKU 文件）；
2. 不新增数据源、不引入代理池；
3. 不做一次性全量回填（20 万条会打爆限额，按 3.5 的推进策略）；
4. 不改 ITAD 条款相关行为（来源标注、联盟参数保持现状）。

## 6. 待确认（有默认值，不阻塞）

1. 每源每轮条数默认 50，是否要按源区分（ITAD 搜索 1s/次，建议 50；GOG/Humble 1.2–1.5s/次，建议 30–50）；
2. 优先权重：`heat` + 近 90 天访问 + 愿望单/感兴趣标记，默认按此排序；
3. GOG 是否有按 product id 刷新的稳定接口（若无则匹配后按间隔重新搜索）；
4. 是否需要把「每源剩余/覆盖进度」加到后台指标卡（默认任务表里显示）。
