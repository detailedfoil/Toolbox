/* Warehouse Shift keeps a complete start page and its versioned assets for offline play.
   catalogue.json and requests.json carry content hashes in the page, just like the scripts. */
const CACHE = 'warehouse-shift-v2';
const PAGE = new URL('warehouse-shift.html', self.location.href).href;

if (self.registration.scope.endsWith('floor-plan.html')) {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      for (const key of await caches.keys()) if (key.startsWith('toolbox-warehouse-shift-')) await caches.delete(key);
      await self.registration.unregister();
    })());
  });
} else {
  // Publish the page last. A failed download leaves the previous playable bundle in place.
  async function installBundle() {
    const page = await fetch(PAGE, { cache: 'no-store' });
    if (!page.ok) throw new Error('Page unavailable');
    const html = await page.clone().text();
    const files = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|json|png|webmanifest)(?:\?v=[^"]*)?)"/g)].map(match => match[1]);
    if (!files.some(file => file.startsWith('warehouse-shift/data/requests.json?v=')) ||
        !files.some(file => file.startsWith('warehouse-shift/data/catalogue.json?v='))) throw new Error('Incomplete release');
    const cache = await caches.open(CACHE);
    await cache.addAll([...new Set(files)].map(file => new Request(new URL(file, PAGE), { cache: 'reload' })));
    await cache.put(PAGE, page);
  }
  let pending;
  function installOnce() {
    if (!pending) pending = installBundle().finally(() => { pending = null; });
    return pending;
  }
  self.addEventListener('install', event => {
    event.waitUntil(installOnce().then(() => self.skipWaiting()));
  });
  self.addEventListener('message', event => {
    if (event.data !== 'install-update' || !event.ports[0]) return;
    event.waitUntil(installOnce().then(() => event.ports[0].postMessage(true), () => event.ports[0].postMessage(false)));
  });
  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      for (const key of await caches.keys()) if ((key.startsWith('warehouse-shift-') || key.startsWith('toolbox-warehouse-shift-')) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })());
  });
  self.addEventListener('fetch', (event) => {
    const req = event.request, url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;
    if (req.mode === 'navigate') {
      if (url.pathname !== new URL(PAGE).pathname) return;
      event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match(PAGE)) || fetch(req);

      })());
      return;
    }
    // the till's product lists: the kept copy now, a fresh one for next time
    if (/\/tools\/product-search\/data\/[a-z-]+\.json$/.test(url.pathname)) {
      event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const kept = await cache.match(req, { ignoreSearch: true });
        const fresh = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; });
        if (kept) { event.waitUntil(fresh.catch(() => {})); return kept; }
        try { return await fresh; } catch (e) { return Response.error(); }
      })());
      return;
    }
    // only what the game uses: its own files, three.js, the till's search and font, the sign-in scripts, the product photos and descriptions
    if (!/\/tools\/(warehouse-shift|floor-plan\/three|product-search\/photos|product-search\/descriptions|posters\/fonts)\/|\/tools\/product-search\/search\.js$|\/(auth|auth-data|analytics)\.js$/.test(url.pathname)) return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const kept = await cache.match(req);
      if (kept) return kept;
      try {
        const r = await fetch(req);
        if (r.ok) cache.put(req, r.clone());
        return r;
      } catch (e) { return Response.error(); }
    })());
  });
}
