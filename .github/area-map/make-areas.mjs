// Draws the Area Map's area shapes: tools/area-map/data/stores.json -> tools/area-map/data/areas.json.
//
//   cd .github && npm ci && node area-map/make-areas.mjs
//
// Run it again after changing stores.json (a store moving area, opening or closing). Every bit of land goes to its
// nearest store, and a store's bit goes to that store's area, so the areas cover the land with no gaps or overlaps.
// Nearest is worked out separately on Great Britain, the island of Ireland and the Isle of Man, so no area reaches
// across the sea. The coastline (land.json) is Natural Earth's 1:10m countries (public domain), simplified.
// The shapes are a guide built from where the stores are, not official boundaries.
//
// areas.json: {areas: [{id, color, next, label, km2, stores, shape}]}
//   color: 0-6, so that no two neighbouring areas share one (or have two that look alike); next: the areas that share a border;
//   label: [lat, lng] where the area's number goes; shape: GeoJSON MultiPolygon coordinates ([lng, lat]).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Delaunay } from 'd3-delaunay';
import pc from 'polygon-clipping';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const STORES = path.join(ROOT, 'tools/area-map/data/stores.json');
const OUT = path.join(ROOT, 'tools/area-map/data/areas.json');
const COLORS = 7;
// colour pairs too alike to sit side by side (blue/violet, orange/yellow, orange/pink, aqua/pink, orange/green, aqua/green), checked for
// colour-blind and normal sight against the page's light and dark colours (area-map.css)
const ALIKE = [[0, 5], [1, 3], [1, 4], [2, 4], [1, 6], [2, 6]];

// Web Mercator: keeps nearest-store distances right locally, at every latitude
const D = 180 / Math.PI;
const fwd = ([lng, lat]) => [lng, D * Math.log(Math.tan(Math.PI / 4 + lat / D / 2))];
const back = ([x, y]) => [x, D * (2 * Math.atan(Math.exp(y / D)) - Math.PI / 2)];
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const groupOf = (s) => (s.country === 'Ireland' || s.country === 'Northern Ireland' ? 'ireland' : s.country === 'Isle of Man' ? 'man' : 'britain');

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inMulti = (pt, multi) => multi.some((poly) => inRing(pt, poly[0]) && !poly.slice(1).some((h) => inRing(pt, h)));

// area of a ring in km2 (sinusoidal projection, which keeps areas true)
function ringKm2(ring) {
  const p = ring.map(([lng, lat]) => [lng * Math.cos(lat / D) * 111.32, lat * 111.32]);
  let a = 0;
  for (let i = 0; i < p.length - 1; i++) a += p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1];
  return Math.abs(a / 2);
}
const polyKm2 = (poly) => ringKm2(poly[0]) - poly.slice(1).reduce((n, h) => n + ringKm2(h), 0);

// the point inside a polygon furthest from its edges (a coarse grid, then finer around the best spot)
function labelPoint(poly) {
  const ring = poly[0].map(fwd), holes = poly.slice(1).map((h) => h.map(fwd));
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const edges = [ring, ...holes];
  const distToEdge = ([x, y]) => {
    let best = Infinity;
    for (const r of edges) for (let i = 0; i < r.length - 1; i++) {
      const [ax, ay] = r[i], [bx, by] = r[i + 1], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
    }
    return best;
  };
  const inside = (p) => inRing(p, ring) && !holes.some((h) => inRing(p, h));
  let box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], best = null, bestD = -1;
  for (let round = 0; round < 4; round++) {
    const step = Math.max(box[2] - box[0], box[3] - box[1]) / 24;
    for (let x = box[0]; x <= box[2]; x += step) for (let y = box[1]; y <= box[3]; y += step) {
      if (!inside([x, y])) continue;
      const d = distToEdge([x, y]);
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
    if (!best) break;
    box = [best[0] - step * 2, best[1] - step * 2, best[0] + step * 2, best[1] + step * 2];
  }
  if (!best) best = ring[0];
  const [lng, lat] = back(best);
  return [r4(lat), r4(lng)];
}

export function makeAreas(stores, landPolys) {
  const groups = {};
  for (const s of stores) (groups[groupOf(s)] ??= []).push(s);

  // each piece of coastline goes to the group of its nearest store (small islands off Ireland to Ireland, and so on)
  const land = {};
  for (const p of landPolys) {
    const [lng, lat] = p.rings[0][0];
    let best = null, bestD = Infinity;
    for (const s of stores) { const d = (s.lat - lat) ** 2 + ((s.lng - lng) * Math.cos(lat / D)) ** 2; if (d < bestD) { bestD = d; best = s; } }
    (land[groupOf(best)] ??= []).push([p.rings]);
  }
  for (const g of Object.keys(land)) land[g] = pc.union(...land[g]);

  const shapes = {}, next = {};
  const link = (a, b) => { (next[a] ??= new Set()).add(b); (next[b] ??= new Set()).add(a); };
  for (const [g, list] of Object.entries(groups)) {
    const pts = list.map((s) => fwd([s.lng, s.lat]));
    const all = land[g].flatMap((poly) => poly[0]).map(fwd).concat(pts);
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const pad = 1;
    const delaunay = Delaunay.from(pts);
    const vor = delaunay.voronoi([Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]);
    const cells = {};
    list.forEach((s, i) => {
      const cell = vor.cellPolygon(i);
      if (cell) (cells[s.area] ??= []).push([cell.map(back)]);
    });
    for (const [a, polys] of Object.entries(cells)) {
      const merged = pc.intersection(pc.union(...polys), land[g]);
      shapes[a] = (shapes[a] || []).concat(merged);
    }
    // neighbours: two stores in different areas whose cells meet along a line that's (partly) on land
    for (let e = 0; e < delaunay.triangles.length; e++) {
      const A = list[delaunay.triangles[e]], B = list[delaunay.triangles[e % 3 === 2 ? e - 2 : e + 1]];
      const i = list.indexOf(A), j = list.indexOf(B);
      if (!A || !B || A.area === B.area ||(next[A.area] && next[A.area].has(B.area))) continue;
      const ci = vor.cellPolygon(i), cj = vor.cellPolygon(j);
      if (!ci || !cj) continue;
      const shared = ci.filter((p) => cj.some((q) => Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9));
      if (shared.length < 2) continue;
      const [p, q] = shared;
      for (let k = 1; k < 20; k++) {
        const pt = back([p[0] + ((q[0] - p[0]) * k) / 20, p[1] + ((q[1] - p[1]) * k) / 20]);
        if (inMulti(pt, land[g])) { link(A.area, B.area); break; }
      }
    }
  }

  const ids = Object.keys(shapes).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  // colours: the area with fewest colours left goes next, trying the least used colour first; at a dead end, step
  // back and try the next colour (46 areas, so this is quick)
  const color = {}, used = new Array(COLORS).fill(0);
  const deg = (a) => (next[a] ? next[a].size : 0);
  const options = (a) => {
    const taken = new Set();
    for (const b of next[a] || []) if (color[b] != null) {
      taken.add(color[b]);
      for (const [x, y] of ALIKE) { if (color[b] === x) taken.add(y); if (color[b] === y) taken.add(x); }
    }
    return [...Array(COLORS).keys()].filter((c) => !taken.has(c)).sort((x, y) => used[x] - used[y] || x - y);
  };
  const solve = () => {
    const left = ids.filter((a) => color[a] == null);
    if (!left.length) return true;
    left.sort((a, b) => options(a).length - options(b).length || deg(b) - deg(a) || a.localeCompare(b, undefined, { numeric: true }));
    const a = left[0];
    for (const c of options(a)) {
      color[a] = c; used[c]++;
      if (solve()) return true;
      delete color[a]; used[c]--;
    }
    return false;
  };
  if (!solve()) throw new Error("Couldn't colour the areas so neighbours differ: raise COLORS");

  const count = {};
  for (const s of stores) count[s.area] = (count[s.area] || 0) + 1;
  const areas = ids.map((a) => {
    const shape = shapes[a]
      .map((poly) => poly.map((ring) => ring.map(([x, y]) => [r4(x), r4(y)])))
      .filter((poly) => polyKm2(poly) > 0.05)
      .sort((x, y) => polyKm2(y) - polyKm2(x));
    return {
      id: a,
      color: color[a],
      next: [...(next[a] || [])].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })),
      label: labelPoint(shape[0]),
      km2: Math.round(shape.reduce((n, p) => n + polyKm2(p), 0)),
      stores: count[a],
      shape
    };
  });
  return { areas };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const stores = JSON.parse(fs.readFileSync(STORES, 'utf8'));
  const landPolys = JSON.parse(fs.readFileSync(path.join(HERE, 'land.json'), 'utf8'));
  const { areas } = makeAreas(stores, landPolys);
  fs.writeFileSync(OUT, '{"areas": [\n' + areas.map((a) => JSON.stringify(a)).join(',\n') + '\n]}\n');
  console.log(areas.length + ' areas, ' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB: ' + path.relative(ROOT, OUT));
}
