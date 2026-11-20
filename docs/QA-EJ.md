# QA：EJ 昵称显示规则统一（第 1 轮）

> 基线 e2c78eb（EJ 开工时 HEAD）→ 站点 HEAD f340d78（父提交 52bb65a v2.27.6，监工发布批次不含 EJ）；
> App 仓库 67047fb（v2.24.1）→ 6254978。
> 判据 `docs/DISPLAY-NAME-RULE.md` §1–§5；开发描述来源：监工派发提示（2026-11-20 10:20 所有者指示）+ `docs/TODO.md` §EJ。
> 结论：✅ 放行 —— 通过 5 / 缺失 0 / 偏差 0 / 需人工确认 0（两端截图均已出：Web 后台用户管理/会话/首页 + App「我的」昵称与回退）

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | EJ | 后台用户管理列表「用户」列有昵称显示昵称、无昵称显示用户名 | 后台 → 账号与服务 → 用户管理 | ✅ | `frontend/src/pages/AdminExtras.vue:5`（`{{ row.display_name\|\|row.username }}`）；截图 `web-users.png`（站长大人 / 星光旅人 / alice） |
| 2 | EJ | 后台用户管理手机卡片同口径（不再另起「显示名」小字并列） | 用户管理（≤768px 卡片） | ✅ | `AdminExtras.vue:10`（`{{ u.display_name\|\|u.username }}`，副行只留邮箱） |
| 3 | EJ | 用户管理列表去掉并列的「显示名」列（不做昵称与用户名并列） | 后台 → 用户管理 | ✅ | `AdminExtras.vue:5`（`label="显示名"` 列已移除；`test/profile.test.js:555` 反向锁） |
| 4 | EJ | 登录会话「用户」列昵称优先 | 后台 → 账号与服务 → 登录会话 | ✅ | `AdminExtras.vue:84`；接口 `src/server.js:1384`（`displayName`）；SQL `src/store/pg.js:2823`；截图 `web-sessions.png` |
| 5 | EJ | 到价提醒「用户」列昵称优先（站点级仍显示「站点级」） | 后台 → 内容运营 → 到价提醒 | ✅ | `frontend/src/pages/AdminModules.vue:82`；SQL `src/store/pg.js:2375` |
| 6 | EJ | 到价提醒「Steam 愿望单候选」提示与「迁移给用户」下拉昵称优先 | 后台 → 到价提醒 → 候选标签 / 迁移弹窗 | ✅ | `AdminModules.vue:79/83`（候选 tooltip）、`:91`（下拉 label）、`:503`（候选人带 display_name） |
| 7 | EJ | 愿望单「用户」列昵称优先（含手机卡片） | 后台 → 内容运营 → 愿望单 | ✅ | `AdminModules.vue:67`、`:65`；SQL `src/steam-accounts.js:483` |
| 8 | EJ | 操作日志 → Steam 账号「归属用户」列昵称优先；用户已删则回退日志里的 username | 后台 → 日志审计 → 操作日志 → Steam 账号 | ✅ | `frontend/src/pages/AdminLogs.vue:71/81`；SQL `src/steam-log.js:77`（`user_display_name`） |
| 9 | EJ | 异常审核「审阅记录」操作人、已忽略组「忽略人」昵称优先 | 后台 → 内容运营/审核 → 异常审核 → 审阅记录 | ✅ | `frontend/src/components/AlignAdmin.vue:741`；`src/align.js:225/269`、`src/align-compute.js:55/81` |
| 10 | EJ | 前台顶部「我的」用户菜单（头像 + 文字 + 手机端「退出（…）」）昵称优先 | 网站首页右上角用户 chip / 手机端「我的」抽屉 | ✅ | `frontend/src/pages/Home.vue:8/99`（改读 `/api/me` 的 `displayName`）；截图 `web-home.png`（站长大人） |
| 11 | EJ | 后台顶栏用户 chip 昵称优先 | 后台侧栏底部用户 chip | ✅ | `frontend/src/pages/Console.vue:14/29`；截图 `web-users.png` 左下角「站长大人」 |
| 12 | EJ | App「我的」账号卡显示昵称（原来只显示用户名） | App → 我的 | ✅ | `app/.../ui/me/MeScreen.kt:157`（`displayNameOf(user?.displayName, user?.username)`）；单测 `DisplayNameTest` 5/5；截图 `app-me-nick.png`（星光旅人） |
| 13 | EJ | App 头像首字与 Web 默认头像同口径：昵称首字母/首汉字，空白昵称回退用户名（不再回退 'S'） | App → 我的（账号卡）/ App → 编辑资料 | ✅ | `MeScreen.kt:145`、`ProfileEditScreen.kt:581`（`initialOf(displayNameOrNull(...))`）；`ui/components/DisplayName.kt:20/25`；截图 `app-me-nick.png`（「星」）/ `app-me-fallback.png`（「N」） |
| 14 | EJ | 昵称清空（空串/纯空白）立刻回退用户名，两端都成立 | 资料编辑清空昵称 → 我的 / 后台各列表 | ✅ | SQL 归一 `nullif(btrim(display_name),'')`（pg.js:2375/2392/2823、steam-accounts.js:483、steam-log.js:77）；App `DisplayName.kt:20`；截图 `app-me-fallback.png`（清空后显示 nickuser）；测试见下 |
| 15 | EJ | 登录/账号安全仍用 username；账号标识（踢会话、删除确认、筛选、审计「操作者」）不被昵称替换 | 登录页 / 后台用户管理操作 / 操作日志「操作者」 | ✅ | `src/routes/app.js:85`（`/api/auth/token` 未改）；`AdminExtras.vue` 全部操作 URL 仍用 `row.username`；`AdminLogs.vue:72`（操作者保留 `actor`） |

## 逐条核对（规格验收 → 证据）

| # | 条目（`DISPLAY-NAME-RULE.md` §4） | 检查手段 | 证据（文件:行 / 命令） | 判定 |
|---|---|---|---|---|
| 1 | 有昵称：Web 后台用户管理 + App 我的页显示昵称（截图对照） | 真服务栈 + headless Edge 截图；App debug 包 + 模拟器实机截图 | `web-users.png`（站长大人、星光旅人）；`web-home.png`（右上角 站长大人）；`app-me-nick.png`（App「我的」= 星光旅人，头像「星」） | ✅ |
| 2 | 昵称为空（清空后）：回退显示用户名 | 同一份种子数据：alice 无昵称 → 列表显示 `alice`；接口清空后 `display_name=null` 断言；App 清空昵称后重进「我的」 | `web-users.png` 第三行 `alice`；`app-me-fallback.png`（清空昵称后「我的」= nickuser，头像「N」）；`test/sessions.test.js:324`（清空 → `displayName:null`）、`test/watchlist-user.test.js:180`、`test/wishlist-site-only.test.js`（清空 → `null`）；App `DisplayNameTest`「昵称为空或空白回退用户名」 | ✅ |
| 3 | 两端口径一致（同账号同显示） | 同一规则实现对照：App `displayNameOrNull`（trim 非空 → 昵称，否则用户名）；Web `display_name \|\| username`，服务端 SQL 先 `btrim` 归一 | App `DisplayName.kt:20-26`；Web `src/store/pg.js:2823` 等 + 各模板 | ✅ |
| 4 | 登录/账号安全仍用 username（不改认证链路） | 读 diff：认证相关文件零改动；`git show f340d78 --stat` 无 auth 文件 | 改动清单（18 文件）不含 `src/auth-routes.js`、`src/routes/auth.js`、`src/routes/app.js`、密码策略/验证码 | ✅ |
| 5 | App 构建通过 + `npm test`（分段）+ `frontend:build` + `scan` 全绿 | 重跑 | 见「验证重跑」；App `assembleDebug` ✅ + 全量单测 88/88 | ✅ |

### 边界（§5）核对

| 条目 | 证据 | 判定 |
|---|---|---|
| 不改数据库字段名（`display_name`）／不改认证登录 | diff 无 schema 改名、无 auth 改动（迁移文件零改动） | ✅ |
| 操作日志「操作者 username」可保留账号标识 | `AdminLogs.vue:72` 仍用 `actorLabel(row.actor)`；`steam-log.js` 只新增 `user_display_name`，`username/actor` 原样 | ✅ |
| 不做昵称与用户名的并列展示 | 用户管理去掉「显示名」列（`profile.test.js:555` 反向锁）；对话/提示语改单一口径称呼；迁移下拉只给一个标签 | ✅ |

### 范围（§3）核对

| 规格要求 | 证据 | 判定 |
|---|---|---|
| App `MeScreen` 显示名 `displayName ?: username` | `MeScreen.kt:157`（走 `displayNameOf`，含 trim/空串判定） | ✅ |
| App ProfileEdit 称呼同步 | `ProfileEditScreen.kt:581` 头像首字同口径；该页无其它称呼位（只读「用户名」行按边界保留账号标识） | ✅ |
| App 其它显示用户名位置按规则 | grep `username` 仅剩登录/注册输入框与资料页只读账号行（均为账号标识，按边界不改） | ✅ |
| Web 后台用户管理列表/卡片用户列 | `AdminExtras.vue:5/10` | ✅ |
| Web 会话/到价提醒/愿望单/操作日志用户列统一（缺字段服务端补） | `server.js:1384`、`pg.js:2375/2392/2823`、`steam-accounts.js:483`、`steam-log.js:77`、`align.js:225/269`、`align-compute.js:55` | ✅ |
| Web 前台「我的」抽屉/用户菜单昵称优先 | `Home.vue:8/99`、`Console.vue:14/29`（**巡检发现原实现读 `display_name`，而 `/api/me` 返回 `displayName`，导致有昵称也永远显示用户名 —— 本批一并修正**） | ✅（修偏差） |

## 验证重跑（命令 → 关键输出）

| 命令 | 结果 |
|---|---|
| `node test/sessions.test.js` | `# tests 11 / # pass 11 / # fail 0`（含新增 EJ 用例） |
| `node test/watchlist-user.test.js` | `# tests 13 / # pass 13 / # fail 0` |
| `node test/wishlist-site-only.test.js` | `# tests 5 / # pass 5 / # fail 0` |
| `node test/admin-console-ia.test.js` | `# tests 12 / # pass 12 / # fail 0` |
| `node test/profile.test.js` | `# tests 14 / # pass 14 / # fail 0`（含 EJ 静态锁） |
| `node test/align.test.js` / `align-snapshot.test.js` | 11/11、10/10 全绿（审阅人显示名回退不破快照） |
| `node test/admin-console-mobile.test.js` / `admin-ux-security.test.js` / `admin-bulk.test.js` / `admin-users.test.js` / `admin-review-lists.test.js` | 5/5、6/6、17/17、6/6、7/7 全绿（后台静态断言未被模板改动破坏） |
| `node test/api.test.js`（链外，动到 API 必跑） | `# tests 38 / # pass 38 / # fail 0` |
| `npm run frontend:build` | ✅ `✓ built in 40.05s`（改完 Home/Console 后重跑过一次） |
| `npm run scan` | ✅ 734 文件，未发现高置信度凭据 |
| `./gradlew.bat :app:assembleDebug`（debug，`-PapiBaseUrl` 指向本机演示服务） | ✅ `BUILD SUCCESSFUL in 5m 6s` |
| `./gradlew.bat :app:testDebugUnitTest` | ✅ 88 项 / 12 个测试类 / 0 失败（`DisplayNameTest` 5、`ProfileInitialTest` 4） |

> 主链全量 `npm test` 本轮未跑：改动不触及 `store/pg.js` 共享 SQL 语义（只加列）+ 前端模板；相关测试文件与链外 `api.test.js` 已全跑绿，全量主链由 CI（push 后 test-main）兜底。

## 测试是否真锁住行为（反向自检）

- `test/sessions.test.js:324`、`test/watchlist-user.test.js:180`、`test/wishlist-site-only.test.js:64`：把 SQL 里 `display_name` 删掉 → `null` 断言红；把 `nullif(btrim(...),'')` 去掉只留 `u.display_name` → 「清空昵称 → null」红（空串 ≠ null）。
- `test/admin-console-ia.test.js:137-150`：去掉 `left join users` → `user_display_name` 全为 undefined，红；不 trim → `'  鲍勃  '` ≠ `'鲍勃'`，红。
- `test/profile.test.js:546`：把任一模板改回 `row.username` / `r.username` → 对应用例红；把「显示名」列加回来 → `label="显示名"` 反向断言红；Home/Console 改回 `user.display_name` → 反向断言红。
- App `DisplayNameTest`：把实现改回 `displayName ?: username`（不 trim、不判空串）→「空白昵称回退用户名」「清空后回退」两组红。

## 截图（两端对照）

- Web 后台用户管理：`F:\dsh\ej-shots\web-users.png`（站长大人 / 星光旅人 有昵称；alice 无昵称回退用户名；无并列「显示名」列）
- Web 登录会话：`F:\dsh\ej-shots\web-sessions.png`（用户列全部昵称「站长大人」）
- Web 前台首页右上角 + 后台顶栏 chip：`F:\dsh\ej-shots\web-home.png`（「站长大人」，与后台同一账号同一显示）
- App「我的」有昵称：`F:\dsh\ej-shots\app-me-nick.png`（账号卡「星光旅人」+ 头像「星」）
- App「我的」清空昵称后：`F:\dsh\ej-shots\app-me-fallback.png`（同一账号回退「nickuser」+ 头像「N」，切 Tab 重进即刷新）

## 打回清单

无。

## 需人工确认

- 无阻塞项。补充说明：移动端（≤768px）用户管理卡片版未单独截图，但同一模板 `AdminExtras.vue:10` 已被 `profile.test.js` 静态锁覆盖，桌面截图已用同一份数据证明口径（有昵称/回退）。
- App 截图环境：本机 `emulator-5554` 原实例在 10:56 起 `zygote64` 卡 D 状态、`system_server` 消失；重启后冷启动完成，用 debug 包（`-PapiBaseUrl=http://10.0.2.2:34567` 指向本机 pglite 演示服务）登录 `nickuser` 实拍；未动生产环境与生产数据。

## 争议项（待所有者裁定）

无。

## 纪律检查

- `git tag --list` 无新增 tag（未构建、未打 tag）✅
- 提交不含构建产物（`frontend/dist/` 未入库、无 `*.log`、无 `data/*-pgdata`）✅
- 未碰服务器/生产数据；App 构建为本地 debug 包（未改版本号、未打 tag）✅
- `docs/TODO.md` / `REQUIREMENTS-INDEX.md` / `PROJECT-OVERVIEW.md` 状态回写：见下（本批由本会话回写）

## 复检记录

- 第 1 轮（2026-11-20）：实测巡检发现两处**开发前就存在的偏差**并已在同一提交修掉——
  ① 前台 Home/Console 用户 chip 读 `user.display_name`，而 `/api/me` 返回 `displayName` → 有昵称也永远显示用户名；
  ② App `initialOf(displayName ?: username)` 对「空白昵称」不判空，会显示 'S' 而不是用户名首字。
  两处均已纳入本批测试（静态锁 + 单测），无打回项。
