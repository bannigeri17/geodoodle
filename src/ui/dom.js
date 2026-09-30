import { $, dateKey } from '../lib/dom-helpers.js';
import { HINT_COST, MAX_HINTS, ROT_FREE } from '../constants.js';
import { store, saveStore, computeStats } from '../lib/storage.js';
import { scoreDrawing } from '../lib/scoring.js';
import { state, key, saveSession, clearSession, startPractice, advance, loadRound } from '../state.js';
import { redraw } from './canvas.js';

const el = {
  name: $('name'), ask: $('ask'), date: $('date'), tag: $('practiceTag'), progress: $('progress'),
  promptBox: $('promptBox'), playArea: $('playArea'), tools: $('tools'), undo: $('undo'), clear: $('clear'),
  done: $('done'), guide: $('guide'), hintBtn: $('hintBtn'), hintList: $('hintList'), placeholder: $('placeholder'),
  results: $('results'), scoreNum: $('scoreNum'), verdict: $('verdict'), hintNote: $('hintNote'), rotNote: $('rotNote'), rotToggle: $('rotToggle'),
  mIou: $('mIou'), mIouV: $('mIouV'), mCh: $('mCh'), mChV: $('mChV'), stats: $('stats'), advance: $('advance'),
  summary: $('summary'), summaryLabel: $('summaryLabel'), summaryTotal: $('summaryTotal'), summaryRows: $('summaryRows'), summaryNote: $('summaryNote'),
  share: $('share'), toast: $('toast')
};
const modeBtns = document.querySelectorAll('.seg button');
const modeLabel = m => m === 'us' ? 'state' : 'country';

function verdictFor(s) {
  return s >= 90 ? 'Cartographer level.' : s >= 75 ? 'Very close.' : s >= 55 ? 'Clearly recognizable.' : s >= 30 ? 'Getting there.' : 'A rough start. Try a hint next time.';
}
function hintTexts() {
  return [
    'Region: ' + state.shape.region + '.',
    state.shape.neighbor,
    'Touch points: the dots on the guide box mark where the outline touches each side.'
  ];
}
function renderProgress() {
  if (state.practice) { el.progress.hidden = true; return; }
  el.progress.hidden = false;
  el.progress.innerHTML = '';
  for (let i = 0; i < state.dailySet.length; i++) {
    const d = document.createElement('span'); d.className = 'dot';
    if (i < state.roundResults.length) d.classList.add('done');
    else if (i === state.round && !state.summary) d.classList.add('current');
    el.progress.appendChild(d);
  }
  const lbl = document.createElement('span'); lbl.className = 'lbl';
  lbl.textContent = state.summary ? 'All ' + state.dailySet.length + ' done' : (state.round + 1) + ' of ' + state.dailySet.length;
  el.progress.appendChild(lbl);
}
function renderSummary() {
  el.summaryLabel.textContent = "Today's " + (state.mode === 'us' ? 'US states' : 'World') + ' result';
  const total = state.roundResults.reduce((s, r) => s + r.score, 0), max = state.roundResults.length * 100;
  el.summaryTotal.innerHTML = total + '<span class="of" style="font-size:1.3rem"> / ' + max + '</span>';
  el.summaryRows.innerHTML = '';
  state.roundResults.forEach((r, i) => {
    const row = document.createElement('div'); row.className = 'summary-row';
    row.innerHTML = '<span>' + state.dailySet[i].name + '</span>' +
      '<span class="track"><i class="fill" style="width:' + r.score + '%"></i></span>' +
      '<b>' + r.score + '</b>';
    el.summaryRows.appendChild(row);
  });
  const hintsTotal = state.roundResults.reduce((s, r) => s + (r.hints || 0), 0);
  el.summaryNote.textContent = 'Come back tomorrow for ' + state.dailySet.length + ' new ' + modeLabel(state.mode) + (state.dailySet.length === 1 ? '' : 's') + '.' + (hintsTotal ? ' Hints used: ' + hintsTotal + '.' : '');
}
export function ui() {
  modeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  renderProgress();

  el.summary.hidden = !state.summary;
  el.promptBox.hidden = state.summary;
  el.playArea.hidden = state.summary;
  if (state.summary) {
    renderSummary();
    const st = computeStats();
    el.stats.textContent = st.count ? 'Streak: ' + st.streak + (st.streak === 1 ? ' day' : ' days') + '. Played: ' + st.count + '. Average: ' + st.avg + '/100.' : 'Your streak and average will show up here.';
    return;
  }

  const done = !!state.result;
  el.ask.textContent = state.practice ? 'Draw the outline of' : 'Draw the outline of this ' + modeLabel(state.mode) + ':';
  el.name.textContent = state.shape.name;
  el.date.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  el.tag.hidden = !state.practice;

  el.tools.hidden = done;
  el.guide.setAttribute('aria-pressed', String(state.guide));
  el.guide.textContent = 'Guide box: ' + (state.guide ? 'on' : 'off');
  const empty = !state.strokes.length;
  el.undo.disabled = el.clear.disabled = el.done.disabled = empty;
  el.placeholder.hidden = !empty || done;

  el.hintBtn.hidden = done || state.hints >= MAX_HINTS;
  el.hintBtn.textContent = 'Get hint ' + (state.hints + 1) + ' of ' + MAX_HINTS + ' (\u2212' + HINT_COST + ' points)';
  el.hintList.innerHTML = '';
  hintTexts().slice(0, state.hints).forEach(t => { const li = document.createElement('li'); li.textContent = t; el.hintList.appendChild(li); });

  el.results.hidden = !done;
  if (done) {
    const r = state.result;
    const last = !state.practice && state.round === state.dailySet.length - 1;
    el.advance.textContent = state.practice ? 'Practice another shape' : (last ? 'See today\u2019s result' : 'Next ' + modeLabel(state.mode));
    el.scoreNum.textContent = r.score;
    el.verdict.textContent = verdictFor(r.score);
    el.hintNote.textContent = state.hints ? 'Hints used: ' + state.hints + ' (\u2212' + (state.hints * HINT_COST) + ' points).' : 'No hints used.';
    el.rotToggle.hidden = !r.rotApplied;
    el.rotToggle.textContent = state.viewRot ? 'Show straightened' : 'Show as drawn';
    el.rotNote.textContent = r.rotApplied
      ? 'Your drawing was tilted about ' + Math.abs(r.angleUsed) + '\u00B0. Tilts up to ' + ROT_FREE + '\u00B0 are free' + (r.rotPenalty ? ', so only a small adjustment (\u2212' + r.rotPenalty + ') applied here.' : ', so no adjustment applied here.')
      : 'Your orientation was about right.';
    el.mIouV.textContent = Math.round(r.iou * 100) + '%';
    el.mChV.textContent = Math.round(r.chamfer * 100) + '%';
    el.mIou.style.width = '0'; el.mCh.style.width = '0'; void el.mIou.offsetWidth;
    el.mIou.style.width = Math.round(r.iou * 100) + '%'; el.mCh.style.width = Math.round(r.chamfer * 100) + '%';
  }
  const st = computeStats();
  el.stats.textContent = st.count ? 'Streak: ' + st.streak + (st.streak === 1 ? ' day' : ' days') + '. Played: ' + st.count + '. Average: ' + st.avg + '/100.' : 'Your streak and average will show up here.';
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg; el.toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
}

function submit() {
  const r = scoreDrawing(state.strokes, state.target);
  if (r.error) { toast(r.error); return; }
  r.score = Math.max(0, r.base - HINT_COST * state.hints);
  state.result = r; state.viewRot = false;
  if (!state.practice) {
    state.roundResults = state.roundResults.slice(0, state.round);
    state.roundResults.push({ score: r.score, hints: state.hints });
    store.daily[key()] = { results: state.roundResults };
    if (state.round === state.dailySet.length - 1) clearSession();
    else saveSession();
    saveStore();
  }
  ui(); redraw();
  (state.summary ? el.summary : el.results).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function shareText() {
  const bar = s => s >= 90 ? '\uD83D\uDFE9' : s >= 70 ? '\uD83D\uDFE9' : s >= 45 ? '\uD83D\uDFE8' : '\uD83D\uDFE5';
  if (state.summary) {
    const total = state.roundResults.reduce((s, r) => s + r.score, 0), max = state.roundResults.length * 100;
    const hints = state.roundResults.reduce((s, r) => s + (r.hints || 0), 0);
    return ('Rough Borders ' + dateKey() + ' (' + (state.mode === 'us' ? 'US states' : 'World') + ')\n' +
      state.roundResults.map(r => bar(r.score)).join('') + '  ' + total + '/' + max +
      (hints ? '  ' + '\uD83D\uDCA1'.repeat(hints) : '')).trim();
  }
  const r = state.result;
  return ('Rough Borders practice: ' + state.shape.name + ' \u2014 ' + r.score + '/100').trim();
}
async function share() {
  const text = shareText();
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); return; } catch (e) {}
  try {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); toast('Copied to clipboard');
  } catch (e) { toast('Could not copy. Select the text manually.'); }
}

export function wireEvents() {
  $('undo').addEventListener('click', () => { state.strokes.pop(); ui(); redraw(); });
  $('clear').addEventListener('click', () => { state.strokes = []; ui(); redraw(); });
  $('done').addEventListener('click', submit);
  $('guide').addEventListener('click', () => {
    state.guide = !state.guide;
    store.prefs = store.prefs || {}; store.prefs.guide = state.guide; saveStore();
    ui(); redraw();
  });
  $('hintBtn').addEventListener('click', () => { if (state.hints < MAX_HINTS && !state.result) { state.hints++; ui(); redraw(); } });
  $('rotToggle').addEventListener('click', () => { state.viewRot = !state.viewRot; ui(); redraw(); });
  $('advance').addEventListener('click', advance);
  $('share').addEventListener('click', share);
  $('practiceStart').addEventListener('click', startPractice);
  modeBtns.forEach(b => b.addEventListener('click', () => {
    if (b.dataset.mode === state.mode) return;
    saveSession(); state.mode = b.dataset.mode; state.practice = false; loadRound();
  }));
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !state.result && !state.summary) { e.preventDefault(); state.strokes.pop(); ui(); redraw(); }
  });
  window.addEventListener('beforeunload', saveSession);
}
