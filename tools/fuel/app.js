/* Fuel Prices (Leighton Buzzard): ranks every forecourt in town by petrol (E10) or diesel (B7) price.

   Where the prices come from, newest wins:
   - the hourly GitHub check (.github/fuel/check.mjs) saves tools/fuel/data/prices.json; the page reads it from the
     site and from raw.githubusercontent.com (which has it straight away) and uses whichever was checked later
   - every time the page opens (and on Check again) it also reads PetrolPrices.co.uk's Leighton Buzzard page itself,
     through jina (r.jina.ai), with the same reader as GitHub (fuel/parse.js). That reading stays on this device.
   The last prices shown are kept on the device (fu-last-v1) so the page has something to show straight away. */
(function () {
  'use strict';
  var F = window.FuelParse;
  var SITE = 'fuel/data/prices.json';
  var RAW = 'https://raw.githubusercontent.com/detailedfoil/Toolbox/main/tools/fuel/data/prices.json';
  var JINA = 'https://r.jina.ai/';
  var LITRES = 50;
  var NAMES = { petrol: 'petrol', diesel: 'diesel' };
  var $ = function (id) { return document.getElementById(id); };
  var state = { fuel: 'petrol', saved: null, shown: null, kind: '', checking: false, hiddenAt: 0 };

  function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ms(iso) { var t = iso ? Date.parse(iso) : NaN; return isNaN(t) ? 0 : t; }
  function money(p) { return p.toFixed(1) + 'p'; }

  /* "12:03 today", "21:47 yesterday", "09:05 Sat 17 Oct" in UK time */
  function when(iso) {
    var t = ms(iso);
    if (!t) return '';
    var d = new Date(t), day = F.ukDate(d), hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    if (day === F.ukDate(new Date())) return hm + ' today';
    if (day === F.ukDate(new Date(Date.now() - 864e5))) return hm + ' yesterday';
    return hm + ' ' + d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  }

  /* ---------- reading the prices ---------- */

  function getJSON(url) {
    return fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* GitHub's saved prices: the site's copy or raw.githubusercontent.com's, whichever was checked later */
  function loadSaved() {
    return Promise.all([getJSON(SITE), getJSON(RAW)]).then(function (a) {
      var ok = a.filter(function (d) { return d && d.stations && Object.keys(d.stations).length; });
      ok.sort(function (x, y) { return ms(y.checked) - ms(x.checked); });
      return ok[0] || null;
    });
  }

  /* PetrolPrices' page read now through jina -> parse() result, or throws with the reason */
  function readLive() {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 30000);
    return fetch(JINA + F.URL, { headers: { Accept: 'text/plain', 'X-Cache-Tolerance': '600' }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status === 429 ? 'too many checks in a minute, try again shortly' : 'HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        var res = F.parse(text, { known: (state.saved && state.saved.stations) || {} });
        var bad = F.ok(res);
        if (bad) throw new Error(bad);
        return res;
      })
      .catch(function (e) { throw new Error(e && e.name === 'AbortError' ? 'no answer after 30 seconds' : (e && e.message) || 'no connection'); })
      .finally(function () { clearTimeout(timer); });
  }

  function refresh() {
    if (state.checking) return;
    state.checking = true;
    $('again').disabled = true;
    $('error').hidden = true;
    setStatus(state.shown ? 'Checking for newer prices' : 'Getting the latest prices', true);
    loadSaved().then(function (saved) {
      if (saved) {
        state.saved = saved;
        if (state.kind !== 'live' || ms(saved.reported) > ms(state.shown && state.shown.reported)) show(saved, 'saved', true);
      }
      return readLive().then(function (res) {
        // jina can hand back a copy older than GitHub's last check; the newer one wins
        if (saved && ms(res.reported) && ms(res.reported) < ms(saved.reported)) return show(saved, 'saved');
        show(F.merge(saved, res, new Date().toISOString()).data, 'live');
      }, function (err) {
        // the newer of GitHub's prices and the last ones this device saw
        var mine = state.shown && ms(state.shown.reported || state.shown.checked), gh = state.saved && ms(state.saved.reported || state.saved.checked);
        if (state.saved && (!mine || gh >= mine)) show(state.saved, 'fallback', false, err.message);
        else if (state.shown) show(state.shown, 'stale', false, err.message);
        else {
          setStatus('', false);
          $('error').hidden = false;
          $('error').textContent = "Couldn't get the prices just now (" + err.message + '). Try Check again in a minute.';
        }
      });
    }).finally(function () {
      state.checking = false;
      $('again').disabled = false;
    });
  }

  /* ---------- showing them ---------- */

  function setStatus(text, busy) {
    $('statusText').textContent = text;
    $('status').hidden = !text;
    $('status').classList.toggle('is-busy', !!busy);
    $('status').classList.toggle('is-live', !busy && state.kind === 'live');
  }

  function show(data, kind, busy, why) {
    state.shown = data;
    state.kind = kind;
    save('fu-last-v1', { data: data, at: new Date().toISOString() });
    var rep = when(data.reported), chk = when(data.checked);
    var text = {
      live: 'Live: ' + (rep ? 'as reported at ' + rep : 'checked ' + chk),
      saved: rep ? 'As reported at ' + rep : 'GitHub checked at ' + chk,
      fallback: "Couldn't check live just now (" + why + "), so these are GitHub's prices from " + (rep || chk),
      stale: "Couldn't check just now (" + why + '). Showing the prices from ' + (rep || chk),
      cached: 'Last seen ' + (rep ? 'as reported at ' + rep : chk)
    }[kind];
    setStatus(busy ? text + '. Checking for newer prices' : text, busy);
    render();
  }

  function render() {
    var data = state.shown;
    if (!data) return;
    var f = state.fuel, all = Object.keys(data.stations).map(function (id) { var s = data.stations[id]; s.id = id; return s; });
    var priced = all.filter(function (s) { return s[f] && s[f].p != null; })
      .sort(function (a, b) { return a[f].p - b[f].p || a.name.localeCompare(b.name); });
    var none = all.filter(function (s) { return !s[f] || s[f].p == null; });
    $('view').hidden = false;
    if (!priced.length) {
      $('best').hidden = true;
      $('list').innerHTML = '<li class="fu-none">No ' + NAMES[f] + ' prices reported right now.</li>';
      return;
    }
    var min = priced[0][f].p, max = priced[priced.length - 1][f].p;
    var cheapest = priced.filter(function (s) { return s[f].p === min; });

    var best = $('best');
    best.hidden = false;
    best.href = maps(cheapest[0]);
    best.className = 'fu-best fu-' + f;
    best.innerHTML = '<span class="fu-best-k">Cheapest ' + NAMES[f] + '</span>' +
      '<span class="fu-best-p">' + min.toFixed(1) + '<small>p</small></span>' +
      '<span class="fu-best-n">' + cheapest.map(function (s) { return esc(s.name); }).join(' <em>and</em> ') + '</span>' +
      '<span class="fu-best-s">' + (max > min
        ? (max - min).toFixed(1) + 'p a litre less than the dearest: £' + ((max - min) * LITRES / 100).toFixed(2) + ' on a ' + LITRES + ' litre fill'
        : 'Every forecourt is the same price') + '</span>' +
      '<span class="fu-best-go">Directions<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></span>';

    var rank = 0, last = null;
    $('list').innerHTML = priced.map(function (s, i) {
      if (s[f].p !== last) { rank = i + 1; last = s[f].p; }
      var gap = s[f].p - min;
      return '<li><a class="fu-row' + (gap === 0 ? ' is-best' : '') + '" href="' + maps(s) + '" target="_blank" rel="noopener">' +
        '<span class="fu-rank">' + rank + '</span>' +
        '<span class="fu-who"><b>' + esc(s.name) + '</b><span>' + esc(shortAddress(s.address)) + '</span>' + moved(s[f]) + '</span>' +
        '<span class="fu-price"><b>' + money(s[f].p) + '</b><span>' + (gap === 0 ? 'Cheapest' : '+' + gap.toFixed(1) + 'p') + '</span></span>' +
        '</a></li>';
    }).join('') + none.map(function (s) {
      return '<li><a class="fu-row is-none" href="' + maps(s) + '" target="_blank" rel="noopener"><span class="fu-rank">&ndash;</span>' +
        '<span class="fu-who"><b>' + esc(s.name) + '</b><span>' + esc(shortAddress(s.address)) + '</span></span>' +
        '<span class="fu-price"><span>No ' + NAMES[f] + ' price</span></span></a></li>';
    }).join('');
  }

  /* "down 1.0p at 12:23 (was 168.9p)" when a price changed in the last two days */
  function moved(x) {
    if (x.prev == null || x.p == null || Date.now() - ms(x.since) > 48 * 3600000) return '';
    var d = x.p - x.prev, up = d > 0;
    return '<span class="fu-moved ' + (up ? 'is-up' : 'is-down') + '">' + (up ? '▲ up ' : '▼ down ') + Math.abs(d).toFixed(1) + 'p' +
      (ms(x.since) ? ' at ' + esc(when(x.since)) : '') + ' (was ' + money(x.prev) + ')</span>';
  }

  function shortAddress(a) { return String(a || '').replace(/,\s*Leighton Buzzard\b/i, ''); }
  function maps(s) { return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(s.name + ', ' + (s.address || s.postcode || '')); }

  function pick(fuel) {
    state.fuel = NAMES[fuel] ? fuel : 'petrol';
    save('fu-fuel-v1', state.fuel);
    document.body.dataset.fuel = state.fuel;
    Array.prototype.forEach.call(document.querySelectorAll('.fu-switch button'), function (b) {
      b.setAttribute('aria-selected', String(b.dataset.fuel === state.fuel));
    });
    render();
  }

  /* ---------- start ---------- */

  Array.prototype.forEach.call(document.querySelectorAll('.fu-switch button'), function (b) {
    b.addEventListener('click', function () { pick(b.dataset.fuel); });
  });
  $('again').addEventListener('click', refresh);
  // back on the page after a while (a phone tab left open): check again by itself
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) state.hiddenAt = Date.now();
    else if (state.hiddenAt && Date.now() - state.hiddenAt > 10 * 60000) refresh();
  });

  pick(load('fu-fuel-v1') || 'petrol');
  var last = load('fu-last-v1');
  if (last && last.data && last.data.stations) show(last.data, 'cached', true);
  refresh();
})();
