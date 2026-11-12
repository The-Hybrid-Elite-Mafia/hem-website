// node runner.mjs WASM NAME IN OUT SECONDS_PER_CHANGE  — the same settings script as native_run.cpp
import fs from 'fs';
const [,, wasmP, name, inP, outP, every] = process.argv;
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmP), { wasi_snapshot_preview1: { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0, fd_fdstat_get: () => 0, environ_get: () => 0, environ_sizes_get: () => 0, proc_exit: () => 0 } });
const x = instance.exports; x._initialize(); x.hem_init(48000);
new Uint8Array(x.memory.buffer, x.hem_name(), name.length + 1).set([...Buffer.from(name), 0]);
const np = x.hem_load(); if (np < 0) { console.log('NOT AVAILABLE', name); process.exit(2); }
const inp = new Float32Array(fs.readFileSync(inP).buffer.slice(0)); const n = inp.length / 2, out = new Float32Array(inp.length);
let seed = 12345 >>> 0; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 8; };
const step = Math.round(Number(every) * 48000); let change = 0;
for (let p = 0; p < n; p += 128) {
  if (p >= change) {   // every few seconds: every control to a new place (k / 1000 of its range), ON/OFF too
    for (let i = 0; i < np; i++) x.hem_set_norm(i, (rnd() % 1001) / 1000);
    x.hem_on(rnd() % 4 !== 0 ? 1 : 0); change += step;
  }
  const m = Math.min(128, n - p), L = new Float32Array(x.memory.buffer, x.hem_left(), 128), R = new Float32Array(x.memory.buffer, x.hem_right(), 128);
  for (let i = 0; i < m; i++) { L[i] = inp[2 * (p + i)]; R[i] = inp[2 * (p + i) + 1]; }
  x.hem_process(m);
  const L2 = new Float32Array(x.memory.buffer, x.hem_left(), 128), R2 = new Float32Array(x.memory.buffer, x.hem_right(), 128);
  for (let i = 0; i < m; i++) { out[2 * (p + i)] = L2[i]; out[2 * (p + i) + 1] = R2[i]; }
}
fs.writeFileSync(outP, Buffer.from(out.buffer));
