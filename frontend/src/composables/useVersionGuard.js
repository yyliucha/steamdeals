// 版本检查与「已更新」提示（docs/MOBILE-PWA.md §2.1，半自动更新，默认只提示）：
// 没有 service worker，重新打开/刷新一定会拿到新版（index.html 是 cache-control: no-cache，
// Vite 资源带 hash），但停在页面上的旧会话不会自己变。启动时记下当前版本，每次切回前台再查
// /api/site 的 version（src/server.js:657），不一致 → App.vue 顶部提示「已更新到 vX.Y.Z，点击刷新」。
import { ref } from 'vue';
import { rawFetch } from '../utils/network.js';

/**
 * 默认不自动 reload：详情弹窗、搜索输入、后台表单会丢状态（规格 §2.1）。
 * 若将来改成自动刷新，必须保留「没有打开浮层且无未提交表单时才 reload」的保护。
 */
const AUTO_RELOAD = false;

/** 全局唯一的更新提示状态（App.vue 消费）；模块级单例保证重复检测不叠加。 */
export const updateNotice = ref({ visible: false, version: '' });

/**
 * 版本比较纯函数（只比字符串，不做模糊匹配）：
 * - 相等 → 不提示；
 * - 不一致 → 提示；
 * - 基线为空（首次打开）/ 服务端没版本 → 不提示。
 */
export function shouldShowUpdate(current, latest) {
  if (!current || !latest) return false;
  return current !== latest;
}

let baseline = null;
let started = false;
let dismissed = false;

async function check() {
  // 用户点过「关闭」：本次会话不再检测、不再提示
  if (dismissed) return;
  try {
    // 用原始 fetch：后台探测失败（离线）不应点亮全局断网提示条（验收第 8 条：不误报）
    const res = await (rawFetch ?? fetch)('/api/site', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    const version = data && typeof data.version === 'string' ? data.version : '';
    if (!version) return;
    if (baseline === null) {
      baseline = version; // 首次：只记基线，不提示
      return;
    }
    if (shouldShowUpdate(baseline, version)) {
      baseline = version; // 记下新基线，重复切前台不重复弹
      if (AUTO_RELOAD) {
        window.location.reload();
        return;
      }
      updateNotice.value = { visible: true, version };
    }
  } catch {
    // 离线 / 请求失败：静默跳过，不弹更新、不误报（规格 §7.8）
  }
}

/** 启动 + visibilitychange 切回前台时各查一次。 */
export function startVersionGuard() {
  if (started || typeof window === 'undefined') return;
  started = true;
  check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

/** 用户点「关闭」：隐藏提示，且本次会话不再提示。 */
export function dismissUpdate() {
  dismissed = true;
  updateNotice.value = { visible: false, version: '' };
}
