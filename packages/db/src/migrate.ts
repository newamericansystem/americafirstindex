import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const MIGRATION_LOCK_ID = 727274;

/** Source location of the migrations; bundles copy them elsewhere and pass their own path. */
export const sourceMigrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies pending migrations while holding a session-level advisory lock, so concurrent deploys serialize. */
export async function runMigrations(connectionString: string, migrationsFolder: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    try {
      await migrate(drizzle(client), { migrationsFolder });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    }
  } finally {
    await client.end();
  }
}
