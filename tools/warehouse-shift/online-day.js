/* Wire format for the shared shift. Never serialise a scene object or the warehouse graph. */
(function (root) {
  'use strict';
  const fields = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  const parcel = p => p && fields(p, ['surname', 'num', 'collection', 'despatch', 'locs', 'units']);
  const lines = ls => (ls || []).map(l => ({
    ...fields(l, ['qty', 'kind', 'accept', 'say', 'quote', 'hint', 'clue', 'qtySay', 'next']), sku: l.item.code
  }));
  function snapshot(day, tills) {
    return {
      ...fields(day, ['phase', 'total', 'done', 'over', 'mode']),
      hold: Object.fromEntries(Object.entries(day.hold).map(([k, p]) => [k, parcel(p)])), busy: { ...day.busy },
      orders: day.orders.map(o => ({
        ...fields(o, ['id', 'no', 'kind', 'status', 'by', 'doneBy', 'counts', 'locs', 'units', 'surname', 'code']),
        customer: o.cust?.id, lines: lines(o.lines), hold: o.hold && { code: o.hold.code, parcel: parcel(o.hold.parcel) }
      })),
      customers: day.customers.filter(c => c.state !== 'gone').map(c => ({
        ...fields(c, ['id', 'kind', 'state', 'by', 'ready', 'say', 'pay', 'surname', 'code']),
        accounts: c.cust?.db.map(({ db, ...account }) => account),
        orderId: c.order?.id, at: tills.indexOf(c.at), lines: lines(c.lines),
        kiosk: c.kiosk && { ...c.kiosk, list: c.kiosk.list.map(k => ({ ...k, lines: lines(k.lines) })) }
      })),
      delivery: day.delivery.map(d => ({ ...fields(d, ['id', 'src', 'slot', 'qty', 'by', 'done', 'doneBy']), sku: d.item.code }))
    };
  }

  class DayProxy {
    constructor(world, Day, tills, request) {
      this.items = new Map(world.items.map(it => [it.code, it]));
      this.tills = tills;
      this.request = request;
      this.hold = {}; this.busy = {}; this.orders = []; this.customers = []; this.delivery = []; this.t = 0;
      for (const name of ['list', 'queue', 'label', 'freeSpots', 'ungreeted', 'deliveryLeft', 'summary']) this[name] = Day.prototype[name];
    }
    apply(s) {
      const unpack = ls => ls.map(l => { const item = this.items.get(l.sku); return { ...l, item, loc: item.loc }; });
      // Scanner, till session and customer figure all keep references across updates.
      const merge = (old, next, decode) => {
        const prev = new Map(old.map(o => [o.id, o]));
        return next.map(row => Object.assign(prev.get(row.id) || {}, decode(row)));
      };
      Object.assign(this, fields(s, ['phase', 'total', 'done', 'over', 'mode', 'hold', 'busy']));
      this.orders = merge(this.orders, s.orders, row => ({ ...row, lines: unpack(row.lines) }));
      this.customers = merge(this.customers, s.customers, row => ({
        ...row, cust: row.accounts && Object.assign(row.accounts[0], { db: row.accounts }), at: this.tills[row.at], order: this.orders.find(o => o.id === row.orderId),
        lines: unpack(row.lines), kiosk: row.kiosk && { ...row.kiosk, list: row.kiosk.list.map(k => ({ ...k, lines: unpack(k.lines) })) }
      }));
      for (const o of this.orders) o.cust = this.customers.find(c => c.id === o.customer) || null;
      this.delivery = merge(this.delivery, s.delivery, row => { const item = this.items.get(row.sku); return { ...row, item, loc: item.loc }; });
    }
    take(o) { return this.request('take', { id: o.id }); }
    line(o, index) { return this.request('line', { id: o.id, index }); }
    fetch(o) { return this.request('fetch', { id: o.id }); }
    putAway(o, code) { return this.request('putAway', { id: o.id, code }); }
    handOver(o) { return this.request('handOver', { id: o.id }); }
    paTake(src) { return this.request('paTake', { src }).then(id => this.delivery.find(d => d.id === id)); }
    paPut(d) { return this.request('paPut', { id: d.id }); }
    greet(c) { return this.request('greet', { id: c.id }); }
    lock() { return this.request('lock', {}); }
    tillDone(c, ls) { return this.request('tillDone', { id: c.id, lines: lines(ls) }).then(id => this.orders.find(o => o.id === id)); }
  }

  // One dispatcher in the host browser. A connection may act only on its own unfinished work.
  function command(day, who, op, a, ctx) {
    const o = day.orders.find(o => o.id === a.id);
    const own = o && o.by === who;
    const c = day.customers.find(c => c.id === a.id);
    const holding = () => day.orders.some(o => o.by === who && o.status !== 'done') || day.delivery.some(d => d.by === who && !d.done);
    const near = (x, y, r) => Math.hypot(ctx.pose.x - x, ctx.pose.y - y) <= r;
    const atLoc = loc => near((loc.x0 + loc.x1) / 2, loc.face.front, 3.6) && (loc.z0 >= 0.45 || ctx.pose.squat);
    const atSpot = code => { const sp = day.world.holding.spots.find(s => s.code === code); return sp && near(sp.x1, (sp.y0 + sp.y1) / 2, 3.6); };
    switch (op) {
      case 'take':
        if (holding() || !day.take(o, who)) return false;
        ctx.progress.set(who, 0); return true;
      case 'line': {
        if (!own || o.status !== 'taken' || !Number.isInteger(a.index) || a.index !== ctx.progress.get(who)) return false;
        const ln = o.lines[a.index];
        if (!ln || !atLoc(ln.loc)) return false;
        ctx.progress.set(who, a.index + 1);
        if (a.index + 1 === o.lines.length) day.picked(o);
        return true;
      }
      case 'fetch': return !!(own && o.status === 'taken' && o.kind === 'hold' && atSpot(o.hold.code) && day.fetch(o));
      case 'putAway': {
        if (!own || o.status !== 'picked' || o.kind !== 'c' || o.cust || !atSpot(a.code)) return false;
        return parcel(day.putAway(o, a.code, who));
      }
      case 'handOver': {
        const h = day.world.handover, p = ctx.pose;
        if (!own || o.status !== 'picked' || !o.cust || p.x < h.x0 || p.x > h.x1 || p.y < h.y0 || p.y > h.y1 + 0.08) return false;
        ctx.give(o); return day.handOver(o, who);
      }
      case 'paTake': {
        const g = Number.isInteger(a.src) && day.world.goodsin[a.src];
        if (holding() || !g || !near(g.stand.x, g.stand.y, 4)) return false;
        return day.paTake(a.src, who)?.id || false;
      }
      case 'paPut': {
        const d = day.delivery.find(d => d.id === a.id);
        return !!(d && atLoc(d.loc) && day.paPut(d, who));
      }
      case 'greet': return !!(c?.fig && near(c.fig.group.position.x, c.fig.group.position.z, 3.5) && day.greet(c, who));
      case 'tillOpen': return ctx.open(a.till);
      case 'tillClose': return ctx.close();
      case 'call': return ctx.call();
      case 'tillDone': {
        if (!c || c.by !== who || c.state !== 'serving' || !c.ready || ctx.till() !== c.at || !Array.isArray(a.lines)) return false;
        const expected = c.kind === 'kiosk' ? c.kiosk.list[c.kiosk.mine].lines : c.lines;
        if (a.lines.length !== expected.length) return false;
        const remaining = expected.slice(), basket = [];
        for (const line of a.lines) {
          if (!line) return false;
          const i = remaining.findIndex(l => l.qty === line.qty && (l.accept || [l.item.code]).includes(line.sku));
          const item = ctx.items.get(line.sku);
          if (i < 0 || !item) return false;
          remaining.splice(i, 1); basket.push({ item, qty: line.qty });
        }
        const result = day.tillDone(c, basket, { till: c.at });
        ctx.screen(c.at, result); return result.id;
      }
      case 'bell': return near(day.world.bell.x, day.world.bell.y, 3) && ctx.bell();
      case 'lock': return near(ctx.doorX, day.world.D - 0.4, 3) && day.lock();
      default: return false;
    }
  }
  const api = { snapshot, DayProxy, command };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShiftOnlineDay = api;
})(typeof window !== 'undefined' ? window : this);
