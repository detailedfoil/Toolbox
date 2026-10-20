/* Product Search: storage on this phone and the product photos.
 *
 * Storage (IndexedDB "toolbox-product-search"): the product list, so search works the moment the page opens
 * (even with no signal), and every thumbnail seen, so photos still show when Screwfix's image server is down
 * and repeat views are instant.
 *
 * Photos: media.screwfix.com/is/image/ae235/<CODE>_P at 120 x 120, the same server the A4 Posters tool uses.
 * Order for each photo: the copy saved on this phone, then Screwfix's server. To save a copy the page has to read
 * the picture's bytes, which the browser only allows if the image server says so. So the first photo is tried
 * that way (fetch); if the server won't allow it, photos are shown as plain images from then on and a copy is
 * saved through the free image relay wsrv.nl (the posters tool's fallback too), quietly, two at a time.
 */
(function (root) {
  'use strict';

  var MEDIA = 'https://media.screwfix.com/is/image/ae235/';
  var SIZE = 120;
  var MODE_KEY = 'ps-photo-mode-v1';        // 'fetch' (server allows reading) or 'img' (it doesn't), with a date
  var TIMEOUT = 15000;

  function photoUrl(sku) { return MEDIA + encodeURIComponent(sku) + '_P?wid=' + SIZE + '&hei=' + SIZE; }
  function relayUrl(sku) { return 'https://wsrv.nl/?url=' + encodeURIComponent(photoUrl(sku)) + '&output=jpg&q=85'; }
  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }

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
  function storeOf(name) {
    return {
      get: function (k) { return tx(name, 'readonly', function (s) { return s.get(k); }).catch(function () { return null; }); },
      put: function (k, v) { return tx(name, 'readwrite', function (s) { return s.put(v, k); }).then(function () { return true; }, function () { return false; }); },
      count: function () { return tx(name, 'readonly', function (s) { return s.count(); }).catch(function () { return 0; }); },
      clear: function () { return tx(name, 'readwrite', function (s) { return s.clear(); }).catch(function () { return null; }); }
    };
  }
  var data = storeOf('data'), thumbs = storeOf('thumbs');

  // ask the phone not to tidy our storage away when space is short (quietly; fine if it says no)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) { /* old browser */ }

  /* ---------- reading pictures ---------- */

  function isPicture(bytes) {
    if (!bytes || bytes.length < 12) return false;
    return (bytes[0] === 0xFF && bytes[1] === 0xD8) ||                                    // JPEG
      (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) || // PNG
      (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) ||                      // GIF
      (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45);   // WEBP
  }
  function fetchPicture(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT);
    return fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        return res.arrayBuffer().then(function (buf) {
          var bytes = new Uint8Array(buf);
          if (!res.ok || !isPicture(bytes)) { var e = new Error('Not a picture (' + res.status + ')'); e.answered = true; throw e; }
          return new Blob([bytes], { type: res.headers.get('content-type') || 'image/jpeg' });
        });
      })
      .finally(function () { clearTimeout(timer); });
  }
  // a plain picture on the page (no reading of its bytes needed) -> resolves when it shows
  function showPlain(img, url) {
    return new Promise(function (ok, bad) {
      var timer = setTimeout(function () { cleanup(); bad(new Error('Took too long')); }, TIMEOUT);
      function cleanup() { clearTimeout(timer); img.onload = img.onerror = null; }
      img.onload = function () { cleanup(); ok(); };
      img.onerror = function () { cleanup(); bad(new Error("Didn't load")); };
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    });
  }

  function savedMode() {
    try {
      var m = JSON.parse(localStorage.getItem(MODE_KEY) || 'null');
      if (m && Date.now() - m.at < 7 * 864e5) return m.mode;          // ask again after a week
    } catch (e) { /* private mode */ }
    return null;
  }
  function setMode(mode) { try { localStorage.setItem(MODE_KEY, JSON.stringify({ mode: mode, at: Date.now() })); } catch (e) { /* private mode */ } }

  /* ---------- saving copies through the relay, two at a time ---------- */

  var queue = [], busy = 0, queued = new Set();
  function saveLater(sku) {
    if (queued.has(sku)) return;
    queued.add(sku);
    queue.push(sku);
    pump();
  }
  function pump() {
    while (busy < 2 && queue.length) saveOne(queue.shift());
  }
  function saveOne(sku) {
    busy++;
    fetchPicture(relayUrl(sku))
      .then(function (blob) { return thumbs.put(sku, { blob: blob, at: Date.now(), via: 'relay' }); })
      .catch(function () { /* the relay is down: it'll be tried next time the photo is shown */ })
      .then(function () { queued.delete(sku); busy--; Photos.onSaved(); pump(); });
  }

  /* ---------- one photo ---------- */

  var urls = new Map();           // sku -> object URL made this visit (instant when scrolled back)
  var failed = new Set();         // skus whose photo couldn't be shown this visit

  /* Show the photo for sku in img. -> Promise<{source: 'memory'|'saved'|'web'|'failed', ms}> */
  function load(sku, img) {
    var t0 = now();
    function done(source) { return { source: source, ms: Math.round(now() - t0) }; }
    if (urls.has(sku)) { img.src = urls.get(sku); return Promise.resolve(done('memory')); }
    return thumbs.get(sku).then(function (rec) {
      if (rec && rec.blob) {
        var u = URL.createObjectURL(rec.blob);
        urls.set(sku, u);
        return showPlain(img, u).then(function () { return done('saved'); });
      }
      if (Photos.stored && Photos.stored.has(sku)) {
        // collected overnight and kept with the Toolbox: no need to ask Screwfix
        var kept = fetchPicture('product-search/photos/' + encodeURIComponent(sku) + '.jpg').then(function (blob) {
          thumbs.put(sku, { blob: blob, at: Date.now(), via: 'toolbox' }).then(function () { Photos.onSaved(); });
          var u = URL.createObjectURL(blob);
          urls.set(sku, u);
          return showPlain(img, u).then(function () { return done('toolbox'); });
        });
        return kept.catch(function () { return fromScrewfix(); });
      }
      return fromScrewfix();
    }).catch(function () {
      failed.add(sku);
      return done('failed');
    });

    function fromScrewfix() {
      if (failed.has(sku)) throw new Error('Failed earlier');
      var mode = savedMode();
      if (mode === 'img') {
        return showPlain(img, photoUrl(sku)).then(function () { saveLater(sku); return done('web'); });
      }
      // read it ourselves (and keep a copy); if the server won't let us, show it plainly instead
      return fetchPicture(photoUrl(sku)).then(function (blob) {
        setMode('fetch');
        thumbs.put(sku, { blob: blob, at: Date.now(), via: 'direct' }).then(function () { Photos.onSaved(); });
        var u = URL.createObjectURL(blob);
        urls.set(sku, u);
        return showPlain(img, u).then(function () { return done('web'); });
      }, function (e) {
        if (e && e.answered) throw e;                                  // the server answered: no photo for this one
        return showPlain(img, photoUrl(sku)).then(function () {
          setMode('img');                                              // shows fine, but can't be read: use the relay to save
          saveLater(sku);
          return done('web');
        });
      });
    }
  }

  var Photos = {
    load: load, photoUrl: photoUrl, data: data,
    count: function () { return thumbs.count(); },
    clear: function () {
      urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } });
      urls.clear(); failed.clear();
      return thumbs.clear();
    },
    mode: savedMode,
    stored: null,                     // codes whose photo is kept with the Toolbox (set by the page)
    onSaved: function () { /* set by the page */ }
  };
  root.ProductPhotos = Photos;
})(this);
