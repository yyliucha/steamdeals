# 开发会话开场指令（本轮：BS 安卓 App）

> 用途：**整段复制给开发会话**即可开工。
> 时效：BS 交付后本文件可删。
> 事实来源（冲突时以此为准）：`docs/HANDOVER.md`、`docs/TODO.md` 的 **BS**、`docs/MOBILE-APP-TWA.md`。
> 仓库：`F:\dsh\gameprice`（origin `github.com/yyliucha/steamdeals`，分支 `main`）。
> 当前状态：BR / O / BQ 已于 **v2.16.0 发布上线**；**唯一待开发条目就是 BS**。

---

## 一、开工前

```bash
cd F:\dsh\gameprice
git pull --rebase --autostash origin main     # 改动前先拉；冲突停下来报告，禁止强推
gh auth switch --user yyliucha                # 本机 gh 默认活跃账号是 boxiang-sun_shortcut，推送会 403
```

必读顺序：

1. `docs/HANDOVER.md` —— 开工流程、状态词、汇报格式、红线、TODO 占用规则
2. `docs/TODO.md` 的 **BS** 条目
3. `docs/MOBILE-APP-TWA.md` —— 本批规格（§3 TWA / §4 SW 规则 / §5 双通道 / §8 验收 / §9 顺序）
4. 参考：`docs/MOBILE-PWA.md`（现有 PWA 与两条已被 BS 推翻的旧决策）、`docs/BAN-AND-SECURITY-FIXES.md` §11（已上线的限流/白名单口径）

**工具链（2026-11-14 已在本机装好，开发会话不用再装）**：

| 项 | 位置 / 版本 | 备注 |
|---|---|---|
| JDK 17 | `C:\Program Files\Eclipse Adoptium\jdk-17.0.21.9-hotspot` | **本来就有**；机器级 `JAVA_HOME` 已指向它，新开的终端即为 17（老会话可能还残留 11，用前 `java -version` 确认一次） |
| Android SDK | `F:\Android\sdk` | `ANDROID_HOME` / `ANDROID_SDK_ROOT` 已写入**用户环境变量**；PATH 已加 `platform-tools` 与 `cmdline-tools\latest\bin` |
| build-tools | `35.0.0` | `sdkmanager --list_installed` 可见 |
| platform-tools | `37.0.1`（adb 1.0.41） | 真机调试用 |
| platform | `platforms;android-35` | Bubblewrap 默认 target |
| sdkmanager | 19.0（`F:\Android\sdk\cmdline-tools\latest`） | **坑**：最新版 cmdline-tools（16111833）的 `sdkmanager` 会去 dl.google.com 拉 `android-cli.exe`，本机连不上；已把新版挪到 `cmdline-tools\new-16111833`，`latest` 用旧版（`--licenses` 已全部接受） |
| Bubblewrap | `npx -y @bubblewrap/cli@latest` | 无需全局安装；`npx` 已验证可启动 |

4. keystore（开发会话第一步做）：`keytool -genkey -v -keystore android.keystore -alias steamdeals -keyalg RSA -keysize 2048 -validity 10000`
   （**`.gitignore` 只加 `*.keystore` / `*.jks` / `android/local.properties` / `android/app-release*.apk`——不要写 `*.apk`，
   否则交付包提交不进去**；keystore 备份到私有位置，丢了只能换包名重发）。

---

## 二、本批要做的事（BS，三块）

| 块 | 内容 | 规格节 |
|---|---|---|
| **A. TWA 打包** | 包名 `cn.yyliucha.steamdeals`；Bubblewrap `init/build`；`android/` 工程入库；versionName 跟随 `/api/site`，versionCode = `major*10000+minor*100+patch`；站内 Steam 链接 `target="_blank"` 交给 Custom Tabs | §3 |
| **B. 可清缓存离线** | service worker：**只**缓存 `/assets/*` 与封面图；**HTML / `/api/*` / manifest 永不缓存**；导航请求始终走网络；版本变化 → 顶部提示 + 刷新时 `caches.delete` + `skipWaiting`；`activate` 清旧版本缓存；`?nosw=1` 可停用 | §4 |
| **C. 双通道分发（APK 入库随镜像）** | 签名包**入库**到 `frontend/public/app/steamdeals-<version>.apk` + `latest.json`（版本/文件名/大小/SHA-256）→ Vite 构建拷进 `dist/` → 随镜像；站点新增 `/app` 下载页（安装步骤/已知限制 + GitHub 备用链接）；`GET /api/app/latest` 读 `latest.json`；GitHub Release 传**同一个包**（tag `app-v<version>`）+ `.sha256`；只保留最近 3 个版本 | §5 |

### 必须改的站点落点（**三个白名单 + 一个页面登记，全是"构建成功但线上 404"的老坑**）

1. `/.well-known/assetlinks.json`（TWA 校验，缺了带地址栏）——`application/json`、`no-cache`，内容含包名 + keystore SHA-256 指纹；
2. `/sw.js`（Vite 输出）；
3. `/app/*.apk`（`no-cache`，避免缓存旧包）；

以上三者都要加进 `src/server.js` 的 `frontendDir` 静态白名单，并在 `test/serve.test.js` 补断言；
新页面 `/app` 必须登记 `FRONTEND_PAGES`（否则硬打开落到旧 `web/` → 纯文本 `not found`）。

前端新增：`frontend/src/pages/AppDownloadPage.vue`、首页/「我的」里的「安卓版 App」入口、SW 注册与版本清理逻辑。

---

## 三、实施顺序（9 步）

1. 工具链就位（JDK 17 + cmdline-tools + SDK）；
2. 服务端静态白名单：`/.well-known/assetlinks.json` / `/sw.js` / `/app/*.apk` + `test/serve.test.js` 断言；
3. service worker（按 §4 规则）+ 版本清理 + `?nosw=1`；
4. `GET /api/app/latest` + `/app` 下载页 + 首页入口；
5. Bubblewrap init/build + 签名 + `apksigner verify --print-certs` 取 SHA-256 回填 assetlinks；
6. 真机验收（规格 §8 第 1–6 条）；
7. **APK 交付入库**：签名包放 `frontend/public/app/` + 写 `latest.json` → 提交推 main
   （**必须在"下令构建"之前**；先构建后放包 = 那版镜像里没有包，页面 404，见规格 §5.3）；
8. 等所有者下令「构建 vX.Y.Z」→ CI 出镜像 → 部署后 `/app` 页可下载；同时把**同一个包**传 GitHub Release（tag `app-v<version>`）+ README「安卓版」入口；
9. 收尾：`MOBILE-PWA.md` §1 决策 #1、§3 标注「已被 BS 推翻，策略见 MOBILE-APP-TWA.md §4」；`DELIVERY.md` 发布步骤补一行「APK 先入库再下令构建」。

---

## 四、验收（规格 §8 全 12 条）

1. 装包后**全屏无地址栏**（assetlinks 校验通过），图标/启动色与站点一致；
2. 点 Steam 外链 → **Custom Tabs** 打开，返回键回到 App；
3. App 内登录成功、刷新保持登录；与手机浏览器**各自独立会话**；
4. 浮层（详情/抽屉/筛选）返回键**关闭浮层**而不是退出 App；
5. 站点版本升级后出「已更新到 vX.Y.Z，点击刷新」，刷新后缓存清空取新版本；
6. 断网：**不返回旧 HTML/旧数据**，显示「网络不可用」；
7. `/app` 页可下载并校验 SHA-256；`/api/app/latest` 字段正确；
8. `assetlinks.json`、`sw.js` 均 200 且有测试断言；`FRONTEND_PAGES` 含 `/app`；
9. GitHub Release 有同名 APK + 校验和，README 有入口；
10. **不放宽任何安全策略**（UA/IP 绑定、限流、封禁不变）；
11. **镜像内含 APK**：构建产物里有 `frontend/dist/app/steamdeals-<version>.apk`，部署后 `/app` 直接可下载（不需要额外部署步骤）；
12. `.gitignore` 只忽略 `android/app-release*.apk`：`git check-ignore -v frontend/public/app/*.apk` 必须**不命中**。

---

## 五、硬约束（红线）

- **不自行打站点 tag + 不触发站点构建**：站点侧改动只到「提交推 main + 状态改已实现待发版」；
- **不碰服务器、不动生产数据**（APK 上传/nginx 放行属部署侧，交给所有者）；
- **没跑过的验证不许说"做完了"**，每批必须真跑并贴输出：

```bash
npm test                 # 全量
npm run frontend:build   # 前端构建
npm run scan             # 密钥扫描
```

- 不引新依赖（运行时只有 `pg` / `undici` / `@electric-sql/pglite`）；PG 15 语法上限；Element Plus 组件必须注册；
- 改状态只改两处：`docs/TODO.md` 的 BS 状态行 + `docs/REQUIREMENTS-INDEX.md` 的 BS 行；
- 写 TODO/INDEX 前先探测占用（`git status --short`、`LastWriteTime` 2 分钟内被改、`.git/index.lock`）。

---

## 六、状态流转与汇报

| 阶段 | TODO 状态 | 谁做 |
|---|---|---|
| 开工 | `待开发` →（被占用时）`开发中` | 开发 |
| 代码写完 + 本地验证通过 | `已实现待发版`（补提交哈希 + APK 版本/指纹） | 开发 |
| 交质检 | `待质检` | 开发 → 调 `steamdeals-qa` |
| 质检结论 | `质检通过` / `质检打回`（打回写摘要，修完重检） | 质检 |
| 所有者发「构建 vX.Y.Z」后 | 站点侧 `已发布 vX.Y.Z`；App 侧另记 `app-vX.Y.Z` | 开发 / 部署 |

对话里必须给：

```
✅ 已做：BS <一句话> —— 验证：<命令> → <关键输出>
⏳ 未做：<项> —— 原因：<工具链未就绪 / 等所有者真机 / 依赖 XX>
📄 状态更新：docs/TODO.md BS 状态 = <新状态>；REQUIREMENTS-INDEX 同步
🧪 质检：第 N 轮 → <结论>（报告 docs/QA-*.md）
🔖 提交：<短哈希>；APK：<versionName>/<versionCode>；SHA-256：<指纹前 16 位>
```

---

## 七、本项目踩过的坑（别再踩）

- 静态白名单：`frontendDir` 只放行已知路径，新路径不加 → **构建成功、线上 404**（manifest/图标、`/login` 都踩过）；
- `v-for` 与 `v-if` 同元素导致渲染抛错（BN 事故）；
- `??` 遇空字符串不回退 → 配置回退链用 `||`；
- ES module 提升：`mount` 前的 `router.replace` 无效；
- 加 SW 后最容易出「看到旧页面」——本批已用「只缓存 hash 资源 + HTML/API 不缓存 + 版本清缓存 + `?nosw=1`」四道闸挡住，别私自放宽；
- 日志事件名用「域.动作」，失败带原因。

---

## 八、最小版（只发一行时用这个）

```
按 docs/TODO.md 的 BS（状态：待开发）开工。
先读 docs/HANDOVER.md → docs/MOBILE-APP-TWA.md；
顺序按规格 §9（工具链 → 三个静态白名单+测试 → SW → /app 下载页 → Bubblewrap 打包 → 真机验收 → Release → 收尾标注 MOBILE-PWA 旧决策）。
做完改 BS 状态为「已实现待发版」+ 补 APK versionCode/SHA-256，调 steamdeals-qa，按 HANDOVER §3 汇报「已做/未做/状态更新」。
```



