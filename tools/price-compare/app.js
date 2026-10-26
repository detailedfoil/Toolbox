/* Price Compare: the same product's price at every major store, cheapest first (copper pipe, 18V batteries, twin and
   earth cable; each group can have its own stores).

   - data/compare.json lists the stores and products, and why some stores have no price. data/prices.json is what the
     GitHub check found (twice a day, .github/price-compare/check.mjs). Both come from the site and from
     raw.githubusercontent.com: the list from GitHub first (newest), the prices from whichever was checked later.
   - "Check now" reads every store's page live on this phone through jina (r.jina.ai), with the same reader the GitHub
     check uses (read.js). What it finds stays on this phone (pc-live-v1, a week) and is shown wherever it's newer
     than GitHub's copy. A price more than 25% away from the one showing is only believed once the page's own product
     data agrees.
   - The product shown, and Inc / Ex VAT, are remembered on this phone (pc-item-v1, pc-group-v1, pc-vat-v1). Every price
     is kept including VAT; Ex VAT shows it divided by 1.2 (everything compared carries 20% VAT). */
(function () {
  'use strict';
  var R = window.PriceRead;
  var SITE = 'price-compare/data/', RAW = 'https://raw.githubusercontent.com/detailedfoil/Toolbox/main/tools/price-compare/data/';
  var JINA = 'https://r.jina.ai/', JINA_EVERY = 3300, WORKERS = 2;
  var LIVE_KEY = 'pc-live-v1', LIVE_DAYS = 7, BIG = 0.25, OLD_DAYS = 14;
  var $ = function (id) { return document.getElementById(id); };
  var state = { list: null, prices: null, live: {}, group: null, item: null, checking: false, run: null, liveFail: {}, busy: {}, vat: 'inc' };

  function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ms(iso) { var t = iso ? Date.parse(iso) : NaN; return isNaN(t) ? 0 : t; }
  /* prices are kept including VAT; shown with or without it, as picked */
  function shown(v) { return state.vat === 'ex' ? v / R.VAT : v; }
  function money(v) { return '£' + Number(shown(v)).toFixed(2); }
  function diff(v) { v = Math.abs(shown(v)); return Math.round(v * 100) < 100 ? Math.round(v * 100) + 'p' : '£' + v.toFixed(2); }
  function ukDay(t) { return new Date(t).toLocaleDateString('en-GB', { timeZone: 'Europe/London' }); }
  /* "05:41 today", "12:41 yesterday", "05:41 Sat 24 Oct", UK time */
  function when(t) {
    if (!t) return '';
    var d = new Date(t), hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    if (ukDay(t) === ukDay(Date.now())) return hm + ' today';
    if (ukDay(t) === ukDay(Date.now() - 864e5)) return hm + ' yesterday';
    return hm + ' ' + d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  }
  function day(t) {
    if (ukDay(t) === ukDay(Date.now())) return 'today';
    if (ukDay(t) === ukDay(Date.now() - 864e5)) return 'yesterday';
    return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  }
  function nth(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  /* ---------- loading ---------- */

  function getJSON(url) {
    return fetch(url + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function freshness(p) { return p ? Math.max(ms(p.checked), ms(p.last && p.last.started)) : -1; }

  function loadAll() {
    return Promise.all([getJSON(RAW + 'compare.json'), getJSON(SITE + 'compare.json'), getJSON(RAW + 'prices.json'), getJSON(SITE + 'prices.json')]).then(function (a) {
      var list = [a[0], a[1]].filter(function (l) { return l && l.items && l.stores; })[0] || null;
      var prices = [a[2], a[3]].filter(function (p) { return p && p.items; }).sort(function (x, y) { return freshness(y) - freshness(x); })[0] || null;
      return { list: list, prices: prices };
    });
  }

  /* this phone's own readings, a week at most */
  function loadLive() {
    var live = load(LIVE_KEY) || {}, cut = Date.now() - LIVE_DAYS * 864e5;
    Object.keys(live).forEach(function (i) {
      Object.keys(live[i] || {}).forEach(function (s) { if (!(live[i][s] && live[i][s].at > cut)) delete live[i][s]; });
    });
    return live;
  }

  /* ---------- one product's rows ---------- */

  /* every store for one product: {job, price, unit, ...} for the list, or {job, why} for "not compared" */
  function rowsFor(item) {
    var p = state.prices, checked = p ? ms(p.checked) : 0;
    return R.jobs(state.list).filter(function (j) { return j.item.id === item.id; }).map(function (j) {
      var gh = p && p.items[item.id] ? p.items[item.id][j.store.id] : null;
      var lv = (state.live[item.id] || {})[j.store.id] || null;
      var row = { job: j, store: j.store, url: j.urls[0] || R.siteSearch(j.store, item), busy: !!state.busy[j.key], liveFail: state.liveFail[j.key] || '' };
      if (j.none) { row.why = j.none; row.none = true; return row; }
      // GitHub's reading: as of the last run, or (if it failed since) from before then
      var ghAt = gh && gh.price != null ? (gh.fail ? ms(gh.fail.since) - 1 : Math.max(checked, ms(gh.since))) : 0;
      if (lv && lv.price != null && lv.at > ghAt) {
        row.price = lv.price; row.was = lv.was; row.name = lv.name; row.url = lv.url || row.url; row.at = lv.at; row.src = 'phone';
        if (gh && gh.price != null && Math.abs(gh.price - lv.price) >= 0.005) row.moved = { from: gh.price, on: lv.at };
        if (gh && gh.moves) row.moves = gh.moves;
      } else if (gh && gh.price != null) {
        row.price = gh.price; row.was = gh.was; row.name = gh.name; row.url = gh.url || row.url; row.at = ghAt; row.src = 'github';
        row.moves = gh.moves;
        if (gh.fail) row.fail = gh.fail;
        if (gh.pending) row.pending = gh.pending;
        var last = gh.moves && gh.moves[gh.moves.length - 1];
        if (last && Math.abs(last.to - gh.price) < 0.005) row.moved = { from: last.from, on: ms(last.on) };
      } else {
        row.why = gh && gh.fail ? "Couldn't read their page (" + gh.fail.why + ')' : "Not read yet: the next check will try";
        return row;
      }
      // a price nobody has managed to read for two weeks is too old to rank
      if (row.fail && Date.now() - ms(row.fail.since) > OLD_DAYS * 864e5) {
        row.why = "Couldn't read their page since " + day(ms(row.fail.since)) + ' (last price ' + money(row.price) + ')';
        delete row.price;
        return row;
      }
      row.unit = R.unitPrice(row.price, j);
      return row;
    });
  }

  /* ---------- showing it ---------- */

  function setStatus(text, kind) {
    $('statusText').textContent = text;
    $('status').hidden = !text;
    $('status').className = 'pc-status' + (kind ? ' is-' + kind : '');
  }

  function statusLine() {
    if (state.checking && state.run) {
      var r = state.run;
      setStatus('Checking live: ' + r.done + ' of ' + r.total + (r.now ? ', ' + r.now : ''), 'busy');
      return;
    }
    var p = state.prices, gh = p ? ms(p.checked) : 0, phone = 0;
    var group = state.group;
    Object.keys(state.live).forEach(function (i) {
      var item = state.list.items.filter(function (x) { return x.id === i; })[0];
      if (!item || item.group !== group.id) return;
      Object.keys(state.live[i]).forEach(function (s) { phone = Math.max(phone, state.live[i][s].at || 0); });
    });
    if (state.lastRun && Date.now() - state.lastRun.at < 30 * 60000) {
      var lr = state.lastRun;
      setStatus('Checked live on this phone at ' + when(lr.at) + ': ' + lr.read + ' of ' + lr.total + ' read' + (lr.stopped ? ' (stopped)' : ''), 'live');
    } else if (phone > gh) setStatus('Some prices checked on this phone at ' + when(phone) + ', the rest by GitHub at ' + when(gh), 'live');
    else if (gh) setStatus('Checked by GitHub at ' + when(gh), Date.now() - gh > 36 * 3600000 ? 'old' : 'live');
    else setStatus('Not checked yet. Tap Check now to read every store.', 'old');
  }

  function render() {
    if (!state.list || !state.item) return;
    var item = state.item, rows = rowsFor(item);
    var priced = rows.filter(function (r) { return r.price != null; }).sort(function (a, b) { return a.unit - b.unit || state.list.stores.indexOf(a.store) - state.list.stores.indexOf(b.store); });
    var others = rows.filter(function (r) { return r.price == null; }).sort(function (a, b) { return (a.none ? 1 : 0) - (b.none ? 1 : 0); });
    $('view').hidden = false;
    statusLine();
    renderBest(item, priced);
    var rank = 0, last = null, min = priced.length ? priced[0].unit : 0;
    $('list').innerHTML = priced.map(function (r, i) {
      if (r.unit !== last) { rank = i + 1; last = r.unit; }
      var gap = r.price - priced[0].price, best = r.unit === min;
      var meta = item.len ? [money(r.unit) + ' a metre'] : [];
      if (r.fail && !r.pending) meta.push('<i class="is-old">couldn\'t read since ' + esc(when(ms(r.fail.since))) + '</i>');
      else if (r.src === 'phone') meta.push('checked on this phone ' + esc(when(r.at)));
      if (r.was) meta.push('<i class="is-offer">on offer, was ' + money(r.was) + '</i>');
      var note = '';
      if (r.moved && Date.now() - r.moved.on < 14 * 864e5) {
        var up = r.price > r.moved.from;
        note += '<span class="pc-moved ' + (up ? 'is-up' : 'is-down') + '">' + (up ? '▲ up ' : '▼ down ') + diff(r.price - r.moved.from) + ' ' + esc(day(r.moved.on)) + ' (was ' + money(r.moved.from) + ')</span>';
      }
      if (r.pending) {
        var pd = day(ms(r.pending.on));
        note += '<span class="pc-moved is-pending">Showed ' + money(r.pending.price) + ' ' + esc(/day$/.test(pd) ? pd : 'on ' + pd) + ', a big jump: checking it again</span>';
      }
      if (r.liveFail && !r.busy) note += '<span class="pc-moved is-pending">Not read just now: ' + esc(r.liveFail) + '</span>';
      return '<li><a class="pc-row' + (best ? ' is-best' : '') + (r.store.home ? ' is-home' : '') + (r.busy ? ' is-busy' : '') + '" href="' + esc(r.url) + '" target="_blank" rel="noopener">' +
        '<span class="pc-rank">' + rank + '</span>' +
        '<span class="pc-who"><b>' + esc(r.store.name) + '</b><span class="pc-name">' + esc(r.name || '') + '</span>' +
        (meta.length ? '<span class="pc-meta">' + meta.join(' · ') + '</span>' : '') + note + '</span>' +
        '<span class="pc-price"><b>' + money(r.price) + '</b><span>' + (best ? 'Cheapest' : '+' + diff(gap)) + '</span></span>' +
        '</a></li>';
    }).join('') || '<li class="pc-empty">No prices yet. Tap Check now to read every store.</li>';

    var box = $('noneBox');
    box.hidden = !others.length;
    $('noneSum').innerHTML = '<b>' + others.length + ' not compared</b><span>' + esc(others.map(function (r) { return r.store.name; }).join(', ')) + '</span>';
    $('none').innerHTML = others.map(function (r) {
      return '<li><a class="pc-other' + (r.busy ? ' is-busy' : '') + '" href="' + esc(r.url) + '" target="_blank" rel="noopener"><b>' + esc(r.store.name) + '</b><span>' + esc(r.why) + '</span></a></li>';
    }).join('');
  }

  function renderBest(item, priced) {
    var best = $('best');
    if (!priced.length) { best.hidden = true; return; }
    best.hidden = false;
    var min = priced[0].unit, cheapest = priced.filter(function (r) { return r.unit === min; }), dear = priced[priced.length - 1];
    var home = priced.filter(function (r) { return r.store.home; })[0];
    var homeStore = state.list.stores.filter(function (s) { return s.home; })[0];
    var homeLine = '';
    if (homeStore) {
      if (!home) homeLine = homeStore.name + "'s price couldn't be read";
      else if (home.unit === min) homeLine = cheapest.length > 1 ? homeStore.name + ' is joint cheapest' : homeStore.name + ' is the cheapest of ' + priced.length;
      else {
        var place = priced.filter(function (r) { return r.unit < home.unit; }).length + 1;
        var joint = priced.filter(function (r) { return r.unit === home.unit; }).length > 1;
        homeLine = homeStore.name + ' ' + money(home.price) + ' is ' + (joint ? 'joint ' : '') + nth(place) + ' of ' + priced.length + ', ' + diff(home.price - priced[0].price) + ' more than ' + esc(cheapest[0].store.name);
      }
    }
    best.innerHTML = '<span class="pc-best-k">Cheapest ' + esc(item.size || item.name) + (state.vat === 'ex' ? ', ex VAT' : ', inc VAT') + '</span>' +
      '<span class="pc-best-p">' + money(priced[0].price) + '</span>' +
      '<span class="pc-best-n">' + cheapest.map(function (r) { return esc(r.store.name); }).join(', ') + '</span>' +
      (dear.unit > min ? '<span class="pc-best-s">' + diff(dear.price - priced[0].price) + ' less than the dearest (' + esc(dear.store.name) + ' ' + money(dear.price) + ')</span>' : '<span class="pc-best-s">Every store is the same price</span>') +
      (homeLine ? '<span class="pc-best-h' + (home && home.unit === min ? ' is-win' : '') + '">' + homeLine + '</span>' : '');
  }

  /* ---------- picking ---------- */

  function groupItems() { return state.list.items.filter(function (i) { return i.group === state.group.id; }); }

  function subtitle() {
    var g = state.group;
    $('sub').textContent = g.name + ' at every major store, cheapest first. ' + (g.about || '') + (state.vat === 'ex' ? ' Prices without VAT.' : ' Prices include VAT.');
  }

  function pickVat(vat) {
    state.vat = vat === 'ex' ? 'ex' : 'inc';
    save('pc-vat-v1', state.vat);
    Array.prototype.forEach.call(document.querySelectorAll('.pc-vat button'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.vat === state.vat)); });
    if (state.group) subtitle();
    render();
  }

  function pickGroup(id) {
    var g = state.list.groups.filter(function (x) { return x.id === id; })[0] || state.list.groups[0];
    state.group = g;
    save('pc-group-v1', g.id);
    $('group').value = g.id;
    subtitle();
    var items = groupItems();
    $('items').innerHTML = items.map(function (i) {
      return '<button type="button" role="tab" data-item="' + esc(i.id) + '" aria-selected="false"><b>' + esc(i.short || i.name) + '</b>' + (i.sub ? '<small>' + esc(i.sub) + '</small>' : '') + '</button>';
    }).join('');
    $('items').hidden = items.length < 2;
    $('items').style.gridTemplateColumns = 'repeat(' + Math.min(items.length, 3) + ', 1fr)';
    Array.prototype.forEach.call($('items').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { pickItem(b.dataset.item); });
    });
    var remembered = load('pc-item-v1');
    pickItem(items.some(function (i) { return i.id === remembered; }) ? remembered : items[0].id);
  }

  function pickItem(id) {
    var item = groupItems().filter(function (i) { return i.id === id; })[0];
    if (!item) return;
    state.item = item;
    save('pc-item-v1', id);
    Array.prototype.forEach.call($('items').querySelectorAll('button'), function (b) { b.setAttribute('aria-selected', String(b.dataset.item === id)); });
    render();
  }

  /* ---------- Check now: every store, live, on this phone ---------- */

  var jinaNext = 0;
  function jinaSlot() {
    var t = Date.now(), at = Math.max(t, jinaNext);
    jinaNext = at + JINA_EVERY;
    return at > t ? new Promise(function (ok) { setTimeout(ok, at - t); }) : Promise.resolve();
  }
  /* one jina read -> {body} or {err}; whole: the whole page (only after a text read of it) */
  function jina(url, whole, go) {
    go = go || 0;
    return jinaSlot().then(function () {
      if (!state.checking) return { err: 'stopped' };
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 60000);
      var headers = { 'X-Cache-Tolerance': '600' };
      if (whole) headers['X-Return-Format'] = 'html';
      return fetch(JINA + url, { headers: headers, signal: ctl ? ctl.signal : undefined, cache: 'no-store', credentials: 'omit' })
        .then(function (res) {
          return res.text().then(function (body) {
            if (res.status === 429 && go < 3) {
              var wait = Number((/"retryAfter"\s*:\s*(\d+(?:\.\d+)?)/.exec(body.slice(0, 600)) || [])[1] || 5);
              jinaNext = Math.max(jinaNext, Date.now() + Math.min(wait, 60) * 1000 + 600);
              return jina(url, whole, go + 1);
            }
            if (!res.ok && !/Target URL returned error/i.test(body.slice(0, 2000))) return { err: res.status === 429 ? 'too many checks at once' : plainWhy(body, "jina couldn't open the page (HTTP " + res.status + ')') };
            return { body: body };
          });
        }, function (e) {
          if (go < 1 && state.checking) return jina(url, whole, go + 1);
          return { err: e && e.name === 'AbortError' ? 'no answer in a minute' : 'no connection' };
        })
        .finally(function () { clearTimeout(timer); });
    });
  }

  /* jina's error answers in plain words ({"readableMessage": "... net::ERR_CERT_DATE_INVALID ..."}), as the GitHub check says them */
  function plainWhy(text, fallback) {
    var msg = String(text || '');
    try { var j = JSON.parse(msg); msg = String(j.readableMessage || j.message || j.name || msg); } catch (e) { /* not JSON */ }
    if (/ERR_CERT|certificate/i.test(msg)) return "their website's security certificate has run out";
    if (/ERR_NAME_NOT_RESOLVED/i.test(msg)) return "their website's address doesn't work";
    if (/ERR_CONNECTION/i.test(msg)) return "their website didn't answer";
    if (/timeout|timed out/i.test(msg)) return 'their page took too long to open';
    return fallback;
  }

  function readLive(job, shown) {
    // a store selling two brands of the same thing (cheapest: true): read each and keep the lowest
    if (job.entry.cheapest && job.urls.length > 1) {
      var reads = [];
      return job.urls.reduce(function (p, url) {
        return p.then(function () {
          var one = {}; for (var k in job) one[k] = job[k];
          one.urls = [url];
          return readUrls(one, shown).then(function (r) { reads.push(r); });
        });
      }, Promise.resolve()).then(function () { return state.checking ? R.cheapest(reads) : { ok: false, why: 'stopped' }; });
    }
    return readUrls(job, shown);
  }
  function readUrls(job, shown) {
    var urls = job.urls.slice(), lastWhy = '';
    function next() {
      if (!urls.length || !state.checking) return Promise.resolve({ ok: false, why: state.checking ? lastWhy || 'no answer' : 'stopped' });
      var url = urls.shift();
      return jina(url, false).then(function (t) {
        var r = t.err ? { ok: false, why: t.err } : R.text(t.body, job);
        if (r.ok) return confirmBig(job, r, url, shown);
        lastWhy = r.why;
        if (r.gone || t.err || /bot check/.test(r.why)) return next();
        return jina(url, true).then(function (h) {
          var r2 = h.err ? { ok: false, why: h.err } : R.html(h.body, job);
          if (r2.ok) { r2.url = url; return r2; }
          lastWhy = r.why;
          return next();
        });
      });
    }
    return next();
  }
  /* a price far from the one showing is only believed when the page's product data agrees */
  function confirmBig(job, r, url, shown) {
    r.url = url;
    if (shown == null || Math.abs(r.price - shown) / shown <= BIG || r.how !== 'text') return Promise.resolve(r);
    return jina(url, true).then(function (h) {
      if (R.agrees(h.err ? null : R.html(h.body, job), r.price)) return r;
      return { ok: false, why: 'showed ' + money(r.price) + " but that couldn't be confirmed" };
    });
  }

  var wakeLock = null;
  function keepAwake() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }, function () { wakeLock = null; });
  }
  function letSleep() { if (wakeLock) { try { wakeLock.release(); } catch (e) { /* gone */ } } wakeLock = null; }

  function checkNow() {
    if (state.checking) { state.checking = false; return; }          // the button is Stop while it runs
    var group = state.group.id;
    var jobs = R.jobs(state.list, group).filter(function (j) { return j.urls.length && !j.none; });
    // a store's two pages apart: every store for the first product, then every store for the next
    jobs.sort(function (a, b) { return state.list.items.indexOf(a.item) - state.list.items.indexOf(b.item); });
    if (!jobs.length) return;
    state.checking = true;
    state.liveFail = {};
    var run = state.run = { total: jobs.length, done: 0, read: 0, now: '', started: Date.now() };
    $('again').classList.add('is-stop');
    $('againText').textContent = 'Stop';
    $('bar').hidden = false;
    $('barFill').style.width = '0%';
    keepAwake();
    render();
    var queue = jobs.slice();
    function worker() {
      if (!state.checking || !queue.length) return Promise.resolve();
      var job = queue.shift();
      state.busy[job.key] = true;
      run.now = job.store.name + ' ' + (job.item.short || '');
      var shownRow = rowsFor(job.item).filter(function (r) { return r.job.key === job.key; })[0];
      render();
      return readLive(job, shownRow && shownRow.price).then(function (r) {
        delete state.busy[job.key];
        if (r.why === 'stopped') return;
        run.done++;
        if (r.ok) {
          run.read++;
          (state.live[job.item.id] = state.live[job.item.id] || {})[job.store.id] = { price: r.price, was: r.was || null, name: r.name, url: r.url, at: Date.now(), how: r.how };
          save(LIVE_KEY, state.live);
        } else state.liveFail[job.key] = r.why;
        $('barFill').style.width = Math.round(run.done / run.total * 100) + '%';
        $('againText').textContent = 'Stop (' + run.done + ' of ' + run.total + ' checked)';
        render();
        return worker();
      });
    }
    var workers = [];
    for (var w = 0; w < WORKERS; w++) workers.push(new Promise(function (ok) { setTimeout(ok, workers.length * 1500); }).then(worker));
    Promise.all(workers).then(function () {
      var stopped = !state.checking;
      state.checking = false;
      state.busy = {};
      state.lastRun = { at: Date.now(), read: run.read, total: run.total, stopped: stopped && run.done < run.total };
      letSleep();
      $('again').classList.remove('is-stop');
      $('againText').textContent = 'Check now on this phone';
      $('bar').hidden = true;
      render();
    });
  }

  /* ---------- start ---------- */

  function start() {
    setStatus('Loading prices', 'busy');
    loadAll().then(function (d) {
      if (!d.list) {
        setStatus('', '');
        $('error').hidden = false;
        $('error').textContent = "Couldn't load the store list. Check your connection and reload the page.";
        return;
      }
      state.list = d.list;
      state.prices = d.prices;
      state.live = loadLive();
      var groups = state.list.groups || [];
      $('group').innerHTML = groups.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>'; }).join('');
      $('groupBox').hidden = groups.length < 2;
      $('again').disabled = false;
      pickGroup(load('pc-group-v1'));
    });
  }

  $('group').addEventListener('change', function () { pickGroup(this.value); });
  Array.prototype.forEach.call(document.querySelectorAll('.pc-vat button'), function (b) {
    b.addEventListener('click', function () { pickVat(b.dataset.vat); });
  });
  pickVat(load('pc-vat-v1'));
  $('again').addEventListener('click', checkNow);
  // back on the page after a while: pick up a newer GitHub check
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (state.checking) keepAwake();
    else if (hiddenAt && Date.now() - hiddenAt > 15 * 60000 && state.list) {
      loadAll().then(function (d) { if (d.prices && freshness(d.prices) > freshness(state.prices)) { state.prices = d.prices; render(); } });
    }
  });
  start();
})();
