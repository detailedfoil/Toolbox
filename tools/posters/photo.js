/* Product photos for the A4 poster maker: fetch Screwfix's own photo, or take one pasted / uploaded,
 * trim the white space around the product and turn it into a JPEG ready for the PDF.
 *
 * Screwfix photos live at media.screwfix.com/is/image/ae235/<CODE>_P (the main shot; _A1, _A2... are the
 * other gallery shots). Showing one on the page needs nothing special, but putting it in a PDF means reading
 * its bytes, which the browser only allows if the image server says so. So, like the price lookup, this
 * tries the image directly and then a few free public relays, remembering whichever worked last.
 */
(function (root) {
  'use strict';

  var MEDIA = 'https://media.screwfix.com/is/image/ae235/';
  var ROUTE_KEY = 'ps-photo-route-v1';
  var TIMEOUT = 12000;
  var FETCH_PX = [1800, 1000];        // try a big photo first, then a smaller one if the server says no
  var WORK_MAX = 2400;                // longest side while trimming
  var OUT_MAX = 2000;                 // longest side in the PDF (about 270 dpi at full poster width)
  var QUALITY = 0.9;

  function mediaUrl(id, px) { return MEDIA + encodeURIComponent(id) + '?wid=' + px + '&hei=' + px; }
  function thumbUrl(id) { return mediaUrl(id, 240); }

  var ROUTES = [
    { id: 'direct',     build: function (u) { return u; } },
    { id: 'wsrv',       build: function (u) { return 'https://wsrv.nl/?url=' + encodeURIComponent(u) + '&output=jpg&q=92'; } },
    { id: 'codetabs',   build: function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); } },
    { id: 'allorigins', build: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); } },
    { id: 'cors.lol',   build: function (u) { return 'https://api.cors.lol/?url=' + encodeURIComponent(u); } },
    { id: 'corsproxy',  build: function (u) { return 'https://corsproxy.io/?url=' + encodeURIComponent(u); } }
  ];

  function routeOrder() {
    var saved = null;
    try { saved = localStorage.getItem(ROUTE_KEY); } catch (e) { saved = null; }
    var list = ROUTES.slice();
    var i = list.findIndex(function (r) { return r.id === saved; });
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
    return list;
  }
  function remember(id) { try { localStorage.setItem(ROUTE_KEY, id); } catch (e) { /* private mode */ } }

  function err(message, kind) { var e = new Error(message); e.kind = kind; return e; }

  function sniffImage(bytes) {
    if (!bytes || bytes.length < 12) return null;
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return null;
  }

  /* -> Promise<Blob> of an image, or rejects. 'network' means the route itself didn't answer (blocked, CORS, offline). */
  function fetchImage(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (res) {
        return res.arrayBuffer().then(function (buf) {
          var bytes = new Uint8Array(buf), type = sniffImage(bytes);
          if (!res.ok || !type) throw err('Not a picture (' + res.status + ')', res.status === 404 ? 'missing' : 'refused');
          return new Blob([bytes], { type: type });
        });
      }, function () { throw err('No answer', 'network'); })
      .finally(function () { clearTimeout(timer); });
  }

  /* Image addresses to try in order (e.g. big, then smaller) -> Promise<{blob, via}>.
     Each route gets the next address only if it answered but wouldn't give the first one. */
  function fetchFirst(srcs) {
    var order = routeOrder(), i = 0, missing = 0;
    function viaRoute(route, k) {
      return fetchImage(route.build(srcs[k])).then(function (blob) {
        remember(route.id);
        return { blob: blob, via: route.id };
      }, function (e) {
        if (e.kind === 'missing') missing++;
        if (e.kind !== 'network' && k + 1 < srcs.length) return viaRoute(route, k + 1);
        throw e;
      });
    }
    function next() {
      if (i >= order.length) return Promise.reject(err(missing ? 'Screwfix has no photo there' : "Couldn't reach the photo", missing ? 'missing' : 'blocked'));
      return viaRoute(order[i++], 0).catch(next);
    }
    return next();
  }

  function fetchUrl(src) { return fetchFirst([src]); }

  /* A Screwfix photo id (e.g. 872RE_P) -> Promise<{blob, via}>, big if the server allows it */
  function fetchScrewfix(id) {
    return fetchFirst(FETCH_PX.map(function (px) { return mediaUrl(id, px); }));
  }

  /* ---------- decode, trim, encode ---------- */

  function decode(blob) {
    function viaImg() {
      return new Promise(function (ok, bad) {
        var url = URL.createObjectURL(blob), im = new Image();
        im.onload = function () { ok(im); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); };
        im.onerror = function () { URL.revokeObjectURL(url); bad(err("That file isn't a picture this browser can open", 'decode')); };
        im.src = url;
      });
    }
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob).catch(viaImg);
    return viaImg();
  }

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* Box around everything that isn't (nearly) white, with a little breathing room. */
  function trimBox(ctx, w, h) {
    var d = ctx.getImageData(0, 0, w, h).data, T = 238;
    var rows = new Uint32Array(h), cols = new Uint32Array(w);
    for (var y = 0, i = 0; y < h; y++) {
      for (var x = 0; x < w; x++, i += 4) {
        if (d[i] < T || d[i + 1] < T || d[i + 2] < T) { rows[y]++; cols[x]++; }
      }
    }
    var minR = Math.max(1, Math.round(w * 0.002)), minC = Math.max(1, Math.round(h * 0.002));
    var top = 0, bottom = h - 1, left = 0, right = w - 1;
    while (top < h && rows[top] < minR) top++;
    while (bottom > top && rows[bottom] < minR) bottom--;
    while (left < w && cols[left] < minC) left++;
    while (right > left && cols[right] < minC) right--;
    if (top >= h || left >= w) return { x: 0, y: 0, w: w, h: h, trimmed: false };
    var pad = Math.round(Math.max(right - left, bottom - top) * 0.01);
    left = Math.max(0, left - pad); top = Math.max(0, top - pad);
    right = Math.min(w - 1, right + pad); bottom = Math.min(h - 1, bottom + pad);
    var box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    box.trimmed = box.w < w || box.h < h;
    return box;
  }

  /* Push the almost-white background to pure white so the photo melts into the paper instead of
     showing a faint grey box. Only near-white pixels change; colours and darker greys are left alone. */
  function whiten(ctx, w, h) {
    var img = ctx.getImageData(0, 0, w, h), d = img.data, LO = 232, HI = 250, span = HI - LO;
    for (var i = 0; i < d.length; i += 4) {
      var mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if (mn <= LO) continue;
      var t = mn >= HI ? 1 : (mn - LO) / span;
      d[i] += (255 - d[i]) * t; d[i + 1] += (255 - d[i + 1]) * t; d[i + 2] += (255 - d[i + 2]) * t;
    }
    ctx.putImageData(img, 0, 0);
  }

  function toJpeg(c) {
    return new Promise(function (ok, bad) {
      if (!c.toBlob) { bad(err("This browser can't make the photo", 'encode')); return; }
      c.toBlob(function (b) { if (b) ok(b); else bad(err("This browser can't make the photo", 'encode')); }, 'image/jpeg', QUALITY);
    });
  }

  /* Any picture -> Promise<{blob (JPEG), bytes, w, h}>: on white, trimmed, at most OUT_MAX px */
  function prepare(blob) {
    return decode(blob).then(function (src) {
      var w = src.width, h = src.height;
      if (!w || !h) throw err("That picture looks empty", 'decode');
      var k = Math.min(1, WORK_MAX / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
      var work = canvas(cw, ch), wx = work.getContext('2d');
      wx.fillStyle = '#fff';
      wx.fillRect(0, 0, cw, ch);
      wx.imageSmoothingQuality = 'high';
      wx.drawImage(src, 0, 0, cw, ch);
      if (src.close) src.close();
      var box = trimBox(wx, cw, ch);
      var k2 = Math.min(1, OUT_MAX / Math.max(box.w, box.h));
      var ow = Math.max(1, Math.round(box.w * k2)), oh = Math.max(1, Math.round(box.h * k2));
      var out = canvas(ow, oh), ox = out.getContext('2d');
      ox.fillStyle = '#fff';
      ox.fillRect(0, 0, ow, oh);
      ox.imageSmoothingQuality = 'high';
      ox.drawImage(work, box.x, box.y, box.w, box.h, 0, 0, ow, oh);
      work.width = work.height = 0;
      whiten(ox, ow, oh);
      return toJpeg(out).then(function (jpeg) {
        out.width = out.height = 0;
        return jpeg.arrayBuffer().then(function (buf) {
          return { blob: jpeg, bytes: new Uint8Array(buf), w: ow, h: oh };
        });
      });
    });
  }

  /* ---------- clipboard ---------- */

  function looksLikeUrl(s) { return /^https?:\/\/\S+$/i.test(String(s || '').trim()); }

  /* The Paste button: -> Promise<{blob} | {url}>. Safari shows its own small "Paste" bubble first. */
  function readClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      if (navigator.clipboard && navigator.clipboard.readText) {
        return navigator.clipboard.readText().then(function (t) {
          if (looksLikeUrl(t)) return { url: t.trim() };
          throw err('No picture on the clipboard', 'empty');
        }, function () { throw err("This browser won't let the page read the clipboard", 'denied'); });
      }
      return Promise.reject(err("This browser won't let the page read the clipboard", 'unsupported'));
    }
    return navigator.clipboard.read().then(function (items) {
      for (var i = 0; i < items.length; i++) {
        var types = items[i].types || [];
        for (var j = 0; j < types.length; j++) {
          if (/^image\//.test(types[j])) return items[i].getType(types[j]).then(function (b) { return { blob: b }; });
        }
      }
      for (i = 0; i < items.length; i++) {
        if ((items[i].types || []).indexOf('text/plain') >= 0) {
          return items[i].getType('text/plain').then(function (b) { return b.text(); }).then(function (t) {
            if (looksLikeUrl(t)) return { url: t.trim() };
            throw err('No picture on the clipboard', 'empty');
          });
        }
      }
      throw err('No picture on the clipboard', 'empty');
    }, function (e) {
      throw err(e && e.name === 'NotAllowedError' ? 'Paste was blocked' : "This browser won't let the page read the clipboard", 'denied');
    });
  }

  /* A paste event (Ctrl+V / long-press Paste) -> {blob} | {url} | null */
  function fromPasteEvent(e) {
    var cd = e.clipboardData;
    if (!cd) return null;
    var items = cd.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
        var f = items[i].getAsFile();
        if (f) return { blob: f };
      }
    }
    var files = cd.files || [];
    for (i = 0; i < files.length; i++) if (/^image\//.test(files[i].type)) return { blob: files[i] };
    var text = cd.getData && cd.getData('text/plain');
    if (looksLikeUrl(text)) return { url: text.trim() };
    var html = cd.getData && cd.getData('text/html');
    var m = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && /^https?:/i.test(m[1])) return { url: m[1].replace(/&amp;/g, '&') };
    return null;
  }

  /* A Screwfix image address -> its photo id (872RE_P), so it can be fetched at full size */
  function screwfixId(url) {
    var m = String(url || '').match(/media\.screwfix\.com\/is\/image\/ae235\/([A-Za-z0-9]+_[A-Za-z0-9]+)/i);
    return m ? m[1] : null;
  }

  /* ---------- storage: prepared photos kept on this device (IndexedDB), so a reload doesn't fetch again ---------- */

  var dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise(function (ok, bad) {
        if (!root.indexedDB) { bad(err('No storage', 'storage')); return; }
        var req = indexedDB.open('toolbox-posters', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('photos'); };
        req.onsuccess = function () { ok(req.result); };
        req.onerror = function () { bad(req.error || err('No storage', 'storage')); };
        req.onblocked = function () { bad(err('Storage busy', 'storage')); };
      });
      dbp.catch(function () { /* handled by callers */ });
    }
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (ok, bad) {
        var t = d.transaction('photos', mode), store = t.objectStore('photos'), out;
        var req = fn(store);
        if (req) req.onsuccess = function () { out = req.result; };
        t.oncomplete = function () { ok(out); };
        t.onerror = t.onabort = function () { bad(t.error || err('Storage failed', 'storage')); };
      });
    });
  }
  var store = {
    get: function (key) { return tx('readonly', function (s) { return s.get(key); }).catch(function () { return null; }); },
    put: function (key, value) { return tx('readwrite', function (s) { return s.put(value, key); }).catch(function () { return null; }); },
    del: function (key) { return tx('readwrite', function (s) { return s.delete(key); }).catch(function () { return null; }); },
    keys: function () { return tx('readonly', function (s) { return s.getAllKeys ? s.getAllKeys() : null; }).catch(function () { return []; }); }
  };

  root.PosterPhoto = {
    mediaUrl: mediaUrl, thumbUrl: thumbUrl, fetchScrewfix: fetchScrewfix, fetchUrl: fetchUrl,
    prepare: prepare, readClipboard: readClipboard, fromPasteEvent: fromPasteEvent, screwfixId: screwfixId,
    store: store, trimBox: trimBox
  };
})(this);
