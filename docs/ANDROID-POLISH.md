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
