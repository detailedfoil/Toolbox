// The Screwfix page reader (tools/price-tickets/lookup.js): what it makes of the pages it gets back. Every
// price on the site goes through it (the four price pages and both GitHub checks), so the awkward cases it
// has been taught are kept here, each one once a real product's price came out wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLookup } from './load.mjs';
import { textPage, wholePage, NOT_FOUND, BOT_CHECK } from './mock-screwfix.mjs';

const SL = loadLookup();
const read = (text, code, status = 200) => JSON.parse(JSON.stringify(SL.interpret({ status, text }, code)));

test('a product page as text (how jina sends it): name and price', () => {
  const r = read(textPage({ code: '843PG', name: 'Stanley Hammer', price: 12.99 }), '843PG');
  assert.equal(r.status, 'found');
  assert.equal(r.name, 'Stanley Hammer');
  assert.equal(r.price, '£12.99');
  assert.equal(r.age, false);
  assert.equal(r.was, undefined);
});

test('on offer: the was price next to the price', () => {
  const r = read(textPage({ code: '843PG', name: 'Stanley Hammer', price: 12.99, was: 19.99 }), '843PG');
  assert.equal(r.price, '£12.99');
  assert.equal(r.was, '£19.99');
});

test('the whole page: the product data (JSON-LD) comes back too, and says whether it is for this code', () => {
  const r = read(wholePage({ code: '843PG', name: 'Stanley Hammer', price: 12.99 }), '843PG');
  assert.equal(r.price, '£12.99');
  assert.equal(r.ld, '£12.99');
  assert.equal(r.ldSure, true);
  const other = read(wholePage({ code: '843PG', name: 'Stanley Hammer', price: 12.99, ldCode: '111AA' }), '843PG');
  assert.equal(other.ldSure, false);
});

test('132KH: when the text shows another price first, the product data for this code wins', () => {
  const r = read(wholePage({ code: '132KH', name: 'Lawn Seed 10kg', price: 12.99, ldPrice: 31.99 }), '132KH');
  assert.equal(r.price, '£31.99');
});

test('132KH: a zero-rated price ("0% VAT") is the selling price, not a later "Inc Vat" one for another product', () => {
  const page = 'Title: Lawn Seed 10kg (132KH) | Screwfix.com\n\nMarkdown Content:\n# Lawn Seed 10kg (132KH)\n\n£31.99 0% VAT\n\n' +
    'Customers also bought\n\nLawn Feed £12.99 Inc Vat\n';
  assert.equal(read(page, '132KH').price, '£31.99');
});

test('Challenge 25 products are spotted, "18V" and "18th Edition" are not', () => {
  const c25 = 'Title: Gas Torch (555GT) | Screwfix.com\n\nMarkdown Content:\n# Gas Torch (555GT)\n\n£24.99 Inc Vat\n\n' +
    'We operate a Challenge 25 policy in all our stores and may be asked for proof of age upon collection.\n';
  assert.equal(read(c25, '555GT').age, true);
  const drill = 'Title: 18V Drill (777DR) | Screwfix.com\n\nMarkdown Content:\n# Makita 18V Drill (777DR)\n\n£99.99 Inc Vat\n\n18th Edition wiring regulations\n';
  assert.equal(read(drill, '777DR').age, false);
});

test('a page for a different product is found but marked unsure', () => {
  const r = read(textPage({ code: '12345', name: 'Some Other Thing', price: 4 }), '99999');
  assert.equal(r.status, 'found');
  assert.equal(r.unsure, true);
});

test('not found, bot checks and relay errors are told apart', () => {
  assert.equal(read(NOT_FOUND, '843PG').status, 'notfound');
  assert.deepEqual(read(BOT_CHECK, '843PG'), { status: 'blocked', why: 'denied' });
  assert.deepEqual(read('{"error":"Too many requests, slow down please"}', '843PG', 429), { status: 'blocked', why: 'http-429' });
  assert.equal(read('', '843PG', 502).status, 'blocked');
});

test('a page wrapped in JSON by a relay is unwrapped', () => {
  const page = textPage({ code: '843PG', name: 'Stanley Hammer', price: 12.99 }) + '\nProduct details\n\n' + 'Forged steel head. '.repeat(8);
  const r = read(JSON.stringify({ contents: page }), '843PG');
  assert.equal(r.price, '£12.99');
});

test('a Screwfix page copied and pasted in (Ctrl+A, Ctrl+C) gives its code and price', () => {
  const copied = 'Skip to main content\nScrewfix\nStanley FatMax Claw Hammer 16oz (843PG)\n120 reviews\n£12.99 Inc Vat\n£10.83 Ex Vat\nAdd to basket\n';
  const r = JSON.parse(JSON.stringify(SL.fromCopiedPage(copied)));
  assert.equal(r.code, '843PG');
  assert.equal(r.price, '£12.99');
  assert.equal(r.name, 'Stanley FatMax Claw Hammer 16oz');
  assert.equal(SL.fromCopiedPage('just some text, nothing like a product page at all'), null);
});

test('prices are tidied to £1,234.50 form', () => {
  assert.equal(SL.normPrice('1,299.5'), '£1,299.50');
  assert.equal(SL.normPrice('£12'), '£12.00');
  assert.equal(SL.normPrice('abc'), null);
  assert.equal(SL.normPrice('0'), null);
});

test('the product link is the one the pages and checks open', () => {
  assert.equal(SL.productUrl('843PG'), 'https://www.screwfix.com/p/product/843pg');
});

/* ---------- relays: how lookup() behaves when jina has a bad moment (20 Oct 2026) ---------- */

// a pretend fetch that answers each request in turn from a list of [status, body]
const answers = (list) => { const calls = []; const f = async (url, init) => { calls.push({ url, headers: init && init.headers }); const [status, body] = list[Math.min(calls.length - 1, list.length - 1)]; return { status, text: async () => body }; }; f.calls = calls; return f; };
const HAMMER = textPage({ code: '843PG', name: 'Stanley Hammer', price: 12.99 });
const UPSTREAM_502 = 'Title: \n\nURL Source: https://www.screwfix.com/p/product/843pg\n\nWarning: Target URL returned error 502: Bad Gateway\n\nMarkdown Content:\nBad Gateway';

test('Screwfix answering jina with a 502 is tried again, and does not push jina down the order', async () => {
  const f = answers([[200, UPSTREAM_502], [200, HAMMER]]);
  const sl = loadLookup(f);
  const r = await sl.lookup('843PG', { only: ['jina'] });
  assert.equal(r.status, 'found');
  assert.equal(r.price, '£12.99');
  assert.equal(f.calls.length, 2);
  assert.equal(r.trace[0].outcome, 'upstream');
  assert.equal(Object.keys(sl.state().resting).length, 0);
});

test('jina saying slow down (429) is waited out and asked again', async () => {
  const slow = JSON.stringify({ data: null, retryAfter: 1, code: 429, name: 'RateLimitTriggeredError' });
  const f = answers([[429, slow], [200, HAMMER]]);
  const r = await loadLookup(f).lookup('843PG', { only: ['jina'] });
  assert.equal(r.status, 'found');
  assert.equal(f.calls.length, 2);
});

test('a relay that just gave a good answer is not demoted by one bad one', async () => {
  const f = answers([[200, HAMMER], [503, 'upstream connect error or disconnect/reset before headers']]);
  const sl = loadLookup(f);
  assert.equal((await sl.lookup('843PG', { only: ['jina'], retries: 0 })).status, 'found');
  assert.equal((await sl.lookup('843PG', { only: ['jina'], retries: 0 })).status, 'blocked');
  assert.equal(Object.keys(sl.state().resting).length, 0);
  assert.equal(sl.state().order[0], 'jina');
});
