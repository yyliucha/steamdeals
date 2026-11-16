# 手机端登录入口修复：点「登录」不出现登录页（浮层 history 竞态）（待开发）

> 状态：**已实现待发版（2026-11-16，本地验证全绿，待质检）**。编号 **BT**。
> 关联：[MOBILE-FIX.md](MOBILE-FIX.md)（移动端既有适配）、[AUTH-REDESIGN.md](AUTH-REDESIGN.md)（独立登录页）、
> [SESSION-MANAGEMENT.md](SESSION-MANAGEMENT.md) §8（401 软跳登录页）、[TODO.md](TODO.md) 的 BT 条目。

## 1. 现象（2026-11-16，所有者真机）

- 设备：**小米浏览器**（Android）；
- 操作：首页 →「我的」底部面板 → 点「登录」；
- 结果：**面板关闭后什么都没发生**，登录页（账号/密码输入页）**不出现**；看起来"把登录按钮的页面关掉了"；
- 对照：直接打开 `https://sd.yyliucha.cn/login` 能正常显示登录页。

## 2. 根因（代码链路，2026-11-16 核对）

| # | 环节 | 证据 |
|---|---|---|
| 1 | 我的面板里的登录按钮：先关面板、再调 `goLogin()` | `frontend/src/pages/Home.vue:78`（`@click="mySheet=false;goLogin()"`） |
| 2 | `goLogin()` 走 SPA 软跳：`router.push({path:'/login', query:{next:...}})`，**promise 未处理** | `frontend/src/pages/Home.vue:133-134` |
| 3 | 面板一关，返回键守卫会**退一条 history**：`release()` → `window.history.back()` | `frontend/src/composables/useBackGuard.js:27-36`、`:46-61`（打开时 pushState 占位） |
| 4 | 同一 tick 内顺序是：关面板 → `router.push('/login')` → 守卫的 `history.back()` **把刚 push 的 /login 退回去** | 竞态；`skipPop` 只抑制"关浮层"，不阻止历史回退 |
| 5 | 登录页是**懒加载路由**（`() => import('../pages/LoginPage.vue')`），chunk 加载失败时 `router.push` 也会静默中止 | `frontend/src/router/index.js:24` |
| 6 | 小米浏览器的 history/popstate 时序与其他内核不同，所以该竞态在它上面**稳定复现**；其他浏览器可能闪一下或恰好没事 | 真机反馈"只有小米浏览器" |

**结论**：不是会话/cookie 问题，也不是登录接口问题——是**"关浮层触发的 history.back()" 与 "router.push(登录页)" 抢历史栈**，登录页根本没被打开。

## 3. 已确认的决策（2026-11-16 所有者）

| # | 决策 |
|---|---|
| 1 | 修复方案取 **C：登录入口硬跳**——`location.assign('/login?next=…')`，不再依赖 SPA 路由与浮层历史栈 |
| 2 | **所有"进入登录页"的入口统一走同一个硬跳 helper**（首页桌面按钮、手机「我的」面板、未登录点搜索/愿望单、401 会话失效跳转） |
| 3 | 增加 `router.onError` 兜底：懒加载 chunk 失败时整页重载目标路由（一次），避免"点了没反应/白屏" |
| 4 | 登录页本身仍保持 SPA（`/login` 已在服务端白名单，v2.12.1 起）；登录成功后的 `router.replace(next)` 不变 |
| 5 | 本批只修"进得去"，**不改登录页视觉/交互**（移动端登录页重做归后续移动端重设计批次） |

## 4. 方案设计

### 4.1 统一入口 helper

新增 `frontend/src/utils/login-entry.js`：

```js
/** 进入登录页：整页跳转，避免 SPA 路由 + 浮层 history.back() 抢历史栈（BT 批，方案 C）。 */
export function openLogin({ reason = '', next = null } = {}) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === '/login') return; // 防循环
  const raw = next ?? (window.location.pathname + window.location.search + window.location.hash);
  const safe = String(raw || '/').startsWith('/') && !String(raw).startsWith('//') ? String(raw) : '/';
  const qs = new URLSearchParams({ next: safe });
  if (reason) qs.set('reason', reason);
  window.location.assign(`/login?${qs.toString()}`);
}
```

- 只接受**站内相对路径**作为 `next`（与 LoginPage 的 `safeNext()` 口径一致）；
- `reason=expired` 时登录页沿用 BM-3 的「登录已过期」提示（`LoginPage.vue:60`）。

### 4.2 替换调用点

| 调用点 | 现在 | 改成 |
|---|---|---|
| 首页桌面「登录」按钮 | `@click="goLogin"` → `router.push` | `goLogin()` 内部改为 `openLogin()` |
| 手机「我的」面板「登录」 | `mySheet=false;goLogin()`（竞态源） | 同上；面板关闭与整页跳转无竞态（整页卸载） |
| 手机底部 Tab 未登录点「搜索/愿望单」 | `mNav()` → `goLogin()` | 同上 |
| 401 会话失效 `redirectToLogin(reason)` | 动态 import router + `router.push` | 改为 `openLogin({ reason })`；`bypassNextGuard` 不再需要（整页跳转不触发路由守卫） |

> 说明：登录页/注册页内部的 `router-link`（如"返回登录""注册账号"）**保持 SPA**，它们不经过浮层，无竞态。

### 4.3 懒加载兜底（router.onError）

`frontend/src/main.js` mount 前注册：

```js
router.onError((err, to) => {
  const msg = String(err?.message ?? '');
  if (!/Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(msg)) return;
  // 同一路径每会话只硬载一次，避免死循环
  const key = 'sd:chunk-retry:' + to.fullPath;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  window.location.assign(to.fullPath);
});
```

- 只对"动态模块加载失败"生效，其它路由错误不处理；
- `sessionStorage` 标记防循环（同一路径只重试一次）。

### 4.4 兼容与边界

- **历史栈**：整页跳转会保留浮层的占位记录；从登录页按返回键回到首页（URL `/`），不会出现"多按几次才退出"，也不会卡死；
- **TWA App**：硬跳仍在同一 WebView 内，登录流程不变；
- **登录页可达性**：`/login` 已在 `FRONTEND_PAGES` 白名单（`src/server.js:4232`），硬跳不会 404；
- 不改 `useBackGuard` 的通用行为（其它浮层如筛选/通知仍靠它处理返回键）。

## 5. 改动清单

| 文件 | 改动 |
|---|---|
| `frontend/src/utils/login-entry.js` | **新增** `openLogin()`（硬跳 + next 安全 + reason） |
| `frontend/src/pages/Home.vue` | `goLogin()` 改为 `openLogin()`；登录按钮/`mNav` 调用点不变（仍走 `goLogin`）；删除未用的 router.push 登录逻辑 |
| `frontend/src/utils/session.js` | `redirectToLogin()` 改为调用 `openLogin({ reason })`，去掉动态 import router 与 `bypassNextGuard` |
| `frontend/src/main.js` | 注册 `router.onError` 懒加载兜底（4.3） |
| `test/*.test.js` | 前端静态断言：`goLogin` 不再 `router.push('/login')`；`redirectToLogin` 走 `openLogin`；`main.js` 有 `router.onError` + chunk 正则；`openLogin` 拒绝 `//` 外链 |

## 6. 验收

1. **真机（小米浏览器）**：首页 →「我的」→ 登录 → 出现登录页（地址 `/login?next=…`），可输入账号密码并登录成功；不再出现"面板关了没反应"。
2. **入口矩阵**：桌面「登录」按钮、手机底部 Tab 未登录点「搜索/愿望单」、401 会话失效（过期/被踢）都进入登录页；带 `next` 的登录成功后回到原页。
3. **懒加载兜底**：模拟登录页 chunk 加载失败（临时改名/断网后恢复）→ 自动整页重载 `/login` 一次并显示登录页；同一路径不无限重试。
4. **返回键**：从登录页返回回首页，不卡死、不需要连按多次退出。
5. **安全**：`next` 只接受站内相对路径（`//evil.com` 被回落为 `/`）；不新增任何对外跳转。
6. **不回归**：注册页/改密页的站内 `router-link` 正常；登录页视觉与 BM-3 的 `reason=expired` 提示不变。
7. **测试**：`npm test` 全绿（新增静态断言）、`npm run frontend:build`、`npm run scan`。
8. **部署侧复核**：线上小米浏览器真机按第 1 条复测；桌面登录入口仍可用。

## 7. 本批不做

1. 不改登录页 UI/交互（大表单、键盘吸附、验证码布局等归移动端登录页重做）；
2. 不改会话策略（IP/UA 绑定、空闲超时保持现状）；
3. 不重构浮层/返回键体系（`useBackGuard` 通用逻辑不动）；
4. 不做移动端前后台重设计（P1–P3 另批）。

## 8. 待确认

无（方案 C 已于 2026-11-16 由所有者确认）。
