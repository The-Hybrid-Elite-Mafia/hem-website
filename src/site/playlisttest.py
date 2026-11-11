"""Real-browser test of the Playlists page: create, bulk add, play, reorder, survives a reload, remove, delete."""
import asyncio, pathlib, threading, http.server, functools, wave
import numpy as np
from playwright.async_api import async_playwright

DIST = pathlib.Path(__file__).parent / 'dist'
OUT = pathlib.Path('/tmp/claude-0/-home-claude/9e30626a-e6d6-5734-b1ea-7bf7a7806467/scratchpad/site')
SONGS = OUT / 'songs'; SONGS.mkdir(parents=True, exist_ok=True)
files = []
for k, hz in enumerate([330, 440, 550]):   # generated test tones, not anyone's music
    t = np.arange(48000 * 6) / 48000
    x = (0.2 * np.sin(2 * np.pi * hz * t) * 32767).astype('<i2')
    f = SONGS / f'{k + 1:02d} HEM test {hz} Hz.wav'
    with wave.open(str(f), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000); w.writeframes(x.tobytes())
    files.append(str(f))

http.server.SimpleHTTPRequestHandler.extensions_map['.wasm'] = 'application/wasm'
http.server.SimpleHTTPRequestHandler.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8769), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        async def route(r):
            u = r.request.url
            if 'three@0.160.0/' in u: await r.fulfill(path=str(pathlib.Path('/home/claude/p3d/node_modules/three') / u.split('three@0.160.0/')[1]), content_type='application/javascript')
            elif 'fonts.g' in u: await r.abort()
            else: await r.continue_()
        await pg.route('**/*', route)
        await pg.goto('http://127.0.0.1:8769/index.html#playlists'); await pg.wait_for_timeout(3000)
        res = []
        empty = await pg.inner_text('#pl-main'); res.append(('empty state shows', 'No playlists yet' in empty))
        await pg.fill('#pl-new-name', 'Test Album'); await pg.click('#pl-new button'); await pg.wait_for_timeout(800)
        res.append(('playlist created', 'Test Album' in await pg.inner_text('#pl-list')))
        await pg.set_input_files('#pl-files', files); await pg.wait_for_timeout(2500)
        rows = await pg.eval_on_selector_all('.songs .t', 'els => els.map(e => e.firstChild.textContent)')
        res.append((f'3 songs added in order {rows}', rows == ['01 HEM test 330 Hz', '02 HEM test 440 Hz', '03 HEM test 550 Hz']))
        await pg.set_input_files('#pl-files', files[:1]); await pg.wait_for_timeout(1500)
        res.append(('adding the same song again does not duplicate it', await pg.eval_on_selector_all('.songs li', 'e => e.length') == 3))
        print(res, errs); await pg.screenshot(path="dbg_pl.png"); print(await pg.eval_on_selector_all("[data-a=down]", "e => e.map(x => [x.outerHTML.slice(0,120), x.getBoundingClientRect().y])"))
        await pg.click('[data-a=down][data-i="0"]'); await pg.wait_for_timeout(800)
        rows = await pg.eval_on_selector_all('.songs .t', 'els => els.map(e => e.firstChild.textContent)')
        res.append(('move down works', rows[0].startswith('02') and rows[1].startswith('01')))
        await pg.click('[data-a=play]'); await pg.wait_for_timeout(3000)
        st = await pg.evaluate('hemPlayer.state()')
        res.append((f'PLAY starts the first song ({st["title"]}, playing={st["playing"]})', st['playing'] and st['title'] == '02 HEM test 440 Hz'))
        await pg.evaluate("location.hash='#plugins'"); await pg.wait_for_timeout(1500)
        st2 = await pg.evaluate('hemPlayer.state()')
        res.append((f'still playing on another page ({st2["pos"]:.1f}s)', st2['playing'] and st2['pos'] > st['pos']))
        await pg.screenshot(path=str(OUT / 'playlists-plugins.png'))
        await pg.evaluate("location.hash='#playlists'"); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=str(OUT / 'playlists.png'))
        await pg.reload(); await pg.wait_for_timeout(3500)
        rows = await pg.eval_on_selector_all('.songs .t', 'els => els.map(e => e.firstChild.textContent)')
        res.append(('saved after reload (same order)', rows[:2] == ['02 HEM test 440 Hz', '01 HEM test 330 Hz']))
        await pg.click('[data-a=remove][data-i="2"]'); await pg.wait_for_timeout(800)
        res.append(('remove works', await pg.eval_on_selector_all('.songs li', 'e => e.length') == 2))
        store = await pg.inner_text('#pl-store')
        res.append((f'removed song deleted from storage ({store})', store.startswith('2 songs')))
        await pg.click('[data-a=delete]'); await pg.wait_for_timeout(300)
        still = 'Test Album' in await pg.inner_text('#pl-list')
        await pg.click('[data-a=delete]'); await pg.wait_for_timeout(1000)
        gone = 'Test Album' not in await pg.inner_text('#pl-list')
        store = await pg.inner_text('#pl-store')
        res.append(('delete asks for a second tap, then deletes and frees the songs', still and gone and store == ''))
        await b.close()
        for name, ok in res: print('PASS' if ok else 'FAIL', name)
        print('errors:', errs[:3])

asyncio.run(main())
srv.shutdown()
