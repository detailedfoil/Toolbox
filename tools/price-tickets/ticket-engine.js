/* Screwfix 90 x 75 mm shelf price tickets -> print-ready A4 PDF, in the browser.
 *
 * A line-for-line port of make_tickets.py from the screwfix-price-tickets skill:
 * same fonts (Barlow Condensed ExtraBold + Barlow Semi Condensed Regular v1.408),
 * same kerning, ligatures, line breaking, pixel snapping and page geometry, so the
 * PDFs match the ones the skill makes. Do not restyle anything in here.
 */
(function (root) {
  'use strict';

  var PT = 0.75;                       // PDF points per CSS px
  var MM = 96 / 25.4;                  // CSS px per mm
  var inch = 72.0, cm = inch / 2.54, mmPt = cm * 0.1;   // reportlab units
  var PAGE_W = 210 * mmPt, PAGE_H = 297 * mmPt;          // A4 in points
  var BLUE = [0x1F / 255, 0x4E / 255, 0xA1 / 255];       // price #1f4ea1
  var INK = [0x1C / 255, 0x20 / 255, 0x33 / 255];        // text  #1c2033
  var CUT = [0xC4 / 255, 0xC4 / 255, 0xC4 / 255];        // cut line #c4c4c4
  var DASHES = '-–—';        // hyphen, en dash, em dash: a line may break after these

  function LU(v) { return Math.floor(v * 64) / 64; }   // layout unit (1/64 px)
  function SNAP(v) { return Math.floor(v + 0.5); }     // whole-pixel snap

  var SHEET_W = LU(210 * MM), SHEET_H = LU(297 * MM);
  var CELL_W = LU(90 * MM), CELL_H = LU(75 * MM);
  var GRID_X = (SHEET_W - 2 * CELL_W) / 2;
  var GRID_Y = (SHEET_H - 3 * CELL_H) / 2;

  function TicketError(message, kind, extra) {
    var e = new Error(message);
    e.kind = kind;
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }

  /* ---------- font shaping (cmap, advances, GPOS kern, GSUB liga) ---------- */

  function Face(d, key, label) {
    this.key = key;
    this.label = label;
    this.d = d;
    this.upm = d.upm;
    this.cmap = new Map();
    for (var u in d.cmap) this.cmap.set(+u, d.cmap[u]);
    this.adv = d.adv;
    this.kern = d.kern.map(function (subs) {
      return subs.map(function (st) {
        if (!st) return null;
        return st.f === 1 ? { f: 1, cov: new Set(st.cov), p: st.p }
                          : { f: 2, cov: new Set(st.cov), c1: st.c1, c2: st.c2, m: st.m };
      });
    });
    this.liga = d.liga;
    this.spaceGid = this.cmap.get(32);
  }

  Face.prototype.kernPair = function (a, b) {
    var total = 0;
    for (var i = 0; i < this.kern.length; i++) {        // each lookup applies once; first matching subtable wins
      var subs = this.kern[i];
      for (var j = 0; j < subs.length; j++) {
        var sub = subs[j];
        if (!sub || !sub.cov.has(a)) continue;
        if (sub.f === 1) {
          var row = sub.p[a];
          if (!row || !Object.prototype.hasOwnProperty.call(row, b)) continue;
          total += row[b];
        } else {
          total += sub.m[sub.c1[a] || 0][sub.c2[b] || 0];
        }
        break;
      }
    }
    return total;
  };

  Face.prototype.missing = function (text) {
    var self = this, seen = {};
    Array.from(text).forEach(function (c) {
      if (!self.cmap.has(c.codePointAt(0))) seen[c] = true;
    });
    return Object.keys(seen).sort();
  };

  Face.prototype.glyphs = function (text, liga) {
    var self = this;
    var missing = this.missing(text);
    if (missing.length) {
      throw TicketError('The ticket font has no ' + missing.map(function (c) { return '"' + c + '"'; }).join(', ') +
                        ' (in "' + text + '")', 'chars', { chars: missing });
    }
    var gl = Array.from(text).map(function (c) { return self.cmap.get(c.codePointAt(0)); });
    if (liga !== false) {
      this.liga.forEach(function (subs) {
        var out = [], i = 0;
        while (i < gl.length) {
          var hit = null;
          for (var s = 0; s < subs.length && !hit; s++) {
            var seqs = subs[s][gl[i]] || [];
            for (var q = 0; q < seqs.length; q++) {
              var comp = seqs[q][1], n = comp.length, ok = i + 1 + n <= gl.length;
              for (var k = 0; ok && k < n; k++) ok = gl[i + 1 + k] === comp[k];
              if (ok) { hit = [seqs[q][0], n]; break; }
            }
          }
          if (hit) { out.push(hit[0]); i += 1 + hit[1]; }
          else { out.push(gl[i]); i += 1; }
        }
        gl = out;
      });
    }
    return gl;
  };

  /* [[x, gid]], total advance in px */
  Face.prototype.layout = function (text, size, spacing, liga) {
    spacing = spacing || 0.0;
    var gl = this.glyphs(text, liga), x = 0.0, out = [];
    for (var i = 0; i < gl.length; i++) {
      out.push([x, gl[i]]);
      var a = this.adv[gl[i]] + (i + 1 < gl.length ? this.kernPair(gl[i], gl[i + 1]) : 0);
      x += a * size / this.upm + spacing;
    }
    return { items: out, width: x };
  };

  Face.prototype.width = function (text, size) { return this.layout(text, size).width; };

  function rstripSpace(s) { return s.replace(/ +$/, ''); }
  function squash(s) { return String(s).split(/\s+/).filter(Boolean).join(' '); }

  /* Greedy line breaking like Chrome: break after spaces, and after a hyphen or dash inside a word. */
  function wrap(face, text, size, maxW) {
    var cps = Array.from(squash(text)), segs = [], cur = '';
    for (var i = 0; i < cps.length; i++) {
      var ch = cps[i];
      cur += ch;
      var nxt = i + 1 < cps.length ? cps[i + 1] : '';
      if (ch === ' ' || (DASHES.indexOf(ch) >= 0 && i > 0 && cps[i - 1] !== ' ' && nxt !== '' && nxt !== ' ')) {
        segs.push(cur); cur = '';
      }
    }
    if (cur) segs.push(cur);
    var lines = [], line = '';
    segs.forEach(function (s) {
      if (line && face.width(rstripSpace(line + s), size) > maxW + 1e-6) {
        lines.push(rstripSpace(line)); line = s;
      } else {
        line += s;
      }
    });
    if (line.trim()) lines.push(rstripSpace(line));
    return lines;
  }

  /* ---------- PDF content (same operators reportlab writes) ---------- */

  var FP_FMT = [0, 1, 2, 3, 4, 5, 6];
  function fp1(v) {                       // reportlab fp_str for one number
    var sa = Math.abs(v);
    if (sa <= 1e-7) return '0';
    var l = sa <= 1 ? 6 : Math.min(Math.max(0, 6 - Math.trunc(Math.log10(sa))), 6);
    var n = v.toFixed(FP_FMT[l]);
    if (l) n = n.replace(/0+$/, '').replace(/\.$/, '');
    return (n[0] !== '0' || n.length === 1) ? n : n.slice(1);
  }
  function fp() { return Array.prototype.map.call(arguments, fp1).join(' '); }
  function pxToPdf(x, y) { return [x * PT, PAGE_H - y * PT]; }
  function hex4(g) { return ('0000' + g.toString(16).toUpperCase()).slice(-4); }

  function drawRun(c, face, size, items, x0, y0, color, rotate) {
    c.push('q');
    c.push(fp(color[0], color[1], color[2]) + ' rg');
    var p = pxToPdf(x0, y0);
    c.push('1 0 0 1 ' + fp(p[0], p[1]) + ' cm');
    if (rotate) c.push('0 1 -1 0 0 0 cm');
    c.push('BT /' + face.key + ' ' + fp(size * PT) + ' Tf');
    items.forEach(function (it) {
      if (it[1] === face.spaceGid) return;
      c.used[face.key].add(it[1]);
      c.push('1 0 0 1 ' + fp(it[0] * PT) + ' 0 Tm <' + hex4(it[1]) + '> Tj');
    });
    c.push('ET');
    c.push('Q');
  }

  /* 1px dashed #c4c4c4 border just inside the 90 x 75 mm box (3px dashes, gaps stretched to fit). */
  function drawCutLines(c, x, y) {
    var x1 = SNAP(x), y1 = SNAP(y), x2 = SNAP(x + CELL_W), y2 = SNAP(y + CELL_H);
    c.push(fp(CUT[0], CUT[1], CUT[2]) + ' rg');
    function edge(length) {
      var n = Math.floor((length + 2) / 5), gap = (length - 3 * n) / (n - 1), r = [];
      for (var i = 0; i < n; i++) r.push(i * (3 + gap));
      return r;
    }
    edge(x2 - x1).forEach(function (d) {          // top and bottom
      [y1, y2 - 1].forEach(function (yy) {
        var p = pxToPdf(x1 + d, yy + 1);
        c.push(fp(p[0], p[1], 3 * PT, 1 * PT) + ' re f');
      });
    });
    edge(y2 - y1).forEach(function (d) {          // left and right
      [x1, x2 - 1].forEach(function (xx) {
        var p = pxToPdf(xx, y1 + d + 3);
        c.push(fp(p[0], p[1], 1 * PT, 3 * PT) + ' re f');
      });
    });
  }

  function drawTicket(c, fonts, t, slot, refDate) {
    var col = slot % 2, row = Math.floor(slot / 2);
    var cx = GRID_X + col * CELL_W, cy = GRID_Y + row * CELL_H;
    drawCutLines(c, cx, cy);
    var ox = cx + 1, oy = cy + 1;                   // ticket origin, inside the 1px border
    c.push('q');
    var lt = pxToPdf(ox, oy), lb = pxToPdf(ox, cy + CELL_H - 1);
    c.push(fp(lt[0], lb[1], (CELL_W - 2) * PT, lt[1] - lb[1]) + ' re W n');
    // price: Barlow Condensed ExtraBold 75px, letter-spacing 1px, top 2px, left 11px
    var r = fonts.price.layout(t.price, 75, 1.0, false);
    drawRun(c, fonts.price, 75, r.items, LU(ox + 11), SNAP(oy + 2 + 67), BLUE);
    // product name: Barlow Semi Condensed 16.5px / 1.2, 282px wide, top 116px, left 15px
    var lh = LU(16.5 * 1.2);
    var lines = wrap(fonts.text, t.product, 16.5, 282);
    lines.forEach(function (line, i) {
      var rl = fonts.text.layout(line, 16.5);
      drawRun(c, fonts.text, 16.5, rl.items, LU(ox + 15), SNAP(oy + 116 + i * lh + 16), INK);
    });
    // code line: 12px, 24px below the name
    var rc = fonts.text.layout('Code: ' + t.code, 12);
    drawRun(c, fonts.text, 12, rc.items, LU(ox + 15), SNAP(oy + 116 + lines.length * lh + 24 + 12), INK);
    // side reference line: 7px, reads bottom-to-top, right-hand edge
    var rr = fonts.text.layout('UK-' + t.code + '-90X75-' + refDate, 7);
    drawRun(c, fonts.text, 7, rr.items, SNAP(ox + 326) + 8, SNAP(oy + 189) + 80, INK, true);
    c.push('Q');
    return lines;
  }

  /* ---------- tidy + check one ticket (same rules as clean() in the skill) ---------- */

  var PRICE_RE = /^£\d{1,3}(,\d{3})*\.\d{2}$/;
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function clean(t) {
    var code = String(t.code || '').trim().toUpperCase().replace(/O/g, '0');
    var price = String(t.price || '').trim().replace(/ /g, '');
    if (price.charAt(0) !== '£') price = '£' + price;
    if (!PRICE_RE.test(price)) throw TicketError('Bad price "' + (t.price || '') + '" for ' + code + ': use £12.34', 'price');
    var product = squash(t.product || '').replace(new RegExp('\\s*\\(' + escapeRe(code) + '\\)\\s*$', 'i'), '');
    return { code: code, price: price, product: product };
  }

  /* ---------- minimal PDF writer: CID TrueType fonts (Identity-H), Flate streams ---------- */

  function latin1(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF;
    return b;
  }

  function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    try {
      var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); }, function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function toUnicodeCMap(face, used) {
    var entries = Array.from(used).sort(function (a, b) { return a - b; }).filter(function (g) { return face.d.uni[g]; });
    var out = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
      '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange'];
    for (var i = 0; i < entries.length; i += 100) {
      var chunk = entries.slice(i, i + 100);
      out.push(chunk.length + ' beginbfchar');
      chunk.forEach(function (g) {
        var s = face.d.uni[g], h = '';
        for (var k = 0; k < s.length; k++) h += ('0000' + s.charCodeAt(k).toString(16).toUpperCase()).slice(-4);
        out.push('<' + hex4(g) + '> <' + h + '>');
      });
      out.push('endbfchar');
    }
    out.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
    return out.join('\n');
  }

  function pdfDate(d) {
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return 'D:' + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) +
           p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
  }

  function Engine(fontData, priceTtf, textTtf) {
    this.fonts = {
      price: new Face(fontData.price, 'F1', 'price'),
      text: new Face(fontData.text, 'F2', 'text')
    };
    this.ttf = { F1: new Uint8Array(priceTtf), F2: new Uint8Array(textTtf) };
    this._packed = {};
  }

  Engine.prototype._fontFile = function (key) {
    var self = this;
    if (!this._packed[key]) {
      this._packed[key] = deflate(this.ttf[key]).then(function (z) {
        return z ? { bytes: z, filter: true } : { bytes: self.ttf[key], filter: false };
      });
    }
    return this._packed[key];
  };

  /* Problems that would stop a ticket printing, or null when it is fine. */
  Engine.prototype.check = function (t) {
    var c;
    try { c = clean(t); } catch (e) { return e; }
    if (!/^[0-9A-Z]+$/.test(c.code)) return TicketError('Codes are letters and numbers only', 'code');
    if (!c.product) return TicketError('Add the product name', 'product');
    var miss = this.fonts.text.missing(c.product + 'Code: ' + c.code);
    if (miss.length) return TicketError('The ticket font has no ' + miss.map(function (ch) { return '"' + ch + '"'; }).join(', '), 'chars', { chars: miss });
    return null;
  };

  Engine.prototype.clean = clean;

  Engine.prototype.lines = function (product) { return wrap(this.fonts.text, product, 16.5, 282); };

  /* tickets: [{code, price, product}] -> Promise<Uint8Array> (6 per A4 page, in order) */
  Engine.prototype.render = function (tickets, opts) {
    opts = opts || {};
    var self = this;
    var refDate = opts.date || ukDate().ref;
    var list = tickets.map(clean);
    var used = { F1: new Set(), F2: new Set() };
    var pages = [];
    for (var i = 0; i < list.length; i += 6) {
      var c = [];
      c.used = used;
      list.slice(i, i + 6).forEach(function (t, slot) { drawTicket(c, self.fonts, t, slot, refDate); });
      pages.push(c.join('\n') + '\n');
    }
    if (!pages.length) throw TicketError('No tickets to print', 'empty');

    return Promise.all([this._fontFile('F1'), this._fontFile('F2'),
                        Promise.all(pages.map(function (p) { return deflate(latin1(p)); }))])
      .then(function (res) {
        var files = { F1: res[0], F2: res[1] }, packedPages = res[2];
        var chunks = [], len = 0, offsets = [];
        function w(x) { var b = typeof x === 'string' ? latin1(x) : x; chunks.push(b); len += b.length; }
        function obj(num, dict, stream) {
          offsets[num] = len;
          w(num + ' 0 obj\n' + dict);
          if (stream) { w('\nstream\n'); w(stream); w('\nendstream'); }
          w('\nendobj\n');
        }
        w('%PDF-1.4\n%âãÏÓ\n');

        // 1 catalog, 2 pages, 3 info, 4-8 price font, 9-13 text font, then page + content pairs
        var fontObj = { F1: 4, F2: 9 };
        var firstPage = 14;
        var kids = pages.map(function (_, i) { return (firstPage + 2 * i) + ' 0 R'; }).join(' ');
        obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
        obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');
        obj(3, '<< /Title (Price tickets) /Producer (Toolbox price tickets) /CreationDate (' + pdfDate(new Date()) + ') >>');

        ['F1', 'F2'].forEach(function (key) {
          var face = key === 'F1' ? self.fonts.price : self.fonts.text, d = face.d, n = fontObj[key];
          var s = 1000 / d.upm;
          var widths = d.adv.map(function (a) { return Math.round(a * s); }).join(' ');
          var file = files[key];
          var cmap = latin1(toUnicodeCMap(face, used[key]));
          obj(n, '<< /Type /Font /Subtype /Type0 /BaseFont /' + d.psName + ' /Encoding /Identity-H' +
                 ' /DescendantFonts [' + (n + 1) + ' 0 R] /ToUnicode ' + (n + 4) + ' 0 R >>');
          obj(n + 1, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + d.psName +
                     ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>' +
                     ' /FontDescriptor ' + (n + 2) + ' 0 R /CIDToGIDMap /Identity /DW 1000 /W [0 [' + widths + ']] >>');
          obj(n + 2, '<< /Type /FontDescriptor /FontName /' + d.psName + ' /Flags 32' +
                     ' /FontBBox [' + d.bbox.map(function (v) { return Math.round(v * s); }).join(' ') + ']' +
                     ' /ItalicAngle ' + d.italicAngle + ' /Ascent ' + Math.round(d.ascent * s) +
                     ' /Descent ' + Math.round(d.descent * s) + ' /CapHeight ' + Math.round(d.capHeight * s) +
                     ' /StemV 80 /FontFile2 ' + (n + 3) + ' 0 R >>');
          obj(n + 3, '<< /Length ' + file.bytes.length + ' /Length1 ' + self.ttf[key].length +
                     (file.filter ? ' /Filter /FlateDecode' : '') + ' >>', file.bytes);
          obj(n + 4, '<< /Length ' + cmap.length + ' >>', cmap);
        });

        pages.forEach(function (p, i) {
          var pn = firstPage + 2 * i, z = packedPages[i], body = z || latin1(p);
          obj(pn, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fp(PAGE_W, PAGE_H) + ']' +
                  ' /Resources << /Font << /F1 4 0 R /F2 9 0 R >> /ProcSet [/PDF /Text] >> /Contents ' + (pn + 1) + ' 0 R >>');
          obj(pn + 1, '<< /Length ' + body.length + (z ? ' /Filter /FlateDecode' : '') + ' >>', body);
        });

        var count = firstPage + 2 * pages.length;
        var xref = len;
        var x = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
        for (var k = 1; k < count; k++) x += ('0000000000' + offsets[k]).slice(-10) + ' 00000 n \n';
        w(x + 'trailer\n<< /Size ' + count + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

        var out = new Uint8Array(len), at = 0;
        chunks.forEach(function (b) { out.set(b, at); at += b.length; });
        return out;
      });
  };

  /* Today's UK date: ref 'DD_MM_YY' for the side line, iso 'YYYY-MM-DD' for file names */
  function ukDate(d) {
    d = d || new Date();
    var parts = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
    } catch (e) {
      parts = { year: String(d.getFullYear()), month: ('0' + (d.getMonth() + 1)).slice(-2), day: ('0' + d.getDate()).slice(-2) };
    }
    return { ref: parts.day + '_' + parts.month + '_' + parts.year.slice(-2), iso: parts.year + '-' + parts.month + '-' + parts.day };
  }

  var api = { Engine: Engine, clean: clean, ukDate: ukDate, PRICE_RE: PRICE_RE };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.TicketEngine = api;
})(this);
