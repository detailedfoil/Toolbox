/* Connect the browser relay to Warehouse Shift's existing scene, scanner and till. */
(function (root) {
  'use strict';
  function attach(g) {
    const { $, world, Day, S, p, tills, crew } = g;
    const wire = root.ShiftOnlineDay, items = new Map(world.items.map(it => [it.code, it]));
    const stockItems = new Set();
    const peers = new Map(), models = new Map(), locks = new Map(), progress = new Map();
    let net, replica, mirroredSam, epoch, started = false, roomSize = 0;
    let openShelves = new Set(), lastBell = 0;
    function shelves() {
      const open = new Set();
      const add = sku => {
        const it = items.get(sku);
        if (it?.loc) open.add(S.trayOf(it.loc) || it);
      };
      for (const peer of peers.values()) add(peer.shelf);
      if (guest() && mirroredSam?.fig.group.visible) add(mirroredSam.openSku);
      const toggle = (shelf, on) => {
        if (items.has(shelf.code)) { shelf.netPull = on ? 0.09 : 0; g.pulling.add(shelf); }
        else shelf.netOpen = on;
      };
      for (const shelf of open) if (!openShelves.has(shelf)) toggle(shelf, true);
      for (const shelf of openShelves) if (!open.has(shelf)) toggle(shelf, false);
      openShelves = open;
    }
    const guest = () => !!net && net.slot > 1;
    const pose = () => ({ x: p.me.x, y: p.me.y, yaw: p.me.yaw + Math.PI, speed: p.me.speed, squat: p.me.squat,
      name: p.name, shoes: g.kit.shoes.owned, label: g.kit.label.owned, step: !!p.me.step, atTill: p.tillOpen(), shelf: p.shelf() });
    function peerPose(slot, data) {
      if (!Number.isInteger(slot) || slot < 1 || slot > 4 || slot === net.slot || !data) return false;
      if (![data.x, data.y, data.yaw, data.speed].every(Number.isFinite) || data.x < 0 || data.x > world.W || data.y < 0 || data.y > world.D || g.blocked(data.x, data.y)) return false;
      if (!guest() && crew.length) {
        const aisle = g.aisleAt(crew[0].x, crew[0].y);
        if (aisle && g.aisleAt(data.x, data.y) === aisle) {
          const previous = peers.get(slot);
          const safe = previous || { ...world.start, speed: 0, name: 'Player ' + slot };
          peers.set(slot, { ...safe, corrected: true });
          return false;
        }
      }
      const name = typeof data.name === 'string' && g.cleanName(data.name.slice(0, 32)) || 'Player ' + slot;
      const who = 'p' + slot, stool = world.stools.find(s => s.by === who);
      peers.set(slot, { name, shoes: data.shoes === true, label: data.label === true,
        step: (!!stool || data.shoes === true) && !!data.step,
        atTill: locks.has(who) && !!data.atTill, x: data.x, y: data.y, yaw: data.yaw % (2 * Math.PI), speed: Math.max(0, Math.min(3.2, data.speed)), squat: !!data.squat, shelf: items.has(data.shelf) ? data.shelf : null });
      return true;
    }
    function release(slot, freshSeat = false) {
      const who = 'p' + slot;
      locks.delete(who); progress.delete(who); peers.delete(slot);
      if (freshSeat) {
        g.missingScanners.delete(who);
        g.day()?.offlineScanners.delete(who);
        g.day()?.contributors.delete(who);
      }
      const stool = world.stools.find(s => s.by === who);
      if (stool) { stool.by = null; S.setStool(stool.id, stool.home.x, stool.home.y); }
      if (g.day()) wire.release(g.day(), who);
    }
    function frame() {
      const b = crew[0];
      const speech = key => {
        const msg = g.speeches.get(key);
        return msg && (msg.waiting || msg.until > performance.now()) ? { id: msg.until, line: msg.line, waiting: msg.waiting } : null;
      };
      return {
        epoch: g.epoch(), t: g.day().t, people: [[1, pose()], ...peers],
        sam: b && Object.fromEntries(['x', 'y', 'yaw', 'speed', 'turning', 'walking', 'kneeling', 'bending', 'giving', 'typing', 'reading', 'atTill', 'aim', 'beam', 'beamTo', 'carry', 'toteDown'].map(k => [k, b[k]])),
        trolleyItems: b?.items || [], samSpeech: speech(b), openSku: b?.openSku,
        trolley: b && { x: b.trolley.x, y: b.trolley.y, phi: b.trolley.phi },
        customers: g.figs.filter(f => !f.free).map(f => {
          const m = f.group, parts = f.parts;
          const spot = f.c.spot;
          return { id: f.c.id, spot: spot?.queue ? 'queue' : spot?.wait ? 'wait' : spot?.till ? 'till' : null, x: m.position.x, y: m.position.z, yaw: m.rotation.y, step: parts.legL.rotation.x, carry: f.carry, receipt: !!f.holdR,
            counterTote: f.counterTote && [f.counterTote.position.x, f.counterTote.position.y, f.counterTote.position.z],
            speech: speech(f), scale: m.scale.x, colours: [parts.body, parts.legsM, parts.stripe, parts.skin, parts.hair].map(mat => mat.color.getHex()) };
        })
      };
    }
    function snapshot() {
      return { epoch: g.epoch(), offlineScanners: [...g.day().offlineScanners], missingScanners: [...g.missingScanners], bell: g.bellCount(), bellTillTrained: g.bellTillTrained(), day: wire.snapshot(g.day(), tills, stockItems), locks: [...locks], stools: world.stools.map(s => s.by), screens: tills.map(t => g.screenOf(t)?.id || null) };
    }
    function apply(s, reset) {
      const newDay = epoch !== s.epoch;
      const oldHold = reset ? {} : replica.hold, over = !reset && replica.over;
      const before = reset ? null : new Map(replica.orders.map(o => [o.id, o.status]));
      if (reset) {
        p.resetOnline(); g.clearDayView();
        replica = new wire.DayProxy(world, Day.Day, tills, (op, args) => net.request(op, args), g.World, S.stockChange);
        if (newDay && started) g.resetStats();
      }
      epoch = s.epoch; replica.apply(s.day); g.setDay(replica, epoch);
      locks.clear(); for (const [who, index] of s.locks) locks.set(who, index);
      world.stools.forEach((stool, i) => {
        const by = s.stools[i];
        if (stool.by !== by) S.setStool(stool.id, stool.home.x, stool.home.y);
        stool.by = by;
      });
      p.syncStool(world.stools.find(stool => stool.by === p.id) || null);
      for (const [code, parcel] of Object.entries(replica.hold)) if (reset || oldHold[code]?.num !== parcel?.num) S.hold.set(code, parcel);
      S.delivery.set(replica.delivery);
      tills.forEach((t, i) => { const o = replica.orders.find(o => o.id === s.screens[i]); if (g.screenOf(t) !== (o || null)) g.screen(t, o); });
      if (reset) p.newDay();
      else for (const o of replica.orders) {
        if (!before.has(o.id) && o.status === 'listed') p.listed(o);
        else if (before.get(o.id) !== o.status || p.order() === o) p.changed(o);
      }
      p.render(); p.queueChanged();
      if (!reset && s.bell !== lastBell) g.showBell(s.bellTillTrained);
      lastBell = s.bell;
      p.syncScanner(s.missingScanners.includes(p.id), s.offlineScanners.includes(p.id));
      if (newDay && started) g.announceDayEvent();
      if (!over && replica.over) g.dayOver();
      g.dirty();
    }
    function draw(f) {
      if (f.epoch !== epoch) return;
      replica.t = f.t;
      const slots = new Set(f.people.map(([slot]) => slot));
      for (const slot of peers.keys()) if (!slots.has(slot)) peers.delete(slot);
      for (const [slot, data] of f.people) {
        if (slot === net.slot && data.corrected && f.sam) {
          const aisle = g.aisleAt(f.sam.x, f.sam.y);
          if (aisle && g.aisleAt(p.me.x, p.me.y) === aisle) { p.me.x = data.x; p.me.y = data.y; p.applyCam(); }
        }
        peerPose(slot, data);
      }
      if (f.sam && !mirroredSam) {
        const fig = S.makeWorker(g.sam); fig.trolley = S.makeTrolley();
        mirroredSam = { name: 'Sam', fig, r: 0.24 };
      }
      if (mirroredSam) {
        mirroredSam.fig.group.visible = mirroredSam.fig.trolley.group.visible = !!f.sam;
        if (f.sam) {
          Object.assign(mirroredSam, f.sam, { trolley: f.trolley, openSku: f.openSku });
          const key = f.trolleyItems.join(',');
          if (key !== mirroredSam.trolleyKey) {
            const trolley = mirroredSam.fig.trolley;
            S.trolleyTop(trolley, null);
            for (const colour of f.trolleyItems) S.trolleyTop(trolley, colour);
            mirroredSam.trolleyKey = key;
          }
          const order = replica.orders.find(o => o.by === 'Sam' && o.status === 'picked');
          syncLoad(mirroredSam.fig, f.sam.carry, order);
          if (f.samSpeech && mirroredSam.speechId !== f.samSpeech.id) {
            mirroredSam.speechId = f.samSpeech.id; g.speakCrew(mirroredSam, f.samSpeech.line);
          }
        }
        else mirroredSam.fig.beam.visible = false;
      }
      const present = new Set();
      for (const row of f.customers) {
        const c = replica.customers.find(c => c.id === row.id);
        if (!c) continue;
        const fig = c.fig || g.figFor(c), parts = fig.parts;
        c.spot = row.spot ? { [row.spot]: true } : null;
        present.add(fig);
        fig.group.position.set(row.x, 0, row.y); fig.group.rotation.y = row.yaw; fig.group.scale.setScalar(row.scale);
        [parts.body, parts.legsM, parts.stripe, parts.skin, parts.hair].forEach((mat, i) => mat.color.setHex(row.colours[i]));
        parts.legL.rotation.x = row.step; parts.legR.rotation.x = -row.step;
        parts.armL.rotation.x = -row.step; parts.armR.rotation.x = row.carry ? -1 : row.step;
        if (parts.receipt) parts.receipt.visible = row.receipt;
        if (row.speech && fig.speechId !== row.speech.id) { fig.speechId = row.speech.id; g.speakFig(c, row.speech.line, row.speech.waiting); }
        if (!row.speech && g.speeches.get(fig)?.waiting) g.speeches.delete(fig);
        if (row.counterTote) {
          fig.counterTote ||= orderLoad(c.order);
          fig.counterTote.position.set(...row.counterTote);
        } else if (row.carry && !fig.tote) {
          fig.tote = fig.counterTote || orderLoad(c.order); fig.counterTote = null;
          fig.group.add(fig.tote); fig.tote.position.set(0, 0.95, 0.32);
          fig.tote.rotation.set(0, 0, 0); fig.tote.scale.setScalar(1 / row.scale);
        } else if (!row.carry && fig.tote) { S.dropTote(fig.tote); fig.tote = null; }
      }
      for (const fig of g.figs) if (!fig.free && !present.has(fig)) g.freeFig(fig);
      p.remoteTill(); g.dirty();
    }
    function orderLoad(order) {
      if (order?.hold) return S.hold.carry(order.hold.code, order.hold.parcel);
      return S.makeTote(order?.lines.map(l => l.item.colour) || []);
    }
    function syncLoad(fig, kind, order) {
      const key = kind ? kind + ':' + (order?.id || 0) : '';
      if (fig.loadKey === key) return;
      fig.loadKey = key;
      if (fig.held) { S.dropTote(fig.held); fig.held = null; }
      if (!kind) return;
      fig.held = order?.hold || kind === 'tote' ? orderLoad(order) : g.makeCarton();
      fig.carry.add(fig.held); fig.held.position.set(0, 0, 0);
    }
    function animate(dt) {
      if (!net?.slot) return false;
      shelves();
      for (const [slot, fig] of models) if (!peers.has(slot)) fig.group.visible = false;
      for (const [slot, data] of peers) {
        let fig = models.get(slot);
        if (!fig) { fig = S.makeWorker({ name: data.name, skin: [0, 0xf1c9a5, 0xc68b62, 0x8d5a3b, 0xe0b394][slot] }); fig.badgeName = data.name; models.set(slot, fig); }
        if (fig.badgeName !== data.name) { S.setBadge(fig, data.name); fig.badgeName = data.name; }
        const from = fig.group.position, k = !fig.group.visible || !fig.placed ? 1 : Math.min(1, dt * 15);
        fig.group.visible = fig.placed = true;
        const yaw = fig.group.rotation.y, d = data.yaw - yaw;
        const who = 'p' + slot, day = g.day();
        const order = day.orders.find(o => o.by === who && o.status === 'picked');
        const carry = order ? (order.hold ? 'bag' : 'tote') : day.delivery.some(d => d.by === who && !d.done) ? 'box' : null;
        syncLoad(fig, carry, order);
        S.poseWorker(fig, { x: from.x + (data.x - from.x) * k, y: from.z + (data.y - from.z) * k,
          yaw: yaw + Math.atan2(Math.sin(d), Math.cos(d)) * k, speed: data.speed, turning: 0, kneeling: data.squat,
          walking: data.speed > 0.15, carry, atTill: data.atTill }, dt);
        fig.group.position.y = data.step ? g.stepHeight : 0;
        const stool = world.stools.find(s => s.by === 'p' + slot);
        if (stool) g.poseStool(stool, from.x, from.z, fig.group.rotation.y - Math.PI, data.step);
      }
      if (guest() && mirroredSam?.fig.group.visible) { S.poseWorker(mirroredSam.fig, mirroredSam, dt); S.poseTrolley(mirroredSam.fig.trolley, mirroredSam); }
      return peers.size > 0 || !!mirroredSam?.fig.group.visible;
    }

    function occupied(t, who) { return [...locks].some(([id, index]) => id !== who && tills[index] === t); }
    function open(who, index, pos) {
      const t = tills[index];
      if (g.day().customers.some(c => c.state === 'serving' && c.by === who && c.at !== t)) return false;
      if (!t || t === g.sam.till || occupied(t, who) || Math.hypot(pos.x - (t.x0 + t.x1) / 2, pos.y - t.y0) > 2.7 || pos.y > world.counter.y0 + 0.05) return false;
      locks.set(who, index); return true;
    }
    function action(slot, op, args) {
      const who = 'p' + slot, pos = peers.get(slot), day = g.day(), till = () => tills[locks.get(who)];
      if (op === 'swapScanner') return day.swapScanner(who, pos);
      if ((day.offlineScanners.has(who) || g.missingScanners.has(who)) && ['take', 'line', 'restock', 'fetch', 'putAway', 'handOver', 'paTake', 'paPut'].includes(op)) return false;
      if (op === 'takeStool' || op === 'dropStool') {
        const stool = world.stools.find(s => s.id === args.id);
        if (!stool) return false;
        if (op === 'takeStool') {
          if (stool.by || world.stools.some(s => s.by === who) || Math.hypot(pos.x - stool.home.x, pos.y - stool.home.y) > 2) return false;
          stool.by = who;
        } else {
          if (stool.by !== who) return false;
          stool.by = null; pos.step = false; S.setStool(stool.id, stool.home.x, stool.home.y);
        }
        return true;
      }
      return wire.command(day, who, op, args, {
        needsStep: g.needsStep,
        pose: pos, progress, items, screen: g.screen, doorX: g.doorX, till,
        canGreet: () => pos.y < world.counter.y0 + 0.05 && pos.y > world.counter.y0 - 1.75 &&
          tills.some(t => Math.abs((t.x0 + t.x1) / 2 - pos.x) < 1.6),
        give(o) { const tote = orderLoad(o); if (o.cust?.fig) g.give(o.cust, tote, g.handX(pos.x)); else S.dropTote(tote); },
        open(i) {
          return Number.isInteger(i) && open(who, i, pos);
        },
        close() { locks.delete(who); const c = day.customers.find(c => c.by === who && c.state === 'serving'); if (c) day.unserve(c); return true; },
        call() {
          const t = till(); if (!t || day.customers.some(c => c.by === who)) return false;
          const c = g.claimAtTill(t, who); if (!c) return false;
          g.screen(t, null); g.callTo(c, t, () => g.checkScannerMixup(c, who)); return true;
        },
        bell: () => g.ringBell(who)
      });
    }
    const panel = $('onlineCover'), message = $('roomMessage'), controls = $('roomControls'), roomBtn = $('roomBtn');
    const show = msg => { message.textContent = msg; };
    let lastStatus;
    function status(msg) {
      if (msg === lastStatus) return;
      lastStatus = msg;
      if (msg) {
        p.keysClear(); if (document.pointerLockElement) document.exitPointerLock();
        panel.hidden = false; controls.hidden = true; show(msg);
      } else panel.hidden = true;
    }
    function start() {
      if (started) return;
      started = true; g.begin(); roomBtn.textContent = net.room + ' · ' + (roomSize || 1) + '/4'; roomBtn.hidden = false; $('leaveRoom').hidden = false;
    }
    function connect(mode) {
      const endpoint = root.ShiftOnline.endpoint(), input = $('roomCode').value.trim().toUpperCase();
      if (net && !net.ended) return;
      if (!endpoint) return show('The relay has not been configured for this game yet.');
      if (mode === 'join' && !/^[A-HJ-NP-Z2-9]{6}$/.test(input)) return show('Enter the six-character room code from the host.');
      const scripts = [...document.scripts].filter(s => /warehouse-shift\//.test(s.src)).map(s => s.getAttribute('src'));
      const build = g.hash(scripts.join('|') + '|' + g.catalogue).toString(16);
      net = new root.ShiftOnline.Session(endpoint, build, {
        welcome(slot) {
          p.id = 'p' + slot;
          if (slot === 1) { g.ensureLocal(); start(); }
          else if (!started) { p.me.x += (slot - 1) * 0.52; if (g.blocked(p.me.x, p.me.y)) p.me.x = world.start.x; p.applyCam(); }
        },
        roster(slots) { roomSize = slots.length; roomBtn.textContent = net.room + ' · ' + roomSize + '/4'; },
        status, started: start, epoch: g.epoch, snapshot, apply, draw, frame, pose, peerPose, action, release,
        ended(reason) {
          status(reason); $('leaveRoom').hidden = true; controls.hidden = started; $('roomBack').hidden = false;
          $('roomBack').textContent = started ? 'Return to title' : 'Back';
          if (!started) net = null;
        }
      });
      $('roomBack').hidden = false; status('Connecting…'); net.connect(mode, mode === 'join' ? input : null);
    }
    $('onlineBtn').hidden = false;
    $('onlineBtn').onclick = () => { $('startCover').hidden = true; panel.hidden = false; controls.hidden = false; show('Share one shift with up to three other players. Keep the host’s game tab open.'); };
    $('hostRoom').onclick = () => connect('create'); $('joinRoom').onclick = () => connect('join');
    $('roomCode').addEventListener('keydown', e => { if (e.key === 'Enter') connect('join'); });
    $('roomBack').onclick = () => {
      if (started && !net?.ended && net?.ready && !net.paused && net.hostPresent) { panel.hidden = true; return; }
      if (net && !net.ended) net.leave();
      if (started) { location.reload(); return; }
      net = null; lastStatus = null; panel.hidden = true; $('startCover').hidden = false;
    };
    roomBtn.onclick = () => {
      if (document.pointerLockElement) document.exitPointerLock();
      controls.hidden = true; panel.hidden = false;
      show('Room ' + net.room + ' · ' + roomSize + '/4 players. ' + (net.host ? 'You are hosting this shift.' : 'You are Player ' + net.slot + '.'));
    };
    $('leaveRoom').onclick = () => { if (net && !net.ended) net.leave(); location.reload(); };
    document.addEventListener('visibilitychange', () => net?.visibility());
    return {
      releaseWork: who => wire.release(g.day(), who), trackStock: item => stockItems.add(item), guest, peers, occupied, tillFor: who => tills[locks.get(who)], room: () => net, animate, sam: () => mirroredSam?.fig.group.visible ? mirroredSam : null,
      frozen: () => !!net && (!net.ready || net.paused), panel: () => !panel.hidden,
      open: t => guest() ? net.request('tillOpen', { till: tills.indexOf(t) }) : open(p.id, tills.indexOf(t), p.me),
      close: () => guest() ? net.request('tillClose', {}) : locks.delete(p.id),
      swapScanner: () => net.request('swapScanner', {}),
      stool: (op, id) => net.request(op, { id }),
      call: () => net.request('call', {}), bell: () => net.request('bell', {}), tick: now => net?.tick(now)
    };
  }
  root.ShiftOnlineGame = { attach };
})(window);
