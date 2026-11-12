// Saves the plug-in faceplate's knob and icon pictures, made by The Hybrid Core's own Parts code (premultiplied sRGB RGBA).
#include "hybrid/ui/Parts.hpp"
#include <cstdio>
#include <string>
using namespace hc::ui;
int main() {
  Image fp; fp.width = 3840; fp.height = 2160; fp.rgba.assign(3840ull * 2160 * 4, 40);
  for (std::size_t i = 3; i < fp.rgba.size(); i += 4) fp.rgba[i] = 255;
  PartsAtlas a = buildPartsAtlas(fp);
  const char* names[] = {"Socket","KnobShadow","KnobTrack","KnobBody","KnobIndicator","KnobLight","CapDark","RingGlow","FaderCap","FaderShadow","FaderLine","ButtonCap","ButtonShadow","ButtonLens","ButtonHalo","Glass","GlassSheen","GlassRim","InnerShadow","DropShadow","LedSegment","GlowDot","Lamp","IconPrev","IconNext"};
  const auto& L0 = a.texture.levels[0]; const unsigned W = a.texture.width, Hh = a.texture.height;
  for (int s = 0; s < 25; ++s) {
    const SpriteInfo& si = a.sprites[s];
    const unsigned x0 = (unsigned)(si.u0 * W + 0.5f), y0 = (unsigned)(si.v0 * Hh + 0.5f), w = (unsigned)si.width, h = (unsigned)si.height;
    std::string fn = std::string("sprites/") + names[s] + "_" + std::to_string(w) + "x" + std::to_string(h) + ".rgba";
    FILE* f = std::fopen(fn.c_str(), "wb");
    for (unsigned y = 0; y < h; ++y) std::fwrite(&L0[((std::size_t)(y0 + y) * W + x0) * 4], 4, w, f);
    std::fclose(f);
  }
  std::printf("atlas %ux%u\n", W, Hh);
}
