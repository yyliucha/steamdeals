// headless Edge 驱动（CK 批，docs/E2E-SUITE.md §1 #3/#8）：
// 不引入 playwright/puppeteer——用 Edge 自带 DevTools 协议（CDP），通过 Node 22 内置 WebSocket 直连。
// 能力：导航 / DOM 断言 / 交互（click/fill）/ Console 错误采集 / 截图 / 视口与 UA（微信仿真）/ print-to-pdf。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomInt } from 'node:crypto';

export const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

// 全程统一桌面 UA：会话有 UA 绑定（auth.sessionBindUa），登录与后续请求的 UA 必须一致，
// 否则登录会话会因 bound_mismatch 401。移动/微信行用 setViewport 临时覆盖，行尾 resetViewport 回这里。
export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

export function findEdge() {
  return EDGE_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CDP HTTP ${res.status} @ ${url}`);
  return res.json();
}

/**
 * 启动 headless Edge 并返回驱动客户端。profileDir 必须是空目录（隔离 Cookie/缓存）。
 */
export async function launchEdge({ profileDir, windowWidth = 1280, windowHeight = 900 }) {
  const edge = findEdge();
  if (!edge) throw new Error('未找到 Microsoft Edge（预检应已拦截，请检查安装路径）');
  mkdirSync(profileDir, { recursive: true });
  const port = 9200 + randomInt(0, 400);
  const child = spawn(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--mute-audio',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      `--window-size=${windowWidth},${windowHeight}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const deadline = Date.now() + 45_000;
  let page;
  while (Date.now() < deadline) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) break;
    } catch {
      /* Edge 还没起来 */
    }
    await sleep(150);
  }
  if (!page?.webSocketDebuggerUrl) {
    child.kill();
    throw new Error('Edge DevTools 协议 45s 内未就绪');
  }
  const client = new EdgeClient(page.webSocketDebuggerUrl, port, child);
  await client.connect();
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  // 统一桌面 UA（会话 UA 绑定的稳定性前提，见 DESKTOP_UA 注释）
  await client.setUserAgent(DESKTOP_UA, 'Windows');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: windowWidth,
    height: windowHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return client;
}

export class EdgeClient {
  constructor(wsUrl, port, child) {
    this.port = port;
    this.child = child;
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map(); // method -> Set<fn>
    this.consoleErrors = [];
    this.logErrors = [];
  }

  async connect() {
    await new Promise((done, fail) => {
      this.ws.addEventListener('open', done, { once: true });
      this.ws.addEventListener('error', fail, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`CDP ${msg.method ?? '调用'} 失败：${msg.error.message ?? JSON.stringify(msg.error)}`));
        else p.resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
        const e = msg.params.entry;
        this.logErrors.push(`${e.url ?? ''} ${e.text ?? ''}`.trim());
      }
      for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
    });
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
  }

  /** 导航并等待页面 load 事件（SPA 后续渲染用 waitDom）。失败重试一次（首帧偶发超时）。 */
  async goto(url, { timeoutMs = 45_000 } = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const loaded = new Promise((done) => {
        const handler = () => {
          this.listeners.get('Page.loadEventFired')?.delete(handler);
          done(true);
        };
        this.on('Page.loadEventFired', handler);
        setTimeout(() => done(false), timeoutMs);
      });
      await this.send('Page.navigate', { url });
      const ok = await loaded;
      if (ok) return;
      if (attempt === 0) continue;
      throw new Error(`Page.navigate 超时（${timeoutMs}ms）：${url}`);
    }
  }

  /** 在页面上下文求值（awaitPromise），异常直接抛出。 */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`页面 JS 异常：${d.exception?.description ?? d.text ?? JSON.stringify(d)}`);
    }
    return r.result?.value;
  }

  async text() {
    return this.eval('document.body ? document.body.innerText : ""');
  }

  async url() {
    return this.eval('location.href');
  }

  /** 轮询等待 body 文本满足 has/not（默认 12s；SPA 渲染等待用）。 */
  async waitDom({ has, not, timeoutMs = 12_000, pollMs = 200 }) {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      last = await this.text();
      if (has && !last.includes(has)) {
        await sleep(pollMs);
        continue;
      }
      if (not && last.includes(not)) {
        await sleep(pollMs);
        continue;
      }
      return last;
    }
    throw new Error(`等待 DOM 超时：has=${JSON.stringify(has)} not=${JSON.stringify(not)}；最后文本前 300 字：${last.slice(0, 300)}`);
  }

  /** 设置/清除 UA override（显式设回桌面 UA，避免个别 Edge 不接受空对象清空）。 */
  async setUserAgent(ua = DESKTOP_UA, platform = 'Windows') {
    try {
      await this.send('Emulation.setUserAgentOverride', { userAgent: ua, platform });
    } catch {
      await this.send('Emulation.setUserAgentOverride', { userAgent: ua });
    }
  }

  async setViewport({ width, height, mobile, ua, deviceScaleFactor = 1 }) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: Boolean(mobile) });
    await this.setUserAgent(ua ?? DESKTOP_UA, mobile ? 'Android' : 'Windows');
  }

  /** 清理已采集的 Console 错误（每行测试前调用，行尾断言）。 */
  clearConsole() {
    this.consoleErrors = [];
    this.logErrors = [];
  }

  screenshot(filePath) {
    mkdirSync(dirname(filePath), { recursive: true });
    return this.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((r) => {
      writeFileSync(filePath, Buffer.from(r.data, 'base64'));
      return filePath;
    });
  }

  /** 当前页面打印成 PDF（报告用）。 */
  async printPdf(filePath, { landscape = false } = {}) {
    mkdirSync(dirname(filePath), { recursive: true });
    const r = await this.send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: false,
      landscape,
      paperWidth: 8.27,
      paperHeight: 11.69,
    });
    writeFileSync(filePath, Buffer.from(r.data, 'base64'));
    return filePath;
  }

  async close() {
    try {
      await this.send('Browser.close', {}, 3000).catch(() => {});
    } catch {
      /* 已关闭 */
    }
    try {
      this.ws.close();
    } catch {
      /* 忽略 */
    }
    this.child.kill();
  }
}

/** 一次性打印：独立 Edge 进程把本地 HTML 打印成 PDF（报告收尾用，不占用主浏览器）。 */
export function edgePrintHtmlToPdf(htmlPath, pdfPath) {
  const edge = findEdge();
  if (!edge) throw new Error('未找到 Microsoft Edge，无法生成 PDF 报告');
  const r = spawnSync(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`,
      `file:///${htmlPath.replace(/\\/g, '/')}`,
    ],
    { stdio: 'ignore', timeout: 60_000, windowsHide: true },
  );
  if (!existsSync(pdfPath)) {
    throw new Error(`PDF 生成失败（Edge 退出码 ${r.status}）：${htmlPath}`);
  }
  return pdfPath;
}
