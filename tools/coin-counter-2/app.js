/* Photo Coin Counter 2 page. Each photo of mixed coins is read by mixed.js (window.MixedCoins): every coin is
   found and worked out. Tap a coin to say what it is (the coins round it follow: one coin you're sure of fixes
   the sizes for the rest), or tap one it missed to add it. Photos add together into one total. Counts last
   while the page is open (sessionStorage, so they survive the phone reloading the page after the camera); the
   photos themselves are only ever kept in the page's memory. */
(function () {
  'use strict';
  var MC = window.MixedCoins, COINS = MC.COINS, BY = MC.BY;
  var KEY = 'cc2-state-v1', MAX_SIDE = 2000;
  var COL = { ok: '#22c55e', check: '#f59e0b', set: '#3b82f6', off: 'rgba(175,180,190,.95)' };
  var $ = function (id) { return document.getElementById(id); };
  var photos = [], nextNo = 1, busy = false, picking = null;

  /* 123456 -> '£1,234.56' */
  function money(p) {
    p = Math.round(p);
    var s = String(Math.floor(p / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ','), pp = p % 100;
    return '£' + s + '.' + (pp < 10 ? '0' : '') + pp;
  }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function chip(id) { var d = BY[id]; return '<span class="c2-coin ' + d.metal + ' ' + id + '" aria-hidden="true">' + d.label + '</span>'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* ---------- counting ---------- */
  function counted(ph) { return ph.coins.filter(function (c) { return c.state === 'on' || c.state === 'added'; }); }
  function countsOf(ph) {
    if (ph.gone) return ph.counts;
    var out = {};
    counted(ph).forEach(function (c) { out[c.coin] = (out[c.coin] || 0) + 1; });
    return out;
  }
  function valueOf(counts) { var v = 0; Object.keys(counts).forEach(function (k) { v += counts[k] * BY[k].p; }); return v; }
  function numberOf(counts) { var n = 0; Object.keys(counts).forEach(function (k) { n += counts[k]; }); return n; }
  function waiting(ph) { return ph.gone ? ph.wait : !!ph.ask; }
  function listOf(counts) {
    return COINS.filter(function (d) { return counts[d.id]; }).map(function (d) { return counts[d.id] + ' × ' + d.label; }).join(', ');
  }

  /* what the photo would come to with the question answered one way */
  function totalIf(ph, id) {
    var copy = ph.coins.map(function (c) { var o = {}; for (var k in c) o[k] = c[k]; return o; });
    copy[ph.ask.coin].set = id; copy[ph.ask.coin].coin = id;
    MC.solve(copy);
    return valueOf(countsOf({ coins: copy }));
  }

  function save() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ next: nextNo, photos: photos.map(function (ph) {
        return { no: ph.no, counts: countsOf(ph), wait: waiting(ph) };
      }) }));
    } catch (e) {}
  }
  function load() {
    var s = null;
    try { s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (!s || !s.photos) return;
    nextNo = s.next || 1;
    s.photos.forEach(function (p) { photos.push({ no: p.no, gone: true, counts: p.counts || {}, wait: !!p.wait, coins: [] }); });
  }

  /* ---------- the total and the list of coins ---------- */
  function totals() {
    var all = {};
    photos.forEach(function (ph) { var c = countsOf(ph); Object.keys(c).forEach(function (k) { all[k] = (all[k] || 0) + c[k]; }); });
    var n = numberOf(all), v = valueOf(all), wait = photos.filter(waiting);
    $('net').innerHTML = money(v) + (wait.length ? '<small>?</small>' : '');
    $('net').classList.toggle('is-empty', !n);
    $('totalLine').innerHTML = n ? '<b>' + plural(n, 'coin', 'coins') + '</b> from <b>' + plural(photos.length, 'photo', 'photos') + '</b>' : 'Nothing counted yet.';
    $('waitLine').textContent = wait.length ? 'Answer the question on photo ' + wait.map(function (p) { return p.no; }).join(' and ') + ' to finish.' : '';
    $('waitLine').hidden = !wait.length;
    $('sumBox').hidden = !n;
    $('coinsTotal').textContent = money(v);
    $('sum').innerHTML = COINS.filter(function (d) { return all[d.id]; }).map(function (d) {
      return '<div class="c2-row">' + chip(d.id) + '<div><b>' + d.label + '</b> <span>× ' + all[d.id] + '</span></div><output>' + money(all[d.id] * d.p) + '</output></div>';
    }).join('');
    $('camLabel').textContent = photos.length ? 'Add a photo' : 'Take photo';
    save();
  }

  /* ---------- a photo ---------- */
  function ring(ctx, x, y, r, lw, colour) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = lw + 2.5; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
    ctx.lineWidth = lw; ctx.strokeStyle = colour; ctx.stroke();
  }
  function draw(ph) {
    var cv = ph.view, ctx = cv.getContext('2d');
    if (cv.width !== ph.img.width || cv.height !== ph.img.height) { cv.width = ph.img.width; cv.height = ph.img.height; }
    ctx.drawImage(ph.img, 0, 0);
    var rs = ph.coins.map(function (c) { return c.r; }).sort(function (a, b) { return a - b; });
    var u = rs.length ? rs[rs.length >> 1] : Math.min(cv.width, cv.height) * 0.04, lw = Math.max(2.5, Math.min(10, u * 0.09));
    var ref = ph.ask && !ph.ask.all ? ph.coins[ph.ask.coin] : null;
    ctx.lineCap = 'round';
    ph.coins.forEach(function (c) {
      if (c.state !== 'off' && c.state !== 'maybe') return;
      ctx.setLineDash([lw * 2.2, lw * 1.8]);
      ring(ctx, c.x, c.y, c.r, lw, COL.off);
    });
    ctx.setLineDash([]);
    counted(ph).forEach(function (c) {
      ring(ctx, c.x, c.y, c.r, lw, c.set ? COL.set : MC.unsure(c) ? COL.check : COL.ok);
      var fs = Math.max(12, Math.min(72, c.r * 0.62)), text = c === ref ? '?' : BY[c.coin].label;
      ctx.font = '800 ' + fs + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = fs * 0.2; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineJoin = 'round';
      ctx.strokeText(text, c.x, c.y);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, c.x, c.y);
    });
    if (ref) {
      ctx.setLineDash([lw * 2, lw * 1.4]);
      ring(ctx, ref.x, ref.y, ref.r + lw * 2.4, lw, '#fff');
      ctx.setLineDash([]);
    }
  }

  function askBox(ph) {
    var box = ph.askEl;
    if (!ph.ask) { box.hidden = true; box.innerHTML = ''; return; }
    var o = ph.ask.options, a = BY[o[0]].label, b = BY[o[1]].label;
    var lead = ph.ask.all
      ? '<b>Are these ' + a + ' or ' + b + ' coins?</b> They’re all one kind, and with no other kind of coin in the photo to compare sizes with, a ' + a + ' and a ' + b + ' look the same.'
      : '<b>Is the coin marked ? a ' + a + ' or a ' + b + '?</b> The coins fit two ways, and that one answer sorts out the rest.';
    box.innerHTML = '<p>' + lead + '</p><div>' + o.map(function (id) {
      return '<button type="button" data-answer="' + id + '">' + chip(id) + BY[id].label + ' <span class="c2-if">' + money(totalIf(ph, id)) + '</span></button>';
    }).join('') + '</div>';
    box.hidden = false;
  }

  function photoText(ph) {
    var counts = countsOf(ph), n = numberOf(counts), on = counted(ph), lines = [];
    var amber = on.filter(function (c) { return !c.set && MC.unsure(c); }).length;
    var mine = on.filter(function (c) { return c.set; }).length;
    var off = ph.coins.filter(function (c) { return c.state === 'off'; }).length, maybe = ph.coins.filter(function (c) { return c.state === 'maybe'; }).length;
    if (!n) lines.push('<b>No coins found.</b> Try again with the coins flat on a plain surface, spread out, and the photo taken from straight above.');
    else lines.push('<b>' + plural(n, 'coin', 'coins') + ', ' + money(valueOf(counts)) + '</b>: ' + listOf(counts));
    if (amber && !ph.ask) lines.push(amber + ' in amber ' + (amber === 1 ? 'is' : 'are') + ' worth a look. Tap one to change it.');
    if (mine) lines.push(mine + ' set by you' + (off ? ', ' + off + ' taken off' : '') + '.');
    else if (off) lines.push(off + ' taken off by you.');
    if (maybe) lines.push(maybe + ' grey dashed ' + (maybe === 1 ? 'one looks' : 'ones look') + ' a bit like a coin but ' + (maybe === 1 ? 'isn’t' : 'aren’t') + ' counted. Tap one to count it.');
    if (ph.res && ph.res.warn.indexOf('small') >= 0 && n) lines.push('The coins look small in this photo. Take it a bit closer if it gets any wrong.');
    ph.sumEl.innerHTML = lines.join('<br>');
    var keys = [];
    if (on.some(function (c) { return !c.set && !MC.unsure(c); })) keys.push(['ok', 'Sure']);
    if (amber) keys.push(['check', 'Worth a look']);
    if (mine) keys.push(['set', 'Set by you']);
    if (off || maybe) keys.push(['off', 'Not counted']);
    ph.keyEl.innerHTML = keys.map(function (k) { return '<li><i class="k-' + k[0] + '"></i>' + k[1] + '</li>'; }).join('');
  }

  function refresh(ph) {
    var counts = countsOf(ph);
    ph.headOut.innerHTML = money(valueOf(counts)) + (waiting(ph) ? '?' : '');
    if (!ph.gone) { draw(ph); askBox(ph); photoText(ph); }
    totals();
  }

  /* work the coins out again after a change: the ones you've set stay put and pin the sizes for the rest */
  function resolve(ph) {
    var s = MC.solve(ph.coins);
    ph.ask = s.ask;
    if (s.scale) ph.res.scale = s.scale;
    refresh(ph);
  }

  function card(ph) {
    var box = el('section', { class: 'c2-photo', 'data-no': ph.no });
    box.innerHTML = '<div class="c2-photo-head"><h3>Photo ' + ph.no + '</h3><output></output></div>';
    if (ph.gone) {
      box.appendChild(el('p', { class: 'c2-gone' }, (numberOf(ph.counts) ? '<b>' + plural(numberOf(ph.counts), 'coin', 'coins') + '</b>: ' + listOf(ph.counts) + '. ' : '') +
        'The page reloaded, so the photo itself has gone, but its count is kept.' + (ph.wait ? ' It was still waiting for an answer, so take it again to be sure.' : '')));
    } else {
      ph.askEl = el('div', { class: 'c2-ask', hidden: '' });
      box.appendChild(ph.askEl);
      ph.view = el('canvas', { class: 'c2-shot', role: 'img', 'aria-label': 'Your photo with each coin it found marked with what it is' });
      ph.view.addEventListener('click', function (e) { tap(ph, e); });
      box.appendChild(ph.view);
      ph.sumEl = el('p', { class: 'c2-photo-sum' });
      box.appendChild(ph.sumEl);
      ph.keyEl = el('ul', { class: 'c2-key' });
      box.appendChild(ph.keyEl);
      box.appendChild(el('p', { class: 'c2-help' }, 'Tap a coin to change what it is, or tap a coin it missed to add it.'));
    }
    var acts = el('div', { class: 'c2-photo-acts' });
    acts.appendChild(el('button', { type: 'button', 'data-remove': String(ph.no) }, 'Remove photo'));
    box.appendChild(acts);
    ph.box = box; ph.headOut = box.querySelector('output');
    $('photos').appendChild(box);
    refresh(ph);
  }

  /* ---------- reading a photo ---------- */
  function message(html, bad) { var m = $('msg'); m.innerHTML = html || ''; m.hidden = !html; m.classList.toggle('is-bad', !!bad); }
  function setBusy(on) {
    busy = on;
    Array.prototype.forEach.call(document.querySelectorAll('.c2-acts button'), function (b) { b.disabled = on; });
  }
  function readPhoto(file) {
    setBusy(true);
    message('<span class="c2-spin" aria-hidden="true"></span>Working out the coins in your photo…');
    var url = URL.createObjectURL(file), img = new Image();
    var fail = function (why) { URL.revokeObjectURL(url); setBusy(false); message(why, true); };
    img.onload = function () {
      setTimeout(function () { // let the message show before the phone gets busy
        try {
          var w0 = img.naturalWidth, h0 = img.naturalHeight, s = Math.min(1, MAX_SIDE / Math.max(w0, h0));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w0 * s)); cv.height = Math.max(1, Math.round(h0 * s));
          var cx = cv.getContext('2d', { willReadFrequently: true });
          cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
          cx.drawImage(img, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url);
          var res = MC.read(cx.getImageData(0, 0, cv.width, cv.height));
          var ph = { no: nextNo++, img: cv, res: res, ask: res.ask,
            coins: res.coins.concat(res.maybe.map(function (m) { return { x: m.x, y: m.y, r: m.r, state: 'maybe' }; })) };
          photos.push(ph);
          setBusy(false); message('');
          card(ph);
          ph.box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { fail('That photo couldn’t be read (' + (e && e.message || e) + '). Try taking it again.'); }
      }, 60);
    };
    img.onerror = function () { fail('That photo couldn’t be opened. Try taking it again.'); };
    img.src = url;
  }

  /* ---------- tapping the photo ---------- */
  function tap(ph, e) {
    var cv = ph.view, rect = cv.getBoundingClientRect(), sx = cv.width / rect.width;
    var x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sx, best = -1, bd = Infinity;
    ph.coins.forEach(function (c, i) { var d = Math.hypot(c.x - x, c.y - y); if (d < c.r && d < bd) { bd = d; best = i; } });
    openPicker(ph, best >= 0 ? best : null, x, y);
  }
  function openPicker(ph, i, x, y) {
    picking = { ph: ph, i: i, x: x, y: y };
    var c = i == null ? null : ph.coins[i], cur = c && (c.state === 'on' || c.state === 'added') ? c.coin : null;
    $('sheetTitle').textContent = !c ? 'Add a coin here. Which is it?' : c.state === 'on' || c.state === 'added' ? 'Which coin is this?' : 'Count this one? Which coin is it?';
    $('pick').innerHTML = COINS.map(function (d) {
      return '<button type="button" data-coin="' + d.id + '" aria-pressed="' + (d.id === cur) + '">' + chip(d.id) + '<span>' + d.label + '</span></button>';
    }).join('');
    $('notCoin').hidden = !cur;
    $('sheet').hidden = false;
  }
  function closePicker() { $('sheet').hidden = true; var p = picking; picking = null; return p; }
  function choose(id) {
    var p = closePicker();
    if (!p) return;
    var ph = p.ph, c = p.i == null ? null : ph.coins[p.i];
    if (!c) ph.coins.push({ x: p.x, y: p.y, r: MC.radiusFor(ph.res, id, p.x, p.y), state: 'added', coin: id, set: id });
    else if (id === 'off') { if (c.state === 'added') ph.coins.splice(p.i, 1); else { c.state = 'off'; delete c.set; } }
    else { c.set = id; c.coin = id; if (c.state === 'off' || c.state === 'maybe') c.state = c.f ? 'on' : 'added'; }
    resolve(ph);
  }

  function remove(no) {
    var i = photos.findIndex(function (p) { return p.no === no; });
    if (i < 0) return;
    photos[i].box.remove();
    photos.splice(i, 1);
    totals();
  }
  function reset() {
    if (photos.length && !window.confirm('Clear every photo and count?')) return;
    photos.forEach(function (p) { p.box.remove(); });
    photos = []; nextNo = 1;
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    message('');
    totals();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- start ---------- */
  load();
  photos.forEach(card);
  totals();
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) { if (e.target === $('sheet')) closePicker(); return; }
    var act = b.getAttribute('data-act');
    if (act && !busy) { var inp = $(act === 'gallery' ? 'gallery' : 'camera'); inp.value = ''; inp.click(); }
    else if (b.hasAttribute('data-remove')) remove(+b.getAttribute('data-remove'));
    else if (b.hasAttribute('data-answer')) {
      var no = +b.closest('.c2-photo').getAttribute('data-no'), ph = photos.filter(function (p) { return p.no === no; })[0];
      if (ph && ph.ask) { var ref = ph.coins[ph.ask.coin], id = b.getAttribute('data-answer'); ref.set = id; ref.coin = id; resolve(ph); }
    }
    else if (b.hasAttribute('data-coin')) choose(b.getAttribute('data-coin'));
    else if (b.id === 'notCoin') choose('off');
    else if (b.id === 'cancel') closePicker();
    else if (b.id === 'reset') reset();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && picking) closePicker(); });
  ['camera', 'gallery'].forEach(function (k) {
    $(k).addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; if (f) readPhoto(f); });
  });
})();
