/* Only the public application shell is cached. API/auth/messages never enter CacheStorage. */
const BASE = new URL(self.registration.scope);
const CACHE = `dili-shell-v1:${BASE.pathname}`;
const shell = BASE.href;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch(shell, { cache: 'reload' });
    if (!response.ok) throw new Error('Shell unavailable');
    const html = await response.clone().text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => new URL(match[1], BASE)).filter(url => url.origin === BASE.origin && url.pathname.startsWith(`${BASE.pathname}assets/`));
    await cache.addAll(assets.map(url => url.href));
    await cache.put(shell, response);
  })());
});
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin || url.search) return;
  const isShell = request.mode === 'navigate' && url.pathname === BASE.pathname;
  const isAsset = url.pathname.startsWith(`${BASE.pathname}assets/`);
  if (!isShell && !isAsset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isAsset) { const cached = await cache.match(request); if (cached) return cached; }
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') await cache.put(isShell ? shell : request, response.clone());
      return response;
    } catch (error) { const cached = await cache.match(isShell ? shell : request); if (cached) return cached; throw error; }
  })());
});
