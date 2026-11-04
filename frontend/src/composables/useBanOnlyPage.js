// 仅封禁可见页面的客户端复查（docs/BAN-AND-SECURITY-FIXES.md §3.4）。
//
// 服务端只保证"未封禁进不来"（302）；但客户端路由进入、bfcache 恢复、残留 __BAN_PAGE__ 等
// 场景没有服务端往返。所以页面挂载后要自己复查封禁状态，解封即回首页：
//   1. 挂载即查：覆盖"零日志但不跳转"的场景；
//   2. 每 30 秒复查：解封后最多 30 秒自动离开；
//   3. 切回标签页立即复查：手机切后台再回来最常见的场景。
//
// 状态来源是只读接口 /api/ban/state（豁免拦截链与频率计数），所以：
//   - 429（接口自带限流）与网络离线都不跳，避免把正在申诉的人误踢走；
//   - 只认 banned === false 才跳；true / 异常都不动。
import { onMounted, onUnmounted } from 'vue';

export function useBanOnlyPage({ intervalMs = 30000 } = {}) {
  let timer = null;

  const check = async () => {
    try {
      const r = await fetch('/api/ban/state', { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (r.status === 429) return; // 被接口限流：本轮跳过，不误跳
      const data = await r.json();
      if (data.banned === false) window.location.replace('/');
    } catch {
      /* 离线：保持当前页，下轮再查 */
    }
  };

  const onVisible = () => {
    if (!document.hidden) check();
  };

  onMounted(() => {
    check();
    timer = setInterval(check, intervalMs);
    document.addEventListener('visibilitychange', onVisible);
  });
  onUnmounted(() => {
    if (timer) clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  });
}
