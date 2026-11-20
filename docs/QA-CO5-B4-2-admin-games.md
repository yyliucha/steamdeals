# QA：B4 #15 admin 游戏目录域拆分（第 1 轮）

> 基线 8683f75（worktree gp-wt-12 rebase origin/main 后）→ 工作区未提交改动
> （server.js / pg.js / game-search-read-model.test.js 改 + routes/admin-games.js /
> store/admin-games-repository.js / test/admin-games-split.test.js 新增）；
> 判据 docs/ARCHITECTURE.md §15 + docs/B4-QUEUE.md #15 行；
> 开发描述来源：监工续派 B4 #15 工人 prompt（自包含）。
> 结论：✅ 放行 —— 通过 17 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | B4 #15 | 游戏同步概览（六态分项/回填队列/内容分级计数） | GET /api/admin/games/stats | ✅ | src/routes/admin-games.js:63 |
| 2 | B4 #15 | 游戏列表（分页/搜索/平台筛选（ITAD 来源）/同步状态/报价/回收站/分级，并发闸+3s 短缓存） | GET /api/admin/games | ✅ | src/routes/admin-games.js:70 |
| 3 | B4 #15 | 单游戏全部平台链接（仅 http/https） | GET /api/admin/games/:id/links | ✅ | src/routes/admin-games.js:120 |
| 4 | B4 #15 | 回收站（逻辑删除游戏列表） | GET /api/admin/games/deleted | ✅ | src/routes/admin-games.js:135 |
| 5 | B4 #15 | 合并重复游戏（from → to，合并后失效后台+前台缓存） | POST /api/admin/games/merge | ✅ | src/routes/admin-games.js:144 |

## 逐条核对（规格验收 → 证据）

| # | 条目（§15 / B4-QUEUE #15 验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 域内 5 条路由全部拆到 src/routes/admin-games.js（stats/games/links/deleted/merge） | grep path | src/routes/admin-games.js:63/70/120/135/144；test/admin-games-split.test.js 用例 1 | ✅ |
| 2 | 路由模块只做 HTTP 编排、不写 SQL 字面量（列表/where 片段/links 守卫行抽 repository） | grep select | test/admin-games-split.test.js:42 断言通过 | ✅ |
| 3 | repository 成对存在、adminGameStats/adminGameLinks/listDeletedGames 签名与拆分前一致 | 读文件 | src/store/admin-games-repository.js（三函数签名照抄） | ✅ |
| 4 | pg.js re-export 兼容 + 旧定义不残留（防双实现） | grep | pg.js re-export 七函数；test 用例 4 锁 | ✅ |
| 5 | 跨模块共用 SQL 留 pg.js（gameKeywordSql/backfillCandidateWhere/gameDetail/mergeGames/setInterest/setOwned） | grep | pg.js 定义仍在；test 用例 4 边界锁 | ✅ |
| 6 | server.js 挂载改指新模块 + 位置语义不变（取最早路由 stats 原位置） | grep 接线 | server.js import + 接线在 wishlists 段之后、admin watchlist 段之前（test 用例 2 位置锁） | ✅ |
| 7 | 旧内联实现删除、无行为变化（契约零变化） | diff 逐段对照 | server.js 五段内联全删；新模块逐字对照原内联（含 B1 闸/B2 缓存/B2 缓存 key 与 TTL 判定） | ✅ |
| 8 | requireAdmin 守卫逐条保留 | grep | routes/admin-games.js 5 处（test 锁计数=5） | ✅ |
| 9 | DV 批（0a6b978）ITAD 来源筛选逐字保持（拆分只移动不改行为） | grep 片段 | repository adminGamesPlatformCond：game_source_sync matched 判定逐字（test 锁） | ✅ |
| 10 | DX 批（090af4c）性能优化保持：并发闸、短缓存、merge 后双缓存失效、invalidateListCache | grep | routes/admin-games.js runGated 调用/缓存判定/双失效；test 用例 1 锁 | ✅ |
| 11 | 语义共享：runGated/adminGamesCache/invalidateAdminGamesCache/invalidateListCache 经 ctx 按引用传入；HEAVY_GATE_CONFIG 与 adminGamesCache 本体留 server.js | grep | server.js 接线 ctx 字段齐全（test 用例 2）；HEAVY_GATE_CONFIG/adminGamesCache 本体留宿主（test 用例 3 锁） | ✅ |
| 12 | 边界：不碰 /api/games/*（已拆 #21）、users/bulk（#11）、admin watchlist/wishlists（#16）；#21 判断注释随拆域调整 | grep + diff | server.js diff 不含这些区块改动；#21 注释已更新（128/1482 行） | ✅ |
| 13 | 静态断言测试指新文件 + 既有锁更新 + 不降断言质量；不覆盖既有 test/admin-games.test.js | 读测试 | 新 test/admin-games-split.test.js 161 行 5 用例；game-search-read-model.test.js 边界锁改指新接线；既有 admin-games.test.js（AG 批 links）零改动 | ✅ |
| 14 | 反向自检：删分支 → 测试红 | 亲自执行 | 临时删 merge 分支 → pass 3/fail 2 红证；恢复后 5/5 绿 | ✅ |
| 15 | 真跑测试全绿（含 DV/DX/AG 相关） | 亲自执行 | admin-games-split 5/5、admin-games 6/6（AG links）、game-search-read-model 16/16、admin-cache 3/3、merge 5/5、admin-links-drawer 6/6、admin-edit-dialog 6/6、api 38/38、test:1 仅 commit-own 4 项沙箱基线红、test:2/3/4 全链绿、frontend:build（--configLoader native）✓、scan 干净 | ✅ |
| 16 | 纪律：无新 tag、不构建、不改共用文档、不动 package.json | git tag + status | 无新 tag；工作区仅 6 个本域文件 | ✅ |
| 17 | 行数：server.js / pg.js 净减 | numstat | server.js +39/−142 = 净 −103；pg.js +23/−93 = 净 −70 | ✅ |

## 打回清单

（无）

## 需人工确认

- 条目 M1：frontend:build 标准命令本机沙箱 `spawn EPERM`（vite 配置加载 spawn 被拦），
  改用 `--configLoader native` 变体构建成功（#4–#13 各轮同口径先例）；生产构建由 CI 兜底。
- 条目 M2：test:1 仅 commit-own 4 项沙箱基线红（隔离提交/新鲜度门禁/清单锁/重叠警告，
  本机沙箱 spawn EPERM/ENOENT，B4-QUEUE 备注自 #4 起逐轮记录），与本域改动无关；CI 兜底。

## 争议项

（无）

## 复检记录

- 第 1 轮（2026-11-20）：17 条核对全过、反向自检红证、门禁全绿 → ✅ 放行（待提交后确认提交哈希）。
