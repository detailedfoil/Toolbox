/* Warehouse Shift uses a practice catalogue tied to the model's existing bays. */
(function () {
  'use strict';

  const ORDERS = [
    [
      { name: 'Wood screws, 4 × 40 mm', bay: 'K1f', qty: 2 },
      { name: 'Wall plugs, 6 mm', bay: 'H2f', qty: 1 },
    ],
    [
      { name: 'PTFE tape', bay: 'D4f', qty: 3 },
      { name: '15 mm copper elbows', bay: 'F2f', qty: 2 },
      { name: 'Adjustable spanner', bay: 'K3f', qty: 1 },
    ],
    [
      { name: 'Masking tape, 25 mm', bay: 'W6', qty: 2 },
      { name: 'Decorator’s caulk', bay: 'G3f', qty: 1 },
      { name: 'Filling knife', bay: 'H4f', qty: 1 },
    ],
  ];

  function start({ bays, walk, counter, setTarget }) {
    const findBay = new Map(bays.map((bay) => [bay.id, bay]));
    const orders = ORDERS.map((order) => order.map((item) => ({ ...item, shelf: findBay.get(item.bay) })));
    const $ = (id) => document.getElementById(id);
    const title = $('orderTitle'), count = $('ordersServed'), list = $('orderItems');
    const status = $('orderStatus'), button = $('orderAction');
    let ticket = 1, picked = 0, handedOver = false;
    const order = () => orders[(ticket - 1) % orders.length];
    const current = () => handedOver ? undefined : order()[picked];

    function atPickFace({ shelf }) {
      // Check the open face and stay within the bay's span, so the next aisle or bay cannot count.
      const { x0, x1, y0, y1, open } = shelf;
      const inX = walk.x >= x0 && walk.x <= x1;
      const inY = walk.y >= y0 && walk.y <= y1;
      return (inX && open.includes('S') && walk.y >= y1 && walk.y - y1 <= 0.9)
        || (inX && open.includes('N') && walk.y <= y0 && y0 - walk.y <= 0.9)
        || (inY && open.includes('E') && walk.x >= x1 && walk.x - x1 <= 0.9)
        || (inY && open.includes('W') && walk.x <= x0 && x0 - walk.x <= 0.9);
    }

    function atCounter() {
      return walk.x >= counter.x0 && walk.x <= counter.x1
        && walk.y <= counter.y0 && counter.y0 - walk.y <= 0.95;
    }

    function updatePosition() {
      const item = current();
      button.disabled = !handedOver && !(item ? atPickFace(item) : atCounter());
    }

    function showOrder() {
      const item = current();
      title.textContent = 'Order #' + String(ticket).padStart(3, '0');
      count.textContent = (ticket - 1 + Number(handedOver)) + ' served';
      const rows = order().map((line, i) => {
        const row = document.createElement('li');
        const product = document.createElement('span');
        const location = document.createElement('strong');
        product.textContent = (i < picked ? '✓ ' : '') + line.qty + ' × ' + line.name;
        location.textContent = line.shelf.where || line.bay;
        row.append(product, location);
        row.classList.toggle('picked', i < picked);
        if (line === item) row.setAttribute('aria-current', 'step');
        return row;
      });
      list.replaceChildren(...rows);
      let action, message;
      if (handedOver) {
        action = 'Next order';
        message = 'Order handed over. The next customer is ready.';
      } else if (item) {
        action = 'Pick ×' + item.qty;
        message = 'Go to ' + (item.shelf.where || item.bay) + ' and collect the marked product.';
      } else {
        action = 'Hand over order';
        message = 'All items picked. Return to the trade counter.';
      }
      status.textContent = message;
      button.textContent = action;
      setTarget(item?.shelf, !handedOver && !item);
      updatePosition();
    }

    function act() {
      updatePosition();
      if (button.disabled) return;
      if (handedOver) {
        ticket++;
        picked = 0;
        handedOver = false;
      } else if (current()) {
        picked++;
      } else {
        handedOver = true;
      }
      showOrder();
    }

    button.addEventListener('click', act);
    $('orderPanel').hidden = false;
    $('orderControls').hidden = false;
    showOrder();
    return {
      act,
      updatePosition,
      selectBay(bay) {
        if (bay && current()?.shelf === bay) act();
      },
    };
  }

  window.WarehouseShift = { start };
})();
