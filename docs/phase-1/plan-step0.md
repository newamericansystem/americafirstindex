# Phase 1 — Step 0: Overview, Decisions, and Agent Instructions

Read this file completely before starting any other step. Every later step assumes the
decisions, names, and conventions defined here.

## Goal of Phase 1

Turn America First Index from a static infographic into a personalized, admin-managed
application.

**Production downtime is acceptable.** The legacy deployment is torn down in step 1 and the
public site is offline until step 3 brings up the new hosting. After that, prod deploys on every
merge (with an approval gate) and may be briefly broken between steps. Never add work whose only
purpose is keeping the old site running or making a cutover seamless. The existing map's
*functionality* must still be preserved in the new app.

At the end of Phase 1:

1. The existing map, ratings, and endorsements are served from a backend API and
   database instead of hard-coded files. No secrets ship to the browser.
2. Staff manage endorsements, ratings, articles, notifications, the election calendar,
   site text, and email campaigns from an admin panel, without code changes or redeploys.
3. Visitors sign up with an email and zip code (optionally a street address), confirm
   their email, and get a "My District" page: U.S. House member, senators, grades,
   endorsed challenger, state legislators, local officials (where curated), and upcoming
   election dates for their state.
4. Confirmed users receive election reminder emails and staff email campaigns, with
   consent records and one-click unsubscribe.
5. Infrastructure is defined in Bicep, deployed by GitHub Actions with OIDC, and split
   into `dev` and `prod` environments.
6. The legacy App Service deployment is gone (removed in step 1).

Out of scope for Phase 1: volunteer opportunities, chapters, campaign accounts, impact
tracking, shareable rep images, bill action alerts. Do not build these, but do not make
schema decisions that block them (see "Forward compatibility" below).

## Step index

| Step | File | Summary |
|---|---|---|
| 0 | `plan-step0.md` | This file: decisions, conventions, agent rules |
| 1 | `plan-step1.md` | Record domain/DNS facts, tear down the legacy deployment, monorepo restructure |
| 2 | `plan-step2.md` | Azure resources in Bicep (dev + prod), GitHub OIDC, secrets |
| 3 | `plan-step3.md` | API skeleton, database, local dev, CI/CD, web on Static Web Apps, custom domains |
| 4 | `plan-step4.md` | Move Congress.gov data server-side, rotate the leaked key |
| 5 | `plan-step5.md` | Migrate endorsements and ratings into Postgres and Blob Storage |
| 6 | `plan-step6.md` | Admin authentication, admin shell, endorsements and ratings admin, audit log |
| 7 | `plan-step7.md` | District boundaries in PostGIS and zip/address district lookup |
| 8 | `plan-step8.md` | Volunteer accounts: email + zip sign-up, magic links, consent, preferences |
| 9 | `plan-step9.md` | "My District" page, senators, state legislators, local officials |
| 10 | `plan-step10.md` | Email pipeline, election calendar, scheduled reminders |
| 11 | `plan-step11.md` | Admin content: articles, notifications, email composer, site settings |
| 12 | `plan-step12.md` | Hardening, QA, launch, runbooks |

Steps must be executed in order. Each step ends with acceptance criteria; do not start
the next step until all criteria of the current step pass.

## Current state (as of the start of Phase 1)

- Repo: `git@github.com:newamericansystem/americafirstindex.git`, default branch `main`.
- Front end: React 18 + Vite 6, plain JavaScript, single page `src/pages/EndorsedMap/EndorsedMap.jsx`
  rendered from `src/main.jsx`. No router.
- Map geometry: per-state files in `geojson/` (48 states — Alaska and Hawaii are missing),
  merged and simplified by `scripts/simplify-geo.js` into `public/geo.json` on `predev`/`prebuild`.
  Each feature has `properties.NAME` (district number as a string, at-large = `"1"`) and
  `properties.state` (USPS abbreviation). The map's district key is `"{state}-{NAME}"`, e.g. `TX-23`, `WY-1`.
- Ratings: `public/ratings/house.csv` with columns
  `District,Role,Immigration,Economy,Social,Foreign,Aggregate,Adjustment,Final`.
  CSV district format is `AZ-05` / `WY-AL`; `toMapDistKey()` in `src/data/congress.js` converts to map keys.
- Endorsements: hard-coded `ENDORSED` object in `src/data/endorsements.js`; photos in
  `src/assets/endorsements/{distKey}.{jpg|jpeg|png|webp}`.
- Congress.gov: called directly from the browser in `src/data/congress.js` using
  `VITE_CONGRESS_API_KEY`. **Vite inlines this key into the public bundle — it is leaked.**
- Hosting: GitHub Actions workflow `.github/workflows/main_americafirstindex.yml` builds and deploys
  the whole repo to Azure App Service app `americafirstindex` (slot `Production`) via OIDC.
  `staticwebapp.config.json` exists but has no effect on App Service. All of this is deleted in step 1.
- Hard-coded site copy lives in JSX (e.g., the "Where We're Fighting" intro in `EndorsedMap.jsx`).

## Architecture decisions (binding for all steps)

If a human asks to change one of these, update this section first, then the affected steps.

| Area | Decision |
|---|---|
| Repo layout | Single repo, npm workspaces: `apps/web`, `apps/api`, `apps/jobs`, `packages/shared`, `infra/` |
| Runtime | Node.js 24 LTS everywhere (match the existing workflow). Azure Functions: newest Node version Flex Consumption supports |
| Web | Keep React 18 + Vite + JavaScript. Add `react-router-dom` v6+ for routing. Do not rewrite to TypeScript in Phase 1 |
| API | TypeScript, Fastify 5, `zod` validation, `drizzle-orm` + `drizzle-kit` migrations, `pg` driver |
| Background jobs | Azure Functions (Node v4 programming model, TypeScript) on Flex Consumption: timer + queue + Event Grid triggers |
| Database | Azure Database for PostgreSQL Flexible Server, version 16, extensions `postgis`, `citext`, `pgcrypto` |
| Files | Azure Blob Storage, container `media` (public read via API-issued URLs or public blob access — see step 2) |
| Queue | Azure Storage Queues on the jobs storage account |
| Email | Azure Communication Services (ACS) Email; local dev uses Mailpit via an email transport abstraction |
| Geocoding | Azure Maps Geocoding API (`2023-06-01`), Census Geocoder as fallback |
| Volunteer auth | Passwordless magic links issued by our API; opaque session cookie. No third-party identity provider in Phase 1 |
| Admin auth | Microsoft Entra ID (workforce tenant) app registration with app roles; admin SPA uses MSAL; API validates JWTs with `jose` |
| Front-end hosting | Azure Static Web Apps (Standard) at `https://<DOMAIN>` |
| API hosting | Azure App Service (Linux) at `https://api.<DOMAIN>`. Not a SWA "linked backend" — called directly with CORS + credentials |
| Secrets | Azure Key Vault; App Service / Functions reference secrets with `@Microsoft.KeyVault(SecretUri=...)` app settings |
| Observability | Application Insights (workspace-based) + Log Analytics |
| IaC | Bicep in `infra/`, deployed by GitHub Actions with OIDC federated credentials |
| Environments | `dev` and `prod`, each in its own resource group |
| Region | `<AZURE_REGION>` (recommended: `centralus`) |

Why the API is called directly instead of as a SWA linked backend: linked backends put
App Service Easy Auth in front of the API, which conflicts with our own bearer-token
admin auth and cookie sessions. A dedicated `api.` subdomain is portable and standard.
`<DOMAIN>` and `api.<DOMAIN>` are the same site, so `SameSite=Lax` cookies work.

## Placeholders that require human input

Before step 2, ask the human for these values and record them in
`docs/phase-1/values.md` (create it; do not commit secrets there — names and IDs only).

| Placeholder | Meaning |
|---|---|
| `<DOMAIN>` | Public apex domain, e.g. `americafirstindex.com` |
| `<AZURE_REGION>` | Azure region for all resources |
| `<SUBSCRIPTION_ID>` | Azure subscription to deploy into |
| `<TENANT_ID>` | Entra tenant for admin sign-in and OIDC |
| `<GITHUB_REPO>` | `newamericansystem/americafirstindex` |
| `<ADMIN_EMAILS>` | Staff who should receive the Admin role initially |
| `<MAIL_FROM_DOMAIN>` | Sending domain for email, recommended `mail.<DOMAIN>` |
| `<ORG_POSTAL_ADDRESS>` | Physical mailing address required in bulk email footers (CAN-SPAM) |
| `<DNS_PROVIDER>` | Where DNS for `<DOMAIN>` is managed (Azure DNS, Cloudflare, registrar, ...) |

## Naming conventions for Azure resources

`{env}` is `dev` or `prod`. `{suffix}` is a 4–6 character lowercase string generated once
(`uniqueString(subscription().id)` truncated) for globally unique names.

| Resource | Name |
|---|---|
| Resource group | `rg-afi-{env}` |
| Log Analytics workspace | `log-afi-{env}` |
| Application Insights | `appi-afi-{env}` |
| Key Vault | `kv-afi-{env}-{suffix}` |
| PostgreSQL Flexible Server | `psql-afi-{env}-{suffix}` |
| Database | `afi` |
| Storage account (media + queues + functions) | `stafi{env}{suffix}` |
| App Service plan | `asp-afi-{env}` |
| API web app | `app-afi-api-{env}-{suffix}` |
| Function app | `func-afi-jobs-{env}-{suffix}` |
| Static Web App | `stapp-afi-{env}` |
| Communication Services | `acs-afi-{env}` |
| Email Communication Service | `ecs-afi-{env}` |
| Azure Maps account | `maps-afi-{env}` |
| User-assigned identity for GitHub deploys | `id-afi-github-{env}` |

## Coding conventions

- District keys everywhere use the map format `"{STATE}-{N}"` with at-large = `1`
  (e.g. `TX-23`, `WY-1`). Put the conversion helpers (`toMapDistKey`, `parseDistKey`,
  state FIPS ↔ USPS maps) in `packages/shared` and import them from web, API, and jobs.
- API routes are prefixed `/v1` (public) and `/v1/admin` (admin). JSON only. Errors use
  `{ "error": { "code": "string", "message": "string" } }`.
- All request bodies, query strings, and env vars are validated with `zod`.
- Database tables use `snake_case`, primary keys are `uuid` (`gen_random_uuid()`) unless a
  natural key is clearly better (e.g., `bioguide_id`). Every table has `created_at` and
  `updated_at` (`timestamptz`, default `now()`).
- Content tables (endorsements, articles, notifications, elections, settings) have a
  `status` column (`draft` | `published` | `archived`) and are only returned by public
  endpoints when `published`.
- Every admin write goes through a single `audit()` helper that records actor, action,
  entity, entity id, and a JSON diff.
- Match the style of existing code in `apps/web`: plain JS, function components, CSS files
  per page, no CSS framework.
- Write tests with Vitest. Database integration tests run against a `postgis/postgis:16-3.4`
  container (Testcontainers or docker compose).
- Never commit `.env` files or secrets. Commit `.env.example` files with every variable name.

## Forward compatibility (do not build yet, but do not block)

- Users will later belong to organizations (chapters, campaigns) with roles. Keep the
  `users` table free of org-specific columns; roles for volunteers will live in a join table.
- Volunteer opportunities will need PostGIS points and distance search. Enable PostGIS now
  and use SRID 4326 for all geometry.
- Email audiences will later include organization membership. Build the audience filter as
  a composable JSON structure (step 11), not hard-coded options.

## How an agent should execute a step

1. Read the step file fully. Read the files it references before editing them.
2. Create a branch `phase1/step-{N}-{short-name}` from up-to-date `main`.
3. Work through the tasks in order. Check off each `- [ ]` in your working notes, not in this file.
4. When a task is marked **HUMAN**, stop and ask the human to perform it, giving exact
   instructions (commands, portal steps, DNS records). Resume only after confirmation.
5. Run the step's verification commands. Fix failures before proceeding.
6. Open a pull request into `main` titled `Phase 1 Step {N}: {title}` with a summary and
   the acceptance checklist. Do not merge without human approval unless told otherwise.
7. After merge, confirm the deployment (where applicable) and record any new resource
   names or IDs in `docs/phase-1/values.md`.

## Legal and compliance guardrails (apply to every step)

- Email: only send to addresses that completed double opt-in. Every non-transactional
  email includes the organization's postal address, a visible unsubscribe link, and
  `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers.
- Do not build SMS in Phase 1 (TCPA consent requirements are out of scope).
- Store the minimum personal data: email, zip, resolved district IDs, consent records.
  Do not persist full street addresses — geocode, resolve districts, discard the address.
- Provide account deletion (step 8). Deletion must remove personal data, not just flag it.
- Before launch (step 12), the human should obtain a political-law review of the email
  program and the endorsement disclaimers ("Paid for by..." if applicable).
