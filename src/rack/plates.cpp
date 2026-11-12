// Saves each plug-in's static faceplate (the plate picture + the real crown and ghost), made by the plug-in's own plate code.
#include "hem/ui/Face.hpp"
#include "hem/rack/Plugins.hpp"
#include <cstdio>
#include <string>
int main(int argc, char** argv) {   // ASSET_DIR WIDTH OUT_DIR NAME...
  std::string err; auto art = hem::ui::BrandArt::load(argv[1], &err); if (!art) { std::printf("brand: %s\n", err.c_str()); return 1; }
  const float ppu = std::stof(argv[2]) / hem::ui::kPlateW;
  for (int k = 4; k < argc; ++k) {
    const auto* info = hem::rack::findPlugin(argv[k]); if (!info) { std::printf("no %s\n", argv[k]); continue; }
    auto L = hem::ui::faceLayout(*info);
    auto pic = hem::ui::loadPlateArt(argv[1], info->name, &err);
    auto img = hem::ui::renderRackPlate(L, *art, ppu, pic ? &*pic : nullptr);
    std::string fn = std::string(argv[3]) + "/" + argv[k] + ".rgba";
    FILE* f = std::fopen(fn.c_str(), "wb"); std::fwrite(img.rgba.data(), 1, img.rgba.size(), f); std::fclose(f);
    std::printf("%s %ux%u\n", argv[k], img.width, img.height);
  }
}
