# Phase 1 — Step 5: Migrate Endorsements and Ratings to Postgres and Blob Storage

## Goal

Move the hard-coded endorsements (`apps/web/src/data/endorsements.js` + `src/assets/endorsements/*`)
and the ratings CSV (`apps/web/public/ratings/house.csv`) into the database and Blob Storage,
served by the API. After this step, the web app contains no editorial content data. Admin
editing comes in step 6; this step builds the data model, import logic, public endpoints, and
a one-time migration of existing content.

## Prerequisites

- Step 4 complete (members table populated in dev and prod).

## Part A — Schema (`packages/db`)

### Endorsements

```ts
export const contentStatus = pgEnum('content_status', ['draft', 'published', 'archived']);
export const officeLevel = pgEnum('office_level', [
  'us_house', 'us_senate', 'governor', 'state_senate', 'state_house', 'statewide', 'local',
]);
export const raceStatus = pgEnum('race_status', [
  'active', 'won_primary', 'won_general', 'lost', 'withdrawn',
]);

export const endorsements = pgTable('endorsements', {
  id: uuid('id').primaryKey().defaultRandom(),
  officeLevel: officeLevel('office_level').notNull().default('us_house'),
  state: char('state', { length: 2 }).notNull(),
  district: text('district'),                       // "23" for house; state-leg district id; null for statewide/senate
  distKey: text('dist_key'),                        // "TX-23" for us_house (used by the map)
  electionCycle: integer('election_cycle').notNull(), // e.g. 2026
  candidateName: text('candidate_name').notNull(),
  party: text('party'),
  roleLabel: text('role_label'),                    // "Candidate for U.S. House"
  bio: text('bio'),
  raceStatus: raceStatus('race_status').notNull().default('active'),
  incumbentBioguideId: text('incumbent_bioguide_id').references(() => members.bioguideId),
  photoPath: text('photo_path'),                    // blob path inside the media container
  photoAlt: text('photo_alt'),
  websiteUrl: text('website_url'),
  donateUrl: text('donate_url'),
  volunteerUrl: text('volunteer_url'),
  sortOrder: integer('sort_order').notNull().default(0),
  status: contentStatus('status').notNull().default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdBy: text('created_by'), updatedBy: text('updated_by'),
  createdAt: ..., updatedAt: ...,
}, (t) => [index('endorsements_status_idx').on(t.status, t.electionCycle)]);
```

Partial unique index: one published endorsement per House seat per cycle:
`CREATE UNIQUE INDEX endorsements_published_house_uq ON endorsements(dist_key, election_cycle) WHERE status = 'published' AND office_level = 'us_house';`

Legacy status mapping: `'active' → active`, `'won' → won_primary` (the UI labels `won` as "Won Primary").

### Ratings

The CSV has one row per House district with a free-text `Role` description (e.g. "Freedom Caucus former chair"),
four category scores (0–100), `Aggregate` (0–1), `Adjustment` (`-` = none), and `Final` (0–1).
Ratings are published in versioned **periods** so history is kept.

```ts
export const ratingPeriods = pgTable('rating_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  chamber: chamber('chamber').notNull().default('house'),
  label: text('label').notNull(),                  // "2026 Year-End"
  methodologyNote: text('methodology_note'),
  sourceFilename: text('source_filename'),
  sourceBlobPath: text('source_blob_path'),        // original CSV kept in the private uploads container
  status: contentStatus('status').notNull().default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdBy: text('created_by'),
  createdAt: ..., updatedAt: ...,
});

export const ratings = pgTable('ratings', {
  periodId: uuid('period_id').notNull().references(() => ratingPeriods.id, { onDelete: 'cascade' }),
  distKey: text('dist_key').notNull(),
  bioguideId: text('bioguide_id').references(() => members.bioguideId), // resolved at import time
  roleLabel: text('role_label'),
  immigration: smallint('immigration'),
  economy: smallint('economy'),
  social: smallint('social'),
  foreign: smallint('foreign'),
  aggregate: numeric('aggregate', { precision: 6, scale: 4 }),
  adjustment: numeric('adjustment', { precision: 6, scale: 4 }),
  final: numeric('final', { precision: 6, scale: 4 }),
}, (t) => [primaryKey({ columns: [t.periodId, t.distKey] }), index('ratings_bioguide_idx').on(t.bioguideId)]);
```

The **current** ratings are those in the most recently published House period
(`ORDER BY published_at DESC LIMIT 1`).

## Part B — Ratings CSV import (`packages/shared/src/ratings-csv.js`)

Move `parseCsvLine` from `apps/web/src/data/congress.js` into `@afi/shared` and add:

```js
/**
 * @returns {{ rows: RatingRow[], errors: { line: number, message: string }[], warnings: [...] }}
 */
export function parseRatingsCsv(text) { ... }
```

Rules:
- Strip BOM, split on `\r?\n`, ignore blank lines.
- Required headers (case-insensitive, trimmed): `District`, `Final`. Optional: `Role`, `Immigration`, `Economy`,
  `Social`, `Foreign`, `Aggregate`, `Adjustment`. Unknown headers → warning, ignored.
- `District` → `toMapDistKey()`; invalid → error for that line.
- Category scores: integers 0–100 or blank; `Aggregate`, `Final`: 0–1 or blank/`-`; `Adjustment`: number or `-`/blank → null.
- Duplicate district → error.
- Unit tests: parse the real `house.csv` (copy to `packages/shared/test/fixtures/house.csv`) with zero errors and
  the expected row count (218 at the time of writing); quoted fields with commas; BOM; bad numbers.

API service `apps/api/src/services/ratings.ts`:
- `importRatingsCsv({ text, filename, label, actor })`:
  1. `parseRatingsCsv`; if any errors, return them without writing (HTTP 422 later in admin).
  2. In a transaction: create a `draft` period, insert rows, resolve `bioguideId` by joining current House
     members on `dist_key`, store the raw CSV in blob `uploads/ratings/{periodId}.csv`.
  3. Return a preview: row count, districts with no current member, changes vs. current period
     (added, removed, `final` changed by > 0.05).
- `publishPeriod(periodId, actor)`: set `status = published`, `publishedAt = now()`; audit.

## Part C — Media service (`apps/api/src/services/media.ts`)

- Use `@azure/storage-blob` with `DefaultAzureCredential` from `@azure/identity` in Azure, and
  `AZURE_STORAGE_CONNECTION_STRING` (Azurite) locally.
- `uploadImage({ buffer, contentType, keyPrefix })`:
  - Accept only `image/jpeg`, `image/png`, `image/webp`; max 8 MB; verify magic bytes, not just the header.
  - Process with `sharp`: rotate per EXIF, resize to fit 800×800, convert to WebP quality 82, strip metadata.
  - Path: `{keyPrefix}/{sha256-of-output-first-16-hex}.webp` (content-addressed so caches never go stale).
  - Upload to container `media` with `Cache-Control: public, max-age=31536000, immutable`.
  - Return `{ path, url: \`${MEDIA_BASE_URL}/${path}\` }`.
- `sharp` is a native module: mark it `external` in `apps/api/build.mjs`, list it in the deploy `package.json`,
  and run `npm install --omit=dev --os=linux --cpu=x64` for the API artifact in the `build` job.
- Add the media base URL host to CSP `img-src` (already covered by `https://*.blob.core.windows.net`).

## Part D — Public API routes

| Route | Response |
|---|---|
| `GET /v1/endorsements?cycle=2026` | Published endorsements (default: all published, newest cycle first, then `sortOrder`). Each item: `{ id, officeLevel, state, district, distKey, electionCycle, name, party, role, bio, status, bioguideId, imageUrl, photoAlt, websiteUrl, donateUrl, volunteerUrl }` where `status` maps back to the UI's values (`active` → `"active"`, `won_primary`/`won_general` → `"won"`) **and** a new field `raceStatus` carries the full enum. |
| `GET /v1/ratings/house` | `{ period: { id, label, publishedAt }, ratings: { "TX-23": { role, final, immigration, economy, social, foreign, aggregate, adjustment, bioguideId } } }` for the current period. `ETag` = period id; `Cache-Control: public, max-age=300`. |
| `GET /v1/ratings/house/:distKey/history` | All published periods for that district, oldest first: `[{ periodId, label, publishedAt, final, ... }]`. |
| `GET /v1/ratings/members/:bioguideId/history` | Same, keyed by member (survives redistricting). |

## Part E — One-time content migration

Create `apps/api/scripts/seed-legacy-content.ts` (run with `tsx`), idempotent:

1. **Endorsements**: `endorsements.js` uses Vite's `import.meta.glob` and cannot be imported in Node. Create
   `data/seed/endorsements.json` by transcribing the three entries exactly (LA-5 Blake Miguez, TX-23 Brandon
   Herrera, TX-32 Jace Yarbrough) including `bio`, `status`, `bioguideId`, and add `electionCycle: 2026`,
   `photoFile` (e.g. `"LA-5.jpg"`). Copy `apps/web/src/assets/endorsements/*` to `data/seed/endorsements/`.
   The script uploads each photo via the media service and inserts `published` rows if no row exists for
   `(dist_key, election_cycle)`.
2. **Ratings**: copy `apps/web/public/ratings/house.csv` to `data/seed/ratings/house-initial.csv`. If no House
   period exists, import it with label `"Initial ratings"` and publish it.
3. Print a summary. Running it twice must change nothing.

Run it in each environment:
- Local: `npm run seed:legacy -w @afi/api`.
- Dev/prod: from a developer machine or a `workflow_dispatch` job `seed.yml` that logs in with OIDC, adds a
  temporary Postgres firewall rule, fetches `DATABASE_URL` from Key Vault, sets `STORAGE_ACCOUNT_NAME`, and runs
  the script (the GitHub identity has Storage Blob Data Contributor from step 2). Remove the firewall rule in `always()`.

## Part F — Web app changes (same PR; run the seed in each environment right after it deploys)

- [ ] `apps/web/src/data/endorsements.js`: replace the hard-coded object and `import.meta.glob` with:

```js
let cache = null;
export async function loadEndorsements() {
  if (!cache) cache = api('/v1/endorsements').then((items) => items.filter((e) => e.officeLevel === 'us_house'));
  return cache;
}
export async function getEndorsedCards() { return loadEndorsements(); } // same card shape as before
```

- [ ] `EndorsedMap.jsx` currently reads `ENDORSED[feat.key]` synchronously and builds `CAROUSEL_CARDS` at module
      load. Change it to load endorsements in the existing mount effect (`Promise.all([loadGeo(), loadHouseRatings(), loadEndorsements()])`),
      store them in state plus a `Map` keyed by `distKey` in a ref, and use that map wherever `ENDORSED` or
      `CAROUSEL_CARDS` was used. Pass the list to `CandidateCarousel`. Keep all visual behavior identical.
- [ ] `apps/web/src/data/congress.js`: `loadHouseRatings()` fetches `/v1/ratings/house` and returns the same
      `{ [distKey]: { role, final } }` map (plus the extra fields). Remove `parseHouseCsv` and `parseCsvLine` from the web app.
- [ ] Delete `apps/web/public/ratings/house.csv` and `apps/web/src/assets/endorsements/` (the seed copies live in `data/seed/`).
- [ ] Update `CandidateView`/`EndorsedView` only if field names changed (they should not).

## Verification

- [ ] `npm test` passes (CSV parser, import service, routes with seeded DB, media service against Azurite).
- [ ] Dev and prod: `GET /v1/endorsements` returns the three candidates with working `imageUrl`s served from Blob Storage.
- [ ] `GET /v1/ratings/house` returns the same number of districts as the CSV; spot-check `TX-26` final `1.0000`, `AZ-5` `0.8675`.
- [ ] The map colors, carousel, endorsed dual view, and member cards match the pre-change local build (compare screenshots of
      the full map, LA-5, TX-23, and an unrated district). Until the seed runs in an environment, its map shows no ratings
      or endorsements — acceptable.
- [ ] `apps/web/dist-prod` contains no `ratings/` folder and no endorsement images.

## Acceptance criteria

- [ ] Endorsements and ratings are stored in Postgres, photos in Blob Storage, served by public API routes.
- [ ] Rating history is preserved by period and linked to both district and member.
- [ ] Seed script has run in dev and prod; the web app reads all content from the API.

## Rollback

Fix forward. The seed data remains in `data/seed/` for re-import.
