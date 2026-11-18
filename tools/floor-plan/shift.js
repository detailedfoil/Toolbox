(function () {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');

  // Ten short cross aisles, each with five bays on either side of the central walkway.
  function warehouse() {
    const layout = {
      building: { w: 40, d: 34, h: 5, t: 0.2 }, rooms: [], walls: [], openings: [], racks: [],
      start: { x: 20, y: 31.8, facing: 'N' },
      objects: [{ name: 'Trade counter', kind: 'counter', x0: 17, x1: 23, y0: 32.4, y1: 33.2 }],
      lights: [{ x0: 20, y0: 2, y1: 30 }],
    };
    const locations = { bays: {}, areas: {} };
    for (let row = 0; row < 10; row++) {
      for (const right of [false, true]) {
        const area = right ? (row < 5 ? 'AAA' : 'BAA') : 'BBB';
        const first = 1 + (right ? row % 5 : row) * 5;
        const edges = Array.from({ length: 6 }, (_, i) => (right ? 22 : 2) + i * 3.2);
        const y = 29 - row * 3;
        const key = area + '/' + row + '/';
        layout.racks.push({ row: key, along: 'x', first, edges, x0: edges[0], x1: edges[5],
          y0: y - 0.7, y1: y, h: 2.1, levels: 5, kind: 'shelf', open: 'S' });
        locations.areas[area] = { shelves: 5, positions: 10 };
        for (let i = 0; i < 5; i++) {
          const number = first + i;
          locations.bays[key + number] = [area + '-' + pad(right ? number : first + 4 - i)];
        }
      }
    }
    return [layout, locations];
  }

  function stockItems(catalogue, segments) {
    const stock = [];
    for (const seg of segments) {
      for (let shelf = 1; shelf <= 5; shelf++) {
        for (let slot = 1; slot <= 10; slot++) {
          const [code, name] = catalogue[stock.length];
          stock.push({ code, name, qty: 50, loc: [seg.area, pad(seg.no), pad(shelf), pad(slot)].join('-') });
        }
      }
    }
    return stock;
  }

  function start({ products, walk, counter, setTarget, postureChanged }) {
    const $ = (id) => document.getElementById(id);
    const button = $('orderAction'), input = $('pickedQty'), squat = $('squatBtn');
    let ticket = 1, index = 0, phase, lines;
    const current = () => lines[index];
    function nextOrder() {
      const chosen = new Set();
      const length = ticket === 1 ? 2 : 2 + Math.floor(Math.random() * 3);
      while (chosen.size < length) chosen.add(products[Math.floor(Math.random() * products.length)]);
      lines = Array.from(chosen, (product) => ({ product, qty: 1 + Math.floor(Math.random() * 6) }));
      phase = 'scan'; index = 0;
    }

    function nearby(item) {
      const r = item.rect;
      return walk.y >= r.y1 && walk.y <= r.y1 + 1.15 && Math.abs(walk.x - (r.x0 + r.x1) / 2) <= 0.48;
    }
    function updatePosition() {
      const item = current()?.product;
      const near = item && nearby(item);
      const low = item && item.pl.shelf === 1;
      let message = '';
      let ready = true;
      if (phase === 'scan') {
        ready = near && (!low || walk.squatting);
        message = !near ? 'Walk to the marked shelf.' : low && !walk.squatting ? 'Squat to scan this low shelf.' : 'Scan this location.';
      } else if (phase === 'quantity') {
        message = 'Enter the quantity you picked.';
      } else if (phase === 'return') {
        ready = walk.x >= counter.x0 && walk.x <= counter.x1 && walk.y <= counter.y0 && walk.y >= counter.y0 - 1.15;
        message = 'Take the tote to the trade counter.';
      } else message = 'Order handed over.';
      if ($('orderStatus').textContent !== message) $('orderStatus').textContent = message;
      button.disabled = !ready;
    }

    function render() {
      const line = current();
      $('orderTitle').textContent = 'Order ' + String(ticket).padStart(3, '0');
      $('ordersServed').textContent = line ? 'Pick ' + (index + 1) + ' / ' + lines.length : ticket - Number(phase === 'return') + ' served';
      $('scannerItem').hidden = !line;
      if (line) {
        $('pickLoc').textContent = line.product.loc;
        $('pickSku').textContent = 'SKU ' + line.product.code;
        $('pickName').textContent = line.product.name;
        $('pickQty').textContent = 'Qty ' + line.qty;
      }
      $('pickedField').hidden = phase !== 'quantity';
      button.textContent = { scan: 'Scan', quantity: 'Enter', return: 'Hand over', done: 'Next order' }[phase];
      setTarget(line?.product, phase === 'return');
      updatePosition();
    }

    function act() {
      updatePosition();
      if (button.disabled) return;
      if (phase === 'scan') {
        phase = 'quantity'; input.value = ''; input.setCustomValidity('');
        if (document.pointerLockElement) document.exitPointerLock();
        render(); input.focus(); return;
      }
      if (phase === 'quantity') {
        if (Number(input.value) !== current().qty) {
          input.setCustomValidity('Pick ' + current().qty + ' to complete this line.');
          input.reportValidity(); input.select(); return;
        }
        input.blur(); index++; phase = current() ? 'scan' : 'return';
      } else if (phase === 'return') phase = 'done';
      else { ticket++; nextOrder(); }
      render();
    }

    function toggleSquat() {
      walk.squatting = !walk.squatting;
      squat.setAttribute('aria-pressed', String(walk.squatting));
      squat.textContent = walk.squatting ? 'Stand' : 'Squat';
      postureChanged(); updatePosition();
    }
    input.addEventListener('input', () => input.setCustomValidity(''));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) act(); } });
    button.addEventListener('click', act);
    squat.addEventListener('click', toggleSquat);
    $('orderControls').hidden = $('orderPanel').hidden = false;
    nextOrder(); render();
    return { act, updatePosition, toggleSquat, selectProduct(item) { if (phase === 'scan' && current().product === item) act(); } };
  }
  window.WarehouseShift = { warehouse, stockItems, start };
})();
