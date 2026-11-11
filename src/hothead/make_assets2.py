"""Knob parts, second way: paint every ring dot and the light marker out of the picture (the track under them is plain
dark, so this is clean), paint out the cap pointer, and measure each dot (angle, distance, size) so the page can
redraw the ring at any DRIVE value."""
import json, numpy as np, cv2
from PIL import Image
P = np.asarray(Image.open('/home/claude/tablet3d/plates/HEM_HOTHEAD.png').convert('RGB'))
H, W = P.shape[:2]
CX, CY = 1572.2, 746.6
yy, xx = np.mgrid[0:H, 0:W]; d = np.hypot(xx - CX, yy - CY)
ang = np.degrees(np.arctan2(xx - CX, -(yy - CY)))
r, g, b = [P[..., i].astype(int) for i in range(3)]
teal = (b - r > 25) & (g - r > 20)
ring = (d > 58) & (d < 100)
dotm = ring & teal
marker = ring & (g > 200) & (b > 200) & (b - r > 50) & (r > 90)
# measure the dots on the left half (no marker there), mirror for the right half
n, lab, st, cen = cv2.connectedComponentsWithStats((dotm & (xx < CX - 2) & (d > 60) & (d < 92)).astype(np.uint8), 8)
dots = []
for i in range(1, n):
    if st[i, 4] < 12: continue
    m = lab == i
    a = float(np.degrees(np.arctan2(cen[i, 0] - CX, -(cen[i, 1] - CY))))
    rr = float(np.hypot(cen[i, 0] - CX, cen[i, 1] - CY))
    # size along the ring (tangential) and across it (radial)
    t = np.radians(a); ux, uy = np.sin(t), -np.cos(t)          # radial direction
    py, px = np.nonzero(m); dx, dy = px - cen[i, 0], py - cen[i, 1]
    rad = dx * ux + dy * uy; tan = dx * (-uy) + dy * ux
    dots.append({'a': round(a, 2), 'r': round(rr, 2), 'len': round(float(rad.max() - rad.min() + 1), 1), 'wid': round(float(tan.max() - tan.min() + 1), 1)})
dots.sort(key=lambda q: q['a'])
print(len(dots), 'dots on the left; angles', dots[0]['a'], '..', dots[-1]['a'])
gaps = np.diff([q['a'] for q in dots]); print('spacing deg', round(float(np.median(gaps)), 2))
full = dots + [{**q, 'a': -q['a']} for q in reversed(dots) if abs(q['a']) > 1.0]
mk = np.nonzero(marker); print('marker r', round(float(d[marker].mean()), 1), 'size', round(float(np.sqrt(marker.sum() / np.pi)), 1))
# paint out dots + marker (dark track) and the cap pointer
paint = cv2.dilate((dotm | marker).astype(np.uint8), np.ones((5, 5), np.uint8))
ptr = (d < 56) & (b - r > 40)
paint |= cv2.dilate(ptr.astype(np.uint8), np.ones((5, 5), np.uint8))
bg = cv2.inpaint(np.ascontiguousarray(P), paint, 4, cv2.INPAINT_TELEA)
K = 116; box = [int(CX - K), int(CY - K), int(CX + K), int(CY + K)]
Image.fromarray(bg[box[1]:box[3], box[0]:box[2]]).save('page/knob-bg.png')
lit_col = np.median(P[ring & (g > 150) & (b > 150) & (r < 140)], axis=0); dim_col = np.median(P[dotm & ~((g > 150) & (b > 150))], axis=0)
mcol = np.median(P[marker], axis=0)
# pointer: where it starts and ends on the cap
pd = d[ptr]; print('pointer from', round(float(pd.min()), 1), 'to', round(float(pd.max()), 1), 'px', int(ptr.sum()))
L = json.load(open('page/layout.json'))
L['knob'].update({'box': box, 'dots': full, 'dim': [int(c) for c in dim_col], 'lit': [int(c) for c in lit_col], 'marker': {'r': round(float(d[marker].mean()), 1), 'size': 9.5, 'col': [int(c) for c in mcol]},
                  'pointer': [round(float(pd.min()), 1), round(float(pd.max()), 1)], 'startDeg': round(min(q['a'] for q in full), 2), 'endDeg': round(max(q['a'] for q in full), 2)})
json.dump(L, open('page/layout.json', 'w'), indent=1)
print('lit', lit_col, 'dim', dim_col, 'marker col', mcol, 'range', L['knob']['startDeg'], L['knob']['endDeg'])
