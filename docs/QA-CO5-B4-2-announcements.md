# QA：CO-5/B4-2 第五轮 announcements 域拆分（第 1 轮）

> 基线 914dc56（#4 watchlist 完成后 HEAD）→ 本轮交付 = 工作区未提交 diff（待监工回写 B4-QUEUE 后提交）；
> 判据：docs/ARCHITECTURE.md §15「域路由拆分模式」+ 夜班工人任务书（B4 #5 announcements）；
> 开发描述来源：夜班监工派工 prompt（自包含，本报告为工人自检）。
> 结论：✅ 放行 —— 通过 16 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（接口路径） | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | B4#5 | 前台公告列表：只显示生效窗口内的公告；登录用户附带服务端已读 id（跨设备跟随账号），游客给空数组 | GET /api/announcements | ✅ 已交付 | routes/announcements.js:46-67；test/announcements.test.js:64-66、113-118 |
| 2 | B4#5 | 标记公告已读：登录用户写服务端已读表（幂等；无效 id 忽略；匿名 401） | POST /api/announcements/read | ✅ 已交付 | routes/announcements.js:83-97；test/announcements.test.js:121-153 |
| 3 | B4#5 | 管理员公告列表（limit 收敛 1–200） | GET /api/admin/announcements | ✅ 已交付 | routes/announcements.js:105-110；test/announcements.test.js:56-79 |
| 4 | B4#5 | 管理员创建公告（标题/内容必填 400；level 白名单；active/startsAt/endsAt） | POST /api/admin/announcements | ✅ 已交付 | routes/announcements.js:111-134；test/announcements.test.js:56-62 |
| 5 | B4#5 | 管理员更新公告（PATCH/PUT；不存在 404） | PATCH、PUT /api/admin/announcements/:id | ✅ 已交付 | routes/announcements.js:136-160；test/announcements.test.js:68-75 |
| 6 | B4#5 | 管理员删除公告（幂等 removed 0/1；级联清已读状态） | DELETE /api/admin/announcements/:id | ✅ 已交付 | routes/announcements.js:161-168；test/announcements.test.js:77-79、171-174 |
| 7 | B4#5 | 后台批量删除/启用/停用公告（**留在 server.js/pg.js，属 B4 #11**） | POST /api/admin/bulk（target=announcements/delete、activate、deactivate） | ✅ 已交付（未拆，按边界判据留） | server.js:4689-4691、4852-4865；pg.js:bulkDeleteAnnouncements/bulkSetAnnouncementsActive |

## 逐条核对（拆分规格 → 证据）

| # | 条目（ARCHITECTURE §15 / 任务书） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | routes/announcements.js 只做 HTTP 编排，不写 SQL 字面量 | grep SQL 关键字 + 静态锁 | routes/announcements.js 全文无 select/insert/update/delete from；test/announcements.test.js「routes 不写 SQL 字面量」断言 | ✅ |
| 2 | 从 ctx 解构固定基座（§15.2） | 读文件 | routes/announcements.js:45（public：path/req/res/q/json/resolveSession）、:83（routes：+logger/readBody/user/requireUser）、:103（admin：+url/requireAdmin） | ✅ |
| 3 | 域特有共享状态按引用传 + 注释「语义共享」 | grep 注释 | server.js:1256-1258、routes/announcements.js:24-25、:41（resolveSession 与 adminBypass/主 user 共享同一请求级 promise） | ✅ |
| 4 | 入口形态按 §15.3 选；返回 true=已处理/false=未命中 | 读文件 + 静态锁 | 三入口 handleAnnouncementsPublic/Routes/Admin；各分支写响应后 return true、末尾 return false（routes/announcements.js:66、97、135、159、169 等） | ✅ |
| 5 | 位置语义不能挪（原位置换入接线） | grep 调用点行号 | server.js:1259（公开段，在 handleAuthPublic:1263 之前）、:1809（主段，handleAuthRoutes:1482 之后、handleWatchlistRoutes:2373 之前）、:4056（管理段，requireAdmin 就绪后原 4086 位置） | ✅ |
| 6 | repository 函数签名与拆分前一致 | 静态锁逐函数正则 | test/announcements.test.js 签名断言 4 条（list/create/update/deleteAnnouncement 与拆分前逐字一致） | ✅ |
| 7 | 域内联 SQL 抽成 repository 新函数 | 对照拆分前 server.js | listAnnouncementReads（原 1261 行内联 select）、filterExistingAnnouncementIds（原 1834 行内联 select）、markAnnouncementsRead（原 1837 行内联 insert）→ announcements-repository.js:65-79 | ✅ |
| 8 | pg.js 顶部 re-export；禁止删除任何已有 re-export | git diff | pg.js:70-80 新增 7 函数 re-export；git diff --numstat pg.js 仅 +16/−38，38 行删除全为旧公告函数定义，既有 app/appeal/auth/watchlist re-export 零删改 | ✅ |
| 9 | 跨域通用 SQL 留 pg.js | grep | DDL announcements/announcement_reads 留 pg.js:315-336；bulkDeleteAnnouncements/bulkSetAnnouncementsActive 留 pg.js（#11 批量分发用）；DDL 判据见本报告「域边界判定」 | ✅ |
| 10 | 外部契约零变化（路径/参数/响应/错误码） | 真跑运行时测试 | test/announcements.test.js 前 3 项运行时测试 7/7 绿；api.test.js 37/37 绿 | ✅ |
| 11 | 静态断言测试指向新文件 + 三条锁 | 读测试文件 | test/announcements.test.js 新增 4 组：路由分支在新文件 / 宿主真实接线 / 旧分支不残留 server.js / repository+re-export 锁 | ✅ |
| 12 | 反向自检：删分支 → 测试必须红 | 实测（删后恢复） | 临时删除 routes/announcements.js DELETE 分支 → 运行时测试 2 与静态锁测试 4 双红（fail 2、exit 1）→ 恢复后 7/7 绿 | ✅ |
| 13 | test:1..4 全绿（commit-own EPERM 除外） | 实测 | test:1 223ok/4notok（仅 commit-own 4 项，spawn EPERM 沙箱限制）、test:2 313ok、test:3 258ok（含本域 7/7）、test:4 235ok | ✅ |
| 14 | api.test.js 全绿 | 实测 | 37/37 绿（163s） | ✅ |
| 15 | frontend:build + scan | 实测 | 默认命令被沙箱拦（configLoader bundling 失败）→ 等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` ✓ built in 1.92s；npm run scan：714 文件，✅ 无凭据 | 🔎（变体，CI 兜底） |
| 16 | 纪律：无新 tag / 不碰部署配置 / 产物不进提交 / 不改共用文档 | git 取证 | git tag 无新增；diff 仅 server.js/pg.js/announcements.test.js + 2 新文件（+ACTIVE-SESSIONS 本地登记不入库）；frontend/dist 未入 status；ARCHITECTURE/TODO/B4-QUEUE 等共用文档零改动（回写由监工统一做） | ✅ |

## 域边界判定（B4 #5 与 #10 的关系，任务书要求写进报告）

1. **盘点**：server.js 里 announcements 相关路由共三处——`GET /api/announcements`（公开段，原 1255）、
   `POST /api/announcements/read`（主段，原 1829）、`/api/admin/announcements` GET/POST 与
   `/api/admin/announcements/:id` PATCH|PUT/DELETE（管理段，原 4086–4134）；另有
   `/api/admin/bulk` 派发表里的 `announcements/delete|activate|deactivate` 三条目与
   `bulkAnnouncement*` 三个包装函数（原 4754–4756、4917–4930）。
2. **判定**：B4-QUEUE #10 行枚举里的「announcements」= 管理段站点公告小节，与 #5 的
   `/api/announcements*`（含管理段）实为**同一批路由**（#10 行只是把 admin 控制台小节按
   枚举法列全）→ 按任务书约定**全部按 #5 拆**：公开 GET + 已读 POST + 管理 CRUD 六个分支
   全部移入 routes/announcements.js；#10 行剩余 smtp/mail/emails/proxies/version 各小节
   不受影响、留在 server.js。
3. **留在 server.js 的边界**：`/api/admin/bulk` 的 announcements 批量操作条目与
   `bulkAnnouncement*` 包装函数走批量分发端点（`/api/admin/bulk` 属 B4 #11 admin 用户批量域），
   按 §15.4 判据「其它域的路由也走」留 server.js；配套 SQL
   `bulkDeleteAnnouncements`/`bulkSetAnnouncementsActive` 留 pg.js。
4. **DDL 判据**：announcements 表被 #11 批量操作（仍在 pg.js 的函数）也读写 → 跨域共用表，
   DDL 留 pg.js（watchlist 先例：无 DDL 搬家）；announcement_reads 与之 FK 耦合、同块定义，
   一并留 pg.js。静态锁（测试第 7 组）已把该边界固化，防后续误搬。

## 打回清单

无。

## 需人工确认

- 条目 15：frontend:build 默认命令在本机沙箱被拦（vite 加载配置的 bundling 阶段失败），
  改用等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` 构建成功；
  默认命令在 CI（docker 构建前端）验证——与 #4 watchlist 域 QA 同口径。
- 条目 13：test:1 里 commit-own.test.js 4 项红为本机沙箱 spawn EPERM 已知环境限制
  （与 #4 watchlist 域 QA 同口径），CI（test-main）兜底验证；其余 223 项全绿。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-20）：自检 16 项 → 16 通过 / 0 缺失 / 0 偏差 / 2 需人工确认（均为本机沙箱
  环境限制，CI 兜底）→ ✅ 放行。反向自检已实测：删路由分支 → 测试红（fail 2）→ 恢复全绿。
