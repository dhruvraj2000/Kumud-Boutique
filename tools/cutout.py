import sys, glob, os
from rembg import remove, new_session
from PIL import Image
sess = new_session(sys.argv[1] if len(sys.argv)>1 else "isnet-general-use")
os.makedirs("cutouts", exist_ok=True)
for f in sorted(glob.glob("raw/*.jpeg")):
    n = os.path.basename(f).split("at 11.23.")[1].replace(".jpeg","").replace(" ","")
    out = f"cutouts/{n}.png"
    if os.path.exists(out): continue
    im = Image.open(f).convert("RGB")
    r = remove(im, session=sess, alpha_matting=False)
    r.save(out); print("ok", out, flush=True)
