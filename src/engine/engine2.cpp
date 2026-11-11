// =============================================================================
//  HEM web engine 2: the sound of the HEM Listening Player, all C++23.
//
//  Chain:  song -> AUTO-LEVELER: measures the song's loudness (BS.1770 K-weighting, 3 s window) and slowly
//                  turns it up or down to TARGET, by no more than RANGE; it never boosts silence or fade-outs
//               -> SURGEON (hem-elite-rack EliteEq.cpp, unchanged; off unless switched on)
//               -> BROADCAST EQ (low shelf 100 Hz, mid bell 1 kHz, high shelf 10 kHz; Hybrid Core RBJ biquads)
//               -> BASS BOOST (low shelf at FREQUENCY by GAIN, then DRIVE: soft clipping on the lows only;
//                  only what the clipping adds is mixed in, so the dry sound is never thinned out)
//               (AUTO-LEVELER sits first: every song is brought to the same loudness before anything else)
//               -> MONITORING (CROSSFEED for headphones, stereo WIDTH, OUTPUT LEVEL)
//               -> HEM LOCKDOWN limiter (hem-elite-rack Limiter.cpp, unchanged): ceiling -1 dBTP, so a boosted
//                  song can never clip
//               -> L / R trims -> loudness meter (THE ACCOUNTANT, LoudnessMeter.cpp, unchanged)
//               -> VOLUME / MUTE -> meters -> speakers
//
//  Builds as WebAssembly for the page and natively for the test that proves both builds give the same sound.
//  Audio-thread rule: hem_process() never allocates, never locks, never waits.
// =============================================================================
#include "hem/rack/Limiter.hpp"
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
using BQ = hc::fx::BiquadCoefs;
constexpr std::uint32_t kBlock = hc::fx::Effect::kMaxBlock;

// Every control the page can set with hem_set(id, value), in plain units.
enum Id : int {
    BeqOn, BeqLow, BeqMid, BeqHigh,               // dB, -12..+12
    LevOn, LevTarget, LevRange, LevSpeed,         // LUFS -24..-9; dB 0..24 (most it may turn up or down); s 1..10
    BassOn, BassDrive, BassFreq, BassGain,        // % 0..100; Hz 30..250; dB 0..+12
    MonOn, Crossfeed, Width, Output,              // % 0..100; % 0..200; dB -24..+12
    TrimL, TrimR, Volume, Mute,                   // dB -12..+12; dB (<= -120 = silence); 0/1
    kIds
};
constexpr float kDef[kIds] = {1, 0, 0, 0, 1, -14, 18, 3, 1, 0, 80, 0, 1, 0, 100, 0, 0, 0, 0, 0};
// ASSUMED: corner frequencies of BROADCAST EQ, crossfeed filter and delay (Steven has not set these)
constexpr double kBeqLowHz = 100.0, kBeqMidHz = 1000.0, kBeqMidQ = 0.7, kBeqHighHz = 10000.0;
constexpr double kXfeedHz = 700.0, kXfeedMs = 0.3;
// ASSUMED: the level the BASS BOOST drive is set up around: lows at -20 dBFS come out the same level
constexpr float kDriveRef = 0.1f;
// AUTO-LEVELER: below this the song counts as silence / a fade and the level is held, not boosted
constexpr float kGateLufs = -45.0f;
constexpr double kLoudWindowS = 3.0;   // loudness is measured over about 3 s (like short-term LUFS)
constexpr double kWarmS = 0.4;         // a new song: hold the level for its first 0.4 s, then settle quickly

// A filter whose gain glides to its target (at most 0.5 dB per block), so turning a knob never clicks.
struct GlideFilter {
    hc::fx::Biquad2 f{};
    BQ::Type type = BQ::Type::Bell;
    double hz = 1000, q = 0.7071;
    float target = 0, cur = 1e9f;
    double curHz = -1;
    void step(double fs) {
        if (cur == target && curHz == hz) return;
        cur = cur > 1e8f ? target : cur + std::clamp(target - cur, -0.5f, 0.5f);
        curHz = hz;
        f.set(BQ::make(type, fs, hz, q, cur));
    }
    bool flat() const { return cur == 0.0f && target == 0.0f; }
};

struct Engine {
    double fs = 48000.0;
    std::unique_ptr<hc::fx::Effect> surgeon, limiter, loudness;
    const hem::rack::EliteEqView* view = nullptr;
    bool surgeonOn = false;
    std::array<float, kIds> v{};

    GlideFilter beqLow, beqMid, beqHigh, bassShelf;
    hc::fx::Biquad2 bassSplit{};       // low-pass that picks out the lows the drive works on
    double bassSplitHz = -1;
    hc::fx::Smoothed driveMix{};

    // AUTO-LEVELER
    hc::fx::Biquad2 kShelf{}, kHp{};   // BS.1770 K-weighting (RBJ approximation)
    double ms = 0, msCoef = 0;          // K-weighted mean square, ~3 s
    double mm = 0, mmCoef = 0;          // the same over ~0.4 s (momentary): spots fade-outs and silence
    double levGainDb = 0;               // what is applied now
    std::uint64_t sinceReset = 0;
    float levShown = 0;

    hc::fx::Biquad2 xfeedLp{};
    std::array<float, 64> xdL{}, xdR{};
    std::uint32_t xpos = 0, xdelay = 14;
    hc::fx::Smoothed xfeed{}, width{}, output{}, trimL{}, trimR{}, volume{};

    float peakL = 0, peakR = 0, sumSqL = 0, sumSqR = 0;
    std::uint32_t sumCount = 0;
    alignas(16) std::array<float, kBlock> L{}, R{};
};
Engine* g = nullptr;

inline float db2g(float db) { return db <= -120.0f ? 0.0f : hc::fx::dbToGain(db); }
} // namespace

HEM_EXPORT(hem_init) int hem_init(double sampleRate) {
    if (g) return 1;
    g = new Engine();
    Engine& e = *g;
    e.fs = sampleRate;
    e.surgeon = hem::rack::makeEliteEq();
    e.surgeon->setDefaults();
    e.surgeon->prepare(sampleRate, kBlock);
    e.view = dynamic_cast<const hem::rack::EliteEqView*>(e.surgeon.get());
    e.limiter = hem::rack::makeLimiter();
    e.limiter->setDefaults();                    // INPUT 0, CEILING -1 dB, TRUE PEAK on, AUTO release, LINK 100 %
    e.limiter->prepare(sampleRate, kBlock);
    e.kShelf.set(BQ::make(BQ::Type::HighShelf, sampleRate, 1681.97, 0.7071, 4.0));
    e.kHp.set(BQ::make(BQ::Type::HighPass, sampleRate, 38.135, 0.5003));
    e.msCoef = 1.0 - std::exp(-1.0 / (kLoudWindowS * sampleRate));
    e.mmCoef = 1.0 - std::exp(-1.0 / (0.4 * sampleRate));
    e.loudness = hem::rack::makeLoudnessMeter();
    e.loudness->setDefaults();
    e.loudness->prepare(sampleRate, kBlock);
    for (int i = 0; i < kIds; ++i) e.v[static_cast<std::size_t>(i)] = kDef[i];
    e.beqLow.type = BQ::Type::LowShelf;  e.beqLow.hz = kBeqLowHz;
    e.beqMid.type = BQ::Type::Bell;      e.beqMid.hz = kBeqMidHz; e.beqMid.q = kBeqMidQ;
    e.beqHigh.type = BQ::Type::HighShelf; e.beqHigh.hz = kBeqHighHz;
    e.bassShelf.type = BQ::Type::LowShelf;
    e.xfeedLp.set(BQ::make(BQ::Type::LowPass, sampleRate, kXfeedHz, 0.7071));
    e.xdelay = static_cast<std::uint32_t>(std::clamp(std::lround(kXfeedMs * 0.001 * sampleRate), 1L, 63L));
    e.driveMix.prepare(sampleRate, 30, 0);
    e.xfeed.prepare(sampleRate, 30, 0);
    e.width.prepare(sampleRate, 30, 1);
    e.output.prepare(sampleRate, 30, 1);
    e.trimL.prepare(sampleRate, 30, 1);
    e.trimR.prepare(sampleRate, 30, 1);
    e.volume.prepare(sampleRate, 20, 1);
    return 1;
}

HEM_EXPORT(hem_left) float* hem_left() { return g->L.data(); }
HEM_EXPORT(hem_right) float* hem_right() { return g->R.data(); }
HEM_EXPORT(hem_block_max) std::uint32_t hem_block_max() { return kBlock; }

// SURGEON parameter i (band b control c = b * 12 + c; then OUTPUT, AUTO GAIN, CHARACTER, DRIVE), plain units.
HEM_EXPORT(hem_surgeon_set) void hem_surgeon_set(int i, float plain) { g->surgeon->set(i, plain); }
HEM_EXPORT(hem_surgeon_get) float hem_surgeon_get(int i) { return g->surgeon->get(i); }
HEM_EXPORT(hem_surgeon_on) void hem_surgeon_on(int on) { g->surgeonOn = on != 0; }
HEM_EXPORT(hem_dyn_gain) float hem_dyn_gain(int band) { return g->view ? g->view->dynamicGainDb(band) : 0.0f; }
HEM_EXPORT(hem_auto_gain) float hem_auto_gain() { return g->view ? g->view->autoGainDb() : 0.0f; }

HEM_EXPORT(hem_set) void hem_set(int id, float value) {
    if (id < 0 || id >= kIds) return;
    g->v[static_cast<std::size_t>(id)] = value;
}
HEM_EXPORT(hem_get) float hem_get(int id) { return id >= 0 && id < kIds ? g->v[static_cast<std::size_t>(id)] : 0.0f; }

// THE ACCOUNTANT: 0 momentary, 1 short-term, 2 integrated LUFS, 3 range LU, 4 true peak dBTP, 5 correlation, 6 vs target.
HEM_EXPORT(hem_loudness) float hem_loudness(int which) { return g->loudness->meter(which); }
HEM_EXPORT(hem_loudness_target) void hem_loudness_target(int which) { g->loudness->set(hem::rack::meter::Target, static_cast<float>(which)); }
HEM_EXPORT(hem_loudness_reset) void hem_loudness_reset() { g->loudness->reset(); }

// A new song starts: the AUTO-LEVELER measures it from scratch (keeps the level it had until it knows).
HEM_EXPORT(hem_level_reset) void hem_level_reset() { g->ms = 0; g->mm = 0; g->sinceReset = 0; }

HEM_EXPORT(hem_reset) void hem_reset() {
    Engine& e = *g;
    e.surgeon->reset();
    e.limiter->reset();
    for (auto* f : {&e.beqLow, &e.beqMid, &e.beqHigh, &e.bassShelf}) f->f.clear();
    e.bassSplit.clear();
    e.xfeedLp.clear();
    e.xdL.fill(0); e.xdR.fill(0);
}

HEM_EXPORT(hem_process) void hem_process(std::uint32_t n) {
    Engine& e = *g;
    n = std::min(n, kBlock);
    float* L = e.L.data();
    float* R = e.R.data();
    const auto& v = e.v;

    // AUTO-LEVELER
    {
        const double fs = e.fs;
        const bool on = v[LevOn] > 0.5f;
        const double target = std::clamp(static_cast<double>(v[LevTarget]), -24.0, -9.0);
        const double range = std::clamp(static_cast<double>(v[LevRange]), 0.0, 24.0);
        const double speedS = std::clamp(static_cast<double>(v[LevSpeed]), 1.0, 10.0);
        double gdb = e.levGainDb;
        const double warm = kWarmS * fs;
        for (std::uint32_t i = 0; i < n; ++i) {
            const float kl = e.kHp.l.tick(e.kShelf.l.tick(L[i])), kr = e.kHp.r.tick(e.kShelf.r.tick(R[i]));
            const double p = static_cast<double>(kl) * kl + static_cast<double>(kr) * kr;
            // a fresh song fills the meter at its own speed for the first moments, so it settles fast
            const double c = e.sinceReset < static_cast<std::uint64_t>(warm) ? 1.0 / static_cast<double>(e.sinceReset + 1) : e.msCoef;
            e.ms += (p - e.ms) * c;
            e.mm += (p - e.mm) * std::max(c, e.mmCoef);
            ++e.sinceReset;
            double want = gdb;
            if (on) {
                const double lufs = -0.691 + 10.0 * std::log10(e.ms + 1e-20);
                const double now = -0.691 + 10.0 * std::log10(e.mm + 1e-20);
                if (e.sinceReset >= static_cast<std::uint64_t>(warm) && lufs > kGateLufs) {
                    want = std::clamp(target - lufs, -range, range);
                    // the song is fading out or has stopped (the last 0.4 s is far under the last 3 s): never turn up now
                    if ((now < lufs - 8.0 || now < kGateLufs) && want > gdb) want = gdb;
                }
            } else {
                want = 0.0;
            }
            // settle: quick (0.5 s) in a song's first 2 s, then SPEED seconds; turning down is twice as quick as up
            const double tau = (e.sinceReset < static_cast<std::uint64_t>(2.0 * fs) ? 0.5 : speedS) * (want < gdb ? 0.5 : 1.0);
            gdb += (want - gdb) * (1.0 - std::exp(-1.0 / (tau * fs)));
            const float gl = static_cast<float>(std::pow(10.0, gdb / 20.0));
            L[i] *= gl;
            R[i] *= gl;
        }
        e.levGainDb = gdb;
        e.levShown = static_cast<float>(gdb);
    }

    if (e.surgeonOn) e.surgeon->process(L, R, n);

    // BROADCAST EQ
    e.beqLow.target = v[BeqOn] > 0.5f ? std::clamp(v[BeqLow], -12.0f, 12.0f) : 0.0f;
    e.beqMid.target = v[BeqOn] > 0.5f ? std::clamp(v[BeqMid], -12.0f, 12.0f) : 0.0f;
    e.beqHigh.target = v[BeqOn] > 0.5f ? std::clamp(v[BeqHigh], -12.0f, 12.0f) : 0.0f;
    for (auto* f : {&e.beqLow, &e.beqMid, &e.beqHigh}) {
        f->step(e.fs);
        if (!f->flat()) f->f.run(L, R, n);
    }

    // BASS BOOST
    const bool bassOn = v[BassOn] > 0.5f;
    e.bassShelf.hz = std::clamp(static_cast<double>(v[BassFreq]), 30.0, 250.0);
    e.bassShelf.target = bassOn ? std::clamp(v[BassGain], 0.0f, 12.0f) : 0.0f;
    e.bassShelf.step(e.fs);
    if (!e.bassShelf.flat()) e.bassShelf.f.run(L, R, n);
    if (e.bassSplitHz != e.bassShelf.hz) {
        e.bassSplitHz = e.bassShelf.hz;
        e.bassSplit.set(BQ::make(BQ::Type::LowPass, e.fs, e.bassSplitHz, 0.7071));
    }
    {
        const float d = bassOn ? std::clamp(v[BassDrive], 0.0f, 100.0f) * 0.01f : 0.0f;
        const float k = 1.0f + 19.0f * d * std::sqrt(d);                 // how hard the lows are pushed: 1x .. 20x
        const float norm = kDriveRef / std::tanh(k * kDriveRef);        // lows at kDriveRef come out level
        const float mixT = d > 0.0f ? 1.0f : 0.0f;
        if (mixT > 0.0f || e.driveMix.cur > 1e-5f) {
            for (std::uint32_t i = 0; i < n; ++i) {
                const float lo = e.bassSplit.l.tick(L[i]), ro = e.bassSplit.r.tick(R[i]);
                const float m = e.driveMix.next(mixT);
                L[i] += m * (std::tanh(k * lo) * norm - lo);
                R[i] += m * (std::tanh(k * ro) * norm - ro);
            }
        } else {
            e.bassSplit.clear();
        }
    }

    // MONITORING
    const bool monOn = v[MonOn] > 0.5f;
    const float xT = monOn ? std::clamp(v[Crossfeed], 0.0f, 100.0f) * 0.01f : 0.0f;
    const float wT = monOn ? std::clamp(v[Width], 0.0f, 200.0f) * 0.01f : 1.0f;
    const float oT = monOn ? db2g(std::clamp(v[Output], -24.0f, 12.0f)) : 1.0f;
    const float tlT = db2g(std::clamp(v[TrimL], -12.0f, 12.0f)), trT = db2g(std::clamp(v[TrimR], -12.0f, 12.0f));
    for (std::uint32_t i = 0; i < n; ++i) {
        float l = L[i], r = R[i];
        // crossfeed: each ear also hears the other side, darker and 0.3 ms later, as from speakers
        const float x = e.xfeed.next(xT);
        const float fl = e.xfeedLp.l.tick(l), fr = e.xfeedLp.r.tick(r);
        const std::uint32_t rp = (e.xpos + 64 - e.xdelay) & 63u;
        const float dl = e.xdL[rp], dr = e.xdR[rp];
        e.xdL[e.xpos] = fl; e.xdR[e.xpos] = fr; e.xpos = (e.xpos + 1) & 63u;
        if (x > 1e-5f) {
            const float k = 0.5f * x, nrm = 1.0f / (1.0f + k);
            l = (l + k * dr) * nrm;
            r = (r + k * dl) * nrm;
        }
        // width: 0 % = mono, 100 % = as recorded, 200 % = twice the side signal
        const float w = e.width.next(wT), mid = 0.5f * (l + r), side = 0.5f * (l - r) * w;
        const float o = e.output.next(oT);
        L[i] = (mid + side) * o * e.trimL.next(tlT);
        R[i] = (mid - side) * o * e.trimR.next(trT);
    }

    e.limiter->process(L, R, n);    // HEM LOCKDOWN: nothing past -1 dBTP
    e.loudness->process(L, R, n);   // measures what you hear before the listening volume

    const float volT = v[Mute] > 0.5f ? 0.0f : db2g(v[Volume]);
    float pl = e.peakL, pr = e.peakR;
    for (std::uint32_t i = 0; i < n; ++i) {
        const float vol = e.volume.next(volT);
        L[i] *= vol;
        R[i] *= vol;
        pl = std::max(pl, std::abs(L[i]));
        pr = std::max(pr, std::abs(R[i]));
        e.sumSqL += L[i] * L[i];
        e.sumSqR += R[i] * R[i];
    }
    e.peakL = pl;
    e.peakR = pr;
    e.sumCount += n;
}

// Since the last hem_meter_clear: 0 peak L, 1 peak R, 2 RMS L, 3 RMS R (linear); 4 AUTO-LEVELER gain now (dB);
// 5 HEM LOCKDOWN gain reduction now (dB, <= 0).
HEM_EXPORT(hem_meter) float hem_meter(int which) {
    Engine& e = *g;
    const float cnt = static_cast<float>(std::max<std::uint32_t>(e.sumCount, 1));
    switch (which) {
    case 0: return e.peakL;
    case 1: return e.peakR;
    case 2: return std::sqrt(e.sumSqL / cnt);
    case 3: return std::sqrt(e.sumSqR / cnt);
    case 4: return e.levShown;
    case 5: return e.limiter->reductionDb();
    default: return 0.0f;
    }
}
HEM_EXPORT(hem_meter_clear) void hem_meter_clear() {
    g->peakL = g->peakR = g->sumSqL = g->sumSqR = 0.0f;
    g->sumCount = 0;
}
