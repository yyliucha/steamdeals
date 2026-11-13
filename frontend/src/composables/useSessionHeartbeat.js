// BM-4（docs/SESSION-MANAGEMENT.md §8.4.4）：会话心跳——"发现失效并软跳登录页"，不续期、不改会话策略。
//
// 为什么需要：会话失效（空闲超时 / IP·UA 绑定变化 / 自然到期）后，用户停在后台页什么也不点时，
// 只有"下一次请求"才会发现失效；所有者要求挂着页面也能在 ≤5 分钟内自动回登录页。
//
// 规则（规格 §8.5 第 6 条）：
//  · 每 5 分钟一次 + 切回前台补一次（页面隐藏时定时探测跳过，省请求）；
//  · 探测 `GET /api/me`（credentials: same-origin、cache: no-store），只看 `user`；
//  · 只有"上一次探测是已登录、这一次变成未登录（user === null 或 401）"才跳——
//    游客、从未登录的访客不会被误跳；主动退出登录由 Home.vue 的 logout() 调 markSessionLoggedOut() 标记；
//  · 网络错误 / 5xx / 429：本轮跳过、不跳转（离线时不能把人踢走）；
//  · 公开页（/login、/register、/setup、/banned、/appeal）不探测也不跳；
//  · 全局单例：startSessionHeartbeat() 只允许挂一次（main.js 调用一次），切页不叠加定时器。
import { redirectToLogin } from '../utils/session.js';

const INTERVAL_MS = 5 * 60 * 1000;
/** 公开页：不探测、不跳转（spec §8.4.4） */
export const PUBLIC_PATHS = ['/login', '/register', '/setup', '/banned', '/appeal'];

let started = false;
let timer = null;
let probing = false;
/** 上一次探测结果：null = 还没有基线；true = 已登录；false = 未登录 */
let lastLoggedIn = null;

/** 当前路径是否公开页（不探测）。 */
export function isPublicPage(pathname = typeof window === 'undefined' ? '' : window.location.pathname) {
  const p = String(pathname || '/').replace(/\/+$/, '') || '/';
  return PUBLIC_PATHS.includes(p);
}

/**
 * 心跳判定（纯函数，供单测）：只有"上一次探测是已登录、这一次变成未登录"才跳。
 * 游客（lastLoggedIn 为 false/null）永远不会被跳。
 */
export function shouldRedirectFor(wasLoggedIn, loggedIn) {
  return wasLoggedIn === true && loggedIn === false;
}

/** 主动退出登录后调用：把基线记成"未登录"，避免心跳把主动退出误判成会话失效。 */
export function markSessionLoggedOut() {
  lastLoggedIn = false;
}

/**
 * 心跳一次（导出便于将来做逻辑测试）：成功/失败都只更新基线；
 * 只有"上次已登录 → 这次未登录"才软跳。
 */
export async function probeSession() {
  if (typeof window === 'undefined') return;
  if (probing) return; // 上一次还没回来：不叠请求
  if (isPublicPage()) return; // 公开页不探测
  if (typeof document !== 'undefined' && document.hidden) return; // 页面隐藏：定时探测跳过，切回前台补
  probing = true;
  try {
    let res;
    try {
      res = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    } catch {
      return; // 离线 / 网络错误：本轮跳过，不跳转
    }
    if (res.status === 401) {
      const wasLoggedIn = lastLoggedIn === true;
      lastLoggedIn = false;
      if (wasLoggedIn) redirectToLogin('expired');
      return;
    }
    if (!res.ok) return; // 5xx / 429 等：本轮跳过，不跳转
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') return;
    const loggedIn = Boolean(data.user);
    const wasLoggedIn = lastLoggedIn === true;
    lastLoggedIn = loggedIn;
    if (wasLoggedIn && !loggedIn) redirectToLogin('expired');
  } finally {
    probing = false;
  }
}

/**
 * 启动会话心跳（全局一次）：立即探测一次建立基线，之后每 5 分钟 + 切回前台各一次。
 * 重复调用无副作用（单例守卫），避免每个页面各起一个定时器。
 */
export function startSessionHeartbeat() {
  if (started || typeof window === 'undefined') return;
  started = true;
  probeSession().catch(() => {});
  timer = setInterval(() => {
    probeSession().catch(() => {});
  }, INTERVAL_MS);
  timer?.unref?.();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') probeSession().catch(() => {});
  });
}

/** 停止心跳（测试/卸载用；生产不调用）。 */
export function stopSessionHeartbeat() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
