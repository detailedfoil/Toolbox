/* Product Search: stock levels pasted in from the stock system's SKU List report (detailedfoil, 25 Oct 2026).
 *
 * The report copies as text: some screen lines, then the headings one per line ("SKU Code", "Description", "Total Qty",
 * "Available Qty"...: which columns, and their order, can change), then
 * one product per line, tab separated. The headings are read to find each column, so a different column choice still
 * works. Pasted with no headings, the two layouts seen so far are recognised by their number of columns.
 *
 * Kept on this device for the visit only (sessionStorage, gone when the tab is closed) and never sent anywhere: stock is
 * store-specific and the site is public.
 *
 * Only the Available Qty is kept (detailedfoil: "just need it to tell me Available Qty number for each"; where it's kept
 * doesn't matter), plus the name and age column for pasted products the list hasn't got.
 *
 * parse(text) -> {rows: {CODE: [available, name, age (1|0)]}, count, skipped} or null when no products were found.
 */
(function (root) {
  'use strict';

  var SKU = /^(\d{3}[A-Z]{2}|\d{4}[A-Z]|\d{5})$/;
  var KEY = 'ps-stock';
  // layouts seen, for a paste without its headings
  var KNOWN = {
    14: ['SKU Code', 'SKU Definition State', 'SKU Type', 'Description', 'Base Unit Qty', 'Total Qty', 'Available Qty', 'Unreserved Qty',
         'Age Restricted', 'Hazardous', 'Aerosol', 'Non Trolleyable', 'Nailed Location', 'SKU held'],
    10: ['SKU Code', 'Description', 'Total Qty', 'Available Qty', 'Unreserved Qty', 'Age Restricted', 'Hazardous', 'Aerosol',
         'Nailed Location', 'SKU held']
  };

  function code(v) { return String(v || '').trim().toUpperCase().replace(/O/g, '0'); }
  function num(v) { var m = /-?\d+/.exec(String(v || '').replace(/,/g, '')); return m ? parseInt(m[0], 10) : null; }
  function low(s) { return String(s || '').trim().toLowerCase(); }

  function parse(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var head = null, rows = {}, count = 0, skipped = 0, i = 0;
    // the headings: "SKU Code" on a line of its own (tooltips may follow after a tab), one heading per line after it
    for (; i < lines.length; i++) {
      if (low(lines[i].split('\t')[0]) !== 'sku code') continue;
      var h = [], j = i;
      for (; j < lines.length; j++) {
        var cells = lines[j].split('\t');
        if (h.length && cells.length > 3 && SKU.test(code(cells[0]))) break;
        h.push(cells[0].trim());
      }
      head = h; i = j;
      break;
    }
    if (!head) i = 0;
    var col = null, cols = function (h) {
      var at = function (name) { for (var k = 0; k < h.length; k++) if (low(h[k]) === low(name)) return k; return -1; };
      return { sku: at('SKU Code'), name: at('Description'), avail: at('Available Qty'), age: at('Age Restricted') };
    };
    if (head) col = cols(head);
    for (; i < lines.length; i++) {
      var c = lines[i].split('\t');
      if (c.length < 4) continue;
      var sku = code(c[0]);
      if (!SKU.test(sku)) { if (lines[i].trim()) skipped++; continue; }
      var C = col;
      if (!C || C.avail < 0) { if (!KNOWN[c.length]) { skipped++; continue; } C = cols(KNOWN[c.length]); }
      var get = function (k) { return C[k] >= 0 && C[k] < c.length ? c[C[k]] : ''; };
      var avail = num(get('avail'));
      if (avail === null) { skipped++; continue; }
      if (!rows[sku]) count++;
      rows[sku] = [avail, String(get('name')).replace(/\s+/g, ' ').trim(), low(get('age')) === 'yes' ? 1 : 0];
    }
    return count ? { rows: rows, count: count, skipped: skipped } : null;
  }

  // for the visit only
  function save(st) { try { sessionStorage.setItem(KEY, JSON.stringify(st)); return true; } catch (e) { return false; } }
  function load() { try { var s = sessionStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function clear() { try { sessionStorage.removeItem(KEY); } catch (e) { /* nothing kept */ } }

  var api = { parse: parse, save: save, load: load, clear: clear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ProductStock = api;
})(this);
