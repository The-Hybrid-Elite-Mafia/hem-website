// HEM web engine 2 on the browser's audio thread: runs hem-engine2.wasm (AUTO-LEVELER, BROADCAST EQ, BASS BOOST,
// MONITORING, HEM LOCKDOWN limiter, loudness meter, volume; all C++23) on every 128-sample block.
// Settings arrive as messages and are applied before the next block; the engine never allocates while playing.
class HemEngine2Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ready = false;
    this.pending = [];
    this.tick = 0;
    this.port.onmessage = e => { if (this.ready) this.apply(e.data); else this.pending.push(e.data); };
    const stub = { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0 };
    WebAssembly.instantiate(options.processorOptions.wasm, { wasi_snapshot_preview1: stub }).then(({ instance }) => {
      const x = instance.exports;
      x._initialize();
      x.hem_init(sampleRate);
      this.x = x;
      for (const m of this.pending) this.apply(m);
      this.pending = [];
      this.ready = true;
      this.port.postMessage({ t: 'ready', rate: sampleRate });
    }, err => this.port.postMessage({ t: 'error', message: String(err) }));
  }
  apply(m) {
    const x = this.x;
    if (m.t === 's') x.hem_surgeon_set(m.i, m.v);
    else if (m.t === 'e') x.hem_set(m.i, m.v);
    else if (m.t === 'reset') x.hem_reset();
    else if (m.t === 'lt') x.hem_loudness_target(m.v);
    else if (m.t === 'lr') x.hem_loudness_reset();
    else if (m.t === 'nr') x.hem_level_reset();
  }
  process(inputs, outputs) {
    const out = outputs[0];
    if (!this.ready) { for (const ch of out) ch.fill(0); return true; }
    const mem = this.x.memory.buffer;
    if (this.mem !== mem) {
      this.mem = mem;
      this.L = new Float32Array(mem, this.x.hem_left(), 128);
      this.R = new Float32Array(mem, this.x.hem_right(), 128);
    }
    const n = out[0].length, inp = inputs[0];
    if (inp && inp.length) { this.L.set(inp[0]); this.R.set(inp[1] || inp[0]); }
    else { this.L.fill(0, 0, n); this.R.fill(0, 0, n); }
    this.x.hem_process(n);
    out[0].set(this.L.subarray(0, n));
    if (out[1]) out[1].set(this.R.subarray(0, n));
    if (++this.tick >= 8) {   // about every 21 ms
      this.tick = 0;
      // 0-15 SURGEON dynamic band moves, 16 auto gain (dB); 17-23 loudness; 24-27 peak L/R, RMS L/R; 28 AUTO-LEVELER gain (dB);
      // 29 HEM LOCKDOWN gain reduction (dB)
      const r = new Float32Array(30);
      for (let b = 0; b < 16; b++) r[b] = this.x.hem_dyn_gain(b);
      r[16] = this.x.hem_auto_gain();
      for (let k = 0; k < 7; k++) r[17 + k] = this.x.hem_loudness(k);
      for (let k = 0; k < 6; k++) r[24 + k] = this.x.hem_meter(k);
      this.x.hem_meter_clear();
      this.port.postMessage(r, [r.buffer]);
    }
    return true;
  }
}
registerProcessor('hem-engine2', HemEngine2Processor);
