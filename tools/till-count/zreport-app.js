/* Photo Coin Counter's Z report tab, and the switch between its two tabs (Till count and Z report).
   A photo of the card machine's Z report is read on the phone by zreport.js (window.ZReport): the overall end of day
   total and the Worldline TradeUK total go in the two boxes and the answer is one minus the other. Either box can be
   typed in instead. The numbers last while the page is open (sessionStorage, so they survive the phone reloading the
   page after using the camera); the photo is only ever kept in the page's memory and never sent anywhere. The tab's
   Start again clears it all. Everything on the tab has an id starting zr- so nothing clashes with the till count. */
(function () {
  'use strict';

  /* ---------- the two tabs: the last one used opens (or the Z report, for an address ending #z-report) ---------- */
  var TAB_KEY = 'tc-tab';
  function showTab(which, remember) {
    ['till', 'zr'].forEach(function (k) {
      var on = k === which;
      document.getElementById('tab-' + k).setAttribute('aria-selected', on ? 'true' : 'false');
      document.getElementById('pane-' + k).hidden = !on;
    });
    if (!remember) return;
    try { sessionStorage.setItem(TAB_KEY, which); } catch (e) {}
    try { history.replaceState(null, '', which === 'zr' ? '#z-report' : location.pathname + location.search); } catch (e) {}
  }
  var saved = null;
  try { saved = sessionStorage.getItem(TAB_KEY); } catch (e) {}
  showTab(location.hash === '#z-report' || saved === 'zr' ? 'zr' : 'till', false);
  document.getElementById('tab-till').addEventListener('click', function () { showTab('till', true); });
  document.getElementById('tab-zr').addEventListener('click', function () { showTab('zr', true); });

  var Z = window.ZReport, KEY = 'zr-state-v1';
  var READ_SIDE = 2800; // the photo is read at up to this size (long side): plenty for the small print
  var SHOW_SIDE = 1400; // and shown at up to this
  var FIELDS = ['overall', 'trade'], NAMES = { overall: 'Overall', trade: 'TradeUK' };
  var $ = function (id) { return document.getElementById('zr-' + id); }; // everything on the Z report tab is zr-...
  // per number: val (the text in its box), src ('photo' or 'typed'), how ('ok', 'check' or 'missing', from a photo),
  // why (what checked it); photo: in memory only, { show: canvas, crops: {overall, trade}, res }
  var state = {}, photo = null, busy = false;

  /* ---------- money, in whole pence ---------- */
  function parseMoney(text) {
    var t = String(text == null ? '' : text).replace(/[£,\s]/g, ''), neg = false;
    if (!t) return null;
    if (t.charAt(0) === '-' || t.charAt(0) === '−') { neg = true; t = t.slice(1); }
    if (!/^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(t)) return NaN;
    var p = Math.round(parseFloat(t) * 100);
    return neg ? -p : p;
  }
  function money(p) {
    var neg = p < 0, a = Math.abs(Math.round(p)), pounds = Math.floor(a / 100), pp = a % 100;
    return (neg ? '−' : '') + '£' + String(pounds).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + (pp < 10 ? '0' : '') + pp;
  }
  function plain(p) {
    var a = Math.abs(Math.round(p));
    return (p < 0 ? '-' : '') + Math.floor(a / 100) + '.' + (a % 100 < 10 ? '0' : '') + (a % 100);
  }
  function pence(f) { var v = parseMoney(state[f].val); return typeof v === 'number' && isFinite(v) ? v : null; }

  /* ---------- keeping the numbers while the page is open ---------- */
  function load() {
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) {}
    FIELDS.forEach(function (f) {
      var s = (saved && saved[f]) || {};
      state[f] = { val: s.val || '', src: s.src || '', how: s.how || '', why: s.why || '' };
    });
  }
  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  /* ---------- showing it all ---------- */
  function setMsg(text, kind) {
    var m = $('msg');
    m.className = 'zr-msg' + (kind ? ' is-' + kind : '');
    if (kind === 'busy') m.innerHTML = '<span class="zr-spin" aria-hidden="true"></span>' + text; else m.textContent = text;
    m.hidden = !text;
  }

  function render() {
    var o = pence('overall'), t = pence('trade'), net = $('net');
    if (o !== null && t !== null) {
      net.textContent = money(o - t);
      net.className = 'zr-net' + (o - t < 0 ? ' is-neg' : '');
      $('sumOverall').textContent = money(o); $('sumTrade').textContent = money(t);
      $('sumLine').hidden = false; $('emptyLine').hidden = true;
    } else {
      net.textContent = o !== null ? money(o) : '£0.00';
      net.className = 'zr-net is-empty';
      $('sumLine').hidden = true; $('emptyLine').hidden = false;
      $('emptyLine').textContent = o !== null || t !== null
        ? 'Type or photograph the ' + (o === null ? 'overall end of day total' : 'TradeUK total') + ' as well.'
        : 'Photograph the Z report, or type the two numbers below.';
    }
    FIELDS.forEach(function (f) {
      var s = state[f], v = parseMoney(s.val), inp = $('v-' + f), st = $('st-' + f), box = $('f-' + f);
      if (document.activeElement !== inp) inp.value = s.val;
      var text = '', kind = '';
      if (s.val && (typeof v !== 'number' || !isFinite(v))) { text = 'That isn’t an amount: type it like 123.45'; kind = 'check'; }
      else if (s.src === 'photo' && s.how === 'ok') { text = '✓ Checked: ' + s.why; kind = 'ok'; }
      else if (s.src === 'photo' && s.how === 'check') { text = 'Couldn’t check this one against the receipt’s sums: compare it with the receipt.'; kind = 'check'; }
      else if (s.how === 'missing') { text = 'Not found in the photo: type it in.'; kind = 'check'; }
      else if (s.src === 'typed' && s.val) { text = 'Typed in'; }
      st.textContent = text; st.className = 'zr-state' + (kind ? ' is-' + kind : ''); st.hidden = !text;
      box.className = 'zr-field' + (s.src === 'photo' && kind ? ' is-' + kind : '');
      var seen = $('seen-' + f);
      seen.innerHTML = '';
      if (photo && photo.crops[f] && s.src === 'photo') {
        seen.appendChild(photo.crops[f]);
        var lab = document.createElement('span');
        lab.textContent = 'On the receipt';
        seen.appendChild(lab);
        seen.hidden = false;
      } else seen.hidden = true;
    });
    $('photo').hidden = !photo;
    if (photo) drawPhoto();
  }

  /* the photo with the two numbers boxed: green when checked, amber when worth comparing with the receipt */
  function drawPhoto() {
    var cv = $('shot'), src = photo.show, ctx = cv.getContext('2d');
    cv.width = src.width; cv.height = src.height;
    ctx.drawImage(src, 0, 0);
    var res = photo.res, k = photo.k, hpx = res.h / res.scale * k;
    FIELDS.forEach(function (f) {
      var r = res[f];
      if (!r || !r.corners || state[f].src !== 'photo') return;
      var col = state[f].how === 'ok' ? '#22c55e' : '#f59e0b';
      var q = r.corners.map(function (p) { return [p[0] * k, p[1] * k]; });
      var padX = 0.35 * hpx, padY = 0.25 * hpx, line = Math.max(3, hpx * 0.14, cv.width / 260);
      var pts = [[q[0][0] - padX, q[0][1] - padY], [q[1][0] + padX, q[1][1] - padY], [q[2][0] + padX, q[2][1] + padY], [q[3][0] - padX, q[3][1] + padY]];
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath();
      ctx.lineWidth = line * 1.7; ctx.stroke();
      ctx.lineWidth = line; ctx.strokeStyle = col; ctx.stroke();
      // the label above the box (below it when there's no room above)
      var fs = Math.round(Math.max(14, hpx * 0.8, cv.width / 24)), text = NAMES[f];
      ctx.font = '700 ' + fs + 'px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      var tw = ctx.measureText(text).width, bw = tw + fs * 0.8, bh = fs * 1.35;
      var lx = Math.max(2, Math.min(cv.width - bw - 2, pts[0][0])), ly = pts[0][1] - bh - fs * 0.2;
      if (ly < 2) ly = pts[3][1] + fs * 0.2;
      ctx.fillStyle = col;
      roundRect(ctx, lx, ly, bw, bh, bh / 2); ctx.fill();
      ctx.fillStyle = '#0b0d12'; ctx.textBaseline = 'middle';
      ctx.fillText(text, lx + fs * 0.4, ly + bh / 2 + 1);
    });
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }

  /* ---------- reading a photo ---------- */
  function pick(fromGallery) {
    if (busy) return;
    var inp = $(fromGallery ? 'gallery' : 'camera');
    inp.value = '';
    inp.click();
  }
  function rotate(cv, quarter) { // quarter turns clockwise
    var out = document.createElement('canvas'), ctx;
    out.width = quarter % 2 ? cv.height : cv.width; out.height = quarter % 2 ? cv.width : cv.height;
    ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.translate(out.width / 2, out.height / 2); ctx.rotate(quarter * Math.PI / 2); ctx.drawImage(cv, -cv.width / 2, -cv.height / 2);
    return out;
  }
  function attempt(cv) {
    var res = Z.read(cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height));
    res.score = (res.overall && res.overall.pence !== null ? 2 : 0) + (res.trade && res.trade.pence !== null ? 2 : 0) + Math.min(1, (res.rows || []).length / 13);
    return res;
  }
  /* a close-up of where a number was read, so it can be compared with what's in the box */
  function crop(cv, r, hpx) {
    if (!r || !r.corners) return null;
    var xs = r.corners.map(function (p) { return p[0]; }), ys = r.corners.map(function (p) { return p[1]; });
    var x0 = Math.max(0, Math.min.apply(null, xs) - 0.5 * hpx), x1 = Math.min(cv.width, Math.max.apply(null, xs) + 0.5 * hpx);
    var y0 = Math.max(0, Math.min.apply(null, ys) - 0.45 * hpx), y1 = Math.min(cv.height, Math.max.apply(null, ys) + 0.45 * hpx);
    if (x1 - x0 < 4 || y1 - y0 < 4) return null;
    var out = document.createElement('canvas'), H = 92, W = Math.round((x1 - x0) * H / (y1 - y0));
    out.width = W; out.height = H;
    var ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cv, x0, y0, x1 - x0, y1 - y0, 0, 0, W, H);
    out.setAttribute('role', 'img');
    out.setAttribute('aria-label', 'The number as printed on the receipt');
    return out;
  }

  function readPhoto(file) {
    busy = true;
    document.querySelectorAll('[data-zr="camera"], [data-zr="gallery"]').forEach(function (b) { b.disabled = true; });
    setMsg('Reading the receipt…', 'busy');
    var url = URL.createObjectURL(file), img = new Image();
    var done = function () { busy = false; document.querySelectorAll('[data-zr]').forEach(function (b) { b.disabled = false; }); };
    var fail = function (why) { done(); setMsg(why, 'check'); };
    img.onload = function () {
      setTimeout(function () { // let "Reading" show before the phone gets busy
        try {
          var w0 = img.naturalWidth, h0 = img.naturalHeight, s = Math.min(1, READ_SIDE / Math.max(w0, h0));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w0 * s)); cv.height = Math.max(1, Math.round(h0 * s));
          var cx = cv.getContext('2d', { willReadFrequently: true });
          cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
          cx.drawImage(img, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url);
          // upright first; a photo taken sideways or upside down is turned round and read again
          var best = attempt(cv), bestCv = cv, turns = [1, 3, 2], i;
          for (i = 0; i < turns.length && best.score < 4; i++) {
            var rc = rotate(cv, turns[i]), r2 = attempt(rc);
            if (r2.score > best.score) { best = r2; bestCv = rc; }
          }
          use(best, bestCv);
          done();
        } catch (e) { URL.revokeObjectURL(url); fail('That photo couldn’t be read (' + (e && e.message || e) + '). Try again, or type the numbers in.'); }
      }, 60);
    };
    img.onerror = function () { URL.revokeObjectURL(url); fail('That photo couldn’t be opened. Try taking it again, or type the numbers in.'); };
    img.src = url;
  }

  function use(res, cv) {
    var hpx = res.h ? res.h / res.scale : 20;
    var k = Math.min(1, SHOW_SIDE / Math.max(cv.width, cv.height));
    var show = document.createElement('canvas');
    show.width = Math.round(cv.width * k); show.height = Math.round(cv.height * k);
    var sctx = show.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(cv, 0, 0, show.width, show.height);
    photo = { show: show, k: k, res: res, crops: { overall: crop(cv, res.overall, hpx), trade: crop(cv, res.trade, hpx) } };
    FIELDS.forEach(function (f) {
      var r = res[f], s = state[f];
      if (r && r.pence !== null) {
        s.val = plain(r.pence); s.src = 'photo'; s.how = r.sure ? 'ok' : 'check';
        s.why = f === 'overall' && r.adds !== true ? 'the same as the current end of day total above it' : 'Sale + Cashback − Refund on its row adds up to it';
      } else {
        if (s.src === 'photo') s.val = '';
        s.src = s.val ? s.src : ''; s.how = 'missing'; s.why = '';
      }
    });
    var w = res.warn || [], msg = '', kind = 'check';
    var got = FIELDS.filter(function (f) { return res[f] && res[f].pence !== null; });
    if (w.indexOf('nothing') >= 0 || w.indexOf('no-rows') >= 0 || w.indexOf('none') >= 0) {
      msg = 'No numbers found in that photo. Try again with the receipt flat, in good light, filling more of the photo.';
    } else if (w.indexOf('no-overall') >= 0) {
      msg = 'The overall end of day total (the last row on the receipt) isn’t in the photo. Take it again with the bottom of the receipt in.';
    } else if (w.indexOf('no-trade') >= 0) {
      msg = 'The Worldline TradeUK row (just above the two end of day totals) isn’t in the photo. Take it again with more of the receipt in.';
    } else if (!got.length || w.indexOf('unsure') >= 0 || w.indexOf('one-row') >= 0) {
      msg = 'Couldn’t tell which row is which. Take it again straight on, with the bottom half of the receipt in.';
    } else if (got.length === 2 && FIELDS.every(function (f) { return state[f].how === 'ok'; })) {
      msg = '✓ Both numbers found, and both check out against the receipt’s own sums.'; kind = 'good';
    } else if (got.length === 2) {
      msg = 'Both numbers found. Check the amber one against the receipt.';
    }
    setMsg(msg, kind);
    save();
    render();
    if (got.length) $('f-overall').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function removePhoto() {
    photo = null;
    FIELDS.forEach(function (f) { var s = state[f]; if (s.src === 'photo') { s.val = ''; s.src = ''; } s.how = ''; s.why = ''; });
    setMsg('');
    save(); render();
  }
  function reset() {
    photo = null;
    FIELDS.forEach(function (f) { state[f] = { val: '', src: '', how: '', why: '' }; $('v-' + f).value = ''; });
    setMsg('');
    save(); render();
    document.getElementById('tab-zr').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- typing ---------- */
  function onType(inp) {
    var f = inp.getAttribute('data-field'), s = state[f];
    s.val = inp.value.trim(); s.src = s.val ? 'typed' : ''; s.how = ''; s.why = '';
    save(); render();
  }
  function onLeave(inp) { // tidy what was typed: 123.4 -> 123.40
    var f = inp.getAttribute('data-field'), v = parseMoney(state[f].val);
    if (typeof v === 'number' && isFinite(v)) { state[f].val = plain(v); inp.value = state[f].val; save(); render(); }
  }

  load();
  render();
  var page = document.getElementById('pane-zr');
  page.addEventListener('input', function (e) { if (e.target.matches('input[data-field]')) onType(e.target); });
  page.addEventListener('focusout', function (e) { if (e.target.matches('input[data-field]')) onLeave(e.target); });
  page.addEventListener('focusin', function (e) {
    var t = e.target;
    if (t.matches('input[data-field]')) setTimeout(function () { try { t.select(); } catch (x) {} }, 0);
  });
  page.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.matches('input[data-field]')) return;
    e.preventDefault();
    if (e.target.id === 'zr-v-overall') $('v-trade').focus(); else e.target.blur();
  });
  page.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var act = b.getAttribute('data-zr');
    if (act === 'camera') pick(false);
    else if (act === 'gallery') pick(true);
    else if (act === 'remove') removePhoto();
    else if (b.id === 'reset') reset();
  });
  ['camera', 'gallery'].forEach(function (k) {
    $(k).addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) readPhoto(f);
    });
  });
})();
