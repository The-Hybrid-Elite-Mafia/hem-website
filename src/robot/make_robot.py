"""Turns Steven's hooded ghost robot art into a 3D relief for the player:
  1. cut him out of the background (U2-Net, via rembg),
  2. estimate how far each part sticks out (MiDaS v2.1 depth model),
  3. save colour+cut-out (WebP with alpha) and a 16-bit depth map (PNG) that the player turns into a mesh.
"""
import pathlib, sys
import numpy as np, onnxruntime as ort
from PIL import Image, ImageFilter
from rembg import remove, new_session

SRC = pathlib.Path('/mnt/user-data/uploads/326440.png')
MODELS = pathlib.Path('/tmp/claude-0/-home-claude/9e30626a-e6d6-5734-b1ea-7bf7a7806467/scratchpad/models')
OUT = pathlib.Path(__file__).parent / 'out'
OUT.mkdir(exist_ok=True)

img = Image.open(SRC).convert('RGB')
W, H = img.size

# 1. cut-out
import os
os.environ['U2NET_HOME'] = str(MODELS)
sess = new_session('u2net')
cut = remove(img, session=sess, post_process_mask=True)
alpha = np.asarray(cut.split()[-1]).astype(np.float32) / 255
# the floor reflection under the feet is not part of him: keep only the body above the lowest boot sole
rows = np.where(alpha.max(1) > 0.5)[0]
print('mask rows', rows.min(), rows.max(), 'of', H)
Image.fromarray((alpha * 255).astype(np.uint8)).save(OUT / 'mask_raw.png')

# 2. depth (MiDaS v2.1 large, 384x384 input, ImageNet normalisation; output = relative inverse depth, bigger = nearer)
net = ort.InferenceSession(str(MODELS / 'midas-v21.onnx'), providers=['CPUExecutionProvider'])
inp = net.get_inputs()[0]
x = np.asarray(img.resize((384, 384), Image.BICUBIC)).astype(np.float32) / 255
x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
x = x.transpose(2, 0, 1)[None].astype(np.float32)
d = net.run(None, {inp.name: x})[0].squeeze()
d = np.asarray(Image.fromarray(d.astype(np.float32)).resize((W, H), Image.BICUBIC))
np.save(OUT / 'depth_raw.npy', d)
print('depth range', float(d.min()), float(d.max()))

# 3. relief = model depth (detail) + roundness from the outline (volume), cropped to him
from scipy import ndimage
m = alpha > 0.5
m = ndimage.binary_opening(m, iterations=2)
lab, n = ndimage.label(m); sizes = ndimage.sum(m, lab, range(1, n + 1)); m = lab == (1 + int(np.argmax(sizes)))   # keep the robot only
ys, xs = np.where(m); y0, y1, x0, x1 = ys.min() - 8, ys.max() + 8, xs.min() - 8, xs.max() + 8
dv = d[m]; lo, hi = np.percentile(dv, 2), np.percentile(dv, 98)
dn = np.clip((d - lo) / (hi - lo), 0, 1)
dist = ndimage.distance_transform_edt(m)
infl = np.sqrt(dist / dist.max())
z = (0.55 * ndimage.gaussian_filter(dn, 3) + 0.45 * infl) * m
z = ndimage.gaussian_filter(z, 1.5) * m
z = z / z.max()
crop = lambda a: a[y0:y1, x0:x1]
rgba = np.dstack([np.asarray(img), (ndimage.gaussian_filter(m.astype(float), 0.7) * 255).astype(np.uint8)])
col = Image.fromarray(crop(rgba).astype(np.uint8), 'RGBA')
ch = 1024; cw = round(col.width * ch / col.height)
col.resize((cw, ch), Image.LANCZOS).save(OUT / 'robot-color.webp', quality=88, method=6)
gh = 360; gw = round(cw * gh / ch)
zd = Image.fromarray((crop(z) * 255).astype(np.uint8)).resize((gw, gh), Image.BILINEAR)
md = Image.fromarray((crop(m).astype(np.uint8) * 255)).resize((gw, gh), Image.BILINEAR)
Image.merge('LA', (zd, md)).save(OUT / 'robot-depth.png', optimize=True)
# glow spots (eyes, palm, chest, boots): bright cyan pixels, grouped
a = np.asarray(img).astype(int); cyan = (a[..., 2] > 200) & (a[..., 1] > 170) & (a[..., 0] < 140) & m
lab2, n2 = ndimage.label(ndimage.binary_dilation(cyan, iterations=6))
spots = []
for k in range(1, n2 + 1):
    yy, xx = np.where(lab2 == k)
    if yy.size < 120: continue
    spots.append([round(((xx.mean() - x0) / (x1 - x0)), 4), round(((yy.mean() - y0) / (y1 - y0)), 4), round(float(np.sqrt(yy.size) / (y1 - y0)), 4)])
import json; json.dump({'aspect': (x1 - x0) / (y1 - y0), 'grid': [gw, gh], 'glows': spots}, open(OUT / 'robot.json', 'w'))
print('crop', x1 - x0, 'x', y1 - y0, 'grid', gw, gh, 'glows', spots)
