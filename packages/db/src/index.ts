import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.ts';

export * from './schema/index.ts';
export { schema };

export type Db = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string, poolOptions: pg.PoolConfig = {}) {
  const pool = new pg.Pool({ connectionString, max: 10, ...poolOptions });
  const db: Db = drizzle(pool, { schema });
  return { pool, db };
}
