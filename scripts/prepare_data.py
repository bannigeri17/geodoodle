#!/usr/bin/env python3
"""
Build src/data/shapes.js from real boundary data.

Recommended sources:
  - Countries: Natural Earth (https://www.naturalearthdata.com/), e.g. the
    110m or 50m "Admin 0 - Countries" GeoJSON.
  - US states: the Census Bureau's cartographic boundary files
    (https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html),
    converted to GeoJSON.

This script also accepts any GeoJSON FeatureCollection whose features have a
`properties.name` and a Polygon/MultiPolygon geometry -- for a quick end-to-end
test without downloading Natural Earth or Census files yourself, two
GitHub-hosted mirrors work as drop-in input:
  Countries: https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json
  US states: https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json
These are fine for prototyping; swap in Natural Earth / Census data for anything
you intend to ship, since the mirrors above aren't guaranteed to stay updated,
licensed for redistribution, or geometrically precise.

What it does, per included shape:
  1. Picks a center point (bounding-box midpoint) and builds a one-off Lambert
     Azimuthal Equal-Area projection centered there, so each shape is measured
     in its own locally-accurate projection rather than one global projection
     (which would distort Chile as much as Nigeria).
  2. Reprojects the shape's rings into that projection (kilometers).
  3. Drops slivers (rings under MIN_RING_AREA_FRAC of the main ring's area) and
     caps the remaining rings at MAX_RINGS, largest first, so a handful of real
     islands survive but not every offshore rock.
  4. Simplifies each ring to a target point budget with shapely's
     Douglas-Peucker implementation.
  5. Finds the neighbor with the longest shared border (via a small buffer,
     since exact-touching in raw lon/lat rarely happens cleanly), falling back
     to nearest-by-centroid for island nations/states, and phrases a one-line
     hint with a compass direction.
  6. Looks up a region/subregion label from a small hand-maintained table.

Output: a shapes.js with the same exported shape (name/region/neighbor/rings),
but with rings in projected kilometers instead of lon/lat -- see the comment
this script writes at the top of shapes.js for exactly what changed and why.

Usage:
  python3 prepare_data.py \
    --countries path/or/url/to/countries.geojson \
    --states    path/or/url/to/us-states.geojson \
    --out ../src/data/shapes.js

Run with --help for all options, and --report to print a point/ring summary
without writing anything (useful while tuning the curated lists below).
"""
import argparse
import json
import math
import sys
import urllib.request
from pathlib import Path

from pyproj import Transformer, CRS
from shapely.geometry import shape as shapely_shape
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import transform as shapely_transform

# --------------------------------------------------------------------------
# Which countries are in the game at all: the 193 United Nations member
# states, current as of this writing (unchanged since South Sudan's admission
# in 2011 -- see en.wikipedia.org/wiki/Enlargement_of_the_United_Nations).
#
# This line is deliberately arbitrary and deliberately documented as such.
# There is no neutral, view-from-nowhere answer to "which places are
# countries" -- every possible source (UN membership, ISO 3166-1, a specific
# government's recognition list, Natural Earth's own "sovereignty" field)
# encodes a political position, because sovereignty disputes are the subject,
# not a data-quality problem to clean up. UN membership is used here because
# it's a single public, checkable list with a precise admission process,
# not because full UN membership is "correct" and every other status is
# "incorrect." Swap this list for a different standard if a different line
# suits the project better -- the point is that whichever line gets used
# should be a visible, named policy, not an accident of which entries
# happened to make it into somebody's curated list.
#
# Two different things fall out of "UN member states only," and it's worth
# not conflating them:
#   1. Places with contested sovereignty that aren't seated at the UN:
#      Taiwan, Kosovo, Western Sahara, Northern Cyprus, Somaliland, the West
#      Bank/Gaza (Palestine holds UN *observer* status, not full membership).
#      These are excluded because their status is genuinely disputed, which
#      is exactly the case this policy exists to have an answer for.
#   2. Non-sovereign dependencies that aren't disputed so much as just not
#      sovereign: Greenland, Bermuda, Puerto Rico, French Guiana, the
#      Falkland Islands, New Caledonia. These get excluded as a side effect
#      of the same rule, not because anyone disputes what they are.
# A project that wants either category handled differently (e.g. drawing
# Greenland despite it not being independent, or taking a position on a
# specific dispute) should add it explicitly via EXTRA_COUNTRIES below,
# with a comment saying why -- rather than editing the UN list itself.
UN_MEMBER_STATES = {
    "Africa": ["Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi",
        "Cabo Verde", "Cameroon", "Central African Republic", "Chad", "Comoros",
        "Democratic Republic of the Congo", "Republic of the Congo", "Djibouti", "Egypt",
        "Equatorial Guinea", "Eritrea", "Eswatini", "Ethiopia", "Gabon", "Gambia", "Ghana",
        "Guinea", "Guinea-Bissau", "Ivory Coast", "Kenya", "Lesotho", "Liberia", "Libya",
        "Madagascar", "Malawi", "Mali", "Mauritania", "Mauritius", "Morocco", "Mozambique",
        "Namibia", "Niger", "Nigeria", "Rwanda", "Sao Tome and Principe", "Senegal",
        "Seychelles", "Sierra Leone", "Somalia", "South Africa", "South Sudan", "Sudan",
        "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia", "Zimbabwe"],
    "Asia": ["Afghanistan", "Armenia", "Azerbaijan", "Bahrain", "Bangladesh", "Bhutan",
        "Brunei", "Cambodia", "China", "Cyprus", "Georgia", "India", "Indonesia", "Iran",
        "Iraq", "Israel", "Japan", "Jordan", "Kazakhstan", "Kuwait", "Kyrgyzstan", "Laos",
        "Lebanon", "Malaysia", "Maldives", "Mongolia", "Myanmar", "Nepal", "North Korea",
        "Oman", "Pakistan", "Philippines", "Qatar", "Saudi Arabia", "Singapore",
        "South Korea", "Sri Lanka", "Syria", "Tajikistan", "Thailand", "Timor-Leste",
        "Turkey", "Turkmenistan", "United Arab Emirates", "Uzbekistan", "Vietnam", "Yemen"],
    "Europe": ["Albania", "Andorra", "Austria", "Belarus", "Belgium", "Bosnia and Herzegovina",
        "Bulgaria", "Croatia", "Czech Republic", "Denmark", "Estonia", "Finland", "France",
        "Germany", "Greece", "Hungary", "Iceland", "Ireland", "Italy", "Latvia",
        "Liechtenstein", "Lithuania", "Luxembourg", "Malta", "Moldova", "Monaco",
        "Montenegro", "Netherlands", "North Macedonia", "Norway", "Poland", "Portugal",
        "Romania", "Russia", "San Marino", "Serbia", "Slovakia", "Slovenia", "Spain",
        "Sweden", "Switzerland", "Ukraine", "United Kingdom"],
    "North America": ["Antigua and Barbuda", "Bahamas", "Barbados", "Belize", "Canada",
        "Costa Rica", "Cuba", "Dominica", "Dominican Republic", "El Salvador", "Grenada",
        "Guatemala", "Haiti", "Honduras", "Jamaica", "Mexico", "Nicaragua", "Panama",
        "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines",
        "Trinidad and Tobago", "United States"],
    "South America": ["Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador",
        "Guyana", "Paraguay", "Peru", "Suriname", "Uruguay", "Venezuela"],
    "Oceania": ["Australia", "Fiji", "Kiribati", "Marshall Islands", "Micronesia", "Nauru",
        "New Zealand", "Palau", "Papua New Guinea", "Samoa", "Solomon Islands", "Tonga",
        "Tuvalu", "Vanuatu"],
}

# Add or remove names here to depart from the UN-membership line -- keep the
# comment explaining why, since that's the whole point of naming the policy.
EXTRA_COUNTRIES = []  # e.g. ["Taiwan"]  # -- reason goes here, and update the region map below

# Every UN-member source-dataset alias goes here: {name the source data uses:
# canonical UN name}. Different GeoJSON sources spell the same country
# differently (old names, hyphenation, "Republic of X" vs "X"); this is where
# that gets normalized, rather than in the UN list above, so UN_MEMBER_STATES
# stays a clean statement of policy and this stays a clean statement of one
# dataset's naming quirks. Rerunning against a different source will likely
# need a different (probably shorter) alias table -- run with --report first
# and check the "not found" list it prints.
NAME_ALIASES = {
    "The Bahamas": "Bahamas",
    "United States of America": "United States",
    "United Republic of Tanzania": "Tanzania",
    "East Timor": "Timor-Leste",
    "Guinea Bissau": "Guinea-Bissau",
    "Swaziland": "Eswatini",
    "Macedonia": "North Macedonia",
    "Republic of Serbia": "Serbia",
}

# Purely cosmetic: shorten a canonical name for display, independent of the
# matching logic above.
DISPLAY_NAME_OVERRIDES = {
    "Democratic Republic of the Congo": "DR Congo",
    "Republic of the Congo": "Congo",
}

CURATED_COUNTRIES = sorted({n for names in UN_MEMBER_STATES.values() for n in names} | set(EXTRA_COUNTRIES))
COUNTRY_REGION = {n: region for region, names in UN_MEMBER_STATES.items() for n in names}

US_EXCLUDE = {"Puerto Rico", "District of Columbia"}  # drawable but arguably not "states"; drop or keep as you like
US_REGION = {
    "Connecticut": "Northeast", "Maine": "Northeast", "Massachusetts": "Northeast",
    "New Hampshire": "Northeast", "Rhode Island": "Northeast", "Vermont": "Northeast",
    "New Jersey": "Northeast", "New York": "Northeast", "Pennsylvania": "Northeast",
    "Illinois": "Midwest", "Indiana": "Midwest", "Michigan": "Midwest", "Ohio": "Midwest",
    "Wisconsin": "Midwest", "Iowa": "Midwest", "Kansas": "Midwest", "Minnesota": "Midwest",
    "Missouri": "Midwest", "Nebraska": "Midwest", "North Dakota": "Midwest", "South Dakota": "Midwest",
    "Delaware": "South", "Florida": "South", "Georgia": "South", "Maryland": "South",
    "North Carolina": "South", "South Carolina": "South", "Virginia": "South",
    "District of Columbia": "South", "West Virginia": "South", "Alabama": "South",
    "Kentucky": "South", "Mississippi": "South", "Tennessee": "South", "Arkansas": "South",
    "Louisiana": "South", "Oklahoma": "South", "Texas": "South",
    "Arizona": "West", "Colorado": "West", "Idaho": "West", "Montana": "West",
    "Nevada": "West", "New Mexico": "West", "Utah": "West", "Wyoming": "West",
    "Alaska": "West", "California": "West", "Hawaii": "West", "Oregon": "West",
    "Washington": "West",
}

# --------------------------------------------------------------------------
# Tunables
# --------------------------------------------------------------------------
MAIN_RING_POINTS = 220     # target vertex count for a shape's largest ring
MINOR_RING_POINTS = 60     # target vertex count for secondary islands, etc.
MAX_RINGS = 4              # keep at most this many rings per shape (largest first)
MIN_RING_AREA_FRAC = 0.01  # drop rings smaller than this fraction of the main ring's area
NEIGHBOR_BUFFER_DEG = 0.08  # ~9km at the equator; how close two shapes' edges must be to touch


def fetch_geojson(path_or_url):
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        with urllib.request.urlopen(path_or_url) as r:
            return json.load(r)
    return json.loads(Path(path_or_url).read_text())


def bbox_center(geom):
    """Area centroid, correcting for antimeridian wraparound.

    Two separate reasons this isn't just `geom.centroid`:

    1. Russia's raw lon/lat bounds are (-180, ..., 180, ...) because it's
       stored as pieces on both sides of the dateline; a naive centroid lands
       near longitude 0 -- off the coast of Norway, nowhere near Russia --
       which quietly wrecks two things at once: the per-shape projection ends
       up centered over the North Sea (badly distorting Russia's own outline),
       and neighbor search sees that bogus center as suspiciously close to
       Western Europe (an earlier version of this script reported "the UK's
       nearest neighbor is Russia"). Shifting negative longitudes by 360 first
       stitches the geometry into one contiguous span before centering.
    2. An earlier version used the bounding-box midpoint rather than the area
       centroid, which pulls the "center" of an elongated or irregular country
       toward empty space at the edge of its bounding box -- e.g. France's
       bbox midpoint sits south near Lyon, which made Germany's bbox midpoint
       register as closer to the UK than France's actually is. The area
       centroid tracks the country's real geographic middle instead.
    """
    minx, maxx = geom.bounds[0], geom.bounds[2]
    if maxx - minx > 180:
        shifted = shapely_transform(lambda x, y: (x + 360 if x < 0 else x, y), geom)
        c = shifted.centroid
        cx = c.x - 360 if c.x > 180 else c.x
        return cx, c.y
    c = geom.centroid
    return c.x, c.y


def laea_transformer(lon0, lat0):
    crs = CRS.from_proj4(f"+proj=laea +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=km +no_defs")
    return Transformer.from_crs("EPSG:4326", crs, always_xy=True)


def polygons_of(geom):
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return []


def simplify_to_budget(poly, target_points):
    """Binary-search a simplify tolerance (in km, since geometry is already
    projected) that gets a ring's exterior close to target_points vertices."""
    ring = poly.exterior
    if len(ring.coords) <= target_points:
        return list(ring.coords)
    lo, hi = 0.01, 500.0
    best = list(ring.coords)
    for _ in range(25):
        mid = (lo + hi) / 2
        simplified = poly.simplify(mid, preserve_topology=True)
        pts = list(simplified.exterior.coords) if simplified.exterior else []
        if len(pts) > target_points:
            lo = mid
        else:
            hi = mid
            best = pts
        if abs(len(pts) - target_points) <= 3:
            best = pts
            break
    return best


def compass(dx, dy):
    ang = (math.degrees(math.atan2(dx, dy)) + 360) % 360
    dirs = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
    return dirs[round(ang / 45) % 8]


def build_entries(features, name_key, curated, region_map, exclude=frozenset()):
    """features: list of (name, shapely geometry) in raw lon/lat."""
    by_name = {n: g for n, g in features}
    entries = []
    skipped = []
    for name in curated or list(by_name.keys()):
        if name in exclude:
            continue
        geom = by_name.get(name)
        if geom is None:
            skipped.append(name)
            continue
        entries.append((name, geom))
    if skipped:
        print(f"  (not found in source data, skipped: {', '.join(skipped)})", file=sys.stderr)
    return entries, by_name


def project_and_simplify(name, geom):
    lon0, lat0 = bbox_center(geom)
    tf = laea_transformer(lon0, lat0)
    proj_geom = shapely_transform(lambda x, y: tf.transform(x, y), geom)
    polys = sorted(polygons_of(proj_geom), key=lambda p: p.area, reverse=True)
    if not polys:
        return None
    main_area = polys[0].area
    kept = [p for p in polys if p.area >= main_area * MIN_RING_AREA_FRAC][:MAX_RINGS]
    rings = []
    for i, p in enumerate(kept):
        budget = MAIN_RING_POINTS if i == 0 else MINOR_RING_POINTS
        pts = simplify_to_budget(p, budget)
        rings.append([[round(x, 2), round(y, 2)] for x, y in pts])
    return rings


def find_neighbor(name, geom, all_geoms):
    """Longest-shared-border neighbor within NEIGHBOR_BUFFER_DEG, else nearest by centroid.

    Deliberately done in raw lon/lat, NOT through a per-shape LAEA projection: a
    projection centered on `geom` badly distorts shapes on the far side of the
    globe, and an early version of this function used exactly that and produced
    nonsense like "Peru borders Vietnam". Plain-degree buffering is topologically
    honest at the cost of being metrically approximate near the poles, which is
    a fine trade for a one-line hint. Note this only searches the curated set
    passed in via all_geoms, so a real-world neighbor that wasn't curated in
    (e.g. Nigeria's actual neighbors Niger/Chad/Cameroon, none of which are in
    CURATED_COUNTRIES) won't be found, and the nearest *curated* country is used
    as a fallback instead -- expect a few fallback answers to look a little
    distant until the curated list grows.
    """
    me_buf = geom.buffer(NEIGHBOR_BUFFER_DEG)
    mx, my = bbox_center(geom)
    best_touch, best_len = None, 0.0
    best_near, best_dist = None, float("inf")
    lat_correction = max(math.cos(math.radians(my)), 0.15)  # rough longitude-degree correction
    for other_name, other_geom in all_geoms:
        if other_name == name:
            continue
        shared = me_buf.intersection(other_geom.buffer(NEIGHBOR_BUFFER_DEG))
        shared_len = shared.length if not shared.is_empty else 0.0
        if shared_len > best_len:
            best_len, best_touch = shared_len, (other_name, other_geom)
        ox, oy = bbox_center(other_geom)
        d = math.hypot((ox - mx) * lat_correction, oy - my)
        if d < best_dist:
            best_dist, best_near = d, (other_name, other_geom)
    if best_touch:
        oname, ogeom = best_touch
        ox, oy = bbox_center(ogeom)
        dirn = compass((ox - mx) * lat_correction, oy - my)
        return f"It borders {display_name(oname)} to the {dirn}."
    if best_near:
        oname, ogeom = best_near
        return f"It has no land borders. Its nearest neighbor is {display_name(oname)}."
    return "It has no immediate neighbors in this data set."


def display_name(name):
    return DISPLAY_NAME_OVERRIDES.get(name, name)


def build_mode(features, curated, region_map, label, exclude=frozenset()):
    print(f"Building {label} ({len(curated) if curated else len(features)} requested)...", file=sys.stderr)
    entries, by_name = build_entries(features, "name", curated, region_map, exclude)
    all_geoms = entries  # neighbor search only among the curated set, which is fine for hints
    shapes = []
    for name, geom in entries:
        rings = project_and_simplify(name, geom)
        if not rings:
            print(f"  ! {name}: no usable geometry, skipped", file=sys.stderr)
            continue
        neighbor = find_neighbor(name, geom, all_geoms)
        region = region_map.get(name, "")
        shapes.append({
            "name": display_name(name),
            "region": region,
            "neighbor": neighbor,
            "rings": rings,
        })
        total_pts = sum(len(r) for r in rings)
        print(f"  {display_name(name):<28} {len(rings)} ring(s), {total_pts} pts  -- {neighbor}", file=sys.stderr)
    return shapes


def load_features(geojson):
    out = []
    for f in geojson["features"]:
        name = f.get("properties", {}).get("name")
        geom = f.get("geometry")
        if not name or not geom:
            continue
        name = NAME_ALIASES.get(name, name)  # normalize this source's spelling to the canonical name
        try:
            out.append((name, shapely_shape(geom)))
        except Exception:
            continue
    return out


def to_js(world_shapes, us_shapes):
    def ring_js(rings):
        return "[" + ",".join(
            "[" + ",".join(f"[{x},{y}]" for x, y in ring) + "]" for ring in rings
        ) + "]"

    def entry_js(s):
        return (
            "    { name: " + json.dumps(s["name"]) +
            ", region: " + json.dumps(s["region"]) +
            ", neighbor: " + json.dumps(s["neighbor"]) +
            ", rings: " + ring_js(s["rings"]) + " }"
        )

    header = """// Reference shapes, generated by scripts/prepare_data.py -- do not hand-edit.
// Regenerate with: python3 scripts/prepare_data.py --countries <src> --states <src>
//
// Unlike the original hand-drawn prototype data, `rings` here are already
// projected: each shape was reprojected through its own Lambert Azimuthal
// Equal-Area projection (centered on that shape's own bounding-box midpoint)
// before being simplified, so coordinates are in kilometers on a locally-flat
// plane, NOT longitude/latitude. src/lib/geometry.js's `project()` is a
// passthrough for this reason -- do not reintroduce a lon/lat projection step
// without also reverting this file to lon/lat rings.
//
// Shape format:
//   { name: string, region: string, neighbor: string, rings: [[ [x, y], ... ], ...] }
// - rings: one array of [x, y] points (km) per land mass / island, largest
//   first. Only the largest few rings are kept; tiny islets are dropped.
// - region: a short label, shown as the first hint.
// - neighbor: a one-sentence clue computed from real adjacency, shown as the
//   second hint.
"""
    parts = [header, "const SHAPES = {\n  world: [\n"]
    parts.append(",\n".join(entry_js(s) for s in world_shapes))
    parts.append("\n  ],\n  us: [\n")
    parts.append(",\n".join(entry_js(s) for s in us_shapes))
    parts.append("\n  ]\n};\n\nexport { SHAPES };\n")
    return "".join(parts)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--countries", help="Path or URL to a countries GeoJSON (Natural Earth Admin-0, or compatible)")
    ap.add_argument("--states", help="Path or URL to a US states GeoJSON (Census cartographic boundary, or compatible)")
    ap.add_argument("--out", default="../src/data/shapes.js", help="Output path for shapes.js")
    ap.add_argument("--report", action="store_true", help="Print the point/ring summary and exit without writing")
    args = ap.parse_args()

    world_shapes, us_shapes = [], []
    if args.countries:
        feats = load_features(fetch_geojson(args.countries))
        world_shapes = build_mode(feats, CURATED_COUNTRIES, COUNTRY_REGION, "world")
    if args.states:
        feats = load_features(fetch_geojson(args.states))
        curated = [n for n, _ in feats if n not in US_EXCLUDE]
        us_shapes = build_mode(feats, sorted(curated), US_REGION, "us states", exclude=US_EXCLUDE)

    if not world_shapes and not us_shapes:
        print("Nothing to do: pass --countries and/or --states.", file=sys.stderr)
        sys.exit(1)

    if args.report:
        print(f"\nworld: {len(world_shapes)} shapes, us: {len(us_shapes)} shapes", file=sys.stderr)
        return

    js = to_js(world_shapes, us_shapes)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(js)
    print(f"\nWrote {out_path} ({len(world_shapes)} world shapes, {len(us_shapes)} us shapes).", file=sys.stderr)


if __name__ == "__main__":
    main()
