# 安卓端打磨：页面衔接状态保留 + 公告未读角标（DY / DZ，待开发）

> 状态：**已确认待开发（2026-11-19 所有者沟通，Android 端）**。
> 仓库：App `F:\dsh\steamdeals-app`（站点无改动）。
> 关联：`ui/AppNav.kt`（路由/tab）、`ui/search/SearchScreen.kt`、`ui/home/HomeScreen.kt`、
> `ui/notifications/Announcements*.kt`、`docs/APP-NATIVE.md`。

## DY. 🐞 缺陷：详情返回后页面状态丢失（搜索结果/滚动/表单）

- **根因（代码证据 2026-11-19）**：10 个 Screen 全部用 `remember`、**0 处 `rememberSaveable`**；
  Compose Navigation 从列表页跳到详情时列表页离开组合（dispose），`remember` 状态销毁 → 返回时重建为空：
  - `SearchScreen.kt:66-71` keyword/submitted/results/total 全是 `remember` → **从详情返回变空白搜索页**（所有者报的主问题）；
  - `HomeScreen.kt` `rememberLazyListState()` → 返回后滚动位置丢失；
  - Wishlist/Me/ProfileEdit/ChangePassword/Register 同理（表单输入、滚动全丢）；
  - Tab 切换已有 `saveState/restoreState`（`AppNav.kt:124-132`）✅ 无需改。
- **目标**：从任意子页面返回后，页面保持离开时的状态；旋转屏幕/进程重建也不丢。
- **方案**：
  1. **搜索状态提升到 ViewModel**（新增 `SearchViewModel` 或 AppViewModel 扩展）：keyword/submitted/
     results/total/加载态 + 滚动位置；返回后恢复，下拉刷新可重置；
  2. **Home**：`rememberLazyListState` → `rememberSaveable(saver = LazyListState.Saver)`；
     筛选/排序状态提升 ViewModel（保持离开时选中项）；
  3. **Wishlist / Me**：滚动位置 `rememberSaveable`；
  4. **表单页**（Register / ChangePassword / ProfileEdit）：输入字段 `rememberSaveable`（防旋转/返回丢输入；
     密码类字段按安全惯例不落 saveable 时在规格实现说明中注明）；
  5. **App 端规范**：在 `docs/ARCHITECTURE.md` 新增「Android 导航状态保存规范」一节（状态提升/rememberSaveable/
     何时用 remember），后续页面照此写。
- **验收**：
  1. 搜索「赛博朋克」→ 进详情 → 返回 → 搜索词与结果列表仍在，滚动位置保留（截图对照）；
  2. 首页滚到第 N 条 → 详情 → 返回 → 位置与筛选不变；
  3. Wishlist/Me 滚动位置保留；
  4. 注册/改密/资料表单输入在旋转（模拟器旋转）后不丢；
  5. 10 个 Screen 无未保存的 `remember` 状态（grep 断言：Screen 里的状态均 rememberSaveable/ViewModel）；
  6. App 构建通过 + 模拟器逐项验证（截图留档）；`npm run scan` 不受影响（站点零改动）。
- **边界**：不改导航栈结构/tab 逻辑、不做状态持久化（跨进程冷启动不要求）、不改站点。

## DZ. ⚙️ 调整：公告未读角标无法清除（每次进首页都显示「1」）

- **现象（2026-11-19 所有者截图）**：首页右上角铃铛常驻红点「1」；点开公告弹层后角标仍在——
  「每次进来都会提示，哪怕无法修改状态」。
- **根因（代码证据）**：角标 = `unreadCount`（未读公告数，`HomeScreen.kt:219/253`）；
  只有点开某条公告**详情**才 `markRead(id)`（`AnnouncementsOverlay.kt:104-105`），
  **打开列表不标已读、没有「全部已读」按钮** → 只要不逐条点开，角标永远挂着。
- **方案**：
  1. 公告弹层加「**全部已读**」按钮：调用批量标记（服务端已有 `markAnnouncementsRead(list)`；
     游客写本地 DataStore）→ 角标立即消失；
  2. 保留「点开详情单条标已读」；**不**在打开列表时自动全标（避免没看就清空）；
  3. 全部已读后下拉刷新/重进首页/重启 App 角标不回来；
  4. 游客/登录口径：游客本地已读、登录服务端已读；登录时合并游客已读（已有 `mergeLocalReadsToServer`）需验证；
  5. 弹层内显示「未读 N 条」与操作反馈（toast「已全部标记为已读」）。
- **验收**：
  1. 未读 > 0 时首页角标显示；点铃铛 → 弹层「全部已读」→ 角标立即消失；
  2. 下拉刷新、退出重进首页、重启 App 后角标不回来（模拟器验证截图）；
  3. 单条详情已读仍生效（角标递减）；
  4. 游客已读 → 登录 → 服务端已读合并、角标正确；
  5. App 构建通过。
- **边界**：不改公告内容/发布流程/站点公告接口（批量已读接口已存在，缺失则复用之）。

## 依赖与执行

| 条目 | 依赖 | 说明 |
|---|---|---|
| DY | 无 | 可先做（状态治理） |
| DZ | 无 | 可并行（公告弹层，文件面不同） |
| 两者 | 涉及 App 仓库 | 构建时按 `steamdeals-app-build` 发 App 版（站点无改动） |

## EA. 安卓体验包（攒批，先立项不开发——2026-11-19 所有者要求）

> 所有者要求：**先只立项攒需求，等功能多了再一起开工**；开发时按子项逐个提交、可一次构建发版。
> 以下子项均为「体验优化」，每项独立验收；开工时按优先级排序（EA-1 优先）。

| 子项 | 内容 | 范围/验收草案 |
|---|---|---|
| **EA-1** | **下拉刷新** | 首页/搜索/愿望单/详情接 Material3 `PullToRefresh`，复用各页现有 refresh 逻辑；验收：下拉后列表刷新、加载态正确、不重复请求 |
| **EA-2** | **搜索空态优化** | `SearchScreen` 空态从通用「暂无数据」改为「没找到「xx」——试试别的关键词 / 拼音（如 xdlc）/ 英文名」，带清空重试；验收：搜不存在词显示引导文案；历史词可一键重搜 |
| **EA-3** | 详情页分享 | 详情页加「分享」（系统分享：名称 + 站点链接）；验收：分享面板出现、链接可打开 |
| **EA-4** | 我的页版本号 + 清缓存 | 「我的」显示当前版本号（versionName）与「清除图片缓存」（仅清图片缓存，不动登录态）；验收：版本号与 build.gradle 一致；清缓存后图片重新加载、登录态不变 |
| **EA-5** | 详情页骨架屏 | 加载中的 loading 圈换骨架屏（标题/图片/价格占位）；验收：慢网下骨架平滑、无闪烁 |
| **EA-6** | 全局弱网提示 | 网络不可用/超时时统一提示条（可重试），不阻塞页面；验收：断网操作显示统一提示、恢复后重试成功 |

- **开工条件**：所有者说「开始安卓体验包」；按 EA-1→EA-2→… 顺序或所有者指定子集开发；
- **不改**：系统通知/推送、完整离线缓存、热门搜索（另议）。

## EB. 安卓 18R 内容选项（攒批，先立项不开发——2026-11-19 所有者要求）

> 所有者需求：**手机端能查到 18R 游戏，增加这个选项**。已确认口径 4 项；服务端零改动（`adult` 参数已支持）。

**三源核对（2026-11-19）**：
| 源 | 结果 |
|---|---|
| 已有功能 | ✅ 站点 `/api/games` 已支持 `adult=hide/badge/show`（`server.js:1898`）；`/api/site` 返回 `adultDisplay` 策略 |
| 待办 | ❌ 无相关条目 |
| 开发中 | ❌ 无 |

**已确认口径**：
1. **入口**：首页/搜索页筛选 chips 加「**18R**」chip（与 全部/折扣/史低/免费/未发售 并列）；
2. **行为**：开启 → `adult=badge`（显示 18R 游戏 + 卡片带「18+」角标）；关闭 → `adult=hide`（隐藏）；
3. **年龄确认**：首次开启弹「确认已满 18 岁？」确认框，确认后记忆不再弹；
4. **默认与持久化**：默认关闭；选择存本地 DataStore（重启/重进保留）。

**范围**：
- `HomeScreen` / `SearchScreen` 筛选区加「18R」chip（状态与其他筛选 chips 并列）；
- 首次开启：AlertDialog 确认（未确认不切换）；确认后写 DataStore；
- 列表卡片：`adult_flag` 为 true 的游戏显示「18+」角标（与成熟内容角标样式区分）；
- 请求参数：`adult=badge`（开）/`adult=hide`（关）——透传到 `/api/games`；
- 站点零改动；随 App 构建发版（`steamdeals-app-build`）。

**验收**：
1. 默认（关闭）与现网一致：18R 游戏不出现在列表/搜索；
2. 点「18R」→ 首次确认 18+ → 列表/搜索出现 18R 游戏且卡片带 18+ 角标；
3. 再点关闭 → 恢复隐藏；重启 App 后保留上次选择；
4. 18R 游戏可正常进详情（详情接口不受 adult 过滤影响，需在实现中复核）；
5. 模拟器截图对照（隐藏态/显示态/确认弹窗）；
6. App 构建通过。

## DY/DZ 实现说明（2026-11-19 开发会话，随 app-v2.23.0 发布）

### DY 实现与安全例外

- **状态提升（AppViewModel 扩展）**：`vm.searchState`（搜索词/结果/总数/分页/加载/错误 + 滚动镜像）、
  `vm.homeState`（首页数据/筛选/排序）、`vm.wishlistState`（愿望单数据/筛选）、`vm.profileState`
  （资料表单，含脏标记）——跨导航往返、切 Tab、旋转全部保留；账号切换（登录/退出）时
  `resetForSessionChange()` / `reset()` 复位，避免闪现上一账号数据。
- **详情页**：`DetailScreenState` 转返回栈级 `viewModel(key = "detail-<appid>")`，旋转不重拉、
  返回栈弹出自动清理。
- **滚动位置**：Home/Search/Wishlist/Detail 的 LazyColumn 用
  `rememberSaveable(saver = LazyListState.Saver)`；Me/Login/Register/ChangePassword/ProfileEdit
  的表单滚动与首页 chips 行用 `rememberSaveable(saver = ScrollState.Saver)`。
- **表单输入**：用户名/邮箱/昵称/简介等非敏感字段 `rememberSaveable`；
  **密码类字段（密码/确认密码）与一次性验证码（图形/邮箱验证码）按安全惯例不落 saveable**
  （不入系统保存状态，避免明文/令牌进 saved instance state）——旋转后需重输属预期行为，
  代码注释已写明；loading/error/countdown/验证码图片对象保持 `remember`（瞬时）。
- **grep 断言（规格 §DY 验收 5）**：
  `Select-String -Path app\src\main\java\cn\yyliucha\steamdeals\ui\{home,search,wishlist,me,detail,login,register,password,profile,about}\*.kt -Pattern "remember \{|rememberLazyListState\(\)|rememberScrollState\(\)"`——
  残留白名单（均为已注明理由的安全例外/瞬时/非状态）：Login/Register/ChangePassword 的密码与
  验证码字段、loading/error/countdown/captcha 等瞬时态、SearchScreen 的 FocusRequester（非状态对象）、
  LoginScreen 的 `LoginRequiredSheet` 弹层 pending（非 Screen 弹层瞬时态）、ProfileEditScreen 的
  `EmailChangeSheet` 底部弹层滚动（弹层内瞬时，非 Screen 主体）、AnnouncementsOverlay 的
  `selectedId`（弹层内瞬时，非 Screen）；其余 Screen 状态一律 rememberSaveable / ViewModel。
- **不改**：导航栈结构、Tab 切换逻辑（saveState/restoreState 保持原样）。

### DZ 实现与口径

- **「全部已读」按钮**：公告弹层头部（列表态，未读 > 0 时显示），旁挂「未读 N 条」计数；
  点击 → `AnnouncementsState.markAllRead()`：当前 active 未读一次批量上报（登录 →
  `POST /api/app/announcements/read`；游客 → 本地 DataStore `readAnnouncementIds`）→
  内存 readIds 先更新 → 角标立即消失，并 toast「已全部标记为已读」。
- **保留单条已读**：点开详情仍 `markRead(id)`；**不在打开列表时自动全标**（避免没看就清空）。
- **防角标回跳**：`markInFlight` 闩——标记在途期间 `refresh()` 不覆盖内存已读，规避
  「全部已读后立即下拉刷新」在异步写入落盘/服务端返回前被旧口径覆盖的竞态；写入完成后
  刷新/重进/重启由持久化口径兜底不复现。
- **游客 ↔ 登录**：游客本地已读在登录后由既有 `mergeLocalReadsToServer()` 合并（DC 批已有，
  本轮验证）；批量已读同样双口径（游客本地、登录服务端）。
- **不改**：公告内容/发布流程/站点接口（批量已读接口复用既有 `/api/app/announcements/read`）。

## EA / EB 实现说明（2026-11-19/20 开发会话，随 app-v2.23.0 发布）

### EA-1 下拉刷新

- 首页/搜索/愿望单/详情四个页面接 Material3 `PullToRefreshBox`，复用各页既有 refresh：
  - 首页/愿望单：`isRefreshing = loading && 列表非空`，`onRefresh = 非加载中才 refresh()`；
  - 搜索：已提交时重搜当前词（未提交下拉无效，保持历史页）；详情：重拉详情 + DLC 第一页。
- 初始加载（空列表）仍走全屏 LoadingBox；`onRefresh` 只在非加载中触发，**不重复请求**。

### EA-2 搜索空态优化

- 无结果空态：引导文案「没找到「xx」\n试试别的关键词、拼音（如 xdlc）或英文名」+
  「重试」（同词重搜）+「清空搜索」（`SearchScreenState.resetQuery()` 回历史关键词页）；
- 历史词一键重搜沿用既有 chips（DC/既有逻辑保留）。

### EA-3 详情页分享

- 详情 TopAppBar 右侧「分享」→ 系统 `ACTION_SEND` chooser：文本
  「《游戏名》SteamDeals 比价 <站点链接>」，链接用 `{API_BASE}/?q=<URL编码游戏名>` 直达站点搜索结果页
  （站点游戏详情是弹层、无独立路由，故分享搜索直达链接）；`Common.shareGame()` 统一实现。

### EA-4 我的页版本号 + 清缓存

- 「我的」新增「当前版本」行（`BuildConfig.VERSION_NAME`，与 build.gradle versionName 同源，天然一致）；
  游客态登录引导下也显示版本行（`VersionLine`）；
- 「清除图片缓存」：仅清 Coil `memoryCache` + `diskCache`（均为 null 安全），**不动登录态**；
  清后 toast「图片缓存已清除」，图片重新加载。

### EA-5 详情页骨架屏

- `DetailSkeleton.kt`：加载中（`detail == null`）以呼吸 alpha 动画骨架替换 loading 圈，
  结构镜像详情首屏（封面 460:215 / 标题两行 / 价格行 / 指标三卡 / 描述五行），慢网下无「圈→内容」闪跳。

### EA-6 全局弱网提示

- `ApiClient.networkStateListener(ok)`：任何请求网络层失败（DNS/超时/断网，含更新下载）通知 false、
  拿到任何响应通知 true；AppViewModel 据此显示/隐藏全局横幅（IO 线程回调，只写 StateFlow）；
- AppRoot 底栏上方横幅：「网络不可用，请检查网络连接」+「重试」（轻量 ping `/api/app/status`，
  恢复自动隐藏并 toast「网络已恢复」），**非阻塞、不遮挡页面**；
- 踩坑：Scaffold bottomBar 是单 Slot，横幅与 NavigationBar 必须包进 `Column`，否则重叠被底栏遮挡
  （模拟器复现后修复，App 749e580）。

### EB 18R 内容选项

- 首页/搜索筛选 chips 加「18R」（与 全部/折扣/史低/免费/未发售 并列）：开=请求 `adult=badge`
  （显示 18R 游戏 + 卡片红色「18+」角标，与「成熟内容」tertiary 样式区分）；关=`adult=hide`（默认）；
- 首次开启弹「确认已满 18 岁」（未确认不切换）；确认写 DataStore `adult_confirmed`，不再弹；
- 开关状态 DataStore `adult_enabled`（SessionStore 布尔键 + SessionData 字段 + AppViewModel
  `adultEnabled/adultConfirmed` StateFlow，首页/搜索共用）；重启/重进保留；
- 首页请求 `HomeFilterParams.paramsFor(…, adultEnabled)` 显式带 adult（单测 +2 项断言 hide/badge 映射）；
  搜索 `doSearch` 同样带 adult；开关变化由 `LaunchedEffect(adultEnabled)` 重拉当前词/筛选
  （避开 DataStore 异步写入与请求的竞态）；
- 详情接口 `gameDetail(appid)` 无 adult 过滤 → 18R 游戏详情可正常打开 ✅；
- 边界：愿望单 `gamesSearch` 保持既有 `adult=hide`（本轮范围只做首页/搜索页）；线上数据当前
  无 18R 内容（`/api/app/games` hide/badge 前 100 均 0 条 adult_flag）→「显示 18R 游戏」为
  数据依赖项，模拟器以开关/弹窗/持久化验证为准，参数行为由单测锁定。



