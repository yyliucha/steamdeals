# QA：DT-1 菜单与路由权限隔离（第 1 轮）

> 基线 791d729（DU 提交后）→ HEAD（本 worktree 分支 wt-228-front 未提交改动）；判据 docs/ADMIN-PERMISSIONS.md「DT-1」节 + demo design/admin-menu-permissions-2026-11-19.html；开发描述来源：夜班监工派发（worker-1-front）。
> 结论：✅ 放行 —— 通过 6 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | DT-1 | 管理员菜单全量（内容运营/访问与安全/账号与服务/日志审计/系统） | 控制台左侧栏 | ✅ | Console.vue groups 数组 |
| 2 | DT-1 | 普通用户菜单仅 5 项（个人资料/登录会话（我的设备）/我的到价提醒/我的愿望单/站点公告） | 控制台左侧栏 | ✅ | Console.vue USER_GROUPS |
| 3 | DT-1 | 「Steam 账号」菜单项删除（管理员也不需要，账号管理并入个人资料） | 控制台左侧栏 | ✅ | Console.vue groups 无 id:'steam' |
| 4 | DT-1 | 普通用户直达无权限 section（如 ?section=users）→ 跳回个人资料 + 「无权限」提示 | 控制台 URL 直达 | ✅ | Console.vue 守卫 watch + onMounted |
| 5 | DT-1 | 普通用户直达允许集 section（sessions/watchlist/wishlist/announcements）保留不跳 | 控制台 URL 直达 | ✅ | Console.vue onMounted 允许集保留分支 |
| 6 | DT-1 | 普通用户 4 个数据页渲染 UserSections（admin 页面保持 AdminModules/AdminExtras 不变） | 控制台内容区 | ✅ | Console.vue 模板分支 + UserSections.vue 壳 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | admin 全量菜单 | 静态断言 13 项菜单 + 5 分组逐项 | test/admin-console-ia.test.js DT-1 验收 1 | ✅ |
| 2 | 普通用户仅 5 项 | 静态断言 USER_SECTIONS 恰好 5 项 + 文案逐字对齐 demo | test/admin-console-ia.test.js DT-1 验收 2 | ✅ |
| 3 | 删除「Steam 账号」菜单后无残留入口 | 静态断言无 id:'steam' 且无 label:'Steam 账号' | test/admin-console-ia.test.js DT-1 验收 1 | ✅ |
| 4 | 直达无权限 section 被守卫跳回 + 「无权限」提示 | 静态断言 watch 守卫 + onMounted 守卫 + ElMessage.warning('无权限') | test/admin-console-ia.test.js DT-1 验收 4/5 | ✅ |
| 5 | 普通用户 5 页渲染用户级组件、admin 保持 admin 组件 | 静态断言模板分支 | test/admin-console-ia.test.js DT-1 验收 6 | ✅ |
| 6 | 三保险之一：后端接口 403 兜底不变 | /api/admin/* requireAdmin 原有（本条目不动后端） | src/server.js requireAdmin 既有 | ✅（既有证据，非本批 diff） |

## 重跑验证（QA 亲自重跑）

- `node test/admin-console-ia.test.js` → `# pass 18 / # fail 0`（新增 DT-1 组 6 用例）✅
- `node test/admin-console-mobile.test.js` → `# pass 5 / # fail 0` ✅（Console.vue 移动端抽屉沿用）
- `node test/admin-bulk.test.js` → `# pass 17 / # fail 0` ✅（Console.vue 菜单静态锁不破）
- `node test/unsaved-guard.test.js` → `# pass 8 / # fail 0` ✅
- `node test/profile.test.js` → `# pass 15 / # fail 0` ✅（EJ 顶栏昵称优先锁不破）
- `npm run frontend:build` → `✓ built in 8.47s` ✅（沙箱补丁变体，同 DU 轮说明）
- `npm run scan` → `✅ 未发现高置信度凭据` ✅

## 打回清单

无。

## 需人工确认

- 页面目视：普通用户登录后侧栏是否只显示「我的」5 项、直达 `?section=users` 是否跳个人资料并弹「无权限」。
  本地无 headless 渲染环境（沙箱 spawn 限制），由 DT 批整体验收兜底。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-20）：6/0/0/1 → ✅ 放行。

## 备注

- 中间态说明：DT-1 阶段普通用户点击 sessions/watchlist/wishlist/announcements 渲染 UserSections 壳
  （「数据接入开发中（DT-2）」空态），DT-2 提交接入用户级接口数据——按监工「逐条目独立提交」执行，无 403 报错中间态。
- TODO 状态由监工统一回写（夜班工人纪律：不改 docs/TODO.md 及任何共用文档）。
