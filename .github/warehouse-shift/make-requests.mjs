#!/usr/bin/env node
/* Warehouse Shift: what till customers ask for.

     node .github/warehouse-shift/make-requests.mjs

   Reads the game's catalogue (tools/warehouse-shift/data/catalogue.json), Product Search's list, screwfix.com names,
   description words and descriptions (tools/product-search/...) and writes tools/warehouse-shift/data/requests.json:

   describe: [code, what the customer calls it, ...other codes that fit]
     From the product's screwfix.com name without its model number ("a Stanley FatMax 8m tape measure"); half of
     them without the brand too ("an 8m tape measure"). Every product on the shelves whose name has all those words
     fits, so any of them is right.
   need: [code, a sentence from its description, a hint (or ''), ...other codes that fit]
     The customer quotes the description ("I need the one that says: ..."). Every product on the shelves whose
     description says the same fits. When several do, the customer adds what tells them apart, like the size
     ("The 30m one."), and only the ones with that in their name fit. No promotions, guarantees or packaging notes.

   Each request is checked with the real search (tools/product-search/search.js, the same list the till's CrashFix
   tab builds with till.js): a few words from it must find a product that fits in the first 10 results, so none
   are impossible. Run it again after a new catalogue or when the descriptions change (the tests say when). */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
function load(file) {
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  return sandbox.module.exports;
}
const PS = load('tools/product-search/search.js');
const Till = load('tools/warehouse-shift/till.js');

const cat = read('tools/warehouse-shift/data/catalogue.json');
const list = read('tools/product-search/data/products.json');
const web = read('tools/product-search/data/web-names.json');
const dwords = read('tools/product-search/data/desc-words.json');
const DESC = path.join(ROOT, 'tools/product-search/descriptions');

const items = Till.searchItems(list, web, dwords);
const searcher = PS.build(items);
const byCode = new Map(items.map((it) => [it.sku, it]));
const stocked = new Map(cat.items.map((a) => [a[0], { code: a[0], name: a[1], group: a[2], size: a[3] }]));
const nameOf = (code) => { const it = byCode.get(code); return (it && (it.web || it.name)) || (stocked.get(code) || {}).name || ''; };

// every product's searchable words: names (both) and description words
const tokens = new Map(), df = new Map();
for (const it of items) {
  const t = new Set(PS.words(it.name + ' ' + (it.web || '')).filter(Boolean));
  tokens.set(it.sku, t);
  const all = new Set(t);
  String(it.dw || '').split(' ').forEach((w) => { if (w) all.add(w); });
  all.forEach((w) => df.set(w, (df.get(w) || 0) + 1));
}
// word -> the products on the shelves with it in their names
const having = new Map();
for (const [c] of stocked) (tokens.get(c) || []).forEach((w) => (having.get(w) || having.set(w, new Set()).get(w)).add(c));
const searchable = (code) => { const it = byCode.get(code), s = new Set(tokens.get(code)); String(it.dw || '').split(' ').forEach((w) => w && s.add(w)); return s; };

/* ---------- descriptions, cut into sentences and bullets ---------- */
const norm = (s) => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const desc = new Map();
for (const f of fs.readdirSync(DESC)) {
  if (!f.endsWith('.json')) continue;
  const d = JSON.parse(fs.readFileSync(path.join(DESC, f), 'utf8'));
  const segs = [];
  String(d.t || '').split(/\n+/).forEach((p) => p.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).forEach((s) => { s = s.trim(); if (s) segs.push({ s, bullet: false }); }));
  (d.b || []).forEach((s) => { s = String(s).trim(); if (s) segs.push({ s, bullet: true }); });
  segs.forEach((x) => { x.n = ' ' + norm(x.s) + ' '; });
  desc.set(f.slice(0, -5), segs);
}
// three words in a row -> the products whose descriptions have them, to find who else says the same quickly
const grams = new Map();
for (const [code, segs] of desc) {
  const seen = new Set();
  for (const x of segs) {
    const w = x.n.trim().split(' ');
    for (let i = 0; i + 2 < w.length; i++) { const g = w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]; if (seen.has(g)) continue; seen.add(g); (grams.get(g) || grams.set(g, []).get(g)).push(code); }
  }
}
function sayers(quoteN) { // every product whose description has this (normalised) text
  const w = quoteN.trim().split(' ');
  let best = null;
  for (let i = 0; i + 2 < w.length; i++) { const l = grams.get(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]) || []; if (!best || l.length < best.length) best = l; }
  return (best || []).filter((c) => desc.get(c).some((x) => x.n.includes(quoteN)));
}

/* ---------- brands and model numbers ---------- */
const first = new Map();
for (const it of items) { const w = (it.web || '').split(/\s+/); if (w[0]) first.set(w[0], (first.get(w[0]) || 0) + 1); }
const GENERIC = new Set(['Heavy', 'Polished', 'Nickel', 'Necked', 'Cylinder', 'Fire', 'Self-Colour', 'Straight', 'Zero', 'Spectrum', 'Cabin', 'Union', 'Ultra',
  'Satin', 'Brushed', 'Chrome', 'White', 'Black', 'Brass', 'Copper', 'Steel', 'Stainless', 'Galvanised', 'Plastic', 'Rubber', 'Single', 'Double', 'Twin',
  'Round', 'Square', 'Flat', 'Mini', 'Large', 'Small', 'Long', 'Short', 'Pack', 'Garden', 'Outdoor', 'Indoor', 'Bathroom', 'Kitchen', 'Door', 'Window',
  'Cable', 'Pipe', 'Wood', 'Metal', 'Glass', 'Cordless', 'Electric', 'Universal', 'Adjustable', 'Professional', 'Pro', 'Trade', 'Turbo', 'Standard']);
const PAIRS = new Set(['No Nonsense', 'British General', 'Forge Steel', 'Arctic Hayes', 'Thomas Dudley', 'Charles Bentley', 'Mac Allister', 'Hardware Solutions',
  'Master Lock', 'JG Speedfit', 'Wallace Cameron', 'Delta Plus', 'Monument Tools', 'GP Batteries', 'Ideal Standard', 'Map Vent']);
const TRIPLES = new Set(['Smith & Locke', 'Cooke & Lewis', 'Spear & Jackson']);
function brandOf(name) {
  const w = name.split(/\s+/);
  if (TRIPLES.has(w.slice(0, 3).join(' '))) return w.slice(0, 3).join(' ');
  if (PAIRS.has(w.slice(0, 2).join(' '))) return w.slice(0, 2).join(' ');
  return w[0] && (first.get(w[0]) || 0) >= 6 && !GENERIC.has(w[0]) && /^[A-Za-z][A-Za-z0-9-]*$/.test(w[0]) ? w[0] : '';
}
const SPEC = /^\(?\d+(\.\d+)?(mm|cm|m|v|ah|w|kw|kg|g|ml|cl|l|ltr|lm|a|mah|bar|psi|nm|rpm|in|"|ft|m²|mm²|m2|mm2|°|pk|pcs?|gang|way|core|tpi|mtr|mtrs|kva|k|x)\)?[,.]?$/i;
function isModel(word) {
  const c = word.replace(/[(),]/g, '');
  if (!/\d/.test(c) || !/[a-z]/i.test(c) || SPEC.test(c)) return false;
  if (/^\d+(\.\d+)?(mm|m|cm)?x\d+(\.\d+)?(mm|m|cm)?$/i.test(c)) return false;                     // 100x50mm
  if (/^\d+(\.\d+)?-(gang|way|core|pin|piece|tier|port|light|step|tread|hole|wire|amp|pole)s?$/i.test(c)) return false;  // 2-Gang
  if (/^(gu10|mr16|e27|e14|b22|g9|g4|r7s|t8|t5|cat5e|cat6a?|ip\d\d|m\d+|p\d+|h\d+|sds\+?|aa|aaa|9v|wd-?40|4g|5g|3g|c\d|d\d|a\d|b\d)$/i.test(c)) return false;
  return c.length >= 4;
}

/* ---------- describe: what a customer calls a product ---------- */
const PACK = /\b(?:(\d+)\s*(?:pack|pk|pcs?|piece)|(?:pack|pk)\s*(?:of\s*)?(\d+)(?:\s*pcs?)?)\b/i;
function caseWord(w, keep) {
  if (keep) return w;
  if (/^[A-Z][a-z]+(?:[-'][a-z]+)*$/.test(w) || /^[A-Z][a-z]+-[A-Z][a-z]+$/.test(w)) return w.toLowerCase();  // Title Case words become ordinary words
  return w;                                                                                              // LED, FatMax, 18V stay
}
function article(p) {
  const w = p.split(' ')[0];
  const d = /^\d+/.exec(w);
  if (d) return (d[0][0] === '8' || /^1[18](\d\d)?$/.test(d[0]) ? 'an ' : 'a ') + p;
  if (/^[A-Z]{2,4}$/.test(w) && /^[FHLMNRSX]/.test(w) && !/^(LAP|SPAX|NEBO|SIKA|LUX)$/.test(w)) return 'an ' + p;   // an LED, an MCB (but a LAP)
  if (/^(u[bcdfghjklmnpqrstvwxyz][aeiou]|uni|use|usb|upvc|eu|one|once)/i.test(w)) return 'a ' + p;
  return (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + p;
}
const PLURAL = /^(screws|plugs|nails|clips|bolts|nuts|washers|ties|gloves|boots|batteries|bits|blades|discs|sheets|pins|hooks|hinges|brackets|fixings|rivets|staples|anchors|wedges|shims|spacers|elbows|tees|couplers|connectors|glasses|goggles|trousers|shorts|labels|markers|pencils|brushes|wipes|sacks|bags|liners|cups|caps|pads|stickers|olives|sockets|plates|grips|knives|tips|ends|feet|wheels|castors|rings|seals|straps|bungees|cards|keys|letters|numbers|sleeves|saddles|eyes|handles|knobs|pegs|tacks|dowels|toggles|inserts|hangers|couplings|bends|tiles|stops|pliers|snips|cutters|shears|loppers|earplugs|plates|joints|joiners|corners|covers|grommets|glands|lugs|crimps|terminals|fuses|bulbs|lamps|tubes|clamps|cramps|cables|leads|chisels|files|rasps|spanners|sockets|drivers|screwdrivers)$/i;
function describe(code) {
  const name = (byCode.get(code).web || '').trim();
  if (!name || name.length > 90) return null;
  const brand = brandOf(name);
  let words = name.replace(/\s*\([^)]*\)/g, '').replace(/\s+-\s+/g, ' ').split(/\s+/).filter((w) => !isModel(w));
  let text = words.join(' ');
  const pk = PACK.exec(text);
  let pack = '';
  if (pk) { pack = pk[1] || pk[2]; text = text.replace(PACK, ' ').replace(/\s+/g, ' ').trim(); }
  const dropBrand = brand && Till.hash(code + 'brand') % 2 === 0;
  let body = text;
  if (dropBrand && body.startsWith(brand + ' ')) body = body.slice(brand.length + 1);
  const keep = new Set(brand && !dropBrand ? brand.split(' ') : []);
  body = body.split(' ').map((w) => caseWord(w, keep.has(w))).join(' ').replace(/\s+([,.])/g, '$1').replace(/[,.]$/, '');
  if (body.split(' ').length < 2) return null;
  let phrase;
  if (pack && Number(pack) > 1) phrase = 'a pack of ' + pack + ' ' + body;
  else if (/\bpair\b/i.test(name)) phrase = 'a pair of ' + body.replace(/\bpair\b/i, '').replace(/\s+/g, ' ').trim();
  else if (body.split(/ with /)[0].split(' ').slice(-4).some((w) => PLURAL.test(w))) phrase = 'some ' + body;
  else phrase = article(body);
  // what fits: every product on the shelves with all those words in its names
  const need = PS.words(phrase.replace(/^(a|an|some|a pack of|a pair of)\s+/i, '') + (pack ? ' ' + pack + ' pack' : '')).filter(Boolean);
  const lists = need.map((w) => having.get(w) || new Set()).sort((a, b) => a.size - b.size);
  if (!lists.length) return null;
  const fits = [...lists[0]].filter((c) => lists.every((l) => l.has(c)));
  if (!fits.includes(code) || fits.length > 6) return null;
  return { phrase, fits, query: phrase.replace(/^(a|an|some|a pack of|a pair of)\s+/i, '') };
}

/* ---------- need: a sentence from the description ---------- */
const JUNK = /£|€|\$|\bclaim|t ?(&|and) ?cs|\bterms\b|conditions|promotion|promo\b|purchase|residents|\boffers?\b|\bfree\b|first come|regist|warrant|guarantee|www|\.co\.uk|\.com|http|valid|\bapply\b|subject to|stocks? last|aged \d|supplied in|packag|recycl|please note|^note|rewards|\bapp\b|\bcodes?\b|screwfix|\bsave\b|discount|\bprice|deliver(y|ed)|returns?\b|exclusive|batter(y|ies) (not )?included|charger (not )?included|sold separately|not included|available separately|instructions|manual\b|image|picture|may vary|approx|contents|\bkit includes|comes with|\bincludes?\b|in the box|\bcertif|\bbs ?en\b|\ben ?\d{3}|\biso ?\d|\bkitemark|\bce\b|\bukca\b|tested to|complies|compliant|approved|\bweee\b|\bmodel\b|dimensions|\bsize\b|\bsizes\b|weight|\bkg\b|\bpack\b|\bpk\b|\bpcs\b|quantity|\bqty\b|colour:|\bsku\b|join on|^\W*$/i;
function candidates(code) {
  const segs = desc.get(code) || [];
  const name = nameOf(code), nameT = tokens.get(code) || new Set();
  const out = [];
  const seen = new Set();
  for (const x of segs) {
    const s = x.s.replace(/\s+/g, ' ').trim();
    if (seen.has(x.n)) continue; seen.add(x.n);
    const words = s.split(' ');
    if (words.length < (x.bullet ? 4 : 5) || words.length > 24 || s.length > 170) continue;
    if (JUNK.test(s) || s.includes(code) || /[a-z]\.[A-Z]/.test(s) || /^[a-z]/.test(s)) continue;
    if (words.some((w) => isModel(w.replace(/[.,;:!?]+$/, '')))) continue;                  // "The Hager WXPPS12 ... provides": names it outright
    const digits = words.filter((w) => /\d/.test(w)).length;
    if (digits / words.length > 0.34) continue;
    const content = PS.words(s).filter((w) => w && w.length >= 3 && !/^\d+$/.test(w));
    if (content.length < 3) continue;
    const fresh = content.filter((w) => !nameT.has(w));
    if (fresh.length < 2 || fresh.length / content.length < 0.4) continue;                // mostly the product's name again: too easy
    let score = 0;
    if (/^(ideal|suitable|designed|perfect|great|for|used|use|allows|provides|prevents|protects|helps|enables|keeps|stops|removes|seals|joins|connects|fixes|holds|gives|makes|creates|reduces|ensures|offers|delivers|specifically|easy|quick|simply)\b/i.test(s)) score += 3;
    if (/\b(ideal|suitable|designed|used|for use|allows|prevents|protects|helps)\b/i.test(s)) score += 1.5;
    if (!x.bullet) score += 1;
    if (words.length >= 7 && words.length <= 18) score += 1;
    const brand = brandOf(name);
    if (brand && s.toLowerCase().includes(brand.toLowerCase())) score -= 1.5;
    score += Math.min(2, fresh.length / 4);
    out.push({ s, n: x.n.trim(), score });
  }
  return out.sort((a, b) => b.score - a.score);
}
const COLOURS = new Set(['white', 'black', 'brown', 'grey', 'chrome', 'brass', 'satin', 'polished', 'clear', 'silver', 'gold', 'red', 'blue', 'green', 'yellow',
  'orange', 'nickel', 'bronze', 'oak', 'walnut', 'anthracite', 'cream', 'beige', 'magnolia', 'ivory', 'pink', 'purple', 'stainless', 'galvanised', 'zinc', 'copper']);
// what the customer adds so the right one can be told apart: a size, a colour, a pack, the make, or another word
function hintFor(code, fits) {
  const name = nameOf(code);
  const orig = name.replace(/\s+-\s+/g, ' ').split(/\s+/).filter(Boolean);
  const brand = brandOf(name);
  const choices = [];
  const seen = new Set();
  const FINISH = /^(polished|satin|brushed|stainless|antique|matt|gloss)$/i;
  // one choice per word of the name; a word the search splits ("6.5mm" is 6 and 5mm) needs all its parts
  orig.forEach((w, i) => {
    if (isModel(w)) return;
    const ts = PS.words(w).filter(Boolean);
    const key = ts.join(' ');
    if (!ts.length || seen.has(key) || (ts.length === 1 && ts[0].length < 2 && !/\d/.test(ts[0]))) return;
    seen.add(key);
    const t = ts[ts.length - 1];
    const kind = /^\d/.test(ts[0]) ? 0 : COLOURS.has(t) ? 1 : brand && brand.toLowerCase().split(' ').includes(w.toLowerCase()) ? 3 : 4;
    const next = orig[i + 1] || '';
    if (FINISH.test(w) && COLOURS.has(next.toLowerCase())) { choices.push({ t, ts: ts.concat(PS.words(next).filter(Boolean)), w: w + ' ' + next, i, kind: 1, pair: true }); return; }
    choices.push({ t, ts, w: w.replace(/[(),]/g, ''), i, kind });
  });
  const pk = PACK.exec(name);
  const sets = [];
  for (const ch of choices) {
    const s = fits.filter((c) => ch.ts.every((x) => tokens.get(c).has(x)));
    if (s.includes(code)) sets.push({ ch: [ch], s });
  }
  sets.sort((a, b) => a.s.length - b.s.length || a.ch[0].kind - b.ch[0].kind);
  let best = sets[0];
  if (!best || best.s.length > 3) {
    const top = sets.slice(0, 10);
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
      const s = top[i].s.filter((c) => top[j].s.includes(c));
      if (!best || s.length < best.s.length || (s.length === best.s.length && best.ch.length > 1 && top[i].ch[0].kind + top[j].ch[0].kind < best.ch[0].kind + best.ch[1].kind)) best = { ch: [top[i].ch[0], top[j].ch[0]].sort((a, b) => a.i - b.i), s };
    }
  }
  if (!best || best.s.length > 3) return null;
  const say = (ch) => {
    if (ch.pair) return 'in ' + ch.w.toLowerCase();
    if (pk && ch.ts.length === 1 && ch.t === (pk[1] || pk[2])) return 'the pack of ' + ch.t;
    const prev = orig[ch.i - 1] || '', next = orig[ch.i + 1] || '';
    if (/^size$/i.test(prev) && /^\d/.test(ch.w)) return 'size ' + ch.w;
    // "4 1/2lb", "40 Grit", "10 Roll": the number and what it counts
    if (/^\d+$/.test(ch.w) && /^(\d+\/\d+\S*|grit|lb|lbs|oz|rolls?|gang|way|inch|mm|cm|m|v|w|amp|core|tpi|rungs?|treads?|steps?|holes?|ply|metres?|ltr|litres?|kg|g|ml|tier|drawers?|shelf|shelves)$/i.test(next)) return 'the ' + ch.w + ' ' + caseWord(next, false) + ' one';
    if (ch.kind === 1) return 'in ' + ch.w.toLowerCase();
    return 'the ' + (ch.kind === 3 ? ch.w : caseWord(ch.w, false)) + ' one';
  };
  let text;
  if (best.ch.length === 1) text = say(best.ch[0]);
  else {
    const [a, b] = best.ch;
    const isPack = (ch) => pk && ch.ts.length === 1 && ch.t === (pk[1] || pk[2]);
    if (a.kind === 1 && b.kind !== 1) text = say(b) + ', ' + say(a);
    else if (b.kind === 1 && a.kind !== 1) text = say(a) + ', ' + say(b);
    else if (isPack(a) || isPack(b)) text = say(isPack(a) ? b : a) + ', ' + say(isPack(a) ? a : b);                     // "the TX one, the pack of 200"
    else if (a.kind === 0 && b.kind === 0 && /^x$/i.test(orig[a.i + 1] || '') && b.i === a.i + 2) text = 'the ' + a.w + ' x ' + b.w + ' one';   // "the 6.7mm x 150mm one"
    else if (b.i === a.i + 1) text = 'the ' + caseWord(a.w, a.kind === 3) + ' ' + caseWord(b.w, b.kind === 3) + ' one';
    else text = say(a) + ', ' + say(b);
  }
  return { text: text[0].toUpperCase() + text.slice(1) + '.', fits: best.s, words: best.ch.reduce((a, c) => a.concat(c.ts), []) };
}
function need(code) {
  for (const cand of candidates(code).slice(0, 6)) {
    const all = sayers(cand.n);
    if (!all.includes(code) || all.length > 40) continue;
    let fits = all.filter((c) => stocked.has(c)), hint = '', hintWords = [];
    const sameName = fits.every((c) => norm(nameOf(c)) === norm(nameOf(code)));
    if (fits.length > 1 && !sameName) {
      const h = hintFor(code, fits);
      if (!h) continue;
      fits = h.fits; hint = h.text; hintWords = h.words;
    }
    if (fits.length > 4) continue;
    // a few of its rarest words (that the search knows for this product) must find one that fits
    const can = searchable(code);
    const words = [...new Set(PS.words(cand.s).filter((w) => w && w.length >= 3 && !/^\d+$/.test(w) && can.has(w)))].sort((a, b) => (df.get(a) || 0) - (df.get(b) || 0));
    if (words.length < 2) continue;
    let ok = false;
    for (const k of [2, 3, 4]) {
      if (words.length < k) break;
      const q = words.slice(0, k).concat(hintWords).join(' ');
      const res = searcher.find(q, 40).list;
      const at = res.findIndex((r) => fits.includes(r.item.sku));
      if (at >= 0 && at < 10) { ok = true; break; }
    }
    if (!ok) continue;
    return { quote: cand.s, hint, fits };
  }
  return null;
}

/* ---------- everything ---------- */
// A few thousand of each is plenty (a shift sees a few dozen). Products are tried in an order shuffled by their code,
// the same every run; for need, the ones with the best sentences ("Ideal for...", "Suitable for...") first.
const WANT = { describe: 2500, need: 3500 };
const out = { describe: [], need: [] };
const t0 = Date.now();
const codes = [...stocked.keys()].filter((c) => byCode.has(c)).sort((a, b) => Till.hash(a + 'order') - Till.hash(b + 'order'));
for (const code of codes) {
  if (out.describe.length >= WANT.describe) break;
  const d = describe(code);
  if (!d) continue;
  const res = searcher.find(d.query, 40).list, at = res.findIndex((r) => d.fits.includes(r.item.sku));
  if (at >= 0 && at < 10) out.describe.push([code, d.phrase].concat(d.fits.filter((c) => c !== code)));
}
const best = new Map(codes.filter((c) => desc.has(c)).map((c) => { const k = candidates(c); return [c, k.length ? k[0].score : -1]; }));
const byScore = [...best.keys()].filter((c) => best.get(c) >= 0).sort((a, b) => (best.get(b) + (Till.hash(b + 'n') % 100) / 60) - (best.get(a) + (Till.hash(a + 'n') % 100) / 60));
for (const code of byScore) {
  if (out.need.length >= WANT.need) break;
  const n = need(code);
  if (n) out.need.push([code, n.quote, n.hint].concat(n.fits.filter((c) => c !== code)));
}
out.describe.sort((a, b) => (a[0] < b[0] ? -1 : 1));
out.need.sort((a, b) => (a[0] < b[0] ? -1 : 1));
const tried = codes.length, noDesc = codes.filter((c) => !desc.has(c)).length;
const json = {
  version: new Date().toISOString().slice(0, 10),
  note: 'Made by .github/warehouse-shift/make-requests.mjs from the catalogue and Product Search\'s names and descriptions. describe: [code, what the customer calls it, ...other codes that fit]. need: [code, a sentence from its description, a hint or "", ...other codes that fit].',
  describe: out.describe,
  need: out.need
};
const file = path.join(ROOT, 'tools/warehouse-shift/data/requests.json');
fs.writeFileSync(file, '{\n  "version": ' + JSON.stringify(json.version) + ',\n  "note": ' + JSON.stringify(json.note) + ',\n  "describe": [\n' +
  json.describe.map((r) => '    ' + JSON.stringify(r)).join(',\n') + '\n  ],\n  "need": [\n' + json.need.map((r) => '    ' + JSON.stringify(r)).join(',\n') + '\n  ]\n}\n');
console.log('Products tried: ' + tried + ' (' + noDesc + ' without a description). Describe: ' + out.describe.length + ', need: ' + out.need.length +
  ' (' + out.need.filter((r) => r[2]).length + ' with a hint). ' + Math.round(fs.statSync(file).size / 1024) + ' KB, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
