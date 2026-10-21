// Area Map: the store list holds only what's meant to be public, the area shapes are up to date with it, and the
// search finds what people will type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from './load.mjs';
import { makeAreas } from '../area-map/make-areas.mjs';

const require = createRequire(import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const stores = () => read('tools/area-map/data/stores.json');
const areas = () => read('tools/area-map/data/areas.json').areas;
const G = require(path.join(REPO, 'tools/area-map/geo.js'));
const data = G.setup(stores(), areas());
const find = (q) => G.search(data, q);

test('each store has its name, address, area and where it is, and nothing else (the repo is public)', () => {
  const list = stores();
  assert.ok(list.length > 900);
  const allowed = ['name', 'address', 'postcode', 'area', 'country', 'lat', 'lng', 'approx'];
  const countries = ['England', 'London', 'Scotland', 'Wales', 'Northern Ireland', 'Ireland', 'Isle of Man'];
  for (const s of list) {
    for (const k of Object.keys(s)) assert.ok(allowed.includes(k), s.name + ' has "' + k + '": only ' + allowed.join(', ') + ' belong here');
    assert.ok(s.name && s.address && s.postcode && s.area, 'missing a detail: ' + JSON.stringify(s));
    assert.ok(countries.includes(s.country), s.name + ': country ' + s.country);
    assert.ok(s.lat > 49.8 && s.lat < 61 && s.lng > -10.7 && s.lng < 2, s.name + ' is placed off the map: ' + s.lat + ',' + s.lng);
  }
  const ids = list.map((s) => G.slug(s.name));
  assert.equal(new Set(ids).size, ids.length, 'two stores share a name, so their links would clash');
});

test('the area shapes are up to date with the store list (if not: cd .github && node area-map/make-areas.mjs)', () => {
  const land = read('.github/area-map/land.json');
  assert.deepEqual(makeAreas(stores(), land).areas, areas());
});

test('no two neighbouring areas share a colour or have two that look alike', () => {
  const src = fs.readFileSync(path.join(REPO, '.github/area-map/make-areas.mjs'), 'utf8');
  const alike = JSON.parse(/const ALIKE = (\[.*\]);/.exec(src)[1]);
  const list = areas(), byId = Object.fromEntries(list.map((a) => [a.id, a]));
  for (const a of list) {
    assert.ok(a.next.length, 'Area ' + a.id + ' has no neighbours');
    for (const n of a.next) {
      const b = byId[n], pair = [a.color, b.color].sort();
      assert.notEqual(a.color, b.color, 'Areas ' + a.id + ' and ' + n + ' are the same colour');
      assert.ok(!alike.some((p) => p[0] === pair[0] && p[1] === pair[1]), 'Areas ' + a.id + ' and ' + n + ' have look-alike colours');
      assert.ok(b.next.includes(a.id), 'neighbours go both ways: ' + a.id + ' and ' + n);
    }
  }
});

test('every store sits in its own area on the map (or just off the coastline)', () => {
  let offshore = 0;
  for (const s of data.stores) {
    const a = G.areaAt(data.areas, s);
    if (!a) { offshore++; continue; }
    assert.equal(a.id, s.area, s.name + ' is drawn inside Area ' + a.id + ', not its own Area ' + s.area);
  }
  assert.ok(offshore < 40, offshore + ' stores fall outside the coastline: the coastline file looks wrong');
  assert.equal(data.areas.length, new Set(data.stores.map((s) => s.area)).size, 'an area with stores has no shape, or the other way round');
});

test('search: area numbers', () => {
  for (const q of ['20', 'area 20', 'Area 20', ' 20 ']) assert.deepEqual(find(q).areas.map((a) => a.id), ['20'], q);
  assert.equal(find('20').stores.length, 0, '"20" is the area, not every store with a 20 in its address');
  for (const q of ['I01', 'i1', 'area I1', 'I 01']) assert.deepEqual(find(q).areas.map((a) => a.id), ['I01'], q);
});

test('search: store names, towns, close spellings and postcodes', () => {
  const first = (q) => (find(q).stores[0] || {}).name;
  assert.equal(first('dunstable'), 'Dunstable');
  assert.equal(first('Leighton Buzzard'), 'Leighton Buzzard');
  assert.equal(first('leighton buzard'), 'Leighton Buzzard', 'one letter out');
  assert.equal(first('hemel'), 'Hemel Hempstead');
  assert.equal(first('LU7 4TU'), 'Leighton Buzzard');
  assert.equal(first('lu74tu'), 'Leighton Buzzard');
  assert.equal(first('kinsale road'), 'Cork - Kinsale Road');
  assert.ok(find('glasgo').stores.length >= 5 && find('glasgo').stores.every((s) => /glasgow/i.test(s.name + s.address)), 'glasgo finds Glasgow');
  assert.ok(find('LU5').stores.some((s) => s.name === 'Dunstable'), 'a postcode district');
  assert.ok(find('st albans').stores.some((s) => /St Albans/.test(s.name)));
  assert.equal(find('zzzzqqq').stores.length, 0);
});

test('search: which searches also look up UK places', () => {
  assert.equal(G.looksLikePlace('LU7 4TU'), 'postcode');
  assert.equal(G.looksLikePlace('lu74tu'), 'postcode');
  assert.equal(G.looksLikePlace('LU7'), 'outcode');
  assert.equal(G.looksLikePlace('Milton Keynes'), 'place');
  assert.equal(G.looksLikePlace('I02'), '', 'an area, not a postcode');
  assert.equal(G.looksLikePlace('20'), '');
});

test('distances, nearest stores and the area at a spot', () => {
  const lb = data.stores.find((s) => s.name === 'Leighton Buzzard'), dun = data.stores.find((s) => s.name === 'Dunstable');
  const m = G.miles(lb, dun);
  assert.ok(m > 6 && m < 9, 'Leighton Buzzard to Dunstable is about 7 miles, got ' + m);
  assert.equal(G.distance(0.4), '0.4 miles');
  assert.equal(G.distance(1), '1.0 mile');
  assert.equal(G.distance(23.4), '23 miles');
  assert.equal(G.distance(10, true), '16 km');
  assert.equal(G.nearest(data.stores, lb, 1)[0].store, lb);
  assert.equal(G.areaAt(data.areas, { lat: 51.88, lng: -0.42 }).id, '20', 'Luton is in Area 20');
  assert.ok(G.areaAt(data.areas, { lat: 53.35, lng: -6.26 }).id.startsWith('I'), 'Dublin is in an Irish area');
  assert.equal(G.areaAt(data.areas, { lat: 54.0, lng: -5.5 }), null, 'the Irish Sea is in no area');
});

test('the CSV download quotes what needs quoting', () => {
  const csv = G.csv([{ name: 'A "B"', address: '1 Road, Town', postcode: 'AB1 2CD', country: 'England', area: '20' }]);
  assert.equal(csv, 'Store,Address,Postcode,Country,Area\r\n"A ""B""","1 Road, Town",AB1 2CD,England,20\r\n');
});
