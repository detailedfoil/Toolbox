// Sets the ?v= on every script and stylesheet the pages load to a fingerprint of that file's contents.
// A phone that saved an older copy of a file then fetches the new one, every page that loads a shared file
// (lookup.js is on four pages) asks for the same version, and the Monday check and A25 pages can tell when the
// site has a newer version than the one open (see checkVersion in their app.js).
//
//   node .github/stamp.mjs           after changing any .js or .css file: updates the pages
//   node .github/stamp.mjs --check   only lists what's out of date (the tests run this)
//
// Only files on this site are stamped; links to other sites, fonts and the manifest are left alone.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET = /(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"?#:]+\.(?:js|css))(?:\?v=([^"]*))?"/g;

export function pages() {
  return ['index.html', ...fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => f.endsWith('.html')).sort().map((f) => 'tools/' + f)];
}

/* -> {stale: ['tools/x.html: price-tickets/lookup.js', ...], missing: [...]}; write: true also updates the pages */
export function stamp({ write = false } = {}) {
  const prints = {}, stale = [], missing = [];
  const printOf = (file) => prints[file] || (prints[file] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10));
  for (const page of pages()) {
    const full = path.join(ROOT, page), html = fs.readFileSync(full, 'utf8');
    const out = html.replace(ASSET, (all, head, ref, v) => {
      const file = path.join(path.dirname(full), ref);
      if (!fs.existsSync(file)) { missing.push(`${page}: ${ref}`); return all; }
      if (v !== printOf(file)) stale.push(`${page}: ${ref}`);
      return `${head}${ref}?v=${printOf(file)}"`;
    });
    if (write && out !== html) fs.writeFileSync(full, out);
  }
  return { stale, missing };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes('--check');
  const { stale, missing } = stamp({ write: !check });
  missing.forEach((m) => console.log('Missing file: ' + m));
  if (check) {
    stale.forEach((s) => console.log('Out of date: ' + s));
    if (stale.length) console.log('Run: node .github/stamp.mjs');
  } else {
    console.log(stale.length ? 'Stamped ' + stale.length + ':\n  ' + stale.join('\n  ') : 'Every page is up to date.');
  }
  process.exit(missing.length || (check && stale.length) ? 1 : 0);
}
