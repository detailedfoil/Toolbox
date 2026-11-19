/* Warehouse Shift: the till screen. A browser with two tabs, like the trade counter PCs in detailedfoil's photos:
   Fusion (the till system: Identify Customer, Search Results, Customer Order, Checkout, Order Complete) and CrashFix
   (the Product Search page's own search over the same product list, names and description words). Find the product
   on CrashFix, switch to Fusion, type its part number and quantity; the customer says if it's right.

   Copied from the photos: the layout, the blue nav buttons, the red Search and Select bars, the basket columns, the
   checkout's totals and payment buttons. Not copied: the logo artwork (plain text instead), the real username, the
   till's web address and anyone's details (the customers are made up in till.js).

   game.js makes one with create({...}) and tells it when a till customer arrives (serve) and leaves; this file runs
   the conversation and calls back when the order is paid for (onComplete), so the pick list can go to the scanner.
   Phones get an on-screen keyboard, so the phone's own keyboard never squashes the game. */
(function () {
  'use strict';

  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- icons ---------- */
  const IC = {
    who: '<svg viewBox="0 0 48 48"><circle cx="24" cy="15" r="9.5"/><path d="M7 45c1.2-10.5 7.6-16.5 17-16.5S39.8 34.5 41 45"/><path d="M19 30l5 7 5-7"/></svg>',
    order: '<svg viewBox="0 0 48 48"><path d="M10 4h19l9 9v14"/><path d="M10 4v40h22"/><path d="M29 4v9h9"/><path d="M16 17h14M16 23h14M16 29h10"/><path d="M30 33h12M37 27l6 6-6 6"/></svg>',
    pay: '<svg viewBox="0 0 48 48"><path d="M33 11c-2-4-5-6-9-6-6 0-10 4-10 10 0 4 2 7 2 11 0 6-3 10-6 12h29"/><path d="M10 27h18"/></svg>',
    hist: '<svg viewBox="0 0 48 48"><path d="M8 4h17l8 8v8"/><path d="M8 4v38h14"/><path d="M25 4v8h8"/><path d="M13 16h12M13 22h10M13 28h7"/><circle cx="33" cy="34" r="10"/><path d="M33 28v7h5"/></svg>',
    kiosk: '<svg viewBox="0 0 48 48"><rect x="9" y="4" width="30" height="22" rx="2"/><path d="M24 26v14M16 44h16"/><path d="M27 15c0-2 3-2 3 0v5c0-2 3-2 3 0v2c0-2 3-2 3 0v4c0 4-2 7-5 8h-4c-2-1-4-3-5-6l-2-4c-1-2 1-3 2-2l2 2v-9c0-2 3-2 3 0z"/></svg>',
    mgr: '<svg viewBox="0 0 48 48"><rect x="21" y="5" width="22" height="28" rx="2"/><path d="M26 13h12M26 19h12M26 25h8"/><circle cx="15" cy="23" r="6.5"/><path d="M3 44c.8-7 5.4-11 12-11s11.2 4 12 11"/></svg>',
    card: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20" stroke-width="3"/></svg>',
    trade: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="18" height="13" rx="2"/><circle cx="13" cy="12.5" r="3"/><path d="M20 9h2v8h-2"/></svg>',
    credit: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 9h20M8 15l2 2 4-4"/></svg>',
    bank: '<svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5zM5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
    piggy: '<svg viewBox="0 0 24 24"><path d="M4 11c0-4 4-6 8-6 3 0 5 1 6 2l3-1-1 3c1 1 1 2 1 3h1v3h-2c-1 2-2 3-4 3v2h-3v-2H9v2H6v-3c-1-1-2-3-2-6z"/><circle cx="16" cy="10" r=".8"/></svg>'
  };

  /* ---------- the page ---------- */
  const NAV = [['who', 'Who', IC.who], ['order', 'Order', IC.order], ['pay', 'Pay &amp; Go', IC.pay], ['hist', 'Order History', IC.hist], ['kiosk', 'Kiosk Orders', IC.kiosk], ['', '', ''], ['mgr', 'Manager', IC.mgr]];
  const HTML = `
<div class="tl-mon">
  <div class="tl-chrome">
    <div class="tl-tabs" role="tablist">
      <button class="tl-tab on" type="button" role="tab" data-tab="fusion" aria-selected="true"><i class="tl-fav">${IC.globe}</i><span>TradeCounter Application</span><b aria-hidden="true">&times;</b></button>
      <button class="tl-tab" type="button" role="tab" data-tab="crashfix" aria-selected="false"><i class="tl-fav cf-fav">C</i><span>CrashFix | Product Search</span><b aria-hidden="true">&times;</b></button>
      <span class="tl-plus" aria-hidden="true">+</span>
    </div>
    <button class="tl-leave" type="button" data-act="leave" title="Step away from the till (Esc)">Leave till <b>&times;</b></button>
  </div>
  <div class="tl-addr"><span class="tl-warn">&#9888; Not secure</span><span class="tl-url" data-v="url">tradecounter/app/home.jsp</span></div>
  <div class="tl-say" data-v="say" aria-live="polite">
    <span class="tl-face" data-v="face"></span>
    <div class="tl-lines" data-v="lines"></div>
    <button class="tl-ask" type="button" data-act="ask">Ask again</button>
  </div>
  <div class="tl-page">
    <div class="fu" data-pane="fusion">
      <div class="fu-app" data-v="app">
        <header class="fu-head">
          <div class="fu-logo">FUSION</div>
          <div class="fu-cust" data-v="cust"></div>
          <div class="fu-pills"><button class="fu-pill" type="button" data-act="cancel">Cancel</button><button class="fu-pill back" type="button" data-act="back">Back</button></div>
          <div class="fu-user"><b>Trainee01</b> <span class="fu-logout">Logout</span><br>Till:2 TC:Dunstable TC<br><b>PDQ Status:</b></div>
        </header>
        <nav class="fu-nav">${NAV.map((n) => n[0] ? `<button class="fu-nb" type="button" data-go="${n[0]}">${n[2]}<span>${n[1]}</span></button>` : '<span class="fu-nb blank"></span>').join('')}</nav>
        <main class="fu-main">
          <section class="fu-scr" data-scr="who">
            <div class="fu-tt">Identify Customer</div>
            <div class="fu-box">
              <div class="fu-bar"><span>Please enter the relevant customer details:</span><button class="fu-blue" type="button" data-act="saysno">Customer Says No</button></div>
              <div class="fu-form">
                <label class="fu-f f-no strong"><span>Customer No:</span><input data-f="no" maxlength="10" autocomplete="off"></label>
                <label class="fu-f f-sur"><span>Surname:</span><input data-f="surname" maxlength="30" autocomplete="off"></label>
                <label class="fu-f f-first"><span>First Name:</span><input data-f="first" maxlength="30" autocomplete="off"></label>
                <label class="fu-f f-pc"><span>Full Postcode:</span><input data-f="postcode" maxlength="9" autocomplete="off"></label>
                <label class="fu-f f-mail"><span>Email Address:</span><input data-f="email" maxlength="60" autocomplete="off"></label>
                <label class="fu-f f-ref"><span>Order Ref:</span><input data-f="ref" maxlength="20" autocomplete="off"></label>
                <label class="fu-f f-org"><span>Organisation:</span><input data-f="org" maxlength="40" autocomplete="off"></label>
              </div>
              <button class="fu-search" type="button" data-act="search" disabled>Search</button>
            </div>
          </section>
          <section class="fu-scr" data-scr="res" hidden>
            <div class="fu-tt">Identify Customer</div>
            <div class="fu-box">
              <div class="fu-bar"><span>Search Results:</span></div>
              <div class="fu-tw"><table class="fu-tab"><thead><tr><th>Title</th><th>Surname</th><th>First Name</th><th>Organisation</th><th>Postcode</th><th>Address</th><th>Email Address</th></tr></thead><tbody data-v="rows"></tbody></table></div>
              <div class="fu-btns"><button class="fu-blue big" type="button" data-act="refine">Refine</button><button class="fu-red big" type="button" data-act="select">Select</button><button class="fu-green big" type="button" data-act="create">Create</button></div>
            </div>
          </section>
          <section class="fu-scr" data-scr="order" hidden>
            <div class="fu-ttrow"><div class="fu-tt">Customer Order</div><button class="fu-quote" type="button" data-act="quote">This is a quote</button></div>
            <div class="fu-box dark">
              <div class="fu-stores"><label><i class="fu-radio on"></i>Current Store</label><label><i class="fu-radio"></i>Alternative Store</label><b>Trade Counter</b><span class="fu-branch">Select Branch</span></div>
              <div class="fu-tw white"><table class="fu-basket"><thead><tr><th>Part No.</th><th>Qty</th><th>Avail</th><th class="d">Description</th><th>Delivery &gt;</th><th>Pack Size</th><th>Pack (&pound;)</th><th>Total</th><th><i class="fu-x">&times;</i></th></tr></thead>
                <tbody data-v="basket"><tr class="fu-entry"><td><input data-f="part" maxlength="7" autocomplete="off"></td><td><input data-f="qty" maxlength="3" autocomplete="off"></td><td></td><td class="d"><span class="fu-tip" data-v="tip">Type the part number, then the quantity, then Enter</span></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table></div>
              <div class="fu-tot"><b>Total Item: (<span data-v="count">0</span>)</b><b class="red">Total: <span data-v="total">&pound;0.00</span></b></div>
            </div>
          </section>
          <div class="fu-msg" data-v="msg" role="status" hidden></div>
        </main>
      </div>
      <section class="fx" data-scr="pay" hidden>
        <div class="fx-top"><span data-v="payname"></span><b>Checkout</b><span class="fx-credit">${IC.piggy}Credit available: &pound;0.00</span></div>
        <h1>Confirm the amount to pay and click a method</h1>
        <div class="fx-grid">
          <dl class="fx-sum"><dt>Items total (ex. VAT):</dt><dd data-v="ex"></dd><dt>VAT:</dt><dd data-v="vat"></dd><dt><b>Total (inc VAT):</b></dt><dd><b data-v="inc"></b></dd></dl>
          <div class="fx-amt"><span>Amount</span><div class="fx-box">&pound;<mark data-v="amount"></mark></div></div>
          <div class="fx-meth"><span>By payment method</span>
            <button type="button" data-act="card">${IC.card}Card</button><button type="button" data-act="cash"><b>&pound;</b>Cash</button><button type="button" data-act="trade">${IC.trade}Trade Credit</button>
            <button type="button" class="off" data-act="nocredit">${IC.credit}Customer Credit</button><button type="button" class="off" data-act="nocredit">${IC.bank}Pay-on-account</button></div>
        </div>
        <button class="fx-back" type="button" data-act="payback">Back</button>
        <div class="fx-foot"><span>&#9432; Get help code | Add a promo/discount code | Pay with gift card | Manual override</span><span>Powered by Fusion</span></div>
        <div class="fx-modal" data-v="modal" hidden><div class="fx-pdq" data-v="pdq"></div></div>
      </section>
      <section class="fx fx-done" data-scr="done" hidden>
        <h1>Order Complete</h1>
        <p class="fx-no">Order number: <u data-v="orderno"></u></p>
        <p class="fx-next">The pick list is on your scanner. Pick it, then hand the tote over at the counter.</p>
        <button class="fx-go" type="button" data-act="leave">Back to the warehouse</button>
      </section>
    </div>
    <div class="cf" data-pane="crashfix" hidden>
      <header class="cf-head"><span class="cf-logo"><span class="cf-crash">CRASH</span><span class="cf-fix">FIX</span></span><span class="cf-title">Product Search</span></header>
      <form class="cf-form" data-v="form" role="search" autocomplete="off"><input class="cf-q" data-f="q" type="search" enterkeyhint="search" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Getting the product list ready..." aria-label="Search by product code or name"><button class="cf-go" type="submit" aria-label="Search"><svg viewBox="0 0 24 24" width="22" height="22"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.8"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button></form>
      <div class="cf-scroll" data-v="cfscroll">
        <p class="cf-status" data-v="status">Loading the product list...</p>
        <p class="cf-note" data-v="note" hidden></p>
        <ol class="cf-results" data-v="results"></ol>
        <button class="cf-more" type="button" data-act="more" hidden>Show more results</button>
      </div>
    </div>
  </div>
  <div class="tl-kb" data-v="kb" hidden>
    <div class="tl-kb-bar"><button type="button" class="tl-paste" data-k="paste" hidden></button><span class="tl-kb-field" data-v="kbfield"></span><button type="button" data-k="hide">Hide keyboard &#8964;</button></div>
    <div class="tl-kb-keys">${['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'].map((row, i) => row.split('').map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('') +
      (i === 0 ? '<button type="button" class="w" data-k="back" aria-label="Delete">&#9003;</button>' : i === 1 ? '<button type="button" class="w go" data-k="enter" aria-label="Enter">Enter</button>' : i === 2 ? '<button type="button" data-k="@">@</button><button type="button" data-k=".">.</button>' : '<button type="button" data-k="-">-</button><button type="button" class="sp" data-k=" ">space</button>')).map((r) => `<div class="tl-kb-row">${r}</div>`).join('')}</div>
  </div>
  <div class="tl-toast" data-v="toast" role="status"></div>
</div>`;

  function create(o) {
    const el = o.el, Till = o.Till, world = o.world, touch = !!o.touch, sfx = o.sfx || (() => {});
    el.innerHTML = HTML;
    const q = (s) => el.querySelector(s), qa = (s) => Array.from(el.querySelectorAll(s));
    const V = {};
    qa('[data-v]').forEach((n) => { V[n.dataset.v] = n; });
    const F = {};
    qa('[data-f]').forEach((n) => { F[n.dataset.f] = n; if (touch) n.setAttribute('inputmode', 'none'); });
    const scr = {};
    qa('[data-scr]').forEach((n) => { scr[n.dataset.scr] = n; });

    const S = { open: false, tab: 'fusion', screen: 'who', results: [], sel: -1, clip: '', focus: null, session: null, timers: [] };
    const later = (ms, fn) => { const t = setTimeout(() => { S.timers = S.timers.filter((x) => x !== t); fn(); }, ms); S.timers.push(t); return t; };
    const stopTimers = () => { S.timers.forEach(clearTimeout); S.timers = []; };

    /* ---------- products: the catalogue now, the whole CrashFix list when it's loaded ---------- */
    const stocked = new Map(world.items.map((it) => [it.code, it]));
    const P = { items: null, by: new Map(), searcher: null, loading: null, failed: false };
    function loadProducts() {
      if (P.loading) return P.loading;
      const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
      P.loading = Promise.all([get('product-search/data/products.json'), get('product-search/data/web-names.json').catch(() => null), get('product-search/data/desc-words.json').catch(() => null)])
        .then(([list, web, dw]) => {
          P.items = Till.searchItems(list, web, dw);
          P.items.forEach((it) => P.by.set(it.sku, it));
          P.searcher = window.ProductSearch.build(P.items);
          F.q.placeholder = 'Search by code or name';
          V.status.textContent = P.items.length.toLocaleString('en-GB') + ' products ready';
          if (F.q.value.trim()) runSearch();
        })
        .catch((e) => { console.error(e); P.failed = true; P.loading = null; V.status.textContent = "Couldn't load the product list. Check your signal; it tries again when you come back to the till."; });
      return P.loading;
    }
    function product(code) { // what Fusion knows about a part number
      const it = stocked.get(code), ps = P.by.get(code);
      if (!it && !ps) return null;
      const base = it || { code, name: ps.name, size: 'S', group: '' };
      return { code, name: (ps && ps.name) || it.name, item: it || null, price: Till.price(base), avail: it ? Till.avail(it) : 0 };
    }

    /* ---------- the customer talking ---------- */
    const log = [];
    function say(line) { // line: {text, quote?, hint?, qty?, kind?}
      if (typeof line === 'string') line = { text: line };
      line.at = Date.now();
      log.push(line);
      if (log.length > 30) log.shift();
      renderSay();
      if (o.onSpeech) o.onSpeech(line);
      if (S.open) sfx('talk');
    }
    function lineHtml(l) {
      return esc(l.text) + (l.quote ? ' <q>' + esc(l.quote) + '</q>' : '') + (l.hint ? ' ' + esc(l.hint) : '') + (l.qty ? ' <b>' + esc(l.qty) + '</b>' : '');
    }
    function renderSay() {
      const s = S.session;
      if (!s) {
        V.lines.innerHTML = '<p class="tl-now dim">' + esc(o.idleText ? o.idleText() : 'No customer is waiting to order at the till.') + '</p>';
        el.querySelector('[data-act="ask"]').hidden = true;
        V.face.style.background = '#8b97aa';
        return;
      }
      V.face.style.background = s.colour || '#f07a1a';
      const mine = log.filter((l) => l.at >= s.since);
      const now = mine[mine.length - 1], before = mine[mine.length - 2];
      V.lines.innerHTML = (before ? '<p class="tl-old">' + lineHtml(before) + '</p>' : '') + (now ? '<p class="tl-now">' + lineHtml(now) + '</p>' : '');
      el.querySelector('[data-act="ask"]').hidden = !(s.stage === 'details' || s.stage === 'ordering');
    }
    function askAgain() {
      const s = S.session;
      if (!s) return;
      sfx('key');
      if (s.stage === 'details') { say({ text: "Postcode's " + s.cust.postcode + ", surname " + s.cust.surname + '.' + (s.cust.twin ? ' First name ' + s.cust.first + '.' : '') }); return; }
      if (s.stage !== 'ordering') return;
      const ln = s.lines[s.cur];
      if (!ln) return;
      ln.asked = (ln.asked || 0) + 1;
      if (ln.asked >= 2 && !ln.clued) { ln.clued = true; s.slips++; if (o.onSlip) o.onSlip(); say({ text: ln.clue }); return; }
      sayRequest(true);
    }
    function sayRequest(again) {
      const s = S.session, ln = s && s.lines[s.cur];
      if (!ln) return;
      const lead = again ? (ln.kind === 'need' ? 'Like I said, it says:' : 'Like I said: ') : (ln.next ? ln.next + ' ' : '');
      if (ln.kind === 'need') say({ text: again ? lead : (lead + ln.say).trim(), quote: ln.quote, hint: ln.hint, qty: ln.qtySay, kind: 'need' });
      else say({ text: again ? lead + ln.say : (lead + ln.say).trim(), qty: ln.qtySay });
    }

    /* ---------- tabs ---------- */
    function setTab(t) {
      if (S.tab === t) return;
      S.tab = t; sfx('key');
      qa('.tl-tab').forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      qa('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== t; });
      V.url.textContent = t === 'fusion' ? (S.screen === 'pay' || S.screen === 'done' ? 'tradecounter/fx/checkout' : 'tradecounter/app/home.jsp') : 'crashfix.example/product-search' + (F.q.value.trim() ? '#q=' + encodeURIComponent(F.q.value.trim()) : '');
      hideKb();
      if (t === 'crashfix') { if (!P.searcher) loadProducts(); if (!touch) F.q.focus({ preventScroll: true }); }
      else focusDefault();
    }

    /* ---------- Fusion: screens ---------- */
    function show(name) {
      S.screen = name;
      ['who', 'res', 'order'].forEach((k) => { scr[k].hidden = k !== name; });
      V.app.hidden = name === 'pay' || name === 'done';
      scr.pay.hidden = name !== 'pay'; scr.done.hidden = name !== 'done';
      qa('.fu-nb').forEach((b) => b.classList.toggle('on', b.dataset.go === (name === 'res' ? 'who' : name)));
      if (S.tab === 'fusion') V.url.textContent = name === 'pay' || name === 'done' ? 'tradecounter/fx/checkout' : 'tradecounter/app/home.jsp';
      renderCust();
      hideKb();
      if (S.tab === 'fusion') focusDefault();
    }
    function focusDefault() {
      if (touch || !S.open) return;
      const f = S.screen === 'who' ? (F.postcode.value ? (F.surname.value ? null : F.surname) : F.postcode) : S.screen === 'order' ? F.part : null;
      if (f) setTimeout(() => f.focus({ preventScroll: true }), 0);
    }
    function renderCust() {
      const s = S.session, c = s && s.selected ? s.cust : null;
      V.cust.innerHTML = c ? '<b>' + esc(c.first + ' ' + c.surname) + '</b> <small>(' + esc((c.org || 'Private').toUpperCase()) + ')</small><br><span>' + esc(c.trade) + '</span>' : '';
    }
    let msgT = 0;
    function fuMsg(text, good) { V.msg.textContent = text; V.msg.className = 'fu-msg' + (good ? ' good' : ''); V.msg.hidden = false; clearTimeout(msgT); msgT = setTimeout(() => { V.msg.hidden = true; }, 2600); }
    let toastT = 0;
    function toast(text) { V.toast.textContent = text; V.toast.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => V.toast.classList.remove('show'), 1500); }

    // Identify Customer
    const WHO = ['no', 'surname', 'first', 'postcode', 'email', 'ref', 'org'];
    function whoFilled() { return WHO.some((k) => F[k].value.trim()); }
    function updateSearchBtn() { q('[data-act="search"]').disabled = !whoFilled(); }
    function clearWho() { WHO.forEach((k) => { F[k].value = ''; }); updateSearchBtn(); }
    function search() {
      if (!whoFilled()) return;
      sfx('key');
      const query = {}; WHO.forEach((k) => { query[k] = F[k].value; });
      const s = S.session;
      S.results = Till.lookup(s ? s.cust : null, query);
      S.sel = S.results.length === 1 ? 0 : -1;
      renderResults();
      show('res');
      if (s && s.stage === 'details') {
        const me = S.results.indexOf(s.cust);
        if (me >= 0 && S.results.length > 1 && !s.saidFirst && S.results.some((r, i) => i !== me && r.surname === s.cust.surname && r.postcode === s.cust.postcode)) {
          s.saidFirst = true; later(700, () => say("That's me, " + s.cust.first + '.'));
        } else if (me < 0 && S.results.length && !s.saidNotMe) { s.saidNotMe = true; later(700, () => say("I'm not on there.")); }
      }
    }
    function renderResults() {
      if (!S.results.length) { V.rows.innerHTML = '<tr class="none"><td colspan="7">No customers found. Press Refine to change the search.</td></tr>'; return; }
      V.rows.innerHTML = S.results.map((c, i) => '<tr data-i="' + i + '"' + (i === S.sel ? ' class="sel"' : '') + '><td>' + esc(c.title) + '</td><td>' + esc(c.surname) + '</td><td>' + esc(c.first) + '</td><td>' + esc(c.org) +
        '</td><td>' + esc(c.postcode) + '</td><td>' + esc(c.address) + '</td><td>' + esc(c.email) + '</td></tr>').join('');
    }
    function select() {
      const s = S.session, c = S.results[S.sel];
      sfx('key');
      if (!c) { fuMsg(S.results.length ? 'Pick a customer from the list first.' : 'No customer to select.'); return; }
      if (!s || !s.cust) { fuMsg('That customer has nothing to order.'); return; }
      if (c !== s.cust) { s.slips++; if (o.onSlip) o.onSlip(); say("That's not me, mate. I'm " + s.cust.first + ' ' + s.cust.surname + '.'); sfx('bad'); return; }
      s.selected = true;
      show('order');
      if (s.stage === 'details') { s.stage = 'ordering'; later(650, () => sayRequest(false)); }
    }

    // Customer Order: the basket
    function basketTotal() { return S.session ? S.session.basket.reduce((t, r) => t + r.price * r.qty, 0) : 0; }
    function renderBasket() {
      const s = S.session, rows = s ? s.basket : [];
      qa('tr.fu-line').forEach((tr) => tr.remove());
      const body = V.basket;
      rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        tr.className = 'fu-line ' + r.status;
        tr.dataset.i = i;
        tr.innerHTML = '<td>' + esc(r.code) + '</td><td><input class="fu-q" data-row="' + i + '" value="' + r.qty + '" maxlength="3" autocomplete="off"' + (touch ? ' inputmode="none"' : '') + '></td><td class="' + (r.avail ? '' : 'out') + '">' + r.avail +
          '</td><td class="d">' + esc(r.name) + '</td><td>Collect</td><td>1</td><td>' + (r.price / 100).toFixed(2) + '</td><td>' + (r.price * r.qty / 100).toFixed(2) + '</td><td><button type="button" class="fu-del" data-del="' + i + '" aria-label="Remove line">&times;</button></td>';
        body.appendChild(tr);
      });
      V.count.textContent = String(rows.length);
      V.total.textContent = Till.money(basketTotal());
    }
    function addLine() {
      const s = S.session;
      const code = F.part.value.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0');
      const qtyText = F.qty.value.trim();
      if (!code) { fuMsg('Type a part number first.'); sfx('bad'); return; }
      const qty = qtyText ? parseInt(qtyText, 10) : 1;
      if (!(qty > 0)) { fuMsg('The quantity has to be a number.'); sfx('bad'); return; }
      const p = product(code);
      if (!p) { fuMsg('Part number ' + code + ' not found.' + (P.searcher ? '' : ' (Still loading the full list.)')); sfx('bad'); return; }
      if (!s || !s.selected) { fuMsg('Identify the customer first.'); sfx('bad'); return; }
      F.part.value = ''; F.qty.value = '';
      const row = { code, name: p.name, qty, price: p.price, avail: p.avail, item: p.item, status: 'pending', line: -1 };
      s.basket.push(row);
      sfx('beep');
      renderBasket();
      focusDefault();
      later(450, () => judgeRow(row));
    }
    function judgeRow(row) {
      const s = S.session;
      if (!s || s.basket.indexOf(row) < 0) return;
      if (s.stage !== 'ordering') {
        row.status = 'wrong'; renderBasket(); say("I don't need that, mate."); later(1300, () => removeRow(row)); return;
      }
      const dup = s.basket.find((r) => r !== row && r.code === row.code && r.status === 'ok');
      if (dup) { row.status = 'wrong'; renderBasket(); say("I've already got that one."); sfx('bad'); later(1300, () => removeRow(row)); return; }
      const ln = s.lines[s.cur];
      const verdict = Till.judge(ln, row.code, row.qty);
      if (verdict === 'wrong') {
        row.status = 'wrong'; s.slips++; if (o.onSlip) o.onSlip();
        renderBasket(); sfx('bad');
        say(pick(["No, that's not it.", 'Not that one, mate.', "No, that's not what I'm after.", "Nope, that's not it.", "That's not the one."]));
        later(1400, () => removeRow(row));
        return;
      }
      row.line = s.cur;
      if (verdict === 'qty') {
        row.status = 'qty'; renderBasket(); sfx('bad');
        say("That's the one, but I need " + ln.qty + '.');
        return;
      }
      lineDone(row);
    }
    function lineDone(row) {
      const s = S.session, ln = s.lines[row.line];
      row.status = 'ok'; ln.done = true;
      renderBasket(); sfx('good');
      say(pick(["Yes, that's the one!", "Spot on, that's it.", "That's it, cheers.", 'Perfect, that one.', 'Yep, that\'s the one.']));
      const next = s.lines.findIndex((l) => !l.done);
      if (next < 0) { s.cur = s.lines.length; s.ready = true; later(1100, () => say(pick(["That's everything. I'll pay now.", "That's the lot, cheers. Card's ready.", "That's all I need. How much is that?"]))); }
      else { s.cur = next; later(1300, () => sayRequest(false)); }
    }
    function removeRow(row) {
      const s = S.session;
      if (!s) return;
      const i = s.basket.indexOf(row);
      if (i < 0) return;
      s.basket.splice(i, 1);
      if (row.status === 'ok' && row.line >= 0) { // they still need that one
        const ln = s.lines[row.line]; ln.done = false; s.ready = false;
        s.cur = s.lines.findIndex((l) => !l.done);
        say('Hang on, I still need that one.');
      }
      renderBasket();
    }
    function rowQty(i, val) {
      const s = S.session, row = s && s.basket[i];
      if (!row) return;
      const n = parseInt(val, 10);
      if (!(n > 0) || n === row.qty) { renderBasket(); return; }
      row.qty = n; sfx('key');
      if (row.status === 'qty' || row.status === 'ok') {
        const ln = s.lines[row.line];
        if (Till.judge(ln, row.code, n) === 'right') { if (row.status === 'qty') lineDone(row); else renderBasket(); }
        else { row.status = 'qty'; ln.done = false; s.ready = false; s.cur = s.lines.findIndex((l) => !l.done); renderBasket(); say("No, I need " + ln.qty + '.'); }
      } else renderBasket();
    }

    // Checkout
    function goPay() {
      const s = S.session;
      sfx('key');
      if (!s || !s.selected) { fuMsg('Identify the customer first.'); return; }
      if (!s.basket.length) { fuMsg('There is nothing in the basket.'); return; }
      if (s.basket.some((r) => r.status === 'pending')) return;
      if (!s.ready) { say(pick(["Hang on, I've not finished yet.", "Wait, there's more."])); return; }
      const t = Till.vat(basketTotal());
      V.payname.textContent = s.cust.first + ' ' + s.cust.surname + ' (' + (s.cust.org || 'Private') + ')';
      V.ex.textContent = Till.money(t.ex); V.vat.textContent = Till.money(t.vat); V.inc.textContent = Till.money(t.inc);
      V.amount.textContent = (t.inc / 100).toFixed(2);
      V.modal.hidden = true;
      s.stage = 'paying';
      show('pay');
      renderSay();
    }
    function pdq(html) { V.pdq.innerHTML = html; V.modal.hidden = false; }
    function payCard() {
      const s = S.session; if (!s || s.stage !== 'paying' || !V.modal.hidden) return;
      sfx('key');
      const amt = Till.money(basketTotal());
      pdq('<h2>Card machine</h2><div class="fx-screen"><b>' + esc(amt) + '</b><span>Insert, tap or swipe card</span></div><p class="fx-wait">Waiting for the customer<i>.</i><i>.</i><i>.</i></p>');
      later(500, () => say(pick(['Tapping now.', "There's my card.", 'Contactless OK?'])));
      later(1900, () => { sfx('approved'); pdq('<h2>Card machine</h2><div class="fx-screen ok"><b>APPROVED</b><span>' + esc(amt) + '</span></div><p class="fx-wait">Remove card</p>'); });
      later(3000, () => complete('card'));
    }
    function payCash() {
      const s = S.session; if (!s || s.stage !== 'paying' || !V.modal.hidden) return;
      sfx('key');
      const inc = basketTotal(), given = Till.tender(inc);
      say(pick(['Here you go.', 'Cash OK?', "There's " + Till.money(given) + '.']));
      pdq('<h2>Cash</h2><dl class="fx-cash"><dt>To pay</dt><dd>' + Till.money(inc) + '</dd><dt>Customer gives you</dt><dd>' + Till.money(given) + '</dd><dt><b>Change due</b></dt><dd><b>' + Till.money(given - inc) + '</b></dd></dl><button type="button" class="fx-go" data-act="change">' + (given > inc ? 'Change given' : 'Done') + '</button>');
      sfx('drawer');
    }
    function complete(how) {
      const s = S.session; if (!s || s.stage !== 'paying') return;
      s.stage = 'done';
      s.orderNo = Till.orderNumber(Math.random);
      V.orderno.textContent = s.orderNo;
      V.modal.hidden = true;
      show('done');
      sfx('done');
      renderSay();
      later(400, () => say(pick(["Cheers. I'll wait here.", "Lovely, I'll wait over here.", 'Thanks, I\'ll be by the counter.'])));
      if (o.onComplete) o.onComplete({ lines: s.basket.filter((r) => r.status === 'ok').map((r) => ({ item: r.item, qty: r.qty })), orderNo: s.orderNo, slips: s.slips, how });
    }

    /* ---------- CrashFix: the search, the same as the Product Search page's ---------- */
    const PAGE = 20;
    let shown = null, shownCount = 0, searchT = 0;
    function runSearch() {
      clearTimeout(searchT);
      searchT = setTimeout(doSearch, 90);
    }
    function doSearch() {
      const text = F.q.value;
      if (S.tab === 'crashfix') V.url.textContent = 'crashfix.example/product-search' + (text.trim() ? '#q=' + encodeURIComponent(text.trim()) : '');
      if (!P.searcher) { V.status.textContent = P.failed ? "Couldn't load the product list." : 'Loading the product list...'; if (!P.loading) loadProducts(); return; }
      if (!text.trim()) { shown = null; V.results.innerHTML = ''; q('[data-act="more"]').hidden = true; V.note.hidden = true; V.status.textContent = P.items.length.toLocaleString('en-GB') + ' products ready'; return; }
      let used = text, res = P.searcher.find(text, 300), left = [];
      // nothing has every word (people type what the customer said, "suitable for..."): like a shop's website, leave
      // out words no product has, then try without each word in turn and show the closest
      if (!res.total && text.trim().split(/\s+/).length > 1) {
        const ws = text.trim().split(/\s+/);
        const keep = ws.filter((w) => { const n = window.ProductSearch.words(w).filter(Boolean); return !n.length || n.every(known); });
        if (keep.length && keep.length < ws.length) { left = ws.filter((w) => keep.indexOf(w) < 0); used = keep.join(' '); res = P.searcher.find(used, 300); }
        if (!res.total && keep.length > 2) {
          let best = null;
          keep.forEach((w, i) => { const t = keep.filter((x, j) => j !== i).join(' '), r = P.searcher.find(t, 300); if (r.total && (!best || r.total < best.r.total)) best = { r, t, w }; });
          if (best) { res = best.r; used = best.t; left = left.concat(best.w); }
        }
      }
      shown = res; shown.words = window.ProductSearch.words(used).filter(Boolean); shown.code = window.ProductSearch.asCode(used);
      V.status.textContent = res.total ? res.total.toLocaleString('en-GB') + (res.total === 1 ? ' result' : ' results') + (res.total > res.list.length ? ' (showing the best ' + res.list.length + ')' : '') : 'No products match "' + text.trim() + '"';
      const note = left.length && res.total ? 'Nothing has all of those words, so these leave out ' + left.map((w) => '"' + w + '"').join(' and ') + '.' : res.note;
      V.note.hidden = !note; V.note.textContent = note || '';
      V.results.innerHTML = ''; shownCount = 0; V.cfscroll.scrollTop = 0;
      addPage();
    }
    function marked(name, words) {
      if (!words.length) return esc(name);
      return String(name).split(/([A-Za-z0-9]+)/).map((part, i) => {
        if (i % 2 === 0) return esc(part);
        const ws = window.ProductSearch.words(part).filter(Boolean);
        const hit = ws.some((w) => words.some((t) => w.lastIndexOf(t, 0) === 0 || (t.length > 3 && t.lastIndexOf(w, 0) === 0)));
        return hit ? '<mark>' + esc(part) + '</mark>' : esc(part);
      }).join('');
    }
    function card(r) {
      const it = r.item, title = it.web || it.name;
      return '<li class="cf-card" data-sku="' + esc(it.sku) + '"><div class="cf-ph' + (it.photo ? '' : ' none') + '" data-ph="' + (it.photo ? esc(it.sku) : '') + '"><img alt="" decoding="async"><span>' + esc(it.sku) + '</span></div>' +
        '<div class="cf-body"><h3>' + marked(title, shown.words) + '</h3>' +
        (it.web && it.web.toLowerCase() !== it.name.toLowerCase() ? '<p class="cf-alt">ILS name: ' + marked(it.name, shown.words) + '</p>' : '') +
        (it.flags & 16 ? '<span class="cf-flag">Age restricted</span>' : '') +
        (r.how === 'desc' ? '<p class="cf-why">Found in the description</p>' : '') +
        '<div class="cf-row"><button type="button" class="cf-code" data-copy="' + esc(it.sku) + '"><span>Product code</span> <b>' + esc(it.sku) + '</b></button>' +
        '<button type="button" class="cf-dbtn" data-desc="' + esc(it.sku) + '" aria-expanded="false">Description</button></div>' +
        '<div class="cf-desc" hidden></div></div></li>';
    }
    const photoWatch = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
      es.forEach((e) => { if (!e.isIntersecting) return; photoWatch.unobserve(e.target); photo(e.target); });
    }, { root: V.cfscroll, rootMargin: '200px 0px' }) : null;
    function photo(box) { // the Toolbox's own copy only (product-search/photos), never anyone else's server
      const code = box.dataset.ph, img = box.querySelector('img');
      if (!code) return;
      img.onload = () => box.classList.add('ok');
      img.onerror = () => box.classList.add('none');
      img.src = 'product-search/photos/' + encodeURIComponent(code) + '.jpg';
    }
    function addPage() {
      if (!shown) return;
      const slice = shown.list.slice(shownCount, shownCount + PAGE);
      V.results.insertAdjacentHTML('beforeend', slice.map(card).join(''));
      qa('.cf-ph[data-ph]:not([data-w])').forEach((b) => { b.setAttribute('data-w', '1'); if (photoWatch) photoWatch.observe(b); else photo(b); });
      shownCount += slice.length;
      q('[data-act="more"]').hidden = shownCount >= shown.list.length;
    }
    // every word in a name or a description, sorted, to tell which typed words no product has
    let vocab = null;
    function known(w) {
      if (!vocab) {
        const set = new Set();
        P.items.forEach((it) => { window.ProductSearch.words(it.name + ' ' + (it.web || '')).forEach((x) => { if (x) set.add(x); }); String(it.dw || '').split(' ').forEach((x) => { if (x) set.add(x); }); });
        vocab = Array.from(set).sort();
      }
      let lo = 0, hi = vocab.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (vocab[mid] < w) lo = mid + 1; else hi = mid; }
      return lo < vocab.length && vocab[lo].lastIndexOf(w, 0) === 0;
    }
    const descs = new Map();
    function toggleDesc(btn) {
      const li = btn.closest('.cf-card'), box = li.querySelector('.cf-desc'), code = btn.dataset.desc, open = box.hidden;
      box.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); li.classList.toggle('open', open);
      sfx('key');
      if (!open || box.dataset.done) return;
      const it = P.by.get(code);
      if (!it || it.desc !== 1) { box.innerHTML = '<p class="cf-none">' + (it && it.desc === 0 ? "There's no description for this one." : 'No description saved for this one yet.') + '</p>'; box.dataset.done = '1'; return; }
      box.innerHTML = '<p class="cf-none">Loading the description...</p>';
      if (!descs.has(code)) descs.set(code, fetch('product-search/descriptions/' + encodeURIComponent(code) + '.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch((e) => { descs.delete(code); throw e; }));
      descs.get(code).then((d) => {
        box.innerHTML = (d.t ? d.t.split(/\n\n+/).map((p) => '<p>' + esc(p) + '</p>').join('') : '') + (d.b && d.b.length ? '<ul>' + d.b.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') || '<p class="cf-none">No description saved for this one yet.</p>';
        box.dataset.done = '1';
      }, () => { box.innerHTML = '<p class="cf-none">Couldn\'t load the description. Check your signal, then close and tap again.</p>'; });
    }
    function copyCode(code) {
      S.clip = code; sfx('key');
      toast('Copied ' + code + (touch ? ': paste it on the Fusion tab' : ''));
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).catch(() => {}); } catch (e) { /* fine */ }
      updatePaste();
    }

    /* ---------- the on-screen keyboard (phones) ---------- */
    function showKb(input) {
      if (!touch) return;
      S.focus = input;
      V.kb.hidden = false; el.classList.add('kbup');
      updatePaste();
      const lab = input.closest('label'), name = lab ? lab.querySelector('span').textContent : input.dataset.f === 'q' ? 'Search' : input.dataset.f === 'part' ? 'Part No.' : 'Qty';
      V.kbfield.textContent = name.replace(/:$/, '');
      setTimeout(() => { try { input.scrollIntoView({ block: 'nearest' }); } catch (e) { /* fine */ } }, 30);
    }
    function hideKb() { V.kb.hidden = true; el.classList.remove('kbup'); if (S.focus && document.activeElement === S.focus) S.focus.blur(); S.focus = null; }
    function updatePaste() { const b = q('[data-k="paste"]'); b.hidden = !S.clip; b.textContent = S.clip ? 'Paste ' + S.clip : ''; }
    function type(k) {
      const f = S.focus;
      if (!f) return;
      sfx('key');
      if (k === 'hide') { hideKb(); return; }
      if (k === 'enter') { enterOn(f); return; }
      const a = f.selectionStart == null ? f.value.length : f.selectionStart, b = f.selectionEnd == null ? a : f.selectionEnd;
      if (k === 'back') {
        if (a === b && a > 0) f.setRangeText('', a - 1, a, 'end'); else f.setRangeText('', a, b, 'end');
      } else {
        const text = k === 'paste' ? S.clip : k;
        const max = f.maxLength > 0 ? f.maxLength : 999;
        if (f.value.length - (b - a) + text.length > max) return;
        f.setRangeText(text, a, b, 'end');
      }
      f.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function enterOn(f) {
      const k = f.dataset.f;
      if (WHO.includes(k)) { if (whoFilled()) search(); else hideKb(); return; }
      if (k === 'part') { if (F.part.value.trim()) { if (touch) showKb(F.qty); F.qty.focus({ preventScroll: true }); } return; }
      if (k === 'qty') { addLine(); hideKb(); return; }    // the keyboard goes so the basket shows; tap Part No. for the next one
      if (k === 'q') { hideKb(); doSearch(); return; }
      if (f.classList.contains('fu-q')) { rowQty(+f.dataset.row, f.value); hideKb(); }
    }

    /* ---------- wiring ---------- */
    let downAt = null;
    el.addEventListener('pointerdown', (e) => { downAt = e.target; }, true);
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      const t = e.target;
      // the page moved under the finger (the keyboard coming up does that): it isn't a tap on what's there now
      if (downAt && t !== downAt && !downAt.contains(t)) return;
      const tab = t.closest('.tl-tab'); if (tab) { setTab(tab.dataset.tab); return; }
      const go = t.closest('[data-go]'); if (go) { nav(go.dataset.go); return; }
      const act = t.closest('[data-act]'); if (act) { action(act.dataset.act); return; }
      const row = t.closest('.fu-tab tbody tr[data-i]'); if (row) { S.sel = +row.dataset.i; sfx('key'); renderResults(); return; }
      const del = t.closest('[data-del]'); if (del) { const s = S.session; if (s && s.basket[+del.dataset.del]) { sfx('key'); removeRow(s.basket[+del.dataset.del]); } return; }
      const cp = t.closest('[data-copy]'); if (cp) { copyCode(cp.dataset.copy); return; }
      const db = t.closest('[data-desc]'); if (db) { toggleDesc(db); return; }
      const cardEl = t.closest('.cf-card'); if (cardEl && !t.closest('.cf-desc')) { const b = cardEl.querySelector('[data-desc]'); if (b) toggleDesc(b); return; }
      if (!t.closest('input') && !t.closest('.tl-kb')) hideKb();
    });
    el.addEventListener('dblclick', (e) => { const row = e.target.closest('.fu-tab tbody tr[data-i]'); if (row) { S.sel = +row.dataset.i; select(); } });
    qa('.tl-kb [data-k]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('down'); type(b.dataset.k); }));
    qa('.tl-kb [data-k]').forEach((b) => { const up = () => b.classList.remove('down'); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up); });
    el.addEventListener('focusin', (e) => { const f = e.target; if (f.tagName === 'INPUT') { S.focus = f; if (touch) showKb(f); } });
    el.addEventListener('input', (e) => {
      const f = e.target;
      if (WHO.includes(f.dataset.f)) updateSearchBtn();
      if (f.dataset.f === 'q') runSearch();
      if (f.dataset.f === 'part') f.value = f.value.toUpperCase();
      if (f.dataset.f === 'postcode') f.value = f.value.toUpperCase();
      if (f.dataset.f === 'qty' || f.classList.contains('fu-q')) f.value = f.value.replace(/\D/g, '');
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); if (!V.kb.hidden) hideKb(); else action('leave'); return; }
      const f = e.target;
      if (e.key === 'Enter' && f.tagName === 'INPUT') { e.preventDefault(); enterOn(f); return; }
      if (e.altKey && (e.key === '1' || e.key === '2')) { e.preventDefault(); setTab(e.key === '1' ? 'fusion' : 'crashfix'); }
    }, true);
    el.addEventListener('change', (e) => { const f = e.target; if (f.classList.contains('fu-q')) rowQty(+f.dataset.row, f.value); });
    V.form.addEventListener('submit', (e) => { e.preventDefault(); hideKb(); F.q.blur(); doSearch(); });

    function nav(go) {
      sfx('key');
      const s = S.session;
      if (S.screen === 'pay' || S.screen === 'done') return;
      if (go === 'who') { show('who'); return; }
      if (go === 'order') { if (s && s.selected) show('order'); else fuMsg('Identify the customer first.'); return; }
      if (go === 'pay') { goPay(); return; }
      fuMsg('Not used in the game.');
    }
    function action(a) {
      const s = S.session;
      switch (a) {
        case 'leave': sfx('key'); if (o.onClose) o.onClose(); break;
        case 'ask': askAgain(); break;
        case 'search': search(); break;
        case 'saysno': sfx('key'); if (s && s.stage === 'details') say("I've got an account, mate. Postcode's " + s.cust.postcode + ', surname ' + s.cust.surname + '.'); else fuMsg('No customer to serve.'); break;
        case 'refine': sfx('key'); show('who'); break;
        case 'select': select(); break;
        case 'create': sfx('key'); if (s && s.stage === 'details') say("I've already got an account."); else fuMsg('No customer to create.'); break;
        case 'quote': sfx('key'); fuMsg('No quotes today: the customer is buying.'); break;
        case 'cancel':
          sfx('key');
          if (S.screen === 'pay' || S.screen === 'done') return;
          if (s && (s.selected || s.basket.length)) {
            s.selected = false; s.basket = []; s.cur = 0; s.ready = false; s.stage = 'details'; s.lines.forEach((l) => { l.done = false; });
            renderBasket(); clearWho(); S.results = []; show('who');
            say("Eh? I still need my stuff! Postcode's " + s.cust.postcode + '.');
          } else { clearWho(); show('who'); }
          break;
        case 'back':
          sfx('key');
          if (S.screen === 'res') show('who'); else if (S.screen === 'order') { if (S.results.length) show('res'); else show('who'); }
          break;
        case 'payback': if (s && s.stage === 'paying' && V.modal.hidden) { sfx('key'); s.stage = 'ordering'; show('order'); renderSay(); } break;
        case 'card': payCard(); break;
        case 'cash': payCash(); break;
        case 'change': sfx('key'); complete('cash'); break;
        case 'trade': case 'nocredit': sfx('bad'); if (s) say('Card or cash, mate.'); break;
        case 'more': addPage(); break;
        default:
      }
    }

    /* ---------- what game.js uses ---------- */
    function reset() {
      stopTimers();
      clearWho(); S.results = []; S.sel = -1;
      F.part.value = ''; F.qty.value = '';
      V.modal.hidden = true;
      show('who');
      renderBasket();
    }
    // the customer gives their details once you're at the till: postcode first, then surname (detailedfoil's order)
    function begin() {
      const s = S.session;
      if (!s || s.stage !== 'arrived') return;
      s.stage = 'details';
      later(700, () => say("Postcode's " + s.cust.postcode + '.'));
      later(2100, () => say("Surname's " + s.cust.surname + '.'));
    }
    return {
      el,
      isOpen: () => S.open,
      open() {
        if (S.open) return;
        S.open = true; el.hidden = false;
        begin();
        if (!P.searcher && !P.loading) loadProducts();
        renderSay();
        if (S.tab === 'fusion') focusDefault(); else if (!touch) F.q.focus({ preventScroll: true });
      },
      close() { if (!S.open) return; S.open = false; hideKb(); el.hidden = true; },
      // a till customer has walked up: cust from Till.makeCustomer, lines from Till.makeOrder
      serve(cust, lines, colour) {
        reset();
        S.session = { cust, lines, cur: 0, stage: 'arrived', selected: false, basket: [], slips: 0, ready: false, since: Date.now(), colour };
        renderSay();
        say(pick(['Morning! Can I order a few bits?', "Hiya, I'd like to order some stuff.", 'Alright? Need to order a couple of things.', "Hello, I'd like to place an order.", 'Can I order some bits, please?']));
        if (S.open) begin();
      },
      // the customer's gone (handed over or skipped)
      clear() { reset(); S.session = null; renderSay(); },
      stage: () => (S.session ? S.session.stage : 'none'),
      session: () => S.session,
      preload: loadProducts,
      refresh: renderSay,
      say,
      // tests and playthroughs
      debug: { S, F, P, search, select, addLine, goPay, payCard, payCash, setTab, doSearch, type, action }
    };
  }

  window.ShiftTillUI = { create };
})();
