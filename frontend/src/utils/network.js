// 统一网络失败提示（docs/MOBILE-PWA.md §2）：
// fetch 抛错（断网 / DNS 失败 / 连接超时）统一换成一句人话，并在 App 顶部显示可重试提示条。
// 明确不做离线缓存、不排队重放——没网就是没网，避免"看到旧页面"（规格 §3）。
import { ref } from 'vue';

export const NETWORK_ERROR_MESSAGE = '网络不可用，请检查连接后重试';

/** 全局网络状态：任意 fetch 网络失败置 true，任意请求成功或浏览器 online 事件置 false。 */
export const networkDown = ref(false);

/**
 * 原始 fetch：版本检查这类后台探测用它——失败属于预期（离线切回前台），
 * 不应点亮全局断网提示条（docs/MOBILE-PWA.md §7.8）。模块加载时 window.fetch 还没被包装。
 */
export const rawFetch =
  typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : null;

let installed = false;

export class NetworkError extends Error {
  constructor(cause) {
    super(NETWORK_ERROR_MESSAGE);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/**
 * 包装 window.fetch：只把"请求没有到达服务器"的异常换成语义化错误，
 * HTTP 4xx/5xx 仍是正常响应，由各页面自己处理。AbortError（输入防抖取消）不算断网。
 */
export function installNetworkGuard() {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  const rawFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    try {
      const res = await rawFetch(...args);
      networkDown.value = false;
      return res;
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      networkDown.value = true;
      throw new NetworkError(err);
    }
  };
  window.addEventListener('online', () => {
    networkDown.value = false;
  });
}
