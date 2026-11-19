#!/usr/bin/env python3
"""Warehouse Shift: the products the game puts on its shelves.

    python3 .github/warehouse-shift/make-catalogue.py

Reads Product Search's list (tools/product-search/data/products.json: code, ILS name, flags) and keeps every product
that was in the latest stock export (flag 32 off): the 10,999 nailed products on 25 Oct 2026. Each one gets
  - a group (screws, plumbing fittings, paint ...) so like sits next to like on the shelves,
  - a size: T = tray (small parts, AA areas), S = shelf (boxed, BA areas and the shelves above the AA trays),
    B = bulky (BB areas),
  - the colour of its saved photo (tools/product-search/photos/CODE.jpg), so boxes too far away for their photo still
    look like the product (DeWalt yellow, Makita teal), and whether it has a photo at all.
Writes tools/warehouse-shift/data/catalogue.json. Nothing store-specific: codes and names are already public in
products.json. The game's layout and locations are made up (detailedfoil can't publish the real one)."""
import json, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'tools', 'product-search', 'data', 'products.json')
PHOTOS = os.path.join(ROOT, 'tools', 'product-search', 'photos')
OUT = os.path.join(ROOT, 'tools', 'warehouse-shift', 'data', 'catalogue.json')

# First match wins: (group, size, pattern). Sizes: T tray, S shelf, B bulky.
RULES = [
    # back boxes sit in the bulk aisles in a real Screwfix (bought by the 50)
    ('backbox', 'B', r'\b\d ?gang\b.*\b(box|\d+ ?mm)\b|\bback ?box|dry ?lining box|pattress|moulded box|adaptable box'),
    ('bulky', 'B', r'radiator|\btoilet|\bwc\b|close coupled|cistern|\bbasin\b|pedestal|vanity unit|kitchen sink|\bsink\b(?!.*(waste|plug|trap))'
        r'|\bbath\b(?!.*(trap|waste|seal|panel clip|filler|tap|mixer|sheen|room|mat))|shower tray|enclosure|shower door|bath screen|boiler(?! ?(cover|spanner))|unvented|water heater'
        r'|step ?ladder|\bladder\b|wheelbarrow|sack truck|platform truck|workbench|work ?bench|saw ?horse|trestle|mitre saw|table saw|planer thicknesser'
        r'|compressor(?! fitting)|generator|pressure washer|vacuum|wet ?/ ?dry|extractor(?! fan)|dust extractor|dehumidifier|\bsafe\b(?! plate)|storage box|\btub\b'
        r'|\bcrates?\b|bucket|wheelie|\bbins?\b(?! (liner|bag))|plasterboard(?! screw)|\bosb\b|\bmdf\b|plywood|tarpaulin|hose reel|cable reel|\bdrum\b'
        r'|worktop|shelving unit|racking|tool chest|roller cabinet|tool ?box|tool bag|storage unit|organiser case|wall cabinet|mirror cabinet'
        r'|floodlight|lawn ?mower|strimmer|hedge ?trimmer|chainsaw|leaf blower|heater(?! (element|cranked|spanner|key))|convector|oil filled'
        r'|(?<![\d.])(5|10|12|15|20|25) ?(l|ltr|litre|litres)\b|(?<![\d.])(5|10|15|20|25) ?kg\b|\bcement\b|\bmortar\b(?! rake)|\bconcrete\b(?! screw)|ballast|compost|multi-?finish|bonding coat|screed'
        r'|\b(50|100) ?m\b(?!m)|\b(25|30) ?m\b(?!m).*(cable|hose|flex)|\bcable\b.*\b(50|100) ?m\b|insulation roll|loft roll|membrane|underlay|matting'
        r'|\b3 ?m\b(?!m)|\b4 ?m\b(?!m)|\b2 ?m\b(?!m)|\b2\.5 ?m\b(?!m)|\b3000 ?mm\b|\b2400 ?mm\b|\bpipe\b.*\beach\b|downpipe|gutter|trunking|conduit'
        r'|door (bar|threshold)|\bdoors?\b(?! (stop|handle|knob|wedge|closer|chain|viewer|guard|hinge|bolt|lock|latch|vent))|loft hatch|paving|\bslab\b|drainage channel'
        r'|wardrobe rail|fence|\bgate\b(?! (spring|hinge|latch|bolt))|decking board|timber|sleeper|pallet|kneeler|scaffold|tower|wallpaper stripper'
        r'|fan (heater)|\bfan\b(?! (isolator|spur|timer))|air con|log splitter|\bchair\b|\btable\b'),
    ('screws', 'T', r'\bscrews?\b|wafer|coach screw|chipboard|silverscrew|goldscrew|turbogold|turbo gold|timba|easydrive|screwtite|\bspax\b|\btek\b'
        r'|self[ -]?drill|drywall screw|decking screw|frame fixing|hammer fixing|concrete screw|\bthrubolt|through bolt|turbosilver|quicksilver|ultrascrew|\bcsk\b'
        r'|\b\d+(\.\d)? ?x ?\d+ ?(mm)? ?(pk|pack)? ?\d{2,4}\b(?!.*(blade|bit|disc|drill|holesaw|sds))'),
    ('fixings', 'T', r'\bbolts?\b|\bnuts?\b|\bwashers?\b|wall plugs?|rawlplug|\bplugs?\b(?!.*(socket|13a|fused|bath|basin|sink|top))|\banchors?\b'
        r'|\bfixings?\b|\bnails?\b|\brivets?\b|threaded rod|studding|cavity|spring toggle|hollow wall|\bpins?\b|staples?|\bhooks?\b|eyes?\b.*\bpk'
        r'|cup hook|\bclips?\b|cable ties?|\btie wraps?|\bsaddles?\b|angle plate|mending plate|corner brace|\bbrackets?\b|joist hanger|\bshims?\b|packers?'),
    ('plumbing', 'T', r'\belbows?\b|\btees?\b|\bcouplers?\b|couplings?|reducers?|stop ends?|adaptors?|adapters?|\bolives?\b|compression|push ?fit|pushfit'
        r'|end feed|solder ring|endex|hep2o|speedfit|polyplumb|tectite|sharkbite|tap connector|isolating valve|service valve|serv valv|stop ?valve|stop ?cock'
        r'|\bvalves?\b|\bflexi|tap tails?|\bbends?\b|\bknuck|\bwye\b|\bsocket\b.*\b(15|22|28) ?mm|\bmanifold|\bunion|\bnipple|\bbush\b|\bplug\b.*\bbsp|ptfe'
        r'|solder|flux|\btrap\b|\bwaste\b|\boverflow|bottle trap|o-?rings?|tap washer|\bseals?\b'),
    ('electrical', 'T', r'\bwago\b|\bconnectors?\b|terminal|\bfuses?\b|crimp|\bglands?\b|grommet|blanking|\bmcb\b|\brcbo\b|\brcd\b|breaker|\bspur\b'
        r'|\bswitch(es)?\b|\bsockets?\b|\bskt\b|\b13a\b|\b\dg\b|dimmer|\bgrid\b|\bmodule\b|\brj45|\bcoax|\bcat ?[56]|junction box|\bconsumer unit|\bcsu\b|insulation tape|\btape\b.*\bpvc'
        r'|\bflex\b|\bcable\b|\bplugs?\b'),
    ('lighting', 'T', r'\bgu10\b|\bmr16\b|\be27\b|\be14\b|\bb22\b|\bbc\b|\bses\b|\bbulbs?\b|\blamps?\b|\bled\b.*\b(lm|lumen|w)\b(?!.*(batten|panel|flood|downlight))'),
    ('batteries', 'T', r'batter(y|ies)\b(?!.*(drill|driver|kit|charger|starter|pack 18v|\d\.\d ?ah|\bah\b))|\b(aa|aaa|9v|c|d|cr2032|lr44)\b.*\b(pk|pack|blister)'),
    ('bits', 'T', r'\bhss\b|\btct\b|sandpaper|drill bits?|\bbits?\b|bit set|holesaws?|hole saw|\bblades?\b|cutting discs?|\bdiscs?\b|sanding (sheets?|discs?|pads?)|abrasive|countersink|\bchisel\b.*sds'
        r'|\bsds\b.*(drill|bit|chisel)|\bkeys?\b(?!.*(safe|box))|\bsprings?\b|\bmagnets?\b|\bkeyring|\bcaps?\b|\bcovers?\b.*\bpk|\bknobs?\b|\bcatch(es)?\b|\blatch(es)?\b|escutcheon|\bhinges?\b'),
    ('sealants', 'S', r'silicone|sealant|caulk|\bfiller\b|adhesive|\bglue\b|\bfoam\b|grab|no more nails|\bmastic|\bepoxy|\bputty|\bgrout|\b(290|300|310|380|400) ?ml\b'),
    ('paint', 'S', r'\bpaint|emulsion|gloss|\bstain\b|varnish|primer|undercoat|masonry|sandtex|dulux|zinsser|ronseal|cuprinol|\bronseal|\bwax\b|\boil\b.*\b(l|ltr|litre)\b'
        r'|\broller|\bbrush(es)?\b|paint ?tray|masking|dust sheet|decorat'),
    ('powertools', 'S', r'\b(18|12|10\.8|36|54) ?v\b|\b\d{3,4} ?w\b|cordless|\bbare\b|\bbrushless\b|\bcharger\b|\bdrill driver|combi|impact driver|\bsds\b|grinder'
        r'|\bjigsaw|circular saw|recip|multi[ -]?tool|\bsander|\brouter\b|\bplaner\b|heat gun|\bnailer|\bkit\b.*\b(dewalt|makita|milwaukee|bosch|titan|erbauer|ryobi)'),
    ('workwear', 'S', r'\bgloves?\b|glasses|goggles|\bboots?\b|trainers?|trousers?|\bshorts\b|jacket|\bfleece|hoodie|t-?shirt|polo|hi-?vis|\bvest\b|hard ?hat|helmet'
        r'|ear ?(muffs?|defenders|plugs)|\bmask\b|respirator|knee ?pads?|overalls?|coveralls?|\bsocks?\b|\bbelt\b|\bbeanie|\bcap\b.*(site|dewalt)'),
    ('handtools', 'S', r'hammer|screwdriver|spanner|wrench|pliers|cutters?|snips|\bsaws?\b|\bknife|\bknives|tape measure|\blevels?\b|spirit|\bchisel|\bfile\b|\brasp\b'
        r'|trowel|float\b|\bspade|shovel|\bfork\b|\brake\b|crowbar|wrecking bar|pry bar|\bclamps?\b|vice\b|socket set|ratchet|allen|hex key|torx|stanley|magnusson|forge steel'),
    ('bathroom', 'S', r'\btaps?\b|mixer|shower|\bbath\b|\bbasin\b|toilet seat|\bwc\b|flush|cistern|\bhose\b|\bhead\b'),
    ('heating', 'S', r'thermostat|\btrv\b|radiator (valve|key|bleed|bracket)|lockshield|wheelhead|\bpump\b|inhibitor|\bfernox|sentinel|expansion vessel|\bimmersion'),
    ('lights', 'S', r'downlight|batten|\bpanel\b.*\bled|\blight\b|lantern|bulkhead|\bpir\b|sensor|doorbell|smoke alarm|heat alarm|\balarm\b|\bcamera\b'),
]
RULES = [(g, s, re.compile(p, re.I)) for g, s, p in RULES]
ORDER = ['screws', 'fixings', 'plumbing', 'electrical', 'lighting', 'batteries', 'bits', 'sealants', 'paint', 'powertools', 'handtools',
         'workwear', 'bathroom', 'heating', 'lights', 'other', 'backbox', 'bulky']


def classify(name):
    n = ' ' + name.lower().replace('_', ' ') + ' '
    for g, s, rx in RULES:
        if rx.search(n):
            # a small part named with a long size ("Plug 13A 3m"?) stays a small part; tiny packs are never bulky
            return g, s
    return 'other', 'S'


def colour(code):
    """The product's colour: the average of its photo's pixels that aren't the white background, nudged brighter."""
    path = os.path.join(PHOTOS, code + '.jpg')
    if not os.path.exists(path):
        return None
    from PIL import Image
    try:
        im = Image.open(path).convert('RGB').resize((24, 24))
    except Exception:
        return None
    px = [p for p in (im.get_flattened_data() if hasattr(im, 'get_flattened_data') else im.getdata()) if not (p[0] > 228 and p[1] > 228 and p[2] > 228)]
    if len(px) < 12:
        return 'e8e8e6'
    r = sum(p[0] for p in px) / len(px); g = sum(p[1] for p in px) / len(px); b = sum(p[2] for p in px) / len(px)
    # the most colourful pixels say more about a product than the average (a yellow DeWalt with black bits)
    sat = sorted(px, key=lambda p: max(p) - min(p), reverse=True)[:max(6, len(px) // 4)]
    if sat and (max(sat[0]) - min(sat[0])) > 60:
        r2 = sum(p[0] for p in sat) / len(sat); g2 = sum(p[1] for p in sat) / len(sat); b2 = sum(p[2] for p in sat) / len(sat)
        r, g, b = (r + 2 * r2) / 3, (g + 2 * g2) / 3, (b + 2 * b2) / 3
    return '%02x%02x%02x' % tuple(int(max(0, min(255, v * 0.9 + 22))) for v in (r, g, b))


def main():
    src = json.load(open(SRC, encoding='utf-8'))
    items = []
    counts = {}
    for code, name, flags in src['items']:
        if flags & 32:  # not in the latest stock export: not nailed anywhere
            continue
        g, s = classify(name)
        c = colour(code)
        counts[s] = counts.get(s, 0) + 1
        items.append([code, re.sub(r'\s+', ' ', name).strip(), g, s, c or '', 1 if c else 0])
    items.sort(key=lambda it: (ORDER.index(it[2]), it[1].lower(), it[0]))
    out = {
        'version': src.get('version'),
        'note': "Made by .github/warehouse-shift/make-catalogue.py from Product Search's list: code, name, group, size (T tray, S shelf, B bulky), photo colour, has a photo.",
        'count': len(items),
        'groups': ORDER,
        'items': items,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('{"version":%s,"note":%s,"count":%d,"groups":%s,"items":[\n' % (json.dumps(out['version']), json.dumps(out['note']), out['count'], json.dumps(ORDER)))
        f.write(',\n'.join(json.dumps(it, ensure_ascii=False, separators=(',', ':')) for it in items))
        f.write('\n]}\n')
    groups = {}
    for it in items:
        groups[it[2]] = groups.get(it[2], 0) + 1
    print('Wrote %d products to %s' % (len(items), os.path.relpath(OUT, ROOT)))
    print('Sizes:', counts)
    print('Groups:', groups)


if __name__ == '__main__':
    sys.exit(main())
