// BM 批（docs/SESSION-MANAGEMENT.md §8.4.3）：会话失效统一软跳登录页。
//
// 背景：v2.11.0 的 `/login` 没登记进 SPA 回退白名单，后台页 401 用 `window.location.href` 整页跳过去
// 会落到旧 web/ 目录 → 纯文本 `not found`，登录页根本打不开。现在统一走 Vue 路由软跳：
// ① 不会整页导航，② 不会再撞静态回退，③ 带 `next`（登录后回跳原页）与 `reason`（登录页提示）。
import { bypassNextGuard } from '../composables/useUnsavedGuard.js';

/**
 * 软跳登录页（不整页导航）。
 * @param {string} reason `expired` = 会话失效（登录页显示「登录已过期，请重新登录」）；
 *                        其它值不提示（如主动进入登录页）。
 */
export function redirectToLogin(reason = 'expired') {
  if (typeof window === 'undefined') return;
  // 已经在登录页：防循环跳（登录页自己的请求不再触发跳转）
  if (window.location.pathname === '/login') return;
  const next = window.location.pathname + window.location.search + window.location.hash;
  // 未保存提醒（docs/UNSAVED-GUARD.md §4.3）会拦路由离开，跳转前放行一次
  try {
    bypassNextGuard();
  } catch {
    /* 非浏览器/测试环境：忽略 */
  }
  // 动态 import：避免 utils/session ↔ router ↔ pages 的顶层循环依赖
  import('../router/index.js')
    .then(({ default: router }) => router.push({ path: '/login', query: { next, reason } }))
    .catch(() => {});
}
