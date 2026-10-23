// Product Search: the list file and the search (tools/product-search/search.js), on a few made-up products and
// on the real list. Add a test here for any search that should work and didn't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, loadModule } from './load.mjs';

const PS = loadModule('tools/product-search/search.js');
const LIST = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/product-search/data/products.json'), 'utf8'));

const made = [
  { sku: '843PG', name: 'TITAN 130W CORDED Rotary tool W/ 213 PCE ACC', flags: 0 },
  { sku: '46199', name: '15mm Isolating Valve', flags: 0 },
  { sku: '65251', name: '15mm Isolating Valve Pack Of 2', flags: 0 },
  { sku: '313CC', name: '1 1/4" Telescopic P Trap', flags: 0 },
  { sku: '11822', name: '1 Gang 2 Way Lightswitch', flags: 0 },
  { sku: '53747', name: '1 5 SWA 3 Core 25m 1pk', flags: 0 },
  { sku: '38769', name: '2 5 SWA 3 Core 25m 1pk', flags: 0 },
  { sku: '73435', name: 'Elbow 15mm Pk10', flags: 0 },
  { sku: '178XG', name: 'Short Arm Hex Key Set 10pc', flags: 0 },
  { sku: '46863', name: 'Blk Socket Plug', flags: 0 },
  { sku: '20080', name: 'Sealed Lead Acid battery 12v 2 2Ah', flags: 1 },
  { sku: '1112V', name: 'Screw Extractor Set', flags: 0 },
  { sku: '451GF', name: 'Milwaukee 2x4.0ah Brushed Combi', flags: 0 },
  { sku: '21697', name: 'WD 40 Aerosol 600ml', flags: 2 },
  { sku: '9866T', name: 'WD-40 Smart Straw 450ml', flags: 2 },
  { sku: '1001X', name: 'Roughneck Bow Saw - Pointed', flags: 8, web: 'Roughneck 21" Bow Saw Pointed Tooth' },
  { sku: '19775', name: 'Mort Knob Set 2in Chrome', flags: 0 },
  { sku: '817CE', name: '1/2" Mini Cock Pack', flags: 0 },
];
const s = PS.build(made);
const skus = (q) => [...s.find(q).list].map((r) => r.item.sku);   // copied, as the sandbox's arrays don't compare equal

test('the product list is valid: unique 5 character codes, a name each, warnings as numbers', () => {
  assert.equal(LIST.items.length, LIST.count);
  assert.ok(LIST.count > 1000);
  const seen = new Set();
  for (const [sku, name, flags] of LIST.items) {
    assert.match(sku, /^(\d{3}[A-Z]{2}|\d{4}[A-Z]|\d{5})$/, 'odd code ' + sku);
    assert.ok(!seen.has(sku), 'twice: ' + sku); seen.add(sku);
    assert.ok(name && typeof name === 'string', 'no name for ' + sku);
    assert.ok(Number.isInteger(flags) && flags >= 0 && flags < 32, 'odd warnings for ' + sku);   // 16 = age restricted, from the stock list
  }
});

test('codes: whole, part, any case, letter O for zero, and a near miss', () => {
  assert.equal(skus('843PG')[0], '843PG');
  assert.equal(skus('843pg')[0], '843PG');
  assert.ok(skus('843').includes('843PG'));
  assert.equal(skus('2OO8O')[0], '20080', 'codes never contain the letter O');
  const near = s.find('46198');
  assert.equal(near.list[0].item.sku, '46199');
  assert.match(near.note, /Did you mean/);
  assert.equal(s.find('64199').list[0].item.sku, '46199', 'two swapped digits');
});

test('names: starts of words, every word needed, best match first', () => {
  assert.deepEqual(skus('isolating valve'), ['46199', '65251']);
  assert.deepEqual(skus('isol val'), ['46199', '65251']);
  assert.deepEqual(skus('valve pack 2'), ['65251']);
});

test('names: small spelling mistakes', () => {
  assert.equal(skus('isolatng valve')[0], '46199');
  assert.equal(skus('milwakee')[0], '451GF');
  assert.equal(skus('extracter')[0], '1112V');
  assert.match(s.find('milwakee').note, /close spellings/);
  assert.ok(!skus('tape').includes('817CE'), "a real word isn't stretched to other words");
});

test('names: the way the stock names are written', () => {
  assert.equal(skus('1.5 swa')[0], '53747', '1.5 is "1 5" in the names');
  assert.deepEqual(skus('elbow pack of 10'), ['73435']);
  assert.deepEqual(skus('10 pack elbow'), ['73435']);
  assert.deepEqual(skus('ptrap'), ['313CC']);
  assert.deepEqual(skus('p-trap'), ['313CC']);
  assert.deepEqual(skus('light switch'), ['11822']);
  assert.deepEqual(skus('black socket'), ['46863']);
  assert.deepEqual(skus('wd40'), ['21697', '9866T'].filter((x) => skus('wd40').includes(x)));
  assert.equal(skus('wd40').length, 2);
  assert.ok(skus('2 inch').includes('19775'));
  assert.ok(!skus('2 inch').includes('817CE'), '1/2" is not 2"');
  assert.ok(skus('1/2 inch').includes('817CE'));
});

test('names: trade words, warnings and the screwfix.com name', () => {
  assert.deepEqual(skus('allen key'), ['178XG']);
  assert.deepEqual(skus('hazardous'), [], 'the hazardous warning is no longer shown or searched');
  assert.ok(!skus('aerosol').includes('9866T') || /aerosol/i.test(made.find((m) => m.sku === '9866T').name), 'nor the aerosol one');
  assert.deepEqual(skus('aerosol'), ['21697'], 'only products with aerosol in their name');
  assert.deepEqual(skus('pointed tooth'), ['1001X']);
  assert.deepEqual(skus('21 inch bow saw'), ['1001X']);
});

test('a size like 12v shows products before codes containing 12V', () => {
  const r = s.find('12v').list;
  assert.equal(r[0].item.sku, '20080');
  assert.ok(r.some((x) => x.item.sku === '1112V' && x.how === 'sku'));
});

test('the real list: builds, and finds by code and by name quickly', () => {
  const items = LIST.items.map(([sku, name, flags]) => ({ sku, name, flags }));
  const real = PS.build(items);
  const t0 = performance.now();
  for (const q of ['isolating valve', 'p trap', '15mm elbow', 'sealent', 'screwdrivr', '843', 'dewalt drill']) assert.ok(real.find(q).total > 0, q);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, 'searches took ' + Math.round(ms) + ' ms');
  const any = LIST.items[Math.floor(LIST.items.length / 2)][0];
  assert.equal(real.find(any).list[0].item.sku, any);
});

/* ---------- the overnight name check (.github/product-search/check.mjs) against the pretend site ---------- */
import { startMock, textPage, NOT_FOUND, BOT_CHECK, LIMITED, PICTURE } from './mock-screwfix.mjs';
import { runCheck } from './run-check.mjs';

const listOf = (items) => ({ version: '2026-10-20', count: items.length, items });
const page = (code, name) => ({ text: [textPage({ code, name, price: 9.99 })], image: [PICTURE] });
const names = (out) => JSON.parse(out.files['tools/product-search/data/web-names.json']);

test('name check: saves names, notes codes with no page, cut-short names go first', async () => {
  const mock = await startMock({
    '11111': page('11111', 'Short One'),
    '22222': page('22222', 'Erbauer EID18-Li 18V Li-ion EXT Brushless Cordless Impact Driver - Bare'),
    '33333': { text: [NOT_FOUND] },
    '44444': { text: [LIMITED, textPage({ code: '44444', name: 'After A Pause', price: 1 })] },
  });
  try {
    const out = await runCheck({ check: 'product-search', mock, files: { 'tools/product-search/data/products.json': listOf([
      ['11111', 'Short One', 0], ['22222', 'ERBAUER EID18-LI 18V LI-ION EXT BRUSHLESS CORDLESS', 0], ['33333', 'Gone', 0], ['44444', 'Pause', 0]]) } });
    assert.equal(out.code, 0, out.stderr);
    const n = names(out);
    assert.equal(n.products['22222'].name, 'Erbauer EID18-Li 18V Li-ion EXT Brushless Cordless Impact Driver - Bare');
    assert.equal(n.products['11111'].name, 'Short One');
    assert.equal(n.products['33333'].missing, true);
    assert.equal(n.products['44444'].name, 'After A Pause', 'waits when jina says slow down, then reads it');
    assert.equal(n.named, 3);
    const pageReads = mock.hits.filter((h) => h.mode !== 'image');
    assert.equal(pageReads[0].code, '22222', 'the cut-short name is read first');
    assert.ok(pageReads.every((h) => h.mode === 'text'), 'only ever a text read of a page');
    assert.ok(!mock.hits.some((h) => h.mode === 'image' && h.code === '33333'), 'no photo asked for when there is no page');
    assert.match(out.commit, /\[skip ci\]/);
  } finally { await mock.close(); }
});

const QUICK = { PAUSE_MS: '1000' };   // the hour's pause, shortened for the tests

test('name check: 4 failures in a row mean an hour\'s pause, then it carries on', async () => {
  const codes = Array.from({ length: 8 }, (_, i) => String(40000 + i));
  const scen = {};
  codes.forEach((c, i) => { scen[c] = i < 4 ? { text: [BOT_CHECK] } : page(c, 'Thing ' + c); });
  const mock = await startMock(scen);
  try {
    const out = await runCheck({ check: 'product-search', mock, env: QUICK, files: { 'tools/product-search/data/products.json': listOf(codes.map((c) => [c, 'Thing ' + c, 0])) } });
    assert.equal(out.code, 0, out.stderr);
    const n = names(out);
    assert.equal(n.lastRun.pauses, 1);
    assert.equal(n.lastRun.found, 4);
    assert.equal(n.lastRun.stopped, null);
    assert.match(out.stdout, /pausing for \d+ minutes/);
  } finally { await mock.close(); }
});

test('name check: gives up after 3 pauses with nothing working, then the next run gives up at once if the first 4 fail', async () => {
  const codes = Array.from({ length: 30 }, (_, i) => String(50000 + i));
  const files = { 'tools/product-search/data/products.json': listOf(codes.map((c) => [c, 'Thing ' + c, 0])) };
  const scen = {};
  codes.forEach((c) => { scen[c] = { text: [BOT_CHECK], image: [{ status: 403, body: 'denied' }] }; });
  let mock = await startMock(scen);
  let stopped;
  try {
    const out = await runCheck({ check: 'product-search', mock, env: QUICK, files });
    assert.equal(out.code, 1, 'the run fails, so GitHub sends an email');
    stopped = names(out);
    assert.equal(stopped.lastRun.pauses, 3);
    assert.equal(stopped.lastRun.tried, 10, '4, pause, 2, pause, 2, pause, 2, give up');
    assert.ok(!mock.hits.some((h) => h.mode === 'image'), 'no photos asked for while the pages are being refused');
    assert.match(stopped.lastRun.stopped, /3 pauses/);
    assert.match(out.stdout, /::error title=Product names and photos gave up::/);
  } finally { await mock.close(); }
  // the next run while it's still refusing: gives up after the first 4, no pauses
  mock = await startMock(scen);
  try {
    const out = await runCheck({ check: 'product-search', mock, env: QUICK, files: { ...files, 'tools/product-search/data/web-names.json': stopped } });
    assert.equal(out.code, 1);
    assert.equal(names(out).lastRun.tried, 4);
    assert.equal(names(out).lastRun.pauses, 0);
  } finally { await mock.close(); }
  // and once Screwfix is fine again it carries on with everything left
  const ok = {};
  codes.forEach((c) => { ok[c] = page(c, 'Thing ' + c); });
  mock = await startMock(ok);
  try {
    const out = await runCheck({ check: 'product-search', mock, env: QUICK, files: { ...files, 'tools/product-search/data/web-names.json': stopped } });
    assert.equal(out.code, 0, out.stderr);
    const n = names(out);
    assert.equal(n.lastRun.tried, 30, 'the other 20 done, and photos for the 10 whose pages wait a week');
    assert.equal(n.lastRun.found, 20);
    assert.equal(n.lastRun.stopped, null);
    assert.equal(n.products['50000'].tries, 1);
    assert.ok(!mock.hits.some((h) => h.code === '50000' && h.mode !== 'image'), 'its page is left for a week');
  } finally { await mock.close(); }
});

test('name check: stops starting new products when the run\'s time is up, without failing', async () => {
  const mock = await startMock({ '45000': page('45000', 'Thing') });
  try {
    const out = await runCheck({ check: 'product-search', mock, env: { RUN_MINUTES: '0' }, files: { 'tools/product-search/data/products.json': listOf([['45000', 'Thing', 0]]) } });
    assert.equal(out.code, 0, out.stderr);
    assert.equal(names(out).lastRun.tried, 0);
    assert.equal(names(out).lastRun.timeUp, true);
  } finally { await mock.close(); }
});

test('name check: a page that is not the product does not count as being turned away', async () => {
  const codes = Array.from({ length: 8 }, (_, i) => String(60000 + i));
  const other = 'Title: Screwfix.com\n\nURL Source: https://www.screwfix.com/c/x\n\nMarkdown Content:\n# Screwfix\n\nShop by department\n'.repeat(3);
  const scen = {};
  codes.forEach((c) => { scen[c] = { text: [other] }; });
  const mock = await startMock(scen);
  try {
    const out = await runCheck({ check: 'product-search', mock, files: { 'tools/product-search/data/products.json': listOf(codes.map((c) => [c, 'X', 0])) } });
    assert.equal(out.code, 0);
    assert.equal(names(out).lastRun.tried, 8);
  } finally { await mock.close(); }
});

test('name check: a name that is really "URL Source: ..." is not saved, and one saved before is read again', async () => {
  const junk = 'Title: \n\nURL Source: https://www.screwfix.com/p/product/96666\n\nMarkdown Content:\nShop by department\n';
  const mock = await startMock({ '96666': { text: [junk], image: [PICTURE] }, '97777': page('97777', 'Proper Name') });
  try {
    const out = await runCheck({ check: 'product-search', mock, files: {
      'tools/product-search/data/products.json': listOf([['96666', 'Junk', 0], ['97777', 'Proper', 0]]),
      'tools/product-search/data/web-names.json': { products: { '97777': { name: 'URL Source: https://www.screwfix.com/p/product/97777', a: 0, d: 0, at: '2026-10-21', p: 1 } } } } });
    assert.equal(out.code, 0, out.stderr);
    const n = names(out).products;
    assert.equal(n['96666'].name, undefined);
    assert.equal(n['96666'].tries, 1, 'counted as a failed read, tried again in a week');
    assert.equal(n['97777'].name, 'Proper Name', 'the bad one saved before is read again');
  } finally { await mock.close(); }
});

test('photo check: saves each photo as <CODE>.jpg, tells the page which ones it has, and asks once per product', async () => {
  const mock = await startMock({
    '71111': { text: [textPage({ code: '71111', name: 'Has A Photo', price: 5 })], image: [PICTURE] },
    '72222': { text: [textPage({ code: '72222', name: 'Photo Missing', price: 5 })], image: [{ status: 404, body: 'none' }] },
  });
  try {
    const files = { 'tools/product-search/data/products.json': listOf([['71111', 'Has A Photo', 0], ['72222', 'Photo Missing', 0]]) };
    const out = await runCheck({ check: 'product-search', mock, files });
    assert.equal(out.code, 0, out.stderr);
    const n = names(out);
    assert.equal(n.products['71111'].p, 1);
    assert.ok('tools/product-search/photos/71111.jpg' in out.files, 'the photo file is written');
    assert.ok(!('tools/product-search/photos/72222.jpg' in out.files));
    assert.equal(n.products['72222'].name, 'Photo Missing', 'a missing photo does not lose the name');
    assert.equal(n.products['72222'].pn, 1);
    assert.equal(n.photos, 1);
    assert.equal(n.lastRun.nophoto, 1);
    assert.equal(out.code, 0, "a 404 photo isn't being turned away");
  } finally { await mock.close(); }
});

test('photo check: a product whose name is already known only needs its photo, and the image server refusing makes it give up', async () => {
  const codes = Array.from({ length: 12 }, (_, i) => String(80000 + i));
  const scen = {};
  codes.forEach((c) => { scen[c] = { image: [{ status: 403, body: 'denied' }] }; });
  const mock = await startMock(scen);
  try {
    const known = {}; codes.forEach((c) => { known[c] = { name: 'Known ' + c, a: 0, d: 0, at: '2026-10-19' }; });
    const out = await runCheck({ check: 'product-search', mock, env: QUICK, files: {
      'tools/product-search/data/products.json': listOf(codes.map((c) => [c, 'Known ' + c, 0])),
      'tools/product-search/data/web-names.json': { products: known } } });
    assert.equal(out.code, 1, 'the run fails so GitHub sends an email');
    assert.equal(names(out).lastRun.tried, 10);
    assert.match(names(out).lastRun.stopped, /image server: HTTP 403/);
    assert.ok(mock.hits.every((h) => h.mode === 'image'), 'the names were known, so no page was read');
  } finally { await mock.close(); }
});

test('photo sweep: fetches every missing photo first and quickly, then reads names, without asking for a photo twice', async () => {
  const codes = ['75001', '75002', '75003', '75004'];
  const scen = {};
  codes.forEach((c, i) => { scen[c] = { text: [textPage({ code: c, name: 'Sweep ' + c, price: 4 })], image: [i === 3 ? { status: 404, body: 'none' } : PICTURE] }; });
  const mock = await startMock(scen);
  try {
    const out = await runCheck({ check: 'product-search', mock, env: { PHOTO_SWEEP: 'on' }, files: { 'tools/product-search/data/products.json': listOf(codes.map((c) => [c, 'Sweep ' + c, 0])) } });
    assert.equal(out.code, 0, out.stderr);
    const n = names(out);
    assert.equal(n.photos, 3);
    assert.equal(n.named, 4);
    const firstPage = mock.hits.findIndex((h) => h.mode !== 'image');
    assert.ok(firstPage >= 4 && mock.hits.slice(0, 4).every((h) => h.mode === 'image'), 'all four photos asked for before any page is read');
    assert.equal(mock.hits.filter((h) => h.mode === 'image').length, 4, 'each photo asked for once');
    assert.match(out.stdout, /photo sweep: 4 photos to fetch/);
  } finally { await mock.close(); }
});

test('photo sweep: 3 refusals in a row stop it for this run, the names carry on, and the run does not fail', async () => {
  const codes = Array.from({ length: 8 }, (_, i) => String(76000 + i));
  const scen = {};
  codes.forEach((c) => { scen[c] = { text: [textPage({ code: c, name: 'Sweep ' + c, price: 4 })], image: [{ status: 403, body: 'denied' }] }; });
  const mock = await startMock(scen);
  try {
    const out = await runCheck({ check: 'product-search', mock, env: { PHOTO_SWEEP: 'on' }, files: { 'tools/product-search/data/products.json': listOf(codes.map((c) => [c, 'Sweep ' + c, 0])) } });
    assert.equal(out.code, 0, out.stderr);
    assert.equal(mock.hits.filter((h) => h.mode === 'image').length, 3, 'stopped after 3');
    assert.equal(names(out).named, 8, 'the names still got read');
    assert.equal(mock.hits.filter((h) => h.mode === 'image').length, 3, 'and no more photos asked for while reading them');
    assert.match(names(out).lastRun.photoSweepStopped, /HTTP 403/);
    assert.match(out.stdout, /::warning title=Product photos turned away::/);
  } finally { await mock.close(); }
});

// a product page as jina gives it, with Screwfix's age notice under the heading when notice is true, and a promotional red box
// further up that mentions proof of age (as on the pages the old whole-page check wrongly flagged, 23 Oct 2026)
const MORE = '\n[More Info](https://www.screwfix.com/p/x/CODE#product_additional_details_container)\n';
const notice = 'We operate a Challenge 25 policy in all our stores and may be asked for proof of age upon collection. You must be 18 years old or over to buy this product.';
const withNotice = (code, name, on, promo) => textPage({ code, name, price: 3 }).replace('# ' + name + ' (' + code + ')',
  (promo ? 'Win a prize! Over 18s only, bring proof of age to enter our Challenge 25 draw.\n\n' : '') + '# ' + name + ' (' + code + ')\n\n(120)\n\n' + (on ? notice + '\n\n' : '') + 'A useful product.\n' + MORE.replace('CODE', code));

test('age check: only the notice under the heading counts, not promotional boxes, and products flagged by the old check are read again', async () => {
  const mock = await startMock({
    '91111': { text: [withNotice('91111', 'Craft Knife', true, false)], image: [PICTURE] },
    '92222': { text: [withNotice('92222', 'Plain Product', false, false)], image: [PICTURE] },
    '93333': { text: [withNotice('93333', 'Named Before', false, false)], image: [PICTURE] },
    '94444': { text: [withNotice('94444', 'Promo Box Tape', false, true)], image: [PICTURE] },
    '95555': { text: [withNotice('95555', 'Flagged Wrongly', false, true)], image: [PICTURE] },
    '96666': { text: [withNotice('96666', 'Really Restricted', true, true)], image: [PICTURE] },
  });
  try {
    const out = await runCheck({ check: 'product-search', mock, files: {
      'tools/product-search/data/products.json': listOf([['91111', 'Craft Knife', 8], ['92222', 'Plain', 0], ['93333', 'Named Before', 0], ['94444', 'Tape', 0], ['95555', 'Flagged', 0], ['96666', 'Restricted', 0]]),
      'tools/product-search/data/web-names.json': { products: { '93333': { name: 'Named Before', at: '2026-10-19' },
        '95555': { name: 'Flagged Wrongly', a: 1, d: 1, at: '2026-10-22', p: 1 } } } } });
    assert.equal(out.code, 0, out.stderr);
    const n = names(out).products;
    assert.equal(n['91111'].a, 1);
    assert.match(n['91111'].an, /^Challenge 25 policy|^challenge 25 policy/i, 'its words are kept so a wrong one can be seen');
    assert.equal(n['92222'].a, 0);
    assert.equal(n['93333'].a, 0, 'read again to find out');
    assert.equal(n['94444'].a, 0, 'a promotional box that mentions proof of age is not the notice');
    assert.equal(n['95555'].a, 0, 'flagged by the old whole-page check: read again, and cleared');
    assert.equal(n['95555'].an, undefined);
    assert.equal(n['96666'].a, 1);
    assert.ok(mock.hits.some((h) => h.code === '95555' && h.mode === 'text'));
  } finally { await mock.close(); }
});

/* ---------- descriptions (.github/product-search/describe.mjs), on real pages as jina gave them (21 Oct 2026) ---------- */
const { describe, ageNotice } = await import('../product-search/describe.mjs');
const fixture = (c) => fs.readFileSync(path.join(REPO, '.github/tests/fixtures/page-' + c + '.txt'), 'utf8');

test('age notice: real pages with no notice give none, a page with Screwfix\'s notice gives its words', () => {
  for (const c of ['16497', '10048']) assert.equal(ageNotice(fixture(c), c), '', c);
  assert.match(ageNotice(fixture('123XR'), '123XR'), /^Challenge 25 policy in all our stores.*to buy this product/, 'a real age restricted page');
  const text = fixture('16497').replace(/(^#\s+.*\(16497\)\s*$)/m, '$1\n\n(5209)\n\n' + notice + '\n');
  assert.match(ageNotice(text, '16497'), /^Challenge 25 policy in all our stores.*to buy this product/);
  assert.equal(ageNotice(fixture('16497') + '\nChallenge 25: bring proof of age. You must be 18 years old or over to buy this.\n', '16497'), '', 'outside the product section does not count');
});

test('description: the paragraph and the feature bullets, exactly as on the page', () => {
  const d = describe(fixture('16497'), '16497');
  assert.equal(d.t, 'Top quality, waxed single thread, multipurpose screw. Popular with the professional. Features a lower screw-in torque and faster drive speed. Suitable for screwdrivers, combi drills and impact drivers.');
  assert.deepEqual([...d.b], ['Double-Countersunk Head for Reduced Shear', 'Carbon Steel Construction', 'Zinc-Plated & Yellow-Passivated', 'Wax-Coated',
    'Deep, Sharp, Single Thread for Cutting Cleanly through Wood', 'Fully Threaded', 'For Wood, Plastic, Masonry & 1mm Sheet Metal',
    'Heat-Treated for Snap Resistance', 'Corrosion-Resistant']);
});

test('description: leaves out the Challenge 25 sentence and the green star badge link', () => {
  const sharpie = describe(fixture('123XR'), '123XR');
  assert.match(sharpie.t, /^Quick-drying, water-resistant ink\./);
  assert.doesNotMatch(sharpie.t, /Challenge 25|proof of age/i);
  assert.deepEqual([...sharpie.b], ['Fibre Tip', 'Solvented', 'Fade & Water-Resistant Dye-Based Ink', 'Clip-Cap']);
  const dewalt = describe(fixture('10048'), '10048');
  assert.match(dewalt.t, /^DEWALT 18V XR brushless/);
  assert.doesNotMatch(dewalt.t, /Extending product lifecycles|media\.screwfix|\]\(/);
  assert.equal(dewalt.b.length, 10);
  assert.equal(dewalt.b[9], '3.2° Oscillating Angle for Cutting');
});

test('description: none for a page without one, another product\'s page, or no page', () => {
  assert.equal(describe(textPage({ code: '11111', name: 'Plain', price: 1 }), '11111'), null);
  assert.equal(describe(fixture('16497'), '17178'), null, "the heading is for a different code");
  assert.equal(describe('', '16497'), null);
});

test('description check: saved as descriptions/<CODE>.json with d: 1, d: 0 when the page has none, and named products are read again for it', async () => {
  const mock = await startMock({
    '16497': { text: [fixture('16497')], image: [PICTURE] },
    '94444': page('94444', 'No Description Here'),
  });
  try {
    const out = await runCheck({ check: 'product-search', mock, files: {
      'tools/product-search/data/products.json': listOf([['16497', 'Goldscrew 5x50 200pk', 0], ['94444', 'No Desc', 0]]),
      'tools/product-search/data/web-names.json': { products: { '16497': { name: 'Goldscrew', a: 0, at: '2026-10-20', p: 1 } } } } });
    assert.equal(out.code, 0, out.stderr);
    const n = names(out);
    assert.equal(n.products['16497'].d, 1);
    assert.equal(n.products['94444'].d, 0);
    assert.equal(n.described, 1);
    const saved = JSON.parse(out.files['tools/product-search/descriptions/16497.json']);
    assert.equal(saved.b[0], 'Double-Countersunk Head for Reduced Shear');
    assert.ok(!('tools/product-search/descriptions/94444.json' in out.files));
    assert.ok(mock.hits.some((h) => h.code === '16497' && h.mode === 'text'), 'read again for its description');
    const dw = JSON.parse(out.files['tools/product-search/data/desc-words.json']).products;
    const w16497 = dw['16497'].split(' ');
    assert.ok(w16497.includes('wax') && w16497.includes('carbon') && w16497.includes('masonry'), 'the description words, cut up as search.js does');
    assert.ok(!w16497.includes('goldscrew'), 'words already in the names are left out');
    assert.ok(!w16497.includes('suitable') && !w16497.includes('50') && !w16497.includes('for'), 'no filler words or bare numbers');
    assert.ok(!('94444' in dw), 'nothing for a product without a description');
  } finally { await mock.close(); }
});

test('search: titles and alternative names always come before description matches', () => {
  const t = PS.build([
    { sku: '11111', name: 'Plain Screws 5x50', web: 'Goldscrew Screws 5mm x 50mm', flags: 0, dw: 'wax coated carbon steel' },
    { sku: '22222', name: 'Wax Coated Screws 4x40', flags: 0 },
    { sku: '33333', name: 'Screws 3x30', web: 'Wax Finish Screws 3mm x 30mm', flags: 0 },
    { sku: '44444', name: 'Shellac Primer 1L', flags: 0, dw: 'stain killer sealer odour' },
    { sku: '55555', name: 'Odour Killer Spray', flags: 2 },
    { sku: '66666', name: 'Primer 2.5L', flags: 0, dw: 'touch dry 20mins recoatable' },
  ]);
  const hits = (q) => [...t.find(q).list].map((r) => r.item.sku + ':' + r.how);
  assert.deepEqual(hits('wax'), ['22222:name', '33333:name', '11111:desc'], 'title and alternative name first, the description last');
  assert.deepEqual(hits('wax screws'), ['22222:name', '33333:name', '11111:desc']);
  assert.deepEqual(hits('odour'), ['55555:name', '44444:desc']);
  assert.deepEqual(hits('primer odour'), ['44444:desc'], 'one word in the name, one in the description');
  assert.deepEqual(hits('recoat'), ['66666:desc'], 'the start of a word in a description');
  assert.deepEqual(hits('20'), [], 'a number alone never matches a description');
  assert.deepEqual(hits('stain kil'), ['44444:desc']);
  assert.equal(t.find('wax').note, '', 'no "close spellings" note when the description had it');
});

test('search: a product code is not looked for in descriptions', () => {
  const t = PS.build([{ sku: '843PG', name: 'Rotary Tool', flags: 0 }, { sku: '11111', name: 'Bits', flags: 0, dw: '843pg compatible' }]);
  assert.deepEqual([...t.find('843PG').list].map((r) => r.item.sku), ['843PG']);
});

test('search: age restricted products can be found by "age restricted" or "challenge 25"', () => {
  const t = PS.build([{ sku: '11111', name: 'Craft Knife', flags: 16 }, { sku: '22222', name: 'Craft Scissors', flags: 0 }]);
  assert.deepEqual([...t.find('age restricted').list].map((r) => r.item.sku), ['11111']);
  assert.deepEqual([...t.find('challenge 25').list].map((r) => r.item.sku), ['11111']);
});
