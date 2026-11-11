// HEM stem player on the browser's audio thread.
// Holds every stem (16-bit, in this thread's memory), mixes them with each strip's level / mute / solo,
// then runs the sum through HOTHEAD (hem-hothead.wasm, the plug-in's real C++), then out.
// Nothing here allocates while playing; stems are added only while stopped or between blocks.
class HemStemsProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.stems = [];          // {L, R: Int16Array, len, target, g, mute, solo, peak}
    this.playing = false;
    this.pos = 0;
    this.len = 0;
    this.tick = 0;
    this.ready = false;
    this.pending = [];
    this.port.onmessage = e => { if (this.ready) this.apply(e.data); else this.pending.push(e.data); };
    const stub = { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0 };
    WebAssembly.instantiate(options.processorOptions.wasm, { wasi_snapshot_preview1: stub }).then(({ instance }) => {
      const x = instance.exports;
      x._initialize();
      x.hem_init(sampleRate);
      this.x = x;
      this.ready = true;
      for (const m of this.pending) this.apply(m);
      this.pending = [];
      this.port.postMessage({ t: 'ready', rate: sampleRate, latency: x.hem_latency() });
    }, err => this.port.postMessage({ t: 'error', message: String(err) }));
  }
  apply(m) {
    const x = this.x;
    switch (m.t) {
      case 'add': {
        const db = m.db ?? 0;
        this.stems[m.i] = { L: m.L, R: m.R, len: m.len, target: Math.pow(10, db / 20), g: Math.pow(10, db / 20), mute: !!m.mute, solo: false, peak: 0 };
        this.len = Math.max(this.len, m.len);
        break;
      }
      case 'clear': this.stems = []; this.len = 0; this.pos = 0; this.playing = false; break;
      case 'play': this.playing = this.len > 0; break;
      case 'pause': this.playing = false; break;
      case 'seek': this.pos = Math.max(0, Math.min(this.len, Math.round(m.v))); break;
      case 'gain': if (this.stems[m.i]) this.stems[m.i].target = m.db <= -60 ? 0 : Math.pow(10, m.db / 20); break;
      case 'mute': if (this.stems[m.i]) this.stems[m.i].mute = !!m.v; break;
      case 'solo': if (this.stems[m.i]) this.stems[m.i].solo = !!m.v; break;
      case 'drive': x.hem_drive_set(m.v); break;
      case 'on': x.hem_on(m.v ? 1 : 0); break;
      case 'trim': x.hem_trim_set(m.v); break;
    }
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
    const n = out[0].length, L = this.L, R = this.R;
    L.fill(0, 0, n); R.fill(0, 0, n);
    if (this.playing) {
      const anySolo = this.stems.some(s => s && s.solo);
      const left = Math.max(0, Math.min(n, this.len - this.pos));
      for (const s of this.stems) {
        if (!s) continue;
        const want = (s.mute || (anySolo && !s.solo)) ? 0 : s.target;
        const g0 = s.g, dg = (want - g0) / n;          // level moves smoothly across the block: no zipper noise
        s.g = want;
        const sl = s.L, sr = s.R, p = this.pos, k = 1 / 32768;
        const m = Math.min(left, Math.max(0, s.len - p));
        let pk = s.peak;
        for (let i = 0; i < m; i++) {
          const a = sl[p + i] * k, b = sr[p + i] * k, g = g0 + dg * i;
          L[i] += a * g; R[i] += b * g;
          const q = Math.max(a < 0 ? -a : a, b < 0 ? -b : b) * g;
          if (q > pk) pk = q;
        }
        s.peak = pk;
      }
      this.pos += n;
      if (this.pos >= this.len) { this.playing = false; this.pos = this.len; this.port.postMessage({ t: 'ended' }); }
    }
    this.x.hem_process(n);
    out[0].set(L.subarray(0, n));
    if (out[1]) out[1].set(R.subarray(0, n));
    if (++this.tick >= 8) {   // about every 21 ms: where the song is, and the meters
      this.tick = 0;
      const peaks = new Float32Array(this.stems.length + 2);
      this.stems.forEach((s, i) => { if (s) { peaks[i] = s.peak; s.peak = 0; } });
      peaks[this.stems.length] = this.x.hem_peak(0);
      peaks[this.stems.length + 1] = this.x.hem_peak(1);
      this.port.postMessage({ t: 'm', pos: this.pos, playing: this.playing, peaks });
    }
    return true;
  }
}
registerProcessor('hem-stems', HemStemsProcessor);
