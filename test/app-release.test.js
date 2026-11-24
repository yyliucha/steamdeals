// CT 批（docs/APP-SYNC-404.md §3）：app-release-sync 404 修复——
// 主路径 GET /releases?per_page=10 取第一条 draft=false && prerelease=false；
// /releases/latest 仅兜底（线上该 release 的 latest 端点 404）；
// token 可选（配置 GITHUB_TOKEN 才带 authorization 头，未配匿名）；
// 失败原因日志区分 app.sync_http_404 / app.sync_no_release / app.sync_no_assets。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { ProxyAgent } from 'undici';
import { syncAppRelease } from '../src/app-release.js';

const LIST = 'https://api.github.com/repos/yyliucha/steamdeals-app/releases?per_page=10';
const LATEST = 'https://api.github.com/repos/yyliucha/steamdeals-app/releases/latest';

const release = (version, { draft = false, prerelease = false, assets = [] } = {}) => ({
  tag_name: `app-v${version}`,
  draft,
  prerelease,
  assets: assets.map((a) => ({ name: a.name, browser_download_url: a.url })),
});

/** 可注入 fake fetch：按 URL 匹配 handler；记录每次调用的 (url, opts) 供 token 头断言。 */
const fakeFetch = (handlers) => {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const handler = handlers[url] ?? handlers['*'];
    if (!handler) return { ok: false, status: 404, json: async () => null };
    if (handler.error) throw handler.error;
    const status = handler.status ?? 200;
    return { ok: status < 400, status, json: async () => handler.json, arrayBuffer: async () => handler.buf };
  };
  fn.calls = calls;
  return fn;
};

const tmp = () => join(tmpdir(), `ct-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const collectLogger = () => {
  const events = [];
  return { events, info: (event, fields) => events.push({ event, fields }) };
};

test('CT 列表主路径：取第一条非 draft/prerelease，latest 不参与', async () => {
  const dir = tmp();
  const latestJson = JSON.stringify({ version: '2.20.0', versionCode: 22000, notes: ['x'] });
  const handlers = {
    [LIST]: { json: [
      release('2.18.0', { draft: true }),
      release('2.19.0', { prerelease: true }),
      release('2.20.0', { assets: [{ name: 'latest.json', url: 'x-latest' }, { name: 'steamdeals-2.20.0.apk', url: 'x-apk' }] }),
    ] },
    'x-latest': { buf: Buffer.from(latestJson) },
    'x-apk': { buf: Buffer.from('apk') },
  };
  const f = fakeFetch(handlers);
  const r = await syncAppRelease({ dir, fetchImpl: f, logger: { info() {} } });
  assert.equal(r.synced, true);
  assert.equal(r.version, '2.20.0', '跳过 draft 与 prerelease，取第一条稳定版');
  assert.ok(f.calls.every((c) => c.url !== LATEST), '列表已命中时不再请求 latest 兜底');
  assert.ok(existsSync(join(dir, 'latest.json')), 'latest.json 落盘');
  rmSync(dir, { recursive: true, force: true });
});

test('CT latest 兜底：列表 200 但无合格项（空/全 draft），latest 命中仍同步', async () => {
  const dir = tmp();
  const latestJson = JSON.stringify({ version: '2.20.0', versionCode: 22000, notes: ['x'] });
  const handlers = {
    [LIST]: { json: [release('2.18.0', { draft: true })] },
    [LATEST]: { json: release('2.20.0', { assets: [{ name: 'latest.json', url: 'x-latest' }] }) },
    'x-latest': { buf: Buffer.from(latestJson) },
  };
  const f = fakeFetch(handlers);
  const r = await syncAppRelease({ dir, fetchImpl: f, logger: { info() {} } });
  assert.equal(r.synced, true);
  assert.equal(r.version, '2.20.0');
  assert.ok(f.calls.some((c) => c.url === LATEST), '列表无合格项时走了 latest 兜底');
  rmSync(dir, { recursive: true, force: true });
});

test('CT 模拟 404（不存在的仓库）：reason http_404 + app.sync_http_404 日志，不崩溃', async () => {
  const dir = tmp();
  const logger = collectLogger();
  // 两个端点都 404 = 仓库不存在（线上 /releases/latest 对该 release 就返回 404 的复刻）
  const r = await syncAppRelease({ dir, repo: 'yyliucha/not-exist-repo', fetchImpl: fakeFetch({}), logger });
  assert.equal(r.synced, false);
  assert.equal(r.reason, 'http_404');
  assert.ok(logger.events.some((e) => e.event === 'app.sync_http_404'), '日志含 app.sync_http_404，而不是笼统的 github_http_404');
  rmSync(dir, { recursive: true, force: true });
});

test('CT 无合格 release：reason no_release + app.sync_no_release 日志（latest 也 404 时不误报 http_404）', async () => {
  const dir = tmp();
  const logger = collectLogger();
  // 列表 200 但全 draft/prerelease；latest 404（GitHub 对该 release 的真实行为）
  const handlers = {
    [LIST]: { json: [release('2.18.0', { draft: true }), release('2.19.0', { prerelease: true })] },
  };
  const r = await syncAppRelease({ dir, fetchImpl: fakeFetch(handlers), logger });
  assert.equal(r.reason, 'no_release');
  assert.ok(logger.events.some((e) => e.event === 'app.sync_no_release'), '日志含 app.sync_no_release');
  rmSync(dir, { recursive: true, force: true });
});

test('CT 无资产：reason no_assets + app.sync_no_assets 日志（原 no_latest_asset 改名）', async () => {
  const dir = tmp();
  const logger = collectLogger();
  const handlers = {
    [LIST]: { json: [release('2.20.0', { assets: [{ name: 'steamdeals-2.20.0.apk', url: 'x-apk' }] })] },
  };
  const r = await syncAppRelease({ dir, fetchImpl: fakeFetch(handlers), logger });
  assert.equal(r.reason, 'no_assets');
  assert.ok(logger.events.some((e) => e.event === 'app.sync_no_assets'), '日志含 app.sync_no_assets');
  rmSync(dir, { recursive: true, force: true });
});

test('CT token 可选：配 GITHUB_TOKEN 带 authorization 头，未配走匿名', async () => {
  const dir = tmp();
  const latestJson = JSON.stringify({ version: '2.20.0', versionCode: 22000, notes: ['x'] });
  const handlers = {
    [LIST]: { json: [release('2.20.0', { assets: [{ name: 'latest.json', url: 'x-latest' }] })] },
    'x-latest': { buf: Buffer.from(latestJson) },
  };
  const withToken = fakeFetch(handlers);
  await syncAppRelease({ dir, fetchImpl: withToken, token: 'ghp_sekret', logger: { info() {} } });
  const apiCall = withToken.calls.find((c) => c.url === LIST);
  assert.equal(apiCall.opts.headers.authorization, 'token ghp_sekret', '配置 token 时带 authorization 头');

  const anonymous = fakeFetch(handlers);
  await syncAppRelease({ dir, fetchImpl: anonymous, token: null, logger: { info() {} } });
  const anonCall = anonymous.calls.find((c) => c.url === LIST);
  assert.ok(!anonCall.opts.headers.authorization, '未配置 token 时匿名请求（无 authorization 头）');
  rmSync(dir, { recursive: true, force: true });
});

// ---- EK 批（docs/APP-RELEASE-SYNC-PROXY.md §6）：专用代理 network.appSyncProxy（env
// APP_RELEASE_SYNC_PROXY）——有代理三件套下载走 ProxyAgent（超时 30s），留空直连（10s，回归）。
// 反向自检（验收 §6.4）：把下面「配代理期望有 dispatcher」与「留空期望无 dispatcher」的断言
// 改反，测试必须红（已实测红→恢复）。

/** 抓取 AbortSignal.timeout 收到的毫秒数（断言 30s vs 10s）。 */
const withTimeoutProbe = (fn) => {
  const seen = [];
  const orig = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => { seen.push(ms); return orig(ms); };
  return fn(seen).finally(() => { AbortSignal.timeout = orig; });
};

test('EK 配代理：三件套下载带 ProxyAgent dispatcher、超时 30s，日志 via=proxy 打码', async () => {
  const dir = tmp();
  const latestJson = JSON.stringify({ version: '2.20.0', versionCode: 22000, notes: ['x'] });
  const apk = Buffer.from('fake-apk');
  const sha = createHash('sha256').update(apk).digest('hex');
  const handlers = {
    [LIST]: { json: [release('2.20.0', { assets: [
      { name: 'latest.json', url: 'x-latest' },
      { name: 'steamdeals-2.20.0.apk', url: 'x-apk' },
      { name: 'steamdeals-2.20.0.apk.sha256', url: 'x-sha' },
    ] })] },
    'x-latest': { buf: Buffer.from(latestJson) },
    'x-apk': { buf: apk },
    'x-sha': { buf: Buffer.from(sha) },
  };
  const f = fakeFetch(handlers);
  const logger = collectLogger();
  const r = await withTimeoutProbe((seen) => {
    // 带凭据的代理地址：验证日志打码（user→***、password 清空）
    return syncAppRelease({
      dir, fetchImpl: f, logger,
      proxy: 'http://user:pass@127.0.0.1:8888',
    }).then((res) => ({ res, seen }));
  });
  assert.equal(r.res.synced, true);
  assert.equal(r.res.version, '2.20.0');
  const downloadCalls = f.calls.filter((c) => ['x-latest', 'x-apk', 'x-sha'].includes(c.url));
  assert.equal(downloadCalls.length, 3, '三件套全部下载');
  for (const c of downloadCalls) {
    assert.ok(c.opts.dispatcher instanceof ProxyAgent, `${c.url} 下载带 ProxyAgent dispatcher（走代理）`);
  }
  assert.equal(r.seen.filter((ms) => ms === 30000).length, 3, '三处资产下载超时均为 30s');
  assert.ok(r.seen.every((ms) => ms === 5000 || ms === 30000), '只出现 API 5s 与资产 30s 两种超时');
  const apiCall = f.calls.find((c) => c.url === LIST);
  assert.ok(!apiCall.opts.dispatcher, 'releases 列表请求保持现状（专用代理只作用于资产下载）');
  const proxyLog = logger.events.find((e) => e.event === 'app.release_proxy');
  assert.ok(proxyLog, '下载前记 app.release_proxy');
  assert.equal(proxyLog.fields.via, 'proxy');
  assert.equal(proxyLog.fields.proxy, 'http://***@127.0.0.1:8888', '日志代理地址打码（凭据不可见）');
  rmSync(dir, { recursive: true, force: true });
});

test('EK 留空直连回归：无 dispatcher、10s 超时、日志 via=direct（行为与 EK 批前一致）', async () => {
  const dir = tmp();
  const latestJson = JSON.stringify({ version: '2.20.0', versionCode: 22000, notes: ['x'] });
  const handlers = {
    [LIST]: { json: [release('2.20.0', { assets: [{ name: 'latest.json', url: 'x-latest' }] })] },
    'x-latest': { buf: Buffer.from(latestJson) },
  };
  const f = fakeFetch(handlers);
  const logger = collectLogger();
  const r = await withTimeoutProbe((seen) =>
    syncAppRelease({ dir, fetchImpl: f, logger, proxy: '' }).then((res) => ({ res, seen })));
  assert.equal(r.res.synced, true);
  const dl = f.calls.find((c) => c.url === 'x-latest');
  assert.ok(dl, 'latest.json 已下载');
  assert.ok(!dl.opts.dispatcher, '留空时无 dispatcher（直连，与 EK 批前完全一致）');
  assert.ok(r.seen.includes(10000), '下载超时保持 10s（timeoutMs*2，非代理 30s）');
  const proxyLog = logger.events.find((e) => e.event === 'app.release_proxy');
  assert.ok(proxyLog, '直连同样记 app.release_proxy（排障可观测）');
  assert.equal(proxyLog.fields.via, 'direct');
  assert.equal(proxyLog.fields.proxy, null);
  rmSync(dir, { recursive: true, force: true });
});

test('EK env 默认：未传 proxy 时读 process.env.APP_RELEASE_SYNC_PROXY（hydrate 写回后子进程继承）', async () => {
  const dir = tmp();
  const latestJson = JSON.stringify({ version: '2.20.0', versionCode: 22000, notes: ['x'] });
  const handlers = {
    [LIST]: { json: [release('2.20.0', { assets: [{ name: 'latest.json', url: 'x-latest' }] })] },
    'x-latest': { buf: Buffer.from(latestJson) },
  };
  const f = fakeFetch(handlers);
  const prev = process.env.APP_RELEASE_SYNC_PROXY;
  process.env.APP_RELEASE_SYNC_PROXY = 'http://127.0.0.1:8888';
  try {
    const r = await syncAppRelease({ dir, fetchImpl: f, logger: { info() {} } });
    assert.equal(r.synced, true);
    const dl = f.calls.find((c) => c.url === 'x-latest');
    assert.ok(dl.opts.dispatcher instanceof ProxyAgent, 'env 生效：下载走代理');
  } finally {
    if (prev === undefined) delete process.env.APP_RELEASE_SYNC_PROXY;
    else process.env.APP_RELEASE_SYNC_PROXY = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EK 代理不可用：reason 仍 latest_download / apk_download 且 message 可见（A5 健康条接线不变）', async () => {
  const dir = tmp();
  const latestJson = JSON.stringify({ version: '2.20.0', versionCode: 22000, notes: ['x'] });
  const assets = [
    { name: 'latest.json', url: 'x-latest' },
    { name: 'steamdeals-2.20.0.apk', url: 'x-apk' },
  ];
  // latest 下载失败 → reason latest_download
  const logger1 = collectLogger();
  const r1 = await syncAppRelease({
    dir, logger: logger1, proxy: 'http://127.0.0.1:9999',
    fetchImpl: fakeFetch({
      [LIST]: { json: [release('2.20.0', { assets })] },
      'x-latest': { error: new Error('proxy connect ECONNREFUSED 127.0.0.1:9999') },
    }),
  });
  assert.equal(r1.synced, false);
  assert.equal(r1.reason, 'latest_download', '代理不可用：latest 下载失败原因不变');
  const f1 = logger1.events.find((e) => e.event === 'app.release_failed');
  assert.ok(f1, '失败事件保留');
  assert.match(f1.fields.message, /ECONNREFUSED/, '失败 message 可见（不静默）');
  // APK 下载失败 → latest 已更新 + apkFailed 标记（reason 语义不变）
  const logger2 = collectLogger();
  const r2 = await syncAppRelease({
    dir, logger: logger2, proxy: 'http://127.0.0.1:9999',
    fetchImpl: fakeFetch({
      [LIST]: { json: [release('2.20.0', { assets })] },
      'x-latest': { buf: Buffer.from(latestJson) },
      'x-apk': { error: new Error('proxy timeout after 30000ms') },
    }),
  });
  assert.equal(r2.synced, true, 'latest 已更新仍算同步完成');
  assert.equal(r2.apkFailed, 'apk_download', 'APK 下载失败带 apkFailed 标记');
  const f2 = logger2.events.find((e) => e.event === 'app.release_failed' && e.fields.reason === 'apk_download');
  assert.ok(f2, 'apk_download 失败事件保留');
  assert.match(f2.fields.message, /timeout/, 'apk 失败 message 可见');
  rmSync(dir, { recursive: true, force: true });
});

// ---- FK 批（docs/APP-SYNC-COS.md §2/§4）：App 资产同步换源——source=cos 从腾讯云 COS 拉
// latest.json / steamdeals-<v>.apk / .sha256（与 GitHub 同落盘格式），超时 60s；cos 失败且
// fallbackGithub 为真时回退 GitHub 一次（日志 app.release_fallback）；失败原因区分
// cos_download / cos_404 / apk_download。反向自检：把 fallback 分支删掉 → 回退用例红（返回 cos_404）。

/** 组装一组 COS 成功下载的 handler（base 不含末尾斜杠）。 */
const cosHandlers = (base, { version = '2.30.0', apk = Buffer.from('cos-apk'), withSha = true } = {}) => {
  const sha = createHash('sha256').update(apk).digest('hex');
  const latestJson = JSON.stringify({ version, versionCode: Number(version.replaceAll('.', '')) , notes: ['fk'] });
  const handlers = {
    [`${base}/latest.json`]: { buf: Buffer.from(latestJson) },
    [`${base}/steamdeals-${version}.apk`]: { buf: apk },
  };
  if (withSha) handlers[`${base}/steamdeals-${version}.apk.sha256`] = { buf: Buffer.from(`${sha}  steamdeals-${version}.apk`) };
  return { handlers, sha, apk, latestJson };
};

test('FK cos 源：latest.json/APK/sha256 落盘、超时 60s、不请求 GitHub，末尾斜杠归一化', async () => {
  const dir = tmp();
  const base = 'https://bucket.cos.ap-guangzhou.myqcloud.com/steamdeals-app';
  const { handlers, apk, latestJson } = cosHandlers(base);
  const f = fakeFetch(handlers);
  const logger = collectLogger();
  // 传带末尾斜杠的 base：必须归一化，否则会拼出 //latest.json 而 404
  const r = await withTimeoutProbe((seen) =>
    syncAppRelease({ dir, fetchImpl: f, logger, source: 'cos', cosBase: `${base}/` }).then((res) => ({ res, seen })));
  assert.equal(r.res.synced, true);
  assert.equal(r.res.version, '2.30.0');
  assert.equal(r.res.apk, 'steamdeals-2.30.0.apk');
  assert.equal(r.res.source, 'cos', '结果标注来源，便于排障');
  assert.ok(existsSync(join(dir, 'steamdeals-2.30.0.apk')), 'APK 落盘（与 GitHub 源同格式）');
  assert.equal(readFileSync(join(dir, 'latest.json'), 'utf8'), latestJson, 'latest.json 原文落盘');
  assert.ok(readFileSync(join(dir, 'latest.json'), 'utf8').includes('2.30.0'), '版本一致');
  assert.ok(f.calls.every((c) => !c.url.includes('github.com')), 'source=cos 不请求 GitHub');
  assert.ok(f.calls.every((c) => c.url.startsWith(`${base}/`)), 'URL 不带双斜杠（base 归一化）');
  assert.equal(r.seen.length, 3, '三件套各一次请求');
  assert.ok(r.seen.every((ms) => ms === 60000), 'COS 下载超时统一 60s（比 GitHub 直连 10s 宽）');
  const srcLog = logger.events.find((e) => e.event === 'app.release_source');
  assert.equal(srcLog.fields.source, 'cos', '日志标注来源 cos');
  assert.equal(logger.events.find((e) => e.event === 'app.release_synced').fields.source, 'cos');
  assert.ok(apk.length > 0);
  rmSync(dir, { recursive: true, force: true });
});

test('FK cos sha 缺失：不阻断同步（与 GitHub 源一致，跳过校验）', async () => {
  const dir = tmp();
  const base = 'https://cos.example.com/app';
  const { handlers } = cosHandlers(base, { withSha: false });
  const logger = collectLogger();
  const r = await syncAppRelease({ dir, fetchImpl: fakeFetch(handlers), logger, source: 'cos', cosBase: base });
  assert.equal(r.synced, true);
  assert.ok(logger.events.some((e) => e.event === 'app.release_sha_missing'), '记录 sha 缺失（可观测）');
  rmSync(dir, { recursive: true, force: true });
});

test('FK cos 失败回退 GitHub：cos_404 → GitHub 成功，日志 app.release_fallback 带原因', async () => {
  const dir = tmp();
  const base = 'https://cos.example.com/app';
  const latestJson = JSON.stringify({ version: '2.20.0', versionCode: 22000, notes: ['x'] });
  const handlers = {
    [`${base}/latest.json`]: { status: 404 },
    [LIST]: { json: [release('2.20.0', { assets: [{ name: 'latest.json', url: 'x-latest' }, { name: 'steamdeals-2.20.0.apk', url: 'x-apk' }] })] },
    'x-latest': { buf: Buffer.from(latestJson) },
    'x-apk': { buf: Buffer.from('apk') },
  };
  const f = fakeFetch(handlers);
  const logger = collectLogger();
  const r = await syncAppRelease({ dir, fetchImpl: f, logger, source: 'cos', cosBase: base });
  assert.equal(r.synced, true, 'cos 404 后回退 GitHub 成功');
  assert.equal(r.source, 'github', '实际数据来自 GitHub');
  assert.equal(r.fallbackFrom, 'cos');
  assert.equal(r.fallbackReason, 'cos_404', '回退原因保留（与普通 GitHub 同步可区分）');
  assert.ok(f.calls.some((c) => c.url === LIST), '确实发起了 GitHub 列表请求');
  const fb = logger.events.find((e) => e.event === 'app.release_fallback');
  assert.ok(fb, '日志 app.release_fallback');
  assert.deepEqual(fb.fields, { from: 'cos', to: 'github', reason: 'cos_404', version: null });
  rmSync(dir, { recursive: true, force: true });
});

test('FK cos 网络失败：fallbackGithub=false 直接返回 cos_download，不请求 GitHub', async () => {
  const dir = tmp();
  const base = 'https://cos.example.com/app';
  const f = fakeFetch({ [`${base}/latest.json`]: { error: new Error('cos timeout after 60000ms') } });
  const logger = collectLogger();
  const r = await syncAppRelease({ dir, fetchImpl: f, logger, source: 'cos', cosBase: base, fallbackGithub: false });
  assert.equal(r.synced, false);
  assert.equal(r.reason, 'cos_download', 'latest.json 非 404 失败归 cos_download');
  assert.ok(f.calls.every((c) => !c.url.includes('github.com')), '关闭回退时绝不请求 GitHub');
  const failed = logger.events.find((e) => e.event === 'app.release_failed');
  assert.equal(failed.fields.reason, 'cos_download');
  assert.match(failed.fields.message, /timeout/, '失败 message 可见');
  assert.ok(!existsSync(join(dir, 'latest.json')), '失败不落盘');
  rmSync(dir, { recursive: true, force: true });
});

test('FK cos APK 失败：apk_download + 不留半成品；回退开启时改走 GitHub', async () => {
  const base = 'https://cos.example.com/app';
  const { handlers } = cosHandlers(base);
  handlers[`${base}/steamdeals-2.30.0.apk`] = { error: new Error('apk stream aborted') };
  // 不开回退：直接 apk_download，且 latest.json/APK 都不落盘（先下后写，不留 latest 指向缺失 APK 的中间态）
  const dir1 = tmp();
  const r1 = await syncAppRelease({ dir: dir1, fetchImpl: fakeFetch(handlers), source: 'cos', cosBase: base, fallbackGithub: false, logger: collectLogger() });
  assert.equal(r1.synced, false);
  assert.equal(r1.reason, 'apk_download');
  assert.ok(!existsSync(join(dir1, 'latest.json')), 'APK 失败时 latest.json 不落盘');
  assert.ok(!existsSync(join(dir1, 'steamdeals-2.30.0.apk')), 'APK 失败时无半成品');
  rmSync(dir1, { recursive: true, force: true });
  // 开回退（默认 true）：GitHub 兜底成功，lastError 原因保留 apk_download
  const dir2 = tmp();
  const ghLatest = JSON.stringify({ version: '2.20.0', versionCode: 22000, notes: ['x'] });
  const withGithub = {
    ...handlers,
    [LIST]: { json: [release('2.20.0', { assets: [{ name: 'latest.json', url: 'x-latest' }] })] },
    'x-latest': { buf: Buffer.from(ghLatest) },
  };
  const r2 = await syncAppRelease({ dir: dir2, fetchImpl: fakeFetch(withGithub), source: 'cos', cosBase: base, logger: collectLogger() });
  assert.equal(r2.synced, true);
  assert.equal(r2.fallbackReason, 'apk_download', '回退原因区分 apk_download');
  assert.ok(existsSync(join(dir2, 'latest.json')), 'GitHub 兜底产物落盘');
  rmSync(dir2, { recursive: true, force: true });
});

test('FK cos latest 不合法：version 非 x.y.z / versionCode 非整数 → bad_latest 且不落盘（防路径注入）', async () => {
  const dir = tmp();
  const base = 'https://cos.example.com/app';
  const cases = [
    JSON.stringify({ version: '../../evil', versionCode: 1 }),
    JSON.stringify({ version: '2.30.0', versionCode: 'abc' }),
  ];
  for (const body of cases) {
    const f = fakeFetch({
      [`${base}/latest.json`]: { buf: Buffer.from(body) },
      [`${base}/steamdeals-2.30.0.apk`]: { buf: Buffer.from('x') },
    });
    const logger = collectLogger();
    const r = await syncAppRelease({ dir, fetchImpl: f, logger, source: 'cos', cosBase: base, fallbackGithub: false });
    assert.equal(r.reason, 'bad_latest', `非法 latest 拒绝：${body}`);
    assert.ok(!existsSync(join(dir, 'latest.json')), '非法 latest 不落盘');
    assert.equal(f.calls.length, 1, '校验失败后不再下载 APK');
  }
  rmSync(dir, { recursive: true, force: true });
});

test('FK cos same_version：本地同版本 + APK 在 → 只下 latest.json，不重复下 APK', async () => {
  const dir = tmp();
  const base = 'https://cos.example.com/app';
  const { handlers } = cosHandlers(base);
  const f = fakeFetch(handlers);
  await syncAppRelease({ dir, fetchImpl: f, source: 'cos', cosBase: base, logger: { info() {} } });
  const apkCallsBefore = f.calls.filter((c) => c.url.endsWith('.apk')).length;
  const r2 = await syncAppRelease({ dir, fetchImpl: f, source: 'cos', cosBase: base, logger: { info() {} } });
  assert.equal(r2.reason, 'same_version');
  assert.equal(f.calls.filter((c) => c.url.endsWith('.apk')).length, apkCallsBefore, '同版本不再下载 APK');
  rmSync(dir, { recursive: true, force: true });
});

test('FK cos 未配目录：reason cos_no_base（不回退时不请求任何 URL）', async () => {
  const dir = tmp();
  const f = fakeFetch({});
  const r = await syncAppRelease({ dir, fetchImpl: f, source: 'cos', cosBase: '', fallbackGithub: false, logger: collectLogger() });
  assert.equal(r.reason, 'cos_no_base');
  assert.equal(f.calls.length, 0, '没有 base 不发请求');
  rmSync(dir, { recursive: true, force: true });
});

test('FK env 默认：APP_RELEASE_SYNC_SOURCE/COS_BASE/FALLBACK 生效（hydrate 写回后子进程继承）', async () => {
  const base = 'https://cos.example.com/app';
  const prev = {
    source: process.env.APP_RELEASE_SYNC_SOURCE,
    cosBase: process.env.APP_RELEASE_SYNC_COS_BASE,
    fallback: process.env.APP_RELEASE_SYNC_FALLBACK,
  };
  process.env.APP_RELEASE_SYNC_SOURCE = 'cos';
  process.env.APP_RELEASE_SYNC_COS_BASE = base;
  process.env.APP_RELEASE_SYNC_FALLBACK = '0';
  try {
    const dir1 = tmp();
    const { handlers } = cosHandlers(base);
    const f1 = fakeFetch(handlers);
    const r1 = await syncAppRelease({ dir: dir1, fetchImpl: f1, logger: { info() {} } });
    assert.equal(r1.source, 'cos', '未传 source 时读 env → 走 COS');
    assert.ok(f1.calls.every((c) => !c.url.includes('github.com')));
    rmSync(dir1, { recursive: true, force: true });
    // env 关闭回退：COS 404 时不请求 GitHub
    const dir2 = tmp();
    const f2 = fakeFetch({ [`${base}/latest.json`]: { status: 404 } });
    const r2 = await syncAppRelease({ dir: dir2, fetchImpl: f2, logger: { info() {} } });
    assert.equal(r2.reason, 'cos_404');
    assert.ok(f2.calls.every((c) => !c.url.includes('github.com')), 'env APP_RELEASE_SYNC_FALLBACK=0 关闭回退');
    rmSync(dir2, { recursive: true, force: true });
  } finally {
    for (const [k, v] of [
      ['APP_RELEASE_SYNC_SOURCE', prev.source],
      ['APP_RELEASE_SYNC_COS_BASE', prev.cosBase],
      ['APP_RELEASE_SYNC_FALLBACK', prev.fallback],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('FK 非法 source（env 陈旧/手填）：按 github 处理，行为不崩', async () => {
  const dir = tmp();
  const latestJson = JSON.stringify({ version: '2.20.0', versionCode: 22000, notes: ['x'] });
  const handlers = {
    [LIST]: { json: [release('2.20.0', { assets: [{ name: 'latest.json', url: 'x-latest' }] })] },
    'x-latest': { buf: Buffer.from(latestJson) },
  };
  const r = await syncAppRelease({ dir, fetchImpl: fakeFetch(handlers), source: 'gitee', logger: { info() {} } });
  assert.equal(r.synced, true);
  assert.equal(r.source, 'github');
  rmSync(dir, { recursive: true, force: true });
});
