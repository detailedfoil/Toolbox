// Run against local Wrangler. Uses the ws dependency already installed by the repository tests.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { test } from 'node:test';
const origin = 'https://detailedfoil.github.io';
const newCode = () => Array.from(randomBytes(6), n => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('');

function connect(room, mode, token, build = 'abc') {
  const url = 'ws://127.0.0.1:' + (process.env.RELAY_PORT || 8787) + '/room/' + room + '?v=1&build=' + build + '&mode=' + mode;
  const ws = new WebSocket(url, token ? [token] : [], { origin });
  const messages = [], waiting = new Set();
  function add(m) {
    for (const waiter of waiting) if (waiter.predicate(m)) { waiting.delete(waiter); messages.length = 0; waiter.resolve(m); return; }
    messages.push(m);
  }
  ws.on('message', raw => add(JSON.parse(raw)));
  ws.on('close', (code, reason) => add({ type: 'closed', code, reason: String(reason) }));
  ws.on('error', err => add({ type: 'error', reason: err.message }));
  return {
    ws, send: data => ws.send(JSON.stringify(data)),
    next(predicate) {
      if (typeof predicate === 'string') { const type = predicate; predicate = m => m.type === type; }
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(0, index + 1).at(-1));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Relay timed out: ' + mode + ' ' + predicate + ' ' + JSON.stringify(messages.map(m => [m.type, m.reason || m.slots])))), 4000);
        waiting.add({ predicate, resolve: value => { clearTimeout(timer); resolve(value); } });
      });
    }
  };
}
test('local Durable Object admits four, enforces versions and roles, resumes seats and ends with its host', async t => {
  const all = [], room = newCode();
  const dial = (...args) => { const p = connect(room, ...args); all.push(p); return p; };
  t.after(() => all.forEach(p => p.ws.terminate()));
  const host = dial('create'), owner = await host.next('welcome'); assert.equal(owner.slot, 1);
  assert.match((await dial('join', null, 'bad').next('closed')).reason, /versions/);
  const guests = [dial('join'), dial('join'), dial('join')], seats = await Promise.all(guests.map(p => p.next('welcome')));
  assert.deepEqual(seats.map(x => x.slot).sort(), [2, 3, 4]);
  assert.match((await dial('join').next('closed')).reason, /full/);
  await host.next(m => m.type === 'roster' && m.slots.length === 4);
  guests[0].send({ type: 'act', from: 1, id: 1, op: 'take' });
  const act = await host.next('act'); assert.equal(act.from, seats[0].slot);
  host.send({ type: 'ack', to: act.from, id: 1, result: true });
  assert.equal((await guests[0].next('ack')).result, true);
  guests[2].send({ type: 'leave' });
  await host.next(m => m.type === 'roster' && !m.slots.includes(seats[2].slot));
  const replacement = dial('join'); assert.equal((await replacement.next('welcome')).slot, seats[2].slot);
  guests[0].ws.close();
  await host.next(m => m.type === 'roster' && !m.slots.includes(act.from));
  const back = dial('resume', seats[0].token); assert.equal((await back.next('welcome')).slot, act.from);
  back.send({ type: 'init', to: 1 }); back.send({ type: 'pose', pose: {} });
  assert.equal((await host.next(m => ['pose', 'init'].includes(m.type))).type, 'pose');
  for (let i = 0; i < 40; i++) back.send({ type: 'pose' });
  assert.equal((await back.next('closed')).code, 4008);
  host.ws.close(); await guests[1].next(m => m.type === 'roster' && !m.slots.includes(1));
  const resumed = dial('resume', owner.token); assert.equal((await resumed.next('welcome')).slot, 1);
  resumed.send({ type: 'leave' });
  assert.match((await guests[1].next('ended')).reason, /host left/);
  assert.match((await dial('join').next('closed')).reason, /not found/);
});

test('a host that never reconnects expires the room and guests cannot migrate into its seat', async t => {
  const room = newCode(), owner = connect(room, 'create');
  await owner.next('welcome');
  const guest = connect(room, 'join'); await guest.next('welcome');
  t.after(() => { owner.ws.terminate(); guest.ws.terminate(); });
  owner.ws.terminate();
  await guest.next(m => m.type === 'roster' && !m.slots.includes(1));
  const takeover = connect(room, 'create'); assert.equal((await takeover.next('closed')).code, 4003);
  const deadline = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Room expiry timed out')), 42000);
    guest.ws.on('message', raw => {
      if (JSON.parse(raw).type === 'ended') { clearTimeout(timer); resolve(); }
    });
  });
  await deadline;
  assert.match((await connect(room, 'join').next('closed')).reason, /not found/);
});
