"""Builds the HEM website into dist/: the site shell + the 3D player's script (from p3d/hem-player-3d.html)
+ the plug-in data + the images and the sound engine."""
import json, pathlib, re, shutil
ROOT = pathlib.Path(__file__).parent
DIST = ROOT / 'dist'
player = (ROOT.parent / 'p3d' / 'hem-player-3d.html').read_text()
scripts = re.findall(r'<script type="importmap">.*?</script>\s*<script type="module">.*?</script>', player, re.S)
assert len(scripts) == 1
js = scripts[0]
def rep(a, b):
    global js
    assert js.count(a) == 1, a[:60]
    js = js.replace(a, b)
rep("LOGO.crown.src = 'hem-crown.webp';", "LOGO.crown.src = 'img/brand/crown.webp';")
rep("LOGO.ghost.src = 'hem-ghost.webp';", "LOGO.ghost.src = 'img/brand/ghost.webp';")
rep("const w = innerWidth, h = innerHeight;", "const rr = canvas.getBoundingClientRect(), w = Math.round(rr.width), h = Math.round(rr.height);\n  if (!w || !h) return;")
rep("function frame() {\n", "function frame() {\n  if (!document.body.classList.contains('on-player')) { clock.getDelta(); requestAnimationFrame(frame); return; }\n")
rep("window.hemStatus = ", """window.hemPlayer = {
  play, pause, next: nextSong, prev: prevSong, seek: f => seekTo(clamp(f, 0, 1)), resize,
  addSongs: () => { fileInput.click(); ensureAudio(); },
  state: () => ({ playing: !!playing, title: loadingSong ? 'Loading…' : curSong >= 0 ? songs[curSong].name : null,
                  count: songs.length, index: curSong, pos: songPos(), dur: songBuf ? songBuf.duration : 0, lufs: eng.readouts[19] }),
};
window.hemStatus = """)
shell = (ROOT / 'shell.html').read_text()
plugins = json.loads((ROOT / 'plugins.json').read_text())
out = shell.replace('{{PLUGINS_JSON}}', json.dumps(plugins, separators=(',', ':'))).replace('{{PLAYER_SCRIPTS}}', js)
assert '{{' not in out
if DIST.exists(): shutil.rmtree(DIST)
DIST.mkdir()
# GitHub Pages gets a full document; the Claude preview gets the body-only page (its host adds the head).
HEAD = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
(DIST / 'index.html').write_text(HEAD + out.replace('<canvas id="aura"', '</head>\n<body>\n<canvas id="aura"', 1) + '\n</body>\n</html>\n', encoding='utf-8')
(ROOT / 'preview.html').write_text(out, encoding='utf-8')
shutil.copytree(ROOT / 'img', DIST / 'img')
for f in ['hem-engine.wasm', 'hem-engine-worklet.js']:
    shutil.copy(ROOT.parent / 'p3d' / f, DIST / f)
print('built', len(out) // 1024, 'KB index;', sum(1 for _ in DIST.rglob('*') if _.is_file()), 'files')
