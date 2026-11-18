# QA：CA-5 Web 侧（手机前台跳转 /app + 微信提示 + 下载页改版）（第 1 轮）

> 基线 3f7c08b → HEAD 0288db2（feat 09af208 + docs(qa) 0288db2）；判据 [APP-NATIVE.md](APP-NATIVE.md) §5 + CA 条目验收；
> 本轮只判 **CA-5 子批**（CA-1 已质检 ✅ docs/QA-CA1.md；CG 不在范围）。
> 结论：✅ 放行 —— 通过 9 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口 | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | CA-5 | 手机浏览器访问前台（/ 等页面）跳转 App 下载页（302 → /app） | 手机浏览器打开站点首页 | ✅ | src/server.js:946-957；serve.test.js:213（真跑 302 + location=/app） |
| 2 | CA-5 | 跳转开关默认关闭（等 CG 发布后开启）；控制台设置项可热开关 | 控制台 → 系统设置 | ✅ | src/settings.js:85（bool 默认 false）；serve.test.js:213（默认关 200、开 302） |
| 3 | CA-5 | 后台/登录/注册/下载/封禁/申诉/初始化/改密与接口不被跳转 | /console、/login、/register、/app、/banned、/appeal、/setup、/change-password、/api/* | ✅ | src/server.js:946（MOBILE_REDIRECT_EXEMPT）；serve.test.js:213（豁免路径断言） |
| 4 | CA-5 | 桌面浏览器行为不变（不跳转） | 桌面访问 | ✅ | serve.test.js:213（桌面 UA 200） |
| 5 | CA-5 | 微信内置浏览器显示「右上角 → 在浏览器打开」提示，不提供下载 | 微信内打开 /app | ✅ | AppDownloadPage.vue:10-18（isWeChat 分支 + 提示文案）；frontend-mobile.test.js:120 |
| 6 | CA-5 | /app 下载页改版为主推原生 App（版本/大小/SHA-256/安装步骤/已知限制），保留现有 APK 下载与 GitHub 兜底 | /app | ✅ | AppDownloadPage.vue:6,31（原生文案 + 下载按钮）；latest.json 接口不变 |
| 7 | CA-5 | 旧版（TWA 2.x）用户可同包名同签名覆盖安装（页面有说明） | /app 安装步骤 | ✅ | AppDownloadPage.vue（覆盖安装步骤文案） |
| 8 | CA-5 | 跳转日志带域名规范（http.mobile_redirect，含 ip/path） | 服务端日志 | ✅ | src/server.js:954 |
| 9 | CA-5 | 站点侧验证全绿：npm test / frontend:build / scan | 测试与构建 | ✅ | npm test exit 0；frontend:build ✓；scan ✅ 无凭据（QA 重跑） |

## 逐条核对（APP-NATIVE §5 + CA 验收 → 证据）

| # | 条目 | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | 手机 UA 前台页面 → 展示/跳转 /app | 读代码 + 真跑 | src/server.js:946-957（GET + isMobileUa + FRONTEND_PAGES + 302 /app + no-store）；serve.test.js:213 | ✅ |
| 2 | 开关默认关闭、等 CG 发布后开启 | 读设置 def + 真跑 | src/settings.js:85（default false）；serve.test.js 默认关 200 断言 | ✅ |
| 3 | 豁免 /console、/login、/register、/app、/banned、/appeal、/api/* | 读正则 + 真跑 | src/server.js:946；serve.test.js 8 个豁免路径 + /api/site 断言不跳 /app | ✅ |
| 4 | 微信内「在浏览器打开」提示页 | 读前端 + 静态断言 | AppDownloadPage.vue:10-18,71；frontend-mobile.test.js:120 | ✅ |
| 5 | /app 页改版（主推原生 App、暂保留现有 APK 下载） | 读前端 + 静态断言 | AppDownloadPage.vue:6,31（原生文案 + 下载 APK 保留）；frontend-mobile.test.js:120 | ✅ |
| 6 | 旧 TWA 停发归 CG 收尾（本批不碰 android/） | git 取证 | 本批 diff 无 android/ 文件（git show 09af208 --stat） | ✅ |
| 7 | 桌面/移动 Web 行为符合 §5 | 真跑 | serve.test.js 桌面 UA 200 + 移动 UA 302 对照 | ✅ |
| 8 | 设置项落设置页（site 分组，非仅 env） | 读 settings def | src/settings.js:85（group 'site'）；settings.test.js/setup.test.js 计数 86 | ✅ |
| 9 | 微信 UA（iPhone+MicroMessenger）同样被判定为移动端 | 真跑 | serve.test.js:213（WECHAT UA 302） | ✅ |

## 四方一致检查

- **后端**：settings.js def ↔ server.js 读 `process.env.APP_MOBILE_REDIRECT_ENABLED`（水合链路：库 > env > 默认）✅
- **前端**：AppDownloadPage.vue 消费 /api/app/latest（接口未变）✅
- **测试**：serve.test.js 真跑锁行为（开/关/豁免/微信/桌面/no-store 六态），frontend-mobile.test.js 静态锁页面文案，settings/setup 锁 86 项 ✅
- **文档**：TODO CA 条目状态/进度行、INDEX 行、APP-NATIVE 头部状态、PROJECT-OVERVIEW CA 行均已同步 ✅

## 纪律项

- `git tag --list`：无新增 tag ✅
- diff 未碰部署/服务器配置/凭据 ✅
- 构建产物未进提交（frontend/dist 未 add）✅
- 已推 main（09af208 + 0288db2）✅

## 需人工确认

- **上线后真机回归**：手机浏览器访问首页跳 /app、微信内提示页、控制台开关热生效、桌面不变——本地已用真实 HTTP 服务 + 三类 UA 全测，真机端到端（CDN/代理层无缓存干扰）部署后按 §5 复核一次。

## 复检记录

- 第 1 轮（2026-11-17）：初检一次通过。开发期间修复 2 处（settings 计数漏改 setup.test.js 的 85→86；node_modules 被并发会话破坏导致误报，npm install 恢复后全绿）。
