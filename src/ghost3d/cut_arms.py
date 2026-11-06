"""Remove the arms that the carve fused into Ghost's body, so hand-built arms can take their place.
Arm path measured on the straight-on front and side video frames (model units = video pixels at 640 wide):
   shoulder (51, 184, 11.5) -> elbow (59, 144, 16.5) -> wrist (63, 119, 24) -> fingertips (59, 91, 20)   (x mirrored for the other arm)
Writes ghost_hull_noarms.npz and arms.json (the same path, used to build the new arms)."""
import json, numpy as np
from scipy import ndimage
d = np.load('ghost_hull.npz'); vol, xs, ys, zs = d['vol'].copy(), d['xs'], d['ys'], d['zs']
path = [(51, 184, 11.5, 13), (59, 144, 16.5, 14), (63, 119, 24, 15), (59, 91, 20, 15)]   # x, y, z, cut radius
X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
cut = np.zeros_like(vol)
for side in (-1, 1):
    pts = [(side * x, y, z, r) for x, y, z, r in path]
    for (x0, y0, z0, r0), (x1, y1, z1, r1) in zip(pts, pts[1:]):
        a = np.array([x0, y0, z0]); b = np.array([x1, y1, z1]); ab = b - a
        t = np.clip(((X - a[0]) * ab[0] + (Y - a[1]) * ab[1] + (Z - a[2]) * ab[2]) / ab.dot(ab), 0, 1)
        dist = np.sqrt((X - a[0] - t * ab[0]) ** 2 + (Y - a[1] - t * ab[1]) ** 2 + (Z - a[2] - t * ab[2]) ** 2)
        r = r0 + t * (r1 - r0)
        cut |= dist <= r
# only take away what sticks out sideways past the torso core (keep chest and cape in front/behind the arm)
core = np.abs(X) < 40
cut &= ~core
vol &= ~cut
vol = ndimage.binary_opening(vol, iterations=1)
lab, n = ndimage.label(vol); sz = ndimage.sum(vol, lab, range(1, n + 1)); vol = lab == 1 + int(np.argmax(sz))
np.savez_compressed('ghost_hull_noarms.npz', vol=vol, xs=xs, ys=ys, zs=zs, cut=cut)
json.dump({'path': path, 'units': 'video pixels (640 wide); y up from the floor; +z is his front'}, open('arms.json', 'w'), indent=1)
print('removed', int(cut.sum()), 'voxels; body keeps', int(vol.sum()))
