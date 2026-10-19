# Toolbox

Tools for Screwfix Area 20 stores, published with GitHub Pages at https://detailedfoil.github.io/Toolbox/.
Plain HTML, CSS and JavaScript with no build step: what's in the repo is what the site serves, a minute or
two after a push to `main`. The owner (detailedfoil) isn't a programmer and tests changes on a phone, so
explain changes in plain English and say what they'll see.

## Before you commit

1. Changed any `.js` or `.css` file? Run `node .github/stamp.mjs`. It sets the `?v=` on every page to a
   fingerprint of each file, so phones fetch the new copy and the Monday check and A25 pages show their
   "newer version" banner. Never type a `?v=` by hand. On a merge conflict in a `?v=` line, take either side
   and run the script again.
2. Run the tests: `cd .github && npm ci` (once per session), then `npm test` (about 15 seconds). They must
   all pass. If you changed behaviour on purpose, change the test that describes it, and add a test for any
   new awkward case (especially in the page reader, `lookup.js`).
3. Leave `[skip ci]` off commits that change code, so the tests and the price checks' smoke tests run on
   GitHub. It's fine on commits that only change data or wording.

## Where things are

- `index.html`, `app.js`, `tools.js`: the home page. `tools.js` is the list of tiles; to add a tool, copy
  `tools/example.html` and add one entry there.
- `auth.js`, `auth-data.js`: the sign-in screen (store code + cost code, stored hashed). A light lock only:
  the repo is public, so everything in it can be read on GitHub.
- `analytics.js`: GoatCounter visitor stats.
- `tools/<tool>.html` with its scripts in `tools/<tool>/`:
  - `price-tickets`: 90 x 75 mm tickets. `ticket-engine.js` makes the PDF. `lookup.js` is the Screwfix page
    reader shared by four pages (tickets, posters, Monday check, A25) and both GitHub checks.
  - `posters`: A4 posters. `poster-engine.js` (PDF), `photo.js` (product photos).
  - `shelf-check`: the Monday Price Check page. `sheet-engine.js` makes its PDFs. `data/plan.json` is the
    shop plan from the brief; a new brief can wait in `data/plan.next.json` until its `effective` date.
  - `counter-trial`: the A25 Behind counter trial page (it also uses `shelf-check/shelf-check.css`).
    `data/plan.json` is the ticket list with the printed prices.
  - `fuel`: Fuel Prices (Leighton Buzzard forecourts, LB1 only). `parse.js` reads PetrolPrices.co.uk's public
    Leighton Buzzard page (the government Fuel Finder feed; the government's own feed blocks GitHub's servers) and
    is shared by the page (which reads it live through jina on every open) and the hourly GitHub check.
  - `nps`, `suggestions`, `audit-quiz.html` (all in one file): separate tools that share nothing.
- `.github/workflows/shelf-check.yml` (Mondays) and `counter-trial.yml` (every night) run
  `.github/shelf-check/check.mjs` and `.github/counter-trial/check.mjs` on GitHub. Both read prices with the
  shared `.github/lib/price-check.mjs` and commit the results to `tools/<tool>/data/prices.json`.
  A push to `main` that changes the reading code makes each run a five line smoke test.
  `.github/workflows/fuel.yml` runs `.github/fuel/check.mjs` hourly (about 6am to 10pm UK) and commits
  `tools/fuel/data/prices.json` when a price changes or the saved copy is 3 hours old.
- `.github/tests/`: the tests. The checks are run against a pretend jina and Screwfix
  (`mock-screwfix.mjs`, with the made-up products in `scenarios.mjs`), so the tests never touch the real sites.

## Things that are easy to break

- **Files written by robots.** `tools/shelf-check/data/prices.json`, `phone.json` and
  `tools/counter-trial/data/prices.json`, `ticks.json` and `tools/fuel/data/prices.json` are written by the GitHub checks, or by the pages
  through the GitHub API with a token saved on a phone. Don't edit them by hand, and pull before you push:
  the checks commit to `main` most nights.
- **The page reader** (`tools/price-tickets/lookup.js`) is behind every price on the site. Bump `VERSION`
  inside it when you change it (error reports show it). jina rules, learned the hard way: read the text
  first and only then ask for the whole page (`X-Return-Format: html`); never send `X-No-Cache`; jina allows
  20 requests a minute without a key.
- **The PDF engines** `ticket-engine.js` and `poster-engine.js` are exact ports of the original artwork
  scripts: don't restyle them (see the note at the top of each). Each engine has its own small PDF writer
  on purpose, so a change for one can't move another.
- **Copies that must stay in step.** These pairs share code by copy, not by a shared file. When you fix one,
  check the other has the same fix:
  - `tools/shelf-check/app.js` and `tools/counter-trial/app.js`: the device check (relays left out after
    failing, keeping the screen awake), the error report (`attemptLine`, `connTest`, `copyText`,
    `reportSheet`) and `checkVersion`.
  - `tools/price-tickets/app.js` and `tools/posters/app.js`: the code / price / name rows, status messages,
    the lookup queue, making and sharing the PDFs, and the toast.

## Trying a page

Serve the folder (`python3 -m http.server 8000`) and open `http://localhost:8000/tools/...`. To skip the
sign-in screen, run `localStorage.setItem('toolbox.signedIn.area20', 'LB1')` in the browser console first.
