// The two GitHub price checks, run start to finish against the pretend site (see scenarios.mjs for what it
// says about each made-up product). These are the scripts that run every night and every Monday with no one
// watching, so this is where a mistake would otherwise only show up as a missed or wrong price on the pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMock, textPage, wholePage, LIMITED } from './mock-screwfix.mjs';
import { runCheck } from './run-check.mjs';
import * as S from './scenarios.mjs';

const { P } = S;
const today = S.londonDate(), week = S.mondayOf(today);
const SHELF = 'tools/shelf-check/data/', COUNTER = 'tools/counter-trial/data/';

/* run one check against the pretend site -> its result, plus every request it made (hits) */
async function run(check, { site = S.site(), ...opts }) {
  const mock = await startMock(site);
  try {
    const r = await runCheck({ check, mock, ...opts });
    r.hits = mock.hits;
    r.json = (f) => JSON.parse(r.files[f]);
    // jina only has the whole page once a normal read has rendered it; asked first, it gets Screwfix's bot check
    mock.hits.forEach((h, i) => {
      if (h.mode === 'html') assert.ok(mock.hits.slice(0, i).some((x) => x.code === h.code && x.mode === 'text'), `asked jina for the whole page of ${h.code} before reading its text`);
    });
    return r;
  } finally {
    await mock.close();
  }
}
const read = (r) => [...new Set(r.hits.map((h) => h.code))];
const shelfFiles = (prices = S.shelfPrices(), more = {}) => ({ [SHELF + 'plan.json']: S.shelfPlan(), [SHELF + 'prices.json']: prices, ...more });
const counterFiles = (prices = S.counterPrices(), plan = S.counterPlan()) => ({ [COUNTER + 'plan.json']: plan, [COUNTER + 'prices.json']: prices });

/* ---------- the Monday shelf check ---------- */

test('Monday check: reads every line, saves the new prices, and only believes a new price the product data confirms', async () => {
  // a complete device check since last Monday read the offer at £20.00, so that's what it's compared with now
  const before = S.shelfPrices();
  before.products[P.OFFER].price = 18;
  const phone = { readings: { [P.OFFER]: { price: 20, name: 'Offer Widget', was: null, at: '2026-01-06T10:00:00.000Z', base: 18, run: 'R1' } }, done: { R1: '2026-01-05' } };
  const r = await run('shelf-check', { mode: 'auto', files: shelfFiles(before, { [SHELF + 'phone.json']: phone }) });
  assert.equal(r.code, 0, r.stderr);
  const { products: p, run: info } = r.json(SHELF + 'prices.json');
  assert.deepEqual([p[P.STEADY].price, p[P.STEADY].status], [9.99, 'ok']);
  assert.deepEqual([p[P.UP].price, p[P.UP].prev, p[P.UP].status], [12.99, 9.99, 'changed']);
  assert.deepEqual([p[P.OTHER].price, p[P.OTHER].status], [14, 'unchecked'], "an unconfirmed new price isn't a change");
  assert.equal(p[P.GONE].status, 'not_found');
  assert.deepEqual([p[P.BUSY].price, p[P.BUSY].status], [5, 'ok'], 'read after jina said slow down');
  assert.deepEqual([p[P.OFFER].price, p[P.OFFER].was, p[P.OFFER].status], [20, 25, 'ok']);
  assert.deepEqual([p[P.DIRECT].price, p[P.DIRECT].status], [7.77, 'ok'], 'read straight from Screwfix when jina failed');
  assert.deepEqual([p[P.BLOCKED].price, p[P.BLOCKED].status], [8.88, 'unchecked']);
  assert.equal(p[P.ELSEWHERE].status, 'unchecked', "a page that doesn't mention the code is no reading");
  assert.deepEqual([p[P.NEW].price, p[P.NEW].prev, p[P.NEW].status], [3.5, null, 'ok'], "a new code's first price is its starting point");
  assert.equal(p[P.GONE2].status, 'not_found');
  assert.equal(info.week, week);
  assert.deepEqual([info.complete, info.checked, info.changed, info.up, info.unchecked], [false, 8, 1, 1, 3]);
  assert.equal(info.stopped, '3 lines could not be checked');
  assert.match(r.stdout, /429 from jina: pausing 7 s/, 'waits as long as jina asks');
  assert.match(r.stdout, /88888 {2}could not check: jina: no answer \(.+\); direct: Screwfix's bot check \(HTTP 202\)/);
  assert.match(r.commit, /^Shelf check \w{3} \d{1,2} \w{3}: 8 of 11 checked, 1 price change, 2 not found, 3 still to check\n$/);
  assert.match(r.summary, /\| 22222 \| Pricier Widget \| £9\.99 \| £12\.99 \| UP \|/);
});

test('Monday check: a test run reads every line but saves nothing', async () => {
  const files = shelfFiles();
  const r = await run('shelf-check', { mode: 'test', files });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json(SHELF + 'prices.json'), files[SHELF + 'prices.json']);
  assert.equal(r.commit, '');
  assert.match(r.summary, /### Shelf check \(test run, nothing saved\)/);
});

test('Monday check: a later run that week only finishes off the lines that were missed', async () => {
  const before = S.shelfPrices({ week, statuses: { [P.STEADY]: 'unchecked', [P.UP]: 'unchecked' } });
  const r = await run('shelf-check', { mode: 'auto', files: shelfFiles(before) });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(read(r).sort(), [P.STEADY, P.UP, P.NEW].sort(), 'the two missed lines and the one with no price yet');
  assert.equal(r.json(SHELF + 'prices.json').products[P.UP].status, 'changed');
});

test('Monday check: a code change pushed to main runs a five line smoke test and saves nothing', async () => {
  const codes = S.ORDER.filter((c) => c !== P.NEW);
  const files = { [SHELF + 'plan.json']: S.shelfPlan(codes), [SHELF + 'prices.json']: S.shelfPrices({ codes }) };
  const r = await run('shelf-check', { event: 'push', changed: ['tools/price-tickets/lookup.js'], files });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(read(r).length, 5);
  assert.match(r.stdout, /Smoke test: 3 found, 1 not found, 1 could not be checked/);
  assert.deepEqual(r.json(SHELF + 'prices.json'), files[SHELF + 'prices.json']);
});

test('Monday check: a new brief in plan.next.json becomes the shop plan on its start day', async () => {
  const next = { ...S.shelfPlan(S.ORDER.slice(0, 4)), brief: 'Next brief', effective: '2026-01-01' };
  const r = await run('shelf-check', { event: 'schedule', files: shelfFiles(undefined, { [SHELF + 'plan.next.json']: next }) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.files[SHELF + 'plan.next.json'], undefined);
  const plan = r.json(SHELF + 'plan.json');
  assert.equal(plan.brief, 'Next brief');
  assert.equal(plan.effective, undefined);
  assert.deepEqual(read(r).sort(), S.ORDER.slice(0, 4).sort());
});

test('Monday check: when jina keeps saying slow down it stops, keeps the old prices and fails the run', async () => {
  const r = await run('shelf-check', { mode: 'auto', files: shelfFiles(), site: S.siteWhere(S.ORDER, LIMITED) });
  assert.equal(r.code, 1);
  assert.equal((r.stdout.match(/429 from jina/g) || []).length, 5);
  const saved = r.json(SHELF + 'prices.json');
  assert.equal(saved.run.stopped, 'jina kept saying slow down (HTTP 429)');
  assert.equal(saved.products[P.UP].price, 9.99);
  assert.match(r.stdout, /::error title=Shelf check blocked::None of 11 lines could be checked/);
});

/* ---------- the A25 counter trial ---------- */

test('A25 check: saves the latest online price, when it moved, and why any line could not be read', async () => {
  const r = await run('counter-trial', { mode: 'auto', files: counterFiles() });
  assert.equal(r.code, 0, r.stderr);
  const { products: p, run: info } = r.json(COUNTER + 'prices.json');
  assert.deepEqual([p[P.UP].price, p[P.UP].since, p[P.UP].moves], [12.99, today, [{ on: today, from: 9.99, to: 12.99 }]]);
  assert.deepEqual([p[P.STEADY].price, p[P.STEADY].since, p[P.STEADY].status], [9.99, '2026-01-02', 'ok']);
  assert.deepEqual([p[P.NEW].price, p[P.NEW].since], [3.5, today], 'first reading');
  assert.deepEqual([p[P.OTHER].price, p[P.OTHER].status], [14, 'unchecked']);
  assert.equal(p[P.GONE].status, 'not_found');
  assert.deepEqual([p[P.OFFER].price, p[P.OFFER].was], [20, 25]);
  assert.deepEqual([info.date, info.checked, info.unchecked, info.moved, info.off_printed], [today, 8, 3, 1, 1]);
  assert.deepEqual(Object.keys(info.fails).sort(), [P.OTHER, P.BLOCKED, P.ELSEWHERE].sort());
  assert.match(info.fails[P.OTHER], /couldn't be confirmed \(whole page: product data for another code\)/);
  assert.match(r.stdout, /HTTP 429 from jina: pausing 60 s/, 'waits a whole minute');
  assert.match(r.commit, /^Counter trial \w{3} \d{1,2} \w{3}: 8 of 11 checked, 1 moved, 2 not found, 3 still to check\n$/);
});

test('A25 check: a code change pushed to main runs a five line smoke test and saves nothing', async () => {
  const files = counterFiles(undefined, S.counterPlan(S.ORDER.filter((c) => c !== P.NEW)));
  const r = await run('counter-trial', { event: 'push', changed: ['.github/lib/price-check.mjs'], files });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(read(r).length, 5);
  assert.deepEqual(r.json(COUNTER + 'prices.json'), files[COUNTER + 'prices.json']);
});

test('A25 check: when jina keeps saying slow down it stops after four and fails the run', async () => {
  const r = await run('counter-trial', { mode: 'full', files: counterFiles(), site: S.siteWhere(S.ORDER, LIMITED) });
  assert.equal(r.code, 1);
  assert.equal((r.stdout.match(/HTTP 429 from jina/g) || []).length, 3);
  assert.equal(r.json(COUNTER + 'prices.json').run.stopped, 'jina kept saying slow down (HTTP 429)');
});

/* ---------- both ---------- */

test('both checks: a new price whose confirmation gets "slow down" waits and asks again', async () => {
  const code = '10001', name = 'Retry Widget';
  const site = { [code]: { text: [textPage({ code, name, price: 11 })], html: [LIMITED, wholePage({ code, name, price: 11 })] } };
  const shelf = await run('shelf-check', { mode: 'test', site, files: {
    [SHELF + 'plan.json']: { name: 'T', bays: [{ page: 1, name: 'Bay', shelves: [{ label: '', codes: [code] }], codes: [code] }] },
    [SHELF + 'prices.json']: { checked: '2026-01-05', run: { week: '2026-01-05' }, products: { [code]: { name, price: 10, status: 'ok' } } } } });
  const counter = await run('counter-trial', { mode: 'test', site, files: counterFiles(
    { checked: '2026-01-05', run: { date: '2026-01-05' }, products: { [code]: { name, price: 10, status: 'ok', moves: [] } } },
    { name: 'T', lines: [{ code, name, shelf: 10, sheet: 1 }] }) });
  for (const r of [shelf, counter]) {
    assert.match(r.stdout, /10001 {2}£11\.00 {2}(CHANGED|MOVED) from £10\.00 {2}\(jina confirmed from the whole page\)/);
    assert.doesNotMatch(r.stdout, /Pass 2/);
    assert.deepEqual(r.hits.map((h) => h.mode), ['text', 'html', 'html']);
  }
});

test('both checks: when nothing gets through at all, the run fails so GitHub emails about it', async () => {
  const shelf = await run('shelf-check', { mode: 'full', files: shelfFiles(), site: S.siteWhere(S.ORDER, 'reset') });
  const counter = await run('counter-trial', { mode: 'full', files: counterFiles(), site: S.siteWhere(S.ORDER, 'reset') });
  for (const r of [shelf, counter]) {
    assert.equal(r.code, 1);
    assert.match(r.stdout, /Pass 3: trying 11 lines again/);
    assert.match(r.stdout, /::error title=.+ blocked::None of 11 lines could be checked/);
  }
});
