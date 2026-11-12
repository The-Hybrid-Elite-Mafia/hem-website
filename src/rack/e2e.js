const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
  const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  (' + extra + ')' : ''));
  await p.goto('http://localhost:8822/#player'); await p.waitForFunction(() => window.hemTest && window.hemTry, null, { timeout: 30000 });
  await p.mouse.click(5, 5);
  await p.evaluate(() => window.hemTest.tuneIn());
  await p.waitForFunction(() => window.hemTest.playing, null, { timeout: 60000 });
  ok('station playing', true);
  await p.evaluate(() => window.hemTry.tryPick('THE FAMILY'));
  await p.waitForFunction(() => window.hemTry.state.name === 'THE FAMILY', null, { timeout: 30000 });
  ok('THE FAMILY opened', true);
  // drive it hard so the effect is plain to measure: threshold -40, ratio 10:1, makeup 0
  const st = await p.evaluate(() => { const f = window.hemTry.state.face; f.setPlain(0, -40); f.setPlain(1, 2); return { thr: f.ui.text(0), ratio: f.ui.text(1) }; });
  ok('controls set through the faceplate', st.thr.startsWith('-40') && st.ratio === '10:1', JSON.stringify(st));
  await sleep(2500);
  const gr = await p.evaluate(() => window.hemTry.state.face.feed.gr);
  ok('compressor squeezing the live music (gain reduction from the audio thread)', gr < -3, 'GR ' + gr.toFixed(1) + ' dB');
  const levTxt = () => p.evaluate(() => Array.from(document.querySelectorAll('#hemRadio .gr')).map(e => e.textContent).join('|'));
  const lev = (await levTxt()).includes('RESTING');
  ok('AUTO-LEVELER shows RESTING', lev);
  // ON vs OFF loudness from the station's own meters (RMS L after the chain)
  const rms = async () => p.evaluate(async () => { const v = []; for (let k = 0; k < 40; k++) { await new Promise(r => setTimeout(r, 50)); v.push(20 * Math.log10(Math.max(window.hemTest.eng.r[26], 1e-6))); } v.sort((a, b) => a - b); return v[20]; });
  const on = await rms();
  // click POWER on the faceplate like a person would (its place from the plug-in's layout)
  await (await p.$('#tryCv')).scrollIntoViewIfNeeded(); await sleep(300);
  const box = await (await p.$('#tryCv')).boundingBox();
  const L = await p.evaluate(() => window.hemTry.state.layouts['THE FAMILY'].widgets.find(w => w.k === 5).r);
  await p.mouse.click(box.x + (L[0] + L[2] / 2) / 1672 * box.width, box.y + (L[1] + L[3] / 2) / 941 * box.height);
  const powered = await p.evaluate(() => window.hemTry.state.face.on);
  ok('POWER click turns it OFF', powered === false);
  await sleep(600);
  const off = await rms();
  ok('OFF is louder than ON with 10:1 at -40 (the plug-in really changes the sound)', off - on > 3, `ON ${on.toFixed(1)} dB, OFF ${off.toFixed(1)} dB RMS`);
  await p.mouse.click(box.x + (L[0] + L[2] / 2) / 1672 * box.width, box.y + (L[1] + L[3] / 2) / 941 * box.height);
  // drag the THRESHOLD knob up with the mouse
  const K = await p.evaluate(() => window.hemTry.state.layouts['THE FAMILY'].widgets.find(w => w.k === 0 && w.p === 0).r);
  const kx = box.x + (K[0] + K[2] / 2) / 1672 * box.width, ky = box.y + (K[1] + K[3] / 2) / 941 * box.height;
  await p.mouse.move(kx, ky); await p.mouse.down(); for (let k = 1; k <= 10; k++) await p.mouse.move(kx, ky - 12 * k); await p.mouse.up();
  const thr2 = await p.evaluate(() => window.hemTry.state.face.ui.get(0));
  ok('mouse drag turns THRESHOLD up', thr2 > -40 + 5, 'now ' + thr2.toFixed(1) + ' dB');
  await p.mouse.dblclick(kx, ky); await sleep(100);
  const thr3 = await p.evaluate(() => window.hemTry.state.face.ui.get(0));
  ok('double-click puts THRESHOLD back to its start (-12 dB)', Math.abs(thr3 + 12) < 0.01, thr3.toFixed(1));
  await (await p.$('#tryFace')).screenshot({ path: '/home/claude/plugweb/e2e_family.png' });
  // every other plug-in: opens, runs on the music, no errors
  for (const n of ['VELVET', 'WIDE LOAD', 'CATHEDRAL', 'THE CREW', 'HOTHEAD']) {
    await p.evaluate(n => window.hemTry.tryPick(n), n);
    await p.waitForFunction(n => window.hemTry.state.name === n && !window.hemTry.state.busy, n, { timeout: 30000 });
    await sleep(1200);
    const f = await p.evaluate(() => { const s = window.hemTry.state; return { name: s.name, playing: window.hemTest.playing, meters: Array.from(s.face.feed.meters.slice(0, 4)).map(v => +v.toFixed(2)), spec: !!s.face.feed.after }; });
    ok(n + ' running on the live music', f.name === n && f.playing, JSON.stringify(f));
    await (await p.$('#tryFace')).screenshot({ path: '/home/claude/plugweb/e2e_' + n.replace(/ /g, '_') + '.png' });
  }
  await p.evaluate(() => window.hemTry.tryClose()); await sleep(1500);
  const closed = await p.evaluate(() => ({ name: window.hemTry.state.name, hidden: document.getElementById('tryFace').hidden, resting: Array.from(document.querySelectorAll('#hemRadio .gr')).some(e => e.textContent === 'RESTING'), playing: window.hemTest.playing }));
  ok('CLOSE puts the station back (plug-in out, leveler back, still playing)', !closed.name && closed.hidden && !closed.resting && closed.playing, JSON.stringify(closed));
  await (await p.$('.tryp')).screenshot({ path: '/home/claude/plugweb/e2e_closed.png' });
  console.log('page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close();
})();
