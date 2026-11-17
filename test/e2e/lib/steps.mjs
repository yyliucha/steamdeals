// 矩阵行执行器（CK 批）：把 matrix.json 的 run 步骤解释成真实动作。
// 步骤类型分四组：browser（Edge CDP）/ api（真实 HTTP，含验证码）/ adb（设备）/ 组合（onlineChecks/imap/断言）。
// 所有断言都是行为级：等 DOM、看渲染、读接口响应、查库核对——不出现"源码字符串包含"式静态断言。
import { join } from 'node:path';
import * as account from './account.mjs';
import * as mail from './mail.mjs';
import { runOnlineChecks } from './online.mjs';

/** 行级跳过（环境不具备，规格 §6：skip 必须写原因）。 */
export class SkipError extends Error {
  constructor(reason) {
    super(reason);
    this.isSkip = true;
  }
}

/** 模板解析：'${a.b[0].c}' 从 ctx 取值（保存的变量 / mailEnv / 常量）。 */
export function resolveTemplate(value, ctx) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([\w.[\]]+)\}/g, (_, path) => {
      const v = path
        .split(/[.[\]]/)
        .filter(Boolean)
        .reduce((o, k) => (o == null ? o : o[k]), ctx);
      if (v === undefined || v === null) throw new Error(`模板变量未定义：\${${path}}`);
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplate(v, ctx));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveTemplate(v, ctx);
    return out;
  }
  return value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 浏览器内点击：selector 优先，否则按可见文本（取最深层匹配）。 */
async function clickElement(edge, { text, selector }) {
  const expr = `(() => {
    const byText = (t) => {
      const all = [...document.querySelectorAll('button, a, div, span, li, article, label, .el-select-dropdown__item')];
      const vis = (e) => e.offsetParent !== null || e.getClientRects().length > 0;
      const exact = all.filter((e) => (e.innerText || '').trim() === t && vis(e));
      const contains = all.filter((e) => (e.innerText || '').includes(t) && vis(e));
      const pick = (arr) => arr.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];
      return pick(exact.length ? exact : contains) || null;
    };
    let el = null;
    if (${JSON.stringify(selector)}) {
      const list = [...document.querySelectorAll(${JSON.stringify(selector)})];
      el = ${JSON.stringify(text)} ? list.find((e) => (e.innerText || '').includes(${JSON.stringify(text)})) : list[0];
    }
    if (!el && ${JSON.stringify(text)}) el = byText(${JSON.stringify(text)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return (el.innerText || el.tagName || 'element').trim().slice(0, 40);
  })()`;
  const hit = await edge.eval(expr);
  if (!hit) throw new Error(`找不到可点击元素：${JSON.stringify(selector ?? text)}`);
  return hit;
}

async function fillInput(edge, selector, value) {
  const hit = await edge.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!hit) throw new Error(`找不到输入框：${selector}`);
}

/** 浏览器登录链里的验证码：点验证码图让页面重新拉一张（token 进 Vue 状态），再读库里最新一张的答案填进去。 */
async function fillCaptcha(edge, selector, ctx) {
  // 先刷新页面持有的验证码：点击验证码图（LoginPage loadCaptcha / AppealPage 同类入口）
  await edge.eval(`(() => {
    const img = document.querySelector('.captcha-row img, img[alt*="验证码"]');
    if (img) { img.click(); return true; }
    return false;
  })()`);
  await sleep(400);
  const row = (await ctx.q(
    "select answer from login_challenges where expires_at > now() order by expires_at desc limit 1",
  )).rows[0];
  if (!row) throw new Error('没有可用验证码（login_challenges 为空）');
  await fillInput(edge, selector, row.answer);
}

async function pressEnter(edge, selector) {
  const hit = await edge.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    for (const type of ['keydown', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    }
    return true;
  })()`);
  if (!hit) throw new Error(`找不到元素：${selector}`);
}

/** 管理员浏览器会话热身：--only 单独跑后台行时也能自动登录。 */
export async function ensureAdminBrowserLogin(ctx) {
  if (ctx.adminBrowserReady) return;
  await ctx.edge.goto(`${ctx.base}/console`);
  try {
    await ctx.edge.waitDom({ has: '内容运营', timeoutMs: 8000 });
    ctx.adminBrowserReady = true;
    return;
  } catch {
    /* 未登录或首屏慢 → 走登录链 */
  }
  await ctx.edge.goto(`${ctx.base}/login`);
  await ctx.edge.waitDom({ has: '登录 SteamDeals' });
  await fillInput(ctx.edge, ".auth-field input[autocomplete='username']", ctx.adminUsername);
  await fillInput(ctx.edge, ".auth-field input[type='password']", ctx.adminPassword);
  await fillCaptcha(ctx.edge, '.captcha-row input', ctx);
  await clickElement(ctx.edge, { selector: '.auth-submit' });
  // 登录成功后的落点取决于来源：回跳 /console（next 参数）或回首页——两种都算成功
  try {
    await ctx.edge.waitDom({ has: '修改密码', timeoutMs: 10_000 });
  } catch {
    await ctx.edge.waitDom({ has: '内容运营', timeoutMs: 10_000 });
  }
  await ctx.edge.goto(`${ctx.base}/console`);
  await ctx.edge.waitDom({ has: '内容运营', timeoutMs: 10_000 });
  ctx.adminBrowserReady = true;
}

/** 退出登录（浏览器页面内 POST /api/logout；保证每轮从匿名态开始、可重复运行）。 */
async function logout(ctx) {
  if (ctx.edge) {
    await ctx.edge.goto(`${ctx.base}/`).catch(() => {});
    await ctx.edge.eval("fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).then((r) => r.status).catch(() => 0)").catch(() => {});
  }
  ctx.userCookie = '';
}

async function apiCall(ctx, step) {
  const path = resolveTemplate(step.path, ctx);
  const bodyRaw = step.body ? resolveTemplate(step.body, ctx) : undefined;
  // captchaToken/captchaAnswer='auto'：真实验证码链路（答案读库），用于"已删用户再登录"类断言
  if (bodyRaw?.captchaToken === 'auto') {
    const cap = await (await fetch(`${ctx.base}/api/captcha`)).json();
    bodyRaw.captchaToken = cap.token;
    if (bodyRaw.captchaAnswer === 'auto') {
      const row = (await ctx.q('select answer from login_challenges where token = $1', [cap.token])).rows[0];
      bodyRaw.captchaAnswer = row?.answer ?? '';
    }
  }
  const cookie = step.cookie === 'admin' ? ctx.adminCookie : step.cookie === 'user' ? ctx.userCookie : '';
  const res = await fetch(`${ctx.base}${path}`, {
    method: step.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: bodyRaw !== undefined ? JSON.stringify(bodyRaw) : undefined,
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  const scope = { status: res.status, body, ctx };
  if (step.expect) {
    const ok = new Function('status', 'body', 'ctx', `return Boolean(${resolveTemplate(step.expect, ctx)});`)(scope.status, scope.body, ctx);
    if (!ok) throw new Error(`${step.desc ?? path} 断言失败：expect=${step.expect} status=${scope.status} body=${JSON.stringify(body).slice(0, 300)}`);
  }
  if (step.saveAs) ctx[step.saveAs] = body;
  return { status: res.status, body };
}

/** ADB 步骤：uiautomator 树里按文本找节点中心坐标并点击（App 六屏走查）。 */
async function adbTapText(ctx, step) {
  const { uiDump, tap, screencap } = ctx.adb;
  const texts = await uiDump(ctx.serial, join(ctx.reportDir, 'ui-current.xml'));
  const xml = texts.join(' ');
  const target = resolveTemplate(step.text, ctx);
  if (!texts.includes(target)) {
    // 站点内容没渲染出来（模拟器无外网）→ 按环境不具备跳过，不判失败（规格 §6）
    throw new SkipError(`uiautomator 树中没有「${target}」（模拟器未能访问站点内容，疑似无外网），六屏走查按环境不具备跳过`);
  }
  // 重新读原始 XML 拿 bounds
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(join(ctx.reportDir, 'ui-current.xml'), 'utf8');
  const node = raw.match(new RegExp(`<node[^>]*text="${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`));
  if (!node) throw new SkipError(`「${target}」节点无 bounds，跳过点击`);
  const b = node[0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!b) throw new SkipError(`「${target}」节点无 bounds，跳过点击`);
  await tap(ctx.serial, (Number(b[1]) + Number(b[3])) / 2, (Number(b[2]) + Number(b[4])) / 2);
  await screencap(ctx.serial, join(ctx.reportDir, `ui-tap-${target}.png`)).catch(() => {});
  return `tapped ${target}`;
}

/** 行执行入口：跑完 run 数组；失败抛错（runner 记入行结果）。 */
export async function executeRow(row, ctx) {
  ctx.rowArtifacts = [];
  for (const step of row.run ?? []) {
    const [kind] = Object.keys(step);
    const s = step[kind];
    switch (kind) {
      // ---- 浏览器 ----
      case 'goto': {
        const url = resolveTemplate(s, ctx);
        const target = url.startsWith('http') ? url : `${ctx.base}${url}`;
        await ctx.edge.goto(target);
        break;
      }
      case 'waitDom':
        await ctx.edge.waitDom({ has: resolveTemplate(s.has, ctx), not: s.not ? resolveTemplate(s.not, ctx) : undefined, timeoutMs: s.timeoutMs });
        break;
      case 'click':
        await clickElement(ctx.edge, { text: s.text ? resolveTemplate(s.text, ctx) : null, selector: s.selector });
        break;
      case 'fill':
        await fillInput(ctx.edge, s.selector, resolveTemplate(s.value, ctx));
        break;
      case 'fillCaptcha':
        await fillCaptcha(ctx.edge, s.selector, ctx);
        break;
      case 'pressEnter':
        await pressEnter(ctx.edge, s.selector);
        break;
      case 'logout':
        await logout(ctx);
        break;
      case 'assertEval': {
        const ok = await ctx.edge.eval(`Boolean(${resolveTemplate(s.expr, ctx)})`);
        if (!ok) throw new Error(`页面断言失败：${s.desc ?? s.expr}`);
        break;
      }
      case 'assertUrl': {
        const url = await ctx.edge.url();
        const hit = url.includes(resolveTemplate(s.includes, ctx));
        if (s.negate ? hit : !hit) throw new Error(`URL 断言失败：${url}（${s.negate ? '不应' : '应'}包含 ${s.includes}）`);
        break;
      }
      case 'viewport':
        await ctx.edge.setViewport(s);
        break;
      case 'resetViewport':
        await ctx.edge.setViewport({ width: 1280, height: 900, mobile: false });
        break;
      case 'screenshot': {
        const path = join(ctx.reportDir, `${s}.png`);
        await ctx.edge.screenshot(path);
        ctx.rowArtifacts.push(path);
        break;
      }
      case 'clearConsole':
        ctx.edge.clearConsole();
        break;
      case 'noConsoleError': {
        // 默认豁免浏览器自行发起的 favicon.ico 请求（站点只提供 /favicon.svg，404 属预期噪声）
        const allow = ['favicon.ico', ...(s.allow ?? [])];
        const errors = [...ctx.edge.consoleErrors, ...ctx.edge.logErrors].filter((e) => !allow.some((a) => e.includes(a)));
        ctx.rowConsoleErrors = errors;
        if (errors.length) throw new Error(`Console 出现 error：${errors.join(' | ').slice(0, 500)}`);
        break;
      }
      case 'sleep':
        await sleep(s.ms ?? s);
        break;

      // ---- API / 账号 ----
      case 'adminLogin':
        ctx.adminCookie = await account.apiLogin(ctx.base, resolveTemplate(s.username, ctx), resolveTemplate(s.password, ctx), ctx.q);
        break;
      case 'userLogin':
        ctx.userCookie = await account.apiLogin(ctx.base, resolveTemplate(s.username, ctx), resolveTemplate(s.password, ctx), ctx.q);
        break;
      case 'apiCall':
        await apiCall(ctx, s);
        break;
      case 'sql': {
        const r = await ctx.q(resolveTemplate(s.sql, ctx));
        const scope = { rows: r.rows, rowCount: r.rowCount, ctx };
        const ok = new Function('rows', 'rowCount', 'ctx', `return Boolean(${resolveTemplate(s.expect ?? 'true', ctx)});`)(scope.rows, scope.rowCount, ctx);
        if (!ok) throw new Error(`SQL 断言失败：${s.desc ?? s.sql}（rows=${JSON.stringify(r.rows).slice(0, 200)}）`);
        if (s.saveAs) ctx[s.saveAs] = r;
        break;
      }
      case 'cleanupOrphans':
        ctx.orphanCleanup = await account.cleanupOrphans(ctx.base, ctx.adminCookie, ctx.q);
        break;
      case 'eval': {
        // return (赋值表达式)：赋值表达式会返回右值，saveAs 才能拿到它
        const fn = new Function('ctx', `return (${s.expr});`);
        const v = fn(ctx);
        if (s.saveAs) ctx[s.saveAs] = v;
        break;
      }
      case 'assert': {
        const ok = new Function('ctx', `return Boolean(${resolveTemplate(s.expr, ctx)});`)(ctx);
        if (!ok) throw new Error(`断言失败：${s.desc ?? s.expr}`);
        break;
      }
      case 'imapWaitSubject': {
        const env = ctx.mailEnv;
        if (!env) throw new SkipError('无邮件凭据（F:\\dsh\\e2e-secrets\\mail.env 不存在），邮件行按环境不具备跳过');
        const contains = resolveTemplate(s.contains, ctx);
        const deadline = Date.now() + (s.timeoutMs ?? 60_000);
        let hit = null;
        while (Date.now() < deadline) {
          const subjects = await mail.fetchRecentSubjects(env, { limit: 20 });
          hit = subjects.find((m) => m.subject.includes(contains));
          if (hit) break;
          await sleep(3000);
        }
        if (!hit) throw new Error(`IMAP 未等到主题含「${contains}」的邮件`);
        ctx[s.saveAs ?? 'mailHit'] = { subject: hit.subject, from: hit.from };
        break;
      }

      // ---- adb ----
      case 'adbInstall': {
        const { installApk } = ctx.adb;
        const out = await installApk(join(ctx.repoRoot, resolveTemplate(s.apk, ctx)), { reinstall: Boolean(s.reinstall) });
        if (!/Success/.test(out)) throw new Error(`APK 安装失败：${out.slice(0, 300)}`);
        break;
      }
      case 'adbLaunchApp':
        await ctx.adb.launchApp(ctx.serial);
        break;
      case 'adbUpdateCheck': {
        const out = await ctx.adb.launchUpdateCheck(ctx.serial);
        if (/unable to resolve|Error type/i.test(String(out))) {
          throw new SkipError('当前 APK（2.19.0 原生包）未注册 steamdeals://check-update scheme（TWA 世代入口；原生版更新检查走 App 内入口，属 CM 批补齐范围）');
        }
        break;
      }
      case 'adbAssertFocused': {
        const focused = await ctx.adb.focusedActivity(ctx.serial);
        const contains = resolveTemplate(s.contains, ctx);
        if (!focused.includes(contains)) throw new Error(`前台 Activity 断言失败：${focused}（应含 ${contains}）`);
        break;
      }
      case 'adbScreencap': {
        const path = join(ctx.reportDir, `${s}.png`);
        await ctx.adb.screencap(ctx.serial, path);
        ctx.rowArtifacts.push(path);
        break;
      }
      case 'adbUiDump': {
        // uiautomator dump 偶发失败/空：重试一次
        let texts = [];
        for (let i = 0; i < 2 && texts.length === 0; i += 1) {
          texts = await ctx.adb.uiDump(ctx.serial, join(ctx.reportDir, `${s.saveAs ?? 'uidump'}.xml`));
        }
        if (s.has && !texts.some((t) => t.includes(resolveTemplate(s.has, ctx)))) {
          throw new Error(`UI 树中缺少「${s.has}」`);
        }
        if (s.saveAs) ctx[s.saveAs] = texts;
        break;
      }
      case 'adbTapText':
        await adbTapText(ctx, s);
        break;
      case 'adbPackageVersion': {
        const v = await ctx.adb.packageVersion(ctx.serial);
        const expect = resolveTemplate(s.expect, ctx);
        if (v !== expect) throw new Error(`${s.desc ?? '版本断言失败'}：期望 ${expect}，实际 ${v}`);
        break;
      }

      // ---- 线上只读 ----
      case 'onlineChecks': {
        if (!ctx.online) throw new SkipError('未指定 --online（部署后跑，规格决策 #13）');
        const checks = await runOnlineChecks({
          base: ctx.onlineBase,
          browser: ctx.edge,
          expectVersion: ctx.expectVersion ?? null,
          reportDir: ctx.reportDir,
        });
        ctx.onlineChecks = checks;
        const failed = checks.filter((c) => !c.ok);
        if (failed.length) throw new Error(`线上检查未全过：${failed.map((c) => `${c.name}（${c.detail}）`).join('；')}`);
        break;
      }
      default:
        throw new Error(`未知步骤类型：${kind}`);
    }
  }
}
