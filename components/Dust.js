'use client';

// Delete disintegration ("dust"): the image erodes from left to right along an organic, noisy front.
// Each grain (1 CSS px at 2x screens) lifts off where the front passes, catches a light highlight,
// is carried up and to the right by a wind with soft swirling turbulence, shrinks and fades.
// The part of the image the front has not reached stays pixel-sharp (drawn from the full-res capture).
//
// dust(mediaEl, onDone): captures what mediaEl shows (object-fit: cover, clipped to the rounded frame),
// hides mediaEl, plays the effect on a fixed overlay canvas, and calls onDone once the image is gone
// (the last grains are still drifting; the overlay removes itself afterwards).

const SWEEP = 820; // ms for the erosion front to cross the image
const JITTER = 90; // ms of random spread per grain (grains leave a little before the front)
const LIFE_MIN = 850;
const LIFE_MAX = 1400;
const MAX_GRAINS = 95000;
const PAD = { left: 40, right: 400, top: 300, bottom: 70 }; // CSS px of room for the drift

let active = 0;

// ---- small value noise (smooth, deterministic per run) ----
function makeNoise() {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = new Float32Array(256);
  for (let i = 0; i < 256; i++) val[i] = Math.random();
  const fade = (t) => t * t * (3 - 2 * t);
  const at = (x, y) => val[perm[perm[x & 255] + (y & 255)]];
  return (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    const fx = fade(x - xi); const fy = fade(y - yi);
    const a = at(xi, yi); const b = at(xi + 1, yi); const c = at(xi, yi + 1); const d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

// The frame that clips the media (rounded card corners), if any.
function clipFrame(el) {
  let n = el.parentElement;
  for (let i = 0; n && i < 4; i++, n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.overflow !== 'visible' && parseFloat(cs.borderTopLeftRadius) > 0) {
      return { rect: n.getBoundingClientRect(), radius: parseFloat(cs.borderTopLeftRadius) };
    }
  }
  return null;
}

export function dust(mediaEl, onDone) {
  let doneCalled = false;
  const done = () => { if (!doneCalled) { doneCalled = true; onDone?.(); } };

  const mr = mediaEl.getBoundingClientRect();
  const frame = clipFrame(mediaEl);
  // Visible area = media rect ∩ clipping frame.
  const L = Math.max(mr.left, frame ? frame.rect.left : -Infinity);
  const T = Math.max(mr.top, frame ? frame.rect.top : -Infinity);
  const R = Math.min(mr.right, frame ? frame.rect.right : Infinity);
  const B = Math.min(mr.bottom, frame ? frame.rect.bottom : Infinity);
  const isImg = mediaEl.tagName === 'IMG';
  const nw = isImg ? mediaEl.naturalWidth : mediaEl.videoWidth;
  const nh = isImg ? mediaEl.naturalHeight : mediaEl.videoHeight;
  if (R - L < 4 || B - T < 4 || !nw || !nh) { done(); return; }

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round((R - L) * dpr); // image size in device px
  const h = Math.round((B - T) * dpr);

  // ---- capture: object-fit cover, clipped to the rounded frame ----
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  if (frame) {
    const r = frame.radius * dpr;
    sctx.beginPath();
    sctx.roundRect((frame.rect.left - L) * dpr, (frame.rect.top - T) * dpr, frame.rect.width * dpr, frame.rect.height * dpr, r);
    sctx.clip();
  }
  const scale = Math.max(mr.width / nw, mr.height / nh);
  const dw = nw * scale; const dh = nh * scale;
  // Start from exactly what is on screen: the CSS filters and opacity of the media and its parents
  // (a tile waiting to be deleted is grey and faded; the dust must not pop back to full colour).
  let filter = ''; let opacity = 1;
  for (let el = mediaEl; el && el !== document.body; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.filter && cs.filter !== 'none') filter = `${cs.filter} ${filter}`;
    opacity *= parseFloat(cs.opacity) || 0;
  }
  if (filter) sctx.filter = filter.trim();
  sctx.globalAlpha = Math.max(0.05, opacity);
  let img;
  try {
    sctx.drawImage(mediaEl, (mr.left - L + (mr.width - dw) / 2) * dpr, (mr.top - T + (mr.height - dh) / 2) * dpr, dw * dpr, dh * dpr);
    img = sctx.getImageData(0, 0, w, h);
  } catch { done(); return; }
  const srcPx = new Uint32Array(img.data.buffer); // little-endian ABGR

  // ---- grains ----
  const crowd = 1 + active * 0.6; // several deletes at once -> coarser grains
  let g = Math.max(1, Math.round(dpr));
  while (((w / g) * (h / g)) * crowd > MAX_GRAINS) g++;
  const gx = Math.ceil(w / g); const gy = Math.ceil(h / g);
  const n0 = gx * gy;

  const ox = new Uint16Array(n0); const oy = new Uint16Array(n0);
  const rel = new Float32Array(n0); const life = new Float32Array(n0); const mass = new Float32Array(n0);
  const col = new Uint32Array(n0); const hot = new Uint32Array(n0);
  const noise = makeNoise();
  const rest = new Uint32Array(srcPx); // the image still in place; released grains are cut out of it
  const clear = (x0, y0) => {
    const x1 = Math.min(w, x0 + g); const y1 = Math.min(h, y0 + g);
    for (let yy = y0; yy < y1; yy++) rest.fill(0, yy * w + x0, yy * w + x1);
  };
  let n = 0;
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const px = Math.min(w - 1, i * g + (g >> 1)); const py = Math.min(h - 1, j * g + (g >> 1));
      const c = srcPx[py * w + px];
      const a = c >>> 24;
      if (a < 24) { clear(i * g, j * g); continue; } // outside the rounded corners: no grain, no leftover edge pixels
      const u = i / gx; const v = j / gy;
      // Front: mostly left -> right, a little bottom -> top, broken up by two octaves of noise.
      const sweep = 0.84 * u + 0.16 * (1 - v);
      const blot = 0.62 * noise(u * 3.4, v * 4.2) + 0.38 * noise(u * 9 + 17, v * 11 + 5);
      rel[n] = (sweep * 0.7 + blot * 0.3) * SWEEP + Math.random() * JITTER;
      life[n] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
      const q = Math.random();
      mass[n] = 0.45 + q * q * 1.6; // most grains light, a few heavy ones lag behind -> streaks, not a blob
      ox[n] = i * g; oy[n] = j * g;
      col[n] = c; // keeps the on-screen alpha
      // Highlight: lift each channel 30 % toward white for the moment the grain breaks off.
      const r = c & 255; const gg = (c >>> 8) & 255; const b = (c >>> 16) & 255;
      hot[n] = ((c & 0xff000000) | ((b + (255 - b) * 0.3) << 16) | ((gg + (255 - gg) * 0.3) << 8) | (r + (255 - r) * 0.3)) >>> 0;
      n++;
    }
  }
  if (!n) { done(); return; }
  // The front starts moving on the first frame (no dead time after the click).
  let relMin = Infinity;
  for (let k = 0; k < n; k++) if (rel[k] < relMin) relMin = rel[k];
  for (let k = 0; k < n; k++) rel[k] -= relMin;

  // Release order: counting sort by release time (2 ms buckets).
  const relMax = SWEEP + JITTER + 1;
  const buckets = new Uint32Array(Math.ceil(relMax / 2) + 1);
  for (let k = 0; k < n; k++) buckets[(rel[k] / 2) | 0]++;
  for (let b = 1; b < buckets.length; b++) buckets[b] += buckets[b - 1];
  const order = new Uint32Array(n);
  for (let k = n - 1; k >= 0; k--) order[--buckets[(rel[k] / 2) | 0]] = k;

  // Moving state (device px, device px per second).
  const x = new Float32Array(n); const y = new Float32Array(n);
  const vx = new Float32Array(n); const vy = new Float32Array(n);
  const gone = new Uint8Array(n);

  // ---- overlay ----
  const pl = PAD.left * dpr; const pt = PAD.top * dpr;
  const CW = w + Math.round((PAD.left + PAD.right) * dpr);
  const CH = h + Math.round((PAD.top + PAD.bottom) * dpr);
  const canvas = document.createElement('canvas');
  canvas.className = 'dust-canvas';
  canvas.width = CW; canvas.height = CH;
  Object.assign(canvas.style, {
    position: 'fixed', zIndex: 60, pointerEvents: 'none',
    left: `${L - PAD.left}px`, top: `${T - PAD.top}px`, width: `${CW / dpr}px`, height: `${CH / dpr}px`,
  });
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(CW, CH);
  const buf = new Uint32Array(out.data.buffer);

  active++;
  let released = 0; // grains released so far (index into order)
  let first = 0; // first index in order that may still be alive
  let last = performance.now();
  const t0 = last;
  let finished = false;

  const cut = (k) => clear(ox[k], oy[k]);

  const draw = (now) => {
    if (finished) return;
    const el = now - t0;
    const dt = Math.min(0.05, (now - last) / 1000); // seconds, clamped after a stall
    last = now;
    const ts = el / 1000;

    // Release grains the front has reached.
    while (released < n && rel[order[released]] <= el) {
      const k = order[released++];
      cut(k);
      x[k] = pl + ox[k]; y[k] = pt + oy[k];
      const m0 = mass[k];
      vx[k] = ((40 + Math.random() * 110) / m0) * dpr;
      vy[k] = ((-20 - Math.random() * 110) / m0) * dpr;
    }

    buf.fill(0);
    // Image still in place.
    for (let yy = 0; yy < h; yy++) buf.set(rest.subarray(yy * w, yy * w + w), (pt + yy) * CW + pl);

    // Flying grains.
    let alive = 0;
    const drag = Math.max(0, 1 - 0.9 * dt);
    for (let o = first; o < released; o++) {
      const k = order[o];
      if (gone[k]) { if (o === first) first++; continue; }
      const age = el - rel[k];
      const u = age / life[k];
      if (u >= 1) { gone[k] = 1; if (o === first) first++; continue; }
      alive++;
      // Wind (up and right, lighter grains go further) + smooth swirling turbulence.
      const cx = x[k] / dpr; const cy = y[k] / dpr;
      const ang = 1.6 * Math.sin(cx * 0.034 + ts * 1.1) + 1.6 * Math.cos(cy * 0.041 - ts * 0.8) + 0.9 * Math.sin((cx + cy) * 0.017 + ts * 0.5);
      const m = mass[k];
      vx[k] = (vx[k] + (230 / m + 220 * Math.cos(ang)) * dpr * dt) * drag;
      vy[k] = (vy[k] + (-210 / m + 220 * Math.sin(ang)) * dpr * dt) * drag;
      x[k] += vx[k] * dt; y[k] += vy[k] * dt;

      const a = u < 0.3 ? 1 : (1 - (u - 0.3) / 0.7) ** 1.8;
      const c = age < 150 ? hot[k] : col[k];
      const px = x[k] | 0; const py = y[k] | 0;
      const s = u < 0.5 ? g : u < 0.8 ? Math.max(1, g - 1) : 1; // grains shrink as they go
      if (px < 0 || py < 0 || px + s > CW || py + s > CH) continue;
      const pc = ((c & 0x00ffffff) | (((a * (c >>> 24)) | 0) << 24)) >>> 0;
      for (let yy = 0; yy < s; yy++) {
        const row = (py + yy) * CW + px;
        for (let xx = 0; xx < s; xx++) buf[row + xx] = pc;
      }
    }
    ctx.putImageData(out, 0, 0);

    // Hand back once the whole image has left; the dust keeps drifting on its own.
    if (released === n && el > relMax + 120) done();
    if (released === n && alive === 0) {
      finished = true; active--; canvas.remove(); done();
      return;
    }
    requestAnimationFrame(draw);
  };

  // First frame drawn synchronously, then the real media is hidden: no flicker at the swap.
  document.body.appendChild(canvas);
  draw(t0);
  mediaEl.style.visibility = 'hidden';
  // Safety: never leave an overlay behind.
  setTimeout(() => { if (!finished) { finished = true; active--; canvas.remove(); done(); } }, SWEEP + JITTER + LIFE_MAX + 1500);
}
