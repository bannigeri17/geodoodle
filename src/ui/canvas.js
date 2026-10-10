import { $, css } from '../lib/dom-helpers.js';
import { G } from '../constants.js';
import { chainStrokes } from '../lib/scoring.js';
import { state } from '../state.js';
import { ui } from './dom.js';

const pad = $('pad'), ctx = pad.getContext('2d');
let cssW = 0, cssH = 0, dpr = 1, activeId = null, activeStroke = null, penSeen = false;

export function resize() {
  const r = pad.getBoundingClientRect();
  cssW = r.width; cssH = r.height;
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  pad.width = Math.round(cssW * dpr); pad.height = Math.round(cssH * dpr);
  redraw();
}
new ResizeObserver(resize).observe(pad);

function addPoint(stroke, ev) {
  const r = pad.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
  const last = stroke[stroke.length - 1];
  if (last && Math.hypot(x - last[0], y - last[1]) < 0.003) return;
  stroke.push([Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}

pad.addEventListener('pointerdown', e => {
  if (state.result || state.summary || !e.isPrimary) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.pointerType === 'pen') penSeen = true;
  if (e.pointerType === 'touch' && penSeen) return;
  e.preventDefault();
  pad.setPointerCapture(e.pointerId);
  activeId = e.pointerId;
  const s = []; addPoint(s, e);
  activeStroke = s;
  state.strokes.push(s);
  ui(); redraw();
});
pad.addEventListener('pointermove', e => {
  if (e.pointerId !== activeId) return;
  const s = activeStroke;
  if (!s) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  (evs.length ? evs : [e]).forEach(ev => addPoint(s, ev));
  redraw();
});
function endStroke(e) {
  if (e.pointerId !== activeId) return;
  activeId = null;
  activeStroke = null;
  try { pad.releasePointerCapture(e.pointerId); } catch (err) {}
  redraw();
}
pad.addEventListener('pointerup', endStroke);
pad.addEventListener('pointercancel', endStroke);
pad.addEventListener('contextmenu', e => e.preventDefault());

function drawStroke(pts, W, H) {
  if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0] * W, pts[0][1] * H, 2.5, 0, 7); ctx.fill(); return; }
  ctx.beginPath(); ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.quadraticCurveTo(pts[i][0] * W, pts[i][1] * H, (pts[i][0] + pts[i + 1][0]) / 2 * W, (pts[i][1] + pts[i + 1][1]) / 2 * H);
  }
  const l = pts[pts.length - 1]; ctx.lineTo(l[0] * W, l[1] * H); ctx.stroke();
}
function drawRingsPath(rings, scale) {
  ctx.beginPath();
  for (const r of rings) { r.forEach(([x, y], i) => i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)); ctx.closePath(); }
}
function drawPartialBorder(rings, x, y, w, h, fraction = 0.25) {
  const points = rings.flat();
  if (!points.length) return [];

  const xs = points.map(([px]) => px);
  const ys = points.map(([, py]) => py);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  if (maxX === minX || maxY === minY) return [];

  const mapped = rings.map(ring => ring.map(([px, py]) => [
    x + ((px - minX) / (maxX - minX)) * w,
    y + ((py - minY) / (maxY - minY)) * h
  ]));

  const perimeter = mapped.reduce((sum, ring) =>
    sum + ring.reduce((length, p, i) => {
      const next = ring[(i + 1) % ring.length];
      return length + Math.hypot(next[0] - p[0], next[1] - p[1]);
    }, 0), 0);

  let remaining = perimeter * fraction;
  const strokes = [];
  ctx.beginPath();

  for (const ring of mapped) {
    if (remaining <= 0 || ring.length < 2) break;

    const first = ring[0];
    const stroke = [[first[0] / cssW, first[1] / cssH]];
    ctx.moveTo(first[0], first[1]);

    for (let i = 0; i < ring.length && remaining > 0; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!length) continue;

      const drawn = Math.min(remaining, length);
      const px = a[0] + (b[0] - a[0]) * drawn / length;
      const py = a[1] + (b[1] - a[1]) * drawn / length;
      ctx.lineTo(px, py);
      stroke.push([px / cssW, py / cssH]);
      remaining -= drawn;
      if (drawn < length) break;
    }

    if (stroke.length > 1) strokes.push(stroke);
  }

  ctx.stroke();
  return strokes;
}
export function redraw() {
  if (state.summary || !state.target) return;
  const W = cssW, H = cssH;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (state.result) {
    const sc = W / G, T = state.target;
    ctx.lineWidth = 2.5; ctx.strokeStyle = css('--true'); ctx.fillStyle = css('--true');
    drawRingsPath(T.rings, sc); ctx.globalAlpha = .22; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = css('--mine'); ctx.fillStyle = css('--mine');
    const rings = state.viewRot ? state.result.asDrawnRings : state.result.userRings;
    drawRingsPath(rings, sc); ctx.globalAlpha = .12; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    return;
  }
  if (state.guide || state.hints >= 1) {
    const a = state.target.aspect;
    let fw = W * .8, fh = fw / a;
    if (fh > H * .8) { fh = H * .8; fw = fh * a; }
    const fx = (W - fw) / 2, fy = (H - fh) / 2;

    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = css('--true');
    ctx.strokeRect(fx, fy, fw, fh);
    ctx.restore();

    if (state.hints >= 2) {
      ctx.fillStyle = css('--true');
      state.target.touch.forEach(t => {
        ctx.beginPath();
        ctx.arc(fx + t.u * fw, fy + t.v * fh, 6, 0, 7);
        ctx.fill();
      });
    }

    if (state.hints >= 3) {
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = css('--true');

      const revealed = drawPartialBorder(state.target.rings, fx, fy, fw, fh, 0.25);
      if (revealed.length && !state.strokes.includes(hintedBorderStrokes[0])) {
        hintedBorderStrokes = revealed;
        state.strokes.push(...revealed);
      }

      ctx.restore();
    }
  }
  const settled = activeStroke
    ? state.strokes.filter(stroke => stroke !== activeStroke)
    : state.strokes;
  ctx.fillStyle = css('--ink'); ctx.globalAlpha = .07;
  chainStrokes(settled).filter(c => c.length >= 3).forEach(c => {
    ctx.beginPath(); c.forEach(([x, y], i) => i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)); ctx.closePath(); ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.strokeStyle = css('--ink'); ctx.fillStyle = css('--ink'); ctx.lineWidth = 4;
  state.strokes.forEach(s => drawStroke(s, W, H));
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);

let hintedBorderStrokes = [];

