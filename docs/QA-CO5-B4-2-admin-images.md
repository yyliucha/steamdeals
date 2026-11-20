# QA：B4 #13 admin 图片域拆分（第 1 轮）

> 基线 666f924（worktree gp-wt-12 rebase origin/main 后）→ 工作区未提交改动
> （server.js / pg.js / reviews.test.js 改 + routes/admin-images.js / store/admin-images-repository.js /
> test/admin-images.test.js 新增）；判据 docs/ARCHITECTURE.md §15 + docs/B4-QUEUE.md #13 行；
> 开发描述来源：监工续派 B4 #13 工人 prompt（自包含）。
> 结论：✅ 放行 —— 通过 16 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | B4 #13 | 封面图本地缓存统计（游戏/图/字节数） | GET /api/admin/images | ✅ | src/routes/admin-images.js:41 |
| 2 | B4 #13 | 清空进程内「缺图」负缓存（补图后不必等 24h，返回 cleared 条数） | POST /api/admin/images/reset-miss | ✅ | src/routes/admin-images.js:49 |
| 3 | B4 #13 | 图片覆盖看板（EC 批：缺图统计卡 + 分页缺图列表带原因，与 SQL 口径一致） | GET /api/admin/images/coverage | ✅ | src/routes/admin-images.js:59 |
| 4 | B4 #13 | 手动触发缺图回填（EC 批：复用同步子进程槽位 single-flight，忙时 409） | POST /api/admin/images/backfill | ✅ | src/routes/admin-images.js:126 |
| 5 | B4 #13 | 封面图代理负缓存跨路由共享（/img/ 写、看板读、reset 清空同一份 Map） | 请求链（语义共享） | ✅ | src/server.js imgMissCache + ctx 引用 |

## 逐条核对（规格验收 → 证据）

| # | 条目（§15 / B4-QUEUE #13 验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 域内 4 条路由全部拆到 src/routes/admin-images.js（images/reset-miss/coverage/backfill） | grep path === | src/routes/admin-images.js:41/49/59/126；test/admin-images.test.js 用例 1 | ✅ |
| 2 | 路由模块只做 HTTP 编排、不写 SQL 字面量（看板列表 SQL 抽 repository） | grep select | test/admin-images.test.js:36 断言通过（路由无 SQL） | ✅ |
| 3 | repository 成对存在、imageCoverageRows 签名与拆分前一致 | 读文件 | src/store/admin-images-repository.js:24（签名照抄） | ✅ |
| 4 | pg.js re-export 兼容 + 旧定义不残留（防双实现） | grep | pg.js re-export 行（imageCoverageRows, imageCoverageMissingRows）；test 用例 4 锁 | ✅ |
| 5 | 跨模块共用图片 SQL 留 pg.js（fillHeaderImage/missingHeaderImageAppids/backfillCandidateWhere） | grep | pg.js:fillHeaderImage、missingHeaderImageAppids 定义仍在；test 用例 4 边界锁 | ✅ |
| 6 | server.js 挂载改指新模块 + 位置语义不变（取最早路由 images GET 原位置） | grep 接线 | server.js import + 接线在 DT-3 users POST 之后、公告管理接线之前（test 用例 2 位置锁） | ✅ |
| 7 | 旧内联实现删除、无行为变化（契约零变化） | diff 逐段对照 | server.js 四段内联全删（净 −57）；新模块逐字对照原内联 | ✅ |
| 8 | requireAdmin 守卫逐条保留 | grep | routes/admin-images.js 4 处（test 锁计数=4） | ✅ |
| 9 | EC 批改动不回退：startSteamJobImpl ?? startSteamJob 替身优先级保持 | grep | routes/admin-images.js:131 `(startSteamJobImpl ?? startSteamJob)`；test 用例 1 锁 | ✅ |
| 10 | imgMissCache 本体与 /img/ 代理路由留 server.js（§15.4），经 ctx 按引用传入 | grep | server.js `const imgMissCache = new Map()` 与 imgMissCache.set 保留；test 用例 3 锁 | ✅ |
| 11 | 边界：不碰 /api/admin/games*（#15）、users/bulk（#11）、admin watchlist/wishlists（#16） | grep + diff | server.js diff 不含这些区块改动 | ✅ |
| 12 | 静态断言测试指新文件 + 既有锁更新 + 不降断言质量 | 读测试 | test/admin-images.test.js 147 行 5 用例；reviews.test.js 边界锁改指新接线 | ✅ |
| 13 | 反向自检：删分支 → 测试红 | 亲自执行 | 临时删 coverage 分支 → pass 3/fail 2 红证；恢复后 5/5 绿 | ✅ |
| 14 | 真跑测试全绿（含 EC/图片相关） | 亲自执行 | admin-images 5/5、image-coverage 9/9、reviews 31/31、api 38/38、admin-console-ia 22/22、test:1 仅 commit-own 4 项沙箱基线红、test:2/3/4 全链绿、frontend:build（--configLoader native）✓、scan 干净 | ✅ |
| 15 | 纪律：无新 tag、不构建、不改共用文档、不动 package.json | git tag + status | 无新 tag；工作区仅 6 个本域文件 | ✅ |
| 16 | 行数：server.js 净减 / pg.js 净变化 | numstat | server.js +32/−89 = 净 −57；pg.js +9/−9 = 净 0 | ✅ |

## 打回清单

（无）

## 需人工确认

- 条目 M1：frontend:build 标准命令本机沙箱 `spawn EPERM`（vite 配置加载 spawn 被拦），
  改用 `--configLoader native` 变体构建成功（#4–#12 各轮同口径先例）；生产构建由 CI 兜底。
- 条目 M2：test:1 仅 commit-own 4 项沙箱基线红（隔离提交/新鲜度门禁/清单锁/重叠警告，
  本机沙箱 spawn EPERM/ENOENT，B4-QUEUE 备注自 #4 起逐轮记录），与本域改动无关；CI 兜底。

## 争议项

（无）

## 复检记录

- 第 1 轮（2026-11-20）：16 条核对全过、反向自检红证、门禁全绿 → ✅ 放行（待提交后确认提交哈希）。
