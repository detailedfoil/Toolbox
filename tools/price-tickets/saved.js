/* Saved prices: the fallback for networks that block the live lookup (store PCs, Nov 2026).
 *
 * The free relays lookup.js uses are blocked by some work networks, but the Toolbox's own files always load
 * (the page itself comes from the same place). The GitHub checks already save prices for every A25 ticket
 * (every night) and every Monday Price Check line (Mondays), and Product Search holds names and the age mark
 * for every product. So when the live lookup fails, this finds the newest saved price for the code.
 *
 * SavedPrices.find(code) -> Promise of null or
 *   {price: '£12.99', was: '£14.99' | '', name, age, on: 'YYYY-MM-DD', from: 'A25 check' | 'Monday check'}
 * A product with no saved price gives {price: '', name, age, on: '', from: ''} when its name is known.
 * Shared by Price Tickets and A4 Posters. Never used by the GitHub checks.
 */
(function (root) {
  'use strict';

  var SOURCES = [
    { url: 'counter-trial/data/prices.json', from: 'A25 check' },
    { url: 'shelf-check/data/prices.json',   from: 'Monday check' }
  ];
  var NAMES = 'product-search/data/web-names.json';
  var LIST = 'product-search/data/products.json';

  var cache = {};
  function get(url) {
    if (!cache[url]) {
      cache[url] = fetch(url, { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .catch(function () { delete cache[url]; return null; });
    }
    return cache[url];
  }

  function money(n) {
    n = Number(n);
    return isFinite(n) && n > 0 ? '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  }

  function listIndex(list) {
    if (!list || list._index) return list && list._index;
    var ix = {};
    (list.items || []).forEach(function (p) { ix[p[0]] = p; });
    list._index = ix;
    return ix;
  }

  function find(code) {
    code = String(code || '').toUpperCase();
    return Promise.all(SOURCES.map(function (s) { return get(s.url); }).concat([get(NAMES), get(LIST)])).then(function (all) {
      var best = null;
      SOURCES.forEach(function (s, i) {
        var p = all[i] && all[i].products && all[i].products[code];
        if (!p || !money(p.price)) return;
        var on = p.on || p.since || '';
        if (!best || on > best.on) best = { price: money(p.price), was: Number(p.was) > Number(p.price) ? money(p.was) : '', name: p.name || '', on: on, from: s.from };
      });
      var web = all[2] && all[2].products && all[2].products[code];
      var item = (listIndex(all[3]) || {})[code];
      var flags = item ? item[2] || 0 : 0;
      // same rule as Product Search: the stock list's age mark, or Screwfix's own notice for products added later (flag 32)
      var age = !!(flags & 16) || !!((flags & 32) && web && web.a === 1 && web.an);
      var name = (best && best.name) || (web && web.name) || (item && item[1]) || '';
      if (!best && !name) return null;
      if (!best) best = { price: '', was: '', on: '', from: '' };
      best.name = name;
      best.age = age;
      return best;
    }, function () { return null; });
  }

  root.SavedPrices = { find: find };
})(typeof window !== 'undefined' ? window : this);
