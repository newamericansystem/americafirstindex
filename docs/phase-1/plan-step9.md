# Phase 1 — Step 9: "My District" Page — Representatives, State Legislators, Local Officials

## Goal

A signed-in user (or an anonymous visitor who entered a zip code) sees a single page with
everyone who represents them and how they're graded: U.S. House member, both U.S. senators,
endorsed challengers, state senator and state representative, curated local officials, and
upcoming election dates for their state (dates are added in step 10; leave the slot ready).

## Prerequisites

- Step 8 complete (users have resolved `cdKey`, `slduKey`, `sldlKey`, `countyKey`, `state`).

## Part A — State legislators (Open States / Plural Policy)

Data source: Open States publishes current legislators per state as CSV bulk files
(`https://data.openstates.org/people/current/{state}.csv`, lowercase USPS code). Before writing code, download one
(e.g. `tx.csv`), inspect the header row, and map the columns below — **confirm the actual column names** and adjust.
If bulk files are unavailable, use the Open States API v3 `GET https://v3.openstates.org/people?jurisdiction={state}&org_classification={upper|lower}&per_page=50`
with header `X-API-KEY` (store `openstates-api-key` in Key Vault; **HUMAN** registers for a key).

### Schema (`packages/db`)

```ts
export const stateLegislators = pgTable('state_legislators', {
  id: text('id').primaryKey(),                       // Open States person id, e.g. "ocd-person/..."
  state: char('state', { length: 2 }).notNull(),
  chamber: text('chamber').notNull(),                // 'upper' | 'lower' | 'legislature' (NE)
  district: text('district').notNull(),              // as published ("14", "Barnstable-1")
  boundaryKey: text('boundary_key'),                 // "TX-U-14" / "TX-L-121" — matched to boundaries.key
  name: text('name').notNull(),
  party: text('party'),
  email: text('email'),
  phone: text('phone'),                              // capitol voice
  districtPhone: text('district_phone'),
  imageUrl: text('image_url'),
  websiteUrl: text('website_url'),
  isCurrent: boolean('is_current').notNull().default(true),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: ..., updatedAt: ...,
}, (t) => [index('state_leg_boundary_idx').on(t.boundaryKey), index('state_leg_state_idx').on(t.state, t.chamber)]);
```

### Matching districts to boundaries

`boundaryKey` = `"{STATE}-{U|L}-{normalized district}"` where normalization strips leading zeros from numeric codes.
Nebraska's unicameral chamber maps to `U`. Some states use names (New Hampshire, Vermont, Massachusetts) where
TIGER codes differ from Open States names; build `tools/boundaries/sld-name-map.mjs` that, per state, matches by
normalized name first, then by code, and writes unmatched pairs to a report. Store manual overrides in
`data/boundaries/sld-overrides.json` (`{ "NH-L-Hillsborough 37": "NH-L-1037", ... }`) and commit them. The sync job
applies overrides.

### Job

`syncStateLegislators` (timer `0 0 10 * * 1`, weekly on Mondays): for each state, download the CSV, upsert rows,
mark rows not seen as `isCurrent = false` (guard: skip retirement for a state if its file has < 50% of the previous row count),
compute `boundaryKey`, log unmatched districts. Also expose it in the jobs CLI for backfill.

## Part B — Local officials (curated)

There is no reliable free nationwide source, so local officials are entered by staff for the counties the
organization prioritizes.

```ts
export const localOfficials = pgTable('local_officials', {
  id: uuid('id').primaryKey().defaultRandom(),
  state: char('state', { length: 2 }).notNull(),
  countyKey: text('county_key'),                      // county GEOID; null = statewide office
  officeTitle: text('office_title').notNull(),        // "Sheriff", "County Judge", "School Board Trustee, Place 3"
  officeCategory: text('office_category'),            // 'county' | 'city' | 'school_board' | 'judicial' | 'statewide'
  name: text('name').notNull(),
  party: text('party'),
  termEnds: date('term_ends'),
  nextElectionDate: date('next_election_date'),
  websiteUrl: text('website_url'),
  imageUrl: text('image_url'),                        // via media service
  notes: text('notes'),
  sortOrder: integer('sort_order').notNull().default(0),
  status: contentStatus('status').notNull().default('draft'),
  updatedBy: text('updated_by'),
  createdAt: ..., updatedAt: ...,
}, (t) => [index('local_officials_county_idx').on(t.countyKey, t.status), index('local_officials_state_idx').on(t.state, t.status)]);
```

Statewide offices (governor, lieutenant governor, attorney general, secretary of state) also live here with `countyKey = null`
and `officeCategory = 'statewide'`.

Admin (Editor role):
- CRUD routes `/v1/admin/local-officials` (list with `state`/`countyKey` filters, create, patch, publish, archive, photo upload)
  following the step 6 conventions (audit, optimistic concurrency).
- `POST /v1/admin/local-officials/import` — CSV with columns `state,county_fips,office_title,office_category,name,party,term_ends,next_election_date,website_url`
  → preview + create drafts; reuse the step 6 import UI pattern.
- Admin UI page "Local officials": filter by state → county (county list from `boundaries` type `county`), table, edit form, CSV import.

## Part C — "My District" API

`GET /v1/my-district` — for a signed-in user, uses their stored keys. Also supports anonymous use:
`GET /v1/my-district?zip=78701&cdKey=TX-37` (zip required; `cdKey` required only if the zip is ambiguous — otherwise 409
`needs_address` with candidates). Anonymous responses are cacheable for 10 minutes; signed-in responses `private, no-store`.

Response:

```json
{
  "location": { "zip": "78701", "state": "TX", "stateName": "Texas", "precision": "address",
                "districts": { "cd": {"key":"TX-37","name":"..."}, "sldu": {...}, "sldl": {...}, "county": {...} } },
  "federal": {
    "house": { "member": { ...member summary... }, "rating": { "final": 0.42, "bucket": "red", "periodLabel": "...", "history": [ ... ] },
               "endorsement": { ...published endorsement for this cdKey or null... } },
    "senate": [ { "member": {...}, "rating": null, "endorsement": null }, { ... } ]
  },
  "state": {
    "upper": { "legislator": { ... } | null },
    "lower": { "legislator": { ... } | null },
    "endorsements": [ ...published endorsements with office_level state_senate/state_house/governor/statewide matching the user's districts or state... ]
  },
  "local": { "officials": [ ...published local officials for the county, then statewide... ] },
  "elections": [],          // filled in step 10
  "notices": []             // filled in step 11 (targeted notifications)
}
```

Rules:
- Senate ratings: there is no Senate ratings data yet; return `rating: null`. The ratings schema already supports
  `chamber = 'senate'` periods, so the admin can upload a Senate CSV later — make `importRatingsCsv` accept a
  `chamber` parameter now (Senate CSV uses `State` + `Member` columns instead of `District`; key rows by `bioguideId`
  resolved from member name + state, and report unmatched rows in the preview).
- Endorsements for state offices match on `officeLevel` + `state` + `district` (the admin enters the district code;
  normalize the same way as `boundaryKey`).
- Build the response with as few queries as possible (one per section); target p95 < 300 ms.

## Part D — Web page

Route `/my-district` (lazy-loaded; behind `featureFlags.myDistrict`):
- Signed in → loads `/v1/my-district`. Signed out → shows `DistrictFinder`; after resolve, loads the anonymous variant
  and shows a "Save this and get election reminders — Join" call to action linking to `/join` with zip prefilled.
- Sections, in order: "Your U.S. Representative" (reuse `CandidateView` styling: photo, party, district, grade badge with
  the existing color buckets via `finalColorBucket`, recent legislation list, call button `tel:` link, official website),
  endorsed challenger side by side when present (reuse `EndorsedView` layout), "Your Senators", "Your State Legislators",
  "Local Officials" (only when data exists, with "Know your local officials? Tell us" mailto link), "Upcoming Elections"
  (placeholder until step 10).
- Grade history: small inline SVG sparkline of `final` across periods (no chart library).
- "View on map" button: navigates to `/` with `?district=TX-37`; update `EndorsedMap` to read this query param on load and
  call `zoomFnRef.current(distKey)` once the map is ready.
- Banner when `needsReconfirm`: "District maps changed. Please confirm your address." → `/account`.
- Responsive layout; matches the existing visual design (colors, fonts in `global.css`).

## Verification

- [ ] Tests: `/v1/my-district` for signed-in user, anonymous unambiguous zip, anonymous ambiguous zip (409), user with no
      state legislator match, endorsement present/absent, senators always two (or one plus vacancy).
- [ ] Data checks in dev after the sync: ≥ 95% of `state_legislators` rows have a `boundaryKey` that exists in `boundaries`;
      the unmatched report is reviewed with the human and overrides committed.
- [ ] Manual: five test accounts in different states (including an at-large state, Nebraska, and New Hampshire) show correct data.
- [ ] Lighthouse mobile score ≥ 85 for performance and accessibility on `/my-district` in dev.

## Acceptance criteria

- [ ] "My District" shows federal, state, and (where curated) local officials with grades and endorsements, for both signed-in users and anonymous zip lookups.
- [ ] State legislators sync weekly; local officials are managed by Editors in the admin panel.
- [ ] The map supports deep links to a district.

## Rollback

Flag-gated (`myDistrict`). Sync jobs and tables are additive.
