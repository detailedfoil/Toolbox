// Weekly Screwfix shelf price check, run by .github/workflows/shelf-check.yml.
//
// Reads the shop plan (tools/shelf-check/data/plan.json) and the last results
// (tools/shelf-check/data/prices.json), looks up every code on screwfix.com strictly one at a
// time with a gap between requests, and writes the results back for the Shelf Check page.
// Pages are read with the same parser the Price Tickets page uses (tools/price-tickets/lookup.js),
// and the price is cross-checked against the product data built into the page.
//
// Rules:
//  - never more than one request at a time, GAP_MS between them; on HTTP 429 pause, then go slower
//  - a failed lookup is never a price change: the line keeps its last price, marked "unchecked"
//  - "not_found" only when Screwfix itself answers 404 / 410 for the product page
//  - a code's first price is its starting point; after that any difference is a change
//
// MODE: auto (default) | full | test | smoke
//   auto  - the Monday run: checks every line if this week hasn't been checked yet, otherwise
//           finishes off lines that couldn't be checked and codes new to the plan
//   full  - checks every line now (the results become the new starting point)
//   test  - checks every line but saves nothing (results go in the run summary)
//   smoke - five lines, saves nothing: proves the lookup still works after a code change
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const ROOT = process.cwd();
const PLAN_FILE = 'tools/shelf-check/data/plan.json';
const PRICES_FILE = 'tools/shelf-check/data/prices.json';
const GAP = Number(process.env.GAP_MS || 5000);
const BUDGET_MS = Number(process.env.BUDGET_MIN || 120) * 60000;
const started = Date.now();
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const log = (...a) => console.log(...a);

/* ---------- dates (Europe/London) ---------- */

function londonDate(d = new Date()) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
}
function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}
function nice(iso) {                                    // 2026-10-12 -> Mon 12 Oct
  const [y, m, d] = iso.split('-').map(Number);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${day} ${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
}

/* ---------- files ---------- */

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Couldn't read ${file}: ${e.message}`);
  }
}
// one product per line, so the weekly commits show exactly which prices moved
function writePrices(state) {
  const { products, ...head } = state;
  const lines = Object.keys(products).map((c) => `    ${JSON.stringify(c)}: ${JSON.stringify(products[c])}`);
  const top = Object.keys(head).map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(head[k])}`);
  fs.writeFileSync(path.join(ROOT, PRICES_FILE), `{\n${top.join(',\n')},\n  "products": {\n${lines.join(',\n')}\n  }\n}\n`);
}
const normCode = (c) => String(c || '').trim().toUpperCase().replace(/O/g, '0');   // codes never contain the letter O

/* ---------- reading a product page ---------- */

const dom = new JSDOM('<!doctype html><title>parser</title>', { url: 'https://detailedfoil.github.io/Toolbox/', runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync(path.join(ROOT, 'tools/price-tickets/lookup.js'), 'utf8'));
const SL = dom.window.ScrewfixLookup;
if (!SL || !SL.interpret) throw new Error('tools/price-tickets/lookup.js did not load');

function chromeMajor() {
  try { return (execFileSync('google-chrome', ['--version'], { encoding: 'utf8' }).match(/(\d+)\./) || [])[1] || null; } catch (e) { return null; }
}
const MAJOR = chromeMajor() || '141';
const HEADERS = {
  'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAJOR}.0.0.0 Safari/537.36`,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': `"Chromium";v="${MAJOR}", "Google Chrome";v="${MAJOR}", "Not.A/Brand";v="99"`,
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"'
};

const pounds = (s) => (s == null || s === '' ? null : Number(String(s).replace(/[£,\s]/g, '')));
function errText(e) {
  return String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e).split('\n')[0].slice(0, 120);
}

// the price in the product data (JSON-LD) built into the page, for the product with this code
function dataPrice(html, code) {
  const found = [];
  const walk = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > 8) return;
    if (Array.isArray(n)) { n.forEach((x) => walk(x, depth + 1)); return; }
    if (/Product/i.test([].concat(n['@type'] || []).join(' '))) {
      for (const o of [].concat(n.offers || [])) {
        const p = o && (o.price != null ? o.price : o.lowPrice != null ? o.lowPrice : o.priceSpecification && o.priceSpecification.price);
        if (p != null && isFinite(Number(p))) found.push({ sku: normCode(n.sku || n.productID || ''), price: Number(p) });
      }
    }
    for (const k in n) if (n[k] && typeof n[k] === 'object') walk(n[k], depth + 1);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1]), 0); } catch (e) { /* not valid JSON */ }
  }
  const mine = found.find((x) => x.sku === code);
  return mine ? { price: mine.price, sure: true } : found[0] ? { price: found[0].price, sure: false } : null;
}

// -> {kind: 'found', name, price, was} | {kind: 'missing'} | {kind: 'limited', retryAfter} | {kind: 'fail', why}
async function lookup(code) {
  let res, html;
  try {
    res = await fetch(SL.productUrl(code), { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    html = await res.text();
  } catch (e) {
    return { kind: 'fail', why: 'no answer (' + errText(e) + ')' };
  }
  if (res.status === 429) return { kind: 'limited', retryAfter: Number(res.headers.get('retry-after')) || 0 };
  if (res.status === 404 || res.status === 410) {
    // Screwfix's own "404 | Screwfix" page: the product page doesn't exist
    return /screwfix/i.test(html) ? { kind: 'missing' } : { kind: 'fail', why: `HTTP ${res.status} that isn't a Screwfix page` };
  }
  if (res.status !== 200) return { kind: 'fail', why: `HTTP ${res.status}` };

  let r;
  try { r = JSON.parse(JSON.stringify(SL.interpret({ status: res.status, text: html }, code))); } catch (e) {
    return { kind: 'fail', why: 'page could not be read (' + errText(e) + ')' };
  }
  const shown = pounds(r.price), data = dataPrice(html, code);
  if (r.status !== 'found' && !(r.status === 'partial' && shown != null)) return { kind: 'fail', why: 'page: ' + r.status + (r.why ? ' (' + r.why + ')' : '') };
  if (r.unsure && !(data && data.sure)) return { kind: 'fail', why: "page doesn't mention the code" };
  if (shown == null || !(shown > 0)) return { kind: 'fail', why: 'no price on the page' };
  if (data && Math.abs(data.price - shown) > 0.005) {
    return { kind: 'fail', why: `prices disagree: page shows £${shown.toFixed(2)}, product data says £${data.price.toFixed(2)}` };
  }
  return { kind: 'found', name: r.name || null, price: Math.round(shown * 100) / 100, was: pounds(r.was) };
}

/* ---------- the run ---------- */

const plan = readJSON(PLAN_FILE);
const old = readJSON(PRICES_FILE, { checked: null, previous_checked: null, run: null, products: {} });
const codes = [...new Set(plan.bays.flatMap((b) => b.codes.map(normCode)))];
const today = londonDate(), week = mondayOf(today);

let mode = (process.env.MODE || 'auto').trim().toLowerCase();
if (process.env.GITHUB_EVENT_NAME === 'push') {
  // pushed changes: a new shop plan gets checked, anything else just gets a quick smoke test
  let files = [];
  try { files = (JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).commits || []).flatMap((c) => [...(c.added || []), ...(c.modified || [])]); } catch (e) { /* no event file */ }
  mode = files.includes(PLAN_FILE) ? 'auto' : 'smoke';
}
if (!['auto', 'full', 'test', 'smoke'].includes(mode)) throw new Error('Unknown MODE ' + mode);

const fresh = mode === 'full' || mode === 'test' || (mode === 'auto' && (!old.run || old.run.week !== week));
const saving = mode === 'auto' || mode === 'full';
const baseline = fresh && !old.checked;                     // nothing to compare with yet
const trigger = process.env.GITHUB_EVENT_NAME === 'schedule' ? 'schedule' : process.env.GITHUB_EVENT_NAME === 'push' ? 'plan change' : 'manual';

// the new state: one entry per code in the plan, in walking order
const state = {
  plan: plan.name,
  checked: fresh ? today : old.checked,
  previous_checked: fresh ? old.checked : old.previous_checked,
  run: fresh ? { week, started: new Date().toISOString(), finished: null, trigger, complete: false }
             : { ...(old.run || {}), week, started: (old.run && old.run.started) || new Date().toISOString() },
  products: {}
};
for (const c of codes) {
  const p = old.products[c] || {};
  state.products[c] = fresh
    ? { name: p.name || null, price: p.price != null ? p.price : null, prev: null, status: 'unchecked', was: p.was != null ? p.was : null, on: p.on || null }
    : { name: p.name || null, price: p.price != null ? p.price : null, prev: p.prev != null ? p.prev : null, status: p.status || 'unchecked', was: p.was != null ? p.was : null, on: p.on || null };
}

const targets = mode === 'smoke' ? codes.slice(0, 5)
  : fresh ? codes
  : codes.filter((c) => { const p = state.products[c]; return p.price == null || p.status === 'unchecked'; });

const label = { auto: fresh ? 'weekly check' : 'catch-up', full: 'full check', test: 'test run (saves nothing)', smoke: 'smoke test (saves nothing)' }[mode];
log(`Shelf check ${today}: ${label}, ${targets.length} of ${codes.length} lines to check, one every ${GAP / 1000}s. Chrome ${MAJOR} headers.`);
if (!targets.length) { log('Nothing to check: this week is done.'); process.exit(0); }

const changes = [];
// -> true when the price changed
function apply(code, r) {
  const p = state.products[code];
  if (r.kind === 'found') {
    if (r.name) p.name = r.name;
    p.was = r.was != null && r.was > r.price ? r.was : null;
    p.on = today;
    if (p.price != null && !baseline && Math.abs(r.price - p.price) > 0.001) {
      changes.push({ code, name: p.name, from: p.price, to: r.price });
      p.prev = p.price; p.price = r.price; p.status = 'changed';
      return true;
    }
    p.price = r.price; p.prev = null; p.status = 'ok';
  } else if (r.kind === 'missing') {
    p.status = 'not_found'; p.prev = null; p.on = today;
  }
  return false;
}

function tally() {
  const all = Object.values(state.products);
  const n = (s) => all.filter((p) => p.status === s).length;
  return { total: all.length, checked: n('ok') + n('changed') + n('not_found'), changed: n('changed'),
           up: all.filter((p) => p.status === 'changed' && p.price > p.prev).length,
           down: all.filter((p) => p.status === 'changed' && p.price < p.prev).length,
           not_found: n('not_found'), unchecked: n('unchecked') };
}
function finishRun(stop) {
  const t = tally();
  Object.assign(state.run, { finished: new Date().toISOString(), complete: t.unchecked === 0 }, t);
  if (stop) state.run.stopped = stop; else delete state.run.stopped;
}

const fails = {};
let gap = GAP, last = 0, limited = 0, stop = null, done = 0, found = 0, missing = 0;
async function polite() {
  const wait = last + gap - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
}

let queue = [...targets];
for (let pass = 1; pass <= 3 && queue.length && !stop; pass++) {
  if (pass > 1) {
    log(`\nPass ${pass}: trying ${queue.length} line${queue.length === 1 ? '' : 's'} again after a pause.`);
    await sleep(pass === 2 ? 60000 : 180000);
  }
  const todo = queue;
  queue = [];
  for (let i = 0; i < todo.length; i++) {
    const code = todo[i];
    if (Date.now() - started > BUDGET_MS) { stop = 'out of time'; queue.push(...todo.slice(i)); break; }
    await polite();
    const r = await lookup(code);
    if (r.kind === 'limited') {
      limited++;
      if (limited >= 2) { stop = 'Screwfix rate limit (HTTP 429)'; queue.push(...todo.slice(i)); log(`429 again: stopping, the rest are left for the next run.`); break; }
      const pause = Math.min(Math.max(r.retryAfter * 1000, 15 * 60000), 30 * 60000);
      gap = Math.min(gap * 2, 20000);
      log(`429 from Screwfix: pausing ${Math.round(pause / 60000)} min, then one every ${gap / 1000}s.`);
      await sleep(pause);
      i--;
      continue;
    }
    done++;
    let moved = false;
    if (r.kind === 'fail') { fails[code] = r.why; queue.push(code); }
    else {
      delete fails[code];
      if (r.kind === 'found') found++; else missing++;
      if (mode !== 'smoke') moved = apply(code, r);
    }
    const p = state.products[code];
    log(`[${String(done).padStart(3)}] ${code}  ${r.kind === 'found' ? '£' + r.price.toFixed(2) + (moved ? `  CHANGED from £${p.prev.toFixed(2)}` : '') : r.kind === 'missing' ? 'not found (404)' : 'could not check: ' + r.why}`);
    if (saving && done % 25 === 0) { finishRun('still running'); writePrices(state); }
  }
}

/* ---------- results ---------- */

const left = Object.keys(fails);
if (mode === 'smoke') {
  log(`\nSmoke test: ${found} found, ${missing} not found, ${left.length} could not be checked.`);
  if (found < 3) { console.log(`::error title=Shelf check smoke test failed::Only ${found} of ${targets.length} prices could be read. ${left.map((c) => c + ': ' + fails[c]).join('; ')}`); process.exit(1); }
  process.exit(0);
}

finishRun(stop || (left.length ? `${left.length} line${left.length === 1 ? '' : 's'} could not be checked` : null));
const t = state.run;
const money = (v) => '£' + Number(v).toFixed(2);
const changeLines = changes.map((c) => `${c.code}  ${c.to > c.from ? 'UP  ' : 'DOWN'}  ${money(c.from)} -> ${money(c.to)}  ${c.name || ''}`);
const headline = `${nice(today)}: ${t.checked} of ${t.total} lines checked, ${t.changed} price change${t.changed === 1 ? '' : 's'} (${t.up} up, ${t.down} down), ${t.not_found} not found online` +
  (t.unchecked ? `, ${t.unchecked} not checked yet` : '') + (stop ? ` (stopped: ${stop})` : '');
log('\n' + headline);
changeLines.forEach((l) => log('  ' + l));

const enc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
log(`::notice title=${mode === 'test' ? 'Shelf check test run (not saved)' : 'Shelf check'}::${enc(headline)}`);   // no commas in titles
if (changeLines.length) log(`::notice title=Price changes::${enc(changeLines.join('\n'))}`);
if (left.length) log(`::warning title=Could not check::${enc(left.map((c) => c + ': ' + fails[c]).join('\n'))}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = changes.map((c) => `| ${c.code} | ${(c.name || '').replace(/\|/g, '/')} | ${money(c.from)} | ${money(c.to)} | ${c.to > c.from ? 'UP' : 'DOWN'} |`);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Shelf check${mode === 'test' ? ' (test run, nothing saved)' : ''}\n\n${headline}\n\n` +
    (rows.length ? `| Code | Product | Was | Now | |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n` : '') +
    (left.length ? `**Could not check:** ${left.map((c) => `${c} (${fails[c]})`).join(', ')}\n` : ''));
}

if (saving) {
  writePrices(state);
  const msg = `Shelf check ${nice(today)}: ${t.checked} of ${t.total} checked, ${t.changed} price change${t.changed === 1 ? '' : 's'}` +
    (t.not_found ? `, ${t.not_found} not found` : '') + (t.unchecked ? `, ${t.unchecked} still to check` : '');
  if (process.env.RUNNER_TEMP) fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'shelf-commit.txt'), msg + '\n');
}

// nothing at all got through: fail the run so GitHub emails about it
if (targets.length >= 5 && found + missing === 0) {
  console.log(`::error title=Shelf check blocked::None of ${targets.length} lines could be checked. ${stop || ''}`);
  process.exit(1);
}
