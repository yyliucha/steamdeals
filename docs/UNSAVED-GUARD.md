# 未保存修改的离开提醒（已确认待开发）

> 状态：**需求与方案已确认（2026-11-06），待开发**。编号待入 [TODO.md](TODO.md) 时落定（暂记 **AN**）。
> 关联：[WEB.md](WEB.md)（后台页面）、[HANDOVER.md](HANDOVER.md)。

## 1. 现状（代码事实，2026-11-06 核对）

| 项 | 事实 | 证据 |
|---|---|---|
| 菜单切换 | `select(item)` 直接改 `selected` 再 `router.replace`，**不检查任何表单状态** | `Console.vue:57` |
| 路由守卫 | 只有 `router.afterEach`（改标题），**没有 `beforeEach`** | `router/index.js` |
| 设置页 | 有 `settingsDirty`，但只在「重新加载设置定义」时提示"先保存再重新加载" | `AdminModules.vue:261`、`:269` |
| 邮件配置 | 组件内有 `dirty` 与「未保存的修改」小标，**离开不拦** | `MailSettingsForm.vue:24`、`:40` |
| 站点通知 / 编辑游戏 / 新建用户 | **完全没有脏状态跟踪** | `AdminModules.vue:5`、`:12`、`AdminExtras.vue:4` |
| 返回网站 | `router.push('/')`（前端路由，可被守卫拦到） | `Console.vue:14` |

## 2. 已确认的决策（2026-11-06 所有者）

| # | 决策 |
|---|---|
| 1 | **范围 = 5 个编辑面全要**：系统设置、邮件配置、站点通知、编辑游戏、新建用户 |
| 2 | **交互 = 三选一**（采用推荐）：`保存并离开` / `放弃修改` / `留在本页`——5 个面都有保存动作，多一个按钮能让用户不丢工作 |
| 3 | **刷新 / 关闭标签不拦**（`beforeunload` 不加）：用户刷新/关页面 = 默认放弃改动 |
| 4 | **文案简短 + 客气**（见 §3） |

## 3. 交互与文案

### 3.1 弹窗（`UnsavedLeaveDialog`）

> **标题**：还有没保存的修改
>
> **正文**：「系统设置」还有修改没保存，离开后会丢失。要先保存吗？
>
> **按钮**：`保存并离开`（主按钮） / `放弃修改` / `留在本页`

- 多来源时正文列出来源名：`「系统设置」「站点通知」还有修改没保存，离开后会丢失。要先保存吗？`
- 「保存并离开」：按登记顺序逐个 `await save()`；全部成功才离开；**任一失败 → 关闭弹窗、留在本页、用 `ElMessage.error` 显示失败原因**；
- 「放弃修改」：直接离开，不再二次确认；
- 「留在本页」/ 右上角 × / Esc：取消本次导航。

### 3.2 其它反馈

- 有未保存修改时，左侧当前菜单项旁显示一个小圆点（与邮件配置现有的「未保存的修改」小标一致）；
- 保存并离开成功后 `ElMessage.success('已保存')`，再执行导航。

## 4. 实现

### 4.1 组合式函数 `frontend/src/composables/useUnsavedGuard.js`（新增）

```js
registerUnsavedSource({ id, label, isDirty, save })   // 返回注销函数
dirtySources()                                        // 当前为脏的来源列表
requestLeave()                                        // Promise<boolean>：true=可以离开
installRouterGuard(router)                            // 注册 router.beforeEach
bypassNextGuard()                                     // 放过下一次导航（401 / 退出登录用）
```

- 模块级 `Map`，组件 `onMounted` 注册、`onUnmounted` 注销；
- `requestLeave()`：没有脏来源 → 直接 `true`；已有弹窗打开 → 复用同一个 Promise（防重复弹）；
- 弹窗状态也放在该模块（`reactive({ open, labels, resolve })`），**由挂在 `App.vue` 的全局组件渲染**（Console 卸载后弹窗仍要在）。

### 4.2 组件 `frontend/src/components/UnsavedLeaveDialog.vue`（新增）

- 读模块状态渲染；三个按钮调用 `saveAndLeave()` / `discard()` / `stay()`；
- 挂到 `frontend/src/App.vue`（与 `<router-view/>` 同级），保证跨路由存活；
- 样式用现有 token，宽度 `min(420px, 92vw)`。

### 4.3 拦截点

| 位置 | 做法 |
|---|---|
| 左侧菜单 | `Console.select(item)` 改 async：`if (item.id===selected.value) return; if (!(await requestLeave())) return;` 再切（**不要先改 `selected` 再拦**） |
| 路由离开 | `router.beforeEach(async (to, from) => bypass ? true : await requestLeave())`；`installRouterGuard` 在 `router/index.js` 里调一次 |
| 401 / 退出登录 | 跳登录前调 `bypassNextGuard()`，否则会被守卫拦下来卡死 |
| 刷新 / 关闭 | **不处理**（决策 3） |

### 4.4 五个编辑面接入

| 面 | 脏判定 | save 回调 | label |
|---|---|---|---|
| 系统设置（`AdminModules`） | 现有 `settingsDirty` | `saveSettings()` | 系统设置 |
| 邮件配置（`MailSettingsForm`） | 现有 `dirty` | 组件内 `save()` | 邮件配置 |
| 站点通知（`AdminModules`） | 新增 `announcementDirty`：把 title/body/level/active/startsAt/endsAt 与进入编辑时的快照做 JSON 比较 | `saveAnnouncement()` | 站点通知 |
| 编辑游戏（`AdminModules` `gameDialog`） | 打开弹窗时存快照，字段变动即为脏 | 弹窗保存函数 | 编辑游戏 |
| 新建用户（`AdminExtras`） | `newUser` 任一字段非空即算脏（用户名/密码/邮箱/角色） | `createUser()`（按钮语义是"创建并离开"） | 新建用户 |

- 每个面在 `onMounted` 注册、`onUnmounted` 注销；保存成功 / 重置表单后 `isDirty()` 自然变 false；
- 「新建用户」的 `save` 是创建账号：**创建成功才离开**，失败留在本页并提示。

## 5. 边界（明确不拦的情况）

1. 刷新 / 关闭标签（决策 3）；
2. 401 过期 / 被禁用 / 手动退出登录（`bypassNextGuard()`）；
3. 同一菜单项重复点击（`item.id === selected.value` 直接返回）；
4. 保存成功后的自动刷新 / 弹窗关闭（此时已不脏）；
5. 无脏状态时切换（零打扰）。

## 6. 验收

1. 系统设置改一项 → 点左侧「用户管理」→ 弹窗出现，三个按钮文案与 §3.1 一致；
   「留在本页」不切换且修改还在；「放弃修改」切换且修改丢失；「保存并离开」保存成功后切换、再回来能看到新值；
2. 邮件配置改一项 → 切菜单 → 同样弹窗；「保存并离开」后邮件配置已生效；
3. 站点通知编辑到一半 → 切菜单 → 弹窗；「保存并离开」后列表里是修改后的内容；
4. 「编辑游戏」弹窗改动后触发路由离开（浏览器后退 / 返回网站）→ 弹窗；
5. 新建用户填了用户名/密码 → 切菜单 → 弹窗；「保存并离开」= 创建账号成功后离开，失败留在本页并提示；
6. 「返回网站」按钮触发同一弹窗（不是直接跳走）；
7. 保存失败（例如断网/校验失败）→ 留在本页 + 错误提示，不丢失已填内容；
8. 401 / 退出登录**不弹**，直接跳登录页；
9. 刷新 / 关闭标签**不弹**（决策 3）；
10. 无修改时切换菜单 / 路由**不弹**；
11. `npm test` 全绿（新增 `test/unsaved-guard.test.js` 静态断言：composable/组件存在、router 守卫已注册、`App.vue` 挂载弹窗、五个面都调了 `registerUnsavedSource`、三按钮文案）、`npm run frontend:build`、`npm run scan`。

## 7. 实施顺序

单批 **AN**：§4.1–§4.3 基础设施 → §4.4 五个面 → 测试与文档（`docs/WEB.md` 补一句"后台表单有离开提醒"）。
预计改动 6–8 个前端文件，不需要动后端。

## 8. 本期不做（写清楚，避免被当成漏项）

- 刷新 / 关闭标签的拦截（决策 3）；
- 自动保存 / 草稿暂存（localStorage 草稿）；
- 前台用户侧表单（筛选/主题等均为即时保存，不涉及）；
- 跨标签页同步脏状态。

## 9. 待确认

无。范围、三按钮交互、不拦刷新关闭、文案风格已于 2026-11-06 确认。
