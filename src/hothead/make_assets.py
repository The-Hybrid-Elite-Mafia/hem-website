"""Cut the moving parts out of the HOTHEAD faceplate picture so the page can redraw them:
knob ring background (all dots unlit), lit-dot layer, knob cap without its pointer, value box without digits,
and an OFF version of the power button. Everything stays at the picture's full resolution."""
import json, numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
P = np.asarray(Image.open('/home/claude/tablet3d/plates/HEM_HOTHEAD.png').convert('RGB'))
H, W = P.shape[:2]
CX, CY = 1572.2, 746.6
yy, xx = np.mgrid[0:H, 0:W]; d = np.hypot(xx - CX, yy - CY)
r, g, b = [P[..., i].astype(int) for i in range(3)]
bright = (g > 150) & (b > 150) & (r < 140)
teal = ((b - r > 25) & (g - r > 20)) | bright
ring = (d > 55) & (d < 112)
dots = ring & teal
marker = (d > 64) & (d < 94) & (g > 200) & (b > 200) & (b - r > 50) & (r > 90)
marker = cv2.dilate(marker.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
print('marker px', int(marker.sum()), 'at deg', float(np.degrees(np.arctan2((xx-CX)[marker].mean(), -(yy-CY)[marker].mean()))), 'd', float(d[marker].mean()))
MX = np.clip(np.round(2 * CX - xx).astype(int), 0, W - 1)          # mirror across the knob's vertical centre line
zone = cv2.dilate(marker.astype(np.uint8), np.ones((31, 31), np.uint8)) > 0
left = dots & (xx < CX)
dots = (dots & ~zone) | (left[yy, MX] & zone)                         # under the marker: the dots from the mirror side
dots = cv2.dilate(dots.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
dim_col = np.median(P[ring & teal & ~bright & (d > 60) & (d < 92)], axis=0)
lit_col = np.median(P[ring & bright & (d > 60) & (d < 92)], axis=0)
print('dim dot colour', dim_col, 'lit dot colour', lit_col)

def crop(a, x0, y0, x1, y1): return a[y0:y1, x0:x1]
K = 116; kx0, ky0, kx1, ky1 = int(CX - K), int(CY - K), int(CX + K), int(CY + K)
# knob background: every dot unlit; cap pointer and the light marker painted out
bg = P.copy()
pm = ((zone & (d > 64)) | (cv2.dilate(((d < 56) & teal).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0))
bg[pm] = P[yy[pm], MX[pm]]                                             # marker and cap pointer: copy the mirror side
lum = P.mean(2, keepdims=True) / 255
shade = np.clip(lum / max(lit_col.mean() / 255, 1e-3), 0.55, 1.0)
bg = np.where(dots[..., None], (dim_col * shade).astype(np.uint8), bg)
cap_r = 58
pointer = (d < cap_r) & bright
pointer = cv2.dilate((pointer | marker).astype(np.uint8), np.ones((5, 5), np.uint8))
Image.fromarray(crop(bg, kx0, ky0, kx1, ky1)).save('page/knob-bg.png')
# lit layer: dot shapes in the lit colour, transparent elsewhere
lit = np.zeros((H, W, 4), np.uint8)
lit[..., :3] = lit_col.astype(np.uint8); lit[..., 3] = np.where(dots, 255, 0)
Image.fromarray(crop(lit, kx0, ky0, kx1, ky1)).save('page/knob-lit.png')
# value box with the digits painted out
vx0, vy0, vx1, vy1 = 1456, 838, 1690, 900
dig = (bright | ((g > 110) & (b > 110) & (r < 110))) & (yy >= vy0) & (yy < vy1) & (xx >= vx0) & (xx < vx1)
dig = cv2.dilate(dig.astype(np.uint8), np.ones((5, 5), np.uint8))
vb = P.copy()
c0, c1 = int(np.nonzero(dig.any(0))[0].min()) - 4, int(np.nonzero(dig.any(0))[0].max()) + 5
src = np.arange(1470, 1500)
for c in range(c0, c1): vb[851:vy1, c] = P[851:vy1, 1476]
above = dig.copy(); above[851:, :] = 0
vb = cv2.inpaint(np.ascontiguousarray(vb), above, 3, cv2.INPAINT_TELEA)
Image.fromarray(crop(vb, vx0, vy0, vx1, vy1)).save('page/value-box.png')
digit_rows = np.nonzero(dig.any(1))[0]; digit_cols = np.nonzero(dig.any(0))[0]
# power button OFF: disc desaturated and darkened, ON letters painted out, OFF written in grey
bx, by, BR = 315, 1048, 92
bx0, by0, bx1, by1 = bx - BR, by - BR, bx + BR, by + BR
db = np.hypot(xx - bx, yy - by)
disc = (db < 70) & (((b - r) > 30) | ((g - r) > 30))
letters = (db < 50) & (g < 208) & (yy > by - 30)
letters = cv2.dilate(letters.astype(np.uint8), np.ones((7, 7), np.uint8))
off = cv2.inpaint(np.ascontiguousarray(P), letters, 4, cv2.INPAINT_TELEA)
L = off.mean(2, keepdims=True)
off = np.where((db < 67)[..., None], (np.clip(L * 0.32, 0, 255) * np.array([1.0, 1.04, 1.12])).clip(0, 255).astype(np.uint8), off)
im = Image.fromarray(crop(off, bx0, by0, bx1, by1))
f = ImageFont.truetype('/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf', 44)
dr = ImageDraw.Draw(im); tw = dr.textlength('OFF', font=f); dr.text((BR - tw / 2, BR - 30), 'OFF', font=f, fill=(150, 156, 172))
im.save('page/power-off.png')
# where everything sits, in faceplate-picture pixels
json.dump({'plate': [W, H], 'knob': {'cx': CX, 'cy': CY, 'box': [kx0, ky0, kx1, ky1], 'capR': cap_r, 'startDeg': -135, 'endDeg': 135},
           'value': {'box': [vx0, vy0, vx1, vy1], 'digits': [int(digit_cols.min()), int(digit_rows.min()), int(digit_cols.max()), int(digit_rows.max())],
                     'colour': [int(c) for c in lit_col]},
           'power': {'box': [bx0, by0, bx1, by1], 'r': 68}}, open('page/layout.json', 'w'), indent=1)

