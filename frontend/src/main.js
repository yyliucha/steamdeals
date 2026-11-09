import { createApp } from 'vue';
import { ElAlert, ElBadge, ElButton, ElCheckbox, ElCheckboxGroup, ElConfigProvider, ElDialog, ElDrawer, ElEmpty, ElForm, ElFormItem, ElIcon, ElInput, ElOption, ElPagination, ElProgress, ElSelect, ElSkeleton, ElSwitch, ElTag } from 'element-plus';
import 'element-plus/es/components/alert/style/css';
import 'element-plus/es/components/badge/style/css';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/checkbox/style/css';
import 'element-plus/es/components/config-provider/style/css';
import 'element-plus/es/components/dialog/style/css';
import 'element-plus/es/components/drawer/style/css';
import 'element-plus/es/components/empty/style/css';
import 'element-plus/es/components/form/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/message/style/css';
import 'element-plus/es/components/option/style/css';
import 'element-plus/es/components/pagination/style/css';
import 'element-plus/es/components/progress/style/css';
import 'element-plus/es/components/select/style/css';
import 'element-plus/es/components/skeleton/style/css';
import 'element-plus/es/components/switch/style/css';
import 'element-plus/es/components/tag/style/css';
import App from './App.vue';
import router from './router/index.js';
import { bootstrapSiteTimezone } from './utils/siteTime.js';
import { installNetworkGuard } from './utils/network.js';
import { startVersionGuard } from './composables/useVersionGuard.js';
import 'element-plus/theme-chalk/dark/css-vars.css';
import './styles/main.css';

bootstrapSiteTimezone();
// 统一网络失败提示（docs/MOBILE-PWA.md §2）：放在创建应用前，页面里的 fetch 都走这层
installNetworkGuard();
// 版本检查与「已更新」提示（docs/MOBILE-PWA.md §2.1）：启动记基线，切回前台比对 /api/site
startVersionGuard();

// 移动端兜底（docs/MOBILE-VIEWPORT.md §3.2）：个别内核改写 viewport meta 后布局宽度仍不收敛时，
// 用 zoom 按 screen.width 比例补偿（优先 index.html 的 viewport 方案，这里只是最后手段；
// zoom 会影响 fixed 元素，正常情况下不会走到这条路径）。
(function syncViewportZoom() {
  try {
    const desktopMode = window.screen.width <= 640 && window.innerWidth > 700;
    document.documentElement.style.zoom = desktopMode ? String(window.innerWidth / window.screen.width) : '';
  } catch { /* 忽略 */ }
})();
window.addEventListener('resize', function () {
  try {
    const desktopMode = window.screen.width <= 640 && window.innerWidth > 700;
    document.documentElement.style.zoom = desktopMode ? String(window.innerWidth / window.screen.width) : '';
  } catch { /* 忽略 */ }
});

const app = createApp(App);
for (const component of [ElAlert, ElBadge, ElButton, ElCheckbox, ElCheckboxGroup, ElConfigProvider, ElDialog, ElDrawer, ElEmpty, ElForm, ElFormItem, ElIcon, ElInput, ElOption, ElPagination, ElProgress, ElSelect, ElSkeleton, ElSwitch, ElTag]) app.use(component);
let adminUiReady = false;
router.beforeEach(async (to) => {
  if (to.path === '/console' && !adminUiReady) {
    const { installAdminUi } = await import('./admin-ui.js');
    installAdminUi(app);
    adminUiReady = true;
  }
});
// 封禁页跳转不在这里做：ES module 提升让 createWebHistory 已按旧地址初始化，router.replace 无效。
// 服务端 serveBanPage 在 index.html 内联脚本里 history.replaceState('/banned')（见 FRONTEND-RENDER-FIX §2）。
app.use(router).mount('#app');
