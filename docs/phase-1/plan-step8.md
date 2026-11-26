# Phase 1 — Step 8: Volunteer Accounts — Email + Zip Sign-Up, Magic Links, Consent, Preferences

## Goal

Visitors sign up with an email and zip code (plus a street address only if needed to resolve
their district), confirm their email by clicking a link (double opt-in), and then stay signed
in with a secure session cookie. They can manage their district, email preferences, export
their data, and delete their account.

## Prerequisites

- Step 7 complete (lookup service works).
- Local Mailpit running (`docker compose up`). Dev ACS uses the Azure-managed sender domain; prod sender domain verified (step 2).
- **HUMAN**: provide the Terms of Service and Privacy Policy text (or approve placeholder text for dev only).

## Part A — Email transport package (`packages/email`)

Transactional emails (verification, sign-in links) are sent immediately by the API. Bulk sending
and the queue come in step 10, using this same package.

```ts
export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;   // e.g. List-Unsubscribe
  category: 'transactional' | 'reminder' | 'campaign';
}
export interface EmailTransport { send(msg: OutboundEmail): Promise<{ providerMessageId: string }> }
```

- `AcsTransport` using `@azure/communication-email` `EmailClient` with `ACS_CONNECTION_STRING`; sender `MAIL_FROM`;
  call `beginSend()` and return the operation id without waiting for `pollUntilDone()` (keeps API responses fast).
- `SmtpTransport` using `nodemailer` with `SMTP_URL` (Mailpit locally).
- `createTransport(env)` picks SMTP when `APP_ENV=local`, ACS otherwise.
- Templates in `packages/email/src/templates/*.ts`: functions returning `{ subject, html, text }`. Use a shared
  `layout({ preheader, bodyHtml, footerHtml })` with inline styles, the site name and logo (hosted in the `media` container),
  and HTML-escape every interpolated value with a single `escapeHtml` helper. Templates in this step:
  `verifySignup`, `signInLink`, `emailChanged`, `accountDeleted`.
- Snapshot tests for each template (HTML and text).

## Part B — Schema (`packages/db`)

```ts
export const locationPrecision = pgEnum('location_precision', ['zip', 'address', 'user_selected']);
export const userStatus = pgEnum('user_status', ['pending', 'active']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),          // define a custom citext type in drizzle
  firstName: text('first_name'),
  status: userStatus('status').notNull().default('pending'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  zip: char('zip', { length: 5 }).notNull(),
  state: char('state', { length: 2 }),
  cdKey: text('cd_key'),
  slduKey: text('sldu_key'),
  sldlKey: text('sldl_key'),
  countyKey: text('county_key'),
  locationPrecision: locationPrecision('location_precision').notNull().default('zip'),
  districtsResolvedAt: timestamp('districts_resolved_at', { withTimezone: true }),
  needsReconfirm: boolean('needs_reconfirm').notNull().default(false), // set after redistricting when we can't re-resolve
  timezone: text('timezone'),                          // IANA, derived from state (multi-zone states: most populous zone)
  signupSource: jsonb('signup_source'),                // { utm_source, utm_medium, utm_campaign, referrer_host }
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: ..., updatedAt: ...,
}, (t) => [index('users_state_idx').on(t.state), index('users_cd_idx').on(t.cdKey), index('users_status_idx').on(t.status)]);

export const userEmailPrefs = pgTable('user_email_prefs', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  electionReminders: boolean('election_reminders').notNull().default(true),
  actionAlerts: boolean('action_alerts').notNull().default(true),
  newsletter: boolean('newsletter').notNull().default(true),
  updatedAt: ...,
});

export const consents = pgTable('consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),            // 'terms' | 'privacy' | 'email_updates' | 'email_confirmed'
  version: text('version'),                // policy version, e.g. '2026-12-01'
  granted: boolean('granted').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: ...,
});

export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: text('purpose').notNull(),      // 'verify_signup' | 'sign_in' | 'change_email'
  tokenHash: text('token_hash').notNull().unique(),  // sha256 hex of the raw token
  newEmail: citext('new_email'),           // for change_email
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: ...,
});

export const sessions = pgTable('sessions', {
  idHash: text('id_hash').primaryKey(),    // sha256 of the cookie value
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  userAgent: text('user_agent'),
  createdAt: ...,
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const emailSuppressions = pgTable('email_suppressions', {
  emailHash: text('email_hash').primaryKey(),  // sha256 of lowercase trimmed email
  reason: text('reason').notNull(),            // 'unsubscribed' | 'hard_bounce' | 'complaint' | 'deleted'
  createdAt: ...,
});
```

Policy versions live in `site_settings` key `policies.versions` = `{ "terms": "2026-12-01", "privacy": "2026-12-01" }`.

## Part C — Auth service and routes

### Tokens and sessions

- Raw tokens: 32 random bytes, base64url. Store only `sha256` hex. Compare by looking up the hash.
- Expiry: `verify_signup` 24 h, `sign_in` 15 min, `change_email` 1 h. Single use (`usedAt`).
- Session cookie `afi_sid`: raw 32-byte value; `HttpOnly; Secure; Path=/; Max-Age=2592000` (30 days);
  `SameSite=Lax` in prod, `SameSite=None` in dev (PR previews are cross-site). Host-only cookie on `api.<DOMAIN>`.
  Sliding expiry: on each authenticated request, if `lastSeenAt` is older than 24 h, extend `expiresAt` and update `lastSeenAt`.
- CSRF: for every non-GET request to public `/v1/*` routes, require header `x-afi-csrf: 1` **and** an `Origin` header in
  the allowed-origins list. (The custom header forces a CORS preflight, so other sites cannot send it.)
- `request.user` is populated by a `preHandler` that reads the cookie; `requireUser` route option returns 401 otherwise.

### Routes

| Route | Behavior |
|---|---|
| `POST /v1/auth/signup` | Body: `{ email, zip, address?, selectedCdKey?, firstName?, prefs: { electionReminders, actionAlerts, newsletter }, acceptTerms: true, website: "" }`. `website` is a honeypot — if non-empty, return 202 and do nothing. Resolve districts via the lookup service (`selectedCdKey` must be one of the zip's candidates; precision `user_selected`). If the email is new: create `pending` user, prefs, consent rows (`terms`, `privacy`, `email_updates` with versions, IP, UA), and send `verifySignup`. If the email exists and is active: send `signInLink` instead. If it exists and is pending: update zip/districts/prefs and resend `verifySignup`. **Always** respond `202 { status: "check_email" }` (no account enumeration). |
| `POST /v1/auth/sign-in` | Body `{ email }`. If an active user exists, send `signInLink`; if pending, resend `verifySignup`. Always `202`. |
| `POST /v1/auth/verify` | Body `{ token }`. Validate unused/unexpired; mark used. For `verify_signup`: set `status=active`, `emailVerifiedAt`, insert consent `email_confirmed`, delete any suppression for this email whose reason is `unsubscribed` or `deleted` (a fresh double opt-in overrides them; never override `hard_bounce`/`complaint`). For `change_email`: update email (409 if taken). Create a session, set the cookie, update `lastLoginAt`, return `{ user }`. Invalid → `400 invalid_or_expired_token`. |
| `POST /v1/auth/sign-out` | Delete session, clear cookie, `204`. |
| `GET /v1/me` | `{ id, email, firstName, zip, state, districts: { cd, sldu, sldl, county }, locationPrecision, needsReconfirm, prefs }` — district objects include names from `boundaries`. |
| `PATCH /v1/me` | `{ firstName?, zip?, address?, selectedCdKey?, prefs? }`. Location changes re-run lookup (address discarded after use) and clear `needsReconfirm`. |
| `POST /v1/me/email` | `{ newEmail }` → sends `change_email` link to the new address and a notice to the old address. |
| `GET /v1/me/export` | JSON download of all stored data for the user (profile, prefs, consents, sessions metadata). |
| `DELETE /v1/me` | Body `{ confirm: "DELETE" }`. In one transaction: insert suppression `deleted` for the email hash, delete the user (cascades), audit with `actorType: 'user'` (store only the user id, not the email). Send `accountDeleted` to the address after commit. Clear cookie. |

Rate limits (use `@fastify/rate-limit` with a key generator): signup and sign-in 5/min and 20/hour per IP, plus
5/hour per email hash (in-memory LRU is acceptable for a single instance; note in the backlog to move to Redis or Postgres when scaling out).

Emails include links to the **web app** (`${PUBLIC_WEB_ORIGIN}/auth/verify?token=...`), not the API. The web page
requires a button click to confirm, because corporate email scanners pre-open links and would otherwise use up the token.

### Timezones

Add `STATE_TIMEZONE` to `@afi/shared` (one IANA zone per state; for states with multiple zones use the zone of the
largest population, e.g. TX → `America/Chicago`, FL → `America/New_York`, IN → `America/Indiana/Indianapolis`).

## Part D — Jobs

- `cleanupAuth` (timer `0 0 9 * * *`): delete auth tokens expired more than 1 day ago, expired sessions, and
  `pending` users older than 7 days (with their consents).
- `reresolveUsers` (Storage Queue trigger on queue `maintenance`, message `{ "task": "reresolveUsers" }`; add the queue to
  Bicep): for `zip` precision users recompute districts from `zip_boundaries`; for `address`/`user_selected` users,
  keep their stored keys if they still exist in `boundaries`, otherwise re-resolve by zip and set `needsReconfirm = true`.
  Admins trigger this from the admin panel (Part F) after a boundary update.

## Part E — Web pages

Add routes (all lazy-loaded except the map), behind `featureFlags.signup`:

| Path | Page |
|---|---|
| `/join` | Sign-up form: email, zip → `DistrictFinder` (address only if needed), optional first name, three preference checkboxes (unchecked by default except election reminders — **confirm the default with the human**), required "I agree to the Terms and Privacy Policy" checkbox, hidden honeypot field. On success: "Check your email to confirm." |
| `/sign-in` | Email field → "Check your email." |
| `/auth/verify` | Reads `token` from the query string, shows "Confirm and continue" button → `POST /v1/auth/verify` → navigate to `/my-district` (step 9; until then `/account`). Removes the token from the URL with `history.replaceState`. |
| `/account` | Profile, district (with "change" using DistrictFinder), email change, preferences toggles, "Download my data", "Delete my account" (type DELETE to confirm), sign out. Shows a banner when `needsReconfirm`. |
| `/terms`, `/privacy` | Render markdown from public site settings `page.terms` and `page.privacy` (add a minimal markdown renderer such as `marked` + `DOMPurify`). Seed placeholder text in dev. |

- `apps/web/src/lib/session.js`: `useSession()` hook that loads `/v1/me` (401 → signed out) and exposes `signOut()`.
- Header (in the existing `EndorsedMap` header markup, factored into a shared `SiteHeader` component): "Join" and "Sign in"
  when signed out; first name/"My District" and "Account" when signed in. Only shown when the `signup` flag is on.
- Forms: client-side validation with the shared zod schemas; accessible labels and error messages.

## Part F — Admin additions

- `GET /v1/admin/users?email=&state=&cdKey=&status=&cursor=` (Admin): paginated list with counts by state at the top.
- `DELETE /v1/admin/users/:id` (Admin): same deletion logic as `DELETE /v1/me`, audited with the admin as actor.
- `POST /v1/admin/maintenance/reresolve-users` (Admin): enqueue the `reresolveUsers` message.
- Admin UI page "Subscribers": totals, verified vs pending, breakdown by state and by congressional district, email search,
  delete button, "Re-resolve districts" button with confirmation.

## Verification

- [ ] Tests: signup new/existing/pending paths all return 202; honeypot; token expiry and reuse; session sliding expiry;
      CSRF header and Origin enforcement; rate limits; `PATCH /v1/me` re-resolution; deletion cascades and suppression;
      export contents; logs contain no raw tokens or addresses.
- [ ] Local: full flow with Mailpit (`http://localhost:8025`): join → email → confirm → account → change prefs → delete.
- [ ] Dev: full flow with real ACS email to a test inbox (Gmail and Outlook); check SPF/DKIM pass in the message headers.
- [ ] Prod: flag `signup` remains **off**. There are no per-user flags, so end-to-end testing happens in dev;
      the flag is enabled in prod at launch in step 12.

## Acceptance criteria

- [ ] Double opt-in sign-up with email + zip works end to end in dev, including the ambiguous-zip address path.
- [ ] Sessions are secure (HttpOnly, Secure, SameSite, hashed at rest) with CSRF protection.
- [ ] Users can update their district and preferences, export their data, and delete their account (hard delete + suppression).
- [ ] Consent records with policy versions, IP, and user agent are stored.
- [ ] Admins can search and delete users and trigger district re-resolution.

## Rollback

Flag-gated (`signup`). Turning the flag off hides all account UI; the API routes remain but are unused.
