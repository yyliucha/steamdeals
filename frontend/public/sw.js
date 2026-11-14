/* SteamDeals service worker（docs/MOBILE-APP-TWA.md §4，BS 批）
 *
 * 原则：离线只兜「静态观感」，绝不兜数据。
 *  · 只缓存 /assets/*（Vite 带 hash 的资源）与封面图（/img/…）；HTML、/api/*、/manifest.webmanifest 永不缓存；
 *  · 导航请求始终走网络——离线时页面显示现有「网络不可用」空态，绝不回退旧 index.html；
 *  · 版本变化：页面侧（useVersionGuard 的「点击刷新」）会 caches.delete 全部缓存 + registration.update() + reload；
 *  · activate 清掉非当前前缀的旧版本缓存（steamdeals-static-<buildId>）；
 *  · 注册时带 ?build=<站点版本>，缓存按版本隔离；页面带 ?nosw=1 时不注册（排查「看到旧页面」用）。
 */
const CACHE_PREFIX = 'steamdeals-static-';
const build = new URL(self.location.href).searchParams.get('build') || 'unknown';
const CACHE_NAME = CACHE_PREFIX + build;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 同源才管；非同源（Steam 外链等）直接放行
  if (url.origin !== self.location.origin) return;
  // 导航请求：始终走网络（绝不返回缓存的 index.html）
  if (req.mode === 'navigate') return;
  // 只缓存两类：带 hash 的构建产物与封面图
  const cacheable = /^\/assets\//.test(url.pathname) || /^\/img\//.test(url.pathname);
  if (!cacheable) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return cached || Response.error();
      }
    })(),
  );
});
