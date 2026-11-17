// 公网只读验收（CK 批，docs/E2E-SUITE.md §1 #9/#13）：--online 部署后跑，只发 GET，不碰服务器/生产库。
// 断言：/api/site 版本（--expect-version 可指定）、页面 dump-dom、截图、关键接口 200、TTFB 采样。
import { performance } from 'node:perf_hooks';

/** 关键只读接口清单（全部 GET，绝不包含写接口）。 */
export const ONLINE_ENDPOINTS = [
  '/api/site',
  '/api/games',
  '/api/games/count',
  '/api/announcements',
  '/api/app/latest',
  '/api/app/status',
  '/manifest.webmanifest',
];

async function get(base, path) {
  const t0 = performance.now();
  const res = await fetch(`${base}${path}`, { redirect: 'follow' });
  const ttfbMs = Math.round(performance.now() - t0);
  return { status: res.status, ttfbMs };
}

/**
 * 线上验收行：返回 { checks: [{name, ok, detail}] }，任何一条失败都会记入报告行。
 */
export async function runOnlineChecks({ base, browser, expectVersion, reportDir, screenshots = true }) {
  const checks = [];
  const push = (name, ok, detail = '') => checks.push({ name, ok, detail });

  // ① /api/site 版本
  try {
    const res = await fetch(`${base}/api/site`);
    const site = await res.json();
    push('/api/site 200', res.status === 200, `HTTP ${res.status}`);
    push('版本号返回', typeof site.version === 'string' && site.version.length > 0, `version=${site.version}`);
    if (expectVersion) {
      push(`版本=期望 ${expectVersion}`, site.version === expectVersion, `线上 ${site.version} vs 期望 ${expectVersion}`);
    }
  } catch (err) {
    push('/api/site', false, String(err.message).slice(0, 120));
  }

  // ② 关键接口 200 + TTFB 采样
  let ttfbMax = 0;
  for (const path of ONLINE_ENDPOINTS) {
    try {
      const { status, ttfbMs } = await get(base, path);
      ttfbMax = Math.max(ttfbMax, ttfbMs);
      push(`GET ${path}`, status === 200, `HTTP ${status} · TTFB ${ttfbMs}ms`);
    } catch (err) {
      push(`GET ${path}`, false, String(err.message).slice(0, 120));
    }
  }
  push('TTFB 上限', ttfbMax > 0 && ttfbMax < 5000, `本批最大 TTFB ${ttfbMax}ms（阈值 5000ms）`);

  // ③ 首页 dump-dom + 截图
  try {
    await browser.goto(`${base}/`);
    const text = await browser.waitDom({ has: '款收录条目', timeoutMs: 20_000 });
    push('首页关键区块', text.includes('款收录条目') && text.includes('游戏价格情报'), '目录统计/品牌文案可见');
    if (screenshots) {
      const shot = await browser.screenshot(`${reportDir}/online-home.png`);
      push('首页截图', Boolean(shot), shot);
    }
  } catch (err) {
    push('首页渲染', false, String(err.message).slice(0, 120));
  }

  // ④ /app 页（版本 + 下载入口）
  try {
    await browser.goto(`${base}/app`);
    const text = await browser.waitDom({ has: '下载', timeoutMs: 20_000 });
    push('/app 页下载入口', text.includes('下载') && text.includes('APK'), '下载区可见');
  } catch (err) {
    push('/app 页', false, String(err.message).slice(0, 120));
  }

  // ⑤ 后台未登录 → 守卫跳转（验证线上同源守卫行为）
  try {
    await browser.goto(`${base}/console`);
    await new Promise((r) => setTimeout(r, 1500));
    const url = await browser.url();
    push('后台守卫跳转', url.includes('/login') || url === `${base}/` || url.includes('console') === false, `落地 ${url}`);
  } catch (err) {
    push('后台守卫', false, String(err.message).slice(0, 120));
  }

  return checks;
}
