// Shared by the DOM and Chromium tests. Accelerate walking and the customer queue;
// interact through the same controls, collisions, labels and sale validation as a player.
window.playTutorial = async function (lesson) {
  const $ = id => document.getElementById(id), s = window.__shift, w = s.world, p = s.players[0], me = p.me;
  const find = selector => document.querySelector(selector);
  const delay = ms => new Promise(r => setTimeout(r, ms));
  async function wait(check, what) {
    const limit = Date.now() + 20000;
    while (!check()) {
      if (Date.now() > limit) throw Error(what + ' | ' + $('guideTask').textContent + ' | ' + s.state());
      await delay(45);
    }
  }
  const text = word => wait(() => $('guideTask').textContent.toLowerCase().includes(word.toLowerCase()), word);
  const click = selector => { const b = find(selector); if (!b || b.closest('[hidden]')) throw Error('Hidden control ' + selector); b.click(); };
  const key = k => $('view').dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === 'f' ? 'KeyF' : k, bubbles: true, cancelable: true }));
  const field = (selector, val) => {
    const input = find(selector); input.value = val; input.dispatchEvent(new Event('input', { bubbles: true })); return input;
  };
  const before = Object.entries(localStorage).filter(([k]) => k.startsWith('ws-')).sort();
  click('#tutorialBtn'); click('[data-lesson="' + lesson + '"]');
  const day = s.day(), nav = new ShiftBot.Nav(w), mid = (a, b) => (a + b) / 2;
  function walk(x, y) {
    const path = nav.find(me.x, me.y, x, y, null, 0.23);
    if (!path) throw Error('No walking route to ' + [x,y]);
    p.input.keys.add('f');
    try {
      for (const target of path.slice(1)) {
        let steps = 0;
        while (Math.hypot(me.x - target.x, me.y - target.y) > 0.12) {
          if (++steps > 750) throw Error('Blocked walking from ' + [me.x,me.y] + ' to ' + [target.x,target.y]);
          me.yaw = -Math.atan2(target.x - me.x, me.y - target.y);
          p.update(0.035, performance.now());
        }
        me.vx = me.vy = 0;
      }
    } finally { p.keysClear(); me.vx = me.vy = 0; }
  }
  function aim(x,y,z) {
    me.yaw = -Math.atan2(x-me.x,me.y-y); me.pitch = Math.atan2(z-me.eye,Math.hypot(x-me.x,y-me.y));
    p.applyCam(); p.cam.updateMatrixWorld(); p.update(0.001,performance.now());
  }
  async function interact(label) {
    await wait(() => !$('tillBtn').hidden && $('tillBtn').textContent.startsWith(label), label);
    key('f');
  }
  function shelf(loc) {
    const x = mid(loc.x0,loc.x1), y = loc.face.front + loc.face.out * 0.78;
    walk(x,y);
    const look = () => { const a = ShiftBot.labelAt(loc); aim(a.x,a.y,a.z); };
    look(); return look;
  }
  function menu(index) {
    if (s.state() !== 'home') key('Backspace');
    const row = find('#scRows li[data-i="' + index + '"]');
    if (!row.classList.contains('on')) row.dispatchEvent(new Event('pointerdown', { bubbles:true }));
    key('Enter');
  }
  function tillPos(t) { return mid(t.x0,t.x1); }
  async function greet(c) {
    s.tick(65);
    walk(tillPos(s.tills[0]), w.counter.y0 - 0.65);
    const f = c.fig.group.position; aim(f.x,f.z,1.2);
    await interact('Greet');
  }
  async function openTill(t) {
    walk(tillPos(t), w.counter.y0 - 0.65); aim(tillPos(t), mid(t.y0,t.y1),1.15);
    await interact('Use till'); s.tick(8);
    await wait(() => p.till.session()?.stage === 'details', 'Customer details');
  }
  if (lesson === 'holding') {
    menu(1); key('Enter'); shelf(p.activeLine().loc); key('f'); key('Enter');
    await text('any empty OC');
    // Use a different free spot: the later collection must follow the actual tote.
    const sp = w.holding.spots.filter(spot => spot.kind === 'tote' && spot.z0 >= .75)[1];
    const sy = mid(sp.y0,sp.y1);
    function scanBag() { walk(sp.x1+.75,sy); aim(sp.x1,sy,mid(sp.z0,sp.z1)); key('f'); }
    scanBag();
    await wait(()=>day.customers.length===1,'Waiting collection');
    await greet(day.customers[0]); key('Enter');
    await text('Collect the bag from ' + sp.code); scanBag();
    walk(tillPos(s.tills[0]),w.counter.y0-.65); key('Enter');
  } else {
    await wait(() => day.customers.length === 1, 'First customer');
    const c = day.customers[0];
    if (lesson === 'tour') {
      const b=w.bell; walk(b.x,w.counter.y0-.7); aim(b.x,b.y,b.z);
      await text('Ring the red bell'); await interact('Ring bell');
    }
    await greet(c);
    await openTill(c.at);
    async function identify(c, refine = false) {
      await text('surname');
      if (document.elementFromPoint) {
        await wait(() => !$('guideArrow').hidden, 'Arrow on the Fusion surname field');
        const guide = $('shiftGuide').getBoundingClientRect(), till = $('till').getBoundingClientRect();
        if (guide.bottom > till.top + 1 || !find('[data-f=surname]').classList.contains('guide-target')) {
          throw Error('Tutorial must highlight the active field and leave Fusion unobstructed');
        }
      }
      if (refine) {
        field('[data-f=surname]','zzzzz'); click('[data-act=search]'); await text('Refine'); click('[data-act=refine]');
      }
      field('[data-f=surname]',c.cust.surname); await text('postcode');
      field('[data-f=postcode]',c.cust.postcode); await text('Search'); click('[data-act=search]');
      const correct = p.till.guideView().results.indexOf(c.cust);
      click('[data-v=rows] [data-i="' + correct + '"]'); click('[data-act=select]');
    }
    await identify(c, lesson === 'tour');
    if (lesson === 'kiosk') {
      await text('Kiosk Orders'); click('[data-go=kiosk]');
      click('[data-v=krows] [data-k="' + c.kiosk.mine + '"]'); click('[data-act=kselect]');
      await text('TCND'); click('[data-delivery="1"]');
    } else {
      for (const l of c.lines) {
        if (l.floor) {
          await wait(() => find('.fu-delivery.picked')?.textContent === 'Picked', 'Automatic floor scan');
          continue;
        }
        if ((lesson === 'catalogue' || l.tutorialLookup) && !l.shortage) {
          await text('CrashFix'); click('[data-tab=crashfix]');
          field('[data-f=q]',l.item.name);
          await wait(() => find('[data-copy="' + l.item.code + '"]'), 'CrashFix matching product');
          click('[data-copy="' + l.item.code + '"]'); await text('Switch back'); click('[data-tab=fusion]');
        }
        await text(l.item.code);
        field('[data-f=part]',l.item.code); await text('Qty');
        const n = field('[data-f=qty]',l.qty);
        n.dispatchEvent(new KeyboardEvent('keydown',{ key:'Enter',bubbles:true,cancelable:true }));
      }
    }
    if (lesson === 'tour') {
      await text('TCND'); click('[data-delivery="2"]');
      await text('Remove'); click('[data-del="3"]');
    }
    if (lesson === 'catalogue') { await text('Remove'); click('[data-del="1"]'); }
    await text('Pay & Go'); click('[data-go=pay]');
    await text('payment method'); click('[data-act=' + c.pay.how + ']');
    if (lesson === 'kiosk') {
      const drawer = p.till.session().cash;
      click('[data-dr="5000"]'); await text('Too much'); click('[data-act=drstart]');
      while (true) {
        const left = drawer.due - drawer.hand.reduce((n,a) => n+a,0);
        if (!left) break;
        click('[data-dr="' + ShiftTill.DENOMS.find(n=>n<=left) + '"]');
      }
      await text('Give change'); click('[data-act=drgive]');
    }
    await text('Payment accepted'); click('[data-scr=done] [data-act=leave]');
    if (c.order.lines.length !== (lesson === 'tour' ? 2 : 1)) throw Error('Unexpected warehouse pick list after payment');
    if (lesson === 'tour') {
      function hand() { walk(tillPos(s.tills[0]),w.counter.y0-.65); key('Enter'); }
      menu(1); key('Enter');
      for (const next of c.order.lines) {
        shelf(next.loc); key('f');
        if (next.qty === 2) {
          await wait(() => p.scannerFault, 'Practice fault');
          if ($('scQty').textContent !== '1') throw Error('Expected one scanned unit');
          const dock=w.scannerDock; walk(dock.x,w.pc.desk.y0-.42); aim(dock.x,dock.y,dock.z); await interact('Swap scanner');
          await text('Find ' + next.loc.code);
          shelf(next.loc); key('f'); if (!s.full()) throw Error('Replacement lost scanned quantity');
        }
        key('Enter');
      }
      hand();
      await wait(()=>day.customers.length===2,'Kiosk customer');
      const kiosk = day.customers[1];
      await greet(kiosk); await openTill(kiosk.at); await identify(kiosk);
      await text('Kiosk Orders'); click('[data-go=kiosk]');
      click('[data-v=krows] [data-k="' + kiosk.kiosk.mine + '"]'); click('[data-act=kselect]');
      await text('Pay & Go'); click('[data-go=pay]');
      await text('payment method'); click('[data-act=card]');
      await text('Payment accepted'); click('[data-scr=done] [data-act=leave]');
      menu(1); key('Enter'); shelf(p.activeLine().loc); key('f'); key('Enter'); hand();
      const pc=w.pc; walk(pc.x,pc.desk.y0-.48); aim(pc.x,pc.y,1.05); await interact('Use PC');
      await text('Open Upgrades'); click('[data-pc=shop]'); await text('100 practice XP'); click('[data-training=cust]');
      await text('Close the Manager PC'); click('.ws-pc-x');
      await text('CCTV');
      const cam=w.objects.find(o=>o.kind==='cctv'), cy=mid(cam.y0,cam.y1);
      walk(cam.x0-.85,cy);
      if (day.customers.length !== 2) throw Error('Collection customer arrived before looking at CCTV');
      aim(cam.x0,cy,(cam.z0+cam.z1)/2); await text('walking in on CCTV');
      await wait(()=>day.customers.length===3,'Collection customer'); await greet(day.customers[2]);
      menu(1); key('Enter'); await text('Collect the bag');
      const code=p.order().hold.code, sp=w.holding.spots.find(v=>v.code===code), y=mid(sp.y0,sp.y1);
      walk(sp.x1+.75,y); aim(sp.x1,y,mid(sp.z0,sp.z1)); key('f'); hand();
      await text('Main Menu');
      menu(0); await text('Goods in');
      const carton=day.delivery[0], g=w.goodsin[carton.src];
      walk(g.stand.x,g.stand.y); aim(g.x,mid(g.obj.y0,g.obj.y1),0.7); key('f'); await text('kick stool');
      const stool=w.stools.find(v=>v.area==='AAB'); walk(stool.x-.65,stool.y); aim(stool.x,stool.y,.25); await interact('Take stool');
      const look=shelf(carton.loc); await text('use Step'); key('KeyV');
      for (let i=0;i<30;i++) p.update(.04,performance.now());
      look(); key('f'); await text('whole carton'); key('Enter');
      await text('Main Menu'); menu(2); key('Enter');
      const low=p.activeLine().loc, lowLook=shelf(low); await text('Squat'); key('KeyC');
      for (let i=0;i<25;i++) p.update(.04,performance.now());
      lowLook(); key('f'); key('Enter'); await text('Restock');
      const f=w.replenShelf, fy=mid(f.y0,f.y1);
      walk(f.x0-.7,fy); aim(f.x0,fy,1.2); await interact('Restock shelf');
      await text('Lock door');
      const door=w.openings.find(o=>o.type==='entrance'), x=mid(door.from,door.to);
      walk(x,w.D-.95); aim(x,w.D-.4,1.2); await interact('Lock door');
      if (!day.over || !carton.done || day.orders.some(o=>o.status!=='done')) throw Error('Unfinished work at lock-up');
    }
  }
  await wait(()=>!$('lessonEnd').hidden,'Training complete');
  if (JSON.stringify(before)!==JSON.stringify(Object.entries(localStorage).filter(([k])=>k.startsWith('ws-')).sort())) throw Error('Tutorial changed the saved career');
  return $('lessonResult').textContent;
};
