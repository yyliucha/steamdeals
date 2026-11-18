# QA：安卓 App 内置更新（BY，第 2 轮）

> 基线 9149a4c → HEAD b54efd3（实现 92cae3e；检查期间仓库 HEAD 被并行会话推进到 65140cf/c5fc536，属 BW/CB 批，与 BY 无关；BY 证据以 92cae3e + b54efd3 为准，并对照当前工作树复核）。
> 判据 [docs/MOBILE-APP-UPDATE.md](MOBILE-APP-UPDATE.md) §6 验收 1–9 + §3/§4/§5；开发描述来源：TODO.md BY 条目 + 92cae3e 提交说明。
> 结论（第 2 轮）：✅ 放行 —— 通过 7 / 缺失 0 / 偏差 0 / 需人工确认 2。第 1 轮：❌ 打回 —— 通过 3 / 缺失 0 / 偏差 4 / 需人工确认 2；8585dba 修复 4 项全核证通过（证据见文末「第 2 轮复检记录」）。

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | BY-1 | App 版本元数据带 `versionCode`/`minVersionCode`/`notes`（缺失返回 null、旧字符串 notes 兼容） | `GET /api/app/latest` + `frontend/public/app/latest.json` | ✅ | latest.json:5-8（21600/21600/notes 数组，与 build.gradle:64、twa-manifest.json `appVersionCode` 三方一致）；server.js:1512-1524；serve.test.js:170-201（透传 deepEqual + 旧清单兼容 + 文件缺失，9/9 pass） |
| 2 | BY-2 | 启动 / 回前台自动检测更新（回前台 24h 一次） | App 启动、App 回前台 | ✅ | 第 2 轮核证：Manifest:29 补 INTERNET（合并产物实证）+ AppUpdater.java:99-100 applicationContext 持活、131 UpdateDialogActivity.start 拉起；真机弹框仍属需人工确认 |
| 3 | BY-2 | 原生「发现新版本」对话框（版本/大小/说明；稍后/忽略此版本；低于 `minVersionCode` 强制不可取消） | App 内弹窗 | ✅ | 第 2 轮核证：独立透明 UpdateDialogActivity 承载（Manifest:177-182；UpdateDialogActivity.java:53-74 按钮/强制分支/dismiss 回调） |
| 4 | BY-2 | 下载更新包（默认仅 Wi-Fi、移动网络二选一、进度轮询、SHA-256 不匹配删除并提示、站点→GitHub 兜底） | 更新对话框 → 系统下载 | ✅ | 第 2 轮核证：AppUpdater.java:198-214 移动网络二选一、233-234 setAllowedOverMetered(allowMetered) 按 KEY_ALLOW_MOBILE 放开；真机下载仍属需人工确认 |
| 5 | BY-2 | 用户确认安装（PackageInstaller 系统确认、Android 8+ 未知来源引导、FileProvider 兜底、同签名覆盖升级） | 下载完成 → 系统安装确认 | 🔎 | AppUpdater.java:392-443（静态实现完整；覆盖升级/数据保留需真机） |
| 6 | BY-3 | 「我的 → 检查更新」手动入口（TWA 内触发检查；浏览器 1.5s 回落 `/app`、切后台取消定时） | 手机「我的」面板 | ✅ | 第 2 轮核证：Manifest:85 singleTop（合并产物实证）；LauncherActivity.java:44-47/62-69 onCreate/onNewIntent 双路径；AppUpdater.java:104-105 手动不写 KEY_LAST_CHECK_AT；Home.vue:78/142-149 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格 §6） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 元数据：latest.json 三字段齐全、透传正确、缺失 null 不报错、旧 /app 页不受影响 | 读文件 + serve.test.js 断言 + 跑测试 | latest.json:5-8；server.js:1505-1526；serve.test.js:148-201（`assert.deepEqual` 全形状 + 旧清单/文件缺失三组断言）；AppDownloadPage 本批未动 | ✅ |
| 2 | 启动检查：装旧包/调高 versionCode → 出现原生「发现新版本」对话框（版本/大小/说明） | 读 AppUpdater/Launcher + Manifest 合并产物 + 父类字节码 | AppUpdater.java:100-124/169-196；LauncherActivity.java:45；**第 1 轮取证：android/app/build/intermediates/merged_manifests/release/AndroidManifest.xml 无 `android.permission.INTERNET`**（App 进程 HttpURLConnection 必炸、被 catch 静默）；**androidbrowserhelper 2.7.4 `LauncherActivity.launchTwa()` → `TwaLauncher.launch(..., lambda$launchTwa$0)` → `finish()`（javap 字节码实证）** → 异步返回时宿主已销毁，AlertDialog 无宿主 | ✅（第 2 轮核证：Manifest:29 INTERNET + 独立 UpdateDialogActivity 宿主；--rerun-tasks 合并产物实证） |
| 3 | 策略：稍后/忽略此版本/同版本不再提示/更高版本再提示/minVersionCode 强制 | 读 AppUpdater | AppUpdater.java:117-118（`ignored == versionCode && !forced` return）、181-195（三按钮/强制单按钮 + `setCancelable(!forced)` + `setCanceledOnTouchOutside(false)`）、57（24h 常量）——逻辑正确，但依赖验收 2 的对话框可用 | ✅（第 2 轮核证：UpdateDialogActivity.java:53-74 三按钮/强制单按钮/dismiss 回调） |
| 4 | 下载：默认仅 Wi-Fi、移动网络弹选择、进度、SHA-256 不匹配删除并提示、失败重试/发布页 | 读 AppUpdater | AppUpdater.java:202-233（isWifi + 二选一弹窗）、294-346（进度轮询 300ms）、348-380（SHA-256 流式校验→删除+提示）、382-390（重试/发布页）；**第 1 轮偏差：enqueueDownload:251 恒 `setAllowedOverMetered(false)` → 「使用流量下载」后下载仍被系统拒绝/挂起，进度框不可取消卡死** | ✅（第 2 轮核证：AppUpdater.java:233-234 按 KEY_ALLOW_MOBILE 放开计量网络） |
| 5 | 安装：系统安装确认、8+ 引导未知来源、同签名覆盖数据保留、不同签名/不递增被拒提示 | 读 AppUpdater + Manifest + filepaths | AppUpdater.java:392-443（canRequestPackageInstalls → 设置引导 → PackageInstaller.commit(null) 系统确认 → FileProvider ACTION_VIEW 兜底）；Manifest:26（REQUEST_INSTALL_PACKAGES）；filepaths.xml:19（updates 路径）；覆盖升级/数据保留真机项 | 🔎（静态 ✅，真机待验） |
| 6 | 手动入口：「我的 → 检查更新」TWA 内触发；浏览器 1.5s 回落 /app | 读 Home.vue + Manifest + 测试 | Home.vue:78（入口）、142-149（scheme + 1.5s + visibilitychange/pagehide 取消）、frontend-mobile.test.js:57-63（断言）；Manifest:159-164（intent-filter）；**第 1 轮取证：Android 侧 LauncherActivity 无 launchMode 且宿主 finish → onNewIntent 不触发，scheme 新实例走 onCreate（manual=false）误写 lastCheckAt，违反 §4.5** | ✅（第 2 轮核证：Manifest:85 singleTop + LauncherActivity.java:44-47/62-69 双路径 + AppUpdater.java:104-105 手动不写节流） |
| 7 | 兜底：站点不可达回落 GitHub Release；两者都失败提示手动更新 | 读 AppUpdater | AppUpdater.java:52/160-167（`app-v<version>` Release URL + 文件名提取）、235-241/281-292（失败自动回落一次，再失败弹重试/发布页）；真机实测项 | 🔎（静态 ✅，真机待验） |
| 8 | 构建：versionCode 单调递增、签名不变、APK 与 latest.json sha256/大小一致 | 三方对账 + 本地算哈希 + gradle | build.gradle:64 = twa-manifest.json appVersionCode = latest.json versionCode = 21600；仓库 APK sha256 `C28203BD…D284FD`、size 1472278 与 latest.json 逐字一致；keystore 未入库未改（.gitignore `*.keystore`）；发版清单 DELIVERY.md:56-61；`gradlew assembleRelease --rerun-tasks` 37 executed BUILD SUCCESSFUL | ✅ |
| 9 | 测试：npm test / frontend:build / scan / Android 构建 | 亲自重跑 | npm test 全链 exit 0（87 测试文件 && 链跑满）；serve.test.js 9/9、frontend-mobile.test.js 8/8 单独复跑全绿；frontend:build ✓ 4.49s（dist/app/latest.json 含新字段 + APK）；scan ✅ 465 文件干净；gradle BUILD SUCCESSFUL（9s 缓存 / 48s --rerun-tasks 全量重编译） | ✅ |

## 打回清单（按严重度排序，可执行）

1. **【必修 P0】`AndroidManifest.xml` 缺 `android.permission.INTERNET`**（合并产物实证只有 REQUEST_INSTALL_PACKAGES）→ `AppUpdater.fetchJson` 的 HttpURLConnection 在真机直接 SecurityException，被 `catch(Exception)` 静默吞掉 → **App 内检查永远失败，验收 1/2/7 的 App 侧全部失效**。补：Manifest 加 `<uses-permission android:name="android.permission.INTERNET"/>`（TWA 本身不依赖它，所以 Bubblewrap 模板没有）。
2. **【必修 P0】更新对话框没有有效宿主**：`LauncherActivity` 继承 androidbrowserhelper 2.7.4 的 TWA LauncherActivity，父类在启动 TWA/CustomTab 后经 `TwaLauncher` 完成回调 `lambda$launchTwa$0` 调 `finish()`（javap 字节码实证）；`AppUpdater` 在后台线程 fetch 后 `activity.runOnUiThread` 弹 AlertDialog → 宿主已销毁 → BadTokenException 崩溃或对话框不可见；`onResume` 检查同命。修（供开发参考，实现方式自由）：需要一个持久宿主——新增透明 Activity（`Theme.Translucent.NoTitleBar` + excludeFromRecents）承载检查结果对话框/下载进度，或改用 Notification/全屏 Intent；同时处理 scheme（见第 4 条）。
3. **【必修偏差】「使用流量下载」无效**：`enqueueDownload`（AppUpdater.java:251）恒 `setAllowedOverMetered(false)`，用户选「使用流量下载」后 DownloadManager 仍在计量网络拒绝/挂起下载，进度对话框不可取消 → 卡死或失败。修：用户确认后该次请求 `setAllowedOverMetered(true)`（保留 `setAllowedOverRoaming(false)`），或按网络策略参数化。
4. **【必修偏差】scheme 手动入口违反 §4.5**：LauncherActivity 无 `launchMode`（standard）且宿主 finish → `steamdeals://check-update` 不会走到 `onNewIntent`，而是新建实例走 `onCreate`（manual=false）→ 手动检查误写 `lastCheckAt`、污染 24h 节流。修：scheme intent-filter 挂到新宿主 Activity，或加 `launchMode` 并保证宿主存活；手动检查必须不写节流时间。
5. 【说明，不判偏差】「检查更新」入口只在手机「我的」面板（Home.vue:78），桌面 web 无入口——与规格目标（App 内用户）一致；若所有者要求桌面也有入口需另行确认。

## 需人工确认（真机，修复 P0 后逐项复核）

- 验收 2/3：启动与回前台弹框、稍后/忽略此版本/更高版本再提示/强制更新返回键不可取消；
- 验收 4：移动网络二选一弹窗、下载进度、SHA-256 不匹配删除+提示、失败重试/发布页；
- 验收 5：安装确认、8+ 未知来源引导、**同签名覆盖升级数据保留**、不同签名被拒；
- 验收 6/7：TWA 内点「检查更新」触发、浏览器 1.5s 回落 `/app`、站点不可达回落 GitHub Release 实测。

## 争议项（待所有者裁定）

- 无。开发如对 P0-1/P0-2 有真机实测证据可提交申辩（申辩需附真机录屏/日志），否则按打回修复。

## 风险提醒（查多）

- 92cae3e 范围内无需求外改动（README 能力表/文档均属 BY-4）；8817207（BW 打回修复）确认属 BW 批，未判；检查期间仓库新增 65140cf（BW 质检通过）、c5fc536（CB 批），与本条无关、未碰其文件。
- 纪律项全过：`git tag --list` 无新增 tag（`app-v2.16.0` 为 BS 批旧 tag）；92cae3e 无构建产物/密钥入库（无 app/build、无 apk、无 keystore；`.gitignore` 仅忽略 `android/app-release*.apk`，交付包路径未被忽略）；已推 main（`main...origin/main` 同步）；docs/PROJECT-OVERVIEW.md BY 行已同步。
- 「本批不做」核对：无静默安装（PackageInstaller/ACTION_VIEW 系统确认）、无 Play、无增量、无推送、包名 `cn.yyliucha.steamdeals`/签名引用未变。✅
- 规格 §1 现状表写「minSdk 21」，实际 build.gradle minSdkVersion 24（BS 批既有状态，非本批改动），仅提示。

## 复检记录

- 第 1 轮（2026-11-16）：打回 4 项（2 P0 必修 + 2 偏差必修）→ 待开发补齐 → 第 2 轮只重查打回项 + 新增 diff + npm test 兜底。
- 第 2 轮（2026-11-16）：8585dba 修复 4 项全核证 + 全链验证绿 → ✅ 放行（通过 7 / 缺失 0 / 偏差 0 / 需人工确认 2）。详见下文。

## 第 2 轮复检记录（2026-11-16，范围 = 打回项 4 + 新增 diff + npm test 兜底）

> 修复提交：8585dba（fix(app)）+ 8d8412b（docs/todo 补哈希）；复查范围 `git diff 65140cf..HEAD`（7 文件，+172/−74）。
> 复查期间仓库 HEAD 被并行会话推进到 13ccd9d/becff89（CB 批打回修复，另一质检在岗），未判、未碰。

### 打回项逐条核证

| # | 打回项 | 修复声明 | 核证证据（文件:行 + 真生效证据） | 判定 |
|---|---|---|---|---|
| P0-① | Manifest 无 INTERNET | 显式补 INTERNET | 源 AndroidManifest.xml:29；**亲自 `--rerun-tasks` 重跑构建后打开合并产物** `android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml`（14:35 生成）含 `android.permission.INTERNET` + `REQUEST_INSTALL_PACKAGES` | ✅ |
| P0-② | 对话框无宿主（LauncherActivity finish） | 独立透明 UpdateDialogActivity | Manifest:177-182 注册（合并产物实证 `exported="false"`/`excludeFromRecents="true"`/`Theme.Translucent.NoTitleBar`）；AppUpdater.java:99-100 `getApplicationContext()` 持活后台线程、131 `UpdateDialogActivity.start(appContext,…)`；UpdateDialogActivity.java:53-74（可选三按钮「立即更新/稍后/忽略此版本」、强制单按钮、忽略写 KEY_IGNORED_VERSION）；dismiss 回调 :70-72 按 `AppUpdater.isDownloading()` 决定 finish；`downloadUiActive` 生命周期 AppUpdater.java:189（进入下载置 true）/193、207、365、382、417、427、430（全部终态路径置 false + finish） | ✅ |
| 偏差-③ | setAllowedOverMetered 恒 false | 按 KEY_ALLOW_MOBILE 条件放开 | AppUpdater.java:198-214（移动网络且未授权先弹二选一；「使用流量下载」→ KEY_ALLOW_MOBILE=true）、233-234 `boolean allowMetered = …getBoolean(KEY_ALLOW_MOBILE,…)` → `req.setAllowedOverMetered(allowMetered)`；静态测试断言 `setAllowedOverMetered\(allowMetered\)` 锁定 | ✅ |
| 偏差-④ | scheme 误写 24h 节流（onNewIntent 不可达） | singleTop + onCreate/onNewIntent 双路径 + 手动不写节流 | Manifest:85 `android:launchMode="singleTop"`（合并产物实证）；LauncherActivity.java:46-47（onCreate `isCheckUpdateIntent(getIntent())` → `checkForUpdate(this,false,manualByScheme)`）、62-69（onNewIntent → `checkForUpdate(this,false,true)`）；AppUpdater.java:104（`!manual && throttled` 才节流）、105（`if (!manual) putLong(KEY_LAST_CHECK_AT…)` 手动不写）；静态测试断言 `if \(!manual\) prefs\.edit\(\)\.putLong\(KEY_LAST_CHECK_AT` 锁定 | ✅ |

### 亲自重跑的验证命令与关键输出

- `node test/frontend-mobile.test.js` → **# tests 8 / # pass 8 / # fail 0**（含 BY-2 新增断言：INTERNET/singleTop/UpdateDialogActivity/applicationContext/手动不写节流/计量网络条件放开）。
- `npm test` → **exit 0**，87 文件 `&&` 链跑满（末位 `test/secrets.test.js` TAP 5/5 +「当前仓库本身是干净的」，链式语义 = 前 86 文件全绿）。
- `npm run frontend:build` → `✓ built in 3.06s`（dist/app/latest.json 含 versionCode 21600 等新字段）。
- `npm run scan` → ✅ 扫描 467 文件，未发现高置信度凭据。
- `cd android && .\gradlew.bat assembleRelease --rerun-tasks --console=plain` → **BUILD SUCCESSFUL in 1m 10s，37 actionable tasks: 37 executed**（全量重编译，javac 通过；仅既有 deprecation 提示）。合并产物取证见上表 P0-①/②/④。

### 新增 diff 查多（无新回归）

- 65140cf..HEAD 全部 7 个文件均属 BY 修复范围；无构建产物/密钥入库、无新增 tag、无部署配置改动；c5fc536/13ccd9d/becff89（CB）未判。
- 风险提醒（非阻塞）：① scheme 冷启动 + 距上次自动检查 >24h + 有更新时，onCreate 手动检查与 onResume 节流自动检查可能先后各拉一次 UpdateDialogActivity（偶发双弹窗，手动路径本身不写节流时间、符合 §4.5）；② UpdateDialogActivity 由后台线程 startActivity 拉起，若 fetch（≤5s）期间 App 退后台，Android 10+ 可能拦截后台启动（并入需人工确认真机项）；③ installApk「去设置」返回后无重试按钮、透明宿主需按返回键退出（92cae3e 既有，属验收 5 真机项）；④ docs/PROJECT-OVERVIEW.md BY 行未补 UpdateDialogActivity/INTERNET 内部实现细节（功能描述仍准确，建议后续提交补一句，不阻塞）。

### 需人工确认（沿用第 1 轮 + 第 2 轮补充）

1. 真机安装确认 / 同签名覆盖升级数据保留（验收 5）；
2. GitHub 兜底实测（验收 7，含上述风险提醒 ①②③ 的真机复核）。

### 状态回写

- **docs/TODO.md + docs/REQUIREMENTS-INDEX.md 的 BY 行「状态回写待补」**：复查期间 CB 会话（另一质检在岗）持续改写并提交同一文件（becff89/13ccd9d，15:05，2 分钟占用窗口内），按并发占用规则跳过定点替换，交由收尾复盘补写 `质检通过`。
