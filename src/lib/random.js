import { SHAPES } from '../data/shapes.js';
import { ROUND_COUNT } from '../constants.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function shuffled(n, seed) {
  const a = Array.from({ length: n }, (_, i) => i), r = mulberry32(seed);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Picks ROUND_COUNT distinct shapes for the day: a seeded shuffle of the whole pool, taken
// ROUND_COUNT at a time, reshuffled once a full pass is exhausted, so nothing repeats within a cycle.
// (With small pools, such as World's current 5, the whole pool is used every day, just reordered.)
export function pickDailySet(mode, dn) {
  const list = SHAPES[mode], n = list.length, take = Math.min(ROUND_COUNT, n);
  const cycle = Math.floor(dn * take / n);
  const order = shuffled(n, cycle * 97 + (mode === 'us' ? 7 : 3));
  const start = (dn * take) % n;
  const idxs = [];
  for (let i = 0; i < take; i++) idxs.push(order[(start + i) % n]);
  return idxs.map(i => list[i]);
}
