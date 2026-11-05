// Web side of the web-vs-native proof: the same settings script + input through hem-engine.wasm,
// 128 samples at a time, exactly the way the browser's audio thread will call it.
import fs from 'fs';
const [, , wasmPath, settingsPath, inPath, outPath] = process.argv;
const stub = { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0 };
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { wasi_snapshot_preview1: stub });
const e = instance.exports;
e._initialize();
e.hem_init(48000);
for (const line of fs.readFileSync(settingsPath, 'utf8').trim().split('\n')) {
  const [k, a, b] = line.trim().split(/\s+/);
  if (k === 's') e.hem_surgeon_set(+a, +b);
  if (k === 'f') e.hem_fader_set(+a, +b);
  if (k === 'v') e.hem_volume_set(+a);
}
const buf = fs.readFileSync(inPath);
const io = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const frames = io.length / 2;
for (let pos = 0; pos < frames; pos += 128) {
  const n = Math.min(128, frames - pos);
  const L = new Float32Array(e.memory.buffer, e.hem_left(), n), R = new Float32Array(e.memory.buffer, e.hem_right(), n);
  for (let i = 0; i < n; i++) { L[i] = io[2 * (pos + i)]; R[i] = io[2 * (pos + i) + 1]; }
  e.hem_process(n);
  const L2 = new Float32Array(e.memory.buffer, e.hem_left(), n), R2 = new Float32Array(e.memory.buffer, e.hem_right(), n);
  for (let i = 0; i < n; i++) { io[2 * (pos + i)] = L2[i]; io[2 * (pos + i) + 1] = R2[i]; }
}
fs.writeFileSync(outPath, Buffer.from(io.buffer));
