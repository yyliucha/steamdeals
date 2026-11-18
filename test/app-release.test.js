// CT 批（docs/APP-SYNC-404.md §3）：app-release-sync 404 修复——
// 主路径 GET /releases?per_page=10 取第一条 draft=false && prerelease=false；
// /releases/latest 仅兜底（线上该 release 的 latest 端点 404）；
// token 可选（配置 GITHUB_TOKEN 才带 authorization 头，未配匿名）；
// 失败原因日志区分 app.sync_http_404 / app.sync_no_release / app.sync_no_assets。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
    return { ok: true, status: handler.status ?? 200, json: async () => handler.json, arrayBuffer: async () => handler.buf };
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
