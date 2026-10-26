/* Product Search: lets the page open and search with no signal or Wi-Fi (detailedfoil, 26 Oct 2026).
 *
 * Registered by product-search/app.js with the scope "product-search", so it only ever looks after
 * tools/product-search.html and tools/product-search/...: no other Toolbox tool goes through it.
 *
 * Everything from the Toolbox the page asks for is kept in one cache as it's fetched (this site only: Screwfix's photos,
 * GitHub's API and the visitor stats are left alone):
 *  - the page, its code and the lists: the site first (so updates come through), the kept copy when there's no
 *    answer in 4 seconds or no connection
 *  - photos and descriptions: the kept copy first (they hardly change), the site otherwise
 * The "Save for no signal" button (app.js) puts every description (not photos) into the same cache in one go.
 */
'use strict';

var CACHE = 'product-search-v1';
var WAIT = 4000;

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

function keep(req, res) {
  if (res && res.ok && res.type === 'basic') {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () { /* full: still works online */ });
  }
  return res;
}

function kept(req) {
  return caches.open(CACHE).then(function (c) {
    // a newer ?v= of a script or style that isn't kept yet: the last one kept will do
    return c.match(req, { ignoreVary: true }).then(function (hit) { return hit || c.match(req, { ignoreSearch: true, ignoreVary: true }); });
  });
}

function siteFirst(req) {
  return new Promise(function (ok, bad) {
    var done = false;
    var timer = setTimeout(function () {
      kept(req).then(function (hit) { if (hit && !done) { done = true; ok(hit); } });
    }, WAIT);
    fetch(req).then(function (res) {
      keep(req, res);
      if (!done) { done = true; clearTimeout(timer); ok(res); }
    }, function (err) {
      clearTimeout(timer);
      kept(req).then(function (hit) {
        if (done) return;
        done = true;
        if (hit) ok(hit); else bad(err);
      });
    });
  });
}

function keptFirst(req) {
  return kept(req).then(function (hit) { return hit || fetch(req).then(function (res) { return keep(req, res); }); });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Screwfix's photos, GitHub, visitor stats: not kept
  if (/\/product-search\/(?:photos|descriptions)\//.test(url.pathname)) { e.respondWith(keptFirst(req)); return; }
  e.respondWith(siteFirst(req));
});
