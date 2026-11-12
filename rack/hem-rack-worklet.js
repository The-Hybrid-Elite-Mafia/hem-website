// HEM rack plug-in on the browser's audio thread: one HEM-Elite-Rack engine (every plug-in's real C++, hem-rack.wasm)
// kept for the whole visit, so memory stays the same however many plug-ins a listener tries.
// Trying another plug-in: the sound fades out over one block (2.7 ms), the new plug-in is loaded between blocks (never
// inside process()), and the sound fades back in over the next block, so the change never clicks.
// Messages in:  {t:'load', name, vals:[...], on} pick a plug-in with its settings; {t:'p', i, v} a control's value;
//               {t:'on', v} ON / OFF; {t:'idle'} pass the sound straight through (TRY A PLUG-IN closed); {t:'reset'}.
// Messages out: {t:'ready'} once; {t:'loaded', name, gen, params, latency} after each load; {t:'error', message};
//   about 30 times a second while a plug-in is in, a Float32Array:
//   [0] gain reduction dB, [1..10] the plug-in's own meters, [11] what else it has (1 spectrum, 2 noise floor,
//   4 EQ moves, 8 analyzer), [12] noise taken out dB, [13] AUTO GAIN dB, [14] B spectrum bins, [15] A analyzer bands,
//   [16..31] each EQ band's move dB, [32] which load this is (gen); then spectrum before (B), after (B), noise floor
//   (B, flag 2); then analyzer (flag 8): level L (A), level R, max L, max R, stereo angle, stereo level.
class HemRackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ready = false; this.pending = []; this.tick = 0;
    this.idle = true; this.fade = ''; this.next = null; this.gen = 0;
    this.port.onmessage = e => { if (this.ready) this.apply(e.data); else this.pending.push(e.data); };
    const stub = { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0, fd_fdstat_get: () => 0, environ_get: () => 0, environ_sizes_get: () => 0, proc_exit: () => 0 };
    WebAssembly.instantiate(options.processorOptions.wasm, { wasi_snapshot_preview1: stub }).then(({ instance }) => {
      this.x = instance.exports; this.x._initialize(); this.x.hem_init(sampleRate);
      this.ready = true;
      for (const m of this.pending) this.apply(m);
      this.pending = [];
      this.port.postMessage({ t: 'ready', rate: sampleRate });
    }, err => this.port.postMessage({ t: 'error', message: String(err) }));
  }
  apply(m) {
    const x = this.x;
    if (m.t === 'load') { this.next = m; if (this.idle) this.load(); else this.fade = 'out'; }   // idle: nothing playing through it, load now
    else if (m.t === 'idle') { this.next = null; this.fade = this.idle ? '' : 'toidle'; }
    else if (!this.loaded) return;
    else if (m.t === 'p') x.hem_set(m.i, m.v);
    else if (m.t === 'on') x.hem_on(m.v ? 1 : 0);
    else if (m.t === 'reset') x.hem_reset();
  }
  load() {   // between blocks, never inside process()
    const m = this.next; this.next = null; if (!m) return;
    const x = this.x, bytes = Array.from(m.name, ch => ch.charCodeAt(0) & 0x7f);   // plain ASCII names (no TextEncoder on every audio thread)
    new Uint8Array(x.memory.buffer, x.hem_name(), bytes.length + 1).set([...bytes, 0]);
    const n = x.hem_load();
    if (n < 0) { this.loaded = false; this.idle = true; this.fade = ''; this.port.postMessage({ t: 'error', message: m.name + ' does not run in a browser yet' }); return; }
    (m.vals || []).forEach((v, i) => x.hem_set(i, v));
    x.hem_on(m.on === false ? 0 : 1);
    this.bins = x.hem_has_spectrum(); this.flags = x.hem_feed_flags(); this.na = this.flags & 8 ? x.hem_rta_bands() : 0;
    this.loaded = true; this.idle = false; this.fade = 'in'; this.gen = m.gen || 0; this.mem = null;
    this.port.postMessage({ t: 'loaded', name: m.name, gen: this.gen, params: n, latency: x.hem_latency() });
  }
  process(inputs, outputs) {
    const out = outputs[0], inp = inputs[0], n = out[0].length;
    const pass = () => { for (let c = 0; c < out.length; c++) { if (inp && inp.length) out[c].set(inp[Math.min(c, inp.length - 1)]); else out[c].fill(0); } };
    if (!this.ready || this.idle || this.fade === 'wait') {
      if (this.fade === 'wait') for (const ch of out) ch.fill(0); else pass();
      return true;
    }
    const x = this.x, mem = x.memory.buffer;
    if (this.mem !== mem) { this.mem = mem; this.L = new Float32Array(mem, x.hem_left(), 128); this.R = new Float32Array(mem, x.hem_right(), 128); }
    if (inp && inp.length) { this.L.set(inp[0]); this.R.set(inp[1] || inp[0]); } else { this.L.fill(0, 0, n); this.R.fill(0, 0, n); }
    x.hem_process(n);
    out[0].set(this.L.subarray(0, n)); if (out[1]) out[1].set(this.R.subarray(0, n));
    if (this.fade) {
      const f = this.fade, down = f === 'out' || f === 'toidle';
      for (const ch of out) for (let i = 0; i < n; i++) ch[i] *= down ? 1 - (i + 1) / n : (i + 1) / n;
      if (f === 'in') this.fade = '';
      else if (f === 'toidle') { this.fade = ''; this.idle = true; this.loaded = false; }
      else { this.fade = 'wait'; Promise.resolve().then(() => this.load()); }   // load right after this block
    }
    if (++this.tick >= 12) {   // about every 32 ms
      this.tick = 0;
      const B = this.bins, F = this.flags, A = this.na, NB = F & 2 ? B : 0;
      const r = new Float32Array(33 + 2 * B + NB + 6 * A);
      r[0] = x.hem_reduction();
      for (let k = 0; k < 10; k++) r[1 + k] = x.hem_meter(k);
      r[11] = F; r[12] = x.hem_removed(); r[13] = x.hem_auto_gain(); r[14] = B; r[15] = A;
      if (F & 4) for (let b = 0; b < 16; b++) r[16 + b] = x.hem_dyn_gain(b);
      r[32] = this.gen;
      let o = 33;
      for (let b = 0; b < B; b++) { r[o + b] = x.hem_spec_before(b); r[o + B + b] = x.hem_spec_after(b); }
      o += 2 * B;
      for (let b = 0; b < NB; b++) r[o + b] = x.hem_noise(b);
      o += NB;
      for (let b = 0; b < A; b++) {
        r[o + b] = x.hem_rta(0, b); r[o + A + b] = x.hem_rta(1, b); r[o + 2 * A + b] = x.hem_rta_max(0, b); r[o + 3 * A + b] = x.hem_rta_max(1, b);
        r[o + 4 * A + b] = x.hem_spd_angle(b); r[o + 5 * A + b] = x.hem_spd_level(b);
      }
      this.port.postMessage(r, [r.buffer]);
    }
    return true;
  }
}
registerProcessor('hem-rack', HemRackProcessor);
