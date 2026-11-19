# QA：CO-5/B4-2 第四轮 watchlist/wishlist 域拆分（第 1 轮）

> 基线 89c004a → 工作区（未提交，HEAD 89c004a）；判据 docs/ARCHITECTURE.md §15「域路由拆分模式」+ B4 队列 #4 拆分任务书；
> 结论：✅ 放行 —— 通过 10 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付 = 拆分重构，外部契约零变化；用户可感知功能与拆分前完全一致）

| # | 编号 | 功能（用户视角） | 入口（接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | B4 #4 | 登录用户查看自己的到价提醒列表 | GET /api/watchlist | ✅ | src/routes/watchlist.js:60-64；test/watchlist-user.test.js 12/12 |
| 2 | B4 #4 | 添加/更新到价提醒（gameId 或 appid；非法目标价 400） | POST /api/watchlist | ✅ | src/routes/watchlist.js:66-102；watchlist-user.test.js 12/12 |
| 3 | B4 #4 | 删除自己的提醒（幂等 removed 0/1） | DELETE /api/watchlist/:gameId | ✅ | src/routes/watchlist.js:104-116；watchlist-user/isolation.test.js 绿 |
| 4 | B4 #4 | 手动加愿望单（只写本站+建史低提醒，兼容旧前端响应字段） | POST /api/wishlist | ✅ | src/routes/watchlist.js:119-135；wishlist-site-only.test.js 5/5 |
| 5 | B4 #4 | 按 Steam appid 移出愿望单 | DELETE /api/wishlist/:appid | ✅ | src/routes/watchlist.js:137-152；wishlist.test.js 6/6 |
| 6 | B4 #4 | 按本站 gameId 移出愿望单 | DELETE /api/wishlist/id/:gameId | ✅ | src/routes/watchlist.js:138-152；wishlist.test.js 6/6 |

## 逐条核对（拆分 checklist → 证据）

| # | 条目（ARCHITECTURE §15 + 任务书） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 域边界：6 条用户段路由全部入域；admin 段/steam-accounts 段/games 段不误拆 | grep watchlist\|wishlist src/server.js 逐条归域 | server.js:2422（/api/admin/wishlists）、2546-2787（/api/admin/watchlist*，B4 #16）、2239-2330（/api/steam/accounts/*/wishlist，B4 #7）、1932-1933（搜索 wishlist 筛选，B4 #21）均保留；用户段 6 分支已移出 | ✅ |
| 2 | routes/watchlist.js 只做 HTTP 编排、不写 SQL 字面量 | grep 'insert into\|select .* from\|delete from\|update .* set\|create table' src/routes/watchlist.js | 零命中（SQL 全走 db.* / steamAccountsMod.*） | ✅ |
| 3 | ctx 固定基座解构 | 读模块头部 | src/routes/watchlist.js:55（path/req/res/q/logger/json/readBody/user/requireUser） | ✅ |
| 4 | 域特有共享状态：watchUserFails 只被本域使用 → 随域移入并注释语义共享 | 读模块 + grep 残留 | src/routes/watchlist.js:38-49（模块级 Map +「语义共享」注释）；server.js 无 watchUserLimited 残留（防双实现锁） | ✅ |
| 5 | repository 函数签名与拆分前一致 | diff 逐行对照 | src/store/watchlist-repository.js:24/34/46（upsertUserWatch/deleteUserWatch/listUserWatches 签名照抄） | ✅ |
| 6 | pg.js re-export 壳；不删任何已有 re-export；旧定义不残留 | 读 pg.js 头部 + 静态锁 | src/store/pg.js:11-12/15-44/48-59（app/appeal/auth 三域 re-export 原样保留）、62-68（新增 watchlist re-export）；pg.js 内三个旧函数定义已删 | ✅ |
| 7 | server.js 原位置接线（主段，位置语义不能挪） | git diff + 读上下文 | src/server.js:2403-2418（原用户段位置，认证上下文之后、/api/admin/wishlists 之前） | ✅ |
| 8 | 契约零变化：路径/参数/响应/错误码 | git diff 逐行对照 + 相关测试族全量 | diff 中 6 分支响应体/校验/限流文案与拆分前逐字一致（仅 json→return true 结构改写）；watchlist-user 12/12、wishlist 6/6、wishlist-site-only 5/5、watchlist-migrate 4/4、watchlist-noprice 3/3、alert-push 9/9、isolation 7/7、steam-accounts 10/10、wishlist-push 6/6 | ✅ |
| 9 | 测试三条锁 + 反向自检（删分支必红） | 读锁 + 实跑四方向自检 | test/watchlist-user.test.js:294-340（路由在新文件/宿主接线/防双实现/re-export 四组锁）；实跑：改 wishlistX 分支→测试 9 红；双实现抄回→测试 11 红；if(false) 包接线→测试 10+7 红；re-export 改名→模块加载必败。恢复后 12/12 绿 | ✅ |
| 10 | 测试链：test:1..4 / api.test / frontend:build / scan | 实跑留痕 | 见下「重跑验证」 | ✅ |

## 重跑验证（命令与关键输出）

- `node test/watchlist-user.test.js` → 12 pass / 0 fail；`node test/wishlist.test.js` 6/0；`wishlist-site-only` 5/0；`watchlist-migrate` 4/0；`watchlist-noprice` 3/0；`alert-push` 9/0；`isolation` 7/0；`steam-accounts` 10/0；`wishlist-push` 6/0。
- `npm run test:1..4`：test:1 仅 test/commit-own.test.js 4 项红（spawn EPERM 沙箱限制，见「需人工确认」）；test:2/3/4 全 0 fail。
- `node test/api.test.js` → fail 0。
- `npm run frontend:build` 默认命令在本机沙箱被 vite 配置加载阶段的 `spawn EPERM` 拦截（vite `windowsSafeRealPathSync` 需 spawn 子进程）；等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` → ✓ built in 14.61s（前端零改动，见「需人工确认」）。
- `npm run scan` → ✅ 未发现高置信度凭据（token / 私钥 / 带真实密码的连接串）；✅ 未发现可疑的密钥赋值。

## 拆分前后行数对比

| 文件 | 拆分前 | 拆分后 | 变化 |
|---|---|---|---|
| src/server.js | 5041 | 4988 | 净减 53（git numstat：+22/−80） |
| src/store/pg.js | 4526 | 4493 | 净减 33（git numstat：+11/−47） |
| src/routes/watchlist.js（新） | — | 140 | +140 |
| src/store/watchlist-repository.js（新） | — | 65 | +65 |
| test/watchlist-user.test.js | 290 | 342 | +52（4 组静态锁） |

## 需人工确认

- 条目 1：test/commit-own.test.js 4 项在本机沙箱红（spawn 捕获子进程输出 EPERM）——基线 worktree（HEAD 89c004a 原版）实跑同样 4/4 红，判定为环境限制而非拆分回归；CI（无沙箱）应由真实 git 环境验证。
- 条目 2：frontend:build 默认命令在本机沙箱被拦（vite 配置加载阶段 spawn EPERM）；本批前端零改动，native loader 变体构建成功（14.61s）证明前端链完好；CI 以默认命令兜底验证。

## 复检记录

- 第 1 轮（2026-11-20）：通过 10 / 缺失 0 / 偏差 0 / 需人工确认 2 → ✅ 放行。
