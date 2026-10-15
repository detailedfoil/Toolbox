/* Shelf Check: the latest weekly shelf price check, with the tickets to swap and the A4 sheets.
 * The check itself runs on GitHub every Monday morning (.github/workflows/shelf-check.yml) and saves
 * shelf-check/data/prices.json; the shop plan is shelf-check/data/plan.json. */
(function () {
  'use strict';

  var Sheet = window.ShelfSheet;
  var RAW = 'https://raw.githubusercontent.com/detailedfoil/Toolbox/main/tools/shelf-check/data/';
  var RUNS = 'https://github.com/detailedfoil/Toolbox/actions/workflows/shelf-check.yml';
  var DONE_KEY = 'sc-done-v3', TAB_KEY = 'sc-tab-v1', OFF_KEY = 'sc-bays-off-v1';
  var PHONE_KEY = 'sc-phone-v1', PHONE_RUN_KEY = 'sc-phone-run-v1', TOKEN_KEY = 'sc-gh-token-v1';
  var DISPATCH = 'https://api.github.com/repos/detailedfoil/Toolbox/actions/workflows/shelf-check.yml';
  var SHARE_API = 'https://api.github.com/repos/detailedfoil/Toolbox/contents/tools/shelf-check/data/phone.json';
  // iPhone / iPad: the share sheet (Print, Save to Files) beats a download there
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  var $ = function (id) { return document.getElementById(id); };
  var data = null, everything = null, src = null, live = null, loadedAt = 0, pdfs = {}, warmTimer = 0;

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
  function londonDay(iso) {                                                           // ISO time -> 2026-10-19 in the UK
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
    catch (e) { return String(iso).slice(0, 10); }
  }
  function day(s) { return s ? Sheet.nice(s).replace(/ \d{4}$/, '') : ''; }           // Mon 12 Oct

  /* ---------- loading: the site's copy, and GitHub's own copy (fresher if the site hasn't rebuilt yet) ---------- */

  function getJSON(url) {
    return fetch(url + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function from(base) {
    return Promise.all([getJSON(base + 'plan.json'), getJSON(base + 'prices.json'), getJSON(base + 'phone.json').catch(function () { return {}; })])
      .then(function (r) { return { plan: r[0], prices: r[1], shared: r[2] }; }, function () { return null; });
  }
  function stamp(p) { var t = Date.parse((p.run && p.run.finished) || p.checked || ''); return isFinite(t) ? t : 0; }

  function refresh() {
    loadedAt = Date.now();
    return Promise.all([from('shelf-check/data/'), from(RAW)]).then(function (res) {
      var got = res.filter(function (r) { return r && r.plan && r.plan.bays && r.prices; })
                   .sort(function (a, b) { return stamp(b.prices) - stamp(a.prices); })[0];
      if (!got) throw new Error('no data');
      src = got;
      src.shared = { readings: joinReadings(res.map(function (r) { return r && r.shared && r.shared.readings; })),
                     done: joinDone(res.map(function (r) { return r && r.shared && r.shared.done; })) };
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
    var ov = live ? liveView(src.prices) : overlay(src.prices);
    data = merge(plan, ov);
    data.allBays = src.plan.bays.length;
    everything = merge(src.plan, ov);                   // every line on the plan: a phone check reads all of them
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

  /* ---------- prices read on this phone, laid over GitHub's ----------
   * A phone reading counts when it's newer than GitHub's for that line. If the phone has checked a newer week
   * than GitHub (say GitHub got blocked on Monday), that week is shown: lines the phone read are compared with
   * the last known price, and the rest show their last price as not rechecked. */

  function localData() {
    var v = load(PHONE_KEY, null) || {};
    return { readings: v.readings && typeof v.readings === 'object' ? v.readings : {}, done: v.done && typeof v.done === 'object' && !Array.isArray(v.done) ? v.done : {} };
  }
  /* keep three weeks of readings at most, and only the checks they came from */
  function pruneLocal(pd) {
    var cut = Date.now() - 21 * 86400000, runs = {};
    Object.keys(pd.readings).forEach(function (c) { if (Date.parse(pd.readings[c].at) < cut) delete pd.readings[c]; else runs[pd.readings[c].run] = 1; });
    Object.keys(pd.done).forEach(function (id) { if (!runs[id]) delete pd.done[id]; });
    return pd;
  }
  /* newest reading per line from several sets */
  function joinReadings(sets) {
    var out = {};
    sets.forEach(function (set) {
      if (!set || typeof set !== 'object') return;
      Object.keys(set).forEach(function (c) {
        var r = set[c];
        if (!r || !(r.price > 0) || !isFinite(Date.parse(r.at))) return;
        if (!out[c] || Date.parse(r.at) > Date.parse(out[c].at)) out[c] = r;
      });
    });
    return out;
  }
  /* the successful checks: {check id: the day of the update it was compared with} */
  function joinDone(sets) {
    var out = {};
    sets.forEach(function (set) { if (set && typeof set === 'object' && !Array.isArray(set)) Object.keys(set).forEach(function (id) { out[id] = set[id]; }); });
    return out;
  }
  var memManual = {};                                     // prices typed in just for this page: gone on refresh
  function phoneData() {
    var l = localData(), sh = (src && src.shared) || {};
    return { readings: joinReadings([sh.readings, l.readings, memManual]), done: joinDone([sh.done, l.done]) };
  }
  function ghClock(gh) {                                  // when GitHub last read a line
    var run = gh.run || {}, fin = run.finished ? Date.parse(run.finished) : 0, finDay = run.finished ? londonDay(run.finished) : '';
    return function (p) { return !p || !p.on ? 0 : p.on === finDay ? fin : Date.parse(p.on + 'T12:00:00Z'); };
  }
  function overlay(gh) {
    var pd = phoneData(), R = pd.readings, done = pd.done, P = gh.products || {}, run = gh.run || {};
    var ghWeek = run.week || (gh.checked ? mondayOf(gh.checked) : ''), ghTime = ghClock(gh), fin = run.finished ? Date.parse(run.finished) : 0;
    var good = {}, last = '', lastAny = '';
    Object.keys(R).forEach(function (c) {
      var r = R[c], t = Date.parse(r.at);
      if (!(r.price > 0) || !isFinite(t) || t <= ghTime(P[c])) return;
      good[c] = r;
      var dd = londonDay(r.at);
      if (dd > lastAny) lastAny = dd;
      if (!r.manual && !r.part && dd > last) last = dd;      // a typed price or a retry of a few lines doesn't make the whole list newer
    });
    if (!lastAny) return gh;
    var week = mondayOf(lastAny);
    if (week < ghWeek) return gh;
    var newer = week > ghWeek, out = {}, products = {};
    // the latest successful phone check replaces what earlier checks said had changed
    var okRun = Object.keys(done).filter(function (id) { return Date.parse(id) > fin; }).sort().pop();
    Object.keys(P).concat(Object.keys(good)).forEach(function (c) {
      if (products[c]) return;
      var p = P[c] || { name: null, price: null, prev: null, status: 'unchecked' }, r = good[c];
      if (r && mondayOf(londonDay(r.at)) !== week) r = null;           // from an older week than the one shown
      if (!r) {
        products[c] = newer ? { name: p.name, price: p.price, prev: null, status: 'unchecked', was: p.was }
          : okRun && p.status === 'changed' ? { name: p.name, price: p.price, prev: null, status: 'ok', was: p.was, on: p.on } : p;
        return;
      }
      var base = r.base !== undefined ? r.base : (!newer && p.status === 'changed' ? p.prev : p.price);
      var moved = base != null && Math.abs(base - r.price) > 0.001;
      products[c] = { name: r.name || p.name, price: r.price, prev: moved ? base : null, status: moved ? 'changed' : 'ok', was: r.was, on: londonDay(r.at), phone: true, typed: !!r.manual };
    });
    for (var k in gh) out[k] = gh[k];
    out.products = products;
    out.checked = okRun ? londonDay(okRun) : newer ? (last || lastAny) : (last > gh.checked ? last : gh.checked);
    out.previous_checked = okRun ? (done[okRun] || gh.previous_checked) : newer ? gh.checked : gh.previous_checked;
    out.run = newer ? { week: week, phone: true } : Object.assign({}, run, { phone: true });
    return out;
  }

  /* A device search shows itself as if from scratch: only what it has read so far, compared with the last
   * successful update. Lines not read yet show as waiting; lines it couldn't read say so. Gone on refresh. */
  function liveView(gh) {
    var P = gh.products || {}, R = {}, products = {}, out = {};
    if (live.session) Object.keys(live.mem).forEach(function (c) { R[c] = live.mem[c]; });
    else { var all = localData().readings; Object.keys(all).forEach(function (c) { if (all[c].run === live.id) R[c] = all[c]; }); }
    var typed = manualReadings(); Object.keys(typed).forEach(function (c) { if (!R[c]) R[c] = typed[c]; });
    Object.keys(P).concat(Object.keys(R)).forEach(function (c) {
      if (products[c]) return;
      var p = P[c] || { name: null }, r = R[c];
      if (!r) { products[c] = { name: p.name, price: null, prev: null, status: 'unchecked', was: null, wait: live.failed[c] ? 'fail' : 'wait' }; return; }
      var moved = r.base != null && Math.abs(r.base - r.price) > 0.001;
      products[c] = { name: r.name || p.name, price: r.price, prev: moved ? r.base : null, status: moved ? 'changed' : 'ok', was: r.was, on: londonDay(r.at), phone: true, typed: !!r.manual };
    });
    for (var k in gh) out[k] = gh[k];
    out.products = products;
    out.checked = londonDay(live.id);
    out.previous_checked = live.baseDay || gh.checked;
    out.run = { week: mondayOf(londonDay(live.id)), phone: true, live: true };
    return out;
  }

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
      plan: { name: plan.name, short: plan.short, store: plan.store, brief: plan.brief, changes: plan.changes }, bays: plan.bays, products: products,
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
    $('sub').hidden = !!d.checked;                      // the notice carries it
    $('notice').hidden = !d.checked;
    if (d.checked) {
      var prevMon = d.previous_checked && utc(d.previous_checked).getUTCDay() === 1;
      $('notice').innerHTML = '<b>' + esc(d.plan.name || 'Front of house') + ' prices correct as of ' + esc(Sheet.nice(d.checked)) + '.</b> ' +
        (d.previous_checked ? 'Changes are against ' + (prevMon && d.previous_checked < mondayOf(d.checked) ? "last Monday's report" : 'the last successful check') + ' (' + esc(Sheet.nice(d.previous_checked)) + '). ' : 'This was the first check, so changes show from next week. ') +
        'Use this as well as this week\'s noon updates for best accuracy.';
    }
    var nw = function (s) { return '<span class="sc-nw">' + esc(s) + '</span>'; };
    $('meta').innerHTML = d.checked
      ? 'Checked <b>' + nw(Sheet.nice(d.checked)) + '</b>' + (d.previous_checked ? ', compared with ' + nw(day(d.previous_checked)) + '.' : '. First check, nothing to compare with yet.')
      : 'Not checked yet.';

    // anything to warn about
    var alerts = [], lastWeek = d.run.week || (d.checked ? mondayOf(d.checked) : '');
    var overdue = lastWeek < week && (now.date > week || now.hour >= 10);
    if (overdue) {
      alerts.push("This week's check hasn't come in yet, so these are from " + esc(day(d.checked)) + '. Use the <b>check</b> buttons below to check now, or <a href="' + RUNS + '" target="_blank" rel="noopener">see the runs on GitHub</a>.');
    } else if (d.run.live) {
      if (live.session) alerts.push('Device search just for you: nothing is saved. Refresh the page to go back to the saved prices.');
    } else if (!d.complete) {
      var left = d.codes.length - d.done, one = left === 1, sameDay = d.checked === now.date && now.hour < 16;
      alerts.push('Part checked: ' + d.done + ' of ' + d.codes.length + ' lines so far. ' +
        (one ? 'The other one shows its last price' : 'The other ' + left + ' show their last price') + ', marked <b>not rechecked</b>' +
        (/429/.test(d.run.stopped || '') ? ' (Screwfix asked it to slow down)' : '') + '. ' +
        (d.run.phone ? 'Tap the button below to check ' + (one ? 'it' : 'them') + ' on this phone.'
          : sameDay ? 'It tries ' + (one ? 'it' : 'them') + ' again later today, or use the check buttons below.' : (one ? "It'll" : "They'll") + ' be checked again next Monday, or use the check buttons below.'));
    }
    $('alert').hidden = !alerts.length;
    $('alert').innerHTML = alerts.length ? WARN + '<div>' + alerts.join('<br>') + '</div>' : '';
    renderPlanChanges();

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
    runBar();
    $('foot').innerHTML = 'Runs by itself on GitHub early every Monday morning. Next check: ' + esc(next) + '. ' +
      "Lines it can't check keep their last price and never count as a change. " +
      '<a href="' + RUNS + '" target="_blank" rel="noopener">Runs on GitHub</a>';

    $('main').hidden = false;
    $('bar').hidden = false;
    var hasPlan = !!Sheet.planChanges(data);
    $('pdfChanges').disabled = !n && !hasPlan;
    $('pdfChanges').title = n || hasPlan ? '' : 'No price changes this week';
    showTab(load(TAB_KEY, 'changes'));
  }


  /* what the newest brief added and removed: stays until the next brief replaces the plan */
  function renderPlanChanges() {
    var pc = Sheet.planChanges(data), box = $('planBox');
    box.hidden = !pc;
    if (!pc) { box.innerHTML = ''; return; }
    var item = function (x, rm) {
      var price = rm ? (x.price != null ? 'last price ' + money(x.price) : '') : (x.price != null ? money(x.price) : '');
      return '<li><span class="sc-pc-sku">' + esc(x.code) + '</span><span class="sc-pc-n">' + esc(x.name || 'name not found yet') +
        '<small>' + (rm ? 'Was at: ' : 'Now at: ') + esc(x.where) + (x.note ? ' (' + esc(x.note) + ')' : '') + (price ? ' &middot; ' + esc(price) : '') + '</small></span></li>';
    };
    var list = function (title, cls, arr, rm) {
      return arr.length ? '<h3 class="sc-pc-k ' + cls + '">' + title + ' <span>' + arr.length + '</span></h3><ul class="sc-pc-l">' + arr.map(function (x) { return item(x, rm); }).join('') + '</ul>' : '';
    };
    box.innerHTML = '<div class="sc-pc-h"><strong>Shelf plan changes</strong><span>brief ' + esc(pc.brief || '') + '</span></div>' +
      list('Added', 'is-add', pc.added, false) + list('Removed', 'is-rm', pc.removed, true) +
      (pc.check.length ? '<p class="sc-pc-q"><b>Not sure:</b> ' + pc.check.map(function (c) { return '<b>' + esc(c.code) + '</b> ' + esc(c.why); }).join('; ') + '</p>' : '');
  }

  function priceCell(c) {
    var p = data.products[c], out = '';
    var changed = p.status === 'changed' && p.price != null && p.prev != null;
    if (p.wait) out = '<span class="sc-na">' + (p.wait === 'fail' ? "couldn't be read" : phone ? 'waiting' : 'not checked') + '</span>';
    else if (p.status === 'not_found') out = '<span class="sc-na">not found online</span>';
    else if (p.price == null) out = '<span class="sc-na">not checked yet</span>';
    else {
      out = '<span class="sc-now">' + money(p.price) + '</span>';
      if (changed) out += '<span class="sc-was">was <s>' + money(p.prev) + '</s></span>';
      else if (p.status === 'unchecked') out += '<span class="sc-note">not rechecked</span>';
      else if (p.typed) out += '<span class="sc-note">typed in</span>';
    }
    var tags = '';
    if (changed) tags += '<span class="sc-tag">' + (p.price > p.prev ? ARROW_UP + 'UP' : ARROW_DOWN + 'DOWN') + '</span>';
    if (p.was && p.price != null && p.status !== 'not_found') tags += '<span class="sc-tag is-offer" title="On offer, was ' + money(p.was) + '">Offer</span>';
    return '<div class="sc-price">' + out + (tags ? '<div class="sc-tags">' + tags + '</div>' : '') + '</div>';
  }

  function doneSet() {
    var s = load(DONE_KEY, null);
    return s && s.checked === tickWeek() && Array.isArray(s.codes) ? s.codes : [];
  }
  function tickWeek() { return data.run.week || (data.checked ? mondayOf(data.checked) : ''); }
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
      (d.run.live && phone ? 'None found yet. Changes show here as the search finds them.'
       : d.previous_checked ? 'Every price matches ' + esc(day(d.previous_checked)) + '. Nothing to swap this week.' : 'This was the first check, so changes show from next week.');
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
    store(DONE_KEY, { checked: tickWeek(), codes: codes });
    row.classList.toggle('is-done', e.target.checked);
    hint();
  });

  function renderBays() {
    var d = data, open = {};
    Array.prototype.forEach.call($('bays').querySelectorAll('.sc-bay[open]'), function (b) { open[b.getAttribute('data-name')] = 1; });
    $('bays').innerHTML = d.bays.map(function (b, i) {
      var mine = d.spots.filter(function (s) { return s.bi === i; });
      var moved = mine.filter(function (s) { return d.changed.indexOf(s.code) >= 0; }).length;
      var shelves = [];
      mine.forEach(function (s) {
        var sh = shelves[shelves.length - 1];
        if (!sh || sh.si !== s.si) shelves.push(sh = { si: s.si, label: s.shelf, spots: [] });
        sh.spots.push(s);
      });
      return '<details class="sc-bay" data-bay="' + i + '" data-name="' + esc(b.name) + '"' + (open[b.name] ? ' open' : '') + '><summary>' +
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

  /* ---------- check on this phone ----------
   * A web page can't read screwfix.com itself (the browser blocks it), so this goes through the same free relays
   * as Price Tickets: one line at a time, with a short gap, while this page stays open. Readings are kept on this
   * phone (and shared, if sharing is on). If the page is closed part way, the next tap carries on where it stopped.
   *
   * Changes are always against the last SUCCESSFUL update: a check that read every line (or whose unread lines
   * were deliberately ignored) counts. A check that stopped part way doesn't, so the next one still compares with
   * the last good one. Each reading remembers the price it was compared with (base) and which check it came from. */

  var SL = window.ScrewfixLookup, phone = null, wakeLock = null, sinceBuild = 0;
  var PHONE_GAP = 1000, PER_LINE = 4;                      // ms between lines on top of the relay spacing; rough seconds per line

  /* the search in hand: a saved update-area one (kept 3 days), or this page's just-for-you one */
  var memRun = null;
  function curRun() {
    var r = load(PHONE_RUN_KEY, null);
    if (r && Array.isArray(r.queue) && Array.isArray(r.failed) && Date.now() - Date.parse(r.started) <= 3 * 86400000 && (r.queue.length || r.failed.length)) return r;
    return memRun && (memRun.queue.length || memRun.failed.length) ? memRun : null;
  }
  function saveRun(r) { if (r.session) memRun = r; else store(PHONE_RUN_KEY, r); }
  function dropRun(r) {
    if (r.session) { if (memRun === r) memRun = null; return; }
    try { localStorage.removeItem(PHONE_RUN_KEY); } catch (e) { /* fine */ }
  }
  function pounds(v) { if (v == null || v === '') return null; var n = Number(String(v).replace(/[£,\s]/g, '')); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }
  function mins(n) { var m = Math.max(1, Math.round(n * PER_LINE / 60)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  /* what a reading is compared with: this line's price at the last successful update */
  function refFor(code) {
    var gh = src.prices, p = (gh.products || {})[code], pd = phoneData(), r = pd.readings[code];
    if (r && r.run && Date.parse(r.at) > ghClock(gh)(p)) return pd.done[r.run] !== undefined ? r.price : (r.base != null ? r.base : null);
    if (!p) return null;
    return gh.run && gh.run.complete ? p.price : (p.status === 'changed' ? p.prev : p.price);
  }
  /* the day of that last successful update */
  function refDay() {
    var gh = src.prices, run = gh.run || {}, fin = run.finished ? Date.parse(run.finished) : 0, done = phoneData().done;
    var id = Object.keys(done).filter(function (i) { return Date.parse(i) > fin; }).sort().pop();
    return id ? londonDay(id) : run.complete ? gh.checked : gh.previous_checked;
  }
  var WHY = { notfound: 'Screwfix page not found', blocked: 'Blocked or timed out', unclear: 'No clear price on the page',
              unconfirmed: "New price couldn't be confirmed" };
  function whyNot(r) {
    if (r && r.status === 'notfound') return WHY.notfound;
    if (r && (r.status === 'found' || r.status === 'partial')) return WHY.unclear;
    return WHY.blocked;
  }


  function runBar() {
    if (!data) return;
    $('runBar').hidden = false;
    if (phone) { $('missBox').hidden = true; return; }
    var r = curRun(), more = r && r.queue.length, pending = r && !more && r.failed.length;
    $('failBox').hidden = !pending;
    if (pending) renderFails(r);
    renderMiss(pending);
    $('phoneRun').hidden = !!pending || !!(r && r.session);
    $('phoneSession').hidden = !!pending || !!(r && !r.session);
    $('ghRun').hidden = !!r;
    $('phoneFresh').hidden = !r;
    $('runStatus').hidden = !r;
    $('runStatus').innerHTML = pending ? 'Read ' + r.got + ' of ' + r.total + '. Choose what to do with the lines below.'
      : more ? 'The search stopped part way, <b>' + r.queue.length + ' left</b>.' : '';
    $('phoneLabel').textContent = more && !r.session ? 'Carry on (' + r.queue.length + ' left)' : 'Device search';
    $('phoneSub').textContent = token() ? 'Updates the area · about ' + mins(everything.codes.length) : 'Updates the area · needs a GitHub token first';
    $('sessionLabel').textContent = more && r.session ? 'Carry on (' + r.queue.length + ' left)' : 'Device search';
    $('phoneFresh').textContent = 'Drop this and start again';
    ghLine();
  }

  /* lines that couldn't be read: retry or ignore each one */
  function renderFails(r) {
    var spots = {};
    everything.spots.forEach(function (s) { if (!spots[s.code]) spots[s.code] = s; });
    $('failTitle').innerHTML = '<b>' + plural(r.failed.length, 'line') + " couldn't be read</b>";
    $('failList').innerHTML = r.failed.map(function (f, i) {
      var p = everything.products[f.c] || {}, on = f.pick === 'retry';
      return '<li class="sc-fail-i" data-i="' + i + '"><div class="sc-fail-t"><b>' + esc(f.c) + '</b> ' + esc(p.name || '') +
        '<small>' + esc(f.why) + (p.price != null ? ' &middot; last price ' + money(p.price) : '') + (spots[f.c] ? ' &middot; ' + esc(Sheet.where(spots[f.c])) : '') + '</small></div>' +
        '<div class="sc-seg" role="group" aria-label="' + esc(f.c) + '"><button type="button" data-i="' + i + '" data-pick="retry" class="' + (on ? 'is-on' : '') + '" aria-pressed="' + on + '">Retry</button>' +
        '<button type="button" data-i="' + i + '" data-pick="ignore" class="' + (f.pick === 'ignore' ? 'is-on' : '') + '" aria-pressed="' + (f.pick === 'ignore') + '">Ignore</button>' +
        '<button type="button" data-i="' + i + '" data-pick="price" class="' + (f.pick === 'price' ? 'is-on' : '') + '" aria-pressed="' + (f.pick === 'price') + '">Enter price</button></div>' +
        (f.pick === 'price' ? entryForm(f.c) : '') + '</li>';
    }).join('');
    var nr = r.failed.filter(function (f) { return f.pick === 'retry'; }).length, ni = r.failed.length - nr;
    $('failGo').textContent = nr ? 'Retry ' + nr + (ni ? ', ignore ' + ni : '') : 'Finish, ignoring ' + ni;
  }
  $('failList').addEventListener('click', function (e) {
    var r = curRun(), s = e.target.closest('button[data-save]');
    if (s && r) {
      var li = s.closest('li'), f = r.failed[+li.getAttribute('data-i')];
      if (f && saveEntry(li, f.c, s.getAttribute('data-save') === 'all')) {
        r.failed = r.failed.filter(function (g) { return g !== f; }); r.ignored.push(f.c); r.got++;
        if (!r.failed.length && !r.queue.length) { completeRun(r); build(); if (!r.session) share(false); runBar(); }
        else { saveRun(r); build(); renderFails(r); }
      }
      return;
    }
    var b = e.target.closest('button[data-pick]');
    if (!b || !r) return;
    r.failed[+b.getAttribute('data-i')].pick = b.getAttribute('data-pick');
    saveRun(r);
    renderFails(r);
  });
  function pickAll(pick) { var r = curRun(); if (!r) return; r.failed.forEach(function (f) { f.pick = pick; }); saveRun(r); renderFails(r); }
  $('failAllRetry').addEventListener('click', function () { pickAll('retry'); });
  $('failAllIgnore').addEventListener('click', function () { pickAll('ignore'); });
  $('failGo').addEventListener('click', function () {
    var r = curRun();
    if (!r || phone) return;
    var again = r.failed.filter(function (f) { return f.pick === 'retry'; }).map(function (f) { return f.c; });
    r.failed.forEach(function (f) { if (f.pick !== 'retry') r.ignored.push(f.c); });
    r.failed = [];
    if (!again.length) { completeRun(r); build(); if (!r.session) share(false); runBar(); return; }
    r.queue = again; r.passTotal = again.length;
    beginRun(r);
  });

  /* ---------- typing a price in by hand, and retrying the lines that couldn't be checked ---------- */

  function manualReadings() {
    var l = localData().readings, out = {};
    Object.keys(l).forEach(function (c) { if (l[c].manual) out[c] = l[c]; });
    return joinReadings([out, memManual]);
  }
  function entryForm(code) {
    return '<div class="sc-ent"><span class="sc-ent-p">&pound;</span><input class="sc-ent-in" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="Price for ' + esc(code) + '">' +
      '<button type="button" class="btn btn-primary" data-save="all">Save for everyone</button><button type="button" class="btn" data-save="me">Just for me</button></div>';
  }
  /* reads the box in that row; true when the price was kept */
  function saveEntry(li, code, forAll) {
    var inp = li.querySelector('.sc-ent-in'), price = pounds(inp && inp.value);
    if (price == null) { toast('Type the price as a number, like 4.99.'); if (inp) inp.focus(); return false; }
    if (forAll && !token()) { needToken('save a price for everyone'); return false; }
    var p = everything.products[code] || {}, now = new Date().toISOString();
    var reading = { price: price, name: p.name || null, was: null, at: now, base: refFor(code), run: 'manual-' + now, manual: 1 };
    if (forAll) {
      var pd = localData(); pd.readings[code] = reading; store(PHONE_KEY, pruneLocal(pd));
      delete memManual[code];
      share(true);
      toast(code + ' saved at ' + money(price) + ' for everyone.');
    } else { memManual[code] = reading; toast(code + ' set to ' + money(price) + ' for you. Gone when you refresh.'); }
    return true;
  }
  function missing() { return everything.codes.filter(function (c) { return everything.products[c].status === 'unchecked'; }); }
  function renderMiss(hide) {
    var list = hide || live ? [] : missing(), box = $('missBox');
    box.hidden = !list.length;
    if (!list.length) return;
    var spots = {};
    everything.spots.forEach(function (s) { if (!spots[s.code]) spots[s.code] = s; });
    $('missTitle').textContent = plural(list.length, 'line') + ' not checked';
    $('missRetryAll').textContent = 'Retry these · save for everyone';
    $('missRetryMe').textContent = 'Retry these · just for me';
    $('missList').innerHTML = list.map(function (c) {
      var p = everything.products[c];
      return '<li class="sc-fail-i" data-code="' + esc(c) + '"><div class="sc-fail-t"><b>' + esc(c) + '</b> ' + esc(p.name || '') +
        '<small>' + (p.price != null ? 'last price ' + money(p.price) : 'no price yet') + (spots[c] ? ' &middot; ' + esc(Sheet.where(spots[c])) : '') + '</small></div>' +
        '<div class="sc-seg"><button type="button" data-enter="1">Enter price</button></div></li>';
    }).join('');
  }
  $('missList').addEventListener('click', function (e) {
    var li = e.target.closest('li'), s = e.target.closest('button[data-save]');
    if (!li) return;
    var code = li.getAttribute('data-code');
    if (s) { if (saveEntry(li, code, s.getAttribute('data-save') === 'all')) { build(); } return; }
    if (e.target.closest('button[data-enter]')) {
      var f = li.querySelector('.sc-ent');
      if (f) f.remove(); else { li.insertAdjacentHTML('beforeend', entryForm(code)); li.querySelector('.sc-ent-in').focus(); }
    }
  });
  function startRetry(session) {
    if (phone || !data) return;
    if (!SL || !SL.lookup) { toast("The price reader didn't load. Refresh the page."); return; }
    if (!session && !token()) { needToken('update the area'); return; }
    var codes = missing();
    if (!codes.length) return;
    var r = newRun(codes, session);
    r.partial = true;
    beginRun(r);
  }
  $('missRetryAll').addEventListener('click', function () { startRetry(false); });
  $('missRetryMe').addEventListener('click', function () { startRetry(true); });

  /* Background tabs get their timers slowed (down to one a minute after about 5 minutes in Chrome and Edge), which would
   * turn a 40 minute check into hours. A Web Worker's timers aren't slowed, so while a check runs, setTimeout is
   * handed to one. If a worker can't be made the page just carries on with normal timers. */
  var nativeSet = window.setTimeout, nativeClear = window.clearTimeout, tickWorker = null, tickFns = {}, tickId = 0;
  function fastTimers(on) {
    if (!on) {
      if (tickWorker) { try { tickWorker.terminate(); } catch (e) { /* gone */ } }
      tickWorker = null; tickFns = {};
      window.setTimeout = nativeSet; window.clearTimeout = nativeClear;
      return;
    }
    if (tickWorker) return;
    try {
      var blob = new Blob(['onmessage=function(e){var d=e.data;setTimeout(function(){postMessage(d.id)},d.ms)}'], { type: 'text/javascript' });
      var w = new Worker(URL.createObjectURL(blob));
      w.onmessage = function (e) { var f = tickFns[e.data]; delete tickFns[e.data]; if (f) f(); };
      w.onerror = function () { fastTimers(false); };
      tickWorker = w;
      window.setTimeout = function (fn, ms) {
        if (typeof fn !== 'function') return nativeSet.apply(window, arguments);
        var id = -(++tickId), extra = Array.prototype.slice.call(arguments, 2);
        tickFns[id] = function () { fn.apply(window, extra); };
        w.postMessage({ id: id, ms: Math.max(0, +ms || 0) });
        return id;
      };
      window.clearTimeout = function (id) { if (id < 0) delete tickFns[id]; else nativeClear(id); };
    } catch (e) { tickWorker = null; }
  }

  function keepAwake() {
    if (!phone || !navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }, function () { wakeLock = null; });
  }
  function letSleep() { if (wakeLock) { try { wakeLock.release(); } catch (e) { /* already gone */ } } wakeLock = null; }

  function progress() {
    if (!phone) return;
    var n = phone.passTotal, d = n - phone.queue.length;
    $('progText').textContent = (phone.again ? 'Retrying ' : 'Checking ') + Math.min(d + 1, n) + ' of ' + n;
    $('progBar').style.width = Math.round(d / n * 100) + '%';
    $('progNote').innerHTML = (phone.current ? '<b>' + esc(phone.current) + '</b> &middot; ' : '') + phone.got + ' read' +
      (phone.moved ? ', <b>' + phone.moved + '</b> changed' : '') + (phone.failed.length ? ', ' + phone.failed.length + " couldn't be read" : '') +
      '. About ' + mins(phone.queue.length) + ' left. Keep this page open' + (ios ? ' and the screen on.' : '.');
  }

  function newRun(codes, session) {
    var now = new Date().toISOString();
    return { id: now, started: now, session: !!session, total: codes.length, passTotal: codes.length, got: 0, moved: 0, changes: [],
             queue: codes.slice(), failed: [], ignored: [], baseDay: refDay() || '' };
  }
  function needToken(what) {
    toast('To ' + what + ', add a GitHub token first.');
    $('share').open = true;
    $('share').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function startPhone(fresh, session) {
    if (phone || !data) return;
    if (!SL || !SL.lookup) { toast("The price reader didn't load. Refresh the page."); return; }
    if (!session && !token()) { needToken('update the area'); return; }
    var r = fresh ? null : curRun();
    if (r && (!r.queue.length || !!r.session !== !!session)) r = null;
    if (!r) r = newRun(everything.codes.slice(), session);
    beginRun(r);
  }
  function beginRun(r) {
    phone = r;
    phone.current = ''; phone.streak = 0; phone.again = r.passTotal < r.total;
    saveRun(r);
    // show this search as if from scratch: earlier changes are hidden until the page is refreshed
    if (!r.partial && (!live || live.id !== r.id)) live = { id: r.id, session: !!r.session, baseDay: r.baseDay, mem: {}, failed: {} };
    $('phoneSession').hidden = true; $('ghRun').hidden = true; $('failBox').hidden = true; $('missBox').hidden = true;
    $('runBar').classList.add('is-running');
    $('runStatus').hidden = true; $('phoneRun').hidden = true; $('phoneFresh').hidden = true;
    $('prog').hidden = false;
    build();
    keepAwake();
    fastTimers(true);
    progress();
    nextPhone();
  }

  function nextPhone() {
    if (!phone) return;
    if (!phone.queue.length) { finishPhone('done'); return; }
    var me = phone, code = phone.queue[0];
    phone.current = code;
    progress();
    SL.lookup(code).then(function (r) {
      if (phone !== me) return;                           // stopped while this one was being read
      var price = r && (r.status === 'found' || r.status === 'partial') && !r.unsure ? pounds(r.price) : null, ref = refFor(code);
      // a price read only off the page's text (some relays send no product data) can confirm an unchanged price
      // but never make a change: it could be another size or product on the page
      var unconfirmed = price != null && !(r.ld && r.ldSure) && ref != null && Math.abs(ref - price) > 0.001;
      if (unconfirmed) price = null;
      if (price != null) {
        var before = everything.products[code];
        if (ref != null && Math.abs(ref - price) > 0.001) { me.moved++; me.changes.push(code + ' ' + money(ref) + ' to ' + money(price)); }
        var was = pounds(r.was), reading = { price: price, name: r.name || (before && before.name) || null, was: was != null && was > price ? was : null, at: new Date().toISOString(), base: ref, run: me.id };
        if (live && live.id === me.id) delete live.failed[code];
        if (me.partial) reading.part = 1;
        if (me.session) { if (me.partial) memManual[code] = reading; else if (live && live.id === me.id) live.mem[code] = reading; }
        else {
          var pd = localData();
          pd.readings[code] = reading;
          store(PHONE_KEY, pruneLocal(pd));
          me.unshared = (me.unshared || 0) + 1;
        }
        if (ref != null && Math.abs(ref - price) > 0.001) me.fresh = true;     // a change: show it straight away
        me.got++;
        me.streak = 0;
      } else {
        // a failed read is never a price change: the line keeps its last price
        me.failed.push({ c: code, why: unconfirmed ? WHY.unconfirmed : whyNot(r), pick: 'retry' });
        if (live && live.id === me.id) live.failed[code] = 1;
        me.streak++;
      }
    }, function () { if (phone === me) { me.failed.push({ c: code, why: WHY.blocked, pick: 'retry' }); if (live && live.id === me.id) live.failed[code] = 1; me.streak++; } }).then(function () {
      if (phone !== me) return;
      me.queue.shift();
      if (me.streak >= 6) {
        // nothing's getting through: put those six back so Carry on tries them again
        me.queue = me.failed.splice(-6, 6).map(function (f) { return f.c; }).concat(me.queue);
        saveRun(me);
        finishPhone('blocked');
        return;
      }
      saveRun(me);
      if (me.fresh || ++sinceBuild >= 5) { sinceBuild = 0; me.fresh = false; build(); }   // the lists fill in as it goes
      if (!me.session && me.unshared >= 100) { me.unshared = 0; share(true); }
      progress();
      setTimeout(nextPhone, PHONE_GAP);
    });
  }

  /* every line read, or its failure deliberately ignored: this check is now the last successful update */
  function completeRun(r) {
    if (!r.session && !r.partial) {                        // a retry of a few lines isn't a whole update
      var pd = localData();
      pd.done[r.id] = r.baseDay || '';
      store(PHONE_KEY, pd);
    }
    dropRun(r);
  }

  function finishPhone(why) {
    var r = phone;
    phone = null;
    letSleep();
    fastTimers(false);
    $('runBar').classList.remove('is-running');
    $('prog').hidden = true;
    $('runStatus').hidden = false; $('phoneRun').hidden = false;
    r.current = '';
    if (why === 'done' && !r.failed.length) completeRun(r); else saveRun(r);
    sinceBuild = 0;
    build();
    if (!r.session && r.got) share(false);
    clearTimeout(warmTimer);
    warmTimer = setTimeout(warm, 800);
    runBar();
    var kept = r.session ? ' Nothing saved: refresh to clear it.' : '';
    if (why === 'done' && !r.failed.length) toast('Read ' + r.got + ' of ' + r.total + (r.moved ? ', ' + plural(r.moved, 'price change') : ', no price changes') + '.' + kept);
    else if (why === 'done') toast(plural(r.failed.length, 'line') + " couldn't be read. Choose which to retry or ignore.");
    else if (why === 'stopped') toast('Stopped. Tap Carry on to finish the other ' + r.queue.length + '.');
    else toast("Couldn't read 6 in a row, so it stopped. The relays may be busy or this wifi blocks them. Try again in a bit, or on mobile data.");
  }

  /* ---------- sharing: readings go into the repo (tools/shelf-check/data/phone.json) so every store sees them ----------
   * Needs a GitHub token saved on this phone (fine-grained, Toolbox repo only, Contents: read and write).
   * Without one, readings stay on this phone. Only lines that read cleanly are ever shared. */

  var sharing = false;
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }
  function unb64(str) { return decodeURIComponent(escape(atob(str.replace(/\s/g, '')))); }
  function ghHeaders(t) { return { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Authorization': 'Bearer ' + t }; }

  function putShared(t, tries) {
    return fetch(SHARE_API + '?ref=main&t=' + Date.now(), { headers: ghHeaders(t), cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return { sha: null, readings: {}, done: {} };
      if (!r.ok) throw r;
      return r.json().then(function (j) {
        var v = {}; try { v = JSON.parse(unb64(j.content)); } catch (e) { /* start over */ }
        return { sha: j.sha, readings: v && v.readings || {}, done: v && v.done || {} };
      });
    }).then(function (cur) {
      var l = localData(), merged = pruneLocal({ readings: joinReadings([cur.readings, l.readings]), done: joinDone([cur.done, l.done]) });
      var n = Object.keys(merged.readings).length;
      var body = { message: 'Phone price check readings', branch: 'main', content: b64(JSON.stringify({ updated: new Date().toISOString(), readings: merged.readings, done: merged.done }) + '\n') };
      if (cur.sha) body.sha = cur.sha;
      return fetch(SHARE_API, { method: 'PUT', headers: ghHeaders(t), body: JSON.stringify(body) }).then(function (r) {
        if ((r.status === 409 || r.status === 422) && tries < 3) return putShared(t, tries + 1);   // someone else saved at the same moment
        if (!r.ok) throw r;
        return n;
      });
    });
  }
  function share(quiet) {
    var t = token();
    if (!t || sharing) return Promise.resolve();
    sharing = true;
    return putShared(t, 0).then(function (n) {
      if (!quiet) toast('Shared ' + n + ' readings with every store. They show up in a minute or two.');
    }, function (r) {
      var st = r && r.status;
      toast(st === 401 ? "GitHub didn't accept the token, so nothing was shared. Check it under GitHub token."
        : st === 403 || st === 404 ? "The token can't save to the Toolbox repo (it needs Contents: Read and write), so nothing was shared. See GitHub token."
        : "Couldn't share the readings just now. They're still on this phone; the next check tries again.");
    }).then(function () { sharing = false; });
  }
  function tokenUI() {
    var has = !!token();
    $('shareSum').textContent = has ? 'Saved on this phone' : 'Needed for the two update area buttons';
    $('shareOn').hidden = !has; $('shareOff').hidden = has;
    if (data) runBar();
  }
  $('shareSave').addEventListener('click', function () {
    var v = $('shareToken').value.replace(/\s/g, '');
    if (!v) return;
    try { localStorage.setItem(TOKEN_KEY, v); } catch (e) { toast("Couldn't save the token on this device."); return; }
    $('shareToken').value = '';
    $('share').open = false;
    tokenUI();
    toast('Token saved. The update area buttons are ready.');
  });
  $('shareForget').addEventListener('click', function () {
    if (!window.confirm('Remove the GitHub token from this phone? The update area buttons will need it again.')) return;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* nothing saved */ }
    tokenUI();
  });
  tokenUI();

  /* ---------- GitHub search: starts the weekly check on GitHub now (mode full) ---------- */

  var ghRun = null, ghTimer = 0, ghSince = 0;
  function ghLine() {
    var busy = ghRun && ghRun.status !== 'completed';
    $('ghSub').textContent = busy ? 'Running on GitHub since ' + new Date(ghRun.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · the page updates when it finishes'
      : token() ? 'Updates the area · runs on GitHub, about 50 min' : 'Updates the area · needs a GitHub token first';
    $('ghRun').classList.toggle('is-busy', !!busy);
  }
  function ghStatus() {
    var t = token(), h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (t) h.Authorization = 'Bearer ' + t;
    return fetch(DISPATCH + '/runs?per_page=1&t=' + Date.now(), { headers: h, cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw r; return r.json(); })
      .then(function (j) {
        var was = ghRun && ghRun.status !== 'completed', top = (j.workflow_runs || [])[0] || null;
        if (ghSince && (!top || Date.parse(top.created_at) < ghSince - 60000)) {   // GitHub hasn't listed the new run yet
          clearTimeout(ghTimer); ghTimer = setTimeout(ghStatus, 15000); return;
        }
        ghSince = 0;
        ghRun = top;
        var busy = ghRun && ghRun.status !== 'completed';
        ghLine();
        clearTimeout(ghTimer);
        if (busy) ghTimer = setTimeout(ghStatus, 60000);
        if (was && !busy) { toast('GitHub search finished. Prices updated.'); refresh(); setTimeout(refresh, 120000); }
      }).catch(function () { /* the status is a nice-to-have */ });
  }
  $('ghRun').addEventListener('click', function () {
    if (phone) return;
    if (ghRun && ghRun.status !== 'completed') { toast('GitHub is already searching. The page updates when it finishes.'); return; }
    var t = token();
    if (!t) { needToken('run the GitHub search'); return; }
    if (!window.confirm('Start a GitHub search of all ' + everything.codes.length + ' lines now?\n\nIt runs on GitHub (about 50 min) and updates the area when it finishes.')) return;
    fetch(DISPATCH + '/dispatches', { method: 'POST', headers: ghHeaders(t), body: JSON.stringify({ ref: 'main', inputs: { mode: 'full' } }) }).then(function (r) {
      if (r.status === 204) {
        toast('GitHub search started. About 50 min; the page updates when it finishes.');
        ghRun = { status: 'queued', created_at: new Date().toISOString() };
        ghSince = Date.now();
        ghLine();
        setTimeout(ghStatus, 8000);
        return;
      }
      toast(r.status === 401 ? "GitHub didn't accept the token. It may have expired: add it again under GitHub token."
        : r.status === 403 || r.status === 404 ? 'The token needs one more permission: Actions, Read and write. See GitHub token.'
        : 'GitHub said no (HTTP ' + r.status + '). Try again in a minute.');
    }, function () { toast("Couldn't reach GitHub. Check your connection."); });
  });
  ghStatus();

  $('phoneRun').addEventListener('click', function () { startPhone(false); });
  $('phoneFresh').addEventListener('click', function () {
    var r = curRun(), t = !!(r && r.session);
    if (r) dropRun(r);
    startPhone(true, t);
  });
  $('phoneSession').addEventListener('click', function () { startPhone(false, true); });
  $('phoneStop').addEventListener('click', function () { if (phone) finishPhone('stopped'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && phone) keepAwake(); });
  window.addEventListener('beforeunload', function (e) { if (phone) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- start ---------- */

  refresh();
  // back on the page after a while (say on Monday morning): fetch the latest check again
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - loadedAt > 15 * 60000) refresh();
  });
})();
