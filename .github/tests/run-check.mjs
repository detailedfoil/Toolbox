// Runs one of the GitHub price checks (.github/<check>/check.mjs) the way its workflow does, but in a
// scratch folder holding only the files it reads, against the pretend site (mock-screwfix.mjs).
// -> {code (exit code), stdout, stderr, files: {path: text} (the data files afterwards), summary, commit}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO } from './load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function walk(dir, base = dir, out = {}) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, base, out); else out[path.relative(base, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
  }
  return out;
}

/* files: {'tools/shelf-check/data/plan.json': {...}, ...}; event: 'push' | 'schedule' | undefined (by hand);
   changed: the files a push event says it changed */
export async function runCheck({ check, files, mode, event, changed, mock, repo = REPO, env: extra = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-' + check + '-'));
  const put = (f, v) => {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v, null, 1) + '\n');
  };
  try {
    put('tools/price-tickets/lookup.js', fs.readFileSync(path.join(repo, 'tools/price-tickets/lookup.js'), 'utf8'));
    for (const [f, v] of Object.entries(files)) put(f, v);
    const temp = path.join(dir, 'runner-temp');
    fs.mkdirSync(temp);
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, MOCK_PORT: String(mock.port), JINA_URL: `http://127.0.0.1:${mock.port}/`,
                  GAP_MS: '10', RUNNER_TEMP: temp, GITHUB_STEP_SUMMARY: path.join(temp, 'summary.md') };
    Object.assign(env, extra);
    if (mode) env.MODE = mode;
    if (event) env.GITHUB_EVENT_NAME = event;
    if (changed) { put('event.json', { commits: [{ added: [], modified: changed }] }); env.GITHUB_EVENT_PATH = path.join(dir, 'event.json'); }
    const out = await new Promise((ok) => {
      const p = spawn(process.execPath, ['--import', pathToFileURL(path.join(HERE, 'preload.mjs')).href, path.join(repo, '.github', check, 'check.mjs')], { cwd: dir, env });
      let stdout = '', stderr = '';
      p.stdout.on('data', (d) => { stdout += d; });
      p.stderr.on('data', (d) => { stderr += d; });
      p.on('close', (code) => ok({ code, stdout, stderr }));
    });
    const left = walk(temp);
    out.summary = left['summary.md'] || '';
    out.commit = Object.keys(left).filter((f) => f.endsWith('-commit.txt')).map((f) => left[f]).join('');
    out.files = walk(path.join(dir, 'tools'), dir);
    delete out.files['tools/price-tickets/lookup.js'];
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
