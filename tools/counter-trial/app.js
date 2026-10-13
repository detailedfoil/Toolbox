/* A25 Behind counter trial: the tickets whose screwfix.com price no longer matches the shelf.
 * The check runs on GitHub every night (.github/workflows/counter-trial.yml) and saves
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
  function lines() {
    var P = (src.prices && src.prices.products) || {}, mine = confirmed(), seen = {};
    return src.plan.lines.filter(function (l) { if (seen[l.code]) return false; seen[l.code] = 1; return true; }).map(function (l, i) {
      var p = P[l.code] || {}, c = mine[l.code];
      var shelf = c && c.price != null ? c.price : l.shelf;
      var price = p.price != null ? p.price : null;
      return {
        i: i, code: l.code, sheet: l.sheet, name: p.name || l.name, shelf: shelf, printed: l.shelf,
        price: price, since: p.since || null, status: p.status || 'unchecked', was: p.was, moves: p.moves || [],
        todo: price != null && p.status !== 'not_found' && !same(price, shelf)
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
    $('meta').innerHTML = pr.checked ? 'Last checked <b>' + nw(day(pr.checked)) + '</b>' + (run.finished ? ' at ' + nw(time(run.finished)) : '') + '.' : 'Not checked yet. The first check runs a few minutes after setup.';

    // anything to warn about
    var alerts = [], checkedOk = run.complete !== false;
    if (pr.checked && pr.checked < now.date && now.hour >= 9) {
      alerts.push("Today's check hasn't come in yet, so these prices are from " + esc(day(pr.checked)) + '. <a href="' + RUNS + '" target="_blank" rel="noopener">See the runs on GitHub</a>');
    } else if (pr.checked && !checkedOk) {
      var left = run.unchecked || 0;
      alerts.push('Part checked: ' + (run.checked || 0) + ' of ' + (run.total || L.length) + ' so far. ' +
        (left === 1 ? 'The other one keeps its last price' : 'The other ' + left + ' keep their last price') +
        (/429/.test(run.stopped || '') ? ' (Screwfix asked it to slow down)' : '') + ' and ' + (left === 1 ? 'gets' : 'get') + ' tried again later this morning.');
    }
    $('alert').hidden = !alerts.length;
    $('alert').innerHTML = alerts.length ? WARN + '<div>' + alerts.join('<br>') + '</div>' : '';

    var n = todo.length, up = todo.filter(function (l) { return l.price > l.shelf; }).length;
    var done = L.filter(function (l) { return l.status === 'ok' || l.status === 'not_found'; }).length;
    var nf = L.filter(function (l) { return l.status === 'not_found'; }).length;
    $('stats').innerHTML =
      '<div class="sc-stat' + (n ? ' is-hot' : '') + '"><span class="sc-stat-v">' + n + '</span><span class="sc-stat-k">to update' +
        (n ? '<span class="sc-split" title="' + up + ' up, ' + (n - up) + ' down"><span>' + ARROW_UP + up + '</span><span>' + ARROW_DOWN + (n - up) + '</span></span>' : '') + '</span></div>' +
      '<div class="sc-stat"><span class="sc-stat-v">' + done + '<small>/' + L.length + '</small></span><span class="sc-stat-k">checked last run</span></div>' +
      '<div class="sc-stat"><span class="sc-stat-v">' + nf + '</span><span class="sc-stat-k">not found online</span></div>';
    $('nTodo').textContent = ' ' + n;
    $('nAll').textContent = ' ' + L.length;

    renderTodo();
    renderDone();
    renderAll();

    $('foot').innerHTML = 'Checks every ticket early every morning. Lines it can\'t check keep their last price and never show as a change. ' +
      'Ticks are saved on this device. <a href="' + RUNS + '" target="_blank" rel="noopener">Runs on GitHub</a>';
    $('main').hidden = false;
    showTab(load(TAB_KEY, 'todo'));
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
      : '<strong>Waiting for the first check</strong>It runs a few minutes after setup, then early every morning.';
    $('todoHint').innerHTML = n ? 'Oldest first. Swap ' + (n === 1 ? 'this ticket' : 'these ' + n + ' tickets') + ', then tick ' + (n === 1 ? 'it' : 'each one') + ' off.' : '';
  }

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
        (l.status === 'unchecked' && l.price != null ? '<span class="sc-note">not rechecked last run</span>' : '') + '</div>' + right + '</li>';
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

  /* ---------- start ---------- */

  refresh();
  // back on the page after a while: fetch the latest check again
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - loadedAt > 15 * 60000) refresh();
  });
})();
