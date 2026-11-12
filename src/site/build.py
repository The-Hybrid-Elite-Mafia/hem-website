"""Builds the HEM website into dist/: the site shell + the HEM radio (from radio/index.html, its styles scoped
under #hemRadio) + the plug-in data + the images, the sound engine, Ghost, and the HOTHEAD live tablet."""
import json, pathlib, re, shutil
ROOT = pathlib.Path(__file__).parent
DIST = ROOT / 'dist'
RADIO = ROOT.parent / 'radio'
HOTHEAD = ROOT.parent / 'hothead-web' / 'page'

radio = (RADIO / 'index.html').read_text()

# ---- the radio's styles, every rule scoped to #hemRadio so they can't touch the rest of the site
css = re.search(r'<style>(.*?)</style>', radio, re.S).group(1)
def scope_sel(sel):
    sel = sel.strip()
    if sel in (':root', 'body'): return '#hemRadio'
    if sel in ('html', 'html,body'): return None
    if sel == '*': return '#hemRadio *'
    return '#hemRadio ' + sel
def scope_rules(text):
    out, i = [], 0
    while i < len(text):
        j = text.find('{', i)
        if j < 0: break
        head = text[i:j].strip()
        depth, k = 1, j + 1
        while depth:
            depth += {'{': 1, '}': -1}.get(text[k], 0); k += 1
        body = text[j + 1:k - 1]
        if head.startswith('@media'):
            out.append(head + '{' + scope_rules(body) + '}')
        elif head.startswith('@'):
            out.append(head + '{' + body + '}')
        else:
            sels = [s for s in (scope_sel(x) for x in re.split(r',(?![^()]*\))', head)) if s]
            if sels: out.append(','.join(sels) + '{' + body + '}')
        i = k
    return '\n'.join(out)
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
radio_css = scope_rules(css)

# ---- the radio's markup (the player, its two lists, the file picker, the message strip)
body = radio[radio.index('<body>') + 6:radio.index('<script type="importmap">')]
radio_html = '<div id="hemRadio">\n' + body.strip() + '\n</div>'
radio_html = radio_html.replace('src="hem-ghost.webp"', 'src="img/brand/ghost.webp"').replace('src="hem-crown.webp"', 'src="img/brand/crown.webp"')

# ---- the radio's script
scripts = re.findall(r'<script type="importmap">.*?</script>\s*<script type="module">.*?</script>', radio, re.S)
assert len(scripts) == 1
js = scripts[0]
def rep(a, b):
    global js
    assert js.count(a) == 1, a[:60]
    js = js.replace(a, b)
# Ghost (7.7 MB) loads the first time someone opens the player, not on every page
rep("\nloadGhost();\n", "\nlet ghostAsked = false;\nwindow.hemRadioLoadGhost = () => { if (!ghostAsked) { ghostAsked = true; loadGhost(); } };\nif (location.hash === '#player') window.hemRadioLoadGhost();\n")
rep("$('ghostImg').hidden = true;", "$('ghostImg').hidden = true; window.hemPlayer.resize();")

shell = (ROOT / 'shell.html').read_text()
plugins = json.loads((ROOT / 'plugins.json').read_text())
out = (shell.replace('{{PLUGINS_JSON}}', json.dumps(plugins, separators=(',', ':')))
            .replace('{{PLAYER_SCRIPTS}}', js).replace('{{RADIO_CSS}}', radio_css).replace('{{RADIO_HTML}}', radio_html))
assert '{{' not in out
if DIST.exists(): shutil.rmtree(DIST)
DIST.mkdir()
# GitHub Pages gets a full document; the Claude preview gets the body-only page (its host adds the head).
HEAD = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
(DIST / 'index.html').write_text(HEAD + out.replace('<canvas id="aura"', '</head>\n<body>\n<canvas id="aura"', 1) + '\n</body>\n</html>\n', encoding='utf-8')
(ROOT / 'preview.html').write_text(out, encoding='utf-8')
shutil.copytree(ROOT / 'img', DIST / 'img')
for f in ['hem-engine2-wasm.txt', 'hem-engine2-worklet.js', 'ghost4-model.txt']:
    shutil.copy(RADIO / f, DIST / f)
# HEM RADIO's station songs (made by make_station.py); with none yet, an empty list so TUNE IN says so
import os
STATION = pathlib.Path(os.environ.get('HEM_STATION_DIR', ROOT / 'station'))
if (STATION / 'station.json').exists():
    shutil.copytree(STATION, DIST / 'station', ignore=shutil.ignore_patterns('*.wav', '*.flac', '*.aif', '*.aiff'))
else:
    (DIST / 'station').mkdir()
    (DIST / 'station' / 'station.json').write_text('{"epoch": 0, "songs": []}')
# HOTHEAD live tablet: its own small page, shown inside the HOTHEAD plug-in page
(DIST / 'hothead').mkdir()
for f in ['index.html', 'hem-tablet-base.webp', 'hem-tablet-lights.png', 'knob-bg.png', 'value-box.png', 'power-off.png', 'hem-hothead-wasm.txt', 'hem-stems-worklet.js']:
    shutil.copy(HOTHEAD / f, DIST / 'hothead' / f)
print('built', len(out) // 1024, 'KB index;', sum(1 for _ in DIST.rglob('*') if _.is_file()), 'files;', len(radio_css) // 1024, 'KB radio styles')
