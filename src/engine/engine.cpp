// =============================================================================
//  HEM web engine — the sound of the HEM 3D player, all C++23.
//
//  Chain:  song -> SURGEON (hem-elite-rack's real EliteEq.cpp, unchanged)
//               -> 10-band faders (Hybrid Core RBJ bells)
//               -> loudness meter (hem-elite-rack's THE ACCOUNTANT, LoudnessMeter.cpp, unchanged;
//                  BS.1770 / EBU R128; reads the song as shaped, before the listening volume)
//               -> volume -> speakers
//
//  The same file builds two ways:
//    * WebAssembly for the website player (the browser hands us 128-sample blocks), and
//    * native, for the test that proves both builds give the same sound.
//
//  Audio-thread rules: hem_process() never allocates, never locks, never waits. Everything is
//  allocated in hem_init().
// =============================================================================
#include "hem/rack/EliteEq.hpp"
#include "hem/rack/Tools.hpp"
#include "hybrid/fx/Dsp.hpp"
#include "hybrid/fx/Fx.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>

#if defined(__wasm__)
#define HEM_EXPORT(name) extern "C" __attribute__((export_name(#name)))
#else
#define HEM_EXPORT(name) extern "C"
#endif

namespace {

// The ten fader frequencies printed on the faceplate.
constexpr std::array<double, 10> kFaderHz{31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};
// ASSUMED: one-octave bells for the faders (Q 1.41). Steven has not picked a fader width yet.
constexpr double kFaderQ = 1.41;
constexpr std::uint32_t kBlock = hc::fx::Effect::kMaxBlock;

struct Engine {
    double fs = 48000.0;
    std::unique_ptr<hc::fx::Effect> surgeon;
    const hem::rack::EliteEqView* view = nullptr;
    bool surgeonOn = true;
    std::unique_ptr<hc::fx::Effect> loudness;

    std::array<hc::fx::Biquad2, 10> faders{};
    std::array<float, 10> faderDb{};
    std::array<float, 10> faderApplied{};
    bool fadersOn = true;

    float volumeTarget = 1.0f;
    hc::fx::Smoothed volume{};

    // meters (written by the audio thread, read by the page between blocks)
    float peakL = 0, peakR = 0, sumSqL = 0, sumSqR = 0;
    std::uint32_t sumCount = 0;

    alignas(16) std::array<float, kBlock> L{};
    alignas(16) std::array<float, kBlock> R{};
};

Engine* g = nullptr;

void designFader(Engine& e, std::size_t b) {
    e.faders[b].set(hc::fx::BiquadCoefs::make(hc::fx::BiquadCoefs::Type::Bell, e.fs, kFaderHz[b], kFaderQ, e.faderDb[b]));
    e.faderApplied[b] = e.faderDb[b];
}

} // namespace

HEM_EXPORT(hem_init) int hem_init(double sampleRate) {
    if (g) return 1;
    g = new Engine();
    g->fs = sampleRate;
    g->surgeon = hem::rack::makeEliteEq();
    g->surgeon->setDefaults();
    g->surgeon->prepare(sampleRate, kBlock);
    g->view = dynamic_cast<const hem::rack::EliteEqView*>(g->surgeon.get());
    g->loudness = hem::rack::makeLoudnessMeter();
    g->loudness->setDefaults();
    g->loudness->prepare(sampleRate, kBlock);
    for (std::size_t b = 0; b < g->faders.size(); ++b) designFader(*g, b);
    g->volume.prepare(sampleRate, 20.0, 1.0f);
    return 1;
}

HEM_EXPORT(hem_left) float* hem_left() { return g->L.data(); }
HEM_EXPORT(hem_right) float* hem_right() { return g->R.data(); }
HEM_EXPORT(hem_block_max) std::uint32_t hem_block_max() { return kBlock; }

// SURGEON parameter i (hem-elite-rack's flat list: band b control c = b * 12 + c; then OUTPUT, AUTO GAIN,
// CHARACTER, DRIVE), in plain units exactly as SURGEON shows them.
HEM_EXPORT(hem_surgeon_set) void hem_surgeon_set(int i, float plain) { g->surgeon->set(i, plain); }
HEM_EXPORT(hem_surgeon_get) float hem_surgeon_get(int i) { return g->surgeon->get(i); }
HEM_EXPORT(hem_surgeon_count) int hem_surgeon_count() { return static_cast<int>(g->surgeon->params().size()); }
HEM_EXPORT(hem_surgeon_on) void hem_surgeon_on(int on) { g->surgeonOn = on != 0; }
HEM_EXPORT(hem_surgeon_latency) std::uint32_t hem_surgeon_latency() { return g->surgeon->latency(); }
HEM_EXPORT(hem_dyn_gain) float hem_dyn_gain(int band) { return g->view ? g->view->dynamicGainDb(band) : 0.0f; }
HEM_EXPORT(hem_auto_gain) float hem_auto_gain() { return g->view ? g->view->autoGainDb() : 0.0f; }

HEM_EXPORT(hem_fader_set) void hem_fader_set(int band, float db) {
    if (band >= 0 && band < 10) g->faderDb[static_cast<std::size_t>(band)] = std::clamp(db, -12.0f, 12.0f);
}
HEM_EXPORT(hem_faders_on) void hem_faders_on(int on) { g->fadersOn = on != 0; }

// Volume in dB; anything at or below -120 is silence (the −∞ end of the knob).
HEM_EXPORT(hem_volume_set) void hem_volume_set(float db) { g->volumeTarget = db <= -120.0f ? 0.0f : hc::fx::dbToGain(db); }

// THE ACCOUNTANT's readouts: 0 momentary LUFS, 1 short-term LUFS, 2 integrated LUFS, 3 loudness range LU,
// 4 true peak dBTP, 5 correlation, 6 integrated minus target LU (-100 = nothing measured yet).
HEM_EXPORT(hem_loudness) float hem_loudness(int which) { return g->loudness->meter(which); }
// Target: 0 = -14, 1 = -16, 2 = -11, 3 = -9 LUFS.
HEM_EXPORT(hem_loudness_target) void hem_loudness_target(int which) { g->loudness->set(hem::rack::meter::Target, static_cast<float>(which)); }
// Starts the measurement over (a new song).
HEM_EXPORT(hem_loudness_reset) void hem_loudness_reset() { g->loudness->reset(); }

HEM_EXPORT(hem_reset) void hem_reset() {
    g->surgeon->reset();
    for (auto& f : g->faders) f.clear();
}

// Processes n samples of hem_left() / hem_right() in place.
HEM_EXPORT(hem_process) void hem_process(std::uint32_t n) {
    Engine& e = *g;
    n = std::min(n, kBlock);
    float* L = e.L.data();
    float* R = e.R.data();
    if (e.surgeonOn) e.surgeon->process(L, R, n);
    if (e.fadersOn) {
        for (std::size_t b = 0; b < e.faders.size(); ++b) {
            if (e.faderApplied[b] != e.faderDb[b]) designFader(e, b);
            if (e.faderDb[b] != 0.0f) e.faders[b].run(L, R, n);
        }
    }
    e.loudness->process(L, R, n);   // measures only; the audio passes through untouched
    float pl = e.peakL, pr = e.peakR;
    for (std::uint32_t i = 0; i < n; ++i) {
        const float v = e.volume.next(e.volumeTarget);
        L[i] *= v;
        R[i] *= v;
        pl = std::max(pl, std::abs(L[i]));
        pr = std::max(pr, std::abs(R[i]));
        e.sumSqL += L[i] * L[i];
        e.sumSqR += R[i] * R[i];
    }
    e.peakL = pl;
    e.peakR = pr;
    e.sumCount += n;
}

// Meters since the last read: 0 = peak L, 1 = peak R, 2 = RMS L, 3 = RMS R (linear). Reading clears them.
HEM_EXPORT(hem_meter) float hem_meter(int which) {
    Engine& e = *g;
    const float cnt = static_cast<float>(std::max<std::uint32_t>(e.sumCount, 1));
    float v = 0.0f;
    switch (which) {
    case 0: v = e.peakL; break;
    case 1: v = e.peakR; break;
    case 2: v = std::sqrt(e.sumSqL / cnt); break;
    case 3: v = std::sqrt(e.sumSqR / cnt); break;
    default: break;
    }
    return v;
}
HEM_EXPORT(hem_meter_clear) void hem_meter_clear() {
    g->peakL = g->peakR = 0.0f;
    g->sumSqL = g->sumSqR = 0.0f;
    g->sumCount = 0;
}
