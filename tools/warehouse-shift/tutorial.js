/* The induction runs inside the ordinary solo game. Only the timetable, stock and
   accidents are staged. Each cue reads the same player, customer and till as the HUD. */
(function () {
  'use strict';
  const middle = (a, b) => (a + b) / 2;
  const point = (x, y) => ({ x, y });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function box(x, y, z, w, d, h) { return { x, y, z0: z - h / 2, z1: z + h / 2, w, d }; }
  function objectBox(o, z0 = 0, z1 = o.z1) {
    return box(middle(o.x0, o.x1), middle(o.y0, o.y1), middle(z0, z1), o.x1 - o.x0, o.y1 - o.y0, z1 - z0);
  }
  const cue = (text, selector, target, stand) => ({ text, selector, target, stand });
  function walk(text, target, stand, action) {
    return { text, target, stand, action };
  }
  const act = k => '[data-act="' + k + '"]';
  const field = k => '[data-f="' + k + '"]';
  const clean = s => s.toUpperCase().replace(/\s/g, '');

  function fusionCue(till, Till, lesson, submit) {
    const s = till.session(), v = till.guideView(), el = till.el;
    const value = k => el.querySelector(field(k)).value;
    const leave = act('leave');
    if (!s) return cue('Your customer is walking over. If this is an empty till, leave it and follow their marker.', leave);
    if (s.stage === 'done' || v.screen === 'done') return cue('Payment accepted. Choose Back to the warehouse to leave Fusion.', '[data-scr="done"] ' + leave);
    const line = s.lines[s.cur];
    const lookup = (lesson === 'catalogue' || line?.tutorialLookup) && s.selected && line && !line.shortage && !line.shown && !v.catalogueFailed;
    if (v.tab !== 'fusion') {
      if (!lookup) return cue('Switch back to TradeCounter Application to continue in Fusion.', '[data-tab="fusion"]');
      const copy = '[data-copy="' + line.item.code + '"]';
      if (el.querySelector(copy)) return cue('Choose Product code on the matching result. Listen for the customer to confirm it.', copy);
      return cue('Search CrashFix for “' + line.item.name + '”. The product code is on the result.', field('q'));
    }
    if (v.screen === 'who') {
      if (clean(value('surname')) !== clean(s.cust.surname)) return cue('Type the customer’s surname: ' + s.cust.surname + '.', field('surname'));
      if (clean(value('postcode')) !== clean(s.cust.postcode)) return cue('Enter their full postcode: ' + s.cust.postcode + '.', field('postcode'));
      return cue('Select Search to find matching accounts.', act('search'));
    }
    if (v.screen === 'res') {
      const i = v.results.indexOf(s.cust);
      if (i < 0) return cue('Their account is missing. Select Refine and check the details.', act('refine'));
      if (v.selectedRow !== i) return cue('Match the extra detail: ' + s.cust.third.say, '[data-v="rows"] tr[data-i="' + i + '"]');
      return cue('Select this account to open the customer’s basket.', act('select'));
    }
    if (v.screen === 'kiosk') {
      if (s.stage !== 'kiosk') return cue('Return to the basket to continue this order.', act('kback'));
      if (v.kioskRow !== s.kiosk.mine) return cue('Find the kiosk order under ' + s.kiosk.name + '.', '[data-v="krows"] tr[data-k="' + s.kiosk.mine + '"]');
      return cue('Press Select to bring the kiosk items into the basket.', act('kselect'));
    }
    if (v.screen === 'pay') {
      if (s.cash && !s.cash.done) {
        const left = s.cash.due - s.cash.hand.reduce((a, b) => a + b, 0);
        if (!left) return cue('That matches Change due. Choose Give change.', act('drgive'));
        if (left < 0) return cue('Too much in your hand. Tap a coin to put it back, or choose Start over.', act('drstart'));
        const coin = Till.DENOMS.find(n => n <= left);
        return cue(Till.money(left) + ' still to count. Take a ' + Till.denomName(coin) + (coin >= 500 ? ' note.' : ' coin.'), '[data-dr="' + coin + '"]');
      }
      if (s.cash?.done || !el.querySelector('[data-v="modal"]').hidden) return cue('Wait for the payment receipt.');
      return cue('The customer wants to pay by ' + s.pay.how + '. Choose that payment method.', act(s.pay.how));
    }
    if (!s.selected) return cue('Open Who to identify the customer first.', '[data-go="who"]');
    if (s.stage === 'kiosk') return cue('They used a kiosk. Open Kiosk Orders to find their basket.', '[data-go="kiosk"]');
    const wrong = s.basket.findIndex(row => row.status === 'qty');
    if (wrong >= 0) return cue('Correct the quantity on this line to ' + s.lines[s.basket[wrong].line].qty + ' and confirm.', '[data-row="' + wrong + '"]');
    if (s.basket.some(row => row.status === 'pending' || row.status === 'wrong')) return cue('Listen to the customer while they check the item.');
    if (line?.tutorialResolve && line.done) {
      const index = s.basket.findIndex(row => s.lines[row.line] === line);
      if (line.shortage === 'tcnd') return cue('Avail 0. They want it tomorrow. Change Today to orange TCND.', '[data-delivery="' + index + '"]');
      return cue('They don’t want this item. Remove it with × before adding the next one.', '[data-del="' + index + '"]');
    }
    if (line?.floor) return cue('The till scans the shop-floor item automatically. Watch for Picked.');
    if (line) {
      if (lookup) return cue('They gave a description. Open the CrashFix tab to look it up.', '[data-tab="crashfix"]');
      if (clean(value('part')) !== line.item.code) return cue('Enter ' + line.item.code + ' in Part No.', field('part'));
      return cue('Enter ' + line.qty + ' in Qty and ' + submit + ' to add the line.', field('qty'));
    }
    for (const [i, row] of s.basket.entries()) {
      const shortage = s.lines[row.line]?.shortage;
      if (shortage === 'decline') return cue('They’ll get this elsewhere. Remove the unavailable line with ×.', '[data-del="' + i + '"]');
      if (shortage === 'tcnd' && !row.tcnd) return cue('Avail 0. They want it tomorrow. Change Today to orange TCND.', '[data-delivery="' + i + '"]');
      if (!shortage && row.tcnd) return cue('This item is in stock. Switch this row back to Today.', '[data-delivery="' + i + '"]');
    }
    return cue('The basket is ready. Choose Pay & Go.', '[data-go="pay"]');
  }

  function create({ lesson, $, world, World, Till, Crew, S, T, player: p, tills, touch, covered, bellRung, upgraded, finish }) {
    const fullTour = lesson === 'tour', me = p.me, D = p.D;
    const chapters = ['Trade counter', 'Warehouse pick', 'Scanner dock', 'Kiosk order', 'Office upgrades & CCTV', 'Goods in & holding', 'Replen & lock-up'];
    const nav = new Crew.Nav(world);
    const floor = world.replenShelf, floorBox = objectBox(floor), floorAt = point(floor.x0 - 0.7, floorBox.y);
    const pc = world.pc, dock = world.scannerDock, counter = world.counter;
    const tillAt = t => point(middle(t.x0, t.x1), counter.y0 - 0.65);
    const entrance = world.openings.find(o => o.type === 'entrance');
    const doorX = middle(entrance.from, entrance.to);
    const pickItem = predicate => world.items.find(it => it.loc && World.room(it) >= 2 && predicate(it.loc, it));
    const saleItem = pickItem(l => l.face.area === 'AAA' && l.bay.no === 1 && l.z0 > 0.8 && l.z0 < 1.5);
    const floorItem = pickItem(l => l.face.area === 'BBA' && l.bay.no === 1 && l.z0 < 0.45);
    const stockItem = pickItem(l => l.face.area === 'AAB' && l.bay.no === 1 && l.shelf.no === 13);
    const stool = world.stools.find(st => st.area === 'AAB');
    const holdSpot = world.holding.spots.find(sp => sp.kind === 'tote' && sp.z0 >= 0.75);
    const cctv = world.objects.find(o => o.kind === 'cctv');
    const camBox = objectBox(cctv, cctv.z0), camAt = point(cctv.x0 - 0.85, camBox.y);
    let day, customer, kioskCustomer, collector, carton, holdingOrder, chapter = fullTour ? 0 : 1;
    let stood = false, fault = false, sawCCTV = false, finished = false, current, marked;
    let cctvArrivalUntil = 0;
    let tickIn = 0, routeFrom, routeTo, path = [];
    const trail = new T.Group(), ring = new T.RingGeometry(0.07, 0.12, 16);
    const paint = new T.MeshBasicMaterial({ color: 0xffdc62, side: T.DoubleSide });
    for (let i = 0; i < 18; i++) {
      const dot = new T.Mesh(ring, paint); dot.rotation.x = -Math.PI / 2; dot.visible = false; trail.add(dot);
    }
    S.scene.add(trail);
    const bearing = $('guideBearing');
    const scan = () => p.padIndex !== null ? 'press RT' : touch ? 'tap the glowing label' : 'aim and press F';
    const confirm = () => p.padIndex !== null ? 'press A' : touch ? 'tap Enter' : 'press Enter';
    const use = () => p.padIndex !== null ? 'press RT' : touch ? 'tap the action button' : 'press F';
    function line(item, qty, say) {
      return { kind: 'code', item, qty, accept: [item.code], say, clue: 'Code ' + item.code + '.', qtySay: qty > 1 ? qty + ', please.' : '' };
    }
    function prepare(d) {
      day = d;
      // The lesson releases these customers itself. Keep lock-up closed until replen is taught.
      day.plan = fullTour ? ['till', 'kiosk', 'collect'] : [lesson === 'kiosk' ? 'kiosk' : 'till'];
      day.total = day.plan.length; day.released = 0; day.floorTarget = 0; day.faultSchedule = [];
      if (lesson === 'holding') {
        holdingOrder = day.makeOrder('c', [{ item: saleItem, qty: 1 }], null, true, { surname: day.surname() });
      }
      if (fullTour) {
        const parcel = day.parcel(day.surname(), null);
        day.hold[holdSpot.code] = Object.assign(parcel, { locs: 2, units: 3 });
      }
    }
    function deliverCarton() {
      const loc = stockItem.loc;
      World.vacate(world, stockItem); day.emit('stock', stockItem);
      carton = { id: 1, item: stockItem, loc, qty: 4, src: 0, slot: 0, by: null, done: false };
      day.delivery = [carton];
      S.delivery.set(day.delivery); p.deliveryChanged();
    }
    function sendSale() {
      customer = day.send(lesson === 'kiosk' ? 'kiosk' : 'till');
      customer.pay = lesson === 'kiosk' ? { how: 'cash', say: 'Cash, please.' } : { how: 'card', say: 'Card, please.' };
      if (lesson === 'kiosk') {
        const basket = customer.kiosk.list[customer.kiosk.mine];
        const next = line(floorItem, 1, 'Can you get this for tomorrow?');
        next.shortage = 'tcnd'; next.reply = 'Tomorrow is fine. Order that one in, please.';
        basket.lines = [line(saleItem, 1, ''), next];
        basket.total = basket.lines.reduce((n, l) => n + Till.price(l.item) * l.qty, 0);
      } else if (fullTour) {
        const floorLine = line(floorItem, 1, 'Here you go. I picked this up from the shop floor.');
        floorLine.floor = true; floorItem.reserved = (floorItem.reserved || 0) + 1;
        customer.floorOffer = floorLine;
        const reachable = (loc, it) => ![saleItem, floorItem, stockItem].includes(it) && loc.z0 >= 0.45 && loc.z0 < 1.65;
        const lookupItem = pickItem((loc, it) => reachable(loc, it) && /claw hammer|tape measure|flat brush/i.test(it.name)) || pickItem(reachable);
        const lookup = { ...line(lookupItem, 1, 'I’m looking for a ' + lookupItem.name + '.'), tutorialLookup: true };
        const next = { ...line(stockItem, 1, 'Have you got ' + stockItem.code + '?'), shortage: 'tcnd', tutorialResolve: true, reply: 'Tomorrow is fine. Order that one in, please.' };
        const absent = pickItem((loc, it) => ![saleItem, floorItem, lookupItem, stockItem].includes(it));
        const declined = { ...line(absent, 1, 'Have you got ' + absent.code + ' as well?'), shortage: 'decline', tutorialResolve: true, reply: 'Leave that one off, I need it today.' };
        customer.lines = [line(saleItem, 2, 'Two of ' + saleItem.code + ', please.'), lookup, next, declined, floorLine];
      } else {
        const item = pickItem((loc, it) => /claw hammer/i.test(it.name)) || saleItem;
        const declined = line(stockItem, 1, 'Have you got ' + stockItem.code + ' as well?');
        declined.shortage = 'decline'; declined.tutorialResolve = true; declined.reply = 'Leave that one off, I need it today.';
        customer.lines = [line(item, 1, 'I’m looking for a ' + item.name + '.'), declined];
      }
    }
    function firstScan(order) {
      if (!fullTour || fault || order !== customer?.order || p.activeLine()?.item !== saleItem) return;
      fault = true;
      day.offlineScanners.add(p.id); day.emit('scannerFault', p.id);
    }
    function scannerMenu(index, label, expected, work) {
      const state = p.state();
      if (state === 'home') {
        const choose = p.padIndex !== null ? 'Use the D-pad, then A.' : touch ? 'Tap the row to select it, then tap again to open it.' : 'Use the up/down arrows, then Enter.';
        return cue('Choose ' + label + '. ' + choose, '#scRows [data-i="' + index + '"]');
      }
      if (state !== expected || p.scannerPage() !== index) return cue('Use ' + (p.padIndex !== null ? 'B' : touch ? 'Back' : 'Backspace') + ' to return to the scanner’s Main Menu.', '#scBack');
      if (state === 'pa') return work;
      return cue('Select the waiting ' + (index === 2 ? 'replen batch' : 'order') + ' and ' + confirm() + ' to claim it.', '#scEnter');
    }
    function shelfGuide(loc, putaway) {
      const target = S.locBox(loc), stand = point(middle(loc.x0, loc.x1), loc.face.front + loc.face.out * 0.78);
      const far = distance(me, stand) > 0.85;
      if (putaway && !p.stool && D.stepBtn.hidden) {
        return walk('High shelf. Go to the red kick stool, look down and use Take stool.',
          box(stool.x, stool.y, 0.34, 0.6, 0.6, 0.68), point(stool.x - 0.65, stool.y), 'Take stool');
      }
      if (far) return walk('Find ' + loc.code + '. Read area, bay, shelf, then position. Bay 01 starts at the centre aisle.', target, stand);
      if (putaway && !me.step) return cue('At the shelf, use Step to reach the high label.', '#stepBtn', target, stand);
      if (loc.z0 < 0.45 && !me.squat) return cue('This label is low. Squat to reach it.', '#squatBtn', target, stand);
      return walk((putaway ? 'Scan the destination on the carton' : p.state() === 'qty' ? 'Scan the same location again for the next unit' : 'Scan one unit at ' + loc.code) + ' — ' + scan() + '.', target, stand);
    }
    function workOrder() {
      const state = p.state(), order = p.order();
      if (state === 'hold' || state === 'put') {
        const spot = state === 'hold' ? world.holding.spots.find(sp => sp.code === order.hold.code) : holdSpot;
        const task = state === 'hold' ? 'Collect the bag from ' + spot.code + '. Face the glowing tote and ' + scan() + '.' :
          'A lowercase c goes into holding. Scan any empty OC spot to store the tote. Try ' + spot.code + '.';
        return walk(task, objectBox(spot, spot.z0, spot.z1), point(spot.x1 + 0.75, middle(spot.y0, spot.y1)));
      }
      if (state === 'restock') return walk('Take the tote to the middle shop-floor shelf. Face it and use Restock shelf for bonus XP.', floorBox, floorAt, 'Restock shelf');
      if (state === 'deliver') {
        const stand = tillAt(customer?.at || tills[0]);
        return cue('Take the tote behind the trade counter and ' + confirm() + ' to hand it over.', covered() ? '#scEnter' : null, objectBox(counter, 0, 1.02), stand);
      }
      if (state === 'qty' && p.full()) return cue('The quantity matches. ' + confirm() + ' to finish this line.', '#scEnter');
      return shelfGuide(p.activeLine().loc, false);
    }
    function office() {
      if (!p.pcOpen() && !upgraded()) return walk('Order handed over. Go back to the office and open the glowing Manager PC.', box(pc.x, pc.y, 1.08, 0.63, 0.12, 0.42), point(pc.x, pc.desk.y0 - 0.48), 'Use PC');
      if (p.pcOpen()) {
        if (upgraded()) return cue('Purchase complete. Close the Manager PC.', '.ws-pc-x');
        if (D.root.querySelector('.ws-shop').hidden) return cue('Open Upgrades to make Sam faster.', '[data-pc="shop"]');
        return cue('Spend your 100 practice XP on Sam’s speed upgrade.', '[data-sam-speed]');
      }

      if (!sawCCTV) {
        const angle = Math.atan2(camBox.x - me.x, me.y - camBox.y) + me.yaw;
        const pitch = Math.atan2((camBox.z0 + camBox.z1) / 2 - me.eye, distance(me, camBox));
        sawCCTV = distance(me, camAt) < 1.25 && Math.cos(angle) > 0.96 && Math.abs(me.pitch - pitch) < 0.35;
        if (!sawCCTV) return walk('Look at the office CCTV. Circles are customers; squares are staff.', camBox, camAt);
        collector = day.send('collect', { code: holdSpot.code, surname: day.hold[holdSpot.code].surname });
        cctvArrivalUntil = day.t + 2;
        return cue('A customer is walking in on CCTV. They’re here for Click & Collect.');
      }
      return null;
    }
    function meet(c) {
      const t = c.at || tills[0], target = c.state === 'greet' && c.fig ? box(c.fig.group.position.x, c.fig.group.position.z, 1.2, 0.52, 0.46, 1.1) : objectBox(t, 0.98, 1.36);
      if (c.state === 'coming') return walk('Stand behind the counter while the customer walks up. This area earns Service Champ +5% XP.', objectBox(t, 0.98, 1.36), tillAt(t));
      if (c.state === 'greet') return walk('Look at the customer from behind the till. When Greet appears, ' + use() + '.', target, tillAt(t), 'Greet');
      return walk('Face the glowing till and use it to open Fusion for this customer.', target, tillAt(t), 'Use till');
    }
    function nextCue() {
      if (!$('helpCover').hidden) return cue('Close How to play to return to the tutorial.', '#helpX');
      if (!$('endCover').hidden) return cue('Choose Keep playing to return to the tutorial.', '#keepBtn');
      if (p.tillOpen()) return fusionCue(p.till, Till, lesson, p.padIndex !== null ? 'press LB' : 'press Enter');
      if (!D.scMenu.hidden) return cue('Choose Close to return to your scanner task.', '#scMenu [data-k="0"]');
      if (!D.scConfirm.hidden) return cue('The blue choices expand together. Press Back to return to your task.', '#scBack');
      if (p.pcOpen() && !(fullTour && customer?.order?.status === 'done' && !sawCCTV)) return cue('Close the Manager PC to continue the tour.', '.ws-pc-x');
      if (lesson === 'holding') {
        if (p.order()) return workOrder();
        if (holdingOrder.status !== 'done') return scannerMenu(1, 'Today Picking', 'list');
        if (!collector) collector = day.send('collect', { code: holdingOrder.code, surname: holdingOrder.surname });
        if (!collector.order) return meet(collector);
        if (collector.order.status !== 'done') return scannerMenu(1, 'Today Picking', 'list');
        complete(); return null;
      }
      if (!customer) sendSale();
      if (!stood) {
        chapter = 0;
        stood = covered() || customer.greeter === p.id || !!customer.order;
        if (!stood) return walk('Follow the trail behind the counter. ' + (p.padIndex !== null ? 'Move with the left stick and look with the right.' : touch ? 'Walk with the left stick. Drag the view to look.' : 'WASD moves. Click the view for mouse look.'), objectBox(tills[0], 0.98, 1.36), tillAt(tills[0]));
      }
      if (fullTour && !bellRung() && !customer.greeter && !customer.order) {
        const b = world.bell;
        return walk('Behind the counter you earn Service Champ +5% XP. Ring the red bell to call for till cover.', box(b.x, b.y, b.z, 0.4, 0.17, 0.3), point(b.x, counter.y0 - 0.7), 'Ring bell');
      }
      if (!customer.order) return meet(customer);
      if (!fullTour) { complete(); return null; }
      if (p.scannerFault) { chapter = 2; return walk('Your scanner went offline mid-pick. Face the charging dock beside the PC and use Swap scanner.', box(dock.x, dock.y, dock.z, 0.64, 0.18, 0.23), point(dock.x, pc.desk.y0 - 0.42), 'Swap scanner'); }
      if (customer.order.status === 'done' && !kioskCustomer) {
        kioskCustomer = day.send('kiosk');
        kioskCustomer.pay = { how: 'cash', say: 'I’ll pay cash, please.' };
        const basket = kioskCustomer.kiosk.list[kioskCustomer.kiosk.mine];
        basket.lines = [line(saleItem, 1, '')];
        basket.total = Till.price(saleItem);
      }
      if (kioskCustomer && !kioskCustomer.order) { chapter = 3; return meet(kioskCustomer); }
      if (fault && kioskCustomer?.order?.status === 'done' && !sawCCTV) {
        chapter = 4;
        const task = office();
        if (task) return task;
      }
      if (day.t < cctvArrivalUntil) return cue('A customer is walking in on CCTV. They’re here for Click & Collect.');
      if (p.order()) {
        chapter = p.order().kind === 'replen' ? 6 : p.order().kind === 'hold' ? 5 : p.order() === kioskCustomer?.order ? 3 : fault ? 2 : 1;
        return workOrder();
      }
      if (carton && !carton.done && carton.by === p.id) {
        chapter = 5;
        if (p.state() === 'paqty') return cue('One confirmation shelves the whole carton. ' + confirm() + '.', '#scEnter');
        return shelfGuide(carton.loc, true);
      }
      if (customer.order.status !== 'done') {
        chapter = 1;
        return scannerMenu(1, 'Today Picking', 'list');
      }
      if (kioskCustomer.order.status !== 'done') { chapter = 3; return scannerMenu(1, 'Today Picking', 'list'); }
      chapter = 5;
      if (!collector.order) return meet(collector);
      if (collector.order.status !== 'done') return scannerMenu(1, 'Today Picking', 'list');
      if (!carton) deliverCarton();
      if (!carton.done) {
        const g = world.goodsin[carton.src];
        return scannerMenu(0, 'Putaway', 'pa', walk('Goods in is where delivery arrives. Scan the carton on the glowing cage.', objectBox(g.obj), g.stand));
      }
      chapter = 6;
      const replen = day.orders.find(o => o.kind === 'replen');
      if (replen?.status !== 'done') return scannerMenu(2, 'Shop floor replen', 'list');
      day.released = day.plan.length; day.check();
      return walk('Replen earned extra XP. Finish the shift by facing the front door and using Lock door.', box(doorX, world.D - 0.3, 1.05, entrance.to - entrance.from, 0.2, 2.1), point(doorX, world.D - 0.95), 'Lock door');
    }
    function route(goal) {
      if (!goal) { routeTo = null; trail.visible = false; bearing.hidden = true; return; }
      bearing.hidden = false; trail.visible = true;
      if (!routeTo || distance(routeTo, goal) > 0.15 || distance(routeFrom, me) > 0.55) {
        routeTo = goal; routeFrom = point(me.x, me.y);
        path = nav.find(me.x, me.y, goal.x, goal.y, null, 0.23) || [];
        let i = 0, along = 0.45;
        for (let j = 1; j < path.length && i < trail.children.length; j++) {
          const a = path[j - 1], b = path[j], len = distance(a, b);
          while (along < len && i < trail.children.length) {
            const dot = trail.children[i++]; dot.visible = true;
            dot.position.set(a.x + (b.x - a.x) * along / len, 0.43, a.y + (b.y - a.y) * along / len);
            along += 0.55;
          }
          along -= len;
        }
        for (; i < trail.children.length; i++) trail.children[i].visible = false;
      }
      const near = distance(goal, me) < 1.05;
      const aim = near ? current.target : path.slice(1).find(q => distance(q, me) > 0.38) || goal;
      const radians = Math.atan2(aim.x - me.x, me.y - aim.y) + me.yaw;
      bearing.firstElementChild.style.transform = 'rotate(' + radians + 'rad)';
      bearing.lastElementChild.textContent = near ? 'AIM' : Math.ceil(Crew.pathLength(path, me.x, me.y) || distance(goal, me)) + ' m';
    }
    function update(dt) {
      if (finished || (tickIn -= dt) > 0) return false;
      tickIn = 0.10;
      current = nextCue();
      if (!current) return false;
      const title = fullTour ? (chapter + 1) + '/' + chapters.length + ' · ' + chapters[chapter] : lesson === 'kiosk' ? 'Till practice · Kiosk & cash' : lesson === 'holding' ? 'Warehouse practice · Holding area' : 'Till practice · CrashFix';
      if ($('guideChapter').textContent !== title) $('guideChapter').textContent = title;
      if ($('guideTask').textContent !== current.text) $('guideTask').textContent = current.text;
      let target = current.selector && document.querySelector(current.selector);
      if (current.action && !D.tillBtn.hidden && D.tillBtn.firstChild.nodeValue === current.action) target = D.tillBtn;
      if (target !== marked) {
        marked?.classList.remove('guide-target'); target?.classList.add('guide-target'); marked = target;
        if (target?.closest('.fu-tw,.ws-pc-box,.cf-scroll')) target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
      const arrow = $('guideArrow');
      arrow.hidden = !target || !p.tillOpen() || !!target.closest('[hidden]') || !elOnScreen(target);
      if (!arrow.hidden) {
        const bounds = target.getBoundingClientRect(), right = bounds.left < 40;
        arrow.classList.toggle('from-right', right);
        arrow.style.left = (right ? bounds.right + 2 : bounds.left - 2) + 'px';
        arrow.style.top = (bounds.top + bounds.height / 2) + 'px';
      }
      route(current.stand);
      return true;
    }
    function elOnScreen(el) {
      const { x, y, width, height } = el.getBoundingClientRect();
      if (!width || !height) return false;
      const top = document.elementFromPoint?.(x + width / 2, y + height / 2);
      return !!top && (el.contains(top) || top.contains(el));
    }
    function drawGlow() {
      if (!current?.target || finished) return;
      S.setBox(S.glow, current.target, 0.025);
      S.glow.visible = true; S.glowMat.opacity = 0.42;
    }
    function complete() {
      if (finished) return;
      $('guideArrow').hidden = true;
      finished = true; trail.visible = false; marked?.classList.remove('guide-target');
      const report = day.report;
      finish(fullTour ? 'You locked up with ' + report.baseXP + ' work XP, ' + report.coverBonus + ' Service Champ XP and ' + report.bonus + ' lock-up bonus XP. Choose Continue on the main menu for your own shift.' :
        lesson === 'holding' ? 'You stored a c pick in holding, found the same OC spot when the customer arrived and handed over their bag.' :
        lesson === 'kiosk' ? 'You found the kiosk order, ordered the unavailable item for tomorrow and counted the change. Only goods due today go on the pick list.' : 'You found the product in CrashFix, entered its code in Fusion, removed a declined extra item and took payment.');
    }
    return { dayOptions: { mode: 'till', event: null, delivery: 0, firstDay: false, hold: {}, rand: World.rng(World.hash('warehouse induction/' + lesson)) },
      prepare, firstScan, drawGlow, update, complete };
  }
  window.ShiftTutorial = { create };
})();
