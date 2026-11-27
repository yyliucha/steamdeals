import { createRouter, createWebHistory } from 'vue-router';
import Home from '../pages/Home.vue';
import Setup from '../pages/Setup.vue';
import BanPage from '../pages/BanPage.vue';
import AppealPage from '../pages/AppealPage.vue';
import AppealActionPage from '../pages/AppealActionPage.vue';
import { installRouterGuard } from '../composables/useUnsavedGuard.js';
import { DEFAULT_SETTINGS_GROUP, isSettingsGroupId } from '../utils/settings.js';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: Home, meta: { title: 'SteamDeals · 游戏价格' } },
    { path: '/index.html', redirect: '/' },
    { path: '/setup', name: 'setup', component: Setup, meta: { title: 'SteamDeals · 系统初始化' } },
    { path: '/setup.html', redirect: '/setup' },
    { path: '/banned', name: 'banned', component: BanPage, meta: { title: '访问受限 · SteamDeals' } },
    { path: '/appeal', name: 'appeal', component: AppealPage, meta: { title: '申请解除访问限制 · SteamDeals' } },
    // BQ 批（docs/APPEAL-SYSTEM.md §10.4）：邮件内一键处理的确认页（token 在 URL fragment）
    { path: '/appeal/act', name: 'appeal-action', component: AppealActionPage, meta: { title: '申诉快捷处理 · SteamDeals' } },
    { path: '/banned.html', redirect: '/banned' },
    // FY-1（docs/SETTINGS-REDESIGN.md §3.1）：系统设置二级路由——每组独立 URL，可深链、可后退。
    // 未知 group（含缺省 /console/settings）一律回落默认组 sources；组件与 /console 共用 Console.vue。
    {
      path: '/console/settings/:group?',
      name: 'console-settings',
      component: () => import('../pages/Console.vue'),
      meta: { title: 'SteamDeals · 系统设置' },
      beforeEnter: (to) =>
        isSettingsGroupId(to.params.group)
          ? true
          : { path: `/console/settings/${DEFAULT_SETTINGS_GROUP}`, query: to.query },
    },
    // 裸 /console（无 ?section=）→ 设置默认组 sources；带 ?section= 的旧书签/深链保持原行为。
    {
      path: '/console',
      name: 'console',
      component: () => import('../pages/Console.vue'),
      meta: { title: 'SteamDeals · 管理控制台' },
      beforeEnter: (to) => (to.query.section ? true : { path: `/console/settings/${DEFAULT_SETTINGS_GROUP}`, query: to.query }),
    },
    { path: '/console.html', redirect: '/console' },
    // AL 批（docs/AUTH-REDESIGN.md §5.1）：独立登录 / 注册 / 修改密码页
    { path: '/login', name: 'login', component: () => import('../pages/LoginPage.vue'), meta: { title: '登录 · SteamDeals' } },
    { path: '/register', name: 'register', component: () => import('../pages/RegisterPage.vue'), meta: { title: '注册 · SteamDeals' } },
    { path: '/change-password', name: 'change-password', component: () => import('../pages/ChangePasswordPage.vue'), meta: { title: '修改密码 · SteamDeals' } },
    // BS 批（docs/MOBILE-APP-TWA.md §5.1）：安卓版 App 下载页（必须同步登记 server.js 的 FRONTEND_PAGES）
    { path: '/app', name: 'app-download', component: () => import('../pages/AppDownloadPage.vue'), meta: { title: '安卓版 App · SteamDeals' } },
  ],
});

router.afterEach((to) => { document.title = to.meta?.title || 'SteamDeals'; });
// AN 批（docs/UNSAVED-GUARD.md §4.3）：未保存修改的离开提醒——所有路由离开统一过 requestLeave()
installRouterGuard(router);
export default router;
