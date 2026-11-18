/* Only the Warehouse Shift page needs offline navigation. The viewer shares its path. */
const CACHE = 'toolbox-warehouse-shift-v2';
const GAME = new URL('floor-plan.html?shift=1', self.location.href).href;
const ROOT = new URL('.', GAME);
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const page = await fetch(GAME, { cache: 'reload' });
    if (!page.ok) throw new Error('Game page unavailable');
    const html = await page.clone().text();
    const files = Array.from(html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)\?v=[^"]+)"/g), (match) => match[1]);
    files.push('warehouse-shift.webmanifest', 'floor-plan/shift-192.png', 'floor-plan/shift-512.png', 'floor-plan/data/shift-catalogue.json');
    await cache.addAll(files.map((file) => new Request(new URL(file, ROOT), { cache: 'reload' })));
    await cache.put(GAME, page);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('toolbox-warehouse-shift-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin) return;
  const gameNavigation = event.request.mode === 'navigate' && url.pathname === new URL(GAME).pathname && url.searchParams.get('shift') === '1';
  if (event.request.mode === 'navigate' && !gameNavigation) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (gameNavigation) {
      try { return await fetch(event.request); } catch (error) { return await cache.match(GAME) || Response.error(); }
    }
    return await cache.match(event.request) || fetch(event.request);
  })());
});
