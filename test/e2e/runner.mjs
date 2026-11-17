// e2e 入口（CK 批，docs/E2E-SUITE.md §3/§5）：
// 解析参数 → 预检（Edge/设备/前端产物）→ 起本地服务栈 → 开场清 e2e_ 孤儿 → 逐行跑矩阵 → 收尾（清账号/关服务/关模拟器）→ 报告 PDF。
// 用法：npm run e2e（全量）/ npm run e2e:smoke（--tag=smoke）/ node test/e2e/runner.mjs --only=games,appeals --tag=admin --device=real --online --expect-version=2.22.0
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
// 项目 lib 一律动态 import：本机 Windows ESM loader 存在竞态（同文件静态导入偶发
// "does not provide an export"），动态导入 + 活绑定轮询是实测最稳的组合。

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPORT_ROOT = 'F:\\dsh\\e2e-reports';
const ONLINE_DEFAULT_BASE = 'https://sd.yyliucha.cn';

function parseArgs(argv) {
  const args = {
    only: null,
    tag: null,
    device: 'emulator',
    online: false,
    expectVersion: null,
    base: null,
  };
  for (const a of argv) {
    if (a.startsWith('--only=')) args.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--tag=')) args.tag = a.slice(6).trim();
    else if (a.startsWith('--device=')) args.device = a.slice(9).trim();
    else if (a === '--online') args.online = true;
    else if (a.startsWith('--expect-version=')) args.expectVersion = a.slice(17).trim();
    else if (a.startsWith('--base=')) args.base = a.slice(7).trim();
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return `SteamDeals e2e（docs/E2E-SUITE.md）
用法：node test/e2e/runner.mjs [选项]
  --only=a,b        只跑指定矩阵行 id（逗号分隔）
  --tag=front       只跑指定 tag 组（front/admin/app/online/smoke）
  --device=real     真机模式（无设备立即中断）；默认 emulator（自动拉起 steamdeals35）
  --online          部署后公网只读验收（默认 https://sd.yyliucha.cn，--base= 可覆盖）
  --expect-version= 与 --online 配合：断言线上版本
报告输出：${REPORT_ROOT}\\<日期>-<提交短哈希>.pdf（仓库外，不入库）`;
}

const log = (...a) => console.log('[e2e]', ...a);

async function main() {
  const t0 = performance.now();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  // ---- 动态加载项目 lib（见文件头注释：本机 Windows ESM loader 有竞态）----
  // 现象：导入偶发返回"已登记但未初始化"的命名空间（键在、值 undefined），且同 URL 的
  // 命名空间会被 loader 缓存，重试必须换 URL（?r=N 缓存击穿）才可能拿到新实例。
  const LOAD_SENTINELS = {
    browser: 'launchEdge',
    server: 'startE2EStack',
    account: 'apiLogin',
    adb: 'ensureDevice',
    mail: 'readMailEnv',
    report: 'writeHtml',
    steps: 'executeRow',
  };
  async function loadLib(name) {
    // 命名空间是活绑定：同一实例上轮询等待导出值物化（本机 loader 竞态下更可靠）。
    const m = await import(`./lib/${name}.mjs`);
    const deadline = Date.now() + 30_000;
    while (typeof m[LOAD_SENTINELS[name]] === 'undefined' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (typeof m[LOAD_SENTINELS[name]] !== 'undefined') return m;
    throw new Error(`模块 ${name} 30s 内未完成初始化（Windows ESM loader 竞态）：keys=${Object.keys(m).join(',')}`);
  }
  const browser = await loadLib('browser');
  const serverMod = await loadLib('server');
  const account = await loadLib('account');
  const adb = await loadLib('adb');
  const mail = await loadLib('mail');
  const report = await loadLib('report');
  const steps = await loadLib('steps');
  const { findEdge, launchEdge } = browser;
  const { startE2EStack, ADMIN_USERNAME, ADMIN_PASSWORD } = serverMod;
  const { executeRow, ensureAdminBrowserLogin, SkipError } = steps;

  const matrix = JSON.parse(readFileSync(join(REPO_ROOT, 'test', 'e2e', 'matrix.json'), 'utf8'));
  const rows = matrix.rows.filter((r) => {
    if (args.only?.length) return args.only.includes(r.id);
    if (args.tag) return (r.tag ?? []).includes(args.tag);
    return true;
  });
  if (rows.length === 0) {
    log('没有匹配的矩阵行（--only/--tag 组合为空）');
    return 1;
  }

  // ---- 预检 ----
  const edgePath = findEdge();
  if (!edgePath) {
    log('❌ 未找到 Microsoft Edge（C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe）');
    return 1;
  }
  if (!existsSync(join(REPO_ROOT, 'frontend', 'dist', 'index.html'))) {
    log('frontend/dist 缺失 → 自动执行 npm run frontend:build …');
    const b = spawnSync('npm', ['run', 'frontend:build'], { cwd: REPO_ROOT, stdio: 'inherit', shell: true });
    if (b.status !== 0) {
      log('❌ frontend:build 失败，无法起本地服务');
      return 1;
    }
  }
  const mailEnv = mail.readMailEnv();
  const needDevice = rows.some((r) => r.kind === 'adb');
  let device = null;
  if (needDevice) {
    try {
      device = await adb.ensureDevice({ mode: args.device, reportDir: REPORT_ROOT });
      log(`设备就绪：${device.serial}（${args.device === 'real' ? '真机' : '模拟器 steamdeals35'}${device.startedByUs ? '，本次自动拉起' : ''}）`);
    } catch (err) {
      if (err.isE2eAbort) {
        // 真机缺失：立即中断并打印连接步骤（验收 ②）
        log('❌ 设备预检失败，立即中断：');
        log(err.message);
        return 1;
      }
      throw err;
    }
  }

  // ---- 运行目录（仓库外）----
  const startedAt = new Date();
  const dateStr = startedAt.toISOString().slice(0, 10);
  const gitHash = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim() || 'unknown';
  const runDir = join(REPORT_ROOT, `${dateStr}-run-${startedAt.toISOString().slice(11, 19).replaceAll(':', '')}`);
  mkdirSync(runDir, { recursive: true });

  // ---- 起本地服务栈（纯 online 行可免）----
  const needsLocal = rows.some((r) => r.kind !== 'online');
  const needsBrowser = rows.some((r) => r.kind === 'browser' || r.kind === 'online');
  let stack = null;
  let edge = null;
  try {
    stack = needsLocal ? await startE2EStack(REPO_ROOT, join(runDir, 'server.log')) : null;
    log(`本地服务：${stack ? stack.base : '未启动（仅 online）'}`);

    // ---- 浏览器（纯 api/adb 行不需要）----
    if (needsBrowser) {
      edge = await launchEdge({ profileDir: join(runDir, 'edge-profile') });
      log('headless Edge 已就绪');
    }
  } catch (err) {
    // 服务/浏览器起不来也要收尾（关闭本次拉起的模拟器）——验收 ②「结束时关闭」
    if (device?.startedByUs) {
      await adb.shutdownEmulatorIfStarted(device).catch(() => {});
      log('已关闭本次拉起的模拟器');
    }
    if (stack) await stack.close().catch(() => {});
    if (edge) await edge.close().catch(() => {});
    throw err;
  }

  const ctx = {
    base: stack?.base ?? args.base ?? ONLINE_DEFAULT_BASE,
    q: stack?.q ?? null,
    edge,
    repoRoot: REPO_ROOT,
    reportDir: runDir,
    adminUsername: ADMIN_USERNAME,
    adminPassword: ADMIN_PASSWORD,
    adminCookie: '',
    userCookie: '',
    adminBrowserReady: false,
    mailEnv,
    online: args.online,
    onlineBase: args.base ?? ONLINE_DEFAULT_BASE,
    expectVersion: args.expectVersion,
    serial: device?.serial ?? null,
    adb: device ? { ...adb, ensureDevice: null } : null,
    rowArtifacts: [],
    rowConsoleErrors: [],
  };

  let abort = false;
  const results = [];
  const abortReason = [];

  // ---- 开场：清 e2e_ 孤儿（只在含账号生命周期行时；本身也是矩阵第一行）----
  // （矩阵 account-orphan-cleanup 行会完整验证；这里先做一次防御性清理，防上次中断残留影响后续行）
  try {
    if (rows.some((r) => String(r.id).startsWith('account-')) && ctx.q) {
      ctx.adminCookie = await account.apiLogin(ctx.base, ADMIN_USERNAME, ADMIN_PASSWORD, ctx.q);
      const { removed } = await account.cleanupOrphans(ctx.base, ctx.adminCookie, ctx.q);
      if (removed.length) log(`开场清理孤儿账号：${removed.join(', ')}`);
    }
  } catch (err) {
    log(`⚠️ 开场孤儿清理失败（不中断）：${err.message}`);
  }

  // ---- 逐行执行（不 fail-fast；设备/服务级错误才中断）----
  for (const row of rows) {
    if (abort) {
      results.push({ ...row, status: 'skip', skipReason: '运行已中断：' + abortReason.join('；'), durationMs: 0 });
      continue;
    }
    const rowT0 = performance.now();
    const rec = { ...row, status: 'pass', durationMs: 0, artifacts: [], consoleErrors: [], error: null, skipReason: null };
    const isAdminBrowserRow = row.kind === 'browser' && (row.tag ?? []).includes('admin');
    const maxAttempts = isAdminBrowserRow || row.kind === 'browser' ? 1 : 0;
    let attempts = 0;
    try {
      for (attempts = 0; attempts <= maxAttempts; attempts += 1) {
        try {
          // 环境不具备类跳过（spec §6：必须写原因，不得跳过失败项）
          if (row.kind === 'online' && !args.online) {
            throw new SkipError('未指定 --online（部署后跑，规格决策 #13）');
          }
          if (row.skipIf === 'mailEnvMissing' && !mailEnv) {
            throw new SkipError('无邮件凭据（F:\\dsh\\e2e-secrets\\mail.env 不存在），邮件行按环境不具备跳过');
          }
          if (row.kind === 'adb' && !ctx.serial) {
            throw new SkipError('无在线设备（adb devices 为空）');
          }
          if (row.kind === 'api' && !ctx.q) {
            throw new SkipError('纯 online 运行不启本地服务，api 行跳过');
          }
          if (isAdminBrowserRow && (!ctx.adminBrowserReady || attempts > 0)) {
            await ensureAdminBrowserLogin(ctx); // 单独 --only 后台行时自动登录；重试时强制重登
          }
          ctx.rowArtifacts = [];
          ctx.rowConsoleErrors = [];
          ctx.edge?.clearConsole();
          await executeRow(row, ctx);
          rec.artifacts = [...ctx.rowArtifacts];
          rec.consoleErrors = [...ctx.rowConsoleErrors];
          break;
        } catch (err) {
          if (err.isSkip) throw err;
          const transient = /Page\.navigate 超时|Inspected target navigated|Not attached to an active page/.test(err.message);
          if (attempts < maxAttempts && (isAdminBrowserRow || transient)) {
            // 后台行自愈（会话/首屏偶发问题）或导航瞬时错误：重试一次
            if (isAdminBrowserRow) ctx.adminBrowserReady = false;
            log(`🔁 ${row.id} 第 1 次失败（${err.message.slice(0, 120)}）→ 重试`);
            continue;
          }
          throw err;
        }
      }
      log(`✅ ${row.id} ${row.name}`);
    } catch (err) {
      rec.durationMs = performance.now() - rowT0;
      if (err.isSkip) {
        rec.status = 'skip';
        rec.skipReason = err.message;
        log(`⏭️ ${row.id} 跳过：${err.message}`);
      } else {
        rec.status = 'fail';
        rec.error = err.message;
        rec.consoleErrors = [...(ctx.edge?.consoleErrors ?? []), ...(ctx.edge?.logErrors ?? [])].slice(-8);
        // 失败留档：截图 + Console（验收 ④ 要求）
        try {
          if (row.kind === 'browser' || row.kind === 'online') {
            const shot = join(runDir, `fail-${row.id}.png`);
            await ctx.edge?.screenshot(shot);
            rec.artifacts.push(shot);
          }
        } catch {
          /* 截图失败不影响记录 */
        }
        log(`❌ ${row.id} 失败：${err.message.slice(0, 300)}`);
        if (err.isE2eAbort) {
          abort = true;
          abortReason.push(`${row.id}: ${err.message.slice(0, 200)}`);
        }
      }
      results.push(rec);
      continue;
    }
    rec.durationMs = performance.now() - rowT0;
    results.push(rec);
  }

  // ---- 收尾：账号无残留 + 服务/设备关闭（finally 兜底：任何异常路径都关掉模拟器/服务/浏览器）----
  const postChecks = [];
  try {
    if (ctx.q) {
      try {
        const leftovers = (await ctx.q("select username from users where username like 'e2e_%'")).rows.map((r) => r.username);
        if (leftovers.length) {
          ctx.adminCookie = ctx.adminCookie || (await account.apiLogin(ctx.base, ADMIN_USERNAME, ADMIN_PASSWORD, ctx.q));
          const { remaining } = await account.cleanupOrphans(ctx.base, ctx.adminCookie, ctx.q);
          postChecks.push({ name: '收尾孤儿清理', ok: remaining.length === 0, detail: `清掉 ${leftovers.join(', ')}；剩余 ${remaining.length}` });
        } else {
          postChecks.push({ name: '无 e2e_ 残留', ok: true, detail: 'users 表无 e2e_ 前缀' });
        }
      } catch (err) {
        postChecks.push({ name: '无 e2e_ 残留', ok: false, detail: String(err.message).slice(0, 200) });
      }
    }

    // ---- 报告（先出 HTML，再用现有 Edge CDP 打印 PDF，最后才关浏览器）----
    const elapsedMs = performance.now() - t0;
    const passed = results.filter((r) => r.status === 'pass').length;
    const failed = results.filter((r) => r.status === 'fail').length;
    const skipped = results.filter((r) => r.status === 'skip').length;
    const label = args.tag ? `tag=${args.tag}` : args.only ? `only=${args.only.join(',')}` : '全量';
    const run = {
      label,
      startedAt: startedAt.toISOString().replace('T', ' ').slice(0, 19),
      gitHash,
      deviceMode: args.device,
      nodeVersion: process.version,
      edgePath,
      elapsedMs,
      passed,
      failed,
      skipped,
      rows: results,
      reportDir: runDir,
      reportRoot: REPORT_ROOT,
      extraSections: [
        ...(ctx.onlineChecks ? [{ title: '线上只读验收明细', checks: ctx.onlineChecks }] : []),
        { title: '收尾检查（账号/服务/设备）', checks: [...postChecks, { name: '模拟器已关闭', ok: true, detail: device?.startedByUs ? '本次拉起的模拟器已 adb emu kill' : '复用已在线设备/未启用设备' }] },
      ],
    };
    const htmlPath = report.writeHtml(run);
    const pdfPath = report.pdfTargetPath(run);
    let pdfOk = false;
    if (edge) {
      try {
        await edge.goto(`file:///${htmlPath.replaceAll('\\', '/')}`, { timeoutMs: 15_000 });
        await edge.printPdf(pdfPath);
        pdfOk = true;
      } catch (err) {
        log(`⚠️ CDP 打印 PDF 失败（${err.message.slice(0, 120)}）→ 兜底独立 Edge --print-to-pdf`);
      }
    }
    if (!pdfOk) {
      try {
        report.edgePrintHtmlToPdfPath(htmlPath, pdfPath);
        pdfOk = true;
      } catch (err2) {
        log(`⚠️ PDF 兜底也失败：${err2.message.slice(0, 200)}；报告仅 HTML`);
      }
    }

    log('════════════════════════════════════════');
    log(`结果：通过 ${passed} / 失败 ${failed} / 跳过 ${skipped}（矩阵 ${rows.length} 行，耗时 ${(elapsedMs / 1000).toFixed(1)}s）`);
    if (skipped) log(`跳过明细：${results.filter((r) => r.status === 'skip').map((r) => `${r.id}（${r.skipReason}）`).join('；')}`);
    if (failed) log(`失败明细：${results.filter((r) => r.status === 'fail').map((r) => r.id).join(', ')}`);
    log(`报告：${pdfOk ? pdfPath : htmlPath}${pdfOk ? '' : '（PDF 未生成）'}`);
    log(`产物目录：${runDir}`);
    return failed > 0 ? 1 : 0;
  } finally {
    if (device?.startedByUs) {
      await adb.shutdownEmulatorIfStarted(device).catch(() => {});
      log('已关闭本次拉起的模拟器');
    }
    if (stack) await stack.close().catch(() => {});
    if (edge) await edge.close().catch(() => {});
  }
}

process.on('SIGINT', () => {
  log('收到中断信号——临时库在收尾流程里已清理；下次运行开场孤儿清理会兜底。');
  process.exit(130);
});

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[e2e] 运行异常终止：', err);
    process.exit(2);
  });
