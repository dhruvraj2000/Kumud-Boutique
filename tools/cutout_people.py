# Person cutouts for the lifestyle photos in raw/lifestyle -> cutouts/lifestyle (run from project root).
import glob, os, sys
from rembg import remove, new_session
from PIL import Image
sess = new_session(sys.argv[1] if len(sys.argv) > 1 else "isnet-general-use")
model = sys.argv[1] if len(sys.argv) > 1 else "isnet-general-use"
out_dir = "cutouts/lifestyle" + ("" if model == "isnet-general-use" else "/" + model)
os.makedirs(out_dir, exist_ok=True)
for f in sorted(glob.glob("raw/lifestyle/*.jpg")):
    out = out_dir + "/" + os.path.basename(f).replace(".jpg", ".png")
    if os.path.exists(out): continue
    im = Image.open(f).convert("RGB")
    r = remove(im, session=sess) if model != "isnet-general-use" else remove(im, session=sess, alpha_matting=True, alpha_matting_foreground_threshold=240,
               alpha_matting_background_threshold=15, alpha_matting_erode_size=8)
    r.save(out); print("ok", out, flush=True)
