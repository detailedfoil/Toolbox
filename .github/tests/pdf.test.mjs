// The three PDF makers (price tickets, A4 posters, the Monday check sheets) still make PDFs a printer can
// open: every object where the index says, every stream the length it says, the right number of pages.
// They don't check the look: the ticket and poster engines are ports that must match the originals exactly
// (see the note at the top of ticket-engine.js), so changes there are made on purpose and looked at by eye.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadModule, readBytes, REPO } from './load.mjs';

/* -> {pages, text: every content stream, unpacked} after checking the file's structure */
function openPdf(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4\n') && s.endsWith('%%EOF\n'), 'starts and ends like a PDF');
  const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)[1]);
  const rows = s.slice(xref).split('\n');
  assert.equal(rows[0], 'xref');
  const count = Number(/^0 (\d+)$/.exec(rows[1])[1]);
  for (let n = 1; n < count; n++) assert.ok(s.startsWith(`${n} 0 obj\n`, Number(rows[2 + n].slice(0, 10))), `object ${n} is where the index says`);
  let text = '';
  for (const m of s.matchAll(/<< \/Length (\d+)([^>]*?)>>\nstream\n/g)) {
    const at = m.index + m[0].length, len = Number(m[1]);
    assert.equal(s.slice(at + len, at + len + 10), '\nendstream', 'a stream is as long as it says');
    const body = Buffer.from(s.slice(at, at + len), 'latin1');
    if (!/\/Length1/.test(m[2])) text += (/FlateDecode/.test(m[2]) ? zlib.inflateSync(body) : body).toString('latin1') + '\n';
  }
  return { pages: Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s)[1]), text };
}

test('price tickets: six to an A4 page, the bold font only in when a sale ticket needs it', async () => {
  const E = loadModule('tools/price-tickets/ticket-engine.js');
  const engine = new E.Engine(loadModule('tools/price-tickets/font-data.js'), readBytes('tools/price-tickets/fonts/BarlowCondensed-ExtraBold.ttf'),
    readBytes('tools/price-tickets/fonts/BarlowSemiCondensed-Regular.ttf'), readBytes('tools/price-tickets/fonts/BarlowSemiCondensed-ExtraBold.ttf'));
  const plain = { code: '843PG', price: '£12.99', product: 'Stanley FatMax Claw Hammer 16oz' };
  const tickets = [plain, { code: '555GT', price: '£24.99', product: 'Gas Torch Kit', age: true },
    { code: '132KH', price: '£31.99', was: '£39.99', product: 'Lawn Seed 10kg' }, plain, plain, plain, plain];
  tickets.forEach((t) => assert.equal(engine.check(t), null));
  const sale = openPdf(await engine.render(tickets, { date: '17_10_26' }));
  assert.equal(sale.pages, 2);
  const noSale = await engine.render([plain], { date: '17_10_26' });
  assert.equal(openPdf(noSale).pages, 1);
  assert.doesNotMatch(Buffer.from(noSale).toString('latin1'), /\/F3 /);
  assert.equal(E.saleOf('£29.99', '£39.99').flash, 'SAVE 25%');
  assert.match(engine.check({ code: '843PG', price: '12.9', product: 'x' }).message, /Bad price/);
});

test('A4 posters: one page each', async () => {
  const E = loadModule('tools/posters/poster-engine.js');
  const engine = new E.Engine(loadModule('tools/posters/font-data.js'), readBytes('tools/posters/fonts/BarlowSemiCondensed-ExtraBold.ttf'),
    readBytes('tools/posters/fonts/BarlowSemiCondensed-Medium.ttf'));
  const posters = [{ code: '872RE', price: '£89.99', product: 'Makita Cordless Drill', pos: 'middle', scale: 1, image: null },
    { code: '590FK', price: '£19.99', was: '£29.99', product: 'Gas Cartridge\n4 Pack', age: true, pos: 'top', scale: 0.8, image: null }];
  posters.forEach((p) => assert.equal(engine.check(p), null));
  assert.equal(openPdf(await engine.render(posters, { date: '17_10_26' })).pages, 2);
});

test('Monday check sheets: the full list and the changes, from the real shop plan', async () => {
  const Sheet = loadModule('tools/shelf-check/sheet-engine.js');
  const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO, 'tools/shelf-check/data', f), 'utf8'));
  const plan = read('plan.json'), prices = read('prices.json');
  const products = JSON.parse(JSON.stringify(prices.products));
  const [up, down, gone] = Sheet.places(plan.bays).map((s) => s.code).filter((c, i, all) => all.indexOf(c) === i);
  products[up] = { ...products[up], status: 'changed', price: 20, prev: 10 };
  products[down] = { ...products[down], status: 'changed', price: 5, prev: 10 };
  products[gone] = { ...products[gone], status: 'not_found' };
  const data = { plan, bays: plan.bays, products, checked: prices.checked, previous_checked: prices.previous_checked, complete: true };
  const full = openPdf(await Sheet.build(data, { changesOnly: false }));
  assert.ok(full.pages >= 1);
  const changes = openPdf(await Sheet.build(data, { changesOnly: true }));
  assert.ok(changes.pages >= 1);
  for (const c of [up, down]) assert.match(changes.text, new RegExp('\\(' + c + '\\)'), `${c} is on the changes sheet`);
});
