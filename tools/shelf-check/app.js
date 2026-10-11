/* Shelf Check: the latest weekly shelf price check, with the tickets to swap and the A4 sheets.
 * The check itself runs on GitHub every Monday morning (.github/workflows/shelf-check.yml) and saves
 * shelf-check/data/prices.json; the shop plan is shelf-check/data/plan.json. */
(function () {
  'use strict';

  var Sheet = window.ShelfSheet;
  var RAW = 'https://raw.githubusercontent.com/detailedfoil/Toolbox/main/tools/shelf-check/data/';
  var RUNS = 'https://github.com/detailedfoil/Toolbox/actions/workflows/shelf-check.yml';
  var DONE_KEY = 'sc-done-v3', TAB_KEY = 'sc-tab-v1', OFF_KEY = 'sc-bays-off-v1';
  // iPhone / iPad: the share sheet (Print, Save to Files) beats a download there
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  var $ = function (id) { return document.getElementById(id); };
  var data = null, src = null, loadedAt = 0, pdfs = {}, warmTimer = 0;

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: keep going */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(v) { return '£' + Number(v).toFixed(2); }

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
  function utc(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function mondayOf(s) { var d = utc(s); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return iso(d); }
  function addDays(s, n) { var d = utc(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function day(s) { return s ? Sheet.nice(s).replace(/ \d{4}$/, '') : ''; }           // Mon 12 Oct

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
    return Promise.all([from('shelf-check/data/'), from(RAW)]).then(function (res) {
      var got = res.filter(function (r) { return r && r.plan && r.plan.bays && r.prices; })
                   .sort(function (a, b) { return stamp(b.prices) - stamp(a.prices); })[0];
      if (!got) throw new Error('no data');
      src = got;
      build();
      renderFloor();
      setTimeout(warm, 300);
    }).catch(function () {
      if (data) return;                                  // keep showing what we had
      $('meta').hidden = true;
      $('error').hidden = false;
      $('error').textContent = "The latest check couldn't be loaded. Check your connection and refresh the page.";
    });
  }

  /* ---------- your shop floor: the bays this store has (unticked ones are left out of everything) ---------- */

  function offBays() { var v = load(OFF_KEY, []); return Array.isArray(v) ? v : []; }
  function build() {
    var off = offBays(), plan = {};
    for (var k in src.plan) plan[k] = src.plan[k];
    plan.bays = src.plan.bays.filter(function (b) { return off.indexOf(b.name) < 0; });
    data = merge(plan, src.prices);
    data.allBays = src.plan.bays.length;
    pdfs = {};
    render();
  }
  function floorSummary() {
    var n = data.bays.length, all = data.allBays;
    $('floorSum').innerHTML = n === all ? 'All <b>' + all + '</b> bays from the brief' : '<b>' + n + '</b> of ' + all + ' bays from the brief';
  }
  function renderFloor() {
    var off = offBays();
    $('floorList').innerHTML = src.plan.bays.map(function (b, i) {
      var on = off.indexOf(b.name) < 0, n = Sheet.places([b]).length;
      return '<li><label class="sc-floor-i"><span class="sc-tick"><input type="checkbox" data-bay="' + i + '"' + (on ? ' checked' : '') + '><span></span></span>' +
        '<span class="sc-floor-t">' + esc(b.name) + '<small>' + n + ' line' + (n === 1 ? '' : 's') + '</small></span></label></li>';
    }).join('');
    floorSummary();
    $('floor').hidden = false;
  }
  function setFloor(off) {
    store(OFF_KEY, off);
    build();
    floorSummary();
    clearTimeout(warmTimer);
    warmTimer = setTimeout(warm, 800);
  }
  $('floorList').addEventListener('change', function (e) {
    var i = e.target.getAttribute('data-bay');
    if (i == null || !src) return;
    var name = src.plan.bays[+i].name, off = offBays().filter(function (n) { return n !== name; });
    if (!e.target.checked) off.push(name);
    setFloor(off);
  });
  $('floorAll').addEventListener('click', function () { if (!src) return; setFloor([]); renderFloor(); });
  $('floorNone').addEventListener('click', function () {
    if (!src) return;
    setFloor(src.plan.bays.map(function (b) { return b.name; }));
    renderFloor();
  });

  /* plan + prices -> what the page and the PDF builder use */
  function merge(plan, prices) {
    var codes = [], seen = {}, products = {}, P = prices.products || {};
    var spots = Sheet.places(plan.bays);                  // every line in shelf order: bay, top shelf first, left to right
    spots.forEach(function (s) { if (!seen[s.code]) { seen[s.code] = 1; codes.push(s.code); } });
    codes.forEach(function (c) { products[c] = P[c] || { name: null, price: null, prev: null, status: 'unchecked' }; });
    var isDone = function (c) { return /^(ok|changed|not_found)$/.test(products[c].status); };
    var changed = codes.filter(function (c) { var p = products[c]; return p.status === 'changed' && p.price != null && p.prev != null; });
    return {
      checked: prices.checked, previous_checked: prices.previous_checked, run: prices.run || {},
      complete: codes.every(isDone),
      plan: { name: plan.name, short: plan.short, store: plan.store }, bays: plan.bays, products: products,
      codes: codes, spots: spots, changed: changed,
      swaps: spots.filter(function (s) { return changed.indexOf(s.code) >= 0; }),
      up: changed.filter(function (c) { return products[c].price > products[c].prev; }).length,
      done: codes.filter(isDone).length,
      notFound: codes.filter(function (c) { return products[c].status === 'not_found'; }).length
    };
  }

  /* ---------- page ---------- */

  var ARROW_UP = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5 9 8.5H1z" fill="currentColor"/></svg>';
  var ARROW_DOWN = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8.5 9 1.5H1z" fill="currentColor"/></svg>';
  var WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';
  var CHEV = '<svg class="sc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  function render() {
    var d = data, now = london(), week = mondayOf(now.date);
    $('error').hidden = true;
    $('meta').hidden = !!d.checked;                      // the notice above says the same
    $('sub').textContent = (d.plan.name || 'Front of house') + ' shelf prices, checked against screwfix.com every Monday morning.';
    $('notice').hidden = !d.checked;
    if (d.checked) {
      var prevMon = d.previous_checked && utc(d.previous_checked).getUTCDay() === 1;
      $('notice').innerHTML = '<b>Prices correct as of ' + esc(Sheet.nice(d.checked)) + '.</b> ' +
        (d.previous_checked ? 'Price changes are based off ' + (prevMon ? "last Monday's report" : 'the last report') + ' (' + esc(Sheet.nice(d.previous_checked)) + '). ' : 'This was the first check, so changes show from next week. ') +
        'Use this tool as well as this week\'s updates at noon for best accuracy.';
    }
    var nw = function (s) { return '<span class="sc-nw">' + esc(s) + '</span>'; };
    $('meta').innerHTML = d.checked
      ? 'Checked <b>' + nw(Sheet.nice(d.checked)) + '</b>' + (d.previous_checked ? ', compared with ' + nw(day(d.previous_checked)) + '.' : '. First check, nothing to compare with yet.')
      : 'Not checked yet.';

    // anything to warn about
    var alerts = [], lastWeek = d.run.week || (d.checked ? mondayOf(d.checked) : '');
    var overdue = lastWeek < week && (now.date > week || now.hour >= 10);
    if (overdue) {
      alerts.push("This week's check hasn't come in yet, so these are from " + esc(day(d.checked)) + '. <a href="' + RUNS + '" target="_blank" rel="noopener">See the runs on GitHub</a>');
    } else if (!d.complete) {
      var left = d.codes.length - d.done, one = left === 1, sameDay = d.checked === now.date && now.hour < 16;
      alerts.push('Part checked: ' + d.done + ' of ' + d.codes.length + ' lines so far. ' +
        (one ? 'The other one shows its last price' : 'The other ' + left + ' show their last price') + ', marked <b>not rechecked</b>' +
        (/429/.test(d.run.stopped || '') ? ' (Screwfix asked it to slow down)' : '') + '. ' +
        (sameDay ? 'It tries ' + (one ? 'it' : 'them') + ' again later today.' : (one ? "It'll" : "They'll") + ' be checked again next Monday.'));
    }
    $('alert').hidden = !alerts.length;
    $('alert').innerHTML = alerts.length ? WARN + '<div>' + alerts.join('<br>') + '</div>' : '';

    // the three numbers
    var n = d.changed.length;
    $('stats').innerHTML =
      '<div class="sc-stat' + (n ? ' is-hot' : '') + '"><span class="sc-stat-v">' + n + '</span><span class="sc-stat-k">price change' + (n === 1 ? '' : 's') +
        (n ? '<span class="sc-split" title="' + d.up + ' up, ' + (n - d.up) + ' down"><span>' + ARROW_UP + d.up + '</span><span>' + ARROW_DOWN + (n - d.up) + '</span></span>' : '') + '</span></div>' +
      '<div class="sc-stat"><span class="sc-stat-v">' + d.done + '<small>/' + d.codes.length + '</small></span><span class="sc-stat-k">lines checked</span></div>' +
      '<div class="sc-stat"><span class="sc-stat-v">' + d.notFound + '</span><span class="sc-stat-k">not found online</span></div>';
    $('nChanges').textContent = ' ' + d.swaps.length;
    $('nAll').textContent = ' ' + d.codes.length;

    renderChanges();
    renderBays();

    var next = now.date === week && lastWeek < week ? 'this morning' : day(addDays(week, 7));
    $('foot').innerHTML = 'Runs by itself early every Monday morning. Next check: ' + esc(next) + '. ' +
      "Lines it can't check keep their last price and never count as a change. " +
      '<a href="' + RUNS + '" target="_blank" rel="noopener">Runs on GitHub</a>';

    $('main').hidden = false;
    $('bar').hidden = false;
    $('pdfChanges').disabled = !n;
    $('pdfChanges').title = n ? '' : 'No price changes this week';
    showTab(load(TAB_KEY, 'changes'));
  }

  function priceCell(c) {
    var p = data.products[c], out = '';
    var changed = p.status === 'changed' && p.price != null && p.prev != null;
    if (p.status === 'not_found') out = '<span class="sc-na">not found online</span>';
    else if (p.price == null) out = '<span class="sc-na">not checked yet</span>';
    else {
      out = '<span class="sc-now">' + money(p.price) + '</span>';
      if (changed) out += '<span class="sc-was">was <s>' + money(p.prev) + '</s></span>';
      else if (p.status === 'unchecked') out += '<span class="sc-note">not rechecked</span>';
    }
    var tags = '';
    if (changed) tags += '<span class="sc-tag">' + (p.price > p.prev ? ARROW_UP + 'UP' : ARROW_DOWN + 'DOWN') + '</span>';
    if (p.was && p.price != null && p.status !== 'not_found') tags += '<span class="sc-tag is-offer" title="On offer, was ' + money(p.was) + '">Offer</span>';
    return '<div class="sc-price">' + out + (tags ? '<div class="sc-tags">' + tags + '</div>' : '') + '</div>';
  }

  function doneSet() {
    var s = load(DONE_KEY, null);
    return s && s.checked === data.checked && Array.isArray(s.codes) ? s.codes : [];
  }
  function spotKey(s) { return s.code + '@' + s.bay; }
  function posTag(s) { return s.pos ? '<span class="sc-pos">' + esc(s.pos) + '</span>' : ''; }

  /* tickets to swap, in the order you walk them: one row for each place the product sits */
  function renderChanges() {
    var d = data, done = doneSet(), list = $('changesList'), bay = -1;
    list.innerHTML = d.swaps.map(function (s) {
      var c = s.code, p = d.products[c], k = spotKey(s), ticked = done.indexOf(k) >= 0, head = '';
      if (s.bi !== bay) { bay = s.bi; head = '<li class="sc-group">' + esc(s.bay) + '</li>'; }
      return head + '<li class="sc-row has-tick is-changed' + (ticked ? ' is-done' : '') + '" data-key="' + esc(k) + '">' +
        '<label class="sc-tick"><input type="checkbox"' + (ticked ? ' checked' : '') + ' aria-label="Ticket swapped for ' + esc(c) + '"><span></span></label>' +
        '<div><span class="sc-code">' + esc(c) + '</span><span class="sc-name">' + esc(p.name || '(name not found yet)') + '</span>' +
        '<span class="sc-bays">' + esc([s.shelf, s.pos].filter(Boolean).join(', ') || s.bay) + '</span></div>' +
        priceCell(c) + '</li>';
    }).join('');
    list.hidden = !d.changed.length;
    $('changesEmpty').hidden = !!d.changed.length;
    $('changesEmpty').innerHTML = !d.bays.length ? '<strong>No bays ticked</strong>Tick the bays your store has under Your shop floor.' : '<strong>No price changes</strong>' +
      (d.previous_checked ? 'Every price matches ' + esc(day(d.previous_checked)) + '. Nothing to swap this week.' : 'This was the first check, so changes show from next week.');
    hint();
  }

  function hint() {
    var keys = data.swaps.map(spotKey), n = keys.length, more = n > data.changed.length;
    var done = doneSet().filter(function (k) { return keys.indexOf(k) >= 0; }).length;
    $('changesHint').hidden = !n;
    $('changesHint').innerHTML = done >= n && n
      ? '<b>All ' + n + ' tickets done.</b>'
      : 'In shelf order, bay by bay. Swap ' + (n === 1 ? 'this ticket' : 'these ' + n + ' tickets') + ', then tick ' + (n === 1 ? 'it' : 'them') + ' off.' +
        (more ? ' Some products sit in more than one place, so they come up once for each.' : '') + (done ? ' <b>' + done + ' of ' + n + ' done.</b>' : '');
  }

  $('changesList').addEventListener('change', function (e) {
    var row = e.target.closest('[data-key]');
    if (!row || !data) return;
    var key = row.getAttribute('data-key'), codes = doneSet().filter(function (c) { return c !== key; });
    if (e.target.checked) codes.push(key);
    store(DONE_KEY, { checked: data.checked, codes: codes });
    row.classList.toggle('is-done', e.target.checked);
    hint();
  });

  function renderBays() {
    var d = data;
    $('bays').innerHTML = d.bays.map(function (b, i) {
      var mine = d.spots.filter(function (s) { return s.bi === i; });
      var moved = mine.filter(function (s) { return d.changed.indexOf(s.code) >= 0; }).length;
      var shelves = [];
      mine.forEach(function (s) {
        var sh = shelves[shelves.length - 1];
        if (!sh || sh.si !== s.si) shelves.push(sh = { si: s.si, label: s.shelf, spots: [] });
        sh.spots.push(s);
      });
      return '<details class="sc-bay" data-bay="' + i + '"><summary>' +
        '<span class="sc-bay-t"><strong>' + esc(b.name) + '</strong><small>p.' + esc(b.page) + ' &middot; ' + mine.length + ' line' + (mine.length === 1 ? '' : 's') +
        (b.note ? ' &middot; ' + esc(b.note) : '') + '</small></span>' +
        (moved ? '<span class="sc-bay-n">' + moved + ' change' + (moved === 1 ? '' : 's') + '</span>' : '') + CHEV + '</summary>' +
        '<div class="sc-bay-body">' + shelves.map(function (sh) {
          return '<div class="sc-shelf">' + (sh.label ? '<p class="sc-shelf-h">' + esc(sh.label) + '</p>' : '') +
            '<ul class="sc-list">' + sh.spots.map(function (s) {
              var c = s.code, p = d.products[c], changed = d.changed.indexOf(c) >= 0;
              return '<li class="sc-row' + (changed ? ' is-changed' : '') + '" data-q="' + esc((c + ' ' + (p.name || '')).toLowerCase()) + '">' +
                '<div><span class="sc-code">' + esc(c) + '</span>' + posTag(s) + '<span class="sc-name">' + esc(p.name || '(name not found yet)') + '</span></div>' +
                priceCell(c) + '</li>';
            }).join('') + '</ul></div>';
        }).join('') + '</div></details>';
    }).join('');
    if ($('search').value) search();
  }

  /* ---------- search ---------- */

  var openBefore = null;
  function search() {
    var raw = $('search').value.trim().toLowerCase(), bays = $('bays').querySelectorAll('.sc-bay');
    var q = raw, qCode = raw.replace(/o/g, '0');                       // codes never contain the letter O
    if (!q) {
      Array.prototype.forEach.call(bays, function (b, i) {
        b.hidden = false;
        b.open = !!(openBefore && openBefore[i]);
        Array.prototype.forEach.call(b.querySelectorAll('.sc-row, .sc-shelf'), function (r) { r.hidden = false; });
      });
      openBefore = null;
      $('searchHint').hidden = true;
      return;
    }
    if (!openBefore) openBefore = Array.prototype.map.call(bays, function (b) { return b.open; });
    var hits = 0;
    Array.prototype.forEach.call(bays, function (b) {
      var n = 0;
      Array.prototype.forEach.call(b.querySelectorAll('.sc-row'), function (r) {
        var t = r.getAttribute('data-q'), ok = t.indexOf(q) >= 0 || t.split(' ')[0].indexOf(qCode) >= 0;
        r.hidden = !ok;
        if (ok) n++;
      });
      Array.prototype.forEach.call(b.querySelectorAll('.sc-shelf'), function (sh) { sh.hidden = !sh.querySelector('.sc-row:not([hidden])'); });
      b.hidden = !n;
      b.open = n > 0;
      hits += n;
    });
    $('searchHint').hidden = false;
    $('searchHint').textContent = hits ? hits + ' line' + (hits === 1 ? '' : 's') + ' found' : 'Nothing on the shop plan matches that.';
  }
  $('search').addEventListener('input', search);

  /* ---------- tabs ---------- */

  function showTab(name) {
    if (name !== 'all') name = 'changes';
    Array.prototype.forEach.call(document.querySelectorAll('.sc-tabs button'), function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('tab-changes').hidden = name !== 'changes';
    $('tab-all').hidden = name !== 'all';
  }
  document.querySelector('.sc-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    showTab(b.getAttribute('data-tab'));
    store(TAB_KEY, b.getAttribute('data-tab'));
  });

  /* ---------- PDFs: made ahead, so the phone's share sheet opens straight away ---------- */

  function fileName(changesOnly) {
    return (changesOnly ? 'Screwfix_Price_Changes_' : 'Screwfix_Full_List_') + (data.checked || london().date) + '.pdf';
  }
  function pdf(changesOnly) {
    var k = changesOnly ? 'changes' : 'full';
    if (!pdfs[k]) {
      var job = pdfs[k] = { bytes: null };
      job.promise = Sheet.build(data, { changesOnly: changesOnly }).then(function (b) { job.bytes = b; return b; });
      job.promise.catch(function () { if (pdfs[k] === job) delete pdfs[k]; });
    }
    return pdfs[k];
  }
  function warm() {
    if (!data) return;
    if (data.changed.length) pdf(true);
    pdf(false);
  }

  function saveFile(file) {
    var url = URL.createObjectURL(file), a = document.createElement('a');
    a.href = url; a.download = file.name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function fileSheet(file) {
    var wrap = document.createElement('div'), url = URL.createObjectURL(file);
    wrap.className = 'sc-sheet';
    wrap.innerHTML = '<div class="sc-sheet-card"><h2>Your PDF</h2><p>Tap it to open, then share, save or print.</p>' +
      '<a class="btn" target="_blank" rel="noopener"></a><button class="btn btn-primary" type="button">Done</button></div>';
    var a = wrap.querySelector('a');
    a.href = url; a.download = file.name; a.textContent = file.name;
    function shut() { wrap.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 60000); }
    wrap.querySelector('button').addEventListener('click', shut);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) shut(); });
    document.body.appendChild(wrap);
  }
  function deliver(file) {
    if (ios && navigator.canShare && navigator.share) {
      var can = false;
      try { can = navigator.canShare({ files: [file] }); } catch (e) { can = false; }
      if (can) {
        navigator.share({ files: [file] }).catch(function (e) {
          if (e && e.name === 'AbortError') return;
          fileSheet(file);
        });
        return;
      }
    }
    saveFile(file);
  }
  function getPdf(changesOnly, btn) {
    if (!data) return;
    var job = pdf(changesOnly), name = fileName(changesOnly);
    var finish = function (bytes) { deliver(new File([bytes], name, { type: 'application/pdf' })); };
    if (job.bytes) { finish(job.bytes); return; }
    btn.classList.add('is-busy');
    job.promise.then(function (b) { btn.classList.remove('is-busy'); finish(b); }, function (e) {
      btn.classList.remove('is-busy');
      toast("Couldn't make the PDF: " + (e && e.message ? e.message : 'unknown error'));
    });
  }
  $('pdfChanges').addEventListener('click', function () { getPdf(true, this); });
  $('pdfFull').addEventListener('click', function () { getPdf(false, this); });

  var toastTimer = 0;
  function toast(msg) {
    clearTimeout(toastTimer);
    $('toast').textContent = msg;
    $('toast').classList.add('show');
    toastTimer = setTimeout(function () { $('toast').classList.remove('show'); }, 4500);
  }

  /* ---------- start ---------- */

  refresh();
  // back on the page after a while (say on Monday morning): fetch the latest check again
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - loadedAt > 15 * 60000) refresh();
  });
})();
