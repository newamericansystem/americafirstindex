import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMigrations, sourceMigrationsFolder } from '@afi/db/migrate';

// The bundle ships migrations next to dist/migrate.js; from source they live in packages/db.
const bundled = fileURLToPath(new URL('./migrations', import.meta.url));
const migrationsFolder = existsSync(bundled) ? bundled : sourceMigrationsFolder;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

try {
  await runMigrations(url, migrationsFolder);
  console.log(`migrations applied from ${migrationsFolder}`);
} catch (err) {
  console.error('migration failed', err);
  process.exit(1);
}
