// =============================================================================
//  HEM HOTHEAD web engine: the real HOTHEAD C++ (hem-elite-rack rackfx/src/tone/Hothead.cpp, unchanged)
//  wrapped for the website tablet.
//
//  Chain:  stems summed by the page -> HOTHEAD (DRIVE 0..10) -> ON/OFF -> output trim -> speakers
//  ON/OFF: HOTHEAD keeps running either way; OFF hears the input delayed by HOTHEAD's own 23 samples, so the
//  timing never jumps. The switch fades over 30 ms, so it never clicks.
//
//  Builds two ways: WebAssembly for the page, native for the test that proves both give the same sound.
//  Audio-thread rule: hem_process() never allocates, never locks, never waits.
// =============================================================================
#include "hem/rack/Garage.hpp"
#include "hybrid/fx/Dsp.hpp"
#include "hybrid/fx/Fx.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>

namespace hem::rack { std::unique_ptr<hc::fx::Effect> makeHothead(); }

#if defined(__wasm__)
#define HEM_EXPORT(name) extern "C" __attribute__((export_name(#name)))
#else
#define HEM_EXPORT(name) extern "C"
#endif

namespace {
constexpr std::uint32_t kBlock = hc::fx::Effect::kMaxBlock;
constexpr std::uint32_t kLat = hem::rack::hothead::kLatency;

struct Engine {
    double fs = 48000.0;
    std::unique_ptr<hc::fx::Effect> hot;
    bool on = true;
    float wet = 1.0f, step = 0.001f;          // 1 = HOTHEAD heard, 0 = straight through
    float trimTarget = 1.0f;
    hc::fx::Smoothed trim{};
    std::array<float, kLat> dlyL{}, dlyR{};   // the dry path, kept in step with HOTHEAD's 23-sample delay
    std::uint32_t dpos = 0;
    std::array<float, kBlock> L{}, R{}, dryL{}, dryR{};
    float peakIn = 0, peakOut = 0;
};
Engine* g = nullptr;
} // namespace

HEM_EXPORT(hem_init) int hem_init(double sampleRate) {
    delete g;
    g = new Engine;
    g->fs = sampleRate;
    g->hot = hem::rack::makeHothead();
    g->hot->prepare(sampleRate, kBlock);
    g->step = static_cast<float>(1.0 / (0.03 * sampleRate));
    g->trim.prepare(sampleRate, 30, 1.0f);
    return 1;
}
HEM_EXPORT(hem_left) float* hem_left() { return g->L.data(); }
HEM_EXPORT(hem_right) float* hem_right() { return g->R.data(); }
HEM_EXPORT(hem_block_max) std::uint32_t hem_block_max() { return kBlock; }
HEM_EXPORT(hem_latency) std::uint32_t hem_latency() { return kLat; }
HEM_EXPORT(hem_drive_set) void hem_drive_set(float d) { g->hot->set(hem::rack::hothead::Drive, std::clamp(d, 0.0f, 10.0f)); }
HEM_EXPORT(hem_drive_get) float hem_drive_get() { return g->hot->get(hem::rack::hothead::Drive); }
HEM_EXPORT(hem_on) void hem_on(int on) { g->on = on != 0; }
HEM_EXPORT(hem_trim_set) void hem_trim_set(float db) { g->trimTarget = db <= -120.0f ? 0.0f : hc::fx::dbToGain(db); }

HEM_EXPORT(hem_process) void hem_process(std::uint32_t n) {
    Engine& e = *g;
    n = std::min(n, kBlock);
    for (std::uint32_t i = 0; i < n; ++i) {
        e.peakIn = std::max(e.peakIn, std::max(std::fabs(e.L[i]), std::fabs(e.R[i])));
        e.dryL[i] = e.dlyL[e.dpos]; e.dryR[i] = e.dlyR[e.dpos];
        e.dlyL[e.dpos] = e.L[i]; e.dlyR[e.dpos] = e.R[i];
        e.dpos = (e.dpos + 1) % kLat;
    }
    e.hot->process(e.L.data(), e.R.data(), n);
    for (std::uint32_t i = 0; i < n; ++i) {
        e.wet = e.on ? std::min(1.0f, e.wet + e.step) : std::max(0.0f, e.wet - e.step);
        const float t = e.trim.next(e.trimTarget);
        const float l = (e.dryL[i] + e.wet * (e.L[i] - e.dryL[i])) * t;
        const float r = (e.dryR[i] + e.wet * (e.R[i] - e.dryR[i])) * t;
        e.L[i] = l; e.R[i] = r;
        e.peakOut = std::max(e.peakOut, std::max(std::fabs(l), std::fabs(r)));
    }
}
// 0 = input peak, 1 = output peak (since the last read), linear
HEM_EXPORT(hem_peak) float hem_peak(int which) {
    float& p = which == 0 ? g->peakIn : g->peakOut;
    const float v = p; p = 0; return v;
}
