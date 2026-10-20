// Product Search: collects each product's name as screwfix.com shows it, a few hundred a night, so the
// search can match either name (the stock-system names are cut off at 50 characters and abbreviated).
//
// Run by .github/workflows/product-search-names.yml. Reads tools/product-search/data/products.json and adds to
// tools/product-search/data/web-names.json (one product per line):
//   {"name": "...", "at": "2026-10-21"}            found
//   {"missing": true, "at": "..."}                  Screwfix has no page for that code
//   {"tries": 2, "at": "...", "why": "..."}         couldn't read it yet (tried again after a week, 3 goes at most)
//
// Gentle on purpose: one page every GAP_MS (12 s) through jina (r.jina.ai, the same reader the price checks use;
// a text read only, never the whole page). If Screwfix or jina starts turning us away (5 in a row turned away or unanswered), it
// stops, says why at the top of the file and on the run's page, and the run fails so GitHub emails detailedfoil.
// After a stop, the next night only tries 10 products; if those work it carries on as normal.
//
//   LIMIT   how many products to try this run (default 300)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readJSON, londonDate, sleep, log, annotate } from '../lib/price-check.mjs';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const ROOT = process.cwd();
const LIST = 'tools/product-search/data/products.json';
const OUT = 'tools/product-search/data/web-names.json';
const JINA = process.env.JINA_URL || 'https://r.jina.ai/';
const GAP = Number(process.env.GAP_MS || 12000);
const STOP_AFTER = 5;           // failures in a row that count as being turned away
const PROBE = 10;               // products to try after a stop

const dom = new JSDOM('<!doctype html><title>parser</title>', { url: 'https://detailedfoil.github.io/Toolbox/', runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync(path.join(ROOT, 'tools/price-tickets/lookup.js'), 'utf8'));
const SL = dom.window.ScrewfixLookup;

const today = londonDate();
const list = readJSON(LIST);
const state = readJSON(OUT, { products: {} });
const products = state.products || {};
const daysSince = (iso) => (Date.parse(today) - Date.parse(iso || '2000-01-01')) / 864e5;

/* which products to try, in order: names cut short at 50 characters first, they gain most */
function queue() {
  const todo = list.items.filter(([sku]) => {
    const p = products[sku];
    if (!p) return true;
    if (p.name || p.missing) return false;
    return (p.tries || 0) < 3 && daysSince(p.at) >= 7;
  });
  const short = (name) => (name.length >= 48 ? 0 : 1);
  return todo.sort((a, b) => short(a[1]) - short(b[1]) || (a[0] < b[0] ? -1 : 1)).map((x) => x[0]);
}

/* one product -> {kind: 'found', name} | {kind: 'missing'} | {kind: 'limited', wait} | {kind: 'fail', why} */
async function read(code) {
  let res, text;
  try {
    res = await fetch(JINA + SL.productUrl(code), { signal: AbortSignal.timeout(60000) });
    text = await res.text();
  } catch (e) {
    return { kind: 'fail', why: 'jina: no answer (' + String((e.cause && e.cause.code) || e.message).slice(0, 80) + ')', blocked: true };
  }
  if (res.status === 429) {
    const m = /"retryAfter"\s*:\s*(\d+)/.exec(text.slice(0, 600));
    return { kind: 'limited', wait: Math.min(Math.max(m ? Number(m[1]) : 0, 10), 90) * 1000 };
  }
  let r;
  try { r = JSON.parse(JSON.stringify(SL.interpret({ status: res.status, text }, code))); } catch (e) {
    return { kind: 'fail', why: 'page could not be read' };
  }
  if (r.status === 'notfound') return { kind: 'missing' };
  if (r.status === 'blocked') return { kind: 'fail', why: 'turned away (' + (r.why || 'blocked') + ', HTTP ' + res.status + ')', blocked: true };
  if ((r.status === 'found' || r.status === 'partial') && r.name && !r.unsure) return { kind: 'found', name: r.name };
  return { kind: 'fail', why: 'page: ' + r.status + (r.unsure ? ", doesn't mention the code" : r.name ? '' : ', no name') };
}

function save(head) {
  const keys = Object.keys(products).sort();
  const lines = keys.map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(products[k])}`);
  const top = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  fs.writeFileSync(path.join(ROOT, OUT), `{\n${top.join(',\n')},\n  "products": {\n${lines.join(',\n')}\n  }\n}\n`);
}

async function main() {
  const probing = !!(state.lastRun && state.lastRun.stopped);
  const limit = probing ? Math.min(PROBE, Number(process.env.LIMIT || 300)) : Number(process.env.LIMIT || 300);
  const todo = queue().slice(0, limit);
  log(`${todo.length} to try${probing ? ' (a small try after last time\'s stop)' : ''}; ${GAP / 1000} s apart`);
  const run = { date: today, tried: 0, found: 0, missing: 0, failed: 0, stopped: null };
  let inARow = 0, lastWhy = '', next = Date.now();

  for (const code of todo) {
    await sleep(Math.max(0, next - Date.now()));
    next = Date.now() + GAP + Math.round(Math.random() * GAP * 0.3);
    let got = await read(code);
    if (got.kind === 'limited') { log(`  jina said slow down: waiting ${got.wait / 1000} s`); await sleep(got.wait); got = await read(code); }
    if (got.kind === 'limited') got = { kind: 'fail', why: 'jina kept saying slow down (HTTP 429)', blocked: true };
    run.tried++;
    if (got.kind === 'found') {
      products[code] = { name: got.name, at: today };
      run.found++; inARow = 0;
      log(`  ${code} ${got.name}`);
    } else if (got.kind === 'missing') {
      products[code] = { missing: true, at: today };
      run.missing++; inARow = 0;
      log(`  ${code} no page on screwfix.com`);
    } else {
      const before = products[code] || {};
      products[code] = { tries: (before.tries || 0) + 1, at: today, why: got.why };
      run.failed++; lastWhy = got.why;
      inARow = got.blocked ? inARow + 1 : 0;      // only being turned away (or no answer) counts towards stopping
      log(`  ${code} FAILED: ${got.why}`);
      if (inARow >= STOP_AFTER) {
        run.stopped = `${STOP_AFTER} products in a row couldn't be read (last: ${lastWhy})`;
        break;
      }
    }
  }

  const named = Object.values(products).filter((p) => p.name).length;
  save({ updated: new Date().toISOString(), lastRun: run, named, of: list.items.length });
  const summary = `Product names: tried ${run.tried}, found ${run.found}, no page ${run.missing}, failed ${run.failed}. ` +
    `${named} of ${list.items.length} named so far.` + (run.stopped ? ` STOPPED: ${run.stopped}.` : '');
  log(summary);
  if (process.env.RUNNER_TEMP) {
    fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'names-commit.txt'),
      `Product names: ${run.found} found${run.stopped ? ', stopped early' : ''} (${named} of ${list.items.length}) [skip ci]\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  if (run.stopped) {
    annotate('error', 'Product names stopped', run.stopped + '. The next run only tries ' + PROBE + ' products.');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
