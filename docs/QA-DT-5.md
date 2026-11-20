# QA：DT-5 前后台入口（第 1 轮）

> 基线 4c49f7c（DT-4 提交后）→ HEAD（本 worktree 分支 wt-228-front 未提交改动）；判据 docs/ADMIN-PERMISSIONS.md「DT-5」节 + demo design/admin-menu-permissions-2026-11-19.html「前台顶栏」与 design/admin-users-2026-11-19.html ④「全局顶栏」；开发描述来源：夜班监工派发（worker-1-front）。
> 结论：✅ 放行 —— 通过 6 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | DT-5 | 前台未登录顶栏显示「登录」按钮（点击跳 /login） | 前台顶栏 | ✅ | Home.vue（BT 批既有 goLogin 硬跳，保留） |
| 2 | DT-5 | 前台登录后不显示「退出登录 / 修改密码」（桌面 + 移动抽屉；保留用户徽标进个人资料） | 前台顶栏/移动「我的」抽屉 | ✅ | Home.vue |
| 3 | DT-5 | Console 全局顶栏（所有 section 共用）右上「返回网站 ↗ + 用户徽标」 | 控制台任意菜单页顶栏 | ✅ | Console.vue header-actions |
| 4 | DT-5 | 徽标点开下拉菜单树：个人资料/修改密码/返回网站/退出登录（普通用户同样可用） | 控制台顶栏徽标 | ✅ | Console.vue el-dropdown |
| 5 | DT-5 | 退出后回到未登录态且心跳基线正确（不误判会话失效） | 菜单树「退出登录」 | ✅ | Console.vue doLogout（markSessionLoggedOut） |
| 6 | DT-5 | 移动端：顶栏徽标下拉同样可用（44px 触摸目标） | 控制台移动端顶栏 | ✅ | Console.vue 样式断点 768 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 未登录只见登录按钮 | 静态断言（桌面 + 移动抽屉双结构） | test/auth-pages.test.js DT-5 断言 | ✅ |
| 2 | 登录后前台无退出/改密 | 静态断言：无 router.push('/change-password')、无 @click="logout"、无移动抽屉退出 | test/auth-pages.test.js | ✅ |
| 3 | 后台任何菜单页都有全局顶栏菜单树 | 静态断言：header-actions 在 Console 外壳（非具体 section 组件）+ 下拉四项 + 无角色条件 | test/admin-console-ia.test.js DT-5 组 | ✅ |
| 4 | 退出后回到未登录态且心跳基线正确 | 静态断言 doLogout：POST /api/logout + markSessionLoggedOut + user=null + 回 / | test/admin-console-ia.test.js + test/session-heartbeat.test.js | ✅ |
| 5 | 既有行为不破：5 处后台 401 软跳、前台 401 硬跳、mustChange 跳改密 | 重跑 session-heartbeat/auth-pages/admin-console-mobile 等 | 见下 | ✅ |

## 重跑验证（QA 亲自重跑）

- `node test/admin-console-ia.test.js` → `# pass 22 / # fail 0`（新增 DT-5 组 3 用例）✅
- `node test/auth-pages.test.js` → `# pass 14 / # fail 0`（首页断言随 DT-5 规格更新）✅
- `node test/session-heartbeat.test.js` → `# pass 7 / # fail 0`（心跳基线锁随退出入口迁到 Console.doLogout）✅
- `node test/admin-console-mobile.test.js` → `# pass 5 / # fail 0` ✅
- `node test/profile.test.js` → `# pass 15 / # fail 0`（EJ 顶栏昵称优先锁不破）✅
- `node test/frontend-mobile.test.js` → `# pass 12 / # fail 0` ✅
- `node test/serve.test.js` → `# pass 12 / # fail 0` ✅
- `npm run frontend:build` → `✓ built in 4.61s` ✅（沙箱补丁变体，同前轮说明）
- `npm run scan` → `✅ 未发现高置信度凭据` ✅

## 打回清单

无。

## 需人工确认

- 页面目视：顶栏徽标下拉的展开交互、移动端 44px 触摸、退出后首页回到未登录态（登录按钮出现），
  本地无 headless 渲染环境（沙箱 spawn 限制），由 DT 批整体验收兜底。

## 争议项

- 既有断言更新两处（均为规格取代旧交互，非弱化）：
  ① auth-pages.test.js「用户菜单修改密码入口」→ 改为锁「前台无退出/改密入口」；
  ② session-heartbeat.test.js「Home.logout 标记基线」→ 锁落点随退出入口迁到 Console.doLogout
  （Home.logout 死代码已删——退出统一在控制台菜单树，DT-5 规格）。
- 侧栏底部（admin-bottom）原有「返回网站 ↗ + 用户 tag」保留未删：DT-5 只要求顶栏有菜单树，
  保留既有入口不冲突（移动抽屉内的返回网站为 BW 批既有结构）。

## 复检记录

- 第 1 轮（2026-11-20）：6/0/0/1 → ✅ 放行。

## 备注

- TODO 状态由监工统一回写（夜班工人纪律：不改 docs/TODO.md 及任何共用文档）。
