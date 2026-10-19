// Hourly fuel price check for the Toolbox "Fuel Prices" page (Leighton Buzzard).
//
// Reads PetrolPrices.co.uk's public Leighton Buzzard page, which shows the UK Government Fuel Finder feed (every
// forecourt has to report a price change within 30 minutes). The government's own feed blocks GitHub's servers,
// so this page is the way in. If GitHub can't read it directly it tries once through jina (r.jina.ai).
// Saves tools/fuel/data/prices.json when a price changes, a forecourt comes or goes, or the saved copy is 3 hours
// old (so the page can say when GitHub last looked). Reading the page uses tools/fuel/parse.js, the same file
// the page itself uses, so both always read it the same way.
//
// A failed read only fails the run (a red cross and an email) once the saved prices are more than a day old, so a
// short outage on their side doesn't send an email every hour.
//
// Test hooks: FUEL_URL (the page to read), JINA_URL (the jina relay), FUEL_NOW (pretend time), FUEL_DIR (data folder).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'tools/fuel/parse.js'), 'utf8'), { filename: 'tools/fuel/parse.js' });
const F = globalThis.FuelParse;

const DIR = process.env.FUEL_DIR || path.join(process.cwd(), 'tools/fuel/data');
const FILE = path.join(DIR, 'prices.json');
const PAGE = process.env.FUEL_URL || F.URL;
const JINA = process.env.JINA_URL || 'https://r.jina.ai/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const now = process.env.FUEL_NOW ? new Date(process.env.FUEL_NOW) : new Date();
const NOW = now.toISOString();
const TEMP = process.env.RUNNER_TEMP || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hours = (iso) => (iso ? (now - new Date(iso)) / 3600000 : Infinity);

let saved = null;
try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }
const known = saved && saved.stations ? saved.stations : {};

async function get(url, headers) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(40000) });
    const body = await r.text();
    return r.ok ? { body } : { why: 'HTTP ' + r.status };
  } catch (e) {
    return { why: String(e.cause?.code || e.name || e.message) };
  }
}

/* -> {res} or {why}: the page read directly (twice, 20 s apart), then through jina */
async function read() {
  const whys = [];
  for (const [how, url, headers, wait] of [
    ['direct', PAGE, { accept: 'text/html' }, 0],
    ['direct', PAGE, { accept: 'text/html' }, 20000],
    ['jina', JINA + PAGE, { accept: 'text/plain' }, 3000]
  ]) {
    if (wait) await sleep(wait);
    const g = await get(url, headers);
    if (g.why) { whys.push(how + ': ' + g.why); continue; }
    const res = F.parse(g.body, { now, known });
    const bad = F.ok(res);
    if (!bad) { res.how = how; return { res }; }
    whys.push(how + ': ' + bad);
  }
  return { why: whys.join('; ') };
}

function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}

const { res, why } = await read();
if (!res) {
  const age = hours(saved && saved.checked);
  const msg = `Couldn't read the fuel prices (${why}). Saved prices are ${isFinite(age) ? Math.round(age) + ' hours' : 'not there'} old.`;
  console.log((age > 24 ? '::error::' : '::warning::') + msg);
  summary(['### Fuel prices', '', msg]);
  process.exit(age > 24 ? 1 : 0);
}

const { data, changes, changed } = F.merge(saved, res, NOW);
const stale = hours(saved && saved.checked) >= 3;
const rank = (f) => Object.values(data.stations).filter((s) => s[f].p !== null).sort((a, b) => a[f].p - b[f].p);
const table = (f) => rank(f).map((s, i) => `| ${i + 1} | ${s.name} | ${s[f].p.toFixed(1)}p |`);
summary(['### Leighton Buzzard fuel', '', `Read ${res.how}, ${res.stations.length} forecourts, reported ${res.reported || 'at an unknown time'}.`,
  changes.length ? '\nChanges: ' + changes.join('; ') : '\nNo price changes.', '',
  '| | Petrol (E10) | |', '|---|---|---|', ...table('petrol'), '', '| | Diesel (B7) | |', '|---|---|---|', ...table('diesel')]);
console.log(`Read ${res.how}: ${res.stations.length} forecourts, reported ${res.reported}. ${changes.length ? changes.join('; ') : 'No changes.'}`);

if (changed || stale || !saved) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
  const title = changes.length ? 'Fuel prices: ' + changes.slice(0, 3).join(', ') + (changes.length > 3 ? ' and ' + (changes.length - 3) + ' more' : '') : 'Fuel prices checked, no changes';
  if (TEMP) fs.writeFileSync(path.join(TEMP, 'fuel-commit.txt'), title + '\n');
  console.log('Saved: ' + title);
} else {
  console.log('Nothing to save (no changes, saved ' + Math.round(hours(saved.checked) * 60) + ' minutes ago).');
}
