"""Close-up screenshots of the robot on the player's stage: whole player, zoomed on the stage, and turned."""
import asyncio, pathlib, threading, http.server, functools
from playwright.async_api import async_playwright
DIST = pathlib.Path(__file__).parent / 'dist'
OUT = pathlib.Path('/tmp/claude-0/-home-claude/9e30626a-e6d6-5734-b1ea-7bf7a7806467/scratchpad/site')
http.server.SimpleHTTPRequestHandler.extensions_map['.wasm'] = 'application/wasm'
http.server.SimpleHTTPRequestHandler.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8770), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = await (await b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        async def route(r):
            u = r.request.url
            if 'three@0.160.0/' in u: await r.fulfill(path=str(pathlib.Path('/home/claude/p3d/node_modules/three') / u.split('three@0.160.0/')[1]), content_type='application/javascript')
            elif 'fonts.g' in u: await r.abort()
            else: await r.continue_()
        await pg.route('**/*', route)
        await pg.goto('http://127.0.0.1:8770/index.html#player'); await pg.wait_for_timeout(6000)
        await pg.screenshot(path=str(OUT / 'robot-player.png'))
        box = await pg.evaluate("(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
        sx, sy = box[0] + box[2] * 0.215, box[1] + box[3] * 0.33
        await pg.evaluate("""([x, y]) => { const c = document.getElementById('stage'); const ev = (t, id) => c.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'mouse', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
          ev('pointerdown', 801); ev('pointerup', 801); ev('pointerdown', 802); ev('pointerup', 802); }""", [sx, sy])
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=str(OUT / 'robot-close.png'))
        for k in range(1, 4):
            await pg.wait_for_timeout(2600); await pg.screenshot(path=str(OUT / f'robot-close-{k}.png'))
        print('errors:', errs[:3]); await b.close()
asyncio.run(main()); srv.shutdown()
