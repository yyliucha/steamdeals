// PWA 安装提示（docs/MOBILE-FIX.md §3C）：
// Chrome/Edge 在可安装时触发 beforeinstallprompt——preventDefault 后保存事件，用户点
// 「安装到桌面」再 prompt()；appinstalled / display-mode: standalone 表示已安装，隐藏入口。
// 不支持安装的浏览器（小米自带浏览器、微信）不会触发事件：supported=false，UI 给 Chrome 操作说明。
import { onBeforeUnmount, ref } from 'vue';

function isStandalone() {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  if (typeof navigator !== 'undefined' && navigator.standalone) return true;
  return false;
}

export function useInstallPrompt() {
  const supported = ref(false);
  const installed = ref(false);
  const canInstall = ref(false);
  let deferred = null;

  if (typeof window !== 'undefined') {
    installed.value = isStandalone();
    const onBeforeInstall = (event) => {
      event.preventDefault(); // 收起浏览器自带的迷你安装条，改用页面自己的「安装到桌面」
      deferred = event;
      supported.value = true;
      canInstall.value = !installed.value;
    };
    const onInstalled = () => {
      installed.value = true;
      canInstall.value = false;
      deferred = null;
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    onBeforeUnmount(() => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    });
  }

  /** 弹系统安装对话框；返回是否被接受。没有可用事件时直接返回 false。 */
  async function install() {
    if (!deferred) return false;
    const event = deferred;
    deferred = null;
    event.prompt();
    try {
      const choice = await event.userChoice;
      const accepted = choice?.outcome === 'accepted';
      if (accepted) {
        installed.value = true;
        canInstall.value = false;
      }
      return accepted;
    } catch {
      return false;
    }
  }

  return { supported, installed, canInstall, install };
}
