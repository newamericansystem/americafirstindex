# Phase 1 — Step 7: District Boundaries in PostGIS and Zip/Address Lookup

## Goal

Given a zip code (and optionally a street address), resolve a user's U.S. House district,
state senate district, state house district, and county. Boundaries live in PostGIS so the
lookup is fast, private, and consistent with the map.

## Prerequisites

- Step 6 complete.
- `AZURE_MAPS_KEY` present in Key Vault (created in step 2) and in local `apps/api/.env` for development.

## Key design rules

1. **The map and the lookup must agree.** Congressional districts are loaded from the same GeoJSON files the
   map uses, so a user's district never disagrees with the highlighted district on the map.
2. **Mid-decade redistricting is real.** Several states changed congressional maps between 2024 and 2026.
   The congressional GeoJSON in the repo is the source of truth; updating boundaries is a data operation
   with a runbook (Part G), not an admin-panel feature.
3. **Privacy:** never store or log street addresses. Store only zip, resolved boundary keys, and lookup precision.

## Part A — Boundary data in the repo

- [ ] Move `apps/web/geojson/` to `data/boundaries/cd/` (`git mv`) and update `apps/web/scripts/simplify-geo.js`
      `GEO_DIR` to `../../../data/boundaries/cd` (relative to the script).
- [ ] Add Alaska and Hawaii congressional districts (currently missing):
  - Download the latest Census TIGER/Line congressional district file
    (`https://www2.census.gov/geo/tiger/TIGER{YEAR}/CD/` — list the directory to find the newest year and file name,
    e.g. `tl_{YEAR}_us_cd119.zip`).
  - Write `tools/boundaries/extract-cd.mjs` that reads the shapefile with the `shapefile` npm package, filters
    `STATEFP` `02` and `15`, and writes `data/boundaries/cd/alaska.geojson` and `hawaii.geojson` with
    `properties.NAME` = district number without leading zeros, at-large `00` → `"1"`.
  - **Do not add AK/HI to the map yet**: the map's projection fits lon/lat bounds, so including them would shrink the
    contiguous U.S. Add an explicit `MAP_EXCLUDE = new Set(['alaska', 'hawaii'])` in `simplify-geo.js` and skip those
    files there. Add `alaska: 'AK', hawaii: 'HI'` to `STATE_ABBR` anyway (shared with the loader).
- [ ] `public/geo.json` output must be byte-identical to before this step (verify with a checksum).

## Part B — Schema (`packages/db`)

```ts
export const boundaryType = pgEnum('boundary_type', ['cd', 'sldu', 'sldl', 'county']);

export const boundaries = pgTable('boundaries', {
  id: serial('id').primaryKey(),
  type: boundaryType('type').notNull(),
  state: char('state', { length: 2 }).notNull(),
  key: text('key').notNull(),          // cd: "TX-23"; sldu: "TX-U-14"; sldl: "TX-L-121"; county: "48453" (GEOID)
  code: text('code').notNull(),        // raw district/county code from the source
  name: text('name').notNull(),        // "Texas's 23rd Congressional District", "State Senate District 14", "Travis County"
  vintage: text('vintage').notNull(),  // "repo-geojson@<git sha>" or "tiger2025"
  // geometry column added in custom SQL: geom geometry(MultiPolygon, 4326) NOT NULL
  createdAt: ..., updatedAt: ...,
}, (t) => [uniqueIndex('boundaries_type_key_uq').on(t.type, t.key)]);
```

Custom SQL in the same migration:

```sql
ALTER TABLE boundaries ADD COLUMN geom geometry(MultiPolygon, 4326) NOT NULL;
CREATE INDEX boundaries_geom_gix ON boundaries USING GIST (geom);
CREATE INDEX boundaries_type_state_idx ON boundaries (type, state);
```

```ts
export const zipBoundaries = pgTable('zip_boundaries', {
  zip: char('zip', { length: 5 }).notNull(),
  type: boundaryType('type').notNull(),
  boundaryKey: text('boundary_key').notNull(),
  share: numeric('share', { precision: 5, scale: 4 }).notNull(), // fraction of the ZCTA's land area in this boundary
}, (t) => [primaryKey({ columns: [t.zip, t.type, t.boundaryKey] })]);

export const zipCodes = pgTable('zip_codes', {
  zip: char('zip', { length: 5 }).primaryKey(),
  state: char('state', { length: 2 }).notNull(),   // state containing most of the ZCTA
  // centroid geometry(Point, 4326) added via custom SQL
});
```

## Part C — Loader tool (`tools/boundaries/`)

A Node CLI (`npm run boundaries -- <command>`) with `DATABASE_URL` from env. Commands:

| Command | Source | Notes |
|---|---|---|
| `load-cd` | `data/boundaries/cd/*.geojson` | key = `"{STATE}-{NAME}"`; vintage `repo-geojson@<git sha>`; replaces all `cd` rows in one transaction |
| `load-sld --year YYYY` | TIGER `SLDU/tl_{YEAR}_{FIPS}_sldu.zip` and `SLDL/tl_{YEAR}_{FIPS}_sldl.zip` for each state FIPS | Use `SLDUST`/`SLDLST` for `code`, `NAMELSAD` for `name`; strip leading zeros from numeric codes; keep alphanumeric codes as-is (e.g. NH, VT, MA). Nebraska has no SLDL (unicameral) — skip missing files gracefully. Codes `ZZZ` (undefined areas) are skipped |
| `load-counties --year YYYY` | TIGER `COUNTY/tl_{YEAR}_us_county.zip` | key = `GEOID`; `name` = `NAMELSAD` |
| `build-zips --year YYYY` | TIGER `ZCTA520/tl_{YEAR}_us_zcta520.zip` | See below |
| `verify` | DB | Self-consistency checks (Part F) |

Implementation details:
- Download into `data/raw/` (gitignored — add to `.gitignore`), cache by filename.
- Read shapefiles with the `shapefile` package; insert in batches of 200 with
  `ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($geojson), 4326)), 3))`.
  TIGER files are in NAD83 (EPSG:4269); treat as 4326 (sub-meter difference, acceptable for district lookup).
- `build-zips`:
  1. Load ZCTA polygons into a temporary unlogged table `tmp_zcta(zip, geom)` with a GIST index.
  2. For each boundary type, compute
     `share = ST_Area(ST_Intersection(z.geom, b.geom)::geography) / ST_Area(z.geom::geography)` for intersecting
     pairs, keep shares ≥ 0.005, and insert into `zip_boundaries`. Process state by state to bound memory.
  3. Fill `zip_codes` with `ST_PointOnSurface(z.geom)` and the state with the largest share.
  4. Drop `tmp_zcta`.
  This takes a while for the full country; run it locally against the local DB first, then against dev/prod
  from a machine with a temporary firewall rule (it's a one-time operation per boundary update).
- USPS zip codes and Census ZCTAs differ (PO-box-only zips have no ZCTA). Unknown zips fall back to "please enter your address".

## Part D — Lookup service (`apps/api/src/services/lookup.ts`)

```ts
type Precision = 'address' | 'zip';
interface LookupResult {
  precision: Precision;
  zip: string;
  state: string | null;
  districts: { cd: Boundary | null; sldu: Boundary | null; sldl: Boundary | null; county: Boundary | null };
  candidates: { cd: CandidateShare[]; sldu: CandidateShare[]; sldl: CandidateShare[] }; // populated only for zip precision
  needsAddress: boolean;    // true when cd is ambiguous for a zip lookup, or zip unknown
  warnings: string[];       // e.g. 'zip_mismatch' when the geocoded address is in a different zip
}
```

- `lookupByPoint(lon, lat)`: one query returning the containing boundary of each type:
  `SELECT type, key, name, state FROM boundaries WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1,$2),4326))`.
- `lookupByZip(zip)`: read `zip_boundaries`; for each type pick the top share; a type is **resolved** if its top share ≥ 0.98,
  otherwise leave it null and list candidates. `needsAddress = cd unresolved`.
- `geocode(address, zip)`:
  1. Azure Maps Geocoding: `GET https://atlas.microsoft.com/geocode?api-version=2023-06-01&query=<address, zip>&countryRegion=US&top=1`
     with header `subscription-key: AZURE_MAPS_KEY`. Accept the first feature only if `properties.confidence` is
     `High` or `Medium` and `properties.type` is an address-level match (`Address` or point-level result); take
     `geometry.coordinates` as `[lon, lat]`.
  2. Fallback (no result or Maps error): Census Geocoder
     `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=<...>&benchmark=Public_AR_Current&format=json`,
     first `result.addressMatches[].coordinates` (`x` = lon, `y` = lat).
  3. Timeouts 5 s each. Never log the address (log only success/failure and provider).
- `lookup({ zip, address? })`: address present → geocode → `lookupByPoint` (precision `address`); add `zip_mismatch` warning if
  the geocoded zip differs. Otherwise → `lookupByZip`.

## Part E — API routes and web component

Routes:

| Route | Behavior |
|---|---|
| `GET /v1/lookup/zip/:zip` | `lookupByZip`; `Cache-Control: public, max-age=86400`; validate `^\d{5}$` |
| `POST /v1/lookup` | Body `{ zip, address? }` (address max 200 chars). Rate limit 20/min per IP and 200/day per IP. `Cache-Control: no-store` |
| `GET /v1/boundaries/:type/:key` | Name, state, and simplified GeoJSON (`ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.001), 5)`) for drawing state-legislative districts later; cache 1 day |

Each `Boundary` in responses: `{ type, key, name, state }`. For `cd`, also include the current House member summary
(name, party, bioguideId, final rating) by joining `members` and the current ratings period, to save a round trip.

Web component `apps/web/src/components/DistrictFinder.jsx` (plain JS + CSS):
- Zip input (5 digits) → `GET /v1/lookup/zip/:zip`. If `needsAddress`, reveal a street address field with the note
  "Your zip code spans more than one district. Enter your street address — we use it once to find your district and don't save it."
  → `POST /v1/lookup`.
- If the user prefers not to enter an address, show the candidate districts with their shares ("Most of 78701 is in TX-37") and let them pick.
- Emits `onResolved(result)`.
- On the map page, render it above the map only when `featureFlags.myDistrict` is true; on resolve, call the existing
  `zoomFnRef.current(distKey)` to zoom to and select the district.

## Part F — Verification

Tests (Vitest + PostGIS container with a small fixture: 2–3 states of CD GeoJSON and a handful of synthetic ZCTA squares):
- [ ] For every `cd` row, `ST_PointOnSurface(geom)` looked up via `lookupByPoint` returns that same key.
- [ ] A zip fully inside one district resolves with precision `zip`; a zip split 60/40 returns `needsAddress` and two candidates.
- [ ] Unknown zip → `needsAddress: true`, no districts.
- [ ] Geocoder: mocked Azure Maps success, low-confidence fallback to Census, both failing → 502 `geocoding_unavailable`.
- [ ] Logs captured during tests contain no address strings.

Data verification after loading dev and prod (`npm run boundaries -- verify`):
- [ ] `cd` count = 435 (432 from the map + AK 1 + HI 2); every key in `public/geo.json` exists in `boundaries`.
- [ ] Every current House member's `dist_key` exists as a `cd` boundary (list mismatches — they indicate stale boundaries or data).
- [ ] `sldu` and `sldl` counts per state are plausible (e.g., Texas 31 senate / 150 house; Nebraska 49 senate / 0 house).
- [ ] `zip_codes` count ≈ 33,000; ≥ 85% of zips have a CD share ≥ 0.98.
- [ ] Manual: look up 5 known addresses (ask the human for addresses of offices they know) and confirm the districts.

## Part G — Runbook: updating boundaries after redistricting

Write `docs/runbooks/boundaries.md` containing:
1. Replace the affected state's file in `data/boundaries/cd/` (same `NAME` property convention), open a PR, and confirm
   the map renders correctly in the PR preview.
2. After merge, run `load-cd` and then `build-zips` against dev, run `verify`, then prod.
3. For state legislative changes, run `load-sld --year <new TIGER year>` (or load a state-provided shapefile with a
   `load-sld-file --state XX --chamber upper|lower --file path --code-field F --name-field F` command — add this command now).
4. Re-run `verify`, then trigger the user re-resolution job (step 8 adds `reresolveUsers`) so stored user districts update.

## Acceptance criteria

- [ ] Boundaries (CD, SLDU, SLDL, county) and the zip crosswalk are loaded in dev and prod.
- [ ] `POST /v1/lookup` resolves districts by address with Azure Maps (Census fallback) and by zip with ambiguity handling.
- [ ] The map's `public/geo.json` is unchanged; AK/HI exist in the database.
- [ ] The DistrictFinder works on the map page in dev behind the `myDistrict` flag (flag stays off in prod).
- [ ] Boundary update runbook exists.

## Rollback

Lookup is additive and flag-gated. Reloading boundaries is idempotent per type.
