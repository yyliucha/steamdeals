# QA：BM 登录页硬跳 404 + 会话失效跳转口径（第 1 轮）

> 基线 `ac23d00` → HEAD `43063ef`；判据 [SESSION-MANAGEMENT.md](SESSION-MANAGEMENT.md) §8.5 验收；
> 开发描述来源：所有者消息（TODO BM，BM-1 → BM-2 → BM-3 → BM-4）。
>
> 结论：✅ 放行 —— 通过 8 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | BM | 直接打开/刷新 `/login`、`/register`、`/change-password` 返回登录页（不再纯文本 `not found`） | 浏览器地址栏直接开 | ✅ 已交付 | src/server.js:3753（`FRONTEND_PAGES`）；test/serve.test.js:113 |
| 2 | BM | 前台/后台新增页面漏登记进 SPA 白名单时测试直接红（防再犯） | `npm test` | ✅ 已交付 | test/serve.test.js:133 |
| 3 | BM | 会话失效后后台下一次请求自动回登录页（软跳、页面正常渲染、登录后回原页） | 后台任意页触发请求 | ✅ 已交付 | frontend/src/utils/session.js:13（`redirectToLogin`，`router.push` + `next` + `reason`）；5 处调用点见下方逐条 |
| 4 | BM | 后台 5 处 401 行为一致（不再整页导航，源码无 `window.location.href='/login`） | 后台各页 | ✅ 已交付 | AdminModules.vue:331、AdminExtras.vue:118、AdminLogs.vue:213、AnnouncementDrawer.vue:97、UserCreateDrawer.vue:78；test/session-heartbeat.test.js:26 |
| 5 | BM | 登录页显示「登录已过期，请重新登录」（会话失效跳过来时）；直接打开不显示 | 登录页 | ✅ 已交付 | frontend/src/pages/LoginPage.vue:60/80（`reason === 'expired'`） |
| 6 | BM | 挂着后台页不动：≤5 分钟（或切回前台）自动回登录页并提示过期 | 后台页 | ✅ 已交付 | frontend/src/composables/useSessionHeartbeat.js:16/88-96；test/session-heartbeat.test.js:66 |
| 7 | BM | 心跳不误伤：游客不跳、离线/5xx/429 不跳、公开页不探测、全局只一个定时器 | 后台页 | ✅ 已交付 | useSessionHeartbeat.js:36/44/59/62/84-87；test/session-heartbeat.test.js:80 |
| 8 | BM | 部署不再把老会话一次性判空闲过期（登录超过 7 天也不会部署即登出） | 服务端迁移（自动） | ✅ 已交付 | src/store/pg.js:450-454（`last_seen_at = now() where ... is null`） |
| 9 | BM | 主动退出登录不会被心跳误判成"会话失效"跳登录页 | 首页 → 退出登录 | ✅ 已交付 | frontend/src/pages/Home.vue（`markSessionLoggedOut()`）；useSessionHeartbeat.js:41 |

## 逐条核对（规格 §8.5 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | `/login`、`/login?next=…`、`/register`、`/change-password` → 200 + index.html | 真跑 HTTP 测试 | test/serve.test.js BM-1 用例（临时 frontendDir + pglite，逐路径断言 200/text-html/spa-marker，另断言未登记路径 404）；`node test/serve.test.js` 7/7 | ✅ |
| 2 | 白名单一致性测试（router 路径 ⊆ 服务端白名单） | 真跑 + 读实现 | test/serve.test.js:133 解析 router 全部 `path:` 与 `FRONTEND_PAGES` 比对；server.js:3753 导出白名单 | ✅ |
| 3 | 会话失效后后台页 401 → 软跳登录页、正常渲染、带 next | 源码 + 静态断言 | session.js:13-28：`router.push({path:'/login', query:{next, reason}})`（动态 import router 免循环依赖）、`bypassNextGuard()` 先放行未保存提醒；5 处调用点（AdminModules/AdminExtras/AdminLogs/AnnouncementDrawer/UserCreateDrawer）均在 401 分支调用 `redirectToLogin()` | ✅ |
| 4 | 5 处 401 一致；前台首页不变（`/api/me` 不跳）；源码 `window.location.href='/login` 归零 | 静态断言 + 全量扫描 | test/session-heartbeat.test.js：递归扫 frontend/src 全部 `.vue/.js` 断言无硬跳；5 文件逐个断言 import + 调用；Home.vue 仍保留 `res.status===401&&path!=='/api/me'&&path!=='/api/login'`，软跳补 `reason:'expired'` | ✅ |
| 5 | 登录页 `reason=expired` 显示提示；无 reason 不显示 | 源码 + 静态断言 | LoginPage.vue:60（`v-if="expiredHint"`）+ :80（`route.query.reason === 'expired'`）；test/session-heartbeat.test.js 断言文案与条件 | ✅ |
| 6 | 心跳：≤5 分钟 + 切前台；游客不跳；离线/5xx/429 不跳；公开页不探测；单例定时器 | 静态 + 运行时纯函数/探测测试 | useSessionHeartbeat.js：`INTERVAL_MS = 5*60*1000`、`visibilitychange`、`document.hidden` 跳过、`started` 单例；`shouldRedirectFor(wasLoggedIn, loggedIn)` 仅 true→false 为 true；`probeSession` 401/`!res.ok`/fetch catch 全 `return`；`PUBLIC_PATHS` 5 页；test/session-heartbeat.test.js 运行时断言（mock fetch 503/离线/游客）7/7 | ✅ |
| 7 | 迁移幂等：连跑两次无副作用；老库第一次执行一次 | 代码复核 | pg.js:454 `update ... where last_seen_at is null`——首跑后无 null 行，二次执行 0 行；不延长 `expires_at`（同段无 expires 写入） | ✅ |
| 8 | `npm test` / `frontend:build` / `scan` 全绿；新测试进主链 | 重跑 | `npm test` 退出 0（无 not ok）；`node test/api.test.js` 22/22；`frontend:build` 1.98s；`scan` 无凭据；package.json 主链含 `test/serve.test.js` 与 `test/session-heartbeat.test.js` | ✅ |
| 9 | 部署侧复核（直接打开 /login、控制台失效后回登录页、挂 5 分钟自动跳） | 无法本地执行 | 部署人员按规格 §8.5.9 复核 | 🔎 |

## 打回清单

无。

## 需人工确认

- 验收 3/6 的端到端体验（页面是否正常渲染登录页、删会话后 ≤5 分钟/切前台自动回登录页）需**部署后目视**：本地只做 HTTP/静态/运行时断言，无浏览器环境；
- 验收 9 部署侧复核（直接开 `/login`、控制台失效回登录页、挂 5 分钟自动跳并提示过期）。

## 风险提醒（非打回）

- TODO/INDEX 的两处 BM 状态回写发生在另一个会话（BN 需求确认 `ac23d00`）的提交里——内容正确、状态保留，仅提交信息归属不符；本批代码提交为 `43063ef`。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-13）：初检即 ✅ 放行，无打回项。
