// Native side of the web-vs-native proof: runs a settings script + input through engine.cpp.
// usage: native_run settings.txt input.f32 output.f32   (interleaved stereo float32, 48 kHz)
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

extern "C" {
int hem_init(double);
float* hem_left();
float* hem_right();
void hem_surgeon_set(int, float);
void hem_fader_set(int, float);
void hem_volume_set(float);
void hem_process(std::uint32_t);
}

int main(int argc, char** argv) {
    if (argc != 4) return 2;
    hem_init(48000.0);
    std::ifstream st(argv[1]);
    std::string kind;
    while (st >> kind) {
        if (kind == "s") { int i; float v; st >> i >> v; hem_surgeon_set(i, v); }
        else if (kind == "f") { int b; float v; st >> b >> v; hem_fader_set(b, v); }
        else if (kind == "v") { float v; st >> v; hem_volume_set(v); }
    }
    std::ifstream in(argv[2], std::ios::binary);
    std::vector<float> x((std::istreambuf_iterator<char>(in)), {});
    in.close();
    std::ifstream in2(argv[2], std::ios::binary);
    in2.seekg(0, std::ios::end);
    const auto bytes = static_cast<std::size_t>(in2.tellg());
    in2.seekg(0);
    std::vector<float> io(bytes / sizeof(float));
    in2.read(reinterpret_cast<char*>(io.data()), static_cast<std::streamsize>(bytes));
    const std::size_t frames = io.size() / 2;
    for (std::size_t pos = 0; pos < frames; pos += 128) {
        const std::uint32_t n = static_cast<std::uint32_t>(std::min<std::size_t>(128, frames - pos));
        float* L = hem_left();
        float* R = hem_right();
        for (std::uint32_t i = 0; i < n; ++i) { L[i] = io[2 * (pos + i)]; R[i] = io[2 * (pos + i) + 1]; }
        hem_process(n);
        for (std::uint32_t i = 0; i < n; ++i) { io[2 * (pos + i)] = L[i]; io[2 * (pos + i) + 1] = R[i]; }
    }
    std::ofstream out(argv[3], std::ios::binary);
    out.write(reinterpret_cast<const char*>(io.data()), static_cast<std::streamsize>(io.size() * sizeof(float)));
    return 0;
}
