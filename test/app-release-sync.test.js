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
  const sched = readFileSync(join(root, 'src', 'scheduler.js'), 'utf8');
  const server = readFileSync(join(root, 'src', 'server.js'), 'utf8');
  const page = readFileSync(join(root, 'frontend', 'src', 'pages', 'AppDownloadPage.vue'), 'utf8');
  assert.match(cli, /app-sync/, 'CLI 命令');
  assert.match(sched, /name: 'app-release-sync'/, '调度任务');
  assert.match(sched, /APP_RELEASE_SYNC_INTERVAL_MIN, 60/, '默认 60 分钟');
  assert.ok(!/STEAM_HEAVY = new Set\(\[[\s\S]{0,300}'app-release-sync'/.test(sched), '轻任务不进 STEAM_HEAVY');
  assert.ok(server.includes('steamdeals-[\\d.]+'), '下载路由白名单（仅 steamdeals-x.y.z.apk）');
  assert.match(server, /readLatestMeta/, 'latest 优先读 data/app');
  assert.match(server, /application\/vnd\.android\.package-archive/, 'APK Content-Type');
  assert.match(server, /50 \* 1024 \* 1024/, '≤50MB 上限');
  assert.match(server, /req\.method === 'HEAD'/, 'HEAD 可用');
  assert.match(page, /steamdeals-app\/releases/, 'GitHub 兜底指向 steamdeals-app');
});
