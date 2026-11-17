// adb / 模拟器工具（CK 批，docs/E2E-SUITE.md §1 #4、§6.1）：
// 设备预检（真机必须在线否则立即中断）/ 模拟器自动启停 / 安装与覆盖安装 / 点击 / uiautomator dump / 截图。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const AVD_NAME = 'steamdeals35';
export const APP_PACKAGE = 'cn.yyliucha.steamdeals';
export const APP_ACTIVITY = 'cn.yyliucha.steamdeals/.LauncherActivity';
export const UPDATE_CHECK_URI = 'steamdeals://check-update';

// 真机未连接时的连接步骤（规格决策 #4 原文，验收 ② 逐字核对）
export const REAL_DEVICE_STEPS = [
  '请连接手机：',
  '① USB 模式选"传输文件（MTP）"；',
  '② 开发者选项打开 USB 调试 与 USB 调试（安全设置）（小米需要后者才能模拟点击）；',
  '③ 手机上点"允许 USB 调试"。',
];

const ADB_CANDIDATES = ['F:\\Android\\sdk\\platform-tools\\adb.exe', 'adb'];
const EMU_CANDIDATES = ['F:\\Android\\sdk\\emulator\\emulator.exe', 'emulator'];

export function findAdb() {
  return ADB_CANDIDATES.find((p) => {
    if (p === 'adb') {
      const r = spawnSync('adb', ['version'], { stdio: 'ignore' });
      return r.status === 0;
    }
    return existsSync(p);
  });
}
export function findEmulator() {
  return EMU_CANDIDATES.find((p) => {
    if (p === 'emulator') {
      const r = spawnSync('emulator', ['-version'], { stdio: 'ignore' });
      return r.status === 0;
    }
    return existsSync(p);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((done) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    const t = setTimeout(() => {
      child.kill();
      done({ code: null, out, err: err + '\n[timeout]' });
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('close', (code) => {
      clearTimeout(t);
      done({ code, out, err });
    });
  });
}

function failIf(cond, msg) {
  if (cond) {
    const e = new Error(msg);
    e.isE2eAbort = true; // 设备不可用 = 立即中断（规格 §6 判定）
    throw e;
  }
}

export async function adbRaw(args, opts) {
  const adb = findAdb();
  failIf(!adb, '未找到 adb（F:\\Android\\sdk\\platform-tools\\adb.exe 或 PATH）');
  return run(adb, args, opts);
}

/** adb devices 解析：返回在线设备序列号列表。 */
export async function listDevices() {
  const { out } = await adbRaw(['devices']);
  return out
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split('\t')[0].trim())
    .filter((s) => s && !s.startsWith('*'));
}

/** 该序列号是否真正可响应（过滤 adb server 的僵尸条目）。 */
async function isResponsive(serial) {
  try {
    const { out } = await adbRaw(['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { timeoutMs: 10_000 });
    return String(out).trim() === '1';
  } catch {
    return false;
  }
}

/** 清掉所有无响应的僵尸条目/未完成启动的模拟器，返回真正在线的序列号列表。 */
async function liveEmulators() {
  const all = await listDevices();
  const live = [];
  for (const d of all) {
    if (d.startsWith('emulator-')) {
      if (await isResponsive(d)) live.push(d);
      else await adbRaw(['-s', d, 'emu', 'kill']).catch(() => {});
    } else {
      live.push(d); // 真机不查 boot_completed
    }
  }
  return live;
}

/**
 * 设备预检（--device=real）：无在线设备立即中断并打印连接步骤（验收 ②）。
 * 模拟器模式：启动 steamdeals35，等 boot_completed；返回 { serial, startedByUs }。
 */
export async function ensureDevice({ mode = 'emulator', reportDir } = {}) {
  if (mode === 'real') {
    // 真机模式：排除 emulator-* 模拟器序列号，只认真机
    const devices = (await listDevices()).filter((d) => !d.startsWith('emulator-'));
    if (devices.length === 0) {
      const e = new Error(REAL_DEVICE_STEPS.join('\n'));
      e.isE2eAbort = true;
      throw e;
    }
    return { serial: devices[0], startedByUs: false };
  }
  // 模拟器模式：只复用真正完成启动的在线实例（僵尸条目先清掉）
  const live = await liveEmulators();
  if (live.length > 0) {
    return { serial: live[0], startedByUs: false };
  }
    const emu = findEmulator();
    failIf(!emu, '未找到 emulator.exe（F:\\Android\\sdk\\emulator）且无在线设备');
    // detached + stdio ignore：本机沙箱下模拟器子进程的管道 stdio 会被断（qemu 挂起），
    // 进程脱离父进程启动，实测 20s 内即可注册 adb。
    const emuLog = join(reportDir ?? 'F:\\dsh\\e2e-reports', 'emulator.log');
    const { spawn } = await import('node:child_process');
    const child = spawn(emu, ['-avd', AVD_NAME, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot'], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    child.unref();
    await adbRaw(['wait-for-device'], { timeoutMs: 240_000 });
    // 多设备并存时所有后续命令必须绑定 serial（adb 不带 -s 会报 more than one device）
    const serial = (await listDevices())[0];
    const deadline = Date.now() + 420_000;
    while (Date.now() < deadline) {
      const { out: boot } = await adbRaw(['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);
      if (String(boot).trim() === '1') break;
      await sleep(3000);
    }
    const { out: boot2 } = await adbRaw(['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);
    failIf(String(boot2).trim() !== '1', `模拟器 ${AVD_NAME} 420s 内未完成启动（日志：${emuLog}）`);
    // 无头 + 软件渲染下 SystemUI 常 ANR，弹窗会盖住 App：禁掉错误弹窗
    await adbRaw(['-s', serial, 'shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1']).catch(() => {});
    return { serial, startedByUs: true };
}

/** 关闭我们拉起的模拟器（adb emu kill；失败重试一次并给足等待）。 */
export async function shutdownEmulatorIfStarted({ startedByUs, serial }) {
  if (!startedByUs) return;
  for (let i = 0; i < 2; i += 1) {
    await adbRaw(['-s', serial, 'emu', 'kill']).catch(() => {});
    await sleep(4000);
    const left = (await listDevices()).filter((d) => d === serial);
    if (left.length === 0) return;
  }
}

/** 安装 APK；reinstall=true 走 -r（覆盖安装，数据保留——验收 App 覆盖安装）。 */
export async function installApk(apkPath, { reinstall = false } = {}) {
  failIf(!existsSync(apkPath), `APK 不存在：${apkPath}`);
  const { out } = await adbRaw(['install', ...(reinstall ? ['-r'] : []), apkPath], { timeoutMs: 180_000 });
  return out.trim();
}

export async function shell(serial, cmd) {
  const { out, err } = await adbRaw(['-s', serial, 'shell', ...cmd]);
  return `${out}${err}`.trim();
}

export async function tap(serial, x, y) {
  await shell(serial, ['input', 'tap', String(Math.round(x)), String(Math.round(y))]);
}

/** 解析 APK 真实启动 Activity（TWA 与原生版 launcher 名不同，运行时解析不写死）。 */
export async function resolveLauncher(serial, pkg = APP_PACKAGE) {
  const out = await shell(serial, [
    'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', pkg,
  ]);
  const m = String(out).match(/([\w.]+\/[\w.]+)/);
  return m ? m[1] : null;
}

/** 关闭可能盖住 App 的系统弹窗（ANR「Wait」/ 崩溃对话框）。 */
export async function dismissSystemDialogs(serial) {
  await adbRaw(['shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1']).catch(() => {});
  const { out } = await adbRaw(['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml']).catch(() => ({ out: '' }));
  if (/isn't responding|has stopped|keeps stopping/i.test(String(out))) {
    const raw = await adbRaw(['-s', serial, 'exec-out', 'cat', '/sdcard/window_dump.xml']).catch(() => ({ out: '' }));
    const m = String(raw.out).match(/text="(?:Wait|OK|确定)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (m) await tap(serial, (Number(m[1]) + Number(m[3])) / 2, (Number(m[2]) + Number(m[4])) / 2);
  }
}

/** 启动 App 主界面（Activity 运行时解析；先唤醒屏幕/解锁，冷启动后屏锁会挡住）。 */
export async function launchApp(serial) {
  const component = await resolveLauncher(serial);
  if (!component) throw new Error(`无法解析 ${APP_PACKAGE} 的启动 Activity（未安装或包结构变化）`);
  await shell(serial, ['input', 'keyevent', 'KEYCODE_WAKEUP']);
  await shell(serial, ['wm', 'dismiss-keyguard']);
  await dismissSystemDialogs(serial);
  const out = await shell(serial, ['am', 'start', '-W', '-n', component]);
  if (!out.includes('Status: ok') && !out.includes('Complete')) throw new Error(`App 启动失败：${out.slice(0, 200)}`);
  return out;
}

/** 自定义 scheme 触发内置更新检查（BY-3，TWA 世代的入口；原生版未注册时返回失败信息由调用方判定）。 */
export async function launchUpdateCheck(serial) {
  const out = await shell(serial, ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', UPDATE_CHECK_URI, APP_PACKAGE]);
  return out;
}

/** 前台 Activity（dumpsys activity 的 topResumedActivity；mCurrentFocus 会被系统 ANR 弹窗占住，不可靠）。 */
export async function focusedActivity(serial) {
  const out = await shell(serial, ['dumpsys', 'activity', 'activities']);
  const m = String(out).match(/topResumedActivity=ActivityRecord\{[^}]*?([\w.]+)\/([\w.]+)/);
  return m ? `${m[1]}/${m[2]}` : '';
}

/** uiautomator dump → 拉回解析为文本（text/content-desc 拼接），供文字断言。屏灭/弹窗时先唤醒再 dump。 */
export async function uiDump(serial, dumpPath) {
  await adbRaw(['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']).catch(() => {});
  await adbRaw(['-s', serial, 'shell', 'wm', 'dismiss-keyguard']).catch(() => {});
  await dismissSystemDialogs(serial);
  await shell(serial, ['uiautomator', 'dump', '/sdcard/window_dump.xml']);
  const { out } = await adbRaw(['-s', serial, 'exec-out', 'cat', '/sdcard/window_dump.xml']);
  mkdirSync(dirname(dumpPath), { recursive: true });
  writeFileSync(dumpPath, out);
  const texts = [...out.matchAll(/text="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  const descs = [...out.matchAll(/content-desc="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  return [...texts, ...descs];
}

/** 屏幕截图（adb exec-out screencap；二进制经 Buffer 落盘，不走字符串）。 */
export async function screencap(serial, pngPath) {
  mkdirSync(dirname(pngPath), { recursive: true });
  const adb = findAdb();
  const r = spawnSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (!r.stdout?.length) throw new Error(`screencap 失败：${r.stderr?.toString() ?? ''}`);
  writeFileSync(pngPath, r.stdout);
  return pngPath;
}

/** 已安装包版本名（覆盖安装前后对比数据保留用）。 */
export async function packageVersion(serial, pkg = APP_PACKAGE) {
  const out = await shell(serial, ['dumpsys', 'package', pkg]);
  const m = String(out).match(/versionName=([^\s]+)/);
  return m ? m[1] : null;
}
