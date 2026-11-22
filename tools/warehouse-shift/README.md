# Warehouse Shift

Warehouse Shift is a first-person warehouse and trade-counter simulator inside [Toolbox](https://github.com/detailedfoil/Toolbox). Play a solo shift with Sam, share a screen with a second player, or host an online shift for up to four people. The team serves customers, picks orders, puts away delivery cartons, and locks the branch when the work is done.

- [Live game](https://detailedfoil.github.io/Toolbox/tools/warehouse-shift.html)
- [Online relay and deployment instructions](../../workers/warehouse-relay/README.md)
- [Agent instructions](../../AGENTS.md#warehouse-shift)

## Start here

Open [the game page](../warehouse-shift.html) through the Toolbox site and sign in with the existing Warehouse Shift account. Use **How to play** for the on-screen tutorial.

| Home screen action | What happens |
| --- | --- |
| **Continue** | Starts a solo session with the career XP, purchased upgrades, and Sam settings saved in this browser. The session begins at Day 1. The unfinished shift and current day number are held in the page while it is open. |
| **New game** | Shows “This will delete all progress and start completely fresh.” **Back** keeps the career. **Continue** in the warning clears it and starts Day 1 at 0 XP. Sign-in, badge name, sound, and control preferences are retained. |
| **Record playtest** | Changes the primary button to **Start playtest**. Starts a separate solo session at Day 1 with 0 XP, default equipment, and Sam on delivery. Earned XP and purchases carry into the next day in the same session. The regular career is left intact. |
| **Two players** | Starts side-by-side local split screen on a supported desktop-sized display. Join with two controllers, or a controller and keyboard/mouse. |
| **Online co-op** | Host or enter another host's six-character room code. Each device controls one player. |
| **Install game** / **Check for updates** | Installs the PWA if the browser supports it, or checks for a newer game bundle. |

## A shift from opening to lock-up

1. The shop opens automatically. Day 1 brings about a third of the usual delivery and customers. A standard later day has 15–25 planned picks, including holding-area work, and normally 11–16 delivery cartons.
2. Greet customers, handle till sales and collections, pick orders from the shared list, and work the delivery between orders. Customer arrivals depend on queue capacity, outstanding work, and delivery progress.
3. Complete every outstanding order, put the delivery away, and clear the waiting customers. **All done** directs you to lock the front door. Face it and use **Lock door**.
4. The lock-up screen shows the team score, XP, and individual shift stats. **Start the next day** advances the current session with the same career. In online co-op the host advances the day.

The wall clock normally moves from 07:00 to 20:00 as delivery is put away. On a cancelled-delivery day it follows completed customer work. The simulation timer and the wall clock are separate.

### Scanner and picking

- The scanner opens on **Putaway** or **Today Picking**. Use the arrows to choose an order and **Enter** to claim it. The same order cannot be claimed twice. Once started, the scanner asks you to finish the task.
- **A4821 2:3 CK** means order A4821, two locations, three units, with a click-and-collect customer waiting. A lowercase **c** is a pick for the holding area. A line with neither suffix is normally a paid till order.
- The scanner shows one location, SKU, and quantity at a time. Face the shelf and scan once per unit. Press **Enter** to commit the line and advance. Use **Hint** to highlight the target. A completed customer tote goes to the trade counter, where **Enter** hands it over.
- For a holding-area **c** pick, scan any free **OC** spot to put the tote away. If the customer arrives before the pick is finished, the task can change to a counter handover. For a bag already in holding, go to the displayed OC spot, scan the bag, and take it to the counter.
- In **Putaway**, scan the top carton on a goods-in cage or pallet. Take it to the destination shown on the scanner, scan the shelf, and press **Enter** once to shelve the carton. When empty-handed in Putaway, **Quick Pick** lets you take the top waiting customer pick if offered.
- For blue scanner actions with a confirmation step, the first press enlarges the available choices together. Press the action you want to confirm it.

### Finding stock

**AAB-03-07-02** means area AAB, bay 03, shelf 07, position 02. The area is on the rack end. Bay 01 begins at the centre aisle. Shelf 01 is at the bottom. Count the positions from left to right as you face the rack.

The right side runs from AAA to AAE, then BAA to BAG. The left side runs from BBA at the front to BBJ at the back. Picks normally travel up the right side and back down the left. The AAA trays hold four positions. The other tray labels list two positions, with the rear one above the front one.

Squat for bottom shelves. High shelves require **Step** on a red kick stool or the kickstool shoes upgrade. High shelves are AA shelf 13 and above, BA shelf 7 and above, and the top BB level. Red stools are at the ends of the rows.

### Serving a customer

1. Face the customer at the counter and press **Greet**. A click-and-collect customer generates a warehouse pick or a holding-area collection. For a customer ordering or paying, follow them to an available till and press **Use till**. The till nearest the counter gap is Sam's.
2. In **Fusion**, enter the customer's surname and postcode, press **Search**, and use the third detail they give you to choose the matching result.
3. For a kiosk customer, open **Kiosk Orders**, find the name they used, and select the order to populate the basket. For a walk-in order, enter the item code and quantity. If they give a description, search **CrashFix**, open results to inspect the details, and copy a suitable item's code into Fusion. **Ask again** repeats the request and can give a clue.
4. Choose **Pay & Go**, followed by card or cash as requested. For cash, select the notes and coins to make the correct change and press **Give change**. Exact cash completes automatically.
5. The sale creates a pick order and the customer waits near the counter gap. Anyone on the shift can pick and hand it over.

### Sam, service bells, and scanner problems

Sam is a physical coworker with a trolley. He shares pending work, avoids entering an aisle already occupied by a player, and may block an aisle when he parks to pick. The Manager PC in the office controls which jobs he does and their priority. Enable only the jobs you want him to take. Delivery is trained and enabled by default.

The service bell alerts the team when a customer goes unattended for about six seconds. You can also ring it. Sam prioritises the waiting till customer when trained and assigned to tills. If he needs training, the bell message points to the 100 XP upgrade.

| Scanner problem | Trigger | Recovery |
| --- | --- | --- |
| Sam takes the scanner by mistake | The shift draws a target of **2–4** mix-ups with unlabelled scanners and **0–1** with name labels. A ready till customer gives one opportunity. Quiet shifts can finish below the target. The count is shared across the team. Buying a name label mid-shift applies its cap to future mix-ups using the count already reached. | Finish serving, close the till, and walk up to Sam in his aisle or at its entrance. He hands the scanner back and shows a speech bubble. Named scanners get lines such as “Oh, that isn't my name in the gun!” |
| **Server connection issue** | The shift schedules random disconnects during active picks and putaway. Black-and-white falling text precedes the error. Scanner reliability limits the shift to 5, 4, 3, 2, or 1 disconnects. | Face the office charging dock beside the Manager PC and select **Swap scanner**. Your task and quantities carry over. |

Sam's dialogue appears as text. The game uses generated tones and effects for actions such as scans, bells, and payment.

### Shift events

A mixed shift has a 25% chance of one randomly selected event. The start banner marks an event that applies for the whole day.

| Event | Effect |
| --- | --- |
| Big sale today | More customers arrive throughout the shift. |
| Delivery cancelled | No delivery. Customer handovers move the wall clock, and customer waits gain extra weight in the score. |
| Website down | Fewer customers and click and collect only. |
| Fusion down | Tills close. The branch handles click and collect only. |
| Sam is on light duties | Sam can serve on tills and fetch orders already in the holding area. His usual training still applies. |

## Controls

| Input | Move and look | Work |
| --- | --- | --- |
| Phone or tablet | Left thumbstick moves, with a larger deflection to jog. Drag the view to look. Both orientations are supported. | Tap labels to scan or use the scanner buttons. Use **Squat**, **Take stool**, **Step**, **Greet**, and **Use till** when shown. Fusion uses the device keyboard or its optional on-screen keyboard. |
| Keyboard and mouse | WASD to move, Shift to jog. Click the view for mouse look, Esc to release it. | Click or F to scan or use the aimed action, Enter or Space to confirm, C to squat, V to step, H/F4 for Hint, Up/Down for the pick list, Tab for Function, Backspace for Back. |
| Controller | Left stick moves and jogs, right stick looks. | RT scans, A confirms, B goes back, X squats, LB steps, Y hints, D-pad moves through the pick list, Start opens Function. In Fusion, D-pad highlights, A presses, B deletes, LT selects Fusion, RT selects CrashFix, LB confirms, Y asks again, and Start leaves. |

The scanner's **Function** menu also has sound, look speed, help, practice pick mix, and Remove Sam/Bring Sam back. Practice mix is unavailable during a shift event. Online guests share the host's mix and Sam settings.

## Career, XP, and upgrades

Work completed by human players earns team XP. **5** per greeting, **15** per sale, **10** per confirmed pick line, **10** per finished order, and **10** per shelved carton. Once a human contributes, their device banks the team's work XP as it is earned. Work completed while someone covers the tills earns **Service Champ +5% XP**. Human till cover counts as participation and Sam can supply cover. Sam's own jobs do not generate human work XP.

Lock-up scores the team out of 1,000. The standard weights are 100 for greeting, 300 for customer waits, 250 for picking, 150 for delivery, and 200 for lock-up. The available work categories share the 800 work points if a category has no timed jobs. The shift bonus is work XP multiplied by the score divided by 4,000, up to 25%. Service Champ also applies to the covered work's share of the bonus. The same per-shift receipt is topped up at lock-up, so reopening a result or reconnecting cannot pay it twice.

Upgrades are available mid-shift at **Manager PC → Upgrades**. The prices below are paid in sequence for multi-tier upgrades.

| Upgrade | XP | Effect |
| --- | --- | --- |
| Sam's till service, customer picks, holding-area picks | 100 each | Unlocks that job immediately. Delivery is included. The host's training is used in online co-op. |
| Scanner name label | 150 | Adds your badge name to your scanner and caps future Sam mix-ups at one per shift. |
| Kickstool shoes | 350 | Lets you use Step without carrying a stool. |
| Scanner reliability tiers 2–5 | 125, 225, 350, 500 | Changes next solo or hosted shift's disconnect cap from 5 at tier 1 to 4, 3, 2, then 1. |
| Digital First tiers 2–5 | 100, 200, 350, 500 | Raises the next solo or hosted shift's click-and-collect share from 20% at tier 1 to 35%, 50%, 65%, then 80%. |

At 350 lifetime earned XP, **Cover tills** and **Clear delivery** job presets unlock on the Manager PC. The unlock uses lifetime XP. Purchases use available XP after deducting previous spend.

Regular career data is per browser profile and site origin. In [game.js](game.js), XP receipts are stored under `ws-shift-xp/`, with separate keys for purchases, Sam jobs, presets and lifetime stats. Preserve existing receipts and the legacy training migration when changing saves or prices. The new-game reset marks older tabs so their stale career writes cannot restore cleared progress. A guest can spend their own XP on personal kit. Branch-wide effects come from the host.

## Playtest recording and balance

Tick **Record playtest**, play normally, lock the front door, and click **Copy playtest summary**. If clipboard access is blocked, copy from the selectable text field. Copy each day's result before advancing to the next day. The recorder keeps the current session in memory and does not send the report anywhere.

The `warehouse-shift-playtest-v1` JSON includes starting progression, planned picks and cartons, player and Sam tasks, customer arrivals and sales, scanner crashes and swaps, XP and purchases, and the final score. Each event has elapsed real time, active foreground time, and simulation time. Backgrounding and opening help or the end-of-shift overlay are marked separately. Thinking time, navigation, and interruptions by other work count as foreground activity. Menu time is separated in the recorder and the simulation can continue behind an overlay.

The planned balance work is to tune a typical solo player toward **about 85% of paid upgrade tiers by the end of Day 7**. **Mas** is a proposed automated test player and has yet to be implemented. The intended inputs are a fresh Day 1 report and one later, busier shift. Use those timings to model slower, typical, and efficient players over repeatable runs using the real workload, XP, upgrade and Sam rules. Count each paid tier separately and compare what the player can actually buy in an allowed sequence.

## Code map

The game is a static HTML/CSS/JavaScript app. It loads a local copy of Three.js and runs in the browser. There is no frontend build step.

| File | Responsibility |
| --- | --- |
| [`../warehouse-shift.html`](../warehouse-shift.html) and [`game.css`](game.css) | Page, start/lock-up screens, scanner, upgrade shop, controls and in-game help. |
| [`game.js`](game.js) | Input, rendering loop, player and scanner state, collisions, till entry, Sam integration, saving and XP shop, audio, and playtest hooks. |
| [`day.js`](day.js) | Authoritative shift simulation, customer director, order ownership, stock changes, delivery, scoring, XP and scanner schedules. Exports a pure game core usable from Node. |
| [`world.js`](world.js), [`scene.js`](scene.js) and [`cctv.js`](cctv.js) | Warehouse geometry, stock and location model, Three.js scene, product photos, and office CCTV. |
| [`bot.js`](bot.js) | Sam's pathfinding, trolley, task selection, navigation, and dialogue. |
| [`till.js`](till.js), [`tillui.js`](tillui.js) and [`till.css`](till.css) | Customer identities, product requests and payment data, plus Fusion and CrashFix interfaces. CrashFix reuses [Toolbox product search](../product-search/search.js). |
| [`playtest.js`](playtest.js) | Foreground and simulation timing, event log, and copyable JSON. |
| [`online.js`](online.js), [`online-game.js`](online-game.js) and [`online-day.js`](online-day.js) | Relay session and reconnection, host/guest wiring, authoritative actions, snapshots and guest day model. |
| [`../warehouse-shift-sw.js`](../warehouse-shift-sw.js) and [`../warehouse-shift.webmanifest`](../warehouse-shift.webmanifest) | Installable game and offline bundle. The worker caches the stamped assets before publishing an updated page. |
| [`data/`](data/) and [`.github/warehouse-shift/`](../../.github/warehouse-shift/) | Generated catalogue and till request fixtures, their generators, and the online/browser test scripts. |

### Multiplayer and deployment

The host tab runs the simulation for the room. Guests send actions and local poses and render snapshots using their own copies of the catalogue and map. The host validates job ownership, line order, scan proximity, and till baskets. The [Cloudflare relay](../../workers/warehouse-relay/README.md) assigns identities and forwards messages. A SQLite-backed Durable Object handles each room. The host remains authoritative for live work, Sam, and branch upgrades.

All players need matching protocol, stamped game scripts, and catalogue fingerprints. An interrupted connection reserves the seat for about 30 seconds. Unfinished guest work goes back on the list while completed work stays complete. Hiding the host tab pauses the room. Reloading or leaving the original host ends the shift when the host cannot return. Solo and split screen work without the relay.

The game deploys from `main` through GitHub Pages. The Worker deploys separately. For game-only edits, publish the correct stamped game files and verify the page and assets on Pages. Installed copies can use **Check for updates**. Follow the [relay instructions](../../workers/warehouse-relay/README.md) for Cloudflare changes.

## Checks before shipping

From the repository root, serve the checkout for a browser check and open `http://localhost:8000/tools/warehouse-shift.html`. Use the game's normal sign-in.

```sh
python3 -m http.server 8000
```

After changing any linked game script, stylesheet or catalogue/request data, refresh the page fingerprints. Run the repository checks.

```sh
node .github/stamp.mjs
npm ci --prefix .github
npm test --prefix .github
node .github/stamp.mjs --check
```

The [Warehouse online workflow](../../.github/workflows/warehouse-online.yml) starts local Wrangler and runs relay tests, a simulated game DOM, and Chromium browser checks with touch input. Use the [relay README](../../workers/warehouse-relay/README.md#local-checks) for local setup. When the change affects a control or workflow, exercise the actual in-game entry point and relevant desktop, touch, or co-op modes. Include the checks you ran when handing work back.

## Instructions for coding agents

1. Read this README and the relevant source and tests before editing. Treat the current code and tests as the authority when an older note differs.
2. Update this README in the same change whenever player-visible behaviour, controls, balancing, XP, upgrades, save/reset rules, paths, setup, deployment, or test commands change. Update the affected section in place so this stays a handover an agent can read without the original chat.
3. Keep the in-game help and upgrade descriptions accurate when rules or controls change. If relay behaviour or setup changes, update the relay README as well.
4. Keep current behaviour separate from proposed work. Mark a planned feature as implemented only after it exists and you can point to its source. Report gaps and unverified behaviour explicitly.
5. Preserve existing saves and normal solo, split-screen, and online entry points unless the requested change alters them. Use local test data when exercising destructive flows. Keep passwords, tokens, and private player data out of the repository and reports.
6. Stamp versioned assets, run the relevant checks, and report what shipped and how you verified it.
