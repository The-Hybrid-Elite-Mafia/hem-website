# Hybrid Elite Mafia — website

The HEM website: home, all 120 HEM-Elite-Rack plug-ins as glass tablets (each with its own page), and the
HEM 3D Listening Player. The player's sound is HEM SURGEON's own C++23 code compiled to WebAssembly.
Songs you play stay on your device; nothing is uploaded.

Served free by GitHub Pages from this branch (`index.html` at the top).

## What's where
- `index.html` — the whole site (built; do not edit by hand).
- `img/` — faceplates (from HEM-Elite-Rack's promo screenshots) and the HEM crown and ghost.
- `hem-engine.wasm`, `hem-engine-worklet.js` — the sound engine.
- `src/site/` — site source: `shell.html`, `hem-player-3d.html`, `plugins.json`, `build.py`, `sitetest.py`.
- `src/engine/` — engine source (`engine.cpp`) and the web-vs-native sound proof (`BUILD.md` has the numbers).

No audio files are kept in this repository.
