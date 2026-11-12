# TRY A PLUG-IN (HEM RADIO)

116 HEM-Elite-Rack plug-ins in six categories (EQ 13, DYNAMICS 39, TOOLS 23, SPACE 10, MOVEMENT 14, COLOR 17).
Left out: KEYS (GRAND LARCENY, by choice); FINGERPRINT, THE MOLD, THE FORGER (they need threads, web_stubs.cpp).

- Sound: every rack plug-in's real C++ (hem-elite-rack/rackfx, unchanged) + rack_engine.cpp, zig 0.14
  `c++ -target wasm32-wasi -std=c++23 -O2 -fno-exceptions`, linked `-mexec-model=reactor -s` -> rack/hem-rack-wasm.txt.
- One engine on the audio thread and one on the page for the whole visit (about 17 MB each); a pick loads into them
  between audio blocks with a 2.7 ms fade out / in. Closing the panel passes the music straight through.
- Proof (parity_results.txt): native_run.cpp vs runner.mjs, 8 s of station audio, every control moved every second.
  116/116 run, no broken samples; 111 match within -100 dB of the peak or better; SWEET SIXTEEN, HIGH STAKES, TOP DOG,
  FAST MONEY land at -66 to -69 dB (close, not bit-exact); THE SETUP -89 dB.
- Faceplates: layouts from the rack's faceLayout() (dump.cpp), plates from renderRackPlate() (plates.cpp), knob parts
  from buildPartsAtlas() (sprites.cpp), drawing = FaceView ported to canvas (hem-face.js), knob caps mixed in linear light.
- Tests 2026-11-12: e2e.js 15/15; allshots.js opened all 116 on the live station in one page (slowest 0.5 s).
