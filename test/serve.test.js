// 内置静态页服务：路径解析、内容类型、GET/HEAD/405、路径穿越防护。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFilePath, contentTypeFor, startStaticServer } from '../src/serve.js';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { FRONTEND_PAGES, startApiServer } from '../src/server.js';

function makeSite() {
  const root = mkdtempSync(join(tmpdir(), 'gp-serve-'));
  writeFileSync(join(root, 'index.html'), '<h1>首页</h1>');
  writeFileSync(join(root, 'game-105600.html'), '<h1>泰拉瑞亚</h1>');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'index.html'), '<h1>子目录</h1>');
  writeFileSync(join(root, 'styles.css'), 'body{}');
  return root;
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
test('BM-1：/login、/register、/change-password（含 next 参数）返回 200 index.html', async () => {
  const frontend = mkdtempSync(join(tmpdir(), 'gp-frontend-'));
  writeFileSync(join(frontend, 'index.html'), '<!doctype html><html><body><div id="app">spa-marker</div></body></html>');
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const srv = await startApiServer({ query: q, frontendDir: frontend, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    for (const p of ['/login', '/login?next=%2Fconsole%3Fsection%3Dgames', '/register', '/change-password', '/console?section=games']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, `${p} → 200`);
      assert.match(res.headers.get('content-type') || '', /text\/html/, `${p} → text/html`);
      assert.match(await res.text(), /spa-marker/, `${p} → index.html`);
    }
    // 白名单不是通配：未登记的路径仍是 404（而不是把所有路径都当 SPA）
    const missing = await fetch(`${base}/no-such-page`);
    assert.equal(missing.status, 404, '未登记路径 404');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('BM-1：前端 router 的每个页面路径都在服务端白名单（新增页面漏登记 → 测试红）', () => {
  const routerJs = readFileSync(new URL('../frontend/src/router/index.js', import.meta.url), 'utf8');
  const paths = [...routerJs.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(paths.length >= 8, `解析到路由路径（${paths.length} 条）`);
  for (const p of paths) assert.ok(FRONTEND_PAGES.includes(p), `router 路径 ${p} 已登记进 FRONTEND_PAGES`);
  for (const p of ['/login', '/register', '/change-password']) assert.ok(FRONTEND_PAGES.includes(p), `BM-1：${p} 在册`);
});
