// URL 参数隐私化（docs/URL-PARAM-PRIVACY.md）：/appeal 注入 __APPEAL__、code 白名单、
// robots.txt、敏感页响应头（noindex/no-store）、申诉编号密码学随机、旧链接清洗（静态断言）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer, newAppealCode } from '../src/server.js';
import * as ratelimit from '../src/ratelimit.js';
import * as guard from '../src/guard.js';
import * as devices from '../src/devices.js';

process.env.CAPTCHA_ENABLED = '0';
process.env.TRUST_PROXY = '1';
process.env.SITE_NAME = 'SteamDeals-Test';
process.env.APPEAL_EMAIL = 'appeal@example.com';

/** 伪造前端构建产物目录，让 serveAppealPage 走 Vue 注入路径。 */
function frontDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gp-appeal-front-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head></head><body>appeal-placeholder</body></html>');
  return dir;
}

async function boot({ frontendDir = null } = {}) {
  ratelimit.resetState();
  guard.resetState();
  devices.resetState();
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({
    query: q,
    outDir: fileURLToPath(new URL('../web', import.meta.url)),
    port: 0,
    host: '127.0.0.1',
    getSetupState: async () => ({ completed: true }),
    frontendDir,
  });
  return {
    q,
    base: `http://127.0.0.1:${srv.port}`,
    close: async () => {
      await srv.close();
      await store.close();
    },
  };
}

async function loginAdmin(base) {
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
    body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

const getNoFollow = (base, ip, path, extra = {}) => fetch(base + path, { headers: { 'x-forwarded-for': ip, ...extra }, redirect: 'manual' });

test('未封禁访问 /appeal 与 /appeal/ → 302 回首页（no-store）', async () => {
  const { base, close } = await boot({ frontendDir: frontDir() });
  try {
    for (const p of ['/appeal', '/appeal/', '/appeal?code=AP-ABC123&reason=访问被拒绝&until=&email=']) {
      const res = await getNoFollow(base, '198.51.101.1', p);
      assert.equal(res.status, 302, p);
      assert.equal(res.headers.get('location'), '/');
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
  } finally {
    await close();
  }
});

test('被封禁访问 /appeal：200 + 注入 __APPEAL__（site/email/code）+ no-store 与 noindex', async () => {
  const { q, base, close } = await boot({ frontendDir: frontDir() });
  try {
    const cookie = await loginAdmin(base);
    const victim = '198.51.101.2';
    await fetch(base + '/api/admin/blacklist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ ip: victim }),
    });
    const res = await fetch(base + '/appeal?code=AP-ABC123', { headers: { 'x-forwarded-for': victim, accept: 'text/html' } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /window\.__APPEAL__=\{/, '应注入 __APPEAL__');
    assert.match(html, /SteamDeals-Test/, '注入站点名');
    assert.match(html, /appeal@example\.com/, '注入申诉邮箱');
    assert.match(html, /AP-ABC123/, '注入合法 code');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');

    // 访问记录只落 pathname，不含 query（日志不落敏感参数）
    await new Promise((r) => setTimeout(r, 300));
    const row = (await q("select path from visitor_logs where ip = '198.51.101.2' order by id desc limit 1")).rows[0];
    assert.equal(row.path, '/appeal', '访问记录不含 query');
  } finally {
    await close();
  }
});

test('非法 code（含 <、超长、带空格）按空处理：不反射、不报错', async () => {
  const { base, close } = await boot({ frontendDir: frontDir() });
  try {
    const cookie = await loginAdmin(base);
    const victim = '198.51.101.3';
    await fetch(base + '/api/admin/blacklist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ ip: victim }),
    });
    for (const bad of ['<script>alert(1)</script>', 'a'.repeat(40), 'code with space']) {
      const res = await fetch(base + '/appeal?code=' + encodeURIComponent(bad), { headers: { 'x-forwarded-for': victim, accept: 'text/html' } });
      assert.equal(res.status, 200, `非法 code 也应正常渲染：${bad}`);
      const html = await res.text();
      assert.match(html, /"code":""/, `非法 code 应注入为空：${bad}`);
      assert.ok(!html.includes('alert(1)'), '不得反射危险字符');
      assert.ok(!html.includes('code with space'), '不得反射输入内容');
      assert.ok(!html.includes('a'.repeat(40)), '不得反射超长输入');
    }
  } finally {
    await close();
  }
});

test('GET /robots.txt：敏感路径 Disallow', async () => {
  const { base, close } = await boot();
  try {
    const res = await fetch(base + '/robots.txt');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /^User-agent: \*/);
    for (const line of ['/console', '/banned', '/appeal', '/api/']) {
      assert.ok(text.includes(`Disallow: ${line}`), line);
    }
  } finally {
    await close();
  }
});

test('申诉编号：AP-XXXXXX、字符集不含 0/O/1/I、连续 100 个无重复', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i += 1) {
    const code = newAppealCode();
    assert.match(code, /^AP-[A-HJ-NP-Z2-9]{6}$/, code);
    assert.ok(!/[01IO]/.test(code), `不得含易混字符：${code}`);
    seen.add(code);
  }
  assert.equal(seen.size, 100, '100 个不应重复');
});

test('前端：BanPage 申诉链接只带 code；AppealPage 读 __APPEAL__、去掉原因/时间、旧链接清洗', () => {
  const banPage = readFileSync(fileURLToPath(new URL('../frontend/src/pages/BanPage.vue', import.meta.url)), 'utf8');
  const appealPage = readFileSync(fileURLToPath(new URL('../frontend/src/pages/AppealPage.vue', import.meta.url)), 'utf8');

  const route = banPage.split('\n').find((line) => line.includes('appealRoute = computed'));
  assert.ok(route, 'BanPage 应有 appealRoute');
  assert.match(route, /query: \{ code: info\.code/, 'URL 应带 code');
  assert.ok(!/info\.reason|info\.until|info\.email/.test(route), 'URL 不得再带 reason/until/email');

  assert.match(appealPage, /window\.__APPEAL__/, '申诉页应读注入的 __APPEAL__');
  assert.match(appealPage, /useBanOnlyPage\(\)/, '申诉页应挂载解封复查');
  assert.match(appealPage, /router\.replace\(\{ path: '\/appeal'/, '旧链接应清洗地址栏');
  const template = appealPage.slice(appealPage.indexOf('<template>'));
  assert.ok(!template.includes('限制原因'), '申诉页不再展示限制原因');
  assert.ok(!template.includes('解除时间'), '申诉页不再展示解除时间');
  assert.match(template, /href="\/"/, '返回链接应回首页');
});
