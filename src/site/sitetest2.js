// Whole-site check: radio on the player page, music across pages, mini player, playlists hook, HOTHEAD live tablet, phone width.
const { chromium } = require('playwright'); const fs = require('fs');
const D = '/mnt/user-data/uploads/Desktop/suno exports/Live the Middle/';
const URL = process.argv[2] || 'http://127.0.0.1:8799/index.html';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ body: fs.readFileSync('/home/claude/p3d/node_modules/three/' + r.request().url().split('three@0.160.0/')[1]), contentType: 'text/javascript' }));
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const ok = (label, v) => console.log((v ? 'PASS ' : 'FAIL ') + label);
  await p.goto(URL + '#home'); await p.waitForTimeout(2000);
  ok('home shows, radio hidden', await p.isHidden('#view-player') && await p.isVisible('#view-home'));
  // add a song from the mini player on the home page
  await p.click('#mini-add').catch(() => {});
  await p.setInputFiles('#picker', [D + '0 Live the Middle.wav', D + '12 Vocals.wav']);
  await p.waitForFunction(() => window.hemPlayer.state().playing, null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  ok('song plays from the home page; mini player shows: ' + await p.textContent('#mini-title'), /LIVE THE MIDDLE/i.test(await p.textContent('#mini-title')));
  await p.goto(URL + '#plugins'); await p.waitForTimeout(800);
  ok('still playing on the plug-ins page', await p.evaluate(() => window.hemPlayer.state().playing));
  await p.evaluate(() => location.hash = '#player'); await p.waitForTimeout(4000);
  ok('player page shows the radio', await p.isVisible('#hemRadio .radio'));
  ok('still playing on the player page', await p.evaluate(() => window.hemPlayer.state().playing));
  ok('radio UP NEXT shows the 2nd song: ' + (await p.innerText('#upnext')).split('\n').slice(0, 2).join(' '), /VOCALS/.test(await p.innerText('#upnext')));
  ok('3D Ghost loaded in the screen', await p.evaluate(() => !document.getElementById('ghost3d').hidden));
  await p.screenshot({ path: 'site_player.png', fullPage: true });
  await p.click('#mini-play').catch(() => {});   // hidden on the player page: should do nothing
  await p.click('#bPlay'); await p.waitForTimeout(300);
  ok('radio PAUSE button pauses', !(await p.evaluate(() => window.hemPlayer.state().playing)));
  await p.click('#bPlay'); await p.waitForTimeout(500);
  // HOTHEAD plug-in page
  await p.evaluate(() => location.hash = '#p-hothead'); await p.waitForTimeout(3500);
  ok('HOTHEAD page shows the live tablet', await p.isVisible('#pp-live'));
  const fh = await p.evaluate(() => document.getElementById('pp-live-frame').getBoundingClientRect().height);
  ok('live tablet frame sized to its page: ' + Math.round(fh) + ' px', fh > 700);
  const fr = p.frameLocator('#pp-live-frame');
  await fr.locator('#knob').focus(); await fr.locator('#knob').press('Home');
  ok('DRIVE knob works inside the website (now ' + await fr.locator('#knob').getAttribute('aria-valuenow') + ')', (await fr.locator('#knob').getAttribute('aria-valuenow')) === '0.00');
  await fr.locator('#files').setInputFiles([D + '10 Drums.wav', D + '9 Bass.wav']);
  await fr.locator('#play').waitFor({ state: 'visible' });
  await p.waitForFunction(() => document.getElementById('pp-live-frame').contentDocument.getElementById('status').textContent.includes('stems loaded'), null, { timeout: 90000 });
  await fr.locator('#play').click(); await p.waitForTimeout(800);
  ok('playing HOTHEAD paused the radio', !(await p.evaluate(() => window.hemPlayer.state().playing)));
  await p.locator('#pp-live').screenshot({ path: 'site_hothead.png' });
  ok('SURGEON page has no "use in player" button', !(await p.evaluate(() => { location.hash = '#p-surgeon'; return document.getElementById('pp-cta').textContent; })).includes('PLAYER'));
  await p.waitForTimeout(300);
  ok('SURGEON page: no live tablet', await p.isHidden('#pp-live'));
  // phone
  const ph = await ctx.newPage(); await ph.setViewportSize({ width: 390, height: 844 });
  for (const h of ['#home', '#plugins', '#player', '#p-hothead', '#playlists']) {
    await ph.goto(URL + h); await ph.waitForTimeout(h === '#player' ? 3000 : 1200);
    const sw = await ph.evaluate(() => document.documentElement.scrollWidth);
    ok(`phone ${h}: no sideways scroll (${sw}px)`, sw <= 390);
  }
  await ph.goto(URL + '#player'); await ph.waitForTimeout(3000); await ph.screenshot({ path: 'site_player_phone.png' });
  console.log('errors:', JSON.stringify(errs.filter(e => !/googleapis|ERR_TUNNEL|fonts/.test(e))));
  await b.close();
})();
