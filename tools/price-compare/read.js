/* Price Compare: reads one product's price from a store's web page, as jina (r.jina.ai) hands it back.
   Shared by the page (window.PriceRead, for "Check now") and the twice-daily GitHub check
   (.github/price-compare/check.mjs, which loads this file with Node's vm), so both read pages the same way.

   jobs(list, group) -> every store for every product in data/compare.json (one group, or all):
     [{key, item, store, entry, urls, none}]. none: why that store has no price (shown on the page, never read).
   text(page, job) -> {ok: true, price, was, name, how} | {ok: false, why, name, gone}
     page: jina's normal read (markdown, starting "Title: ..."). The price is the first one after the product's
     heading that isn't a per-metre, finance, delivery or was price. Copper pipe carries 20% VAT, so when two prices
     sit together and one is 1.2 times the other, the bigger one includes VAT. Otherwise the label next to it says
     (Inc / Ex VAT), and an unlabelled price is taken as including VAT (store.vat: 'ex' says otherwise).
     gone: the store says the page doesn't exist (404), so the next address in the list is worth trying.
   html(page, job) -> the same, from the whole page (jina's X-Return-Format: html, or the page fetched directly):
     the product data built into the page (JSON-LD), the price meta tags, or, for a page where you pick a size
     first (entry.options), that size's own price in the page's option data. Then the page's text as a last go.
     JSON-LD prices are taken as including VAT unless the data says otherwise or store.ld is 'ex'.
   nameOk(name, job) -> '' or why the page isn't this product (another size, a pack of 10, chrome...).
   unitPrice(price, job) -> the price per metre, for ranking (an entry can have its own len, or a pack count).
   All prices are numbers in pounds, including VAT, rounded to the penny. */
(function (root) {
  'use strict';
  var VERSION = '2026-10-26a';
  var VAT = 1.2;
  var NEAR = 0.0105;          // a price with VAT is the price without VAT x 1.2, give or take rounding to the penny

  /* ---------- bits and pieces ---------- */

  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', times: '×', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', reg: '®', trade: '™', deg: '°', frac12: '½' };
  function decode(s) {
    return String(s == null ? '' : s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, function (all, e) {
      if (e.charAt(0) === '#') {
        var n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return isFinite(n) && n > 0 ? String.fromCodePoint(n) : all; } catch (x) { return all; }
      }
      var v = NAMED[e.toLowerCase()];
      return v == null ? all : v;
    });
  }
  function squash(s) { return String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim(); }
  function r2(v) { return Math.round(v * 100 + 1e-7) / 100; }
  function short(s) { s = squash(s); return s.length > 70 ? s.slice(0, 67) + '...' : s; }
  function clean(s) { return squash(decode(String(s || '').replace(/<[^>]+>/g, ' ').replace(/[*_`]+/g, ''))); }
  function money(v) { return '£' + Number(v).toFixed(2); }
  function fail(why, extra) {
    var r = { ok: false, why: why };
    for (var k in extra || {}) r[k] = extra[k];
    return r;
  }

  function links(entry) {
    if (!entry || !entry.url) return [];
    return Array.isArray(entry.url) ? entry.url.slice() : [entry.url];
  }

  function jobs(list, group) {
    var out = [];
    (list.items || []).forEach(function (item) {
      if (group && item.group !== group) return;
      (list.stores || []).forEach(function (store) {
        var entry = (item.at || {})[store.id] || {};
        out.push({ key: item.id + '/' + store.id, item: item, store: store, entry: entry, urls: links(entry), none: entry.none || store.none || (links(entry).length ? '' : 'Not found on their website') });
      });
    });
    return out;
  }

  function unitPrice(price, job) {
    var e = (job && job.entry) || {}, len = e.len || (job && job.item && job.item.len) || 1;
    return price / (len * (e.pack || 1));
  }

  /* "3" -> matches 3m, 3 m, 3mtr, 3 metre, 3000mm but not 3mm or 13m */
  function lenRe(len) {
    var l = String(len).replace('.', '\\.'), mm = Math.round(len * 1000);
    return new RegExp('(?:^|[^\\d.])' + l + '\\s?(?:m|mtrs?|metres?|meters?)\\b|(?:^|[^\\d.])' + mm + '\\s?mm\\b', 'i');
  }

  function nameOk(name, job) {
    var n = squash(decode(name)).toLowerCase(), item = job.item || {}, entry = job.entry || {};
    if (!n) return 'no product name on the page';
    var has = entry.has || item.has || [];
    for (var i = 0; i < has.length; i++) if (!new RegExp(has[i], 'i').test(n)) return 'a different product ("' + short(name) + '")';
    var len = entry.len || item.len;
    if (len && !entry.options && !lenRe(len).test(n)) return 'a different length ("' + short(name) + '")';
    var not = entry.not != null ? entry.not : item.not;
    if (not && new RegExp(not, 'i').test(n)) return 'a different product ("' + short(name) + '")';
    return '';
  }

  /* why a page isn't a product page at all: the store's bot check, or an error page */
  var BOT = /just a moment|attention required|access denied|are you (?:a )?(?:human|robot)|verify (?:that )?you(?:'re| are) (?:a )?human|human verification|captcha|request unsuccessful|incapsula|pardon our interruption|bot (?:check|detection|protection)|unusual traffic|security check|checking your browser|enable javascript and cookies to continue|error 1020|403 forbidden|request blocked|you have been blocked/i;
  function blocked(page, isHtml) {
    var s = String(page || '');
    var err = /Target URL returned error (\d{3})/i.exec(s.slice(0, 2000));
    if (err) {
      if (err[1] === '404' || err[1] === '410') return { why: 'the store says the page has gone (' + err[1] + ')', gone: true };
      if (/^(403|405|429)$/.test(err[1])) return { why: "the store's bot check (error " + err[1] + ')' };
      return { why: "the store's site answered with error " + err[1] };
    }
    var title, start;
    if (isHtml) {
      title = clean((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s) || [])[1] || '');
      start = clean(s.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')).slice(0, 1500);
    } else {
      title = squash((/^Title:\s*(.*)$/m.exec(s) || [])[1] || '');
      var at = s.search(/^Markdown Content:/m);
      start = squash(s.slice(at < 0 ? 0 : at, (at < 0 ? 0 : at) + 1500));
    }
    if (BOT.test(title) || (BOT.test(start) && start.length < 1400)) return { why: "the store's bot check" };
    if (/^(?:404|page not found|not found|oops)/i.test(title) || /\b(?:page|product) (?:not found|cannot be found|could not be found|no longer available)\b/i.test(title)) return { why: 'the store says the page has gone', gone: true };
    if (squash(s).length < 80) return { why: 'an empty page' };
    return null;
  }

  /* ---------- the price in a page's text ---------- */

  var PRICE = /£\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?!\d)/g;
  // just before a price: a was price, a saving, finance, a delivery or spend threshold
  var SKIP_BEFORE = /(?:\bwas|\brrp|\bsave|\bsaving|\bfrom|\bover|\bunder|\bspend|\borders?|\bdelivery|\bdelivered|\bklarna|\bpaypal|\bclearpay|\bpay\b|\bpayments?|\binstal\w*|\bdeposit|\bcredit|\bvoucher|\bgift|\bearn|\bpoints?|\breward\w*|\bfree\b|\bminimum|\bmin\.?|\bplus|\bextra|\bsub-?total|\btotal|\bbasket|\btrolley|\bcart|\bfinance)\b[^£\d]{0,14}$/i;
  // just after a price: per metre, a saving, finance
  var SKIP_AFTER = /^\s*(?:\(?\s*(?:per|\/|a)\s*(?:m|metre|meter|mtr|lin(?:ear)?\.?\s*m)\b|p\/m\b|off\b|delivery|to spend|or more|(?:a|per|\/)\s*(?:month|mo)\b|monthly|x\s*\d|interest|deposit|when you spend|in (?:points|rewards))/i;
  var INC = /\b(?:inc(?:l(?:uding|usive)?)?\.?\s*(?:of\s*)?vat|vat\s*inc(?:l(?:uded|usive)?)?\.?)(?![a-z])/i;
  var EX = /\b(?:ex(?:c(?:l(?:uding|usive)?)?)?\.?\s*(?:of\s*)?vat|vat\s*ex(?:c(?:l(?:uded|usive)?)?)?\.?)(?![a-z])|\+\s*vat\b/i;
  var RELATED = /^[ \t]*(?:#+[ \t]*)?(?:you (?:may|might) also|related products|customers (?:also|who)|frequently bought|people also|similar products|recently viewed|alternative products|complete the job|accessories|other (?:customers|people)|compare similar|more from)/im;

  // a short line of its own just above a price, labelling it ("Was" / "Save" on one line, the price on the next)
  var WAS_LINE = /^(?:was|rrp|previously|before)\b[^£\d]{0,12}$/i;
  var OTHER_LINE = /^(?:save|saving|you save|from|pay|delivery|spend|finance)\b[^£\d]{0,12}$/i;

  function candidates(region) {
    var out = [], m;
    PRICE.lastIndex = 0;
    while ((m = PRICE.exec(region))) {
      var v = Number(m[1].replace(/,/g, '') + '.' + (m[2] || '00'));
      var end = PRICE.lastIndex, nextPound = region.indexOf('£', end);
      var before = region.slice(Math.max(0, m.index - 40), m.index);
      // what's on the price's own line before it, and a short line just above (a label on a line of its own)
      var lines = region.slice(Math.max(0, m.index - 120), m.index).split('\n');
      var line = lines.pop(), above = '';
      while (lines.length && !above) { var l = lines.pop().trim(); if (l) above = l; else if (lines.length && !lines[lines.length - 1].trim()) break; }
      if (above.length > 24 || /£/.test(above)) above = '';
      var after = region.slice(end, nextPound < 0 ? end + 45 : Math.min(end + 45, nextPound));
      var c = { at: m.index, end: end, v: v, skip: '', label: '' };
      if (!(v > 0)) c.skip = 'zero';
      else if (/~~$/.test(before) || /^~~/.test(after)) c.skip = 'was';          // ~~£33.00~~: struck through
      else if (/\b(?:was|rrp)\b[^£\d]{0,14}$/i.test(line) || (!line.trim() && WAS_LINE.test(above))) c.skip = 'was';
      else if (SKIP_BEFORE.test(line) || (!line.trim() && OTHER_LINE.test(above))) c.skip = 'other';
      else if (SKIP_AFTER.test(after)) c.skip = 'other';
      if (!c.skip) {
        var lb = /(?:inc(?:l(?:uding)?)?\.?\s*vat|ex(?:c(?:l(?:uding)?)?)?\.?\s*vat)\s*:?\s*$/i.exec(before.slice(-22));
        // a label straight after the price, unless it's on the same line as the next price ("£15.60 ex. VAT £13.00"
        // labels the £13.00)
        var labelNext = nextPound >= 0 && nextPound - end < 45 && !/\n/.test(region.slice(end, nextPound)) && /vat\s*:?\s*$/i.test(region.slice(end, nextPound));
        if (!labelNext && INC.test(after)) c.label = 'inc';
        else if (!labelNext && EX.test(after)) c.label = 'ex';
        else if (lb) c.label = /^inc/i.test(lb[0]) ? 'inc' : 'ex';
      }
      out.push(c);
    }
    return out;
  }

  /* the selling price among a region's prices -> {price, was, sure} or null. sure: the VAT basis was known (a pair or a
     label), not just assumed. */
  function pick(cands, vatDefault) {
    var c = cands.filter(function (x) { return !x.skip; });
    if (!c.length) return null;
    var first = c[0], next = c[1], inc = null, sure = true;
    if (next && next.at - first.end < 220) {
      if (Math.abs(next.v * VAT - first.v) < NEAR) inc = first.v;
      else if (Math.abs(first.v * VAT - next.v) < NEAR) inc = next.v;
    }
    if (inc == null) {
      if (first.label === 'inc') inc = first.v;
      else if (first.label === 'ex') inc = r2(first.v * VAT);
      else { inc = vatDefault === 'ex' ? r2(first.v * VAT) : first.v; sure = false; }
    }
    // a was price near it (in the same terms: if the selling price was worked out from a price without VAT, so is this)
    var worked = inc !== first.v && !(next && inc === next.v), was = null;
    cands.forEach(function (x) {
      if (x.skip === 'was' && was == null && Math.abs(x.at - first.at) < 260) {
        var w = worked ? r2(x.v * VAT) : x.v;
        if (w > inc && w < inc * 3) was = w;
      }
    });
    return { price: r2(inc), was: was, sure: sure };
  }

  function sane(r, job) {
    if (!r.ok) return r;
    var range = (job.item && job.item.perM) || [0, Infinity], u = unitPrice(r.price, job);
    if (!(u >= range[0] && u <= range[1])) return fail(money(r.price) + " doesn't look like this product's price", { name: r.name, seen: r.price });
    return r;
  }

  function text(page, job) {
    var raw = String(page || '').replace(/\r/g, '');
    var bad = blocked(raw, false);
    if (bad) return fail(bad.why, { gone: !!bad.gone });
    var title = squash(decode((/^Title:\s*(.*)$/m.exec(raw) || [])[1] || ''));
    var md = decode(raw.replace(/^(?:Title|URL Source|Published Time|Markdown Content|Warning|Number of Pages):.*$/gm, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\\([\\`*_{}\[\]()#+\-.!|>~])/g, '$1'));
    var heads = [], m, re = /^(#{1,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
    while ((m = re.exec(md))) heads.push({ at: m.index, end: re.lastIndex, level: m[1].length, text: clean(m[2]) });
    var re2 = /^([^\n#][^\n]{3,200})\n=+[ \t]*$/gm;
    while ((m = re2.exec(md))) heads.push({ at: m.index, end: re2.lastIndex, level: 1, text: clean(m[1]) });
    heads.sort(function (a, b) { return a.at - b.at; });
    var head = null;
    for (var i = 0; i < heads.length && !head; i++) if (!nameOk(heads[i].text, job)) head = heads[i];
    var name = head ? head.text : title;
    if (!head && nameOk(title, job)) {
      // say what the page is instead: its main heading if it has one, else its title
      var h1 = heads.filter(function (h) { return h.level === 1; })[0];
      var shown = h1 ? h1.text : title;
      return fail(shown ? nameOk(shown, job) : 'no product name on the page', { name: shown });
    }
    var from = head ? head.end : Math.max(0, md.search(/\S/));
    var tail = md.slice(from, from + 6000);
    var rel = tail.search(RELATED);
    if (rel >= 0) tail = tail.slice(0, rel);
    var nextHead = tail.search(/^#{1,2}[ \t]/m);
    var vatDefault = (job.store && job.store.vat) || 'inc';
    // the product's own block (up to the next main heading) first; past that only a price that says what it is
    var got = pick(candidates(nextHead >= 0 ? tail.slice(0, nextHead) : tail), vatDefault);
    if (!got && nextHead >= 0) {
      got = pick(candidates(tail.slice(0, 2500)), vatDefault);
      if (got && !got.sure) got = null;
    }
    if (!got) return fail('no price on the page', { name: name });
    return sane({ ok: true, price: got.price, was: got.was, name: name, how: 'text', sure: got.sure }, job);
  }

  /* ---------- the price in a whole page (html) ---------- */

  function ldProducts(html) {
    var out = [], re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi, m;
    function offerPrice(o) {
      if (!o || typeof o !== 'object') return null;
      var specs = [].concat(o.priceSpecification || []);
      for (var i = 0; i < specs.length; i++) {
        var s = specs[i];
        if (s && s.price != null && isFinite(Number(s.price)) && !/StrikethroughPrice|ListPrice/i.test(String(s.priceType || ''))) return { price: Number(s.price), vat: s.valueAddedTaxIncluded };
      }
      var p = o.price != null ? o.price : o.lowPrice;
      if (p != null && isFinite(Number(String(p).replace(/[£,]/g, '')))) return { price: Number(String(p).replace(/[£,]/g, '')), vat: undefined };
      return null;
    }
    function walk(n, depth) {
      if (!n || typeof n !== 'object' || depth > 10) return;
      if (Array.isArray(n)) { n.forEach(function (x) { walk(x, depth + 1); }); return; }
      if (/Product/i.test([].concat(n['@type'] || []).join(' '))) {
        [].concat(n.offers || []).forEach(function (o) {
          var p = offerPrice(o);
          if (p && p.price > 0) out.push({ name: clean(n.name || ''), sku: String(n.sku || n.mpn || n.productID || ''), price: p.price, vat: p.vat === false || p.vat === 'false' ? false : p.vat === true || p.vat === 'true' ? true : null });
        });
      }
      for (var k in n) if (n[k] && typeof n[k] === 'object') walk(n[k], depth + 1);
    }
    while ((m = re.exec(html))) {
      var body = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
      try { walk(JSON.parse(body), 0); } catch (e) {
        try { walk(JSON.parse(body.replace(/[\u0000-\u001f]+/g, ' ')), 0); } catch (e2) { /* not valid JSON */ }
      }
    }
    return out;
  }

  function metaPrice(html) {
    var res = [/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:product|og):price:amount["'][^>]*content\s*=\s*["']([\d.,]+)["']/i,
               /<meta\b[^>]*content\s*=\s*["']([\d.,]+)["'][^>]*(?:property|name)\s*=\s*["'](?:product|og):price:amount["']/i,
               /<[a-z]+\b[^>]*itemprop\s*=\s*["']price["'][^>]*content\s*=\s*["']([\d.,]+)["']/i,
               /<[a-z]+\b[^>]*content\s*=\s*["']([\d.,]+)["'][^>]*itemprop\s*=\s*["']price["']/i];
    for (var i = 0; i < res.length; i++) {
      var m = res[i].exec(html);
      if (m) { var v = Number(m[1].replace(/,/g, '')); if (v > 0) return v; }
    }
    return null;
  }

  /* one JSON object in a page, found by its key ("jsonConfig": {...}), braces counted so nested ones are kept */
  function grabJSON(s, key) {
    var i = s.indexOf('"' + key + '"');
    while (i >= 0) {
      var j = s.indexOf('{', i);
      if (j < 0) return null;
      if (/^\s*:\s*$/.test(s.slice(i + key.length + 2, j))) {
        var depth = 0, inStr = false, esc = false;
        for (var k = j; k < s.length && k < j + 3e6; k++) {
          var c = s.charAt(k);
          if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
          if (c === '"') inStr = true;
          else if (c === '{') depth++;
          else if (c === '}' && !--depth) { try { return JSON.parse(s.slice(j, k + 1)); } catch (e) { break; } }
        }
      }
      i = s.indexOf('"' + key + '"', i + 1);
    }
    return null;
  }

  /* a page where you pick a size first (Magento's option data): the price of the product with every option asked for */
  function optionPrice(html, want, job) {
    var cfg = grabJSON(html, 'jsonConfig') || grabJSON(html, 'spConfig');
    if (!cfg || !cfg.attributes) return fail('no size options found on the page');
    var norm = function (s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9.]+/g, ''); };
    var attrs = Object.keys(cfg.attributes).map(function (k) { return cfg.attributes[k]; }), ids = null;
    for (var label in want) {
      var a = attrs.filter(function (x) { return norm(x.label) === norm(label) || norm(x.code) === norm(label); })[0];
      if (!a) return fail('no "' + label + '" choice on the page');
      var o = (a.options || []).filter(function (x) { return norm(x.label) === norm(want[label]); })[0];
      if (!o) return fail(want[label] + " isn't one of the " + label.toLowerCase() + ' choices');
      var ps = (o.products || []).map(String);
      ids = ids ? ids.filter(function (x) { return ps.indexOf(x) >= 0; }) : ps;
    }
    if (!ids || !ids.length) return fail("that size isn't on sale");
    var p = cfg.optionPrices && cfg.optionPrices[ids[0]];
    var amount = function (x) { return x && x.amount != null && isFinite(Number(x.amount)) ? Number(x.amount) : null; };
    var fin = p && amount(p.finalPrice), base = p && amount(p.basePrice), old = p && amount(p.oldPrice);
    if (fin == null) return fail('no price for that size');
    var exOnly = (job.store && job.store.vat === 'ex') && !(base != null && Math.abs(base * VAT - fin) < NEAR);
    var price = exOnly ? r2(fin * VAT) : r2(fin);
    var was = old != null && old > fin + 0.005 ? r2(exOnly ? old * VAT : old) : null;
    return { ok: true, price: price, was: was };
  }

  /* a whole page as rough markdown (headings kept), so the text reader can have a go at a page fetched directly */
  function pageText(html) {
    var s = String(html || '').replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, function (a, x) { return '\n\n# ' + clean(x) + '\n\n'; })
      .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, function (a, x) { return '\n\n## ' + clean(x) + '\n\n'; })
      .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/?(?:p|div|li|ul|ol|tr|td|th|table|section|article|header|footer|main|aside|nav|h[3-6]|dd|dt|dl|form|label|button|span)\b[^>]*>/gi, function (t) { return /^<\/?span/i.test(t) ? ' ' : '\n'; })
      .replace(/<[^>]+>/g, '');
    return decode(s).split('\n').map(squash).filter(Boolean).join('\n');
  }

  function html(page, job) {
    var t = String(page || '');
    var bad = blocked(t, true);
    if (bad) return fail(bad.why, { gone: !!bad.gone });
    var entry = job.entry || {}, store = job.store || {};
    var title = clean((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(t) || [])[1] || '');
    var h1 = clean((/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(t) || [])[1] || '');
    var og = clean((/<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(t) || [])[1] || '');
    var names = [h1, og, title].filter(Boolean);
    var name = names.filter(function (n) { return !nameOk(n, job); })[0] || '';
    if (entry.options) {
      if (!name) return fail(nameOk(names[0] || '', job), { name: names[0] || '' });
      var o = optionPrice(t, entry.options, job);
      if (!o.ok) { o.name = name; return o; }
      return sane({ ok: true, price: o.price, was: o.was, name: name, how: 'options', sure: true }, job);
    }
    var lds = ldProducts(t).filter(function (p) { return p.name ? !nameOk(p.name, job) : !!name; });
    if (lds.length) {
      var p = lds[0], ex = p.vat === false || (p.vat == null && store.ld === 'ex');
      return sane({ ok: true, price: ex ? r2(p.price * VAT) : r2(p.price), was: null, name: p.name || name, how: 'data', sure: p.vat != null || !!store.ld }, job);
    }
    var meta = metaPrice(t);
    if (meta != null && name) return sane({ ok: true, price: store.ld === 'ex' ? r2(meta * VAT) : r2(meta), was: null, name: name, how: 'data', sure: !!store.ld }, job);
    var r = text('Title: ' + title + '\n\nMarkdown Content:\n' + pageText(t), job);
    if (r.ok) r.how = 'page';
    return r;
  }

  /* a Google search of one store's site for a product, for stores with no page to link to */
  function siteSearch(store, item) {
    return 'https://www.google.com/search?q=' + encodeURIComponent('site:' + store.site + ' ' + (item.q || item.name));
  }

  var api = { VERSION: VERSION, VAT: VAT, jobs: jobs, links: links, text: text, html: html, nameOk: nameOk, unitPrice: unitPrice, siteSearch: siteSearch, decode: decode, pageText: pageText };
  root.PriceRead = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
