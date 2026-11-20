/* Stock Swaps page: the drive time slider, Swaps only, the store picker, the map and the ranked list.
   Every plan is worked out ahead by .github/stock-swaps/make-plans.py into data/plans.json; plan.js reads them, this
   file only shows them. Remembered on this phone (localStorage ss-v1): the minutes, Swaps only and the store. The
   address carries them too (#store=Dunstable&mins=60&swaps=1), so a link opens the same view. */
(function () {
  'use strict';
  var P = window.SwapPlan;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'ss-v1', SHOW_SKIP = 6, DOT = 6;
  var doc, full, view, map, lineR;
  var state = { mins: 60, swaps: false, store: -1 };
  var drawn = {};           // run key -> {line, hit, run}
  var icons = [];           // store index -> Leaflet marker
  var picked = null;        // key of the run picked on the map or in the list
  var allSkip = false;      // "Show more" pressed under Not worth your time

  // which side of its dot each store's name goes (r, l, t, b); names that would clash are hidden until you zoom in
  var PLACE = {
    'Amersham': 'r', 'Berkhamsted': 't', 'Biggleswade': 'r', 'Bishops Stortford': 't', 'Chesham': 'r', 'Dunstable': 'l',
    'Epping': 'r', 'Flitwick': 'r', 'Harlow': 'r', 'Hemel Hempstead': 'b', 'Hertford': 'r', 'Hoddesdon': 'b',
    'Houghton Regis': 't', 'Leighton Buzzard': 't', 'Letchworth': 'l', 'Luton Bilton Way': 'b', 'Luton Windmill': 'r',
    'Royston': 'r', 'Saffron Walden': 'l', 'St Albans': 'b', 'Stevenage': 'r', 'Welwyn Garden City': 't'
  };
  var LOW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v4.5M12 17.5v.01"/></svg>';
  var MAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>';

  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function name(s) { return doc.stores[s].name; }
  function fmt(n) { return Number(n).toLocaleString('en-GB'); }
  function count(n, one) { return fmt(n) + ' ' + (n === 1 ? one : one + 's'); }
  function ll(s) { return L.latLng(doc.stores[s].lat, doc.stores[s].lng); }
  function day(iso) { var p = String(iso).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : iso; }

  /* ---------- saved choices ---------- */
  function restore() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    var mins = +(h.get('mins') || saved.mins || 60), store = h.has('store') ? h.get('store') : saved.store;
    var swaps = h.has('swaps') ? h.get('swaps') === '1' : !!saved.swaps;
    var lo = doc.steps[0], hi = 120;
    state.mins = doc.steps[P.stepIndex(doc, isFinite(mins) ? Math.min(hi, Math.max(lo, mins)) : 60)];
    state.swaps = swaps;
    state.store = store && doc.byName[store] != null ? doc.byName[store] : -1;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ mins: state.mins, swaps: state.swaps, store: state.store >= 0 ? name(state.store) : '' })); } catch (e) {}
    var h = new URLSearchParams();
    if (state.store >= 0) h.set('store', name(state.store));
    h.set('mins', state.mins);
    if (state.swaps) h.set('swaps', '1');
    try { history.replaceState(null, '', '#' + h.toString()); } catch (e) {}
  }

  /* ---------- controls ---------- */
  function setupControls() {
    var sel = $('store');
    sel.innerHTML = '<option value="-1">All stores</option>' + doc.stores.map(function (s, i) { return [s.name, i]; })
      .sort(function (x, y) { return x[0].localeCompare(y[0]); })
      .map(function (o) { return '<option value="' + o[1] + '">' + esc(o[0]) + '</option>'; }).join('');
    sel.value = String(state.store);
    sel.disabled = false;
    sel.addEventListener('change', function () { setStore(+sel.value); });

    var range = $('mins'), queued = false;
    range.min = doc.steps[0];
    range.max = 120;
    range.step = doc.steps.length > 1 ? doc.steps[1] - doc.steps[0] : 5;
    range.value = state.mins;
    range.addEventListener('input', function () {
      state.mins = +range.value;
      showMins();
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; render(false); });
    });
    $('swaps').checked = state.swaps;
    $('swaps').addEventListener('change', function () { state.swaps = $('swaps').checked; render(false); });
    $('fit').addEventListener('click', function () { if (!map) return; map.closePopup(); pick(null); fitAll(true); });
    showMins();

    $('list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.getAttribute('data-act') === 'map') showOnMap(b.getAttribute('data-key'));
      else if (b.getAttribute('data-act') === 'more') { allSkip = true; renderList(); }
    });
    $('mine').addEventListener('click', function (e) {
      if (e.target.closest('[data-act="all"]')) setStore(-1);
    });
  }
  function showMins() {
    var r = $('mins'), pct = (r.value - r.min) / (r.max - r.min) * 100;
    r.style.setProperty('--fill', pct + '%');
    $('minsOut').textContent = r.value;
  }
  function setStore(s) {
    state.store = s;
    $('store').value = String(s);
    picked = null;
    allSkip = false;
    if (map) map.closePopup();
    render(true);
  }
  function barHeight() {
    var h = $('bar').offsetHeight;
    document.body.style.setProperty('--bar-h', h + 'px');
    return h;
  }

  /* ---------- the plan for the current choices ---------- */
  function render(refit) {
    full = P.plan(doc, state.mins, state.swaps);
    view = state.store >= 0 ? P.forStore(full, state.store) : full;
    if (picked && !view.runs.some(function (r) { return r.key === picked; })) picked = null;
    renderSummary();
    renderMine();
    renderList();
    drawMap(refit);
    save();
  }

  function renderSummary() {
    var t, s = state.store, html;
    if (s >= 0) {
      t = P.totals(view.runs, s);
      html = t.runs ? esc(name(s)) + ': ' + count(t.runs, 'run') + ' <span>&middot; you send ' + fmt(t.sends) + ', you get ' + fmt(t.gets) + '</span>'
        : esc(name(s)) + ': <span>no runs worth the drive within ' + view.mins + ' min</span>';
    } else {
      t = P.totals(view.runs);
      html = count(t.runs, 'run') + ' <span>&middot; ' + count(t.units, 'unit') + ' moved &middot; ' + count(t.swaps, 'swap') + '</span>';
    }
    $('sum').innerHTML = html;
  }

  function chip(item, qty, low) {
    return '<span class="ss-chip' + (low ? ' low' : '') + '">' + (low ? LOW : '') + esc(doc.items[item]) + ' <b>' + fmt(qty) + '</b>' +
      (low ? '<span class="vh"> (nearly out)</span>' : '') + '</span>';
  }

  function renderMine() {
    var s = state.store;
    if (s < 0) { $('mine').innerHTML = ''; return; }
    var spare = [], short = [];
    doc.items.forEach(function (it, i) {
      if (doc.spare[s][i] > 0) spare.push([i, doc.spare[s][i]]);
      if (doc.need[s][i] > 0) short.push([i, doc.need[s][i], doc.low[s][i]]);
    });
    spare.sort(function (x, y) { return y[1] - x[1]; });
    short.sort(function (x, y) { return y[2] - x[2] || y[1] - x[1]; });
    $('mine').innerHTML = '<section class="ss-mine"><h2>' + esc(name(s)) + '</h2>' +
      '<div class="row"><span>Can spare</span>' + (spare.length ? '<div class="ss-chips">' + spare.map(function (x) { return chip(x[0], x[1], false); }).join('') + '</div>' : '<div class="none">Nothing spare</div>') + '</div>' +
      '<div class="row"><span>Short for the next ' + doc.rules.horizon + ' days</span>' + (short.length ? '<div class="ss-chips">' + short.map(function (x) { return chip(x[0], x[1], x[2]); }).join('') + '</div>' : '<div class="none">Nothing short</div>') + '</div>' +
      '<div class="ss-foot"><button class="ss-mapbtn" type="button" data-act="all">Show all stores</button></div></section>';
  }

  function title(r) {
    var s = state.store;
    if (s < 0) return esc(name(r.a)) + (r.swap ? ' &#8644; ' : ' &rarr; ') + esc(name(r.b));
    var other = r.a === s ? r.b : r.a;
    return (r.swap ? 'Swap with ' : r.a === s ? 'Send to ' : 'Get from ') + esc(name(other));
  }
  function ways(r) {
    var s = state.store, list = s >= 0 ? [[s, r.a === s ? r.b : r.a], [r.a === s ? r.b : r.a, s]] : [[r.a, r.b], [r.b, r.a]];
    return list.map(function (w) {
      var ls = r.lines.filter(function (l) { return l.from === w[0] && l.to === w[1]; });
      if (!ls.length) return null;
      var n = ls.reduce(function (t, l) { return t + l.qty; }, 0);
      return { label: s >= 0 ? (w[0] === s ? 'You send' : 'You get') : esc(name(w[0])) + ' &rarr; ' + esc(name(w[1])), units: n, lines: ls };
    }).filter(Boolean);
  }
  function card(r) {
    return '<article class="ss-card t' + r.tier + (picked === r.key ? ' on' : '') + '" id="run-' + r.key + '" data-key="' + r.key + '">' +
      '<div class="ss-top"><span class="ss-rank">' + r.rank + '</span><div class="ss-ttl">' +
      '<span class="ss-kind ' + (r.swap ? 'swap">SWAP' : 'one">ONE WAY') + '</span><h3>' + title(r) + '</h3>' +
      '<div class="ss-meta"><b>' + count(r.units, 'unit') + '</b> &middot; ' + r.mins + ' min round trip</div></div></div>' +
      ways(r).map(function (w) {
        return '<div class="ss-way"><div>' + w.label + ' (' + w.units + ')</div><div class="ss-chips">' +
          w.lines.map(function (l) { return chip(l.item, l.qty, l.low); }).join('') + '</div></div>';
      }).join('') +
      '<div class="ss-foot"><button class="ss-mapbtn" type="button" data-act="map" data-key="' + r.key + '">' + MAP + 'Show on map</button></div></article>';
  }
  function skipRow(r, hidden) {
    return '<div class="ss-skip t3"' + (hidden ? ' hidden' : '') + '><div class="h">' + title(r) + '<span>' + count(r.units, 'unit') + ' &middot; ' + r.mins + ' min</span></div>' +
      '<div class="d">' + ways(r).map(function (w) {
        return w.label + ': ' + w.lines.map(function (l) { return esc(doc.items[l.item]) + ' ' + l.qty; }).join(', ');
      }).join(' &middot; ') + '</div></div>';
  }
  function tierHead(t, rs) {
    var u = rs.reduce(function (n, r) { return n + r.units; }, 0);
    return '<h2 class="ss-tier t' + t + '">' + P.TIERS[t] + '<small>' + count(rs.length, 'run') + ' &middot; ' + count(u, 'unit') + '</small></h2>';
  }
  function renderList() {
    var html = '', s = state.store;
    if (!view.runs.length) {
      html += '<div class="ss-empty">' + (s >= 0 ? 'No runs for ' + esc(name(s)) : 'No runs') + ' are worth the drive within ' + view.mins +
        ' minutes. Try a longer drive' + (state.swaps ? ', or turn off Swaps only' : '') + '.</div>';
    } else {
      html += '<p class="ss-lowkey">' + LOW + '<span>= going to a store with under ' + doc.rules.lowDays + ' days of it left</span></p>';
    }
    [0, 1, 2].forEach(function (t) {
      var rs = view.runs.filter(function (r) { return r.tier === t; });
      if (!rs.length) return;
      html += tierHead(t, rs) + rs.map(card).join('');
    });
    if (view.skip.length) {
      html += tierHead(3, view.skip) + view.skip.map(function (r, i) { return skipRow(r, !allSkip && i >= SHOW_SKIP); }).join('');
      if (!allSkip && view.skip.length > SHOW_SKIP) html += '<button class="ss-more" type="button" data-act="more">Show ' + (view.skip.length - SHOW_SKIP) + ' more</button>';
    }
    $('list').innerHTML = html;
  }

  function showStamp() {
    var a = P.stockAge(doc.stockDate), el = $('stamp');
    el.textContent = a.text;
    el.className = 'ss-stamp ' + (a.days === 0 ? 'fresh' : a.days === 1 ? 'old1' : 'old2');
    el.hidden = false;
  }

  function setupNotes() {
    showStamp();
    var rl = doc.rules;
    $('about').textContent = 'Which Area 20 stores should swap stock, best first. Stock at ' + doc.stockDate + ', sales ' + doc.sales + '.';
    $('short').innerHTML = doc.short.map(function (x) {
      return '<div><b>' + esc(doc.items[x.item]) + '</b>about ' + fmt(x.short) + ' short<br><span>' + fmt(x.stock) + ' in stock, ' + fmt(x.sold) + ' sold in ' + doc.days + ' days</span></div>';
    }).join('');
    $('how').innerHTML = [
      'Stock at <b>' + esc(doc.stockDate) + '</b>, sales <b>' + esc(doc.sales) + '</b>, worked out ' + esc(day(doc.made)) + '.',
      'Each store needs <b>' + rl.horizon + ' days</b> of each item: half from its own sales, half from its share of the area\'s transactions.',
      'A store only gives what it has over <b>' + Math.round(rl.keep * 100) + '%</b> of its own ' + rl.horizon + ' days, so it keeps what it needs.',
      'The plan is worked out for the whole area at once, and again for every slider position, so two stores never count on the same stock. <b>Your store</b> shows your part of it.',
      'Stores with under <b>' + rl.lowDays + ' days</b> of an item get it first. A <b>swap</b> is at least ' + rl.swapMin + ' units each way, and swapped units count 1.5 times.',
      'Runs are ranked by units moved per van hour (the drive plus ' + rl.handling + ' minutes to load, unload and book it): <b>Most effective</b> ' + rl.tiers[0] + ' or more an hour, <b>Worth doing</b> ' + rl.tiers[1] + ' to ' + rl.tiers[0] +
        ', <b>Marginal</b> ' + rl.tiers[2] + ' to ' + rl.tiers[1] + '. Under ' + rl.minUnits + ' units, or under ' + rl.minScore + ' an hour, is <b>not worth your time</b>.',
      'Drive times are estimates from the distance between stores, not live routes or traffic.'
    ].map(function (t) { return '<li>' + t + '</li>'; }).join('');
    $('notes').hidden = false;
  }

  /* ---------- map ---------- */
  function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: true, zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 7, maxZoom: 15, wheelPxPerZoomLevel: 110 });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    fitAll(false);
    lineR = L.svg({ padding: 0.6 }).addTo(map);
    arrowheads(lineR._container);
    doc.stores.forEach(function (st, i) {
      var icon = L.divIcon({ className: 'ss-store-ic', iconSize: [18, 18], iconAnchor: [9, 9],
        html: '<span class="ss-dot"></span><span class="ss-lab p-' + (PLACE[st.name] || 'r') + '">' + esc(st.name) + '</span>' });
      var m = L.marker([st.lat, st.lng], { icon: icon, keyboard: false, title: st.name }).addTo(map);
      m.on('click', function (e) { L.DomEvent.stop(e); storePop(i); });
      icons.push(m);
    });
    map.on('zoomend', function () { reshape(); labels(); });
    map.on('moveend', labels);
    map.on('click', function () { pick(null); });
    // buttons in the map's pop-ups (Leaflet stops their clicks reaching the map, so catch them on the way down)
    $('map').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'store') { e.stopPropagation(); setStore(+b.getAttribute('data-s')); }
      else if (act === 'card') { e.stopPropagation(); map.closePopup(); toCard(b.getAttribute('data-key')); }
    }, true);
  }

  function arrowheads(svg) {
    var NS = 'http://www.w3.org/2000/svg', defs = document.createElementNS(NS, 'defs');
    [0, 1, 2].forEach(function (t) {
      [['e', 'M0,0 L10,5 L0,10 z', 9], ['s', 'M10,0 L0,5 L10,10 z', 1]].forEach(function (m) {
        var mk = document.createElementNS(NS, 'marker');
        mk.setAttribute('id', 'ss-ah-' + m[0] + t);
        mk.setAttribute('viewBox', '0 0 10 10');
        mk.setAttribute('refX', m[2]);
        mk.setAttribute('refY', '5');
        mk.setAttribute('markerWidth', '2.7');
        mk.setAttribute('markerHeight', '2.7');
        mk.setAttribute('markerUnits', 'strokeWidth');
        mk.setAttribute('orient', 'auto');
        var p = document.createElementNS(NS, 'path');
        p.setAttribute('d', m[1]);
        p.setAttribute('class', 'ss-ah t' + t);
        mk.appendChild(p);
        defs.appendChild(mk);
      });
    });
    svg.insertBefore(defs, svg.firstChild);
  }

  function weight(r) { return Math.max(2.5, Math.min(7.5, 2 + r.units / 9)); }

  // a gentle curve from a to b, worked out on screen at this zoom, stopping short of both dots
  function curve(r) {
    var A = map.latLngToLayerPoint(ll(r.a)), B = map.latLngToLayerPoint(ll(r.b));
    var dx = B.x - A.x, dy = B.y - A.y, k = 0.15;
    var cx = (A.x + B.x) / 2 - dy * k, cy = (A.y + B.y) / 2 + dx * k, pts = [];
    for (var i = 0; i <= 24; i++) {
      var t = i / 24, u = 1 - t;
      pts.push(L.point(u * u * A.x + 2 * u * t * cx + t * t * B.x, u * u * A.y + 2 * u * t * cy + t * t * B.y));
    }
    pts = trim(trim(pts, DOT + 3).reverse(), DOT + 3).reverse();
    return pts.map(function (p) { return map.layerPointToLatLng(p); });
  }
  function trim(pts, d) {
    var done = 0;
    for (var i = 1; i < pts.length; i++) {
      var seg = pts[i].distanceTo(pts[i - 1]);
      if (done + seg >= d) {
        var f = seg ? (d - done) / seg : 0;
        return [pts[i - 1].add(pts[i].subtract(pts[i - 1]).multiplyBy(f))].concat(pts.slice(i));
      }
      done += seg;
    }
    return pts.slice(-2);
  }

  function drawMap(refit) {
    if (!map) return;
    Object.keys(drawn).forEach(function (k) { drawn[k].line.remove(); drawn[k].hit.remove(); });
    drawn = {};
    if (refit) state.store >= 0 ? fitStore(state.store, false) : fitAll(false);
    // weaker runs first, so the best ones sit on top
    view.runs.slice().sort(function (x, y) { return y.tier - x.tier || x.units - y.units; }).forEach(function (r) {
      var pts = curve(r);
      var line = L.polyline(pts, { renderer: lineR, className: 'ss-run t' + r.tier, weight: weight(r), opacity: 0.92,
        dashArray: r.tier === 2 ? '8 7' : null, interactive: false }).addTo(map);
      var el = line.getElement();
      el.setAttribute('marker-end', 'url(#ss-ah-e' + r.tier + ')');
      if (r.swap) el.setAttribute('marker-start', 'url(#ss-ah-s' + r.tier + ')');
      var hit = L.polyline(pts, { renderer: lineR, weight: 22, opacity: 0, className: 'ss-hit', bubblingMouseEvents: false }).addTo(map);
      hit.on('click', function (e) { L.DomEvent.stop(e); pick(r.key); runPop(r, e.latlng); });
      drawn[r.key] = { line: line, hit: hit, run: r };
    });
    var inRuns = {};
    view.runs.forEach(function (r) { inRuns[r.a] = inRuns[r.b] = true; });
    icons.forEach(function (m, i) {
      var el = m.getElement();
      if (!el) return;
      el.classList.toggle('me', i === state.store);
      el.classList.toggle('off', state.store >= 0 && i !== state.store && !inRuns[i]);
      m.setZIndexOffset(i === state.store ? 1000 : inRuns[i] ? 100 : 0);
    });
    highlight();
    labels();
  }

  function reshape() {
    Object.keys(drawn).forEach(function (k) {
      var pts = curve(drawn[k].run);
      drawn[k].line.setLatLngs(pts);
      drawn[k].hit.setLatLngs(pts);
    });
  }

  // show every store name that fits: each tries its usual side of the dot, then the other three; the picked store
  // and the busiest stores choose first, and a name that can't fit anywhere waits until you zoom in
  var SIDES = ['r', 'l', 't', 'b'];
  function labels() {
    if (!map) return;
    var units = {}, c = map.getContainer().getBoundingClientRect(), taken = [];
    view.runs.forEach(function (r) { units[r.a] = (units[r.a] || 0) + r.units; units[r.b] = (units[r.b] || 0) + r.units; });
    var order = icons.map(function (m, i) { return i; }).sort(function (x, y) {
      return (y === state.store) - (x === state.store) || (units[y] || 0) - (units[x] || 0) || name(x).localeCompare(name(y));
    });
    var dots = icons.map(function (m) {
      var d = m.getElement() && m.getElement().querySelector('.ss-dot');
      if (!d) return null;
      var b = d.getBoundingClientRect();
      return [b.left + 2, b.top + 2, b.right - 2, b.bottom - 2];   // the dot's middle: a name may brush its edge
    });
    var clash = function (a, b) { return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]; };
    var inside = function (r) { return r[0] >= c.left && r[2] <= c.right && r[1] >= c.top && r[3] <= c.bottom; };
    order.forEach(function (i) {
      var el = icons[i].getElement(), lab = el && el.querySelector('.ss-lab');
      if (!lab) return;
      // long names go above or below before the other side, so they stay close to their own dot
      var pref = PLACE[name(i)] || 'r', sides = name(i).length > 11 ? ['t', 'b', 'r', 'l'] : SIDES, spot = null;
      var tries = [pref].concat(sides.filter(function (x) { return x !== pref; }));
      for (var k = 0; k < tries.length && !spot; k++) {
        lab.className = 'ss-lab p-' + tries[k];
        var b = lab.getBoundingClientRect(), r = [b.left - 2, b.top - 1, b.right + 2, b.bottom + 1];
        if (inside(r) && !taken.some(function (t) { return clash(r, t); }) && !dots.some(function (d, j) { return d && j !== i && clash(r, d); })) spot = r;
      }
      if (!spot && i === state.store) {
        lab.className = 'ss-lab p-' + pref;
        var b2 = lab.getBoundingClientRect();
        spot = [b2.left - 3, b2.top - 2, b2.right + 3, b2.bottom + 2];
      }
      if (spot) taken.push(spot);
      else lab.className = 'ss-lab p-' + pref + ' hide';
    });
  }

  function fitAll(animate) {
    var b = L.latLngBounds(doc.stores.map(function (s, i) { return ll(i); }));
    map.fitBounds(b, { paddingTopLeft: [18, 30], paddingBottomRight: [18, 30], animate: !!animate });
  }
  function fitStore(s, animate) {
    var pts = [ll(s)];
    view.runs.forEach(function (r) { pts.push(ll(r.a), ll(r.b)); });
    if (pts.length === 1) map.setView(pts[0], 10, { animate: !!animate });
    else map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [40, 44], paddingBottomRight: [40, 50], maxZoom: 11, animate: !!animate });
  }

  function pick(key) {
    picked = key;
    highlight();
  }
  function highlight() {
    Object.keys(drawn).forEach(function (k) {
      var el = drawn[k].line.getElement();
      if (!el) return;
      el.classList.toggle('dim', !!picked && k !== picked);
      el.classList.toggle('on', k === picked);
    });
    if (picked && drawn[picked]) { drawn[picked].line.bringToFront(); drawn[picked].hit.bringToFront(); }
    Array.prototype.forEach.call(document.querySelectorAll('.ss-card'), function (c) { c.classList.toggle('on', c.getAttribute('data-key') === picked); });
  }

  function runPop(r, at) {
    L.popup({ maxWidth: 250, autoPanPadding: [14, 14] }).setLatLng(at).setContent(
      '<div class="ss-pop"><b>' + (state.store >= 0 ? r.rank + '. ' : '#' + r.rank + ' ') + title(r) + '</b><div class="m">' + count(r.units, 'unit') + ' &middot; ' + r.mins +
      ' min round trip<br>' + P.TIERS[r.tier] + '</div><button type="button" data-act="card" data-key="' + r.key + '">See what to move</button></div>').openOn(map);
  }
  function storePop(i) {
    var runs = full.runs.filter(function (r) { return r.a === i || r.b === i; });
    L.popup({ maxWidth: 240, autoPanPadding: [14, 14] }).setLatLng(ll(i)).setContent(
      '<div class="ss-pop"><b>' + esc(name(i)) + '</b><div class="m">' + (runs.length ? count(runs.length, 'run') : 'No runs') + ' within ' + full.mins + ' min</div>' +
      (state.store === i ? '<button type="button" class="alt" data-act="store" data-s="-1">Show all stores</button>'
        : '<button type="button" data-act="store" data-s="' + i + '">Show ' + esc(name(i)) + '\'s runs</button>') + '</div>').openOn(map);
  }

  function showOnMap(key) {
    if (!map || !drawn[key]) return;
    var r = drawn[key].run, wrap = document.querySelector('.ss-mapwrap').getBoundingClientRect(), bar = barHeight();
    pick(key);
    map.closePopup();
    map.fitBounds(L.latLngBounds([ll(r.a), ll(r.b)]), { paddingTopLeft: [50, 50], paddingBottomRight: [50, 56], maxZoom: 11.5, animate: true });
    if (wrap.top < bar || wrap.bottom > window.innerHeight) window.scrollTo({ top: window.pageYOffset + wrap.top - bar - 10, behavior: 'smooth' });
  }
  function toCard(key) {
    var el = $('run-' + key);
    if (!el) return;
    pick(key);
    barHeight();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  /* ---------- start ---------- */
  window.addEventListener('resize', function () {
    barHeight();
    if (!map) return;
    map.invalidateSize();
    reshape();
    labels();
  });
  fetch('stock-swaps/data/plans.json', { cache: 'no-cache', credentials: 'omit' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) {
      doc = P.setup(d);
      restore();
      setupControls();
      setupNotes();
      barHeight();
      if (window.L) initMap();
      render(true);
    })
    .catch(function (e) {
      $('sum').textContent = "Couldn't load the plans (" + (e && e.message || e) + '). Check your signal and reload.';
    });
})();
