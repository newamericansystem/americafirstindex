# Phase 1 — Step 12: Hardening, QA, Launch, and Runbooks

## Goal

Make the new platform production-ready, launch the Phase 1 features in prod, clean up leftovers,
and leave runbooks so the site can be operated without the original builders.

## Prerequisites

- Steps 1–11 merged and deployed to dev and prod (features still flag-gated off in prod).

## Part A — Security hardening

- [ ] **Least-privilege database roles.** Create (via a migration that runs as the admin user):
  - `afi_app` — `CONNECT`, `USAGE` on schema `public`, `SELECT/INSERT/UPDATE/DELETE` on all tables, `USAGE` on sequences,
    plus `ALTER DEFAULT PRIVILEGES` so future tables are covered. No DDL.
  - Keep the admin login only for migrations.
  - Store `database-url` (app, uses `afi_app`) and `database-url-migrate` (admin) in Key Vault; point API and jobs at
    `database-url`, and the deploy workflow's migrate step at `database-url-migrate`. Generate the `afi_app` password in the
    infra workflow like `session-secret` (create-if-missing) and set it with `ALTER ROLE` in the migrate step.
- [ ] **Enforce CSP**: switch `content-security-policy-report-only` to `content-security-policy` in
      `staticwebapp.config.json` after confirming no violations in the browser console across all pages (map, my-district,
      news, account, admin login flow).
- [ ] **Admin MFA**: **HUMAN** creates an Entra Conditional Access policy requiring MFA for the `afi-admin-spa-prod` and
      `afi-admin-api-prod` apps (requires Entra ID P1; otherwise enable Security Defaults or per-user MFA for staff accounts).
- [ ] **Dependency and secret scanning**: add `.github/dependabot.yml` (npm weekly for root workspace, GitHub Actions monthly);
      **HUMAN** enables GitHub secret scanning and push protection; add `npm audit --omit=dev --audit-level=high` to `ci.yml`.
- [ ] **Storage protection**: in Bicep enable blob soft delete (14 days) and versioning on the storage account; container soft delete 7 days.
- [ ] **Key Vault access review**: confirm only the API, jobs, and GitHub identities have access; remove any personal assignments
      added during setup.
- [ ] **Rate limiting at scale**: if the prod API runs more than one instance, move rate-limit storage from memory to Postgres
      (a small `rate_limits` table with `ON CONFLICT` counters) or Azure Cache for Redis. Otherwise document the single-instance assumption.
- [ ] **Secret rotation support**: API and jobs accept `UNSUBSCRIBE_SECRET_PREVIOUS` and `SESSION_SECRET_PREVIOUS` and verify against
      both, so secrets can be rotated without breaking old unsubscribe links or signing everyone out.
- [ ] Run the Bugbot/security review on the full Phase 1 diff and fix high-severity findings.

## Part B — Reliability and observability

Add to Bicep (`modules/alerts.bicep`) with an action group emailing `<ADMIN_EMAILS>`:

| Alert | Condition |
|---|---|
| API availability | Application Insights standard availability test on `https://api.<DOMAIN>/v1/health` from 3 regions every 5 min; alert on 2 consecutive failures |
| Site availability | Availability test on `https://<DOMAIN>/` (checks for "America First Index" in the body) |
| API errors | 5xx rate > 2% over 10 min |
| API latency | p95 > 1.5 s over 15 min |
| Function failures | Any failed execution of `syncMembers`, `scheduleReminders`, `dispatchCampaigns`, `sendEmail` (> 5 in 15 min) |
| Poison queue | `email-outbound-poison` message count > 0 |
| Email bounce rate | Log query: bounced / sent over 24 h > 5% |
| Postgres | CPU > 80% for 15 min; storage > 80%; connection failures |
| Cost | Azure budget per resource group with alerts at 80% and 100% of the monthly estimate from step 2 |

- [ ] Create an Azure Workbook "AFI Operations" with: requests and errors by route, function runs, emails by status per day,
      sign-ups per day, Postgres metrics.
- [ ] **Backup drill**: restore the dev Postgres server to a point in time (`az postgres flexible-server restore`) into a temporary
      server, connect, verify row counts, then delete it. Record the steps and timing in the DB runbook.
- [ ] **Load test** (Azure Load Testing or `k6` from a laptop) against dev, scaled to prod SKUs temporarily if needed:
      50 requests/second for 10 minutes mixing `/v1/ratings/house`, `/v1/endorsements`, `/v1/lookup/zip/:zip`, `/v1/my-district?zip=`.
      Targets: p95 < 500 ms, 0 errors. Tune indexes or caching if needed.

## Part C — Quality assurance

- [ ] Automated: add Playwright end-to-end tests in `apps/web/e2e/` run in CI against the dev deployment after deploy:
      map loads and a district click shows a member; `/my-district?zip=` anonymous flow; sign-up through Mailpit is local-only,
      so in CI use a test-only API route enabled solely when `APP_ENV=dev` that returns the latest token for a `+e2e` email address.
- [ ] Accessibility: run `@axe-core/playwright` on main pages; fix serious/critical issues. Keyboard navigation for forms and admin.
- [ ] Manual QA checklist (write `docs/phase-1/QA_CHECKLIST.md` and run it in dev, then prod with flags enabled for staff testing):
  - Chrome, Safari, Firefox, Edge on desktop; Safari iOS and Chrome Android.
  - Every admin page for each role (Admin, Editor, Mailer, no role).
  - Email rendering in Gmail (web + mobile), Outlook (web + desktop), Apple Mail.
  - Account deletion removes data (verify in DB) and stops all email.
- [ ] Lighthouse (mobile) ≥ 85 performance and ≥ 95 accessibility on `/`, `/my-district`, `/news`, `/join`.

## Part D — Content and legal readiness (HUMAN-led; the agent prepares checklists and admin tooling)

- [ ] Political-law review of: email program and consent language, endorsement presentation and any required disclaimers
      ("Paid for by ..." in the site footer if applicable), privacy policy, terms of service.
- [ ] Publish final Terms and Privacy Policy in Settings; set `policies.versions`.
- [ ] Staff enter verified upcoming elections and deadlines for priority states (every published election needs a `sourceUrl`),
      and voter info URLs for all states.
- [ ] Local officials for priority counties entered and published.
- [ ] Staff accounts assigned Admin/Editor/Mailer roles in prod; staff trained (30-minute walkthrough of each admin page — the agent
      writes `docs/admin-guide.md` with screenshots from dev).
- [ ] Email warm-up plan: start with small campaigns (a few hundred recipients/day) and grow over 2–4 weeks; confirm the ACS limit increase.

## Part E — Launch in prod

Enable flags in Settings → `feature_flags`, one at a time, watching dashboards for 24 hours between each:

1. `myDistrict` — anonymous zip lookup and "My District" page + DistrictFinder on the map.
2. `signup` — Join/Sign in, accounts, reminder emails.
3. `notifications` — banners and notices.
4. `articles` — News section.

- [ ] Before enabling `signup`, confirm prod email delivery by sending a campaign **test send** to staff addresses
      (reminder logic was already verified end to end in dev in step 10). Never publish test elections in prod.
- [ ] Announce the launch (staff task). Monitor sign-ups, bounce rate, error alerts daily for the first two weeks.

## Part F — Cleanup

- [ ] Confirm the legacy resources from step 1 are gone (`az webapp list --query "[?name=='americafirstindex']"` is empty, no
      `AZUREAPPSERVICE_*` or `VITE_CONGRESS_API_KEY` GitHub secrets) and the old Congress.gov key has been deactivated (step 4).
- [ ] Remove unused entries from `.env.example` files.
- [ ] Replace the root `README.md` (currently the GitHub profile template) with a project README: what the app is, architecture
      diagram (Mermaid), repo layout, local development, deployment, and links to runbooks.

## Part G — Runbooks (`docs/runbooks/`)

Write one file per topic, each with: when to use it, prerequisites, exact steps/commands, verification, and rollback.

| File | Covers |
|---|---|
| `deploy-and-rollback.md` | How deploys flow (PR → dev → approval → prod), rolling back the API, web, and jobs by re-running an earlier `deploy.yml` run, jobs, and migrations (forward-fix policy; never edit applied migrations) |
| `secrets-rotation.md` | Rotating Congress.gov, Azure Maps, ACS keys, Postgres passwords, session and unsubscribe secrets (using the `_PREVIOUS` variables) |
| `boundaries.md` | Written in step 7 — updating districts after redistricting and re-resolving users |
| `email-operations.md` | Pausing all sending (disable `sendEmail`, `dispatchCampaigns`, `scheduleReminders`), handling a bounce spike, draining/replaying the poison queue, deliverability checks (Postmaster Tools, DMARC reports) |
| `database.md` | Connecting safely (temporary firewall rule), point-in-time restore (from the drill), scaling the SKU, running ad-hoc read queries |
| `admin-access.md` | Granting/revoking Admin/Editor/Mailer roles in Entra, removing a departed staff member |
| `content-operations.md` | Uploading a new ratings period, publishing endorsements, election calendar upkeep each cycle |
| `data-sync.md` | Congress.gov and Open States sync jobs: manual triggers, failure modes, backfills |
| `incident-response.md` | Who to contact, where to look first (alerts → App Insights → logs), status communication, privacy incident steps (data exposure) |
| `costs.md` | Expected monthly costs per resource, budget alerts, how to scale down dev when idle |

## Part H — Phase 2 backlog (record, do not build)

Create `docs/phase-2/BACKLOG.md` listing items deferred from Phase 1:
private endpoints/VNet integration for Postgres, Key Vault, and storage; Entra authentication for Postgres; shared rate-limit store;
zero-downtime API deploys (move prod to a `P0v3` plan with a staging slot and slot swaps);
per-user feature flags / staff preview mode; Senate ratings content; map inset for Alaska and Hawaii; volunteer opportunities,
events, and chapter pages (Phase 2 roadmap); bill action alerts; shareable rep cards; SMS (with TCPA review); server-side rendering
for public pages if SEO requires it.

## Acceptance criteria

- [ ] Security, reliability, and QA items above are complete or explicitly accepted as risks by the human (recorded in `values.md`).
- [ ] All four feature flags are enabled in prod and stable.
- [ ] Alerts, availability tests, budgets, and the operations workbook exist in prod.
- [ ] Cleanup checks in Part F pass.
- [ ] Runbooks, admin guide, project README, and Phase 2 backlog are committed.

## Phase 1 complete

At this point the application is fully migrated to the new Azure infrastructure, all content and communications are
managed from the admin panel, and visitors can sign up with an email and zip code to get a personalized district page and
election reminders.
