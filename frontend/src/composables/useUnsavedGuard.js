// 未保存修改的离开提醒（docs/UNSAVED-GUARD.md §4.1，AN 批）：
// 五个后台编辑面各自注册 { id, label, isDirty, save }；切菜单（Console.select）与路由离开
// （router.beforeEach）统一走 requestLeave()——有脏来源就弹三选一（保存并离开 / 放弃修改 / 留在本页）。
// 弹窗状态放模块级 reactive，由挂在 App.vue 的全局组件渲染（Console 卸载后弹窗仍在）。
// 刷新/关闭标签不拦（决策 3）；401/退出登录用 bypassNextGuard() 放过下一次导航。
import { reactive } from 'vue';

const sources = new Map();

/** 全局弹窗状态：由 UnsavedLeaveDialog.vue 消费。 */
export const unsavedDialog = reactive({ open: false, labels: [] });

let pendingResolve = null;
let pendingPromise = null;
let bypass = false;

/** 注册一个编辑面；返回注销函数（组件 onUnmounted 调用）。 */
export function registerUnsavedSource({ id, label, isDirty, save }) {
  sources.set(id, { label, isDirty, save });
  return () => {
    sources.delete(id);
  };
}

/** 当前为脏的来源列表（按注册顺序）。 */
export function dirtySources() {
  return [...sources.values()].filter((s) => {
    try {
      return Boolean(s.isDirty());
    } catch {
      return false;
    }
  });
}

export function hasDirtySources() {
  return dirtySources().length > 0;
}

/** Promise<boolean>：true=可以离开。没有脏来源直接放行；已有弹窗打开时复用同一个 Promise（防重复弹）。 */
export function requestLeave() {
  const dirty = dirtySources();
  if (!dirty.length) return Promise.resolve(true);
  if (pendingPromise) return pendingPromise;
  pendingPromise = new Promise((resolve) => {
    pendingResolve = resolve;
    unsavedDialog.labels = dirty.map((s) => s.label);
    unsavedDialog.open = true;
  });
  return pendingPromise;
}

function settle(ok) {
  unsavedDialog.open = false;
  const resolve = pendingResolve;
  pendingResolve = null;
  pendingPromise = null;
  resolve?.(ok);
}

/** 保存并离开：按注册顺序逐个保存当前脏的来源；全部成功才放行，任一失败关闭弹窗、留在本页并抛出错误（组件负责提示）。 */
export async function saveAndLeave() {
  const dirty = dirtySources();
  for (const source of [...sources.values()]) {
    if (!dirty.includes(source)) continue;
    try {
      await source.save();
    } catch (err) {
      settle(false); // 失败：关弹窗、取消导航，留在本页
      throw err;
    }
  }
  settle(true);
}

/** 放弃修改：直接放行。 */
export function discard() {
  settle(true);
}

/** 留在本页：取消本次导航。 */
export function stay() {
  settle(false);
}

/** 放过下一次导航（401 过期 / 退出登录跳转前调用，否则会被守卫拦下来卡死）。 */
export function bypassNextGuard() {
  bypass = true;
}

/** 注册全局路由守卫（router/index.js 调一次）。 */
export function installRouterGuard(router) {
  router.beforeEach(async () => {
    if (bypass) {
      bypass = false;
      return true;
    }
    return (await requestLeave()) ? true : false;
  });
}
