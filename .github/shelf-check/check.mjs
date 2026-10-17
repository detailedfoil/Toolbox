// Weekly Screwfix shelf price check, run by .github/workflows/shelf-check.yml.
//
// Reads the shop plan (tools/shelf-check/data/plan.json) and the last results
// (tools/shelf-check/data/prices.json), looks up every code on screwfix.com strictly one at a
// time with a gap between requests, and writes the results back for the Shelf Check page.
// How a price is read (through jina, with the page's product data to confirm a new price) is shared
// with the A25 counter trial check: see .github/lib/price-check.mjs.
//
// Rules:
//  - never more than one line at a time, GAP_MS between them; on HTTP 429 from jina wait as asked and go slower
//  - a failed lookup is never a price change: the line keeps its last price, marked "unchecked"
//  - "not_found" only when Screwfix itself says the product page doesn't exist
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
import { sleep, log, londonDate, mondayOf, nice, readJSON, writePrices, normCode, money, runMode, annotate, MAJOR, lookup } from '../lib/price-check.mjs';

const PLAN_FILE = 'tools/shelf-check/data/plan.json';
const PRICES_FILE = 'tools/shelf-check/data/prices.json';
const PHONE_FILE = 'tools/shelf-check/data/phone.json';
const NEXT_FILE = 'tools/shelf-check/data/plan.next.json';
const GAP = Number(process.env.GAP_MS || 5000);
const BUDGET_MS = Number(process.env.BUDGET_MIN || 120) * 60000;
const started = Date.now();

/* ---------- the run ---------- */

let plan = readJSON(PLAN_FILE);
// A new brief waits in plan.next.json until its start day (its "effective" date, UK time). The first normal or
// full run on or after that day makes it the shop plan, and the workflow saves that change with the results.
const waiting = readJSON(NEXT_FILE, null);
const askedMode = (process.env.MODE || 'auto').trim().toLowerCase();
if (waiting && waiting.bays && waiting.effective && process.env.GITHUB_EVENT_NAME !== 'push' && (askedMode === 'auto' || askedMode === 'full') && londonDate() >= waiting.effective) {
  const { effective, ...live } = waiting;
  fs.writeFileSync(PLAN_FILE, JSON.stringify(live, null, 1) + '\n');
  fs.unlinkSync(NEXT_FILE);
  plan = live;
  console.log(`The new brief (${live.brief}) is now the shop plan.`);
}
const old = readJSON(PRICES_FILE, { checked: null, previous_checked: null, run: null, products: {} });
const codes = [...new Set(plan.bays.flatMap((b) => b.codes.map(normCode)))];
const today = londonDate(), week = mondayOf(today);

// pushed changes: a new shop plan gets checked, anything else just gets a quick smoke test
const mode = runMode(PLAN_FILE, codes.some((c) => !old.products[c] || old.products[c].price == null));
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
// A complete check done on a phone (shared in phone.json) is the last successful update for the lines it read,
// so this run compares against it rather than against the older Monday price.
const phoneData = readJSON(PHONE_FILE, { readings: {}, done: {} });
const finishedAt = old.run && old.run.finished ? Date.parse(old.run.finished) : 0;
const lastRead = (p) => !p.on ? 0 : finishedAt && londonDate(new Date(finishedAt)) === p.on ? finishedAt : Date.parse(p.on + 'T12:00:00Z');
for (const c of codes) {
  let p = old.products[c] || {};
  const ph = phoneData.readings && phoneData.readings[c];
  if (fresh && ph && ph.run && phoneData.done && phoneData.done[ph.run] !== undefined && ph.price > 0 && Date.parse(ph.at) > lastRead(p)) {
    p = { ...p, price: ph.price, was: ph.was != null ? ph.was : null, name: p.name || ph.name || null };
  }
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
    const r = await lookup(code, state.products[code].price);
    if (r.kind === 'limited') {
      // jina's limit (20 a minute): wait as asked, go a bit slower, and stop if it keeps happening
      limited++;
      if (limited >= 6) { stop = 'jina kept saying slow down (HTTP 429)'; queue.push(...todo.slice(i)); log(`429 again: stopping, the rest are left for the next run.`); break; }
      gap = Math.min(Math.round(gap * 1.5), 20000);
      log(`429 from jina: pausing ${Math.round(r.pause / 1000)} s, then one every ${gap / 1000}s.`);
      await sleep(r.pause);
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
    log(`[${String(done).padStart(3)}] ${code}  ${r.kind === 'found' ? '£' + r.price.toFixed(2) + (moved ? `  CHANGED from £${p.prev.toFixed(2)}` : '') + `  (${r.via})` : r.kind === 'missing' ? 'not found (404)' : 'could not check: ' + r.why}`);
    if (saving && done % 25 === 0) { finishRun('still running'); writePrices(PRICES_FILE, state); }
  }
}

/* ---------- results ---------- */

const left = Object.keys(fails);
if (mode === 'smoke') {
  log(`\nSmoke test: ${found} found, ${missing} not found, ${left.length} could not be checked.`);
  if (found < 3) { annotate('error', 'Shelf check smoke test failed', `Only ${found} of ${targets.length} prices could be read. ${left.map((c) => c + ': ' + fails[c]).join('; ')}`); process.exit(1); }
  process.exit(0);
}

finishRun(stop || (left.length ? `${left.length} line${left.length === 1 ? '' : 's'} could not be checked` : null));
const t = state.run;
const changeLines = changes.map((c) => `${c.code}  ${c.to > c.from ? 'UP  ' : 'DOWN'}  ${money(c.from)} -> ${money(c.to)}  ${c.name || ''}`);
const headline = `${nice(today)}: ${t.checked} of ${t.total} lines checked, ${t.changed} price change${t.changed === 1 ? '' : 's'} (${t.up} up, ${t.down} down), ${t.not_found} not found online` +
  (t.unchecked ? `, ${t.unchecked} not checked yet` : '') + (stop ? ` (stopped: ${stop})` : '');
log('\n' + headline);
changeLines.forEach((l) => log('  ' + l));

annotate('notice', mode === 'test' ? 'Shelf check test run (not saved)' : 'Shelf check', headline);
if (changeLines.length) annotate('notice', 'Price changes', changeLines.join('\n'));
if (left.length) annotate('warning', 'Could not check', left.map((c) => c + ': ' + fails[c]).join('\n'));

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = changes.map((c) => `| ${c.code} | ${(c.name || '').replace(/\|/g, '/')} | ${money(c.from)} | ${money(c.to)} | ${c.to > c.from ? 'UP' : 'DOWN'} |`);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Shelf check${mode === 'test' ? ' (test run, nothing saved)' : ''}\n\n${headline}\n\n` +
    (rows.length ? `| Code | Product | Was | Now | |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n` : '') +
    (left.length ? `**Could not check:** ${left.map((c) => `${c} (${fails[c]})`).join(', ')}\n` : ''));
}

if (saving) {
  writePrices(PRICES_FILE, state);
  const msg = `Shelf check ${nice(today)}: ${t.checked} of ${t.total} checked, ${t.changed} price change${t.changed === 1 ? '' : 's'}` +
    (t.not_found ? `, ${t.not_found} not found` : '') + (t.unchecked ? `, ${t.unchecked} still to check` : '');
  if (process.env.RUNNER_TEMP) fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'shelf-commit.txt'), msg + '\n');
}

// nothing at all got through: fail the run so GitHub emails about it
if (targets.length >= 5 && found + missing === 0) {
  annotate('error', 'Shelf check blocked', `None of ${targets.length} lines could be checked. ${stop || ''}`);
  process.exit(1);
}
