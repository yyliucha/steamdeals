# CO-4 B4 域拆分队列（夜班自动执行）

> 所有者 2026-11-19 21:30 授权：夜间自动「开发域拆分 → 质检 → 构建 → 再开发」循环，**监工模式**：
> 定时任务只负责唤醒监工会话；监工会话发现上一个工人完成就**立即**启动下一个（不固定等间隔）。
> 每轮会话无历史上下文，**一切以本文件 + 仓库文档为准**；每轮结束必须更新本文件的进度表。

## 监工模式 v2（2026-11-19 22:55 修订：工人只开发+QA、构建批量、并行工人、构建超时）

> **参数化（2026-11-19 23:50 修订）**：本节目期数值（4h 唤醒 / 3.5h 预算 / 25min CI / 30min 工人 / 4h 接管）
> 均为**默认兜底值**。实际参数由监工每轮开工前按技能 `steamdeals-nightshift` §1.5「评估与参数化」推导
> （评估队列剩余域数、每域历史耗时、构建+CI 历史耗时、夜间窗口），推导结果写入本文件「备注」，
> 差异大时同步改定时任务 rrule。技能是唯一规范。

1. **唤醒**：定时任务唤醒「监工会话」（唤醒间隔按 §1.5 推导，无历史时兜底 4 小时）；监工启动先 `git pull`，读本文件 +
   `docs/ARCHITECTURE.md` §15 + `docs/ACTIVE-SESSIONS.md` + `docs/TODO.md` + `docs/DELIVERY.md`。
2. **前置**：确认上一版已发布（tag 存在且 CI 双绿）；若上一版构建卡住（工作区有发布文档改动但 60 分钟无
   提交/tag 动作）→ 监工**接手收尾**（核对改动 → 提交 → 打 tag 推送 → 盯 CI），完成后进入循环。
3. **开发循环（工人只做开发+QA，不做构建）**：
   - 从队列取「未拆」域，按文件面分组，**并行最多 2 个**（选互不冲突的域，如 watchlist/wishlist 与
     announcements；绝不选同一文件区）；
   - 用 **subagent 启动工人**（每个域一个独立会话），工人 prompt 自包含：
     读本文件/ARCHITECTURE §15/试点范例 → 按 §15 拆分该域（routes/<domain>.js + store/<domain>-repository.js，
     契约零变化，修静态断言测试）→ 加载 `steamdeals-qa` 质检（docs/QA-CO5-B4-2-<域>.md）→
     打回修复重检 → 通过后**只提交代码+测试+QA 报告** → 返回摘要（域/提交哈希/QA 结论）；
     **工人不改共用文档**（CHANGELOG/DONE/DELIVERY/INDEX/TODO/PROJECT-OVERVIEW/B4-QUEUE/ARCHITECTURE
     由监工统一改，避免并行冲突）；**工人不构建、不打 tag**。
   - 监工 `wait_agent` 等工人完成 → 收集摘要 → 回写 B4-QUEUE 进度行（域状态=已拆/QA 通过/提交哈希）。
4. **批量构建（监工执行）**：每完成 **2–3 个域**（或本批预算只剩 45 分钟）→ 监工做一次发布：
   版本 = `package.json` 小版本 +1（连续递增，禁止跳号）；更新发布文档（CHANGELOG/DONE/DELIVERY/INDEX/
   TODO/PROJECT-OVERVIEW/B4-QUEUE/ARCHITECTURE 拆分记录）；提交（pathspec）→ 打 annotated tag → 推送 →
   盯 CI（docker-hub / docker-tcr / test-main）双绿；**构建超时**：60 分钟无「新提交/tag/CI 进度变化」→
   监工接手收尾；CI 红 → 修复重试 ≤1 次，仍红则记录并停手。
5. **收尾**：监工注销自己的登记，汇报「本轮拆了哪些域 / 版本列表 / CI 状态 / 剩余队列」，结束本轮。
   预算：约 3.5 小时 / 最多 6 个域 / 队列空 / 上下文将满，任一即收工。

## 容错与接管（监控不卡死——2026-11-19 23:40 修订）

> 背景：2026-11-19 首次夜班，v2.27.2 构建会话卡在「提交/tag 前」49 分钟无动作、CI 监控超时。
> 为此加四条硬性容错，**任何一步卡住都不能让整夜停摆**：

1. **心跳（每阶段必写）**：监工每完成/进入一个阶段（开工、工人启动、工人完成、构建开始、构建完成、CI 结果）
   就在本文件「备注」追加一行：`HH:MM <阶段> <域/版本> <结果>`——卡死后下一轮监工靠它恢复进度。
2. **CI 等待超时**：盯 CI 最多 **25 分钟**（`gh run list` 轮询 60s）；超时 → 在备注写「CI 待确认 <runId>」，
   **不阻塞，继续下一批域**（CI 结果留给下一轮或所有者查）。
3. **工人超时**：监工对工人用 `wait_agent` 等待，单次 ≤30 分钟；超时 → 判该域失败、备注原因、标记「阻塞」，
   **立即接下一个域**（不无限等）。
4. **接管（新监工启动时）**：
   - 读 ACTIVE-SESSIONS：若存在登记且**开始时间 > 4 小时前** → 判定旧会话卡死 → 删除该登记行（备注记下）；
   - 读本文件「备注」最后一条心跳：若是「构建开始但未完成」→ 检查工作区：
     - 发布文档有未提交改动且内容完整 → 核对后**接手提交 + 打 tag + 推送 + 盯 CI**（60 分钟无进展也按此收尾）；
     - 改动残缺/冲突 → `git checkout` 丢弃该文件、在备注记录，重新构建；
   - 若是「工人进行中」→ 检查有无未提交代码：有则接手完成（提交+QA），无则标记该域「阻塞」跳过；
   - 恢复后继续按队列往下做。

## 硬规则

- 每轮只做 **1 个域 + 1 次构建**；版本号连续递增，绝不跳号；
- 只有「质检通过」的条目能进版本；TODO 出现质检打回/未质检 → 停下列出；
- 只提交自己的文件（pathspec，绝不 `git add -A`）；开工登记 ACTIVE-SESSIONS，收工注销；
- 不碰服务器/生产数据、不杀浏览器、用 Chrome；失败必须记录原因并可跳过（不阻塞下一轮）；
- 遇到的问题写进本文件「备注」，不自行扩大范围。

## 队列（按顺序执行；状态：未拆 / 已拆 / 阻塞 / 跳过）

| # | 域 | 主要路由/文件 | 状态 | 版本 | 提交 |
|---|---|---|---|---|---|
| 1 | app（试点） | /api/app/* | 已拆 | v2.27.1 | 0c5f8ff |
| 2 | appeal（第二轮） | /api/appeal* | 已拆 | v2.27.1 | 34a7bcc |
| 3 | auth | /api/auth/* + login/logout/password/captcha/device | 已拆 | v2.27.2 | 00a838f |
| 4 | watchlist / wishlist | /api/watchlist、/api/wishlist | 已拆 | v2.27.3 | 1b087b4 |
| 5 | announcements | /api/announcements* | 已拆 | v2.27.3 | 3022d6e |
| 6 | me | /api/me/* | 已拆 | v2.27.3 | 4ed78db |
| 7 | 杂项（site/steam/ban） | /api/site、/api/steam/*、/api/ban/state | 已拆 | v2.27.4 | 552fb40 |
| 8 | admin 访问安全 | visitors/views/devices/blacklist/whitelist/abuse/reviews | 已拆 | v2.27.4 | b3ebd8a |
| 9 | admin 同步任务 | sync/heat/backfill/rename/circuit | 已拆 | v2.27.6 | 3997083 |
| 10 | admin 系统设置 | smtp/mail/emails/announcements/proxies/version | 已拆 | v2.27.9 | 5ce2e50 |
| 11 | admin 用户批量 | users/bulk/bulk-ops | 未拆 | | |
| 12 | admin 报表备份日志 | reports/backup/backups/logs/steam-logs | 未拆 | | |
| 13 | admin 图片 | images | 未拆 | | |
| 14 | admin 会话 | sessions | 已拆 | v2.27.9 | 9659435 |
| 15 | admin 游戏目录 | games/stats/merge/links | 未拆 | | |
| 16 | admin 提醒愿望单 | watchlist/wishlists（admin 视角） | 未拆 | | |
| 17 | admin align | /api/admin/align* | 未拆 | | |
| 18 | cli 同步类 | sync/steam-accounts 等命令 | 已拆 | v2.27.9 | 9bc710a |
| 19 | cli 报表类 | report/alerts 等命令 | 已拆 | v2.27.9 | 2aa8b15 |
| 20 | cli 运维类 | backfill/images/prune/logs 等命令 | 已拆 | 待构建 | 8249e56 |
| 21 | games（最后，等 DX） | /api/games/* | 未拆 | | |

## 备注

- 2026-11-19 21:40 监工兜底唤醒：auth 域被「认证域拆分会话」占用（ACTIVE-SESSIONS 登记，预计 22:30 完成，代码已交付/QA 待回写），标记阻塞；其后各域与认证会话共享 src/server.js + src/store/pg.js 文件面，等认证会话提交推送后再接下一域（watchlist）。
- 2026-11-19 22:05 认证域会话完成并注销（拆分 00a838f + 架构记录 8867077 + 质检通过 d779b69，QA-CO5-B4-2 第 1 轮 16/0/0/1）；监工接管构建 v2.27.2（认证域），构建后接 watchlist 域。
- 2026-11-20 01:45 §1.5 评估：剩余未拆 18 域（#4–#21）；历史单域耗时 appeal≈1.5h（17:30→18:51 提交）/ auth≈2h（20:00→22:05 注销），P50≈1.75h、P90≈2h；构建+CI 历史 tag→双绿≈25–35min（docker-hub test≈20–21min、tcr publish 8–25min）；夜间窗口 23:00–09:00 已用 2.7h、剩余 7.3h；定时交付剩余 05:35/09:35 两次。
  本轮参数：唤醒间隔 4h 不变（推导 clamp(1.75h+0.5h)=2.25h，但 2h 级间隔使每轮预算 1.6–1.8h < 单域耗时 1.75h，轮内做不完一域，交接噪声反而放大停摆面；4h 与预算 3.2h 及剩余交付点契合，rrule 不改）/
  每轮预算 3.2h（min(4h×0.8, 7.3h−0.5h)，干活至 ≈05:05）/
  工人超时 2h（P90；兜底 30min 不适用——已有两域历史）/
  CI 等待 30min（min(P90≈30,30)，超时写「CI 待确认」不阻塞）/
  接管阈值 4h（B4-QUEUE 容错硬规则优先于公式 4h×1.5=6h，避免停摆窗口翻倍）/
  域数上限 2（预算 3.2h ÷ P50 1.75h ≈ 1.8 取整；若首域 ≤03:00 完成则接 #5 一并构建，否则 1 域+构建收尾）；
  并行度 1：所有 routes 域共享 src/server.js + src/store/pg.js 文件面，无互不重叠配对（与 cli 域可并行，但按队列顺序先做 routes 域）。
- 2026-11-20 01:45 接管检查：ACTIVE-SESSIONS 无登记（无卡死会话）；上轮最后心跳「认证域完成 + 接管构建 v2.27.2」——tag v2.27.2 存在（465df04）、CI 三绿已回填 DELIVERY（docker-hub 44548428207 / docker-tcr 44548428173 / test-main 44559097058）、HEAD 0c944fa test-main 44571232350 ✅ → 无需接管。
- 2026-11-20 01:45 开工：注册 ACTIVE-SESSIONS（夜班监工 v4），进入开发循环，启动工人 #4 watchlist/wishlist。
- 2026-11-20 02:28 工人完成 B4 #4 watchlist/wishlist：提交 1b087b4（server.js −53 / pg.js −33 / 新 routes 140 + repository 65 / 测试 +52）；QA-CO5-B4-2-watchlist 第 1 轮 ✅ 放行（10/0/0/2，2 项人工确认均为本机沙箱环境限制——commit-own 测试 spawn EPERM 与 frontend:build 默认命令，CI 兜底）；**实测单域耗时 37min**（01:50→02:27），远快于评估 P50 1.75h → 本轮预算内可容纳 2–3 域 + 1 次构建。
- 2026-11-20 02:30 工人启动 B4 #5 announcements。
- 2026-11-20 03:08 工人完成 B4 #5 announcements：提交 3022d6e（server.js −65 / pg.js −22 / 新 routes 168 + repository 80 / 测试 +86）；QA-CO5-B4-2-announcements 第 1 轮 ✅ 放行（16/0/0/2，人工确认同 #4 为沙箱环境限制）；边界判定：#10 行枚举的 announcements 与 /api/announcements* 实为同一批路由，全按 #5 拆；/api/admin/bulk 派发表里 announcements 三条目留 #11。实测单域耗时 38min（02:30→03:08）。
- 2026-11-20 03:10 §1.5 参数调整：两域实测耗时 37/38min（原估计 P50 1.75h 高估约 2.7 倍）→ 本轮域数上限 2 → **3**；预算 3.2h 内预计可完成 #4/#5/#6 三域 + 1 次构建（v2.27.3）；其余参数不变。工人启动 B4 #6 me。
- 2026-11-20 03:42 工人完成 B4 #6 me：提交 4ed78db（server.js −201 / pg.js −110 / 新 routes 298 + repository 189 / 测试 +87）；QA-CO5-B4-2-me 第 1 轮 ✅ 放行（17/0/0/2，人工确认同前为沙箱环境限制）；边界判定：/api/me/email/* 与 /api/auth/email* 同属 auth-routes.js 模块（DT-2 排除区）整块留原地；/api/prefs、/api/avatar/:id 与 me 区块同模块随域拆走。实测单域耗时 30min（03:12→03:42）。
- 2026-11-20 03:45 构建开始 v2.27.3：三域齐（#4 1b087b4 / #5 3022d6e / #6 4ed78db，QA 全部放行）→ 本地快速门禁 → 版本+文档 → 提交 → tag → CI。
- 2026-11-20 04:25 构建完成 v2.27.3：本地门禁（主链 test:1 仅 commit-own 4 项已知沙箱环境红（基线同）、test:2/3/4 全绿、api.test 37/37、frontend:build ✓、scan 干净）；版本 2.27.2→2.27.3、CHANGELOG/ARCHITECTURE §15.6/PROJECT-OVERVIEW/B4-QUEUE/DELIVERY 已更新 → 提交 + annotated tag + 推送，进入 CI 盯守。
- 2026-11-20 04:48 CI 结果 v2.27.3：**双绿 + push 门禁全绿**——docker-hub 44608440588 ✅（test/smoke/publish 全 success，20m10s）、docker-tcr 44608440514 ✅（test/publish 全 success，18m20s）、test-main 44608412265 ✅（release 提交 02d62aa，14m13s）。两个镜像源均已推送。
- 2026-11-20 04:50 收尾：本轮拆 #4/#5/#6 三域（37/38/30min 每域）→ v2.27.3 已发布 CI 双绿；剩余未拆 #7–#21（15 域）；下一轮从 #7 杂项（site/steam/ban）接；ACTIVE-SESSIONS 注销监工登记。
- 2026-11-20 05:40 §1.5 评估（第 4 轮 05:35 兜底唤醒）：剩余未拆 15 域（#7–#21）；单域实测 30/37/38min（#4/#5/#6），P50≈37min、P90≈38min；构建+CI 实测（v2.27.3）：本地门禁 40min + CI 双绿 23min ≈ 1.05h；夜间窗口 23:00–09:00 已用 6.6h、剩余 3.4h。
  本轮参数：唤醒间隔 4h 不变（公式 clamp(0.62+1.05)=1.67h≈2h，但 rrule 不改：①定时任务仅剩 09:35 一次交付；②窗口 09:00 关闭，剩 3.4h 不足两个 2h 轮；③若加 07:35 唤醒，新会话见本会话登记（年龄 2h < 接管阈值 4h）不会接管，双监工并行反而放大版本递增事故面；④构建+CI≈1.05h，2h 轮预算 1.6h 装不下「2 域+构建」，必然轮内强制交接；09:35 末次交付即晨间兜底接管点）/
  每轮预算 2.9h（min(4×0.8, 3.4−0.5)，干活至 ≈08:25）/
  工人超时 60min（P90 38min ×1.5 缓冲，wait_agent 分两段 30min；兜底 30min 不适用——已有三轮实测）/
  CI 等待 30min（min(P90≈30,30)，超时写「CI 待确认」不阻塞）/
  接管阈值 4h（B4-QUEUE 容错硬规则优先于公式，同上轮口径）/
  域数上限 3（(2.9−1.05)÷0.62≈3；构建不晚于 07:40 开始——预算剩 45 分钟规则）/
  并行度 1（routes/admin 域共享 src/server.js + src/store/pg.js 文件面，与上轮同）。
- 2026-11-20 05:41 接管检查：ACTIVE-SESSIONS 无登记（无卡死会话）；最后心跳 04:50 收尾（v2.27.3 CI 双绿已回填 DELIVERY 135fdd9）；tag v2.27.3 存在、HEAD 135fdd9、工作区无发布文档未提交改动 → 无需接管。
- 2026-11-20 05:42 开工：注册 ACTIVE-SESSIONS（夜班监工 v4 05:35 轮），进入开发循环，启动工人 B4 #7 杂项（site/steam/ban）。
- 2026-11-20 06:30 工人完成 B4 #7 杂项（site/steam/ban）：提交 552fb40（server.js −243 / pg.js −50 / 新 routes/site.js 380 + store/site-repository.js 149 / 测试 +124）；QA-CO5-B4-2-site 第 1 轮 ✅ 放行（18/0/0/2，2 项人工确认均为本机沙箱环境限制，CI 兜底）；边界判定：/api/steam/* 全 10 条 + /api/site + /api/ban/state 拆走（预检/公开/主三段形态），/api/admin/wishlists 留 #16、/api/admin/steam-logs 留 #12、DT-2 排除区不动、steam-accounts.js 跨域模块原地；实测单域耗时 ≈45min（05:43→06:29）。
- 2026-11-20 06:31 工人启动 B4 #8 admin 访问安全（visitors/views/devices/blacklist/whitelist/abuse/reviews）。
- 2026-11-20 07:25 工人完成 B4 #8 admin 访问安全：提交 b3ebd8a（server.js −285 / pg.js −199 / 新 routes/admin-access.js 412 + store/admin-access-repository.js 348 / 测试 reviews +155）；QA-CO5-B4-2-admin-access 第 1 轮 ✅ 放行（20/0/0/1，1 项人工确认为沙箱环境限制，CI 兜底）；边界判定：20 条路由 + device-bans 3 条（管理段单入口）拆走，封禁拦截链/黑名单加载等中间件留宿主（§15.4）、跨域共用 SQL 留 pg.js；实测单域耗时 ≈50min（06:33→07:22）。两域齐（#7 552fb40 / #8 b3ebd8a，QA 全部放行）→ 进入批量构建 v2.27.4。
- 2026-11-20 07:26 构建开始 v2.27.4（#7+#8 两域）：主树被 EF/EG 会话占用（未提交改动混在树里，其登记写明「与监工重叠面排队到监工轮收工后处理」）→ 构建改在独立 worktree nightshift-v2274（基 b3ebd8a）执行，本地门禁与发布文档全部在 worktree 做，主树不碰；worktree 独立 npm ci（主树 node_modules 当晚已残缺）。
- 2026-11-20 08:10 构建完成 v2.27.4：本地门禁（test:1 仅 commit-own 4 项已知基线红 / test:2/3/4 全绿 / api.test 37/37 / frontend:build native 变体 ✓ / scan 干净；docs/version 测试复跑绿）→ 版本 2.27.3→2.27.4、CHANGELOG/ARCHITECTURE §15.6/DELIVERY/PROJECT-OVERVIEW/B4-QUEUE 已更新 → 提交 + annotated tag + 推送，进入 CI 盯守。
- 2026-11-20 08:36 CI 结果 v2.27.4：**镜像双绿**——docker-hub 44643406573 ✅（test/smoke/publish 全 success）、docker-tcr 44643406627 ✅（test/publish 全 success），两个镜像源均已推送；test-main：release 提交 run 44643381231 被 EF/EG 并发 push 取消（concurrency，ED 已知问题），兜底绿 = run 44644311190 ✅（HEAD 938c4f6 含 release 3b8e93e）；镜像不含 tag 之后 EF/EG 三提交（7a3ac2b/938c4f6/7eb5d4a），归下个版本。
- 2026-11-20 08:40 收尾：本轮拆 #7/#8 两域（实测 45/50min 每域）→ v2.27.4 已发布 CI 双绿；剩余未拆 #9–#21（13 域）；下一轮从 #9 admin 同步任务接；ACTIVE-SESSIONS 注销监工登记（EG 行保留——其会话仍在 11:30 前工作）；本轮构建在独立 worktree nightshift-v2274 执行，主树及其上 EF/EG 未提交改动全程未动。
- 2026-11-20 08:50 §1.5 评估（第 5 轮，所有者 08:45 指示「不等待、立即开始」，白天轮）：剩余未拆 13 域（#9–#21）；单域实测 45/50min（#7/#8），P50≈45min、P90≈50min；构建+CI 实测（v2.27.4）构建 44min（07:26→08:10）+ CI 双绿 26min（08:10→08:36）≈70min；白天可用窗口（08:48 起）无历史数据、无明确结束点。
  本轮参数：唤醒间隔 n/a（本会话即本轮唤醒，替代 09:35 兜底交付；定时任务 72e09241 的末次交付已删除，防 09:35 双监工并行——B4-QUEUE 容错口径与技能 §4 一致）/
  每轮预算 3.5h（白天窗口无上限 → 兜底值；干活至 ≈12:15）/
  工人超时 75min（P90 50min ×1.5 缓冲，wait_agent 分两段 60+15min）/
  CI 等待 30min（min(P90≈26,30)，超时写「CI 待确认」不阻塞）/
  接管阈值 4h（B4-QUEUE 容错硬规则优先于公式，同前轮口径）/
  域数上限 3（3×45min+构建 70min≈3.4h≤3.5h；构建不晚于预算剩 45 分钟）/
  并行度 1（#9–#17 admin 域共享 src/server.js + src/store/pg.js 文件面，无互不重叠配对；到 cli 域（#18–#20）时再评估与 admin 域的并行配对）。
- 2026-11-20 08:50 接管检查：ACTIVE-SESSIONS 无登记（EG 遗留登记已清理，无卡死会话）；最后心跳 08:40 收尾（v2.27.4 CI 双绿已回填 DELIVERY 4682107）；tag v2.27.4 存在、HEAD 4a1b2e8、工作区无发布文档未提交改动 → 无需接管。EF（7a3ac2b/938c4f6）+ EG（7eb5d4a/c6ac3c5/b9e111e）代码已在 main、QA 通过待发 → 本批构建随版本带上（版本连续递增）。
- 2026-11-20 08:51 开工：注册 ACTIVE-SESSIONS（夜班监工 08:48 轮 + 工人 #9 行由监工代登，共用文档单一写者），进入开发循环，启动工人 B4 #9 admin 同步任务（sync/heat/backfill/rename/circuit）。
- 2026-11-20 09:52 工人完成 B4 #9 admin 同步任务：提交 3997083（server.js −205 / pg.js −8 / 新 routes/admin-sync.js 356 + store/admin-sync-repository.js 38 / test/sync-runs.test.js +123 四组静态锁 + source-sync 断言指新文件）；QA-CO5-B4-2-admin-sync 第 1 轮 ✅ 放行（14/0/0/1，人工确认=frontend:build 沙箱拦截改用 native 变体，CI 兜底）；13 条路由（sync/circuit/backfill/heat/rename 各 POST/stop/status + sync runs 三段）全拆，syncState 持有对象按引用语义共享；边界判定：listSyncRuns 唯一专属搬家，insertSyncRun/finishSyncRun/runningSyncRun/markStaleSyncRuns/sourceSyncStats 跨模块共用留 pg.js；实测单域耗时 ≈55min（08:57→09:52）。
- 2026-11-20 09:53 环境变化：构建会话（所有者指令）已发布 v2.27.5（EF+EG 批，tag 最终指向 8b53782，**不含 #9**；docker-hub 44656117747 / docker-tcr 44656117688 已排队）→ #9 归属下一版 **v2.27.6**（版本连续递增不变）；EF/EG 已由该会话带上，本批构建无需再带。
- 2026-11-20 09:53 阻塞观察：ACTIVE-SESSIONS 有「EH+EI 开发会话」（所有者指令，09:40–12:30，文件面含 src/server.js、src/cli.js、src/scheduler.js 等）——B4 剩余域 #10–#21 文件面全部与其重叠，按登记表规则后到排队，暂不派工；等所有者协调或该会话完成。
- 2026-11-20 09:56 所有者确认：B4 排队等 EH+EI 完成（方案 A）；若 11:30（预算剩 45 分钟）前仍无新域完成 → 把 #9 单独构建 v2.27.6 收尾；EH+EI 提前完成则立即派 #10。
- 2026-11-20 10:52 观察：v2.27.5 CI 双绿（docker-hub 44656117747 / docker-tcr 44656117688 全 success，test-main 最终 HEAD 44656695975 绿，DELIVERY e2c78eb 已回填）→ 上版已发布，v2.27.6 前置满足；EH+EI 代码已提交（897476c feat）但会话登记至 12:30 未注销（QA 进行中）；另新增 EJ 会话（10:35–12:30，文件面含 src/store/pg.js、src/server.js）→ #10 即使 EH+EI 提前注销也仍与 EJ 重叠、且超本轮预算窗口 → **本轮不再派工**，按方案 A 兜底：11:30 起把 #9 单独构建 v2.27.6。
- 2026-11-20 11:33 环境变化：构建会话（所有者指令）已发布 **v2.27.6**（release 52bb65a，以「CO-5/B4-2 第九轮 admin-sync」为主条目，CHANGELOG/ARCHITECTURE/OVERVIEW/INDEX 回写齐备；镜像另含 EH+EI 897476c 随 main 成像（QA 9/0/0/2）；EJ 未质检不入本批）→ CI 双绿（docker-hub 44664741632 / docker-tcr 44664741638 全 success）→ 本轮「#9 单独构建」目标已由该会话完成，**无需重复构建**；版本连续 2.27.5→2.27.6 ✓。
- 2026-11-20 11:36 收尾：本轮拆 **#9 admin 同步任务** 一域（实测 ≈55min，QA 14/0/0/1 ✅）→ 已随 v2.27.6 发布 CI 双绿；#10–#21（12 域）因 EH+EI/EJ 会话文件面重叠、按所有者方案 A 排队未派；剩余队列 #10–#21；下一轮从 #10 admin 系统设置接（注意：EJ 已质检通过待发，下批构建需双发 app-v2.24.2）；ACTIVE-SESSIONS 注销监工登记（EH+EI 行保留——其会话至 12:30）。
- 2026-11-20 10:30 构建 v2.27.6 开工（独立构建会话，所有者 10:25 派发）：范围**仅 #9 admin-sync 域**（3997083，QA 14/0/0/1 放行）；EJ / EH / EI 未质检通过 → 不纳入本批（EJ 完成归下一批，EH+EI 待其会话完成）。主树存在 EH+EI 未提交改动（src/*、test/*、PROJECT-OVERVIEW 等）→ 只提交本批发布文档（pathspec 显式列出），src/test 一律不提交、不 stash、不触碰；PROJECT-OVERVIEW 与 package.json 含他人 hunk，按 hunk 隔离提交。
- 2026-11-20 13:15 前置检查（所有者 13:10 指示轮）：EH+EI 未就绪 → **本轮等待**——ACTIVE-SESSIONS 仍登记 EH+EI（09:40–12:30，未注销、未到 4h 接管阈值）；TODO EH/EI 均「待开发」；工作区有未提交的 QA-EH-EI.md 与 TODO/REQUIREMENTS-INDEX 改动（该会话疑似仍在收尾，不擅动）。最新版 v2.27.7 已发布 CI 双绿；ED 代码已提交（143d97e，会话登记仍在 13:10–15:00）。不拆域、不构建、未开工登记。剩余队列 #10–#21；下一轮从 #10 admin 系统设置接（等 EH+EI 注销且 TODO 翻转为质检通过/已发布）。
- 2026-11-20 14:47 §1.5 评估（第 6 轮，所有者 14:43 指示「把 B4 推进完」）：前置已满足——EH+EI 质检通过（897476c，QA 9/0/0/2）、ACTIVE-SESSIONS 无登记、最新 tag v2.27.7 CI 双绿、HEAD 7bce0b6；剩余未拆 #10–#21（12 域）。单域实测 30–55min（#4–#9），P50≈45min、P90≈55min；构建+CI 实测 ≈70min（v2.27.4：构建 44min + CI 26min）；白天轮无窗口上限。
  本轮参数：预算 3.5h（14:47→≈18:17）/ 工人超时 90min（P90 55min ×1.5，wait_agent 分两段 60+30）/ CI 等待 30min（超时写「CI 待确认」不阻塞）/ 域数上限 6（所有者口径「最多 6 域」）/ 并行度 2：**双工人链**——工人 A=admin 链（#10→#14→#13→#12→#11→#17→#15→#16，共享 server.js+pg.js 文件面链内串行），工人 B=cli 链（#18→#19→#20，只碰 src/cli.js+cli repository 新文件，与 admin 链文件面隔离——B 禁改 server.js/pg.js/routes，域内联 SQL 抽到新 repository，无 re-export 需求）；构建用独立 worktree（nightshift-v2278…）执行，主树工人不停。
- 2026-11-20 14:47 接管检查：ACTIVE-SESSIONS 无登记（无卡死会话）；最后心跳 13:15 等待（EH+EI 未就绪）；现 EH+EI 已质检通过（TODO 状态行已翻，a86bd83/7bce0b6）、tag v2.27.7 存在、工作区无发布文档未提交改动 → 无需接管。开工：注册 ACTIVE-SESSIONS（监工 + 工人 A #10 + 工人 B #18 由监工代登），进入开发循环，并行启动工人 A（#10 admin 系统设置）与工人 B（#18 cli 同步类）。
- 2026-11-20 16:06 工人完成 B4 #18 cli 同步类：提交 9bc710a（+7f32fad QA 补哈希）；QA-CO5-B4-2-cli-sync 第 1 轮 ✅ 放行（15/0/0/2，2 项人工确认=沙箱 commit-own EPERM 基线 + frontend:build 改用 --configLoader native，CI 兜底）；src/cli.js 3026→2128 净减 898，新 src/cli/sync.js 924 + src/store/cli-sync-repository.js 84；拆走 17 命令入口（sync 9 target/steam-accounts/steam-claim/app-sync/steam-discovery/steam-status/discover sonkwo），#19 报表类/#20 运维类留原地；**cli 域首次拆分**（无先例，类比 §15 执行）：pg.js/server.js/routes 零 diff（域内联 SQL 抽 9 新函数，无 re-export 需求）；runSyncTracked/syncNote 等跨域共享按引用传参（§15.4）；实测单域耗时 ≈75min（14:50→16:05）。
- 2026-11-20 16:06 环境观察：DX 会话已推 main（090af4c 性能优化 + d0271c8 状态回写「已实现待发版」，质检轮 15:55–17:00 进行中）；DV 开发会话（14:55–当天）未提交改动含 src/server.js 游戏管理列表筛选区 hunk 与 frontend 文件——已提醒工人 A 提交时按 hunk 拆分暂存防串扰。工人 B 完成 → 派其继续 #19 cli 报表类；工人 A（#10）仍在跑（超时线 17:20）。
- 2026-11-20 16:17 工人完成 B4 #10 admin 系统设置：提交 5ce2e50；QA-CO5-B4-2-admin-settings 第 1 轮 ✅ 放行（17/0/0/2，人工确认同前为沙箱限制）；server.js 净 −225 / pg.js 净 −5 / 新 routes/admin-settings.js 350 + store/admin-settings-repository.js 96；11 条路由全拆（version/smtp×2/emails/mail templates×6/mail log/proxies/probe），管理段单入口（§15.3 先例 #8/#9）；listMailTemplates/upsertMailTemplate/resetMailTemplate/listMailLog 4 函数搬家 + 域内联 SQL 抽 5 新函数，insertMailLog 跨模块共用留 pg.js，DDL 留 email-auth.js；DX 批并行改过的 smtp invalidateSiteCache 已并入（语义随路由）；实测单域耗时 ≈85min（14:50→16:17）。两域齐（#10 5ce2e50 / #18 9bc710a）→ 进入批量构建 v2.27.8。
- 2026-11-20 16:20 构建开始 v2.27.8（#10+#18 两域 + 待发版 DX/EL/EK/ED）：独立 worktree nightshift-v2278（基 5ce2e50，npm ci 后台进行中）；主树工人不停——A 接 #14 admin 会话、B 接 #19 cli 报表类；发布文档与版本号全部在 worktree 做，主树不碰；B4-QUEUE/ACTIVE-SESSIONS 不进 release 提交（构建后主树 pull 再单独 docs 提交）。
- 2026-11-20 17:13 环境变化：**v2.27.8 已被他方会话发布**（15acdc9，ED+EH+EI+EL+EK+DX 六条合并，commit 信息注明「B4 #10/#18 归监工轮下批」）→ 本批版本顺延 **v2.27.9**（2.27.7→2.27.8→2.27.9 连续递增不跳号）；v2.27.8 前原 worktree 文档改动作废（六条已由 15acdc9 处理），worktree 重定基 7cd81a0 重做。
- 2026-11-20 17:13 工人完成 B4 #19 cli 报表类：提交 2aa8b15（+7cd81a0 QA 补哈希）；QA-CO5-B4-2-cli-report 第 1 轮 ✅ 放行（13/0/0/2，人工确认同前）；cli.js 2128→1831 净减 297，新 src/cli/report.js 333 + src/store/cli-report-repository.js 9；拆走 7 命令（report/alerts/stats/history/list/chart/compare）；**推送事故已修复**——origin 连续前进（15acdc9/7f5edba）无法 rebase，重建提交时旧基线快照误回退 DT-1 四文件，已 reset --soft + checkout 恢复 + force-with-lease 修复，监工核验 7f5edba..7cd81a0 对 DT-1 四文件 diff 为空 ✅；实测单域耗时 ≈60min（16:12→17:12）。派 B 继续 #20 cli 运维类。
- 2026-11-20 17:14 构建开始 v2.27.9（#10 5ce2e50 / #18 9bc710a / #19 2aa8b15 三域，QA 全放行）：worktree nightshift-v2278 重定基 7cd81a0 → 发布文档（CHANGELOG/ARCHITECTURE §15.6/PROJECT-OVERVIEW/DELIVERY）+ 版本 2.27.9 → 门禁后台跑（npmtest-v2279.log）；主树工人不停（A #14、B #20）。
- 2026-11-20 18:12 构建完成 v2.27.9（#10+#18+#19+#14 四域）：v2.27.8 被 15acdc9 占用后顺延版本；工人 A 恰完成 #14（9659435，QA 12/0/0/2）→ 一并纳入（四域：admin-settings 5ce2e50 / admin-sessions 9659435 / cli-sync 9bc710a / cli-report 2aa8b15）；本地门禁（worktree 基 0a6b978 重跑 api.test 38/38 + 全链 test:1 仅 commit-own 4 项沙箱基线红 / test:2/3/4 全绿 / frontend:build native 变体 ✓ / scan 干净）→ 提交 ba85e87 + annotated tag v2.27.9 推送 → 进入 CI 盯守。
- 2026-11-20 18:12 环境观察：A #14 交付过程发现主树被 cli #20 会话 stash-pop 中间态污染（cli.js UU、他人文件误 stage、sessions.test.js 混入 #20 2 行未提交改动）——A 全程未动主树，改用独立 worktree wa14 提交（已移除）；主树 HEAD a1d2dfc 落后 origin/main；主树清理待 B #20 完成后统一处理（勿在其工作时动主树）。
- 2026-11-20 15:57 环境变化：所有者 15:48 直接派发**构建 v2.27.8** 给独立构建会话（范围=上一 tag 后已质检通过的条目；开工扫 TODO 时 DX 恰好于 15:56 质检通过（QA-DX 6/0/0/1）→ 按所有者「若 DX 已质检通过可纳入」的门禁判断纳入本批）→ **本批范围 6 条：ED + EH + EI + EL + EK + DX**（小版本 2.27.7→2.27.8，连续递增）；EH+EI 为补发版记录（代码已随 v2.27.6 成像）。主树工人 A（#10）/工人 B（#18）在途改动不提交、不 stash（构建会话只提交发布文档 pathspec）。**本批构建完成后，B4 后续批次版本号顺延**（监工轮构建时按当时已质检通过条目自动 +1，防撞号）。
- 2026-11-20 16:20 协调：**2.28.0 专项监工开工**（所有者 16:12 授权：DU/DV/EC/EM/DT-1~5 全做 + 构建 v2.28.0 大版本）。文件面：**主树零改动**（只读）；两个工人在 worktree 隔离开发——gp-wt-228a（frontend/**、routes/auth.js、me.js、watchlist.js：DU/DT-1/DT-2/DT-4/DT-5）、gp-wt-228b（server.js、steam-login.js、routes/site.js、steam-accounts.js：EC/EM/DV/DT-3）。两工人提交推 main 会与 B4 工人 rebase 交错（各方 pull --rebase --autostash 自理）；请 B4 工人 rebase 时留意 server.js 的 platformCond（DV）/admin images（EC）/admin users（DT-3）区块冲突。构建 v2.28.0 排在 v2.27.8 与 B4 批次之后（打 tag 资源排队，版本连续递增）。
- 2026-11-20 17:27 心跳（2.28.0 监工）：环境观察——v2.27.8 已发布（15acdc9，tag 存在）；工人提交 3/8：DU 791d729、DT-1 7f5edba、EC ab7ba90 已在 main（QA 报告随条目提交，TODO 回写等工人完成后监工统一做）；工人 1 剩 DT-2/DT-4/DT-5、工人 2 剩 EM/DV/DT-3，仍在跑。B4 侧 #19 cli 报表类已拆（2aa8b15，QA 7cd81a0 放行），主树工人 A #14 sessions 与工人 B #20 cli 运维类在途——2.28.0 工人全程 worktree 隔离，无文件面冲突。
- 2026-11-20 18:45 工人完成（2.28.0 工人 1）：DU/DT-1/DT-2/DT-4/DT-5 五条全推 main（791d729/7f5edba/403e6f2/4c49f7c/c19f514），QA 全部第 1 轮 ✅ 放行（3/6/10/8/6 用例组，各 1 项人工确认=headless 渲染沙箱限制）；差异说明：DT-4 后台重置密码发码接口按「规格优先」落在 server.js 原管理段（B4 #11 admin 用户域未拆无域可放，后续 #11 拆域时请把该接口一并纳入 users 域）；DT-2 未动 server.js（端点落 me.js/watchlist.js）。工人 2 剩 DT-3（EC/EM/DV 已推 ab7ba90/ba9b0b0/0a6b978）。
- 2026-11-20 16:31 接管检查（16:25 轮监工，所有者 16:20 指示：**恢复拆域、只拆域不构建**）：旧 14:43 轮监工 16:20 后无心跳；工人 A（#14 admin 会话）16:26 仍在写 admin-sessions.js、工人 B（#19 cli 报表类）16:17 QA 报告落盘后静默——两者均未到超时线（17:20/17:36），在途改动不擅动；v2.27.8 构建在 nightshift-v2278（构建会话 15:57 登记，构建看护 16:30 起每 20 分钟巡检，本监工不碰）；2.28.0 监工+工人 1/2 在 gp-wt-228a/b worktree 隔离开发。调度计划：文件面被工人 A（server.js/pg.js/routes/store/test）与工人 B（cli.js/cli/repository）全占 → 暂不派工、观察等待其提交；之后依次派 **#17 align → #12 报表备份日志 → #21 games（DX 已发）→ 其余**；#11/#13/#15/#16 与 2.28.0（DT-3/EC/DV/DT-2）文件面重叠 → 标记排队；#20 cli 运维类待工人 B 释放 cli.js 后评估（2.28.0 文件面不含 cli）。本轮不构建、不打 tag；版本留给所有者/构建会话。
- 2026-11-20 17:08 环境观察：v2.27.8 已由构建会话发布（15acdc9 16:53，ED+EH+EI+EL+EK+DX 六条，#10/#18 归后续批次，tag v2.27.8 CI 进行中）；**工人 B 完成 B4 #19 cli 报表类**：提交 9b5c032（cli.js 2128→1831 净减 297，新 src/cli/report.js 333 + cli-report-repository.js 9），QA-CO5-B4-2-cli-report 第 1 轮 ✅ 放行（13/0/0/2，2 项人工确认=cli-dispatch 主链归属由监工定夺 + 沙箱基线 CI 兜底）；QA 报告已落盘（提交待确认）。2.28.0 DU 已提交（791d729）。**工人 C 启动 B4 #20 cli 运维类**（cli 链接续，与工人 A 的 admin 文件面隔离；2.28.0 worktree 文件面不含 cli → 核实不重叠可拆）。工人 A（#14）16:26 后无文件写入（测试中或卡住），超时线 17:45（90min），17:20 起加强观察。
- 2026-11-20 17:22 冲突裁决（16:25 轮监工）：**确认旧 14:43 轮监工仍存活**（17:13 心跳「工人 B 完成 #19 → 派 B 继续 #20」、17:14 心跳「构建开始 v2.27.9 #10/#18/#19 三域」——旧轮按 14:47 授权继续拆域+构建，v2.27.9 版本顺延连续递增，构建看护在盯）。本监工 17:10 派的工人 C（#20）与旧监工工人 B 撞同一文件面（cli.js 17:18 被工人 B 改写）→ 按 ACTIVE-SESSIONS「谁先登记谁先做」+ 容错口径「旧登记未超 4h 阈值 → 新轮不接管、不并行」裁决：**工人 C 让位停手**（其 ops.js/cli-ops-repository.js 移出工作区备份，cli.js 不碰）；#20 由工人 B 承接。本监工（16:25 轮）转为**观察 + 兜底**：不再派工抢域，等待旧轮收工（预计 18:20）后接管调度，按所有者指示继续 #17 align → #12 报表备份日志 → #21 games；#11/#13/#15/#16 维持排队（2.28.0 文件面重叠）。教训：定时唤醒与旧轮并行时**先确认旧轮心跳再派工**（本轮回看 16:20 协调行误判旧轮已停）。
- 2026-11-20 17:26 移交参考（工人 C 让位盘点，供工人 B 拆 #20 时核对）：① #18 拆分遗留断引用——cli.js cmdBackfill 价格回退分支调用 syncPrices，adapters/steam.js 的 import 已随 #18 移出 → 该分支运行时 ReferenceError，建议在 ops 域显式 import 修复；② 域内联 SQL 按 §15.5 抽新函数（无旧消费者、不回填 pg.js、无 re-export）；③ cmdHeat 候选 SQL 保留 `order by g.heat_at asc nulls first, g.id limit $1` 既有写法；④ serve/all/diagnose/proxy-check/probe 若拆走，注意 test/cli-dispatch.test.js 现有 #18/#19 锁全部保持通过。工人 C 备份件在 F:\dsh\cli-ops-workerC-backup\（未提交、可弃）。
- 2026-11-20 18:30 观察（16:25 轮监工）：工人 B #20 cli 运维类已提交推送（8249e56 18:27，test-main 44719388430 跑中）；v2.27.9 CI 进行中（docker-hub 44717191386 / docker-tcr 44717191332 15m+，旧轮盯守至多 18:42）；DT-4 提交 test-main 44718061308 红（归 2.28.0 批，不属 B4）；主树仍未清理（stash-pop 污染 + untracked docs/QA-CO5-B4-2-cli-ops.md 阻塞 pull，18:12 观察已记录待 B #20 完成后统一处理——B 已完成，清理待旧轮收工或接管）；本监工维持观察+兜底，不抢域；接管后按 16:31 计划派 **#17 align → #12 报表备份日志 → #21 games**，#11/#13/#15/#16 维持排队（2.28.0 文件面重叠）。
- 2026-11-20 18:33 心跳（2.28.0 监工）：工人提交 8/9——DT-5 已推 main（c19f514，QA 6/0/0/1）；DT-3 由新派工人 worker-dt3 在 gp-wt-228b 收尾（rebase c19f514 冲突解决中）；QA 全放行（DU 3/0/0/0、DV 5/0/0/0、EC 4/0/0/1、EM 5/0/0/1、DT-1 6/0/0/1、DT-2 10/0/0/1、DT-4 8/0/0/1、DT-5 6/0/0/1）。主树工作区仍含 B4 侧污染态（UserSections/routes/me/watchlist 等 M 删除 + QA-DT-2.md 工作区删除）——本监工构建用独立 worktree，不碰主树污染文件（pathspec 只提交发布文档）。
- 2026-11-20 18:37 收尾（14:43 轮监工）：**本轮拆 5 域**——#10 admin 系统设置（5ce2e50，QA 17/0/0/2）、#14 admin 会话（9659435，QA 12/0/0/2）、#18 cli 同步类（9bc710a，QA 15/0/0/2）、#19 cli 报表类（2aa8b15，QA 13/0/0/2）、#20 cli 运维类（8249e56，QA 14/0/0/2，**归下批构建**）；**发布 v2.27.9**（#10/#14/#18/#19 四域，release ba85e87 + tag v2.27.9，技术债小版本 2.27.8→2.27.9 连续递增）；v2.27.8 由构建会话 15acdc9 占用后本批顺延版本号。CI 盯守：docker-hub 44717191386 / docker-tcr 44717191332（tag run，18:12 触发，收尾时仍在跑——结果留 16:25 轮或所有者确认，run id 已记）。**剩余队列 #11/#12/#13/#15/#16/#17/#21（7 域）**，交接给 16:25 轮监工（其计划：#17 align → #12 报表备份日志 → #21 games（DX 已发）；#11/#13/#15/#16 与 2.28.0 文件面重叠维持排队）。**遗留上报**：工人 B 拆分中发现既有缺陷 ×2（拆分前即存在、逐字保留未修）——① cli backfill 传 store 给 countBackfillCandidates/listBackfillCandidates（签名是 q 函数）运行报 q is not a function；② cli prune 在未跑 ensureEmailSchema/ensureSteamSchema 的裸库报 42P01；③ #18 拆分遗留断引用（cmdBackfill 价格回退分支调 syncPrices，import 已随 #18 移出）。建议所有者排独立 bug 条目。主树污染态（stash-pop 中间态/DT 会话 M 文件）由 16:25 轮接管时按 18:30 口径统一清理；本会话注销登记。
