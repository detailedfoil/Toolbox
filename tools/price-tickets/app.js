/* Price Tickets tool: rows of code / price / name, live Screwfix lookup, ticket preview and PDF downloads. */
(function () {
  'use strict';

  var E = window.TicketEngine, L = window.ScrewfixLookup;
  var ROWS_KEY = 'pt-rows-v1', HIST_KEY = 'pt-history-v1';
  var TICKET_W = 340.15625;
  var LOOKUP_LIMIT = 2;
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  // iPhone / iPad: the share sheet (Print, Save to Files) beats a download there
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  var $ = function (id) { return document.getElementById(id); };
  var listEl = $('list'), emptyEl = $('empty'), barEl = $('bar'), toolbarEl = $('toolbar'), countEl = $('count'), noteEl = $('note');
  var dlSheet = $('dlSheet'), dlChanged = $('dlChanged'), checkAll = $('checkAll');

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: keep going */ } }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function squash(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* ---------- state ---------- */

  var rows = load(ROWS_KEY, []).filter(function (r) { return r && r.code; }).map(function (r) {
    return {
      id: r.id || uid(), code: r.code, price: r.price || '', product: r.product || '',
      status: r.status === 'looking' ? 'manual' : (r.status || 'manual'), checkedAt: r.checkedAt || 0,
      editedPrice: !!r.editedPrice, editedProduct: !!r.editedProduct, unsure: !!r.unsure, token: 0
    };
  });
  var hist = load(HIST_KEY, {});
  var views = new Map();
  var engine = null;

  var saveTimer = 0;
  function persist(now) {
    clearTimeout(saveTimer);
    var write = function () {
      store(ROWS_KEY, rows.map(function (r) {
        return { id: r.id, code: r.code, price: r.price, product: r.product, status: r.status === 'looking' ? 'manual' : r.status,
                 checkedAt: r.checkedAt, editedPrice: r.editedPrice, editedProduct: r.editedProduct, unsure: r.unsure };
      }));
    };
    if (now) write(); else saveTimer = setTimeout(write, 250);
  }

  /* ---------- tidy values ---------- */

  function normCode(s) { return String(s || '').toUpperCase().replace(/O/g, '0').replace(/[^0-9A-Z]/g, ''); }

  // Screwfix codes are always 5 characters: 3 digits + 2 letters, 4 digits + 1 letter, or 5 digits
  var SKU_RE = /^(\d{3}[A-Z]{2}|\d{4}[A-Z]|\d{5})$/;
  function isSku(c) { return SKU_RE.test(c); }

  function normPrice(s) {
    var t = String(s || '').replace(/[£\s]/g, '');
    if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{0,2})?$/.test(t)) return null;
    var n = parseFloat(t.replace(/,/g, ''));
    return isFinite(n) ? '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
  }

  function cleanProduct(product, code) {
    return squash(product).replace(new RegExp('\\s*\\(' + escapeRe(code) + '\\)\\s*$', 'i'), '');
  }

  function ticketOf(r) { return { code: r.code, price: normPrice(r.price) || r.price, product: cleanProduct(r.product, r.code) }; }

  function problem(r) {
    if (!r.price) return 'Add the price';
    if (normPrice(r.price) === null) return 'Price should look like 12.99';
    if (!squash(r.product)) return 'Add the product name';
    if (!engine) return null;
    var e = engine.check(ticketOf(r));
    return e ? e.message : null;
  }

  function ready(r) { return !!engine && r.status !== 'looking' && !problem(r); }

  function lastTicket(r) { return hist[r.code] || null; }
  function changed(r) {
    var h = lastTicket(r), p = normPrice(r.price);
    return h && p && h.price !== p ? h : null;
  }

  var dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' });
  var timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
  function niceDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00Z');
    return iso === E.ukDate().iso ? 'today' : dayFmt.format(d);
  }
  function whenChecked(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return E.ukDate(d).iso === E.ukDate().iso ? timeFmt.format(d) : dayFmt.format(d);
  }

  function statusOf(r) {
    var s = r.status;
    var filled = !!(r.price && r.product);
    if (s === 'looking') return ['busy', 'Checking Screwfix…'];
    if (s === 'notfound') return ['bad', filled ? 'Not found on Screwfix now. Check the code' : 'Not found on Screwfix. Check the code, digits often get swapped'];
    if (s === 'blocked') return ['warn', filled ? "Couldn't reach Screwfix, so this is the last price you had" : "Couldn't reach Screwfix. Type the price and name"];
    if (s === 'partial' && !filled) return ['warn', 'Found it, but fill in the missing details'];
    var prob = problem(r);
    if (prob) return [r.price || r.product ? 'bad' : 'muted', prob];
    var ch = changed(r);
    if (ch) return ['warn', 'Price changed. Last ticket ' + ch.price + ' (' + niceDate(ch.date) + ')'];
    if (s === 'found' && r.unsure) return ['warn', 'Check this is the right product'];
    if (s === 'found' && (r.editedPrice || r.editedProduct)) return ['info', 'Edited by you'];
    var h = lastTicket(r);
    if (s === 'found') {
      var when = whenChecked(r.checkedAt), today = E.ukDate(new Date(r.checkedAt)).iso === E.ukDate().iso;
      if (h) return [today ? 'ok' : 'muted', 'Same as last ticket' + (today ? ', checked ' + when : '. Checked ' + when)];
      return today ? ['ok', 'Live price, checked ' + when] : ['muted', 'Checked ' + when + '. Tap ↻ for today’s price'];
    }
    return ['muted', h ? 'Same as last ticket' : 'Typed in'];
  }

  /* ---------- row views ---------- */

  var ICON = {
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>'
  };

  function makeRow(r) {
    var el = document.createElement('article');
    el.className = 'pt-row';
    var pid = 'p-' + r.id, nid = 'n-' + r.id;
    el.innerHTML =
      '<div class="pt-row-top">' +
        '<input class="pt-code" type="text" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="Product code">' +
        '<div class="pt-icons">' +
          '<a class="icon-btn sf" target="_blank" rel="noopener" title="Open on Screwfix" aria-label="Open on Screwfix">' + ICON.link + '</a>' +
          '<button class="icon-btn refresh" type="button" title="Check the price again" aria-label="Check the price again">' + ICON.refresh + '</button>' +
          '<button class="icon-btn remove" type="button" title="Remove" aria-label="Remove ticket">' + ICON.close + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="pt-chip" role="status"><span></span></div>' +
      '<div class="pt-main">' +
        '<div class="pt-fields">' +
          '<div class="pt-field"><label for="' + pid + '">Price</label><div class="pt-money"><input id="' + pid + '" class="pt-price" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"></div></div>' +
          '<div class="pt-field"><label for="' + nid + '">Product name</label><textarea id="' + nid + '" class="pt-product" rows="1" placeholder="As written on Screwfix"></textarea></div>' +
        '</div>' +
        '<div class="pt-preview"><div class="pt-stage"><div class="tk" aria-hidden="true">' +
          '<div class="tk-price"></div>' +
          '<div class="tk-body"><div class="tk-name"></div><div class="tk-code"></div></div>' +
          '<div class="tk-ref"></div>' +
        '</div></div></div>' +
      '</div>' +
      '<div class="pt-row-foot"><span class="pt-last"></span>' +
        '<button class="btn btn-sm dl" type="button">' + ICON.pdf + 'PDF</button></div>';

    var q = function (s) { return el.querySelector(s); };
    var v = {
      el: el, code: q('.pt-code'), chip: q('.pt-chip'), chipText: q('.pt-chip span'), sf: q('.sf'),
      refresh: q('.refresh'), remove: q('.remove'), price: q('.pt-price'), product: q('.pt-product'),
      dl: q('.dl'), last: q('.pt-last'), tkPrice: q('.tk-price'), tkName: q('.tk-name'), tkCode: q('.tk-code'), tkRef: q('.tk-ref')
    };
    views.set(r.id, v);

    v.code.addEventListener('keydown', function (e) { if (e.key === 'Enter') v.code.blur(); });
    v.code.addEventListener('change', function () {
      var c = normCode(v.code.value);
      if (c && c !== r.code && !isSku(c)) toast(v.code.value.trim() + " isn't a Screwfix code. Codes are 5 characters, like 843PG");
      if (!c || c === r.code || !isSku(c)) { v.code.value = r.code; return; }
      r.code = c; r.price = ''; r.product = ''; r.editedPrice = r.editedProduct = false; r.unsure = false;
      enqueue(r);
    });
    v.price.addEventListener('input', function () {
      r.price = v.price.value; r.editedPrice = true;
      if (r.status !== 'found' && r.status !== 'looking') r.status = 'manual';
      changedRow(r);
    });
    v.price.addEventListener('blur', function () {
      var n = normPrice(r.price);
      if (n) { r.price = n; v.price.value = n.slice(1); }
      changedRow(r);
    });
    v.product.addEventListener('input', function () {
      r.product = v.product.value; r.editedProduct = true;
      if (r.status !== 'found' && r.status !== 'looking') r.status = 'manual';
      autosize(v.product);
      changedRow(r);
    });
    v.refresh.addEventListener('click', function () { r.editedPrice = r.editedProduct = false; enqueue(r); });
    v.remove.addEventListener('click', function () { removeRow(r); });
    v.dl.addEventListener('click', function () {
      if (!ready(r)) return;
      deliver([{ name: r.code + '-ticket.pdf', tickets: [ticketOf(r)] }], [r], v.dl);
    });
    return el;
  }

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
  }

  function paint(r) {
    var v = views.get(r.id);
    if (!v) return;
    var active = document.activeElement;
    if (active !== v.code) v.code.value = r.code;
    if (active !== v.price) v.price.value = String(r.price || '').replace(/^£/, '');
    if (active !== v.product) { v.product.value = r.product; autosize(v.product); }
    v.price.classList.toggle('invalid', !!r.price && normPrice(r.price) === null);
    var st = statusOf(r);
    v.chip.className = 'pt-chip ' + st[0];
    v.chipText.textContent = st[1];
    v.chip.title = st[1];
    v.sf.href = L.productUrl(r.code);
    v.refresh.disabled = r.status === 'looking';
    v.refresh.classList.toggle('spin', r.status === 'looking');
    v.dl.disabled = !ready(r);
    v.el.classList.toggle('is-changed', !!changed(r));
    var h = lastTicket(r);
    v.last.textContent = h ? 'Last ticket ' + h.price + ', ' + niceDate(h.date) : '';
    paintPreview(r, v);
  }

  function paintPreview(r, v) {
    var price = normPrice(r.price);
    v.tkPrice.textContent = price || '£0.00';
    v.tkPrice.classList.toggle('ph', !price);
    var product = cleanProduct(r.product, r.code), lines = [product || 'Product name'];
    if (engine && product) {
      try { lines = engine.lines(product); } catch (e) { lines = [product]; }
    }
    v.tkName.textContent = '';
    lines.forEach(function (l) { var d = document.createElement('div'); d.textContent = l; v.tkName.appendChild(d); });
    v.tkName.classList.toggle('ph', !product);
    v.tkCode.textContent = 'Code: ' + r.code;
    v.tkRef.textContent = 'UK-' + r.code + '-90X75-' + E.ukDate().ref;
  }

  function changedRow(r) {
    paint(r);
    persist();
    refreshBar();
    warmSoon();
  }

  function fitPreviews() {
    var stage = listEl.querySelector('.pt-preview');
    if (!stage) return;
    var w = stage.clientWidth - 20;
    if (w > 0) listEl.style.setProperty('--s', Math.min(1, w / TICKET_W).toFixed(4));
  }
  if (window.ResizeObserver) new ResizeObserver(fitPreviews).observe(listEl);
  else window.addEventListener('resize', fitPreviews);

  /* ---------- adding / removing ---------- */

  function parseCodes(text) {
    // a pasted product link counts as its code (the last part of the address)
    text = String(text || '').replace(/https?:\/\/\S*screwfix\.com\/p\/(?:[^\s\/?#]+\/)*([a-z0-9]+)\/?(?:[?#]\S*)?(?=\s|$)/gi, ' $1 ');
    var codes = [], ignored = [];
    (text.toUpperCase().match(/[A-Z0-9]+/g) || []).forEach(function (raw) {
      if (!/\d/.test(raw)) return;                            // every code has a digit, so plain words are skipped quietly
      var c = normCode(raw);
      if (isSku(c)) codes.push(c); else ignored.push(raw);
    });
    return { codes: codes, ignored: ignored };
  }

  function addCodes(text) {
    var parsed = parseCodes(text), codes = parsed.codes, ignored = parsed.ignored, added = [], dupes = [];
    codes.forEach(function (c) {
      if (rows.some(function (r) { return r.code === c; }) || added.indexOf(c) >= 0) { dupes.push(c); return; }
      added.push(c);
      var r = { id: uid(), code: c, price: '', product: '', status: 'manual', checkedAt: 0, editedPrice: false, editedProduct: false, unsure: false, token: 0 };
      rows.push(r);
      listEl.appendChild(makeRow(r));
      enqueue(r);
    });
    fitPreviews();
    persist();
    refreshBar();
    var notes = [];
    if (dupes.length) notes.push(dupes.join(', ') + (dupes.length === 1 ? ' is' : ' are') + ' already in the list');
    if (ignored.length) notes.push('Ignored ' + ignored.join(', ') + ' (codes are 5 characters, like 843PG)');
    if (!codes.length && !ignored.length) toast('Type a product code, like 843PG');
    else if (notes.length) toast(notes.join('. '));
    if (added.length) {
      var first = views.get(rows[rows.length - added.length].id);
      if (first && added.length === 1) first.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return added.length;
  }

  function removeRow(r) {
    var i = rows.indexOf(r);
    if (i < 0) return;
    rows.splice(i, 1);
    r.token++;
    var v = views.get(r.id);
    if (v) v.el.remove();
    views.delete(r.id);
    persist(true);
    refreshBar();
    toast('Removed ' + r.code, 'Undo', function () {
      if (rows.indexOf(r) >= 0) return;
      i = Math.min(i, rows.length);
      rows.splice(i, 0, r);
      listEl.insertBefore(makeRow(r), listEl.children[i] || null);
      if (r.status === 'looking') r.status = 'manual';
      paint(r); fitPreviews(); persist(true); refreshBar();
    });
  }

  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('codes');
    if (addCodes(input.value)) input.value = '';
  });

  checkAll.addEventListener('click', function () {
    rows.forEach(function (r) { r.editedPrice = r.editedProduct = false; enqueue(r); });
  });

  $('clearAll').addEventListener('click', function () {
    var backup = rows.slice();
    rows.forEach(function (r) { r.token++; });
    rows = [];
    views.clear();
    listEl.textContent = '';
    persist(true);
    refreshBar();
    toast('Cleared ' + backup.length + (backup.length === 1 ? ' ticket' : ' tickets'), 'Undo', function () {
      rows = backup.concat(rows);
      listEl.textContent = '';
      views.clear();
      rows.forEach(function (r) { if (r.status === 'looking') r.status = 'manual'; listEl.appendChild(makeRow(r)); paint(r); });
      fitPreviews(); persist(true); refreshBar();
    });
  });

  /* ---------- lookups (two at a time) ---------- */

  var queue = [], active = 0;

  function enqueue(r) {
    r.token++;
    r.status = 'looking';
    queue.push([r, r.token]);
    paint(r);
    refreshBar();
    pump();
  }

  function pump() {
    while (active < LOOKUP_LIMIT && queue.length) {
      var job = queue.shift(), r = job[0], token = job[1];
      if (r.token !== token || rows.indexOf(r) < 0) continue;
      active++;
      (function (r, token, code) {
        L.lookup(code).then(function (res) { apply(r, token, code, res); }, function () { apply(r, token, code, { status: 'blocked' }); })
          .then(function () { active--; pump(); });
      })(r, token, r.code);
    }
  }

  function apply(r, token, code, res) {
    if (r.token !== token || r.code !== code) return;
    r.status = res.status;
    if (res.status === 'found' || res.status === 'partial') {
      if (res.price && !r.editedPrice) r.price = res.price;
      if (res.name && !r.editedProduct) r.product = res.name;
      r.unsure = !!res.unsure;
      if (res.status === 'found') r.checkedAt = Date.now();
    }
    paint(r);
    persist();
    refreshBar();
    warmSoon();
  }

  /* ---------- PDFs ---------- */

  // PDFs are made ahead of time so a tap can share or save them straight away
  // (phones only allow the share sheet straight after a tap).
  var cache = new Map();
  function pdfFor(tickets) {
    var key = E.ukDate().ref + '|' + JSON.stringify(tickets);
    var hit = cache.get(key);
    if (!hit) {
      hit = { bytes: null };
      hit.promise = engine.render(tickets).then(function (b) { hit.bytes = b; return b; });
      hit.promise.catch(function () { cache.delete(key); });
      cache.set(key, hit);
      while (cache.size > 150) cache.delete(cache.keys().next().value);
    }
    return hit;
  }

  var warmTimer = 0;
  function warmSoon() {
    clearTimeout(warmTimer);
    warmTimer = setTimeout(function () {
      if (!engine) return;
      var ok = rows.filter(ready);
      ok.forEach(function (r) { pdfFor([ticketOf(r)]); });
      if (ok.length > 1) pdfFor(ok.map(ticketOf));
    }, 450);
  }

  function saveFile(file) {
    var url = URL.createObjectURL(file);
    var a = document.createElement('a');
    a.href = url; a.download = file.name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function record(list) {
    var iso = E.ukDate().iso;
    list.forEach(function (r) { hist[r.code] = { price: normPrice(r.price), date: iso }; });
    store(HIST_KEY, hist);
    list.forEach(paint);
    refreshBar();
  }

  function fileSheet(files, done) {
    var wrap = document.createElement('div');
    wrap.className = 'pt-sheet';
    var card = document.createElement('div');
    card.className = 'pt-sheet-card';
    card.innerHTML = '<h2>Your PDFs</h2><p>Tap each one to save or print it.</p>';
    var urls = [];
    files.forEach(function (f) {
      var a = document.createElement('a'), url = URL.createObjectURL(f);
      urls.push(url);
      a.className = 'btn'; a.href = url; a.download = f.name; a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML = '<span></span>' + ICON.pdf;
      a.firstChild.textContent = f.name;
      card.appendChild(a);
    });
    var close = document.createElement('button');
    close.className = 'btn btn-primary'; close.type = 'button'; close.textContent = 'Done'; close.style.width = '100%';
    card.appendChild(close);
    wrap.appendChild(card);
    function shut() { wrap.remove(); setTimeout(function () { urls.forEach(URL.revokeObjectURL); }, 60000); }
    close.addEventListener('click', shut);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) shut(); });
    document.body.appendChild(wrap);
    if (done) done();
  }

  /* items: [{name, tickets}] -> share sheet on phones, downloads elsewhere */
  function deliver(items, rowsDone, btn) {
    if (!engine || !items.length) return;
    var hits = items.map(function (it) { return pdfFor(it.tickets); });
    var finish = function () {
      var files = items.map(function (it, i) { return new File([hits[i].bytes], it.name, { type: 'application/pdf' }); });
      var done = function () { record(rowsDone); };
      if (ios && navigator.canShare && navigator.share) {
        var can = false;
        try { can = navigator.canShare({ files: files }); } catch (e) { can = false; }
        if (can) {
          navigator.share({ files: files }).then(done, function (e) {
            if (e && e.name === 'AbortError') return;
            fileSheet(files, done);
          });
          return;
        }
      }
      if (coarse && files.length > 1) { fileSheet(files, done); return; }
      files.forEach(function (f, i) { setTimeout(function () { saveFile(f); }, i * 400); });
      done();
    };
    if (hits.every(function (h) { return h.bytes; })) { finish(); return; }
    if (btn) btn.classList.add('is-busy');
    Promise.all(hits.map(function (h) { return h.promise; })).then(function () {
      if (btn) btn.classList.remove('is-busy');
      finish();
    }, function (e) {
      if (btn) btn.classList.remove('is-busy');
      toast("Couldn't make the PDF: " + (e && e.message ? e.message : 'unknown error'));
    });
  }

  function skippedNote(list) {
    var bad = list.filter(function (r) { return !ready(r); });
    if (bad.length) toast('Left out ' + bad.map(function (r) { return r.code; }).join(', ') + ': still needs a price or name');
  }

  dlSheet.addEventListener('click', function () {
    var ok = rows.filter(ready);
    if (!ok.length) return;
    skippedNote(rows);
    deliver([{ name: 'Price-tickets-' + E.ukDate().iso + '.pdf', tickets: ok.map(ticketOf) }], ok, dlSheet);
  });

  function separate(list, btn) {
    var ok = list.filter(ready);
    if (!ok.length) return;
    skippedNote(list);
    deliver(ok.map(function (r) { return { name: r.code + '-ticket.pdf', tickets: [ticketOf(r)] }; }), ok, btn);
  }
  dlChanged.addEventListener('click', function () { separate(rows.filter(function (r) { return ready(r) && changed(r); }), dlChanged); });

  /* ---------- bar + toast ---------- */

  function refreshBar() {
    var n = rows.length;
    emptyEl.hidden = n > 0;
    toolbarEl.hidden = n === 0;
    barEl.hidden = n === 0;
    countEl.textContent = n + (n === 1 ? ' ticket' : ' tickets');
    var ok = rows.filter(ready);
    dlSheet.disabled = !ok.length;
    var ch = ok.filter(function (r) { return changed(r); });
    dlChanged.hidden = !ch.length;
    dlChanged.textContent = 'Changed prices only (' + ch.length + ')';
    checkAll.disabled = !n || rows.every(function (r) { return r.status === 'looking'; });
    var pages = Math.ceil(ok.length / 6);
    noteEl.textContent = (ok.length ? ok.length + (ok.length === 1 ? ' ticket' : ' tickets') + ' ready, ' + pages + ' A4 page' + (pages === 1 ? '' : 's') + '. ' : '') +
      'Print at 100% / Actual size, not Fit to page.';
  }

  var toastEl = $('toast'), toastTimer = 0;
  function toast(msg, action, fn) {
    clearTimeout(toastTimer);
    toastEl.textContent = '';
    var span = document.createElement('span');
    span.textContent = msg;
    toastEl.appendChild(span);
    if (action) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = action;
      b.addEventListener('click', function () { toastEl.classList.remove('show'); fn(); });
      toastEl.appendChild(b);
    }
    toastEl.classList.add('show');
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, action ? 6000 : 4500);
  }

  /* ---------- start ---------- */

  rows.forEach(function (r) { listEl.appendChild(makeRow(r)); paint(r); });
  refreshBar();
  fitPreviews();

  function getFont(path) {
    return fetch(path).then(function (res) { if (!res.ok) throw new Error(res.status); return res.arrayBuffer(); });
  }
  Promise.all([getFont('price-tickets/fonts/BarlowCondensed-ExtraBold.ttf'), getFont('price-tickets/fonts/BarlowSemiCondensed-Regular.ttf')])
    .then(function (b) {
      engine = new E.Engine(window.TICKET_FONT_DATA, b[0], b[1]);
      rows.forEach(paint);
      refreshBar();
      warmSoon();
    })
    .catch(function () { toast("Couldn't load the ticket fonts. Check your connection and reload."); });

  // coming back to the page on another day: refresh dates and "checked" times
  document.addEventListener('visibilitychange', function () { if (!document.hidden) rows.forEach(paint); });
})();
