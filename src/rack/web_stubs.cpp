// The three plug-ins that need threads (FINGERPRINT, THE MOLD, THE FORGER) are not in the web build:
// their factories give nothing, and hem_load() then reports the plug-in as not available (-1).
#include "hybrid/fx/Fx.hpp"
#include <memory>
namespace hem::rack {
std::unique_ptr<hc::fx::Effect> makeFingerprint() { return nullptr; }
std::unique_ptr<hc::fx::Effect> makeMold() { return nullptr; }
std::unique_ptr<hc::fx::Effect> makeForger() { return nullptr; }
}
