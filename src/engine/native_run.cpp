// Runs engine2 on a stereo f32 file with a script of settings: lines "<second> <kind> <id> <value>", kind = e (engine) or s (SURGEON).
#include <cstdio>
#include <cstdint>
#include <vector>
#include <algorithm>
extern "C" { int hem_init(double); float* hem_left(); float* hem_right(); void hem_process(std::uint32_t); void hem_set(int, float); void hem_surgeon_set(int, float); }
struct Cmd { double t; char k; int id; float v; };
int main(int argc, char** argv) {
  FILE* f = std::fopen(argv[1], "rb"); std::vector<float> in; float b[2];
  while (std::fread(b, 4, 2, f) == 2) { in.push_back(b[0]); in.push_back(b[1]); } std::fclose(f);
  std::vector<Cmd> cmds; FILE* s = std::fopen(argv[3], "r"); Cmd c; while (std::fscanf(s, "%lf %c %d %f", &c.t, &c.k, &c.id, &c.v) == 4) cmds.push_back(c); std::fclose(s);
  hem_init(48000);
  std::size_t n = in.size() / 2, ci = 0; std::vector<float> out(in.size());
  for (std::size_t p = 0; p < n; p += 128) {
    while (ci < cmds.size() && cmds[ci].t * 48000 <= p) { if (cmds[ci].k == 's') hem_surgeon_set(cmds[ci].id, cmds[ci].v); else hem_set(cmds[ci].id, cmds[ci].v); ++ci; }
    std::uint32_t m = (std::uint32_t)std::min<std::size_t>(128, n - p);
    for (std::uint32_t i = 0; i < m; ++i) { hem_left()[i] = in[2*(p+i)]; hem_right()[i] = in[2*(p+i)+1]; }
    hem_process(m);
    for (std::uint32_t i = 0; i < m; ++i) { out[2*(p+i)] = hem_left()[i]; out[2*(p+i)+1] = hem_right()[i]; }
  }
  f = std::fopen(argv[2], "wb"); std::fwrite(out.data(), 4, out.size(), f); std::fclose(f);
}
