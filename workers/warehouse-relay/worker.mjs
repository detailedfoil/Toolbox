import { DurableObject } from 'cloudflare:workers';

const CODE = /^\/room\/([A-HJ-NP-Z2-9]{6})$/;
const GRACE = 30_000;
const HOST = 1;
const VERSION = '1';
const players = [1, 2, 3, 4];
const send = (ws, data) => { try { ws.send(JSON.stringify(data)); } catch { /* close event follows */ } };

export default {
  fetch(request, env) {
    const url = new URL(request.url), match = CODE.exec(url.pathname);
    if (!match) return new Response('Unknown room route', { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (request.headers.get('Origin') !== env.GAME_ORIGIN) return new Response('Unexpected game origin', { status: 403 });
    return env.ROOMS.getByName(match[1]).fetch(request);
  }
};

// A sleeping room keeps only its membership and deadlines in storage. Gameplay never runs here.
export class WarehouseRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    ctx.blockConcurrencyWhile(async () => { this.room = await ctx.storage.get('room'); });
  }
  sockets(slot) {
    return this.ctx.getWebSockets(slot ? 'p' + slot : undefined).filter(ws => ws.readyState === 1);
  }
  roster() {
    const slots = this.sockets().map(ws => ws.deserializeAttachment().slot);
    for (const ws of this.sockets()) send(ws, { type: 'roster', slots });
  }
  async save() {
    await this.ctx.storage.put('room', this.room);
    const deadlines = Object.values(this.room.seats).map(s => s.until).filter(Boolean);
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.min(...deadlines));
    else await this.ctx.storage.deleteAlarm();
  }
  async end() {
    for (const ws of this.sockets()) {
      send(ws, { type: 'ended', reason: 'The host left. This shift has ended.' });
      ws.close(4000, 'The host left. This shift has ended.');
    }
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
  async expire() {
    if (!this.room) return;
    const now = Date.now(), { seats } = this.room;
    if (seats[HOST].until && seats[HOST].until <= now) return this.end();
    let changed = false;
    for (const i of players.slice(1)) if (seats[i]?.until && seats[i].until <= now) { delete seats[i]; changed = true; }
    if (changed) await this.save();
  }
  async alarm() { await this.expire(); if (this.room) await this.save(); }
  async fetch(request) {
    // Serialise admission, including storage awaits, so simultaneous joins cannot claim the same seat.
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.expire();
      const params = new URL(request.url).searchParams;
      const mode = params.get('mode'), build = params.get('build');
      const pair = new WebSocketPair(), [client, server] = Object.values(pair);
      const protocol = request.headers.get('Sec-WebSocket-Protocol');
      const headers = mode === 'resume' && /^[a-f0-9-]{36}$/.test(protocol || '') ? { 'Sec-WebSocket-Protocol': protocol } : {};
      const reply = () => new Response(null, { status: 101, webSocket: client, headers });
      const reject = reason => { server.accept(); server.close(4003, reason); return reply(); };
      if (params.get('v') !== VERSION || !/^[0-9a-f]{1,16}$/.test(build || '')) return reject('Update the game and try again.');
      if (mode === 'create' && this.room) return reject('Room code in use. Try hosting again.');
      if (mode !== 'create' && !this.room) return reject('Room not found or expired.');
      if (this.room && this.room.build !== build) return reject('Game versions differ. Check for updates on both devices.');
      let slot;
      if (mode === 'create') { this.room = { build, seats: {} }; slot = HOST; }
      else if (mode === 'join') {
        if (!this.sockets(HOST).length) return reject('The host is reconnecting.');
        slot = players.slice(1).find(i => !this.room.seats[i]);
        if (!slot) return reject('Room full. Four players can share a shift.');
      } else if (mode === 'resume') {
        // The resume secret is supplied as a WebSocket subprotocol, outside the URL.
        const token = request.headers.get('Sec-WebSocket-Protocol');
        slot = players.find(i => this.room.seats[i]?.token === token);
        if (!slot) return reject('Your seat has expired. Rejoin with the room code.');
        for (const old of this.sockets(slot)) old.close(4001, 'Connection replaced');
      } else return reject('Unknown room operation.');
      const token = this.room.seats[slot]?.token || crypto.randomUUID();
      const connection = crypto.randomUUID();
      this.room.seats[slot] = { token, connection, until: 0 };
      this.ctx.acceptWebSocket(server, ['p' + slot]);
      server.serializeAttachment({ slot, connection, since: Date.now(), count: 0 });
      await this.save();
      send(server, { type: 'welcome', slot, token });
      this.roster();
      return reply();
    });
  }
  webSocketMessage(ws, raw) {
    const a = ws.deserializeAttachment(), host = a.slot === HOST;
    if (this.room?.seats[a.slot]?.connection !== a.connection) return;
    if (typeof raw !== 'string' || raw.length > (host ? 196608 : 2048)) return ws.close(4008, 'Message too large');
    const now = Date.now();
    if (now - a.since >= 1000) { a.since = now; a.count = 0; }
    if (++a.count > (host ? 100 : 30)) return ws.close(4008, 'Message rate exceeded');
    ws.serializeAttachment(a);
    let m;
    try { m = JSON.parse(raw); } catch { return ws.close(4008, 'Invalid message'); }
    if (!m || typeof m !== 'object') return ws.close(4008, 'Invalid message');
    if (m.type === 'leave') {
      if (host) return this.ctx.blockConcurrencyWhile(() => this.end());
      return this.ctx.blockConcurrencyWhile(async () => {
        delete this.room.seats[a.slot];
        ws.close(4000, 'You left the room');
        await this.save();
        this.roster();
      });
    }
    if (host) {
      if (!['init', 'state', 'frame', 'ack'].includes(m.type)) return;
      if (m.to != null && ![2, 3, 4].includes(m.to)) return;
      for (const peer of this.sockets(m.to)) if (peer !== ws) {
        try { peer.send(raw); } catch { /* a closing guest must not interrupt fan-out */ }
      }
    } else if (['sync', 'pose', 'act'].includes(m.type)) {
      // Sender identity comes exclusively from the socket attachment.
      for (const peer of this.sockets(HOST)) send(peer, { ...m, from: a.slot });
    }
  }
  async webSocketClose(ws, code) {
    try { ws.close(1000, 'Disconnected'); } catch { /* already closed */ }
    await this.ctx.blockConcurrencyWhile(async () => {
      const a = ws.deserializeAttachment(), seat = this.room?.seats[a.slot];
      if (!seat || seat.connection !== a.connection) return;
      if (code === 4000 && a.slot !== HOST) delete this.room.seats[a.slot];
      else seat.until = Date.now() + GRACE;
      await this.save();
      this.roster();
    });
  }
  webSocketError(ws) { return this.webSocketClose(ws, 1006); }
}
