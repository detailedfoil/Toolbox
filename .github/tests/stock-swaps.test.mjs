// Stock Swaps: the plans file has a plan for every slider step, every plan keeps its own rules (no store gives more
// than it can spare or gets more than it's short, every run fits the slider and clears the bar), and Your store
// shows a store's part of it. Read with the page's own plan.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from './load.mjs';

const require = createRequire(import.meta.url);
const P = require(path.join(REPO, 'tools/stock-swaps/plan.js'));
const doc = () => P.setup(JSON.parse(fs.readFileSync(path.join(REPO, 'tools/stock-swaps/data/plans.json'), 'utf8')));
const page = () => fs.readFileSync(path.join(REPO, 'tools/stock-swaps.html'), 'utf8');

test('the plans file has a plan for every slider step, with and without Swaps only', () => {
  const d = doc();
  assert.equal(d.stores.length, 22, 'Area 20 has 22 stores');
  for (const s of d.stores) assert.ok(s.name && s.lat > 51.4 && s.lat < 52.3 && s.lng > -0.9 && s.lng < 0.5, s.name + ' is placed off the map');
  assert.ok(d.items.length > 0 && d.stockDate && d.sales && d.days > 0);
  for (const k of ['spare', 'need', 'low']) {
    assert.equal(d[k].length, d.stores.length, k);
    d[k].forEach((row) => assert.equal(row.length, d.items.length, k));
  }
  const html = page();
  const [lo, hi, step] = d.rules.steps;
  assert.deepEqual(d.steps, Array.from({ length: (hi - lo) / step + 1 }, (_, i) => lo + i * step));
  assert.match(html, new RegExp('id="mins" min="' + lo + '" max="' + hi + '" step="' + step + '"'), "the slider's range matches the plans");
  for (const mode of ['all', 'swaps']) {
    assert.equal(d.index[mode].length, d.steps.length, mode);
    d.index[mode].forEach((k) => assert.ok(d.plans[k], mode + ': no plan ' + k));
  }
});

test('every plan keeps its rules', () => {
  const d = doc(), R = d.rules;
  for (const swaps of [false, true]) {
    for (const m of d.steps) {
      const p = P.plan(d, m, swaps), where = (swaps ? 'swaps only, ' : '') + m + ' min: ';
      const out = d.stores.map(() => d.items.map(() => 0)), got = d.stores.map(() => d.items.map(() => 0));
      p.runs.forEach((r, i) => {
        const run = where + d.stores[r.a].name + ' / ' + d.stores[r.b].name;
        assert.equal(r.rank, i + 1);
        assert.ok(r.a !== r.b && r.mins <= m, run + ' is a ' + r.mins + ' min round trip');
        assert.ok(r.tier <= 2 && r.units >= R.minUnits && r.score >= R.minScore - 1e-9, run + ' is not worth the trip but is in the plan');
        assert.ok(r.ab >= r.ba, run + ': the store named first sends the most');
        if (swaps) assert.ok(r.swap, run + ' is not a swap');
        if (i) assert.ok(p.runs[i - 1].tier < r.tier || (p.runs[i - 1].tier === r.tier && p.runs[i - 1].score >= r.score), run + ' is out of order');
        r.lines.forEach((l) => { assert.ok(l.qty > 0); out[l.from][l.item] += l.qty; got[l.to][l.item] += l.qty; });
      });
      d.stores.forEach((s, k) => d.items.forEach((it, i) => {
        assert.ok(out[k][i] <= d.spare[k][i], where + s.name + ' gives ' + out[k][i] + ' ' + it + ' but can spare ' + d.spare[k][i]);
        assert.ok(got[k][i] <= d.need[k][i], where + s.name + ' gets ' + got[k][i] + ' ' + it + ' but is short ' + d.need[k][i]);
      }));
      p.skip.forEach((r) => {
        assert.equal(r.tier, 3);
        assert.ok(r.mins <= m && (r.units < R.minUnits || r.score < R.minScore - 1e-9 || (swaps && Math.min(r.ab, r.ba) < R.swapMin)), where + 'a run under Not worth your time is worth it');
      });
    }
  }
});

test('Your store shows only that store\'s runs, numbered from 1, with what it sends and gets', () => {
  const d = doc(), p = P.plan(d, 90, false);
  for (let s = 0; s < d.stores.length; s++) {
    const mine = P.forStore(p, s), all = p.runs.filter((r) => r.a === s || r.b === s);
    assert.equal(mine.runs.length, all.length, d.stores[s].name);
    mine.runs.forEach((r, i) => { assert.ok(r.a === s || r.b === s); assert.equal(r.rank, i + 1); assert.ok(r.areaRank >= r.rank); });
    const t = P.totals(mine.runs, s);
    assert.equal(t.sends + t.gets, t.units, d.stores[s].name + ': sends and gets add up');
    mine.skip.forEach((r) => assert.ok(r.a === s || r.b === s));
  }
  assert.ok(p.runs.length > 0, 'the area plan at 90 minutes has runs');
});

test('the score: units a van hour, with the drive plus loading time, and swapped units counting 1.5', () => {
  const R = doc().rules;
  const hour = 60 - R.handling;                                   // a drive that makes the run one hour
  assert.equal(P.score(30, 0, hour, R), 30);
  assert.equal(P.score(20, 10, hour, R), 20 + 2 * R.swapBonus * 10);
  assert.equal(P.tierOf(30, R.tiers[0], R), 0);
  assert.equal(P.tierOf(30, R.tiers[1], R), 1);
  assert.equal(P.tierOf(30, R.tiers[2], R), 2);
  assert.equal(P.tierOf(R.minUnits - 1, 99, R), 3, 'too few units');
  assert.equal(P.tierOf(30, R.minScore - 0.1, R), 3, 'too slow');
  const d = doc();
  assert.equal(d.steps[P.stepIndex(d, 92)], 90);
  assert.equal(d.steps[P.stepIndex(d, 999)], d.steps[d.steps.length - 1]);
});

test('anyone with the link can open the page (no sign-in), and it has a tile', () => {
  assert.doesNotMatch(page(), /auth(-data)?\.js/, 'detailedfoil asked for no password on this page');
  assert.match(fs.readFileSync(path.join(REPO, 'tools.js'), 'utf8'), /url: "tools\/stock-swaps\.html"/);
});

test('the stock notice says today, yesterday, days ago or the date', () => {
  const at = (y, m, d, h = 13) => new Date(y, m - 1, d, h, 30);
  assert.equal(P.stockAge('19.11.2026', at(2026, 11, 19)).text, 'STOCK LAST UPDATED 6:00AM TODAY 19.11.2026');
  assert.equal(P.stockAge('19.11.2026', at(2026, 11, 20, 0)).text, 'STOCK LAST UPDATED 6:00AM YESTERDAY 19.11.2026');
  assert.equal(P.stockAge('19.11.2026', at(2026, 11, 22)).text, 'STOCK LAST UPDATED 6:00AM 3 DAYS AGO 19.11.2026');
  assert.equal(P.stockAge('19.11.2026', at(2026, 12, 25)).text, 'STOCK LAST UPDATED 6:00AM ON 19.11.2026');
  assert.equal(P.stockAge('30.12.2026', at(2027, 1, 1)).text, 'STOCK LAST UPDATED 6:00AM 2 DAYS AGO 30.12.2026');
});

test('Best for each store: every store\'s own plan keeps the rules, as if nobody else swaps', () => {
  const d = doc(), R = d.rules;
  for (const mode of ['all', 'swaps']) {
    assert.equal(d.mine[mode].length, d.steps.length, mode);
    d.mine[mode].forEach((row) => { assert.equal(row.length, d.stores.length); row.forEach((k) => assert.ok(d.plans[k])); });
  }
  let any = 0;
  for (const swaps of [false, true]) {
    for (const m of d.steps) {
      for (let s = 0; s < d.stores.length; s++) {
        const p = P.planFor(d, m, swaps, s), where = (swaps ? 'swaps only, ' : '') + m + ' min, ' + d.stores[s].name + ': ';
        const out = d.stores.map(() => d.items.map(() => 0)), got = d.stores.map(() => d.items.map(() => 0));
        p.runs.forEach((r, i) => {
          any++;
          assert.ok(r.a === s || r.b === s, where + 'a run without this store');
          assert.equal(r.rank, i + 1);
          assert.ok(r.mins <= m && r.tier <= 2 && r.units >= R.minUnits && r.score >= R.minScore - 1e-9, where + 'a run that breaks the rules');
          if (swaps) assert.ok(r.swap, where + 'not a swap');
          r.lines.forEach((l) => { out[l.from][l.item] += l.qty; got[l.to][l.item] += l.qty; });
        });
        d.stores.forEach((st, k) => d.items.forEach((it, i) => {
          assert.ok(out[k][i] <= d.spare[k][i], where + st.name + ' gives more ' + it + ' than it can spare');
          assert.ok(got[k][i] <= d.need[k][i], where + st.name + ' gets more ' + it + ' than it is short');
        }));
        p.skip.forEach((r) => assert.ok((r.a === s || r.b === s) && r.tier === 3));
      }
    }
  }
  assert.ok(any > 0, 'some store has runs');
});



test('Directions: from the store that gets more to the one that gets less; with a store picked, from that store', () => {
  const run = { a: 3, b: 7, lines: [{ from: 3, to: 7, qty: 5 }, { from: 7, to: 3, qty: 9 }] };
  assert.deepEqual(P.route(run, -1), [3, 7]);
  assert.deepEqual(P.route({ a: 3, b: 7, lines: [{ from: 3, to: 7, qty: 12 }] }, -1), [7, 3]);
  assert.deepEqual(P.route(run, 7), [7, 3]);
  assert.deepEqual(P.route(run, 3), [3, 7]);
});
