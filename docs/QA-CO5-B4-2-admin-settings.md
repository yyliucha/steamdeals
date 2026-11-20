# QA：admin 系统设置域拆分（CO-5/B4-2 第十轮，第 1 轮）

> 基线 7f32fad → 工作区（未提交，含本域拆分）；判据 docs/ARCHITECTURE.md §15「域路由拆分模式」checklist（§15.1–§15.5）与 docs/B4-QUEUE.md #10 行；开发描述来源：B4 #10 工人会话（worker-admin）。
> 结论：✅ 放行 —— 通过 17 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条功能一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | B4#10 | 后台查看当前版本与更新检查（可强制刷新、可关闭出网） | 后台 Console → `GET /api/admin/version` | ✅ | src/routes/admin-settings.js:63–85；node test/api.test.js 38/38 |
| 2 | B4#10 | 后台查看 SMTP 配置（密码只显示「已设置」，不泄漏明文） | 后台 扩展 → 邮件配置 → `GET /api/admin/smtp` | ✅ | src/routes/admin-settings.js:92–114；test/mail-templates.test.js「SMTP 配置」用例 |
| 3 | B4#10 | 后台保存 SMTP 配置（密码留空保持原值；保存后热加载限流阈值与站点缓存） | 后台 扩展 → 邮件配置 → `POST /api/admin/smtp` | ✅ | src/routes/admin-settings.js:116–144 |
| 4 | B4#10 | 后台发测试邮件验证 SMTP 可用（收件人留空自动发给自己） | 后台 扩展 → 发送测试邮件 → `POST /api/admin/smtp/test` | ✅ | src/routes/admin-settings.js:146–190；e2e 矩阵 mail-real-send 行（CI/发版后跑） |
| 5 | B4#10 | 后台查看验证码/测试邮件发送记录列表 | 后台 日志 → `GET /api/admin/emails` | ✅ | src/routes/admin-settings.js:192–197；test/email-auth.test.js 9/9 |
| 6 | B4#10 | 后台查看 9 类邮件模板与 3 套示例版式 | 后台 扩展 → 邮件模板 → `GET /api/admin/mail/templates` | ✅ | src/routes/admin-settings.js:200–225 |
| 7 | B4#10 | 后台编辑保存邮件模板（启停、主题/正文、未知变量只警告） | 后台 扩展 → 保存模板 → `PUT /api/admin/mail/templates/:event` | ✅ | src/routes/admin-settings.js:265–291 |
| 8 | B4#10 | 后台恢复模板默认 / 预览渲染 / 按模板发测试信（10 秒冷却） | 后台 扩展 → `POST /api/admin/mail/templates/:event/(reset|preview|test)` | ✅ | src/routes/admin-settings.js:227–263 |
| 9 | B4#10 | 后台查看通知类邮件发送记录 | 后台 日志 → `GET /api/admin/mail/log` | ✅ | src/routes/admin-settings.js:293–298 |
| 10 | B4#10 | 后台查看代理池健康状态（地址一律脱敏） | 后台 设置 → 代理检测 → `GET /api/admin/proxies` | ✅ | src/routes/admin-settings.js:301–306；test/proxy-pool.test.js 8/8 |
| 11 | B4#10 | 后台立即检测全部代理（CONNECT 逐条探测并写健康文件） | 后台 设置 → 立即检测 → `POST /api/admin/proxies/probe` | ✅ | src/routes/admin-settings.js:309–321 |
| 12 | B4#10 | 以上全部接口的管理员权限门禁（匿名 401 / 普通用户 403） | 全部 11 条路由 | ✅ | test/mail-templates.test.js「admin-settings 权限」用例 |

## 逐条核对（规格验收 → 证据）

| # | 条目（ARCHITECTURE §15 checklist） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | §15.5-2 盘点域内路由、无其它路由抢占同一 path+method | grep `/api/admin/(smtp|mail|emails|proxies|version)` 全 src | server.js 拆前仅 11 条分支命中（version 1 / smtp 3 / emails 1 / mail 4 / proxies 2）；announcements 已在 #5 拆走；routes/ 与 src 其它模块无同 path+method 分支 | ✅ |
| 2 | §15.1 建 src/routes/<domain>.js：只做 HTTP 编排，不写 SQL 字面量 | 读文件 + 静态锁 | src/routes/admin-settings.js 350 行；test/mail-templates.test.js:182 锁「不写 SQL 字面量」 | ✅ |
| 3 | §15.1 建 src/store/<domain>-repository.js：域专属 SQL、签名照抄、跨域共用留 pg.js | 读文件 + 对比拆前 pg.js | repository 96 行：listMailTemplates/upsertMailTemplate/resetMailTemplate/listMailLog 4 函数签名与拆前一致 + 域内联 SQL 抽 5 新函数（saveSmtpSettings/listEmailCodes/insertTestEmailCode/markEmailCodeSent/markEmailCodeFailed）；insertMailLog 被 account-notify.js ×2 / routes/appeal.js ×1 跨模块共用 → 留 pg.js:2739 | ✅ |
| 4 | §15.1 pg.js re-export 永不允许删除 | 读 pg.js 顶部 | src/store/pg.js:150–168 新增 9 函数 re-export；既有 re-export 全部保留（app-token.test.js 静态锁通过） | ✅ |
| 5 | §15.2 ctx 组装：基座 + 域特有按引用 +「语义共享」注释 | 读 server.js 接线与 routes 头部 | server.js:2432–2449 传 path/req/res/url/q/logger/json/readBody/user/requireAdmin/store/appealEmail/invalidateSiteCache；routes/admin-settings.js:43–57 注释声明 store/appealEmail/invalidateSiteCache 语义共享 | ✅ |
| 6 | §15.3 入口形态选择正确（全部路由在 requireAdmin 之后） | 读 server.js 拆前 11 条分支 | 11 条全部在 requireAdmin 之后的管理段 → 单入口 handleAdminSettingsAdmin；位置取本域最早路由 /api/admin/version 原位置（admin-sync 接线之前、backups 之前） | ✅ |
| 7 | §15.4 中间件留 server.js | 读 diff | /api/admin/settings*（settings-routes.js）与 users 邮箱绑定路由留宿主；mailTestCooldown 只被本域使用随域移入模块级（先例 watchUserFails）；无中间件被误拆 | ✅ |
| 8 | §15.5-6 修静态断言测试指向新文件 + 三条锁 + 反向自检 | 读测试 + 真跑反向自检 | test/mail-templates.test.js 四组静态锁（分支落点/宿主接线/防双实现/repository re-export）+ test/sync-runs.test.js:255,272 与 test/reviews.test.js:952–956 边界锁改指新接线；**反向自检实录**：真删 routes/admin-settings.js 的 proxies GET 分支 → 第 1 组静态锁红（`proxies GET 分支在新文件`）+ 行为锁红（权限用例 401 断言失败），恢复后 17/17 绿 | ✅ |
| 9 | §15.5-7 验证全绿 | 亲自重跑 | 见「验证命令与输出」 | ✅ |
| 10 | 契约零变化（路径/参数/响应/错误码） | 逐分支对照拆前 server.js | 11 条路由逻辑照抄（return json → json+return true 形态转换）；GET smtp 拆前有一条未使用的 rawFrom 死查询（结果不进响应）随搬家删除，响应体不变；emails 列表 limit 由字符串拼接改为 $1 参数化（钳制区间不变）；无外部契约变化 | ✅ |
| 11 | 纪律：无新增 tag / 无构建产物 / 不碰部署配置 / 不改共用文档 | git tag --list、git status、diff 全量过目 | 无新增 tag（最新 v2.27.7 为既有）；frontend/dist 未暂存；diff 仅 server.js/pg.js/三测试文件/两新文件；CHANGELOG/TODO 等由监工统一改 | ✅ |

## 验证命令与输出（本批相关，2026-11-20 15:04–16:13 实跑）

| 命令 | 结果 |
|---|---|
| `node test/mail-templates.test.js` | 17/17 通过（原 9 项 + 本批静态锁 4 + HTTP 行为 6；含反向自检后复跑） |
| `node test/email-auth.test.js` | 9/9 通过（含 /api/admin/emails 管理员读取用例） |
| `node test/sync-runs.test.js` | 9/9 通过（本批改 2 处边界锁后） |
| `node test/proxy-pool.test.js` | 8/8 通过（/api/admin/proxies 权限与脱敏） |
| `node test/version.test.js` | 11/11 通过 |
| `npm run test:1` | commit-own 4 项已知沙箱基线红（spawn EPERM，与拆分前一致）；其余文件全绿；中断后的 serve 12/12、appeal-system 24/24 补跑绿 |
| `npm run test:2` | 全绿（exit 0） |
| `npm run test:3` | reviews.test.js 一处旧边界锁指 smtp 留 server.js → 更新后 31/31 绿；链中断后 18 个文件补跑全绿（exit 0） |
| `npm run test:4` | 全绿（exit 0） |
| `node test/api.test.js` | 38/38 通过（含 /api/admin/version 契约用例） |
| `npm run frontend:build` | 默认命令被本机沙箱拦（vite configLoader spawn EPERM，与 #4–#9 轮同款环境限制）→ 等效变体 `npx vite build --config frontend/vite.config.js --configLoader native` ✓ built in 2.62s（本批前端零改动） |
| `npm run scan` | ✅ 干净（753 文件，无高置信度凭据） |

## 拆分前后行数对比

| 文件 | 变化 |
|---|---|
| src/server.js | −258 / +33（净 −225） |
| src/store/pg.js | −27 / +22（净 −5） |
| src/routes/admin-settings.js | 新 350 行 |
| src/store/admin-settings-repository.js | 新 96 行 |
| test/mail-templates.test.js | +312（静态锁四组 + HTTP 行为 6 用例） |
| test/reviews.test.js / test/sync-runs.test.js | 边界锁改指新接线（+2/−2、+3/−4） |

## 打回清单

（无）

## 需人工确认

- 条目 1：`npm run frontend:build` 默认命令在本机沙箱被拦（vite 配置加载阶段 `spawn EPERM`，与前几轮同款环境限制）；等效变体 `--configLoader native` 构建成功（2.62s）证明前端链完好，本批前端零改动；CI 每次推送以默认命令全量兜底。
- 条目 2：`test/commit-own.test.js` 4 项在本机沙箱必红（spawn EPERM 等），与拆分前基线一致、与本批改动无关；CI 兜底。

## 争议项

（无）

## 复检记录

- 第 1 轮（2026-11-20）：首次检查，17 项核对全部通过、0 打回；反向自检（真删路由分支 → 静态锁与行为锁均红）已做并恢复；✅ 放行。
