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

在服务器容器内执行（`match` 会读容器内 `data/skus.json`，该目录是持久卷）：

```bash
# 1) 先看提案（只读，不写库）
docker exec steamdeals node src/cli.js match

# 2) 自动应用 ≥0.94 的映射（写 skus.json + 合并孤立行）
docker exec steamdeals node src/cli.js match --apply

# 3) 0.86–0.94 的逐条人工确认（skuId 和 appid 从提案列表里取）
docker exec steamdeals node src/cli.js match --confirm <skuId> <steamAppId>

# 4) 让杉果报价挂到 Steam 游戏上（并触发后续 Steam 信息/报价回填）
docker exec steamdeals node src/cli.js sync sonkwo
```

- `--limit`（默认 200）控制本轮处理的未映射 SKU 数；`--min-score` 默认 0.86；
- 确认后后台该行会显示 Steam appid、`sync sonkwo` 后续报价并入 Steam 游戏行，`未探测` 会随回填下降；
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

### 4.4 后台审核面板

- 位置：游戏管理 → 「同步与回填」或新增 tab「杉果对齐」；
- 列表字段：杉果 SKU / 杉果中文名 / 英文名 / 候选 Steam 游戏（appid+名称）/ 分数 / 建议（自动/待确认/无候选）；
- 操作：确认（调 `applySkuMapping` + 写映射 + 合并孤立行）、忽略（记 `ignored`，不再提示）、批量确认（≥0.94 可一键）；
- 权限：仅管理员；写操作记操作日志（`match.applied` 审计）。

### 4.5 映射与合并

- 映射落点沿用 `data/skus.json`（持久卷）+ `game_aliases`（DB，记录 method/confidence）；
- 合并沿用 `applySkuMapping`：只合并"无 appid 的孤立行"，有 appid 的冲突行记 `match.skip_merge` 交人工；
- 合并后 `sync sonkwo` 让报价挂到 Steam 游戏；`steam-status`/`backfill` 自然补齐 Steam 信息（零额外任务）。

## 5. 验收

1. **算法**：`塔拉萨号` 这类中文↔英文无交集的 SKU，用杉果英文名匹配到 Steam `name_en` 后分数 ≥0.86/0.94；
   Dying Light 系列（Deluxe/Definitive）按 1.00/0.944 自动；
2. **调度**：`sonkwo` 任务收尾自动跑匹配（或独立 match 任务），日志有 `match.summary`；不新增 cron 任务；
3. **后台**：审核面板能看到待确认列表并一键确认/忽略；确认后该游戏显示 Steam appid、孤立行被合并；
4. **数据**：`sync sonkwo` 后杉果报价挂在 Steam 游戏上；`ingest.summary.noAppId` 下降；后台「未探测」下降；
5. **性能**：单轮 `limit=100` 的匹配在可接受时间内完成（目标 < 30s），不阻塞调度；
6. **安全/正确性**：不会把两个不同游戏合并（抽查 Dying Light 系列、塔拉萨号、造物主2）；冲突/低分交人工；
7. **测试**：`match` 单元测试（中↔中、英↔英、中↔英经英文名、版次剥离、阈值分级）、后台接口测试、`npm test` 全绿。

## 6. 本批不做

1. 不引入翻译服务/LLM/第三方匹配 API；
2. 不做全量一次性合并（按批 + 审核）；
3. 不改 Steam/ITAD/GOG/Humble 的采集逻辑；
4. 不做跨语言自动翻译标题（英文名来自杉果页面，不额外生成）。

## 7. 待确认（有默认值，不阻塞）

1. 版次 SKU 默认自动映射到基础版（若价格可比性优先，改为只进审核）；
2. 匹配调度：并入 `sonkwo` 收尾（默认）还是独立 `match` 任务每 6 小时；
3. 审核面板放在「游戏管理」下新 tab（默认）还是「同步与回填」页；
4. 自动/人工阈值是否仍用 0.94 / 0.86（默认沿用）。

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