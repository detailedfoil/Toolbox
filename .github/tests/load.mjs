// Loading the site's own scripts into Node for the tests, the same files the pages use.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* tools/price-tickets/lookup.js in a pretend browser page -> window.ScrewfixLookup */
export function loadLookup() {
  const dom = new JSDOM('<!doctype html><title>tests</title>', { url: 'https://detailedfoil.github.io/Toolbox/', runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync(path.join(REPO, 'tools/price-tickets/lookup.js'), 'utf8'));
  return dom.window.ScrewfixLookup;
}

/* a script that hands over what it makes through module.exports when there is one (the PDF engines and
   their font data do), run with the browser bits the PDF engines use */
export function loadModule(file) {
  const sandbox = { module: { exports: {} }, console, Blob, Response, CompressionStream, TextEncoder };
  vm.runInNewContext(fs.readFileSync(path.join(REPO, file), 'utf8'), sandbox, { filename: file });
  return sandbox.module.exports;
}

export const readBytes = (file) => fs.readFileSync(path.join(REPO, file));
