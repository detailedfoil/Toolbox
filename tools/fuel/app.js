/* Fuel Prices: ranks the forecourts within 5 miles of your store by petrol (E10) or diesel (B7) price.

   - Pick your store at the top (it starts on the store you signed in as, and this device remembers the pick).
   - Each time the page opens (and on Check again) it reads PetrolPrices.co.uk's fuel map for that town through jina
     (r.jina.ai), petrol and diesel, with the same reader as the GitHub backup (fuel/parse.js). That page shows the
     UK Government Fuel Finder feed.
   - Leighton Buzzard also has a GitHub backup every 3 hours (tools/fuel/data/prices.json, read from the site and
     from raw.githubusercontent.com), shown when the live check can't get through and used for "what changed".
   - The last prices seen for each town stay on this device (fu-town-v2:<place>), so the page has something to show
     straight away and can tell you what moved since you last looked. */
(function () {
  'use strict';
  var F = window.FuelParse;
  var BACKUP = { place: 'Leighton Buzzard', site: 'fuel/data/prices.json', raw: 'https://raw.githubusercontent.com/detailedfoil/Toolbox/main/tools/fuel/data/prices.json' };
  var JINA = 'https://r.jina.ai/';
  var LITRES = 55, STALE_DAYS = 3;
  var NAMES = { petrol: 'petrol', diesel: 'diesel' };
  var $ = function (id) { return document.getElementById(id); };
  var state = { hide: [], fuel: 'petrol', store: null, shown: null, kind: '', run: 0, checking: false, hiddenAt: 0 };

  function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ms(iso) { var t = iso ? Date.parse(iso) : NaN; return isNaN(t) ? 0 : t; }
  function money(p) { return p.toFixed(1) + 'p'; }
  function townKey(place) { return 'fu-town-v2:' + place; }

  /* "12:03 today", "21:47 yesterday", "09:05 Sat 17 Oct", UK time */
  function when(iso) {
    var t = ms(iso);
    if (!t) return '';
    var d = new Date(t), day = F.ukDate(d), hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    if (day === F.ukDate(new Date())) return hm + ' today';
    if (day === F.ukDate(new Date(Date.now() - 864e5))) return hm + ' yesterday';
    return hm + ' ' + d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  }
  /* a forecourt's report date (YYYY-MM-DD) -> {text, days} */
  function reported(date) {
    if (!date) return null;
    var days = Math.round((Date.parse(F.ukDate(new Date()) + 'T12:00:00Z') - Date.parse(date + 'T12:00:00Z')) / 864e5);
    var text = days <= 0 ? 'today' : days === 1 ? 'yesterday' : new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return { text: text, days: days };
  }

  /* ---------- reading the prices ---------- */

  function getJSON(url) {
    return fetch(url + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  /* Leighton Buzzard's GitHub backup: the site's copy or raw.githubusercontent.com's, whichever was checked later */
  function loadBackup() {
    return Promise.all([getJSON(BACKUP.site), getJSON(BACKUP.raw)]).then(function (a) {
      var ok = a.filter(function (d) { return d && d.place === BACKUP.place && d.stations && Object.keys(d.stations).length; });
      ok.sort(function (x, y) { return ms(y.checked) - ms(x.checked); });
      return ok[0] || null;
    });
  }

  /* one fuel for a place, through jina -> parse() result, or throws with the reason */
  function readFuel(place, fuel) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 45000);
    return fetch(JINA + F.mapURL(place, fuel), { headers: { Accept: 'text/plain', 'X-Timeout': '20', 'X-Cache-Tolerance': '300' }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status === 429 ? 'too many checks in a minute, try again shortly' : 'HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        var res = F.parse(text);
        var bad = F.ok(res);
        if (bad) throw new Error(bad);
        return res;
      })
      .catch(function (e) { throw new Error(e && e.name === 'AbortError' ? 'no answer after 45 seconds' : (e && e.message) || 'no connection'); })
      .finally(function () { clearTimeout(timer); });
  }

  /* a loading bar: not a real measure, it eases towards 92% while the prices load, then fills and fades out */
  var barTimer = 0;
  function barStart() {
    var bar = $('bar'), fill = $('barFill');
    clearTimeout(barTimer);
    bar.hidden = false;
    bar.classList.remove('is-out');
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.offsetWidth; // let the reset land before it starts moving
    fill.style.transition = 'width 12s cubic-bezier(.08,.6,.2,1)';
    fill.style.width = '92%';
  }
  function barDone() {
    var bar = $('bar'), fill = $('barFill');
    fill.style.transition = 'width .25s ease-out';
    fill.style.width = '100%';
    clearTimeout(barTimer);
    barTimer = setTimeout(function () {
      bar.classList.add('is-out');
      barTimer = setTimeout(function () { bar.hidden = true; }, 500);
    }, 300);
  }

  function refresh() {
    var store = state.store;
    if (!store) return;
    var run = ++state.run, place = store.place, mine = function () { return run === state.run; };
    state.checking = true;
    barStart();
    $('again').disabled = true;
    $('error').hidden = true;
    setStatus(state.shown ? 'Checking for newer prices' : 'Getting the latest prices', true);
    var device = load(townKey(place));
    var backup = place === BACKUP.place ? loadBackup() : Promise.resolve(null);
    backup.then(function (gh) {
      if (!mine()) return;
      // what to compare against for "what changed": whichever of GitHub's and this device's copy is newer
      var base = gh && (!device || ms(gh.checked) > ms(device.checked)) ? gh : device;
      if (gh && base === gh && state.kind !== 'live') show(gh, 'backup', true);
      return Promise.all([readFuel(place, 'petrol'), readFuel(place, 'diesel')]).then(function (two) {
        if (!mine()) return;
        var synced = [two[0].synced, two[1].synced].filter(Boolean).sort().pop() || null;
        var data = F.merge(base, F.combine(two[0], two[1]), synced, new Date().toISOString(), place).data;
        save(townKey(place), data);
        show(data, 'live');
      }, function (err) {
        if (!mine()) return;
        var fall = base || state.shown;
        if (fall) show(fall, fall === gh ? 'fallback' : 'stale', false, err.message);
        else {
          setStatus('', false);
          $('view').hidden = true;
          $('error').hidden = false;
          $('error').textContent = "Couldn't get the prices just now (" + err.message + '). Try Check again in a minute.';
        }
      });
    }).finally(function () {
      if (!mine()) return;
      state.checking = false;
      barDone();
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
    var syn = when(data.synced), chk = when(data.checked);
    var text = {
      live: 'Live' + (syn ? ', site updated ' + syn : ''),
      backup: 'GitHub backup from ' + chk,
      fallback: "Couldn't check live just now (" + why + "), so these are from GitHub's backup at " + chk,
      stale: "Couldn't check just now (" + why + '). Showing what this phone saw at ' + chk,
      cached: 'Last seen at ' + chk
    }[kind];
    setStatus(busy ? text + '. Checking for newer prices' : text, busy);
    render();
  }

  function render() {
    var data = state.shown;
    if (!data) return;
    var f = state.fuel, every = Object.keys(data.stations).map(function (k) { var s = data.stations[k]; s.key = k; return s; });
    var held = [], all = every.filter(function (s) {
      var rule = state.hide.filter(function (r) { return F.isHidden(s, r); })[0];
      if (rule) held.push(rule);
      return !rule;
    });
    $('held').hidden = !held.length;
    $('held').innerHTML = held.map(function (r) { return esc(r.name) + ' (' + esc((r.reason || 'hidden').toLowerCase()) + ')'; }).join(', ') + ' hidden until it reports a new price.';
    var priced = all.filter(function (s) { return s[f] && s[f].p != null; })
      .sort(function (a, b) { return a[f].p - b[f].p || (a.miles || 0) - (b.miles || 0); });
    var none = all.filter(function (s) { return !s[f] || s[f].p == null; });
    $('view').hidden = false;
    if (!priced.length) {
      $('best').hidden = true;
      $('list').innerHTML = '<li class="fu-none">No ' + NAMES[f] + ' prices reported around here right now.</li>';
      return;
    }
    var min = priced[0][f].p, max = priced[priced.length - 1][f].p;
    var cheapest = priced.filter(function (s) { return s[f].p === min; });
    var rep = reported(cheapest[0][f].date);

    var best = $('best');
    best.hidden = false;
    best.href = maps(cheapest[0]);
    best.innerHTML = '<span class="fu-best-k">Cheapest ' + NAMES[f] + '</span>' +
      '<span class="fu-best-p">' + min.toFixed(1) + '<small>p</small></span>' +
      '<span class="fu-best-n">' + cheapest.slice(0, 3).map(function (s) { return esc(s.brand) + ' <em>' + esc(firstBit(s.address)) + '</em>'; }).join('<br>') +
      (cheapest.length > 3 ? '<br><em>and ' + (cheapest.length - 3) + ' more</em>' : '') + '</span>' +
      '<span class="fu-best-s">' + (max > min
        ? (max - min).toFixed(1) + 'p a litre less than the dearest: £' + ((max - min) * LITRES / 100).toFixed(2) + ' on a ' + LITRES + ' litre fill'
        : 'Every forecourt is the same price') + '</span>' +
      (rep && rep.days > STALE_DAYS ? '<span class="fu-best-w">Last reported ' + esc(rep.text) + ', so it may have changed</span>' : '') +
      '<span class="fu-best-go">Directions<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></span>';

    var rank = 0, last = null;
    $('list').innerHTML = priced.map(function (s, i) {
      if (s[f].p !== last) { rank = i + 1; last = s[f].p; }
      var gap = s[f].p - min, r = reported(s[f].date);
      return '<li><a class="fu-row' + (gap === 0 ? ' is-best' : '') + '" href="' + maps(s) + '" target="_blank" rel="noopener">' +
        '<span class="fu-rank">' + rank + '</span>' +
        '<span class="fu-who"><b>' + esc(s.brand) + '</b><span>' + esc(s.address) + '</span>' +
        '<span class="fu-meta">' + (s.miles != null ? s.miles + ' mi' : '') +
        (r ? ' · <i class="' + (r.days > STALE_DAYS ? 'is-old' : '') + '">' + (r.days > STALE_DAYS ? 'price from ' : 'reported ') + esc(r.text) + '</i>' : '') + '</span>' +
        moved(s[f]) + '</span>' +
        '<span class="fu-price"><b>' + money(s[f].p) + '</b><span>' + (gap === 0 ? 'Cheapest' : '+' + gap.toFixed(1) + 'p') + '</span></span>' +
        '</a></li>';
    }).join('') + none.map(function (s) {
      return '<li><a class="fu-row is-none" href="' + maps(s) + '" target="_blank" rel="noopener"><span class="fu-rank">&ndash;</span>' +
        '<span class="fu-who"><b>' + esc(s.brand) + '</b><span>' + esc(s.address) + '</span></span>' +
        '<span class="fu-price"><span>No ' + NAMES[f] + ' price</span></span></a></li>';
    }).join('');
  }

  /* "▼ down 1.0p at 12:23 today (was 168.9p)" when a price changed in the last two days */
  function moved(x) {
    if (x.prev == null || x.p == null || Date.now() - ms(x.since) > 48 * 3600000) return '';
    var d = x.p - x.prev, up = d > 0;
    return '<span class="fu-moved ' + (up ? 'is-up' : 'is-down') + '">' + (up ? '▲ up ' : '▼ down ') + Math.abs(d).toFixed(1) + 'p' +
      (ms(x.since) ? ' by ' + esc(when(x.since)) : '') + ' (was ' + money(x.prev) + ')</span>';
  }
  function firstBit(a) { return String(a || '').split(',')[0]; }
  function maps(s) { return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(s.brand + ', ' + (s.raw || s.address)); }

  /* ---------- picking ---------- */

  function pickFuel(fuel) {
    state.fuel = NAMES[fuel] ? fuel : 'petrol';
    save('fu-fuel-v1', state.fuel);
    document.body.dataset.fuel = state.fuel;
    Array.prototype.forEach.call(document.querySelectorAll('.fu-switch button'), function (b) {
      b.setAttribute('aria-selected', String(b.dataset.fuel === state.fuel));
    });
    render();
  }

  function pickStore(name) {
    var store = F.STORES.filter(function (s) { return s.name === name; })[0];
    if (!store) return;
    var samePlace = state.store && state.store.place === store.place;
    state.store = store;
    save('fu-store-v1', store.name);
    $('store').value = store.name;
    $('town').textContent = store.town;
    $('sub').textContent = 'Forecourts within ' + F.RADIUS + ' miles of ' + store.place.split(',')[0] + ', cheapest first.';
    document.title = 'Fuel near ' + store.town;
    if (samePlace) return;
    state.shown = null;
    state.kind = '';
    $('view').hidden = true;
    $('error').hidden = true;
    var cached = load(townKey(store.place));
    if (cached && cached.stations) show(cached, 'cached', true);
    refresh();
  }

  /* ---------- start ---------- */

  $('store').innerHTML = F.STORES.map(function (s) { return '<option value="' + esc(s.name) + '">' + esc(s.name) + '</option>'; }).join('');
  $('store').addEventListener('change', function () { pickStore(this.value); });
  Array.prototype.forEach.call(document.querySelectorAll('.fu-switch button'), function (b) {
    b.addEventListener('click', function () { pickFuel(b.dataset.fuel); });
  });
  $('again').addEventListener('click', refresh);
  // back on the page after a while (a phone tab left open): check again by itself
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) state.hiddenAt = Date.now();
    else if (state.hiddenAt && Date.now() - state.hiddenAt > 10 * 60000 && !state.checking) refresh();
  });

  // forecourts left out of the lists (closed, say) until they report a new price; the same list for every store
  getJSON('fuel/data/hidden.json').then(function (d) {
    if (d && d.stations && d.stations.length) { state.hide = d.stations; render(); }
  });

  pickFuel(load('fu-fuel-v1') || 'petrol');
  var me = '';
  try { me = (localStorage.getItem('toolbox.signedIn.area20') || '').toUpperCase(); } catch (e) { /* private mode */ }
  var signedIn = F.STORES.filter(function (s) { return s.code === me; })[0];
  pickStore(load('fu-store-v1') || (signedIn ? signedIn.name : 'Leighton Buzzard (FA2)'));
  // signing in on this page (the sign-in screen sits over it) picks that store, unless one was already chosen here
  window.addEventListener('toolbox:login', function () {
    if (load('fu-store-v1-chosen')) return;
    var code = ''; try { code = (localStorage.getItem('toolbox.signedIn.area20') || '').toUpperCase(); } catch (e) {}
    var s = F.STORES.filter(function (x) { return x.code === code; })[0];
    if (s) pickStore(s.name);
  });
  $('store').addEventListener('change', function () { save('fu-store-v1-chosen', true); });
})();
