import { createApp } from 'vue';
import { ElAlert, ElBadge, ElButton, ElCheckbox, ElCheckboxGroup, ElConfigProvider, ElDialog, ElDrawer, ElEmpty, ElForm, ElFormItem, ElIcon, ElInput, ElOption, ElPagination, ElSelect, ElSkeleton, ElSwitch, ElTag } from 'element-plus';
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
import 'element-plus/es/components/select/style/css';
import 'element-plus/es/components/skeleton/style/css';
import 'element-plus/es/components/switch/style/css';
import 'element-plus/es/components/tag/style/css';
import App from './App.vue';
import router from './router/index.js';
import { bootstrapSiteTimezone } from './utils/siteTime.js';
import 'element-plus/theme-chalk/dark/css-vars.css';
import './styles/main.css';

bootstrapSiteTimezone();

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
for (const component of [ElAlert, ElBadge, ElButton, ElCheckbox, ElCheckboxGroup, ElConfigProvider, ElDialog, ElDrawer, ElEmpty, ElForm, ElFormItem, ElIcon, ElInput, ElOption, ElPagination, ElSelect, ElSkeleton, ElSwitch, ElTag]) app.use(component);
let adminUiReady = false;
router.beforeEach(async (to) => {
  if (to.path === '/console' && !adminUiReady) {
    const { installAdminUi } = await import('./admin-ui.js');
    installAdminUi(app);
    adminUiReady = true;
  }
});
// 封禁页（docs/FRONTEND-RENDER-FIX.md §2）：服务端已把 __BAN_PAGE__ 注入 index.html，
// 这里负责渲染它——被封用户刷新任意路径直接看到封禁卡片；/banned 与 /appeal 不跳（避免申诉死循环）。
if (window.__BAN_PAGE__ && location.pathname !== '/banned' && location.pathname !== '/appeal') {
  router.replace('/banned');
}
app.use(router).mount('#app');
