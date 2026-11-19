# QA：CO-5/B4-2 第七轮 site 域拆分（第 1 轮）

> 基线 135fdd9（#6 me 完成后 HEAD）→ 本轮交付 = 工作区未提交 diff（待监工回写 B4-QUEUE 后提交）；
> 判据：docs/ARCHITECTURE.md §15「域路由拆分模式」+ 夜班工人任务书（B4 #7 杂项 site/steam/ban）；
> 开发描述来源：夜班监工派工 prompt（自包含，本报告为工人自检）。
> 结论：✅ 放行 —— 通过 18 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（接口路径） | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | B4#7 | 封禁状态自查：被封禁者（设备/IP/频率三类）也能拿到自己的 {banned,type,until,ip,whitelisted}，只回自己、不含名单；自带 1 次/秒、30 次/分钟限流防探测 | GET /api/ban/state | ✅ 已交付 | routes/site.js:70-102；test/reviews.test.js:663-749（27/27 绿） |
| 2 | B4#7 | 站点信息：名称/版本/申诉邮箱/成人内容展示策略/注册开关与 SMTP 就绪状态（游客与待改密用户可读） | GET /api/site | ✅ 已交付 | routes/site.js:112-139；test/api.test.js（B1 并发闸 37/37）、test/auth-pages.test.js:85 |
| 3 | B4#7 | Steam 账号列表：本人绑定账号（游戏数/愿望单数/最近同步/是否配 key）；管理员附未归属账号（认领入口）+ 绑定上限 | GET /api/steam/accounts | ✅ 已交付 | routes/site.js:170-176；test/steam-accounts.test.js:368-379 |
| 4 | B4#7 | Steam 账号兼容信息：旧单账号字段 + accounts 数组（匿名 200 空数组） | GET /api/steam/me | ✅ 已交付 | routes/site.js:178-189；test/steam-accounts.test.js:421-427 |
| 5 | B4#7 | 认领未归属 Steam 账号（仅管理员；已认领 409；落审计日志） | POST /api/steam/accounts/:id/claim | ✅ 已交付 | routes/site.js:196-219；test/steam-accounts.test.js:395-408 |
| 6 | B4#7 | 账号游戏库列表：搜索（名/英文名/AppID）+ 分页，不带参数旧行为（500 条）；越权 403 | GET /api/steam/accounts/:id/library | ✅ 已交付 | routes/site.js:243-258；test/profile.test.js:343-351 |
| 7 | B4#7 | 账号级游戏库同步：用该账号自配 API Key（不回退全局），差集删除 + 目录类型补全；key 无效 400、拉取失败 502 | POST /api/steam/accounts/:id/library/sync | ✅ 已交付 | routes/site.js:221-242；test/wishlist-site-only.test.js（5/5 绿） |
| 8 | B4#7 | 账号愿望单列表（搜索/分页）；越权 403 | GET /api/steam/accounts/:id/wishlist | ✅ 已交付 | routes/site.js:260-273；test/profile.test.js:353-360 |
| 9 | B4#7 | 账号级愿望单同步：账号 key + 愿望单→到价提醒对账（手动优先、移出清理） | POST /api/steam/accounts/:id/wishlist/sync | ✅ 已交付 | routes/site.js:223-242 同段；test/steam-accounts.test.js:103-154（模块函数） |
| 10 | B4#7 | 改账号别名（≤64 字）+ 自配 API Key（AES-256-GCM 加密落库，明文只进不出；clearApiKey 清除）；回显 apiKeySet | PATCH /api/steam/accounts/:id | ✅ 已交付 | routes/site.js:275-302；test/wishlist-push.test.js:251-266 |
| 11 | B4#7 | 解绑账号：级联清库/愿望单 + 自动提醒对账 + 默认账号收口（不动头像）；只能归属人 | DELETE /api/steam/accounts/:id | ✅ 已交付 | routes/site.js:304-317；test/profile.test.js:282-307 |
| 12 | B4#7 | 设为默认 Steam 账号（每用户一个；与头像解耦） | POST /api/steam/accounts/:id/default | ✅ 已交付 | routes/site.js:320-330；test/profile.test.js:246-299 |

## 逐条核对（拆分规格 → 证据）

| # | 条目（ARCHITECTURE §15 / 任务书） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | routes/site.js 只做 HTTP 编排，不写 SQL 字面量 | grep + 静态锁 | site.js 全文无 select/insert/update/delete from；test/steam-accounts.test.js:614「不写 SQL 字面量」断言 | ✅ |
| 2 | ctx 基座字段按 §15.2 解构 | 读文件 | 预检段 path/req/res/json/ip/whitelisted/deviceId（site.js:72）；公开段 + q/siteName/appealEmail（:110）；主段 + url/logger/readBody/user/requireUser/requireAdmin（:150） | ✅ |
| 3 | 域特有传引用字段注释「语义共享」 | 读文件 | siteName/appealEmail 注释「宿主闭包…按引用传入（语义共享）」（:55-57、:107-108）；banStateBuckets 注释「模块级=进程级…语义共享」（:51-54） | ✅ |
| 4 | 入口形态按 §15.3：预检段 + 公开段 + 主段；返回 true/false 约定 | 读文件 + 静态锁 | 三入口导出（site.js:82/108/148）；凡写响应 return true、末尾 return false；静态锁第 1 组入口断言 | ✅ |
| 5 | 调用位置原样：预检段在拦截链前、公开段在认证上下文前、主段在原 steam 段位置 | grep + 静态锁位置语义三条 | server.js 预检段调用在 handleAppPreflight 之前（原 /api/ban/state 位置）、公开段在 handleAnnouncementsPublic 之前、主段在 handleWatchlistRoutes 之前；test/steam-accounts.test.js:627-629 位置语义锁 | ✅ |
| 6 | 3 个 pg.js 函数搬家，签名照抄 | 静态锁逐函数正则 | site-repository.js:31/37/48 签名与拆分前逐字一致（setDefaultSteamAccount/clearDefaultSteamIfMatches/userLibraryItems） | ✅ |
| 7 | 域内联 SQL 抽成新函数（7 个） | 对照拆分前 server.js | registrationEnabledRow/accountApiKeyEnc/accountOwnerRow/claimTargetRow/claimSteamAccount/updateSteamAccountAlias/steamAccountApiKeySet → site-repository.js:83-138；静态锁第 4 组 7 条 | ✅ |
| 8 | pg.js 顶部 re-export 保旧签名；禁止删已有 re-export | git diff | pg.js 新增 10 项 site re-export（:100-112）；既有 app/appeal/auth/watchlist/announcements/me re-export 零删改；移除的仅本地 import getUserPublic（随 setDefaultSteamAccount 搬家） | ✅ |
| 9 | 跨域通用 SQL 留 pg.js / steam-accounts.js 原地 | grep + git diff | OFFICIAL_KINDS 留 pg.js（site-repository 经 live binding import）；steam_accounts 等表 DDL 在 steam-login.js 不动；steam-accounts.js 整模块不动（CLI + admin #16 共用） | ✅ |
| 10 | 外部契约零变化（路径/参数/响应/错误码） | 真跑运行时测试 | steam-accounts 14/14、profile 13/13、reviews 27/27、isolation 7/7、wishlist-push 6/6、wishlist-site-only 5/5、serve 12/12、http-guard 7/7、auth-pages 10/10、auth-lockout 11/11 全绿；api.test 37/37 绿 | ✅ |
| 11 | 静态断言测试指向新文件 + 三条锁 | 读测试文件 | test/steam-accounts.test.js 新增 4 组锁；test/profile.test.js:527 改锁「旧定义不得残留 pg.js」；test/auth-pages.test.js:85 改指 site.js；test/wishlist-site-only.test.js:161-166 改指 site.js；test/auth-lockout.test.js:223 改锁 MAX_ACCOUNTS_PER_USER 消费方 | ✅ |
| 12 | 反向自检：删分支 → 测试必须红 | 实测（删后恢复） | 临时改坏 /api/steam/me 分支 → fail 2（静态锁 + 行为测试）、exit 1 → 恢复后 14/14 绿 | ✅ |
| 13 | test:1..4 全绿（commit-own 沙箱基线除外） | 实测 | test:1 除 commit-own 4 项全绿（&& 链跑至末文件）、test:2 全绿、test:3 全绿、test:4 全绿（含 profile 13/13）；commit-own 单跑 4/4 红为沙箱 spawn EPERM/文件面重叠基线 | ✅ |
| 14 | api.test.js 全绿 | 实测 | 37/37 绿（含 /api/site 并发闸行、/api/ban/state 行为） | ✅ |
| 15 | frontend:build + scan | 实测 | 默认命令被沙箱拦（vite configLoader bundling 失败，与 #4/#5/#6 同款）→ 等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` ✓ built in 2.02s；npm run scan：720 文件，✅ 无凭据 | 🔎（变体，CI 兜底） |
| 16 | 纪律：无新 tag / 不碰部署配置 / 产物不进提交 / 不改共用文档 | git 取证 | git tag 无新增；diff 仅 server.js/pg.js/5 个 test 文件 + 2 新文件；frontend/dist 未入 status；ARCHITECTURE/TODO/B4-QUEUE/CHANGELOG 等共用文档零改动（B4-QUEUE/ACTIVE-SESSIONS 的改动属监工登记，不提交） | ✅ |
| 17 | 域边界判定写入报告并静态锁固化 | 读报告 + 测试 | 本报告「域边界判定」+ test/steam-accounts.test.js:650-652 边界锁（admin wishlists/steam-logs 留宿主） | ✅ |
| 18 | 拆分前后行数对比（任务书要求汇报） | git diff + 计数 | server.js −284/+41（净 −243）、pg.js −72/+22（净 −50）、新 routes/site.js 380 行 + site-repository.js 149 行、测试 +124 行 | ✅ |

## 域边界判定（B4 #7 site/steam/ban 与相邻域的关系）

1. **盘点**：`grep /api/site /api/steam /api/ban/state` 全 src——`GET /api/ban/state`（拦截链前，server.js 原 892 行区块）、
   `GET /api/site`（公开段，原 1239 行）、`GET /api/steam/accounts`、`GET /api/steam/me`、
   `/api/steam/accounts/:id` 的 claim/library/wishlist/PATCH/DELETE/default（主段，原 1984–2166 连续区块）。
2. **本轮拆走**：以上全部按 #7 拆入 src/routes/site.js + src/store/site-repository.js；
   `MAX_ACCOUNTS_PER_USER` 的消费方随域迁入 site.js（定义仍在 routes/auth.js，与认证域同一定义防漂移）；
   banStateBuckets/banStateLimited 限流桶只被本域使用、随域移入（watchlist 域 watchUserFails 先例）；
   requireAccountApiKey/requireAccountOwner 两个请求级闭包随路由移入模块。
3. **留宿主（不属于本域）**：
   - `/api/admin/wishlists`（admin 段，B4 #16）与 `/api/admin/steam-logs`（B4 #12）——同用
     steam-accounts/steam-log 模块但属其它域，留 server.js；动态 import 保留供这两段使用；
   - `/api/me/email/*` 与 `/api/auth/email*`（src/auth-routes.js，DT-2 排除区）本轮不碰（任务书明示）；
   - 拦截链/设备限流/must_change_password 白名单（含 p === '/api/site' 条目）/ensureSteamSchemaOnce
     幂等建表——中间件行为，§15.4 判据「所有域都经过 → 留 server.js」。
4. **SQL 归属判据**（§15.5 第 4 步）：setDefaultSteamAccount/clearDefaultSteamIfMatches/userLibraryItems
   第六轮因「steam accounts 域 B4 #7 使用」留 pg.js，本轮到达归属域、且无其它模块使用 → 搬入
   site-repository.js（pg.js re-export 保签名）；steam_accounts/steam_games/steam_wishlist 表 DDL 在
   steam-login.js（ensureSteamSchemaOnce 跨模块共用）→ 不搬家；steam-accounts.js 整模块
   （listUserAccounts/syncAccountLibrary/unbindAccount 等）被 CLI 与 admin 段共用 → 原地不动。
   测试锁第 4 组 + profile.test.js:527 改锁把「旧定义不得残留 pg.js」固化。

## 打回清单

无。

## 需人工确认

- 条目 15：frontend:build 默认命令在本机沙箱被拦（vite 加载配置的 bundling 阶段失败），
  改用等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` 构建成功；
  默认命令在 CI（docker 构建前端）验证——与 #4/#5/#6 域 QA 同口径。
- 条目 13：test:1 里 commit-own.test.js 4 项红为本机沙箱已知环境限制（spawn EPERM 类 +
  与监工在途 B4-QUEUE/ACTIVE-SESSIONS 改动的文件面重叠），CI（test-main）兜底验证；
  其余分段全绿。与 #4/#5/#6 域 QA 同口径。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-20）：自检 18 项 → 18 通过 / 0 缺失 / 0 偏差 / 2 需人工确认（均为本机沙箱
  环境限制，CI 兜底）→ ✅ 放行。反向自检已实测：改坏 /api/steam/me 分支 → 测试红（fail 2）
  → 恢复全绿。
