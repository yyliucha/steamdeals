import { createRouter, createWebHistory } from 'vue-router';
import Home from '../pages/Home.vue';
import Setup from '../pages/Setup.vue';
import BanPage from '../pages/BanPage.vue';
import AppealPage from '../pages/AppealPage.vue';
import AppealActionPage from '../pages/AppealActionPage.vue';
import { installRouterGuard } from '../composables/useUnsavedGuard.js';

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
    { path: '/console', name: 'console', component: () => import('../pages/Console.vue'), meta: { title: 'SteamDeals · 管理控制台' } },
    { path: '/console.html', redirect: '/console' },
    // AL 批（docs/AUTH-REDESIGN.md §5.1）：独立登录 / 注册 / 修改密码页
    { path: '/login', name: 'login', component: () => import('../pages/LoginPage.vue'), meta: { title: '登录 · SteamDeals' } },
    { path: '/register', name: 'register', component: () => import('../pages/RegisterPage.vue'), meta: { title: '注册 · SteamDeals' } },
    { path: '/change-password', name: 'change-password', component: () => import('../pages/ChangePasswordPage.vue'), meta: { title: '修改密码 · SteamDeals' } },
  ],
});

router.afterEach((to) => { document.title = to.meta?.title || 'SteamDeals'; });
// AN 批（docs/UNSAVED-GUARD.md §4.3）：未保存修改的离开提醒——所有路由离开统一过 requestLeave()
installRouterGuard(router);
export default router;
