# Rough Borders

A daily map-outline drawing game. Each day serves 5 shapes (countries, or US
states in the other mode) and scores how closely you draw each outline.

`src/data/shapes.js` currently ships with 56 countries and 50 US states built
by `scripts/prepare_data.py` from real boundary data, with hint text (region +
neighbor) computed from actual adjacency, not hand-written. See **Regenerating
the shape data** below to add more shapes or swap in a different source.

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

## Deploy it

It's a static site, so any static host works with zero configuration:

- **GitHub Pages**: push this repo, then enable Pages on the `main` branch (root).
- **Netlify / Vercel**: import the repo; leave the build command empty and set
  the publish/output directory to the repo root (`.`).
- **Any other static host** (S3, Cloudflare Pages, etc.): upload the folder as-is.

There's no server, database, or API key involved — the whole game runs client-side,
and progress is stored in the browser's `localStorage`.

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

## Regenerating the shape data

`scripts/prepare_data.py` builds `src/data/shapes.js` from real boundary data.

```bash
pip install -r scripts/requirements.txt   # shapely + pyproj only, no GDAL needed
cd scripts
python3 prepare_data.py \
  --countries <path-or-url-to-countries.geojson> \
  --states    <path-or-url-to-us-states.geojson> \
  --out ../src/data/shapes.js
```

**Recommended sources** for anything you ship: [Natural Earth](https://www.naturalearthdata.com/)
(countries, Admin-0) and the [US Census cartographic boundary files](https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html)
(states), both converted to GeoJSON. For quick iteration, two GitHub-hosted
mirrors work as drop-in input and are what the current `shapes.js` was actually
built from:

```
--countries https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json
--states    https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json
```

Swap those for Natural Earth / Census data before relying on this for anything
beyond prototyping — the mirrors aren't guaranteed to stay available, precise,
or licensed for redistribution.

### What the script does, per shape

1. Picks a center point (the shape's area centroid, corrected for antimeridian
   wraparound — Russia's raw longitude bounds span -180 to 180, and a naive
   center calculation for that lands off the coast of Norway) and builds a
   one-off Lambert Azimuthal Equal-Area projection centered there, so each
   shape is measured in its own locally-accurate projection instead of one
   global projection that would distort Chile as much as Nigeria.
2. Reprojects the shape into that projection, in kilometers.
3. Drops slivers and caps ring count, largest first, so a handful of real
   islands survive but not every offshore rock.
4. Simplifies each ring to a target point budget.
5. Finds the neighbor with the longest shared border (searched only within the
   curated list you pass in — a real neighbor left out of the curated list
   won't be found, so it falls back to nearest-by-centroid instead), and
   phrases a one-line hint with a compass direction.
6. Looks up a region label from a small hand-maintained table in the script.

### Which countries are included: the UN-membership policy

`CURATED_COUNTRIES` is no longer a hand-picked list — it's generated from
`UN_MEMBER_STATES`, the 193 current UN member states (unchanged since South
Sudan's admission in 2011), grouped by continent. That grouping does double
duty as the region hint too, so `COUNTRY_REGION` is derived from it rather
than maintained separately.

This line is deliberately arbitrary and deliberately documented as such, and
the full reasoning lives as a comment directly above `UN_MEMBER_STATES` in
`prepare_data.py`. Short version: there's no neutral answer to "which places
are countries," so this project names one specific, checkable standard (UN
full membership) rather than let the answer be an accident of whichever
country a mirror dataset happened to include. Two different things fall out
of that one rule:

- **Contested sovereignty**, not seated at the UN: Taiwan, Kosovo, Western
  Sahara, Northern Cyprus, Somaliland, the West Bank/Gaza (Palestine holds UN
  *observer* status, not full membership). These are the cases the policy
  exists to have an answer for.
- **Non-sovereign dependencies**, swept up by the same rule without their
  status being disputed as such: Greenland, Bermuda, Puerto Rico, French
  Guiana, the Falkland Islands, New Caledonia.

Wanting either category handled differently — drawing Greenland despite it
not being independent, or taking a position on a specific dispute — is a
reasonable thing to want; do it via `EXTRA_COUNTRIES` in the script, with a
comment saying why, rather than editing the UN list itself, so the exception
stays visible instead of quietly reshaping what "the list" means.

US states use a simpler size-based line: all 50, with Puerto Rico and DC
excluded by default via `US_EXCLUDE` (both are drawable; "state" is doing the
filtering there, not a disputed-status question).

### Extending or adjusting the list

Edit `UN_MEMBER_STATES`, `EXTRA_COUNTRIES`, `US_EXCLUDE`, or `US_REGION` near
the top of `prepare_data.py` and rerun. `--report` prints the point/ring/
neighbor summary without writing anything — the fastest way to check a change
before committing to it, and also where to look when a name you expected
didn't make it in: the "not found in source data" line is almost always a
naming mismatch (e.g. this dataset says "The Bahamas", not "Bahamas") that
belongs in `NAME_ALIASES`, not a sign the country was excluded by policy.

### Known limitations worth knowing about before you extend this

- **Neighbor search only sees the curated set.** Now that the curated set is
  ~all UN members, most real neighbors are present and the hints are
  genuinely accurate (Nigeria correctly borders Niger, Namibia correctly
  borders Botswana, and so on). The gap that's left is countries this
  particular mirror dataset doesn't have at all — mostly small island states
  (see the "not found in source data" list from `--report`) — where a
  fallback to nearest-by-centroid among what's actually present is still the
  best available answer, not a full substitute for the missing country.
- **`src/lib/geometry.js`'s `project()` is now a passthrough.** The shape data
  is pre-projected by this script; if you ever hand-edit `shapes.js` with raw
  lon/lat coordinates again (like the original prototype had), scores will be
  silently wrong, since nothing will re-project them. This is exactly the kind
  of stale-assumption bug that's easy to reintroduce, since it was caught here
  because Chile's aspect ratio was flagged by a script check, not a browser
  render.
- **This dataset's US states GeoJSON also includes Puerto Rico and DC.**
  `US_EXCLUDE` drops both by default; remove them from that set if you want
  them in the game.
