// Warehouse Shift stage 4 (21 Nov 2026, detailedfoil): paying cash opens the till drawer and you count the change out,
// note by note and coin by coin; the order only finishes when it's right. The drawer itself is in tillui.js (tried in
// headless Chrome); these are the sums it relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, loadModule } from './load.mjs';

const Till = loadModule('tools/warehouse-shift/till.js');

test('a cash customer always hands over more than the total, in real notes, so there is always change to count', () => {
  for (let p = 1; p <= 60000; p += 37) {
    const g = Till.tender(p, { up: p % 2 === 0 }), notes = Till.notesFor(g);
    assert.ok(g > p, p + ' -> ' + g);
    assert.equal(notes.reduce((a, b) => a + b, 0), g, 'the notes add up to what they gave');
    assert.ok(notes.every((n) => [500, 1000, 2000, 5000].includes(n)));
    assert.ok(notes.length <= 12, g + ': ' + notes.length + ' notes');
  }
  for (const p of [500, 1000, 2000, 5000]) assert.ok(Till.tender(p) > p, 'exactly ' + Till.money(p) + ' still gets a bigger note');
});

test('the drawer holds every note and coin, and any change can be made from it', () => {
  assert.deepEqual([...Till.DENOMS], [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]);
  assert.deepEqual([...Till.DENOMS].map(Till.denomName), ['£50', '£20', '£10', '£5', '£2', '£1', '50p', '20p', '10p', '5p', '2p', '1p']);
  for (let due = 1; due < 5000; due++) {
    let left = due;
    for (const d of Till.DENOMS) while (left >= d) left -= d;
    assert.equal(left, 0);
  }
});

test('the drawer page: a slot for every denomination, Start over and Give change, nothing finishes cash without it', () => {
  const ui = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/tillui.js'), 'utf8');
  for (const d of [500, 1000, 2000, 5000]) assert.ok(ui.includes('[500, 1000, 2000, 5000]'), 'notes ' + d);
  assert.ok(ui.includes('[200, 100, 50, 20, 10, 5, 2, 1]'), 'coins');
  assert.ok(ui.includes('data-act="drstart"') && ui.includes('data-act="drgive"'));
  assert.ok(!ui.includes("case 'change'"), 'the old one-tap Change given button is gone');
  assert.equal((ui.match(/complete\('cash'\)/g) || []).length, 2, 'only the drawer, or exact money, finishes a cash sale');
  assert.match(ui, /if \(sum !== c\.due\) \{[^}]*s\.slips\+\+/, 'wrong change counts against a perfect pick');
});

test('cash customers: about 1 in 5 give the exact money, everyone else a whole note (never odd pence), usually the smallest one that covers it', () => {
  let n = 0, exact = 0, up = 0, seed = 7;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  while (n < 3000) {
    const pay = Till.payment(r); if (pay.how !== 'cash') continue;
    n++;
    const inc = 1 + Math.floor(r() * 30000), g = Till.tender(inc, pay);
    if (pay.exact) { exact++; assert.equal(g, inc); continue; }
    assert.ok(g > inc && g % 500 === 0 && [500, 1000, 2000, 5000, 10000, 15000, 20000].includes(g) || g > inc && g % 5000 === 0, inc + ' -> ' + g);
    if (pay.up) up++;
  }
  assert.ok(exact / n > 0.16 && exact / n < 0.24, 'exact ' + (exact / n));
  assert.ok(up / n > 0.15 && up / n < 0.32, 'next note up ' + (up / n));
});
