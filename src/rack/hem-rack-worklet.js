// HEM rack plug-in on the browser's audio thread: runs one HEM-Elite-Rack plug-in (its real C++, hem-rack.wasm) on
// every 128-sample block. The plug-in is picked once, when the node is made (processorOptions.name); trying another
// plug-in makes a new node, so nothing is ever allocated while sound is playing.
// Messages in:  {t:'p', i, v} a control's value (plain), {t:'on', v} ON / OFF, {t:'reset'}, {t:'stop'} (the node is done).
// Messages out: {t:'ready', params, latency, bins} once; then about 30 times a second a Float32Array:
//   [0] gain reduction dB, [1..10] the plug-in's own meters, [11..] spectrum before (bins), then after (bins).
class HemRackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ready = false;
    this.pending = [];
    this.tick = 0;
    this.port.onmessage = e => { if (e.data && e.data.t === 'stop') this.stopped = true; else if (this.ready) this.apply(e.data); else this.pending.push(e.data); };
    const stub = { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0, fd_fdstat_get: () => 0, environ_get: () => 0, environ_sizes_get: () => 0, proc_exit: () => 0 };
    const name = String(options.processorOptions.name || '');
    WebAssembly.instantiate(options.processorOptions.wasm, { wasi_snapshot_preview1: stub }).then(({ instance }) => {
      const x = instance.exports;
      x._initialize();
      x.hem_init(sampleRate);
      const bytes = Array.from(name, ch => ch.charCodeAt(0) & 0x7f);   // plug-in names are plain ASCII (no TextEncoder on the audio thread in every browser)
      new Uint8Array(x.memory.buffer, x.hem_name(), bytes.length + 1).set([...bytes, 0]);
      const params = x.hem_load();
      if (params < 0) { this.port.postMessage({ t: 'error', message: name + ' does not run in a browser yet' }); return; }
      this.x = x;
      this.bins = x.hem_has_spectrum();
      for (const m of this.pending) this.apply(m);
      this.pending = [];
      this.ready = true;
      this.port.postMessage({ t: 'ready', params, latency: x.hem_latency(), bins: this.bins, rate: sampleRate });
    }, err => this.port.postMessage({ t: 'error', message: String(err) }));
  }
  apply(m) {
    const x = this.x;
    if (m.t === 'p') x.hem_set(m.i, m.v);
    else if (m.t === 'on') x.hem_on(m.v ? 1 : 0);
    else if (m.t === 'reset') x.hem_reset();
  }
  process(inputs, outputs) {
    if (this.stopped) return false;   // let the browser free this node
    const out = outputs[0];
    if (!this.ready) {   // until the plug-in is ready the sound passes straight through, so nothing goes quiet
      const inp = inputs[0];
      for (let c = 0; c < out.length; c++) { if (inp && inp.length) out[c].set(inp[Math.min(c, inp.length - 1)]); else out[c].fill(0); }
      return true;
    }
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
    if (++this.tick >= 12) {   // about every 32 ms
      this.tick = 0;
      const B = this.bins, r = new Float32Array(11 + 2 * B);
      r[0] = this.x.hem_reduction();
      for (let k = 0; k < 10; k++) r[1 + k] = this.x.hem_meter(k);
      for (let b = 0; b < B; b++) { r[11 + b] = this.x.hem_spec_before(b); r[11 + B + b] = this.x.hem_spec_after(b); }
      this.port.postMessage(r, [r.buffer]);
    }
    return true;
  }
}
registerProcessor('hem-rack', HemRackProcessor);
