/* Warehouse Shift: the till screen. A browser with two tabs, like the trade counter PCs in detailedfoil's photos:
   Fusion (the till system: Identify Customer, Search Results, Customer Order, Checkout, Order Complete) and CrashFix
   (the Product Search page's own search over the same product list, names and description words). Find the product
   on CrashFix, switch to Fusion, type its part number and quantity; the customer says if it's right.

   Copied from the photos: the layout, the blue nav buttons, the red Search and Select bars, the basket columns, the
   checkout's totals and payment buttons. Not copied: the logo artwork (plain text instead), the real username, the
   till's web address and anyone's details (the customers are made up in till.js).

   game.js makes one with create({...}) and tells it when a till customer arrives (serve) and leaves; this file runs
   the conversation and calls back when the order is paid for (onComplete), which puts it on the shared pick list and
   hands back its order number. Copying a product's code on CrashFix shows it to the customer, who says straight away
   whether it's the right one (detailedfoil); a line with the right product but the wrong quantity is put right by
   typing the new quantity in its own Qty box (or the same part number again).
   Kiosk orders (detailedfoil, 19 Nov 2026): some till customers have already sent their order from the kiosk. After
   the postcode and surname search they say so and give the name they used (usually their first name); open Kiosk
   Orders, pick theirs and the basket fills itself. The customer says card or cash at the checkout (cash opens the drawer: count the change out, note by note and coin
   by coin, before the order can finish) and puts you right
   if you press the other one.

   Phones use their own keyboard; the keyboard button at the top swaps to an on-screen one (remembered, ws-osk).
   A controller (game.js passes its buttons to pad()) moves a yellow highlight between the buttons, boxes and rows;
   A presses, a box brings the on-screen keyboard up (the highlight moves round its keys), B deletes or leaves the till,
   RT is Enter, LB and RB switch tabs, Y is Ask again. */
(function () {
  'use strict';

  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  // a right product: never "that's it", which sounds like the end of the order (detailedfoil)
  const RIGHT = ["Yes, that's the one!", "Spot on, that's the one.", "That's the one, cheers.", 'Perfect, that one.', "Yep, that's the one."];
  const WRONG = ["No, that's not it.", 'Not that one, mate.', "No, that's not what I'm after.", "Nope, that's not it.", "That's not the one."];
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
    <button class="tl-kbt" type="button" data-act="osk" hidden></button>
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
          <section class="fu-scr" data-scr="kiosk" hidden>
            <div class="fu-tt">Kiosk Orders</div>
            <div class="fu-box">
              <div class="fu-bar"><span>Orders sent from the kiosks today. Pick the customer's and press Select:</span></div>
              <div class="fu-tw"><table class="fu-tab fu-kiosk"><thead><tr><th>Time</th><th>Name</th><th>Items</th><th>Total</th></tr></thead><tbody data-v="krows"></tbody></table></div>
              <div class="fu-btns"><button class="fu-blue big" type="button" data-act="kback">Back</button><button class="fu-red big" type="button" data-act="kselect">Select</button></div>
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
        <p class="fx-next" data-v="donetext">It's on the pick list for whoever gets to it first. The customer waits by the counter.</p>
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
  <div class="dr" data-v="drawer" hidden>
    <div class="dr-box">
      <div class="dr-disp">
        <div><span>To pay</span><b data-v="drpay"></b></div>
        <div><span>They gave you</span><b data-v="drgiven"></b><i class="dr-gnotes" data-v="drnotes"></i></div>
        <div class="due"><span>Change due</span><b data-v="drdue"></b></div>
      </div>
      <div class="dr-3d"><div class="dr-tray">
        <div class="dr-notes">${[500, 1000, 2000, 5000].map((p) => `<button type="button" class="dr-slot n${p}" data-dr="${p}" aria-label="&pound;${p / 100} note"><span class="dr-stack"><i></i><i></i><i class="top"><b>&pound;${p / 100}</b></i></span><span class="dr-clip"></span></button>`).join('')}</div>
        <div class="dr-coins">${[200, 100, 50, 20, 10, 5, 2, 1].map((p) => `<button type="button" class="dr-cup c${p}" data-dr="${p}" aria-label="${p >= 100 ? '&pound;' + p / 100 : p + 'p'} coin"><span class="dr-pile"><i></i><i></i><i class="top"><b>${p >= 100 ? '&pound;' + p / 100 : p + 'p'}</b></i></span></button>`).join('')}</div>
      </div><div class="dr-lip"><span class="dr-key"></span></div></div>
      <div class="dr-hand">
        <div class="dr-sum"><span>In your hand</span><b data-v="drsum">&pound;0.00</b></div>
        <div class="dr-toks" data-v="drtoks"></div>
        <div class="dr-btns"><button type="button" class="dr-btn" data-act="drstart">Start over</button><button type="button" class="dr-btn go" data-act="drgive">Give change</button></div>
      </div>
    </div>
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
    qa('[data-f]').forEach((n) => { F[n.dataset.f] = n; });
    const scr = {};
    qa('[data-scr]').forEach((n) => { scr[n.dataset.scr] = n; });

    const S = { open: false, tab: 'fusion', screen: 'who', results: [], sel: -1, ksel: -1, clip: '', focus: null, session: null, timers: [], osk: false, pad: false };
    try { S.osk = localStorage.getItem('ws-osk') === '1'; } catch (e) { /* fine */ }
    // the on-screen keyboard: a phone that asked for it, or anyone with a controller
    const osk = () => (touch && S.osk) || S.pad;
    // what each box asks the phone's own keyboard for, or nothing at all when the on-screen keyboard is on
    function kbMode(n) {
      if (osk()) { n.setAttribute('inputmode', 'none'); return; }
      const f = n.dataset.f;
      n.setAttribute('inputmode', f === 'qty' || f === 'no' || n.classList.contains('fu-q') ? 'numeric' : f === 'email' ? 'email' : f === 'q' ? 'search' : 'text');
      if (f === 'part' || f === 'postcode') n.setAttribute('autocapitalize', 'characters');
      if (f === 'part' || f === 'qty' || f === 'q') n.setAttribute('enterkeyhint', f === 'q' ? 'search' : f === 'part' ? 'next' : 'done');
    }
    function kbModes() {
      qa('input').forEach(kbMode);
      const b = q('[data-act="osk"]');
      b.hidden = !touch;
      b.innerHTML = '&#9000; ' + (S.osk ? 'On-screen keys' : 'Phone keyboard');
      b.title = S.osk ? 'Using the on-screen keyboard: tap to use the phone\'s own' : 'Using the phone\'s keyboard: tap for the on-screen one';
    }
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
      el.querySelector('[data-act="ask"]').hidden = !(s.stage === 'details' || s.stage === 'ordering' || s.stage === 'kiosk' || s.stage === 'paying');
    }
    function askAgain() {
      const s = S.session;
      if (!s) return;
      sfx('key');
      if (s.stage === 'details') { say({ text: "Surname's " + s.cust.surname + ', postcode ' + s.cust.postcode + '.' + (s.searched ? ' ' + s.cust.third.say : '') }); return; }
      if (s.stage === 'kiosk') { say(s.kiosk.say + ' ' + s.kiosk.sayName); return; }
      if (s.stage === 'paying') { say(s.pay.say); return; }
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
      ['who', 'res', 'order', 'kiosk'].forEach((k) => { scr[k].hidden = k !== name; });
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
      const f = S.screen === 'who' ? (F.surname.value ? (F.postcode.value ? null : F.postcode) : F.surname) : S.screen === 'order' ? F.part : null;
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
        s.searched = true;
        if (me >= 0 && !s.saidThird) { s.saidThird = true; later(700, () => say(s.cust.third.say)); }
        else if (me < 0 && S.results.length && !s.saidNotMe) { s.saidNotMe = true; later(700, () => say("I'm not on there.")); }
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
      if (s.stage !== 'details') return;
      if (s.kind === 'kiosk') { s.stage = 'kiosk'; later(650, () => say(s.kiosk.say)); later(2000, () => say(s.kiosk.sayName)); return; }
      s.stage = 'ordering'; later(650, () => sayRequest(false));
    }

    // Kiosk Orders: today's orders from the kiosks; picking the customer's fills the basket
    function renderKiosk() {
      const s = S.session, list = s && s.kiosk ? s.kiosk.list : [];
      if (!list.length) { V.krows.innerHTML = '<tr class="none"><td colspan="5">No kiosk orders waiting.</td></tr>'; return; }
      V.krows.innerHTML = list.map((k, i) => {
        const units = k.lines.reduce((t, l) => t + l.qty, 0);
        return '<tr data-k="' + i + '"' + (i === S.ksel ? ' class="sel"' : '') + '><td>' + esc(k.time) + '</td><td><b>' + esc(k.name) + '</b></td><td>' +
          k.lines.length + (k.lines.length > 1 ? ' lines, ' : ' line, ') + units + (units > 1 ? ' items' : ' item') + '</td><td>' + Till.money(k.total) + '</td></tr>';
      }).join('');
    }
    function openKiosk() {
      const s = S.session;
      if (!s || !s.selected) { fuMsg('Identify the customer first.'); return; }
      if (s.stage === 'paying' || s.stage === 'done') return;
      S.ksel = -1; renderKiosk(); show('kiosk');
    }
    function kioskSelect() {
      const s = S.session, k = s && s.kiosk && s.kiosk.list[S.ksel];
      sfx('key');
      if (!k) { fuMsg('Pick an order from the list first.'); return; }
      if (s.stage !== 'kiosk') {
        if (s.kind === 'kiosk' && s.lines.length) { fuMsg('Their kiosk order is already in the basket.'); show('order'); return; }
        s.slips++; if (o.onSlip) o.onSlip(); sfx('bad'); say("That's not mine, mate. I haven't used the kiosk."); return;
      }
      if (!k.mine) { s.slips++; if (o.onSlip) o.onSlip(); sfx('bad'); say("That's not mine. " + s.kiosk.sayName); return; }
      s.lines = k.lines.map((l) => ({ kind: 'code', item: l.item, qty: l.qty, accept: [l.item.code], done: true, clue: "It's " + l.item.code.split('').join(' ') + '.',
        say: 'I had ' + l.item.code + ' on my kiosk order.', qtySay: l.qty > 1 ? l.qty + ' of them.' : '', next: '' }));
      s.basket = k.lines.map((l, i) => { const p = product(l.item.code); return { code: l.item.code, name: p ? p.name : l.item.name, qty: l.qty, price: p ? p.price : Till.price(l.item), avail: Till.avail(l.item), item: l.item, status: 'ok', line: i }; });
      s.cur = s.lines.length; s.ready = true; s.stage = 'ordering';
      renderBasket(); show('order'); sfx('good');
      say(pick(["That's the one, yeah.", "Yep, that's mine.", "That's mine, cheers."]));
      later(1300, () => say(pick(["That's everything. How much is that?", "That's the lot.", "That's all of it, I think."])));
    }

    // Customer Order: the basket
    function basketTotal() { return S.session ? S.session.basket.reduce((t, r) => t + r.price * r.qty, 0) : 0; }
    let drawing = false;
    function renderBasket() {
      // taking the rows away blurs a Qty box being typed in, and its change event comes back here: once is enough
      if (drawing) return;
      drawing = true;
      try { drawBasket(); } finally { drawing = false; }
    }
    function drawBasket() {
      const s = S.session, rows = s ? s.basket : [];
      qa('tr.fu-line').forEach((tr) => { if (tr.parentNode) tr.parentNode.removeChild(tr); });
      const body = V.basket;
      rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        tr.className = 'fu-line ' + r.status;
        tr.dataset.i = i;
        tr.innerHTML = '<td>' + esc(r.code) + '</td><td><input class="fu-q" data-row="' + i + '" value="' + r.qty + '" maxlength="3" autocomplete="off" inputmode="' + (osk() ? 'none' : 'numeric') + '"></td><td class="' + (r.avail ? '' : 'out') + '">' + r.avail +
          '</td><td class="d">' + esc(r.name) + '</td><td>Collect</td><td>1</td><td>' + (r.price / 100).toFixed(2) + '</td><td>' + (r.price * r.qty / 100).toFixed(2) + '</td><td><button type="button" class="fu-del" data-del="' + i + '" aria-label="Remove line">&times;</button></td>';
        body.appendChild(tr);
      });
      V.count.textContent = String(rows.length);
      V.total.textContent = Till.money(basketTotal());
      updatePaste();
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
      const same = s.basket.findIndex((r) => r.code === code && r.status === 'qty');
      if (same >= 0) { rowQty(same, qty); focusDefault(); return; }
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
      if (s.stage === 'kiosk') {
        row.status = 'wrong'; renderBasket(); say("I've already done it on the kiosk, mate. " + s.kiosk.sayName); sfx('bad'); later(1300, () => removeRow(row)); return;
      }
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
        say(pick(WRONG));
        later(1400, () => removeRow(row));
        return;
      }
      row.line = s.cur;
      if (verdict === 'qty') {
        row.status = 'qty'; renderBasket(); sfx('bad');
        say("That's the one, but I need " + ln.qty + '.');
        fixQty(row);
        return;
      }
      lineDone(row);
    }
    function lineDone(row) {
      const s = S.session, ln = s.lines[row.line];
      const quiet = ln.shown === row.code; // they said it was the one when you copied it
      row.status = 'ok'; ln.done = true;
      renderBasket(); sfx('good');
      if (quiet) say(pick(['Lovely.', 'Cheers.', 'Nice one.', 'Ta.']));
      if (!quiet) say(pick(RIGHT));
      const next = s.lines.findIndex((l) => !l.done);
      if (next < 0) { s.cur = s.lines.length; s.ready = true; later(1100, () => say(pick(["That's everything. I'll pay now.", "That's the lot, cheers.", "That's all I need. How much is that?"]))); }
      else { s.cur = next; later(quiet ? 900 : 1300, () => sayRequest(false)); }
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
    // the Qty box on a line with the wrong quantity: selected, so typing the right number replaces it
    function fixQty(row) {
      const s = S.session, i = s ? s.basket.indexOf(row) : -1;
      if (i < 0) return;
      later(60, () => {
        const box = el.querySelector('.fu-q[data-row="' + i + '"]');
        if (!box || !S.open || S.tab !== 'fusion') return;
        if (osk()) { box.focus({ preventScroll: true }); showKb(box); box.select(); }
        else if (!touch) { box.focus({ preventScroll: true }); box.select(); }
      });
      toast('Type the right quantity in the Qty box, then Enter');
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
        else { row.status = 'qty'; ln.done = false; s.ready = false; s.cur = s.lines.findIndex((l) => !l.done); renderBasket(); say("No, I need " + ln.qty + '.'); fixQty(row); }
      } else renderBasket();
    }

    // Checkout
    function goPay() {
      const s = S.session;
      sfx('key');
      if (!s || !s.selected) { fuMsg('Identify the customer first.'); return; }
      if (s.stage === 'kiosk') { say("I've got an order on the kiosk. " + s.kiosk.sayName); return; }
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
      if (!s.paySaid) { s.paySaid = true; later(600, () => say(s.pay.say)); }
    }
    // they said card or cash: the other button gets put right, and counts against a perfect pick
    function wrongMethod() {
      const s = S.session;
      s.slips++; if (o.onSlip) o.onSlip(); sfx('bad');
      say(s.pay.how === 'card' ? pick(['No, I said card.', "I'm paying by card, mate.", 'Card, not cash.']) : pick(['No, I said cash.', "I'm paying cash, mate.", "Cash, I've got it here."]));
    }
    function pdq(html) { V.pdq.innerHTML = html; V.modal.hidden = false; }
    function payCard() {
      const s = S.session; if (!s || s.stage !== 'paying' || !V.modal.hidden) return;
      if (s.pay.how !== 'card') { wrongMethod(); return; }
      sfx('key');
      const amt = Till.money(basketTotal());
      pdq('<h2>Card machine</h2><div class="fx-screen"><b>' + esc(amt) + '</b><span>Insert, tap or swipe card</span></div><p class="fx-wait">Waiting for the customer<i>.</i><i>.</i><i>.</i></p>');
      later(500, () => say(pick(['Tapping now.', "There's my card.", 'Contactless OK?'])));
      later(1900, () => { sfx('approved'); pdq('<h2>Card machine</h2><div class="fx-screen ok"><b>APPROVED</b><span>' + esc(amt) + '</span></div><p class="fx-wait">Remove card</p>'); });
      later(3000, () => complete('card'));
    }
    // cash: the drawer opens and you count the change out of it, note by note and coin by coin; the order can't
    // finish until it's right (detailedfoil, 21 Nov 2026)
    function payCash() {
      const s = S.session; if (!s || s.stage !== 'paying' || !V.modal.hidden || s.cash) return;
      if (s.pay.how !== 'cash') { wrongMethod(); return; }
      sfx('key');
      const inc = basketTotal(), given = Till.tender(inc, s.pay);
      if (given === inc) { // the exact money: nothing to count out, a beat to take it, then done
        s.cash = { inc, given, due: 0, hand: [], done: true };
        say(pick(['Exact money: ' + Till.money(inc) + '.', 'Here, ' + Till.money(inc) + ' exactly.', "That's the right money."]));
        sfx('coin');
        later(1400, () => { sfx('drawer'); complete('cash'); });
        return;
      }
      s.cash = { inc, given, due: given - inc, hand: [], done: false };
      say(pick(['Here you go.', "There's " + Till.money(given) + '.', 'Cash OK? ' + Till.money(given) + ' there.']));
      openDrawer();
    }
    const handSum = () => S.session.cash.hand.reduce((a, b) => a + b, 0);
    function placeDrawer() { V.drawer.style.top = (V.say.offsetTop + V.say.offsetHeight) + 'px'; }
    if (window.ResizeObserver) new ResizeObserver(() => { if (!V.drawer.hidden) placeDrawer(); }).observe(V.say);
    function openDrawer() {
      const c = S.session.cash;
      V.drpay.textContent = Till.money(c.inc); V.drgiven.textContent = Till.money(c.given); V.drdue.textContent = Till.money(c.due);
      V.drnotes.innerHTML = Till.notesFor(c.given).map((p) => '<i class="dr-mini n' + p + '">' + Till.denomName(p) + '</i>').join('');
      renderHand();
      V.drawer.classList.remove('open', 'shut');
      V.drawer.hidden = false;
      placeDrawer();
      void V.drawer.offsetWidth; // so the slide out plays
      V.drawer.classList.add('open');
      sfx('drawer');
      if (S.pad) later(60, () => padMark(padStart(padItems())));
    }
    function renderHand() {
      const c = S.session && S.session.cash; if (!c) return;
      const sum = handSum();
      V.drsum.textContent = Till.money(sum);
      V.drsum.className = sum === c.due ? 'ok' : sum > c.due ? 'over' : '';
      V.drtoks.innerHTML = c.hand.length ? c.hand.map((p, i) => '<button type="button" class="dr-tok ' + (p >= 500 ? 'n' : 'c') + p + '" data-hand="' + i + '" title="Put it back">' + Till.denomName(p) + '</button>').join('') : '<span class="dr-empty">Tap the notes and coins to take them out</span>';
    }
    function drTake(p) {
      const s = S.session; if (!s || !s.cash || s.cash.done) return;
      s.cash.hand.push(p); s.cash.hand.sort((a, b) => b - a);
      sfx(p >= 500 ? 'key' : 'coin');
      const b = el.querySelector('[data-dr="' + p + '"]'); if (b) { b.classList.remove('tk'); void b.offsetWidth; b.classList.add('tk'); }
      renderHand();
    }
    function drBack(i) {
      const s = S.session; if (!s || !s.cash || s.cash.done) return;
      s.cash.hand.splice(i, 1); sfx('key'); renderHand();
      if (S.pad) later(30, () => { if (!padEl || padItems().indexOf(padEl) < 0) padMark(padStart(padItems())); });
    }
    function drStart() {
      const s = S.session; if (!s || !s.cash || s.cash.done) return;
      s.cash.hand = []; sfx('key'); renderHand();
      if (S.pad) padMark(padStart(padItems()));
    }
    function drGive() {
      const s = S.session; if (!s || !s.cash || s.cash.done) return;
      const c = s.cash, sum = handSum();
      if (!sum) { sfx('bad'); say(pick(["I'm still waiting for my change.", 'Change, please, mate.', "Where's my change?"])); return; }
      if (sum !== c.due) {
        s.slips++; if (o.onSlip) o.onSlip(); sfx('bad');
        say(sum < c.due ? pick(["That's only " + Till.money(sum) + ', mate. I should get ' + Till.money(c.due) + ' back.', "That's " + Till.money(sum) + ". I'm owed " + Till.money(c.due) + '.'])
          : pick(["That's too much, mate. I only need " + Till.money(c.due) + ' back.', "You've given me " + Till.money(sum) + ". It's " + Till.money(c.due) + ' change.']));
        return;
      }
      c.done = true;
      sfx('coin');
      say(pick(['Cheers.', 'Lovely, thanks.', 'Spot on, ta.', 'Thanks, mate.']));
      later(500, () => {
        V.drawer.classList.remove('open'); V.drawer.classList.add('shut');
        sfx('drawer');
        later(520, () => { V.drawer.hidden = true; V.drawer.classList.remove('shut'); complete('cash'); });
      });
    }
    async function complete(how) {
      const s = S.session; if (!s || s.stage !== 'paying') return;
      s.stage = 'submitting';
      const lines = s.basket.filter((r) => r.status === 'ok').map((r) => ({ item: r.item, qty: r.qty }));
      const result = o.onComplete && o.onComplete({ lines, slips: s.slips, how, change: s.cash ? handSum() : 0 });
      if (result && typeof result.then === 'function') {
        s.orderNo = await result;
        if (S.session !== s) return;
        if (!s.orderNo) { s.stage = 'ordering'; s.cash = null; V.modal.hidden = true; show('order'); fuMsg('Payment could not be confirmed. Try Pay & Go again.'); return; }
      } else s.orderNo = result || Till.orderNumber(Math.random);
      s.stage = 'done';
      V.orderno.textContent = s.orderNo;
      V.donetext.textContent = "It's on the pick list for whoever gets to it first. The customer waits by the counter.";
      V.modal.hidden = true;
      show('done');
      sfx('done');
      renderSay();
      later(400, () => say(pick(["Cheers. I'll wait here.", "Lovely, I'll wait over here.", 'Thanks, I\'ll be by the counter.'])));
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
      showCustomer(code);
    }
    function showCustomer(code) {
      const s = S.session, ln = s && s.stage === 'ordering' ? s.lines[s.cur] : null;
      if (!ln || ln.done) return;
      if (ln.accept.indexOf(code) >= 0) {
        if (ln.shown === code) return;
        ln.shown = code; sfx('good');
        say({ text: pick(RIGHT) + ' Pop it on the order.', qty: ln.qty > 1 ? 'I need ' + ln.qty + '.' : '' });
        return;
      }
      ln.wrong = ln.wrong || {};
      if (ln.wrong[code]) return; // they've told you already
      ln.wrong[code] = 1; s.slips++; if (o.onSlip) o.onSlip(); sfx('bad');
      say(pick(WRONG));
    }

    /* ---------- the on-screen keyboard (phones) ---------- */
    function showKb(input) {
      if (!osk()) return;
      S.focus = input;
      V.kb.hidden = false; el.classList.add('kbup');
      updatePaste();
      const lab = input.closest('label'), name = lab ? lab.querySelector('span').textContent : input.dataset.f === 'q' ? 'Search' : input.dataset.f === 'part' ? 'Part No.' : 'Qty';
      V.kbfield.textContent = name.replace(/:$/, '');
      setTimeout(() => { try { input.scrollIntoView({ block: 'nearest' }); } catch (e) { /* fine */ } }, 30);
    }
    function hideKb() { V.kb.hidden = true; el.classList.remove('kbup'); if (S.focus && document.activeElement === S.focus) S.focus.blur(); if (S.focus) S.last = S.focus; S.focus = null; }
    function updatePaste() {
      const b = q('[data-k="paste"]'); b.hidden = !S.clip; b.textContent = S.clip ? 'Paste ' + S.clip : '';
      // with the phone's own keyboard, a Paste button sits by the part number box instead
      const fix = S.session && S.session.basket.some((r) => r.status === 'qty');
      V.tip.innerHTML = fix ? '<b class="fu-fix">Change the quantity in the yellow line\'s Qty box</b>' : S.clip && touch && !S.osk ? '<button type="button" class="fu-paste" data-act="paste">Paste ' + esc(S.clip) + '</button> then the quantity' : 'Type the part number, then the quantity, then Enter';
    }
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
      if (k === 'part') { if (F.part.value.trim()) { showKb(F.qty); F.qty.focus({ preventScroll: true }); } return; }
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
      const dr = t.closest('[data-dr]'); if (dr) { drTake(+dr.dataset.dr); return; }
      const hd = t.closest('[data-hand]'); if (hd) { drBack(+hd.dataset.hand); return; }
      const act = t.closest('[data-act]'); if (act) { action(act.dataset.act); return; }
      const row = t.closest('.fu-tab tbody tr[data-i]'); if (row) { S.sel = +row.dataset.i; sfx('key'); renderResults(); return; }
      const krow = t.closest('.fu-tab tbody tr[data-k]'); if (krow) { S.ksel = +krow.dataset.k; sfx('key'); renderKiosk(); return; }
      const del = t.closest('[data-del]'); if (del) { const s = S.session; if (s && s.basket[+del.dataset.del]) { sfx('key'); removeRow(s.basket[+del.dataset.del]); } return; }
      const cp = t.closest('[data-copy]'); if (cp) { copyCode(cp.dataset.copy); return; }
      const db = t.closest('[data-desc]'); if (db) { toggleDesc(db); return; }
      const cardEl = t.closest('.cf-card'); if (cardEl && !t.closest('.cf-desc')) { const b = cardEl.querySelector('[data-desc]'); if (b) toggleDesc(b); return; }
      if (!t.closest('input') && !t.closest('.tl-kb')) hideKb();
    });
    el.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.fu-tab tbody tr[data-i]'); if (row) { S.sel = +row.dataset.i; select(); return; }
      const krow = e.target.closest('.fu-tab tbody tr[data-k]'); if (krow) { S.ksel = +krow.dataset.k; kioskSelect(); }
    });
    qa('.tl-kb [data-k]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('down'); type(b.dataset.k); }));
    qa('.tl-kb [data-k]').forEach((b) => { const up = () => b.classList.remove('down'); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up); });
    el.addEventListener('focusin', (e) => {
      const f = e.target;
      if (f.tagName !== 'INPUT') return;
      S.focus = f;
      if (osk()) showKb(f);
      else if (touch) setTimeout(() => { try { f.scrollIntoView({ block: 'center' }); } catch (x) { /* fine */ } }, 350); // after the phone's keyboard is up
    });
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
      if (go === 'kiosk') { openKiosk(); return; }
      fuMsg('Not used in the game.');
    }
    function action(a) {
      const s = S.session;
      switch (a) {
        case 'leave': sfx('key'); if (o.onClose) o.onClose(); break;
        case 'ask': askAgain(); break;
        case 'search': search(); break;
        case 'saysno': sfx('key'); if (s && s.stage === 'details') say("I've got an account, mate. Surname's " + s.cust.surname + ', postcode ' + s.cust.postcode + '.'); else fuMsg('No customer to serve.'); break;
        case 'refine': sfx('key'); show('who'); break;
        case 'select': select(); break;
        case 'create': sfx('key'); if (s && s.stage === 'details') say("I've already got an account."); else fuMsg('No customer to create.'); break;
        case 'quote': sfx('key'); fuMsg('No quotes today: the customer is buying.'); break;
        case 'cancel':
          sfx('key');
          if (S.screen === 'pay' || S.screen === 'done') return;
          if (s && (s.selected || s.basket.length)) {
            s.selected = false; s.basket = []; s.cur = 0; s.ready = false; s.stage = 'details'; if (s.kind === 'kiosk') s.lines = []; s.lines.forEach((l) => { l.done = false; });
            renderBasket(); clearWho(); S.results = []; show('who');
            say("Eh? I still need my stuff! Surname's " + s.cust.surname + '.');
          } else { clearWho(); show('who'); }
          break;
        case 'back':
          sfx('key');
          if (S.screen === 'res') show('who'); else if (S.screen === 'kiosk') show('order'); else if (S.screen === 'order') { if (S.results.length) show('res'); else show('who'); }
          break;
        case 'payback': if (s && s.stage === 'paying' && V.modal.hidden) { sfx('key'); s.stage = 'ordering'; show('order'); renderSay(); } break;
        case 'card': payCard(); break;
        case 'cash': payCash(); break;
        case 'drstart': drStart(); break;
        case 'drgive': drGive(); break;
        case 'trade': case 'nocredit': if (s && s.stage === 'paying' && V.modal.hidden) wrongMethod(); else sfx('bad'); break;
        case 'kback': sfx('key'); show(s && s.selected ? 'order' : 'who'); break;
        case 'kselect': kioskSelect(); break;
        case 'paste': sfx('key'); if (S.clip) { F.part.value = S.clip; F.qty.focus(); } break;
        case 'osk':
          sfx('key'); S.osk = !S.osk; try { localStorage.setItem('ws-osk', S.osk ? '1' : '0'); } catch (e) { /* fine */ }
          hideKb(); kbModes(); updatePaste(); toast(S.osk ? 'On-screen keyboard' : "Phone's own keyboard");
          break;
        case 'more': addPage(); break;
        default:
      }
    }

    kbModes(); updatePaste();

    /* ---------- a controller: a highlight that moves between what can be pressed ---------- */
    let padEl = null;
    function padItems() {
      const kb = !V.kb.hidden;
      const list = !V.drawer.hidden ? qa('.dr button') : kb ? qa('.tl-kb [data-k]') : qa('button, input, .fu-tab tbody tr[data-i], .fu-tab tbody tr[data-k]').filter((n) => !n.closest('.tl-kb'));
      return list.filter((n) => !n.disabled && !n.hidden && n.offsetParent !== null && !n.closest('[hidden]'));
    }
    function padMark(n) {
      if (padEl) padEl.classList.remove('pad-on');
      padEl = n || null;
      if (padEl) { padEl.classList.add('pad-on'); try { padEl.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* fine */ } }
    }
    // the nearest thing in the direction pressed (straight on counts more than off to the side)
    function padMove(dx, dy) {
      const items = padItems();
      if (!items.length) return;
      if (!padEl || items.indexOf(padEl) < 0) { padMark(padStart(items)); return; }
      const r0 = padEl.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
      let best = null, bs = Infinity;
      for (const n of items) {
        if (n === padEl) continue;
        const r = n.getBoundingClientRect(), ex = Math.max(r.left - cx, 0, cx - r.right) * Math.sign(r.left + r.width / 2 - cx), ey = Math.max(r.top - cy, 0, cy - r.bottom) * Math.sign(r.top + r.height / 2 - cy);
        const along = (dx ? ex * dx : ey * dy), side = Math.abs(dx ? r.top + r.height / 2 - cy : r.left + r.width / 2 - cx);
        if (along <= 2) continue;
        const score = along + side * 2;
        if (score < bs) { bs = score; best = n; }
      }
      if (best) { padMark(best); sfx('key'); }
    }
    // where the highlight starts: the box you'd type in next, or the first key
    function padStart(items) {
      if (!V.kb.hidden) return el.querySelector('.tl-kb [data-k="' + (S.focus && (S.focus.dataset.f === 'qty' || S.focus.classList.contains('fu-q')) ? '1' : 'Q') + '"]') || items[0];
      if (!V.drawer.hidden) { const c = S.session && S.session.cash; return (c && c.hand.length && handSum() === c.due ? q('[data-act="drgive"]') : q('.dr [data-dr]')) || items[0]; }
      if (S.last && items.indexOf(S.last) >= 0) return S.last;
      let want = null;
      if (S.tab === 'crashfix') want = F.q.value.trim() ? el.querySelector('.cf-card [data-copy]') : F.q;
      else if (S.screen === 'who') want = F.surname.value ? F.postcode : F.surname;
      else if (S.screen === 'res') want = el.querySelector('.fu-tab tbody tr[data-i].sel') || el.querySelector('.fu-tab tbody tr[data-i]') || el.querySelector('[data-act="refine"]');
      else if (S.screen === 'kiosk') want = el.querySelector('.fu-kiosk tbody tr[data-k].sel') || el.querySelector('.fu-kiosk tbody tr[data-k]');
      else if (S.screen === 'order') want = el.querySelector('.fu-line.qty .fu-q') || F.part;
      else if (S.screen === 'pay') want = el.querySelector('.fx-modal:not([hidden]) .fx-go') || el.querySelector('[data-act="card"]');
      else if (S.screen === 'done') want = el.querySelector('[data-scr="done"] .fx-go');
      return want && items.indexOf(want) >= 0 ? want : items[0];
    }
    function padPress() {
      const n = padEl;
      if (!n) { padMark(padStart(padItems())); return; }
      if (n.tagName === 'INPUT') { S.last = n; n.focus({ preventScroll: true }); showKb(n); padMark(padStart(padItems())); return; }
      if (n.closest('.tl-kb')) { const k = n.dataset.k; type(k); if (k === 'hide' || k === 'enter') padMark(padStart(padItems())); return; }
      downAt = null; // a press, not a finger that slid
      n.click();
      later(30, () => { if (!padEl || padItems().indexOf(padEl) < 0) padMark(padStart(padItems())); });
    }
    function pad(act) {
      if (!S.open) return;
      if (!S.pad) { S.pad = true; kbModes(); }
      const kb = !V.kb.hidden;
      if (act === 'up') padMove(0, -1); else if (act === 'down') padMove(0, 1); else if (act === 'left') padMove(-1, 0); else if (act === 'right') padMove(1, 0);
      else if (act === 'a') padPress();
      else if (act === 'b') { if (kb) type('back'); else action('leave'); }
      else if (act === 'x') { if (kb) type(' '); }
      else if (act === 'y') { if (kb) { hideKb(); padMark(padStart(padItems())); } else askAgain(); }
      else if (act === 'rt') {
        if (kb && S.focus) {
          const f = S.focus;
          enterOn(f);
          if (f.dataset.f === 'qty' || (WHO.includes(f.dataset.f) && S.screen !== 'who')) S.last = null; // on to the next part number, or the results
          later(30, () => padMark(padStart(padItems())));
        } else if (padEl) padPress();
      }
      else if (act === 'lb' || act === 'rb' || act === 'tabL' || act === 'tabR') { setTab(act === 'lb' || act === 'tabL' ? 'fusion' : 'crashfix'); padMark(padStart(padItems())); }
      if (padEl && padItems().indexOf(padEl) < 0) padMark(padStart(padItems()));
    }

    /* ---------- what game.js uses ---------- */
    function reset() {
      stopTimers();
      clearWho(); S.results = []; S.sel = -1; S.ksel = -1;
      F.part.value = ''; F.qty.value = '';
      V.modal.hidden = true;
      V.drawer.hidden = true; V.drawer.classList.remove('open', 'shut');
      show('who');
      renderBasket();
    }
    // the customer gives their details once you're at the till: surname first, then postcode (detailedfoil, 21 Nov 2026)
    function begin() {
      const s = S.session;
      if (!s || s.stage !== 'arrived') return;
      s.stage = 'details';
      later(700, () => say("Surname's " + s.cust.surname + '.'));
      later(2100, () => say("Postcode's " + s.cust.postcode + '.'));
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
      close() { if (!S.open) return; S.open = false; hideKb(); padMark(null); el.hidden = true; },
      // a controller's button (up, down, left, right, a, b, x, y, rt, lb, rb); usePad(false) when it's put down
      pad,
      usePad(on) { if (S.pad === !!on) return; S.pad = !!on; if (!on) { padMark(null); hideKb(); } kbModes(); },
      // a till customer has walked up: cust from Till.makeCustomer, lines from Till.makeOrder
      // opts: kind ('till' or 'kiosk'), kiosk (Till.makeKiosk: today's kiosk orders), pay (Till.payment)
      serve(cust, lines, colour, opts) {
        opts = opts || {};
        S.session = null; // so the old customer's basket isn't what gets drawn
        reset();
        const kind = opts.kind === 'kiosk' ? 'kiosk' : 'till';
        S.session = { cust, lines: kind === 'kiosk' ? [] : lines.map((l) => Object.assign({}, l, { done: false, shown: null, wrong: null, asked: 0, clued: false })), cur: 0, stage: 'arrived', selected: false, basket: [], slips: 0, ready: false, since: Date.now(), colour,
          kind, kiosk: opts.kiosk || null, pay: opts.pay || { how: 'card', say: 'Card, please.' }, dayCust: opts.dayCust || null };
        renderSay();
        say(opts.hello || (kind === 'kiosk' ? pick(['Morning! Can you sort my order out?', 'Hiya, I need to pay for an order.', 'Alright? Got an order to pay for.', 'Hello, can you put my order through?'])
          : pick(['Morning! Can I order a few bits?', "Hiya, I'd like to order some stuff.", 'Alright? Need to order a couple of things.', "Hello, I'd like to place an order.", 'Can I order some bits, please?'])));
        if (S.open) begin();
      },
      // the customer's gone (handed over or skipped)
      clear() { S.session = null; reset(); renderSay(); },
      // nobody to serve: the last order finished at this till, and where it's got to
      showDone(no, text) {
        if (S.session) return;
        V.orderno.textContent = no; V.donetext.textContent = text || '';
        V.modal.hidden = true;
        show('done');
      },
      stage: () => (S.session ? S.session.stage : 'none'),
      session: () => S.session,
      preload: loadProducts,
      refresh: renderSay,
      say,
      // tests and playthroughs
      debug: { S, F, P, search, select, addLine, goPay, payCard, payCash, drTake, drBack, drStart, drGive, setTab, doSearch, type, action, openKiosk, kioskSelect }
    };
  }

  window.ShiftTillUI = { create };
})();
