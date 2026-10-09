/* Live Screwfix name + price lookup for the price ticket tool.
 *
 * A static site can't read screwfix.com directly (the browser blocks cross-site reads),
 * so this goes through free public CORS proxies. They come and go, so several are tried
 * in turn and whichever worked last is tried first next time.
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
  var TIMEOUT = 12000;

  function productUrl(code) { return 'https://www.screwfix.com/p/product/' + String(code).toLowerCase(); }

  function proxyOrder() {
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch (e) { saved = []; }
    var byId = {};
    PROXIES.forEach(function (p) { byId[p.id] = p; });
    var out = [];
    saved.forEach(function (id) { if (byId[id] && out.indexOf(byId[id]) < 0) out.push(byId[id]); });
    PROXIES.forEach(function (p) { if (out.indexOf(p) < 0) out.push(p); });
    return out;
  }

  function promote(id) {
    var ids = proxyOrder().map(function (p) { return p.id; }).filter(function (x) { return x !== id; });
    ids.unshift(id);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch (e) { /* private mode */ }
  }

  function fetchText(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store', credentials: 'omit' })
      .then(function (res) {
        return res.text().then(function (text) { return { status: res.status, text: text }; });
      })
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
  function priceFromText(text, from) {
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
    var hit = best || loose;
    return hit ? normPrice(hit[1] + '.' + hit[2]) : null;
  }

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
    var price = priceFromText(p.text, anchor) || normPrice(p.ldPrice) || normPrice(p.itemPrice);

    if (BLOCKED.test(p.title) || BLOCKED.test(p.h1) || (!screwfix && !mentions)) return { status: 'blocked' };
    if (p.status === 404 || MISSING.test(p.title + ' ' + p.h1) || (!mentions && !price)) return { status: 'notfound' };
    if (!mentions && price) return { status: 'found', name: name, price: price, unsure: true };
    if (!price || !name) return { status: 'partial', name: name || '', price: price || '' };
    return { status: 'found', name: name, price: price };
  }

  function parseHtml(html, code, status) {
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
    if (err && !p.h1) return { status: 'blocked' };
    return decide(p, code);
  }

  function interpret(res, code) {
    var t = res.text || '';
    if (t.length < 40) return { status: 'blocked' };
    var head = t.slice(0, 4000);
    if (/^\s*[{[]/.test(head) && !/<html/i.test(head)) {          // JSON error from a proxy, or a wrapped page
      try {
        var j = JSON.parse(t);
        var inner = j && (j.contents || j.html || j.body || (j.data && j.data.content));
        if (typeof inner === 'string' && inner.length > 200) return interpret({ status: res.status, text: inner }, code);
      } catch (e) { /* not JSON */ }
      return { status: 'blocked' };
    }
    var isHtml = /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(head) || /<\/(div|span|h1|p)>/i.test(t.slice(0, 50000));
    return isHtml ? parseHtml(t, code, res.status) : parseText(t, code, res.status);
  }

  /* -> Promise<{status: 'found'|'partial'|'notfound'|'blocked', name, price, unsure, via}> */
  function lookup(code) {
    code = String(code || '').toUpperCase();
    var order = proxyOrder(), i = 0, partial = null, notFound = 0;
    function next() {
      if (i >= order.length || notFound >= 2) {
        if (partial) return partial;
        return { status: notFound ? 'notfound' : 'blocked' };
      }
      var proxy = order[i++];
      return fetchText(proxy.build(productUrl(code))).then(function (res) {
        var r = interpret(res, code);
        r.via = proxy.id;
        if (r.status === 'found') { promote(proxy.id); return r; }
        if (r.status === 'notfound') { notFound++; if (notFound === 1) promote(proxy.id); }
        if (r.status === 'partial' && !partial) partial = r;
        return next();
      }, function () { return next(); });
    }
    return Promise.resolve().then(next);
  }

  root.ScrewfixLookup = { lookup: lookup, productUrl: productUrl, interpret: interpret, normPrice: normPrice };
})(this);
