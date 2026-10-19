/* Till Count page. Notes take a value. Coins take a value, a number of coins, or a photo of the pile:
   whichever was changed last wins and the other box follows it. The float (£50 or £75, remembered on this
   phone) is taken off the grand total. Counts last while the page is open (sessionStorage, so they survive
   the phone reloading the page after using the camera); Start again clears them. Photos are only ever kept
   in the page's memory. The coin reader is coins.js (window.CoinCount), the sums money.js (window.TillMoney). */
(function () {
  'use strict';
  var M = window.TillMoney, CC = window.CoinCount;
  var STATE_KEY = 'tc-state-v1', FLOAT_KEY = 'tc-float-v1', MAX_SIDE = 1600;
  var $ = function (id) { return document.getElementById(id); };
  var ALL = M.NOTES.concat(M.COINS), byId = {};
  ALL.forEach(function (d) { byId[d.id] = d; });
  var isNote = function (d) { return d.id.charAt(0) === 'n'; };

  /* per row: val (text in the £ box), cnt (text in the coins box), src (which box or the photo set it last),
     photo (memory only: the photo and its circles), busy (reading a photo) */
  var rows = {}, floatP = 7500, photoFor = null;

  function load() {
    try { var f = parseInt(localStorage.getItem(FLOAT_KEY), 10); if (M.FLOATS.indexOf(f) >= 0) floatP = f; } catch (e) {}
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null'); } catch (e) {}
    ALL.forEach(function (d) {
      var s = (saved && saved[d.id]) || {};
      rows[d.id] = { val: s.val || '', cnt: s.cnt || '', src: s.src || '', photo: null, busy: false };
    });
  }
  function save() {
    var out = {};
    ALL.forEach(function (d) { var r = rows[d.id]; if (r.val || r.cnt) out[d.id] = { val: r.val, cnt: r.cnt, src: r.src }; });
    try { sessionStorage.setItem(STATE_KEY, JSON.stringify(out)); } catch (e) {}
  }

  /* what a row adds to the total, in pence (null when empty or not a sensible amount) */
  function rowPence(d) {
    var r = rows[d.id], v;
    if (isNote(d) || r.src === 'value') { v = M.parseMoney(r.val); return typeof v === 'number' && isFinite(v) ? v : null; }
    v = M.parseCount(r.cnt);
    return typeof v === 'number' && isFinite(v) ? v * d.p : null;
  }

  /* ---------- building the rows ---------- */
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  var CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  var PIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';
  var METAL = { c200: 'bi2', c100: 'bi1', c50: 'silver', c20: 'silver', c10: 'silver', c5: 'silver', c2: 'copper', c1: 'copper' };

  function noteRow(d) {
    var row = el('div', { class: 'tc-row tc-noterow', id: 'row-' + d.id });
    row.appendChild(el('span', { class: 'tc-chip tc-note ' + d.id, 'aria-hidden': 'true' }, d.label));
    var box = el('label', { class: 'tc-box tc-money' }, '<span>£</span>');
    box.appendChild(el('input', { id: 'v-' + d.id, 'data-id': d.id, 'data-kind': 'val', inputmode: 'decimal', enterkeyhint: 'next', autocomplete: 'off', placeholder: '0.00', 'aria-label': 'Value of ' + d.label + ' notes' }));
    row.appendChild(box);
    row.appendChild(el('span', { class: 'tc-side', id: 's-' + d.id }));
    row.appendChild(el('p', { class: 'tc-msg', id: 'm-' + d.id, hidden: '' }));
    return row;
  }

  function coinRow(d) {
    var row = el('div', { class: 'tc-row tc-coinrow', id: 'row-' + d.id });
    row.appendChild(el('span', { class: 'tc-chip tc-coin ' + METAL[d.id], 'aria-hidden': 'true' }, '<span>' + d.label + '</span>'));
    var box = el('label', { class: 'tc-box tc-money' }, '<span>£</span>');
    box.appendChild(el('input', { id: 'v-' + d.id, 'data-id': d.id, 'data-kind': 'val', inputmode: 'decimal', enterkeyhint: 'next', autocomplete: 'off', placeholder: '0.00', 'aria-label': 'Value of ' + d.label + ' coins' }));
    row.appendChild(box);
    var cbox = el('label', { class: 'tc-box tc-count' });
    cbox.appendChild(el('input', { id: 'c-' + d.id, 'data-id': d.id, 'data-kind': 'cnt', inputmode: 'numeric', enterkeyhint: 'next', autocomplete: 'off', placeholder: '0', 'aria-label': 'Number of ' + d.label + ' coins' }));
    cbox.appendChild(el('span', null, 'coins'));
    row.appendChild(cbox);
    var acts = el('div', { class: 'tc-acts' });
    acts.appendChild(el('button', { type: 'button', class: 'tc-cam', 'data-id': d.id, 'data-act': 'camera' }, CAM + '<span>Take photo</span>'));
    acts.appendChild(el('button', { type: 'button', class: 'tc-gal', 'data-id': d.id, 'data-act': 'gallery' }, PIC + '<span>Choose photo</span>'));
    row.appendChild(acts);
    row.appendChild(el('p', { class: 'tc-msg', id: 'm-' + d.id, hidden: '' }));
    row.appendChild(el('div', { class: 'tc-photo', id: 'p-' + d.id, hidden: '' }));
    return row;
  }

  /* ---------- typing ---------- */
  function onType(input) {
    var d = byId[input.getAttribute('data-id')], r = rows[d.id], kind = input.getAttribute('data-kind'), v, c;
    if (kind === 'val') {
      r.val = input.value;
      if (isNote(d)) { r.src = r.val ? 'value' : ''; }
      else {
        v = M.parseMoney(r.val);
        if (v === null) { r.cnt = ''; r.src = ''; }
        else if (isFinite(v)) { c = M.countOf(v, d.p); r.cnt = String(c.count); r.src = 'value'; }
        else { r.cnt = ''; r.src = 'value'; }
        $('c-' + d.id).value = r.cnt;
      }
    } else {
      r.cnt = input.value;
      c = M.parseCount(r.cnt);
      if (c === null) { r.val = ''; r.src = ''; }
      else if (isFinite(c)) { r.val = M.plain(c * d.p); r.src = 'count'; }
      else { r.val = ''; r.src = 'count'; }
      $('v-' + d.id).value = r.val;
    }
    update(d);
  }

  /* tidy a typed amount when leaving the box: 9.6 -> 9.60 */
  function onLeave(input) {
    if (input.getAttribute('data-kind') !== 'val') return;
    var d = byId[input.getAttribute('data-id')], r = rows[d.id], v = M.parseMoney(r.val);
    if (typeof v === 'number' && isFinite(v) && (isNote(d) || r.src === 'value')) { r.val = M.plain(v); input.value = r.val; save(); }
  }

  /* the line under a row: a hint, or what's wrong with what was typed */
  function rowMessage(d) {
    var r = rows[d.id], v, c, side = '', msg = '';
    if (r.busy) return { msg: '<span class="tc-spin" aria-hidden="true"></span>Counting the coins in your photo…', busy: true };
    if (isNote(d)) {
      v = M.parseMoney(r.val);
      if (typeof v === 'number' && isNaN(v)) msg = 'Type an amount, like 40.00';
      else if (v) {
        c = M.countOf(v, d.p);
        if (!c.whole) msg = M.money(v) + ' isn’t a whole number of ' + d.label + ' notes';
        else side = c.count + (c.count === 1 ? ' note' : ' notes');
      }
      return { msg: msg, side: side };
    }
    if (r.src === 'value') {
      v = M.parseMoney(r.val);
      if (isNaN(v)) msg = 'Type an amount, like 9.60';
      else if (v && !M.countOf(v, d.p).whole) msg = M.money(v) + ' isn’t a whole number of ' + d.label + ' coins';
    } else if (r.src === 'count' && isNaN(M.parseCount(r.cnt))) msg = 'Whole coins only, like 48';
    return { msg: msg };
  }

  function update(d, skipSave) {
    var m = rowMessage(d), box = $('m-' + d.id);
    box.innerHTML = m.msg || '';
    box.hidden = !m.msg;
    box.classList.toggle('is-busy', !!m.busy);
    if (isNote(d)) $('s-' + d.id).textContent = m.side || '';
    else if (rows[d.id].photo) photoText(d);
    $('row-' + d.id).classList.toggle('has-value', !!rowPence(d));
    totals();
    if (!skipSave) save();
  }

  function totals() {
    var pence = {};
    ALL.forEach(function (d) { pence[d.id] = rowPence(d); });
    var t = M.totals(pence, floatP), empty = t.gross === 0;
    // nothing counted yet: show £0.00 rather than minus the float
    $('net').textContent = M.money(empty ? 0 : t.net);
    $('net').classList.toggle('is-neg', !empty && t.net < 0);
    $('net').classList.toggle('is-empty', empty);
    $('grossLine').hidden = empty; $('emptyLine').hidden = !empty;
    $('gross').textContent = M.money(t.gross);
    $('floatTxt').textContent = M.money(floatP); $('floatTxt2').textContent = M.money(floatP);
    $('notesTotal').textContent = M.money(t.notes);
    $('coinsTotal').textContent = M.money(t.coins);
  }

  function setFloat(p) {
    floatP = p;
    try { localStorage.setItem(FLOAT_KEY, String(p)); } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('.tc-float button'), function (b) {
      b.setAttribute('aria-checked', String(+b.getAttribute('data-float') === p));
    });
    totals();
  }

  /* ---------- photos ---------- */
  function pick(id, fromGallery) {
    photoFor = id;
    var inp = $(fromGallery ? 'gallery' : 'camera');
    inp.value = '';
    inp.click();
  }

  function countPhoto(id, file) {
    var d = byId[id], r = rows[id], url = URL.createObjectURL(file), img = new Image();
    r.busy = true; update(d, true);
    var fail = function (why) { r.busy = false; update(d, true); var b = $('m-' + id); b.textContent = why; b.hidden = false; };
    img.onload = function () {
      setTimeout(function () { // let "Counting…" show before the phone gets busy
        try {
          var w0 = img.naturalWidth, h0 = img.naturalHeight, s = Math.min(1, MAX_SIDE / Math.max(w0, h0));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w0 * s)); cv.height = Math.max(1, Math.round(h0 * s));
          var cx = cv.getContext('2d', { willReadFrequently: true });
          cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
          cx.drawImage(img, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url);
          var res = CC.detect(cx.getImageData(0, 0, cv.width, cv.height));
          var marks = res.coins.map(function (c) { return { x: c.x, y: c.y, r: c.r, flag: c.flag || '', state: 'on' }; })
            .concat(res.maybe.map(function (c) { return { x: c.x, y: c.y, r: c.r, flag: '', state: 'maybe' }; }));
          r.photo = { img: cv, unit: res.unit || Math.min(cv.width, cv.height) * 0.04, warn: res.warn, marks: marks, found: res.coins.length };
          r.busy = false;
          fromPhoto(d);
          showPhoto(d);
        } catch (e) { URL.revokeObjectURL(url); fail('That photo couldn’t be read (' + (e && e.message || e) + '). Try again, or type the number of coins.'); }
      }, 60);
    };
    img.onerror = function () { URL.revokeObjectURL(url); fail('That photo couldn’t be opened. Try taking it again, or type the number of coins.'); };
    img.src = url;
  }

  function counted(ph) { return ph.marks.filter(function (m) { return m.state === 'on' || m.state === 'added'; }); }

  /* the photo's count goes in the boxes */
  function fromPhoto(d) {
    var r = rows[d.id], n = counted(r.photo).length;
    r.cnt = String(n); r.val = M.plain(n * d.p); r.src = 'photo';
    $('c-' + d.id).value = r.cnt; $('v-' + d.id).value = r.val;
    update(d);
  }

  /* numbers go in reading order: rows from the top, left to right */
  function order(list, unit) {
    var rws = [], out = [];
    list.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (m) {
      var row = rws[rws.length - 1];
      if (row && Math.abs(m.y - row.y) < unit * 0.9) { row.items.push(m); row.y = row.items.reduce(function (s, i) { return s + i.y; }, 0) / row.items.length; }
      else rws.push({ y: m.y, items: [m] });
    });
    rws.forEach(function (row) { row.items.sort(function (a, b) { return a.x - b.x; }).forEach(function (m) { out.push(m); }); });
    return out;
  }

  var COL = { ok: '#22c55e', check: '#f59e0b', added: '#3b82f6', off: 'rgba(175,180,190,.95)' };
  function colourOf(m) { return m.state === 'added' ? COL.added : m.flag ? COL.check : COL.ok; }

  function draw(d) {
    var ph = rows[d.id].photo, cv = ph.view, ctx = cv.getContext('2d');
    if (cv.width !== ph.img.width || cv.height !== ph.img.height) { cv.width = ph.img.width; cv.height = ph.img.height; }
    ctx.drawImage(ph.img, 0, 0);
    var u = ph.unit, lw = Math.max(2.5, Math.min(10, u * 0.09)), fs = Math.max(12, Math.min(64, u * 0.78));
    ctx.lineCap = 'round';
    ph.marks.forEach(function (m) {
      if (m.state !== 'off' && m.state !== 'maybe') return;
      ctx.setLineDash([lw * 2.2, lw * 1.8]);
      ring(ctx, m, lw, COL.off);
    });
    ctx.setLineDash([]);
    order(counted(ph), u).forEach(function (m, i) {
      ring(ctx, m, lw, colourOf(m));
      ctx.font = '700 ' + fs + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = fs * 0.2; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineJoin = 'round';
      ctx.strokeText(String(i + 1), m.x, m.y);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(i + 1), m.x, m.y);
    });
  }
  function ring(ctx, m, lw, colour) {
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.lineWidth = lw + 2.5; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
    ctx.lineWidth = lw; ctx.strokeStyle = colour; ctx.stroke();
  }

  function showPhoto(d) {
    var box = $('p-' + d.id), ph = rows[d.id].photo;
    box.innerHTML = '';
    ph.view = el('canvas', { class: 'tc-shot', role: 'img', 'aria-label': 'Your photo with a numbered circle on each coin counted' });
    ph.view.addEventListener('click', function (e) { tap(d, e); });
    box.appendChild(ph.view);
    box.appendChild(el('p', { class: 'tc-photo-sum', id: 'ps-' + d.id }));
    box.appendChild(el('ul', { class: 'tc-key', id: 'pk-' + d.id }));
    box.appendChild(el('p', { class: 'tc-photo-help' }, 'Something wrong? Tap a circle to take it off, or tap a coin it missed to add it.'));
    var acts = el('div', { class: 'tc-photo-acts' });
    acts.appendChild(el('button', { type: 'button', 'data-id': d.id, 'data-act': 'camera' }, CAM + '<span>Retake</span>'));
    acts.appendChild(el('button', { type: 'button', 'data-id': d.id, 'data-act': 'remove' }, 'Remove photo'));
    box.appendChild(acts);
    box.hidden = false;
    draw(d);
    photoText(d);
  }

  function photoText(d) {
    var r = rows[d.id], ph = r.photo, sum = $('ps-' + d.id), key = $('pk-' + d.id);
    if (!sum) return;
    var on = counted(ph), n = on.length, amber = on.filter(function (m) { return m.state === 'on' && m.flag; }).length;
    var added = on.filter(function (m) { return m.state === 'added'; }).length;
    var off = ph.marks.filter(function (m) { return m.state === 'off'; }).length, maybe = ph.marks.filter(function (m) { return m.state === 'maybe'; }).length;
    var lines = [];
    if (!ph.found && !added) lines.push('<b>No coins found.</b> Try again with the coins on a plain surface, spread out, and the photo taken from straight above.');
    else lines.push('<b>' + n + ' ' + d.label + (n === 1 ? ' coin' : ' coins') + '</b> counted, ' + M.money(n * d.p));
    if (amber) lines.push(amber + ' in amber ' + (amber === 1 ? 'is' : 'are') + ' counted but worth a look: a different size, partly hidden or on top of another coin.');
    if (added || off) lines.push([added ? added + ' added by you' : '', off ? off + ' taken off by you' : ''].filter(Boolean).join(', ') + '.');
    if (maybe) lines.push(maybe + ' grey dashed ' + (maybe === 1 ? 'one looks' : 'ones look') + ' a bit like a coin but ' + (maybe === 1 ? 'isn’t' : 'aren’t') + ' counted. Tap to count it.');
    if (ph.warn.indexOf('small') >= 0 && ph.found) lines.push('The coins look small in this photo. If any are missed, take it again a bit closer.');
    if (r.src !== 'photo') lines.push('<i>You’ve typed a different amount since, so the boxes don’t come from this photo now.</i>');
    sum.innerHTML = lines.join('<br>');
    var keys = [];
    if (on.some(function (m) { return m.state === 'on' && !m.flag; })) keys.push(['ok', 'Counted']);
    if (amber) keys.push(['check', 'Counted, worth a look']);
    if (added) keys.push(['added', 'Added by you']);
    if (off || maybe) keys.push(['off', 'Not counted']);
    key.innerHTML = keys.map(function (k) { return '<li><i class="k-' + k[0] + '"></i>' + k[1] + '</li>'; }).join('');
  }

  /* tap a circle to take it off (or put it back), a grey one to count it, or anywhere else to add a coin */
  function tap(d, e) {
    var ph = rows[d.id].photo, cv = ph.view, rect = cv.getBoundingClientRect();
    var sx = cv.width / rect.width, x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sx;
    var best = -1, bd = Infinity;
    ph.marks.forEach(function (m, i) { var dd = Math.hypot(m.x - x, m.y - y); if (dd < m.r && dd < bd) { bd = dd; best = i; } });
    if (best >= 0) {
      var m = ph.marks[best];
      if (m.state === 'on') m.state = 'off';
      else if (m.state === 'off') m.state = 'on';
      else if (m.state === 'maybe') m.state = 'added';
      else ph.marks.splice(best, 1); // one added by mistake
    } else ph.marks.push({ x: x, y: y, r: ph.unit, flag: '', state: 'added' });
    draw(d);
    fromPhoto(d);
  }

  function removePhoto(d) {
    var r = rows[d.id];
    r.photo = null;
    var box = $('p-' + d.id); box.innerHTML = ''; box.hidden = true;
    if (r.src === 'photo') { r.val = ''; r.cnt = ''; r.src = ''; $('v-' + d.id).value = ''; $('c-' + d.id).value = ''; }
    update(d);
  }

  function reset() {
    if (!window.confirm('Clear every note, coin and photo?')) return;
    ALL.forEach(function (d) {
      rows[d.id] = { val: '', cnt: '', src: '', photo: null, busy: false };
      $('v-' + d.id).value = '';
      if (!isNote(d)) { $('c-' + d.id).value = ''; var box = $('p-' + d.id); box.innerHTML = ''; box.hidden = true; }
      update(d, true);
    });
    try { sessionStorage.removeItem(STATE_KEY); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- start ---------- */
  load();
  M.NOTES.forEach(function (d) { $('notes').appendChild(noteRow(d)); });
  M.COINS.forEach(function (d) { $('coins').appendChild(coinRow(d)); });
  ALL.forEach(function (d) {
    var r = rows[d.id];
    $('v-' + d.id).value = r.val;
    if (!isNote(d)) $('c-' + d.id).value = r.cnt;
    update(d, true);
  });
  setFloat(floatP);

  var page = document.querySelector('.tc');
  page.addEventListener('input', function (e) { if (e.target.matches('input[data-id]')) onType(e.target); });
  page.addEventListener('focusout', function (e) { if (e.target.matches('input[data-id]')) onLeave(e.target); });
  page.addEventListener('focusin', function (e) { // easier to type over what's there
    var t = e.target;
    if (t.matches('input[data-id]')) setTimeout(function () { try { t.select(); } catch (x) {} }, 0);
  });
  page.addEventListener('keydown', function (e) { // Enter / Next moves to the next box
    if (e.key !== 'Enter' || !e.target.matches('input[data-id]')) return;
    e.preventDefault();
    var all = Array.prototype.slice.call(document.querySelectorAll('input[data-id]')), i = all.indexOf(e.target);
    if (all[i + 1]) all[i + 1].focus(); else e.target.blur();
  });
  page.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (b.hasAttribute('data-float')) setFloat(+b.getAttribute('data-float'));
    else if (act === 'camera') pick(id, false);
    else if (act === 'gallery') pick(id, true);
    else if (act === 'remove') removePhoto(byId[id]);
    else if (b.id === 'reset') reset();
  });
  ['camera', 'gallery'].forEach(function (k) {
    $(k).addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f && photoFor) countPhoto(photoFor, f);
    });
  });
})();
