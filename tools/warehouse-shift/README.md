# Warehouse Shift

Warehouse Shift is a first-person warehouse and trade-counter simulator inside [Toolbox](https://github.com/detailedfoil/Toolbox). Play a solo shift with Sam, share a screen with a second player, or host an online shift for up to four people. The team serves customers, picks orders, puts away delivery cartons, and locks the branch when the work is done.

- [Live game](https://detailedfoil.github.io/Toolbox/tools/warehouse-shift.html)
- [Online relay and deployment instructions](../../workers/warehouse-relay/README.md)
- [Agent instructions](../../AGENTS.md#warehouse-shift)

## Start here

Open [the game page](../warehouse-shift.html) through the Toolbox site and sign in with the existing Warehouse Shift account. Choose **Play tutorial** for a guided first shift. **How to play** opens the reference guide.

| Home screen action | What happens |
| --- | --- |
| **Continue** | Starts a solo session with the career XP, purchased upgrades, and Sam settings saved in this browser. The session begins at Day 1. The unfinished shift and current day number are held in the page while it is open. |
| **New game** | Shows “This will delete all progress and start completely fresh.” **Back** keeps the career. **Continue** in the warning clears it and starts Day 1 at 0 XP. Sign-in, badge name, sound, and control preferences are retained. |
| **Record playtest** | Changes the primary button to **Start playtest**. Starts a separate solo session at Day 1 with 0 XP, default equipment, and Sam at Tier 1 with all four jobs enabled. Earned XP and purchases carry into the next day in the same session. The regular career is left intact. |
| **Two players** | Starts side-by-side local split screen on a supported desktop-sized display. Join with two controllers, or a controller and keyboard/mouse. |
| **Online co-op** | Host or enter another host's six-character room code. Each device controls one player. |
| **Install game** / **Check for updates** | Installs the PWA if the browser supports it, or checks for a newer game bundle. |

## Playable tutorial

**Play tutorial → First shift** starts a separate solo practice shift. Follow the floating gold trail around walls, the direction arrow and the glow on the actual object. Fusion, the scanner and the Manager PC outline the next control. The guide updates from what the player actually does. There is no timed reading or Next button.

1. Walk to the staff side of the trade counter. The Service Champ indicator appears there. Ring the service bell, greet the waiting customer and use their till.
2. In Fusion, enter their surname and postcode, match their extra detail, add one item by SKU, find a second item in CrashFix, set one out-of-stock line to TCND, remove a declined item, and watch the shop-floor item scan in. Resolve each shortage as soon as the customer responds to it. Take card payment.
3. Claim their order in Today Picking, follow the location code and scan a unit. A staged scanner failure interrupts the pick. Swap the scanner at the office dock. Return to the shelf, finish the quantity and hand over the same order. Serve the next customer’s kiosk order, take cash and give change, then hand it over. Return to the Manager PC to spend 100 practice XP on Sam’s Tier 2 speed upgrade. When you look at CCTV, watch the Click & Collect customer arrive.
4. Greet the Click & Collect customer, scan the named OC tote and hand it over. A practice carton then arrives at goods in. Use Putaway and take a kick stool to the high destination, scan the location and confirm the carton.
5. Open Shop floor replen, squat to pick the replacement and restock the middle shelf. Face the front door and lock up to complete training.
6. **Kiosk, TCND & cash** is a separate repeatable till exercise covering kiosk selection, changing an unavailable line to TCND and giving change. **CrashFix lookup** teaches searching by description, copying a matching code, returning to Fusion, removing a declined out-of-stock extra, and paying. **Holding-area picks** lets the player store a lowercase-c order in any empty OC spot and fetch that same tote when its customer arrives.

Exit tutorial (controller: hold View and press Menu), completion, or reloading returns you to the main menu with your regular career. Practice starts fresh each time. It uses the production tills, scanner, movement, stock and XP routines in memory. Sam and random arrivals are absent so the player can take as long as needed. The practice allowance, labour XP, purchases, stock and shift stats do not carry into a real shift. Playtest recording and multiplayer each keep their own entry point.

## A shift from opening to lock-up

1. The shop opens automatically. Day 1 brings about a third of the usual delivery and customers. A standard later day has 15–25 planned picks, including holding-area work, and normally 11–16 delivery cartons.
2. Greet customers, handle till sales and collections, pick orders from the shared list, and work the delivery between orders. One customer can arrive at opening. Shelving half the cartons releases roughly half the day’s customers. The last customers can arrive with one carton left, as queue capacity and outstanding work allow. Holding-area picks do not use customer slots. Cancelled-delivery days use normal queue pacing throughout.
3. Complete every outstanding order, put the delivery away, and clear the waiting customers and restock any outstanding shop-floor replen. **All done** directs you to lock the front door. Face it and use **Lock door**.
4. The lock-up screen shows the team score, XP, and individual shift stats. Choose **Next** to spend available XP on upgrades. **Start Next Day** opens the next shift with the players in the office. In online co-op the host advances the day.

The scanner, CCTV and wall clock share the same shift time. It normally moves from 07:00 to 20:00 as delivery is put away. On a cancelled-delivery day it follows completed customer work. The simulation timer and the displayed shift time are separate.

Fusion gives each customer and each search-result account a unique email within the shift. People with different first names can share a postal address.

### Scanner and picking

- The scanner opens on **Putaway** or **Today Picking**. Use the arrows to choose an order and **Enter** to claim it. The same order cannot be claimed twice. Once started, the scanner asks you to finish the task.
- **A4821 2:3 CK** means order A4821, two locations, three units, with a click-and-collect customer waiting. A lowercase **c** is a pick for the holding area. A line with neither suffix is normally a paid till order.
- The scanner shows one location, SKU, and quantity at a time. Face the shelf and scan once per unit. Press **Enter** to commit the line and advance. Use **Hint** to highlight the target. A completed customer tote goes to the trade counter, where **Enter** hands it over.
- For a holding-area **c** pick, scan any free **OC** spot to put the tote away. If the customer arrives before the pick is finished, the task can change to a counter handover. For a bag already in holding, go to the displayed OC spot, scan the bag, and take it to the counter.
- In **Putaway**, scan the top carton on a goods-in cage or pallet. Take it to the destination shown on the scanner, scan the shelf, and press **Enter** once to shelve the carton. To stop carrying a carton, press **Back**, walk it back to Goods In and scan the glowing original cage or pallet. That returns it to the delivery and opens the scanner main menu. Press **Back** again while returning it to resume putaway. Sam finishes the cartons he takes. When empty-handed in Putaway, **Quick Pick** lets you take the top waiting customer pick if offered.
- For blue scanner actions with a confirmation step, the first press enlarges the available choices together. Press the action you want to confirm it. Use **Function** to enlarge the blue buttons, then choose **<1> Hint** or **<2> Quick Pick** when shown. Function has no number and pressing it again closes the enlarged buttons.

### Shop floor replen

On shifts with till sales, customers buy 2–4 extra units from the shop floor. The customer says they brought something from the shop floor, without naming the product. The till waits one second, beeps, then adds the item one second later with a dark green **Picked** label. Once the basket is ready, the customer says they are finished and how they will pay. Sam can serve these sales too. Like the rest of the character dialogue, the line can be spoken using a local English voice. Payment adds the replacements to **Shop floor replen** on the scanner main menu. Collection-only shifts have no shop-floor sales.

The scanner shows **Shop floor full** until a sale creates work. Open **Pick replen**, select the batch and scan the warehouse locations as usual. Take the completed tote to the middle shelving unit on the shop floor, face it and use **Restock shelf**. Sales made while someone is picking start another batch. In co-op each batch belongs to one picker. Restocking awards **10 XP per unit** at the shelf. Every replen batch must be restocked before lock-up. Collection-only days can close as soon as their other work is complete.

### Finding stock

**AAB-03-07-02** means area AAB, bay 03, shelf 07, position 02. The area is on the rack end. Bay 01 begins at the centre aisle. Shelf 01 is at the bottom. Count the positions from left to right as you face the rack.

The right side runs from AAA to AAE, then BAA to BAG. The left side runs from BBA at the front to BBJ at the back. Picks normally travel up the right side and back down the left. The AAA trays hold four positions. The other tray labels list two positions, with the rear one above the front one.

Squat for bottom shelves. High shelves require **Step** on a red kick stool or the kickstool shoes upgrade. High shelves are AA shelf 13 and above, BA shelf 7 and above, and the top BB level. Red stools are at the ends of the rows.

### Serving a customer

1. Stand behind the tills and face the queue. **Greet** defaults to the longest-waiting customer within reach and in view. Aim directly at another customer to greet them first. Opening a free till with nobody assigned also calls the longest-waiting customer. Look at a nearby customer from the till area to see their status on the idle scanner, including **Waiting to order** and **Paid · awaiting pick**. A click-and-collect customer generates a warehouse pick or a holding-area collection. For a customer ordering or paying, follow them to an available till and press **Use till**. The till nearest the counter gap is Sam's.
2. In **Fusion**, enter the customer's surname and postcode, press **Search**, and use the third detail they give you to choose the matching result.
3. For a kiosk customer, open **Kiosk Orders**, find the name they used, and select the order to populate the basket. For a walk-in order, enter the item code and quantity. If they give a description, search **CrashFix**, open results to inspect the details, and copy a suitable item's code into Fusion. **Ask again** repeats the request and can give a clue.
4. Each till customer, including kiosk customers and those Sam serves, has a 20% chance of asking for one extra item with **Avail 0**. Half want it tomorrow. The whole out-of-stock row is red. Switch its **Today** button to orange **TCND** to clear the red and display a simulated next-day quantity between 50 and 1,000. Switching back restores zero for today. The other half decline it. Use **×** to remove their item. Keep the ordinary items on **Today**.
5. Choose **Pay & Go**, followed by card or cash as requested. For cash, select the notes and coins to make the correct change and press **Give change**. Exact cash completes automatically.
6. Only warehouse items for collection today go on the customer pick list. A TCND line ends at payment and creates no next-day task. The sale creates a pick order and the customer waits near the counter gap. Anyone on the shift can pick and hand it over.

### Sam, service bells, and scanner problems

Sam waits near holding and goods in when idle. When assigned to tills and the tills are open, he waits behind the counter when there are no other jobs.

Sam is a physical coworker with a trolley. He shares pending work, avoids entering an aisle already occupied by a player, and may block an aisle when he parks to pick. The Manager PC in the office controls which jobs he does and their priority. All four jobs start enabled. The default priority is till service, customer picks, lowercase **c** picks for holding, then delivery. Untick or reorder jobs at any time. When till service is enabled, a service-bell call takes priority on Sam’s next job. Sam shelves the carton he’s carrying and checks priorities again before scanning another one. If a waiting customer has priority over delivery, Sam gives the player a short chance to help before serving them. Players get a short head start on new picks.

Sam rings the service bell when a customer has gone unattended for about six seconds and he is within reach on the staff side. You can also ring it. Sam prioritises the waiting till customer when assigned to tills.

| Scanner problem | Trigger | Recovery |
| --- | --- | --- |
| Sam takes the scanner by mistake | The shift draws a target of **2–4** mix-ups with unlabelled scanners and **0–1** with name labels. Sam can take the scanner immediately after a player takes payment, while the till is still open. Each completed player sale gives one opportunity. Quiet shifts can finish below the target. The count is shared across the team. Buying a name label mid-shift applies its cap to future mix-ups using the count already reached. | The prompt first appears when you close the till and stays visible until you get your scanner back. Walk up to Sam in his aisle or at its entrance. He hands the scanner back and shows a speech bubble. Named scanners get lines such as “Oh, that isn't my name in the gun!” |
| **Server connection issue** | The shift schedules random disconnects during active picks and putaway. Black-and-white falling text precedes the error. Scanner reliability limits the shift to 5, 4, 3, 2, or 1 disconnects. | Face the office charging dock beside the Manager PC and select **Swap scanner**. Your task and quantities carry over. The replacement is protected from disconnects for 60 seconds of shift time. Once the final line is confirmed, that order can be handed over without a new disconnect. |

Sam's dialogue appears as text. The game uses generated tones and effects for actions such as scans, bells, and payment.

The office CCTV marks customers with large coloured circles and staff with square initials. The customer rings show whether they are queueing, at a till, or waiting for an order.

### Shift events

A mixed shift has a 25% chance of one randomly selected event. The start banner marks an event that applies for the whole day.

| Event | Effect |
| --- | --- |
| Big sale today | More customers arrive throughout the shift. |
| Delivery cancelled | No delivery. Customer handovers move the wall clock, and customer waits gain extra weight in the score. |
| Website down | Fewer customers and click and collect only. |
| Fusion down | Tills close. The branch handles click and collect only. |
| Sam is on light duties | Sam can serve on tills and fetch orders already in the holding area. His usual job assignments and speed still apply. |

## Controls

| Input | Move and look | Work |
| --- | --- | --- |
| Phone or tablet | Left thumbstick moves, with a larger deflection to jog. Drag the view to look. Both orientations are supported. | Tap labels to scan or use the scanner buttons. Use **Squat**, **Take stool**, **Step**, **Greet**, and **Use till** when shown. Fusion uses the device keyboard or its optional on-screen keyboard. The till suggests rotating upright for touch controls in landscape. |
| Keyboard and mouse | WASD to move, Shift to jog. Click the view for mouse look. Esc opens the main menu or closes the computer you’re using. Closing Fusion or the Manager PC captures the mouse again. | Left-click or F to use the outlined object or greet a highlighted customer. They also scan targets under the crosshair. Left-click with no interaction or scan target under the crosshair acts like scanner **Enter**. Enter confirms scanner actions, C squats, and Space steps onto or off a held kick stool or kickstool shoes. Space also confirms scanner actions when neither is available. Up/Down or the wheel scrolls the scanner. 1 and 2 select blue buttons, Tab enlarges them, and right-click or Backspace goes back. |
| Controller | Left stick moves and jogs, right stick looks. | RT scans, A confirms, B goes back, X squats, LB steps, Y hints, D-pad moves through the pick list, RB enlarges the blue buttons. Start opens the main menu or closes the computer you’re using. With them enlarged, A confirms Quick Pick if available, Y uses Hint, and B closes them. In Fusion, D-pad highlights, A presses, B deletes, LT selects Fusion, RT selects CrashFix, LB confirms, Y asks again, and Start leaves. |

**Character voices** on the start screen toggles spoken dialogue independently of scan sounds and other effects. The **Sound** toggle mutes both. Character dialogue plays at half volume. Sam and customers speak English. Every third customer uses an installed local voice intended for another language when available. The selection starts with French and Finnish if installed. Dialogues stay in English. SKU codes are read aloud one character at a time, and captions keep the original code. While a till is open, only the customer at the player’s till is voiced and Sam’s work sounds are muted. Captions remain visible with voices disabled.

The top-left **Menu** button, **Esc**, and controller **Start** open the main menu. Choose **Resume** to return to the shift. The overlay pauses solo and split-screen shifts. Online shifts continue for everyone while the menu is open, including when the host opens it. If Fusion or the Manager PC is open, the first press closes it. Press again to open the menu.

## Career, XP, and upgrades

Work completed by human players earns team XP. **5** per greeting, **15** per sale, **10** per confirmed pick line, **10** per finished order, and **10** per shelved carton. Once a human contributes, their device banks the team's work XP as it is earned. Work completed while a player or Sam is anywhere in the staff area behind the counter earns **Service Champ +5% XP**, including while they move. Human till cover counts as participation and Sam can supply cover. Sam's own jobs do not generate human work XP.

Lock-up scores the team out of 1,000. The standard weights are 100 for greeting, 300 for customer waits, 250 for picking, 150 for delivery, and 200 for lock-up. The available work categories share the 800 work points if a category has no timed jobs. The shift bonus is work XP multiplied by the score divided by 4,000, up to 25%. Service Champ also applies to the covered work's share of the bonus. The same per-shift receipt is topped up at lock-up, so reopening a result or reconnecting cannot pay it twice.

Upgrades are available mid-shift at **Manager PC → Upgrades**. The prices below are paid in sequence for multi-tier upgrades.

| Upgrade | XP | Effect |
| --- | --- | --- |
| Sam speed tiers 2–5 | 100, 150, 225, 350 | The shop displays 100% speed at Tier 1 and bonuses of +10%, +20%, +30% and +40% for Tiers 2–5. The labels leave the actual movement and job speeds at 80%, 90%, 100%, 110% and 120% of the original pace. Online co-op uses the host's tier. |
| Scanner name label | 150 | Adds your badge name to your scanner and caps future Sam mix-ups at one per shift. |
| Kickstool shoes | 350 | Lets you use Step without carrying a stool. |
| Scanner reliability tiers 2–5 | 125, 225, 350, 500 | Changes next solo or hosted shift's disconnect cap from 5 at tier 1 to 4, 3, 2, then 1. |
| Digital First tiers 2–5 | 100, 200, 350, 500 | Raises the next solo or hosted shift's click-and-collect share from 20% at tier 1 to 35%, 50%, 65%, then 80%. |

At 350 lifetime earned XP, **Cover tills** and **Clear delivery** job presets unlock on the Manager PC. The unlock uses lifetime XP. Purchases use available XP after deducting previous spend.

Regular career data is per browser profile and site origin. In [game.js](game.js), XP receipts are stored under `ws-shift-xp/`, with separate keys for purchases, Sam jobs, presets and lifetime stats. Previous Sam training and job slot costs are returned to available XP by removing those deductions. Existing saves start at Tier 1 with all four jobs enabled in the new default order. Saved presets stay available. Preserve the XP receipts and other purchases when updating saves or prices. The new-game reset marks older tabs so their stale career writes cannot restore cleared progress. A guest can spend their own XP on personal kit. Branch-wide effects come from the host.

## Playtest recording and balance

Tick **Record playtest**, play normally, lock the front door, and click **Copy playtest summary**. If clipboard access is blocked, copy from the selectable text field. Copy each day's result before advancing to the next day. The recorder keeps the current session in memory and does not send the report anywhere.

The `warehouse-shift-playtest-v1` JSON includes starting progression, planned picks and cartons, player and Sam tasks, customer arrivals and sales, scanner crashes and swaps, carton returns, XP and purchases, Sam’s speed tier, and the final score. Each event has elapsed real time, active foreground time, and simulation time. Backgrounding and opening help or the end-of-shift overlay are marked separately. Thinking time, navigation, and interruptions by other work count as foreground activity. Menu time is separated in the recorder and the simulation can continue behind an overlay.

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
| [`tutorial.js`](tutorial.js) | Practice timetable, live lesson cues, till highlights and navigable floor trail. |
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

The [Warehouse online workflow](../../.github/workflows/warehouse-online.yml) starts local Wrangler and runs relay tests, a simulated game DOM, and Chromium browser checks with touch input. The induction playthroughs use movement with collisions, real scanner labels and Fusion form events. They exercise all four lessons and check the stored career after practice. Run them alone with `node --test --test-name-pattern='playable induction' .github/warehouse-shift/test-online-game.mjs`. Chromium also plays the main induction and checks mobile entry and exit. Use the [relay README](../../workers/warehouse-relay/README.md#local-checks) for local setup. When the change affects a control or workflow, exercise the actual in-game entry point and relevant desktop, touch, or co-op modes. Include the checks you ran when handing work back.

## Instructions for coding agents

1. Read this README and the relevant source and tests before editing. Treat the current code and tests as the authority when an older note differs.
2. Update this README in the same change whenever player-visible behaviour, controls, balancing, XP, upgrades, save/reset rules, paths, setup, deployment, or test commands change. Update the affected section in place so this stays a handover an agent can read without the original chat.
3. Keep the in-game help and upgrade descriptions accurate when rules or controls change. If relay behaviour or setup changes, update the relay README as well.
4. Keep current behaviour separate from proposed work. Mark a planned feature as implemented only after it exists and you can point to its source. Report gaps and unverified behaviour explicitly.
5. Preserve existing saves and normal solo, split-screen, and online entry points unless the requested change alters them. Use local test data when exercising destructive flows. Keep passwords, tokens, and private player data out of the repository and reports.
6. Stamp versioned assets, run the relevant checks, and report what shipped and how you verified it.
