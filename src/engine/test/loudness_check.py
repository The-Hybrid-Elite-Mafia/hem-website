"""Checks the web engine's loudness meter (THE ACCOUNTANT inside hem-engine.wasm):
  * EBU Tech 3341 test signals (stereo 1 kHz sine at -23 and -33 dBFS: must read -23.0 / -33.0 LUFS +-0.1)
  * an independent BS.1770 meter (pyloudnorm) on a 30 s music-like test signal
  * true peak of a sine with a known level
Everything is generated here; no songs are used."""
import json, pathlib, subprocess, numpy as np, pyloudnorm

HERE = pathlib.Path(__file__).parent
FS = 48000

RUNNER = r"""
import fs from 'fs';
const [, , wasmPath, inPath] = process.argv;
const stub = { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0 };
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { wasi_snapshot_preview1: stub });
const e = instance.exports; e._initialize(); e.hem_init(48000);
const buf = fs.readFileSync(inPath); const io = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const frames = io.length / 2;
for (let pos = 0; pos < frames; pos += 128) {
  const n = Math.min(128, frames - pos);
  const L = new Float32Array(e.memory.buffer, e.hem_left(), n), R = new Float32Array(e.memory.buffer, e.hem_right(), n);
  for (let i = 0; i < n; i++) { L[i] = io[2 * (pos + i)]; R[i] = io[2 * (pos + i) + 1]; }
  e.hem_process(n);
}
console.log(JSON.stringify([0, 1, 2, 3, 4].map(i => e.hem_loudness(i))));
"""
(HERE / '_lufs_run.mjs').write_text(RUNNER)

def run(x):
    (HERE / '_lufs_in.f32').write_bytes(np.asarray(x, np.float32).tobytes())
    out = subprocess.run(['node', str(HERE / '_lufs_run.mjs'), str(HERE.parent / 'hem-engine.wasm'), str(HERE / '_lufs_in.f32')], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)

t = np.arange(FS * 20) / FS
rows = []
for dbfs in (-23.0, -33.0):
    s = 10 ** (dbfs / 20) * np.sin(2 * np.pi * 1000 * t)
    m = run(np.stack([s, s], 1))
    rows.append((f'EBU 3341: stereo 1 kHz at {dbfs:.0f} dBFS, 20 s', dbfs, m[2], m[1], m[0]))
for name, exp, i, st, mo in rows:
    print(f'{name}: integrated {i:.2f}, short-term {st:.2f}, momentary {mo:.2f} LUFS (should be {exp:.1f} +-0.1) -> {"PASS" if abs(i - exp) <= 0.1 and abs(st - exp) <= 0.1 and abs(mo - exp) <= 0.1 else "FAIL"}')

# music-like: pink-ish noise with a beat and a quiet break, 30 s
rng = np.random.default_rng(11)
n = FS * 30
white = rng.standard_normal((n, 2))
spec = np.fft.rfft(white, axis=0); f = np.fft.rfftfreq(n, 1 / FS); f[0] = 1
pink = np.fft.irfft(spec / np.sqrt(f)[:, None], n=n, axis=0)
pink /= np.max(np.abs(pink))
tt = np.arange(n) / FS
beat = 0.6 + 0.4 * (np.sin(2 * np.pi * 2 * tt) > 0.7)
env = np.where((tt > 12) & (tt < 16), 0.08, 1.0)
x = (0.35 * pink * (beat * env)[:, None]).astype(np.float32)
m = run(x)
ref = pyloudnorm.Meter(FS).integrated_loudness(x.astype(np.float64))
print(f'music-like 30 s signal: HEM integrated {m[2]:.2f} LUFS, pyloudnorm {ref:.2f} LUFS, difference {m[2] - ref:+.2f} LU; loudness range {m[3]:.1f} LU')

# true peak: 997 Hz sine at 0.5 -> -6.02 dBTP
s = 0.5 * np.sin(2 * np.pi * 997 * t[:FS * 5])
m = run(np.stack([s, s], 1))
print(f'true peak of a 997 Hz sine at -6.02 dBFS: {m[4]:.2f} dBTP (difference {m[4] + 6.0206:+.2f} dB)')
for f_ in ('_lufs_run.mjs', '_lufs_in.f32'): (HERE / f_).unlink()
