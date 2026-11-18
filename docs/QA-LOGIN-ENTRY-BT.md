# QA：手机端登录入口修复（BT，第 1 轮）

> 基线 501eb87 → HEAD 372b434（实现提交 eba879c；372b434 为 TODO 状态补哈希的文档提交）。
> 判据 [MOBILE-LOGIN-ENTRY-FIX.md](MOBILE-LOGIN-ENTRY-FIX.md) §6 验收 1–8；设计 §4、改动清单 §5。
> 结论：✅ **放行** —— 通过 6 / 缺失 0 / 偏差 0 / 需人工确认 4（验收 1、4、8 整条 + 2/3/6 的真机子项，按规格验收 8 由部署侧复测）。
> 本报告默认未提交（QA 文档不进 git）。

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | BT | 手机「我的」面板点「登录」→ 整页硬跳进入登录页（不再"面板关了没反应"） | 手机首页 → ☰ → 我的面板 → 登录 | ✅ | `frontend/src/pages/Home.vue:78`（`mySheet=false;goLogin()`）→ `Home.vue:138` → `frontend/src/utils/login-entry.js:20-26`（`location.assign('/login?next=…')`） |
| 2 | BT | 桌面「登录」按钮 → 同样硬跳进登录页并带 next | 桌面首页右上角「登录」 | ✅ | `frontend/src/pages/Home.vue:8`（`@click="goLogin"`）→ 同 helper |
| 3 | BT | 未登录点手机底部 Tab（搜索/愿望单路径）→ 进登录页 | 手机底部导航（mNav） | ✅ | `frontend/src/pages/Home.vue:186`（`if(!user.value){goLogin();return;}`，基线已有，链到 openLogin） |
| 4 | BT | 401 会话失效（过期/被踢）→ 硬跳登录页并显示「登录已过期，请重新登录」 | 后台各页 + 前台 request + 5 分钟心跳 | ✅ | `frontend/src/utils/session.js:12-13`（`redirectToLogin` → `openLogin({reason})`）；8 处调用点：`AdminModules.vue:335`、`AdminExtras.vue:118`、`AdminLogs.vue:213`、`AnnouncementDrawer.vue:97`、`UserCreateDrawer.vue:78`、`AppealsAdmin.vue:18`、`Home.vue:206`、`useSessionHeartbeat.js:65/74`；提示 `LoginPage.vue:60/80` |
| 5 | BT | 登录页地址带 next，登录成功回原页；next 只接受站内相对路径（`//evil.com` 回落 `/`） | `/login?next=…` | ✅ | `login-entry.js:10-13`（safeNextPath）+ `LoginPage.vue:106-109/146/161`（safeNext 同口径 + `router.replace`） |
| 6 | BT | 懒加载 chunk 失败自动整页重载目标页一次（同路径每会话一次，防死循环） | 任何懒加载页面（登录页/后台等） | ✅（静态+测试；真机模拟 🔎） | `frontend/src/main.js:80-91`；断言 `test/auth-pages.test.js:95-104` |
| 7 | BT | 登录页按返回键回首页，不卡死、不需连按多次 | 登录页 → 浏览器返回键 | 🔎 | 真机（小米浏览器）目视；规格 §4.4 设计已核对 |
| 8 | BT | 无回归：注册/改密页站内 router-link 正常；登录页视觉与过期提示不变 | `/register` `/change-password` `/login` | ✅（视觉 🔎） | `RegisterPage.vue:34/39`、`ChangePasswordPage.vue:7`（未改动）；`LoginPage.vue` 全文件未改动；`useBackGuard.js` 未改动 |

## 逐条核对（规格 §6 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 真机（小米浏览器）点登录出现登录页（`/login?next=…`）并登录成功 | 静态代码链 + frontend:build；真机目视本地做不了 | `Home.vue:78`→`138`→`login-entry.js:20-26`；`/login` 在白名单 `src/server.js:4232` 且 `test/serve.test.js:107-116` 断言 200 | 🔎（静态链 ✅，真机项转部署侧） |
| 2 | 入口矩阵：桌面/手机面板/未登录 Tab/401 全部进登录页；带 next 登录后回原页 | grep 全调用点 + 打开每个文件 | 桌面 `Home.vue:8`；面板 `Home.vue:78`；Tab `Home.vue:186`；401 ×8（见功能清单 4）；回原页链 `openLogin` 默认 next=当前 URL → `LoginPage.vue:106-109,146,161` | ✅（入口统一）；回原页端到端 🔎 |
| 3 | 懒加载兜底：chunk 失败自动整页重载一次，不无限重试 | 读 main.js + 测试断言；真机模拟 🔎 | `main.js:80-91`（三文案正则 + `sd:chunk-retry:` sessionStorage + `location.assign(to.fullPath)`）；`test/auth-pages.test.js:95-104` | ✅（静态+测试）；真机模拟 🔎 |
| 4 | 返回键：登录页返回回首页不卡死 | 规格 §4.4 设计核对；真机 | 整页跳转保留浮层占位记录，返回回 `/`；本地无法执行 | 🔎 |
| 5 | 安全：next 只接受站内相对路径；不新增对外跳转 | 运行时用例 + 全 diff 查对外跳转 | `test/auth-pages.test.js:88-94`（运行时 import safeNextPath：`/a/b#c` 保留；`//evil.com`、`https://evil.com`、空、null 全回落 `/`）；diff 无新增外链 | ✅ |
| 6 | 不回归：注册/改密 router-link 正常；登录页视觉与 reason=expired 提示不变 | diff 未动这些文件 + 测试断言锁定 | diff 仅 10 文件（见 §5 清单+文档）；`RegisterPage.vue:34/39`、`ChangePasswordPage.vue:7` router-link 原样；`LoginPage.vue:60/80/106-109` 原样；`useBackGuard.js` diff 为空；`test/session-heartbeat.test.js` 锁定 reason=expired 文案与前台 401 | ✅（视觉目视 🔎） |
| 7 | 测试三绿：npm test / frontend:build / scan | 亲自重跑 | `npm test`：85 文件 `&&` 链跑完，末文件 `test/secrets.test.js` `# pass 5 # fail 0`；`npm run frontend:build`：`✓ built in 3.55s`；`npm run scan`：`扫描 461 个文件 ✅ 未发现高置信度凭据` | ✅ |
| 8 | 部署侧复核：线上小米真机按第 1 条复测；桌面登录仍可用 | 部署后人工 | 本地无服务器/真机 | 🔎 |

## 双层核对（规格 §5 改动清单 → 代码）

| 清单项 | 代码 | 结果 |
|---|---|---|
| 新增 `frontend/src/utils/login-entry.js`（openLogin 硬跳 + next 安全 + reason） | 存在，`safeNextPath` + `openLogin`（27 行） | ✅ |
| `Home.vue` goLogin 改 openLogin；按钮/mNav 调用点不变；删 router.push 登录逻辑 | `Home.vue:138`（`goLogin(){openLogin();}`）；调用点 `:8/:78/:186` 不变；`router.push({path:'/login'…})` 已无 | ✅ |
| `session.js` redirectToLogin 改 openLogin({reason})；去动态 import router 与 bypassNextGuard | `session.js:1-13` | ✅ |
| `main.js` 注册 router.onError（§4.3） | `main.js:80-91`（mount 前注册，`main.js:102`） | ✅ |
| 测试：goLogin 不再 router.push；redirectToLogin 走 openLogin；main.js 有 onError+chunk 正则；openLogin 拒 `//` 外链 | `test/auth-pages.test.js:29-31,84-104`、`test/session-heartbeat.test.js:30-61`（含运行时 safeNextPath 用例） | ✅ |

四方一致：前端（login-entry/Home/session/main）✓；测试（auth-pages + session-heartbeat 断言与实现一致，safeNextPath 为运行时用例非纯 grep）✓；文档（MOBILE-LOGIN-ENTRY-FIX 状态、PROJECT-OVERVIEW BT 行、REQUIREMENTS-INDEX BT 行、TODO BT 状态）✓。

## 打回清单

- 无（本地可验项全部通过；🔎 项属真机/部署侧复核，规格验收 8 本身如此设计，不打回）。

## 需人工确认（🔎）

- 验收 1：小米浏览器真机 首页→我的→登录 出现登录页并登录成功（静态链已 ✅，真机目视部署后执行）。
- 验收 2 回原页：带 next 登录成功后回到原页的端到端行为（代码链 safeNext 完整，端到端需真机）。
- 验收 3 真机模拟：chunk 失败（改名/断网）自动整页重载一次不循环。
- 验收 4 返回键：登录页返回回首页不卡死。
- 验收 6 视觉：登录页视觉与「登录已过期」提示目视未变（文件级未改动，目视留部署侧）。
- 验收 8：线上小米浏览器复测 + 桌面登录入口仍可用。

## 风险提醒（查多：需求外改动）

- diff 范围 = 规格 §5 清单 6 项 + 4 份文档同步（规格状态/PROJECT-OVERVIEW/REQUIREMENTS-INDEX/TODO），无需求外代码改动、无部署/服务器配置、无构建产物/日志入库、无新增 tag（`git tag --points-at eba879c` 为空）。
- `main.js` 的 try/catch 包 sessionStorage 是规格 §4.3 示例的等价增强（隐私模式禁用 storage 时仍硬载一次），不算偏差。
- `goLogin()` 不传 next、依赖 openLogin 默认取当前 URL——与旧 `router.push({next:route.fullPath})` 行为等价，不算偏差。
- 观察项（非 BT 引入）：游客底部导航仅「首页/我的」，点「首页」也会经 mNav→goLogin 进登录页——基线 501eb87 已是此行为（`Home.vue:186` 未改动），归移动端规划；BV 已过时被 CA 取代，影响面变小。记录不判错。
- 观察项：`test/session-heartbeat.test.js` 的 `ADMIN_401_FILES` 未含 `components/AppealsAdmin.vue`（它同样走 redirectToLogin）——测试覆盖小缺口，行为不受影响（该文件 401 已统一 `redirectToLogin()`）。记录不判错。

## 争议项（待所有者裁定）

- 无。

## 复检记录

- 第 1 轮（2026-11-16）：基线 501eb87 → HEAD 372b434 全量核对 + 三重跑（npm test 85 文件全绿 / frontend:build / scan）→ ✅ 放行；4 项真机/部署复核转部署侧（验收 1/4/8 与 2/3/6 的真机子项）。
- 质检期间并发更新（其他会话，文档提交 e152bed / f839e0a / 3d71de8）：f839e0a 给 BT 规格补「CA 后续注记」（手机前台此后只给 `/app` 下载页，该入口在手机前台不再使用；桌面入口无竞态，硬跳兜底保留）——§4/§5/§6 验收未变，实现 `eba879c` 保留，本轮判定不受影响。
- 状态回写：docs/TODO.md BT 状态行与 docs/REQUIREMENTS-INDEX.md BT 行已改为「质检通过」（未提交，按要求）；若后续其他会话整文件覆盖，请收尾复盘按 HANDOVER §10 复核。

