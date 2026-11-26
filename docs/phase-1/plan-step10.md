# Phase 1 — Step 10: Email Pipeline, Election Calendar, and Scheduled Reminders

## Goal

1. A reliable, queued email pipeline with suppression, preference checks, one-click unsubscribe,
   and delivery tracking. Step 11's campaigns use the same pipeline.
2. An admin-managed election calendar (elections and their deadlines) per state.
3. Automatic reminder emails sent at 9 a.m. in each user's local time before key deadlines.

## Prerequisites

- Step 9 complete.
- Prod ACS sending-limit increase requested (step 2) — check status with the human.
- **HUMAN**: provide `<ORG_POSTAL_ADDRESS>` for email footers.

## Part A — Schema (`packages/db`)

```ts
export const electionKind = pgEnum('election_kind', ['primary', 'primary_runoff', 'general', 'general_runoff', 'special', 'municipal', 'other']);
export const deadlineKind = pgEnum('deadline_kind', [
  'registration', 'registration_online', 'registration_mail', 'registration_in_person',
  'absentee_request', 'mail_ballot_return', 'early_voting_start', 'early_voting_end', 'election_day',
]);

export const elections = pgTable('elections', {
  id: uuid('id').primaryKey().defaultRandom(),
  state: char('state', { length: 2 }).notNull(),
  name: text('name').notNull(),                       // "Texas Primary Election"
  kind: electionKind('kind').notNull(),
  electionDate: date('election_date').notNull(),
  cycle: integer('cycle').notNull(),
  scope: text('scope').notNull().default('statewide'), // 'statewide' | 'districts'
  boundaryKeys: text('boundary_keys').array(),        // for scope 'districts' (special elections): ["TX-18", "TX-U-4"]
  description: text('description'),
  infoUrl: text('info_url'),                          // official state page for voters
  sourceUrl: text('source_url'),                      // where staff verified the dates — required to publish
  status: contentStatus('status').notNull().default('draft'),
  updatedBy: text('updated_by'),
  createdAt: ..., updatedAt: ...,
}, (t) => [index('elections_state_date_idx').on(t.state, t.electionDate)]);

export const electionDeadlines = pgTable('election_deadlines', {
  id: uuid('id').primaryKey().defaultRandom(),
  electionId: uuid('election_id').notNull().references(() => elections.id, { onDelete: 'cascade' }),
  kind: deadlineKind('kind').notNull(),
  date: date('date').notNull(),
  timeNote: text('time_note'),                        // "Postmarked by", "Received by 7:00 p.m."
  notes: text('notes'),
}, (t) => [uniqueIndex('election_deadline_uq').on(t.electionId, t.kind), index('deadline_date_idx').on(t.date)]);

export const emailStatus = pgEnum('email_status', [
  'queued', 'sending', 'sent', 'delivered', 'suppressed', 'skipped', 'failed', 'bounced',
]);

export const emailMessages = pgTable('email_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  toEmail: citext('to_email'),                        // nulled when the user is deleted (see below)
  category: text('category').notNull(),               // 'transactional' | 'reminder' | 'campaign'
  template: text('template').notNull(),               // 'electionReminder', 'campaign', 'verifySignup', ...
  templateData: jsonb('template_data'),
  campaignId: uuid('campaign_id'),                    // FK added in step 11
  dedupeKey: text('dedupe_key').unique(),
  status: emailStatus('status').notNull().default('queued'),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: ..., updatedAt: ...,
}, (t) => [index('email_messages_status_idx').on(t.status, t.createdAt),
           index('email_messages_provider_idx').on(t.providerMessageId),
           index('email_messages_campaign_idx').on(t.campaignId, t.status)]);
```

Because `user_id` uses `set null`, extend account deletion (step 8) to also run
`UPDATE email_messages SET to_email = NULL, template_data = NULL WHERE user_id = $1` **before** deleting the user.

Settings seeded in `site_settings` (editable in step 11's settings UI; Admin only):

| Key | Example value | Public |
|---|---|---|
| `email.footer` | `{ "orgName": "America First Index", "postalAddress": "<ORG_POSTAL_ADDRESS>" }` | no |
| `reminders.schedule` | `[{"kind":"registration","daysBefore":[14,3]},{"kind":"absentee_request","daysBefore":[7]},{"kind":"early_voting_start","daysBefore":[0]},{"kind":"election_day","daysBefore":[1,0]}]` | no |
| `reminders.sendHourLocal` | `9` | no |
| `states.voterInfoUrls` | `{ "TX": "https://www.votetexas.gov/", ... }` (staff fill in; fallback `https://vote.gov/`) | yes |

## Part B — Unsubscribe tokens and routes

- Add Key Vault secret `unsubscribe-secret` (random, created once by the infra workflow like `session-secret`) and app settings
  `UNSUBSCRIBE_SECRET` for API and jobs.
- Token = base64url(`{ u: userId, c: category | 'all', v: 1 }`) + `.` + base64url(HMAC-SHA256). No expiry (links in old emails must keep working).
- Routes (exempt from the CSRF header rule — they are called by mail clients and email links):

| Route | Behavior |
|---|---|
| `POST /v1/email/unsubscribe?t=...` | RFC 8058 one-click: accepts `List-Unsubscribe=One-Click` form body. Turns off the token's category preference (or all three + suppression `unsubscribed` if `c = all`). Always `200` (even for unknown users). |
| `GET /v1/email/preferences?t=...` | Returns the user's prefs (email masked like `j***@gmail.com`). |
| `PUT /v1/email/preferences?t=...` | Updates prefs; `unsubscribeAll: true` → all false + suppression. |

- Web page `/unsubscribe?t=...`: shows preferences with toggles and an "Unsubscribe from all" button. Works without signing in.
- Every non-transactional email gets headers:
  `List-Unsubscribe: <https://api.<DOMAIN>/v1/email/unsubscribe?t=TOKEN>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
  plus a visible footer link to `/unsubscribe?t=TOKEN` and the postal address.

## Part C — Pipeline

```
producer (API or job)
  └─ INSERT email_messages (status queued, dedupe_key) ON CONFLICT DO NOTHING RETURNING id
  └─ enqueue { id } to Storage Queue `email-outbound` (batch, base64 JSON)
        └─ Function `sendEmail` (queue trigger)
              ├─ load message; if status != queued → ack and exit (idempotent)
              ├─ category != transactional:
              │    ├─ suppressed email hash? → status suppressed
              │    └─ user pref off for category? → status skipped
              ├─ render template (packages/email) with templateData + footer + unsubscribe token
              ├─ status sending, attempts+1 → transport.send() → status sent, providerMessageId, sentAt
              └─ on 429/5xx: throw (queue retries with visibility timeout); after maxDequeueCount → poison queue
ACS → Event Grid (EmailDeliveryReportReceived) → Function `emailEvents`
        └─ match providerMessageId → status delivered | bounced | failed; Bounced → suppression 'hard_bounce'
```

Details:
- `packages/email/src/enqueue.ts`: `enqueueEmails(db, queueClient, messages[])` inserts in chunks of 500 and sends queue
  messages in parallel (concurrency 16). Uses `@azure/storage-queue` with `DefaultAzureCredential` (Azurite connection string locally).
  The API identity already has Storage Queue Data Message Sender.
- `apps/jobs/host.json`: `extensions.queues`: `batchSize: 8`, `newBatchThreshold: 4`, `maxDequeueCount: 5`,
  `visibilityTimeout: "00:01:00"`. Start conservative; raise after the ACS quota increase.
- Transactional emails from step 8 keep sending synchronously from the API but also insert an `email_messages` row
  (`category = transactional`, status `sent`) so the log is complete.
- Event Grid: after the jobs app is deployed, create (idempotently, in `deploy.yml`) an Event Grid system topic for the ACS
  resource and a subscription filtered to `Microsoft.Communication.EmailDeliveryReportReceived` targeting the `emailEvents`
  function (`az eventgrid system-topic create` / `az eventgrid system-topic event-subscription create --endpoint-type azurefunction`).
  Verify in dev that the report's `messageId` equals the id returned by `beginSend()`; if not, store whichever id the reports use.
- ACS does not report spam complaints. **HUMAN**: register the sending domain with Google Postmaster Tools and Microsoft SNDS to monitor reputation.
- Local dev: run Functions with `func start` (Azure Functions Core Tools) against Azurite; Mailpit receives mail.

## Part D — Election calendar

### Admin API (Editor)

| Route | Behavior |
|---|---|
| `GET /v1/admin/elections?state=&cycle=&status=` | List with deadlines |
| `POST /v1/admin/elections` | Create draft with nested `deadlines[]` |
| `PATCH /v1/admin/elections/:id` | Update election and replace deadlines (in a transaction) |
| `POST /v1/admin/elections/:id/publish` | Requires `sourceUrl`, `electionDate`, and an `election_day` deadline (auto-create it from `electionDate` if missing) |
| `POST /v1/admin/elections/:id/unpublish`, `/archive` | Standard |
| `POST /v1/admin/elections/bulk-create` | Body `{ name, kind, electionDate, cycle, states: ["AL", ...] | "all" , sourceUrl }` → creates one draft per state (used for the federal general election). Staff then add each state's deadlines |
| `POST /v1/admin/elections/import` | CSV `state,election_name,kind,election_date,cycle,deadline_kind,deadline_date,time_note,info_url,source_url` (one row per deadline; rows grouped by state+name+date) → preview → create drafts |

**Agent rule: never invent election dates or deadlines.** Seed nothing in prod. In dev, seed clearly fake test data
(e.g. "TEST Primary" with dates relative to today) via a dev-only seed script.

### Admin UI

"Elections" page: filter by state and cycle; calendar/list toggle; edit form with a deadlines sub-table (kind, date, time note);
bulk-create dialog; CSV import with preview; a "Coverage" view listing states with no published upcoming election in the next
180 days (helps staff see gaps).

### Public API and web

- `GET /v1/elections?state=TX&from=YYYY-MM-DD` — published, upcoming (default from today), with deadlines; cache 10 minutes.
- `GET /v1/elections/:id.ics` — iCalendar file with one all-day event per deadline (generate by hand; RFC 5545 line folding and escaping).
- `/v1/my-district` now fills `elections`: published upcoming elections for the user's state where `scope = 'statewide'` or
  `boundaryKeys` overlaps the user's keys.
- "Upcoming Elections" section on `/my-district`: next election card with countdown, deadline list (past deadlines greyed out),
  "Add to calendar" (`.ics`) and "Official voter info" (`infoUrl` or `states.voterInfoUrls[state]`).

## Part E — Reminder scheduler

Function `scheduleReminders`, timer `0 5 * * * *` (every hour at :05):

1. Read `reminders.schedule` and `reminders.sendHourLocal`.
2. For each distinct `timezone` among active users, compute the local date/hour; continue only where the local hour equals the send hour.
3. For each schedule entry and each `daysBefore`, target date = local date + `daysBefore`. Select published deadlines of that kind on
   that date, joined to their elections.
4. Select recipients: `users.status = 'active'`, `timezone = tz`, `state = election.state`, statewide scope or boundary overlap,
   `user_email_prefs.election_reminders = true`, and no suppression for the email hash.
5. Insert `email_messages` with `template = 'electionReminder'`, `templateData = { electionId, deadlineId, daysBefore }`,
   `dedupeKey = reminder:{deadlineId}:{daysBefore}:{userId}`, then enqueue. The dedupe key makes re-runs safe.
6. Log counts per timezone/deadline.

Template `electionReminder` (subject examples): "Voter registration closes in 3 days in Texas",
"Early voting starts today in Texas", "Election Day is tomorrow". Body: deadline, date and time note, election name,
official voter info link, link to `/my-district`, footer with postal address and unsubscribe.

## Part F — Admin email log

Routes (Mailer or Admin): `GET /v1/admin/email/messages?status=&category=&campaignId=&email=&cursor=`,
`GET /v1/admin/email/stats?from=&to=` (counts by status and category), `GET /v1/admin/email/suppressions?email=`,
`DELETE /v1/admin/email/suppressions/:hash` (Admin only; refuse for `complaint`). Admin UI page "Email → Log" with filters and stats.

## Verification

- [ ] Tests: token sign/verify and tamper rejection; one-click unsubscribe; preference checks and suppression in `sendEmail`;
      idempotency (same queue message twice sends once); dedupe on re-running the scheduler; timezone selection
      (freeze time at several UTC hours); deadline/boundary matching for special elections; `.ics` validity (parse with `ical.js` in tests).
- [ ] Local: create a TEST election with a registration deadline 3 days out, set `sendHourLocal` to the current local hour, run the
      scheduler via the jobs CLI, see the email in Mailpit, click one-click unsubscribe (simulate with `curl -X POST`), re-run: no new email.
- [ ] Dev: same flow with ACS; confirm delivery events update rows to `delivered`; send to a deliberately invalid address
      at a real domain and confirm `bounced` + suppression.
- [ ] Gmail "Show original" for a dev reminder shows SPF/DKIM/DMARC pass and the unsubscribe link in the Gmail header UI.

## Acceptance criteria

- [ ] Queued email pipeline with suppression, preferences, retries, poison handling, and delivery tracking works in dev and prod.
- [ ] Staff manage election dates per state in the admin panel (no dates are hard-coded).
- [ ] Reminder emails send automatically at the configured local hour without duplicates.
- [ ] Every non-transactional email has a working one-click unsubscribe and postal address.

## Rollback

Disable the `scheduleReminders` function (`az functionapp config appsettings set ... AzureWebJobs.scheduleReminders.Disabled=true`)
to stop reminders immediately without a deploy. The email queue can be drained or cleared from the portal.
