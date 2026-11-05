"""Phone test of the player's zoom: real two-finger pinch (touch events), + button, double-tap, one-finger pan."""
import asyncio, pathlib, threading, http.server, functools
from playwright.async_api import async_playwright

DIST = pathlib.Path(__file__).parent / 'dist'
OUT = pathlib.Path('/tmp/claude-0/-home-claude/9e30626a-e6d6-5734-b1ea-7bf7a7806467/scratchpad/site')
http.server.SimpleHTTPRequestHandler.extensions_map['.wasm'] = 'application/wasm'
http.server.SimpleHTTPRequestHandler.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8767), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

async def run(p, w, h, tag):
    b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    async def route(r):
        u = r.request.url
        if 'cdn.jsdelivr.net/npm/three@0.160.0/' in u:
            await r.fulfill(path=str(pathlib.Path('/home/claude/p3d/node_modules/three') / u.split('three@0.160.0/')[1]), content_type='application/javascript')
        elif 'fonts.g' in u: await r.abort()
        else: await r.continue_()
    await pg.route('**/*', route)
    print(tag, 'opening', flush=True); await pg.goto('http://127.0.0.1:8767/index.html#player', wait_until='domcontentloaded', timeout=60000); print(tag, 'opened', flush=True); await pg.wait_for_timeout(5000)
    cdp = await ctx.new_cdp_session(pg)
    lvl = lambda: pg.evaluate("document.querySelector('.hem-zoom .lvl').textContent")
    cx, cy = w / 2, h * 0.62
    await pg.screenshot(path=str(OUT / f'{tag}-fit.png'), timeout=60000); print(tag, 'shot', flush=True)
    out = [f"start {await lvl()}"]; print(tag, "loaded", flush=True)
    # two-finger pinch out
    async def touch(kind, pts):
        await cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})
    await touch('touchStart', [(cx - 20, cy), (cx + 20, cy)])
    for k in range(1, 13):
        await touch('touchMove', [(cx - 20 - k * 10, cy), (cx + 20 + k * 10, cy)]); await pg.wait_for_timeout(30)
    await touch('touchEnd', [])
    await pg.wait_for_timeout(600)
    out.append(f'after pinch {await lvl()}')
    await pg.screenshot(path=str(OUT / f'{tag}-pinched.png'))
    # one-finger pan
    await touch('touchStart', [(cx, cy)])
    for k in range(1, 8): await touch('touchMove', [(cx + k * 20, cy)]); await pg.wait_for_timeout(30)
    await touch('touchEnd', []); await pg.wait_for_timeout(600)
    await pg.screenshot(path=str(OUT / f'{tag}-panned.png'))
    # FIT, then + twice
    await pg.evaluate("document.querySelector('.hem-zoom [data-z=fit]').click()"); await pg.wait_for_timeout(400); out.append(f'after FIT {await lvl()}')
    await pg.tap('.hem-zoom [data-z=in]'); await pg.wait_for_timeout(200); await pg.tap('.hem-zoom [data-z=in]'); await pg.wait_for_timeout(400); out.append(f'after + + {await lvl()}')
    await pg.evaluate("document.querySelector('.hem-zoom [data-z=fit]').click()"); await pg.wait_for_timeout(400)
    # double-tap on empty space (the bottom frame)
    async def dbl(x, y):   # two real-speed taps, sent straight to the page
        await pg.evaluate("""([x, y]) => { const c = document.getElementById('stage');
          const ev = (t, id) => c.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
          ev('pointerdown', 901); ev('pointerup', 901); ev('pointerdown', 902); ev('pointerup', 902); }""", [x, y])
        await pg.wait_for_timeout(500)
    await dbl(w * 0.5, cy - (h * 0.06 if w > h else h * 0.012)); out.append(f'after graph double-tap {await lvl()}')
    await pg.evaluate("document.querySelector('.hem-zoom [data-z=fit]').click()"); await pg.wait_for_timeout(300)
    await dbl(w * 0.18, h * 0.42); out.append(f'after double-tap on the screen {await lvl()}')
    await pg.screenshot(path=str(OUT / f'{tag}-dbltap.png'))
    await dbl(w * 0.18, h * 0.42); out.append(f'after second double-tap {await lvl()}')
    print(tag, ' | '.join(out), '| errors:', errs[:3])
    await b.close()

async def main():
    async with async_playwright() as p:
        await run(p, 844, 390, 'phone-sideways')
        await run(p, 390, 844, 'phone-upright')

asyncio.run(main())
srv.shutdown()
