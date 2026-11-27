-- Azure Database for PostgreSQL only allows extensions listed in the azure.extensions server parameter (infra/modules/postgres.bicep).
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
