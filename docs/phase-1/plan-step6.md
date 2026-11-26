# Phase 1 — Step 6: Admin Authentication, Admin Shell, Endorsements and Ratings Admin

## Goal

Staff sign in with Microsoft Entra ID and manage endorsements and ratings from `/admin`
without touching code. Every admin change is audited. This step creates the admin
framework that steps 10 and 11 extend.

## Prerequisites

- Step 5 complete (endorsements and ratings served from the database).
- `<TENANT_ID>` and `<ADMIN_EMAILS>` recorded. The staff accounts must exist in that tenant
  (as members or invited B2B guests).

## Part A — Entra app registrations (per environment)

Two app registrations per environment:

| App | Purpose | Key settings |
|---|---|---|
| `afi-admin-api-{env}` | Represents the admin API | Application ID URI `api://afi-admin-api-{env}`; delegated scope `access_as_admin`; app roles `Admin`, `Editor`, `Mailer` (allowed member type: User); `api.requestedAccessTokenVersion = 2`; enterprise app **Assignment required = Yes** |
| `afi-admin-spa-{env}` | The admin UI (public client) | Platform: Single-page application; redirect URIs: `https://<DOMAIN>/admin/auth` (prod), `https://<dev SWA host>/admin/auth` and `http://localhost:5173/admin/auth` (dev); API permission: `afi-admin-api-{env}/access_as_admin` with admin consent granted |

Role meaning:

| Role | Can do |
|---|---|
| `Admin` | Everything, including site settings, feature flags, and the audit log |
| `Editor` | Endorsements, ratings, articles, notifications, elections, local officials |
| `Mailer` | Compose, test, schedule, and send email campaigns; view audiences |

`Admin` implicitly has `Editor` and `Mailer` permissions.

- [ ] Write `infra/scripts/entra-admin-apps.sh ENV` that creates both registrations idempotently with
      `az ad app create/update`, `az ad sp create`, and `az rest` calls to Microsoft Graph for `appRoles`,
      `oauth2PermissionScopes`, `requiredResourceAccess`, `appRoleAssignmentRequired`, and admin consent
      (`POST /oauth2PermissionGrants` for the SPA's service principal → API's service principal, scope `access_as_admin`,
      `consentType: AllPrincipals`). Generate stable GUIDs for roles/scopes once and keep them in the script.
- [ ] The script prints `SPA_CLIENT_ID`, `API_CLIENT_ID`, and the role IDs.
- [ ] **HUMAN** (requires Application Administrator or Cloud Application Administrator): run the script for
      `dev` and `prod`; then assign roles to staff: Enterprise applications → `afi-admin-api-{env}` → Users and groups →
      Add assignment (or `az rest POST /servicePrincipals/{apiSpId}/appRoleAssignedTo`). Use a security group per role
      if the tenant has Entra ID P1; otherwise assign users directly.
- [ ] Record client IDs in `values.md`. Set the API app settings `ENTRA_TENANT_ID` and `ENTRA_ADMIN_API_CLIENT_ID`
      via Bicep parameters (add them to `main.bicep` and both `.bicepparam` files) and redeploy infra.
- [ ] Web build env (non-secret, per environment, add to `deploy.yml`/`preview.yml`):
      `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_ADMIN_SPA_CLIENT_ID`, `VITE_ENTRA_ADMIN_API_SCOPE=api://afi-admin-api-{env}/access_as_admin`.

## Part B — API admin authentication

`apps/api/src/plugins/admin-auth.ts`:

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));

export async function verifyAdminToken(authorization?: string) {
  if (!authorization?.startsWith('Bearer ')) throw unauthorized();
  const { payload } = await jwtVerify(authorization.slice(7), jwks, {
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    audience: apiClientId,          // v2 tokens use the API's client ID as aud
    clockTolerance: 60,
  });
  if (payload.scp !== undefined && !String(payload.scp).split(' ').includes('access_as_admin')) throw forbidden();
  const roles = (payload.roles as string[] | undefined) ?? [];
  return { id: payload.oid as string, email: (payload.preferred_username as string) ?? null, name: payload.name as string, roles };
}
```

- Register a Fastify `preHandler` for all `/v1/admin/*` routes that sets `request.admin`.
- `requireRole(...roles)` route option; `Admin` passes every check.
- Admin routes: rate limit 600/min per user; no cookies; `Cache-Control: no-store`.
- `audit()` helper (from step 3) is called inside the same DB transaction as each write, with
  `actorType: 'admin'`, `actorId: oid`, `actorEmail`, and a JSON diff of changed fields
  (compute with a small `diffObjects(before, after)` helper; omit unchanged fields).
- Optimistic concurrency: every `PATCH` body includes `updatedAt` from the last read; mismatch → `409 conflict`.
- After any publish/unpublish/update of public content, clear the relevant in-memory caches in the API
  (`/v1/config`, ratings, endorsements). Public responses keep `max-age=300`, so visitors see changes within 5 minutes.

Tests: generate a local RSA key pair, sign test tokens, and inject a local JWKS into the plugin
(`buildApp({ adminJwks })`) so tests don't call Entra.

## Part C — Admin API routes

| Method & path | Role | Behavior |
|---|---|---|
| `GET /v1/admin/me` | any role | `{ id, email, name, roles }` |
| `GET /v1/admin/endorsements?status=&cycle=` | Editor | All statuses, paginated (`limit`, `cursor`) |
| `GET /v1/admin/endorsements/:id` | Editor | Full record incl. drafts |
| `POST /v1/admin/endorsements` | Editor | Create draft. Validate with shared zod schema; if `officeLevel = us_house`, require a valid `distKey` and auto-fill `incumbentBioguideId` from the current member if not provided |
| `PATCH /v1/admin/endorsements/:id` | Editor | Partial update with `updatedAt` check |
| `POST /v1/admin/endorsements/:id/photo` | Editor | `multipart/form-data` field `file`; uses media service; sets `photoPath` |
| `POST /v1/admin/endorsements/:id/publish` | Editor | Validates required fields (name, state, cycle, photo recommended → warning only); enforces the one-published-per-seat rule with a clear 409 message |
| `POST /v1/admin/endorsements/:id/unpublish` | Editor | Back to `draft` |
| `POST /v1/admin/endorsements/:id/archive` | Editor | `archived` (no hard delete) |
| `GET /v1/admin/ratings/periods` | Editor | List periods with row counts |
| `POST /v1/admin/ratings/periods/import` | Editor | Multipart: `file` (CSV ≤ 2 MB), `label`, `methodologyNote?`. Returns 422 with line errors, or the draft period + preview diff |
| `GET /v1/admin/ratings/periods/:id` | Editor | Period + rows + diff vs. current published |
| `POST /v1/admin/ratings/periods/:id/publish` | Editor | Publish |
| `DELETE /v1/admin/ratings/periods/:id` | Editor | Only drafts |
| `GET /v1/admin/ratings/periods/:id/export.csv` | Editor | CSV in the original column format (use `formatCsvDistrict`) |
| `GET /v1/admin/audit?entity=&entityId=&actor=&cursor=` | Admin | Newest first, 50 per page |

Put request/response zod schemas in `packages/shared/src/schemas/` (add `zod` as a dependency of `@afi/shared`)
so the admin UI uses the same validation.

## Part D — Admin UI (`apps/web/src/admin/`)

The admin is part of the web app but **code-split** so public visitors never download it:

```jsx
// main.jsx
const AdminApp = lazy(() => import('./admin/AdminApp'));
<Route path="/admin/*" element={<Suspense fallback={null}><AdminApp /></Suspense>} />
```

Structure:

```
apps/web/src/admin/
├── AdminApp.jsx          # MsalProvider, routes, layout
├── auth.js               # PublicClientApplication config, getAdminToken()
├── adminApi.js           # wraps fetch with Bearer token from acquireTokenSilent (fallback: acquireTokenRedirect)
├── AdminLayout.jsx       # sidebar: Dashboard, Endorsements, Ratings, Audit (later: Articles, Notifications, Elections, Email, Settings)
├── admin.css
├── components/           # Table, FormField, ImageUpload, StatusBadge, ConfirmDialog, Toast, DiffTable
└── pages/
    ├── Dashboard.jsx     # counts + recent audit entries
    ├── EndorsementsList.jsx
    ├── EndorsementEdit.jsx
    ├── RatingsList.jsx
    ├── RatingsImport.jsx
    ├── RatingsPeriod.jsx
    └── AuditLog.jsx
```

Requirements:
- Dependencies: `@azure/msal-browser`, `@azure/msal-react`.
- MSAL config: `authority: https://login.microsoftonline.com/<TENANT_ID>`, `redirectUri: ${origin}/admin/auth`,
  `cacheLocation: 'sessionStorage'`. Login with redirect, scopes `[VITE_ENTRA_ADMIN_API_SCOPE]`.
- After login, call `/v1/admin/me`. If the user has no roles, show "You don't have access" with the signed-in email and a sign-out button.
- Hide nav items the user's roles can't use (the API still enforces).
- **Endorsement editor**: all fields from Part C, district picker (state select + district number, validated against
  the map's districts), incumbent auto-filled and shown with name/photo, photo upload with preview, live preview
  rendered with the existing `EndorsedView`/`CandidateView` card styling, Save draft / Publish / Unpublish / Archive.
- **Ratings import**: file picker, label, methodology note → show errors table (line, message) or the diff
  (added/removed districts, changed finals sorted by magnitude, districts without a current member) → Publish.
- **Ratings period page**: sortable table of all rows, export CSV, publish (if draft), delete (if draft).
- **Audit log**: filterable table; expandable diff JSON.
- Unsaved-changes warning on navigation away from edit forms.
- Add to `staticwebapp.config.json` routes: `{ "route": "/admin/*", "headers": { "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" } }`.

## Verification

- [ ] Unit/integration tests: token verification (valid, expired, wrong audience, missing role), role enforcement per route,
      audit rows written for every mutation, optimistic concurrency 409, publish uniqueness 409, CSV import errors.
- [ ] In dev: a user with `Editor` creates a draft endorsement for a new district, uploads a photo, publishes it,
      and within 5 minutes the district shows as endorsed on the public map and in the carousel — no deploy.
- [ ] In dev: upload a modified copy of the ratings CSV, review the diff, publish; map colors change accordingly.
- [ ] A user without a role sees the access-denied screen; calling admin endpoints with their token returns 403.
- [ ] Public bundle check: `npx vite-bundle-visualizer` (or inspect `dist/assets`) shows MSAL only in the admin chunk.

## Acceptance criteria

- [ ] Admin sign-in with Entra ID works in dev and prod, with Admin/Editor/Mailer roles enforced by the API.
- [ ] Editors manage endorsements (including photos) and ratings periods end to end from the UI.
- [ ] All admin writes are audited and viewable by Admins.
- [ ] The public site's bundle size is not materially increased (< 5% growth).

## Rollback

Admin routes are additive. Disable admin access by removing role assignments; revert the PR if needed.
