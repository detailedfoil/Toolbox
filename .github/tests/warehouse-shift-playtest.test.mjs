import test from 'node:test';
import assert from 'node:assert/strict';
import playtest from '../../tools/warehouse-shift/playtest.js';

test('playtest tracks real and game time through overlapping breaks and freezes at lock-up', () => {
  let clock = 1000;
  const recorder = playtest.create({ day: 1 }, () => clock);
  clock += 4000;
  recorder.record('pick.start', { who: 'p1', order: 1 }, 3);
  clock += 5000;
  recorder.setActivity('overlay', 7);
  clock += 2000;
  recorder.setActivity('background', 8);
  clock += 30000;
  recorder.setActivity('overlay', 8);
  clock += 3000;
  recorder.setActivity('playing', 10);
  clock += 6000;
  recorder.record('pick.finish', { who: 'p1', order: 1 }, 15);
  const report = recorder.finish({ xpEarned: 20 }, 15);
  clock += 1000;
  recorder.record('pick.start', { order: 2 }, 16);
  assert.equal(recorder.finish({ xpEarned: 30 }, 16), report);
  const data = JSON.parse(report);
  assert.deepEqual(data.timing, { wallSeconds: 50, activeSeconds: 15, backgroundSeconds: 30, menuBreakSeconds: 5, shiftSeconds: 15 });
  assert.deepEqual(data.events.at(-2), { elapsed: 50, active: 15, shift: 15, event: 'pick.finish', who: 'p1', order: 1 });
  assert.equal(data.events.at(-1).event, 'lock-up');
  assert.equal(data.result.xpEarned, 20);
});
