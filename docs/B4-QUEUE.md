# CO-4 B4 域拆分队列（夜班自动执行）

> 所有者 2026-11-19 21:30 授权：夜间自动「开发域拆分 → 质检 → 构建 → 再开发」循环，**监工模式**：
> 定时任务只负责唤醒监工会话；监工会话发现上一个工人完成就**立即**启动下一个（不固定等间隔）。
> 每轮会话无历史上下文，**一切以本文件 + 仓库文档为准**；每轮结束必须更新本文件的进度表。

## 监工模式 v2（2026-11-19 22:55 修订：工人只开发+QA、构建批量、并行工人、构建超时）

1. **唤醒**：定时任务每 4 小时开一个「监工会话」兜底；监工启动先 `git pull`，读本文件 +
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
| 4 | watchlist / wishlist | /api/watchlist、/api/wishlist | 未拆 | | |
| 5 | announcements | /api/announcements* | 未拆 | | |
| 6 | me | /api/me/* | 未拆 | | |
| 7 | 杂项（site/steam/ban） | /api/site、/api/steam/*、/api/ban/state | 未拆 | | |
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
