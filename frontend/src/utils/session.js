// BM 批（docs/SESSION-MANAGEMENT.md §8.4.3）：会话失效统一跳登录页；
// BT 批（docs/MOBILE-LOGIN-ENTRY-FIX.md §4.2）改为整页硬跳——所有进入登录页的入口统一走
// openLogin()，不再依赖 SPA 路由（浮层 history.back() 抢历史栈的竞态、懒加载 chunk 失败静默中止都
// 不再存在）；整页跳转不触发路由守卫，bypassNextGuard 不再需要。
import { openLogin } from './login-entry.js';

/**
 * 跳登录页（整页导航）。
 * @param {string} reason `expired` = 会话失效（登录页显示「登录已过期，请重新登录」）；
 *                        其它值不提示（如主动进入登录页）。
 */
export function redirectToLogin(reason = 'expired') {
  openLogin({ reason });
}
