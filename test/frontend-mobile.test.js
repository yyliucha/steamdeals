// 手机端适配修复（docs/MOBILE-FIX.md）：静态断言守住根因——
// vw 不受 zoom 影响（真机 980 视口下 100vw 仍是 980，详情弹窗右侧被裁），
// 全屏样式必须改回 %/dvh；mobile-layout 死规则删除；桌面模式提示与安装入口存在；
// 后台卡片分支与滑动提示存在；main.js 的 zoom 兜底保留（Z 批不改公式）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const home = readFileSync(ROOT + 'frontend/src/pages/Home.vue', 'utf8');
const mainJs = readFileSync(ROOT + 'frontend/src/main.js', 'utf8');
const mainCss = readFileSync(ROOT + 'frontend/src/styles/main.css', 'utf8');
const adminModules = readFileSync(ROOT + 'frontend/src/pages/AdminModules.vue', 'utf8');
const installPrompt = readFileSync(ROOT + 'frontend/src/composables/useInstallPrompt.js', 'utf8');

test('Home.vue 不再用 100vw/100vh 撑全屏，mobile-layout 死规则已删', () => {
  assert.ok(!home.includes('100vw'), '100vw 不受 zoom 影响，是详情弹窗右侧被裁的根因，必须清零');
  assert.ok(!home.includes('100vh'), '100vh 同理（改用 100%/100dvh）');
  assert.ok(!home.includes('mobile-layout'), 'html.mobile-layout 的 class 从未被添加，死规则必须删除');
  assert.match(home, /100dvh/, '全屏高度用 dvh 兜底');
  assert.match(home, /max-width:100%/, '图片与弹窗都要限宽');
});

test('main.css 全局防横向溢出 + dvh 基线 + 后台表格滑动提示', () => {
  assert.match(mainCss, /overflow-x:hidden/, 'html/body 必须防横向拖动');
  assert.match(mainCss, /min-height:100dvh/, 'storefront 用 dvh（100vh 保留作 fallback）');
  assert.match(mainCss, /左右滑动查看更多/, '其余表格的滑动提示文案存在');
});

test('main.js 保留 zoom 兜底（桌面版网站渲染补偿，Z 批不改公式）', () => {
  assert.match(mainJs, /document\.documentElement\.style\.zoom/, 'zoom 兜底必须保留');
  assert.match(mainJs, /innerWidth \/ window\.screen\.width/, 'zoom 公式保持 innerWidth/screen.width');
});

test('桌面模式提示条与安装入口（B/C）', () => {
  assert.match(home, /桌面版网站/, '桌面模式提示文案存在');
  assert.match(home, /dismissDesktopHint/, '提示条可关闭（sessionStorage）');
  assert.match(home, /安装到桌面/, '安装按钮存在');
  assert.match(home, /useInstallPrompt/, 'Home 使用安装提示 composable');
  assert.match(installPrompt, /beforeinstallprompt/, '监听 beforeinstallprompt');
  assert.match(installPrompt, /appinstalled/, '监听 appinstalled');
  assert.match(installPrompt, /display-mode: standalone/, 'standalone 判定');
});

test('AdminModules 手机卡片分支存在，断点 760 响应式', () => {
  assert.match(adminModules, /game-card-list/, '卡片列表分支存在');
  assert.match(adminModules, /v-if="!isMobile"/, '桌面端保留表格');
  assert.match(adminModules, /max-width: 760px/, '手机断点 760');
  assert.match(adminModules, /addEventListener\('change'/, '断点变化监听（resize/旋转）');
  // 游戏目录 + 访问记录各 tab（访问明细/待审/最近设备/已封设备/黑名单/白名单/自动封禁）都要有卡片分支
  const cardBranches = (adminModules.match(/v-else class="game-card-list"/g) || []).length;
  assert.ok(cardBranches >= 8, `访问记录各 tab 都要有卡片分支，实际 ${cardBranches}`);
});

// ---------------------------------------------------------------- BY 批（docs/MOBILE-APP-UPDATE.md §4.5/§5）
// 「我的 → 检查更新」：自定义 scheme 拉起 App 检查逻辑，浏览器 1.5s 回落 /app；
// Android 侧（AppUpdater/LauncherActivity/Manifest/文件路径）静态断言锁关键契约。

test('BY-3：Home.vue「我的」面板有检查更新入口（scheme + 1.5s 回落 /app + 切后台取消）', () => {
  assert.match(home, /检查更新/, '「我的」面板入口文案');
  assert.match(home, /steamdeals:\/\/check-update/, '自定义 scheme 拉起 App 检查');
  assert.match(home, /setTimeout\(\(\)=>\{router\.push\('\/app'\);?\},1500\)/, '浏览器 1.5s 回落 /app');
  assert.match(home, /cancelUpdateFallback/, '切后台/卸载时取消回落定时');
});

test('BY-2：Android 更新模块关键契约——检查/对话框/下载/校验/安装/权限/scheme', () => {
  const updater = readFileSync(ROOT + 'android/app/src/main/java/cn/yyliucha/steamdeals/AppUpdater.java', 'utf8');
  const dialogAct = readFileSync(ROOT + 'android/app/src/main/java/cn/yyliucha/steamdeals/UpdateDialogActivity.java', 'utf8');
  const launcher = readFileSync(ROOT + 'android/app/src/main/java/cn/yyliucha/steamdeals/LauncherActivity.java', 'utf8');
  const manifest = readFileSync(ROOT + 'android/app/src/main/AndroidManifest.xml', 'utf8');
  const filepaths = readFileSync(ROOT + 'android/app/src/main/res/xml/filepaths.xml', 'utf8');
  const gradle = readFileSync(ROOT + 'android/app/build.gradle', 'utf8');

  assert.match(updater, /BuildConfig\.VERSION_CODE/, '版本比较用 BuildConfig.VERSION_CODE');
  assert.match(updater, /KEY_IGNORED_VERSION/, '忽略此版本（SharedPreferences）');
  assert.match(updater, /CHECK_THROTTLE_MS = 24L/, '回前台 24h 节流');
  assert.match(updater, /!manual \&\& throttled/, '启动/手动不受节流');
  assert.match(updater, /if \(!manual\) prefs\.edit\(\)\.putLong\(KEY_LAST_CHECK_AT/, '手动检查不写已检查时间');
  assert.match(updater, /minVersionCode > currentCode/, '低于 minVersionCode 强制');
  assert.match(updater, /DownloadManager/, 'DownloadManager 下载');
  assert.match(updater, /setAllowedOverMetered\(allowMetered\)/, '选择使用流量后才放开计量网络');
  assert.match(updater, /SHA-256|MessageDigest/, 'SHA-256 校验');
  assert.match(updater, /PackageInstaller/, 'PackageInstaller 安装');
  assert.match(updater, /canRequestPackageInstalls/, 'Android 8+ 未知来源引导');
  assert.match(updater, /isAllowedUrl/, 'https + 白名单主机');
  assert.match(updater, /githubFallbackUrl|GITHUB_RELEASE/, 'GitHub Release 兜底');
  assert.match(updater, /getApplicationContext\(\)/, '检查用 applicationContext 持活（TWA 宿主会 finish）');
  // 对话框宿主：独立透明 Activity（LauncherActivity 启动 TWA 后即 finish，弹窗必须有宿主）
  assert.match(dialogAct, /class UpdateDialogActivity extends Activity/, '独立弹窗 Activity');
  assert.match(dialogAct, /发现新版本 v/, '原生对话框文案');
  assert.match(dialogAct, /EXTRA_FORCED/, '强制更新标记透传');
  assert.match(manifest, /android:name="\.UpdateDialogActivity"/, '弹窗 Activity 注册');
  assert.match(manifest, /android\.permission\.INTERNET/, '应用进程联网权限（检查/下载必需）');
  assert.match(manifest, /android:launchMode="singleTop"/, 'singleTop 使 onNewIntent 可达');
  assert.match(launcher, /AppUpdater\.checkForUpdate\(this, false, false\)|checkForUpdate\(this, false, manualByScheme\)/, '启动时检查');
  assert.match(launcher, /AppUpdater\.checkForUpdate\(this, true, false\)/, '回前台检查（24h 节流）');
  assert.match(launcher, /isCheckUpdateIntent/, 'scheme 手动检查（onCreate + onNewIntent 双路径）');
  assert.match(manifest, /REQUEST_INSTALL_PACKAGES/, '安装权限声明');
  assert.match(manifest, /android:scheme="steamdeals"/, 'scheme intent-filter');
  assert.match(filepaths, /updates/, 'FileProvider 更新包路径');
  assert.match(gradle, /buildConfig true/, '启用 BuildConfig');
});

test('BY-1：latest.json 契约——新字段齐全且与 BS 字段并存', () => {
  const latest = JSON.parse(readFileSync(ROOT + 'frontend/public/app/latest.json', 'utf8'));
  assert.equal(latest.versionCode, 21600, 'versionCode 沿用 major*10000+minor*100+patch');
  assert.equal(latest.minVersionCode, 21600, 'minVersionCode 存在');
  assert.ok(Array.isArray(latest.notes) && latest.notes.length > 0, 'notes 字符串数组');
  for (const key of ['version', 'apkPath', 'sha256', 'size', 'releasedAt']) {
    assert.ok(key in latest, `旧字段 ${key} 保留`);
  }
});
