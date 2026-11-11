import fs from 'fs';
const [,, wasmP, inP, outP, setP] = process.argv;
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmP), { wasi_snapshot_preview1: { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0 } });
const x = instance.exports; x._initialize(); x.hem_init(48000);
const inp = new Float32Array(fs.readFileSync(inP).buffer.slice(0)); const n = inp.length / 2, out = new Float32Array(inp.length);
const cmds = fs.readFileSync(setP, 'utf8').trim().split('\n').map(l => l.trim().split(/\s+/)).map(([t, k, id, v]) => ({ t: +t, k, id: +id, v: +v }));
let ci = 0;
for (let p = 0; p < n; p += 128) {
  while (ci < cmds.length && cmds[ci].t * 48000 <= p) { const c = cmds[ci++]; if (c.k === 's') x.hem_surgeon_set(c.id, c.v); else x.hem_set(c.id, c.v); }
  const m = Math.min(128, n - p), L = new Float32Array(x.memory.buffer, x.hem_left(), 128), R = new Float32Array(x.memory.buffer, x.hem_right(), 128);
  for (let i = 0; i < m; i++) { L[i] = inp[2 * (p + i)]; R[i] = inp[2 * (p + i) + 1]; }
  x.hem_process(m);
  for (let i = 0; i < m; i++) { out[2 * (p + i)] = L[i]; out[2 * (p + i) + 1] = R[i]; }
}
fs.writeFileSync(outP, Buffer.from(out.buffer));
