"""Real-browser test of the HEM website (dist/): every view, phone width, music across pages, all 120 links."""
import asyncio, json, pathlib, threading, http.server, functools, sys
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).parent
DIST = ROOT / 'dist'
OUT = pathlib.Path('/tmp/claude-0/-home-claude/9e30626a-e6d6-5734-b1ea-7bf7a7806467/scratchpad/site')
OUT.mkdir(parents=True, exist_ok=True)
SONG = pathlib.Path('/home/claude/p3d/HEM test tone.wav')

http.server.SimpleHTTPRequestHandler.extensions_map['.wasm'] = 'application/wasm'
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
quiet = lambda *a, **k: None
http.server.SimpleHTTPRequestHandler.log_message = quiet

async def page(p, w, h, mobile=False):
    b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=[
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    pg = await ctx.new_page()
    logs = []
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    async def route(r):
        url = r.request.url
        if 'cdn.jsdelivr.net/npm/three@0.160.0/' in url:
            await r.fulfill(path=str(pathlib.Path('/home/claude/p3d/node_modules/three') / url.split('three@0.160.0/')[1]), content_type='application/javascript')
        elif 'fonts.g' in url:
            await r.abort()
        else:
            await r.continue_()
    await pg.route('**/*', route)
    return b, pg, logs

async def main():
    async with async_playwright() as p:
        b, pg, logs = await page(p, 1440, 900)
        await pg.goto('http://127.0.0.1:8766/index.html#home')
        await pg.wait_for_timeout(3500)
        await pg.screenshot(path=str(OUT / 'home.png'))
        await pg.screenshot(path=str(OUT / 'home-full.png'), full_page=True)
        # start music from the mini player's picker
        await pg.set_input_files('#hem-song-picker', str(SONG))
        await pg.wait_for_timeout(3500)
        s0 = await pg.evaluate('hemPlayer.state()')
        await pg.evaluate("location.hash='#plugins'"); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=str(OUT / 'plugins.png'))
        n_tabs = await pg.evaluate("document.querySelectorAll('#all .tab').length")
        await pg.evaluate("location.hash='#plugins-space'"); await pg.wait_for_timeout(500)
        space = await pg.evaluate("document.querySelector('#count').textContent")
        await pg.fill('#q', 'tape'); await pg.wait_for_timeout(300)
        tape = await pg.evaluate("document.querySelector('#count').textContent")
        await pg.fill('#q', '')
        await pg.evaluate("location.hash='#p-surgeon'"); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=str(OUT / 'surgeon.png'))
        s1 = await pg.evaluate('hemPlayer.state()')
        # every tablet link opens a real plug-in page
        bad = await pg.evaluate("""(() => { const bad = [];
          for (const p of PLUGINS) { location.hash = '#p-' + p.slug; route();
            if (document.getElementById('view-plugin').hidden || document.getElementById('pp-name').textContent !== p.name) bad.push(p.name); }
          return bad; })()""")
        imgs = await pg.evaluate("""Promise.all(PLUGINS.map(p => new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth > 0 ? null : p.name); i.onerror = () => r(p.name); i.src = 'img/plates/' + p.slug + '.webp'; }))).then(a => a.filter(Boolean))""")
        await pg.evaluate("location.hash='#player'"); await pg.wait_for_timeout(3500)
        await pg.screenshot(path=str(OUT / 'player.png'))
        s2 = await pg.evaluate('hemPlayer.state()')
        await pg.evaluate("location.hash='#home'"); await pg.wait_for_timeout(1200)
        s3 = await pg.evaluate('hemPlayer.state()')
        mini = await pg.evaluate("document.getElementById('mini-title').textContent + ' | ' + document.getElementById('mini-time').textContent")
        await b.close()

        b, pg, logs2 = await page(p, 390, 844, mobile=True)
        await pg.goto('http://127.0.0.1:8766/index.html#home'); await pg.wait_for_timeout(3000)
        await pg.screenshot(path=str(OUT / 'phone-home.png'))
        wide = await pg.evaluate('document.documentElement.scrollWidth > innerWidth')
        await pg.evaluate("location.hash='#plugins'"); await pg.wait_for_timeout(1200)
        await pg.screenshot(path=str(OUT / 'phone-plugins.png'))
        wide2 = await pg.evaluate('document.documentElement.scrollWidth > innerWidth')
        await pg.evaluate("location.hash='#p-the-family'"); await pg.wait_for_timeout(1200)
        await pg.screenshot(path=str(OUT / 'phone-plugin.png'), full_page=True)
        wide3 = await pg.evaluate('document.documentElement.scrollWidth > innerWidth')
        await b.close()

        r = lambda s: f"playing={s['playing']} song={s['title']} at {s['pos']:.1f}s"
        print('tablets on plug-ins page:', n_tabs)
        print('space filter:', space, '| search tape:', tape)
        print('plug-in pages that failed:', bad, '| faceplate images that failed:', imgs)
        print('music on home:', r(s0)); print('after plug-ins + SURGEON page:', r(s1)); print('on player:', r(s2)); print('back home:', r(s3))
        print('mini bar shows:', mini)
        print('phone sideways scroll (home, plugins, plugin):', wide, wide2, wide3)
        print('desktop errors:', [l for l in logs if 'ERR_FAILED' not in l][:10])
        print('phone errors:', [l for l in logs2 if 'ERR_FAILED' not in l][:10])

asyncio.run(main())
srv.shutdown()
