/* Wire format for the shared shift. Never serialise a scene object or the warehouse graph. */
(function (root) {
  'use strict';
  const fields = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  const parcel = p => p && fields(p, ['surname', 'num', 'collection', 'despatch', 'locs', 'units']);
  const lines = ls => (ls || []).map(l => ({
    ...fields(l, ['qty', 'kind', 'accept', 'say', 'quote', 'hint', 'clue', 'qtySay', 'next', 'shortage', 'reply', 'tcnd', 'floor']), sku: l.item.code, location: l.loc?.code
  }));
  function snapshot(day, tills, stockItems) {
    return {
      ...fields(day, ['phase', 'total', 'done', 'over', 'mode', 'event', 'shiftId', 'baseXP', 'coveredXP']),
      tillCovered: !!day.emit('tillCover')?.length,
      report: day.report || null, eligible: Array.from(day.contributors),
      hold: Object.fromEntries(Object.entries(day.hold).map(([k, p]) => [k, parcel(p)])), busy: { ...day.busy },
      orders: day.orders.map(o => ({
        ...fields(o, ['id', 'no', 'kind', 'status', 'by', 'doneBy', 'counts', 'locs', 'units', 'surname', 'code']),
        customer: o.cust?.id, lines: lines(o.lines), hold: o.hold && { code: o.hold.code, parcel: parcel(o.hold.parcel) }
      })),
      customers: day.customers.filter(c => c.state !== 'gone').map(c => ({
        ...fields(c, ['id', 'kind', 'state', 'here', 'greeter', 'by', 'ready', 'say', 'pay', 'surname', 'code']),
        accounts: c.cust?.db.map(({ db, ...account }) => account),
        orderId: c.order?.id, at: tills.indexOf(c.at), lines: lines(c.lines),
        kiosk: c.kiosk && { ...c.kiosk, list: c.kiosk.list.map(k => ({ ...k, lines: lines(k.lines) })) }
      })),
      stock: Array.from(stockItems, it => [it.code, it.loc?.code || null, it.stock, it.reserved || 0]),
      delivery: day.delivery.map(d => ({ ...fields(d, ['id', 'src', 'slot', 'qty', 'by', 'done', 'doneBy']), sku: d.item.code, location: d.loc.code }))
    };
  }

  class DayProxy {
    constructor(world, Day, tills, request, World, stockChange) {
      this.items = new Map(world.items.map(it => [it.code, it]));
      this.world = world;
      this.World = World;
      this.stockChange = stockChange;
      this.tills = tills;
      this.request = request;
      this.hold = {}; this.busy = {}; this.orders = []; this.customers = []; this.delivery = []; this.t = 0;
      for (const name of ['list', 'queue', 'label', 'freeSpots', 'ungreeted', 'canGreet', 'deliveryLeft', 'summary', 'tillsOpen', 'clockMinute', 'atScannerDock', 'atReplenShelf']) this[name] = Day.prototype[name];
    }
    applyStock(rows) {
      const { world, World } = this;
      const moves = [];
      // Clear old shelves first. Two relocated products can swap places between snapshots.
      for (const [sku, code, stock, reserved] of rows) {
        const item = this.items.get(sku), loc = world.locs.byCode[code] || null;
        if (item.loc !== loc) {
          World.vacate(world, item);
          moves.push({ item, loc, stock, reserved });
        } else {
          item.stock = stock; item.reserved = reserved;
        }
      }
      for (const { item, loc, stock, reserved } of moves) {
        if (loc) World.place(world, item, loc, stock);
        item.reserved = reserved;
        this.stockChange(item);
      }
    }
    apply(s) {
      this.applyStock(s.stock);
      const unpack = ls => ls.map(l => { const item = this.items.get(l.sku); return { ...l, item, loc: this.world.locs.byCode[l.location] || item.loc }; });
      // Scanner, till session and customer figure all keep references across updates.
      const merge = (old, next, decode) => {
        const prev = new Map(old.map(o => [o.id, o]));
        return next.map(row => Object.assign(prev.get(row.id) || {}, decode(row)));
      };
      Object.assign(this, fields(s, ['phase', 'total', 'done', 'over', 'mode', 'event', 'shiftId', 'baseXP', 'coveredXP', 'hold', 'busy', 'report', 'eligible', 'tillCovered']));
      this.orders = merge(this.orders, s.orders, row => ({ ...row, lines: unpack(row.lines) }));
      this.customers = merge(this.customers, s.customers, row => ({
        ...row, cust: row.accounts && Object.assign(row.accounts[0], { db: row.accounts }), at: this.tills[row.at], order: this.orders.find(o => o.id === row.orderId),
        lines: unpack(row.lines), kiosk: row.kiosk && { ...row.kiosk, list: row.kiosk.list.map(k => ({ ...k, lines: unpack(k.lines) })) }
      }));
      for (const o of this.orders) o.cust = this.customers.find(c => c.id === o.customer) || null;
      this.delivery = merge(this.delivery, s.delivery, row => { const item = this.items.get(row.sku); return { ...row, item, loc: this.world.locs.byCode[row.location] }; });
    }
    take(o) { return this.request('take', { id: o.id }); }
    line(o, index) { return this.request('line', { id: o.id, index }); }
    fetch(o) { return this.request('fetch', { id: o.id }); }
    putAway(o, code) { return this.request('putAway', { id: o.id, code }); }
    restock(o) { return this.request('restock', { id: o.id }); }
    handOver(o) { return this.request('handOver', { id: o.id }); }
    paTake(src) { return this.request('paTake', { src }).then(id => this.delivery.find(d => d.id === id)); }
    paPut(d) { return this.request('paPut', { id: d.id }); }
    paReturn(d, src) { return this.request('paReturn', { id: d.id, src }); }
    greet(c) { return this.request('greet', { id: c.id }); }
    lock() { return this.request('lock', {}); }
    tillDone(c, info) { return this.request('tillDone', { id: c.id, lines: lines(info.lines), how: info.how, change: info.change }).then(id => this.orders.find(o => o.id === id)); }
  }

  // A lost connection returns a picked tote to the list. Restore its units and reservations
  // first, so another picker can scan the same shelves without charging stock twice.
  function release(day, who) {
    for (const order of day.orders) {
      if (order.by !== who || order.status !== 'picked') continue;
      for (const { item, loc, qty } of order.lines) {
        if (!item.loc) {
          day.World.place(day.world, item, loc, qty);
          day.emit('stock', item);
        } else item.stock += qty;
        item.reserved = (item.reserved || 0) + qty;
      }
    }
    day.release(who);
  }

  // One dispatcher in the host browser. A connection may act only on its own unfinished work.
  function command(day, who, op, a, ctx) {
    const o = day.orders.find(o => o.id === a.id);
    const own = o && o.by === who;
    const c = day.customers.find(c => c.id === a.id);
    const holding = () => day.orders.some(o => o.by === who && o.status !== 'done') || day.delivery.some(d => d.by === who && !d.done);
    const near = (x, y, r) => Math.hypot(ctx.pose.x - x, ctx.pose.y - y) <= r;
    const atLoc = loc => near((loc.x0 + loc.x1) / 2, loc.face.front, 3.6) && (loc.z0 >= 0.45 || ctx.pose.squat) && (!ctx.needsStep(loc) || ctx.pose.step);
    const atSpot = code => { const sp = day.world.holding.spots.find(s => s.code === code); return sp && near(sp.x1, (sp.y0 + sp.y1) / 2, 3.6); };
    switch (op) {
      case 'take':
        if (holding() || !day.take(o, who)) return false;
        ctx.progress.set(who, 0); return true;
      case 'line': {
        if (!own || o.status !== 'taken' || !Number.isInteger(a.index) || a.index !== ctx.progress.get(who)) return false;
        const ln = o.lines[a.index];
        if (!ln || !atLoc(ln.loc)) return false;
        day.confirmLine(o, a.index, who);
        ctx.progress.set(who, a.index + 1);
        if (a.index + 1 === o.lines.length) day.picked(o);
        return true;
      }
      case 'fetch': {
        if (!own || o.status !== 'taken' || o.kind !== 'hold' || !atSpot(o.hold.code) || !day.fetch(o)) return false;
        // A disconnected guest's parcel can safely go back to its original OC slot.
        day.busy[o.hold.code] = 'fetch:' + o.id;
        return true;
      }
      case 'putAway': {
        if (!own || o.status !== 'picked' || o.kind !== 'c' || o.cust || !atSpot(a.code)) return false;
        return parcel(day.putAway(o, a.code, who));
      }
      case 'restock': return day.restock(o, who, ctx.pose);
      case 'handOver': {
        const h = day.world.handover, p = ctx.pose;
        if (!own || o.status !== 'picked' || !o.cust || p.x < h.x0 || p.x > h.x1 || p.y < h.y0 || p.y > h.y1 + 0.08) return false;
        ctx.give(o);
        const done = day.handOver(o, who);
        if (done && o.hold && day.busy[o.hold.code] === 'fetch:' + o.id) day.busy[o.hold.code] = null;
        return done;
      }
      case 'paTake': {
        const g = Number.isInteger(a.src) && day.world.goodsin[a.src];
        if (holding() || !g || !near(g.stand.x, g.stand.y, 4)) return false;
        return day.paTake(a.src, who)?.id || false;
      }
      case 'paReturn':
        return day.paReturn(day.delivery.find(d => d.id === a.id), who, a.src, ctx.pose);
      case 'paPut': {
        const d = day.delivery.find(d => d.id === a.id);
        return !!(d && atLoc(d.loc) && day.paPut(d, who));
      }
      case 'greet': return !!(c?.fig && ctx.canGreet() && near(c.fig.group.position.x, c.fig.group.position.z, 3.2) && day.greet(c, who));
      case 'tillOpen': return day.tillsOpen() && ctx.open(a.till);
      case 'tillClose': return ctx.close();
      case 'call': return ctx.call();
      case 'tillDone': {
        if (!c || c.by !== who || c.state !== 'serving' || !c.ready || ctx.till() !== c.at || !Array.isArray(a.lines)) return false;
        const requests = c.kind === 'kiosk' ? c.kiosk.list[c.kiosk.mine].lines : c.lines;
        const expected = requests.filter(l => l.shortage !== 'decline');
        if (a.lines.length !== expected.length) return false;
        const remaining = expected.slice(), basket = [];
        for (const line of a.lines) {
          if (!line) return false;
          const i = remaining.findIndex(l => l.qty === line.qty && (l.accept || [l.item.code]).includes(line.sku));
          const item = ctx.items.get(line.sku);
          if (i < 0 || !item || (line.tcnd ?? false) !== (remaining[i].shortage === 'tcnd')) return false;
          remaining.splice(i, 1); basket.push({ item, qty: line.qty, tcnd: line.tcnd });
        }
        if (a.how !== c.pay.how) return false;
        if (a.how === 'cash') {
          const total = basket.reduce((sum, l) => sum + day.Till.price(l.item) * l.qty, 0);
          if (a.change !== day.Till.tender(total, c.pay) - total) return false;
        }
        const result = day.tillDone(c, basket, { till: c.at });
        ctx.screen(c.at, result); return result.id;
      }
      case 'bell': return near(day.world.bell.x, day.world.bell.y, 3) && ctx.bell();
      case 'lock': return near(ctx.doorX, day.world.D - 0.4, 3) && day.lock();
      default: return false;
    }
  }
  const api = { snapshot, DayProxy, command, release };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShiftOnlineDay = api;
})(typeof window !== 'undefined' ? window : this);
