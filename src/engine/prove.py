"""Measures every control of engine 2 and checks the web build sounds the same as the native build."""
import numpy as np, subprocess, os, soundfile as sf
FS = 48000
E = dict(BeqOn=0, BeqLow=1, BeqMid=2, BeqHigh=3, LevOn=4, LevTarget=5, LevRange=6, LevSpeed=7, BassOn=8, BassDrive=9, BassFreq=10, BassGain=11,
         MonOn=12, Crossfeed=13, Width=14, Output=15, TrimL=16, TrimR=17, Volume=18, Mute=19, StOn=20)
def run(x, cmds, web=False, lev=False):
    cmds = ([] if lev else [(0, 'e', 4, 0)]) + list(cmds)
    x.astype(np.float32).tofile('t_in.f32')
    open('t_set.txt', 'w').write('\n'.join(f'{t} {k} {i} {v}' for t, k, i, v in cmds) + '\n' if cmds else '0 e 18 0\n')
    if web: subprocess.run(['node', 'wasm_run.mjs', 'hem-engine2.wasm', 't_in.f32', 't_out.f32', 't_set.txt'], check=True)
    else: subprocess.run(['./native_run', 't_in.f32', 't_out.f32', 't_set.txt'], check=True)
    return np.fromfile('t_out.f32', np.float32).reshape(-1, 2)
def tone(hz, db=-20, sec=2.0, side='both'):
    t = np.arange(int(sec * FS)) / FS; s = 10 ** (db / 20) * np.sin(2 * np.pi * hz * t)
    z = np.zeros_like(s)
    return np.stack([s, s if side == 'both' else z], 1)
def lvl(y, ch=0, skip=0.5):
    y = y[int(skip * FS):, ch]; return 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-15)
def gain(hz, cmds, db=-20, ch=0, side='both'):
    x = tone(hz, db, side=side); return lvl(run(x, cmds), ch) - lvl(x, 0)
def harm(y, f0, k):
    y = y[FS:, 0]; w = np.hanning(len(y)); sp = np.abs(np.fft.rfft(y * w)); fr = np.fft.rfftfreq(len(y), 1 / FS)
    a = lambda f: sp[np.argmin(np.abs(fr - f))]
    return 20 * np.log10(a(k * f0) / a(f0) + 1e-15)
S = lambda b, c, v: (0, 's', b * 12 + c, v)
e = lambda name, v: (0, 'e', E[name], v)
R = []
def rep(label, val, unit='dB', want=None):
    R.append((label, val, unit, want)); print(f'{label:58s} {val:+8.2f} {unit}' + (f'   (want {want})' if want else ''))
rep('Nothing turned: 1 kHz tone', gain(1000, []), want='0.00')
for b, hz in enumerate([31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]):
    rep(f'STATION EQ band {b + 1} ({hz} Hz) +6 dB, tone {hz} Hz', gain(hz, [(0, 'e', 21 + b, 6)]), want='+6.00')
rep('STATION EQ 1 kHz +6 dB, tone 4 kHz (two bands away)', gain(4000, [(0, 'e', 26, 6)]), want='close to 0')
rep('STATION EQ 1 kHz -10 dB but STATION EQ off', gain(1000, [(0, 'e', 26, -10), (0, 'e', 20, 0)]), want='0.00')
rep('BROADCAST EQ LOW +6, tone 30 Hz', gain(30, [e('BeqLow', 6)]), want='about +6')
rep('BROADCAST EQ MID +6, tone 1 kHz', gain(1000, [e('BeqMid', 6)]), want='+6.00')
rep('BROADCAST EQ HIGH -6, tone 18 kHz', gain(18000, [e('BeqHigh', -6)]), want='about -6')
rep('BROADCAST EQ MID +6 but BROADCAST EQ off', gain(1000, [e('BeqMid', 6), e('BeqOn', 0)]), want='0.00')
rep('BASS BOOST GAIN +6 at 80 Hz, tone 30 Hz', gain(30, [e('BassGain', 6), e('BassFreq', 80)]), want='about +6')
rep('BASS BOOST GAIN +6 at 80 Hz, tone 2 kHz (untouched)', gain(2000, [e('BassGain', 6), e('BassFreq', 80)]), want='0.00')
x = tone(60, -20, 3.0)
for d in (0, 50, 100):
    y = run(x, [e('BassDrive', d), e('BassFreq', 120)])
    rep(f'BASS BOOST DRIVE {d} %, 60 Hz tone: 3rd harmonic vs tone', harm(y, 60, 3), 'dB')
    rep(f'BASS BOOST DRIVE {d} %, 60 Hz tone at -20 dBFS: level change', lvl(y) - lvl(x))
x = tone(5000, -20, 3.0); y = run(x, [e('BassDrive', 100), e('BassFreq', 120)]); rep('BASS BOOST DRIVE 100 %, 5 kHz tone (lows only)', lvl(y) - lvl(x), want='0.00')
# leveler on a loud song section
D = '/mnt/user-data/uploads/Desktop/suno exports/Live the Middle/'
mix = sf.read(D + '0 Live the Middle.wav', dtype='float32', start=60 * FS, stop=80 * FS)[0]
# AUTO-LEVELER (on by itself): the same song played loud, normal, quiet and very quiet should all come out about the same
import scipy.signal as ss
def lufs(y):   # BS.1770 integrated loudness with the standard 48 kHz K-weighting filters and gating
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    k = ss.lfilter(b2, a2, ss.lfilter(b1, a1, y, axis=0), axis=0)
    blk = int(0.4 * FS); hop = int(0.1 * FS)
    z = np.array([np.mean(k[i:i + blk] ** 2, axis=0).sum() for i in range(0, len(k) - blk, hop)])
    l = -0.691 + 10 * np.log10(z + 1e-20); z = z[l > -70]
    if not len(z): return -100
    rel = -0.691 + 10 * np.log10(z.mean()) - 10; z2 = z[-0.691 + 10 * np.log10(z) > rel]
    return -0.691 + 10 * np.log10(z2.mean())
def tpk(y):
    return 20 * np.log10(np.abs(ss.resample_poly(y, 4, 1, axis=0)).max() + 1e-15)
song = sf.read(D + '0 Live the Middle.wav', dtype='float32', start=40 * FS, stop=100 * FS)[0]
print(f"  the song itself: {lufs(song):.1f} LUFS")
for g in (6, 0, -12, -24):
    x = song * 10 ** (g / 20)
    y = run(x, [], lev=True)
    rep(f'AUTO-LEVELER, song played at {g:+d} dB ({lufs(x):.1f} LUFS in): out', lufs(y[15 * FS:]), 'LUFS', 'about -14')
    rep(f'  ...true peak out', tpk(y[15 * FS:]), 'dBTP', 'at most -1')
y = run(song, [(0, 'e', E['LevTarget'], -18)], lev=True)
rep('AUTO-LEVELER TARGET -18, song as it is: out', lufs(y[15 * FS:]), 'LUFS', 'about -18')
y = run(song * 10 ** (-20 / 20), [(0, 'e', E['LevRange'], 6)], lev=True)
rep('AUTO-LEVELER RANGE 6 dB, song at -20 dB: change', lufs(y[15 * FS:]) - lufs(song[15 * FS:] * 10 ** (-20 / 20)), 'dB', 'at most +6')
# silence after the song must not be boosted
quiet = np.concatenate([song[:20 * FS] * 10 ** (-6 / 20), np.random.default_rng(1).normal(0, 10 ** (-70 / 20), (20 * FS, 2)).astype(np.float32)])
y = run(quiet, [], lev=True)
gain_song = lufs(y[10 * FS:20 * FS]) - lufs(quiet[10 * FS:20 * FS])
rep('AUTO-LEVELER: gain on the song (needs about +8.4)', gain_song, 'dB')
rep('AUTO-LEVELER: gain on the -70 dBFS hiss after it', 20 * np.log10(np.sqrt(np.mean(y[-10 * FS:] ** 2)) / np.sqrt(np.mean(quiet[-10 * FS:] ** 2))), 'dB', 'no more than the song had')
mix = song[20 * FS:40 * FS]
# monitoring
rep('CROSSFEED 0 %: left-only 300 Hz tone, right side', gain(300, [], side='left', ch=1) if False else lvl(run(tone(300, -20, side='left'), []), 1), 'dBFS', '-inf (silence)')
rep('CROSSFEED 100 %: left-only 300 Hz tone, right side', lvl(run(tone(300, -20, side='left'), [e('Crossfeed', 100)]), 1), 'dBFS')
rep('CROSSFEED 100 %: left-only 8 kHz tone, right side (darker)', lvl(run(tone(8000, -20, side='left'), [e('Crossfeed', 100)]), 1), 'dBFS')
xl = tone(300, -20, side='left')
rep('WIDTH 0 % (mono): left-only tone, right side', lvl(run(xl, [e('Width', 0)]), 1) - lvl(xl, 0), want='-6.02 (half on each side)')
rep('WIDTH 200 %: left-only tone, left side', lvl(run(xl, [e('Width', 200)]), 0) - lvl(xl, 0), want='+3.52 (1.5x)')
rep('OUTPUT LEVEL -6, tone 1 kHz', gain(1000, [e('Output', -6)]), want='-6.00')
rep('TRIM L -3: left side', gain(1000, [e('TrimL', -3)], ch=0), want='-3.00')
rep('TRIM L -3: right side', gain(1000, [e('TrimL', -3)], ch=1), want='0.00')
rep('VOLUME -10, tone 1 kHz', gain(1000, [e('Volume', -10)]), want='-10.00')
rep('MUTE', lvl(run(tone(1000), [e('Mute', 1)])), 'dBFS', 'silence')
# web build = native build, busy settings on the song
busy = [(0, 'e', 22, 4), (0, 'e', 27, -3), e('BeqLow', 3), e('BeqHigh', 2), e('BassGain', 4), e('BassDrive', 60), e('LevOn', 1), e('LevTarget', -16), e('Crossfeed', 40), e('Width', 130), e('Output', -2), e('TrimR', -1), (5, 'e', E['BeqMid'], -4), (9, 'e', E['BassFreq'], 150), (12, 'e', E['Volume'], -6)]
a = run(mix, busy, lev=True); b = run(mix, busy, web=True, lev=True)
d = np.abs(a - b).max(); rep('WEB vs NATIVE on the song, busy settings: biggest sample difference', d, '')
rep('WEB vs NATIVE: difference below the music', lvl(a, skip=0) - 20 * np.log10(np.sqrt(np.mean((a - b) ** 2)) + 1e-20), 'dB')
