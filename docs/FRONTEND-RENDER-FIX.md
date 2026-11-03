# 前端渲染修复：抽屉/角标/复选框未注册 + 封禁页跳转

> 状态：**问题一/问题二已实现并发布（v1.11.0，2026-11-03）；问题三（§2.5 验证码体验）待开发**。
> 两个主要 bug 都是"组件/入口没接上"，不是业务逻辑错误；修复约 20 行，无数据/接口改动。

## 1. 问题一：抽屉、未读角标、愿望单复选框全部失效

### 根因（已实测确认）

`frontend/src/main.js` 只注册了部分 Element Plus 组件：

```js
for (const component of [ElAlert, ElButton, ElConfigProvider, ElDialog, ElEmpty, ElForm, ElFormItem,
  ElIcon, ElInput, ElOption, ElPagination, ElSelect, ElSkeleton, ElTag]) app.use(component);
app.use(ElSwitch);
```

**没有 `ElDrawer`、`ElBadge`、`ElCheckbox`、`ElCheckboxGroup`**（`admin-ui.js` 只在访问后台时补了后台用的组件，
同样不含 Drawer/Badge，且前台不加载 `admin-ui.js`）。

因此 `<el-drawer>` / `<el-badge>` / `<el-checkbox>` 是**未解析组件**，Vue 把它们当普通标签渲染，
插槽内容直接铺在页面流里。

### 实测证据（无头 Chrome，390×844 模拟手机，真实点击「我的」）

```
点击后：.el-drawer 数量 = 0；.m-my-body 存在
祖先链：div.m-my-body → div.m-filter-sheet（display:inline; position:static）→ .storefront
```

即抽屉永远不会打开，内容变成页面里的一段普通内容 —— 用户看到的就是"点了没反应"。
2026-11-03 12:22 的真机截图（筛选区标签组铺在页面里）与此完全一致。

### 影响清单

| 位置 | 现状 | 影响 |
|---|---|---|
| 手机「筛选」弹层 | 内容铺在页面里 | 无法正常筛选 |
| 手机「我的」菜单 | 点了没反应 | 通知/主题/登录/后台入口不可用 |
| 手机 + PC「通知」抽屉 | 内容铺在页面底部 | 公告只能靠弹窗看一次 |
| 顶栏未读角标 | `el-badge` 未注册 | 未读数字不显示 |
| 前台愿望单「添加/移除」弹窗 | `el-checkbox` 未注册 | 账号复选框点不动 → `selected` 永远为空 → **推送到 Steam 账号从未真正可用**（自 v1.6.0 起） |

### 修复

`frontend/src/main.js`：

```js
import { ElBadge, ElCheckbox, ElCheckboxGroup, ElDrawer, /* 现有 */ } from 'element-plus';
import 'element-plus/es/components/badge/style/css';
import 'element-plus/es/components/checkbox/style/css';
import 'element-plus/es/components/drawer/style/css';
// 组件列表追加 ElBadge, ElCheckbox, ElCheckboxGroup, ElDrawer
```

注意：`ElCheckboxGroup` 与 `ElCheckbox` 都要注册（`el-checkbox-group` 是独立组件）。

### 验收

1. 手机（390×844）：点「筛选」→ 底部弹层打开；点「我的」→ 菜单弹出；点铃铛 → 通知抽屉。
2. 顶栏出现未读角标（有未读公告时）。
3. 前台愿望单：勾选账号 → 「加入愿望单」按钮可用 → 提交后 `added` 非空（Steam 推送成功）。
4. PC 同步回归（铃铛抽屉、愿望单弹窗）。
5. 无 `.el-drawer` 内容出现在页面流中（`document.querySelectorAll('.el-drawer').length > 0` 且内容不在 `.storefront` 内）。

## 2. 问题二：封禁后找不到申诉页

### 根因

- 服务端 `serveBanPage` 把 `window.__BAN_PAGE__ = { status, until, reason, site, email, code }`
  注入 `index.html` 返回（[server.js:75](../src/server.js)）；
- 前端**只有** [BanPage.vue](../frontend/src/pages/BanPage.vue) 读取它，而 `/banned` 路由只有手动访问才会命中；
- 被禁用户刷新 `/` → SPA 在 `/` 启动 → 渲染的是 Home（接口 403/429 报错），
  **封禁卡片和「申请解封」入口都不会出现** → 用户认为"申诉页面找不到"。

### 修复

`frontend/src/main.js`（创建 router 之后、mount 之前）：

```js
// 封禁页：服务端已把 __BAN_PAGE__ 注入 index.html；这里负责把它渲染出来
if (window.__BAN_PAGE__ && location.pathname !== '/banned' && location.pathname !== '/appeal') {
  router.replace('/banned');
}
```

说明：

- `/banned` 由同一次封禁响应提供（服务端对 banned 路径仍返回封禁页 HTML），SPA 启动即渲染 BanPage；
- `/appeal` 不跳转（服务端对 `/appeal` 已放行，绕过封禁拦截；AppealPage 只用 `mailto`，不调接口）；
- 管理员（`adminBypass`）与白名单不受影响；
- 不要在 `/appeal` 页面再跳 `/banned`，否则申诉入口死循环。

### 真机实证（2026-11-03 14:58）

把手机 IP 加入黑名单后用手机 5G 访问：页面渲染出**移动端首页**（顶栏 + 底部导航），
并弹出「请求失败 (403)」提示，**没有封禁卡片、没有申诉入口** —— 与上面的定位完全一致。
根因链：服务端 403 + 注入 `__BAN_PAGE__` → SPA 在 `/` 启动 Home → 首页接口全部 403 → 只有报错提示。

### 修复实现细节（比 `router.replace` 更稳，推荐）

在 `main.js` **创建 router 之前**直接改地址，避免 `mount` 前导航告警、也避免 Home 的 `onMounted`
先发一轮请求（那正是 403 toast 的来源）：

```js
// main.js，app.use(router) / mount 之前
if (window.__BAN_PAGE__ && location.pathname !== '/banned' && location.pathname !== '/appeal') {
  window.history.replaceState(null, '', '/banned');
}
```

这样 router 创建时读到的就是 `/banned`，直接渲染 BanPage，Home 根本不会挂载，也不会出现 403 toast。

### 验收

1. **手机真机 / 模拟封禁**（把手机 IP 加入黑名单，等 10 秒生效后刷新）：
   - 页面直接显示封禁卡片（原因 / 解除时间 / 申诉编号）；
   - **不再出现「请求失败 (403)」提示**；
   - 点「申请解封」→ 进入 `/appeal` 申诉页。
2. 被封状态下直接打开 `/appeal` → 正常显示申诉页。
3. 管理员/白名单访问 → 不受影响（正常首页）。
4. 封禁解除后刷新 → 正常首页（无残留跳转）。

## 2.5 问题三：验证码加载失败时只剩破图（体验缺陷）

### 现象

手机端登录弹窗里，验证码位置只显示 `<img>` 的 alt 文本（「登录验证码，点击刷新」）和一个破图标。

### 定位

[Home.vue](../frontend/src/pages/Home.vue) 的 `loadCaptcha()`：

```js
async function loadCaptcha(){try{const data=await request('/api/captcha');captchaImage.value=data.svg?`data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg)}`:'';}catch{captchaToken.value='';captchaImage.value='';}}
```

- 请求失败（**被封禁时 API 全部 403**、断网、服务端 5xx）时 **catch 静默清空**，`<img>` 没有 src → 只剩 alt 文本；
- 用户看不出是"封禁/网络问题"，也拿不到重试提示。

### 先确认是否只是封禁

手机浏览器直接打开 `https://<站点>/api/captcha`：

- 返回 JSON（`{"token":"…","svg":"<svg …"}`）→ 接口正常，问题在客户端；
- 返回「访问被拒绝」/403 → **手机 IP 还在黑名单**（IP 黑名单是持久的，不会自己到期），后台解封即可。

### 修复（体验）

1. `loadCaptcha` 的 catch 里给出提示：`ElMessage.warning('验证码加载失败，点击验证码重试')`；
2. `captchaImage` 为空时，验证码区域显示一个可点击的占位块（「点击加载验证码」），而不是空 `<img>`；
3. 登录页在被封禁时本就不应出现（随 §2 的封禁页修复一起解决）。

### 验收

1. 断网/接口 403 时打开登录弹窗 → 显示「验证码加载失败，点击重试」，点击后能重新请求；
2. 网络恢复后点击 → 验证码正常显示、可登录；
3. 解封后手机端验证码正常加载。

## 3. 实施顺序与验证

1. `main.js` 补注册（问题一）→ `npm run frontend:build`，用手机/无头浏览器验证抽屉、角标、复选框；
2. `main.js` 加 `__BAN_PAGE__` 跳转（问题二）→ 本地模拟封禁验证申诉链路；
3. `loadCaptcha` 失败提示 + 占位重试（问题三，可与问题二一起验证：封禁状态下 API 403）；
4. `npm test` 全绿、`npm run scan` 干净；
5. **不自行构建**（硬规则 5），修完推 main 等所有者指令。

### 建议补一个防回归测试

新增 `test/frontend-registration.test.js`（读文件做静态断言，成本低）：

```js
assert.match(mainJs, /ElDrawer/);
assert.match(mainJs, /ElBadge/);
assert.match(mainJs, /ElCheckboxGroup/);
assert.match(mainJs, /__BAN_PAGE__/);
```

避免以后有人精简组件列表时再次漏注册。

## 4. 影响面说明（给所有者）

- **纯前端**：不动数据库、API、调度器、采集任务；无数据迁移；
- 修复后用户可见变化：手机筛选/我的/通知可用、未读角标出现、愿望单可勾选账号并推送、
  被封用户能看到封禁页并申诉；
- 风险：被封用户不再"看似能浏览网站"（预期）；注册组件会略增打包体积（四个组件样式，几十 KB 内）；
- 与 v1.10.0 的 viewport 补丁互不冲突（都在 `main.js`，注意合并顺序）。
