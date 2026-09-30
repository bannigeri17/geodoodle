import { STORE_KEY, ROUND_COUNT } from '../constants.js';
import { dateKey } from './dom-helpers.js';

// store.daily[dateKey:mode] = { results: [{score, hints}, ...] }
// store.prefs = { guide: boolean }
export let store = { daily: {}, prefs: {} };
try {
  const raw = JSON.parse(localStorage.getItem(STORE_KEY));
  if (raw && raw.daily) store = raw;
} catch (e) { /* empty or corrupt storage is fine, fall back to defaults */ }

export function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* storage may be full or disabled */ }
}

export function computeStats() {
  const days = new Set(); let total = 0, count = 0;
  for (const k in store.daily) {
    const d = store.daily[k]; if (!d.results) continue;
    days.add(k.split(':')[0]); total += d.results.reduce((s, r) => s + r.score, 0); count++;
  }
  let streak = 0; const d = new Date();
  if (!days.has(dateKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dateKey(d))) { streak++; d.setDate(d.getDate() - 1); }
  return { streak, count, avg: count ? Math.round(total / count / ROUND_COUNT) : 0 };
}
