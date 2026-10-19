// The Fuel Prices page and its hourly GitHub check: reading PetrolPrices.co.uk's Leighton Buzzard page (as HTML on
// GitHub and as jina's text on the phone), and the check run start to finish against a pretend copy of that page.
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
import { LB, html, jinaText } from './fuel-pages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(REPO, 'tools/fuel/parse.js'), 'utf8'), sandbox);
const F = sandbox.FuelParse;
const NOW = '2026-10-19T11:30:00.000Z'; // 12:30 in Leighton Buzzard (BST)
const plain = (x) => JSON.parse(JSON.stringify(x));
const byId = (r) => Object.fromEntries(r.stations.map((s) => [s.id, s]));

test('fuel: reads every forecourt, its address and both prices from the page HTML', () => {
  const r = F.parse(html(), { now: NOW });
  assert.equal(r.format, 'html');
  assert.equal(F.ok(r), '');
  assert.equal(r.listed, 5);
  assert.equal(r.reported, '2026-10-19T12:03:00+01:00');
  assert.deepEqual(plain(byId(r)['LU7 1ER']), { name: 'Tesco Leighton Buzzard Superstore', address: 'Vimy Road, Leighton Buzzard, LU7 1ER', postcode: 'LU7 1ER', petrol: 168.9, diesel: 193.9, id: 'LU7 1ER' });
  assert.equal(byId(r)['LU7 1LA'].name, "Shell Harvest Energy St Christopher's");
  assert.equal(byId(r)['LU7 1RS'].address, '45 Lake Street, Leighton Buzzard, LU7 1RS');
  assert.deepEqual(plain(r.stations.map((s) => s.petrol)), [168.9, 169.9, 166.7, 166.7, 173.9]);
  assert.deepEqual(plain(r.stations.map((s) => s.diesel)), [193.9, 199.9, 194.7, 194.7, 201.9]);
});

test("fuel: reads jina's text version the same way, using the saved names to split name from address", () => {
  const known = Object.fromEntries(LB().map((s) => [s.address.slice(-7), { name: s.name, address: s.address }]));
  const r = F.parse(jinaText(), { now: NOW, known });
  assert.equal(r.format, 'text');
  assert.equal(F.ok(r), '');
  assert.equal(r.reported, '2026-10-19T12:03:00+01:00');
  assert.deepEqual(plain(r.stations.map(({ name, address, petrol, diesel }) => ({ name, address, petrol, diesel }))),
    LB().map((s) => ({ name: s.name, address: s.address, petrol: +s.petrol, diesel: +s.diesel })));
  // with nothing saved yet, a "Cheapest ..." badge still splits them exactly, and the rest split at the first comma
  const cold = byId(F.parse(jinaText(), { now: NOW }));
  assert.equal(cold['LU7 1ER'].name, 'Tesco Leighton Buzzard Superstore');
  assert.equal(cold['LU7 1ER'].address, 'Vimy Road, Leighton Buzzard, LU7 1ER');
  assert.equal(cold['LU7 1WS'].diesel, 194.7);
});

test('fuel: a dash or a silly figure is no price, and a page that lost forecourts is not believed', () => {
  const s = LB();
  s[1].diesel = '-';
  s[4].petrol = '1.739';
  const r = F.parse(html(s), { now: NOW });
  assert.equal(byId(r)['LU7 1LA'].diesel, null);
  assert.equal(byId(r)['LU7 9HH'].petrol, null);
  assert.equal(F.ok(r), '');
  assert.equal(F.parse(jinaText(s), { now: NOW }).stations[1].diesel, null);
  assert.match(F.ok(F.parse(html(LB(), { listed: 6 }), { now: NOW })), /lists 6 forecourts but only 5/);
  assert.match(F.ok(F.parse('<html><body>Sorry, something went wrong</body></html>', { now: NOW })), /no forecourts/);
});

test("fuel: the page's \"last updated\" time, in UK time on the right day", () => {
  const at = (updated, now = NOW) => F.parse(html(LB(), { updated }), { now }).reported;
  assert.equal(at('yesterday at 21:47'), '2026-10-18T21:47:00+01:00');
  assert.equal(at('on 18 October at 9:05'), '2026-10-18T09:05:00+01:00');
  assert.equal(at('today at 08:15', '2026-11-03T10:00:00Z'), '2026-11-03T08:15:00+00:00'); // GMT after the clocks go back
  assert.equal(at('on 31 December at 23:10', '2027-01-01T09:00:00Z'), '2026-12-31T23:10:00+00:00');
  assert.equal(at('a while ago'), null);
});

test('fuel: a changed price keeps the old one and when it changed; an unchanged one keeps its time', () => {
  const first = F.merge(null, F.parse(html(), { now: NOW }), NOW);
  assert.equal(first.changed, true);
  const s = LB();
  s[0].petrol = '167.9';
  const later = '2026-10-19T14:30:00.000Z';
  const m = F.merge(first.data, F.parse(html(s), { now: later }), later);
  assert.deepEqual(plain(m.changes), ['Tesco Leighton Buzzard Superstore petrol 167.9p (was 168.9p)']);
  assert.deepEqual(plain(m.data.stations['LU7 1ER'].petrol), { p: 167.9, since: later, prev: 168.9, prevSince: NOW });
  assert.deepEqual(plain(m.data.stations['LU7 1ER'].diesel), { p: 193.9, since: NOW });
  const gone = F.merge(m.data, F.parse(html(s.slice(0, 4)), { now: later }), later);
  assert.deepEqual(plain(gone.changes), ['No longer listed: Shell Little Waitrose Grovebury']);
});

/* ---------- the hourly check, start to finish ---------- */

function site() {
  const s = { direct: () => [200, html()], jina: () => [200, jinaText()], hits: [] };
  s.server = http.createServer((req, res) => {
    const kind = req.url.startsWith('/jina/') ? 'jina' : 'direct';
    s.hits.push(kind);
    const [code, body] = s[kind]();
    res.writeHead(code, { 'content-type': kind === 'jina' ? 'text/plain' : 'text/html' });
    res.end(body);
  });
  return new Promise((ok) => s.server.listen(0, '127.0.0.1', () => { s.port = s.server.address().port; ok(s); }));
}

async function check(s, dir, now) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-temp-'));
  const env = { PATH: process.env.PATH, MOCK_PORT: String(s.port), FUEL_URL: `http://127.0.0.1:${s.port}/towns/leighton-buzzard.php`,
                JINA_URL: `http://127.0.0.1:${s.port}/jina/`, FUEL_DIR: dir, FUEL_NOW: now, RUNNER_TEMP: temp, GITHUB_STEP_SUMMARY: path.join(temp, 'summary.md') };
  const out = await new Promise((ok) => {
    const p = spawn(process.execPath, ['--import', pathToFileURL(path.join(HERE, 'preload.mjs')).href, path.join(REPO, '.github/fuel/check.mjs')], { env });
    let stdout = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stdout += d; });
    p.on('close', (code) => ok({ code, stdout }));
  });
  const commit = path.join(temp, 'fuel-commit.txt');
  out.commit = fs.existsSync(commit) ? fs.readFileSync(commit, 'utf8') : '';
  out.summary = fs.existsSync(path.join(temp, 'summary.md')) ? fs.readFileSync(path.join(temp, 'summary.md'), 'utf8') : '';
  fs.rmSync(temp, { recursive: true, force: true });
  const file = path.join(dir, 'prices.json');
  out.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return out;
}

test('fuel check: saves the first read, skips an unchanged one, saves a change and a 3 hour old copy', async () => {
  const s = await site(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-data-'));
  try {
    let r = await check(s, dir, NOW);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(Object.keys(r.data.stations).length, 5);
    assert.equal(r.data.checked, NOW);
    assert.equal(r.data.reported, '2026-10-19T12:03:00+01:00');
    assert.match(r.summary, /\| 1 \| BP Lake Street Service Station \| 166\.7p \|/);
    assert.match(r.commit, /New forecourt/);

    r = await check(s, dir, '2026-10-19T12:30:00.000Z');
    assert.equal(r.commit, '', 'nothing changed an hour later, so nothing to commit');
    assert.equal(r.data.checked, NOW);

    const lb = LB();
    lb[3].diesel = '192.9';
    s.direct = () => [200, html(lb, { updated: 'today at 14:10' })];
    r = await check(s, dir, '2026-10-19T13:30:00.000Z');
    assert.equal(r.commit, 'Fuel prices: Morrisons Leighton Buzzard diesel 192.9p (was 194.7p)\n');
    assert.deepEqual(r.data.stations['LU7 1WS'].diesel, { p: 192.9, since: '2026-10-19T13:30:00.000Z', prev: 194.7, prevSince: NOW });

    r = await check(s, dir, '2026-10-19T16:45:00.000Z');
    assert.equal(r.commit, 'Fuel prices checked, no changes\n');
    assert.equal(r.data.checked, '2026-10-19T16:45:00.000Z');
  } finally {
    s.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fuel check: tries jina when the page can\'t be read, and only fails the run once the prices are a day old', async () => {
  const s = await site(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-data-'));
  try {
    s.direct = () => [503, 'down'];
    let r = await check(s, dir, NOW);
    assert.equal(r.code, 0, r.stdout);
    assert.deepEqual(s.hits, ['direct', 'direct', 'jina']);
    assert.match(r.stdout, /Read jina/);
    assert.equal(r.data.stations['LU7 1ER'].name, 'Tesco Leighton Buzzard Superstore');

    s.jina = () => [200, 'Title: Error\n\nnothing here'];
    r = await check(s, dir, '2026-10-19T20:00:00.000Z');
    assert.equal(r.code, 0, 'a few hours without prices is only a warning');
    assert.match(r.stdout, /::warning::Couldn't read the fuel prices \(direct: HTTP 503; direct: HTTP 503; jina: no forecourts found on the page\)/);
    assert.equal(r.commit, '');

    r = await check(s, dir, '2026-10-20T12:00:00.000Z');
    assert.equal(r.code, 1, 'a whole day without prices fails the run, so GitHub emails');
    assert.match(r.stdout, /::error::/);
  } finally {
    s.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
