// FV 批（docs/HEAD-FOOT-INJECTION.md §3）：站点 head/foot 注入。
// 守的约束：
//  1) 无注入配置时页面字节级不变（验收 2）——有配置时才读文件注入，无配置走原 serveStatic；
//  2) head/foot 注入位置正确（</head>/</body> 前）、注入只发生在 FRONTEND_PAGES 白名单（/assets、/app/*.apk 不注入）；
//  3) 内联 script 打 nonce（无 src、无 nonce 才打）、外链不动、nonce 空不打——严格 CSP 下注入脚本可执行（验收 3）；
//  4) 单段超 20KB 拒绝注入并记 http.head_injection_skipped，不截断（半截标签会破坏页面）；
//  5) 有注入时响应显式 cache-control: no-cache（验收 1 刷新生效，防旧 HTML）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { injectSpaHtml, serveFrontendStatic, HEAD_FOOT_MAX_BYTES } from '../src/server.js';

const SPA = '<!doctype html><html><head><meta charset="utf-8"><title>SteamDeals</title></head><body><div id="app"></div></body></html>';

function fakeRes() {
  return {
    status: 0,
    headers: {},
    body: null,
    cspNonce: '',
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
}

// ---------- injectSpaHtml 纯函数 ----------

test('FV-1：无注入内容原样返回（字节级一致）', () => {
  assert.equal(injectSpaHtml(SPA, {}), SPA);
  assert.equal(injectSpaHtml(SPA, { head: '  ', foot: '\n' }), SPA, '空白注入视为未配置');
});

test('FV-2：head/foot 注入到 </head>/</body> 前', () => {
  const out = injectSpaHtml(SPA, { head: '<!-- RUM -->', foot: '<div id="stat"></div>' });
  assert.ok(out.includes('<!-- RUM --></head>'), 'head 注入在 </head> 前');
  assert.ok(out.includes('<div id="stat"></div></body>'), 'foot 注入在 </body> 前');
  assert.ok(out.indexOf('<!-- RUM -->') < out.indexOf('<div id="stat"></div>'), 'head 在 foot 之前');
  assert.ok(out.includes('<div id="app"></div>'), '页面原有结构保留');
});

test('FV-3：内联 script 打 nonce；外链 src 与已有 nonce 不动；nonce 空不加', () => {
  const frag = [
    '<script>console.log(1)</script>',
    '<script src="https://cdn.example.com/rum.js"></script>',
    '<script nonce="keep">console.log(2)</script>',
    '<script type="module">console.log(3)</script>',
  ].join('');
  const out = injectSpaHtml(SPA, { head: frag, nonce: 'abc123' });
  assert.ok(out.includes('<script nonce="abc123">console.log(1)</script>'), '无属性内联 script 打 nonce');
  assert.ok(out.includes('<script src="https://cdn.example.com/rum.js"></script>'), '外链 script 不动（由 self 放行）');
  assert.ok(out.includes('<script nonce="keep">'), '已有 nonce 不重复打');
  assert.ok(out.includes('<script nonce="abc123" type="module">'), '带属性的内联 script 补 nonce 且属性保留');
  const noNonce = injectSpaHtml(SPA, { head: '<script>console.log(1)</script>', nonce: '' });
  assert.ok(noNonce.includes('<script>console.log(1)</script>'), 'CSP off（无 nonce）时不打');
});

test('FV-4：单段超 20KB 拒绝注入并记 http.head_injection_skipped，不截断', () => {
  const logs = [];
  const logger = { warn: (event, detail) => logs.push({ event, detail }) };
  const big = 'x'.repeat(HEAD_FOOT_MAX_BYTES + 1);
  const out = injectSpaHtml(SPA, { head: big, foot: '<b>ok</b>', logger });
  assert.ok(!out.includes(big), '超长 head 整段拒绝（不截断）');
  assert.ok(out.includes('<b>ok</b></body>'), '正常 foot 不受影响，照常注入');
  assert.equal(logs.length, 1, '只记一条跳过日志');
  assert.equal(logs[0].event, 'http.head_injection_skipped');
  assert.equal(logs[0].detail.slot, 'head');
  assert.equal(logs[0].detail.reason, 'too_long');
  assert.equal(logs[0].detail.limit, HEAD_FOOT_MAX_BYTES);
});

test('FV-5：恰好 20KB 允许注入；缺锚点跳过并记日志', () => {
  const exact = 'y'.repeat(HEAD_FOOT_MAX_BYTES);
  const out = injectSpaHtml(SPA, { foot: exact });
  assert.ok(out.includes(exact + '</body>'), '恰好 20KB 允许注入（边界含）');
  const logs = [];
  const noAnchor = injectSpaHtml('<html><head></head><div>x</div></html>', {
    foot: '<i>f</i>',
    logger: { warn: (e, d) => logs.push({ e, d }) },
  });
  assert.equal(noAnchor, '<html><head></head><div>x</div></html>', '无 </body> 锚点跳过注入');
  assert.equal(logs[0].e, 'http.head_injection_skipped');
  assert.equal(logs[0].d.reason, 'no_anchor');
});

// ---------- serveFrontendStatic 集成 ----------

function setup() {
  const frontendDir = mkdtempSync(join(tmpdir(), 'gp-fv-front-'));
  const outDir = mkdtempSync(join(tmpdir(), 'gp-fv-out-'));
  writeFileSync(join(frontendDir, 'index.html'), SPA);
  return {
    frontendDir,
    outDir,
    cleanup() {
      rmSync(frontendDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    },
  };
}

const saveEnv = () => ({ h: process.env.SITE_HEAD_INJECTION, f: process.env.SITE_FOOT_INJECTION });
const restoreEnv = (s) => {
  delete process.env.SITE_HEAD_INJECTION;
  delete process.env.SITE_FOOT_INJECTION;
  if (s.h !== undefined) process.env.SITE_HEAD_INJECTION = s.h;
  if (s.f !== undefined) process.env.SITE_FOOT_INJECTION = s.f;
};

test('FV-6：无 env 配置时与静态发送字节级一致（验收 2）', () => {
  const saved = saveEnv();
  delete process.env.SITE_HEAD_INJECTION;
  delete process.env.SITE_FOOT_INJECTION;
  try {
    const { frontendDir, outDir, cleanup } = setup();
    try {
      const res = fakeRes();
      serveFrontendStatic(res, frontendDir, outDir, '/');
      assert.equal(res.status, 200);
      assert.equal(res.body.toString(), readFileSync(join(frontendDir, 'index.html'), 'utf8'), 'body 与原文件字节级一致');
      assert.equal(res.headers['cache-control'], 'no-cache', '.html 维持 serveStatic 原 no-cache 口径');
    } finally {
      cleanup();
    }
  } finally {
    restoreEnv(saved);
  }
});

test('FV-7：有 env 配置时注入 + no-cache + nonce（验收 1/3）', () => {
  const saved = saveEnv();
  process.env.SITE_HEAD_INJECTION = '<script>window.__RUM__=1;</script>';
  process.env.SITE_FOOT_INJECTION = '<!-- stat -->';
  try {
    const { frontendDir, outDir, cleanup } = setup();
    try {
      const res = fakeRes();
      res.cspNonce = 'req-nonce-42';
      serveFrontendStatic(res, frontendDir, outDir, '/', { logger: null });
      const body = res.body.toString();
      assert.ok(body.includes('<script nonce="req-nonce-42">window.__RUM__=1;</script></head>'), 'head 注入且内联 script 带本请求 nonce');
      assert.ok(body.includes('<!-- stat --></body>'), 'foot 注入');
      assert.equal(res.headers['cache-control'], 'no-cache', '有注入时显式 no-cache');
      assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
      assert.equal(Number(res.headers['content-length']), Buffer.byteLength(body, 'utf8'), 'content-length 与注入后字节一致');
      assert.ok(!body.includes('<script>window.__RUM__=1;</script>'), '未打 nonce 的原样 script 不残留');
    } finally {
      cleanup();
    }
  } finally {
    restoreEnv(saved);
  }
});

test('FV-8：/assets/ 与 /app/*.apk 不受注入影响（验收 4 安全边界）', () => {
  const saved = saveEnv();
  process.env.SITE_HEAD_INJECTION = '<script>bad()</script>';
  process.env.SITE_FOOT_INJECTION = '<script>bad2()</script>';
  try {
    const { frontendDir, outDir, cleanup } = setup();
    try {
      mkdirSync(join(frontendDir, 'assets'), { recursive: true });
      mkdirSync(join(frontendDir, 'app'), { recursive: true });
      writeFileSync(join(frontendDir, 'assets', 'app.js'), 'console.log(1);');
      writeFileSync(join(frontendDir, 'app', 'steamdeals-9.9.9.apk'), 'APK');
      const asset = fakeRes();
      serveFrontendStatic(asset, frontendDir, outDir, '/assets/app.js');
      assert.equal(asset.body.toString(), 'console.log(1);', 'assets 原样发送，不注入');
      const apk = fakeRes();
      serveFrontendStatic(apk, frontendDir, outDir, '/app/steamdeals-9.9.9.apk');
      assert.equal(apk.body.toString(), 'APK', 'apk 原样发送，不注入');
      const page = fakeRes();
      serveFrontendStatic(page, frontendDir, outDir, '/');
      assert.ok(page.body.toString().includes('bad()'), '对照组：页面本身注入生效');
    } finally {
      cleanup();
    }
  } finally {
    restoreEnv(saved);
  }
});
