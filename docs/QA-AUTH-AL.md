# QA：登录 / 注册 / 改密页面（AL 批，第 1 轮）

> 基线 198a2d8 → HEAD 8023f0b；判据 [docs/AUTH-REDESIGN.md](AUTH-REDESIGN.md) §5/§5.5/§7 验收 10、12（AL 范围）；
> 开发描述来源：开发会话汇报（77c02e5 代码 + 8023f0b 文档）。
> 结论：✅ 放行 —— 通过 10 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AL | 独立登录页 `/login`：桌面左右分栏（品牌区含收录/报价/商店数据点）+ 420px 表单卡；移动 ≤900px 单列、按钮 ≥44px | 首页「登录」/ 直接访问 /login | ✅ | LoginPage.vue；test/auth-pages.test.js:22 |
| 2 | AL | 登录三模式（密码 / 邮箱验证码 / 忘记密码）分段切换，切换不丢已填内容 | 登录页 | ✅ | LoginPage.vue（独立 ref，模式切换不重置） |
| 3 | AL | 密码可见切换、Caps Lock 提示、autocomplete、错误就地显示、记住我 30 天、验证码重试占位 | 登录页 | ✅ | LoginPage.vue；test:36 |
| 4 | AL | 登录成功回跳 `?next=`（只允许站内相对路径）；首页「登录」不再弹窗、一律跳 /login?next | 登录 | ✅ | Home.vue（goLogin）；LoginPage.vue（safeNext）；test:28 |
| 5 | AL | 注册页 `/register`：用户名/邮箱/验证码（60 秒倒计时）/密码/确认 + 300ms 防抖强度条 | 直接访问 /register | ✅ | RegisterPage.vue；test:50 |
| 6 | AL | 注册不可用（开关关闭 / SMTP 未配置）→ 页面显示不可用说明 + 返回登录 | 注册页 | ✅ | RegisterPage.vue + /api/site registration 状态；test:50 |
| 7 | AL | 修改密码页 `/change-password`：当前/新/确认 + 强度条；`forced=1` 顶部不可关闭提示；成功踢其它设备并回首页 | 用户菜单「修改密码」/ 首登强制 | ✅ | ChangePasswordPage.vue；test:59 |
| 8 | AL | 会话过期：任意接口 401 → 跳 `/login?next=…`（游客 /api/me 401 不误跳） | 前台与后台 | ✅ | Home.vue/AdminModules.vue/AdminExtras.vue；test:28 |
| 9 | AL | 首登强制改密衔接：/api/me 带 mustChangePassword → 自动跳 /change-password?forced=1（首页与控制台） | 登录后 | ✅ | Home.vue/Console.vue；test:28 |
| 10 | AL | 后台新建/重置密码留空 → 临时密码弹窗（只显示一次、可复制）+「随机生成」按钮 | 后台 → 用户管理 | ✅ | AdminExtras.vue；test:68 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | §7.10 三页面可直达 | 路由静态断言 | router/index.js；test:22 | ✅ |
| 2 | §7.10 移动端单列、触摸 ≥44px | CSS @media 900 断点 + min-height 44px | LoginPage.vue/RegisterPage/ChangePasswordPage（样式） | ✅ |
| 3 | §7.10 密码可见切换 / Caps Lock / 错误就地 | 静态断言 | test:36 | ✅ |
| 4 | §7.10 首页不再弹登录框 | Home 无 loginVisible / 无登录弹窗模板 | test:28 | ✅ |
| 5 | §7.10 回跳 next 只允许站内路径 | safeNext 校验 | LoginPage.vue（startsWith('/') && !startsWith('//')）；test:36 | ✅ |
| 6 | §5.3 注册不可用说明 + 返回登录 | /api/site registration 状态 + 页面分支 | RegisterPage.vue；server.js（/api/site）；test:50 | ✅ |
| 7 | §5.5 随机生成 + 临时密码只显示一次 | AdminExtras 断言 | test:68 | ✅ |
| 8 | §7.12 npm test/build/scan + 新测试入主链 | 亲自重跑 | npm test 66 文件/536 项 fail 0；api 22；build ✓；scan 干净 | ✅ |
| 9 | 纪律：无新 tag / 无产物入提交 / 已推 main / OVERVIEW+DELIVERY 同步 | git 取证 | 无新 tag；origin/main=8023f0b | ✅ |
| 10 | 纪律：ElProgress 注册（main.js import + 样式 + app.use 三处） | 静态断言 | main.js；test:50 | ✅ |

## 亲自重跑验证（2026-11-09）

```
npm test               → 66 个文件 / pass 536 / fail 0
node test/api.test.js  → pass 22 / fail 0
npm run frontend:build → ✓ built in 1.06s
npm run scan           → ✅ 未发现高置信度凭据 / 未发现可疑密钥赋值
```

## 打回清单

无。

## 需人工确认

1. 真机浏览器走一遍验收 10 的全部交互（无浏览器级测试，静态断言 + 构建通过为准）；
2. 真实邮箱收到注册验证码（本地假 SMTP 已验证协议对话）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：初检即通过，无打回项。
