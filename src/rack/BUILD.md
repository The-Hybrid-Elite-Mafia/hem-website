# TRY A PLUG-IN (HEM RADIO)

Six HEM-Elite-Rack plug-ins, one per category (KEYS left out): VELVET (EQ), THE FAMILY (DYNAMICS), WIDE LOAD (TOOLS),
CATHEDRAL (SPACE), THE CREW (MOVEMENT), HOTHEAD (COLOR).

- Sound: every rack plug-in's real C++ (hem-elite-rack/rackfx, unchanged) + rack_engine.cpp, built with zig 0.14
  `c++ -target wasm32-wasi -std=c++23 -O2 -fno-exceptions`, linked `-mexec-model=reactor -s` -> rack/hem-rack-wasm.txt (base64).
  117 of 120 plug-ins are in it; FINGERPRINT, THE MOLD and THE FORGER need threads and are left out (web_stubs.cpp).
- Proof: native_run.cpp (normal build) and runner.mjs (browser build) run the same 20 s of station audio with every
  control moved every 2 s; compare.py. Worst gap web vs native: -121 dB under the peak (THE FAMILY); CATHEDRAL, THE CREW: 0.
- Faceplates: layouts from the rack's own faceLayout() (dump.cpp -> hem-rack-layouts.json); plates from its
  renderRackPlate() (plates.cpp); knob parts from The Hybrid Core's buildPartsAtlas() (sprites.cpp); drawing = FaceView
  ported to canvas (hem-face.js). The knob cap, pointer and shine are mixed in linear light like the plug-in's renderer.
- e2e.js: 15 checks on the built site with HEM RADIO live (all passed 2026-11-12).
