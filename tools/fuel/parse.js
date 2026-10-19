/* Fuel Prices: reads PetrolPrices.co.uk's public fuel map page (map.php) for a store's town, as jina (r.jina.ai)
   renders it to text. That page shows the UK Government Fuel Finder feed. One read per fuel: petrol (E10) and
   diesel (B7). Shared by the page (window.FuelParse) and the 3-hourly GitHub check for Leighton Buzzard
   (.github/fuel/check.mjs, which loads this file with Node's vm), so both read the page the same way.

   STORES: the Area 20 stores, each with the place the map is centred on.
   mapURL(place, fuel) -> the map page for that place (fuel: 'petrol' | 'diesel'), RADIUS miles around it.
   parse(text, {now}) -> {stations: [{key, brand, address, p, miles, date}], synced, count}
     p is pence per litre; date (YYYY-MM-DD) is when that forecourt last reported the price; synced is when the site
     last pulled the government feed (ISO, UK time); count is the page's own "of N stations" figure (or null).
   ok(result) -> '' when the read looks complete, otherwise why not.
   combine(petrol, diesel) -> [{key, brand, address, miles, petrol: {p, date} | null, diesel: ...}]
   merge(saved, combined, synced, nowISO, place) -> {data, changes, changed}: the saved file with the fresh prices in, keeping
     the previous price and when it changed, so the page can show what moved. */
(function (root) {
  'use strict';
  var RADIUS = 5;
  var CODES = { petrol: 'E10', diesel: 'B7' };
  // name: as on the NPS sheet; place: what the map is centred on
  var STORES = [
    ['Amersham (XA6)', 'Amersham'], ['Berkhamsted (CB3)', 'Berkhamsted'], ['Biggleswade (ED1)', 'Biggleswade'],
    ['Bishops Stortford (VA2)', "Bishop's Stortford"], ['Chesham (SB9)', 'Chesham'], ['Dunstable (LB1)', 'Dunstable'],
    ['Epping - Thornwood (RB9)', 'Thornwood, Epping'], ['Flitwick (JM5)', 'Flitwick'], ['Harlow (AT2)', 'Harlow'],
    ['Hemel Hempstead (IT9)', 'Hemel Hempstead'], ['Hertford (IC6)', 'Hertford'], ['Hoddesdon (UB4)', 'Hoddesdon'],
    ['Houghton Regis (DB4)', 'Houghton Regis'], ['Leighton Buzzard (FA2)', 'Leighton Buzzard'], ['Letchworth (TT8)', 'Letchworth'],
    ['Luton - Bilton Way (LT2)', 'Luton'], ['Luton - Windmill (AL2)', 'Luton'], ['Royston (ED6)', 'Royston, Hertfordshire'],
    ['Saffron Walden (JR8)', 'Saffron Walden'], ['St Albans (OA7)', 'St Albans'], ['Stevenage (ET3)', 'Stevenage'],
    ['Welwyn Garden City (IT6)', 'Welwyn Garden City']
  ].map(function (s) { return { name: s[0], code: /\((\w+)\)/.exec(s[0])[1], town: s[0].replace(/\s*\(.*$/, ''), place: s[1] }; });
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function mapURL(place, fuel) {
    return 'https://www.petrolprices.co.uk/map.php?location=' + encodeURIComponent(place) + '&fuel_type=' + (CODES[fuel] || fuel) + '&radius=' + RADIUS;
  }

  function ukParts(d) {
    var f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'shortOffset' });
    var p = {}; f.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    var m = /GMT([+-])?(\d{1,2})?(?::(\d\d))?/.exec(p.timeZoneName || '') || [];
    return { date: p.year + '-' + p.month + '-' + p.day, off: (m[1] || '+') + String(m[2] || 0).padStart(2, '0') + ':' + (m[3] || '00') };
  }
  function ukISO(date, hhmm) { return date + 'T' + hhmm.padStart(5, '0') + ':00' + ukParts(new Date(date + 'T12:00:00Z')).off; }
  /* "15 Oct" / "28 Sept" -> YYYY-MM-DD, in the year that keeps it from being in the future */
  function dayMonth(s, now) {
    var m = /(\d{1,2})\s+([A-Za-z]{3})/.exec(s || '');
    if (!m || MONTHS.indexOf(m[2].toLowerCase()) < 0) return null;
    var today = ukParts(now).date, y = +today.slice(0, 4);
    var d = y + '-' + String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return d > today ? (y - 1) + d.slice(4) : d;
  }
  function pence(s) {
    var v = parseFloat(String(s).replace(/[^\d.]/g, ''));
    return isFinite(v) && v >= 80 && v <= 400 ? Math.round(v * 10) / 10 : null;
  }
  function titleCase(s) {
    return String(s).toLowerCase().replace(/\b([a-z])/g, function (c) { return c.toUpperCase(); })
      .replace(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/gi, function (a, x, y) { return (x + ' ' + y).toUpperCase(); })
      .replace(/'S\b/g, "'s");
  }
  function key(address) { return String(address).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); }
  var COUNTY = /\s*\b(?:bedfordshire|hertfordshire|buckinghamshire|cambridgeshire|essex|beds|herts|bucks)$/i;
  var PCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
  /* the map's addresses are messy ("Shell, 40-42, Woodside Road, Amersham", "Tesco Stores Ltd, Vimy Road, Leighton
     Buzzard", "..., Royston, SG8 5DQ, Royston"): drop the brand, company names, postcodes, counties and repeats.
     An "Independent" forecourt takes its own name from the address. -> {brand, address} */
  function tidy(brand, raw) {
    var parts = String(raw).split(/\s*,\s*/).map(function (x) { return x.replace(COUNTY, '').trim(); }).filter(Boolean), out = [], seen = {};
    if (/^independent$/i.test(brand) && parts.length > 1 && !/\d/.test(parts[0])) brand = parts.shift().replace(/\s+(?:ltd|limited)\.?$/i, '');
    parts.forEach(function (x) {
      var k = x.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!k || seen[k] || PCODE.test(x) || k === brand.toLowerCase().replace(/[^a-z0-9]/g, '') || /\b(?:stores|ltd|limited|plc)\b/i.test(x) && !/\d/.test(x)) return;
      seen[k] = 1;
      if (out.length && /^\d[\d\s\-a-z]*$/i.test(out[out.length - 1]) && out[out.length - 1].length < 9) out[out.length - 1] += ' ' + x; else out.push(x);
    });
    return { brand: brand, address: titleCase(out.join(', ') || raw) };
  }

  /* each forecourt on the map page is a card: [logo]BRAND / 170.9p / £94.00 to fill (55L) / ... / ADDRESS / ... /
     0.2 miles away / ... / 🟡 Aging price · 15 Oct */
  function parse(text, opts) {
    opts = opts || {};
    var now = opts.now ? new Date(opts.now) : new Date();
    text = String(text || '').replace(/\r/g, '');
    var re = /^\s*(\d{2,3}(?:\.\d)?)p\s*$\n+^\s*£[\d,.]+ to fill\b.*$/gm, m, hits = [];
    while ((m = re.exec(text))) hits.push({ at: m.index, end: re.lastIndex, price: m[1] });
    var stations = hits.map(function (h, i) {
      var before = text.slice(i ? hits[i - 1].end : 0, h.at).split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var head = before[before.length - 1] || '';
      var alt = /!\[Image \d+: ([^\]]+)\]\([^)]*\)\s*(.*)$/.exec(head);
      var brand = alt ? alt[1].trim() : head.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
      var body = text.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : text.length);
      var lines = body.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var address = '';
      for (var j = 0; j < lines.length; j++) {
        var l = lines[j];
        if (/^\[|^[↓↑→]|vs \d+ days ago|^!\[/.test(l)) continue;
        if (/^⭐|miles? away|^Last checked/.test(l)) break;
        address = l; break;
      }
      var miles = /([\d.]+)\s+miles?\s+away/.exec(body);
      var date = /(?:Fresh|Aging|Stale)\s+price\s*·\s*([^\n]+)/i.exec(body);
      var t = tidy(brand, address);
      return { key: key(address), brand: t.brand, address: t.address, raw: address, p: pence(h.price), miles: miles ? +miles[1] : null, date: date ? dayMonth(date[1], now) : null };
    }).filter(function (s) { return s.p !== null && s.address; });
    var count = /of (\d+) stations?\b|(?:cheapest|expensive) of (\d+)\b/i.exec(text);
    var sync = /Synced[^·\n]*·\s*(\d{1,2}\s+[A-Za-z]{3,5})\s+at\s+(\d{1,2}:\d\d)/i.exec(text);
    var synced = sync && dayMonth(sync[1], now) ? ukISO(dayMonth(sync[1], now), sync[2]) : null;
    return { stations: stations, count: count ? +(count[1] || count[2]) : null, synced: synced };
  }

  function ok(r) {
    if (!r || !r.stations.length) return 'no forecourts found on the page';
    if (r.count !== null && r.count > r.stations.length) return 'the page has ' + r.count + ' forecourts but only ' + r.stations.length + ' could be read';
    return '';
  }

  function combine(petrol, diesel) {
    var out = {}, order = [];
    [['petrol', petrol], ['diesel', diesel]].forEach(function (pair) {
      ((pair[1] && pair[1].stations) || []).forEach(function (s) {
        var o = out[s.key];
        if (!o) { o = out[s.key] = { key: s.key, brand: s.brand, address: s.address, raw: s.raw, miles: s.miles, petrol: null, diesel: null }; order.push(s.key); }
        if (o.miles === null) o.miles = s.miles;
        o[pair[0]] = { p: s.p, date: s.date };
      });
    });
    return order.map(function (k) { return out[k]; }).sort(function (a, b) { return (a.miles === null ? 99 : a.miles) - (b.miles === null ? 99 : b.miles); });
  }

  function fmt(p) { return p == null ? 'no price' : p.toFixed(1) + 'p'; }

  /* saved: the data file (or null); list: combine() result; synced / now: ISO */
  function merge(saved, list, synced, now, place) {
    saved = saved || {};
    var old = saved.stations || {}, stations = {}, changes = [];
    list.forEach(function (s) {
      var o = old[s.key], st = { brand: s.brand, address: s.address, raw: s.raw, miles: s.miles };
      var label = s.brand + ', ' + s.address.split(',')[0];
      if (!o) changes.push('New forecourt: ' + label);
      ['petrol', 'diesel'].forEach(function (f) {
        var was = o && o[f], now_ = s[f];
        if (!now_) { st[f] = null; if (was) changes.push(label + ' ' + f + ' no longer priced'); return; }
        if (!was) st[f] = { p: now_.p, date: now_.date, since: now };
        else if (was.p !== now_.p) {
          st[f] = { p: now_.p, date: now_.date, since: now, prev: was.p, prevSince: was.since };
          changes.push(label + ' ' + f + ' ' + fmt(now_.p) + ' (was ' + fmt(was.p) + ')');
        } else { st[f] = was; st[f].date = now_.date; }
      });
      stations[s.key] = st;
    });
    Object.keys(old).forEach(function (k) { if (!stations[k]) changes.push('No longer listed: ' + old[k].brand + ', ' + String(old[k].address).split(',')[0]); });
    return { data: { place: place || saved.place || null, radius: RADIUS, synced: synced || saved.synced || null, checked: now, stations: stations }, changes: changes, changed: changes.length > 0 };
  }

  root.FuelParse = { STORES: STORES, tidy: tidy, RADIUS: RADIUS, mapURL: mapURL, parse: parse, ok: ok, combine: combine, merge: merge, ukDate: function (d) { return ukParts(d || new Date()).date; } };
})(typeof window !== 'undefined' ? window : globalThis);
