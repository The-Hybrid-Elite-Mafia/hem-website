"""Cut Ghost out of every 2nd video frame (U2-Net) and record his outline box per frame."""
import os, json, pathlib, numpy as np
from PIL import Image
from rembg import remove, new_session
os.environ['U2NET_HOME'] = '/tmp/claude-0/-home-claude/9e30626a-e6d6-5734-b1ea-7bf7a7806467/scratchpad/models'
HERE = pathlib.Path(__file__).parent
F, M = HERE / 'frames', HERE / 'masks'
M.mkdir(exist_ok=True)
sess = new_session('u2net')
info = {}
for k in range(1, 241, 2):
    img = Image.open(F / f'f{k:04d}.png').convert('RGB')
    a = np.asarray(remove(img, session=sess, only_mask=True, post_process_mask=True))
    Image.fromarray(a).save(M / f'm{k:04d}.png')
    ys, xs = np.where(a > 127)
    info[k] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()), int((a > 127).sum())] if ys.size else None
    print(k, info[k], flush=True)
json.dump(info, open(HERE / 'mask_info.json', 'w'))
