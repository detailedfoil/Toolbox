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
2. Run the tests: `cd .github && npm ci` (once per session), then `npm test` (about two minutes). They must
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
  - `fuel`: Fuel Prices, every Area 20 store (a big "Closest to me" button uses the phone's location as `lat,lng` to 3 decimals in the same map URL, or pick your store; forecourts within 5 miles). `parse.js` holds the
    store list and reads PetrolPrices.co.uk's fuel map (`map.php`, the government Fuel Finder feed) as jina renders
    it (needs `X-Timeout`, or the list hasn't filled in). The government's own feed blocks GitHub's servers. Shared by
    the page (live on every open) and the Leighton Buzzard backup on GitHub. `data/hidden.json` lists forecourts to
    leave out for everyone (closed, say): each is hidden until it reports a price dated after its `hiddenOn`.
    The "went down 2.0p by ..." history lines under each forecourt were removed on 26 Oct 2026 (detailedfoil: "just want the
    cost"); `merge()` still keeps `prev` / `prevSince` for the GitHub backup, they're just not shown. A strip under the
    Petrol/Diesel switch compares the listed forecourts' plain average with the UK average for that fuel: the government's
    WEEKLY figure (not live) from petrolprices.co.uk/fuel-price-index.php through jina, read by `parseAverage` in `parse.js`
    (tested on the real page, `fixtures/fuel-average.txt`), once per page open and again on Check again only if the saved
    one (`fu-avg-v1`) is over 6 hours old. It loads alongside the forecourts and stays hidden if it can't be read.
    The big green card is number 1 (a "1" badge, its distance, one forecourt) and the list under it starts at 2; a later
    row at the same price says "Same price". The footer text was taken off on 28 Oct 2026 (detailedfoil's say), leaving Check again and one tiny credit line
    (Fuel Finder via PetrolPrices.co.uk, OGL v3.0: the licence asks for it).
  - `till-count`: Photo Coin Counter (was Till Count), every store. Notes take a value; coins take a value, a number of coins or a photo
    of a pile of one coin (whichever was changed last wins). A £50 or £75 float (remembered per phone) comes off
    the total. Counts last while the page is open (sessionStorage) and photos only in memory: nothing is sent
    anywhere. `coins.js` is the coin reader, no libraries: edge points vote for circle middles (a first pass at
    any size finds one coin's size, a second finds every coin of about that size), each checked by how much of
    its rim shows. Allows for photos taken at a slight angle; amber = counted but worth a look. `money.js` does
    the sums in whole pence. Tested on two real photos (`.github/tests/fixtures/coins-*.jpg`, 50 10p and 48 20p,
    receipt blurred): any change to `coins.js` must keep those exact. Edges come from lightness and colour (red minus
    blue, `CHROMA`), added 22 Oct 2026: on wood it found 71% of coins before, 99% after. Also tested on four made-up piles
    of one coin (`coins-pile-*.jpg`, from `.github/till-count/make-piles.py` with `PILES=1`, some on `wood.jpg`, bare
    wood cut from a real phone photo).
    A line under the photo tip says nothing is uploaded and counts clear when the page closes (detailedfoil, 26 Oct 2026).
  - Photo Coin Counter 2 (mixed coins, `coin-counter-2`) was a test, built and removed 22 Oct 2026 at detailedfoil's say.
  - Photo Coin Counter's **Z report tab** (`till-count.html#z-report`; built 26 Oct 2026 as its own tool and moved into this
    page the same evening, detailedfoil: "I wanted that z report calculator inside the coin counter app"). Two tabs at the
    top, Till count and Z report (the last used opens, `tc-tab` in sessionStorage). A photo of the card machine's Z report
    gives the OVERALL END OF DAY TOTAL row's Total minus the Worldline TradeUK row's Total (detailedfoil: the bottom circled
    number minus the upper one). Either can be typed instead (typing wins). The two numbers last while the page is open
    (sessionStorage `zr-state-v1`), the photo only in memory; a line under the photo buttons says nothing is uploaded or
    saved (detailedfoil asked). Everything on the tab has an id starting `zr-` and its buttons `data-zr`, so nothing clashes
    with the till count's ids and `data-act` buttons. `zreport-app.js` is the tab (and the tab switch), `zreport.js` reads
    the receipt with no libraries: Tesseract was tried and can't read this
    printer's slashed zeros (0.00 came out as U.UU, and other digits misread). Ink is judged against the paper around it; characters
    are blobs (pieces of one joined up, digits that print joined split by the fixed character width); money is digits, an
    empty cell, two digits (the full stop prints too faint to rely on; a faint digit is found from the darkness in its cell);
    rows are matched to the four 10-character columns (the Total column line goes through rows showing all four numbers) and
    named from the bottom by their gaps (the two end of day rows each sit twice a card row's gap below the row above); a
    tilt over 3 degrees is straightened first. Each digit is compared, at 9 small shifts, with the printer's own digits
    (`FONT` in zreport.js, one 10 x 16 shape per digit, made by `.github/z-report/train.mjs` from photos of real Z reports, kept off GitHub;
    the test photos and `FAKE` in make-fixture.mjs can train it too). Checks: Sale + Cashback - Refund = Total on each row,
    and the overall total against the current one; when a row doesn't add up and changing exactly one unsure digit to its
    runner-up fixes it, that's used. Green = checked, amber = compare with the receipt. The page turns a photo that gives no
    numbers (sideways, upside down) and reads it again. Tests: `.github/tests/z-report.test.mjs` on `fixtures/zreport-*.jpg`,
    real photos with every amount changed and the heading blurred by `.github/z-report/make-fixture.mjs` (made-up receipt:
    712.32 overall, 27.06 TradeUK): any change to zreport.js must keep those exact. Change GX/GY or the sampling and the
    shapes must be made again with train.mjs. Untested so far: totals of 1,000 or more (a comma is allowed for, but no
    receipt with one has been seen) and a negative total (a minus sign is looked for).
  - `product-search`: Product Search, every store (the "Under construction" tile badge and page banner were removed on 21 Oct 2026,
    detailedfoil's say; `badge` on a tile still works). A parody "CrashFix" look on this page only (colours from screenshots of the real site). `search.js` is the search: no network, an index
    in memory, typo tolerant; add a test in `.github/tests/product-search.test.mjs` for any search that should work.
    `photos.js` keeps the product list on the phone (IndexedDB) and shows photos: the kept copy only if there is one (Screwfix's image server isn't asked), else media.screwfix.com (120 px).
    `data/products.json` is made from detailedfoil's stock export by `.github/product-search/make-list.py` (code, name
    and the warning flags only: no stock or locations, the repo is public; flag 16 is the export's "Age Restricted"
    column, added 22 Oct 2026). The "Age restricted" badge and search go by that stock list flag (detailedfoil, 23 Oct
    2026): the check's old `a` from screwfix.com was catching promotional red boxes (28 Stanley tape measures, toolboxes and
    the like). The one exception: flag 32 (`--add` sets it on products the latest export doesn't have, 661 on 23 Oct, among
    them knives) lets the page use the check's `a` for those only, and only when `an` (the notice's words) is there. It reads the workbook or the report
    pasted as text; for a newer export he wants `--add` (keeps every product already there as it is, adds new codes only,
    and adds the age mark to any the export marks age restricted, never taking it off). `data/web-names.json` holds the
    screwfix.com names and `photos/<CODE>.jpg` the 120 px photos (JPEG quality 85, about 2 KB each; `PHOTO_PX` and `PHOTO_QUALITY` in check.mjs), both written by the nightly check (`a: 1` on a
    product in `web-names.json` means Screwfix's own Challenge 25 notice sits under the product heading (`ageNotice` in
    `describe.mjs`; a product the stock list marks age restricted but read with no notice is read again a day later, as 121EH's notice came after the first read; not `lookup.js`'s whole-page check, which caught promo boxes; `an` holds the notice's words); the page
    uses it only for flag 32 products (see above), otherwise it's a cross-check; `p: 1` means its photo is saved; `d: 1` means `descriptions/<CODE>.json` holds its
    description, `{t, b}` = paragraph text and feature bullets, read from the same page by `.github/product-search/describe.mjs`,
    tested on real pages saved in `.github/tests/fixtures/page-*.txt`; the page loads it only when a result is tapped). `data/desc-words.json` (also robot-written) holds each
    description's search words, minus words already in its names, filler and bare numbers; the page loads it after the
    list and `search.js` uses it as a lower tier: codes, then names (title and alternative name), then description
    matches ("Found in the description"), then close spellings.
    Stock levels (detailedfoil, 25 Oct 2026): "Paste stock" takes the stock system's SKU List report (Nailed = YES, Print
    Preview, Ctrl+A, Ctrl+C: PC only, the page says so; the steps and `stock-help.png` are in the paste box), read by `stock.js` (headings found by
    name, so a different column choice works; tested in product-search.test.mjs with made-up rows). Each result shows only
    the Available Qty (he doesn't want locations; only that column, the name and age are kept), and an "In stock only"
    switch hides results with none available. Kept in sessionStorage
    (`ps-stock`) for that tab only and never sent or committed: stock is store-specific and the repo is
    public. Pasted products not in the list are searchable for the visit, by their stock system name.
    Working with no signal (detailedfoil, 26 Oct 2026): `tools/product-search-sw.js` is a service worker registered by
    app.js with scope "product-search", so it only looks after this page and its files (never the other tools). It keeps
    every Toolbox file the page fetches (page, code and lists site-first with a 4 s fallback to the kept copy; photos
    and descriptions kept-first); never anything from another site. Settings has one "Download names" button (detailedfoil, 26 Oct 2026: "just names are ok"; descriptions
    and images were offered as separate downloads for a few hours, then taken out): it puts the page, its code and `products.json`
    (SKU code + ILS name) into the same cache (`product-search-v1`), about 1 MB, a moment; when it was saved is in `ps-saved2`.
    "Save again" fetches every file fresh first (header `X-PS-Save`, which the service worker lets straight through to the
    site), and only when all have come back deletes the whole cache and puts the new copy in (detailedfoil, 28 Oct 2026); a
    failed fetch leaves the old copy. The "Don't load photos" switch was taken off on 28 Oct 2026, and "Paste stock" is now
    labelled "Upload stock" (same paste box).
    Offline, photos show their placeholder and descriptions / description search don't work. Saved files are checked one at a time
    (`cache.match`): listing 20,000 with `cache.keys()` can fail in Chrome. The page has to be opened once with signal.
    Grouping sizes of the same product into one result with a size switcher (buttons or a drop-down) was built and
    removed on 22 Oct 2026 at detailedfoil's say (he didn't like it): every size is its own result.
  - `area-map`: Area Map, every store (all 986, UK, Ireland and the Isle of Man) on a Leaflet map (vendored in
    `area-map/leaflet/`, OpenStreetMap tiles, greyed; a button turns them off). `data/stores.json` holds each store's
    name, address, postcode, area, country and location ONLY: detailedfoil asked for no names of people, numbers, store
    codes or anything else (the repo is public; a test checks the keys). `approx: 1` = pin placed from the postcode area
    (or, in Ireland, by hand from the address), not the exact postcode. `data/areas.json` is made by
    `.github/area-map/make-areas.mjs` (run it after any change to stores.json; a test fails until you do): every place
    goes to its nearest store's area (worked out separately on Great Britain, the island of Ireland and the Isle of
    Man), clipped to Natural Earth's coastline (`.github/area-map/land.json`), coloured so neighbours never share a
    colour or two that look alike (`ALIKE`, checked for colour blindness). `geo.js` is the search and the sums (tested
    in `.github/tests/area-map.test.mjs`). A town or postcode that isn't a store is looked up on postcodes.io (UK only).
    "My store" and the street map setting stay on the phone.
  - `nps`: the NPS figures were taken off the public site on 22 Oct 2026. Anyone now loads them on the page for that
    visit only (sessionStorage, gone when the tab closes; never committed). Three ways in: the survey export (one row per
    customer, Store + LTR columns: 9-10 promoter, 7-8 passive, 0-6 detractor, blank LTR left out; `parseResponses`, checked
    against the dashboard summary on 27 Oct 2026, all 22 stores exact), the old dated workbook (Store Breakdown sheet), or
    figures pasted as text (`parseText`, still in engine.js and tested, but the paste box was taken off the page on
    27 Oct 2026, detailedfoil's say). The load box always shows "How to get the file" steps with his two screenshots of the
    dashboard's Data Export tab and export window (`nps/how/*.png`, added at his request knowing the repo is public). `STORES` in `engine.js` maps the exports' names to "Name (CODE)" ("Dunstable
    Houghton Regis" = Houghton Regis, "Luton" = Bilton Way, "Luton LAP" = Windmill). The dashboard summary (responses and
    score only) can't give the split, so the page asks for the export instead. Tests: `.github/tests/nps.test.mjs`. The
    real exports hold customer comments and invoice numbers: never commit one. The YTD trends tab hides itself with no chart.
  - `suggestions`, `audit-quiz.html` (all in one file): separate tools that share nothing.
  - `floor-plan`: 3D Floor Plan, Dunstable (LB1) only: the tile has `only: ["LB1"]` and `app.js` shows "only for
    Dunstable" to any other sign-in (a light lock: the layout is readable on GitHub like everything else). Built
    29 Oct 2026 from photos of the store's fire plan and electrical layout: 19.6 x 21.2 m inside, positions good to
    about 30 cm, heights and shelf counts are typical guesses until detailedfoil measures them. three.js r186 is
    vendored as a plain script (`floor-plan/three/three.min.js`, global THREE; the esbuild command is at its top)
    because there's no build step and the tests parse every .js file as a classic script. `data/layout.json` is the
    store in metres (x from the left wall, y from the back wall towards the front): openings in the outside walls,
    columns, inside walls, rooms, rack runs (`edges` = bay boundaries, `open` = the side you pick from, `braced` = bays
    drawn with an X on the plans, `plan` = the electrical drawing's labels), objects (counters, tills, shop shelving,
    furniture), zones, lights and where the walk starts. `bays.js` turns the runs into bays with temporary names
    (row letter + bay number + b / f for the back / front of a back-to-back row: F3b, C2, L5); it's shared with
    `.github/tests/floor-plan.test.mjs` (no overlaps, names unique, the walk starts on clear floor, LB1 only). Views:
    3D (outside walls cut at 3.2 m), Top (flat, back wall at the top like the drawings) and Walk (full walls, roof
    and lights; a stick on touch screens, WASD or arrows on a PC, drag to look, tap the little map to jump). Tap a
    bay for its card; "Walk here" stands you in the aisle looking at it. Shadows are drawn once (nothing moves).
    `data/locations.json` (added 29 Oct 2026 from detailedfoil's descriptions) says which stock-system location each bay
    holds, as AREA-BAY codes (AAA-01 is the start of AAA-01-12-06): bay 1 is nearest the middle aisle, 6 at the right
    wall. Done so far: K (front BAA 1-6, back BAB 1-6), J (front AAA 1-2 / 3-4 / 5-6 / 7-8 / 9 / 10, back AAB 1-6),
    G (front BAC 1-2 then AAE 1-4, back BAD split like AAA: 1+2, 3+4, 5+6, 7+8, 9, 10), F (front BAF 1-6), E (E3f BAG 1, E4f BAG 2; E3b and E4b are the hazard cabinets, codes not given yet), H (front AAC 1-6, back AAD 1-6), F back BAE 1-6. The viewer shows the location on the tag and card (`attach` in bays.js); no stock goes in the repo.
    Left block A-D is "bulk" to the shop; its location numbers run from the middle aisle (so drawn bay 4 holds 1+2,
    3 holds 3+4 and so on), and B and C have stock on both sides. Done (30 Oct 2026): A (front BBG, back BBH), B
    (BBE front, BBF back), C (BBC, BBD), D (back BBB, front BBA 1-6 then LAC 3+4 on D1f), P (LAC 1+2), W (front only,
    BBJ 1-12 from the back right corner to the fire door at the back left), E1 BBI 1+2 / E2 BBI 3+4 with BBK on E2's back, E3b HAB and E4b HAA (hazard
    cabinets, area only), L1 LAB 1+2, L3 LAB 3+4, L5 LAA, L2 and L4 the holding area, V1 AAJ 1, V2 AAJ 2, Z1 BBG-09 and Z2 BBC-09 (kind `floor`: taped floor spots at the left-wall end of the BBG and BBC aisles, stock straight on the floor, in `notFree`). `ignore` (HAD, HAE, HAC, LAC-05, LAA-05, HAA-01, HAB-01) is detailedfoil's say; stock.js place() returns null for them. An ordinary shelf has as many cells as its furthest nailed position (boxes fill the shelf, 30 Oct), not the area's usual number. `unsure` marks guesses to confirm; area-only
    codes (no bay number) are fine in locations.json.
    Stock on the shelves (30 Oct 2026): the racking is 3.6 m tall (detailedfoil: the top shelf is about two people
    tall); shelf 10 of the AA_ areas is chin height (1.5 m, 15.3 cm apart for shelves 1 to 10), the shelves above them
    and every other aisle are spread evenly (`areas` in locations.json says how many shelves each area has). Shelves 1
    to 10 of AAA to AAE are cardboard drawers, 20 positions a shelf: a bay slice is about 12.7 cm per drawer wide, so a
    full width bay has 10 drawers of 2 (odd position = front, even = back) and a half width one (AAA 1-8) has 5 of 4.
    `stock.js` reads the pasted SKU List report (same report as Product Search; kept on that device in localStorage until "Clear stock" (detailedfoil asked for it to load by
    default, 30 Oct; it is NOT in the repo: the repo is public, so tests use made-up products) and works out where a location is (`index`, `place`,
    `cellRect`). The Stock button takes the paste; products on ordinary shelves become boxes, a tap on a drawer slides
    it out with what's in it, and the search jumps you to a product. Positions count from the LEFT as you face the
    shelf (confirmed by detailedfoil 30 Oct; `psign` in stock.js flips it). Mouse look: on a PC, in Walk, the first click
    captures the mouse like a game (Esc lets go); the "Mouse look" button (only shown with a mouse) turns it off for
    dragging instead. A paste that stops part way through a row (stock.js `cut`) is flagged, and "Add more" adds a second paste to the list. The report can also be uploaded as a text file ("Upload a file", or drop it on the panel; detailedfoil, 30 Oct: "as well as the paste"): the first list he pasted was cut at exactly 100,000 characters (1,129 products) by a copy or chat limit, the full file has 10,999. `areas` in locations.json (shelves and positions per area, `ignore` = HAD and HAE) came from the full file; HAC (11 products) has no bay yet.
    30 Oct 2026, "find locations with nothing nailed" + photos + polish: **Free spots** (`freeSpots` in stock.js, tested): a drawer shelf
    has a known number of positions, so every empty one is free; on ordinary shelves only gaps count (detailedfoil: 01 then 03 means 02 is
    free; nothing after a shelf's last product, as the list doesn't say how many labels it has); a whole shelf with nothing on it under one
    in use is free as a whole ("if the shelf is there": BAA 1-4 shelves 6-7 are like that). The Free spots button turns them green (drawers
    light green / green) and the Stock panel's Free spots tab lists them by area (chips, a filter that reads AAC, aac 3, AAC0312 or "AAA-01,
    AAA-02": `locQuery`), with "Most room first". The full list gives 1,512 free positions and 23 empty shelves. **Photos**: boxes near you
    in Walk (5 m, in view, facing you, 80 at most), the open drawer and the cards/lists show `product-search/photos/CODE.jpg`, the
    Toolbox's own copies (the Product Search ones), 4 at a time, about 260 kept; no saved copy = no photo, Screwfix's own server is never
    asked (a test checks app.js never names screwfix.com). No mipmaps on them: on swiftshader mipmapping 80 textures took 5 s a frame.
    Found from the full list and fixed: drawer shelves of AAC 5-6, AAD and AAE have 12 positions, not 20 (6 wider drawers: `drawerPositions`,
    and `bays` for one bay's settings, in locations.json); `positions` is now the shelves above the drawers (9-10), so their boxes no longer
    share slots; a bay number the plan doesn't have (BBC-09, BBG-09, LAC-05, LAA-05) is no longer put on the area's first bay; pallet
    racking stock sits on the drawn beams; cage shelves are at the stock heights. detailedfoil said E3b and E4b are the hazard cabinets
    (HAB, HAA) and E3f / E4f are BAG: layout.json had the cabinet on E4f, now E3b and E4b are cabinets (1.95 m, drawn with the doors open
    so the stock shows) and E4f is shelving. HAA, HAB and LAA have bays 1 and 2 in the list: drawn as the two halves of E4b, E3b and L5
    (marked unsure). Also: a pin over what you're looking for (seen through everything, and on the little map), shelf numbers on the bay
    you're looking at, a bay card says how many products and free positions it has with What's here / Free spots buttons, cards have the
    photo, Copy location and a Product Search link (`product-search.html#q=CODE`), products with no bay still turn up in the search, / opens
    the search and Esc closes, the card sits top right (bottom right in Walk) on a wide screen and across the top on a phone in Walk (the
    thing you're looking at is put lower down so the card doesn't hide it). Then (30 Oct 09:00): boxes fill their slots (pulled in 3.5 cm at each bay slice end so they never poke into the uprights), and location labels like the real ones: red (odd bay) / blue (even) on the shelf edge for ordinary shelves, white two-line labels on the drawer fronts with the back position on top; no barcodes (they made it laggy); drawn by the graphics chip from a font texture (see below). Colours: free spots green, every other box blue to pink by area (never green or red); "Sharps and liquids in red" is a switch in the Stock panel, off to start with (`fp-red-v1`; flag 8 in product-search/data/products.json, fetched only once it's on).
    Faster (30 Oct, detailedfoil: "make it more optimised", then "it's actually more laggy now ... a loading bar and it pre loads stuff"): a loading bar (`progress`, `breathe`) covers the start while the stock is placed, every location label is made and the shaders are compiled with one frame drawn (`warmUp`), so nothing is made while you walk. The labels (about 15,000 with the full list: every shelf-edge position and a line per drawer position) are ONE InstancedMesh built once (`buildLabels`, again when the list changes): each instance carries its 12-character location packed 4 to a float (6 bits each) and a style, and a ShaderMaterial draws the letters from a 512 x 256 font texture (`GLYPHS`, `glyphTex`), dropping labels over 6 m away in the vertex shader. Making labels as you walked (an atlas filled on the fly) was the lag: turning round redrew hundreds. Photos go straight into one 2048 px texture (256 slots, no mipmaps, one copy each) drawn as one InstancedMesh (`atlasMesh`). Walk is about 50 draws a frame (it was about 315). The page draws only when something changes and stops the frame loop when nothing does (`redraw()` / `wake()`, never set `dirty` by hand); a phone that keeps taking over 34 ms a frame while moving drops to fewer pixels. Cards start small (the main line and button, More / Less for the rest; `more` on a line or button) and no longer say "Bay X in my drawing" (detailedfoil: useless). `ignore` in locations.json now takes bays too: HAC, LAC-05 and LAA-05 are left off like HAD and HAE (detailedfoil, 30 Oct), and `notFree` lists shelves kept empty on purpose (BAA 1-4 shelves 6 and 7: "they are still there"), which never count as free spots. Next: whatever detailedfoil asks for (heights and shelf counts are still guesses).
  - `warehouse-shift`: Warehouse Shift, a picking game, Dunstable (LB1) only (tile `only: ["LB1"]`, and game.js shows "only for
    Dunstable" to any other sign-in). Built 19 Nov 2026 from detailedfoil's brief, replacing a first try (by another AI on 18 Nov)
    that was a `?shift=1` mode of the floor plan: that mode is gone from floor-plan/app.js, and `floor-plan.html?shift=1` now just
    redirects to `warehouse-shift.html` (old bookmarks and installs). A made-up warehouse (detailedfoil can't publish the real
    layout), "a bit bigger" than the real store: 21.9 x 24.25 m inside, 1.35 m pick aisles (real ~0.9), a 2.5 m centre aisle
    straight down the middle, racking 3.6 m. Right side, front to back: AAA (quad trays in half-width bays), AAB to AAE (double
    trays on the bottom 10 of 16 shelves, plain shelves above), then BAA to BAG (9 shelves of 9 small positions). Left side, back
    to front: BBA to BBJ (bulky: 5 long-span levels, 3 big positions on the bottom one, 4 above). Every pick aisle has stock on
    both sides (back-to-back rows; one-sided rows at the ends have a steel back). Location order = walking order: up the right,
    back down the left (detailedfoil's rule); the first area of each aisle is on your right as you walk in from the centre aisle.
    Numbering copied from the floor plan: AREA-BAY-SHELF-POSITION, bay 1 at the centre aisle end, shelf 1 the bottom, positions
    from the left as you face the shelf, trays front then back (4 deep in AAA). The shop floor (trade counter, tills, gondolas,
    Trade+) is the floor plan's, moved so Trade+ sits in the front right corner ("not completely in the middle"); staff room and
    toilets keep their place; the office moved beside goods in. detailedfoil: NOTHING FLOATS. Every label is fixed to something:
    location labels on shelf edges (red odd bay / blue even, location over a barcode drawn in the shader) and tray fronts (white,
    a line per position, back on top); the area names on signs on the END of each row facing the centre aisle (with BAYS 01-07 and
    an arrow to its aisle); fire exit / goods in / trade counter signs flat on walls. No sprites (a test checks).
    Files: `world.js` (the layout, every location, putting products on them, orders, `locationAt` for scans; shared with
    `.github/tests/warehouse-shift.test.mjs`), `day.js` (the day's pick list, customers and holding area, see below),
    `scene.js` (three.js drawing: racking, trays, product boxes in their photo's colour, the label shader, photo atlas, shop
    floor, props, customers, tote, Sam and their trolley, the tills' screens), `game.js` (the shared world: customers walking
    about, totes over the counter, Sam's part in it, sounds; and `makePlayer`: each player's own camera, controls, scanner and
    till, so a second player can be added), `game.css`, `data/catalogue.json` (made by `.github/warehouse-shift/make-catalogue.py` from product-search's
    products.json: every product without flag 32 = the 10,999 nailed ones, each with a group, a size T tray / S shelf / B bulky
    from name keywords, its photo's colour and whether it has a photo; rerun it after a new products.json). The same seed puts
    every product in the same place on every phone (learnable); ~17% of places are left empty. Photos: the Toolbox's own
    product-search/photos (never Screwfix), loaded 12 at a time for boxes within 14 m that you can see, into a 4096 px texture
    (1,000 at once; 2048 / 250 if the phone can't); detailedfoil asked for more loaded than the floor plan. Labels drawn to 18 m.
    Play: the scanner is drawn like the Symbol handsets in his photos. **The pick list** (detailedfoil, 19 Nov 2026, from his
    photo): Today Picking, ORDER underlined, a `>` in a light box by the chosen order, Select_ at the bottom; up and down (the
    big arrows, << >>, the arrow keys, or tap a row) choose, Enter starts it. Each order reads `A4821 2:3 CK`: A and four
    numbers, then locations:items (1 silicone and 2 screws = 2:3), then CK (a click and collect customer is here now), c (no
    customer: it goes in the holding area) or nothing (bought at the till). An order comes off everyone's list once started,
    and there's no backing out: Back says "Finish task" (it only puts the last scanned item back). Picking (Pick To
    Tote/Trolley, location, SKU, name cut at 20 characters, Qty; the blue `<F4> Hint` bar, not Stock Problem, makes the
    location and its row-end sign glow for 12 s): look at the label or tray and Scan (or tap it on a phone; within 2.05 m), a
    tray slides out, and each scan is one item (no typing, as many scans as the Qty; Back puts one back); when they're all
    scanned it says Press Enter, and Enter moves on to the next location (detailedfoil: you press Enter after each location;
    a scan past the Qty is refused). Below 0.45 m you must squat (button, or C). Then a customer's tote goes to the counter
    (Enter inside `world.handover`): it goes on the counter at the nearest free place, its customer comes over from where
    they're waiting, it slides across and they walk out with it. A c pick goes in the holding area instead: scan the label
    of any empty OC spot (a full one says so). No score or timer (his say); the Function menu has squat, hint, sound, look
    speed, picks (mixed / C&C / holding / till / kiosk, for practice: changes the picks still to come) and help; "Perfect
    pick!" when an order needs no hint and has no wrong scan. Landscape first
    (detailedfoil), a rotate prompt on phones held upright with "Play upright anyway". Phone: left-thumb stick (pushed right out =
    jog), drag to look, tap to scan. PC: WASD, mouse look (pointer lock), F/click scan, C squat, H hint, Tab menu.
    **Controllers** (Gamepad API, standard layout; detailedfoil, 19 Nov 2026): left stick walks (right out to jog), right
    stick looks, RT scans, A is Enter (his swap), B Back, X squat, Y hint, d-pad up and down the pick list, Start the
    Function menu (highlighted), View help, LT held jogs; A also starts the shift and the end screens. At the till a yellow
    highlight moves between buttons, boxes and rows (tillui.js `pad()`): A presses, a box brings up the on-screen keyboard
    (the highlight moves round its keys), B deletes or leaves, RT Enter, LB/RB tabs, Y Ask again, Start leaves.
    **Two players** (computers only: the Start screen's Two players button, hidden on touch screens and windows under 900
    px): split screen, one above the other, sharing the day's list, Sam and the tills. Each joins on the join screen with
    a press (A on a controller, or a key or click for the keyboard and mouse; first to join is the top half). Each player's
    things are in their own container (`#pv1` in the page, copied for player 2 by `addPlayer2`, elements found by
    `data-el`); `makePlayer` holds everything per player; `drawViews` draws each half with its own glow and aim box;
    keyboard and mouse go to `kbPlayer()`. Two people can share an aisle; they can't walk through each other (`peerStop`)
    or open the same till (`tillAt`). Tested with two fake controllers in headless Chrome; not yet on real ones.
    Installable: `warehouse-shift.webmanifest` (fullscreen, landscape) and `warehouse-shift-sw.js` (scope "warehouse-shift":
    page site-first with a 4 s fallback, its files and photos kept-first; a copy still registered at the old floor-plan scope
    removes itself). Stats (orders, lines, units) stay on the device (`ws-stats-v1`).
    **The day** (`day.js`, detailedfoil, 19 Nov 2026; tested in `.github/tests/warehouse-shift-day.test.mjs` with whole days
    simulated): 20 picks of any kind, the first 2 to 4 of them c picks on the list as the day starts. The rest are a mix of
    c (online orders), CK (a click and collect customer walks in and their order isn't picked yet) and till and kiosk
    customers (never three of a kind in a row). The list stays steady: at most 5 at once (counting customers on their way in
    who'll add one, and till customers not yet paid), the next one after a wait that's shorter the emptier it is (4 to 9 s
    when empty, up to about a minute when 4 are on it). At most 3 customers in at once, and a third only after a while (it
    was at 3 two thirds of the time before). Some online orders' customers come in later the same day (`owners`): if their c
    is still on the list it turns into a CK (if someone's picking it, their scanner says to take it to the counter instead),
    if it's in the holding area a CK line fetches it. Other customers come for bags already there (`collect`). A fetch line
    is `A` + the despatch note's 4 digits, 1:1 CK, and isn't one of the 20. The day ends when all 20 are done and nobody's
    waiting: "All picks clear" with your own figures only (nothing about Sam's), and Start the next day (the holding area
    carries over). Till customers wait at the counter (a till's place, never Sam's) until someone serves them; once paid
    they, and every click and collect customer, wait by the gap at the end of the counter beside Sam's till (detailedfoil:
    the left-hand till from behind the counter, the only end with a gap), `WAIT` in game.js.
    **Holding area** (`world.holding`, drawn by scene.js `holdingArea`; what's in each spot is `day.hold`): long-span shelving (blue uprights, orange beams,
    like the real one in his floor plan) against the staff room wall beside goods in, facing goods in, a "HOLDING AREA"
    sign over it. On your left as you face it the big items bay: OC-001 on the floor, OC-002 on the shelf above (loose
    cartons, the OC labels on the shelf edge); on your right blue totes, six a shelf on the bottom two shelves, OC-003 to
    OC-008 at the bottom and OC-009 to OC-014 above, from the left, each with a big green OC label on its front and an
    order in a yellow bag. The shelves above stay empty. Each order has a despatch note drawn on a canvas (CrashFix, a
    4-digit number and the surname big, Collection No., Despatch Note A9...; no highlighting or Challenge 25 line, the
    top strip left blank: his say). Every surname there is different (for now). A collection's line on the scanner gives
    the OC location and surname (the customer says them too, `Till.holdSay`); scan that tote (Scan or tap, `holdHit`), the
    bag comes out, take it to the counter and Enter. A wrong tote counts against a perfect pick. Hint glows the tote (or,
    putting a c pick away, the nearest empty spot). About half the spots start the first day full.
    **Till orders**: A till customer walks up and the scanner says "Till
    order"; walk behind the counter to one of the four trade counter tills and press Use till (or Scan, or tap the till).
    Walk behind the counter to one of your three tills (the one by the gap is Sam's) and press Use till (or Scan, or tap
    it): the next till customer comes over (the one you're talking to follows you to another till; one you'd called but
    not started on goes back to the queue if you leave). The till is a browser with two tabs at the top, like the real
    trade counter PCs: **Fusion** (the till system, drawn
    from his photos: Identify Customer, Search Results, Customer Order, the white Checkout page, Order Complete; the logo
    is plain text, the username is Trainee01, no real addresses) and **CrashFix** (the Product Search page's own
    search.js over products.json, web-names.json and desc-words.json, built with the same fields as product-search/app.js
    via `till.js` `searchItems`; photos only from product-search/photos, descriptions on tap; when nothing has every
    typed word it leaves out words no product has, then tries without each word, and says which it left out). The
    customer gives their postcode, then their surname (made up: LU8 and LU9 don't exist, emails at example.com/net/org;
    sometimes someone else at the same address, then they say their first name); you Search, pick them, Select. Then
    they ask for one thing at a time: by code, by describing it (REMOVED 19 Nov 2026, it did not work; `till.js` no longer picks it, the data is still in requests.json) ("a pack of 100 ... screws 5mm x 80mm", from its
    screwfix.com name, half without the make) or by quoting a sentence of its description ("I need the one that says:
    ...", plus a hint like "The 30m one." when several products say the same). Find it on CrashFix and tap its code to
    copy it: that shows it to the customer, who says right or wrong straight away (detailedfoil; a wrong one counts against
    a perfect pick once). Then switch to Fusion (phones get a Paste key), type the part number and quantity, Enter; any
    product that fits counts. A wrong quantity lights that line's Qty box up, selected, so typing the right number and
    Enter fixes it (typing the same part number again does too: no second line). A right product is never "that's it"
    (detailedfoil: sounds like the end of the order). Ask again repeats it; twice gives
    a clue (the first 3 characters of the code), which counts against a perfect pick like wrong lines do. Pay & Go,
    then Card or Cash, whichever the customer says when you reach the checkout (`Till.payment`; the other button, or
    Trade Credit etc., gets "No, I said card." and counts against a perfect pick). Order Complete gives the order's number
    from the pick list (A and four numbers; customer numbers start 00, which a real one never does) and the order goes on
    everyone's list with no letter after it; the customer waits by the gap and the next one can be served. The order
    stays on that till's screen in 3D (Order Complete, the number, Customer waiting: scene.js `tillScreen`) until its tote
    goes over, and on Fusion's done page if you open that till with nobody to serve (detailedfoil: so you know which pick
    is for the till customer). Prices and stock
    (Avail) are made up from the code (`price`, `avail`), VAT is included at 20% like the real checkout. Speech shows in
    a bubble over the customer and in a yellow bar on the till. **Kiosk orders**: the same postcode, surname, Select;
    then the customer says they sent it from the kiosk / screen / iPad and the name they used (usually their first name,
    sometimes their surname). Fusion's Kiosk Orders button lists today's kiosk orders (`Till.makeKiosk`: 4 to 7, every
    name different, times, device, lines, total); pick theirs and Select: the basket fills itself, then pay as usual. A
    wrong one gets "That's not mine." (a slip); typing products in gets "I've already done it on the kiosk". Till search
    customers can open the list too (it's everyone else's). Phones use their own keyboard (the inputs ask for text or
    numbers, `kbMode`); the keyboard button in the till's tab bar swaps to the on-screen one (`ws-osk`, inputs then have
    `inputmode="none"`), and with the phone's keyboard a Paste button sits by Part No. once a code is copied. Taps that
    land after the page moved under the finger are ignored. Files: `till.js` (customers, the search, sums, orders, judging; shared with the tests and the
    generator), `tillui.js` (the screen), `till.css`, `data/requests.json` made by `.github/warehouse-shift/make-requests.mjs`
    (about 4 minutes; describe = [code, phrase, ...other codes that fit], need = [code, quote, hint, ...]; every request is
    checked to be findable with the real search, first 10 results, from a few of its rarest words). Rerun it after a new
    catalogue, and when `.github/tests/warehouse-shift-till.test.mjs` says a quote is no longer in a description. The
    offline worker keeps the till files too (Product Search's lists: kept copy at once, a fresh one for next time).
    Untested so far: on a real phone, and how players get on with the description quotes (detailedfoil expects to test a
    lot by hand).
    **Sam, a coworker** (detailedfoil, 19 Nov 2026: "an AI that does all this as well ... like a coworker ... they take
    as long to do everything as a human would"): a scripted worker, not an AI model; always on, one for now, nothing on
    screen counts their orders (his say). `bot.js` is the brain, shared with `.github/tests/warehouse-shift-alex.test.mjs`
    (whole shifts simulated with a pretend page): `Nav` (the floor on a 10 cm grid with each cell's distance to the
    nearest obstacle; A* that keeps to the middle of aisles, pulled straight) and `create()` (`update(dt, others)` each
    frame; the job is a generator whose steps wait seconds or for a condition). Sam comes out of the staff room at the
    start and works from the same list (`choose`, detailedfoil's order): a pick a customer is waiting for (CK, till, a
    holding area fetch), then the next customer at the till (served at their own till, the one by the gap, with the till's
    own customer lines; customers are never dressed in navy, the staff colour), then c picks; free again, they look at the
    list straight away. They pick from the same shelves (trays slide out, boxes pull forward) into the top tote of their
    **trolley** (detailedfoil: the blue stack of totes on a grey base with wheels; scene.js `makeTrolley`, `TROLLEY` in
    bot.js): pushed in front while they walk, parked behind them, across the aisle, while they pick, so Sam and the trolley
    fill the aisle and you can't get past (you can't walk through either: game.js `crewStop`, `trolleyGap`; it swings round
    them the short way, never into the shelf, and stays inside the aisle). They kneel on one knee for the bottom shelves
    (below 0.45 m), hand the top tote over at their till (the customer comes over), and put c picks in the nearest empty
    OC spot (a tote rather than the big items bay), going to the counter instead if the customer walks in meanwhile. Timings are `PACE` in bot.js (walk 1.32 m/s, find a product by code 3.5-7 s, by
    description 8-18 s, by a quote 12-28 s, each item 0.6-1.2 s ...), each varying, times a personal pace; about one
    thing in 15 goes wrong just to slow it down (`SLIP`: a wrong scan, the wrong aisle, a typo, the wrong product shown,
    one too many picked). **Aisles** (the ones off the centre aisle, `aisleAt` in bot.js): Sam waits to one side of the
    end of one you're already in (`startQueue`, detailedfoil: "whoever was in the aisle first gets priority"), where you can
    see them from inside, so they never trap you. Two human players can share an aisle (detailedfoil); what stops you
    passing Sam is the trolley, not a rule. In the open Sam goes round you, slides past at close quarters,
    takes another spot if you're on theirs (`alts`) and says excuse me after a moment. The holding area is shared through
    day.js (`busy`: a spot being fetched from or filled is kept for whoever's on the way). Drawn by scene.js `makeWorker` /
    `poseWorker` (navy uniform with a CrashFix patch and an ALEX badge, knees and elbows, both hands on the trolley handle
    while walking, the scanner's red line), speech in small grey bubbles only when near and in sight (`placeBubs`, drawn
    by each player), sounds quieter with distance. `__shift.tick(sec)` fast-forwards the game for playtests.

    **20 Nov 2026 (detailedfoil)**: a red **Service bell** on the shop side of the counter front (`world.bell`, drawn in scene.js; Ring bell button or Scan while looking at it): Sam serves that ONE waiting till customer (`bellCust` / `bellQueue()` in game.js feeds Sam's board; an un-greeted customer is greeted first); he still never serves otherwise. Till, Greet, Lock door and Ring bell now only work on what's in the middle of your view (`aimAt` / `checkTill` in game.js, with a yellow outline: the shared `aimBox`); while a till is open the choice is frozen. Waiting customers hold a receipt (`parts.receipt`, `holdR`). Before opening, a morning pick Sam has already started no longer holds the doors shut (`left` in `Day.check`). Kiosk Orders has no Sent from column. Space = Enter on the keyboard (scan is F or click). Sam takes a pick after 5 s (`LATE_PICK`). Customers no longer describe products by name. A new customer at a till starts with an empty basket.
    **Round 2 (19 Nov 2026, evening; detailedfoil: Alex renamed Sam and given an afro, `afro: true` in the `hire` call).** A day
    is now 15 to 25 picks (about 20). Before opening 3 to 6 c picks (two or more products, no customer, as many as the
    holding area has room for) are on the list; when they're all put away a "Time to open" banner appears and the shop opens by
    itself ("Doors open"; detailedfoil asked for no unlocking); customers only arrive after that, and when
    everything's done "Lock the front door" shows and only you locking it (a Lock door button by the entrance, also Scan / RT) brings the end of day screen (`day.phase`: closed, open, lock, done; `open()`, `lock()`, env `unlocked/closing/locked`). Function menu 7 removes Sam or brings Sam back (`ws-sam` = off in localStorage; `day.release('Sam')` puts what Sam had back on the list). The rest: about 40% (35 to 45) till or
    kiosk orders, the others click and collect customers with ONE product (picked from the warehouse, any quantity) or bag
    collections (several products, from the holding area, no warehouse walk, bags may be there from before opening; they count as
    picks and the label shows the bag's real locs:items). Customers are greeted before they say anything: they arrive in state
    `greet`, you press Greet (the Use till button changes, or Scan / RT) while behind the counter near them, or Sam does it after
    about 10 s (`day.greet(c, who)`, `ungreeted()`); Sam NEVER serves a till customer (detailedfoil, 19 Nov 2026: so the till is yours) and only takes a pick that has sat on the list 5 s (it was 15 s) (`listLate()`, `LATE_PICK`). The owner/late-customer idea was removed. At the till LT and RT switch tabs
    (LT Fusion, RT CrashFix), LB is Enter. The left side is now BBA at the FRONT to BBJ at the back; pick lists walk AAA to BAG, then
    BBJ down to BBA (`WALK` in world.js; `loc.order` follows it, don't sort by code). The two halves of a shared AAA bay have a
    12 cm gap (`HALFGAP`). The trolley has no handle.
- `.github/workflows/shelf-check.yml` (Mondays) and `counter-trial.yml` (every night) run
  `.github/shelf-check/check.mjs` and `.github/counter-trial/check.mjs` on GitHub. Both read prices with the
  shared `.github/lib/price-check.mjs` and commit the results to `tools/<tool>/data/prices.json`.
  A push to `main` that changes the reading code makes each run a five line smoke test.
  `.github/workflows/fuel.yml` runs `.github/fuel/check.mjs` for Leighton Buzzard only and commits
  `tools/fuel/data/prices.json` when a price changes or the saved copy is 5 hours old. Its 3-hourly schedule was
  switched off on 21 Oct 2026 (the page reads live fast enough), so it only runs by hand or when its code changes;
  the saved copy is just a fallback and goes stale.
- `.github/workflows/product-search-names.yml` runs `.github/product-search/check.mjs` every 6 hours (00:23, 06:23, 12:23,
  18:23 UTC), each run up to 5.5 hours, so it goes round the clock until every product is done, then finds nothing to do.
  Each run starts with a photo sweep (`PHOTO_SWEEP: 'on'`): every missing photo, about one a second through the free relay
  wsrv.nl (Screwfix's image server refused GitHub directly, 20 Oct 2026; a 40 photo test at that pace was not blocked), since a
  photo's address needs only the code. 3 refusals in a row stop the sweep for that run (a warning, not a failure). Then per
  product: the page through jina (name and age check, text read only), photos only for any the sweep left. About one product every 20 s, gaps 14 to 26 s,
  a 2 to 6 minute break every 40 to 70 products, progress saved every 20. A failed product is skipped (retried after a
  week, 3 goes). 4 failures in a row: an hour's pause; 3 pauses with nothing working: it gives up (run fails, GitHub
  emails detailedfoil) and the next run gives up at once if its first 4 fail. detailedfoil asked for it to be as
  unsuspicious as possible: keep it polite (slow, uneven, backs off), never add ways to dodge Screwfix's blocking, and
  don't speed it up. Add `PHOTOS: 'off'` to the workflow to leave photos out.
- `.github/workflows/price-compare.yml` runs `.github/price-compare/check.mjs` twice a day (05:41 and 12:41 UTC) and saves
  `tools/price-compare/data/prices.json` (one row per store per product, its last 6 moves, `fail` when the latest read
  failed: the last price stays). A new price more than 25% from the last is only believed when the page's product data
  agrees or the next run sees it again (`pending`). A push changing the list prices only new rows (nothing new = a 3 page
  smoke test; a row that has only ever failed counts as new only when its address changes, `fail.url`). Run it by hand in
  `raw` mode to save every store page as it came back to the `diag-compare` branch, for working out a new store's layout
  (`extra` adds more addresses, `textonly` reads just the text: quick, for looking through stores' search pages).
- `.github/tests/`: the tests. The checks are run against a pretend jina and Screwfix
  (`mock-screwfix.mjs`, with the made-up products in `scenarios.mjs`), so the tests never touch the real sites.

## Things that are easy to break

- **Files written by robots.** `tools/shelf-check/data/prices.json`, `phone.json` and
  `tools/counter-trial/data/prices.json`, `ticks.json`, `tools/fuel/data/prices.json`, `tools/price-compare/data/prices.json`, `tools/product-search/data/web-names.json` and `desc-words.json` are written by the GitHub checks, or by the pages
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
