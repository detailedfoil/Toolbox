// Real road drive times between the Area 20 stores, for Stock Stealer (detailedfoil, 20 Nov 2026).
// Runs on GitHub (the sandbox I work in can't reach a routing service). Asks the public OSRM car router for the
// whole table at once, in minutes, and saves tools/stock-swaps/data/drive.json:
//   { made, names: [page names, same order as STORES in make-plans.py], minutes: [[one way minutes]] }
// make-plans.py uses it when it exists (round trip = there + back); without it, it falls back to the distance estimate.
import fs from 'node:fs';

const src = fs.readFileSync('.github/stock-swaps/make-plans.py', 'utf8');
const block = src.slice(src.indexOf('STORES = ['), src.indexOf(']\n', src.indexOf('STORES = [')));
const stores = [...block.matchAll(/\("([^"]+)",\s*"([^"]+)",\s*\d+,\s*([\d.-]+),\s*([\d.-]+)\)/g)]
  .map(m => ({ name: m[2], lat: +m[3], lng: +m[4] }));
if (stores.length < 20) throw new Error('read only ' + stores.length + ' stores');

const coords = stores.map(s => s.lng.toFixed(5) + ',' + s.lat.toFixed(5)).join(';');
const hosts = [
  'https://router.project-osrm.org/table/v1/driving/',
  'https://routing.openstreetmap.de/routed-car/table/v1/driving/',
];
let table = null;
for (const h of hosts) {
  for (let i = 0; i < 3 && !table; i++) {
    try {
      const r = await fetch(h + coords + '?annotations=duration', { headers: { 'User-Agent': 'Toolbox-StockStealer (github.com/detailedfoil/Toolbox)' } });
      const j = await r.json();
      if (j.code === 'Ok' && j.durations) table = j.durations;
      else console.log(h, 'said', j.code);
    } catch (e) { console.log(h, e.message); }
    if (!table) await new Promise(r => setTimeout(r, 4000));
  }
  if (table) break;
}
if (!table) throw new Error('no routing service answered');

const n = stores.length;
const minutes = table.map(row => row.map(s => (s === null ? null : Math.round(s / 6) / 10)));
for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
  if (a !== b && (minutes[a][b] === null || minutes[a][b] <= 0)) throw new Error('no road route ' + stores[a].name + ' to ' + stores[b].name);
}
fs.mkdirSync('tools/stock-swaps/data', { recursive: true });
fs.writeFileSync('tools/stock-swaps/data/drive.json', JSON.stringify({ made: new Date().toISOString().slice(0, 10), names: stores.map(s => s.name), minutes }) + '\n');
console.log('saved', n, 'stores; Dunstable to Luton Bilton Way', minutes[5][15], 'min');
