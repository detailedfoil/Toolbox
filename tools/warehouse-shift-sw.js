/* Warehouse Shift: lets the installed game open with no signal once it's been played with signal.
   Registered by warehouse-shift/game.js with scope "warehouse-shift", so it only looks after that page (never the
   other tools). The page itself comes from the site first (a 4 s wait, then the kept copy); its scripts, styles,
   product list and photos come from the kept copy first (their addresses change with every new version). The till's
   CrashFix tab uses Product Search's lists, which the GitHub check updates most nights: the kept copy answers at
   once and a fresh one is fetched for next time. The game used to live at floor-plan.html?shift=1; a copy of this
   worker still registered there just removes itself. */
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
  self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
      try {
        const cache = await caches.open(CACHE);
        const page = await fetch(PAGE, { cache: 'reload' });
        if (page.ok) {
          const html = await page.clone().text();
          const files = Array.from(html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|png|webmanifest)(?:\?v=[^"]*)?)"/g), (m) => m[1]);
          files.push('warehouse-shift/data/catalogue.json', 'warehouse-shift/data/requests.json');
          await Promise.all(files.map((f) => cache.add(new Request(new URL(f, PAGE), { cache: 'reload' })).catch(() => {})));
          await cache.put(PAGE, page);
        }
      } catch (e) { /* offline while installing: kept as the game is played instead */ }
      await self.skipWaiting();
    })());
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
        const net = fetch(req).then((r) => { if (r.ok) cache.put(PAGE, r.clone()); return r; });
        const timer = new Promise((r) => setTimeout(r, 4000));
        try {
          const first = await Promise.race([net, timer]);
          if (first) return first;
          return (await cache.match(PAGE)) || (await net);
        } catch (e) { return (await cache.match(PAGE)) || Response.error(); }
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
