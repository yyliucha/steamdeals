// 内置静态页服务：路径解析、内容类型、GET/HEAD/405、路径穿越防护。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFilePath, contentTypeFor, startStaticServer } from '../src/serve.js';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { FRONTEND_PAGES, isFrontendPage, startApiServer } from '../src/server.js';

function makeSite() {
  const root = mkdtempSync(join(tmpdir(), 'gp-serve-'));
  writeFileSync(join(root, 'index.html'), '<h1>首页</h1>');
  writeFileSync(join(root, 'game-105600.html'), '<h1>泰拉瑞亚</h1>');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'index.html'), '<h1>子目录</h1>');
  writeFileSync(join(root, 'styles.css'), 'body{}');
  return root;
}

// DI 批（docs/TEST-ENV-ISOLATION.md §3A）：凡会触发 /api/app/latest 派生 apkPath 的用例，
// 一律注入 APP_DATA_DIR 临时目录（src/server.js 已支持该变量，无需改服务端），隔离工作区
// data/app 的运行时同步产物——app-sync 会把真实 latest.json 写进工作区，不注入时 BS-1/BY-1/CJ
// 全会红（CO-3 会话实测：手工移走 data/app 才绿）。用例结束恢复环境变量并清理临时目录。
// 反向自检（DI 验收 §4.1，2026-11-18 已做）：临时去掉本 helper 的注入 + 在工作区 data/app 放
// steamdeals-2.16.0.apk → 用例红；放回注入 → 绿。
function withAppDataDir() {
  const dataDir = mkdtempSync(join(tmpdir(), 'gp-appdata-'));
  const prev = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dataDir;
  return {
    dataDir,
    restore: () => {
      if (prev === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = prev;
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

test('路径解析：目录内正常，穿越和非法编码一律拒绝', () => {
  const root = makeSite();
  assert.ok(resolveFilePath(root, '/index.html').endsWith('index.html'));
  assert.ok(resolveFilePath(root, '/sub/index.html').endsWith('index.html'));
  assert.equal(resolveFilePath(root, '/../secret.txt'), null, '../ 必须被拦');
  assert.equal(resolveFilePath(root, '/sub/../../secret.txt'), null);
  assert.equal(resolveFilePath(root, '/%2e%2e/secret.txt'), null, 'URL 编码的 ../ 也要拦');
  assert.equal(resolveFilePath(root, '/a%00b.html'), null, '空字节要拦');
  assert.equal(resolveFilePath(root, '/%E0%A4%A'), null, '非法百分号编码要拦');
});

test('内容类型：按扩展名给，未知回退二进制', () => {
  assert.match(contentTypeFor('a.html'), /text\/html/);
  assert.match(contentTypeFor('a.css'), /text\/css/);
  assert.match(contentTypeFor('a.svg'), /image\/svg\+xml/);
  assert.equal(contentTypeFor('a.xyz'), 'application/octet-stream');
});

test('HTTP：首页、子目录、404、HEAD、405', async () => {
  const root = makeSite();
  const srv = await startStaticServer({ rootDir: root, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(await index.text(), /首页/);
    assert.equal(index.headers.get('cache-control'), 'no-cache', 'HTML 不能缓存');

    const sub = await fetch(`${base}/sub/`);
    assert.equal(sub.status, 200);
    assert.match(await sub.text(), /子目录/, '目录请求应返回 index.html');

    const page = await fetch(`${base}/game-105600.html`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /泰拉瑞亚/);

    const css = await fetch(`${base}/styles.css`);
    assert.match(css.headers.get('cache-control'), /max-age/, '静态资源可短缓存');

    assert.equal((await fetch(`${base}/nope.html`)).status, 404);

    const head = await fetch(`${base}/`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.ok(Number(head.headers.get('content-length')) > 0);
    assert.equal(await head.text(), '', 'HEAD 不应有响应体');

    const post = await fetch(`${base}/`, { method: 'POST' });
    assert.equal(post.status, 405);
  } finally {
    await srv.close();
  }
});

test('HTTP：原始请求里的 ../ 被拒绝（不依赖客户端归一化）', async () => {
  const root = makeSite();
  const srv = await startStaticServer({ rootDir: root, port: 0, host: '127.0.0.1' });
  const status = await new Promise((done, fail) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/../package.json', method: 'GET' }, (res) => {
      res.resume();
      done(res.statusCode);
    });
    req.on('error', fail);
    req.end();
  });
  try {
    assert.equal(status, 403, '越界访问应返回 403');
  } finally {
    await srv.close();
  }
});

test('port=0 时返回系统分配的真实端口', async () => {
  const srv = await startStaticServer({ rootDir: makeSite(), port: 0, host: '127.0.0.1' });
  try {
    assert.ok(srv.port > 0);
    assert.equal(typeof srv.close, 'function');
  } finally {
    await srv.close();
  }
});

// BM-1（docs/SESSION-MANAGEMENT.md §8.4.1）：SPA 页面白名单——登录/注册/改密页直接打开或刷新必须返回
// 200 index.html（v2.11.0 的 `/login` 落到旧 web/ 目录回纯文本 not found 的事故）。
// FY-2（docs/SETTINGS-REDESIGN.md §3.1）：`/console/settings/:group` 是参数化路由，按前缀放行——
// 深链直接打开/刷新必须是 index.html（同一类事故：FY-1 加了二级路由但白名单只支持精确路径，
// 线上直开 /console/settings/sources 会回纯文本 not found）。
test('BM-1：/login、/register、/change-password（含 next 参数）返回 200 index.html', async () => {
  const frontend = mkdtempSync(join(tmpdir(), 'gp-frontend-'));
  writeFileSync(join(frontend, 'index.html'), '<!doctype html><html><body><div id="app">spa-marker</div></body></html>');
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const srv = await startApiServer({ query: q, frontendDir: frontend, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    for (const p of [
      '/login',
      '/login?next=%2Fconsole%3Fsection%3Dgames',
      '/register',
      '/change-password',
      '/console?section=games',
      // FY-2：系统设置二级路由的深链（7 组逐条 + 带 ?q= 搜索词）
      '/console/settings/sources',
      '/console/settings/network',
      '/console/settings/schedule?q=proxy',
    ]) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, `${p} → 200`);
      assert.match(res.headers.get('content-type') || '', /text\/html/, `${p} → text/html`);
      assert.match(await res.text(), /spa-marker/, `${p} → index.html`);
    }
    // 白名单不是通配：未登记的路径仍是 404（而不是把所有路径都当 SPA）
    const missing = await fetch(`${base}/no-such-page`);
    assert.equal(missing.status, 404, '未登记路径 404');
    // 前缀只放行 /console/settings/<group> 一层，不吞掉其它 /console 子路径
    assert.equal((await fetch(`${base}/console/nope`)).status, 404, '/console/nope 仍 404');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('BM-1：前端 router 的每个页面路径都在服务端白名单（新增页面漏登记 → 测试红）', () => {
  const routerJs = readFileSync(new URL('../frontend/src/router/index.js', import.meta.url), 'utf8');
  const paths = [...routerJs.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(paths.length >= 8, `解析到路由路径（${paths.length} 条）`);
  // FY-2：参数化路由（:group?）按前缀白名单放行——用 isFrontendPage 判定，而不是精确包含
  for (const p of paths) assert.ok(isFrontendPage(p), `router 路径 ${p} 已登记进白名单（精确或前缀）`);
  for (const p of ['/login', '/register', '/change-password']) assert.ok(FRONTEND_PAGES.includes(p), `BM-1：${p} 在册`);
  // FY-2 反向自检锚点：二级设置页任意组都算 SPA 页面；其它 /console 子路径不算
  for (const p of ['/console/settings/sources', '/console/settings/ops', '/console/settings/network/']) {
    assert.equal(isFrontendPage(p), true, `${p} 由 SPA 承接`);
  }
  for (const p of ['/console/nope', '/console/setting', '/console/settingsx']) {
    assert.equal(isFrontendPage(p), false, `${p} 不是 SPA 页面（前缀不越界）`);
  }
});

test('BS-1：/.well-known/assetlinks.json、/sw.js、/app/*.apk 返回 200 + 正确 Content-Type + no-cache', async () => {
  const frontend = mkdtempSync(join(tmpdir(), 'gp-frontend-'));
  writeFileSync(join(frontend, 'index.html'), '<!doctype html><html><body>ok</body></html>');
  mkdirSync(join(frontend, '.well-known'));
  writeFileSync(join(frontend, '.well-known', 'assetlinks.json'), JSON.stringify({ relation: [], target: { namespace: 'android_app', package_name: 'cn.yyliucha.steamdeals' } }));
  writeFileSync(join(frontend, 'sw.js'), 'self.addEventListener("install",()=>{});');
  mkdirSync(join(frontend, 'app'));
  writeFileSync(join(frontend, 'app', 'steamdeals-test.apk'), 'fake-apk-bytes');
  // CJ 现场回归修复：镜像内有与 version 对应的 APK 文件 → apkPath 回落 /app/<ver>.apk
  writeFileSync(join(frontend, 'app', 'steamdeals-2.16.0.apk'), 'fake-apk-bytes');
  writeFileSync(join(frontend, 'app', 'latest.json'), JSON.stringify({ version: '2.16.0', versionCode: 21600, minVersionCode: 21600, notes: ['修复 A', '新增 B'], apkPath: '/app/steamdeals-test.apk', sha256: 'abc123', size: 42, releasedAt: '2026-11-14' }));
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const { restore: restoreAppData } = withAppDataDir(); // DI：隔离工作区 data/app 同步产物
  const srv = await startApiServer({ query: q, frontendDir: frontend, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const asset = await fetch(`${base}/.well-known/assetlinks.json`);
    assert.equal(asset.status, 200, 'assetlinks 200');
    assert.match(asset.headers.get('content-type') || '', /application\/json/, 'assetlinks JSON');
    assert.match(asset.headers.get('cache-control') || '', /no-cache/, 'assetlinks no-cache');
    const sw = await fetch(`${base}/sw.js`);
    assert.equal(sw.status, 200, 'sw.js 200');
    assert.match(sw.headers.get('content-type') || '', /javascript/, 'sw.js JS');
    assert.match(sw.headers.get('cache-control') || '', /no-cache/, 'sw.js no-cache');
    const apk = await fetch(`${base}/app/steamdeals-test.apk`);
    assert.equal(apk.status, 200, 'APK 200');
    assert.match(apk.headers.get('content-type') || '', /vnd\.android\.package-archive/, 'APK Content-Type');
    assert.match(apk.headers.get('cache-control') || '', /no-cache/, 'APK no-cache（避免缓存旧包）');
    assert.ok(FRONTEND_PAGES.includes('/app') && FRONTEND_PAGES.includes('/app/'), '/app 已登记 FRONTEND_PAGES');
    // BS-2：/api/app/latest 读 frontendDir 下的 app/latest.json（字段齐全；apkPath 按文件存在性回落镜像 /app/<ver>.apk）
    const latest = await (await fetch(`${base}/api/app/latest`)).json();
    assert.deepEqual(latest, { version: '2.16.0', versionCode: 21600, minVersionCode: 21600, notes: ['修复 A', '新增 B'], apkPath: '/app/steamdeals-2.16.0.apk', sha256: 'abc123', size: 42, releasedAt: '2026-11-14' }, '清单字段齐全（CJ 回归修复：data/app 为空时 apkPath 回落镜像路径）');
  } finally {
    restoreAppData();
    await srv.close();
    await store.close();
  }
});

test('BY-1：/api/app/latest 新字段缺失时返回 null 不报错（旧清单兼容）；notes 旧字符串格式按单条处理', async () => {
  const frontend = mkdtempSync(join(tmpdir(), 'gp-frontend-'));
  writeFileSync(join(frontend, 'index.html'), '<!doctype html><html><body>ok</body></html>');
  mkdirSync(join(frontend, 'app'));
  // 旧格式清单：无 versionCode/minVersionCode，notes 是单段字符串
  writeFileSync(join(frontend, 'app', 'latest.json'), JSON.stringify({ version: '2.16.0', apkPath: '/app/x.apk', notes: '单段说明' }));
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const { restore: restoreAppData } = withAppDataDir(); // DI：隔离工作区 data/app 同步产物
  const srv = await startApiServer({ query: q, frontendDir: frontend, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const latest = await (await fetch(`${base}/api/app/latest`)).json();
    assert.equal(latest.versionCode, null, '缺失 versionCode → null');
    assert.equal(latest.minVersionCode, null, '缺失 minVersionCode → null');
    assert.deepEqual(latest.notes, ['单段说明'], '旧字符串 notes 按单条数组处理');
    assert.equal(latest.sha256, null, '其它缺失字段仍是 null（旧形状不变）');
    // DK 批（docs/TODO.md DK A）：本地与镜像都没有 APK → apkPath 兜底 GitHub Release 直链，不再 null
    assert.equal(latest.apkPath, 'https://github.com/yyliucha/steamdeals-app/releases/download/app-v2.16.0/steamdeals-2.16.0.apk', '镜像内无对应 APK 文件 → apkPath 兜底 GitHub 直链（DK）');
    // 清单文件不存在也不报错
    await srv.close();
    const srv2 = await startApiServer({ query: q, frontendDir: mkdtempSync(join(tmpdir(), 'gp-frontend-empty-')), port: 0, host: '127.0.0.1' });
    try {
      const missing = await (await fetch(`http://127.0.0.1:${srv2.port}/api/app/latest`)).json();
      assert.equal(missing.version, null);
      assert.equal(missing.versionCode, null);
      assert.equal(missing.minVersionCode, null);
      assert.equal(missing.notes, null);
    } finally {
      await srv2.close();
    }
  } finally {
    restoreAppData();
    await store.close();
  }
});

// CA-5（docs/APP-NATIVE.md §5）：手机浏览器前台跳转 /app——开关默认关闭；开启后仅前台页面 302 /app，
// 桌面 UA 不跳、豁免路径（console/login/register/app/banned/appeal/setup/change-password、/api/*）不跳、
// 微信 UA（iPhone+MicroMessenger，UA 含 Mobile）同样跳转。
test('CA-5：手机跳转开关默认关闭；开启后前台 302 /app，豁免路径与桌面不跳', async () => {
  const frontend = mkdtempSync(join(tmpdir(), 'gp-frontend-'));
  writeFileSync(join(frontend, 'index.html'), '<!doctype html><html><body>ok</body></html>');
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const MOBILE = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
  const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  const WECHAT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49';
  const prev = process.env.APP_MOBILE_REDIRECT_ENABLED;
  try {
    // 默认关闭：手机 UA 访问首页不跳转
    delete process.env.APP_MOBILE_REDIRECT_ENABLED;
    const srv0 = await startApiServer({ query: q, frontendDir: frontend, port: 0, host: '127.0.0.1' });
    const base0 = `http://127.0.0.1:${srv0.port}`;
    try {
      const off = await fetch(`${base0}/`, { headers: { 'user-agent': MOBILE }, redirect: 'manual' });
      assert.equal(off.status, 200, '开关默认关闭 → 手机 UA 首页 200 不跳转');
    } finally {
      await srv0.close();
    }

    // 开启：手机 UA 前台 302 /app；桌面不跳；微信 UA 跳；豁免路径不跳
    process.env.APP_MOBILE_REDIRECT_ENABLED = '1';
    const srv = await startApiServer({ query: q, frontendDir: frontend, port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${srv.port}`;
    try {
      const home = await fetch(`${base}/`, { headers: { 'user-agent': MOBILE }, redirect: 'manual' });
      assert.equal(home.status, 302, '开启 → 手机 UA 首页 302');
      assert.equal(home.headers.get('location'), '/app', '跳转目标 /app');
      assert.equal(home.headers.get('cache-control'), 'no-store', '跳转响应 no-store');

      const idx = await fetch(`${base}/index.html`, { headers: { 'user-agent': MOBILE }, redirect: 'manual' });
      assert.equal(idx.status, 302, '/index.html 同样跳转');

      const desk = await fetch(`${base}/`, { headers: { 'user-agent': DESKTOP }, redirect: 'manual' });
      assert.equal(desk.status, 200, '桌面 UA 不跳转');

      const wechat = await fetch(`${base}/`, { headers: { 'user-agent': WECHAT }, redirect: 'manual' });
      assert.equal(wechat.status, 302, '微信 UA（MicroMessenger）也跳转 /app（下载页内有「在浏览器打开」提示）');

      for (const p of ['/console', '/login', '/register', '/app', '/banned', '/appeal', '/setup', '/change-password']) {
        const res = await fetch(`${base}${p}`, { headers: { 'user-agent': MOBILE }, redirect: 'manual' });
        assert.notEqual(res.headers.get('location'), '/app', `豁免路径 ${p} 不跳到 /app`);
      }
      const api = await fetch(`${base}/api/site`, { headers: { 'user-agent': MOBILE }, redirect: 'manual' });
      assert.notEqual(api.headers.get('location'), '/app', '/api/* 不跳转');
    } finally {
      await srv.close();
    }
  } finally {
    if (prev === undefined) delete process.env.APP_MOBILE_REDIRECT_ENABLED;
    else process.env.APP_MOBILE_REDIRECT_ENABLED = prev;
    await store.close();
  }
});

// CP 批（docs/MOBILE-DETECT-FIX.md §4）：手机识别三信号——
// 小米浏览器「桌面版网站」UA（X11 Linux + MiuiBrowser）必须跳；Sec-CH-UA-Mobile: ?1 的桌面 UA 壳跳；
// PC Chrome（Windows NT + ?0）不跳；纯桌面 UA 带泛化 Mobile 字样（无移动品牌）不跳；
// iPhone Safari / Android Chrome 保持 302 不回归。
test('CP：小米桌面 UA / 客户端提示跳转，纯桌面 UA 不跳', async () => {
  const frontend = mkdtempSync(join(tmpdir(), 'gp-frontend-'));
  writeFileSync(join(frontend, 'index.html'), '<!doctype html><html><body>ok</body></html>');
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const prev = process.env.APP_MOBILE_REDIRECT_ENABLED;
  try {
    process.env.APP_MOBILE_REDIRECT_ENABLED = '1';
    const srv = await startApiServer({ query: q, frontendDir: frontend, port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${srv.port}`;
    try {
      const miui = await fetch(`${base}/`, {
        headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36 MiuiBrowser/17.0.10' },
        redirect: 'manual',
      });
      assert.equal(miui.status, 302, '小米浏览器桌面 UA（X11 Linux + MiuiBrowser）→ 302');
      assert.equal(miui.headers.get('location'), '/app', '跳转目标 /app');

      const hint = await fetch(`${base}/`, {
        headers: {
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'sec-ch-ua-mobile': '?1',
        },
        redirect: 'manual',
      });
      assert.equal(hint.status, 302, 'Sec-CH-UA-Mobile: ?1（桌面 UA 壳）→ 302');

      const pc = await fetch(`${base}/`, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'sec-ch-ua-mobile': '?0',
        },
        redirect: 'manual',
      });
      assert.equal(pc.status, 200, 'PC Chrome → 200 不跳');

      const deskMobile = await fetch(`${base}/`, {
        headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
        redirect: 'manual',
      });
      assert.equal(deskMobile.status, 200, '纯桌面 UA 带泛化 Mobile 字样（无移动品牌）→ 200 不跳');

      for (const ua of [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Linux; Android 13; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      ]) {
        const r = await fetch(`${base}/`, { headers: { 'user-agent': ua }, redirect: 'manual' });
        assert.equal(r.status, 302, `标准手机 UA 保持 302：${ua.slice(0, 40)}…`);
      }
    } finally {
      await srv.close();
    }
  } finally {
    if (prev === undefined) delete process.env.APP_MOBILE_REDIRECT_ENABLED;
    else process.env.APP_MOBILE_REDIRECT_ENABLED = prev;
    await store.close();
  }
});

// CJ 现场回归（2026-11-17 线上 v2.22.0，docs/TODO.md CJ 条目）：/api/app/latest 的 apkPath 必须按
// 文件真实存在性派生——data/app（GitHub 每小时同步）优先 /app/dl/<ver>.apk，否则镜像内 /app/<ver>.apk 存在
// 时回落镜像路径（不能无条件 /app/dl/ 造成死链）；/app/dl/<file> 缺失时 302 兜底到 /app/<file>。
test('CJ-回归：apkPath 按 data/app 存在性回落镜像；/app/dl/<file> 缺失 302 到 /app/<file>', async () => {
  const frontend = mkdtempSync(join(tmpdir(), 'gp-frontend-'));
  writeFileSync(join(frontend, 'index.html'), '<!doctype html><html><body>ok</body></html>');
  mkdirSync(join(frontend, 'app'));
  writeFileSync(join(frontend, 'app', 'steamdeals-2.16.0.apk'), 'mirror-apk-bytes');
  writeFileSync(join(frontend, 'app', 'latest.json'), JSON.stringify({ version: '2.16.0', versionCode: 21600, minVersionCode: 21600, notes: ['修复 A'], apkPath: 'ignored', sha256: 'abc123', size: 42, releasedAt: '2026-11-14' }));
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  // DI（docs/TEST-ENV-ISOLATION.md §3A）：注入临时目录隔离工作区 data/app；临时目录为空 =
  // 同步任务首轮未跑/失败（现场回归场景：data/app 为空）。反向自检见 withAppDataDir 注释。
  const appData = withAppDataDir();
  const srv = await startApiServer({ query: q, frontendDir: frontend, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    // ① data/app 为空 → apkPath 回落镜像 /app/<ver>.apk（不是死链 /app/dl/…）
    const latest = await (await fetch(`${base}/api/app/latest`)).json();
    assert.equal(latest.apkPath, '/app/steamdeals-2.16.0.apk', 'data/app 为空 → apkPath 回落镜像路径');

    // ② /app/dl/<file> 不存在 → 302 到 /app/<file>（旧链接兜底）
    const dl = await fetch(`${base}/app/dl/steamdeals-2.16.0.apk`, { redirect: 'manual' });
    assert.equal(dl.status, 302, '/app/dl/ 缺失 → 302 兜底');
    assert.equal(dl.headers.get('location'), '/app/steamdeals-2.16.0.apk', '302 目标为镜像路径');
    assert.equal(dl.headers.get('cache-control'), 'no-store', '302 no-store');

    // 镜像路径真实可下载（200）
    const mirror = await fetch(`${base}/app/steamdeals-2.16.0.apk`);
    assert.equal(mirror.status, 200, '镜像 /app/<ver>.apk 200 可下载');

    // ③ data/app 有文件 → apkPath 用 /app/dl/ 且该路由 200
    writeFileSync(join(appData.dataDir, 'steamdeals-2.16.0.apk'), 'synced-apk-bytes');
    const latest2 = await (await fetch(`${base}/api/app/latest`)).json();
    assert.equal(latest2.apkPath, '/app/dl/steamdeals-2.16.0.apk', 'data/app 有文件 → /app/dl/ 路径');
    const dl2 = await fetch(`${base}/app/dl/steamdeals-2.16.0.apk`);
    assert.equal(dl2.status, 200, 'data/app 有文件 → /app/dl/ 200');
    assert.match(dl2.headers.get('content-type') || '', /vnd\.android\.package-archive/, '/app/dl/ Content-Type');

    // ④ 两边都没有 → GitHub Release 直链兜底（DK 批：不再 null；BY 契约缺失字段不报错）
    writeFileSync(join(frontend, 'app', 'latest.json'), JSON.stringify({ version: '2.17.0' }));
    const latest3 = await (await fetch(`${base}/api/app/latest`)).json();
    assert.equal(latest3.apkPath, 'https://github.com/yyliucha/steamdeals-app/releases/download/app-v2.17.0/steamdeals-2.17.0.apk', '镜像与 data/app 都没有该版本 → apkPath 兜底 GitHub 直链（DK）');
    // 版本缺失/非法 → 仍 null（BY 契约：缺失字段不报错）
    writeFileSync(join(frontend, 'app', 'latest.json'), JSON.stringify({ version: null }));
    const latest4 = await (await fetch(`${base}/api/app/latest`)).json();
    assert.equal(latest4.apkPath, null, 'version 缺失 → apkPath 仍 null');
  } finally {
    appData.restore(); // 恢复 APP_DATA_DIR 并清理临时目录（DI：用例结束不留临时目录）
    await srv.close();
    await store.close();
  }
});
