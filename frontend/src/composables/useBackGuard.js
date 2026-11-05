// Android 返回键（PWA standalone）优先关闭浮层，而不是直接退出应用（docs/MOBILE-PWA.md §2）。
// 做法：浮层打开时 history.pushState 压一条占位记录，popstate 时只关闭最上层；
// 用户点按钮/遮罩关闭时把占位记录退掉，避免历史栈越积越深（否则要按很多次返回才退出）。
import { onBeforeUnmount, watch } from 'vue';

export function useBackGuard() {
  const stack = [];
  let seq = 0;
  let skipPop = 0;
  let bound = false;

  function onPopState() {
    if (skipPop > 0) {
      skipPop -= 1;
      return;
    }
    const top = stack.pop();
    if (top) top.close();
  }

  function bind() {
    if (bound || typeof window === 'undefined') return;
    bound = true;
    window.addEventListener('popstate', onPopState);
  }

  function release(layer) {
    const index = stack.indexOf(layer);
    if (index === -1) return; // 已经由 popstate 关掉，不要再补一次返回
    const isTop = index === stack.length - 1;
    stack.splice(index, 1);
    if (isTop) {
      skipPop += 1;
      window.history.back();
    }
  }

  /**
   * 登记一个浮层。
   * @param {() => boolean} isOpen 是否打开（用 getter 便于叠加 isMobile 判断）
   * @param {() => void} close 关闭动作
   */
  function guard(isOpen, close) {
    bind();
    let layer = null;
    watch(
      isOpen,
      (open) => {
        if (open && !layer) {
          layer = { id: ++seq, close };
          stack.push(layer);
          // 保留 Vue Router 写在 history.state 里的字段，只加自己的标记
          window.history.pushState({ ...window.history.state, sdLayer: layer.id }, '');
        } else if (!open && layer) {
          const closed = layer;
          layer = null;
          release(closed);
        }
      },
      { flush: 'pre' },
    );
  }

  onBeforeUnmount(() => {
    if (!bound) return;
    window.removeEventListener('popstate', onPopState);
    // 页面切换时历史记录已由路由接管，这里只清栈，不再 history.back()
    stack.length = 0;
    bound = false;
  });

  return { guard };
}
