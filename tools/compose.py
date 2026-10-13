# Places each cutout (from tools/cutout.py) on a pure-white 1200x1500 catalogue canvas.
# Run from the project root:  python tools/compose.py
import os, numpy as np
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUT = os.path.join(ROOT, "cutouts")
OUT = os.path.join(ROOT, "public", "assets", "products")
W, H = 1200, 1500
# slug -> cutout name. indigo 07 is a near-duplicate of 07(2) and 08 is a duplicate of 08(1), so both are left out.
MAP = {"black-ajrakh-set": "05(2)", "white-patchwork-lehenga": "05(1)", "white-patchwork-detail": "07(1)",
       "maroon-ajrakh-lehenga": "05", "noir-blockprint-lehenga": "06(2)",
       "indigo-1": "06(1)", "indigo-2": "06", "indigo-3": "07(2)"}
FULL = {k for k in MAP if k != "white-patchwork-detail"}   # full-length looks share one scale

def hsv(a):
    r, g, b = [a[..., i].astype(float) / 255 for i in range(3)]
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    return mx, np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)

def rows(h, w): return np.arange(h)[:, None], np.arange(w)[None, :]

def fill_rows(m, y0, y1):
    """Make every row in [y0,y1) solid between its outermost opaque pixels (skirts are solid per row)."""
    m = m.copy()
    for y in range(y0, min(y1, m.shape[0])):
        xs = np.where(m[y])[0]
        if len(xs) > 1: m[y, xs[0]:xs[-1] + 1] = True
    return m

def fix(slug, a):
    a = a.copy(); h, w = a.shape[:2]; Y, X = rows(h, w); v, sat = hsv(a)
    m = a[..., 3] > 128
    if slug == "maroon-ajrakh-lehenga":
        # thin gold line-art behind the form: an opening removes strokes, then keep the body
        m = ndi.binary_opening(m, structure=np.ones((7, 7)))
        m &= ~(Y >= 757)                                   # round white pedestal below the hem
        m = fill_rows(m, 240, 757)
    if slug == "noir-blockprint-lehenga":
        # black skirt sits on a white pedestal: below the swirl drop pale low-saturation pixels, then the rim
        m &= ~((Y >= 740) & (v > 0.5) & (sat < 0.25)); m &= ~(Y >= 795)
        m = ndi.binary_opening(m, structure=np.ones((5, 5)))
    if slug == "black-ajrakh-set":
        m = fill_rows(m, 640, h)                           # cream hem stripes came out semi-transparent
    if slug == "white-patchwork-detail":
        m &= ~(Y < 566)
    a[..., 3] = (m * 255).astype(np.uint8)   # rembg keeps the original RGB under transparent pixels
    return a

def clean(a):
    m = a[..., 3] > 128
    lab, n = ndi.label(m)
    if n > 1:
        sizes = ndi.sum(m, lab, range(1, n + 1))
        m = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 0.04 * m.sum()])
    m = ndi.binary_fill_holes(m)
    soft = np.clip(ndi.gaussian_filter(m.astype(float), 0.8), 0, 1)
    a = a.copy(); a[..., 3] = (soft * 255).astype(np.uint8); return a

def prep(slug):
    im = clean(fix(slug, np.array(Image.open(os.path.join(CUT, MAP[slug] + ".png")).convert("RGBA"))))
    img = Image.fromarray(im)
    return img.crop(img.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox())

def render(slug, img, scale):
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    if scale > 1.4: img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))  # small sources
    rgb = ImageEnhance.Contrast(ImageEnhance.Color(img.convert("RGB")).enhance(1.06)).enhance(1.04)
    img = Image.merge("RGBA", (*rgb.split(), img.getchannel("A")))
    canvas = Image.new("RGB", (W, H), (255, 255, 255))
    x = (W - img.width) // 2
    y = H - int(H * 0.06) - img.height if slug in FULL else (H - img.height) // 2   # common floor line
    sh = Image.new("L", (W, H), 0); bw = img.width * 0.5; yb = y + img.height - 6
    ImageDraw.Draw(sh).ellipse((W / 2 - bw / 2, yb - 12, W / 2 + bw / 2, yb + 18), fill=60)
    canvas = Image.composite(Image.new("RGB", (W, H), (120, 112, 118)), canvas, sh.filter(ImageFilter.GaussianBlur(22)))
    edge = Image.new("L", (W, H), 0); edge.paste(img.getchannel("A"), (x, y))
    edge = edge.filter(ImageFilter.GaussianBlur(10)).point(lambda v: int(v * 0.14))   # keeps white garments' edges
    canvas = Image.composite(Image.new("RGB", (W, H), (150, 140, 145)), canvas, edge)
    canvas.paste(img, (x, y), img)
    canvas.save(os.path.join(OUT, slug + ".webp"), "WEBP", quality=90, method=6)
    canvas.resize((600, 750), Image.LANCZOS).save(os.path.join(OUT, slug + "-sm.webp"), "WEBP", quality=85, method=6)

imgs = {s: prep(s) for s in MAP}
for slug, img in imgs.items():
    if slug in FULL:   # same garment height on every card; widest pieces still fit the margins
        s = min(H * 0.86 / img.height, W * 0.88 / img.width)
    else:
        s = min(W * 0.84 / img.width, H * 0.88 / img.height)
    render(slug, img, s); print(slug, img.size, round(s, 2))
