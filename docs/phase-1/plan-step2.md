# Phase 1 — Step 2: Azure Resources (Bicep), OIDC, and Secrets

## Goal

Define every Phase 1 Azure resource in Bicep, deploy `dev` and `prod` environments
from GitHub Actions using OIDC, and store all secrets in Key Vault. (The public site is
offline during this step; that is expected — see step 0.)

## Prerequisites

- Step 1 merged.
- `docs/phase-1/values.md` contains `<SUBSCRIPTION_ID>`, `<TENANT_ID>`, `<AZURE_REGION>`,
  `<DOMAIN>`, `<MAIL_FROM_DOMAIN>`.
- Bicep CLI: `az bicep install && az bicep upgrade`.

## Resource inventory

| Resource | dev SKU | prod SKU | Purpose |
|---|---|---|---|
| Log Analytics workspace | PerGB2018, 30-day retention | PerGB2018, 90-day retention | Logs backend for App Insights |
| Application Insights | workspace-based | workspace-based | API + Functions telemetry |
| Key Vault | Standard, RBAC auth | Standard, RBAC auth, purge protection | Secrets |
| PostgreSQL Flexible Server 16 | Burstable `Standard_B1ms`, 32 GB | Burstable `Standard_B2s`, 64 GB, geo-redundant backup | App database with PostGIS |
| Storage account (StorageV2) | Standard_LRS | Standard_ZRS | `media` blobs, `uploads` blobs, queues, Functions deployment package |
| App Service plan (Linux) | `B1` | `B2` | Hosts the API |
| App Service web app | Node 24 LTS | Node 24 LTS | `americafirstindex-api` (no deployment slots — brief downtime during deploys is acceptable) |
| Function app | Flex Consumption `FC1` | Flex Consumption `FC1` | Scheduled and queued jobs |
| Static Web App | Standard | Standard | Front end + PR preview environments |
| Communication Services + Email Service | Azure-managed sender domain | Custom domain `<MAIL_FROM_DOMAIN>` | Email |
| Azure Maps account | Gen2 | Gen2 | Address geocoding |
| User-assigned managed identity | 1 | 1 | GitHub Actions OIDC deploy identity |

Approximate monthly cost at low traffic: dev ≈ $35–50, prod ≈ $70–100 (the App Service
plan and Postgres dominate). Moving prod to a `P0v3` plan with a staging slot for zero-downtime
deploys is a later option, not part of Phase 1. Confirm with the Azure pricing calculator and tell the human before deploying prod.

Networking in Phase 1 uses public endpoints with TLS, firewall rules, and managed
identities. Private endpoints / VNet integration are deferred (note it in step 12's backlog).

## Part A — Bootstrap (one-time, human-assisted)

Bicep deployments that create role assignments need elevated rights, and resource groups
are created at subscription scope. Do this once per environment.

- [ ] Create `infra/scripts/bootstrap.sh` that takes `ENV` (`dev`|`prod`) and runs:

```bash
#!/usr/bin/env bash
set -euo pipefail
ENV="${1:?usage: bootstrap.sh dev|prod}"
LOCATION="${LOCATION:?set LOCATION}"
REPO="newamericansystem/americafirstindex"
RG="rg-afi-${ENV}"
ID_NAME="id-afi-github-${ENV}"

az group create -n "$RG" -l "$LOCATION" --tags app=americafirstindex env="$ENV"
az identity create -g "$RG" -n "$ID_NAME"
PRINCIPAL_ID=$(az identity show -g "$RG" -n "$ID_NAME" --query principalId -o tsv)
CLIENT_ID=$(az identity show -g "$RG" -n "$ID_NAME" --query clientId -o tsv)
RG_ID=$(az group show -n "$RG" --query id -o tsv)

az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role "Contributor" --scope "$RG_ID"
az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role "Role Based Access Control Administrator" --scope "$RG_ID"

az identity federated-credential create -g "$RG" --identity-name "$ID_NAME" \
  --name "github-${ENV}" --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:${REPO}:environment:${ENV}" --audiences "api://AzureADTokenExchange"

echo "AZURE_CLIENT_ID=${CLIENT_ID}"
```

- [ ] **HUMAN**: with an account that has Owner (or User Access Administrator + Contributor)
      on the subscription, run `LOCATION=<AZURE_REGION> ./infra/scripts/bootstrap.sh dev`, then `prod`.
      Record both `AZURE_CLIENT_ID` values in `values.md`.
- [ ] Create GitHub Environments `dev` and `prod` (`gh api -X PUT repos/<GITHUB_REPO>/environments/dev`, same for prod).
      **HUMAN**: in GitHub settings, add required reviewers to `prod`.
- [ ] Set environment secrets/variables (agent may run with `gh`):
  - Variables (per env): `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RG=rg-afi-{env}`.
  - Secret (per env): `POSTGRES_ADMIN_PASSWORD` — generate with `openssl rand -base64 36 | tr -d '/+=' | cut -c1-32`
    and set via `gh secret set POSTGRES_ADMIN_PASSWORD --env dev` without printing it.
- [ ] **HUMAN (prod, start now — it takes days)**: open an Azure support request to raise
      ACS Email sending limits for the prod resource once it exists (default limits are low,
      on the order of tens of emails per minute). Mention expected volume.

## Part B — Bicep

Directory layout:

```
infra/
├── main.bicep                 # targetScope = 'resourceGroup'
├── modules/
│   ├── monitoring.bicep       # Log Analytics + App Insights
│   ├── keyvault.bicep
│   ├── postgres.bicep
│   ├── storage.bicep
│   ├── appservice-api.bicep   # plan + web app
│   ├── functions.bicep        # Flex Consumption plan + function app
│   ├── staticwebapp.bicep
│   ├── communication.bicep    # ACS + Email Service + domain + sender
│   ├── maps.bicep
│   ├── secrets.bicep          # Key Vault secrets derived from other resources
│   └── roles.bicep            # role assignments for managed identities
├── env/
│   ├── dev.bicepparam
│   └── prod.bicepparam
└── scripts/
    └── bootstrap.sh
```

### `main.bicep` parameters

```bicep
@allowed(['dev', 'prod'])
param env string
param location string = resourceGroup().location
param domain string                 // <DOMAIN>
param mailFromDomain string         // <MAIL_FROM_DOMAIN>, used only when env == 'prod'
@secure()
param postgresAdminPassword string
param postgresAdminLogin string = 'afiadmin'
param devClientIps array = []       // developer IPs allowed to reach Postgres in dev
var suffix = take(uniqueString(subscription().id, resourceGroup().id), 5)
var isProd = env == 'prod'
```

### Module requirements

Write each module to satisfy these requirements. Use current stable API versions
(check with `az provider show -n <namespace> --query "resourceTypes[?resourceType=='<type>'].apiVersions[0]"`).

**monitoring.bicep**
- Log Analytics workspace + workspace-based App Insights. Output `appInsightsConnectionString`.

**keyvault.bicep**
- `enableRbacAuthorization: true`, soft delete on, `enablePurgeProtection: isProd`.
- Public network access enabled (Phase 1). Output `name`, `uri`.

**postgres.bicep** (`Microsoft.DBforPostgreSQL/flexibleServers`)
- `version: '16'`, `sku` per table, `storage.storageSizeGB` per table, `storage.autoGrow: 'Enabled'`.
- `authConfig: { passwordAuth: 'Enabled', activeDirectoryAuth: 'Disabled' }` (Entra DB auth is a Phase 2 improvement).
- `backup.backupRetentionDays: isProd ? 14 : 7`, `geoRedundantBackup: isProd ? 'Enabled' : 'Disabled'`
  (cannot be changed after creation).
- `highAvailability.mode: 'Disabled'`.
- Child `databases` resource named `afi` (UTF8, `en_US.utf8`).
- Child `configurations` resource `azure.extensions` with value `POSTGIS,CITEXT,PGCRYPTO`
  (the extensions must be allow-listed before `CREATE EXTENSION` works).
- Child `configurations` resource `require_secure_transport` = `ON`.
- Firewall rule `AllowAzureServices` (`0.0.0.0`–`0.0.0.0`) and one rule per `devClientIps` entry (dev only).
- Output `fqdn`.

**storage.bicep**
- `allowBlobPublicAccess: true` (only the `media` container is public), `minimumTlsVersion: 'TLS1_2'`,
  `supportsHttpsTrafficOnly: true`, `allowSharedKeyAccess: false` (use managed identity everywhere; Azurite covers local dev).
- Blob containers: `media` (`publicAccess: 'Blob'`), `uploads` (private), `func-deploy` (private, Flex package storage).
- Queues: `email-outbound`, `email-events`.
- CORS on blob service: allow `GET` from `https://<DOMAIN>` and `https://*.azurestaticapps.net`.
- Output `name`, `blobEndpoint`, `queueEndpoint`.

**appservice-api.bicep**
- Linux plan, SKU per table, `reserved: true`.
- Web app: `kind: 'app,linux'`, `httpsOnly: true`, system-assigned identity,
  `siteConfig: { linuxFxVersion: 'NODE|24-lts', alwaysOn: true, ftpsState: 'Disabled', minTlsVersion: '1.2', http20Enabled: true, healthCheckPath: '/v1/health', appCommandLine: 'node dist/server.js' }`.
  Confirm the runtime string exists: `az webapp list-runtimes --os linux | grep NODE`.
- App settings (the API reads these; values are KV references where marked):

| Setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_ENV` | `env` |
| `PUBLIC_WEB_ORIGIN` | `https://<DOMAIN>` (dev: the SWA default hostname, output from staticwebapp module) |
| `ALLOWED_ORIGINS` | comma list: web origin + `https://*.azurestaticapps.net` for dev previews |
| `DATABASE_URL` | `@Microsoft.KeyVault(SecretUri=<kv>/secrets/database-url/)` |
| `SESSION_SECRET` | KV ref `session-secret` |
| `CONGRESS_API_KEY` | KV ref `congress-api-key` |
| `AZURE_MAPS_KEY` | KV ref `azure-maps-key` |
| `ACS_CONNECTION_STRING` | KV ref `acs-connection-string` |
| `MAIL_FROM` | `noreply@<sender domain>` |
| `STORAGE_ACCOUNT_NAME` | storage name |
| `MEDIA_BASE_URL` | `https://<storage>.blob.core.windows.net/media` |
| `ENTRA_TENANT_ID` / `ENTRA_ADMIN_API_CLIENT_ID` | set in step 6 (create the settings now with empty values) |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | from monitoring |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` (we deploy a pre-built bundle) |

- Output `defaultHostName`, `principalId`, `name`.

**functions.bicep** (Flex Consumption)
- Base this on the official Flex Consumption Bicep samples (`Azure-Samples/azure-functions-flex-consumption-samples`).
- Plan: `sku: { name: 'FC1', tier: 'FlexConsumption' }`, `reserved: true`.
- Site: `kind: 'functionapp,linux'`, system-assigned identity, `functionAppConfig`:
  - `deployment.storage`: blob container `func-deploy`, authentication `SystemAssignedIdentity`.
  - `runtime: { name: 'node', version: '<latest supported>' }` — check with
    `az functionapp list-flexconsumption-runtimes -l <AZURE_REGION> --runtime node`.
  - `scaleAndConcurrency: { maximumInstanceCount: 40, instanceMemoryMB: 2048 }`.
- App settings: `AzureWebJobsStorage__accountName=<storage>` (identity-based), `APPLICATIONINSIGHTS_CONNECTION_STRING`,
  and the same `DATABASE_URL`, `CONGRESS_API_KEY`, `ACS_CONNECTION_STRING`, `MAIL_FROM`, `PUBLIC_WEB_ORIGIN`,
  `API_ORIGIN=https://api.<DOMAIN>` (dev: API default hostname), `OPENSTATES_API_KEY` (KV ref, optional), `APP_ENV`.
- Output `name`, `principalId`.

**staticwebapp.bicep**
- `Microsoft.Web/staticSites`, `sku: { name: 'Standard', tier: 'Standard' }`, no repository link
  (we deploy with the SWA deploy action), `stagingEnvironmentPolicy: 'Enabled'`.
- Output `defaultHostname`, `name`.

**communication.bicep**
- `Microsoft.Communication/emailServices` (`dataLocation: 'United States'`).
- Domain child:
  - dev: name `AzureManagedDomain`, `domainManagement: 'AzureManaged'`.
  - prod: name `<MAIL_FROM_DOMAIN>`, `domainManagement: 'CustomerManaged'`, `userEngagementTracking: 'Disabled'`.
- `senderUsernames` child on the domain: `noreply` (display name "America First Index").
- `Microsoft.Communication/communicationServices` with `dataLocation: 'United States'` and
  `linkedDomains: [ domain.id ]`.
- Outputs: `acsName`, prod domain `verificationRecords` (SPF, DKIM, DKIM2, Domain TXT), managed domain `mailFromSenderDomain` (dev).

**maps.bicep**
- `Microsoft.Maps/accounts`, `sku: { name: 'G2' }`, `kind: 'Gen2'`, `disableLocalAuth: false`.

**secrets.bicep** — Key Vault secrets created from other resources (never output secret values):
- `database-url`: `postgresql://afiadmin:<password>@<fqdn>:5432/afi?sslmode=require` (URL-encode the password).
- `postgres-admin-password`.
- `azure-maps-key`: `maps.listKeys().primaryKey`.
- `acs-connection-string`: `acs.listKeys().primaryConnectionString`.
- `session-secret`: Do **not** generate in Bicep (it would change). Create once in Part C.
- `congress-api-key`: created in step 4 (new rotated key). Create an empty placeholder now only if the
  API's KV reference must resolve; otherwise create in step 4.

**roles.bicep** — role assignments (use built-in role definition IDs):

| Principal | Role | Scope |
|---|---|---|
| API web app identity | Key Vault Secrets User | Key Vault |
| API identity | Storage Blob Data Contributor | storage account |
| API identity | Storage Queue Data Message Sender | storage account |
| Function app identity | Key Vault Secrets User | Key Vault |
| Function app identity | Storage Blob Data Owner | storage account |
| Function app identity | Storage Queue Data Contributor | storage account |
| Function app identity | Storage Table Data Contributor | storage account (Functions host uses tables for timers) |
| GitHub deploy identity | Key Vault Secrets Officer | Key Vault (to create `session-secret` and later secrets) |
| GitHub deploy identity | Storage Blob Data Contributor | storage account (Flex deploy + seed uploads) |

### Parameter files

`infra/env/dev.bicepparam`:

```bicep
using '../main.bicep'
param env = 'dev'
param domain = '<DOMAIN>'
param mailFromDomain = '<MAIL_FROM_DOMAIN>'
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
param devClientIps = []
```

`prod.bicepparam` is identical except `env = 'prod'`.

## Part C — Infrastructure workflow

Create `.github/workflows/infra.yml`:

- Triggers: `pull_request` with `paths: ['infra/**']` (runs what-if against dev only) and
  `workflow_dispatch` with an `environment` input (`dev`|`prod`) that runs the deployment.
- Permissions: `id-token: write`, `contents: read`, `pull-requests: write` (to comment what-if).
- Job uses `environment: ${{ inputs.environment || 'dev' }}`.
- Steps:
  1. `actions/checkout@v4`
  2. `azure/login@v2` with `client-id`, `tenant-id`, `subscription-id` from environment variables.
  3. `az bicep build --file infra/main.bicep` (lint).
  4. On PR: `az deployment group what-if -g $AZURE_RG --parameters infra/env/dev.bicepparam` with
     `POSTGRES_ADMIN_PASSWORD` in env; post the summary as a PR comment.
  5. On dispatch: `az deployment group create -g $AZURE_RG --name infra-${{ github.run_number }} --parameters infra/env/<env>.bicepparam`.
  6. Post-deploy, create `session-secret` only if it doesn't exist:
     ```bash
     KV=$(az keyvault list -g $AZURE_RG --query "[0].name" -o tsv)
     az keyvault secret show --vault-name $KV -n session-secret >/dev/null 2>&1 || \
       az keyvault secret set --vault-name $KV -n session-secret --value "$(openssl rand -base64 48)" -o none
     ```
  7. Print deployment outputs (names and hostnames only).

## Part D — Deploy and verify

- [ ] Open a PR with `infra/` and the workflow; confirm the what-if comment looks right.
- [ ] Merge, then run `infra.yml` for `dev`. Fix and re-run until it succeeds. Re-run once more to confirm idempotency (no changes in what-if).
- [ ] Verify PostGIS can be enabled (the API migration will do it in step 3, but confirm now):
      **HUMAN** or agent with dev IP allowed: `psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS postgis; SELECT postgis_full_version();"`
- [ ] **HUMAN**: approve and run `infra.yml` for `prod`.
- [ ] Prod email domain: read the `verificationRecords` output. **HUMAN**: add the TXT (domain
      ownership + SPF) and CNAME (DKIM, DKIM2) records at `<DNS_PROVIDER>`. Add a DMARC record
      `_dmarc.<MAIL_FROM_DOMAIN>  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@<DOMAIN>"` (tighten to `quarantine` after a month of clean reports).
      Then verify each record type:
      `az communication email domain initiate-verification -g rg-afi-prod --email-service-name ecs-afi-prod --domain-name <MAIL_FROM_DOMAIN> --verification-type Domain` (repeat for `SPF`, `DKIM`, `DKIM2`).
- [ ] Record all resource names and default hostnames for both environments in `values.md`.

## Acceptance criteria

- [ ] `infra.yml` deploys `dev` and `prod` from GitHub with OIDC; re-running produces no changes.
- [ ] Key Vault in each env contains `database-url`, `postgres-admin-password`, `azure-maps-key`,
      `acs-connection-string`, `session-secret`.
- [ ] API web app and function app exist with managed identities and resolved KV references
      (Portal → Configuration shows green check marks once code is deployed in step 3).
- [ ] PostGIS extension can be created in the `afi` database.
- [ ] Prod sender domain is verified (or DNS records are submitted and verification is pending — note it).
## Rollback

Resources are additive. To remove an environment: `az group delete -n rg-afi-dev` (prod
requires human approval; Key Vault with purge protection stays soft-deleted for 90 days).
