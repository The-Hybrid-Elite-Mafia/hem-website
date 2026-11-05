"""Proof that the website's sound engine = the native C++ engine.

Builds a 4-second test signal (noise + tones + a loud burst so dynamic bands move), runs three
settings scripts through both builds, and measures the difference in dB below the signal.
"""
import pathlib, subprocess, numpy as np

HERE = pathlib.Path(__file__).parent
FS = 48000
rng = np.random.default_rng(7)
t = np.arange(FS * 4) / FS
env = np.where((t > 1.5) & (t < 2.2), 1.0, 0.25)
L = 0.18 * rng.standard_normal(t.size) * env + 0.2 * np.sin(2 * np.pi * 110 * t) + 0.1 * np.sin(2 * np.pi * 3000 * t) * env
R = 0.18 * rng.standard_normal(t.size) * env + 0.2 * np.sin(2 * np.pi * 220 * t) + 0.08 * np.sin(2 * np.pi * 7000 * t)
x = np.stack([L, R], 1).astype(np.float32)
(HERE / 'in.f32').write_bytes(x.tobytes())

def bp(b, c): return b * 12 + c
OUTPUT, AUTOGAIN, CHARACTER, DRIVE = 192, 193, 194, 195
cases = {
  'busy master (cut, bell, shelf, dynamic, tube, drive, auto gain, faders, volume)': [
    ('s', bp(0, 0), 1), ('s', bp(0, 1), 3), ('s', bp(0, 2), 30), ('s', bp(0, 5), 3),
    ('s', bp(3, 0), 1), ('s', bp(3, 2), 250), ('s', bp(3, 3), 4), ('s', bp(3, 4), 1),
    ('s', bp(8, 0), 1), ('s', bp(8, 1), 2), ('s', bp(8, 2), 8000), ('s', bp(8, 3), -3),
    ('s', bp(5, 0), 1), ('s', bp(5, 2), 3000), ('s', bp(5, 7), 1), ('s', bp(5, 8), -30), ('s', bp(5, 9), -6),
    ('s', CHARACTER, 2), ('s', DRIVE, 40), ('s', AUTOGAIN, 1), ('s', OUTPUT, -1),
    ('f', 1, 3), ('f', 7, -2), ('v', -3)],
  'notch, tilt, side band, 48 dB/oct high cut, console': [
    ('s', bp(1, 0), 1), ('s', bp(1, 1), 5), ('s', bp(1, 2), 3000), ('s', bp(1, 4), 8),
    ('s', bp(2, 0), 1), ('s', bp(2, 1), 6), ('s', bp(2, 2), 1000), ('s', bp(2, 3), 4),
    ('s', bp(4, 0), 1), ('s', bp(4, 2), 400), ('s', bp(4, 3), -5), ('s', bp(4, 6), 2),
    ('s', bp(6, 0), 1), ('s', bp(6, 1), 4), ('s', bp(6, 2), 12000), ('s', bp(6, 5), 5),
    ('s', CHARACTER, 1)],
  'everything flat (SURGEON defaults)': [],
}
lines = []
for name, settings in cases.items():
    sp = HERE / 'settings.txt'
    sp.write_text('\n'.join(' '.join(map(str, s)) for s in settings) + '\n')
    subprocess.run([str(HERE / 'native_run'), str(sp), str(HERE / 'in.f32'), str(HERE / 'native.f32')], check=True)
    subprocess.run(['node', str(HERE / 'wasm_run.mjs'), str(HERE.parent / 'hem-engine.wasm'), str(sp), str(HERE / 'in.f32'), str(HERE / 'web.f32')], check=True)
    a = np.frombuffer((HERE / 'native.f32').read_bytes(), np.float32).astype(np.float64)
    b = np.frombuffer((HERE / 'web.f32').read_bytes(), np.float32).astype(np.float64)
    diff = a - b
    rms_sig = np.sqrt(np.mean(a ** 2))
    rms_diff = np.sqrt(np.mean(diff ** 2))
    peak = np.max(np.abs(diff))
    below = 20 * np.log10(rms_sig / rms_diff) if rms_diff > 0 else float('inf')
    # level difference between the two builds, in dB (what you would hear as louder/quieter)
    lvl = 20 * np.log10(np.sqrt(np.mean(b ** 2)) / rms_sig)
    lines.append(f'{name}:\n  samples {a.size}, biggest sample difference {peak:.3e}, difference sits {below:.1f} dB below the music, level difference {lvl:+.6f} dB')
print('\n'.join(lines))
