# Local development

## Prerequisites

- **Node 24** (`.nvmrc`). With nvm: `nvm install && nvm use`.
- **Docker Desktop**, running. It hosts Postgres/PostGIS, Azurite (Azure Storage emulator), and Mailpit
  (catches outgoing email), and the API tests start their own PostGIS container through Testcontainers.
- Optional, for `apps/jobs` only: Azure Functions Core Tools v4 (`brew tap azure/functions && brew install azure-functions-core-tools@4`).

## First-time setup

```sh
npm ci
cp apps/api/.env.example apps/api/.env
# Fill SESSION_SECRET in apps/api/.env with: openssl rand -hex 32
cp apps/web/.env.example apps/web/.env          # add VITE_CONGRESS_API_KEY for member cards (until step 4)
cp apps/jobs/local.settings.json.example apps/jobs/local.settings.json   # only if running jobs
```

## Run

```sh
npm run dev
```

This starts the Docker services (waiting until Postgres accepts connections), applies database migrations,
then runs the API (`http://localhost:4000`) and the web app (`http://localhost:5173`) side by side.
Vite proxies `/v1/*` to the API, so `http://localhost:5173/v1/health` should return `{"status":"ok",...}`.

| Service | URL |
|---|---|
| Web | http://localhost:5173 |
| API | http://localhost:4000/v1/health |
| Postgres | `postgresql://afi:afi@localhost:5432/afi` |
| Mailpit inbox | http://localhost:8025 (SMTP on 1025) |
| Azurite | blob 10000, queue 10001, table 10002 |

Stop the app with Ctrl+C; stop the containers with `docker compose down` (add `-v` to wipe the database).

### Jobs (optional)

```sh
npm run build -w @afi/jobs
cd apps/jobs && func start
```

Timer functions can be triggered on demand with
`curl -X POST http://localhost:7071/admin/functions/heartbeat -H 'content-type: application/json' -d '{}'`.

## Database changes

The Drizzle schema lives in `packages/db/src/schema`; migrations are committed in `packages/db/migrations`.

```sh
# after editing the schema
npm run db:generate -w @afi/db -- --name=<short_description>
# hand-written SQL (extensions, seed data, backfills)
npm run db:generate -w @afi/db -- --custom --name=<short_description>
npm run db:migrate -w @afi/api
```

Deploys run the same migrations automatically, under a Postgres advisory lock, before the API is updated.

## Tests

```sh
npm test
```

API tests start a throwaway PostGIS container. To use an existing database instead, set
`TEST_DATABASE_URL` (CI does this with a service container). Tests apply migrations to it.
