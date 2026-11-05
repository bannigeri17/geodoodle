# Rough Borders

A daily map-outline drawing game. Each day serves 5 shapes (countries, or US
states in the other mode) and scores how closely you draw each outline.

## Project structure

```
index.html            Page shell, loads src/styles.css and src/main.js
src/
  main.js             Entry point: wires events, boots the first round
  state.js            Game state, daily round progression, practice mode
  constants.js         Tunable numbers (scoring, hints, rotation tolerance)
  data/
    shapes.js          Reference shapes (name, region, neighbor hint, lon/lat rings)
  lib/
    geometry.js        Projection, rasterizing, target-shape prep
    scoring.js          Stroke joining, IoU + contour scoring, rotation tolerance
    random.js            Seeded RNG, daily shape-set picker
    storage.js            localStorage persistence, streak/stats
    dom-helpers.js         Small shared helpers ($, dateKey, css var reader)
  ui/
    canvas.js           Pointer-event drawing, canvas rendering
    dom.js               Screen rendering, results/summary, button wiring
```

No build step: everything is a plain ES module (`<script type="module">`), loaded
directly by the browser. No bundler, no `node_modules`, no compile step.

## Run it locally

Any static file server works, since the browser needs to fetch `.js` files over
`http://`, not `file://` (ES modules are blocked on the `file:` protocol).

```bash
npm run dev
# or, without npm:
python3 -m http.server 5173
```

Then open `http://localhost:5173`.

## How the game works

- **Daily mode**: 5 shapes per day per mode (World / US states), picked by a seeded
  shuffle in `lib/random.js` so the set is the same for everyone on a given day and
  nothing repeats until the whole pool has been used once.
- **Practice mode**: an unlimited, un-scored-toward-anything single shape, for trying
  the mechanic or a specific country/state.
- **Scoring** (`lib/scoring.js`): your strokes are auto-joined into closed outlines
  (endpoints within ~7% of the canvas width are treated as connected), rasterized,
  and compared to the target shape at the best-fitting scale/offset/rotation.
  The score blends overlap (IoU) and a contour-distance term, with a forgiving
  window (see `ROT_FREE` in `constants.js`) for small unintentional tilts.
- **Hints**: region name, then a neighboring country/state, then a proportion box
  with touch-point markers — each costs points, configurable in `constants.js`.