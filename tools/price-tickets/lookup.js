/* Live Screwfix name + price lookup for the price ticket tool (and the A4 poster maker).
 *
 * A static site can't read screwfix.com directly (the browser blocks cross-site reads),
 * so this goes through free public CORS relays. They come and go, rate-limit bursts and
 * sometimes get turned away by Screwfix, so:
 *  - several are tried in turn, whichever worked last first, and ones that just failed last;
 *  - requests are spaced out a little so adding a list of codes doesn't trip rate limits;
 *  - if every relay fails, the whole lot is tried again a couple of times before giving up;
 *  - every attempt is recorded (result.trace), and diagnose() tests each relay on demand,
 *    so a failure can be explained instead of guessed at.
 */
(function (root) {
  'use strict';

  var PROXIES = [
    { id: 'codetabs',   build: function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); } },
    { id: 'cors.lol',   build: function (u) { return 'https://api.cors.lol/?url=' + encodeURIComponent(u); } },
    { id: 'allorigins', build: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); } },
    { id: 'jina',       build: function (u) { return 'https://r.jina.ai/' + u; } },
    { id: 'corsproxy',  build: function (u) { return 'https://corsproxy.io/?url=' + encodeURIComponent(u); } }
  ];
  var ORDER_KEY = 'pt-proxy-order-v1';
  var TIMEOUT = 10000;
  var GAP = 400;                         // at least this long between relay requests (bursts get rate-limited)
  var RETRY_AFTER = [2500, 8000];        // when every relay fails: wait, then try again (twice)

  function productUrl(code) { return 'https://www.screwfix.com/p/product/' + String(code).toLowerCase(); }
  function now() { return Date.now(); }
  function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  /* Relays that just failed are tried after the others for a while (only the order changes). */
  var cool = {};
  var COOL_FOR = { network: 600000, timeout: 60000, limited: 90000, refused: 60000, other: 30000 };
  function coolDown(id, outcome) {
    var kind = outcome === 'network' || outcome === 'timeout' ? outcome
             : /^http-429$|^limited$/.test(outcome) ? 'limited'
             : /^http-|^denied$/.test(outcome) ? 'refused' : 'other';
    cool[id] = now() + COOL_FOR[kind];
  }

  function proxyOrder() {
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch (e) { saved = []; }
    var byId = {};
    PROXIES.forEach(function (p) { byId[p.id] = p; });
    var out = [];
    saved.forEach(function (id) { if (byId[id] && out.indexOf(byId[id]) < 0) out.push(byId[id]); });
    PROXIES.forEach(function (p) { if (out.indexOf(p) < 0) out.push(p); });
    var t = now();
    return out.filter(function (p) { return !(cool[p.id] > t); }).concat(out.filter(function (p) { return cool[p.id] > t; }));
  }

  function promote(id) {
    delete cool[id];
    var ids = proxyOrder().map(function (p) { return p.id; }).filter(function (x) { return x !== id; });
    ids.unshift(id);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch (e) { /* private mode */ }
  }

  /* Space relay requests out (shared with the poster maker's photo fetches). */
  var nextSlot = 0;
  function slot() {
    var t = now(), at = Math.max(t, nextSlot);
    nextSlot = at + GAP;
    return at > t ? wait(at - t) : Promise.resolve();
  }

  /* -> {status, text}; rejects with {kind: 'timeout' | 'network'} when no answer came back */
  function fetchText(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; if (ctrl) ctrl.abort(); }, TIMEOUT);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store', credentials: 'omit' })
      .then(function (res) {
        return res.text().then(function (text) { return { status: res.status, text: text }; });
      })
      .catch(function () { throw { kind: timedOut ? 'timeout' : 'network' }; })
      .finally(function () { clearTimeout(timer); });
  }

  /* ---------- parsing ---------- */

  function decodeEntities(s) {
    if (!s || s.indexOf('&') < 0) return s || '';
    var ta = document.createElement('textarea');
    ta.innerHTML = s;
    return ta.value;
  }

  function squash(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function stripSite(s) { return squash(s).replace(/\s*[-|–—]\s*Screwfix(\.com)?\s*$/i, ''); }

  function cleanName(s, code) {
    s = squash(decodeEntities(s)).replace(/^["'“‘]+|["'”’]+$/g, '');
    s = s.replace(new RegExp('\\s*\\(\\s*' + code + '\\s*\\)\\s*$', 'i'), '');
    return squash(s);
  }

  function normPrice(v) {
    if (v == null) return null;
    var m = String(v).replace(/[£\s]/g, '').match(/^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/);
    if (!m) return null;
    var n = parseFloat(m[1].replace(/,/g, '') + '.' + (m[2] || '0'));
    if (!isFinite(n) || n <= 0) return null;
    return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* The selling price shown next to the heading: "£28.99 Inc Vat". Skips ex-VAT, was and multi-buy prices. */
  function priceMatch(text, from) {
    var re = /£\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})/g, m, best = null, loose = null;
    while ((m = re.exec(text))) {
      var after = text.slice(re.lastIndex, re.lastIndex + 14).toLowerCase();
      var before = text.slice(Math.max(0, m.index - 16), m.index).toLowerCase();
      var incVat = /^\s*inc\.?\s*vat/.test(after);
      var skip = /ex\.?\s*vat/.test(after) || /(was|save|saving|from|buy \d+|rrp)\s*:?\s*$/.test(before) || /^\s*(each when|per item when|when you buy)/.test(after);
      if (incVat && m.index >= from) { best = m; break; }
      if (incVat && !best) best = m;
      if (!skip && !loose && m.index >= from) loose = m;
    }
    return best || loose;
  }

  function priceFromText(text, from) {
    var hit = priceMatch(text, from);
    return hit ? normPrice(hit[1] + '.' + hit[2]) : null;
  }

  /* On offer, Screwfix prints the old price with the selling one: "Save-33% £19.99 Inc Vat Was £29.99".
     Only the text right next to the selling price counts, so other products' offers further down the page don't. */
  function wasFromText(text, hit) {
    if (!hit) return null;
    var re = /was\s*:?\s*£\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/i;   // "Inc VatWas £29.99" too
    // nothing but "Inc Vat" (and maybe the ex-VAT price) may sit between the two prices
    var close = function (gap) {
      gap = gap.replace(/£\s?[\d,]+(?:\.\d{2})?\s*ex\.?\s*vat/gi, ' ').replace(/inc\.?\s*vat|now|\s+/gi, ' ');
      return gap.indexOf('£') < 0 && gap.trim().length <= 12;
    };
    var end = hit.index + hit[0].length, after = text.slice(end, end + 120), m = after.match(re);
    if (m && close(after.slice(0, m.index))) return normPrice(m[1] + '.' + (m[2] || '00'));
    var before = text.slice(Math.max(0, hit.index - 80), hit.index), all = [], r2 = new RegExp(re.source, 'gi'), x;
    while ((x = r2.exec(before))) all.push(x);
    m = all[all.length - 1];
    if (m && close(before.slice(m.index + m[0].length))) return normPrice(m[1] + '.' + (m[2] || '00'));
    return null;
  }

  function pounds(p) { return parseFloat(String(p).replace(/[£,]/g, '')); }

  function findProduct(node, out, depth) {
    if (!node || typeof node !== 'object' || depth > 8) return;
    if (Array.isArray(node)) { node.forEach(function (n) { findProduct(n, out, depth + 1); }); return; }
    var type = [].concat(node['@type'] || []).join(' ');
    if (/Product/i.test(type)) {
      if (!out.name && node.name) out.name = String(node.name);
      if (!out.sku) out.sku = String(node.sku || node.productID || node.mpn || '');
      [].concat(node.offers || []).forEach(function (o) {
        if (!o || out.price != null) return;
        var p = o.price != null ? o.price : (o.lowPrice != null ? o.lowPrice : (o.priceSpecification && o.priceSpecification.price));
        if (p != null) out.price = String(p);
      });
    }
    for (var k in node) if (node[k] && typeof node[k] === 'object') findProduct(node[k], out, depth + 1);
  }

  var BLOCKED = /access denied|just a moment|attention required|are you a robot|captcha|request blocked|forbidden|too many requests|rate limit|bad gateway|service unavailable|gateway time-?out|cloudflare|error code/i;
  var MISSING = /page not found|can.t find (that|the) page|no results for|couldn.t find any|0 results|sorry,? we couldn.t|product (is )?no longer available/i;
  var GENERIC = /^(screwfix(\.com)?|home|search( results)?|basket|menu)\b/i;
  // Age-restricted (18+) products. Screwfix shows, in red under the heading: "We operate a Challenge 25 policy
  // in all our stores and may be asked for proof of age upon collection. You must be 18 years old or over to buy
  // this product." The words "Challenge 25" alone are enough, so a change of wording still gets picked up.
  // ("18V" drills and the "18th Edition" footer link don't count.)
  var AGE = /challenge[\s -]*25(?!\d)|proof\s+of\s+age|\b(?:18|eighteen)\s*(?:years?|yrs?)\s*(?:old\s*|of\s+age\s*)?or\s+(?:over|older|above)\b|\baged\s+(?:18|eighteen)\s*(?:\+|or\s+(?:over|older|above)\b)/i;
  var BLOCK_TAGS = 'address,article,aside,blockquote,br,button,dd,div,dl,dt,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hr,label,li,main,nav,ol,option,p,pre,section,table,td,th,tr,ul';

  function decide(p, code) {
    var codeRe = new RegExp('(^|[^A-Z0-9])' + code + '($|[^A-Z0-9])', 'i');
    var heading = [p.h1, p.og, p.title, p.sku].join(' ');
    var mentions = codeRe.test(heading) || new RegExp('\\(\\s*' + code + '\\s*\\)', 'i').test(p.text);
    var screwfix = /screwfix/i.test(p.title + ' ' + p.og + ' ' + p.text.slice(0, 20000));
    var name = [cleanName(p.h1, code), cleanName(stripSite(p.og), code), cleanName(p.ldName, code), cleanName(stripSite(p.title), code)]
      .filter(function (n) { return n && !GENERIC.test(n); })[0] || '';

    var anchor = 0;
    if (p.h1) {
      var at = p.text.indexOf(squash(p.h1).slice(0, 30));
      if (at >= 0) anchor = at;
    }
    var hit = priceMatch(p.text, anchor);
    var price = (hit ? normPrice(hit[1] + '.' + hit[2]) : null) || normPrice(p.ldPrice) || normPrice(p.itemPrice);
    var age = AGE.test(p.text);
    // on offer: the old price (only the poster maker uses it)
    var was = price && hit ? wasFromText(p.text, hit) : null;
    if (was && !(pounds(was) > pounds(price))) was = null;
    var sale = function (r) { if (was) r.was = was; return r; };

    if (BLOCKED.test(p.title) || BLOCKED.test(p.h1)) {
      var head = p.title + ' ' + p.h1;
      return { status: 'blocked', why: p.status === 429 || /too many requests|rate limit/i.test(head) ? 'limited'
                                      : /bad gateway|service unavailable|gateway time-?out|error code/i.test(head) ? 'relay-error' : 'denied' };
    }
    if (!screwfix && !mentions) return { status: 'blocked', why: 'other' };
    if (p.status === 404 || MISSING.test(p.title + ' ' + p.h1) || (!mentions && !price)) return { status: 'notfound' };
    if (!mentions && price) return sale({ status: 'found', name: name, price: price, age: age, unsure: true });
    if (!price || !name) return sale({ status: 'partial', name: name || '', price: price || '', age: age });
    return sale({ status: 'found', name: name, price: price, age: age });
  }

  /* Product photo ids on the page (872RE_P, 872RE_A1, ...), main photo first. Used by the A4 poster maker. */
  function photoIds(text, code) {
    var re = new RegExp('media\\.screwfix\\.com/is/image/ae235/(' + code + '_[A-Z0-9]+)', 'gi'), m, out = [];
    while ((m = re.exec(text))) {
      var id = m[1].toUpperCase();
      if (out.indexOf(id) < 0) out.push(id);
    }
    out.sort(function (a, b) { return (b === code + '_P') - (a === code + '_P'); });
    return out;
  }

  function withPhotos(r, text, code) {
    if (r.status === 'found' || r.status === 'partial') r.images = photoIds(text, code);
    return r;
  }

  function parseHtml(html, code, status) {
    return withPhotos(parseHtmlPage(html, code, status), html, code);
  }

  function parseHtmlPage(html, code, status) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var meta = function (sel) { var el = doc.querySelector(sel); return el ? el.getAttribute('content') || '' : ''; };
    var ld = {};
    Array.prototype.forEach.call(doc.querySelectorAll('script[type="application/ld+json"]'), function (s) {
      try { findProduct(JSON.parse(s.textContent), ld, 0); } catch (e) { /* bad JSON */ }
    });
    var ip = doc.querySelector('[itemprop="price"]');
    var paren = new RegExp('\\(\\s*' + code + '\\s*\\)', 'i');
    var h1s = Array.prototype.map.call(doc.querySelectorAll('h1'), function (h) { return squash(h.textContent); }).filter(Boolean);
    var h1 = h1s.filter(function (t) { return paren.test(t); })[0] || h1s.filter(function (t) { return !GENERIC.test(t); })[0] || '';
    var p = {
      status: status,
      title: doc.title || '',
      og: meta('meta[property="og:title"]') || meta('meta[name="og:title"]'),
      h1: h1,
      ldName: ld.name || '',
      ldPrice: ld.price,
      sku: ld.sku || '',
      itemPrice: ip ? (ip.getAttribute('content') || ip.textContent) : null
    };
    Array.prototype.forEach.call(doc.querySelectorAll('script,style,noscript,template,svg'), function (n) { n.remove(); });
    // a space after each block element so words from neighbouring blocks don't run together
    // (inline spans are left alone, so "£28" + ".99" still reads as £28.99)
    if (doc.body) {
      Array.prototype.forEach.call(doc.body.querySelectorAll(BLOCK_TAGS), function (el) {
        if (el.parentNode) el.parentNode.insertBefore(doc.createTextNode(' '), el.nextSibling);
      });
    }
    p.text = squash((doc.body ? doc.body.textContent : '') || '');
    return decide(p, code);
  }

  /* Reader-style proxies (r.jina.ai) send back the page as plain text / markdown. */
  function parseText(text, code, status) {
    return withPhotos(parseTextPage(text, code, status), text, code);
  }

  function parseTextPage(text, code, status) {
    var err = text.match(/returned error (\d{3})/i);
    if (err && err[1] === '404') return { status: 'notfound' };
    var title = (text.match(/^Title:\s*(.+)$/m) || [])[1] || '';
    var md = text.replace(/^(Title|URL Source|Published Time|Markdown Content|Warning):.*$/gm, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\\([\\`*_{}\[\]()#+\-.!|>~])/g, '$1');
    var h1 = (md.match(/^#\s+(.+?)\s*#*\s*$/m) || md.match(/^(.+)\n=+\s*$/m) || [])[1] || '';
    var p = { status: status, title: decodeEntities(title), og: '', h1: squash(decodeEntities(h1)), ldName: '', ldPrice: null, sku: '', itemPrice: null };
    p.text = squash(decodeEntities(md.replace(/[*_`#>|]+/g, ' ')));
    if (err && !p.h1) return { status: 'blocked', why: 'http-' + err[1] };
    return decide(p, code);
  }

  function interpret(res, code) {
    var t = res.text || '';
    if (t.length < 40) return { status: 'blocked', why: res.status >= 400 ? 'http-' + res.status : 'other' };
    var head = t.slice(0, 4000);
    if (/^\s*[{[]/.test(head) && !/<html/i.test(head)) {          // JSON error from a proxy, or a wrapped page
      try {
        var j = JSON.parse(t);
        var inner = j && (j.contents || j.html || j.body || (j.data && j.data.content));
        if (typeof inner === 'string' && inner.length > 200) return interpret({ status: res.status, text: inner }, code);
      } catch (e) { /* not JSON */ }
      return { status: 'blocked', why: res.status === 429 ? 'http-429' : res.status >= 400 ? 'http-' + res.status : 'other' };
    }
    var isHtml = /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(head) || /<\/(div|span|h1|p)>/i.test(t.slice(0, 50000));
    return isHtml ? parseHtml(t, code, res.status) : parseText(t, code, res.status);
  }

  /* One relay, one go -> {via, outcome, ms, http, result}. outcome: found | partial | notfound | network (no answer:
     blocked by the network, offline or the relay is down) | timeout | limited | denied (Screwfix turned it away) |
     http-NNN (the relay answered with an error) | relay-error | other (something that isn't the product page) */
  function tryRelay(proxy, code) {
    var t0 = now();
    return slot().then(function () {
      t0 = now();
      return fetchText(proxy.build(productUrl(code)));
    }).then(function (res) {
      var r;
      try { r = interpret(res, code); } catch (e) { r = { status: 'blocked', why: 'other' }; }
      var outcome = r.status === 'blocked' ? (r.why || (res.status >= 400 ? 'http-' + res.status : 'other')) : r.status;
      if (outcome === 'http-429') outcome = 'limited';
      return { via: proxy.id, outcome: outcome, ms: now() - t0, http: res.status, result: r };
    }, function (e) {
      return { via: proxy.id, outcome: e && e.kind === 'timeout' ? 'timeout' : 'network', ms: now() - t0, http: 0, result: { status: 'blocked' } };
    });
  }

  function brief(t) {
    var r = t.result || {};
    return { via: t.via, outcome: t.outcome, ms: t.ms, http: t.http, round: t.round, price: r.price || '', name: r.name || '' };
  }

  /* -> Promise<{status: 'found'|'partial'|'notfound'|'blocked', name, price, age (Challenge 25), unsure, was, images, via,
                 reason, trace}>
     (was: the old price when it's on offer; images: the product photo ids on the page, main one first.
      Only the poster maker uses those two. reason, when blocked: 'network' if no relay could be reached at all,
      otherwise 'relays'. trace: every attempt, for working out why.)
     opts.onRetry(round): called before each extra round when every relay failed. */
  function lookup(code, opts) {
    opts = opts || {};
    code = String(code || '').toUpperCase();
    var trace = [], started = now();
    function finish(r) { r.trace = trace.map(brief); return r; }
    function round(n, only) {
      var order = proxyOrder().filter(function (p) { return !only || only.indexOf(p.id) >= 0; });
      var i = 0, partial = null, notFound = 0;
      function next() {
        if (i >= order.length || notFound >= 2) {
          if (partial) return finish(partial);
          if (notFound) return finish({ status: 'notfound' });
          var mine = trace.filter(function (t) { return t.round === n; });
          var noAnswer = mine.every(function (t) { return t.outcome === 'network'; });
          // try again shortly: relays that answered or timed out may well work next time; ones that couldn't be
          // reached at all get one more go (a blip), then aren't worth waiting for
          var again = mine.filter(function (t) { return t.outcome !== 'network' && !/^http-4(0[0-4]|10)$/.test(t.outcome); })
                          .map(function (t) { return t.via; });
          if (noAnswer && n === 0) again = mine.map(function (t) { return t.via; });
          if (n < RETRY_AFTER.length && again.length && now() - started < 45000) {
            if (opts.onRetry) { try { opts.onRetry(n + 1); } catch (e) { /* display only */ } }
            return wait(RETRY_AFTER[n]).then(function () { return round(n + 1, again); });
          }
          var everyone = trace.every(function (t) { return t.outcome === 'network'; });
          return finish({ status: 'blocked', reason: everyone ? 'network' : 'relays' });
        }
        var proxy = order[i++];
        return tryRelay(proxy, code).then(function (t) {
          t.round = n;
          trace.push(t);
          var r = t.result;
          r.via = proxy.id;
          if (r.status === 'found') { promote(proxy.id); return finish(r); }
          if (r.status === 'notfound') { notFound++; if (notFound === 1) promote(proxy.id); }
          else if (r.status === 'partial') { if (!partial) partial = r; }
          else coolDown(proxy.id, t.outcome);
          return next();
        });
      }
      return next();
    }
    return Promise.resolve().then(function () { return round(0, null); });
  }

  /* Text copied from a Screwfix product page (Ctrl+A, Ctrl+C on screwfix.com) -> the lookup result plus its code,
     or null if it isn't one. This works on any network, because the browser loaded the page itself. */
  var SKU_IN_BRACKETS = /\(\s*(\d{3}[A-Z]{2}|\d{4}[A-Z]|\d{5})\s*\)\s*$/i;
  function fromCopiedPage(text) {
    text = String(text || '');
    if (text.length < 30 || !/inc\.?\s*vat/i.test(text)) return null;
    var lines = text.split(/\r?\n/).map(squash).filter(Boolean), code = null, h1 = '';
    for (var i = 0; i < lines.length && !code; i++) {
      var m = lines[i].match(SKU_IN_BRACKETS);
      if (m && lines[i].length > m[0].length + 2) { code = m[1].toUpperCase(); h1 = lines[i]; }
    }
    if (!code) return null;
    var p = { status: 200, title: '', og: '', h1: h1, ldName: '', ldPrice: null, sku: '', itemPrice: null,
              text: squash(text) + (/screwfix/i.test(text) ? '' : ' Screwfix') };
    var r = decide(p, code);
    if (r.status !== 'found' && r.status !== 'partial') return null;
    r.code = code;
    r.via = 'copied page';
    return r;
  }

  /* Try every relay once for this code, whatever happens, -> Promise<[{via, outcome, ms, http, price, name}]>.
     For the "test the lookup" button: shows which relays work from this network right now. */
  function diagnose(code) {
    code = String(code || '').toUpperCase();
    var out = [];
    return PROXIES.reduce(function (p, proxy) {
      return p.then(function () {
        return tryRelay(proxy, code).then(function (t) {
          out.push(brief(t));
          if (t.result.status === 'found') promote(proxy.id);
        });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  root.ScrewfixLookup = { lookup: lookup, diagnose: diagnose, fromCopiedPage: fromCopiedPage, slot: slot,
                          productUrl: productUrl, interpret: interpret, normPrice: normPrice,
                          relays: PROXIES.map(function (p) { return p.id; }) };
})(this);
