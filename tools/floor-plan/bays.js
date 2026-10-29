/* 3D Floor Plan: turns the rack runs in data/layout.json into a list of bays, each with its name.
   Shared by the page (app.js) and the tests (.github/tests/floor-plan.test.mjs).
   A name is the row letter, then the bay number (counting from `first`, default 1, left to right, or back to front
   for a run that goes that way), then b or f for the back or front side of a back-to-back row: F3b, C2, L5.
   These are temporary until the store's own location names are added. */
(function (root) {
  'use strict';

  function list(layout) {
    const out = [];
    for (const r of layout.racks) {
      const n = r.edges.length - 1, ax = r.along === 'x';
      for (let i = 0; i < n; i++) {
        const a = r.edges[i], c = r.edges[i + 1], num = (r.first || 1) + i;
        out.push({
          id: r.row + num + (r.side || ''),
          row: r.row, num, side: r.side || '',
          kind: (r.kinds && r.kinds[i]) || r.kind,
          plan: r.plan ? (r.plan.length === 1 ? r.plan[0] : r.plan[i] || '') : '',
          open: r.open || '', along: r.along, h: r.h, levels: r.levels || 4,
          braced: (r.braced || []).indexOf(i + 1) >= 0,
          firstInRow: i === 0, lastInRow: i === n - 1,
          x0: ax ? a : r.x0, x1: ax ? c : r.x1, y0: ax ? r.y0 : a, y1: ax ? r.y1 : c,
        });
      }
    }
    return out;
  }

  const api = { list };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FloorBays = api;
})(typeof window !== 'undefined' ? window : this);
