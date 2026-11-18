# QA：CG 原生 Android App（CA-2~4）（第 1 轮）

> 基线 gameprice d831203（docs/TODO+INDEX 状态更新）→ HEAD d831203；App 仓库 `steamdeals-app`
> cd2aaec → 0a07994 → a3dd168（本地 main，暂无 remote）。判据 [APP-NATIVE.md](APP-NATIVE.md) §4/§7 Android 项
> + [APP-API.md](APP-API.md) 契约；开发描述 = docs/TODO.md CG 条目「实现记录/已知限制」。
> 结论：✅ 放行 —— 通过 22 / 缺失 0 / 偏差 0 / 需人工确认 4（均为 CA 站点侧部署项，非 CG 缺陷）

## 功能清单（本批交付的全部功能，一条功能一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | CG | 启动封禁检查：命中黑名单/设备封禁 → 「你已经被封禁」+「已知晓」→ 退出进程（不可取消、无申诉入口） | App 启动 → `GET /api/app/status` | ✅ | AppNav.kt:93-101；走查 63/64/65（MOCK_BANNED 模拟 + pidof 空） |
| 2 | CG | 游客浏览：未登录可用首页/搜索/详情（报价/价格历史/DLC/Steam 外链） | 首页/搜索/详情 | ✅ | DetailScreen.kt:573（Canvas 历史）、554/598（报价/DLC）；走查 01/04/06-08 |
| 3 | CG | 首页筛选（全部/折扣/史低/免费/未发售）与排序（热度/发行时间/价格）+ 加载更多 | 首页 chips/排序/底部加载 | ✅ | HomeScreen.kt:91-113（本地处理，README 已知限制 ①） |
| 4 | CG | 搜索：AppID/名称/英文名、本地历史、结果卡片 | 搜索 Tab → 输入 | ✅ | SearchScreen.kt；走查 04/05（1245620 → 艾尔登法环） |
| 5 | CG | 登录：用户名+密码+图形验证码（可刷新）+ 记住我 30 天；Token 持久化（重启免登录） | 登录页 | ✅ | LoginScreen.kt:81,125；DataStore SessionStore.kt:15；走查 10/11（真实验证码 OCR 登录成功） |
| 6 | CG | 登录门槛：点 感兴趣/不感兴趣/愿望单 → 「登录后才能使用该功能」弹层（去登录/取消）；Token 失效 401 统一弹 | 详情操作条/卡片心形 | ✅ | LoginScreen.kt:292+（LoginRequiredSheet）；ApiException.LoginRequired；走查 09/17/21 |
| 7 | CG | 登录后自动完成刚才的操作一次（pendingAction）：回原页、恢复滚动、执行+Toast、失败不重试不循环 | 登录成功收尾 | ✅ | AppViewModel.kt:94（set/覆盖）、109-144（执行/清空）；走查 22（后端 api.user_flag 日志 + UI ✓感兴趣） |
| 8 | CG | 注册：邮箱验证码流程（表单/60s 倒计时/未开放提示） | 登录页 → 注册 | ✅ | RegisterScreen.kt；走查 71（表单）；邮箱实发依赖站点 SMTP（🔎 见后） |
| 9 | CG | 详情：封面/指标/描述/各区服报价（跨区服徽章）/价格历史原生图表/DLC 列表/Steam 与购买链接 Custom Tabs | 详情页 | ✅ | DetailScreen.kt:573；PriceHistoryChart.kt（Canvas）；Common.kt:161（Custom Tabs）；走查 06-08（OCR 认出图表网格/史低标记/日期轴） |
| 10 | CG | 愿望单：登录后列表（全部/已降价/史低筛选）、移除、空态；游客登录引导 | 愿望单 Tab | ✅ | WishlistScreen.kt；走查 26/30/32（与 web 账号共享，后端 wishlist.added/removed 日志） |
| 11 | CG | 我的：账号信息、通知（公告已读同步账号）、主题（跟随系统/浅/深，同步 prefs）、检查更新、修改密码、关于、退出登录（撤销远端 token） | 我的 Tab | ✅ | MeScreen.kt；AnnouncementsScreen.kt；走查 35-40/67-70（token_revoked 日志；深色背景 #0F1524 采样） |
| 12 | CG | 内置更新-检测：启动+回前台 24h 节流 + 手动检查；发现新版（版本/大小/说明） | 启动/我的→检查更新 | ✅ | UpdateManager.kt:48,63；走查 42/52/57 |
| 13 | CG | 内置更新-策略：可选（稍后/忽略此版本）+ 强制（minVersionCode，仅立即更新、返回键不可取消） | 更新对话框 | ✅ | UpdateManager.kt:73；UpdateDialogHost.kt；走查 45/72/74-76（强制分支实测） |
| 14 | CG | 内置更新-下载：Wi-Fi 默认（移动网络弹二选一）、进度、SHA-256 校验（不匹配拦截）、失败重试 | 更新对话框 | ✅ | AppViewModel.kt（AskNetwork/Downloading/VerifyFailed）；走查 46-48/58/60（错哈希拦截一次 + 正确通过） |
| 15 | CG | 内置更新-安装：系统安装确认（PackageInstaller 会话 + ACTION_VIEW 兜底 + 未知来源引导） | 系统弹窗 | ✅ | UpdateManager.kt:162-190；走查 61/62（系统确认 + App installed） |
| 16 | CG | 同签名覆盖旧 TWA：包名 `cn.yyliucha.steamdeals`、keystore 指纹一致、versionCode 21900>21800 | 安装升级 | ✅ | apksigner SHA-256 `48a30df9…`=旧包；真机 2.18.0(21800) → 2.19.0(21900) 覆盖安装 Success |
| 17 | CG | 网络层契约：全部接口走 `/api/app/*` 命名空间、Bearer + `X-Device-Id`（安装 UUID）、错误映射（401 login_required/403 must_change_password/429 retryAfterSec） | 网络层 | ✅ | SteamDealsApi.kt:18-180；ApiClient.kt:21-44；SessionStore.kt（UUID） |
| 18 | CG | 429 限流不弹窗：按普通错误展示（登录显示 retryAfterSec；列表错误+重试，无封禁 UI） | 各接口错误分支 | ✅ | LoginScreen.kt（429 分支）；HomeScreen.kt（错误+重试） |
| 19 | CG | 独立仓库：App 代码在 `steamdeals-app`（站点仓库不再含新 App 工程；规格/TODO 留站点仓库） | 仓库 | ✅ | 两仓库取证；gameprice diff 仅 docs/TODO+INDEX |
| 20 | CG | 管理界面后置（App 内无黑名单/审核管理界面） | 全局 | ✅ | 走查全部屏无管理入口 |
| 21 | CG | 改密：当前/新/确认密码 → POST /api/user/password（改密后其它会话退出） | 我的→修改密码 | ✅ | ChangePasswordScreen.kt；走查 67（表单）；改密实效依赖 CA 部署（🔎） |
| 22 | CG | 游客浏览不强制登录、无全屏登录墙 | 全局 | ✅ | 走查 01-08（匿名浏览详情/历史/DLC） |

## 逐条核对（规格验收 → 证据）

| # | 条目（APP-NATIVE §7 Android 项） | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | 认证：Token 登录/持久化/撤销/401；限流锁定与 web 一致；验证码必填 | grep + 走查 | SteamDealsApi.kt:40,52；LoginScreen 验证码必填提交；走查 10-11（真实验证码）；服务端限流/日志 = CA 职责 | ✅ |
| 2 | 功能对齐：六屏真机可用、数据与 web 一致 | 模拟器走查 + 后端日志 | 走查 01-76 全序列；数据同后端（pglite 本地库，同 web 接口） | ✅ |
| 3 | 覆盖升级：同包名/同签名/更高 versionCode | apksigner + 真机安装 | 指纹 `48a30df9…` 一致；21800→21900 覆盖 Success | ✅ |
| 4 | App 更新：启动/回前台/手动 → 对话框 → 下载校验 → 系统安装；minVersionCode 强制 | 代码 + 走查 | UpdateManager.kt:63,73；走查 42-62/72-76（含强制分支、返回键不可取消、SHA 拦截） | ✅ |
| 6 | 站点侧：npm test / frontend:build / scan 全绿 | 亲跑 | `npm test` exit 0；`npm run scan` ✅ 无凭据；frontend:build 无需（CG 未动 frontend/） | ✅ |
| 7 | 游客模式：浏览/门槛/自动完成/取消清空/登录引导 | 代码 + 走查 | AppViewModel.kt:94,109-144；LoginRequiredSheet；走查 09/17/21/22/70 | ✅ |
| 8 | 鉴权语义：公开匿名可调；401 login_required 统一弹；无全屏登录墙 | 代码 + 走查 | ApiException.LoginRequired；各屏 catch → onLoginRequired；底部弹层（非全屏） | ✅ |
| 9 | 仓库：App 在独立仓库；规格/TODO 留站点仓库 | git 取证 | steamdeals-app 独立仓库 3 提交；gameprice 仅 docs 2 文件 | ✅ |
| 10 | 启动封禁：对话框 → 已知晓 → 退出；无申诉/管理界面 | 代码 + 走查 | AppNav.kt:93-101；走查 63-65（pidof 空 = 进程退出） | ✅ |
| 11 | App 命名空间：`/api/app/*` 不执行黑名单/设备封禁；status 类型正确 | App 侧代码 + 联调 | SteamDealsApi.kt 全部 /api/app；走查经 dev-proxy 模拟服务端 rewrite；真实服务端豁免待 CA 部署 | ✅（🔎 部署项） |
| 13 | pendingAction：执行一次+Toast/清空不循环/恢复路由滚动/防重复 | 代码 + 走查 | AppViewModel.kt:109-144；走查 22；防重复 = take() 一次性 + loading 防抖 | ✅ |

## 打回清单

无（无 ❌ 缺失 / ⚠️ 行为偏差）。

## 需人工确认（🔎，均属 CA 站点侧或环境项，不阻塞 CG 判定）

1. **`/api/app/*` 前缀重写与服务端黑名单豁免**：契约已冻结（APP-API.md §2），App 全部按契约调用并已用本地 dev-proxy 模拟服务端重写完成全链路联调；真实服务端实现随 CA-1 部署后回归。
2. **`POST /api/games/:appid/interest` 用户级开放**：契约（APP-API.md §4）声明普通用户可操作，当前服务端该路由仍是管理员专用；App 收到 403 自动回退 `/flags`（行为可用）。CA 收尾时需二选一：按契约放开 /interest，或修订契约（App 无需改动）。
3. **注册/改密实效**：App 表单与请求已走通（注册 503 因本地无 SMTP；改密需真实用户会话），上线后按 §7-1/§7-2 用真实账号回归。
4. **首页 filter 参数**：效果图的「未发售」等筛选目前按已加载数据本地处理（README 已知限制 ①）；服务端补 `filter` 参数后替换 `HomeScreenState.applyDisplay`。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-17）：初检一次通过。开发走查中修复 4 处（pendingAction 未写入 holder / 协程作用域取消、`parse<Json>` 崩溃、更新失败重试复用陈旧 sha、封禁确认未结束进程）已计入 0a07994 提交并复验。
