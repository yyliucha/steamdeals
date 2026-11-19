# CO-4 B4 域拆分队列（夜班自动执行）

> 所有者 2026-11-19 21:30 授权：夜间自动「开发域拆分 → 质检 → 构建 → 再开发」循环，每轮由定时任务自动新开会话执行。
> 每轮会话无历史上下文，**一切以本文件 + 仓库文档为准**；每轮结束必须更新本文件的进度表。

## 每轮流程（严格按序）

0. `cd F:\dsh\gameprice` → `git -c http.sslBackend=openssl pull --rebase --autostash origin main`；失败停手汇报。
1. 读本文件、`docs/ARCHITECTURE.md` §15（拆分模式）、`src/routes/` 现有域、`docs/ACTIVE-SESSIONS.md`。
2. **若 v2.27.1 尚未发布**（`git tag -l v2.27.1` 空）且 B4/DW 均为「质检通过」→ 本轮先执行「构建 v2.27.1」
   （B4 两域 + DW；2.27.0→2.27.1；按 `steamdeals-build` 全流程；tag 推送；盯 CI 双绿）；完成后更新本文件并结束本轮。
3. 否则从下方队列取**第一个状态为「未拆」的行**（跳过「已拆/跳过/阻塞」）：
   - 按 §15 拆分：`src/routes/<domain>.js`（只 HTTP 编排，不写 SQL）+ `src/store/<domain>-repository.js`
     （签名不变，pg.js 保留 re-export 兼容，通用 SQL 留 pg.js）；上下文注入照 §15；
   - 修该域相关静态断言测试（指新文件，不降断言质量）；契约零变化；
   - `docs/ARCHITECTURE.md` §15 补「本轮域 + 选择理由」。
4. **QA**：加载 `steamdeals-qa` 对该域质检（报告 `docs/QA-CO4-B4-<域>.md`）；打回 → 修复重检；
   通过 → 回写 TODO/INDEX（B4 行状态）。
5. **构建**：版本 = 当前 `package.json` 版本**小版本 +1**（连续递增，禁止跳号）；门禁只打包质检通过条目；
   文档落地（TODO→DONE/INDEX/DELIVERY/类型汇总表）；打 annotated tag 推送；
   盯 CI（docker-hub / docker-tcr / test-main）**双绿**；红 → 修复重试 ≤1 次，仍红则停手汇报并标记该域「阻塞」。
6. 更新本文件（域状态=已拆、提交哈希、版本）→ 注销 ACTIVE-SESSIONS 登记 → 汇报「本轮做了什么 / 版本 / CI / 剩余队列」结束。

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
| 3 | auth | /api/auth/* + login/logout/password/captcha/device | 未拆 | | |
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

- （夜班会话在此追加：阻塞原因、跳过的域、CI 异常等）
