/* Local, opt-in timing capture. Foreground time includes thinking, finding shelves and switching tasks. */
(function (root) {
  'use strict';

  function create(context, now = () => performance.now()) {
    const began = now();
    const events = [];
    const time = { playing: 0, background: 0, overlay: 0 };
    let last = began, activity = 'playing', report;
    const seconds = ms => Math.round(ms / 100) / 10;
    function advance(at) {
      time[activity] += at - last;
      last = at;
    }
    function record(kind, detail, gameTime) {
      if (report) return;
      const at = now();
      advance(at);
      events.push({
        elapsed: seconds(at - began), active: seconds(time.playing),
        shift: seconds(gameTime * 1000), event: kind, ...detail
      });
    }
    function setActivity(next, gameTime) {
      if (report || next === activity) return;
      record('activity', { state: next }, gameTime);
      activity = next;
    }
    function finish(result, gameTime) {
      if (report) return report;
      record('lock-up', {}, gameTime);
      const timing = { wallSeconds: seconds(last - began), activeSeconds: seconds(time.playing),
        backgroundSeconds: seconds(time.background), menuBreakSeconds: seconds(time.overlay),
        shiftSeconds: seconds(gameTime * 1000) };
      // Put each event on one line to keep a pasted report readable and machine-parsable.
      report = '{\n' + [
        '"format": "warehouse-shift-playtest-v1"',
        '"start": ' + JSON.stringify(context),
        '"timing": ' + JSON.stringify(timing),
        '"result": ' + JSON.stringify(result),
        '"events": [\n' + events.map(event => JSON.stringify(event)).join(',\n') + '\n]'
      ].join(',\n') + '\n}';
      return report;
    }
    return { record, setActivity, finish };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShiftPlaytest = api;
})(typeof window !== 'undefined' ? window : this);
