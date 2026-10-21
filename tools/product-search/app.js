/* Product Search page: loads the list (from this phone first, then checks the site for a newer one), searches as
 * you type, shows results a screenful at a time and each result's photo as it scrolls into view. Tapping a result
 * opens it to show its description (descriptions/<CODE>.json, saved by the GitHub check, loaded only when tapped). */
(function () {
  'use strict';

  var PS = window.ProductSearch, Photos = window.ProductPhotos;
  var LIST_URL = 'product-search/data/products.json';
  var WEB_URL = 'product-search/data/web-names.json';
  var DESC_URL = 'product-search/descriptions/';
  var DESC_WORDS_URL = 'product-search/data/desc-words.json';   // the words descriptions are searched by, loaded after the list
  var PAGE = 24;
  var FLAGS = [[16, 'Age restricted', 'age']];     // the only label shown (hazardous, aerosol, non-trolleyable and sharp or liquid were removed, 21 Oct)

  var $ = function (id) { return document.getElementById(id); };
  var q = $('q'), form = $('form'), statusEl = $('status'), noteEl = $('note'), results = $('results'), more = $('more');
  var welcome = $('welcome'), stripMs = $('stripMs'), toastEl = $('toast');

  var list = null, web = null, dwords = null, searcher = null, shown = null, shownCount = 0, listInfo = '';
  var settings = { nophotos: get('ps-nophotos') === '1' };

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(x) { return Number(x).toLocaleString('en-GB'); }
  // a quick fingerprint of a file's text, to tell whether the saved copy is the latest
  function print(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ':' + text.length;
  }

  /* ---------- the product list ---------- */

  // quiet: only the description words changed, so don't redo a search someone is already reading
  function useList(newList, newWeb, where, quiet) {
    list = newList; web = newWeb;
    var names = (web && web.products) || {};
    var items = list.items.map(function (r) {
      var w = names[r[0]] && names[r[0]].name;
      var p = names[r[0]] || {};
      return { sku: r[0], name: r[1], flags: (r[2] || 0) | (p.a ? 16 : 0), web: w || '', desc: p.d, dw: (dwords && dwords[r[0]]) || '' };
    });
    searcher = PS.build(items);
    listInfo = n(items.length) + ' products ready' + (where === 'saved' ? ', saved on this phone' : '');
    q.placeholder = 'Search by code or name';
    var have = new Set();
    Object.keys(names).forEach(function (k) { if (names[k].p) have.add(k); });
    Photos.stored = have;
    $('welcomeTitle').textContent = 'Search ' + n(items.length) + ' nailed items';
    if (quiet && q.value.trim() && (window.scrollY > 80 || results.querySelector('.sx-card.open'))) return;
    run();
  }

  function fetchText(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    });
  }

  function start() {
    var saved = null;
    Promise.all([Photos.data.get('list'), Photos.data.get('web'), Photos.data.get('descwords')]).then(function (got) {
      saved = got;
      if (got[2] && got[2].words) dwords = got[2].words;
      if (got[0] && got[0].list) useList(got[0].list, got[1] && got[1].web, 'saved');
    }).catch(function () { /* nothing saved yet */ }).then(function () {
      // then check the site for anything newer
      return Promise.all([
        fetchText(LIST_URL),
        fetchText(WEB_URL).catch(function () { return null; })
      ]);
    }).then(function (texts) {
      var lp = print(texts[0]), wp = texts[1] ? print(texts[1]) : null;
      var sameList = saved && saved[0] && saved[0].print === lp;
      var sameWeb = saved && ((saved[1] && saved[1].print) || null) === wp;
      if (sameList && sameWeb && searcher) return;
      var newList = JSON.parse(texts[0]), newWeb = null;
      try { newWeb = texts[1] ? JSON.parse(texts[1]) : null; } catch (e) { newWeb = null; }
      useList(newList, newWeb, 'new');
      Photos.data.put('list', { print: lp, list: newList });
      Photos.data.put('web', { print: wp, web: newWeb });
    }).catch(function () {
      if (!searcher) {
        statusEl.textContent = "Couldn't load the product list. Check your signal and reload the page.";
        q.placeholder = 'Product list not loaded';
      }
    }).then(function () {
      // then, in the background, the description words (bigger, and only for the lower tier of results)
      return fetchText(DESC_WORDS_URL).then(function (text) {
        var dp = print(text);
        if (saved && saved[2] && saved[2].print === dp) return;
        var got = JSON.parse(text).products || {};
        dwords = got;
        if (list) useList(list, web, 'new', true);
        Photos.data.put('descwords', { print: dp, words: got });
      });
    }).catch(function () { /* descriptions can't be searched this time; names still work */ });
  }

  /* ---------- searching ---------- */

  var pending = false;
  function run() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; search(); });
  }

  function search() {
    var text = q.value;
    try { history.replaceState(null, '', text.trim() ? '#q=' + encodeURIComponent(text.trim()) : location.pathname + location.search); } catch (e) { /* file:// */ }
    if (!searcher) { statusEl.textContent = 'Loading the product list...'; return; }
    if (!text.trim()) {
      shown = null; results.innerHTML = ''; more.hidden = true; noteEl.hidden = true;
      welcome.hidden = false;
      statusEl.textContent = listInfo;
      return;
    }
    welcome.hidden = true;
    var t0 = performance.now();
    var res = searcher.find(text, 500);
    var ms = performance.now() - t0;
    stripMs.textContent = ms < 1 ? ms.toFixed(1) + ' milliseconds' : Math.round(ms) + ' milliseconds';
    shown = res;
    shown.words = PS.words(text).filter(Boolean);
    shown.code = PS.asCode(text);
    statusEl.textContent = res.total ? n(res.total) + (res.total === 1 ? ' result' : ' results') + (res.total > res.list.length ? ' (showing the best ' + n(res.list.length) + ')' : '')
      : 'No products match "' + text.trim() + '"';
    noteEl.hidden = !res.note;
    noteEl.textContent = res.note || '';
    results.innerHTML = '';
    shownCount = 0;
    window.scrollTo(0, 0);
    addPage();
  }

  function addPage() {
    if (!shown) return;
    var slice = shown.list.slice(shownCount, shownCount + PAGE);
    var html = slice.map(function (r) { return card(r); }).join('');
    results.insertAdjacentHTML('beforeend', html);
    var cards = results.querySelectorAll('.sx-ph:not([data-watched])');
    for (var i = 0; i < cards.length; i++) { cards[i].setAttribute('data-watched', '1'); watchPhoto(cards[i]); }
    shownCount += slice.length;
    var left = shown.list.length - shownCount;
    more.hidden = left <= 0;
    more.textContent = left > 0 ? 'Loading more...' : '';
    if (left <= 0 && shown.total > shown.list.length) {
      more.hidden = false;
      more.textContent = 'That\'s the best ' + n(shown.list.length) + '. Add another word to narrow it down.';
    }
  }

  // the words in a name that match what was typed, in bold
  function marked(name, words) {
    if (!words.length) return esc(name);
    return String(name).split(/([A-Za-z0-9]+)/).map(function (part, i) {
      if (i % 2 === 0) return esc(part);
      var ws = PS.words(part).filter(Boolean);
      var hit = ws.some(function (w) { return words.some(function (t) { return w.lastIndexOf(t, 0) === 0 || (t.length > 3 && t.lastIndexOf(w, 0) === 0); }); });
      return hit ? '<mark>' + esc(part) + '</mark>' : esc(part);
    }).join('');
  }
  function markedCode(sku, code, how) {
    if (how !== 'sku' || !code) return esc(sku);
    var at = sku.indexOf(code);
    return at < 0 ? esc(sku) : esc(sku.slice(0, at)) + '<mark>' + esc(code) + '</mark>' + esc(sku.slice(at + code.length));
  }

  function card(r) {
    var it = r.item, words = shown.words;
    var title = it.web || it.name;
    var flags = FLAGS.filter(function (f) { return it.flags & f[0]; }).map(function (f) {
      return '<span class="sx-flag sx-' + f[2] + '">' + f[1] + '</span>';
    }).join('');
    return '<li class="sx-card" data-sku="' + esc(it.sku) + '">' +
      '<div class="sx-ph" data-sku="' + esc(it.sku) + '"><img alt="" decoding="async"><span class="sx-ph-code">' + esc(it.sku) + '</span></div>' +
      '<div class="sx-body">' +
        '<h3 class="sx-name">' + marked(title, words) + '</h3>' +
        (it.web && it.web.toLowerCase() !== it.name.toLowerCase() ? '<p class="sx-alt">Alternative name: ' + marked(it.name, words) + '</p>' : '') +
        (flags ? '<div class="sx-flags">' + flags + '</div>' : '') +
        (r.how === 'desc' ? '<p class="sx-why">Found in the description</p>' : '') +
        '<div class="sx-row">' +
          '<button type="button" class="sx-code" data-copy="' + esc(it.sku) + '" aria-label="Copy product code ' + esc(it.sku) + '"><span>Product code</span> <b>' + markedCode(it.sku, shown.code, r.how) + '</b></button>' +
          '<a class="sx-open" href="https://www.screwfix.com/p/product/' + esc(it.sku.toLowerCase()) + '" target="_blank" rel="noopener">View on screwfix.com</a>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="sx-toggle" aria-expanded="false"><span>Description</span></button>' +
      '<div class="sx-desc" hidden></div></li>';
  }

  /* ---------- photos, as they come into view ---------- */

  var photoWatch = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      photoWatch.unobserve(e.target);
      showPhoto(e.target);
    });
  }, { rootMargin: '250px 0px' }) : null;
  function watchPhoto(el) { if (photoWatch) photoWatch.observe(el); else showPhoto(el); }

  function showPhoto(box) {
    if (settings.nophotos) { box.classList.add('off'); return; }
    var sku = box.getAttribute('data-sku'), img = box.querySelector('img');
    box.classList.add('loading');
    Photos.load(sku, img).then(function (r) {
      box.classList.remove('loading');
      box.classList.add(r.source === 'failed' ? 'none' : 'ok');
    });
  }

  // more results as you scroll near the bottom
  var moreWatch = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    if (entries.some(function (e) { return e.isIntersecting; })) addPage();
  }, { rootMargin: '600px 0px' }) : null;
  if (moreWatch) moreWatch.observe(more); else more.addEventListener('click', addPage);

  /* ---------- settings ---------- */

  $('nophotos').checked = settings.nophotos;
  $('nophotos').addEventListener('change', function () {
    settings.nophotos = this.checked; set('ps-nophotos', this.checked ? '1' : '0');
    if (!this.checked) Array.prototype.forEach.call(results.querySelectorAll('.sx-ph.off'), function (b) { b.classList.remove('off'); showPhoto(b); });
  });

  /* ---------- small things ---------- */

  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 1800);
  }
  function copy(text) {
    var done = function () { toast('Copied ' + text); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast(text); }
      t.remove();
    }
  }
  results.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (b) { copy(b.getAttribute('data-copy')); return; }
    if (e.target.closest('a')) return;                       // "View on screwfix.com"
    var li = e.target.closest('.sx-card');
    if (!li || (e.target.closest('.sx-desc') && !e.target.closest('.sx-toggle'))) return;   // reading or selecting the description
    toggleDesc(li);
  });

  /* ---------- descriptions, when a result is tapped ---------- */

  var descs = new Map();      // code -> Promise<{t, b} | null>, for this visit
  function getDesc(sku) {
    if (!descs.has(sku)) {
      descs.set(sku, fetch(DESC_URL + encodeURIComponent(sku) + '.json').then(function (res) {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).catch(function (e) { descs.delete(sku); throw e; }));
    }
    return descs.get(sku);
  }
  function itemFor(sku) {
    var hit = shown && shown.list.filter(function (r) { return r.item.sku === sku; })[0];
    return hit ? hit.item : null;
  }
  function toggleDesc(li) {
    var box = li.querySelector('.sx-desc'), btn = li.querySelector('.sx-toggle');
    var open = box.hidden;
    box.hidden = !open;
    li.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open || box.getAttribute('data-done')) return;
    var sku = li.getAttribute('data-sku'), it = itemFor(sku);
    if (it && it.desc === 0) { box.innerHTML = '<p class="sx-desc-none">Screwfix doesn\'t have a description for this one.</p>'; box.setAttribute('data-done', '1'); return; }
    if (!it || it.desc !== 1) { box.innerHTML = '<p class="sx-desc-none">No description saved for this one yet.</p>'; return; }
    box.innerHTML = '<p class="sx-desc-none">Loading the description...</p>';
    getDesc(sku).then(function (d) {
      if (!d || (!d.t && !(d.b && d.b.length))) { box.innerHTML = '<p class="sx-desc-none">No description saved for this one yet.</p>'; return; }
      box.innerHTML = (d.t ? d.t.split(/\n\n+/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') : '') +
        (d.b && d.b.length ? '<ul>' + d.b.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '');
      box.setAttribute('data-done', '1');
    }, function () {
      box.innerHTML = '<p class="sx-desc-none">Couldn\'t load the description. Check your signal, then close and tap again.</p>';
    });
  }
  q.addEventListener('input', run);
  form.addEventListener('submit', function (e) { e.preventDefault(); q.blur(); run(); });

  // a search in the address (#q=...) comes back after a reload
  var m = /#q=([^&]*)/.exec(location.hash);
  if (m) { try { q.value = decodeURIComponent(m[1]); } catch (e) { /* bad address */ } }

  start();
})();
