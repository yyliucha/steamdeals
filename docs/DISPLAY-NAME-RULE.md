# 昵称显示规则统一（EJ，已实现并发布 v2.27.7，2026-11-20）

> 所有者规则（2026-11-20）：**有昵称显示昵称，没有昵称显示用户名**——前端（Web）与手机端（App）所有
> 用户可见的显示位置统一按此规则。
> 关联：CX（个人资料编辑）、DQ（头像/资料打磨）、`users.display_name` 字段。

## 1. 规则

```
显示名 = displayName（昵称，trim 后非空） ? 昵称 : username（用户名）
```

- 登录/账号安全仍用 `username`（不变）；
- 昵称可清空（清空后回退用户名）；
- 两端口径一致，不做「昵称 + 用户名」拼接。

## 2. 现状（代码证据）

| # | 位置 | 现状 | 是否合规 |
|---|---|---|---|
| 1 | App `MeScreen.kt:154` | `text = user?.username ?: ""`——**只显示用户名** | ❌ 有昵称也不显示 |
| 2 | App `MeScreen.kt:145` | 头像首字 `initialOf(displayName ?: username)` | ✅ |
| 3 | Web `AdminModules.vue` 用户管理列表 | 列 `prop="username"`（接口已返回 `display_name`） | ❌ 有昵称不显示 |
| 4 | Web `AdminExtras.vue:10` 用户卡片 | `u.display_name \|\| u.username` | ✅（应推广） |
| 5 | Web 后台顶栏/会话/提醒/愿望单列表用户列 | 多处 `username` | 待核，按规则统一 |
| 6 | Web 前台「我的」/用户菜单 | 待核（实现时确认） | 待核 |

> **实现（2026-11-20，站点 f340d78 + App 6254978，发布 v2.27.7）**：上表 ❌/待核项已全部按规则统一，验收与两端
> 截图见 [QA-EJ.md](QA-EJ.md)。实现时另发现两处既有偏差一并修正：① 前台 `Home.vue`/`Console.vue` 读的是
> `user.display_name`，而 `/api/me` 返回 `displayName`（有昵称也永远回退用户名）；② App 头像首字对空白昵称
> 不判空（会显示 `S` 而不是用户名首字）。台账「操作者」列按 §5 边界保留账号标识。

## 3. 范围

### App（`F:\dsh\steamdeals-app`）
- `MeScreen.kt` 显示名：`user?.username` → `user?.displayName?.trim().takeIf { it.isNotEmpty() } ?: user?.username`；
- ProfileEdit 顶部/预览的称呼同步；
- 其它显示用户名的位置（如有）按规则。

### Web（`F:\dsh\gameprice`）
- 后台用户管理列表/卡片：用户列改 `display_name || username`（列表接口已返回 `display_name`）；
- 会话列表、到价提醒、愿望单、操作日志等展示「用户」的列：统一 `display_name || username`
  （接口未返回 `display_name` 的，服务端 SELECT 补字段）；
- 前台「我的」抽屉/用户菜单：昵称优先。

## 4. 验收

1. 有昵称：Web 后台用户管理 + App 我的页显示昵称（截图对照）；
2. 昵称为空（清空后）：回退显示用户名；
3. 两端口径一致（同账号同显示）；
4. 登录/账号安全仍用 username（不改认证链路）；
5. App 构建通过 + `npm test`（分段）+ `frontend:build` + `scan` 全绿。

## 5. 边界

- 不改数据库字段名（`display_name`）、不改认证/登录；
- 后台操作日志里的「操作者 username」可保留账号标识（日志审计需要），**界面展示**按规则；
- 不做昵称与用户名的并列展示。
