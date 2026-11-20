# QA：CO-5/B4-2 第十五轮 games 域拆分（第 1 轮）

> 基线 94671b4（#17 admin align 完成后的 worktree HEAD）→ 本轮交付 = 工作区未提交 diff（拆分提交待本报告完成后一并提交）；
> 判据：docs/ARCHITECTURE.md §15「域路由拆分模式」+ 夜班工人任务书（B4 #21 games：公开 /api/games/*，DX 已随 v2.28.0 发布）；
> 开发描述来源：夜班监工派工 prompt（自包含，本报告为工人自检）。
> 结论：✅ 放行 —— 通过 17 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（接口路径） | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | B4#21 | 个性化推荐：登录用户按 Steam 库行为打分推荐 20 款（15 分钟进程缓存；游客 401） | POST /api/games/for-you | ✅ 已交付 | routes/games.js:60-89；test/discovery.test.js:85-90（静态锁指新文件） |
| 2 | B4#21 | 游戏数量：库内总数 + 已有价格数（60 秒缓存；READ_MODEL=legacy 旧口径保留） | GET /api/games/count | ✅ 已交付 | routes/games.js:94-102；games-repository.js countGamesForApi；test/api.test.js 38/38 |
| 3 | B4#21 | 数据指纹：games/offers/offers_seen 聚合 + stamp 串（前台轮询判断列表是否要重拉） | GET /api/games/stamp | ✅ 已交付 | routes/games.js:108-110；games-repository.js gamesStamp；test/api.test.js 38/38 |
| 4 | B4#21 | 游戏列表/搜索：GET 旧接口 + POST 游客本地标记筛选（筛选/排序/分页白名单、DX 短缓存、games-search 并发闸 ≤2） | GET /api/games + POST /api/games/search | ✅ 已交付 | routes/games.js:116-226；game-search-read-model/filter/alias/exact 全绿 |
| 5 | B4#21 | 单游戏详情（按内部 id，杉果无 appid 游戏）：报价/历史曲线/到价提醒回显 + 浏览记录 | GET /api/games/by-id/:id | ✅ 已交付 | routes/games.js:230-246；test/api.test.js 38/38 |
| 6 | B4#21 | 单游戏详情（按 Steam appid）：报价/历史曲线/DLC 摘要/提醒回显 + 浏览记录 | GET /api/games/:appid | ✅ 已交付 | routes/games.js:249-264；test/api.test.js:69-83 |
| 7 | B4#21 | DLC 列表：分页/排序/buy_url/回源节流（10 分钟）+ 失败降级 synced:false | GET /api/games/:appid/dlc | ✅ 已交付 | routes/games.js:268-305；test/game-dlc.test.js 7/7 |
| 8 | B4#21 | 个人标记：感兴趣/已拥有 设置/清除（个人优先回退全局；写后失效前台缓存） | POST /api/games/:appid/flags + /api/games/id/:id/flags | ✅ 已交付 | routes/games.js:309-335；test/api.test.js:511-547 |
| 9 | B4#21 | 管理员兴趣标记（全局，影响列表 interest 列） | POST /api/games/:appid/interest + /api/games/id/:id/interest | ✅ 已交付 | routes/games.js:338-375；test/api.test.js:105-193 |
| 10 | B4#21 | 管理员拥有标记（全局，影响列表 owned 列） | POST /api/games/:appid/owned + /api/games/id/:id/owned | ✅ 已交付 | routes/games.js:354-386；test/api.test.js:1077-1089 |
| 11 | B4#21 | 单款价格历史 CSV 导出（HISTORY_CSV_ENABLED=1 才放行，默认 404） | GET /api/games/:appid/history.csv | ✅ 已交付 | routes/games.js:389-408；test/api.test.js:765-768 |
| 12 | B4#21 | 逻辑删除/恢复游戏（回收站；写后失效前台列表 + 后台短缓存） | POST /api/games/:appid/deleted + /api/games/id/:id/deleted | ✅ 已交付 | routes/games.js:411-425；test/api.test.js:1036-1066 |
| 13 | B4#21 | 禁用/解禁游戏（不出现在列表，继续采集；写后双缓存失效） | POST /api/games/:appid/blocked | ✅ 已交付 | routes/games.js:428-440；test/admin-cache.test.js 3/3、search-perf.test.js 5/5 |
| 14 | B4#21 | 编辑游戏说明（人工维护优先；写后失效后台短缓存） | POST /api/games/:appid/description | ✅ 已交付 | routes/games.js:442-454；test/sync-runs.test.js 9/9（位置锁改锚） |

## 逐条核对（拆分规格 → 证据）

| # | 条目（ARCHITECTURE §15 / 任务书） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | routes/games.js 只做 HTTP 编排，不写 SQL 字面量 | grep + 静态锁 | games.js 全文无 select/insert/update/delete from；test/game-search-read-model.test.js「不写 SQL 字面量」断言 | ✅ |
| 2 | ctx 基座字段按 §15.2 解构 + 域特有按引用传入且注释「语义共享」 | 读文件 | 基座 path/req/res/url/q/logger/json/readBody/user/requireUser/requireAdmin（games.js:26-48）；runGated/listCache/invalidateListCache/invalidateAdminGamesCache/gameCountCache/maybeFillDlcOnRead/dlcsReadThrottleMs/dlcFetchImpl 逐一注释语义共享 | ✅ |
| 3 | 入口形态按 §15.3：主段单入口；返回 true/false 约定 | 读文件 + 静态锁 | 单入口 handleGamesRoutes(ctx)（games.js:52）；凡写响应返回 true（含 (json(...), true) 逗号表达式保证非 undefined）、末尾 return false；静态锁第 1 组入口断言 | ✅ |
| 4 | 调用位置原样：主段、auth 接线之后 me 接线之前（本域最早路由 for-you 原位置） | grep + 静态锁位置语义两条 | server.js:1452-1484 接线块；test/game-search-read-model.test.js「auth 之后 / me 之前」两条位置语义锁 | ✅ |
| 5 | 11 个 pg.js 函数搬家，签名照抄 | 静态锁逐函数正则 | games-repository.js 中 gameSearch/getUserWatch/recordView/dataGen/listGameDlc/countGameDlc/countDlcMissing/dlcSummary/setGameBlocked/setGameDeleted/setUserGameFlag 签名与拆分前逐字一致（test 第 4 组） | ✅ |
| 6 | 域内联 SQL 抽成新函数（count/stamp 两条） | 对照拆分前 server.js | countGamesForApi/gamesStamp → games-repository.js；READ_MODEL=legacy 分支保留；静态锁第 4 组 2 条 | ✅ |
| 7 | pg.js 顶部 re-export 保旧签名；禁止删已有 re-export | git diff | pg.js 新增 13 项 games re-export；既有 app/appeal/auth/watchlist/announcements/admin-access/me/site/admin-sync/admin-settings/admin-sessions/admin-align re-export 零删改 | ✅ |
| 8 | 跨域通用 SQL 留 pg.js；共享片段 export 供 repository 导入（防两处漂移） | grep + git diff | gameDetail/regionOffers/dailyMinSeries/offersOfGame/setInterest/setOwned/setGameDescription/gameKeywordSql 留 pg.js；GAME_SELECT/GAME_SELECT_RM/EFFECTIVE_OWNED_SQL/OWNED_BY_SQL/WISHLISTED_SQL/WISHLISTED_BY_SQL/SITE_WISHLISTED_SQL 加 export，games-repository 导入（pg.js:1616、1707-1736） | ✅ |
| 9 | 域内状态随域移入；实例级闭包留宿主 | 读文件 | forYouCache（进程级 Map）/historyCsvEnabled 随域移入 games.js 模块级；gameCountCache/maybeFillDlcOnRead（每实例闭包，多实例隔离语义）留 server.js 按引用传 ctx；behaviorBuckets 留 server.js（/api/behavior 留宿主） | ✅ |
| 10 | 外部契约零变化（路径/参数/响应/错误码/权限） | 真跑运行时测试 | api.test 38/38、game-dlc 7/7、admin-cache 3/3、search-perf 5/5、game-search-filter 10/10、game-search-alias 9/9、game-search-exact 4/4、game-search-read-model 16/16、store-browse 15/15、steam-status 17/17、steam-accounts 16/16、watchlist-user 13/13、wishlist-push 6/6、password-change 4/4、setup 4/4、visitors 11/11、reviews 31/31、profile 15/15、sessions 17/17、pg 18/18、regions 4/4、merge 5/5、isolation 7/7、guard 11/11、pwa 9/9、discover 9/9、dev-publisher-names 6/6、discovery 5/5、sync-runs 9/9、http-guard 7/7 全绿 | ✅ |
| 11 | 静态断言测试指向新文件 + 四组锁 | 读测试文件 | test/game-search-read-model.test.js 新增 4 组锁（路由分支/接线/防双实现/re-export+签名）；test/discovery.test.js:85-90 改指 games.js + 残留红锁；test/sync-runs.test.js:252-256 位置锚改 handleGamesRoutes | ✅ |
| 12 | 反向自检：删分支/接线/re-export → 测试必须红 | 实测（删后恢复） | ① 改坏 stamp 分支 → 静态锁组 1 红（fail 1）→ 恢复全绿；② 破坏 server.js 接线 → 组 1+2 红（fail 2）→ 恢复全绿；③ 删 pg.js gameSearch re-export → 行为测试红（fail 4）→ 恢复 16/16 全绿 | ✅ |
| 13 | test:1..4 全绿（commit-own 沙箱基线除外） | 实测 | test:1 链式到末文件（仅 commit-own 4 项红=沙箱 spawn EPERM 基线）、test:2 全绿、test:3 全绿、test:4 全绿 | ✅ |
| 14 | api.test.js 全绿 | 实测 | 38/38 绿（含列表/详情/flags/interest/owned/deleted/blocked/history.csv/count/stamp 行为） | ✅ |
| 15 | frontend:build + scan | 实测 | 默认命令被沙箱拦（vite configLoader bundling 失败，与前几域同款）→ 等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` ✓ built in 6.00s；npm run scan：584 文件，✅ 无凭据 | 🔎（变体，CI 兜底） |
| 16 | 纪律：无新 tag / 不碰部署配置 / 产物不进提交 / 不改共用文档 / 不碰 package.json | git 取证 | git tag 无新增；diff 仅 server.js/pg.js/3 个 test 文件 + 2 新文件；frontend/dist 已忽略不入 status；B4-QUEUE/ACTIVE-SESSIONS/CHANGELOG/ARCHITECTURE 等共用文档零改动；package.json 未动 | ✅ |
| 17 | 拆分前后行数对比（任务书要求汇报） | git diff --numstat | server.js +42/−412（净 −370）、pg.js +40/−577（净 −537）、新 routes/games.js 436 行 + games-repository.js 600 行、测试 +188 行 | ✅ |

## 域边界判定（B4 #21 games 与相邻域的关系）

1. **盘点**：`grep games src/server.js` 逐条确认——公开 /api/games/* 16 组路由（for-you/count/stamp/列表+search/
   by-id/:appid/dlc/flags×2/interest×2/owned×2/history.csv/deleted×2/blocked/description）分散于主段 1447–1904
   与 admin 段深处 2393/2439/2815/2827 原位置。
2. **本轮拆走**：以上全部按 #21 拆入 src/routes/games.js + src/store/games-repository.js。域内 16 组路由
   path+method 互不重叠、与相邻域路由（/api/me、/api/announcements、/api/steam、/api/admin/*）无同 path
   双匹配，集中在主段一处（本域最早路由 for-you 原位置）不改变匹配语义；模块内保持原相对顺序。
   forYouCache/historyCsvEnabled 只被本域使用随域移入；gameCountCache/maybeFillDlcOnRead 是每实例闭包
   （多实例隔离语义，game-dlc.test.js 依赖「新实例重新回源」）留 server.js 按引用传 ctx。
3. **留宿主（不属于本域）**：
   - `/api/admin/games`、`/api/admin/games/stats`、`/api/admin/games/merge`、`/api/admin/games/:id/links`、
     `/api/admin/games/deleted`（B4 #15 admin 游戏目录）——留 server.js，本轮零改动；
   - `/api/behavior`（CH 批行为上报，不属 /api/games/* 前缀）与 behaviorBuckets 限流 Map——留 server.js；
   - `/img/steam/*` 图片代理（非 API 路由）——留 server.js；
   - isLoggablePath 的 /api/games/stamp 与 /api/games/search 访问记录豁免——中间件行为（§15.4）留 server.js；
   - HEAVY_GATE_CONFIG 的 games-search 闸键与 runGated 宿主闭包——留 server.js（#15 admin games 共用 gates Map），
     经 ctx 按引用传入。
4. **SQL 归属判据**（§15.5 第 4 步）：
   - 搬入 games-repository.js（只被本域路由使用）：gameSearch、getUserWatch、recordView、dataGen、
     listGameDlc、countGameDlc、countDlcMissing、dlcSummary、setGameBlocked、setGameDeleted、
     setUserGameFlag + 域内联新函数 countGamesForApi/gamesStamp；
   - 留 pg.js（跨模块共用）：gameDetail（watchlist 域/admin merge/links）、regionOffers 与
     dailyMinSeries 与 offersOfGame（src/report.js 报告页）、setInterest/setOwned（cli.js）、
     setGameDescription（cli/sync.js）、gameKeywordSql（#15 admin games 搜索）、dataGen 之外的
     sync_runs 函数族；GAME_SELECT/GAME_SELECT_RM/已拥有推导片段被 gameDetail/gameOverview 与
     gameSearch 共用 → 留 pg.js 加 export，games-repository 经 live binding 导入（循环 import
     安全：repository 顶层不立即求值，运行时函数调用时绑定已初始化）；
   - 无 DDL 搬家：games/daily_prices/offers/game_dlc 等表 DDL 在 pg.js SCHEMA 不动；
   - steam-accounts.js 等跨域模块零改动。
   测试锁第 4 组把「旧定义不得残留 pg.js + 跨域函数留 pg.js + repository 不搬 DDL」固化。

## 打回清单

无。

## 需人工确认

- 条目 15：frontend:build 默认命令在本机沙箱被拦（vite 加载配置的 bundling 阶段失败），
  改用等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` 构建成功；
  默认命令在 CI（docker 构建前端）验证——与前几域 QA 同口径。
- 条目 13：test:1 里 commit-own.test.js 4 项红为本机沙箱已知环境限制（spawn EPERM 类基线），
  CI（test-main）兜底验证；其余分段全绿。与前几域 QA 同口径。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-20）：自检 17 项 → 17 通过 / 0 缺失 / 0 偏差 / 2 需人工确认（均为本机沙箱
  环境限制，CI 兜底）→ ✅ 放行。反向自检已实测 ×3：改坏 stamp 分支 → 静态锁组 1 红（fail 1）；
  破坏 server.js 接线 → 组 1+2 红（fail 2）；删 pg.js gameSearch re-export → 行为测试红（fail 4）
  → 三次均恢复后 16/16 全绿。
