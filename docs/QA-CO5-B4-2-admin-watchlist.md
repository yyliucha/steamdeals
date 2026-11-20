# QA：CO-5/B4-2 第十七轮 admin-watchlist 域拆分（第 1 轮）

> 基线 6a4ef94（#11 admin-users 完成后的 worktree HEAD）→ 本轮交付 = 工作区未提交 diff（拆分提交待本报告完成后一并提交）；
> 判据：docs/ARCHITECTURE.md §15「域路由拆分模式」+ 夜班工人任务书（B4 #16 admin 提醒愿望单：/api/admin/watchlist*、/api/admin/wishlists）；
> 开发描述来源：夜班监工派工 prompt（自包含，本报告为工人自检）。
> 结论：✅ 放行 —— 通过 16 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（接口路径） | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | B4#16 | 愿望单清单：管理员只读全站愿望单（搜索/按用户过滤；CY 批写方法已移除） | GET /api/admin/wishlists | ✅ 已交付 | routes/admin-watchlist.js；test/wishlist-site-only.test.js 7/7 |
| 2 | B4#16 | 到价提醒全站清单：分页/用户名筛选/「无报价」筛选；hasPrice/claimableUsers 驼峰契约 + 推送渠道名 | GET /api/admin/watchlist | ✅ 已交付 | routes/admin-watchlist.js；test/watchlist-noprice.test.js 3/3 |
| 3 | B4#16 | 站点级提醒加/改（旧兼容入口：gameId 或 appid、目标价校验） | POST /api/admin/watchlist | ✅ 已交付 | routes/admin-watchlist.js；test/watchlist-user.test.js 13/13 |
| 4 | B4#16 | 手动推送单条：5 分钟频控 429、用户级 403、无通道 400、发送失败 502、mark 默认勾选、审计 | POST /api/admin/watchlist/:id/push | ✅ 已交付 | routes/admin-watchlist.js；test/alert-push.test.js 9/9 |
| 5 | B4#16 | 手动推送批量（合并一封）：同一批频控、逐行 results、审计 | POST /api/admin/watchlist/push | ✅ 已交付 | routes/admin-watchlist.js；test/alert-push.test.js 9/9 |
| 6 | B4#16 | 站点级提醒批量迁移给用户（Steam 愿望单反查候选；目标用户校验；合并去重；审计） | POST /api/admin/watchlist/migrate | ✅ 已交付 | routes/admin-watchlist.js；test/watchlist-migrate.test.js 8/8 |
| 7 | B4#16 | 站点级提醒批量删除（用户级行只读；审计） | POST /api/admin/watchlist/delete | ✅ 已交付 | routes/admin-watchlist.js；test/watchlist-migrate.test.js 8/8 |
| 8 | B4#16 | 单条提醒清理：用户级行 403 + 审计，站点级行删除（CY 批数据隔离口径） | DELETE /api/admin/watchlist/:id | ✅ 已交付 | routes/admin-watchlist.js；test/watchlist-user.test.js 13/13 |

## 逐条核对（拆分规格 → 证据）

| # | 条目（ARCHITECTURE §15 / 任务书） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | routes/admin-watchlist.js 只做 HTTP 编排，不写 SQL 字面量 | grep + 静态锁 | 全文无 select/insert/update/delete from；test/watchlist-migrate.test.js「不写 SQL 字面量」断言 | ✅ |
| 2 | ctx 基座字段按 §15.2 解构；无跨模块共享状态（任务书允许） | 读文件 | path/req/res/url/q/logger/json/readBody/user/requireAdmin/ip；无 ctx 域特有字段（频控桶随域移入模块级，非请求级） | ✅ |
| 3 | 入口形态按 §15.3：管理段单入口；返回 true/false 约定 | 读文件 + 静态锁 | 单入口 handleAdminWatchlistAdmin；凡写响应 (json(...), true)、末尾 return false；静态锁第 1 组 | ✅ |
| 4 | 调用位置原样：管理段、watchlist 用户段接线之后 games/stats 之前（wishlists 原位置） | grep + 静态锁两条 | server.js 接线块；test/watchlist-migrate.test.js「watchlist 用户段之后 / games/stats 之前」两条位置语义锁 | ✅ |
| 5 | 4 个 pg.js 函数搬家，签名照抄 | 静态锁逐函数正则 | admin-watchlist-repository.js 中 deleteWatchById/listAllWatchesAdmin/migrateSiteWatches/deleteSiteWatches 签名与拆分前逐字一致 | ✅ |
| 6 | 域内联 SQL 抽新函数（2 个） | 对照拆分前 server.js | adminWatchTargetUser（migrate 目标用户行）/watchRowById（watchDel 提醒行）→ admin-watchlist-repository.js | ✅ |
| 7 | pg.js 顶部 re-export 保旧签名；禁止删已有 re-export | git diff | pg.js 新增 6 项 admin-watchlist re-export；既有各域 re-export 零删改 | ✅ |
| 8 | 跨域通用 SQL 留 pg.js；愿望单 SQL 跨模块原地 | grep + git diff | upsertWatch/deleteWatch/listWatches（cli.js watch 命令）、watchCandidates/markNotified（alerts 引擎/CLI report）、getUserWatch（games 域）留 pg.js；listWishlists 等愿望单 SQL 在 steam-accounts.js（公开区共用）未动 | ✅ |
| 9 | 公开区零触碰（任务书硬要求：DT-2 403e6f2 改动不得回退） | git diff 核对 | src/routes/watchlist.js 与 watchlist-repository.js 零改动；公开区行为测试 watchlist-user 13/13、wishlist-push 6/6、wishlist-site-only 7/7 全绿 | ✅ |
| 10 | 频控三件套随域移入模块级 + server.js re-export 保旧签名 | 读文件 + 测试 | alertPushBuckets/alertPushLimited/ALERT_PUSH_WINDOW_MS/resetAlertPushBuckets 移入 admin-watchlist.js 模块级（进程级 Map 语义不变）；server.js re-export；alert-push.test.js 9/9 全绿（import 未改） | ✅ |
| 11 | 外部契约零变化（路径/参数/响应/错误码/权限） | 真跑运行时测试 | api.test 38/38、alert-push 9/9、watchlist-migrate 8/8、watchlist-noprice 3/3、watchlist-user 13/13、wishlist-push 6/6、wishlist-site-only 7/7、account-notify 8/8、steam-accounts 16/16、sync-runs 9/9 全绿 | ✅ |
| 12 | 静态断言测试指向新文件 + 四组锁 | 读测试文件 | test/watchlist-migrate.test.js 新增 4 组锁；steam-accounts.test.js 与 sync-runs.test.js 的「wishlists 留 #16」边界锁改指新落点（不降断言质量） | ✅ |
| 13 | 反向自检：删分支/接线/re-export → 测试必须红 | 实测（删后恢复） | ① 改坏 migrate 分支 → 行为测试 + 组 1 红（fail 2）→ 恢复全绿；② 断 server.js 接线 → 行为测试 + 组 2 红（fail 2）→ 恢复全绿；③ 删 pg.js listAllWatchesAdmin re-export → 行为测试 ×2 + 组 4 红（fail 3）→ 恢复全绿 | ✅ |
| 14 | test:1..4 全绿（commit-own 沙箱基线除外） | 实测（串行复跑） | test:1 链式到末（仅 commit-own 4 项红=沙箱 spawn EPERM 基线）、test:2 全绿、test:3 全绿、test:4 全绿（注：多测试任务并行跑时曾出现 api.test 37/38 与 test:3 6/1 的环境干扰误报，串行复跑均全绿——非本域缺陷） | ✅ |
| 15 | frontend:build + scan | 实测 | 默认命令被沙箱拦（同前几域）→ 等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` ✓ built in 6.27s；npm run scan 干净 | 🔎（变体，CI 兜底） |
| 16 | 纪律：无新 tag / 不碰部署配置 / 产物不进提交 / 不改共用文档 / 不碰 package.json | git 取证 | git tag 无新增；diff 仅 server.js/pg.js/4 个 test 文件 + 2 新文件；frontend/dist 已忽略；B4-QUEUE/ACTIVE-SESSIONS/CHANGELOG/ARCHITECTURE 等共用文档零改动；package.json 未动 | ✅ |

## 域边界判定（B4 #16 admin 提醒愿望单 与相邻域的关系）

1. **盘点**：`grep admin/watchlist|admin/wishlists` 全 server.js——GET /api/admin/wishlists（1689）、
   GET/POST /api/admin/watchlist（1819/1840）、单条/批量 push（1989/2000）、migrate（2013）、
   delete（2037）、watchDel DELETE（2061）共 8 组，管理段散落三处。
2. **本轮拆走**：以上全部按 #16 拆入 src/routes/admin-watchlist.js + src/store/admin-watchlist-repository.js。
   手动推送频控三件套（alertPushBuckets/alertPushLimited/ALERT_PUSH_WINDOW_MS/resetAlertPushBuckets）
   只被本域使用、随域移入模块级（原 server.js 模块级 Map——进程级共享语义不变，重启清零同原）；
   server.js 顶部 re-export 三件套保旧导入签名（alert-push.test.js 照旧 import 不折腾）。
   adminPushWatches 闭包随路由移入（依赖的 alerts.js/notify.js 是独立模块、模块内 import）。
3. **留宿主 / 不碰（任务书硬边界）**：
   - 公开区 /api/watchlist、/api/wishlist 已随 B4 #4 拆在 src/routes/watchlist.js（DT-2 403e6f2 改过）——
     本轮零触碰（git diff 核对：watchlist.js/watchlist-repository.js 零改动）；
   - /api/admin/games*、stats、merge、links（B4 #15，工人 A 在途）、users/bulk（B4 #11 已拆）——
     server.js 零改动；
   - steam-accounts.js 整模块（listWishlists 被公开 watchlist 域与 admin wishlists 共用）跨模块原地。
4. **SQL 归属判据**（§15.5 第 4 步）：
   - 搬入 admin-watchlist-repository.js（只被本域管理段使用）：deleteWatchById、listAllWatchesAdmin、
     migrateSiteWatches、deleteSiteWatches + 域内联新函数 adminWatchTargetUser/watchRowById；
   - 留 pg.js（跨模块共用）：upsertWatch/deleteWatch/listWatches（cli.js watch add/del/list）、
     watchCandidates/markNotified（alerts 引擎与 CLI report）、getUserWatch（games 域详情回显）；
   - 无 DDL 搬家：watchlist 表 DDL 在 pg.js SCHEMA 不动；愿望单落库 SQL 在 steam-accounts.js 原地。
   测试锁第 4 组把「旧定义不得残留 pg.js + 跨域函数留 pg.js + repository 不搬 DDL」固化。

## 打回清单

无。

## 需人工确认

- 条目 15：frontend:build 默认命令在本机沙箱被拦（vite 加载配置的 bundling 阶段失败），
  改用等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` 构建成功；
  默认命令在 CI（docker 构建前端）验证——与前几域 QA 同口径。
- 条目 14：test:1 里 commit-own.test.js 4 项红为本机沙箱已知环境限制（spawn EPERM 类基线），
  CI（test-main）兜底验证；其余分段全绿。与前几域 QA 同口径。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-21）：自检 16 项 → 16 通过 / 0 缺失 / 0 偏差 / 2 需人工确认（均为本机沙箱
  环境限制，CI 兜底）→ ✅ 放行。反向自检已实测 ×3：改坏 migrate 分支 → 行为测试 + 组 1 红
  （fail 2）；断 server.js 接线 → 行为测试 + 组 2 红（fail 2）；删 pg.js listAllWatchesAdmin
  re-export → 行为测试 ×2 + 组 4 红（fail 3）→ 三次均恢复后全绿。
  备注：多测试任务并行跑时曾出现 api.test 37/38 与 test:3 6/1 的环境干扰误报（并行任务共享
  process.env），串行复跑均全绿——已在本轮记录，后续域并行跑测试时注意串行化。
- 推送前 rebase 冲突解决：origin/main 前进至 #15 admin 游戏目录（42ee800，工人 A 已收工）——
  server.js/pg.js 两文件冲突，按「对方 #15 的 handleAdminGamesAdmin 接线与 admin-games-repository
  re-export 保留、我方 admin-watchlist 接线保留、对方已拆的 games/stats 区块不再出现」解决；
  合并带动的边界锁锚点更新（#11 admin-users.test.js 与 #16 watchlist-migrate.test.js 的
  games 边界锚改指 handleAdminGamesAdmin）。合并后串行复验：api.test 38/38、watchlist-migrate
  8/8、admin-games 6/6、alert-push 9/9、admin-users 7/7、test:3/test:4 全链绿。
