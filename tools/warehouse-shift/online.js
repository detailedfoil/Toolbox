/* Browser transport. Room membership, reconnects and request ordering are independent of rendering. */
(function (root) {
  'use strict';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % alphabet.length]).join('');
  const VERSION = '1';
  const RELAY = 'https://warehouse-shift-relay.detailedfoil.workers.dev';

  class Session {
    constructor(endpoint, build, hooks) {
      this.endpoint = endpoint; this.build = build; this.hooks = hooks;
      this.pending = new Map(); this.peers = new Set(); this.lastAction = new Map();
      this.seq = 0; this.ready = false; this.hostPresent = false; this.time = 0; this.stateTime = 0;
    }
    connect(mode, room) {
      this.room = room || code();
      const url = new URL('/room/' + this.room, this.endpoint);
      url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
      url.search = new URLSearchParams({ mode, v: VERSION, build: this.build });
      const ws = mode === 'resume' ? new WebSocket(url, this.token) : new WebSocket(url);
      this.ws = ws;
      const deadline = setTimeout(() => ws.close(), 8000);
      ws.onmessage = e => {
        if (ws !== this.ws || this.ended) return;
        let m;
        try { m = JSON.parse(e.data); this.receive(m); } catch (err) {
          console.error('Warehouse room message', err);
          this.stop('The room could not be synchronised. Rejoin the shift.');
        }
        if (m?.type === 'welcome') clearTimeout(deadline);
      };
      ws.onclose = e => {
        clearTimeout(deadline);
        if (ws !== this.ws || this.ended) return;
        this.ready = false; this.hostPresent = false; this.cancel();
        if (e.code >= 4000 || !this.token) return this.stop(e.reason || 'Could not reach the relay. Check the relay address and your connection.');
        this.retryUntil ||= Date.now() + 30000;
        if (Date.now() >= this.retryUntil) return this.stop('Connection lost. Rejoin with the room code.');
        this.hooks.status('Reconnecting to room ' + this.room + '…');
        this.retry = setTimeout(() => this.connect('resume', this.room), 1000);
      };
    }
    stop(reason) {
      this.ended = true; this.ready = false; clearTimeout(this.retry);
      this.cancel(); this.ws?.close(); this.hooks.ended(reason);
    }
    leave() { this.send({ type: 'leave' }); this.stop('You left the room.'); }
    send(m) {
      if (this.ws?.readyState !== 1) return false;
      this.ws.send(JSON.stringify(m)); return true;
    }
    cancel() {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve(false); }
      this.pending.clear();
    }
    request(op, args) {
      if (!this.ready || this.paused || this.pending.size >= 4) return Promise.resolve(false);
      const id = ++this.seq;
      return new Promise(resolve => {
        const timer = setTimeout(() => { this.ws.close(); }, 7000);
        this.pending.set(id, { resolve, timer });
        this.send({ type: 'act', id, epoch: this.epoch, op, args, pose: this.hooks.pose() });
      });
    }
    state(force = false) {
      const state = this.hooks.snapshot();
      const key = JSON.stringify(state);
      if (force || this.previous !== key) this.send({ type: 'state', state });
      this.previous = key;
    }
    visibility() {
      if (this.host && this.ready && this.peers.size > 1) this.send({ type: 'frame', frame: this.hooks.frame(), paused: document.hidden });
    }
    tick(now) {
      if (!this.ready || now - this.time < 100 || this.peers.size < 2 || this.ws.bufferedAmount > 256 * 1024) return;
      this.time = now;
      if (this.host) {
        if (now - this.stateTime >= 350) { this.stateTime = now; this.state(); }
        this.visibility();
      } else if (!this.paused) this.send({ type: 'pose', pose: this.hooks.pose() });
    }
    receive(m) {
      if (m.type === 'ended') return this.stop(m.reason);
      if (m.type === 'welcome') {
        this.slot = m.slot; this.host = m.slot === 1; this.token = m.token; this.retryUntil = 0;
        this.hooks.welcome(this.slot);
        this.ready = this.host;
        if (this.host) this.hooks.status('');
        return;
      }
      if (m.type === 'roster') {
        const previous = this.peers;
        this.peers = new Set(m.slots);
        if (this.host) for (const slot of previous) if (slot !== 1 && !this.peers.has(slot)) this.hooks.release(slot);
        this.hooks.roster(m.slots);
        const present = this.peers.has(1);
        if (!this.host && present && !this.hostPresent) {
          this.ready = false; this.hooks.status('Joining the shared shift…'); this.send({ type: 'sync', freshSeat: this.epoch == null });
        }
        if (!present) { this.ready = false; this.cancel(); this.hooks.status('Waiting for the host to reconnect…'); }
        this.hostPresent = present;
        return;
      }
      if (this.host) {
        if (!this.peers.has(m.from) || m.from === 1) return;
        if (m.type === 'sync') {
          this.hooks.release(m.from, m.freshSeat === true); this.lastAction.delete(m.from);
          this.send({ type: 'init', to: m.from, state: this.hooks.snapshot(), frame: this.hooks.frame(), paused: document.hidden });
        } else if (m.type === 'pose') this.hooks.peerPose(m.from, m.pose);
        else if (m.type === 'act' && Number.isSafeInteger(m.id) && m.id > (this.lastAction.get(m.from) || 0)) {
          this.lastAction.set(m.from, m.id);
          let result = false;
          if (!document.hidden && m.epoch === this.hooks.epoch() && m.args && this.hooks.peerPose(m.from, m.pose)) {
            result = this.hooks.action(m.from, m.op, m.args);
          }
          // Deliver the authoritative objects before resolving the scanner/till callback.
          this.state();
          this.send({ type: 'ack', to: m.from, id: m.id, result });
        }
        return;
      }
      if (m.type === 'init' || (m.type === 'state' && this.ready)) {
        const reset = m.type === 'init' || this.epoch !== m.state.epoch;
        this.epoch = m.state.epoch;
        this.hooks.apply(m.state, reset);
        this.ready = true;
        if (m.type === 'init') { this.hooks.draw(m.frame); this.setPaused(m.paused); this.hooks.started(); }
      } else if (m.type === 'frame' && this.ready) { this.hooks.draw(m.frame); this.setPaused(m.paused); }
      else if (m.type === 'ack') {
        const p = this.pending.get(m.id);
        if (p) { clearTimeout(p.timer); this.pending.delete(m.id); p.resolve(m.result); }
      }
    }
    setPaused(value) {
      this.paused = !!value;
      this.hooks.status(this.paused ? 'The host has paused. Waiting for their game tab…' : '');
    }
  }

  function endpoint() {
    // Local Wrangler or a deployment being tested before the default address is committed.
    const params = new URLSearchParams(location.search);
    const value = params.get('relay') || RELAY;
    if (!value) return null;
    try {
      const u = new URL(value);
      if (!u.username && !u.password && (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))) return u.origin;
    } catch { /* display setup message */ }
    return null;
  }
  const api = { Session, endpoint, code };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShiftOnline = api;
})(typeof window !== 'undefined' ? window : this);
