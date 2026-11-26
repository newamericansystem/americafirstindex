# Phase 1 — Step 1: Discovery, Legacy Teardown, and Monorepo Restructure

## Goal

Record the few facts we need from the current deployment (domain, DNS, App Service plan),
tear the legacy deployment down, and restructure the repo into npm workspaces.

**Production downtime is acceptable.** The public site will be offline from the end of this
step until step 3 brings up the new hosting. Do not spend effort keeping the legacy deployment alive.

## Prerequisites

- `plan-step0.md` read.
- Local Node.js 24 and npm 10+. Docker Desktop installed (needed from step 3).
- Azure CLI (`az`) installed. GitHub CLI (`gh`) installed and authenticated.

## Part A — Discovery (record only what later steps need)

- [ ] **HUMAN**: run `az login` and `az account set --subscription <SUBSCRIPTION_ID>` so the agent can run `az` commands,
      or run the commands below and paste the output.
- [ ] Run and record the output in `docs/phase-1/values.md` under "Legacy deployment":

```bash
az webapp list --query "[?name=='americafirstindex'].{name:name, rg:resourceGroup, plan:appServicePlanId, hosts:hostNames}" -o json
az webapp config hostname list -g <RG> --webapp-name americafirstindex -o table
az webapp list --query "[?appServicePlanId=='<PLAN_ID>'].name" -o tsv     # other apps sharing the plan
gh secret list -R newamericansystem/americafirstindex
```

- [ ] Write down:
  1. Custom domains bound to the app (these become `<DOMAIN>` / `www.<DOMAIN>` in later steps) and where their DNS is hosted (`<DNS_PROVIDER>`).
     Copy the current DNS records for the domain into `values.md` (the human may need to export them from the DNS provider).
  2. Whether any other apps share the App Service plan.
  3. The client ID in GitHub secret `AZUREAPPSERVICE_CLIENTID_*`, if the human can look it up (needed to delete the legacy deploy identity).

## Part B — Legacy teardown

- [ ] Delete `.github/workflows/main_americafirstindex.yml` and the root `staticwebapp.config.json`
      (step 3 creates a new one in the web app).
- [ ] **HUMAN** (confirm before running): delete the legacy App Service:
      `az webapp delete -g <RG> -n americafirstindex`. If Part A showed no other apps on its plan, also delete the plan:
      `az appservice plan delete -g <RG> -n <PLAN_NAME> --yes`. If the resource group then contains nothing else, the human may delete it.
- [ ] Remove the legacy GitHub secrets: `AZUREAPPSERVICE_CLIENTID_*`, `AZUREAPPSERVICE_TENANTID_*`, `AZUREAPPSERVICE_SUBSCRIPTIONID_*`
      (`gh secret delete <NAME>`). Keep `VITE_CONGRESS_API_KEY` for now only if a developer needs it locally; it is deleted in step 4.
- [ ] **HUMAN**: delete the Entra app registration or managed identity the legacy workflow used for OIDC (Entra ID → App registrations,
      search by the client ID from Part A).
- [ ] Leave the domain's DNS records as they are for now; step 3 points them at the new hosting.

## Part C — Monorepo restructure

Target layout after this step:

```
/
├── apps/
│   └── web/                  # the current Vite app, moved here
│       ├── index.html
│       ├── package.json
│       ├── vite.config.js
│       ├── public/
│       │   ├── geo.json
│       │   └── ratings/house.csv
│       ├── scripts/simplify-geo.js
│       ├── geojson/          # moved here for now; step 7 moves it to data/boundaries/cd
│       └── src/...
├── packages/
│   └── shared/               # district key helpers (new)
├── docs/phase-1/
├── package.json              # workspace root
└── .nvmrc                    # "24"
```

`apps/api`, `apps/jobs`, and `infra/` are created in steps 2–3.

### Tasks

- [ ] Create branch `phase1/step-1-monorepo`.
- [ ] Use `git mv` (to preserve history) to move into `apps/web/`:
      `index.html`, `vite.config.js`, `public/`, `scripts/`, `geojson/`, `src/`.
- [ ] Create `apps/web/package.json` from the current root `package.json`:
  - `"name": "@afi/web"`, keep `"private": true`, `"type": "module"`.
  - Keep scripts `predev`, `dev`, `prebuild`, `build`, `preview`, `simplify` unchanged.
  - `react`, `react-dom` in `dependencies`; `@vitejs/plugin-react`, `simplify-js`, `vite` in `devDependencies`.
- [ ] Replace the root `package.json` with a workspace root:

```json
{
  "name": "americafirstindex",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "engines": { "node": ">=24" },
  "scripts": {
    "dev:web": "npm run dev -w @afi/web",
    "build:web": "npm run build -w @afi/web",
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present"
  }
}
```

- [ ] Add `.nvmrc` containing `24`.
- [ ] Create `packages/shared`:
  - `packages/shared/package.json` with `"name": "@afi/shared"`, `"type": "module"`,
    `"exports": { ".": "./src/index.js" }`. Plain JS with JSDoc types so the JS web app
    and TS API can both import it without a build step. Add a `types` entry pointing at
    a hand-written `src/index.d.ts`.
  - `src/districts.js`: move `toMapDistKey` from `apps/web/src/data/congress.js` here, and add:
    - `parseDistKey("TX-23") → { state: "TX", district: 23 }`
    - `formatCsvDistrict({ state, district }, atLargeStates?)` (inverse, for exports)
    - `STATE_FIPS_TO_USPS` and `USPS_TO_STATE_FIPS` maps for all 50 states + DC
      (`"01" → "AL"`, ..., `"56" → "WY"`, `"11" → "DC"`).
    - `STATE_NAMES` (USPS → full name).
  - `src/index.js` re-exports everything. `src/index.d.ts` declares the types.
  - Add Vitest and `src/districts.test.js` covering: `AZ-05 → AZ-5`, `WY-AL → WY-1`,
    `TX-23 → TX-23`, invalid input returns `null`, FIPS round-trips for all states.
- [ ] Update `apps/web/src/data/congress.js` to `import { toMapDistKey } from '@afi/shared'`
      and remove its local copy. Keep re-exporting `toMapDistKey` from `congress.js` so other imports keep working.
- [ ] Add `"@afi/shared": "*"` to `apps/web/package.json` dependencies.
- [ ] Update `.gitignore`: keep `node_modules`, `dist`, `.DS_Store`, `.env`; add `**/node_modules`,
      `**/dist`, `.env.*` with `!.env.example`.
- [ ] Vite loads `.env` from its root, now `apps/web/`. Tell the human to move their local `.env` to `apps/web/.env`
      (do not read or print its contents). Create `apps/web/.env.example` with `VITE_CONGRESS_API_KEY=` (removed in step 4).
- [ ] Delete root `package-lock.json` and run `npm install` at the root to produce a workspace lockfile.

## Verification

```bash
npm ci
npm test -w @afi/shared
npm run build:web
npm run dev:web     # open http://localhost:5173
```

- [ ] Map renders all districts, ratings colors appear, clicking a district loads the member card and legislation,
      endorsed carousel and dual view work (same behavior as before the restructure).
- [ ] `apps/web/dist` contains `geo.json`, `ratings/house.csv`, and the endorsement images.

## Acceptance criteria

- [ ] `values.md` records the domain, DNS provider, existing DNS records, and App Service plan facts.
- [ ] The legacy workflow, App Service, GitHub secrets, and deploy identity are removed.
- [ ] Repo uses npm workspaces with `apps/web` and `packages/shared`; `@afi/shared` has passing tests and is imported by the web app.
- [ ] The web app builds and runs locally with unchanged behavior.

## Rollback

Code: revert the merge commit. The legacy deployment is intentionally not recoverable; the new hosting arrives in step 3.
