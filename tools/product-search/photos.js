/* Product Search: storage on this phone and the product photos.
 *
 * Storage (IndexedDB "toolbox-product-search"): only the product list, so search works the moment the page opens,
 * even with no signal. Photos are NOT saved on the phone (detailedfoil, 20 Oct 2026): each one is a plain picture
 * from Screwfix's image server, media.screwfix.com/is/image/ae235/<CODE>_P at 120 x 120, the same server the A4
 * Posters tool uses, loaded only for results on screen. If one doesn't load the page shows a placeholder with the code.
 * (Photos once saved by an earlier version of this page are cleared away the next time it opens.)
 */
(function (root) {
  'use strict';

  var MEDIA = 'https://media.screwfix.com/is/image/ae235/';
  var SIZE = 120;
  var TIMEOUT = 15000;

  function photoUrl(sku) { return MEDIA + encodeURIComponent(sku) + '_P?wid=' + SIZE + '&hei=' + SIZE; }

  /* ---------- storage ---------- */

  var dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise(function (ok, bad) {
        if (!root.indexedDB) { bad(new Error('No storage')); return; }
        var req;
        try { req = indexedDB.open('toolbox-product-search', 1); } catch (e) { bad(e); return; }
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames.contains('data')) d.createObjectStore('data');
          if (!d.objectStoreNames.contains('thumbs')) d.createObjectStore('thumbs');
        };
        req.onsuccess = function () { ok(req.result); };
        req.onerror = function () { bad(req.error || new Error('No storage')); };
        req.onblocked = function () { bad(new Error('Storage busy')); };
      });
      dbp.catch(function () { /* each caller copes */ });
    }
    return dbp;
  }
  function tx(storeName, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (ok, bad) {
        var t = d.transaction(storeName, mode), out;
        var req = fn(t.objectStore(storeName));
        if (req) req.onsuccess = function () { out = req.result; };
        t.oncomplete = function () { ok(out); };
        t.onerror = t.onabort = function () { bad(t.error || new Error('Storage failed')); };
      });
    });
  }
  var data = {
    get: function (k) { return tx('data', 'readonly', function (s) { return s.get(k); }).catch(function () { return null; }); },
    put: function (k, v) { return tx('data', 'readwrite', function (s) { return s.put(v, k); }).then(function () { return true; }, function () { return false; }); }
  };

  // clear away photos an earlier version of this page saved, and the old photo settings
  tx('thumbs', 'readwrite', function (s) { return s.clear(); }).catch(function () { /* nothing there */ });
  try { localStorage.removeItem('ps-photo-mode-v1'); localStorage.removeItem('ps-timings'); } catch (e) { /* private mode */ }

  /* ---------- one photo ---------- */

  var failed = new Set();         // skus whose photo didn't load this visit

  /* Show the photo for sku in img. -> Promise<{source: 'web'|'failed'}> */
  function load(sku, img) {
    if (failed.has(sku)) return Promise.resolve({ source: 'failed' });
    return new Promise(function (ok) {
      var timer = setTimeout(function () { done(false); }, TIMEOUT);
      function done(good) {
        clearTimeout(timer);
        img.onload = img.onerror = null;
        if (!good) failed.add(sku);
        ok({ source: good ? 'web' : 'failed' });
      }
      img.onload = function () { done(true); };
      img.onerror = function () { done(false); };
      img.referrerPolicy = 'no-referrer';
      img.src = photoUrl(sku);
    });
  }

  root.ProductPhotos = { load: load, photoUrl: photoUrl, data: data };
})(this);
