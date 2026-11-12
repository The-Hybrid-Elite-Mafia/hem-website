#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <vector>
#include <algorithm>
extern "C" { int hem_init(double); char* hem_name(); int hem_load(); float* hem_left(); float* hem_right(); void hem_process(int); void hem_set_norm(int, float); void hem_on(int); }
int main(int argc, char** argv) {   // NAME IN OUT SECONDS_PER_CHANGE
  FILE* f = std::fopen(argv[2], "rb"); std::vector<float> in; float b[2];
  while (std::fread(b, 4, 2, f) == 2) { in.push_back(b[0]); in.push_back(b[1]); } std::fclose(f);
  hem_init(48000); std::strcpy(hem_name(), argv[1]); int np = hem_load(); if (np < 0) { std::printf("NOT AVAILABLE %s\n", argv[1]); return 2; }
  std::uint32_t seed = 12345; auto rnd = [&] { seed = seed * 1664525u + 1013904223u; return seed >> 8; };
  std::size_t step = (std::size_t)(std::atof(argv[4]) * 48000 + 0.5), change = 0;
  std::vector<float> out(in.size()); std::size_t n = in.size() / 2;
  for (std::size_t p = 0; p < n; p += 128) {
    if (p >= change) { for (int i = 0; i < np; ++i) hem_set_norm(i, (float)(rnd() % 1001) / 1000.0f); hem_on(rnd() % 4 != 0 ? 1 : 0); change += step; }
    int m = (int)std::min<std::size_t>(128, n - p);
    for (int i = 0; i < m; ++i) { hem_left()[i] = in[2*(p+i)]; hem_right()[i] = in[2*(p+i)+1]; }
    hem_process(m);
    for (int i = 0; i < m; ++i) { out[2*(p+i)] = hem_left()[i]; out[2*(p+i)+1] = hem_right()[i]; }
  }
  f = std::fopen(argv[3], "wb"); std::fwrite(out.data(), 4, out.size(), f); std::fclose(f);
}
