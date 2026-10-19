// Pretend copies of PetrolPrices.co.uk's Leighton Buzzard page for the fuel tests: the HTML GitHub reads, and
// jina's text version of it that the phone reads. The markup follows the real page as it was on 19 Oct 2026
// (one link per forecourt with an aria-label, a name, an address and a Petrol and a Diesel price chip).
export const LB = () => [
  { name: 'Tesco Leighton Buzzard Superstore', address: 'Vimy Road, Leighton Buzzard, LU7 1ER', petrol: '168.9', diesel: '193.9', badge: 'Cheapest diesel' },
  { name: "Shell Harvest Energy St Christopher's", address: 'Leighton Road, Leighton Buzzard, LU7 1LA', petrol: '169.9', diesel: '199.9' },
  { name: 'BP Lake Street Service Station', address: '45 Lake Street, Leighton Buzzard, LU7 1RS', petrol: '166.7', diesel: '194.7', badge: 'Cheapest petrol' },
  { name: 'Morrisons Leighton Buzzard', address: 'Lake Street, Leighton Buzzard, LU7 1WS', petrol: '166.7', diesel: '194.7' },
  { name: 'Shell Little Waitrose Grovebury', address: 'Billington Road, Leighton Buzzard, LU7 9HH', petrol: '173.9', diesel: '201.9' }
];
const pc = (s) => s.address.match(/[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/)[0];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/'/g, '&#039;');
const chip = (label, p) => `<span class="price-chip"><span class="block text-xs">${label}</span><span class="block text-sm font-extrabold">${p === '-' ? '&ndash;' : p + '<span class="text-xs font-bold">p</span>'}</span></span>`;

export function html(stations = LB(), { updated = 'today at 12:03', listed = stations.length } = {}) {
  return `<!doctype html><html><body><main>
  <section aria-label="Cheapest fuel in Leighton Buzzard today"><p class="mt-1 text-2xl font-extrabold text-gray-900">166.7p<span>per litre</span></p>
  <p class="mt-4 text-xs text-gray-500">Prices from the UK Government Fuel Finder feed, last updated ${updated}.</p></section>
  <section><h2 id="station-list-title">Leighton Buzzard fuel stations</h2><p class="mt-1 text-sm text-gray-500">${listed} stations listed</p>
  <a href="/map.php?location=Leighton Buzzard&amp;fuel_type=E10&amp;radius=5">View all on the fuel map &rarr;</a>
  <ul class="space-y-3" role="list">${stations.map((s) => `
    <li>
      <a href="/map.php?location=${encodeURIComponent(pc(s))}&amp;fuel_type=E10&amp;radius=5"
         class="station-link group block"
         aria-label="Compare fuel prices near ${esc(s.name)}, ${pc(s)}. Unleaded ${s.petrol === '-' ? 'not reported' : s.petrol + ' pence per litre'}. Diesel ${s.diesel === '-' ? 'not reported' : s.diesel + ' pence per litre'}">
        <span class="flex"><span class="min-w-0">
          <span class="block font-bold text-gray-900">
            ${esc(s.name)}            ${s.badge ? `<span class="best-pill ml-2 inline-block">${s.badge}</span>` : ''}         </span>
          <span class="block mt-1 text-sm text-gray-600">
            ${esc(s.address)}                 </span>
        </span>
        <span class="flex"><span class="flex items-center gap-2">
          ${chip('Petrol', s.petrol)}          ${chip('Diesel', s.diesel)}
        </span>
        <span class="inline-flex"><span class="hidden sm:inline">Compare</span>
          <svg class="w-4 h-4" viewBox="0 0 20 20"><path d="M10 3l6 6-6 6"></path></svg></span>
        </span></span>
      </a>
    </li>`).join('')}
  </ul></section>
  <section><a href="/map.php?location=Leighton Buzzard&amp;fuel_type=E10&amp;radius=5"><span class="block text-sm">Unleaded E10</span><span class="block">Compare petrol prices</span></a></section>
  </main></body></html>`;
}

export function jinaText(stations = LB(), { updated = 'today at 12:03' } = {}) {
  return `Title: Leighton Buzzard Petrol & Diesel Prices Today

URL Source: https://www.petrolprices.co.uk/towns/leighton-buzzard.php

Markdown Content:
# Petrol and diesel stations in Leighton Buzzard

Cheapest unleaded E10

166.7p per litre

Prices from the UK Government Fuel Finder feed, last updated ${updated}.

## Leighton Buzzard fuel stations

${stations.length} stations listed

[View all on the fuel map →](https://www.petrolprices.co.uk/map.php?location=Leighton%20Buzzard&fuel_type=E10&radius=5)

${stations.map((s) => `*   [${s.name}${s.badge ? ' ' + s.badge : ''} ${s.address} Petrol ${s.petrol === '-' ? '–' : s.petrol + ' p'} Diesel ${s.diesel === '-' ? '–' : s.diesel + ' p'} Compare](https://www.petrolprices.co.uk/map.php?location=${encodeURIComponent(pc(s))}&fuel_type=E10&radius=5)`).join('\n')}

[Unleaded E10 Compare petrol prices](https://www.petrolprices.co.uk/map.php?location=Leighton%20Buzzard&fuel_type=E10&radius=5)
`;
}
