# Model photos (raw/lifestyle) -> studio-backdrop catalogue shots + lookbook images.
# Needs person cutouts first:  python tools/cutout_people.py  and  python tools/cutout_people.py u2net_human_seg
# (the second writes to cutouts/lifestyle/u2net_human_seg/ when run with OUT_SUB below). Run from project root.
import os, numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, CUT = os.path.join(ROOT, "raw", "lifestyle"), os.path.join(ROOT, "cutouts", "lifestyle")
PROD, LOOK = os.path.join(ROOT, "public", "assets", "products"), os.path.join(ROOT, "public", "assets", "lookbook")
os.makedirs(LOOK, exist_ok=True)

def poly_mask(shape, pts):
    m = Image.new("L", (shape[1], shape[0]), 0); ImageDraw.Draw(m).polygon(pts, fill=255); return np.array(m) > 0

# Manual clean-up per photo (pixel coordinates in the original image).
FIX = {
    "green-pose": lambda m, Y, X: m & ~((X < 250) & (Y > 880) & (Y < 1000)),                 # garden bench
    "twinning": lambda m, Y, X: m & ~poly_mask(m.shape, [(522, 740), (622, 740), (622, 902), (592, 902), (566, 945),
                                                          (560, 1000), (545, 1050), (512, 1050), (516, 940)])
                                     & ~poly_mask(m.shape, [(558, 892), (610, 892), (600, 940), (583, 948), (564, 962)]),  # statue
    "kutch": lambda m, Y, X: m & poly_mask(m.shape, [(0, 0), (318, 0), (318, 820), (326, 1062), (292, 1082),
                                                      (242, 1350), (226, 1450), (214, 1600), (0, 1600)]),       # left girl only
}

SKY = {"green-pose", "green-twirl", "twinning"}

def matte(name, src):
    """Union of two segmentation models, holes filled, specks dropped, light edge feather."""
    a = np.array(Image.open(os.path.join(CUT, src + ".png")).convert("RGBA"))[..., 3].astype(float)
    b = np.array(Image.open(os.path.join(CUT, "u2net_human_seg", src + ".png")).convert("RGBA"))[..., 3].astype(float)
    u = np.maximum(a, b); m = ndi.binary_fill_holes(u > 110)
    Y, X = np.mgrid[:m.shape[0], :m.shape[1]]
    if name in FIX: m = FIX[name](m, Y, X)
    if src in SKY:   # blue sky seen through curls / between arm and body: key it out in the upper part
        px = np.array(Image.open(os.path.join(RAW, src + ".jpg")).convert("RGB")).astype(int)
        r, g, bl = px[..., 0], px[..., 1], px[..., 2]
        sky = (bl > r + 35) & (bl > g + 8) & (bl > 110) & (Y < m.shape[0] * 0.55)
        m &= ~ndi.binary_opening(sky, iterations=1)
    lab, k = ndi.label(m)
    if k > 1:
        sz = ndi.sum(m, lab, range(1, k + 1)); m = np.isin(lab, [j + 1 for j, s in enumerate(sz) if s > 0.05 * m.sum()])
    core = ndi.binary_erosion(m, iterations=3)
    alpha = np.where(core, 255, np.where(m, np.maximum(u, 0) * 0.6 + 255 * 0.4, 0))
    alpha = ndi.gaussian_filter(alpha, 0.7)
    return np.clip(alpha, 0, 255).astype(np.uint8)

def backdrop(w, h, tone):
    """Seamless studio paper: warm wall, lighter floor sweep, soft key-light glow behind the model."""
    top, mid, floor = [np.array(c, float) for c in tone]
    y = np.linspace(0, 1, h)[:, None, None]
    sweep = np.clip((y - 0.70) / 0.14, 0, 1)
    col = (top * (1 - y) + mid * y) * (1 - sweep) + floor * sweep
    img = np.repeat(col, w, axis=1)
    yy, xx = np.mgrid[:h, :w]
    glow = np.exp(-(((xx - w * 0.5) / (w * 0.45)) ** 2 + ((yy - h * 0.42) / (h * 0.42)) ** 2))
    img = img + glow[..., None] * 14
    vig = 1 - 0.07 * (((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    return Image.fromarray(np.clip(img * vig[..., None], 0, 255).astype(np.uint8))

TONES = {"ivory": [(236, 228, 221), (244, 238, 233), (249, 245, 241)],
         "blush": [(238, 224, 222), (245, 235, 232), (250, 244, 241)],
         "sand": [(232, 222, 210), (241, 234, 225), (248, 243, 237)]}

def grade(img):
    img = ImageEnhance.Contrast(img).enhance(1.05)
    img = ImageEnhance.Color(img).enhance(1.04)
    r, g, b = img.split()                                    # a touch of warmth, like soft studio light
    return Image.merge("RGB", (r.point(lambda v: min(255, int(v * 1.015 + 2))), g, b.point(lambda v: int(v * 0.985))))

def decontaminate(rgb, a):
    """Edge pixels pick up sky/wall colour; replace them with the nearest solid-interior colour."""
    A = np.array(a); core = ndi.binary_erosion(A > 250, iterations=2)
    _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
    px = np.array(rgb).astype(float); edge = (A > 0) & ~core
    px[edge] = px[edge] * 0.45 + px[iy[edge], ix[edge]] * 0.55       # blend, not replace: avoids streaks
    return Image.fromarray(px.astype(np.uint8))

def place(name, src, out, size, tone, height=0.84, bleed=False, x_frac=0.5, sharpen=True):
    rgb = grade(Image.open(os.path.join(RAW, src + ".jpg")).convert("RGB"))
    a = Image.fromarray(matte(name, src))
    box = a.point(lambda v: 255 if v > 30 else 0).getbbox()
    rgb, a = rgb.crop(box), a.crop(box)
    rgb = decontaminate(rgb, a)
    W, H = size
    s = min(H * height / a.height, W * 0.92 / a.width)
    nw, nh = round(a.width * s), round(a.height * s)
    rgb, a = rgb.resize((nw, nh), Image.LANCZOS), a.resize((nw, nh), Image.LANCZOS)
    if sharpen and s > 1.2: rgb = rgb.filter(ImageFilter.UnsharpMask(radius=2, percent=70, threshold=2))
    bg = backdrop(W, H, TONES[tone])
    x = int(W * x_frac - nw / 2); x = max(-nw // 3, min(W - nw * 2 // 3, x))
    y = H - nh if bleed else int(H * 0.935) - nh
    # contact shadow + soft drop shadow so the model sits on the floor
    sh = Image.new("L", (W, H), 0)
    if not bleed:
        d = ImageDraw.Draw(sh); bw = nw * 0.62; cx = x + nw / 2
        d.ellipse((cx - bw / 2, y + nh - 18, cx + bw / 2, y + nh + 26), fill=95)
    drop = Image.new("L", (W, H), 0); drop.paste(a, (x + 14, y + 10)); drop = drop.point(lambda v: v * 0.22)
    sh = Image.fromarray(np.maximum(np.array(sh), np.array(drop))).filter(ImageFilter.GaussianBlur(24))
    bg = Image.composite(Image.new("RGB", (W, H), (110, 96, 92)), bg, sh)
    # light wrap: let the backdrop colour bleed a little into the outer edge of the figure
    full_a = Image.new("L", (W, H), 0); full_a.paste(a, (x, y))
    edge = np.array(full_a).astype(float) / 255
    ring = np.clip(edge - ndi.grey_erosion(edge, size=(7, 7)), 0, 1) * 0.35
    fig = Image.new("RGB", (W, H)); fig.paste(rgb, (x, y))
    blur_bg = np.array(bg.filter(ImageFilter.GaussianBlur(8))).astype(float)
    fig = np.array(fig).astype(float) * (1 - ring[..., None]) + blur_bg * ring[..., None]
    out_img = Image.composite(Image.fromarray(fig.astype(np.uint8)), bg, full_a)
    return out_img

def save(img, path, sm=None):
    img.save(path, "WEBP", quality=88, method=6)
    if sm: img.resize(sm, Image.LANCZOS).save(path.replace(".webp", "-sm.webp"), "WEBP", quality=84, method=6)
    print("wrote", os.path.relpath(path, ROOT))

def graded_original(src, out, crop=None, maxw=1400):
    """Real background kept: crop, grade, gentle background softening for an editorial feel."""
    rgb = grade(Image.open(os.path.join(RAW, src + ".jpg")).convert("RGB"))
    a = Image.fromarray(matte(src, src)).filter(ImageFilter.GaussianBlur(6))
    soft = rgb.filter(ImageFilter.GaussianBlur(5))
    soft = ImageEnhance.Brightness(soft).enhance(1.03)
    img = Image.composite(rgb, soft, a)
    if crop: img = img.crop(crop)
    if img.width > maxw: img = img.resize((maxw, round(img.height * maxw / img.width)), Image.LANCZOS)
    save(img, os.path.join(LOOK, out + ".webp"))

if __name__ == "__main__":
    P = (1200, 1500)
    save(place("green-pose", "green-pose", "", P, "blush"), os.path.join(PROD, "hara-satin-1.webp"), (600, 750))
    save(place("green-twirl", "green-twirl", "", P, "blush", height=0.88), os.path.join(PROD, "hara-satin-2.webp"), (600, 750))
    save(place("kutch", "duo-mirror", "", P, "sand", height=0.97, bleed=True, x_frac=0.5), os.path.join(PROD, "kutch-rang-1.webp"), (600, 750))
    save(place("twinning", "twinning", "", P, "ivory", height=0.86), os.path.join(PROD, "twinning-patchwork-1.webp"), (600, 750))
    # lookbook: studio editorials + softened originals
    save(place("green-twirl", "green-twirl", "", (1600, 2000), "blush", height=0.88), os.path.join(LOOK, "look-hara-twirl.webp"))
    save(place("twinning", "twinning", "", (1600, 2000), "ivory", height=0.86), os.path.join(LOOK, "look-twinning.webp"))
    graded_original("green-pose", "look-hara-garden", crop=(0, 260, 738, 1600))
    graded_original("twinning", "look-twinning-street", crop=(0, 380, 1080, 1920))
    graded_original("patchwork-closeup", "look-patchwork-closeup", crop=(0, 0, 1080, 1700))
    graded_original("duo-mirror", "look-duo", crop=(0, 380, 738, 1600))
