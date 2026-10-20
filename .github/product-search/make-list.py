"""Turns detailedfoil's stock export (the "Paste Here!" sheet, table tblSKU) into the Product Search list.

    python3 .github/product-search/make-list.py path/to/export.xlsx

Writes tools/product-search/data/products.json: one product per line, [SKU, name, flags], where flags adds up
1 = hazardous, 2 = aerosol, 4 = non-trolleyable, 8 = sharp or liquid. Stock, locations and anything else
store-specific are left out on purpose: the repo is public.
Needs openpyxl (pip install openpyxl). Reads the values Excel saved, so save the workbook in Excel first.
"""
import json, re, sys, datetime, pathlib
import openpyxl

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'tools/product-search/data/products.json'
SKU = re.compile(r'^(\d{3}[A-Z]{2}|\d{4}[A-Z]|\d{5})$')
FLAGS = [('Hazardous', 1), ('Aerosol', 2), ('Non Trolleyable', 4), ('Sharp or Liquid', 8)]


def main(src):
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    ws = wb['Paste Here!'] if 'Paste Here!' in wb.sheetnames else wb.worksheets[0]
    head, cols, items, seen, bad = None, {}, [], set(), []
    for row in ws.iter_rows(values_only=True):
        if head is None:
            if row and 'SKU Code' in row:
                head = [str(c or '').strip() for c in row]
                cols = {name: head.index(name) for name in head if name}
                missing = [n for n in ['SKU Code', 'Description'] + [f for f, _ in FLAGS] if n not in cols]
                if missing: sys.exit('Missing columns: ' + ', '.join(missing))
            continue
        sku = str(row[cols['SKU Code']] or '').strip().upper().replace('O', '0')
        if not sku: continue
        if not SKU.match(sku): bad.append(sku); continue
        if sku in seen: continue
        seen.add(sku)
        name = re.sub(r'\s+', ' ', str(row[cols['Description']] or '')).strip()
        flags = sum(bit for col, bit in FLAGS if str(row[cols[col]] or '').strip().upper() == 'YES')
        items.append([sku, name, flags])
    if head is None: sys.exit('No "SKU Code" heading found')
    items.sort(key=lambda x: x[0])
    version = datetime.date.today().isoformat()
    lines = ',\n'.join('    ' + json.dumps(i, ensure_ascii=False) for i in items)
    OUT.write_text('{\n  "version": %s,\n  "count": %d,\n  "flags": {"1": "Hazardous", "2": "Aerosol", "4": "Non-trolleyable", "8": "Sharp or liquid"},\n  "items": [\n%s\n  ]\n}\n'
                   % (json.dumps(version), len(items), lines), encoding='utf-8')
    print(f'{len(items)} products written to {OUT.relative_to(ROOT)}' + (f'; skipped {len(bad)} odd codes: {bad[:10]}' if bad else ''))


if __name__ == '__main__':
    if len(sys.argv) != 2: sys.exit(__doc__)
    main(sys.argv[1])
