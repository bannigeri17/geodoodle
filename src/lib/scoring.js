import { G, S, JOIN, ROT_FREE, ROT_PENALTY_PER_DEG } from '../constants.js';
import { makeCtx, maskFrom, maskStats, boundary, distTransform } from './geometry.js';

export function fillStroke(ctx, s, size) {
  ctx.beginPath();
  s.forEach(([x, y], i) => i ? ctx.lineTo(x * size, y * size) : ctx.moveTo(x * size, y * size));
  ctx.closePath();
  ctx.fill();
}
export function chainStrokes(strokes) {
  const chains = strokes.filter(s => s.length >= 2).map(s => s.slice());
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const isClosed = c => d(c[0], c[c.length - 1]) < JOIN;
  for (;;) {
    let best = null;
    for (let i = 0; i < chains.length; i++) {
      if (isClosed(chains[i])) continue;
      for (let j = i + 1; j < chains.length; j++) {
        if (isClosed(chains[j])) continue;
        const a = chains[i], b = chains[j];
        const A0 = a[0], A1 = a[a.length - 1], B0 = b[0], B1 = b[b.length - 1];
        [[A1, B0, 0], [A1, B1, 1], [A0, B0, 2], [A0, B1, 3]].forEach(([p, q, t]) => {
          const dist = d(p, q);
          if (dist < JOIN && (!best || dist < best.dist)) best = { dist, i, j, t };
        });
      }
    }
    if (!best) break;
    const a = chains[best.i], b = chains[best.j];
    chains[best.i] = best.t === 0 ? a.concat(b)
                   : best.t === 1 ? a.concat(b.slice().reverse())
                   : best.t === 2 ? a.slice().reverse().concat(b)
                   : b.concat(a);
    chains.splice(best.j, 1);
  }
  return chains;
}
export function scoreChains(valid, T, fast) {
  const c0 = makeCtx(S); c0.fillStyle = '#000';
  valid.forEach(s => fillStroke(c0, s, S));
  const st = maskStats(maskFrom(c0, S), S);
  if (st.a < S * S * 0.004) return { error: 'Draw a larger, closed outline, then score it.' };

  const k = Math.sqrt(T.area / st.a);
  const cx = makeCtx(G);
  const render = (sc, dx, dy) => {
    const kk = k * sc, tx = T.cx + dx - kk * st.cx, ty = T.cy + dy - kk * st.cy;
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, G, G);
    cx.setTransform(kk, 0, 0, kk, tx, ty); cx.fillStyle = '#000';
    valid.forEach(s => fillStroke(cx, s, S));
    return { mask: maskFrom(cx, G), kk, tx, ty };
  };
  const iou = m => {
    let i = 0, u = 0;
    for (let p = 0; p < m.length; p++) { const a = m[p], b = T.mask[p]; if (a & b) i++; if (a | b) u++; }
    return u ? i / u : 0;
  };
  if (fast) return { iou: iou(render(1, 0, 0).mask) };

  let best = null;
  for (const sc of [0.9, 0.95, 1, 1.05, 1.1]) for (let dx = -6; dx <= 6; dx += 2) for (let dy = -6; dy <= 6; dy += 2) {
    const r = render(sc, dx, dy), v = iou(r.mask);
    if (!best || v > best.iou) best = { ...r, iou: v };
  }

  const ub = boundary(best.mask, G), ud = distTransform(ub, G);
  let s1 = 0, s2 = 0;
  for (const i of ub) s1 += T.dt[i];
  for (const i of T.bnd) s2 += ud[i];
  const avg = (s1 / ub.length + s2 / T.bnd.length) / 2;   // mean contour distance in grid px
  const chamfer = Math.max(0, 1 - avg / 16);              // was /12: more forgiving of a wobbly contour
  const raw = 0.6 * best.iou + 0.4 * chamfer;
  const base = Math.round(Math.min(1, Math.max(0, (raw - 0.28) / 0.72)) * 100); // was 0.35/0.65
  const userRings = valid.map(s => s.map(([x, y]) => [x * S * best.kk + best.tx, y * S * best.kk + best.ty]));
  return { iou: best.iou, chamfer, avg, raw, base, userRings };
}
export function rotateChains(chains, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const rot = chains.map(ch => ch.map(([x, y]) => { const dx = x - .5, dy = y - .5; return [dx * c - dy * s, dx * s + dy * c]; }));
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  rot.forEach(ch => ch.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
  const k = 0.8 / Math.max(x1 - x0, y1 - y0, 1e-6), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return rot.map(ch => ch.map(([x, y]) => [.5 + (x - mx) * k, .5 + (y - my) * k]));
}
// Rotation tolerance: search +/-45 degrees for the best-scoring tilt (coarse, then refined to
// 1 degree). Tilts up to ROT_FREE degrees are fully forgiven and simply used as the official
// score. Beyond that, a mild per-degree penalty applies, but the drawing is never scored worse
// than it would be at 0 degrees, and never below what the rotation search found minus that
// penalty, so orientation still matters without punishing an honestly-drawn-but-tilted map.
export function scoreDrawing(strokes, T) {
  const valid = chainStrokes(strokes).filter(s => s.length >= 3);
  const zero = scoreChains(valid, T, false);
  if (zero.error) return zero;
  const fastAt = a => scoreChains(rotateChains(valid, a), T, true).iou;
  let bestA = 0, bestV = -1;
  for (let a = -45; a <= 45; a += 5) { const v = fastAt(a); if (v > bestV) { bestV = v; bestA = a; } }
  const c0 = bestA;
  for (let a = c0 - 4; a <= c0 + 4; a++) { const v = fastAt(a); if (v > bestV) { bestV = v; bestA = a; } }

  let res = zero; res.angleUsed = 0; res.rotApplied = false; res.asDrawnRings = zero.userRings;
  if (bestA !== 0) {
    const rr = scoreChains(rotateChains(valid, bestA), T, false);
    if (!rr.error) {
      const penalty = Math.round(Math.max(0, Math.abs(bestA) - ROT_FREE) * ROT_PENALTY_PER_DEG);
      const adjBase = Math.max(zero.base, rr.base - penalty);
      if (adjBase > zero.base) {
        // userRings is the straightened drawing (what was actually scored); asDrawnRings keeps
        // the untouched original so the "Show as drawn" toggle has something real to reveal.
        res = { ...rr, base: adjBase, angleUsed: bestA, rotApplied: true, rotPenalty: penalty, asDrawnRings: zero.userRings };
      }
    }
  }
  return res;
}

