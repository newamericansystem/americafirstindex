# Phase 1 — Recorded Values

Names and IDs only. Never put secrets in this file.

## Placeholders

| Placeholder | Value | Source |
|---|---|---|
| `<DOMAIN>` | `americafirstindex.us` | Custom domain bound to the legacy App Service (step 1) |
| `<AZURE_REGION>` | `westus2` | Human (step 2), after quota checks below |
| `<SUBSCRIPTION_ID>` | `4f38ff76-0933-4cbf-9746-92570fc83a3f` ("Azure subscription 1") | `az account show` (step 1) |
| `<TENANT_ID>` | `6594b8a2-0781-4a07-85f4-62ab8172d4d6` ("newamericansystem us", `NETORGFT20364170.onmicrosoft.com`) | `az account show` (step 1) |
| `<GITHUB_REPO>` | `newamericansystem/americafirstindex` | `git remote` |
| `<ADMIN_EMAILS>` | `president@newamericansystem.us`, `cscusa1776@gmail.com` | Human (step 1). The Gmail account is outside the tenant and must be invited as an Entra B2B guest before it can be assigned the Admin app role |
| `<MAIL_FROM_DOMAIN>` | `mail.americafirstindex.us` | Human (step 1) |
| `<ORG_POSTAL_ADDRESS>` | 5900 Balcones Dr. Suite 23684, Austin, TX 78731 US | Human (step 1) |
| `<DNS_PROVIDER>` | GoDaddy (nameservers `ns29.domaincontrol.com`, `ns30.domaincontrol.com`) | `dig NS`, `whois` (step 1) |

## Environments (step 2)

| Item | dev | prod |
|---|---|---|
| Resource group | `rg-afi-dev` | `rg-afi-prod` |
| GitHub deploy identity | `id-afi-github-dev` | `id-afi-github-prod` |
| `AZURE_CLIENT_ID` | `f905608e-8d6d-471b-888c-189065eceb9f` | `986e7df9-25ec-49ea-93ea-f79a30c7f4e7` |
| Federated credential subject | `repo:newamericansystem@252698414/americafirstindex@1249763886:environment:dev` | `repo:newamericansystem@252698414/americafirstindex@1249763886:environment:prod` |
| GitHub Environment | `dev` (no protection) | `prod` (required reviewer `newamericansystem`, `main` branch only) |
| App Service plan SKU | B1 | B1 (human chose dev-size SKUs; plan default B2) |
| Postgres SKU | Standard_B1ms | Standard_B1ms (human chose dev-size SKUs; plan default Standard_B2s) |

### Deployed resources

Resource name suffix: dev `pfhek` (derived from the subscription and resource group IDs, so prod's differs).

| Resource | dev | prod |
|---|---|---|
| Key Vault | `kv-afi-dev-pfhek` | _pending_ |
| Postgres | `psql-afi-dev-pfhek.postgres.database.azure.com` (16.15, PostGIS 3.6.4 verified) | _pending_ |
| Storage account | `stafidevpfhek` | _pending_ |
| API web app | `app-afi-api-dev-pfhek` → `app-afi-api-dev-pfhek.azurewebsites.net` | _pending_ |
| Function app | `func-afi-jobs-dev-pfhek` (Flex, Node 26) | _pending_ |
| Static Web App | `stapp-afi-dev` → `zealous-ocean-0b965d11e.5.azurestaticapps.net` | _pending_ |
| Communication Services | `acs-afi-dev` / `ecs-afi-dev` | _pending_ |
| Sender address | `DoNotReply@40068d8e-2f52-4b0d-b8b7-cd0f59647143.azurecomm.net` | `noreply@mail.americafirstindex.us` |
| Azure Maps | `maps-afi-dev` | _pending_ |
| App Insights / Log Analytics | `appi-afi-dev` / `log-afi-dev` | _pending_ |

### Region constraints found in step 2 (pay-as-you-go subscription, 2026-11-26)

Checked with ARM preflight validation, which enforces the real quota (the usages API reports a limit
of 30 everywhere and is not reliable).

| Region | App Service plans (B1/S1/P0v3) | Postgres Burstable B1ms |
|---|---|---|
| `centralus` | Blocked: 1 instance total, used by `nassite`; automatic increase refused (`QuotaNotAvailableForResource`) | Works |
| `eastus2` | Blocked (limit 0) | Refused at creation (`SkuNotAvailable`) |
| `eastus` | Blocked | Provisioning restricted |
| `southcentralus`, `northcentralus` | Blocked | Not tested |
| `westus2` | Allowed | Works (throwaway server created and deleted) |
| `westus3`, `westcentralus` | Allowed | Not tested |

To use another region, open a support request with issue type "Service and subscription limits (quotas)".
`Microsoft.Quota` was registered on the subscription during this investigation.

## Domain

- Registrar: GoDaddy.com, LLC. Created 2026-01-10. **Registration expires 2027-01-10** — confirm auto-renew is on.
- `www.americafirstindex.us` was never bound to the App Service; only the apex was.

## Legacy deployment (recorded 2026-11-26, removed in step 1)

| Item | Value |
|---|---|
| Web app | `americafirstindex` (Linux, `NODE\|24-lts`, startup `pm2 serve /home/site/wwwroot/dist --no-daemon --spa`) |
| Resource group | `americafirstindex` (Central US) |
| Default hostname | `americafirstindex-g9hcdvf5b3fxhnek.centralus-01.azurewebsites.net` |
| Custom hostnames | `americafirstindex.us` (SNI SSL, App Service managed certificate, thumbprint `800BD37FE951435E49B006469A8DAF6EB970536D`) |
| App settings (names) | `AZURE_COSMOS_CONNECTIONSTRING`, `VITE_CONGRESS_API_KEY` |
| App Service plan | `ASP-americafirstindex-b0e7` (Linux, Basic B1) |
| Other apps on the plan | `nassite` (resource group `newamericansystem`, serves `newamericansystem.us`) |
| GitHub deploy identities | User-assigned managed identities `oidc-msi-9a48` (client ID `251d58ad-90c2-4702-97ac-2d82106b9f61`) and `oidc-msi-99b6` (client ID `76415f53-9aef-4a14-960c-db5326f280d8`), each with Website Contributor on the web app only |
| GitHub secrets | `AZUREAPPSERVICE_CLIENTID_5AC87FCB4BB34E95A54C6B1011C01006`, `AZUREAPPSERVICE_TENANTID_CC1F8C1759B04288AC13433530E00B89`, `AZUREAPPSERVICE_SUBSCRIPTIONID_AA6B4D118C3B4554A563166B407C7C8C`, `VITE_CONGRESS_API_KEY` |

Also in the resource group, unused by the app code: Cosmos DB for MongoDB account
`americafirstindex-server` (one empty database, `americafirstindex-database`), private endpoint
`endpoint-sdw7vo26xiiau` + NIC, private DNS zone `privatelink.mongo.cosmos.azure.com` + VNet link,
VNet `vnet-xrojjeld`.

### Teardown status

| Action | Status |
|---|---|
| Delete `.github/workflows/main_americafirstindex.yml`, root `staticwebapp.config.json` | Done (branch `phase1/step-1-monorepo`) |
| Delete web app `americafirstindex` and its managed certificate | Done 2026-11-26 |
| Delete deploy identities `oidc-msi-9a48`, `oidc-msi-99b6` | Done 2026-11-26 |
| Delete Cosmos DB, private endpoint, private DNS zone, VNet | Done 2026-11-26 (approved by human) |
| App Service plan `ASP-americafirstindex-b0e7` | **Kept** — still hosts `nassite` |
| Resource group `americafirstindex` | **Kept** — still contains the plan |
| Delete `AZUREAPPSERVICE_*` GitHub secrets | Done 2026-11-26 (`VITE_CONGRESS_API_KEY` kept until step 4) |
| Merge step 1 ([PR #1](https://github.com/newamericansystem/americafirstindex/pull/1)) | Done 2026-11-26 |

## DNS records for `americafirstindex.us` (public lookup, 2026-11-26)

Zone hosted at GoDaddy. Captured with `dig`; GoDaddy may hold records not visible this way
(e.g. other subdomains) — export the zone from GoDaddy's DNS panel before changing it in step 3.

| Name | Type | Value | Notes |
|---|---|---|---|
| `@` | NS | `ns29.domaincontrol.com`, `ns30.domaincontrol.com` | |
| `@` | SOA | `ns29.domaincontrol.com dns.jomax.net` | |
| `@` | A | `20.118.56.16` | Legacy App Service inbound IP — now dead; repointed in step 3 |
| `www` | CNAME | `americafirstindex.us` | |
| `asuid` | TXT | `9EB72E4174ACFD298B24ADF4E4A1EFA1F0368B6C03F626F490CEC707F54B4AE7` | Legacy App Service domain verification; safe to remove in step 3 |
| `_dmarc` | TXT | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | GoDaddy default; revisit with email setup in step 10 |

No MX, AAAA, CAA, or apex TXT records exist.
