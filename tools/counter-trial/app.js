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
    return Promise.all([from('counter-trial/data/'), from(RAW)]).then(function (res) {
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
      alerts.push('Part checked: ' + (run.checked || 0) + ' of ' + (run.total || L.length) + ' so far. ' +
        (left === 1 ? 'The other one keeps its last price' : 'The other ' + left + ' keep their last price') +
        (/slow down|429/.test(run.stopped || '') ? ' (Screwfix asked it to slow down)' : '') + ' and ' + (left === 1 ? 'gets' : 'get') + ' tried again ' + (pr.checked === now.date && now.hour < 11 ? 'later this morning' : 'tonight') + '.');
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
    mine[code] = { price: l.price, on: london().date };
    store(SHELF_KEY, mine);
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
    if (e.before) mine[code] = e.before; else delete mine[code];
    store(SHELF_KEY, mine);
    store(LOG_KEY, log);
    hideToast();
    render();
  }

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
    toast('Check started. It takes about 2 hours.');
    showRun({ status: 'queued', created_at: new Date().toISOString() });
    setTimeout(runStatus, 6000);
  }

  $('runNow').addEventListener('click', function () {
    if (running) return;
    var t = token();
    if (!t) { setupSheet(); return; }
    if (!window.confirm('Start a full check of all ' + (L.length || 69) + ' tickets now?\n\nIt runs on GitHub and takes about 2 hours.')) return;
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
    render();
  });

  function setupSheet(err) {
    var wrap = document.createElement('div');
    wrap.className = 'sc-sheet ct-sheet';
    wrap.innerHTML = '<div class="sc-sheet-card" role="dialog" aria-modal="true" aria-labelledby="ctSheetH">' +
      '<h2 id="ctSheetH">Check on GitHub</h2>' +
      '<p>Starts a full check of all ' + (L.length || 69) + ' tickets straight away. It runs on GitHub and takes about 2 hours.</p>' +
      '<a class="btn" href="' + RUNS + '" target="_blank" rel="noopener">Open on GitHub, then tap Run workflow</a>' +
      '<hr><h2>Make it one tap</h2>' +
      '<p>Save a GitHub token on this device once, and the Check on GitHub button starts it itself. It stays on this device and can only run Toolbox checks.</p>' +
      '<ol><li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Make a new fine-grained token</a> on GitHub.</li>' +
      '<li>Expiration: the longest it allows. <b>Repository access</b>: Only select repositories, then <b>Toolbox</b>.</li>' +
      '<li><b>Permissions</b>: Actions, <b>Read and write</b>. Nothing else.</li>' +
      '<li>Generate it, copy it, and paste it here.</li></ol>' +
      '<input id="ctTok" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_..." aria-label="GitHub token">' +
      '<p class="ct-err" id="ctErr"' + (err ? '' : ' hidden') + '>' + esc(err || '') + '</p>' +
      '<button class="btn btn-primary" id="ctSave" type="button">Save and check now</button>' +
      '<button class="ct-link" id="ctClose" type="button">Cancel</button></div>';
    function shut() { wrap.remove(); }
    wrap.addEventListener('click', function (e) { if (e.target === wrap) shut(); });
    document.body.appendChild(wrap);
    wrap.querySelector('#ctClose').addEventListener('click', shut);
    wrap.querySelector('#ctSave').addEventListener('click', function () {
      var t = wrap.querySelector('#ctTok').value.trim(), e = wrap.querySelector('#ctErr'), btn = this;
      if (!t) { e.hidden = false; e.textContent = 'Paste the token first.'; return; }
      btn.classList.add('is-busy');
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
      s.innerHTML = '<b>Check on this device</b> takes a few minutes with this page open. The nightly GitHub check is off for now.';
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
  var PHONE_GAP = 3000;                                    // breather between tickets: keeps under jina's 20 a minute

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

  function progress() {
    if (!phone) return;
    var n = phone.total, d = phone.total - phone.queue.length, left = phone.queue.length;
    $('progText').textContent = (phone.retry ? 'Retrying ' : 'Checking ') + Math.min(d + 1, n) + ' of ' + n;
    $('progBar').style.width = Math.round(d / n * 100) + '%';
    var mins = Math.max(1, Math.round(left * 5 / 60));
    $('progNote').innerHTML = (phone.current ? '<b>' + esc(phone.current) + '</b> &middot; ' : '') + phone.got + ' found' +
      (phone.fails ? ', ' + phone.fails + " couldn't be read" : '') + '. About ' + mins + ' min left. Keep this page open and the screen on.';
  }

  function startPhone(fresh) {
    if (phone || !src) return;
    if (!SL || !SL.lookup) { toast("The price reader didn't load. Refresh the page."); return; }
    var r = fresh ? null : savedRun();
    var codes = r ? r.codes : L.map(function (l) { return l.code; });
    var run = r || { started: new Date().toISOString(), total: codes.length, got: 0, fails: 0, codes: codes };
    phone = { queue: codes.slice(), total: run.total, got: run.got || 0, fails: run.fails || 0, failed: (r && r.failed) || [],
              seen: (r && r.seen) || {}, started: run.started, retry: !!(r && r.retry), streak: 0, current: '' };
    saveRun();
    $('runBtns').hidden = true;
    $('runStatus').hidden = true;
    $('prog').hidden = false;
    keepAwake();
    progress();
    nextPhone();
  }

  function saveRun() {
    store(PHONE_RUN_KEY, { started: phone.started, total: phone.total, got: phone.got, fails: phone.fails, failed: phone.failed,
                           seen: phone.seen, retry: phone.retry, codes: phone.queue });
  }

  function nextPhone() {
    if (!phone) return;
    if (!phone.queue.length) { finishPhone('done'); return; }
    var me = phone, code = phone.queue[0];
    phone.current = code;
    progress();
    // full: the whole page, with the product data that confirms a new price (as text only, a change can't be trusted)
    SL.lookup(code, { full: true }).then(function (r) {
      if (phone !== me) return;                           // stopped while this one was being read
      var before = L.filter(function (l) { return l.code === code; })[0];
      var read = r && (r.status === 'found' || r.status === 'partial') && !r.unsure;
      var price = read ? readPrice(r, before) : null;
      delete phone.seen[code];
      // read but not confirmed: keep what Screwfix showed, so the Couldn't be read list can offer it
      if (price == null && read && pounds(r.price) != null) phone.seen[code] = pounds(r.price);
      if (price != null) {
        var ph = phonePrices(), was = same(pounds(r.price), price) ? pounds(r.was) : null;
        var moved = before && before.price != null && !same(before.price, price);
        ph[code] = { price: price, name: r.name || (before && before.name) || null, was: was != null && was > price ? was : null,
                     at: new Date().toISOString(), since: moved || !before ? london().date : before.since || london().date };
        store(PHONE_KEY, ph);
        phone.got++;
        phone.streak = 0;
      } else {
        phone.fails++;
        phone.failed.push(code);
        phone.streak++;
      }
    }, function () { if (phone === me) { phone.fails++; phone.failed.push(code); phone.streak++; } }).then(function () {
      if (phone !== me) return;
      phone.queue.shift();
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
    letSleep();
    $('prog').hidden = true;
    $('runBtns').hidden = false;
    $('runStatus').hidden = false;
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
    if (why === 'done') toast('Checked ' + p.summary + ' on this device' + (todo.length ? ', ' + todo.length + ' to update' : ', all up to date'));
    else if (why === 'stopped') toast('Stopped. Tap Carry on to finish the other ' + p.queue.length + '.');
    else toast("Couldn't read 6 in a row, so it stopped. The relays may be busy or this wifi blocks them. Try again in a bit, or on mobile data.");
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

  /* ---------- start ---------- */

  refresh();
  runStatus();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && (running || Date.now() - loadedAt > 15 * 60000)) runStatus();
  });
  // back on the page after a while: fetch the latest check again
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - loadedAt > 15 * 60000) refresh();
  });
})();
