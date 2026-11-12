// =============================================================================
//  HEM rack web engine: any HEM-Elite-Rack plug-in's real C++ (rackfx, unchanged), picked by name, for the
//  website's TRY A PLUG-IN slot.
//
//  Chain:  input -> the plug-in -> ON/OFF -> speakers
//  ON/OFF: the plug-in keeps running either way; OFF hears the input delayed by the plug-in's own latency, so the
//  timing never jumps. The switch fades over 30 ms, so it never clicks.
//
//  The page runs two copies: one in the audio thread (sound, meters, spectrum) and one on the page itself (value
//  text, which controls are active, the EQ curve), both fed the same settings.
//  Builds two ways: WebAssembly for the page, native for the test that proves both give the same sound.
//  Audio-thread rule: hem_process() never allocates, never locks, never waits.
// =============================================================================
#include "hem/rack/Plugins.hpp"
#include "hem/rack/Spectrum.hpp"
#include "hem/rack/TubeEq.hpp"
#include "hybrid/fx/Fx.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#if defined(__wasm__)
#define HEM_EXPORT(name) extern "C" __attribute__((export_name(#name)))
#else
#define HEM_EXPORT(name) extern "C"
#endif

namespace {
constexpr std::uint32_t kBlock = 1024;     // the page never sends more at once
constexpr std::uint32_t kMaxLat = 1 << 16; // the dry path's delay line (longer latencies are refused)

struct Engine {
    double fs = 48000.0;
    const hem::rack::PluginInfo* info = nullptr;
    std::unique_ptr<hc::fx::Effect> fx;
    hem::rack::SpectrumSource* spec = nullptr;
    std::uint32_t lat = 0;
    bool on = true;
    float wet = 1.0f, step = 0.001f;
    std::vector<float> dlyL, dlyR;   // sized once in hem_load, never on the audio thread
    std::uint32_t dpos = 0;
    std::array<float, kBlock> L{}, R{}, dryL{}, dryR{};
    std::array<float, 64> io{};      // small exchange buffer (curve frequencies in, dB out, dots)
    std::array<float, hc::fx::Effect::kMaxParams> plain{};
    char text[96]{};
    char name[64]{};
};
Engine* g = nullptr;
} // namespace

HEM_EXPORT(hem_init) int hem_init(double sampleRate) {
    delete g;
    g = new Engine;
    g->fs = sampleRate;
    g->step = static_cast<float>(1.0 / (0.03 * sampleRate));
    return static_cast<int>(hem::rack::plugins().size());
}
// The plug-in's name goes in hem_name() first (zero-ended); returns its number of controls, -1 when not found.
HEM_EXPORT(hem_name) char* hem_name() { return g->name; }
HEM_EXPORT(hem_load) int hem_load() {
    const hem::rack::PluginInfo* info = hem::rack::findPlugin(g->name);
    if (!info) return -1;
    g->fx = info->create();
    if (!g->fx) { g->info = nullptr; return -1; }   // not in the web build (needs threads)
    g->info = info;
    g->fx->setDefaults();
    g->fx->prepare(g->fs, kBlock);
    g->lat = std::min(g->fx->latency(), kMaxLat - 1);
    g->dlyL.assign(g->lat + 1, 0.0f);
    g->dlyR.assign(g->lat + 1, 0.0f);
    g->dpos = 0;
    g->spec = dynamic_cast<hem::rack::SpectrumSource*>(g->fx.get());
    if (g->spec) { g->spec->spectrumBefore().setActive(true); g->spec->spectrumAfter().setActive(true); }
    return static_cast<int>(g->fx->params().size());
}
HEM_EXPORT(hem_latency) int hem_latency() { return static_cast<int>(g->lat); }
HEM_EXPORT(hem_left) float* hem_left() { return g->L.data(); }
HEM_EXPORT(hem_right) float* hem_right() { return g->R.data(); }
HEM_EXPORT(hem_io) float* hem_io() { return g->io.data(); }

HEM_EXPORT(hem_set) void hem_set(int i, float plain) { if (g->fx) g->fx->set(i, plain); }
HEM_EXPORT(hem_get) float hem_get(int i) { return g->fx ? g->fx->get(i) : 0.0f; }
HEM_EXPORT(hem_norm) float hem_norm(int i) {
    const auto ps = g->fx->params();
    return i >= 0 && i < static_cast<int>(ps.size()) ? hc::fx::toNormalized(ps[static_cast<std::size_t>(i)], g->fx->get(i)) : 0.0f;
}
HEM_EXPORT(hem_set_norm) void hem_set_norm(int i, float n) {
    const auto ps = g->fx->params();
    if (i >= 0 && i < static_cast<int>(ps.size())) g->fx->set(i, hc::fx::toPlain(ps[static_cast<std::size_t>(i)], std::clamp(n, 0.0f, 1.0f)));
}
HEM_EXPORT(hem_active) int hem_active(int i) { return g->fx && g->fx->paramActive(i) ? 1 : 0; }
// The value as the plug-in writes it ("-18.0 dB", "AUTO"), zero-ended.
HEM_EXPORT(hem_text) char* hem_text(int i) {
    const auto ps = g->fx->params();
    std::string s = i >= 0 && i < static_cast<int>(ps.size()) ? hc::fx::formatValue(ps[static_cast<std::size_t>(i)], g->fx->get(i)) : std::string();
    std::snprintf(g->text, sizeof g->text, "%s", s.c_str());
    return g->text;
}
HEM_EXPORT(hem_on) void hem_on(int on) { g->on = on != 0; }
HEM_EXPORT(hem_reset) void hem_reset() { if (g->fx) g->fx->reset(); std::fill(g->dlyL.begin(), g->dlyL.end(), 0.0f); std::fill(g->dlyR.begin(), g->dlyR.end(), 0.0f); }

HEM_EXPORT(hem_process) void hem_process(int frames) {
    Engine& e = *g;
    if (!e.fx) return;
    const std::uint32_t n = std::min<std::uint32_t>(static_cast<std::uint32_t>(std::max(frames, 0)), kBlock);
    const std::uint32_t D = e.lat + 1;
    for (std::uint32_t i = 0; i < n; ++i) {   // the dry path: the same input, delayed by the plug-in's latency
        e.dlyL[e.dpos] = e.L[i]; e.dlyR[e.dpos] = e.R[i];
        const std::uint32_t rp = (e.dpos + 1) % D;   // D-1 samples back = lat
        e.dryL[i] = e.dlyL[rp]; e.dryR[i] = e.dlyR[rp];
        e.dpos = rp;
    }
    e.fx->process(e.L.data(), e.R.data(), n);
    const float target = e.on ? 1.0f : 0.0f;
    for (std::uint32_t i = 0; i < n; ++i) {
        if (e.wet != target) e.wet = e.wet < target ? std::min(target, e.wet + e.step) : std::max(target, e.wet - e.step);
        e.L[i] = e.dryL[i] + (e.L[i] - e.dryL[i]) * e.wet;
        e.R[i] = e.dryR[i] + (e.R[i] - e.dryR[i]) * e.wet;
    }
}

// Meters: gain reduction (dB, <= 0) and the plug-in's own readouts.
HEM_EXPORT(hem_reduction) float hem_reduction() { return g->fx ? g->fx->reductionDb() : 0.0f; }
HEM_EXPORT(hem_meter) float hem_meter(int i) { return g->fx ? g->fx->meter(i) : 0.0f; }
// Spectrum (before / after the plug-in), kSpectrumBins display bins, dB; none when the plug-in has no analyzer.
HEM_EXPORT(hem_has_spectrum) int hem_has_spectrum() { return g->spec ? hem::rack::kSpectrumBins : 0; }
HEM_EXPORT(hem_spec_before) float hem_spec_before(int b) { return g->spec ? g->spec->spectrumBefore().level(b) : -120.0f; }
HEM_EXPORT(hem_spec_after) float hem_spec_after(int b) { return g->spec ? g->spec->spectrumAfter().level(b) : -120.0f; }
HEM_EXPORT(hem_bin_hz) float hem_bin_hz(int b) { return hem::rack::spectrumBinHz(b); }

// The EQ curve, from the plug-in's own description of it (the same maths the audio runs).
// hem_curve_info: 0 none; 1 the plug-in describes its curve (CurveInfo); 2 VELVET's valve EQ (tubeeq, as FaceView
// draws it: +-20 dB, dots at LOW FREQUENCY, HIGH FREQUENCY, ATTEN SELECT). io[0] = range, io[1] = scaleParam,
// io[2] = spectrumParam, io[3] = has its own right side.
static bool tube() { return g->info && g->info->face == hem::rack::Face::TubeEq && !g->info->curve; }
HEM_EXPORT(hem_curve_info) int hem_curve_info() {
    const hem::rack::CurveInfo* ci = g->info ? g->info->curve : nullptr;
    if (!ci && tube()) { g->io[0] = 20.0f; g->io[1] = -1.0f; g->io[2] = -1.0f; g->io[3] = 0.0f; return 2; }
    if (!ci) return 0;
    g->io[0] = ci->range; g->io[1] = static_cast<float>(ci->scaleParam); g->io[2] = static_cast<float>(ci->spectrumParam);
    g->io[3] = ci->dbRight ? 1.0f : 0.0f;
    return 1;
}
static void loadPlain() {
    const int n = static_cast<int>(g->fx->params().size());
    for (int i = 0; i < n; ++i) g->plain[static_cast<std::size_t>(i)] = g->fx->get(i);
}
HEM_EXPORT(hem_curve_db) double hem_curve_db(double hz, int right) {
    const hem::rack::CurveInfo* ci = g->info ? g->info->curve : nullptr;
    if (!ci && tube()) { loadPlain(); return hem::rack::tubeeq::curveDb(hem::rack::tubeeq::settingsFrom(g->plain.data()), g->fs, hz); }
    if (!ci) return 0.0;
    loadPlain();
    return right && ci->dbRight ? ci->dbRight(g->plain.data(), g->fs, hz) : ci->db(g->plain.data(), g->fs, hz);
}
// Band dots: their frequencies in io[0..], returns how many.
HEM_EXPORT(hem_curve_dots) int hem_curve_dots() {
    const hem::rack::CurveInfo* ci = g->info ? g->info->curve : nullptr;
    if (!ci && tube()) {
        loadPlain();
        const auto ts = hem::rack::tubeeq::settingsFrom(g->plain.data());
        g->io[0] = static_cast<float>(ts.lowHz); g->io[1] = static_cast<float>(ts.highHz); g->io[2] = static_cast<float>(ts.attenHz);
        return 3;
    }
    if (!ci) return 0;
    loadPlain();
    double hz[12];
    const int n = ci->dots(g->plain.data(), hz, 12);
    for (int i = 0; i < n; ++i) g->io[static_cast<std::size_t>(i)] = static_cast<float>(hz[i]);
    return n;
}
