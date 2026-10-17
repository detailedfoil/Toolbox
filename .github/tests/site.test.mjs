// The site as a whole: every script parses, every page asks for the current version of its files, every
// tile on the home page goes somewhere, and the data files the pages and checks read are valid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO } from './load.mjs';
import { stamp, pages } from '../stamp.mjs';

function files(dir, ext, out = []) {
  for (const f of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    const rel = dir ? dir + '/' + f.name : f.name;
    if (f.isDirectory()) { if (!/^(\.|node_modules$)/.test(f.name)) files(rel, ext, out); } else if (f.name.endsWith(ext)) out.push(rel);
  }
  return out;
}

test('every page asks for the current version of each script and stylesheet (if not: node .github/stamp.mjs)', () => {
  const { stale, missing } = stamp();
  assert.deepEqual(missing, [], 'pages point at files that are not there');
  assert.deepEqual(stale, [], 'out of date: run node .github/stamp.mjs');
});

test('every script on the site parses, the ones inside pages too', () => {
  for (const f of files('', '.js')) new vm.Script(fs.readFileSync(path.join(REPO, f), 'utf8'), { filename: f });
  for (const page of pages()) {
    const html = fs.readFileSync(path.join(REPO, page), 'utf8');
    [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m) => new vm.Script(m[1], { filename: page }));
  }
});

test('every tile on the home page goes to a page that exists', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(REPO, 'tools.js'), 'utf8') + '\nthis.list = TOOLS;', sandbox);
  assert.ok(sandbox.list.length > 0);
  for (const t of sandbox.list) {
    assert.ok(t.name && t.desc && t.url, 'a tile needs a name, desc and url: ' + JSON.stringify(t));
    if (!/^https?:\/\//.test(t.url)) assert.ok(fs.existsSync(path.join(REPO, t.url.split(/[?#]/)[0])), t.name + ' goes to ' + t.url + ", which isn't there");
  }
});

test('the data files are valid JSON, and the two lists the checks read are the right shape', () => {
  for (const f of files('tools', '.json')) JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
  const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
  // a new brief waiting in plan.next.json becomes plan.json on its start day, so it has to be right too
  const next = fs.existsSync(path.join(REPO, 'tools/shelf-check/data/plan.next.json')) ? [read('tools/shelf-check/data/plan.next.json')] : [];
  next.forEach((n) => assert.match(String(n.effective), /^\d{4}-\d\d-\d\d$/, 'plan.next.json needs its start day as "effective": "YYYY-MM-DD"'));
  for (const shelf of [read('tools/shelf-check/data/plan.json'), ...next]) {
    assert.ok(shelf.bays.length > 0);
    for (const b of shelf.bays) assert.ok(b.name && Array.isArray(b.codes) && b.codes.length, 'every bay has a name and its codes: ' + b.name);
  }
  const counter = read('tools/counter-trial/data/plan.json');
  for (const l of counter.lines) assert.ok(/^[0-9A-Z]{5}$/.test(l.code) && l.shelf > 0, 'every ticket has a code and a printed price: ' + JSON.stringify(l));
});
