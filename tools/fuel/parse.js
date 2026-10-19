/* Fuel Prices: reads PetrolPrices.co.uk's public Leighton Buzzard page (which shows the UK Government Fuel Finder
   feed) and keeps track of what changed. Shared by the page (window.FuelParse) and the hourly GitHub check
   (.github/fuel/check.mjs, which loads this file with Node's vm), so both read the page the same way.

   parse(text, {now, known}) reads either the page's HTML (what GitHub gets) or jina's text version of it (what the
   phone gets through r.jina.ai) -> {format, stations: [{id, name, address, postcode, petrol, diesel}], listed, reported}
     petrol / diesel are pence per litre, or null when the page shows no price (a dash).
     listed is the page's own "N stations listed" count (null if it isn't there), reported its "last updated" time.
     known ({id: {name, address}}) splits name from address in jina's text, where the two run together.
   ok(result) -> '' when the read looks complete, otherwise why not.
   merge(saved, fresh, nowISO) -> {data, changes, changed}: the saved file with the fresh prices in, keeping the
     previous price and when it changed, so the page can show what moved. */
(function (root) {
  'use strict';
  var URL = 'https://www.petrolprices.co.uk/towns/leighton-buzzard.php';
  var PC = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/;
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function decode(s) {
    return String(s).replace(/&#0*39;|&#x0*27;|&apos;/gi, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, function (a, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&');
  }
  function clean(s) { return decode(s).replace(/\s+/g, ' ').trim(); }
  function postcode(s) { var m = PC.exec(String(s).toUpperCase()); return m ? m[1] + ' ' + m[2] : ''; }
  /* pence per litre, or null for a dash, a blank or a figure no forecourt charges (the feed has some typos) */
  function pence(s) {
    var v = parseFloat(String(s).replace(/[^\d.]/g, ''));
    return isFinite(v) && v >= 80 && v <= 400 ? Math.round(v * 10) / 10 : null;
  }

  /* UK date (YYYY-MM-DD) and the time zone offset (+01:00 / +00:00) at a moment */
  function ukParts(d) {
    var f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'shortOffset' });
    var p = {}; f.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    var m = /GMT([+-])?(\d{1,2})?(?::(\d\d))?/.exec(p.timeZoneName || '') || [];
    var off = (m[1] || '+') + String(m[2] || 0).padStart(2, '0') + ':' + (m[3] || '00');
    return { date: p.year + '-' + p.month + '-' + p.day, off: off };
  }
  /* "YYYY-MM-DD" + "HH:MM" UK time -> ISO with the right offset for that day */
  function ukISO(date, hhmm) {
    var noon = new Date(date + 'T12:00:00Z');
    return date + 'T' + hhmm.padStart(5, '0') + ':00' + ukParts(noon).off;
  }
  function addDays(date, n) { var d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  /* "last updated today at 12:03" / "yesterday at 21:30" / "on 18 October at 9:05" / "18 Oct 2026, 09:05" */
  function reportedTime(text, now) {
    var m = /last updated\s+([^.<\n]{0,40}?)\s*(?:at|,)\s*(\d{1,2}):(\d\d)/i.exec(text);
    if (!m) return null;
    var today = ukParts(now).date, when = m[1].toLowerCase().replace(/^on\s+/, ''), date = null, d;
    if (!when || when === 'today') date = today;
    else if (when === 'yesterday') date = addDays(today, -1);
    else if ((d = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?/.exec(when)) && MONTHS.indexOf(d[2]) >= 0) {
      var y = d[3] ? +d[3] : +today.slice(0, 4);
      date = y + '-' + String(MONTHS.indexOf(d[2]) + 1).padStart(2, '0') + '-' + d[1].padStart(2, '0');
      if (!d[3] && date > today) date = (y - 1) + date.slice(4); // "31 December" read on 1 January
    }
    return date ? ukISO(date, m[2] + ':' + m[3]) : null;
  }

  /* the page's HTML: one link per forecourt, holding its name, address and a Petrol and a Diesel price chip */
  function fromHTML(html) {
    var out = [], re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m;
    while ((m = re.exec(html))) {
      var attrs = m[1], inner = m[2];
      if (!/Petrol|Diesel|Unleaded/i.test(inner + attrs)) continue;
      var bits = inner.replace(/<svg[\s\S]*?<\/svg>/gi, '').split(/<[^>]*>/).map(clean).filter(Boolean);
      var aria = clean((/aria-label="([^"]*)"/i.exec(attrs) || [])[1] || '');
      var href = decode((/href="([^"]*)"/i.exec(attrs) || [])[1] || '');
      var pc = postcode(aria) || postcode(decodeURIComponent((/location=([^&]+)/.exec(href) || [])[1] || '').replace(/\+/g, ' ')) || postcode(bits.join(' '));
      if (!pc) continue;
      var words = bits.filter(function (b) { return !/^cheapest\b/i.test(b); });
      var address = words.filter(function (b) { return postcode(b) === pc && /,/.test(b); })[0] || '';
      var name = words[0] && words[0] !== address ? words[0] : (/near (.+?), [A-Z]{1,2}\d/.exec(aria) || [])[1] || '';
      var after = function (label) {
        var i = bits.findIndex(function (b) { return new RegExp('^' + label + '$', 'i').test(b); });
        return i >= 0 ? bits[i + 1] : undefined;
      };
      var ariaP = /Unleaded\s+([\d.]+)\s*pence/i.exec(aria), ariaD = /Diesel\s+([\d.]+)\s*pence/i.exec(aria);
      var petrol = after('Petrol') !== undefined ? pence(after('Petrol')) : ariaP ? pence(ariaP[1]) : null;
      var diesel = after('Diesel') !== undefined ? pence(after('Diesel')) : ariaD ? pence(ariaD[1]) : null;
      out.push({ name: name, address: address, postcode: pc, petrol: petrol, diesel: diesel });
    }
    return out;
  }

  /* jina's text: "*   [Tesco Leighton Buzzard Superstore Cheapest diesel Vimy Road, Leighton Buzzard, LU7 1ER Petrol 168.9 p
     Diesel 193.9 p Compare](https://www.petrolprices.co.uk/map.php?location=LU7%201ER&...)" */
  function fromText(text, known) {
    var out = [], re = /\[([^\[\]]*?)\s+Petrol\s+(\S+)(?:\s*p\b)?\s+Diesel\s+(\S+)(?:\s*p\b)?[^\]]*\]\(([^)]*)\)/gi, m;
    while ((m = re.exec(text))) {
      var body = clean(m[1]), pc = postcode(decodeURIComponent((/location=([^&)]+)/.exec(m[4]) || [])[1] || '').replace(/\+/g, ' ')) || postcode(body);
      if (!pc) continue;
      var name = '', address = '', k = known && known[pc], badge = /\s+Cheapest (?:petrol|diesel)(?:\s+Cheapest (?:petrol|diesel))?\s+/i.exec(body);
      if (k && k.name && body.indexOf(k.name) === 0) { name = k.name; address = body.slice(k.name.length).replace(/^\s*(?:Cheapest (?:petrol|diesel)\s*)+/i, '').trim(); }
      else if (badge) { name = body.slice(0, badge.index); address = body.slice(badge.index + badge[0].length); }
      else { var c = body.indexOf(','); name = c > 0 ? body.slice(0, c) : body; address = c > 0 ? body.slice(c + 1).trim() : ''; }
      out.push({ name: name.trim(), address: address.trim(), postcode: pc, petrol: pence(m[2]), diesel: pence(m[3]) });
    }
    return out;
  }

  function parse(text, opts) {
    opts = opts || {};
    var now = opts.now ? new Date(opts.now) : new Date();
    text = String(text || '');
    var html = /<a\b[^>]*href=/i.test(text);
    var list = html ? fromHTML(text) : fromText(text, opts.known);
    var seen = {}, stations = list.map(function (s) {
      var id = s.postcode;
      if (seen[id]) id = s.postcode + ' ' + s.name;
      seen[id] = 1;
      s.id = id;
      return s;
    });
    var listed = /(\d+)\s+stations?\s+listed/i.exec(html ? text.replace(/<[^>]*>/g, ' ') : text);
    return { format: html ? 'html' : 'text', stations: stations, listed: listed ? +listed[1] : null, reported: reportedTime(html ? decode(text.replace(/<[^>]*>/g, ' ')) : text, now) };
  }

  /* '' when the read looks complete and believable, otherwise the reason it doesn't */
  function ok(r) {
    if (!r || !r.stations.length) return 'no forecourts found on the page';
    if (r.listed !== null && r.listed !== r.stations.length) return 'the page lists ' + r.listed + ' forecourts but only ' + r.stations.length + ' could be read';
    if (r.stations.length < 2) return 'only one forecourt found';
    var priced = r.stations.filter(function (s) { return s.petrol !== null || s.diesel !== null; }).length;
    if (priced < Math.ceil(r.stations.length / 2)) return 'most forecourts have no price';
    if (r.stations.some(function (s) { return !s.name; })) return 'a forecourt with no name';
    return '';
  }

  var FUELS = { petrol: 'petrol', diesel: 'diesel' };
  function fmt(p) { return p === null || p === undefined ? 'no price' : p.toFixed(1) + 'p'; }

  /* saved: the data file (or null); fresh: parse() result; now: ISO time of this read */
  function merge(saved, fresh, now) {
    saved = saved || {};
    var old = saved.stations || {}, stations = {}, changes = [];
    fresh.stations.forEach(function (s) {
      var o = old[s.id], st = { name: s.name || (o && o.name) || s.id, address: s.address || (o && o.address) || '', postcode: s.postcode };
      if (!o) changes.push('New forecourt: ' + st.name);
      Object.keys(FUELS).forEach(function (f) {
        var was = o && o[f], p = s[f];
        if (!was) st[f] = { p: p, since: now };
        else if (was.p !== p) {
          st[f] = { p: p, since: now, prev: was.p, prevSince: was.since };
          changes.push(st.name + ' ' + f + ' ' + fmt(p) + ' (was ' + fmt(was.p) + ')');
        } else st[f] = was;
      });
      stations[s.id] = st;
    });
    Object.keys(old).forEach(function (id) { if (!stations[id]) changes.push('No longer listed: ' + (old[id].name || id)); });
    return {
      data: { source: URL, reported: fresh.reported || saved.reported || null, checked: now, stations: stations },
      changes: changes,
      changed: changes.length > 0
    };
  }

  root.FuelParse = { URL: URL, parse: parse, ok: ok, merge: merge, ukISO: ukISO, ukDate: function (d) { return ukParts(d || new Date()).date; }, pence: pence };
})(typeof window !== 'undefined' ? window : globalThis);
