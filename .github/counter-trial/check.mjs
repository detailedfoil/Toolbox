// Daily price check for the Toolbox "A25 Behind counter trial" page, run by
// .github/workflows/counter-trial.yml.
//
// Reads the trial's ticket list (tools/counter-trial/data/plan.json, with the price printed on each
// ticket) and the last results (tools/counter-trial/data/prices.json), looks up every code on
// screwfix.com strictly one at a time with a gap between requests, and saves the latest online price
// for each. The page compares that with the price on the shelf ticket, so a change stays listed until
// it's ticked off there, however many days that takes.
//
// How a price is read (through jina, with the page's product data to confirm a new price) is shared
// with the Monday shelf check: see .github/lib/price-check.mjs.
//
// Rules:
//  - never more than one product at a time, GAP_MS between them; on HTTP 429 from jina wait a minute and go slower
//  - a failed lookup never changes a price: the line keeps its last price, marked "unchecked"
//  - "not_found" only when Screwfix itself says the product page doesn't exist
//
// MODE: auto (default) | full | test | smoke
//   auto  - the daily run: checks every line if today hasn't been checked yet, otherwise only
//           finishes off lines that couldn't be checked and codes new to the list
//   full  - checks every line now
//   test  - checks every line but saves nothing (results go in the run summary)
//   smoke - five lines, saves nothing: proves the lookup still works after a code change
import fs from 'node:fs';
import path from 'node:path';
import { sleep, log, londonDate, nice, readJSON, writePrices, normCode, money, runMode, annotate, MAJOR, lookup } from '../lib/price-check.mjs';

const PLAN_FILE = 'tools/counter-trial/data/plan.json';
const PRICES_FILE = 'tools/counter-trial/data/prices.json';
const GAP = Number(process.env.GAP_MS || 6000);
const BUDGET_MS = Number(process.env.BUDGET_MIN || 165) * 60000;
const PAUSE_429 = 60000;                          // on HTTP 429 from jina: a whole minute, its limit is per minute
const MOVES_KEPT = 6;
const started = Date.now();

/* ---------- the run ---------- */

const plan = readJSON(PLAN_FILE);
const old = readJSON(PRICES_FILE, { checked: null, run: null, products: {} });
const codes = [...new Set(plan.lines.map((l) => normCode(l.code)))];
const shelf = Object.fromEntries(plan.lines.map((l) => [normCode(l.code), l.shelf]));
const today = londonDate();

// pushed changes: a new ticket list gets checked, anything else just gets a quick smoke test
const mode = runMode(PLAN_FILE, codes.some((c) => !old.products[c] || old.products[c].price == null));
const fresh = mode === 'full' || mode === 'test' || (mode === 'auto' && (!old.run || old.run.date !== today));
const saving = mode === 'auto' || mode === 'full';
const trigger = process.env.GITHUB_EVENT_NAME === 'schedule' ? 'schedule' : process.env.GITHUB_EVENT_NAME === 'push' ? 'list change' : 'manual';

// the new state: one entry per code on the list, in list order
const state = {
  trial: plan.name,
  checked: fresh ? today : old.checked,
  run: fresh ? { date: today, started: new Date().toISOString(), finished: null, trigger, complete: false }
             : { ...(old.run || {}), date: today, started: (old.run && old.run.started) || new Date().toISOString() },
  products: {}
};
for (const c of codes) {
  const p = old.products[c] || {};
  state.products[c] = {
    name: p.name || null,
    price: p.price != null ? p.price : null,
    since: p.since || null,                       // the day the online price last moved
    status: fresh ? 'unchecked' : (p.status || 'unchecked'),
    was: p.was != null ? p.was : null,
    on: p.on || null,                             // the day it was last read
    moves: Array.isArray(p.moves) ? p.moves : []
  };
}

const targets = mode === 'smoke' ? codes.slice(0, 5)
  : fresh ? codes
  : codes.filter((c) => { const p = state.products[c]; return p.price == null || p.status === 'unchecked'; });

const label = { auto: fresh ? 'daily check' : 'catch-up', full: 'full check', test: 'test run (saves nothing)', smoke: 'smoke test (saves nothing)' }[mode];
log(`Counter trial check ${today}: ${label}, ${targets.length} of ${codes.length} lines to check, one every ${GAP / 1000}s. Chrome ${MAJOR} headers.`);
if (!targets.length) { log("Nothing to check: today's check is done."); process.exit(0); }

const moved = [];
function apply(code, r) {
  const p = state.products[code];
  if (r.kind === 'found') {
    if (r.name) p.name = r.name;
    p.was = r.was != null && r.was > r.price ? r.was : null;
    p.on = today;
    p.status = 'ok';
    if (p.price != null && Math.abs(r.price - p.price) > 0.001) {
      moved.push({ code, name: p.name, from: p.price, to: r.price });
      p.moves = [...p.moves, { on: today, from: p.price, to: r.price }].slice(-MOVES_KEPT);
      p.since = today;
      p.price = r.price;
      return true;
    }
    if (p.price == null) p.since = today;          // first reading
    p.price = r.price;
  } else if (r.kind === 'missing') {
    p.status = 'not_found'; p.on = today;
  }
  return false;
}

function tally() {
  const all = Object.entries(state.products);
  const n = (s) => all.filter(([, p]) => p.status === s).length;
  const off = all.filter(([c, p]) => p.price != null && shelf[c] != null && Math.abs(p.price - shelf[c]) > 0.001).length;
  return { total: all.length, checked: n('ok') + n('not_found'), not_found: n('not_found'), unchecked: n('unchecked'), moved: moved.length, off_printed: off };
}
function finishRun(stop) {
  const t = tally();
  Object.assign(state.run, { finished: new Date().toISOString(), complete: t.unchecked === 0 }, t);
  if (stop) state.run.stopped = stop; else delete state.run.stopped;
  // why each line still couldn't be read, for the page's error report
  const why = Object.fromEntries(Object.entries(fails).filter(([c]) => state.products[c] && state.products[c].status === 'unchecked'));
  if (Object.keys(why).length) state.run.fails = why; else delete state.run.fails;
}

const fails = {};
let gap = GAP, last = 0, limited = 0, stop = null, done = 0, found = 0, missing = 0;
async function polite() {
  const wait = last + gap * (0.8 + Math.random() * 0.4) - Date.now();   // a little uneven, like a person browsing
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
    const p0 = state.products[code];
    const r = await lookup(code, p0.price != null ? p0.price : shelf[code]);
    if (r.kind === 'limited') {
      // jina's limit (20 a minute): wait a minute, go a bit slower, and stop if it keeps happening
      limited++;
      if (limited >= 4) { stop = 'jina kept saying slow down (HTTP 429)'; queue.push(...todo.slice(i)); log('HTTP 429 again: stopping, the rest are left for the next run.'); break; }
      gap = Math.min(gap * 1.5, 30000);
      log(`HTTP 429 from jina: pausing ${Math.round(PAUSE_429 / 1000)} s, then one every ${Math.round(gap / 1000)}s.`);
      await sleep(PAUSE_429);
      i--;
      continue;
    }
    done++;
    let mv = false;
    if (r.kind === 'fail') { fails[code] = r.why; queue.push(code); }
    else {
      delete fails[code];
      if (r.kind === 'found') found++; else missing++;
      if (mode !== 'smoke') mv = apply(code, r);
    }
    const p = state.products[code];
    log(`[${String(done).padStart(2)}] ${code}  ${r.kind === 'found' ? '£' + r.price.toFixed(2) + (mv ? `  MOVED from £${p.moves[p.moves.length - 1].from.toFixed(2)}` : '') + `  (${r.via})` : r.kind === 'missing' ? 'not found (404)' : 'could not check: ' + r.why}`);
    if (saving && done % 10 === 0) { finishRun('still running'); writePrices(PRICES_FILE, state); }   // keep progress if the run gets cut short
  }
}

/* ---------- results ---------- */

const left = Object.keys(fails);
if (mode === 'smoke') {
  log(`\nSmoke test: ${found} found, ${missing} not found, ${left.length} could not be checked.`);
  if (found < 3) { annotate('error', 'Counter trial smoke test failed', `Only ${found} of ${targets.length} prices could be read. ${left.map((c) => c + ': ' + fails[c]).join('; ')}`); process.exit(1); }
  process.exit(0);
}

finishRun(stop || (left.length ? `${left.length} line${left.length === 1 ? '' : 's'} could not be checked` : null));
const t = state.run;
const moveLines = moved.map((c) => `${c.code}  ${c.to > c.from ? 'UP  ' : 'DOWN'}  ${money(c.from)} -> ${money(c.to)}  ${c.name || ''}`);
const headline = `${nice(today)}: ${t.checked} of ${t.total} checked, ${t.moved} moved online today, ${t.off_printed} differ from the printed ticket list, ${t.not_found} not found online` +
  (t.unchecked ? `, ${t.unchecked} not checked yet` : '') + (stop ? ` (stopped: ${stop})` : '');
log('\n' + headline);
moveLines.forEach((l) => log('  ' + l));

annotate('notice', mode === 'test' ? 'Counter trial test run (not saved)' : 'Counter trial check', headline);
if (moveLines.length) annotate('notice', 'Moved today', moveLines.join('\n'));
if (left.length) annotate('warning', 'Could not check', left.map((c) => c + ': ' + fails[c]).join('\n'));

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = moved.map((c) => `| ${c.code} | ${(c.name || '').replace(/\|/g, '/')} | ${money(c.from)} | ${money(c.to)} | ${c.to > c.from ? 'UP' : 'DOWN'} |`);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### A25 Behind counter trial${mode === 'test' ? ' (test run, nothing saved)' : ''}\n\n${headline}\n\n` +
    (rows.length ? `| Code | Product | Was | Now | |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n` : '') +
    (left.length ? `**Could not check:** ${left.map((c) => `${c} (${fails[c]})`).join(', ')}\n` : ''));
}

if (saving) {
  writePrices(PRICES_FILE, state);
  const msg = `Counter trial ${nice(today)}: ${t.checked} of ${t.total} checked, ${t.moved} moved` +
    (t.not_found ? `, ${t.not_found} not found` : '') + (t.unchecked ? `, ${t.unchecked} still to check` : '');
  if (process.env.RUNNER_TEMP) fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'counter-commit.txt'), msg + '\n');
}

// nothing at all got through: fail the run so GitHub emails about it
if (targets.length >= 5 && found + missing === 0) {
  annotate('error', 'Counter trial check blocked', `None of ${targets.length} lines could be checked. ${stop || ''}`);
  process.exit(1);
}
