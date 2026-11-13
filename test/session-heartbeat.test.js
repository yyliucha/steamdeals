// BM 批（docs/SESSION-MANAGEMENT.md §8，2026-11-13）：会话失效软跳 + 心跳的前端静态断言。
// 前端没有组件级测试框架，沿用项目惯例：源码断言 + frontend:build 兜底编译正确性。
// 覆盖规格 §8.5：3（软跳登录页带 next/reason）、4（5 处后台 401 行为一致、源码无硬跳）、
// 5（登录页 reason=expired 提示）、6（心跳：5 分钟/切前台、游客不跳、离线/5xx/429 不跳、公开页不探测、单例定时器）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const srcRoot = fileURLToPath(new URL('../frontend/src/', import.meta.url));

const heartbeat = read('../frontend/src/composables/useSessionHeartbeat.js');
const sessionJs = read('../frontend/src/utils/session.js');
const mainJs = read('../frontend/src/main.js');
const login = read('../frontend/src/pages/LoginPage.vue');
const home = read('../frontend/src/pages/Home.vue');
const pkg = JSON.parse(read('../package.json'));

/** 本批必须改成软跳的 5 处后台页面/抽屉（规格 §8.4.3）。 */
const ADMIN_401_FILES = [
  'pages/AdminModules.vue',
  'pages/AdminExtras.vue',
  'pages/AdminLogs.vue',
  'components/AnnouncementDrawer.vue',
  'components/UserCreateDrawer.vue',
];

test('BM-3：源码里不再有 window.location.href = \'/login\' 整页硬跳', () => {
  const files = readdirSync(srcRoot, { recursive: true })
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => /\.(vue|js)$/.test(f));
  assert.ok(files.length > 30, `扫到前端源码文件（${files.length} 个）`);
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(join(srcRoot, f), 'utf8');
    if (/window\.location\.href\s*=\s*['"`]\/login/.test(src) || /window\.location\.assign\(\s*['"`]\/login/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], '不允许再整页跳 /login（会撞静态回退并可能 404）');
});

test('BM-3：5 处后台 401 统一走 redirectToLogin()，软跳带 next 与 reason=expired', () => {
  for (const f of ADMIN_401_FILES) {
    const src = read(`../frontend/src/${f}`);
    assert.match(src, /import \{ redirectToLogin \} from '\.\.\/utils\/session\.js'/, `${f} 引入共享 helper`);
    assert.match(src, /r\.status\s*===\s*401\)\s*\{\s*redirectToLogin\(\)/, `${f} 401 → redirectToLogin()`);
  }
  assert.match(sessionJs, /export function redirectToLogin\(reason = 'expired'\)/, '导出 redirectToLogin(reason)');
  assert.match(sessionJs, /bypassNextGuard\(\)/, '跳转前放行未保存提醒（否则被拦）');
  assert.match(sessionJs, /router\.push\(\{ path: '\/login', query: \{ next, reason \} \}\)/s, '软跳 router.push，带 next + reason');
  assert.ok(!/window\.location\.href\s*=/.test(sessionJs), 'helper 自身不整页跳');
});

test('BM-3：登录页 reason=expired 提示「登录已过期，请重新登录」；无 reason 不显示', () => {
  assert.match(login, /route\.query\.reason === 'expired'/, '读 reason');
  assert.ok(login.includes('登录已过期，请重新登录'), '提示文案');
  assert.match(login, /v-if="expiredHint"/, '仅在 expiredHint 时渲染');
  assert.match(home, /router\.push\(\{path:'\/login',query:\{next:route\.fullPath,reason:'expired'\}\}\)/, '前台 401 软跳也带 reason');
  assert.match(home, /res\.status===401&&path!=='\/api\/me'&&path!=='\/api\/login'/, '后台探测/登录接口仍不跳（规格 §8.4.3）');
});

test('BM-4：心跳——5 分钟 + 切回前台探测 /api/me，全局单例，游客/离线/5xx/429 不跳，公开页不探测', () => {
  assert.match(heartbeat, /const INTERVAL_MS = 5 \* 60 \* 1000/, '每 5 分钟');
  assert.match(heartbeat, /fetch\('\/api\/me', \{ credentials: 'same-origin', cache: 'no-store' \}\)/, '探测 /api/me（不缓存）');
  assert.match(heartbeat, /document\.addEventListener\('visibilitychange'/, '切回前台补一次');
  assert.match(heartbeat, /document\.hidden\)\s*return/, '页面隐藏时定时探测跳过');
  assert.match(heartbeat, /let started = false;/, '单例守卫');
  assert.match(heartbeat, /if \(started \|\| typeof window === 'undefined'\) return;/, 'startSessionHeartbeat 只挂一次');
  assert.match(heartbeat, /const wasLoggedIn = lastLoggedIn === true;/, '基线：上次已登录');
  assert.match(heartbeat, /wasLoggedIn\) redirectToLogin\('expired'\)/, '才软跳（游客不跳）');
  assert.match(heartbeat, /catch \{\s*return; \/\/ 离线 \/ 网络错误：本轮跳过，不跳转/, '离线不跳');
  assert.match(heartbeat, /if \(!res\.ok\) return; \/\/ 5xx \/ 429 等：本轮跳过，不跳转/, '5xx/429 不跳');
  for (const p of ['/login', '/register', '/setup', '/banned', '/appeal']) {
    assert.ok(heartbeat.includes(`'${p}'`), `公开页 ${p} 不探测`);
  }
  assert.ok(!/expires/i.test(heartbeat), '心跳不碰 expires（不续期）');
  assert.match(mainJs, /import \{ startSessionHeartbeat \} from '\.\/composables\/useSessionHeartbeat\.js'/, 'main.js 引入');
  assert.match(mainJs, /startSessionHeartbeat\(\)/, 'main.js 挂一次');
  // 主动退出登录要标记基线，避免心跳把"主动退出"误判成"会话失效"
  assert.match(home, /markSessionLoggedOut\(\)/, 'logout 标记基线');
});

test('BM-4：前端静态断言已接入 npm test 主链', () => {
  assert.ok(pkg.scripts.test.includes('node test/session-heartbeat.test.js'), 'session-heartbeat 进主链');
  assert.ok(pkg.scripts.test.includes('node test/serve.test.js'), 'serve 进主链');
});


// BM-4：心跳判定纯函数的运行时断言（不只是静态 grep）：游客不跳、只跳"已登录→未登录"。
test('BM-4：shouldRedirectFor / isPublicPage 运行时行为', async () => {
  const hb = await import('../frontend/src/composables/useSessionHeartbeat.js');
  assert.equal(hb.shouldRedirectFor(true, false), true, '已登录→未登录：跳');
  assert.equal(hb.shouldRedirectFor(true, true), false, '仍登录：不跳');
  assert.equal(hb.shouldRedirectFor(false, false), false, '游客：不跳');
  assert.equal(hb.shouldRedirectFor(null, false), false, '无基线：不跳');
  assert.equal(hb.shouldRedirectFor(true, null), false, '状态未知：不跳');
  for (const p of ['/login', '/register', '/setup', '/banned', '/appeal']) assert.equal(hb.isPublicPage(p), true, `${p} 公开页`);
  for (const p of ['/console', '/', '/console/extra']) assert.equal(hb.isPublicPage(p), false, `${p} 要探测`);
});

test('BM-4：probeSession 在离线 / 5xx / 游客时不抛错、不跳（mock fetch）', async () => {
  const hb = await import('../frontend/src/composables/useSessionHeartbeat.js');
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  const savedFetch = globalThis.fetch;
  globalThis.window = { location: { pathname: '/console', search: '?section=games', hash: '' } };
  globalThis.document = { hidden: false };
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await hb.probeSession(); // 5xx：本轮跳过
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    await hb.probeSession(); // 离线：本轮跳过
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ user: null }) });
    await hb.probeSession(); // 游客：只记基线 false，不跳（未登录状态下也不跳）
  } finally {
    globalThis.fetch = savedFetch;
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
  }
});
