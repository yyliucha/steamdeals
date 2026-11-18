# QA：申诉系统改造 + 邮件一键信任/封禁（O + BQ，第 1 轮）

> 基线 f04f4b7 → HEAD deecebf（实现提交 7c15e50）；判据 [docs/APPEAL-SYSTEM.md](APPEAL-SYSTEM.md) §8 验收 1–8（O）与 §10.7 验收 9–17（BQ）；开发底稿 [docs/DEV-BRIEF-APPEAL.md](DEV-BRIEF-APPEAL.md) §7（合并版 17 条）。
> 结论：**❌ 打回 —— 通过 16 / 缺失 0 / 偏差 1 / 需人工确认 0**（1 条必修：验收 1 被封用户拿不到图形验证码，站内申诉无法提交）。
> 第 2 轮结论：**✅ 放行 —— 通过 17 / 缺失 0 / 偏差 0 / 需人工确认 4**（打回项已修复确认、新增 diff 无回归、npm test 兜底全绿；需人工确认沿用第 1 轮 4 项）。

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | O | 被封用户站内提交申诉：填邮箱+说明+验证码 → 显示编号 | 封禁页 → 申请解封 → `/appeal` | ⚠️ | 见打回清单 1；`frontend/src/pages/AppealPage.vue:79,83-104,146`；探针：被封 IP `GET /api/captcha` → 403 |
| 2 | O | 申诉入库：`AP-XXXXXX` 编号 + IP/设备/原因/到期快照 + 14 天动作 token | `POST /api/appeal` | ✅ | `src/server.js:944-1022`；`src/store/pg.js:2725`；`test/appeal-system.test.js:99-123` |
| 3 | O | 提交防刷：邮箱必填/格式、说明 10–2000 字、验证码校验、每 IP 3 条/小时、同内容幂等返回原编号 | 同上 | ✅ | `src/server.js:953-985`；`test/appeal-system.test.js:139-188` |
| 4 | O | 管理员通知邮件（收件人=申诉邮箱回退链、From=SMTP、Reply-To=申请人、写发送记录；SMTP 未配不发信但申诉照常入库） | 提交后自动 | ✅ | `src/appeal-mail.js:24-57`；`src/server.js:1013-1021`；`src/appeal.js:4-10`；`test/appeal-system.test.js:113-118,125-137` |
| 5 | O | 后台「申诉管理」：列表（待处理/已处理/全部）+ 待处理角标 + 详情抽屉（内容/指纹/封禁记录/复制回复） | 后台 → 访问与安全 → 申诉管理 | ✅ | `src/server.js:1240-1253`；`frontend/src/components/AppealsAdmin.vue:43-58,115-176`；`frontend/src/pages/Console.vue:9,40-46,61`；`test/appeal-system.test.js:190-222` |
| 6 | O | 处理动作：解封 IP / 解封设备 / 两者 / 拒绝（理由必填）/ 仅备注，联动解封 + 结果回信申请人 + 并发 409 | 详情抽屉 → 处理 | ✅ | `src/server.js:1255-1303`；`src/store/pg.js:2800-2811`；`test/appeal-system.test.js:224-304` |
| 7 | O | 申请人按编号查进度（不回显 IP/指纹/邮箱） | `GET /api/appeal/:code` | ✅ | `src/server.js:1024-1032`；`src/store/pg.js:2759-2763`；`test/appeal-system.test.js:306-320` |
| 8 | BQ | 通知邮件内「信任并解封」「拒绝并保持封禁」两个按钮 → 打开确认页（打开页面零副作用） | 管理员邮箱 → 按钮 → `/appeal/act#t=<token>` | ✅ | `src/appeal-mail.js:9-13,52-54`；`frontend/src/pages/AppealActionPage.vue:51-78`；`test/appeal-system.test.js:360-384` |
| 9 | BQ | 确认页摘要预览（脱敏 IP/邮箱）+ 四态结果（已信任/已拒绝/已处理/链接无效或已过期） | `/appeal/act` | ✅ | `src/server.js:1057-1074`；`AppealActionPage.vue:85-123`；`test/appeal-system.test.js:441-464,494-521` |
| 10 | BQ | 邮件一键信任 → 解封 IP+设备 + 结果邮件申请人；拒绝 → 理由入库（预填默认文案）+ 结果邮件 | 确认页两按钮 | ✅ | `src/server.js:1083-1121`；`src/store/pg.js:2823-2836`；`test/appeal-system.test.js:386-464` |
| 11 | BQ | 一次性/先到先得：重复点链接或与后台并发 → 只生效一次，后到显示「已处理」不重复解封/发信 | 同一链接 / 后台并发 | ✅ | `src/store/pg.js:2823-2836`（`where status='pending'` 抢锁）；`test/appeal-system.test.js:416-435` |
| 12 | BQ | 链接 14 天有效、伪造/篡改 token 统一 404、连续错误 429；处理过再打开显示处理结果与时间 | 过期/错误 token | ✅ | `src/server.js:1038-1081`；`test/appeal-system.test.js:454-460,466-492` |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 被封手机：封禁页 → 申请解封 → 填邮箱+说明+验证码 → 提交成功并显示编号 | 代码全链 + 临时探针实证 | `src/server.js:536`（放行名单无 `/api/captcha`）、`AppealPage.vue:79`（captchaToken 必填）；探针：被封 IP `GET /api/captcha` → **403** | ⚠️（必修，见打回清单 1） |
| 2 | 后台「申诉管理」出现待处理记录，可查看详情 | 接口+页面+测试 | `server.js:1240-1253`、`AppealsAdmin.vue:43-58,147-176`、`test:190-222` | ✅ |
| 3 | 解封 IP → 申请人刷新可正常访问；拒绝 → rejected 且理由必填 | 测试断言真锁（黑名单行删/ip_abuse 清/内存清/blockedBy=null；无理由 400） | `server.js:1282-1303`、`pg.js:2800`、`test:224-252,263-267` | ✅ |
| 4 | 处理结果邮件发申请人（SMTP 可用时）；未配 SMTP 提交仍成功 | 假 SMTP 断言 To/Reply-To/mail_log + 无 SMTP 分支 | `server.js:941-947,1296-1301`、`test:271-275,125-137` | ✅ |
| 5 | 1 小时内第 4 次提交被拒；验证码错误 → 400 | 内存桶+库双保险；测试第 4 次 429 / 坏验证码 400 | `server.js:975-977,969-973`、`test:152-188` | ✅ |
| 6 | 同一 IP 重复相同内容 → 返回已有编号 | 幂等 SQL + 测试 | `pg.js:2739-2748`、`server.js:980-981`、`test:176-184` | ✅ |
| 7 | `npm test` 全绿 + `frontend:build` 通过 + `scan` 干净 | 亲自重跑 | `npm test`：85 个测试文件全绿（appeal-system 16 项全过）；`npm run frontend:build` ✓ built in 1.22s；`npm run scan`：✅ 未发现高置信度凭据 | ✅ |
| 8 | 不自行构建（硬规则 5） | tag 时间线 + diff 审计 | 最新 tag v2.14.0（2026-11-13）早于基线；`git tag --list` 无新增；diff 无 CI/构建配置 | ✅ |
| 9 | 邮件有「信任」「拒绝」两按钮，点开是确认页，页面本身零状态变化 | 模板+确认页+preview 零写库断言 | `appeal-mail.js:52-54`、`AppealActionPage.vue:51-78`、`server.js:1057-1074`、`test:360-384`（preview 后 status=pending、handled_at=null） | ✅ |
| 10 | 确认页「信任」→ resolved、IP+设备解封、申请人可访问、收到结果邮件 | 事务抢锁+解封链+测试断言 | `pg.js:2823`、`server.js:1103-1116`、`test:386-421`（action='both'、黑名单删、device_bans 删、结果邮件） | ✅ |
| 11 | 确认页「拒绝」→ 可填理由 → rejected + 理由入库 + 结果邮件 | 代码+测试（默认文案锁定；自定义理由走同一分支） | `server.js:1091-1094,1100-1121`、`test:441-464` | ✅ |
| 12 | 重复点/与后台同时处理 → 只生效一次，后到显示「已处理」，不重复解封/发信 | 状态机抢锁+409 语义+测试两次断言 | `pg.js:2823-2836`、`server.js:1084-1089,1123-1129`、`test:416-435` | ✅ |
| 13 | 第 15 天打开 → 「链接已过期」；处理过再打开 → 显示处理结果与时间 | 过期 404 统一文案 + preview 返回 handledAt/handledVia | `server.js:1049-1055,1066-1074`、`test:454-460,474-476` | ✅ |
| 14 | 只对链接发 GET（模拟邮件安全扫描）→ 零状态变化 | 无 GET 路由；测试 GET 404 + 状态不变 | `server.js:1038`（POST-only）、`test:509-517` | ✅ |
| 15 | 未配置 SMTP：申诉入库成功、后台可处理、确认页仍可用 | 三处无 SMTP 分支测试 | `test:125-137,224-252,523-537` | ✅ |
| 16 | 篡改/伪造 token → 404 统一文案；连续错误触发 429 | 统一 404「链接无效或已过期」+ 每 IP 10 次/分桶 | `server.js:1042-1055,1062-1063`、`test:466-492` | ✅ |
| 17 | `npm test` 全绿 + `frontend:build` 通过 + `scan` 干净；不自行构建 | 亲自重跑 + tag 审计 | 同验收 7/8 | ✅ |

## 打回清单（按严重度排序，可执行）

- **条目 1（必修，阻断 O 的核心用户流程）**：被封用户拿不到图形验证码 → 站内申诉无法提交。
  - 现象：`frontend/src/pages/AppealPage.vue:79` 无条件要求 `captchaToken` 才能提交；但封禁拦截链只放行 `/appeal` 页、`/api/appeal`、`/api/appeal/action`（`src/server.js:536`、`650`、`661`、`671`），`GET /api/captcha`（`server.js:1307`）对被封 IP 返回 403（IP 黑名单）/403（设备封禁）/429（频率封禁）——三种封禁类型全拦截。
  - 实证（QA 临时探针，不入库）：被封 IP `GET /api/captcha` → **403 访问被拒绝**；`CAPTCHA_ENABLED=0` 时同样 403（前端仍强制验证码）。生产默认验证码开启（`src/captcha.js:77`，无任何环境把 `CAPTCHA_ENABLED` 设 0），缺陷必然触发。
  - 在哪补：① `src/server.js:536` 把 `GET /api/captcha` 加入封禁拦截放行名单（与 `/api/appeal` 同等待遇；验证码一次性 + 提交端 3 条/小时限流兜底，风险可控），或 ② 提供申诉页专用验证码端点并放行。仅修前端（CAPTCHA_ENABLED=0 时跳过验证码）不能覆盖默认开启场景，不推荐单独采用。
  - 测试补锁：`test/appeal-system.test.js` 增「被封 IP 拉验证码 200 + 用真验证码端到端提交成功」用例——现有 16 项全部从非封 IP 发起，未覆盖此链路（本次假绿点）。

## 需人工确认（本地无法验证，部署后看）

- 真机目视：封禁页 → 申诉页表单 → 提交成功显示编号（修复验收 1 后）；确认页四态与移动端单列、按钮 ≥44px（DEV-BRIEF §7-16）。
- 真实 SMTP 送达：管理员邮箱实际收到带两按钮的通知邮件、申请人实际收到结果邮件（假 SMTP 断言已过，真实送达待部署验证）。
- 邮件客户端渲染：inline-CSS 按钮在 163/QQ/Gmail 等客户端实际渲染效果。
- BQ 链接域名：`appealActionUrl` 用服务端 `baseUrl(req)`（`server.js:1015`），部署后反代/域名下链接是否指向正确站点（本地测试无域名）。

## 争议项（待所有者裁定）

- **§10.2「处理成功后置空 action_token_hash」与 §10.7 验收 13「处理过再打开 → 显示处理结果与时间」互相矛盾**：置空后 token 查不到 → 只能 404，无法显示处理结果。实现选择保留 hash（`src/store/pg.js:2823-2836` 注释已说明），执行能力由 `status='pending'` 守卫（旧链接不能再执行、返回 409 已处理）；预览只回脱敏摘要、`canAct=false`，安全影响受控。质检意见：行为符合验收 12/13/16，⚠️ 但规格内部需口径澄清，建议所有者拍板（保留现状 或 规格改「置为不可执行」）。

## 风险提醒（需求外改动 / 规格细则偏差，不判错）

1. `docs/BAN-AND-SECURITY-FIXES.md` §11 状态行在 7c15e50 顺带改为「质检通过」（BR 条目同步，内容与 f04f4b7 的 BR QA 结论一致，非越权）。
2. §10.3「token 连续错误 10 次/小时 → 429」的独立计数器未实现；实际由「每 IP 10 次/分」动作桶兜底（`server.js:1062-1063`）：快速连错 11 次触发 429（验收 16 行为满足），慢速试探（每小时 <10 次/分窗口）不触发。若要求小时级口径需补。
3. §10.6「拒绝理由 5–500 字」下限未强制（仅 500 上限 + trim，空理由走默认文案，`server.js:1091-1094`）；验收 11 不涉及下限，仅记录。
4. trust/reject 并发竞态分支（`pg.js:2823` 0 行 → 409）响应体缺 `handledVia` 字段——极端并发下确认页「已处理」提示可能误显「后台」；仅展示文案，不影响状态机。
5. 邮件通道 reject **自定义**理由路径无专门测试断言（测试只锁了默认文案，`test:441-464`；自定义理由在后台通道有断言）。代码路径存在（`server.js:1091-1094`）。
6. `GET /api/appeal/:code` 对被封 IP 仍 403（未放行）——规格 §3.4 标「可选」且未要求放行，仅记录。
7. `src/notify.js:91-105` `Reply-To` 默认值从 `from` 改为 `replyTo ?? from`——不传 `replyTo` 的既有调用方行为不变，回归风险低（notify 相关测试全绿）。

## 纪律固定检查项（全过）

1. `git tag --list` 无新增 tag（最新 v2.14.0，2026-11-13，早于基线 f04f4b7）。✅
2. diff 未碰服务器/生产配置（无 compose/DEPLOY/凭据改动）。✅
3. `git show --stat 7c15e50` / `deecebf`：仅 docs + src + frontend + test + package.json，无 `frontend/dist`/日志/数据目录进提交。✅
4. 已推 main：`git status -sb` 显示 `## main...origin/main`，`origin/main..HEAD` 为 0 提交。✅
5. `docs/PROJECT-OVERVIEW.md` 已同步 O/BQ 批一行（封禁与申诉区新增「申诉系统 + 邮件一键处理（O/BQ 批）」）。✅

## 复检记录

- 第 1 轮（2026-11-14）：打回 1 条（验收 1 验证码接口未放行封禁拦截）→ 待开发补齐（放行 `/api/captcha` + 补「被封 IP 端到端提交」测试）→ 第 2 轮只重查打回项 + 新增 diff + `npm test` 兜底。
- 第 2 轮（2026-11-14）：第 1 轮打回 1 条 → 开发补齐（修复提交 **0576bc7**）→ 第 2 轮只重查打回项 + 新增 diff（7c15e50..HEAD）+ npm test 兜底 → **✅ 放行**（通过 17 / 缺失 0 / 偏差 0 / 需人工确认 4；功能清单 #1 由 ⚠️ 升 ✅）。
  - 打回项（验收 1）：`src/server.js:545` 新增 `appealExempt` 覆盖 `GET /api/captcha`；设备封禁 / IP 黑名单 / 频率限流三处拦截（`src/server.js:659` / `670` / `680`）统一改判 `!appealExempt`；发码自带每 IP 30 张/分钟限流（`src/server.js:1326` → 429 + retry-after:60）；提交端验证码校验（`src/server.js:966-970`）与每 IP 3 条/小时（`src/server.js:972`）兜底不变。
  - 测试真锁（`test/appeal-system.test.js:541-584`）：黑名单 IP 先断言首页 403（证明该 IP 确在拦截链）→ `GET /api/captcha` 200 → 解析 SVG 4 位答案 → 真验证码端到端提交 200 + 入库（ip/status 断言）；CAPTCHA_ENABLED=0 时被封 IP 拉验证码仍 200、无码提交成功。亲自重跑 `node test/appeal-system.test.js`：**19/19 全绿**（新增 #17/#18/#19，非假绿）。
  - 新增 diff 全量过目（7c15e50..HEAD，4 文件 +112/−17）：打回修复 + 三处规格细则——① token 连续错误 10 次/小时 → 429（`src/server.js:1063` / `1073`，retry-after:3600；合 §10.3，与既有每 IP 10 次/分动作桶并存，均为规格要求）；② 拒绝理由 5–500 字（`src/server.js:1102-1106` 邮件通道 / `src/server.js:1286` 后台通道；合 §10.6；前端 `AppealsAdmin.vue:101`、`AppealActionPage.vue:42` 均回显后端 400 文案，无静默失败）；③ `resetAppealBuckets` 测试钩子（`src/server.js:181`，与 ratelimit.resetState 同一先例）。旧用例 reject 文案改 ≥5 字适配新下限；TODO/INDEX 状态行更新。逐条核过，无回归。
  - npm test 兜底：`npm test`（85 文件 `&&` 链，exit 0 全绿）；`npm run frontend:build` ✓ built in 1.23s；`npm run scan` ✅ 未发现高置信度凭据。
  - 纪律：无新增 tag（最新 v2.14.0，2026-11-13）；0576bc7 仅 4 文件、无部署/服务器配置/构建产物；已推 main（origin/main..HEAD = 0）；PROJECT-OVERVIEW.md 无新增需同步内容（本轮为既有功能行为修复，非新功能）。
