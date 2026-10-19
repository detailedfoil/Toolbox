// The Fuel Prices page and its Leighton Buzzard backup on GitHub: reading PetrolPrices.co.uk's fuel map as jina
// renders it to text (real copies saved on 19 Oct 2026 in fixtures/), and the backup run start to finish against a
// pretend jina.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO } from './load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(REPO, 'tools/fuel/parse.js'), 'utf8'), sandbox);
const F = sandbox.FuelParse;
const fixture = (f) => fs.readFileSync(path.join(HERE, 'fixtures', 'fuel-' + f + '.txt'), 'utf8');
const LBP = fixture('lb-petrol'), LBD = fixture('lb-diesel'), LUTON = fixture('luton-petrol');
const NOW = '2026-10-19T12:00:00.000Z';
const plain = (x) => JSON.parse(JSON.stringify(x));

test('fuel: reads every forecourt on the map, with its price, distance and when it was last reported', () => {
  const r = F.parse(LBP, { now: NOW });
  assert.equal(F.ok(r), '');
  assert.equal(r.count, 5);
  assert.equal(r.synced, '2026-10-19T12:39:00+01:00');
  assert.deepEqual(plain(r.stations.map(({ brand, address, p, miles, date }) => [brand, address, p, miles, date])), [
    ['BP', '45 Lake Street Leighton Buzzard', 166.7, 0.2, '2026-10-19'],
    ['Morrisons', 'Lake Street, Leighton Buzzard', 166.7, 0.3, '2026-10-14'],
    ['Tesco', 'Vimy Road, Leighton Buzzard', 168.9, 0.3, '2026-10-15'],
    ['Shell', 'Leighton Road, Leighton Buzzard, Luton', 169.9, 0.3, '2026-10-16'],
    ['Shell', 'Billington Road, Leighton Buzzard', 173.9, 1.2, '2026-10-13']
  ]);
  const luton = F.parse(LUTON, { now: NOW });
  assert.equal(F.ok(luton), '');
  assert.equal(luton.stations.length, 27, 'adverts between the cards are skipped, every forecourt is read');
  assert.equal(luton.stations.find((s) => /Sundon Park/.test(s.address)).brand, 'Essar');
  assert.equal(luton.stations.find((s) => /Skimpot/.test(s.address)).date, '2026-09-21');
});

test('fuel: petrol and diesel join up by forecourt, nearest first', () => {
  const c = plain(F.combine(F.parse(LBP, { now: NOW }), F.parse(LBD, { now: NOW })));
  assert.deepEqual(c.map((s) => [s.brand, s.miles, s.petrol.p, s.diesel.p]), [
    ['BP', 0.2, 166.7, 194.7], ['Morrisons', 0.3, 166.7, 194.7], ['Tesco', 0.3, 168.9, 193.9], ['Shell', 0.3, 169.9, 199.9], ['Shell', 1.2, 173.9, 201.9]
  ]);
  // a forecourt that only sells petrol has no diesel, rather than being dropped
  const noDiesel = F.parse(LBD, { now: NOW });
  noDiesel.stations = noDiesel.stations.slice(1);
  assert.equal(plain(F.combine(F.parse(LBP, { now: NOW }), noDiesel))[0].diesel, null);
});

test('fuel: messy map addresses are tidied, and an independent takes its own name', () => {
  const t = (b, a) => plain(F.tidy(b, a));
  assert.deepEqual(t('Shell', 'Shell, 40-42, Woodside Road, Amersham'), { brand: 'Shell', address: '40-42 Woodside Road, Amersham' });
  assert.deepEqual(t('Tesco', 'Tesco Stores Ltd, Vimy Road, Leighton Buzzard'), { brand: 'Tesco', address: 'Vimy Road, Leighton Buzzard' });
  assert.deepEqual(t('Esso', 'Mantles Used Car, Old North Road, Royston, SG8 5DQ, Royston'), { brand: 'Esso', address: 'Mantles Used Car, Old North Road, Royston' });
  assert.deepEqual(t('Independent', 'Fitchs Service Station Ltd, Amersham Road, Chesham, HP5 1NQ, Chesham'), { brand: 'Fitchs Service Station', address: 'Amersham Road, Chesham' });
  assert.deepEqual(t('BP', '45 Lake Street Leighton Buzzard Bedfordshire, Bedfordshire'), { brand: 'BP', address: '45 Lake Street Leighton Buzzard' });
});

test('fuel: a map that never filled in its list, or lost forecourts, is not believed', () => {
  const empty = LBP.slice(0, LBP.indexOf('Enable location permissions'));
  assert.match(F.ok(F.parse(empty, { now: NOW })), /no forecourts/);
  const cut = LBP.slice(0, LBP.lastIndexOf('to fill (55L)') - 30);
  assert.match(F.ok(F.parse(cut, { now: NOW })), /has 5 forecourts but only 4/);
});

test('fuel: every Area 20 store has a place, and its map link asks for the right fuel', () => {
  assert.equal(F.STORES.length, 22);
  for (const s of F.STORES) assert.ok(s.place && /^[A-Z0-9]{3}$/.test(s.code) && s.town, JSON.stringify(s));
  assert.equal(F.STORES.find((s) => s.code === 'FA2').place, 'Leighton Buzzard');
  assert.equal(F.mapURL('Leighton Buzzard', 'diesel'), 'https://www.petrolprices.co.uk/map.php?location=Leighton%20Buzzard&fuel_type=B7&radius=5');
  // the NPS sheet's store names, so a store reads the same everywhere on the site
  const nps = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/nps/data/data.json'), 'utf8')).stores.map((s) => s.name).sort();
  assert.deepEqual(plain(F.STORES.map((s) => s.name).sort()), nps);
});

test('fuel: a changed price keeps the old one and when it changed; an unchanged one keeps its time', () => {
  const list = () => F.combine(F.parse(LBP, { now: NOW }), F.parse(LBD, { now: NOW }));
  const first = F.merge(null, list(), '2026-10-19T12:39:00+01:00', NOW, 'Leighton Buzzard');
  assert.equal(first.changed, true);
  assert.equal(first.data.place, 'Leighton Buzzard');
  const later = '2026-10-19T15:00:00.000Z', l2 = list();
  l2[2].petrol = { p: 167.9, date: '2026-10-19' };
  const m = F.merge(first.data, l2, null, later);
  assert.deepEqual(plain(m.changes), ['Tesco, Vimy Road petrol 167.9p (was 168.9p)']);
  const tesco = m.data.stations[l2[2].key];
  assert.deepEqual(plain(tesco.petrol), { p: 167.9, date: '2026-10-19', since: later, prev: 168.9, prevSince: NOW });
  assert.deepEqual(plain(tesco.diesel), { p: 193.9, date: '2026-10-15', since: NOW });
  assert.equal(m.data.synced, '2026-10-19T12:39:00+01:00', 'keeps the last known sync time');
  const gone = F.merge(m.data, l2.slice(0, 4), null, later);
  assert.deepEqual(plain(gone.changes), ['No longer listed: Shell, Billington Road']);
});

/* ---------- the Leighton Buzzard backup, start to finish ---------- */

function jina() {
  const s = { petrol: () => [200, LBP], diesel: () => [200, LBD], hits: [] };
  s.server = http.createServer((req, res) => {
    const fuel = /fuel_type=B7/.test(req.url) ? 'diesel' : 'petrol';
    s.hits.push(fuel + (/location=Leighton%20Buzzard/.test(req.url) ? '' : ' (wrong place)'));
    const [code, body] = s[fuel]();
    res.writeHead(code, { 'content-type': 'text/plain' });
    res.end(body);
  });
  return new Promise((ok) => s.server.listen(0, '127.0.0.1', () => { s.port = s.server.address().port; ok(s); }));
}

async function check(s, dir, now) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-temp-'));
  const env = { PATH: process.env.PATH, JINA_URL: `http://127.0.0.1:${s.port}/`, FUEL_DIR: dir, FUEL_NOW: now, GAP_MS: '10',
                RUNNER_TEMP: temp, GITHUB_STEP_SUMMARY: path.join(temp, 'summary.md') };
  const out = await new Promise((ok) => {
    const p = spawn(process.execPath, ['--import', pathToFileURL(path.join(HERE, 'preload.mjs')).href, path.join(REPO, '.github/fuel/check.mjs')], { env });
    let stdout = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stdout += d; });
    p.on('close', (code) => ok({ code, stdout }));
  });
  const read = (f) => (fs.existsSync(path.join(temp, f)) ? fs.readFileSync(path.join(temp, f), 'utf8') : '');
  out.commit = read('fuel-commit.txt');
  out.summary = read('summary.md');
  fs.rmSync(temp, { recursive: true, force: true });
  const file = path.join(dir, 'prices.json');
  out.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return out;
}

test('fuel backup: saves the first read, skips an unchanged one, saves a change and a 5 hour old copy', async () => {
  const s = await jina(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-data-'));
  try {
    fs.writeFileSync(path.join(dir, 'prices.json'), JSON.stringify({ source: 'the old town page layout', stations: { 'LU7 1ER': { name: 'Tesco' } } }));
    let r = await check(s, dir, NOW);
    assert.equal(r.code, 0, r.stdout);
    assert.deepEqual(s.hits, ['petrol', 'diesel']);
    assert.equal(r.data.place, 'Leighton Buzzard');
    assert.equal(Object.keys(r.data.stations).length, 5);
    assert.equal(r.data.checked, NOW);
    assert.match(r.summary, /\| 1 \| BP, 45 Lake Street Leighton Buzzard \| 166\.7p \| 2026-10-19 \|/);
    assert.match(r.commit, /New forecourt/);

    r = await check(s, dir, '2026-10-19T15:00:00.000Z');
    assert.equal(r.commit, '', 'nothing changed 3 hours later, so nothing to commit');

    s.diesel = () => [200, LBD.replace('194.7p\n\n£107.08 to fill', '192.9p\n\n£106.10 to fill')];
    r = await check(s, dir, '2026-10-19T18:00:00.000Z');
    assert.match(r.commit, /^Fuel prices: BP, 45 Lake Street Leighton Buzzard diesel 192\.9p \(was 194\.7p\)/);

    r = await check(s, dir, '2026-10-19T23:30:00.000Z');
    assert.equal(r.commit, 'Fuel prices checked, no changes\n');
  } finally {
    s.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fuel backup: a map that won't fill in is tried twice, and only fails the run once the prices are a day old", async () => {
  const s = await jina(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-data-'));
  try {
    let r = await check(s, dir, NOW);
    assert.equal(r.code, 0, r.stdout);
    s.hits.length = 0;
    s.petrol = () => [200, LBP.slice(0, LBP.indexOf('Enable location permissions'))];
    r = await check(s, dir, '2026-10-19T18:00:00.000Z');
    assert.equal(r.code, 0, 'a few hours without prices is only a warning');
    assert.deepEqual(s.hits, ['petrol', 'petrol', 'diesel']);
    assert.match(r.stdout, /::warning::Couldn't read the fuel prices \(petrol: no forecourts found on the page, no forecourts found on the page\)/);
    assert.equal(r.commit, '');

    s.diesel = () => [503, 'down'];
    r = await check(s, dir, '2026-10-20T13:00:00.000Z');
    assert.equal(r.code, 1, 'a whole day without prices fails the run, so GitHub emails');
    assert.match(r.stdout, /::error::.*diesel: HTTP 503, HTTP 503/);
  } finally {
    s.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
