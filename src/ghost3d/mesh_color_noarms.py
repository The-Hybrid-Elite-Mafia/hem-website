"""Mesh the carved body and colour every point from the video frames that see it best.
usage: mesh_color.py SIGN   -> ghost_raw.ply (+ prints colour agreement between views, lower spread = right spin direction)"""
import sys, json, numpy as np, trimesh
from PIL import Image
from scipy import ndimage
from skimage import measure

SIGN = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
d = np.load('ghost_hull_noarms.npz'); vol, xs, ys, zs, cutv = d['vol'], d['xs'], d['ys'], d['zs'], d['cut']
KEYS = json.load(open('best_keys.json')); kf, ka = np.array(KEYS, float).T
AXIS, FLOOR = 319.0, 334
def angle(k):
    if k <= kf[0]: return ka[0] + (k - kf[0]) * (ka[1] - ka[0]) / (kf[1] - kf[0])
    if k >= kf[-1]: return ka[-1] + (k - kf[-1]) * (ka[-1] - ka[-2]) / (kf[-1] - kf[-2])
    return float(np.interp(k, kf, ka))

field = ndimage.gaussian_filter(vol.astype(np.float32), 1.6)
verts, faces, normals, _ = measure.marching_cubes(np.pad(field, 2), 0.5)
step = xs[1] - xs[0]
verts = verts - 2
P = np.c_[xs[0] + verts[:, 0] * step, ys[0] + verts[:, 1] * step, zs[0] + verts[:, 2] * step]   # pixel units
mesh = trimesh.Trimesh(P, faces[:, ::-1], process=True)
trimesh.smoothing.filter_taubin(mesh, iterations=12)
if mesh.volume < 0: mesh.invert()
P, N = mesh.vertices, mesh.vertex_normals
print('vertices', len(P), 'faces', len(mesh.faces))

frames = list(range(1, 241, 2))
acc = np.zeros((len(P), 3)); wsum = np.zeros(len(P)); sq = np.zeros((len(P), 3))
for k in frames:
    img = np.asarray(Image.open(f'hires/f{k:04d}.png').convert('RGB')).astype(np.float32) / 255   # 1280x720 = 2x the mask frames
    th = np.radians(SIGN * angle(k)); c, s = np.cos(th), np.sin(th)
    xr = P[:, 0] * c + P[:, 2] * s                 # screen x (pixels from the turn axis)
    zr = -P[:, 0] * s + P[:, 2] * c                # toward the camera is +z
    nz = -N[:, 0] * s + N[:, 2] * c
    u = (AXIS + xr) * 2; v = (FLOOR - P[:, 1]) * 2
    ui, vi = np.round(u).astype(int), np.round(v).astype(int)
    ok = (ui >= 0) & (ui < img.shape[1]) & (vi >= 0) & (vi < img.shape[0]) & (nz > 0.25)
    # visibility: keep points within 3 px of the nearest surface along this view (z-buffer on a 2 px grid)
    gu, gv = ui // 4, vi // 4
    zb = np.full((img.shape[0] // 4 + 2, img.shape[1] // 4 + 2), -1e9)
    np.maximum.at(zb, (gv[ok], gu[ok]), zr[ok])
    vis = ok.copy(); vis[ok] = zr[ok] >= zb[gv[ok], gu[ok]] - 4
    w = np.where(vis, nz ** 14, 0)   # lean hard on the views that look straight at each spot (sharper, less smear)
    col = np.zeros((len(P), 3)); col[vis] = img[vi[vis], ui[vis]]
    acc += col * w[:, None]; sq += col ** 2 * w[:, None]; wsum += w
seen = wsum > 1e-6
C = np.zeros((len(P), 3)); C[seen] = acc[seen] / wsum[seen, None]
spread = np.sqrt(np.maximum(sq[seen] / wsum[seen, None] - C[seen] ** 2, 0)).mean()
print(json.dumps({'sign': SIGN, 'colour_spread': round(float(spread), 4), 'unseen_points': int((~seen).sum())}))
# points on the new cut faces were hidden by the arm in every frame: give them nearby cape/body colours
from scipy.spatial import cKDTree
gi = np.clip(np.round((P[:, 0] - xs[0]) / step).astype(int), 0, len(xs) - 1)
gj = np.clip(np.round((P[:, 1] - ys[0]) / step).astype(int), 0, len(ys) - 1)
gk = np.clip(np.round((P[:, 2] - zs[0]) / step).astype(int), 0, len(zs) - 1)
near_cut = ndimage.binary_dilation(cutv, iterations=3)[gi, gj, gk]
good = ~near_cut & seen
tree = cKDTree(P[good]); _, nn = tree.query(P[~good], k=8)
C[~good] = C[good][nn].mean(1)
print('recoloured points where the arms were:', int((~good).sum()))
mesh.visual.vertex_colors = np.c_[(np.clip(C, 0, 1) * 255).astype(np.uint8), np.full(len(P), 255, np.uint8)]
mesh.export('ghost_body_noarms.ply')
