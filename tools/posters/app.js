/* A4 Posters tool: one row per product (code, price, name, photo), live Screwfix lookup, poster preview and PDFs.
   Works the same way as the Price Tickets page; the photo comes from Screwfix, or is pasted / uploaded. */
(function () {
  'use strict';

  var E = window.PosterEngine, L = window.ScrewfixLookup, P = window.PosterPhoto;
  var ROWS_KEY = 'ps-rows-v1';
  var LOOKUP_LIMIT = 2, PHOTO_LIMIT = 2;
  var LY = E.LAYOUT;
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  // iPhone / iPad: the share sheet (Print, Save to Files) beats a download there
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  var $ = function (id) { return document.getElementById(id); };
  var listEl = $('list'), emptyEl = $('empty'), barEl = $('bar'), toolbarEl = $('toolbar'), countEl = $('count'), noteEl = $('note');
  var dlAll = $('dlAll'), dlAllText = $('dlAllText'), checkAll = $('checkAll'), filePick = $('filePick');

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: keep going */ } }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function squash(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function posOf(p) { return p === 'top' || p === 'bottom' ? p : 'middle'; }
  function scaleOf(s) { s = +s; return s >= 0.5 && s <= 1 ? Math.round(s * 20) / 20 : 1; }

  /* ---------- state ---------- */

  var rows = load(ROWS_KEY, []).filter(function (r) { return r && r.code; }).map(function (r) {
    return {
      id: r.id || uid(), code: r.code, price: r.price || '', product: r.product || '',
      status: r.status === 'looking' ? 'manual' : (r.status || 'manual'), checkedAt: r.checkedAt || 0,
      was: r.was || '', editedPrice: !!r.editedPrice, editedProduct: !!r.editedProduct, editedWas: !!r.editedWas, unsure: !!r.unsure,
      age: !!r.age, ageSet: typeof r.ageSet === 'boolean' ? r.ageSet : null,
      photos: Array.isArray(r.photos) ? r.photos.filter(function (x) { return typeof x === 'string'; }) : [],
      photo: r.photo && (r.photo.kind === 'sf' || r.photo.kind === 'own') ? r.photo : null,
      scale: scaleOf(r.scale), pos: posOf(r.pos),
      photoState: 'none', photoMsg: '', token: 0, ptoken: 0, rev: 0
    };
  });
  var views = new Map();
  var imgs = new Map();          // row id -> {bytes, w, h, url}: the prepared photo
  var engine = null;
  var activeRow = null;          // where a pasted or uploaded picture goes

  var saveTimer = 0;
  function persist(now) {
    clearTimeout(saveTimer);
    var write = function () {
      store(ROWS_KEY, rows.map(function (r) {
        return { id: r.id, code: r.code, price: r.price, product: r.product, status: r.status === 'looking' ? 'manual' : r.status,
                 checkedAt: r.checkedAt, was: r.was, editedPrice: r.editedPrice, editedProduct: r.editedProduct, editedWas: r.editedWas, unsure: r.unsure,
                 age: r.age, ageSet: r.ageSet, photos: r.photos, photo: r.photo, scale: r.scale, pos: r.pos };
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

  /* The name as it goes on the poster: the user's line breaks kept, spaces tidied, "(CODE)" taken off the end */
  function cleanProduct(product, code) {
    var lines = String(product || '').split(/\r?\n/).map(squash).filter(Boolean);
    if (lines.length) lines[lines.length - 1] = squash(lines[lines.length - 1].replace(new RegExp('\\s*\\(' + escapeRe(code) + '\\)\\s*$', 'i'), ''));
    return lines.filter(Boolean).join('\n');
  }

  function hasAge(r) { return r.ageSet != null ? r.ageSet : !!r.age; }

  function posterOf(r) {
    var img = imgs.get(r.id);
    return { code: r.code, price: normPrice(r.price) || r.price, was: normPrice(r.was) || '', product: cleanProduct(r.product, r.code), age: hasAge(r),
             pos: r.pos, scale: r.scale, image: img ? { bytes: img.bytes, w: img.w, h: img.h } : null };
  }

  function problem(r) {
    if (!r.price) return 'Add the price';
    if (normPrice(r.price) === null) return 'Price should look like 12.99';
    if (r.was && normPrice(r.was) === null) return 'Was price should look like 29.99';
    if (!cleanProduct(r.product, r.code)) return 'Add the product name';
    if (!engine) return null;
    var e = engine.check(posterOf(r));
    return e ? e.message : null;
  }

  function ready(r) { return !!engine && r.status !== 'looking' && r.photoState !== 'loading' && !problem(r); }

  var dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' });
  var timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
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
    if (s === 'found' && r.unsure) return ['warn', 'Check this is the right product'];
    if (s === 'found' && (r.editedPrice || r.editedProduct || r.editedWas)) return ['info', 'Edited by you'];
    if (s === 'found') {
      var when = whenChecked(r.checkedAt), today = E.ukDate(new Date(r.checkedAt)).iso === E.ukDate().iso;
      return today ? ['ok', 'Live price, checked ' + when] : ['muted', 'Checked ' + when + '. Tap ↻ for today’s price'];
    }
    return ['muted', 'Typed in'];
  }

  function photoStatusOf(r) {
    if (r.photoState === 'loading') return ['busy', r.photo && r.photo.kind === 'own' ? 'Getting your photo ready…' : 'Getting the photo from Screwfix…'];
    if (r.photoState === 'failed') return ['warn', r.photoMsg || "Couldn't get the photo. Paste or upload one"];
    if (imgs.has(r.id)) return ['ok', r.photo && r.photo.kind === 'own' ? 'Your photo' : 'Screwfix photo'];
    return ['', r.photoMsg || 'No photo yet. The poster prints without one'];
  }

  /* ---------- row views ---------- */

  var ICON = {
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>',
    paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h4"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>'
  };

  /* The 18+ badge as SVG, from the same outlines the PDF uses. 'pv' = placed for the poster preview; otherwise a one-colour icon. */
  function badgePath() {
    return E.BADGE.ops.map(function (o) {
      var s = { m: 'M', l: 'L', c: 'C', h: 'Z' }[o[0]];
      for (var i = 1; i < o.length; i += 2) s += (i > 1 ? ' ' : '') + o[i] + ' ' + o[i + 1];
      return s;
    }).join('');
  }
  var BADGE_D = badgePath();
  function badgeIcon() {
    var B = E.BADGE, C = B.circle;
    return '<svg viewBox="0 0 ' + B.size + ' ' + B.size + '" aria-hidden="true" focusable="false"><g transform="translate(0 ' + (C.cy + C.r + C.w / 2) + ') scale(1 -1)">' +
      '<circle cx="' + C.cx + '" cy="' + C.cy + '" r="' + C.r + '" stroke-width="' + C.w + '"/><path d="' + BADGE_D + '"/></g></svg>';
  }

  function makeRow(r) {
    var el = document.createElement('article');
    el.className = 'pt-row ps-row';
    var pid = 'p-' + r.id, nid = 'n-' + r.id, sid = 's-' + r.id, wid = 'w-' + r.id;
    el.innerHTML =
      '<div class="pt-row-top">' +
        '<input class="pt-code" type="text" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="Product code">' +
        '<div class="pt-icons">' +
          '<a class="icon-btn sf" target="_blank" rel="noopener" title="Open on Screwfix" aria-label="Open on Screwfix">' + ICON.link + '</a>' +
          '<button class="icon-btn refresh" type="button" title="Check the price again" aria-label="Check the price again">' + ICON.refresh + '</button>' +
          '<button class="icon-btn remove" type="button" title="Remove" aria-label="Remove poster">' + ICON.close + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="pt-chip" role="status"><span></span></div>' +
      '<div class="ps-main">' +
        '<div class="pt-fields">' +
          '<div class="ps-prices">' +
            '<div class="pt-field"><label for="' + pid + '">Price</label><div class="pt-money"><input id="' + pid + '" class="pt-price" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"></div></div>' +
            '<div class="pt-field"><label for="' + wid + '">Was <span class="ps-opt">on offer</span></label><div class="pt-money"><input id="' + wid + '" class="ps-was" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"></div></div>' +
          '</div>' +
          '<p class="ps-sale" hidden></p>' +
          '<div class="pt-field"><label for="' + nid + '">Product name</label><textarea id="' + nid + '" class="pt-product" rows="1" placeholder="As written on Screwfix"></textarea>' +
            '<p class="ps-tip">Lines break by themselves. Press Enter to choose where.</p></div>' +
        '</div>' +
        '<div class="ps-preview"><div class="ps-sheet"></div><div class="ps-busy" hidden><span></span></div></div>' +
        '<div class="ps-photo">' +
          '<div class="ps-photo-head"><span class="ps-label">Photo</span><span class="ps-photo-status" role="status"></span></div>' +
          '<div class="ps-pick">' +
            '<span class="ps-thumbs" style="display:contents"></span>' +
            '<button class="ps-tool paste" type="button" title="Paste a copied picture">' + ICON.paste + 'Paste</button>' +
            '<button class="ps-tool upload" type="button" title="Choose a picture">' + ICON.image + 'Upload</button>' +
          '</div>' +
          '<div class="ps-adjust">' +
            '<label class="ps-size" for="' + sid + '">Size <input id="' + sid + '" type="range" min="50" max="100" step="5"><output></output></label>' +
            '<div class="ps-seg" role="group" aria-label="Photo position">' +
              '<button type="button" data-pos="top" aria-pressed="false">Top</button>' +
              '<button type="button" data-pos="middle" aria-pressed="false">Middle</button>' +
              '<button type="button" data-pos="bottom" aria-pressed="false">Bottom</button>' +
            '</div>' +
          '</div>' +
          '<p class="ps-hint"><span class="fine">Copy a picture and press Ctrl+V, or drop one on the poster.</span>' +
            '<span class="coarse">On the Screwfix site, press and hold the photo, tap Copy, then tap Paste here.</span></p>' +
        '</div>' +
      '</div>' +
      '<div class="pt-row-foot">' +
        '<button class="pt-age" type="button" role="switch" aria-checked="false">' + badgeIcon() + '<span>Challenge 25</span></button>' +
        '<button class="btn btn-sm dl" type="button">' + ICON.pdf + 'PDF</button></div>';

    var q = function (s) { return el.querySelector(s); };
    var v = {
      el: el, code: q('.pt-code'), chip: q('.pt-chip'), chipText: q('.pt-chip span'), sf: q('.sf'),
      refresh: q('.refresh'), remove: q('.remove'), price: q('.pt-price'), product: q('.pt-product'), was: q('.ps-was'), sale: q('.ps-sale'),
      dl: q('.dl'), age: q('.pt-age'), preview: q('.ps-preview'), sheet: q('.ps-sheet'), busy: q('.ps-busy'),
      pstatus: q('.ps-photo-status'), thumbs: q('.ps-thumbs'), paste: q('.paste'), upload: q('.upload'),
      adjust: q('.ps-adjust'), size: q('.ps-size input'), sizeOut: q('.ps-size output'), seg: el.querySelectorAll('.ps-seg button'),
      hint: q('.ps-hint'), thumbKey: '', svgKey: ''
    };
    views.set(r.id, v);

    var mark = function () { activeRow = r; };
    el.addEventListener('pointerdown', mark);
    el.addEventListener('focusin', mark);

    v.code.addEventListener('keydown', function (e) { if (e.key === 'Enter') v.code.blur(); });
    v.code.addEventListener('change', function () {
      var c = normCode(v.code.value);
      if (c && c !== r.code && !isSku(c)) toast(v.code.value.trim() + " isn't a Screwfix code. Codes are 5 characters, like 872RE");
      if (!c || c === r.code || !isSku(c)) { v.code.value = r.code; return; }
      r.code = c; r.price = ''; r.product = ''; r.was = ''; r.editedPrice = r.editedProduct = r.editedWas = false; r.unsure = false;
      r.age = false; r.ageSet = null; r.photos = []; r.missing = [];
      enqueue(r);
      if (!r.photo || r.photo.kind === 'sf') loadScrewfixPhoto(r, c + '_P');
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
    v.was.addEventListener('input', function () {
      r.was = v.was.value.trim() ? v.was.value : ''; r.editedWas = true;
      if (r.status !== 'found' && r.status !== 'looking') r.status = 'manual';
      changedRow(r);
    });
    v.was.addEventListener('blur', function () {
      var n = normPrice(r.was);
      if (n) { r.was = n; v.was.value = n.slice(1); }
      changedRow(r);
    });
    v.product.addEventListener('input', function () {
      r.product = v.product.value; r.editedProduct = true;
      if (r.status !== 'found' && r.status !== 'looking') r.status = 'manual';
      autosize(v.product);
      changedRow(r);
    });
    v.refresh.addEventListener('click', function () {
      r.editedPrice = r.editedProduct = r.editedWas = false;
      enqueue(r);
      if (r.photoState === 'failed' && (!r.photo || r.photo.kind === 'sf')) loadScrewfixPhoto(r, (r.photo && r.photo.id) || r.code + '_P');
    });
    v.remove.addEventListener('click', function () { removeRow(r); });
    v.age.addEventListener('click', function () {
      r.ageSet = !hasAge(r);           // a choice made here sticks, even when prices are checked again
      changedRow(r);
    });
    v.dl.addEventListener('click', function () {
      if (!ready(r)) return;
      deliver([{ name: fileName(r), posters: [posterOf(r)], key: keyOf(r) }], v.dl);
    });

    v.thumbs.addEventListener('click', function (e) {
      var b = e.target.closest('.ps-thumb');
      if (b) loadScrewfixPhoto(r, b.getAttribute('data-id'));
    });
    v.paste.addEventListener('click', function () {
      activeRow = r;
      P.readClipboard().then(function (got) { usePicked(r, got); }, function (e) {
        if (e.kind === 'empty') toast('Nothing to paste. Copy a picture first');
        else toast(coarse ? "Couldn't paste here. Save the picture to your phone and use Upload" : "Couldn't read the clipboard. Press Ctrl+V instead, or use Upload");
      });
    });
    v.upload.addEventListener('click', function () { activeRow = r; filePick.value = ''; filePick.click(); });
    v.size.addEventListener('input', function () {
      r.scale = scaleOf(+v.size.value / 100);
      changedRow(r);
    });
    Array.prototype.forEach.call(v.seg, function (b) {
      b.addEventListener('click', function () { r.pos = posOf(b.getAttribute('data-pos')); changedRow(r); });
    });

    // drop a picture on the preview
    v.preview.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0 ||
          e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'text/uri-list') >= 0) {
        e.preventDefault(); v.preview.classList.add('drag');
      }
    });
    v.preview.addEventListener('dragleave', function () { v.preview.classList.remove('drag'); });
    v.preview.addEventListener('drop', function (e) {
      v.preview.classList.remove('drag');
      var dt = e.dataTransfer;
      if (!dt) return;
      e.preventDefault();
      var f = Array.prototype.filter.call(dt.files || [], function (x) { return /^image\//.test(x.type); })[0];
      if (f) { usePicked(r, { blob: f }); return; }
      var url = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n')[0].trim();
      if (/^https?:\/\//i.test(url)) usePicked(r, { url: url });
      else toast('Drop a picture file or a picture from a web page');
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
    if (active !== v.was) v.was.value = String(r.was || '').replace(/^£/, '');
    v.price.classList.toggle('invalid', !!r.price && normPrice(r.price) === null);
    v.was.classList.toggle('invalid', !!r.was && normPrice(r.was) === null);
    paintSale(r, v);
    var st = statusOf(r);
    v.chip.className = 'pt-chip ' + st[0];
    v.chipText.textContent = st[1];
    v.chip.title = st[1];
    v.sf.href = L.productUrl(r.code);
    v.refresh.disabled = r.status === 'looking';
    v.refresh.classList.toggle('spin', r.status === 'looking');
    v.dl.disabled = !ready(r);
    var age = hasAge(r);
    v.age.classList.toggle('on', age);
    v.age.setAttribute('aria-checked', age ? 'true' : 'false');
    v.age.title = age ? (r.ageSet == null ? 'Screwfix lists this as a Challenge 25 product. ' : '') + 'Tap to take the 18+ badge off'
                      : 'Tap to add the 18+ badge for a Challenge 25 product';
    paintPhoto(r, v);
    paintPreview(r, v);
  }

  /* Under the prices: what the sale flash will say, and why */
  function paintSale(r, v) {
    var price = normPrice(r.price), was = normPrice(r.was), s = price && was ? E.saleOf(price, was) : null;
    var msg = '';
    v.sale.textContent = '';
    if (s) {
      var flash = document.createElement('span');
      flash.className = 'ps-flash';
      flash.textContent = s.flash;
      v.sale.appendChild(flash);
      var pct = Math.floor(s.pct * 10) / 10, real = pct % 1 ? pct.toFixed(1) : String(pct);
      msg = s.over >= 5 ? 'Actual saving ' + real + '%, rounded down to the nearest 5%'
                        : 'Actual saving ' + real + '%, so it shows the money off instead';
    } else if (was && price) {
      msg = 'The was price needs to be higher than the price to show a sale';
    }
    if (msg) v.sale.appendChild(document.createTextNode(msg));
    v.sale.classList.toggle('off', !s);
    v.sale.hidden = !msg;
  }

  function paintPhoto(r, v) {
    var ps = photoStatusOf(r), has = imgs.has(r.id);
    v.pstatus.className = 'ps-photo-status ' + ps[0];
    v.pstatus.textContent = ps[1];
    var ids = r.photos.length ? r.photos : [r.code + '_P'];
    var sel = r.photo && r.photo.kind === 'sf' && (has || r.photoState === 'loading') ? r.photo.id : '';
    var key = ids.join(',') + '|' + sel;
    if (key !== v.thumbKey) {
      v.thumbKey = key;
      v.thumbs.textContent = '';
      ids.forEach(function (id, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ps-thumb' + (id === sel ? ' on' : '');
        b.setAttribute('data-id', id);
        b.setAttribute('aria-pressed', id === sel ? 'true' : 'false');
        b.title = i === 0 && /_P$/.test(id) ? 'Screwfix main photo' : 'Screwfix photo ' + (i + 1);
        b.setAttribute('aria-label', b.title);
        var im = document.createElement('img');
        im.alt = ''; im.decoding = 'async'; im.referrerPolicy = 'no-referrer';
        im.addEventListener('error', function () { if (ids.length > 1) b.hidden = true; });
        im.src = P.thumbUrl(id);
        b.appendChild(im);
        v.thumbs.appendChild(b);
      });
    }
    var own = r.photo && r.photo.kind === 'own' && has;
    v.upload.classList.toggle('on', !!own);
    v.adjust.setAttribute('aria-disabled', has ? 'false' : 'true');
    v.size.disabled = !has;
    v.size.value = Math.round(r.scale * 100);
    v.sizeOut.textContent = Math.round(r.scale * 100) + '%';
    Array.prototype.forEach.call(v.seg, function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-pos') === r.pos ? 'true' : 'false');
      b.disabled = !has;
    });
    v.hint.hidden = has && r.photoState !== 'failed';
    v.busy.hidden = r.photoState !== 'loading';
  }

  /* ---------- the preview: the PDF layout drawn as SVG ---------- */

  function xs(run, x0) { return run.items.map(function (it) { return +(x0 + it[0]).toFixed(2); }).join(' '); }
  function textEl(cls, run, x0, y, size, family, text) {
    return '<text class="' + cls + '" x="' + xs(run, x0) + '" y="' + (+y.toFixed(2)) + '" font-size="' + (+size.toFixed(3)) +
           '" font-family="' + family + ', sans-serif" style="white-space:pre">' + esc(text) + '</text>';
  }

  function previewLayout(r, img) {
    var p = posterOf(r), phPrice = !normPrice(r.price), phName = !p.product;
    if (phPrice) p.price = '£0.00';
    if (phName) p.product = 'Product name';
    var lay = null;
    try { lay = engine.layout(p, img); } catch (e) {
      try { p.product = 'Product name'; phName = true; lay = engine.layout(p, img); } catch (e2) { lay = null; }
    }
    return lay ? { lay: lay, phPrice: phPrice, phName: phName } : null;
  }

  function paintPreview(r, v) {
    var img = imgs.get(r.id);
    if (!engine) {
      if (v.svgKey !== 'wait') { v.svgKey = 'wait'; v.sheet.innerHTML = ''; }
      return;
    }
    var pl = previewLayout(r, img ? { w: img.w, h: img.h } : null);
    if (!pl) return;
    var lay = pl.lay, W = E.PAGE_W, H = E.PAGE_H, out = [];
    out.push('<svg class="ps-svg" viewBox="0 0 ' + W.toFixed(3) + ' ' + H.toFixed(3) + '" role="img" aria-label="Poster preview: ' +
             esc(lay.price.text + ', ' + lay.names.map(function (n) { return n.text; }).join(' ')) + '">');
    out.push('<rect width="' + W.toFixed(3) + '" height="' + H.toFixed(3) + '" fill="#fff"/>');
    if (lay.photo && img) {
      var ph = lay.photo;
      out.push('<image href="' + img.url + '" x="' + ph.x.toFixed(2) + '" y="' + ph.y.toFixed(2) + '" width="' + ph.w.toFixed(2) +
               '" height="' + ph.h.toFixed(2) + '" preserveAspectRatio="none"/>');
    } else if (lay.area.h > 60) {
      var a = lay.area, inset = 18;
      out.push('<rect class="ps-hole" x="' + (a.x + inset) + '" y="' + (a.y + inset) + '" width="' + (a.w - 2 * inset) + '" height="' + (a.h - 2 * inset) + '" rx="14"/>');
      out.push('<text class="ps-hole-t" x="' + (a.x + a.w / 2) + '" y="' + (a.y + a.h / 2 + 8) + '" text-anchor="middle">' +
               (r.photoState === 'loading' ? 'Getting the photo' : 'Photo') + '</text>');
    }
    out.push(textEl('t-blue' + (pl.phPrice ? ' ph' : ''), lay.price.run, lay.price.x, lay.price.y, lay.price.size, 'PosterBold', lay.price.text));
    if (lay.sale) {
      var sl = lay.sale;
      out.push('<polygon class="t-red" points="' + E.flashOutline(sl.box).map(function (pt) { return pt[0].toFixed(2) + ',' + pt[1].toFixed(2); }).join(' ') + '"/>');
      out.push(textEl('t-white', sl.flash.run, sl.flash.x, sl.flash.y, sl.flash.size, 'PosterBold', sl.flash.text));
      out.push(textEl('t-red', sl.was.run, sl.was.x, sl.was.y, sl.was.size, 'PosterBold', sl.was.text));
    }
    lay.names.forEach(function (n) { out.push(textEl('t-blue' + (pl.phName ? ' ph' : ''), n.run, n.x, n.y, LY.name.size, 'PosterText', n.text)); });
    out.push(textEl('t-blue', lay.code.run, lay.code.x, lay.code.y, LY.code.size, 'PosterText', lay.code.text));
    if (lay.badge) {
      var C = E.BADGE.circle, b = lay.badge;
      out.push('<g transform="translate(' + b.x.toFixed(2) + ' ' + b.y.toFixed(2) + ') scale(' + b.scale.toFixed(4) + ' ' + (-b.scale).toFixed(4) + ')">' +
               '<circle cx="' + C.cx + '" cy="' + C.cy + '" r="' + C.r + '" fill="#fff" stroke="#ed1c24" stroke-width="' + C.w + '"/>' +
               '<path d="' + BADGE_D + '" fill="#ed1c24"/></g>');
    }
    var rf = lay.ref;
    out.push('<g transform="translate(' + rf.x + ' ' + rf.y.toFixed(3) + ') rotate(-90) scale(' + rf.hscale + ' 1)">' +
             textEl('t-ref', rf.run, 0, 0, rf.size, 'PosterBold', rf.text) + '</g>');
    out.push('</svg>');
    var svg = out.join('');
    if (svg !== v.svgKey) { v.svgKey = svg; v.sheet.innerHTML = svg; }
  }

  function changedRow(r) {
    paint(r);
    persist();
    refreshBar();
    warmSoon();
  }

  /* ---------- photos ---------- */

  var photoQueue = [], photoActive = 0;
  function photoPump() {
    while (photoActive < PHOTO_LIMIT && photoQueue.length) {
      var job = photoQueue.shift();
      photoActive++;
      job().then(done, done);
    }
    function done() { photoActive--; photoPump(); }
  }

  function setPhoto(r, prepared, src) {
    var old = imgs.get(r.id);
    if (old && old.url) setTimeout(function () { URL.revokeObjectURL(old.url); }, 4000);
    imgs.set(r.id, { bytes: prepared.bytes, w: prepared.w, h: prepared.h, url: URL.createObjectURL(prepared.blob) });
    r.photo = src;
    r.photoState = 'ok';
    r.photoMsg = '';
    r.rev++;
    P.store.put(r.id, { bytes: prepared.bytes.buffer.slice(0), w: prepared.w, h: prepared.h, src: src });
    changedRow(r);
  }

  function dropPhoto(r) {
    var old = imgs.get(r.id);
    if (old && old.url) setTimeout(function () { URL.revokeObjectURL(old.url); }, 4000);
    imgs.delete(r.id);
    r.rev++;
  }

  /* The first Screwfix photo for this product that hasn't already turned out to be missing */
  function nextPhoto(r) {
    return r.photos.filter(function (x) { return (r.missing || []).indexOf(x) < 0; })[0] || null;
  }

  /* A photo that didn't come through: keep the one the poster already had, if any */
  function photoFailed(r, before, msg) {
    if (imgs.has(r.id) && before) {
      r.photo = before;
      r.photoState = 'ok';
      toast(msg.replace(/\. .*$/, '') + ', so the photo you had stays');
    } else {
      r.photoState = 'failed';
      r.photoMsg = msg;
    }
    changedRow(r);
  }

  function loadScrewfixPhoto(r, id) {
    if (!id) return;
    var t = ++r.ptoken;
    var before = imgs.has(r.id) ? r.photo : null;
    r.photo = { kind: 'sf', id: id };
    r.photoState = 'loading';
    paint(r);
    refreshBar();
    photoQueue.push(function () {
      if (t !== r.ptoken || rows.indexOf(r) < 0) return Promise.resolve();
      return P.fetchScrewfix(id).then(function (res) { return P.prepare(res.blob); }).then(function (prepared) {
        if (t !== r.ptoken) return;
        setPhoto(r, prepared, { kind: 'sf', id: id });
      }, function (e) {
        if (t !== r.ptoken) return;
        var missing = e && e.kind === 'missing';
        if (missing) {
          r.missing = (r.missing || []).concat(id);
          // that photo isn't there: try the next one the product page shows
          var alt = nextPhoto(r);
          if (alt && !before) { loadScrewfixPhoto(r, alt); return; }
        }
        photoFailed(r, before, missing ? "Screwfix doesn't have that photo. Paste or upload one"
                                       : "Couldn't get the photo from Screwfix. Paste or upload one");
      });
    });
    photoPump();
  }

  function useOwnPhoto(r, blob) {
    var t = ++r.ptoken;
    var before = r.photo;
    r.photo = { kind: 'own' };
    r.photoState = 'loading';
    paint(r);
    refreshBar();
    P.prepare(blob).then(function (prepared) {
      if (t !== r.ptoken) return;
      setPhoto(r, prepared, { kind: 'own' });
      toast('Photo added to ' + r.code);
    }, function (e) {
      if (t !== r.ptoken) return;
      r.photo = before;
      r.photoState = imgs.has(r.id) ? 'ok' : 'none';
      changedRow(r);
      toast(e && e.message ? e.message : "Couldn't use that picture");
    });
  }

  /* A picked picture ({blob} or {url}) for a row. Screwfix image links are fetched full size. */
  function usePicked(r, got) {
    if (!r || rows.indexOf(r) < 0) { toast('Add a product code first, then paste the photo'); return; }
    if (got.blob) { useOwnPhoto(r, got.blob); return; }
    var sfId = P.screwfixId(got.url);
    if (sfId) { loadScrewfixPhoto(r, sfId.toUpperCase()); return; }
    var page = String(got.url).match(/screwfix\.com\/p\/(?:[^\s\/?#]+\/)*([a-z0-9]+)\/?(?:[?#]|$)/i);
    if (page && isSku(normCode(page[1]))) { loadScrewfixPhoto(r, normCode(page[1]) + '_P'); return; }
    var t = ++r.ptoken;
    var before = imgs.has(r.id) ? r.photo : null;
    r.photo = { kind: 'own' };
    r.photoState = 'loading';
    paint(r);
    refreshBar();
    P.fetchUrl(got.url).then(function (res) { return P.prepare(res.blob); }).then(function (prepared) {
      if (t !== r.ptoken) return;
      setPhoto(r, prepared, { kind: 'own' });
    }, function () {
      if (t !== r.ptoken) return;
      var msg = "Couldn't open that picture link. Copy the picture itself, or save it and use Upload";
      if (!before) toast(msg);
      photoFailed(r, before, msg);
    });
  }

  function targetRow(el) {
    var art = el && el.closest ? el.closest('.ps-row') : null;
    if (art) {
      var hit = rows.filter(function (r) { var v = views.get(r.id); return v && v.el === art; })[0];
      if (hit) return hit;
    }
    if (activeRow && rows.indexOf(activeRow) >= 0) return activeRow;
    return rows.length === 1 ? rows[0] : null;
  }

  filePick.addEventListener('change', function () {
    var f = filePick.files && filePick.files[0];
    if (f && activeRow) usePicked(activeRow, { blob: f });
  });

  // Ctrl+V / long-press Paste anywhere on the page puts a copied picture on the poster you're working on
  document.addEventListener('paste', function (e) {
    var got = P.fromPasteEvent(e);
    if (!got) return;
    var typing = e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    if (got.url && typing) return;                       // pasting a link into a box: leave it alone
    if (typing && e.target.id === 'codes' && !got.blob) return;
    e.preventDefault();
    var r = targetRow(e.target);
    if (!r) { toast(rows.length ? 'Tap the poster you want the photo on, then paste again' : 'Add a product code first, then paste the photo'); return; }
    usePicked(r, got);
  });

  /* ---------- adding / removing ---------- */

  function parseCodes(text) {
    // a pasted product or photo link counts as its code
    text = String(text || '')
      .replace(/https?:\/\/\S*screwfix\.com\/p\/(?:[^\s\/?#]+\/)*([a-z0-9]+)\/?(?:[?#]\S*)?(?=\s|$)/gi, ' $1 ')
      .replace(/https?:\/\/media\.screwfix\.com\/is\/image\/ae235\/([a-z0-9]+)_[a-z0-9]+\S*/gi, ' $1 ');
    var codes = [], ignored = [];
    (text.toUpperCase().match(/[A-Z0-9]+/g) || []).forEach(function (raw) {
      if (!/\d/.test(raw)) return;                            // every code has a digit, so plain words are skipped quietly
      var c = normCode(raw);
      if (isSku(c)) codes.push(c); else ignored.push(raw);
    });
    return { codes: codes, ignored: ignored };
  }

  function newRow(c) {
    return { id: uid(), code: c, price: '', product: '', was: '', status: 'manual', checkedAt: 0, editedPrice: false, editedProduct: false, editedWas: false,
             unsure: false, age: false, ageSet: null, photos: [], photo: null, scale: 1, pos: 'middle',
             photoState: 'none', photoMsg: '', token: 0, ptoken: 0, rev: 0 };
  }

  function addCodes(text) {
    var parsed = parseCodes(text), codes = parsed.codes, ignored = parsed.ignored, added = [], dupes = [];
    codes.forEach(function (c) {
      if (rows.some(function (r) { return r.code === c; }) || added.indexOf(c) >= 0) { dupes.push(c); return; }
      added.push(c);
      var r = newRow(c);
      rows.push(r);
      listEl.appendChild(makeRow(r));
      enqueue(r);
      loadScrewfixPhoto(r, c + '_P');
      activeRow = r;
    });
    persist();
    refreshBar();
    var notes = [];
    if (dupes.length) notes.push(dupes.join(', ') + (dupes.length === 1 ? ' is' : ' are') + ' already in the list');
    if (ignored.length) notes.push('Ignored ' + ignored.join(', ') + ' (codes are 5 characters, like 872RE)');
    if (!codes.length && !ignored.length) toast('Type a product code, like 872RE');
    else if (notes.length) toast(notes.join('. '));
    if (added.length === 1) {
      var first = views.get(rows[rows.length - 1].id);
      if (first) first.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return added.length;
  }

  function removeRow(r) {
    var i = rows.indexOf(r);
    if (i < 0) return;
    rows.splice(i, 1);
    r.token++; r.ptoken++;
    if (r.photoState === 'loading') r.photoState = imgs.has(r.id) ? 'ok' : 'none';
    var v = views.get(r.id);
    if (v) v.el.remove();
    views.delete(r.id);
    if (activeRow === r) activeRow = null;
    persist(true);
    refreshBar();
    toast('Removed ' + r.code, 'Undo', function () {
      if (rows.indexOf(r) >= 0) return;
      i = Math.min(i, rows.length);
      rows.splice(i, 0, r);
      listEl.insertBefore(makeRow(r), listEl.children[i] || null);
      if (r.status === 'looking') r.status = 'manual';
      paint(r); persist(true); refreshBar();
    });
  }

  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('codes');
    if (addCodes(input.value)) input.value = '';
  });

  checkAll.addEventListener('click', function () {
    rows.forEach(function (r) { r.editedPrice = r.editedProduct = r.editedWas = false; enqueue(r); });
  });

  $('clearAll').addEventListener('click', function () {
    var backup = rows.slice();
    rows.forEach(function (r) { r.token++; r.ptoken++; if (r.photoState === 'loading') r.photoState = imgs.has(r.id) ? 'ok' : 'none'; });
    rows = [];
    views.clear();
    activeRow = null;
    listEl.textContent = '';
    persist(true);
    refreshBar();
    toast('Cleared ' + backup.length + (backup.length === 1 ? ' poster' : ' posters'), 'Undo', function () {
      rows = backup.concat(rows);
      listEl.textContent = '';
      views.clear();
      rows.forEach(function (r) { if (r.status === 'looking') r.status = 'manual'; listEl.appendChild(makeRow(r)); paint(r); });
      persist(true); refreshBar();
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
      if (!r.editedWas) r.was = res.was || '';        // on offer: the old price; none means it isn't any more
      r.unsure = !!res.unsure;
      r.age = !!res.age;
      if (res.status === 'found') r.checkedAt = Date.now();
      if (res.images && res.images.length) {
        r.photos = res.images.slice(0, 8);
        // the main photo wasn't there under the usual name: use the first one the page shows
        var alt = nextPhoto(r);
        if (r.photoState === 'failed' && r.photo && r.photo.kind === 'sf' && alt && alt !== r.photo.id) loadScrewfixPhoto(r, alt);
      }
    }
    paint(r);
    persist();
    refreshBar();
    warmSoon();
  }

  /* ---------- PDFs ---------- */

  function fileName(r) { return 'UK-' + r.code + '-A4-' + E.ukDate().ref + '.pdf'; }
  function keyOf(r) {
    var p = posterOf(r);
    return [r.id, r.rev, p.code, p.price, p.was, p.product, p.age, p.pos, p.scale].join('|');
  }

  // PDFs are made ahead of time so a tap can share or save them straight away
  // (phones only allow the share sheet straight after a tap).
  var cache = new Map();
  function pdfFor(posters, key) {
    key = E.ukDate().ref + '#' + key;
    var hit = cache.get(key);
    if (!hit) {
      hit = { bytes: null };
      hit.promise = engine.render(posters).then(function (b) { hit.bytes = b; return b; });
      hit.promise.catch(function () { cache.delete(key); });
      cache.set(key, hit);
      while (cache.size > 40) cache.delete(cache.keys().next().value);
    }
    return hit;
  }

  var warmTimer = 0;
  function warmSoon() {
    clearTimeout(warmTimer);
    warmTimer = setTimeout(function () {
      if (!engine) return;
      var ok = rows.filter(ready);
      ok.forEach(function (r) { pdfFor([posterOf(r)], keyOf(r)); });
      if (ok.length > 1) pdfFor(ok.map(posterOf), ok.map(keyOf).join('~'));
    }, 600);
  }

  function saveFile(file) {
    var url = URL.createObjectURL(file);
    var a = document.createElement('a');
    a.href = url; a.download = file.name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function fileSheet(files) {
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
  }

  /* items: [{name, posters, key}] -> share sheet on phones, downloads elsewhere */
  function deliver(items, btn) {
    if (!engine || !items.length) return;
    var hits = items.map(function (it) { return pdfFor(it.posters, it.key); });
    var finish = function () {
      var files = items.map(function (it, i) { return new File([hits[i].bytes], it.name, { type: 'application/pdf' }); });
      if (ios && navigator.canShare && navigator.share) {
        var can = false;
        try { can = navigator.canShare({ files: files }); } catch (e) { can = false; }
        if (can) {
          navigator.share({ files: files }).catch(function (e) {
            if (e && e.name === 'AbortError') return;
            fileSheet(files);
          });
          return;
        }
      }
      if (coarse && files.length > 1) { fileSheet(files); return; }
      files.forEach(function (f, i) { setTimeout(function () { saveFile(f); }, i * 400); });
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

  dlAll.addEventListener('click', function () {
    var ok = rows.filter(ready);
    if (!ok.length) return;
    var bad = rows.filter(function (r) { return !ready(r); });
    if (bad.length) toast('Left out ' + bad.map(function (r) { return r.code; }).join(', ') + ': still needs a price, name or photo to finish loading');
    deliver([{ name: ok.length === 1 ? fileName(ok[0]) : 'Posters-' + E.ukDate().iso + '.pdf',
               posters: ok.map(posterOf), key: ok.map(keyOf).join('~') }], dlAll);
  });

  /* ---------- bar + toast ---------- */

  function refreshBar() {
    var n = rows.length;
    emptyEl.hidden = n > 0;
    toolbarEl.hidden = n === 0;
    barEl.hidden = n === 0;
    countEl.textContent = n + (n === 1 ? ' poster' : ' posters');
    var ok = rows.filter(ready);
    dlAll.disabled = !ok.length;
    dlAllText.textContent = ok.length > 1 ? 'All ' + ok.length + ' posters in one PDF' : 'Download poster PDF';
    checkAll.disabled = !n || rows.every(function (r) { return r.status === 'looking'; });
    var noPhoto = ok.filter(function (r) { return !imgs.has(r.id); }).length;
    noteEl.textContent = (ok.length ? ok.length + (ok.length === 1 ? ' poster' : ' posters') + ' ready' +
      (noPhoto ? ' (' + noPhoto + ' without a photo)' : '') + '. ' : '') + 'Print on A4 at 100% / Actual size.';
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

  // photos saved on this device come straight back; Screwfix ones that aren't saved are fetched again
  Promise.all(rows.map(function (r) {
    return P.store.get(r.id).then(function (saved) {
      if (saved && saved.bytes && saved.w && saved.h) {
        var bytes = new Uint8Array(saved.bytes);
        imgs.set(r.id, { bytes: bytes, w: saved.w, h: saved.h, url: URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })) });
        r.photo = saved.src || r.photo || { kind: 'own' };
        r.photoState = 'ok';
        r.rev++;
      } else if (!r.photo || r.photo.kind === 'sf') {
        loadScrewfixPhoto(r, (r.photo && r.photo.id) || r.code + '_P');
      } else {
        r.photo = null;
        r.photoMsg = 'Add your photo again';
      }
      paint(r);
    });
  })).then(function () {
    refreshBar();
    warmSoon();
    // tidy away photos for posters that are no longer in the list
    P.store.keys().then(function (keys) {
      (keys || []).forEach(function (k) { if (!rows.some(function (r) { return r.id === k; })) P.store.del(k); });
    });
  });

  function getFont(path) {
    return fetch(path).then(function (res) { if (!res.ok) throw new Error(res.status); return res.arrayBuffer(); });
  }
  Promise.all([getFont('posters/fonts/BarlowSemiCondensed-ExtraBold.ttf'), getFont('posters/fonts/BarlowSemiCondensed-Medium.ttf')])
    .then(function (b) {
      engine = new E.Engine(window.POSTER_FONT_DATA, b[0], b[1]);
      var faces = [];
      try {
        faces = [new FontFace('PosterBold', b[0].slice(0)), new FontFace('PosterText', b[1].slice(0))];
        faces.forEach(function (f) { document.fonts.add(f); });
      } catch (e) { faces = []; }
      return Promise.all(faces.map(function (f) { return f.load().catch(function () { return null; }); }));
    })
    .then(function () {
      rows.forEach(paint);
      refreshBar();
      warmSoon();
    })
    .catch(function () { toast("Couldn't load the poster fonts. Check your connection and reload."); });

  // coming back to the page on another day: refresh dates and "checked" times
  document.addEventListener('visibilitychange', function () { if (!document.hidden) rows.forEach(paint); });
})();
