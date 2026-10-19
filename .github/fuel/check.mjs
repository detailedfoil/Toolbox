// Fuel price backup for the Toolbox "Fuel Prices" page, Leighton Buzzard only (every 3 hours, see fuel.yml).
//
// Every store's page reads its prices live when it's opened. This saves Leighton Buzzard's to
// tools/fuel/data/prices.json as a fallback and a history of what changed. It reads PetrolPrices.co.uk's fuel
// map for Leighton Buzzard (the UK Government Fuel Finder feed) through jina (r.jina.ai), which runs the map's
// page and hands back its text: once for petrol (E10) and once for diesel (B7). The government's own feed blocks
// GitHub's servers, and the map needs a browser to fill in its list, hence jina. Reading the text uses
// tools/fuel/parse.js, the same file the page uses.
//
// Saves when a price changes, a forecourt comes or goes, or the saved copy is over 5 hours old. A failed read
// only fails the run (a red cross and an email) once the saved prices are more than a day old.
//
// Test hooks: JINA_URL (the jina relay), FUEL_NOW (pretend time), FUEL_DIR (data folder), GAP_MS (pause).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'tools/fuel/parse.js'), 'utf8'), { filename: 'tools/fuel/parse.js' });
const F = globalThis.FuelParse;

const PLACE = 'Leighton Buzzard';
const DIR = process.env.FUEL_DIR || path.join(process.cwd(), 'tools/fuel/data');
const FILE = path.join(DIR, 'prices.json');
const JINA = process.env.JINA_URL || 'https://r.jina.ai/';
const GAP = Number(process.env.GAP_MS || 4000);
const now = process.env.FUEL_NOW ? new Date(process.env.FUEL_NOW) : new Date();
const NOW = now.toISOString();
const TEMP = process.env.RUNNER_TEMP || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hours = (iso) => (iso ? (now - new Date(iso)) / 3600000 : Infinity);

let saved = null;
try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }
if (saved && saved.place !== PLACE) saved = null; // an older layout of the file

/* one fuel -> {res} or {why}; two tries, 20 s apart */
async function read(fuel) {
  const whys = [];
  for (let i = 0; i < 2; i++) {
    if (i) await sleep(GAP * 5);
    try {
      const r = await fetch(JINA + F.mapURL(PLACE, fuel), { headers: { accept: 'text/plain', 'x-timeout': '20' }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) { whys.push('HTTP ' + r.status); continue; }
      const res = F.parse(await r.text(), { now });
      const bad = F.ok(res);
      if (!bad) return { res };
      whys.push(bad);
    } catch (e) {
      whys.push(String(e.cause?.code || e.name || e.message));
    }
  }
  return { why: fuel + ': ' + whys.join(', ') };
}

function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}

const petrol = await read('petrol');
await sleep(GAP);
const diesel = await read('diesel');
if (!petrol.res || !diesel.res) {
  const age = hours(saved && saved.checked);
  const msg = `Couldn't read the fuel prices (${[petrol.why, diesel.why].filter(Boolean).join('; ')}). Saved prices are ${isFinite(age) ? Math.round(age) + ' hours' : 'not there'} old.`;
  console.log((age > 24 ? '::error::' : '::warning::') + msg);
  summary(['### Fuel prices', '', msg]);
  process.exit(age > 24 ? 1 : 0);
}

const list = F.combine(petrol.res, diesel.res);
const synced = [petrol.res.synced, diesel.res.synced].filter(Boolean).sort().pop() || null;
const { data, changes, changed } = F.merge(saved, list, synced, NOW, PLACE);
const rank = (f) => list.filter((s) => s[f]).sort((a, b) => a[f].p - b[f].p);
const table = (f) => rank(f).map((s, i) => `| ${i + 1} | ${s.brand}, ${s.address} | ${s[f].p.toFixed(1)}p | ${s[f].date || ''} |`);
summary(['### Leighton Buzzard fuel', '', `${list.length} forecourts within ${F.RADIUS} miles, site synced ${synced || 'at an unknown time'}.`,
  changes.length ? '\nChanges: ' + changes.join('; ') : '\nNo price changes.', '',
  '| | Petrol (E10) | | Reported |', '|---|---|---|---|', ...table('petrol'), '', '| | Diesel (B7) | | Reported |', '|---|---|---|---|', ...table('diesel')]);
console.log(`${list.length} forecourts, synced ${synced}. ${changes.length ? changes.join('; ') : 'No changes.'}`);

if (changed || !saved || hours(saved.checked) >= 5) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
  const title = changes.length ? 'Fuel prices: ' + changes.slice(0, 3).join(', ') + (changes.length > 3 ? ' and ' + (changes.length - 3) + ' more' : '') : 'Fuel prices checked, no changes';
  if (TEMP) fs.writeFileSync(path.join(TEMP, 'fuel-commit.txt'), title + '\n');
  console.log('Saved: ' + title);
} else {
  console.log('Nothing to save (no changes, saved ' + Math.round(hours(saved.checked) * 60) + ' minutes ago).');
}
