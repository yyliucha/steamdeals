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
| 7 | 杂项（site/steam/ban） | /api/site、/api/steam/*、/api/ban/state | 已拆（QA 放行，待发版） | | 552fb40 |
| 8 | admin 访问安全 | visitors/views/devices/blacklist/whitelist/abuse/reviews | 未拆 | | |
| 9 | admin 同步任务 | sync/heat/backfill/rename/circuit | 未拆 | | |
| 10 | admin 系统设置 | smtp/mail/emails/announcements/proxies/version | 未拆 | | |
| 11 | admin 用户批量 | users/bulk/bulk-ops | 未拆 | | |
| 12 | admin 报表备份日志 | reports/backup/backups/logs/steam-logs | 未拆 | | |
| 13 | admin 图片 | images | 未拆 | | |
| 14 | admin 会话 | sessions | 未拆 | | |
| 15 | admin 游戏目录 | games/stats/merge/links | 未拆 | | |
| 16 | admin 提醒愿望单 | watchlist/wishlists（admin 视角） | 未拆 | | |
| 17 | admin align | /api/admin/align* | 未拆 | | |
| 18 | cli 同步类 | sync/steam-accounts 等命令 | 未拆 | | |
| 19 | cli 报表类 | report/alerts 等命令 | 未拆 | | |
| 20 | cli 运维类 | backfill/images/prune/logs 等命令 | 未拆 | | |
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
