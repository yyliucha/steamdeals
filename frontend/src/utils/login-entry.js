// BT 批（docs/MOBILE-LOGIN-ENTRY-FIX.md §4.1，方案 C）：所有"进入登录页"的入口统一整页硬跳。
//
// 背景：手机「我的」面板点登录 = 关面板（触发返回键守卫 history.back()）+ router.push('/login')
// 在同一 tick 抢历史栈，小米浏览器上稳定复现"面板关了登录页不出现"；懒加载 chunk 失败时
// router.push 也会静默中止。整页跳转（location.assign）不依赖 SPA 路由与浮层历史栈，两种竞态都不存在。
// 登录页本身仍是 SPA（/login 已在服务端 FRONTEND_PAGES 白名单），登录成功后的 router.replace(next) 不变。

/** 回跳地址白名单：只接受站内相对路径（与 LoginPage.safeNext 同口径；//evil.com 之类回落为 /）。 */
export function safeNextPath(raw) {
  const s = String(raw ?? '');
  return s.startsWith('/') && !s.startsWith('//') ? s : '/';
}

/**
 * 整页跳转进入登录页。
 * @param {object} opts
 * @param {string} opts.reason `expired` = 会话失效（登录页显示「登录已过期，请重新登录」，BM-3 口径）
 * @param {string|null} opts.next 回跳地址；缺省用当前 pathname+search+hash
 */
export function openLogin({ reason = '', next = null } = {}) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === '/login') return; // 防循环
  const raw = next ?? (window.location.pathname + window.location.search + window.location.hash);
  const qs = new URLSearchParams({ next: safeNextPath(raw) });
  if (reason) qs.set('reason', reason);
  window.location.assign(`/login?${qs.toString()}`);
}
