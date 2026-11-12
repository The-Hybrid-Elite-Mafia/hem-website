"""Turns a folder of songs into HEM RADIO's station: MP3s + station/station.json.

usage: python3 make_station.py SONG_FOLDER OUT_FOLDER [--kbps 160] [--shuffle SEED]

- Every song becomes an MP3 (stereo, 44.1 kHz, KBPS kbit/s) named song-NNN.mp3, so odd characters in file
  names can never break a web link. The title shown on the radio is the original file name without its extension.
- station.json holds each song's file, title and exact length (read back from the MP3 itself), plus "epoch":
  the moment the station's first loop began. Every listener's radio works out from the clock which song is
  on air and how far into it, so everyone hears the same thing.
- The song order is the folder's alphabetical order, or a fixed shuffle when --shuffle SEED is given.
"""
import argparse, json, pathlib, random, subprocess, sys, time

AUDIO = {'.wav', '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.aif', '.aiff'}
ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--kbps', type=int, default=160)
ap.add_argument('--shuffle', type=int, default=None)
ap.add_argument('--epoch', type=int, default=None, help='keep an earlier station start time (seconds since 1970)')
a = ap.parse_args()
src, out = pathlib.Path(a.src), pathlib.Path(a.out)
files = sorted((f for f in src.iterdir() if f.is_file() and f.suffix.lower() in AUDIO), key=lambda f: f.name.lower())
if not files: sys.exit(f'no songs in {src}')
if a.shuffle is not None: random.Random(a.shuffle).shuffle(files)
out.mkdir(parents=True, exist_ok=True)
for old in out.glob('song-*.mp3'): old.unlink()
songs, total_mb = [], 0.0
for k, f in enumerate(files, 1):
    name = f'song-{k:03d}.mp3'
    dst = out / name
    r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(f), '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame',
                        '-b:a', f'{a.kbps}k', '-map_metadata', '-1', str(dst)], capture_output=True, text=True)
    if r.returncode or not dst.exists():
        print(f'SKIPPED (could not convert): {f.name}: {r.stderr.strip()[:200]}'); continue
    p = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(dst)], capture_output=True, text=True)
    dur = float(p.stdout.strip() or 0)
    if dur <= 1:
        print(f'SKIPPED (too short or unreadable): {f.name}'); dst.unlink(); continue
    mb = dst.stat().st_size / 1e6; total_mb += mb
    songs.append({'file': name, 'title': f.stem, 'dur': round(dur, 3)})
    print(f'{name}  {dur:7.1f} s  {mb:5.1f} MB  {f.name}')
epoch = a.epoch if a.epoch is not None else int(time.time())
(out / 'station.json').write_text(json.dumps({'epoch': epoch, 'songs': songs}, indent=1))
hours = sum(s['dur'] for s in songs) / 3600
print(f'{len(songs)} songs, {hours:.2f} hours a loop, {total_mb:.0f} MB of MP3s, epoch {epoch}')
