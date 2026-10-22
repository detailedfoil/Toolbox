// NPS: the pasted-text reader (tools/nps/engine.js parseText). The page shows whatever this returns,
// so every way the NPS chat might lay the figures out should come back as the same stores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { REPO } from './load.mjs';

const NPS = createRequire(import.meta.url)(path.join(REPO, 'tools/nps/engine.js'));
const WANT = [{ name: 'Hoddesdon (UB4)', p: 120, pa: 5, d: 3 }, { name: 'Dunstable (LB1)', p: 148, pa: 12, d: 3 }];
const strip = (r) => r.stores.map(({ name, p, pa, d }) => ({ name, p, pa, d }));

test('the agreed format: date line, header, pipes, area total', () => {
  const r = NPS.parseText('NPS 22.10.2026\nStore | Promoters | Passives | Detractors\nHoddesdon (UB4) | 120 | 5 | 3\nDunstable (LB1) | 148 | 12 | 3\nArea Total | 268 | 17 | 6');
  assert.equal(r.date, '22.10.2026');
  assert.deepEqual(strip(r), WANT);
  assert.deepEqual(r.area, { name: 'Area Total', p: 268, pa: 17, d: 6 });
  assert.equal(r.areaMatches, true);
});

test('a markdown table with rank, bold, a responses column and a score', () => {
  const r = NPS.parseText('| Rank | Store | P | Pa | D | Responses | NPS |\n|---|---|---|---|---|---|---|\n| 1 | Hoddesdon (UB4) | 120 | 5 | 3 | 128 | 91.4% |\n| 2 | **Dunstable (LB1)** | 148 | 12 | 3 | 163 | 88.9% |');
  assert.deepEqual(strip(r), WANT);
  assert.equal(r.date, '');
});

test('plain lines with a score in the middle, labels, and a slash date', () => {
  const r = NPS.parseText('Data 1/9/2026\n1. Hoddesdon (UB4) 93.2% 120 5 3\n2. Dunstable (LB1): P 148, PA 12, D 3');
  assert.equal(r.date, '01.09.2026');
  assert.deepEqual(strip(r), WANT);
});

test('columns in another order follow the header', () => {
  const r = NPS.parseText('Store\tDetractors\tPromoters\tPassives\nHoddesdon (UB4)\t3\t120\t5\nDunstable (LB1)\t3\t148\t12');
  assert.deepEqual(strip(r), WANT);
});

test('a wrong area total is flagged, the site\'s own data file is accepted, rubbish is refused', () => {
  assert.equal(NPS.parseText('A (X1), 10, 1, 1\nB (X2), 10, 1, 1\nArea Total, 99, 1, 1').areaMatches, false);
  const j = NPS.parseText(JSON.stringify({ date: '19.10.2026', stores: WANT }));
  assert.deepEqual(strip(j), WANT);
  assert.throws(() => NPS.parseText('hello there'), /Couldn't find the stores/);
  assert.throws(() => NPS.parseText('A (X1), 10, 1, 1\nA (X1), 10, 1, 1'), /twice/);
});
