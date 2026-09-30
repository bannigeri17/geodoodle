import { SHAPES } from "./data/shapes.js";
import { dateKey, dayNumber } from "./lib/dom-helpers.js";
import { pickDailySet } from "./lib/random.js";
import { prepTarget } from "./lib/geometry.js";
import { store } from "./lib/storage.js";
import { ui } from "./ui/dom.js";
import { redraw } from "./ui/canvas.js";

// A "daily" is ROUND_COUNT shapes played in sequence per mode; practice is a single
// free-standing shape that never counts toward the daily result or its storage.
export const state = {
  guide: !(store.prefs && store.prefs.guide === false),
  mode: "world",
  practice: false,
  practiceShape: null,
  dailySet: [],
  round: 0,
  roundResults: [],
  shape: null,
  target: null,
  strokes: [],
  hints: 0,
  result: null,
  viewRot: false,
  summary: false,
};

export const key = () => dateKey() + ":" + state.mode;
// In-progress work per mode, kept in memory only (this browser tab).
const sessionStrokes = {},
  sessionHints = {},
  sessionRound = {};

export function currentDaily() {
  return store.daily[key()];
}

export function loadRound() {
  state.result = null;
  state.viewRot = false;
  state.summary = false;
  state.strokes = [];
  state.hints = 0;
  if (state.practice) {
    state.shape = state.practiceShape;
  } else {
    state.dailySet = pickDailySet(state.mode, dayNumber());
    const saved = currentDaily();
    if (
      saved &&
      saved.results &&
      saved.results.length >= state.dailySet.length
    ) {
      state.roundResults = saved.results;
      state.summary = true;
      ui();
      redraw();
      return;
    }
    state.roundResults = (saved && saved.results) || [];
    state.round = Math.min(
      state.roundResults.length,
      state.dailySet.length - 1,
    );
    // Resume mid-round strokes if this tab has them.
    if (sessionRound[state.mode] === state.round) {
      state.strokes = sessionStrokes[state.mode] || [];
      state.hints = sessionHints[state.mode] || 0;
    } else {
      state.strokes = [];
      state.hints = 0;
    }
    state.shape = state.dailySet[state.round];
  }
  state.target = prepTarget(state.shape);
  ui();
  redraw();
}

export function saveSession() {
  if (state.practice || state.result) return;
  sessionRound[state.mode] = state.round;
  sessionStrokes[state.mode] = state.strokes;
  sessionHints[state.mode] = state.hints;
}

// Called once a daily's final round is scored, so a reload doesn't try to resume a round
// that's already been folded into the completed result.
export function clearSession(mode = state.mode) {
  sessionRound[mode] = null;
  sessionStrokes[mode] = null;
  sessionHints[mode] = null;
}

export function startPractice() {
  saveSession();
  const list = SHAPES[state.mode];
  let s;
  do {
    s = list[Math.floor(Math.random() * list.length)];
  } while (list.length > 1 && s === state.shape);
  state.practice = true;
  state.practiceShape = s;
  loadRound();
}

export function advance() {
  if (state.practice) {
    startPractice();
    return;
  }
  if (state.round === state.dailySet.length - 1) {
    state.summary = true;
    ui();
    redraw();
    return;
  }
  state.round++;
  // state.strokes = [];
  // state.hints = 0;
  loadRound();
}
