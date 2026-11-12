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
    const n = x.hem_load();
    if (n < 0) throw new Error(name + ' does not run in a browser yet');
    return new RackUi(x, n);
  }
  constructor(x, n) { this.x = x; this.n = n; }
  str(p) { const m = new Uint8Array(this.x.memory.buffer, p); let e = 0; while (m[e]) e++; return new TextDecoder().decode(m.subarray(0, e)); }
  get(i) { return this.x.hem_get(i); }
  set(i, v) { this.x.hem_set(i, v); }
  norm(i) { return this.x.hem_norm(i); }
  setNorm(i, n) { this.x.hem_set_norm(i, n); }
  text(i) { return this.str(this.x.hem_text(i)); }
  active(i) { return this.x.hem_active(i) !== 0; }
  curveInfo() { const kind = this.x.hem_curve_info(); if (!kind) return null; const io = new Float32Array(this.x.memory.buffer, this.x.hem_io(), 4); return { kind, range: io[0], scaleParam: io[1], spectrumParam: io[2], right: io[3] > 0.5 }; }
  curveDb(hz, right = 0) { return this.x.hem_curve_db(hz, right); }
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
    this.needle = 1; this.held = new Float32Array(10);
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
    this.feed.gr = r[0];
    for (let k = 0; k < 10; k++) this.feed.meters[k] = r[1 + k];
    const B = (r.length - 11) / 2;
    if (B > 0 && !this.binHz) this.binHz = Float32Array.from({ length: B }, (_, i) => this.ui.x.hem_bin_hz(i));
    if (B > 0) { this.feed.before = r.subarray(11, 11 + B); this.feed.after = r.subarray(11 + B); this.bins = B; }
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
    const param = w.p; if (param < 0 || param >= this.ui.n) return;
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
    const param = w.p, b = R4(w.r), on = this.ui.active(param), hot = this.hover === wi;
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
  grMeter(w, dt) {
    const d = R4(w.r);
    const target = Math.min(Math.max(w.ch >= 0 ? this.feed.meters[w.ch] : this.feed.gr, -20), 0);
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
          const on = this.plain(w.p) >= 0.5; let t = w.cap;
          if (w.hi === 'PRESS') { this.button(R4(w.r), t, false, hot, false, TH.teal); break; }
          if (!t) t = on ? 'ON' : 'OFF';
          else { const room = w.r[2] - 12; if (this.tw('Caption', t + '  OFF') <= room) t += on ? '  ON' : '  OFF'; else if (this.tw('Caption', t + ' OFF') <= room) t += on ? ' ON' : ' OFF'; }
          this.button(R4(w.r), t, on, hot, !this.ui.active(w.p), TH.teal); break;
        }
        case K.ChoiceButton: {
          const pi = this.L.params[w.p], lit = Math.round(this.plain(w.p)) === w.ch;
          this.button(R4(w.r), pi.choices ? pi.choices[w.ch] : '', lit, hot, false, TH.teal);
          if (w.cap) this.text('Label', w.cap, w.r[0] + 2, w.r[1] - 14, TH.label, 'left');
          break;
        }
        case K.Stepper: this.stepper(w, wi); break;
        case K.Bypass: this.bypass(w, wi); break;
        case K.CurveDisplay: this.consoleCurve(w); break;
        case K.GrMeter: this.grMeter(w, dt); break;
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
    const moving = () => this.L.widgets.some(w => w.k === K.GrMeter || w.k === K.Readout) || (this.curve && this.feed.after);
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
  hit(x, y) {
    const W = this.L.widgets;
    for (let i = W.length - 1; i >= 0; i--) {
      const w = W[i]; if (!this.shown(w)) continue; const r = R4(w.r);
      if (w.k === K.Knob || w.k === K.Bypass) { const rr = r.w * 0.5 + (w.k === K.Knob ? 10 : 0); if ((x - r.cx) ** 2 + (y - r.cy) ** 2 <= rr * rr) return i; }
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
    let lastDown = { t: 0, i: -1 }, dragV = 0, lastY = 0, pid = null;
    const down = e => {
      const [x, y] = at(e), i = this.hit(x, y); if (i < 0) return;
      e.preventDefault();
      const w = this.L.widgets[i], now = performance.now(), dbl = lastDown.i === i && now - lastDown.t < 350;
      lastDown = { t: now, i };
      switch (w.k) {
        case K.Knob:
          if (dbl) { const p = this.L.params[w.p]; this.ui.set(w.p, p.def); this.onParam && this.onParam(w.p, this.ui.get(w.p)); this.dirty = true; return; }
          this.active = i; dragV = this.ui.norm(w.p); lastY = upOf(e); pid = e.pointerId; cv.setPointerCapture(pid); break;
        case K.Toggle: this.setNorm(w.p, this.plain(w.p) >= 0.5 ? 0 : 1); break;
        case K.ChoiceButton: this.setPlain(w.p, w.ch); break;
        case K.Stepper: this.step(w.p, x < R4(w.r).cx ? -1 : 1); break;
        case K.Bypass: this.on = !this.on; this.onPower && this.onPower(this.on); this.dirty = true; break;
      }
      this.dirty = true;
    };
    const move = e => {
      const [x, y] = at(e);
      if (this.active >= 0 && e.pointerId === pid) {
        const w = this.L.widgets[this.active], p = this.L.params[w.p];
        // the plug-in: 360 plate units for the whole turn (a choice: 40 per step). On a small screen that would be a
        // few millimetres, so the drag never gets shorter than 200 screen pixels.
        let range = 360; if (p.taper === 2) range = Math.min(Math.max(40 * p.max, 60), 360);
        const rangePx = Math.max(range * this.cssPerUnit, p.taper === 2 ? 30 * p.max : 200);
        const k = e.shiftKey ? 0.15 : 1;
        dragV = Math.min(Math.max(dragV + (upOf(e) - lastY) / rangePx * k, 0), 1); lastY = upOf(e);
        this.setNorm(w.p, dragV); return;
      }
      const h = this.hit(x, y); if (h !== this.hover) { this.hover = h; this.dirty = true; }
      cv.style.cursor = h >= 0 ? (this.L.widgets[h].k === K.Knob ? 'ns-resize' : 'pointer') : '';
    };
    const up = e => { if (e.pointerId === pid) { this.active = -1; pid = null; this.dirty = true; } };
    const leave = () => { if (this.active < 0 && this.hover !== -1) { this.hover = -1; this.dirty = true; } };
    const wheel = e => {
      const [x, y] = at(e), i = this.hit(x, y); if (i < 0) return;
      const w = this.L.widgets[i]; if (w.k !== K.Knob && w.k !== K.Stepper) return;
      e.preventDefault();
      const notches = -Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) / 100, 3) || 0;
      if (w.k === K.Knob) this.setNorm(w.p, this.ui.norm(w.p) + notches * 0.02 * (e.shiftKey ? 0.2 : 1));
      else this.step(w.p, notches > 0 ? 1 : -1);
    };
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', leave); cv.addEventListener('wheel', wheel, { passive: false });
    this.unbind = () => { cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); cv.removeEventListener('pointerleave', leave); cv.removeEventListener('wheel', wheel); };
  }
}
