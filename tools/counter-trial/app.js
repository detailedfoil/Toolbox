/* A25 Behind counter trial: the tickets whose screwfix.com price no longer matches the shelf.
 * The GitHub check (.github/workflows/counter-trial.yml, by hand only for now) saves
 * counter-trial/data/prices.json; the ticket list, with the price printed on each, is
 * counter-trial/data/plan.json.
 *
 * A ticket is "to update" while its latest online price differs from its shelf price. The shelf
 * price starts as the printed price in plan.json; ticking a line off records the new price as the
 * shelf price on this device, so it only comes back if the price moves again. If the price moves
 * twice before you get to it, you just see the latest one. */
(function () {
  'use strict';

  var RAW = 'https://raw.githubusercontent.com/detailedfoil/Toolbox/main/tools/counter-trial/data/';
  var RUNS = 'https://github.com/detailedfoil/Toolbox/actions/workflows/counter-trial.yml';
  var SHELF_KEY = 'ct-shelf-v1', LOG_KEY = 'ct-log-v1', TAB_KEY = 'ct-tab-v1';

  var $ = function (id) { return document.getElementById(id); };
  var src = null, loadedAt = 0;
  // this copy's version (from the ?v= it was loaded with), when it was opened, and a newer one if the site has it
  var APP_V = (function () { var m = /[?&]v=([^&#]+)/.exec((document.currentScript && document.currentScript.src) || ''); return m ? m[1] : ''; })();
  var OPENED = Date.now(), newerV = '';

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: keep going */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(v) { return '£' + Number(v).toFixed(2); }
  function same(a, b) { return a != null && b != null && Math.abs(a - b) < 0.001; }

  /* ---------- dates (UK) ---------- */

  function london() {
    var p = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return { date: p.year + '-' + p.month + '-' + p.day, hour: +p.hour };
    } catch (e) {
      var d = new Date();
      return { date: d.toISOString().slice(0, 10), hour: d.getHours() };
    }
  }
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function utc(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
  function day(s) { var d = utc(s); return d ? DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] : ''; }   // Tue 13 Oct
  function daysAgo(s) { var a = utc(s), b = utc(london().date); return a && b ? Math.round((b - a) / 864e5) : null; }
  function when(s) {
    var n = daysAgo(s);
    if (n == null) return '';
    return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 7 ? day(s).split(' ')[0] + ', ' + n + ' days ago' : day(s) + ', ' + n + ' days ago';
  }

  /* ---------- loading: the site's copy, and GitHub's own copy (fresher if the site hasn't rebuilt yet) ---------- */

  function getJSON(url) {
    return fetch(url + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function from(base) {
    return Promise.all([getJSON(base + 'plan.json'), getJSON(base + 'prices.json')])
      .then(function (r) { return { plan: r[0], prices: r[1] }; }, function () { return null; });
  }
  function stamp(p) { var t = Date.parse((p.run && p.run.finished) || p.checked || ''); return isFinite(t) ? t : 0; }

  function refresh() {
    loadedAt = Date.now();
    return Promise.all([from('counter-trial/data/'), from(RAW), pullTicks()]).then(function (res) {
      var got = res.filter(function (r) { return r && r.plan && r.plan.lines && r.prices; })
                   .sort(function (a, b) { return stamp(b.prices) - stamp(a.prices); })[0];
      if (!got) throw new Error('no data');
      src = got;
      render();
    }).catch(function () {
      if (src) return;                                   // keep showing what we had
      $('meta').hidden = true;
      $('error').hidden = false;
      $('error').textContent = "The latest check couldn't be loaded. Check your connection and refresh the page.";
    });
  }

  /* ---------- shelf prices: printed price, unless a change has been ticked off on this device ---------- */

  function confirmed() { var v = load(SHELF_KEY, {}); return v && typeof v === 'object' ? v : {}; }

  /* prices read on this device (Check on this device); a line uses whichever reading is newer, GitHub's or the phone's */
  // v2: readings from before a change had to be confirmed by the page's product data are dropped
  var PHONE_KEY = 'ct-phone-prices-v2', PHONE_LAST_KEY = 'ct-phone-last-v2', PHONE_RUN_KEY = 'ct-phone-run-v2';
  function phonePrices() { var v = load(PHONE_KEY, {}); return v && typeof v === 'object' ? v : {}; }
  function phoneLast() { var v = load(PHONE_LAST_KEY, null); return v && v.at ? v : null; }
  function ghFinished() { var r = (src && src.prices && src.prices.run) || {}; var t = Date.parse(r.finished || ''); return isFinite(t) ? t : 0; }
  function ghTime(p) {
    if (!p || !p.on) return 0;
    var r = src.prices.run || {};
    if (p.on === r.date && r.finished) return Date.parse(r.finished);
    return Date.parse(p.on + 'T06:00:00Z');
  }

  function lines() {
    var P = (src.prices && src.prices.products) || {}, mine = confirmed(), ph = phonePrices(), seen = {};
    // the lines the latest check couldn't read: the device check's misses, or GitHub's when its run is newer
    var last = phoneLast(), devNewer = !!last && Date.parse(last.at) > ghFinished(), lastAt = last ? Date.parse(last.at) : 0;
    var missedSet = {};
    if (devNewer) (last.failed || []).forEach(function (c) { missedSet[c] = 1; });
    return src.plan.lines.filter(function (l) { if (seen[l.code]) return false; seen[l.code] = 1; return true; }).map(function (l, i) {
      var p = P[l.code] || {}, c = mine[l.code], q = ph[l.code];
      var shelf = c && c.price != null ? c.price : l.shelf;
      var phone = !!(q && q.price != null && Date.parse(q.at) > ghTime(p));
      var price = phone ? q.price : p.price != null ? p.price : null;
      var status = phone ? 'ok' : p.status || 'unchecked';
      return {
        i: i, code: l.code, sheet: l.sheet, name: (phone && q.name) || p.name || l.name, shelf: shelf, printed: l.shelf,
        price: price, since: phone ? q.since : p.since || null, status: status, was: phone ? q.was : p.was, moves: phone ? [] : p.moves || [],
        phone: phone, manual: !!(phone && q.manual),
        missed: devNewer ? !!missedSet[l.code] && !(q && Date.parse(q.at) > lastAt) : status === 'unchecked' || price == null,
        seen: devNewer && last.seen && last.seen[l.code] != null ? last.seen[l.code] : null,
        todo: price != null && status !== 'not_found' && !same(price, shelf)
      };
    });
  }

  /* ---------- page ---------- */

  var ARROW_UP = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5 9 8.5H1z" fill="currentColor"/></svg>';
  var ARROW_DOWN = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8.5 9 1.5H1z" fill="currentColor"/></svg>';
  var WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';

  var L = [], todo = [];

  function render() {
    var pr = src.prices, run = pr.run || {}, now = london();
    L = lines();
    // oldest change first: the ones you've been sitting on longest go to the top
    todo = L.filter(function (l) { return l.todo; }).sort(function (a, b) { return String(a.since || '').localeCompare(String(b.since || '')) || a.i - b.i; });

    $('error').hidden = true;
    var nw = function (s) { return '<span class="sc-nw">' + esc(s) + '</span>'; };
    var ph = phoneLast(), phoneNewer = !!ph && Date.parse(ph.at) > ghFinished();
    $('meta').innerHTML = phoneNewer
      ? 'Last checked <b>' + nw(day(londonDay(ph.at))) + '</b> at ' + nw(time(ph.at)) + ', on this device.'
      : pr.checked ? 'Last checked <b>' + nw(day(pr.checked)) + '</b>' + (run.finished ? ' at ' + nw(time(run.finished)) : '') + '.' : 'Not checked yet. The first check runs a few minutes after setup.';

    // anything to warn about
    var alerts = [], checkedOk = run.complete !== false;
    if (phoneNewer) {
      var miss = ph.total - ph.done;
      if (miss > 0) alerts.push('The check on this device got ' + ph.done + ' of ' + ph.total + '. ' +
        (miss === 1 ? 'The other one keeps its last price. Tap <b>Retry</b> to try it again, or type its price in under <b>Couldn\'t be read</b>.' : 'The other ' + miss + ' keep their last price. Tap <b>Retry</b> to try just those, or type the prices in under <b>Couldn\'t be read</b>.'));
    } else if (false) {                                    // nightly GitHub runs are off for now, so nothing is overdue
      alerts.push("Today's check hasn't come in yet, so these prices are from " + esc(day(pr.checked)) + '. <a href="' + RUNS + '" target="_blank" rel="noopener">See the runs on GitHub</a>');
    } else if (pr.checked && !checkedOk) {
      var left = run.unchecked || 0;
      // nightly GitHub runs are off for now, so nothing gets tried again by itself
      alerts.push('The GitHub check got ' + (run.checked || 0) + ' of ' + (run.total || L.length) + '. ' +
        (left === 1 ? 'The other one keeps its last price' : 'The other ' + left + ' keep their last price') +
        (/slow down|429|202/.test(run.stopped || '') ? ' (Screwfix turned it away)' : '') + '. Tap <b>Check on this device</b> to read ' + (left === 1 ? 'it' : 'them') + '.');
    }
    $('alert').hidden = !alerts.length;
    $('alert').innerHTML = alerts.length ? WARN + '<div>' + alerts.join('<br>') + '</div>' : '';

    var n = todo.length, up = todo.filter(function (l) { return l.price > l.shelf; }).length;
    var done = phoneNewer ? ph.done : L.filter(function (l) { return l.status === 'ok' || l.status === 'not_found'; }).length;
    var nf = L.filter(function (l) { return l.status === 'not_found'; }).length;
    $('stats').innerHTML =
      '<div class="sc-stat' + (n ? ' is-hot' : '') + '"><span class="sc-stat-v">' + n + '</span><span class="sc-stat-k">to update' +
        (n ? '<span class="sc-split" title="' + up + ' up, ' + (n - up) + ' down"><span>' + ARROW_UP + up + '</span><span>' + ARROW_DOWN + (n - up) + '</span></span>' : '') + '</span></div>' +
      '<div class="sc-stat"><span class="sc-stat-v">' + done + '<small>/' + L.length + '</small></span><span class="sc-stat-k">checked last ' + (phoneNewer ? 'time' : 'run') + '</span></div>' +
      '<div class="sc-stat"><span class="sc-stat-v">' + nf + '</span><span class="sc-stat-k">not found online</span></div>';
    $('nTodo').textContent = ' ' + n;
    $('nAll').textContent = ' ' + L.length;

    renderTodo();
    renderMissed();
    renderDone();
    renderAll();

    statusLine();
    $('foot').innerHTML = 'Checks every ticket whenever you tap Check on this device or Check on GitHub. Lines it can\'t check keep their last price and never show as a change. ' +
      'Ticks are saved on this device. <a href="' + RUNS + '" target="_blank" rel="noopener">Runs on GitHub</a>' +
      (token() ? ' &middot; <a href="#" data-forget>Remove saved GitHub token</a>' : '');
    $('main').hidden = false;
    showTab(load(TAB_KEY, 'todo'));
  }

  function londonDay(isoStamp) {
    try {
      var p = {};
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date(isoStamp)).forEach(function (x) { p[x.type] = x.value; });
      return p.year + '-' + p.month + '-' + p.day;
    } catch (e) { return String(isoStamp).slice(0, 10); }
  }
  function time(isoStamp) {
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(isoStamp)); } catch (e) { return ''; }
  }

  function tag(l) {
    var t = '<span class="sc-tag">' + (l.price > l.shelf ? ARROW_UP + 'UP' : ARROW_DOWN + 'DOWN') + '</span>';
    if (l.was) t += '<span class="sc-tag is-offer" title="On offer, was ' + money(l.was) + '">Offer</span>';
    return '<div class="sc-tags">' + t + '</div>';
  }

  // how many times it moved since the shelf price was last right
  function movesSince(l) {
    var m = l.moves, k = 0;
    for (var j = m.length - 1; j >= 0; j--) { k++; if (same(m[j].from, l.shelf)) return k; }
    return 0;
  }

  function renderTodo() {
    $('todoList').innerHTML = todo.map(function (l) {
      var k = movesSince(l);
      return '<li class="sc-row is-changed ct-row" data-code="' + esc(l.code) + '">' +
        '<label class="sc-tick"><input type="checkbox" aria-label="Ticket updated for ' + esc(l.code) + '"><span></span></label>' +
        '<div><span class="sc-code">' + esc(l.code) + '</span><span class="sc-name">' + esc(l.name) + '</span>' +
        (l.since ? '<span class="ct-when">Changed <b>' + esc(when(l.since)) + '</b></span>' : '') +
        (k > 1 ? '<span class="ct-off">Changed ' + k + ' times since your ticket, showing the latest</span>' : '') + '</div>' +
        '<div class="sc-price"><span class="sc-now">' + money(l.price) + '</span><span class="sc-was">ticket <s>' + money(l.shelf) + '</s></span>' + tag(l) + '</div></li>';
    }).join('');
    var n = todo.length;
    $('todoList').hidden = !n;
    $('todoHead').hidden = !n;
    $('todoEmpty').hidden = !!n;
    $('todoEmpty').innerHTML = src.prices.checked
      ? '<strong>All tickets up to date</strong>Every price behind the counter matches screwfix.com.'
      : '<strong>Waiting for the first check</strong>Tap Check on this device to read every ticket.';
    $('todoHint').innerHTML = n ? 'Oldest first. Swap ' + (n === 1 ? 'this ticket' : 'these ' + n + ' tickets') + ', then tick ' + (n === 1 ? 'it' : 'each one') + ' off.' : '';
  }

  /* lines the last check couldn't read: type the price from screwfix.com in by hand */
  function renderMissed() {
    var miss = L.filter(function (l) { return l.missed; });
    $('missBox').hidden = !miss.length || (!src.prices.checked && !phoneLast());
    $('missCount').textContent = miss.length;
    $('missList').innerHTML = miss.map(function (l) {
      return '<li class="sc-row ct-miss" data-code="' + esc(l.code) + '"><div>' +
        '<a class="sc-code ct-sfx" href="https://www.screwfix.com/p/product/' + esc(l.code.toLowerCase()) + '" target="_blank" rel="noopener">' + esc(l.code) + ' &#8599;</a>' +
        '<span class="sc-name">' + esc(l.name) + '</span>' +
        '<span class="ct-when">' + (l.seen != null ? 'Screwfix showed <b>' + money(l.seen) + '</b> but it couldn\'t be confirmed. Check it, then Save'
                                   : l.price != null ? 'Last price ' + money(l.price) : 'No price yet') + ' &middot; ticket ' + money(l.shelf) + '</span></div>' +
        '<form class="ct-enter" novalidate><label class="ct-pound"><span aria-hidden="true">£</span>' +
        '<input type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"' + (l.seen != null ? ' value="' + Number(l.seen).toFixed(2) + '"' : '') +
        ' aria-label="Price on screwfix.com for ' + esc(l.code) + '"></label>' +
        '<button class="btn" type="submit">Save</button></form></li>';
    }).join('');
  }

  function enterPrice(code, raw) {
    var v = String(raw || '').replace(/[£,\s]/g, '');
    if (!/^\d{1,5}(\.\d{1,2})?$/.test(v) || !(Number(v) > 0)) return false;
    var price = Math.round(Number(v) * 100) / 100, l = L.filter(function (x) { return x.code === code; })[0];
    var ph = phonePrices(), moved = l && l.price != null && !same(l.price, price);
    ph[code] = { price: price, name: (l && l.name) || null, was: null, at: new Date().toISOString(),
                 since: moved || !l || l.price == null ? london().date : l.since || london().date, manual: true };
    store(PHONE_KEY, ph);
    // it's been read now: take it out of any retry waiting on the button
    var r = load(PHONE_RUN_KEY, null);
    if (r && Array.isArray(r.codes)) {
      r.codes = r.codes.filter(function (c) { return c !== code; });
      if (r.codes.length) store(PHONE_RUN_KEY, r); else { try { localStorage.removeItem(PHONE_RUN_KEY); } catch (e) { /* fine */ } }
    }
    var last = phoneLast();
    if (last && (last.failed || []).indexOf(code) >= 0) {
      last.failed = last.failed.filter(function (c) { return c !== code; });
      last.done = Math.min(last.total, last.done + 1);
      store(PHONE_LAST_KEY, last);
    }
    render();
    toast(code + ' saved at ' + money(price) + (l && !same(l.shelf, price) ? ', added to To update' : ', matches the ticket'));
    return true;
  }

  $('missList').addEventListener('submit', function (e) {
    e.preventDefault();
    var row = e.target.closest('[data-code]'), input = e.target.querySelector('input');
    if (!row || !input) return;
    if (!enterPrice(row.getAttribute('data-code'), input.value)) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      toast('Type the price like 31.99');
    }
  });
  $('missList').addEventListener('input', function (e) { if (e.target.tagName === 'INPUT') e.target.removeAttribute('aria-invalid'); });

  function renderDone() {
    var log = load(LOG_KEY, []);
    log = Array.isArray(log) ? log.slice(-15).reverse() : [];
    $('doneBox').hidden = !log.length;
    $('doneList').innerHTML = log.map(function (e) {
      var l = L.filter(function (x) { return x.code === e.code; })[0];
      return '<li class="sc-row"><div><span class="sc-code">' + esc(e.code) + '</span><span class="sc-name">' + esc(l ? l.name : '') + '</span>' +
        '<span class="ct-when">' + money(e.from) + ' to ' + money(e.to) + ', ticked ' + esc(when(e.on)) + '</span></div>' +
        '<button class="btn ct-undo" type="button" data-undo="' + esc(e.code) + '" data-at="' + esc(e.at) + '">Undo</button></li>';
    }).join('');
  }

  function renderAll() {
    $('allList').innerHTML = L.map(function (l) {
      var right;
      if (l.status === 'not_found') right = '<div class="sc-price"><span class="sc-na">not found online</span><span class="sc-was">ticket ' + money(l.shelf) + '</span></div>';
      else if (l.price == null) right = '<div class="sc-price"><span class="sc-na">not checked yet</span><span class="sc-was">ticket ' + money(l.shelf) + '</span></div>';
      else right = '<div class="ct-pair"><small>Ticket</small><small>Online</small><span class="' + (l.todo ? '' : 'is-muted') + '">' + money(l.shelf) + '</span><span>' + money(l.price) + '</span></div>';
      return '<li class="sc-row' + (l.todo ? ' is-changed' : '') + '" data-q="' + esc((l.code + ' ' + l.name).toLowerCase()) + '">' +
        '<div><span class="sc-code">' + esc(l.code) + '</span><span class="sc-name">' + esc(l.name) + '</span>' +
        (l.manual ? '<span class="ct-when">Entered by hand</span>' : l.missed && l.price != null ? '<span class="sc-note">not rechecked last time</span>' : '') + '</div>' + right + '</li>';
    }).join('');
    if ($('search').value) search();
  }

  /* ---------- ticking off ---------- */

  function tickOff(code) {
    var l = L.filter(function (x) { return x.code === code; })[0];
    if (!l || l.price == null) return;
    var mine = confirmed(), before = mine[code] || null, at = String(Date.now());
    mine[code] = { price: l.price, on: london().date, at: Date.now() };
    store(SHELF_KEY, mine);
    ticksChanged();
    var log = load(LOG_KEY, []);
    if (!Array.isArray(log)) log = [];
    log.push({ code: code, from: l.shelf, to: l.price, on: london().date, at: at, before: before });
    store(LOG_KEY, log.slice(-40));
    toast(code + ' ticked off', function () { undo(code, at); });
  }
  function undo(code, at) {
    var log = load(LOG_KEY, []);
    if (!Array.isArray(log)) return;
    var idx = -1;
    for (var j = log.length - 1; j >= 0; j--) if (log[j].code === code && (!at || log[j].at === at)) { idx = j; break; }
    if (idx < 0) return;
    var e = log.splice(idx, 1)[0], mine = confirmed();
    // the change is written as a new entry, so it wins over the tick on other devices
    mine[code] = e.before && e.before.price != null ? { price: e.before.price, on: e.before.on, at: Date.now() } : { removed: true, at: Date.now() };
    store(SHELF_KEY, mine);
    ticksChanged();
    store(LOG_KEY, log);
    hideToast();
    render();
  }


  /* ---------- ticks shared across devices ----------
   * A tick is kept in this browser (ct-shelf-v1) and also written to tools/counter-trial/data/ticks.json in the repo, so every
   * device ends up with the same shelf prices. Reading needs nothing; writing needs the GitHub token saved on the device
   * (Contents: Read and write). Each entry has a time `at`; the newest wins. Undo and removal are written as new entries
   * ({removed: true}) so they win over an older tick elsewhere. Without a token, or if the write fails, the tick stays on this
   * device, is marked waiting (ct-ticks-dirty-v1), and goes up the next time the page opens with a working token. */

  var TICKS_URL = 'https://api.github.com/repos/detailedfoil/Toolbox/contents/tools/counter-trial/data/ticks.json';
  var DIRTY_KEY = 'ct-ticks-dirty-v1';
  var syncState = { kind: '', msg: '' }, pushing = null, pushAgain = false;

  function dirty() { return !!load(DIRTY_KEY, false); }
  function mergeTicks(a, b) {
    var out = {};
    [a, b].forEach(function (m) {
      Object.keys(m || {}).forEach(function (c) {
        var e = m[c];
        if (!e || typeof e !== 'object') return;
        if (!out[c] || (+e.at || 0) >= (+out[c].at || 0)) out[c] = e;
      });
    });
    return out;
  }
  function same_(a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }
  function ticksCount() { var m = confirmed(); return Object.keys(m).filter(function (c) { return m[c] && m[c].price != null; }).length; }

  function syncShow(kind, msg) {
    syncState = { kind: kind, msg: msg || '' };
    var el = $('syncNote');
    if (!el) return;
    var h = '';
    if (kind === 'ok') h = 'Ticks are saved to GitHub, so every device you use shows the same ones.';
    else if (kind === 'none') h = 'Ticks made here only save on this device. You still see ticks made on your other devices. <button class="ct-inline" data-sync="1" type="button">Turn on syncing</button>';
    else if (kind === 'wait') h = 'Saving ticks to GitHub…';
    else if (kind === 'bad') h = esc(msg) + ' Ticks are kept on this device meanwhile. <button class="ct-inline" data-sync="1" type="button">Fix syncing</button>';
    el.innerHTML = h;
    el.className = 'sc-hint ct-sync' + (kind === 'bad' ? ' is-bad' : '');
    el.hidden = !h;
  }
  function syncIdle() { syncShow(!token() ? 'none' : dirty() ? 'bad' : 'ok', dirty() ? 'Some ticks are waiting to be saved to GitHub.' : ''); }

  function ticksChanged() {
    store(DIRTY_KEY, true);
    if (!token()) { syncShow('none'); return; }
    pushTicks();
  }

  /* write the merged ticks to the repo; resolves to '' on success or a sentence saying what went wrong */
  function pushTicks(tries) {
    if (pushing) { pushAgain = true; return pushing; }
    var t = token();
    if (!t) { syncShow('none'); return Promise.resolve('no token'); }
    syncShow('wait');
    var n = tries || 0;
    pushing = fetch(TICKS_URL + '?ref=main&t=' + Date.now(), { headers: ghHeaders(t), cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return { sha: null, ticks: {} };
      if (r.status === 401) throw new Error("GitHub didn't accept the token.");
      if (!r.ok) throw new Error('GitHub said no (HTTP ' + r.status + ').');
      return r.json().then(function (j) {
        var cur = {};
        try { cur = (JSON.parse(atob(String(j.content || '').replace(/\s/g, ''))) || {}).ticks || {}; } catch (e) { /* unreadable: replace it */ }
        return { sha: j.sha, ticks: cur };
      });
    }).then(function (remote) {
      var merged = mergeTicks(confirmed(), remote.ticks);
      store(SHELF_KEY, merged);
      var body = { message: 'Ticks updated [skip ci]', branch: 'main', content: btoa(JSON.stringify({ updated: new Date().toISOString(), ticks: merged }, null, 1) + '\n') };
      if (remote.sha) body.sha = remote.sha;
      return fetch(TICKS_URL, { method: 'PUT', headers: ghHeaders(t), cache: 'no-store', body: JSON.stringify(body) }).then(function (r) {
        if (r.status === 200 || r.status === 201) return '';
        if (r.status === 409 || r.status === 422) return 'retry';
        if (r.status === 401) return "GitHub didn't accept the token. It may have expired.";
        if (r.status === 403 || r.status === 404) return "The token isn't allowed to save files. It needs Contents: Read and write on the Toolbox repo.";
        return 'GitHub said no (HTTP ' + r.status + ').';
      });
    }).then(function (res) {
      if (res === 'retry' && n < 3) { pushing = null; return pushTicks(n + 1); }
      if (res === 'retry') res = 'Two devices saved at once. It will try again next time.';
      return res;
    }, function (e) {
      return e && /token|GitHub said/.test(e.message) ? e.message : "Couldn't reach GitHub.";
    }).then(function (res) {
      pushing = null;
      if (!res) { try { localStorage.removeItem(DIRTY_KEY); } catch (e) { /* fine */ } }
      var again = pushAgain; pushAgain = false;
      if (again && !res) return pushTicks();
      syncShow(res ? 'bad' : 'ok', res);
      if (src) render();
      return res;
    });
    return pushing;
  }

  /* pull the shared ticks into this device (called with every refresh) */
  function pullTicks() {
    var one = function (u) { return getJSON(u).then(function (j) { return j && j.ticks ? j : null; }, function () { return null; }); };
    return Promise.all([one('counter-trial/data/ticks.json'), one(RAW + 'ticks.json')]).then(function (rs) {
      var best = rs.filter(Boolean).sort(function (a, b) { return Date.parse(b.updated || 0) - Date.parse(a.updated || 0); })[0];
      var local = confirmed(), remote = best ? best.ticks : {};
      var merged = mergeTicks(local, remote);
      if (!same_(merged, local)) store(SHELF_KEY, merged);
      // anything here that GitHub doesn't have yet (older ticks from before syncing, or ones made offline) is sent up
      if (!same_(merged, remote) && Object.keys(merged).length) store(DIRTY_KEY, true);
    }, function () { /* offline: use what's on the device */ }).then(function () {
      if (dirty() && token()) return pushTicks();
      syncIdle();
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-sync]');
    if (b) setupSheet(syncState.kind === 'bad' ? syncState.msg : '', true);
  });
  $('todoList').addEventListener('change', function (e) {
    var row = e.target.closest('[data-code]');
    if (!row || !e.target.checked) return;
    var code = row.getAttribute('data-code');
    row.classList.add('is-leaving');
    setTimeout(function () { tickOff(code); render(); }, 260);
  });
  $('doneList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-undo]');
    if (b) undo(b.getAttribute('data-undo'), b.getAttribute('data-at'));
  });

  $('copy').addEventListener('click', function () {
    var text = todo.map(function (l) { return l.code; }).join('\n');
    var ok = function () { toast(todo.length + ' code' + (todo.length === 1 ? '' : 's') + ' copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); ok(); } catch (x) { toast("Couldn't copy on this device"); }
      t.remove();
    }
  });

  /* ---------- search ---------- */

  function search() {
    var q = $('search').value.trim().toLowerCase(), qCode = q.replace(/o/g, '0'), hits = 0;   // codes never contain the letter O
    Array.prototype.forEach.call($('allList').querySelectorAll('.sc-row'), function (r) {
      var t = r.getAttribute('data-q'), ok = !q || t.indexOf(q) >= 0 || t.split(' ')[0].indexOf(qCode) >= 0;
      r.hidden = !ok;
      if (ok) hits++;
    });
    $('searchHint').hidden = !q;
    $('searchHint').textContent = hits ? hits + ' ticket' + (hits === 1 ? '' : 's') + ' found' : 'Nothing on the trial matches that.';
  }
  $('search').addEventListener('input', search);

  /* ---------- tabs ---------- */

  function showTab(name) {
    if (name !== 'all') name = 'todo';
    Array.prototype.forEach.call(document.querySelectorAll('.sc-tabs button'), function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('tab-todo').hidden = name !== 'todo';
    $('tab-all').hidden = name !== 'all';
  }
  document.querySelector('.sc-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    showTab(b.getAttribute('data-tab'));
    store(TAB_KEY, b.getAttribute('data-tab'));
  });

  /* ---------- toast ---------- */

  var toastTimer = 0, undoFn = null;
  function toast(msg, onUndo) {
    clearTimeout(toastTimer);
    undoFn = onUndo || null;
    $('toastMsg').textContent = msg;
    $('toastUndo').hidden = !onUndo;
    $('toast').classList.add('show');
    toastTimer = setTimeout(hideToast, onUndo ? 6000 : 3500);
  }
  function hideToast() { clearTimeout(toastTimer); undoFn = null; $('toast').classList.remove('show'); }
  $('toastUndo').addEventListener('click', function () { if (undoFn) undoFn(); });

  /* ---------- check now: starts the GitHub Action straight away ----------
   * With a GitHub token saved on this device (fine-grained, Toolbox repo only, Actions read and write)
   * the button starts a full check itself. Without one it opens the Action on GitHub, where
   * "Run workflow" does the same. The token is only ever kept in this browser. */

  var API = 'https://api.github.com/repos/detailedfoil/Toolbox/actions/workflows/counter-trial.yml';
  var TOKEN_KEY = 'ct-gh-token-v1';
  var running = false, pollTimer = 0, lastRun = null;

  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function ghHeaders(t) {
    var h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }
  function clock(d) { return time(d.toISOString()); }

  function runStatus() {
    return fetch(API + '/runs?per_page=1&t=' + Date.now(), { headers: ghHeaders(token()), cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { showRun((j.workflow_runs || [])[0] || null); })
      .catch(function () { /* status is a nice-to-have; the button still works */ });
  }

  function showRun(run) {
    var was = running;
    lastRun = run;
    running = !!run && run.status !== 'completed';
    statusLine();
    clearTimeout(pollTimer);
    if (running) pollTimer = setTimeout(function () { if (!document.hidden) runStatus(); else pollTimer = 0; }, 60000);
    // a check just finished: pull in the new prices (GitHub's copy can lag a few minutes)
    if (was && !running) { refresh(); setTimeout(refresh, 180000); toast('Check finished, prices updated'); }
  }

  function dispatch(t) {
    return fetch(API + '/dispatches', {
      method: 'POST', headers: ghHeaders(t), cache: 'no-store',
      body: JSON.stringify({ ref: 'main', inputs: { mode: 'full' } })
    }).then(function (r) {
      if (r.status === 204) return null;
      if (r.status === 401) return "GitHub didn't accept that token. It may have expired or been copied wrong.";
      if (r.status === 403 || r.status === 404) return "That token can't start the check. It needs the Toolbox repo and Actions: Read and write.";
      return "GitHub said no (HTTP " + r.status + "). Try again in a minute.";
    }, function () { return "Couldn't reach GitHub. Check your connection."; });
  }

  function started() {
    toast('Check started. It takes about 10 minutes.');
    showRun({ status: 'queued', created_at: new Date().toISOString() });
    setTimeout(runStatus, 6000);
  }

  $('runNow').addEventListener('click', function () {
    if (running) return;
    var t = token();
    if (!t) { setupSheet(); return; }
    if (!window.confirm('Start a full check of all ' + (L.length || 69) + ' tickets now?\n\nIt runs on GitHub and takes about 10 minutes.')) return;
    var btn = this;
    btn.classList.add('is-busy');
    dispatch(t).then(function (err) {
      btn.classList.remove('is-busy');
      if (!err) { started(); return; }
      if (/token/.test(err)) setupSheet(err); else toast(err);
    });
  });

  $('foot').addEventListener('click', function (e) {
    if (!e.target.closest('[data-forget]')) return;
    e.preventDefault();
    if (!window.confirm('Remove the GitHub token from this device? Check on GitHub will open GitHub instead until you add one again.')) return;
    try { localStorage.removeItem(TOKEN_KEY); } catch (x) { /* nothing saved */ }
    toast('Token removed from this device');
    syncIdle();
    render();
  });

  function setupSheet(err, forSync) {
    var wrap = document.createElement('div');
    wrap.className = 'sc-sheet ct-sheet';
    wrap.innerHTML = '<div class="sc-sheet-card" role="dialog" aria-modal="true" aria-labelledby="ctSheetH">' +
      (forSync ? '<h2 id="ctSheetH">Sync ticks across devices</h2>' +
      '<p>Save a GitHub token on this device once, and every tick you make is saved to GitHub, so all your devices show the same shelf prices. Do this once on each device. The token stays on that device and can only reach Toolbox.</p>'
      : '<h2 id="ctSheetH">Check on GitHub</h2>' +
      '<p>Starts a full check of all ' + (L.length || 69) + ' tickets straight away. It runs on GitHub and takes about 10 minutes.</p>' +
      '<a class="btn" href="' + RUNS + '" target="_blank" rel="noopener">Open on GitHub, then tap Run workflow</a>' +
      '<hr><h2>Make it one tap</h2>' +
      '<p>Save a GitHub token on this device once, and the Check on GitHub button starts it itself, and your ticks sync across devices. It stays on this device and can only reach Toolbox.</p>') +
      '<ol><li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Make a new fine-grained token</a> on GitHub.</li>' +
      '<li>Expiration: the longest it allows. <b>Repository access</b>: Only select repositories, then <b>Toolbox</b>.</li>' +
      '<li><b>Permissions</b>: Actions, <b>Read and write</b>, and Contents, <b>Read and write</b>. Nothing else.</li>' +
      '<li>Generate it, copy it, and paste it here.</li></ol>' +
      '<input id="ctTok" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_..." aria-label="GitHub token">' +
      '<p class="ct-err" id="ctErr"' + (err ? '' : ' hidden') + '>' + esc(err || '') + '</p>' +
      '<button class="btn btn-primary" id="ctSave" type="button">' + (forSync ? 'Save and sync' : 'Save and check now') + '</button>' +
      '<button class="ct-link" id="ctClose" type="button">Cancel</button></div>';
    function shut() { wrap.remove(); }
    wrap.addEventListener('click', function (e) { if (e.target === wrap) shut(); });
    document.body.appendChild(wrap);
    wrap.querySelector('#ctClose').addEventListener('click', shut);
    wrap.querySelector('#ctSave').addEventListener('click', function () {
      var t = wrap.querySelector('#ctTok').value.trim(), e = wrap.querySelector('#ctErr'), btn = this;
      if (!t) { e.hidden = false; e.textContent = 'Paste the token first.'; return; }
      btn.classList.add('is-busy');
      if (forSync) {
        // keep the token only if it can really save a file
        var old = token();
        try { localStorage.setItem(TOKEN_KEY, t); } catch (x) { /* private mode */ }
        store(DIRTY_KEY, true);
        pushTicks().then(function (res) {
          btn.classList.remove('is-busy');
          if (res) {
            try { if (old) localStorage.setItem(TOKEN_KEY, old); else localStorage.removeItem(TOKEN_KEY); } catch (x) { /* fine */ }
            syncIdle();
            e.hidden = false; e.textContent = res; return;
          }
          shut();
          toast('Syncing is on');
        });
        return;
      }
      dispatch(t).then(function (msg) {
        btn.classList.remove('is-busy');
        if (msg) { e.hidden = false; e.textContent = msg; return; }
        try { localStorage.setItem(TOKEN_KEY, t); } catch (x) { /* private mode: it still ran this once */ }
        shut();
        started();
        if (src) render();
      });
    });
  }

  /* the line above the two buttons: what's going on right now */
  function statusLine() {
    var bar = $('runBar'), s = $('runStatus'), gh = running && lastRun;
    bar.classList.toggle('is-running', !!gh);
    $('runNow').disabled = !!gh;
    $('runLabel').textContent = gh ? 'GitHub checking' : 'Check on GitHub';
    if (gh) {
      var start = new Date(lastRun.run_started_at || lastRun.created_at), done = new Date(start.getTime() + 125 * 60000);
      s.innerHTML = '<span class="ct-dot"></span><b>GitHub is checking</b>, started ' + esc(clock(start)) + '. ' +
        (lastRun.status === 'queued' ? 'Waiting to start.' : 'Should be done about ' + esc(clock(done)) + '.');
    } else {
      s.innerHTML = '<b>Check on this device</b> takes about 15 minutes with this page open. GitHub also checks every night.';
    }
    var r = phone ? null : savedRun();
    $('phoneLabel').textContent = !r ? 'Check on this device' : r.retry ? 'Retry the ' + r.codes.length + ' missed' : 'Carry on (' + r.codes.length + ' left)';
    $('phoneFresh').hidden = !r;
    $('phoneFresh').textContent = r && r.retry ? 'Check all ' + (L.length || 69) + ' again instead' : 'Start again from the first ticket';
  }

  /* ---------- check on this device: reads every ticket's price through the same relays as Price Tickets ----------
   * Runs in this page, one ticket at a time, while the page stays open. The screen is kept awake if the phone
   * allows it. If the phone locks or the page gets closed part way, the next tap carries on where it stopped. */

  var SL = window.ScrewfixLookup, phone = null, wakeLock = null;
  var PHONE_GAP = 3000;                                    // breather between one worker's tickets
  var PHONE_WORKERS = 3;                                   // tickets read at once; 3 at ~10 s each stays under jina's 20 a minute

  function savedRun() {
    var r = load(PHONE_RUN_KEY, null);
    if (!r || !Array.isArray(r.codes) || !r.codes.length || Date.now() - Date.parse(r.started) > 12 * 3600000) return null;
    return r;
  }
  function pounds(v) { if (v == null || v === '') return null; var n = Number(String(v).replace(/[£,\s]/g, '')); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }

  /* The price to trust from one reading, or null. The page's own product data for this code wins. Without it
   * (some relays only send the page's text), a price read off the text only counts if it hasn't changed: a
   * different price there could be another size or a product further down the page, so it waits for a
   * reading that can confirm it. */
  function readPrice(r, before) {
    if (r.ld && r.ldSure) return pounds(r.ld);
    var p = pounds(r.price), ref = before ? (before.price != null ? before.price : before.shelf) : null;
    return p != null && ref != null && same(p, ref) ? p : null;
  }

  function keepAwake() {
    if (!phone || !navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }, function () { wakeLock = null; });
  }
  function letSleep() { if (wakeLock) { try { wakeLock.release(); } catch (e) { /* already gone */ } } wakeLock = null; }

  /* relays that only ever fail hard in this run (need a key, can't reach Screwfix) get left out after two goes, so a
   * ticket that won't read doesn't wait on them. The relay that last worked on this phone is never left out. */
  var HARD = /^http-40[13]$|^relay-error$/;
  function skipList() {
    if (!phone) return [];
    var front = (load('pt-proxy-order-v1', []) || [])[0];
    return Object.keys(phone.relays).filter(function (id) { var r = phone.relays[id]; return id !== front && !r.ok && r.hard >= 2; });
  }
  function noteRelays(trace) {
    (trace || []).forEach(function (t) {
      var r = phone.relays[t.via] || (phone.relays[t.via] = { ok: 0, hard: 0 });
      if (t.outcome === 'found' || t.outcome === 'partial' || t.outcome === 'notfound') r.ok++;
      // a relay that's down often only shows in the browser as no answer after ~20 s (its error page has no CORS
      // headers); losing signal fails at once, so only the slow ones count
      else if (HARD.test(t.outcome) || (/^(network|timeout)$/.test(t.outcome) && t.ms > 8000)) r.hard++;
    });
    // remembered for the next few hours, so the next check doesn't wait on them either
    store(DEAD_KEY, { at: new Date().toISOString(), ids: skipList() });
  }
  var DEAD_KEY = 'ct-relays-out-v1';
  function deadBefore() {
    var d = load(DEAD_KEY, null);
    return d && Array.isArray(d.ids) && Date.now() - Date.parse(d.at) < 6 * 3600000 ? d.ids : [];
  }

  function progress() {
    if (!phone) return;
    var n = phone.total, d = phone.total - phone.queue.length, left = phone.queue.length;
    $('progText').textContent = (phone.retry ? 'Retrying ' : 'Checking ') + Math.min(d + 1, n) + ' of ' + n;
    $('progBar').style.width = Math.round(d / n * 100) + '%';
    var per = phone.doneN ? phone.spent / phone.doneN : 10000, mins = Math.max(1, Math.round(left * (per + PHONE_GAP) / PHONE_WORKERS / 60000));
    var lv = Object.keys(phone.live), l0 = lv.length ? phone.live[lv[0]] : null;
    $('progNote').innerHTML = (l0 ? '<b>' + esc(lv[0]) + '</b> ' + esc(l0.attempt || '') + ' &middot; ' +
      Math.round((Date.now() - l0.t0) / 1000) + 's' + (lv.length > 1 ? ' (+' + (lv.length - 1) + ' more at once)' : '') + '<br>' : '') + phone.got + ' found' +
      (phone.fails ? ', ' + phone.fails + " couldn't be read" : '') + '. About ' + mins + ' min left. Keep this page open and the screen on.';
    // early warning: say so as soon as it looks wrong, rather than after it gives up
    var warn = phone.fails >= 2 && (phone.got === 0 || phone.streak >= 3);
    $('progWarn').hidden = !warn;
    if (warn) $('progWarnText').textContent = (phone.got === 0 ? 'No prices found yet (' + phone.fails + ' missed).' : phone.streak + " in a row couldn't be read.") +
      ' Tap Error report, copy it and send it to Claude.';
  }

  function startPhone(fresh, justUpdated) {
    if (phone || !src) return;
    if (!SL || !SL.lookup) { toast("The price reader didn't load. Refresh the page."); return; }
    // a newer version of this page is out: load it first, then carry on with the check by itself
    if (newerV && !justUpdated) {
      try { sessionStorage.setItem('ct-autostart', fresh ? 'fresh' : 'go'); } catch (e) { /* it just won't start by itself */ }
      toast('Getting the latest version first');
      setTimeout(function () { location.reload(); }, 400);
      return;
    }
    var r = fresh ? null : savedRun();
    var codes = r ? r.codes : L.map(function (l) { return l.code; });
    var run = r || { started: new Date().toISOString(), total: codes.length, got: 0, fails: 0, codes: codes };
    phone = { queue: codes.slice(), total: run.total, got: run.got || 0, fails: run.fails || 0, failed: (r && r.failed) || [],
              seen: (r && r.seen) || {}, started: run.started, retry: !!(r && r.retry), streak: 0, current: '', attempt: '',
              t0: Date.now(), relays: {}, spent: 0, doneN: 0, live: {} };
    deadBefore().forEach(function (id) { phone.relays[id] = { ok: 0, hard: 2 }; });
    phone.tick = setInterval(progress, 1000);
    saveRun();
    $('runBtns').hidden = true;
    $('runStatus').hidden = true;
    $('prog').hidden = false;
    $('reportLink').hidden = true;
    keepAwake();
    progress();
    // a few readers at once, started a moment apart so they don't hit the relay in one burst
    for (var w = 0; w < PHONE_WORKERS; w++) setTimeout(nextPhone, w * 1500);
  }

  function saveRun() {
    store(PHONE_RUN_KEY, { started: phone.started, total: phone.total, got: phone.got, fails: phone.fails, failed: phone.failed,
                           seen: phone.seen, retry: phone.retry, codes: phone.queue });
  }

  function stepOf(name, r) {
    r = r || {};
    return { step: name, status: r.status || '?', reason: r.reason || r.why || '', price: r.price || '', ld: r.ld || '', ldSure: !!r.ldSure,
             unsure: !!r.unsure, via: r.via || '', trace: r.trace || [] };
  }
  function missWhy(r) {
    if (!r) return 'no answer';
    if (r.status === 'notfound') return 'Screwfix says not found (404)';
    if (r.status === 'blocked') return r.reason === 'network' ? 'no relay could be reached at all (offline, or this network blocks them)' : 'every relay failed';
    if (r.unsure) return "the page that came back doesn't mention this code";
    return 'page read but no price on it (' + r.status + ')';
  }

  /* One ticket. 1: a normal text read through the relays, as Price Tickets does (jina renders the page in a browser,
   * which gets past Screwfix's bot check). An unchanged price is fine as it is. 2: a different price is confirmed
   * from the product data in the whole page, which jina now has cached from step 1. If that can't be had, the new
   * price goes on the Couldn't be read list ready to save. Everything is logged for the error report. */
  function nextPhone() {
    if (!phone) return;
    if (!phone.queue.length) { finishPhone('done'); return; }
    var me = phone, t0 = Date.now(), code = null;
    for (var qi = 0; qi < phone.queue.length; qi++) if (!phone.live[phone.queue[qi]]) { code = phone.queue[qi]; break; }
    if (!code) return;                                   // the rest are being read by the other readers
    var before = L.filter(function (l) { return l.code === code; })[0];
    var item = { code: code, at: new Date(t0).toISOString(), last: before ? before.price : null, ticket: before ? before.shelf : null, steps: [] };
    var live = phone.live[code] = { t0: t0, attempt: '' };
    progress();
    var onAttempt = function (a) {
      if (phone !== me) return;
      live.attempt = (a.mode === 'page' ? 'confirming the new price on ' : 'trying ') + a.via + (a.round ? ' (go ' + (a.round + 1) + ')' : '');
      progress();
    };
    SL.lookup(code, { skip: skipList(), maxMs: 30000, onAttempt: onAttempt }).then(function (r) {
      if (phone !== me) return null;
      noteRelays(r.trace);
      item.steps.push(stepOf('text', r));
      var read = (r.status === 'found' || r.status === 'partial') && !r.unsure && pounds(r.price) != null;
      if (!read) return { r: r, price: null, why: missWhy(r) };
      var price = readPrice(r, before);
      if (price != null) return { r: r, price: price };
      return SL.lookup(code, { full: true, only: ['jina'], retries: 0, onAttempt: onAttempt }).then(function (r2) {
        if (phone !== me) return null;
        item.steps.push(stepOf('page', r2));
        var ok = r2.ld && r2.ldSure ? pounds(r2.ld) : null;
        if (ok != null) return { r: r, price: ok };
        return { r: r, price: null, seen: pounds(r.price), why: 'new price ' + money(pounds(r.price)) + " couldn't be confirmed (" +
          (r2.ld ? 'the product data on the page is for another code' : 'the whole page came back ' + (r2.status === 'blocked' ? 'blocked' : r2.status)) + ')' };
      });
    }).then(function (res) {
      if (phone !== me || !res) return;
      delete phone.seen[code];
      if (res.price != null) {
        var r = res.r, ph = phonePrices(), was = same(pounds(r.price), res.price) ? pounds(r.was) : null;
        var moved = before && before.price != null && !same(before.price, res.price);
        ph[code] = { price: res.price, name: r.name || (before && before.name) || null, was: was != null && was > res.price ? was : null,
                     at: new Date().toISOString(), since: moved || !before ? london().date : before.since || london().date };
        store(PHONE_KEY, ph);
        phone.got++;
        phone.streak = 0;
        item.result = same(res.price, item.last != null ? item.last : item.ticket) ? 'same' : 'changed';
        item.price = res.price;
      } else {
        // read but not confirmed: keep what Screwfix showed, so the Couldn't be read list can offer it
        if (res.seen != null) phone.seen[code] = res.seen;
        phone.fails++;
        phone.failed.push(code);
        phone.streak++;
        item.result = res.seen != null ? 'unconfirmed' : 'missed';
        item.price = res.seen;
        item.why = res.why;
      }
    }).catch(function (e) {
      // a fault in this page rather than a relay: log it word for word
      item.result = 'error';
      item.why = String((e && (e.stack || e.message)) || e).split('\n').slice(0, 3).join(' | ').slice(0, 300);
      if (phone === me) { phone.fails++; phone.failed.push(code); phone.streak++; }
    }).then(function () {
      item.ms = Date.now() - t0;
      if (!item.result) item.result = 'stopped';
      diagAdd(item);
      if (phone !== me) return;
      phone.spent += item.ms;
      phone.doneN++;
      delete phone.live[code];
      var qx = phone.queue.indexOf(code);
      if (qx >= 0) phone.queue.splice(qx, 1);
      if (phone.streak >= 6) {
        // nothing's getting through: put those six back so Carry on tries them again
        phone.queue = phone.failed.splice(-6, 6).concat(phone.queue);
        phone.fails -= 6;
        saveRun();
        finishPhone('blocked');
        return;
      }
      saveRun();
      if (src) render();
      progress();
      setTimeout(nextPhone, PHONE_GAP);
    });
  }

  function finishPhone(why) {
    var p = phone;
    phone = null;
    clearInterval(p.tick);
    letSleep();
    $('prog').hidden = true;
    $('runBtns').hidden = false;
    $('runStatus').hidden = false;
    $('reportLink').hidden = false;
    if (why === 'done') {
      var last = phoneLast(), total = L.length || p.total;
      var done = p.retry && last ? Math.min(total, last.done + p.got) : p.got;
      var seen = {};
      p.failed.forEach(function (c) { if (p.seen[c] != null) seen[c] = p.seen[c]; });
      store(PHONE_LAST_KEY, { at: new Date().toISOString(), total: total, done: done, failed: p.failed, seen: seen });
      // any it couldn't read: the button offers to retry just those
      if (p.failed.length) store(PHONE_RUN_KEY, { started: new Date().toISOString(), total: p.failed.length, got: 0, fails: 0, failed: [], retry: true, codes: p.failed });
      else { try { localStorage.removeItem(PHONE_RUN_KEY); } catch (e) { /* fine */ } }
      p.summary = done + ' of ' + total;
    }
    if (src) render();
    // missed any: open the error report straight away, while the details are fresh
    if (why === 'done' && p.failed.length) setTimeout(function () {
      reportSheet(p.failed.length + (p.failed.length === 1 ? " ticket couldn't be read (" : " tickets couldn't be read (") + p.failed.join(', ') +
        '). Copy this report and send it to Claude so the cause can be fixed.');
    }, 600);
    if (why === 'done') toast('Checked ' + p.summary + ' on this device' + (todo.length ? ', ' + todo.length + ' to update' : ', all up to date'));
    else if (why === 'stopped') toast('Stopped. Tap Carry on to finish the other ' + p.queue.length + '.');
    else toast("Couldn't read 6 in a row, so it stopped. Tap Copy an error report and send it to Claude.");
  }

  $('phoneRun').addEventListener('click', function () { startPhone(false); });
  $('phoneFresh').addEventListener('click', function () {
    try { localStorage.removeItem(PHONE_RUN_KEY); } catch (e) { /* fine */ }
    startPhone(true);
  });
  $('phoneStop').addEventListener('click', function () { if (phone) finishPhone('stopped'); });
  // the screen-awake lock drops when the page is hidden: take it again on the way back
  document.addEventListener('visibilitychange', function () { if (!document.hidden && phone) keepAwake(); });
  // don't lose a check part way by accident
  window.addEventListener('beforeunload', function (e) { if (phone) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- error report ----------
   * Every ticket the device check reads is logged on this device (the last 30): what each relay sent back, how
   * long it took and what the page made of it. The report adds the phone's network, the page and reader versions
   * and the run so far, as text to paste into the chat with Claude. It can be copied at any point, mid-run too. */

  var DIAG_KEY = 'ct-diag-v1', DIAG_KEEP = 80;           // a whole check (69) fits, so every missed ticket's detail is kept
  function diag() { var v = load(DIAG_KEY, null); return v && Array.isArray(v.items) ? v : { items: [], tests: [] }; }
  function diagAdd(item) { var d = diag(); d.items.push(item); d.items = d.items.slice(-DIAG_KEEP); store(DIAG_KEY, d); }
  function hms(t) {
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(t)); }
    catch (e) { return String(t); }
  }
  function sec(ms) { return ms == null ? '?' : (ms / 1000).toFixed(1) + 's'; }
  function kb(n) { return n == null ? '' : n < 1024 ? n + 'B' : Math.round(n / 1024) + 'KB'; }
  function gbp(v) { return v == null ? '-' : money(v); }
  function storageOk() { try { localStorage.setItem('ct-probe', '1'); localStorage.removeItem('ct-probe'); return true; } catch (e) { return false; } }

  function attemptLine(step, t) {
    return '    ' + step + ' go' + ((t.round || 0) + 1) + ' ' + t.via + (t.mode === 'page' ? '[page]' : '') + ' ' + t.outcome + ' http' + (t.http || 0) +
      (t.len != null ? ' ' + kb(t.len) : '') + ' ' + sec(t.ms) + (t.price ? ' ' + t.price : '') +
      (t.ld ? ' data=' + t.ld + (t.ldSure ? '' : '(other code)') : '') + (t.retryAfter != null ? ' wait' + t.retryAfter + 's' : '') +
      (t.err ? ' err="' + t.err + '"' : '') + (t.head ? ' got="' + (t.outcome === 'limited' ? t.head.slice(0, 60) : t.head) + '"' : '');
  }

  function itemLines(it, out, full) {
    var good = it.result === 'same' || it.result === 'changed';
    out.push('  ' + it.code + ' ' + hms(it.at) + ' took ' + sec(it.ms) + ' ' + String(it.result).toUpperCase() + (it.price != null ? ' ' + gbp(it.price) : '') +
      ' (last ' + gbp(it.last) + ', ticket ' + gbp(it.ticket) + ')' + (it.why ? ': ' + it.why : ''));
    (it.steps || []).forEach(function (s) {
      if (good && s.step === 'text' && !full) {          // worked: one line, plus any relays that failed on the way
        var ok = function (t) { return t.outcome === 'found' || t.outcome === 'partial'; };
        var w = (s.trace || []).filter(ok)[0] || {};
        out.push('    text ok via ' + (s.via || w.via || '?') + ' ' + sec(w.ms) + ' ' + kb(w.len) + ' ' + s.price);
        (s.trace || []).filter(function (t) { return !ok(t); }).forEach(function (t) { out.push(attemptLine('text', t)); });
        return;
      }
      out.push('    ' + s.step + ': ' + s.status + (s.reason ? ' (' + s.reason + ')' : '') + (s.price ? ' ' + s.price : '') +
        (s.ld ? ' data=' + s.ld + (s.ldSure ? '' : '(other code)') : '') + (s.unsure ? ' UNSURE' : ''));
      (s.trace || []).forEach(function (t) { out.push(attemptLine(s.step, t)); });
    });
  }

  function report() {
    var out = [], c = navigator.connection || {}, st = SL && SL.state ? SL.state() : null, d = diag(), now = Date.now();
    out.push('=== A25 counter trial error report ===');
    out.push('time ' + hms(now) + ' ' + day(london().date) + ' (' + new Date(now).toISOString() + ')');
    out.push('versions app ' + (APP_V || '?') + ', reader ' + ((SL && SL.version) || 'OLD, no version') +
      (newerV ? ', SITE HAS NEWER app ' + newerV + ' (this page is out of date)' : '') + ', page opened ' + hms(OPENED));
    out.push('device ' + navigator.userAgent);
    out.push('network ' + (navigator.onLine ? 'online' : 'OFFLINE') + (c.type ? ' ' + c.type : '') + (c.effectiveType ? ' ' + c.effectiveType : '') +
      (c.downlink != null ? ' ' + c.downlink + 'Mbps' : '') + (c.rtt != null ? ' rtt' + c.rtt + 'ms' : '') + (c.saveData ? ' DATA-SAVER-ON' : '') +
      ', screen ' + (document.hidden ? 'HIDDEN' : 'on') + ', wake lock ' + (wakeLock ? 'held' : navigator.wakeLock ? 'not held' : 'unsupported') +
      ', storage ' + (storageOk() ? 'ok' : 'BLOCKED'));
    if (st) out.push('relays ' + st.order.join(' > ') + (Object.keys(st.resting).length ? ', resting ' + Object.keys(st.resting).map(function (k) { return k + ' ' + st.resting[k] + 's'; }).join(', ') : ''));
    if (phone) {
      out.push('run RUNNING' + (phone.retry ? ' (retry)' : '') + ', started ' + hms(phone.started) + ', ' + (phone.total - phone.queue.length) + ' of ' + phone.total +
        ' done, ' + phone.got + ' found, ' + phone.fails + ' missed, ' + phone.streak + ' missed in a row' +
        (Object.keys(phone.live).length ? ', now ' + Object.keys(phone.live).map(function (k) { return k + ' for ' + sec(now - phone.live[k].t0) + (phone.live[k].attempt ? ' (' + phone.live[k].attempt + ')' : ''); }).join('; ') : ', between tickets') + ', ' + PHONE_WORKERS + ' at once' +
        (skipList().length ? ', leaving out ' + skipList().join(' ') : ''));
    } else {
      var sr = savedRun();
      out.push('run not running' + (sr ? ', saved ' + (sr.retry ? 'retry' : 'run') + ' with ' + sr.codes.length + ' left' : ''));
    }
    var pl = phoneLast();
    if (pl) out.push('last finished device check ' + londonDay(pl.at) + ' ' + hms(pl.at) + ', ' + pl.done + ' of ' + pl.total + ', missed ' + (pl.failed || []).length +
      ((pl.failed || []).length ? ' (' + pl.failed.slice(0, 20).join(' ') + ((pl.failed.length > 20) ? ' ...' : '') + ')' : ''));
    var gr = src && src.prices && src.prices.run;
    if (gr) out.push('github check ' + gr.date + ', ' + (gr.checked || 0) + ' of ' + gr.total + (gr.stopped ? ', stopped: ' + gr.stopped : ''));
    (d.tests || []).slice(-1).forEach(function (t) {
      out.push('connection test ' + londonDay(t.at) + ' ' + hms(t.at) + ' with ' + t.code + ':');
      t.rows.forEach(function (r) { out.push(r); });
    });
    // every ticket the last check missed, in full, wherever it is in the log
    var missed = phone ? phone.failed : pl && Date.parse(pl.at) > ghFinished() ? pl.failed || [] : [];
    if (missed.length) {
      out.push('MISSED in ' + (phone ? 'this check so far' : 'the last device check') + ' (' + missed.length + '), full detail:');
      missed.forEach(function (code) {
        var it = d.items.filter(function (x) { return x.code === code; }).pop();
        if (it) itemLines(it, out, true); else out.push('  ' + code + ': no log kept for it');
      });
    }
    var gf = gr && gr.fails ? Object.keys(gr.fails) : [];
    if (gf.length) {
      out.push('MISSED by the github check ' + gr.date + ' (' + gf.length + '):');
      gf.forEach(function (c) { out.push('  ' + c + ': ' + gr.fails[c]); });
    }
    var items = d.items.slice(-15).reverse();
    out.push('tickets, newest first (' + items.length + ' of ' + d.items.length + ' logged):');
    if (!items.length) out.push('    none yet');
    items.forEach(function (it) { itemLines(it, out); });
    out.push('=== end ===');
    return out.join('\n');
  }

  /* Test the connection: one code through each relay, text and whole page, plus a plain fetch from GitHub to show
   * whether the network itself is fine. About a minute. Not while a check is running (they'd share the relay's limit). */
  function connTest(note) {
    var d = diag(), lastBad = d.items.slice().reverse().filter(function (it) { return it.result !== 'same' && it.result !== 'changed'; })[0];
    var code = (lastBad && lastBad.code) || (L[0] && L[0].code) || '480PG', rows = [], t0 = Date.now();
    var steps = [{ label: 'jina text', opts: { only: ['jina'] } }, { label: 'jina whole page', opts: { only: ['jina'], full: true } }]
      .concat(SL.relays.filter(function (id) { return id !== 'jina'; }).map(function (id) { return { label: id, opts: { only: [id] } }; }));
    note('Testing the connection: GitHub');
    return fetch(RAW + 'plan.json?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' }).then(function (r) {
      rows.push('    github fetch http' + r.status + ' ' + sec(Date.now() - t0));
    }, function (e) {
      rows.push('    github fetch FAILED ' + sec(Date.now() - t0) + ' err="' + String(e && e.message || e).slice(0, 80) + '"');
    }).then(function () {
      return steps.reduce(function (p, s, i) {
        return p.then(function () {
          note('Testing the connection: ' + s.label + ' (' + (i + 1) + ' of ' + steps.length + ')');
          var o = { retries: 0 };
          Object.keys(s.opts).forEach(function (k) { o[k] = s.opts[k]; });
          return SL.lookup(code, o).then(function (r) {
            rows.push('    ' + s.label + ': ' + r.status + (r.reason ? ' (' + r.reason + ')' : '') + (r.price ? ' ' + r.price : '') + (r.ld ? ' data=' + r.ld + (r.ldSure ? '' : '(other code)') : ''));
            (r.trace || []).forEach(function (t) { rows.push(attemptLine('test', t)); });
          }, function (e) { rows.push('    ' + s.label + ': threw ' + String(e && e.message || e).slice(0, 120)); });
        });
      }, Promise.resolve());
    }).then(function () {
      var dd = diag();
      dd.tests = (dd.tests || []).concat([{ at: new Date().toISOString(), code: code, rows: rows }]).slice(-2);
      store(DIAG_KEY, dd);
    });
  }

  function copyText(text, ok) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); ok(); } catch (x) { toast("Couldn't copy here. Press and hold the report, Select all, then Copy."); }
      t.remove();
    }
  }

  function reportSheet(intro) {
    if (typeof intro !== 'string') intro = '';
    if (document.querySelector('.ct-rep-sheet')) return;
    var wrap = document.createElement('div');
    wrap.className = 'sc-sheet ct-sheet ct-rep-sheet';
    wrap.innerHTML = '<div class="sc-sheet-card" role="dialog" aria-modal="true" aria-labelledby="ctRepH">' +
      '<h2 id="ctRepH">Error report</h2>' + (intro ? '<p><b>' + esc(intro) + '</b></p>' : '') +
      '<p>Copy this and paste it into the chat with Claude. It shows what each ticket got back and why, so Claude can see what\'s going wrong.' +
      (phone ? ' The check keeps going while this is open.' : '') + '</p>' +
      '<textarea class="ct-report" id="ctRep" readonly spellcheck="false" aria-label="Error report"></textarea>' +
      '<button class="btn btn-primary" id="ctRepCopy" type="button">Copy error report</button>' +
      '<button class="btn" id="ctRepTest" type="button">Test the connection first (about a minute)</button>' +
      '<p class="ct-rep-n" id="ctRepNote" hidden></p>' +
      '<button class="ct-link" id="ctRepClose" type="button">Close</button></div>';
    function shut() { wrap.remove(); }
    wrap.addEventListener('click', function (e) { if (e.target === wrap) shut(); });
    document.body.appendChild(wrap);
    var ta = wrap.querySelector('#ctRep'), test = wrap.querySelector('#ctRepTest'), note = wrap.querySelector('#ctRepNote');
    function fill() { ta.value = report(); }
    fill();
    if (phone) { test.disabled = true; test.textContent = 'Stop the check to test the connection'; }
    wrap.querySelector('#ctRepClose').addEventListener('click', shut);
    wrap.querySelector('#ctRepCopy').addEventListener('click', function () {
      fill();
      copyText(ta.value, function () { toast('Error report copied. Paste it into the chat with Claude.'); });
    });
    test.addEventListener('click', function () {
      if (phone || test.disabled) return;
      test.disabled = true;
      note.hidden = false;
      connTest(function (msg) { note.textContent = msg; }).then(function () {
        fill();
        note.textContent = 'Test done and added to the report. Tap Copy error report.';
        test.disabled = false;
        test.textContent = 'Test the connection again';
      });
    });
  }
  $('progReport').addEventListener('click', function () { reportSheet(); });
  $('reportLink').addEventListener('click', function () { reportSheet(); });
  $('missReport').addEventListener('click', function () { reportSheet(); });

  /* ---------- a newer version of this page: say so, as an old copy left open is easy to miss ---------- */

  function checkVersion() {
    return fetch('counter-trial.html?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (h) {
        var m = /counter-trial\/app\.js\?v=([^"'&\s>]+)/.exec(h || '');
        if (m && APP_V && m[1] !== APP_V) { newerV = m[1]; $('update').hidden = false; }
      }, function () { /* offline: try again later */ });
  }
  $('updateNow').addEventListener('click', function () { if (!phone) location.reload(); else toast('Stop the check first, then refresh'); });


  /* ---------- start ---------- */

  refresh().then(function () {
    // carry on with a check that was waiting for the latest version of the page
    var a = null;
    try { a = sessionStorage.getItem('ct-autostart'); sessionStorage.removeItem('ct-autostart'); } catch (e) { /* none */ }
    if (a && src) startPhone(a === 'fresh', true);
  });
  runStatus();
  checkVersion();
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !phone) checkVersion(); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && (running || Date.now() - loadedAt > 15 * 60000)) runStatus();
  });
  // back on the page after a while: fetch the latest check again
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - loadedAt > 15 * 60000) refresh();
  });
})();
