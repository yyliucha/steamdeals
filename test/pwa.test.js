// 手机端 PWA（docs/MOBILE-PWA.md）：manifest 可安装、图标尺寸正确、页面引用齐全、没有 service worker。
// 踩过的坑：frontend/public 的文件构建后落在 dist 根目录，而服务端此前只把 /assets/* 交给 frontendDir，
// 其余走 outDir（web/ 旧页或 out/ 曲线页）→ /manifest.webmanifest 与 /icon-*.png 404，
// 「添加到主屏幕」静默失效。最后一条测试直接守这个路由约束。
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFrontendPublicFile, serveFrontendStatic } from '../src/server.js';
import { shouldShowUpdate } from '../frontend/src/composables/useVersionGuard.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC = join(ROOT, 'frontend', 'public');
const MANIFEST_FILE = join(PUBLIC, 'manifest.webmanifest');
const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));

/** 只读 PNG 头：签名 + IHDR，足够校验尺寸，不需要引入图片库。 */
function pngSize(file) {
  const buf = readFileSync(file);
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} 必须是 PNG`);
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR', `${file} 缺少 IHDR`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

test('manifest 字段齐全：standalone + portrait + 主题色', () => {
  assert.equal(manifest.name, 'SteamDeals');
  assert.equal(manifest.short_name, 'SteamDeals');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone', '必须 standalone 才会没有地址栏');
  assert.equal(manifest.orientation, 'portrait');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, '至少 192/512 两份图标');

  // 主题色必须来自暗色 token，而不是另起一个色值（docs/MOBILE-PWA.md §2）
  const css = readFileSync(join(ROOT, 'frontend/src/styles/main.css'), 'utf8');
  assert.match(css, new RegExp(`--bg:\\s*${manifest.theme_color}`, 'i'), 'theme_color 应与 main.css 暗色 --bg 对齐');
});

test('192/512 图标真实存在、PNG 尺寸正确、至少一个 maskable', () => {
  const sizes = new Set();
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    const file = join(PUBLIC, icon.src.replace(/^\//, ''));
    assert.ok(existsSync(file), `manifest 引用的 ${icon.src} 不存在`);
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(file), { width, height }, `${icon.src} 的尺寸要与 manifest 一致`);
    sizes.add(icon.sizes);
  }
  assert.ok(sizes.has('192x192'), '缺 192 图标');
  assert.ok(sizes.has('512x512'), '缺 512 图标');
  assert.ok(
    manifest.icons.some((icon) => String(icon.purpose || '').split(/\s+/).includes('maskable')),
    '至少一个图标要声明 purpose: maskable（Android 自适应图标）',
  );
});

test('index.html 引用 manifest / theme-color / apple-touch-icon', () => {
  const html = readFileSync(join(ROOT, 'frontend', 'index.html'), 'utf8');
  assert.match(html, /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/, '缺 manifest 引用');
  assert.match(html, /<meta[^>]+name="theme-color"[^>]+content="#[0-9a-f]{6}"/i, '缺 theme-color');
  assert.ok(html.includes(`content="${manifest.theme_color}"`), 'theme-color 要与 manifest 一致');
  assert.match(html, /<link[^>]+rel="apple-touch-icon"[^>]+href="\/apple-touch-icon\.png"/, '缺 apple-touch-icon');
  assert.match(html, /<meta[^>]+name="apple-mobile-web-app-capable"[^>]+content="yes"/, '缺 apple-mobile-web-app-capable');
  assert.match(html, /<meta[^>]+name="apple-mobile-web-app-status-bar-style"/, '缺 apple status-bar-style');
  assert.match(html, /<meta[^>]+name="apple-mobile-web-app-title"[^>]+content="SteamDeals"/, '缺 apple title');
  assert.ok(existsSync(join(ROOT, 'web', 'apple-touch-icon.png')), 'apple-touch-icon.png 不存在');
});

test('前端没有任何 service worker 注册（明确不做离线缓存）', () => {
  const sources = [join(ROOT, 'frontend/index.html'), join(ROOT, 'frontend/src/main.js')];
  for (const file of sources) {
    assert.ok(!/\bserviceWorker\b/.test(readFileSync(file, 'utf8')), `${relative(ROOT, file)} 不应出现 service worker`);
  }
  // 防回归：整个前端源码都不允许注册（否则会重演"看到旧页面"）
  for (const file of walk(join(ROOT, 'frontend', 'src'))) {
    if (!/\.(js|vue)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    assert.ok(!/\bserviceWorker\b/.test(text), `${relative(ROOT, file)} 不应出现 service worker`);
  }
});

/** serveFrontendStatic 只依赖 res.writeHead/end，用最小假响应即可测路由落点。 */
function callStatic(frontendDir, outDir, pathname) {
  const res = {
    status: 0,
    headers: {},
    body: null,
    writeHead(code, headers) {
      this.status = code;
      this.headers = { ...(headers || {}) };
      return this;
    },
    end(body) {
      this.body = body;
      return this;
    },
  };
  serveFrontendStatic(res, frontendDir, outDir, pathname);
  return res;
}

test('服务端从 frontendDir 提供 manifest/图标，曲线页仍走 outDir', () => {
  const frontendDir = mkdtempSync(join(tmpdir(), 'gp-pwa-front-'));
  const outDir = mkdtempSync(join(tmpdir(), 'gp-pwa-out-'));
  try {
    writeFileSync(join(frontendDir, 'index.html'), '<!doctype html><title>app</title>');
    copyFileSync(MANIFEST_FILE, join(frontendDir, 'manifest.webmanifest'));
    for (const name of ['icon-192.png', 'icon-512.png']) copyFileSync(join(PUBLIC, name), join(frontendDir, name));
    writeFileSync(join(outDir, 'chart-105600.html'), '<html>curve</html>');

    const manifestRes = callStatic(frontendDir, outDir, '/manifest.webmanifest');
    assert.equal(manifestRes.status, 200, 'manifest 必须能访问，否则无法安装');
    assert.match(manifestRes.headers['content-type'], /^application\/manifest\+json/);
    assert.deepEqual(manifestRes.body, readFileSync(MANIFEST_FILE), '内容要与 frontend/public 一致');

    for (const name of ['icon-192.png', 'icon-512.png']) {
      const iconRes = callStatic(frontendDir, outDir, `/${name}`);
      assert.equal(iconRes.status, 200, `${name} 必须能访问`);
      assert.equal(iconRes.headers['content-type'], 'image/png');
      assert.deepEqual(iconRes.body, readFileSync(join(PUBLIC, name)));
    }

    const chart = callStatic(frontendDir, outDir, '/chart-105600.html');
    assert.equal(chart.status, 200, '旧的 outDir 静态曲线页不能被新规则挡住');
    assert.equal(chart.body.toString(), '<html>curve</html>');

    // 没有构建产物时保持旧回退行为：manifest 不在 outDir，就是 404
    const fallback = callStatic(null, outDir, '/manifest.webmanifest');
    assert.equal(fallback.status, 404);
  } finally {
    rmSync(frontendDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('PWA 根文件判定不吞掉普通静态资源', () => {
  assert.equal(isFrontendPublicFile('/manifest.webmanifest'), true);
  assert.equal(isFrontendPublicFile('/icon-192.png'), true);
  assert.equal(isFrontendPublicFile('/icon-512.png'), true);
  assert.equal(isFrontendPublicFile('/assets/index-abc.js'), false);
  assert.equal(isFrontendPublicFile('/chart.html'), false);
});

test('版本比较纯函数：相等不提示 / 不一致提示 / 首次为空不提示', () => {
  assert.equal(shouldShowUpdate('1.15.2', '1.15.2'), false, '版本相同不能弹更新');
  assert.equal(shouldShowUpdate('1.15.2', '1.16.0'), true, '版本不一致要提示');
  assert.equal(shouldShowUpdate('', '1.16.0'), false, '首次打开（基线为空）不提示');
  assert.equal(shouldShowUpdate(null, '1.16.0'), false, '拿不到基线不提示');
  assert.equal(shouldShowUpdate(undefined, '1.16.0'), false);
  assert.equal(shouldShowUpdate('1.15.2', ''), false, '服务端没回版本不提示');
});

test('App.vue 有全局唯一更新提示条，main.js 启动版本检查', () => {
  const app = readFileSync(join(ROOT, 'frontend/src/App.vue'), 'utf8');
  assert.ok(app.includes('已更新到 v'), 'App.vue 缺更新提示文案');
  assert.ok(app.includes('点击刷新'), '更新提示要能点击刷新');
  assert.ok(app.includes('dismissUpdate'), '更新提示要可关闭');
  const main = readFileSync(join(ROOT, 'frontend/src/main.js'), 'utf8');
  assert.match(main, /startVersionGuard/, 'main.js 应启动版本检查');
});

test('fetch 断网统一提示「网络不可用，请检查连接后重试」，主动取消不误报', async () => {
  const { installNetworkGuard, networkDown, NETWORK_ERROR_MESSAGE } = await import('../frontend/src/utils/network.js');
  const listeners = {};
  let mode = 'fail';
  const fakeWindow = {
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    async fetch() {
      if (mode === 'fail') throw new TypeError('fetch failed');
      if (mode === 'abort') {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return { ok: true, status: 200 };
    },
  };
  const hadWindow = 'window' in globalThis;
  const previousWindow = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    installNetworkGuard();
    await assert.rejects(
      () => fakeWindow.fetch('/api/games/search'),
      (err) => err.name === 'NetworkError' && err.message === NETWORK_ERROR_MESSAGE,
      '网络失败必须换成人话提示，页面直接展示 e.message',
    );
    assert.equal(networkDown.value, true, '失败后要能显示重试提示条');
    assert.equal(typeof listeners.online, 'function', '恢复网络（online 事件）要能清掉提示');
    listeners.online();
    assert.equal(networkDown.value, false);

    mode = 'abort';
    await assert.rejects(
      () => fakeWindow.fetch('/api/games/search'),
      (err) => err.name === 'AbortError',
      '输入防抖取消不是断网',
    );
    assert.equal(networkDown.value, false, 'AbortError 不能点亮断网提示');

    mode = 'ok';
    assert.equal((await fakeWindow.fetch('/api/games/search')).ok, true);
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
  }
});
