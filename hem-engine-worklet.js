// HEM web engine on the browser's audio thread: runs hem-engine.wasm (SURGEON + faders + volume,
// compiled from C++23) on every 128-sample block. Settings arrive as messages and are applied before
// the next block; the engine itself never allocates while playing.
class HemEngineProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ready = false;
    this.pending = [];
    this.tick = 0;
    this.readouts = new Float32Array(17);   // 16 dynamic band moves + auto gain, in dB
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
      this.port.postMessage({ t: 'ready', latency: x.hem_surgeon_latency(), rate: sampleRate });
    }, err => this.port.postMessage({ t: 'error', message: String(err) }));
  }
  apply(m) {
    const x = this.x;
    if (m.t === 's') x.hem_surgeon_set(m.i, m.v);
    else if (m.t === 'f') x.hem_fader_set(m.i, m.v);
    else if (m.t === 'v') x.hem_volume_set(m.v);
    else if (m.t === 'reset') x.hem_reset();
  }
  views() {
    const mem = this.x.memory.buffer;
    if (this.mem !== mem) {
      this.mem = mem;
      this.L = new Float32Array(mem, this.x.hem_left(), 4096);
      this.R = new Float32Array(mem, this.x.hem_right(), 4096);
    }
  }
  process(inputs, outputs) {
    const out = outputs[0];
    if (!this.ready) { for (const ch of out) ch.fill(0); return true; }
    this.views();
    const n = out[0].length, inp = inputs[0];
    if (inp && inp.length) {
      this.L.set(inp[0]);
      this.R.set(inp[1] || inp[0]);
    } else {
      this.L.fill(0, 0, n);
      this.R.fill(0, 0, n);
    }
    this.x.hem_process(n);
    out[0].set(this.L.subarray(0, n));
    if (out[1]) out[1].set(this.R.subarray(0, n));
    if (++this.tick >= 16) {   // about every 43 ms: what SURGEON's dynamic bands and auto gain are doing
      this.tick = 0;
      for (let b = 0; b < 16; b++) this.readouts[b] = this.x.hem_dyn_gain(b);
      this.readouts[16] = this.x.hem_auto_gain();
      this.port.postMessage(this.readouts);
    }
    return true;
  }
}
registerProcessor('hem-engine', HemEngineProcessor);
