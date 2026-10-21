/* Area Map: every Screwfix store on a map, coloured by area.
   Data: area-map/data/stores.json (name, address, postcode, area, country and where it is; nothing else, the repo is
   public) and area-map/data/areas.json (each area's shape, made by .github/area-map/make-areas.mjs).
   The page remembers two things on the phone: "my store" and whether the street map is on. Searching a town or
   postcode that isn't a store asks postcodes.io (UK only) where it is; nothing else leaves the phone.
   Links: #area=20, #store=dunstable, #at=lat,lng,name, so the back button and shared links work. */
(function () {
  'use strict';
  var G = window.AreaGeo;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var KEY_MINE = 'toolbox.areaMap.myStore', KEY_STYLE = 'toolbox.areaMap.street';
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }

  var COUNTRIES = ['England', 'London', 'Scotland', 'Wales', 'Northern Ireland', 'Ireland', 'Isle of Man'];
  var ICON = {
    dir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 18-8-8 18-2-8-8-2Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4l-5.5 2.9 1-6.2L3 9.7l6.2-.9L12 3Z"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12m-5-5 5 5 5-5M5 20h14"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>'
  };

  var data, storeById = {}, areaById = {};
  var cur = { view: 'home' };                  // what the panel shows, from the link (#...)
  var filter = '', areaSort = 'number', storeSort = 'az', query = '';
  var mine = load(KEY_MINE);
  var street = load(KEY_STYLE) !== '0';
  var wide = window.matchMedia('(min-width: 800px)');
  var hover = window.matchMedia('(hover: hover)').matches;
  var map, renderer, tiles, polys = {}, dots = {}, labels = {}, storeLabels = {}, pin = null, colours = {};

  /* ---------- small helpers ---------- */
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('am-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('am-show'); }, 2600);
  }
  function copyText(text, done) {
    var ok = function () { toast(done); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { toast("Couldn't copy on this phone"); }
      ta.remove();
    }
  }
  var fmt = function (n) { return Math.round(n).toLocaleString('en-GB'); };
  var irish = function (a) { return a.countries.length === 1 && a.countries[0] === 'Ireland'; };
  function size(a) { return irish(a) ? fmt(a.km2) + ' km²' : fmt(a.km2 * 0.386102) + ' sq mi'; }
  var plural = function (n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : many); };
  function where(c) { return c === 'London' ? 'London' : c; }
  function sw(a, big) { return '<i class="am-sw' + (big ? ' am-big' : '') + '" style="--c:var(--c' + a.color + ')">' + esc(a.id) + '</i>'; }
  function dist(m, s) { return G.distance(m, s && s.country === 'Ireland'); }
  function colour(i) { return colours[i] || '#888'; }
  function readColours() {
    var css = getComputedStyle(document.documentElement);
    for (var i = 0; i < 7; i++) colours[i] = css.getPropertyValue('--c' + i).trim();
    ['ink', 'edge', 'accent', 'sea'].forEach(function (k) { colours[k] = css.getPropertyValue('--' + k).trim(); });
  }

  /* ---------- the panel as a sheet on a phone ---------- */
  var snap = 'half';
  function sheetPx(name) {
    var h = $('panel').parentNode.clientHeight;
    if (name === 'peek') return Math.min(h, 150);
    if (name === 'full') return Math.max(150, h - 56);
    return Math.round(h * 0.46);
  }
  function setSnap(name) {
    snap = name;
    if (!wide.matches) $('panel').style.height = sheetPx(name) + 'px';
  }
  // how much of the map the panel covers, for fitting things in what's left
  function covered() { return wide.matches ? 0 : sheetPx(snap); }
  (function drag() {
    var startY, startH, lastY, lastT, v = 0, moved = false, panel = $('panel');
    function down(e) {
      if (wide.matches || (e.target.closest && e.target.closest('input,button'))) return;
      startY = lastY = e.clientY; startH = panel.clientHeight; lastT = Date.now(); moved = false;
      panel.classList.add('am-drag');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
    function move(e) {
      var h = Math.max(110, Math.min(sheetPx('full'), startH + startY - e.clientY));
      if (Math.abs(e.clientY - startY) > 4) moved = true;
      var now = Date.now();
      v = (lastY - e.clientY) / Math.max(1, now - lastT); lastY = e.clientY; lastT = now;
      panel.style.height = h + 'px';
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      panel.classList.remove('am-drag');
      var h = panel.clientHeight, names = ['peek', 'half', 'full'];
      if (!moved) { setSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half'); return; }
      if (Math.abs(v) > 0.5) {
        // a flick: on to the next stop in that direction
        var stops = names.filter(function (n) { return v > 0 ? sheetPx(n) > h + 10 : sheetPx(n) < h - 10; });
        setSnap(stops.length ? (v > 0 ? stops[0] : stops[stops.length - 1]) : (v > 0 ? 'full' : 'peek'));
        return;
      }
      var best = 'half', bd = Infinity;
      names.forEach(function (n) { var d = Math.abs(sheetPx(n) - h); if (d < bd) { bd = d; best = n; } });
      setSnap(best);
    }
    $('grab').addEventListener('pointerdown', down);
    $('searchrow').addEventListener('pointerdown', down);
  })();

  /* ---------- the map ---------- */
  function initMap() {
    readColours();
    map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 4, maxZoom: 18, zoomSnap: 0.25, wheelPxPerZoomLevel: 90, worldCopyJump: false });
    if (hover) L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.attributionControl.setPosition('topleft');
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.setView([54.6, -4.2], 6);
    renderer = L.canvas({ padding: 0.4, tolerance: 7 });
    tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    });

    data.areas.forEach(function (a) {
      var ll = a.shape.map(function (poly) { return poly.map(function (ring) { return ring.map(function (p) { return [p[1], p[0]]; }); }); });
      var p = L.polygon(ll, { renderer: renderer, smoothFactor: 0.6 }).addTo(map);
      p.on('click', function (e) {
        // tapping the area that's already open shows the stores nearest that spot
        if (cur.areaId === a.id && cur.view === 'area') go('at=' + e.latlng.lat.toFixed(5) + ',' + e.latlng.lng.toFixed(5));
        else go('area=' + a.id);
      });
      if (hover) p.bindTooltip('Area ' + esc(a.id) + ' · ' + plural(a.list.length, 'store', 'stores'), { sticky: true, direction: 'top', offset: [0, -8] });
      polys[a.id] = p;
      labels[a.id] = L.marker(a.label, {
        icon: L.divIcon({ className: '', html: '<span class="am-lab" style="--c:var(--c' + a.color + ')">' + esc(a.id) + '</span>', iconSize: null }),
        keyboard: false, title: 'Area ' + a.id, zIndexOffset: 100
      }).on('click', function () { go('area=' + a.id); }).addTo(map);
    });
    data.stores.forEach(function (s) {
      var d = L.circleMarker([s.lat, s.lng], { renderer: renderer, radius: 3 }).addTo(map);
      d.on('click', function () { go('store=' + s.id); });
      if (hover) d.bindTooltip(esc(s.name), { direction: 'top', offset: [0, -6] });
      dots[s.id] = d;
    });
    setStreet(street);
    map.on('zoomend', function () { styleAll(); });
    map.on('moveend zoomend', function () { requestAnimationFrame(placeLabels); });
    map.on('click', function (e) {
      // the sea: only to say where the nearest stores are
      if (!G.areaAt(data.areas, e.latlng) && cur.view !== 'home') go('');
    });
  }

  function setStreet(on) {
    street = on;
    save(KEY_STYLE, on ? null : '0');
    $('style').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!map) return;
    if (on) tiles.addTo(map); else tiles.remove();
    styleAll();
  }

  function radius(z) { return z < 6 ? 2 : z < 7.5 ? 2.6 : z < 9 ? 3.5 : z < 11 ? 5 : z < 13 ? 6.5 : 8; }

  function styleAll() {
    if (!map) return;
    var z = map.getZoom(), sel = cur.areaId, r = radius(z);
    data.areas.forEach(function (a) {
      var on = sel === a.id, shown = !filter || a.countries.indexOf(filter) >= 0, dim = (sel && !on) || !shown;
      var fill = street ? (on ? 0.4 : dim ? 0.08 : (z >= 11 ? 0.16 : 0.26)) : (on ? 0.92 : dim ? 0.3 : 0.72);
      polys[a.id].setStyle({
        color: on ? colours.ink : colours.edge, weight: on ? 2.5 : (street ? 1.2 : 1), opacity: on ? 0.9 : (street ? 0.85 : 1),
        fillColor: colour(a.color), fillOpacity: fill
      });
      var el = labels[a.id].getElement();
      if (el && el.firstChild) el.firstChild.classList.toggle('am-on', on);
      labels[a.id].setZIndexOffset(on ? 1000 : 100);
    });
    data.stores.forEach(function (s) {
      var d = dots[s.id], isSel = cur.storeId === s.id, isMine = mine === s.id;
      var shown = !filter || s.country === filter;
      if (!shown) { if (map.hasLayer(d)) d.remove(); return; }
      if (!map.hasLayer(d)) d.addTo(map);
      var faded = sel && s.area !== sel && !isSel;
      d.setStyle({
        radius: isSel ? r + 4 : isMine ? r + 2 : r,
        color: isSel || isMine ? colours.accent : colours.edge, weight: isSel ? 3.5 : isMine ? 2.5 : (r < 3 ? 0.8 : 1.4),
        fillColor: isMine ? colours.accent : colours.ink, fillOpacity: faded ? 0.35 : 1, opacity: faded ? 0.5 : 1
      });
      if (isSel || isMine) d.bringToFront();
    });
  }

  // area numbers (and, close in, store names): the more important first, any that would overlap one already
  // placed are hidden until there's room
  function placeLabels() {
    if (!map) return;
    var boxes = [], size = map.getSize();
    var clash = function (b) { return boxes.some(function (o) { return !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]); }); };
    var order = data.areas.slice().sort(function (a, b) { return (b.id === cur.areaId) - (a.id === cur.areaId) || b.km2 - a.km2; });
    order.forEach(function (a) {
      var m = labels[a.id], el = m.getElement();
      if (!el) return;
      var p = map.latLngToContainerPoint(m.getLatLng()), w = (el.firstChild.offsetWidth || 30) / 2 + 3, h = (el.firstChild.offsetHeight || 24) / 2 + 3;
      var b = [p.x - w, p.y - h, p.x + w, p.y + h], hide = (filter && a.countries.indexOf(filter) < 0) || clash(b);
      el.classList.toggle('am-hide', hide);
      if (!hide) boxes.push(b);
    });

    var z = map.getZoom(), want = {};
    if (z >= 10.5) {
      var view = map.getBounds().pad(0.15);
      var list = data.stores.filter(function (s) { return (!filter || s.country === filter) && view.contains([s.lat, s.lng]); });
      if (list.length <= 160) list.forEach(function (s) { want[s.id] = s; });
    }
    Object.keys(storeLabels).forEach(function (id) { if (!want[id]) { storeLabels[id].remove(); delete storeLabels[id]; } });
    var first = function (s) { return (s.id === cur.storeId ? 2 : 0) + (s.id === mine ? 1 : 0); };
    Object.keys(want).map(function (id) { return want[id]; }).sort(function (a, b) { return first(b) - first(a) || a.name.localeCompare(b.name); }).forEach(function (s) {
      var m = storeLabels[s.id];
      if (!m) {
        m = storeLabels[s.id] = L.marker([s.lat, s.lng], {
          icon: L.divIcon({ className: '', html: '<span class="am-slab">' + esc(s.name) + '</span>', iconSize: null }), keyboard: false, zIndexOffset: -100
        }).on('click', function () { go('store=' + s.id); }).addTo(map);
      }
      var el = m.getElement(), span = el && el.firstChild;
      if (!span) return;
      span.classList.toggle('am-on', s.id === cur.storeId);
      // clear of the dot, which is bigger for the open store and my store
      var gap = radius(z) + (s.id === cur.storeId ? 8 : s.id === mine ? 6 : 4);
      span.style.transform = 'translate(' + gap + 'px,-50%)';
      var p = map.latLngToContainerPoint([s.lat, s.lng]), w = span.offsetWidth, h = span.offsetHeight;
      var b = [p.x + gap, p.y - h / 2, p.x + gap + w, p.y + h / 2];
      var off = b[2] < 0 || b[0] > size.x || b[3] < 0 || b[1] > size.y;
      var hide = !off && clash(b) && s.id !== cur.storeId;
      el.classList.toggle('am-hide', hide);
      if (!hide && !off) boxes.push(b);
    });
  }

  function fit(bounds, maxZoom) {
    if (!map) return;
    var pad = 28, under = covered();
    map.fitBounds(bounds, { paddingTopLeft: [pad, pad + 10], paddingBottomRight: [pad + (hover && wide.matches ? 50 : 56), pad + under], maxZoom: maxZoom || 11, animate: true });
  }
  function fitStores(list, maxZoom) {
    if (!list.length) return;
    fit(L.latLngBounds(list.map(function (s) { return [s.lat, s.lng]; })), maxZoom);
  }
  function fitHome() { fitStores(filter ? data.stores.filter(function (s) { return s.country === filter; }) : data.stores, 9); }

  function setPin(at, isMe) {
    if (pin) { pin.remove(); pin = null; }
    if (!at) return;
    pin = L.marker([at.lat, at.lng], { icon: L.divIcon({ className: '', html: '<div class="am-pin' + (isMe ? ' am-me' : '') + '"></div>', iconSize: null }), keyboard: false, interactive: false, zIndexOffset: 2000 }).addTo(map);
  }

  /* ---------- links: #area=20, #store=..., #at=lat,lng,name ---------- */
  function parse() {
    var h = location.hash.slice(1), m;
    try { h = decodeURIComponent(h); } catch (e) {}
    if ((m = /^area=(.+)$/.exec(h)) && areaById[m[1]]) return { view: 'area', areaId: m[1] };
    if ((m = /^store=(.+)$/.exec(h)) && storeById[m[1]]) return { view: 'store', storeId: m[1], areaId: storeById[m[1]].area };
    if ((m = /^at=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(.*))?$/.exec(h))) {
      var at = { lat: +m[1], lng: +m[2] }, a = G.areaAt(data.areas, at);
      return { view: 'place', at: at, name: m[3] || '', areaId: a ? a.id : null };
    }
    return { view: 'home' };
  }
  function go(h) {
    clearSearch();
    if (location.hash.slice(1) === h || (!h && !location.hash)) { route(true); return; }
    if (h) location.hash = h;
    else { history.pushState(null, '', location.pathname + location.search); route(true); }
  }
  function route(move) {
    var before = cur;
    cur = parse();
    if (!wide.matches && cur.view !== 'home' && (snap === 'full' || before.view === 'home' && snap === 'peek')) setSnap('half');
    render();
    if (!map) return;
    setPin(cur.view === 'place' ? cur.at : null, cur.view === 'place' && cur.name === 'You are here');
    styleAll();
    if (move !== false) {
      if (cur.view === 'area') { var a = areaById[cur.areaId]; fit(L.latLngBounds([[a.box[0], a.box[1]], [a.box[2], a.box[3]]]), 10); }
      else if (cur.view === 'store') { var s = storeById[cur.storeId]; fit(L.latLngBounds([[s.lat, s.lng], [s.lat, s.lng]]), !street ? 11.5 : s.approx ? 13 : 15); }
      else if (cur.view === 'place') {
        var near = G.nearest(data.stores, cur.at, 3).map(function (n) { return [n.store.lat, n.store.lng]; });
        fit(L.latLngBounds(near.concat([[cur.at.lat, cur.at.lng]])), 13);
      } else if (before.view !== 'home') {
        // back to the list: zoom out if an area or store had us zoomed in
        if (map.getZoom() > 8) fitHome();
      }
    }
    requestAnimationFrame(placeLabels);
  }

  /* ---------- what the panel shows ---------- */
  function rowArea(a, note) {
    var bits = [plural(a.list.length, 'store', 'stores'), a.countries.map(where).join(', '), size(a)];
    return '<button class="am-row" data-go="area=' + esc(a.id) + '">' + sw(a) + '<span><b>Area ' + esc(a.id) + '</b><small>' + esc(bits.join(' · ')) + '</small></span>' + (note ? '<span class="am-tag">' + esc(note) + '</span>' : '') + '</button>';
  }
  function rowStore(s, right, showArea) {
    var a = areaById[s.area];
    return '<button class="am-row" data-go="store=' + esc(s.id) + '">' + (showArea ? sw(a) : '') + '<span><b>' + esc(s.name) + (s.id === mine ? ' <span class="am-tag">My store</span>' : '') + '</b><small>' + esc(s.address + ', ' + s.postcode) + '</small></span>' + (right ? '<em>' + esc(right) + '</em>' : '') + '</button>';
  }
  function upButton(label, to) { return '<button class="am-up" data-go="' + esc(to) + '">' + ICON.back + esc(label) + '</button>'; }

  function viewHome() {
    var counts = {};
    data.stores.forEach(function (s) { counts[s.country] = (counts[s.country] || 0) + 1; });
    var list = data.areas.filter(function (a) { return !filter || a.countries.indexOf(filter) >= 0; });
    list.sort(function (a, b) {
      if (areaSort === 'stores') return b.list.length - a.list.length || G.areaSort(a.id, b.id);
      if (areaSort === 'size') return b.km2 - a.km2;
      return G.areaSort(a.id, b.id);
    });
    var my = mine && storeById[mine];
    var html = '<div class="am-h"><h2>Screwfix areas</h2></div>' +
      '<p class="am-sub">' + plural(data.stores.length, 'store', 'stores') + ' in ' + data.areas.length + ' areas. Tap an area or a store, or search.</p>';
    if (my) {
      html += '<div class="am-card">' + sw(areaById[my.area]) + '<span><b>' + esc(my.name) + '</b><small>My store · Area ' + esc(my.area) + '</small></span>' +
        '<button class="am-btn" data-go="store=' + esc(my.id) + '">Show</button></div>';
    }
    html += '<div class="am-label">Show</div><div class="am-chips">' +
      '<button class="am-chip" data-filter="" aria-pressed="' + (!filter) + '">Everywhere <small>' + fmt(data.stores.length) + '</small></button>' +
      COUNTRIES.filter(function (c) { return counts[c]; }).map(function (c) {
        return '<button class="am-chip" data-filter="' + esc(c) + '" aria-pressed="' + (filter === c) + '">' + esc(c) + ' <small>' + fmt(counts[c]) + '</small></button>';
      }).join('') + '</div>';
    html += '<div class="am-label"><span>' + (filter ? 'Areas with stores in ' + esc(filter) : 'Areas') + '</span><span class="am-seg" role="group" aria-label="Sort areas">' +
      [['number', 'Number'], ['stores', 'Stores'], ['size', 'Size']].map(function (o) { return '<button data-asort="' + o[0] + '" aria-pressed="' + (areaSort === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</span></div>';
    html += '<div class="am-list">' + list.map(function (a) { return rowArea(a, my && my.area === a.id ? 'My area' : ''); }).join('') + '</div>';
    html += '<p class="am-note">How the shapes are drawn: every place goes to the area of its nearest store (as the crow flies, and not across the sea). They show roughly what each area covers, not official boundaries.' +
      (my ? '' : ' Open your store and tap <b>Set as my store</b> to keep it at the top.') + '</p>';
    return html;
  }

  function viewArea(a) {
    var my = mine && storeById[mine];
    var span = 0, pair = null;
    a.list.forEach(function (x, i) { a.list.slice(i + 1).forEach(function (y) { var m = G.miles(x, y); if (m > span) { span = m; pair = [x, y]; } }); });
    var list = a.list.slice();
    var near = storeSort === 'near' && my;
    if (near) list.sort(function (x, y) { return G.miles(my, x) - G.miles(my, y); });
    var html = upButton('All areas', '') +
      '<div class="am-h">' + sw(a, true) + '<h2>Area ' + esc(a.id) + '</h2>' + (my && my.area === a.id ? '<span class="am-tag">My area</span>' : '') + '</div>' +
      '<p class="am-sub">' + esc(a.countries.map(where).join(', ')) + '</p>' +
      '<div class="am-stats"><div class="am-stat"><b>' + a.list.length + '</b><span>stores</span></div>' +
      '<div class="am-stat"><b>' + esc(size(a).replace(/ (sq mi|km²)$/, '')) + '</b><span>' + (irish(a) ? 'km² of land' : 'square miles') + '</span></div>' +
      '<div class="am-stat"><b>' + esc(dist(span, a.list[0]).replace(/ (miles|mile|km)$/, '')) + '</b><span>' + (irish(a) ? 'km' : 'miles') + ' end to end</span></div></div>';
    if (pair) html += '<p class="am-note" style="margin-top:6px">Furthest apart: ' + esc(pair[0].name) + ' and ' + esc(pair[1].name) + '.</p>';
    if (a.next.length) {
      html += '<div class="am-label">Next door</div><div class="am-chips">' + a.next.map(function (id) {
        var b = areaById[id];
        return '<button class="am-chip" data-go="area=' + esc(id) + '"><i class="am-dot" style="--c:var(--c' + b.color + ')"></i>Area ' + esc(id) + '</button>';
      }).join('') + '</div>';
    }
    html += '<div class="am-label"><span>' + plural(a.list.length, 'store', 'stores') + '</span>' + (my ? '<span class="am-seg" role="group" aria-label="Sort stores">' +
      '<button data-ssort="az" aria-pressed="' + !near + '">A to Z</button><button data-ssort="near" aria-pressed="' + !!near + '">Nearest ' + esc(my.town) + '</button></span>' : '') + '</div>';
    html += '<div class="am-list">' + list.map(function (s) { return rowStore(s, my && s.id !== my.id ? dist(G.miles(my, s), s) : ''); }).join('') + '</div>';
    html += '<div class="am-acts"><button class="am-btn" data-act="copylist">' + ICON.copy + 'Copy the list</button><button class="am-btn" data-act="csv">' + ICON.down + 'Download (CSV)</button></div>';
    html += '<p class="am-note">Tap anywhere inside the area on the map to see the stores nearest that spot.</p>';
    return html;
  }

  function viewStore(s) {
    var a = areaById[s.area], my = mine && storeById[mine];
    var html = upButton('Area ' + a.id, 'area=' + a.id) +
      '<div class="am-h"><h2>' + esc(s.name) + '</h2></div>' +
      '<div class="am-chips"><button class="am-chip" data-go="area=' + esc(a.id) + '"><i class="am-dot" style="--c:var(--c' + a.color + ')"></i>Area ' + esc(a.id) + '</button>' +
      '<span class="am-chip" style="cursor:default">' + esc(where(s.country)) + '</span>' + (s.id === mine ? '<span class="am-tag" style="align-self:center">My store</span>' : '') + '</div>' +
      '<p class="am-addr">' + esc(s.address) + '<br>' + esc(s.postcode) + '</p>' +
      '<div class="am-acts">' +
      '<a class="am-btn am-main-btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('Screwfix ' + s.name + ', ' + s.address + ', ' + s.postcode) + '">' + ICON.dir + 'Directions</a>' +
      '<button class="am-btn" data-act="copyaddr">' + ICON.copy + 'Copy address</button>' +
      '<button class="am-btn" data-act="mine" aria-pressed="' + (s.id === mine) + '">' + ICON.star + (s.id === mine ? 'My store' : 'Set as my store') + '</button></div>';
    if (my && my.id !== s.id) html += '<p class="am-note">' + esc(dist(G.miles(my, s), s)) + ' from ' + esc(my.name) + ' as the crow flies.</p>';
    if (s.approx) html += '<p class="am-note">The pin is roughly placed (from the postcode area). Directions use the full address, so they go to the door.</p>';
    html += '<div class="am-label">Nearest stores</div><div class="am-list">' +
      G.nearest(data.stores, s, 7).slice(1).map(function (n) { return rowStore(n.store, dist(n.miles, s), true); }).join('') + '</div>';
    return html;
  }

  function viewPlace() {
    var a = cur.areaId && areaById[cur.areaId];
    var nearest = G.nearest(data.stores, cur.at, 8);
    var title = cur.name || 'This spot';
    var html = upButton(a ? 'Area ' + a.id : 'All areas', a ? 'area=' + a.id : '') +
      '<div class="am-h"><h2>' + esc(title) + '</h2></div>' +
      (a ? '<div class="am-chips"><button class="am-chip" data-go="area=' + esc(a.id) + '"><i class="am-dot" style="--c:var(--c' + a.color + ')"></i>In Area ' + esc(a.id) + '</button></div>'
        : '<p class="am-sub">Not inside any area on the map (at sea, or off the coastline the map uses). Nearest store: Area ' + esc(nearest[0].store.area) + '.</p>') +
      '<div class="am-label">Nearest stores</div><div class="am-list">' +
      nearest.map(function (n) { return rowStore(n.store, dist(n.miles, n.store), true); }).join('') + '</div>' +
      '<p class="am-note">Distances are as the crow flies.</p>';
    return html;
  }

  function render() {
    var v = $('view');
    if (query) { v.innerHTML = viewSearch(); return; }
    if (cur.view === 'area') v.innerHTML = viewArea(areaById[cur.areaId]);
    else if (cur.view === 'store') v.innerHTML = viewStore(storeById[cur.storeId]);
    else if (cur.view === 'place') v.innerHTML = viewPlace();
    else v.innerHTML = viewHome();
    v.scrollTop = 0;
  }

  /* ---------- search ---------- */
  var placeState = { q: '', list: null, error: '' }, placeTimer, placeSeq = 0;
  function viewSearch() {
    var r = G.search(data, query), html = '';
    if (r.areas.length) html += '<div class="am-label">Areas</div><div class="am-list">' + r.areas.map(function (a) { return rowArea(a); }).join('') + '</div>';
    if (r.stores.length) {
      html += '<div class="am-label">' + (r.stores.length === 1 ? 'Store' : plural(r.stores.length, 'store', 'stores')) + '</div><div class="am-list">' +
        r.stores.slice(0, 40).map(function (s) { return rowStore(s, '', true); }).join('') + '</div>';
      if (r.stores.length > 40) html += '<p class="am-note">And ' + (r.stores.length - 40) + ' more: add a word to narrow it down.</p>';
    }
    var kind = G.looksLikePlace(query);
    if (kind && placeState.q === query.trim()) {
      if (placeState.list && placeState.list.length) {
        html += '<div class="am-label">Places' + (r.stores.length ? '' : '') + '</div><div class="am-list">' + placeState.list.map(function (p) {
          return '<button class="am-row" data-go="at=' + p.lat.toFixed(5) + ',' + p.lng.toFixed(5) + ',' + esc(encodeURIComponent(p.name)) + '"><span><b>' + esc(p.name) + '</b><small>' + esc(p.sub) + '</small></span><em>' + ICON.pin.replace('<svg ', '<svg width="18" height="18" ') + '</em></button>';
        }).join('') + '</div><p class="am-note">Tap a place for the stores nearest it and the area it\'s in.</p>';
      } else if (placeState.error) html += '<p class="am-note">' + esc(placeState.error) + '</p>';
      else if (placeState.list) { if (!r.stores.length && !r.areas.length) html += '<p class="am-empty">Nothing found for &ldquo;' + esc(query) + '&rdquo;.</p>'; }
    } else if (kind) html += '<p class="am-note">Looking for places called &ldquo;' + esc(query.trim()) + '&rdquo;&hellip;</p>';
    if (!html) html = '<p class="am-empty">Nothing found for &ldquo;' + esc(query) + '&rdquo;. Try a store name, a town, a postcode or an area number.</p>';
    return html;
  }

  // UK places and postcodes, from postcodes.io (free, no key). Ireland's Eircodes aren't covered.
  function lookupPlaces(q) {
    var kind = G.looksLikePlace(q), base = 'https://api.postcodes.io/';
    var url = kind === 'postcode' ? base + 'postcodes/' + encodeURIComponent(q) : kind === 'outcode' ? base + 'outcodes/' + encodeURIComponent(q) : base + 'places?limit=8&q=' + encodeURIComponent(q);
    return fetch(url).then(function (r) {
      if (r.status === 404) return { result: null };
      if (!r.ok) throw new Error('status ' + r.status);
      return r.json();
    }).then(function (j) {
      var res = j.result;
      if (!res) return [];
      if (kind === 'postcode') return res.latitude == null ? [] : [{ name: res.postcode, sub: [res.admin_ward, res.admin_district].filter(Boolean).join(', '), lat: res.latitude, lng: res.longitude }];
      if (kind === 'outcode') return res.latitude == null ? [] : [{ name: res.outcode, sub: (res.admin_district || []).slice(0, 3).join(', '), lat: res.latitude, lng: res.longitude }];
      var seen = {};
      return res.filter(function (p) { return p.latitude != null; }).map(function (p) {
        return { name: p.name_1, sub: [p.local_type, p.district_borough || p.county_unitary, p.region || p.country].filter(Boolean).join(', '), lat: p.latitude, lng: p.longitude };
      }).filter(function (p) { var k = p.name + '|' + p.sub; if (seen[k]) return false; seen[k] = 1; return true; });
    });
  }
  function onSearch() {
    query = $('q').value;
    $('clear').hidden = !query;
    render();
    clearTimeout(placeTimer);
    var q = query.trim();
    if (!G.looksLikePlace(q) || placeState.q === q) return;
    var seq = ++placeSeq;
    placeTimer = setTimeout(function () {
      lookupPlaces(q).then(function (list) {
        if (seq !== placeSeq) return;
        placeState = { q: q, list: list, error: '' };
        if (query.trim() === q) render();
      }, function () {
        if (seq !== placeSeq) return;
        placeState = { q: q, list: null, error: "Couldn't look up places just now (no signal?). Store names still work." };
        if (query.trim() === q) render();
      });
    }, G.looksLikePlace(q) === 'place' ? 450 : 250);
  }
  function clearSearch() {
    if (!query && !$('q').value) return;
    $('q').value = ''; query = ''; $('clear').hidden = true;
    $('q').blur();
  }

  /* ---------- taps in the panel ---------- */
  function onPanelClick(e) {
    var t = e.target.closest('[data-go],[data-filter],[data-asort],[data-ssort],[data-act]');
    if (!t) return;
    if (t.hasAttribute('data-go')) { go(t.getAttribute('data-go')); return; }
    if (t.hasAttribute('data-filter')) {
      filter = t.getAttribute('data-filter');
      render(); styleAll(); fitHome(); requestAnimationFrame(placeLabels);
      return;
    }
    if (t.hasAttribute('data-asort')) { areaSort = t.getAttribute('data-asort'); render(); return; }
    if (t.hasAttribute('data-ssort')) { storeSort = t.getAttribute('data-ssort'); var top = $('view').scrollTop; render(); $('view').scrollTop = top; return; }
    var act = t.getAttribute('data-act');
    if (act === 'copyaddr') { var s = storeById[cur.storeId]; copyText('Screwfix ' + s.name + '\n' + s.address + '\n' + s.postcode, 'Address copied'); }
    if (act === 'mine') {
      mine = mine === cur.storeId ? null : cur.storeId;
      save(KEY_MINE, mine);
      toast(mine ? 'Saved as my store on this phone' : 'No longer my store');
      render(); styleAll(); requestAnimationFrame(placeLabels);
    }
    if (act === 'copylist') {
      var a = areaById[cur.areaId];
      copyText('Area ' + a.id + ' (' + a.list.length + ' stores)\n\n' + a.list.map(function (x) { return x.name + '\n' + x.address + ', ' + x.postcode; }).join('\n\n'), 'List copied');
    }
    if (act === 'csv') {
      var b = areaById[cur.areaId], blob = new Blob([G.csv(b.list)], { type: 'text/csv' }), link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = 'screwfix-area-' + b.id + '.csv';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 5000);
    }
  }

  /* ---------- near me ---------- */
  function nearMe() {
    if (!navigator.geolocation) { toast("This phone can't share its location"); return; }
    toast('Finding where you are…');
    navigator.geolocation.getCurrentPosition(function (p) {
      $('toast').classList.remove('am-show');
      go('at=' + p.coords.latitude.toFixed(5) + ',' + p.coords.longitude.toFixed(5) + ',' + encodeURIComponent('You are here'));
    }, function (err) {
      toast(err.code === 1 ? 'Location is switched off for this site' : "Couldn't find where you are");
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 });
  }

  /* ---------- start ---------- */
  function start(stores, areas) {
    data = G.setup(stores, areas);
    data.stores.forEach(function (s) { storeById[s.id] = s; });
    data.areas.forEach(function (a) { areaById[a.id] = a; });
    if (mine && !storeById[mine]) mine = null;
    setSnap('half');
    initMap();
    cur = parse();
    render();
    styleAll();
    // open on whatever the link asks for, else the whole map
    if (cur.view === 'home') fitHome(); else route(true);
    requestAnimationFrame(placeLabels);

    window.addEventListener('hashchange', function () { route(true); });
    window.addEventListener('popstate', function () { if (!location.hash) route(true); });
    $('view').addEventListener('click', onPanelClick);
    $('q').addEventListener('input', onSearch);
    $('q').addEventListener('focus', function () { if (!wide.matches) setSnap('full'); });
    $('q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var first = $('view').querySelector('[data-go]:not(.am-up)'); if (first) first.click(); }
      if (e.key === 'Escape') { clearSearch(); render(); }
    });
    $('clear').addEventListener('click', function () { clearSearch(); render(); $('q').focus(); });
    $('near').addEventListener('click', nearMe);
    $('all').addEventListener('click', function () { if (cur.view !== 'home') go(''); fitHome(); });
    $('style').addEventListener('click', function () { setStreet(!street); });
    var resized = function () { if (!wide.matches) setSnap(snap); else $('panel').style.height = ''; map.invalidateSize(); requestAnimationFrame(placeLabels); };
    window.addEventListener('resize', resized);
    if (wide.addEventListener) wide.addEventListener('change', resized);
    var light = window.matchMedia('(prefers-color-scheme: light)');
    if (light.addEventListener) light.addEventListener('change', function () { readColours(); styleAll(); });
    // the sign-in screen hides the page, so the map may have started at no size
    window.addEventListener('toolbox:login', function () { setTimeout(function () { map.invalidateSize(); setSnap(snap); if (cur.view === 'home') fitHome(); else route(true); }, 50); });
  }

  Promise.all(['area-map/data/stores.json', 'area-map/data/areas.json'].map(function (u) {
    return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ': ' + r.status); return r.json(); });
  })).then(function (d) { start(d[0], d[1].areas); }, function () {
    $('view').innerHTML = '<p class="am-empty am-err">Couldn\'t load the store list. Check you have signal, then reload the page.</p>';
  });
})();
