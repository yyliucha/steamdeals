# 杉果 SKU ↔ Steam 对齐：自动匹配 + 后台审核 + 调度化（待开发）

> 状态：**已确认待开发（2026-11-16，所有者反馈"杉果命名和 Steam 不一样，能否按规律关联"）**。编号 **CD**。
> **2026-11-16 补充**：核对后 **ITAD 与杉果一样没有 Steam appid**，本批一并覆盖；GOG/Humble 报价本身已带 Steam appid（不需要匹配），
> 它们的覆盖/命中问题归 **CC**。详见 §8。
> 关联：[ARCHITECTURE.md](ARCHITECTURE.md) §10（match.js 设计）、`src/match.js`、`src/cli.js` 的 `match` 命令、
> [TODO.md](TODO.md) 的 CD 条目。

## 1. 现状（2026-11-16）

后台游戏目录里有一批"平台=杉果、Steam 价=—、同步状态=未探测、缺简介"的行（截图：消逝的光芒系列、塔拉萨号、
造物主2：侏罗纪、内核之心、军火大学模拟器、血色之月…）——它们是**没有 `steam_appid` 的孤立游戏行**，
和 Steam 的同名游戏没有关联。

**代码事实**：

| # | 事实 | 证据 |
|---|---|---|
| 1 | 杉果商品页**确实没有 Steam appid**（`steam_appid`/`appid`/`steampowered.com/app/` 都不存在），跨平台对齐只能靠名称 | `src/adapters/sonkwo.js:190`（`steamAppid: null` 注释）、`ARCHITECTURE.md` §10 |
| 2 | 项目已有匹配器：字符 bigram Dice + 版本词剥离（决定版/豪华版/Definitive/Ultimate/标准版…），≥0.94 自动、0.86–0.94 人工确认 | `src/match.js`（`normalizeName`/`scorePair`/`confidenceLabel`） |
| 3 | 已有命令：`match` 出提案；`match --apply` 自动写映射；`match --confirm <skuId> <appid>` 人工确认；映射写 `data/skus.json` 并合并孤立行 | `src/cli.js:976-1070`、`applySkuMapping`（`:953-975`） |
| 4 | 匹配只用了 **`skus.json` 里的中文名**；杉果页其实还带**英文名**（`sku_ename`，已入库到 `games.name_en`），但没参与打分 | `parseSkuPage`（`meta.nameEn`）；`cmdMatch` 只读 `entry.name` |
| 5 | `match` **不在调度器里**（`jobsFromEnv` 无 match 任务），所以新 SKU 不会自动对齐，只能人工跑 | `src/scheduler.js` 任务清单 |
| 6 | 0.86–0.94 的候选只能在 CLI 里看，后台没有审核入口 | `AdminModules.vue` 无匹配面板 |
| 7 | 映射写 `data/skus.json`，该目录是 compose 卷 `appdata:/app/data`，重启/重新部署不丢 | `compose.yaml:32-33` |

**实测分数（2026-11-16，本地 `scorePair`）**：

| 杉果标题 | 候选 | 分数 | 处置 |
|---|---|---|---|
| Dying Light: The Beast Deluxe Edition | Dying Light: The Beast | **1.00** | 自动 |
| Dying Light: The Beast **RL** Definitive Edition | Dying Light: The Beast | 0.944 | 自动（刚好过线） |
| 消逝的光芒：困兽 决定版 | 消逝的光芒：困兽 | **1.00** | 自动 |
| 塔拉萨号 | Thalassa: Edge of the Abyss | **0.00** | ❌ 中文↔英文 0 分 |
| 造物主2：侏罗纪 | Reus 2: Jurassic | **0.00** | ❌ 同上 |

→ 中文↔中文、英文↔英文都能匹配；**中文↔英文必然 0 分**。塔拉萨号这类"杉果中文名 ≠ Steam 中文名"的条目，
必须靠**杉果页自带的英文名**去匹配 Steam 的 `name_en`（当前 `match` 没用这个信号）。

## 2. 现在可以怎么做（运维步骤，不改代码）

`match` 读写的是**容器内** `data/skus.json`（compose 卷 `appdata:/app/data`，重启/重新部署不丢）。
建议**分批**执行，不要一次对全部 SKU 跑 `--apply`——它会合并孤立游戏行（删除源行、迁移报价/快照），
属于不可自动回滚的写操作。

```bash
# 0) 备份映射文件（持久卷内，带时间戳）
docker exec steamdeals sh -c 'cp /app/data/skus.json /app/data/skus.json.bak-$(date +%Y%m%d-%H%M%S) && ls -l /app/data/skus.json*'

# 1) 先看提案（只读；会加载全部带 appid 的 Steam 游戏，几秒到几十秒）
docker exec steamdeals node src/cli.js match --limit 50

# 2) 小批量自动应用 ≥0.94 的映射（写 skus.json + 合并无 appid 的孤立行）
docker exec steamdeals node src/cli.js match --apply --limit 50

# 3) 回后台「游戏管理」抽查这 50 条：Steam 价 / 同步状态 / 平台是否变化；无误后继续下一批
docker exec steamdeals node src/cli.js match --apply --limit 200

# 4) 0.86–0.94 的逐条人工确认（skuId 与 appid 从提案列表里取）
docker exec steamdeals node src/cli.js match --confirm <skuId> <steamAppId>
```

- `--apply` 只应用「自动」（≥0.94）；0.86–0.94 只能逐条 `--confirm`；`--limit` 默认 200（只影响本轮处理的未映射 SKU 数）；
- 映射写入后**不需要手动 `sync sonkwo`**：`sonkwo` 定时任务（默认 60 分钟）下次运行会读 `skus.json` 的新 `appid`，
  把报价挂到 Steam 游戏；想立刻生效可手动跑，但默认会处理整个文件（每 SKU 约 1.2s），耗时长；
- **回滚**：`skus.json` 可用备份覆盖（`cp /app/data/skus.json.bak-... /app/data/skus.json`），
  但**已合并的孤立行不会自动还原**——所以先 50 条、后台抽查、再继续；
- 若 `match` 跑完仍有大量"无候选"，说明中文名与 Steam 中文名不一致，等 CD 的英文名匹配上线。

## 3. 目标（CD 批）

1. 新 SKU 能**自动/半自动**对齐到 Steam，不需要每次人工跑 CLI；
2. 英文名参与匹配（杉果 `name_en` ↔ Steam `name_en`），解决中文↔英文 0 分；
3. 0.86–0.94 有**后台审核队列**（确认/忽略），不靠看终端；
4. 全量匹配不再每次加载 20 万候选做 O(n²) 扫描；
5. 对齐后自动合并孤立行、刷新杉果报价，`未探测` 可见下降。

## 4. 设计

### 4.1 调度（不新增独立任务）

- 在现有 `sonkwo` 任务收尾追加一步 `match`（增量：只处理 `skus.json` 里 `appid=null` 的条目，单轮 `limit` 默认 100）；
  或调度器新增 `match` 任务（每 6 小时），**优先合并进 sonkwo 任务**（`gameprice-requirements` §4.1）；
- 失败不影响 sonkwo 价格采集；日志 `match.proposals` / `match.applied` 已有，补 `match.summary`。

### 4.2 匹配算法增强

1. **输入变体**：杉果标题的中文名（`skus.json.name`）+ 英文名（从该 SKU 的孤儿游戏行 `games.name_en` 取，没有则由 `parseSkuPage` 写入）；
2. **候选变体**：Steam 游戏的 `name`（中文）+ `name_en`；
3. 对每个组合 `scorePair` 取最高分，记录 `matchedField`（`name`/`name_en`）与 `method`（`name`/`name_en`/`edition`）；
4. **快路径**：归一化后完全相等 → 1.0 直接自动；
5. 阈值保持 0.94 / 0.86；`name_en` 匹配命中时同样按分数分级；
6. **性能**：一次加载 `games(name,name_en,steam_appid)`，构建 `normalized → candidates` Map；先 exact 查，再对未命中做限长（如每 SKU 最多 500 个同首字母候选）Dice；200k 行内存可控；
7. **版本词**：沿用 `normalizeName` 的版本词表；对"RL"等特殊后缀追加规则（去掉 `RL`/`Retail`）；版次 SKU 记录 `edition=true`。

### 4.3 版次策略（待确认，先按默认）

- 默认：`XX 决定版/豪华版/终极版` 映射到**基础游戏 appid**，`game_aliases` 记 `method='edition'`；
- 风险：杉果"决定版"价格与 Steam"基础版"价格不可严格比较；若价格对比要严格，改为"版次 SKU 只进审核、不自动映射"；
- 页面展示沿用现有口径（同游戏多平台报价并排），不新增"版次不同"提示（待确认）。

### 4.4 后台审核面板（队列 + 去重 + 合并预览）

> 2026-11-16 所有者确认：审核页并入 CD；**批量确认先不做**；**同游戏必须去重，一条处理整组**，不允许"处理完一条又冒出同名另一条"。
> **2026-11-17 已发布 v2.21.0（e5fced8）**：`game_source_map` 落库 + `src/align.js` 去重组/决定继承 + 后台「对齐审核」页 + sonkwo 收尾 match + ITAD 跳转反解。

- 位置：游戏管理 → 新 tab「对齐审核」；
- **队列一行 = 一个去重组**，稳定键 = `platform + normalizeName(杉果名)`：
  - 同一游戏的多条 SKU（不同版次/不同 skuId/重复采集）归到同一组，组内显示 SKU 数；
  - 候选按 appid 去重，组内只展示最高分候选 + 可展开其它候选；
  - 组内合计报价数/快照数；队列计数按**组**，不按 SKU（避免"30 条其实只有 5 个游戏"）；
- 状态：`pending_review`（0.86–0.94）/ `no_candidate`（<0.86）/ `blocked_edition`（版次/DLC/数字冲突）/ `confirmed` / `ignored`；
- 动作：
  - **确认**：先弹合并预览（源孤立行 → 目标 Steam 游戏：迁移报价/快照/alias/关注标记；明确"源行删除、重复报价丢弃、不可自动撤销"），确认后**对该组所有 SKU 一起执行**；
  - **换候选**：在组内候选里换目标；**手动搜索**：按名称/AppID 搜 Steam 游戏，指定目标；
  - **忽略**：按**组**记 `ignored`；同组新 SKU 自动继承忽略，不再排队；
  - **重新生成候选**：手动触发，不自动；
- **去重与决定继承（必须实现）**：
  1. 生成提案时按稳定键分组，同组只出一条；
  2. 已 `confirmed` 的组，后续同组 SKU **自动应用同一 appid**，不再重复排队；
  3. 已 `ignored` 的组，后续同组 SKU 自动忽略；
  4. 同一目标 appid 在一组内只出现一次；同名重复游戏行在预览里聚焦唯一目标；
  5. 连续两次运行队列**组数不增长**（除新游戏），不出现"处理完又重复"；
- 权限：仅管理员；写操作审计 `match.confirmed` / `match.ignored`（记 by、组键、目标 appid、该组 SKU 列表）。

### 4.5 映射与合并（落库，不写文件）

- **映射落库**：新表 `game_source_map`（`platform_code + product_id` 唯一，字段：`game_id`、`match_method`、`confidence`、`decision(confirmed/ignored)`、`reviewed_by`、`reviewed_at`）；
- `sync sonkwo` / 后续 ITAD 同步**优先读 DB 映射**，回落 `data/skus.json` 的 `appid`（兼容旧数据）；迁移时把 `skus.json` 现有 appid 灌入表中；
- 合并沿用 `mergeGames`：只合并"无 appid 的孤立行"；有 appid 的冲突行记 `match.skip_merge` 交人工；快照随 `offer_id` 迁移；
- 合并后 `sync sonkwo` 让报价挂到 Steam 游戏；`steam-status`/`backfill` 自然补齐 Steam 信息（零额外任务）；
- 删除/忽略的组不再恢复；如需恢复走"重新生成候选"。

## 5. 验收

1. **算法**：`塔拉萨号` 这类中文↔英文无交集的 SKU，用杉果英文名匹配到 Steam `name_en` 后分数 ≥0.86/0.94；
   Dying Light 系列（Deluxe/Definitive）按 1.00/0.944 自动；
2. **调度**：`sonkwo` 任务收尾自动跑匹配（或独立 match 任务），日志有 `match.summary`；不新增 cron 任务；
3. **后台**：审核面板能看到待确认列表并一键确认/忽略；确认后该游戏显示 Steam appid、孤立行被合并；
4. **数据**：`sync sonkwo` 后杉果报价挂在 Steam 游戏上；`ingest.summary.noAppId` 下降；后台「未探测」下降；
5. **性能**：单轮 `limit=100` 的匹配在可接受时间内完成（目标 < 30s），不阻塞调度；
6. **安全/正确性**：不会把两个不同游戏合并（抽查 Dying Light 系列、塔拉萨号、造物主2）；冲突/低分交人工；
7. **测试**：`match` 单元测试（中↔中、英↔英、中↔英经英文名、版次剥离、阈值分级）、后台接口测试、`npm test` 全绿。
8. **去重与决定继承**：同归一化名的多个 SKU 只出现一行（组）；确认/忽略一次处理整组；再次运行不重复排队；
   已确认组的新 SKU 自动继承映射、已忽略组的新 SKU 自动忽略；队列计数按组。
9. **收敛**：连续两次运行，`pending_review + no_candidate` 组数不增长（除新游戏）；不出现"处理完这条又冒出同名另一条"。

## 6. 本批不做

1. 不引入翻译服务/LLM/第三方匹配 API；
2. 不做全量一次性合并（按批 + 审核）；
3. 不改 Steam/ITAD/GOG/Humble 的采集逻辑；
4. 不做跨语言自动翻译标题（英文名来自杉果页面，不额外生成）。

## 7. 待确认（有默认值，不阻塞）

> 2026-11-16 所有者已确认：**审核页并入 CD**、**去重分组 + 决定继承**、**映射落 `game_source_map` 表**、**批量确认先不做**。

1. 版次 SKU 默认自动映射基础版（保留此默认；若要严格价格可比，改为只进审核）；
2. 审核页位置默认「游戏管理 → 对齐审核」新 tab；
3. 自动/人工阈值沿用 0.94 / 0.86；
4. 匹配调度默认并入 `sonkwo` 任务收尾（不新增 cron）。

## 8. 补充：ITAD 也需要对齐（2026-11-16 复核）

**逐平台现状**：

| 平台 | 是否带 Steam appid | 结论 |
|---|---|---|
| **Steam** | ✅ 基准（`games.steam_appid`） | 不需要匹配 |
| **GOG** | ✅ `syncByTitle` 遍历的是 Steam 游戏，`offer.steamAppid = g.steam_appid`（`cli.js:821+`） | 不需要匹配；覆盖/命中率归 **CC** |
| **Humble** | ✅ 同上（`steamAppid` 注入） | 不需要匹配；覆盖/命中率归 **CC** |
| **杉果** | ❌ 页面无 appid（`sonkwo.js:190`） | 本批 §2–§7（名称/英文名匹配） |
| **ITAD** | ❌ `normalizeDeals` 固定 `steamAppid: null`（`itad.js:100`），deal 按商店拆成 steam/gog/humble/其它平台 | **本批也要覆盖**（见下） |

**ITAD 的对齐规则（比名称匹配更准，优先）**：

1. ITAD `deals[]` 里 **Steam 店的 `deal.url`** 形如 `https://store.steampowered.com/app/<appid>/...`；
2. 从该 URL 反解 `<appid>`，把**同一 ITAD game 的所有商店 deal**（Steam/GOG/Humble/其它）都挂到这个 Steam 游戏行；
   Steam 是主键，其它店报价作为该游戏的渠道报价（与 GOG/Humble 现有行为一致）；
3. 若该 ITAD game **没有 Steam deal**（非 Steam 游戏）：走名称匹配（英文名 vs `name_en`，版本词剥离），
   或保留 `itad_<shop_id>` 平台行，不强行挂；
4. **先验证再实现**：`sync itad --limit 3` 后看 `itad.prices` 原始响应里 `deal.url` 是否为直链；
   若实际是 ITAD 跳转链接（`isthereanydeal.com/...`），改用 ITAD game id 别名 + 名称匹配兜底；
5. 需要防误挂：反解出的 appid 必须存在于本站 `games.steam_appid`，且同一 ITAD game 只认一个 appid。

**统一对齐层（CD 内合并，不另开批）**：

- `game_aliases` 统一记录 `platform_code / platform_product_id / game_id / match_method / confidence`；
  `match_method` 取值：`appid_url`（ITAD URL 反解）、`name_en`、`name_zh`、`edition`；
- `match` 命令扩展为"**孤儿游戏扫描**"：不只读 `skus.json`，也扫 `games where steam_appid is null` 的行
  （来源可能是 sonkwo 或 ITAD），逐条找 Steam appid；
- 调度仍并入现有 `sonkwo` / `itad` 任务收尾（不新增 cron），CC 的候选推进负责"覆盖到更多游戏"，CD 负责"挂到正确游戏"。

**验收补充**：

1. ITAD 的 Steam deal URL 能反解 appid；同一 ITAD game 的其它商店 deal 挂到同一游戏行；
2. 无 Steam deal 的 ITAD 游戏走名称匹配或保留独立平台行，不误挂；
3. `sync itad --limit 3` 的日志能证明 URL 形态（直链/跳转），以此决定实现分支；
4. 后台「未探测」中杉果/ITAD 产生的孤立行数量下降，且抽查不出现错误关联。

**验证 `deal.url` 形态（只读，不写库）**：在容器里跑下面的探针（不改仓库代码）：

```bash
docker exec -i steamdeals node --input-type=module <<'EOF'
import { openStore } from '/app/src/store/index.js';
import * as settings from '/app/src/settings.js';
import { searchGame, fetchPrices } from '/app/src/adapters/itad.js';

const store = await openStore(process.env.DATABASE_URL, {});
await settings.hydrateSettings({ store });
const key = process.env.ITAD_API_KEY;
if (!key) { console.log('ITAD_API_KEY 未配置（设置页保存后调度器约 15 秒水合）'); process.exit(0); }

for (const title of ['Dying Light: The Beast', 'HELLDIVERS 2', 'Cyberpunk 2077']) {
  const hits = await searchGame(title, { apiKey: key });
  const game = hits?.[0];
  if (!game) { console.log(`${title}: 无搜索结果`); continue; }
  const prices = await fetchPrices([game.id], { apiKey: key });
  const row = prices.find((p) => p?.id === game.id) ?? prices?.[0];
  const deals = row?.deals ?? [];
  console.log(`\n# ${title} → ITAD ${game.id} ${game.title}，deals=${deals.length}`);
  for (const d of deals) {
    const m = String(d?.url ?? '').match(/steampowered\.com\/app\/(\d+)/i);
    console.log(`  shop=${d?.shop?.name} url=${d?.url ?? '—'}${m ? ` → appid=${m[1]}` : ''}`);
  }
}
await store.close();
EOF
```

判读：

- Steam 店的 `url` 形如 `https://store.steampowered.com/app/<id>/...` → **CD 的 URL 反解方案成立**；
- 若是 `https://isthereanydeal.com/...` 或带 `redirect` 的跳转 → 反解不可用，改用「ITAD 英文名 ↔ Steam `name_en`」名称匹配兜底；
- 某个游戏没有 Steam deal 时换另一个 Steam 游戏再试（至少验证 2 个）。
## 9. ⚠️ 2026-11-16 实测事故：匹配器误匹配（暂停使用）

> 状态：**CE（匹配器加固）已实现并发布 v2.19.0（2026-11-16，5392852 加固 + 12f4f42 发版；QA 报告 docs/QA-CE.md）**；
> 误合并数据修复由运维侧完成；CD 批（自动应用/后台审核/调度化）仍待开发，新规则上线前 `match --apply` 需 `--yes` 且先 dry-run 核对提案。

**实测**：运维执行 `match --apply --limit 50`（应用 34 条）后又跑 `--limit 200`（再应用 32 条），共写入 **66 条**映射并合并了孤立行。
提案里出现大量 **1.00 分但对象错误** 的匹配：

| skuId | 杉果名 | 实际匹配到的候选 | appid | 问题 |
|---|---|---|---|---|
| 111456 | 幻世录 重制版 | 地铁2033 重制版 | 286690 | 共享"重制版"片段 |
| 111482 | 捉鬼敢死队 重制版 | 地铁2033 重制版 | 286690 | 同上 |
| 111491 | 代号：探戈 | 代号：文字生存 | 2416990 | 共享"代号" |
| 111488 | 星球大战：前线 经典版 | 星球大战 绝地：陨落的武士团 | 1172380 | 共享"星球大战" |
| 111627/111628 | 星球大战：银河赛车手（豪华版） | 绝地：陨落的武士团 | 1172380 | 同上 |
| 111630 | 碧蓝幻想Versus：崛起 传奇版 | 质量效应 传奇版 | 1328670 | 共享"传奇版" |
| 111631–111633 | 龙之剑:觉醒 - 服装… | 沙丘：觉醒 | 1172710 | 共享"觉醒" |
| 111603/111604 | 空之轨迹 the 2nd（豪华版） | 空之轨迹 the 1st | 3447040 | 中文片段相同，序号被忽略 |
| 111486 | MX摩托越野赛 | MX赛车世界 | 3975740 | 共享 "MX" |
| 111549 | 巴士模拟器 27 - 第1年季票 | 巴士模拟器 21 | 976590 | 基础名相同、版本号不同 |
| 111591 | TCG卡牌店模拟器 | Epic Cards Battle(TCG) | 381560 | 共享 "TCG" |
| 111452 | 造船师：猎鹰战纪 | 堡垒：猎鹰战纪 | 290100 | 共享"猎鹰战纪" |
| 111461 | 求救信号：生存岛 | 生存岛 | 1817670 | 疑似（需人工确认） |

**根因**（`src/match.js`）：

1. `nameVariants()` 把标题拆成中文/英文片段，`scorePair()` 取**所有片段组合的最大分**——共享一个短片段就 1.00，
   而片段可能只是"重制版/代号/星球大战/觉醒/传奇版/TCG/MX"这类通用词；
2. `EDITION_WORDS` 缺 **重制版/传奇版/经典版/增强版/重装上阵版/第1年季票/通行证/服装/皮肤/故事包/扩展包/合集/三部曲** 等；
3. **没有数字/序数一致性约束**（`the 2nd` vs `the 1st`、`27` vs `21`、`2` vs `1`）；
4. 自动阈值 0.94 对"片段 1.0"完全失效。

**必须先加固（CE 热修，CD 的自动应用在新规则上线前禁用）**：

- 只对**完整归一化标题**计分；片段匹配仅当片段长度 ≥6 且非通用词，并且完整标题分数 ≥0.8 才允许；
- 提取数字/序数/罗马数字（含 `the 2nd`/`2`/`II`）做**一致性校验**，不一致直接判负；
- 扩展内容词表；标题里出现 DLC/季票/通行证/服装/皮肤/故事包/扩展包/升级包/合集/三部曲 → **只进人工审核，不自动映射**；
- 自动条件收紧为：完整归一化相等，或（完整 Dice ≥0.94 且无内容词 且数字一致 且标题长度 ≥4）；
- `--apply` 打印每条"杉果名 → 候选名/appid"对照并要求 `--yes` 二次确认；默认只出提案；
- 增加误匹配回归测试集（上表 13 条 + 正确样例）。

**数据修复要求**：

1. **先关杉果源**（后台「系统设置 → 数据源与采集 → 杉果」关闭），阻断下一次 `sonkwo` 任务继续用错误 appid 挂报价；
2. 备份当前 `skus.json`（含错误映射）→ 把上表明确错误的 SKU `appid` 置空（保留正确的），不要整文件回滚（会丢正确映射）；
3. DB 侧逐条修复：用 `offers.buy_url like ''%/sku/<skuId>''` 找回该 SKU 的报价，迁到重建的孤立游戏行（或正确的 appid），
   同步修正 `game_aliases`；`mergeGames` 里 `dropped=1` 的重复报价已被删除，**对应历史无法恢复**（需重新采集）；
4. 修复脚本先 dry-run 输出"将迁移的报价/别名/目标行"，确认后再执行；修完再开杉果源。

**结论**：CD 的"自动应用"在加固 + 数据修复完成前**必须停用**；先开 CE 热修（匹配器加固 + 误合并修复），CC/CD 继续挂起。

## 10. 补充（2026-11-16 ITAD 探针实测）

`deal.url` 实际是 `https://itad.link/<uuid>/?app=...` **跳转链接**，不是 Steam 直链——§8 的"URL 反解"需要**先跟随 301/302 取最终 URL**，
只有最终 URL 形如 `store.steampowered.com/app/<id>/` 才能反解；若被联盟参数包裹或最终落点不是 Steam，则退回名称匹配。
下一步验证：对 Steam 店的 `deal.url` 发 HEAD/GET（follow redirect）打印最终 URL，再判断。