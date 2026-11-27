// EN 批（docs/CSP-HARDENING.md）：CSP 安全加固——所有者 2026-11-24 决策「直接切正式 + 按日志收敛」。
// 锁五件事：
//   ① 默认发正式 Content-Security-Policy（enforce），不再默认 Report-Only；
//   ② 开关 security.csp.mode（env SECURITY_CSP_MODE）可切 report-only（观察/收敛期）与 off（回滚），
//      请求期读 env —— 设置保存后 hydrateSettings 写回 process.env，下一次请求即生效（热加载）；
//   ③ 策略按规格收敛：script-src 严格档不用 'unsafe-inline'（SPA 内联脚本按 sha256 + 注入脚本 nonce 放行）、
//      style-src 'unsafe-inline'（Element Plus）、img-src 'self' data: blob: https:、report-uri 上报端点；
//   ④ 违规上报 POST /api/csp-report：只记 csp.violation 日志、URL 去 query/fragment、始终 204、不掺访问统计；
//   ⑤ 兼容档（无构建产物时的旧 web/ 回退页）带 'unsafe-inline' 时**绝不能**带 nonce（CSP3 下 nonce 会让
//      'unsafe-inline' 失效，老页面内联脚本会被全拦）。
// 反向自检（本文件完成后实际做过）：注释掉 applySecurityHeaders 里的 CSP setHeader → ①/② 红；
// 把模式判定写死 enforce → report-only/off 用例红；给兼容档 policy 加 nonce → ⑤ 红；
// 删封禁页 nonce 属性 → 封禁页用例红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import * as visitors from '../src/visitors.js';
import * as settings from '../src/settings.js';
import { startApiServer, cspMode, buildCspPolicy, cspInlineScriptHashes } from '../src/server.js';

const sha256 = (text) => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;

/** 取策略里某个指令的值（`script-src 'self' ...` → "'self' ..."），没有返回 null。 */
function directive(policy, name) {
  for (const part of String(policy ?? '').split(';')) {
    const [key, ...rest] = part.trim().split(/\s+/);
    if (key === name) return rest.join(' ');
  }
  return null;
}

// SPA 文档模板：一段内联脚本（严格档必须按 sha256 放行）+ 一个外链 module（交给 'self'）。
const SPA_INLINE = 'window.__SPA__=1;';
const SPA_INDEX = `<!doctype html><html><head><script>${SPA_INLINE}</script></head><body><div id="app"></div><script type="module" src="/assets/index-abc.js"></script></body></html>`;

function makeFrontendDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gp-csp-frontend-'));
  writeFileSync(join(dir, 'index.html'), SPA_INDEX);
  return dir;
}

async function withServer({ frontendDir = null, outDir = null, logger = null } = {}, fn) {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const srv = await startApiServer({ query: q, store, outDir, frontendDir, logger, port: 0, host: '127.0.0.1' });
  try {
    return await fn({ store, q, srv, base: `http://127.0.0.1:${srv.port}` });
  } finally {
    await srv.close();
    await store.close();
  }
}

/** 临时改 CSP 模式并保证用例结束恢复（模拟「保存设置 → hydrate 写回 env」的同一条路径）。 */
async function withCspMode(value, fn) {
  const prev = process.env.SECURITY_CSP_MODE;
  if (value === undefined) delete process.env.SECURITY_CSP_MODE;
  else process.env.SECURITY_CSP_MODE = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.SECURITY_CSP_MODE;
    else process.env.SECURITY_CSP_MODE = prev;
  }
}

test('设置项：security.csp.mode 默认 enforce，三档齐全（save 校验同源）', () => {
  const d = settings.SETTING_MAP.get('security.csp.mode');
  assert.ok(d, 'EN 批：security.csp.mode 设置项存在（页面可改、热加载）');
  assert.equal(d.type, 'enum');
  assert.equal(d.group, 'access', '落在「账号与安全」平铺分组（FY-1：auth + security 合并），设置页可直接看到');
  assert.equal(d.env, 'SECURITY_CSP_MODE', 'env 兜底名固定');
  assert.equal(d.default, 'enforce', '所有者决策（docs/CSP-HARDENING.md）：默认直接发正式 CSP');
  assert.deepEqual(d.options, ['enforce', 'report-only', 'off'], '三档：正式 / 只报告（观察收敛期）/ 关闭（回滚）');
  assert.deepEqual(settings.CSP_MODES, ['enforce', 'report-only', 'off'], '模式常量只此三档');
  for (const mode of settings.CSP_MODES) {
    assert.equal(settings.validateSetting(d, mode).ok, true, `${mode} 可保存`);
  }
  for (const bad of ['strict', 'on', 'Report', '']) {
    assert.equal(settings.validateSetting(d, bad).ok, false, `非法模式 ${JSON.stringify(bad)} 拒绝保存（不会有第四种行为）`);
  }
});

test('cspMode：缺省/非法回退 enforce，大小写归一化，report-only/off 透传', () => {
  assert.equal(cspMode({}), 'enforce', '没有设置时默认正式拦截（安全默认）');
  assert.equal(cspMode({ SECURITY_CSP_MODE: '' }), 'enforce');
  assert.equal(cspMode({ SECURITY_CSP_MODE: 'bogus' }), 'enforce', '非法值不静默关闭/降级防护');
  assert.equal(cspMode({ SECURITY_CSP_MODE: 'report-only' }), 'report-only');
  assert.equal(cspMode({ SECURITY_CSP_MODE: 'REPORT-ONLY' }), 'report-only', '手填 env 大小写/空格容错');
  assert.equal(cspMode({ SECURITY_CSP_MODE: ' off ' }), 'off');
});

test('策略内容：default/connect 同源、style 允许 inline、img 覆盖 data:/blob:/https:、report-uri 上报', () => {
  const policy = buildCspPolicy();
  assert.equal(directive(policy, 'default-src'), "'self'", '默认只允许同源（规格 §2）');
  assert.equal(directive(policy, 'style-src'), "'self' 'unsafe-inline'", 'Element Plus/现有页面大量 inline style（规格已确认）');

  const img = directive(policy, 'img-src').split(' ');
  for (const src of ["'self'", 'data:', 'blob:', 'https:']) {
    assert.ok(img.includes(src), `img-src 覆盖 ${src}（规格：图片走本站代理 + 少量外部图标；blob: 给头像本地裁剪预览）`);
  }

  assert.equal(directive(policy, 'connect-src'), "'self' https://rumt-zh.com", '接口只连站点自身 + RUM 上报域名（FV 批，Head 注入的 Aegis 需上报 rumt-zh.com）');
  assert.equal(directive(policy, 'font-src'), "'self' data:");
  assert.equal(directive(policy, 'object-src'), "'none'", '禁 object/embed（老式 XSS 载体）');
  assert.equal(directive(policy, 'base-uri'), "'self'", '防 <base> 劫持相对路径');
  assert.equal(directive(policy, 'form-action'), "'self'", '防表单外发');
  assert.equal(directive(policy, 'frame-ancestors'), "'none'", '防点击劫持（与 x-frame-options 一致）');
  assert.equal(directive(policy, 'report-uri'), '/api/csp-report', '两种模式都保留违规上报端点（规格 §2 第二步）');

  // 不许出现通配/非 https 脚本源（"最小策略"的硬约束）
  assert.ok(!/(^|[\s;])\*(\s|;|$)/.test(policy), '不能有裸 * 源');
  assert.ok(!/http:/.test(policy), '不能放开明文 http 源');
  assert.ok(!/ws:/.test(policy), '不能放开 websocket 源');
});

test('严格档 vs 兼容档：严格档用 sha256+nonce 且无 unsafe-inline；兼容档只有 unsafe-inline 且绝不带 nonce', () => {
  const strict = buildCspPolicy({ scriptNonce: 'N1', scriptHashes: ['sha256-AAA='] });
  const scriptStrict = directive(strict, 'script-src');
  assert.ok(scriptStrict.split(' ').includes("'self'"), '严格档允许同源脚本');
  assert.ok(scriptStrict.split(' ').includes("'sha256-AAA='"), '严格档按 hash 放行已知内联脚本');
  assert.ok(scriptStrict.split(' ').includes("'nonce-N1'"), '严格档给服务端注入脚本发 nonce');
  assert.ok(!scriptStrict.includes("'unsafe-inline'"), '严格档不放 inline（nonce/hash 与 unsafe-inline 同时存在会让后者失效，等于白写）');

  const compat = buildCspPolicy({ allowInlineScript: true });
  const scriptCompat = directive(compat, 'script-src');
  assert.equal(scriptCompat, "'self' 'unsafe-inline'", '兼容档（仅无构建产物回退页）只能放开 inline');
  assert.ok(!scriptCompat.includes("'nonce-"), '兼容档绝不能带 nonce——否则 CSP3 下 unsafe-inline 失效，回退页内联脚本全被拦');
  assert.ok(!scriptCompat.includes("'sha256-"), '兼容档不带 hash（没有意义且易误判）');
});

test('内联脚本 hash：按 <script> 原始字节算 sha256，跳过外链 script 与空脚本', () => {
  const html =
    '<script>var a=1;</script>' +
    '<script type="module" src="/assets/x.js"></script>' +
    '<script>\n  if (a) { b(); }\n</script>' +
    '<script>  </script>';
  const hashes = cspInlineScriptHashes(html);
  assert.equal(hashes.length, 2, '两段真内联脚本；外链和空白脚本不算');
  assert.ok(hashes.includes(sha256('var a=1;')), '第一段 hash 正确');
  assert.ok(hashes.includes(sha256('\n  if (a) { b(); }\n')), '换行/缩进必须原样参与 hash（浏览器按原始字节校验）');
  assert.ok(!hashes.includes(sha256('\n  if (a) { b(); }\n'.trim())), 'trim 过的内容不能误判为同一段');
  assert.deepEqual(cspInlineScriptHashes('<html></html>'), [], '没有内联脚本时为空');
});

test('HTTP：默认发正式 CSP（含 HEAD/curl -I）；SPA 页面严格档；非 SPA 路径兼容档', async () => {
  const frontendDir = makeFrontendDir();
  try {
    await withCspMode(undefined, () =>
      withServer({ frontendDir }, async ({ base }) => {
        const home = await fetch(`${base}/`);
        assert.equal(home.status, 200);
        const enforced = home.headers.get('content-security-policy');
        assert.ok(enforced, 'EN 验收③（docs/CSP-HARDENING.md §3-3）：默认响应带正式 Content-Security-Policy');
        assert.equal(home.headers.get('content-security-policy-report-only'), null, '默认不再发 Report-Only（所有者决策切正式）');

        // curl -I 等价：HEAD 也要有正式头
        const head = await fetch(`${base}/`, { method: 'HEAD' });
        assert.equal(head.status, 200);
        assert.ok(head.headers.get('content-security-policy'), 'HEAD（curl -I）同样能看到正式 CSP 头');

        const script = directive(enforced, 'script-src');
        assert.ok(script.split(' ').includes(`'${sha256(SPA_INLINE)}'`), '严格档放行 dist/index.html 的内联脚本（按内容 hash）');
        const nonce = /'nonce-([^']+)'/.exec(script)?.[1];
        assert.ok(nonce, '严格档给服务端注入脚本发 per-request nonce');
        assert.ok(!script.includes("'unsafe-inline'"), 'SPA 严格档不放 inline（只有 hash/nonce）');
        assert.equal(directive(enforced, 'style-src'), "'self' 'unsafe-inline'", 'Element Plus inline style 照旧可用');

        // 后台/登录页同样是 SPA 文档 → 严格档（验收②：正式模式前后台都要能跑）
        for (const p of ['/console', '/login', '/register', '/app', '/banned', '/appeal', '/change-password']) {
          const res = await fetch(`${base}${p}`);
          const policy = res.headers.get('content-security-policy');
          assert.ok(policy, `${p} 也带正式 CSP 头`);
          assert.ok(directive(policy, 'script-src').includes(`'${sha256(SPA_INLINE)}'`), `${p} 用严格档（hash 放行 SPA 内联脚本）`);
        }

        // 非 SPA 路径（API/静态资源）用兼容档：这些响应不是 SPA 文档，带 inline 兜底更安全
        const api = await fetch(`${base}/api/games`);
        assert.equal(api.status, 200);
        const apiPolicy = api.headers.get('content-security-policy');
        assert.ok(apiPolicy, 'API 响应同样带头（统一 applySecurityHeaders）');
        assert.equal(directive(apiPolicy, 'script-src'), "'self' 'unsafe-inline'", '非 SPA 文档走兼容档');
        assert.ok(!directive(apiPolicy, 'script-src').includes("'nonce-"), '兼容档不带 nonce');
      }),
    );
  } finally {
    rmSync(frontendDir, { recursive: true, force: true });
  }
});

test('HTTP：无构建产物时旧 web/ 回退页走兼容档（内联脚本/onclick 不被拦）', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'gp-csp-web-'));
  writeFileSync(join(outDir, 'index.html'), '<!doctype html><html><head><script>legacy()</script></head><body onclick="go()">旧页</body></html>');
  try {
    await withCspMode(undefined, () =>
      withServer({ frontendDir: null, outDir }, async ({ base }) => {
        const res = await fetch(`${base}/`);
        assert.equal(res.status, 200);
        const policy = res.headers.get('content-security-policy');
        assert.ok(policy, '无 dist 时页面同样带 CSP 头');
        // 旧 web/ 页有内联 <script> 与 onclick 属性：只能兼容档，否则正式模式会白屏
        assert.equal(directive(policy, 'script-src'), "'self' 'unsafe-inline'", '无构建产物 → 兼容档');
        assert.match(await res.text(), /legacy\(\)/, '页面照常返回');
      }),
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('开关：report-only 发观察头、off 两种头都不发、非法值回退 enforce、改 env 无需重启即生效', async () => {
  const frontendDir = makeFrontendDir();
  try {
    await withServer({ frontendDir }, async ({ base }) => {
      // ① 默认 enforce
      await withCspMode(undefined, async () => {
        const res = await fetch(`${base}/`);
        assert.ok(res.headers.get('content-security-policy'), '默认正式头');
        assert.equal(res.headers.get('content-security-policy-report-only'), null);
      });

      // ② 切观察：同一个进程、同一台服务，只改 env（= 设置保存后 hydrateSettings 写回 env 的热加载路径）
      await withCspMode('report-only', async () => {
        const res = await fetch(`${base}/`);
        const reportOnly = res.headers.get('content-security-policy-report-only');
        assert.ok(reportOnly, 'report-only：发 Content-Security-Policy-Report-Only（观察/收敛期）');
        assert.equal(res.headers.get('content-security-policy'), null, 'report-only：不发正式头（只观察不拦截）');
        assert.equal(directive(reportOnly, 'default-src'), "'self'", '观察头就是同一份策略（观察到的=将要拦的）');
        assert.ok(directive(reportOnly, 'script-src').includes(`'${sha256(SPA_INLINE)}'`), '观察模式同样按 hash 放行 SPA 内联脚本');
      });

      // ③ 关闭：两种 CSP 头都不发，但其它安全头不动（回滚开关 ≠ 关掉全部加固）
      await withCspMode('off', async () => {
        const res = await fetch(`${base}/`);
        assert.equal(res.headers.get('content-security-policy'), null, 'off：不发正式头');
        assert.equal(res.headers.get('content-security-policy-report-only'), null, 'off：不发 Report-Only');
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff', 'off 只关 CSP，其它安全头照旧');
        assert.equal(res.headers.get('x-frame-options'), 'DENY');
      });

      // ④ 非法值回退正式（不能因为配置写错就静默降级/关闭防护）
      await withCspMode('strict', async () => {
        const res = await fetch(`${base}/`);
        assert.ok(res.headers.get('content-security-policy'), '非法值 → 回退正式头');
        assert.equal(res.headers.get('content-security-policy-report-only'), null);
      });
    });
  } finally {
    rmSync(frontendDir, { recursive: true, force: true });
  }
});

test('封禁页：严格档下注入的内联脚本带同一 nonce（否则正式模式被封用户看不到倒计时/申诉页）', async () => {
  const frontendDir = makeFrontendDir();
  try {
    await withServer({ frontendDir }, async ({ base, q }) => {
      const ip = '127.0.0.1';
      try {
        await db.addBlockedIp(q, { ip, note: 'EN CSP 测试' });
        await visitors.refreshBlocklist(q);
        const res = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
        assert.equal(res.status, 403, '黑名单 IP 访问页面 → 封禁页 403');
        const policy = res.headers.get('content-security-policy');
        assert.ok(policy, '封禁页也带正式 CSP 头');
        const nonce = /'nonce-([^']+)'/.exec(directive(policy, 'script-src'))?.[1];
        assert.ok(nonce, '封禁页响应带 nonce 源');
        const html = await res.text();
        // nonce 里有 + / =，用字符串包含而不是拼正则（避免非预期元字符）
        assert.ok(
          html.includes(`<script nonce="${nonce}">window.__BAN_PAGE__=`),
          '注入脚本必须带同一 nonce（否则会被严格档拦掉）',
        );
        assert.match(html, /history\.replaceState/, '封禁页跳转脚本仍在（正式模式功能正常）');
      } finally {
        await db.removeBlockedIp(q, ip);
        await visitors.refreshBlocklist(q);
      }
    });
  } finally {
    rmSync(frontendDir, { recursive: true, force: true });
  }
});

test('302 与静态资源同样带 CSP 头（规格 §2：重定向/静态资源/图片代理路径不误伤）', async () => {
  const frontendDir = makeFrontendDir();
  mkdirSync(join(frontendDir, 'assets'), { recursive: true });
  writeFileSync(join(frontendDir, 'assets', 'index-abc.js'), 'console.log(1)');
  try {
    await withServer({ frontendDir }, async ({ base }) => {
      const redirect = await fetch(`${base}/setup`, { redirect: 'manual' });
      assert.equal(redirect.status, 302, '初始化完成后 /setup 仍是 302 回首页（既有行为不变）');
      assert.equal(redirect.headers.get('location'), '/');
      assert.ok(redirect.headers.get('content-security-policy'), '302 响应同样带头（CSP 不影响重定向）');

      const asset = await fetch(`${base}/assets/index-abc.js`);
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get('content-type') || '', /javascript/, '静态资源类型不变');
      assert.ok(asset.headers.get('content-security-policy'), '静态资源响应同样带头（img-src/script-src 的 \'self\' 覆盖自托管资源）');
    });
  } finally {
    rmSync(frontendDir, { recursive: true, force: true });
  }
});

test('违规上报：POST /api/csp-report 记 csp.violation（URL 去 query）、始终 204、不掺访问统计', async () => {
  const events = [];
  const logger = {
    info() {},
    warn(event, fields) {
      events.push({ event, fields });
    },
    error() {},
    debug() {},
    setLevel() {},
  };
  const frontendDir = makeFrontendDir();
  try {
    await withServer({ frontendDir, logger }, async ({ base, q }) => {
      const payload = {
        'csp-report': {
          'document-uri': 'https://sd.yyliucha.cn/console?token=SHOULD-NOT-BE-LOGGED#x',
          'violated-directive': "script-src 'self'",
          'blocked-uri': 'https://evil.example/bad.js?key=SHOULD-NOT-BE-LOGGED',
          disposition: 'enforce',
        },
      };
      const res = await fetch(`${base}/api/csp-report`, {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report' },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 204, '上报端点始终 204（避免浏览器重试风暴）');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const hit = events.find((e) => e.event === 'csp.violation');
      assert.ok(hit, '违规记录到 logger（规格 §2：csp.violation 日志可查）');
      assert.equal(hit.fields.directive, "script-src 'self'", '记录被违反的指令');
      assert.equal(hit.fields.document, '/console', 'document-uri 只留 path（query 里的 token 不许进日志）');
      assert.equal(hit.fields.blocked, 'https://evil.example/bad.js', 'blocked-uri 去 query（防把敏感参数写进日志）');
      assert.equal(hit.fields.disposition, 'enforce');

      // report-to 格式（{"reports":[...]}）同样兼容
      const res2 = await fetch(`${base}/api/csp-report`, {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report' },
        body: JSON.stringify({ reports: [{ effectiveDirective: 'img-src', blockedURL: 'data:text/html,secret', documentURL: '/home' }] }),
      });
      assert.equal(res2.status, 204);
      const hit2 = events.filter((e) => e.event === 'csp.violation').at(-1);
      assert.equal(hit2.fields.directive, 'img-src', 'report-to 的 effectiveDirective 也能识别');
      assert.equal(hit2.fields.blocked, 'data:…', 'data: 载荷只留协议名（不外泄 base64/内嵌内容）');

      // 非法 JSON 不炸端点
      const bad = await fetch(`${base}/api/csp-report`, {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report' },
        body: '{not json',
      });
      assert.equal(bad.status, 204, '非法 JSON 仍 204（上报端点不返回错误）');

      // GET 不命中上报路由（只接受 POST）→ 普通 API 404
      assert.equal((await fetch(`${base}/api/csp-report`)).status, 404, 'GET 不是上报路由');

      // 不掺访问统计：等待 finish 后的异步写库，确认没有被记成一次访问
      await new Promise((r) => setTimeout(r, 600));
      const rows = await q("select count(*)::int as n from visitor_logs where path = '/api/csp-report'");
      assert.equal(rows.rows[0].n, 0, 'CSP 上报不进访问统计（否则今日访问虚高）');
    });
  } finally {
    rmSync(frontendDir, { recursive: true, force: true });
  }
});
