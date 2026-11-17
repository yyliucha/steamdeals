# 个性化推荐 + Deck 认证 + 好评率（借鉴 steam-deals）（待开发）

> 状态：**需求与方案已确认（2026-11-17），待开发**。
> 关联：[TODO.md](TODO.md) CH 条目（TODO/INDEX 被开发会话未提交改动占用，条目按 [HANDOVER.md](HANDOVER.md) §10.2 由收尾复盘补建，待补内容见本文 §12）、
> 参考项目：[Drakey83/steam-deals](https://github.com/Drakey83/steam-deals)。
> 本批 = 借鉴该项目的三件能力 + 两件搭车项，全部经所有者 2026-11-17 逐项拍板。

## 1. 已确认的决策

| # | 决策（全部为所有者 2026-11-17 确认） |
|---|---|
| 1 | 借鉴三件合并为本批：**A Steam Deck 认证徽标+筛选** + **B 好评率/综合评分排序** + **C 个性化「为你推荐」**；A/B 共用同一次新增采集（一次请求同拿两字段，不拆两个任务）。 |
| 2 | 采集机制：Steam 商店搜索 API `store/api/search/results`（按热度排序）**翻页为主**（每页 50，按 appid 匹配写库）；翻页覆盖不到的**热门子集用名称搜索回退**（每游戏 1 请求，复用 [match.js](../src/match.js) 打分，≥0.86 才采纳，歧义/低分标 `nomatch` 7 天不重试）。 |
| 3 | 每日节奏：**每天 100 页**（≈5000 款，单轮几分钟），不单独铺底，先日常跑起来。 |
| 4 | 好评率用法：**综合评分排序**（折扣 40% + 好评率 35% + 热度 25%，权重进设置项后台可调，默认照抄对方）+ **好评率筛选**。 |
| 5 | 「为你推荐」：**桌面 Web 先行**；CG Android App 后置（记入 [APP-NATIVE.md](APP-NATIVE.md) §4 后续范围，不阻塞本批）；未绑定 Steam 账号的用户在 tab 显示**绑定引导**（复用现有绑定流程）；游客无该入口。 |
| 6 | 行为学习：**全量行为集**——打开详情 / 查看价格历史与 DLC / 点购买链接 / 加删愿望单 / 标记三态 + **搜索词记录**；保留 **180 天**并入 prune；`personal.behaviorLogEnabled` 可关；搜索词仅本人画像使用，后台只看聚合。 |
| 7 | 免费角标**搭车做**：`games.is_free` 已在库，只加展示（角标 + 跳 Steam 领取），零新增采集。 |
| 8 | 口径硬约束：推荐候选**排除已拥有、不感兴趣、成人内容**（默认 hide 口径）；锁国区照旧标注不隐藏；**币种不折算**；**C2C 不进任何评分/推荐**；不引入新运行时依赖。 |
| 9 | 排期：**排在 CF / CD 之后**（本批状态「待开发」，不插队 CA/CG/CF/CD）；CG 的「为你推荐」App 支持由本批解锁。 |

## 2. 数据模型

- **`games` 加 5 列**（迁移追加到 [pg.js](../src/store/pg.js) 的 `alter table ... add column if not exists` 列表）：
  `deck_compat smallint`（0 未知 / 1 不支持 / 2 可玩 / 3 验证，null=未采集）、
  `review_score smallint`（1–9，Steam 内部评分）、`review_score_desc text`（好评如潮等文案）、
  `review_total integer`（搜索 API 的评测总数）、`quality_checked_at timestamptz`。
- **`games.tags` 加 GIN 索引** `games_tags_gin`（`using gin (tags)`），供「为你推荐」候选预过滤
  （`tags && $topTags`）；migrate 内 try/catch（与 pg_trgm 索引同模式，pglite 兼容兜底）。
- **名称回退队列复用 `game_source_sync`**（source=`steam-quality`，external_id=Steam appid）：
  `pending → matched → nomatch / failed` 状态机与退避完全沿用 [CC 批](SOURCE-SYNC-COVERAGE.md) 模式
  （nomatch 7 天窗口、failed 2^n 退避上限 30 天）。
- **新表 `user_behaviors`**：`id, user_id, game_id (nullable, 搜索行为为空), action text, weight smallint,
  count int, first_at, last_at`，`unique (user_id, game_id, action)`（**稳定键**），
  索引 `(user_id, last_at desc)`；重复上报只加 `count`（幂等）。
- **新表 `user_search_logs`**：`id, user_id, query text, clicked_game_id int nullable, created_at`，
  索引 `(user_id, created_at desc)`；并入 prune 保留 180 天。
- **评分口径**：好评率近似 = `review_score / 9`（搜索 API 只给 1–9 分，见 §11-① 待核实精确百分比字段）；
  综合分热度项直接用现有 `games.heat`（已是"对数化评测数+新作加权"，[pg.js:437](../src/store/pg.js) 即 log 标度），
  不重复计算；`heat_reviews` 主序与展示不动，`review_total` 只供综合分与详情展示。

## 3. 服务端

- **新增 `src/discovery.js`**：
  - `runDiscoveryRound({ pages, fallbackLimit })`：翻页 `search/results`（`sort_by=Reviews_DESC`，每页 50，
    只写库里已存在的 appid；`deck_compat`/`review_score`/`review_score_desc`/`review_total` upsert，
    `quality_checked_at=now()`）→ 收尾从 `game_source_sync(steam-quality)` 取 pending 热门回退队列
    （候选口径沿用 F 批热门定义：[cli.js:314](../src/cli.js) 的 近 90 天 `page_views` / `user_game_flags` / `heat≥1`，
    且本翻页轮未覆盖）逐个名称搜索 → match.js 打分 → 采纳/丢弃落状态。日志 `discovery.round_done` /
    `discovery.fallback_matched` / `discovery.fallback_nomatch`。
  - `computeForYou(userId, { region, page, pageSize })`：画像 = 该用户绑定 Steam 账号库中
    `playtime_minutes` 加权（log 权重、近 2 周加倍）∪ 标记三态（interested +2 / uninterested −1 / wishlist +1）
    ∪ 行为权重（action 白名单固定权重 × 封顶 count）→ 标签向量（对 `games.tags` 全体做 IDF 去普适性）；
    候选 = 排除已拥有/不感兴趣/成人（hide 口径）后按 `tags && topK(≤30) tags` 预过滤 →
    得分 = `tasteWeight × 标签相似度 + (1−tasteWeight) × 综合分` → 每条带 `because`（贡献最大的已拥有游戏名）。
    每用户实例级缓存 15 分钟。
- **`gameSearch` 扩展**（[pg.js:1583-1661](../src/store/pg.js) 排序白名单处）：
  `sort='score'`（SQL：`0.4*discount + 0.35*review_score/9*100 + 0.25*heat`，权重参数化自设置项）、
  `reviewMin`（1–9）、`deck`（`all|verified|playable|ok|unsupported` 白名单）；列表与详情返回
  `deck_compat / review_score / review_score_desc / review_total / is_free`（is_free 已返回则复用）。
- **新接口**：
  - `POST /api/games/for-you`（仅登录；未绑定账号返回 `{profile:false}` 引导；结果复用 gameSearch 行形状 + `because`）；
  - `POST /api/behavior`（埋点上报：`{action, gameId?, query?}`，action 白名单，每用户 60 次/分；
    `personal.behaviorLogEnabled=0` 时返回 202 且不落库）。
- **事件日志**：`discovery.round_done` / `personal.for_you_served` / `behavior.recorded`（失败带原因，不落敏感数据）。

## 4. 前端 / 后台

- **前台**（[Home.vue](../frontend/src/pages/Home.vue)）：
  - 工具栏排序下拉加「综合评分」（[Home.vue:22](../frontend/src/pages/Home.vue) 现有三项 + 1）；
  - 筛选区加「好评率」（不限 / ≥7 / ≥8 / ≥9）与「Steam Deck」（全部 / 仅认证 / 可玩及以上 / 不支持）；
  - 卡片徽标：Deck（✓ 验证 / ~ 可玩 / ✗ 不支持）、好评率色点（≥9 绿 / ≥7 蓝 / 其余灰）、
    **「免费」角标**（`is_free`，点「去 Steam 领取」复用现有 Steam 跳转，仅免费时显示）；
  - 详情弹窗：Deck 认证、好评率与评测数一行；免费游戏显示「免费领取」按钮；
  - 新 tab「为你推荐」：登录且绑定账号显示 20 条卡片 + 每条「因为你玩过 X」；未绑定显示引导卡
    （「绑定 Steam 账号解锁个性化推荐」+ 绑定入口）；游客不显示该 tab；移动端沿用现有卡片结构。
- **后台**：本批不加后台页；搜索词/行为数据仅聚合进画像（如需观测再后置立项）。
- Element Plus 组件沿用现有已注册集合，不引新组件（若新增需按 [main.js](../frontend/src/main.js) 注册）。

## 5. 设置与配置（[settings.js](../src/settings.js) `def()`，DB > env > 默认，热加载）

| key | env | 默认 | 说明 |
|---|---|---|---|
| `discovery.pages` | `STEAM_DISCOVERY_PAGES` | 100 | 每轮翻页数（×50 款） |
| `discovery.fallbackLimit` | `STEAM_DISCOVERY_FALLBACK_LIMIT` | 100 | 每轮名称回退条数 |
| `discovery.intervalMin` | `STEAM_DISCOVERY_INTERVAL_MIN` | 1440 | 每天一轮 |
| `personal.tasteWeight` | `PERSONAL_TASTE_WEIGHT` | 50 | 推荐 = 口味 vs 综合分的混合比例（0–100） |
| `personal.scoreDiscountWeight` | `PERSONAL_SCORE_DISCOUNT_W` | 40 | 综合分折扣权重 |
| `personal.scoreReviewWeight` | `PERSONAL_SCORE_REVIEW_W` | 35 | 综合分好评权重 |
| `personal.scoreHeatWeight` | `PERSONAL_SCORE_HEAT_W` | 25 | 综合分热度权重 |
| `personal.behaviorLogEnabled` | `PERSONAL_BEHAVIOR_LOG_ENABLED` | true | 行为学习总开关 |

## 6. 调度与自动化

- **新任务 `steam-discovery`** 进 [scheduler.js](../src/scheduler.js) 的 `jobsFromEnv`（默认参数与开关断言进
  [scheduler.test.js](../test/scheduler.test.js)），并加入 `STEAM_HEAVY`（[scheduler.js:307](../src/scheduler.js)）——
  搜索 API 与 appdetails 同域共享 200 次/5 分钟配额，**必须与现有 Steam 重任务互斥串行**。
- **合并评估（为什么不能并进已有任务）**：`backfill`/`steam-status` 的 appdetails、GetItems、
  `filters=recommendations` 三种请求形态**都不含** `deck_compat` / `review_score` 字段（全仓 grep 无这两字段），
  只能新建；新任务内部把 Deck + 好评率合并为同一次翻页请求，**不拆两个任务**。
- **单轮时长**：100 页 × 50 款 = 5000 款 ≈ 100 请求 + 回退 100 款 ≈ 100 请求，按 ~1.2s/请求 ≈ **5 分钟内**，
  不挤占其它任务（AC-4 预算影响可忽略，仍写进任务卡）。
- **续跑游标**：翻页**不存 start 游标**——每轮从头按热度翻固定页数，天然"热门子集优先"且幂等
  （目录会变，存页号反而会漏）；名称回退队列游标 = `game_source_sync.last_tried_at`（nomatch 7 天、failed 2^n 退避）。
- **幂等**：按 appid upsert；`quality_checked_at` 记本轮时间；字段无变化不写快照。
- 「为你推荐」是**本地计算**（零外部请求），不需要调度任务；画像随用户行为实时增量、分数查询时计算 + 15 分钟缓存。

## 7. 去重与幂等（硬约束节）

- **名称回退队列**：稳定键 = **Steam appid**（`game_source_sync.external_id`）；同名多候选按 match.js
  打分取**唯一最优**，歧义（并列高分）直接丢 `nomatch`；已采纳/已丢弃 7 天内不重试；
  **翻页主路径已覆盖的 appid 自动跳过回退队列**——同一游戏绝不因两条路径重复写两次。
- **行为表**：稳定键 `(user_id, game_id, action)`，重复上报只加 `count`（幂等）；
  手动标记（interested/owned）**优先于行为权重**——用户明确"不感兴趣"后，行为再高也不进推荐（决定继承）。
- **推荐候选**：排除集合 = 已拥有 ∪ 不感兴趣 ∪ 成人（hide 口径），每用户 15 分钟缓存保证同轮结果一致。

## 8. 安全

- 行为上报：POST-only、action 白名单、每用户 60 次/分限流、不接收 gameId 以外的数据；
  `personal.behaviorLogEnabled=0` 时 202 丢弃不落库；搜索词 v1 **不提供任何查询页面**（仅参与画像，后台只看聚合计数）。
- 「为你推荐」仅登录可用，每用户 30 次/分限流；结果复用现有成人/锁区展示策略，不绕过任何隐藏口径。
- 隐私文案：tab 内注明「基于你的 Steam 库与本站行为，仅本站保存，可在系统设置关闭」。
- 密钥/凭据不涉及；不新增依赖、不新增外呼域名（仍只访问 `store.steampowered.com`，走现有 `http.js`/代理池）。

## 9. 验收

1. **任务**：`scheduler.test.js` 断言 `steam-discovery` 默认参数（pages=100 / fallback=100 / interval=1440）与开关；
   跑一轮后日志 `discovery.round_done {pages, matched, fallbackRequests, requests}`，库里
   `deck_compat / review_score` 非空行数上升、`quality_checked_at` 为本轮时间；回退队列 nomatch 7 天内不重试。
2. **徽标与筛选**：卡片/详情出现 Deck 徽标（✓/~/✗）与好评率；「Deck=仅认证」「好评率≥8」筛选结果与库一致；
   「综合评分」排序与权重公式逐行可复核（构造测试样本断言排序）。
3. **为你推荐**：绑定账号用户返回 20 条且每条带 `because`（非空游戏名）；未绑定返回 `profile:false` 并显示引导；
   游客无入口；15 分钟内重复请求结果一致；已拥有/不感兴趣/成人游戏不出现在结果里。
4. **行为学习**：同 `(user,game,action)` 重复上报只加 count；开关关闭后上报 202 且不落库；
   prune 删除 180 天前的行为与搜索词；`test/for-you.test.js` 断言标记优先于行为权重。
5. **免费角标**：`is_free` 游戏显示「免费」角标与「去 Steam 领取」，非免费不显示。
6. **通用**：`npm test`（新增 `test/discovery.test.js` / `test/for-you.test.js` 进主链）、`frontend:build`、`scan` 全绿；
   移动端（web）无横向溢出；不自行打 tag。
7. **生产待核实（部署侧验证，写入 §11）**：见 §11 四条。

## 10. 实施顺序（单批可拆子批按序派发）

1. **CH-1 采集**：games 加 5 列 + tags GIN 索引 + `src/discovery.js` 翻页与回退 + `steam-discovery` 任务进
   scheduler/STEAM_HEAVY + 设置项 3 个 + `game_source_sync` 回退状态；
2. **CH-2 查询**：`gameSearch` 加 `sort='score'` / `reviewMin` / `deck` + 详情与列表字段；
3. **CH-3 前端徽标与筛选**：排序项、两筛选、卡片/详情徽标、免费角标；
4. **CH-4 行为**：`user_behaviors` / `user_search_logs` 表 + `/api/behavior` + 前端埋点 + prune 扩展；
5. **CH-5 推荐**：`computeForYou` + `/api/games/for-you` + 「为你推荐」tab + 引导卡 + 综合分权重设置项；
6. 文档收尾：PROJECT-OVERVIEW / README 已知限制 / DELIVERY 环境变量表 / CHANGELOG（按 HANDOVER 由开发会话执行）。

## 11. 待核实 / 待确认（需求阶段不承诺，上线前验证）

1. **search/results 返回结构**：`review_score`（1–9？）、`deck_compat`（0/1/2/3？）、有无精确好评百分比、
   `count` 上限（50 还是 100）、无 term 按热度翻页的**深度上限**（对方 README 称"everything on sale ~7 万款"可翻到）。
   写进部署侧验证：上线前一次只读实测（用 `src/http.js` 经现有代理），**字段不对就按实测调整映射，不阻塞开发**；
2. **`games.tags` 覆盖率**：生产抽查有 tag 的游戏占比与热门子集内的覆盖率——太低则「为你推荐」候选池不足，
   需要先在 CH-1 里顺带评估（steam-status/backfill 会持续补 tag，覆盖率随采集进度增长）；
3. 名称回退接口（`search/results?term=…`）的限流是否与目录翻页同口径；
4. `review_total`（搜索 API）与 `heat_reviews`（appdetails recommendations.total）口径差异——综合分用 `review_total`，
   `heat` 主序不动（两者独立，避免互相污染）。

## 12. TODO / INDEX 待补动作（HANDOVER §10.2，收尾复盘执行）

本次 [TODO.md](TODO.md) 与 [REQUIREMENTS-INDEX.md](REQUIREMENTS-INDEX.md) 被开发会话未提交改动占用
（2026-11-17 10:55 探测：`M`、mtime 10:10 / 9:54、无 `.git/index.lock`），按 §10.2 **跳过写入**。收尾复盘需补：

1. `docs/TODO.md` 新增 `## CH. 待开发：个性化推荐 + Deck 认证 + 好评率（借鉴 steam-deals）`，正文第一行
   `**状态：待开发（2026-11-17 方案已确认，排在 CF/CD 之后）**`，随后两行
   `**依赖：** 无（CF/CD 完成后开工）`、`**解锁：** CG 的「为你推荐」App 支持`，并链接本文档；
2. `docs/REQUIREMENTS-INDEX.md` 加一行：`CH | 个性化推荐+Deck 认证+好评率（借鉴 steam-deals）| DISCOVERY-FOR-YOU.md | 待开发 | ✅ 本轮已给`；
3. **禁止整文件覆盖**：用 `edit` 定点替换，先重读两份文件全文吸收别人的新增（§10.3）。
