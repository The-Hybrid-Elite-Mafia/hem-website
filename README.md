# Hybrid Elite Mafia — website

The HEM website: home, all 120 HEM-Elite-Rack plug-ins as glass tablets (each with its own page), saved
playlists, and the HEM 24/7 radio player. The radio's sound engine is C++23 compiled to WebAssembly: an
AUTO-LEVELER that brings every song to the same loudness, BROADCAST EQ, BASS BOOST, MONITORING, and the
HEM LOCKDOWN limiter. The HOTHEAD plug-in page has a live tablet running HOTHEAD's own C++ code.
Songs you play stay on your device; nothing is uploaded.

Served free by GitHub Pages from this branch (`index.html` at the top).

## What's where
- `index.html` — the whole site (built; do not edit by hand).
- `img/` — faceplates (from HEM-Elite-Rack's promo screenshots) and the HEM crown and ghost.
- `hem-engine2-wasm.txt`, `hem-engine2-worklet.js` — the radio's sound engine (the WebAssembly is stored as
  base64 text).
- `ghost4-model.txt` — Ghost, the rigged 3D mascot (a GLB stored as base64 text), shown in the radio's screen.
- `hothead/` — the HOTHEAD live tablet (DRIVE knob, ON button, stem player), shown on HOTHEAD's page.
- `src/site/` — site source: `shell.html`, `build.py`, `plugins.json`, tests (`sitetest2.js`, `playlisttest.py`).
- `src/radio/` — the radio page source. `src/hothead/` — the HOTHEAD tablet source.
- `src/engine/` — engine sources (`engine2.cpp` for the radio, `hothead_engine.cpp`, the older `engine.cpp`) and
  the measurements that prove each control (`prove.py`, results in `prove_out.txt`).

No audio files are kept in this repository.
