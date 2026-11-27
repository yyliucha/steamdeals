// FY-2（docs/SETTINGS-REDESIGN.md §7 验收 3/4/5/6/7/8）设置页「行列表 + 每项即时保存 + 跨组搜索 + 移动端」
// 的 headless 真交互验证。
//
// 为什么不进 npm test：要先 `npm run frontend:build`（构建产物 frontend/dist）+ 本机 Chrome/Edge；
// 与 test/api.test.js 同级（链外按需跑）。人工 / QA 复验命令：
//
//   node node_modules/vite/bin/vite.js build --config frontend/vite.config.js
//   node test/e2e/settings-rows.mjs
//
// 它做的是真点击 / 真悬停 / 真改输入框（CDP），断言 DOM 与真实 POST 次数：
//   验收 3：页面上 no .settings-card / no .settings-fold；分区标题 + 一行一项；高级项行内小标
//   验收 4：toggle 后 1 秒内出现「✓ 已保存」；int 停 600ms 后发出 POST；400 失败 → 回滚原值 + 红字
//   验收 5：1.5 秒内连改 3 项 → 只发 1 次 POST（fetch 计数）
//   验收 6：默认 opacity:0，鼠标移上去（真 hover）/ 键盘 focus 才出现来源徽标与「恢复默认」
//   验收 7：搜索跨 7 组命中、点结果跳组并高亮；只看非默认过滤 + 刷新后仍生效（localStorage）
//   验收 8：375px 行改上下两段、控件占满宽、触摸目标 ≥44px、无横向溢出；≤560px 左导航收成下拉
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './lib/browser.mjs';
import { startE2EStack, ADMIN_USERNAME, ADMIN_PASSWORD } from './lib/server.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = process.env.FY2_SHOT_DIR || join(tmpdir(), 'fy2-shots');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const stack = await startE2EStack(REPO);
  const profileDir = mkdtempSync(join(tmpdir(), 'fy2-chrome-'));
  const browser = await launchChrome({ profileDir, windowWidth: 1280, windowHeight: 900 });
  // headless 里窗口未激活时 document.activeElement 有值但 :focus 不生效（:focus-within 会假真），
  // 键盘可达性的断言必须先把页面前台化，否则会把「能 focus」误判成「不能」
  await browser.send('Page.bringToFront');
  const evalJs = (expression) => browser.eval(expression);
  async function waitFor(expression, timeoutMs = 5000, pollMs = 50) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evalJs(expression)) return true;
      await sleep(pollMs);
    }
    return false;
  }
  const goSettings = async (group = 'sources') => {
    await browser.goto(`${stack.base}/console/settings/${group}`);
    const ok = await waitFor("document.querySelectorAll('.setting-item').length > 0", 12000);
    if (!ok) throw new Error('设置页没有渲染出任何 .setting-item');
  };
  // 记录真实 POST /api/admin/settings（验收 4/5 的请求次数断言依据）；每次整页导航后要重装
  const installCounter = () =>
    evalJs(`(() => {
      window.__posts = [];
      window.__origFetch = window.fetch;
      window.fetch = function (u, o) {
        try {
          const url = typeof u === 'string' ? u : (u && u.url) || '';
          const method = String((o && o.method) || 'GET').toUpperCase();
          // 精确匹配 /api/admin/settings（不把 /api/admin/settings/restore 或 /value 算进来）；
          // 注意模板字符串里不能写正则转义（\? 会被吃成 ?），用 endsWith 判定路径
          const pathname = url.split('?')[0];
          if (pathname.endsWith('/api/admin/settings') && method === 'POST' && o && o.body) window.__posts.push(JSON.parse(o.body).values);
        } catch (e) { /* 记不上不影响业务 */ }
        return window.__origFetch.apply(this, arguments);
      };
    })()`);

  try {
    // ── 登录：真实验证码流程（答案从 login_challenges 读，与 e2e/lib/account.mjs 同款；不绕过鉴权）
    await browser.goto(`${stack.base}/login`);
    const cap = await evalJs("fetch('/api/captcha').then(r=>r.json())");
    const capRow = (await stack.q('select answer from login_challenges where token = $1', [cap.token])).rows[0];
    const loginStatus = await evalJs(
      `fetch('/api/login',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({username:${JSON.stringify(ADMIN_USERNAME)},password:${JSON.stringify(ADMIN_PASSWORD)},captchaToken:${JSON.stringify(cap.token)},captchaAnswer:${JSON.stringify(capRow ? capRow.answer : '')}})}).then(r=>r.status)`,
    );
    check('登录成功（headless 会话可用）', loginStatus === 200, `POST /api/login → ${loginStatus}`);

    await goSettings('sources');
    await browser.screenshot(join(SHOTS, 'fy2-desktop-sources.png'));
    // demo（design/settings-redesign-2026-11-27.html）是暗色稿：再抓一张暗色（跟随系统媒体查询）便于逐项对照
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await sleep(400);
    await browser.screenshot(join(SHOTS, 'fy2-desktop-sources-dark.png'));
    await browser.send('Emulation.setEmulatedMedia', { features: [] });
    await sleep(200);

    // ── 验收 3：分区标题 + 一行一项；无卡片盒子、无折叠
    const structure = await evalJs(`(() => {
      const q = (s) => document.querySelectorAll(s).length;
      const heads = [...document.querySelectorAll('.section-head h3')].map((h) => h.textContent.trim());
      const row = document.querySelector('.setting-item');
      return {
        rows: q('.setting-item'),
        cards: q('.settings-card'),
        fold: q('.settings-fold'),
        grids: q('.setting-grid'),
        heads,
        adv: q('.item-adv'),
        label: row?.querySelector('.item-name')?.textContent.trim() || '',
        help: row?.querySelector('.item-help')?.textContent.trim() || '',
        src: row?.querySelector('.item-src')?.textContent.trim() || '',
        restore: row?.querySelector('.item-restore')?.textContent.trim() || '',
      };
    })()`);
    check('验收 3：右侧是「分区标题 + 一行一项」', structure.rows > 10 && structure.heads.length >= 2, `行 ${structure.rows} / 分区标题 ${JSON.stringify(structure.heads)}`);
    check('验收 3：页面无卡片盒子（.settings-card=0）', structure.cards === 0, `settings-card=${structure.cards}`);
    check('验收 3：页面无「高级 N 项」折叠（.settings-fold=0、无 .setting-grid）', structure.fold === 0 && structure.grids === 0, `fold=${structure.fold} grid=${structure.grids}`);
    check('验收 3：高级项不再折叠，行内出现「高级」小标', structure.adv > 0, `高级小标 ${structure.adv} 个`);
    check('验收 3：每行 = label + 帮注 + 来源 + 恢复默认', Boolean(structure.label) && Boolean(structure.help) && ['数据库', '环境变量', '默认值'].includes(structure.src) && structure.restore === '恢复默认', `${structure.label} / ${structure.src} / ${structure.restore}`);

    // ── 验收 6：hover / focus 才出现来源徽标与「恢复默认」
    await browser.send('Page.bringToFront'); // 键盘可达性断言前必须前台化（见 launchChrome 处的说明）
    await sleep(150);
    const hiddenOpacity = await evalJs("getComputedStyle(document.querySelector('.setting-item .item-meta')).opacity");
    const rect = await evalJs(`(() => { const r = document.querySelector('.setting-item').getBoundingClientRect(); return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) }; })()`);
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
    await sleep(250);
    const hoverOpacity = await evalJs("getComputedStyle(document.querySelector('.setting-item .item-meta')).opacity");
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await sleep(250);
    const leaveOpacity = await evalJs("getComputedStyle(document.querySelector('.setting-item .item-meta')).opacity");
    // opacity 有 0.15s 过渡：focus 后等过渡结束再读计算值，否则会读到动画起点 0
    await evalJs("(() => { document.querySelector('.setting-item .item-restore').focus(); return true; })()");
    await sleep(300);
    const focusOpacity = await evalJs("getComputedStyle(document.querySelector('.setting-item .item-meta')).opacity");
    check('验收 6：来源徽标与「恢复默认」默认不可见', hiddenOpacity === '0', `默认 opacity=${hiddenOpacity}`);
    check('验收 6：鼠标 hover 该行才出现', hoverOpacity === '1' && leaveOpacity === '0', `hover=${hoverOpacity} / 移开=${leaveOpacity}`);
    check('验收 6：键盘 focus 该行也出现（可访问性）', focusOpacity === '1', `focus-within opacity=${focusOpacity}`);
    await evalJs("document.activeElement && document.activeElement.blur && document.activeElement.blur()");

    // ── 记录真实 POST /api/admin/settings（验收 4/5 的请求次数断言依据）
    await installCounter();
    const clickSwitch = (key) => evalJs(`(() => { const row = document.querySelector('[data-setting-key="${key}"]'); const sw = row && row.querySelector('.el-switch'); if (!sw) return false; sw.click(); return true; })()`);
    const readState = () => evalJs(`(() => { const s = document.querySelector('.item-state'); return s ? { cls: s.className, text: s.textContent.trim() } : null; })()`);

    // ── 验收 4：toggle 改动后 1 秒内出现「✓ 已保存」
    await evalJs('window.__posts = []');
    const t0 = Date.now();
    await clickSwitch('sources.steam.enabled');
    const savedAppeared = await waitFor("!!document.querySelector('[data-setting-key=\"sources.steam.enabled\"] .item-state.is-saved')", 1000, 25);
    const savedElapsed = Date.now() - t0;
    const savedState = await evalJs("(() => { const s = document.querySelector('[data-setting-key=\"sources.steam.enabled\"] .item-state'); return s ? s.textContent.trim() : ''; })()");
    const singlePosts = await evalJs('window.__posts');
    check('验收 4：toggle 改后 1 秒内出现 ✓ 已保存', savedAppeared && savedElapsed <= 1000, `耗时 ${savedElapsed}ms，文案「${savedState}」`);
    check('验收 4：toggle 只提交该项（局部 values）', singlePosts.length === 1 && Object.keys(singlePosts[0]).length === 1, `POST ${singlePosts.length} 次：${JSON.stringify(singlePosts)}`);

    // ── 行内「恢复默认」未回归：hover 出来的按钮 → 二次确认 → 发出 restore → 来源离开「数据库」
    // 注：同进程内 hydrateSettings 会把设置值写进 process.env，删库后 readSettings 回落 env（= 保存时的值），
    // 所以这里只能断言「UI 链路 + 来源回落」，不断言值回到默认（属后端既有的 env 影子问题，见 QA 报告风险 R1）
    const beforeSrc = await evalJs("document.querySelector('[data-setting-key=\"sources.steam.enabled\"] .item-src')?.textContent.trim() || ''");
    const restoreProbe = await evalJs(`(() => {
      const row = document.querySelector('[data-setting-key="sources.steam.enabled"]');
      const btn = row && row.querySelector('.item-restore');
      if (!btn) return { clicked: false, hasRow: !!row, text: row ? row.textContent.trim().slice(0, 60) : '' };
      btn.click();
      return { clicked: true, hasRow: true, text: btn.textContent.trim() };
    })()`);
    const restoreClicked = restoreProbe.clicked;
    const confirmShown = await waitFor("!!document.querySelector('.el-message-box')", 3000);
    await evalJs("(() => { const b = [...document.querySelectorAll('.el-message-box button')].find((x) => x.textContent.trim() === '确认恢复'); if (b) b.click(); return true; })()");
    const restored = await waitFor("(() => { const r = document.querySelector('[data-setting-key=\"sources.steam.enabled\"]'); return !!r && (r.querySelector('.item-src')?.textContent || '').trim() !== '数据库'; })()", 6000);
    const restoredSrc = await evalJs("document.querySelector('[data-setting-key=\"sources.steam.enabled\"] .item-src')?.textContent.trim() || ''");
    check('功能：行内「恢复默认」链路可用（二次确认 → 发出 restore → 来源离开「数据库」）', restoreClicked && confirmShown && beforeSrc === '数据库' && restored, `恢复前=${beforeSrc} 确认框=${confirmShown} 恢复后来源=${restoredSrc}`);

    // ── 验收 5：1.5 秒内连改 3 项只发 1 次 POST
    await evalJs('window.__posts = []');
    const t1 = Date.now();
    await clickSwitch('sources.sonkwo.enabled');
    await clickSwitch('sources.itad.enabled');
    await clickSwitch('sources.gog.enabled');
    await sleep(1600);
    const burstPosts = await evalJs('window.__posts');
    const burstMs = Date.now() - t1;
    check('验收 5：1.5 秒内连改 3 项只发 1 次 POST', burstPosts.length === 1 && Object.keys(burstPosts[0] || {}).length === 3, `${burstMs}ms 内 3 项 → POST ${burstPosts.length} 次：${JSON.stringify(burstPosts)}`);

    // ── 验收 4：int 输入停止 600ms 后保存（未失焦）
    await evalJs('window.__posts = []');
    const setInput = (key, value) => evalJs(`(() => {
      const row = document.querySelector('[data-setting-key="${key}"]');
      const input = row && row.querySelector('input');
      if (!input) return false;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await setInput('sources.steam.priceIntervalMin', 720);
    await sleep(450);
    const postsAt450 = await evalJs('window.__posts.length');
    await sleep(450);
    const intPosts = await evalJs('window.__posts');
    check('验收 4：int 输入停止 600ms 后保存（450ms 时还没发）', postsAt450 === 0, `450ms 时 POST=${postsAt450}`);
    check('验收 4：int 防抖到点只发 1 次且值是输入值', intPosts.length === 1 && intPosts[0]['sources.steam.priceIntervalMin'] === 720, `POST：${JSON.stringify(intPosts)}`);

    // ── 验收 4：失败回滚原值 + 红字原因（让服务端等价地返回 400「超出上限，已回滚」）
    const before = await evalJs(`(() => { const row = document.querySelector('[data-setting-key="steamStatus.rateMs"]'); return row && row.querySelector('input') ? row.querySelector('input').value : null; })()`);
    await evalJs(`(() => {
      window.__origFetch2 = window.fetch;
      window.fetch = function (u, o) {
        try {
          const url = typeof u === 'string' ? u : (u && u.url) || '';
          const body = o && o.body ? JSON.parse(o.body) : null;
          if (url.includes('/api/admin/settings') && body && body.values && Object.prototype.hasOwnProperty.call(body.values, 'steamStatus.rateMs')) {
            window.__posts.push(body.values);
            return Promise.resolve(new Response(JSON.stringify({ error: '超出上限，已回滚' }), { status: 400, headers: { 'content-type': 'application/json' } }));
          }
        } catch (e) { /* 落回真实请求 */ }
        return window.__origFetch2.apply(this, arguments);
      };
    })()`);
    await evalJs('window.__posts = []');
    await setInput('steamStatus.rateMs', 60000);
    await evalJs(`(() => { const row = document.querySelector('[data-setting-key="steamStatus.rateMs"]'); const input = row && row.querySelector('input'); if (input) input.blur(); return true; })()`);
    const errAppeared = await waitFor("!!document.querySelector('[data-setting-key=\"steamStatus.rateMs\"] .item-state.is-error')", 2500);
    const afterFailure = await evalJs(`(() => { const row = document.querySelector('[data-setting-key="steamStatus.rateMs"]'); return { value: row && row.querySelector('input') ? row.querySelector('input').value : null, text: (row && row.querySelector('.item-state') ? row.querySelector('.item-state').textContent : '').trim() }; })()`);
    check('验收 4：提交失败 → 行内红字原因', errAppeared && afterFailure.text.includes('✕') && afterFailure.text.includes('超出上限'), `「${afterFailure.text}」`);
    check('验收 4：提交失败 → 回滚上次值', afterFailure.value === before, `回滚后 input=${afterFailure.value}（失败前 ${before}）`);
    await browser.screenshot(join(SHOTS, 'fy2-desktop-failed.png'));

    // ── 验收 7：搜索跨 7 组命中 + 点结果跳组并高亮
    await goSettings('sources');
    const typeSearch = (q) => evalJs(`(() => {
      const input = document.querySelector('.settings-toolbar input');
      if (!input) return false;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(q)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await typeSearch('代理');
    const hitsReady = await waitFor("document.querySelectorAll('.settings-hit').length > 0", 4000);
    const hits = await evalJs("[...document.querySelectorAll('.settings-hit')].map((b) => ({ label: b.querySelector('.hit-label')?.textContent.trim(), meta: b.querySelector('.hit-meta')?.textContent.trim() }))");
    const crossGroup = hits.some((h) => String(h.meta).includes('网络与代理'));
    check('验收 7：搜索跨 7 组命中（当前组是数据源，仍能搜到「网络与代理」的项）', hitsReady && crossGroup, JSON.stringify(hits.slice(0, 4)));
    const clicked = await evalJs(`(() => {
      const target = [...document.querySelectorAll('.settings-hit')].find((b) => (b.querySelector('.hit-meta')?.textContent || '').includes('网络与代理'));
      if (!target) return '';
      target.click();
      return target.querySelector('.hit-label')?.textContent.trim() || 'hit';
    })()`);
    const jumped = await waitFor("location.pathname === '/console/settings/network'", 6000);
    const highlighted = await waitFor("!!document.querySelector('.setting-item.is-hit')", 6000);
    check('验收 7：点结果跳组（URL 换成 /console/settings/network）并高亮该行', jumped && highlighted, `点了「${clicked}」→ ${await evalJs('location.pathname')}，高亮行 ${await evalJs("document.querySelector('.setting-item.is-hit')?.dataset.settingKey || '（无）'")}`);

    // ── 控件类型保留：密钥行复用 SecretField（眼睛）、代理行「编辑」仍打开原弹窗
    const secretRow = await evalJs(`(() => {
      const row = document.querySelector('[data-setting-key="network.steamProxy"]');
      const eye = row && row.querySelector('.secret-eye');
      const edit = row && [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '编辑');
      if (edit) edit.click();
      return { hasSecretField: !!row?.querySelector('.secret-field'), hasEye: !!eye, hasEdit: !!edit, hint: row?.querySelector('.proxy-count')?.textContent.trim() || '' };
    })()`);
    const dialogOpen = await waitFor("!!document.querySelector('.el-dialog') && document.querySelector('.el-dialog')?.textContent.includes('Steam 专用代理')", 5000);
    check('验收 3：密钥行复用 SecretField（密码框 + 眼睛），代理行「编辑」仍打开原弹窗', secretRow.hasSecretField && secretRow.hasEye && secretRow.hasEdit && dialogOpen, `${secretRow.hint} / 弹窗=${dialogOpen}`);
    await evalJs("(() => { const btn = [...document.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent.trim() === '取消'); if (btn) btn.click(); return true; })()");
    await sleep(400);

    // ── 控件类型保留：站点与外观组的多行文本 + 枚举下拉
    await goSettings('site');
    const controls = await evalJs(`(() => {
      const textRow = document.querySelector('[data-setting-key="site.headInjection"]');
      const enumRow = document.querySelector('[data-setting-key="site.adultDisplay"]');
      return {
        textarea: !!textRow?.querySelector('textarea'),
        select: !!enumRow?.querySelector('.el-select'),
        advancedTag: !!document.querySelector('.setting-item .item-adv'),
      };
    })()`);
    check('验收 3：控件类型全部保留（text 多行 / enum 下拉 / 高级小标）', controls.textarea && controls.select && controls.advancedTag, JSON.stringify(controls));

    // ── 验收 7：只看非默认过滤 + 刷新后仍生效（localStorage）
    await goSettings('sources');
    const beforeRows = await evalJs("document.querySelectorAll('.setting-item').length");
    await evalJs("document.querySelector('.settings-toolbar .el-checkbox').click()");
    await sleep(400);
    const afterRows = await evalJs("document.querySelectorAll('.setting-item').length");
    const onlyChangedOn = await evalJs("!!document.querySelector('.settings-toolbar .el-checkbox.is-checked')");
    const localFlag = await evalJs("localStorage.getItem('settings-only-changed')");
    await browser.goto(`${stack.base}/console/settings/sources`);
    await waitFor("document.querySelectorAll('.setting-item').length > 0", 12000);
    await sleep(500);
    const reloadedRows = await evalJs("document.querySelectorAll('.setting-item').length");
    const reloadedOn = await evalJs("!!document.querySelector('.settings-toolbar .el-checkbox.is-checked')");
    check('验收 7：「只看非默认」过滤生效', onlyChangedOn && afterRows < beforeRows && afterRows > 0, `${beforeRows} 项 → ${afterRows} 项`);
    check('验收 7：刷新后仍然生效（localStorage 记忆）', reloadedOn && reloadedRows === afterRows && localFlag === '1', `刷新后 ${reloadedRows} 项，localStorage=${localFlag}`);
    await browser.screenshot(join(SHOTS, 'fy2-desktop-only-changed.png'));
    // 复位开关，避免影响后续移动端行数断言
    await evalJs("document.querySelector('.settings-toolbar .el-checkbox').click()");
    await sleep(300);

    // ── 验收 8：375px 行改上下两段、控件占满宽、触摸目标 ≥44px、无横向溢出
    await browser.setViewport({ width: 375, height: 812, mobile: true });
    await browser.goto(`${stack.base}/console/settings/sources`);
    await waitFor("document.querySelectorAll('.setting-item').length > 0", 12000);
    await sleep(400);
    const mobile = await evalJs(`(() => {
      const row = document.querySelector('.setting-item');
      const ctrl = row && row.querySelector('.item-ctrl');
      const input = row && row.querySelector('.item-ctrl .el-input');
      const sw = document.querySelector('.setting-item .el-switch');
      const nav = document.querySelector('.settings-nav');
      const mnav = document.querySelector('.settings-nav-mobile');
      const rect = row ? row.getBoundingClientRect() : { width: 0 };
      const inputRect = input ? input.getBoundingClientRect() : { width: 0 };
      const swRect = sw ? sw.getBoundingClientRect() : { height: 0 };
      return {
        columns: row ? getComputedStyle(row).gridTemplateColumns : '',
        ctrlDirection: ctrl ? getComputedStyle(ctrl).flexDirection : '',
        rowWidth: Math.round(rect.width),
        inputWidth: Math.round(inputRect.width),
        switchHeight: Math.round(swRect.height),
        navDisplay: nav ? getComputedStyle(nav).display : 'none',
        mobileNavDisplay: mnav ? getComputedStyle(mnav).display : 'none',
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    })()`);
    const singleColumn = !String(mobile.columns).trim().includes(' ');
    check('验收 8：≤560px 每行改上下两段（单列 + 控件纵向）', singleColumn && mobile.ctrlDirection === 'column', `grid-template-columns=${mobile.columns} / flex-direction=${mobile.ctrlDirection}`);
    check('验收 8：控件占满宽', mobile.inputWidth >= mobile.rowWidth - 40, `行 ${mobile.rowWidth}px / 输入框 ${mobile.inputWidth}px`);
    check('验收 8：左导航收成顶部下拉', mobile.navDisplay === 'none' && mobile.mobileNavDisplay !== 'none', `竖排导航 display=${mobile.navDisplay}，下拉 display=${mobile.mobileNavDisplay}`);
    check('验收 8：触摸目标 ≥44px', mobile.switchHeight >= 44, `开关可点高度 ${mobile.switchHeight}px`);
    check('验收 8：375px 无横向溢出', mobile.scrollWidth <= mobile.innerWidth + 1, `scrollWidth=${mobile.scrollWidth} / innerWidth=${mobile.innerWidth}`);
    await browser.screenshot(join(SHOTS, 'fy2-mobile-375.png'));

    // 移动端也能改一项并即时保存（控件占满宽后交互没坏）
    await installCounter();
    const mobileClick = await clickSwitch('sources.humble.enabled');
    const mobileSaved = await waitFor("!!document.querySelector('[data-setting-key=\"sources.humble.enabled\"] .item-state.is-saved')", 1500, 25);
    const mobilePosts = await evalJs('window.__posts');
    check('验收 8：移动端改一项仍即时保存（✓ 已保存 + 1 次 POST）', mobileClick && mobileSaved && mobilePosts.length === 1, `POST ${mobilePosts.length} 次：${JSON.stringify(mobilePosts)}`);
  } finally {
    await browser.close().catch(() => {});
    await stack.close().catch(() => {});
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* Chrome 进程刚退出时 profile 目录可能还被占用（Windows 常见），不影响验证结果 */
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nFY-2 headless 验收：${results.length - failed.length} 通过 / ${failed.length} 失败（截图目录 ${SHOTS}）`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('headless 验证异常：', err?.stack || err);
  process.exitCode = 1;
});
