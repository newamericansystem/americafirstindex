# Phase 1 — Step 4: Move Congress.gov Data Server-Side and Rotate the Leaked Key

## Goal

Stop calling Congress.gov from the browser. A nightly job stores current members of
Congress in Postgres; the API serves member and legislation data; the web app calls the
API. Issue a new Congress.gov key, store it only in Key Vault, and retire the old one.

## Prerequisites

- Step 3 complete (API, jobs, migrations, and deploy pipeline working in dev and prod).

## Background: what the web app does today

`apps/web/src/data/congress.js` exports these functions, used by `EndorsedMap.jsx`:

- `fetchMemberByBioguideId(bioguideId, overrideDistKey)` → `/v3/member/{id}`
- `fetchMemberByDistrict(state, district)` → `/v3/member/{state}/{district}`
- `fetchSponsoredLegislation(bioguideId, limit = 10)` → `/v3/member/{id}/sponsored-legislation`
- `loadHouseRatings()`, `getHouseRating()`, `finalColorBucket()`, `toMapDistKey()` (ratings stay client-side until step 5)

The normalized member shape the UI expects:
`{ bioguideId, name, state, district, distKey, party, imageUrl, role, final, url }`.
Bill shape: `{ title, type, number, introducedDate, url }`.
**Keep these shapes and function signatures unchanged** so `EndorsedMap.jsx` does not need edits.

## Part A — Key rotation (do first)

- [ ] **HUMAN**: request a new key at `https://api.data.gov/signup/` (Congress.gov uses api.data.gov keys).
      Use a shared organizational email, not a personal one.
- [ ] **HUMAN** (or agent via `az`, without echoing the value):
      `az keyvault secret set --vault-name <kv-dev> -n congress-api-key --value <NEW_KEY> -o none`, same for prod.
- [ ] Add `CONGRESS_API_KEY` to the local `apps/api/.env` and `apps/jobs/local.settings.json` (human does this).
- [ ] Retire the old key right away (nothing deployed depends on it any more): **HUMAN** contacts
      api.data.gov support to deactivate it if there is no self-service option, deletes the
      `VITE_CONGRESS_API_KEY` GitHub secret if it still exists, and removes it from their local `apps/web/.env`.

## Part B — Schema (`packages/db`)

```ts
export const chamber = pgEnum('chamber', ['house', 'senate']);

export const members = pgTable('members', {
  bioguideId: text('bioguide_id').primaryKey(),
  fullName: text('full_name').notNull(),          // "First M. Last" (use parseName logic from congress.js)
  firstName: text('first_name'),
  lastName: text('last_name'),
  party: text('party'),                            // "Republican", "Democratic", "Independent"
  state: char('state', { length: 2 }).notNull(),   // USPS
  district: integer('district'),                   // null for senators; at-large house = 1 (normalize 0 → 1)
  distKey: text('dist_key'),                       // "TX-23" for house, null for senate
  chamber: chamber('chamber').notNull(),
  isCurrent: boolean('is_current').notNull().default(true),
  imageUrl: text('image_url'),
  officialUrl: text('official_url'),
  phone: text('phone'),
  officeAddress: text('office_address'),
  termStartYear: integer('term_start_year'),
  congressGovUrl: text('congress_gov_url'),
  raw: jsonb('raw'),                               // last list payload, for debugging
  detailSyncedAt: timestamp('detail_synced_at', { withTimezone: true }),
  billsSyncedAt: timestamp('bills_synced_at', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: ..., updatedAt: ...,
}, (t) => [
  index('members_dist_key_idx').on(t.distKey),
  index('members_state_chamber_idx').on(t.state, t.chamber),
]);

export const memberBills = pgTable('member_bills', {
  bioguideId: text('bioguide_id').notNull().references(() => members.bioguideId, { onDelete: 'cascade' }),
  congress: integer('congress').notNull(),
  billType: text('bill_type').notNull(),           // "HR", "S", "HRES", ...
  billNumber: text('bill_number').notNull(),
  title: text('title').notNull(),
  introducedDate: date('introduced_date'),
  latestActionText: text('latest_action_text'),
  latestActionDate: date('latest_action_date'),
  url: text('url'),
  createdAt: ..., updatedAt: ...,
}, (t) => [primaryKey({ columns: [t.bioguideId, t.congress, t.billType, t.billNumber] }),
           index('member_bills_intro_idx').on(t.bioguideId, t.introducedDate)]);
```

Add a partial unique index so only one current House member exists per district:
`CREATE UNIQUE INDEX members_current_house_dist_uq ON members(dist_key) WHERE is_current AND chamber = 'house';`
(Vacancies simply have no row. If Congress.gov briefly returns two members for a seat during a
special election, keep the one with the later term start and log a warning.)

## Part C — Congress.gov client and sync job

Create `packages/congress` (`@afi/congress`, TypeScript) used by both API and jobs:

- `CongressClient({ apiKey, baseUrl = 'https://api.congress.gov/v3', fetch })` with:
  - `listCurrentMembers()` — async iterator over `/member?currentMember=true&limit=250&format=json`, following
    `pagination.next` until exhausted.
  - `getMember(bioguideId)` — `/member/{id}`.
  - `getSponsoredLegislation(bioguideId, { limit })` — `/member/{id}/sponsored-legislation`.
  - Timeout 10 s per request, retry twice on 429/5xx with exponential backoff (1 s, 4 s), honor `Retry-After`.
  - Never log the full URL (it contains `api_key`). Pass the key as a query param but redact it in errors.
- `normalizeListMember(raw)`:
  - Chamber from the latest item in `terms.item[]` (`"House of Representatives"` → `house`, `"Senate"` → `senate`).
  - `district`: number; `0` or missing for a House member → `1` (at-large); always `null` for senators.
  - `distKey` = `toMapDistKey(\`${state}-${district}\`)` from `@afi/shared` for House members.
  - `state`: Congress.gov returns full state names in list results — convert with `STATE_NAMES` reverse lookup.
    Skip non-state delegates (DC, PR, GU, VI, AS, MP) for map purposes but still store them (`state` = their USPS code).
- Unit-test the normalizers with fixtures captured from real responses (save them in `packages/congress/test/fixtures/`
  after redacting nothing sensitive — responses contain no secrets).

Functions in `apps/jobs/src/functions/`:

1. `syncMembers` — timer `0 0 8 * * *` (08:00 UTC daily):
   - Iterate `listCurrentMembers()`, upsert into `members` with `isCurrent = true`, `syncedAt = now()`.
   - After the loop, set `isCurrent = false` for rows not seen in this run (only if the run saw ≥ 500 members —
     a guard against partial API outages wiping data).
   - For up to 150 members where `detailSyncedAt` is null or older than 7 days, call `getMember()` and fill
     `officialUrl`, `phone`, `officeAddress` (`addressInformation`), `imageUrl` (`depiction.imageUrl`). This spreads the
     ~540 detail calls across the week and stays far below the 5,000 requests/hour limit.
   - Log counts: upserted, retired, details refreshed, errors.
2. `syncMemberBills` — timer `0 30 8 * * *`:
   - For up to 200 current members ordered by `billsSyncedAt NULLS FIRST`, fetch the latest 20 sponsored bills and upsert.

Add a CLI entry `apps/jobs/src/cli.ts` (`npm run job -w @afi/jobs -- syncMembers`) that runs the same
handler code locally for development and the initial backfill.

## Part D — API routes (`apps/api/src/routes/members.ts`)

| Route | Behavior |
|---|---|
| `GET /v1/members/:bioguideId` | Member by ID (current or not). 404 if unknown. |
| `GET /v1/members/by-district/:distKey` | Current House member for the district key (validate with `parseDistKey`). 404 `vacant` if none. |
| `GET /v1/members?state=TX&chamber=senate` | Current members filtered by state and chamber. Used by step 9. |
| `GET /v1/members/:bioguideId/legislation?limit=10` | Bills from `member_bills`, newest first. If `billsSyncedAt` is null or older than 24 h, fetch from Congress.gov first (8 s timeout), upsert, then respond. On upstream failure, return cached rows with header `x-afi-stale: 1`. Use an in-process single-flight map keyed by bioguide ID to avoid duplicate fetches. |

Response shape for members (camelCase), matching what the web normalizer needs:

```json
{
  "bioguideId": "G000594", "name": "Tony Gonzales", "state": "TX", "district": 23,
  "distKey": "TX-23", "party": "Republican", "chamber": "house",
  "imageUrl": "https://www.congress.gov/img/member/...", "url": "https://www.congress.gov/member/...",
  "officialUrl": "...", "phone": "..."
}
```

Set `Cache-Control: public, max-age=300` on member routes and `max-age=900` on legislation.
Rate limit legislation to 60/min per IP.

Tests: route tests with a seeded database and a mocked `CongressClient` (inject via `buildApp({ congressClient })`).

## Part E — Web app changes

- [ ] Rewrite the three fetch functions in `apps/web/src/data/congress.js` to call the API through `api()` from
      `src/lib/api.js`:
  - `fetchMemberByBioguideId(id, overrideDistKey)` → `GET /v1/members/{id}`; normalize to the existing shape
    (`role` and `final` still come from `getHouseRating(distKey)`).
  - `fetchMemberByDistrict(state, district)` → `GET /v1/members/by-district/{toMapDistKey(state-district)}`;
    return `null` on 404.
  - `fetchSponsoredLegislation(id, limit)` → `GET /v1/members/{id}/legislation?limit={limit}`.
- [ ] Delete `API_KEY`, `BASE`, and `qs()` from `congress.js`. Remove `VITE_CONGRESS_API_KEY` from
      `apps/web/.env.example` (CI never received it — see step 3).
- [ ] Remove `https://api.congress.gov` from the CSP `connect-src` in `staticwebapp.config.json`.

## Part F — Rollout

1. Merge to `main`; pipeline deploys to dev (migration creates tables; jobs deploy).
2. Backfill dev: trigger the timer function manually:
   ```bash
   KEY=$(az functionapp keys list -g rg-afi-dev -n <func-dev> --query masterKey -o tsv)
   curl -sS -X POST "https://<func-dev>.azurewebsites.net/admin/functions/syncMembers" \
     -H "x-functions-key: $KEY" -H "content-type: application/json" -d '{}'
   ```
   Re-run until all details are filled, or temporarily raise the detail batch limit via an app setting
   `MEMBER_DETAIL_BATCH` (default 150).
3. Verify in dev: `SELECT chamber, count(*) FROM members WHERE is_current GROUP BY chamber;` → ~435 house
   (minus vacancies, plus delegates) and 100 senate.
4. Approve the prod deploy, then backfill prod the same way. Member cards in prod show "not found" until the
   backfill finishes; that is acceptable. One PR for the whole step is fine.

## Verification

- [ ] `grep -R "api.congress.gov\|api_key" apps/web/dist-prod` returns nothing.
- [ ] Clicking any district in dev and prod shows the member card and recent legislation exactly as before.
- [ ] Endorsed districts (LA-5, TX-23, TX-32) still show the incumbent alongside the endorsed candidate.
- [ ] Browser devtools Network tab shows only calls to `api.<DOMAIN>` (no Congress.gov calls).
- [ ] Function runs appear in Application Insights with success logs; a forced failure (bad key in dev) logs an error and does not retire members.

## Acceptance criteria

- [ ] Congress data is served by the API from Postgres with on-demand legislation refresh.
- [ ] Nightly sync jobs run successfully in both environments.
- [ ] No Congress.gov key exists in any front-end build, GitHub secret, or `.env.example`.
- [ ] New key stored only in Key Vault (and developers' local env files); old key retired or retirement requested.

## Rollback

Fix forward. Reverting would bring back browser-side Congress.gov calls, which no longer have a key.
