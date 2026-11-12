// =============================================================================
//  HEM rack faceplate for the web.
//  Everything comes from the plug-in itself:
//    the layout      faceLayout()        (exported to hem-rack-layouts.json by the rack's own code)
//    the plate       renderRackPlate()   (plate picture + real crown and ghost, exported as plate-<name>.webp)
//    the knob parts  buildPartsAtlas()   (The Hybrid Core's knob body, track, pointer, light, shadow)
//    the drawing     FaceView            (ported line for line below: knobs, buttons, steppers, power, meters, curve)
//    the mouse       FaceController      (vertical drag, double-click = default, wheel, steppers by halves)
//    value text, which controls are active, the EQ curve: a second copy of the plug-in's C++ on the page.
//  What is not the same: the plug-in draws with the graphics card in linear light with a bloom pass; this draws with
//  the browser's 2D canvas, so soft edges and shading can differ slightly. Text is the same Poppins font.
// =============================================================================
const PW = 1672, PH = 941, PI = Math.PI;
const KMIN = -0.75 * PI, KMAX = 0.75 * PI;
const KN = { body: 0.665, arcR: 0.745, arcW: 0.085, indFrom: 0.20, indTo: 0.62 };
const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const TH = { teal: hex('#22D8DD'), tealDeep: hex('#0E8E96'), silver: hex('#D8DEE2'), label: hex('#B9C2C7'), dim: hex('#6C767C'),
  before: hex('#A9B0B5'), gold: hex('#E7B54A'), violet: hex('#A87BFF'), red: hex('#FF5A5A') };
const GLASS = [4 / 255, 6 / 255, 7 / 255, 0.88], INK = hex('#061012');
const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${(c.length > 3 ? c[3] : 1) * a})`;
// text styles: [weight, em in plate units] (hc::ui kTextStyles; Poppins Medium / SemiBold / Bold)
const TS = { Caption: [600, 24], Value: [600, 28], Label: [600, 30], Title: [600, 34], Tab: [600, 40], Panel: [700, 52], Heading: [700, 56], Display: [700, 96] };
const LADDER = ['Caption', 'Value', 'Label', 'Title', 'Tab', 'Panel', 'Heading', 'Display'];
const K = { Knob: 0, Toggle: 1, ChoiceButton: 2, Stepper: 3, RangeSlider: 4, Bypass: 5, Spectrum: 6, EqGraph: 7, GraphRange: 8, BandButton: 9,
  CurveDisplay: 10, GrMeter: 11, VuMeter: 12, Readout: 13, History: 14, PageTab: 15, Keyboard: 16, Rta: 17, Polar: 18, CloneCurve: 19 };
const GRANGES = [3, 6, 12, 30];
const FACE = { EliteEq: 0, Restorer: 1, Tape: 3, Exciter: 7, DigitalDelay: 13 };
const BANDCOL = ['#22D8DD', '#E7B54A', '#A87BFF', '#FF5A5A', '#5BE36B', '#4C8DFF', '#FF6FC4', '#F4E04D', '#9FF0F2', '#B6E35B', '#E05BE6', '#7FC4FF', '#FF9466', '#6FE8B8', '#C9B3FF', '#FFB830'].map(hex);
const STEREO_TAG = ['', 'M', 'S', 'L', 'R'];
const KBLACK = [false, true, false, true, false, false, true, false, true, false, true, false], KWHITE = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const whiteKeys = n => { let c = 0; for (let k = 0; k < n; k++) c += KBLACK[k % 12] ? 0 : 1; return c; };
function keyRect(kb, keys, k) {   // FaceController keyRect
  const ww = kb.w / Math.max(1, whiteKeys(keys)), white = Math.floor(k / 12) * 7 + KWHITE[k % 12];
  if (!KBLACK[k % 12]) return R4([kb.x + white * ww, kb.y, ww, kb.h]);
  const bw = ww * 0.6; return R4([kb.x + (white + 1) * ww - bw * 0.5, kb.y, bw, kb.h * 0.62]);
}
function keyAt(kb, keys, x, y) {
  if (x < kb.x || x >= kb.r || y < kb.y || y >= kb.b) return -1;
  const inside = (r) => x >= r.x && x < r.r && y >= r.y && y < r.b;
  for (let k = 0; k < keys; k++) if (KBLACK[k % 12] && inside(keyRect(kb, keys, k))) return k;
  for (let k = 0; k < keys; k++) if (!KBLACK[k % 12] && inside(keyRect(kb, keys, k))) return k;
  return -1;
}
const DISPLAY = new Set([K.Spectrum, K.CurveDisplay, K.GrMeter, K.VuMeter, K.Readout, K.History, K.Rta, K.Polar]);
const R4 = a => ({ x: a[0], y: a[1], w: a[2], h: a[3], cx: a[0] + a[2] / 2, cy: a[1] + a[3] / 2, r: a[0] + a[2], b: a[1] + a[3] });
const plotArea = r => R4([r.x + 70, r.y + 20, r.w - 90, r.h - 62]);
const freqToX = (p, hz) => p.x + Math.log(Math.min(Math.max(hz, 20), 20000) / 20) / Math.log(1000) * p.w;
const xToFreq = (p, x) => 20 * Math.pow(1000, Math.min(Math.max((x - p.x) / p.w, 0), 1));

// ---- the value text rules (Face.hpp shortDb / tightValue, FaceView::knob)
function shortDb(v) {
  if (v.length >= 7 && v.endsWith('.0 dB')) {
    let s = 0; while (s < v.length && (v[s] === '+' || v[s] === '-')) s++;
    let d = 0; for (let k = s; k < v.length - 5; k++) if (v[k] >= '0' && v[k] <= '9') d++;
    if (d >= 2) v = v.slice(0, v.length - 5) + v.slice(v.length - 3);
  }
  if (v.length > 3 && v.endsWith(' ms')) {
    const t = v.slice(0, -3), ms = Number(t);
    if (t.trim() !== '' && isFinite(ms) && ms >= 1000) v = (ms >= 10000 ? (ms / 1000).toFixed(1) : (ms / 1000).toFixed(2)) + ' s';
  }
  if (v.length >= 6 && v.indexOf(' ') < 0 && v.endsWith('.00')) { const s = v[0] === '+' || v[0] === '-' ? 1 : 0; if (v.length - 3 - s >= 3) v = v.slice(0, -3); }
  if (v.length >= 9 && v.endsWith(' kHz')) { const dot = v.indexOf('.'); if (dot >= 2 && v.length - 4 - dot === 3) v = v.slice(0, v.length - 5) + v.slice(v.length - 4); }
  return v;
}
function tightValue(v) {
  const sp = v.lastIndexOf(' '); if (sp < 0) return v;
  const unit = v.slice(sp + 1);
  if (!['dB', 'Hz', 'kHz', 'ms', 's', '%', 'st', 'cents', 'deg', 'x', 'dBFS'].includes(unit)) return v;
  return v.slice(0, sp) + (unit === 'kHz' ? 'k' : '');
}
const readoutWidest = f => f === '+2' ? '-60.00' : f === '0' ? '888' : f === 'note' ? 'C#4' : f === 'key' ? 'Bb MIN' : '-60.0';

// ---- the plug-in's C++ on the page (value text, active controls, the EQ curve); the audio thread runs its own copy
export class RackUi {
  static async create(wasmBytes, name) {
    const stub = { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0, fd_fdstat_get: () => 0, environ_get: () => 0, environ_sizes_get: () => 0, proc_exit: () => 0 };
    const { instance } = await WebAssembly.instantiate(wasmBytes, { wasi_snapshot_preview1: stub });
    const x = instance.exports; x._initialize(); x.hem_init(48000);
    const b = new TextEncoder().encode(name);
    new Uint8Array(x.memory.buffer, x.hem_name(), b.length + 1).set([...b, 0]);
    const ui = new RackUi(x, 0); ui.load(name); return ui;
  }
  constructor(x, n) { this.x = x; this.n = n; }
  load(name) {   // the same engine for every plug-in tried (memory stays the same)
    const b = new TextEncoder().encode(name);
    new Uint8Array(this.x.memory.buffer, this.x.hem_name(), b.length + 1).set([...b, 0]);
    const n = this.x.hem_load();
    if (n < 0) throw new Error(name + ' does not run in a browser yet');
    this.n = n; this.name = name;
  }
  str(p) { const m = new Uint8Array(this.x.memory.buffer, p); let e = 0; while (m[e]) e++; return new TextDecoder().decode(m.subarray(0, e)); }
  get(i) { return this.x.hem_get(i); }
  set(i, v) { this.x.hem_set(i, v); }
  norm(i) { return this.x.hem_norm(i); }
  setNorm(i, n) { this.x.hem_set_norm(i, n); }
  text(i) { return this.str(this.x.hem_text(i)); }
  active(i) { return this.x.hem_active(i) !== 0; }
  curveInfo() { const kind = this.x.hem_curve_info(); if (!kind) return null; const io = new Float32Array(this.x.memory.buffer, this.x.hem_io(), 4); return { kind, range: io[0], scaleParam: io[1], spectrumParam: io[2], right: io[3] > 0.5 }; }
  curveDb(hz, right = 0) { return this.x.hem_curve_db(hz, right); }
  eqPrepare(dyn) { const io = new Float32Array(this.x.memory.buffer, this.x.hem_io(), 16); for (let b = 0; b < 16; b++) io[b] = dyn ? dyn[b] : 0; return this.x.hem_eq_prepare(); }
  eqDb(b, hz, live) { return this.x.hem_eq_db(b, hz, live ? 1 : 0); }
  typeGain(t) { return this.x.hem_eq_type_gain(t) !== 0; }
  typeDyn(t) { return this.x.hem_eq_type_dyn(t) !== 0; }
  delayMs(div, bpm, ms) { return this.x.hem_ddelay_ms(div, bpm, ms); }
  rtaHz(res, b) { return this.x.hem_rta_hz(res, b); }
  dots() { const n = this.x.hem_curve_dots(); return Array.from(new Float32Array(this.x.memory.buffer, this.x.hem_io(), n)); }
}


// ---- the knob cap, pointer and shine, mixed in linear light like the plug-in's graphics-card renderer
// (the canvas mixes in sRGB, which made the caps about 15% too bright). Cached per knob until it turns or resizes.
const S2L = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const L2S = new Uint8ClampedArray(4097).map((_, i) => { const l = i / 4096; return Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)); });
const enc = l => L2S[Math.min(4096, Math.max(0, Math.round(l * 4096)))];
function pixels(img) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; }
function unpack(px, W, x0, w, h) {   // premultiplied sRGB colour | alpha  ->  linear premultiplied RGBA floats
  const o = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = (y * W + x0 + x) * 4, b = (y * W + x0 + w + x) * 4, k = (y * w + x) * 4;
    o[k] = S2L[px[a]]; o[k + 1] = S2L[px[a + 1]]; o[k + 2] = S2L[px[a + 2]]; o[k + 3] = px[b] / 255;
  }
  return o;
}
function bilerp(src, w, h, x, y, out) {   // premultiplied, outside = clear
  x -= 0.5; y -= 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const xx = x0 + i, yy = y0 + j; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const wt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy), k = (yy * w + xx) * 4;
    out[0] += src[k] * wt; out[1] += src[k + 1] * wt; out[2] += src[k + 2] * wt; out[3] += src[k + 3] * wt;
  }
}
class LitKnob {
  constructor(knobImg, ptrImg, tealSrgb) {
    const kp = pixels(knobImg), pp = pixels(ptrImg);
    this.body = unpack(kp, 1024, 0, 256, 256); this.light = unpack(kp, 1024, 512, 256, 256);
    const ptr = unpack(pp, 48, 0, 24, 96);
    const tint = tealSrgb.map(c => S2L[Math.round((0.55 + 0.45 * c) * 255)]);
    // the pointer laid on the body (pointing up), as FaceView places it: centre 0.41 body radii out, 0.56 long, a quarter as wide
    const bodyR = 127, md = 0.41 * bodyR, ih = 0.42 * bodyR * 96 / 72, iw = ih * 24 / 96, t = [0, 0, 0, 0];
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const px = (x + 0.5 - 128) / iw * 24 + 12, py = (y + 0.5 - (128 - md)) / ih * 96 + 48;
      if (px < -1 || py < -1 || px > 25 || py > 97) continue;
      bilerp(ptr, 24, 96, px, py, t);
      if (t[3] <= 0) continue;
      const k = (y * 256 + x) * 4, ia = 1 - t[3], B = this.body;
      B[k] = t[0] * tint[0] + B[k] * ia; B[k + 1] = t[1] * tint[1] + B[k + 1] * ia; B[k + 2] = t[2] * tint[2] + B[k + 2] * ia; B[k + 3] = t[3] + B[k + 3] * ia;
    }
  }
  render(S, ang, cache) {
    if (cache.S === S && cache.a === Math.round(ang * 2000)) return cache.cv;
    const cv = cache.cv || document.createElement('canvas'); if (cv.width !== S) { cv.width = cv.height = S; }
    const g = cv.getContext('2d'), im = g.createImageData(S, S), d = im.data;
    const ss = S < 160 ? 2 : 1, ca = Math.cos(ang), sa = Math.sin(ang), b = [0, 0, 0, 0], l = [0, 0, 0, 0], k256 = 256 / S;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let r = 0, gg = 0, bb = 0, a = 0;
      for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
        const u = (x + (i + 0.5) / ss) * k256, v = (y + (j + 0.5) / ss) * k256, dx = u - 128, dy = v - 128;
        if (dx * dx + dy * dy > 129 * 129) continue;
        bilerp(this.body, 256, 256, ca * dx + sa * dy + 128, -sa * dx + ca * dy + 128, b);
        bilerp(this.light, 256, 256, u, v, l);
        const ia = 1 - l[3];
        r += l[0] + b[0] * ia; gg += l[1] + b[1] * ia; bb += l[2] + b[2] * ia; a += l[3] + b[3] * ia;
      }
      const n = ss * ss, k = (y * S + x) * 4; a /= n;
      if (a <= 0.001) continue;
      d[k] = enc(r / n / a); d[k + 1] = enc(gg / n / a); d[k + 2] = enc(bb / n / a); d[k + 3] = Math.round(Math.min(a, 1) * 255);
    }
    g.putImageData(im, 0, 0);
    cache.cv = cv; cache.S = S; cache.a = Math.round(ang * 2000);
    return cv;
  }
}

let partsP = null;
function loadParts(base) {
  if (partsP) return partsP;
  const names = ['knob-pm', 'pointer-pm', 'KnobShadow', 'KnobTrack',
    'IconPrev-teal', 'IconPrev-teal-add', 'IconNext-teal', 'IconNext-teal-add', 'IconPrev-silver', 'IconPrev-silver-add', 'IconNext-silver', 'IconNext-silver-add',
    'IconPrev-dim', 'IconPrev-dim-add', 'IconNext-dim', 'IconNext-dim-add'];
  const img = n => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok([n, i]); i.onerror = () => bad(new Error('missing ' + n)); i.src = base + n + '.png'; });
  const fonts = [[500, 'Poppins-Medium'], [600, 'Poppins-SemiBold'], [700, 'Poppins-Bold']].map(([w, f]) => {
    const ff = new FontFace('HEM Poppins', `url(${base}${f}.ttf)`, { weight: String(w) });
    return ff.load().then(x => document.fonts.add(x));
  });
  partsP = Promise.all([Promise.all(names.map(img)), Promise.all(fonts)]).then(([list]) => Object.fromEntries(list));
  return partsP;
}

export class HemFace {
  // opts: { canvas, layout (one entry of hem-rack-layouts.json), base (folder with the parts), plate (image url), ui (RackUi),
  //         onParam(i, plain), onPower(on) }
  constructor(opts) {
    Object.assign(this, opts);
    this.L = opts.layout;
    this.on = true;
    this.hover = -1; this.active = -1;
    this.feed = { gr: 0, meters: new Float32Array(10), before: null, after: null };
    this.needle = 1; this.held = new Float32Array(10); this.needles = {}; this.hist = {};
    this.st = { sel: 0, range: 2, page: 0, hoverNode: -1, dragNode: -1 };   // FaceState
    this.c = this.canvas.getContext('2d');
    this.capH = {};
    this.curve = this.ui.curveInfo();
    this.dirty = true;
    this.ready = Promise.all([loadParts(this.base), new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('missing plate')); i.src = this.plate; })])
      .then(([parts, plate]) => { this.P = parts; this.plateImg = plate; this.lit = parts.__lit || (parts.__lit = new LitKnob(parts['knob-pm'], parts['pointer-pm'], TH.teal)); this.knobCache = []; this.measure(); this.bind(); this.loop(); });
  }
  destroy() { this.dead = true; this.unbind && this.unbind(); }
  setPower(on) { this.on = !!on; this.dirty = true; }
  setFeed(r) {   // a Float32Array from the worklet
    const f = this.feed;
    f.gr = r[0];
    for (let k = 0; k < 10; k++) f.meters[k] = r[1 + k];
    f.flags = r[11]; f.removed = r[12]; f.autoGain = r[13]; f.dyn = r.subarray(16, 32);
    const B = r[14], A = r[15]; let o = 33;
    if (B > 0 && !this.binHz) this.binHz = Float32Array.from({ length: B }, (_, i) => this.ui.x.hem_bin_hz(i));
    if (B > 0) { f.before = r.subarray(o, o + B); f.after = r.subarray(o + B, o + 2 * B); this.bins = B; }
    o += 2 * B;
    if (f.flags & 2) { f.noise = r.subarray(o, o + B); o += B; }
    if (A > 0) { f.rta = [r.subarray(o, o + A), r.subarray(o + A, o + 2 * A)]; f.rtaMax = [r.subarray(o + 2 * A, o + 3 * A), r.subarray(o + 3 * A, o + 4 * A)]; f.spdAngle = r.subarray(o + 4 * A, o + 5 * A); f.spdLevel = r.subarray(o + 5 * A, o + 6 * A); }
    this.dirty = true;
  }
  // ---- text (Renderer::text with TextFx::Shadowed / Plain)
  font(s) { return `${TS[s][0]} ${TS[s][1]}px "HEM Poppins", Poppins, sans-serif`; }
  // the plug-in measures and draws text by glyph advances, no kerning
  measure() { const c = this.c; c.fontKerning = 'none'; for (const s of LADDER) { c.font = this.font(s); this.capH[s] = c.measureText('H').actualBoundingBoxAscent; } }
  tw(s, t) { this.c.font = this.font(s); this.c.fontKerning = 'none'; return this.c.measureText(t).width; }
  fit(base, t, w) { let i = LADDER.indexOf(base); while (i > 0 && this.tw(LADDER[i], t) > w) i--; return LADDER[i]; }
  mid(r, s) { return r.cy + this.capH[s] * 0.5; }
  text(s, t, x, y, col, align = 'center', shadow = true, a = 1) {
    const c = this.c;
    c.font = this.font(s); c.fontKerning = 'none'; c.textAlign = align; c.textBaseline = 'alphabetic';
    if (shadow) { c.shadowColor = css([0, 0, 0], 0.95 * a); c.shadowOffsetX = 1.5; c.shadowOffsetY = 2; c.shadowBlur = 3; }
    c.fillStyle = css(col, a); c.fillText(t, x, y);
    if (shadow) { c.shadowColor = 'transparent'; c.shadowOffsetX = c.shadowOffsetY = c.shadowBlur = 0; }
  }
  // ---- shapes (Renderer::fillRound / arc / polyline)
  round(r, rad, col, a = 1, add = false) {
    const c = this.c; c.globalCompositeOperation = add ? 'lighter' : 'source-over';
    c.fillStyle = css(col, a); c.beginPath(); c.roundRect(r.x, r.y, Math.max(r.w, 0), Math.max(r.h, 0), Math.max(0, Math.min(rad, r.w / 2, r.h / 2))); c.fill();
    c.globalCompositeOperation = 'source-over';
  }
  arc(cx, cy, rad, w, a0, a1, col, a = 1) {
    const c = this.c; c.strokeStyle = css(col, a); c.lineWidth = w; c.lineCap = 'butt';
    c.beginPath(); c.arc(cx, cy, rad, a0 - PI / 2, a1 - PI / 2); c.stroke();
  }
  line(xs, ys, w, col, a = 1) {
    const c = this.c; c.strokeStyle = css(col, a); c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath(); c.moveTo(xs[0], ys[0]); for (let i = 1; i < xs.length; i++) c.lineTo(xs[i], ys[i]); c.stroke();
  }
  sprite(n, x, y, w, h) {
    const c = this.c; c.drawImage(this.P[n], x, y, w, h);
    if (this.P[n + '-add']) { c.globalCompositeOperation = 'lighter'; c.drawImage(this.P[n + '-add'], x, y, w, h); c.globalCompositeOperation = 'source-over'; }
  }
  spriteRot(n, cx, cy, w, h, ang) { const c = this.c; c.save(); c.translate(cx, cy); c.rotate(ang); this.sprite(n, -w / 2, -h / 2, w, h); c.restore(); }
  // ---- controls
  plain(i) { return this.ui.get(i); }
  wp(w) {   // widgetParam: SURGEON's band controls follow the selected band; paged controls follow the page (LINK: page 0)
    if (w.ctl >= 0) return Math.min(Math.max(this.st.sel, 0), 15) * 12 + w.ctl;
    if (w.stride > 0 && w.p >= 0) return w.plink >= 0 && this.ui.norm(w.plink) >= 0.5 ? w.p : w.p + Math.max(this.st.page, 0) * w.stride;
    return w.p;
  }
  shown(w) { return w.sp < 0 || Math.round(this.plain(w.sp)) === w.sv; }
  header() {
    const L = this.L;
    for (const g of L.grooves) { this.line([g[0], g[2]], [g[1], g[3]], 2.4, TH.teal); this.c.globalCompositeOperation = 'lighter'; this.line([g[0], g[2]], [g[1], g[3]], 1.0, [1, 1, 1], 0.35); this.c.globalCompositeOperation = 'source-over'; }
    for (const [rect, t] of L.sections) { const r = R4(rect), s = this.fit('Label', t, r.w - 10); this.text(s, t, r.cx, this.mid(r, s), TH.teal); }
    const cx = PW / 2;
    const hs = this.fit('Heading', 'HYBRID ELITE MAFIA', 760); this.text(hs, 'HYBRID ELITE MAFIA', cx, 84, TH.silver);
    const ss = this.fit('Label', L.suite, 760); this.text(ss, L.suite, cx, 126, TH.teal);
    const crown = R4(L.crown), ghost = R4(L.ghost);
    this.text('Label', 'HEM AUDIO', ghost.x - 26, 78, TH.silver, 'right'); this.text('Caption', 'EST. 2024', ghost.x - 26, 112, TH.teal, 'right');
    this.text('Label', 'HEM-ELITE-RACK', crown.r + 26, 78, TH.silver, 'left'); this.text('Caption', 'AUDIO TOOLS', crown.r + 26, 112, TH.dim, 'left');
    const ta = R4(L.title), ns = this.fit('Display', L.name, ta.w);
    this.text(ns, L.name, ta.x, ta.y + ta.h * 0.66, TH.teal, 'left');
    let y = ta.b + 30;
    for (const n of L.leftNotes) { this.text(this.fit('Label', n, ta.w), n, ta.x + 2, y, TH.label, 'left'); y += 36; }
    let sy = 236;
    L.sideNotes.forEach((n, i) => { this.text(this.fit('Label', n, 180), n, 1545, sy, i % 2 === 0 ? TH.silver : TH.teal); sy += i % 2 === 0 ? 34 : 70; });
    const fp = R4(L.footerPlate);
    this.round(R4([fp.x + 4, fp.y + 4, fp.w - 8, fp.h - 8]), 6, GLASS);
    const tg = this.fit('Tab', L.tagline, fp.w - 40); this.text(tg, L.tagline, fp.cx, this.mid(fp, tg), TH.teal);
    const ft = R4(L.footer);
    this.text('Caption', L.name, 80, this.mid(ft, 'Caption'), TH.dim, 'left');
    this.text('Caption', 'HYBRID ELITE MAFIA', PW - 80, this.mid(ft, 'Caption'), TH.dim, 'right');
  }
  knob(w, wi) {
    const param = this.wp(w); if (param < 0 || param >= this.ui.n) return;
    const pi = this.L.params[param], d = R4(w.r), cx = d.cx, cy = d.cy, R = d.w * 0.5;
    const n = Math.min(Math.max(this.ui.norm(param), 0), 1), ang = KMIN + (KMAX - KMIN) * n;
    const bip = pi.min < 0 && pi.max > 0;
    const a0 = KMIN + (KMAX - KMIN) * (bip ? this.zeroNorm(param) : 0);
    const on = this.ui.active(param), hot = this.hover === wi || this.active === wi;
    const ar = KN.arcR * R, aw = KN.arcW * R * 1.1;
    this.sprite('KnobTrack', cx - R, cy - R, 2 * R, 2 * R);
    const D = 31, span = (KMAX - KMIN) / D, lo = Math.min(a0, ang), hi = Math.max(a0, ang);
    for (let i = 0; i < D; i++) {
      const d0 = KMIN + span * i + span * 0.18, d1 = d0 + span * 0.64, m = 0.5 * (d0 + d1);
      const lit = on && m >= lo - span * 0.5 && m <= hi + span * 0.5 && Math.abs(ang - a0) > 0.004;
      this.arc(cx, cy, ar, aw, d0, d1, TH.teal, lit ? 1 : 0.14);
    }
    if (on) {
      const tx = cx + Math.sin(ang) * ar, ty = cy - Math.cos(ang) * ar, dr = aw * 1.15;
      this.round(R4([tx - dr, ty - dr, 2 * dr, 2 * dr]), dr, TH.teal.map(v => v + (1 - v) * 0.45));
    }
    const bodyR = KN.body * R;
    this.sprite('KnobShadow', cx - bodyR * 1.14 + 0.06 * bodyR, cy - bodyR * 1.14 + 0.10 * bodyR, bodyR * 2.28, bodyR * 2.28);
    const bd = bodyR * 2 * 256 / 254;   // body, pointer and light: one linear-light picture (LitKnob)
    const S = Math.max(8, Math.round(bd * this.canvas.width / PW));
    const cache = this.knobCache[wi] || (this.knobCache[wi] = {});
    this.c.drawImage(this.lit.render(S, ang, cache), cx - bd / 2, cy - bd / 2, bd, bd);
    const cap = this.fit(w.small ? 'Caption' : 'Label', w.cap, d.w + (w.small ? 26 : 70));
    this.text(cap, w.cap, cx, d.y - (w.small ? 12 : 16), on ? TH.label : TH.dim);
    let v = this.ui.text(param);
    if (this.L.face === FACE.DigitalDelay && param === 2) {   // REPEAT OFFENDER: TIME shows the time it really uses while it follows a note
      const div = Math.round(this.plain(0));
      if (div !== 0) { const ms = this.ui.delayMs(div, this.plain(1), this.plain(2)); v = (ms < 100 ? ms.toFixed(1) : ms.toFixed(0)) + ' ms'; }
    }
    for (const u of [' deg', ' cents']) { const at = v.lastIndexOf(u); if (at >= 3 && at + u.length === v.length && v.slice(at - 3, at) === '.00') v = v.slice(0, at - 3) + v.slice(at); }
    v = shortDb(v); if (w.tight) v = tightValue(v);
    const vs = this.fit(w.small ? 'Value' : 'Title', v, d.w + (w.small ? 26 : 50));
    this.text(vs, v, cx, d.b + (w.small ? 26 : 32), on ? (hot ? TH.silver : TH.teal) : TH.dim);
    if (w.lo || w.hi) {
      const room = R * 0.62;
      if (this.tw('Caption', w.lo) <= room && this.tw('Caption', w.hi) <= room) {
        const y = d.b - 2, dx = R * 0.70;
        this.text('Caption', w.lo, cx - dx, y, TH.dim); this.text('Caption', w.hi, cx + dx, y, TH.dim);
      }
    }
  }
  zeroNorm(i) {   // toNormalized(pi, 0) for a linear control; a log control never crosses zero
    const p = this.L.params[i]; return p.taper === 0 ? (0 - p.min) / (p.max - p.min) : 0;
  }
  button(b, t, lit, hot, dim, col) {
    const bs = this.fit('Label', t, b.w - 16);
    if (lit && !dim) {
      this.round(R4([b.x + 2, b.y + 2, b.w - 4, b.h - 4]), 9, col, 0.92);
      this.round(R4([b.x + 8, b.y + 5, b.w - 16, b.h * 0.34]), 7, [1, 1, 1], 0.14, true);
      this.text(bs, t, b.cx, this.mid(b, bs), INK, 'center', false);
    } else {
      this.round(R4([b.x + 2, b.y + 2, b.w - 4, b.h - 4]), 9, GLASS);
      this.round(R4([b.x + 6, b.y + 3, b.w - 12, 2]), 1, col, dim ? 0.12 : hot ? 0.8 : 0.32);
      this.text(bs, t, b.cx, this.mid(b, bs), dim ? TH.dim : hot ? TH.silver : TH.label);
    }
  }
  stepper(w, wi) {
    const param = this.wp(w), b = R4(w.r), on = this.ui.active(param), hot = this.hover === wi;
    this.round(R4([b.x + 2, b.y + 2, b.w - 4, b.h - 4]), 8, GLASS);
    const arrows = w.r[2] >= 130, s = arrows ? b.h * 0.42 : 0;
    const ic = on ? (hot ? 'silver' : 'teal') : 'dim';
    if (arrows) { this.sprite('IconPrev-' + ic, b.x + 8, b.cy - s * 0.5, s, s); this.sprite('IconNext-' + ic, b.r - 8 - s, b.cy - s * 0.5, s, s); }
    const v = this.ui.text(param), vs = this.fit('Label', v, b.w - 2 * s - (arrows ? 26 : 12));
    this.text(vs, v, b.cx, this.mid(b, vs), on ? TH.teal : TH.dim);
    this.text('Caption', w.cap, b.x - 12, this.mid(b, 'Caption'), on ? TH.label : TH.dim, 'right');
  }
  bypass(w, wi) {
    const b = R4(w.r), on = this.on, hot = this.hover === wi;
    if (on) {
      this.round(R4([b.x + 3, b.y + 3, b.w - 6, b.h - 6]), b.w * 0.5 - 3, TH.teal, 0.95);
      this.round(R4([b.x + b.w * 0.22, b.y + b.h * 0.12, b.w * 0.56, b.h * 0.3]), b.h * 0.15, [1, 1, 1], 0.18, true);
    } else {
      this.round(R4([b.x + 3, b.y + 3, b.w - 6, b.h - 6]), b.w * 0.5 - 3, GLASS);
      this.arc(b.cx, b.cy, b.w * 0.44, 2.5, -PI, PI, TH.teal, hot ? 0.7 : 0.3);
    }
    const t = on ? 'ON' : 'OFF', s = this.fit('Label', t, b.w * 0.8);
    this.text(s, t, b.cx, this.mid(b, s), on ? INK : TH.label, 'center', !on);
    if (w.cap) this.text('Caption', w.cap, b.cx, b.b + 30, TH.label);
  }
  grid(plot, top, bottom, step, signed) {
    const p = plot, narrow = plot.w < 700;
    for (const hz of [20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000]) {
      const x = freqToX(plot, hz), lead = Math.log10(hz), major = Math.abs(lead - Math.round(lead)) < 1e-4;
      this.round(R4([x - 0.5, p.y, 1, p.h]), 0.5, [1, 1, 1], major ? 0.10 : 0.04);
      if ((major && hz >= 100) || (!narrow && [50, 200, 500, 2000, 5000].includes(hz)))
        this.text('Caption', hz >= 1000 ? (hz >= 10000 ? (hz / 1000).toFixed(0) : (hz / 1000).toFixed(1)) + 'k' : String(hz), x, p.b + 26, TH.dim);
    }
    const stepH = plot.h * step / Math.max(top - bottom, 1e-3), every = Math.max(1, Math.ceil(26 / Math.max(stepH, 1)));
    for (let db = top; db >= bottom - 1e-3; db -= step) {
      const y = p.y + (top - db) / (top - bottom) * p.h;
      this.round(R4([p.x, y - 0.5, p.w, 1]), 0.5, [1, 1, 1], Math.abs(db) < 1e-3 ? 0.16 : 0.06);
      if (Math.round(db / step) % every !== 0) continue;
      this.text('Caption', signed && db > 0 ? '+' + db.toFixed(0) : db.toFixed(0), p.x - 12, y + this.capH.Caption * 0.5, TH.dim, 'right');
    }
  }
  spectrumBehind(plot, alpha) {
    const f = this.feed; if (!f.after || !this.binHz) return;
    const p = plot, B = this.bins, c = this.c;
    const xs = new Float32Array(B), ya = new Float32Array(B), yb = new Float32Array(B);
    for (let i = 0; i < B; i++) { xs[i] = freqToX(plot, this.binHz[i]); ya[i] = p.y + Math.min(Math.max(-f.after[i] / 96, 0), 1) * p.h; yb[i] = p.y + Math.min(Math.max(-f.before[i] / 96, 0), 1) * p.h; }
    const g = c.createLinearGradient(0, p.y, 0, p.b); g.addColorStop(0, css(TH.teal, alpha)); g.addColorStop(1, css(TH.teal, 0.02));
    c.fillStyle = g; c.beginPath(); c.moveTo(xs[0], p.b); for (let i = 0; i < B; i++) c.lineTo(xs[i], ya[i]); c.lineTo(xs[B - 1], p.b); c.closePath(); c.fill();
    this.line(xs, yb, 1.2, TH.before, 0.35);
  }
  consoleCurve(w) {
    const plot = plotArea(R4(w.r)), p = plot, ci = this.curve;
    if (!ci || ci.spectrumParam < 0 || this.plain(ci.spectrumParam) >= 0.5) this.spectrumBehind(plot, 0.16);
    let range = ci ? ci.range : 18;
    if (ci && ci.scaleParam >= 0) range = this.plain(ci.scaleParam) >= 0.5 ? 30 : 12;
    this.grid(plot, range, -range, range >= 30 ? 10 : range >= 18 ? 6 : range >= 15 ? 5 : 3, true);
    if (!ci) return;
    const yOf = db => p.cy - Math.min(Math.max(db / range, -1.04), 1.04) * p.h * 0.5;
    const N = 220, xs = new Float32Array(N), ys = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = plot.x + plot.w * i / (N - 1); xs[i] = x; ys[i] = yOf(this.ui.curveDb(xToFreq(plot, x), 0)); }
    const c = this.c;
    for (let i = 0; i + 1 < N; i++) {   // light between the curve and 0 dB (strongest at the curve)
      const g = c.createLinearGradient(0, Math.min(ys[i], p.cy), 0, Math.max(ys[i], p.cy) + 0.01);
      const top = ys[i] <= p.cy; g.addColorStop(top ? 0 : 1, css(TH.teal, 0.20)); g.addColorStop(top ? 1 : 0, css(TH.teal, 0.04));
      c.fillStyle = g; c.beginPath(); c.moveTo(xs[i], ys[i]); c.lineTo(xs[i + 1], ys[i + 1]); c.lineTo(xs[i + 1], p.cy); c.lineTo(xs[i], p.cy); c.closePath(); c.fill();
    }
    this.line(xs, ys, 2.8, TH.teal);
    if (ci.right) {
      const yr = new Float32Array(N); let differs = false;
      for (let i = 0; i < N; i++) { yr[i] = yOf(this.ui.curveDb(xToFreq(plot, plot.x + plot.w * i / (N - 1)), 1)); differs = differs || Math.abs(yr[i] - ys[i]) > 0.5; }
      if (differs) this.line(xs, yr, 2.2, TH.gold);
    }
    const cols = ci.kind === 2 ? [TH.gold, TH.violet, TH.teal] : [TH.teal, TH.gold, TH.violet];   // VELVET: low, high, atten
    this.ui.dots().forEach((hz0, i) => {
      const hz = Math.min(Math.max(hz0, 20), 20000), x = freqToX(plot, hz), y = yOf(this.ui.curveDb(hz, 0));
      this.round(R4([x - 7, y - 7, 14, 14]), 7, cols[i % 3]);
    });
  }
  readout(w) {
    const b = R4(w.r);
    let v = this.feed.meters[w.ch] ?? 0;
    if (w.hi === '+' && w.lo === 'dB' && w.ch >= 0 && w.ch < 10) { let h = this.held[w.ch]; h = Math.abs(v) > Math.abs(h) ? v : h + (v - h) * 0.06; this.held[w.ch] = h; v = h; }
    if (Math.abs(v) < 0.05) v = 0;
    const small = w.r[3] < 110, tall = !small, oneLine = w.r[3] < 72;
    const nameW = this.tw('Caption', w.cap), unitW = w.lo ? this.tw('Caption', w.lo) : 0, numMinW = this.tw('Caption', readoutWidest(w.hi));
    const unitRun = w.lo ? 10 + unitW : 0;
    const side = !oneLine || nameW + unitRun + 14 + numMinW <= b.w - 36;
    const showUnit = !!w.lo && (!oneLine || side || nameW + unitRun <= b.w - 36);
    if (oneLine) {
      const base = side ? b.cy + this.capH.Caption * 0.5 : b.y + 6 + this.capH.Caption;
      this.text('Caption', w.cap, b.x + 18, base, TH.label, 'left');
      if (showUnit) this.text('Caption', w.lo, b.x + 18 + nameW + 10, base, TH.teal, 'left');
    } else {
      this.text('Caption', w.cap, b.x + 18, b.y + 30, TH.label, 'left');
      if (small) this.text('Caption', w.lo, b.x + 18, b.b - 16, TH.teal, 'left');
      else this.text('Caption', w.lo, b.x + 18, b.y + 60, TH.teal, 'left');
    }
    let t;
    if (v <= -99) t = '--';
    else t = w.hi === '+2' ? (v >= 0 ? '+' : '') + v.toFixed(2) : w.hi === '+' ? (v >= 0 ? '+' : '') + v.toFixed(1) : w.hi === '0' ? v.toFixed(0) : v.toFixed(1);
    if (t === '-0.0' || t === '-0.00') t = t.replace('-', '+');
    if (oneLine && !side) { const ns = this.fit('Value', t, b.w - 36); this.text(ns, t, b.r - 18, b.b - 6, TH.teal, 'right'); return; }
    const words = tall ? 0 : oneLine ? (showUnit ? nameW + 10 + unitW : nameW) : Math.max(nameW, unitW);
    const room = tall ? b.w - 36 : b.w - 36 - words - 14;
    const big = this.fit(small ? 'Panel' : 'Display', t, tall ? room : Math.min(b.w * 0.5, room));
    this.text(big, t, b.r - 18, b.b - (small ? 14 : 18), TH.teal, 'right');
  }
  grMeter(w, dt, wi) {
    const d = R4(w.r);
    const target = Math.min(Math.max(w.ch >= 0 ? this.feed.meters[w.ch] : this.feed.gr, -20), 0);
    const own = w.ch >= 0, saved = this.needle; if (own) this.needle = this.needleOf('g' + wi);
    if (this.needle > 0.5) this.needle = target;
    // the plug-in steps its needle 30 times a second; here the same swing whatever the screen's frame rate
    const k = target < this.needle ? 0.5 : 0.08, steps = dt * 30;
    this.needle += (target - this.needle) * (1 - Math.pow(1 - k, steps));
    if (Math.abs(this.needle) < 0.01) this.needle = 0;
    const caption = w.cap || 'GAIN REDUCTION  dB', small = w.r[3] < 260, px = d.cx;
    const under = d.x + 20 + this.tw('Caption', caption) > px - 16;
    const py = small && under ? d.b - 18 - this.capH.Caption - 8 - 13 : d.b - 34;
    const big = small ? 'Title' : 'Panel', bigBase = d.y + (small ? 40 : 52);
    let R = Math.min(d.w * 0.42, d.h * 0.78);
    if (small) R = Math.max(30, Math.min(R, py - (bigBase + 8) - 30 - this.capH.Caption * 0.5 - 2));
    const angle = db => (50 - 100 * Math.pow(Math.min(Math.max(-db / 20, 0), 1), 0.6)) * PI / 180;
    this.arc(px, py, R, 3, angle(-20), angle(0), TH.teal, 0.35);
    this.arc(px, py, R, 5, angle(-3), angle(0), TH.teal, 0.75);
    const marks = [0, -1, -2, -3, -4, -6, -8, -10, -14, -20], boxes = [], texts = [], show = [], capH = this.capH.Caption;
    marks.forEach((m, i) => {
      const a = angle(m), sx = Math.sin(a), sy = -Math.cos(a);
      this.line([px + sx * (R - 14), px + sx * (R + 8)], [py + sy * (R - 14), py + sy * (R + 8)], 2.2, TH.silver, 0.8);
      texts[i] = String(Math.abs(m)); const tw = this.tw('Caption', texts[i]), cx = px + sx * (R + 30), cy = py + sy * (R + 30);
      boxes[i] = { x: cx - tw / 2 - 3, y: cy - capH / 2 - 2, w: tw + 6, h: capH + 4 }; show[i] = true;
    });
    const touch = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
    let last = 0; for (let i = 1; i < marks.length - 1; i++) { if (touch(boxes[last], boxes[i])) show[i] = false; else last = i; }
    for (let i = marks.length - 2; i > 0; i--) if (show[i] && touch(boxes[i], boxes[marks.length - 1])) show[i] = false;
    marks.forEach((m, i) => { if (show[i]) this.text('Caption', texts[i], boxes[i].x + boxes[i].w / 2, boxes[i].y + boxes[i].h / 2 + capH * 0.5, TH.label); });
    const a = angle(this.needle);
    this.line([px, px + Math.sin(a) * R * 0.97], [py, py - Math.cos(a) * R * 0.97], 2.6, TH.silver);
    this.round(R4([px - 13, py - 13, 26, 26]), 13, hex('#9AA4AA'));
    this.round(R4([px - 6, py - 6, 12, 12]), 6, TH.tealDeep);
    this.text('Caption', caption, d.x + 20, d.b - 18, TH.label, 'left');
    this.text(big, (Math.abs(this.needle) < 0.05 ? 0 : this.needle).toFixed(1), d.r - 24, bigBase, TH.teal, 'right');
    if (own) { this.needles['g' + wi] = this.needle; this.needle = saved; }
  }
  legendAt(p) { this.lx = p.x + 14; }
  legend(p, t, col) {
    this.round(R4([this.lx, p.y + 14, 18, 4]), 2, col);
    this.text('Caption', t, this.lx + 26, p.y + 14 + this.capH.Caption * 0.6, col, 'left');
    this.lx += 26 + this.tw('Caption', t) + 30;
  }
  fillUnder(xs, ys, base, aTop, aBot, col) {   // light from a line down (or up) to `base`, strongest at the line
    const c = this.c;
    for (let i = 0; i + 1 < xs.length; i++) {
      const y0 = Math.min(ys[i], ys[i + 1], base), y1 = Math.max(ys[i], ys[i + 1], base);
      if (y1 - y0 < 0.01) continue;
      const g = c.createLinearGradient(0, y0, 0, y1), top = Math.min(ys[i], ys[i + 1]) <= base;
      g.addColorStop(top ? 0 : 1, css(col, aTop)); g.addColorStop(top ? 1 : 0, css(col, aBot));
      c.fillStyle = g; c.beginPath(); c.moveTo(xs[i], ys[i]); c.lineTo(xs[i + 1], ys[i + 1]); c.lineTo(xs[i + 1], base); c.lineTo(xs[i], base); c.closePath(); c.fill();
    }
  }
  specLines(plot) {   // xs and the dB of each spectrum bin
    const B = this.bins, xs = new Float32Array(B); for (let i = 0; i < B; i++) xs[i] = freqToX(plot, this.binHz[i]); return xs;
  }
  spectrum(w) {   // FaceView::spectrum (THE CLEANER, UNDERGROUND, SPARK, FURNACE)
    const plot = plotArea(R4(w.r)), p = plot, f = this.feed;
    this.grid(plot, 0, -96, 12, false);
    const yOf = db => p.y + Math.min(Math.max((0 - db) / 96, 0), 1) * p.h;
    const restorer = this.L.face === FACE.Restorer;
    if (restorer) {
      const x0 = freqToX(plot, this.plain(3)), x1 = freqToX(plot, this.plain(4));
      if (x0 > p.x + 0.5) this.round(R4([p.x, p.y, x0 - p.x, p.h]), 0, [0, 0, 0], 0.45);
      if (x1 < p.r - 0.5) this.round(R4([x1, p.y, p.r - x1, p.h]), 0, [0, 0, 0], 0.45);
    }
    if (f.after && this.binHz) {
      const xs = this.specLines(plot), B = this.bins, ya = new Float32Array(B), yb = new Float32Array(B);
      for (let i = 0; i < B; i++) { ya[i] = yOf(f.after[i]); yb[i] = yOf(f.before[i]); }
      this.fillUnder(xs, ya, p.b, 0.30, 0.03, TH.teal);
      this.line(xs, yb, 1.6, TH.before, 0.75);
      this.line(xs, ya, 2.4, TH.teal);
    }
    if (this.L.face === FACE.Exciter) {   // below FREQUENCY nothing is added
      const x1 = freqToX(plot, this.plain(0));
      if (x1 > p.x + 0.5) this.round(R4([p.x, p.y, x1 - p.x, p.h]), 0, [0, 0, 0], 0.55);
      this.line([x1, x1], [p.y, p.b], 2, TH.gold, 0.8);
    }
    this.legendAt(p); this.legend(p, 'BEFORE', TH.before); this.legend(p, 'AFTER', TH.teal);
    if (f.flags & 2) {
      this.legend(p, 'NOISE FLOOR', TH.gold);
      if (f.noise && this.binHz) {
        const xs = this.specLines(plot);
        for (let i = 0; i + 2 < this.bins; i += 4) this.line([xs[i], xs[i + 1], xs[i + 2]], [yOf(f.noise[i]), yOf(f.noise[i + 1]), yOf(f.noise[i + 2])], 2, TH.gold, 0.9);
      }
      const rem = f.removed || 0, t = rem < -0.05 ? 'TAKING OUT ' + (-rem).toFixed(1) + ' dB' : 'NOTHING TAKEN OUT';
      this.text('Value', t, p.r - 14, p.y + 14 + this.capH.Value, TH.teal, 'right');
    }
    if (restorer && this.plain(6) >= 0.5) {
      const t = 'LISTEN IS ON: YOU HEAR ONLY WHAT IS TAKEN OUT', s = this.fit('Label', t, p.w - 40);
      this.text(s, t, p.cx, p.b - 18, TH.gold);
    }
  }
  rangeSlider(w, wi) {   // FaceView::rangeSlider (THE CLEANER's FREQUENCY RANGE)
    const plot = plotArea(R4(this.L.display)), lo = this.plain(w.p), hi = this.plain(w.p2), t = R4(w.r);
    const track = R4([t.x, t.cy - 4, t.w, 8]);
    this.round(track, 4, GLASS);
    const x0 = freqToX(plot, lo), x1 = freqToX(plot, hi);
    this.round(R4([x0, track.y, Math.max(x1 - x0, 1), track.h]), 4, TH.teal);
    const hot = this.hover === wi || this.active === wi;
    for (const x of [x0, x1]) {
      const h = R4([x - 9, t.y + 4, 18, t.h - 8]);
      this.round(R4([h.x + 2, h.y + 3, h.w, h.h]), 6, [0, 0, 0], 0.5);
      this.round(h, 6, hot ? TH.silver : hex('#A8B2B8'));
      this.round(R4([h.cx - 1.5, h.y + 6, 3, h.h - 12]), 1.5, TH.tealDeep);
    }
    const text = w.cap + '   ' + this.ui.text(w.p) + '  -  ' + this.ui.text(w.p2), s = this.fit('Caption', text, t.w);
    this.text(s, text, t.cx, t.b + 24, TH.label);
  }
  eqBand(b) {
    const P = k => this.plain(b * 12 + k);
    return { on: P(0) >= 0.5, type: Math.min(Math.max(Math.round(P(1)), 0), 6), freq: P(2), gain: P(3), stereo: Math.min(Math.max(Math.round(P(6)), 0), 4), dyn: P(7) >= 0.5 };
  }
  eqGraph(w) {   // FaceView::eqGraph (SURGEON)
    const plot = plotArea(R4(w.r)), p = plot, f = this.feed, range = GRANGES[Math.min(Math.max(this.st.range, 0), 3)];
    const step = range <= 3 ? 1 : range <= 6 ? 2 : range <= 12 ? 3 : 10;
    this.spectrumBehind(plot, 0.16);
    this.grid(plot, range, -range, step, true);
    const yOf = db => p.cy - Math.min(Math.max(db / range, -1.04), 1.04) * p.h * 0.5;
    const bands = Array.from({ length: 16 }, (_, b) => this.eqBand(b));
    const anyOn = this.ui.eqPrepare(f.dyn) > 0;
    const anyDyn = bands.some(bd => bd.on && bd.dyn && this.ui.typeDyn(bd.type));
    const N = 220, xs = new Float32Array(N), hz = new Float64Array(N), total = new Float32Array(N), live = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = plot.x + plot.w * i / (N - 1); xs[i] = x; hz[i] = xToFreq(plot, x); }
    const own = new Float32Array(N), sel = Math.min(Math.max(this.st.sel, 0), 15);
    for (let b = 0; b < 16; b++) {
      if (!bands[b].on) continue;
      for (let i = 0; i < N; i++) { const d = this.ui.eqDb(b, hz[i], false); total[i] += d; live[i] += this.ui.eqDb(b, hz[i], true); own[i] = yOf(d); }
      if (b !== sel) this.line(xs, own, 1.6, BANDCOL[b], 0.8);
    }
    if (bands[sel].on) {
      for (let i = 0; i < N; i++) own[i] = yOf(this.ui.eqDb(sel, hz[i], false));
      this.fillUnder(xs, own, p.cy, 0.22, 0.05, BANDCOL[sel]);
      this.line(xs, own, 2.2, BANDCOL[sel]);
    }
    if (anyOn) {
      this.line(xs, total.map(yOf), 2.8, TH.teal);
      if (anyDyn) this.line(xs, live.map(yOf), 1.6, TH.silver, 0.85);
    } else {
      this.line([p.x, p.r], [p.cy, p.cy], 2, TH.teal, 0.6);
      const t = 'DOUBLE-CLICK THE GRAPH TO ADD A BAND', hs = this.fit('Label', t, p.w * 0.8);
      this.text(hs, t, p.cx, p.cy - 30, TH.label);
    }
    for (let b = 0; b < 16; b++) {
      const bd = bands[b]; if (!bd.on) continue;
      const col = BANDCOL[b], x = freqToX(plot, bd.freq), y = this.ui.typeGain(bd.type) ? yOf(bd.gain) : p.cy;
      const selected = b === sel, hot = this.st.hoverNode === b || this.st.dragNode === b, rad = selected ? 15 : 12;
      if (this.ui.typeDyn(bd.type) && bd.dyn) {
        const yd = yOf(bd.gain + (f.dyn ? f.dyn[b] : 0));
        this.line([x, x], [y, yd], 2, col, 0.7); this.arc(x, yd, rad * 0.75, 2, -PI, PI, col);
      }
      this.round(R4([x - rad + 1.5, y - rad + 2.5, 2 * rad, 2 * rad]), rad, [0, 0, 0], 0.55);
      this.round(R4([x - rad, y - rad, 2 * rad, 2 * rad]), rad, col);
      if (selected || hot) this.arc(x, y, rad + 4, 2, -PI, PI, TH.silver, selected ? 1 : 0.6);
      this.text('Caption', String(b + 1), x, y + this.capH.Caption * 0.5, INK, 'center', false);
      const tag = STEREO_TAG[bd.stereo]; if (tag) this.text('Caption', tag, x + rad + 6, y - rad * 0.4, col, 'left');
    }
    if (this.plain(16 * 12 + 1) >= 0.5) {   // AUTO GAIN
      const g = f.autoGain || 0, t = 'AUTO GAIN ' + (g >= 0 ? '+' : '') + g.toFixed(1) + ' dB';
      this.text('Value', t, p.x + 14, p.y + 14 + this.capH.Value, TH.teal, 'left');
    }
  }
  nodeAt(x, y) {   // FaceController::nodeAt
    if (this.L.face !== FACE.EliteEq) return -1;
    const p = plotArea(R4(this.L.display)), range = GRANGES[this.st.range];
    let best = -1, bestD = 22 * 22;
    for (let b = 0; b < 16; b++) {
      const bd = this.eqBand(b); if (!bd.on) continue;
      const nx = freqToX(p, bd.freq), g = this.ui.typeGain(bd.type) ? Math.min(Math.max(bd.gain / range, -1.04), 1.04) : 0, ny = p.cy - g * p.h * 0.5;
      const d = (x - nx) ** 2 + (y - ny) ** 2;
      if (d < bestD || (d === bestD && b === this.st.sel)) { bestD = d; best = b; }
    }
    return best;
  }
  needleOf(wi) { return this.needles[wi] ?? (this.needles[wi] = 1); }
  vuNeedle(w, wi, meter, caption, dt) {   // FaceView::vuMeter(meter, caption): a compressor's needle reading IN or OUT
    const d = R4(w.r), target = Math.min(Math.max(this.feed.meters[meter] ?? -20, -20), 3);
    let n = this.needleOf(wi); if (n > 50) n = target;
    n += (target - n) * (1 - Math.pow(1 - 0.35, dt * 30)); this.needles[wi] = n;
    const px = d.cx, py = d.b - 34, bigBase = d.y + 52, R = Math.min(d.w * 0.42, d.h * 0.78);
    const angle = db => { const v = Math.pow(10, Math.min(Math.max(db, -20), 3) / 20), lo = 0.1, hi = Math.pow(10, 3 / 20); return (-50 + 100 * (v - lo) / (hi - lo)) * PI / 180; };
    this.arc(px, py, R, 3, angle(-20), angle(0), TH.teal, 0.35);
    this.arc(px, py, R, 5, angle(0), angle(3), hex('#D04040'), 0.85);
    let lastRight = -1e9; const capH = this.capH.Caption;
    for (const m of [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3]) {
      const a = angle(m), sx = Math.sin(a), sy = -Math.cos(a);
      this.line([px + sx * (R - 14), px + sx * (R + 8)], [py + sy * (R - 14), py + sy * (R + 8)], 2.2, TH.silver, 0.8);
      const t = (m > 0 ? '+' : '') + m, tw = this.tw('Caption', t), cx = px + sx * (R + 30), cy = py + sy * (R + 30);
      if (cx - tw * 0.5 < lastRight + 4) continue;
      lastRight = cx + tw * 0.5;
      this.text('Caption', t, cx, cy + capH * 0.5, m > 0 ? hex('#E06060') : TH.label);
    }
    const a = angle(n);
    this.line([px, px + Math.sin(a) * R * 0.97], [py, py - Math.cos(a) * R * 0.97], 2.6, TH.silver);
    this.round(R4([px - 13, py - 13, 26, 26]), 13, hex('#9AA4AA')); this.round(R4([px - 6, py - 6, 12, 12]), 6, TH.tealDeep);
    this.text('Caption', caption, d.x + 20, d.b - 18, TH.label, 'left');
    this.text('Panel', (target >= 0 ? '+' : '') + target.toFixed(1), d.r - 24, bigBase, TH.teal, 'right');
  }
  tapeVu(w, wi, dt) {   // FaceView::vuMeter (ARCHIVE): 0 VU = the VU CAL level
    const d = R4(w.r), ch = Math.min(Math.max(w.ch, 0), 1), cal = [-18, -14, -10, -6][Math.min(Math.max(Math.round(this.plain(7)), 0), 3)];
    const vu = Math.min(Math.max((this.feed.meters[ch] ?? -100) - cal, -22), 4);
    let n = this.needleOf(wi); if (n > 50) n = vu;
    n += (vu - n) * (1 - Math.pow(1 - 0.35, dt * 30)); this.needles[wi] = n;
    const px = d.cx, py = d.b - 30, R = Math.min(d.w * 0.44, d.h * 0.78);
    const angle = v => { const a = Math.pow(10, v / 20), lo = 0.1, hi = Math.pow(10, 3 / 20); return (-50 + 100 * Math.min(Math.max((a - lo) / (hi - lo), 0), 1)) * PI / 180; };
    this.arc(px, py, R, 3, angle(-20), angle(0), TH.teal, 0.45);
    this.arc(px, py, R, 5, angle(0), angle(3), TH.red, 0.85);
    for (const v of [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3]) {
      const a = angle(v), sx = Math.sin(a), sy = -Math.cos(a);
      this.line([px + sx * (R - 14), px + sx * (R + 8)], [py + sy * (R - 14), py + sy * (R + 8)], 2.2, v > 0 ? TH.red : TH.silver, v > 0 ? 1 : 0.8);
      if ([-20, -10, -7, -5, -3, 0, 3].includes(v)) this.text('Caption', (v > 0 ? '+' : '') + v, px + sx * (R + 30), py + sy * (R + 30) + this.capH.Caption * 0.5, v > 0 ? TH.red : TH.label);
    }
    const a = angle(n);
    this.line([px, px + Math.sin(a) * R * 0.97], [py, py - Math.cos(a) * R * 0.97], 2.6, TH.silver);
    this.round(R4([px - 13, py - 13, 26, 26]), 13, hex('#9AA4AA')); this.round(R4([px - 6, py - 6, 12, 12]), 6, TH.tealDeep);
    this.text('Label', 'VU', d.x + 24, d.y + 40, TH.teal, 'left');
    this.text('Label', w.cap, d.r - 24, d.y + 40, TH.label, 'right');
    this.text('Caption', '0 VU = ' + cal + ' dBFS', d.x + 24, d.b - 18, TH.dim, 'left');
  }
  history(w, wi) {   // FaceView::history (HITMAN, SWITCHBLADE): about 4 s, 60 columns a second
    const b = R4(w.r), p = R4([b.x + 16, b.y + 16, b.w - 32, b.h - 32]), N = 240;
    const H = this.hist[wi] || (this.hist[wi] = { a: [new Float32Array(N), new Float32Array(N), new Float32Array(N)], pos: 0, n: 0, t: performance.now() });
    const now = performance.now(), m = this.feed.meters;
    let cols = Math.min(N, Math.floor((now - H.t) / (1000 / 60)));
    if (cols > 0) H.t += cols * 1000 / 60;
    while (cols-- > 0) {
      H.a[0][H.pos] = Math.min(Math.max(m[0], -24), 0); H.a[1][H.pos] = Math.min(Math.max(m[1], -24), 0); H.a[2][H.pos] = Math.min(Math.max(m[2], -60), 0);
      H.pos = (H.pos + 1) % N; H.n = Math.min(H.n + 1, N);
    }
    const grid = [0, -6, -12, -18, -24];
    for (const db of grid) { const y = p.y + (-db / 24) * p.h; this.line([p.x, p.r], [y, y], 1, TH.silver, 0.10); }
    const n = H.n;
    if (n >= 2) {
      const xs = new Float32Array(n), ys = new Float32Array(n);
      const fill = (which, lo) => { for (let i = 0; i < n; i++) { const idx = (H.pos - n + i + 2 * N) % N; xs[i] = p.r - (n - 1 - i) / (N - 1) * p.w; ys[i] = p.y + Math.min(Math.max(H.a[which][idx] / lo, 0), 1) * p.h; } };
      fill(2, -60); this.fillUnder(xs, ys, p.b, 0.18, 0.02, TH.silver); this.line(xs, ys, 1.4, TH.silver, 0.6);
      fill(1, -24); this.line(xs, ys, 2.0, TH.gold);
      fill(0, -24); this.line(xs, ys, 2.4, TH.red);
    }
    const capH = this.capH.Caption;
    for (const db of grid) {
      const y = p.y + (-db / 24) * p.h, t = String(db), base = y + (db === 0 ? capH + 4 : -4), tw = this.tw('Caption', t);
      this.round(R4([p.x + 1, base - capH - 3, tw + 7, capH + 6]), 3, hex('#0A0E12'), 0.78);
      this.text('Caption', t, p.x + 4, base, TH.dim, 'left');
    }
    let lx = p.r - 8;
    for (const [t, col] of [['INPUT', TH.silver], [w.hi || 'GR 2', TH.gold], [w.lo || 'GR 1', TH.red]]) { this.text('Caption', t, lx, p.b - 6, col, 'right'); lx -= this.tw('Caption', t) + 26; }
  }
  rta(w) {   // FaceView::rta (STAKEOUT)
    const plot = plotArea(R4(w.r)), p = plot, f = this.feed;
    this.grid(plot, 0, -90, 10, false);
    if (!f.rta) return;
    const res = Math.min(Math.max(Math.round(this.plain(0)), 0), 2), dual = this.plain(3) < 0.5, showMax = this.plain(6) >= 0.5;
    const step = [40, 20, 10][res], low = Math.floor(240 / step), nb = low + 46;
    const yOf = db => p.y + Math.min(Math.max((0 - db) / 90, 0), 1) * p.h;
    const mx = [[], []], my = [[], []];
    for (let b = 0; b < nb; b++) {
      const hz = this.ui.rtaHz(res, b);
      const lo = b < low ? hz - 0.5 * step : b === low ? 240 + 0.5 * step : Math.sqrt(this.ui.rtaHz(res, b - 1) * hz);
      const hi = b < low ? hz + 0.5 * step : b + 1 < nb ? Math.sqrt(hz * this.ui.rtaHz(res, b + 1)) : 21000;
      let x0 = freqToX(plot, Math.max(lo, 20)) + 0.6, x1 = freqToX(plot, Math.min(hi, 20000)) - 0.6;
      if (x1 <= x0) continue;
      for (let sd = 0; sd < (dual ? 2 : 1); sd++) {
        const a = dual ? x0 + (x1 - x0) * 0.5 * sd : x0, e = dual ? a + (x1 - x0) * 0.5 : x1, y = yOf(f.rta[sd][b]), col = sd === 0 ? TH.teal : TH.gold;
        if (y < p.b - 0.5) this.round(R4([a, y, Math.max(e - a - 0.4, 0.6), p.b - y]), 0, col, 0.75);
        mx[sd].push(0.5 * (a + e)); my[sd].push(yOf(f.rtaMax[sd][b]));
      }
    }
    if (showMax) for (let sd = 0; sd < (dual ? 2 : 1); sd++) if (mx[sd].length > 1) this.line(mx[sd], my[sd], 1.4, sd === 0 ? TH.label : TH.gold, 0.8);
    this.text('Caption', dual ? 'LEFT' : 'L+R', p.x + 14, p.y + 26, TH.teal, 'left');
    if (dual) this.text('Caption', 'RIGHT', p.x + 90, p.y + 26, TH.gold, 'left');
  }
  polar(w) {   // FaceView::polar (STAKEOUT)
    const b = R4(w.r), cx = b.cx, cy = b.b - 30, rad = Math.min(b.w * 0.5 - 20, b.h - 60), K = 80, d2r = PI / 180, c = this.c;
    c.fillStyle = css(TH.red, 0.16);
    for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(cx, cy); for (let a = 60; a <= 90; a += 2) c.lineTo(cx + rad * Math.sin(a * d2r * sd), cy - rad * Math.cos(a * d2r * sd)); c.closePath(); c.fill(); }
    for (let ring = 0; ring <= 3; ring++) {
      const rr = rad * (1 - 20 * ring / K), xs = [], ys = [];
      for (let k = 0; k <= 60; k++) { const a = (-90 + 3 * k) * d2r; xs.push(cx + rr * Math.sin(a)); ys.push(cy - rr * Math.cos(a)); }
      this.line(xs, ys, 1, [1, 1, 1], ring === 0 ? 0.18 : 0.08);
    }
    for (const deg of [-90, -45, 0, 45, 90]) this.line([cx, cx + rad * Math.sin(deg * d2r)], [cy, cy - rad * Math.cos(deg * d2r)], 1, [1, 1, 1], deg === 0 ? 0.16 : 0.08);
    this.text('Caption', 'L', cx - rad * 0.74, cy - rad * 0.74 - 8, TH.label); this.text('Caption', 'R', cx + rad * 0.74, cy - rad * 0.74 - 8, TH.label);
    this.text('Caption', 'MONO', cx, cy - rad - 10, TH.label);
    const f = this.feed; if (!f.spdAngle) return;
    const res = Math.min(Math.max(Math.round(this.plain(0)), 0), 2), nb = Math.floor(240 / [40, 20, 10][res]) + 46;
    for (let k = 0; k < nb; k++) {
      const lv = f.spdLevel[k]; if (lv < -K) continue;
      const rr = rad * Math.min(Math.max(1 + lv / K, 0), 1), ang = Math.min(Math.max(f.spdAngle[k], -90), 90), a = ang * d2r;
      this.round(R4([cx + rr * Math.sin(a) - 3, cy - rr * Math.cos(a) - 3, 6, 6]), 3, Math.abs(f.spdAngle[k]) > 45 ? TH.red : TH.teal, 0.9);
    }
  }
  keyboard(w) {   // FaceView::keyboard (THE INFORMANT, GRAND LARCENY)
    const ivory = hex('#C9CFD2'), ebony = hex('#0B0E10');
    for (let pass = 0; pass < 2; pass++)
      for (let k = 0; k < w.ch; k++) {
        const black = KBLACK[k % 12]; if (black !== (pass === 1)) continue;
        const kr = keyRect(R4(w.r), w.ch, k), on = this.plain(w.p + k) >= 0.5, live = this.ui.active(w.p + k);
        const body = black ? kr : R4([kr.x + 1, kr.y + 1, kr.w - 2, kr.h - 2]);
        if (on) this.round(body, black ? 3 : 4, TH.teal); else if (black) this.round(body, 3, ebony); else this.round(body, 4, ivory, live ? 1 : 0.55);
        if (!black && k % 12 === 0) this.text('Caption', 'C' + (2 + Math.floor(k / 12)), kr.cx, kr.b - 8, on ? INK : hex('#384046'), 'center', false);
      }
  }
  // ---- one frame (FaceView::draw)
  draw(dt) {
    const c = this.c, cw = this.canvas.width, s = cw / PW;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.plateImg, 0, 0, cw, this.canvas.height);
    c.setTransform(s, 0, 0, s, 0, 0);
    this.header();
    this.L.widgets.forEach((w, wi) => {
      if (!this.shown(w)) return;
      const hot = this.hover === wi;
      switch (w.k) {
        case K.Knob: this.knob(w, wi); break;
        case K.Toggle: {
          const tp = this.wp(w), on = this.plain(tp) >= 0.5; let t = w.cap;
          if (w.ctl === 0) t = 'BAND ' + (Math.min(Math.max(this.st.sel, 0), 15) + 1);
          if (w.hi === 'PRESS') { this.button(R4(w.r), t, false, hot, false, TH.teal); break; }
          if (!t) t = on ? 'ON' : 'OFF';
          else { const room = w.r[2] - 12; if (this.tw('Caption', t + '  OFF') <= room) t += on ? '  ON' : '  OFF'; else if (this.tw('Caption', t + ' OFF') <= room) t += on ? ' ON' : ' OFF'; }
          this.button(R4(w.r), t, on, hot, !this.ui.active(tp), TH.teal); break;
        }
        case K.ChoiceButton: {
          // an external-sidechain choice: greyed, the website has no second input to feed it
          const pi = this.L.params[w.p], usable = !w.sc, lit = usable && Math.round(this.plain(w.p)) === w.ch;
          this.button(R4(w.r), pi.choices ? pi.choices[w.ch] : '', lit, hot && usable, !usable, TH.teal);
          if (w.cap) this.text('Label', w.cap, w.r[0] + 2, w.r[1] - 14, TH.label, 'left');
          break;
        }
        case K.Stepper: this.stepper(w, wi); break;
        case K.Bypass: this.bypass(w, wi); break;
        case K.CurveDisplay: this.consoleCurve(w); break;
        case K.GrMeter: {
          if (w.p2 >= 0 && w.meter >= 0) {   // a meter selector: IN / GR / OUT (or IN / OUT)
            const twoWay = this.L.params[w.p2].max < 1.5, raw = Math.round(this.plain(w.p2)), sel = twoWay ? (raw >= 1 ? 2 : 0) : Math.min(Math.max(raw, 0), 2);
            if (sel !== 1) { this.vuNeedle(w, wi, w.meter + (sel === 2 ? 1 : 0), sel === 0 ? 'INPUT  VU' : 'OUTPUT  VU', dt); break; }
            if (this.needle > 0) this.needle = 0;
          }
          this.grMeter(w, dt, wi); break;
        }
        case K.RangeSlider: this.rangeSlider(w, wi); break;
        case K.Spectrum: this.spectrum(w); break;
        case K.EqGraph: this.eqGraph(w); break;
        case K.VuMeter: this.tapeVu(w, wi, dt); break;
        case K.History: this.history(w, wi); break;
        case K.Rta: this.rta(w); break;
        case K.Polar: this.polar(w); break;
        case K.Keyboard: this.keyboard(w); break;
        case K.GraphRange: this.button(R4(w.r), GRANGES[w.ch] + ' dB', this.st.range === w.ch, hot, false, TH.teal); break;
        case K.PageTab: this.button(R4(w.r), w.cap, this.st.page === w.ch, hot, false, TH.teal); break;
        case K.BandButton: {
          const on = this.plain(w.ch * 12) >= 0.5, b = R4(w.r);
          this.button(b, String(w.ch + 1), on, hot, false, BANDCOL[w.ch]);
          if (this.st.sel === w.ch) this.round(R4([b.x + 6, b.b - 4, b.w - 12, 3]), 1.5, TH.silver);
          break;
        }
        case K.Readout: this.readout(w); break;
        default: break;   // the other kinds are on plug-ins that are not on the website yet
      }
      if (!this.on && DISPLAY.has(w.k)) {
        const b = R4(w.r); this.round(b, 6, [0, 0, 0], 0.72);
        const st = this.fit('Label', 'OFF', b.w * 0.8); this.text(st, 'OFF', b.cx, this.mid(b, st), TH.label);
      }
    });
  }
  loop() {
    let last = performance.now();
    const live = new Set([K.GrMeter, K.Readout, K.Spectrum, K.EqGraph, K.VuMeter, K.History, K.Rta, K.Polar]);
    const moving = () => this.L.widgets.some(w => live.has(w.k)) || (this.curve && this.feed.after);
    const tick = now => {
      if (this.dead) return;
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      this.fitCanvas();
      if (this.dirty || moving()) { this.dirty = false; this.draw(dt); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  fitCanvas() {
    // the canvas's own width (offsetWidth stays right when the page turns it sideways for BIG VIEW)
    const cw = this.canvas.offsetWidth || this.canvas.getBoundingClientRect().width, dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(w * PH / PW));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.dirty = true; }
    this.dpr = w / Math.max(cw, 1);
    this.cssPerUnit = cw / PW;
  }
  // ---- mouse and touch (FaceController)
  setNorm(i, n) { this.ui.setNorm(i, Math.min(Math.max(n, 0), 1)); this.onParam && this.onParam(i, this.ui.get(i)); this.dirty = true; }
  setPlain(i, v) { this.ui.set(i, v); this.onParam && this.onParam(i, this.ui.get(i)); this.dirty = true; }
  step(i, delta) { const count = this.L.params[i].max + 1, cur = Math.round(this.plain(i)); this.setPlain(i, ((cur + delta) % count + count) % count); }
  rangeMove(w, x, handle) {   // FaceController: the two handles keep a third of an octave apart
    const hz = xToFreq(plotArea(R4(this.L.display)), x);
    if (handle === 1) this.setPlain(w.p, Math.min(hz, this.plain(w.p2) / 1.26)); else this.setPlain(w.p2, Math.max(hz, this.plain(w.p) * 1.26));
  }
  hit(x, y) {
    const W = this.L.widgets;
    for (let i = W.length - 1; i >= 0; i--) {
      const w = W[i]; if (!this.shown(w)) continue; const r = R4(w.r);
      if (w.k === K.Knob || w.k === K.Bypass) { const rr = r.w * 0.5 + (w.k === K.Knob ? 10 : 0); if ((x - r.cx) ** 2 + (y - r.cy) ** 2 <= rr * rr) return i; }
      else if (w.k === K.RangeSlider) { if (x >= r.x - 14 && x < r.r + 14 && y >= r.y + 6 && y < r.b - 6) return i; }
      else if (DISPLAY.has(w.k)) continue;
      else if (x >= r.x && x < r.r && y >= r.y && y < r.b) return i;
    }
    return -1;
  }
  bind() {
    const cv = this.canvas;
    // this.rot: the page has turned the plate a quarter turn clockwise (BIG VIEW on a phone held upright)
    const at = e => { const r = cv.getBoundingClientRect();
      return this.rot ? [(e.clientY - r.top) / r.height * PW, (r.right - e.clientX) / r.width * PH] : [(e.clientX - r.left) / r.width * PW, (e.clientY - r.top) / r.height * PH]; };
    const upOf = e => this.rot ? e.clientX : -e.clientY;   // "up" on the plate, in screen pixels
    let lastDown = { t: 0, i: -1 }, dragV = 0, dragV2 = 0, lastY = 0, lastPX = 0, lastPY = 0, pid = null, handle = 0, heldKey = -1, latchOn = false;
    const plot = () => plotArea(R4(this.L.display));
    const capture = e => { pid = e.pointerId; try { cv.setPointerCapture(pid); } catch (err) { } };
    const down = e => {
      const [x, y] = at(e), i = this.hit(x, y); if (i < 0) return;
      e.preventDefault();
      const w = this.L.widgets[i], now = performance.now(), dbl = lastDown.i === i && now - lastDown.t < 350;
      lastDown = { t: now, i };
      lastPX = x; lastPY = y;
      const param = this.wp(w);
      switch (w.k) {
        case K.Knob:
          if (param < 0) return;
          if (dbl) { const p = this.L.params[param]; this.ui.set(param, p.def); this.onParam && this.onParam(param, this.ui.get(param)); this.dirty = true; return; }
          this.active = i; dragV = this.ui.norm(param); lastY = upOf(e); capture(e); break;
        case K.Toggle: {
          const off = this.plain(param) >= 0.5; this.setNorm(param, off ? 0 : 1);
          if (off) for (const kb of this.L.widgets) if (kb.k === K.Keyboard && kb.p2 === param) for (let k = 0; k < kb.ch; k++) if (this.plain(kb.p + k) >= 0.5) this.setNorm(kb.p + k, 0);
          break;
        }
        case K.ChoiceButton: if (!w.sc) this.setPlain(param, w.ch); break;
        case K.Stepper: this.step(param, x < R4(w.r).cx ? -1 : 1); break;
        case K.RangeSlider: {
          const p = plot(), xl = freqToX(p, this.plain(w.p)), xh = freqToX(p, this.plain(w.p2));
          handle = Math.abs(x - xl) <= Math.abs(x - xh) ? 1 : 2; if (Math.abs(x - xl) === Math.abs(x - xh)) handle = x < xl ? 1 : 2;
          const pr = handle === 1 ? w.p : w.p2;
          if (dbl) { this.setPlain(pr, this.L.params[pr].def); return; }
          this.active = i; capture(e); this.rangeMove(w, x, handle); break;
        }
        case K.GraphRange: this.st.range = Math.min(Math.max(w.ch, 0), 3); break;
        case K.PageTab: this.st.page = w.ch; break;
        case K.BandButton: this.st.sel = w.ch; if (dbl) this.setNorm(w.ch * 12, this.plain(w.ch * 12) >= 0.5 ? 0 : 1); break;
        case K.EqGraph: {
          const node = this.nodeAt(x, y), p = plot();
          if (node >= 0) {
            this.st.sel = node;
            if (dbl) { this.setNorm(node * 12, 0); break; }
            this.st.dragNode = node; dragV = this.ui.norm(node * 12 + 2); dragV2 = this.ui.norm(node * 12 + 3); this.active = i; capture(e); break;
          }
          if (!dbl || x < p.x || x >= p.r || y < p.y || y >= p.b) break;
          let b = -1; for (let k = 0; k < 16; k++) if (this.plain(k * 12) < 0.5) { b = k; break; }
          if (b < 0) break;
          const range = GRANGES[this.st.range], gain = Math.min(Math.max((p.cy - y) / (p.h * 0.5) * range, -30), 30), hz = xToFreq(p, x);
          const type = hz < 30 ? 3 : hz > 16000 ? 4 : 0;
          this.setPlain(b * 12 + 1, type); this.setPlain(b * 12 + 2, hz); this.setPlain(b * 12 + 3, type === 0 ? gain : 0); this.setPlain(b * 12 + 4, type === 0 ? 1 : 0.71); this.setPlain(b * 12, 1);
          this.st.sel = b; break;
        }
        case K.Keyboard: {
          const k = keyAt(R4(w.r), w.ch, x, y); if (k < 0) break;
          this.active = i; capture(e); heldKey = k;
          if (w.p2 >= 0 && this.plain(w.p2) >= 0.5) { latchOn = this.plain(w.p + k) < 0.5; this.setNorm(w.p + k, latchOn ? 1 : 0); }
          else this.setNorm(w.p + k, 1);
          break;
        }
        case K.Bypass: this.on = !this.on; this.onPower && this.onPower(this.on); this.dirty = true; break;
      }
      this.dirty = true;
    };
    const move = e => {
      const [x, y] = at(e);
      if (this.active >= 0 && e.pointerId === pid && this.L.widgets[this.active].k !== K.Knob) {
        const w = this.L.widgets[this.active], k = e.shiftKey ? 0.15 : 1;
        if (w.k === K.RangeSlider) this.rangeMove(w, x, handle);
        else if (w.k === K.EqGraph && this.st.dragNode >= 0) {
          const b = this.st.dragNode, p = plot(), range = GRANGES[this.st.range];
          dragV = Math.min(Math.max(dragV + (x - lastPX) / p.w * k, 0), 1); this.setNorm(b * 12 + 2, dragV);
          if (this.ui.typeGain(Math.round(this.plain(b * 12 + 1)))) { const dg = -(y - lastPY) / p.h * 2 * range * k; dragV2 = Math.min(Math.max(dragV2 + dg / 60, 0), 1); this.setNorm(b * 12 + 3, dragV2); }
        } else if (w.k === K.Keyboard) {
          const kk = keyAt(R4(w.r), w.ch, x, y);
          if (kk !== heldKey) {
            const sustain = w.p2 >= 0 && this.plain(w.p2) >= 0.5;
            if (!sustain && heldKey >= 0) this.setNorm(w.p + heldKey, 0);
            if (kk >= 0) this.setNorm(w.p + kk, sustain ? (latchOn ? 1 : 0) : 1);
            heldKey = kk;
          }
        }
        lastPX = x; lastPY = y; return;
      }
      if (this.active >= 0 && e.pointerId === pid) {
        const w = this.L.widgets[this.active], param = this.wp(w), p = this.L.params[param];
        // the plug-in: 360 plate units for the whole turn (a choice: 40 per step). On a small screen that would be a
        // few millimetres, so the drag never gets shorter than 200 screen pixels.
        let range = 360; if (p.taper === 2) range = Math.min(Math.max(40 * p.max, 60), 360);
        const rangePx = Math.max(range * this.cssPerUnit, p.taper === 2 ? 30 * p.max : 200);
        const k = e.shiftKey ? 0.15 : 1;
        dragV = Math.min(Math.max(dragV + (upOf(e) - lastY) / rangePx * k, 0), 1); lastY = upOf(e);
        this.setNorm(param, dragV); return;
      }
      const h = this.hit(x, y); if (h !== this.hover) { this.hover = h; this.dirty = true; }
      const hn = h >= 0 && this.L.widgets[h].k === K.EqGraph ? this.nodeAt(x, y) : -1; if (hn !== this.st.hoverNode) { this.st.hoverNode = hn; this.dirty = true; }
      cv.style.cursor = h >= 0 ? (this.L.widgets[h].k === K.Knob ? 'ns-resize' : 'pointer') : '';
    };
    const up = e => {
      if (e.pointerId !== pid) return;
      const w = this.active >= 0 ? this.L.widgets[this.active] : null;
      if (w && w.k === K.Keyboard && !(w.p2 >= 0 && this.plain(w.p2) >= 0.5) && heldKey >= 0) this.setNorm(w.p + heldKey, 0);
      this.active = -1; this.st.dragNode = -1; handle = 0; heldKey = -1; pid = null; this.dirty = true;
    };
    const leave = () => { if (this.active < 0 && this.hover !== -1) { this.hover = -1; this.dirty = true; } };
    const wheel = e => {
      const [x, y] = at(e), i = this.hit(x, y); if (i < 0) return;
      const w = this.L.widgets[i]; if (w.k !== K.Knob && w.k !== K.Stepper && w.k !== K.EqGraph) return;
      const notches = -Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) / 100, 3) || 0, param = this.wp(w);
      if (w.k === K.EqGraph) {
        const node = this.nodeAt(x, y); if (node < 0) return;
        e.preventDefault(); this.st.sel = node; this.setNorm(node * 12 + 4, this.ui.norm(node * 12 + 4) + notches * 0.03 * (e.shiftKey ? 0.2 : 1)); return;
      }
      e.preventDefault();
      if (w.k === K.Knob) this.setNorm(param, this.ui.norm(param) + notches * 0.02 * (e.shiftKey ? 0.2 : 1));
      else this.step(param, notches > 0 ? 1 : -1);
    };
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', leave); cv.addEventListener('wheel', wheel, { passive: false });
    this.unbind = () => { cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); cv.removeEventListener('pointerleave', leave); cv.removeEventListener('wheel', wheel); };
  }
}
