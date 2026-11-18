# QA：BS 安卓 App（TWA）+ 可清缓存离线 + 双通道分发（第 1 轮）

> 基线 `207d66a` → HEAD `4afc1ac`；判据 [MOBILE-APP-TWA.md](MOBILE-APP-TWA.md) §8 验收（12 条）；
> 开发描述来源：TODO BS 条目 + docs/DEV-SESSION-KICKOFF.md。
>
> 结论：✅ 放行 —— 通过 8 / 缺失 0 / 偏差 0 / 需人工确认 4（真机 6 条 + GitHub Release 1 条为构建后动作）

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | BS | 安卓 App：全屏无地址栏（assetlinks 校验）、图标/启动色与站点一致 | 安装 APK 打开 | 🔎 待真机 | android/twa-manifest.json（themeColor/navigationColor `#0F1524`、packageId `cn.yyliucha.steamdeals`）；assetlinks 指纹与 apksigner 一致（QA 直查：`48:A3:0D:F9…:7A:05` ↔ digest `48a30df9…`） |
| 2 | BS | Steam 外链走 Custom Tabs、返回键回到 App | App 内点外链 | 🔎 待真机 | twa-manifest.json `fallbackType: customtabs`；站内 Steam 链接已 `target="_blank"`（Home.vue 既有） |
| 3 | BS | 可清缓存离线：只缓存 `/assets/*` 与封面图；HTML/API/manifest 永不缓存；断网不返回旧页面 | 全部页面 | ✅ 已交付 | frontend/public/sw.js（`navigate` 直接返回、`cacheable = /assets/* || /img/*`）；test/pwa.test.js:79-103 断言 |
| 4 | BS | 版本变化「已更新到 vX.Y.Z，点击刷新」，点刷新清缓存 + SW 更新 + reload | 顶部提示条 | ✅ 已交付 | useVersionGuard.js `applyUpdateRefresh`（caches.delete 全部 → registration.update → reload）；App.vue `refreshUpdate` 改调它 |
| 5 | BS | `?nosw=1` 停用 SW（排查旧页面） | URL 参数 | ✅ 已交付 | main.js `nosw==='1'` 短路；pwa.test 断言 |
| 6 | BS | `/app` 下载页：版本/大小/SHA-256/安装步骤/已知限制/GitHub 备用 | 首页底部/「我的」→ 安卓版 App | ✅ 已交付 | AppDownloadPage.vue + 路由 `/app`（router 一致性测试覆盖）；Home.vue 两处入口 |
| 7 | BS | `GET /api/app/latest` 返回 `{version,apkPath,sha256,size,releasedAt}` | API（公开） | ✅ 已交付 | server.js（读 frontendDir 下 `app/latest.json`）；test/serve.test.js 断言透传 |
| 8 | BS | APK 入库随镜像：`frontend/dist/app/steamdeals-2.16.0.apk` 在构建产物里 | `npm run frontend:build` | ✅ 已交付 | QA 重跑 build：`frontend/dist/app/steamdeals-2.16.0.apk` 1,472,278 字节存在 |
| 9 | BS | 三个静态白名单 + `/app` 登记：assetlinks.json / sw.js / app/*.apk 200 且 no-cache | 服务端 | ✅ 已交付 | server.js `isFrontendPublicFile` + `FRONTEND_PAGES`；test/serve.test.js BS-1 用例（200/content-type/no-cache）8/8 |
| 10 | BS | android/ 工程入库可复现构建（包名/版本/指纹固定） | 仓库 `android/` | ✅ 已交付 | 42 个文件入库（`git ls-files`）；android/README.md 记录构建步骤与指纹；versionCode 21600 = 2*10000+16*100+0 ✓ |
| 11 | BS | README「安卓版 App」入口 + MOBILE-PWA 旧决策标注被推翻 | README/docs | ✅ 已交付 | README 功能表新增行；MOBILE-PWA.md §1 决策 #1、§3 已标注 |
| 12 | BS | GitHub Release 同名 APK + `.sha256`（与站点包字节一致） | GitHub | ⏳ 构建后动作 | kickoff §三 step 8：等「构建 vX.Y.Z」后执行（README 入口已备） |

## 逐条核对（规格 §8 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 全屏无地址栏、图标/启动色一致 | 静态证据 + 真机 | assetlinks.json 指纹 = apksigner 证书 digest（QA 直查一致）；twa-manifest 颜色 `#0F1524`；store_icon.png 已生成 | 🔎（真机目视） |
| 2 | Steam 外链 → Custom Tabs、返回键回 App | 静态证据 + 真机 | `fallbackType: customtabs`；外链 `target="_blank"`（Home.vue） | 🔎 |
| 3 | 登录态独立（App 与浏览器各自会话） | 代码复核 | 未动会话逻辑；TWA=Chrome 内核，cookie 隔离与浏览器一致 | 🔎（真机验证） |
| 4 | 返回键关浮层 | 代码复核 | 未改路由/浮层逻辑（现有 popstate 逻辑保留） | 🔎 |
| 5 | 版本提示 + 清缓存刷新 | 真跑单测 | test/pwa.test.js（SW 规则 + applyUpdateRefresh 链路静态断言）；applyUpdateRefresh 实现（useVersionGuard.js） | ✅ |
| 6 | 断网不返回旧 HTML/旧数据 | 真跑单测 | sw.js：`req.mode === 'navigate'` 直接放行网络；cacheable 仅 `/assets/`、`/img/`；pwa.test 断言 | ✅（真机观感另列 🔎） |
| 7 | /app 页下载 + SHA-256 校验；/api/app/latest 字段正确 | 真跑单测 | test/serve.test.js（latest.json 透传 + APK 200/content-type/no-cache）；AppDownloadPage.vue 展示 sha256/size | ✅（部署后实际下载 🔎） |
| 8 | assetlinks/sw 200 + 测试断言；FRONTEND_PAGES 含 /app | 真跑单测 | test/serve.test.js BS-1 用例 8/8；router↔白名单一致性含 `/app` | ✅ |
| 9 | GitHub Release 有同名 APK + 校验和；README 有入口 | 复核 | README 入口已加；Release 按 kickoff 顺序在「构建 vX.Y.Z」后执行 | ⏳ 构建后动作（README ✅） |
| 10 | 不放宽安全策略（UA/IP 绑定、限流、封禁不变） | diff 复核 | `git diff 207d66a..4afc1ac` 未触碰会话/限流/封禁相关代码（仅静态白名单、SW、/app 页、android 工程） | ✅ |
| 11 | 镜像内含 APK（dist/app 有包） | QA 重跑 build | `frontend/dist/app/steamdeals-2.16.0.apk` 1,472,278 字节；`git ls-files frontend/public/app` 入库 | ✅ |
| 12 | .gitignore 不忽略交付包 | 直查 | `git check-ignore -v frontend/public/app/steamdeals-2.16.0.apk` → exit 1（未命中）；.gitignore 仅 `android/app-release*.apk` | ✅ |

## 打回清单

无。

## 需人工确认

- 验收 1–4（真机）：装包全屏无地址栏、Custom Tabs 外链与返回、登录态独立、浮层返回键——需所有者真机安装 `steamdeals-2.16.0.apk`（构建部署后 assetlinks 生效）验证；
- 验收 7 的「实际下载并 SHA-256 校验」需部署后（`/app` 页在镜像内）执行；
- 验收 9 GitHub Release 为「构建 vX.Y.Z」之后的动作（kickoff 顺序），本轮未执行、不算缺失。

## 风险提醒（非打回）

- 工具链实际用了 `platforms;android-36`（bubblewrap 模板依赖 androidx.browser 1.10.0 / core-ktx 1.17.0 要求 compileSdk ≥36）与 minSdk 24（androidbrowserhelper 2.7.4 要求）——与 kickoff 列出的 android-35 有出入，已在 android/README.md 说明；
- 签名 keystore 与本机密码文件在仓库外（`C:\Users\Administrator\.steamdeals\`），需所有者另做私有备份（丢失只能换包名重发）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-14）：初检即 ✅ 放行，无打回项。
