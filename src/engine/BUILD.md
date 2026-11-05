# HEM web engine — how it's built and proven

The 3D player's sound is HEM SURGEON's real C++23 code, compiled to WebAssembly.

## Sources (all C++23)
- `engine.cpp` — this folder: chain SURGEON -> 10 faders -> volume, plus meters. Exports `hem_*` functions.
- `hem-elite-rack/rackfx/src/EliteEq.cpp` + `Spectrum.cpp` — SURGEON itself, unchanged (repo The-Hybrid-Elite-Mafia/hem-elite-rack, commit 2e5e8ed).
- `HybridCore/fx/src/Fx.cpp` + `fx/include/hybrid/fx/Dsp.hpp` — Hybrid Core parameter and biquad code (repo The-Hybrid-Elite-Mafia/HybridCore).

## Web build
Compiler: Zig 0.14.0's clang (free, from PyPI package `ziglang`), target `wasm32-wasi`, reactor mode.

    zig c++ -target wasm32-wasi -std=c++23 -O2 -fno-exceptions -mexec-model=reactor -s \
      -I<every HybridCore */include folder> -I hem-elite-rack/rackfx/include \
      engine.cpp EliteEq.cpp Spectrum.cpp Fx.cpp -o hem-engine.wasm

Result: about 95 KB. It asks the browser for only fd_close, fd_seek and fd_write, which the worklet stubs.
Zig 0.13.0 fails to link (its libc++ for wasm is built without threads); 0.14.0 works.

## Proof (test/prove.py)
The same 4-second test signal and settings scripts run through a native g++ -std=c++23 build and the web
build (128-sample blocks, like the browser). Measured Nov 4, 2026:

| Settings | Biggest sample difference | Difference below the music | Level difference |
|---|---|---|---|
| Busy master: low cut, bell, high shelf, dynamic band, TUBE, drive 40 %, auto gain, faders, volume -3 dB | 8.9e-08 | 147.5 dB | 0.000000 dB |
| Notch, tilt, SIDE band, 48 dB/oct high cut, CONSOLE | 6.0e-08 | 150.2 dB | 0.000000 dB |
| SURGEON defaults (all bands off) | 0 | exact | 0.000000 dB |

Graph curves: the player's JavaScript curve drawing matches SURGEON's C++ `design()` + `magnitudeDb()`
within 5e-10 dB at 143 points across all 7 band types.

## In a real browser (playtest.py, headless Chrome)
Test tone song loaded through ADD SONGS, played through the engine:
- normal: peaks L -9.5 / R -9.5 dBFS
- SURGEON band 1 bell 440 Hz +12 dB Q 1: L -0.6 (440 Hz tone side) / R -4.5 dBFS
- volume at minus infinity: silence

## What a web page cannot do
Browsers always hand finished sound to the computer's own sound system (on Windows, the shared
Windows mixer). ASIO and WASAPI exclusive are only possible in the PC app, which will use Hybrid Core's
existing ASIO / WASAPI exclusive outputs.

## ASSUMED values
- Fader bell width Q 1.41 (one octave) — engine.cpp `kFaderQ`.
- Spectrum display lift +12 dB — hem-player-3d.html `specTarget`.
