import { G } from '../constants.js';

// Per-shape projection. Prototype uses equirectangular scaled by cos(latitude);
// the real pipeline would use a Lambert azimuthal equal-area projection per shape.
// Passthrough. Historically this did a naive cos(latitude) scaling for raw lon/lat
// shape data, but scripts/prepare_data.py now emits shapes.js with coordinates
// already run through a per-shape equal-area projection (see that file's header).
// The one thing the old version also did -- flipping y, since geographic north-up
// means decreasing y on screen -- still needs to happen; the sign is baked into
// the projection's output convention instead (prepare_data.py's y increases
// northward, so it's negated here to point down for canvas coordinates).
export function project(rings) {
  return rings.map(r => r.map(([x, y]) => [x, -y]));
}
export function fitRings(rings, n, fill) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  rings.forEach(r => r.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
  const w = x1 - x0, h = y1 - y0, s = fill * n / Math.max(w, h);
  const ox = (n - w * s) / 2 - x0 * s, oy = (n - h * s) / 2 - y0 * s;
  return { rings: rings.map(r => r.map(([x, y]) => [x * s + ox, y * s + oy])), aspect: w / h };
}
export function makeCtx(n) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  return c.getContext('2d', { willReadFrequently: true });
}
export function maskFrom(ctx, n) {
  const d = ctx.getImageData(0, 0, n, n).data, m = new Uint8Array(n * n);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}
export function maskStats(m, n) {
  let a = 0, sx = 0, sy = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y * n + x]) { a++; sx += x + .5; sy += y + .5; }
  return { a, cx: a ? sx / a : 0, cy: a ? sy / a : 0 };
}
export function boundary(m, n) {
  const b = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (!m[i]) continue;
    if (x === 0 || y === 0 || x === n - 1 || y === n - 1 || !m[i - 1] || !m[i + 1] || !m[i - n] || !m[i + n]) b.push(i);
  }
  return b;
}
export function distTransform(pts, n) {
  const d = new Float32Array(n * n).fill(1e9);
  for (const i of pts) d[i] = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) {
      v = Math.min(v, d[i - n] + 1);
      if (x > 0) v = Math.min(v, d[i - n - 1] + 1.414);
      if (x < n - 1) v = Math.min(v, d[i - n + 1] + 1.414);
    }
    d[i] = v;
  }
  for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
    const i = y * n + x; let v = d[i];
    if (x < n - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < n - 1) {
      v = Math.min(v, d[i + n] + 1);
      if (x < n - 1) v = Math.min(v, d[i + n + 1] + 1.414);
      if (x > 0) v = Math.min(v, d[i + n - 1] + 1.414);
    }
    d[i] = v;
  }
  return d;
}
export function prepTarget(shape) {
  if (shape._t) return shape._t;
  const fit = fitRings(project(shape.rings), G, 0.78);
  const ctx = makeCtx(G);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  for (const r of fit.rings) { r.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); }
  ctx.fill();
  const mask = maskFrom(ctx, G), st = maskStats(mask, G), bnd = boundary(mask, G);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; const tp = {};
  fit.rings.forEach(r => r.forEach(([x, y]) => {
    if (x < x0) { x0 = x; tp.l = [x, y]; } if (x > x1) { x1 = x; tp.r = [x, y]; }
    if (y < y0) { y0 = y; tp.t = [x, y]; } if (y > y1) { y1 = y; tp.b = [x, y]; }
  }));
  const touch = Object.values(tp).map(([x, y]) => ({ u: (x - x0) / (x1 - x0), v: (y - y0) / (y1 - y0) }));
  return (shape._t = { rings: fit.rings, aspect: fit.aspect, touch, mask, area: st.a, cx: st.cx, cy: st.cy, bnd, dt: distTransform(bnd, G) });
}

