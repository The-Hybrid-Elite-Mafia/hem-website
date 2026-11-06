"""Carve Ghost's 3D body from his 360-degree turnaround outlines (visual hull).

Each kept voxel must fall inside his cut-out in (almost) every frame, at that frame's turn angle.
Angles come from keyframes found in the video (front, side, back, other side, front again).
Prints how well the carved body matches the outlines; writes ghost_hull.npz.
"""
import sys, json, numpy as np
from PIL import Image
from scipy import ndimage

KEYS = json.loads(sys.argv[1]) if len(sys.argv) > 1 else [[16, 0], [92, 90], [158, 180], [200, 270], [250, 360]]
SIGN = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
AXIS, FLOOR, STEP, KEEP = 319.0, 334, 1.0, 0.97
frames = list(range(1, 241, 2))
kf, ka = np.array(KEYS, float).T
def angle(k):   # piecewise-linear through the keyframes, extended at both ends
    if k <= kf[0]: return ka[0] + (k - kf[0]) * (ka[1] - ka[0]) / (kf[1] - kf[0])
    if k >= kf[-1]: return ka[-1] + (k - kf[-1]) * (ka[-1] - ka[-2]) / (kf[-1] - kf[-2])
    return float(np.interp(k, kf, ka))
masks = []
for k in frames:
    m = np.asarray(Image.open(f'masks/m{k:04d}.png')) > 127
    m[FLOOR + 1:] = False
    masks.append(ndimage.binary_dilation(m, iterations=2))
H, Wd = masks[0].shape
xs = np.arange(-95, 95, STEP); zs = np.arange(-95, 95, STEP); ys = np.arange(0, FLOOR - 10, STEP)
X, Z = np.meshgrid(xs, zs, indexing='ij')
votes = np.zeros((xs.size, ys.size, zs.size), np.uint8)
for m, k in zip(masks, frames):
    th = np.radians(SIGN * angle(k)); c, s = np.cos(th), np.sin(th)
    u = np.round(AXIS + X * c + Z * s).astype(int)           # (nx, nz)
    ok_u = (u >= 0) & (u < Wd)
    uc = np.clip(u, 0, Wd - 1)
    for j, y in enumerate(ys):
        v = int(round(FLOOR - y))
        votes[:, j, :] += (ok_u & m[v, uc]).astype(np.uint8)
need = int(np.ceil(KEEP * len(frames)))
vol = votes >= need
vol = ndimage.binary_opening(vol, iterations=1)
lab, n = ndimage.label(vol); sz = ndimage.sum(vol, lab, range(1, n + 1)); vol = lab == 1 + int(np.argmax(sz))
# score: carved body re-projected vs the outlines (mean IoU over frames)
ious = []
for m, k in zip(masks, frames):
    th = np.radians(SIGN * angle(k)); c, s = np.cos(th), np.sin(th)
    ii, jj, kk = np.nonzero(vol)
    u = np.round(AXIS + xs[ii] * c + zs[kk] * s).astype(int); v = np.round(FLOOR - ys[jj]).astype(int)
    pr = np.zeros_like(m); okk = (u >= 0) & (u < Wd) & (v >= 0) & (v < H); pr[v[okk], u[okk]] = True
    pr = ndimage.binary_closing(pr, iterations=2)
    mm = ndimage.binary_erosion(m, iterations=2)
    ious.append((pr & mm).sum() / max(1, (pr | mm).sum()))
print(json.dumps({'keys': KEYS, 'sign': SIGN, 'voxels': int(vol.sum()), 'mean_iou': round(float(np.mean(ious)), 4), 'worst_iou': round(float(np.min(ious)), 4)}))
np.savez_compressed('ghost_hull.npz', vol=vol, xs=xs, ys=ys, zs=zs, votes=votes)
