// CJ 批（docs/APP-AUTO-UPDATE-PAGE.md §9）：App Release 自动同步 + /app/dl 白名单路由。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncAppRelease, pruneApks, readLatestMeta } from '../src/app-release.js';

const fakeRelease = (version, assets) => ({
  tag_name: `app-v${version}`,
  assets: assets.map((a) => ({ name: a.name, browser_download_url: a.url })),
});

const fakeFetch = (handlers) => async (url, opts) => {
  const handler = handlers[url] ?? handlers['*'];
  if (!handler) return { ok: false, status: 404 };
  if (handler.error) throw handler.error;
  return { ok: true, status: 200, arrayBuffer: async () => handler.buf, json: async () => handler.json };
};

const tmp = () => join(tmpdir(), `cj-${Date.now()}-${Math.random().toString(36).slice(2)}`);

test('CJ sync：发现新版本下载 latest+APK 并 sha256 校验；同版本跳过；断网保留旧值', async () => {
  const dir = tmp();
  const latestJson = JSON.stringify({ version: '2.19.0', versionCode: 21900, notes: ['a'] });
  const apk = Buffer.from('fake-apk');
  const { createHash } = await import('node:crypto');
  const sha = createHash('sha256').update(apk).digest('hex');
  const handlers = {
    'https://api.github.com/repos/yyliucha/steamdeals-app/releases?per_page=10': { json: [fakeRelease('2.19.0', [
      { name: 'latest.json', url: 'x-latest' },
      { name: 'steamdeals-2.19.0.apk', url: 'x-apk' },
      { name: 'steamdeals-2.19.0.apk.sha256', url: 'x-sha' },
    ])] },
    'x-latest': { buf: Buffer.from(latestJson) },
    'x-apk': { buf: apk },
    'x-sha': { buf: Buffer.from(sha) },
  };
  const r1 = await syncAppRelease({ dir, fetchImpl: fakeFetch(handlers), logger: { info() {} } });
  assert.equal(r1.synced, true);
  assert.equal(r1.version, '2.19.0');
  assert.ok(existsSync(join(dir, 'steamdeals-2.19.0.apk')), 'APK 落盘');
  const r2 = await syncAppRelease({ dir, fetchImpl: fakeFetch(handlers) });
  assert.equal(r2.reason, 'same_version', '同版本跳过');
  // 断网（列表与 latest 都抛错）：保留旧文件、返回 network 而不是抛错
  const r3 = await syncAppRelease({
    dir,
    fetchImpl: fakeFetch({
      'https://api.github.com/repos/yyliucha/steamdeals-app/releases?per_page=10': { error: new Error('network down') },
      'https://api.github.com/repos/yyliucha/steamdeals-app/releases/latest': { error: new Error('network down') },
    }),
  });
  assert.equal(r3.reason, 'network');
  assert.ok(existsSync(join(dir, 'latest.json')), '旧 latest 保留');
  const meta = readLatestMeta(dir);
  assert.equal(meta.data.version, '2.19.0', 'readLatestMeta 读 data 目录');
  rmSync(dir, { recursive: true, force: true });
});

test('CJ prune：只保留最近 3 个 APK', async () => {
  const dir = tmp();
  mkdirSync(dir, { recursive: true });
  for (const v of ['2.16.0', '2.17.0', '2.18.0', '2.19.0']) writeFileSync(join(dir, `steamdeals-${v}.apk`), 'x');
  pruneApks(dir, 3);
  const left = readdirSync(dir).filter((f) => f.endsWith('.apk')).sort();
  assert.deepEqual(left, ['steamdeals-2.17.0.apk', 'steamdeals-2.18.0.apk', 'steamdeals-2.19.0.apk'], '只留最近 3 个');
  rmSync(dir, { recursive: true, force: true });
});

test('CJ 接线：cli 命令/调度默认参数/下载路由白名单/GitHub 兜底链接/镜像回落', async () => {
  const root = join(process.cwd());
  const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  // CO-5/B4-2 第十轮：cmdAppSync 已随 cli 同步类域拆到 src/cli/sync.js，断言按新落点指向
  const cliSync = readFileSync(join(root, 'src', 'cli', 'sync.js'), 'utf8');
  const sched = readFileSync(join(root, 'src', 'scheduler.js'), 'utf8');
  const server = readFileSync(join(root, 'src', 'server.js'), 'utf8');
  // CO-4/B4：/api/app/latest 已随 App 域抽到 src/routes/app.js——readLatestMeta 断言指向新文件。
  const appRoutes = readFileSync(join(root, 'src', 'routes', 'app.js'), 'utf8');
  const page = readFileSync(join(root, 'frontend', 'src', 'pages', 'AppDownloadPage.vue'), 'utf8');
  assert.match(cliSync, /app-sync/, 'CLI 命令');
  assert.match(sched, /name: 'app-release-sync'/, '调度任务');
  assert.match(sched, /APP_RELEASE_SYNC_INTERVAL_MIN, 15/, 'DR 批（docs/APP-INSTANT-UPDATE.md）：默认 15 分钟（原 CJ 60 分钟）');
  assert.ok(!/STEAM_HEAVY = new Set\(\[[\s\S]{0,300}'app-release-sync'/.test(sched), '轻任务不进 STEAM_HEAVY');
  assert.ok(server.includes('steamdeals-[\\d.]+'), '下载路由白名单（仅 steamdeals-x.y.z.apk）');
  assert.match(appRoutes, /readLatestMeta\(process\.env\.APP_DATA_DIR \?\? 'data\/app', file\)/, 'latest 优先读 data/app（在 routes/app.js）');
  assert.match(appRoutes, /appApkPathFor\(data\?\.version, frontendDir\) \?\? githubApkUrl\(data\?\.version\)/, 'apkPath 派生：data/app → 镜像 → GitHub 直链（在 routes/app.js）');
  assert.match(server, /application\/vnd\.android\.package-archive/, 'APK Content-Type');
  assert.match(server, /50 \* 1024 \* 1024/, '≤50MB 上限');
  assert.match(server, /req\.method === 'HEAD'/, 'HEAD 可用');
  assert.match(page, /steamdeals-app\/releases/, 'GitHub 兜底指向 steamdeals-app');
});

// DK 批（docs/TODO.md DK）：apk_download 失败——latest.json 已更新、APK 缺失时带 apkFailed 标记
// （cmdAppSync 据此抛错让健康条显红），同时不删旧文件、不 5xx；GitHub 直链兜底 URL 拼装。
test('DK：APK 下载失败带 apkFailed 标记且 latest 已更新；githubApkUrl 直链拼装', async () => {
  const dir = tmp();
  const latestJson = JSON.stringify({ version: '2.20.0', versionCode: 22000, notes: ['a'] });
  const handlers = {
    'https://api.github.com/repos/yyliucha/steamdeals-app/releases?per_page=10': { json: [fakeRelease('2.20.0', [
      { name: 'latest.json', url: 'x-latest' },
      { name: 'steamdeals-2.20.0.apk', url: 'x-apk' },
    ])] },
    'x-latest': { buf: Buffer.from(latestJson) },
    'x-apk': { error: new Error('assets timeout') },
  };
  const r = await syncAppRelease({ dir, fetchImpl: fakeFetch(handlers), logger: { info() {} } });
  assert.equal(r.synced, true, 'latest 已更新仍算同步完成');
  assert.equal(r.apkFailed, 'apk_download', 'APK 下载失败带 apkFailed 标记（健康条可见）');
  assert.equal(r.apk, null);
  assert.equal(JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8')).version, '2.20.0', 'latest.json 已更新（接口可公告新版本）');
  // 直链拼装：合法版本 → GitHub Release 下载 URL；空/非法 → null
  const { githubApkUrl } = await import('../src/app-release.js');
  assert.equal(githubApkUrl('2.20.0'), 'https://github.com/yyliucha/steamdeals-app/releases/download/app-v2.20.0/steamdeals-2.20.0.apk');
  assert.equal(githubApkUrl(null), null, 'version 缺失 → null');
  assert.equal(githubApkUrl('v2.20.0'), null, '非法版本格式 → null（防注入）');
  assert.equal(githubApkUrl('2.20.0', 'other/repo'), 'https://github.com/other/repo/releases/download/app-v2.20.0/steamdeals-2.20.0.apk', 'repo 可注入');
  rmSync(dir, { recursive: true, force: true });
});

// DK 批 D（docs/TODO.md DK D）：同版本但本地 APK 缺失 → 不得 same_version 跳过，重新下载补齐；
// Release 无 APK 资产时同版本仍跳过（原语义）。反向自检：把跳过条件里的 existsSync 检查删掉 →
// 「APK 缺失重新补齐」用例红（返回 same_version）。
test('DK D：同版本但 APK 缺失重新下载补齐；无 APK 资产仍跳过', async () => {
  const dir = tmp();
  const latestJson = JSON.stringify({ version: '2.20.0', versionCode: 22000, notes: ['a'] });
  const apk = Buffer.from('fake-apk');
  const { createHash } = await import('node:crypto');
  const sha = createHash('sha256').update(apk).digest('hex');
  const handlers = {
    'https://api.github.com/repos/yyliucha/steamdeals-app/releases?per_page=10': { json: [fakeRelease('2.20.0', [
      { name: 'latest.json', url: 'x-latest' },
      { name: 'steamdeals-2.20.0.apk', url: 'x-apk' },
      { name: 'steamdeals-2.20.0.apk.sha256', url: 'x-sha' },
    ])] },
    'x-latest': { buf: Buffer.from(latestJson) },
    'x-apk': { buf: apk },
    'x-sha': { buf: Buffer.from(sha) },
  };
  // 首轮：完整同步（latest + APK 落盘）
  const r1 = await syncAppRelease({ dir, fetchImpl: fakeFetch(handlers), logger: { info() {} } });
  assert.equal(r1.synced, true);
  assert.ok(existsSync(join(dir, 'steamdeals-2.20.0.apk')));
  // 同版本 + APK 在 → 跳过（原语义不回归）
  const r2 = await syncAppRelease({ dir, fetchImpl: fakeFetch(handlers) });
  assert.equal(r2.reason, 'same_version', '同版本 + APK 在 → 跳过');
  // 模拟上轮 apk_download 失败：删掉 APK 但保留 latest.json → 不得跳过，重新下载补齐
  rmSync(join(dir, 'steamdeals-2.20.0.apk'));
  const r3 = await syncAppRelease({ dir, fetchImpl: fakeFetch(handlers), logger: { info() {} } });
  assert.equal(r3.synced, true, '同版本但 APK 缺失 → 不跳过');
  assert.equal(r3.apk, 'steamdeals-2.20.0.apk');
  assert.ok(existsSync(join(dir, 'steamdeals-2.20.0.apk')), 'APK 重新下载补齐（同步自愈）');
  // Release 无 APK 资产 + 同版本 → 仍跳过（无 APK 可下，不空转）
  const noApkHandlers = {
    'https://api.github.com/repos/yyliucha/steamdeals-app/releases?per_page=10': { json: [fakeRelease('2.20.0', [
      { name: 'latest.json', url: 'x-latest' },
    ])] },
    'x-latest': { buf: Buffer.from(latestJson) },
  };
  rmSync(join(dir, 'steamdeals-2.20.0.apk'));
  const r4 = await syncAppRelease({ dir, fetchImpl: fakeFetch(noApkHandlers) });
  assert.equal(r4.reason, 'same_version', 'Release 无 APK 资产 + 同版本 → 仍跳过');
  rmSync(dir, { recursive: true, force: true });
});

// CO-1/A5（docs/DESIGN-AUDIT.md A5）：app-release-sync 失败不再静默——入 TRACKED_COMMANDS 写 sync_runs，
// 真正的失败（网络/接口/资产缺失）抛错让调度任务显红；同版本跳过/无新 Release 属正常不算失败。
test('CO-1/A5：app-sync 失败可见——写 sync_runs 且真失败抛错，正常跳过不抛', () => {
  const root = join(process.cwd());
  // CO-5/B4-2 第十轮：app-sync 随 cli 同步类域拆到 src/cli/sync.js——trackedCommands 字面量断言改指新文件，
  // cli.js 侧改为接线断言（TRACKED_COMMANDS 展开域命令，写 sync_runs 语义保持）。
  const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  const cliSync = readFileSync(join(root, 'src', 'cli', 'sync.js'), 'utf8');
  const sched = readFileSync(join(root, 'src', 'scheduler.js'), 'utf8');
  assert.match(cliSync, /'app-sync': cmdAppSync/, 'app-sync 进域 trackedCommands（失败写 sync_runs 才有原因）');
  assert.match(cliSync, /'steam-discovery': cmdSteamDiscovery/, 'steam-discovery 同样入域 trackedCommands');
  assert.match(cli, /\.\.\.syncDomain\.trackedCommands/, 'cli.js 的 TRACKED_COMMANDS 展开域命令（注册表语义保持）');
  assert.match(cliSync, /App Release 同步失败/, 'cmdAppSync 对真失败抛错');
  assert.match(cliSync, /result\.reason !== 'same_version' && result\.reason !== 'no_release'/, '同版本/无新 Release 不算失败');
  assert.match(cliSync, /result\.apkFailed/, 'DK：apk_download 失败（apkFailed 标记）同样抛错 → 健康条显红');
  assert.match(sched, /lastFailedSyncRun/, '调度器从 sync_runs 取失败原因');
  assert.match(sched, /jobFailureEmailChannel/, '调度器按开关构建告警邮件通道');
  assert.match(sched, /scheduler\.failure_alert/, '告警发送留日志');
});

// EK 批（docs/APP-RELEASE-SYNC-PROXY.md §3/§4）：专用代理设置项 + hydrate 写回 env →
// 调度任务子进程 app-sync 继承 APP_RELEASE_SYNC_PROXY；app-release.js 下载默认读该 env；
// CLI node src/cli.js app-sync 同入口同样生效（cmdAppSync 不传 proxy）。
test('EK 接线：专用代理设置项 + hydrate 写回 env + 下载默认读 env', () => {
  const root = join(process.cwd());
  const appRelease = readFileSync(join(root, 'src', 'app-release.js'), 'utf8');
  const settingsSrc = readFileSync(join(root, 'src', 'settings.js'), 'utf8');
  assert.match(settingsSrc, /def\('network\.appSyncProxy', 'APP_RELEASE_SYNC_PROXY', 'network', 'App 同步专用代理', 'secret'/, 'settings：network.appSyncProxy（secret、网络组自动渲染）');
  assert.match(settingsSrc, /env\[d\.env\] = valueToEnv\(read\.values\[d\.key\]\)/, 'hydrate 把库设置写回 env（调度子进程继承）');
  assert.match(appRelease, /proxy = process\.env\.APP_RELEASE_SYNC_PROXY/, 'app-release 下载默认读 env（CLI/调度同入口生效）');
  assert.match(appRelease, /new ProxyAgent\(proxyAgentOptions\(proxyUrl\)\)/, '下载走 undici ProxyAgent（复用 http.js proxyAgentOptions，零新依赖）');
  assert.match(appRelease, /proxyAgent \? 30000 : timeoutMs \* 2/, '走代理 30s / 直连保持 10s');
});

// FK 批（docs/APP-SYNC-COS.md）：App 资产同步换源接线——三项设置（enum/string/bool，网络组平铺自动渲染）
// + app-release 按 source 分流（GitHub 原逻辑保留）+ COS 三件套 URL 形态/60s 超时/回退日志 + App 构建
// 技能的 COS 双上传命令模板。反向自检：把 fallbackGithub 默认值改成 false → 设置/回退接线断言红。
test('FK 接线：换源三项设置 + COS 分流/60s 超时/回退日志 + 构建技能双上传', () => {
  const root = join(process.cwd());
  const appRelease = readFileSync(join(root, 'src', 'app-release.js'), 'utf8');
  const settingsSrc = readFileSync(join(root, 'src', 'settings.js'), 'utf8');
  const skill = readFileSync(join(root, '.dsh', 'skills', 'steamdeals-app-build', 'SKILL.md'), 'utf8');
  assert.match(settingsSrc, /def\('network\.appSyncSource', 'APP_RELEASE_SYNC_SOURCE', 'network', 'App 同步源', 'enum', 'github'/, 'FK：来源设置项（enum、默认 github、网络组）');
  assert.match(settingsSrc, /def\('network\.appSyncCosBase', 'APP_RELEASE_SYNC_COS_BASE', 'network', 'App 同步 COS 目录', 'string'/, 'FK：COS 目录设置项（string）');
  assert.match(settingsSrc, /def\('network\.appSyncFallbackGithub', 'APP_RELEASE_SYNC_FALLBACK', 'network', 'COS 源失败回退 GitHub', 'bool', true/, 'FK：回退开关（bool、默认开）');
  assert.match(appRelease, /source = process\.env\.APP_RELEASE_SYNC_SOURCE \|\| 'github'/, 'FK：source 默认读 env（hydrate 写回 → 调度子进程继承）');
  assert.match(appRelease, /cosBase = process\.env\.APP_RELEASE_SYNC_COS_BASE/, 'FK：COS 目录默认读 env');
  assert.match(appRelease, /fallbackGithub = envBool\(process\.env\.APP_RELEASE_SYNC_FALLBACK, true\)/, 'FK：回退默认读 env 且默认开');
  assert.match(appRelease, /async function syncFromGithub\(/, 'FK：GitHub 源逻辑保留为独立 helper（不删旧通道）');
  assert.match(appRelease, /async function syncFromCos\(/, 'FK：COS 源独立 helper');
  assert.match(appRelease, /get\(`\$\{base\}\/latest\.json`\)/, 'FK：COS latest.json URL 形态');
  assert.match(appRelease, /steamdeals-\$\{version\}\.apk/, 'FK：COS APK 命名与 GitHub 同格式');
  assert.match(appRelease, /cosTimeoutMs = 60000/, 'FK：COS 下载 60s（比 GitHub 直连 10s 宽）');
  assert.match(appRelease, /'app\.release_fallback'/, 'FK：回退日志事件 app.release_fallback');
  assert.match(appRelease, /cos_download/, 'FK：失败原因 cos_download');
  assert.match(appRelease, /cos_404/, 'FK：失败原因 cos_404');
  assert.match(appRelease, /apk_download/, 'FK：失败原因 apk_download');
  assert.match(skill, /coscli cp/, 'FK：App 构建技能含 COS 上传命令模板');
  assert.match(skill, /cos:\/\/<bucket>\/steamdeals-app/, 'FK：桶目录与 network.appSyncCosBase 对应');
  assert.match(skill, /先传 APK \+ sha256，最后传 latest\.json/, 'FK：上传顺序（latest.json 最后）写进技能');
  assert.ok(!/SECRET_KEY|SecretKey=|SecretId=/.test(skill.replace(/<SecretId>|<SecretKey>/g, '')), 'FK：技能里不写真实密钥');
});
