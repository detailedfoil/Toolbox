#!/usr/bin/env python3
"""Stock Swaps: works out which Area 20 stores should swap stock for every drive time on the page's slider, and
writes tools/stock-swaps/data/plans.json (the page reads only that file).

  python3 .github/stock-swaps/make-plans.py STOCK.xlsx SOLD.xlsx --days 4 --stock-date 19.11.2026 --sales "16.11 to 19.11.2026"

STOCK.xlsx  stock on hand: a Power BI export, sheet "Export", a row per store and a column per product
SOLD.xlsx   units sold over the sales period, same layout (other areas' stores in it are ignored)
--days      how many days of sales SOLD.xlsx covers

Each store's transactions (Area Overview) are in STORES below: update them along with the files.
Needs numpy, scipy (1.9 or newer, for milp) and openpyxl: pip install numpy scipy openpyxl

How a plan is made (the page's "How it works" says the same in plain English):
- demand a day = half the store's own sales, half its share (by transactions) of the area's sales of that product
- a store can give whatever it has over 125% of its own 7 days' demand; a store is short of 7 days' demand
  (only if it's 2 or more short)
- a run is two stores and the van between them; either can send to the other (both ways = a swap)
- the solver picks the runs, and what goes on each, for the most stock moved: units that lift a store that's nearly out
  (under 2 days) count 1.5, swapped units count 1.5, and every hour a run takes (round trip drive plus 30 minutes to
  load, unload and book it) costs 10 units; every run must be at least 8 units and 5 units a van hour
- only runs whose round trip drive fits the slider are allowed, worked out afresh for each slider step, with and
  without "Swaps only" (a swap is at least 3 units each way)
- whatever could still move after that goes under "Not worth your time" (under 8 units or under 5 an hour)
Drive times are estimated from distance (straight line x 1.3 for the roads, then 4 minutes plus 1.6 a mile each way):
there's no live routing.
"""
import argparse, datetime, json, math, os, sys
import numpy as np
import openpyxl
from scipy.optimize import milp, LinearConstraint, Bounds
from scipy.sparse import coo_matrix

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'tools', 'stock-swaps', 'data', 'plans.json'))

# name in the exports, name on the page, transactions (Black Friday incentive report to 21.11.2026), lat, lng
# (places from the Area Map's stores.json; Royston's is from its postcode, SG8 5PF, as the map's is approximate)
STORES = [
    ("AMERSHAM", "Amersham", 2050, 51.67133, -0.58722),
    ("BERKHAMSTED", "Berkhamsted", 2334, 51.76831, -0.58138),
    ("BIGGLESWADE", "Biggleswade", 2378, 52.07483, -0.24107),
    ("BISHOPS STORTFORD", "Bishops Stortford", 2375, 51.87269, 0.17574),
    ("CHESHAM", "Chesham", 1506, 51.69872, -0.6098),
    ("DUNSTABLE", "Dunstable", 2231, 51.8867, -0.50739),
    ("EPPING - THORNWOOD", "Epping", 2257, 51.7201, 0.12886),
    ("FLITWICK", "Flitwick", 2592, 52.01016, -0.48516),
    ("HARLOW", "Harlow", 3305, 51.78708, 0.12209),
    ("HEMEL HEMPSTEAD", "Hemel Hempstead", 4056, 51.76663, -0.44198),
    ("HERTFORD", "Hertford", 1922, 51.80292, -0.06274),
    ("HODDESDON", "Hoddesdon", 3087, 51.76234, 0.00358),
    ("HOUGHTON REGIS", "Houghton Regis", 1857, 51.90146, -0.5254),
    ("LEIGHTON BUZZARD", "Leighton Buzzard", 3151, 51.91034, -0.65632),
    ("LETCHWORTH", "Letchworth", 2859, 51.98446, -0.20678),
    ("LUTON - BILTON WAY", "Luton Bilton Way", 2286, 51.88581, -0.45067),
    ("LUTON - WINDMILL TRADING EST", "Luton Windmill", 3053, 51.87715, -0.40466),
    ("ROYSTON", "Royston", 2684, 52.057788, -0.036401),
    ("SAFFRON WALDEN", "Saffron Walden", 1402, 52.02107, 0.2538),
    ("ST ALBANS - HATFIELD ROAD", "St Albans", 3223, 51.75197, -0.27765),
    ("STEVENAGE", "Stevenage", 3708, 51.90591, -0.21419),
    ("WELWYN GARDEN CITY", "Welwyn Garden City", 2816, 51.80709, -0.18925),
]

SHORT = {
    "16PC ASSORTED BUNGEE CORD SET": "Bungee cords",
    "DEWALT EXTREME IMPACT TORSION 32 PIECE BIT SET": "DeWalt bits",
    "ERBAUER MULTI-TOOL ACCESSORIES MIXED SETS": "Erbauer multi-tool",
    "ERBAUER SCREWDRIVER BIT SET 32 PCS": "Erbauer bits",
    "MAGNUSSON 12 PIECE VDE SCREWDRIVER SET": "Magnusson set",
    "MICROFIBRE CLOTHS PK10": "Microfibre cloths",
    "NO NON HEAVY DUTY BIG MULTI-TASK WIPES 300PK": "Wipes",
    "SCRUFFS WINTER ESSENTIALS PACK 2020": "Scruffs pack",
    "SITE SWG420 PU PALM DIP GLOVES LARGE 9 - 10 PACK": "Palm gloves",
    "SITE WILLSTROP SOCKS 5PK 3-7": "Socks mixed sizes",
    "SITE WILLSTROP SOCKS 5PK 7-11": "Socks mixed sizes",
    "VARTA LONGLIFE POWER AA CUBE 40": "Varta AA",
    "VARTA LONGLIFE POWER AAA CUBE 40": "Varta AAA",
}

RULES = {
    "horizon": 7,          # days of demand a short store is topped up to
    "keep": 1.25,          # a giving store keeps this many times its own 7 days' demand
    "lowDays": 2,          # under this many days of stock = nearly out
    "minShort": 2,         # a store has to be at least this many short to be sent anything
    "handling": 30,        # minutes a run spends loading, unloading and booking the transfer
    "minUnits": 8,         # smallest run worth a trip
    "minScore": 5,         # fewest units a van hour worth a trip
    "hourCost": 10,        # what an hour of a run costs, in units, when choosing between runs
    "tiers": [20, 10, 5],  # score for Most effective, Worth doing, Marginal
    "swapMin": 3,          # units each way for a run to be a swap
    "swapBonus": 0.5,      # swapped units count 1.5
    "lowBonus": 0.5,       # units to a store that's nearly out count 1.5 (when choosing)
    "traffic": 1.0, "roadFactor": 1.3, "startMin": 4, "minPerMile": 1.6,
    "steps": [30, 120, 5],
}



def drive_minutes():
    """Round trip minutes between every pair of stores. Uses the real road times saved by the GitHub job
    (tools/stock-swaps/data/drive.json, from the OSRM car router: no live traffic, so RULES["traffic"] adds an allowance).
    Without that file it falls back to the old distance estimate."""
    import json, os
    f = os.path.join(os.path.dirname(__file__), "..", "..", "tools", "stock-swaps", "data", "drive.json")
    if os.path.exists(f):
        d = json.load(open(f))
        names = [s[1] for s in STORES]
        assert d["names"] == names, "drive.json stores differ from STORES: rerun the Stock Stealer drive times job"
        m = np.array(d["minutes"], dtype=float)
        out = np.rint((m + m.T) * RULES["traffic"]).astype(int)
        RULES["source"] = "road"
    else:
        road = np.array([[miles(a, b) * RULES["roadFactor"] for b in STORES] for a in STORES])
        out = np.rint(2 * (RULES["startMin"] + RULES["minPerMile"] * road)).astype(int)
        RULES["source"] = "estimate"
    np.fill_diagonal(out, 0)
    return out

def short_name(h):
    h = str(h).strip()
    return SHORT.get(h.upper(), h.title()[:22])


def load(path):
    ws = openpyxl.load_workbook(path, data_only=True, read_only=True)["Export"]
    rows = list(ws.iter_rows(values_only=True))
    head = [short_name(h) for h in rows[0][1:] if h is not None]
    data = {}
    for r in rows[1:]:
        if not r:
            continue
        k = r[0]
        if not k or str(k).strip() in ("", "Total") or str(k).startswith("Applied"):
            continue
        cells = (tuple(r[1:1 + len(head)]) + (None,) * len(head))[:len(head)]
        if any(v is not None and not isinstance(v, (int, float)) for v in cells):
            continue                                  # a second heading row ("Stock Quantity" and the like)
        data[str(k).strip().upper()] = [float(v or 0) for v in cells]
    names = list(dict.fromkeys(head))                 # products sharing a short name (the sock sizes) are added together
    if len(names) < len(head):
        for k, row in data.items():
            tot = {n: 0.0 for n in names}
            for n, v in zip(head, row):
                tot[n] += v
            data[k] = [tot[n] for n in names]
        head = names
    return head, data


def miles(a, b):
    R = 3958.8
    la1, lo1, la2, lo2 = map(math.radians, (a[3], a[4], b[3], b[4]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stock")
    ap.add_argument("sold")
    ap.add_argument("--days", type=float, required=True)
    ap.add_argument("--stock-date", required=True)
    ap.add_argument("--sales", required=True)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--hour-cost", type=float, help="try another cost per run hour (units)")
    ap.add_argument("--only", help="try just these slider steps, e.g. 60,90,180 (nothing is written)")
    args = ap.parse_args()
    if args.hour_cost is not None:
        RULES["hourCost"] = args.hour_cost

    head, stock = load(args.stock)
    head2, sold = load(args.sold)
    if head != head2:
        sys.exit("The two files have different products:\n  %s\n  %s" % (head, head2))
    missing = [s[0] for s in STORES if s[0] not in stock or s[0] not in sold]
    if missing:
        sys.exit("Not in the files: " + ", ".join(missing))
    extra = [k for k in stock if k not in [s[0] for s in STORES]]
    if extra:   # the exports can cover all of Central or the whole company: only the Area 20 stores in STORES are used
        print("Leaving out %d stores that aren't in Area 20" % len(extra))

    n, ni = len(STORES), len(head)
    STK = np.array([stock[s[0]] for s in STORES])
    SLD = np.array([sold[s[0]] for s in STORES])
    TXN = np.array([s[2] for s in STORES], float)
    share = TXN / TXN.sum()
    day = (0.5 * SLD + 0.5 * np.outer(share, SLD.sum(axis=0))) / args.days
    need7 = day * RULES["horizon"]
    sur = np.floor(np.maximum(0, STK - RULES["keep"] * need7) + 1e-9)
    need = np.ceil(np.maximum(0, need7 - STK) - 1e-9)
    need[need < RULES["minShort"]] = 0
    urgent = np.minimum(need, np.ceil(np.maximum(0, RULES["lowDays"] * day - STK) - 1e-9))
    low = (STK < RULES["lowDays"] * day) | (STK == 0)

    mins = drive_minutes()

    def hours(m):
        return (m + RULES["handling"]) / 60.0

    def best(T, swaps, sur, need, urgent, fixed, only=None):
        """fixed=True: the main plan (runs cost time, must clear the bar); False: whatever's left, no rules.
        only=s: just the runs store s is in, as if no other store swaps (Best for each store)"""
        pairs = [(a, b) for a in range(n) for b in range(a + 1, n) if mins[a, b] <= T and (only is None or only in (a, b))]
        xs, ub = [], []
        by_pair = {}
        for (a, b) in pairs:
            cand = {0: [], 1: []}
            for dr, (d, r) in enumerate(((a, b), (b, a))):
                for i in range(ni):
                    if sur[d, i] > 0 and need[r, i] > 0:
                        cand[dr].append((d, r, i))
            if fixed and swaps and (not cand[0] or not cand[1]):
                continue
            if not cand[0] and not cand[1]:
                continue
            by_pair[(a, b)] = {0: [], 1: []}
            for dr in (0, 1):
                for (d, r, i) in cand[dr]:
                    by_pair[(a, b)][dr].append(len(xs))
                    xs.append((d, r, i))
                    ub.append(min(sur[d, i], need[r, i]))
        if not xs:
            return {}
        P = list(by_pair)
        nx = len(xs)
        zs = sorted({(r, i) for (d, r, i) in xs if urgent[r, i] > 0}) if fixed else []
        nz, npair = len(zs), (len(P) if fixed else 0)
        ny0, ns0 = nx + nz, nx + nz + npair
        nv = nx + nz + 2 * npair
        c = np.zeros(nv)
        for k, (d, r, i) in enumerate(xs):
            c[k] = -(1.0 - 0.001 * mins[d, r])
        lo, hi = np.zeros(nv), np.zeros(nv)
        hi[:nx] = ub
        for k, (r, i) in enumerate(zs):
            c[nx + k] = -RULES["lowBonus"]
            hi[nx + k] = urgent[r, i]
        for k, (a, b) in enumerate(P if fixed else []):
            c[ny0 + k] = RULES["hourCost"] * hours(mins[a, b])
            hi[ny0 + k] = 1
            c[ns0 + k] = -2 * RULES["swapBonus"]
            hi[ns0 + k] = np.inf
        rows, cols, vals, rhs = [], [], [], []
        row = [0]

        def add(entries, b):
            for col, v in entries:
                rows.append(row[0]); cols.append(col); vals.append(v)
            rhs.append(b); row[0] += 1
        out_of, into = {}, {}
        for k, (d, r, i) in enumerate(xs):
            out_of.setdefault((d, i), []).append(k)
            into.setdefault((r, i), []).append(k)
        for (d, i), ks in out_of.items():
            add([(k, 1) for k in ks], sur[d, i])
        for (r, i), ks in into.items():
            add([(k, 1) for k in ks], need[r, i])
        for k, (r, i) in enumerate(zs):
            add([(nx + k, 1)] + [(x, -1) for x in into[(r, i)]], 0)
        if fixed:
            for k, (a, b) in enumerate(P):
                f0, f1 = by_pair[(a, b)][0], by_pair[(a, b)][1]
                allx = f0 + f1
                M = sum(ub[x] for x in allx)
                y, s = ny0 + k, ns0 + k
                add([(x, 1) for x in allx] + [(y, -M)], 0)                         # nothing moves without the run
                add([(x, -1) for x in allx] + [(y, RULES["minUnits"])], 0)        # at least 8 units
                add([(x, -1) for x in allx] + [(s, -2 * RULES["swapBonus"]), (y, RULES["minScore"] * hours(mins[a, b]))], 0)
                add([(s, 1)] + [(x, -1) for x in f0], 0)                          # swapped = the smaller way
                add([(s, 1)] + [(x, -1) for x in f1], 0)
                if swaps:
                    add([(x, -1) for x in f0] + [(y, RULES["swapMin"])], 0)
                    add([(x, -1) for x in f1] + [(y, RULES["swapMin"])], 0)
        A = coo_matrix((vals, (rows, cols)), shape=(row[0], nv)).tocsr()
        integ = np.zeros(nv)
        integ[:nx] = 1
        integ[ny0:ny0 + npair] = 1
        res = milp(c, constraints=LinearConstraint(A, -np.inf, np.array(rhs)), integrality=integ,
                   bounds=Bounds(lo, hi), options={"time_limit": 60, "mip_rel_gap": 1e-3})
        if res.x is None:
            sys.exit("No answer at %s min (%s)" % (T, res.message))
        flows = {}
        for k, (d, r, i) in enumerate(xs):
            q = int(round(res.x[k]))
            if q > 0:
                flows.setdefault(tuple(sorted((d, r))), []).append((d, r, i, q))
        return flows

    def as_run(pair, moves):
        a, b = pair
        ab = sum(q for d, r, i, q in moves if d == a)
        ba = sum(q for d, r, i, q in moves if d == b)
        if ba > ab:
            a, b, ab, ba = b, a, ba, ab
        lines = sorted(([0 if d == a else 1, i, q, int(bool(low[r, i]))] for d, r, i, q in moves),
                       key=lambda l: (l[0], -l[2], l[1]))
        return [a, b, int(mins[a, b]), lines]

    def passes(run, swaps):
        a, b, m, lines = run
        ab = sum(l[2] for l in lines if l[0] == 0)
        ba = sum(l[2] for l in lines if l[0] == 1)
        units, swapped = ab + ba, min(ab, ba)
        score = (units + 2 * RULES["swapBonus"] * swapped) / hours(m)
        ok = units >= RULES["minUnits"] and score >= RULES["minScore"] - 1e-9
        if swaps:
            ok = ok and min(ab, ba) >= RULES["swapMin"]
        return ok

    lo_, hi_, st = RULES["steps"]
    steps = list(range(lo_, hi_ + 1, st))
    if args.only:
        steps = [int(v) for v in args.only.split(",")]
    def solve(T, swaps, only=None):
        """the plan for one slider step: {"runs", "skip"}; only=s plans store s alone, as if nobody else swaps"""
        flows = best(T, swaps, sur, need, urgent, True, only)
        runs = [as_run(p, mv) for p, mv in flows.items()]
        out = np.zeros_like(sur); inn = np.zeros_like(need)
        for mv in flows.values():
            for d, r, i, q in mv:
                out[d, i] += q; inn[r, i] += q
        left = best(T, False, sur - out, need - inn, urgent * 0, False, only)
        skips = []
        for p, mv in left.items():
            run = as_run(p, mv)
            if passes(run, swaps):          # worth a trip after all (rare): it joins the plan
                runs.append(run)
                for d, r, i, q in mv:
                    out[d, i] += q; inn[r, i] += q
            elif not swaps or (any(l[0] == 0 for l in run[3]) and any(l[0] == 1 for l in run[3])):
                skips.append(run)
        # checks: nobody gives more than they can spare or gets more than they're short, every run clears the bar
        assert (out <= sur + 1e-9).all() and (inn <= need + 1e-9).all(), (swaps, T, only)
        for r in runs:
            assert r[2] <= T and passes(r, swaps), (swaps, T, only, r)
            assert only is None or only in (r[0], r[1]), (T, only, r)
        for r in skips:
            assert r[2] <= T and not passes(r, swaps), (swaps, T, only, r)
        runs.sort(key=lambda r: (r[0], r[1]))
        skips.sort(key=lambda r: (-sum(l[2] for l in r[3]), r[2]))
        return {"runs": runs, "skip": skips[:40]}

    plans, seen = [], {}

    def keep(plan):
        key = json.dumps(plan, separators=(",", ":"))
        if key not in seen:
            seen[key] = len(plans)
            plans.append(plan)
        return seen[key]

    # the whole area at once ("If every store swaps")
    index = {"all": [], "swaps": []}
    for mode in ("all", "swaps"):
        swaps = mode == "swaps"
        for T in steps:
            plan = solve(T, swaps)
            runs = plan["runs"]
            index[mode].append(keep(plan))
            print("%-5s %3d min: %2d runs, %3d units, %2d not worth it" % (mode, T, len(runs),
                  sum(l[2] for r in runs for l in r[3]), len(plan["skip"])), flush=True)
            if args.only:
                for r in sorted(runs, key=lambda r: -sum(l[2] for l in r[3])):
                    print("      %-18s %s %-18s %3d units %3d min" % (STORES[r[0]][1], "<->" if all(any(l[0] == d for l in r[3]) for d in (0, 1)) else "-> ",
                          STORES[r[1]][1], sum(l[2] for l in r[3]), r[2]))

    # each store on its own, as if no other store swaps ("Best for each store", the page's default):
    # mine[mode][step][store] = that store's plan
    mine = {"all": [], "swaps": []}
    for mode in ("all", "swaps"):
        swaps = mode == "swaps"
        for T in steps:
            row = [keep(solve(T, swaps, s)) for s in range(n)]
            mine[mode].append(row)
            print("%-5s %3d min, each store: %d runs between them" % (mode, T, sum(len(plans[k]["runs"]) for k in row)), flush=True)

    area_need = SLD.sum(axis=0) * RULES["horizon"] / args.days
    short = [{"item": i, "short": int(round((area_need[i] - STK[:, i].sum()) / 10.0) * 10),
              "stock": int(STK[:, i].sum()), "sold": int(SLD[:, i].sum())}
             for i in range(ni) if area_need[i] - STK[:, i].sum() >= 10]
    short.sort(key=lambda s: -s["short"])

    doc = {
        "made": datetime.date.today().isoformat(),
        "stockDate": args.stock_date, "sales": args.sales, "days": args.days,
        "rules": RULES, "steps": steps, "items": head,
        "stores": [{"name": s[1], "lat": s[3], "lng": s[4]} for s in STORES],
        "index": index, "mine": mine, "plans": plans, "short": short,
        "spare": sur.astype(int).tolist(), "need": need.astype(int).tolist(), "low": low.astype(int).tolist(),
    }
    if args.only:
        return
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
        f.write("\n")
    print("Wrote %s: %d different plans, %.0f KB" % (args.out, len(plans), os.path.getsize(args.out) / 1024))


if __name__ == "__main__":
    main()
