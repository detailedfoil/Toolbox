"""Makes coin test photos for the Photo Coin Counter (tools/till-count). Run from .github:
  PILES=1 python3 till-count/make-piles.py tests/fixtures till-count/sprites.json /tmp/piles   (needs numpy and Pillow)
sprites.json: the real coins in the two test photos (middle, size, and whether a 20p stands clear). Without PILES it
makes mixed-coin photos (left over from Photo Coin Counter 2, removed 22 Oct 2026). Originally: makes mixed-coin test photos from the two real photos (real 10p and 20p coins). Other coins are made from
those: 5p and 50p by size, 1p and 2p recoloured copper, the £2 and the twelve-sided £1 with a gold ring.
With PILES=1: piles of one coin each for the first Photo Coin Counter (tools/till-count), some on wood.jpg
(bare wood from a real phone photo, warm light and shadows). Writes <name>.jpg and <name>.json (the coins as placed: x, y, coin) into the folder given."""
import json, math, random, sys
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

FIX = sys.argv[1]; SPR = json.load(open(sys.argv[2])); OUT = sys.argv[3]
MM = {'c1': 20.3, 'c2': 25.9, 'c5': 18.0, 'c10': 24.5, 'c20': 21.4, 'c50': 27.3, 'c100': 23.43, 'c200': 28.4}

def load(f):
    return np.asarray(Image.open(FIX + '/' + f).convert('RGB')).astype(np.float32)

PH = {f: load(f) for f in ['coins-10p.jpg', 'coins-20p.jpg']}

def desk_distance_mask(img, c, desk):
    x0, y0, R = c['x'], c['y'], c['r']
    h, w, _ = img.shape
    b = int(R * 1.25) + 2
    xs, ys = int(x0) - b, int(y0) - b
    crop = img[max(0, ys):ys + 2 * b, max(0, xs):xs + 2 * b]
    d = np.sqrt(((crop - desk) ** 2).sum(axis=2))
    yy, xx = np.mgrid[0:crop.shape[0], 0:crop.shape[1]]
    rr = np.hypot(xx + max(0, xs) - x0, yy + max(0, ys) - y0)
    m = ((d > 48) & (rr < R * 1.1)) | (rr < R * 0.85)
    # fill: everything inside the outermost coin pixel along each angle
    ang = np.arctan2(yy + max(0, ys) - y0, xx + max(0, xs) - x0)
    bins = ((ang + math.pi) / (2 * math.pi) * 180).astype(int) % 180
    edge = np.zeros(180)
    for k in range(180):
        sel = (bins == k) & m
        edge[k] = rr[sel].max() if sel.any() else R
    # smooth the outline a touch (a lone speck shouldn't make a spike)
    e2 = np.array([np.median(np.take(edge, range(k - 2, k + 3), mode='wrap')) for k in range(180)])
    mask = rr <= e2[bins] - 0.8
    return crop, mask.astype(np.float32), (x0 - max(0, xs), y0 - max(0, ys))

def sprite(kind, rng):
    """an RGBA sprite of a real 10p (round) or 20p (seven-sided) coin, its middle, and its average radius"""
    if kind == 'round':
        c = rng.choice(SPR['coins-10p.jpg']); img = PH['coins-10p.jpg']
        R = c['r'] - 1.2
        b = int(R) + 3
        crop = img[int(c['y']) - b:int(c['y']) + b + 1, int(c['x']) - b:int(c['x']) + b + 1]
        yy, xx = np.mgrid[0:crop.shape[0], 0:crop.shape[1]]
        cx, cy = c['x'] - (int(c['x']) - b), c['y'] - (int(c['y']) - b)
        rr = np.hypot(xx - cx, yy - cy)
        mask = np.clip(R + 0.5 - rr, 0, 1)
        return crop, mask, (cx, cy), R
    c = rng.choice([s for s in SPR['coins-20p.jpg'] if s['clear']]); img = PH['coins-20p.jpg']
    crop, mask, (cx, cy) = desk_distance_mask(img, c, np.array([182, 182, 182], np.float32))
    return crop, mask, (cx, cy), c['r']

def ramp(L, anchors):
    """greys to a metal: anchors are (grey, (r, g, b)) pairs"""
    xs = [a[0] for a in anchors]
    return np.stack([np.interp(L, xs, [a[1][i] for a in anchors]) for i in range(3)], axis=2)

COPPER = [(0, (20, 8, 4)), (60, (85, 42, 26)), (150, (178, 104, 68)), (230, (246, 186, 150)), (255, (255, 225, 205))]
GOLD = [(0, (20, 16, 6)), (60, (78, 62, 28)), (150, (182, 156, 88)), (230, (246, 232, 170)), (255, (255, 248, 215))]

def make_coin(coin, px_per_mm, rng, tint=1.0):
    kind = 'hept' if coin in ('c20', 'c50') else 'round'
    crop, mask, (cx, cy), R = sprite(kind, rng)
    target = MM[coin] / 2 * px_per_mm
    # a seven-sided coin's traced size is its average radius, 0.4956 of its width
    if kind == 'hept': target = MM[coin] * 0.4956 * px_per_mm
    if coin == 'c100': target = MM[coin] / 2 * px_per_mm  # corners on the circle, flats cut in below
    s = target / R
    im = Image.fromarray(np.clip(crop, 0, 255).astype(np.uint8))
    mk = Image.fromarray((mask * 255).astype(np.uint8))
    W, H = im.size
    nw, nh = max(4, int(round(W * s))), max(4, int(round(H * s)))
    im = im.resize((nw, nh), Image.BICUBIC); mk = mk.resize((nw, nh), Image.BICUBIC)
    cx, cy = cx * nw / W, cy * nh / H
    a = np.asarray(im).astype(np.float32); m = np.asarray(mk).astype(np.float32) / 255
    L = a @ np.array([0.299, 0.587, 0.114], np.float32)
    yy, xx = np.mgrid[0:nh, 0:nw]
    rr = np.hypot(xx - cx, yy - cy)
    if coin in ('c1', 'c2'):
        a = ramp(np.clip(L * tint, 0, 255), COPPER)
    elif coin in ('c100', 'c200'):
        ring = rr > target * (0.66 if coin == 'c100' else 0.70)
        g = ramp(L, GOLD)
        a = np.where(ring[..., None], g, a * np.array([0.98, 1.0, 1.02], np.float32))
        if coin == 'c100':  # twelve flat sides: corners on the circle, flats at cos 15 degrees
            ang = np.arctan2(yy - cy, xx - cx)
            seg = math.pi / 6
            b = np.mod(ang, seg) - seg / 2
            lim = target * math.cos(math.pi / 12) / np.cos(b)
            m = m * np.clip(lim + 0.5 - rr, 0, 1)
    rgba = np.dstack([np.clip(a, 0, 255), m * 255]).astype(np.uint8)
    spr = Image.fromarray(rgba, 'RGBA').rotate(rng.uniform(0, 360), resample=Image.BICUBIC, expand=False)
    return spr, (cx, cy), target

def scene(name, counts, size=(1400, 1050), px_per_mm=3.3, cast=(1, 1, 1), tilt=(0.0, 0.0), seed=1, gap=(3, 14), desk=(205, 205, 203), blur=0.5, bg=None, dim=1.0):
    rng = random.Random(seed); np.random.seed(seed)
    W, H = size
    yy, xx = np.mgrid[0:H, 0:W]
    light = 1 + 0.06 * (xx / W - 0.5) - 0.05 * (yy / H - 0.5)
    base = np.stack([np.full((H, W), desk[i], np.float32) * light for i in range(3)], axis=2)
    base += np.random.normal(0, 2.2, base.shape)
    if bg: base = np.asarray(Image.open(bg).convert('RGB').resize((W, H))).astype(np.float32)
    canvas = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert('RGBA')
    shadow = Image.new('L', (W, H), 0)
    sd = ImageDraw.Draw(shadow)
    coins = [c for c, n in counts.items() for _ in range(n)]
    rng.shuffle(coins)
    placed = []
    for coin in coins:
        for attempt in range(400):
            x, y = rng.uniform(60, W - 60), rng.uniform(60, H - 60)
            u, v = (x - W / 2) / max(W, H), (y - H / 2) / max(W, H)
            k = px_per_mm * math.exp(tilt[0] * u + tilt[1] * v)
            r = MM[coin] / 2 * k
            if all(math.hypot(x - p['x'], y - p['y']) > r + p['r'] + rng.uniform(*gap) for p in placed):
                break
        else:
            continue
        spr, (cx, cy), target = make_coin(coin, k, rng, tint=rng.uniform(0.7, 1.05))
        sd.ellipse([x - r + 2, y - r + 3, x + r + 3, y + r + 4], fill=70)
        placed.append({'x': x, 'y': y, 'r': r, 'coin': coin, 'spr': spr, 'c': (cx, cy)})
    shadow = shadow.filter(ImageFilter.GaussianBlur(3))
    dark = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    canvas = Image.composite(dark, canvas, shadow.point(lambda v: int(v * 0.45)))
    for p in placed:
        sx, sy = p['spr'].size
        canvas.alpha_composite(p['spr'], (int(round(p['x'] - sx / 2)), int(round(p['y'] - sy / 2))))
    img = canvas.convert('RGB')
    if blur: img = img.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(img).astype(np.float32) * np.array(cast, np.float32) * dim
    a += np.random.normal(0, 1.5, a.shape)
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(OUT + '/' + name + '.jpg', quality=88)
    json.dump({'coins': [{'x': round(p['x'], 1), 'y': round(p['y'], 1), 'coin': p['coin']} for p in placed]}, open(OUT + '/' + name + '.json', 'w'))
    print(name, len(placed), 'coins', {c: sum(1 for p in placed if p['coin'] == c) for c in MM})

import os
if os.environ.get('PILES'):
    WOOD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wood.jpg')
    for i, k in enumerate(['c1', 'c2', 'c5', 'c10', 'c20', 'c50', 'c100', 'c200']):
        scene('wood-' + k, {k: 30}, bg=WOOD, gap=(1, 10), seed=100 + i)
        scene('touch-' + k, {k: 40}, gap=(0, 2), cast=(1.07, 1.0, 0.86), dim=0.75, seed=200 + i)
        scene('tilt-' + k, {k: 35}, bg=WOOD, tilt=(0.1, 0.3), px_per_mm=2.6, size=(1200, 900), blur=1.0, seed=300 + i)
    sys.exit()
if os.environ.get('HARD'):
    mix = {'c1': 6, 'c2': 4, 'c5': 5, 'c10': 5, 'c20': 6, 'c50': 3, 'c100': 3, 'c200': 2}
    scene('h-touching', mix, gap=(0, 2), seed=21)
    scene('h-small', mix, px_per_mm=2.3, size=(1000, 750), seed=22)
    scene('h-blurry', mix, blur=1.2, seed=23)
    scene('h-cool', mix, cast=(0.9, 1.0, 1.12), seed=24)
    scene('h-greydesk', mix, desk=(150, 152, 155), seed=25)
    scene('h-wooddesk', mix, desk=(196, 168, 128), seed=26)
    scene('h-tilt', mix, tilt=(0.1, 0.32), seed=27)
    scene('h-darkcopper', {'c1': 8, 'c2': 6, 'c10': 4, 'c20': 4}, seed=28)
    scene('h-onlycopper', {'c1': 7, 'c2': 5}, seed=29)
    scene('h-onlytwo', {'c100': 5, 'c200': 4}, seed=30)
    scene('h-tray2', {'c1': 14, 'c2': 8, 'c5': 10, 'c10': 9, 'c20': 10, 'c50': 4, 'c100': 5, 'c200': 3}, size=(1800, 1350), gap=(0, 5), tilt=(0.0, 0.15), seed=31)
    sys.exit()
scene('mixed-all', {'c1': 5, 'c2': 4, 'c5': 5, 'c10': 5, 'c20': 5, 'c50': 4, 'c100': 4, 'c200': 3}, seed=11)
scene('mixed-warm', {'c1': 4, 'c2': 4, 'c5': 4, 'c10': 4, 'c20': 4, 'c50': 3, 'c100': 3, 'c200': 3}, cast=(1.07, 1.0, 0.86), tilt=(0.05, 0.22), seed=12)
scene('mixed-silver', {'c5': 7, 'c10': 7, 'c20': 7, 'c50': 6}, seed=13)
scene('mixed-tray', {'c1': 10, 'c2': 6, 'c5': 8, 'c10': 8, 'c20': 9, 'c50': 3, 'c100': 4, 'c200': 2}, size=(1600, 1200), gap=(1, 8), tilt=(0.0, 0.12), seed=14)
scene('mixed-few', {'c10': 1, 'c20': 2, 'c1': 1}, size=(1000, 750), px_per_mm=3.6, seed=15)
