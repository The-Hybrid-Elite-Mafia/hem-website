const { chromium } = require('playwright');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  let errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/TUNNEL/.test(m.text())) errs.push(m.text()); });
  await p.goto('http://localhost:8822/#player'); await p.waitForFunction(() => window.hemTest && window.hemTry, null, { timeout: 30000 });
  await p.evaluate(() => window.hemTest.tuneIn()); await p.waitForFunction(() => window.hemTest.playing, null, { timeout: 60000 });
  const names = JSON.parse(fs.readFileSync('/home/claude/plugweb/web/hem-rack-layouts.json', 'utf8'));
  const out = [];
  const START = +(process.argv[2] || 0), END = +(process.argv[3] || 999);
  for (const n of Object.keys(names).slice(START, END)) {
    errs = [];
    const t0 = Date.now();
    const r = await Promise.race([p.evaluate(n => window.hemTry.tryPick(n).then(() => 'ok'), n), new Promise(r => setTimeout(() => r('TIMEOUT'), 20000))]);
    if (r !== 'ok') {
      const why = await Promise.race([p.evaluate(() => ({ mem: performance.memory && Math.round(performance.memory.usedJSHeapSize / 1e6), ctx: window.hemTest.eng.ctx.state, note: document.getElementById('tryNote').textContent, busy: window.hemTry.state.busy })), new Promise(r => setTimeout(() => r('PAGE FROZEN'), 5000))]);
      console.log('HANG on', n, JSON.stringify(why), errs.join(' | ').slice(0, 300)); out.push({ n, ok: false, why: 'hang', errs }); break;
    }
    try { await p.waitForFunction(n => window.hemTry.state.name === n && !window.hemTry.state.busy, n, { timeout: 30000 }); } catch (e) { out.push({ n, ok: false, why: 'did not open', errs }); continue; }
    const ms = Date.now() - t0;
    await sleep(1500);
    const st = await p.evaluate(() => ({ playing: window.hemTest.playing, flags: window.hemTry.state.face.feed.flags }));
    await (await p.$('#tryCv')).screenshot({ path: '/home/claude/plugweb/all/' + n.replace(/[ \/]/g, '_') + '.png' });
    out.push({ n, ok: st.playing && errs.length === 0, ms, errs, flags: st.flags });
  }
  fs.writeFileSync('/home/claude/plugweb/all/results-' + START + '.json', JSON.stringify(out, null, 1));
  const bad = out.filter(o => !o.ok);
  console.log(out.length, 'opened;', bad.length, 'with problems'); bad.forEach(o => console.log(' ', o.n, o.why || '', o.errs.join(' | ').slice(0, 300)));
  console.log('slowest open:', Math.max(...out.map(o => o.ms || 0)), 'ms');
  await b.close();
})();
