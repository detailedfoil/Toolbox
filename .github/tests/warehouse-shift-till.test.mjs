// Warehouse Shift's till (Dunstable only): what till customers ask for adds up, the made-up customers can't be real
// people, the till's sums match the real checkout, and the till's CrashFix tab searches the same list as Product
// Search. data/requests.json is made by .github/warehouse-shift/make-requests.mjs: if a test here says a quote is no
// longer in a description, run that again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, loadModule } from './load.mjs';

const W = loadModule('tools/warehouse-shift/world.js');
const Till = loadModule('tools/warehouse-shift/till.js');
const PS = loadModule('tools/product-search/search.js');
const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const cat = read('tools/warehouse-shift/data/catalogue.json');
const req = read('tools/warehouse-shift/data/requests.json');
const world = W.build(cat);
const byCode = new Map(world.items.map((it) => [it.code, it]));
const items = Till.searchItems(read('tools/product-search/data/products.json'), read('tools/product-search/data/web-names.json'), read('tools/product-search/data/desc-words.json'));
const item = new Map(items.map((it) => [it.sku, it]));
const nameWords = (code) => new Set(PS.words(item.get(code).name + ' ' + (item.get(code).web || '')).filter(Boolean));
const norm = (s) => ' ' + String(s).toLowerCase().replace(/&/g, ' and ').replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
function descText(code) {
  const f = path.join(REPO, 'tools/product-search/descriptions', code + '.json');
  if (!fs.existsSync(f)) return null;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  return [String(d.t || '')].concat(d.b || []).map(norm);
}
let seed = 20261119;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

test('requests: thousands of each, every product on the shelves, none twice', () => {
  assert.ok(req.describe.length >= 1000 && req.need.length >= 1000, req.describe.length + ' describe, ' + req.need.length + ' need');
  for (const kind of ['describe', 'need']) {
    const seen = new Set();
    for (const e of req[kind]) {
      const codes = [e[0]].concat(kind === 'describe' ? e.slice(2) : e.slice(3));
      for (const c of codes) { assert.ok(byCode.has(c) && byCode.get(c).loc, kind + ' ' + c + ' is not on the shelves (run make-requests.mjs again)'); }
      assert.equal(new Set(codes).size, codes.length, kind + ' ' + e[0] + ' lists a code twice');
      assert.ok(!seen.has(e[0]), kind + ' ' + e[0] + ' twice'); seen.add(e[0]);
      assert.ok(codes.length <= 6, kind + ' ' + e[0] + ': too many fit');
    }
  }
});

test('need: the customer quotes the description word for word, and every product that fits says the same', () => {
  const JUNK = /£|guarantee|warranty|t ?& ?cs|terms and|promotion|claim|recycl|packaging|rewards|screwfix|www\.|\.co\.uk/i;
  for (const [code, quote, hint, ...more] of req.need) {
    assert.ok(quote.split(' ').length >= 4 && quote.length <= 170, code + ': ' + quote);
    assert.ok(!JUNK.test(quote), code + ': a promotion or small print: ' + quote);
    for (const c of [code].concat(more)) {
      const d = descText(c);
      assert.ok(d, c + ' has no description (run make-requests.mjs again)');
      assert.ok(d.some((x) => x.includes(norm(quote))), c + "'s description no longer says: " + quote + ' (run make-requests.mjs again)');
    }
    if (more.length && !hint) { // several fit with no hint: they must be the same product under different codes
      const n = norm(item.get(code).web || item.get(code).name);
      assert.ok(more.every((c) => norm(item.get(c).web || item.get(c).name) === n), code + ': several fit but nothing tells them apart');
    }
    assert.ok(hint === '' || /^(The |In |Size )/.test(hint), code + ' hint: ' + hint);
  }
});

test('need: the hint (the size, colour, pack or make) is in the name of every product that fits', () => {
  let checked = 0;
  for (const [code, , hint, ...more] of req.need) {
    if (!hint) continue;
    const ws = PS.words(hint.replace(/^(The |In |Size )/, '').replace(/\b(the|one|pack of|in)\b/gi, ' ')).filter(Boolean);
    for (const c of [code].concat(more)) {
      const have = nameWords(c);
      for (const w of ws) assert.ok(have.has(w) || [...have].some((h) => h.startsWith(w)), c + ' hint "' + hint + '": "' + w + '" is not in its name');
    }
    checked++;
  }
  assert.ok(checked > 500, checked + ' hints');
});

test('describe: every product that fits has all the words the customer says in its name', () => {
  for (const [code, phrase, ...more] of req.describe) {
    assert.match(phrase, /^(a|an|some|a pack of \d+|a pair of) \S/, code + ': ' + phrase);
    const pk = /^a pack of (\d+) /.exec(phrase);
    const ws = PS.words(phrase.replace(/^(an?|some|a pack of \d+|a pair of)\s+/, '') + (pk ? ' ' + pk[1] + ' pack' : '')).filter(Boolean);
    for (const c of [code].concat(more)) { const have = nameWords(c); for (const w of ws) assert.ok(have.has(w), c + ' "' + phrase + '": no "' + w + '" in its name'); }
  }
});

test('requests can be found with the till\'s CrashFix search (the same as Product Search), a sample of 60', () => {
  const searcher = PS.build(items);
  const df = new Map();
  for (const it of items) {
    const all = new Set(PS.words(it.name + ' ' + (it.web || '')).filter(Boolean));
    String(it.dw || '').split(' ').forEach((w) => w && all.add(w));
    all.forEach((w) => df.set(w, (df.get(w) || 0) + 1));
  }
  for (let k = 0; k < 30; k++) {
    const [code, phrase, ...more] = req.describe[Math.floor(rnd() * req.describe.length)];
    const res = searcher.find(phrase.replace(/^(an?|some|a pack of \d+|a pair of)\s+/, ''), 40).list;
    assert.ok(res.slice(0, 10).some((r) => [code].concat(more).includes(r.item.sku)), 'describe ' + code + ' "' + phrase + '" not in the first 10');
  }
  for (let k = 0; k < 30; k++) {
    const [code, quote, hint, ...more] = req.need[Math.floor(rnd() * req.need.length)];
    const fits = [code].concat(more), it = item.get(code);
    const can = new Set(PS.words(it.name + ' ' + (it.web || '')).filter(Boolean)); String(it.dw || '').split(' ').forEach((w) => w && can.add(w));
    const words = [...new Set(PS.words(quote).filter((w) => w && w.length >= 3 && !/^\d+$/.test(w) && can.has(w)))].sort((a, b) => df.get(a) - df.get(b));
    const extra = hint ? PS.words(hint.replace(/^(The |In |Size )/, '').replace(/\b(the|one|pack of|in)\b/gi, ' ')).filter(Boolean) : [];
    const ok = [2, 3, 4].some((n) => words.length >= n && searcher.find(words.slice(0, n).concat(extra).join(' '), 40).list.slice(0, 10).some((r) => fits.includes(r.item.sku)));
    assert.ok(ok, 'need ' + code + ' "' + quote + '" ' + hint + ': its rarest words don\'t find it');
  }
});

test('made-up customers: LU8 and LU9 postcodes (they don\'t exist), example.com emails, found by postcode and surname', () => {
  for (let i = 0; i < 300; i++) {
    const c = Till.makeCustomer(rnd);
    for (const p of c.db) {
      assert.match(p.postcode, /^LU[89] [1-9][ABDEFGHJLNPQRSTUWXYZ]{2}$/);
      assert.match(p.email, /^[a-z.]+\d*@example\.(com|net|org)$/);
      assert.match(p.no, /^[1-9]\d{7}$/);
      assert.match(p.title, /^(Mr|Mrs|Ms|Miss|Dr)$/);
    }
    const found = Till.lookup(c, { postcode: c.postcode.toLowerCase().replace(' ', ''), surname: ' ' + c.surname.toUpperCase() });
    assert.ok(found.includes(c), 'postcode and surname find the customer');
    assert.equal(found.length, c.twin ? 2 : 1, 'only them, and whoever shares their address');
    if (c.twin) assert.ok(found.every((p) => p.address === c.address) && found[0].first !== found[1].first);
    assert.equal(Till.lookup(c, { postcode: 'LU7 1AA', surname: c.surname }).length, 0, 'a wrong postcode finds nobody');
    assert.ok(Till.lookup(c, { surname: c.surname.slice(0, 3) }).length >= 3, 'part of a surname finds everyone with it');
    assert.equal(Till.lookup(c, {}).length, 0, 'an empty search finds nobody');
  }
});

test('the till\'s sums: VAT included at 20% (£7.99 = £6.66 + £1.33, as on the real checkout), cash change, made-up prices', () => {
  assert.deepEqual({ ...Till.vat(799) }, { inc: 799, ex: 666, vat: 133 });
  assert.equal(Till.money(123456), '£1,234.56');
  for (const p of [99, 799, 2000, 4999, 12345]) { const t = Till.tender(p); assert.ok(t >= p && t % 500 === 0, p + ' -> ' + t); }
  for (const it of world.items.slice(0, 2000)) {
    const p = Till.price(it);
    assert.equal(p, Till.price(it), 'the same every time');
    assert.ok(p >= 29 && p <= 28000 && /(29|49|79|99)$/.test(String(p)), it.code + ' ' + p);
    assert.ok(Till.avail(it) >= 2, it.code + ' in stock');
  }
});

test('till orders: 1 to 3 different products on the shelves, asked for by code, description or need; the customer judges each line', () => {
  const kinds = { code: 0, describe: 0, need: 0 };
  for (let i = 0; i < 400; i++) {
    const lines = Till.makeOrder(world, req, rnd);
    assert.ok(lines.length >= 1 && lines.length <= 3);
    const used = new Set();
    for (const ln of lines) {
      kinds[ln.kind]++;
      assert.ok(ln.accept.includes(ln.item.code) && ln.accept.every((c) => byCode.get(c) && byCode.get(c).loc));
      ln.accept.forEach((c) => { assert.ok(!used.has(c), 'two lines want the same product'); used.add(c); });
      assert.ok(ln.qty >= 1 && ln.qty <= Till.avail(ln.item), ln.item.code + ' qty ' + ln.qty);
      assert.ok(ln.say && ln.clue, 'something to say');
      if (ln.kind === 'need') assert.ok(ln.quote);
      if (ln.kind === 'code') assert.ok(ln.say.includes(ln.item.code));
      assert.equal(Till.judge(ln, ln.item.code, ln.qty), 'right');
      assert.equal(Till.judge(ln, ln.item.code, ln.qty + 1), 'qty');
      assert.equal(Till.judge(ln, 'ZZZZZ', ln.qty), 'wrong');
    }
  }
  assert.ok(kinds.code > 100 && kinds.describe > 100 && kinds.need > 100, JSON.stringify(kinds));
});

test('the till page: Fusion and CrashFix tabs, the real search, no real usernames, addresses or Screwfix servers', () => {
  const html = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift.html'), 'utf8');
  for (const f of ['product-search/search.js', 'warehouse-shift/till.js', 'warehouse-shift/tillui.js', 'warehouse-shift/till.css']) assert.ok(html.includes(f + '?v='), f);
  assert.ok(html.indexOf('product-search/search.js') < html.indexOf('warehouse-shift/game.js') && html.indexOf('warehouse-shift/tillui.js') < html.indexOf('warehouse-shift/game.js'));
  const ui = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/tillui.js'), 'utf8'), till = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/till.js'), 'utf8');
  assert.match(ui, /data-tab="fusion"/); assert.match(ui, /data-tab="crashfix"/);
  assert.match(ui, /ProductSearch\.build/, 'CrashFix uses the Product Search page\'s own search');
  assert.match(ui, /product-search\/photos\//);
  const all = ui + till + fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/game.js'), 'utf8') + fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/till.css'), 'utf8');
  assert.ok(!/screwfix\.com/i.test(all), 'never asks Screwfix for photos');
  assert.ok(!/sfd\.net|sheehs|sheehy|LU7 1SE/i.test(all), 'nothing from the photos of the real till: its address, username or customer');
  // the till's search items are the Product Search page's: the same fields it builds in product-search/app.js
  assert.deepEqual(Object.keys(items[0]).sort(), ['desc', 'dw', 'flags', 'name', 'photo', 'sku', 'web']);
  const sw = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift-sw.js'), 'utf8');
  assert.match(sw, /requests\.json/); assert.match(sw, /product-search\\\/data/);
});
